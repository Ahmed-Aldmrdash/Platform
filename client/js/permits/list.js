// Supervisor permit list: filters, server-side paging, status helpers and card rendering.

function renderFilters(){
  const opts = ['الكل','بانتظار أدمن القسم','بانتظار السلامة والصحة المهنية','موافق عليه','مرفوض','مغلق','🗑️ المحذوفات'];
  document.getElementById('filters').innerHTML = opts.map(o=>
    `<div class="chip ${o===currentFilter?'active':''}" onclick="setFilter(${jsArg(o)})">${T(o)}</div>`
  ).join('');
}
function renderTypeFilters(){
  const opts = ['الكل', ...Object.keys(PERMIT_TYPES).map(k=>PERMIT_TYPES[k].label)];
  document.getElementById('typeFilters').innerHTML = opts.map(o=>
    `<div class="chip ${o===currentTypeFilter?'active':''}" onclick="setTypeFilter(${jsArg(o)})">${T(o)}</div>`
  ).join('');
}
function setFilter(f){ currentFilter = f; renderFilters(); loadPermitsPage(); }
function setTypeFilter(f){ currentTypeFilter = f; renderTypeFilters(); loadPermitsPage(); }

async function renderPmDeptFilters(){
  const dArea = document.getElementById('pmDeptFilters');
  const dToolbar = document.getElementById('pmDeptToolbar');
  if (!dArea || !dToolbar) return;
  if (currentUserRole !== 'dept_admin' && currentUserRole !== 'maint_admin') {
    dToolbar.style.display = 'flex';
    if (!(dArea.dataset.built === '1' && document.activeElement && document.activeElement.id === 'pmDeptFilterInput')) {
      const realDepts = await loadRealDepartments();
      window._pmRealDepts = realDepts;
      const currentVal = currentPmDeptFilter === 'الكل' ? '' : currentPmDeptFilter;
      dArea.innerHTML = `
        <input type="text" id="pmDeptFilterInput" class="dept-filter-input" list="pmDeptDatalist"
          placeholder="${T("🏢 اختر أو اكتب اسم القسم...")}" value="${escapeAttr(currentVal)}"
          oninput="onPmDeptFilterInput(this.value)" autocomplete="off"
          style="min-width:220px;flex:1;max-width:320px;">
        <datalist id="pmDeptDatalist">
          ${realDepts.map(d => `<option value="${escapeAttr(d)}"></option>`).join('')}
        </datalist>
        ${currentPmDeptFilter !== 'الكل' ? `<div class="chip active" onclick="setPmDeptFilterFromInput('')">${T("✕ إلغاء فلتر القسم")}</div>` : ''}
      `;
      dArea.dataset.built = '1';
    }
  } else {
    dToolbar.style.display = 'none';
  }
}
function setPmDeptFilter(d){ currentPmDeptFilter = d; renderPmDeptFilters(); loadPermitsPage(); }
function setPmDeptFilterFromInput(v){
  currentPmDeptFilter = (v && v.trim()) ? v.trim() : 'الكل';
  loadPermitsPage();
}
window.onPmDeptFilterInput = window.debounce(function(v) {
  setPmDeptFilterFromInput(v);
}, 300);

function renderPmYearFilters(){
  const yArea = document.getElementById('pmYearFilters');
  if (!yArea) return;
  const years = ['الكل', ...FILTER_YEARS];
  yArea.innerHTML = years.map(y =>
    `<div class="chip ${currentPmYearFilter===y?'active':''}" onclick="setPmYearFilter(${jsArg(y)})">${T(y)}</div>`
  ).join('');
}
function setPmYearFilter(y){ currentPmYearFilter = y; renderPmYearFilters(); loadPermitsPage(); }

function applyPermitAdvancedFilters(list) {
  const fWorker = document.getElementById('filter_pm_worker')?.value?.trim().toLowerCase();
  const fSup    = document.getElementById('filter_pm_sup')?.value?.trim().toLowerCase();
  const fFrom   = document.getElementById('filter_pm_dateFrom')?.value;
  const fTo     = document.getElementById('filter_pm_dateTo')?.value;

  if (!fWorker && !fSup && !fFrom && !fTo) return list;

  return list.filter(p => {
    if (fWorker && !String(p.workerName || '').toLowerCase().includes(fWorker)) return false;
    if (fSup) {
      const supNames = [p.safetyOfficerName, p.areaManagerName, p.areaHeadReviewedBy, p.reviewedBy]
        .filter(Boolean).join(' ').toLowerCase();
      if (!supNames.includes(fSup)) return false;
    }
    if ((fFrom || fTo) && p.date) {
      if (fFrom && p.date < fFrom) return false;
      if (fTo && p.date > fTo) return false;
    } else if (fFrom || fTo) {
      return false;
    }
    return true;
  });
}

async function ensurePermitLoaded(id) {
  if (!id || permitsCache.some(p => String(p.id) === String(id))) return;
  try {
    const res = await authFetch(`/api/permits?q=${encodeURIComponent(id)}&limit=1`);
    if (!res.ok) return;
    const data = await res.json();
    const hit = (data.permits || []).find(p => String(p.id) === String(id));
    if (hit) { permitsCache = [hit, ...permitsCache]; renderList(); }
  } catch (e) { }
}

window.applyPermitFilters = window.debounce(function() {
  loadPermitsPage();
}, 300);

window.clearPermitFilters = function() {
  const ids = ['filter_pm_worker', 'filter_pm_sup', 'filter_pm_dateFrom', 'filter_pm_dateTo'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  loadPermitsPage();
};

const PM_STATUS_KEYS = {
  'بانتظار أدمن القسم': 'pending,pending_dept,pending_area_head',
  'بانتظار السلامة والصحة المهنية': 'pending_hse,approved_area',
  'موافق عليه': 'approved',
  'معتمد': 'approved',
  'مرفوض': 'rejected',
  'مغلق': 'closed',
  'مغلق / مكتمل': 'closed',
};

function pmQueryParams({ offset = 0 } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(PM_PAGE_SIZE));
  params.set('offset', String(offset));
  if (currentFilter === '🗑️ المحذوفات') params.set('trash', '1');
  else if (PM_STATUS_KEYS[currentFilter]) params.set('status', PM_STATUS_KEYS[currentFilter]);
  if (currentTypeFilter !== 'الكل') {
    const key = Object.keys(PERMIT_TYPES).find(k => PERMIT_TYPES[k].label === currentTypeFilter);
    if (key) params.set('typeKey', key);
  }
  if (currentPmDeptFilter !== 'الكل') params.set('department', currentPmDeptFilter);
  if (currentPmYearFilter !== 'الكل') params.set('year', currentPmYearFilter);
  const v = id => (document.getElementById(id) || {}).value || '';
  if (v('filter_pm_worker').trim()) params.set('worker', v('filter_pm_worker').trim());
  if (v('filter_pm_sup').trim()) params.set('supervisor', v('filter_pm_sup').trim());
  if (v('filter_pm_dateFrom')) params.set('from', v('filter_pm_dateFrom'));
  if (v('filter_pm_dateTo')) params.set('to', v('filter_pm_dateTo'));
  return params;
}

let _pmLoadSeq = 0;
window._pmTotal = 0;

async function loadPermitsPage({ append = false, silent = false } = {}) {
  const seq = ++_pmLoadSeq;
  const container = document.getElementById('supList');
  if (!append && !silent && container) container.innerHTML = T('<div class="loading">جارِ التحميل…</div>');
  const offset = append ? permitsCache.length : 0;
  try {
    const res = await authFetch(`/api/permits?${pmQueryParams({ offset }).toString()}`);
    if (seq !== _pmLoadSeq) return;
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    permitsCache = append ? permitsCache.concat(data.permits || []) : (data.permits || []);
    window._pmTotal = Number(data.total) || 0;
    renderList();
  } catch (e) {
    if (seq !== _pmLoadSeq) return;
    if (!silent && container) {
      container.innerHTML = `<div class="empty" style="color:var(--danger)"><div class="icon">⚠️</div>${T('تعذّر تحميل التصاريح — حاول تاني')}</div>`;
    }
  }
}

async function renderSupervisor(){
  renderFilters();
  renderTypeFilters();
  await renderPmDeptFilters();
  renderPmYearFilters();
  permitsCache = [];
  await loadPermitsPage();
}

async function pollPermitsForSupervisor(){
  if(!isLoggedIn) return;
  // Redrawing would wipe what the reviewer is typing in a card (names, reject reason); try again next tick.
  const active = document.activeElement;
  const listEl = document.getElementById('supList');
  if (active && listEl && listEl.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  try {
    const res = await authFetch(`/api/permits?${pmQueryParams({ offset: 0 }).toString()}`);
    if (!res.ok) return;
    const data = await res.json();
    const sig = JSON.stringify([data.total, (data.permits || []).map(p => `${p.id}:${p.status}`)]);
    if (sig === window._pmPollSig) return;
    window._pmPollSig = sig;
    if (permitsCache.length > PM_PAGE_SIZE) {
      const rest = permitsCache.slice(PM_PAGE_SIZE);
      permitsCache = (data.permits || []).concat(rest);
    } else {
      permitsCache = data.permits || [];
    }
    window._pmTotal = Number(data.total) || 0;
    renderList();
  } catch (e) { }
}

const statusTranslations = {
  'pending': 'قيد الانتظار',
  'pending_dept': 'بانتظار أدمن القسم',
  'pending_hse': 'بانتظار السلامة والصحة المهنية',
  'approved_area': 'معتمد من مدير المنطقة',
  'approved': 'معتمد',
  'rejected': 'مرفوض',
  'rejected_area': 'مرفوض من رئيس القسم',
  'rejected_high_management': 'مرفوض من الإدارة العليا',
  'completed': 'مغلق / مكتمل'
};

function getStatusBadgeArabic(status) {
  const key = String(status || '').toLowerCase().trim();
  if (key.startsWith('closed')) return T('مغلق / مكتمل');
  return T(statusTranslations[key] || status);
}

function statusLabel(raw){
  return getStatusBadgeArabic(raw);
}
function closureLabel(c){
  if(!c) return '';
  if(c.type==='safe') return T('اكتمل العمل بأمان');
  if(c.type==='incomplete') return T('لم يكتمل العمل');
  if(c.type==='forced') return T('إغلاق جبري');
  return '';
}
function formatTime12(time24) {
  if (!time24 || !time24.includes(':')) return time24 || '—';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? T('م') : T('ص');
  h = h % 12;
  h = h ? h : 12;
  return `${h.toString().padStart(2, '0')}:${mStr} ${ampm}`;
}
function statusFilterMatch(s){
  if(currentFilter==='الكل') return true;
  if(currentFilter==='مرفوض' && s && s.startsWith('rejected')) return true;
  return statusLabel(s) === currentFilter;
}
function typeFilterMatch(p){
  if(currentTypeFilter==='الكل') return true;
  return p.typeLabel === currentTypeFilter;
}

function permitApprovalRank(p) {
  const s = String((p && p.status) || 'pending').toLowerCase().trim();
  if (s.startsWith('rejected')) return 3;
  if (s.startsWith('closed') || s === 'completed') return 2;
  if (s === 'approved') return 1;
  return 0;
}

// The expandable part of a permit card (checklist, risks and extra fields), built on first open.
function permitDetailsHtml(p) {
  const checklistBySection = {};
  (p.checklist||[]).forEach(c => {
    const sec = c.section || T('بنود عامة');
    if (!checklistBySection[sec]) checklistBySection[sec] = [];
    checklistBySection[sec].push(c);
  });
  const checklistHtml = Object.entries(checklistBySection).map(([sec, items]) => `
      <div style="font-size:11.5px;font-weight:800;color:var(--steel);letter-spacing:0.5px;padding:6px 0 3px;border-bottom:1px solid var(--paper-line);margin-bottom:3px;">${escapeHtml(T(sec))}</div>
      ${items.map(c=>`
      <div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--paper-line);font-size:12.5px;">
        <span>${escapeHtml(T(c.question))}</span>
        <span style="font-weight:700;color:${c.answer==='لا'?'var(--danger)':c.answer==='نعم'?'var(--success)':'var(--muted)'};white-space:nowrap;">${escapeHtml(T(c.answer))}</span>
      </div>`).join('')}
    `).join('');
  const risksHtml = (p.risks||[]).map(r=>`
      <div class="risk-summary">
        <b>${escapeHtml(r.source)}</b> — L${escapeHtml(String(r.l))}×S${escapeHtml(String(r.s))} = ${escapeHtml(String(r.score))}
        ${r.control ? `<br><span style="color:var(--muted);">${escapeHtml(r.control)}</span>` : ''}
      </div>
    `).join('') || `<div class="risk-summary" style="color:var(--muted);">${T("لا توجد مخاطر مسجلة")}</div>`;

  return `
        <div class="section-title" style="margin-top:14px;">${T("قائمة التحقق")}</div>
        ${checklistHtml}
        ${p.checklistNote ? `<div class="review-note">${T("ملاحظة:")} ${escapeHtml(p.checklistNote)}</div>` : ''}
        <div class="section-title">${T("تقييم المخاطر")}</div>
        ${risksHtml}
        ${p.workersNames ? `<div class="section-title">${T("القائمون بالعمل")}</div><div class="desc">${escapeHtml(p.workersNames)}</div>` : ''}
        ${p.equipment ? `<div class="meta-grid" style="margin-top:8px;"><div><span>${T("المعدة/الماكينة")}</span>${escapeHtml(p.equipment)}</div></div>` : ''}
        ${(p.tools && (Array.isArray(p.tools) ? p.tools.length > 0 : p.tools)) ? `
          <div class="section-title" style="margin-top:10px;">${T("الأدوات والعدد")}</div>
          <div class="tools-display">${Array.isArray(p.tools) ? p.tools.map(t=>`<span class="tool-tag">${escapeHtml(t)}</span>`).join('') : escapeHtml(p.tools)}</div>` : ''}
        ${p.previousPermitNo ? `<div class="reviewed-by">${T("رقم طلب سابق:")} ${escapeHtml(p.previousPermitNo)}</div>`:''}
        ${p.requesterPhone ? `<div class="reviewed-by">${T("تليفون:")} ${escapeHtml(p.requesterPhone)}</div>`:''}
        <div class="doc-control-footer">SE-07-F02 &nbsp;|&nbsp; VER.NO.: 01 &nbsp;|&nbsp; VER. DATE: 01/01/2025</div>
  `;
}

const PM_PAGE_SIZE = 50;
function renderList(){
  const list = permitsCache;
  const currentRoleKey = getRoleKey(currentUserRole);

  const pmCountEl = document.getElementById('pmFilterCount');
  const total = Number(window._pmTotal) || list.length;
  if (pmCountEl) pmCountEl.textContent = `${T("عدد النتائج:")} ${total}`;

  const container = document.getElementById('supList');

  if(list.length === 0){
    container.innerHTML = `<div class="empty"><div class="icon">🗂️</div>${T("لا توجد طلبات مطابقة حاليًا")}</div>`;
    return;
  }

  const visibleList = list;
  const moreCount = Math.max(0, total - visibleList.length);
  const moreHtml = moreCount > 0
    ? `<div class="pm-more"><button type="button" class="btn btn-secondary" onclick="pmShowMore()">${T('عرض المزيد')} (${moreCount} ${T('متبقي')})</button></div>`
    : '';

  container.innerHTML = visibleList.map(p => {
    const failedChecks = (p.checklist||[]).filter(c=>c.answer==='لا').length;
    const detailsOpen = _pmOpenDetails.has(String(p.id));

    const deletedBy = (typeof p.deletedBy === 'object' && p.deletedBy !== null) ? p.deletedBy : {};
    const isTrashedForMe = deletedBy[currentRoleKey] === true;

    const normalizedStatus = p.status ? String(p.status).toLowerCase() : '';
    let statusBadge = '';
    if (normalizedStatus === 'rejected_area' || normalizedStatus === 'rejected_high_management' || normalizedStatus === 'rejected' || normalizedStatus.startsWith('reject')) {
       statusBadge = `<span class="stamp rejected">${escapeHtml(getStatusBadgeArabic(p.status))}</span>`;
    } else if (normalizedStatus === 'approved' || normalizedStatus === 'approved_area' || normalizedStatus.startsWith('closed')) {
       statusBadge = `<span class="badge badge-approved">${escapeHtml(getStatusBadgeArabic(p.status))}${normalizedStatus.startsWith('closed') ? ' — '+closureLabel(p.closure) : ''}</span>`;
    } else {
       statusBadge = `<span class="stamp ${escapeHtml(p.status)}">${escapeHtml(getStatusBadgeArabic(p.status))}</span>`;
    }

    return `
    <div class="sup-card ${isTrashedForMe ? 'deleted' : ''}">
      <div class="sup-top">
        <div>
          <div class="worker"><span class="type-pill">${escapeHtml(T(p.typeLabel))}</span>${escapeHtml(p.workerName)}</div>
          <div class="tnum">${escapeHtml(p.id)} · ${escapeHtml(p.date||'')} ${T("· وردية")} ${escapeHtml(p.shift||'')}</div>
        </div>
        ${statusBadge}
      </div>
      <div class="meta-grid">
        <div><span>${T("القسم")}</span>${escapeHtml(p.department)||'—'}</div>
        <div><span>${T("مكان العمل")}</span>${escapeHtml(p.location)||'—'}</div>
        <div style="white-space: normal;"><span>${T("الوقت")}</span>${escapeHtml(formatTime12(p.timeFrom))} → ${escapeHtml(formatTime12(p.timeTo))}</div>
        <div><span>${T("الصفة")}</span>${escapeHtml(T(p.requesterKind))||'—'}</div>
        <div>
          <span>${T("الكود الوظيفي")}</span>
          ${p.employeeId ? escapeHtml(p.employeeId) : T('<span style="color:var(--danger);font-weight:700;">غير مسجل ⚠</span>')}
        </div>
      </div>
      ${!p.employeeId ? `
      <div class="row2 empcode-add-box" style="margin-top:8px;">
        <div class="field">
          <input id="empcode-${escapeHtml(p.id)}" type="text" placeholder="${T("أدخل الكود الوظيفي (")}${escapeHtml(p.workerName || T('صاحب الطلب'))})" style="direction:ltr;font-size:12px;padding:6px;">
        </div>
        <button class="act-btn approve" style="align-self:flex-end;" onclick="savePermitEmployeeCode(${jsArg(p.id)})">${T("💾 حفظ الكود")}</button>
      </div>
      ` : ''}
      <div class="desc"><strong>${T("وصف العملية:")}</strong> ${escapeHtml(p.description)}</div>
      ${failedChecks>0 ? `<div class="checklist-summary"><b>⚠ ${failedChecks} ${T("بند غير مستوفٍ في قائمة التحقق")}</b></div>` : `<div class="checklist-summary">${T("✓ كل بنود قائمة التحقق مستوفاة أو لا تنطبق")}</div>`}

      <span class="details-toggle" onclick="toggleDetails(${jsArg(p.id)})">${T("عرض كل التفاصيل (قائمة التحقق + المخاطر) ⌄")}</span>
      <button class="btn btn-secondary btn-sm" type="button" style="margin-inline-start:10px;" onclick="openPrintWithAuth(${jsArg('/print/permit/' + encodeURIComponent(p.id))})">${T("🖨️ طباعة")}</button>
      <div class="full-details${detailsOpen ? ' show' : ''}" id="details-${escapeHtml(p.id)}"${detailsOpen ? ' data-built="1"' : ''}>${detailsOpen ? permitDetailsHtml(p) : ''}</div>

      ${(p.status === 'pending' || p.status === 'pending_dept') ? `
        ${(((currentUserRole === 'dept_admin' || currentUserRole === 'maint_admin') && currentUserDept === p.department)) || currentUserRole === 'super_admin' ? `
          <div class="row2" style="margin-top:12px;">
            <div class="field"><label>${T("اسم مدير المنطقة")}</label><input id="area-${escapeHtml(p.id)}" type="text" placeholder="${T("اختياري")}"></div>
          </div>
          <div class="actions">
            <button class="act-btn approve" onclick="approvePermit(${jsArg(p.id)})">${T("✓ موافقة أدمن القسم")}</button>
            <button class="act-btn reject" onclick="toggleNote(${jsArg(p.id)})">${T("✗ رفض")}</button>
          </div>
          <div class="note-box" id="note-${escapeHtml(p.id)}">
            <textarea id="notetext-${escapeHtml(p.id)}" placeholder="${T("سبب الرفض (اختياري)")}"></textarea>
            <button onclick="rejectPermit(${jsArg(p.id)})">${T("تأكيد الرفض")}</button>
          </div>
        ` : `
          <div class="review-note">${T("⏳ الطلب بانتظار موافقة أدمن قسم")} ${escapeHtml(p.department)}</div>
        `}
      ` : ''}

      ${p.status === 'pending_hse' ? `
        <div class="reviewed-by">${T("موافقة مبدئية من:")} ${escapeHtml(p.areaHeadReviewedBy)||T('أدمن القسم')} — ${p.areaHeadReviewedAt ? new Date(p.areaHeadReviewedAt).toLocaleString(LOC()) : ''}</div>
        ${(currentUserRole === 'hse_admin' || currentUserRole === 'super_admin') ? `
          <div class="row2" style="margin-top:12px;">
            <div class="field"><label>${T("اسم مشرف السلامة")}</label><input id="safety-${escapeHtml(p.id)}" type="text" placeholder="${T("اختياري")}"></div>
          </div>
          <div class="actions">
            <button class="act-btn approve" onclick="approvePermit(${jsArg(p.id)})">${T("✓ اعتماد السلامة والصحة المهنية (HSE)")}</button>
            <button class="act-btn reject" onclick="toggleNote(${jsArg(p.id)})">${T("✗ رفض")}</button>
          </div>
          <div class="note-box" id="note-${escapeHtml(p.id)}">
            <textarea id="notetext-${escapeHtml(p.id)}" placeholder="${T("سبب الرفض (اختياري)")}"></textarea>
            <button onclick="rejectPermit(${jsArg(p.id)})">${T("تأكيد الرفض")}</button>
          </div>
        ` : `
          <div class="review-note">${T("⏳ الطلب بانتظار اعتماد السلامة والصحة المهنية (HSE)")}</div>
        `}
      ` : ''}

      ${p.status === 'approved' ? `
        ${p.areaHeadReviewedBy ? `<div class="reviewed-by">${T("موافقة رئيس منطقة:")} ${escapeHtml(p.areaHeadReviewedBy)} — ${p.areaHeadReviewedAt ? new Date(p.areaHeadReviewedAt).toLocaleString(LOC()) : ''}</div>` : ''}
        <div class="reviewed-by">${T("اعتمدته الإدارة:")} ${escapeHtml(p.reviewedBy)||T('الإدارة')} — ${p.reviewedAt ? new Date(p.reviewedAt).toLocaleString(LOC()) : ''}</div>
        <div class="review-note" style="background-color: var(--card-bg); border: 1px dashed var(--success);">
          ${T("🔒 الطلب معتمد ومفتوح. يمكن للموظف إغلاقه من حسابه.")}
        </div>
      ` : ''}

      ${p.status === 'rejected' ? `
        <div class="reviewed-by">${T("رفضه:")} ${escapeHtml(p.reviewedBy)||T('المشرف')} — ${p.reviewedAt ? new Date(p.reviewedAt).toLocaleString(LOC()) : ''}</div>
        ${p.reviewNote ? `<div class="review-note">${T("سبب الرفض:")} ${escapeHtml(p.reviewNote)}</div>` : ''}
      ` : ''}

      ${p.status.startsWith('closed') ? `
        <div class="reviewed-by">${T("اعتمدته الإدارة:")} ${escapeHtml(p.reviewedBy)||T('الإدارة')}</div>
        <div class="reviewed-by">${T("حالة الإغلاق:")} ${closureLabel(p.closure)} — ${p.closure && p.closure.time ? new Date(p.closure.time).toLocaleString(LOC()) : ''}</div>
        ${p.closure && p.closure.closedBy ? `<div class="reviewed-by">${T("أغلقه:")} ${escapeHtml(p.closure.closedBy.includes('(worker)') ? (p.workerName || p.applicantName || p.employeeName || p.closure.closedBy) : p.closure.closedBy)}</div>` : ''}
        ${p.closure && p.closure.reason ? `<div class="review-note">${T("السبب:")} ${escapeHtml(p.closure.reason)}</div>` : ''}
      ` : ''}
      ${currentFilter === '🗑️ المحذوفات' ? `
        <div style="margin-top:12px; border-top:1px solid var(--paper-line); padding-top:10px; display: flex; flex-direction: column; gap: 8px;">
          ${(currentUserRole === 'super_admin' || p.deletedByUsername === currentUsername || p.lastDeletedByUsername === currentUsername) ? `
          <div style="display: flex; gap: 8px;">
            <button class="act-btn" style="flex:1; background:var(--success); color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;" onclick="restorePermit(${jsArg(p.id)})">${T("🔄 استرجاع")}</button>
            <button class="act-btn" style="flex:1; background:var(--danger); color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;" onclick="hardDeletePermit(${jsArg(p.id)})">${T("❌ حذف نهائي")}</button>
          </div>
          ` : ''}
          ${(p.lastDeletedByUsername || p.deletedByUsername) ? `<div style="font-size:12px; color:var(--danger); margin-top:4px; font-weight:bold;">${T("حُذف بواسطة:")} ${escapeHtml(p.lastDeletedByUsername || p.deletedByUsername || T('المشرف'))} ${p.deleteReason ? `${T("| السبب:")} ${escapeHtml(p.deleteReason)}` : ''}</div>` : ''}
        </div>
      ` : ''}
      ${currentFilter !== '🗑️ المحذوفات' && (currentUserRole === 'super_admin' || currentUserRole === 'hse_admin' || currentUserRole === 'dept_admin' || currentUserRole === 'maint_admin') ? `
        <div style="margin-top:12px; text-align:left;">
          <button class="um-btn del" onclick="openDeletePermitModal(${jsArg(p.id)})">${T("🗑️ حذف")}</button>
        </div>
      ` : ''}
    </div>
  `;}).join('') + moreHtml;
}
