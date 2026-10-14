// Hero header and filter bar shared by all roles, plus the personal dashboard and its charts.

function _dashExecSnapshotHTML(data) {
  const { permits, hazards, trainings, drills } = data;

  const PAPER_PER_SINGLE_FORM = 1;
  const PAPER_PER_SESSION = 2;
  const paperSaved =
    (permits.total || 0) * PAPER_PER_SINGLE_FORM +
    (hazards.total || 0) * PAPER_PER_SINGLE_FORM +
    (trainings.total || 0) * PAPER_PER_SESSION +
    (drills.total || 0) * PAPER_PER_SESSION;

  return `
    <div class="dash-exec-snapshot">
      <div class="dash-exec-grid">
        <div class="dash-exec-card">
          <span class="dash-exec-icon">${dicon('doc', 28)}</span>
          <div class="dash-exec-value">${(permits.total || 0).toLocaleString(LOC())}</div>
          <div class="dash-exec-label">${T("إجمالي تصاريح العمل")}</div>
        </div>
        <div class="dash-exec-card">
          <span class="dash-exec-icon">${dicon('target', 28)}</span>
          <div class="dash-exec-value" id="execCompliancePct">…</div>
          <div class="dash-exec-label">${T("نسبة الالتزام بأهداف السلامة")}</div>
          <div class="dash-exec-sub" id="execComplianceSub"></div>
        </div>
        <div class="dash-exec-card">
          <span class="dash-exec-icon">${dicon('check', 28)}</span>
          <div class="dash-exec-value">${paperSaved.toLocaleString(LOC())}</div>
          <div class="dash-exec-label">${T("ورقة تم توفيرها")}</div>
          <div class="dash-exec-sub">${T("ورقة واحدة لكل تصريح/بلاغ، وورقتان لكل محاضرة/تجربة طوارئ (كشف حضور)")}</div>
        </div>
      </div>
    </div>`;
}

function _dashHeroAndFilters(meta, opts) {
  opts = opts || {};
  const roleLabel = meta.viewingEmployee
    ? `${T("عرض بيانات موظف واحد:")} ${meta.viewingEmployee.name || meta.viewingEmployee.empCode || ''}`
    : ({
        super_admin: _dashDeptFilter ? `${T("مدير النظام — قسم")} ${_dashDeptFilter}` : T('مدير النظام — كل الأقسام'),
        hse_admin:   _dashDeptFilter ? `${T("مشرف السلامة — قسم")} ${_dashDeptFilter}` : T('مشرف السلامة — كل الأقسام'),
        dept_admin:  `${T("مشرف قسم")} ${meta.scopeDept || ''} ${T("— بيانات القسم")}`,
        worker:      T('إحصائياتك الشخصية'),
      }[meta.role] || T('لوحة التحكم'));

  const now = new Date().toLocaleDateString(LOC_LATN(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const quickBtns = [
    { label: T('آخر 7 أيام'),  days: 7  },
    { label: T('آخر 30 يوم'),  days: 30 },
    { label: T('آخر 3 أشهر'),  days: 90 },
    { label: T('آخر 6 أشهر'),  days: 180 },
    { label: T('آخر سنة'),     days: 365 },
  ].map(b => `<button class="dash-quick-btn${_dashQuickDays === b.days ? ' active' : ''}" data-days="${b.days}" onclick="dashApplyQuick(${b.days})">${b.label}</button>`).join('');

  const showEmpFilter = opts.showEmpFilter !== false;
  const showDeptFilter = (meta.role === 'super_admin' || meta.role === 'hse_admin');
  const deptOptionsHtml = (_dashDeptOptions || []).map(d =>
    `<option value="${escapeHtml(d)}" ${_dashDeptFilter === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
  ).join('');

  return `
    <div class="dash-hero">
      <div class="dash-hero-row">
        <div>
          <h1 class="dash-hero-title">${dicon('bars', 24)} ${T("لوحة التحكم والإحصائيات")}</h1>
          <p class="dash-hero-sub">${escapeHtml(roleLabel)} &nbsp;·&nbsp; ${now}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="dash-hero-badge">HSE Platform · Elsewedy Polymers</span>
          ${meta.role !== 'worker' ? `<button class="dash-refresh-btn" onclick="exportDashboardExcel()">${dicon('download', 15)} ${T("تصدير Excel")}</button>` : ''}
          ${meta.role !== 'worker' ? `<button class="dash-refresh-btn" id="dashExportChartsBtn" onclick="exportDashboardExcelWithCharts()">${T("📊 تصدير بالرسوم البيانية")}</button>` : ''}
          ${meta.role !== 'worker' ? `<button class="dash-refresh-btn" onclick="exportPowerBiData()" title="${T("ملف بيانات مسطّح (صف لكل سجل) جاهز لـ Power BI أو Excel")}">${T("📈 بيانات Power BI")}</button>` : ''}
          <button class="dash-refresh-btn" onclick="dashRefresh()">${dicon('refresh', 15)} ${T("تحديث")}</button>
        </div>
      </div>
      ${opts.execSnapshot || ''}
    </div>

    <div class="dash-filter-bar">
      <span class="dash-filter-label">${T("الفترة الزمنية:")}</span>
      ${quickBtns}
      <div class="dash-filter-divider"></div>
      <input type="date" id="dashFromDate" class="dash-date-input" value="${escapeHtml(_dashFromDate)}" placeholder="${T("من")}">
      <input type="date" id="dashToDate"   class="dash-date-input" value="${escapeHtml(_dashToDate)}"   placeholder="${T("إلى")}">
      ${showEmpFilter ? `
      <div class="dash-filter-divider"></div>
      <input type="text" id="dashEmpFilter" class="dash-emp-input" placeholder="${T("🔍 فلتر بالكود الوظيفي...")}" value="${escapeHtml(_dashEmpFilter)}" style="direction:ltr;">
      ` : ''}
      ${showDeptFilter ? `
      <div class="dash-filter-divider"></div>
      <select id="dashDeptFilter" class="dash-emp-input">
        <option value="">${T("-- كل الأقسام --")}</option>
        ${deptOptionsHtml}
      </select>
      ${_dashDeptFilter ? `<button class="dash-refresh-btn" onclick="dashClearDeptFilter()" title="${T("عرض كل الأقسام")}">${T("✖ إلغاء فلتر القسم")}</button>` : ''}
      ` : ''}
      <button class="dash-apply-btn" onclick="dashApplyFilters()">${T("تطبيق الفلتر")}</button>
    </div>
  `;
}

function _dashStatusPill(status) {
  const map = {
    open:      { cls: 'red',    label: T('🔴 مفتوح') },
    resolved:  { cls: 'green',  label: T('🟢 مغلق') },
    rejected:  { cls: 'red',    label: T('⛔ مرفوض') },
    approved:  { cls: 'green',  label: T('✔ موافق') },
    pending:   { cls: 'yellow', label: T('⏳ انتظار') },
    active:    { cls: 'yellow', label: T('🟡 نشطة') },
    closed:    { cls: 'green',  label: T('🟢 منتهية') },
  };
  const s = map[status] || { cls: 'blue', label: status || '—' };
  return `<span class="dash-kpi-pill ${s.cls}">${escapeHtml(s.label)}</span>`;
}

function _dashFmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(LOC_LATN(), { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (e) { return '—'; }
}

function _dashListCard(opts) {
  const { icon, title, items, emptyMsg, renderRow, wide } = opts;
  return `
    <div class="dash-chart-card${wide ? ' wide' : ''}">
      <div class="dash-chart-title">${icon} <span>${title}</span></div>
      <div class="dash-list-card-body${wide ? ' tall' : ''}">
        ${(!items || items.length === 0)
          ? `<div class="dash-empty">${emptyMsg || T('لا توجد بيانات في هذه الفترة')}</div>`
          : items.slice(0, wide ? 25 : 12).map(renderRow).join('')}
      </div>
    </div>`;
}

function renderPersonalDashboard(container, data, role, isSingleEmployeeView, ytdData) {
  const { permits, hazards, trainings, drills, penalties, meta } = data;
  const viewingEmp = meta && meta.viewingEmployee;
  const isAdminViewingOne = !!isSingleEmployeeView && role !== 'worker';
  const isDept = role === 'dept_admin' && !isAdminViewingOne;

  const trainLabel   = isDept ? T('محاضرات القسم') : isAdminViewingOne ? T('محاضرات الموظف التدريبية') : T('محاضراتك التدريبية');
  const hazLabel     = isDept ? T('بلاغات خطورة القسم') : isAdminViewingOne ? T('بلاغات الموظف عن مخاطر') : T('بلاغاتك عن مخاطر');
  const drillLabel   = isDept ? T('تجارب طوارئ القسم') : isAdminViewingOne ? T('تجارب الطوارئ التي حضرها الموظف') : T('تجارب الطوارئ التي حضرتها');
  const permitLabel  = isDept ? T('تصاريح عمل القسم') : isAdminViewingOne ? T('تصاريح عمل الموظف') : T('تصاريح عملك');
  const penaltyLabel = isDept ? T('جزاءات القسم') : isAdminViewingOne ? T('الجزاءات على الموظف') : T('الجزاءات عليك');

  const employeeBanner = isAdminViewingOne ? `
    <div class="dash-emp-banner" style="max-width:1200px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;background:var(--paper,#fff);border:1px solid var(--paper-line,#e2e8f0);border-radius:12px;margin-top:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="color:var(--amber);">${dicon('person', 26)}</span>
        <div>
          <div style="font-weight:800;font-size:15px;">${escapeHtml(viewingEmp && viewingEmp.name || T('موظف غير معروف'))}</div>
          <div style="font-size:12.5px;color:var(--muted);margin-top:2px;">
            ${viewingEmp && viewingEmp.jobTitle ? `${escapeHtml(viewingEmp.jobTitle)} · ` : ''}${viewingEmp && viewingEmp.department ? `${escapeHtml(viewingEmp.department)} · ` : ''}${T("كود:")} ${escapeHtml(viewingEmp && viewingEmp.empCode || '')}
          </div>
        </div>
      </div>
      <button class="dash-refresh-btn" onclick="dashClearEmpFilter()">${T("⬅ رجوع للوحة التحكم العامة")}</button>
    </div>
  ` : '';

  const targetSrc = ytdData || data;
  const trainHoursSoFar = (targetSrc.trainings && targetSrc.trainings.totalHours) || 0;
  const hazSoFar         = (targetSrc.hazards && targetSrc.hazards.total) || 0;
  const trainPct = Math.min(100, Math.round((trainHoursSoFar / EMP_TARGET_TRAIN_HOURS) * 100));
  const hazPct   = Math.min(100, Math.round((hazSoFar / EMP_TARGET_HAZARDS) * 100));
  const trainRemaining = Math.max(0, EMP_TARGET_TRAIN_HOURS - trainHoursSoFar);
  const hazRemaining   = Math.max(0, EMP_TARGET_HAZARDS - hazSoFar);

  const myTargetSection = (!isDept) ? `
      <div class="dash-section-title">${dicon('target', 17)} ${T("تارجتك (تدريب")} ${EMP_TARGET_TRAIN_HOURS} ${T("ساعات /")} ${EMP_TARGET_HAZARDS} ${T("بلاغ خطورة)")}${ytdData ? ` · ${T('من أول السنة')}` : ''}</div>
      <div class="dash-chart-grid">
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('cap', 17)} <span>${T("ساعات التدريب")}</span></div>
          <div style="padding:12px 4px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
              <span>${trainHoursSoFar.toLocaleString(LOC())} ${T("من")} ${EMP_TARGET_TRAIN_HOURS} ${T("ساعة")}</span>
              <span style="font-weight:700;">${trainPct}%</span>
            </div>
            <div style="background:var(--paper-line);height:10px;border-radius:5px;overflow:hidden;">
              <div style="height:100%;width:${trainPct}%;background:${trainPct >= 100 ? '#16A34A' : 'var(--amber)'};"></div>
            </div>
            <div style="margin-top:8px;font-size:12px;color:var(--muted);">
              ${trainRemaining > 0 ? `${T("متبقّي")} <b>${trainRemaining}</b> ${T("ساعة تدريب علشان توصل للتارجت")}` : T('🎉 وصلت لتارجت التدريب!')}
            </div>
          </div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('alert', 17)} <span>${T("بلاغات الخطورة")}</span></div>
          <div style="padding:12px 4px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
              <span>${hazSoFar} ${T("من")} ${EMP_TARGET_HAZARDS} ${T("بلاغ")}</span>
              <span style="font-weight:700;">${hazPct}%</span>
            </div>
            <div style="background:var(--paper-line);height:10px;border-radius:5px;overflow:hidden;">
              <div style="height:100%;width:${hazPct}%;background:${hazPct >= 100 ? '#16A34A' : '#D97706'};"></div>
            </div>
            <div style="margin-top:8px;font-size:12px;color:var(--muted);">
              ${hazRemaining > 0 ? `${T("متبقّي")} <b>${hazRemaining}</b> ${T("بلاغ خطورة علشان توصل للتارجت")}` : T('🎉 وصلت لتارجت البلاغات!')}
            </div>
          </div>
        </div>
      </div>
  ` : '';

  container.innerHTML = `
    ${_dashHeroAndFilters(meta, { showEmpFilter: isDept || isAdminViewingOne })}
    ${employeeBanner}

    <div id="dashboardContent" style="max-width:1200px;margin:0 auto;padding:0 16px;">

      <!-- KPI summary row -->
      <div class="dash-kpi-grid">
        <div class="dash-kpi-card accent-4">
          <span class="dash-kpi-icon">${dicon('cap', 26)}</span>
          <div class="dash-kpi-value" id="kpiTrainingTotal">0</div>
          <div class="dash-kpi-label">${trainLabel}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill blue">⏱ ${(trainings.totalHours || 0).toLocaleString(LOC())} ${T("ساعة")}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-5">
          <span class="dash-kpi-icon">${dicon('alert', 26)}</span>
          <div class="dash-kpi-value" id="kpiHazardTotal">0</div>
          <div class="dash-kpi-label">${hazLabel}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill red">${T("مفتوح:")} ${hazards.byStatus.open}</span>
            <span class="dash-kpi-pill green">${T("مغلق:")} ${hazards.byStatus.resolved}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-3">
          <span class="dash-kpi-icon">${dicon('siren', 26)}</span>
          <div class="dash-kpi-value" id="kpiDrillTotal">0</div>
          <div class="dash-kpi-label">${drillLabel}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill green">${T("مغلقة:")} ${drills.closed}</span>
            <span class="dash-kpi-pill yellow">${T("نشطة:")} ${drills.active}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-1">
          <span class="dash-kpi-icon">${dicon('doc', 26)}</span>
          <div class="dash-kpi-value" id="kpiPermitTotal">0</div>
          <div class="dash-kpi-label">${permitLabel}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill green">${T("موافق:")} ${permits.byStatus.approved}</span>
            <span class="dash-kpi-pill yellow">${T("انتظار:")} ${permits.byStatus.pending}</span>
          </div>
        </div>
        <div class="dash-kpi-card accent-2">
          <span class="dash-kpi-icon">${dicon('scale', 26)}</span>
          <div class="dash-kpi-value" id="kpiPenaltyTotal">0</div>
          <div class="dash-kpi-label">${penaltyLabel}</div>
          <div class="dash-kpi-sub">
            <span class="dash-kpi-pill ${penalties.total > 0 ? 'red' : 'green'}">${penalties.total > 0 ? penalties.total + T(' جزاء') : T('لا يوجد')}</span>
          </div>
        </div>
      </div>

      ${myTargetSection}

      ${isDept ? `
      <!-- Department-wide target compliance -->
      <div class="dash-section-title">${dicon('target', 17)} ${T("نسبة التزام القسم بالأهداف —")} ${_dashGetCurrentQuarterInfo().label} ${T("(تدريب")} ${EMP_TARGET_TRAIN_HOURS}${T("س سنويًا /")} ${EMP_TARGET_HAZARDS} ${T("بلاغ خطورة سنويًا لكل موظف)")}</div>
      <div class="dash-kpi-grid">
        <div class="dash-kpi-card accent-3">
          <span class="dash-kpi-icon">${dicon('cap', 26)}</span>
          <div class="dash-kpi-value" id="kpiDeptTrainAchievedPct">…</div>
          <div class="dash-kpi-label">${T("حققوا تارجت التدريب للربع الحالي")}</div>
          <div class="dash-kpi-sub" id="kpiDeptTrainAchievedSub"></div>
        </div>
        <div class="dash-kpi-card accent-5">
          <span class="dash-kpi-icon">${dicon('alert', 26)}</span>
          <div class="dash-kpi-value" id="kpiDeptHazardTargetPct">…</div>
          <div class="dash-kpi-label">${T("حققوا تارجت بلاغات الخطورة (")}${EMP_TARGET_HAZARDS} ${T("بلاغ)")}</div>
          <div class="dash-kpi-sub" id="kpiDeptHazardTargetSub"></div>
        </div>
      </div>
      ` : ''}

      <!-- Status donuts -->
      <div class="dash-section-title">${dicon('trend', 17)} ${T("نظرة عامة على الحالة")}</div>
      <div class="dash-chart-grid">
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('alert', 17)} <span>${T("بلاغات الخطورة — الحالة")}</span></div>
          <div class="dash-chart-wrap">${hazards.total === 0 ? T('<div class="dash-empty">لا توجد بلاغات في هذه الفترة</div>') : '<canvas id="chartPersonalHazard"></canvas>'}</div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('doc', 17)} <span>${T("تصاريح العمل — الحالة")}</span></div>
          <div class="dash-chart-wrap">${permits.total === 0 ? T('<div class="dash-empty">لا توجد تصاريح في هذه الفترة</div>') : '<canvas id="chartPersonalPermit"></canvas>'}</div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">${dicon('siren', 17)} <span>${T("تجارب الطوارئ — الحالة")}</span></div>
          <div class="dash-chart-wrap">${drills.total === 0 ? T('<div class="dash-empty">لا توجد تجارب طوارئ في هذه الفترة</div>') : '<canvas id="chartPersonalDrill"></canvas>'}</div>
        </div>
      </div>

      <!-- Detail lists -->
      <div class="dash-section-title">${dicon('book', 17)} ${T("التفاصيل")}</div>
      <div class="dash-chart-grid">
        ${_dashListCard({
          icon: dicon('cap', 17), title: `${trainLabel} ${T("— الأسماء والمواعيد")}`,
          items: trainings.list, emptyMsg: T('لا توجد محاضرات مسجلة في هذه الفترة'),
          renderRow: t => `
            <div class="dash-list-row">
              <div class="dash-list-main">
                <div class="dash-list-title">${escapeHtml(t.title)}</div>
                <div class="dash-list-meta">${_dashFmtDate(t.date)}${t.trainer ? ' · ' + escapeHtml(t.trainer) : ''}</div>
              </div>
              <span class="dash-kpi-pill blue">${escapeHtml(String(t.hours ?? ''))} ${T("س")}</span>
            </div>`
        })}

        ${_dashListCard({
          icon: dicon('alert', 17), title: `${hazLabel} ${T("— الأسماء والحالة")}`,
          items: hazards.list, emptyMsg: T('لا توجد بلاغات مسجلة في هذه الفترة'),
          renderRow: h => `
            <div class="dash-list-row">
              <div class="dash-list-main">
                <div class="dash-list-title" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</div>
                <div class="dash-list-meta">${_dashFmtDate(h.date)}</div>
              </div>
              ${_dashStatusPill(h.status)}
            </div>`
        })}

        ${_dashListCard({
          icon: dicon('siren', 17), title: `${drillLabel} ${T("— الأسماء والحالة")}`,
          items: drills.list, emptyMsg: T('لا توجد تجارب طوارئ مسجلة في هذه الفترة'),
          renderRow: d => `
            <div class="dash-list-row">
              <div class="dash-list-main">
                <div class="dash-list-title">${escapeHtml(d.title)}</div>
                <div class="dash-list-meta">${_dashFmtDate(d.date)}${d.location ? ' · ' + escapeHtml(d.location) : ''}</div>
              </div>
              ${_dashStatusPill(d.status)}
            </div>`
        })}

        ${_dashListCard({
          icon: dicon('doc', 17), title: `${permitLabel} ${T("— الأنواع والحالة")}`,
          items: permits.list, emptyMsg: T('لا توجد تصاريح عمل مسجلة في هذه الفترة'),
          renderRow: p => `
            <div class="dash-list-row">
              <div class="dash-list-main">
                <div class="dash-list-title">${escapeHtml(p.title)}</div>
                <div class="dash-list-meta">${_dashFmtDate(p.date)}</div>
              </div>
              ${_dashStatusPill(p.status)}
            </div>`
        })}

        ${_dashListCard({
          icon: dicon('scale', 17), title: `${penaltyLabel} ${T("— الأسباب والتواريخ")}`,
          items: penalties.list, emptyMsg: T('لا توجد جزاءات مسجلة في هذه الفترة'),
          renderRow: p => `
            <div class="dash-list-row">
              <div class="dash-list-main">
                <div class="dash-list-title" title="${escapeHtml(p.title)}">${isDept && p.empName ? `${escapeHtml(p.empName)} — ` : ''}${escapeHtml(p.title)}</div>
                <div class="dash-list-meta">${_dashFmtDate(p.date)}${p.issuedBy ? ' · ' + escapeHtml(p.issuedBy) : ''}</div>
              </div>
            </div>`
        })}
      </div>

    </div>
  `;

  _animateCounter(document.getElementById('kpiTrainingTotal'), trainings.total);
  _animateCounter(document.getElementById('kpiHazardTotal'),   hazards.total);
  _animateCounter(document.getElementById('kpiDrillTotal'),    drills.total);
  _animateCounter(document.getElementById('kpiPermitTotal'),   permits.total);
  _animateCounter(document.getElementById('kpiPenaltyTotal'),  penalties.total);

  setTimeout(() => renderPersonalCharts(data), 80);

  if (isDept) {
    _dashLoadTargetCompliance(meta.scopeDept, {
      pctTrainAchievedId: 'kpiDeptTrainAchievedPct', subTrainAchievedId: 'kpiDeptTrainAchievedSub',
      pctHazAchievedId:   'kpiDeptHazardTargetPct',  subHazAchievedId:   'kpiDeptHazardTargetSub'
    });
  }
}

async function renderPersonalCharts(data) {
  const { permits, hazards, drills } = data;
  try {
    await ensureChartJs();
  } catch (e) {
    console.error('Chart.js failed to load', e);
    return;
  }
  Chart.defaults.font.family = 'Cairo, sans-serif';
  Chart.defaults.font.size   = 12;

  _destroyChart('chartPersonalHazard');
  const ctxH = document.getElementById('chartPersonalHazard');
  if (ctxH) {
    _dashCharts['chartPersonalHazard'] = new Chart(ctxH, {
      type: 'doughnut',
      data: {
        labels: [T('مفتوح'), 'مغلق', 'مرفوض'],
        datasets: [{ data: [hazards.byStatus.open, hazards.byStatus.resolved, hazards.byStatus.rejected],
          backgroundColor: ['#DC2626','#16A34A','#94a3b8'], borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } } }
    });
  }

  _destroyChart('chartPersonalPermit');
  const ctxP = document.getElementById('chartPersonalPermit');
  if (ctxP) {
    _dashCharts['chartPersonalPermit'] = new Chart(ctxP, {
      type: 'doughnut',
      data: {
        labels: [T('موافق'), T('انتظار'), 'مرفوض'],
        datasets: [{ data: [permits.byStatus.approved, permits.byStatus.pending, permits.byStatus.rejected],
          backgroundColor: ['#16A34A','#D97706','#DC2626'], borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } } }
    });
  }

  _destroyChart('chartPersonalDrill');
  const ctxD = document.getElementById('chartPersonalDrill');
  if (ctxD) {
    _dashCharts['chartPersonalDrill'] = new Chart(ctxD, {
      type: 'pie',
      data: {
        labels: [T('نشط'), 'مغلق'],
        datasets: [{ data: [drills.active, drills.closed], backgroundColor: ['#D97706','#16A34A'], borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } } } }
    });
  }
}
