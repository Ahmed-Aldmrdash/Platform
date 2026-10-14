'use strict';

// High-risk hazard alert rules: recipients, list ordering, overdue detection and the alert e-mail.

const { renderPrintDocument, esc, localDateTime } = require('../documents/print-template');
const { buildHazardPrint } = require('../documents/print-docs');

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

const DEFAULT_RECIPIENT_CODES = ['6173', '62150', '66499'];
const BLOCKED_RECIPIENT_CODES = ['271', '6077'];
const MAX_RECIPIENTS = 8;
const DEFAULT_OVERDUE_HOURS = 48;
const MIN_OVERDUE_HOURS = 1;
const MAX_OVERDUE_HOURS = 24 * 30;

function normalizeCode(v) {
  return String(v == null ? '' : v).trim().replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
}

function normalizeEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function isHighRisk(h) {
  return String((h && h.riskLevel) || '').trim().toUpperCase() === 'H';
}

const CLOSED_STATUSES = new Set(['resolved', 'closed', 'rejected', 'rejected_by_hse', 'rejected_by_maintenance']);
function isClosedHazard(h) {
  const s = String((h && h.status) || '').toLowerCase().trim();
  if (CLOSED_STATUSES.has(s)) return true;
  return /مغلق|closed|resolved|rejected|مرفوض|تمت المعالجة/.test(s);
}

const RISK_ORDER = { H: 0, M: 1, L: 2 };
function hazardSortKey(h) {
  return [
    isClosedHazard(h) ? 1 : 0,
    RISK_ORDER[String((h && h.riskLevel) || '').toUpperCase()] ?? 3,
    -(new Date((h && (h.submittedAt || h.date)) || 0).getTime() || 0),
  ];
}
function compareHazards(a, b) {
  const ka = hazardSortKey(a), kb = hazardSortKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}
function sortHazardsForDisplay(list) {
  return [...(Array.isArray(list) ? list : [])].sort(compareHazards);
}

function seedRecipients(employees, codes = DEFAULT_RECIPIENT_CODES) {
  const byCode = new Map();
  for (const e of Array.isArray(employees) ? employees : []) {
    const code = normalizeCode(e && (e.empCode || e.code || e.id));
    if (code && !byCode.has(code)) byCode.set(code, e);
  }
  return codes.map(c => {
    const code = normalizeCode(c);
    const e = byCode.get(code) || {};
    return {
      empCode: code,
      name: String(e.name || e.fullName || '').trim(),
      email: normalizeEmail(e.email || e.mail || ''),
      enabled: true,
    };
  }).filter(r => r.empCode && !BLOCKED_RECIPIENT_CODES.includes(r.empCode));
}

function cleanRecipient(r) {
  if (!r || typeof r !== 'object') return null;
  const empCode = normalizeCode(r.empCode);
  const email = normalizeEmail(r.email);
  if (!email || !EMAIL_RE.test(email) || email.length > 120) return null;
  if (empCode && BLOCKED_RECIPIENT_CODES.includes(empCode)) return null;
  return {
    empCode,
    name: String(r.name || '').trim().slice(0, 100),
    email,
    enabled: r.enabled !== false,
  };
}

function normalizeSettings(raw, { employees } = {}) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  let recipients = Array.isArray(s.recipients) ? s.recipients.map(cleanRecipient).filter(Boolean) : null;
  let seeded = false;
  if (!recipients) {
    recipients = seedRecipients(employees).filter(r => r.email && EMAIL_RE.test(r.email));
    seeded = true;
  }
  const seen = new Set();
  recipients = recipients.filter(r => (seen.has(r.email) ? false : (seen.add(r.email), true))).slice(0, MAX_RECIPIENTS);

  const hours = Number(s.overdueHours);
  return {
    highRiskEnabled: s.highRiskEnabled !== false,
    overdueEnabled: s.overdueEnabled === true,
    overdueHours: Number.isFinite(hours) ? Math.min(MAX_OVERDUE_HOURS, Math.max(MIN_OVERDUE_HOURS, Math.round(hours))) : DEFAULT_OVERDUE_HOURS,
    requireAfterPhoto: s.requireAfterPhoto !== false,
    recipients,
    lastResult: (s.lastResult && typeof s.lastResult === 'object') ? s.lastResult : null,
    _seeded: seeded,
  };
}

function activeEmails(settings) {
  return (settings && Array.isArray(settings.recipients) ? settings.recipients : [])
    .filter(r => r && r.enabled !== false && r.email && EMAIL_RE.test(r.email))
    .filter(r => !BLOCKED_RECIPIENT_CODES.includes(normalizeCode(r.empCode)))
    .map(r => r.email);
}

function openHours(h, now = new Date()) {
  const t = new Date((h && (h.submittedAt || h.date)) || 0).getTime();
  if (!t) return 0;
  return Math.max(0, (now.getTime() - t) / 36e5);
}

function overdueHazards(hazards, { hours = DEFAULT_OVERDUE_HOURS, now = new Date() } = {}) {
  return (Array.isArray(hazards) ? hazards : []).filter(h =>
    isHighRisk(h) && !isClosedHazard(h) && !h.escalatedAt && openHours(h, now) >= hours
  );
}

const RISK_LABEL = { H: 'عالية 🔴', M: 'متوسطة 🟡', L: 'منخفضة 🟢' };

function alertSubject(hazard, kind) {
  const where = [hazard.department, hazard.area].map(x => String(x || '').trim()).filter(Boolean).join(' — ');
  const head = kind === 'overdue' ? '⏰ بلاغ خطورة عالية لسه مفتوح' : '🔴 بلاغ خطورة عالية';
  return `${head} — ${where || 'بدون موقع'} — ${hazard.id}`;
}

function alertPlainText(hazard, { kind, hours, link } = {}) {
  const lines = [
    kind === 'overdue'
      ? `تذكير: بلاغ خطورة عالية لسه مفتوح من ${Math.round(hours || 0)} ساعة.`
      : 'اتسجّل بلاغ خطورة عالية (High) على المنصة دلوقتي.',
    '',
    `رقم البلاغ: ${hazard.id}`,
    `القسم: ${hazard.department || '—'}`,
    `المكان: ${hazard.area || '—'}`,
    `المُبلِّغ: ${hazard.reporterName || '—'} (${hazard.empCode || '—'})`,
    `مستوى الخطورة: ${RISK_LABEL[String(hazard.riskLevel || '').toUpperCase()] || hazard.riskLevel || '—'}`,
    `وقت التسجيل: ${localDateTime(hazard.submittedAt) || '—'}`,
    '',
    `الوصف: ${hazard.description || '—'}`,
    `الإصابة المحتملة: ${hazard.potentialInjury || '—'}`,
    `الحل المقترح: ${hazard.proposedSolution || '—'}`,
  ];
  if (link) lines.push('', `افتح البلاغ على المنصة: ${link}`);
  return lines.join('\n');
}

function buildAlertEmailHtml(hazard, { kind, hours, logoSrc, photoSrc, link } = {}) {
  const doc = buildHazardPrint(hazard, { photoAbsUrl: photoSrc || null });
  const banner = kind === 'overdue'
    ? `بلاغ خطورة عالية لسه مفتوح من ${Math.round(hours || 0)} ساعة — محتاج متابعة فورية.`
    : 'بلاغ خطورة عالية (High) اتسجّل دلوقتي على المنصة — محتاج مراجعة فورية.';

  doc.sections = [
    {
      kind: 'html',
      html:
        `<div style="border:2px solid #DC2626;background:#FEF2F2;border-radius:8px;padding:10px 14px;margin:0 0 10px">` +
        `<div style="color:#991B1B;font-weight:700;font-size:13pt">${esc(banner)}</div>` +
        (link ? `<div style="margin-top:6px;font-size:10pt"><a href="${esc(link)}" style="color:#991B1B">افتح البلاغ على المنصة</a></div>` : '') +
        `</div>`,
    },
    ...doc.sections.filter(s => s.kind !== 'signatures'),
  ];
  doc.footerNote = 'الإيميل ده بيتبعت تلقائيًا من منصة السلامة لبلاغات الخطورة العالية فقط.';
  return renderPrintDocument({ ...doc, forEmail: true, logoSrc: logoSrc || undefined });
}

module.exports = {
  EMAIL_RE,
  DEFAULT_RECIPIENT_CODES,
  BLOCKED_RECIPIENT_CODES,
  DEFAULT_OVERDUE_HOURS,
  MAX_RECIPIENTS,
  normalizeCode,
  isHighRisk,
  isClosedHazard,
  compareHazards,
  sortHazardsForDisplay,
  seedRecipients,
  normalizeSettings,
  activeEmails,
  openHours,
  overdueHazards,
  alertSubject,
  alertPlainText,
  buildAlertEmailHtml,
};
