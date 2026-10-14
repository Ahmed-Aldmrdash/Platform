'use strict';

// Shared pieces of the statistics answers: record helpers, period / entity / scope detection
// and the data the asker is allowed to see.

const { normalizeArabic, arCount } = require('../kb');
const { detectDepartments } = require('../org');

const SOURCE = 'بيانات المنصة الحية';
const ADMIN_ROLES = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin', 'ceo', 'hse_director'];
const DEPT_SCOPED = ['dept_admin', 'maint_admin'];
const TRAIN_TARGET = 8;
const HAZARD_TARGET = 2;
const PENALTY_DEDUCTION = 15;

const n2 = v => Number(v || 0).toLocaleString('en-US');
const normCode = v => String(v == null ? '' : v).trim().replace(/^0+/, '').toUpperCase();
const normName = v => normalizeArabic(v).replace(/\s+/g, ' ').trim();
const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function arr(fn) { try { const v = typeof fn === 'function' ? fn() : fn; return Array.isArray(v) ? v : []; } catch { return []; } }
function fmtDate(d) {
  const x = new Date(d);
  return isNaN(x) ? String(d || '—') : x.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}
const dateOf = x => new Date(x.date || x.submittedAt || x.createdAt || 0);
const isDeletedRec = r => Boolean(
  r.deleted || r.isDeleted || r.deletedAt ||
  (r.deletedBy && typeof r.deletedBy === 'object' && Object.values(r.deletedBy).some(Boolean)) ||
  (r.permanentlyDeletedBy && typeof r.permanentlyDeletedBy === 'object' && Object.values(r.permanentlyDeletedBy).some(Boolean))
);

const HAZ_OPEN = h => !/^(closed|resolved|rejected)/.test(String(h.status || 'open'));
const HAZ_DONE = h => /^(closed|resolved)/.test(String(h.status || ''));
const HAZ_REJECTED = h => /^rejected/.test(String(h.status || ''));
const RISK_LABEL = { H: 'عالية', M: 'متوسطة', L: 'منخفضة', C: 'حرجة' };
const riskOf = h => String(h.riskLevel || '').toUpperCase();
const HOURS_48 = 48 * 3600 * 1000;

const PERMIT_PENDING = p => /^pending/.test(String(p.status || ''));
const PERMIT_STATUS_LABEL = {
  approved: 'معتمد', pending: 'مستني أدمن القسم', pending_dept: 'مستني أدمن القسم',
  pending_area_head: 'مستني أدمن القسم', pending_hse: 'مستني اعتماد السلامة', rejected: 'مرفوض',
  closed_safe: 'اتقفل بأمان', closed_incomplete: 'اتقفل (لم يكتمل)', closed_forced: 'إغلاق جبري',
};
const PERMIT_TYPE_LABEL = {
  lockout: 'فصل وعزل (LOTO)', general: 'عام', hot: 'عمل ساخن', height: 'عمل على ارتفاعات',
  lifting: 'رفع', excavation: 'حفر', confined: 'أماكن مغلقة',
};

function trainingHours(t) {
  for (const k of ['durationHours', 'hours', 'duration']) {
    const v = t[k];
    if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) return Number(v);
  }
  return t.durationMinutes ? Number(t.durationMinutes) / 60 : 0.5;
}
const attCode = a => normCode(a && (a.empCode || a.code || a.employeeCode || a.id));

const MONTHS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_NUM = { 'واحد': 1, 'اتنين': 2, 'تلاته': 3, 'ثلاثه': 3, 'اربعه': 4, 'خمسه': 5, 'سته': 6, 'سبعه': 7, 'تمانيه': 8, 'تسعه': 9, 'عشره': 10 };

function detectPeriod(nq) {
  const now = new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mk = (from, to, label) => ({ from, to, label });

  if (/النهارده|اليوم|النهاردة/.test(nq)) return mk(startOfDay(now), now, 'النهاردة');
  if (/امبارح|البارحه/.test(nq)) {
    const y = startOfDay(new Date(now.getTime() - 86400000));
    return mk(y, new Date(y.getTime() + 86399999), 'إمبارح');
  }
  if (/الاسبوع ده|الاسبوع الحالي|اخر اسبوع|خلال اسبوع|الاسبوع اللي فات/.test(nq)) {
    return mk(new Date(now.getTime() - 7 * 86400000), now, 'آخر 7 أيام');
  }
  if (/الشهر اللي فات|الشهر الماضي|الشهر السابق/.test(nq)) {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return mk(from, to, `شهر ${MONTHS[from.getMonth()]} ${from.getFullYear()}`);
  }
  if (/الشهر ده|الشهر الحالي|شهر كام|خلال الشهر|(^|\s)الشهر(\s|$)/.test(nq) && !/شهور|اشهر/.test(nq)) {
    return mk(new Date(now.getFullYear(), now.getMonth(), 1), now, `شهر ${MONTHS[now.getMonth()]}`);
  }
  if (/السنه دي|السنه الحاليه|من اول السنه|هذا العام|(^|\s)السنه(\s|$)/.test(nq) && !/سنين|سنوات/.test(nq)) {
    return mk(new Date(now.getFullYear(), 0, 1), now, `سنة ${now.getFullYear()}`);
  }
  if (/السنه اللي فاتت|العام الماضي/.test(nq)) {
    const y = now.getFullYear() - 1;
    return mk(new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59), `سنة ${y}`);
  }
  if (/الربع/.test(nq)) {
    const qIdx = /الاول/.test(nq) ? 0 : /التاني|الثاني/.test(nq) ? 1 : /التالت|الثالث/.test(nq) ? 2 : /الرابع/.test(nq) ? 3 : Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), qIdx * 3, 1);
    const to = new Date(now.getFullYear(), qIdx * 3 + 3, 0, 23, 59, 59);
    return mk(from, to > now ? now : to, `الربع ${['الأول', 'الثاني', 'الثالث', 'الرابع'][qIdx]} ${now.getFullYear()}`);
  }
  const rel = nq.match(/اخر\s+(\d+|واحد|اتنين|تلاته|ثلاثه|اربعه|خمسه|سته|سبعه|تمانيه|تسعه|عشره)?\s*(يوم|ايام|شهر|شهور|اشهر|سنه|سنين|سنوات)/);
  if (rel) {
    const num = rel[1] ? (AR_NUM[rel[1]] || parseInt(rel[1], 10) || 1) : (/شهرين|يومين|سنتين/.test(nq) ? 2 : 1);
    const unit = rel[2];
    if (/يوم|ايام/.test(unit)) return mk(new Date(now.getTime() - num * 86400000), now, `آخر ${arCount(num, 'يوم')}`);
    if (/شهر|شهور|اشهر/.test(unit)) return mk(new Date(now.getFullYear(), now.getMonth() - num, now.getDate()), now, `آخر ${arCount(num, 'شهر')}`);
    return mk(new Date(now.getFullYear() - num, now.getMonth(), now.getDate()), now, `آخر ${arCount(num, 'سنة')}`);
  }
  for (let i = 0; i < MONTHS.length; i++) {
    if (new RegExp(`(^|\\s)${MONTHS[i]}(\\s|$)`).test(nq)) {
      const ym = nq.match(/20\d\d/);
      const year = ym ? Number(ym[0]) : now.getFullYear();
      return mk(new Date(year, i, 1), new Date(year, i + 1, 0, 23, 59, 59), `${MONTHS[i]} ${year}`);
    }
  }
  const ym = nq.match(/(^|\s)(20\d\d)(\s|$)/);
  if (ym) {
    const year = Number(ym[2]);
    return mk(new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59), `سنة ${year}`);
  }
  return null;
}

const inPeriod = (rec, period) => {
  if (!period) return true;
  const d = dateOf(rec);
  if (isNaN(d)) return true;
  return d >= period.from && d <= period.to;
};

const ENTITY_RE = [
  ['hazards', /بلاغ|بلاغات|هازارد|هزارد|هاوارد|خطوره|خطورة|الخطور|hazard|haz-|مخاطر متسجل|بيبلغ|بتبلغ|بلغ|تبليغ|ابلاغ/],
  ['permits', /تصريح|تصاريح|بيرمت|permit|wp-|لوتو|loto/],
  ['trainings', /محاضر|تدريب|كورس|سيشن|training|ساعات تدريب/],
  ['drills', /تجربه|تجارب|درل|drill|اخلا|اخلاء/],
  ['penalties', /جزا|جزاء|عقوب|مخالف|انذار|خصم|penalt/],
  ['employees', /موظف|موظفين|عامل|عمال|العمال|افراد|الافراد|فرد|headcount/],
  ['compliance', /التزام|تارجت|target|اهداف|هدف|انجاز|تحقيق الهدف/],
  ['inspections', /فحص شهري|الفحص الشهري|inspection|تفتيش|اصناف الفحص|غير مطابق|غير المطابق|المطابقه|فحص p ?[12]|نتايج الفحص/],
];

function detectEntity(nq) {
  const hits = ENTITY_RE.filter(([, re]) => re.test(nq)).map(([k]) => k);
  if (!hits.length) return null;
  if (hits.includes('compliance') && /نسبه|نسبة|التزام|تارجت|target/.test(nq)) return 'compliance';
  return hits[0];
}

const w = words => new RegExp(`(^|\\s)(ال|و|ب|ف)?(${words})(\\s|$)`);
const WANT = {
  count: w('كام|كم|عدد|اعداد|اجمالي|مجموع|احصاييه|احصاييات|total'),
  list: /(^|\s)(اعرض|اعرضلي|وريني|ورينى|هاتلي|جيبلي|اشوف|قايمه|قائمه|اسماء|اسامي|تفاصيل|list)(\s|$)|ايه هي|ايه اللي|عايز اشوف|عايز قايمه/,
  latest: /(^|\s)(اخر|احدث|اجدد|اخرهم|الاخير|الاخيره|الجديد)(\s|$)|latest/,
  oldest: /(^|\s)(اقدم|الاقدم|اول)(\s|$)/,
  breakdown: /لكل قسم|كل قسم|حسب القسم|بالاقسام|توزيع|حسب النوع|كل نوع|الانواع|انواع|حسب الحاله|حسب الخطوره|تفصيل|ترتيب الاقسام|اكتر قسم|اكتر الاقسام|انهي قسم|اي قسم|اكتر نوع|اكتر الانواع|انهي نوع|اكتر واحد|اكتر حد|اقل قسم/,
  top: /(^|\s)(اكتر|اكثر|اعلي|اكبر|احسن|افضل|الاكتر|الاعلي)(\s|$)|top/,
  bottom: /(^|\s)(اقل|اسوا|اضعف|اقلهم|الاقل)(\s|$)/,
};

const STATE = {
  open: /(^|\s)(مفتوح|مفتوحه|المفتوحه|المفتوح|لسه|لسا|مستني|مستنيه|منتظر|معلق|معلقه|جاري|شغال|pending)(\s|$)|متقفلش|مقفلش|ماتقفلش|مش مقفول|مش متقفل|لم يغلق|لسه مفتوح/,
  closed: /(^|\s)(مقفول|مقفوله|المقفوله|مغلق|مغلقه|اتقفل|اتقفلت|اتحل|اتحلت|محلول|منتهي|منتهيه|closed|resolved)(\s|$)|تم الحل|تم الاغلاق/,
  overdue: /(^|\s)(متاخر|متاخره|المتاخره|متعطل)(\s|$)|48|فات عليه|بقاله|عدي عليه|عدت عليه/,
  rejected: /(^|\s)(مرفوض|مرفوضه|اترفض|rejected)(\s|$)/,
  high: /(^|\s)(خطير|خطيره|عالي|عاليه|العاليه|حرج|حرجه|شديد|كبير|high|critical)(\s|$)/,
  medium: /(^|\s)(متوسط|متوسطه|medium)(\s|$)/,
  low: /(^|\s)(منخفض|منخفضه|بسيط|low)(\s|$)/,
  approved: /(^|\s)(معتمد|معتمده|المعتمده|موافق|اتوافق|approved)(\s|$)|تم الاعتماد/,
};

const PERMIT_TYPE_HINTS = [
  ['lockout', /فصل وعزل|لوتو|loto|lockout|عزل الطاقه|القفل/],
  ['hot', /ساخن|لحام|قطع|حراره|hot/],
  ['height', /ارتفاع|ارتفاعات|سقاله|height/],
  ['confined', /مغلق|مغلقه|خزان|confined/],
  ['excavation', /حفر|excavation/],
  ['lifting', /رفع|ونش|رافعه|lifting/],
];
const detectPermitType = nq => (PERMIT_TYPE_HINTS.find(([, re]) => re.test(nq)) || [null])[0];
const MISSING_RE = /ناقص|ناقصه|ناقصين|مقصر|مقصرين|محققش|محققوش|مش محقق|تحت التارجت|اقل من التارجت|متاخر عن التارجت/;

const MY_DEPT_STRONG = /(^|\s)(قسمي|قسمى|قسمنا|بقسمي|لقسمي)(\s|$)|القسم بتاعي|القسم بتاعنا|قسم بتاعي|في قسمي/;
const MY_DEPT_BARE = /(^|\s)(في |ب|ال)?القسم(\s|$)/;
const DEPT_BREAKDOWN_RE = /لكل قسم|كل قسم|حسب القسم|بالاقسام|الاقسام|ترتيب الاقسام|كل الاقسام|توزيع/;

function myDepartment(ctx) {
  const code = normCode(ctx.user && ctx.user.empCode);
  const emp = code ? arr(ctx.data.employees).find(e => normCode(e.empCode || e.code) === code) : null;
  return String((emp && emp.department) || (ctx.user && ctx.user.department) || '').trim();
}

function scopeOf(ctx, nq) {
  const role = ctx.user && ctx.user.role;
  const employees = arr(ctx.data.employees);
  const known = [...new Set(employees.map(e => String(e.department || '').trim()).filter(Boolean))];
  if (DEPT_SCOPED.includes(role)) {
    const d = String((ctx.user && ctx.user.department) || '') || myDepartment(ctx);
    const asked = detectDepartments(nq, known).filter(x => !deptEq(x, d));
    return { depts: d ? [d] : [], dept: d, forced: true, deniedDept: asked[0] || '' };
  }
  const found = detectDepartments(nq, known);
  if (found.length) return { depts: found, dept: found.length === 1 ? found[0] : '', forced: false };
  if (!DEPT_BREAKDOWN_RE.test(nq) && (MY_DEPT_STRONG.test(nq) || MY_DEPT_BARE.test(nq))) {
    const d = myDepartment(ctx);
    if (d) return { depts: [d], dept: d, forced: false, mine: true };
  }
  return { depts: [], dept: '', forced: false };
}
const deptEq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const inScope = (recDept, scope) => !scope.depts.length || scope.depts.some(d => deptEq(d, recDept));

function withScopeNote(answer, scope) {
  if (!answer || !answer.reply || !scope || !scope.forced || !scope.deniedDept) return answer;
  const note = `🔒 صلاحيتك على قسم ${scope.dept} بس — مش هينفع أعرض بيانات قسم ${scope.deniedDept}. دي أرقام قسمك:`;
  return { ...answer, reply: `${note}\n\n${answer.reply}` };
}

function scopeLabel(scope, period) {
  const where = !scope.depts.length ? 'المصنع كله'
    : scope.depts.length === 1 ? `قسم ${scope.depts[0]}${scope.mine ? ' (قسمك)' : ''}`
      : `أقسام ${scope.depts.join('، ')}`;
  return period ? `${where} — ${period.label}` : where;
}

function detectEmployee(question, ctx) {
  const employees = arr(ctx.data.employees);
  if (!employees.length) return null;
  const codeMatch = String(question).match(/(?:^|[^\d])(\d{3,6})(?:[^\d]|$)/);
  if (codeMatch) {
    const code = normCode(codeMatch[1]);
    const emp = employees.find(e => normCode(e.empCode || e.code) === code);
    if (emp) return emp;
  }
  const nq = normName(question);
  const words = nq.split(' ').filter(w => w.length >= 3);
  if (words.length < 2) return null;
  let best = null;
  employees.forEach(e => {
    const parts = normName(e.name).split(' ').filter(Boolean);
    if (parts.length < 2) return;
    const hits = parts.filter(p => words.includes(p)).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { emp: e, hits };
  });
  return best ? best.emp : null;
}

function dataFor(ctx, scope, period) {
  const hazards = arr(ctx.data.hazards).filter(h => !isDeletedRec(h) && inScope(h.department || h.dept, scope) && inPeriod(h, period));
  const permits = arr(ctx.data.permits).filter(p => !isDeletedRec(p) && inScope(p.department, scope) && inPeriod(p, period));
  const penalties = arr(ctx.data.penalties).filter(p => p.status !== 'deleted' && inScope(p.department, scope) && inPeriod(p, period));
  const employees = arr(ctx.data.employees).filter(e => inScope(e.department, scope));
  const deptCodes = new Set(employees.map(e => normCode(e.empCode || e.code)).filter(Boolean));
  let trainings = arr(ctx.data.trainings).filter(t => !isDeletedRec(t) && inPeriod(t, period));
  let drills = arr(ctx.data.drills).filter(d => !isDeletedRec(d) && inPeriod(d, period));
  if (scope.depts.length) {
    trainings = trainings
      .map(t => ({ ...t, attendees: (t.attendees || []).filter(a => deptCodes.has(attCode(a))) }))
      .filter(t => t.attendees.length);
    drills = drills
      .map(d => ({ ...d, attendees: (d.attendees || []).filter(a => deptCodes.has(attCode(a))) }))
      .filter(d => d.attendees.length);
  }
  return { hazards, permits, penalties, employees, trainings, drills };
}

const helpers = {
  normCode, normName, dateOf, isDeletedRec, trainingHours, attCode, arr, inScope,
  HAZ_OPEN, HAZ_DONE, HAZ_REJECTED, riskOf, RISK_LABEL, HOURS_48,
  PERMIT_PENDING, PERMIT_STATUS_LABEL, PERMIT_TYPE_LABEL,
  TRAIN_TARGET, HAZARD_TARGET, PENALTY_DEDUCTION,
};

module.exports = {
  helpers,
  ADMIN_ROLES,
  arr,
  attCode,
  dataFor,
  dateOf,
  detectEmployee,
  detectEntity,
  detectPeriod,
  detectPermitType,
  fmtDate,
  HAZ_DONE,
  HAZ_OPEN,
  HAZ_REJECTED,
  HAZARD_TARGET,
  HOURS_48,
  inScope,
  isDeletedRec,
  MISSING_RE,
  MONTHS,
  n2,
  normCode,
  normName,
  pct,
  PENALTY_DEDUCTION,
  PERMIT_PENDING,
  PERMIT_STATUS_LABEL,
  PERMIT_TYPE_LABEL,
  RISK_LABEL,
  riskOf,
  scopeLabel,
  scopeOf,
  short,
  SOURCE,
  STATE,
  TRAIN_TARGET,
  trainingHours,
  WANT,
  withScopeNote,
};
