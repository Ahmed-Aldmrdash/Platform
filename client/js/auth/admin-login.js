// Admin login gate, session restore, forced/personal password modals, account profile modal and admin logout.

async function loadCredentials(){ return null; }
async function ensureCredentials(){ return null; }

function renderLoginGate(){
  document.getElementById('supDashboard').style.display = 'none';
  document.getElementById('loginGate').innerHTML = `
    <div class="login-wrap login-v2">
      <div class="login-bg" aria-hidden="true">
        <span class="login-bg-orb orb-a"></span>
        <span class="login-bg-orb orb-b"></span>
        <span class="login-float f1">🦺</span>
        <span class="login-float f2">⛑️</span>
        <span class="login-float f3">🥽</span>
        <span class="login-float f4">🧯</span>
        <span class="login-float f5">🧤</span>
        <span class="login-float f6">⚠️</span>
      </div>
      <div class="login-card">
        <img class="logo-img" src="icons/elsewedy-logo.png" alt="Elsewedy Polymers">
        <div class="login-tape" aria-hidden="true"></div>
        <div class="login-pre-toggles">
          <button type="button" class="theme-toggle-btn lang-toggle-btn" onclick="toggleLanguage()" title="Language / اللغة"><span id="langToggleLabelGate">${window._currentLang === 'en' ? 'ع' : 'EN'}</span></button>
          <button type="button" class="theme-toggle-btn" onclick="toggleDarkMode()" title="${T('الوضع الليلي')}"><span id="themeToggleIconGate">${document.body.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'}</span></button>
        </div>
        <h2 class="login-title">${T("دخول المشرف")}</h2>
        <p class="login-sub">${T("سجّل الدخول للاطلاع على الطلبات والموافقة عليها")}</p>
        <div class="field login-field" style="--i:1">
          <label>${T("اسم المستخدم")}</label>
          <div class="login-input-wrap">
            <span class="login-ico" aria-hidden="true">👤</span>
            <input id="loginUser" type="text" placeholder="${T("اسم المستخدم")}" autocomplete="username" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('loginEmpCode').focus();}">
          </div>
        </div>
        <div class="field login-field" style="--i:2">
          <label>${T("الكود الوظيفي (empCode)")}</label>
          <div class="login-input-wrap">
            <span class="login-ico" aria-hidden="true">🆔</span>
            <input id="loginEmpCode" type="text" placeholder="${T("أدخل الكود الوظيفي (مثال: EMP001)")}" autocomplete="off" oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('loginPass').focus();}">
          </div>
        </div>
        <div class="field login-field" style="--i:3">
          <label>${T("كلمة المرور")}</label>
          <div class="login-input-wrap">
            <span class="login-ico" aria-hidden="true">🔑</span>
            <input id="loginPass" type="password" placeholder="${T("كلمة المرور")}" autocomplete="current-password" onkeydown="if(event.key==='Enter'){event.preventDefault();attemptLogin();}">
            <button type="button" class="login-eye" title="${T('إظهار/إخفاء كلمة المرور')}" onclick="_toggleLoginPw(this)">👁️</button>
          </div>
        </div>
        <button class="submit-btn login-submit" style="--i:4" onclick="attemptLogin()">
          <span>${T("دخول")}</span><span class="login-arrow" aria-hidden="true">←</span>
        </button>
        <button type="button" class="wl-link-btn" style="width:100%;margin-top:10px;--i:5" onclick="showAdminForgotPassword()">${T("نسيت كلمة السر؟")}</button>
        <button type="button" class="wl-back-btn" style="--i:6" onclick="backToWorkerLogin()">${T("رجوع لدخول الموظفين")}</button>
        <div class="login-error" id="loginErr">${T("اسم المستخدم أو كلمة المرور غير صحيحة")}</div>
        <div class="login-foot">🦺 ${T("منصة السلامة والصحة المهنية")} · ELSEWEDY POLYMERS</div>
      </div>
    </div>
  `;
}

function _toggleLoginPw(btn){
  const inp = document.getElementById('loginPass');
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁️';
  inp.focus();
}

function showLoginError(msg){
  const el = document.getElementById('loginErr');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

let _loginInFlight = false;
async function attemptLogin(){
  if (_loginInFlight) return;
  if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
  }
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const empCode = document.getElementById('loginEmpCode') ? document.getElementById('loginEmpCode').value.trim() : '';
  if(!user || !pass || !empCode){
    showLoginError(T('اكتب اسم المستخدم والكود الوظيفي وكلمة المرور'));
    return;
  }
  _loginInFlight = true;
  try{
    const res = await fetch('/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username: user, password: pass, empCode: empCode})
    });
    if(!res.ok){
      const errData = await res.json().catch(() => ({}));
      showLoginError(errData.error || T('اسم المستخدم أو كلمة المرور غير صحيحة'));
      return;
    }
    const data = await res.json();
    if(data.token) saveToken(data.token);
    // The login form stays mounted behind the dashboard, so don't leave the password in it.
    const passField = document.getElementById('loginPass');
    if (passField) passField.value = '';
    startAdminSession(data);
  } catch(e){
    showLoginError(T('لا يوجد اتصال بالسيرفر'));
  } finally {
    _loginInFlight = false;
  }
}

function startAdminSession(data){
  const mustChangePassword = data.mustChangePassword === true;
  const needsPersonalPassword = data.needsPersonalPassword === true;
  isLoggedIn      = true;
  currentUsername = data.user.username;
  currentUserName = data.user.name || data.user.username;
  currentUserRole = data.user.role;
  currentUserDept = data.user.department || '';
  if ((currentUserRole === 'dept_admin' && currentUserDept.toUpperCase() === 'HSE') || currentUsername === 'hse_admin') {
    currentUserRole = 'hse_admin';
    currentUserDept = '';
  }

  const openApp = () => {
    window._passwordSetupPending = false;
    try {
      startNotificationPolling();
      subscribeUserToPush();
    } catch (err) {
      console.warn('Non-critical notification setup error:', err);
    }
    switchTab(currentUserRole === 'ceo' ? 'executive' : 'dashboard');
    applyPendingNotificationNavFromUrl();
    if (data.needsProfile) showAdminProfileModal(data.previousHolder || null);
  };

  const gate = document.getElementById('loginGate');
  if (gate) gate.innerHTML = '';
  sessionRole = 'supervisor';
  window._passwordSetupPending = needsPersonalPassword || mustChangePassword;
  showUserBadge();
  applyRbacUI();
  // The server only accepts password setup until it's done, so the app opens afterwards.
  if (needsPersonalPassword) showSetPersonalPasswordModal(openApp);
  else if (mustChangePassword) showForcePasswordChangeModal(openApp);
  else openApp();
}

async function restoreAdminSession(){
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch('/api/auth/session', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) { clearToken(); return false; }
    const data = await res.json();
    if (!data || !data.user) { clearToken(); return false; }
    if (data.token) saveToken(data.token);
    startAdminSession(data);
    return true;
  } catch (e) {
    return false;
  }
}

function showForcePasswordChangeModal(onDone) {
  if (document.getElementById('forcePwOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'forcePwOverlay';
  overlay.className = 'force-pw-overlay';
  overlay.innerHTML = `
    <div class="force-pw-card">
      <h3>${T("🔒 يجب تغيير كلمة المرور")}</h3>
      <p>${T("حسابك ما زال يستخدم كلمة مرور افتراضية معروفة. لأسباب أمنية، يجب تعيين كلمة مرور خاصة بك قبل المتابعة.")}</p>
      <input type="password" id="forcePwCurrent" placeholder="${T("كلمة المرور الحالية")}" autocomplete="current-password" />
      <input type="password" id="forcePwNew" placeholder="${T("كلمة المرور الجديدة (8 أحرف على الأقل)")}" autocomplete="new-password" />
      <input type="password" id="forcePwConfirm" placeholder="${T("تأكيد كلمة المرور الجديدة")}" autocomplete="new-password" />
      <div class="force-pw-error" id="forcePwError"></div>
      <button class="btn btn-primary btn-block" id="forcePwSubmit" type="button">${T("تغيير كلمة المرور والمتابعة")}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('forcePwSubmit').addEventListener('click', async () => {
    const btn = document.getElementById('forcePwSubmit');
    const errEl = document.getElementById('forcePwError');
    errEl.style.display = 'none';
    const currentPassword = document.getElementById('forcePwCurrent').value;
    const newPassword     = document.getElementById('forcePwNew').value;
    const confirmPassword = document.getElementById('forcePwConfirm').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
      errEl.textContent = T('جميع الحقول مطلوبة'); errEl.style.display = 'block'; return;
    }
    if (newPassword.length < 8) {
      errEl.textContent = T('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف'); errEl.style.display = 'block'; return;
    }
    if (newPassword !== confirmPassword) {
      errEl.textContent = T('كلمة المرور الجديدة وتأكيدها غير متطابقين'); errEl.style.display = 'block'; return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.token) saveToken(data.token);
        showToast(T('تم تغيير كلمة المرور بنجاح ✓'), 'success');
        overlay.remove();
        if (typeof onDone === 'function') onDone();
      } else {
        errEl.textContent = data.error || T('فشل تغيير كلمة المرور'); errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = originalText;
      }
    } catch (e) {
      errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = originalText;
    }
  });
}

function showSetPersonalPasswordModal(onDone) {
  if (document.getElementById('setPersonalPwOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'setPersonalPwOverlay';
  overlay.className = 'force-pw-overlay';
  overlay.innerHTML = `
    <div class="force-pw-card">
      <h3>${T("🔑 اعمل كلمة سر شخصية لنفسك")}</h3>
      <p>${T("الحساب ده بيستخدمه أكتر من شخص. عشان محدش يحتاج يسأل التاني على كلمة السر، اعمل كلمة سر خاصة بيك انت بس — من دلوقتي هتدخل بيها انت، وأي زميل تاني ليه كلمة سره الخاصة.")}</p>
      <input type="password" id="setPersonalPwNew" placeholder="${T("كلمة السر الشخصية (8 أحرف على الأقل)")}" autocomplete="new-password" />
      <input type="password" id="setPersonalPwConfirm" placeholder="${T("تأكيد كلمة السر")}" autocomplete="new-password" />
      <div class="force-pw-error" id="setPersonalPwError"></div>
      <button class="btn btn-primary btn-block" id="setPersonalPwSubmit" type="button">${T("حفظ كلمة السر والمتابعة")}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('setPersonalPwSubmit').addEventListener('click', async () => {
    const btn = document.getElementById('setPersonalPwSubmit');
    const errEl = document.getElementById('setPersonalPwError');
    errEl.style.display = 'none';
    const newPassword     = document.getElementById('setPersonalPwNew').value;
    const confirmPassword = document.getElementById('setPersonalPwConfirm').value;

    if (!newPassword || !confirmPassword) {
      errEl.textContent = T('جميع الحقول مطلوبة'); errEl.style.display = 'block'; return;
    }
    if (newPassword.length < 8) {
      errEl.textContent = T('كلمة السر يجب ألا تقل عن 8 أحرف'); errEl.style.display = 'block'; return;
    }
    if (newPassword !== confirmPassword) {
      errEl.textContent = T('كلمة السر وتأكيدها غير متطابقين'); errEl.style.display = 'block'; return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      const res = await authFetch('/api/auth/set-personal-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.token) saveToken(data.token);
        showToast(T('تم إنشاء كلمة السر الشخصية بنجاح ✓'), 'success');
        overlay.remove();
        if (typeof onDone === 'function') onDone();
      } else {
        errEl.textContent = data.error || T('فشل حفظ كلمة السر'); errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = originalText;
      }
    } catch (e) {
      errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = originalText;
    }
  });
}

function showAdminProfileModal(previousHolder) {
  if (document.getElementById('adminProfileOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'adminProfileOverlay';
  overlay.className = 'force-pw-overlay';
  overlay.innerHTML = `
    <div class="force-pw-card">
      <h3>${T('👤 سجّل بياناتك قبل ما تكمل')}</h3>
      <p>${T('الحساب ده ممكن يستخدمه أكتر من شخص، فمحتاجين نعرف مين بيستخدمه دلوقتي. البيانات دي بتتحفظ على كودك الوظيفي انت — مش هتتطلب منك تاني كل ما تدخل، مرة واحدة بس.')}</p>
      <p style="font-size:12.5px;opacity:.75">${T('الإيميل ده هيستخدم بس لو احتجت كلمة سر مؤقتة من "نسيت كلمة السر؟" في المستقبل — دخولك دلوقتي تم بنجاح بالفعل.')}</p>
      ${previousHolder && previousHolder.name ? `<div class="bk-email-warn">${T('آخر واحد استخدم الحساب ده:')} <b>${escapeHtml(previousHolder.name)}</b>${previousHolder.empCode ? ` (${escapeHtml(previousHolder.empCode)})` : ''}</div>` : ''}
      <input type="text" id="apName" placeholder="${T('اسمك')}" value="${escapeHtml(currentUserName || '')}" />
      <input type="tel" id="apPhone" dir="ltr" placeholder="${T('رقم الموبايل (واتساب) — 01xxxxxxxxx')}" autocomplete="tel" />
      <input type="email" id="apEmail" dir="ltr" placeholder="${T('الإيميل بتاعك')}" autocomplete="email" />
      <div class="force-pw-error" id="apError"></div>
      <button class="btn btn-primary btn-block" id="apSubmit" type="button">${T('حفظ والدخول ✓')}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('apSubmit').addEventListener('click', async () => {
    const btn = document.getElementById('apSubmit');
    const errEl = document.getElementById('apError');
    errEl.style.display = 'none';
    const body = {
      name:  document.getElementById('apName').value.trim(),
      phone: document.getElementById('apPhone').value.trim(),
      email: document.getElementById('apEmail').value.trim(),
    };
    if (!body.phone || !body.email) {
      errEl.textContent = T('الموبايل والإيميل مطلوبين'); errEl.style.display = 'block'; return;
    }
    const original = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      const res = await authFetch('/api/auth/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(T('اتسجلت بياناتك ✓'), 'success');
        overlay.remove();
      } else {
        errEl.textContent = data.error || T('فشل الحفظ'); errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = original;
      }
    } catch (e) {
      errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = original;
    }
  });
}

function showAdminForgotPassword() {
  if (document.getElementById('adminForgotOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'adminForgotOverlay';
  overlay.className = 'force-pw-overlay';
  overlay.innerHTML = `
    <div class="force-pw-card">
      <h3>${T('🔑 نسيت كلمة السر')}</h3>
      <p>${T('هنبعتلك كلمة سر مؤقتة على الإيميل اللي سجّلته بكودك الوظيفي، صالحة 30 دقيقة، وأول ما تدخل بيها هتعمل كلمة سر جديدة.')}</p>
      <input type="text" id="fpUser" placeholder="${T('اسم المستخدم')}" value="${escapeHtml((document.getElementById('loginUser') || {}).value || '')}" autocomplete="username" />
      <input type="text" id="fpCode" placeholder="${T('الكود الوظيفي')}" value="${escapeHtml((document.getElementById('loginEmpCode') || {}).value || '')}" oninput="this.value=this.value.toUpperCase()" />
      <div class="force-pw-error" id="fpError"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-block" id="fpSubmit" type="button">${T('ابعتلي كلمة سر مؤقتة')}</button>
        <button class="btn btn-secondary" type="button" onclick="document.getElementById('adminForgotOverlay').remove()">${T('إلغاء')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('fpSubmit').addEventListener('click', async () => {
    const btn = document.getElementById('fpSubmit');
    const errEl = document.getElementById('fpError');
    errEl.style.display = 'none';
    const username = document.getElementById('fpUser').value.trim();
    const empCode  = document.getElementById('fpCode').value.trim();
    if (!username || !empCode) {
      errEl.textContent = T('اكتب اسم المستخدم والكود الوظيفي'); errEl.style.display = 'block'; return;
    }
    const original = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, empCode })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        overlay.remove();
        showToast(data.message || T('لو البيانات صحيحة هيوصلك إيميل فيه كلمة سر مؤقتة'), 'success');
      } else {
        errEl.textContent = data.error || T('فشل الإرسال'); errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = original;
      }
    } catch (e) {
      errEl.textContent = T('خطأ في الاتصال بالسيرفر'); errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = original;
    }
  });
}

function showUserBadge(){
  const supArea    = document.getElementById('supUserProfileChip');
  const umArea     = document.getElementById('umUserProfileChip');
  const globalBar  = document.getElementById('globalUserBar');
  const globalArea = document.getElementById('globalUserProfileChip');

  const roleLabels = {
    super_admin: T('مدير النظام (Super Admin)'),
    hse_admin: T('مشرف سلامة (HSE Admin)'),
    dept_admin: T('أدمن قسم / منطقة (Dept Admin)'),
    maint_admin: T('مشرف صيانة (Maint Admin)'),
    hse_director: T('مدير السلامة (متابعة — عرض فقط)'),
    ceo: T('المدير التنفيذي (متابعة — عرض فقط)')
  };

  const initial = currentUserName ? currentUserName.charAt(0).toUpperCase() : 'U';

  let deptHtml = '';
  if ((currentUserRole === 'dept_admin' || currentUserRole === 'maint_admin') && currentUserDept) {
    deptHtml = `<span class="profile-dept-pill">${T("القسم:")} ${escapeHtml(currentUserDept)}</span>`;
  }

  const chipHtml = `
    <div class="user-profile-chip">
      <div class="chip-avatar ${escapeHtml(currentUserRole)}">${escapeHtml(initial)}</div>
      <div class="chip-info">
        <span>${escapeHtml(currentUserName)}</span>
        <div class="chip-role">
          ${deptHtml}
          <span>${roleLabels[currentUserRole] || currentUserRole}</span>
        </div>
      </div>
    </div>
  `;

  if (supArea) supArea.innerHTML = chipHtml;
  if (umArea)  umArea.innerHTML  = chipHtml;
  const emAreaEl = document.getElementById('emUserProfileChip');
  if (emAreaEl)  emAreaEl.innerHTML  = chipHtml;

  if (globalArea) globalArea.innerHTML = chipHtml;
  if (globalBar)  globalBar.style.display = 'flex';
}

function logout(){
  resetChatbot();
  isLoggedIn      = false;
  currentUsername = '';
  currentUserName = '';
  currentUserRole = '';
  currentUserDept = '';
  clearToken();
  const globalBar = document.getElementById('globalUserBar');
  if (globalBar) globalBar.style.display = 'none';
  stopAllPolls();
  clearSessionData();

  stopNotificationPolling();

  sessionRole = 'none';
  applyRbacUI();
  document.getElementById('viewWorker').style.display    = 'none';
  document.getElementById('viewSup').style.display       = 'none';
  const viewMH    = document.getElementById('viewMyHistory');
  const viewUsers = document.getElementById('viewUsers');
  const viewHazW  = document.getElementById('viewHazardWorker');
  const viewHazS  = document.getElementById('viewSupHazard');
  const viewMyHaz = document.getElementById('viewMyHazards');
  const viewEmpDir = document.getElementById('viewEmployees');
  if(viewMH)     viewMH.style.display     = 'none';
  if(viewUsers)  viewUsers.style.display  = 'none';
  if(viewHazW)   viewHazW.style.display   = 'none';
  if(viewHazS)   viewHazS.style.display   = 'none';
  if(viewMyHaz)  viewMyHaz.style.display  = 'none';
  if(viewEmpDir) viewEmpDir.style.display = 'none';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  currentEmployee = null;
  localStorage.removeItem('ep_currentEmployee');
  showWorkerLoginOverlay();
  resetWorkerLogin();
}
