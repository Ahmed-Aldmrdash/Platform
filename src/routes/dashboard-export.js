'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const chatbotAnalytics = require('../chatbot/analytics');
const { getPermitsArray, readDrills, readEmployees, readHazards, readPenalties, readTrainings, readWorkerCreds } = require('../data/stores');
const { authenticateToken, authenticateTokenFlexible, requireRole } = require('../middleware/auth');
const { normalizeEmpCode, sanitizeStr } = require('../utils/validation');
const { setDownloadFilename } = require('../utils/http');
const { addCompanyLogoToSheet, finalizeExcel } = require('../services/excel');
const { chatbotData } = require('../chatbot/data-source');

const router = express.Router();

// Rows come from the browser: keep only plain text/number cells (no formula objects) and bound the size.
const MAX_ROWS = 5000;
const cellValue = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : String(v == null ? '' : v).slice(0, 500));
const cleanRows = (rows) => (Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [])
  .map((r) => (Array.isArray(r) ? r.slice(0, 20).map(cellValue) : r && typeof r === 'object' ? { label: cellValue(r.label), value: cellValue(r.value) } : null))
  .filter(Boolean);
router.post('/api/dashboard/export-excel-charts', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin', 'maint_admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const [summaryRows, permitRows, hazardRows, trainingRows, drillRows] = ['summaryRows', 'permitRows', 'hazardRows', 'trainingRows', 'drillRows'].map((k) => cleanRows(body[k]));
    const charts = Array.isArray(body.charts) ? body.charts.slice(0, 12) : [];
    if (charts.length === 0) {
      return res.status(400).json({ error: 'لا توجد رسوم بيانية لتضمينها' });
    }

    const wb = new ExcelJS.Workbook();
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C1D1D' } };
    const whiteBold = { bold: true, color: { argb: 'FFFFFFFF' } };

    const wsSummary = wb.addWorksheet('ملخص');
    wsSummary.columns = [{ header: 'البند', key: 'label', width: 32 }, { header: 'القيمة', key: 'value', width: 30 }];
    wsSummary.getRow(1).font = whiteBold; wsSummary.getRow(1).fill = headerFill;
    (summaryRows || []).forEach(r => wsSummary.addRow(r));

    function addDataSheet(name, headers, rows, widths) {
      const ws = wb.addWorksheet(name);
      ws.columns = headers.map((h, i) => ({ header: h, key: 'c' + i, width: widths[i] }));
      ws.getRow(1).font = whiteBold; ws.getRow(1).fill = headerFill;
      (rows && rows.length ? rows : [headers.map(() => '')]).forEach(r => ws.addRow(r));
    }
    addDataSheet('تصاريح العمل', ['النوع', 'التاريخ', 'الحالة'], permitRows, [26, 16, 14]);
    addDataSheet('بلاغات الخطورة', ['الوصف', 'التاريخ', 'الحالة', 'القسم'], hazardRows, [30, 16, 14, 20]);
    addDataSheet('التدريب', ['العنوان', 'التاريخ', 'عدد الساعات', 'المدرب'], trainingRows, [30, 16, 12, 20]);
    addDataSheet('تجارب الطوارئ', ['العنوان', 'التاريخ', 'الحالة', 'الموقع'], drillRows, [30, 16, 14, 20]);

    const wsCharts = wb.addWorksheet('الرسوم البيانية');
    let rowCursor = 1;
    for (const chart of charts) {
      if (!chart || !chart.dataUrl || typeof chart.dataUrl !== 'string') continue;
      const match = chart.dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
      if (!match) continue;
      const buffer = Buffer.from(match[2], 'base64');
      wsCharts.getCell(`A${rowCursor}`).value = chart.title || '';
      wsCharts.getCell(`A${rowCursor}`).font = { bold: true, size: 13, color: { argb: 'FF7C1D1D' } };
      rowCursor += 1;
      const imageId = wb.addImage({ buffer, extension: match[1] === 'png' ? 'png' : 'jpeg' });
      wsCharts.addImage(imageId, { tl: { col: 0, row: rowCursor - 1 }, ext: { width: 560, height: 280 } });
      rowCursor += 16;
    }
    wsCharts.getColumn(1).width = 80;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finalizeExcel(wb, 'لوحة التحكم والإحصائيات');
    setDownloadFilename(res, `لوحة التحكم بالرسوم البيانية - ${new Date().toISOString().slice(0, 10)}`, 'xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[Dashboard] Excel-with-charts export failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل إنشاء ملف Excel' });
  }
});

const PBI_ROLES = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin', 'ceo', 'hse_director'];

function pbiDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
const pbiMonth = v => (pbiDate(v) || '').slice(0, 7);
const pbiYear = v => (pbiDate(v) || '').slice(0, 4);
const pbiYesNo = b => (b ? 'نعم' : 'لا');

function pbiAddSheet(wb, name, headers, rows, widths) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map((h, i) => ({ header: h, key: 'c' + i, width: (widths && widths[i]) || 18 }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C1D1D' } };
  rows.forEach(r => ws.addRow(r));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return ws;
}

const exportPowerBiHandler = async (req, res) => {
  try {
    const role = req.user.role;
    const scopeDept = (role === 'dept_admin' || role === 'maint_admin') ? String(req.user.department || '') : String(req.query.dept || '');
    const sameD = v => !scopeDept || String(v || '').trim().toLowerCase() === scopeDept.trim().toLowerCase();
    const notDeleted = r => !(r.deleted || r.isDeleted || r.deletedAt ||
      (r.deletedBy && typeof r.deletedBy === 'object' && Object.values(r.deletedBy).some(Boolean)));

    const employees = readEmployees().filter(e => sameD(e.department));
    const empByCode = new Map(employees.map(e => [normalizeEmpCode(e.empCode || e.code), e]));
    const hazards = readHazards().filter(h => notDeleted(h) && sameD(h.department || h.dept));
    const permits = getPermitsArray().filter(p => notDeleted(p) && sameD(p.department));
    const penalties = readPenalties().filter(p => p.status !== 'deleted' && sameD(p.department));
    const drills = readDrills().filter(d => notDeleted(d));
    const trainings = readTrainings().filter(t => notDeleted(t));
    const deptCodes = new Set(employees.map(e => normalizeEmpCode(e.empCode || e.code)));
    const attInScope = a => !scopeDept || deptCodes.has(normalizeEmpCode(a.empCode || a.code || a.employeeCode || a.id || ''));

    const RISK = { H: 'عالية', M: 'متوسطة', L: 'منخفضة', C: 'حرجة' };
    const HAZ_ST = { open: 'مفتوح', in_progress: 'جاري التعامل', pending_maintenance: 'محوّل للصيانة', closed: 'مقفول', resolved: 'اتحل', rejected: 'مرفوض', rejected_by_maintenance: 'مرفوض من الصيانة' };
    const PER_ST = { approved: 'معتمد', pending: 'مستني أدمن القسم', pending_dept: 'مستني أدمن القسم', pending_area_head: 'مستني أدمن القسم', pending_hse: 'مستني اعتماد السلامة', rejected: 'مرفوض', closed_safe: 'اتقفل بأمان', closed_incomplete: 'اتقفل (لم يكتمل)', closed_forced: 'إغلاق جبري' };
    const PER_TYPE = { lockout: 'فصل وعزل (LOTO)', general: 'عام', hot: 'عمل ساخن', height: 'عمل على ارتفاعات', lifting: 'رفع', excavation: 'حفر', confined: 'أماكن مغلقة' };
    const trDur = t => {
      for (const k of ['durationHours', 'hours', 'duration']) {
        const v = t[k];
        if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) return Number(v);
      }
      return t.durationMinutes ? Number(t.durationMinutes) / 60 : 0.5;
    };
    const isOpenHaz = h => !/^(closed|resolved|rejected)/.test(String(h.status || 'open'));
    const days = (a, b) => {
      const x = new Date(a), y = new Date(b);
      return (isNaN(x) || isNaN(y)) ? '' : Math.max(0, Math.round((y - x) / 86400000));
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'HSE Platform — Elsewedy Polymers';
    wb.created = new Date();

    pbiAddSheet(wb, 'بلاغات الخطورة',
      ['رقم البلاغ', 'التاريخ', 'الشهر', 'السنة', 'القسم', 'المنطقة', 'الوصف', 'درجة الخطورة', 'كود الخطورة', 'الحالة', 'كود الحالة', 'مفتوح؟', 'متأخر أكتر من 48 ساعة؟', 'المُبلِّغ', 'كود الموظف', 'تاريخ الإغلاق', 'أيام حتى الإغلاق', 'الإجراء المتخذ'],
      hazards.map(h => [
        h.id, pbiDate(h.date || h.submittedAt), pbiMonth(h.date || h.submittedAt), pbiYear(h.date || h.submittedAt),
        h.department || '', h.area || '', h.description || '',
        RISK[String(h.riskLevel || '').toUpperCase()] || '', String(h.riskLevel || '').toUpperCase(),
        HAZ_ST[h.status] || h.status || 'مفتوح', h.status || 'open',
        pbiYesNo(isOpenHaz(h)),
        pbiYesNo(isOpenHaz(h) && Date.now() - new Date(h.date || h.submittedAt).getTime() > 48 * 3600 * 1000),
        h.reporterName || '', h.empCode || '', pbiDate(h.resolvedAt),
        h.resolvedAt ? days(h.date || h.submittedAt, h.resolvedAt) : '', h.actionTaken || '',
      ]),
      [26, 12, 10, 8, 22, 10, 45, 14, 12, 16, 14, 10, 12, 24, 12, 12, 12, 40]);

    pbiAddSheet(wb, 'تصاريح العمل',
      ['رقم التصريح', 'التاريخ', 'الشهر', 'السنة', 'القسم', 'نوع التصريح', 'كود النوع', 'الحالة', 'كود الحالة', 'المكان', 'مقدّم الطلب', 'كود الموظف', 'من الساعة', 'إلى الساعة', 'مدير المنطقة', 'مسؤول السلامة', 'تاريخ المراجعة', 'الوصف'],
      permits.map(p => [
        p.id, pbiDate(p.date || p.createdAt), pbiMonth(p.date || p.createdAt), pbiYear(p.date || p.createdAt),
        p.department || '', PER_TYPE[p.typeKey] || p.typeLabel || '', p.typeKey || '',
        PER_ST[p.status] || p.status || '', p.status || '',
        p.location || '', p.workerName || '', p.employeeId || '', p.timeFrom || '', p.timeTo || '',
        p.areaManagerName || '', p.safetyOfficerName || '', pbiDate(p.reviewedAt), p.description || '',
      ]),
      [26, 12, 10, 8, 22, 20, 12, 20, 16, 22, 24, 12, 10, 10, 22, 22, 12, 40]);

    pbiAddSheet(wb, 'المحاضرات',
      ['رقم المحاضرة', 'العنوان', 'الموضوع', 'التاريخ', 'الشهر', 'السنة', 'المحاضر', 'عدد الساعات', 'عدد الحضور', 'الحالة'],
      trainings.map(t => {
        const att = (t.attendees || []).filter(attInScope);
        return [t.id, t.title || '', t.topic || '', pbiDate(t.date || t.createdAt), pbiMonth(t.date || t.createdAt), pbiYear(t.date || t.createdAt), t.trainer || '', trDur(t), att.length, t.status || ''];
      }).filter(r => !scopeDept || r[8] > 0),
      [26, 34, 28, 12, 10, 8, 22, 12, 12, 12]);

    const attendanceRows = [];
    trainings.forEach(t => {
      (t.attendees || []).filter(attInScope).forEach(a => {
        const code = normalizeEmpCode(a.empCode || a.code || a.id || '');
        const emp = empByCode.get(code);
        attendanceRows.push([
          t.id, t.title || t.topic || '', pbiDate(t.date || t.createdAt), pbiMonth(t.date || t.createdAt), pbiYear(t.date || t.createdAt),
          trDur(t), code, a.name || (emp && emp.name) || '', (emp && emp.department) || a.department || '',
          pbiYesNo(a.verified !== false), t.trainer || '',
        ]);
      });
    });
    pbiAddSheet(wb, 'حضور المحاضرات',
      ['رقم المحاضرة', 'العنوان', 'التاريخ', 'الشهر', 'السنة', 'عدد الساعات', 'كود الموظف', 'اسم الموظف', 'القسم', 'حضور مؤكد؟', 'المحاضر'],
      attendanceRows, [26, 32, 12, 10, 8, 12, 12, 28, 22, 12, 22]);

    pbiAddSheet(wb, 'تجارب الطوارئ',
      ['رقم التجربة', 'العنوان', 'التاريخ', 'الشهر', 'السنة', 'المكان', 'المسؤول', 'الحالة', 'عدد الحضور'],
      drills.map(d => [d.id, d.title || '', pbiDate(d.date || d.createdAt), pbiMonth(d.date || d.createdAt), pbiYear(d.date || d.createdAt), d.location || '', d.trainer || '', d.status || '', (d.attendees || []).filter(attInScope).length]),
      [24, 34, 12, 10, 8, 26, 22, 12, 12]);

    pbiAddSheet(wb, 'الجزاءات',
      ['رقم الجزاء', 'التاريخ', 'الشهر', 'السنة', 'كود الموظف', 'اسم الموظف', 'القسم', 'الوظيفة', 'السبب', 'صادر من', 'الحالة'],
      penalties.map(p => [p.id, pbiDate(p.date || p.createdAt), pbiMonth(p.date || p.createdAt), pbiYear(p.date || p.createdAt), p.empCode || '', p.empName || '', p.department || '', p.jobTitle || '', p.reason || '', p.issuedBy || '', p.status || '']),
      [24, 12, 10, 8, 12, 28, 22, 24, 45, 22, 12]);

    const creds = readWorkerCreds();
    pbiAddSheet(wb, 'الموظفين',
      ['كود الموظف', 'الاسم', 'القسم', 'الوظيفة', 'رقم الموبايل', 'الإيميل', 'عنده رقم؟', 'عنده إيميل؟', 'مسجّل على المنصة؟'],
      employees.map(e => {
        const code = normalizeEmpCode(e.empCode || e.code);
        const cred = creds[code] || {};
        const phone = e.phone || cred.phone || '';
        const email = e.email || cred.email || '';
        return [e.empCode || code, e.name || '', e.department || '', e.jobTitle || '', phone, email, pbiYesNo(!!phone), pbiYesNo(!!email), pbiYesNo(!!cred.hash)];
      }),
      [12, 30, 22, 26, 16, 28, 10, 10, 14]);

    const comp = chatbotAnalytics.complianceData(
      { user: { role: 'super_admin' }, data: chatbotData() },
      { depts: scopeDept ? [scopeDept] : [] }
    );
    pbiAddSheet(wb, 'الالتزام بالأهداف',
      ['كود الموظف', 'الاسم', 'القسم', 'ساعات التدريب من أول السنة', 'تارجت الساعات', 'حقق تارجت التدريب؟', 'بلاغات الخطورة من أول السنة', 'تارجت البلاغات', 'حقق تارجت البلاغات؟', 'الربع'],
      comp.rows.map(r => [
        r.emp.empCode || '', r.emp.name || '', r.emp.department || '',
        Math.round(r.hours * 10) / 10, comp.targetHours, pbiYesNo(r.trainOk),
        r.hazards, comp.targetHazards, pbiYesNo(r.hazOk), comp.label,
      ]),
      [12, 30, 22, 18, 14, 14, 18, 14, 14, 18]);

    const byDept = new Map();
    comp.rows.forEach(r => {
      const d = String(r.emp.department || 'غير محدد').trim();
      if (!byDept.has(d)) byDept.set(d, { d, n: 0, t: 0, h: 0 });
      const b = byDept.get(d);
      b.n++; if (r.trainOk) b.t++; if (r.hazOk) b.h++;
    });
    pbiAddSheet(wb, 'التزام الأقسام',
      ['القسم', 'عدد الموظفين', 'حققوا تارجت التدريب', 'نسبة التدريب %', 'حققوا تارجت البلاغات', 'نسبة البلاغات %', 'نسبة الالتزام الكلية %', 'الربع'],
      [...byDept.values()].sort((a, b) => (b.t / b.n + b.h / b.n) - (a.t / a.n + a.h / a.n)).map(b => [
        b.d, b.n, b.t, Math.round((b.t / b.n) * 100), b.h, Math.round((b.h / b.n) * 100),
        Math.round(((b.t / b.n) + (b.h / b.n)) * 50), comp.label,
      ]),
      [24, 14, 18, 14, 18, 14, 18, 18]);

    const openHaz = hazards.filter(isOpenHaz);
    pbiAddSheet(wb, 'ملخص',
      ['البند', 'القيمة'],
      [
        ['نطاق البيانات', scopeDept ? `قسم ${scopeDept}` : 'المصنع كله'],
        ['تاريخ التصدير', new Date().toISOString().slice(0, 16).replace('T', ' ')],
        ['عدد الموظفين', employees.length],
        ['إجمالي بلاغات الخطورة', hazards.length],
        ['بلاغات مفتوحة', openHaz.length],
        ['بلاغات متأخرة أكتر من 48 ساعة', openHaz.filter(h => Date.now() - new Date(h.date || h.submittedAt).getTime() > 48 * 3600 * 1000).length],
        ['إجمالي تصاريح العمل', permits.length],
        ['تصاريح مستنية اعتماد', permits.filter(p => /^pending/.test(String(p.status || ''))).length],
        ['عدد المحاضرات', trainings.length],
        ['إجمالي الحضور', attendanceRows.length],
        ['إجمالي ساعات التدريب', Math.round(attendanceRows.reduce((s, r) => s + Number(r[5] || 0), 0) * 10) / 10],
        ['تجارب الطوارئ', drills.length],
        ['الجزاءات', penalties.length],
        ['نسبة الالتزام الكلية %', comp.rows.length ? Math.round(((comp.rows.filter(r => r.trainOk).length + comp.rows.filter(r => r.hazOk).length) / (2 * comp.rows.length)) * 100) : 0],
      ], [34, 30]);

    const charts = Array.isArray(req.body && req.body.charts) ? req.body.charts : [];
    if (charts.length) {
      const wsCharts = wb.addWorksheet('الرسوم البيانية');
      wsCharts.getColumn(1).width = 90;
      addCompanyLogoToSheet(wb, wsCharts, { col: 0, row: 0, width: 120, height: 52 });
      let rowCursor = 4;
      for (const chart of charts) {
        if (!chart || typeof chart.dataUrl !== 'string') continue;
        const m = chart.dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
        if (!m) continue;
        const cell = wsCharts.getCell(`A${rowCursor}`);
        cell.value = sanitizeStr(chart.title || '', 120);
        cell.font = { bold: true, size: 13, color: { argb: 'FF7C1D1D' } };
        rowCursor += 1;
        const imageId = wb.addImage({ buffer: Buffer.from(m[2], 'base64'), extension: m[1] === 'png' ? 'png' : 'jpeg' });
        wsCharts.addImage(imageId, { tl: { col: 0, row: rowCursor - 1 }, ext: { width: 620, height: 300 } });
        rowCursor += 17;
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    setDownloadFilename(res, `بيانات لوحة التحكم - Power BI - ${new Date().toISOString().slice(0, 10)}`, 'xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[Dashboard] Power BI export failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل إنشاء ملف البيانات' });
  }
};

router.get('/api/dashboard/export-powerbi', authenticateTokenFlexible, requireRole(...PBI_ROLES), exportPowerBiHandler);
router.post('/api/dashboard/export-powerbi', authenticateToken, requireRole(...PBI_ROLES), exportPowerBiHandler);

module.exports = router;
