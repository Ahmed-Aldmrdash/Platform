'use strict';

// Safety assistant entry point: a question goes through the local layers (navigation, personal data,
// statistics, org chart, SDS, safety instructions) and only reaches the optional LLM when none of them answers.

const kb = require('./kb');
const sds = require('./sds');
const org = require('./org');
const personal = require('./personal');
const analytics = require('./analytics');
const platform = require('./platform');
const nav = require('./nav');
const followup = require('./followup');
const llm = require('./llm');
const procedures = require('./knowledge/permit-procedures.json');

const ADMIN_TIER = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin', 'ceo', 'hse_director'];
function isAdminRole(role) { return ADMIN_TIER.includes(role); }

const firstName = user => String((user && user.name) || '').replace(/^\s*(م|ا|أ|د)\s*\/\s*/, '').trim().split(/\s+/)[0] || '';

function defaultSuggestions(user) {
  return isAdminRole(user && user.role)
    ? ['كام بلاغ مفتوح؟', 'آخر بلاغ مفتوح', 'نسبة الالتزام لكل قسم', 'تعرف تعمل إيه؟']
    : ['محاضراتي', 'التارجت بتاعي', 'بلاغاتي', 'مين مدير قسمي؟'];
}

function introReply(user) {
  const name = firstName(user);
  const admin = isAdminRole(user && user.role);
  return {
    reply: [
      `${name ? `أهلاً يا ${name}! ` : ''}أنا "مساعد السلامة" 🦺 — المساعد الذكي لمنصة السلامة والصحة المهنية في السويدي بوليمرز.`,
      `شغلتي إني أرد على أسئلتك في ثانية من مصادر المصنع الرسمية ومن بيانات المنصة:`,
      `📘 تعليمات السلامة SE-W01 — 38 مكان وعملية (التندة، المخازن، البنزينة، الأوناش، الفصل والعزل...)`,
      `🚨 فرق الطوارئ — الأزمات، الإخلاء، الإطفاء، الإنقاذ، الصيانة، استعادة الأوضاع`,
      `🧪 كروت SDS — ${kb.arCount(sds.count, 'مادة')} كيميائية (المخاطر، الإسعافات، الإطفاء، التخزين، الانسكاب)`,
      `👔 الهيكل الإداري — المدير العام، قيادة الـ HSE، مديرين الأقسام والمناطق`,
      admin
        ? `📊 أرقام المصنع الحية — البلاغات، التصاريح، التدريب، تجارب الطوارئ، الجزاءات، نسب الالتزام، وبيانات أي موظف`
        : `👤 بياناتك انت — محاضراتك، التارجت بتاعك، بلاغاتك، تصاريحك، جزاءاتك`,
      ``,
      `بفهم العامية، ومش مشكلة لو فيه غلطة إملائية. ومش بألّف إجابات: كل رد بقولك مصدره، ولو السؤال برّه اللي عندي هقولك بصراحة.`,
      `اكتب "تعرف تعمل إيه؟" وهعرضلك كل اللي أقدر أجاوب عليه.`,
    ].join('\n'),
    source: null,
    suggestions: defaultSuggestions(user),
  };
}

const WORKER_ABILITIES = [
  `🦺 أنا مساعد السلامة — دي كل الحاجات اللي تقدر تسألني عنها:`,
  ``,
  `👤 بياناتك انت:`,
  `• "محاضراتي" / "حضرت محاضرات إيه؟" / "ساعات التدريب بتاعتي"`,
  `• "التارجت بتاعي" / "فاضلي كام ساعة؟"`,
  `• "بلاغاتي" / "سجل الهازارد بتاعي" / "بلاغ HZ-2026-1038"`,
  `• "تصاريحي" / "تصريح WP-2026-2725"`,
  `• "جزاءاتي" · "تجارب الطوارئ اللي حضرتها" · "بياناتي"`,
  `• "فيه محاضرة شغالة دلوقتي؟" · "طلبات المحاضرات بتاعتي"`,
  ``,
  `📱 فيتشرز المنصة:`,
  `• "هوصلني إشعار وأنا قافل التطبيق؟" · "إزاي أطلب محاضرة؟" · "فيه اختبار بعد المحاضرة؟"`,
  ``,
  `📘 تعليمات السلامة (SE-W01):`,
  `• "ألبس إيه في مخزن الصبغات؟" · "تعليمات التندة" · "خطوات اللوتو"`,
  `• "أعمل إيه لو لقيت سلك مكشوف؟" · "إسعافات أولية لحد أغمى عليه"`,
  `• اكتب "المواضيع" تشوف الـ 38 قسم كلهم`,
  ``,
  `🚨 فرق الطوارئ:`,
  `• "مين في فريق الإطفاء؟" · "مهام فريق الإخلاء" · "منطقة التجمع فين؟"`,
  ``,
  `🧪 كروت SDS للمواد الكيميائية:`,
  `• "إسعافات الأسيتون لو وقع على الجلد" · "إزاي أطفي حريق الطولوين"`,
  `• "تخزين الكاربون بلاك" · "انسكاب الـ DOP" · "مهمات الوقاية لمادة كذا"`,
  ``,
  `👔 الهيكل الإداري:`,
  `• "مين مدير قسمي؟" · "مين الـ HSE دايركتور؟" · "مين المدير العام؟"`,
  ``,
  `📝 تصاريح العمل:`,
  `• "إزاي أطلع تصريح؟" · "متطلبات تصريح عمل ساخن"`,
  ``,
  `أرقام المصنع كلها (عدد البلاغات، التصاريح، بيانات باقي الموظفين) بتبقى للإدارة بس.`,
];

const ADMIN_ABILITIES = [
  `🦺 أنا مساعد السلامة — ودي قائمة اللي أقدر أعمله لحضرتك كإدارة:`,
  ``,
  `📊 أرقام وتحليلات حيّة (تقدر تحدد الفترة: "الشهر ده" / "السنة دي" / "آخر 30 يوم" / "الربع التالت"، وتحدد القسم بالاسم):`,
  `• بلاغات الخطورة: "كام بلاغ مفتوح؟" · "مجموع البلاغات" · "آخر بلاغ مفتوح" · "بلاغات عالية الخطورة لسه مفتوحة" · "بلاغات متأخرة أكتر من 48 ساعة" · "البلاغات حسب القسم" · "بلاغات قسم الجودة الشهر ده" · "بلاغ HAZ-..."`,
  `• تصاريح العمل: "كام تصريح عمل؟" · "تصاريح مستنية اعتماد" · "التصاريح حسب النوع" · "آخر تصريح" · "تصاريح الصيانة السنة دي"`,
  `• التدريب: "كام محاضرة؟" · "إجمالي ساعات التدريب" · "أكتر مواضيع التدريب" · "فيه محاضرة شغالة؟" · "مين ناقصه تدريب؟"`,
  `• تجارب الطوارئ: "كام تجربة طوارئ؟" · "آخر تجربة طوارئ"`,
  `• الجزاءات: "كام جزاء؟" · "آخر الجزاءات" · "أكتر أسباب الجزاءات" · "الجزاءات حسب القسم"`,
  `• الموظفين: "كام موظف؟" · "عدد الموظفين لكل قسم" · "بيانات الموظف 5504" · "سجل محمد عبد الله" (بيانات كاملة + رقم الموبايل)`,
  `• الالتزام بالأهداف: "نسبة الالتزام" · "نسبة الالتزام لكل قسم" · "أحسن الأقسام التزامًا" · "أقل الأقسام التزامًا"`,
  `• الفحص الشهري: "الفحص الشهري" · "الأصناف غير المطابقة" · "فحص P2"`,
  `• "ملخص المصنع" أو "الوضع عامل إيه؟" → نظرة سريعة على كل حاجة.`,
  ``,
  `📘 تعليمات السلامة SE-W01 · 🚨 فرق الطوارئ · 🧪 كروت SDS · 👔 الهيكل الإداري · 📝 متطلبات تصاريح العمل — زي ما هي للكل.`,
  ``,
  `📱 فيتشرز المنصة: "الفئة المستهدفة للمحاضرة إزاي؟" · "أعمل اختبار بعد المحاضرة إزاي؟" · "الإشعارات بتشتغل إزاي؟"`,
  ``,
  `ملاحظة: أدمن القسم بيشوف بيانات قسمه بس، والعامل بيشوف بياناته هو بس — أنا بلتزم بده تلقائيًا.`,
];

function capabilitiesReply(user) {
  const admin = isAdminRole(user && user.role);
  return {
    reply: (admin ? ADMIN_ABILITIES : WORKER_ABILITIES).join('\n'),
    source: null,
    suggestions: defaultSuggestions(user),
  };
}

const CAPABILITY_RE = /تقدر تعمل|تقدر تعملي|بتعمل ايه|تعمل ايه|تعملي ايه|بتعرف تعمل|بتعرف ايه|امكانياتك|قدراتك|بتجاوب علي ايه|بتجاوب في ايه|بتفهم في ايه|وظيفتك|شغلتك|اسالك عن ايه|اسالك في ايه|ايه اللي تعرفه|ايه اللي بتعرفه|استخدمك ازاي|بتساعد في ايه|تقدر تساعدني في ايه|فايدتك ايه|(^|\s)مساعده(\s|$)|help/;

function smallTalk(nq, toks, user) {
  if (/انت مين|انتا مين|مين انت|مين حضرتك|اسمك|عرفني بنفسك|عرف نفسك|انت ايه|انت بوت|انت روبوت|انت بني ادم|انت حقيقي|انت انسان/.test(nq)) return introReply(user);
  if (CAPABILITY_RE.test(nq)) return capabilitiesReply(user);
  if (/مين عملك|مين صممك|مين برمجك|مين طورك|اتعملت ازاي/.test(nq)) {
    return { reply: 'اتعملت مخصوص لمنصة السلامة والصحة المهنية بتاعة السويدي بوليمرز، عشان أي حد في المصنع يلاقي تعليمات السلامة وبياناته بسرعة من غير ما يدوّر في الملفات. مصادري كلها من المصنع نفسه.', source: null };
  }
  if (/شكرا|متشكر|تسلم|ميرسي|thank|جزاك الله|الف شكر/.test(nq) && toks.length <= 4) {
    return { reply: 'العفو! 🙏 سلامتك أهم حاجة — لو عندك أي سؤال تاني أنا موجود.', source: null, suggestions: defaultSuggestions(user) };
  }
  if (/^(مع السلامه|باي|bye|سلام)$/.test(nq.trim())) return { reply: 'مع السلامة 👋 خلي بالك من نفسك وارتدي مهمات الوقاية دايمًا.', source: null };
  if (/ازيك|عامل ايه|اخبارك|انت كويس|ايه الاخبار/.test(nq) && toks.length <= 4 && !/الوضع|المصنع|الشغل|البلاغات|التصاريح|الشركه|القسم/.test(nq)) {
    return { reply: `الحمد لله تمام${firstName(user) ? ` يا ${firstName(user)}` : ''} 😊 جاهز أساعدك — اسألني عن أي حاجة في السلامة أو في بيانات المنصة.`, source: null, suggestions: defaultSuggestions(user) };
  }
  if ((/^(السلام عليكم|سلام عليكم|اهلا|اهلين|مرحبا|هاي|هالو|hi|hello|صباح الخير|مساء الخير|صباح النور|مساء النور)/.test(nq) || /^السلام(\s|$)/.test(nq)) && toks.length <= 4) {
    return { reply: `${/السلام/.test(nq) ? 'وعليكم السلام ورحمة الله' : 'أهلاً وسهلاً'}${firstName(user) ? ` يا ${firstName(user)}` : ''} 👋 أنا مساعد السلامة — تحب تسألني عن إيه؟`, source: null, suggestions: ['تعرف تعمل إيه؟', ...defaultSuggestions(user).slice(0, 3)] };
  }
  return null;
}

const PROC_TYPES = [
  { re: /ساخن|لحام|قطع/, key: 'ساخن' }, { re: /ارتفاع|سقاله/, key: 'ارتفاع' }, { re: /مغلق|خزان/, key: 'مغلقة' },
  { re: /حفر/, key: 'حفر' }, { re: /رفع|ونش|رافعه/, key: 'رفع' }, { re: /loto|لوتو|فصل وعزل|عزل الطاقه/, key: 'LOTO' },
  { re: /تفريغ|زيت|خامات/, key: 'تفريغ' }, { re: /عام/, key: 'عام' },
];
function permitProcedures(nq) {
  if (!/(تصريح|تصاريح|طلب عمل|permit)/.test(nq)) return null;
  if (!/(متطلبات|مطلوب|المطلوب|شروط|checklist|قايمه التحقق|قايمه|اسيله|خطوات|اجراءات|ازاي|اطلع|استخرج|افتح|اقدم)/.test(nq)) return null;
  const type = PROC_TYPES.find(t => t.re.test(nq));
  const proc = type && procedures.find(p => p.title.includes(type.key) || normalizeTitle(p.title).includes(kb.normalizeArabic(type.key)));
  if (proc) return { reply: `📝 ${proc.title}:\n${proc.content.replace(/^.*?:\s*\n/, '')}`, source: 'قوائم التحقق الخاصة بتصاريح العمل على المنصة' };
  return {
    reply: `📝 خطوات تصريح العمل على المنصة:\n1. قدّم الطلب من تبويب "تصاريح العمل" واختار نوعه، واملأ قائمة التحقق وتقييم المخاطر.\n2. أدمن قسمك بيراجعه ويوافق عليه.\n3. قسم السلامة بيعتمده اعتماد نهائي.\n4. بعد ما تخلص الشغل اقفله من "سجل تصاريح العمل" (اكتمل بأمان / لم يكتمل / إغلاق جبري).\n\nأنواع التصاريح اللي عندي متطلباتها: ${procedures.map(p => p.title.replace('إجراءات ومتطلبات ', '')).join('، ')}.`,
    source: 'قوائم التحقق الخاصة بتصاريح العمل على المنصة',
    suggestions: ['متطلبات تصريح عمل ساخن', 'متطلبات تصريح العمل على ارتفاع'],
  };
}
const normalizeTitle = t => kb.normalizeArabic(t);

const MINE_RE = /بتاعي|بتاعتي|بتوعي|بتاعتى|عندي|ليا|عليا|سجلي|حسابي|(^|\s)انا(\s|$)|حضرتها|حضرتهم|حضرت|قدمتها|قدمت|بلغت/;

const RAW_ANSWER_MIN = 240;
const SKIP_POLISH_SOURCE = /^(بياناتك|بيانات المنصة|بيانات الموظفين|دليل استخدام المنصة|فرق الطوارئ)/;

function compactPeopleList(reply) {
  const lines = String(reply || '').split('\n');
  const bullets = lines.filter(l => /^•\s/.test(l));
  if (bullets.length <= 8) return null;
  const peopleish = bullets.filter(l => /📞|—/.test(l)).length;
  if (peopleish < bullets.length / 2) return null;

  const out = [];
  let shown = 0;
  let hidden = 0;
  for (const line of lines) {
    if (/^•\s/.test(line)) {
      if (shown < 5) {
        out.push(line.replace(/\s*—?\s*📞\s*[\d+\- ]{6,}/g, ''));
        shown++;
      } else {
        hidden++;
      }
    } else {
      out.push(line);
    }
  }
  if (hidden > 0) out.push(`… و${hidden} كمان. اسألني عن أي حد بالاسم وهجيبلك بياناته.`);
  return out.join('\n');
}

async function polishIfRaw(question, r, ctx) {
  try {
    const reply = String((r && r.reply) || '');
    if (!r || !r.source || reply.length < RAW_ANSWER_MIN) return null;
    if (r.action) return null;

    const numberedSteps = (reply.match(/^\s*\d+[.)]\s/gm) || []).length;
    if (numberedSteps >= 4) return null;

    if (SKIP_POLISH_SOURCE.test(String(r.source))) {
      const compact = compactPeopleList(reply);
      return compact ? { reply: compact } : null;
    }

    if (!llm.isConfigured()) {
      const compact = compactPeopleList(reply);
      return compact ? { reply: compact } : null;
    }
    const out = await llm.polish({ question, answer: reply, user: ctx.user });
    return out ? { reply: out } : null;
  } catch (err) {
    console.error('[chatbot] polish error:', err.message);
    return null;
  }
}

async function handleMessage({ text, user, data, context }) {
  const q = String(text || '').trim().slice(0, 500);
  const ctx = { user: user || {}, data: data || {}, context: context || null };
  if (!q) return introReply(ctx.user);
  const nq = kb.normalizeArabic(q);
  const toks = kb.contentTokens(q);
  const admin = isAdminRole(ctx.user.role);

  const personalFirst = !admin || MINE_RE.test(nq);
  const dataLayers = personalFirst
    ? [() => personal.answerPersonal(q, ctx), () => analytics.answerAnalytics(q, ctx)]
    : [() => analytics.answerAnalytics(q, ctx), () => personal.answerPersonal(q, ctx)];

  const pendingAnswer = followup.answerFollowup(q, ctx);
  if (pendingAnswer) {
    return {
      source: null,
      suggestions: [],
      ...pendingAnswer,
      followup: pendingAnswer.keepPending ? (ctx.context && ctx.context.pending) : (pendingAnswer.followup || null),
    };
  }

  const layers = [
    () => smallTalk(nq, toks, ctx.user),
    () => platform.answerPlatform(q, ctx),
    () => nav.answerNav(q, ctx),
    ...dataLayers,
    () => org.answerOrg(q, ctx),
    () => sds.answerSds(q),
    () => permitProcedures(nq),
  ];
  for (const layer of layers) {
    let r = null;
    try { r = layer(); } catch (err) { console.error('[chatbot] layer error:', err.message); }
    if (r) {
      const polished = await polishIfRaw(q, r, ctx);
      return { source: null, suggestions: r.suggestions || [], topic: r.topic || null, ...r, ...polished };
    }
  }

  if (!admin && analytics.isAdminDataQuestion(q)) {
    return {
      reply: 'الأرقام دي (بيانات المصنع كله وباقي الموظفين) متاحة للإدارة بس 🔒\nبس أنا تحت أمرك في:\n• بياناتك انت: "محاضراتي" · "التارجت بتاعي" · "بلاغاتي" · "تصاريحي"\n• تعليمات السلامة وفرق الطوارئ وكروت الـ SDS\n• الهيكل الإداري: "مين مدير قسمي؟"',
      source: null,
      suggestions: ['محاضراتي', 'التارجت بتاعي', 'بلاغاتي', 'تعرف تعمل إيه؟'],
    };
  }

  const r = kb.answer(q);
  if (r.reply === kb.HELP_REPLY) return capabilitiesReply(ctx.user);
  if (!r.source && /^مش لاقي/.test(r.reply || '')) {
    if (llm.isConfigured()) {
      try {
        const snippets = kb.searchTop(q, 4);
        const llmReply = await llm.answer({ question: q, user: ctx.user, snippets });
        if (llmReply) return { suggestions: defaultSuggestions(ctx.user), ...llmReply };
      } catch (err) {
        console.error('[chatbot] LLM layer failed:', err.message);
      }
    }
    const near = kb.searchTop(q, 3);
    if (near.length) {
      return {
        reply: `مش لاقي إجابة مباشرة للسؤال ده 🤔\nبس عندي تعليمات قريبة منه — تقصد واحدة من دول؟\n${near.map(s => `• ${s.title}`).join('\n')}\n\nاكتب اسم اللي يهمك وهجيبهولك كامل، أو اسأل بصيغة تانية.`,
        source: null,
        suggestions: near.map(s => s.title).slice(0, 3),
      };
    }
    const extra = admin ? '، وأرقام المنصة كلها' : '، وبياناتك على المنصة';
    return {
      reply: `مش لاقي إجابة للسؤال ده في المصادر اللي عندي (تعليمات السلامة SE-W01، فرق الطوارئ، كروت SDS، الهيكل الإداري${extra}).\nجرّب تكتبه بكلمات تانية أو اذكر المكان أو اسم المادة، مثلاً: "ألبس إيه في مخزن الصبغات؟" أو "إسعافات الأسيتون" أو "مين في فريق الإطفاء؟".\nأو اكتب "تعرف تعمل إيه؟" وهعرضلك كل الأسئلة اللي بجاوب عليها.`,
      source: null,
      suggestions: ['تعرف تعمل إيه؟', 'المواضيع', ...defaultSuggestions(ctx.user).slice(0, 2)],
    };
  }
  const polishedKb = await polishIfRaw(q, r, ctx);
  return { ...r, suggestions: [], ...(polishedKb || {}) };
}

module.exports = { handleMessage, isAdminRole, ADMIN_TIER };
