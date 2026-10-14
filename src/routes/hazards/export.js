'use strict';

// Excel export of the hazard register.

const express = require('express');
const ExcelJS = require('exceljs');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { readHazards } = require('../../data/stores');
const { finalizeExcel } = require('../../services/excel');
const { backfillHazardTimestamps } = require('../../services/bootstrap');
const { setDownloadFilename } = require('../../utils/http');
const { ADMIN_ROLES, visibleTo } = require('./shared');

const router = express.Router();

const EXPORT_COLUMNS = [
  { header: 'كود البلاغ', key: 'id', width: 18 },
  { header: 'تاريخ البلاغ', key: 'date', width: 15 },
  { header: 'وقت الإرسال الدقيق', key: 'submittedAt', width: 20 },
  { header: 'مقدم البلاغ', key: 'reporterName', width: 20 },
  { header: 'القسم', key: 'department', width: 15 },
  { header: 'المنطقة', key: 'area', width: 20 },
  { header: 'وصف الخطورة', key: 'description', width: 40 },
  { header: 'الإصابة المحتملة', key: 'potentialInjury', width: 30 },
  { header: 'الحل المقترح', key: 'proposedSolution', width: 30 },
  { header: 'مستوى الخطورة', key: 'riskLevel', width: 15 },
  { header: 'الحالة الحالية', key: 'status', width: 20 },
  { header: 'وقت مشاهدة المشرف للبلاغ', key: 'seenAt', width: 30 },
  { header: 'وقت بدء الإصلاح والمعالجة', key: 'inProgressAt', width: 30 },
  { header: 'وقت الإغلاق والانتهاء', key: 'resolvedAt', width: 30 },
  { header: 'الإجراء المتخذ وملاحظات المشرف', key: 'actionTaken', width: 40 },
];

const RISK_LABELS = { H: 'High 🔴', M: 'Medium 🟡', L: 'Low 🟢' };
const STATUS_LABELS = { notified: 'تم الإبلاغ 📢', in_progress: 'قيد الإصلاح 🟡', resolved: 'تم الحل والإغلاق 🟢', closed: 'تم الحل والإغلاق 🟢' };

router.get('/api/export-hazards', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const hazards = readHazards()
      .filter((h) => (req.user.role === 'dept_admin' || req.user.role === 'maint_admin' ? visibleTo(req.user, h) : true))
      .map(backfillHazardTimestamps);
    if (!hazards.length) return res.status(404).json({ error: 'لا توجد بيانات بلاغات حالياً للتصدير' });

    const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('بلاغات الخطورة');
    sheet.columns = EXPORT_COLUMNS;
    for (const h of hazards) {
      sheet.addRow({
        id: h.id || '',
        date: h.date || '',
        submittedAt: fmt(h.submittedAt || h.createdAt),
        reporterName: h.reporterName || '',
        department: h.department || '',
        area: h.area || '',
        description: h.description || '',
        potentialInjury: h.potentialInjury || '',
        proposedSolution: h.proposedSolution || '',
        riskLevel: RISK_LABELS[h.riskLevel] || RISK_LABELS.L,
        status: STATUS_LABELS[h.status] || 'مفتوح 🔴',
        seenAt: h.seenAt ? `${fmt(h.seenAt)} (${h.seenBy || 'المشرف'})` : 'لم يُشاهد بعد',
        inProgressAt: h.inProgressAt ? `${fmt(h.inProgressAt)} (${h.inProgressBy || 'الصيانة'})` : 'لم يبدأ بعد',
        resolvedAt: h.resolvedAt ? `${fmt(h.resolvedAt)} (${h.resolvedBy || 'المشرف'})` : 'لم ينتهِ بعد',
        actionTaken: h.actionTaken ? `${h.actionTaken} (${h.updatedBy || 'المشرف'})` : 'لا يوجد',
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finalizeExcel(workbook, 'سجل بلاغات الخطورة');
    setDownloadFilename(res, `سجل بلاغات الخطورة - ${new Date().toISOString().slice(0, 10)}`, 'xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[hazards] export failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل تصدير البيانات' });
  }
});

module.exports = router;
