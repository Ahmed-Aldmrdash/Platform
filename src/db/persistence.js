'use strict';

// Write-behind queue between the in-memory collections and Postgres.
//
// Collections record row-level changes here and return immediately; the queue
// flushes them in a single transaction, coalescing repeated changes to the same
// row. Connection failures are retried with backoff without losing changes.
// Rows the database rejects as invalid are logged and skipped so one bad
// record can never block every other write.

const CHUNK_SIZE = 500;
const RETRY_DELAYS_MS = [500, 1000, 2000, 5000, 10000, 30000];

// jsonb rejects NUL characters and unpaired surrogates, both of which
// JSON.stringify can emit for arbitrary user input.
const NUL_ESCAPE = /\\u0000/g;
const LONE_SURROGATE = /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/gi;

function toJsonbText(json) {
  if (json.indexOf('\\u') === -1) return json;
  return json.replace(NUL_ESCAPE, '').replace(LONE_SURROGATE, '\\ufffd');
}

function isDataError(err) {
  const code = err && err.code ? String(err.code) : '';
  return code.startsWith('22') || code.startsWith('23');
}

class Persistence {
  constructor(conn) {
    this.conn = conn;
    this.pending = new Map(); // table -> { keyColumn, upserts: Map<key, {json, position}>, deletes: Set<key> }
    this.settingsPending = new Map(); // key -> json | null (null = delete)
    this.filesPending = new Map(); // path -> {contentType, buffer} | null
    this.flushing = null;
    this.timer = null;
    this.attempt = 0;
    this.lastError = null;
    this.lastFlushAt = null;
    this.idleWaiters = [];
  }

  tableState(table, keyColumn) {
    let state = this.pending.get(table);
    if (!state) {
      state = { keyColumn, upserts: new Map(), deletes: new Set() };
      this.pending.set(table, state);
    }
    return state;
  }

  upsert(table, keyColumn, key, json, position) {
    const state = this.tableState(table, keyColumn);
    state.deletes.delete(key);
    state.upserts.set(key, { json, position });
    this.schedule();
  }

  remove(table, keyColumn, key) {
    const state = this.tableState(table, keyColumn);
    state.upserts.delete(key);
    state.deletes.add(key);
    this.schedule();
  }

  setSetting(key, json) {
    this.settingsPending.set(key, json);
    this.schedule();
  }

  putFile(filePath, contentType, buffer) {
    this.filesPending.set(filePath, { contentType, buffer });
    this.schedule();
  }

  deleteFile(filePath) {
    this.filesPending.set(filePath, null);
    this.schedule();
  }

  pendingCount() {
    let n = this.settingsPending.size + this.filesPending.size;
    for (const s of this.pending.values()) n += s.upserts.size + s.deletes.size;
    return n;
  }

  schedule(delayMs = 0) {
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delayMs);
  }

  takeBatch() {
    const tables = [];
    for (const [table, state] of this.pending) {
      if (!state.upserts.size && !state.deletes.size) continue;
      tables.push({ table, keyColumn: state.keyColumn, upserts: state.upserts, deletes: state.deletes });
    }
    const batch = { tables, settings: this.settingsPending, files: this.filesPending };
    this.pending = new Map();
    this.settingsPending = new Map();
    this.filesPending = new Map();
    return batch;
  }

  // Puts a failed batch back, unless a newer change for the same row arrived meanwhile.
  restoreBatch(batch) {
    for (const t of batch.tables) {
      const state = this.tableState(t.table, t.keyColumn);
      for (const [key, row] of t.upserts) {
        if (!state.upserts.has(key) && !state.deletes.has(key)) state.upserts.set(key, row);
      }
      for (const key of t.deletes) {
        if (!state.upserts.has(key) && !state.deletes.has(key)) state.deletes.add(key);
      }
    }
    for (const [key, json] of batch.settings) {
      if (!this.settingsPending.has(key)) this.settingsPending.set(key, json);
    }
    for (const [p, file] of batch.files) {
      if (!this.filesPending.has(p)) this.filesPending.set(p, file);
    }
  }

  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.pendingCount()) {
      this.notifyIdle();
      return undefined;
    }
    const batch = this.takeBatch();
    this.flushing = (async () => {
      try {
        await this.conn.transaction((tx) => this.writeBatch(tx, batch));
        this.onSuccess();
      } catch (err) {
        if (isDataError(err)) {
          await this.writeRowByRow(batch);
          this.onSuccess();
        } else {
          this.onFailure(err, batch);
        }
      } finally {
        this.flushing = null;
      }
      if (this.pendingCount() && !this.timer) this.schedule(this.attempt ? this.retryDelay() : 0);
      else if (!this.pendingCount()) this.notifyIdle();
    })();
    return this.flushing;
  }

  onSuccess() {
    this.attempt = 0;
    this.lastError = null;
    this.lastFlushAt = new Date().toISOString();
  }

  onFailure(err, batch) {
    this.restoreBatch(batch);
    this.attempt += 1;
    this.lastError = { message: err.message, code: err.code || null, at: new Date().toISOString() };
    console.error(`[db] write failed (attempt ${this.attempt}), will retry:`, err.message);
  }

  retryDelay() {
    return RETRY_DELAYS_MS[Math.min(this.attempt - 1, RETRY_DELAYS_MS.length - 1)];
  }

  async writeBatch(tx, batch) {
    for (const t of batch.tables) {
      const deletes = [...t.deletes];
      for (let i = 0; i < deletes.length; i += CHUNK_SIZE) {
        await tx.query(
          `delete from hse.${t.table} where ${t.keyColumn} = any($1::text[])`,
          [deletes.slice(i, i + CHUNK_SIZE)],
        );
      }
      const rows = [...t.upserts];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        await this.upsertRows(tx, t.table, t.keyColumn, rows.slice(i, i + CHUNK_SIZE));
      }
    }
    for (const [key, json] of batch.settings) {
      if (json === null) {
        await tx.query('delete from hse.settings where key = $1', [key]);
      } else {
        await tx.query(
          `insert into hse.settings (key, value) values ($1, $2::jsonb)
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [key, toJsonbText(json)],
        );
      }
    }
    for (const [filePath, file] of batch.files) {
      if (file === null) {
        await tx.query('delete from hse.files where path = $1', [filePath]);
      } else {
        await tx.query(
          `insert into hse.files (path, content_type, size_bytes, content) values ($1, $2, $3, $4)
           on conflict (path) do update set content_type = excluded.content_type,
             size_bytes = excluded.size_bytes, content = excluded.content, created_at = now()`,
          [filePath, file.contentType, file.buffer.length, file.buffer],
        );
      }
    }
  }

  upsertRows(tx, table, keyColumn, rows) {
    const keys = [];
    const positions = [];
    const datas = [];
    for (const [key, row] of rows) {
      keys.push(key);
      positions.push(row.position);
      datas.push(toJsonbText(row.json));
    }
    return tx.query(
      `insert into hse.${table} as t (${keyColumn}, position, data)
       select k, p, d::jsonb from unnest($1::text[], $2::bigint[], $3::text[]) as u(k, p, d)
       on conflict (${keyColumn}) do update
         set position = excluded.position, data = excluded.data, updated_at = now()
         where t.position is distinct from excluded.position or t.data is distinct from excluded.data`,
      [keys, positions, datas],
    );
  }

  // Fallback after a data error: write each change on its own so the valid
  // ones go through and the invalid ones are reported individually.
  async writeRowByRow(batch) {
    const run = async (label, fn) => {
      try {
        await this.conn.transaction(fn);
      } catch (err) {
        if (isDataError(err)) {
          console.error(`[db] rejected ${label}: ${err.message}`);
          return;
        }
        throw err;
      }
    };
    try {
      for (const t of batch.tables) {
        for (const key of t.deletes) {
          await run(`delete ${t.table}/${key}`, (tx) =>
            tx.query(`delete from hse.${t.table} where ${t.keyColumn} = $1`, [key]));
        }
        for (const entry of t.upserts) {
          await run(`${t.table}/${entry[0]}`, (tx) => this.upsertRows(tx, t.table, t.keyColumn, [entry]));
        }
      }
      for (const entry of batch.settings) {
        await run(`settings/${entry[0]}`, (tx) => this.writeBatch(tx, { tables: [], settings: new Map([entry]), files: new Map() }));
      }
      for (const entry of batch.files) {
        await run(`files/${entry[0]}`, (tx) => this.writeBatch(tx, { tables: [], settings: new Map(), files: new Map([entry]) }));
      }
    } catch (err) {
      this.onFailure(err, batch);
    }
  }

  notifyIdle() {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve(true));
  }

  /** Resolves once everything queued so far is in the database (or the timeout passes). */
  drain(timeoutMs = 20000) {
    if (!this.pendingCount() && !this.flushing) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.idleWaiters = this.idleWaiters.filter((w) => w !== done);
        resolve(false);
      }, timeoutMs);
      const done = (ok) => {
        clearTimeout(timer);
        resolve(ok);
      };
      this.idleWaiters.push(done);
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (!this.flushing) this.flush();
    });
  }

  status() {
    return {
      pendingWrites: this.pendingCount(),
      lastFlushAt: this.lastFlushAt,
      lastError: this.lastError,
      retrying: this.attempt > 0,
    };
  }
}

module.exports = { Persistence, toJsonbText };
