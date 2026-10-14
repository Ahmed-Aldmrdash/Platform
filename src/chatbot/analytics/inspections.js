'use strict';

// Monthly inspection answers: programme, section and item lookups.

const { normalizeArabic, STOP } = require('../kb');
const { arr, fmtDate, MONTHS, n2, pct, short, SOURCE } = require('./shared');

const AR_MONTH_NAMES = MONTHS;
const INSP_STATUS_ICON = { 'مطابق': '✅', 'غير مطابق': '⛔' };
const INSP_NOISE = new Set(['الفحص', 'فحص', 'الشهري', 'الشهريه', 'شهر', 'في', 'عن', 'اللي', 'الي', 'حاله', 'حالة', 'نتيجه', 'نتيجة', 'ايه', 'كام', 'عدد', 'كان', 'بقي', 'ازاي', 'وضع', 'وضعها', 'مكان', 'المكان', 'برنامج', 'p1', 'p2', 'b1', 'b2', 'الي', 'بتاع', 'بتاعه', 'بتاعت']);

function detectInspectionCategory(nq) {
  if (/(^|\s)(p\s*2|b\s*2|بي 2|بي2|برنامج 2|المبني 2|مبني 2)(\s|$)/.test(nq)) return 'P2';
  if (/(^|\s)(p\s*1|b\s*1|بي 1|بي1|برنامج 1|المبني 1|مبني 1)(\s|$)/.test(nq)) return 'P1';
  return null;
}

function matchInspectionSection(nq, sections, cat) {
  const pool = cat ? sections.filter(s => s.category === cat) : sections;
  const scored = pool.map(s => {
    const words = normalizeArabic(s.name || '').split(' ').filter(w => w.length >= 3);
    if (!words.length) return { s, hits: 0 };
    let hits = 0;
    words.forEach(w => {
      const stem = w.slice(0, Math.max(4, w.length - 2));
      if (nq.includes(w) || nq.includes(stem)) hits++;
    });
    return { s, hits: hits / words.length };
  }).sort((a, b) => b.hits - a.hits);
  return scored[0] && scored[0].hits >= 0.5 ? scored[0].s : null;
}

function findInspectionItems(nq, items, sectionIds) {
  const words = nq.split(' ').map(w => w.trim()).filter(w => w.length >= 2 && !INSP_NOISE.has(w) && !STOP.has(w));
  if (!words.length) return [];
  const pool = sectionIds ? items.filter(i => sectionIds.has(i.sectionId)) : items;
  const scored = pool.map(it => {
    const hay = normalizeArabic(`${it.name || ''} ${it.location || ''} ${it.department || ''} ${it.itemNumber || ''}`);
    let hits = 0;
    words.forEach(w => { if (hay.includes(w)) hits++; });
    return { it, hits };
  }).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits);
  if (!scored.length) return [];
  const best = scored[0].hits;
  return scored.filter(x => x.hits === best).map(x => x.it).slice(0, 6);
}

function inspectionsAnswer(nq, ctx, period) {
  const sections = arr(ctx.data.inspectionSections);
  const items = arr(ctx.data.inspectionItems);
  const records = arr(ctx.data.inspectionRecords);
  if (!sections.length) return { reply: 'مفيش بيانات فحص شهري مسجّلة لحد دلوقتي.', source: SOURCE };

  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth() + 1;
  if (period) { year = period.from.getFullYear(); month = period.from.getMonth() + 1; }
  const cat = detectInspectionCategory(nq);
  const secPool = cat ? sections.filter(s => s.category === cat) : sections;
  const matchedSection = matchInspectionSection(nq, sections, cat);

  const sectionIds = matchedSection ? new Set([matchedSection.id]) : (cat ? new Set(secPool.map(s => s.id)) : null);
  const hits = findInspectionItems(nq, items, sectionIds);
  const askingItem = hits.length && (matchedSection || cat || /غرفه|مكان|جنب|امام|داخل|رقم/.test(nq));
  if (askingItem) {
    const secById = new Map(sections.map(s => [s.id, s]));
    const lines = hits.map(it => {
      const recs = records.filter(r => r.itemId === it.id).sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
      const wanted = period ? recs.find(r => r.year === year && r.month === month) : recs[0];
      const sec = secById.get(it.sectionId);
      const where = [it.location, it.department].filter(Boolean).join(' — ');
      const head = `• ${it.name || `${sec ? sec.name : ''} #${it.itemNumber}`}${it.itemNumber ? ` (رقم ${it.itemNumber})` : ''}${where ? ` — ${where}` : ''}`;
      if (!wanted) {
        return `${head}\n   ${period ? `مفيش فحص مسجّل لـ ${AR_MONTH_NAMES[month - 1]} ${year}` : 'لسه مفيش فحص مسجّل'}${recs.length ? ` (آخر فحص: ${AR_MONTH_NAMES[recs[0].month - 1]} ${recs[0].year} — ${recs[0].status})` : ''}`;
      }
      return `${head}\n   ${AR_MONTH_NAMES[wanted.month - 1]} ${wanted.year}: ${wanted.status} ${INSP_STATUS_ICON[wanted.status] || ''}${wanted.notes ? ` — ${short(wanted.notes, 80)}` : ''}${wanted.inspector ? ` · الفاحص: ${wanted.inspector}` : ''}${wanted.inspectionDate ? ` · ${fmtDate(wanted.inspectionDate)}` : ''}`;
    });
    const secName = matchedSection ? `${matchedSection.name} (${matchedSection.category})` : (cat ? `برنامج ${cat}` : 'الفحص الشهري');
    return {
      reply: `🔍 ${secName}:\n${lines.join('\n')}${hits.length >= 6 ? '\n… فيه أصناف تانية قريبة من وصفك، حدّد المكان أكتر.' : ''}`,
      source: SOURCE,
      suggestions: ['الأصناف غير المطابقة', 'نسبة المطابقة الشهر ده'],
    };
  }

  const secIn = matchedSection ? [matchedSection] : secPool;
  const secIds = new Set(secIn.map(s => s.id));
  const itemsIn = items.filter(i => secIds.has(i.sectionId));
  const scopedRecords = records.filter(r => secIds.has(r.sectionId));
  let recsIn = scopedRecords.filter(r => r.year === year && r.month === month);
  if (!recsIn.length && !period) {
    const latest = scopedRecords.slice().sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))[0];
    if (latest) {
      year = latest.year; month = latest.month;
      recsIn = scopedRecords.filter(r => r.year === year && r.month === month);
    }
  }
  const okCount = recsIn.filter(r => r.status === 'مطابق').length;
  const badCount = recsIn.filter(r => r.status === 'غير مطابق').length;
  const done = okCount + badCount;
  const label = `${AR_MONTH_NAMES[month - 1]} ${year}`;
  const scopeName = matchedSection ? `${matchedSection.name} (${matchedSection.category})` : (cat ? `برنامج ${cat}` : '');

  if (badCount && /غير مطابق|غير المطابق|مشاكل|ملاحظات|مخالف/.test(nq)) {
    const itemById = new Map(itemsIn.map(i => [i.id, i]));
    const bad = recsIn.filter(r => r.status === 'غير مطابق').slice(0, 10);
    return {
      reply: `🔍 أصناف غير مطابقة في فحص ${label}${scopeName ? ` — ${scopeName}` : ''}: ${n2(badCount)}\n${bad.map(r => { const it = itemById.get(r.itemId) || {}; return `• ${it.name || r.itemId}${it.itemNumber ? ` (رقم ${it.itemNumber})` : ''} — ${it.location || it.department || '—'}${r.notes ? ` — ${short(r.notes, 70)}` : ''}`; }).join('\n')}${badCount > 10 ? `\n… و${n2(badCount - 10)} كمان.` : ''}`,
      source: SOURCE,
      suggestions: ['نسبة المطابقة', 'الفحص الشهري'],
    };
  }

  return {
    reply: [
      `🔍 الفحص الشهري${scopeName ? ` — ${scopeName}` : ''} · ${label}`,
      `• عدد الأقسام: ${n2(secIn.length)} · عدد الأصناف: ${n2(itemsIn.length)}`,
      `• اتفحص الشهر ده: ${n2(done)} صنف${itemsIn.length ? ` (${pct(done, itemsIn.length)}% من الأصناف)` : ''}`,
      `• مطابق: ${n2(okCount)} · غير مطابق: ${n2(badCount)}`,
      done ? `• نسبة المطابقة: ${pct(okCount, done)}%` : '• لسه مفيش نتايج مسجّلة للشهر ده',
    ].join('\n'),
    source: SOURCE,
    suggestions: ['الأصناف غير المطابقة', 'فحص P2', 'كام بلاغ مفتوح؟'],
  };
}

module.exports = {
  detectInspectionCategory,
  findInspectionItems,
  inspectionsAnswer,
  matchInspectionSection,
};
