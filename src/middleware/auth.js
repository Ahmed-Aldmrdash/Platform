'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { VIEWER_ROLES } = require('../constants');
const { normalizeEmpCode } = require('../utils/validation');
const { normalizeSessionRole } = require('../utils/roles');
const { shared, usersStore } = require('../data/stores');

const VERIFY_OPTIONS = { algorithms: ['HS256'] };
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, VERIFY_OPTIONS);
}

function bearerToken(req) {
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * Admin session token. `sessionStart` survives refreshes so a session can't be
 * extended forever; `pwSetup` marks sessions that must set a password first.
 */
function signSessionToken(payload, { sessionStart = Date.now(), pwSetup = false } = {}) {
  const claims = { ...payload, iatMs: Date.now(), sessionStart };
  delete claims.iat;
  delete claims.exp;
  if (pwSetup) claims.pwSetup = true;
  else delete claims.pwSetup;
  return jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function sessionExpired(decoded) {
  const start = Number(decoded.sessionStart) || Number(decoded.iatMs) || (Number(decoded.iat) || 0) * 1000;
  return Date.now() - start > MAX_SESSION_MS;
}

function signWorkerToken(emp, cred) {
  return jwt.sign({
    role: 'worker',
    empCode: normalizeEmpCode(emp.empCode),
    name: emp.name || '',
    department: emp.department || '',
    pwv: (cred && cred.pwv) || '',
  }, config.jwtSecret, { expiresIn: config.workerJwtExpiresIn });
}

/** Short-lived token that only works for one download/print URL. */
function signLinkToken(user, linkPath) {
  return jwt.sign({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    fullName: user.fullName || user.name,
    empCode: user.empCode,
    department: user.department || '',
    purpose: 'link',
    path: linkPath,
  }, config.jwtSecret, { expiresIn: '2m' });
}

// Revocation: an in-memory map for instant effect, backed by the
// sessionsRevokedAt / revokedMembers fields stored on the account.
const revokedSessions = new Map();
let revocationCache = { version: null, byId: new Map() };

function persistedRevocations() {
  const version = usersStore.version();
  if (revocationCache.version !== version) {
    const byId = new Map();
    for (const u of usersStore.read()) {
      if (u.sessionsRevokedAt || u.revokedMembers) {
        byId.set(String(u.id), { all: Date.parse(u.sessionsRevokedAt || '') || 0, members: u.revokedMembers || {} });
      }
    }
    revocationCache = { version, byId };
  }
  return revocationCache.byId;
}

function revokeSessions(userId, empCode) {
  if (!userId) return;
  const key = empCode ? `${userId}::${normalizeEmpCode(empCode)}` : String(userId);
  revokedSessions.set(key, Date.now());
}

function tokenIssuedMs(decoded) {
  const ms = Number(decoded && decoded.iatMs);
  return Number.isFinite(ms) && ms > 0 ? ms : ((Number(decoded && decoded.iat) || 0) * 1000 + 999);
}

function isSessionRevoked(decoded) {
  if (!decoded || !decoded.id) return false;
  const code = normalizeEmpCode(decoded.empCode || '');
  let at = Math.max(revokedSessions.get(String(decoded.id)) || 0, revokedSessions.get(`${decoded.id}::${code}`) || 0);
  const stored = persistedRevocations().get(String(decoded.id));
  if (stored) at = Math.max(at, stored.all, Date.parse(stored.members[code] || '') || 0);
  return Boolean(at) && tokenIssuedMs(decoded) < at;
}

const unauthorized = (res, error, extra = {}) => res.status(401).json({ error, ...extra });
const SESSION_EXPIRED = 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً';
const SESSION_REVOKED = 'الجلسة اتقفلت (الحساب اتعدّل أو اتمسح) — سجّل الدخول من جديد';

// While a session still has to set its password, only these endpoints work.
const PASSWORD_SETUP_PATHS = /^\/api\/(auth\/(session|profile|change-password|set-personal-password|refresh)|notifications\/subscribe)$/;

/** Admin sessions only (Bearer token). */
function authenticateToken(req, res, next) {
  const token = bearerToken(req);
  if (!token) return unauthorized(res, 'غير مصرح: يجب تسجيل الدخول أولاً');
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return unauthorized(res, SESSION_EXPIRED, { expired: true });
  }
  if (decoded.purpose === 'link') return unauthorized(res, 'غير مصرح: رابط مؤقت مش صالح هنا');
  if (decoded.role === 'worker') return res.status(403).json({ error: 'غير مصرح: هذه العملية للإدارة فقط' });
  if (isSessionRevoked(decoded)) return unauthorized(res, SESSION_REVOKED, { expired: true });
  if (decoded.pwSetup && !PASSWORD_SETUP_PATHS.test(req.path)) {
    return res.status(403).json({ error: 'لازم تعمل كلمة سر جديدة الأول', needsPersonalPassword: true });
  }
  req.user = normalizeSessionRole(decoded);
  next();
}

/** Worker or admin session. Workers get req.worker with the identity from their token. */
function authenticateSession(req, res, next) {
  const token = bearerToken(req);
  if (!token) return unauthorized(res, 'غير مصرح: يجب تسجيل الدخول أولاً');
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return unauthorized(res, 'انتهت الجلسة — سجّل الدخول من جديد', { expired: true });
  }
  if (decoded.role !== 'worker') return authenticateToken(req, res, next);

  const code = normalizeEmpCode(decoded.empCode);
  const cred = code ? shared.workerCreds()[code] : null;
  // pwv changes whenever the worker's password changes, ending older sessions.
  if (!cred || !cred.hash || (cred.pwv || '') !== (decoded.pwv || '')) {
    return unauthorized(res, 'كلمة السر اتغيرت أو الجلسة انتهت — سجّل الدخول من جديد', { expired: true });
  }
  req.user = decoded;
  req.worker = { empCode: code, name: decoded.name || '', department: decoded.department || '' };
  next();
}

function samePath(a, b) {
  const decode = (p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  };
  return a === b || decode(a) === decode(b);
}

/**
 * For plain links (downloads, print pages) that can't send headers: accepts
 * a header session or a ?dt= link token bound to exactly this path.
 */
function authenticateTokenFlexible(req, res, next) {
  const headerToken = bearerToken(req);
  const queryToken = typeof req.query.dt === 'string' ? req.query.dt : null;
  const token = headerToken || queryToken;
  if (!token) return unauthorized(res, 'غير مصرح: يجب تسجيل الدخول أولاً');
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return unauthorized(res, SESSION_EXPIRED, { expired: true });
  }
  if (decoded.role === 'worker') return res.status(403).json({ error: 'غير مصرح: هذه العملية للإدارة فقط' });
  if (!headerToken && decoded.purpose !== 'link') return unauthorized(res, 'الرابط ده مش صالح — ارجع للمنصة واضغط الزرار تاني');
  if (decoded.purpose === 'link') {
    const reqPath = String(req.originalUrl || '').split('?')[0];
    if (!decoded.path || !samePath(reqPath, decoded.path)) {
      return res.status(403).json({ error: 'الرابط ده مش مخصص للملف ده — ارجع للمنصة واضغط الزرار تاني' });
    }
  } else if (decoded.pwSetup) {
    return res.status(403).json({ error: 'لازم تعمل كلمة سر جديدة الأول', needsPersonalPassword: true });
  }
  if (isSessionRevoked(decoded)) return unauthorized(res, SESSION_REVOKED, { expired: true });
  req.user = normalizeSessionRole(decoded);
  next();
}

/**
 * Role gate. Viewer (oversight) accounts may read anything guarded here; use
 * requireRoleStrict for data that must stay with the listed roles only.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return unauthorized(res, 'غير مصرح: لم يتم التحقق من الهوية');
    if (VIEWER_ROLES.includes(req.user.role) && (req.method === 'GET' || req.method === 'HEAD')) return next();
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `ليس لديك صلاحية لهذه العملية. المطلوب: ${roles.join(' أو ')}` });
    }
    next();
  };
}

function requireRoleStrict(...roles) {
  return (req, res, next) => {
    if (!req.user) return unauthorized(res, 'غير مصرح: لم يتم التحقق من الهوية');
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'ليس لديك صلاحية لهذه العملية' });
    next();
  };
}

module.exports = {
  MAX_SESSION_MS,
  verifyToken,
  bearerToken,
  signSessionToken,
  sessionExpired,
  signWorkerToken,
  signLinkToken,
  revokeSessions,
  tokenIssuedMs,
  isSessionRevoked,
  authenticateToken,
  authenticateSession,
  authenticateTokenFlexible,
  requireRole,
  requireRoleStrict,
};
