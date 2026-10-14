'use strict';

// Monthly / quarterly safety report e-mailed automatically in the first days of the new period.

const fs = require('fs');
const config = require('../config');
const mailer = require('./mailer');
const reports = require('../documents/reports');
const { renderPrintDocument } = require('../documents/print-template');
const { makeStore } = require('../data/stores');
const { chatbotData } = require('../chatbot/data-source');
const { sanitizeStr } = require('../utils/validation');

const REPORT_LOGO_PATH = config.paths.REPORT_LOGO;

/** Report filters from a query string or a saved schedule, reduced to known fields and formats. */
function reportQueryFrom(src) {
  const q = src || {};
  const digits = (v, re) => (re.test(String(v == null ? '' : v)) ? String(v) : '');
  return {
    dept: sanitizeStr(q.dept || '', 80),
    emp: sanitizeStr(q.emp || '', 20),
    period: sanitizeStr(q.period || '', 20),
    from: sanitizeStr(q.from || '', 10),
    to: sanitizeStr(q.to || '', 10),
    year: digits(q.year, /^\d{4}$/),
    q: digits(q.q, /^[1-4]$/),
    m: digits(q.m, /^(?:[1-9]|1[0-2])$/),
  };
}

const reportScheduleStore = makeStore('report-schedule', {});
const SCHEDULE_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function readReportSchedule() {
  const s = reportScheduleStore.read() || {};
  return {
    enabled:    s.enabled === true,
    frequency:  s.frequency === 'quarterly' ? 'quarterly' : 'monthly',
    time:       SCHEDULE_TIME_RE.test(s.time || '') ? s.time : '07:00',
    recipients: Array.isArray(s.recipients) ? s.recipients : [],
    dept:       typeof s.dept === 'string' ? s.dept : '',
    lastSentKey: s.lastSentKey || null,
    lastResult:  s.lastResult || null,
  };
}

function periodsForSchedule(frequency, now = new Date()) {
  if (frequency === 'quarterly') {
    const qIdx = Math.floor(now.getMonth() / 3);
    let year = now.getFullYear(), q = qIdx;
    if (q === 0) { q = 4; year -= 1; }
    let py = year, pq = q - 1;
    if (pq === 0) { pq = 4; py -= 1; }
    return {
      key: `${year}-Q${q}`,
      query: { period: 'quarter', year: String(year), q: String(q) },
      prevQuery: { period: 'quarter', year: String(py), q: String(pq) },
    };
  }
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const p = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return {
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    query: { period: 'month', year: String(d.getFullYear()), m: String(d.getMonth() + 1) },
    prevQuery: { period: 'month', year: String(p.getFullYear()), m: String(p.getMonth() + 1) },
  };
}

function comparisonNumbers(query, dept) {
  const q = { ...query };
  if (dept) q.dept = dept;
  const prev = reports.buildSafetyReport({ data: chatbotData(), query: q, generatedBy: 'النظام' });
  if (prev.error) return null;
  return {
    hazards:       prev.hazards.total,
    hazardsOpen:   prev.hazards.open,
    permits:       prev.permits.total,
    trainingHours: prev.trainings.hours,
    penalties:     prev.penalties.total,
  };
}

async function sendScheduledReport(trigger = 'auto') {
  const s = readReportSchedule();
  if (!mailer.isConfigured()) return { sent: false, reason: 'smtp_not_configured' };
  if (!s.recipients.length) return { sent: false, reason: 'no_recipients' };

  const { key, query, prevQuery } = periodsForSchedule(s.frequency);
  const q = { ...query };
  if (s.dept) q.dept = s.dept;
  const rep = reports.buildSafetyReport({ data: chatbotData(), query: reportQueryFrom(q), generatedBy: 'إرسال تلقائي' });
  if (rep.error) return { sent: false, reason: rep.error };

  const prev = comparisonNumbers(prevQuery, s.dept);
  const prevRep = reports.buildSafetyReport({ data: chatbotData(), query: reportQueryFrom({ ...prevQuery, ...(s.dept ? { dept: s.dept } : {}) }), generatedBy: 'النظام' });
  const compare = prev ? { prev, prevLabel: (prevRep && !prevRep.error && prevRep.period && prevRep.period.label) || 'الفترة اللي قبلها' } : null;

  const htmlBody = renderPrintDocument(reports.buildReportPrint(rep, { forEmail: true, logoSrc: 'cid:elsewedy-logo', compare }));
  let logoDataUrl = '';
  try { logoDataUrl = 'data:image/png;base64,' + fs.readFileSync(REPORT_LOGO_PATH).toString('base64'); } catch { /* the logo is optional */ }
  const printable = renderPrintDocument(reports.buildReportPrint(rep, { logoSrc: logoDataUrl || undefined, compare }));

  const result = await mailer.sendMail({
    to: s.recipients.join(', '),
    subject: `تقرير السلامة ${s.frequency === 'quarterly' ? 'الربع سنوي' : 'الشهري'} — ${rep.scope.label} — ${rep.period.label}`,
    text: reports.reportPlainText(rep),
    html: htmlBody,
    attachments: [
      { filename: 'elsewedy-logo.png', path: REPORT_LOGO_PATH, cid: 'elsewedy-logo' },
      { filename: `HSE-Report-${key}.html`, content: printable, contentType: 'text/html; charset=utf-8' },
    ],
  });

  const raw = reportScheduleStore.read() || {};
  raw.lastResult = { ok: result.sent === true, at: new Date().toISOString(), trigger, key, label: rep.period.label, recipients: s.recipients };
  if (!result.sent) raw.lastResult.error = result.error || result.reason;
  else if (trigger === 'auto') raw.lastSentKey = key;
  reportScheduleStore.write(raw);
  return { ...result, key, label: rep.period.label };
}

let _scheduledReportRunning = false;
async function checkScheduledReport() {
  if (_scheduledReportRunning) return;
  const s = readReportSchedule();
  if (!s.enabled || !mailer.isConfigured() || !s.recipients.length) return;
  const now = new Date();
  const isQuarterStart = now.getMonth() % 3 === 0;
  if (s.frequency === 'quarterly' && !isQuarterStart) return;
  if (now.getDate() > 5) return;
  const [hh, mm] = s.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
  const { key } = periodsForSchedule(s.frequency, now);
  if (s.lastSentKey === key) return;

  _scheduledReportRunning = true;
  try {
    const r = await sendScheduledReport('auto');
    if (r.sent) console.log(`[report-schedule] sent ${r.label} report to ${s.recipients.join(', ')}`);
    else console.error(`[report-schedule] send failed: ${r.error || r.reason}`);
  } catch (err) {
    console.error('[report-schedule] error:', err && err.message);
  } finally {
    _scheduledReportRunning = false;
  }
}

function startReportSchedule() {
  setInterval(checkScheduledReport, 60 * 60 * 1000).unref();
}

module.exports = {
  reportQueryFrom, reportScheduleStore, readReportSchedule, sendScheduledReport, startReportSchedule, SCHEDULE_TIME_RE,
};
