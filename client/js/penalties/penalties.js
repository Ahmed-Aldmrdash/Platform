// Penalties: worker view, admin list, add/delete modals and Excel import/export.

let penaltyToDelete = '';
let penaltiesAdminCache = [];

async function renderMyPenalties() {
  const listEl = document.getElementById('myPenaltiesList');
  if (!listEl) return;
  if (!currentEmployee) {
    listEl.innerHTML = `<div class="empty"><div class="icon">🔒</div>${T("سجّل دخولك أولاً لعرض الجزاءات")}</div>`;
    return;
  }
  listEl.innerHTML = T('<div class="loading">جارِ تحميل الجزاءات…</div>');

  try {
    const code = encodeURIComponent(currentEmployee.empCode || currentEmployee.code || '');
    const res = await authFetch(`/api/my-penalties/${code}`);
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    const penalties = data.penalties || [];

    if (penalties.length === 0) {
      listEl.innerHTML = `<div class="empty"><div class="icon">✅</div>${T("لا يوجد أي جزاءات مسجلة عليك")}</div>`;
      return;
    }

    listEl.innerHTML = penalties.map(p => `
      <div class="sup-card" style="margin-bottom:12px;border-right:4px solid var(--danger-solid);">
        <div class="sup-top">
          <div><div class="hz-status-badge hz-high">${T("⚖️ جزاء")}</div></div>
          <div class="tnum">${escapeHtml(p.date || '')}</div>
        </div>
        <div style="margin:10px 0;font-size:14px;line-height:1.6;">${escapeHtml(p.reason || '')}</div>
        <div class="meta-grid">
          <div><span>${T("مشرف السيفتي")}</span>${escapeHtml(p.issuedBy || '—')}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
    listEl.innerHTML = `<div class="empty"><div class="icon">⚠️</div>${T("تعذّر تحميل الجزاءات، حاول مجدداً")}</div>`;
  }
}

function _canManagePenalties() {
  return currentUserRole === 'super_admin' || currentUserRole === 'hse_admin';
}

async function renderPenaltiesAdmin() {
  const listEl = document.getElementById('penaltiesAdminList');
  const btnsEl = document.getElementById('penaltiesAdminButtons');
  const noticeEl = document.getElementById('penaltiesReadOnlyNotice');
  if (!listEl) return;

  const canManage = _canManagePenalties();
  if (btnsEl) btnsEl.style.display = canManage ? 'flex' : 'none';
  if (noticeEl) noticeEl.style.display = canManage ? 'none' : 'block';

  listEl.innerHTML = T('<div class="loading">جارِ تحميل الجزاءات…</div>');

  try {
    const res = await authFetch('/api/penalties');
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    penaltiesAdminCache = (data.penalties || []).filter(p => p.status !== 'deleted');

    if (penaltiesAdminCache.length === 0) {
      listEl.innerHTML = `<div class="empty"><div class="icon">✅</div>${T("لا توجد أي جزاءات مسجلة حالياً")}</div>`;
      return;
    }

    listEl.innerHTML = penaltiesAdminCache.map(p => `
      <div class="sup-card penalty-card" style="margin-bottom:12px;border-right:4px solid var(--danger-solid);">
        <div class="sup-top">
          <div>
            <div class="hz-status-badge hz-high">⚖️ ${escapeHtml(p.empName || p.empCode || '')}</div>
          </div>
          <div class="tnum">${escapeHtml(p.date || '')}</div>
        </div>
        <div class="meta-grid">
          <div><span>${T("الكود الوظيفي")}</span>${escapeHtml(p.empCode || '')}</div>
          <div><span>${T("الوظيفة")}</span>${escapeHtml(p.jobTitle || '—')}</div>
          <div><span>${T("القسم")}</span>${escapeHtml(p.department || '—')}</div>
          <div><span>${T("مشرف السيفتي")}</span>${escapeHtml(p.issuedBy || '—')}</div>
        </div>
        <div style="margin:10px 0;font-size:14px;line-height:1.6;">${escapeHtml(p.reason || '')}</div>
        ${canManage ? `
        <div class="card-danger">
          <button class="btn btn-danger btn-sm" onclick="openDeletePenaltyModal(${jsArg(p.id)})">${T("🗑️ حذف الجزاء")}</button>
        </div>` : ''}
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
    listEl.innerHTML = `<div class="empty"><div class="icon">⚠️</div>${T("تعذّر تحميل الجزاءات، حاول مجدداً")}</div>`;
  }
}

function openAddPenaltyModal() {
  if (!_canManagePenalties()) { showToast(T('لا تملك صلاحية إضافة جزاء'), 'error'); return; }
  document.getElementById('pen_empCode').value = '';
  document.getElementById('pen_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('pen_reason').value = '';
  document.getElementById('pen_issuedBy').value = (currentEmployee && currentEmployee.name) || '';
  const msg = document.getElementById('addPenaltyMsg');
  if (msg) msg.className = 'um-msg';
  document.getElementById('addPenaltyModal').style.display = 'flex';
}
function closeAddPenaltyModal() {
  document.getElementById('addPenaltyModal').style.display = 'none';
}
async function submitAddPenalty() {
  const empCode = document.getElementById('pen_empCode').value.trim();
  const date = document.getElementById('pen_date').value;
  const reason = document.getElementById('pen_reason').value.trim();
  const issuedBy = document.getElementById('pen_issuedBy').value.trim();
  const msgEl = document.getElementById('addPenaltyMsg');
  msgEl.className = 'um-msg';

  if (!empCode || !reason) {
    msgEl.textContent = T('من فضلك أدخل الكود الوظيفي وسبب الجزاء');
    msgEl.className = 'um-msg error show';
    return;
  }

  try {
    const res = await authFetch('/api/penalties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode, date, reason, issuedBy })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = T('✅ تم إضافة الجزاء بنجاح');
      msgEl.className = 'um-msg success show';
      setTimeout(() => {
        closeAddPenaltyModal();
        renderPenaltiesAdmin();
      }, 800);
    } else {
      msgEl.textContent = data.error || T('فشل إضافة الجزاء');
      msgEl.className = 'um-msg error show';
    }
  } catch (e) {
    msgEl.textContent = T('خطأ في الاتصال بالسيرفر');
    msgEl.className = 'um-msg error show';
  }
}

function openDeletePenaltyModal(id) {
  if (!_canManagePenalties()) { showToast(T('لا تملك صلاحية حذف الجزاء'), 'error'); return; }
  penaltyToDelete = id;
  document.getElementById('deletePenaltyReason').value = '';
  const msg = document.getElementById('deletePenaltyMsg');
  if (msg) msg.className = 'um-msg';
  document.getElementById('deletePenaltyModal').style.display = 'flex';
}
function closeDeletePenaltyModal() {
  document.getElementById('deletePenaltyModal').style.display = 'none';
  penaltyToDelete = '';
}
async function confirmDeletePenalty() {
  const reason = document.getElementById('deletePenaltyReason').value.trim();
  const msgEl = document.getElementById('deletePenaltyMsg');
  msgEl.className = 'um-msg';

  if (!reason) {
    msgEl.textContent = T('من فضلك أدخل سبب الحذف');
    msgEl.className = 'um-msg error show';
    return;
  }

  try {
    const res = await authFetch(`/api/penalties/${encodeURIComponent(penaltyToDelete)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = T('✅ تم حذف الجزاء');
      msgEl.className = 'um-msg success show';
      setTimeout(() => {
        closeDeletePenaltyModal();
        renderPenaltiesAdmin();
      }, 800);
    } else {
      msgEl.textContent = data.error || T('فشل حذف الجزاء');
      msgEl.className = 'um-msg error show';
    }
  } catch (e) {
    msgEl.textContent = T('خطأ في الاتصال بالسيرفر');
    msgEl.className = 'um-msg error show';
  }
}

async function uploadPenaltiesExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const base64Data = dataUrl.split(',')[1];

    showToast(T('جاري رفع الشيت واستيراد الجزاءات...'), 'info');

    try {
      const res = await authFetch('/api/penalties/upload-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`${T("تم استيراد")} ${json.count} ${T("جزاء بنجاح!")}` + (json.skipped ? ` ${T("(تم تخطي")} ${json.skipped} ${T("صف بدون سبب)")}` : ''), 'success');
        renderPenaltiesAdmin();
      } else {
        showToast(json.message || T('حدث خطأ أثناء الرفع'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(T('خطأ في الاتصال بالخادم'), 'error');
    }

    event.target.value = '';
  };
  reader.readAsDataURL(file);
}

window.exportPenaltiesExcel = async function () {
  const rows = penaltiesAdminCache.map(p => ({
    'الكود': String(p.empCode || ''),
    'الاسم': p.empName || '',
    'القسم': p.department || '',
    'الوظيفة': p.jobTitle || '',
    'التاريخ': p.date || '',
    'سبب الجزاء': p.reason || '',
    'مشرف السيفتي': p.issuedBy || ''
  }));

  if (rows.length === 0) {
    showToast(T('لا توجد جزاءات للتصدير'), 'error');
    return;
  }
  if (!(await ensureXlsx())) return;

  try {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 45 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, T('الجزاءات'));
    XLSX.writeFile(wb, `${T("الجزاءات_")}${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) {
    console.error(e);
    showToast(T('تعذّر تصدير الملف'), 'error');
  }
};
