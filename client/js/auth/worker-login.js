// Worker login overlay: employee code lookup, password login, first-time password setup and worker logout.

function showWorkerLoginOverlay(){
  const overlay = document.getElementById('workerLoginOverlay');
  const mainApp = document.getElementById('mainApp');
  if(overlay) overlay.style.display = 'flex';
  if(mainApp) mainApp.style.display = 'none';
}

function hideWorkerLoginOverlay(){
  const overlay = document.getElementById('workerLoginOverlay');
  const mainApp = document.getElementById('mainApp');
  if(overlay) overlay.style.display = 'none';
  if(mainApp) mainApp.style.display = 'block';
}

const WORKER_AUTH_VERSION = 3;

let _wlPending = null;

const WL_STEPS = ['wl-step1', 'wl-step-password', 'wl-step-setup', 'wl-step-forgot'];

function wlShowStep(stepId){
  WL_STEPS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === stepId) ? 'block' : 'none';
  });
  const onCodeStep = stepId === 'wl-step1';
  const idCard = document.getElementById('wl-identity');
  if (idCard) idCard.style.display = (onCodeStep || !_wlPending) ? 'none' : 'block';
  document.querySelectorAll('#workerLoginOverlay .wl-divider, #workerLoginOverlay .wl-admin-btn')
    .forEach(el => { el.style.display = onCodeStep ? '' : 'none'; });
  const focusId = { 'wl-step1': 'wl_empCode', 'wl-step-password': 'wl_password', 'wl-step-setup': 'wl_newPw' }[stepId];
  const focusEl = focusId && document.getElementById(focusId);
  if (focusEl) setTimeout(() => focusEl.focus(), 50);
}

function resetWorkerLogin(){
  _wlPending = null;
  wlShowStep('wl-step1');
  const welcome = document.getElementById('wl-welcome');
  if (welcome) welcome.style.display = 'none';
  ['wl_empCode', 'wl_password', 'wl_newPw', 'wl_newPw2', 'wl_phone', 'wl_otp', 'wl_resetPw', 'wl_resetPw2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['wl_checkMsg', 'wl_pwMsg', 'wl_setupMsg', 'wl_forgotMsg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = 'wl-msg'; }
  });
  const btn = document.getElementById('wl_checkBtn');
  if (btn) { btn.disabled = false; btn.textContent = T('تسجيل الدخول ←'); }
}

function backToWorkerLogin(){
  const gate = document.getElementById('loginGate');
  if (gate) gate.innerHTML = '';
  showWorkerLoginOverlay();
  resetWorkerLogin();
}

function goToAdminLogin(){
  hideWorkerLoginOverlay();
  setDisplay('mainTabs', false);
  switchTab('sup');
  renderLoginGate();
}

function initEmployeeSession(){
  if (getToken()) {
    restoreAdminSession().then(ok => { if (!ok) _initWorkerOrLoginGate(); });
    return;
  }
  _initWorkerOrLoginGate();
}

function _initWorkerOrLoginGate(){
  try{
    const saved = localStorage.getItem('ep_currentEmployee');
    const parsed = saved ? JSON.parse(saved) : null;
    if (parsed && (parsed.authV !== WORKER_AUTH_VERSION || !parsed.token)) localStorage.removeItem('ep_currentEmployee');
    if(parsed && parsed.authV === WORKER_AUTH_VERSION && parsed.token){
      currentEmployee = parsed;

      sessionRole = 'worker';
      applyRbacUI();
      hideWorkerLoginOverlay();
      showEmpBadge();
      renderForm();
      startNotificationPolling();
      subscribeUserToPush();
      switchTab('dashboard');
      applyPendingNotificationNavFromUrl();
      return;
    }
  } catch(e){ }
  sessionRole = 'none';
  document.body.dataset.session = 'none';
  showWorkerLoginOverlay();
  renderForm();
}

function showEmpBadge(){
  if(!currentEmployee) return;
  const area = document.getElementById('empBadgeArea');
  const pill = document.getElementById('empBadgePill');
  if(!area || !pill) return;
  pill.innerHTML = `
    <span class="emp-dot">👤</span>
    <span class="emp-name">${escapeHtml(currentEmployee.name)}</span>
    <span class="emp-code-label">${escapeHtml(currentEmployee.empCode)}</span>
    <button class="btn btn-secondary btn-sm emp-logout" onclick="workerLogout()">${T("خروج")}</button>
  `;
  area.style.display = 'block';
}

function workerLogout(){
  resetChatbot();
  currentEmployee = null;
  localStorage.removeItem('ep_currentEmployee');
  stopAllPolls();
  clearSessionData();

  clearToken();
  currentAdminToken = '';
  isLoggedIn = false;
  currentUsername = '';
  currentUserName = '';
  currentUserRole = '';
  currentUserDept = '';
  const globalBar = document.getElementById('globalUserBar');
  if (globalBar) globalBar.style.display = 'none';

  stopNotificationPolling();

  sessionRole = 'none';
  applyRbacUI();
  document.getElementById('viewWorker').style.display = 'none';
  const viewMH = document.getElementById('viewMyHistory');
  if(viewMH) viewMH.style.display = 'none';
  const viewMyHaz = document.getElementById('viewMyHazards');
  if(viewMyHaz) viewMyHaz.style.display = 'none';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  showWorkerLoginOverlay();
  resetWorkerLogin();
}

async function checkEmpCode(){
  if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
  }
  const rawInput = document.getElementById('wl_empCode').value;
  const cleanCode = String(rawInput || '').trim().replace(/^0+/, '') || '0';
  if(!cleanCode || (cleanCode === '0' && rawInput.trim() === '')){
    showWlMsg('wl_checkMsg', T('من فضلك أدخل الكود الوظيفي'), 'error');
    return;
  }
  const codeRaw = cleanCode;
  const btn = document.getElementById('wl_checkBtn');
  btn.disabled = true;
  btn.textContent = T('جارِ التحقق…');

  try{
    const res = await fetch(`/api/worker-auth/status/${encodeURIComponent(codeRaw)}`);
    if(res.ok){
      const data = await res.json();
      if(data.found){
        _wlPending = { code: data.employee.code, employee: data.employee };
        wlShowIdentity(data.employee);
        wlShowStep(data.hasPassword ? 'wl-step-password' : 'wl-step-setup');
        btn.disabled = false;
        btn.textContent = T('تسجيل الدخول ←');
      } else {
        showWlMsg('wl_checkMsg',
          T('❌ الكود الوظيفي غير مسجل بقاعدة البيانات، يرجى مراجعة إدارة الموارد البشرية أو المشرف'),
          'error');
        btn.disabled = false;
        btn.textContent = T('تسجيل الدخول ←');
      }
    } else {
      showWlMsg('wl_checkMsg', T('حصل خطأ في التحقق، حاول تاني'), 'error');
      btn.disabled = false;
      btn.textContent = T('تسجيل الدخول ←');
    }
  } catch(e){
    showWlMsg('wl_checkMsg', T('لا يوجد اتصال بالسيرفر'), 'error');
    btn.disabled = false;
    btn.textContent = T('تسجيل الدخول ←');
  }
}

function wlShowIdentity(emp){
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('wl_idName', emp.name || '');
  set('wl_idDept', emp.department || '—');
  set('wl_idJob',  emp.jobTitle || '—');
  set('wl_idCode', emp.code || '');
}

function _wlDigits(s){
  return String(s || '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function _wlVal(id){ const el = document.getElementById(id); return el ? el.value : ''; }

function _wlBusy(btnId, busy){
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = busy;
  b.style.opacity = busy ? '0.7' : '';
}

async function _wlPost(url, body){
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: T('لا يوجد اتصال بالسيرفر') } };
  }
}

function _wlValidPhone(p){
  const s = p.replace(/[\s-]/g, '');
  return /^01[0125][0-9]{8}$/.test(s) || /^(\+|00)[1-9][0-9]{7,14}$/.test(s);
}

function _wlPasswordError(pw, pw2){
  if (pw.length < 6) return T('كلمة السر لازم تكون 6 حروف أو أرقام على الأقل');
  if (pw !== pw2) return T('كلمتين السر مش زي بعض');
  return null;
}

function _wlEnter(emp, token){
  WL_STEPS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const idCard = document.getElementById('wl-identity');
  if (idCard) idCard.style.display = 'none';
  _wlPending = null;
  finishEmployeeLogin({
    empCode:    emp.code,
    name:       emp.name,
    department: emp.department,
    jobTitle:   emp.jobTitle || '',
    role:       emp.role     || 'worker',
    phone:      emp.phone    || '',
    token:      token        || ''
  });
}

async function workerPasswordLogin(){
  if (!_wlPending) return resetWorkerLogin();
  const pw = _wlVal('wl_password');
  if (!pw) { showWlMsg('wl_pwMsg', T('اكتب كلمة السر'), 'error'); return; }
  _wlBusy('wl_loginBtn', true);
  const r = await _wlPost('/api/worker-auth/login', { code: _wlPending.code, password: pw });
  _wlBusy('wl_loginBtn', false);
  if (r.ok) return _wlEnter(r.data.employee, r.data.token);
  showWlMsg('wl_pwMsg', r.data.error || T('حصل خطأ في التحقق، حاول تاني'), 'error');
  if (r.data.needsSetup) wlShowStep('wl-step-setup');
}

async function workerSetupPassword(){
  if (!_wlPending) return resetWorkerLogin();
  const pw = _wlVal('wl_newPw');
  const phone = _wlDigits(_wlVal('wl_phone')).trim();
  const pwErr = _wlPasswordError(pw, _wlVal('wl_newPw2'));
  if (pwErr) { showWlMsg('wl_setupMsg', pwErr, 'error'); return; }
  if (!_wlValidPhone(phone)) { showWlMsg('wl_setupMsg', T('رقم الموبايل غير صحيح — اكتبه كده: 01xxxxxxxxx'), 'error'); return; }
  const email = _wlVal('wl_email').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showWlMsg('wl_setupMsg', T('الإيميل غير صحيح — سيبه فاضي لو مش عايز تسجله'), 'error'); return; }
  _wlBusy('wl_setupBtn', true);
  const r = await _wlPost('/api/worker-auth/setup', { code: _wlPending.code, password: pw, phone, email });
  _wlBusy('wl_setupBtn', false);
  if (r.ok) return _wlEnter(r.data.employee, r.data.token);
  showWlMsg('wl_setupMsg', r.data.error || T('حصل خطأ في التحقق، حاول تاني'), 'error');
}

function wlShowForgot(){
  if (!_wlPending) return resetWorkerLogin();
  const note = document.getElementById('wl_forgotNote');
  if (note) note.textContent = T('كلّم مشرف السلامة أو أدمن قسمك يعملك كلمة سر جديدة من شاشة الموظفين ويديهالك، وبعدها ادخل بكودك وكلمة السر الجديدة.');
  wlShowStep('wl-step-forgot');
}

async function registerEmployee(){
  const codeRaw = document.getElementById('wl_empCode').value.trim();
  const name = document.getElementById('wl_name').value.trim();
  const phone = document.getElementById('wl_phone').value.trim();
  const dept = document.getElementById('wl_dept').value.trim();
  if(!codeRaw || !name || !phone || !dept){
    showWlMsg('wl_registerMsg', T('من فضلك املأ جميع الحقول المطلوبة'), 'error');
    return;
  }
  const btn = document.getElementById('wl_registerBtn');
  btn.disabled = true;
  btn.textContent = T('جارِ الحفظ…');
  try{
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ empCode: codeRaw, name, phone, department: dept })
    });
    const data = await res.json();
    if(res.ok){
      finishEmployeeLogin(data.employee);
    } else {
      showWlMsg('wl_registerMsg', data.error || T('فشل التسجيل، حاول تاني'), 'error');
    }
  } catch(e){
    showWlMsg('wl_registerMsg', T('لا يوجد اتصال بالسيرفر'), 'error');
  }
  btn.disabled = false;
  btn.textContent = T('حفظ وتسجيل الدخول ✓');
}
