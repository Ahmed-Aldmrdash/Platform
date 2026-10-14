'use strict';

const express = require('express');
const { readEmployees, readTrainingRequests, writeTrainingRequests } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../../middleware/auth');
const { trainingRequestLimiter } = require('../../middleware/rate-limits');
const { normalizeEmpCode, sanitizeStr } = require('../../utils/validation');
const { createNotification } = require('../../services/notifications');

const router = express.Router();
function notifyAdminsNewTrainingRequest(reqRecord) {
  createNotification({
    targetRole: 'hse_admin',
    type: 'training_request',
    title: '🎓 طلب محاضرة جديد',
    message: `${reqRecord.workerName || reqRecord.empCode} طلب محاضرة: ${reqRecord.topicTitle}`,
    link: 'tabTrainingAdmin'
  });
  createNotification({
    targetRole: 'super_admin',
    type: 'training_request',
    title: '🎓 طلب محاضرة جديد',
    message: `${reqRecord.workerName || reqRecord.empCode} طلب محاضرة: ${reqRecord.topicTitle}`,
    link: 'tabTrainingAdmin'
  });
}

router.post('/api/training-requests', authenticateSession, trainingRequestLimiter, (req, res) => {
  if (!req.worker) return res.status(403).json({ error: 'الخاصية دي للعمال بس' });
  const topicTitle = sanitizeStr((req.body || {}).topicTitle, 200);
  const note = sanitizeStr((req.body || {}).note, 500);
  if (!topicTitle) return res.status(400).json({ error: 'اكتب اسم المحاضرة المطلوبة' });

  const empCode = req.worker.empCode;
  const employees = readEmployees();
  const emp = employees.find(e => normalizeEmpCode(e.code || e.empCode) === normalizeEmpCode(empCode));

  enqueueWrite(async () => {
    const requests = readTrainingRequests();
    const newReq = {
      id: `TRQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      empCode: normalizeEmpCode(empCode),
      workerName: emp ? emp.name : (req.worker.name || ''),
      department: emp ? emp.department : '',
      topicTitle,
      note,
      status: 'pending',
      responseNote: '',
      respondedBy: '',
      respondedAt: null,
      createdAt: new Date().toISOString()
    };
    requests.push(newReq);
    writeTrainingRequests(requests);
    notifyAdminsNewTrainingRequest(newReq);
    res.status(201).json({ success: true, request: newReq });
  });
});

router.get('/api/training-requests/mine', authenticateSession, (req, res) => {
  if (!req.worker) return res.status(403).json({ error: 'الخاصية دي للعمال بس' });
  const code = normalizeEmpCode(req.worker.empCode);
  const mine = readTrainingRequests()
    .filter(r => r.empCode === code)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ requests: mine });
});

router.get('/api/training-requests', authenticateToken, requireRole('super_admin', 'hse_admin'), (req, res) => {
  const requests = readTrainingRequests().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ requests });
});

router.patch('/api/training-requests/:id', authenticateToken, requireRole('super_admin', 'hse_admin'), (req, res) => {
  const { status, responseNote } = req.body || {};
  if (!['scheduled', 'declined', 'pending', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة' });
  }
  enqueueWrite(async () => {
    const requests = readTrainingRequests();
    const idx = requests.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'الطلب غير موجود' });

    requests[idx].status = status;
    requests[idx].responseNote = sanitizeStr(responseNote, 500);
    requests[idx].respondedBy = req.user.name || req.user.username;
    requests[idx].respondedAt = new Date().toISOString();
    writeTrainingRequests(requests);

    const label = status === 'scheduled' ? 'هيتم جدولتها قريبًا 🗓️'
      : status === 'completed' ? 'اتعملت فعليًا 🎉'
      : status === 'declined' ? 'مش هينفذ حاليًا' : 'قيد المراجعة';
    createNotification({
      targetEmpCode: requests[idx].empCode,
      type: 'training_request',
      title: 'رد على طلب المحاضرة 🎓',
      message: `طلبك لمحاضرة "${requests[idx].topicTitle}": ${label}${responseNote ? ' - ' + sanitizeStr(responseNote, 200) : ''}`,
      link: 'tabTrainingWorker'
    });

    res.json({ success: true, request: requests[idx] });
  });
});

function autoCompleteMatchingTrainingRequests(title) {
  const wanted = String(title || '').trim().toLowerCase();
  if (!wanted) return;
  enqueueWrite(async () => {
    const requests = readTrainingRequests();
    let changed = false;
    requests.forEach(r => {
      if (['pending', 'scheduled'].includes(r.status) && String(r.topicTitle || '').trim().toLowerCase() === wanted) {
        r.status = 'completed';
        r.respondedAt = new Date().toISOString();
        changed = true;
        createNotification({
          targetEmpCode: r.empCode,
          type: 'training_request',
          title: 'محاضرتك اتعملت 🎉',
          message: `طلبك لمحاضرة "${r.topicTitle}" تم تنفيذه — المحاضرة اتعملت فعليًا.`,
          link: 'tabTrainingWorker'
        });
      }
    });
    if (changed) writeTrainingRequests(requests);
  });
}

module.exports = { router, autoCompleteMatchingTrainingRequests };
