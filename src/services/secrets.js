'use strict';

const crypto = require('crypto');
const config = require('../config');

// AES-256-GCM for secrets stored in the database (the SMTP password). The key
// is derived from JWT_SECRET, so rotating that secret means re-entering them.
const KEY = crypto.createHash('sha256').update(`${config.jwtSecret}::secrets::v1`).digest();

function encryptSecret(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(blob) {
  try {
    const [v, iv, tag, data] = String(blob || '').split(':');
    if (v !== 'v1' || !iv || !tag || !data) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { encryptSecret, decryptSecret };
