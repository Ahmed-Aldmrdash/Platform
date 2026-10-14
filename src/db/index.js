'use strict';

const { connect } = require('./connection');
const { Persistence } = require('./persistence');
const { RowCollection, SettingValue } = require('./collections');
const { createPermitsRepo } = require('./permits-repo');

const REQUIRED_MIGRATION = '0002_access_control';

// Collection name (as used by the application) → table layout.
const TABLES = {
  users: { table: 'users', keyColumn: 'id', keyOf: (u) => u.id },
  hazards: { table: 'hazards', keyColumn: 'id', keyOf: (r) => r.id },
  'audit-log': { table: 'audit_log', keyColumn: 'id', keyOf: (r) => r.id },
  penalties: { table: 'penalties', keyColumn: 'id', keyOf: (r) => r.id },
  employees: { table: 'employees', keyColumn: 'emp_code', keyOf: (r) => r.empCode },
  'training-topics': { table: 'training_topics', keyColumn: 'title', keyOf: (t) => (typeof t === 'string' ? t : t && t.title) },
  trainings: { table: 'trainings', keyColumn: 'id', keyOf: (r) => r.id },
  'training-requests': { table: 'training_requests', keyColumn: 'id', keyOf: (r) => r.id },
  drills: { table: 'drills', keyColumn: 'id', keyOf: (r) => r.id },
  notifications: { table: 'notifications', keyColumn: 'id', keyOf: (r) => r.id },
  subscriptions: { table: 'push_subscriptions', keyColumn: 'endpoint', keyOf: (r) => r.subscription && r.subscription.endpoint },
  'inspection-sections': { table: 'inspection_sections', keyColumn: 'id', keyOf: (r) => r.id },
  'inspection-items': { table: 'inspection_items', keyColumn: 'id', keyOf: (r) => r.id },
  'inspection-records': { table: 'inspection_records', keyColumn: 'id', keyOf: (r) => r.id },
  'worker-credentials': { table: 'worker_credentials', keyColumn: 'emp_code', kind: 'map' },
};

const state = {
  conn: null,
  persistence: null,
  collections: new Map(),
  settings: new Map(),
  settingsJson: new Map(),
  files: new Map(),
  permits: null,
  extraTables: new Map(),
};

async function init(url = process.env.DATABASE_URL) {
  const conn = await connect(url);
  await assertSchema(conn);
  state.conn = conn;
  state.persistence = new Persistence(conn);

  for (const [name, spec] of Object.entries(TABLES)) {
    const col = new RowCollection({ name, kind: spec.kind || 'list', persistence: state.persistence, ...spec });
    await col.load(conn);
    state.collections.set(name, col);
  }

  const { rows } = await conn.query('select key, value from hse.settings');
  for (const r of rows) state.settingsJson.set(r.key, JSON.stringify(r.value));

  state.permits = createPermitsRepo(state.persistence);
  await state.permits.load(conn);
  registerTable('permits', {
    exportRows: () => state.permits.all(),
    importRows: (rows) => state.permits.replaceAll(rows),
    fromLegacy: (backup) => {
      const raw = backup && backup.collections && backup.collections.storage && backup.collections.storage['work-permits'];
      if (raw === undefined || raw === null) return false;
      let list;
      try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return false; }
      if (!Array.isArray(list)) return false;
      state.permits.replaceAll(list.filter((p) => p && p.id));
      return true;
    },
  });
  return conn;
}

async function assertSchema(conn) {
  let applied = [];
  try {
    ({ rows: applied } = await conn.query('select version from hse.schema_migrations'));
  } catch (err) {
    throw new Error(`Database schema is missing (${err.message}). Run "npm run db:migrate" first.`);
  }
  if (!applied.some((r) => r.version === REQUIRED_MIGRATION)) {
    throw new Error(`Database schema is out of date (expected ${REQUIRED_MIGRATION}). Run "npm run db:migrate".`);
  }
}

function setting(name, defaultValue) {
  let s = state.settings.get(name);
  if (!s) {
    s = new SettingValue({
      name,
      defaultValue,
      persistence: state.persistence,
      initialJson: state.settingsJson.get(name),
    });
    state.settings.set(name, s);
  }
  return s;
}

// "storage" is the legacy key/value collection. Its only real content is the
// user list, which now lives in its own table; any other key is kept as a
// setting so the generic /api/storage endpoint keeps working.
function storageStore() {
  const users = state.collections.get('users');
  const extra = setting('storage', {});
  return {
    read() {
      const obj = extra.read();
      if (users.exists()) obj['app-users'] = JSON.stringify(users.read());
      return obj;
    },
    write(value) {
      const obj = { ...(value || {}) };
      if (obj['app-users'] !== undefined) {
        let list = obj['app-users'];
        if (typeof list === 'string') {
          try { list = JSON.parse(list); } catch { list = []; }
        }
        users.write(Array.isArray(list) ? list : []);
        delete obj['app-users'];
      }
      delete obj['work-permits'];
      if (Object.keys(obj).length || extra.exists()) extra.write(obj);
      return true;
    },
    exists() {
      return users.exists() || extra.exists();
    },
    version() {
      return `${users.version()}|${extra.version()}`;
    },
  };
}

function makeStore(name, defaultValue) {
  if (!state.persistence) throw new Error('Database not initialised — call db.init() first');
  if (name === 'storage') return storageStore();
  const col = state.collections.get(name);
  if (col) return col;
  return setting(name, defaultValue);
}

function registerTable(name, handlers) {
  state.extraTables.set(name, handlers);
}

/** Full backup: every collection and table as one JSON document. */
function exportAll() {
  const collections = {};
  for (const name of state.collections.keys()) {
    if (name === 'users') continue;
    collections[name] = state.collections.get(name).read();
  }
  collections.storage = storageStore().read();
  for (const key of new Set([...state.settingsJson.keys(), ...state.settings.keys()])) {
    if (key === 'storage') continue;
    const s = setting(key);
    if (s.exists()) collections[key] = s.read();
  }
  const tables = {};
  for (const [name, h] of state.extraTables) {
    try { tables[name] = h.exportRows(); } catch (e) { console.error(`[db] export ${name} failed:`, e.message); }
  }
  return { exportedAt: new Date().toISOString(), collections, tables };
}

/** Restores a backup produced by exportAll (or the older SQLite-era format). */
function importAll(backup) {
  if (!backup || typeof backup !== 'object' || !backup.collections || typeof backup.collections !== 'object') {
    throw new Error('صيغة ملف النسخة الاحتياطية غير صالحة');
  }
  const names = Object.keys(backup.collections);
  for (const name of names) makeStore(name).write(backup.collections[name]);

  const tables = backup.tables && typeof backup.tables === 'object' ? backup.tables : {};
  const restoredTables = [];
  for (const [name, h] of state.extraTables) {
    try {
      if (Array.isArray(tables[name])) {
        h.importRows(tables[name]);
        restoredTables.push(name);
      } else if (typeof h.fromLegacy === 'function' && h.fromLegacy(backup)) {
        restoredTables.push(`${name} (نسخة قديمة)`);
      }
    } catch (e) {
      console.error(`[db] import ${name} failed:`, e.message);
    }
  }
  return { restored: names.length, names, tables: restoredTables };
}

// Uploaded files (hazard photos). Small binary blobs kept in hse.files with a
// bounded in-memory cache for serving.
const FILE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
let fileCacheBytes = 0;

function cacheFile(filePath, file) {
  if (state.files.has(filePath)) fileCacheBytes -= state.files.get(filePath).buffer.length;
  state.files.delete(filePath);
  state.files.set(filePath, file);
  fileCacheBytes += file.buffer.length;
  while (fileCacheBytes > FILE_CACHE_MAX_BYTES && state.files.size > 1) {
    const [oldest, f] = state.files.entries().next().value;
    state.files.delete(oldest);
    fileCacheBytes -= f.buffer.length;
  }
}

const files = {
  put(filePath, contentType, buffer) {
    cacheFile(filePath, { contentType, buffer });
    state.persistence.putFile(filePath, contentType, buffer);
  },
  async get(filePath) {
    const hit = state.files.get(filePath);
    if (hit) return hit;
    const { rows } = await state.conn.query('select content_type, content from hse.files where path = $1', [filePath]);
    if (!rows.length) return null;
    const file = { contentType: rows[0].content_type, buffer: Buffer.from(rows[0].content) };
    cacheFile(filePath, file);
    return file;
  },
  remove(filePath) {
    if (state.files.has(filePath)) {
      fileCacheBytes -= state.files.get(filePath).buffer.length;
      state.files.delete(filePath);
    }
    state.persistence.deleteFile(filePath);
  },
};

async function ping() {
  const t0 = Date.now();
  await state.conn.query('select 1');
  return Date.now() - t0;
}

function status() {
  return { driver: state.conn ? state.conn.kind : null, ...(state.persistence ? state.persistence.status() : {}) };
}

function drain(timeoutMs) {
  return state.persistence ? state.persistence.drain(timeoutMs) : Promise.resolve(true);
}

async function close() {
  if (!state.conn) return;
  await drain();
  await state.conn.close();
  state.conn = null;
}

module.exports = {
  init,
  makeStore,
  registerTable,
  exportAll,
  importAll,
  files,
  ping,
  status,
  drain,
  close,
  get permits() { return state.permits; },
};
