'use strict';

/** Employee codes come from Excel sheets, forms and QR scans: "00271", " 271" and 271 are the same person. */
function normalizeEmpCode(code) {
  if (!code && code !== 0) return '';
  const stripped = String(code).trim().replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

/** Department names come from several sources and often carry stray whitespace. */
function deptMatches(a, b) {
  const na = String(a || '').trim();
  const nb = String(b || '').trim();
  return na !== '' && na === nb;
}

function sanitizeStr(val, maxLen = 500) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/[<>"'`\\]/g, '')
    .trim()
    .slice(0, maxLen);
}

function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '123456', '111111', '000000', 'password',
  'admin123', 'qwerty123', 'elsewedy', 'elsewedy1', '12341234', 'abcd1234', 'aaaaaaaa',
]);

/** Returns an Arabic error message, or null when the password is acceptable. */
function checkPasswordStrength(password, context = {}) {
  const pw = String(password || '');
  if (pw.length < 8) return 'كلمة السر لازم تكون 8 حروف أو أرقام على الأقل';
  if (pw.length > 128) return 'كلمة السر طويلة أوي';
  if (WEAK_PASSWORDS.has(pw.toLowerCase())) return 'كلمة السر دي معروفة وسهلة التخمين — اختار واحدة تانية';
  if (/^(.)\1+$/.test(pw)) return 'كلمة السر مش ممكن تكون حرف واحد متكرر';
  if (/^(?:0123456789|1234567890|9876543210)/.test(pw)) return 'كلمة السر مش ممكن تكون أرقام متسلسلة';
  const code = String(context.empCode || '').trim();
  const username = String(context.username || '').trim().toLowerCase();
  if (code && pw.includes(code)) return 'ما تخليش كلمة السر فيها كودك الوظيفي — ده أول حاجة أي حد هيجربها';
  if (username && username.length >= 4 && pw.toLowerCase().includes(username)) return 'ما تخليش كلمة السر فيها اسم المستخدم بتاعك';
  return null;
}

/** Plain object keys that must never come from user input. */
function isSafeKey(key) {
  return typeof key === 'string' && key !== '' && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

module.exports = {
  normalizeEmpCode,
  deptMatches,
  sanitizeStr,
  clampInt,
  checkPasswordStrength,
  isSafeKey,
};
