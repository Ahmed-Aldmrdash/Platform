'use strict';

// Submitting and listing hazard reports, plus the legacy Excel register import.

const express = require('express');
const hazardAlerts = require('../../services/hazard-alerts');
const { authenticateToken, authenticateSession, requireRole } = require('../../middleware/auth');
const { submitLimiter } = require('../../middleware/rate-limits');
const { replyNotModified, viewerKey } = require('../../middleware/http-cache');
const { enqueueWrite } = require('../../data/write-queue');
const {
  hazardsStore, readHazards, writeHazards, readEmployees, findEmployeeByCode, shared,
} = require('../../data/stores');
const { createNotification } = require('../../services/notifications');
const { notifyAdminsWhatsAppNewHazard } = require('../../services/whatsapp-alerts');
const { saveHazardPhoto } = require('../../services/hazard-photos');
const { readHazardAlertSettings, queueHazardAlertEmail } = require('../../services/hazard-alert-mailer');
const { parseHazardsWorkbook } = require('../../importers/hazards-excel');
const { emptyDeleteFlags } = require('../../constants');
const { normalizeEmpCode, sanitizeStr, clampInt, deptMatches } = require('../../utils/validation');
const { ADMIN_ROLES, HSE_ROLES, visibleTo } = require('./shared');

const router = express.Router();

router.post('/api/hazards/upload-excel', authenticateToken, requireRole(...HSE_ROLES), async (req, res) => {
  try {
    const { base64Data } = req.body || {};
    if (!base64Data) return res.status(400).json({ success: false, message: 'No file data provided' });
    const imported = await parseHazardsWorkbook(Buffer.from(base64Data, 'base64'));
    await enqueueWrite(async () => writeHazards([...readHazards(), ...imported]));
    const closed = imported.filter((h) => h.status === 'closed').length;
    res.json({ success: true, count: imported.length, closed, open: imported.length - closed });
  } catch (err) {
    console.error('[hazards] Excel import failed:', err);
    res.status(500).json({ success: false, message: 'Invalid Excel file or parsing error' });
  }
});

router.post('/api/hazards', authenticateSession, submitLimiter, async (req, res) => {
  const payload = req.body || {};
  // Workers report under the identity in their session, never one typed into the form.
  if (req.worker) {
    const emp = findEmployeeByCode(req.worker.empCode);
    payload.empCode = req.worker.empCode;
    payload.reporterName = (emp && emp.name) || req.worker.name || payload.reporterName;
    if (!payload.department) payload.department = (emp && emp.department) || req.worker.department;
  }
  if (!payload.reporterName || !payload.department || !payload.description) {
    return res.status(400).json({ error: 'البيانات غير مكتملة' });
  }
  if (payload.photo && String(payload.photo).length > 12 * 1024 * 1024) {
    return res.status(413).json({ error: 'الصورة كبيرة جدًا — صغّرها وجرب تاني' });
  }

  let created = null;
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const maxN = hazards.reduce((mx, h) => (h.id ? Math.max(mx, parseInt(h.id.split('-').pop(), 10) || 0) : mx), 0);
    const hazard = {
      id: `HZ-${new Date().getFullYear()}-${String(maxN + 1).padStart(4, '0')}`,
      reporterName: sanitizeStr(payload.reporterName, 100),
      empCode: normalizeEmpCode(payload.empCode),
      date: sanitizeStr(payload.date, 20) || new Date().toISOString().split('T')[0],
      department: sanitizeStr(payload.department, 100),
      area: sanitizeStr(payload.area, 150),
      description: sanitizeStr(payload.description, 1000),
      potentialInjury: sanitizeStr(payload.potentialInjury, 300),
      proposedSolution: sanitizeStr(payload.proposedSolution, 500),
      likelihood: clampInt(payload.likelihood, 1, 5, 1),
      severity: ['A', 'B', 'C', 'D', 'E'].includes(payload.severity) ? payload.severity : 'A',
      riskLevel: ['L', 'M', 'H'].includes(payload.riskLevel) ? payload.riskLevel : 'L',
      status: 'open',
      actionTaken: '',
      photoUrl: saveHazardPhoto(payload.photo),
      deletedBy: emptyDeleteFlags(),
      permanentlyDeletedBy: emptyDeleteFlags(),
      submittedAt: new Date().toISOString(),
    };
    hazards.push(hazard);
    writeHazards(hazards);
    created = hazard;
  });
  if (!created) return res.status(500).json({ error: 'فشل حفظ البلاغ' });

  createNotification({
    targetRole: 'admin',
    type: 'hazard',
    title: 'بلاغ خطورة جديد 🚨',
    message: `بلاغ خطورة جديد في ${created.area} - ${created.description}`,
    link: 'tabSupHazard',
  });
  notifyAdminsWhatsAppNewHazard(created);
  if (hazardAlerts.isHighRisk(created) && readHazardAlertSettings().highRiskEnabled) {
    queueHazardAlertEmail(created, { kind: 'new' });
  }
  if (created.empCode) {
    createNotification({
      targetEmpCode: created.empCode,
      type: 'hazard',
      title: 'استلام البلاغ 📥',
      message: 'تم تسجيل بلاغك بنجاح وجارٍ مراجعته من قِبل السلامة',
      link: 'tabHazardWorker',
    });
  }
  res.status(201).json({ success: true, hazard: created });
});

router.get('/api/hazards/employee-stats', authenticateToken, requireRole(...ADMIN_ROLES), (req, res) => {
  let employees = readEmployees();
  if (['dept_admin', 'maint_admin'].includes(req.user.role) && req.user.department) {
    employees = employees.filter((e) => deptMatches(e.department, req.user.department));
  }
  const counts = new Map();
  for (const h of readHazards()) {
    if (h.deleted === true) continue;
    const code = normalizeEmpCode(h.empCode);
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const stats = employees.map((emp) => ({
    code: emp.empCode,
    name: emp.name,
    department: emp.department,
    count: counts.get(normalizeEmpCode(emp.empCode)) || 0,
    target: 2,
  }));
  res.json({ stats });
});

router.get('/api/hazards', authenticateToken, requireRole(...ADMIN_ROLES), (req, res) => {
  if (replyNotModified(req, res, ['hazards', viewerKey(req), hazardsStore.version()])) return;
  const hazards = shared.hazards().filter((h) => visibleTo(req.user, h));
  res.json({ hazards: hazardAlerts.sortHazardsForDisplay(hazards) });
});

/** Open-report count for the menu badge, without downloading the whole list. */
router.get('/api/hazards/summary', authenticateToken, requireRole(...ADMIN_ROLES), (req, res) => {
  if (replyNotModified(req, res, ['hazards-summary', viewerKey(req), hazardsStore.version()])) return;
  const open = shared.hazards().filter((h) => h.status === 'open' && visibleTo(req.user, h)).length;
  res.json({ open });
});

/** Marks the reports a reviewer actually opened as seen (shown to the reporter). */
router.post('/api/hazards/seen', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), async (req, res) => {
  const ids = new Set((Array.isArray(req.body && req.body.ids) ? req.body.ids : []).slice(0, 500).map(String));
  if (!ids.size) return res.json({ success: true, updated: 0 });
  let updated = 0;
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const now = new Date().toISOString();
    const reader = sanitizeStr(req.user.name || req.user.username || 'المشرف', 100);
    for (const h of hazards) {
      if (!ids.has(h.id) || h.seenAt || !visibleTo(req.user, h)) continue;
      h.seenAt = now;
      h.seenBy = reader;
      updated += 1;
    }
    if (updated) writeHazards(hazards);
  });
  res.json({ success: true, updated });
});

router.get('/api/my-hazards/:name', authenticateSession, (req, res) => {
  const workerEmp = req.worker ? findEmployeeByCode(req.worker.empCode) : null;
  const reporterName = req.worker ? String((workerEmp && workerEmp.name) || '').trim() : String(req.params.name || '').trim();
  const empCode = req.worker ? req.worker.empCode : (req.query.empCode ? normalizeEmpCode(req.query.empCode) : '');
  if (!reporterName && !empCode) return res.status(400).json({ error: 'الاسم أو الكود الوظيفي مطلوب' });
  if (replyNotModified(req, res, ['my-hazards', viewerKey(req), reporterName, empCode, hazardsStore.version()])) return;

  let mine = shared.hazards().filter((h) => {
    // Imported records carry the reporter under different field names.
    if (empCode) {
      const code = normalizeEmpCode(h.empCode || h.code || h.employeeCode || '');
      if (code && code === empCode) return true;
    }
    const name = String(h.reporterName || h.empName || h.reportedBy || '').trim();
    return Boolean(name && reporterName && name === reporterName);
  });
  if (!req.worker) mine = mine.filter((h) => visibleTo(req.user, h));
  res.json({ hazards: mine });
});

module.exports = router;
