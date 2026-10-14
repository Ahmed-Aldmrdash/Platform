'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../../config');
const { readTrainings, writeTrainings } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { clampInt, sanitizeStr } = require('../../utils/validation');
const { MAX_RECORDING_UPLOAD_BYTES, DEFAULT_REVIEW_WINDOW_DAYS } = require('./shared');

const TRAINING_UPLOADS_DIR = config.paths.TRAINING_UPLOADS_DIR;

const router = express.Router();

router.post('/api/trainings/:id/recording', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { videoUrl } = req.body || {};
  if (!videoUrl || !String(videoUrl).trim()) {
    return res.status(400).json({ error: 'حط رابط الفيديو (لرفع ملف مباشر استخدم /recording/upload)' });
  }
  const url = String(videoUrl).trim();
  if (!/^https:\/\/[^\s]+$/.test(url) || url.length > 2000) {
    return res.status(400).json({ error: 'رابط الفيديو لازم يكون رابط https صالح' });
  }

  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };
    trainings[idx].recording = {
      url,
      addedAt: new Date().toISOString(),
      addedBy: sanitizeStr(req.user.name || req.user.username, 100)
    };
    if (writeTrainings(trainings)) {
      result = { status: 200, body: { success: true, recording: trainings[idx].recording } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ التسجيل' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.post('/api/trainings/:id/recording/upload', authenticateToken, requireRole('super_admin', 'hse_admin'), (req, res) => {
  const trainings = readTrainings();
  const trn = trainings.find(t => t.id === req.params.id);
  if (!trn) return res.status(404).json({ error: 'المحاضرة غير موجودة' });

  const extRaw = String(req.query.ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = /^(mp4|webm|mov|mkv|avi|m4v)$/.test(extRaw) ? extRaw : 'mp4';
  const filename = `TRNREC-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const filepath = path.join(TRAINING_UPLOADS_DIR, filename);
  const writeStream = fs.createWriteStream(filepath);

  let received = 0;
  let failed = false;
  const cleanupAndFail = (status, error) => {
    if (failed) return;
    failed = true;
    try { writeStream.destroy(); } catch { /* already closed */ }
    fs.unlink(filepath, () => {});
    if (!res.headersSent) res.status(status).json({ error });
  };

  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_RECORDING_UPLOAD_BYTES) {
      cleanupAndFail(413, 'حجم الفيديو أكبر من الحد المسموح (~1.5 جيجا) — استخدم رابط فيديو خارجي بدل كده');
      req.destroy();
    }
  });
  req.on('error', () => cleanupAndFail(500, 'حصل خطأ أثناء استقبال الفيديو، حاول تاني'));
  writeStream.on('error', (err) => {
    console.error('Error writing training recording stream:', err);
    cleanupAndFail(500, 'فشل حفظ ملف الفيديو على السيرفر');
  });

  writeStream.on('finish', async () => {
    if (failed) return;
    const finalUrl = `/uploads/trainings/${filename}`;
    let result;
    await enqueueWrite(async () => {
      const list = readTrainings();
      const idx = list.findIndex(t => t.id === req.params.id);
      if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };
      list[idx].recording = {
        url: finalUrl,
        addedAt: new Date().toISOString(),
        addedBy: sanitizeStr(req.user.name || req.user.username, 100)
      };
      if (writeTrainings(list)) {
        result = { status: 200, body: { success: true, recording: list[idx].recording } };
      } else {
        result = { status: 500, body: { error: 'فشل حفظ بيانات التسجيل' } };
      }
    });
    res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
  });

  req.pipe(writeStream);
});

router.put('/api/trainings/:id/review-window', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const days = clampInt(req.body && req.body.days, 0, 365, DEFAULT_REVIEW_WINDOW_DAYS);
  let result;
  await enqueueWrite(async () => {
    const trainings = readTrainings();
    const idx = trainings.findIndex(t => t.id === req.params.id);
    if (idx === -1) return result = { status: 404, body: { error: 'المحاضرة غير موجودة' } };
    trainings[idx].reviewWindowDays = days;
    if (writeTrainings(trainings)) {
      result = { status: 200, body: { success: true, reviewWindowDays: days } };
    } else {
      result = { status: 500, body: { error: 'فشل الحفظ' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
