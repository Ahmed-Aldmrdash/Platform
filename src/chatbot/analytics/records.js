'use strict';

// Hazard report and work permit statistics.

const { arCount } = require('../kb');
const {
  arr, dataFor, dateOf, detectPermitType, fmtDate, HAZ_DONE, HAZ_OPEN, HAZ_REJECTED, HOURS_48,
  inScope, n2, pct, PERMIT_PENDING, PERMIT_STATUS_LABEL, PERMIT_TYPE_LABEL, RISK_LABEL, riskOf,
  scopeLabel, short, SOURCE, STATE, WANT,
} = require('./shared');

const hazLine = h => `• ${h.id} — ${fmtDate(h.date || h.submittedAt)} — ${short(h.department || '—', 24)} (${h.area || '—'})\n   ${short(h.description, 90)}\n   الحالة: ${HAZ_OPEN(h) ? 'مفتوح ⏳' : HAZ_DONE(h) ? 'مقفول ✅' : 'مرفوض ❌'} · الخطورة: ${RISK_LABEL[riskOf(h)] || '—'}${h.reporterName ? ` · المُبلِّغ: ${short(h.reporterName, 26)}` : ''}`;

function hazardsAnswer(nq, ctx, scope, period, question) {
  const { hazards } = dataFor(ctx, scope, period);
  const idm = String(question).match(/(?:haz|hz)-[\w-]+/i);
  if (idm) {
    const id = idm[0].toUpperCase();
    const h = arr(ctx.data.hazards).find(x => String(x.id).toUpperCase() === id || String(x.id).toUpperCase().endsWith(id));
    if (!h) return { reply: `مش لاقي بلاغ بالرقم ${id}.`, source: SOURCE };
    if (scope.forced && !inScope(h.department, scope)) return { reply: `البلاغ ${id} مش في قسمك — مقدرش أعرضه.`, source: SOURCE };
    return {
      reply: [
        `🔎 بلاغ ${h.id}`,
        `• الحالة: ${HAZ_OPEN(h) ? 'مفتوح ⏳' : HAZ_DONE(h) ? 'مقفول ✅' : 'مرفوض ❌'}`,
        `• التاريخ: ${fmtDate(h.date || h.submittedAt)}${h.resolvedAt ? ` · اتقفل: ${fmtDate(h.resolvedAt)}` : ''}`,
        `• القسم: ${h.department || '—'} · المكان: ${h.area || '—'}`,
        `• الخطورة: ${RISK_LABEL[riskOf(h)] || '—'}`,
        `• المُبلِّغ: ${h.reporterName || '—'}${h.empCode ? ` (${h.empCode})` : ''}`,
        `• الوصف: ${short(h.description, 300)}`,
        h.actionTaken ? `• الإجراء: ${short(h.actionTaken, 300)}` : '',
        h.hseName ? `• متابعة: ${h.hseName}` : '',
      ].filter(Boolean).join('\n'),
      source: SOURCE,
      suggestions: ['البلاغات المفتوحة', 'بلاغات متأخرة', 'بلاغات عالية الخطورة'],
    };
  }

  const open = hazards.filter(HAZ_OPEN);
  const closed = hazards.filter(HAZ_DONE);
  const rejected = hazards.filter(HAZ_REJECTED);
  const overdue = open.filter(h => Date.now() - dateOf(h).getTime() > HOURS_48);
  const byRisk = { H: 0, M: 0, L: 0, C: 0 };
  hazards.forEach(h => { const r = riskOf(h); if (byRisk[r] !== undefined) byRisk[r]++; });

  const wantHigh = STATE.high.test(nq);
  const wantOpen = STATE.open.test(nq);
  const wantClosed = STATE.closed.test(nq) && !wantOpen;
  const wantOverdue = STATE.overdue.test(nq);

  let pool = hazards, poolLabel = 'البلاغات', oneLabel = 'بلاغ', bareLabel = 'بلاغات';
  if (wantOverdue) { pool = open.filter(h => Date.now() - dateOf(h).getTime() > HOURS_48); poolLabel = 'البلاغات المتأخرة (أكتر من 48 ساعة)'; oneLabel = 'بلاغ متأخر'; bareLabel = 'بلاغات متأخرة (أكتر من 48 ساعة)'; }
  else if (wantOpen) { pool = open; poolLabel = 'البلاغات المفتوحة'; oneLabel = 'بلاغ مفتوح'; bareLabel = 'بلاغات مفتوحة'; }
  else if (wantClosed) { pool = closed; poolLabel = 'البلاغات المقفولة'; oneLabel = 'بلاغ مقفول'; bareLabel = 'بلاغات مقفولة'; }
  if (wantHigh) {
    pool = pool.filter(h => riskOf(h) === 'H' || riskOf(h) === 'C');
    poolLabel = `${poolLabel} عالية الخطورة`;
    oneLabel = `${oneLabel} عالي الخطورة`;
    bareLabel = `${bareLabel} عالية الخطورة`;
  }
  const filtered = wantHigh || wantOpen || wantClosed || wantOverdue;

  if ((WANT.top.test(nq) || WANT.bottom.test(nq)) && !scope.depts.length && /قسم|اقسام/.test(nq)) {
    const m = new Map();
    pool.forEach(h => { const d = String(h.department || 'غير محدد').trim(); m.set(d, (m.get(d) || 0) + 1); });
    let rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (WANT.bottom.test(nq)) rows = rows.reverse();
    return {
      reply: `📊 ${WANT.bottom.test(nq) ? 'أقل' : 'أكتر'} الأقسام في ${poolLabel} — ${scopeLabel(scope, period)} (الإجمالي ${n2(pool.length)}):\n${rows.slice(0, 10).map(([d, c], i) => `${i + 1}) ${d}: ${n2(c)}`).join('\n')}`,
      source: SOURCE,
      suggestions: ['البلاغات المفتوحة', 'نسبة الالتزام لكل قسم'],
    };
  }

  if (WANT.breakdown.test(nq) && !scope.depts.length) {
    const m = new Map();
    pool.forEach(h => { const d = String(h.department || 'غير محدد').trim(); m.set(d, (m.get(d) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    return {
      reply: `📊 ${poolLabel} حسب القسم — ${scopeLabel(scope, period)} (الإجمالي ${n2(pool.length)}):\n${rows.map(([d, c], i) => `${i + 1}) ${d}: ${n2(c)}`).join('\n')}`,
      source: SOURCE,
      suggestions: ['البلاغات المفتوحة', 'بلاغات متأخرة', 'نسبة الالتزام لكل قسم'],
    };
  }

  const sorted = pool.slice().sort((a, b) => dateOf(b) - dateOf(a));
  if (WANT.latest.test(nq) && !WANT.count.test(nq)) {
    if (!sorted.length) return { reply: `✅ مفيش ${bareLabel} في ${scopeLabel(scope, period)}.`, source: SOURCE };
    const take = /قايمه|قائمه|اعرض|اخر \d+/.test(nq) ? 5 : 1;
    return {
      reply: `🆕 ${take > 1 ? `آخر ${take} من ${poolLabel}` : `آخر ${oneLabel}`} — ${scopeLabel(scope, period)}:\n${sorted.slice(0, take).map(hazLine).join('\n')}`,
      source: SOURCE,
      suggestions: ['كل البلاغات المفتوحة', 'بلاغات متأخرة', 'البلاغات حسب القسم'],
    };
  }
  if (WANT.oldest.test(nq)) {
    const oldFirst = sorted.slice().reverse();
    if (!oldFirst.length) return { reply: `✅ مفيش ${bareLabel} في ${scopeLabel(scope, period)}.`, source: SOURCE };
    return {
      reply: `⏳ أقدم ${poolLabel} — ${scopeLabel(scope, period)}:\n${oldFirst.slice(0, 5).map(hazLine).join('\n')}`,
      source: SOURCE,
      suggestions: ['بلاغات متأخرة', 'البلاغات المفتوحة'],
    };
  }

  const isCount = WANT.count.test(nq);
  if (isCount && filtered) {
    return {
      reply: [
        `📋 ${poolLabel} — ${scopeLabel(scope, period)}: ${n2(pool.length)}`,
        ``,
        `للعلم كمان:`,
        `• إجمالي البلاغات في النطاق ده: ${n2(hazards.length)}`,
        `• مفتوح: ${n2(open.length)}${overdue.length ? ` (منهم ${n2(overdue.length)} عدّى عليهم 48 ساعة ⚠️)` : ''} · مقفول: ${n2(closed.length)}`,
        `• حسب الخطورة: عالية ${n2(byRisk.H + byRisk.C)} · متوسطة ${n2(byRisk.M)} · منخفضة ${n2(byRisk.L)}`,
      ].join('\n'),
      source: SOURCE,
      suggestions: [`اعرضلي ${poolLabel}`, 'البلاغات حسب القسم', 'آخر بلاغ مفتوح'],
    };
  }
  if (!isCount && (WANT.list.test(nq) || wantHigh || wantOverdue || wantOpen || wantClosed)) {
    if (!pool.length) {
      const alt = wantHigh && open.length ? `\nبس فيه ${arCount(open.length, 'بلاغ')} مفتوح بخطورة أقل — تحب أعرضهم؟` : '';
      return {
        reply: `✅ مفيش ${bareLabel} في ${scopeLabel(scope, period)}.${alt}`,
        source: SOURCE,
        suggestions: ['اعرضلي البلاغات المفتوحة', 'بلاغات متأخرة', 'البلاغات حسب القسم'],
      };
    }
    const head = `📋 ${poolLabel} — ${scopeLabel(scope, period)}: ${n2(pool.length)}`;
    const lines = sorted.slice(0, 8).map(hazLine).join('\n');
    const more = pool.length > 8 ? `\n… و${arCount(pool.length - 8, 'بلاغ')} كمان (افتح تبويب "سجل البلاغات" تشوفهم كلهم).` : '';
    return { reply: `${head}\n\n${lines}${more}`, source: SOURCE, suggestions: ['بلاغات متأخرة', 'بلاغات عالية الخطورة', 'البلاغات حسب القسم'] };
  }

  return {
    reply: [
      `📋 بلاغات الخطورة — ${scopeLabel(scope, period)}`,
      `• الإجمالي: ${n2(hazards.length)}`,
      `• مفتوح: ${n2(open.length)}${overdue.length ? ` (منهم ${n2(overdue.length)} عدّى عليهم 48 ساعة ⚠️)` : ''}`,
      `• مقفول: ${n2(closed.length)}${rejected.length ? `\n• مرفوض: ${n2(rejected.length)}` : ''}`,
      `• حسب الخطورة: عالية ${n2(byRisk.H + byRisk.C)} · متوسطة ${n2(byRisk.M)} · منخفضة ${n2(byRisk.L)}`,
      hazards.length ? `• نسبة الإغلاق: ${pct(closed.length, hazards.length)}%` : '',
    ].filter(Boolean).join('\n'),
    source: SOURCE,
    suggestions: ['آخر بلاغ مفتوح', 'بلاغات متأخرة', 'بلاغات عالية الخطورة', 'البلاغات حسب القسم'],
  };
}

const permitLine = p => `• ${p.id} — ${PERMIT_TYPE_LABEL[p.typeKey] || p.typeLabel || 'تصريح'} — ${fmtDate(p.date || p.createdAt)} — ${short(p.location || p.department, 28)}\n   الحالة: ${PERMIT_STATUS_LABEL[p.status] || p.status || '—'}${p.workerName ? ` · مقدّم الطلب: ${short(p.workerName, 26)}` : ''}`;

function permitsAnswer(nq, ctx, scope, period, question) {
  const allPermits = dataFor(ctx, scope, period).permits;
  const typeKey = detectPermitType(nq);
  const permits = typeKey ? allPermits.filter(p => String(p.typeKey || '').toLowerCase() === typeKey) : allPermits;
  const typeNote = typeKey ? ` — ${PERMIT_TYPE_LABEL[typeKey]}` : '';
  const idm = String(question).match(/(?:wp|old)-[\w-]+/i);
  if (idm) {
    const id = idm[0].toUpperCase();
    const p = arr(ctx.data.permits).find(x => String(x.id).toUpperCase() === id);
    if (!p) return { reply: `مش لاقي تصريح بالرقم ${id}.`, source: SOURCE };
    return {
      reply: [
        `🔎 تصريح ${p.id} — ${PERMIT_TYPE_LABEL[p.typeKey] || p.typeLabel || ''}`,
        `• الحالة: ${PERMIT_STATUS_LABEL[p.status] || p.status}`,
        `• التاريخ: ${p.date || fmtDate(p.createdAt)} (${p.timeFrom || '—'} → ${p.timeTo || '—'})`,
        `• القسم: ${p.department || '—'} · المكان: ${p.location || '—'}`,
        `• مقدّم الطلب: ${p.workerName || '—'}${p.employeeId ? ` (${p.employeeId})` : ''}`,
        p.description ? `• الوصف: ${short(p.description, 250)}` : '',
        p.areaManagerName ? `• مدير المنطقة: ${p.areaManagerName}` : '',
        p.safetyOfficerName ? `• مسؤول السلامة: ${p.safetyOfficerName}` : '',
      ].filter(Boolean).join('\n'),
      source: SOURCE,
    };
  }

  const pending = permits.filter(PERMIT_PENDING);
  const approved = permits.filter(p => p.status === 'approved');
  const rejected = permits.filter(p => p.status === 'rejected');
  const closed = permits.filter(p => /^closed/.test(String(p.status || '')));
  const byType = new Map();
  permits.forEach(p => {
    const label = PERMIT_TYPE_LABEL[p.typeKey] || p.typeLabel || 'غير محدد';
    byType.set(label, (byType.get(label) || 0) + 1);
  });

  const wantPending = STATE.open.test(nq) && !STATE.approved.test(nq);
  let pool = permits, poolLabel = 'تصاريح العمل';
  if (wantPending) { pool = pending; poolLabel = 'التصاريح المستنية اعتماد'; }
  else if (STATE.approved.test(nq)) { pool = approved; poolLabel = 'التصاريح المعتمدة'; }
  else if (STATE.rejected.test(nq)) { pool = rejected; poolLabel = 'التصاريح المرفوضة'; }

  if (WANT.breakdown.test(nq) && (/نوع|انواع/.test(nq) || scope.depts.length)) {
    const rows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    return {
      reply: `📊 تصاريح العمل حسب النوع — ${scopeLabel(scope, period)} (الإجمالي ${n2(permits.length)}):\n${rows.map(([t, c], i) => `${i + 1}) ${t}: ${n2(c)}`).join('\n')}`,
      source: SOURCE,
      suggestions: ['تصاريح مستنية اعتماد', 'آخر تصريح', 'التصاريح حسب القسم'],
    };
  }
  if (WANT.breakdown.test(nq) && !scope.depts.length) {
    const m = new Map();
    permits.forEach(p => { const d = String(p.department || 'غير محدد').trim(); m.set(d, (m.get(d) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    return {
      reply: `📊 تصاريح العمل حسب القسم — ${scopeLabel(scope, period)} (الإجمالي ${n2(permits.length)}):\n${rows.map(([d, c], i) => `${i + 1}) ${d}: ${n2(c)}`).join('\n')}`,
      source: SOURCE,
    };
  }

  const sorted = pool.slice().sort((a, b) => dateOf(b) - dateOf(a));
  if (WANT.latest.test(nq) && !WANT.count.test(nq)) {
    if (!sorted.length) return { reply: `مفيش ${poolLabel} في ${scopeLabel(scope, period)}.`, source: SOURCE };
    const take = /قايمه|قائمه|اعرض|اخر \d+/.test(nq) ? 5 : 1;
    return { reply: `🆕 آخر ${poolLabel} — ${scopeLabel(scope, period)}:\n${sorted.slice(0, take).map(permitLine).join('\n')}`, source: SOURCE };
  }
  if (WANT.oldest.test(nq) && sorted.length) {
    return { reply: `⏳ أقدم ${poolLabel} — ${scopeLabel(scope, period)}:\n${sorted.slice().reverse().slice(0, 5).map(permitLine).join('\n')}`, source: SOURCE };
  }
  if (!WANT.count.test(nq) && (WANT.list.test(nq) || wantPending)) {
    if (!pool.length) return { reply: `✅ مفيش ${poolLabel} في ${scopeLabel(scope, period)}.`, source: SOURCE, suggestions: ['كام تصريح عمل؟', 'التصاريح حسب النوع'] };
    const more = pool.length > 8 ? `\n… و${arCount(pool.length - 8, 'تصريح')} كمان.` : '';
    return { reply: `📝 ${poolLabel} — ${scopeLabel(scope, period)}: ${n2(pool.length)}\n\n${sorted.slice(0, 8).map(permitLine).join('\n')}${more}`, source: SOURCE };
  }

  const topTypes = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, c]) => `${t} ${n2(c)}`).join(' · ');
  return {
    reply: [
      `📝 تصاريح العمل${typeNote} — ${scopeLabel(scope, period)}`,
      `• الإجمالي: ${n2(permits.length)}`,
      `• معتمد: ${n2(approved.length)} · مستني اعتماد: ${n2(pending.length)}${rejected.length ? ` · مرفوض: ${n2(rejected.length)}` : ''}${closed.length ? ` · مقفول: ${n2(closed.length)}` : ''}`,
      topTypes ? `• أكتر الأنواع: ${topTypes}` : '',
    ].filter(Boolean).join('\n'),
    source: SOURCE,
    suggestions: ['تصاريح مستنية اعتماد', 'التصاريح حسب النوع', 'آخر تصريح', 'التصاريح حسب القسم'],
  };
}

module.exports = {
  hazardsAnswer,
  permitsAnswer,
};
