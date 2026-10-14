'use strict';

// Statistics questions (counts, trends, compliance) over permits, hazards, trainings and penalties,
// limited to what the asker is allowed to see.

const { normalizeArabic, arCount } = require('../kb');
const {
  ADMIN_ROLES, arr, dataFor, dateOf, detectEmployee, detectEntity, detectPeriod, fmtDate, HAZ_OPEN,
  helpers, HOURS_48, MISSING_RE, n2, pct, PERMIT_PENDING, scopeLabel, scopeOf, SOURCE, WANT,
  withScopeNote,
} = require('./shared');
const { hazardsAnswer, permitsAnswer } = require('./records');
const {
  complianceAnswer, complianceData, drillsAnswer, employeeProfileAnswer, employeesAnswer,
  penaltiesAnswer, trainingsAnswer,
} = require('./people');
const {
  detectInspectionCategory, findInspectionItems, inspectionsAnswer, matchInspectionSection,
} = require('./inspections');

function summaryAnswer(ctx, scope, period) {
  const d = dataFor(ctx, scope, period);
  const open = d.hazards.filter(HAZ_OPEN);
  const overdue = open.filter(h => Date.now() - dateOf(h).getTime() > HOURS_48);
  const pending = d.permits.filter(PERMIT_PENDING);
  const month = new Date().getMonth(), year = new Date().getFullYear();
  const thisMonth = d.hazards.filter(h => { const x = dateOf(h); return x.getMonth() === month && x.getFullYear() === year; });
  const c = complianceData(ctx, scope);
  const trainOk = c.rows.filter(r => r.trainOk).length;
  return {
    reply: [
      `📊 ملخص ${scopeLabel(scope, period)}:`,
      `• بلاغات الخطورة: ${n2(d.hazards.length)} — مفتوح ${n2(open.length)}${overdue.length ? ` (منهم ${n2(overdue.length)} عدّى عليهم 48 ساعة ⚠️)` : ''}`,
      `• بلاغات الشهر ده: ${n2(thisMonth.length)}`,
      `• تصاريح العمل: ${n2(d.permits.length)} — مستني اعتماد ${n2(pending.length)}`,
      `• التدريب: ${n2(d.trainings.length)} محاضرة · ${n2(d.trainings.reduce((s, t) => s + (t.attendees || []).length, 0))} حضور`,
      `• تجارب الطوارئ: ${n2(d.drills.length)} · الجزاءات: ${n2(d.penalties.length)}`,
      c.rows.length ? `• الالتزام بتارجت التدريب: ${pct(trainOk, c.rows.length)}% من ${arCount(c.rows.length, 'موظف')}` : '',
      overdue.length ? `\nأقدم البلاغات المتأخرة:\n${overdue.sort((a, b) => dateOf(a) - dateOf(b)).slice(0, 5).map(h => `• ${h.id} — ${h.department || '—'} — ${fmtDate(h.date || h.submittedAt)}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    source: SOURCE,
    suggestions: ['آخر بلاغ مفتوح', 'بلاغات عالية الخطورة', 'تصاريح مستنية اعتماد', 'نسبة الالتزام لكل قسم'],
  };
}

const SUMMARY_RE = /ملخص|الوضع ايه|الوضع عامل ايه|احوال المصنع|نظره عامه|overview|dashboard|الداشبورد|تقرير سريع|كل حاجه/;

function cleanQ(question) {
  return ' ' + normalizeArabic(question).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

function answerAnalytics(question, ctx) {
  const role = ctx.user && ctx.user.role;
  if (!ADMIN_ROLES.includes(role)) return null;
  const nq = cleanQ(question);
  const scope = scopeOf(ctx, nq);
  const period = detectPeriod(nq);

  if (SUMMARY_RE.test(nq)) return withScopeNote(summaryAnswer(ctx, scope, period), scope);

  if (/بيانات|ملف|سجل|مين هو|عايز اعرف|الموظف|العامل/.test(nq)) {
    const emp = detectEmployee(question, ctx);
    if (emp) return employeeProfileAnswer(emp, ctx, scope);
  }

  let entity = detectEntity(nq);
  if (!entity) {
    const inspSections = arr(ctx.data.inspectionSections);
    if (inspSections.length) {
      const cat = detectInspectionCategory(nq);
      const sec = matchInspectionSection(nq, inspSections, cat);
      if (cat) entity = 'inspections';
      else if (sec) {
        const ids = new Set([sec.id]);
        const hit = findInspectionItems(nq, arr(ctx.data.inspectionItems), ids);
        if (hit.length || /فحص|مطابق|حاله|صالح|تالف|اخر فحص|رقم \d/.test(nq)) entity = 'inspections';
      }
    }
  }
  const prev = ctx.context && ctx.context.lastEntity;
  if (!entity && prev && (scope.depts.length || period || WANT.count.test(nq) || WANT.list.test(nq) || WANT.breakdown.test(nq))) {
    entity = prev;
  }
  if (!entity) return null;
  if (MISSING_RE.test(nq) && (entity === 'trainings' || entity === 'hazards' || entity === 'employees')) entity = 'compliance';

  if (entity === 'employees' || /بيانات|ملف|سجل/.test(nq)) {
    const emp = detectEmployee(question, ctx);
    if (emp) return employeeProfileAnswer(emp, ctx, scope);
  }

  let answer = null;
  switch (entity) {
    case 'hazards': answer = hazardsAnswer(nq, ctx, scope, period, question); break;
    case 'permits': answer = permitsAnswer(nq, ctx, scope, period, question); break;
    case 'trainings': answer = trainingsAnswer(nq, ctx, scope, period); break;
    case 'drills': answer = drillsAnswer(nq, ctx, scope, period); break;
    case 'penalties': answer = penaltiesAnswer(nq, ctx, scope, period); break;
    case 'employees': answer = employeesAnswer(nq, ctx, scope); break;
    case 'compliance': answer = complianceAnswer(nq, ctx, scope); break;
    case 'inspections': answer = inspectionsAnswer(nq, ctx, period); break;
    default: answer = null;
  }
  return answer ? withScopeNote({ ...answer, topic: { entity, depts: scope.depts } }, scope) : null;
}

function isAdminDataQuestion(question) {
  const nq = cleanQ(question);
  if (SUMMARY_RE.test(nq)) return true;
  const entity = detectEntity(nq);
  if (!entity) return false;
  const generalWord = WANT.count.test(nq) || WANT.list.test(nq) || WANT.breakdown.test(nq) || WANT.top.test(nq) || WANT.latest.test(nq);
  const mine = /بتاعي|بتاعتي|عندي|ليا|حضرتها|عملتها|سجلي|انا/.test(nq);
  return generalWord && !mine;
}

module.exports = { answerAnalytics, isAdminDataQuestion, complianceData, ADMIN_ROLES, helpers };
