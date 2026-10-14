'use strict';

const fs = require('fs');
const express = require('express');
const config = require('../config');
const { esc } = require('../documents/print-template');
const { siteBaseUrl } = require('../utils/http');

const router = express.Router();

router.get('/robots.txt', (req, res) => {
  const base = siteBaseUrl(req);
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /$',
    'Disallow: /api/',
    'Disallow: /print/',
    'Disallow: /verify/',
    'Disallow: /uploads/',
    base ? `Sitemap: ${base}/sitemap.xml` : '',
    '',
  ].join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  const base = esc(siteBaseUrl(req));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`);
});

router.get('/llms.txt', (req, res) => {
  res.type('text/plain').send('# Elsewedy Polymers HSE Platform\nWork permits, hazard reporting, training and inspections for the factory HSE team.\n');
});

// index.html is a template: the site URL (canonical / Open Graph tags) and
// the asset versions written by the build are filled in per request.
let indexCache = { key: '', html: '' };

function assetVersions() {
  try {
    return JSON.parse(fs.readFileSync(config.paths.BUILD_INFO, 'utf8'));
  } catch {
    return { js: 'dev', css: 'dev' };
  }
}

function renderIndexHtml(req) {
  const htmlStat = fs.statSync(config.paths.INDEX_HTML);
  let buildMtime = 0;
  try { buildMtime = fs.statSync(config.paths.BUILD_INFO).mtimeMs; } catch { /* not built yet */ }
  const key = `${htmlStat.mtimeMs}:${buildMtime}`;
  if (indexCache.key !== key) {
    const v = assetVersions();
    const html = fs.readFileSync(config.paths.INDEX_HTML, 'utf8')
      .split('__JS_VERSION__').join(encodeURIComponent(v.js || 'dev'))
      .split('__CSS_VERSION__').join(encodeURIComponent(v.css || 'dev'));
    indexCache = { key, html };
  }
  return indexCache.html.split('__SITE_URL__').join(esc(siteBaseUrl(req)));
}

router.get(['/', '/index.html'], (req, res) => {
  res.type('html').send(renderIndexHtml(req));
});

module.exports = { router, renderIndexHtml };
