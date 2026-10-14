'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: ${name} is not set — see .env.example`);
    process.exit(1);
  }
  return value;
}

const DATA_DIR = process.env.HSE_DATA_DIR ? path.resolve(process.env.HSE_DATA_DIR) : path.join(ROOT, 'data');
const UPLOADS_DIR = process.env.HSE_UPLOADS_DIR ? path.resolve(process.env.HSE_UPLOADS_DIR) : path.join(PUBLIC_DIR, 'uploads');
const TRAINING_UPLOADS_DIR = path.join(UPLOADS_DIR, 'trainings');

for (const dir of [DATA_DIR, TRAINING_UPLOADS_DIR]) fs.mkdirSync(dir, { recursive: true });

const PRINT_LOGO = path.join(PUBLIC_DIR, 'icons', 'elsewedy-logo-print.png');

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30m',
  workerJwtExpiresIn: process.env.WORKER_JWT_EXPIRES_IN || '30d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,

  https: {
    enabled: String(process.env.ENABLE_HTTPS || '').toLowerCase() === 'true',
    port: Number(process.env.HTTPS_PORT) || 3443,
  },

  paths: {
    ROOT,
    PUBLIC_DIR,
    DATA_DIR,
    UPLOADS_DIR,
    TRAINING_UPLOADS_DIR,
    LEGACY_HAZARD_UPLOADS_DIR: path.join(UPLOADS_DIR, 'hazards'),
    SNAPSHOT_DIR: path.join(DATA_DIR, 'snapshots'),
    CLEAR_BACKUP_DIR: path.join(DATA_DIR, 'clear-backups'),
    SSL_DIR: path.join(DATA_DIR, 'ssl'),
    PERMITS_EXCEL_LOG: path.join(DATA_DIR, 'permits_log.xlsx'),
    HAZARDS_EXCEL_LOG: path.join(DATA_DIR, 'hazards_log.xlsx'),
    EMPLOYEES_XLSX_SEED: path.join(DATA_DIR, 'employees.xlsx'),
    INDEX_HTML: path.join(PUBLIC_DIR, 'index.html'),
    BUILD_INFO: path.join(PUBLIC_DIR, 'build-info.json'),
    REPORT_LOGO: PRINT_LOGO,
    COMPANY_LOGO: fs.existsSync(PRINT_LOGO) ? PRINT_LOGO : path.join(PUBLIC_DIR, 'icons', 'elsewedy-logo.png'),
  },
};
