'use strict';

const express = require('express');
const { readDrills, writeDrills } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateToken, authenticateTokenFlexible, requireRole } = require('../../middleware/auth');
const { sanitizeStr } = require('../../utils/validation');
const { setDownloadFilename } = require('../../utils/http');
const { defaultDrillReport, buildDrillReportDocx } = require('../../documents/drill-report');

const router = express.Router();

// Only the fields of the report form are accepted, as plain text of bounded size.
function cleanReport(incoming) {
  const allowed = defaultDrillReport();
  const out = {};
  for (const key of Object.keys(allowed)) {
    if (!(key in incoming) || key === 'updatedAt' || key === 'updatedBy') continue;
    const value = incoming[key];
    if (Array.isArray(allowed[key])) {
      out[key] = Array.isArray(value) ? value.slice(0, 30).map((v) => sanitizeStr(v, 500)).filter(Boolean) : [];
    } else {
      out[key] = sanitizeStr(value, 2000);
    }
  }
  return out;
}

router.get('/api/drills/:id/report', authenticateToken, (req, res) => {
  const drills = readDrills();
  const drl = drills.find(d => d.id === req.params.id);
  if (!drl) return res.status(404).json({ error: 'التجربة غير موجودة' });
  res.json({
    report: drl.report || defaultDrillReport(),
    drill: { id: drl.id, title: drl.title, date: drl.date, location: drl.location, startTime: drl.startTime, endTime: drl.endTime, trainer: drl.trainer }
  });
});

router.put('/api/drills/:id/report', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const drills = readDrills();
    const idx = drills.findIndex(d => d.id === req.params.id);
    if (idx === -1) { result = { status: 404, body: { error: 'التجربة غير موجودة' } }; return; }
    const incoming = cleanReport((req.body && req.body.report) || {});
    const merged = Object.assign(defaultDrillReport(), drills[idx].report || {}, incoming, {
      updatedAt: new Date().toISOString(),
      updatedBy: (req.user && (req.user.name || req.user.username)) || 'admin'
    });
    drills[idx].report = merged;
    if (writeDrills(drills)) {
      result = { status: 200, body: { success: true, report: merged } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ الريبورت' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع' });
});

router.get('/api/drills/:id/report/export', authenticateTokenFlexible, async (req, res) => {
  try {
    const drills = readDrills();
    const drl = drills.find(d => d.id === req.params.id);
    if (!drl) return res.status(404).send('Drill not found');
    const report = drl.report || defaultDrillReport();
    const buffer = await buildDrillReportDocx(drl, report);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    setDownloadFilename(res, `تقرير تجربة طوارئ - ${drl.title || ''} - ${drl.date || ''}`, 'docx');
    res.send(buffer);
  } catch (err) {
    console.error('Export drill report error:', err);
    if (!res.headersSent) res.status(500).send('Export failed');
  }
});

module.exports = router;
