'use strict';

// Optional LLM layer (Gemini or Claude). It sees only the question, the asker's role and department
// and the matched safety-source excerpts, never employee or report records.

const TIMEOUT_MS = Number(process.env.CHATBOT_LLM_TIMEOUT_MS || 20000);
const MAX_TOKENS = 800;

const GEMINI_FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];
let _discovered = null;

async function discoverGeminiModels(key) {
  if (_discovered) return _discovered;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=100`);
    if (!res.ok) return [];
    const data = await res.json();
    const names = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace('models/', ''))
      .filter(n => /flash/i.test(n) && !/(image|tts|audio|omni|native|banana)/i.test(n));
    names.sort((a, b) => (/lite/i.test(b) ? 1 : 0) - (/lite/i.test(a) ? 1 : 0));
    _discovered = names.slice(0, 6);
    if (_discovered.length) console.log('[chatbot-llm] discovered Gemini models: ' + _discovered.join(', '));
    return _discovered;
  } catch (e) {
    return [];
  }
}

let _anthropic = null;
let _geminiModel = null;
let _fallbacksUnsupported = false;
let _warned = {};

const CACHE_MAX = 500;
const _cache = new Map();
const cacheKey = (kind, a, b) => kind + '|' + String(a).slice(0, 300) + '|' + String(b || '').slice(0, 300);
function cacheGet(key) {
  if (!_cache.has(key)) return null;
  const v = _cache.get(key);
  _cache.delete(key); _cache.set(key, v);
  return v;
}
function cacheSet(key, val) {
  if (!val) return;
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, val);
}

function warnOnce(key, msg) {
  if (_warned[key]) return;
  _warned[key] = true;
  console.warn('[chatbot-llm] ' + msg);
}

function provider() {
  const forced = String(process.env.CHATBOT_LLM_PROVIDER || '').trim().toLowerCase();
  const hasAnthropic = !!String(process.env.ANTHROPIC_API_KEY || '').trim();
  const hasGemini = !!String(process.env.GEMINI_API_KEY || '').trim();
  if (forced === 'gemini') return hasGemini ? 'gemini' : null;
  if (forced === 'anthropic' || forced === 'claude') return hasAnthropic ? 'anthropic' : null;
  if (hasAnthropic) return 'anthropic';
  if (hasGemini) return 'gemini';
  return null;
}

function isConfigured() {
  return provider() !== null;
}

function buildSystemPrompt(hasSources) {
  const base = [
    'انت "مساعد السلامة" — المساعد الرسمي لمنصة السلامة والصحة المهنية في مصنع السويدي بوليمرز.',
    'بتتكلم عامية مصرية بسيطة، وبترد على عمال ومهندسين وإدارة في مصنع بلاستيك وبوليمرات.',
    '',
    'قواعد ثابتة:',
    '• الرد قصير: ٦ سطور كحد أقصى، ونقط لو فيه خطوات.',
    '• في أي موقف خطر حقيقي (حريق، إصابة، تسريب، صعق)، ابدأ بالخطوة العاجلة الأول وبعدين التفاصيل.',
    '• ممنوع تدي بيانات أي موظف، ولا أرقام تليفونات، ولا تخمّن أرقام أو إحصائيات عن المصنع.',
    '• ممنوع تخترع أي حاجة **خاصة بالمصنع**: أسماء أشخاص، أرقام تصاريح، إجراءات داخلية، مواد كيميائية موجودة عندهم، أو أسماء أقسام. اللي من دول مش متأكد منه قول إنه يتأخد من مشرف السلامة.',
    '• ما تقولش إنك ذكاء اصطناعي خارجي ولا تتكلم عن الموديل أو الـ API — انت مساعد المنصة وخلاص.',
    '',
  ];
  if (hasSources) {
    base.push(
      'في المقاطع اللي جوه <المصادر> إجابة للسؤال — اعتمد عليها هي بالذات وصُغها بالعامية،',
      'ومتضيفش تفاصيل مصنع مش موجودة فيها.'
    );
  } else {
    base.push(
      'مفيش مقاطع من مستندات المصنع للسؤال ده. تقدر ترد من معرفتك العامة في السلامة والصحة المهنية',
      '(إسعافات، إجهاد حراري، مهمات وقاية، مخاطر عامة، سلوك آمن...)، بشرطين:',
      '١. ابدأ ردك بالسطر ده بالظبط: "ℹ️ رد عام من قواعد السلامة المهنية — مش من مستندات المصنع."',
      '٢. اقفل ردك بجملة قصيرة إنه يراجع مشرف السلامة لو المطلوب إجراء رسمي داخل المصنع.',
      'ولو السؤال مالوش أي علاقة بالشغل ولا السلامة ولا صحة الناس (رياضة، سياسة، كلام عام)، قول بلطف إن ده برّه نطاقك.'
    );
  }
  return base.join('\n');
}

function buildSourcesBlock(snippets) {
  if (!Array.isArray(snippets) || !snippets.length) {
    return '<المصادر>\n(مفيش مقاطع مطابقة في مصادر المصنع لسؤال المستخدم ده)\n</المصادر>';
  }
  const parts = snippets.slice(0, 5).map((s, i) => {
    const text = String(s.text || '').slice(0, 1800);
    return `[مصدر ${i + 1}] ${s.title || ''}\n(المرجع: ${s.source || 'غير محدد'})\n${text}`;
  });
  return `<المصادر>\n${parts.join('\n\n')}\n</المصادر>`;
}

function buildUserBlock({ question, user, snippets }) {
  const u = user || {};
  const who = [
    u.role === 'worker' ? 'الشخص اللي بيسأل: عامل/مهندس في المصنع.' : 'الشخص اللي بيسأل: من الإدارة (مشرف/مسؤول سلامة).',
    u.department ? `قسمه: ${u.department}.` : '',
  ].filter(Boolean).join(' ');
  return [buildSourcesBlock(snippets), '', who, '', `سؤاله: ${question}`].join('\n');
}

async function askAnthropic(userBlock, systemPrompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 1, timeout: TIMEOUT_MS });
  const params = {
    model: process.env.CHATBOT_LLM_MODEL || 'claude-opus-5',
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    output_config: { effort: process.env.CHATBOT_LLM_EFFORT || 'low' },
    messages: [{ role: 'user', content: userBlock }],
  };
  let message;
  if (_fallbacksUnsupported) {
    message = await _anthropic.messages.create(params);
  } else {
    try {
      message = await _anthropic.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError) {
        _fallbacksUnsupported = true;
        warnOnce('fb', 'server-side fallbacks مش مدعومة على الحساب ده — هكمّل من غيرها.');
        message = await _anthropic.messages.create(params);
      } else throw err;
    }
  }
  if (message && message.stop_reason === 'refusal') return '';
  return (message.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
}

async function callGemini(model, userBlock, key, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userBlock }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || res.statusText;
      return { status: res.status, error: msg, text: '' };
    }
    const cand = (data.candidates || [])[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .map(p => p && p.text).filter(Boolean).join('\n').trim();
    return { status: 200, text, finishReason: (cand && cand.finishReason) || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function askGemini(userBlock, systemPrompt) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const preferred = [_geminiModel, process.env.CHATBOT_LLM_MODEL].filter(Boolean);
  let candidates = [...new Set([...preferred, ...GEMINI_FALLBACK_MODELS])];

  for (let round = 0; round < 2; round++) {
  for (const model of candidates) {
    const out = await callGemini(model, userBlock, key, systemPrompt);
    if (out.status === 200) {
      if (out.text) {
        if (_geminiModel !== model) {
          _geminiModel = model;
          console.log(`[chatbot-llm] using Gemini model ${model}`);
        }
        return out.text;
      }
      warnOnce('empty', 'Gemini رجّع رد فاضي (finishReason: ' + (out.finishReason || 'غير معروف') + ') — الشات بوت كمّل محليًا.');
      return '';
    }
    if (out.status === 404 || out.status === 503 || /not found|not supported|overloaded|high demand/i.test(out.error || '')) continue;
    if (out.status === 429) {
      warnOnce('429', 'حصة الموديل ' + model + ' خلصت — بجرّب موديل تاني.');
      continue;
    }
    if (out.status === 400 || out.status === 403) {
      warnOnce('key', 'مفتاح GEMINI_API_KEY مرفوض أو مش مفعّل: ' + (out.error || '').slice(0, 160));
      return '';
    }
    warnOnce('other', 'Gemini رجّع خطأ ' + out.status + ': ' + String(out.error || '').slice(0, 160));
    return '';
  }
  if (round === 0) {
    const found = await discoverGeminiModels(key);
    const fresh = found.filter(m => !candidates.includes(m));
    if (!fresh.length) break;
    candidates = fresh;
    continue;
  }
  break;
  }
  console.warn('[chatbot-llm] no Gemini model available right now, falling back to local answers (set CHATBOT_LLM_MODEL if this keeps happening)');
  return '';
}

async function answer({ question, user, snippets }) {
  const prov = provider();
  if (!prov) return null;
  const q = String(question || '').trim();
  if (!q) return null;

  const userBlock = buildUserBlock({ question: q, user, snippets });
  const key = cacheKey('ans', q, (snippets || []).map(x => x.title).join(','));
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const hasSources = Array.isArray(snippets) && snippets.length > 0;
    const systemPrompt = buildSystemPrompt(hasSources);
    const text = prov === 'gemini' ? await askGemini(userBlock, systemPrompt) : await askAnthropic(userBlock, systemPrompt);
    if (!text) return null;
    const built = {
      reply: text,
      source: hasSources
        ? `${snippets[0].source} (صياغة بمساعدة الذكاء الاصطناعي)`
        : 'قواعد السلامة المهنية العامة — مش من مستندات المصنع',
      suggestions: [],
    };
    cacheSet(key, built);
    return built;
  } catch (err) {
    warnOnce('exc', `طبقة ${prov} فشلت، الشات بوت بيكمّل محليًا: ` + (err && err.message));
    return null;
  }
}

const POLISH_SYSTEM = [
  'انت "مساعد السلامة" في مصنع السويدي بوليمرز، وبتتكلم عامية مصرية بسيطة مع عمال ومهندسين.',
  'جايلك سؤال مستخدم + "إجابة خام" مستخرجة من مستندات المصنع الرسمية.',
  'شغلتك: تعيد صياغة الإجابة الخام بس. ممنوع منعًا باتًا تضيف أي معلومة مش موجودة فيها.',
  '',
  'قواعد:',
  '• خد من الإجابة الخام اللي يخص سؤال المستخدم بس، واشطب أي بند مالوش علاقة بسؤاله.',
  '• لو الإجابة خطوات إجراء سلامة (زي اللوتو أو تصريح عمل) — سيب كل الخطوات بترتيبها، بسّط صياغتها بس، وما تشيلش ولا خطوة.',
  '• **ممنوع** تختصر التفاصيل اللي جوه الخطوة: أسماء مهمات الوقاية (جوانتي/نظارة/كمامة...)، الأرقام، المسافات، المدد الزمنية، أسماء المعدات — دي تفاصيل سلامة حرجة تتكتب زي ما هي. يعني "التزم بمهمات الوقاية المناسبة" رد ناقص وغلط لو الأصل كان مكتوب فيه أسماء المهمات.',
  '• لو فيها قايمة أسماء أشخاص أطول من ٦ — اذكر العدد الإجمالي وأول ٣ بس، وقول إنه يقدر يسأل عن أي حد بالاسم. وما تكتبش أرقام تليفونات إلا لو سأل عليها صراحة.',
  '• ابدأ بالإجابة على طول — من غير "طبعًا" ولا "حاضر" ولا تكرار السؤال.',
  '• ٧ سطور كحد أقصى.',
].join('\n');

async function polish({ question, answer: rawAnswer, user }) {
  const prov = provider();
  if (!prov) return null;
  if (String(process.env.CHATBOT_LLM_POLISH || '').toLowerCase() === 'off') return null;
  const q = String(question || '').trim();
  const raw = String(rawAnswer || '').trim();
  if (!q || raw.length < 40) return null;

  const pKey = cacheKey('pol', q, raw);
  const pHit = cacheGet(pKey);
  if (pHit) return pHit;

  const block = [
    `سؤال المستخدم: ${q}`,
    (user && user.department) ? `قسمه: ${user.department}` : '',
    '',
    '<الإجابة الخام من مستندات المصنع>',
    raw.slice(0, 4000),
    '</الإجابة الخام>',
  ].filter(Boolean).join('\n');

  try {
    const text = prov === 'gemini'
      ? await askGemini(block, POLISH_SYSTEM)
      : await askAnthropic(block, POLISH_SYSTEM);
    const out = String(text || '').trim();
    if (!out || out.length < 25) return null;
    cacheSet(pKey, out);
    return out;
  } catch (err) {
    warnOnce('polish', 'إعادة الصياغة فشلت — بنعرض الإجابة الخام: ' + (err && err.message));
    return null;
  }
}

module.exports = { isConfigured, answer, polish, provider };
