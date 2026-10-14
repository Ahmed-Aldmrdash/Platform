'use strict';

// Legacy key/value API still used by the frontend to load work permits.

const express = require('express');
const { authenticateSession, authenticateToken, requireRole } = require('../middleware/auth');
const { replyNotModified, viewerKey } = require('../middleware/http-cache');
const { enqueueWrite } = require('../data/write-queue');
const { permitsRepo, storageStore, readStorage, writeStorage } = require('../data/stores');
const { deptMatches } = require('../utils/validation');

const router = express.Router();

const PROTECTED_KEYS = ['app-users', 'users'];
const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const isValidKey = (key) => KEY_PATTERN.test(key) && key.length <= 64;

router.get(['/work-permits', '/api/work-permits'], (req, res) => {
  res.redirect('/api/storage/work-permits');
});

router.get('/api/storage/:key', authenticateSession, (req, res) => {
  const key = req.params.key;
  if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid storage key format' });
  if (PROTECTED_KEYS.includes(key)) return res.status(403).json({ error: 'غير مصرح' });

  if (req.worker) {
    if (key !== 'work-permits') return res.status(403).json({ error: 'غير مصرح' });
    if (replyNotModified(req, res, ['permits', 'mine', viewerKey(req), permitsRepo.version()])) return;
    return res.json({ key, value: JSON.stringify(permitsRepo.forEmployee(req.worker.empCode)) });
  }

  if (key === 'work-permits') {
    const scoped = ['dept_admin', 'maint_admin'].includes(req.user.role) && req.user.department;
    if (replyNotModified(req, res, ['permits', 'all', viewerKey(req), permitsRepo.version()])) return;
    const permits = scoped
      ? permitsRepo.all().filter((p) => deptMatches(p.department, req.user.department))
      : permitsRepo.all();
    return res.json({ key, value: JSON.stringify(permits) });
  }

  if (replyNotModified(req, res, ['storage', key, 'admin', storageStore.version()])) return;
  const data = readStorage();
  res.json({ key, value: data[key] || '[]' });
});

router.post('/api/storage/:key', authenticateToken, requireRole('super_admin'), async (req, res) => {
  const key = req.params.key;
  if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid storage key format' });
  if (PROTECTED_KEYS.includes(key) || key === 'work-permits') {
    return res.status(403).json({ error: 'كتابة هذا المفتاح غير مسموح بها من هنا' });
  }
  const { value } = req.body || {};
  if (value === undefined || value === null) {
    return res.status(400).json({ error: 'القيمة (value) مطلوبة في جسم الطلب' });
  }
  await enqueueWrite(async () => {
    const data = readStorage();
    data[key] = typeof value === 'string' ? value : JSON.stringify(value);
    writeStorage(data);
  });
  res.json({ success: true, key });
});

module.exports = router;
