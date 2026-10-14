'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const URL_PREFIX = '/uploads/hazards/';
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

// The type is taken from the file's magic bytes, never from the client.
function detectImage(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buffer.length > 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') return { ext: 'png', type: 'image/png' };
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

/**
 * Stores a base64 / data-URL photo and returns its public URL, or '' when the
 * upload is missing, too large or not a JPEG/PNG/WebP image.
 */
function saveHazardPhoto(raw, prefix = 'HZ') {
  if (!raw) return '';
  try {
    const base64 = String(raw).replace(/^data:image\/[\w+.-]+;base64,/, '');
    if (Math.floor(base64.length * 0.75) > MAX_PHOTO_BYTES) {
      console.warn('[uploads] hazard photo rejected: too large');
      return '';
    }
    const buffer = Buffer.from(base64, 'base64');
    const image = detectImage(buffer);
    if (!image) {
      console.warn('[uploads] hazard photo rejected: not a JPEG/PNG/WebP image');
      return '';
    }
    const name = `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${image.ext}`;
    db.files.put(`hazards/${name}`, image.type, buffer);
    return URL_PREFIX + name;
  } catch (err) {
    console.error('[uploads] could not save hazard photo:', err.message);
    return '';
  }
}

/** Resolves a stored photo URL to { contentType, buffer } (null if missing or invalid). */
async function readHazardPhoto(url) {
  const name = String(url || '').startsWith(URL_PREFIX) ? String(url).slice(URL_PREFIX.length) : '';
  if (!NAME_RE.test(name)) return null;
  return db.files.get(`hazards/${name}`);
}

async function serveHazardPhoto(req, res, next) {
  const name = String(req.params.name || '');
  if (!NAME_RE.test(name)) return res.status(404).end();
  try {
    const file = await db.files.get(`hazards/${name}`);
    if (!file) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(file.contentType).send(file.buffer);
  } catch (err) {
    next(err);
  }
}

/** Moves photos left on disk by older versions into the database. */
async function importLegacyPhotos() {
  const dir = config.paths.LEGACY_HAZARD_UPLOADS_DIR;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    if (await db.files.get(`hazards/${name}`)) continue;
    const buffer = fs.readFileSync(path.join(dir, name));
    const image = detectImage(buffer);
    if (image) db.files.put(`hazards/${name}`, image.type, buffer);
  }
}

module.exports = { saveHazardPhoto, readHazardPhoto, serveHazardPhoto, importLegacyPhotos, MAX_PHOTO_BYTES };
