// Admin dashboard markup, embedded report panel, department compliance, quarterly targets and charts.

function renderDashboardHTML(container, data) {
  const { permits, hazards, trainings, drills, penalties, meta } = data;

  container.innerHTML = `
    ${_dashHeroAndFilters(meta, { showEmpFilter: true, execSnapshot: _dashExecSnapshotHTML(data) })}

    <!-- Content Wrapper -->
    <div id="dashboardContent" style="max-width:1200px;margin:0 auto;padding:0 16px;">

      <!-- KPI Cards -->
      <div class="dash-kpi-grid">
        <div class="dash-kpi-card accent-1">
          <span class="dash-kpi-icon">${dicon('doc', 26)}</span>
          <div class="dash-kpi-value" id="kpiPermitTotal">0</div>
          <div class="dash-kpi-label">${T("تصاريح العمل")}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill green">${T("✔ موافق:")} ${permits.byStatus.approved}</span>
            <span class="dash-kpi-pill yellow">${T("⏳ انتظار:")} ${permits.byStatus.pending}</span>
            <span class="dash-kpi-pill red">${T("✖ مرفوض:")} ${permits.byStatus.rejected}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-5">
          <span class="dash-kpi-icon">${dicon('alert', 26)}</span>
          <div class="dash-kpi-value" id="kpiHazardTotal">0</div>
          <div class="dash-kpi-label">${T("بلاغات الخطورة")}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill red">${T("مفتوح:")} ${hazards.byStatus.open}</span>
            <span class="dash-kpi-pill green">${T("محلول:")} ${hazards.byStatus.resolved}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-4">
          <span class="dash-kpi-icon">${dicon('cap', 26)}</span>
          <div class="dash-kpi-value" id="kpiTrainingTotal">0</div>
          <div class="dash-kpi-label">${T("المحاضرات التدريبية")}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill blue">${T("حضور:")} ${trainings.totalAttendees}</span>
            <span class="dash-kpi-pill blue">⏱ ${(trainings.totalHours || 0).toLocaleString(LOC())} ${T("ساعة")}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-3">
          <span class="dash-kpi-icon">${dicon('siren', 26)}</span>
          <div class="dash-kpi-value" id="kpiDrillTotal">0</div>
          <div class="dash-kpi-label">${T("تجارب الطوارئ")}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill blue">${T("إجمالي الحضور:")} ${drills.totalAttendees}</span>
            <span class="dash-kpi-pill green">${T("مغلقة:")} ${drills.closed}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-2">
          <span class="dash-kpi-icon">${dicon('scale', 26)}</span>
          <div class="dash-kpi-value" id="kpiPenaltyTotal">0</div>
          <div class="dash-kpi-label">${T("الجزاءات")}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill ${penalties.total > 0 ? 'red' : 'green'}">${penalties.total} ${T("جزاء")}</span>
          </div>
        </div>
      </div>

      <!-- Company-wide target compliance (بيحترم فلتر القسم لو متحدد) -->
      <div class="dash-section-title">${dicon('target', 17)} ${T("نسبة الالتزام بالأهداف —")} ${_dashDeptFilter ? `${T("قسم")} ${escapeHtml(_dashDeptFilter)} · ` : ''}${_dashGetCurrentQuarterInfo().label} ${T("(تدريب")} ${EMP_TARGET_TRAIN_HOURS}${T("س سنويًا /")} ${EMP_TARGET_HAZARDS} ${T("بلاغ خطورة سنويًا لكل موظف)")}</div>
      <div class="dash-kpi-grid">
        <div class="dash-kpi-card accent-3">
          <span class="dash-kpi-icon">${dicon('cap', 26)}</span>
          <div class="dash-kpi-value" id="kpiTrainAchievedPct">…</div>
          <div class="dash-kpi-label">${T("حققوا تارجت التدريب للربع الحالي")}</div>
          <div class="dash-kpi-sub" id="kpiTrainAchievedSub"></div>
        </div>
        <div class="dash-kpi-card accent-5">
          <span class="dash-kpi-icon">${dicon('alert', 26)}</span>
          <div class="dash-kpi-value" id="kpiHazardTargetPct">…</div>
          <div class="dash-kpi-label">${T("حققوا تارجت بلاغات الخطورة (")}${EMP_TARGET_HAZARDS} ${T("بلاغ)")}</div>
          <div class="dash-kpi-sub" id="kpiHazardTargetSub"></div>
        </div>
      </div>

      <!-- ترتيب الأقسام: بيتحسب من نفس أرقام الكروت اللي فوق، وبيحترم فلتر القسم -->
      ${(meta.role === 'super_admin' || meta.role === 'hse_admin' || meta.role === 'hse_director') ? `
      <div class="dash-section-title">${dicon('bars', 17)} ${T("ترتيب الأقسام حسب الالتزام بالأهداف")}${_dashDeptFilter ? ` — ${T("قسم")} ${escapeHtml(_dashDeptFilter)}` : ''}</div>
      <div class="exec-leaderboard" id="dashDeptLeaderboard" style="margin-bottom:24px;">
        <div class="loading">${T("جارِ التحميل…")}</div>
      </div>
      ` : ''}

      <!-- Charts Row 1: Status pies -->
      <div class="dash-section-title">${dicon('trend', 17)} ${T("توزيع الإحصائيات")}</div>
      <div class="dash-chart-grid">
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('doc', 17)} <span>${T("تصاريح العمل — حسب الحالة")}</span></div>
          <div class="dash-chart-wrap"><canvas id="chartPermitStatus"></canvas></div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('bars', 17)} <span>${T("تصاريح العمل — حسب النوع")}</span></div>
          <div class="dash-chart-wrap"><canvas id="chartPermitType"></canvas></div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('alert', 17)} <span>${T("بلاغات الخطورة — حسب الشدة")}</span></div>
          <div class="dash-chart-wrap"><canvas id="chartHazardSeverity"></canvas></div>
        </div>
      </div>

      <!-- Charts Row 2: Time series -->
      <div class="dash-section-title">${dicon('calendar', 17)} ${T("الاتجاهات الشهرية (آخر 12 شهر)")}</div>
      <div class="dash-chart-grid">
        <div class="dash-chart-card span-2">
          <div class="dash-chart-title">${dicon('trend', 17)} <span>${T("تصاريح وبلاغات — شهرياً")}</span></div>
          <div class="dash-chart-wrap tall"><canvas id="chartMonthly"></canvas></div>
        </div>
      </div>

      <!-- Charts Row 3: Training topics + Drills -->
      <div class="dash-section-title">${dicon('cap', 17)} ${T("التدريب وتجارب الطوارئ")}</div>
      <div class="dash-chart-grid">
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('book', 17)} <span>${T("أكثر الموضوعات تدريباً")}</span></div>
          <div id="dashTopicsList" class="dash-topic-list" style="padding:8px 0;min-height:180px;">
            ${trainings.topTopics.length === 0 ? T('<div class="dash-empty">لا توجد بيانات</div>') :
              trainings.topTopics.map((t, i) => {
                const max = trainings.topTopics[0].count || 1;
                const pct = Math.round((t.count / max) * 100);
                const colors = ['#E2001A','#333333','#D97706','#6B6B6B','#8A0E1F','#9CA3AF'];
                return `<div class="dash-topic-row">
                  <div class="dash-topic-name" title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</div>
                  <div class="dash-topic-bar-bg"><div class="dash-topic-bar" style="width:${pct}%;background:${colors[i%colors.length]};"></div></div>
                  <div class="dash-topic-count">${t.count}</div>
                </div>`;
              }).join('')}
          </div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('siren', 17)} <span>${T("تجارب الطوارئ — الحالة")}</span></div>
          <div class="dash-chart-wrap"><canvas id="chartDrillStatus"></canvas></div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('bars', 17)} <span>${T("التدريبات والتجارب — شهرياً")}</span></div>
          <div class="dash-chart-wrap"><canvas id="chartTrainingsMonthly"></canvas></div>
        </div>
      </div>

      <!-- Penalties — كارت بعرض الصفحة كلها عشان سبب الجزاء يبان كامل -->
      <div class="dash-section-title">${dicon('scale', 17)} ${T("الجزاءات")}</div>
      <div class="dash-chart-grid one-col">
        ${_dashListCard({
          icon: dicon('scale', 17), title: `${T('أحدث الجزاءات — الأسماء والأسباب')} (${penalties.total || 0})`,
          items: penalties.list, emptyMsg: T('لا توجد جزاءات مسجلة في هذه الفترة'),
          wide: true,
          renderRow: p => `
            <div class="dash-list-row">
              <div class="dash-list-main">
                <div class="dash-list-title wrap">${p.empName ? `<b>${escapeHtml(p.empName)}</b> — ` : ''}${escapeHtml(p.title)}</div>
                <div class="dash-list-meta">${_dashFmtDate(p.date)}${p.issuedBy ? ' · ' + T('صادر من') + ': ' + escapeHtml(p.issuedBy) : ''}</div>
              </div>
            </div>`
        })}
      </div>

      <!-- 📑 تقرير السلامة الشامل جوه لوحة التحكم (طلب بشمهندس 22 سبتمبر
           2026). نفس لوحة تابة "التقارير" بالظبط — العنصر واحد بيتنقل
           بين المكانين، والتابة فضلت زي ما هي. -->
      <div class="dash-section rep-dash-section" id="dashReportsSection" style="display:none">
        <div class="dash-section-head rep-dash-head" id="dashReportsHead" role="button" tabindex="0"
             aria-expanded="false" aria-controls="dashReportsBody">
          <div>
            <div class="dash-section-title">${T('📑 تقرير السلامة الشامل')}</div>
            <div class="dash-section-sub">${T('أهم أرقام السلامة والتارجت + الجزاءات — طباعة أو PDF أو إرسال بالإيميل')}</div>
          </div>
          <span class="rep-dash-caret" aria-hidden="true">▾</span>
        </div>
        <div class="dash-section-body" id="dashReportsBody" hidden>
          <div id="reportsSlotDash"></div>
        </div>
      </div>

    </div><!-- end inner content wrapper -->
  `;

  _dashSetupReportsSection();

  _animateCounter(document.getElementById('kpiPermitTotal'),  permits.total);
  _animateCounter(document.getElementById('kpiHazardTotal'),  hazards.total);
  _animateCounter(document.getElementById('kpiTrainingTotal'), trainings.total);
  _animateCounter(document.getElementById('kpiDrillTotal'),   drills.total);
  _animateCounter(document.getElementById('kpiPenaltyTotal'), penalties.total);

  _dashLoadTargetCompliance(meta.scopeDept || _dashDeptFilter || null, {
    pctTrainAchievedId: 'kpiTrainAchievedPct', subTrainAchievedId: 'kpiTrainAchievedSub',
    pctHazAchievedId:   'kpiHazardTargetPct',  subHazAchievedId:   'kpiHazardTargetSub',
    pctOverallId: 'execCompliancePct', subOverallId: 'execComplianceSub'
  });
}

function _dashSetupReportsSection() {
  const sec = document.getElementById('dashReportsSection');
  if (!sec) return;
  const uiRole = VIEWER_ROLES_UI.includes(currentUserRole) ? 'super_admin' : currentUserRole;
  const allowed = ['super_admin', 'hse_admin'].includes(uiRole);
  if (!allowed) { sec.remove(); return; }
  sec.style.display = '';

  const head = document.getElementById('dashReportsHead');
  const body = document.getElementById('dashReportsBody');
  const toggle = () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    sec.classList.toggle('open', open);
    if (open) mountReportsPanel('reportsSlotDash');
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

function _dashRenderDeptCompliance(scoredAll, q, scopeDept, penaltyMap) {
  const boardEl = document.getElementById('dashDeptLeaderboard');
  if (!boardEl) return;
  const pens = penaltyMap || new Map();
  const byDept = new Map();
  (scoredAll || []).forEach(e => {
    const d = String(e.department || '').trim() || T('غير محدد');
    if (!byDept.has(d)) byDept.set(d, { dept: d, n: 0, t: 0, h: 0, sum: 0, pen: 0 });
    const b = byDept.get(d);
    const st = e._stats || { trainingHours: 0, hazardsCount: 0 };
    const nPen = pens.get(normalizeCode(e.code || e.empCode || e.id)) || 0;
    const trainPct = Math.min(100, Math.round((st.trainingHours / q.targetHours) * 100));
    const hazPct   = Math.min(100, Math.round((st.hazardsCount  / q.targetHazards) * 100));
    const score = Math.max(0, Math.round((trainPct + hazPct) / 2) - nPen * MODEL_EMP_PENALTY_DEDUCTION);
    b.n++;
    b.sum += score;
    b.pen += nPen;
    if (st.trainingHours >= q.targetHours) b.t++;
    if (st.hazardsCount  >= q.targetHazards) b.h++;
  });
  const MIN_DEPT_EMPLOYEES = 3;
  const rows = [...byDept.values()]
    .filter(b => b.n >= MIN_DEPT_EMPLOYEES)
    .map(b => ({
      dept: b.dept, n: b.n, penalties: b.pen,
      trainPct: Math.round((b.t / b.n) * 100),
      hazPct:   Math.round((b.h / b.n) * 100),
      score:    Math.round(b.sum / b.n),
    }))
    .sort((a, b) => b.score - a.score || b.n - a.n);

  if (!rows.length) {
    boardEl.innerHTML = `<div class="empty" style="padding:20px"><div class="icon">📊</div>${T('لا توجد بيانات كافية بعد')}</div>`;
    return;
  }
  const shown = scopeDept
    ? rows.filter(r => r.dept.toLowerCase().includes(String(scopeDept).toLowerCase()))
    : rows.slice(0, 12);
  const note = `<div class="dash-board-note">${T('المعيار: متوسط درجات موظفي القسم — إنجاز تارجت')} ${q.targetHours}${T('س تدريب و')}${q.targetHazards} ${T('بلاغ خطورة لحد')} ${q.label}${T('، وكل جزاء نشط بيخصم')} ${MODEL_EMP_PENALTY_DEDUCTION} ${T('نقطة')}${scopeDept ? ` · ${T('مفلتر على قسم')} ${escapeHtml(scopeDept)}` : ''}</div>`;
  boardEl.innerHTML = note + (shown.length ? shown.map(r => {
    const rank = rows.findIndex(x => x.dept === r.dept) + 1;
    const cls = r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'bad';
    return `
      <div class="exec-leaderboard-row">
        <div class="exec-leaderboard-rank">${rank}</div>
        <div>
          <div class="exec-leaderboard-name">${escapeHtml(r.dept)} <span class="dash-board-count">(${r.n} ${T('موظف')})</span></div>
          <div class="exec-leaderboard-bar-bg">
            <div class="exec-leaderboard-bar-fill ${cls}" style="width:${Math.max(2, r.score)}%"></div>
          </div>
          <div class="dash-board-sub">${T('تدريب')} ${r.trainPct}% · ${T('بلاغات')} ${r.hazPct}%${r.penalties ? ` · <span style="color:var(--danger);font-weight:700;">${T('جزاءات')} ${r.penalties} ⚖️</span>` : ''}${scopeDept ? ` · ${T('الترتيب')} ${rank} ${T('من')} ${rows.length}` : ''}</div>
        </div>
        <div class="exec-leaderboard-score">${r.score}</div>
      </div>`;
  }).join('') : `<div class="empty" style="padding:16px">${T('القسم ده مالوش بيانات كافية للترتيب')}</div>`);
}

// Annual targets split into quarters and prorated by quarters elapsed, counted from Jan 1. Only this dashboard section uses it.
function _dashGetCurrentQuarterInfo() {
  const now = new Date();
  const quarterIdx = Math.floor(now.getMonth() / 3);
  const quartersElapsed = quarterIdx + 1;
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const quarterNames = [T('الربع الأول (يناير–مارس)'), T('الربع الثاني (أبريل–يونيو)'), T('الربع الثالث (يوليو–سبتمبر)'), T('الربع الرابع (أكتوبر–ديسمبر)')];
  return {
    yearStart,
    quartersElapsed,
    targetHours:    (EMP_TARGET_TRAIN_HOURS / 4) * quartersElapsed,
    targetHazards:  Math.ceil((EMP_TARGET_HAZARDS / 4) * quartersElapsed),
    label: `${quarterNames[quarterIdx]} ${now.getFullYear()}`,
  };
}

async function _dashLoadTargetCompliance(scopeDept, ids) {
  const pctTrainAchEl = document.getElementById(ids.pctTrainAchievedId);
  const subTrainAchEl = document.getElementById(ids.subTrainAchievedId);
  const pctHazEl   = document.getElementById(ids.pctHazAchievedId);
  const subHazEl   = document.getElementById(ids.subHazAchievedId);
  const pctOverallEl = ids.pctOverallId ? document.getElementById(ids.pctOverallId) : null;
  const subOverallEl = ids.subOverallId ? document.getElementById(ids.subOverallId) : null;
  if (!pctTrainAchEl || !pctHazEl) return;

  try {
    // Shared with the employees tab: unchanged lists come back from the ETag cache, and the per-employee
    // stats below are memoized on that data.
    const [empRes, hazRes, trainRes, penRes] = await Promise.all([
      fetchJsonIfChanged('/api/employees'),
      fetchJsonIfChanged('/api/hazards'),
      fetchJsonIfChanged('/api/trainings'),
      fetchJsonIfChanged('/api/penalties')
    ]);
    const allEmployees = empRes.ok ? toArray(empRes.data) : [];
    window._allHazardsCache = hazRes.ok ? toArray(hazRes.data) : NO_RECORDS;
    window._trainingsCache  = trainRes.ok ? toArray(trainRes.data) : NO_RECORDS;
    const penaltiesList = penRes && penRes.ok ? toArray(penRes.data) : [];

    const q = _dashGetCurrentQuarterInfo();
    const scoredAll = computeAllStats(allEmployees, q.yearStart, q.quartersElapsed * 3);
    const scoped = scopeDept
      ? scoredAll.filter(e => (e.department || '').toLowerCase().includes(String(scopeDept).toLowerCase()))
      : scoredAll;
    const scored = scoped;
    const total = scoped.length;

    const trainAchieved = scored.filter(e => e._stats.trainingHours >= q.targetHours).length;
    const hazAchieved   = scored.filter(e => e._stats.hazardsCount   >= q.targetHazards).length;

    const trainAchPct = total ? Math.round((trainAchieved / total) * 100) : 0;
    const hazPct       = total ? Math.round((hazAchieved / total) * 100) : 0;

    pctTrainAchEl.textContent = `${trainAchPct}%`;
    pctHazEl.textContent      = `${hazPct}%`;
    if (subTrainAchEl) subTrainAchEl.innerHTML = `<span class="dash-kpi-pill green">${trainAchieved} ${T("من")} ${total} ${T("موظف")}</span> <span class="dash-kpi-pill blue">${T("تارجت")} ${q.label}: ${q.targetHours}${T("س")}</span>`;
    if (subHazEl)       subHazEl.innerHTML     = `<span class="dash-kpi-pill green">${hazAchieved} ${T("من")} ${total} ${T("موظف")}</span> <span class="dash-kpi-pill blue">${T("تارجت")} ${q.label}: ${q.targetHazards} ${T("بلاغ")}</span>`;

    if (pctOverallEl) {
      const overallPct = total ? Math.round((trainAchPct + hazPct) / 2) : 0;
      pctOverallEl.textContent = `${overallPct}%`;
      if (subOverallEl) subOverallEl.innerHTML = `${T("تدريب")} ${trainAchPct}${T("% · بلاغات خطورة")} ${hazPct}%`;
    }

    const penaltyMap = new Map();
    penaltiesList.forEach(p => {
      if (!p || p.status === 'deleted' || p.status === 'cancelled') return;
      const d = new Date(p.date || p.createdAt || 0);
      if (isNaN(d) || d < q.yearStart) return;
      const code = normalizeCode(p.empCode || p.code || '');
      if (code) penaltyMap.set(code, (penaltyMap.get(code) || 0) + 1);
    });

    _dashRenderDeptCompliance(scoredAll, q, scopeDept, penaltyMap);
  } catch (err) {
    console.error('Target compliance load error', err);
    pctTrainAchEl.textContent = '—';
    pctHazEl.textContent      = '—';
    if (pctOverallEl) pctOverallEl.textContent = '—';
  }
}

async function renderDashboardCharts(data) {
  const { permits, hazards, trainings, drills } = data;

  try {
    await ensureChartJs();
  } catch (e) {
    console.error('Chart.js failed to load', e);
    return;
  }
  _dashRegisterChartPlugins();

  Chart.defaults.font.family = 'Cairo, sans-serif';
  Chart.defaults.font.size   = 12;
  Chart.defaults.color       = '#6B6B6B';

  const PALETTE = ['#E2001A','#333333','#D97706','#6B6B6B','#8A0E1F','#9CA3AF','#A6000F','#BFBFBF'];

  const _tip = {
    backgroundColor: '#1f2937', titleColor: '#fff', bodyColor: '#e5e7eb',
    padding: 10, cornerRadius: 8, titleFont: { family: 'Cairo, sans-serif', weight: '700' },
    bodyFont: { family: 'Cairo, sans-serif' }, displayColors: true, boxPadding: 4,
  };

  _destroyChart('chartPermitStatus');
  const ctxPS = document.getElementById('chartPermitStatus');
  if (ctxPS) {
    const psData  = [permits.byStatus.approved, permits.byStatus.pending, permits.byStatus.rejected];
    const psTotal = psData.reduce((a, b) => a + b, 0);
    _dashCharts['chartPermitStatus'] = new Chart(ctxPS, {
      type: 'doughnut',
      data: {
        labels: [T('موافق'), T('انتظار'), 'مرفوض'],
        datasets: [{ data: psData,
          backgroundColor: ['#16A34A','#D97706','#DC2626'],
          hoverBackgroundColor: ['#15803d','#b45309','#b91c1c'],
          borderWidth: 2, borderColor: '#fff', hoverBorderWidth: 0, hoverOffset: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '72%',
        animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 18, usePointStyle: true, pointStyle: 'circle', font: { size: 12, weight: '600' } } },
          tooltip: { ..._tip, callbacks: { label: (ctx) => {
            const pct = psTotal ? Math.round((ctx.parsed / psTotal) * 100) : 0;
            return ` ${ctx.label}: ${ctx.parsed.toLocaleString(LOC())} (${pct}%)`;
          } } },
          _dashCenterText: { enabled: true, total: psTotal, label: T('إجمالي التصاريح') },
        }
      }
    });
  }

  _destroyChart('chartPermitType');
  const ctxPT = document.getElementById('chartPermitType');
  if (ctxPT) {
    const typeEntries = Object.entries(permits.byType).sort((a, b) => b[1] - a[1]);
    const typeKeys   = typeEntries.map(e => e[0]);
    const typeLabels = typeKeys.map(k => T(PERMIT_TYPE_LABELS[k] || k));
    const typeVals   = typeEntries.map(e => e[1]);
    const typeColors = typeKeys.map((k, i) => PERMIT_TYPE_COLORS[k] || PALETTE[i % PALETTE.length]);
    const wrapPT = ctxPT.parentElement;
    if (wrapPT) wrapPT.style.height = Math.max(240, typeVals.length * 40 + 30) + 'px';

    _dashCharts['chartPermitType'] = new Chart(ctxPT, {
      type: 'bar',
      data: {
        labels: typeLabels,
        datasets: [{ label: T('عدد التصاريح'), data: typeVals,
          backgroundColor: typeColors, hoverBackgroundColor: typeColors,
          borderRadius: 6, borderSkipped: false,
          barPercentage: 0.6, categoryPercentage: 0.7 }]
      },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        animation: { duration: 700, easing: 'easeOutQuart' },
        layout: { padding: { left: 4, right: 12, top: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: { ..._tip, callbacks: { label: (ctx) => ` ${ctx.parsed.x.toLocaleString(LOC())} ${T("تصريح")}` } },
        },
        scales: {
          x: { grid: { color: '#EFEFEF', drawTicks: false }, border: { display: false },
            ticks: { precision: 0, maxTicksLimit: 6, font: { size: 11 },
              callback: (v) => Number(v).toLocaleString(LOC()) } },
          y: { grid: { display: false }, border: { display: false },
            ticks: { font: { size: 12, weight: '600' }, color: '#334155' } }
        }
      }
    });
  }

  _destroyChart('chartHazardSeverity');
  const ctxHS = document.getElementById('chartHazardSeverity');
  if (ctxHS) {
    const { low, medium, high, critical } = hazards.bySeverity;
    const hsData  = [low, medium, high, critical];
    const hsTotal = hsData.reduce((a, b) => a + b, 0);
    _dashCharts['chartHazardSeverity'] = new Chart(ctxHS, {
      type: 'doughnut',
      data: {
        labels: [T('منخفض'), T('متوسط'), T('عالي'), T('حرج')],
        datasets: [{ data: hsData,
          backgroundColor: ['#16A34A','#D97706','#DC2626','#7C1D1D'],
          hoverBackgroundColor: ['#15803d','#b45309','#b91c1c','#5c1414'],
          borderWidth: 2, borderColor: '#fff', hoverBorderWidth: 0, hoverOffset: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '72%',
        animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: 'circle', font: { size: 12, weight: '600' } } },
          tooltip: { ..._tip, callbacks: { label: (ctx) => {
            const pct = hsTotal ? Math.round((ctx.parsed / hsTotal) * 100) : 0;
            return ` ${ctx.label}: ${ctx.parsed.toLocaleString(LOC())} (${pct}%)`;
          } } },
          _dashCenterText: { enabled: true, total: hsTotal, label: T('إجمالي البلاغات') },
        }
      }
    });
  }

  _destroyChart('chartMonthly');
  const ctxM = document.getElementById('chartMonthly');
  if (ctxM) {
    const months = Object.keys(permits.monthly);
    const monthLabels = months.map(m => {
      const [y, mo] = m.split('-');
      return new Date(+y, +mo - 1).toLocaleDateString(LOC_LATN(), { month: 'short', year: '2-digit' });
    });
    _dashCharts['chartMonthly'] = new Chart(ctxM, {
      type: 'line',
      data: {
        labels: monthLabels,
        datasets: [
          { label: T('تصاريح العمل'), data: Object.values(permits.monthly),
            borderColor: '#1A1A1A', backgroundColor: 'rgba(26,26,26,0.06)',
            fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#1A1A1A' },
          { label: T('بلاغات الخطورة'), data: Object.values(hazards.monthly),
            borderColor: '#DC2626', backgroundColor: 'rgba(239,68,68,0.06)',
            fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#DC2626' },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { boxWidth: 14, padding: 16 } } },
        scales: {
          x: { grid: { color: '#EFEFEF' } },
          y: { grid: { color: '#EFEFEF' }, beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
  }

  _destroyChart('chartDrillStatus');
  const ctxDS = document.getElementById('chartDrillStatus');
  if (ctxDS) {
    _dashCharts['chartDrillStatus'] = new Chart(ctxDS, {
      type: 'pie',
      data: {
        labels: [T('نشط'), 'مغلق'],
        datasets: [{ data: [drills.active, drills.closed],
          backgroundColor: ['#D97706','#16A34A'],
          borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } }
      }
    });
  }

  _destroyChart('chartTrainingsMonthly');
  const ctxTM = document.getElementById('chartTrainingsMonthly');
  if (ctxTM) {
    const tMonths = Object.keys(trainings.monthly);
    const tLabels = tMonths.map(m => {
      const [y, mo] = m.split('-');
      return new Date(+y, +mo - 1).toLocaleDateString(LOC_LATN(), { month: 'short' });
    });
    _dashCharts['chartTrainingsMonthly'] = new Chart(ctxTM, {
      type: 'bar',
      data: {
        labels: tLabels,
        datasets: [
          { label: T('التدريبات'), data: Object.values(trainings.monthly),
            backgroundColor: 'rgba(245,158,11,0.8)', borderRadius: 4 },
          { label: T('تجارب الطوارئ'), data: Object.values(drills.monthly),
            backgroundColor: 'rgba(239,68,68,0.75)', borderRadius: 4 },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 12 } } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: '#EFEFEF' }, beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
  }
}

(function() {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 30);
  _dashFromDate = from.toISOString().slice(0, 10);
  _dashToDate   = now.toISOString().slice(0, 10);
})();
