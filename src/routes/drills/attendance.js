'use strict';

const express = require('express');
const { readDrills, writeDrills, readEmployees } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../../middleware/auth');
const { attendLimiter } = require('../../middleware/rate-limits');
const { normalizeEmpCode, sanitizeStr } = require('../../utils/validation');
const { createNotification, notifyAttendance } = require('../../services/notifications');

const router = express.Router();

router.post('/api/drills/:id/attend', authenticateSession, attendLimiter, async (req, res) => {
  if (!req.worker) return res.status(403).json({ error: 'تسجيل الحضور من حساب العامل نفسه' });
  let empCode = req.worker.empCode;
  let { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'رمز الجلسة مطلوب' });

  empCode = String(empCode).trim();
  pin = String(pin).trim();

  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const idx = drills.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'التجربة غير موجودة' } };

    const drl = drills[idx];
    if (drl.status !== 'active') {
      return result = { status: 400, body: { error: 'التجربة مغلقة حالياً' } };
    }

    if (drl.sessionPin !== String(pin).trim()) {
      return result = { status: 400, body: { error: 'رمز الجلسة غير صحيح' } };
    }

    const nCode = normalizeEmpCode(empCode);
    if (drl.attendees.find(a => a.empCode === nCode)) {
      return result = { status: 400, body: { error: 'تم تسجيل حضورك بالفعل في هذه التجربة' } };
    }

    const employees = readEmployees();
    const emp = employees.find(e => normalizeEmpCode(e.code || e.empCode) === nCode);
    if (!emp) {
      return result = { status: 404, body: { error: 'الكود الوظيفي غير مسجل في النظام' } };
    }

    drl.attendees.push({
      empCode: nCode,
      name: emp.name,
      department: emp.department,
      attendedAt: new Date().toISOString(),
      verified: true
    });

    if (writeDrills(drills)) {
      notifyAttendance(drl, emp.name, { type: 'drill', link: 'tabDrillAdmin' });

      createNotification({
        targetEmpCode: nCode,
        type: 'drill',
        title: 'تأكيد الحضور ✅',
        message: `تم تسجيل وتأكيد حضورك في تجربة ${drl.title}`,
        link: 'tabDrillWorker'
      });

      result = { status: 200, body: { success: true, message: 'تم تسجيل الحضور بنجاح' } };
    } else {
      result = { status: 500, body: { error: 'حدث خطأ أثناء التسجيل' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.post('/api/drills/:id/add-attendee', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let { empCode } = req.body;
  if (!empCode || !String(empCode).trim()) {
    return res.status(400).json({ error: 'الكود الوظيفي مطلوب' });
  }
  empCode = String(empCode).trim();

  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const idx = drills.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'التجربة غير موجودة' } };

    const drl = drills[idx];
    if (drl.status !== 'active') {
      return result = { status: 400, body: { error: 'لا يمكن إضافة حضور لتجربة مغلقة' } };
    }

    const nCode = normalizeEmpCode(empCode);
    if (drl.attendees.find(a => a.empCode === nCode)) {
      return result = { status: 400, body: { error: 'الموظف مسجل حضوره بالفعل في هذه التجربة' } };
    }

    const employees = readEmployees();
    const emp = employees.find(e => normalizeEmpCode(e.code || e.empCode) === nCode);
    if (!emp) {
      return result = { status: 404, body: { error: 'الكود الوظيفي غير مسجل في النظام' } };
    }

    drl.attendees.push({
      empCode: nCode,
      name: emp.name,
      department: emp.department,
      attendedAt: new Date().toISOString(),
      verified: true,
      addedManuallyBy: sanitizeStr(req.user.name || req.user.username, 100)
    });

    if (writeDrills(drills)) {
      createNotification({
        targetEmpCode: nCode,
        type: 'drill',
        title: 'تأكيد الحضور ✅',
        message: `تم تسجيل حضورك في تجربة ${drl.title} بمعرفة مشرف السلامة`,
        link: 'tabDrillWorker'
      });
      result = { status: 200, body: { success: true, attendees: drl.attendees } };
    } else {
      result = { status: 500, body: { error: 'حدث خطأ أثناء التسجيل' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/drills/:id/verify-attendee', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { empCode, verified } = req.body;
  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const idx = drills.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'التجربة غير موجودة' } };

    const drl = drills[idx];
    const nCode = normalizeEmpCode(empCode);

    if (verified === false) {
      drl.attendees = drl.attendees.filter(a => a.empCode !== nCode);
    } else {
      const att = drl.attendees.find(a => a.empCode === nCode);
      if (att) att.verified = true;
    }

    if (writeDrills(drills)) {
      result = { status: 200, body: { success: true, attendees: drl.attendees } };
    } else {
      result = { status: 500, body: { error: 'فشل تحديث الحضور' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
