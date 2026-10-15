// Notification drawer, polling, web push subscription, deep-link navigation and the global sync button.

let currentNotifications = [];
let currentNotifFilter = 'all';
let isNotifDrawerOpen = false;

function toggleNotifDrawer() {
  const drawer = document.getElementById('notifDropdown');
  isNotifDrawerOpen = !isNotifDrawerOpen;
  if (isNotifDrawerOpen) {
    drawer.classList.add('show');
    drawer.style.display = 'flex';
  } else {
    drawer.classList.remove('show');
    setTimeout(() => { if (!isNotifDrawerOpen) drawer.style.display = 'none'; }, 300);
  }
}

async function startNotificationPolling() {
  stopNotificationPolling();

}

function stopNotificationPolling() {
  if (typeof notifEventSource !== 'undefined' && notifEventSource) {
    try { notifEventSource.close(); } catch(e) {}
    notifEventSource = null;
  }
  if (window._notifPollTimer) {
    clearInterval(window._notifPollTimer);
    window._notifPollTimer = null;
  }
}

async function subscribeToPushNotifications() {
  if (typeof VIEWER_ROLES_UI !== 'undefined' && VIEWER_ROLES_UI.includes(currentUserRole)) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const swReg = await navigator.serviceWorker.register('/sw.js');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const vapidRes = await fetch('/api/vapid-public-key');
    const vapidData = await vapidRes.json();
    if (!vapidData.publicKey) return;
    const applicationServerKey = urlB64ToUint8Array(vapidData.publicKey);

    // Reuse the browser's subscription; only one made with a different server key is replaced.
    let subscription = await swReg.pushManager.getSubscription();
    if (subscription && !_pushKeyMatches(subscription, applicationServerKey)) {
      try { await subscription.unsubscribe(); } catch (e) { }
      subscription = null;
    }
    if (!subscription) {
      subscription = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
      });
    }

    // The server links a subscription to the signed-in account, so it is sent again when the endpoint or the
    // account changes, and once a week in case the server dropped it.
    const owner = currentEmployee && sessionRole === 'worker' ? `w:${currentEmployee.empCode}` : `a:${currentUsername}`;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PUSH_SUB_KEY) || 'null'); } catch (e) { }
    const fresh = saved && saved.endpoint === subscription.endpoint && saved.owner === owner &&
      Date.now() - (Number(saved.at) || 0) < PUSH_RESEND_MS;
    if (fresh) return;

    const res = await authFetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
    if (res.ok) {
      try { localStorage.setItem(PUSH_SUB_KEY, JSON.stringify({ endpoint: subscription.endpoint, owner, at: Date.now() })); } catch (e) { }
    }
  } catch (error) {
    console.error('Push Subscription Failed:', error);
  }
}

const PUSH_SUB_KEY = 'ep_pushSubscription';
const PUSH_RESEND_MS = 7 * 24 * 60 * 60 * 1000;

function _pushKeyMatches(subscription, key) {
  const current = subscription.options && subscription.options.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

window.subscribeUserToPush = async function subscribeUserToPush() {
  try {
    await subscribeToPushNotifications();
  } catch (err) {
    console.warn('[Push] subscribeUserToPush bypassed:', err.message);
  }
};

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function fetchNotifications() {
  if (!getToken() && !getWorkerToken()) return;
  try {
    const res = await authFetch('/api/notifications');
    if (res.ok) {
      const data = await res.json();
      currentNotifications = data.notifications || [];
      renderNotifications();
    }
  } catch(e) {}
}

function setNotifFilter(type) {
  currentNotifFilter = type;
  document.querySelectorAll('.notif-pill').forEach(btn => btn.classList.remove('active'));
  const targetBtn = Array.from(document.querySelectorAll('.notif-pill')).find(b => b.getAttribute('onclick').includes(`'${type}'`));
  if (targetBtn) targetBtn.classList.add('active');
  renderNotifications();
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + T(" سنة");
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + T(" شهر");
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + T(" يوم");
  interval = seconds / 3600;
  if (interval >= 1) return T("منذ ") + Math.floor(interval) + T(" ساعة");
  interval = seconds / 60;
  if (interval >= 1) return T("منذ ") + Math.floor(interval) + T(" دقيقة");
  return T("الآن");
}

function getIdentifier() {
  const token = getToken();
  if (token && sessionRole !== 'worker' && sessionRole !== 'none') return currentUserRole || sessionRole;
  if (currentEmployee && currentEmployee.empCode) return currentEmployee.empCode;
  return 'unknown';
}

function renderNotifications() {
  const listEl = document.getElementById('notifList');
  const badgeEl = document.getElementById('notifBadge');
  const container = document.getElementById('notifContainer');
  if (!listEl || !badgeEl || !container) return;

  container.style.display = 'inline-flex';
  const identifier = getIdentifier();
  let unreadCount = 0;

  const filteredNotifications = currentNotifications.filter(n => {
    const isUnread = !n.readBy.includes(identifier);
    if (isUnread) unreadCount++;
    if (currentNotifFilter === 'all') return true;
    if (currentNotifFilter === 'unread') return isUnread;
    return n.type === currentNotifFilter;
  });

  const html = filteredNotifications.map(n => {
    const isUnread = !n.readBy.includes(identifier);
    let iconEmoji = '🔔';
    if (n.type === 'hazard') iconEmoji = '⚠️';
    if (n.type === 'permit') iconEmoji = '📝';
    if (n.type === 'training') iconEmoji = '🎓';

    return `
      <li class="notif-item ${isUnread ? 'unread' : ''}" onclick="handleNotificationClick(${jsArg(n.id)}, ${jsArg(n.link)}, ${jsArg(n.targetId || '')}, ${jsArg(n.type || '')})">
        <div class="notif-icon-wrap">${iconEmoji}</div>
        <div class="notif-content">
          <div class="notif-title-row">
            <h4 class="notif-title"><span class="pulse-dot" style="display:${isUnread ? 'inline-block' : 'none'};"></span>${escapeHtml(T(n.title))}</h4>
            <span class="notif-time">${timeAgo(n.createdAt)}</span>
          </div>
          <p class="notif-message">${escapeHtml(T(n.message))}</p>
        </div>
      </li>
    `;
  }).join('');

  listEl.innerHTML = filteredNotifications.length === 0 ? T('<li style="padding:16px; text-align:center; color:var(--text-muted);">لا توجد إشعارات</li>') : html;

  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount;
    badgeEl.style.display = 'inline-block';
  } else {
    badgeEl.style.display = 'none';
  }
}

function navigateToNotificationTarget(link, targetId, type) {
  if (!link) return;
  const tabMap = {
    'tabPermits': 'sup',
    'tabMyHistory': 'myhistory',
    'tabSupHazard': 'supHazard',
    'tabHazardWorker': 'hazardWorker',
    'tabMyHazards': 'myhazards',
    'tabTrainingWorker': 'trainingWorker',
    'tabTrainingAdmin': 'trainingAdmin'
  };
  const mappedLink = tabMap[link] || link;
  if (targetId && type === 'permit') {
    window._pmEnsureVisibleId = targetId;
    ensurePermitLoaded(targetId);
  }
  switchTab(mappedLink);
  if (targetId) {
    setTimeout(() => {
      if (type === 'permit') {
        showPermitDetails(targetId);
      } else if (type === 'hazard') {
        if (typeof showHazardModal === 'function') showHazardModal(targetId);
      }
    }, 500);
  }
}

function applyPendingNotificationNavFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const openTab = params.get('openTab');
    if (!openTab) return;
    const targetId = params.get('targetId') || '';
    const ntype = params.get('ntype') || '';
    const nid = params.get('nid') || '';
    if (nid) {
      authFetch(`/api/notifications/read/${encodeURIComponent(nid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).catch(() => {});
    }
    navigateToNotificationTarget(openTab, targetId, ntype);
    history.replaceState(null, '', window.location.pathname);
  } catch (e) { }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'notification-click') return;
    let tabName = '', targetId = msg.targetId || '', ntype = msg.ntype || '', nid = '';
    try {
      const url = new URL(msg.url || '/', window.location.origin);
      tabName = url.searchParams.get('openTab') || '';
      nid = url.searchParams.get('nid') || '';
    } catch (e) {}
    if (nid) {
      authFetch(`/api/notifications/read/${encodeURIComponent(nid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).catch(() => {});
    }
    if (tabName) navigateToNotificationTarget(tabName, targetId, ntype);
  });
}

async function handleNotificationClick(id, link, targetId, type) {
  const identifier = getIdentifier();
  await authFetch(`/api/notifications/read/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empCode: identifier })
  });

  const notif = currentNotifications.find(n => n.id === id);
  if (notif && !notif.readBy.includes(identifier)) {
    notif.readBy.push(identifier);
    renderNotifications();
  }

  if (isNotifDrawerOpen) toggleNotifDrawer();

  if (link) {
    navigateToNotificationTarget(link, targetId, type);
  }
}

async function markAllNotificationsAsRead() {
  const identifier = getIdentifier();
  await authFetch('/api/notifications/read-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empCode: identifier })
  });

  currentNotifications.forEach(n => {
    if (!n.readBy.includes(identifier)) n.readBy.push(identifier);
  });
  renderNotifications();
}

function showAppToast(title, message, onClick) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.innerHTML = `
    <div style="font-size: 24px;">🔔</div>
    <div style="flex:1;">
      <div style="font-weight:700; margin-bottom:4px; font-size:14px;">${escapeHtml(T(title))}</div>
      <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(T(message))}</div>
    </div>
  `;
  if (onClick) {
    toast.style.cursor = 'pointer';
    toast.onclick = () => { onClick(); toast.classList.remove('show'); };
  }
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
async function globalSyncData() {
  const btn = document.getElementById('btnGlobalSync');
  if (btn) btn.classList.add('spin');

  try {
    if (typeof fetchNotifications === 'function') {
      await fetchNotifications().catch(e => console.warn("Notifs sync bypassed:", e));
    }

    const tab = window.currentActiveTab;

    if (tab === 'sup') {
      if (typeof loadPermitsPage === 'function') await loadPermitsPage({ silent: true });
    } else if (tab === 'supHazard') {
      if (typeof loadAdminHazards === 'function') await loadAdminHazards();
    } else if (tab === 'users') {
      if (typeof loadUsers === 'function') await loadUsers();
    } else if (tab === 'employees') {
      if (typeof loadEmployees === 'function') await loadEmployees();
    } else if (tab === 'trainingAdmin') {
      if (typeof loadAdminTraining === 'function') await loadAdminTraining(false);
    } else if (tab === 'myhistory') {
      if (typeof loadMyHistory === 'function') await loadMyHistory();
    } else if (tab === 'myhazards') {
      if (typeof loadMyHazards === 'function') await loadMyHazards();
    } else if (tab === 'trainingWorker') {
      if (typeof loadWorkerTraining === 'function') await loadWorkerTraining();
    }

    showToast(T('تم تحديث البيانات بنجاح ✅'), 'success');
  } catch (err) {
    console.error("Critical Sync Failure:", err);
    showToast(T('خطأ أثناء التحديث'), 'error');
  } finally {
    if (btn) btn.classList.remove('spin');
  }
}
