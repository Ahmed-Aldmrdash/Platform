'use strict';

// Worker login: employee code + password. A worker sets their password on
// first login; afterwards only an admin can reset it.

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { ADMIN_TIER_ROLES, EMAIL_RE } = require('../constants');
const { enqueueWrite } = require('../data/write-queue');
const { workerCredsStore, readWorkerCreds, readEmployees, writeEmployees, findEmployeeByCode, shared } = require('../data/stores');
const { authenticateToken, requireRole, signWorkerToken } = require('../middleware/auth');
const { workerAuthLimiter } = require('../middleware/rate-limits');
const { ipKeyGenerator } = require('express-rate-limit');
const { logAuditEvent } = require('../services/audit-log');
const { workerPerCode, workerPerIp } = require('../services/login-guard');
const { normalizeEmpCode, sanitizeStr, deptMatches } = require('../utils/validation');

const router = express.Router();

const MIN_PASSWORD = 6;
const WEAK = new Set(['123456', '1234567', '12345678', '111111', '000000', '654321', '123123', 'password', 'elsewedy', 'qwerty']);

function validateWorkerPassword(pw, code) {
  const s = String(pw || '');
  if (s.length < MIN_PASSWORD) return `كلمة السر لازم تكون ${MIN_PASSWORD} حروف أو أرقام على الأقل`;
  if (s.length > 100) return 'كلمة السر طويلة جدًا';
  if (WEAK.has(s.toLowerCase()) || /^(.)\1+$/.test(s) || '0123456789'.includes(s) || '9876543210'.includes(s)) {
    return 'كلمة السر دي سهلة التخمين — اختار واحدة تانية';
  }
  if (code && s.includes(code)) return 'ما تخليش كلمة السر فيها كودك الوظيفي';
  return null;
}

function normalizeWorkerPhone(raw) {
  const s = String(raw || '').replace(/[\s-]/g, '');
  if (/^01[0125][0-9]{8}$/.test(s)) return s;
  if (/^(\+|00)[1-9][0-9]{7,14}$/.test(s)) return s.replace(/^00/, '+');
  return null;
}

// Before login the response only confirms who the code belongs to (first two names).
function publicEmployeeInfo(emp, { full = false } = {}) {
  const name = String(emp.name || '');
  return {
    code: emp.empCode,
    name: full ? name : name.split(/\s+/).slice(0, 2).join(' '),
    department: emp.department || '',
    jobTitle: full ? emp.jobTitle || '' : '',
    role: emp.role === 'ceo' ? 'worker' : (emp.role || 'worker'),
  };
}

const ipKey = (req) => `ip:${ipKeyGenerator(req.ip)}`;

router.get('/api/worker-auth/status/:code', workerAuthLimiter, (req, res) => {
  const emp = findEmployeeByCode(req.params.code);
  if (!emp) return res.json({ found: false });
  const cred = shared.workerCreds()[normalizeEmpCode(emp.empCode)];
  res.json({ found: true, employee: publicEmployeeInfo(emp), hasPassword: Boolean(cred && cred.hash) });
});

router.post('/api/worker-auth/setup', workerAuthLimiter, async (req, res) => {
  const body = req.body || {};
  const emp = findEmployeeByCode(body.code);
  if (!emp) return res.status(404).json({ error: 'الكود الوظيفي غير مسجل' });
  const key = normalizeEmpCode(emp.empCode);
  const weak = validateWorkerPassword(body.password, key);
  if (weak) return res.status(400).json({ error: weak });
  const phone = normalizeWorkerPhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'رقم الموبايل غير صحيح — اكتبه كده: 01xxxxxxxxx' });
  const email = sanitizeStr(body.email || '', 160).trim();
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'الإيميل غير صحيح — سيبه فاضي لو مش عايز تسجله' });

  const hash = await bcrypt.hash(String(body.password), config.bcryptRounds);
  let result;
  await enqueueWrite(async () => {
    const creds = readWorkerCreds();
    if (creds[key] && creds[key].hash) {
      result = { status: 409, body: { error: 'الكود ده عليه كلمة سر بالفعل — ادخل بيها أو اطلب من المشرف يعملك واحدة جديدة' } };
      return;
    }
    creds[key] = { hash, phone, email, pwv: crypto.randomBytes(8).toString('hex'), setAt: new Date().toISOString() };
    workerCredsStore.write(creds);

    const employees = readEmployees();
    const record = employees.find((e) => normalizeEmpCode(e.code || e.empCode) === key);
    if (record) {
      record.phone = phone;
      if (email) record.email = email;
      record.phoneUpdatedAt = new Date().toISOString();
      writeEmployees(employees);
    }
    result = { status: 200, body: { success: true, token: signWorkerToken(emp, creds[key]), employee: { ...publicEmployeeInfo(emp, { full: true }), phone } } };
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع' });
});

router.post('/api/worker-auth/login', workerAuthLimiter, async (req, res) => {
  const { code, password } = req.body || {};
  const ipLock = workerPerIp.minutesLeft(ipKey(req));
  if (ipLock) return res.status(429).json({ error: `محاولات غلط كتير من الشبكة دي — استنى ${ipLock} دقيقة` });
  const emp = findEmployeeByCode(code);
  if (!emp) return res.status(404).json({ error: 'الكود الوظيفي غير مسجل' });
  const key = normalizeEmpCode(emp.empCode);
  const locked = workerPerCode.minutesLeft(key);
  if (locked) return res.status(429).json({ error: `محاولات غلط كتير — استنى ${locked} دقيقة أو اطلب من المشرف يعملك كلمة سر جديدة` });

  const cred = shared.workerCreds()[key];
  if (!cred || !cred.hash) return res.status(409).json({ error: 'لسه ماعملتش كلمة سر', needsSetup: true });
  if (!(await bcrypt.compare(String(password || ''), cred.hash))) {
    workerPerIp.record(ipKey(req));
    const left = workerPerCode.record(key);
    return res.status(401).json({ error: left > 0 ? `كلمة السر غلط — فاضل ${left} محاولات` : 'كلمة السر غلط — الكود اتقفل 15 دقيقة' });
  }
  workerPerCode.clear(key);
  res.json({ success: true, token: signWorkerToken(emp, cred), employee: { ...publicEmployeeInfo(emp, { full: true }), phone: cred.phone || emp.phone || '' } });
});

/** An admin (or the worker's own department head) sets a new password; open worker sessions end immediately. */
router.post('/api/employees/:code/set-password', authenticateToken, requireRole(...ADMIN_TIER_ROLES), async (req, res) => {
  const emp = findEmployeeByCode(req.params.code);
  if (!emp) return res.status(404).json({ error: 'الموظف غير موجود' });
  if (['dept_admin', 'maint_admin'].includes(req.user.role) && req.user.department && !deptMatches(emp.department, req.user.department)) {
    return res.status(403).json({ error: 'الموظف ده مش في قسمك' });
  }
  const key = normalizeEmpCode(emp.empCode);
  const password = String((req.body || {}).password || '');
  const weak = validateWorkerPassword(password, key);
  if (weak) return res.status(400).json({ error: weak });

  const hash = await bcrypt.hash(password, config.bcryptRounds);
  let hadPassword = false;
  await enqueueWrite(async () => {
    const creds = readWorkerCreds();
    hadPassword = Boolean(creds[key] && creds[key].hash);
    const now = new Date().toISOString();
    creds[key] = { ...(creds[key] || {}), hash, pwv: crypto.randomBytes(8).toString('hex'), updatedAt: now, setBy: req.user.username || '' };
    if (!creds[key].setAt) creds[key].setAt = now;
    workerCredsStore.write(creds);
  });
  workerPerCode.clear(key);
  logAuditEvent({ entityType: 'employee', entityId: key, action: 'reset_password', actor: req.user, note: `${hadPassword ? 'تغيير' : 'إنشاء'} كلمة سر العامل ${emp.name || key}` });
  res.json({ success: true, hadPassword });
});

module.exports = router;
