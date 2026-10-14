'use strict';

const config = require('../config');

/** Content-Disposition with a readable (Arabic) file name plus an ASCII fallback. */
function setDownloadFilename(res, niceNameNoExt, ext) {
  const clean = String(niceNameNoExt).replace(/["\\\r\n/]/g, ' ').replace(/\s+/g, '_').trim().slice(0, 150) || 'file';
  const asciiFallback = clean.replace(/[^\x20-\x7E]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'download';
  const encoded = encodeURIComponent(`${clean}.${ext}`);
  res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}.${ext}"; filename*=UTF-8''${encoded}`);
}

/** Public origin of the site; empty when the Host header doesn't look legitimate. */
function siteBaseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const host = String(req.get('host') || '');
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? `${req.protocol}://${host}` : '';
}

module.exports = { setDownloadFilename, siteBaseUrl };
