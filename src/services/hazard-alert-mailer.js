'use strict';

const config = require('../config');
const mailer = require('./mailer');
const hazardAlerts = require('./hazard-alerts');
const { readHazardPhoto } = require('./hazard-photos');
const { hazardAlertStore, readEmployees, readHazards, writeHazards } = require('../data/stores');
const { enqueueWrite } = require('../data/write-queue');

let recipientsSeeded = false;

/** Alert settings; on first use the recipient list is seeded from the employee directory. */
function readHazardAlertSettings() {
  const raw = hazardAlertStore.read() || {};
  const s = hazardAlerts.normalizeSettings(raw, { employees: readEmployees() });
  if (s._seeded && !recipientsSeeded) {
    recipientsSeeded = true;
    if (s.recipients.length) {
      hazardAlertStore.write({
        ...raw,
        recipients: s.recipients,
        highRiskEnabled: s.highRiskEnabled,
        overdueEnabled: s.overdueEnabled,
        overdueHours: s.overdueHours,
      });
    }
  }
  delete s._seeded;
  return s;
}

function markRecipientsConfigured() {
  recipientsSeeded = true;
}

function hazardAlertResponse() {
  return {
    ...readHazardAlertSettings(),
    smtpConfigured: mailer.isConfigured(),
    from: mailer.isConfigured() ? mailer.fromAddress() : '',
    blockedCodes: hazardAlerts.BLOCKED_RECIPIENT_CODES,
    maxRecipients: hazardAlerts.MAX_RECIPIENTS,
  };
}

function hazardLink() {
  return /^https?:\/\/\S+$/i.test(config.publicBaseUrl) ? `${config.publicBaseUrl}/#tabSupHazard` : '';
}

/** kind: 'new' (high-risk report), 'overdue' (escalation), 'forward' (sent by hand to `to`) or 'test'. */
async function sendHazardAlertEmail(hazard, { kind = 'new', hours = 0, to = null, by = '', note = '' } = {}) {
  if (!mailer.isConfigured()) return { sent: false, reason: 'smtp_not_configured' };
  const settings = readHazardAlertSettings();
  const recipients = to && to.length ? to : hazardAlerts.activeEmails(settings);
  if (!recipients.length) return { sent: false, reason: 'no_recipients' };

  // Inline attachments: mail clients block remote images.
  const attachments = [{ filename: 'elsewedy-logo.png', path: config.paths.REPORT_LOGO, cid: 'elsewedy-logo' }];
  let photoSrc = '';
  const photo = await readHazardPhoto(hazard.photoUrl).catch(() => null);
  if (photo) {
    const ext = String(photo.contentType).split('/')[1] || 'jpg';
    attachments.push({ filename: `hazard-photo.${ext}`, content: photo.buffer, contentType: photo.contentType, cid: 'hazard-photo' });
    photoSrc = 'cid:hazard-photo';
  }

  const opts = { kind, hours, by, note, logoSrc: 'cid:elsewedy-logo', photoSrc, link: hazardLink() };
  const result = await mailer.sendMail({
    to: recipients.join(', '),
    subject: (kind === 'test' ? '[تجربة] ' : '') + hazardAlerts.alertSubject(hazard, kind),
    text: hazardAlerts.alertPlainText(hazard, opts),
    html: hazardAlerts.buildAlertEmailHtml(hazard, opts),
    attachments,
  });

  // The alert settings screen shows the last automatic alert; hand-forwarded reports aren't part of it.
  if (kind === 'forward') return { ...result, recipients };
  const raw = hazardAlertStore.read() || {};
  raw.lastResult = { ok: result.sent === true, at: new Date().toISOString(), kind, hazardId: hazard.id, recipients };
  if (!result.sent) raw.lastResult.error = result.error || result.reason;
  hazardAlertStore.write(raw);
  return { ...result, recipients };
}

/** Fire-and-forget: never delays the request that triggered it. */
function queueHazardAlertEmail(hazard, opts) {
  setImmediate(() => {
    sendHazardAlertEmail(hazard, opts)
      .then((r) => {
        if (r.sent) console.log(`[hazard-alert] ${opts && opts.kind === 'overdue' ? 'escalation' : 'high-risk alert'} for ${hazard.id} sent to ${r.recipients.join(', ')}`);
        else if (r.reason !== 'no_recipients' && r.reason !== 'smtp_not_configured') console.error(`[hazard-alert] ${hazard.id}: ${r.error || r.reason}`);
      })
      .catch((err) => console.error('[hazard-alert] send error:', err && err.message));
  });
}

let escalationRunning = false;

/** Hourly: one reminder per high-risk report that stayed open past the threshold. */
async function runHazardOverdueEscalation() {
  if (escalationRunning || !mailer.isConfigured()) return;
  const settings = readHazardAlertSettings();
  if (!settings.overdueEnabled || !hazardAlerts.activeEmails(settings).length) return;
  const due = hazardAlerts.overdueHazards(readHazards(), { hours: settings.overdueHours });
  if (!due.length) return;
  escalationRunning = true;
  try {
    const stamp = new Date().toISOString();
    for (const h of due.slice(0, 10)) {
      const hours = hazardAlerts.openHours(h);
      const r = await sendHazardAlertEmail(h, { kind: 'overdue', hours });
      if (!r.sent) {
        console.error(`[hazard-alert] escalation for ${h.id} failed: ${r.error || r.reason}`);
        break;
      }
      await enqueueWrite(async () => {
        const live = readHazards();
        const target = live.find((x) => x.id === h.id);
        if (target) {
          target.escalatedAt = stamp;
          writeHazards(live);
        }
      });
    }
  } catch (err) {
    console.error('[hazard-alert] escalation error:', err && err.message);
  } finally {
    escalationRunning = false;
  }
}

function startHazardEscalation() {
  setInterval(runHazardOverdueEscalation, 60 * 60 * 1000).unref();
}

module.exports = {
  readHazardAlertSettings,
  markRecipientsConfigured,
  hazardAlertResponse,
  sendHazardAlertEmail,
  queueHazardAlertEmail,
  startHazardEscalation,
};
