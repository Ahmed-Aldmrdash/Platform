// "Send by e-mail" dialog: the permits and hazards Excel registers, and forwarding one hazard report.

const EMAIL_SEND_KINDS = {
  permits: {
    title: '📧 إرسال سجل تصاريح العمل بالإيميل',
    hint: 'هيوصل شيت Excel فيه كل التصاريح اللي تقدر تشوفها، بنفس ترتيب الصفحة.',
    url: () => '/api/permits/email-excel',
  },
  hazards: {
    title: '📧 إرسال سجل بلاغات الخطورة بالإيميل',
    hint: 'هيوصل شيت Excel فيه كل البلاغات اللي تقدر تشوفها، بنفس ترتيب الصفحة.',
    url: () => '/api/hazards/email-excel',
  },
  forwardPermit: {
    title: '📌 توجيه التصريح بالإيميل',
    hint: 'هيوصل إيميل فيه مستند التصريح وحالته، باسمك.',
    url: (id) => `/api/permits/${encodeURIComponent(id)}/forward`,
    note: true,
  },
  forward: {
    title: '📌 توجيه البلاغ بالإيميل',
    hint: 'هيوصل إيميل فيه تفاصيل البلاغ وصورته ومن إمتى مفتوح، باسمك.',
    url: (id) => `/api/hazards/${encodeURIComponent(id)}/forward`,
    note: true,
  },
};
const LAST_SEND_EMAIL_KEY = 'ep_lastSendEmail';
let _emailSend = null;

function openEmailSendModal(kind, recordId) {
  const cfg = EMAIL_SEND_KINDS[kind];
  if (!cfg) return;
  _emailSend = { kind, recordId: recordId || '' };
  document.getElementById('es_title').textContent = T(cfg.title) + (recordId ? ` — ${recordId}` : '');
  document.getElementById('es_hint').textContent = T(cfg.hint);
  document.getElementById('es_noteField').style.display = cfg.note ? '' : 'none';
  document.getElementById('es_note').value = '';
  const to = document.getElementById('es_to');
  try { to.value = localStorage.getItem(LAST_SEND_EMAIL_KEY) || ''; } catch (e) { to.value = ''; }
  const msg = document.getElementById('es_msg');
  msg.className = 'um-msg';
  msg.textContent = '';
  document.getElementById('es_send').disabled = false;
  document.getElementById('emailSendModal').style.display = 'flex';
  setTimeout(() => to.focus(), 50);
}

function closeEmailSendModal() {
  document.getElementById('emailSendModal').style.display = 'none';
  _emailSend = null;
}

async function submitEmailSend() {
  if (!_emailSend) return;
  const { kind, recordId } = _emailSend;
  const to = document.getElementById('es_to').value.trim();
  const msg = document.getElementById('es_msg');
  const btn = document.getElementById('es_send');
  const show = (text, cls) => { msg.textContent = text; msg.className = `um-msg show ${cls}`; };
  if (!to) { show(T('اكتب الإيميل الأول'), 'error'); return; }

  const body = { to };
  if (EMAIL_SEND_KINDS[kind].note) body.note = document.getElementById('es_note').value.trim();
  btn.disabled = true;
  show(EMAIL_SEND_KINDS[kind].note ? T('جارِ الإرسال…') : T('جارِ تجهيز الشيت وإرساله…'), 'success');
  try {
    const res = await authFetch(EMAIL_SEND_KINDS[kind].url(recordId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      show(data.error || T('فشل الإرسال'), 'error');
      btn.disabled = false;
      return;
    }
    try { localStorage.setItem(LAST_SEND_EMAIL_KEY, to); } catch (e) { }
    closeEmailSendModal();
    showToast(`${T('اتبعت إلى')} ${(data.sentTo || []).join(', ')}`, 'success');
    if (kind === 'forward') renderSupHazard(true, true);
    if (kind === 'forwardPermit') loadPermitsPage({ silent: true });
  } catch (e) {
    show(T('خطأ في الاتصال'), 'error');
    btn.disabled = false;
  }
}
