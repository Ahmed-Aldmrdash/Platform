// Read-only audit log timeline with filters and polling.

const AUDIT_ENTITY_LABELS = {
  permit: 'تصريح عمل', hazard: 'بلاغ خطورة', training: 'محاضرة', drill: 'تجربة طوارئ',
  'inspection-section': 'قسم فحص', 'inspection-item': 'صنف فحص', 'inspection-record': 'نتيجة فحص',
  database: 'قاعدة البيانات', employee: 'موظف', report: 'تقرير'
};
const AUDIT_ACTION_META = {
  create:                { glyph: '+', cls: 'a-create',  label: 'إنشاء' },
  update:                { glyph: '✎', cls: 'a-update',  label: 'تعديل' },
  delete:                { glyph: '✕', cls: 'a-delete',  label: 'حذف' },
  approve:               { glyph: '✓', cls: 'a-approve', label: 'اعتماد' },
  reject:                { glyph: '✕', cls: 'a-reject',  label: 'رفض' },
  close:                 { glyph: '✓', cls: 'a-close',   label: 'إغلاق' },
  force_close:           { glyph: '✓', cls: 'a-close',   label: 'إغلاق قسري' },
  restore:               { glyph: '↺', cls: 'a-restore', label: 'استرجاع' },
  'import-legacy-excel':  { glyph: '↓', cls: 'a-import',  label: 'استيراد' },
  reset_password:        { glyph: '⟲', cls: 'a-update',  label: 'إعادة تعيين كلمة السر' },
  email_backup:          { glyph: '✉', cls: 'a-import',  label: 'إرسال بالإيميل' },
  email:                 { glyph: '✉', cls: 'a-import',  label: 'إرسال بالإيميل' },
};

let auditLogState = { entityType: '', q: '' };

async function renderAuditLog() {
  const root = document.getElementById('auditLogContent');
  if (!root) return;
  const isSuperAdmin = currentUserRole === 'super_admin';

  root.innerHTML = `
    ${isSuperAdmin ? `
    <div class="ticket" style="margin-bottom:20px;">
      <div class="ticket-head"><div><div class="ttype">${T("💾 النسخ الاحتياطي واسترجاع البيانات")}</div></div></div>
      <div class="ticket-body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="btn btn-primary" type="button" onclick="downloadFullBackup()">${T("⬇ تنزيل نسخة احتياطية كاملة")}</button>
        <label class="btn btn-secondary" style="cursor:pointer;margin:0;">
          ${T("⬆ استرجاع من نسخة احتياطية")}
          <input type="file" id="backupRestoreInput" accept=".json,.gz" style="display:none" onchange="restoreFullBackup(event)" />
        </label>
        <span style="font-size:12px;color:var(--muted);">${T("النسخة الاحتياطية ملف واحد يشمل كل بيانات النظام (.json، أو .json.gz اللي بيوصل على الإيميل) — الاسترجاع يستبدل البيانات الحالية بالكامل.")}</span>
      </div>
      <div class="ticket-body" id="backupEmailBox" style="border-top:1px solid var(--paper-line);">
        <div class="loading">${T("جارِ التحميل…")}</div>
      </div>
      <div class="ticket-body" id="backupSnapshotBox" style="border-top:1px solid var(--paper-line);">
        <div class="loading">${T("جارِ التحميل…")}</div>
      </div>
    </div>` : ''}

    <div class="sup-header-row" style="margin-bottom:16px">
      <h3>${T("سجل التدقيق — من عمل إيه وإمتى")}
        <span class="audit-live-badge"><span class="audit-live-dot"></span> ${T("تحديث لحظي")}</span>
      </h3>
    </div>

    <div class="adv-filter-box">
      <div class="adv-filter-grid">
        <div class="adv-filter-field">
          <label>${T("نوع العملية")}</label>
          <select id="auditFilterType" onchange="auditApplyFilters()">
            <option value="">${T("الكل")}</option>
            ${Object.entries(AUDIT_ENTITY_LABELS).map(([k,v]) => `<option value="${k}">${T(v)}</option>`).join('')}
          </select>
        </div>
        <div class="adv-filter-field">
          <label>${T("بحث (اسم/ملاحظة)")}</label>
          <input type="text" id="auditFilterQ" placeholder="${T("ابحث بالاسم أو الملاحظة...")}" oninput="auditFilterInput()" />
        </div>
      </div>
      <div class="adv-filter-footer">
        <button class="adv-filter-clear-btn" onclick="auditLogState={entityType:'',q:''};renderAuditLog();">${T("مسح الفلاتر")}</button>
        <span class="adv-filter-count" id="auditFilterCount"></span>
      </div>
    </div>

    <div id="auditLogList"><div class="loading">${T("جارِ تحميل السجل…")}</div></div>
  `;
  if (isSuperAdmin) { loadBackupEmailSettings(); loadBackupSnapshots(); }
  await auditLoadList();
  if (!isPolling('audit')) poll('audit', () => auditLoadList(true), 8000);
}

function stopAuditPolling() {
  stopPoll('audit');
}

function auditApplyFilters() {
  const typeEl = document.getElementById('auditFilterType');
  const qEl = document.getElementById('auditFilterQ');
  auditLogState.entityType = typeEl ? typeEl.value : '';
  auditLogState.q = qEl ? qEl.value.trim().toLowerCase() : '';
  auditRenderList();
}
// One debouncer shared by every keystroke in the search box.
const auditFilterInput = window.debounce(auditApplyFilters, 300);

let _auditRenderedData = null;
async function auditLoadList(isSilent) {
  const listEl = document.getElementById('auditLogList');
  if (!listEl) { stopAuditPolling(); return; }
  try {
    const params = new URLSearchParams({ limit: '500' });
    if (auditLogState.entityType) params.set('entityType', auditLogState.entityType);
    const r = await fetchJsonIfChanged(`/api/audit-log?${params.toString()}`);
    if (!r.ok) throw new Error('fetch failed');
    // A poll that brings nothing new only refreshes the relative times.
    if (isSilent && r.data === _auditRenderedData) { auditRefreshTimes(); return; }
    _auditRenderedData = r.data;
    window._auditLogCache = (r.data && r.data.entries) || [];
    auditRenderList();
  } catch (e) {
    if (!isSilent) {
      console.error('Audit log load error', e);
      listEl.innerHTML = T('<div class="empty" style="color:var(--danger);">فشل تحميل سجل التدقيق</div>');
    }
  }
}

function auditRelativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 5) return T('الآن');
  if (diffSec < 60) return `${T("منذ")} ${diffSec} ${T("ثانية")}`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${T("منذ")} ${diffMin} ${T("دقيقة")}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${T("منذ")} ${diffHr} ${T("ساعة")}`;
  return d.toLocaleString(LOC());
}

function auditRefreshTimes() {
  document.querySelectorAll('#auditLogList .audit-item-time[data-ts]').forEach(el => {
    el.textContent = auditRelativeTime(el.dataset.ts);
  });
}

function auditRenderList() {
  const listEl = document.getElementById('auditLogList');
  const countEl = document.getElementById('auditFilterCount');
  if (!listEl) return;
  let entries = window._auditLogCache || [];
  if (auditLogState.q) {
    const q = auditLogState.q;
    entries = entries.filter(e =>
      String(e.actorName || '').toLowerCase().includes(q) ||
      String(e.note || '').toLowerCase().includes(q) ||
      String(e.department || '').toLowerCase().includes(q)
    );
  }
  if (countEl) countEl.textContent = `${entries.length} ${T("عملية")}`;

  if (entries.length === 0) {
    listEl.innerHTML = T('<div class="empty"><div class="icon">🛡️</div>لا توجد عمليات مسجّلة بعد — سيبدأ السجل بالامتلاء تلقائيًا مع أي اعتماد/رفض/حذف جديد</div>');
    return;
  }

  listEl.innerHTML = `<div class="audit-timeline">` + entries.map(e => {
    const meta = AUDIT_ACTION_META[e.action] || { glyph: '•', cls: 'a-update', label: e.action };
    const entityLabel = T(AUDIT_ENTITY_LABELS[e.entityType] || e.entityType);
    const actionLabel = T(meta.label);
    const statusChange = (e.previousStatus || e.newStatus)
      ? `<div class="audit-item-status-chip">${escapeHtml(e.previousStatus || '—')} ← ${escapeHtml(e.newStatus || '—')}</div>` : '';
    return `
      <div class="audit-item">
        <div class="audit-item-icon ${meta.cls}">${meta.glyph}</div>
        <div class="audit-item-head">
          <div class="audit-item-title">${escapeHtml(entityLabel)} <span class="audit-item-action">${escapeHtml(actionLabel)}</span></div>
          <div class="audit-item-time" data-ts="${escapeHtml(e.timestamp || '')}" title="${e.timestamp ? new Date(e.timestamp).toLocaleString(LOC()) : ''}">${auditRelativeTime(e.timestamp)}</div>
        </div>
        <div class="audit-item-meta">
          <span><b>${escapeHtml(e.actorName || e.actorUsername || '—')}</b></span>
          <span>${escapeHtml(e.actorRole || '—')}</span>
          ${e.department ? `<span>${escapeHtml(e.department)}</span>` : ''}
        </div>
        ${e.note ? `<div class="audit-item-note">${escapeHtml(e.note)}</div>` : ''}
        ${statusChange}
      </div>
    `;
  }).join('') + `</div>`;
}
