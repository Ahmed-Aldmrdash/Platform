'use strict';

const crypto = require('crypto');

// Polled endpoints answer 304 from a cheap version string (collection write
// counters + viewer identity) without reading or serialising any data.

function versionEtag(parts) {
  return 'W/"v-' + crypto.createHash('sha1').update(parts.join('|')).digest('base64url').slice(0, 24) + '"';
}

function clientHasEtag(req, tag) {
  const inm = req.headers['if-none-match'];
  return Boolean(inm) && inm.split(',').some((s) => s.trim() === tag);
}

/** Sets the ETag; returns true (and sends 304) when the client already has this version. */
function replyNotModified(req, res, parts) {
  const tag = versionEtag(parts);
  res.setHeader('ETag', tag);
  if (clientHasEtag(req, tag)) {
    res.status(304).end();
    return true;
  }
  return false;
}

/** The identity a response depends on (role, department, account). */
function viewerKey(req) {
  const u = req.user || {};
  return req.worker ? `w:${req.worker.empCode}` : `a:${u.role || ''}:${u.department || ''}:${u.id || u.username || ''}`;
}

/**
 * Caches heavy aggregate responses (dashboards) per viewer and filter until any
 * of the given stores changes or the time bucket rolls over.
 */
function cacheJsonResponse({ stores, keyFn, bucketMs = 60 * 1000, max = 200 }) {
  const cache = new Map();
  return (req, res, next) => {
    const key = keyFn(req);
    if (!key) return next();
    const ver = stores.map((s) => s.version()).join('|') + '|' + Math.floor(Date.now() / bucketMs);
    const hit = cache.get(key);
    if (hit && hit.ver === ver) {
      res.setHeader('ETag', hit.etag);
      if (clientHasEtag(req, hit.etag)) return res.status(304).end();
      return res.type('application/json').send(hit.body);
    }
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const str = JSON.stringify(body);
        const etag = versionEtag([key, ver]);
        cache.delete(key);
        cache.set(key, { ver, body: str, etag });
        if (cache.size > max) cache.delete(cache.keys().next().value);
        res.setHeader('ETag', etag);
        return res.type('application/json').send(str);
      }
      return origJson(body);
    };
    next();
  };
}

const POLLED_GET_PREFIXES = ['/api/storage/', '/api/hazards', '/api/my-hazards/', '/api/trainings', '/api/drills'];

/** HTML is never cached; polled JSON must always revalidate (cheap 304s via ETag). */
function cacheControlHeaders(req, res, next) {
  const p = req.path;
  if (p === '/' || p.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (req.method === 'GET' && POLLED_GET_PREFIXES.some((prefix) => p.startsWith(prefix))) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
  next();
}

module.exports = {
  versionEtag,
  clientHasEtag,
  replyNotModified,
  viewerKey,
  cacheJsonResponse,
  cacheControlHeaders,
};
