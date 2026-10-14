'use strict';

// Excel export per section and import of the legacy monthly inspection sheets.

const express = require('express');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { normalizeArabic: normalizeArabicText } = require('../../chatbot/kb');
const {
  readInspectionItems, readInspectionRecords, readInspectionSections, writeInspectionItems,
  writeInspectionRecords,
} = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateToken, authenticateTokenFlexible, requireRole } = require('../../middleware/auth');
const { sanitizeStr } = require('../../utils/validation');
const { setDownloadFilename } = require('../../utils/http');
const { logAuditEvent } = require('../../services/audit-log');
const { finalizeExcel } = require('../../services/excel');
const { INSPECTION_ADMIN_ROLES } = require('./shared');

const router = express.Router();

router.get('/api/inspections/sections/:id/export', authenticateTokenFlexible, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  try {
    const sectionId = req.params.id;
    const sections = readInspectionSections();
    const section = sections.find(s => s.id === sectionId);
    if (!section) return res.status(404).send('Section not found');

    const type = req.query.type === 'items' ? 'items' : 'monthly';
    const items = readInspectionItems().filter(it => it.sectionId === sectionId)
      .sort((a, b) => String(a.itemNumber || '').localeCompare(String(b.itemNumber || ''), 'ar', { numeric: true }));

    const wb = new ExcelJS.Workbook();
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const whiteBold = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };

    if (type === 'items') {
      const ws = wb.addWorksheet('Items');
      const headerRow = ws.addRow(['م', 'رقم/كود الصنف', 'الاسم/النوع', 'القسم', 'المكان']);
      headerRow.font = whiteBold; headerRow.fill = headerFill;
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.columns = [{ width: 6 }, { width: 18 }, { width: 32 }, { width: 22 }, { width: 28 }];
      items.forEach((it, i) => {
        ws.addRow([i + 1, it.itemNumber || '', it.name || '', it.department || '', it.location || '']);
      });
      finalizeExcel(wb, 'الفحص الشهري');
      setDownloadFilename(res, `الفحص الشهري - ${section.name} - سجل الأصناف`, 'xlsx');
    } else {
      const year = parseInt(req.query.year, 10) || new Date().getFullYear();
      const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
      const records = readInspectionRecords();
      const recMap = new Map();
      records.forEach(r => { if (r.sectionId === sectionId && r.year === year && r.month === month) recMap.set(r.itemId, r); });

      const ws = wb.addWorksheet(`${month}-${year}`);
      ws.addRow([`قسم الفحص: ${section.name} (${section.category})   |   الشهر: ${month}/${year}`]);
      ws.getRow(1).getCell(1).style = { font: { bold: true, size: 13, color: { argb: 'FF1E3A5F' } }, alignment: { horizontal: 'right' } };
      ws.mergeCells('A1:I1');
      ws.addRow([]);
      const headerRow = ws.addRow(['م', 'رقم/كود الصنف', 'الاسم/النوع', 'القسم', 'المكان', 'نتيجة الفحص', 'الملاحظات', 'تاريخ الفحص', 'القائم بالفحص']);
      headerRow.font = whiteBold; headerRow.fill = headerFill;
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.columns = [{ width: 6 }, { width: 16 }, { width: 30 }, { width: 20 }, { width: 26 }, { width: 14 }, { width: 30 }, { width: 14 }, { width: 20 }];
      items.forEach((it, i) => {
        const r = recMap.get(it.id);
        ws.addRow([
          i + 1, it.itemNumber || '', it.name || '', it.department || '', it.location || '',
          r ? r.status : 'لم يتم الفحص', r ? (r.notes || '') : '',
          r && r.inspectionDate ? r.inspectionDate : '', r ? (r.inspector || '') : ''
        ]);
      });
      finalizeExcel(wb, 'الفحص الشهري');
      setDownloadFilename(res, `الفحص الشهري - ${section.name} - ${month}-${year}`, 'xlsx');
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Inspection export error:', err);
    if (!res.headersSent) res.status(500).send('Error generating Excel file');
  }
});

const LEGACY_OK_HEADERS = ['مطابق', 'مطابقة', 'مطابقه', 'جيد', 'جيدة', 'جيده', 'سليم', 'سليمة', 'سليمه', 'صالح', 'صالحة'];
const LEGACY_BAD_HEADERS = ['غير مطابق', 'غير مطابقة', 'غير مطابقه', 'غير جيد', 'غير جيدة', 'غير جيده', 'غير سليم', 'غير سليمة', 'غير صالح', 'غير صالحة', 'تالف'];
const cleanHeader = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const isLegacyOkHeader = raw => LEGACY_OK_HEADERS.includes(raw);
const isLegacyBadHeader = raw => LEGACY_BAD_HEADERS.includes(raw);

function findLegacyInspectionHeaderRow(ws) {
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= ws.columnCount; c++) {
      if (isLegacyOkHeader(cleanHeader(row.getCell(c).value))) return r;
    }
  }
  return null;
}

function parseLegacyInspectionSheet(ws) {
  const headerRowIdx = findLegacyInspectionHeaderRow(ws);
  if (!headerRowIdx) return null;
  const headerRow = ws.getRow(headerRowIdx);
  const cols = { compliantCol: null, nonCompliantCol: null, notesCol: null, dateCol: null, inspectorCol: null, deptCol: null, locationCol: null };
  let itemNumberCol = null;
  const typeCols = [];

  for (let c = 1; c <= ws.columnCount; c++) {
    const raw = String(headerRow.getCell(c).value || '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    if (isLegacyOkHeader(raw) && cols.compliantCol == null) cols.compliantCol = c;
    else if (isLegacyBadHeader(raw) && cols.nonCompliantCol == null) cols.nonCompliantCol = c;
    else if ((raw.includes('الملاحظات') || raw.includes('وصف المشكلة') || raw.includes('الملاحظة')) && !raw.includes('تعديل') && !raw.includes('صور') && cols.notesCol == null) cols.notesCol = c;
    else if (raw.includes('تاريخ الفحص') && cols.dateCol == null) cols.dateCol = c;
    else if (raw.includes('القائم بالفحص') && cols.inspectorCol == null) cols.inspectorCol = c;
    else if (raw.includes('القسم') && cols.deptCol == null) cols.deptCol = c;
    else if ((raw.includes('المكان') || raw.includes('الموقع')) && cols.locationCol == null) cols.locationCol = c;
    else if ((raw.includes('رقم') || raw.includes('النوع') || raw.includes('انوع') || raw.includes('البند')) && itemNumberCol == null) itemNumberCol = c;
    else if (itemNumberCol != null && cols.compliantCol == null) typeCols.push(c);
  }
  if (itemNumberCol == null) itemNumberCol = 1;
  return { headerRowIdx, itemNumberCol, typeCols, ...cols };
}

const importLegacyExcelHandler = async (req, res) => {
  const sectionId = req.params.id;
  const { base64Data } = req.body || {};
  if (!base64Data) return res.status(400).json({ error: 'لا يوجد ملف' });

  let result;
  await enqueueWrite(async () => {
    const sections = readInspectionSections();
    const section = sections.find(s => s.id === sectionId);
    if (!section) { result = { status: 404, body: { error: 'القسم غير موجود' } }; return; }

    let wb;
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
    } catch (err) {
      result = { status: 400, body: { error: 'تعذّر قراءة ملف الإكسيل — تأكد إنه بصيغة xlsx صحيحة' } };
      return;
    }

    const allItems = readInspectionItems();
    const allRecords = readInspectionRecords();
    const itemByKey = new Map();
    allItems.filter(it => it.sectionId === sectionId).forEach(it => {
      itemByKey.set(`${it.itemNumber}|${it.department}|${it.location}`, it);
    });
    const recordByKey = new Map();
    allRecords.forEach(r => recordByKey.set(`${r.itemId}|${r.year}|${r.month}`, r));

    const now = new Date().toISOString();
    const newItems = [];
    const newRecords = [];
    let itemsCreated = 0, recordsCreated = 0, recordsUpdated = 0, rowsSkippedNoDate = 0, sheetsParsed = 0, sheetsSkipped = 0;

    wb.eachSheet(ws => {
      const parsed = parseLegacyInspectionSheet(ws);
      if (!parsed) { sheetsSkipped++; return; }
      sheetsParsed++;

      for (let r = parsed.headerRowIdx + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const itemNumberRaw = row.getCell(parsed.itemNumberCol).value;
        if (itemNumberRaw === null || itemNumberRaw === undefined || String(itemNumberRaw).trim() === '') continue;
        const itemNumber = String(itemNumberRaw).trim();
        const department = parsed.deptCol ? String(row.getCell(parsed.deptCol).value || '').trim() : '';
        const location = parsed.locationCol ? String(row.getCell(parsed.locationCol).value || '').trim() : '';
        const typeParts = parsed.typeCols.map(c => String(row.getCell(c).value || '').trim()).filter(Boolean);
        const key = `${itemNumber}|${department}|${location}`;

        let item = itemByKey.get(key);
        if (!item) {
          item = {
            id: 'INSITM-' + Date.now() + '-' + newItems.length + '-' + crypto.randomBytes(3).toString('hex'),
            sectionId,
            itemNumber,
            name: typeParts.length ? typeParts.join(' - ') : `${section.name} #${itemNumber}`,
            department, location,
            createdAt: now, createdBy: `legacy-import:${req.user.username || req.user.id}`,
            updatedAt: null, updatedBy: null
          };
          itemByKey.set(key, item);
          newItems.push(item);
          itemsCreated++;
        }

        const compliantVal = parsed.compliantCol ? row.getCell(parsed.compliantCol).value : null;
        const nonCompliantVal = parsed.nonCompliantCol ? row.getCell(parsed.nonCompliantCol).value : null;
        let status = null;
        if (compliantVal !== null && compliantVal !== undefined && String(compliantVal).trim() !== '') status = 'مطابق';
        else if (nonCompliantVal !== null && nonCompliantVal !== undefined && String(nonCompliantVal).trim() !== '') status = 'غير مطابق';
        if (!status) continue;

        const dateVal = parsed.dateCol ? row.getCell(parsed.dateCol).value : null;
        let dateObj = null;
        if (dateVal instanceof Date) dateObj = dateVal;
        else if (dateVal) { const d = new Date(dateVal); if (!isNaN(d)) dateObj = d; }
        if (!dateObj) { rowsSkippedNoDate++; continue; }

        const y = dateObj.getFullYear(), m = dateObj.getMonth() + 1;
        const notes = parsed.notesCol ? String(row.getCell(parsed.notesCol).value || '').trim() : '';
        const inspector = parsed.inspectorCol ? String(row.getCell(parsed.inspectorCol).value || '').trim() : '';
        const recKey = `${item.id}|${y}|${m}`;
        const existingRec = recordByKey.get(recKey);

        if (existingRec) {
          existingRec.status = status;
          if (notes) existingRec.notes = notes;
          existingRec.inspectionDate = dateObj.toISOString().slice(0, 10);
          if (inspector) existingRec.inspector = inspector;
          recordsUpdated++;
        } else {
          const rec = {
            id: 'INSREC-' + Date.now() + '-' + newRecords.length + '-' + crypto.randomBytes(3).toString('hex'),
            sectionId, itemId: item.id, year: y, month: m, status, notes,
            inspectionDate: dateObj.toISOString().slice(0, 10), inspector,
            createdAt: now, createdBy: `legacy-import:${req.user.username || req.user.id}`,
            updatedAt: null, updatedBy: null
          };
          recordByKey.set(recKey, rec);
          newRecords.push(rec);
          recordsCreated++;
        }
      }
    });

    if (sheetsParsed === 0) {
      result = { status: 400, body: { error: 'لم يتم التعرف على تنسيق الملف — يجب أن يحتوي عمود "مطابق" في أول 6 صفوف من كل ورقة' } };
      return;
    }

    const okItems = writeInspectionItems(allItems.concat(newItems));
    const okRecords = writeInspectionRecords(allRecords.concat(newRecords));
    if (okItems && okRecords) {
      logAuditEvent({
        entityType: 'inspection-section', entityId: sectionId, action: 'import-legacy-excel', actor: req.user,
        note: `${section.name}: ${itemsCreated} صنف جديد، ${recordsCreated} سجل جديد، ${recordsUpdated} سجل مُحدَّث (من ${sheetsParsed} ورقة)`
      });
      result = {
        status: 200,
        body: {
          success: true,
          itemsCreated, recordsCreated, recordsUpdated,
          sheetsParsed, sheetsSkipped, rowsSkippedNoDate
        }
      };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ البيانات المستوردة' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
};

router.post('/api/inspections/sections/:id/import-legacy-excel', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), importLegacyExcelHandler);

function normalizeSectionKey(s) {
  return normalizeArabicText(String(s || ''))
    .replace(/\.(xlsx|xlsm|xls)$/i, '')
    .replace(/\.lsx$/i, '')
    .replace(/^[\s\d\-_.]+/, '')
    .replace(/[\s\-_().]+/g, ' ')
    .replace(/(^|\s)ال/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchInspectionSectionByFileName(fileName, category) {
  const key = normalizeSectionKey(fileName);
  if (!key) return null;
  const sections = readInspectionSections().filter(s => !category || s.category === category);
  const scored = sections.map(s => {
    const sKey = normalizeSectionKey(s.name);
    if (!sKey) return { s, score: 0 };
    if (sKey === key) return { s, score: 100 };
    if (sKey.includes(key) || key.includes(sKey)) return { s, score: 80 };
    const a = new Set(key.split(' ').filter(w => w.length > 1));
    const b = new Set(sKey.split(' ').filter(w => w.length > 1));
    if (!a.size || !b.size) return { s, score: 0 };
    let hits = 0;
    a.forEach(w => { if (b.has(w)) hits++; });
    return { s, score: Math.round((hits / Math.max(a.size, b.size)) * 70) };
  }).sort((x, y) => y.score - x.score);
  const top = scored[0];
  return top && top.score >= 50 ? top.s : null;
}

router.post('/api/inspections/import-legacy-auto', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const category = String((req.body && req.body.category) || '').toUpperCase();
  const fileName = sanitizeStr((req.body && req.body.fileName) || '', 200);
  if (category !== 'P1' && category !== 'P2') return res.status(400).json({ error: 'حدّد البرنامج (P1 أو P2)' });
  if (!fileName) return res.status(400).json({ error: 'اسم الملف مطلوب' });
  if (!req.body || !req.body.base64Data) return res.status(400).json({ error: 'لا يوجد ملف' });

  const section = matchInspectionSectionByFileName(fileName, category);
  if (!section) {
    return res.status(404).json({
      error: `مش لاقي قسم في ${category} باسم قريب من "${fileName}" — افتح القسم المناسب وارفع الملف من جوه، أو غيّر اسم الملف لاسم القسم`,
      unmatched: true, fileName,
    });
  }
  req.params = { ...(req.params || {}), id: section.id };
  const origJson = res.json.bind(res);
  res.json = body => origJson({ ...body, fileName, section: { id: section.id, name: section.name, category: section.category } });
  return importLegacyExcelHandler(req, res);
});

module.exports = router;
