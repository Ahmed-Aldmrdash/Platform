'use strict';

const express = require('express');
const compression = require('compression');
const config = require('./config');
const { securityHeaders, viewerReadOnlyGuard } = require('./middleware/security');
const { cacheControlHeaders } = require('./middleware/http-cache');
const { jsonBody, formBody } = require('./middleware/body-parsers');
const { notFound, errorHandler } = require('./middleware/errors');
const { serveHazardPhoto } = require('./services/hazard-photos');
const site = require('./routes/site');

const API_ROUTERS = [
  'storage',
  'auth',
  'worker-auth',
  'users',
  'employees',
  'permits',
  'hazards',
  'trainings',
  'drills',
  'inspections',
  'penalties',
  'notifications',
  'analytics',
  'executive',
  'dashboard-export',
  'reports',
  'print',
  'admin',
  'chatbot',
  'whatsapp',
];

// Hashed asset URLs (?v=<content hash>) never change, so they can be cached for good.
function staticHeaders(res, filePath) {
  if (/\.(?:js|css)$/i.test(filePath)) {
    res.set('Cache-Control', res.req && res.req.query && res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  } else if (/\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(filePath)) {
    res.set('Cache-Control', 'public, max-age=604800');
  } else {
    res.set('Cache-Control', 'no-cache');
  }
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // One proxy hop (Railway): req.ip is the real client, but X-Forwarded-For can't be spoofed further back.
  app.set('trust proxy', 1);

  app.use(compression());
  app.use(securityHeaders);
  app.use(cacheControlHeaders);
  app.use(jsonBody);
  app.use(formBody);
  app.use(viewerReadOnlyGuard);

  app.use(site.router);
  app.get('/uploads/hazards/:name', serveHazardPhoto);
  app.use('/uploads/trainings', express.static(config.paths.TRAINING_UPLOADS_DIR, {
    index: false,
    setHeaders: (res) => res.set('Cache-Control', 'private, max-age=86400'),
  }));
  app.use(express.static(config.paths.PUBLIC_DIR, { index: false, setHeaders: staticHeaders }));

  for (const name of API_ROUTERS) app.use(require(`./routes/${name}`));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
