'use strict';

const mailer = require('./mailer');
const { EMAIL_RE } = require('../constants');
const { readBackupEmailSettings } = require('./backups');

// The first unexpected error emails the platform owner right away; after that
// at most one email per hour, however often it repeats.
const COOLDOWN_MS = 60 * 60 * 1000;
const state = { total: 0, since: new Date().toISOString(), lastAt: null, lastMessage: '', lastPath: '', sentAt: 0, suppressed: 0, lastSendOk: null };

function errorAlertState() {
  return {
    total: state.total,
    since: state.since,
    lastAt: state.lastAt,
    lastPath: state.lastPath,
    lastMessage: String(state.lastMessage || '').slice(0, 300),
    suppressed: state.suppressed,
    lastSendOk: state.lastSendOk,
  };
}

/** Backup recipients, falling back to the sending account itself. */
function recipients() {
  const s = readBackupEmailSettings();
  if (s.recipients && s.recipients.length) return s.recipients.slice(0, 5);
  const from = mailer.isConfigured() ? mailer.fromAddress() : '';
  const m = /<([^>]+)>/.exec(from);
  const addr = (m ? m[1] : from).trim();
  return EMAIL_RE.test(addr) ? [addr] : [];
}

function noteServerError(err, req) {
  state.total += 1;
  state.lastAt = new Date().toISOString();
  state.lastMessage = (err && (err.message || String(err))) || 'خطأ غير معروف';
  state.lastPath = req ? `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0].slice(0, 200)}` : '';

  if (!mailer.isConfigured()) return;
  if (Date.now() - state.sentAt < COOLDOWN_MS) {
    state.suppressed += 1;
    return;
  }
  const to = recipients();
  if (!to.length) return;
  const suppressed = state.suppressed;
  state.sentAt = Date.now();
  state.suppressed = 0;

  const stack = String((err && err.stack) || '').split('\n').slice(0, 12).join('\n');
  setImmediate(() => {
    mailer.sendMail({
      to: to.join(', '),
      subject: `⚠️ خطأ في منصة السلامة — ${state.lastPath || 'السيرفر'}`,
      text: [
        'حصل خطأ غير متوقع في منصة السلامة (HSE).',
        '',
        `الوقت: ${new Date().toLocaleString('ar-EG')}`,
        `المكان: ${state.lastPath || 'خارج طلب (خطأ عام في السيرفر)'}`,
        `الرسالة: ${state.lastMessage}`,
        `إجمالي الأخطاء من وقت تشغيل السيرفر: ${state.total}`,
        suppressed ? `(${suppressed} خطأ تاني اتمنع إرساله في آخر ساعة عشان ما يغرقش الإيميل)` : '',
        '',
        'تفاصيل تقنية:',
        stack || '—',
        '',
        'الرسالة دي بتتبعت مرة واحدة كل ساعة على الأكتر.',
      ].filter(Boolean).join('\n'),
    })
      .then((r) => { state.lastSendOk = r.sent === true; })
      .catch((e) => {
        state.lastSendOk = false;
        console.error('[error-alert] send failed:', e && e.message);
      });
  });
}

module.exports = { noteServerError, errorAlertState };
