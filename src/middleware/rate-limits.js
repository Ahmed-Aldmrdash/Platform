'use strict';

const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTE = 60 * 1000;

function limiter({ windowMs = 15 * MINUTE, max, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    max,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

// The whole factory shares one public IP, so limits that run after
// authentication are counted per person instead of per IP.
function perUserKey(req) {
  if (req.worker && req.worker.empCode) return `w:${req.worker.empCode}`;
  if (req.user && (req.user.id || req.user.username)) return `a:${req.user.id || req.user.username}`;
  return `ip:${ipKeyGenerator(req.ip)}`;
}

function tokenOrIpKey(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return 'cb:' + crypto.createHash('sha256').update(header.slice(7)).digest('hex').slice(0, 20);
  }
  return `cb-ip:${ipKeyGenerator(req.ip)}`;
}

module.exports = {
  perUserKey,
  loginLimiter: limiter({
    max: 60,
    message: 'تجاوزت عدد محاولات تسجيل الدخول. حاول مجدداً بعد 15 دقيقة.',
  }),
  // Wide on purpose: the real brute-force protection is the per-code lockout.
  workerAuthLimiter: limiter({
    max: 300,
    message: 'تجاوزت عدد المحاولات المسموح بها. حاول مجدداً بعد 15 دقيقة.',
  }),
  submitLimiter: limiter({
    max: 30,
    keyGenerator: perUserKey,
    message: 'تجاوزت الحد المسموح لتقديم الطلبات. حاول مجدداً بعد 15 دقيقة.',
  }),
  employeeLimiter: limiter({
    max: 20,
    keyGenerator: perUserKey,
    message: 'تجاوزت عدد محاولات التسجيل. حاول مجدداً بعد 15 دقيقة.',
  }),
  attendLimiter: limiter({
    max: 15,
    keyGenerator: perUserKey,
    message: 'تجاوزت عدد محاولات تسجيل الحضور. حاول مجدداً بعد 15 دقيقة.',
  }),
  trainingRequestLimiter: limiter({
    windowMs: 60 * MINUTE,
    max: 10,
    keyGenerator: perUserKey,
    message: 'تجاوزت عدد طلبات المحاضرات المسموح بها. حاول مجدداً بعد شوية.',
  }),
  // Excel registers and forwarded reports sent by hand from the admin screens.
  emailSendLimiter: limiter({
    max: 20,
    keyGenerator: perUserKey,
    message: 'بعت إيميلات كتير في وقت قصير — استنى ربع ساعة وجرب تاني.',
  }),
  chatbotLimiter: limiter({
    max: 120,
    keyGenerator: tokenOrIpKey,
    message: 'تجاوزت عدد الرسائل المسموح بها للشات بوت. حاول مجدداً بعد شوية.',
  }),
};
