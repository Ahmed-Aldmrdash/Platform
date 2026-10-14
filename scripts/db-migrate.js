#!/usr/bin/env node
'use strict';

// Applies pending SQL files from db/migrations, in order, recording each one
// in hse.schema_migrations. Needs a role that can run DDL, so it reads
// DATABASE_ADMIN_URL first and falls back to DATABASE_URL.
//
//   npm run db:migrate

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connect } = require('../src/db/connection');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function migrate(url, { log = console.log } = {}) {
  const conn = await connect(url, { poolSize: 1 });
  try {
    await conn.query('create schema if not exists hse');
    await conn.query(`create table if not exists hse.schema_migrations (
      version text primary key, applied_at timestamptz not null default now())`);
    const { rows } = await conn.query('select version from hse.schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await conn.transaction(async (tx) => {
        if (tx.exec) await tx.exec(sql);
        else await tx.query(sql);
        await tx.query('insert into hse.schema_migrations (version) values ($1)', [version]);
      });
      log(`applied ${version}`);
    }
  } finally {
    await conn.close();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  migrate(url).then(
    () => console.log('database is up to date'),
    (err) => {
      console.error('migration failed:', err.message);
      process.exit(1);
    },
  );
}

module.exports = { migrate };
