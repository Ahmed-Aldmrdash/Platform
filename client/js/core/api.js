// Session globals, auth token storage, authFetch, signed download/print links, toasts and polling-friendly GET helpers.

window.currentSessionType = window.currentSessionType || 'supervisor';
var currentSessionType = window.currentSessionType;
var notifEventSource = null;
var currentAdminToken = typeof getToken === 'function' ? getToken() : (sessionStorage.getItem('wp_auth_token') || '');

window.playNotificationChime = function() {
  try {
    if (typeof chimeAudio !== 'undefined' && chimeAudio) {
      chimeAudio.play().catch(() => {});
    }
  } catch (e) {}
};

window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error('Unhandled error:', msg, url, lineNo, columnNo, error);
  return false;
};

function normalizeEmpCode(code) {
  if (!code && code !== 0) return '';
  const str = String(code).trim();
  const stripped = str.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

function getRoleKey(role) {
  if (role === 'dept_admin' || role === 'area_admin' || role === 'maint_admin') return 'areaAdmin';
  if (role === 'hse_admin' || role === 'safety_admin') return 'safetyAdmin';
  if (role === 'super_admin') return 'superAdmin';
  return 'worker';
}

function saveToken(token) {
  try { sessionStorage.setItem('wp_auth_token', token); } catch(e) {}
}

function getToken() {
  try { return sessionStorage.getItem('wp_auth_token'); } catch(e) { return null; }
}

function getWorkerToken() {
  try {
    const e = JSON.parse(localStorage.getItem('ep_currentEmployee') || 'null');
    return (e && e.token) || null;
  } catch(e) { return null; }
}

function handleWorkerSessionExpired() {
  if (window._workerExpiredShown) return;
  window._workerExpiredShown = true;
  setTimeout(() => { window._workerExpiredShown = false; }, 5000);
  showToast(T('انتهت جلستك أو اتغيرت كلمة السر — ادخل من جديد'), 'error');
  if (typeof workerLogout === 'function') workerLogout();
}

function clearToken() {
  try { sessionStorage.removeItem('wp_auth_token'); } catch(e) {}
}

// Downloads and print pages get a short-lived token scoped to one path, so the session token never ends up in a URL.
async function getLinkToken(path) {
  const res = await authFetch('/api/auth/link-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: String(path || '').split('?')[0] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(data.error || 'link-token failed');
  return data.token;
}

function _withLinkToken(url, linkToken) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}dt=${encodeURIComponent(linkToken)}`;
}

async function navigateWithAuth(url) {
  const token = getToken();
  if (!token) { showToast(T('سجّل دخولك أولاً لتنزيل الملف'), 'error'); return; }
  try {
    window.location.href = _withLinkToken(url, await getLinkToken(url));
  } catch (e) {
    showToast(T('تعذّر تجهيز الملف — حاول تاني'), 'error');
  }
}

async function openPrintWithAuth(url, opts = {}) {
  const token = getToken();
  if (!token) { showToast(T('سجّل دخولك أولاً'), 'error'); return; }
  // Open the tab before any await, otherwise popup blockers close it.
  const win = window.open('', '_blank');
  if (win) {
    try { win.document.write('<p dir="rtl" style="font-family:Tahoma,Arial;text-align:center;margin-top:60px;color:#374151">جاري تجهيز المستند للطباعة…</p>'); } catch (e) { }
  }
  try {
    if (typeof opts.before === 'function') await opts.before();
    const full = _withLinkToken(url, await getLinkToken(url));
    if (win) win.location.href = full; else window.location.href = full;
  } catch (e) {
    if (win) { try { win.close(); } catch (e2) { } }
    showToast(T('تعذّر فتح صفحة الطباعة — حاول تاني'), 'error');
  }
}

// Read-only accounts: writes are refused here as well, except for these endpoints.
const VIEWER_WRITE_OK = /\/api\/(chatbot\/message|auth\/(profile|change-password|set-personal-password|refresh|link-token)|notifications\/|dashboard\/export-|reports\/email)/;
async function authFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (document.body.dataset.readonly === '1' && method !== 'GET' && !VIEWER_WRITE_OK.test(url)) {
    showToast(T('الحساب ده للمتابعة والعرض فقط — مش مسموح بأي إضافة أو تعديل أو حذف'), 'error');
    return new Response(JSON.stringify({ error: 'الحساب ده للمتابعة والعرض فقط', readOnly: true }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  const adminToken = getToken();
  const token = adminToken || getWorkerToken();
  if (token) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
  }
  try {
    const res = await fetch(url, options);
    if (res.status === 401 && token) {
      const data = await res.clone().json().catch(() => ({}));
      if (data.expired) {
        if (adminToken) {
          if (!window._adminExpiredShown) {
            window._adminExpiredShown = true;
            setTimeout(() => { window._adminExpiredShown = false; }, 5000);
            showToast(T('انتهت صلاحية جلستك. يرجى تسجيل الدخول مجدداً.'), 'error');
          }
          logout();
        } else {
          handleWorkerSessionExpired();
        }
      }
    }
    return res;
  } catch(e) {
    console.error('authFetch error', e);
    throw e;
  }
}

function safeEl(id) {
  try { return document.getElementById(id) || null; } catch(e) { return null; }
}

let _toastTimer = null;
function showToast(msg, type = 'error') {
  try {
    let toast = document.getElementById('_appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '_appToast';
      toast.style.cssText = [
        'position:fixed;bottom:24px;inset-inline-start:50%;transform:translateX(-50%)',
        'max-width:min(92vw,420px);z-index:99999;padding:12px 20px;border-radius:12px',
        'font-family:Cairo,sans-serif;font-size:14px;font-weight:700',
        'box-shadow:0 8px 24px rgba(0,0,0,0.3);transition:opacity .3s;text-align:center',
        'pointer-events:none;'
      ].join(';');
      document.body.appendChild(toast);
    }
    const colors = {
      error:   { bg:'#C81421', color:'#fff' },
      success: { bg:'#1F7A3D', color:'#fff' },
      info:    { bg:'#1A1A1A', color:'#fff' }
    };
    const c = colors[type] || colors.info;
    toast.style.background = c.bg;
    toast.style.color = c.color;
    toast.textContent = T(msg);
    toast.style.opacity = '1';
    toast.style.display = 'block';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { toast.style.display = 'none'; }, 350);
    }, 4000);
  } catch(e) {
    console.warn('[Toast]', msg);
  }
}

// Polling helper: resend the last ETag so unchanged data comes back as an empty 304.
const _pollCache = new Map();
async function fetchJsonIfChanged(url) {
  const cached = _pollCache.get(url);
  const res = await authFetch(url, {
    cache: 'no-store',
    headers: cached && cached.etag ? { 'If-None-Match': cached.etag } : {},
  });
  if (res.status === 304 && cached) return { ok: true, changed: false, data: cached.data };
  if (!res.ok) return { ok: false, changed: false, data: null, status: res.status };
  const data = await res.json();
  const etag = res.headers.get('ETag');
  if (etag) _pollCache.set(url, { etag, data }); else _pollCache.delete(url);
  return { ok: true, changed: true, data };
}

// Named background pollers. A tick is skipped while the page is hidden or the previous tick is still running;
// a poller that missed ticks runs once as soon as the page is visible again.
const _polls = new Map();
function poll(name, fn, ms) {
  stopPoll(name);
  const p = { busy: false, missed: false, timer: null };
  p.tick = async () => {
    if (document.hidden) { p.missed = true; return; }
    // Until the first-login password is set the server rejects everything else.
    if (p.busy || window._passwordSetupPending) return;
    p.busy = true;
    try { await fn(); } catch (e) { } finally { p.busy = false; }
  };
  p.timer = setInterval(p.tick, ms);
  _polls.set(name, p);
}
function stopPoll(name) {
  const p = _polls.get(name);
  if (!p) return;
  clearInterval(p.timer);
  _polls.delete(name);
}
function isPolling(name) {
  return _polls.has(name);
}
function stopAllPolls() {
  [..._polls.keys()].forEach(stopPoll);
}

// On logout: forget cached responses so the next account starts from fresh data and loading states.
function clearSessionData() {
  _pollCache.clear();
  window._passwordSetupPending = false;
  window._hzRendered = null;
  window._empPanelRendered = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  _polls.forEach(p => {
    if (p.missed) { p.missed = false; p.tick(); }
  });
});

// Third-party libraries are loaded on first use (pinned by SRI hash); the promise is cached per URL.
const _scriptLoads = new Map();
function ensureScript(src, integrity) {
  if (!_scriptLoads.has(src)) {
    _scriptLoads.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      s.onload = () => resolve();
      s.onerror = () => { _scriptLoads.delete(src); s.remove(); reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return _scriptLoads.get(src);
}
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const XLSX_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
const CHARTJS_SRC = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
const CHARTJS_SRI = 'sha384-JUh163oCRItcbPme8pYnROHQMC6fNKTBWtRG3I3I0erJkzNgL7uxKlNwcrcFKeqF';
async function ensureXlsx() {
  if (typeof XLSX !== 'undefined') return true;
  try {
    await ensureScript(XLSX_SRC, XLSX_SRI);
    return typeof XLSX !== 'undefined';
  } catch (e) {
    showToast(T('تعذّر تحميل مكتبة التصدير، حاول تحديث الصفحة'), 'error');
    return false;
  }
}
function ensureChartJs() {
  return typeof Chart !== 'undefined' ? Promise.resolve() : ensureScript(CHARTJS_SRC, CHARTJS_SRI);
}

async function apiGet(key){
  try{
    const cleanKey = key.startsWith('/') ? key.substring(1) : key;
    const r = await fetchJsonIfChanged(`/api/storage/${cleanKey}`);
    return r.ok ? r.data : null;
  }catch(e){
    if (!navigator.onLine) showToast(T('لا يوجد اتصال بالإنترنت — تحقق من اتصالك وحاول مجدداً'), 'error');
    console.error('apiGet error', e);
    return null;
  }
}

// Admin tokens are short-lived, so renew them while the app is open; the server still ends a session after 12 hours.
setInterval(async () => {
  if (!getToken()) return;
  try {
    const res = await authFetch('/api/auth/refresh', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.token) saveToken(data.token);
    }
  } catch (e) { }
}, 20 * 60 * 1000);
