// Work permit request form: type picker, checklist, tools, risk assessment rows and submission.

function typeChips(){
  return Object.keys(PERMIT_TYPES).map(key => {
    const t = PERMIT_TYPES[key];
    return `<div class="chip ${key===selectedType?'active':''}" onclick="selectType(${jsArg(key)})">${T(t.label)}</div>`;
  }).join('');
}

function selectType(key){
  selectedType = key;
  renderForm();
}

function renderForm(){
  window._formLang = window._currentLang;
  const type = PERMIT_TYPES[selectedType];
  let chkGlobalIndex = 0;
  function buildSectionHtml(section) {
    let toggleHtml = '';
    let sectionId = '';
    let toggleId = '';
    if(section === HSE_CHECKLIST.oilDischarge) {
      sectionId = 'sec_oil'; toggleId = 'sec_oil_toggle';
    } else if(section === HSE_CHECKLIST.specialMaterial) {
      sectionId = 'sec_special'; toggleId = 'sec_special_toggle';
    }
    if (toggleId) {
      toggleHtml = `<label class="u-fs-sm u-fw-400 u-flex u-items-center u-gap-1" style="margin-inline-start: auto; cursor: pointer"><input type="checkbox" id="${toggleId}" onchange="document.getElementById(${jsArg(sectionId + '_content')}).style.display = this.checked ? 'none' : 'block'"> ${T("لا يوجد")}</label>`;
    }

    const rows = section.items.map((q) => {
      const i = chkGlobalIndex++;
      return `
      <div class="check-row">
        <div class="check-q">${T(q)}</div>
        <div class="check-opts">
          <label><input type="radio" name="chk_${i}" value="نعم" checked> ${T('نعم')}</label>
          <label><input type="radio" name="chk_${i}" value="لا"> ${T('لا')}</label>
          <label><input type="radio" name="chk_${i}" value="لا ينطبق"> ${T('لا ينطبق')}</label>
        </div>
      </div>`;
    }).join('');
    return `<div id="${sectionId}_wrap"><div class="chk-section-label u-flex u-items-center"><span>${T(section.sectionTitle)}</span>${toggleHtml}</div><div id="${sectionId}_content">${rows}</div></div>`;
  }
  const checklistHtml =
    buildSectionHtml(HSE_CHECKLIST.general) +
    buildSectionHtml(HSE_CHECKLIST.oilDischarge) +
    buildSectionHtml(HSE_CHECKLIST.specialMaterial);
  const totalChkItems = chkGlobalIndex;

  const formArea = document.getElementById('formArea');
  if (!formArea) return;

  formArea.innerHTML = `
    <div class="type-picker">
      <div class="type-picker-label">${T("نوع الطلب")} <span class="req-star">*</span></div>
      <div class="filters">${typeChips()}</div>
    </div>

    <div class="ticket">
      <div class="ticket-head">
        <span class="ttype">${T(type.fullLabel)}</span>
        <span class="tnum">NEW REQUEST</span>
      </div>
      <div class="perf"></div>
      <div class="ticket-body">

        <div class="section-title">${T("بيانات الطلب")}</div>
        <div class="row2">
          <div class="field">
            <label>${T("الإدارة الطالبة / القسم")} <span class="req-star">*</span></label>
            <input id="f_dept" type="text" readonly style="background-color: var(--surface-3);" placeholder="${T("سيتم تعبئته تلقائياً")}">
          </div>
          <div class="field">
            <label>${T("الوردية")} <span class="req-star">*</span></label>
            <select id="f_shift">${SHIFTS.map(s=>`<option value="${s}">${T(s)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>${T("تاريخ التنفيذ")} <span class="req-star">*</span></label>
            <input id="f_date" type="date">
          </div>
          <div class="field">
            <label>${T("رقم طلب سابق لنفس العمل (إن وجد)")}</label>
            <input id="f_prev" type="text" placeholder="${T("اختياري")}">
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>${T("من الساعة")} <span class="req-star">*</span></label>
            <input id="f_from" type="time" required>
          </div>
          <div class="field">
            <label>${T("إلى الساعة")} <span class="req-star">*</span></label>
            <input id="f_to" type="time" required>
            <label class="custom-pill-check u-inline-flex u-items-center u-gap-2 u-mt-2" style="cursor: pointer; user-select: none">
              <span class="u-fs-md u-c-text-2 u-fw-500">${T("نهاية مفتوحة / حتى انتهاء العمل")}</span>
              <input type="checkbox" id="f_open_end" class="pill-checkbox-input" onchange="window.toggleOpenEnd(this)">
              <span class="pill-checkbox-box"></span>
            </label>
          </div>
        </div>

        <div class="section-title">${T("بيانات مقدّم الطلب (مسئول التنفيذ)")}</div>
        <div class="field">
          <label>${T("الكود الوظيفي")} <small class="u-fw-400 u-c-text-muted">${T("(اكتب كودك لتعبئة بياناتك تلقائياً)")}</small></label>
          <div class="u-flex u-gap-2 u-items-center">
            <input id="f_emp" type="text" placeholder="${T("مثال: EMP001")}"
                   style="letter-spacing:1.5px;"
                   oninput="this.value=this.value.toUpperCase()" onblur="lookupPermitEmpCode()">
          </div>
          <div class="u-fs-xs u-mt-1" id="f_empMsg" style="min-height: 14px"></div>
        </div>
        <div class="row2">
          <div class="field">
            <label>${T("الاسم")} <span class="req-star">*</span></label>
            <input id="f_name" type="text" placeholder="${T("الاسم بالكامل")}">
          </div>
          <div class="field">
            <label>${T("الصفة")}</label>
            <select id="f_kind"><option value="موظف">${T("موظف")}</option><option value="مقاول">${T("مقاول")}</option></select>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>${T("رقم التليفون")}</label>
            <input id="f_phone" type="tel" placeholder="01xxxxxxxxx">
          </div>
          <div class="field">
            <label>${T("المسمى الوظيفي")}</label>
            <input id="f_jobTitle" type="text" placeholder="${T("اختياري")}">
          </div>
        </div>

        <div class="section-title">${T("تفاصيل العمل")}</div>
        <div class="field">
          <label>${T("وصف العملية")} <span class="req-star">*</span></label>
          <textarea id="f_desc" placeholder="${T("اشرح طبيعة العمل المطلوب تنفيذه")}"></textarea>
        </div>
        <div class="field">
          <label>${T("مكان العمل")} <span class="req-star">*</span></label>
          <select id="workLocationSelect" name="workLocation" required>
            <option value="">${T("اختر مكان العمل...")}</option>
            ${WORK_LOCATIONS.map(loc => `<option value="${loc}">${loc}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>${T("المعدة / الماكينة / العملية")}</label>
          <input id="f_equip" type="text" placeholder="${T("اختياري")}">
        </div>
        <div class="field">
          <label>${T("الأدوات والعدد")} <small class="u-fw-400 u-c-text-muted">${T("(بعد فحصها وقبولها)")}</small></label>
          <div class="tools-checklist" id="toolsChecklist">
            ${TOOLS_LIST.map((tool, i) => `
            <label class="tool-check-label">
              <input type="checkbox" id="tool_${i}" value="${tool}" class="tool-checkbox">
              <span>${T(tool)}</span>
            </label>`).join('')}
            <div class="tool-other-wrap" id="toolOtherWrap" style="display:none;">
              <input type="text" id="tool_other_text" placeholder="${T("أدخل الأداة الأخرى...")}" class="tool-other-input">
            </div>
          </div>
        </div>
        <div class="field">
          <label>${T("أسماء القائمين بالعمل (كل اسم في سطر)")} <span class="req-star">*</span></label>
          <textarea id="f_workers" placeholder="1- ...&#10;2- ..."></textarea>
        </div>

        <div class="section-title">${T("قائمة التحقق (نعم / لا / لا ينطبق)")}</div>
        <div class="checklist" data-total-chk="${totalChkItems}">${checklistHtml}</div>
        <div class="field">
          <label>${T("ملاحظات على قائمة التحقق")}</label>
          <textarea id="f_checknote" placeholder="${T("اختياري")}"></textarea>
        </div>

        <div class="section-title">${T("تقييم المخاطر")}</div>
        <div id="riskRows"></div>
        <button type="button" class="btn btn-secondary btn-block form-add-row" onclick="addRiskRow()">${T("+ إضافة خطر")}</button>

        <button class="btn btn-primary btn-lg btn-block form-submit" id="submitBtn" onclick="submitPermit()">${T("إرسال الطلب للمشرف")}</button>
      </div>
    </div>
  `;
  document.getElementById('f_date').value = new Date().toISOString().split('T')[0];
  document.getElementById('riskRows').innerHTML = '';
  riskRowCount = 0;
  addRiskRow();
  addRiskRow();

  window.toggleOpenEnd = function(el) {
    const toInput = document.getElementById('f_to');
    if (el.checked) {
      toInput.value = '';
      toInput.disabled = true;
      toInput.style.backgroundColor = 'var(--surface-3)';
    } else {
      toInput.disabled = false;
      toInput.style.backgroundColor = '';
    }
  };

  autoFillForm();
  const toolCheckboxes = document.querySelectorAll('.tool-checkbox');
  toolCheckboxes.forEach(cb => {
    cb.addEventListener('change', function() {
      if (this.value === 'أخرى') {
        const wrap = document.getElementById('toolOtherWrap');
        if (wrap) wrap.style.display = this.checked ? 'block' : 'none';
      }
    });
  });
}

function addRiskRow(){
  if(riskRowCount >= 5) return;
  riskRowCount++;
  const id = 'risk_'+riskRowCount;
  const div = document.createElement('div');
  div.className = 'risk-row';
  div.id = id;
  div.innerHTML = `
    <div class="field"><label>${T("مصدر الخطر")}</label><input class="risk-source" type="text" placeholder="${T("مثال: سقوط من ارتفاع")}"></div>
    <div class="row2 u-items-end">
      <div class="field"><label>${T("الاحتمالية L (1-5)")}</label><select class="risk-l" onchange="calcRisk(this)">${RISK_LEVELS.map(n=>`<option value="${n}">${n}</option>`).join('')}</select></div>
      <div class="field"><label>${T("الشدة S (1-5)")}</label><select class="risk-s" onchange="calcRisk(this)">${RISK_LEVELS.map(n=>`<option value="${n}">${n}</option>`).join('')}</select></div>
      <div class="risk-badge u-mb-3"></div>
    </div>
    <div class="field"><label>${T("إجراءات التحكم والوقاية")}</label><textarea class="risk-control" placeholder="${T("اختياري")}"></textarea></div>
  `;
  document.getElementById('riskRows').appendChild(div);
  calcRisk(div.querySelector('.risk-l'));
}

function calcRisk(el) {
  const row = el.closest('.risk-row');
  const l = parseInt(row.querySelector('.risk-l').value) || 1;
  const s = parseInt(row.querySelector('.risk-s').value) || 1;
  const score = l * s;
  const badge = row.querySelector('.risk-badge');

  badge.className = 'risk-badge';
  if (score <= 4) {
    badge.textContent = T('خطورة ضعيفة 🟢');
    badge.classList.add('risk-low');
  } else if (score <= 12) {
    badge.textContent = T('خطورة متوسطة 🟡');
    badge.classList.add('risk-medium');
  } else {
    badge.textContent = T('خطورة عالية 🔴');
    badge.classList.add('risk-high');
  }
}

function collectChecklist(){
  const results = [];
  let idx = 0;
  for (const secKey of ['general','oilDischarge','specialMaterial']) {
    const section = HSE_CHECKLIST[secKey];
    for (const q of section.items) {
      const sel = document.querySelector(`input[name="chk_${idx}"]:checked`);
      results.push({
        section: section.sectionTitle,
        question: q,
        answer: sel ? sel.value : T('لا ينطبق')
      });
      idx++;
    }
  }
  return results;
}

function collectTools(){
  const checked = [];
  document.querySelectorAll('.tool-checkbox:checked').forEach(cb => {
    if (cb.value === 'أخرى') {
      const otherText = document.getElementById('tool_other_text');
      const val = otherText ? otherText.value.trim() : '';
      checked.push(val ? `${T("أخرى:")} ${val}` : 'أخرى');
    } else {
      checked.push(cb.value);
    }
  });
  return checked;
}
function collectRisks(){
  const rows = document.querySelectorAll('#riskRows .risk-row');
  const risks = [];
  rows.forEach(r=>{
    const source = r.querySelector('.risk-source').value.trim();
    if(!source) return;
    const l = parseInt(r.querySelector('.risk-l').value);
    const s = parseInt(r.querySelector('.risk-s').value);
    const control = r.querySelector('.risk-control').value.trim();
    risks.push({ source, l, s, score: l*s, control });
  });
  return risks;
}

async function submitPermit(){
  const name = document.getElementById('f_name').value.trim();
  const dept = document.getElementById('f_dept').value;
  const date = document.getElementById('f_date').value;
  const timeFrom = document.getElementById('f_from').value;
  const timeTo = document.getElementById('f_to').value;
  const openEnd = document.getElementById('f_open_end') ? document.getElementById('f_open_end').checked : false;
  const desc = document.getElementById('f_desc').value.trim();
  const loc = document.getElementById('workLocationSelect').value;
  const workers = document.getElementById('f_workers').value.trim();

  const missingFields = [];

  if(!loc) missingFields.push(T('مكان العمل'));
  if(!desc) missingFields.push(T('وصف العملية'));
  if(!date) missingFields.push(T('تاريخ التنفيذ'));
  if(!timeFrom) missingFields.push(T('وقت البدء'));
  if(!timeTo && !openEnd) missingFields.push(T('وقت الانتهاء'));
  if(!workers) missingFields.push(T('أسماء القائمين بالعمل'));

  if(!name) missingFields.push(T('اسم مقدم الطلب'));
  if(!dept) missingFields.push(T('الإدارة الطالبة / القسم'));

  const risks = collectRisks();
  if (risks.length < 2 || !risks[0].source || !risks[0].control || !risks[1].source || !risks[1].control) {
    missingFields.push(T('تقييم المخاطر (الخطر 1 و 2 وإجراءات الوقاية)'));
  }

  if (missingFields.length > 0) {
    showToast(T('برجاء استكمال الحقول المطلوبة التالية:\n• ') + missingFields.join('\n• '), 'error');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = T('جارِ الإرسال…');

  const type = PERMIT_TYPES[selectedType];
  const permit = {
    id: '',
    typeKey: selectedType,
    typeLabel: type.label,
    typeFullLabel: type.fullLabel,
    department: dept,
    shift: document.getElementById('f_shift').value,
    date: date,
    previousPermitNo: document.getElementById('f_prev').value.trim(),
    timeFrom: timeFrom,
    timeTo: openEnd ? T('نهاية مفتوحة') : timeTo,
    workerName: name,
    requesterKind: document.getElementById('f_kind').value,
    requesterPhone: document.getElementById('f_phone').value.trim(),
    employeeId: document.getElementById('f_emp').value.trim(),
    description: desc,
    location: loc,
    equipment: document.getElementById('f_equip').value.trim(),
    tools: collectTools(),
    workersNames: document.getElementById('f_workers').value.trim(),
    checklist: collectChecklist(),
    checklistNote: document.getElementById('f_checknote').value.trim(),
    risks: collectRisks(),
    status: 'pending_dept',
    reviewedBy: '',
    areaHeadReviewedBy: '',
    safetyOfficerName: '',
    areaManagerName: '',
    reviewNote: '',
    submittedAt: new Date().toISOString(),
    reviewedAt: '',
    closure: null
  };
  let ok = false;
  try {
    const res = await authFetch('/api/permits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permit })
    });
    const data = await res.json().catch(() => ({}));
    ok = !!(res.ok && data.permit);
    if (ok) permit.id = data.permit.id;
  } catch (e) { ok = false; }

  if(!ok){
    btn.disabled = false;
    btn.textContent = T('إرسال الطلب للمشرف');
    showToast(T('حصل خطأ في الإرسال، حاول تاني'), 'error');
    return;
  }

  document.getElementById('formArea').innerHTML = `
    <div class="ticket">
      <div class="confirm">
        <div class="u-fs-3xl">✅</div>
        <h2>${T("تم إرسال الطلب")}</h2>
        <div class="tnum-big">${escapeHtml(permit.id)}</div>
        <span class="stamp pending big-stamp">${T("قيد الانتظار")}</span>
        <p>${T(type.fullLabel)} ${T("— هيوصل الطلب للمشرف على طول عشان يوافق عليه")}</p>
        <p class="u-fs-sm u-c-text-muted u-mt-3">${T("احتفظ برقم الطلب ده — اضغط زر")} "${T("تتبع الطلب ده")}" ${T("أو افتح تاب")} "${T("📁 سجل طلباتي")}" ${T("عشان تعرف حالته أول ما المشرف يرد")}</p>
        <div class="btn-row confirm-actions">
          <button class="btn btn-primary" onclick="renderForm()">${T("+ طلب جديد")}</button>
          <button class="btn btn-secondary" onclick="goTrackWithId(${jsArg(permit.id)})">${T("📁 سجل طلباتي")}</button>
        </div>
      </div>
    </div>
  `;
}

function goTrackWithId(permitId){
  switchTab('myhistory');
  setTimeout(() => {
    const el = document.querySelector(`.phc-id`);
    if(el && el.textContent.trim() === permitId) {
      el.closest('.permit-history-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 600);
}
