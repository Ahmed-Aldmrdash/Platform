// Role-based visibility (applyRbacUI), read-only viewer guards and tab switching.

let sessionRole = 'none';
const VIEWER_ROLES_UI = ['hse_director', 'ceo'];

function setDisplay(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

// Single place that decides which tabs and views are visible; call it after every login/logout.
function applyRbacUI() {
  const isWorker = sessionRole === 'worker';
  const isSup    = sessionRole === 'supervisor';
  const isCeo    = sessionRole === 'ceo';
  const isNone   = sessionRole === 'none';

  const isViewer = VIEWER_ROLES_UI.includes(currentUserRole);
  const uiRole   = isViewer ? 'super_admin' : currentUserRole;
  if (isViewer) document.body.dataset.readonly = '1'; else delete document.body.dataset.readonly;
  _renderViewerBanner(isViewer && isSup);
  _applyReadonlyGuards();

  document.body.dataset.session = sessionRole;
  syncChatbotVisibility();

  const mainApp = document.getElementById('mainApp');
  if (isWorker || isSup || isCeo) {
    if (mainApp) mainApp.style.display = 'block';
    const overlay = document.getElementById('workerLoginOverlay');
    if (overlay) overlay.style.display = 'none';
  }
  if (isNone) {
    if (mainApp) mainApp.style.display = 'none';
  }

  setDisplay('viewExecutive', isCeo || window.currentActiveTab === 'executive');
  if (isCeo) {
    ['viewDashboard','viewInspections','viewAuditLog','viewWorker','viewHazardWorker',
     'viewMyHistory','viewMyHazards','viewSup','viewSupHazard','viewUsers','viewEmployees',
     'viewTrainingWorker','viewTrainingAdmin','viewDrillWorker','viewDrillAdmin',
     'viewPenaltiesWorker','viewPenaltiesAdmin','viewReports'].forEach(id => setDisplay(id, false));
    const empArea = document.getElementById('empBadgeArea');
    if (empArea) empArea.style.display = 'none';
  }

  setDisplay('mainTabs', isWorker || isSup);

  setDisplay('tabWorker',       isWorker);
  setDisplay('tabHazardWorker', isWorker);
  setDisplay('tabMyHistory',    isWorker);
  setDisplay('tabMyHazards',    isWorker);
  setDisplay('tabSup',          isSup);
  setDisplay('tabSupHazard',    isSup);
  const tabUsers = document.getElementById('tabUsers');
  if (tabUsers) tabUsers.style.display = (isSup && uiRole === 'super_admin' && !isViewer) ? '' : 'none';
  const tabEmployees = document.getElementById('tabEmployees');
  if (tabEmployees) tabEmployees.style.display = isSup ? '' : 'none';

  setDisplay('tabTrainingWorker', isWorker);
  setDisplay('tabTrainingAdmin', isSup && (uiRole === 'super_admin' || uiRole === 'hse_admin'));

  setDisplay('tabDrillWorker', isWorker);
  setDisplay('tabDrillAdmin', isSup && (uiRole === 'super_admin' || uiRole === 'hse_admin'));

  setDisplay('tabPenaltiesWorker', isWorker);
  setDisplay('tabPenaltiesAdmin', isSup);

  setDisplay('tabInspections', isSup && (uiRole === 'super_admin' || uiRole === 'hse_admin'));
  setDisplay('tabAuditLog', isSup && (uiRole === 'super_admin' || uiRole === 'hse_admin'));
  setDisplay('tabReports', isSup && (uiRole === 'super_admin' || uiRole === 'hse_admin'));
  setDisplay('tabExecutive', isSup && isViewer);

  setDisplay('tabDashboard', isWorker || isSup);

  const isSafetyOrSuper = isSup && !isViewer && (currentUserRole === 'hse_admin' || currentUserRole === 'super_admin');
  setDisplay('clearPermitsBtn', isSafetyOrSuper);
  setDisplay('clearHazardsBtn', isSafetyOrSuper);
  setDisplay('clearEmployeesBtn', isSafetyOrSuper);
  setDisplay('hzAlertSettingsBtn', isSafetyOrSuper);

  setDisplay('empAddBtn', isSup && !isViewer);
  setDisplay('empImportBtn', isSup && !isViewer);

  setDisplay('uploadPermitsExcelBtn', isSafetyOrSuper);
  setDisplay('uploadHazardsExcelBtn', isSafetyOrSuper);
  setDisplay('uploadPenaltiesExcelBtn', isSafetyOrSuper);

  const empArea  = document.getElementById('empBadgeArea');
  if (empArea)  empArea.style.display  = isWorker ? 'block' : 'none';

  const notifContainer = document.getElementById('notifContainer');
  if (notifContainer) notifContainer.style.display = (isWorker || isSup) ? 'inline-flex' : 'none';

  // Logout stops every poller, so the hazard badge/list poller is restarted on the next login.
  if ((isWorker || isSup) && !isPolling('hazards') && typeof startHazardPolling === 'function') startHazardPolling();
}

const RO_ACTION_RE = /حذف|مسح|إضافة|أضف|إضف|تعديل|تعديلات|رفع|استيراد|اعتماد|موافقة|رفض|إغلاق|إنهاء|حفظ|توليد|ابعت|إرسال|استرجاع|تغيير/;
let _roObserver = null;
function _applyReadonlyGuards() {
  if (document.body.dataset.readonly !== '1') {
    if (_roObserver) { _roObserver.disconnect(); _roObserver = null; }
    return;
  }
  const RO_SELECTOR = 'button, label.btn, .um-btn, .btn';
  const guard = el => {
    if (el.dataset.roGuard) return;
    if (el.closest('#cbPanel') || el.closest('#forcePwOverlay') || el.closest('#adminProfileOverlay') ||
        el.closest('#adminForgotOverlay') || el.closest('#viewerModeBar') || el.closest('#appHeader')) return;
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt || !RO_ACTION_RE.test(txt)) return;
    if (/تصدير|تنزيل|Power BI|عرض|بحث|فلتر|رجوع|إلغاء/.test(txt)) return;
    el.dataset.roGuard = '1';
    el.style.display = 'none';
  };
  const scan = root => {
    if (root.matches && root.matches(RO_SELECTOR)) guard(root);
    root.querySelectorAll(RO_SELECTOR).forEach(guard);
  };
  scan(document);
  if (!_roObserver) {
    // Only the nodes added by each mutation need checking.
    _roObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (!m.addedNodes.length) continue;
        // Text set on an existing button arrives as a child mutation of the button itself.
        const host = m.target.nodeType === 1 && m.target.closest(RO_SELECTOR);
        if (host) guard(host);
        m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); });
      }
    });
    // The whole body, so modals appended outside #mainApp are covered too.
    _roObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function _renderViewerBanner(show) {
  let bar = document.getElementById('viewerModeBar');
  if (!show) { if (bar) bar.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'viewerModeBar';
  bar.className = 'viewer-bar';
  const badge = currentUserRole === 'ceo' ? 'CEO · Executive' : 'HSE Director';
  bar.innerHTML = `
    <span class="viewer-bar-eye">👁️</span>
    <div class="viewer-bar-text">
      <b>${T('وضع المتابعة — عرض فقط')}</b>
      <span>${escapeHtml(currentUserName || '')}${currentUserName ? ' · ' : ''}${T('كل بيانات المصنع ظاهرة لحضرتك، والتعديل مقفول تمامًا')}</span>
    </div>
    <span class="viewer-bar-badge">${badge}</span>`;
  document.body.appendChild(bar);
}

async function loadPermits(){
  const res = await apiGet('work-permits');
  return res && res.value ? JSON.parse(res.value) : [];
}
function genId(list){
  const year = new Date().getFullYear();
  const maxN = list.reduce((mx, p) => {
    if(!p.id) return mx;
    const parts = p.id.split('-');
    const num = parseInt(parts[parts.length - 1]) || 0;
    return Math.max(mx, num);
  }, 0);
  return `WP-${year}-${String(maxN + 1).padStart(4,'0')}`;
}

function switchTab(which){
  window.currentActiveTab = which;
  const workerTabs = ['worker', 'hazardWorker', 'myhistory', 'myhazards', 'trainingWorker', 'drillWorker', 'penaltiesWorker'];
  const supTabs    = ['sup', 'supHazard', 'users', 'employees', 'trainingAdmin', 'drillAdmin', 'penaltiesAdmin', 'inspections', 'auditlog', 'reports'];
  if (workerTabs.includes(which) && sessionRole === 'supervisor') return;
  if (supTabs.includes(which)   && sessionRole === 'worker') return;

  document.getElementById('tabWorker').classList.toggle('active', which==='worker');
  const tabDash = document.getElementById('tabDashboard');
  if(tabDash) tabDash.classList.toggle('active', which==='dashboard');
  const tabHazardW = document.getElementById('tabHazardWorker');
  if(tabHazardW) tabHazardW.classList.toggle('active', which==='hazardWorker');
  const tabMH = document.getElementById('tabMyHistory');
  if(tabMH) tabMH.classList.toggle('active', which==='myhistory');
  const tabMyHaz = document.getElementById('tabMyHazards');
  if(tabMyHaz) tabMyHaz.classList.toggle('active', which==='myhazards');
  document.getElementById('tabSup').classList.toggle('active', which==='sup');
  const tabSupHazard = document.getElementById('tabSupHazard');
  if(tabSupHazard) tabSupHazard.classList.toggle('active', which==='supHazard');
  const tabUsers = document.getElementById('tabUsers');
  if(tabUsers) tabUsers.classList.toggle('active', which==='users');
  const tabEmp = document.getElementById('tabEmployees');
  if(tabEmp) tabEmp.classList.toggle('active', which==='employees');
  const tabTrnW = document.getElementById('tabTrainingWorker');
  if(tabTrnW) tabTrnW.classList.toggle('active', which==='trainingWorker');
  const tabTrnA = document.getElementById('tabTrainingAdmin');
  if(tabTrnA) tabTrnA.classList.toggle('active', which==='trainingAdmin');
  const tabDrlW = document.getElementById('tabDrillWorker');
  if(tabDrlW) tabDrlW.classList.toggle('active', which==='drillWorker');
  const tabDrlA = document.getElementById('tabDrillAdmin');
  if(tabDrlA) tabDrlA.classList.toggle('active', which==='drillAdmin');
  const tabPenW = document.getElementById('tabPenaltiesWorker');
  if(tabPenW) tabPenW.classList.toggle('active', which==='penaltiesWorker');
  const tabPenA = document.getElementById('tabPenaltiesAdmin');
  if(tabPenA) tabPenA.classList.toggle('active', which==='penaltiesAdmin');
  const tabInsp = document.getElementById('tabInspections');
  if(tabInsp) tabInsp.classList.toggle('active', which==='inspections');
  const tabAudit = document.getElementById('tabAuditLog');
  if(tabAudit) tabAudit.classList.toggle('active', which==='auditlog');
  const tabRep = document.getElementById('tabReports');
  if(tabRep) tabRep.classList.toggle('active', which==='reports');
  const tabExec = document.getElementById('tabExecutive');
  if(tabExec) tabExec.classList.toggle('active', which==='executive');

  document.getElementById('viewWorker').style.display = which==='worker' ? 'block':'none';
  const viewHazardW = document.getElementById('viewHazardWorker');
  if(viewHazardW) viewHazardW.style.display = which==='hazardWorker' ? 'block':'none';
  const viewMH = document.getElementById('viewMyHistory');
  if(viewMH) viewMH.style.display = which==='myhistory' ? 'block':'none';
  const viewMyHazards = document.getElementById('viewMyHazards');
  if(viewMyHazards) viewMyHazards.style.display = which==='myhazards' ? 'block':'none';
  document.getElementById('viewSup').style.display = which==='sup' ? 'block':'none';
  const viewSupHazard = document.getElementById('viewSupHazard');
  if(viewSupHazard) viewSupHazard.style.display = which==='supHazard' ? 'block':'none';
  const viewUsers = document.getElementById('viewUsers');
  if(viewUsers) viewUsers.style.display = which==='users' ? 'block':'none';
  const viewEmp = document.getElementById('viewEmployees');
  if(viewEmp) viewEmp.style.display = which==='employees' ? 'block':'none';
  const viewTrnW = document.getElementById('viewTrainingWorker');
  if(viewTrnW) viewTrnW.style.display = which==='trainingWorker' ? 'block':'none';
  const viewTrnA = document.getElementById('viewTrainingAdmin');
  if(viewTrnA) viewTrnA.style.display = which==='trainingAdmin' ? 'block':'none';
  const viewDrlW = document.getElementById('viewDrillWorker');
  if(viewDrlW) viewDrlW.style.display = which==='drillWorker' ? 'block':'none';
  const viewDrlA = document.getElementById('viewDrillAdmin');
  if(viewDrlA) viewDrlA.style.display = which==='drillAdmin' ? 'block':'none';
  const viewPenW = document.getElementById('viewPenaltiesWorker');
  if(viewPenW) viewPenW.style.display = which==='penaltiesWorker' ? 'block':'none';
  const viewPenA = document.getElementById('viewPenaltiesAdmin');
  if(viewPenA) viewPenA.style.display = which==='penaltiesAdmin' ? 'block':'none';
  const viewDash = document.getElementById('viewDashboard');
  if(viewDash) viewDash.style.display = which==='dashboard' ? 'block':'none';
  const viewInsp = document.getElementById('viewInspections');
  if(viewInsp) viewInsp.style.display = which==='inspections' ? 'block':'none';
  const viewAudit = document.getElementById('viewAuditLog');
  if(viewAudit) viewAudit.style.display = which==='auditlog' ? 'block':'none';
  const viewRep = document.getElementById('viewReports');
  if(viewRep) viewRep.style.display = which==='reports' ? 'block':'none';
  const viewExec = document.getElementById('viewExecutive');
  if(viewExec) viewExec.style.display = which==='executive' ? 'block':'none';

  // Tab pollers only run while their tab is open.
  if(which !== 'sup') stopPoll('permits');
  if(which !== 'myhistory') stopPoll('myHistory');
  if(which !== 'trainingAdmin') stopPoll('trnAdmin');
  if(which !== 'trainingWorker') stopPoll('trnWorker');
  if(which !== 'drillAdmin') stopPoll('drlAdmin');
  if(which !== 'drillWorker') stopPoll('drlWorker');
  if(which !== 'auditlog') stopPoll('audit');

  if(which==='worker'){
    if(window._formLang && window._formLang !== window._currentLang && typeof renderForm === 'function') renderForm();
  }
  if(which==='sup'){
    if(isLoggedIn){ showDashboard(); } else { renderLoginGate(); }
  }
  if(which==='myhistory'){
    renderMyHistory();
    if(!isPolling('myHistory')) poll('myHistory', pollMyHistory, 4000);
  }
  if(which==='myhazards'){
    // The background hazard poller refreshes this list while it is visible.
    renderMyHazards();
  }
  if(which==='hazardWorker'){
    initHazardWorker();
  }
  if(which==='users'){
    if(isLoggedIn && currentUserRole==='super_admin'){ renderUsersPanel(); }
    else { switchTab('sup'); }
  }
  if(which==='supHazard'){
    if(isLoggedIn){ renderSupHazard(); } else { switchTab('sup'); }
  }
  if(which==='employees'){
    if(isLoggedIn){ renderEmployeesPanel(); } else { switchTab('sup'); }
  }
  if(which==='trainingWorker'){
    if(currentEmployee){
      if (typeof window.populateTrainerInfo === 'function') {
        window.populateTrainerInfo();
        setTimeout(window.populateTrainerInfo, 150);
      }
      loadWorkerTraining();
      if(!isPolling('trnWorker')) poll('trnWorker', () => loadWorkerTraining(true), 10000);
    }
  }
  if(which==='trainingAdmin'){
    if(isLoggedIn){
      if (typeof window.populateTrainerInfo === 'function') {
        window.populateTrainerInfo();
        setTimeout(window.populateTrainerInfo, 150);
      }
      loadAdminTraining();
    } else { switchTab('sup'); }
  }
  if(which==='drillWorker'){
    if(currentEmployee){
      if (typeof window.populateTrainerInfo === 'function') {
        window.populateTrainerInfo();
        setTimeout(window.populateTrainerInfo, 150);
      }
      loadWorkerDrill();
      if(!isPolling('drlWorker')) poll('drlWorker', () => loadWorkerDrill(true), 10000);
    }
  }
  if(which==='drillAdmin'){
    if(isLoggedIn){
      if (typeof window.populateTrainerInfo === 'function') {
        window.populateTrainerInfo();
        setTimeout(window.populateTrainerInfo, 150);
      }
      loadAdminDrill();
    } else { switchTab('sup'); }
  }
  if(which==='penaltiesWorker'){
    renderMyPenalties();
  }
  if(which==='penaltiesAdmin'){
    if(isLoggedIn){ renderPenaltiesAdmin(); } else { switchTab('sup'); }
  }
  if(which==='dashboard'){
    loadDashboard();
  }
  if(which==='inspections'){
    if(isLoggedIn && (currentUserRole === 'hse_admin' || currentUserRole === 'super_admin' || VIEWER_ROLES_UI.includes(currentUserRole))){
      renderInspections();
    } else { switchTab('sup'); }
  }
  if(which==='auditlog'){
    if(isLoggedIn && (currentUserRole === 'hse_admin' || currentUserRole === 'super_admin' || VIEWER_ROLES_UI.includes(currentUserRole))){
      renderAuditLog();
    } else { switchTab('sup'); }
  }
  if(which==='reports'){
    if(isLoggedIn && (currentUserRole === 'hse_admin' || currentUserRole === 'super_admin' || VIEWER_ROLES_UI.includes(currentUserRole))){
      renderReportsTab();
    } else { switchTab('sup'); }
  }
  if(which==='executive'){
    if(isLoggedIn && (VIEWER_ROLES_UI.includes(currentUserRole) || currentUserRole === 'super_admin' || currentUserRole === 'hse_admin')){
      renderExecutiveView();
    } else { switchTab('sup'); }
  }
}
