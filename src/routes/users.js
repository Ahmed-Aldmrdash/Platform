'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { readUsers, writeUsers } = require('../data/stores');
const { enqueueWrite } = require('../data/write-queue');
const { authenticateToken, requireRoleStrict, revokeSessions } = require('../middleware/auth');
const { logAuditEvent } = require('../services/audit-log');
const { clearAdminFailures, clearAdminFailuresForCode } = require('../services/login-guard');
const { checkPasswordStrength, normalizeEmpCode, sanitizeStr, isSafeKey } = require('../utils/validation');

const router = express.Router();

const VALID_ROLES = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin', 'ceo', 'hse_director'];
const UNEXPECTED_ERROR = { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' };
const respond = (res, result) => res.status(result ? result.status : 500).json(result ? result.body : UNEXPECTED_ERROR);
const superAdminOnly = [authenticateToken, requireRoleStrict('super_admin')];

router.get('/api/users', ...superAdminOnly, (req, res) => {
  res.json({
    users: readUsers().map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      name: u.name,
      department: u.department || '',
      empCode: u.empCode || '',
      phone: u.phone || '',
      email: u.email || '',
      createdAt: u.createdAt,
      mustChangePassword: u.mustChangePassword === true,
      members: Object.entries(u.memberCredentials || {}).map(([code, c]) => ({
        empCode: code,
        name: (c && c.name) || '',
        createdAt: (c && c.createdAt) || '',
        updatedAt: (c && c.updatedAt) || '',
      })),
    })),
  });
});

router.post('/api/users', ...superAdminOnly, async (req, res) => {
  const body = req.body || {};
  const { username, password, role, name } = body;
  if (!username || !password || !role || !name) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `الدور غير صالح. الأدوار المتاحة: ${VALID_ROLES.join(', ')}` });
  if (role === 'dept_admin' && !body.department) return res.status(400).json({ error: 'يجب تحديد القسم لرئيس القسم' });
  const weak = checkPasswordStrength(password, { username });
  if (weak) return res.status(400).json({ error: weak });

  let result;
  await enqueueWrite(async () => {
    const users = readUsers();
    const cleanUsername = sanitizeStr(username, 60);
    if (users.some((u) => String(u.username || '').toLowerCase() === cleanUsername.toLowerCase())) {
      result = { status: 409, body: { error: 'اسم المستخدم موجود بالفعل' } };
      return;
    }
    const user = {
      id: `user-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      username: cleanUsername,
      password: await bcrypt.hash(password, config.bcryptRounds),
      role,
      name: sanitizeStr(name, 120),
      department: ['dept_admin', 'maint_admin'].includes(role) ? sanitizeStr(body.department || '', 100) : '',
      phone: sanitizeStr(body.phone || '', 20),
      whatsappOptIn: Boolean(body.phone),
      empCode: normalizeEmpCode(sanitizeStr(body.empCode || '', 20)) || '',
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);
    result = { status: 200, body: { success: true, user: { id: user.id, username: user.username, role: user.role, name: user.name } } };
  });
  if (result && result.status === 200) {
    logAuditEvent({ entityType: 'user', entityId: result.body.user.id, action: 'create', actor: req.user, note: `إنشاء حساب ${result.body.user.username} (${role})` });
  }
  respond(res, result);
});

router.delete('/api/users/:id', ...superAdminOnly, async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const users = readUsers();
    const target = users.find((u) => u.id === req.params.id);
    if (!target) {
      result = { status: 404, body: { error: 'المستخدم غير موجود' } };
      return;
    }
    if (target.role === 'super_admin') {
      result = { status: 403, body: { error: 'لا يمكن حذف حساب المدير العام' } };
      return;
    }
    writeUsers(users.filter((u) => u.id !== target.id));
    revokeSessions(target.id);
    result = { status: 200, body: { success: true } };
  });
  if (result && result.status === 200) logAuditEvent({ entityType: 'user', entityId: req.params.id, action: 'delete', actor: req.user, note: 'حذف حساب' });
  respond(res, result);
});

/** Replaces the shared password of every auto-created account still on the old default with a random one. */
router.post('/api/users/generate-default-passwords', ...superAdminOnly, async (req, res) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const generate = () => Array.from(crypto.randomBytes(10)).map((b) => alphabet[b % alphabet.length]).join('');
  const planned = [];
  for (const u of readUsers()) {
    const isAuto = typeof u.id === 'string' && (u.id.startsWith('auto-dept-') || u.id.startsWith('auto-maint-'));
    if (!isAuto || typeof u.password !== 'string' || !u.password.startsWith('$2')) continue;
    if (!(await bcrypt.compare('123456', u.password))) continue;
    const password = generate();
    planned.push({ id: u.id, oldHash: u.password, newHash: await bcrypt.hash(password, config.bcryptRounds), password, username: u.username, name: u.name || '', department: u.department || '' });
  }

  const accounts = [];
  await enqueueWrite(async () => {
    const users = readUsers();
    for (const p of planned) {
      const u = users.find((x) => x.id === p.id && x.password === p.oldHash);
      if (!u) continue;
      u.password = p.newHash;
      u.mustChangePassword = true;
      accounts.push({ username: p.username, name: p.name, department: p.department, password: p.password });
    }
    if (accounts.length) writeUsers(users);
  });
  if (accounts.length) {
    logAuditEvent({ entityType: 'database', entityId: 'app-users', action: 'update', actor: req.user, note: `توليد كلمات سر جديدة لـ ${accounts.length} حساب كان على كلمة السر الافتراضية` });
  }
  res.json({ success: true, count: accounts.length, accounts });
});

router.put('/api/users/:id', ...superAdminOnly, async (req, res) => {
  const body = req.body || {};
  const { name, username, role, department, newPassword } = body;
  if (!name || !username || !role) return res.status(400).json({ error: 'الاسم واسم المستخدم والدور مطلوبة' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'الدور غير صالح' });
  const weak = newPassword ? checkPasswordStrength(newPassword, { username }) : null;
  if (weak) return res.status(400).json({ error: weak });

  let result;
  await enqueueWrite(async () => {
    const users = readUsers();
    const user = users.find((u) => u.id === req.params.id);
    if (!user) {
      result = { status: 404, body: { error: 'المستخدم غير موجود' } };
      return;
    }
    const cleanUsername = sanitizeStr(username, 60);
    if (cleanUsername !== user.username && users.some((u) => u.username === cleanUsername)) {
      result = { status: 400, body: { error: 'اسم المستخدم مسجل مسبقاً' } };
      return;
    }
    const before = { username: user.username, role: user.role, department: user.department || '', empCode: user.empCode || '' };
    user.name = sanitizeStr(name, 120);
    user.username = cleanUsername;
    user.role = role;
    user.department = ['dept_admin', 'maint_admin'].includes(role) ? sanitizeStr(department || user.department || '', 100) : '';
    if (body.empCode !== undefined) user.empCode = normalizeEmpCode(sanitizeStr(body.empCode || '', 20)) || '';
    if (newPassword) {
      user.password = await bcrypt.hash(newPassword, config.bcryptRounds);
      user.mustChangePassword = user.id !== req.user.id;
      clearAdminFailures(user.username);
    }

    // Any change to who may use the account, or its password, ends the account's open sessions.
    const accessChanged = before.username !== user.username || before.role !== user.role
      || before.department !== (user.department || '') || before.empCode !== (user.empCode || '');
    const mustRevoke = user.id !== req.user.id && (accessChanged || Boolean(newPassword));
    if (mustRevoke) user.sessionsRevokedAt = new Date().toISOString();
    writeUsers(users);
    if (mustRevoke) revokeSessions(user.id);
    result = { status: 200, body: { success: true } };
  });
  if (result && result.status === 200) logAuditEvent({ entityType: 'user', entityId: req.params.id, action: 'update', actor: req.user, note: `تعديل الحساب ${sanitizeStr(username, 60)}${newPassword ? ' مع كلمة سر جديدة' : ''}` });
  respond(res, result);
});

/** Removes one person's personal password so they set a new one on their next login. */
router.patch('/api/users/:id/reset-member-password', ...superAdminOnly, async (req, res) => {
  const empCode = normalizeEmpCode(sanitizeStr((req.body && req.body.empCode) || '', 20));
  if (!empCode || !isSafeKey(empCode)) return res.status(400).json({ error: 'الكود الوظيفي مطلوب' });

  let result;
  let memberName = '';
  await enqueueWrite(async () => {
    const users = readUsers();
    const user = users.find((u) => u.id === req.params.id);
    if (!user) {
      result = { status: 404, body: { error: 'الحساب غير موجود' } };
      return;
    }
    if (!user.memberCredentials || !user.memberCredentials[empCode]) {
      result = { status: 404, body: { error: 'الشخص ده لسه معملش كلمة سر شخصية على الحساب ده' } };
      return;
    }
    memberName = user.memberCredentials[empCode].name || '';
    delete user.memberCredentials[empCode];
    user.revokedMembers = { ...(user.revokedMembers || {}), [empCode]: new Date().toISOString() };
    writeUsers(users);
    revokeSessions(user.id, empCode);
    result = { status: 200, body: { success: true, message: 'تم مسح كلمة السر الشخصية — هيتطلب منه يعمل واحدة جديدة أول ما يدخل' } };
  });
  if (result && result.status === 200) {
    logAuditEvent({
      entityType: 'user',
      entityId: req.params.id,
      action: 'reset_member_password',
      actor: req.user,
      note: `مسح كلمة سر شخصية للكود ${empCode}${memberName ? ` (${memberName})` : ''}`,
    });
    clearAdminFailuresForCode(empCode);
  }
  respond(res, result);
});

module.exports = router;
