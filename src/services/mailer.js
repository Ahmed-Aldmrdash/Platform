'use strict';

// SMTP sending. Settings saved from the admin screen take priority over the SMTP_* variables in .env.

const nodemailer = require('nodemailer');

let _dbSettings = null;
let _transport = null;

function envSettings() {
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  return {
    host: process.env.SMTP_HOST || '',
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    fromName: process.env.SMTP_FROM_NAME || '',
    source: 'env',
  };
}

function active() {
  if (_dbSettings && _dbSettings.host && _dbSettings.user && _dbSettings.pass) {
    return { ..._dbSettings, source: 'db' };
  }
  return envSettings();
}

function configure(settings) {
  _dbSettings = settings ? { ...settings } : null;
  _transport = null;
}

function isConfigured() {
  const a = active();
  return Boolean(a.host && a.user && a.pass);
}

function fromAddress() {
  const a = active();
  const addr = a.from || a.user;
  return a.fromName ? `"${a.fromName}" <${addr}>` : addr;
}

function publicSettings() {
  const a = active();
  return {
    host: a.host || '', port: a.port || 587, secure: !!a.secure,
    user: a.user || '', from: a.from || a.user || '', fromName: a.fromName || '',
    hasPass: Boolean(a.pass), source: a.source, configured: isConfigured(),
  };
}

function getTransport() {
  if (!_transport) {
    const a = active();
    _transport = nodemailer.createTransport({
      host: a.host,
      port: a.port,
      secure: !!a.secure,
      auth: { user: a.user, pass: a.pass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });
  }
  return _transport;
}

async function verify() {
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendMail({ to, subject, text, html, attachments }) {
  if (!isConfigured()) return { sent: false, reason: 'not_configured' };
  try {
    const info = await getTransport().sendMail({ from: fromAddress(), to, subject, text, html, attachments });
    return { sent: true, accepted: info.accepted || [], rejected: info.rejected || [] };
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return { sent: false, reason: 'smtp_error', error: err.message };
  }
}

module.exports = { isConfigured, sendMail, fromAddress, configure, publicSettings, verify, active };
