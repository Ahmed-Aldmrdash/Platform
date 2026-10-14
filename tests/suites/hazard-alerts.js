const fs = require('fs');
const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const OUT = process.env.HSE_TEST_OUT || (__dirname + '/out');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

function mailFiles() {
  return fs.readdirSync(OUT).filter(f => /^mail-\d+\.eml$/.test(f))
    .map(f => ({ f, n: Number(f.match(/\d+/)[0]) })).sort((a, b) => a.n - b.n).map(x => x.f);
}
function decodeEml(raw) {
  const split = raw.indexOf('\r\n\r\n');
  const headRaw = split === -1 ? raw : raw.slice(0, split);
  const bodyRaw = split === -1 ? '' : raw.slice(split + 4);
  let head = headRaw.replace(/\r?\n[ \t]+/g, ' ').replace(/\?=\s+=\?UTF-8\?B\?/gi, '');
  head = head.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  const body = Buffer.from(
    bodyRaw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
    'binary'
  ).toString('utf8');
  return head + '\n\n' + body;
}

(async () => {
  const login = async (u, p, c) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, empCode: c }) });
    const j = await r.json();
    if (!j.token) throw new Error(`login ${u} failed: ${JSON.stringify(j).slice(0, 200)}`);
    return j.token;
  };
  const hse = await login('qa_hse', 'TestOnly!2026', '271');
  const H = { Authorization: 'Bearer ' + hse, 'Content-Type': 'application/json' };

  const s0 = await (await fetch(BASE + '/api/hazards/alert-settings', { headers: H })).json();
  const codes = (s0.recipients || []).map(r => r.empCode);
  ok(s0.highRiskEnabled === true, 'التنبيه الفوري مفعّل افتراضيًا');
  ok(!codes.includes('271') && !codes.includes('6077'), `مدحت يونس وعمرو خاطر مش في القايمة (${codes.join(', ') || 'فاضية'})`);
  ok(Array.isArray(s0.blockedCodes) && s0.blockedCodes.includes('271') && s0.blockedCodes.includes('6077'), 'الكودات الممنوعة معلنة للشاشة');

  const blocked = await fetch(BASE + '/api/hazards/alert-settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ highRiskEnabled: true, recipients: [{ empCode: '271', name: 'مدحت', email: 'medhat@test.local' }] }),
  });
  ok(blocked.status === 400, `محاولة إضافة كود ممنوع اترفضت (${blocked.status})`);

  const badEmail = await fetch(BASE + '/api/hazards/alert-settings', {
    method: 'PUT', headers: H, body: JSON.stringify({ recipients: [{ empCode: '6173', email: 'مش-إيميل' }] }),
  });
  ok(badEmail.status === 400, `إيميل غير صحيح اترفض (${badEmail.status})`);

  const want = [
    { empCode: '6173', name: 'محمود حسن محمد ابراهيم', email: 'mahmoud.hassan@test.local', enabled: true },
    { empCode: '62150', name: 'احمد عفيفي محمد صادق', email: 'ahmed.afifi@test.local', enabled: true },
    { empCode: '66499', name: 'احمد هانى صبحى عبدالحفيظ', email: 'ahmed.hany@test.local', enabled: true },
  ];
  const put = await fetch(BASE + '/api/hazards/alert-settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ highRiskEnabled: true, overdueEnabled: true, overdueHours: 48, recipients: want }),
  });
  const saved = await put.json();
  ok(put.status === 200 && saved.recipients.length === 3, `اتحفظ 3 مستلمين (${put.status})`);

  const before = mailFiles().length;
  const wtok = await (async () => {
    const r = await fetch(BASE + '/api/worker-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empCode: '5943', password: 'TestOnly!2026' }) });
    const j = await r.json();
    return j.token || null;
  })();
  const WH = wtok ? { Authorization: 'Bearer ' + wtok, 'Content-Type': 'application/json' } : H;
  const mk = async (riskLevel) => {
    const r = await fetch(BASE + '/api/hazards', {
      method: 'POST', headers: WH,
      body: JSON.stringify({
        reporterName: 'اختبار آلي', empCode: '5943', department: 'الصيانة الميكانيكية',
        area: 'خط الإنتاج 2', description: 'اختبار تنبيه الخطورة العالية', potentialInjury: 'إصابة بالغة',
        proposedSolution: 'عزل المصدر', likelihood: 5, severity: 'E', riskLevel,
        date: new Date().toISOString().slice(0, 10),
      }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const low = await mk('L');
  await new Promise(r => setTimeout(r, 1500));
  ok(mailFiles().length === before, `بلاغ خطورة منخفضة: مفيش إيميل (${low.status})`);

  await mk('H');
  await new Promise(r => setTimeout(r, 2500));
  const files = mailFiles();
  ok(files.length === before + 1, `بلاغ خطورة عالية: اتبعت إيميل واحد (${files.length - before})`);

  if (files.length > before) {
    const eml = decodeEml(fs.readFileSync(OUT + '/' + files[files.length - 1], 'binary'));
    const to = (eml.match(/^To:.*$/m) || [''])[0];
    ok(/mahmoud\.hassan@test\.local/.test(to) && /ahmed\.afifi@test\.local/.test(to) && /ahmed\.hany@test\.local/.test(to), `اتبعت للتلاتة: ${to.slice(0, 150)}`);
    ok(!/medhat|6077|amr/i.test(to), 'مااتبعتش لمدحت ولا عمرو');
    ok(/بلاغ خطورة عالية/.test(eml), 'عنوان الرسالة فيه "بلاغ خطورة عالية"');
    ok(/محتاج مراجعة فورية/.test(eml), 'شريط التنبيه الأحمر موجود في الرسالة');
    ok(/خط الإنتاج 2/.test(eml) && /الصيانة الميكانيكية/.test(eml), 'القسم والمكان ظاهرين');
    ok(/cid:elsewedy-logo/.test(eml) && /Content-ID: <elsewedy-logo>/.test(eml), 'الشعار مرفق مضمّن (cid)');
    ok(eml.length < 900 * 1024, `حجم الرسالة معقول (${Math.round(eml.length / 1024)} KB)`);
  }

  await fetch(BASE + '/api/hazards/alert-settings', { method: 'PUT', headers: H, body: JSON.stringify({ highRiskEnabled: false, recipients: want }) });
  const n1 = mailFiles().length;
  await mk('H');
  await new Promise(r => setTimeout(r, 1500));
  ok(mailFiles().length === n1, 'بعد الإيقاف: مفيش إيميل');
  await fetch(BASE + '/api/hazards/alert-settings', { method: 'PUT', headers: H, body: JSON.stringify({ highRiskEnabled: true, overdueEnabled: true, overdueHours: 48, recipients: want }) });

  const hz = (await (await fetch(BASE + '/api/hazards', { headers: H })).json()).hazards || [];
  const closedSet = ['resolved', 'closed', 'rejected', 'rejected_by_hse', 'rejected_by_maintenance'];
  const rank = h => [closedSet.includes(String(h.status || '').toLowerCase()) ? 1 : 0, { H: 0, M: 1, L: 2 }[String(h.riskLevel || '').toUpperCase()] ?? 3];
  let sorted = true, firstBad = '';
  for (let i = 1; i < hz.length; i++) {
    const a = rank(hz[i - 1]), b = rank(hz[i]);
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) { sorted = false; firstBad = `${hz[i - 1].id}(${hz[i - 1].status}/${hz[i - 1].riskLevel}) قبل ${hz[i].id}(${hz[i].status}/${hz[i].riskLevel})`; break; }
  }
  ok(sorted, `ترتيب البلاغات من السيرفر صح (${hz.length} بلاغ)${sorted ? '' : ' — ' + firstBad}`);
  ok(hz.length > 0 && !closedSet.includes(String(hz[0].status || '').toLowerCase()), `أول بلاغ في القايمة مفتوح: ${hz[0] && hz[0].id} (${hz[0] && hz[0].riskLevel})`);

  if (wtok) {
    const r = await fetch(BASE + '/api/hazards/alert-settings', { headers: { Authorization: 'Bearer ' + wtok } });
    ok(r.status === 401 || r.status === 403, `العامل ممنوع من إعدادات التنبيه (${r.status})`);
  }

  const n2 = mailFiles().length;
  const t = await fetch(BASE + '/api/hazards/alert-settings/test', { method: 'POST', headers: H, body: '{}' });
  const tj = await t.json().catch(() => ({}));
  await new Promise(r => setTimeout(r, 1500));
  ok(t.status === 200 && mailFiles().length === n2 + 1, `زرار التجربة بعت إيميل (${t.status} ${JSON.stringify(tj).slice(0, 120)})`);
  if (mailFiles().length > n2) {
    const eml = decodeEml(fs.readFileSync(OUT + '/' + mailFiles()[mailFiles().length - 1], 'binary'));
    ok(/\[تجربة\]/.test(eml), 'رسالة التجربة متعلّمة [تجربة] في العنوان');
  }

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
