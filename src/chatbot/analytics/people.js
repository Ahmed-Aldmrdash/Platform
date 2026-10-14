'use strict';

// Training, drill, penalty and employee statistics, including yearly target compliance.

const { arCount } = require('../kb');
const {
  arr, attCode, dataFor, dateOf, fmtDate, HAZ_OPEN, HAZ_REJECTED, HAZARD_TARGET, inScope,
  isDeletedRec, n2, normCode, normName, pct, PENALTY_DEDUCTION, scopeLabel, short, SOURCE,
  TRAIN_TARGET, trainingHours, WANT,
} = require('./shared');

function trainingsAnswer(nq, ctx, scope, period) {
  const { trainings, employees } = dataFor(ctx, scope, period);
  const attendances = trainings.reduce((s, t) => s + (t.attendees || []).length, 0);
  const hours = trainings.reduce((s, t) => s + (t.attendees || []).length * trainingHours(t), 0);
  const active = trainings.filter(t => t.status === 'active');
  const sorted = trainings.slice().sort((a, b) => dateOf(b) - dateOf(a));

  if (/شغاله|شغالة|دلوقتي|مفتوحه|جاريه|active/.test(nq) && /محاضر|تدريب/.test(nq)) {
    if (active.length) {
      return {
        reply: `🟢 فيه ${arCount(active.length, 'محاضرة')} شغالة دلوقتي:\n${active.map(t => `• ${t.title || t.topic} — ${t.trainer ? `المحاضر: ${t.trainer}` : ''} — حضر لحد دلوقتي: ${(t.attendees || []).length}`).join('\n')}`,
        source: SOURCE,
      };
    }
    return { reply: `مفيش محاضرة شغالة دلوقتي.${sorted[0] ? `\nآخر محاضرة: ${sorted[0].title || sorted[0].topic} يوم ${fmtDate(sorted[0].date)}.` : ''}`, source: SOURCE };
  }

  if (WANT.latest.test(nq) && !WANT.count.test(nq) && sorted.length) {
    const take = /قايمه|قائمه|اعرض|اخر \d+/.test(nq) ? 5 : 1;
    return {
      reply: `🎓 آخر المحاضرات — ${scopeLabel(scope, period)}:\n${sorted.slice(0, take).map(t => `• ${fmtDate(t.date)} — ${t.title || t.topic} — ${arCount((t.attendees || []).length, 'حاضر')}${t.trainer ? ` — المحاضر: ${t.trainer}` : ''}`).join('\n')}`,
      source: SOURCE,
    };
  }

  if (/موضوع|مواضيع|topics|اكتر محاضر/.test(nq)) {
    const m = new Map();
    trainings.forEach(t => { const k = t.topic || t.title || 'غير محدد'; m.set(k, (m.get(k) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return {
      reply: `🎓 أكتر مواضيع التدريب — ${scopeLabel(scope, period)}:\n${rows.map(([t, c], i) => `${i + 1}) ${t}: ${arCount(c, 'محاضرة')}`).join('\n')}`,
      source: SOURCE,
    };
  }

  if (WANT.list.test(nq) && sorted.length) {
    const more = sorted.length > 8 ? `\n… و${arCount(sorted.length - 8, 'محاضرة')} كمان.` : '';
    return {
      reply: `🎓 المحاضرات — ${scopeLabel(scope, period)}: ${n2(trainings.length)}\n${sorted.slice(0, 8).map(t => `• ${fmtDate(t.date)} — ${t.title || t.topic} (${arCount((t.attendees || []).length, 'حاضر')})`).join('\n')}${more}`,
      source: SOURCE,
    };
  }

  const perEmp = employees.length ? Math.round((hours / employees.length) * 10) / 10 : 0;
  return {
    reply: [
      `🎓 التدريب — ${scopeLabel(scope, period)}`,
      `• عدد المحاضرات: ${n2(trainings.length)}`,
      `• إجمالي الحضور: ${n2(attendances)} حضور`,
      `• ساعات التدريب: ${n2(Math.round(hours * 10) / 10)} ساعة`,
      employees.length ? `• متوسط نصيب الموظف: ${perEmp} ساعة (التارجت ${TRAIN_TARGET} ساعات في السنة)` : '',
      active.length ? `• فيه ${arCount(active.length, 'محاضرة')} شغالة دلوقتي 🟢` : '',
    ].filter(Boolean).join('\n'),
    source: SOURCE,
    suggestions: ['آخر محاضرة', 'أكتر مواضيع التدريب', 'نسبة الالتزام بالتدريب', 'مين ناقصه تدريب؟'],
  };
}

function drillsAnswer(nq, ctx, scope, period) {
  const { drills } = dataFor(ctx, scope, period);
  const sorted = drills.slice().sort((a, b) => dateOf(b) - dateOf(a));
  const attendances = drills.reduce((s, d) => s + (d.attendees || []).length, 0);
  const open = drills.filter(d => d.status === 'active');
  if ((WANT.latest.test(nq) || WANT.list.test(nq)) && sorted.length) {
    const take = WANT.latest.test(nq) && !WANT.list.test(nq) ? 1 : 8;
    return {
      reply: `🚨 تجارب الطوارئ — ${scopeLabel(scope, period)}:\n${sorted.slice(0, take).map(d => `• ${fmtDate(d.date)} — ${d.title || 'تجربة'} — ${d.location || '—'} — ${d.status === 'active' ? 'شغالة 🟢' : 'مقفولة ✅'} (${arCount((d.attendees || []).length, 'حاضر')})`).join('\n')}`,
      source: SOURCE,
    };
  }
  return {
    reply: [
      `🚨 تجارب الطوارئ — ${scopeLabel(scope, period)}`,
      `• العدد: ${n2(drills.length)}${open.length ? ` (منهم ${arCount(open.length, 'تجربة طوارئ')} شغالة دلوقتي)` : ''}`,
      `• إجمالي الحضور المسجّل: ${n2(attendances)}`,
      sorted[0] ? `• آخر تجربة: ${sorted[0].title || '—'} يوم ${fmtDate(sorted[0].date)}${sorted[0].location ? ` (${sorted[0].location})` : ''}` : '',
    ].filter(Boolean).join('\n'),
    source: SOURCE,
    suggestions: ['آخر تجربة طوارئ', 'كام بلاغ مفتوح؟'],
  };
}

function penaltiesAnswer(nq, ctx, scope, period) {
  const { penalties } = dataFor(ctx, scope, period);
  const sorted = penalties.slice().sort((a, b) => dateOf(b) - dateOf(a));
  if (WANT.breakdown.test(nq) && !scope.depts.length) {
    const m = new Map();
    penalties.forEach(p => { const d = String(p.department || 'غير محدد').trim(); m.set(d, (m.get(d) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    return { reply: `⚖️ الجزاءات حسب القسم — ${scopeLabel(scope, period)} (${n2(penalties.length)}):\n${rows.map(([d, c], i) => `${i + 1}) ${d}: ${n2(c)}`).join('\n')}`, source: SOURCE };
  }
  if (/سبب|اسباب|اكتر سبب/.test(nq)) {
    const m = new Map();
    penalties.forEach(p => { const r = short(p.reason || 'غير محدد', 40); m.set(r, (m.get(r) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return { reply: `⚖️ أكتر أسباب الجزاءات — ${scopeLabel(scope, period)}:\n${rows.map(([r, c], i) => `${i + 1}) ${r}: ${n2(c)}`).join('\n')}`, source: SOURCE };
  }
  if ((WANT.list.test(nq) || WANT.latest.test(nq)) && sorted.length) {
    const take = WANT.latest.test(nq) && !WANT.list.test(nq) ? 3 : 8;
    return {
      reply: `⚖️ آخر الجزاءات — ${scopeLabel(scope, period)} (${n2(penalties.length)}):\n${sorted.slice(0, take).map(p => `• ${fmtDate(p.date)} — ${p.empName || '—'} (${p.department || '—'})\n   السبب: ${short(p.reason, 90)}${p.issuedBy ? ` · صادر من: ${p.issuedBy}` : ''}`).join('\n')}`,
      source: SOURCE,
    };
  }
  return {
    reply: `⚖️ الجزاءات — ${scopeLabel(scope, period)}\n• العدد: ${n2(penalties.length)}${sorted[0] ? `\n• آخر جزاء: ${sorted[0].empName || '—'} يوم ${fmtDate(sorted[0].date)} — ${short(sorted[0].reason, 60)}` : ''}`,
    source: SOURCE,
    suggestions: ['آخر الجزاءات', 'أكتر أسباب الجزاءات', 'الجزاءات حسب القسم'],
  };
}

function employeeProfileAnswer(emp, ctx, scope) {
  if (scope.forced && !inScope(emp.department, scope)) {
    return { reply: `الموظف ده مش في قسمك — مقدرش أعرض بياناته.`, source: SOURCE };
  }
  const code = normCode(emp.empCode || emp.code);
  const hazards = arr(ctx.data.hazards).filter(h => !isDeletedRec(h) && (normCode(h.empCode) === code || normName(h.reporterName) === normName(emp.name)));
  const trainings = arr(ctx.data.trainings).filter(t => !isDeletedRec(t) && (t.attendees || []).some(a => attCode(a) === code));
  const hours = trainings.reduce((s, t) => s + trainingHours(t), 0);
  const permits = arr(ctx.data.permits).filter(p => !isDeletedRec(p) && normCode(p.employeeId) === code);
  const penalties = arr(ctx.data.penalties).filter(p => p.status !== 'deleted' && normCode(p.empCode) === code);
  const drills = arr(ctx.data.drills).filter(d => !isDeletedRec(d) && (d.attendees || []).some(a => attCode(a) === code));
  const year = new Date().getFullYear();
  const hoursYtd = trainings.filter(t => dateOf(t).getFullYear() === year).reduce((s, t) => s + trainingHours(t), 0);
  const hzYtd = hazards.filter(h => dateOf(h).getFullYear() === year).length;
  return {
    reply: [
      `👤 ${emp.name}`,
      `• الكود الوظيفي: ${emp.empCode || code} · القسم: ${emp.department || '—'}`,
      `• الوظيفة: ${emp.jobTitle || '—'}`,
      `• الموبايل: ${emp.phone || 'مش مسجّل'}${emp.email ? ` · الإيميل: ${emp.email}` : ''}`,
      ``,
      `📊 سجله:`,
      `• التدريب: ${arCount(trainings.length, 'محاضرة')} = ${arCount(Math.round(hours * 10) / 10, 'ساعة')} (السنة دي ${Math.round(hoursYtd * 10) / 10} من ${TRAIN_TARGET})`,
      `• بلاغات الخطورة: ${n2(hazards.length)} (السنة دي ${hzYtd} من ${HAZARD_TARGET}) — مفتوح منهم ${n2(hazards.filter(HAZ_OPEN).length)}`,
      `• تصاريح العمل: ${n2(permits.length)}`,
      `• تجارب الطوارئ: ${n2(drills.length)}`,
      `• الجزاءات: ${n2(penalties.length)}${penalties.length ? ` — آخرها: ${short(penalties.sort((a, b) => dateOf(b) - dateOf(a))[0].reason, 60)}` : ''}`,
    ].join('\n'),
    source: `${SOURCE} (بيانات الموظفين)`,
    suggestions: ['مين ناقصه تدريب؟', 'نسبة الالتزام لكل قسم'],
  };
}

function employeesAnswer(nq, ctx, scope) {
  const employees = arr(ctx.data.employees).filter(e => inScope(e.department, scope));
  if (WANT.breakdown.test(nq) && !scope.depts.length) {
    const m = new Map();
    employees.forEach(e => { const d = String(e.department || 'غير محدد').trim(); m.set(d, (m.get(d) || 0) + 1); });
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    return { reply: `👥 عدد الموظفين حسب القسم (الإجمالي ${n2(employees.length)}):\n${rows.map(([d, c], i) => `${i + 1}) ${d}: ${n2(c)}`).join('\n')}`, source: SOURCE };
  }
  if (/رقم|تليفون|موبايل|ايميل|بيانات الاتصال/.test(nq)) {
    const withPhone = employees.filter(e => e.phone);
    return {
      reply: `📞 بيانات الاتصال — ${scopeLabel(scope, null)}\n• عدد الموظفين: ${n2(employees.length)}\n• مسجّلين رقم موبايل: ${n2(withPhone.length)} (${pct(withPhone.length, employees.length)}%)\n\nاسألني عن موظف بالاسم أو بالكود (مثلاً "بيانات الموظف 5504") وهجيبلك رقمه وسجله، أو نزّل الملف كله من تبويب "الموظفين" → "تصدير Excel".`,
      source: SOURCE,
    };
  }
  const depts = new Set(employees.map(e => String(e.department || '').trim()).filter(Boolean));
  return {
    reply: `👥 الموظفين — ${scopeLabel(scope, null)}\n• العدد: ${n2(employees.length)}${scope.depts.length ? '' : `\n• عدد الأقسام: ${n2(depts.size)}`}\n\nاسألني عن أي موظف بالاسم أو الكود عشان أجيبلك بياناته وسجله كامل.`,
    source: SOURCE,
    suggestions: ['عدد الموظفين لكل قسم', 'مين ناقصه تدريب؟', 'نسبة الالتزام لكل قسم'],
  };
}

function complianceData(ctx, scope) {
  const now = new Date();
  const quartersElapsed = Math.floor(now.getMonth() / 3) + 1;
  const targetHours = (TRAIN_TARGET / 4) * quartersElapsed;
  const targetHazards = Math.ceil((HAZARD_TARGET / 4) * quartersElapsed);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const employees = arr(ctx.data.employees).filter(e => inScope(e.department, scope));
  const hoursByCode = new Map();
  arr(ctx.data.trainings).filter(t => !isDeletedRec(t) && dateOf(t) >= yearStart).forEach(t => {
    const h = trainingHours(t);
    (t.attendees || []).forEach(a => {
      if (a.verified === false) return;
      const c = attCode(a);
      if (c) hoursByCode.set(c, (hoursByCode.get(c) || 0) + h);
    });
  });
  const hazByCode = new Map();
  const hazByName = new Map();
  arr(ctx.data.hazards).filter(h => !isDeletedRec(h) && !HAZ_REJECTED(h) && dateOf(h) >= yearStart).forEach(h => {
    const c = normCode(h.empCode);
    if (c) hazByCode.set(c, (hazByCode.get(c) || 0) + 1);
    const n = normName(h.reporterName);
    if (n) hazByName.set(n, (hazByName.get(n) || 0) + 1);
  });

  const penByCode = new Map();
  arr(ctx.data.penalties).filter(p => p.status !== 'deleted' && p.status !== 'cancelled' && dateOf(p) >= yearStart).forEach(p => {
    const c = normCode(p.empCode);
    if (c) penByCode.set(c, (penByCode.get(c) || 0) + 1);
  });

  const rows = employees.map(e => {
    const code = normCode(e.empCode || e.code);
    const hrs = hoursByCode.get(code) || 0;
    const hz = hazByCode.get(code) || hazByName.get(normName(e.name)) || 0;
    const pen = penByCode.get(code) || 0;
    const trainPct = Math.min(100, Math.round((hrs / targetHours) * 100));
    const hazPct = Math.min(100, Math.round((hz / targetHazards) * 100));
    const score = Math.max(0, Math.round((trainPct + hazPct) / 2) - pen * PENALTY_DEDUCTION);
    return {
      emp: e, hours: hrs, hazards: hz, penalties: pen,
      trainOk: hrs >= targetHours, hazOk: hz >= targetHazards,
      trainPct, hazPct, score,
    };
  });
  return { rows, targetHours, targetHazards, quartersElapsed, penaltyDeduction: PENALTY_DEDUCTION, label: `الربع ${['الأول', 'الثاني', 'الثالث', 'الرابع'][quartersElapsed - 1]} ${now.getFullYear()}` };
}

function complianceAnswer(nq, ctx, scope) {
  const c = complianceData(ctx, scope);
  const total = c.rows.length;
  if (!total) return { reply: 'مفيش موظفين مسجّلين في النطاق ده.', source: SOURCE };
  const trainOk = c.rows.filter(r => r.trainOk).length;
  const hazOk = c.rows.filter(r => r.hazOk).length;

  if (/ناقص|مقصر|محققش|لسه|تحت التارجت|مش محقق|متاخر عن التارجت/.test(nq)) {
    const wantTrain = /تدريب|محاضر|ساعات/.test(nq) || !/بلاغ/.test(nq);
    const missing = c.rows.filter(r => (wantTrain ? !r.trainOk : !r.hazOk))
      .sort((a, b) => (wantTrain ? a.hours - b.hours : a.hazards - b.hazards));
    const head = wantTrain
      ? `⚠️ موظفين لسه تحت تارجت التدريب (${c.targetHours} ساعة لحد ${c.label}) — ${scopeLabel(scope, null)}: ${n2(missing.length)} من ${n2(total)}`
      : `⚠️ موظفين لسه تحت تارجت بلاغات الخطورة (${c.targetHazards} بلاغ لحد ${c.label}) — ${scopeLabel(scope, null)}: ${n2(missing.length)} من ${n2(total)}`;
    const lines = missing.slice(0, 10).map(r => `• ${r.emp.name} (${r.emp.empCode}) — ${r.emp.department} — ${wantTrain ? `${Math.round(r.hours * 10) / 10} ساعة` : arCount(r.hazards, 'بلاغ')}`);
    return {
      reply: `${head}\n${lines.join('\n')}${missing.length > 10 ? `\n… و${n2(missing.length - 10)} كمان (التفاصيل في تبويب "التدريب والتوعية").` : ''}`,
      source: SOURCE,
      suggestions: ['نسبة الالتزام لكل قسم', 'أحسن الأقسام التزامًا'],
    };
  }

  if ((WANT.breakdown.test(nq) || WANT.top.test(nq) || WANT.bottom.test(nq)) && !scope.depts.length) {
    const byDept = new Map();
    c.rows.forEach(r => {
      const d = String(r.emp.department || 'غير محدد').trim();
      if (!byDept.has(d)) byDept.set(d, { d, n: 0, t: 0, h: 0, sum: 0, pen: 0 });
      const b = byDept.get(d);
      b.n++; b.sum += r.score; b.pen += r.penalties;
      if (r.trainOk) b.t++; if (r.hazOk) b.h++;
    });
    let rows = [...byDept.values()].filter(b => b.n >= 3).map(b => ({
      ...b, score: Math.round(b.sum / b.n),
    })).sort((a, b) => b.score - a.score);
    const worst = WANT.bottom.test(nq);
    if (worst) rows = rows.slice().reverse();
    return {
      reply: `🏆 ${worst ? 'أقل' : 'أحسن'} الأقسام التزامًا بالأهداف — ${c.label}\n(المعيار: تدريب ${c.targetHours}س + ${arCount(c.targetHazards, 'بلاغ')} لكل موظف، وكل جزاء بيخصم ${c.penaltyDeduction} نقطة)\n${rows.slice(0, 10).map((b, i) => `${i + 1}) ${b.d}: ${b.score}% — تدريب ${pct(b.t, b.n)}% · بلاغات ${pct(b.h, b.n)}%${b.pen ? ` · ${arCount(b.pen, 'جزاء')} ⚖️` : ''} (${arCount(b.n, 'موظف')})`).join('\n')}`,
      source: SOURCE,
      suggestions: ['مين ناقصه تدريب؟', 'نسبة الالتزام الكلية', 'الجزاءات حسب القسم'],
    };
  }

  const avgScore = Math.round(c.rows.reduce((s, r) => s + r.score, 0) / total);
  const withPen = c.rows.filter(r => r.penalties).length;
  const penTotal = c.rows.reduce((s, r) => s + r.penalties, 0);
  return {
    reply: [
      `🎯 نسبة الالتزام بالأهداف — ${scopeLabel(scope, null)} · ${c.label}`,
      `• التارجت لحد دلوقتي: ${c.targetHours} ساعة تدريب و${arCount(c.targetHazards, 'بلاغ')} خطورة لكل موظف (من أول السنة).`,
      `• حققوا تارجت التدريب: ${n2(trainOk)} من ${n2(total)} (${pct(trainOk, total)}%)`,
      `• حققوا تارجت البلاغات: ${n2(hazOk)} من ${n2(total)} (${pct(hazOk, total)}%)`,
      penTotal ? `• جزاءات السنة دي: ${arCount(penTotal, 'جزاء')} على ${arCount(withPen, 'موظف')} (كل جزاء بيخصم ${c.penaltyDeduction} نقطة)` : '',
      `• الدرجة الكلية للنطاق ده: ${avgScore}%`,
    ].filter(Boolean).join('\n'),
    source: SOURCE,
    suggestions: ['أحسن الأقسام التزامًا', 'أقل الأقسام التزامًا', 'مين ناقصه تدريب؟'],
  };
}

module.exports = {
  complianceAnswer,
  complianceData,
  drillsAnswer,
  employeeProfileAnswer,
  employeesAnswer,
  penaltiesAnswer,
  trainingsAnswer,
};
