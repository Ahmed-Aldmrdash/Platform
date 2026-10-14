'use strict';

// Admin authentication. Department accounts are shared: one username per
// department, but every person logs in with their own employee code and,
// after the first login, their own personal password (memberCredentials).

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const mailer = require('../services/mailer');
const { EMAIL_RE } = require('../constants');
const { enqueueWrite } = require('../data/write-queue');
const { readUsers, writeUsers, readEmployees, writeEmployees, findUserForSession } = require('../data/stores');
const {
  authenticateToken, signSessionToken, signLinkToken, revokeSessions, tokenIssuedMs, sessionExpired,
} = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limits');
const { logAuditEvent } = require('../services/audit-log');
const { FailureTracker, adminPerPerson, adminPerAccount } = require('../services/login-guard');
const { normalizeSessionRole } = require('../utils/roles');
const { normalizeEmpCode, sanitizeStr, checkPasswordStrength, isSafeKey } = require('../utils/validation');

const router = express.Router();

const OTP_TTL_MS = 30 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), config.bcryptRounds);
const LOGIN_FAILED = 'بيانات الدخول غير صحيحة — راجع اسم المستخدم والكود الوظيفي وكلمة السر';
const resetRequests = new FailureTracker(3, 60 * 60 * 1000);

const isBcrypt = (h) => typeof h === 'string' && h.startsWith('$2');
const findEmployee = (code) => readEmployees().find((e) => normalizeEmpCode(String(e.empCode || e.code || e.id || '').trim()) === code);
const notExpired = (iso) => Boolean(iso) && Date.now() <= new Date(iso).getTime();

/** Why this employee code may not use this account (null when allowed). */
function accessProblem(user, employee, code) {
  if (!employee) return 'employee code not registered';
  if (user.empCode && normalizeEmpCode(user.empCode) !== code) return 'account locked to another employee code';
  if (Array.isArray(user.allowedEmpCodes) && user.allowedEmpCodes.length
    && !user.allowedEmpCodes.map((c) => normalizeEmpCode(c)).includes(code)) return 'employee code not in the allowed list';
  if (['dept_admin', 'maint_admin', 'hse_admin', 'hse_director'].includes(user.role)) {
    const required = ['hse_admin', 'hse_director'].includes(user.role) ? 'HSE' : (user.department || '');
    const actual = String(employee.department || '').trim().toLowerCase();
    if (!required || actual !== String(required).trim().toLowerCase()) return 'employee belongs to another department';
  }
  return null;
}

/** Which secret this login matched: the personal password, a pending reset, or the shared one. */
async function matchPassword(user, memberCred, code, password) {
  if (memberCred) {
    if (isBcrypt(memberCred.passwordHash) && await bcrypt.compare(password, memberCred.passwordHash)) return 'personal';
    if (memberCred.reset && notExpired(memberCred.reset.expiresAt) && await bcrypt.compare(password, memberCred.reset.hash)) return 'reset';
    return null;
  }
  if (isBcrypt(user.password) && await bcrypt.compare(password, user.password)) return 'shared';
  if (user.reset && user.reset.code === code && notExpired(user.reset.expiresAt) && await bcrypt.compare(password, user.reset.hash)) return 'reset';
  return null;
}

function sessionPayload(user, employee, code) {
  return normalizeSessionRole({
    id: user.id || employee.empCode,
    username: user.username,
    role: user.role || 'worker',
    name: employee.name,
    fullName: employee.name,
    empCode: employee.empCode || code,
    department: user.department || employee.department || '',
  });
}

function passwordState(user, code) {
  const memberCred = code && user.memberCredentials && user.memberCredentials[code];
  const needsPersonalPassword = !memberCred;
  const mustChangePassword = Boolean(memberCred && memberCred.mustChangePassword === true);
  return { needsPersonalPassword, mustChangePassword, pwSetup: needsPersonalPassword || mustChangePassword };
}

function sessionInfo(user, code) {
  const profile = (user.profiles && user.profiles[code]) || null;
  const lastHolder = user.lastHolder && user.lastHolder.empCode !== code ? user.lastHolder : null;
  return {
    needsProfile: !(profile && profile.phone && profile.email),
    profile: profile ? { phone: profile.phone || '', email: profile.email || '' } : null,
    previousHolder: lastHolder ? { name: lastHolder.name || '', empCode: lastHolder.empCode || '' } : null,
  };
}

router.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password, empCode } = req.body || {};
  if (!username || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'يجب إدخال اسم المستخدم وكلمة المرور' });
  }
  const usernameKey = String(username).trim().toLowerCase();
  const code = normalizeEmpCode(String(empCode || '').trim());
  const personKey = `${usernameKey}::${code}`;

  const lockedFor = Math.max(adminPerPerson.minutesLeft(personKey), adminPerAccount.minutesLeft(usernameKey));
  if (lockedFor) return res.status(429).json({ error: `محاولات غلط كتير على الحساب ده — استنى ${lockedFor} دقيقة وجرب تاني` });

  const user = readUsers().find((u) => String(u.username || '').trim().toLowerCase() === usernameKey);
  const employee = /^\d{1,12}$/.test(code) ? findEmployee(code) : null;
  const memberCred = user && isSafeKey(code) && user.memberCredentials ? user.memberCredentials[code] || null : null;

  // Every failure looks the same and costs the same time, so the response
  // never tells which of username, code or password was wrong.
  let matched = null;
  if (user) matched = await matchPassword(user, memberCred, code, password);
  else await bcrypt.compare(password, DUMMY_HASH);
  const problem = user ? accessProblem(user, employee, code) : 'unknown username';

  if (!matched || problem) {
    adminPerAccount.record(usernameKey);
    const left = adminPerPerson.record(personKey);
    console.warn(`[auth] failed admin login for "${usernameKey}" (${matched ? problem : 'wrong password or username'})`);
    return res.status(401).json({ error: left > 0 ? `${LOGIN_FAILED} — فاضل ${left} محاولات` : `${LOGIN_FAILED} — الحساب اتقفل 15 دقيقة` });
  }
  adminPerPerson.clear(personKey);

  // Temporary passwords issued by the previous reset flow replaced the real one and expire after 30 minutes.
  const legacyTemp = matched === 'personal' ? memberCred : (matched === 'shared' ? user : null);
  if (legacyTemp && legacyTemp.mustChangePassword === true && legacyTemp.otpExpiresAt && !notExpired(legacyTemp.otpExpiresAt)) {
    return res.status(403).json({ error: 'كلمة السر المؤقتة انتهت صلاحيتها — اطلب واحدة جديدة من "نسيت كلمة السر؟"', otpExpired: true });
  }

  const state = passwordState(user, code);
  const viaReset = matched === 'reset';
  const payload = sessionPayload(user, employee, code);
  const token = signSessionToken(payload, { pwSetup: state.pwSetup || viaReset });

  res.json({
    success: true,
    token,
    needsPersonalPassword: state.needsPersonalPassword,
    mustChangePassword: state.mustChangePassword || (viaReset && !state.needsPersonalPassword),
    ...sessionInfo(user, normalizeEmpCode(payload.empCode)),
    user: {
      id: user.id,
      username: user.username,
      role: payload.role,
      name: employee.name,
      department: payload.department,
      jobTitle: employee.jobTitle || '',
      empCode: payload.empCode,
    },
  });
});

router.get('/api/auth/session', authenticateToken, (req, res) => {
  const users = readUsers();
  const user = users[findUserForSession(users, req.user)];
  if (!user) return res.status(401).json({ error: 'الحساب مش موجود', expired: true });

  const code = normalizeEmpCode(req.user.empCode || '');
  const employee = findEmployee(code);
  const state = passwordState(user, code);
  const body = {
    success: true,
    needsPersonalPassword: state.needsPersonalPassword,
    mustChangePassword: state.mustChangePassword,
    ...sessionInfo(user, code),
    user: {
      id: user.id,
      username: user.username,
      role: req.user.role,
      name: req.user.name || user.name,
      department: req.user.department || '',
      jobTitle: (employee && employee.jobTitle) || '',
      empCode: req.user.empCode || '',
    },
  };
  // The password was set from another tab: hand out a token without the setup flag.
  if (Boolean(req.user.pwSetup) !== state.pwSetup) {
    body.token = signSessionToken(req.user, { sessionStart: req.user.sessionStart, pwSetup: state.pwSetup });
  }
  res.json(body);
});

router.post('/api/auth/profile', authenticateToken, async (req, res) => {
  const body = req.body || {};
  const phone = sanitizeStr(body.phone || '', 20).replace(/\s/g, '');
  const email = sanitizeStr(body.email || '', 160).trim();
  const name = sanitizeStr(body.name || '', 120).trim();
  if (!/^\+?[0-9]{8,15}$/.test(phone)) return res.status(400).json({ error: 'رقم الموبايل غير صحيح — اكتبه كده: 01xxxxxxxxx' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'الإيميل غير صحيح' });
  const code = normalizeEmpCode(req.user.empCode || '');
  if (!code || !isSafeKey(code)) return res.status(400).json({ error: 'الحساب ده مش مربوط بكود وظيفي' });

  let result;
  await enqueueWrite(async () => {
    const users = readUsers();
    const idx = findUserForSession(users, req.user);
    if (idx === -1) {
      result = { status: 404, body: { error: 'المستخدم غير موجود' } };
      return;
    }
    const now = new Date().toISOString();
    const who = name || req.user.fullName || req.user.name || '';
    const user = users[idx];
    user.profiles = user.profiles || {};
    user.profiles[code] = { name: who, phone, email, empCode: code, savedAt: now };
    user.lastHolder = { name: who, empCode: code, at: now };
    user.phone = phone;
    user.email = email;
    writeUsers(users);

    const employees = readEmployees();
    const emp = employees.find((e) => normalizeEmpCode(e.empCode || e.code) === code);
    if (emp) {
      emp.phone = phone;
      emp.email = email;
      emp.phoneUpdatedAt = now;
      writeEmployees(employees);
    }
    result = { status: 200, body: { success: true, profile: { phone, email } } };
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع' });
});

function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12)).map((b) => alphabet[b % alphabet.length]).join('');
}

const maskEmail = (e) => String(e || '').replace(/^(.).*(.)@/, (m, a, b) => `${a}****${b}@`);

/**
 * Emails a temporary password to the address saved for this account + code.
 * The current password keeps working until the temporary one is used, and the
 * response is identical whether or not the account exists.
 */
router.post('/api/auth/forgot-password', loginLimiter, async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim().toLowerCase();
  const code = normalizeEmpCode((req.body && req.body.empCode) || '');
  if (!username || !code) return res.status(400).json({ error: 'اكتب اسم المستخدم والكود الوظيفي' });
  if (!mailer.isConfigured()) return res.status(503).json({ error: 'خدمة الإيميل مش متظبطة على المنصة — كلّم مدير النظام' });

  const generic = { success: true, message: 'لو البيانات صحيحة ومتسجّل لها إيميل، هيوصلك إيميل فيه كلمة سر مؤقتة خلال دقايق' };
  const throttleKey = `${username}::${code}`;
  if (resetRequests.minutesLeft(throttleKey) || !isSafeKey(code)) return res.json(generic);
  resetRequests.record(throttleKey);

  const user = readUsers().find((u) => String(u.username || '').trim().toLowerCase() === username);
  const profile = user && user.profiles && user.profiles[code];
  const email = profile && profile.email;
  if (!user || !email) return res.json(generic);

  const temp = generateTempPassword();
  const sent = await mailer.sendMail({
    to: email,
    subject: 'كلمة سر مؤقتة — منصة السلامة (السويدي بوليمرز)',
    text: `كلمة السر المؤقتة لحسابك (${user.username}): ${temp}\nصالحة 30 دقيقة، وأول ما تدخل بيها هيتطلب منك تعمل كلمة سر جديدة. كلمة السر القديمة لسه شغالة لحد ما تستخدم دي.\nلو مش إنت اللي طلبتها، كلّم مدير النظام فورًا.`,
    html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:2">
      <b>كلمة سر مؤقتة لحسابك على منصة السلامة</b><br>
      الحساب: <b>${sanitizeStr(user.username, 80)}</b><br>
      كلمة السر المؤقتة: <b style="font-size:20px;letter-spacing:2px;font-family:Consolas,monospace">${temp}</b><br>
      صالحة <b>30 دقيقة</b> بس، وأول ما تدخل بيها هيتطلب منك تعمل كلمة سر جديدة.<br>
      <span style="color:#b91c1c">لو مش إنت اللي طلبتها، كلّم مدير النظام فورًا.</span>
    </div>`,
  });
  if (!sent.sent) {
    console.error(`[auth] reset email for "${username}" failed: ${sent.error || sent.reason}`);
    return res.json(generic);
  }

  const hash = await bcrypt.hash(temp, config.bcryptRounds);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await enqueueWrite(async () => {
    const users = readUsers();
    const target = users.find((u) => String(u.username || '').trim().toLowerCase() === username);
    if (!target) return;
    const member = target.memberCredentials && target.memberCredentials[code];
    if (member) member.reset = { hash, expiresAt };
    else target.reset = { hash, expiresAt, code };
    writeUsers(users);
  });
  logAuditEvent({
    entityType: 'user',
    entityId: user.id || user.username,
    action: 'forgot_password',
    actor: { username: user.username, name: (profile && profile.name) || '' },
    note: `كلمة سر مؤقتة اتبعتت على ${maskEmail(email)}`,
  });
  res.json(generic);
});

/** Marks every older session of this person as ended and returns a fresh token for the caller. */
function endOtherSessions(user, code, req) {
  const now = new Date().toISOString();
  user.revokedMembers = { ...(user.revokedMembers || {}), [code]: now };
  revokeSessions(user.id, code);
  return signSessionToken(req.user, { sessionStart: req.user.sessionStart, pwSetup: false });
}

router.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبتان' });
  const weak = checkPasswordStrength(newPassword, { empCode: req.user.empCode, username: req.user.username });
  if (weak) return res.status(400).json({ error: weak });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' });

  let result;
  await enqueueWrite(async () => {
    const users = readUsers();
    const idx = findUserForSession(users, req.user);
    if (idx === -1) {
      result = { status: 404, body: { error: 'المستخدم غير موجود' } };
      return;
    }
    const user = users[idx];
    const code = normalizeEmpCode(req.user.empCode || '');
    const member = isSafeKey(code) && user.memberCredentials ? user.memberCredentials[code] : null;
    const matched = await matchPassword(user, member, code, String(currentPassword));
    if (!matched) {
      result = { status: 401, body: { error: 'كلمة المرور الحالية غير صحيحة' } };
      return;
    }
    const hash = await bcrypt.hash(String(newPassword), config.bcryptRounds);
    const now = new Date().toISOString();
    if (member) {
      member.passwordHash = hash;
      member.updatedAt = now;
      delete member.mustChangePassword;
      delete member.otpExpiresAt;
      delete member.reset;
    } else {
      user.password = hash;
      user.mustChangePassword = false;
      for (const key of ['otpExpiresAt', 'otpIssuedFor', 'reset']) delete user[key];
    }
    const token = endOtherSessions(user, code, req);
    writeUsers(users);
    result = { status: 200, body: { success: true, message: 'تم تغيير كلمة المرور بنجاح', token } };
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

/**
 * First personal password for this employee code on a shared account. From
 * then on the shared password no longer works for this code.
 */
router.post('/api/auth/set-personal-password', authenticateToken, async (req, res) => {
  const { newPassword } = req.body || {};
  const code = normalizeEmpCode(req.user.empCode || '');
  if (!newPassword) return res.status(400).json({ error: 'كلمة السر مطلوبة' });
  if (!code || !isSafeKey(code)) return res.status(400).json({ error: 'الكود الوظيفي غير موجود في الجلسة — سجّل دخولك تاني' });

  let result;
  await enqueueWrite(async () => {
    const users = readUsers();
    const idx = findUserForSession(users, req.user);
    if (idx === -1) {
      result = { status: 404, body: { error: 'المستخدم غير موجود' } };
      return;
    }
    const user = users[idx];
    user.memberCredentials = user.memberCredentials || {};
    if (user.memberCredentials[code]) {
      result = { status: 409, body: { error: 'عندك كلمة سر شخصية بالفعل على الحساب ده — استخدم "تغيير كلمة المرور"' } };
      return;
    }
    const weak = checkPasswordStrength(newPassword, { empCode: code, username: user.username });
    if (weak) {
      result = { status: 400, body: { error: weak } };
      return;
    }
    user.memberCredentials[code] = {
      passwordHash: await bcrypt.hash(String(newPassword), config.bcryptRounds),
      name: req.user.name || '',
      createdAt: new Date().toISOString(),
    };
    if (user.reset && user.reset.code === code) delete user.reset;
    // A shared password handed out by an admin (or an old default) lets one person in: once they have a
    // personal password it stops working, and the next member needs a new one from an admin.
    if (user.mustChangePassword === true) {
      user.password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), config.bcryptRounds);
      user.mustChangePassword = false;
      user.sharedPasswordUsedBy = code;
      user.sharedPasswordUsedAt = new Date().toISOString();
    }
    const token = endOtherSessions(user, code, req);
    writeUsers(users);
    result = { status: 200, body: { success: true, message: 'تم إنشاء كلمة السر الشخصية بنجاح', token } };
  });
  if (result && result.status === 200) {
    logAuditEvent({
      entityType: 'user',
      entityId: req.user.id || req.user.username,
      action: 'set_personal_password',
      actor: req.user,
      note: `عمل كلمة سر شخصية جديدة على الحساب (${req.user.username})`,
    });
  }
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

/** WhatsApp number for the signed-in admin's own account. */
router.patch('/api/auth/phone', authenticateToken, async (req, res) => {
  const phone = sanitizeStr((req.body && req.body.phone) || '', 20);
  if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'رقم الهاتف غير صالح — أدخل رقمًا يحتوي أرقامًا فقط (8-15 رقم)' });
  }
  let result;
  await enqueueWrite(async () => {
    const users = readUsers();
    const idx = findUserForSession(users, req.user);
    if (idx === -1) {
      result = { status: 404, body: { error: 'المستخدم غير موجود' } };
      return;
    }
    users[idx].phone = phone;
    users[idx].whatsappOptIn = (req.body || {}).optIn !== false;
    writeUsers(users);
    result = { status: 200, body: { success: true, phone, whatsappOptIn: users[idx].whatsappOptIn } };
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع' });
});

/**
 * Renews the session token from the stored account, so role/department
 * changes and revocations apply; sessions end after 12 hours regardless.
 */
router.post('/api/auth/refresh', authenticateToken, (req, res) => {
  const users = readUsers();
  const stored = users[findUserForSession(users, req.user)];
  const code = normalizeEmpCode(req.user.empCode || '');
  const revokedMs = stored ? Math.max(
    Date.parse(stored.sessionsRevokedAt || '') || 0,
    Date.parse((stored.revokedMembers || {})[code] || '') || 0,
  ) : 0;
  const lockedCode = stored && stored.empCode ? normalizeEmpCode(stored.empCode) : '';
  const allowed = stored && Array.isArray(stored.allowedEmpCodes) && stored.allowedEmpCodes.length
    ? stored.allowedEmpCodes.map((c) => normalizeEmpCode(c)) : null;
  if (!stored || sessionExpired(req.user) || (revokedMs && tokenIssuedMs(req.user) < revokedMs)
    || (lockedCode && code && lockedCode !== code) || (allowed && code && !allowed.includes(code))) {
    return res.status(401).json({ error: 'الجلسة اتقفلت — سجّل الدخول من جديد', expired: true });
  }

  const payload = normalizeSessionRole({
    id: stored.id || req.user.id,
    username: stored.username,
    role: stored.role || req.user.role,
    name: req.user.name,
    fullName: req.user.fullName || req.user.name,
    empCode: req.user.empCode,
    department: ['dept_admin', 'maint_admin'].includes(stored.role) ? (stored.department || '') : (req.user.department || ''),
  });
  const { pwSetup } = passwordState(stored, code);
  res.json({ success: true, token: signSessionToken(payload, { sessionStart: req.user.sessionStart || req.user.iatMs, pwSetup }) });
});

const LINK_PATH_RE = /^\/(api\/[a-z0-9\-_/%.]+|print\/[a-z0-9\-_/%.]+)$/i;

router.post('/api/auth/link-token', authenticateToken, (req, res) => {
  const p = String((req.body && req.body.path) || '').split('?')[0];
  if (!p || p.length > 300 || p.includes('..') || !LINK_PATH_RE.test(p)) return res.status(400).json({ error: 'مسار غير صالح' });
  res.json({ token: signLinkToken(req.user, p) });
});

module.exports = router;
