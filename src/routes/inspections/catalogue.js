'use strict';

// Inspection programmes: sections, items and monthly records.

const express = require('express');
const crypto = require('crypto');
const {
  readInspectionItems, readInspectionRecords, readInspectionSections, writeInspectionItems,
  writeInspectionRecords, writeInspectionSections,
} = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { logAuditEvent } = require('../../services/audit-log');
const { computeInspectionStats, INSPECTION_ADMIN_ROLES } = require('./shared');

const router = express.Router();

router.get('/api/inspections/sections', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), (req, res) => {
  try {
    const category = (req.query.category || '').toUpperCase();
    if (category !== 'P1' && category !== 'P2') {
      return res.status(400).json({ error: 'يجب تحديد category=P1 أو category=P2' });
    }
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);

    const sections = readInspectionSections().filter(s => s.category === category);
    const items = readInspectionItems();
    const records = readInspectionRecords();

    const result = sections
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(s => {
        const sectionItems = items.filter(it => it.sectionId === s.id);
        const stats = computeInspectionStats(sectionItems, records, year, month);
        return Object.assign({}, s, stats);
      });

    res.json({ category, year, month, sections: result });
  } catch (err) {
    console.error('Inspection sections list error:', err);
    res.status(500).json({ error: 'فشل تحميل الأقسام' });
  }
});

router.post('/api/inspections/sections', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const { category, name } = req.body || {};
  const cat = (category || '').toUpperCase();
  if (cat !== 'P1' && cat !== 'P2') {
    return res.status(400).json({ error: 'يجب تحديد category=P1 أو category=P2' });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'اسم القسم مطلوب' });
  }
  let result;
  await enqueueWrite(async () => {
    const sections = readInspectionSections();
    const maxOrder = sections.filter(s => s.category === cat).reduce((m, s) => Math.max(m, s.order || 0), 0);
    const section = {
      id: 'INSEC-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
      category: cat,
      order: maxOrder + 1,
      name: String(name).trim(),
      createdAt: new Date().toISOString(),
      createdBy: req.user.username || req.user.id
    };
    const sections2 = sections.concat([section]);
    if (writeInspectionSections(sections2)) {
      logAuditEvent({ entityType: 'inspection-section', entityId: section.id, action: 'create', actor: req.user, note: `${cat}: ${section.name}` });
      result = { status: 201, body: { success: true, section } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ القسم' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.delete('/api/inspections/sections/:id', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const sectionId = req.params.id;
  const cascade = req.query.cascade === 'true';
  let result;
  await enqueueWrite(async () => {
    const sections = readInspectionSections();
    const idx = sections.findIndex(s => s.id === sectionId);
    if (idx === -1) {
      result = { status: 404, body: { error: 'القسم غير موجود' } };
      return;
    }
    const items = readInspectionItems();
    const sectionItemIds = items.filter(it => it.sectionId === sectionId).map(it => it.id);

    if (sectionItemIds.length > 0 && !cascade) {
      result = { status: 409, body: { error: `القسم يحتوي ${sectionItemIds.length} صنف. أضف ?cascade=true لحذف القسم وكل أصنافه وسجلاته نهائيًا.`, itemCount: sectionItemIds.length } };
      return;
    }

    const removedSection = sections[idx];
    const remainingSections = sections.slice(0, idx).concat(sections.slice(idx + 1));

    let remainingItems = items;
    let removedRecordsCount = 0;
    if (sectionItemIds.length > 0) {
      remainingItems = items.filter(it => it.sectionId !== sectionId);
      const records = readInspectionRecords();
      const remainingRecords = records.filter(r => {
        const belongs = sectionItemIds.includes(r.itemId);
        if (belongs) removedRecordsCount++;
        return !belongs;
      });
      writeInspectionRecords(remainingRecords);
    }

    if (writeInspectionSections(remainingSections) && writeInspectionItems(remainingItems)) {
      logAuditEvent({ entityType: 'inspection-section', entityId: sectionId, action: 'delete', actor: req.user, note: `${removedSection.category}: ${removedSection.name} (${sectionItemIds.length} صنف، ${removedRecordsCount} سجل فحص)` });
      result = { status: 200, body: { success: true } };
    } else {
      result = { status: 500, body: { error: 'فشل حذف القسم' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.get('/api/inspections/sections/:id/items', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), (req, res) => {
  try {
    const sectionId = req.params.id;
    const sections = readInspectionSections();
    const section = sections.find(s => s.id === sectionId);
    if (!section) return res.status(404).json({ error: 'القسم غير موجود' });

    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);

    const allItems = readInspectionItems().filter(it => it.sectionId === sectionId);
    const records = readInspectionRecords();
    const recMap = new Map();
    records.forEach(r => {
      if (r.sectionId === sectionId && r.year === year && r.month === month) recMap.set(r.itemId, r);
    });

    let merged = allItems.map(it => {
      const rec = recMap.get(it.id) || null;
      return Object.assign({}, it, {
        record: rec ? {
          id: rec.id, status: rec.status, notes: rec.notes || '',
          inspectionDate: rec.inspectionDate || null, inspector: rec.inspector || '',
          updatedAt: rec.updatedAt || rec.createdAt
        } : null,
        status: rec ? rec.status : 'لم يتم الفحص'
      });
    });

    const { department, status, q } = req.query;
    if (department) {
      merged = merged.filter(it => String(it.department || '').trim() === String(department).trim());
    }
    if (status) {
      merged = merged.filter(it => it.status === status);
    }
    if (q) {
      const qq = String(q).trim().toLowerCase();
      merged = merged.filter(it =>
        String(it.itemNumber || '').toLowerCase().includes(qq) ||
        String(it.name || '').toLowerCase().includes(qq) ||
        String(it.department || '').toLowerCase().includes(qq) ||
        String(it.location || '').toLowerCase().includes(qq)
      );
    }

    const stats = computeInspectionStats(allItems, records, year, month);
    res.json({ section, year, month, stats, items: merged });
  } catch (err) {
    console.error('Inspection items list error:', err);
    res.status(500).json({ error: 'فشل تحميل الأصناف' });
  }
});

router.post('/api/inspections/sections/:id/items', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const sectionId = req.params.id;
  const { itemNumber, name, department, location } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'اسم/نوع الصنف مطلوب' });
  }
  let result;
  await enqueueWrite(async () => {
    const sections = readInspectionSections();
    const section = sections.find(s => s.id === sectionId);
    if (!section) { result = { status: 404, body: { error: 'القسم غير موجود' } }; return; }

    const items = readInspectionItems();
    const item = {
      id: 'INSITM-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
      sectionId,
      itemNumber: itemNumber != null ? String(itemNumber).trim() : '',
      name: String(name).trim(),
      department: department ? String(department).trim() : '',
      location: location ? String(location).trim() : '',
      createdAt: new Date().toISOString(),
      createdBy: req.user.username || req.user.id,
      updatedAt: null,
      updatedBy: null
    };
    const items2 = items.concat([item]);
    if (writeInspectionItems(items2)) {
      logAuditEvent({ entityType: 'inspection-item', entityId: item.id, action: 'create', actor: req.user, note: `${section.name}: ${item.name}` });
      result = { status: 201, body: { success: true, item } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ الصنف' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/inspections/items/:id', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const itemId = req.params.id;
  const { itemNumber, name, department, location } = req.body || {};
  let result;
  await enqueueWrite(async () => {
    const items = readInspectionItems();
    const idx = items.findIndex(it => it.id === itemId);
    if (idx === -1) { result = { status: 404, body: { error: 'الصنف غير موجود' } }; return; }
    const it = items[idx];
    if (name != null && String(name).trim()) it.name = String(name).trim();
    if (itemNumber != null) it.itemNumber = String(itemNumber).trim();
    if (department != null) it.department = String(department).trim();
    if (location != null) it.location = String(location).trim();
    it.updatedAt = new Date().toISOString();
    it.updatedBy = req.user.username || req.user.id;
    if (writeInspectionItems(items)) {
      logAuditEvent({ entityType: 'inspection-item', entityId: itemId, action: 'update', actor: req.user, note: it.name });
      result = { status: 200, body: { success: true, item: it } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ التعديل' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.delete('/api/inspections/items/:id', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const itemId = req.params.id;
  let result;
  await enqueueWrite(async () => {
    const items = readInspectionItems();
    const idx = items.findIndex(it => it.id === itemId);
    if (idx === -1) { result = { status: 404, body: { error: 'الصنف غير موجود' } }; return; }
    const removed = items[idx];
    const remainingItems = items.slice(0, idx).concat(items.slice(idx + 1));

    const records = readInspectionRecords();
    let removedRecordsCount = 0;
    const remainingRecords = records.filter(r => {
      const belongs = r.itemId === itemId;
      if (belongs) removedRecordsCount++;
      return !belongs;
    });

    if (writeInspectionItems(remainingItems) && writeInspectionRecords(remainingRecords)) {
      logAuditEvent({ entityType: 'inspection-item', entityId: itemId, action: 'delete', actor: req.user, note: `${removed.name} (${removedRecordsCount} سجل فحص)` });
      result = { status: 200, body: { success: true } };
    } else {
      result = { status: 500, body: { error: 'فشل الحذف' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.put('/api/inspections/items/:id/records', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const itemId = req.params.id;
  const { year, month, status, notes, inspectionDate, inspector } = req.body || {};
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) {
    return res.status(400).json({ error: 'سنة/شهر غير صالحين' });
  }
  if (status !== 'مطابق' && status !== 'غير مطابق') {
    return res.status(400).json({ error: "نتيجة الفحص يجب أن تكون 'مطابق' أو 'غير مطابق'" });
  }
  let result;
  await enqueueWrite(async () => {
    const items = readInspectionItems();
    const item = items.find(it => it.id === itemId);
    if (!item) { result = { status: 404, body: { error: 'الصنف غير موجود' } }; return; }

    const records = readInspectionRecords();
    const existingIdx = records.findIndex(r => r.itemId === itemId && r.year === y && r.month === m);
    const now = new Date().toISOString();
    let record, previousStatus = null, isUpdate = false;

    if (existingIdx !== -1) {
      isUpdate = true;
      record = records[existingIdx];
      previousStatus = record.status;
      record.status = status;
      record.notes = notes != null ? String(notes) : '';
      record.inspectionDate = inspectionDate || record.inspectionDate || null;
      record.inspector = inspector != null ? String(inspector).trim() : (record.inspector || '');
      record.updatedAt = now;
      record.updatedBy = req.user.username || req.user.id;
    } else {
      record = {
        id: 'INSREC-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
        sectionId: item.sectionId,
        itemId,
        year: y,
        month: m,
        status,
        notes: notes != null ? String(notes) : '',
        inspectionDate: inspectionDate || null,
        inspector: inspector != null ? String(inspector).trim() : (req.user.name || ''),
        createdAt: now,
        createdBy: req.user.username || req.user.id,
        updatedAt: null,
        updatedBy: null
      };
      records.push(record);
    }

    if (writeInspectionRecords(records)) {
      logAuditEvent({
        entityType: 'inspection-record', entityId: record.id, action: isUpdate ? 'update' : 'create',
        actor: req.user, previousStatus, newStatus: status,
        note: `${item.name} — ${y}/${m}${notes ? ' — ' + notes : ''}`
      });
      result = { status: 200, body: { success: true, record } };
    } else {
      result = { status: 500, body: { error: 'فشل حفظ نتيجة الفحص' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

router.delete('/api/inspections/records/:id', authenticateToken, requireRole(...INSPECTION_ADMIN_ROLES), async (req, res) => {
  const recordId = req.params.id;
  let result;
  await enqueueWrite(async () => {
    const records = readInspectionRecords();
    const idx = records.findIndex(r => r.id === recordId);
    if (idx === -1) { result = { status: 404, body: { error: 'السجل غير موجود' } }; return; }
    const removed = records[idx];
    const remaining = records.slice(0, idx).concat(records.slice(idx + 1));
    if (writeInspectionRecords(remaining)) {
      logAuditEvent({ entityType: 'inspection-record', entityId: recordId, action: 'delete', actor: req.user, previousStatus: removed.status, note: `${removed.year}/${removed.month}` });
      result = { status: 200, body: { success: true } };
    } else {
      result = { status: 500, body: { error: 'فشل الحذف' } };
    }
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
