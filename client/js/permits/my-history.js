// Worker's own permit history tab with status filters and polling.

const MY_HISTORY_FILTERS = ['الكل', 'بانتظار أدمن القسم', 'بانتظار السلامة والصحة المهنية', 'موافق عليه', 'مرفوض', 'مغلق'];

function myHistoryFilterMatch(p){
  if(myHistoryFilter === 'الكل') return true;
  if(myHistoryFilter === 'بانتظار أدمن القسم') return p.status === 'pending' || p.status === 'pending_dept' || p.status === 'pending_area_head';
  if(myHistoryFilter === 'بانتظار السلامة والصحة المهنية') return p.status === 'pending_hse';
  if(myHistoryFilter === 'موافق عليه') return p.status === 'approved';
  if(myHistoryFilter === 'مرفوض') return p.status === 'rejected' || p.status === 'rejected_area' || p.status === 'rejected_high_management';
  if(myHistoryFilter === 'مغلق') return p.status && p.status.startsWith('closed');
  return true;
}

function setMyHistoryFilter(f){
  myHistoryFilter = f;
  renderMyHistory(true);
}

async function renderMyHistory(isSilent = false){
  if(!currentEmployee){
    const list = document.getElementById('myHistoryList');
    if(list) list.innerHTML = `<div class="empty"><div class="icon">🔒</div>${T("سجّل دخولك أولاً لعرض سجل طلباتك")}</div>`;
    return;
  }

  const filtersEl = document.getElementById('myHistoryFilters');
  if(filtersEl){
    filtersEl.innerHTML = MY_HISTORY_FILTERS.map(f =>
      `<button class="mh-filter-btn ${f === myHistoryFilter ? 'active' : ''}" onclick="setMyHistoryFilter(${jsArg(f)})">${T(f)}</button>`
    ).join('');
  }

  const subEl = document.getElementById('myHistorySub');
  if(subEl) subEl.textContent = `${currentEmployee.name} · ${currentEmployee.empCode} · ${currentEmployee.department || ''}`;

  const listEl = document.getElementById('myHistoryList');
  if(!isSilent && listEl) listEl.innerHTML = T('<div class="loading">جارِ تحميل سجلك…</div>');

  const res = await apiGet('work-permits');
  const raw = res && res.value ? res.value : '[]';
  lastMyHistoryRaw = raw;
  const all = JSON.parse(raw);

  const myPermits = all
    .filter(p => p.employeeId && p.employeeId.toLowerCase() === currentEmployee.empCode.toLowerCase())
    .filter(p => {
      const deletedBy = (typeof p.deletedBy === 'object' && p.deletedBy !== null) ? p.deletedBy : {};
      const deletedByWorker = deletedBy.worker !== undefined ? deletedBy.worker : !!p.deleted;
      return !deletedByWorker;
    })
    .filter(p => myHistoryFilterMatch(p))
    .reverse();

  if(!listEl) return;

  if(myPermits.length === 0){
    listEl.innerHTML = `<div class="empty"><div class="icon">📂</div>${T("لا توجد طلبات")} ${myHistoryFilter !== 'الكل' ? T('بهذا الفلتر') : T('بعد')}</div>`;
    return;
  }

  listEl.innerHTML = myPermits.map(p => {
    const st = p.status ? String(p.status).toLowerCase() : 'pending';
    let stampClass = st.startsWith('closed') ? 'approved' : st;
    if (st.startsWith('rejected')) stampClass = 'rejected';
    const stampText = getStatusBadgeArabic(st) + (st.startsWith('closed') ? ' — ' + closureLabel(p.closure) : '');
    return `
    <div class="permit-history-card">
      <div class="phc-top">
        <div>
          <div class="phc-type-pill">${escapeHtml(T(p.typeLabel || ''))}</div>
          <div class="phc-id">${escapeHtml(p.id)}</div>
          <div class="phc-date">${escapeHtml(p.date || '')} ${T("· وردية")} ${escapeHtml(p.shift || '')}</div>
        </div>
        <span class="stamp ${escapeHtml(stampClass)}">${escapeHtml(stampText)}</span>
      </div>
      <div class="phc-meta">
        <div><span>${T("مكان العمل")}</span>${escapeHtml(p.location || '—')}</div>
        <div><span>${T("القسم")}</span>${escapeHtml(p.department || '—')}</div>
      </div>
      <div class="phc-desc">${escapeHtml(p.description || '')}</div>
      ${(st === 'pending' || st === 'pending_dept') ? `<div class="phc-msg pending">${T("⏳ بانتظار موافقة أدمن القسم")}</div>` : ''}
      ${st === 'pending_hse' ? `<div class="phc-msg pending">${T("✅ تمت موافقة القسم (بانتظار اعتماد السلامة والصحة المهنية)")}</div>` : ''}
      ${st === 'approved' ? `
        <div class="phc-msg approved">${T("🟢 تم الاعتماد النهائي للطلب — يمكنك الإغلاق بعد الانتهاء")}</div>
        <div class="closure-box u-mt-2">
          <div class="field"><input class="u-fs-xs u-p-2" id="myhistory-closereason-${escapeHtml(p.id)}" type="text" placeholder="${T("سبب عدم الاكتمال أو الإغلاق الجبري (إن وجد)")}"></div>
          <div class="closure-actions btn-row">
            <button class="btn btn-success btn-sm" onclick="workerClosePermit(${jsArg(p.id)},'safe')">${T("✓ اكتمل بأمان")}</button>
            <button class="btn btn-warning btn-sm" onclick="workerClosePermit(${jsArg(p.id)},'incomplete')">${T("لم يكتمل")}</button>
            <button class="btn btn-danger btn-sm" onclick="workerClosePermit(${jsArg(p.id)},'forced')">${T("🚫 إغلاق جبري")}</button>
          </div>
        </div>
      ` : ''}
      ${st === 'rejected' ? `<div class="phc-msg rejected">${T("❌ تم رفض الطلب")}${p.reviewNote ? T(' — السبب: ') + escapeHtml(p.reviewNote) : ''}</div>` : ''}
      ${st.startsWith('closed') ? `<div class="phc-msg muted">${T("🔒 مغلق:")} ${closureLabel(p.closure)}${p.closure && p.closure.reason ? ' — ' + escapeHtml(p.closure.reason) : ''}</div>` : ''}
      <div class="phc-submitted">${T("أرسل")} ${p.submittedAt ? new Date(p.submittedAt).toLocaleString(LOC()) : ''}</div>
    </div>
    `;
  }).join('');
}

async function pollMyHistory(){
  const view = document.getElementById('viewMyHistory');
  if(!view || view.style.display === 'none') return;
  if(!currentEmployee) return;
  const res = await apiGet('work-permits');
  const raw = res && res.value ? res.value : '[]';
  if(raw !== lastMyHistoryRaw){
    renderMyHistory(true);
  }
}
