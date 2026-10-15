// Safety team hazard list: card markup, ordering, high-risk alert recipients and filters.

let currentHzStatusFilter = 'الكل';
let currentHzDeptFilter = 'الكل';
let currentHzSeverityFilter = 'الكل';
let currentHzYearFilter = 'الكل';

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString(LOC(), { dateStyle: 'short', timeStyle: 'short' });
}

function getHazardCardHtml(h) {
  const waitingHours = (!h.status || h.status === 'open') ? hoursSince(h.submittedAt || h.date) : 0;
  let riskStr = h.riskLevel === 'H' ? 'High 🔴' : h.riskLevel === 'M' ? 'Medium 🟡' : 'Low 🟢';
  let riskClass = h.riskLevel === 'H' ? 'hz-high' : h.riskLevel === 'M' ? 'hz-medium' : 'hz-low';

  let statusStr = 'مفتوح 🔴';
  let statusClass = 'hz-status-open';
  if (h.status === 'assigned_to_maintenance') { statusStr = `${T("تم التوجيه لـ:")} ${escapeHtml(h.assignedToMaintenance || T('الصيانة'))} 📢`; statusClass = 'hz-status-in_progress'; }
  if (h.status === 'in_progress') { statusStr = 'قيد الإصلاح 🟡'; statusClass = 'hz-status-in_progress'; }
  if (h.status === 'rejected_by_maintenance') { statusStr = T('مرفوض (صيانة) ❌'); statusClass = 'hz-status-rejected'; }
  if (h.status === 'rejected_by_hse') { statusStr = T('مرفوض 🚫'); statusClass = 'hz-status-rejected'; }
  if (h.status === 'resolved' || h.status === 'closed') { statusStr = T('تم الإصلاح والإغلاق 🟢'); statusClass = 'hz-status-resolved'; }
  if (h.deleted) { statusStr = T('محذوف 🗑️'); statusClass = 'hz-status-resolved'; }

  let actionHtml = '';
  if (!h.deleted) {
    if (h.status === 'rejected_by_maintenance') {
      actionHtml = `<div class="desc desc-danger">
        <strong>${T("سبب رفض الصيانة (")}${escapeHtml(h.assignedToMaintenance || '')}):</strong><br>${escapeHtml(h.maintRejectReason || '')}
        <br><span class="desc-by">${T("بواسطة:")} ${escapeHtml(h.maintRejectedBy || '')}</span>
      </div>`;
      if (currentUserRole === 'hse_admin' || currentUserRole === 'super_admin') {
        actionHtml += `<div class="btn-row card-actions">
          <button onclick="openHzAssignModal(${jsArg(h.id)})" class="btn btn-warning">${T("📢 إعادة التوجيه لقسم آخر")}</button>
          <button onclick="openHzRejectHseModal(${jsArg(h.id)})" class="btn btn-danger">${T("🚫 رفض البلاغ نهائياً")}</button>
        </div>`;
      }
    } else if (h.status === 'rejected_by_hse') {
      actionHtml = `<div class="desc desc-danger">
        <strong>${T("سبب رفض المشرف:")}</strong><br>${escapeHtml(h.hseRejectReason || '')}
        <br><span class="desc-by">${T("بواسطة:")} ${escapeHtml(h.hseRejectedBy || '')}</span>
      </div>`;
    } else if (h.status === 'resolved' || h.status === 'closed') {
      actionHtml = `<div class="desc desc-spaced">
        <strong>${T("تفاصيل الإصلاح (الصيانة):")}</strong><br>${escapeHtml(h.maintenanceAction || T('لا يوجد'))}
        ${h.maintenanceTeamNames ? `<br><strong>${T("فريق الصيانة:")}</strong> ${escapeHtml(h.maintenanceTeamNames)}` : ''}
        ${h.resolvedByMaintenanceName ? `<br><span class="desc-meta">${T("بواسطة:")} ${escapeHtml(h.resolvedByMaintenanceName)}</span>` : ''}
      </div>`;
    } else {
      const curRole = currentUserRole || (window.currentUser && window.currentUser.role) || '';
      const hasFullControl = ['super_admin', 'hse_admin', 'hse', 'hse_manager'].includes(curRole);
      const isMaint = curRole === 'maint_admin' || curRole === 'maintenance';

      actionHtml = `<div class="note-box show card-actions-box">`;
      if (h.status === 'open') {
        if (hasFullControl) {
          actionHtml += `
            <div class="btn-row card-actions">
              <button onclick="openHzAssignModal(${jsArg(h.id)})" class="btn btn-primary">${T("📢 توجيه للصيانة")}</button>
              <button onclick="startHzMaintenance(${jsArg(h.id)})" class="btn btn-info">${T("🛠️ بدء الإصلاح")}</button>
              <button onclick="updateHazardStatus(${jsArg(h.id)}, 'rejected')" class="btn btn-danger">${T("🚫 رفض البلاغ")}</button>
            </div>`;
        }
      } else if (h.status === 'assigned_to_maintenance' || h.status === 'assigned_maintenance') {
        if (hasFullControl || (isMaint && h.assignedToMaintenance === currentUserDept)) {
          actionHtml += `
            <div class="btn-row card-actions">
              <button onclick="startHzMaintenance(${jsArg(h.id)})" class="btn btn-info">${T("🛠️ بدء الإصلاح")}</button>
              <button onclick="resolveHazardPrompt(${jsArg(h.id)})" class="btn btn-success">${T("✅ تم الحل والإغلاق")}</button>
            </div>`;
        }
      } else if (h.status === 'in_progress') {
        if (hasFullControl || (isMaint && h.assignedToMaintenance === currentUserDept)) {
          actionHtml += `
            <div class="btn-row card-actions">
              <button onclick="resolveHazardPrompt(${jsArg(h.id)})" class="btn btn-success">${T("✅ تأكيد الإصلاح والإغلاق")}</button>
            </div>`;
        }
      }
      actionHtml += `</div>`;
    }

    if (h.assignedToMaintenance && h.status !== 'rejected_by_maintenance' && h.status !== 'rejected_by_hse') {
      actionHtml += `<div class="desc desc-info">
        <strong>${T("جهة الصيانة:")}</strong> ${escapeHtml(h.assignedToMaintenance)}
        ${h.forwardedByHseName ? `<br><span class="desc-meta">${T("توجيه بواسطة:")} ${escapeHtml(h.forwardedByHseName)}</span>` : ''}
      </div>`;
    }
  }

  let manageHtml = '';
  const currentRoleKey = getRoleKey(currentUserRole);
  const deletedBy = (typeof h.deletedBy === 'object' && h.deletedBy !== null) ? h.deletedBy : {};
  const isTrashedForMe = deletedBy[currentRoleKey] === true || h.deleted;
  const maintDeletedForMe = h.deletedByMaintenance && currentUserRole === 'maint_admin' && h.maintenanceDeletedDept === currentUserDept;

  if (isTrashedForMe || maintDeletedForMe) {
    if (currentUserRole === 'super_admin' || currentUserRole === 'hse_admin' || currentUserRole === 'dept_admin' || (currentUserRole === 'maint_admin' && h.maintenanceDeletedDept === currentUserDept)) {
      manageHtml = `<div class="card-trash">
        <div class="btn-row">
          <button onclick="restoreHazard(${jsArg(h.id)})" class="btn btn-secondary btn-sm">${T("🔄 استرجاع")}</button>
          <button onclick="permanentDeleteHazard(${jsArg(h.id)})" class="btn btn-danger btn-sm">${T("❌ حذف نهائي")}</button>
        </div>
        ${(h.lastDeletedByUsername || h.deletedByUsername) ? `<div class="card-trash-by">${T("حُذف بواسطة:")} ${escapeHtml(h.lastDeletedByUsername || h.deletedByUsername || T('المشرف'))} ${h.deleteReason ? `${T("| السبب:")} ${escapeHtml(h.deleteReason)}` : ''}</div>` : ''}
      </div>`;
    }
  } else {
    if (currentUserRole === 'super_admin' || currentUserRole === 'hse_admin' || currentUserRole === 'dept_admin' || (currentUserRole === 'maint_admin' && h.assignedToMaintenance === currentUserDept)) {
      manageHtml = `<div class="card-danger card-danger-ruled">
        <button onclick="softDeleteHazard(${jsArg(h.id)})" class="btn btn-danger btn-sm">${T("🗑️ حذف")}</button>
      </div>`;
    }
  }

  const rawStart = h.treatmentStartedAt || h.startedAt || (h.status === 'resolved' ? h.completedAt : null);
  const startDisplay = rawStart ? new Date(rawStart).toLocaleString(LOC(), {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  }) : T('لم تبدأ بعد');

  const timelineHtml = `
    <div class="hazard-timeline">
      <div class="timeline-step done">
        <span class="step-icon">📝</span>
        <div class="step-info">
          <strong>${T("وقت الإرسال:")}</strong>
          <span>${formatDateTime(h.submittedAt || h.createdAt)}</span>
        </div>
      </div>

      <div class="timeline-step ${h.seenAt ? 'done' : 'pending'}">
        <span class="step-icon">👁️</span>
        <div class="step-info">
          <strong>${T("وقت المشاهدة من المشرف:")}</strong>
          <span>${h.seenAt ? `${formatDateTime(h.seenAt)} (${escapeHtml(h.seenBy || T('المشرف'))})` : T('لم تتم المشاهدة بعد')}</span>
        </div>
      </div>

      <div class="timeline-step ${rawStart ? 'done' : 'pending'}">
        <span class="step-icon">⚙️</span>
        <div class="step-info">
          <strong>${T("وقت بدء المعالجة:")}</strong>
          <span>${startDisplay} ${rawStart && h.assignedTechName ? `${T("(المنسوب:")} ${escapeHtml(h.assignedTechName)}${h.assignedTechCode ? ' - '+escapeHtml(h.assignedTechCode) : ''})` : (rawStart && h.startedByName ? `(${escapeHtml(h.startedByName)})` : (rawStart ? T('(الصيانة)') : ''))}</span>
        </div>
      </div>

      <div class="timeline-step ${h.resolvedAt ? 'done' : 'pending'}">
        <span class="step-icon">✅</span>
        <div class="step-info">
          <strong>${T("وقت الانتهاء والإغلاق:")}</strong>
          <span>${h.resolvedAt ? `${formatDateTime(h.resolvedAt)} (${escapeHtml(h.resolvedBy || T('المشرف'))})` : T('لم ينتهِ بعد')}</span>
        </div>
      </div>
    </div>
  `;

  return `
    <div class="sup-card" id="hz_card_${escapeHtml(h.id)}">
      <div class="sup-top">
        <div>
          <div class="hz-status-badge ${statusClass}">${T(statusStr)}</div>
          <div class="worker">${escapeHtml(h.reporterName)}</div>
          ${waitingHours >= 24 ? `<div class="overdue-age">⏰ ${T('مفتوح من')} ${ageText(waitingHours)} ${T('من غير إجراء')}</div>` : ''}
        </div>
        <div class="tnum">${escapeHtml(h.id)}</div>
      </div>
      <div class="meta-grid">
        <div><span>${T("التاريخ")}</span>${escapeHtml(h.date)}</div>
        <div><span>${T("القسم")}</span>${escapeHtml(h.department)}</div>
        <div><span>${T("المنطقة")}</span>${escapeHtml(h.area)}</div>
        ${(h.hseName || h.hseReviewer) ? `<div><span>${T("مشرف السلامة")}</span>${escapeHtml(h.hseName || h.hseReviewer)}</div>` : ''}
      </div>
      <div class="hz-risk-row">
        <span class="hz-risk-label">${T("مستوى الخطورة:")}</span>
        <div class="hz-risk-badge ${riskClass}">${riskStr}</div>
      </div>
      <div class="desc"><strong>${T("وصف الخطورة:")}</strong><br>${escapeHtml(h.description)}</div>
      ${h.potentialInjury ? `<div class="desc"><strong>${T("الإصابة المحتملة:")}</strong><br>${escapeHtml(h.potentialInjury)}</div>` : ''}
      ${h.proposedSolution ? `<div class="desc"><strong>${T("الحل المقترح:")}</strong><br>${escapeHtml(h.proposedSolution)}</div>` : ''}
      ${h.actionTaken ? `<div class="desc desc-action"><strong>${T("الإجراء المتخذ:")}</strong><br>${escapeHtml(h.actionTaken)}</div>` : ''}
      ${h.assignNotes ? `<div class="desc desc-info"><strong>${T("ملاحظات التوجيه للصيانة:")}</strong><br>${escapeHtml(h.assignNotes)}</div>` : ''}
      ${h.photoUrl ? `<div class="hz-photo-link"><div class="hz-photo-badge" onclick="openLightbox(${jsArg(h.photoUrl)})">${T("🖼️ عرض الصورة")}</div></div>` : ''}
      ${_hzViewersHtml(h)}
      ${forwardsHtml(h.forwards)}
      <div class="btn-row card-tools">
        <button class="btn btn-info btn-sm" type="button" onclick="openPrintWithAuth(${jsArg('/print/hazard/' + encodeURIComponent(h.id))})">${T("🖨️ طباعة")}</button>
        ${canForwardByEmail() && currentHzStatusFilter !== '🗑️ المحذوفات' ? `<button class="btn btn-export btn-sm btn-forward" type="button" onclick="openEmailSendModal('forward', ${jsArg(h.id)})">${T('📧 توجيه بالإيميل')}</button>` : ''}
      </div>
      ${actionHtml}
      ${timelineHtml}
      ${manageHtml}
    </div>
  `;
}

window._hazardsRawCache = null;

// List order: open first, then higher risk, then newest. Keep in sync with src/services/hazard-alerts.js.
const HZ_CLOSED_STATUSES = ['resolved', 'closed', 'rejected', 'rejected_by_hse', 'rejected_by_maintenance'];
const HZ_RISK_ORDER = { H: 0, M: 1, L: 2 };
function isHazardClosed(h) {
  const s = String((h && h.status) || '').toLowerCase().trim();
  if (HZ_CLOSED_STATUSES.includes(s)) return true;
  return /مغلق|closed|resolved|rejected|مرفوض|تمت المعالجة/.test(s);
}
// Overdue: still waiting for a first decision (open) past the chosen number of days.
function isHazardOverdue(h) {
  return (!h.status || h.status === 'open') && hoursSince(h.submittedAt || h.date) >= overdueDays * 24;
}
function _hzDeletedForMe(h) {
  const roleKey = getRoleKey(currentUserRole);
  if (h.permanentlyDeletedBy && h.permanentlyDeletedBy[roleKey] === true) return true;
  if (currentUserRole === 'maint_admin') return Boolean(h.deletedByMaintenance || h.deleted);
  const deletedBy = (typeof h.deletedBy === 'object' && h.deletedBy !== null) ? h.deletedBy : {};
  return deletedBy[roleKey] === true || h.deleted === true;
}
function hzOverdueCount() {
  return (window._hazardsRawCache || []).filter(h => !_hzDeletedForMe(h) && isHazardOverdue(h)).length;
}
// Overdue list order: higher risk first, then the longest waiting.
function compareOverdueHazards(a, b) {
  const ra = HZ_RISK_ORDER[String((a && a.riskLevel) || '').toUpperCase()] ?? 3;
  const rb = HZ_RISK_ORDER[String((b && b.riskLevel) || '').toUpperCase()] ?? 3;
  if (ra !== rb) return ra - rb;
  return new Date(a.submittedAt || a.date || 0) - new Date(b.submittedAt || b.date || 0);
}

const HZ_VIEWER_ROLE = { super_admin: 'مدير النظام', hse_admin: 'مشرف السلامة', dept_admin: 'أدمن قسم', maint_admin: 'أدمن صيانة' };
function _hzViewersHtml(h) {
  const viewers = Array.isArray(h.viewers) ? h.viewers : [];
  if (!viewers.length) return '';
  return `<div class="card-note">👁️ ${T('فتحه:')} ${viewers.map(v => {
    const role = HZ_VIEWER_ROLE[v.role] ? ` (${T(HZ_VIEWER_ROLE[v.role])})` : '';
    return `${escapeHtml(v.name)}${escapeHtml(role)} · ${escapeHtml(formatDateTime(v.at))}`;
  }).join('، ')}</div>`;
}

function compareHazardsForList(a, b) {
  const ca = isHazardClosed(a) ? 1 : 0, cb = isHazardClosed(b) ? 1 : 0;
  if (ca !== cb) return ca - cb;
  const ra = HZ_RISK_ORDER[String((a && a.riskLevel) || '').toUpperCase()] ?? 3;
  const rb = HZ_RISK_ORDER[String((b && b.riskLevel) || '').toUpperCase()] ?? 3;
  if (ra !== rb) return ra - rb;
  return new Date(b.submittedAt || b.date || 0) - new Date(a.submittedAt || a.date || 0);
}

let _hzAlertCache = null;

async function openHazardAlertSettings() {
  openAppModal(`<div id="hzAlertBox"><div class="loading">${T('جارِ التحميل…')}</div></div>`);
  const card = document.querySelector('#appModalOverlay .app-modal-card');
  if (card) { card.style.maxWidth = 'min(680px, 94vw)'; card.style.width = 'min(680px, 94vw)'; }
  try {
    const res = await authFetch('/api/hazards/alert-settings');
    if (!res.ok) throw new Error('fetch failed');
    _hzAlertCache = await res.json();
    _renderHazardAlertBox(_hzAlertCache);
  } catch (e) {
    const box = document.getElementById('hzAlertBox');
    if (box) box.innerHTML = `<div style="color:var(--danger-text);font-size:13px;">${T('فشل تحميل الإعدادات')}</div>`;
  }
}

function _hzAlertRowHtml(r, i) {
  return `<div class="hza-row" data-i="${i}">
    <input type="text" class="hza-name" value="${escapeHtml(r.name || '')}" placeholder="${T('الاسم')}" />
    <input type="text" class="hza-code" value="${escapeHtml(r.empCode || '')}" placeholder="${T('الكود')}" dir="ltr" inputmode="numeric" />
    <input type="email" class="hza-email" value="${escapeHtml(r.email || '')}" placeholder="name@company.com" dir="ltr" />
    <label class="hza-on" title="${T('مفعّل')}"><input type="checkbox" class="hza-enabled" ${r.enabled === false ? '' : 'checked'} /></label>
    <button type="button" class="btn btn-ghost btn-icon btn-sm btn-danger-icon" onclick="hzAlertRemoveRow(${i})" title="${T('حذف')}" aria-label="${T('حذف')}">✕</button>
  </div>`;
}

function _renderHazardAlertBox(s) {
  const box = document.getElementById('hzAlertBox');
  if (!box) return;
  const recipients = Array.isArray(s.recipients) ? s.recipients : [];
  const last = s.lastResult;
  const lastTxt = !last ? T('لسه مااتبعتش أي تنبيه.')
    : `${last.ok ? '✅' : '❌'} ${T('آخر تنبيه:')} ${escapeHtml(last.hazardId || '')} — ${new Date(last.at).toLocaleString('ar-EG')}${last.ok ? '' : ` — ${escapeHtml(last.error || '')}`}`;

  box.innerHTML = `
    <div style="font-weight:700;font-size:16px;margin-bottom:6px;">${T('🔴 تنبيه بلاغات الخطورة العالية بالإيميل')}</div>
    <div style="font-size:12px;color:var(--text-muted);line-height:1.8;margin-bottom:10px;">
      ${T('أول ما يتسجّل بلاغ خطورة عالية (High) بيتبعت إيميل فوري بتفاصيل البلاغ وصورته للأسماء اللي تحت دي بس.')}
    </div>
    ${s.smtpConfigured
      ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${T('بيتبعت من:')} <b dir="ltr">${escapeHtml(s.from || '')}</b></div>`
      : `<div class="bk-email-warn">${T('⚠️ إيميل الإرسال لسه مش متظبط — اظبطه من شاشة سجل التدقيق ← "بيانات إيميل الإرسال"، وبعدها التنبيه هيشتغل.')}</div>`}

    <label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;margin:0 0 10px;">
      <input type="checkbox" id="hzAlertEnabled" ${s.highRiskEnabled ? 'checked' : ''} />
      ${T('فعّل التنبيه الفوري للخطورة العالية')}
    </label>

    <div style="font-weight:700;font-size:13px;margin-bottom:6px;">${T('المستلمين')}</div>
    <div id="hzAlertRows">${recipients.map(_hzAlertRowHtml).join('') || `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">${T('مفيش مستلمين — ضيف واحد.')}</div>`}</div>
    <button type="button" class="btn btn-secondary btn-sm hza-add" onclick="hzAlertAddRow()">${T('➕ إضافة مستلم')}</button>

    <label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;margin:0 0 8px;">
      <input type="checkbox" id="hzAlertOverdue" ${s.overdueEnabled ? 'checked' : ''} />
      ${T('ذكّرني بالبلاغات العالية اللي فضلت مفتوحة بعد')}
      <input type="number" id="hzAlertHours" min="1" max="720" value="${Number(s.overdueHours) || 48}" style="width:80px;" />
      ${T('ساعة')}
    </label>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">${T('التذكير بيتبعت مرة واحدة بس لكل بلاغ.')}</div>

    <label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;margin:0 0 4px;">
      <input type="checkbox" id="hzAlertAfterPhoto" ${s.requireAfterPhoto === false ? '' : 'checked'} />
      ${T('اطلب صورة "بعد الإصلاح" قبل إغلاق أي بلاغ')}
    </label>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;">${T('الصورة بتتحفظ مع البلاغ وبتظهر في نسخة الطباعة.')}</div>

    <div class="btn-row">
      <button class="btn btn-primary" type="button" onclick="saveHazardAlertSettings()">${T('💾 حفظ')}</button>
      <button class="btn btn-export" type="button" id="hzAlertTestBtn" onclick="testHazardAlertEmail()" ${s.smtpConfigured ? '' : 'disabled'}>${T('📤 ابعت تجربة')}</button>
    </div>
    <div id="hzAlertStatus" style="font-size:12px;margin-top:10px;color:var(--text-muted);">${lastTxt}</div>
  `;
}

function hzAlertReadRows() {
  return [...document.querySelectorAll('#hzAlertRows .hza-row')].map(row => ({
    name:    (row.querySelector('.hza-name')  || {}).value || '',
    empCode: (row.querySelector('.hza-code')  || {}).value || '',
    email:   (row.querySelector('.hza-email') || {}).value || '',
    enabled: !!(row.querySelector('.hza-enabled') || {}).checked,
  })).filter(r => r.email.trim() || r.name.trim() || r.empCode.trim());
}

function hzAlertAddRow() {
  const rows = hzAlertReadRows();
  rows.push({ name: '', empCode: '', email: '', enabled: true });
  document.getElementById('hzAlertRows').innerHTML = rows.map(_hzAlertRowHtml).join('');
}

function hzAlertRemoveRow(i) {
  const rows = hzAlertReadRows();
  rows.splice(i, 1);
  const el = document.getElementById('hzAlertRows');
  el.innerHTML = rows.length ? rows.map(_hzAlertRowHtml).join('') : `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">${T('مفيش مستلمين — ضيف واحد.')}</div>`;
}

async function saveHazardAlertSettings() {
  const body = {
    highRiskEnabled:   document.getElementById('hzAlertEnabled').checked,
    overdueEnabled:    document.getElementById('hzAlertOverdue').checked,
    overdueHours:      Number(document.getElementById('hzAlertHours').value) || 48,
    requireAfterPhoto: document.getElementById('hzAlertAfterPhoto').checked,
    recipients:        hzAlertReadRows().filter(r => r.email.trim()),
  };
  try {
    const res = await authFetch('/api/hazards/alert-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || T('فشل الحفظ'), 'error'); return; }
    _hzAlertCache = data;
    _renderHazardAlertBox(data);
    showToast(T('تم حفظ الإعدادات ✓'), 'success');
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

async function testHazardAlertEmail() {
  const btn = document.getElementById('hzAlertTestBtn');
  if (btn) btn.disabled = true;
  showToast(T('جارِ إرسال رسالة تجريبية…'), 'info');
  try {
    const res = await authFetch('/api/hazards/alert-settings/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) showToast(`${T('اتبعتت التجربة إلى')} ${(data.sentTo || []).join(', ')}`, 'success');
    else showToast(data.error || T('فشل الإرسال'), 'error');
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
  if (btn) btn.disabled = false;
}

const HZ_PAGE_SIZE = 50;
function hzShowMore() {
  window._hzShowCount = (window._hzShowCount || HZ_PAGE_SIZE) + HZ_PAGE_SIZE;
  renderSupHazard(true, false, true);
}

// Reviewers report what they actually opened: a report's first sighting, and who looked at reports
// still waiting for action (shown on the card). Each id is sent once per page load.
const _hzSeenSent = new Set();
function _markHazardsSeen(list) {
  if (!['super_admin', 'hse_admin', 'dept_admin', 'maint_admin'].includes(currentUserRole)) return;
  const ids = list
    .filter(h => h && h.id && (!h.seenAt || !h.status || h.status === 'open') && !_hzSeenSent.has(String(h.id)))
    .map(h => String(h.id));
  if (!ids.length) return;
  ids.forEach(id => _hzSeenSent.add(id));
  authFetch('/api/hazards/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  }).catch(() => {});
}

async function renderSupHazard(isSilent = false, forceRefetch = true, skipFilterBar = false) {
  // Keep the current cards on screen while an unchanged list is revalidated.
  if (!isSilent && !window._hzRendered) document.getElementById('hzList').innerHTML = T('<div class="loading">جارِ التحميل…</div>');

  const hzArea = document.getElementById('hzUserProfileChip');
  if (hzArea && document.getElementById('supUserProfileChip')) {
    hzArea.innerHTML = document.getElementById('supUserProfileChip').innerHTML;
  }

  if (!skipFilterBar) await renderHzFilters();

  try {
    let hazards;
    if (forceRefetch || !window._hazardsRawCache) {
      const r = await fetchJsonIfChanged('/api/hazards');
      if (!r.ok) throw new Error('Failed to fetch');
      hazards = (r.data && r.data.hazards) || [];
      window._hazardsRawCache = hazards;
    } else {
      hazards = window._hazardsRawCache;
    }
    const overdueCountEl = document.getElementById('hzOverdueCount');
    if (overdueCountEl) overdueCountEl.textContent = hzOverdueCount();
    const rawList = hazards;

    const openCount = hazards.filter(h => h.status === 'open').length;
    const badgeEl = document.getElementById('hzSupBadge');
    if (badgeEl) {
      if (openCount > 0) {
        badgeEl.textContent = openCount;
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }
    }

    const currentRoleKey = getRoleKey(currentUserRole);
    if (currentHzStatusFilter === '🗑️ المحذوفات') {
       hazards = hazards.filter(h => {
         const isPermanentlyDeletedForMe = h.permanentlyDeletedBy && h.permanentlyDeletedBy[currentRoleKey] === true;
         if (isPermanentlyDeletedForMe) return false;
         if (currentUserRole === 'maint_admin') {
             return h.deletedByMaintenance && h.maintenanceDeletedDept === currentUserDept;
         }
         const deletedBy = (typeof h.deletedBy === 'object' && h.deletedBy !== null) ? h.deletedBy : {};
         return deletedBy[currentRoleKey] === true || h.deleted === true;
       });
    } else {
       hazards = hazards.filter(h => {
         const isPermanentlyDeletedForMe = h.permanentlyDeletedBy && h.permanentlyDeletedBy[currentRoleKey] === true;
         if (isPermanentlyDeletedForMe) return false;
         if (currentUserRole === 'maint_admin') {
             if (h.deletedByMaintenance || h.deleted) return false;
         } else {
             const deletedBy = (typeof h.deletedBy === 'object' && h.deletedBy !== null) ? h.deletedBy : {};
             if (deletedBy[currentRoleKey] === true || h.deleted === true) return false;
         }
         return true;
       });
       if (currentHzStatusFilter !== 'الكل') {
         if (currentHzStatusFilter === OVERDUE_FILTER) hazards = hazards.filter(isHazardOverdue);
         if (currentHzStatusFilter === 'مفتوح 🔴') hazards = hazards.filter(h => h.status === 'open');
         else if (currentHzStatusFilter === 'موجه للصيانة 📢') hazards = hazards.filter(h => h.status === 'assigned_to_maintenance');
         else if (currentHzStatusFilter === 'قيد الإصلاح 🟡') hazards = hazards.filter(h => h.status === 'in_progress');
         else if (currentHzStatusFilter === 'مرفوض ❌') hazards = hazards.filter(h => h.status === 'rejected_by_maintenance' || h.status === 'rejected_by_hse');
         else if (currentHzStatusFilter === 'تم الحل والإغلاق 🟢') hazards = hazards.filter(h => h.status === 'resolved' || h.status === 'closed');
       }
    }
    if (currentHzDeptFilter !== 'الكل' && currentUserRole !== 'maint_admin') {
       const deptQuery = currentHzDeptFilter.trim().toLowerCase();
       const isKnownDept = (window._hzRealDepts || []).includes(currentHzDeptFilter);
       hazards = hazards.filter(h => {
         const dep = String(h.department || '');
         return isKnownDept ? dep === currentHzDeptFilter : dep.toLowerCase().includes(deptQuery);
       });
    }
    if (currentHzSeverityFilter !== 'الكل') {
       hazards = hazards.filter(h => h.riskLevel === currentHzSeverityFilter);
    }
    if (currentHzYearFilter !== 'الكل') {
       hazards = hazards.filter(h => {
         const d = new Date(h.submittedAt || h.createdAt || h.date);
         if (isNaN(d.getTime())) return false;
         return String(d.getFullYear()) === currentHzYearFilter;
       });
    }

    const fTime = document.getElementById('filter_hz_timeframe')?.value || 'all';
    const fReporter = document.getElementById('filter_hz_reporter')?.value?.toLowerCase();
    const fHse = document.getElementById('filter_hz_hse')?.value?.toLowerCase();
    const fFrom = document.getElementById('filter_hz_dateFrom')?.value;
    const fTo   = document.getElementById('filter_hz_dateTo')?.value;

    hazards = hazards.filter(h => {
      let match = true;
      if (fTime !== 'all') {
        const days = parseInt(fTime);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        if (new Date(h.submittedAt || h.createdAt || h.date) < cutoff) match = false;
      }
      if (fReporter && !(h.reporterName || h.reportedBy || '').toLowerCase().includes(fReporter)) match = false;
      if (fHse && !(h.hseName || h.hseReviewer || '').toLowerCase().includes(fHse)) match = false;
      if (fFrom || fTo) {
        const raw = h.submittedAt || h.createdAt || h.date;
        const hDate = raw ? new Date(raw).toISOString().slice(0, 10) : '';
        if (!hDate) match = false;
        else {
          if (fFrom && hDate < fFrom) match = false;
          if (fTo && hDate > fTo) match = false;
        }
      }
      return match;
    });

    hazards.sort(currentHzStatusFilter === OVERDUE_FILTER ? compareOverdueHazards : compareHazardsForList);
    window._currentFilteredHazards = hazards;

    const hzCountEl = document.getElementById('hzFilterCount');
    if (hzCountEl) hzCountEl.textContent = `${T("عدد النتائج:")} ${hazards.length}`;

    const listEl = document.getElementById('hzList');
    const hzSig = [currentHzStatusFilter, overdueDays, currentHzSeverityFilter, currentHzDeptFilter, currentHzYearFilter,
      fTime, fReporter || '', fHse || '', fFrom || '', fTo || ''].join('|');
    if (hzSig !== window._hzListSig) { window._hzListSig = hzSig; window._hzShowCount = HZ_PAGE_SIZE; }
    const hzShow = window._hzShowCount || HZ_PAGE_SIZE;

    // Same data, filters, page size, role and language as what is already on screen: nothing to redraw.
    const prev = window._hzRendered;
    const viewKey = [hzSig, hzShow, currentUserRole, currentUserDept, window._currentLang].join('|');
    if (prev && prev.raw === rawList && prev.key === viewKey && listEl.dataset.hzRendered === '1') return;

    if (hazards.length === 0) {
      listEl.innerHTML = T('<div class="empty"><div class="icon">⚠️</div>لا توجد بلاغات حالياً</div>');
    } else {
      const shown = hazards.slice(0, hzShow);
      let html = '';
      shown.forEach(h => {
        html += getHazardCardHtml(h);
      });
      if (hazards.length > hzShow) {
        html += `<div class="pm-more"><button type="button" class="btn btn-secondary" onclick="hzShowMore()">${T('عرض المزيد')} (${hazards.length - hzShow} ${T('متبقي')})</button></div>`;
      }
      listEl.innerHTML = html;
      _markHazardsSeen(shown);
    }
    listEl.dataset.hzRendered = '1';
    window._hzRendered = { raw: rawList, key: viewKey };

  } catch(e) {
    const listEl = document.getElementById('hzList');
    listEl.innerHTML = T('<div class="empty">خطأ في جلب البيانات</div>');
    listEl.dataset.hzRendered = '';
    window._hzRendered = null;
  }
}

window.applyHazardFilters = window.debounce(function() {
  renderSupHazard(true, false);
}, 250);

window.clearHazardFilters = function() {
  const el1 = document.getElementById('filter_hz_timeframe');
  const el2 = document.getElementById('filter_hz_reporter');
  const el3 = document.getElementById('filter_hz_hse');
  const el4 = document.getElementById('filter_hz_dateFrom');
  const el5 = document.getElementById('filter_hz_dateTo');
  if (el1) el1.value = 'all';
  if (el2) el2.value = '';
  if (el3) el3.value = '';
  if (el4) el4.value = '';
  if (el5) el5.value = '';
  renderSupHazard(true, false);
};

async function renderHzFilters() {
  const fArea = document.getElementById('hzFilters');
  const dArea = document.getElementById('hzDeptFilters');
  const dToolbar = document.getElementById('hzDeptToolbar');

  const statuses = ['الكل', OVERDUE_FILTER, 'مفتوح 🔴', 'موجه للصيانة 📢', 'قيد الإصلاح 🟡', 'مرفوض ❌', 'تم الحل والإغلاق 🟢', '🗑️ المحذوفات'];
  fArea.innerHTML = statuses.map(s => {
    const label = s === OVERDUE_FILTER ? `${T(s)} <span class="chip-count" id="hzOverdueCount">${hzOverdueCount()}</span>` : T(s);
    return `<div class="chip${s === OVERDUE_FILTER ? ' chip-overdue' : ''} ${currentHzStatusFilter===s?'active':''}" onclick="setHzFilter(${jsArg(s)})">${label}</div>`;
  }).join('') + (currentHzStatusFilter === OVERDUE_FILTER ? overdueDaysSelectHtml('hazards') : '');

  if (currentUserRole !== 'dept_admin' && currentUserRole !== 'maint_admin') {
    dToolbar.style.display = 'flex';
    if (!(dArea.dataset.built === '1' && document.activeElement && document.activeElement.id === 'hzDeptFilterInput')) {
      const realDepts = await loadRealDepartments();
      window._hzRealDepts = realDepts;
      const currentVal = currentHzDeptFilter === 'الكل' ? '' : currentHzDeptFilter;
      dArea.innerHTML = `
        <input type="text" id="hzDeptFilterInput" class="dept-filter-input" list="hzDeptDatalist"
          placeholder="${T("🏢 اختر أو اكتب اسم القسم...")}" value="${escapeAttr(currentVal)}"
          oninput="onHzDeptFilterInput(this.value)" autocomplete="off"
          style="min-width:220px;flex:1;max-width:320px;">
        <datalist id="hzDeptDatalist">
          ${realDepts.map(d => `<option value="${escapeAttr(d)}"></option>`).join('')}
        </datalist>
        ${currentHzDeptFilter !== 'الكل' ? `<div class="chip active" onclick="setHzDeptFilterFromInput('')">${T("✕ إلغاء فلتر القسم")}</div>` : ''}
      `;
      dArea.dataset.built = '1';
    }
  } else {
    dToolbar.style.display = 'none';
  }

  const sArea = document.getElementById('hzSeverityPillsFilters');
  if (sArea) {
    const severities = [
      { label: T('الكل'), val: 'الكل' },
      { label: T('عالي 🔴'), val: 'H' },
      { label: T('متوسط 🟡'), val: 'M' },
      { label: T('منخفض 🟢'), val: 'L' }
    ];
    sArea.innerHTML = severities.map(s =>
      `<div class="chip ${currentHzSeverityFilter===s.val?'active':''}" onclick="setHzSeverityFilter(${jsArg(s.val)})">${s.label}</div>`
    ).join('');
  }

  const yArea = document.getElementById('hzYearFilters');
  if (yArea) {
    const years = ['الكل', ...FILTER_YEARS];
    yArea.innerHTML = years.map(y =>
      `<div class="chip ${currentHzYearFilter===y?'active':''}" onclick="setHzYearFilter(${jsArg(y)})">${T(y)}</div>`
    ).join('');
  }
}

function setHzFilter(f) {
  currentHzStatusFilter = f;
  renderSupHazard(true, false);
}
function setHzDeptFilter(d) {
  currentHzDeptFilter = d;
  renderSupHazard(true, false);
}
function setHzDeptFilterFromInput(v) {
  currentHzDeptFilter = (v && v.trim()) ? v.trim() : 'الكل';
  renderSupHazard(true, false, true);
}
window.onHzDeptFilterInput = window.debounce(function(v) {
  setHzDeptFilterFromInput(v);
}, 300);
function setHzSeverityFilter(v) {
  currentHzSeverityFilter = v;
  renderSupHazard(true, false);
}
function setHzYearFilter(y) {
  currentHzYearFilter = y;
  renderSupHazard(true, false);
}
