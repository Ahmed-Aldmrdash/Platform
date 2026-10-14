'use strict';

const mailer = require('./mailer');
const { smtpStore } = require('../data/stores');
const { decryptSecret } = require('./secrets');

const DEFAULT_FROM_NAME = 'منصة السلامة — السويدي بوليمرز';

/** Pushes the SMTP account saved from the admin screen into the mailer. */
function loadSmtpSettings() {
  const s = smtpStore.read() || {};
  if (s.host && s.user && s.passEnc) {
    const pass = decryptSecret(s.passEnc);
    if (pass) {
      mailer.configure({
        host: s.host,
        port: Number(s.port) || 587,
        secure: !!s.secure,
        user: s.user,
        pass,
        from: s.from || s.user,
        fromName: s.fromName || DEFAULT_FROM_NAME,
      });
      return true;
    }
    console.warn('[smtp] could not decrypt the saved SMTP password (JWT_SECRET changed?) — re-enter it from the backup screen');
  }
  mailer.configure(null);
  return false;
}

module.exports = { loadSmtpSettings, DEFAULT_FROM_NAME };
