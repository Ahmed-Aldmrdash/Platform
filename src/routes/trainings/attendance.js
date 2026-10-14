'use strict';

const express = require('express');
const { readEmployees, readTrainings, writeTrainings } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../../middleware/auth');
const { attendLimiter } = require('../../middleware/rate-limits');
const { normalizeEmpCode, sanitizeStr } = require('../../utils/validation');
const { createNotification, notifyAttendance } = require('../../services/notifications');
const { trainingTargetsEmployee } = require('./shared');

const router = express.Router();

router.post('/api/trainings/:id/attend', authenticateSession, attendLimiter, async (req, res) => {
  if (!req.worker) return res.status(403).json({ error: 'تسجيل الحضور من حساب العامل نفسه' });
  let empCode = req.worker.empCode;
  let { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'رمز الجلسة مطلوب' });

  empCode = String(empCode).trim();
  pin = String(pin).trim();

  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };

    const trn = trainings[idx];
    if (trn.status !== 'active') {
      return result = { status: 400, body: { error: 'المحاضرة مغلقة حالياً' } };
    }

    const createdAt = new Date(trn.createdAt || trn.date).getTime();
    const now = new Date().getTime();
    if (now - createdAt > 30 * 60 * 1000) {
      return result = { status: 400, body: { error: 'لقد انتهى الوقت المسموح للتسجيل (30 دقيقة من بدء المحاضرة)' } };
    }
    if (trn.sessionPin !== String(pin).trim()) {
      return result = { status: 400, body: { error: 'رمز الجلسة غير صحيح' } };
    }

    const nCode = normalizeEmpCode(empCode);
    if (trn.attendees.find(a => a.empCode === nCode)) {
      return result = { status: 400, body: { error: 'تم تسجيل حضورك بالفعل في هذه المحاضرة' } };
    }

    const employees = readEmployees();
    const emp = employees.find(e => normalizeEmpCode(e.code || e.empCode) === nCode);
    if (!emp) {
      return result = { status: 404, body: { error: 'الكود الوظيفي غير مسجل في النظام' } };
    }

    if (!trainingTargetsEmployee(trn, nCode, employees)) {
      return result = { status: 403, body: { error: 'هذه المحاضرة موجّهة لقسم أو مجموعة عمال محددة، وحسابك غير مستهدف بها' } };
    }

    trn.attendees.push({
      empCode: nCode,
      name: emp.name,
      department: emp.department,
      attendedAt: new Date().toISOString(),
      verified: true
    });

    if (writeTrainings(trainings)) {
      notifyAttendance(trn, emp.name, { type: 'training', link: 'tabTrainingAdmin' });

      createNotification({
        targetEmpCode: nCode,
        type: 'training',
        title: 'تأكيد الحضور ✅',
        message: `تم تسجيل وتأكيد حضورك في محاضرة ${trn.title}`,
        link: 'tabTrainingWorker'
      });

      result = { status: 200, body: { success: true, message: 'تم تسجيل الحضور بنجاح' } };
    } else {
      result = { status: 500, body: { error: 'حدث خطأ أثناء التسجيل' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.post('/api/trainings/:id/add-attendee', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let { empCode } = req.body;
  if (!empCode || !String(empCode).trim()) {
    return res.status(400).json({ error: 'الكود الوظيفي مطلوب' });
  }
  empCode = String(empCode).trim();

  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };

    const trn = trainings[idx];
    if (trn.status !== 'active') {
      return result = { status: 400, body: { error: 'لا يمكن إضافة حضور لمحاضرة مغلقة' } };
    }

    const nCode = normalizeEmpCode(empCode);
    if (trn.attendees.find(a => a.empCode === nCode)) {
      return result = { status: 400, body: { error: 'الموظف مسجل حضوره بالفعل في هذه المحاضرة' } };
    }

    const employees = readEmployees();
    const emp = employees.find(e => normalizeEmpCode(e.code || e.empCode) === nCode);
    if (!emp) {
      return result = { status: 404, body: { error: 'الكود الوظيفي غير مسجل في النظام' } };
    }

    trn.attendees.push({
      empCode: nCode,
      name: emp.name,
      department: emp.department,
      attendedAt: new Date().toISOString(),
      verified: true,
      addedManuallyBy: sanitizeStr(req.user.name || req.user.username, 100)
    });

    if (writeTrainings(trainings)) {
      createNotification({
        targetEmpCode: nCode,
        type: 'training',
        title: 'تأكيد الحضور ✅',
        message: `تم تسجيل حضورك في محاضرة ${trn.title} بمعرفة مشرف السلامة`,
        link: 'tabTrainingWorker'
      });
      result = { status: 200, body: { success: true, attendees: trn.attendees } };
    } else {
      result = { status: 500, body: { error: 'حدث خطأ أثناء التسجيل' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/trainings/:id/verify-attendee', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { empCode, verified } = req.body;
  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };

    const trn = trainings[idx];
    const nCode = normalizeEmpCode(empCode);

    if (verified === false) {
      trn.attendees = trn.attendees.filter(a => a.empCode !== nCode);
    } else {
      const att = trn.attendees.find(a => a.empCode === nCode);
      if (att) att.verified = true;
    }

    if (writeTrainings(trainings)) {
      result = { status: 200, body: { success: true, attendees: trn.attendees } };
    } else {
      result = { status: 500, body: { error: 'فشل تحديث الحضور' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
