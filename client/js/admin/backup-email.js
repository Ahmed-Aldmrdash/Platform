// Full backup download/restore, SMTP settings, scheduled backup email and local snapshots.

function downloadFullBackup() {
  navigateWithAuth('/api/admin/backup/export');
}

async function _readBackupFile(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  if (!isGzip) return JSON.parse(await file.text());
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

async function restoreFullBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm(T('تحذير: استرجاع هذه النسخة الاحتياطية سيستبدل كل البيانات الحالية في النظام (التصاريح، البلاغات، الموظفين...) بمحتوى الملف. هل أنت متأكد؟'))) {
    event.target.value = '';
    return;
  }
  try {
    const backup = await _readBackupFile(file);
    showToast(T('جارِ استرجاع النسخة الاحتياطية…'), 'info');
    const res = await authFetch('/api/admin/backup/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backup, confirm: 'تأكيد' })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      showToast(`${T("تم استرجاع")} ${data.restored} ${T("مجموعة بيانات بنجاح ✓ — يُنصح بتحديث الصفحة")}`, 'success');
    } else {
      showToast(data.error || T('فشل استرجاع النسخة الاحتياطية'), 'error');
    }
  } catch (e) {
    console.error('restoreFullBackup error', e);
    showToast(T('ملف النسخة الاحتياطية غير صالح'), 'error');
  }
  event.target.value = '';
}

let _smtpSettingsCache = null;

async function loadBackupEmailSettings() {
  const box = document.getElementById('backupEmailBox');
  if (!box) return;
  try {
    const [res, smtpRes] = await Promise.all([
      authFetch('/api/admin/backup/email-settings'),
      authFetch('/api/admin/smtp-settings'),
    ]);
    if (!res.ok) throw new Error('fetch failed');
    _smtpSettingsCache = smtpRes.ok ? await smtpRes.json() : null;
    _renderBackupEmailBox(await res.json());
  } catch (e) {
    box.innerHTML = `<div style="color:var(--danger);font-size:13px;">${T('فشل تحميل إعدادات الإيميل')}</div>`;
  }
}

function _renderSmtpBox(s) {
  const cfg = s || {};
  const ok = cfg.configured;
  const suggested = cfg.suggestedEmail || '';
  const host = cfg.host || (suggested.includes('@gmail.') ? 'smtp.gmail.com' : '');
  const port = cfg.port || 587;
  const user = cfg.user || suggested;
  const from = cfg.from || suggested;
  return `
    <details class="smtp-box" ${ok ? '' : 'open'}>
      <summary>
        <span>${T('⚙️ بيانات إيميل الإرسال (SMTP)')}</span>
        <span class="smtp-badge ${ok ? 'ok' : 'warn'}">${ok ? T('متظبط ✓') : T('لسه مش متظبط')}</span>
      </summary>
      <div class="smtp-grid">
        <div class="field"><label>${T('سيرفر الإيميل (SMTP Host)')}</label>
          <input id="smtpHost" dir="ltr" placeholder="smtp.gmail.com" value="${escapeHtml(host)}" /></div>
        <div class="field"><label>${T('البورت')}</label>
          <input id="smtpPort" dir="ltr" type="number" placeholder="587" value="${escapeHtml(String(port))}" /></div>
        <div class="field"><label>${T('اسم المستخدم (الإيميل)')}</label>
          <input id="smtpUser" dir="ltr" placeholder="hse@company.com" value="${escapeHtml(user)}" /></div>
        <div class="field"><label>${T('الباسورد')} ${cfg.hasPass ? `<span style="font-weight:400;color:var(--muted);font-size:11px;">(${T('محفوظ — سيبه فاضي لو مش هتغيره')})</span>` : ''}</label>
          <input id="smtpPass" dir="ltr" type="password" autocomplete="new-password" placeholder="${cfg.hasPass ? '••••••••' : T('App Password لو Gmail')}" /></div>
        <div class="field"><label>${T('الإيميل اللي هيظهر للمستلم')}</label>
          <input id="smtpFrom" dir="ltr" placeholder="hse@company.com" value="${escapeHtml(from)}" /></div>
        <div class="field"><label>${T('اسم المُرسِل')}</label>
          <input id="smtpFromName" placeholder="${T('منصة السلامة — السويدي بوليمرز')}" value="${escapeHtml(cfg.fromName || '')}" /></div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;margin:6px 0 10px;">
        <input type="checkbox" id="smtpSecure" ${cfg.secure ? 'checked' : ''} /> ${T('اتصال مشفّر SSL (بورت 465)')}
      </label>
      <div class="smtp-presets">
        ${T('إعداد سريع:')}
        <button type="button" class="um-btn" onclick="smtpPreset('gmail')">Gmail</button>
        <button type="button" class="um-btn" onclick="smtpPreset('office365')">Office 365</button>
        <button type="button" class="um-btn" onclick="smtpPreset('outlook')">Outlook</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-primary" type="button" onclick="saveSmtpSettings()">${T('💾 حفظ بيانات الإيميل')}</button>
        <button class="btn btn-secondary" type="button" onclick="sendSmtpTest()">${T('✉️ ابعت إيميل تجريبي')}</button>
      </div>
      <div class="smtp-hint">${T('Gmail: لازم تفعّل التحقق بخطوتين وتعمل "App Password" من إعدادات جوجل وتحطه هنا بدل باسورد الحساب.')}</div>
    </details>`;
}

function smtpPreset(kind) {
  const presets = {
    gmail:     { host: 'smtp.gmail.com',        port: 587, secure: false },
    office365: { host: 'smtp.office365.com',    port: 587, secure: false },
    outlook:   { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  };
  const p = presets[kind];
  if (!p) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('smtpHost', p.host);
  set('smtpPort', p.port);
  const sec = document.getElementById('smtpSecure');
  if (sec) sec.checked = p.secure;
  showToast(T('اكتب الإيميل والباسورد وبعدين احفظ'), 'info');
}

async function saveSmtpSettings() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const body = {
    host: val('smtpHost').trim(),
    port: parseInt(val('smtpPort'), 10) || 587,
    user: val('smtpUser').trim(),
    pass: val('smtpPass'),
    from: val('smtpFrom').trim() || val('smtpUser').trim(),
    fromName: val('smtpFromName').trim(),
    secure: !!(document.getElementById('smtpSecure') || {}).checked,
  };
  if (!body.host || !body.user) { showToast(T('اكتب سيرفر الإيميل واسم المستخدم'), 'error'); return; }
  try {
    const res = await authFetch('/api/admin/smtp-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || T('فشل الحفظ'), 'error'); return; }
    _smtpSettingsCache = data;
    showToast(T('اتحفظت بيانات الإيميل ✓ — جرّب "ابعت إيميل تجريبي"'), 'success');
    loadBackupEmailSettings();
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

async function sendSmtpTest() {
  const suggested = ((_smtpSettingsCache && _smtpSettingsCache.from) || '');
  const to = prompt(T('الإيميل اللي هيستقبل الرسالة التجريبية:'), suggested);
  if (!to) return;
  showToast(T('جارِ الإرسال…'), 'info');
  try {
    const res = await authFetch('/api/admin/smtp-test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: to.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) showToast(`${T('اتبعت إيميل تجريبي إلى')} ${data.to} ✓`, 'success');
    else showToast(data.error || T('فشل الإرسال'), 'error');
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

function _backupEmailStatusText(r) {
  if (!r) return T('لسه مفيش نسخة اتبعتت بالإيميل');
  const when = new Date(r.at).toLocaleString(LOC());
  const kind = r.trigger === 'daily' ? T('يومي تلقائي') : T('يدوي');
  const to = escapeHtml((r.recipients || []).join(', '));
  return r.ok
    ? `${T('آخر إرسال:')} ✅ ${when} (${kind}) → <span dir="ltr">${to}</span>${r.sizeKB ? ` · ${r.sizeKB} KB` : ''}`
    : `${T('آخر إرسال:')} <span style="color:var(--danger);">❌ ${when} (${kind}) — ${escapeHtml(r.error || '')}</span>`;
}

function _renderBackupEmailBox(s) {
  const box = document.getElementById('backupEmailBox');
  if (!box) return;
  box.innerHTML = `
    <div style="font-weight:800;margin-bottom:8px;">${T('📧 إرسال النسخة الاحتياطية بالإيميل')}</div>
    ${s.smtpConfigured
      ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">${T('بيتبعت من:')} <b dir="ltr">${escapeHtml(s.from || '')}</b></div>`
      : `<div class="bk-email-warn">${T('⚠️ إيميل الإرسال لسه مش متظبط — اظبطه من "بيانات إيميل الإرسال" تحت، وبعدها زرار "ابعت النسخة دلوقتي" هيشتغل.')}</div>`}
    ${_renderSmtpBox(_smtpSettingsCache)}
    <div class="field" style="margin-bottom:10px;">
      <label>${T('الإيميلات اللي هتستلم النسخة (إيميل في كل سطر أو افصل بينهم بفاصلة)')}</label>
      <textarea id="bkEmailRecipients" rows="3" dir="ltr" placeholder="name@company.com">${escapeHtml((s.recipients && s.recipients.length ? s.recipients : [(_smtpSettingsCache && _smtpSettingsCache.suggestedEmail) || ''].filter(Boolean)).join('\n'))}</textarea>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
      <label style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;margin:0;">
        <input type="checkbox" id="bkEmailEnabled" ${s.enabled ? 'checked' : ''} />
        ${T('إرسال تلقائي كل يوم الساعة')}
      </label>
      <input type="time" id="bkEmailTime" value="${escapeHtml(s.time || '00:00')}" style="width:auto;" />
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-primary" type="button" onclick="saveBackupEmailSettings()">${T('💾 حفظ الإعدادات')}</button>
      <button class="btn btn-secondary" type="button" id="bkEmailSendBtn" onclick="sendBackupEmailNow()" ${s.smtpConfigured ? '' : 'disabled'}>${T('📤 ابعت النسخة دلوقتي')}</button>
    </div>
    <div id="bkEmailStatus" style="font-size:12px;margin-top:10px;color:var(--muted);">${_backupEmailStatusText(s.lastResult)}</div>
  `;
}

async function saveBackupEmailSettings() {
  const body = {
    recipients: document.getElementById('bkEmailRecipients').value,
    enabled:    document.getElementById('bkEmailEnabled').checked,
    time:       document.getElementById('bkEmailTime').value || '00:00',
  };
  try {
    const res = await authFetch('/api/admin/backup/email-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || T('فشل الحفظ'), 'error'); return; }
    _renderBackupEmailBox(data);
    showToast(T('تم حفظ الإعدادات ✓'), 'success');
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

async function sendBackupEmailNow() {
  const recipients = document.getElementById('bkEmailRecipients').value;
  if (!recipients.trim()) { showToast(T('اكتب إيميل واحد على الأقل'), 'error'); return; }
  const btn = document.getElementById('bkEmailSendBtn');
  if (btn) btn.disabled = true;
  showToast(T('جارِ تجهيز النسخة وإرسالها…'), 'info');
  try {
    const res = await authFetch('/api/admin/backup/email-now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) showToast(`${T('اتبعتت النسخة الاحتياطية إلى')} ${data.recipients.join(', ')}`, 'success');
    else showToast(data.error || T('فشل الإرسال'), 'error');
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
  if (btn) btn.disabled = false;
  try {
    const r = await authFetch('/api/admin/backup/email-settings');
    const statusEl = document.getElementById('bkEmailStatus');
    if (r.ok && statusEl) statusEl.innerHTML = _backupEmailStatusText((await r.json()).lastResult);
  } catch (e) { }
}
async function loadBackupSnapshots() {
  const box = document.getElementById('backupSnapshotBox');
  if (!box) return;
  try {
    const res = await authFetch('/api/admin/backup/snapshots');
    if (!res.ok) throw new Error('fetch failed');
    _renderSnapshotBox(await res.json());
  } catch (e) {
    box.innerHTML = `<div style="color:var(--danger);font-size:13px;">${T('فشل تحميل النسخ المحلية')}</div>`;
  }
}

function _snapshotDrillText(d, at) {
  if (!d) return T('لسه مااتعملش اختبار استرجاع.');
  const when = at ? new Date(at).toLocaleString('ar-EG') : '';
  return d.ok
    ? `✅ ${T('آخر اختبار استرجاع نجح')} — ${escapeHtml(d.file || '')} (${Number(d.total || 0).toLocaleString('ar-EG')} ${T('سجل')})${when ? ` · ${when}` : ''}`
    : `❌ ${T('آخر اختبار استرجاع فشل')}: ${escapeHtml(d.error || '')}${when ? ` · ${when}` : ''}`;
}

function _renderSnapshotBox(s) {
  const box = document.getElementById('backupSnapshotBox');
  if (!box) return;
  const snaps = Array.isArray(s.snapshots) ? s.snapshots : [];
  const last = s.lastResult;
  const lastTxt = !last ? T('لسه مااتحفظتش نسخة محلية.')
    : last.ok
      ? `✅ ${T('آخر نسخة:')} ${escapeHtml(last.file || '')} (${Number(last.sizeKB || 0).toLocaleString('ar-EG')} KB) · ${new Date(last.at).toLocaleString('ar-EG')}`
      : `❌ ${T('فشل آخر نسخة:')} ${escapeHtml(last.error || '')}`;

  box.innerHTML = `
    <div style="font-weight:800;margin-bottom:8px;">${T('🗄️ نسخ محلية يومية على السيرفر')}</div>
    ${s.volumeWarning ? `<div class="bk-email-warn">⚠️ ${escapeHtml(s.volumeWarning)}</div>` : ''}
    <div style="font-size:12px;color:var(--muted);line-height:1.8;margin-bottom:10px;">
      ${T('السيرفر بياخد نسخة كل يوم لوحده وبيحتفظ بآخر')} ${Number(s.keepDaily || 14)} ${T('يوم + نسخة أسبوعية لآخر')} ${Number(s.keepWeekly || 8)} ${T('أسابيع، والباقي بيتمسح لوحده.')}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <button class="btn btn-primary" type="button" id="snapNowBtn" onclick="takeSnapshotNow()">${T('🗄️ خد نسخة دلوقتي')}</button>
      <button class="btn btn-secondary" type="button" id="snapVerifyBtn" onclick="verifySnapshotNow()">${T('🧪 اختبر استرجاع آخر نسخة')}</button>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${lastTxt}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${_snapshotDrillText(s.lastDrill, s.lastDrillAt)}</div>
    ${snaps.length ? `
      <div style="font-weight:700;font-size:13px;margin-bottom:6px;">${T('النسخ المحفوظة')} (${snaps.length})</div>
      <div class="snap-list">
        ${snaps.slice(0, 10).map(x => `
          <div class="snap-row">
            <span class="snap-name" dir="ltr">${escapeHtml(x.name)}</span>
            <span class="snap-size">${Number(x.sizeKB).toLocaleString('ar-EG')} KB</span>
            <button type="button" class="snap-dl" onclick="downloadSnapshot(${jsArg(x.name)})" title="${T('تنزيل')}">⬇</button>
          </div>`).join('')}
      </div>
      ${snaps.length > 10 ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;">${T('+ ')}${snaps.length - 10} ${T('نسخة أقدم')}</div>` : ''}
    ` : `<div style="font-size:12px;color:var(--muted);">${T('مفيش نسخ محلية لحد دلوقتي — أول نسخة بتتاخد بعد تشغيل السيرفر بشوية.')}</div>`}
  `;
}

async function takeSnapshotNow() {
  const btn = document.getElementById('snapNowBtn');
  if (btn) btn.disabled = true;
  showToast(T('جارِ حفظ نسخة محلية…'), 'info');
  try {
    const res = await authFetch('/api/admin/backup/snapshot-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json().catch(() => ({}));
    if (res.ok) showToast(`${T('✅ اتحفظت نسخة محلية')} (${Number(d.sizeKB || 0).toLocaleString('ar-EG')} KB)`, 'success');
    else showToast(d.error || T('فشل حفظ النسخة'), 'error');
  } catch (e) { showToast(T('خطأ في الاتصال'), 'error'); }
  if (btn) btn.disabled = false;
  loadBackupSnapshots();
}

async function verifySnapshotNow() {
  const btn = document.getElementById('snapVerifyBtn');
  if (btn) btn.disabled = true;
  showToast(T('جارِ اختبار الاسترجاع…'), 'info');
  try {
    const res = await authFetch('/api/admin/backup/verify-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json().catch(() => ({}));
    if (d.ok) showToast(`${T('✅ النسخة سليمة وتنفع ترجع')} — ${Number(d.total || 0).toLocaleString('ar-EG')} ${T('سجل')}`, 'success');
    else showToast(`${T('⚠️ النسخة مش سليمة:')} ${d.error || ''}`, 'error');
  } catch (e) { showToast(T('خطأ في الاتصال'), 'error'); }
  if (btn) btn.disabled = false;
  loadBackupSnapshots();
}

async function downloadSnapshot(name) {
  const url = `/api/admin/backup/snapshots/${encodeURIComponent(name)}`;
  try {
    const full = _withLinkToken(url, await getLinkToken(url));
    const a = document.createElement('a');
    a.href = full;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    showToast(T('تعذّر تنزيل النسخة — حاول تاني'), 'error');
  }
}
