'use strict';

// Daily gzip snapshots on disk: writing, retention (14 daily + 8 weekly) and restore checks.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_KEEP_DAILY = 14;
const DEFAULT_KEEP_WEEKLY = 8;

function pad(n) { return String(n).padStart(2, '0'); }
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function stamp(d = new Date()) {
  return `${localDateKey(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

const SNAP_RE = /^hse-snapshot-(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})\.json\.gz$/;

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); return true; } catch (e) { return false; }
}

function listSnapshots(dir) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { return []; }
  return files
    .map(name => {
      const m = SNAP_RE.exec(name);
      if (!m) return null;
      let size = 0, mtime = null;
      try { const st = fs.statSync(path.join(dir, name)); size = st.size; mtime = st.mtime.toISOString(); } catch (e) { return null; }
      return { name, date: m[1], size, sizeKB: Math.round(size / 1024), mtime };
    })
    .filter(Boolean)
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

function pruneSnapshots(dir, { keepDaily = DEFAULT_KEEP_DAILY, keepWeekly = DEFAULT_KEEP_WEEKLY, now = new Date() } = {}) {
  const snaps = listSnapshots(dir);
  const keep = new Set();
  const byDate = new Map();
  for (const s of snaps) if (!byDate.has(s.date)) byDate.set(s.date, s);

  const dayMs = 864e5;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const [date, s] of byDate) {
    const t = new Date(date + 'T00:00:00').getTime();
    if (isNaN(t)) continue;
    const ageDays = Math.round((today - t) / dayMs);
    if (ageDays <= keepDaily) { keep.add(s.name); continue; }
    if (new Date(t).getDay() === 0 && ageDays <= keepDaily + keepWeekly * 7) keep.add(s.name);
  }

  const removed = [];
  for (const s of snaps) {
    if (keep.has(s.name)) continue;
    try { fs.unlinkSync(path.join(dir, s.name)); removed.push(s.name); } catch (e) {  }
  }
  return removed;
}

function writeSnapshot(dir, exportAll, { now = new Date(), keepDaily, keepWeekly } = {}) {
  if (!ensureDir(dir)) return { ok: false, error: 'تعذّر إنشاء مجلد النسخ الاحتياطية' };
  try {
    const data = exportAll();
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
    const file = `hse-snapshot-${stamp(now)}.json.gz`;
    const full = path.join(dir, file);
    const tmp = full + '.tmp';
    fs.writeFileSync(tmp, gz);
    fs.renameSync(tmp, full);
    const removed = pruneSnapshots(dir, { keepDaily, keepWeekly, now });
    return { ok: true, file, sizeKB: Math.round(gz.length / 1024), removed, counts: countRecords(data) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function countRecords(backup) {
  const c = (backup && backup.collections) || {};
  const t = (backup && backup.tables) || {};
  const len = v => (Array.isArray(v) ? v.length : 0);
  let permits = len(t.permits);
  if (!permits) {
    try {
      const p = c.storage && c.storage['work-permits'];
      permits = len(typeof p === 'string' ? JSON.parse(p) : p);
    } catch (e) {  }
  }
  return {
    permits,
    hazards: len(c.hazards),
    employees: len(c.employees),
    trainings: len(c.trainings),
    drills: len(c.drills),
    penalties: len(c.penalties),
  };
}

function verifySnapshot(dir, name) {
  const snaps = listSnapshots(dir);
  const target = name ? snaps.find(s => s.name === name) : snaps[0];
  if (!target) return { ok: false, error: 'مفيش نسخ احتياطية محلية لحد دلوقتي' };
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, target.name)));
    const data = JSON.parse(raw.toString('utf8'));
    const counts = countRecords(data);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!data || !data.collections) return { ok: false, file: target.name, error: 'شكل الملف مش صحيح (مفيش collections)' };
    if (total === 0) return { ok: false, file: target.name, counts, error: 'النسخة فاضية — مفيهاش أي سجلات' };
    return { ok: true, file: target.name, sizeKB: target.sizeKB, mtime: target.mtime, counts, total };
  } catch (err) {
    return { ok: false, file: target.name, error: `الملف تالف أو مش مضغوط صح: ${err.message}` };
  }
}

function volumeWarning({ dataDir, env = process.env } = {}) {
  const onRailway = !!(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
  if (!onRailway) return null;
  const mount = String(env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  const resolved = path.resolve(dataDir || '');
  if (mount && resolved.startsWith(path.resolve(mount))) return null;
  return mount
    ? `مجلد البيانات (${resolved}) مش جوه الـ Volume (${mount}) — البيانات هتضيع مع أول نشر جديد.`
    : 'مفيش Volume ثابت على Railway — قاعدة البيانات والنسخ الاحتياطية هتضيع مع أول نشر جديد. اعمل Volume من لوحة Railway واربطه بمجلد data.';
}

module.exports = {
  DEFAULT_KEEP_DAILY,
  DEFAULT_KEEP_WEEKLY,
  localDateKey,
  listSnapshots,
  pruneSnapshots,
  writeSnapshot,
  verifySnapshot,
  countRecords,
  volumeWarning,
};
