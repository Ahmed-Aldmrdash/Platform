'use strict';

const crypto = require('crypto');
const express = require('express');
const { drillsStore, readDrills, writeDrills, shared } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../../middleware/auth');
const { replyNotModified, viewerKey } = require('../../middleware/http-cache');
const { normalizeEmpCode, sanitizeStr } = require('../../utils/validation');
const { createNotification } = require('../../services/notifications');

const router = express.Router();
const PIN_ROLES = ['super_admin', 'hse_admin'];

function newSessionPin() {
  return String(crypto.randomInt(1000, 10000));
}

router.get('/api/drills', authenticateToken, (req, res) => {
  const showPin = PIN_ROLES.includes(req.user.role);
  if (replyNotModified(req, res, ['drills', showPin ? 'pin' : 'nopin', drillsStore.version()])) return;
  const drills = shared.drills();
  res.json({ drills: showPin ? drills : drills.map(({ sessionPin, ...d }) => d) });
});

router.get('/api/drills/worker/:empCode', authenticateSession, (req, res) => {
  const code = req.worker ? req.worker.empCode : normalizeEmpCode(req.params.empCode);
  if (replyNotModified(req, res, ['drl-worker', viewerKey(req), code, drillsStore.version()])) return;
  const drills = shared.drills();
  const attCode = (a) => normalizeEmpCode(a.empCode || a.code || a.employeeCode || a.id || '');

  const activeSession = drills.find(t => t.status === 'active');
  const myHistory = [];
  let totalClosed = 0;
  let myAttended = 0;

  drills.forEach(drl => {
    const isClosed = drl.status === 'closed' || drl.isClosed;
    if (isClosed) totalClosed++;
    const me = (drl.attendees || []).find(a => attCode(a) === code);

    if (me) {
      if (isClosed && me.verified !== false) myAttended++;
      myHistory.push({
        date: drl.date || drl.createdAt,
        title: drl.title,
        status: me.verified === false ? '⏳ قيد المراجعة' : '✅ مؤكد',
        verified: me.verified !== false,
        attended: true
      });
    }
  });

  myHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

  let safeActiveSession = null;
  if (activeSession) {
    safeActiveSession = { ...activeSession };
    delete safeActiveSession.sessionPin;
    const meAttended = (activeSession.attendees || []).find(a => attCode(a) === code);
    safeActiveSession.attendees = meAttended ? [meAttended] : [];
  }

  res.json({
    activeSession: safeActiveSession,
    myHistory,
    totalClosed,
    myAttended
  });
});

router.post('/api/drills', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { title, targetGroup, location, date, startTime, endTime, trainer, trainerCode } = req.body || {};
  if (!title || !date || !startTime || !endTime) {
    return res.status(400).json({ error: 'البيانات الأساسية مطلوبة' });
  }

  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const newId = `DRL-${Date.now()}`;
    const newDrill = {
      id: newId,
      title: sanitizeStr(title, 200),
      trainer: sanitizeStr(trainer || '', 150),
      trainerCode: sanitizeStr(trainerCode || '', 50),
      targetGroup: sanitizeStr(targetGroup || '', 200),
      location: sanitizeStr(location || '', 200),
      date: sanitizeStr(date, 20),
      startTime: sanitizeStr(startTime, 10),
      endTime: sanitizeStr(endTime, 10),
      sessionPin: newSessionPin(),
      status: 'active',
      attendees: [],
      createdAt: new Date().toISOString()
    };
    drills.push(newDrill);
    if (writeDrills(drills)) {
      createNotification({
        targetRole: 'worker',
        targetGroup: newDrill.targetGroup,
        type: 'drill',
        title: 'تجربة تدريبية جديدة 🚨',
        message: `تجربة جديدة: ${newDrill.title} في ${newDrill.location || 'غير محدد'} - الساعة ${newDrill.startTime}`,
        link: 'tabDrillWorker'
      });

      result = { status: 201, body: { success: true, drill: newDrill } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ التجربة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/drills/:id/close', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const idx = drills.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'التجربة غير موجودة' } };

    drills[idx].status = 'closed';
    if (writeDrills(drills)) {
      createNotification({
        targetRole: 'admin',
        type: 'drill',
        title: 'إغلاق تجربة 🔒',
        message: `تم إغلاق تجربة ${drills[idx].title} بإجمالي حضور ${drills[idx].attendees.length}`,
        link: 'tabDrillAdmin'
      });

      result = { status: 200, body: { success: true, drill: drills[idx] } };
    } else {
      result = { status: 500, body: { error: 'فشل إغلاق التجربة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.delete('/api/drills/:id', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const idx = drills.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'التجربة غير موجودة' } };

    drills[idx].isDeleted = true;
    drills[idx].deletedAt = new Date().toISOString();

    if (writeDrills(drills)) {
      result = { status: 200, body: { success: true } };
    } else {
      result = { status: 500, body: { error: 'فشل عملية الحذف المؤقت' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/drills/:id/restore', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const idx = drills.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'التجربة غير موجودة' } };

    drills[idx].isDeleted = false;
    drills[idx].deletedAt = null;

    if (writeDrills(drills)) {
      result = { status: 200, body: { success: true } };
    } else {
      result = { status: 500, body: { error: 'فشل عملية الاستعادة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.delete('/api/drills/:id/permanent', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    let drills = readDrills();
    const initialLength = drills.length;
    drills = drills.filter(t => t.id !== req.params.id);

    if (drills.length < initialLength) {
      if (writeDrills(drills)) {
        result = { status: 200, body: { success: true } };
      } else {
        result = { status: 500, body: { error: 'فشل عملية الحذف النهائي' } };
      }
    } else {
      result = { status: 404, body: { error: 'التجربة غير موجودة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
