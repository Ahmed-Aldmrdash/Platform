'use strict';

const express = require('express');
const config = require('../config');
const fs = require('fs');
const mailer = require('../services/mailer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const reports = require('../documents/reports');
const { authenticateToken, authenticateTokenFlexible, requireRole } = require('../middleware/auth');
const { sanitizeStr } = require('../utils/validation');
const { logAuditEvent } = require('../services/audit-log');
const { parseRecipients } = require('../services/backups');
const { chatbotData } = require('../chatbot/data-source');
const { printErrorPage, sendPrintPage } = require('../documents/pages');
const { renderPrintDocument } = require('../documents/print-template');
const { EMAIL_RE } = require('../constants');
const {
  reportQueryFrom, reportScheduleStore, readReportSchedule, sendScheduledReport, SCHEDULE_TIME_RE,
} = require('../services/report-schedule');
const REPORT_LOGO_PATH = config.paths.REPORT_LOGO;

const router = express.Router();
const REPORT_ROLES = ['super_admin', 'hse_admin'];
const REPORT_EMAIL_ROLES = ['super_admin', 'hse_admin', 'hse_director', 'ceo'];

function reportActorName(user) {
  return (user && (user.fullName || user.name || user.username)) || '';
}

router.get('/api/reports/options', authenticateToken, requireRole(...REPORT_ROLES), (req, res) => {
  try {
    const data = chatbotData();
    res.json({ departments: reports.listDepartments(data), years: reports.listYears(data), mailConfigured: mailer.isConfigured() });
  } catch (err) {
    console.error('[reports] options failed:', err);
    res.status(500).json({ error: 'تعذّر تحميل خيارات التقرير' });
  }
});

router.get('/print/report', authenticateTokenFlexible, requireRole(...REPORT_ROLES), (req, res) => {
  try {
    const rep = reports.buildSafetyReport({ data: chatbotData(), query: reportQueryFrom(req.query), generatedBy: reportActorName(req.user) });
    if (rep.error) return res.status(400).type('html').send(printErrorPage(rep.error));
    const doc = reports.buildReportPrint(rep, { autoPrint: req.query.autoprint === '1' });
    if (req.query.embed === '1') doc.forEmail = false;
    let html = renderPrintDocument(doc);
    if (req.query.embed === '1') html = html.replace(/<div class="toolbar no-print">[\s\S]*?<\/div>/, '');
    sendPrintPage(res, html);
  } catch (err) {
    console.error('[reports] print failed:', err);
    res.status(500).type('html').send(printErrorPage('حصل خطأ أثناء تجهيز التقرير.'));
  }
});

const reportEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `rpt:${(req.user && (req.user.id || req.user.username)) || ipKeyGenerator(req.ip)}`,
  message: { error: 'بعت تقارير كتير في ساعة واحدة — استنى شوية وحاول تاني' },
});

router.post('/api/reports/email', authenticateToken, requireRole(...REPORT_EMAIL_ROLES), reportEmailLimiter, async (req, res) => {
  try {
    const raw = String((req.body && req.body.recipients) || '').trim();
    const recipients = raw.split(/[\s,;،]+/).map(s => s.trim()).filter(Boolean);
    if (!recipients.length) return res.status(400).json({ error: 'اكتب الإيميل اللي هيتبعتله التقرير' });
    if (recipients.length > 5) return res.status(400).json({ error: 'أقصى عدد 5 إيميلات في المرة' });
    const bad = recipients.find(r => r.length > 120 || !EMAIL_RE.test(r));
    if (bad) return res.status(400).json({ error: `الإيميل ده مش صحيح: ${bad}` });
    if (!mailer.isConfigured()) {
      return res.status(503).json({ error: 'إعدادات الإيميل (SMTP) مش متظبطة — اظبطها الأول من شاشة النسخ الاحتياطي', notConfigured: true });
    }

    const rep = reports.buildSafetyReport({ data: chatbotData(), query: reportQueryFrom(req.body && req.body.query), generatedBy: reportActorName(req.user) });
    if (rep.error) return res.status(400).json({ error: rep.error });

    const htmlBody = renderPrintDocument(reports.buildReportPrint(rep, { forEmail: true, logoSrc: 'cid:elsewedy-logo' }));
    let logoDataUrl = '';
    try { logoDataUrl = 'data:image/png;base64,' + fs.readFileSync(REPORT_LOGO_PATH).toString('base64'); } catch { /* the logo is optional */ }
    const printable = renderPrintDocument(reports.buildReportPrint(rep, { logoSrc: logoDataUrl || undefined }));
    const stamp = new Date().toISOString().slice(0, 10);

    const result = await mailer.sendMail({
      to: recipients.join(', '),
      subject: `تقرير السلامة والصحة المهنية — ${rep.scope.label} — ${rep.period.label}`,
      text: reports.reportPlainText(rep),
      html: htmlBody,
      attachments: [
        { filename: 'elsewedy-logo.png', path: REPORT_LOGO_PATH, cid: 'elsewedy-logo' },
        { filename: `HSE-Report-${stamp}.html`, content: printable, contentType: 'text/html; charset=utf-8' },
      ],
    });
    if (!result.sent) {
      return res.status(502).json({ error: 'السيرفر ماقدرش يبعت الإيميل — راجع إعدادات SMTP', reason: result.reason });
    }
    logAuditEvent({
      entityType: 'report', entityId: 'safety-report', action: 'email', actor: req.user,
      note: `إرسال تقرير (${rep.scope.label} — ${rep.period.label}) إلى: ${recipients.join(', ')}`,
    });
    res.json({ success: true, sentTo: recipients });
  } catch (err) {
    console.error('[reports] email failed:', err);
    res.status(500).json({ error: 'حصل خطأ أثناء إرسال التقرير' });
  }
});

router.get('/api/reports/schedule', authenticateToken, requireRole(...REPORT_EMAIL_ROLES), (req, res) => {
  res.json({ ...readReportSchedule(), smtpConfigured: mailer.isConfigured() });
});

router.put('/api/reports/schedule', authenticateToken, requireRole('super_admin', 'hse_admin'), (req, res) => {
  const b = req.body || {};
  const parsed = parseRecipients(b.recipients);
  if (parsed.invalid.length) return res.status(400).json({ error: `إيميل غير صحيح: ${parsed.invalid.join('، ')}` });
  if (parsed.list.length > 5) return res.status(400).json({ error: 'أقصى عدد 5 إيميلات' });
  if (b.enabled === true && !parsed.list.length) return res.status(400).json({ error: 'ضيف إيميل واحد على الأقل قبل تفعيل الإرسال التلقائي' });
  if (b.time !== undefined && !SCHEDULE_TIME_RE.test(String(b.time))) return res.status(400).json({ error: 'الميعاد لازم يكون بصيغة ساعة:دقيقة (مثال 07:00)' });

  const raw = reportScheduleStore.read() || {};
  const saved = {
    ...raw,
    enabled:    b.enabled === true,
    frequency:  b.frequency === 'quarterly' ? 'quarterly' : 'monthly',
    time:       b.time !== undefined ? String(b.time) : (raw.time || '07:00'),
    recipients: parsed.list,
    dept:       sanitizeStr(b.dept || '', 100),
    updatedAt:  new Date().toISOString(),
    updatedBy:  req.user.username,
  };
  if (!reportScheduleStore.write(saved)) return res.status(500).json({ error: 'فشل حفظ الإعدادات' });
  logAuditEvent({
    entityType: 'report', entityId: 'schedule', action: 'update', actor: req.user,
    note: saved.enabled
      ? `إرسال التقرير ${saved.frequency === 'quarterly' ? 'ربع سنوي' : 'شهري'} الساعة ${saved.time} إلى: ${saved.recipients.join(', ')}`
      : 'إيقاف الإرسال التلقائي للتقرير',
  });
  res.json({ success: true, ...readReportSchedule(), smtpConfigured: mailer.isConfigured() });
});

router.post('/api/reports/schedule/send-now', authenticateToken, requireRole('super_admin', 'hse_admin'), reportEmailLimiter, async (req, res) => {
  if (!mailer.isConfigured()) return res.status(503).json({ error: 'إعدادات الإيميل (SMTP) مش متظبطة', notConfigured: true });
  const s = readReportSchedule();
  if (!s.recipients.length) return res.status(400).json({ error: 'احفظ إيميل واحد على الأقل الأول' });
  try {
    const r = await sendScheduledReport('manual');
    if (!r.sent) return res.status(502).json({ error: `فشل الإرسال: ${r.error || r.reason}` });
    logAuditEvent({ entityType: 'report', entityId: 'schedule', action: 'email', actor: req.user, note: `إرسال تجريبي للتقرير الدوري (${r.label}) إلى: ${s.recipients.join(', ')}` });
    res.json({ success: true, sentTo: s.recipients, label: r.label });
  } catch (err) {
    console.error('[report-schedule] manual failed:', err);
    res.status(500).json({ error: 'حصل خطأ أثناء الإرسال' });
  }
});

module.exports = router;
