#!/usr/bin/env node
'use strict';

// Restores a platform backup (.json or .json.gz, as produced by the daily
// snapshot or the admin "download backup" button) into DATABASE_URL.
//
//   npm run db:restore -- path/to/hse-snapshot.json.gz

require('dotenv').config();
const fs = require('fs');
const zlib = require('zlib');
const db = require('../src/db');

async function restore(file) {
  const raw = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const backup = JSON.parse(text);

  await db.init();
  const result = db.importAll(backup);
  const flushed = await db.drain(10 * 60 * 1000);
  await db.close();
  if (!flushed) throw new Error('timed out while writing to the database');
  return result;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run db:restore -- <backup.json[.gz]>');
    process.exit(1);
  }
  restore(file).then(
    (r) => console.log(`restored ${r.restored} collections; tables: ${r.tables.join(', ') || 'none'}`),
    (err) => {
      console.error('restore failed:', err.message);
      process.exit(1);
    },
  );
}

module.exports = { restore };
