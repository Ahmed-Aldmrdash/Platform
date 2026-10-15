'use strict';

const { BOOT_ID, stringifyItem } = require('./collections');
const { approvalRank, permitRiskLevel, RISK_RANK } = require('../utils/permit-order');

// Work permits are the largest dataset (thousands of rows), so they get a
// repository with row-level operations and an in-memory index for the list
// screen's filters, instead of whole-collection reads and writes.

const TABLE = 'permits';
const KEY_COLUMN = 'id';
const ROLE_BITS = { areaAdmin: 1, safetyAdmin: 2, superAdmin: 4, worker: 8 };

function maskOf(obj) {
  let m = 0;
  if (obj && typeof obj === 'object') {
    for (const [role, bit] of Object.entries(ROLE_BITS)) if (obj[role] === true) m |= bit;
  }
  return m;
}

function normCode(v) {
  return String(v == null ? '' : v).trim().replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
}

function searchText(p) {
  return [
    p.id, p.workerName, p.employeeId, p.department, p.location, p.equipment,
    p.description, p.typeLabel, p.typeFullLabel, p.safetyOfficerName,
    p.areaManagerName, p.reviewedBy, p.areaHeadReviewedBy, p.workersNames,
  ].map((x) => (Array.isArray(x) ? x.join(' ') : String(x == null ? '' : x)))
    .join(' ').toLowerCase().slice(0, 2000);
}

function idNumberOf(id) {
  const n = parseInt(String(id || '').split('-').pop(), 10);
  return Number.isFinite(n) ? n : 0;
}

function indexEntry(permit, json, seq) {
  const date = String(permit.date || '').slice(0, 10);
  return {
    id: String(permit.id),
    json,
    seq,
    idNum: idNumberOf(permit.id),
    rank: approvalRank(permit.status),
    risk: RISK_RANK[permitRiskLevel(permit)],
    date,
    submitted: String(permit.submittedAt || permit.date || ''),
    year: date.slice(0, 4),
    department: String(permit.department || ''),
    status: String(permit.status || 'pending'),
    typeKey: String(permit.typeKey || ''),
    typeLabel: String(permit.typeLabel || ''),
    workerName: String(permit.workerName || '').toLowerCase(),
    employeeId: normCode(permit.employeeId),
    rejectedBy: String(permit.rejectedByRole || ''),
    supNames: [permit.safetyOfficerName, permit.areaManagerName, permit.areaHeadReviewedBy, permit.reviewedBy]
      .filter(Boolean).join(' ').toLowerCase().slice(0, 400),
    delMask: maskOf(permit.deletedBy),
    pdelMask: maskOf(permit.permanentlyDeletedBy),
    search: searchText(permit),
  };
}

function statusMatcher(status) {
  if (!status) return null;
  if (status === 'rejected') return (s) => s.startsWith('rejected');
  if (status === 'closed') return (s) => s.startsWith('closed') || s === 'completed';
  const keys = (Array.isArray(status) ? status : String(status).split(','))
    .map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
  if (!keys.length) return null;
  const set = new Set(keys);
  return (s) => set.has(s);
}

function isHseVisible(e) {
  const s = e.status;
  if (s === 'rejected_area') return false;
  if (s === 'rejected' && (e.rejectedBy === 'dept_admin' || e.rejectedBy === 'maint_admin')) return false;
  return s === 'pending_hse' || s === 'approved' || s.startsWith('rejected') || s.startsWith('closed') || s === 'completed';
}

function createPermitsRepo(persistence) {
  const byId = new Map();
  let maxSeq = 0;
  let writes = 0;
  let ordered = null; // entries sorted by seq, rebuilt lazily
  let allCache = null;

  function changed() {
    writes += 1;
    ordered = null;
    allCache = null;
  }

  function sortedEntries() {
    if (!ordered) ordered = [...byId.values()].sort((a, b) => a.seq - b.seq);
    return ordered;
  }

  function store(permit, seq) {
    const json = stringifyItem(permit);
    const prev = byId.get(String(permit.id));
    const entry = indexEntry(permit, json, seq);
    byId.set(entry.id, entry);
    if (seq > maxSeq) maxSeq = seq;
    if (!prev || prev.json !== json || prev.seq !== seq) {
      persistence.upsert(TABLE, KEY_COLUMN, entry.id, json, seq);
    }
  }

  const repo = {
    async load(conn) {
      const { rows } = await conn.query(
        `select id, position::float8 as position, data from hse.${TABLE} order by position, id`,
      );
      for (const r of rows) {
        const seq = Number(r.position);
        const entry = indexEntry(r.data, stringifyItem(r.data), seq);
        byId.set(entry.id, entry);
        if (seq > maxSeq) maxSeq = seq;
      }
    },

    count() { return byId.size; },

    isEmpty() { return byId.size === 0; },

    version() { return `${BOOT_ID}.${writes}`; },

    get(id) {
      const e = byId.get(String(id));
      return e ? JSON.parse(e.json) : null;
    },

    /** Every permit in insertion order. The objects are shared: treat them as read-only. */
    all() {
      if (!allCache) allCache = sortedEntries().map((e) => JSON.parse(e.json));
      return allCache.slice();
    },

    /**
     * Filtered, paginated list.
     * opts: { q, worker, supervisor, department, status, typeKey, year, from, to,
     *         employeeId, roleKey, trash, visibility, pendingBefore, limit, offset, order }
     * pendingBefore (ISO time): only permits still awaiting approval that were submitted before it.
     */
    list(opts = {}) {
      const bit = ROLE_BITS[opts.roleKey] || 0;
      const matchStatus = statusMatcher(opts.status);
      const q = opts.q ? String(opts.q).toLowerCase().trim().slice(0, 100) : '';
      const worker = opts.worker ? String(opts.worker).toLowerCase().trim().slice(0, 100) : '';
      const supervisor = opts.supervisor ? String(opts.supervisor).toLowerCase().trim().slice(0, 100) : '';
      const employeeId = opts.employeeId ? normCode(opts.employeeId) : '';
      const department = opts.department ? String(opts.department) : '';

      const matches = [];
      for (const e of byId.values()) {
        if (bit) {
          if (e.pdelMask & bit) continue;
          const deleted = (e.delMask & bit) !== 0;
          if (opts.trash ? !deleted : deleted) continue;
        }
        if (opts.visibility === 'hse' && !isHseVisible(e)) continue;
        if (department && e.department !== department) continue;
        if (matchStatus && !matchStatus(e.status)) continue;
        if (opts.typeKey && e.typeKey !== String(opts.typeKey)) continue;
        if (opts.year && e.year !== String(opts.year)) continue;
        if (opts.from || opts.to) {
          if (!e.date) continue;
          if (opts.from && e.date < String(opts.from)) continue;
          if (opts.to && e.date > String(opts.to)) continue;
        }
        if (opts.pendingBefore && (e.rank !== 0 || !e.submitted || e.submitted >= opts.pendingBefore)) continue;
        if (employeeId && e.employeeId !== employeeId) continue;
        if (q && !e.search.includes(q)) continue;
        if (worker && !e.workerName.includes(worker)) continue;
        if (supervisor && !e.supNames.includes(supervisor)) continue;
        matches.push(e);
      }

      if (opts.order === 'seq') matches.sort((a, b) => b.seq - a.seq);
      else if (opts.order === 'overdue') matches.sort((a, b) => a.risk - b.risk || (a.submitted < b.submitted ? -1 : a.submitted > b.submitted ? 1 : 0));
      else matches.sort((a, b) => a.rank - b.rank || a.risk - b.risk || b.seq - a.seq);

      const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
      const offset = Math.max(0, Number(opts.offset) || 0);
      const rows = matches.slice(offset, offset + limit).map((e) => JSON.parse(e.json));
      return { rows, total: matches.length, limit, offset };
    },

    /** Departments, years, types and statuses present — for the filter dropdowns. */
    facets() {
      const depts = new Map();
      const years = new Set();
      const types = new Map();
      const statuses = new Map();
      for (const e of byId.values()) {
        if (e.department) depts.set(e.department, (depts.get(e.department) || 0) + 1);
        if (e.year) years.add(e.year);
        if (e.typeLabel) types.set(e.typeLabel, (types.get(e.typeLabel) || 0) + 1);
        statuses.set(e.status, (statuses.get(e.status) || 0) + 1);
      }
      const byCount = (m) => [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
      return {
        departments: byCount(depts),
        years: [...years].sort().reverse(),
        types: byCount(types),
        statuses: [...statuses].map(([status, n]) => ({ status, n })),
      };
    },

    put(permit) {
      const id = String((permit && permit.id) || '');
      if (!id) throw new Error('التصريح لازم يكون له معرّف');
      const existing = byId.get(id);
      store(permit, existing ? existing.seq : maxSeq + 1);
      changed();
      return true;
    },

    putMany(list) {
      const arr = Array.isArray(list) ? list : [];
      if (!arr.length) return 0;
      for (const p of arr) {
        if (!p || !p.id) continue;
        const existing = byId.get(String(p.id));
        store(p, existing ? existing.seq : maxSeq + 1);
      }
      changed();
      return arr.length;
    },

    /** Replaces every permit (backup restore and bulk import only). */
    replaceAll(list) {
      const arr = (Array.isArray(list) ? list : []).filter((p) => p && p.id);
      const keep = new Set(arr.map((p) => String(p.id)));
      for (const id of byId.keys()) {
        if (!keep.has(id)) persistence.remove(TABLE, KEY_COLUMN, id);
      }
      byId.clear();
      maxSeq = 0;
      arr.forEach((p, i) => store(p, i + 1));
      changed();
      return arr.length;
    },

    remove(id) {
      const key = String(id);
      if (!byId.delete(key)) return false;
      persistence.remove(TABLE, KEY_COLUMN, key);
      changed();
      return true;
    },

    forEmployee(empCode) {
      const code = normCode(empCode);
      if (!code) return [];
      return sortedEntries()
        .filter((e) => e.employeeId === code)
        .reverse()
        .map((e) => JSON.parse(e.json));
    },

    nextIdNumber() {
      let max = 0;
      for (const e of byId.values()) if (e.idNum > max) max = e.idNum;
      return max + 1;
    },
  };

  return repo;
}

module.exports = { createPermitsRepo, ROLE_BITS, searchText, normCode };
