'use strict';

// Forwarding one hazard report by e-mail to whoever should follow it up.

const express = require('express');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { emailSendLimiter } = require('../../middleware/rate-limits');
const { enqueueWrite } = require('../../data/write-queue');
const { readHazards, writeHazards } = require('../../data/stores');
const mailer = require('../../services/mailer');
const { logAuditEvent } = require('../../services/audit-log');
const { openHours } = require('../../services/hazard-alerts');
const { sendHazardAlertEmail } = require('../../services/hazard-alert-mailer');
const { parseEmailRecipients, senderName, SMTP_MISSING } = require('../../services/excel-mail');
const { sanitizeStr } = require('../../utils/validation');
const { ADMIN_ROLES, hiddenFor, visibleTo } = require('./shared');

const router = express.Router();

const MAX_FORWARDS = 20;

router.post('/api/hazards/:id/forward', authenticateToken, requireRole(...ADMIN_ROLES), emailSendLimiter, async (req, res) => {
  const { list, error } = parseEmailRecipients(req.body && req.body.to);
  if (error) return res.status(400).json({ error });
  const note = sanitizeStr(req.body && req.body.note, 500);

  const hazard = readHazards().find((h) => h.id === req.params.id);
  if (!hazard || !visibleTo(req.user, hazard) || hiddenFor(req.user, hazard)) return res.status(404).json({ error: 'البلاغ غير موجود' });
  if (!mailer.isConfigured()) return res.status(503).json(SMTP_MISSING);

  const by = senderName(req.user);
  let result;
  try {
    result = await sendHazardAlertEmail(hazard, { kind: 'forward', hours: openHours(hazard), to: list, by, note });
  } catch (err) {
    console.error('[hazards] forward failed:', err);
    return res.status(500).json({ error: 'حصل خطأ أثناء الإرسال' });
  }
  if (!result.sent) return res.status(502).json({ error: `فشل الإرسال: ${result.error || result.reason}` });

  const entry = { to: list, by, at: new Date().toISOString(), ...(note ? { note } : {}) };
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const h = hazards.find((x) => x.id === hazard.id);
    if (!h) return;
    h.forwards = [...(Array.isArray(h.forwards) ? h.forwards : []), entry].slice(-MAX_FORWARDS);
    writeHazards(hazards);
  });
  logAuditEvent({ entityType: 'hazard', entityId: hazard.id, action: 'email', actor: req.user, note: `توجيه البلاغ بالإيميل إلى: ${list.join(', ')}${note ? ` — ${note}` : ''}` });
  res.json({ success: true, sentTo: list, forward: entry });
});

module.exports = router;
