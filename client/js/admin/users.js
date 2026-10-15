// User management for super admins: accounts, shared-account members and default password generation.

function roleLabel(r){
  if(r==='super_admin') return 'Super Admin';
  if(r==='hse_admin') return 'HSE Admin';
  if(r==='dept_admin') return 'Dept Admin';
  return r;
}

function toggleUmDept() {
  const role = document.getElementById('um_role').value;
  const deptRow = document.getElementById('um_deptRow');
  deptRow.style.display = (role === 'dept_admin' || role === 'maint_admin') ? 'flex' : 'none';
}

async function renderUsersPanel(){
  const listEl = document.getElementById('um_usersList');
  if(!listEl) return;
  listEl.innerHTML = T('<div class="loading">جارِ تحميل المستخدمين…</div>');
  try{
    const res = await authFetch('/api/users');
    if(!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    const users = data.users || [];
    window.umUsers = users;
    if(users.length === 0){
      listEl.innerHTML = T('<div class="empty"><div class="icon">👤</div>لا يوجد مستخدمون</div>');
      return;
    }
    listEl.innerHTML = `
      <div class="um-bulk-bar">
        <button class="um-btn pass" onclick="generateDefaultPasswords()">🔐 ${T("توليد كلمات سر لحسابات الأقسام اللي على كلمة السر الافتراضية")}</button>
        <span class="um-bulk-hint">${T("حسابات الأقسام اللي لسه على 123456 بتدخل عادي وأول شاشة بتقابلها هي تغيير كلمة السر. تقدر كمان تولّد لها كلمات سر جاهزة وتوزّعها على رؤساء الأقسام.")}</span>
      </div>
      <div id="umGeneratedBox"></div>
      <div class="um-table-wrap">
        <table class="um-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${T("الاسم")}</th>
              <th>${T("اسم المستخدم")}</th>
              <th>${T("الدور")}</th>
              <th>${T("تاريخ الإنشاء")}</th>
              <th>${T("إجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u,i) => `
              <tr>
                <td style="color:var(--text-muted);font-size:12px;">${i+1}</td>
                <td style="font-weight:700;">${escapeHtml(u.name)}</td>
                <td style="font-size:13px;">${escapeHtml(u.username)}</td>
                <td>
                  <span class="role-badge ${escapeHtml(u.role)}">${escapeHtml(roleLabel(u.role))}</span>
                  ${(u.role === 'dept_admin' || u.role === 'maint_admin') && u.department ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${escapeHtml(u.department)}</div>` : ''}
                  ${u.mustChangePassword ? `<div class="um-default-pw">⚠️ ${T("كلمة سر مؤقتة — لأول شخص بس")}</div>` : ''}
                  <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">👥 ${(u.members||[]).length ? `${T("عمل كلمة سر شخصية:")} ${(u.members||[]).length}` : T("محدش عمل كلمة سر شخصية لسه")}</div>
                </td>
                <td style="color:var(--text-muted);font-size:12px;">${u.createdAt ? new Date(u.createdAt).toLocaleDateString(LOC()) : '—'}</td>
                <td>
                  <div class="um-action-btns">
                    <button class="um-btn pass" onclick="openEditUserModal(${jsArg(u.id)})">${T("✏️ تعديل")}</button>
                    <button class="um-btn" onclick="openUserMembersModal(${jsArg(u.id)})">👥 ${T("الأعضاء")}</button>
                    <button class="um-btn del" onclick="deleteUser(${jsArg(u.id)},${jsArg(u.name)})"
                      ${u.role==='super_admin' ? T('disabled title="لا يمكن حذف Super Admin"') : ''}>${T("🗑 حذف")}</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch(e){
    listEl.innerHTML = T('<div class="empty" style="color:var(--danger-text);">فشل تحميل المستخدمين</div>');
  }
}

function openUserMembersModal(userId) {
  const user = (window.umUsers || []).find(u => u.id === userId);
  if (!user) return;
  const members = user.members || [];
  const html = `
    <h3 style="margin-top:0;">👥 ${T("أعضاء حساب")} ${escapeHtml(user.username)}</h3>
    <p style="font-size:12.5px; color:var(--text-muted); margin-top:0;">${T("كل واحد من دول عمل كلمة سر شخصية لنفسه بكوده الوظيفي، ومحدش غيره يعرفها. لو حد نسي كلمة سره، اضغط \"إعادة تعيين\" عشان يتطلب منه يعمل واحدة جديدة أول ما يدخل تاني.")}</p>
    ${members.length ? `
      <div class="um-table-wrap">
        <table class="um-table">
          <thead><tr><th>${T("الاسم")}</th><th>${T("الكود الوظيفي")}</th><th>${T("تاريخ الإنشاء")}</th><th>${T("إجراء")}</th></tr></thead>
          <tbody>
            ${members.map(m => `
              <tr>
                <td style="font-weight:700;">${escapeHtml(m.name || '—')}</td>
                <td dir="ltr">${escapeHtml(m.empCode)}</td>
                <td style="color:var(--text-muted); font-size:12px;">${m.createdAt ? new Date(m.createdAt).toLocaleDateString(LOC()) : '—'}</td>
                <td><button class="um-btn del" style="padding:4px 10px; font-size:11px;" onclick="resetMemberPassword(${jsArg(userId)}, ${jsArg(m.empCode)}, ${jsArg(m.name || m.empCode)})">${T("🔄 إعادة تعيين")}</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : `<div class="empty">${T("محدش عمل كلمة سر شخصية على الحساب ده لسه — أول واحد يدخل بكلمة سر الحساب الحالية هيتطلب منه يعمل واحدة.")}</div>`}
  `;
  openAppModal(html);
}

async function resetMemberPassword(userId, empCode, name) {
  if (!(await appConfirm(`${T("هيتمسح كلمة السر الشخصية بتاعة")} ${name} ${T("وهيتطلب منه يعمل واحدة جديدة أول ما يدخل تاني (بكلمة سر الحساب الحالية أو المؤقتة). متأكد؟")}`, { tone: 'warning', confirmLabel: T('إعادة تعيين') }))) return;
  try {
    const res = await authFetch(`/api/users/${encodeURIComponent(userId)}/reset-member-password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(T('✅ تم مسح كلمة السر الشخصية'), 'success');
      closeAppModal();
      renderUsersPanel();
    } else {
      showToast(data.error || T('فشل مسح كلمة السر'), 'error');
    }
  } catch (e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

async function generateDefaultPasswords() {
  if (!(await appConfirm(T('هيتعمل كلمة سر عشوائية جديدة لكل حساب قسم/صيانة لسه على 123456، وهتظهرلك مرة واحدة بس عشان توزعها. نكمل؟'), { tone: 'warning', confirmLabel: T('توليد كلمات السر') }))) return;
  const box = document.getElementById('umGeneratedBox');
  if (box) box.innerHTML = `<div class="loading">${T('جارِ التوليد… (ممكن ياخد نص دقيقة)')}</div>`;
  try {
    const res = await authFetch('/api/users/generate-default-passwords', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { if (box) box.innerHTML = ''; showToast(data.error || T('فشل التوليد'), 'error'); return; }
    if (!data.count) { if (box) box.innerHTML = `<div class="um-gen-box">${T('مفيش حسابات على كلمة السر الافتراضية ✅')}</div>`; return; }
    window._generatedAccounts = data.accounts;
    if (box) box.innerHTML = `
      <div class="um-gen-box">
        <div class="um-gen-title">🔐 ${T('كلمات السر الجديدة')} (${data.count}) — ${T('انسخها أو نزّلها دلوقتي، مش هتظهر تاني')}</div>
        <div class="um-table-wrap"><table class="um-table">
          <thead><tr><th>${T('القسم')}</th><th>${T('اسم المستخدم')}</th><th>${T('كلمة السر')}</th></tr></thead>
          <tbody>${data.accounts.map(a => `<tr><td>${escapeHtml(a.department || a.name)}</td><td dir="ltr">${escapeHtml(a.username)}</td><td dir="ltr" class="um-gen-pw">${escapeHtml(a.password)}</td></tr>`).join('')}</tbody>
        </table></div>
        <button class="um-btn pass" onclick="downloadGeneratedAccounts()">⬇ ${T('تنزيل القائمة (CSV)')}</button>
      </div>`;
  } catch (e) {
    if (box) box.innerHTML = '';
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

// A leading ' keeps spreadsheet apps from treating a cell as a formula (CSV injection).
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadGeneratedAccounts() {
  const rows = [['department', 'username', 'password'], ...(window._generatedAccounts || []).map(a => [a.department || a.name, a.username, a.password])];
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `كلمات سر حسابات الأقسام - ${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

async function addUser(){
  const name = document.getElementById('um_name').value.trim();
  const username = document.getElementById('um_username').value.trim();
  const password = document.getElementById('um_password').value;
  const role = document.getElementById('um_role').value;
  const dept = document.getElementById('um_dept').value;
  const msgEl = document.getElementById('um_addMsg');
  const btn = document.getElementById('um_addBtn');

  msgEl.className = 'um-msg';
  msgEl.style.display = 'none';

  if(!name || !username || !password){
    msgEl.textContent = T('من فضلك املأ جميع الحقول المطلوبة');
    msgEl.className = 'um-msg error show';
    return;
  }
  btn.disabled = true;
  btn.textContent = T('جارِ الإضافة…');
  try{
    const res = await authFetch('/api/users',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name, username, password, role, department: role === 'dept_admin' ? dept : ''})
    });
    const data = await res.json();
    if(res.ok){
      msgEl.textContent = `${T("✅ تم إضافة المستخدم")} "${name}" ${T("بنجاح")}`;
      msgEl.className = 'um-msg success show';
      document.getElementById('um_name').value = '';
      document.getElementById('um_username').value = '';
      document.getElementById('um_password').value = '';
      document.getElementById('um_role').value = 'hse_admin';
      renderUsersPanel();
    } else {
      msgEl.textContent = data.error || T('حصل خطأ في الإضافة');
      msgEl.className = 'um-msg error show';
    }
  } catch(e){
    msgEl.textContent = T('حصل خطأ في الاتصال بالسيرفر');
    msgEl.className = 'um-msg error show';
  }
  btn.disabled = false;
  btn.textContent = T('➕ إضافة المستخدم');
}

async function deleteUser(id, name){
  if(!(await appConfirm(`${T("هل أنت متأكد من حذف المستخدم")} "${name}"${T("؟\\nهذه العملية لا يمكن التراجع عنها.")}`, { tone: 'danger', confirmLabel: T('حذف') }))) return;
  try{
    const res = await authFetch(`/api/users/${encodeURIComponent(id)}`, {method:'DELETE'});
    const data = await res.json();
    if(res.ok){
      renderUsersPanel();
    } else {
      showToast(data.error || T('فشل حذف المستخدم'), 'error');
    }
  } catch(e){
    showToast(T('حصل خطأ في الاتصال بالسيرفر'), 'error');
  }
}

let umEditTargetId = '';

function toggleEditUmDept() {
  const role = document.getElementById('um_editRole').value;
  const deptRow = document.getElementById('um_editDeptRow');
  deptRow.style.display = (role === 'dept_admin' || role === 'maint_admin') ? 'block' : 'none';
}

function openEditUserModal(userId){
  const user = window.umUsers.find(u => u.id === userId);
  if(!user) return;

  umEditTargetId = userId;
  document.getElementById('um_editModalName').textContent = `${T("تعديل المستخدم:")} ${user.name}`;
  document.getElementById('um_editName').value = user.name || '';
  document.getElementById('um_editUsername').value = user.username || '';
  document.getElementById('um_editRole').value = user.role || 'hse_admin';
  document.getElementById('um_editDept').value = user.department || 'Administration';
  document.getElementById('um_editNewPass').value = '';
  const codeEl = document.getElementById('um_editEmpCode');
  if (codeEl) codeEl.value = user.empCode || '';
  const infoEl = document.getElementById('um_editInfoBox');
  if (infoEl) {
    const bits = [];
    if (user.empCode) bits.push(`${T('مقفول على الكود')}: <b>${escapeHtml(user.empCode)}</b>`);
    if (user.phone) bits.push(`${T('موبايل')}: <span dir="ltr">${escapeHtml(user.phone)}</span>`);
    if (user.email) bits.push(`${T('إيميل')}: <span dir="ltr">${escapeHtml(user.email)}</span>`);
    if (user.department) bits.push(`${T('القسم')}: ${escapeHtml(user.department)}`);
    if (user.mustChangePassword) bits.push(`<span style="color:var(--warning-text);">${T('كلمة السر المشتركة بتشتغل مرة واحدة: أول شخص يعمل كلمة سره الشخصية وبعدها تتلغي')}</span>`);
    infoEl.innerHTML = bits.length ? bits.join(' · ') : T('مفيش بيانات تواصل مسجّلة للحساب ده لسه');
  }

  toggleEditUmDept();

  const msg = document.getElementById('um_editMsg');
  msg.className = 'um-msg';
  document.getElementById('um_editModal').style.display = 'flex';
}

function closeEditUserModal(){
  document.getElementById('um_editModal').style.display = 'none';
  umEditTargetId = '';
}

async function saveUserEdit(){
  const name = document.getElementById('um_editName').value.trim();
  const username = document.getElementById('um_editUsername').value.trim();
  const role = document.getElementById('um_editRole').value;
  const dept = document.getElementById('um_editDept').value;
  const newPass = document.getElementById('um_editNewPass').value;

  const msgEl = document.getElementById('um_editMsg');
  msgEl.className = 'um-msg';

  if(!name || !username || !role){
    msgEl.textContent = T('من فضلك أملأ جميع الحقول المطلوبة');
    msgEl.className = 'um-msg error show';
    return;
  }
  if(newPass && newPass.length < 6){
    msgEl.textContent = T('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    msgEl.className = 'um-msg error show';
    return;
  }

  const empCodeEl = document.getElementById('um_editEmpCode');
  const payload = {
    name, username, role,
    department: (role === 'dept_admin' || role === 'maint_admin') ? dept : '',
    empCode: empCodeEl ? empCodeEl.value.trim() : undefined,
  };
  if(newPass) payload.newPassword = newPass;

  try{
    const res = await authFetch(`/api/users/${encodeURIComponent(umEditTargetId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(res.ok){
      msgEl.textContent = T('✅ تم تحديث بيانات المستخدم بنجاح');
      msgEl.className = 'um-msg success show';
      setTimeout(() => {
        closeEditUserModal();
        renderUsersPanel();
      }, 1000);
    } else {
      msgEl.textContent = data.error || T('حصل خطأ أثناء التحديث');
      msgEl.className = 'um-msg error show';
    }
  } catch(e){
    msgEl.textContent = T('حصل خطأ في الاتصال بالسيرفر');
    msgEl.className = 'um-msg error show';
  }
}
