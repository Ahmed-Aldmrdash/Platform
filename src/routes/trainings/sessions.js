'use strict';

const crypto = require('crypto');
const express = require('express');
const { employeesStore, readTrainingTopics, readTrainings, writeTrainings, trainingsStore, shared } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../../middleware/auth');
const { replyNotModified, viewerKey } = require('../../middleware/http-cache');
const { normalizeEmpCode, sanitizeStr } = require('../../utils/validation');
const { createNotification } = require('../../services/notifications');
const { PIN_ROLES, DEFAULT_REVIEW_WINDOW_DAYS, trainingTargetsEmployee, trainingReviewExpired } = require('./shared');
const { autoCompleteMatchingTrainingRequests } = require('./requests');

const router = express.Router();

router.get('/api/trainings/topics', authenticateSession, (req, res) => {
  res.json({ topics: readTrainingTopics() });
});

// Only HSE sees attendance PINs; other admin roles get the sessions without them.
/** Only the sessions that are running now — what the live attendance screen polls. */
router.get('/api/trainings/active', authenticateToken, (req, res) => {
  const showPin = PIN_ROLES.includes(req.user.role);
  if (replyNotModified(req, res, ['trainings-active', showPin ? 'pin' : 'nopin', trainingsStore.version()])) return;
  const active = shared.trainings().filter((t) => t.status === 'active' && !t.isDeleted);
  res.json({ trainings: showPin ? active : active.map(({ sessionPin, ...t }) => t) });
});

router.get('/api/trainings', authenticateToken, (req, res) => {
  const showPin = PIN_ROLES.includes(req.user.role);
  if (replyNotModified(req, res, ['trainings', showPin ? 'pin' : 'nopin', trainingsStore.version()])) return;
  const trainings = shared.trainings();
  res.json({ trainings: showPin ? trainings : trainings.map(({ sessionPin, ...t }) => t) });
});

router.get('/api/trainings/worker/:empCode', authenticateSession, (req, res) => {
  const code = req.worker ? req.worker.empCode : normalizeEmpCode(req.params.empCode);
  if (replyNotModified(req, res, ['trn-worker', viewerKey(req), code, trainingsStore.version(), employeesStore.version(), Math.floor(Date.now() / 60000)])) return;
  const trainings = shared.trainings();
  const employeesForTargeting = shared.employees();
  const attCode = (a) => normalizeEmpCode(a.empCode || a.code || a.employeeCode || a.id || '');

  const activeSession = trainings.find(t => t.status === 'active' && trainingTargetsEmployee(t, code, employeesForTargeting));
  const myHistory = [];
  let totalClosed = 0;
  let myAttended = 0;

  trainings.forEach(trn => {
    const isClosed = trn.status === 'closed' || trn.isClosed;
    if (isClosed) totalClosed++;
    const me = (trn.attendees || []).find(a => attCode(a) === code);

    if (me) {
      if (isClosed && me.verified !== false) myAttended++;
      const hasQuiz = !!(trn.quiz && Array.isArray(trn.quiz.questions) && trn.quiz.questions.length > 0);
      const hasRecording = !!(trn.recording && trn.recording.url);
      const reviewExpired = trainingReviewExpired(trn);
      const reviewWindowDays = Number.isFinite(trn.reviewWindowDays) ? trn.reviewWindowDays : DEFAULT_REVIEW_WINDOW_DAYS;
      const reviewDeadline = (trn.closedAt && reviewWindowDays > 0)
        ? new Date(new Date(trn.closedAt).getTime() + reviewWindowDays * 24 * 60 * 60 * 1000).toISOString()
        : null;
      let statusLabel = me.verified === false ? '⏳ قيد المراجعة' : '✅ مؤكد';
      if (me.verified === false && me.quizFailed) {
        statusLabel = `❌ رسب في اختبار المحاضرة (${me.quizScore ?? 0}%)`;
      }
      myHistory.push({
        date: trn.date || trn.createdAt,
        title: trn.title || trn.topic,
        status: statusLabel,
        verified: me.verified !== false,
        attended: true,
        trainingId: trn.id,
        hasQuiz,
        hasRecording,
        recordingUrl: hasRecording ? trn.recording.url : null,
        reviewExpired,
        reviewDeadline,
        quizFailed: !!me.quizFailed
      });
    }
  });

  myHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

  let safeActiveSession = null;
  if (activeSession) {
    // Never send the PIN, the quiz answers or other workers' attempts to a worker.
    safeActiveSession = { ...activeSession };
    delete safeActiveSession.sessionPin;
    delete safeActiveSession.quiz;
    safeActiveSession.hasQuiz = Boolean(activeSession.quiz && Array.isArray(activeSession.quiz.questions) && activeSession.quiz.questions.length);
    const meAttended = (activeSession.attendees || []).find(a => attCode(a) === code);
    safeActiveSession.attendees = meAttended ? [meAttended] : [];

    const liveTopic = (activeSession.title || activeSession.topic || '').trim();
    let attendedBeforeDate = null;
    if (liveTopic) {
      const prior = trainings
        .filter(t => t.id !== activeSession.id && (t.title || t.topic || '').trim() === liveTopic)
        .filter(t => (t.attendees || []).some(a => attCode(a) === code && a.verified !== false))
        .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
      if (prior.length) attendedBeforeDate = prior[0].date || prior[0].createdAt || null;
    }
    safeActiveSession.attendedBefore = !!attendedBeforeDate;
    safeActiveSession.attendedBeforeDate = attendedBeforeDate;
  }

  res.json({
    activeSession: safeActiveSession,
    myHistory,
    totalClosed,
    myAttended
  });
});

router.post('/api/trainings', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { title, location, date, startTime, endTime, trainer, trainerCode } = req.body || {};
  if (!title || !date || !startTime || !endTime) {
    return res.status(400).json({ error: 'البيانات الأساسية مطلوبة' });
  }

  let targetMode = String(req.body.targetMode || 'all').trim();
  if (!['all', 'department', 'workers'].includes(targetMode)) targetMode = 'all';
  let targetDept = '';
  let targetEmpCodes = [];
  if (targetMode === 'department') {
    targetDept = sanitizeStr(req.body.targetDept || '', 150);
    if (!targetDept) return res.status(400).json({ error: 'اختر القسم المستهدف' });
  } else if (targetMode === 'workers') {
    const rawCodes = Array.isArray(req.body.targetEmpCodes)
      ? req.body.targetEmpCodes
      : String(req.body.targetEmpCodes || '').split(/[,\s]+/);
    targetEmpCodes = Array.from(new Set(rawCodes.map(c => normalizeEmpCode(c)).filter(Boolean))).slice(0, 500);
    if (!targetEmpCodes.length) return res.status(400).json({ error: 'اكتب كود أو أكواد العمال المستهدفين' });
  }
  const targetGroup = targetMode === 'all' ? 'الجميع'
    : targetMode === 'department' ? targetDept
    : (targetEmpCodes.length === 1 ? `عامل بالكود ${targetEmpCodes[0]}` : `${targetEmpCodes.length} عمال محددين`);

  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const newId = `TRN-${Date.now()}`;
    const newTraining = {
      id: newId,
      title: sanitizeStr(title, 200),
      topic: sanitizeStr(title, 200),
      trainer: sanitizeStr(trainer || '', 150),
      trainerCode: sanitizeStr(trainerCode || '', 50),
      targetMode,
      targetDept: targetDept || null,
      targetEmpCodes,
      targetGroup: sanitizeStr(targetGroup, 200),
      location: sanitizeStr(location || '', 200),
      date: sanitizeStr(date, 20),
      startTime: sanitizeStr(startTime, 10),
      endTime: sanitizeStr(endTime, 10),
      sessionPin: String(crypto.randomInt(1000, 10000)),
      status: 'active',
      attendees: [],
      createdAt: new Date().toISOString()
    };
    trainings.push(newTraining);
    if (writeTrainings(trainings)) {
      const notifMsg = `محاضرة جديدة: ${newTraining.title} في ${newTraining.location || 'غير محدد'} - الساعة ${newTraining.startTime}`;
      if (targetMode === 'workers') {
        targetEmpCodes.forEach(code => {
          createNotification({
            targetEmpCode: code,
            type: 'training',
            title: 'محاضرة تدريبية جديدة 🎓',
            message: notifMsg,
            link: 'tabTrainingWorker'
          });
        });
      } else if (targetMode === 'department') {
        createNotification({
          targetRole: 'worker',
          targetDept: newTraining.targetDept,
          type: 'training',
          title: 'محاضرة تدريبية جديدة 🎓',
          message: notifMsg,
          link: 'tabTrainingWorker'
        });
      } else {
        createNotification({
          targetRole: 'worker',
          type: 'training',
          title: 'محاضرة تدريبية جديدة 🎓',
          message: notifMsg,
          link: 'tabTrainingWorker'
        });
      }

      autoCompleteMatchingTrainingRequests(newTraining.title);

      result = { status: 201, body: { success: true, training: newTraining } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ المحاضرة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/trainings/:id/close', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };

    trainings[idx].status = 'closed';
    trainings[idx].closedAt = new Date().toISOString();
    if (writeTrainings(trainings)) {
      createNotification({
        targetRole: 'admin',
        type: 'training',
        title: 'إغلاق محاضرة 🔒',
        message: `تم إغلاق محاضرة ${trainings[idx].title} بإجمالي حضور ${trainings[idx].attendees.length}`,
        link: 'tabTrainingAdmin'
      });

      result = { status: 200, body: { success: true, training: trainings[idx] } };
    } else {
      result = { status: 500, body: { error: 'فشل إغلاق المحاضرة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.delete('/api/trainings/:id', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };

    trainings[idx].isDeleted = true;
    trainings[idx].deletedAt = new Date().toISOString();

    if (writeTrainings(trainings)) {
      result = { status: 200, body: { success: true } };
    } else {
      result = { status: 500, body: { error: 'فشل عملية الحذف المؤقت' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/trainings/:id/restore', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };

    trainings[idx].isDeleted = false;
    trainings[idx].deletedAt = null;

    if (writeTrainings(trainings)) {
      result = { status: 200, body: { success: true } };
    } else {
      result = { status: 500, body: { error: 'فشل عملية الاستعادة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.delete('/api/trainings/:id/permanent', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    let trainings = readTrainings();
    const initialLength = trainings.length;
    trainings = trainings.filter(t => t.id !== req.params.id);

    if (trainings.length < initialLength) {
      if (writeTrainings(trainings)) {
        result = { status: 200, body: { success: true } };
      } else {
        result = { status: 500, body: { error: 'فشل عملية الحذف النهائي' } };
      }
    } else {
      result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
