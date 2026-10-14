// Hazard workflow (assign, maintenance, resolve, reject, trash), Excel import/export and module data reset.

window.resolveHazardPrompt = async function(hazardId) {
  const correctiveAction = window.prompt(T("يرجى كتابة الإجراء التصحيحي المتخذ لإغلاق هذا البلاغ:"));
  if (correctiveAction === null) return;
  if (!correctiveAction.trim()) {
    showToast(T("⚠️ يجب كتابة الإجراء التصحيحي قبل إغلاق البلاغ"), 'error');
    return;
  }

  try {
    const res = await fetch(`/api/hazards/${hazardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        status: 'resolved',
        corrective_action: correctiveAction.trim(),
        correctiveAction: correctiveAction.trim(),
        actionTaken: correctiveAction.trim(),
        action_taken: correctiveAction.trim(),
        action: correctiveAction.trim()
      })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || errData.message || T('فشل تحديث حالة البلاغ'));
    }
    if (typeof loadHazards === 'function') loadHazards();
    if (typeof renderSupHazard === 'function') renderSupHazard();
    showToast(T('تم تحديث البلاغ بنجاح'), 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function updateHazardStatus(id, newStatus, actionOverride = null) {
  let actionTaken = actionOverride;
  if (actionTaken === null) {
    const actionArea = document.getElementById(`corrective_action_${id}`) || document.getElementById(`hz_action_${id}`);
    actionTaken = actionArea ? actionArea.value.trim() : '';
  }

  if (newStatus === 'resolved' && !actionTaken) {
    showToast(T('يجب كتابة الإجراء التصحيحي قبل إغلاق البلاغ'), 'error');
    return;
  }

  try {
    const res = await authFetch(`/api/hazards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, actionTaken })
    });

    if (res.ok) {
      showToast(T('تم تحديث البلاغ بنجاح'), 'success');
      const data = await res.json();
      if (data.hazard) {
        const card = document.getElementById(`hz_card_${id}`);
        if (card) {
          card.outerHTML = getHazardCardHtml(data.hazard);
        }
      }
    } else {
      const data = await res.json();
      showToast(data.error || T('فشل التحديث'), 'error');
    }
  } catch(e) {
    showToast(T('خطأ في الاتصال بالخادم'), 'error');
  }
}
let currentHzAssignId = null;
let currentHzResolveId = null;
let currentHzRejectMaintId = null;
let currentHzRejectHseId = null;

async function startHzMaintenance(id) {
  try {
    const res = await authFetch(`/api/hazards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_maintenance' })
    });
    if (res.ok) {
      showToast(T('تم البدء بالإصلاح بنجاح'), 'success');
      renderSupHazard(true);
    } else {
      const d = await res.json();
      showToast(d.error || T('حدث خطأ'), 'error');
    }
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

function openHzRejectMaintModal(id) {
  currentHzRejectMaintId = id;
  document.getElementById('hz_maint_reject_reason').value = '';
  document.getElementById('hzRejectMaintModal').style.display = 'flex';
}
function closeHzRejectMaintModal() {
  document.getElementById('hzRejectMaintModal').style.display = 'none';
}
async function submitHzRejectMaint() {
  const reason = document.getElementById('hz_maint_reject_reason').value.trim();
  if (!reason) return showToast(T('يرجى كتابة سبب الرفض'), 'error');
  try {
    const res = await authFetch(`/api/hazards/${currentHzRejectMaintId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject_maintenance', rejectReason: reason })
    });
    if (res.ok) {
      showToast(T('تم رفض البلاغ وتم إشعار مشرف السلامة'), 'success');
      closeHzRejectMaintModal();
      renderSupHazard(true);
    } else {
      const d = await res.json();
      showToast(d.error || T('حدث خطأ'), 'error');
    }
  } catch (e) { showToast(T('خطأ في الاتصال'), 'error'); }
}

function openHzRejectHseModal(id) {
  currentHzRejectHseId = id;
  document.getElementById('hz_hse_reject_reason').value = '';
  document.getElementById('hzRejectHseModal').style.display = 'flex';
}
function closeHzRejectHseModal() {
  document.getElementById('hzRejectHseModal').style.display = 'none';
}
async function submitHzRejectHse() {
  const reason = document.getElementById('hz_hse_reject_reason').value.trim();
  if (!reason) return showToast(T('يرجى كتابة سبب الرفض'), 'error');
  try {
    const res = await authFetch(`/api/hazards/${currentHzRejectHseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject_hse', rejectReason: reason })
    });
    if (res.ok) {
      showToast(T('تم رفض البلاغ نهائياً'), 'success');
      closeHzRejectHseModal();
      renderSupHazard(true);
    } else {
      const d = await res.json();
      showToast(d.error || T('حدث خطأ'), 'error');
    }
  } catch(e) { showToast(T('خطأ في الاتصال'), 'error'); }
}

// Prefills the trainer name/code on the create-lecture form from the signed-in account.
window.populateTrainerInfo = function() {
  const nameInput = document.getElementById('trn_trainer');
  const codeInput = document.getElementById('trn_trainerCode');
  if (!nameInput || !codeInput) return;

  let currentUser = null;
  try {
    const rawToken = sessionStorage.getItem('wp_auth_token') || localStorage.getItem('wp_auth_token');
    if (rawToken && rawToken.includes('.')) {
      let b64 = rawToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const decodedChars = atob(b64);
      const bytes = new Uint8Array(decodedChars.length);
      for (let i = 0; i < decodedChars.length; i++) bytes[i] = decodedChars.charCodeAt(i);
      currentUser = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    }
  } catch (e) {}

  if (!currentUser || !currentUser.name) {
    try {
      currentUser = JSON.parse(sessionStorage.getItem('employee_session') || localStorage.getItem('user') || '{}');
    } catch(e) {}
  }
  if (!currentUser || !currentUser.name) {
    currentUser = window.currentUser || {};
  }

  const finalName = (currentUser.name || currentUser.fullName || '').trim();
  let finalCode = currentUser.empCode || currentUser.emp_code || currentUser.code || '';

  if ((!finalCode || finalCode === 'superadmin-default') && Array.isArray(window.allEmployees) && finalName) {
    const matched = window.allEmployees.find(e => e && e.name && e.name.trim() === finalName);
    if (matched) {
      finalCode = matched.empCode || matched.emp_code || '';
    }
  }
  if (!finalCode && currentUser.id && !isNaN(currentUser.id)) {
    finalCode = currentUser.id;
  }

  if (finalName) {
    nameInput.value = finalName;
    if (document.getElementById('drl_trainer')) document.getElementById('drl_trainer').value = finalName;
  }
  if (finalCode) {
    codeInput.value = String(finalCode);
    if (document.getElementById('drl_trainerCode')) document.getElementById('drl_trainerCode').value = String(finalCode);
  }

  nameInput.readOnly = true;
  nameInput.style.backgroundColor = '#f1f5f9';
  nameInput.style.cursor = 'not-allowed';

  codeInput.readOnly = true;
  codeInput.style.backgroundColor = '#f1f5f9';
  codeInput.style.cursor = 'not-allowed';
};

function openHzAssignModal(id) {
  currentHzAssignId = id;
  document.getElementById('hz_target_maint').value = '';
  if (document.getElementById('hz_assign_notes')) document.getElementById('hz_assign_notes').value = '';
  document.getElementById('hzAssignModal').style.display = 'flex';
}
function closeHzAssignModal() {
  document.getElementById('hzAssignModal').style.display = 'none';
}
async function submitHzAssign() {
  const target = document.getElementById('hz_target_maint').value;
  const notes = document.getElementById('hz_assign_notes') ? document.getElementById('hz_assign_notes').value.trim() : '';
  if (!target) return showToast(T('يرجى اختيار قسم الصيانة المستهدف'), 'error');
  try {
    const res = await authFetch(`/api/hazards/${currentHzAssignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign_maintenance', targetMaintenance: target, assignNotes: notes })
    });
    if (res.ok) {
      showToast(T('تم التوجيه للصيانة بنجاح'), 'success');
      closeHzAssignModal();
      renderSupHazard(true);
    } else {
      const d = await res.json();
      showToast(d.error || T('حدث خطأ'), 'error');
    }
  } catch(e) { showToast(T('خطأ في الاتصال'), 'error'); }
}

let currentHzResolvePhoto = null;
function onHzResolvePhotoPick(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 1200;
      let width = img.width, height = img.height;
      if (width > MAX_WIDTH) { height = Math.round(height * MAX_WIDTH / width); width = MAX_WIDTH; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      currentHzResolvePhoto = canvas.toDataURL('image/jpeg', 0.75);
      const prev = document.getElementById('hz_resolve_photo_preview');
      prev.src = currentHzResolvePhoto;
      prev.style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function openHzResolveModal(id) {
  currentHzResolveId = id;
  document.getElementById('hz_resolve_action').value = '';
  document.getElementById('hz_resolve_team').value = '';
  currentHzResolvePhoto = null;
  const fileIn = document.getElementById('hz_resolve_photo');
  if (fileIn) fileIn.value = '';
  const prev = document.getElementById('hz_resolve_photo_preview');
  if (prev) { prev.src = ''; prev.style.display = 'none'; }
  const req = document.getElementById('hz_resolve_photo_req');
  if (req) req.style.display = (_hzAlertCache && _hzAlertCache.requireAfterPhoto === false) ? 'none' : '';
  document.getElementById('hzResolveModal').style.display = 'flex';
}
function closeHzResolveModal() {
  document.getElementById('hzResolveModal').style.display = 'none';
}
async function submitHzResolve() {
  const actionTaken = document.getElementById('hz_resolve_action').value.trim();
  const team = document.getElementById('hz_resolve_team').value.trim();
  if (!actionTaken || !team) return showToast(T('يرجى تعبئة كافة الحقول'), 'error');
  try {
    const body = { action: 'resolve_maintenance', maintenanceAction: actionTaken, maintenanceTeamNames: team };
    if (currentHzResolvePhoto) body.afterPhoto = currentHzResolvePhoto;
    const res = await authFetch(`/api/hazards/${currentHzResolveId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showToast(T('تم الإصلاح والإغلاق بنجاح'), 'success');
      currentHzResolvePhoto = null;
      closeHzResolveModal();
      renderSupHazard(true);
    } else {
      const d = await res.json().catch(() => ({}));
      if (d.needAfterPhoto) {
        const f = document.getElementById('hz_resolve_photo');
        if (f) f.focus();
      }
      showToast(d.error || T('حدث خطأ'), 'error');
    }
  } catch(e) { showToast(T('خطأ في الاتصال'), 'error'); }
}

async function softDeleteHazard(id) {
  if (!confirm(T('هل أنت متأكد من حذف هذا البلاغ ونقله للمحذوفات؟'))) return;
  try {
    const res = await authFetch(`/api/hazards/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'حذف من لوحة التحكم' }) });
    if (res.ok) {
      showToast(T('تم النقل للمحذوفات بنجاح'), 'success');
      renderSupHazard(true);
    } else { showToast(T('فشل الحذف'), 'error'); }
  } catch(e) { showToast(T('خطأ في الاتصال'), 'error'); }
}

async function restoreHazard(id) {
  if (!confirm(T('هل تريد استعادة هذا البلاغ؟'))) return;
  try {
    const res = await authFetch(`/api/hazards/${id}/restore`, { method: 'POST' });
    if (res.ok) {
      showToast(T('تم الاستعادة بنجاح'), 'success');
      renderSupHazard(true);
    } else { showToast(T('فشل الاستعادة'), 'error'); }
  } catch(e) { showToast(T('خطأ في الاتصال'), 'error'); }
}

async function permanentDeleteHazard(id) {
  if (!confirm(T('تنبيه هام! هل أنت متأكد من الحذف النهائي؟ لا يمكن التراجع عن هذا الإجراء.'))) return;
  try {
    const res = await authFetch(`/api/hazards/${id}/permanent`, { method: 'DELETE' });
    if (res.ok) {
      showToast(T('تم الحذف النهائي بنجاح'), 'success');
      renderSupHazard(true);
    } else { showToast(T('فشل الحذف'), 'error'); }
  } catch(e) { showToast(T('خطأ في الاتصال'), 'error'); }
}

let isKpiVisible = false;

async function uploadHazardsExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const base64Data = dataUrl.split(',')[1];

    showToast(T('جاري رفع السجل واستيراد البيانات...'), 'info');

    try {
      const res = await authFetch('/api/hazards/upload-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`${T("تم استيراد")} ${json.count} ${T("بلاغ بنجاح! (مغلق:")} ${json.closed ?? '?'} ${T("/ مفتوح:")} ${json.open ?? '?'})`, 'success');
        renderSupHazard(true);
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

const CLEAR_MODULE_LABELS = {
  hazards:   'بلاغات الخطورة',
  permits:   'تصاريح العمل',
  penalties: 'الجزاءات',
  trainings: 'التدريبات',
  drills:    'تجارب الطوارئ',
  employees: 'الموظفين'
};

async function clearModuleData(moduleName, refreshFn) {
  const label = T(CLEAR_MODULE_LABELS[moduleName] || moduleName);

  const step1 = window.confirm(
    `${T("⚠️ تحذير: هتمسح كل بيانات")} "${label}" ${T("نهائيًا — للعمال والأدمن كلهم.\\n")}` +
    `${T("هيتاخد باك أب على السيرفر، لكن العملية دي مش هترجع من الواجهة.\\n\\n")}` +
    `${T("متأكد إنك عايز تكمل؟")}`
  );
  if (!step1) return;

  const typed = window.prompt(`${T("لتأكيد المسح النهائي، اكتب كلمة")} "${T("تأكيد")}" ${T("بالظبط:")}`);
  if (typed !== 'تأكيد') {
    showToast(T('اتلغت عملية المسح — لازم تكتب "تأكيد" بالظبط'), 'info');
    return;
  }

  try {
    showToast(`${T("جاري مسح")} ${label}...`, 'info');
    const res = await authFetch('/api/admin/clear-module', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: moduleName, confirm: 'تأكيد' })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`${T("✅ اتمسح")} ${label} ${T("بالكامل (")}${json.cleared ?? 0} ${T("سجل)")}`, 'success');
      if (typeof refreshFn === 'function') refreshFn();
    } else {
      showToast(json.message || T('حدث خطأ أثناء المسح'), 'error');
    }
  } catch (err) {
    console.error(err);
    showToast(T('خطأ في الاتصال بالخادم'), 'error');
  }
}

async function uploadPermitsExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const base64Data = dataUrl.split(',')[1];

    showToast(T('جاري رفع سجل التصاريح القديمة واستيراد البيانات...'), 'info');

    try {
      const res = await authFetch('/api/permits/upload-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`${T("تم استيراد")} ${json.count} ${T("تصريح قديم بنجاح! (اترّبط بموظف:")} ${json.matched ?? '?'})`, 'success');
        renderSupervisor();
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

window.exportHazardsExcel = async function() {
  const dataToExport = window._currentFilteredHazards || [];
  if (dataToExport.length === 0) {
    showToast(T('لا توجد بلاغات للتصدير'), 'error');
    return;
  }
  if (!(await ensureXlsx())) return;

  try {
    const rows = dataToExport.map(h => ({
      'كود العامل': String(h.empCode || ''),
      'اسم المُبلِّغ / العامل': h.reporterName || h.reportedBy || '',
      'القسم (Department)': h.department || '',
      'وصف الخطورة': h.description || '',
      'تاريخ البلاغ': h.date || '',
      'المنطقة': h.area || '',
      'اسم مشرف السلامة': h.hseName || h.hseReviewer || '',
      'حالة البلاغ': h.status === 'open' ? 'مفتوح 🔴' :
                    (h.status === 'in_progress' ? 'قيد الإصلاح 🟡' :
                    (h.status === 'assigned_to_maintenance' ? 'موجه للصيانة 📢' :
                    (h.status === 'rejected_by_maintenance' ? T('مرفوض من الصيانة ❌') :
                    (h.status === 'rejected_by_hse' ? T('مرفوض 🚫') :
                    (h.status === 'resolved' || h.status === 'closed' ? T('تم الإصلاح والإغلاق 🟢') : h.status))))),
      'الإجراء المتخذ': h.actionTaken || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    if(!ws['!cols']) ws['!cols'] = [];
    ws['!cols'] = [
      { wch: 15 },
      { wch: 30 },
      { wch: 25 },
      { wch: 50 },
      { wch: 15 },
      { wch: 15 },
      { wch: 30 },
      { wch: 20 },
      { wch: 40 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, T('البلاغات'));
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `${T("سجل_بلاغات_الخطورة_")}${dateStr}.xlsx`);
    showToast(T('تم تحميل سجل الإكسيل بنجاح 📊'), 'success');
  } catch (e) {
    console.error(e);
    showToast(T('خطأ أثناء التصدير'), 'error');
  }
};
