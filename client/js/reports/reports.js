// Safety report: period filters, preview, PDF/print, email and the scheduled send settings.

const REPORT_PERIODS = [
  ['ytd', 'من أول السنة لحد النهارده'],
  ['year', 'سنة كاملة'],
  ['quarter', 'ربع سنة (3 شهور)'],
  ['month', 'شهر'],
  ['custom', 'من تاريخ لتاريخ'],
];
const REPORT_QUARTERS = [
  'الربع الأول (يناير – مارس)',
  'الربع الثاني (أبريل – يونيو)',
  'الربع الثالث (يوليو – سبتمبر)',
  'الربع الرابع (أكتوبر – ديسمبر)',
];
const REPORT_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const REPORT_MAIL_KEY = 'hse.reportMailTo';
function reportsDefaultPeriod() {
  const d = new Date();
  return { period: 'ytd', year: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1, m: d.getMonth() + 1, from: '', to: '' };
}
const reportsState = { dept: '', emp: '', ...reportsDefaultPeriod(), years: null, loadSeq: 0 };

let _reportsPanelNode = null;
const REPORTS_INTRO = 'تقرير مختصر: أهم أرقام السلامة والتارجت + الجزاءات ومين خدها — جاهز للطباعة بشعار الشركة، أو حفظه PDF، أو إرساله بالإيميل. اختار النطاق والفترة واضغط "عرض التقرير".';

function renderReportsTab() {
  const root = document.getElementById('reportsContent');
  if (!root) return;
  root.innerHTML = `
    <div class="sup-header-row" style="margin-bottom:8px">
      <h3>${T('📑 تقرير السلامة الشامل')}</h3>
    </div>
    <p class="rep-intro">${T(REPORTS_INTRO)}</p>
    <div id="reportsSlotTab"></div>`;
  mountReportsPanel('reportsSlotTab');
}

function mountReportsPanel(slotId) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  const first = !_reportsPanelNode;
  if (first) _reportsPanelNode = buildReportsPanel();
  if (_reportsPanelNode.parentNode !== slot) slot.appendChild(_reportsPanelNode);
  if (first) {
    reportsLoadOptions().then(() => reportsLoadPreview());
    loadReportSchedule();
  }
}

function rebuildReportsPanel() {
  const slot = _reportsPanelNode && _reportsPanelNode.parentNode;
  _reportsPanelNode = null;
  if (slot && slot.id) mountReportsPanel(slot.id);
}

function buildReportsPanel() {
  const st = reportsState;
  let savedMail = '';
  try { savedMail = localStorage.getItem(REPORT_MAIL_KEY) || ''; } catch (e) { }

  const root = document.createElement('div');
  root.className = 'rep-panel';
  root.innerHTML = `
    <div class="adv-filter-box rep-filters">
      <div class="adv-filter-grid">
        <div class="adv-filter-field">
          <label for="repDept">${T('القسم')}</label>
          <select id="repDept"><option value="">${T('المصنع كله')}</option></select>
        </div>
        <div class="adv-filter-field">
          <label for="repEmp">${T('كود موظف (اختياري)')}</label>
          <input type="text" id="repEmp" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="${T('مثال: 5943')}" value="${escapeHtml(st.emp)}" />
        </div>
        <div class="adv-filter-field">
          <label for="repPeriod">${T('الفترة')}</label>
          <select id="repPeriod">
            ${REPORT_PERIODS.map(([k, v]) => `<option value="${k}" ${st.period === k ? 'selected' : ''}>${T(v)}</option>`).join('')}
          </select>
        </div>
        <div class="adv-filter-field" id="repYearWrap" hidden>
          <label for="repYear">${T('السنة')}</label>
          <select id="repYear">${reportsYearOptions(st.years, st.year)}</select>
        </div>
        <div class="adv-filter-field" id="repQWrap" hidden>
          <label for="repQ">${T('الربع')}</label>
          <select id="repQ">
            ${REPORT_QUARTERS.map((v, i) => `<option value="${i + 1}" ${st.q === i + 1 ? 'selected' : ''}>${T(v)}</option>`).join('')}
          </select>
        </div>
        <div class="adv-filter-field" id="repMonthWrap" hidden>
          <label for="repMonth">${T('الشهر')}</label>
          <select id="repMonth">
            ${REPORT_MONTHS.map((v, i) => `<option value="${i + 1}" ${st.m === i + 1 ? 'selected' : ''}>${T(v)}</option>`).join('')}
          </select>
        </div>
        <div class="adv-filter-field" id="repFromWrap" ${st.period === 'custom' ? '' : 'hidden'}>
          <label for="repFrom">${T('من تاريخ')}</label>
          <input type="date" id="repFrom" value="${escapeHtml(st.from)}" />
        </div>
        <div class="adv-filter-field" id="repToWrap" ${st.period === 'custom' ? '' : 'hidden'}>
          <label for="repTo">${T('إلى تاريخ')}</label>
          <input type="date" id="repTo" value="${escapeHtml(st.to)}" />
        </div>
      </div>
      <div class="rep-hint" id="repEmpHint" ${st.emp ? '' : 'hidden'}>${T('لما تكتب كود موظف، التقرير بيبقى عن الموظف ده بس (فلتر القسم مش بيتحسب).')}</div>
      <div class="adv-filter-footer">
        <button class="btn btn-primary" type="button" id="repShowBtn">${T('عرض التقرير')}</button>
        <button class="btn btn-secondary" type="button" id="repPrintBtn">${T('🖨️ طباعة')}</button>
        <button class="btn btn-secondary" type="button" id="repPdfBtn">${T('📄 حفظ PDF')}</button>
        <button class="adv-filter-clear-btn" type="button" id="repResetBtn">${T('مسح الفلاتر')}</button>
        <span class="adv-filter-count" id="repScopeNote"></span>
      </div>
    </div>

    <div class="ticket rep-mail">
      <div class="ticket-head"><div><div class="ttype">${T('✉️ إرسال التقرير بالإيميل')}</div></div></div>
      <div class="ticket-body">
        <div class="rep-mail-row">
          <input type="text" id="repMailTo" dir="ltr" inputmode="email" autocomplete="email" maxlength="600"
                 placeholder="name@company.com" value="${escapeHtml(savedMail)}" aria-label="${T('إيميل المستلم')}" />
          <button class="btn btn-primary rep-send-btn" type="button" id="repSendBtn">✉️ SEND MAIL</button>
        </div>
        <div class="rep-hint" id="repMailHint">${T('تقدر تكتب لحد 5 إيميلات بينهم فاصلة. التقرير بيتبعت بنفس الفلاتر اللي فوق، ومعاه نسخة للطباعة كمرفق.')}</div>
      </div>
    </div>

    <!-- إرسال تلقائي دوري (22 سبتمبر 2026): السيرفر بيبعت التقرير لوحده
         أول كل شهر/ربع عن الفترة اللي خلصت، ومعاه مقارنة باللي قبلها. -->
    <div class="ticket rep-mail" id="repScheduleCard" hidden>
      <div class="ticket-head"><div><div class="ttype">${T('🗓️ إرسال التقرير تلقائيًا')}</div></div></div>
      <div class="ticket-body">
        <div class="rep-hint" style="margin-bottom:10px">${T('السيرفر بيبعت التقرير لوحده أول كل فترة عن الفترة اللي خلصت، ومعاه مقارنة بالفترة اللي قبلها.')}</div>
        <div class="rep-sched-row">
          <label class="rep-sched-on">
            <input type="checkbox" id="repSchedEnabled" />
            ${T('فعّل الإرسال التلقائي')}
          </label>
          <select id="repSchedFreq" aria-label="${T('كل قد إيه')}">
            <option value="monthly">${T('كل شهر')}</option>
            <option value="quarterly">${T('كل ربع سنة')}</option>
          </select>
          <input type="time" id="repSchedTime" value="07:00" aria-label="${T('الميعاد')}" />
        </div>
        <div class="rep-mail-row" style="margin-top:10px">
          <input type="text" id="repSchedTo" dir="ltr" inputmode="email" maxlength="600"
                 placeholder="name@company.com" aria-label="${T('إيميلات الإرسال التلقائي')}" />
          <button class="btn btn-primary" type="button" id="repSchedSaveBtn">${T('💾 حفظ')}</button>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-secondary" type="button" id="repSchedSendBtn">${T('📤 ابعت نسخة دلوقتي')}</button>
        </div>
        <div class="rep-hint" id="repSchedStatus" style="margin-top:8px"></div>
      </div>
    </div>

    <div class="rep-preview" id="repPreview" aria-live="polite"></div>
  `;

  const $ = id => root.querySelector('#' + id);
  const deptSel = $('repDept');
  const empIn = $('repEmp');
  const periodSel = $('repPeriod');

  const syncEmpState = () => {
    const hasEmp = !!empIn.value.trim();
    deptSel.disabled = hasEmp;
    $('repEmpHint').hidden = !hasEmp;
  };
  const syncPeriodFields = () => {
    const p = periodSel.value;
    $('repYearWrap').hidden = !['year', 'quarter', 'month'].includes(p);
    $('repQWrap').hidden = p !== 'quarter';
    $('repMonthWrap').hidden = p !== 'month';
    $('repFromWrap').hidden = p !== 'custom';
    $('repToWrap').hidden = p !== 'custom';
  };
  periodSel.addEventListener('change', syncPeriodFields);
  syncPeriodFields();
  empIn.addEventListener('input', syncEmpState);
  empIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reportsLoadPreview(); } });
  $('repShowBtn').addEventListener('click', () => reportsLoadPreview());
  $('repPrintBtn').addEventListener('click', reportsPrint);
  $('repPdfBtn').addEventListener('click', reportsSavePdf);
  $('repSendBtn').addEventListener('click', reportsSendMail);
  $('repMailTo').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reportsSendMail(); } });
  $('repResetBtn').addEventListener('click', () => {
    Object.assign(reportsState, { dept: '', emp: '', ...reportsDefaultPeriod() });
    rebuildReportsPanel();
  });
  $('repSchedSaveBtn').addEventListener('click', saveReportSchedule);
  $('repSchedSendBtn').addEventListener('click', sendReportScheduleNow);
  syncEmpState();
  return root;
}

function _reportScheduleStatusText(s) {
  const r = s && s.lastResult;
  const next = s && s.enabled
    ? `${T('الإرسال الجاي:')} ${s.frequency === 'quarterly' ? T('أول كل ربع سنة') : T('أول كل شهر')} ${T('الساعة')} ${escapeHtml(s.time || '07:00')}`
    : T('الإرسال التلقائي مقفول.');
  if (!r) return next;
  const when = new Date(r.at).toLocaleString('ar-EG');
  return `${next}<br>${r.ok
    ? `✅ ${T('آخر إرسال:')} ${escapeHtml(r.label || r.key || '')} · ${when}`
    : `❌ ${T('آخر إرسال فشل:')} ${escapeHtml(r.error || '')} · ${when}`}`;
}

async function loadReportSchedule() {
  const card = document.getElementById('repScheduleCard');
  if (!card) return;
  if (!['super_admin', 'hse_admin'].includes(currentUserRole)) { card.hidden = true; return; }
  try {
    const res = await authFetch('/api/reports/schedule');
    if (!res.ok) return;
    const s = await res.json();
    card.hidden = false;
    document.getElementById('repSchedEnabled').checked = !!s.enabled;
    document.getElementById('repSchedFreq').value = s.frequency || 'monthly';
    document.getElementById('repSchedTime').value = s.time || '07:00';
    document.getElementById('repSchedTo').value = (s.recipients || []).join(', ');
    document.getElementById('repSchedStatus').innerHTML = _reportScheduleStatusText(s);
  } catch (e) { }
}

async function saveReportSchedule() {
  const btn = document.getElementById('repSchedSaveBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await authFetch('/api/reports/schedule', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled:    document.getElementById('repSchedEnabled').checked,
        frequency:  document.getElementById('repSchedFreq').value,
        time:       document.getElementById('repSchedTime').value || '07:00',
        recipients: document.getElementById('repSchedTo').value,
        dept:       reportsState.dept || '',
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(d.error || T('فشل الحفظ'), 'error'); }
    else {
      showToast(T('تم حفظ الإعدادات ✓'), 'success');
      document.getElementById('repSchedStatus').innerHTML = _reportScheduleStatusText(d);
    }
  } catch (e) { showToast(T('خطأ في الاتصال'), 'error'); }
  if (btn) btn.disabled = false;
}

async function sendReportScheduleNow() {
  const btn = document.getElementById('repSchedSendBtn');
  if (btn) btn.disabled = true;
  showToast(T('جارِ تجهيز التقرير الدوري وإرساله…'), 'info');
  try {
    const res = await authFetch('/api/reports/schedule/send-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json().catch(() => ({}));
    if (res.ok) showToast(`${T('✅ اتبعت')} (${escapeHtml(d.label || '')}) ${T('إلى:')} ${(d.sentTo || []).join('، ')}`, 'success');
    else showToast(d.error || T('فشل الإرسال'), 'error');
  } catch (e) { showToast(T('خطأ في الاتصال'), 'error'); }
  if (btn) btn.disabled = false;
  loadReportSchedule();
}

async function reportsLoadOptions() {
  const $ = id => document.getElementById(id);
  const st = reportsState;
  const deptSel = $('repDept');
  if (!deptSel) return;
  try {
    const res = await authFetch('/api/reports/options');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'options');
    if (!document.body.contains(deptSel)) return;
    deptSel.insertAdjacentHTML('beforeend', (data.departments || []).map(d =>
      `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)} (${Number(d.count) || 0})</option>`).join(''));
    deptSel.value = st.dept;
    if (deptSel.value !== st.dept) { st.dept = ''; deptSel.value = ''; }
    if (Array.isArray(data.years) && data.years.length) {
      st.years = data.years;
      $('repYear').innerHTML = reportsYearOptions(st.years, st.year);
    }
    if (!data.mailConfigured) {
      const hint = $('repMailHint');
      hint.classList.add('warn');
      hint.textContent = currentUserRole === 'super_admin'
        ? T('⚠️ إيميل الإرسال (SMTP) مش متظبط لسه — اظبطه من تابة "سجل التدقيق" ← "بيانات إيميل الإرسال (SMTP)"، وبعدها زرار الإرسال هيشتغل.')
        : T('⚠️ إيميل الإرسال (SMTP) مش متظبط لسه على السيرفر — اطلب من السوبر أدمن يظبطه، وبعدها زرار الإرسال هيشتغل.');
    }
  } catch (e) {
    showToast(T('تعذّر تحميل قايمة الأقسام — تقدر تطلع تقرير المصنع كله أو بكود موظف'), 'error');
  }
}

function reportsYearOptions(years, selected) {
  const cur = new Date().getFullYear();
  const list = Array.isArray(years) && years.length ? years : [cur, cur - 1];
  if (!list.includes(Number(selected))) list.unshift(Number(selected) || cur);
  return list.map(y => `<option value="${Number(y)}" ${Number(y) === Number(selected) ? 'selected' : ''}>${Number(y)}</option>`).join('');
}

function reportsReadFilters() {
  const get = id => document.getElementById(id);
  const st = reportsState;
  if (!get('repPeriod')) return null;
  st.emp = get('repEmp').value.trim();
  st.dept = st.emp ? '' : get('repDept').value;
  st.period = get('repPeriod').value;
  st.year = parseInt(get('repYear').value, 10) || st.year;
  st.q = parseInt(get('repQ').value, 10) || st.q;
  st.m = parseInt(get('repMonth').value, 10) || st.m;
  st.from = get('repFrom').value;
  st.to = get('repTo').value;
  if (st.emp && !/^[A-Za-z0-9٠-٩۰-۹_-]{1,20}$/.test(st.emp)) {
    showToast(T('الكود الوظيفي لازم يكون أرقام/حروف بس'), 'error');
    return null;
  }
  if (st.period === 'custom') {
    if (!st.from || !st.to) { showToast(T('اختار تاريخ البداية وتاريخ النهاية'), 'error'); return null; }
    if (st.from > st.to) { showToast(T('تاريخ البداية لازم يكون قبل تاريخ النهاية'), 'error'); return null; }
  }
  const q = {};
  if (st.emp) q.emp = st.emp; else if (st.dept) q.dept = st.dept;
  q.period = st.period;
  if (['year', 'quarter', 'month'].includes(st.period)) q.year = String(st.year);
  if (st.period === 'quarter') q.q = String(st.q);
  if (st.period === 'month') q.m = String(st.m);
  if (st.period === 'custom') { q.from = st.from; q.to = st.to; }
  return q;
}

function reportsScopeLabel(q) {
  const who = q.emp ? `${T('الموظف كود')} ${q.emp}` : (q.dept || T('المصنع كله'));
  let when;
  if (q.period === 'custom') when = `${q.from} → ${q.to}`;
  else if (q.period === 'year') when = `${T('سنة')} ${q.year}`;
  else if (q.period === 'quarter') when = `${T(REPORT_QUARTERS[(Number(q.q) || 1) - 1])} ${q.year}`;
  else if (q.period === 'month') when = `${T(REPORT_MONTHS[(Number(q.m) || 1) - 1])} ${q.year}`;
  else when = T('من أول السنة لحد النهارده');
  return `${who} — ${when}`;
}

async function reportsLoadPreview() {
  const q = reportsReadFilters();
  const box = document.getElementById('repPreview');
  if (!q || !box) return null;
  const seq = ++reportsState.loadSeq;
  reportsState.previewKey = null;
  const note = document.getElementById('repScopeNote');
  if (note) note.textContent = reportsScopeLabel(q);
  box.innerHTML = `<div class="loading">${T('جارِ تجهيز التقرير…')}</div>`;
  try {
    const params = new URLSearchParams({ ...q, embed: '1' });
    const res = await authFetch(`/print/report?${params.toString()}`);
    const html = await res.text();
    if (seq !== reportsState.loadSeq || !document.body.contains(box)) return null;
    if (!res.ok) {
      const msg = (new DOMParser().parseFromString(html, 'text/html').querySelector('p.text, .sheet, body') || {}).textContent;
      box.innerHTML = `<div class="empty" style="color:var(--danger-text)"><div class="icon">⚠️</div>${escapeHtml((msg || '').trim().slice(0, 300) || T('تعذّر تجهيز التقرير'))}</div>`;
      return null;
    }
    const frame = document.createElement('iframe');
    frame.className = 'rep-frame';
    frame.title = T('معاينة التقرير');
    const fit = () => {
      try {
        const doc = frame.contentDocument;
        if (doc && doc.body) frame.style.height = Math.ceil(doc.body.getBoundingClientRect().height + 30) + 'px';
      } catch (e) { }
    };
    frame.addEventListener('load', () => {
      fit();
      try {
        const doc = frame.contentDocument;
        if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fit);
        if (window.ResizeObserver) new ResizeObserver(fit).observe(doc.body);
      } catch (e) { }
    });
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = html;
    box.innerHTML = '';
    box.appendChild(frame);
    await loaded;
    if (seq !== reportsState.loadSeq) return null;
    reportsState.previewKey = JSON.stringify(q);
    return frame;
  } catch (e) {
    if (seq === reportsState.loadSeq) {
      box.innerHTML = `<div class="empty" style="color:var(--danger-text)"><div class="icon">⚠️</div>${T('تعذّر الاتصال بالسيرفر — حاول تاني')}</div>`;
    }
    return null;
  }
}

async function reportsSavePdf() {
  const q = reportsReadFilters();
  const btn = document.getElementById('repPdfBtn');
  if (!q || !btn || btn.disabled) return;
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = T('جاري تجهيز ملف الـ PDF…');
  try {
    let frame = document.querySelector('#repPreview .rep-frame');
    if (!frame || reportsState.previewKey !== JSON.stringify(q)) frame = await reportsLoadPreview();
    const win = frame && frame.contentWindow;
    if (!win || typeof win.hsePrintSavePdf !== 'function') throw new Error('preview not ready');
    const r = await win.hsePrintSavePdf({
      silent: true,
      onProgress: t => { btn.textContent = t; },
    });
    if (r) {
      const n = r.pages;
      const pagesTxt = n === 1 ? T('صفحة واحدة') : n === 2 ? T('صفحتين') : `${n} ${n <= 10 ? T('صفحات') : T('صفحة')}`;
      showToast(`${T('✅ اتحفظ ملف الـ PDF')} (${pagesTxt})`, 'success');
    }
  } catch (e) {
    showToast(T('تعذّر تجهيز ملف الـ PDF — جرّب تاني، أو استخدم "طباعة" واختار Save as PDF'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

function reportsPrint() {
  const q = reportsReadFilters();
  if (!q) return;
  openPrintWithAuth(`/print/report?${new URLSearchParams({ ...q, autoprint: '1' }).toString()}`);
}

async function reportsSendMail() {
  const q = reportsReadFilters();
  const input = document.getElementById('repMailTo');
  const btn = document.getElementById('repSendBtn');
  if (!q || !input || !btn) return;
  const recipients = input.value.trim();
  const list = recipients.split(/[\s,;،]+/).filter(Boolean);
  if (!list.length) { showToast(T('اكتب الإيميل اللي هيتبعتله التقرير'), 'error'); input.focus(); return; }
  if (list.length > 5) { showToast(T('أقصى عدد 5 إيميلات في المرة'), 'error'); return; }
  const bad = list.find(m => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m));
  if (bad) { showToast(`${T('الإيميل ده مش صحيح:')} ${bad}`, 'error'); input.focus(); return; }

  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = T('جارِ الإرسال…');
  try {
    const res = await authFetch('/api/reports/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: list.join(', '), query: q }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      try { localStorage.setItem(REPORT_MAIL_KEY, list.join(', ')); } catch (e) { }
      showToast(`${T('✅ التقرير اتبعت على:')} ${(data.sentTo || list).join('، ')}`, 'success');
    } else if (res.status === 429) {
      showToast(data.error || T('بعت تقارير كتير في ساعة واحدة — استنى شوية وحاول تاني'), 'error');
    } else {
      showToast(data.error || T('تعذّر إرسال التقرير — حاول تاني'), 'error');
    }
  } catch (e) {
    showToast(T('تعذّر الاتصال بالسيرفر — حاول تاني'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}
