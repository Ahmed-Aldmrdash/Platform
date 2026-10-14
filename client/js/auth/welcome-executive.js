// Post-login welcome animation, the read-only executive view, and the hand-off from login into the main UI.

let _welcomeAudioCtx = null;
function _playKeyClick(){
  try{
    if (!_welcomeAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      _welcomeAudioCtx = new AC();
    }
    const ctx = _welcomeAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(950 + Math.random() * 350, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  } catch(e) { }
}

let _welcomeAnimRun = 0;
function showAnimatedWelcome({ name, greeting, subtitle, onDone }){
  const overlay = document.getElementById('welcomeAnimOverlay');
  const textEl  = document.getElementById('welcomeAnimText');
  const subEl   = document.getElementById('welcomeAnimSub');
  if (!overlay || !textEl) { if (typeof onDone === 'function') onDone(); return; }

  const myRun = ++_welcomeAnimRun;
  const isCurrent = () => myRun === _welcomeAnimRun;

  const fullText = `${greeting || T('أهلاً بك')}${T("،")} ${name || ''}`;
  textEl.innerHTML = '<span id="welcomeAnimCursor" class="welcome-anim-cursor">|</span>';
  if (subEl) { subEl.textContent = subtitle || ''; subEl.classList.remove('show'); }
  overlay.style.display = 'flex';
  overlay.querySelectorAll('.ppe-item, .welcome-anim-slogan').forEach(el => {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  });

  const chars = Array.from(fullText);
  let i = 0;
  function typeNext(){
    if (!isCurrent()) return;
    if (i >= chars.length) {
      if (subEl && subtitle) setTimeout(() => { if (isCurrent()) subEl.classList.add('show'); }, 150);
      setTimeout(() => {
        if (!isCurrent()) return;
        overlay.style.display = 'none';
        if (typeof onDone === 'function') onDone();
      }, 1700);
      return;
    }
    const ch = chars[i];
    const cursor = document.getElementById('welcomeAnimCursor');
    const node = document.createTextNode(ch);
    if (cursor) textEl.insertBefore(node, cursor); else textEl.appendChild(node);
    if (ch.trim()) _playKeyClick();
    i++;
    setTimeout(typeNext, (ch === ' ' || ch === '،') ? 130 : (60 + Math.random() * 40));
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (isCurrent()) setTimeout(typeNext, 200);
  }));
}

async function renderExecutiveView(){
  const view = document.getElementById('viewExecutive');
  if (view) view.style.display = 'block';
  const container = document.getElementById('executiveContent');
  if (!container) return;
  const L = (window._currentLang === 'en');
  container.innerHTML = `<div class="loading">${L ? 'Loading metrics…' : T('جارِ تحميل المؤشرات…')}</div>`;

  try{
    const res = await authFetch('/api/executive/overview');
    if (!res.ok) {
      container.innerHTML = `<div class="empty"><div class="icon">✦</div>${L ? 'Failed to load metrics, please refresh' : T('تعذّر تحميل المؤشرات، حاول تحديث الصفحة')}</div>`;
      return;
    }
    const d = await res.json();
    const t = d.totals || {};
    const permitsApproved = (d.permits && d.permits.byStatus && d.permits.byStatus.approved) || 0;
    const scoreLabel = d.companySafetyScore == null ? '—' : d.companySafetyScore;
    const kpis = [
      { value: t.employees ?? '—', label: L ? 'Total Employees' : T('إجمالي الموظفين') },
      { value: t.permits ?? '—', label: L ? 'Work Permits' : T('تصاريح العمل'), sub: `${permitsApproved} ${L ? 'approved' : T('معتمد')}` },
      { value: t.hazards ?? '—', label: L ? 'Hazard Reports' : T('بلاغات الخطورة'), sub: `${t.openHazards ?? 0} ${L ? 'currently open' : T('مفتوح حاليًا')}` },
      { value: t.activePenalties ?? '—', label: L ? 'Active Penalties' : T('الجزاءات النشطة') },
      { value: (d.training && d.training.uniqueEmployeesTrainedLast12Months) ?? '—', label: L ? 'Employees Trained (last year)' : T('موظف تم تدريبه (آخر سنة)') },
      { value: (d.drills && d.drills.sessionsLast12Months) ?? '—', label: L ? 'Emergency Drills (last year)' : T('تجارب طوارئ (آخر سنة)') },
    ];

    const board = (d.departmentLeaderboard || []).slice(0, 12);
    const maxScore = board.length ? Math.max(...board.map(b => b.score)) : 100;

    const EXEC_ROLE_TITLE = {
      ceo:          L ? 'Managing Director' : T('المدير التنفيذي'),
      hse_director: L ? 'HSE Director' : T('مدير السلامة والصحة المهنية'),
    };
    const execRoleTitle = EXEC_ROLE_TITLE[currentUserRole] || (L ? 'Managing Director' : T('المدير التنفيذي'));
    container.innerHTML = `
      <div class="exec-hero">
        <div class="exec-hero-eyebrow">Executive View${L ? '' : T(' — عرض تنفيذي')}</div>
        <div class="exec-hero-name">${escapeHtml(currentUserName || '')}</div>
        <div class="exec-hero-role">${escapeHtml(execRoleTitle)} · ${L ? 'Read only' : T('قراءة فقط')}</div>
        <div class="exec-hero-score">
          <div class="num">${scoreLabel}</div>
          <div class="label">${L ? 'Company-wide safety score (out of 100) — average across all departments' : T('مؤشر السلامة العام للشركة (من 100) — متوسط أداء كل الأقسام')}</div>
        </div>
      </div>

      <div class="exec-kpi-grid">
        ${kpis.map(k => `
          <div class="exec-kpi-card">
            <div class="exec-kpi-value">${escapeHtml(String(k.value))}</div>
            <div class="exec-kpi-label">${escapeHtml(k.label)}</div>
            ${k.sub ? `<div class="exec-kpi-sub">${escapeHtml(k.sub)}</div>` : ''}
          </div>
        `).join('')}
      </div>

      <div class="exec-section-title">${L ? 'Department ranking by safety compliance' : T('ترتيب الأقسام حسب الالتزام بالسلامة')}</div>
      <div class="exec-leaderboard">
        ${board.length ? board.map((b, idx) => `
          <div class="exec-leaderboard-row">
            <div class="exec-leaderboard-rank">${idx + 1}</div>
            <div>
              <div class="exec-leaderboard-name">${escapeHtml(b.department)}</div>
              <div class="exec-leaderboard-meta">${b.employeeCount} ${L ? 'employees' : T('موظف')} · ${L ? 'training target' : T('حققوا تارجت التدريب')}: ${b.trainAchieved ?? '—'} · ${L ? 'hazard target' : T('تارجت البلاغات')}: ${b.hazardAchieved ?? '—'}${b.penalties ? ` · ${L ? 'penalties' : T('جزاءات')}: ${b.penalties}` : ''}</div>
              <div class="exec-leaderboard-bar-bg">
                <div class="exec-leaderboard-bar-fill" style="width:${Math.max(2, (b.score / (maxScore || 100)) * 100)}%"></div>
              </div>
            </div>
            <div class="exec-leaderboard-score">${b.score}</div>
          </div>
        `).join('') : `<div class="empty" style="padding:24px"><div class="icon">✦</div>${L ? 'Not enough data yet' : T('لا توجد بيانات كافية بعد')}</div>`}
      </div>

      <div style="text-align:center; margin-top:26px">
        <button class="logout-btn" onclick="logout()">${L ? 'Logout' : T('تسجيل الخروج')}</button>
      </div>
      <div class="exec-footer-note">
        ${L ? 'Live data — last updated' : T('بيانات لحظية — آخر تحديث')} ${new Date(d.generatedAt).toLocaleString(L ? 'en-US' : 'ar-EG')}
      </div>
    `;
  } catch(e){
    console.error('renderExecutiveView error', e);
    container.innerHTML = `<div class="empty"><div class="icon">✦</div>${L ? 'No connection to server' : T('لا يوجد اتصال بالسيرفر')}</div>`;
  }
}

function finishEmployeeLogin(emp){
  if (window.allEmployees && window.allEmployees.length && emp.name) {
    const found = window.allEmployees.find(e => e.name && e.name.trim() === emp.name.trim());
    if (found && found.empCode) {
      emp.empCode = String(found.empCode);
    }
  }

  emp.authV = WORKER_AUTH_VERSION;
  currentEmployee = emp;
  try{
    localStorage.setItem('ep_currentEmployee', JSON.stringify(emp));
    if (emp.empCode) {
      sessionStorage.setItem('last_logged_emp_code', String(emp.empCode));
    }
  } catch(e){ }

  showAnimatedWelcome({
    name: emp.name,
    subtitle: [emp.jobTitle, emp.department].filter(Boolean).join(' · '),
    onDone: () => {
      sessionRole = 'worker';
      applyRbacUI();
      hideWorkerLoginOverlay();
      showEmpBadge();
      autoFillForm();
      startNotificationPolling();
      subscribeUserToPush();
      switchTab('dashboard');
      applyPendingNotificationNavFromUrl();
      if (typeof window.populateTrainerInfo === 'function') window.populateTrainerInfo();
    }
  });
}

function autoFillForm(){
  if(!currentEmployee) return;
  const set = (id, val, readonly=true) => {
    const el = safeEl(id);
    if(!el) return;
    el.value = val || '';
    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    if(readonly && isInput) el.setAttribute('readonly', 'readonly');
    else if(isInput) el.removeAttribute('readonly');
  };
  set('f_name', currentEmployee.name, true);
  set('f_emp',  currentEmployee.empCode, true);
  set('f_phone', currentEmployee.phone, false);
  set('f_dept',  currentEmployee.department, true);
  const jobTitleEl = safeEl('f_jobTitle');
  if(jobTitleEl && currentEmployee.jobTitle){
    jobTitleEl.value = currentEmployee.jobTitle;
    jobTitleEl.setAttribute('readonly','readonly');
  }
}

async function lookupPermitEmpCode() {
  const empEl  = safeEl('f_emp');
  const msgEl  = safeEl('f_empMsg');
  if (!empEl || !empEl.value.trim()) return;
  if (empEl.hasAttribute('readonly')) return;
  const rawInput = empEl.value;
  const cleanCode = String(rawInput || '').trim().replace(/^0+/, '') || '0';
  try {
    const res  = await authFetch(`/api/employees/lookup/${encodeURIComponent(cleanCode)}`);
    const data = await res.json();
    if (data.found) {
      const emp = data.employee;
      const set = (id, val) => { const el = safeEl(id); if(el){ el.value = val||''; el.setAttribute('readonly','readonly'); } };
      set('f_name',     emp.name);
      set('f_jobTitle', emp.jobTitle);
      const deptEl = safeEl('f_dept');
      if (deptEl) deptEl.value = emp.department || '';
      if (msgEl) { msgEl.textContent = `✅ ${emp.name} — ${emp.department||''}${emp.jobTitle?' | '+emp.jobTitle:''}`; msgEl.style.color='var(--success)'; }
    } else {
      if (msgEl) { msgEl.textContent = T('الكود غير مسجل، يرجى كتابة البيانات يدوياً'); msgEl.style.color='var(--muted)'; }
      ['f_name','f_jobTitle'].forEach(id => { const el=safeEl(id); if(el) el.removeAttribute('readonly'); });
    }
  } catch(e) {
    if (msgEl) { msgEl.textContent = T('خطأ في البحث'); msgEl.style.color='var(--danger)'; }
  }
}

function showWlMsg(elId, msg, type){
  const el = document.getElementById(elId);
  if(!el) return;
  el.textContent = msg;
  el.className = 'wl-msg ' + type;
}

function showDashboard(){
  const viewSup = document.getElementById('viewSup');
  if (viewSup) viewSup.style.display = 'block';

  document.getElementById('loginGate').innerHTML = '';
  document.getElementById('supDashboard').style.display = 'block';
  renderSupervisor();

  if(!isPolling('permits')) poll('permits', pollPermitsForSupervisor, 4000);
}
