'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Opens a database connection from a URL and returns a small adapter with
 * the same surface for both drivers:
 *   postgres://…           → node-postgres pool (Supabase / any Postgres)
 *   pglite://memory        → in-process Postgres (tests)
 *   pglite:///abs/dir      → in-process Postgres persisted to a directory
 */
async function connect(url, { poolSize = 5 } = {}) {
  if (!url) throw new Error('DATABASE_URL is not set');
  if (url.startsWith('pglite:')) return connectPglite(url);
  return connectPostgres(url, poolSize);
}

function sslOptions(url) {
  if (/sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false;
  const caFile = process.env.DATABASE_SSL_CA;
  if (caFile) return { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

async function connectPostgres(url, poolSize) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url.replace(/[?&]sslmode=[^&]*/, ''),
    ssl: sslOptions(url),
    max: poolSize,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
    application_name: 'hse-platform',
  });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  await pool.query('select 1');

  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('commit');
        return result;
      } catch (err) {
        try { await client.query('rollback'); } catch { /* connection already broken */ }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function connectPglite(url) {
  const { PGlite } = require('@electric-sql/pglite');
  const target = url.replace(/^pglite:\/\//, '');
  const dataDir = target === 'memory' || target === '' ? undefined : path.resolve(target.replace(/^\/([A-Za-z]:)/, '$1'));
  const db = dataDir ? await PGlite.create({ dataDir }) : await PGlite.create();

  return {
    kind: 'pglite',
    query: (text, params) => db.query(text, params),
    transaction: (fn) => db.transaction((tx) => fn({
      query: (text, params) => tx.query(text, params),
      exec: (sql) => tx.exec(sql),
    })),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}

module.exports = { connect };
