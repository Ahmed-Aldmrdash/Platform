// Safety assistant chat widget, server-driven actions (open tab, prefill form) and voice input.

let _cbOpen = false;
let _cbOwner = '';
let _cbBusy = false;
let _cbTopic = null;
let _cbPending = null;

// The conversation belongs to the session owner and is cleared whenever this key changes.
function chatbotOwnerKey() {
  if (sessionRole === 'worker' && typeof currentEmployee !== 'undefined' && currentEmployee) return 'w:' + currentEmployee.empCode;
  if ((sessionRole === 'supervisor' || sessionRole === 'ceo') && getToken()) return 'a:' + (currentUsername || currentUserName || '');
  return '';
}

function chatbotDisplayName() {
  if (sessionRole === 'worker' && typeof currentEmployee !== 'undefined' && currentEmployee) return currentEmployee.name || '';
  return currentUserName || '';
}

function resetChatbot() {
  _cbOwner = '';
  _cbBusy = false;
  _cbTopic = null;
  _cbPending = null;
  const box = document.getElementById('cbMessages');
  if (box) box.innerHTML = '';
  const input = document.getElementById('cbInput');
  if (input) input.value = '';
  closeChatbot();
}

function closeChatbot() {
  _cbOpen = false;
  const panel = document.getElementById('cbPanel');
  if (panel) panel.style.display = 'none';
  const fab = document.getElementById('cbFab');
  if (fab) fab.classList.remove('is-open');
}

function syncChatbotVisibility() {
  const fab = document.getElementById('cbFab');
  const owner = chatbotOwnerKey();
  if (fab) fab.style.display = owner ? 'flex' : 'none';
  if (!owner || (_cbOwner && _cbOwner !== owner)) resetChatbot();
}

function toggleChatbot() {
  const owner = chatbotOwnerKey();
  if (!owner) { resetChatbot(); return; }
  if (_cbOwner && _cbOwner !== owner) resetChatbot();
  _cbOpen = !_cbOpen;
  const panel = document.getElementById('cbPanel');
  if (!panel) return;
  panel.style.display = _cbOpen ? 'flex' : 'none';
  const fab = document.getElementById('cbFab');
  if (fab) fab.classList.toggle('is-open', _cbOpen);
  if (_cbOpen && !_cbOwner) {
    _cbOwner = owner;
    chatbotWelcome();
  }
  if (_cbOpen) setTimeout(() => { const i = document.getElementById('cbInput'); if (i) i.focus(); }, 80);
}

function clearChatbot() {
  const box = document.getElementById('cbMessages');
  if (box) box.innerHTML = '';
  chatbotWelcome();
}

function chatbotWelcome() {
  const first = String(chatbotDisplayName()).replace(/^\s*(م|ا|أ|د)\s*\/\s*/, '').trim().split(/\s+/)[0] || '';
  const isAdmin = sessionRole === 'supervisor' || sessionRole === 'ceo';
  appendChatbotMessage('bot',
    T('أهلاً') + (first ? ' ' + T('يا') + ' ' + first : '') + ' 👋\n' +
    T('أنا مساعد السلامة الذكي — بجاوبك من تعليمات السلامة، فرق الطوارئ، كروت SDS للمواد الكيميائية، الهيكل الإداري، وبياناتك انت (محاضراتك، التارجت، بلاغاتك، تصاريحك).') + '\n' +
    T('اكتب سؤالك بالعامية عادي، أو اختار من دول:'),
    null,
    isAdmin
      ? [T('انت مين؟'), T('كام بلاغ مفتوح؟'), T('مين مديرين الأقسام؟'), T('SDS الأسيتون')]
      : [T('انت مين؟'), T('محاضراتي'), T('التارجت بتاعي'), T('بلاغاتي')]);
}

function _cbTime() {
  try { return new Date().toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
}

function appendChatbotMessage(role, text, sourceText, suggestions) {
  const box = document.getElementById('cbMessages');
  if (!box) return;
  box.querySelectorAll('.cb-chips').forEach(c => c.remove());
  const row = document.createElement('div');
  row.className = 'cb-row ' + (role === 'user' ? 'user' : 'bot');
  if (role !== 'user') {
    const av = document.createElement('div');
    av.className = 'cb-mini-avatar';
    av.textContent = '🦺';
    row.appendChild(av);
  }
  const meta = document.createElement('div');
  meta.className = 'cb-meta';
  const bubble = document.createElement('div');
  bubble.className = 'cb-bubble';
  bubble.textContent = text;
  if (sourceText) {
    const src = document.createElement('div');
    src.className = 'cb-source';
    src.textContent = '📄 ' + T('المصدر:') + ' ' + sourceText;
    bubble.appendChild(src);
  }
  meta.appendChild(bubble);
  const time = document.createElement('div');
  time.className = 'cb-time';
  time.textContent = _cbTime();
  meta.appendChild(time);
  row.appendChild(meta);
  box.appendChild(row);
  if (role !== 'user' && Array.isArray(suggestions) && suggestions.length) {
    const chips = document.createElement('div');
    chips.className = 'cb-chips';
    suggestions.slice(0, 4).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cb-chip';
      b.textContent = s;
      b.onclick = () => sendChatbotMessage(s);
      chips.appendChild(b);
    });
    box.appendChild(chips);
  }
  box.scrollTop = box.scrollHeight;
}

function _cbTyping(show) {
  const box = document.getElementById('cbMessages');
  if (!box) return;
  const old = document.getElementById('cbTypingRow');
  if (old) old.remove();
  if (!show) return;
  const row = document.createElement('div');
  row.id = 'cbTypingRow';
  row.className = 'cb-row bot cb-typing';
  row.innerHTML = '<div class="cb-mini-avatar">🦺</div><div class="cb-bubble"><span class="cb-dot"></span><span class="cb-dot"></span><span class="cb-dot"></span></div>';
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

async function sendChatbotMessage(preset) {
  if (_cbBusy) return;
  const owner = chatbotOwnerKey();
  if (!owner) { resetChatbot(); return; }
  const input = document.getElementById('cbInput');
  const text = String(typeof preset === 'string' ? preset : (input && input.value) || '').trim();
  if (!text) return;
  if (input) input.value = '';
  appendChatbotMessage('user', text);
  _cbBusy = true;
  const sendBtn = document.getElementById('cbSend');
  if (sendBtn) sendBtn.disabled = true;
  _cbTyping(true);
  try {
    const res = await authFetch('/api/chatbot/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, context: Object.assign({}, _cbTopic || {}, _cbPending ? { pending: _cbPending } : {}) })
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.topic) _cbTopic = data.topic;
    if (data) _cbPending = data.followup || null;
    _cbTyping(false);
    if (chatbotOwnerKey() !== owner) { resetChatbot(); return; }
    if (!res.ok) {
      appendChatbotMessage('bot', data.error || data.reply || T('حصل خطأ، حاول تاني.'));
    } else {
      appendChatbotMessage('bot', data.reply, data.source, data.suggestions);
      if (data.action) applyChatbotAction(data.action);
    }
  } catch (err) {
    _cbTyping(false);
    appendChatbotMessage('bot', T('تعذّر الاتصال بالسيرفر، تأكد من اتصالك وحاول تاني.'));
  } finally {
    _cbBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }
}

// The server decides which actions are allowed; this side only executes them. Maps server field keys to form element ids per tab.
const CHATBOT_FILL_MAP = {
  worker: { desc: 'f_desc', workers: 'f_workers', location: 'workLocationSelect', equip: 'f_equip' },
  hazardWorker: {
    desc: 'hz_desc', dept: 'hz_dept', area: 'hz_area', injury: 'hz_injury',
    solution: 'hz_solution', likelihood: 'hz_likelihood', severity: 'hz_severity',
  },
};

function _cbFillField(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return false;
  if (el.tagName === 'SELECT') {
    const ok = Array.from(el.options).some(o => o.value === value);
    if (!ok) return false;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.classList.add('cb-autofilled');
  setTimeout(() => el.classList.remove('cb-autofilled'), 2600);
  return true;
}

function applyChatbotAction(action) {
  if (!action || !action.tab) return;
  if (action.type === 'fill') { _cbApplyFill(action, false); return; }
  if (action.type !== 'navigate') return;
  setTimeout(() => {
    closeChatbot();
    switchTab(action.tab);
    if (action.permitType && typeof selectType === 'function') {
      try { selectType(action.permitType); } catch (e) { }
    }
    _cbApplyFill(action, true);
  }, 900);
}

function _cbApplyFill(action, withToast) {
  {
    if (!action.fill) return;
    const map = CHATBOT_FILL_MAP[action.tab];
    if (!map) return;

    let tries = 0;
    const tryFill = () => {
      tries++;
      const firstKey = Object.keys(action.fill).find(k => map[k]);
      if (!firstKey) return;
      if (!document.getElementById(map[firstKey]) && tries < 8) {
        setTimeout(tryFill, 150);
        return;
      }
      let filledAny = false;
      let firstEl = null;
      Object.entries(action.fill).forEach(([key, val]) => {
        if (!map[key]) return;
        if (_cbFillField(map[key], val)) {
          filledAny = true;
          if (!firstEl) firstEl = document.getElementById(map[key]);
        }
      });
      if ((action.fill.likelihood || action.fill.severity) && typeof calculateHazardRisk === 'function') {
        try { calculateHazardRisk(); } catch (e) { }
      }
      if (filledAny && firstEl && withToast) {
        try { firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
        showToast(T('✅ ملّيت اللي فهمته من كلامك — راجعه وكمّل الباقي'), 'success');
      }
    };
    tryFill();
  }
}

let _cbVoice = { rec: null, recording: false, stopping: false, finalText: '', maxTimer: null };
const CB_VOICE_MAX_MS = 60000;

function chatbotMicBlockReason() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Browsers block the microphone on plain http (anything but localhost).
  if (!window.isSecureContext) {
    return T('المتصفح بيمنع المايك لأن المنصة مفتوحة على اتصال غير مشفّر (http). افتحها من localhost على نفس الجهاز، أو من لينك https، وهيشتغل على طول. لحد ما ده يتظبط اكتب سؤالك وهرد عليك عادي.');
  }
  if (!SR) {
    return T('المتصفح ده مش بيدعم التسجيل الصوتي — استخدم Chrome أو Edge. اكتب سؤالك عادي وهتعامل معاه بنفس الطريقة.');
  }
  return null;
}

function _cbMicUI(on) {
  const btn = document.getElementById('cbMic');
  if (btn) {
    btn.classList.toggle('is-recording', !!on);
    btn.title = on ? T('إيقاف التسجيل') : T('اسأل بصوتك');
  }
  const input = document.getElementById('cbInput');
  if (input) input.placeholder = on ? T('🔴 بسمعك دلوقتي... اتكلم') : T('اكتب سؤالك هنا...');
}

function stopChatbotMic(opts) {
  const autoSend = !opts || opts.autoSend !== false;
  _cbVoice.stopping = true;
  _cbVoice.autoSend = autoSend;
  if (_cbVoice.maxTimer) { clearTimeout(_cbVoice.maxTimer); _cbVoice.maxTimer = null; }
  if (_cbVoice.rec) { try { _cbVoice.rec.stop(); } catch (e) { } }
}

async function toggleChatbotMic() {
  if (_cbVoice.recording) { stopChatbotMic(); return; }
  const blocked = chatbotMicBlockReason();
  if (blocked) { appendChatbotMessage('bot', '🎤 ' + blocked); return; }
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    }
  } catch (err) {
    const name = (err && err.name) || '';
    appendChatbotMessage('bot', '🎤 ' + (
      name === 'NotAllowedError' || name === 'SecurityError'
        ? T('إذن المايك مرفوض. دوس على علامة القفل 🔒 جنب عنوان الموقع في المتصفح، خلي "الميكروفون" مسموح، وجرّب تاني.')
        : name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? T('مفيش ميكروفون متوصل بالجهاز ده.')
          : T('مش قادر أفتح المايك') + ' (' + (name || T('خطأ غير معروف')) + ').'));
    return;
  }
  _startChatbotMic();
}

function _startChatbotMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const input = document.getElementById('cbInput');
  let rec;
  try { rec = new SR(); } catch (e) {
    appendChatbotMessage('bot', '🎤 ' + T('مش قادر أشغّل التسجيل على المتصفح ده.'));
    return;
  }
  rec.lang = 'ar-EG';
  rec.interimResults = true;
  rec.continuous = true;
  _cbVoice.finalText = (input && input.value ? input.value.trim() + ' ' : '');
  _cbVoice.stopping = false;
  _cbVoice.autoSend = true;

  rec.onstart = () => {
    _cbVoice.recording = true;
    _cbMicUI(true);
    _cbVoice.maxTimer = setTimeout(() => stopChatbotMic({ autoSend: false }), CB_VOICE_MAX_MS);
  };

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) _cbVoice.finalText += chunk + ' ';
      else interim += chunk;
    }
    if (input) input.value = (_cbVoice.finalText + interim).trim();
  };

  rec.onerror = (e) => {
    const code = (e && e.error) || '';
    if (code === 'no-speech' || code === 'aborted') return;
    _cbVoice.stopping = true;
    appendChatbotMessage('bot', '🎤 ' + (
      code === 'not-allowed' || code === 'service-not-allowed'
        ? T('إذن المايك مرفوض من المتصفح. افتح إعدادات الموقع (علامة القفل جنب العنوان) واسمح بالميكروفون.')
        : code === 'network'
          ? T('خدمة تحويل الصوت لنص محتاجة إنترنت، والاتصال مش متاح دلوقتي.')
          : code === 'audio-capture'
            ? T('مفيش ميكروفون شغال على الجهاز ده.')
            : T('حصل خطأ في التسجيل') + ' (' + code + ').'
    ) + ' ' + T('اكتب سؤالك عادي وهجاوبك زي ما هو.'));
  };

  rec.onend = () => {
    if (_cbVoice.recording && !_cbVoice.stopping) {
      try { rec.start(); return; } catch (e) { }
    }
    _cbVoice.recording = false;
    if (_cbVoice.maxTimer) { clearTimeout(_cbVoice.maxTimer); _cbVoice.maxTimer = null; }
    _cbMicUI(false);
    const val = (input && input.value || '').trim();
    if (_cbVoice.autoSend !== false && val && !_cbBusy) {
      setTimeout(() => { if ((document.getElementById('cbInput') || {}).value) sendChatbotMessage(); }, 350);
    } else if (input) {
      input.focus();
    }
  };

  _cbVoice.rec = rec;
  try {
    rec.start();
  } catch (err) {
    _cbVoice.recording = false;
    _cbMicUI(false);
    appendChatbotMessage('bot', '🎤 ' + T('مش قادر أبدأ التسجيل، جرّب تاني بعد ثانية.'));
  }
}

function openVoiceInChatbot() {
  if (!_cbOpen) toggleChatbot();
  setTimeout(() => {
    const blocked = chatbotMicBlockReason();
    if (blocked) { appendChatbotMessage('bot', '🎤 ' + blocked); return; }
    toggleChatbotMic();
  }, 250);
}
