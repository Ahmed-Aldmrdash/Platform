'use strict';

const express = require('express');
const { bearerToken, verifyToken } = require('./auth');

// WhatsApp webhook signatures are computed over the raw body.
const keepRawBody = (req, res, buf) => {
  if (req.originalUrl && req.originalUrl.startsWith('/api/whatsapp/webhook')) req.rawBody = buf;
};

const jsonSmall = express.json({ limit: '2mb', verify: keepRawBody });
const jsonLarge = express.json({ limit: '50mb', verify: keepRawBody });

// Upload endpoints (Excel, backups, photos) get the large limit, only for a valid admin session.
const LARGE_BODY_ROUTES = [
  /^\/api\/(hazards|permits|trainings|penalties)\/upload-excel$/,
  /^\/api\/employees\/import-excel$/,
  /^\/api\/admin\/backup\/import$/,
  /^\/api\/inspections\/(sections\/[^/]+\/import-legacy-excel|import-legacy-auto)$/,
  /^\/api\/dashboard\/export-(excel-charts|powerbi)$/,
  /^\/api\/hazards\/[^/]+$/,
];
// Workers may only send a photo with a new hazard report.
const WORKER_LARGE_BODY_ROUTE = /^\/api\/hazards$/;

function allowsLargeBody(req) {
  const token = bearerToken(req);
  if (!token) return false;
  let session;
  try {
    session = verifyToken(token);
  } catch {
    return false;
  }
  if (session.purpose === 'link') return false;
  if (req.method === 'POST' && WORKER_LARGE_BODY_ROUTE.test(req.path)) return true;
  if (session.role === 'worker') return false;
  return LARGE_BODY_ROUTES.some((re) => re.test(req.path));
}

function jsonBody(req, res, next) {
  return (allowsLargeBody(req) ? jsonLarge : jsonSmall)(req, res, next);
}

const formBody = express.urlencoded({ extended: true, limit: '1mb' });

module.exports = { jsonBody, formBody };
