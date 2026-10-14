'use strict';

const ExcelJS = require('exceljs');
const { emptyDeleteFlags } = require('../constants');
const { excelCellToDate } = require('../services/excel');
const { sanitizeStr } = require('../utils/validation');

const DEFAULT_COLUMNS = { code: 1, name: 2, dept: 3, pos: 4, hazard: 5, action: 6, area: 7, date: 8, sup: 9, status: 10, location: 11, severity: 12 };

/** Finds the header row (within the first 5 rows of any sheet) and maps column titles to fields. */
function locateColumns(workbook) {
  for (const sheet of workbook.worksheets) {
    let found = null;
    sheet.eachRow((row, rowNum) => {
      if (found || rowNum > 5) return;
      const vals = row.values;
      const hasCode = vals.some((v) => v && (String(v).toLowerCase().includes('code') || String(v).includes('كود')));
      const hasName = vals.some((v) => v && (String(v).toLowerCase().includes('name') || String(v).includes('اسم')));
      if (!hasCode || !hasName) return;
      const cols = { ...DEFAULT_COLUMNS };
      let deptFound = false;
      vals.forEach((v, idx) => {
        if (!v) return;
        const val = String(v).toLowerCase().trim();
        if (val.includes('code') || val.includes('كود')) cols.code = idx;
        else if (val.includes('name') || val.includes('اسم')) cols.name = idx;
        else if (val.includes('department') || val.includes('قسم')) {
          if (deptFound) cols.area = idx;
          else { cols.dept = idx; deptFound = true; }
        } else if (val.includes('position') || val.includes('وظيفة') || val.includes('مسمى')) cols.pos = idx;
        else if (val === 'الخطورة' || val === 'خطورة' || val.includes('severity')) cols.severity = idx;
        else if (val.includes('supervisor') || val.includes('مشرف')) cols.sup = idx;
        else if (val.includes('hazard') || val.includes('خطورة') || val.includes('بلاغ') || val.includes('وصف') || val.includes('نوع')) cols.hazard = idx;
        else if (val.includes('action') || val.includes('إجراء') || val.includes('متخذ')) cols.action = idx;
        else if (val.includes('location') || val.includes('منطقة')) cols.location = idx;
        else if (val.includes('date') || val.includes('تاريخ')) cols.date = idx;
        else if (val.includes('status') || val.includes('حالة')) cols.status = idx;
      });
      found = { sheet, headerRow: rowNum, cols };
    });
    if (found) return found;
  }
  return { sheet: workbook.worksheets[0], headerRow: 1, cols: { ...DEFAULT_COLUMNS } };
}

// "لم يتم" (not done) contains "تم" (done), so the negative forms are checked first.
function isClosedStatus(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const notDone = ['لميتم', 'لمتتم', 'لميحدث', 'open', 'مفتوح'].some((k) => s.includes(k));
  return !notDone && ['تم', 'closed', 'مغلق'].some((k) => s.includes(k));
}

function riskFromSeverityText(text) {
  const s = String(text || '');
  if (s.includes('عالي') || s.includes('high')) return { riskLevel: 'H', severity: 'D' };
  if (s.includes('متوسط') || s.includes('medium')) return { riskLevel: 'M', severity: 'C' };
  return { riskLevel: 'L', severity: 'A' };
}

/** Parses the legacy hazard register workbook into hazard records. */
async function parseHazardsWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const { sheet, headerRow, cols } = locateColumns(workbook);
  const hazards = [];
  if (!sheet) return hazards;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const vals = row.values;
    const cell = (key, max = 1000) => sanitizeStr(String(vals[cols[key]] || '').trim(), max);
    const code = cell('code', 50);
    if (!code || code === 'undefined') return;

    let date = excelCellToDate(vals[cols.date]);
    if (date && (date.getFullYear() < 2000 || date.getFullYear() > 2100)) date = null;
    if (!date || isNaN(date.getTime())) date = new Date();
    const iso = date.toISOString();
    const closed = isClosedStatus(vals[cols.status]);
    const { riskLevel, severity } = riskFromSeverityText(vals[cols.severity]);

    hazards.push({
      id: `HAZ-${Date.now()}-${Math.floor(Math.random() * 1000)}-${rowNumber}`,
      reporterName: cell('name', 100),
      empCode: code,
      date: iso.split('T')[0],
      department: cell('dept', 100),
      area: sanitizeStr(String(vals[cols.location] || vals[cols.area] || '').trim(), 150),
      description: cell('hazard'),
      potentialInjury: '',
      proposedSolution: '',
      likelihood: 1,
      severity,
      riskLevel,
      status: closed ? 'closed' : 'open',
      actionTaken: cell('action'),
      hseName: cell('sup', 100),
      photoUrl: '',
      deletedBy: emptyDeleteFlags(),
      permanentlyDeletedBy: emptyDeleteFlags(),
      submittedAt: iso,
      treatmentStartedAt: closed ? iso : null,
      startedByName: closed ? 'الصيانة' : '',
      resolvedAt: closed ? iso : null,
      assignedToMaintenance: closed ? '' : 'الصيانة',
    });
  });
  return hazards;
}

module.exports = { parseHazardsWorkbook };
