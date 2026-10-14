'use strict';

// High-risk alert recipients and the test e-mail.

const express = require('express');
const hazardAlerts = require('../../services/hazard-alerts');
const mailer = require('../../services/mailer');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { hazardAlertStore, readHazards } = require('../../data/stores');
const { logAuditEvent } = require('../../services/audit-log');
const {
  readHazardAlertSettings, markRecipientsConfigured, hazardAlertResponse, sendHazardAlertEmail,
} = require('../../services/hazard-alert-mailer');
const { ALERT_ROLES } = require('./shared');

const router = express.Router();

router.get('/api/hazards/alert-settings', authenticateToken, requireRole(...ALERT_ROLES), (req, res) => {
  res.json(hazardAlertResponse());
});

router.put('/api/hazards/alert-settings', authenticateToken, requireRole(...ALERT_ROLES), (req, res) => {
  const b = req.body || {};
  const incoming = Array.isArray(b.recipients) ? b.recipients : [];
  if (incoming.length > hazardAlerts.MAX_RECIPIENTS) {
    return res.status(400).json({ error: `أقصى عدد ${hazardAlerts.MAX_RECIPIENTS} مستلمين` });
  }
  const bad = incoming.find((r) => r && r.email && !hazardAlerts.EMAIL_RE.test(String(r.email).trim().toLowerCase()));
  if (bad) return res.status(400).json({ error: `الإيميل ده مش صحيح: ${String(bad.email).slice(0, 80)}` });
  if (incoming.some((r) => r && hazardAlerts.BLOCKED_RECIPIENT_CODES.includes(hazardAlerts.normalizeCode(r.empCode)))) {
    return res.status(400).json({ error: 'الكود ده مستثنى من تنبيهات الخطورة العالية بطلب الإدارة' });
  }

  const next = hazardAlerts.normalizeSettings({
    highRiskEnabled: b.highRiskEnabled,
    overdueEnabled: b.overdueEnabled,
    overdueHours: b.overdueHours,
    requireAfterPhoto: b.requireAfterPhoto,
    recipients: incoming,
  }, { employees: [] });
  if (next.highRiskEnabled && !hazardAlerts.activeEmails(next).length) {
    return res.status(400).json({ error: 'ضيف مستلم واحد على الأقل بإيميل صحيح قبل تفعيل التنبيه' });
  }
  hazardAlertStore.write({
    ...(hazardAlertStore.read() || {}),
    highRiskEnabled: next.highRiskEnabled,
    overdueEnabled: next.overdueEnabled,
    overdueHours: next.overdueHours,
    requireAfterPhoto: next.requireAfterPhoto,
    recipients: next.recipients,
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.username,
  });
  markRecipientsConfigured();
  logAuditEvent({
    entityType: 'database',
    entityId: 'hazard-alert',
    action: 'update',
    actor: req.user,
    note: next.highRiskEnabled
      ? `تنبيه الخطورة العالية بالإيميل إلى: ${hazardAlerts.activeEmails(next).join(', ')}${next.overdueEnabled ? ` + تصعيد بعد ${next.overdueHours} ساعة` : ''}`
      : 'إيقاف تنبيه الخطورة العالية بالإيميل',
  });
  res.json({ success: true, ...hazardAlertResponse() });
});

// Sends the most recent real high-risk report, or a sample when there is none.
router.post('/api/hazards/alert-settings/test', authenticateToken, requireRole(...ALERT_ROLES), async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(503).json({ error: 'إعدادات الإيميل (SMTP) مش متظبطة — اظبطها من شاشة النسخ الاحتياطي', notConfigured: true });
  }
  const emails = hazardAlerts.activeEmails(readHazardAlertSettings());
  if (!emails.length) return res.status(400).json({ error: 'مفيش مستلمين مفعّلين — ضيف إيميل واحد على الأقل' });

  const sample = hazardAlerts.sortHazardsForDisplay(readHazards().filter(hazardAlerts.isHighRisk))[0] || {
    id: 'HZ-TEST',
    date: new Date().toISOString().split('T')[0],
    department: 'الصيانة الميكانيكية',
    area: 'خط الإنتاج 2',
    reporterName: 'نموذج تجريبي',
    empCode: '0000',
    riskLevel: 'H',
    likelihood: 4,
    severity: 'D',
    status: 'open',
    description: 'دي رسالة تجريبية للتأكد إن تنبيه بلاغات الخطورة العالية بيوصل صح.',
    potentialInjury: 'إصابة بالغة',
    proposedSolution: 'عزل المصدر وتأمين المكان',
    submittedAt: new Date().toISOString(),
  };
  try {
    const r = await sendHazardAlertEmail(sample, { kind: 'test', to: emails });
    if (!r.sent) return res.status(502).json({ error: `فشل الإرسال: ${r.error || r.reason}` });
    logAuditEvent({ entityType: 'hazard', entityId: sample.id, action: 'test_email', actor: req.user, note: `تجربة تنبيه خطورة عالية إلى: ${emails.join(', ')}` });
    res.json({ success: true, sentTo: emails, hazardId: sample.id });
  } catch (err) {
    console.error('[hazard-alert] test failed:', err);
    res.status(500).json({ error: 'حصل خطأ أثناء إرسال التجربة' });
  }
});

module.exports = router;
