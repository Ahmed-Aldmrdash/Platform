// Model-employee leaderboard, employee table and edit modal, worker passwords and Excel import/export.

const MODEL_EMP_PENALTY_DEDUCTION = 15;

function computeModelEmployeeScore(emp, penaltiesList) {
  const code = normalizeCode(emp.code || emp.empCode || emp.id);
  const stats = emp._stats || { hPerc: 0, tPerc: 0, hazardsCount: 0, trainingHours: 0 };
  const activePenalties = penaltiesList.filter(p =>
    normalizeCode(p.empCode) === code && p.status !== 'cancelled' && p.status !== 'deleted'
  ).length;
  const safetyScore = Math.round((stats.hPerc + stats.tPerc) / 2);
  const modelScore = Math.max(0, safetyScore - (activePenalties * MODEL_EMP_PENALTY_DEDUCTION));
  return {
    modelScore,
    activePenalties,
    hazardsCount: stats.hazardsCount,
    trainingHours: stats.trainingHours
  };
}

let _modelEmpDeptFilter = 'الكل';

async function renderModelEmployeeSection() {
  const wrap = document.getElementById('modelEmployeeWrap');
  if (!wrap) return;

  const fullList = window._masterEmployeesList ? [...window._masterEmployeesList] : [];
  if (fullList.length === 0) { wrap.innerHTML = ''; return; }

  const canFilterByDept = (currentUserRole === 'super_admin' || currentUserRole === 'hse_admin');

  let deptFilterHtml = '';
  if (canFilterByDept) {
    const realDepts = await loadRealDepartments();
    deptFilterHtml = `
      <select id="modelEmpDeptSelect" class="lb-filter-btn" style="cursor:pointer;padding:6px 10px;"
        onchange="setModelEmpDeptFilter(this.value)">
        <option value="الكل">${T("🏢 كل الأقسام")}</option>
        ${realDepts.map(d => `<option value="${escapeAttr(d)}" ${_modelEmpDeptFilter === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
      </select>`;
  }

  let scopedList = fullList;
  if (canFilterByDept && _modelEmpDeptFilter !== 'الكل') {
    scopedList = scopedList.filter(e => (e.department || '') === _modelEmpDeptFilter);
  }

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const scored = computeAllStats(scopedList, yearStart, 12);
  const penalties = window._penaltiesCache || [];

  const ranked = scored
    .map(emp => ({ emp, ...computeModelEmployeeScore(emp, penalties) }))
    .sort((a, b) => {
      if (b.modelScore !== a.modelScore) return b.modelScore - a.modelScore;
      if (a.activePenalties !== b.activePenalties) return a.activePenalties - b.activePenalties;
      if (b.hazardsCount !== a.hazardsCount) return b.hazardsCount - a.hazardsCount;
      return b.trainingHours - a.trainingHours;
    })
    .slice(0, 10);

  const headerHtml = `
    <div class="leaderboard-header">
      <div class="leaderboard-title">${T("🏆 العامل المثالي")}${_modelEmpDeptFilter !== 'الكل' ? ' — ' + escapeHtml(_modelEmpDeptFilter) : ''}</div>
      ${canFilterByDept ? `<div class="leaderboard-filters">${deptFilterHtml}</div>` : ''}
    </div>`;

  if (ranked.length === 0) {
    wrap.innerHTML = `
      <div class="emp-leaderboard-wrap">
        ${headerHtml}
        <div style="padding:20px;text-align:center;color:var(--text-muted);">${T("لا توجد بيانات كافية لعرض القائمة")}${_modelEmpDeptFilter !== 'الكل' ? T(' لهذا القسم') : ''}</div>
      </div>`;
    return;
  }

  const champion = ranked[0];
  const rest = ranked.slice(1);
  const rankClass = (i) => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';

  wrap.innerHTML = `
    <div class="emp-leaderboard-wrap">
      ${headerHtml}
      <div class="leaderboard-content">
        <div class="lb-champion-card">
          <div class="lb-champion-crown">👑</div>
          <div class="lb-champion-title">${T("العامل المثالي")}</div>
          <div class="lb-champion-name">${escapeHtml(champion.emp.name || '')}</div>
          <div class="lb-champion-dept">${escapeHtml(champion.emp.department || '')}${champion.emp.jobTitle ? ' · ' + escapeHtml(champion.emp.jobTitle) : ''}</div>
          <div class="lb-champion-stats">
            <div class="lb-stat"><div class="lb-stat-val">${champion.modelScore}%</div><div class="lb-stat-lbl">${T("الالتزام")}</div></div>
            <div class="lb-stat"><div class="lb-stat-val">${champion.hazardsCount}</div><div class="lb-stat-lbl">${T("بلاغات")}</div></div>
            <div class="lb-stat"><div class="lb-stat-val">${champion.trainingHours}</div><div class="lb-stat-lbl">${T("ساعات تدريب")}</div></div>
          </div>
        </div>
        <div class="lb-list">
          ${rest.map((r, idx) => `
            <div class="lb-item">
              <div class="lb-item-rank ${rankClass(idx + 1)}">${idx + 2}</div>
              <div class="lb-item-info">
                <div class="lb-item-name">${escapeHtml(r.emp.name || '')}</div>
                <div class="lb-item-dept">${escapeHtml(r.emp.department || '')}${r.activePenalties ? ' · ⚠️ ' + r.activePenalties + T(' جزاء') : ''}</div>
              </div>
              <div class="lb-item-score">${r.modelScore}%</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function setModelEmpDeptFilter(v) {
  _modelEmpDeptFilter = v || 'الكل';
  renderModelEmployeeSection();
}

function renderEmployeesTable(list) {
  const listEl = document.getElementById('empDirList');
  if (!listEl) return;

  if (!document.getElementById('empTableBody')) {
    listEl.innerHTML = `
      <div class="um-table-wrap">
        <table class="um-table emp-dir-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${T("الكود")}</th>
              <th>${T("الاسم الكامل")}</th>
              <th>${T("القسم / المسمى")}</th>
              <th>${T("⚠️ البلاغات")}</th>
              <th>${T("🎓 المحاضرات")}</th>
              <th>${T("🚨 تجارب الطوارئ")}</th>
              <th>${T("إجراءات")}</th>
            </tr>
          </thead>
          <tbody id="empTableBody">
          </tbody>
        </table>
      </div>
      <div id="empTableMore"></div>
      <div id="empTableCount" style="font-size:12px;color:var(--text-muted);margin-top:8px;text-align:left;"></div>
    `;
  }

  // Callers pass the master list; its scored copy is cached, so it is used instead of scoring `list` again.
  renderEmployeesTableRows(getScoredEmployees());
}

window.handleEmployeeSearch = window.debounce(function(query) {
  const q = (query || '').trim().toLowerCase();
  const all = getScoredEmployees();

  if (!q) {
    renderEmployeesTableRows(all);
    return;
  }

  const cleanCode = String(query || '').trim().replace(/^0+/, '') || '0';

  const filtered = all.filter(emp => {
    const eName = (emp.name || '').toLowerCase();
    const eCode = String(emp.code || emp.empCode || '').toLowerCase();
    const eDept = (emp.department || '').toLowerCase();
    const eJob = (emp.jobTitle || '').toLowerCase();

    if (/^\d+$/.test(query)) {
      const eCodeNoZero = eCode.replace(/^0+/, '');
      return eCodeNoZero === cleanCode || eCode.includes(q);
    }

    return eName.includes(q) || eCode.includes(q) || eDept.includes(q) || eJob.includes(q);
  });

  renderEmployeesTableRows(filtered);
}, 250);

const EMP_PAGE_SIZE = 100;
function empShowMore() {
  window._empShowCount = (window._empShowCount || EMP_PAGE_SIZE) + EMP_PAGE_SIZE;
  renderEmployeesTableRows(window._currentVisibleEmployees || []);
}

// `list` holds scored employees (from getScoredEmployees); rows are drawn one page at a time.
function renderEmployeesTableRows(list) {
  const tbody = document.getElementById('empTableBody');
  const countEl = document.getElementById('empTableCount');
  const moreEl = document.getElementById('empTableMore');
  if (!tbody) return;

  if (!Array.isArray(list)) list = [];
  if (list !== window._currentVisibleEmployees) window._empShowCount = EMP_PAGE_SIZE;
  window._currentVisibleEmployees = list;

  if (list.length === 0) {
    tbody.innerHTML = T('<tr><td colspan="8"><div class="empty" style="padding:20px;text-align:center;"><div class="icon">👤</div>لا توجد نتائج مطابقة للبحث</div></td></tr>');
    if (moreEl) moreEl.innerHTML = '';
    if (countEl) countEl.innerText = T('إجمالي: 0 موظف');
    return;
  }

  const shown = window._empShowCount || EMP_PAGE_SIZE;
  const processedList = list.slice(0, shown);

  tbody.innerHTML = processedList.map((e, i) => {
    const hTarget = EMP_TARGET_HAZARDS;
    const tTarget = EMP_TARGET_TRAIN_HOURS;
    const hCount = e._stats ? e._stats.hazardsCount : 0;
    const tHours = e._stats ? e._stats.trainingHours : 0;
    const hPerc = e._stats ? e._stats.hPerc : 0;
    const tPerc = e._stats ? e._stats.tPerc : 0;
    const dCount = e._stats && e._stats.drillsCount ? e._stats.drillsCount : 0;
    const hBadgeClass = hPerc >= 100 ? 'badge-green' : (hPerc >= 50 ? 'badge-yellow' : 'badge-red');
    const tBadgeClass = tPerc >= 100 ? 'badge-green' : (tPerc >= 50 ? 'badge-yellow' : 'badge-red');

    return `
    <tr>
      <td style="color:var(--text-muted);font-size:12px;">${i + 1}</td>
      <td style="font-size:13px;font-weight:700;letter-spacing:1px;color:var(--brand-700);">
        ${escapeHtml(e.empCode || e.code)}
      </td>
      <td style="font-weight:700;">${escapeHtml(e.name || '—')}</td>
      <td>
        <div style="font-size:13px;">${escapeHtml(e.department || '—')}</div>
        <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(e.jobTitle || '—')}</div>
      </td>
      <td>
        <div style="font-size:12px; font-weight:bold; margin-bottom:4px;">${hCount} / ${hTarget} ${T("بلاغ")}</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="flex:1;background:var(--border);height:8px;border-radius:4px;overflow:hidden;min-width:40px;">
            <div style="height:100%;width:${hPerc}%;background:var(--brand-600);"></div>
          </div>
          <span class="emp-role-badge ${hBadgeClass}" style="min-width:35px;text-align:center;font-size:10px;">${hPerc}%</span>
        </div>
      </td>
      <td>
        <div style="font-size:12px; font-weight:bold; margin-bottom:4px;">${tHours} / ${tTarget} ${T("ساعات")}</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="flex:1;background:var(--border);height:8px;border-radius:4px;overflow:hidden;min-width:40px;">
            <div style="height:100%;width:${tPerc}%;background:var(--brand-600);"></div>
          </div>
          <span class="emp-role-badge ${tBadgeClass}" style="min-width:35px;text-align:center;font-size:10px;">${tPerc}%</span>

        </div>
      </td>
      <td>
        <div style="font-size:12px; font-weight:bold; margin-bottom:4px; color:var(--danger-text);">${dCount} ${T("تجربة")}</div>
      </td>
      <td>
        <div class="um-action-btns">
          <button class="um-btn pass" onclick="openEmpModal(${jsArg(e.empCode || e.code)})">${T("✏️ تعديل")}</button>
          <button class="um-btn del"  onclick="deleteEmployee(${jsArg(e.empCode || e.code)},${jsArg(e.name || '')})">${T("🗑 حذف")}</button>
        </div>
      </td>
    </tr>
    `;
  }).join('');

  if (moreEl) {
    moreEl.innerHTML = list.length > shown
      ? `<div class="pm-more"><button type="button" class="btn btn-secondary" onclick="empShowMore()">${T('عرض المزيد')} (${list.length - shown} ${T('متبقي')})</button></div>`
      : '';
  }
  if (countEl) countEl.innerText = `${T("إجمالي:")} ${list.length} ${T("موظف")}`;
}
function openEmpModal(code = null) {
  _empEditCode = code;
  const titleEl = document.getElementById('empModalTitle');
  const codeEl  = document.getElementById('em_code');

  if (code) {
    const emp = findListedEmployee(code);
    if (!emp) return;
    if (titleEl) titleEl.textContent = `${T("✏️ تعديل:")} ${emp.empCode}`;
    if (codeEl) { codeEl.value = emp.empCode; codeEl.setAttribute('readonly','readonly'); }
    const set = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
    set('em_name',     emp.name);
    set('em_dept',     emp.department);
    set('em_jobTitle', emp.jobTitle);
    set('em_role',     emp.role || 'worker');
    set('em_phone',    emp.phone);
  } else {
    if (titleEl) titleEl.textContent = T('➕ إضافة موظف جديد');
    if (codeEl) { codeEl.value = ''; codeEl.removeAttribute('readonly'); }
    ['em_name','em_dept','em_jobTitle','em_phone'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    const roleEl = document.getElementById('em_role');
    if (roleEl) roleEl.value = 'worker';
  }

  const msgEl = document.getElementById('em_msg');
  if (msgEl) { msgEl.className = 'um-msg'; msgEl.textContent = ''; }
  const pwBox = document.getElementById('em_pwBox');
  if (pwBox) {
    pwBox.style.display = code ? 'block' : 'none';
    const pwEmp = code ? findListedEmployee(code) : null;
    const st = document.getElementById('em_pwStatus');
    if (st) {
      const has = !!(pwEmp && pwEmp.hasWorkerPassword);
      st.textContent = has ? T('(عنده كلمة سر)') : T('(لسه ماعملش كلمة سر)');
      st.className = 'em-pw-status ' + (has ? 'ok' : 'none');
    }
    const pwInput = document.getElementById('em_newWorkerPw');
    if (pwInput) pwInput.value = '';
  }
  document.getElementById('empModal').style.display = 'flex';
}

function closeEmpModal() {
  document.getElementById('empModal').style.display = 'none';
  _empEditCode = null;
}

function generateWorkerPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(8);
  window.crypto.getRandomValues(buf);
  const pw = Array.from(buf, n => chars[n % chars.length]).join('');
  const inp = document.getElementById('em_newWorkerPw');
  if (inp) { inp.value = pw; inp.focus(); inp.select(); }
}

async function setEmployeePassword() {
  if (!_empEditCode) return;
  const msgEl = document.getElementById('em_msg');
  const inp = document.getElementById('em_newWorkerPw');
  const password = inp ? inp.value.trim() : '';
  const say = (text, ok) => { if (msgEl) { msgEl.textContent = text; msgEl.className = `um-msg ${ok ? 'success' : 'error'} show`; } };
  if (password.length < 6) return say(T('كلمة السر لازم تكون 6 حروف أو أرقام على الأقل'), false);
  try {
    const res = await authFetch(`/api/employees/${encodeURIComponent(_empEditCode)}/set-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return say(data.error || T('فشل حفظ كلمة السر'), false);
    say(`${T('✅ اتحفظت كلمة السر — ادّيها للعامل:')} ${password}`, true);
    const emp = findListedEmployee(_empEditCode);
    if (emp) emp.hasWorkerPassword = true;
    const st = document.getElementById('em_pwStatus');
    if (st) { st.textContent = T('(عنده كلمة سر)'); st.className = 'em-pw-status ok'; }
  } catch (e) {
    say(T('خطأ في الاتصال'), false);
  }
}

async function saveEmployee() {
  const code     = document.getElementById('em_code')?.value.trim();
  const name     = document.getElementById('em_name')?.value.trim();
  const dept     = document.getElementById('em_dept')?.value.trim();
  const jobTitle = document.getElementById('em_jobTitle')?.value.trim();
  const role     = document.getElementById('em_role')?.value;
  const phone    = document.getElementById('em_phone')?.value.trim();
  const msgEl    = document.getElementById('em_msg');

  if (!code || !name) {
    if (msgEl) { msgEl.textContent = T('الكود والاسم مطلوبان'); msgEl.className = 'um-msg error show'; }
    return;
  }

  try {
    let res;
    if (_empEditCode) {
      res = await authFetch(`/api/employees/${encodeURIComponent(_empEditCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, department: dept, jobTitle, role, phone })
      });
    } else {
      res = await authFetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empCode: code, name, department: dept, jobTitle, role, phone })
      });
    }
    const data = await res.json();
    if (res.ok) {
      if (msgEl) { msgEl.textContent = T('✅ تم الحفظ بنجاح'); msgEl.className = 'um-msg success show'; }
      setTimeout(() => { closeEmpModal(); renderEmployeesPanel(); }, 900);
    } else {
      if (msgEl) { msgEl.textContent = data.error || T('فشل الحفظ'); msgEl.className = 'um-msg error show'; }
    }
  } catch(e) {
    if (msgEl) { msgEl.textContent = T('خطأ في الاتصال'); msgEl.className = 'um-msg error show'; }
  }
}

async function deleteEmployee(code, name) {
  if (!(await appConfirm(`${T("هل تريد حذف الموظف")} "${name}" (${code}${T(")؟\\nهذه العملية لا يمكن التراجع عنها.")}`, { tone: 'danger', confirmLabel: T('حذف') }))) return;
  try {
    const res  = await authFetch(`/api/employees/${encodeURIComponent(code)}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      showToast(`${T("تم حذف الموظف")} ${name} ${T("بنجاح")}`, 'success');
      renderEmployeesPanel();
    } else {
      showToast(data.error || T('فشل الحذف'), 'error');
    }
  } catch(e) {
    showToast(T('خطأ في الاتصال'), 'error');
  }
}

async function importEmployeesExcel(input) {
  const file = input?.files?.[0];
  if (!file) return;
  input.value = '';

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = btoa(
      new Uint8Array(e.target.result).reduce((s, b) => s + String.fromCharCode(b), '')
    );
    showToast(T('جارِ رفع الملف وتحليله…'), 'info');
    try {
      const res  = await authFetch('/api/employees/import-excel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fileData: base64 })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`${T("✅ تم الاستيراد:")} ${data.added} ${T("جديد،")} ${data.updated} ${T("محدّث (الإجمالي:")} ${data.total})`, 'success');
        renderEmployeesPanel();
      } else {
        showToast(data.error || T('فشل الاستيراد'), 'error');
      }
    } catch(err) {
      showToast(T('خطأ في الاتصال أثناء الاستيراد'), 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

window.exportEmployeesExcel = async function() {
  // The visible rows are already scored; with no visible rows the whole (scored) list is exported.
  const scoredData = (window._currentVisibleEmployees && window._currentVisibleEmployees.length > 0)
    ? window._currentVisibleEmployees
    : getScoredEmployees();

  if (!scoredData || scoredData.length === 0) {
    showToast(T('لا توجد بيانات لتصديرها'), 'error');
    return;
  }
  if (!(await ensureXlsx())) return;

  try {
    const lbTimeframe = typeof window.currentTableTimeframe !== 'undefined' ? window.currentTableTimeframe : '12';
    const hTarget = EMP_TARGET_HAZARDS;
    const tTarget = EMP_TARGET_TRAIN_HOURS;

    const rows = scoredData.map(emp => {
      const hCount = emp._stats ? emp._stats.hazardsCount : 0;
      const tHours = emp._stats ? emp._stats.trainingHours : 0;
      const hPerc = emp._stats ? emp._stats.hPerc : 0;
      const tPerc = emp._stats ? emp._stats.tPerc : 0;
      const tScore = emp._stats ? emp._stats.totalScore : 0;
      const dCount = emp._stats && emp._stats.drillsCount ? emp._stats.drillsCount : 0;

      return {
        'الكود الوظيفي': emp.empCode || emp.emp_code || emp.code || '',
        'الاسم الكامل': emp.name || '',
        'القسم': emp.department || '',
        'المسمى الوظيفي': emp.jobTitle || emp.position || emp.title || '',
        'ساعات التدريب': tHours,
        'تارجت التدريب (ساعات)': tTarget,
        'نسبة تحقيق التدريب': `${tPerc}%`,
        'بلاغات الخطورة': hCount,
        'تارجت البلاغات': hTarget,
        'نسبة تحقيق البلاغات': `${hPerc}%`,
        'تجارب الطوارئ': dCount,
        'نقاط التميز': tScore,
        'الصلاحية': emp.role || 'worker',
        'رقم التليفون': emp.phone || emp.mobile || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, T('قاعدة الموظفين'));

    const filterName = lbTimeframe === 'all' ? T('سنة_كاملة') : `${lbTimeframe}${T("_أشهر")}`;
    XLSX.writeFile(wb, `employees_stats_${filterName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(`${T("تم تصدير")} ${scoredData.length} ${T("موظف مع الإحصائيات بنجاح 📊")}`, 'success');
  } catch(e) {
    console.error('Export error:', e);
    showToast(T('خطأ أثناء التصدير'), 'error');
  }
};
