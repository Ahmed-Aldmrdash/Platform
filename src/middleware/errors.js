'use strict';

const { renderIndexHtml } = require('../routes/site');
const { noteServerError } = require('../services/error-alerts');

function notFound(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
  // Unknown page URLs still show the app, but with a 404 status so they never get indexed.
  if (req.method === 'GET' && req.accepts('html') && !/\.[a-z0-9]{2,5}$/i.test(req.path)) {
    return res.status(404).type('html').send(renderIndexHtml(req));
  }
  res.status(404).type('text/plain; charset=utf-8').send('غير موجود');
}

/** Never leaks stack traces or internal paths; 5xx errors are logged and reported by email. */
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  let message = 'حصل خطأ غير متوقع في السيرفر — حاول تاني';
  if (err.type === 'entity.too.large' || status === 413) message = 'حجم البيانات أكبر من المسموح';
  else if (err.type === 'entity.parse.failed') message = 'البيانات المبعوتة مش بصيغة صحيحة';
  else if (status < 500 && err.expose && err.message) message = err.message;
  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl.split('?')[0], err && err.stack ? err.stack : err);
    noteServerError(err, req);
  }
  if (res.headersSent) return next(err);
  res.status(status >= 400 && status < 600 ? status : 500);
  if (req.path.startsWith('/api/')) return res.json({ error: message });
  res.type('text/plain; charset=utf-8').send(message);
}

module.exports = { notFound, errorHandler };
