// Training: worker attendance and lecture requests, admin session list, filters, Excel import/export and session creation.

let _allAdminTrainings = [];
let _allAdminDrills = [];
let _adminGlobalMatrix = [];

async function loadWorkerTraining(isSilent = false) {
  if (!currentEmployee) return;

  const textEl = document.getElementById('trnWorkerStatText');
  const barEl = document.getElementById('trnWorkerProgressBar');
  const activeArea = document.getElementById('trnWorkerActiveSessionArea');
  const historyList = document.getElementById('trnWorkerHistoryList');

  try {
    const r = await fetchJsonIfChanged(`/api/trainings/worker/${encodeURIComponent(currentEmployee.empCode)}`);
    // Background refreshes keep the screen as is when nothing changed or while the worker is typing the PIN.
    if (isSilent) {
      const pin = document.getElementById('trnWorkerPin');
      if (!r.ok || r.data === window._trnWorkerRendered || (pin && document.activeElement === pin)) return;
    }
    window._trnWorkerRendered = r.ok ? r.data : null;
    const data = (r.ok && r.data) || {};

    const activeSession = data.activeSession;
    const myHistory = data.myHistory || [];
    const myAttended = data.myAttended || 0;

    const attendedHours = myAttended * 0.5;
    const progressPercentage = Math.min(100, (attendedHours / 8) * 100);
    textEl.textContent = `${T("🎓 حضرت")} ${attendedHours} ${T("ساعة من إجمالي 8 ساعات")}`;
    barEl.style.width = `${progressPercentage}%`;
    barEl.style.background = progressPercentage >= 100 ? 'var(--success-solid)' : 'var(--brand-600)';

    if (activeSession) {
      const alreadyAttended = activeSession.attendees.find(a => normalizeEmpCode(a.empCode) === normalizeEmpCode(currentEmployee.empCode));
      if (alreadyAttended) {
        activeArea.innerHTML = `
          <div class="ticket" style="border-left: 5px solid var(--success-solid);">
            <div class="ticket-body u-text-center">
              <h3 class="u-c-success-text u-m-0 u-mb-2">${T("✅ تم تسجيل حضورك بنجاح")}</h3>
              <p class="u-m-0 u-fs-md">${T("محاضرة:")} <strong>${escapeHtml(activeSession.title)}</strong></p>
            </div>
          </div>`;
      } else {
        const attendedBeforeNote = activeSession.attendedBefore ? `
              <p class="pin-row-note u-m-0 u-mb-3 u-fs-sm u-c-brand-700" style="background: var(--warning-tint); border: 1px solid var(--warning-line); border-radius: 8px; padding: 6px 10px">
                ${T("⚠️ حضرت محاضرة بنفس الموضوع دي قبل كده")}${activeSession.attendedBeforeDate ? (' (' + escapeHtml(new Date(activeSession.attendedBeforeDate).toLocaleDateString('ar-EG')) + ')') : ''}
              </p>` : '';
        activeArea.innerHTML = `
          <div class="ticket" style="border-left: 5px solid var(--brand-600);">
            <div class="ticket-body">
              <h3 class="u-m-0 u-mb-1 u-c-brand-700">${T("📡 محاضرة جارية الآن")}</h3>
              <p class="u-m-0 u-mb-3 u-fs-md u-fw-700">${escapeHtml(activeSession.title)} | ${escapeHtml(activeSession.location)}</p>
              ${attendedBeforeNote}
              <div class="pin-row">
                <input type="text" id="trnWorkerPin" class="pin-input" placeholder="${T("أدخل رمز الجلسة (PIN)")}" maxlength="4">
                <button class="btn btn-primary pin-row-btn" onclick="submitAttendance(${jsArg(activeSession.id)})">${T("✅ تسجيل حضوري")}</button>
              </div>
              <div id="trnWorkerMsg" class="wl-msg u-mt-2"></div>
            </div>
          </div>`;
      }
    } else {
      activeArea.innerHTML = `
        <div class="ticket">
          <div class="ticket-body u-text-center u-c-text-muted u-fs-md">
            ${T("لا توجد محاضرات جارية في الوقت الحالي.")}
          </div>
        </div>`;
    }

    if (myHistory.length === 0) {
      historyList.innerHTML = T('<div class="empty">لم تسجل حضور في أي محاضرة حتى الآن.</div>');
    } else {
      historyList.innerHTML = `
        <div class="um-table-wrap">
          <table class="um-table">
            <thead><tr><th>${T("التاريخ")}</th><th>${T("الموضوع")}</th><th>${T("الحالة")}</th><th>${T("التسجيل")}</th><th>${T("الاختبار")}</th></tr></thead>
            <tbody>
              ${myHistory.map(h => {
                const stText = h.status || '';
                let stHtml = escapeHtml(T(stText));
                if (stText.includes('غائب') || h.quizFailed) {
                  stHtml = `<span class="badge badge-danger">${escapeHtml(T(stText))}</span>`;
                } else if (stText.includes('مؤكد')) {
                  stHtml = `<span class="badge badge-success">${escapeHtml(T(stText))}</span>`;
                } else {
                  stHtml = `<span class="badge badge-warning">${escapeHtml(T(stText))}</span>`;
                }
                let recordingBtn = `<span class="wl-dash">—</span>`;
                if (h.hasRecording) {
                  recordingBtn = h.reviewExpired
                    ? `<span class="wl-expired-tag" title="${T('انتهت مدة المراجعة')}">⏳ ${T('انتهت المدة')}</span>`
                    : `<button class="btn btn-info btn-sm" onclick="openWorkerRecordingModal(${jsArg(h.recordingUrl)})">${T('🎥 مشاهدة')}</button>`;
                }
                let quizBtn = `<span class="wl-dash">—</span>`;
                if (h.hasQuiz) {
                  quizBtn = h.reviewExpired
                    ? `<span class="wl-expired-tag" title="${T('انتهت مدة المراجعة')}">⏳ ${T('انتهت المدة')}</span>`
                    : `<button class="btn btn-primary btn-sm" onclick="openWorkerQuizModal(${jsArg(h.trainingId)})">${h.quizFailed ? T('🔁 إعادة') : T('📝 خذ الاختبار')}</button>`;
                }
                return `
                <tr>
                  <td class="u-fs-xs u-c-text-muted">${escapeHtml(h.date)}</td>
                  <td class="u-fw-700 u-fs-sm">${escapeHtml(h.title)}</td>
                  <td class="u-fs-xs u-fw-700">${stHtml}</td>
                  <td>${recordingBtn}</td>
                  <td>${quizBtn}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    populateTrainingRequestTopicsList(myHistory);
    if (!isSilent) loadMyTrainingRequests();
  } catch (e) {
    console.error(e);
  }
}

function populateTrainingRequestTopicsList(myHistory) {
  const dl = document.getElementById('trnReqTopicsList');
  if (!dl) return;
  const defaultTopics = [
    T("السلامة والصحة المهنية العامة"),
    T("مكافحة الحرائق والإخلاء"),
    T("الإسعافات الأولية"),
    T("مهمات الوقاية الشخصية (PPE)"),
    T("العمل على ارتفاعات"),
    T("السلامة الكهربائية"),
    T("التعامل الآمن مع المواد الكيميائية")
  ];
  const historyTopics = (myHistory || []).map(h => h && h.title).filter(Boolean);
  const allUnique = Array.from(new Set([...defaultTopics, ...historyTopics]));
  dl.innerHTML = allUnique.map(top => `<option value="${escapeHtml(top)}">`).join('');
}

async function submitTrainingRequest() {
  const topicInput = document.getElementById('trnReqTopicInput');
  const noteInput = document.getElementById('trnReqNoteInput');
  const msgEl = document.getElementById('trnReqMsg');
  if (!topicInput || !msgEl) return;
  const topicTitle = (topicInput.value || '').trim();
  const note = (noteInput ? noteInput.value : '').trim();
  if (!topicTitle) {
    msgEl.textContent = T('من فضلك اكتب موضوع المحاضرة');
    msgEl.className = 'um-msg error show';
    return;
  }
  try {
    const res = await authFetch('/api/training-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicTitle, note })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      msgEl.textContent = T('✅ تم إرسال طلبك للسيفتي بنجاح');
      msgEl.className = 'um-msg success show';
      topicInput.value = '';
      if (noteInput) noteInput.value = '';
      loadMyTrainingRequests();
    } else {
      msgEl.textContent = data.error || T('حصل خطأ أثناء إرسال الطلب');
      msgEl.className = 'um-msg error show';
    }
  } catch (e) {
    msgEl.textContent = T('خطأ في الاتصال');
    msgEl.className = 'um-msg error show';
  }
}

const TRN_REQ_STATUS_MAP = {
  pending: { label: '⏳ قيد المراجعة', bg: 'var(--warning-tint)', color: 'var(--warning-text)', border: 'var(--warning-line)' },
  scheduled: { label: '✅ هيتم جدولتها', bg: 'var(--success-tint)', color: 'var(--success-text)', border: 'var(--success-line)' },
  completed: { label: '🎉 تمت', bg: 'var(--info-tint)', color: 'var(--info-text)', border: 'var(--info-line)' },
  declined: { label: '❌ مرفوض', bg: 'var(--danger-tint)', color: 'var(--danger-text)', border: 'var(--danger-line)' }
};

async function loadMyTrainingRequests() {
  const listEl = document.getElementById('trnReqMineList');
  if (!listEl) return;
  try {
    const res = await authFetch('/api/training-requests/mine');
    const data = await res.json().catch(() => ({}));
    const requests = Array.isArray(data) ? data : (data.requests || []);
    if (!requests.length) {
      listEl.innerHTML = T('<div class="empty">لسه معملتش أي طلب محاضرة.</div>');
      return;
    }
    listEl.innerHTML = `
      <div class="um-table-wrap">
        <table class="um-table">
          <thead><tr><th>${T("التاريخ")}</th><th>${T("الموضوع")}</th><th>${T("الحالة")}</th></tr></thead>
          <tbody>
            ${requests.map(r => {
              const st = TRN_REQ_STATUS_MAP[r.status] || TRN_REQ_STATUS_MAP.pending;
              return `
              <tr>
                <td class="u-fs-xs u-c-text-muted">${escapeHtml(new Date(r.createdAt || Date.now()).toLocaleDateString('ar-EG'))}</td>
                <td class="u-fw-700 u-fs-sm">${escapeHtml(r.topicTitle || '')}</td>
                <td class="u-fs-xs u-fw-700"><span style="background:${st.bg}; color:${st.color}; border:1px solid ${st.border}; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${T(st.label)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    console.error(e);
  }
}

async function submitAttendance(sessionId) {
  const pin = document.getElementById('trnWorkerPin').value;
  const msgEl = document.getElementById('trnWorkerMsg');
  if (!pin || pin.length !== 4) {
    msgEl.textContent = T('الرجاء إدخال الرمز المكون من 4 أرقام');
    msgEl.className = 'um-msg error show';
    return;
  }

  try {
    const res = await authFetch(`/api/trainings/${sessionId}/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode: currentEmployee.empCode, pin: pin })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = T('✅ تم تسجيل حضورك');
      msgEl.className = 'um-msg success show';
      setTimeout(loadWorkerTraining, 1500);
    } else {
      msgEl.textContent = data.error || T('رمز غير صحيح');
      msgEl.className = 'um-msg error show';
    }
  } catch (e) {
    msgEl.textContent = T('خطأ في الاتصال');
    msgEl.className = 'um-msg error show';
  }
}

// Replaces the admin's training list and drops the "attended before" index built from the old one.
let _trnAttendedBeforeIndex = null;
function _setAdminTrainings(list) {
  _allAdminTrainings = list;
  _trnAttendedBeforeIndex = null;
}

// Maps title + empCode to the sessions of the last 90 days where that employee is a verified attendee, in list
// order. The session being shown is filtered out at lookup. Rebuilt only after the list changes.
function _trnAttendedBeforeKey(title, empCode) {
  return `${title}\u0001${empCode}`;
}
function _getTrnAttendedBeforeIndex() {
  if (_trnAttendedBeforeIndex) return _trnAttendedBeforeIndex;
  const index = new Map();
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  (_allAdminTrainings || []).forEach(t => {
    const createdMs = new Date(t.createdAt).getTime();
    if (!((now - createdMs) <= ninetyDays)) return;
    const codes = new Set();
    (t.attendees || []).forEach(att => { if (att && att.verified) codes.add(att.empCode); });
    codes.forEach(code => {
      const key = _trnAttendedBeforeKey(t.title, code);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ id: t.id, createdMs });
    });
  });
  _trnAttendedBeforeIndex = index;
  return index;
}

// While a session is live the admin screen polls only the active sessions and merges them into the full list.
let _trnActiveSeen = null;
async function _pollAdminActiveTrainings() {
  if (!isLoggedIn) { stopPoll('trnAdmin'); return; }
  const r = await fetchJsonIfChanged('/api/trainings/active');
  if (!r.ok || r.data === _trnActiveSeen) return;
  _trnActiveSeen = r.data;
  const active = (r.data && r.data.trainings) || [];
  const knownActiveIds = new Set(_allAdminTrainings.filter(t => t.status === 'active' && !t.isDeleted).map(t => t.id));
  const sameSessions = active.length === knownActiveIds.size && active.every(t => knownActiveIds.has(t.id));
  if (!sameSessions) {
    // A session started or ended elsewhere: reload the full list once.
    await loadAdminTraining(true);
    return;
  }
  const byId = new Map(active.map(t => [t.id, t]));
  _setAdminTrainings(_allAdminTrainings.map(t => byId.get(t.id) || t));
  if (typeof renderAdminLiveSessions === 'function') renderAdminLiveSessions(_allAdminTrainings);
}

async function loadAdminTraining(isSilent = false) {
  if (!isLoggedIn) return;

  if (!isSilent) {
    stopPoll('trnAdmin');

    const isSafetyOrSuper = (currentUserRole === 'hse_admin' || currentUserRole === 'super_admin');
    const isViewerRole = VIEWER_ROLES_UI.includes(currentUserRole);
    const createCard = document.getElementById('createLectureCard');
    const liveSection = document.getElementById('liveSessionsSection');

    if (createCard) createCard.style.display = isSafetyOrSuper ? 'block' : 'none';
    if (liveSection) liveSection.style.display = (isSafetyOrSuper || isViewerRole) ? 'block' : 'none';

    window.populateTrainerInfo();
  }

  try {
    const r = await fetchJsonIfChanged('/api/trainings');
    const data = (r.ok && r.data) || {};
    const trainings = Array.isArray(data) ? data : (data.trainings || data.data || []);

    const topicDatalist = document.getElementById('topicsList') || document.getElementById('trainingTopicsList');
    if (topicDatalist && !isSilent) {
      const defaultTopics = [
        T("السلامة والصحة المهنية العامة"),
        T("مكافحة الحرائق والإخلاء"),
        T("الإسعافات الأولية"),
        T("مهمات الوقاية الشخصية (PPE)"),
        T("العمل على ارتفاعات"),
        T("السلامة الكهربائية"),
        T("التعامل الآمن مع المواد الكيميائية")
      ];
      const existingTopics = trainings.map(t => t && t.topic).filter(Boolean);
      const allUnique = Array.from(new Set([...defaultTopics, ...existingTopics]));
      topicDatalist.innerHTML = allUnique.map(top => `<option value="${escapeHtml(top)}">`).join('');
    }

    const hasActive = trainings.some(t => t.status === 'active');
    if (hasActive) {
      if (!isPolling('trnAdmin')) poll('trnAdmin', _pollAdminActiveTrainings, 3000);
    } else {
      stopPoll('trnAdmin');
    }

    // An unchanged list (304) is the same array as last time, so there is nothing to redraw.
    if (typeof renderAdminLiveSessions === 'function' && trainings !== _allAdminTrainings) {
      _setAdminTrainings(trainings);
      renderAdminLiveSessions(trainings);
    }

    window.populateTrainerInfo();

    if (!isSilent) loadTrainingRequestsAdmin();
  } catch (err) {
    console.error('Handled loadAdminTraining error:', err);
  }
}

async function loadTrainingRequestsAdmin() {
  const listEl = document.getElementById('trnRequestsAdminList');
  if (!listEl) return;
  const isSafetyOrSuper = (currentUserRole === 'hse_admin' || currentUserRole === 'super_admin');
  const isViewerRole = VIEWER_ROLES_UI.includes(currentUserRole);
  if (!isSafetyOrSuper && !isViewerRole) {
    listEl.innerHTML = '';
    return;
  }
  try {
    const res = await authFetch('/api/training-requests');
    if (!res.ok) { listEl.innerHTML = ''; return; }
    const data = await res.json().catch(() => ({}));
    const requests = Array.isArray(data) ? data : (data.requests || []);
    if (!requests.length) {
      listEl.innerHTML = T('<div class="empty">لا توجد طلبات محاضرات حاليًا.</div>');
      return;
    }
    listEl.innerHTML = `
      <div class="um-table-wrap">
        <table class="um-table">
          <thead><tr><th>${T("التاريخ")}</th><th>${T("العامل")}</th><th>${T("الموضوع")}</th><th>${T("ملاحظة")}</th><th>${T("الحالة")}</th>${isSafetyOrSuper ? `<th>${T("إجراء")}</th>` : ''}</tr></thead>
          <tbody>
            ${requests.map(r => {
              const st = TRN_REQ_STATUS_MAP[r.status] || TRN_REQ_STATUS_MAP.pending;
              const actionsHtml = isSafetyOrSuper ? `
                <td class="btn-row nowrap-cell">
                  ${r.status === 'pending' ? `
                    <button class="btn btn-success btn-sm" onclick="decideTrainingRequest(${jsArg(r.id)},'scheduled')">${T("✅ قبول")}</button>
                    <button class="btn btn-danger btn-sm" onclick="decideTrainingRequest(${jsArg(r.id)},'declined')">${T("❌ رفض")}</button>
                  ` : `
                    <button class="btn btn-warning btn-sm" onclick="decideTrainingRequest(${jsArg(r.id)},'pending')">${T("↩️ رجوع لقيد المراجعة")}</button>
                  `}
                </td>` : '';
              return `
              <tr>
                <td class="u-fs-xs u-c-text-muted">${escapeHtml(new Date(r.createdAt || Date.now()).toLocaleDateString('ar-EG'))}</td>
                <td class="u-fs-xs">${escapeHtml(r.workerName || r.empCode || '')}</td>
                <td class="u-fw-700 u-fs-sm">${escapeHtml(r.topicTitle || '')}</td>
                <td class="u-fs-xs u-c-text-muted">${escapeHtml(r.note || '-')}</td>
                <td class="u-fs-xs u-fw-700"><span style="background:${st.bg}; color:${st.color}; border:1px solid ${st.border}; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${T(st.label)}</span></td>
                ${actionsHtml}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    console.error(e);
  }
}

async function decideTrainingRequest(id, status) {
  let responseNote = '';
  if (status === 'declined') {
    const note = await appPrompt(T('سبب الرفض (اختياري):'), { tone: 'danger', title: T('رفض طلب المحاضرة'), confirmLabel: T('رفض') });
    if (note === null) return;
    responseNote = note;
  }
  try {
    const res = await authFetch(`/api/training-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, responseNote })
    });
    if (res.ok) {
      loadTrainingRequestsAdmin();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || T('حصل خطأ أثناء تحديث الطلب'));
    }
  } catch (e) {
    alert(T('خطأ في الاتصال'));
  }
}

function renderAdminLiveSessions(trainings) {
  const liveEl = document.getElementById('trnAdminLiveSessions');
  const activeSessions = trainings.filter(t => t.status === 'active');
  let closedSessions = trainings.filter(t => t.status === 'closed' && !t.isDeleted).sort((a,b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));

  const fFrom = document.getElementById('filter_trn_fromDate')?.value;
  const fTo = document.getElementById('filter_trn_toDate')?.value;
  const fTopic = document.getElementById('filter_trn_topic')?.value?.toLowerCase();
  const fTrainer = document.getElementById('filter_trn_trainer')?.value?.toLowerCase();

  let hasFilters = false;
  if (fFrom || fTo || fTopic || fTrainer) {
    hasFilters = true;
    closedSessions = closedSessions.filter(t => {
      let match = true;
      if (fFrom && new Date(t.date || t.createdAt) < new Date(fFrom)) match = false;
      if (fTo && new Date(t.date || t.createdAt) > new Date(fTo)) match = false;
      if (fTopic && !((t.topic || t.title || '').toLowerCase().includes(fTopic))) match = false;
      if (fTrainer && !((t.trainer || '').toLowerCase().includes(fTrainer))) match = false;
      return match;
    });
  }

  // Only the 20 most recently created deleted sessions are listed.
  const trashSessions = trainings.filter(t => t.isDeleted).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
  const attendedBefore = activeSessions.length ? _getTrnAttendedBeforeIndex() : null;

  let html = '';
  if (activeSessions.length > 0) {
    activeSessions.forEach(trn => {
      html += `
      <div class="ticket u-mb-4" style="border-left: 5px solid var(--brand-600)">
        <div class="ticket-body">
          <div class="u-flex u-justify-between u-items-start">
            <div>
              <h3 class="u-m-0 u-mb-1">${escapeHtml(trn.title)}</h3>
              <p class="u-m-0 u-fs-sm u-c-text-muted">${escapeHtml(trn.location)} ${T("| المستهدف:")} ${escapeHtml(trn.targetGroup)}</p>
            </div>
            <div class="u-c-on-solid u-text-center" style="background: var(--brand-600); padding: 8px 16px; border-radius: 8px">
              <div class="u-fs-xs" style="opacity: 0.9">${T("رمز الجلسة (PIN)")}</div>
              <div class="u-fs-2xl u-mono u-fw-700" style="letter-spacing: 4px">${escapeHtml(trn.sessionPin)}</div>
            </div>
          </div>

          <h4 style="margin:16px 0 8px 0; padding-top:16px; border-top:1px solid var(--border);">${T("📋 الحضور (")}${trn.attendees.length})</h4>
          <div class="um-table-wrap u-mb-4">
            <table class="um-table">
              <thead><tr><th>${T("الكود")}</th><th>${T("الاسم")}</th><th>${T("القسم")}</th><th>${T("الوقت")}</th><th>${T("التحقق")}</th></tr></thead>
              <tbody>
              ${trn.attendees.map(a => {
                let duplicateWarning = '';
                if (_allAdminTrainings) {
                  const pastAttendedList = (attendedBefore.get(_trnAttendedBeforeKey(trn.title, a.empCode)) || [])
                    .filter(t => t.id !== trn.id);
                  if (pastAttendedList.length > 0) {
                    const count = pastAttendedList.length;
                    const dates = pastAttendedList.map(t => new Date(t.createdMs).toISOString().split('T')[0]).join(' ، ');
                    const countText = count === 1 ? T('مرة واحدة') : `${count} ${T("مرات")}`;
                    const dateLabel = count === 1 ? T('بتاريخ:') : T('بتواريخ:');
                    duplicateWarning = `<div class="u-mt-1 u-fs-xs u-c-on-solid u-inline-block" style="background: var(--brand-600); padding: 2px 6px; border-radius: 4px">${T("⚠️ تنبيه: حضر الموظف هذه المحاضرة مسبقاً (")}${countText}) ${dateLabel} [${dates}]</div>`;
                  }
                }

                return `
                <tr>
                  <td class="u-mono u-fw-700">${escapeHtml(a.empCode)}</td>
                  <td>
                    ${escapeHtml(a.name)}
                    ${duplicateWarning}
                  </td>
                  <td>${escapeHtml(a.department)}</td>
                  <td class="u-fs-xs u-c-text-muted">${new Date(a.attendedAt).toLocaleTimeString(LOC())}</td>
                  <td>
                    <button class="btn btn-sm ${a.verified ? 'btn-secondary' : 'btn-success'}" onclick="toggleTrnVerification(${jsArg(trn.id)}, ${jsArg(a.empCode)}, ${!a.verified})">
                      ${a.verified ? T('❌ إلغاء') : T('✅ تأكيد')}
                    </button>
                  </td>
                </tr>
                `;
              }).join('')}
              ${trn.attendees.length === 0 ? T('<tr><td class="u-text-center u-c-text-muted" colspan="5">لا يوجد حضور حتى الآن. رمز الجلسة ظاهر للعمال.</td></tr>') : ''}
              </tbody>
            </table>
          </div>

          <div class="btn-row">
            <button class="btn btn-secondary" onclick="addManualTrnAttendee(${jsArg(trn.id)})">${T("➕ إضافة حضور يدوي")}</button>
            <button class="btn btn-secondary" onclick="openTrainingMediaModal(${jsArg(trn.id)})">${T("🎥 تسجيل واختبار")}</button>
            <button class="btn btn-export" onclick="exportTrainingExcel(${jsArg(trn.id)})">${T("📥 تصدير Excel")}</button>
            <button class="btn btn-warning btn-push-end" onclick="closeTrainingSession(${jsArg(trn.id)})">${T("🛑 إنهاء وإغلاق المحاضرة")}</button>
          </div>
        </div>
      </div>`;
    });
  } else {
    html += T('<div class="empty">لا توجد محاضرات جارية. يمكنك إنشاء محاضرة جديدة.</div>');
  }

  if (closedSessions.length > 0) {
    html += `<h4 class="u-mt-6">${T("المحاضرات السابقة (")}${closedSessions.length})</h4>`;
    const displaySessions = hasFilters ? closedSessions.slice(0, 500) : closedSessions.slice(0, 10);

    displaySessions.forEach(trn => {
      html += `
      <div class="ticket u-mb-2">
        <div class="ticket-body u-flex u-justify-between u-items-center">
          <div>
            <div class="u-fw-700">${escapeHtml(trn.title)}</div>
            <div class="u-fs-xs u-c-text-muted">
              ${escapeHtml(trn.date)} | ${escapeHtml(trn.trainer || T('غير محدد'))} ${T("| حضور:")} ${trn.attendees.filter(a=>a.verified).length}
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-export btn-sm" onclick="exportTrainingExcel(${jsArg(trn.id)})">📥 Excel</button>
            <button class="btn btn-secondary btn-sm" onclick="openTrainingMediaModal(${jsArg(trn.id)})">${T("🎥 تسجيل واختبار")}</button>
            <button class="btn btn-danger btn-sm" onclick="softDeleteTraining(${jsArg(trn.id)})">${T("🗑️ حذف")}</button>
          </div>
        </div>
      </div>`;
    });
    if (!hasFilters && closedSessions.length > 10) {
      html += `<div class="u-text-center u-fs-sm u-c-brand-700 u-mt-3 u-p-2" style="border: 1px dashed var(--border); border-radius: 8px">
        ${T("تم عرض أحدث 10 محاضرات من إجمالي")} ${closedSessions.length} ${T("محاضرة. استخدم فلاتر البحث بالأعلى لعرض الباقي.")}
      </div>`;
    } else if (hasFilters) {
      html += `<div class="u-text-center u-fs-sm u-c-brand-700 u-mt-3 u-p-2">
        ${T("تم العثور على")} ${closedSessions.length} ${T("نتيجة مطابقة.")}
      </div>`;
    }
  }

  if (trashSessions.length > 0) {
    html += T('<h4 style="margin-top:24px; color:var(--danger-text);">🗑️ سلة محذوفات المحاضرات</h4>');
    trashSessions.forEach(trn => {
      html += `
      <div class="ticket u-mb-2" style="border-color: var(--danger-solid); opacity: 0.8">
        <div class="ticket-body u-flex u-justify-between u-items-center">
          <div>
            <div class="u-fw-700" style="text-decoration: line-through">${escapeHtml(trn.title)}</div>
            <div class="u-fs-xs u-c-text-muted">${escapeHtml(trn.date)} ${T("| حُذفت في:")} ${trn.deletedAt ? new Date(trn.deletedAt).toLocaleDateString(LOC()) : ''}</div>
          </div>
          <div class="btn-row">
            <button class="btn btn-secondary btn-sm" onclick="restoreTraining(${jsArg(trn.id)})">${T("🔄 استعادة")}</button>
            <button class="btn btn-danger btn-sm" onclick="permanentDeleteTraining(${jsArg(trn.id)})">${T("❌ نهائي")}</button>
          </div>
        </div>
      </div>`;
    });
  }

  liveEl.innerHTML = html;
}

window.applyTrainingFilters = function() {
  if (_allAdminTrainings && _allAdminTrainings.length > 0) {
    renderAdminLiveSessions(_allAdminTrainings);
  }
};

function clearTrainingFilters() {
  document.getElementById('filter_trn_fromDate').value = '';
  document.getElementById('filter_trn_toDate').value = '';
  document.getElementById('filter_trn_topic').value = '';
  document.getElementById('filter_trn_trainer').value = '';
  if (_allAdminTrainings) renderAdminLiveSessions(_allAdminTrainings);
}

async function bulkExportTrainings() {
  if (!_allAdminTrainings) return;

  const fFrom = document.getElementById('filter_trn_fromDate')?.value;
  const fTo = document.getElementById('filter_trn_toDate')?.value;
  const fTopic = document.getElementById('filter_trn_topic')?.value?.toLowerCase();
  const fTrainer = document.getElementById('filter_trn_trainer')?.value?.toLowerCase();

  const closedSessions = _allAdminTrainings.filter(t => t.status === 'closed' && !t.isDeleted);
  const filtered = closedSessions.filter(t => {
    let match = true;
    if (fFrom && new Date(t.date || t.createdAt) < new Date(fFrom)) match = false;
    if (fTo && new Date(t.date || t.createdAt) > new Date(fTo)) match = false;
    if (fTopic && !((t.topic || t.title || '').toLowerCase().includes(fTopic))) match = false;
    if (fTrainer && !((t.trainer || '').toLowerCase().includes(fTrainer))) match = false;
    return match;
  });

  if (filtered.length === 0) {
    showToast(T('لا توجد محاضرات مطابقة للفلاتر لتصديرها.'), 'error');
    return;
  }

  showToast(T('جاري تحضير ملف الإكسيل...'), 'info');
  const ids = filtered.map(t => t.id);

  try {
    const res = await fetch('/api/trainings/export-bulk', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ids })
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Filtered_Trainings_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(T('تم تحميل الملف المجمع بنجاح!'), 'success');
    } else {
      showToast(T('فشل في تصدير البيانات المجمعة'), 'error');
    }
  } catch (err) {
    console.error(err);
    showToast(T('حدث خطأ أثناء الاتصال بالخادم'), 'error');
  }
}

async function uploadTrainingsExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const base64Data = dataUrl.split(',')[1];

    showToast(T('جاري رفع السجل واستيراد البيانات...'), 'info');

    try {
      const res = await authFetch('/api/trainings/upload-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`${T("تم استيراد")} ${json.count} ${T("محاضرة بنجاح!")}`, 'success');
        loadAdminTraining(true);
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

async function onTrnTargetModeChange() {
  const mode = document.getElementById('trn_targetMode').value;
  const extraRow = document.getElementById('trn_targetExtraRow');
  const deptWrap = document.getElementById('trn_targetDeptWrap');
  const codesWrap = document.getElementById('trn_targetCodesWrap');
  if (mode === 'all') {
    extraRow.style.display = 'none';
    return;
  }
  extraRow.style.display = 'grid';
  deptWrap.style.display = mode === 'department' ? 'block' : 'none';
  codesWrap.style.display = mode === 'workers' ? 'block' : 'none';
  if (mode === 'department') {
    const deptSelect = document.getElementById('trn_targetDept');
    if (deptSelect && !deptSelect.dataset.loaded) {
      const depts = await loadRealDepartments();
      deptSelect.innerHTML = depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      deptSelect.dataset.loaded = '1';
    }
  }
}

async function createTrainingSession() {
  const title = document.getElementById('trn_topic').value.trim();
  const targetMode = document.getElementById('trn_targetMode').value;
  const date = document.getElementById('trn_date').value;
  const loc = document.getElementById('trn_location').value;
  const stime = document.getElementById('trn_startTime').value;
  const etime = document.getElementById('trn_endTime').value;
  const trainer = (document.getElementById('trn_trainer')?.value || '').trim();
  const trainerCode = (document.getElementById('trn_trainerCode')?.value || '').trim();
  const msgEl = document.getElementById('trn_createMsg');

  if (!title || !date || !stime || !etime) {
    msgEl.textContent = T('الرجاء ملء جميع الحقول المطلوبة (*)');
    msgEl.className = 'wl-msg error show';
    return;
  }

  let targetDept = '';
  let targetEmpCodes = '';
  if (targetMode === 'department') {
    targetDept = (document.getElementById('trn_targetDept')?.value || '').trim();
    if (!targetDept) {
      msgEl.textContent = T('اختر القسم المستهدف');
      msgEl.className = 'wl-msg error show';
      return;
    }
  } else if (targetMode === 'workers') {
    targetEmpCodes = (document.getElementById('trn_targetCodes')?.value || '').trim();
    if (!targetEmpCodes) {
      msgEl.textContent = T('اكتب كود أو أكواد العمال المستهدفين');
      msgEl.className = 'wl-msg error show';
      return;
    }
  }

  try {
    const res = await authFetch('/api/trainings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, targetMode, targetDept, targetEmpCodes, date, location: loc, startTime: stime, endTime: etime, trainer, trainerCode
      })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = T('✅ تم إنشاء المحاضرة بنجاح');
      msgEl.className = 'wl-msg success show';
      document.getElementById('trn_topic').value = '';
      document.getElementById('trn_targetMode').value = 'all';
      onTrnTargetModeChange();
      if (document.getElementById('trn_targetDept')) document.getElementById('trn_targetDept').value = '';
      if (document.getElementById('trn_targetCodes')) document.getElementById('trn_targetCodes').value = '';
      document.getElementById('trn_location').value = '';
      if (document.getElementById('trn_trainer')) document.getElementById('trn_trainer').value = '';
      if (document.getElementById('trn_trainerCode')) document.getElementById('trn_trainerCode').value = '';
      window.populateTrainerInfo();
      setTimeout(() => {
        msgEl.className = 'wl-msg';
        loadAdminTraining(true);
      }, 1500);
    } else {
      msgEl.textContent = data.error || T('فشل الإنشاء');
      msgEl.className = 'wl-msg error show';
    }
  } catch(e) {
    msgEl.textContent = T('خطأ اتصال');
    msgEl.className = 'wl-msg error show';
  }
}

async function closeTrainingSession(id) {
  if (!(await appConfirm(T('هل أنت متأكد من إنهاء وإغلاق المحاضرة؟ (لن يتمكن العمال من تسجيل الحضور بعد ذلك)'), { tone: 'warning', confirmLabel: T('إنهاء وإغلاق') }))) return;
  try {
    const res = await authFetch(`/api/trainings/${id}/close`, { method: 'PUT' });
    if (res.ok) loadAdminTraining(true);
  } catch(e) {}
}
