'use strict';

// Content of the printable permit, hazard report and drill report documents.

const PERMIT_STATUS = {
  pending: { label: 'قيد المراجعة', tone: 'warning' },
  pending_dept: { label: 'بانتظار أدمن القسم', tone: 'warning' },
  pending_hse: { label: 'بانتظار السلامة والصحة المهنية', tone: 'warning' },
  approved_area: { label: 'معتمد من مدير المنطقة', tone: 'info' },
  approved: { label: 'معتمد', tone: 'success' },
  active: { label: 'سارٍ', tone: 'success' },
  rejected: { label: 'مرفوض', tone: 'danger' },
  rejected_area: { label: 'مرفوض من رئيس القسم', tone: 'danger' },
  rejected_high_management: { label: 'مرفوض من الإدارة العليا', tone: 'danger' },
  completed: { label: 'مغلق / مكتمل', tone: 'neutral' },
};

const CLOSURE_TYPES = {
  safe: 'اكتمل بأمان', completed: 'اكتمل بأمان', incomplete: 'لم يكتمل', forced: 'إغلاق جبري', force: 'إغلاق جبري',
};

function permitStatus(status) {
  const key = String(status || '').toLowerCase().trim();
  if (key.startsWith('closed')) return { label: 'مغلق', tone: 'neutral' };
  return PERMIT_STATUS[key] || { label: status || 'غير محدد', tone: 'neutral' };
}

const HAZARD_STATUS = {
  open: { label: 'مفتوح', tone: 'danger' },
  notified: { label: 'تم الإبلاغ', tone: 'danger' },
  in_progress: { label: 'جاري المعالجة', tone: 'warning' },
  assigned_to_maintenance: { label: 'محوَّل للصيانة', tone: 'warning' },
  closed: { label: 'مغلق', tone: 'success' },
  resolved: { label: 'تمت المعالجة', tone: 'success' },
  rejected: { label: 'مرفوض', tone: 'neutral' },
  rejected_by_hse: { label: 'مرفوض من السلامة', tone: 'neutral' },
  rejected_by_maintenance: { label: 'مرفوض من الصيانة', tone: 'neutral' },
};

function hazardStatus(status) {
  const key = String(status || '').toLowerCase().trim();
  if (HAZARD_STATUS[key]) return HAZARD_STATUS[key];
  if (/مغلق|closed/.test(key)) return HAZARD_STATUS.closed;
  if (/جاري|progress/.test(key)) return HAZARD_STATUS.in_progress;
  if (/مفتوح|open/.test(key)) return HAZARD_STATUS.open;
  return { label: status || 'غير محدد', tone: 'neutral' };
}

const LIKELIHOOD = { 1: 'غير ممكن حدوثه', 2: 'احتمالية ضئيلة', 3: 'احتمالية متوسطة', 4: 'احتمالية عالية', 5: 'أكيدة الحدوث' };
const SEVERITY = { A: 'بسيط / إسعاف أولي', B: 'علاج طبي', C: 'إصابة بغياب أقل من 30 يوم', D: 'إصابة بغياب 30 يوم أو أكثر', E: 'وفاة' };

const { localDate: fmtDate, localDateTime: fmtDateTime } = require('./print-template');

function buildPermitPrint(p, extra = {}) {
  const status = permitStatus(p.status);
  const sections = [];

  sections.push({
    title: 'بيانات التصريح',
    kind: 'grid',
    rows: [
      ['رقم التصريح', p.id],
      ['نوع التصريح', p.typeFullLabel || p.typeLabel],
      ['القسم / الإدارة الطالبة', p.department],
      ['الوردية', p.shift],
      ['تاريخ التنفيذ', fmtDate(p.date)],
      ['التوقيت', (p.timeFrom || p.timeTo) ? `من ${p.timeFrom || '—'} إلى ${p.timeTo || 'انتهاء العمل'}` : ''],
      ['مكان العمل', p.location],
      ['المعدة / الماكينة', p.equipment],
      ['رقم تصريح سابق لنفس العمل', p.previousPermitNo],
      ['تاريخ تقديم الطلب', fmtDateTime(p.createdAt)],
    ],
  });

  sections.push({
    title: 'مسئول التنفيذ والقائمين بالعمل',
    kind: 'grid',
    rows: [
      ['مسئول التنفيذ', p.workerName],
      ['الكود الوظيفي', p.employeeId],
      ['الصفة', p.requesterKind],
      ['رقم التليفون', p.requesterPhone],
      ['القائمين بالعمل', String(p.workersNames || '').split(/\n+/).map(s => s.replace(/^\s*\d+\s*[-.)]\s*/, '').trim()).filter(Boolean).join('، '), 'wide'],
    ],
  });

  sections.push({ title: 'وصف العملية', kind: 'text', text: p.description || '' });

  if (Array.isArray(p.tools) && p.tools.length) {
    sections.push({ title: 'الأدوات والعِدد (بعد فحصها وقبولها)', kind: 'bullets', items: p.tools });
  }

  if (Array.isArray(p.risks) && p.risks.length) {
    sections.push({
      title: 'تقييم المخاطر',
      kind: 'table',
      columns: ['#', 'مصدر الخطر', 'الاحتمالية', 'الشدة', 'الدرجة', 'إجراءات التحكم'],
      numeric: [0, 2, 3, 4],
      rows: p.risks.map((r, i) => [i + 1, r.source, r.l, r.s, r.score, r.control]),
    });
  }

  if (Array.isArray(p.checklist) && p.checklist.length) {
    sections.push({
      title: 'قائمة التحقق',
      kind: 'table',
      columns: ['#', 'البند', 'الإجابة'],
      numeric: [0],
      rows: p.checklist.map((c, i) => {
        const a = String(c.answer || '');
        const cls = /^(نعم|yes)$/i.test(a) ? 'good' : (/^(لا|no)$/i.test(a) ? 'bad' : 'muted');
        return [i + 1, c.question, { html: `<span class="${cls}">${escHtml(a || '—')}</span>` }];
      }),
    });
    if (p.checklistNote) sections.push({ title: 'ملاحظات على قائمة التحقق', kind: 'text', text: p.checklistNote });
  }

  const approvals = [
    ['مراجعة أدمن القسم / رئيس المنطقة', p.areaHeadReviewedBy ? `${p.areaHeadReviewedBy}${p.areaHeadReviewedAt ? ' — ' + fmtDateTime(p.areaHeadReviewedAt) : ''}` : ''],
    ['اعتماد السلامة والصحة المهنية', (p.safetyOfficerName || p.reviewedBy) ? `${p.safetyOfficerName || p.reviewedBy}${p.reviewedAt ? ' — ' + fmtDateTime(p.reviewedAt) : ''}` : ''],
    ['مدير المنطقة', p.areaManagerName],
    ['ملاحظات المراجعة', p.reviewNote, 'wide'],
  ];
  sections.push({ title: 'الاعتمادات', kind: 'grid', rows: approvals });

  if (p.closure && (p.closure.type || p.closure.time)) {
    sections.push({
      title: 'إغلاق التصريح',
      kind: 'grid',
      rows: [
        ['نوع الإغلاق', CLOSURE_TYPES[p.closure.type] || p.closure.type],
        ['وقت الإغلاق', fmtDateTime(p.closure.time)],
        ['أُغلق بواسطة', p.closure.closedBy],
        ['السبب', p.closure.reason, 'wide'],
      ],
    });
  }

  sections.push({
    title: 'التوقيعات',
    kind: 'signatures',
    slots: [
      { role: 'مسئول التنفيذ', name: p.workerName },
      { role: 'أدمن القسم / رئيس المنطقة', name: p.areaHeadReviewedBy },
      { role: 'مسئول السلامة', name: p.safetyOfficerName || p.reviewedBy },
    ],
  });

  return {
    docTitle: 'تصريح عمل',
    title: `تصريح عمل — ${p.typeFullLabel || p.typeLabel || ''}`.replace(/ — $/, ''),
    subtitle: 'Work Permit',
    docNumber: p.id,
    status,
    sections,
    qrDataUrl: extra.qrDataUrl,
    qrCaption: 'امسح للتحقق من صلاحية التصريح',
    footerNote: p.isImportedLegacy ? 'تصريح مستورد من سجلات التصاريح الورقية/Excel القديمة.' : '',
    autoPrint: extra.autoPrint,
  };
}

function buildHazardPrint(h, extra = {}) {
  const status = hazardStatus(h.status);
  const sections = [];

  sections.push({
    title: 'بيانات البلاغ',
    kind: 'grid',
    rows: [
      ['رقم البلاغ', h.id],
      ['تاريخ الملاحظة', fmtDate(h.date || h.submittedAt)],
      ['اسم المُبلِّغ', h.reporterName],
      ['الكود الوظيفي', h.empCode],
      ['القسم', h.department],
      ['المكان / المنطقة', h.area],
    ],
  });

  sections.push({ title: 'وصف الخطورة', kind: 'text', text: h.description || '' });

  sections.push({
    title: 'تقييم الخطورة',
    kind: 'grid',
    rows: [
      ['الاحتمالية', h.likelihood ? `${h.likelihood} — ${LIKELIHOOD[h.likelihood] || ''}` : ''],
      ['الشدة', h.severity ? `${h.severity} — ${SEVERITY[h.severity] || ''}` : ''],
      ['مستوى الخطورة', h.riskLevel],
      ['الإصابة المحتملة', h.potentialInjury],
      ['الحل المقترح من المُبلِّغ', h.proposedSolution, 'wide'],
    ],
  });

  sections.push({
    title: 'المتابعة والمعالجة',
    kind: 'grid',
    rows: [
      ['مسئول السلامة', h.hseName],
      ['أُسند للصيانة', h.assignedToMaintenance],
      ['تمت المشاهدة', h.seenAt ? `${h.seenBy || ''} — ${fmtDateTime(h.seenAt)}` : ''],
      ['بدء المعالجة', (h.treatmentStartedAt || h.inProgressAt) ? `${h.startedByName || h.inProgressBy || ''} — ${fmtDateTime(h.treatmentStartedAt || h.inProgressAt)}` : ''],
      ['تاريخ الإغلاق', fmtDateTime(h.resolvedAt)],
      ['تاريخ التقديم', fmtDateTime(h.submittedAt)],
      ['الإجراء المتخذ', h.actionTaken, 'wide'],
    ],
  });

  if (h.photoUrl && extra.photoAbsUrl) {
    sections.push({
      title: 'صورة الخطر',
      kind: 'html',
      html: `<img src="${escHtml(extra.photoAbsUrl)}" alt="صورة الخطر" style="max-width:100%;max-height:95mm;border:1px solid #E5E7EB;border-radius:6px">`,
    });
  }

  if (h.afterPhotoUrl && extra.afterPhotoAbsUrl) {
    const by = [h.afterPhotoBy, fmtDateTime(h.afterPhotoAt)].filter(Boolean).join(' — ');
    sections.push({
      title: 'صورة بعد الإصلاح',
      kind: 'html',
      html: `<img src="${escHtml(extra.afterPhotoAbsUrl)}" alt="صورة بعد الإصلاح" style="max-width:100%;max-height:95mm;border:1px solid #E5E7EB;border-radius:6px">`
        + (by ? `<div style="font-size:9pt;color:#6B7280;margin-top:4px">${escHtml(by)}</div>` : ''),
    });
  }

  sections.push({
    title: 'التوقيعات',
    kind: 'signatures',
    slots: [
      { role: 'المُبلِّغ', name: h.reporterName },
      { role: 'مسئول السلامة', name: h.hseName },
      { role: 'مسئول الصيانة / التنفيذ', name: h.startedByName || h.inProgressBy },
    ],
  });

  return {
    docTitle: 'بلاغ خطورة',
    title: 'بلاغ خطورة',
    subtitle: 'Hazard Report',
    docNumber: h.id,
    status,
    sections,
    qrDataUrl: extra.qrDataUrl,
    qrCaption: 'امسح للتحقق من حالة البلاغ',
    autoPrint: extra.autoPrint,
  };
}

function buildDrillPrint(drill, report, extra = {}) {
  const r = report || {};
  const list = a => (Array.isArray(a) ? a : []).map(s => String(s || '').trim()).filter(Boolean);
  const attendees = (Array.isArray(drill.attendees) ? drill.attendees : []).filter(a => a && a.verified !== false);
  const time = [drill.startTime, drill.endTime].filter(Boolean).join(' — ');
  const sections = [];

  sections.push({
    title: 'بيانات التجربة',
    kind: 'grid',
    rows: [
      ['التجربة', drill.title],
      ['التاريخ', fmtDate(drill.date)],
      ['الوقت', time],
      ['المكان', drill.location],
      ['المسئول / المدرّب', drill.trainer],
      ['عدد الحضور', attendees.length ? String(attendees.length) : ''],
      ['السيناريو (الحادث الوهمي)', r.scenario, 'wide'],
    ],
  });
  sections.push({ title: 'الغرض من التجربة', kind: 'text', text: r.purpose || '' });
  sections.push({ title: 'تم إجراء التجربة كالآتي', kind: 'bullets', items: list(r.narrativeSteps), empty: 'لم تُسجَّل خطوات التنفيذ.' });
  sections.push({
    title: 'نتيجة التجربة',
    note: r.resultIntro || '',
    kind: 'bullets',
    items: list(r.resultPoints),
    empty: '—',
  });
  sections.push({ title: 'الإيجابيات', kind: 'bullets', items: list(r.positives), empty: 'لا يوجد.' });
  sections.push({ title: 'السلبيات', kind: 'bullets', items: list(r.negatives), empty: 'لا يوجد.' });
  sections.push({ title: 'نقاط للتحسين', kind: 'bullets', items: list(r.improvements), empty: 'لا يوجد.' });
  if (r.thanksNote) sections.push({ kind: 'text', text: r.thanksNote });

  if (attendees.length) {
    sections.push({
      title: `كشف الحضور (${attendees.length})`,
      kind: 'table',
      columns: ['#', 'الاسم', 'الكود', 'القسم'],
      numeric: [0, 2],
      rows: attendees.slice(0, 200).map((a, i) => [i + 1, a.name, a.empCode, a.department]),
    });
  }

  sections.push({
    title: 'الاعتماد',
    kind: 'signatures',
    slots: [
      { role: r.responsibleTitle || 'مسئول البيئة والسلامة', name: r.responsibleName, date: r.signatureDate || fmtDate(drill.date) },
      { role: 'مدير السلامة والصحة المهنية', name: '' },
    ],
  });

  const form = [r.formCode || 'SE-03-F1', r.formVersion || 'VER.NO.:3', r.formDate || 'VER. DATE :1/5/2015'].join('   ·   ');
  return {
    docTitle: 'تقرير تجربة طوارئ',
    pdfNameExtra: drill.title || '',
    title: 'تقرير تجربة طوارئ',
    subtitle: drill.title || 'Emergency Drill Report',
    docNumber: drill.id,
    status: String(drill.status || '') === 'closed' ? { label: 'تمت التجربة', tone: 'success' } : null,
    sections,
    footerNote: `نموذج ${form}`,
    autoPrint: extra.autoPrint,
  };
}

function escHtml(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { buildPermitPrint, buildHazardPrint, buildDrillPrint, permitStatus, hazardStatus, LIKELIHOOD, SEVERITY };
