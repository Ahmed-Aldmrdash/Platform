'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const { authenticateToken, authenticateSession, requireRole } = require('../middleware/auth');
const { submitLimiter } = require('../middleware/rate-limits');
const { replyNotModified, viewerKey } = require('../middleware/http-cache');
const { enqueueWrite } = require('../data/write-queue');
const { permitsRepo, readEmployees } = require('../data/stores');
const { createNotification } = require('../services/notifications');
const { notifyWorkerWhatsAppPermitStatus } = require('../services/whatsapp-alerts');
const { logAuditEvent } = require('../services/audit-log');
const { finalizeExcel } = require('../services/excel');
const { parsePermitsWorkbook } = require('../importers/permits-excel');
const { emptyDeleteFlags } = require('../constants');
const { getRoleKey } = require('../utils/roles');
const { setDownloadFilename } = require('../utils/http');
const { normalizeEmpCode, deptMatches, sanitizeStr } = require('../utils/validation');

const router = express.Router();

const ADMIN_ROLES = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin'];
const CLOSURE_TYPES = ['safe', 'incomplete', 'forced'];
const UNEXPECTED_ERROR = { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' };

const respond = (res, result) => res.status(result ? result.status : 500).json(result ? result.body : UNEXPECTED_ERROR);

const isDepartmentScoped = (user) => ['dept_admin', 'maint_admin'].includes(user.role) && Boolean(user.department);
const outsideUserDepartment = (user, permit) => isDepartmentScoped(user) && !deptMatches(permit.department, user.department);

router.get('/api/permits', authenticateToken, requireRole(...ADMIN_ROLES), (req, res) => {
  const q = req.query || {};
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const opts = {
    roleKey: getRoleKey(req.user.role),
    trash: q.trash === '1',
    q: str(q.q, 100),
    worker: str(q.worker, 100),
    supervisor: str(q.supervisor, 100),
    status: str(q.status, 40),
    typeKey: str(q.typeKey, 40),
    year: /^\d{4}$/.test(String(q.year || '')) ? String(q.year) : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? String(q.from) : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? String(q.to) : '',
    limit: Number(q.limit) || 50,
    offset: Number(q.offset) || 0,
  };
  if (isDepartmentScoped(req.user)) {
    opts.department = req.user.department;
  } else {
    // HSE only sees requests that already passed the department head.
    opts.visibility = 'hse';
    if (q.department) opts.department = str(q.department, 100);
  }
  if (replyNotModified(req, res, ['permits-list', viewerKey(req), permitsRepo.version(), JSON.stringify(opts)])) return;
  const out = permitsRepo.list(opts);
  res.json({ permits: out.rows, total: out.total, limit: out.limit, offset: out.offset });
});

router.get('/api/permits/facets', authenticateToken, requireRole(...ADMIN_ROLES), (req, res) => {
  if (replyNotModified(req, res, ['permits-facets', permitsRepo.version()])) return;
  res.json(permitsRepo.facets());
});

/** Every field of a new request is sanitised and the workflow always starts at pending_dept. */
function sanitizeNewPermit(p, id, employeeId) {
  const YES_NO = ['نعم', 'لا', 'لا ينطبق'];
  const text = (v, max) => sanitizeStr(String(v || ''), max);
  const score = (v, max) => Math.min(max, Math.max(1, parseInt(v, 10) || 1));
  return {
    id,
    typeKey: text(p.typeKey || 'general', 30),
    typeLabel: text(p.typeLabel, 30),
    typeFullLabel: text(p.typeFullLabel, 60),
    department: text(p.department, 100),
    shift: text(p.shift, 30),
    date: text(p.date, 15),
    previousPermitNo: text(p.previousPermitNo, 50),
    timeFrom: text(p.timeFrom, 50),
    timeTo: text(p.timeTo, 50),
    workerName: text(p.workerName, 100),
    requesterKind: ['موظف', 'مقاول'].includes(p.requesterKind) ? p.requesterKind : 'موظف',
    requesterPhone: text(p.requesterPhone, 20),
    employeeId: text(employeeId, 50),
    description: text(p.description, 1000),
    location: text(p.location, 150),
    equipment: text(p.equipment, 200),
    tools: Array.isArray(p.tools) ? p.tools.slice(0, 10).map((t) => text(t, 100)) : text(p.tools, 300),
    workersNames: text(p.workersNames, 500),
    checklist: Array.isArray(p.checklist)
      ? p.checklist.slice(0, 60).map((c) => ({
        section: text(c && c.section, 100),
        question: text(c && c.question, 300),
        answer: YES_NO.includes(c && c.answer) ? c.answer : 'لا ينطبق',
      }))
      : [],
    checklistNote: text(p.checklistNote, 500),
    risks: Array.isArray(p.risks)
      ? p.risks.slice(0, 10).map((r) => ({
        source: text(r && r.source, 200),
        l: score(r && r.l, 5),
        s: score(r && r.s, 5),
        score: score(r && r.score, 25),
        control: text(r && r.control, 300),
      }))
      : [],
    status: 'pending_dept',
    reviewedBy: '',
    reviewedAt: '',
    reviewNote: '',
    closure: null,
    areaHeadReviewedBy: '',
    areaHeadReviewedAt: '',
    safetyOfficerName: '',
    areaManagerName: '',
    deletedBy: emptyDeleteFlags(),
    submittedAt: new Date().toISOString(),
  };
}

router.post('/api/permits', authenticateSession, submitLimiter, async (req, res) => {
  const p = req.body && req.body.permit;
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return res.status(400).json({ error: 'بيانات الطلب غير صالحة' });
  }
  // Workers always file under their own code; admins may file on someone's behalf.
  const employeeId = req.worker ? req.worker.empCode : normalizeEmpCode(p.employeeId || '');
  let saved = null;
  await enqueueWrite(async () => {
    const number = String(permitsRepo.nextIdNumber()).padStart(4, '0');
    const permit = sanitizeNewPermit(p, `WP-${new Date().getFullYear()}-${number}`, employeeId);
    if (req.worker && !permit.workerName) permit.workerName = req.worker.name;
    permitsRepo.put(permit);
    saved = permit;
  });
  if (!saved) return res.status(500).json({ error: 'فشل حفظ الطلب، حاول تاني' });

  createNotification({
    targetRole: 'dept_admin',
    targetDept: saved.department,
    type: 'permit',
    title: 'طلب جديد 📋',
    message: `مقدم من ${saved.workerName || 'موظف'} نوع ${saved.typeLabel || 'غير محدد'} في ${saved.location || 'غير محدد'}`,
    link: 'tabPermits',
  });
  if (saved.employeeId) {
    createNotification({
      targetEmpCode: saved.employeeId,
      type: 'permit',
      title: 'استلام الطلب ✅',
      message: 'تم استلام طلبك بنجاح وهو قيد المراجعة',
      link: 'tabMyHistory',
    });
  }
  res.status(201).json({ success: true, permit: saved });
});

const EXPORT_COLUMNS = [
  { header: 'رقم الطلب', key: 'id', width: 18 },
  { header: 'نوع الطلب', key: 'typeLabel', width: 20 },
  { header: 'القسم', key: 'department', width: 15 },
  { header: 'الوردية', key: 'shift', width: 12 },
  { header: 'تاريخ التنفيذ', key: 'date', width: 15 },
  { header: 'اسم العامل', key: 'workerName', width: 22 },
  { header: 'رقم التليفون', key: 'requesterPhone', width: 16 },
  { header: 'مكان العمل', key: 'location', width: 20 },
  { header: 'الحالة', key: 'status', width: 15 },
  { header: 'مشرف السلامة', key: 'safetyOfficerName', width: 20 },
  { header: 'مدير المنطقة', key: 'areaManagerName', width: 20 },
  { header: 'ملاحظة الرفض', key: 'reviewNote', width: 25 },
  { header: 'تاريخ الإرسال', key: 'submittedAt', width: 22 },
];

router.get('/api/export-excel', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    let permits = permitsRepo.all();
    if (isDepartmentScoped(req.user)) permits = permits.filter((p) => deptMatches(p.department, req.user.department));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('سجل الطلبات');
    sheet.columns = EXPORT_COLUMNS;
    for (const p of permits) {
      sheet.addRow({
        id: p.id || '',
        typeLabel: p.typeLabel || '',
        department: p.department || '',
        shift: p.shift || '',
        date: p.date || '',
        workerName: p.workerName || '',
        requesterPhone: p.requesterPhone || '',
        location: p.location || '',
        status: p.status || '',
        safetyOfficerName: p.safetyOfficerName || '-',
        areaManagerName: p.areaManagerName || '-',
        reviewNote: p.reviewNote || '-',
        submittedAt: p.submittedAt ? new Date(p.submittedAt).toLocaleString('ar-EG') : '',
      });
    }
    finalizeExcel(workbook, 'سجل طلبات تصاريح العمل');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    setDownloadFilename(res, 'سجل_طلبات_العمل', 'xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[permits] export failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل تصدير السجل' });
  }
});

function notifyStatusChange(permit, action, reviewNote) {
  if (!permit.employeeId) return;
  const id = permit.id;
  if (action === 'hse_approve') {
    createNotification({ targetEmpCode: permit.employeeId, type: 'permit', title: 'تم اعتماد الطلب النهائي 🎉', message: `تم اعتماد طلبك النهائي برقم ${id} من إدارة السلامة، يمكنك بدء العمل`, link: 'tabMyHistory' });
    notifyWorkerWhatsAppPermitStatus(permit);
    createNotification({ targetRole: 'dept_admin', targetDept: permit.department, type: 'permit', title: 'تم اعتماد الطلب النهائي 🎉', message: `تم اعتماد طلب قسمك النهائي برقم ${id} من إدارة السلامة`, link: 'tabPermits' });
  } else if (action === 'dept_approve') {
    const message = `تم موافقة رئيس القسم على الطلب رقم ${id} وبانتظار اعتماد HSE`;
    for (const role of ['hse_admin', 'super_admin']) {
      createNotification({ targetRole: role, type: 'permit', title: 'طلب بانتظار مراجعة السلامة 🛡️', message, link: 'tabPermits' });
    }
  } else if (action === 'reject') {
    const reason = reviewNote || 'غير محدد';
    createNotification({ targetEmpCode: permit.employeeId, type: 'permit', title: 'رفض الطلب ❌', message: `تم رفض طلبك رقم ${id} - السبب: ${reason}`, link: 'tabMyHistory' });
    notifyWorkerWhatsAppPermitStatus(permit);
    createNotification({ targetRole: 'dept_admin', targetDept: permit.department, type: 'permit', title: 'رفض الطلب ❌', message: `تم رفض طلب قسمك رقم ${id} - السبب: ${reason}`, link: 'tabPermits' });
  } else if (action === 'close') {
    createNotification({ targetEmpCode: permit.employeeId, type: 'permit', title: 'إغلاق الطلب 🔒', message: `تم إنهاء وإغلاق الطلب رقم ${id}`, link: 'tabMyHistory' });
  }
}

/**
 * Approval workflow: pending_dept → (department head) → pending_hse → (HSE) → approved → closed_*.
 * Either reviewer can reject while the request is pending.
 */
router.patch('/api/permits/:id', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  const { action, reviewNote, closureType, closureReason } = req.body || {};
  const role = req.user.role;
  const VALID_ACTIONS = ['dept_approve', 'hse_approve', 'reject', 'close'];
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `الإجراء غير صالح. المتاح: ${VALID_ACTIONS.join(' | ')}` });
  }
  if (action === 'dept_approve' && !['dept_admin', 'maint_admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ error: 'هذا الإجراء مخصص لرئيس القسم فقط' });
  }
  if (action === 'hse_approve' && !['hse_admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ error: 'هذا الإجراء مخصص لمشرف السلامة فقط' });
  }
  if (action === 'close' && !CLOSURE_TYPES.includes(closureType)) {
    return res.status(400).json({ error: `نوع الإغلاق غير صالح. المتاح: ${CLOSURE_TYPES.join(' | ')}` });
  }

  let result;
  await enqueueWrite(async () => {
    const permit = permitsRepo.get(req.params.id);
    if (!permit) {
      result = { status: 404, body: { error: 'الطلب غير موجود' } };
      return;
    }
    if (outsideUserDepartment(req.user, permit)) {
      result = { status: 403, body: { error: 'رئيس القسم لا يملك صلاحية التعامل مع طلبات قسم آخر' } };
      return;
    }

    const now = new Date().toISOString();
    const reviewer = sanitizeStr(req.user.name || req.user.username, 100);
    const previousStatus = permit.status;

    if (action === 'dept_approve') {
      if (!['pending_dept', 'pending_area_head', 'pending'].includes(permit.status)) {
        result = { status: 409, body: { error: 'لا يمكن موافقة رئيس القسم إلا على طلبات قيد انتظار القسم' } };
        return;
      }
      Object.assign(permit, { status: 'pending_hse', areaHeadReviewedAt: now, areaHeadReviewedBy: reviewer, areaManagerName: reviewer });
    } else if (action === 'hse_approve') {
      if (permit.status !== 'pending_hse') {
        result = { status: 409, body: { error: 'الموافقة النهائية تتطلب حالة pending_hse' } };
        return;
      }
      Object.assign(permit, { status: 'approved', reviewedAt: now, reviewedBy: reviewer, safetyOfficerName: reviewer });
    } else if (action === 'reject') {
      if (!['pending_dept', 'pending_hse'].includes(permit.status)) {
        result = { status: 409, body: { error: 'لا يمكن الرفض إلا على الطلبات قيد الانتظار' } };
        return;
      }
      Object.assign(permit, { status: 'rejected', reviewedAt: now, reviewedBy: reviewer, reviewNote: sanitizeStr(reviewNote, 500), rejectedByRole: role });
    } else if (action === 'close') {
      if (!String(permit.status || '').startsWith('approved') && role !== 'super_admin') {
        result = { status: 409, body: { error: 'لا يمكن إغلاق إلا الطلبات الموافق عليها' } };
        return;
      }
      permit.status = 'closed_' + closureType;
      permit.closure = { type: closureType, reason: sanitizeStr(closureReason, 300), time: now, closedBy: reviewer };
    }

    logAuditEvent({
      entityType: 'permit',
      entityId: permit.id,
      action,
      actor: req.user,
      previousStatus,
      newStatus: permit.status,
      note: action === 'reject' ? reviewNote : (action === 'close' ? closureReason : ''),
    });
    permitsRepo.put(permit);
    notifyStatusChange(permit, action, reviewNote);
    result = { status: 200, body: { success: true, permit } };
  });
  respond(res, result);
});

router.post('/api/permits/upload-excel', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  try {
    const { base64Data } = req.body || {};
    if (!base64Data) return res.status(400).json({ success: false, message: 'No file data provided' });

    const { importedPermits, skippedRows } = await parsePermitsWorkbook(Buffer.from(base64Data, 'base64'), readEmployees());
    if (!importedPermits.length) {
      return res.status(400).json({ success: false, message: 'لم يتم العثور على تصاريح صالحة في الملف — تأكد من وجود أعمدة رقم التصريح والتاريخ' });
    }
    const matched = importedPermits.filter((p) => p.employeeId).length;
    await enqueueWrite(async () => permitsRepo.putMany(importedPermits));
    res.json({ success: true, count: importedPermits.length, matched, skipped: skippedRows });
  } catch (err) {
    console.error('[permits] Excel import failed:', err);
    res.status(500).json({ success: false, message: 'Invalid Excel file or parsing error' });
  }
});

// Soft delete: each role has its own trash, so a permit only disappears for the role that deleted it.
router.delete('/api/permits/:id', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  if (!(req.body && req.body.reason)) return res.status(400).json({ error: 'سبب الحذف مطلوب' });

  let result;
  await enqueueWrite(async () => {
    const permit = permitsRepo.get(req.params.id);
    if (!permit) {
      result = { status: 404, body: { error: 'Permit not found' } };
      return;
    }
    if (outsideUserDepartment(req.user, permit)) {
      result = { status: 403, body: { error: 'غير مصرح لك بحذف تصاريح قسم آخر' } };
      return;
    }
    const roleKey = getRoleKey(req.user.role);
    permit.deletedBy = permit.deletedBy && typeof permit.deletedBy === 'object' ? permit.deletedBy : emptyDeleteFlags();
    permit.deletedBy[roleKey] = true;
    permit.lastDeletedByUsername = req.user.username || 'Admin';

    // Deleting a request that is still waiting for this reviewer rejects it.
    if (roleKey === 'areaAdmin' && ['pending', 'pending_dept', 'pending_area_head'].includes(permit.status)) {
      permit.status = 'rejected_area';
      permit.rejectionReason = 'مرفوض من رئيس القسم';
    } else if ((roleKey === 'safetyAdmin' || roleKey === 'superAdmin') && ['pending', 'pending_dept', 'pending_hse', 'approved_area'].includes(permit.status)) {
      permit.status = 'rejected_high_management';
      permit.rejectionReason = 'مرفوض من الإدارة العليا';
    }
    permitsRepo.put(permit);
    result = { status: 200, body: { success: true } };
  });
  respond(res, result);
});

router.patch('/api/permits/:id/employee-code', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  const trimmedCode = String((req.body && req.body.employeeId) || '').trim();
  if (!trimmedCode) return res.status(400).json({ error: 'الكود الوظيفي مطلوب' });

  const searchCode = normalizeEmpCode(trimmedCode);
  const employee = readEmployees().find((e) => normalizeEmpCode(String(e.empCode || e.code || e.id || '').trim()) === searchCode);
  if (!employee) {
    return res.status(404).json({ error: `الكود الوظيفي (${trimmedCode}) غير مسجل في قاعدة بيانات الموظفين` });
  }

  let result;
  await enqueueWrite(async () => {
    const permit = permitsRepo.get(req.params.id);
    if (!permit) {
      result = { status: 404, body: { error: 'Permit not found' } };
      return;
    }
    if (outsideUserDepartment(req.user, permit)) {
      result = { status: 403, body: { error: 'غير مصرح لك بتعديل تصاريح قسم آخر' } };
      return;
    }
    permit.employeeId = employee.empCode || employee.code || trimmedCode;
    if (!permit.workerName) permit.workerName = employee.name || permit.workerName;
    permit.employeeCodeAddedBy = req.user.username || 'admin';
    permit.employeeCodeAddedAt = new Date().toISOString();
    permitsRepo.put(permit);
    result = { status: 200, body: { success: true, permit } };
  });
  respond(res, result);
});

router.post('/api/permits/:id/restore', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const permit = permitsRepo.get(req.params.id);
    if (!permit) {
      result = { status: 404, body: { error: 'الطلب غير موجود' } };
      return;
    }
    if (outsideUserDepartment(req.user, permit)) {
      result = { status: 403, body: { error: 'غير مصرح لك باستعادة تصاريح قسم آخر' } };
      return;
    }
    const roleKey = getRoleKey(req.user.role);
    if (permit.deletedBy) permit.deletedBy[roleKey] = false;
    permit.permanentlyDeletedBy = permit.permanentlyDeletedBy || emptyDeleteFlags();
    permit.permanentlyDeletedBy[roleKey] = false;
    delete permit.deletedAt;
    delete permit.deleteReason;
    if (permit.status === 'rejected_area' || permit.status === 'rejected_high_management') permit.status = 'pending_dept';
    permitsRepo.put(permit);
    result = { status: 200, body: { success: true } };
  });
  respond(res, result);
});

// The row is only removed once every role has permanently deleted it.
router.delete('/api/permits/:id/permanent', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const permit = permitsRepo.get(req.params.id);
    if (!permit) {
      result = { status: 404, body: { error: 'الطلب غير موجود' } };
      return;
    }
    if (outsideUserDepartment(req.user, permit)) {
      result = { status: 403, body: { error: 'غير مصرح لك بحذف تصاريح قسم آخر' } };
      return;
    }
    const roleKey = getRoleKey(req.user.role);
    if (permit.deletedBy && !permit.deletedBy[roleKey]) {
      result = { status: 400, body: { error: 'الطلب ليس في سلة المحذوفات الخاصة بك' } };
      return;
    }
    permit.permanentlyDeletedBy = permit.permanentlyDeletedBy || emptyDeleteFlags();
    permit.permanentlyDeletedBy[roleKey] = true;
    const perm = permit.permanentlyDeletedBy;
    if (perm.areaAdmin && perm.safetyAdmin && perm.superAdmin && perm.worker) permitsRepo.remove(permit.id);
    else permitsRepo.put(permit);
    result = { status: 200, body: { success: true } };
  });
  respond(res, result);
});

router.patch('/api/permits/:id/worker-close', authenticateSession, async (req, res) => {
  if (!req.worker) return res.status(403).json({ error: 'الإغلاق من هنا للعامل صاحب الطلب فقط' });
  const { closureType, closureReason } = req.body || {};
  if (!CLOSURE_TYPES.includes(closureType)) {
    return res.status(400).json({ error: 'نوع الإغلاق غير صالح. المتاح: safe | incomplete | forced' });
  }
  let result;
  await enqueueWrite(async () => {
    const permit = permitsRepo.get(req.params.id);
    if (!permit) {
      result = { status: 404, body: { error: 'الطلب غير موجود' } };
      return;
    }
    if (normalizeEmpCode(permit.employeeId || '') !== req.worker.empCode) {
      result = { status: 403, body: { error: 'غير مصرح لك بإغلاق هذا الطلب' } };
      return;
    }
    if (permit.status !== 'approved') {
      result = { status: 409, body: { error: 'يمكن إغلاق الطلبات الموافق عليها فقط' } };
      return;
    }
    permit.status = 'closed_' + closureType;
    permit.closure = {
      type: closureType,
      reason: sanitizeStr(closureReason, 300),
      time: new Date().toISOString(),
      closedBy: `${req.worker.empCode} (worker)`,
    };
    permitsRepo.put(permit);
    createNotification({
      targetRole: 'admin',
      type: 'permit',
      title: 'إغلاق طلب من العامل 🔒',
      message: `تم إنهاء وإغلاق الطلب رقم ${permit.id} من قِبل ${permit.workerName || req.worker.empCode}`,
      link: 'tabPermits',
    });
    createNotification({ targetEmpCode: permit.employeeId, type: 'permit', title: 'تأكيد إغلاق الطلب ✅', message: 'تم إغلاق الطلب بسلامة', link: 'tabMyHistory' });
    result = { status: 200, body: { success: true, permit } };
  });
  respond(res, result);
});

module.exports = router;
