'use strict';

const ExcelJS = require('exceljs');
const { excelCellToDate } = require('../services/excel');
const { normalizeEmpCode, sanitizeStr } = require('../utils/validation');

const DEFAULT_COLUMNS = { code: 1, name: 2, dept: 3, pos: 4, date: 5, reason: 6, issuedBy: 7 };

function locateColumns(workbook) {
  for (const sheet of workbook.worksheets) {
    let found = null;
    sheet.eachRow((row, rowNum) => {
      if (found || rowNum > 5) return;
      const vals = row.values;
      const hasReason = vals.some((v) => v && String(v).includes('جزاء') && String(v).includes('سبب'));
      const hasName = vals.some((v) => v && String(v).includes('اسم'));
      if (!hasReason || !hasName) return;
      const cols = { ...DEFAULT_COLUMNS };
      vals.forEach((v, idx) => {
        if (!v) return;
        const val = String(v).toLowerCase();
        if (val.includes('كود') || val.includes('code')) cols.code = idx;
        else if (val.includes('اسم')) cols.name = idx;
        else if (val.includes('قسم')) cols.dept = idx;
        else if (val.includes('وظيفة')) cols.pos = idx;
        else if (val.includes('تاريخ')) cols.date = idx;
        else if (val.includes('سبب')) cols.reason = idx;
        else if (val.includes('مشرف') || val.includes('سيفتي')) cols.issuedBy = idx;
      });
      found = { sheet, headerRow: rowNum, cols };
    });
    if (found) return found;
  }
  return { sheet: workbook.worksheets[0], headerRow: 1, cols: { ...DEFAULT_COLUMNS } };
}

/**
 * Parses the legacy penalties sheet. Rows are matched to the employee
 * directory by code, then by exact name; rows without a reason are skipped.
 */
async function parsePenaltiesWorkbook(buffer, employees, importedBy) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const { sheet, headerRow, cols } = locateColumns(workbook);
  const penalties = [];
  let skipped = 0;
  if (!sheet) return { penalties, skipped };

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const vals = row.values;
    const text = (key) => String(vals[cols[key]] || '').trim();
    const rawCode = text('code');
    const name = text('name');
    const reason = text('reason');
    if (!name && !rawCode) return;
    if (!reason) {
      skipped += 1;
      return;
    }

    let emp = rawCode ? employees.find((e) => normalizeEmpCode(e.empCode) === normalizeEmpCode(rawCode)) : null;
    if (!emp && name) emp = employees.find((e) => String(e.name || '').trim() === name);
    const date = excelCellToDate(vals[cols.date]);

    penalties.push({
      id: `PEN-${Date.now()}-${Math.floor(Math.random() * 1000)}-${rowNumber}`,
      empCode: emp ? normalizeEmpCode(emp.empCode) : normalizeEmpCode(rawCode),
      empName: sanitizeStr(emp ? emp.name : name, 150),
      department: sanitizeStr(emp ? emp.department || '' : text('dept'), 100),
      jobTitle: sanitizeStr(emp ? emp.jobTitle || '' : text('pos'), 100),
      date: (date && !isNaN(date.getTime()) ? date : new Date()).toISOString().slice(0, 10),
      reason: sanitizeStr(reason, 1000),
      issuedBy: sanitizeStr(text('issuedBy') || 'غير محدد', 150),
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: sanitizeStr(importedBy || 'استيراد ملف', 150),
      imported: true,
    });
  });
  return { penalties, skipped };
}

module.exports = { parsePenaltiesWorkbook };
