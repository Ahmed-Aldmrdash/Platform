// Worker hazard reporting: my reports list, report form, risk calculation and photo attachment.

async function renderMyHazards(isSilent = false) {
  if (!currentEmployee) {
    const list = document.getElementById('myHazardsList');
    if (list) list.innerHTML = `<div class="empty"><div class="icon">🔒</div>${T("سجّل دخولك أولاً لعرض سجل بلاغاتك")}</div>`;
    return;
  }

  const subEl = document.getElementById('myHazardsSub');
  if (subEl) subEl.textContent = `${currentEmployee.name} · ${currentEmployee.empCode}`;

  const listEl = document.getElementById('myHazardsList');
  if (!isSilent && listEl) listEl.innerHTML = T('<div class="loading">جارِ تحميل بلاغاتك…</div>');

  try {
    const r = await fetchJsonIfChanged(`/api/my-hazards/${encodeURIComponent(currentEmployee.name)}?empCode=${encodeURIComponent(currentEmployee.empCode || currentEmployee.code || '')}`);
    if (!r.ok) throw new Error('Failed to fetch');
    // Background refreshes leave the list alone when the server data has not changed.
    if (isSilent && r.data === window._myHazardsRendered) return;
    window._myHazardsRendered = r.data;
    const myHazards = (r.data && r.data.hazards) || [];

    if (myHazards.length === 0) {
      if (listEl) listEl.innerHTML = `<div class="empty"><div class="icon">📂</div>${T("لا توجد بلاغات مسجلة")}</div>`;
      return;
    }

    let html = '';
    // The response is cached between polls, so reverse a copy.
    myHazards.slice().reverse().forEach(h => {
      let statusStr = 'مفتوح 🔴';
      let statusClass = 'hz-high';
      let pendingDesc = T('بانتظار مراجعة المشرف');

      if (h.status === 'notified') {
        statusStr = T('تم الإبلاغ 📢');
        statusClass = 'hz-medium';
        pendingDesc = T('تم إبلاغ القسم المعني والمتخصصين');
      } else if (h.status === 'in_progress') {
        statusStr = T('قيد المعالجة والإصلاح 🟡');
        statusClass = 'hz-medium';
        pendingDesc = T('جاري العمل على حل المشكلة');
      } else if (h.status === 'resolved' || h.status === 'closed') {
        statusStr = T('تم الحل وإغلاق البلاغ 🟢');
        statusClass = 'hz-low';
        pendingDesc = T('تمت المعالجة بنجاح');
      } else if (h.status && h.status.startsWith('rejected')) {
        statusStr = 'مرفوض ❌';
        statusClass = 'hz-high';
        pendingDesc = T('تم رفض البلاغ');
      }

      let riskStr = h.riskLevel === 'H' ? 'High 🔴' : h.riskLevel === 'M' ? 'Medium 🟡' : 'Low 🟢';
      let riskClass = h.riskLevel === 'H' ? 'hz-high' : h.riskLevel === 'M' ? 'hz-medium' : 'hz-low';

      html += `
        <div class="sup-card" style="margin-bottom:12px;">
          <div class="sup-top">
            <div>
              <div class="hz-status-badge ${statusClass}">${T(statusStr)}</div>
            </div>
            <div class="tnum">${escapeHtml(h.id)}</div>
          </div>
          <div class="meta-grid">
            <div><span>${T("التاريخ")}</span>${escapeHtml(h.date)}</div>
            <div><span>${T("القسم")}</span>${escapeHtml(h.department)}</div>
            <div><span>${T("المنطقة")}</span>${escapeHtml(h.area)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin:12px 0;">
            <span style="font-size:12px; font-weight:bold;">${T("مستوى الخطورة:")}</span>
            <div class="hz-risk-badge ${riskClass}" style="margin:0; padding:4px 8px; font-size:11.5px;">${riskStr}</div>
          </div>
          <div class="desc"><strong>${T("وصف الخطورة:")}</strong><br>${escapeHtml(h.description)}</div>
          ${h.photoUrl ? `<div style="margin-top:8px;"><div class="hz-photo-badge" onclick="openLightbox(${jsArg(h.photoUrl)})">${T("🖼️ عرض الصورة")}</div></div>` : ''}
          <div class="phc-msg" style="margin-top:10px; font-size:12px; color:var(--muted);">${pendingDesc}</div>
          ${h.actionTaken ? `<div class="note-box show" style="margin-top:10px; background-color: #f8f9fa; border-left: 4px solid var(--primary); padding: 10px; border-radius: 4px;">
            <strong>${T("🛠️ الإجراء المتخذ من المشرف (")}${escapeHtml(h.updatedBy || T('إدارة السلامة'))}):</strong><br>
            ${escapeHtml(h.actionTaken)}
          </div>` : ''}
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
            <div class="timeline-step ${h.inProgressAt ? 'done' : 'pending'}">
              <span class="step-icon">⚙️</span>
              <div class="step-info">
                <strong>${T("وقت بدء المعالجة:")}</strong>
                <span>${h.inProgressAt ? `${formatDateTime(h.inProgressAt)} (${escapeHtml(h.inProgressBy || T('الصيانة'))})` : T('بانتظار البدء')}</span>
              </div>
            </div>
            <div class="timeline-step ${h.resolvedAt ? 'done' : 'pending'}">
              <span class="step-icon">✅</span>
              <div class="step-info">
                <strong>${T("وقت الانتهاء والإغلاق:")}</strong>
                <span>${h.resolvedAt ? `${formatDateTime(h.resolvedAt)} (${escapeHtml(h.resolvedBy || T('المشرف'))})` : T('لم ينتهِ بعد')}</span>
              </div>
            </div>
            ${h.status && h.status.startsWith('rejected') ? `
            <div class="timeline-step done" style="border-left-color: var(--danger);">
              <span class="step-icon" style="background: var(--danger); color: white;">❌</span>
              <div class="step-info">
                <strong style="color: var(--danger);">${T("تم رفض البلاغ:")}</strong>
                <span>${h.rejectedAt ? `${formatDateTime(h.rejectedAt)} ${T("(بواسطة:")} ${escapeHtml(h.rejectedBy || T('المشرف'))})` : '—'}</span>
                <br><span style="color: var(--danger); font-size: 11px;">${T("سبب الرفض:")} ${escapeHtml(h.rejectionReason || h.reason || T('لم يتم تحديد سبب'))}</span>
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      `;
    });
    if (listEl) listEl.innerHTML = html;
  } catch (e) {
    if (!isSilent && listEl) listEl.innerHTML = T('<div class="empty">خطأ في جلب البيانات</div>');
  }
}

function initHazardWorker() {
  const elDate = document.getElementById('hz_date');
  if (elDate && !elDate.value) {
    elDate.value = new Date().toISOString().split('T')[0];
  }
  calculateHazardRisk();

  const codeWrap = document.getElementById('hz_codeFieldWrap');
  if (currentEmployee) {
    const elName = document.getElementById('hz_name');
    if (elName && !elName.value) elName.value = currentEmployee.name;
    const elDept = document.getElementById('hz_dept');
    if (elDept) elDept.value = currentEmployee.department || '';
    if (codeWrap) codeWrap.style.display = 'none';
  } else {
    if (codeWrap) codeWrap.style.display = 'block';
    const empCodeEl = document.getElementById('hz_empCode');
    if (empCodeEl) empCodeEl.value = '';
    const msgEl = document.getElementById('hz_codeMsg');
    if (msgEl) msgEl.textContent = '';
  }
}

async function lookupHazardEmpCode() {
  const codeEl = document.getElementById('hz_empCode');
  const msgEl  = document.getElementById('hz_codeMsg');
  if (!codeEl || !codeEl.value.trim()) return;
  const rawInput = codeEl.value;
  const cleanCode = String(rawInput || '').trim().replace(/^0+/, '') || '0';
  try {
    const res  = await authFetch(`/api/employees/lookup/${encodeURIComponent(cleanCode)}`);
    const data = await res.json();
    if (data.found) {
      const emp = data.employee;
      const nameEl = document.getElementById('hz_name');
      const deptEl = document.getElementById('hz_dept');
      if (nameEl) { nameEl.value = emp.name; nameEl.setAttribute('readonly','readonly'); }
      if (deptEl) deptEl.value = emp.department || '';
      if (msgEl) { msgEl.textContent = `✅ ${emp.name} — ${emp.department || ''}`; msgEl.style.color = 'var(--success)'; }
    } else {
      if (msgEl) { msgEl.textContent = T('الكود غير مسجل، يرجى كتابة البيانات يدوياً'); msgEl.style.color = 'var(--muted)'; }
      const nameEl = document.getElementById('hz_name');
      if (nameEl) nameEl.removeAttribute('readonly');
    }
  } catch(e) {
    if (msgEl) { msgEl.textContent = T('خطأ في البحث'); msgEl.style.color = 'var(--danger)'; }
  }
}

function calculateHazardRisk() {
  const likelihoodEl = document.getElementById('hz_likelihood');
  const severityEl = document.getElementById('hz_severity');
  if (!likelihoodEl || !severityEl) return;

  const l = parseInt(likelihoodEl.value, 10) || 1;
  const sMap = { 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5 };
  const sVal = severityEl.value;
  const s = sMap[sVal] || 1;

  const score = l * s;
  let level = 'L';
  let badgeClass = 'hz-low';
  let text = 'Low (L) 🟢';

  if (score >= 10 && score <= 14) {
      level = 'M';
      badgeClass = 'hz-medium';
      text = 'Medium (M) 🟡';
  } else if (score >= 15) {
      level = 'H';
      badgeClass = 'hz-high';
      text = 'High (H) 🔴';
  } else if (score >= 5 && score < 15) {
      level = 'M';
      badgeClass = 'hz-medium';
      text = 'Medium (M) 🟡';
  } else {
      level = 'L';
      badgeClass = 'hz-low';
      text = 'Low (L) 🟢';
  }

  const badge = document.getElementById('hz_riskBadge');
  if (badge) {
    badge.className = `hz-risk-badge ${badgeClass}`;
    badge.textContent = text;
    badge.dataset.level = level;
  }
}

let currentHazardPhotoBase64 = null;
function handleHazardPhotoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 1200;
      let width = img.width;
      let height = img.height;
      if (width > MAX_WIDTH) {
        height = Math.round(height * MAX_WIDTH / width);
        width = MAX_WIDTH;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('hz_photoPreviewImg').src = compressedDataUrl;
      document.getElementById('hz_photoPreviewBox').style.display = 'block';
      currentHazardPhotoBase64 = compressedDataUrl;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function confirmHazardPhoto() {
  showToast(T('تم اعتماد الصورة بنجاح ✅'), 'success');
}
function removeHazardPhoto() {
  currentHazardPhotoBase64 = null;
  document.getElementById('hz_photoPreviewImg').src = '';
  document.getElementById('hz_photoPreviewBox').style.display = 'none';
  document.getElementById('hz_photoInput').value = '';
}

async function submitHazardReport() {
  const reporterName = document.getElementById('hz_name').value.trim();
  const date = document.getElementById('hz_date').value;
  const department = document.getElementById('hz_dept').value;
  const area = document.getElementById('hz_area').value.trim();
  const description = document.getElementById('hz_desc').value.trim();
  const potentialInjury = document.getElementById('hz_injury').value.trim();
  const proposedSolution = document.getElementById('hz_solution').value.trim();
  const likelihood = document.getElementById('hz_likelihood').value;
  const severity = document.getElementById('hz_severity').value;

  const empCodeInput = document.getElementById('hz_empCode');
  const empCode = empCodeInput ? empCodeInput.value.trim() : '';

  const riskBadge = document.getElementById('hz_riskBadge');
  const riskLevel = riskBadge ? riskBadge.dataset.level : 'L';

  if (!reporterName || !date || !department || !area || !description || !potentialInjury) {
    showToast(T('يرجى ملء جميع الحقول المطلوبة'), 'error');
    return;
  }

  const btn = document.getElementById('hz_submitBtn');
  btn.disabled = true;
  btn.textContent = T('جارِ الإرسال...');

  try {
    const payload = {
      reporterName, empCode, date, department, area, description, potentialInjury, proposedSolution,
      likelihood, severity, riskLevel
    };
    if (currentHazardPhotoBase64) {
      payload.photo = currentHazardPhotoBase64;
    }

    console.log('[submitHazardReport] Sending payload:', payload);

    const res = await authFetch('/api/hazards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const result = await res.json();
      console.log('[submitHazardReport] Server response success:', result);

      const msgEl = document.getElementById('hz_msg');
      if (msgEl) {
        msgEl.className = 'wl-msg success';
        msgEl.textContent = T('تم إرسال البلاغ بنجاح! شكراً لتعاونك.');
        setTimeout(() => msgEl.textContent = '', 5000);
      }
      showToast(T('تم إرسال البلاغ بنجاح! شكراً لتعاونك.'), 'success');
      document.getElementById('hz_area').value = '';
      document.getElementById('hz_desc').value = '';
      document.getElementById('hz_injury').value = '';
      document.getElementById('hz_solution').value = '';
      document.getElementById('hz_likelihood').value = '1';
      document.getElementById('hz_severity').value = 'A';
      calculateHazardRisk();
      removeHazardPhoto();
    } else {
      const data = await res.json();
      showToast(data.error || T('حدث خطأ أثناء الإرسال'), 'error');
    }
  } catch (err) {
    showToast(T('خطأ في الاتصال بالخادم'), 'error');
  }

  btn.disabled = false;
  btn.textContent = T('إرسال البلاغ ←');
}
