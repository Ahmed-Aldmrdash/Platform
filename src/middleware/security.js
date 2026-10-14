'use strict';

const { VIEWER_ROLES } = require('../constants');
const { bearerToken, verifyToken } = require('./auth');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(self), microphone=(self), payment=()');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (req.secure || forwardedProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  next();
}

// Writes a viewer account may still make: its own session/profile, notifications and read-only exports.
const VIEWER_ALLOWED_WRITES = [
  /^\/api\/auth\/(change-password|set-personal-password|profile|refresh|link-token)$/,
  /^\/api\/reports\/email$/,
  /^\/api\/chatbot\/message$/,
  /^\/api\/dashboard\/export-(excel-charts|powerbi)$/,
  /^\/api\/notifications\/(mark-read|read-all|subscribe)$/,
  /^\/api\/notifications\/read\/[^/]+$/,
];

/** Server-side guarantee that read-only accounts can't change anything, whatever the UI does. */
function viewerReadOnlyGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const token = bearerToken(req) || (req.query && typeof req.query.dt === 'string' ? req.query.dt : null);
  if (!token) return next();
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return next();
  }
  if (VIEWER_ROLES.includes(decoded.role) && !VIEWER_ALLOWED_WRITES.some((re) => re.test(req.path))) {
    return res.status(403).json({
      error: 'الحساب ده للمتابعة والعرض فقط — مش مسموح بأي إضافة أو تعديل أو حذف.',
      readOnly: true,
    });
  }
  next();
}

module.exports = { securityHeaders, viewerReadOnlyGuard };
