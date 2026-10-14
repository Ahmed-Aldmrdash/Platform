// Dashboard state, icon set, chart helpers, data loading, filters and Excel/Power BI exports.

let _dashFromDate  = '';
let _dashToDate    = '';
let _dashEmpFilter = '';
let _dashDeptFilter = '';
let _dashDeptOptions = null;
let _dashQuickDays = 30;
let _dashCharts    = {};

const DASH_ICON_PATHS = {
  doc:      '<rect x="5" y="3" width="14" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>',
  alert:    '<polygon points="12,4 22,20 2,20"/><line x1="12" y1="10" x2="12" y2="15"/><circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none"/>',
  cap:      '<polygon points="12,4 22,9 12,14 2,9"/><line x1="6" y1="11" x2="6" y2="16"/><polyline points="6,16 12,18.5 18,16"/>',
  siren:    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="5.3" y1="5.3" x2="7.4" y2="7.4"/><line x1="16.6" y1="16.6" x2="18.7" y2="18.7"/><line x1="5.3" y1="18.7" x2="7.4" y2="16.6"/><line x1="16.6" y1="7.4" x2="18.7" y2="5.3"/>',
  scale:    '<circle cx="12" cy="12" r="9"/><line x1="7" y1="12" x2="17" y2="12"/>',
  target:   '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  check:    '<circle cx="12" cy="12" r="9"/><polyline points="8,12.5 11,15.5 16,9"/>',
  trend:    '<polyline points="3,17 9,11 13,14 21,5"/><polyline points="15,5 21,5 21,11"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="7" y1="2" x2="7" y2="6"/><line x1="17" y1="2" x2="17" y2="6"/>',
  book:     '<rect x="4" y="4" width="16" height="16" rx="1.5"/><line x1="12" y1="4" x2="12" y2="20"/>',
  bars:     '<line x1="5" y1="19" x2="5" y2="10"/><line x1="12" y1="19" x2="12" y2="5"/><line x1="19" y1="19" x2="19" y2="14"/>',
  refresh:  '<circle cx="12" cy="12" r="8" stroke-dasharray="42 8" transform="rotate(-90 12 12)"/><polygon points="19,4.5 19,10 13.5,7.2" fill="currentColor" stroke="none"/>',
  download: '<polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/>',
  search:   '<circle cx="10" cy="10" r="7"/><line x1="21" y1="21" x2="15.5" y2="15.5"/>',
  close:    '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
  person:   '<circle cx="12" cy="8" r="4"/><polygon points="5,20 8,13 16,13 19,20"/>',
};
function dicon(name, size) {
  size = size || 20;
  const inner = DASH_ICON_PATHS[name] || '';
  return `<svg class="dash-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

const _dashCenterTextPlugin = {
  id: '_dashCenterText',
  afterDraw(chart) {
    const opts = chart.config.options.plugins && chart.config.options.plugins._dashCenterText;
    if (!opts || !opts.enabled) return;
    if (chart.tooltip && chart.tooltip.opacity > 0) return;
    const { ctx, chartArea: { left, right, top, bottom } } = chart;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 26px Cairo, sans-serif';
    ctx.fillStyle = '#1f2937';
    ctx.fillText(opts.total.toLocaleString(LOC()), cx, cy - 10);
    ctx.font = '600 12px Cairo, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(opts.label, cx, cy + 14);
    ctx.restore();
  }
};

let _dashPluginsRegistered = false;
function _dashRegisterChartPlugins() {
  if (_dashPluginsRegistered || typeof Chart === 'undefined') return;
  Chart.register(_dashCenterTextPlugin);
  _dashPluginsRegistered = true;
}
let _dashLastData  = null;

const PERMIT_TYPE_LABELS = {
  general:    'عام',
  height:     'ارتفاع',
  confined:   'أماكن مغلقة',
  excavation: 'حفر',
  lifting:    'رفع',
  hot:        'ساخن',
  loto:       'فصل وعزل',
  lockout:    'فصل وعزل',
};

const PERMIT_TYPE_COLORS = {
  general:    '#333333',
  height:     '#E2001A',
  confined:   '#6B6B6B',
  excavation: '#D97706',
  lifting:    '#8A0E1F',
  hot:        '#A6000F',
  loto:       '#9CA3AF',
  lockout:    '#9CA3AF',
};

function _destroyChart(id) {
  if (_dashCharts[id]) {
    try { _dashCharts[id].destroy(); } catch(e) {}
    delete _dashCharts[id];
  }
}

function _animateCounter(el, target, duration = 700) {
  if (!el) return;
  const start = 0;
  const step = (target / (duration / 16));
  let current = start;
  const tick = () => {
    current = Math.min(current + step, target);
    el.textContent = Math.round(current).toLocaleString(LOC());
    if (current < target) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function loadDashboard() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;

  container.innerHTML = `
    <div class="dash-loading">
      <div class="dash-loading-spinner"></div>
      <div>${T("جارِ تحميل لوحة التحكم…")}</div>
    </div>`;

  try {
    const params = new URLSearchParams();
    if (_dashFromDate) params.set('dateFrom', _dashFromDate);
    if (_dashToDate)   params.set('dateTo',   _dashToDate);

    if (_dashEmpFilter && sessionRole !== 'worker') {
        params.set('empCode', _dashEmpFilter.trim().toUpperCase());
    }
    if (_dashDeptFilter && (currentUserRole === 'super_admin' || currentUserRole === 'hse_admin')) {
        params.set('dept', _dashDeptFilter);
    }

    const fetchOptions = { headers: {} };

    const res = await authFetch('/api/analytics?' + params.toString(), fetchOptions);
    if (!res.ok) throw new Error('API error ' + res.status);
    const data = await res.json();

    const role = (data.meta && data.meta.role) || sessionRole;
    _dashLastData = data;

    const isSingleEmployeeView = !!(data.meta && data.meta.viewingEmployee);

    if (role === 'worker' || isSingleEmployeeView) {
      let ytdData = null;
      try {
        const ytdParams = new URLSearchParams(params);
        ytdParams.set('dateFrom', `${new Date().getFullYear()}-01-01`);
        ytdParams.delete('dateTo');
        const ytdRes = await authFetch('/api/analytics?' + ytdParams.toString(), fetchOptions);
        if (ytdRes.ok) ytdData = await ytdRes.json();
      } catch (e) { }
      renderPersonalDashboard(container, data, role, isSingleEmployeeView, ytdData);
    } else {
      if (role === 'super_admin' || role === 'hse_admin') {
        await _dashLoadDeptOptions();
      }
      renderDashboardHTML(container, data);
      setTimeout(() => renderDashboardCharts(data), 80);
    }

  } catch (err) {
    console.error('Dashboard load error', err);
    container.innerHTML = `<div class="dash-empty">${T("⚠️ تعذّر تحميل الإحصائيات. تحقق من الاتصال وأعد المحاولة.")}</div>`;
  }
}

window.dashApplyQuick = function(days) {
  _dashQuickDays = days;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  _dashFromDate = from.toISOString().slice(0, 10);
  _dashToDate   = now.toISOString().slice(0, 10);
  const fromEl = document.getElementById('dashFromDate');
  const toEl   = document.getElementById('dashToDate');
  if (fromEl) fromEl.value = _dashFromDate;
  if (toEl)   toEl.value   = _dashToDate;
  document.querySelectorAll('.dash-quick-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.days) === days);
  });
  loadDashboard();
};

window.dashApplyFilters = function() {
  const fromEl = document.getElementById('dashFromDate');
  const toEl   = document.getElementById('dashToDate');
  const empEl  = document.getElementById('dashEmpFilter');
  const deptEl = document.getElementById('dashDeptFilter');
  _dashFromDate  = fromEl ? fromEl.value : '';
  _dashToDate    = toEl   ? toEl.value   : '';
  _dashEmpFilter = empEl  ? empEl.value  : '';
  _dashDeptFilter = deptEl ? deptEl.value : '';
  document.querySelectorAll('.dash-quick-btn').forEach(b => b.classList.remove('active'));
  loadDashboard();
};

async function _dashLoadDeptOptions() {
  if (_dashDeptOptions) return _dashDeptOptions;
  try {
    const res = await authFetch('/api/departments');
    if (!res.ok) return (_dashDeptOptions = []);
    const data = await res.json();
    _dashDeptOptions = data.departments || [];
  } catch (err) {
    _dashDeptOptions = [];
  }
  return _dashDeptOptions;
}

window.dashClearDeptFilter = function() {
  _dashDeptFilter = '';
  loadDashboard();
};

window.dashRefresh = function() {
  loadDashboard();
};

window.dashClearEmpFilter = function() {
  _dashEmpFilter = '';
  loadDashboard();
};

function _dashExportStatusText(status) {
  const map = {
    open: T('مفتوح'), resolved: T('محلول'), rejected: 'مرفوض',
    approved: T('موافق'), pending: T('انتظار'), active: T('نشطة'), closed: T('مغلقة/منتهية')
  };
  return map[status] || (status || '—');
}

window.exportDashboardExcel = async function() {
  const data = _dashLastData;
  if (!data) {
    showToast(T('لا توجد بيانات محمّلة للتصدير بعد'), 'error');
    return;
  }
  if (!(await ensureXlsx())) return;
  const { permits, hazards, trainings, drills, meta } = data;
  const dateStr = new Date().toISOString().split('T')[0];
  const wb = XLSX.utils.book_new();

  const roleLabel = {
    super_admin: T('مدير النظام — كل الأقسام'),
    hse_admin:   T('مشرف السلامة — كل الأقسام'),
    dept_admin:  `${T("مشرف قسم")} ${meta.scopeDept || ''}`,
    worker:      T('إحصائيات شخصية'),
  }[meta.role] || meta.role;
  const summaryRows = [
    { 'البند': T('نطاق التقرير'), 'القيمة': roleLabel },
    { 'البند': T('من تاريخ'), 'القيمة': meta.dateFrom || 'الكل' },
    { 'البند': T('إلى تاريخ'), 'القيمة': meta.dateTo || 'الكل' },
    { 'البند': T('تاريخ إنشاء التقرير'), 'القيمة': new Date(meta.generatedAt || Date.now()).toLocaleString(LOC()) },
    { 'البند': '—', 'القيمة': '—' },
    { 'البند': T('إجمالي تصاريح العمل'), 'القيمة': permits.total },
    { 'البند': T('  ↳ موافق عليها'), 'القيمة': permits.byStatus.approved },
    { 'البند': T('  ↳ قيد الانتظار'), 'القيمة': permits.byStatus.pending },
    { 'البند': T('  ↳ مرفوضة'), 'القيمة': permits.byStatus.rejected },
    { 'البند': T('إجمالي بلاغات الخطورة'), 'القيمة': hazards.total },
    { 'البند': T('  ↳ مفتوحة'), 'القيمة': hazards.byStatus.open },
    { 'البند': T('  ↳ محلولة'), 'القيمة': hazards.byStatus.resolved },
    { 'البند': T('إجمالي المحاضرات التدريبية'), 'القيمة': trainings.total },
    { 'البند': T('  ↳ إجمالي الحضور'), 'القيمة': trainings.totalAttendees },
    { 'البند': T('  ↳ إجمالي الساعات'), 'القيمة': trainings.totalHours },
    { 'البند': T('إجمالي تجارب الطوارئ'), 'القيمة': drills.total },
    { 'البند': T('  ↳ إجمالي الحضور'), 'القيمة': drills.totalAttendees },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, T('ملخص'));

  const permitRows = (permits.list || []).map(p => ({
    'النوع': p.title, 'التاريخ': p.date ? new Date(p.date).toLocaleDateString(LOC()) : '—',
    'الحالة': _dashExportStatusText(p.status)
  }));
  const wsPermits = XLSX.utils.json_to_sheet(permitRows.length ? permitRows : [{ 'لا توجد بيانات': '' }]);
  wsPermits['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsPermits, T('تصاريح العمل'));

  const hazardRows = (hazards.list || []).map(h => ({
    'الوصف': h.title, 'التاريخ': h.date ? new Date(h.date).toLocaleDateString(LOC()) : '—',
    'الحالة': _dashExportStatusText(h.status), 'القسم': h.department || ''
  }));
  const wsHazards = XLSX.utils.json_to_sheet(hazardRows.length ? hazardRows : [{ 'لا توجد بيانات': '' }]);
  wsHazards['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 15 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsHazards, T('بلاغات الخطورة'));

  const trainingRows = (trainings.list || []).map(t => ({
    'العنوان': t.title, 'التاريخ': t.date ? new Date(t.date).toLocaleDateString(LOC()) : '—',
    'عدد الساعات': t.hours, 'المدرب': t.trainer || ''
  }));
  const wsTrainings = XLSX.utils.json_to_sheet(trainingRows.length ? trainingRows : [{ 'لا توجد بيانات': '' }]);
  wsTrainings['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsTrainings, T('التدريب'));

  const drillRows = (drills.list || []).map(d => ({
    'العنوان': d.title, 'التاريخ': d.date ? new Date(d.date).toLocaleDateString(LOC()) : '—',
    'الحالة': _dashExportStatusText(d.status), 'الموقع': d.location || ''
  }));
  const wsDrills = XLSX.utils.json_to_sheet(drillRows.length ? drillRows : [{ 'لا توجد بيانات': '' }]);
  wsDrills['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 15 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsDrills, T('تجارب الطوارئ'));

  XLSX.writeFile(wb, `${T("لوحة_التحكم_")}${dateStr}.xlsx`);
};

window.exportPowerBiData = async function() {
  const dept = (typeof _dashDeptFilter === 'string' && _dashDeptFilter) ? `?dept=${encodeURIComponent(_dashDeptFilter)}` : '';
  showToast(T('جارِ تجهيز ملف البيانات والرسومات…'), 'info');

  const chartMeta = [
    ['chartPermitStatus', T('حالة تصاريح العمل')],
    ['chartPermitType', T('تصاريح العمل حسب النوع')],
    ['chartHazardSeverity', T('بلاغات الخطورة حسب الشدة')],
    ['chartMonthly', T('الاتجاه الشهري')],
    ['chartDrillStatus', T('حالة تجارب الطوارئ')],
    ['chartTrainingsMonthly', T('المحاضرات التدريبية شهريًا')],
  ];
  const charts = [];
  chartMeta.forEach(([id, title]) => {
    const canvas = document.getElementById(id);
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      try { charts.push({ title, dataUrl: canvas.toDataURL('image/png') }); } catch (e) { }
    }
  });

  try {
    const res = await authFetch(`/api/dashboard/export-powerbi${dept}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ charts }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || T('فشل إنشاء ملف البيانات'), 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${T('بيانات_لوحة_التحكم_PowerBI_')}${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`${T('نزل الملف ✓')} ${charts.length ? `(${charts.length} ${T('رسم بياني')})` : ''}`, 'success');
  } catch (e) {
    console.error('exportPowerBiData error', e);
    showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
  }
};

window.exportDashboardExcelWithCharts = async function() {
  const data = _dashLastData;
  if (!data) {
    showToast(T('لا توجد بيانات محمّلة للتصدير بعد'), 'error');
    return;
  }
  const btn = document.getElementById('dashExportChartsBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = T('<span class="btn-spinner"></span> جارِ التجهيز…'); }

  try {
    const { permits, hazards, trainings, drills, meta } = data;
    const roleLabel = {
      super_admin: T('مدير النظام — كل الأقسام'),
      hse_admin:   T('مشرف السلامة — كل الأقسام'),
      dept_admin:  `${T("مشرف قسم")} ${meta.scopeDept || ''}`,
      worker:      T('إحصائيات شخصية'),
    }[meta.role] || meta.role;

    const summaryRows = [
      { label: T('نطاق التقرير'), value: roleLabel },
      { label: T('من تاريخ'), value: meta.dateFrom || 'الكل' },
      { label: T('إلى تاريخ'), value: meta.dateTo || 'الكل' },
      { label: T('تاريخ إنشاء التقرير'), value: new Date(meta.generatedAt || Date.now()).toLocaleString(LOC()) },
      { label: T('إجمالي تصاريح العمل'), value: permits.total },
      { label: T('  ↳ موافق عليها'), value: permits.byStatus.approved },
      { label: T('  ↳ قيد الانتظار'), value: permits.byStatus.pending },
      { label: T('  ↳ مرفوضة'), value: permits.byStatus.rejected },
      { label: T('إجمالي بلاغات الخطورة'), value: hazards.total },
      { label: T('  ↳ مفتوحة'), value: hazards.byStatus.open },
      { label: T('  ↳ محلولة'), value: hazards.byStatus.resolved },
      { label: T('إجمالي المحاضرات التدريبية'), value: trainings.total },
      { label: T('  ↳ إجمالي الحضور'), value: trainings.totalAttendees },
      { label: T('إجمالي تجارب الطوارئ'), value: drills.total },
      { label: T('  ↳ إجمالي الحضور'), value: drills.totalAttendees },
    ];
    const permitRows = (permits.list || []).map(p => ([p.title, p.date ? new Date(p.date).toLocaleDateString(LOC()) : '—', _dashExportStatusText(p.status)]));
    const hazardRows = (hazards.list || []).map(h => ([h.title, h.date ? new Date(h.date).toLocaleDateString(LOC()) : '—', _dashExportStatusText(h.status), h.department || '']));
    const trainingRows = (trainings.list || []).map(t => ([t.title, t.date ? new Date(t.date).toLocaleDateString(LOC()) : '—', t.hours, t.trainer || '']));
    const drillRows = (drills.list || []).map(d => ([d.title, d.date ? new Date(d.date).toLocaleDateString(LOC()) : '—', _dashExportStatusText(d.status), d.location || '']));

    const chartMeta = [
      ['chartPermitStatus', T('حالة تصاريح العمل')],
      ['chartPermitType', T('تصاريح العمل حسب النوع')],
      ['chartHazardSeverity', T('بلاغات الخطورة حسب الشدة')],
      ['chartMonthly', T('الاتجاه الشهري')],
      ['chartDrillStatus', T('حالة تجارب الطوارئ')],
      ['chartTrainingsMonthly', T('المحاضرات التدريبية شهريًا')],
    ];
    const charts = [];
    chartMeta.forEach(([id, title]) => {
      const canvas = document.getElementById(id);
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        try { charts.push({ title, dataUrl: canvas.toDataURL('image/png') }); } catch (e) { }
      }
    });

    if (charts.length === 0) {
      showToast(T('لا توجد رسوم بيانية ظاهرة حاليًا على الشاشة للتصدير'), 'error');
      return;
    }

    const res = await authFetch('/api/dashboard/export-excel-charts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summaryRows, permitRows, hazardRows, trainingRows, drillRows, charts })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || T('فشل إنشاء ملف Excel'), 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${T("لوحة_التحكم_بالرسوم_")}${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(T('تم تصدير الملف بنجاح ✓'), 'success');
  } catch (e) {
    console.error('exportDashboardExcelWithCharts error', e);
    showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
};
