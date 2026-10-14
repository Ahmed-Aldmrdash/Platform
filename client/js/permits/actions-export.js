// Permit actions (delete, restore, approve, reject, close), HTML escaping helpers and Excel export.

function pmShowMore() {
  loadPermitsPage({ append: true });
}

// Card details (checklist + risks) are only built when a card is opened; open cards stay open across list refreshes.
const _pmOpenDetails = new Set();
function showPermitDetails(id, show = true){
  const el = document.getElementById('details-'+id);
  if (!el) return;
  if (show && !el.dataset.built) {
    const p = permitsCache.find(x => String(x.id) === String(id));
    if (p) { el.innerHTML = permitDetailsHtml(p); el.dataset.built = '1'; }
  }
  el.classList.toggle('show', show);
  if (show) _pmOpenDetails.add(String(id)); else _pmOpenDetails.delete(String(id));
}
function toggleDetails(id){
  const el = document.getElementById('details-'+id);
  if (el) showPermitDetails(id, !el.classList.contains('show'));
}
function toggleNote(id){
  document.getElementById('note-'+id).classList.toggle('show');
}

let permitToDelete = '';
function openDeletePermitModal(id) {
  permitToDelete = id;
  document.getElementById('deletePermitReason').value = '';
  const msg = document.getElementById('deletePermitMsg');
  if(msg) msg.className = 'um-msg';
  document.getElementById('deletePermitModal').style.display = 'flex';
}
function closeDeletePermitModal() {
  document.getElementById('deletePermitModal').style.display = 'none';
  permitToDelete = '';
}
async function confirmDeletePermit() {
  const reason = document.getElementById('deletePermitReason').value.trim();
  const msgEl = document.getElementById('deletePermitMsg');
  msgEl.className = 'um-msg';

  if(!reason) {
    msgEl.textContent = T('من فضلك أدخل سبب الحذف');
    msgEl.className = 'um-msg error show';
    return;
  }

  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(permitToDelete)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = T('✅ تم حذف الطلب ونقله للأرشيف');
      msgEl.className = 'um-msg success show';

      if (data.permit) {
         const idx = permitsCache.findIndex(p => String(p.id) === String(permitToDelete));
         if (idx !== -1) permitsCache[idx] = data.permit;
      }
      renderList();

      setTimeout(() => {
        closeDeletePermitModal();
        pollPermitsForSupervisor();
      }, 1000);
    } else {
      msgEl.textContent = data.error || T('فشل عملية الحذف');
      msgEl.className = 'um-msg error show';
    }
  } catch (e) {
    msgEl.textContent = T('خطأ في الاتصال بالسيرفر');
    msgEl.className = 'um-msg error show';
  }
}
async function restorePermit(id) {
  if(!confirm(T('هل أنت متأكد من استعادة هذا الطلب؟'))) return;
  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    if(res.ok) {
      const idx = permitsCache.findIndex(p => p.id === id);
      if (idx !== -1) {
        if (permitsCache[idx].deletedBy) permitsCache[idx].deletedBy[getRoleKey(currentUserRole)] = false;
        if (permitsCache[idx].permanentlyDeletedBy) permitsCache[idx].permanentlyDeletedBy[getRoleKey(currentUserRole)] = false;
        renderList();
      }
      pollPermitsForSupervisor();
    } else {
      const data = await res.json();
      showToast(data.error || T('فشل استعادة الطلب'), 'error');
    }
  } catch (e) {
    showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
  }
}

async function hardDeletePermit(id) {
  if(!confirm(T('هل أنت متأكد من حذف هذا الطلب نهائياً من سلة المحذوفات؟ لا يمكن التراجع عن هذا الإجراء'))) return;
  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(id)}/permanent`, { method: 'DELETE' });
    if(res.ok) {
      const idx = permitsCache.findIndex(p => p.id === id);
      if (idx !== -1) {
        permitsCache[idx].permanentlyDeletedBy = permitsCache[idx].permanentlyDeletedBy || {};
        permitsCache[idx].permanentlyDeletedBy[getRoleKey(currentUserRole)] = true;
        renderList();
      }
      pollPermitsForSupervisor();
    } else {
      const data = await res.json();
      showToast(data.error || T('فشل الحذف النهائي'), 'error');
    }
  } catch (e) {
    showToast(T('خطأ في الاتصال بالسيرفر'), 'error');
  }
}

async function approvePermit(id){
  const safetyEl = document.getElementById('safety-'+id);
  const areaEl   = document.getElementById('area-'+id);
  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:            (currentUserRole === 'dept_admin' || currentUserRole === 'maint_admin') ? 'dept_approve' : 'hse_approve',
        safetyOfficerName: safetyEl ? safetyEl.value.trim() : '',
        areaManagerName:   areaEl   ? areaEl.value.trim()   : ''
      })
    });
    const data = await res.json();
    if (res.ok) {
      const idx = permitsCache.findIndex(p => p.id === id);
      if (idx !== -1 && data.permit) permitsCache[idx] = data.permit;
      currentFilter = 'الكل';
      renderFilters();
      renderList();
    } else {
      showToast(data.error || T('حصل خطأ في الموافقة، حاول تاني'), 'error');
    }
  } catch(e) {
    showToast(T('حصل خطأ في الاتصال بالسيرفر'), 'error');
  }
}

async function rejectPermit(id){
  const noteEl = document.getElementById('notetext-'+id);
  const note   = noteEl ? noteEl.value.trim() : '';
  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reject',
        reviewNote: note
      })
    });
    const data = await res.json();
    if (res.ok) {
      const idx = permitsCache.findIndex(p => p.id === id);
      if (idx !== -1 && data.permit) permitsCache[idx] = data.permit;
      renderList();
    } else {
      showToast(data.error || T('حصل خطأ في الرفض، حاول تاني'), 'error');
    }
  } catch(e) {
    showToast(T('حصل خطأ في الاتصال بالسيرفر'), 'error');
  }
}

async function savePermitEmployeeCode(id){
  const inputEl = document.getElementById('empcode-'+id);
  const code = inputEl ? inputEl.value.trim() : '';
  if(!code){
    showToast(T('من فضلك أدخل الكود الوظيفي أولاً'), 'error');
    return;
  }
  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(id)}/employee-code`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: code })
    });
    const data = await res.json();
    if (res.ok) {
      const idx = permitsCache.findIndex(p => p.id === id);
      if (idx !== -1 && data.permit) permitsCache[idx] = data.permit;
      renderList();
    } else {
      showToast(data.error || T('حصل خطأ في حفظ الكود، حاول تاني'), 'error');
    }
  } catch(e) {
    showToast(T('حصل خطأ في الاتصال بالسيرفر'), 'error');
  }
}

async function closePermit(id, type){
  const reasonEl = document.getElementById('closereason-'+id);
  const reason   = reasonEl ? reasonEl.value.trim() : '';
  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', closureType: type, closureReason: reason })
    });
    const data = await res.json();
    if (res.ok) {
      const idx = permitsCache.findIndex(p => p.id === id);
      if (idx !== -1 && data.permit) permitsCache[idx] = data.permit;
      renderList();
    } else {
      showToast(data.error || T('حصل خطأ في الإغلاق، حاول تاني'), 'error');
    }
  } catch(e) {
    showToast(T('حصل خطأ في الاتصال بالسيرفر'), 'error');
  }
}

async function workerClosePermit(id, type) {
  if (!currentEmployee) return;
  const reasonEl = document.getElementById('myhistory-closereason-' + id);
  const reason = reasonEl ? reasonEl.value.trim() : '';

  try {
    const res = await authFetch(`/api/permits/${encodeURIComponent(id)}/worker-close`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closureType: type, closureReason: reason })
    });
    const data = await res.json();
    if (res.ok) {
      renderMyHistory(true);
    } else {
      showToast(data.error || T('حصل خطأ في الإغلاق، حاول تاني'), 'error');
    }
  } catch(e) {
    showToast(T('حصل خطأ في الاتصال بالسيرفر'), 'error');
  }
}

function escapeHtml(str){
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Quoted attribute values such as value="...". Inline handler arguments must go through jsArg instead.
function escapeAttr(str){
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Turns a value into a quoted JS string literal for inline handler arguments, e.g. openEmpModal(${jsArg(code)}).
// The browser HTML-decodes the attribute before running it, so the literal is built first and then escaped.
function jsArg(v){
  return escapeHtml(JSON.stringify(String(v ?? '')));
}

// The list only holds one page, so the export pages through the server itself.
async function fetchAllPermitsMatchingFilters(max = 20000) {
  const PAGE = 500;
  const out = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const params = pmQueryParams({ offset });
    params.set('limit', String(PAGE));
    const res = await authFetch(`/api/permits?${params.toString()}`);
    if (!res.ok) break;
    const data = await res.json();
    const rows = data.permits || [];
    out.push(...rows);
    if (out.length >= (Number(data.total) || 0) || rows.length < PAGE) break;
  }
  return out;
}

async function exportExcel(){
  if (!(await ensureXlsx())) return;
  const _prevCache = permitsCache;
  showToast(T('جارِ تجهيز الملف…'), 'info');
  try {
    permitsCache = await fetchAllPermitsMatchingFilters();
    _exportExcelFromCache();
  } catch (e) {
    showToast(T('تعذّر تجهيز ملف التصدير — حاول تاني'), 'error');
  } finally {
    permitsCache = _prevCache;
  }
}

function _exportExcelFromCache(){
  const isDeptAdmin = currentUserRole === 'dept_admin' || currentUserRole === 'maint_admin';
  const isHSEAdmin = currentUserRole === 'hse_admin';
  const isSuperAdmin = currentUserRole === 'super_admin';

  let roleKey = 'worker';
  if (isDeptAdmin) roleKey = 'areaAdmin';
  if (isHSEAdmin) roleKey = 'safetyAdmin';
  if (isSuperAdmin) roleKey = 'superAdmin';

  if (currentFilter === '🗑️ المحذوفات') {
    const list = [...permitsCache].reverse().filter(p => {
      const deletedBy = (typeof p.deletedBy === 'object' && p.deletedBy !== null)
        ? p.deletedBy
        : { areaAdmin: !!p.deleted, safetyAdmin: !!p.deleted, superAdmin: !!p.deleted, worker: !!p.deleted };
      if (isDeptAdmin && p.department !== currentUserDept) return false;
      if (!deletedBy[roleKey] || !typeFilterMatch(p)) return false;
      return true;
    });

    if(list.length === 0){
      showToast(T('لا توجد بيانات محذوفة لتصديرها بعد'), 'error');
      return;
    }

    const rows = list.map(p => ({
      'كود الطلب': p.id,
      'اسم مقدم الطلب': p.workerName,
      'القسم': p.department,
      'تاريخ الحذف': p.deletedAt ? new Date(p.deletedAt).toLocaleString(LOC()) : '',
      'اسم من قام بالحذف': p.deletedByUsername || '',
      'سبب الحذف': p.deleteReason || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map(()=>({wch:20}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, T('المحذوفات'));
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `${T("سجل_المحذوفات_")}${dateStr}.xlsx`);
    return;
  }

  const list = [...permitsCache].reverse().filter(p => {
    const deletedBy = (typeof p.deletedBy === 'object' && p.deletedBy !== null)
      ? p.deletedBy
      : { areaAdmin: !!p.deleted, safetyAdmin: !!p.deleted, superAdmin: !!p.deleted, worker: !!p.deleted };

    if (isDeptAdmin && p.department !== currentUserDept) return false;

    if (isHSEAdmin) {
      if (p.status === 'pending_hse' || p.status === 'approved' || (p.status && p.status.startsWith('rejected')) || (p.status && p.status.startsWith('closed'))) {
         return !deletedBy[roleKey] && statusFilterMatch(p.status) && typeFilterMatch(p);
      }
      return false;
    }

    if (isSuperAdmin) {
      const isApprovedOrClosed = p.status === 'pending_hse' || p.status === 'approved' || (p.status && p.status.startsWith('rejected')) || (p.status && p.status.startsWith('closed'));
      if (!isApprovedOrClosed) return false;
    }

    return !deletedBy[roleKey] && statusFilterMatch(p.status) && typeFilterMatch(p);
  });
  if(list.length === 0){
    showToast(T('لا توجد بيانات لتصديرها بعد'), 'error');
    return;
  }
  const rows = list.map(p => ({
    'نوع الطلب': p.typeLabel,
    'القسم': p.department,
    'الوردية': p.shift,
    'رقم الطلب': p.id,
    'وصف العمل': p.description,
    'من': p.timeFrom,
    'الي': p.timeTo,
    'التاريخ': p.date,
    'مسئول التنفيذ': p.workerName,
    'مشرف السلامه': p.safetyOfficerName || '',
    'مدير المنطقه': p.areaManagerName || '',
    'الحالة': statusLabel(p.status),
    'حالة الإغلاق': closureLabel(p.closure),
    'راجعه': p.reviewedBy,
    'ملاحظة الرفض': p.reviewNote,
    'مكان العمل': p.location,
    'أسماء القائمين بالعمل': p.workersNames,
    'بنود قائمة تحقق = لا': (p.checklist||[]).filter(c=>c.answer==='لا').map(c=>c.question).join(' | '),
    'وقت الإرسال': p.submittedAt ? new Date(p.submittedAt).toLocaleString(LOC()) : '',
    'وقت المراجعة': p.reviewedAt ? new Date(p.reviewedAt).toLocaleString(LOC()) : ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0]).map(()=>({wch:20}));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, T('سجل متابعة الطلبات'));
  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `${T("سجل_طلبات_العمل_")}${dateStr}.xlsx`);
}
