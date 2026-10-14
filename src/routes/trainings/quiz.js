'use strict';

const express = require('express');
const { readTrainings, writeTrainings } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../../middleware/auth');
const { clampInt, normalizeEmpCode, sanitizeStr } = require('../../utils/validation');
const { createNotification } = require('../../services/notifications');
const { trainingReviewExpired, effectiveAllowedAttempts } = require('./shared');

const router = express.Router();

router.post('/api/trainings/:id/quiz', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { passThreshold, questions } = req.body || {};
  const threshold = clampInt(passThreshold, 0, 100, 70);
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'ضيف سؤال واحد على الأقل' });
  }
  const cleanQuestions = [];
  for (const q of questions) {
    const text = sanitizeStr(q && q.text, 500);
    const options = Array.isArray(q && q.options) ? q.options.map(o => sanitizeStr(o, 200)).filter(Boolean) : [];
    const correctIndex = Number.isInteger(q && q.correctIndex) ? q.correctIndex : parseInt(q && q.correctIndex, 10);
    if (!text || options.length < 2 || !(correctIndex >= 0 && correctIndex < options.length)) {
      return res.status(400).json({ error: 'كل سؤال لازم يكون له نص، خيارين على الأقل، وإجابة صحيحة محددة' });
    }
    cleanQuestions.push({ id: `Q-${Date.now()}-${Math.floor(Math.random() * 10000)}`, text, options, correctIndex });
  }

  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };
    const existingAttempts = (trainings[idx].quiz && trainings[idx].quiz.attempts) || {};
    trainings[idx].quiz = {
      passThreshold: threshold,
      questions: cleanQuestions,
      allowedAttempts: (trainings[idx].quiz && trainings[idx].quiz.allowedAttempts) || 1,
      perWorkerExtraAttempts: (trainings[idx].quiz && trainings[idx].quiz.perWorkerExtraAttempts) || {},
      attempts: existingAttempts,
      createdBy: sanitizeStr(req.user.name || req.user.username, 100),
      updatedAt: new Date().toISOString()
    };
    if (writeTrainings(trainings)) {
      result = { status: 200, body: { success: true, quiz: trainings[idx].quiz } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ الاختبار' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.get('/api/trainings/:id/quiz', authenticateSession, (req, res) => {
  if (!req.worker) return res.status(403).json({ error: 'الخاصية دي للعمال بس' });
  const trainings = readTrainings();
  const trn = trainings.find(t => t.id === req.params.id);
  if (!trn) return res.status(404).json({ error: 'المحاضرة غير موجودة' });
  if (!trn.quiz || !Array.isArray(trn.quiz.questions) || trn.quiz.questions.length === 0) {
    return res.status(404).json({ error: 'لا يوجد اختبار على هذه المحاضرة' });
  }
  if (trainingReviewExpired(trn)) {
    return res.status(403).json({ error: 'انتهت مدة إتاحة هذا الاختبار للمراجعة', reviewExpired: true });
  }
  const code = normalizeEmpCode(req.worker.empCode);
  const myAttempt = (trn.quiz.attempts && trn.quiz.attempts[code]) || null;
  const allowed = effectiveAllowedAttempts(trn.quiz, code);
  const used = (myAttempt && myAttempt.usedAttempts) || 0;
  res.json({
    passThreshold: trn.quiz.passThreshold,
    questions: trn.quiz.questions.map(q => ({ id: q.id, text: q.text, options: q.options })),
    myAttempt: myAttempt ? { usedAttempts: used, lastScore: myAttempt.lastScore, passed: myAttempt.passed } : null,
    canAttempt: used < allowed,
    remainingAttempts: Math.max(0, allowed - used)
  });
});

router.post('/api/trainings/:id/quiz/submit', authenticateSession, async (req, res) => {
  if (!req.worker) return res.status(403).json({ error: 'الخاصية دي للعمال بس' });
  const { answers } = req.body || {};
  if (!Array.isArray(answers)) return res.status(400).json({ error: 'إجابات غير صالحة' });

  const code = normalizeEmpCode(req.worker.empCode);
  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };
    const trn = trainings[idx];
    if (!trn.quiz || !Array.isArray(trn.quiz.questions) || trn.quiz.questions.length === 0) {
      return result = { status: 404, body: { error: 'لا يوجد اختبار على هذه المحاضرة' } };
    }
    if (trainingReviewExpired(trn)) {
      return result = { status: 403, body: { error: 'انتهت مدة إتاحة هذا الاختبار للمراجعة', reviewExpired: true } };
    }
    if (!trn.attendees.find(a => a.empCode === code)) {
      return result = { status: 403, body: { error: 'لازم تسجل حضورك في المحاضرة الأول قبل ما تاخد الاختبار' } };
    }

    trn.quiz.attempts = trn.quiz.attempts || {};
    const prevAttempt = trn.quiz.attempts[code];
    const allowed = effectiveAllowedAttempts(trn.quiz, code);
    const usedSoFar = (prevAttempt && prevAttempt.usedAttempts) || 0;
    if (usedSoFar >= allowed) {
      return result = { status: 403, body: { error: 'استنفدت عدد محاولات الاختبار المسموح بها. اطلب من مسؤول السلامة يفتحها لك تاني' } };
    }

    let correctCount = 0;
    trn.quiz.questions.forEach((q, i) => {
      if (Number(answers[i]) === q.correctIndex) correctCount++;
    });
    const score = Math.round((correctCount / trn.quiz.questions.length) * 100);
    const passed = score >= trn.quiz.passThreshold;

    trn.quiz.attempts[code] = {
      usedAttempts: usedSoFar + 1,
      lastScore: score,
      passed,
      answeredAt: new Date().toISOString()
    };

    const attendee = trn.attendees.find(a => a.empCode === code);
    if (attendee) {
      attendee.verified = passed;
      attendee.quizFailed = !passed;
      attendee.quizScore = score;
    }

    if (writeTrainings(trainings)) {
      if (!passed) {
        createNotification({
          targetEmpCode: code,
          type: 'training',
          title: 'نتيجة اختبار المحاضرة ❌',
          message: `للأسف حصلت على ${score}% في اختبار "${trn.title}" (المطلوب ${trn.quiz.passThreshold}%) — تم إلغاء تأكيد حضورك لحد ما تعيد الاختبار.`,
          link: 'tabTrainingWorker'
        });
      }
      result = { status: 200, body: { success: true, score, passed, passThreshold: trn.quiz.passThreshold } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ نتيجة الاختبار' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.post('/api/trainings/:id/quiz/reopen', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { scope, empCode, times } = req.body || {};
  const n = Math.max(1, Math.min(20, parseInt(times, 10) || 1));
  if (!['all', 'worker'].includes(scope)) return res.status(400).json({ error: 'نوع إعادة الفتح غير صالح' });
  if (scope === 'worker' && !empCode) return res.status(400).json({ error: 'اكتب كود العامل' });

  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };
    const trn = trainings[idx];
    if (!trn.quiz) return result = { status: 404, body: { error: 'لا يوجد اختبار على هذه المحاضرة' } };

    if (scope === 'all') {
      trn.quiz.allowedAttempts = (trn.quiz.allowedAttempts || 1) + n;
    } else {
      const nCode = normalizeEmpCode(empCode);
      trn.quiz.perWorkerExtraAttempts = trn.quiz.perWorkerExtraAttempts || {};
      trn.quiz.perWorkerExtraAttempts[nCode] = (trn.quiz.perWorkerExtraAttempts[nCode] || 0) + n;
      createNotification({
        targetEmpCode: nCode,
        type: 'training',
        title: 'اتفتحلك الاختبار تاني 🔓',
        message: `مسؤول السلامة فتحلك محاولة إضافية في اختبار محاضرة "${trn.title}"`,
        link: 'tabTrainingWorker'
      });
    }

    if (writeTrainings(trainings)) {
      result = { status: 200, body: { success: true, quiz: trn.quiz } };
    } else {
      result = { status: 500, body: { error: 'فشل تحديث الاختبار' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
