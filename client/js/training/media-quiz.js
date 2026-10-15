// Lecture recordings and quizzes: admin quiz builder, worker recording/quiz modals and attendance tools.

let _quizBuilderState = { trainingId: null, questions: [] };

function openTrainingMediaModal(trainingId) {
  const trn = (_allAdminTrainings || []).find(t => t.id === trainingId);
  if (!trn) { alert(T('تعذر إيجاد المحاضرة')); return; }
  _quizBuilderState = {
    trainingId,
    questions: (trn.quiz && Array.isArray(trn.quiz.questions))
      ? trn.quiz.questions.map(q => ({ text: q.text, options: [...q.options], correctIndex: q.correctIndex }))
      : []
  };
  const passThreshold = (trn.quiz && trn.quiz.passThreshold) || 70;
  const recordingUrl = (trn.recording && trn.recording.url) || '';
  const reviewWindowDays = Number.isFinite(trn.reviewWindowDays) ? trn.reviewWindowDays : 30;

  let reviewSummary = T('المحاضرة لسه مش مقفولة — المهلة بتبدأ تتحسب من لحظة القفل.');
  if (trn.closedAt) {
    if (!reviewWindowDays) {
      reviewSummary = T('بدون حد — التسجيل والاختبار متاحين للعامل للأبد.');
    } else {
      const deadline = new Date(new Date(trn.closedAt).getTime() + reviewWindowDays * 86400000);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
      reviewSummary = daysLeft > 0
        ? `${T('باقي')} ${daysLeft} ${T('يوم على انتهاء المراجعة')} (${deadline.toLocaleDateString('ar-EG')})`
        : T('⚠️ انتهت مدة المراجعة — العامل مايقدرش يشوف التسجيل ولا ياخد الاختبار دلوقتي.');
    }
  }

  const html = `
    <h3 style="margin-top:0;">🎥 ${T('تسجيل ومسابقة')} — ${escapeHtml(trn.title)}</h3>

    <div class="qm-section">
      <div class="app-modal-field">
        <label>${T("رابط تسجيل المحاضرة (يوتيوب غير مُدرج / درايف / أي رابط https)")}</label>
        <input type="text" id="qmRecordingUrl" value="${escapeHtml(recordingUrl)}" placeholder="https://..." />
      </div>
      <div class="app-modal-field">
        <label>${T("أو ارفع ملف فيديو مباشرة (حتى ~1.5 جيجا — لتسجيلات أكبر استخدم رابط)")}</label>
        <input type="file" id="qmRecordingFile" accept="video/*" onchange="qmFilePicked(this)" />
        <div id="qmFileInfo" class="qm-file-info"></div>
      </div>
      <div id="qmUploadProgressWrap" class="qm-progress-wrap" hidden>
        <div class="qm-progress-bar"><div id="qmUploadProgressFill" class="qm-progress-fill" style="width:0%"></div></div>
        <div id="qmUploadProgressText" class="qm-progress-text">0%</div>
      </div>
      <div class="app-modal-error" id="qmRecordingMsg"></div>
      <div class="app-modal-actions" style="margin-bottom:4px;">
        <button class="submit-btn" type="button" id="qmSaveRecordingBtn" onclick="saveTrainingRecording(${jsArg(trn.id)})">${T("💾 حفظ التسجيل")}</button>
      </div>
    </div>

    <hr class="qm-divider">

    <div class="qm-section">
      <h4 class="qm-section-title">📝 ${T("اختبار المحاضرة")}</h4>
      <div class="app-modal-field">
        <label>${T("نسبة النجاح المطلوبة % (العامل اللي ماياخدهاش يتلغي تأكيد حضوره)")}</label>
        <input type="number" id="qmPassThreshold" min="0" max="100" value="${escapeHtml(String(passThreshold))}" />
      </div>
      <div id="qmQuestionsList"></div>
      <button class="um-btn" type="button" onclick="qmAddQuestion()">${T("➕ إضافة سؤال")}</button>
      <div class="app-modal-error" id="qmQuizMsg"></div>
      <div class="app-modal-actions" style="margin-bottom:4px;">
        <button class="submit-btn" type="button" onclick="saveTrainingQuiz(${jsArg(trn.id)})">${T("💾 حفظ الاختبار")}</button>
      </div>
    </div>

    <hr class="qm-divider">

    <div class="qm-section">
      <h4 class="qm-section-title">🔓 ${T("إعادة فتح الاختبار")}</h4>
      <p class="qm-hint">${T("الاختبار مرة واحدة بس افتراضيًا لكل عامل. هنا تقدر تفتحه تاني للكل، أو لعامل واحد بالتحديد.")}</p>
      <div class="qm-btn-row">
        <button class="um-btn" type="button" onclick="reopenTrainingQuiz(${jsArg(trn.id)}, 'all')">${T("🔓 فتح للكل")}</button>
        <button class="um-btn" type="button" onclick="reopenTrainingQuiz(${jsArg(trn.id)}, 'worker')">${T("🔓 فتح لعامل معيّن")}</button>
      </div>
      <div class="app-modal-error" id="qmReopenMsg"></div>
    </div>

    <hr class="qm-divider">

    <div class="qm-section">
      <h4 class="qm-section-title">⏳ ${T("مدة إتاحة المراجعة للعامل")}</h4>
      <p class="qm-hint">${T("بعد قفل المحاضرة، لحد كام يوم العامل يقدر يشوف التسجيل ويعمل/يعيد الاختبار؟ (0 = بدون حد)")}</p>
      <p class="qm-review-summary">${reviewSummary}</p>
      <div class="qm-btn-row">
        <input type="number" id="qmReviewWindowDays" min="0" max="365" value="${reviewWindowDays}" style="max-width:110px;">
        <button class="um-btn" type="button" onclick="saveReviewWindow(${jsArg(trn.id)})">${T("💾 حفظ المهلة")}</button>
      </div>
      <div class="app-modal-error" id="qmReviewWindowMsg"></div>
    </div>
  `;
  openAppModal(html);
  qmRenderQuestions();
}

function qmShowMsg(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--danger-text)' : 'var(--success-text)';
  el.style.display = text ? 'block' : 'none';
}

function qmFilePicked(input) {
  const info = document.getElementById('qmFileInfo');
  if (!info) return;
  const file = input.files && input.files[0];
  if (!file) { info.textContent = ''; return; }
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  info.textContent = `${file.name} — ${mb} ${T('ميجا')}`;
}

async function saveReviewWindow(trainingId) {
  const days = parseInt(document.getElementById('qmReviewWindowDays').value, 10);
  try {
    const res = await authFetch(`/api/trainings/${trainingId}/review-window`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: Number.isFinite(days) ? days : 30 })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      qmShowMsg('qmReviewWindowMsg', T('✅ تم حفظ المهلة'), false);
      loadAdminTraining(true);
    } else {
      qmShowMsg('qmReviewWindowMsg', data.error || T('حصل خطأ'), true);
    }
  } catch (e) {
    qmShowMsg('qmReviewWindowMsg', T('خطأ في الاتصال'), true);
  }
}

function qmRenderQuestions() {
  const wrap = document.getElementById('qmQuestionsList');
  if (!wrap) return;
  wrap.innerHTML = _quizBuilderState.questions.map((q, qi) => `
    <div class="qm-q-card">
      <div class="qm-q-card-head">
        <span class="qm-q-badge">${qi + 1}</span>
        <input type="text" class="qm-q-text" value="${escapeHtml(q.text)}" placeholder="${T("نص السؤال")}" onchange="qmUpdateQuestionText(${qi}, this.value)" />
        <button type="button" class="qm-q-del" onclick="qmRemoveQuestion(${qi})" title="${T('حذف السؤال')}">🗑️</button>
      </div>
      <div class="qm-q-options">
        ${[0, 1, 2, 3].map(oi => `
          <label class="qm-q-option ${q.correctIndex === oi ? 'is-correct' : ''}">
            <input type="radio" name="qmCorrect${qi}" ${q.correctIndex === oi ? 'checked' : ''} onchange="qmSetCorrect(${qi}, ${oi})" title="${T('الإجابة الصحيحة')}">
            <input type="text" value="${escapeHtml(q.options[oi] || '')}" placeholder="${T("خيار")} ${oi + 1}" onchange="qmUpdateOption(${qi}, ${oi}, this.value)">
          </label>
        `).join('')}
      </div>
    </div>
  `).join('') || `<div class="empty">${T('مفيش أسئلة لسه — دوس "إضافة سؤال"')}</div>`;
}
function qmAddQuestion() {
  _quizBuilderState.questions.push({ text: '', options: ['', '', '', ''], correctIndex: 0 });
  qmRenderQuestions();
}
function qmRemoveQuestion(i) {
  _quizBuilderState.questions.splice(i, 1);
  qmRenderQuestions();
}
function qmUpdateQuestionText(i, val) { _quizBuilderState.questions[i].text = val; }
function qmUpdateOption(i, oi, val) { _quizBuilderState.questions[i].options[oi] = val; }
function qmSetCorrect(i, oi) { _quizBuilderState.questions[i].correctIndex = oi; qmRenderQuestions(); }

async function saveTrainingRecording(trainingId) {
  const url = document.getElementById('qmRecordingUrl').value.trim();
  const fileInput = document.getElementById('qmRecordingFile');
  const file = fileInput && fileInput.files && fileInput.files[0];
  qmShowMsg('qmRecordingMsg', '', false);

  if (file) {
    if (file.size > 1536 * 1024 * 1024) {
      qmShowMsg('qmRecordingMsg', T('حجم الملف أكبر من 1.5 جيجا — استخدم رابط فيديو خارجي بدل كده'), true);
      return;
    }
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const progressWrap = document.getElementById('qmUploadProgressWrap');
    const progressFill = document.getElementById('qmUploadProgressFill');
    const progressText = document.getElementById('qmUploadProgressText');
    const saveBtn = document.getElementById('qmSaveRecordingBtn');
    if (progressWrap) progressWrap.hidden = false;
    if (saveBtn) saveBtn.disabled = true;

    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/trainings/${trainingId}/recording/upload?ext=${encodeURIComponent(ext)}`);
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          if (progressFill) progressFill.style.width = pct + '%';
          if (progressText) progressText.textContent = pct + '%';
        };
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.error || T('حصل خطأ')));
          }
        };
        xhr.onerror = () => reject(new Error(T('خطأ في الاتصال')));
        xhr.send(file);
      });
      qmShowMsg('qmRecordingMsg', T('✅ تم حفظ التسجيل'), false);
      loadAdminTraining(true);
    } catch (e) {
      qmShowMsg('qmRecordingMsg', e.message || T('حصل خطأ'), true);
    } finally {
      if (progressWrap) progressWrap.hidden = true;
      if (saveBtn) saveBtn.disabled = false;
    }
  } else if (url) {
    try {
      const res = await authFetch(`/api/trainings/${trainingId}/recording`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: url })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        qmShowMsg('qmRecordingMsg', T('✅ تم حفظ التسجيل'), false);
        loadAdminTraining(true);
      } else {
        qmShowMsg('qmRecordingMsg', data.error || T('حصل خطأ'), true);
      }
    } catch (e) {
      qmShowMsg('qmRecordingMsg', T('خطأ في الاتصال'), true);
    }
  } else {
    qmShowMsg('qmRecordingMsg', T('حط رابط فيديو أو ارفع ملف'), true);
  }
}

async function saveTrainingQuiz(trainingId) {
  const passThreshold = parseInt(document.getElementById('qmPassThreshold').value, 10) || 70;
  const questions = _quizBuilderState.questions.map(q => ({
    text: (q.text || '').trim(),
    options: (q.options || []).map(o => (o || '').trim()).filter(Boolean),
    correctIndex: q.correctIndex
  }));
  if (!questions.length) {
    qmShowMsg('qmQuizMsg', T('ضيف سؤال واحد على الأقل'), true);
    return;
  }
  try {
    const res = await authFetch(`/api/trainings/${trainingId}/quiz`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passThreshold, questions })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      qmShowMsg('qmQuizMsg', T('✅ تم حفظ الاختبار'), false);
      loadAdminTraining(true);
    } else {
      qmShowMsg('qmQuizMsg', data.error || T('حصل خطأ'), true);
    }
  } catch (e) {
    qmShowMsg('qmQuizMsg', T('خطأ في الاتصال'), true);
  }
}

async function reopenTrainingQuiz(trainingId, scope) {
  let empCode = '';
  if (scope === 'worker') {
    empCode = prompt(T('كود العامل:'));
    if (!empCode || !empCode.trim()) return;
  }
  const timesStr = prompt(T('كام محاولة إضافية؟ (سيب فاضي = 1)'), '1');
  if (timesStr === null) return;
  const times = parseInt(timesStr, 10) || 1;
  try {
    const res = await authFetch(`/api/trainings/${trainingId}/quiz/reopen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, empCode: (empCode || '').trim(), times })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      qmShowMsg('qmReopenMsg', T('✅ تم فتح الاختبار'), false);
    } else {
      qmShowMsg('qmReopenMsg', data.error || T('حصل خطأ'), true);
    }
  } catch (e) {
    qmShowMsg('qmReopenMsg', T('خطأ في الاتصال'), true);
  }
}

function openWorkerRecordingModal(url) {
  if (!url) return;
  const isLocalFile = url.startsWith('/uploads/trainings/');
  const html = isLocalFile
    ? `
      <h3 style="margin-top:0;">🎥 ${T("تسجيل المحاضرة")}</h3>
      <video controls preload="metadata" class="wq-video-player" src="${escapeHtml(url)}"></video>
    `
    : `
      <h3 style="margin-top:0;">🎥 ${T("تسجيل المحاضرة")}</h3>
      <p style="font-size:13px; color:var(--text-muted);">${T("التسجيل ده رابط خارجي — هيتفتح في تاب جديد.")}</p>
      <div class="app-modal-actions">
        <a class="submit-btn" style="text-decoration:none; text-align:center;" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${T("🔗 فتح التسجيل")}</a>
      </div>
    `;
  openAppModal(html);
}

let _workerQuizState = { trainingId: null, questions: [], answers: [] };

async function openWorkerQuizModal(trainingId) {
  try {
    const res = await authFetch(`/api/trainings/${trainingId}/quiz`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.reviewExpired) {
        openAppModal(`
          <h3 style="margin-top:0;">📝 ${T("اختبار المحاضرة")}</h3>
          <p class="wq-expired-note">⏳ ${T("انتهت مدة إتاحة هذا الاختبار للمراجعة.")}</p>
        `);
        return;
      }
      alert(data.error || T('تعذر تحميل الاختبار'));
      return;
    }
    _workerQuizState = { trainingId, questions: data.questions || [], answers: new Array((data.questions || []).length).fill(null) };
    if (!data.canAttempt) {
      openAppModal(`
        <h3 style="margin-top:0;">📝 ${T("اختبار المحاضرة")}</h3>
        <p>${T("استنفدت عدد محاولات الاختبار المسموح بها.")} ${data.myAttempt ? (T('آخر نتيجة: ') + data.myAttempt.lastScore + '%') : ''}</p>
        <p style="font-size:13px; color:var(--text-muted);">${T("اطلب من مسؤول السلامة يفتحلك محاولة إضافية.")}</p>
      `);
      return;
    }
    renderWorkerQuizModal(data.passThreshold, data.remainingAttempts);
  } catch (e) {
    alert(T('خطأ في الاتصال'));
  }
}

function renderWorkerQuizModal(passThreshold, remainingAttempts) {
  const total = _workerQuizState.questions.length;
  const html = `
    <h3 style="margin-top:0;">📝 ${T("اختبار المحاضرة")}</h3>
    <div class="wq-meta-row">
      <span class="wq-meta-chip">🎯 ${T("نسبة النجاح")}: ${passThreshold}%</span>
      <span class="wq-meta-chip">🔁 ${T("المحاولات المتبقية")}: ${remainingAttempts}</span>
    </div>
    <div id="wqQuestionsList">
      ${_workerQuizState.questions.map((q, qi) => `
        <div class="wq-q-card">
          <div class="wq-q-title"><span class="wq-q-badge">${qi + 1}</span> ${escapeHtml(q.text)}</div>
          <div class="wq-q-options">
            ${q.options.map((opt, oi) => `
              <label class="wq-q-option" id="wqOpt${qi}_${oi}">
                <input type="radio" name="wqAnswer${qi}" onchange="wqSetAnswer(${qi}, ${oi})">
                <span>${escapeHtml(opt)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    <p id="wqProgressNote" class="wq-progress-note">${T("جاوبت على")} 0 ${T("من")} ${total}</p>
    <div class="app-modal-error" id="wqMsg"></div>
    <div class="app-modal-actions">
      <button class="submit-btn" type="button" onclick="submitWorkerQuiz()">${T("✅ تسليم الإجابات")}</button>
    </div>
  `;
  openAppModal(html);
}

function wqSetAnswer(qi, oi) {
  _workerQuizState.answers[qi] = oi;
  const optionsWrap = document.querySelectorAll(`[id^="wqOpt${qi}_"]`);
  optionsWrap.forEach(el => el.classList.remove('is-selected'));
  const chosen = document.getElementById(`wqOpt${qi}_${oi}`);
  if (chosen) chosen.classList.add('is-selected');
  const answered = _workerQuizState.answers.filter(a => a !== null).length;
  const note = document.getElementById('wqProgressNote');
  if (note) note.textContent = `${T("جاوبت على")} ${answered} ${T("من")} ${_workerQuizState.questions.length}`;
}

async function submitWorkerQuiz() {
  if (_workerQuizState.answers.some(a => a === null)) {
    qmShowMsg('wqMsg', T('جاوب على كل الأسئلة الأول'), true);
    return;
  }
  try {
    const res = await authFetch(`/api/trainings/${_workerQuizState.trainingId}/quiz/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: _workerQuizState.answers })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const resultHtml = data.passed
        ? `<div class="wq-result-hero wq-result-pass"><div class="wq-result-icon">🎉</div><h3>${T("مبروك، نجحت!")}</h3><p class="wq-result-score">${data.score}%</p></div>`
        : `<div class="wq-result-hero wq-result-fail"><div class="wq-result-icon">❌</div><h3>${T("للأسف رسبت")}</h3><p class="wq-result-score">${data.score}% <span class="wq-result-required">(${T("المطلوب")} ${data.passThreshold}%)</span></p><p class="wq-hint">${T("تم إلغاء تأكيد حضورك. اطلب من مسؤول السلامة يفتحلك الاختبار تاني لو محتاج تعيد.")}</p></div>`;
      openAppModal(resultHtml);
      loadWorkerTraining();
    } else if (data.reviewExpired) {
      qmShowMsg('wqMsg', T('انتهت مدة إتاحة هذا الاختبار للمراجعة.'), true);
    } else {
      qmShowMsg('wqMsg', data.error || T('حصل خطأ'), true);
    }
  } catch (e) {
    qmShowMsg('wqMsg', T('خطأ في الاتصال'), true);
  }
}

async function toggleTrnVerification(id, empCode, verified) {
  try {
    const res = await authFetch(`/api/trainings/${id}/verify-attendee`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode, verified })
    });
    if (res.ok) loadAdminTraining(true);
  } catch(e) {}
}

async function addManualTrnAttendee(id) {
  const empCode = window.prompt(T('من فضلك أدخل الكود الوظيفي للموظف المطلوب تسجيل حضوره:'));
  if (!empCode || !empCode.trim()) return;
  try {
    const res = await authFetch(`/api/trainings/${id}/add-attendee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode: empCode.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      loadAdminTraining(true);
    } else {
      showToast(data.error || T('تعذّر تسجيل الحضور'), 'error');
    }
  } catch(e) {
    showToast(T('لا يوجد اتصال بالسيرفر'), 'error');
  }
}

async function exportTrainingExcel(sessionId) {
  try {
    const token = typeof getToken === 'function' ? getToken() : localStorage.getItem('ep_token');
    const res = await fetch(`/api/trainings/${sessionId}/export-excel`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error(T('فشل تصدير الملف'));
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${T("كشف_حضور_")}${sessionId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    showToast(T('حدث خطأ أثناء تصدير ملف الإكسيل'), 'error');
  }
}
