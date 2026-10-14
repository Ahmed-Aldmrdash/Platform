'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const db = require('../db');
const mailer = require('../services/mailer');
const snapshotFiles = require('../services/snapshot-files');
const backups = require('../services/backups');
const stores = require('../data/stores');
const { EMAIL_RE } = require('../constants');
const { enqueueWrite } = require('../data/write-queue');
const { authenticateToken, authenticateTokenFlexible, requireRole, requireRoleStrict } = require('../middleware/auth');
const { logAuditEvent } = require('../services/audit-log');
const { encryptSecret } = require('../services/secrets');
const { loadSmtpSettings, DEFAULT_FROM_NAME } = require('../services/smtp-settings');
const { errorAlertState } = require('../services/error-alerts');
const { setDownloadFilename } = require('../utils/http');
const { normalizeEmpCode, sanitizeStr } = require('../utils/validation');

const router = express.Router();

const BACKUP_ADMIN_ROLES = ['super_admin', 'hse_admin'];
const SNAPSHOT_NAME_RE = /^hse-snapshot-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.json\.gz$/;
const BOOT_AT = Date.now();

router.get('/api/audit-log', authenticateToken, requireRole('super_admin', 'hse_admin'), (req, res) => {
  const { entityType, entityId } = req.query;
  let log = stores.readAuditLog();
  if (entityType) log = log.filter((e) => e.entityType === entityType);
  if (entityId) log = log.filter((e) => e.entityId === String(entityId));
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  res.json({ total: log.length, entries: log.slice().reverse().slice(0, limit) });
});

// Wiping a whole module keeps a gzip copy of the old data in the database first.
const CLEARABLE_MODULES = {
  hazards: { store: stores.hazardsStore, label: 'بلاغات الخطورة' },
  penalties: { store: stores.penaltiesStore, label: 'الجزاءات' },
  trainings: { store: stores.trainingsStore, label: 'التدريبات' },
  drills: { store: stores.drillsStore, label: 'تجارب الطوارئ' },
  employees: { store: stores.employeesStore, label: 'الموظفين' },
};

router.post('/api/admin/clear-module', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { module: moduleName, confirm } = req.body || {};
  if (confirm !== 'تأكيد') return res.status(400).json({ success: false, message: 'لازم تبعت تأكيد صريح لتنفيذ عملية المسح' });
  const mod = moduleName === 'permits' ? { label: 'تصاريح العمل' } : CLEARABLE_MODULES[moduleName];
  if (!mod) return res.status(400).json({ success: false, message: 'موديول غير معروف' });

  let cleared = 0;
  await enqueueWrite(async () => {
    const current = moduleName === 'permits' ? stores.permitsRepo.all() : mod.store.read();
    cleared = Array.isArray(current) ? current.length : 0;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    db.files.put(`clear-backups/${moduleName}-${stamp}.json.gz`, 'application/gzip', zlib.gzipSync(Buffer.from(JSON.stringify(current))));
    if (moduleName === 'permits') stores.permitsRepo.replaceAll([]);
    else mod.store.write([]);
  });
  logAuditEvent({ entityType: 'database', entityId: moduleName, action: 'clear_module', actor: req.user, note: `مسح كل ${mod.label} (${cleared} سجل) مع حفظ نسخة قبل المسح` });
  res.json({ success: true, cleared, module: moduleName });
});

// Full backups contain password hashes: super admin only, never viewer accounts.
router.get('/api/admin/backup/export', authenticateTokenFlexible, requireRoleStrict('super_admin'), (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  setDownloadFilename(res, `نسخة احتياطية كاملة - ${stamp}`, 'json');
  logAuditEvent({ entityType: 'database', entityId: 'full-backup', action: 'download', actor: req.user, note: 'تنزيل نسخة احتياطية كاملة' });
  res.send(JSON.stringify(db.exportAll()));
});

router.post('/api/admin/backup/import', authenticateToken, requireRoleStrict('super_admin'), async (req, res) => {
  const { backup, confirm } = req.body || {};
  if (confirm !== 'تأكيد') {
    return res.status(400).json({ error: 'لازم تبعت تأكيد صريح لاسترجاع نسخة احتياطية — هذه العملية تستبدل البيانات الحالية' });
  }
  if (!backup || typeof backup !== 'object') return res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح' });
  let result;
  await enqueueWrite(async () => {
    try {
      const summary = db.importAll(backup);
      logAuditEvent({ entityType: 'database', entityId: 'full-backup', action: 'restore', actor: req.user, note: `استرجاع ${summary.restored} مجموعة بيانات` });
      result = { status: 200, body: { success: true, ...summary } };
    } catch (err) {
      console.error('[backup] import failed:', err);
      result = { status: 500, body: { error: 'فشل استرجاع النسخة الاحتياطية — راجع سجل السيرفر للتفاصيل' } };
    }
  });
  if (result && result.status === 200) loadSmtpSettings();
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.get('/api/admin/smtp-settings', authenticateToken, requireRoleStrict('super_admin'), (req, res) => {
  let suggestedEmail = '';
  const users = stores.readUsers();
  const me = users[stores.findUserForSession(users, req.user)];
  const code = normalizeEmpCode(req.user.empCode || '');
  if (me) suggestedEmail = (me.profiles && me.profiles[code] && me.profiles[code].email) || me.email || '';
  res.json({ ...mailer.publicSettings(), suggestedEmail });
});

router.put('/api/admin/smtp-settings', authenticateToken, requireRoleStrict('super_admin'), (req, res) => {
  const b = req.body || {};
  const host = sanitizeStr(b.host || '', 120).trim();
  const port = parseInt(b.port, 10) || 587;
  const user = sanitizeStr(b.user || '', 160).trim();
  const from = sanitizeStr(b.from || '', 160).trim() || user;
  const fromName = sanitizeStr(b.fromName || '', 80).trim() || DEFAULT_FROM_NAME;
  const secure = b.secure === true || b.secure === 'true' || port === 465;
  const pass = typeof b.pass === 'string' ? b.pass.trim() : '';

  if (!host || !user) return res.status(400).json({ error: 'اكتب سيرفر الإيميل (SMTP) واسم المستخدم' });
  if (!/^[a-z0-9.-]+$/i.test(host)) return res.status(400).json({ error: 'اسم سيرفر الإيميل غير صالح' });
  if (!(port > 0 && port < 65536)) return res.status(400).json({ error: 'رقم البورت غير صالح (مثال: 587 أو 465)' });
  if (!EMAIL_RE.test(from)) return res.status(400).json({ error: 'إيميل المُرسِل غير صالح' });

  const old = stores.smtpStore.read() || {};
  const passEnc = pass ? encryptSecret(pass) : old.passEnc;
  if (!passEnc) return res.status(400).json({ error: 'اكتب باسورد الإيميل (لو Gmail لازم App Password مش باسورد الحساب)' });

  stores.smtpStore.write({ host, port, secure, user, from, fromName, passEnc, updatedAt: new Date().toISOString(), updatedBy: req.user.username });
  loadSmtpSettings();
  logAuditEvent({ entityType: 'database', entityId: 'smtp-settings', action: 'update', actor: req.user, note: `تحديث بيانات إيميل الإرسال: ${host}:${port} (${user})` });
  res.json({ success: true, ...mailer.publicSettings() });
});

router.post('/api/admin/smtp-test', authenticateToken, requireRoleStrict('super_admin'), async (req, res) => {
  if (!mailer.isConfigured()) return res.status(503).json({ error: 'اظبط بيانات الإيميل وأحفظها الأول' });
  const to = sanitizeStr((req.body && req.body.to) || '', 160).trim();
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'اكتب إيميل صحيح تستقبل عليه الرسالة التجريبية' });
  const v = await mailer.verify();
  if (!v.ok) return res.status(502).json({ error: `مش قادر أتصل بسيرفر الإيميل: ${v.error}` });
  const r = await mailer.sendMail({
    to,
    subject: 'اختبار إرسال — منصة السلامة (السويدي بوليمرز)',
    text: 'الرسالة دي اختبار من منصة السلامة والصحة المهنية. لو وصلتك يبقى إعدادات الإيميل شغالة تمام ✅',
    html: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9"><b>اختبار إرسال ✅</b><br>الرسالة دي اختبار من منصة السلامة والصحة المهنية — السويدي بوليمرز.<br>لو وصلتك يبقى إعدادات الإيميل شغالة تمام، والنسخة الاحتياطية هتوصل على المواعيد.</div>',
  });
  if (!r.sent) return res.status(502).json({ error: `فشل الإرسال: ${r.error || r.reason}` });
  logAuditEvent({ entityType: 'database', entityId: 'smtp-settings', action: 'test_email', actor: req.user, note: `إرسال إيميل تجريبي إلى ${to}` });
  res.json({ success: true, to, from: mailer.fromAddress() });
});

router.get('/api/admin/backup/email-settings', authenticateToken, requireRoleStrict('super_admin'), (req, res) => {
  res.json(backups.backupEmailSettingsResponse());
});

router.put('/api/admin/backup/email-settings', authenticateToken, requireRoleStrict('super_admin'), (req, res) => {
  const { enabled, time } = req.body || {};
  const parsed = backups.parseRecipients(req.body && req.body.recipients);
  const err = backups.recipientsError(parsed);
  if (err) return res.status(400).json({ error: err });
  if (time !== undefined && !backups.BACKUP_TIME_RE.test(String(time))) {
    return res.status(400).json({ error: 'الميعاد لازم يكون بصيغة ساعة:دقيقة (مثال 00:00)' });
  }
  if (enabled === true && !parsed.list.length) return res.status(400).json({ error: 'ضيف إيميل واحد على الأقل قبل تفعيل الإرسال اليومي' });

  const s = stores.backupEmailStore.read() || {};
  s.enabled = enabled === true;
  s.recipients = parsed.list;
  if (time !== undefined) s.time = String(time);
  stores.backupEmailStore.write(s);
  logAuditEvent({
    entityType: 'database',
    entityId: 'backup-email',
    action: 'update',
    actor: req.user,
    note: s.enabled ? `إرسال النسخة الاحتياطية يوميًا الساعة ${s.time} إلى: ${s.recipients.join(', ')}` : 'إيقاف الإرسال اليومي للنسخة الاحتياطية',
  });
  res.json({ success: true, ...backups.backupEmailSettingsResponse() });
});

router.post('/api/admin/backup/email-now', authenticateToken, requireRoleStrict('super_admin'), async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(503).json({ error: 'إيميل الإرسال مش متظبط — اظبط بيانات الإيميل من نفس الشاشة (قسم "بيانات إيميل الإرسال") وجرب تاني' });
  }
  const source = req.body && req.body.recipients !== undefined ? req.body.recipients : backups.readBackupEmailSettings().recipients;
  const parsed = backups.parseRecipients(source);
  const err = backups.recipientsError(parsed) || (parsed.list.length ? null : 'اكتب إيميل واحد على الأقل');
  if (err) return res.status(400).json({ error: err });
  try {
    const r = await backups.sendBackupEmail(parsed.list, 'manual');
    if (!r.sent) return res.status(502).json({ error: `فشل الإرسال: ${r.error || r.reason}` });
    logAuditEvent({ entityType: 'database', entityId: 'full-backup', action: 'email_backup', actor: req.user, note: `إرسال نسخة احتياطية بالإيميل إلى: ${parsed.list.join(', ')}` });
    res.json({ success: true, recipients: parsed.list, rejected: r.rejected || [], sizeKB: r.sizeKB });
  } catch (e) {
    console.error('[backup-email] manual send failed:', e);
    res.status(500).json({ error: 'فشل تجهيز النسخة الاحتياطية' });
  }
});

router.get('/api/admin/backup/snapshots', authenticateToken, requireRole(...BACKUP_ADMIN_ROLES), (req, res) => {
  const s = stores.snapshotStore.read() || {};
  res.json({
    snapshots: snapshotFiles.listSnapshots(backups.SNAPSHOT_DIR).slice(0, 40),
    lastResult: s.lastResult || null,
    lastDrill: s.lastDrill || null,
    lastDrillAt: s.lastDrillAt || null,
    volumeWarning: null,
    keepDaily: snapshotFiles.DEFAULT_KEEP_DAILY,
    keepWeekly: snapshotFiles.DEFAULT_KEEP_WEEKLY,
  });
});

router.post('/api/admin/backup/snapshot-now', authenticateToken, requireRoleStrict('super_admin'), async (req, res) => {
  const r = await backups.runSnapshot('manual');
  if (!r.ok) return res.status(500).json({ error: r.error || 'فشل حفظ النسخة' });
  logAuditEvent({ entityType: 'database', entityId: 'snapshot', action: 'create', actor: req.user, note: `نسخة احتياطية محلية: ${r.file} (${r.sizeKB} KB)` });
  res.json({ success: true, ...r });
});

router.post('/api/admin/backup/verify-snapshot', authenticateToken, requireRoleStrict(...BACKUP_ADMIN_ROLES), (req, res) => {
  const name = typeof (req.body && req.body.file) === 'string' && SNAPSHOT_NAME_RE.test(req.body.file) ? req.body.file : null;
  const r = snapshotFiles.verifySnapshot(backups.SNAPSHOT_DIR, name);
  backups.recordRestoreDrill(r);
  logAuditEvent({ entityType: 'database', entityId: 'snapshot', action: 'verify', actor: req.user, note: r.ok ? `اختبار استرجاع ناجح: ${r.file} (${r.total} سجل)` : `اختبار استرجاع فشل: ${r.error}` });
  res.json(r);
});

router.get('/api/admin/backup/snapshots/:file', authenticateTokenFlexible, requireRoleStrict('super_admin'), (req, res) => {
  const file = String(req.params.file || '');
  if (!SNAPSHOT_NAME_RE.test(file)) return res.status(400).json({ error: 'اسم ملف غير صالح' });
  const full = path.join(backups.SNAPSHOT_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'النسخة دي مش موجودة' });
  logAuditEvent({ entityType: 'database', entityId: 'snapshot', action: 'download', actor: req.user, note: `تنزيل نسخة محلية: ${file}` });
  res.download(full, file);
});

// Public and minimal on purpose, for uptime monitors.
router.get('/healthz', async (req, res) => {
  let ok = true;
  try { await db.ping(); } catch { ok = false; }
  res.status(ok ? 200 : 503).json({ ok, uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000), time: new Date().toISOString() });
});

router.get('/api/admin/health', authenticateToken, requireRole(...BACKUP_ADMIN_ROLES), async (req, res) => {
  const s = stores.snapshotStore.read() || {};
  let latencyMs = null;
  try { latencyMs = await db.ping(); } catch { latencyMs = null; }
  res.json({
    ok: latencyMs !== null,
    uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000),
    startedAt: new Date(BOOT_AT).toISOString(),
    node: process.version,
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    db: { ok: latencyMs !== null, latencyMs, ...db.status() },
    snapshots: { count: snapshotFiles.listSnapshots(backups.SNAPSHOT_DIR).length, last: s.lastResult || null, lastDrill: s.lastDrill || null },
    mail: { configured: mailer.isConfigured() },
    volumeWarning: null,
    errors: errorAlertState(),
  });
});

module.exports = router;
