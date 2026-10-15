// Emergency drills: worker attendance, admin session management, Excel export and the drill report form.

async function loadWorkerDrill(isSilent = false) {
  if (!currentEmployee) return;

  const textEl = document.getElementById('drlWorkerStatText');
  const barEl = document.getElementById('drlWorkerProgressBar');
  const activeArea = document.getElementById('drlWorkerActiveSessionArea');
  const historyList = document.getElementById('drlWorkerHistoryList');

  try {
    const r = await fetchJsonIfChanged(`/api/drills/worker/` + encodeURIComponent(currentEmployee.empCode));
    // Background refreshes keep the screen as is when nothing changed or while the worker is typing the PIN.
    if (isSilent) {
      const pin = document.getElementById('drlWorkerPin');
      if (!r.ok || r.data === window._drlWorkerRendered || (pin && document.activeElement === pin)) return;
    }
    window._drlWorkerRendered = r.ok ? r.data : null;
    const data = (r.ok && r.data) || {};

    const activeSession = data.activeSession;
    const myHistory = data.myHistory || [];
    const myAttended = data.myAttended || 0;

    textEl.textContent = `${T("🎯 حضرت")} ${myAttended} ${T("تجربة طوارئ")}`;
    if(barEl && barEl.parentElement) barEl.parentElement.style.display = "none";

    if (activeSession) {
      const alreadyAttended = activeSession.attendees.find(a => normalizeEmpCode(a.empCode) === normalizeEmpCode(currentEmployee.empCode));
      if (alreadyAttended) {
        activeArea.innerHTML = `
          <div class="ticket" style="border-left: 5px solid var(--success-solid);">
            <div class="ticket-body" style="text-align:center;">
              <h3 style="color:var(--success-text); margin:0 0 8px 0;">${T("✅ تم تسجيل حضورك بنجاح")}</h3>
              <p style="margin:0; font-size:14px;">${T("تجربة:")} <strong>${escapeHtml(activeSession.title)}</strong></p>
            </div>
          </div>`;
      } else {
        activeArea.innerHTML = `
          <div class="ticket" style="border-left: 5px solid var(--danger-solid);">
            <div class="ticket-body">
              <h3 style="margin:0 0 4px 0; color:var(--danger-text);">${T("🚨 تجربة أداء جارية الآن")}</h3>
              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700;">${escapeHtml(activeSession.title)} | ${escapeHtml(activeSession.location)}</p>
              <div class="pin-row">
                <input type="text" id="drlWorkerPin" class="pin-input" placeholder="${T("أدخل رمز الجلسة (PIN)")}" maxlength="4">
                <button class="btn btn-primary pin-row-btn" onclick="submitDrillAttendance(${jsArg(activeSession.id)})">${T("✅ تسجيل حضوري")}</button>
              </div>
              <div id="drlWorkerMsg" class="wl-msg" style="margin-top:8px;"></div>
            </div>
          </div>`;
      }
    } else {
      activeArea.innerHTML = `
        <div class="ticket">
          <div class="ticket-body" style="text-align:center; color:var(--text-muted); font-size:14px;">
            ${T("لا توجد تجارب أداء جارية في الوقت الحالي.")}
          </div>
        </div>`;
    }

    if (myHistory.length === 0) {
      historyList.innerHTML = T('<div class="empty">لم تسجل حضور في أي تجربة حتى الآن.</div>');
    } else {
      historyList.innerHTML = `
        <div class="um-table-wrap">
          <table class="um-table">
            <thead><tr><th>${T("التاريخ")}</th><th>${T("الموضوع")}</th><th>${T("الحالة")}</th></tr></thead>
            <tbody>
              ${myHistory.map(h => {
                const stText = h.status || '';
                let stHtml = escapeHtml(T(stText));
                if (stText.includes('غائب')) {
                  stHtml = `<span class="badge badge-danger" style="background:var(--danger-tint); color:var(--danger-text); border:1px solid var(--danger-line); padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${escapeHtml(T(stText))}</span>`;
                } else if (stText.includes('مؤكد')) {
                  stHtml = `<span class="badge badge-success" style="background:var(--success-tint); color:var(--success-text); border:1px solid var(--success-line); padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${escapeHtml(T(stText))}</span>`;
                } else {
                  stHtml = `<span class="badge badge-warning" style="background:var(--warning-tint); color:var(--warning-text); border:1px solid var(--warning-line); padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${escapeHtml(T(stText))}</span>`;
                }
                return `
                <tr>
                  <td style="font-size:12px; color:var(--text-muted);">${escapeHtml(h.date)}</td>
                  <td style="font-weight:700; font-size:13px;">${escapeHtml(h.title)}</td>
                  <td style="font-size:12px; font-weight:700;">${stHtml}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }
  } catch (e) { console.error(e); }
}

async function submitDrillAttendance(sessionId) {
  const pin = document.getElementById('drlWorkerPin').value;
  const msgEl = document.getElementById('drlWorkerMsg');
  if (!pin || pin.length !== 4) {
    msgEl.textContent = T('الرجاء إدخال الرمز المكون من 4 أرقام');
    msgEl.className = 'um-msg error show';
    return;
  }
  try {
    const res = await authFetch(`/api/drills/${sessionId}/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode: currentEmployee.empCode, pin: pin })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = T('✅ تم تسجيل حضورك');
      msgEl.className = 'um-msg success show';
      setTimeout(loadWorkerDrill, 1500);
    } else {
      msgEl.textContent = data.error || T('فشل التسجيل');
      msgEl.className = 'um-msg error show';
    }
  } catch(e) {
    msgEl.textContent = T('خطأ اتصال');
    msgEl.className = 'um-msg error show';
  }
}

async function loadAdminDrill(isSilent = false) {
  const container = document.getElementById('drlAdminLiveSessions');
  if (!container) return;
  try {
    const r = await fetchJsonIfChanged('/api/drills');
    if (!r.ok) return;
    // Polls with an unchanged list (304) leave the screen, including opened attendee lists, as it is.
    if (isSilent && r.data === window._drlAdminRendered) return;
    const data = r.data || {};
    const allDrills = (data.drills || []).filter(d => !d.isDeleted);
    _allAdminDrills = allDrills;
    const activeDrills = allDrills.filter(d => d.status === 'active');
    const closedDrills = allDrills.filter(d => d.status === 'closed').sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (activeDrills.length > 0) {
      if (!isPolling('drlAdmin')) poll('drlAdmin', () => loadAdminDrill(true), 3000);
    } else {
      stopPoll('drlAdmin');
    }

    let html = '';

    if (activeDrills.length === 0) {
      html += T('<div class="empty">لا توجد تجارب طوارئ جارية الآن. يمكنك إنشاء تجربة جديدة.</div>');
    } else {
      activeDrills.forEach(drl => {
        const attendees = (drl.attendees || []).map(a => {
          let dupWarningHtml = '';
          if (_allAdminDrills) {
            const now = Date.now();
            const ninetyDays = 90 * 24 * 60 * 60 * 1000;
            const pastAttendedList = _allAdminDrills.filter(d =>
              d.id !== drl.id &&
              d.title === drl.title &&
              (now - new Date(d.createdAt).getTime()) <= ninetyDays &&
              (d.attendees || []).some(att => att.empCode === a.empCode && att.verified)
            );
            if (pastAttendedList.length > 0) {
              const count = pastAttendedList.length;
              const dates = pastAttendedList.map(d => new Date(d.createdAt).toISOString().split('T')[0]).join(' ، ');
              const countText = count === 1 ? T('مرة واحدة') : `${count} ${T("مرات")}`;
              const dateLabel = count === 1 ? T('بتاريخ:') : T('بتواريخ:');
              dupWarningHtml = `<div class="dup-warning">${T("⚠️ تنبيه: حضر الموظف هذه التجربة مسبقاً (")}${countText}) ${dateLabel} [${dates}]</div>`;
            }
          }
          return {
            code: a.empCode,
            rawCode: a.empCode,
            name: a.name || '',
            department: a.department || '',
            time: new Date(a.attendedAt).toLocaleTimeString(LOC()),
            verified: a.verified !== false,
            dupWarningHtml
          };
        });
        const drill = {
          id: drl.id,
          pin: drl.sessionPin || '',
          title: drl.title || '',
          location: drl.location || T('غير محدد'),
          supervisorName: drl.trainer || '',
          attendees
        };
        html += `
<div class="ticket drill-live">
    <div class="drill-live-head">
        <div class="drill-pin">
            <div class="drill-pin-label">${T("رمز الجلسة (PIN)")}</div>
            <div class="drill-pin-value">${escapeHtml(drill.pin)}</div>
        </div>
        <div class="drill-live-info">
            <h3>${escapeHtml(drill.title)}</h3>
            <p>${T("المكان:")} ${escapeHtml(drill.location)} ${T("| المشرف:")} ${escapeHtml(drill.supervisorName)}</p>
        </div>
    </div>

    <div class="ticket-body">
        <h4 class="drill-att-title">${T("📋 الحضور (")}${drill.attendees ? drill.attendees.length : 0})</h4>
        <div class="um-table-wrap">
            <table class="um-table">
                <thead>
                    <tr>
                        <th>${T("الكود")}</th>
                        <th>${T("الاسم")}</th>
                        <th>${T("القسم")}</th>
                        <th>${T("الوقت")}</th>
                        <th>${T("التحقق")}</th>
                    </tr>
                </thead>
                <tbody>
                    ${drill.attendees && drill.attendees.length > 0 ? drill.attendees.map(att => `
                        <tr>
                            <td class="cell-strong">${escapeHtml(att.code)}</td>
                            <td>
                                ${escapeHtml(att.name)}
                                ${att.dupWarningHtml}
                            </td>
                            <td>${escapeHtml(att.department)}</td>
                            <td>${att.time}</td>
                            <td>
                                <button class="btn btn-sm ${att.verified ? 'btn-secondary' : 'btn-success'}" onclick="toggleDrlVerification(${jsArg(drill.id)}, ${jsArg(att.rawCode)}, ${!att.verified})">
                                  ${att.verified ? T('❌ إلغاء') : T('✅ تأكيد')}
                                </button>
                            </td>
                        </tr>
                    `).join('') : `<tr><td colspan="5" class="cell-empty">${T("لا يوجد حضور حتى الآن.")}</td></tr>`}
                </tbody>
            </table>
        </div>
    </div>

    <div class="btn-row drill-live-actions">
        <button class="btn btn-secondary" onclick="addManualDrlAttendee(${jsArg(drill.id)})">${T("➕ إضافة حضور يدوي")}</button>
        <button class="btn btn-secondary" onclick="openDrillReportModal(${jsArg(drill.id)})">${T("📝 إنشاء / تعديل الريبورت")}</button>
        <button class="btn btn-export" onclick="navigateWithAuth(${jsArg('/api/drills/export/' + drill.id)})">${T("📊 تصدير Excel")}</button>
        <button class="btn btn-warning btn-push-end" onclick="closeDrillSession(${jsArg(drill.id)})">${T("🛑 إنهاء وإغلاق التجربة")}</button>
    </div>
</div>
`;
      });
    }

    if (closedDrills.length > 0) {
      html += T('<h4 style="margin-top:24px;">سجل تجارب الطوارئ السابقة</h4>');
      closedDrills.slice(0, 15).forEach(drl => {
        const drill = { id: drl.id };
        const attCount = (drl.attendees || []).length;
        const attVerified = (drl.attendees || []).filter(a=>a.verified).length;
        const isLegacy = drl.source === 'legacy_import';
        html += `
        <div class="ticket" style="margin-bottom:8px;">
          <div class="ticket-body" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:700;">${escapeHtml(drl.title)} ${isLegacy ? T('<span style="font-size:11px; background:var(--surface-3); color:var(--text-2); padding:2px 6px; border-radius:4px;">بيانات مستوردة</span>') : ''}</div>
              <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(drl.date || '')} | 📍 ${escapeHtml(drl.location || '')} ${T("| حضور مؤكد:")} ${attVerified} / ${attCount}</div>
            </div>
            <div class="btn-row">
              <button class="btn btn-info btn-sm" onclick="toggleDrlAttendeesView(${jsArg(drl.id)})">${T("👥 الحضور")}</button>
              <button class="btn btn-secondary btn-sm" onclick="openDrillReportModal(${jsArg(drl.id)})">${T("📝 الريبورت")}</button>
              <button class="btn btn-export btn-sm" onclick="navigateWithAuth(${jsArg('/api/drills/export/' + drill.id)})">${T("📊 تصدير Excel")}</button>
              <button class="btn btn-danger btn-sm" onclick="deleteDrillSession(${jsArg(drl.id)})">${T("🗑️ حذف")}</button>
            </div>
          </div>
          <div id="drlAttWrap_${escapeHtml(drl.id)}" style="display:none; padding:0 16px 16px;">
            ${isLegacy ? `<div style="font-size:12px; color:var(--warning-text); background:var(--warning-tint); border:1px solid var(--warning-line); padding:8px; border-radius:6px; margin-bottom:8px;">${T("⚠️ هذه تجربة قديمة مستوردة من تقارير ورقية سابقة، ولا يوجد لها سجل حضور رقمي (بأكواد الموظفين) — الأسماء المذكورة أدناه (إن وجدت) مأخوذة من نص التقرير الأصلي فقط.")}</div>` : ''}
            <div class="um-table-wrap">
              <table class="um-table">
                <thead><tr>
                  <th>${T("الكود")}</th><th>${T("الاسم")}</th><th>${T("القسم")}</th><th>${T("الوقت")}</th><th>${T("التحقق")}</th>
                </tr></thead>
                <tbody>
                  ${attCount > 0 ? (drl.attendees || []).map(a => `
                    <tr>
                      <td>${escapeHtml(a.empCode || '—')}</td>
                      <td>${escapeHtml(a.name || '')}</td>
                      <td>${escapeHtml(a.department || '')}</td>
                      <td>${a.attendedAt ? new Date(a.attendedAt).toLocaleString(LOC()) : '—'}</td>
                      <td>${a.verified ? '✅' : '—'}</td>
                    </tr>`).join('') : `<tr><td colspan="5" class="cell-empty">${T("لا يوجد سجل حضور لهذه التجربة.")}</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>`;
      });
    }

    container.innerHTML = html;
    window._drlAdminRendered = r.data;

  } catch(e) { console.error(e); }
}

async function createDrillSession() {
  const title = document.getElementById('drl_title').value;
  const targetGroup = document.getElementById('drl_targetGroup').value;
  const location = document.getElementById('drl_location').value;
  const date = document.getElementById('drl_date').value;
  const startTime = document.getElementById('drl_startTime').value;
  const endTime = document.getElementById('drl_endTime').value;
  const trainer = document.getElementById('drl_trainer').value;
  const trainerCode = document.getElementById('drl_trainerCode').value;
  const msgEl = document.getElementById('drl_createMsg');

  if (!title || !date || !startTime || !endTime || !location) {
    msgEl.textContent = T('البيانات الأساسية (العنوان، المكان، التاريخ، الوقت) مطلوبة');
    msgEl.className = 'wl-msg error show';
    return;
  }
  const payload = { title, targetGroup, location, date, startTime, endTime, trainer, trainerCode };

  try {
    const res = await authFetch('/api/drills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = `${T("تم الإنشاء! الرمز السري للجلسة:")} ${(data.drill && data.drill.sessionPin) || ''}`;
      msgEl.className = 'wl-msg success show';
      document.getElementById('drl_title').value = '';
      loadAdminDrill(true);
    } else {
      msgEl.textContent = data.error || T('فشل الإنشاء');
      msgEl.className = 'wl-msg error show';
    }
  } catch(e) {
    msgEl.textContent = T('خطأ اتصال');
    msgEl.className = 'wl-msg error show';
  }
}

async function closeDrillSession(id) {
  if (!(await appConfirm(T('هل أنت متأكد من إنهاء وإغلاق التجربة؟ (لن يتمكن العمال من تسجيل الحضور بعد ذلك)'), { tone: 'warning', confirmLabel: T('إنهاء وإغلاق') }))) return;
  try {
    const res = await authFetch(`/api/drills/${id}/close`, { method: 'PUT' });
    if (res.ok) loadAdminDrill(true);
  } catch(e) {}
}

async function deleteDrillSession(id) {
  if (!(await appConfirm(T('هل أنت متأكد من حذف التجربة نهائياً؟'), { tone: 'danger', title: T('تأكيد الحذف'), confirmLabel: T('حذف') }))) return;
  try {
    const res = await authFetch(`/api/drills/${id}`, { method: 'DELETE' });
    if (res.ok) loadAdminDrill(true);
  } catch(e) {}
}

window.exportDrillExcel = async function(id) {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const res = await fetch(`/api/drills/${id}/export-excel`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error('failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `\u0643\u0634\u0641_\u062a\u062c\u0631\u0628\u0629_${id}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch(e) {
    showToast(T('\u0641\u0634\u0644 \u062a\u0635\u062f\u064a\u0631 \u0627\u0644\u0645\u0644\u0641. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.'), 'error');
  }
};

async function toggleDrlVerification(id, empCode, verified) {
  try {
    const res = await authFetch(`/api/drills/${id}/verify-attendee`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode, verified })
    });
    if (res.ok) loadAdminDrill(true);
  } catch(e) {}
}

async function addManualDrlAttendee(id) {
  const empCode = window.prompt(T('من فضلك أدخل الكود الوظيفي للموظف المطلوب تسجيل حضوره:'));
  if (!empCode || !empCode.trim()) return;
  try {
    const res = await authFetch(`/api/drills/${id}/add-attendee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode: empCode.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      loadAdminDrill(true);
    } else {
      showToast(data.error || T('تعذّر تسجيل الحضور'), 'error');
    }
  } catch(e) {
    showToast(T('لا يوجد اتصال بالسيرفر'), 'error');
  }
}

function toggleDrlAttendeesView(id) {
  const el = document.getElementById(`drlAttWrap_${id}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

const linesToArr = (val) => (val || '').split('\n').map(s => s.trim()).filter(Boolean);
const arrToLines = (arr) => (arr || []).join('\n');

async function openDrillReportModal(drillId) {
  let data;
  try {
    const res = await authFetch(`/api/drills/${drillId}/report`);
    if (!res.ok) throw new Error('failed');
    data = await res.json();
  } catch (e) {
    showToast(T('تعذر تحميل بيانات الريبورت'), 'error');
    return;
  }
  const r = data.report || {};
  const drl = data.drill || {};

  document.getElementById('drlReportModalOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'drlReportModalOverlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:var(--overlay); z-index:9999; display:flex; align-items:flex-start; justify-content:center; overflow:auto; padding:20px 10px;';
  overlay.innerHTML = `
    <div class="drill-report">
      <div class="drill-report-head">
        <div class="drill-report-title">${T("📝 ريبورت التجربة:")} ${escapeHtml(drl.title || '')}</div>
        <button class="btn btn-ghost btn-icon btn-sm" title="${T('إغلاق')}" aria-label="${T('إغلاق')}" onclick="document.getElementById('drlReportModalOverlay').remove()">×</button>
      </div>
      <div style="padding:20px; max-height:75vh; overflow:auto;">
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("وصف الحادث/السيناريو (بين قوسين)")}</label>
          <input type="text" id="drf_scenario" value="${escapeAttr(r.scenario || '')}" placeholder="${T("مثال: سقوط زيت اثناء النقل")}" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("الغرض من التجربة")}</label>
          <textarea id="drf_purpose" rows="4" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">${escapeHtml(r.purpose || '')}</textarea>
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("تفاصيل تنفيذ التجربة (سطر لكل خطوة)")}</label>
          <textarea id="drf_steps" rows="6" placeholder="${T("- تم إجراء التجربة ب...&#10;- قام العامل ... بـ ...&#10;- ...")}" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">${escapeHtml(arrToLines(r.narrativeSteps))}</textarea>
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("مقدمة نتيجة التجربة (اختياري)")}</label>
          <input type="text" id="drf_resultIntro" value="${escapeAttr(r.resultIntro || '')}" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("نقاط نتيجة التجربة (سطر لكل نقطة)")}</label>
          <textarea id="drf_results" rows="5" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">${escapeHtml(arrToLines(r.resultPoints))}</textarea>
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("الإيجابيات (سطر لكل نقطة)")}</label>
          <textarea id="drf_positives" rows="4" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">${escapeHtml(arrToLines(r.positives))}</textarea>
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("السلبيات (سطر لكل نقطة، اتركه فارغاً لو لا يوجد)")}</label>
          <textarea id="drf_negatives" rows="3" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">${escapeHtml(arrToLines(r.negatives))}</textarea>
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("نقاط للتحسين (سطر لكل نقطة)")}</label>
          <textarea id="drf_improvements" rows="3" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">${escapeHtml(arrToLines(r.improvements))}</textarea>
        </div>
        <div class="field" style="margin-bottom:12px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("عبارة الشكر الختامية (اختياري)")}</label>
          <textarea id="drf_thanks" rows="2" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">${escapeHtml(r.thanksNote || '')}</textarea>
        </div>
        <div class="row2" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div class="field">
            <label style="font-weight:700; display:block; margin-bottom:4px;">${T("صفة المسؤول الموقّع")}</label>
            <input type="text" id="drf_respTitle" value="${escapeAttr(r.responsibleTitle || T('مسئول البيئة والسلامة'))}" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">
          </div>
          <div class="field">
            <label style="font-weight:700; display:block; margin-bottom:4px;">${T("اسم المسؤول الموقّع")}</label>
            <input type="text" id="drf_respName" value="${escapeAttr(r.responsibleName || '')}" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">
          </div>
        </div>
        <div class="field" style="margin-bottom:4px;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">${T("تاريخ التوقيع")}</label>
          <input type="text" id="drf_sigDate" value="${escapeAttr(r.signatureDate || drl.date || '')}" style="width:100%; padding:8px; border:1px solid var(--border-strong); border-radius:6px;">
        </div>
        <div id="drf_msg" style="margin-top:10px; font-size:13px;"></div>
      </div>
      <div class="btn-row drill-report-actions">
        <button class="btn btn-primary" onclick="saveDrillReport(${jsArg(drillId)})">${T("💾 حفظ الريبورت")}</button>
        <button class="btn btn-info" onclick="printDrillReport(${jsArg(drillId)})">${T("🖨️ طباعة")}</button>
        <button class="btn btn-export" onclick="downloadDrillReport(${jsArg(drillId)})">${T("⬇️ تحميل Word (بنفس التصميم)")}</button>
        <button class="btn btn-secondary" onclick="document.getElementById('drlReportModalOverlay').remove()">${T("إغلاق")}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function collectDrillReportForm() {
  return {
    scenario: document.getElementById('drf_scenario').value.trim(),
    purpose: document.getElementById('drf_purpose').value.trim(),
    narrativeSteps: linesToArr(document.getElementById('drf_steps').value),
    resultIntro: document.getElementById('drf_resultIntro').value.trim(),
    resultPoints: linesToArr(document.getElementById('drf_results').value),
    positives: linesToArr(document.getElementById('drf_positives').value),
    negatives: linesToArr(document.getElementById('drf_negatives').value),
    improvements: linesToArr(document.getElementById('drf_improvements').value),
    thanksNote: document.getElementById('drf_thanks').value.trim(),
    responsibleTitle: document.getElementById('drf_respTitle').value.trim(),
    responsibleName: document.getElementById('drf_respName').value.trim(),
    signatureDate: document.getElementById('drf_sigDate').value.trim()
  };
}

async function saveDrillReport(drillId) {
  const msgEl = document.getElementById('drf_msg');
  try {
    const res = await authFetch(`/api/drills/${drillId}/report`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report: collectDrillReportForm() })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      msgEl.textContent = T('✅ تم حفظ الريبورت بنجاح');
      msgEl.style.color = 'var(--success-text)';
    } else {
      msgEl.textContent = data.error || T('فشل الحفظ');
      msgEl.style.color = 'var(--danger-text)';
    }
  } catch (e) {
    msgEl.textContent = T('لا يوجد اتصال بالسيرفر');
    msgEl.style.color = 'var(--danger-text)';
  }
}

async function downloadDrillReport(drillId) {
  await saveDrillReport(drillId);
  navigateWithAuth(`/api/drills/${encodeURIComponent(drillId)}/report/export`);
}

function printDrillReport(drillId) {
  const readOnly = document.body.dataset.readonly === '1';
  openPrintWithAuth(`/print/drill/${encodeURIComponent(drillId)}?autoprint=1`, {
    before: readOnly ? null : () => saveDrillReport(drillId),
  });
}
