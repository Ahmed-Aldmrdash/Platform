'use strict';

const zlib = require('zlib');
const config = require('../config');
const db = require('../db');
const mailer = require('./mailer');
const snapshotFiles = require('./snapshot-files');
const { EMAIL_RE } = require('../constants');
const { backupEmailStore, snapshotStore, permitsRepo } = require('../data/stores');

const SNAPSHOT_DIR = config.paths.SNAPSHOT_DIR;
const BACKUP_EMAIL_MAX_RECIPIENTS = 20;
const BACKUP_EMAIL_RETRY_MS = 30 * 60 * 1000;
const BACKUP_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseRecipients(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;،]+/);
  const list = [...new Set(raw.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))];
  return { list, invalid: list.filter((e) => !EMAIL_RE.test(e)) };
}

function recipientsError({ list, invalid }) {
  if (invalid.length) return `إيميل غير صحيح: ${invalid.join('، ')}`;
  if (list.length > BACKUP_EMAIL_MAX_RECIPIENTS) return `أقصى عدد ${BACKUP_EMAIL_MAX_RECIPIENTS} إيميل`;
  return null;
}

function readBackupEmailSettings() {
  const s = backupEmailStore.read() || {};
  return {
    enabled: s.enabled === true,
    recipients: Array.isArray(s.recipients) ? s.recipients : [],
    time: BACKUP_TIME_RE.test(s.time || '') ? s.time : '00:00',
    lastSentDate: s.lastSentDate || null,
    lastResult: s.lastResult || null,
  };
}

function backupEmailSettingsResponse() {
  return { ...readBackupEmailSettings(), smtpConfigured: mailer.isConfigured(), from: mailer.isConfigured() ? mailer.fromAddress() : '' };
}

/** Emails the full backup (gzip JSON, restorable from the admin screen as-is). */
async function sendBackupEmail(recipients, trigger) {
  const now = new Date();
  const backup = db.exportAll();
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(backup)));
  const sizeKB = Math.round(gz.length / 1024);
  const c = backup.collections || {};
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

  const result = await mailer.sendMail({
    to: recipients.join(', '),
    subject: `نسخة احتياطية - منصة السلامة HSE - ${localDateKey(now)}`,
    text: [
      `نسخة احتياطية كاملة من منصة السلامة (HSE Platform) — ${now.toLocaleString('ar-EG')}`,
      `نوع الإرسال: ${trigger === 'daily' ? 'يومي تلقائي' : 'يدوي من المنصة'}`,
      '',
      `الملف المرفق فيه كل بيانات النظام: ${permitsRepo.count()} تصريح عمل، ${len(c.hazards)} بلاغ خطورة، ${len(c.employees)} موظف، ${len(c.trainings)} محاضرة تدريب، ${len(c.drills)} تجربة طوارئ، ${len(c.penalties)} جزاء.`,
      '',
      'للاسترجاع: سجل التدقيق ← "استرجاع من نسخة احتياطية" ← اختار الملف المرفق زي ما هو (.json.gz).',
    ].join('\n'),
    attachments: [{ filename: `hse-backup-${localDateKey(now)}_${hhmm}.json.gz`, content: gz, contentType: 'application/gzip' }],
  });

  const s = backupEmailStore.read() || {};
  s.lastResult = { ok: result.sent, at: now.toISOString(), trigger, recipients, sizeKB };
  if (!result.sent) s.lastResult.error = result.error || result.reason;
  if (trigger === 'daily') {
    s.lastDailyAttemptAt = now.toISOString();
    if (result.sent) s.lastSentDate = localDateKey(now);
  }
  backupEmailStore.write(s);
  return { ...result, sizeKB };
}

let backupEmailRunning = false;

/** Checked every minute: sends today's backup once the configured time has passed. */
async function runDailyBackupEmail() {
  if (backupEmailRunning || !mailer.isConfigured()) return;
  const s = readBackupEmailSettings();
  if (!s.enabled || !s.recipients.length) return;
  const now = new Date();
  const [hh, mm] = s.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
  if (s.lastSentDate === localDateKey(now)) return;
  const lastAttempt = (backupEmailStore.read() || {}).lastDailyAttemptAt;
  if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < BACKUP_EMAIL_RETRY_MS) return;
  backupEmailRunning = true;
  try {
    const r = await sendBackupEmail(s.recipients, 'daily');
    if (r.sent) console.log(`[backup-email] daily backup sent to ${s.recipients.join(', ')} (${r.sizeKB} KB)`);
    else console.error(`[backup-email] daily send failed: ${r.error || r.reason} — retrying in 30 minutes`);
  } catch (err) {
    console.error('[backup-email] daily send error:', err);
  } finally {
    backupEmailRunning = false;
  }
}

let snapshotRunning = false;

/** Writes a gzip snapshot to DATA_DIR/snapshots and prunes old ones. */
async function runSnapshot(trigger = 'daily') {
  if (snapshotRunning) return { ok: false, error: 'نسخة تانية شغالة دلوقتي' };
  snapshotRunning = true;
  try {
    const r = snapshotFiles.writeSnapshot(SNAPSHOT_DIR, db.exportAll);
    const s = snapshotStore.read() || {};
    s.lastResult = { ...r, at: new Date().toISOString(), trigger };
    if (r.ok) s.lastDate = snapshotFiles.localDateKey();
    snapshotStore.write(s);
    if (r.ok) console.log(`[backup] snapshot ${r.file} (${r.sizeKB} KB)${r.removed.length ? `, pruned ${r.removed.length}` : ''}`);
    else console.error(`[backup] snapshot failed: ${r.error}`);
    return r;
  } finally {
    snapshotRunning = false;
  }
}

function checkDailySnapshot() {
  const s = snapshotStore.read() || {};
  if (s.lastDate === snapshotFiles.localDateKey()) return;
  runSnapshot('daily').catch((err) => console.error('[backup] snapshot error:', err && err.message));
}

function recordRestoreDrill(result) {
  const s = snapshotStore.read() || {};
  s.lastDrillAt = new Date().toISOString();
  s.lastDrill = result;
  snapshotStore.write(s);
}

/** Weekly check that the newest snapshot can actually be read back. */
function runRestoreDrill() {
  const s = snapshotStore.read() || {};
  const last = s.lastDrillAt ? new Date(s.lastDrillAt).getTime() : 0;
  if (Date.now() - last < 7 * 864e5) return;
  const r = snapshotFiles.verifySnapshot(SNAPSHOT_DIR);
  recordRestoreDrill(r);
  if (r.ok) console.log(`[backup] restore drill passed: ${r.file} (${r.total} records)`);
  else console.error(`[backup] restore drill failed: ${r.error}`);
}

function startBackupSchedules() {
  setInterval(runDailyBackupEmail, 60 * 1000).unref();
  setTimeout(checkDailySnapshot, 30 * 1000).unref();
  setInterval(checkDailySnapshot, 60 * 60 * 1000).unref();
  setInterval(runRestoreDrill, 6 * 60 * 60 * 1000).unref();
}

module.exports = {
  SNAPSHOT_DIR,
  BACKUP_TIME_RE,
  parseRecipients,
  recipientsError,
  readBackupEmailSettings,
  backupEmailSettingsResponse,
  sendBackupEmail,
  runSnapshot,
  recordRestoreDrill,
  startBackupSchedules,
};
