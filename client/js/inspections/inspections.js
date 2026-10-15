// Monthly inspections: category picker, sections, item registry, monthly records and legacy Excel import.

const ARABIC_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

window.inspState = {
  view: 'category',
  category: null,
  sectionId: null,
  sectionName: '',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  filters: { department: '', status: '', q: '' }
};
var inspState = window.inspState;

function openAppModal(html) {
  closeAppModal();
  const overlay = document.createElement('div');
  overlay.id = 'appModalOverlay';
  overlay.className = 'app-modal-overlay';
  overlay.innerHTML = `<div class="app-modal-card">
      <button class="app-modal-close" type="button" onclick="closeAppModal()" title="${T('إغلاق')}" aria-label="${T('إغلاق')}">✕</button>
      ${html}
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAppModal(); });
  document.body.appendChild(overlay);
}
function closeAppModal() {
  const el = document.getElementById('appModalOverlay');
  if (el) el.remove();
}

function renderInspections() {
  const root = document.getElementById('inspectionsContent');
  if (!root) return;
  if (inspState.view === 'sections' && inspState.category) {
    renderInspectionSections();
  } else if (inspState.view === 'detail' && inspState.sectionId) {
    renderInspectionSectionDetail();
  } else {
    renderInspectionCategoryPicker();
  }
}

function renderInspectionCategoryPicker() {
  const root = document.getElementById('inspectionsContent');
  if (!root) return;
  root.innerHTML = `
    <div class="insp-hero">
      <div class="insp-hero-title">${T("🦺 الفحص الشهري")}</div>
      <div class="insp-hero-sub">${T("اختر برنامج الفحص للبدء — سلامة المعدات وحواجز الحماية بالمصنع")}</div>
    </div>
    <div class="insp-category-grid">
      <div class="insp-category-card" onclick="inspSelectCategory('P1')">
        <div class="insp-cat-icon">P1</div>
        <div class="insp-cat-title">${T("برنامج P1")}</div>
        <div class="insp-cat-sub">${T("33 بند فحص")}</div>
      </div>
      <div class="insp-category-card" onclick="inspSelectCategory('P2')">
        <div class="insp-cat-icon">P2</div>
        <div class="insp-cat-title">${T("برنامج P2")}</div>
        <div class="insp-cat-sub">${T("27 بند فحص")}</div>
      </div>
    </div>
  `;
}

function inspSelectCategory(cat) {
  inspState.category = cat;
  inspState.view = 'sections';
  renderInspections();
}

function inspBackToCategory() {
  inspState.view = 'category';
  inspState.category = null;
  renderInspections();
}

function inspYearMonthPickerHtml() {
  const years = [];
  const curY = new Date().getFullYear();
  for (let y = curY - 2; y <= curY + 1; y++) years.push(y);
  return `
    <select id="inspYear" class="insp-status-select" onchange="inspOnYearMonthChange()">
      ${years.map(y => `<option value="${y}" ${y === inspState.year ? 'selected' : ''}>${y}</option>`).join('')}
    </select>
    <select id="inspMonth" class="insp-status-select" onchange="inspOnYearMonthChange()">
      ${ARABIC_MONTHS.map((m,i) => `<option value="${i+1}" ${i+1===inspState.month ? 'selected':''}>${T(m)}</option>`).join('')}
    </select>
  `;
}

function inspOnYearMonthChange() {
  const y = document.getElementById('inspYear');
  const m = document.getElementById('inspMonth');
  if (y) inspState.year = parseInt(y.value, 10);
  if (m) inspState.month = parseInt(m.value, 10);
  renderInspections();
}

async function renderInspectionSections() {
  const root = document.getElementById('inspectionsContent');
  if (!root) return;
  root.innerHTML = `
    <div class="insp-toolbar">
      <div class="insp-toolbar-left">
        <button class="btn btn-secondary btn-sm" type="button" onclick="inspBackToCategory()">${T("→ رجوع")}</button>
        <div class="insp-breadcrumb">${T("الفحص الشهري /")} <b>${T("برنامج")} ${escapeHtml(inspState.category)}</b></div>
      </div>
      <div class="insp-toolbar-left">
        ${inspYearMonthPickerHtml()}
        <button class="btn btn-export btn-sm" type="button" onclick="document.getElementById('inspBulkLegacyInput').click()" title="${T('اختار كل ملفات البرنامج ده مرة واحدة — كل ملف هيروح لقسمه لوحده')}">${T("📥 رفع ملفات الفحص القديمة")}</button>
        <input type="file" id="inspBulkLegacyInput" accept=".xlsx,.xlsm" multiple style="display:none" onchange="inspImportLegacyBulk(event)" />
        <button class="btn btn-primary btn-sm" type="button" onclick="inspOpenAddSectionModal()">${T("+ إضافة قسم")}</button>
      </div>
    </div>
    <div id="inspBulkImportBox" style="display:none;"></div>
    <div class="kpi-grid" id="inspSectionsKpis">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
    <div class="insp-sections-grid" id="inspSectionsGrid">
      <div class="loading-inline"><span class="btn-spinner"></span> ${T("جارِ تحميل الأقسام…")}</div>
    </div>
  `;
  try {
    const res = await authFetch(`/api/inspections/sections?category=${encodeURIComponent(inspState.category)}&year=${inspState.year}&month=${inspState.month}`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    const sections = data.sections || [];
    window._inspSectionsCache = sections;

    const totalItems = sections.reduce((s,x)=>s+(x.itemCount||0),0);
    const totalCompliant = sections.reduce((s,x)=>s+(x.compliant||0),0);
    const totalNonCompliant = sections.reduce((s,x)=>s+(x.nonCompliant||0),0);
    const totalPending = sections.reduce((s,x)=>s+(x.pending||0),0);
    const overallPct = totalItems > 0 ? Math.round((totalCompliant/totalItems)*1000)/10 : null;

    const kpisEl = document.getElementById('inspSectionsKpis');
    if (kpisEl) kpisEl.innerHTML = `
      <div class="kpi-card kpi-success">
        <div class="kpi-card-top"><span class="kpi-icon">✅</span></div>
        <div class="kpi-value">${totalCompliant}</div>
        <div class="kpi-label">${T("مطابق")}</div>
      </div>
      <div class="kpi-card kpi-danger">
        <div class="kpi-card-top"><span class="kpi-icon">⛔</span></div>
        <div class="kpi-value">${totalNonCompliant}</div>
        <div class="kpi-label">${T("غير مطابق")}</div>
      </div>
      <div class="kpi-card kpi-warning">
        <div class="kpi-card-top"><span class="kpi-icon">⏳</span></div>
        <div class="kpi-value">${totalPending}</div>
        <div class="kpi-label">${T("لم يتم الفحص")}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card-top"><span class="kpi-icon">📊</span></div>
        <div class="kpi-value">${overallPct !== null ? overallPct + '%' : '—'}</div>
        <div class="kpi-label">${T("نسبة المطابقة الإجمالية")}</div>
        <div class="kpi-sub">${totalItems} ${T("صنف عبر")} ${sections.length} ${T("قسم")}</div>
      </div>
    `;

    const gridEl = document.getElementById('inspSectionsGrid');
    if (!gridEl) return;
    if (sections.length === 0) {
      gridEl.innerHTML = T('<div class="empty"><div class="icon">🦺</div>لا توجد أقسام بعد — أضف قسمًا جديدًا</div>');
      return;
    }
    gridEl.innerHTML = sections.map(s => `
      <div class="insp-section-card">
        <div onclick="inspOpenSection(${jsArg(s.id)})">
          <div class="insp-section-name">${escapeHtml(s.name)}</div>
          <div class="insp-section-meta"><span>${s.itemCount} ${T("صنف")}</span><span>${s.compliancePct !== null && s.compliancePct !== undefined ? s.compliancePct + '%' : '—'}</span></div>
          <div class="insp-section-bar"><div class="insp-section-bar-fill" style="width:${s.compliancePct || 0}%"></div></div>
        </div>
        <button class="insp-section-del btn btn-ghost btn-sm btn-danger-icon" type="button" onclick="event.stopPropagation();inspDeleteSection(${jsArg(s.id)})" title="${T("حذف القسم")}">${T("🗑 حذف")}</button>
      </div>
    `).join('');
  } catch(e) {
    console.error('Inspection sections load error', e);
    const gridEl = document.getElementById('inspSectionsGrid');
    if (gridEl) gridEl.innerHTML = T('<div class="empty u-c-danger-text">فشل تحميل الأقسام</div>');
  }
}

function inspOpenAddSectionModal() {
  openAppModal(`
    <h3>${T("+ إضافة قسم فحص جديد (")}${escapeHtml(inspState.category)})</h3>
    <div class="app-modal-field"><label>${T("اسم القسم *")}</label><input id="inspNewSectionName" type="text" placeholder="${T("مثال: طفايات الحريق")}" /></div>
    <div class="app-modal-error" id="inspSectionModalError"></div>
    <div class="app-modal-actions">
      <button class="btn btn-secondary" type="button" onclick="closeAppModal()">${T("إلغاء")}</button>
      <button class="btn btn-primary" type="button" id="inspSectionModalSubmit" onclick="inspSubmitAddSection()">${T("إضافة")}</button>
    </div>
  `);
}

async function inspSubmitAddSection() {
  const nameEl = document.getElementById('inspNewSectionName');
  const name = nameEl ? nameEl.value.trim() : '';
  const errEl = document.getElementById('inspSectionModalError');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = T('اسم القسم مطلوب'); errEl.style.display = 'block'; return; }
  const btn = document.getElementById('inspSectionModalSubmit');
  const orig = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';
  try {
    const res = await authFetch('/api/inspections/sections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: inspState.category, name })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(T('تمت إضافة القسم بنجاح ✓'), 'success');
      closeAppModal();
      renderInspectionSections();
    } else {
      errEl.textContent = data.error || T('فشل إضافة القسم'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = orig;
    }
  } catch(e) {
    errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = orig;
  }
}

async function inspDeleteSection(sectionId) {
  const s = (window._inspSectionsCache || []).find(x => x.id === sectionId);
  if (!s) return;
  const warn = s.itemCount > 0 ? ` ${T("يحتوي")} ${s.itemCount} ${T("صنف — سيتم حذف كل الأصناف وسجلات الفحص الخاصة به نهائيًا.")}` : '';
  if (!(await appConfirm(`${T("هل تريد حذف قسم")} "${s.name}"${T("؟")}${warn}`, { tone: 'danger', title: T('تأكيد الحذف'), confirmLabel: T('حذف') }))) return;
  try {
    const url = `/api/inspections/sections/${sectionId}` + (s.itemCount > 0 ? '?cascade=true' : '');
    const res = await authFetch(url, { method: 'DELETE' });
    if (res.ok) {
      showToast(T('تم حذف القسم'), 'success');
      renderInspectionSections();
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || T('فشل حذف القسم'), 'error');
    }
  } catch(e) {
    showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
  }
}

function inspOpenSection(sectionId) {
  const s = (window._inspSectionsCache || []).find(x => x.id === sectionId);
  inspState.sectionId = sectionId;
  inspState.sectionName = s ? s.name : '';
  inspState.view = 'detail';
  inspState.filters = { department: '', status: '', q: '' };
  renderInspections();
}

function inspBackToSections() {
  inspState.view = 'sections';
  inspState.sectionId = null;
  renderInspections();
}

async function renderInspectionSectionDetail() {
  const root = document.getElementById('inspectionsContent');
  if (!root) return;
  root.innerHTML = `
    <div class="insp-toolbar">
      <div class="insp-toolbar-left">
        <button class="btn btn-secondary btn-sm" type="button" onclick="inspBackToSections()">${T("→ رجوع للأقسام")}</button>
        <div class="insp-breadcrumb">${T("الفحص الشهري /")} ${escapeHtml(inspState.category)} / <b>${escapeHtml(inspState.sectionName)}</b></div>
      </div>
      <div class="insp-toolbar-left">
        ${inspYearMonthPickerHtml()}
      </div>
    </div>

    <div class="kpi-grid" id="inspDetailKpis">
      <div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>
    </div>

    <div class="adv-filter-box">
      <div class="adv-filter-head">
        <div class="adv-filter-title">${T("🔍 فلترة وأدوات")}</div>
        <div class="u-flex u-gap-2 u-flex-wrap">
          <button class="btn btn-export btn-sm" type="button" onclick="inspExport('items')">${T("⬇ تصدير سجل الأصناف")}</button>
          <button class="btn btn-export btn-sm" type="button" onclick="inspExport('monthly')">${T("⬇ تصدير فحص الشهر")}</button>
          <button class="btn btn-export btn-sm" type="button" onclick="document.getElementById('inspLegacyExcelInput').click()" title="${T('الملف القديم بتاع قسم')} ${escapeHtml(inspState.sectionName)} ${T('بس')}">${T("📥 رفع سجل قديم لقسم")} "${escapeHtml(inspState.sectionName)}"</button>
          <input type="file" id="inspLegacyExcelInput" accept=".xlsx" style="display:none" onchange="inspImportLegacyExcel(event)" />
          <button class="btn btn-primary btn-sm" type="button" onclick="inspOpenAddItemModal()">${T("+ إضافة صنف")}</button>
        </div>
      </div>
      <div class="u-flex u-gap-3 u-flex-wrap">
        <input id="inspFilterQ" type="text" placeholder="${T("بحث برقم/اسم/قسم/مكان الصنف…")}" class="form-input u-flex-1" style="min-width: 200px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--border)" oninput="inspDebouncedFilter()" />
        <select id="inspFilterDept" class="insp-status-select" onchange="inspApplyFilters()">
          <option value="">${T("كل الأقسام/الأماكن")}</option>
        </select>
        <select id="inspFilterStatus" class="insp-status-select" onchange="inspApplyFilters()">
          <option value="">${T("كل الحالات")}</option>
          <option value="مطابق">${T("مطابق")}</option>
          <option value="غير مطابق">${T("غير مطابق")}</option>
          <option value="لم يتم الفحص">${T("لم يتم الفحص")}</option>
        </select>
      </div>
    </div>

    <div id="inspItemsTableWrap">
      <div class="loading-inline"><span class="btn-spinner"></span> ${T("جارِ تحميل الأصناف…")}</div>
    </div>
  `;
  await inspLoadItems();
}

async function inspImportLegacyBulk(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  const box = document.getElementById('inspBulkImportBox');
  if (!box) return;
  const cat = inspState.category;

  const rows = files.map(f => ({ name: f.name, state: 'pending', msg: '' }));
  const paint = () => {
    const done = rows.filter(r => r.state !== 'pending' && r.state !== 'working').length;
    box.innerHTML = `
      <div class="adv-filter-box u-mb-4">
        <div class="adv-filter-head">
          <div class="adv-filter-title">${T('📥 رفع ملفات الفحص القديمة')} — ${T('برنامج')} ${escapeHtml(cat)} (${done}/${rows.length})</div>
          ${done === rows.length ? `<button class="btn btn-secondary btn-sm" type="button" onclick="document.getElementById('inspBulkImportBox').style.display='none'">${T('إخفاء')}</button>` : ''}
        </div>
        <div class="u-fs-sm" style="max-height: 300px; overflow: auto">
          ${rows.map(r => `
            <div class="u-flex u-gap-2 u-items-center" style="padding: 5px 2px; border-bottom: 1px solid var(--border)">
              <span style="width:18px;">${r.state === 'ok' ? '✅' : r.state === 'skip' ? '⚠️' : r.state === 'err' ? '❌' : r.state === 'working' ? '⏳' : '•'}</span>
              <span class="u-flex-1 u-nowrap" style="min-width: 0; overflow: hidden; text-overflow: ellipsis" dir="auto">${escapeHtml(r.name)}</span>
              <span class="u-c-text-muted">${escapeHtml(r.msg)}</span>
            </div>`).join('')}
        </div>
      </div>`;
    box.style.display = 'block';
  };
  paint();

  const readBase64 = file => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = e => resolve(String(e.target.result).split(',')[1]);
    fr.onerror = () => reject(new Error('read error'));
    fr.readAsDataURL(file);
  });

  for (let i = 0; i < files.length; i++) {
    rows[i].state = 'working'; rows[i].msg = T('جارِ الرفع…'); paint();
    try {
      const base64Data = await readBase64(files[i]);
      const res = await authFetch('/api/inspections/import-legacy-auto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat, fileName: files[i].name, base64Data })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        rows[i].state = 'ok';
        rows[i].msg = `${(data.section && data.section.name) || ''} — ${data.itemsCreated || 0} ${T('صنف')} · ${(data.recordsCreated || 0) + (data.recordsUpdated || 0)} ${T('سجل')}`;
      } else if (data.unmatched) {
        rows[i].state = 'skip';
        rows[i].msg = T('مش لاقي قسم بنفس الاسم — ارفعه من جوه القسم');
      } else {
        rows[i].state = 'err';
        rows[i].msg = data.error || T('فشل الاستيراد');
      }
    } catch (e) {
      rows[i].state = 'err';
      rows[i].msg = T('خطأ في الاتصال');
    }
    paint();
  }

  const ok = rows.filter(r => r.state === 'ok').length;
  showToast(`${T('خلص الرفع:')} ${ok} ${T('من')} ${rows.length} ${T('ملف')}`, ok === rows.length ? 'success' : 'info');
  renderInspectionSections();
  setTimeout(paint, 400);
}

async function inspImportLegacyExcel(event) {
  const file = event.target.files[0];
  if (!file || !inspState.sectionId) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Data = e.target.result.split(',')[1];
    showToast(T('جارِ استيراد السجل القديم…'), 'info');
    try {
      const res = await authFetch(`/api/inspections/sections/${inspState.sectionId}/import-legacy-excel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        showToast(
          `${T("تم الاستيراد ✓ —")} ${data.itemsCreated} ${T("صنف جديد،")} ${data.recordsCreated} ${T("سجل جديد،")} ${data.recordsUpdated} ${T("سجل محدَّث (")}${data.sheetsParsed} ${T("ورقة)")}`,
          'success'
        );
        inspLoadItems();
      } else {
        showToast(data.error || T('فشل استيراد الملف'), 'error');
      }
    } catch (err) {
      console.error('inspImportLegacyExcel error', err);
      showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
    }
    event.target.value = '';
  };
  reader.readAsDataURL(file);
}

async function inspLoadItems() {
  const wrap = document.getElementById('inspItemsTableWrap');
  if (!wrap || !inspState.sectionId) return;
  wrap.innerHTML = T('<div class="loading-inline"><span class="btn-spinner"></span> جارِ تحميل الأصناف…</div>');
  try {
    const params = new URLSearchParams({ year: inspState.year, month: inspState.month });
    if (inspState.filters.department) params.set('department', inspState.filters.department);
    if (inspState.filters.status) params.set('status', inspState.filters.status);
    if (inspState.filters.q) params.set('q', inspState.filters.q);
    const res = await authFetch(`/api/inspections/sections/${inspState.sectionId}/items?${params.toString()}`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    window._inspItemsCache = data.items || [];
    const stats = data.stats || {};

    const kpisEl = document.getElementById('inspDetailKpis');
    if (kpisEl) kpisEl.innerHTML = `
      <div class="kpi-card kpi-success"><div class="kpi-card-top"><span class="kpi-icon">✅</span></div><div class="kpi-value">${stats.compliant||0}</div><div class="kpi-label">${T("مطابق")}</div></div>
      <div class="kpi-card kpi-danger"><div class="kpi-card-top"><span class="kpi-icon">⛔</span></div><div class="kpi-value">${stats.nonCompliant||0}</div><div class="kpi-label">${T("غير مطابق")}</div></div>
      <div class="kpi-card kpi-warning"><div class="kpi-card-top"><span class="kpi-icon">⏳</span></div><div class="kpi-value">${stats.pending||0}</div><div class="kpi-label">${T("لم يتم الفحص")}</div></div>
      <div class="kpi-card"><div class="kpi-card-top"><span class="kpi-icon">📊</span></div><div class="kpi-value">${stats.compliancePct !== null && stats.compliancePct !== undefined ? stats.compliancePct + '%' : '—'}</div><div class="kpi-label">${T("نسبة المطابقة")}</div><div class="kpi-sub">${stats.itemCount||0} ${T("صنف")}</div></div>
    `;

    const deptSel = document.getElementById('inspFilterDept');
    if (deptSel && deptSel.options.length <= 1) {
      const depts = Array.from(new Set((data.items||[]).map(it => it.department).filter(Boolean))).sort();
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        deptSel.appendChild(opt);
      });
    }

    renderInspItemsTable(data.items || []);
  } catch(e) {
    console.error('Inspection items load error', e);
    wrap.innerHTML = T('<div class="empty u-c-danger-text">فشل تحميل الأصناف</div>');
  }
}

function inspStatusBadge(status) {
  if (status === 'مطابق') return `<span class="badge badge-success">${T("✅ مطابق")}</span>`;
  if (status === 'غير مطابق') return `<span class="badge badge-danger">${T("⛔ غير مطابق")}</span>`;
  return `<span class="badge badge-neutral">${T("⏳ لم يتم الفحص")}</span>`;
}

function renderInspItemsTable(items) {
  const wrap = document.getElementById('inspItemsTableWrap');
  if (!wrap) return;
  if (items.length === 0) {
    wrap.innerHTML = T('<div class="empty"><div class="icon">🦺</div>لا توجد أصناف مطابقة — أضف صنفًا جديدًا أو عدّل الفلاتر</div>');
    return;
  }
  wrap.innerHTML = `
    <div style="overflow:auto;max-height:min(70vh,720px);border:1px solid var(--border);border-radius:var(--r-lg);">
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th><th>${T("رقم/كود")}</th><th>${T("الاسم/النوع")}</th><th>${T("القسم")}</th><th>${T("المكان")}</th>
            <th>${T("الحالة")}</th><th>${T("الملاحظات")}</th><th>${T("تاريخ الفحص")}</th><th>${T("القائم بالفحص")}</th><th>${T("إجراءات")}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it,i) => `
            <tr>
              <td>${i+1}</td>
              <td>${escapeHtml(it.itemNumber || '—')}</td>
              <td class="u-fw-700 u-text-start">${escapeHtml(it.name)}</td>
              <td>${escapeHtml(it.department || '—')}</td>
              <td>${escapeHtml(it.location || '—')}</td>
              <td>${inspStatusBadge(it.status)}</td>
              <td class="u-ws-normal u-text-start" style="max-width: 160px">${escapeHtml((it.record && it.record.notes) || '—')}</td>
              <td class="u-nowrap">${it.record && it.record.inspectionDate ? escapeHtml(String(it.record.inspectionDate).slice(0,10)) : '—'}</td>
              <td>${escapeHtml((it.record && it.record.inspector) || '—')}</td>
              <td>
                <div class="u-flex u-gap-2 u-justify-center u-flex-wrap">
                  <button class="btn btn-primary btn-sm" type="button" onclick="inspOpenRecordModal(${jsArg(it.id)})">${T("تسجيل فحص")}</button>
                  <button class="btn btn-secondary btn-sm btn-icon" type="button" onclick="inspOpenEditItemModal(${jsArg(it.id)})" title="${T("تعديل بيانات الصنف")}" aria-label="${T("تعديل بيانات الصنف")}">✏️</button>
                  ${it.record ? `<button class="btn btn-danger btn-sm" type="button" onclick="inspDeleteRecord(${jsArg(it.record.id)})" title="${T("حذف نتيجة فحص الشهر")}">${T("حذف الفحص")}</button>` : ''}
                  <button class="btn btn-danger btn-sm" type="button" onclick="inspDeleteItem(${jsArg(it.id)})" title="${T("حذف الصنف نهائيًا")}">🗑</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function inspApplyFilters() {
  const q = document.getElementById('inspFilterQ');
  const dept = document.getElementById('inspFilterDept');
  const status = document.getElementById('inspFilterStatus');
  inspState.filters.q = q ? q.value.trim() : '';
  inspState.filters.department = dept ? dept.value : '';
  inspState.filters.status = status ? status.value : '';
  inspLoadItems();
}
const inspDebouncedFilter = (typeof window.debounce === 'function') ? window.debounce(inspApplyFilters, 300) : inspApplyFilters;

function inspExport(type) {
  if (!inspState.sectionId) return;
  let url = `/api/inspections/sections/${inspState.sectionId}/export?type=${encodeURIComponent(type)}`;
  if (type === 'monthly') url += `&year=${inspState.year}&month=${inspState.month}`;
  navigateWithAuth(url);
}

function inspOpenAddItemModal() {
  openAppModal(`
    <h3>${T("+ إضافة صنف جديد")}</h3>
    <div class="app-modal-field"><label>${T("رقم/كود الصنف")}</label><input id="inspItemNumber" type="text" placeholder="${T("مثال: 1")}" /></div>
    <div class="app-modal-field"><label>${T("الاسم/النوع *")}</label><input id="inspItemName" type="text" placeholder="${T("مثال: طفاية 6 كجم Dry Powder")}" /></div>
    <div class="app-modal-field"><label>${T("القسم")}</label><input id="inspItemDept" type="text" placeholder="${T("مثال: المبنى الإداري")}" /></div>
    <div class="app-modal-field"><label>${T("المكان")}</label><input id="inspItemLocation" type="text" placeholder="${T("مثال: الاستقبال بجوار السلم")}" /></div>
    <div class="app-modal-error" id="inspItemModalError"></div>
    <div class="app-modal-actions">
      <button class="btn btn-secondary" type="button" onclick="closeAppModal()">${T("إلغاء")}</button>
      <button class="btn btn-primary" type="button" id="inspItemModalSubmit" onclick="inspSubmitAddItem()">${T("إضافة")}</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('inspItemName'); if (el) el.focus(); }, 50);
}

async function inspSubmitAddItem() {
  const nameEl = document.getElementById('inspItemName');
  const name = nameEl ? nameEl.value.trim() : '';
  const errEl = document.getElementById('inspItemModalError');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = T('اسم/نوع الصنف مطلوب'); errEl.style.display = 'block'; return; }
  const btn = document.getElementById('inspItemModalSubmit');
  const orig = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';
  try {
    const res = await authFetch(`/api/inspections/sections/${inspState.sectionId}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemNumber: document.getElementById('inspItemNumber').value.trim(),
        name,
        department: document.getElementById('inspItemDept').value.trim(),
        location: document.getElementById('inspItemLocation').value.trim()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(T('تمت إضافة الصنف بنجاح ✓'), 'success');
      closeAppModal();
      inspLoadItems();
    } else {
      errEl.textContent = data.error || T('فشل إضافة الصنف'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = orig;
    }
  } catch(e) {
    errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = orig;
  }
}

function inspOpenEditItemModal(itemId) {
  const it = (window._inspItemsCache || []).find(x => x.id === itemId);
  if (!it) return;
  openAppModal(`
    <h3>${T("✏️ تعديل بيانات الصنف")}</h3>
    <div class="app-modal-field"><label>${T("رقم/كود الصنف")}</label><input id="inspEditItemNumber" type="text" value="${escapeHtml(it.itemNumber||'')}" /></div>
    <div class="app-modal-field"><label>${T("الاسم/النوع *")}</label><input id="inspEditItemName" type="text" value="${escapeHtml(it.name||'')}" /></div>
    <div class="app-modal-field"><label>${T("القسم")}</label><input id="inspEditItemDept" type="text" value="${escapeHtml(it.department||'')}" /></div>
    <div class="app-modal-field"><label>${T("المكان")}</label><input id="inspEditItemLocation" type="text" value="${escapeHtml(it.location||'')}" /></div>
    <div class="app-modal-error" id="inspEditItemModalError"></div>
    <div class="app-modal-actions">
      <button class="btn btn-secondary" type="button" onclick="closeAppModal()">${T("إلغاء")}</button>
      <button class="btn btn-primary" type="button" id="inspEditItemModalSubmit" onclick="inspSubmitEditItem(${jsArg(itemId)})">${T("حفظ")}</button>
    </div>
  `);
}

async function inspSubmitEditItem(itemId) {
  const nameEl = document.getElementById('inspEditItemName');
  const name = nameEl ? nameEl.value.trim() : '';
  const errEl = document.getElementById('inspEditItemModalError');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = T('اسم/نوع الصنف مطلوب'); errEl.style.display = 'block'; return; }
  const btn = document.getElementById('inspEditItemModalSubmit');
  const orig = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';
  try {
    const res = await authFetch(`/api/inspections/items/${itemId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemNumber: document.getElementById('inspEditItemNumber').value.trim(),
        name,
        department: document.getElementById('inspEditItemDept').value.trim(),
        location: document.getElementById('inspEditItemLocation').value.trim()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(T('تم حفظ التعديل ✓'), 'success');
      closeAppModal();
      inspLoadItems();
    } else {
      errEl.textContent = data.error || T('فشل الحفظ'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = orig;
    }
  } catch(e) {
    errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = orig;
  }
}

async function inspDeleteItem(itemId) {
  const it = (window._inspItemsCache || []).find(x => x.id === itemId);
  if (!(await appConfirm(`${T("هل تريد حذف الصنف")} "${it ? it.name : ''}"${T("؟ سيتم حذف كل سجلات فحصه الشهرية أيضًا.")}`, { tone: 'danger', title: T('تأكيد الحذف'), confirmLabel: T('حذف') }))) return;
  try {
    const res = await authFetch(`/api/inspections/items/${itemId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(T('تم حذف الصنف'), 'success');
      inspLoadItems();
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || T('فشل حذف الصنف'), 'error');
    }
  } catch(e) {
    showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
  }
}

function inspOpenRecordModal(itemId) {
  const it = (window._inspItemsCache || []).find(x => x.id === itemId);
  if (!it) return;
  const rec = it.record;
  const defaultInspector = rec && rec.inspector ? rec.inspector : (typeof currentUserName !== 'undefined' ? (currentUserName || '') : '');
  openAppModal(`
    <h3>${T("تسجيل نتيجة فحص —")} ${escapeHtml(it.name)}</h3>
    <p class="u-c-text-muted u-fs-sm" style="margin: -10px 0 16px">${T(ARABIC_MONTHS[inspState.month-1])} ${inspState.year}</p>
    <div class="app-modal-field">
      <label>${T("نتيجة الفحص *")}</label>
      <select id="inspRecStatus">
        <option value="مطابق" ${rec && rec.status==='مطابق' ? 'selected':''}>${T("✅ مطابق")}</option>
        <option value="غير مطابق" ${rec && rec.status==='غير مطابق' ? 'selected':''}>${T("⛔ غير مطابق")}</option>
      </select>
    </div>
    <div class="app-modal-field"><label>${T("تاريخ الفحص")}</label><input id="inspRecDate" type="date" value="${rec && rec.inspectionDate ? escapeHtml(String(rec.inspectionDate).slice(0,10)) : new Date().toISOString().slice(0,10)}" /></div>
    <div class="app-modal-field"><label>${T("القائم بالفحص")}</label><input id="inspRecInspector" type="text" value="${escapeHtml(defaultInspector)}" /></div>
    <div class="app-modal-field"><label>${T("الملاحظات")}</label><textarea id="inspRecNotes">${escapeHtml((rec && rec.notes) || '')}</textarea></div>
    <div class="app-modal-error" id="inspRecModalError"></div>
    <div class="app-modal-actions">
      <button class="btn btn-secondary" type="button" onclick="closeAppModal()">${T("إلغاء")}</button>
      <button class="btn btn-primary" type="button" id="inspRecModalSubmit" onclick="inspSubmitRecord(${jsArg(itemId)})">${T("حفظ نتيجة الفحص")}</button>
    </div>
  `);
}

async function inspSubmitRecord(itemId) {
  const statusEl = document.getElementById('inspRecStatus');
  const status = statusEl ? statusEl.value : '';
  const errEl = document.getElementById('inspRecModalError');
  errEl.style.display = 'none';
  const btn = document.getElementById('inspRecModalSubmit');
  const orig = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';
  try {
    const res = await authFetch(`/api/inspections/items/${itemId}/records`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: inspState.year, month: inspState.month, status,
        inspectionDate: document.getElementById('inspRecDate').value,
        inspector: document.getElementById('inspRecInspector').value.trim(),
        notes: document.getElementById('inspRecNotes').value.trim()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(T('تم حفظ نتيجة الفحص ✓'), 'success');
      closeAppModal();
      inspLoadItems();
    } else {
      errEl.textContent = data.error || T('فشل الحفظ'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = orig;
    }
  } catch(e) {
    errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = orig;
  }
}

async function inspDeleteRecord(recordId) {
  if (!(await appConfirm(T('هل تريد حذف نتيجة الفحص لهذا الشهر؟ سيعود الصنف لحالة "لم يتم الفحص".'), { tone: 'danger', title: T('تأكيد الحذف'), confirmLabel: T('حذف') }))) return;
  try {
    const res = await authFetch(`/api/inspections/records/${recordId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(T('تم حذف نتيجة الفحص'), 'success');
      inspLoadItems();
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || T('فشل الحذف'), 'error');
    }
  } catch(e) {
    showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
  }
}
