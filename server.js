'use strict';

require('dotenv').config();

// Every date the server prints (documents, Excel, "today") uses factory time; storage stays UTC/ISO.
process.env.TZ = process.env.TZ || 'Africa/Cairo';

const db = require('./src/db');

function reportFatal(kind, err) {
  console.error(`[fatal] ${kind}:`, err && err.stack ? err.stack : err);
  try {
    require('./src/services/error-alerts').noteServerError(err instanceof Error ? err : new Error(String(err)), null);
  } catch { /* not initialised yet */ }
}

// One bad request must not take the whole factory offline: log, alert and keep serving.
process.on('unhandledRejection', (err) => reportFatal('unhandledRejection', err));
process.on('uncaughtException', (err) => reportFatal('uncaughtException', err));

async function start() {
  await db.init();

  const config = require('./src/config');
  const { createApp } = require('./src/app');
  const { runStartupTasks } = require('./src/services/bootstrap');
  const { loadSmtpSettings } = require('./src/services/smtp-settings');
  const { importLegacyPhotos } = require('./src/services/hazard-photos');
  const { startBackupSchedules } = require('./src/services/backups');
  const { startHazardEscalation } = require('./src/services/hazard-alert-mailer');
  const { startReminders } = require('./src/services/reminders');
  const { startReportSchedule } = require('./src/services/report-schedule');

  await runStartupTasks();
  loadSmtpSettings();
  await importLegacyPhotos();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`HSE platform listening on http://localhost:${config.port} (${db.status().driver})`);
  });

  startBackupSchedules();
  startHazardEscalation();
  startReminders();
  startReportSchedule();

  if (config.https.enabled) {
    require('./src/https').startHttps(app).catch((err) => console.error('[https] could not start:', err.message));
  }

  // Deploys send SIGTERM: stop accepting requests, then make sure every pending write reached the database.
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, shutting down`);
    server.close();
    const flushed = await db.drain(20000);
    if (!flushed) console.error('[db] some writes could not be flushed before exit');
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  // The test runner (and other process managers) can ask over IPC, which also works on Windows.
  if (process.send) process.on('message', (msg) => msg === 'shutdown' && shutdown('IPC'));
}

start().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
