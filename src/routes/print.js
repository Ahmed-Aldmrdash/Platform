'use strict';

// Printable HTML documents (permits, hazard reports, drill reports) and the
// public QR verification page printed on them.

const express = require('express');
const QRCode = require('qrcode');
const { authenticateTokenFlexible, requireRole } = require('../middleware/auth');
const { permitsRepo, readHazards, readDrills } = require('../data/stores');
const { renderPrintDocument } = require('../documents/print-template');
const { buildPermitPrint, buildHazardPrint, buildDrillPrint, permitStatus, hazardStatus } = require('../documents/print-docs');
const { defaultDrillReport } = require('../documents/drill-report');
const { verifyPageHtml, verifyStatus, sendPrintPage, printErrorPage } = require('../documents/pages');
const { siteBaseUrl } = require('../utils/http');
const { deptMatches } = require('../utils/validation');

const router = express.Router();

const PRINT_ROLES = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin'];
const PHOTO_URL_RE = /^\/uploads\/hazards\/[A-Za-z0-9._-]+$/;

const isDepartmentScoped = (user) => ['dept_admin', 'maint_admin'].includes(user.role) && Boolean(user.department);

function canSeeHazard(user, hazard) {
  if (!isDepartmentScoped(user)) return true;
  return deptMatches(hazard.department, user.department)
    || (user.role === 'maint_admin' && deptMatches(hazard.assignedToMaintenance, user.department));
}

const qrFor = (url) => QRCode.toDataURL(url, { margin: 1, width: 220 }).catch(() => null);

// Old PDF links (from tabs still running an older frontend) now open the print page.
function redirectToPrint(kind) {
  return (req, res) => {
    const dt = typeof req.query.dt === 'string' ? `?dt=${encodeURIComponent(req.query.dt)}` : '';
    res.redirect(302, `/print/${kind}/${encodeURIComponent(req.params.id)}${dt}`);
  };
}
router.get('/api/permits/:id/pdf', redirectToPrint('permit'));
router.get('/api/hazards/:id/pdf', redirectToPrint('hazard'));

router.get('/verify/permit/:id', (req, res) => {
  const permit = permitsRepo.get(req.params.id);
  if (!permit) {
    return res.status(404).send(verifyPageHtml({ title: 'تصريح غير موجود', rows: [], statusLabel: 'غير صالح', statusColor: '#DC2626' }));
  }
  const { label, color } = verifyStatus(permit, permitStatus(permit.status));
  res.send(verifyPageHtml({
    title: `تصريح عمل ${permit.id}`,
    statusLabel: label,
    statusColor: color,
    rows: [
      ['النوع', permit.typeFullLabel || permit.typeLabel],
      ['القسم', permit.department],
      ['التاريخ', permit.date],
      ['العامل', permit.workerName],
    ],
  }));
});

router.get('/verify/hazard/:id', (req, res) => {
  const hazard = readHazards().find((h) => h.id === req.params.id);
  if (!hazard) {
    return res.status(404).send(verifyPageHtml({ title: 'بلاغ غير موجود', rows: [], statusLabel: 'غير صالح', statusColor: '#DC2626' }));
  }
  const { label, color } = verifyStatus(hazard, hazardStatus(hazard.status));
  res.send(verifyPageHtml({
    title: `بلاغ خطورة ${hazard.id}`,
    statusLabel: label,
    statusColor: color,
    rows: [
      ['القسم', hazard.department],
      ['المنطقة', hazard.area],
      ['التاريخ', hazard.date],
      ['مستوى الخطورة', hazard.riskLevel],
    ],
  }));
});

router.get('/print/permit/:id', authenticateTokenFlexible, requireRole(...PRINT_ROLES), async (req, res) => {
  try {
    const permit = permitsRepo.get(req.params.id);
    if (!permit || (isDepartmentScoped(req.user) && !deptMatches(permit.department, req.user.department))) {
      return res.status(404).type('html').send(printErrorPage('التصريح غير موجود أو اتمسح.'));
    }
    const qrDataUrl = await qrFor(`${siteBaseUrl(req)}/verify/permit/${encodeURIComponent(permit.id)}`);
    sendPrintPage(res, renderPrintDocument(buildPermitPrint(permit, { qrDataUrl, autoPrint: req.query.autoprint === '1' })));
  } catch (err) {
    console.error('[print] permit failed:', err);
    res.status(500).type('html').send(printErrorPage('حصل خطأ أثناء تجهيز المستند للطباعة.'));
  }
});

router.get('/print/hazard/:id', authenticateTokenFlexible, requireRole(...PRINT_ROLES), async (req, res) => {
  try {
    const hazard = readHazards().find((h) => h.id === req.params.id);
    if (!hazard || !canSeeHazard(req.user, hazard)) {
      return res.status(404).type('html').send(printErrorPage('البلاغ غير موجود أو اتمسح.'));
    }
    const qrDataUrl = await qrFor(`${siteBaseUrl(req)}/verify/hazard/${encodeURIComponent(hazard.id)}`);
    const photoAbsUrl = PHOTO_URL_RE.test(String(hazard.photoUrl || '')) ? hazard.photoUrl : null;
    const afterPhotoAbsUrl = PHOTO_URL_RE.test(String(hazard.afterPhotoUrl || '')) ? hazard.afterPhotoUrl : null;
    sendPrintPage(res, renderPrintDocument(buildHazardPrint(hazard, { qrDataUrl, photoAbsUrl, afterPhotoAbsUrl, autoPrint: req.query.autoprint === '1' })));
  } catch (err) {
    console.error('[print] hazard failed:', err);
    res.status(500).type('html').send(printErrorPage('حصل خطأ أثناء تجهيز المستند للطباعة.'));
  }
});

router.get('/print/drill/:id', authenticateTokenFlexible, requireRole(...PRINT_ROLES), (req, res) => {
  try {
    const drill = readDrills().find((d) => d.id === req.params.id && !d.isDeleted);
    if (!drill) return res.status(404).type('html').send(printErrorPage('التجربة غير موجودة أو اتمسحت.'));
    sendPrintPage(res, renderPrintDocument(buildDrillPrint(drill, drill.report || defaultDrillReport(), { autoPrint: req.query.autoprint === '1' })));
  } catch (err) {
    console.error('[print] drill failed:', err);
    res.status(500).type('html').send(printErrorPage('حصل خطأ أثناء تجهيز المستند للطباعة.'));
  }
});

module.exports = router;
