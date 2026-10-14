'use strict';

// In-memory collections backed by Postgres tables.
//
// The application reads and writes whole collections synchronously (an array
// of records, a map of records, or a single settings value). Each collection
// keeps its rows in memory, diffs every write against what it last saw, and
// hands only the changed rows to the persistence queue.

const POSITION_STEP = 1024;
const BOOT_ID = Date.now().toString(36);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function stringifyItem(value) {
  const s = JSON.stringify(value);
  return s === undefined ? 'null' : s;
}

// Keys for list rows. Records missing their natural key, or repeating one,
// get a deterministic suffix so nothing is ever dropped.
function assignKeys(items, keyOf) {
  const seen = new Map();
  return items.map((item, i) => {
    let base;
    try { base = keyOf(item); } catch { base = undefined; }
    base = base === undefined || base === null || base === '' ? `#${i}` : String(base);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

// Order keys that change as little as possible between writes: rows that keep
// their relative order keep their position, so appending, removing from the
// head, or editing a record only touches the affected rows.
function assignPositions(keys, oldPositions) {
  const n = keys.length;
  const out = new Array(n);
  const kept = new Array(n).fill(false);
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = oldPositions.get(keys[i]);
    if (p !== undefined && p > last) {
      kept[i] = true;
      last = p;
    }
  }
  let i = 0;
  while (i < n) {
    if (kept[i]) {
      out[i] = oldPositions.get(keys[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < n && !kept[j]) j++;
    const count = j - i;
    const lo = i > 0 ? out[i - 1] : null;
    const hi = j < n ? oldPositions.get(keys[j]) : null;
    if (hi === null) {
      const base = lo === null ? 0 : lo;
      for (let k = 0; k < count; k++) out[i + k] = base + POSITION_STEP * (k + 1);
    } else if (lo === null) {
      for (let k = 0; k < count; k++) out[i + k] = hi - POSITION_STEP * (count - k);
    } else if (hi - lo - 1 >= count) {
      const step = Math.floor((hi - lo) / (count + 1));
      for (let k = 0; k < count; k++) out[i + k] = lo + step * (k + 1);
    } else {
      return keys.map((_, k) => POSITION_STEP * (k + 1));
    }
    i = j;
  }
  return out;
}

class RowCollection {
  constructor({ name, table, keyColumn, keyOf, kind, defaultValue, persistence }) {
    this.name = name;
    this.table = table;
    this.keyColumn = keyColumn;
    this.keyOf = keyOf;
    this.kind = kind; // 'list' | 'map'
    this.defaultJson = JSON.stringify(defaultValue === undefined ? (kind === 'map' ? {} : []) : defaultValue);
    this.persistence = persistence;
    this.rows = new Map(); // key -> { json, position }
    this.json = null;
    this.hasData = false;
    this.writes = 0;
  }

  async load(conn) {
    const { rows } = await conn.query(
      `select ${this.keyColumn} as key, position::float8 as position, data
       from hse.${this.table} order by position, ${this.keyColumn}`,
    );
    const parts = [];
    for (const r of rows) {
      const json = stringifyItem(r.data);
      this.rows.set(r.key, { json, position: Number(r.position) });
      parts.push(this.kind === 'map' ? `${JSON.stringify(r.key)}:${json}` : json);
    }
    this.hasData = rows.length > 0;
    this.json = this.kind === 'map' ? `{${parts.join(',')}}` : `[${parts.join(',')}]`;
  }

  read() {
    return JSON.parse(this.hasData ? this.json : this.defaultJson);
  }

  /**
   * Parsed, deep-frozen copy shared by every reader until the next write.
   * For read-only request paths; use read() when the result will be modified.
   */
  snapshot() {
    if (!this.cachedSnapshot || this.cachedSnapshot.writes !== this.writes) {
      this.cachedSnapshot = { writes: this.writes, value: deepFreeze(this.read()) };
    }
    return this.cachedSnapshot.value;
  }

  exists() {
    return this.hasData;
  }

  version() {
    return `${BOOT_ID}.${this.writes}`;
  }

  write(value) {
    let entries;
    let json;
    if (this.kind === 'map') {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      entries = Object.keys(obj)
        .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
        .map((k) => [k, stringifyItem(obj[k])]);
      json = `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`;
    } else {
      const items = Array.isArray(value) ? value : [];
      const keys = assignKeys(items, this.keyOf);
      entries = items.map((item, i) => [keys[i], stringifyItem(item)]);
      json = `[${entries.map((e) => e[1]).join(',')}]`;
    }

    if (this.hasData && json === this.json) return true;

    const oldPositions = new Map();
    for (const [k, r] of this.rows) oldPositions.set(k, r.position);
    const positions = assignPositions(entries.map((e) => e[0]), oldPositions);

    const next = new Map();
    entries.forEach(([key, rowJson], i) => {
      const prev = this.rows.get(key);
      const position = positions[i];
      next.set(key, { json: rowJson, position });
      if (!prev || prev.json !== rowJson || prev.position !== position) {
        this.persistence.upsert(this.table, this.keyColumn, key, rowJson, position);
      }
    });
    for (const key of this.rows.keys()) {
      if (!next.has(key)) this.persistence.remove(this.table, this.keyColumn, key);
    }

    this.rows = next;
    this.json = json;
    this.hasData = true;
    this.writes += 1;
    return true;
  }
}

class SettingValue {
  constructor({ name, defaultValue, persistence, initialJson }) {
    this.name = name;
    this.defaultJson = JSON.stringify(defaultValue === undefined ? {} : defaultValue);
    this.persistence = persistence;
    this.json = initialJson === undefined ? null : initialJson;
    this.writes = 0;
  }

  read() {
    return JSON.parse(this.json === null ? this.defaultJson : this.json);
  }

  exists() {
    return this.json !== null;
  }

  version() {
    return `${BOOT_ID}.${this.writes}`;
  }

  write(value) {
    const json = stringifyItem(value);
    if (json === this.json) return true;
    this.json = json;
    this.writes += 1;
    this.persistence.setSetting(this.name, json);
    return true;
  }

  remove() {
    if (this.json === null) return;
    this.json = null;
    this.writes += 1;
    this.persistence.setSetting(this.name, null);
  }
}

module.exports = { RowCollection, SettingValue, assignKeys, assignPositions, stringifyItem, BOOT_ID };
