'use strict';

const fs = require('fs');
const config = require('../config');

const LOGO = config.paths.COMPANY_LOGO;

/** Places the company logo on a worksheet. */
function addCompanyLogoToSheet(wb, ws, opts = {}) {
  try {
    if (!fs.existsSync(LOGO)) return false;
    const imageId = wb.addImage({ filename: LOGO, extension: 'png' });
    ws.addImage(imageId, {
      tl: { col: opts.col != null ? opts.col : 0, row: opts.row != null ? opts.row : 0 },
      ext: { width: opts.width || 120, height: opts.height || 57 },
      editAs: 'oneCell',
    });
    return true;
  } catch (e) {
    console.warn('[excel] could not add logo:', e.message);
    return false;
  }
}

/** Inserts three branded rows (logo + title) above the table. */
function stampExcelHeader(wb, ws, title) {
  try {
    if (!ws) return;
    ws.spliceRows(1, 0, [], [], []);
    const t = ws.getRow(2).getCell(3);
    t.value = title || 'تقرير';
    t.font = { bold: true, size: 14, color: { argb: 'FF7C1D1D' } };
    const s = ws.getRow(3).getCell(3);
    s.value = `ELSEWEDY POLYMERS — منصة السلامة والصحة المهنية · ${new Date().toISOString().slice(0, 10)}`;
    s.font = { size: 9, color: { argb: 'FF6B6B6B' } };
    ws.getRow(1).height = 16;
    ws.getRow(2).height = 20;
    addCompanyLogoToSheet(wb, ws, { col: 0, row: 0, width: 110, height: 52 });
  } catch (e) {
    console.warn('[excel] could not stamp header:', e.message);
  }
}

/** Brands the first sheet of a workbook right before it is sent. */
function finalizeExcel(wb, title) {
  const ws = wb && wb.worksheets && wb.worksheets[0];
  if (ws) stampExcelHeader(wb, ws, title);
}

/** Excel serial numbers, Date objects and date strings → Date (or null). */
function excelCellToDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(Math.round((value - 25569) * 86400 * 1000));
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value.trim());
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

module.exports = { addCompanyLogoToSheet, stampExcelHeader, finalizeExcel, excelCellToDate, COMPANY_LOGO_PATH: LOGO };
