'use strict';

// Excel registers of permits and hazard reports, shared by the download buttons and the e-mail sending.

const ExcelJS = require('exceljs');
const { finalizeExcel } = require('../services/excel');
const { backfillHazardTimestamps } = require('../services/bootstrap');
const { sortHazardsForDisplay } = require('../services/hazard-alerts');
const { sortPermitsForList, permitRiskLevel, RISK_LABEL } = require('../utils/permit-order');
const { permitStatus, hazardStatus } = require('./print-docs');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PERMIT_COLUMNS = [
  { header: 'رقم الطلب', key: 'id', width: 18 },
  { header: 'نوع الطلب', key: 'typeLabel', width: 20 },
  { header: 'مستوى الخطورة', key: 'risk', width: 14 },
  { header: 'القسم', key: 'department', width: 15 },
  { header: 'الوردية', key: 'shift', width: 12 },
  { header: 'تاريخ التنفيذ', key: 'date', width: 15 },
  { header: 'اسم العامل', key: 'workerName', width: 22 },
  { header: 'رقم التليفون', key: 'requesterPhone', width: 16 },
  { header: 'مكان العمل', key: 'location', width: 20 },
  { header: 'الحالة', key: 'status', width: 18 },
  { header: 'مشرف السلامة', key: 'safetyOfficerName', width: 20 },
  { header: 'مدير المنطقة', key: 'areaManagerName', width: 20 },
  { header: 'ملاحظة الرفض', key: 'reviewNote', width: 25 },
  { header: 'تاريخ الإرسال', key: 'submittedAt', width: 22 },
];

/** `permits` oldest first, as stored; the sheet follows the list screen's order. */
function buildPermitsWorkbook(permits) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('سجل الطلبات');
  sheet.columns = PERMIT_COLUMNS;
  for (const p of sortPermitsForList(permits)) {
    sheet.addRow({
      id: p.id || '',
      typeLabel: p.typeLabel || '',
      risk: RISK_LABEL[permitRiskLevel(p)],
      department: p.department || '',
      shift: p.shift || '',
      date: p.date || '',
      workerName: p.workerName || '',
      requesterPhone: p.requesterPhone || '',
      location: p.location || '',
      status: permitStatus(p.status).label,
      safetyOfficerName: p.safetyOfficerName || '-',
      areaManagerName: p.areaManagerName || '-',
      reviewNote: p.reviewNote || '-',
      submittedAt: p.submittedAt ? new Date(p.submittedAt).toLocaleString('ar-EG') : '',
    });
  }
  finalizeExcel(workbook, 'سجل طلبات تصاريح العمل');
  return workbook;
}

const HAZARD_COLUMNS = [
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
  { header: 'اللي فتحوا البلاغ وهو مفتوح', key: 'viewers', width: 34 },
  { header: 'وقت بدء الإصلاح والمعالجة', key: 'inProgressAt', width: 30 },
  { header: 'وقت الإغلاق والانتهاء', key: 'resolvedAt', width: 30 },
  { header: 'الإجراء المتخذ وملاحظات المشرف', key: 'actionTaken', width: 40 },
];

const HAZARD_RISK_LABELS = { H: 'High 🔴', M: 'Medium 🟡', L: 'Low 🟢' };
const HAZARD_STATUS_LABELS = { open: 'مفتوح 🔴', notified: 'تم الإبلاغ 📢', in_progress: 'قيد الإصلاح 🟡', resolved: 'تم الحل والإغلاق 🟢', closed: 'تم الحل والإغلاق 🟢' };

function buildHazardsWorkbook(hazards) {
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('بلاغات الخطورة');
  sheet.columns = HAZARD_COLUMNS;
  for (const h of sortHazardsForDisplay(hazards.map(backfillHazardTimestamps))) {
    const viewers = Array.isArray(h.viewers) ? h.viewers : [];
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
      riskLevel: HAZARD_RISK_LABELS[h.riskLevel] || HAZARD_RISK_LABELS.L,
      status: HAZARD_STATUS_LABELS[h.status || 'open'] || hazardStatus(h.status).label,
      seenAt: h.seenAt ? `${fmt(h.seenAt)} (${h.seenBy || 'المشرف'})` : 'لم يُشاهد بعد',
      viewers: viewers.map((v) => `${v.name} (${fmt(v.at)})`).join('، ') || '-',
      inProgressAt: h.inProgressAt ? `${fmt(h.inProgressAt)} (${h.inProgressBy || 'الصيانة'})` : 'لم يبدأ بعد',
      resolvedAt: h.resolvedAt ? `${fmt(h.resolvedAt)} (${h.resolvedBy || 'المشرف'})` : 'لم ينتهِ بعد',
      actionTaken: h.actionTaken ? `${h.actionTaken} (${h.updatedBy || 'المشرف'})` : 'لا يوجد',
    });
  }
  finalizeExcel(workbook, 'سجل بلاغات الخطورة');
  return workbook;
}

module.exports = { buildPermitsWorkbook, buildHazardsWorkbook, XLSX_TYPE };
