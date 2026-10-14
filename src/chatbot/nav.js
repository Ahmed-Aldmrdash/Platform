'use strict';

// "Open the … screen" requests: finds the tab and pre-fills the form, limited to tabs the role may open.

const kb = require('./kb');
const extract = require('./extract');
const followup = require('./followup');
const N = kb.normalizeArabic;

const WORKER = 'worker';
const ADMIN = 'admin';
const BOTH = 'both';

const TABS = [
  { key: 'dashboard', audience: BOTH, label: 'لوحة التحكم',
    words: ['لوحه التحكم', 'الداشبورد', 'داشبورد', 'dashboard', 'المؤشرات', 'الاحصائيات', 'الرسوم البيانيه'] },

  { key: 'worker', audience: WORKER, label: 'طلب تصريح عمل',
    words: ['طلب تصريح', 'نموذج طلب', 'تصريح عمل', 'تصاريح العمل', 'التصاريح', 'بيرميت', 'permit'] },
  { key: 'myhistory', audience: WORKER, label: 'سجل تصاريح العمل',
    words: ['سجل تصاريحي', 'سجل تصاريح العمل', 'سجل التصاريح', 'تصاريحي'] },
  { key: 'hazardWorker', audience: WORKER, label: 'الإبلاغ عن خطورة',
    words: ['الابلاغ عن خطوره', 'ابلاغ عن خطوره', 'بلاغ خطوره', 'بلاغ الخطوره', 'هازارد', 'hazard'] },
  { key: 'myhazards', audience: WORKER, label: 'سجل بلاغاتي',
    words: ['سجل بلاغاتي', 'سجل البلاغات', 'بلاغاتي'] },
  { key: 'trainingWorker', audience: WORKER, label: 'التدريب والتوعية',
    words: ['التدريب والتوعيه', 'التدريب', 'المحاضرات', 'محاضراتي', 'التوعيه', 'محاضره'] },
  { key: 'drillWorker', audience: WORKER, label: 'تجارب الطوارئ',
    words: ['تجارب الطوارئ', 'تجربه طوارئ', 'الاخلاء', 'drill'] },
  { key: 'penaltiesWorker', audience: WORKER, label: 'الجزاءات',
    words: ['الجزاءات', 'جزاءاتي', 'الجزاء', 'العقوبات'] },

  { key: 'sup', audience: ADMIN, label: 'تصاريح العمل',
    words: ['تصاريح العمل', 'التصاريح', 'لوحه المشرف', 'مراجعه التصاريح', 'permit'] },
  { key: 'supHazard', audience: ADMIN, label: 'بلاغات الخطورة',
    words: ['بلاغات الخطوره', 'البلاغات', 'الهازارد', 'hazard'] },
  { key: 'trainingAdmin', audience: ADMIN, label: 'إدارة التدريب',
    words: ['اداره التدريب', 'التدريب', 'المحاضرات', 'محاضره'] },
  { key: 'drillAdmin', audience: ADMIN, label: 'تجارب الطوارئ',
    words: ['تجارب الطوارئ', 'الاخلاء', 'drill'] },
  { key: 'penaltiesAdmin', audience: ADMIN, label: 'الجزاءات',
    words: ['الجزاءات', 'العقوبات', 'الجزاء'] },
  { key: 'employees', audience: ADMIN, label: 'الموظفين',
    words: ['الموظفين', 'دليل الموظفين', 'العمال', 'الموظفون'] },
  { key: 'inspections', audience: ADMIN, label: 'الفحص الشهري',
    words: ['الفحص الشهري', 'الفحوصات', 'الفحص'] },
  { key: 'users', audience: ADMIN, label: 'المستخدمين', roles: ['super_admin'],
    words: ['المستخدمين', 'الحسابات', 'اداره المستخدمين', 'اليوزرز'] },
  { key: 'auditlog', audience: ADMIN, label: 'سجل التدقيق', roles: ['super_admin', 'hse_admin'],
    words: ['سجل التدقيق', 'الاوديت', 'audit', 'سجل العمليات'] },
  { key: 'executive', audience: ADMIN, label: 'الشاشة التنفيذية', roles: ['super_admin', 'ceo', 'hse_director'],
    words: ['الشاشه التنفيذيه', 'التنفيذيه', 'executive', 'شاشه الاداره العليا'] },
];

const NAV_VERB = /(?:^|\s)(وديني|ودني|ودينى|اوديني|وصلني|خدني|روحني|روح بيا|نقلني|انقلني|رجعني|ارجعني|افتحلي|فتحلي|افتح|اروح|انتقل|سيبني في|خشني)/;
const NAV_NOUN = /(?:^|\s)(تبويب|التبويب|صفحه|الصفحه|شاشه|الشاشه)/;

const WANT = /(عايز|عاوز|عايزين|عاوزين|محتاج|محتاجين|نفسي|اريد|ابغي|ممكن|لو سمحت|اعملي|اعمللي)/;
const CREATION_VERB = /(اطلع|هطلع|هنطلع|اخرج|استخرج|اقدم|هقدم|اعمل|هعمل|هنعمل|حعمل|افتح|هفتح|اخد|هاخد|اطلب|هطلب|ابلغ|هبلغ|اسجل|هسجل|هشتغل|هنشتغل|هنقوم)/;
const PERMIT_WORD = /(تصريح|تصاريح|بيرميت|permit)/;
const HAZARD_WORD = /(ابلغ|هبلغ|بلاغ|ابلاغ|اشتكي|خطوره|خطورت|خطر|هازارد|hazard)/;
const HAZARD_SIGNAL = /(تسريب|حريقه|شراره|سلك مكشوف|زيت علي الارض|مفيش غطا|جسم ساقط|ريحه غاز|رائحه غاز|كهربا مكشوفه|مش امن|في خطر|فيه خطر)/;
const HAZARD_OBSERVE = /(شفت|شوفت|لقيت|لاقيت|لاحظت|شايف|في حاجه|فيه حاجه)/;
const HAZARD_DAMAGE = /(مكسور|مكسوره|مخلوع|مقطوع|مكشوف|مكشوفه|تالف|بايظ|باظ|ساقط|واقع|مفكوك|مفكوكه|سايب|متهالك|مصدي|مسرب|تسريب|زلق|شراره|حريق|دخان|ريحه غريبه|مش شغال|مش مثبت|مش مثبته|مش متثبت|مايل|بيهتز|مخلخل|مبلول|فاضيه|منتهي الصلاحيه|مقفول بالغلط)/;

const PERMIT_TYPE_LABEL = {
  general: 'عام', height: 'ارتفاع', confined: 'أماكن مغلقة',
  excavation: 'حفر', lifting: 'رفع', hot: 'ساخن', loto: 'فصل وعزل',
};

const ADMIN_TIER = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin', 'ceo', 'hse_director'];
const isAdmin = role => ADMIN_TIER.includes(role);

function matchTab(nq, role) {
  const admin = isAdmin(role);
  let best = null;
  let bestLen = 0;
  for (const tab of TABS) {
    if (tab.audience === WORKER && admin) continue;
    if (tab.audience === ADMIN && !admin) continue;
    if (tab.roles && !tab.roles.includes(role)) continue;
    for (const w of tab.words) {
      const nw = N(w);
      if (nw.length > bestLen && nq.includes(nw)) { best = tab; bestLen = nw.length; }
    }
  }
  return best;
}

function allowedTabs(role) {
  const admin = isAdmin(role);
  return TABS
    .filter(t => t.audience === BOTH || (t.audience === ADMIN) === admin)
    .filter(t => !t.roles || t.roles.includes(role));
}

function answerNav(text, ctx) {
  const q = String(text || '').trim();
  if (!q) return null;
  const nq = N(q);
  const user = (ctx && ctx.user) || {};
  const admin = isAdmin(user.role);

  const wants = WANT.test(nq);
  const creation = CREATION_VERB.test(nq);
  const isHistoryQuestion = /سجل|بتاعي|بتاعتي|اللي فاتت|القديمه|بلاغاتي|تصاريحي|جزاءاتي|محاضراتي|اشوف|شوفلي/.test(nq);
  const isHowTo = /(ازاي|كيف|ايه خطوات|ايه متطلبات|متطلبات|شروط|اجراءات|خطوات|قايمه التحقق|بتشتغل ازاي)/.test(nq)
    || /(^|\s)لو\s(?!سمحت)/.test(nq)
    || /(اعمل|نعمل|يعمل|اتصرف|نتصرف)\s+(اي|ايه|ازاي)(\s|$|[؟?])/.test(nq)
    || /(ماذا افعل|ايه اللي اعمله|المفروض اعمل|المفروض اعمل ايه|اعمل ايه|اعمل اي$)/.test(nq);

  const employees = (() => {
    try { return (ctx && ctx.data && typeof ctx.data.employees === 'function') ? ctx.data.employees() : []; }
    catch (e) { return []; }
  })();

  if (!admin && !isHowTo && PERMIT_WORD.test(nq) && (wants || creation) && !isHistoryQuestion) {
    const got = extract.extractPermitRequest(q, { employees });
    const filled = [];
    if (got.fill.desc) filled.push('وصف العملية');
    if (got.fill.workers) filled.push(`القائمين بالعمل (${got.fill.workers.split('\n').length})`);
    if (got.fill.location) filled.push('مكان العمل');
    const what = filled.length ? `وملّيتلك: ${filled.join('، ')}.` : '';
    const fq = followup.firstQuestion('permit', got.fill);
    const tail = fq ? `\n\n${fq.ask}` : '\nراجع كل حاجة، املا قايمة التحقق، وابعت الطلب بنفسك.';
    return {
      reply: `📋 تمام — فتحتلك تصريح "${PERMIT_TYPE_LABEL[got.permitType]}" ${what}${tail}`,
      action: { type: 'navigate', tab: 'worker', permitType: got.permitType, fill: got.fill },
      followup: fq ? fq.pending : null,
      source: null,
      suggestions: fq ? [] : [`متطلبات تصريح عمل ${PERMIT_TYPE_LABEL[got.permitType]}`, 'إزاي أطلع تصريح؟'],
    };
  }

  const shortStatement = q.length <= 70 && !/[؟?]/.test(q);
  const hazardIntent = HAZARD_SIGNAL.test(nq)
    || (HAZARD_WORD.test(nq) && (wants || creation))
    || (HAZARD_OBSERVE.test(nq) && HAZARD_DAMAGE.test(nq))
    || (HAZARD_OBSERVE.test(nq) && HAZARD_WORD.test(nq))
    || (HAZARD_DAMAGE.test(nq) && shortStatement);
  if (!admin && !isHowTo && hazardIntent && !isHistoryQuestion) {
    const got = extract.extractHazardReport(q, { employees });
    const labels = { desc: 'وصف الخطورة', area: 'المكان', dept: 'القسم', injury: 'الإصابة المحتملة', solution: 'الحل المقترح', likelihood: 'الاحتمالية', severity: 'الشدة' };
    const filled = Object.keys(got.fill).map(k => labels[k]).filter(Boolean);
    const what = filled.length ? `وملّيتلك: ${filled.join('، ')}.` : '';
    const fq = followup.firstQuestion('hazard', got.fill);
    const tail = fq ? `\n\n${fq.ask}` : '\nراجع اللي اتكتب وابعت البلاغ بنفسك.';
    return {
      reply: `⚠️ تمام — فتحتلك نموذج الإبلاغ عن خطورة ${what}${tail}`,
      action: { type: 'navigate', tab: 'hazardWorker', fill: got.fill },
      followup: fq ? fq.pending : null,
      source: null,
      suggestions: fq ? [] : ['بلاغاتي', 'أعمل إيه لو لقيت سلك مكشوف؟'],
    };
  }

  if (!NAV_VERB.test(nq) && !NAV_NOUN.test(nq)) return null;

  const tab = matchTab(nq, user.role);
  if (!tab) {
    const labels = allowedTabs(user.role).map(t => t.label);
    return {
      reply: `مش عارف قاصد أنهي تبويب بالظبط 🤔\nالتبويبات المتاحة ليك: ${labels.join(' · ')}.\nقولي مثلاً: "وديني على ${labels[1] || labels[0]}".`,
      source: null,
      suggestions: labels.slice(0, 4).map(l => `وديني على ${l}`),
    };
  }

  return {
    reply: `📂 تمام، بفتحلك "${tab.label}" دلوقتي.`,
    action: { type: 'navigate', tab: tab.key },
    source: null,
    suggestions: [],
  };
}

module.exports = { answerNav, allowedTabs, TABS };
