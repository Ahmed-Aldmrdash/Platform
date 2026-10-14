'use strict';

// Parser for the legacy Excel work-permit registers (Arabic or English headers, merged and formula cells).

const ExcelJS = require('exceljs');

const TYPE_MAP = [
  { key: 'hot',        words: ['ساخن', 'hot'] },
  { key: 'lockout',    words: ['فصل', 'عزل', 'lockout'] },
  { key: 'height',     words: ['ارتفاع', 'height'] },
  { key: 'excavation', words: ['حفر', 'excavation'] },
  { key: 'confined',   words: ['اماكن مغلقة', 'أماكن مغلقة', 'confined'] },
  { key: 'lifting',    words: ['رفع', 'lifting'] },
  { key: 'general',    words: ['عام', 'general'] }
];

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => (r && r.text) || '').join('');
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
    return '';
  }
  return String(v);
}
function cellValue(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.result !== undefined) return v.result;
    if (Array.isArray(v.richText) || v.text !== undefined) return cellText(v);
  }
  return v;
}

const HEADER_TOKEN_RE = /^(ptw\s*no\.?|no\.?\s*ptw|type|permit\s*type|department|dept\.?|shift|date|description|details?|location|executive(\s*officer)?|safety(\s*(supervisor|officer))?|area\s*manager|time|start|end|from|to|نوع التصريح|نوع|القسم|الوردية|التاريخ|الوصف|وصف العمل|الموقع|مسئول التنفيذ|مسؤول التنفيذ|مسئول السلامة|مسؤول السلامة|مشرف السلامه|مشرف السلامة|مدير المنطقة|مدير المنطقه|الوقت|من|الي|الى|إلى|رقم التصريح)$/i;
function isHeaderLikeRow(texts) {
  return texts.filter(t => t && HEADER_TOKEN_RE.test(String(t).trim())).length >= 2;
}

function mapTypeKey(label) {
  const l = String(label || '').trim();
  for (const t of TYPE_MAP) {
    if (t.words.some(w => l.includes(w))) return t.key;
  }
  return 'general';
}

function parseExcelTimeTo24h(value) {
  if (value === null || value === undefined || value === '') return '';

  if (value instanceof Date) {
    const h = value.getUTCHours();
    const m = value.getUTCMinutes();
    if (Number.isNaN(h) || Number.isNaN(m)) return '';
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  if (typeof value === 'number') {
    const totalMinutes = Math.round((value % 1) * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  let str = String(value).trim();
  if (!str) return '';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  str = str.replace(/[٠-٩]/g, d => String(arabicDigits.indexOf(d)));
  str = str.replace(/\s+/g, '');
  const m = str.match(/^(\d{1,2}):(\d{2})(am|pm|ص|م)?$/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const suffix = m[3] ? m[3].toLowerCase() : '';
  if (suffix) {
    const isPM = suffix === 'pm' || suffix === 'م';
    const isAM = suffix === 'am' || suffix === 'ص';
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function detectHeaderAndColumns(sheet) {
  let headerRowNumber = 0;
  const colMap = {};

  sheet.eachRow((row, rowNum) => {
    if (headerRowNumber || rowNum > 6) return;
    const vals = row.values.map(v => cellText(v).trim());
    const joinedLower = vals.join(' ').toLowerCase();
    const hasPtwNo = joinedLower.includes('ptw') || vals.some(v => v.includes('تصريح'));
    const hasDate  = joinedLower.includes('date') || vals.some(v => v.includes('تاريخ'));
    if (!hasPtwNo || !hasDate) return;

    headerRowNumber = rowNum;
    vals.forEach((v, idx) => {
      if (!v) return;
      const val = v.toLowerCase();
      if (!colMap.ptwNo && ((val.includes('رقم') && val.includes('تصريح')) || val.includes('ptw'))) colMap.ptwNo = idx;
      else if (!colMap.timeFrom && (val.includes('بداية') || val.includes('start'))) colMap.timeFrom = idx;
      else if (!colMap.timeTo && (val.includes('نهاية') || val.includes('end'))) colMap.timeTo = idx;
      else if (!colMap.type && (val.includes('نوع') || val.includes('type'))) colMap.type = idx;
      else if (!colMap.dept && (val.includes('قسم') || val.includes('department'))) colMap.dept = idx;
      else if (!colMap.shift && (val.includes('وردية') || val.includes('shift'))) colMap.shift = idx;
      else if (!colMap.desc && (val.includes('وصف') || val.includes('description') || val.includes('detail'))) colMap.desc = idx;
      else if (!colMap.date && (val.includes('تاريخ') || val.includes('date'))) colMap.date = idx;
      else if (!colMap.executive && (val.includes('تنفيذ') || val.includes('executive'))) colMap.executive = idx;
      else if (!colMap.safety && (val.includes('سلام') || val.includes('safety'))) colMap.safety = idx;
      else if (!colMap.areaManager && (val.includes('منطق') || val.includes('area manager') || (val.includes('area') && val.includes('manager')))) colMap.areaManager = idx;
      else if (!colMap.location && (val.includes('موقع') || val.includes('location'))) colMap.location = idx;
      else if (!colMap.timeMain && (val.includes('وقت') || val.includes('time'))) colMap.timeMain = idx;
    });
  });

  if (!headerRowNumber) return { headerRowNumber: 0, colMap };

  if (colMap.timeMain != null && colMap.timeFrom == null && colMap.timeTo == null) {
    for (let off = 1; off <= 3; off++) {
      const subRow = sheet.getRow(headerRowNumber + off);
      const c1 = cellText(subRow.getCell(colMap.timeMain).value).trim().toLowerCase();
      const c2 = cellText(subRow.getCell(colMap.timeMain + 1).value).trim().toLowerCase();
      if (colMap.timeFrom == null && (c1.includes('من') || c1.includes('start') || c1.includes('بداية'))) {
        colMap.timeFrom = colMap.timeMain;
      }
      if (colMap.timeTo == null && (c2.includes('الي') || c2.includes('الى') || c2.includes('إلى') || c2.includes('end') || c2.includes('نهاية'))) {
        colMap.timeTo = colMap.timeMain + 1;
      }
      if (colMap.timeFrom != null && colMap.timeTo != null) break;
    }
    if (colMap.timeFrom == null) colMap.timeFrom = colMap.timeMain;
    if (colMap.timeTo == null) colMap.timeTo = colMap.timeMain + 1;
  }

  return { headerRowNumber, colMap };
}

async function parsePermitsWorkbook(buffer, employees) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const nameToEmp = new Map();
  (employees || []).forEach(e => {
    const n = String(e.name || '').trim();
    if (n) nameToEmp.set(n, e);
  });

  const importedPermits = [];
  let skippedRows = 0;

  for (const sheet of workbook.worksheets) {
    const { headerRowNumber, colMap } = detectHeaderAndColumns(sheet);
    if (!headerRowNumber) continue;

    let lastDate = null;
    sheet.eachRow((row, rowNum) => {
      if (rowNum <= headerRowNumber) return;
      const vals = row.values;
      const txt = key => (colMap[key] == null ? '' : cellText(vals[colMap[key]]).trim());
      const ptwNo = txt('ptwNo');
      const desc  = txt('desc');
      if (!ptwNo && !desc) { skippedRows++; return; }
      if (isHeaderLikeRow(['ptwNo', 'type', 'dept', 'shift', 'desc', 'date', 'executive', 'safety', 'areaManager', 'location', 'timeFrom', 'timeTo'].map(txt))) {
        skippedRows++;
        return;
      }

      let d = null;
      const dateVal = cellValue(vals[colMap.date]);
      if (dateVal instanceof Date) {
        d = dateVal;
      } else if (typeof dateVal === 'number') {
        d = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
      } else if (typeof dateVal === 'string') {
        const parsed = new Date(dateVal.trim());
        if (!isNaN(parsed.getTime())) d = parsed;
      }
      if (d && !isNaN(d.getTime())) lastDate = d;
      else if (lastDate) d = lastDate;
      else { skippedRows++; return; }
      const dateStr = d.toISOString().split('T')[0];

      const typeLabelRaw    = txt('type') || 'عام';
      const executiveName   = txt('executive');
      const safetyName      = txt('safety');
      const areaManagerName = txt('areaManager');
      const workerName      = executiveName || safetyName || 'غير محدد';
      const matchedEmp      = nameToEmp.get(executiveName) || nameToEmp.get(safetyName) || null;
      const timeFrom = parseExcelTimeTo24h(cellValue(vals[colMap.timeFrom]));
      const timeTo   = parseExcelTimeTo24h(cellValue(vals[colMap.timeTo]));

      importedPermits.push({
        id:               'OLD-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '-' + rowNum,
        typeKey:          mapTypeKey(typeLabelRaw),
        typeLabel:        typeLabelRaw,
        typeFullLabel:    typeLabelRaw,
        department:       txt('dept'),
        shift:            txt('shift'),
        date:             dateStr,
        previousPermitNo: ptwNo,
        timeFrom:         timeFrom,
        timeTo:           timeTo,
        workerName:       workerName,
        requesterKind:    'موظف',
        requesterPhone:   '',
        employeeId:       matchedEmp ? String(matchedEmp.empCode || matchedEmp.code || '') : '',
        description:      desc,
        location:         txt('location'),
        equipment:        '',
        tools:            [],
        workersNames:     '',
        checklist:        [],
        checklistNote:    '',
        risks:            [],
        status:           'approved',
        reviewedBy:       safetyName,
        reviewedAt:       dateStr,
        reviewNote:       'مستورد من سجل تصاريح عمل قديم (Excel)',
        closure:          null,
        areaHeadReviewedBy:  areaManagerName,
        areaHeadReviewedAt:  dateStr,
        safetyOfficerName:   safetyName,
        areaManagerName:     areaManagerName,
        isImportedLegacy:    true,
        deletedBy: { areaAdmin: false, safetyAdmin: false, superAdmin: false, worker: false },
        createdAt: dateStr
      });
    });
  }

  return { importedPermits, skippedRows };
}

module.exports = { parsePermitsWorkbook, parseExcelTimeTo24h, mapTypeKey };
