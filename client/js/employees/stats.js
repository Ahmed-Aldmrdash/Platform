// Employee directory data and per-employee training/hazard statistics against the annual targets.

let _allEmployees   = [];

function findListedEmployee(code) {
  const target = String(code || '').trim().replace(/^0+/, '');
  return (window._masterEmployeesList || []).find(e => String(e.empCode || e.code || '').trim().replace(/^0+/, '') === target) || null;
}
let _empEditCode    = null;
let _allHazardsCache = [];

// Annual targets per employee; they are not scaled by the selected period.
const EMP_TARGET_TRAIN_HOURS = 8;
const EMP_TARGET_HAZARDS     = 2;

const EMP_NEAR_TRAIN_HOURS   = 6;

const QUARTER_MONTHLY_TRAIN_TARGET_HOURS = 2;

const EMP_ROLE_LABELS = {
  worker:     'عامل / فني',
  supervisor: 'مشرف',
  area_head:  'رئيس قسم',
  contractor: 'مقاول / خارجي'
};

function empRoleLabel(r){ return T(EMP_ROLE_LABELS[r] || r || T('عامل')); }

function toArray(val) {
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') {
    if (Array.isArray(val.trainings)) return val.trainings;
    if (Array.isArray(val.data)) return val.data;
    if (Array.isArray(val.hazards)) return val.hazards;
    if (Array.isArray(val.employees)) return val.employees;
    if (Array.isArray(val.penalties)) return val.penalties;
  }
  return [];
}

async function renderEmployeesPanel() {
  const tableWrap = document.getElementById('empTableWrap');
  if (tableWrap) tableWrap.style.display = 'block';

  const listEl = document.getElementById('empDirList');
  const prev = window._empPanelRendered;
  if (listEl && !prev) listEl.innerHTML = T('<div class="loading">جارِ تحميل الموظفين…</div>');

  const emArea = document.getElementById('emUserProfileChip');
  const supChip = document.getElementById('supUserProfileChip');
  if (emArea && supChip) emArea.innerHTML = supChip.innerHTML;

  try {
    const [empRes, hazRes, trainRes, penRes] = await Promise.allSettled([
      fetchJsonIfChanged('/api/employees'),
      fetchJsonIfChanged('/api/hazards'),
      fetchJsonIfChanged('/api/trainings'),
      fetchJsonIfChanged('/api/penalties')
    ]);
    const loaded = r => r.status === 'fulfilled' && r.value.ok;

    if (!loaded(empRes)) throw new Error('Failed to load employees from API');
    const empData = empRes.value.data;
    window._allHazardsCache = loaded(hazRes) ? toArray(hazRes.value.data) : NO_RECORDS;
    window._trainingsCache  = loaded(trainRes) ? toArray(trainRes.value.data) : NO_RECORDS;
    window._penaltiesCache  = loaded(penRes) ? toArray(penRes.value.data) : NO_RECORDS;

    // Unchanged responses (304) come back as the same objects, so the panel on screen is still current.
    const viewKey = [currentUserRole, currentUserDept, window._currentLang].join('|');
    if (prev && prev.emp === empData && prev.hz === window._allHazardsCache && prev.tr === window._trainingsCache &&
        prev.pen === window._penaltiesCache && prev.key === viewKey && document.getElementById('empTableBody')) return;

    if (!prev || prev.emp !== empData || !window._masterEmployeesList) {
      window._masterEmployeesList = Object.freeze([...toArray(empData)]);
    }

    renderEmployeesPanelUI();
    renderEmployeesTable(window._masterEmployeesList);
    renderModelEmployeeSection();
    window._empPanelRendered = { emp: empData, hz: window._allHazardsCache, tr: window._trainingsCache, pen: window._penaltiesCache, key: viewKey };
  } catch (err) {
    console.error('Error in renderEmployeesPanel:', err);
    window._empPanelRendered = null;
    if (listEl) listEl.innerHTML = `<p style="color:var(--danger-text); text-align:center; padding:2rem;">${T("فشل تحميل الموظفين:")} ${escapeHtml(err.message)}</p>`;
  }
}

function normalizeCode(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/^0+/, '') || '0';
}

function normalizeName(val) {
  if (!val) return '';
  return String(val).trim().toLowerCase().replace(/\s+/g, ' ');
}

function isEmployeeInAttendees(emp, attendees) {
  const empCodeNorm = normalizeCode(emp.code || emp.empCode || emp.id);
  const empNameNorm = normalizeName(emp.name);

  return toArray(attendees).some(att => {
    if (!att) return false;
    if (typeof att === 'string' || typeof att === 'number') {
      const attStr = normalizeCode(att);
      return (attStr && empCodeNorm && attStr === empCodeNorm) || normalizeName(att) === empNameNorm;
    }
    const attCode = normalizeCode(att.code || att.empCode || att.id || att.employeeId);
    const attName = normalizeName(att.name || att.empName || att.employeeName);
    return (attCode && empCodeNorm && attCode === empCodeNorm) || (attName && empNameNorm && attName === empNameNorm);
  });
}

function getTrainingDuration(t) {
  if (t && (t.durationHours !== undefined && t.durationHours !== null && t.durationHours !== '')) {
    return Number(t.durationHours);
  }
  if (t && (t.hours !== undefined && t.hours !== null && t.hours !== '')) {
    return Number(t.hours);
  }
  if (t && t.duration !== undefined && t.duration !== null && t.duration !== '' && !isNaN(Number(t.duration))) {
    return Number(t.duration);
  }
  if (t && t.durationMinutes) {
    return Number(t.durationMinutes) / 60;
  }
  return 0.5;
}

// Match by employee code when the record has one, otherwise by exact full name. normalizeCode('') returns '0', so '0' means no code.
function _statsRecordMatches(recCode, recName, empCode, empName) {
  const rc = recCode && recCode !== '0' ? recCode : '';
  if (rc) return !!empCode && rc === empCode;
  return !!recName && !!empName && recName === empName;
}

function _statsHazardCounts(h) {
  if (!h || h.deleted || h.deletedAt || h.isDeleted) return false;
  return h.status !== 'rejected' && h.status !== 'rejected_by_maintenance';
}

function computeEmployeeLiveStats(emp, cutoffDate = null, targetMonths = 1) {
  const empCodeNorm = normalizeCode(emp.code || emp.empCode || emp.id);
  const empNameNorm = normalizeName(emp.name);

  const hazardsList = toArray(window._allHazardsCache);
  const trainingsList = toArray(window._trainingsCache);

  const matchedHazards = hazardsList.filter(h => {
    if (cutoffDate) {
      const hDate = new Date(h.createdAt || h.date);
      if (hDate < cutoffDate) return false;
    }
    const hCode = normalizeCode(h.reporterCode || h.empCode || h.employeeCode || h.userId || '');
    const hName = normalizeName(h.reporterName || h.reportedBy || h.userName || '');
    const codeMatch = hCode && empCodeNorm && hCode === empCodeNorm;
    const nameMatch = hName && empNameNorm && (hName === empNameNorm || hName.includes(empNameNorm) || empNameNorm.includes(hName));
    return codeMatch || nameMatch;
  });

  let matchedTrainingHours = 0;
  let attendedTrainingsCount = 0;
  const countedTrainingIds = new Set();

  trainingsList.forEach(t => {
    if (cutoffDate) {
      const tDate = new Date(t.date || t.createdAt);
      if (tDate < cutoffDate) return;
    }

    const tId = t._id || t.id || `${t.title}_${t.date}`;
    if (countedTrainingIds.has(tId)) return;

    if (isEmployeeInAttendees(emp, t.attendees || t.attendedEmployees)) {
      countedTrainingIds.add(tId);
      attendedTrainingsCount++;
      matchedTrainingHours += getTrainingDuration(t);
    }
  });

  const totalScore = (matchedHazards.length * 10) + (matchedTrainingHours * 10);

  const hTarget = EMP_TARGET_HAZARDS;
  const tTarget = EMP_TARGET_TRAIN_HOURS;
  const hPerc = Math.min(100, Math.round((matchedHazards.length / hTarget) * 100));
  const tPerc = Math.min(100, Math.round((matchedTrainingHours / tTarget) * 100));

  return {
    ...emp,
    hazardsCount: matchedHazards.length,
    trainingHours: matchedTrainingHours,
    trainingsCount: attendedTrainingsCount,
    totalScore: totalScore,
    hCount: matchedHazards.length,
    tHours: matchedTrainingHours,
    hPerc: hPerc,
    tPerc: tPerc,
    score: totalScore
  };
}

// Shared stand-in for a list that failed to load, so "nothing changed" checks stay stable.
const NO_RECORDS = Object.freeze([]);

// Records are indexed once per data version: by normalized code when the record has one, otherwise by
// normalized name (the same rule as _statsRecordMatches). Training lists keep list order so the
// first-match-per-session rule of the original scan is preserved.
let _statsIndexMemo = null;
function _statsIndex() {
  const hazardsRef = window._allHazardsCache;
  const trainingsRef = window._trainingsCache;
  const m = _statsIndexMemo;
  if (m && m.hazardsRef === hazardsRef && m.trainingsRef === trainingsRef) return m;

  const push = (map, key, val) => {
    const arr = map.get(key);
    if (arr) arr.push(val); else map.set(key, [val]);
  };
  const hasCode = c => !!c && c !== '0';

  const hzByCode = new Map();
  const hzByName = new Map();
  toArray(hazardsRef).forEach(h => {
    if (!_statsHazardCounts(h)) return;
    const ms = new Date(h.createdAt || h.date || h.submittedAt).getTime();
    const code = normalizeCode(h.reporterCode || h.empCode || h.employeeCode || h.userId || '');
    if (hasCode(code)) { push(hzByCode, code, ms); return; }
    const name = normalizeName(h.reporterName || h.reportedBy || h.userName || '');
    if (name) push(hzByName, name, ms);
  });

  const trainings = [];
  const trByCode = new Map();
  const trByName = new Map();
  toArray(trainingsRef).forEach(t => {
    if (t.isDeleted || t.deletedAt) return;
    const idx = trainings.length;
    trainings.push({
      ms: new Date(t.date || t.createdAt).getTime(),
      dur: getTrainingDuration(t),
      key: t._id || t.id || `${t.title}_${t.date}`
    });
    let att = [];
    if (Array.isArray(t.attendees)) att = t.attendees;
    else if (Array.isArray(t.attendedEmployees)) att = t.attendedEmployees;
    const codes = new Set();
    const names = new Set();
    att.forEach(a => {
      if (!a || a.verified === false) return;
      const code = normalizeCode(a.id || a.code || a.empCode || '');
      if (hasCode(code)) { codes.add(code); return; }
      const name = normalizeName(a.name || a.workerName || '');
      if (name) names.add(name);
    });
    codes.forEach(c => push(trByCode, c, idx));
    names.forEach(n => push(trByName, n, idx));
  });

  _statsIndexMemo = { hazardsRef, trainingsRef, hzByCode, hzByName, trainings, trByCode, trByName, byCutoff: new Map() };
  return _statsIndexMemo;
}

function _statsForEmployee(idx, emp, cutoffMs) {
  const eCode = normalizeCode(emp.code || emp.empCode || emp.id);
  const eName = normalizeName(emp.name);
  const inRange = ms => cutoffMs === null || ms >= cutoffMs;

  let hCount = 0;
  (idx.hzByCode.get(eCode) || []).forEach(ms => { if (inRange(ms)) hCount++; });
  if (eName) (idx.hzByName.get(eName) || []).forEach(ms => { if (inRange(ms)) hCount++; });

  // Sessions matched by code and by name, merged in list order without duplicates.
  const byCode = idx.trByCode.get(eCode) || [];
  const byName = (eName && idx.trByName.get(eName)) || [];
  let matched = byCode;
  if (byCode.length && byName.length) {
    matched = [...new Set(byCode.concat(byName))].sort((a, b) => a - b);
  } else if (byName.length) {
    matched = byName;
  }

  let tHours = 0;
  const countedT = new Set();
  for (let i = 0; i < matched.length; i++) {
    const t = idx.trainings[matched[i]];
    if (!inRange(t.ms) || countedT.has(t.key)) continue;
    countedT.add(t.key);
    tHours += t.dur;
  }

  const tPerc = Math.min(100, Math.round((tHours / EMP_TARGET_TRAIN_HOURS) * 100));
  const hPerc = Math.min(100, Math.round((hCount / EMP_TARGET_HAZARDS) * 100));
  return {
    hazardsCount: hCount,
    trainingHours: tHours,
    tPerc: tPerc,
    hPerc: hPerc,
    totalScore: Math.round((tPerc + hPerc) / 2)
  };
}

// Results are memoized per (cutoff, hazards data, trainings data) and per employee record.
function computeAllStats(fullList, cutoffDate, targetMonths) {
  const idx = _statsIndex();
  const cutoffMs = cutoffDate ? cutoffDate.getTime() : null;
  let memo = idx.byCutoff.get(cutoffMs);
  if (!memo) {
    if (idx.byCutoff.size >= 8) idx.byCutoff.clear();
    memo = new WeakMap();
    idx.byCutoff.set(cutoffMs, memo);
  }
  return fullList.map(emp => {
    let stats = memo.get(emp);
    if (!stats) {
      stats = _statsForEmployee(idx, emp, cutoffMs);
      memo.set(emp, stats);
    }
    return { ...emp, _stats: stats };
  });
}

// The scored employee list behind the table, its search and the export. It is rebuilt only when the
// employees/hazards/trainings data or the selected period changes; search filters this list.
let _empScoredMemo = null;
function getScoredEmployees() {
  const tf = typeof window.currentTableTimeframe !== 'undefined' ? window.currentTableTimeframe : '12';
  const master = window._masterEmployeesList || NO_RECORDS;
  const m = _empScoredMemo;
  if (m && m.tf === tf && m.master === master && m.hz === window._allHazardsCache && m.tr === window._trainingsCache) {
    return m.list;
  }
  let cutoffDate = null;
  if (tf !== 'all') {
    cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - (parseInt(tf) || 1));
  }
  const list = computeAllStats(master, cutoffDate);
  _empScoredMemo = { tf, master, hz: window._allHazardsCache, tr: window._trainingsCache, list };
  return list;
}

function renderEmployeesPanelUI() {
  const dashEl = document.getElementById('empDashboardWrap');
  if (!dashEl) return;

  const fullList = window._masterEmployeesList || [];
  if (fullList.length === 0) {
    dashEl.innerHTML = '';
    return;
  }

  const scoredEmployees = getScoredEmployees();

  let totalTHours = 0;
  let totalHCount = 0;

  scoredEmployees.forEach(emp => {
    totalTHours += emp._stats.trainingHours;
    totalHCount += emp._stats.hazardsCount;
  });

  const analyticsHtml = `
    <div class="emp-analytics-grid">
      <div class="emp-kpi-card">
        <div class="emp-kpi-icon">👥</div>
        <div class="emp-kpi-value">${scoredEmployees.length}</div>
        <div class="emp-kpi-label">${T("إجمالي الموظفين")}</div>
      </div>
      <div class="emp-kpi-card">
        <div class="emp-kpi-icon">🎓</div>
        <div class="emp-kpi-value">${totalTHours}</div>
        <div class="emp-kpi-label">${T("ساعات التدريب المنجزة")}</div>
      </div>
      <div class="emp-kpi-card">
        <div class="emp-kpi-icon">⚠️</div>
        <div class="emp-kpi-value">${totalHCount}</div>
        <div class="emp-kpi-label">${T("بلاغات الخطورة المقدمة")}</div>
      </div>
    </div>
  `;

  const lbHtml = '';

  dashEl.innerHTML = analyticsHtml + lbHtml;
}
