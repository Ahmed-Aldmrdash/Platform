'use strict';

// Excel register of hazard reports: download, or send it straight to an e-mail address.

const express = require('express');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { emailSendLimiter } = require('../../middleware/rate-limits');
const { readHazards } = require('../../data/stores');
const mailer = require('../../services/mailer');
const { logAuditEvent } = require('../../services/audit-log');
const { parseEmailRecipients, senderName, emailWorkbook, SMTP_MISSING } = require('../../services/excel-mail');
const { buildHazardsWorkbook, XLSX_TYPE } = require('../../documents/excel-exports');
const { setDownloadFilename } = require('../../utils/http');
const { ADMIN_ROLES, visibleTo } = require('./shared');

const router = express.Router();

function hazardsForExport(user) {
  return readHazards().filter((h) => visibleTo(user, h));
}

router.get('/api/export-hazards', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const hazards = hazardsForExport(req.user);
    if (!hazards.length) return res.status(404).json({ error: 'لا توجد بيانات بلاغات حالياً للتصدير' });
    const workbook = buildHazardsWorkbook(hazards);
    res.setHeader('Content-Type', XLSX_TYPE);
    setDownloadFilename(res, `سجل بلاغات الخطورة - ${new Date().toISOString().slice(0, 10)}`, 'xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[hazards] export failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل تصدير البيانات' });
  }
});

router.post('/api/hazards/email-excel', authenticateToken, requireRole(...ADMIN_ROLES), emailSendLimiter, async (req, res) => {
  const { list, error } = parseEmailRecipients(req.body && req.body.to);
  if (error) return res.status(400).json({ error });
  if (!mailer.isConfigured()) return res.status(503).json(SMTP_MISSING);
  try {
    const hazards = hazardsForExport(req.user);
    if (!hazards.length) return res.status(404).json({ error: 'لا توجد بيانات بلاغات حالياً للإرسال' });
    const result = await emailWorkbook({
      workbook: buildHazardsWorkbook(hazards),
      to: list,
      title: 'سجل بلاغات الخطورة',
      filename: `سجل_بلاغات_الخطورة_${new Date().toISOString().slice(0, 10)}`,
      count: hazards.length,
      sender: senderName(req.user),
    });
    if (!result.sent) return res.status(502).json({ error: `فشل الإرسال: ${result.error || result.reason}` });
    logAuditEvent({ entityType: 'hazard', entityId: 'register', action: 'email', actor: req.user, note: `إرسال شيت بلاغات الخطورة (${hazards.length}) إلى: ${list.join(', ')}` });
    res.json({ success: true, sentTo: list, count: hazards.length });
  } catch (err) {
    console.error('[hazards] e-mail export failed:', err);
    res.status(500).json({ error: 'حصل خطأ أثناء تجهيز الشيت' });
  }
});

module.exports = router;
