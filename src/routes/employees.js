'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const {
  employeesStore, hazardsStore, trainingsStore, workerCredsStore,
  readEmployees, writeEmployees, readWorkerCreds, shared,
} = require('../data/stores');
const { enqueueWrite } = require('../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../middleware/auth');
const { employeeLimiter } = require('../middleware/rate-limits');
const { cacheJsonResponse, viewerKey } = require('../middleware/http-cache');
const { normalizeEmpCode, sanitizeStr, deptMatches } = require('../utils/validation');
const { setDownloadFilename } = require('../utils/http');
const { finalizeExcel } = require('../services/excel');
const { parseEmployeesXlsx } = require('../services/employee-import');
const { ADMIN_TIER_ROLES } = require('../constants');

const router = express.Router();

const VALID_ROLES = ['worker', 'supervisor', 'area_head', 'contractor'];
const UNEXPECTED_ERROR = { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' };

const respond = (res, result) => res.status(result ? result.status : 500).json(result ? result.body : UNEXPECTED_ERROR);
const codeOf = (e) => normalizeEmpCode(e.code || e.empCode);

// Department heads manage only their own department's directory and can't move people between departments.
const scopedDept = (user) => (['dept_admin', 'maint_admin'].includes(user.role) && user.department ? user.department : null);
const outsideScope = (user, emp) => {
  const dept = scopedDept(user);
  return Boolean(dept) && !deptMatches(emp.department, dept);
};

router.get('/api/employees/lookup/:code', authenticateSession, (req, res) => {
  const code = normalizeEmpCode(req.params.code);
  const emp = readEmployees().find((e) => codeOf(e) === code);
  if (!emp) return res.json({ found: false });
  res.json({
    found: true,
    employee: {
      code: emp.empCode,
      name: emp.name || '',
      department: emp.department || '',
      jobTitle: emp.jobTitle || '',
      role: emp.role === 'ceo' ? 'worker' : (emp.role || 'worker'),
    },
  });
});

router.get('/api/employees/export-excel', authenticateToken, requireRole(...ADMIN_TIER_ROLES), async (req, res) => {
  try {
    let employees = readEmployees().filter((e) => !outsideScope(req.user, e));
    if (req.query.codes) {
      const wanted = new Set(String(req.query.codes).split(',').map((c) => normalizeEmpCode(c.trim())).filter(Boolean));
      if (wanted.size) employees = employees.filter((e) => wanted.has(codeOf(e)));
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('قاعدة الموظفين');
    ws.columns = [
      { header: 'الكود الوظيفي', key: 'empCode', width: 18 },
      { header: 'الاسم الكامل', key: 'name', width: 26 },
      { header: 'القسم', key: 'department', width: 22 },
      { header: 'المسمى الوظيفي', key: 'jobTitle', width: 22 },
      { header: 'الصلاحية', key: 'role', width: 15 },
      { header: 'رقم التليفون', key: 'phone', width: 18 },
      { header: 'الإيميل', key: 'email', width: 28 },
      { header: 'مسجّل على المنصة', key: 'registered', width: 16 },
    ];
    const creds = readWorkerCreds();
    for (const e of employees) {
      const cred = creds[codeOf(e)] || {};
      ws.addRow({
        empCode: e.empCode || '',
        name: e.name || '',
        department: e.department || '',
        jobTitle: e.jobTitle || '',
        role: e.role || 'worker',
        phone: e.phone || cred.phone || '',
        email: e.email || cred.email || '',
        registered: cred.hash ? 'نعم' : 'لا',
      });
    }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD51E27' } };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finalizeExcel(wb, 'دليل الموظفين');
    setDownloadFilename(res, `دليل الموظفين - ${new Date().toISOString().slice(0, 10)}`, 'xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[employees] export failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل تصدير بيانات الموظفين' });
  }
});

router.post('/api/employees/import-excel', authenticateToken, requireRole(...ADMIN_TIER_ROLES), async (req, res) => {
  const { fileData } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'fileData (base64) مطلوب' });
  try {
    let incoming = await parseEmployeesXlsx(Buffer.from(fileData, 'base64'));
    const dept = scopedDept(req.user);
    if (dept) incoming = incoming.filter((emp) => deptMatches(emp.department, dept));
    if (!incoming.length) return res.status(400).json({ error: 'الملف لا يحتوي على بيانات صالحة أو الأعمدة غير متوافقة' });

    let added = 0;
    let updated = 0;
    let skipped = 0;
    await enqueueWrite(async () => {
      const existing = readEmployees();
      const byCode = new Map(existing.map((e) => [codeOf(e), e]));
      const now = new Date().toISOString();
      for (const emp of incoming) {
        const key = normalizeEmpCode(emp.empCode);
        const old = byCode.get(key);
        if (old && outsideScope(req.user, old)) {
          skipped += 1;
        } else if (old) {
          byCode.set(key, {
            ...old,
            name: emp.name || old.name,
            department: emp.department || old.department,
            jobTitle: emp.jobTitle || old.jobTitle,
            role: emp.role !== 'worker' ? emp.role : (old.role || 'worker'),
            phone: emp.phone || old.phone,
            updatedAt: now,
          });
          updated += 1;
        } else {
          byCode.set(key, { ...emp, registeredAt: now });
          added += 1;
        }
      }
      writeEmployees([...byCode.values()]);
    });
    res.json({ success: true, added, updated, skipped, total: readEmployees().length });
  } catch (err) {
    console.error('[employees] import failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل قراءة ملف الإكسيل — اتأكد إنه ملف xlsx سليم' });
  }
});

const employeesListCache = cacheJsonResponse({
  stores: [employeesStore, hazardsStore, trainingsStore, workerCredsStore],
  keyFn: (req) => `emps:${viewerKey(req)}:${req.originalUrl}`,
});

router.get('/api/employees', authenticateToken, requireRole(...ADMIN_TIER_ROLES), employeesListCache, (req, res) => {
  const employees = shared.employees().filter((e) => !outsideScope(req.user, e));

  const hazardDates = new Map();
  for (const h of shared.hazards()) {
    if (h.deleted || h.status === 'rejected' || h.status === 'rejected_by_maintenance') continue;
    const code = normalizeEmpCode(h.empCode);
    if (!code) continue;
    if (!hazardDates.has(code)) hazardDates.set(code, []);
    hazardDates.get(code).push(h.createdAt || h.date || new Date().toISOString());
  }
  const trainingDates = new Map();
  for (const trn of shared.trainings()) {
    if (trn.isDeleted) continue;
    for (const att of trn.attendees || []) {
      if (!att.verified) continue;
      const code = normalizeEmpCode(att.empCode || att.code);
      if (!code) continue;
      if (!trainingDates.has(code)) trainingDates.set(code, []);
      trainingDates.get(code).push(trn.date || trn.createdAt || new Date().toISOString());
    }
  }

  const creds = shared.workerCreds();
  res.json({
    employees: employees.map((emp) => {
      const code = codeOf(emp);
      const hz = hazardDates.get(code) || [];
      const trn = trainingDates.get(code) || [];
      return {
        ...emp,
        hasWorkerPassword: Boolean(creds[code] && creds[code].hash),
        hazardDates: hz,
        hazardCount: hz.length,
        trainingDates: trn,
        trainingHours: trn.length * 0.5,
      };
    }),
  });
});

/** Creates an employee, or updates the record when the code already exists. */
router.post('/api/employees', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), async (req, res) => {
  const body = req.body || {};
  const code = normalizeEmpCode(String(body.empCode || body.code || '').trim());
  if (!code || !/^\d{1,12}$/.test(code) || !body.name) return res.status(400).json({ error: 'الكود الوظيفي (أرقام بس) والاسم مطلوبان' });
  const forcedDept = scopedDept(req.user);

  let result;
  await enqueueWrite(async () => {
    const employees = readEmployees();
    const existing = employees.find((e) => codeOf(e) === code);
    if (existing && outsideScope(req.user, existing)) {
      result = { status: 403, body: { error: 'الموظف ده مش في قسمك' } };
      return;
    }
    const fields = {
      name: sanitizeStr(body.name, 100),
      phone: sanitizeStr(body.phone || '', 20),
      department: forcedDept || sanitizeStr(body.department || '', 100),
    };
    if (existing) {
      Object.assign(existing, fields, {
        jobTitle: sanitizeStr(body.jobTitle || existing.jobTitle || '', 100),
        role: VALID_ROLES.includes(body.role) ? body.role : (existing.role || 'worker'),
        updatedAt: new Date().toISOString(),
      });
      writeEmployees(employees);
      result = { status: 200, body: { success: true, employee: existing } };
      return;
    }
    const employee = {
      empCode: code,
      ...fields,
      jobTitle: sanitizeStr(body.jobTitle || '', 100),
      role: VALID_ROLES.includes(body.role) ? body.role : 'worker',
      registeredAt: new Date().toISOString(),
    };
    employees.push(employee);
    writeEmployees(employees);
    result = { status: 201, body: { success: true, employee } };
  });
  respond(res, result);
});

router.put('/api/employees/:code', authenticateToken, requireRole(...ADMIN_TIER_ROLES), async (req, res) => {
  const code = normalizeEmpCode(req.params.code);
  const { name, phone, department, jobTitle, role } = req.body || {};
  let result;
  await enqueueWrite(async () => {
    const employees = readEmployees();
    const emp = employees.find((e) => codeOf(e) === code);
    if (!emp) {
      result = { status: 404, body: { error: 'الموظف غير موجود' } };
      return;
    }
    if (outsideScope(req.user, emp)) {
      result = { status: 403, body: { error: 'الموظف ده مش في قسمك' } };
      return;
    }
    Object.assign(emp, {
      name: sanitizeStr(name || emp.name, 100),
      phone: sanitizeStr(phone !== undefined ? phone : (emp.phone || ''), 20),
      department: scopedDept(req.user) ? emp.department : sanitizeStr(department || emp.department, 100),
      jobTitle: sanitizeStr(jobTitle !== undefined ? jobTitle : (emp.jobTitle || ''), 100),
      role: VALID_ROLES.includes(role) ? role : (emp.role || 'worker'),
      updatedAt: new Date().toISOString(),
    });
    writeEmployees(employees);
    result = { status: 200, body: { success: true, employee: emp } };
  });
  respond(res, result);
});

router.patch('/api/employees/:code/phone', authenticateSession, employeeLimiter, async (req, res) => {
  const code = normalizeEmpCode(req.params.code);
  if (req.worker && req.worker.empCode !== code) return res.status(403).json({ error: 'غير مصرح' });
  const phone = sanitizeStr((req.body || {}).phone || '', 20);
  if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'رقم الهاتف غير صالح — أدخل رقمًا يحتوي أرقامًا فقط (8-15 رقم)' });
  }
  let result;
  await enqueueWrite(async () => {
    const employees = readEmployees();
    const emp = employees.find((e) => codeOf(e) === code);
    if (!emp) {
      result = { status: 404, body: { error: 'الموظف غير موجود' } };
      return;
    }
    if (!req.worker && outsideScope(req.user, emp)) {
      result = { status: 403, body: { error: 'الموظف ده مش في قسمك' } };
      return;
    }
    emp.phone = phone;
    emp.phoneUpdatedAt = new Date().toISOString();
    writeEmployees(employees);
    result = { status: 200, body: { success: true, phone } };
  });
  respond(res, result);
});

router.delete('/api/employees/:code', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), async (req, res) => {
  const code = normalizeEmpCode(req.params.code);
  let result;
  await enqueueWrite(async () => {
    const employees = readEmployees();
    const idx = employees.findIndex((e) => codeOf(e) === code);
    if (idx === -1) {
      result = { status: 404, body: { error: 'الموظف غير موجود' } };
      return;
    }
    if (outsideScope(req.user, employees[idx])) {
      result = { status: 403, body: { error: 'الموظف ده مش في قسمك' } };
      return;
    }
    employees.splice(idx, 1);
    writeEmployees(employees);
    result = { status: 200, body: { success: true } };
  });
  respond(res, result);
});

router.get('/api/departments', authenticateToken, requireRole('super_admin', 'hse_admin'), (req, res) => {
  try {
    const employees = readEmployees();
    const depts = [...new Set(
      employees
        .map(e => String(e.department || '').trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'ar'));
    res.json({ departments: depts });
  } catch (err) {
    res.status(500).json({ error: 'فشل تحميل قائمة الأقسام' });
  }
});

module.exports = router;
