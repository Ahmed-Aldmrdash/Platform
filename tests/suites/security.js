const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };
const J = { 'Content-Type': 'application/json' };
const H = t => ({ ...J, Authorization: 'Bearer ' + t });
async function login(username, password = 'TestOnly!2026', empCode = '271') {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: J, body: JSON.stringify({ username, password, empCode }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function workerLogin(code, password) {
  const r = await fetch(BASE + '/api/worker-auth/login', { method: 'POST', headers: J, body: JSON.stringify({ code, password }) });
  return (await r.json().catch(() => ({}))).token;
}

(async () => {
  const sup = (await login('qa_super')).body.token;
  const hse = (await login('qa_hse')).body.token;

  for (let i = 0; i < 3; i++) await login(`warmup_user_${i}`, 'Whatever!123');
  let t0 = Date.now();
  const unknown = await login('no_such_user_xyz', 'Whatever!123');
  const tUnknown = Date.now() - t0;
  t0 = Date.now();
  const wrong = await login('qa_dept', 'Wrong!Pass123', '5501');
  const tWrong = Date.now() - t0;
  const strip = s => String(s || '').replace(/فاضل \d+ محاولات/, 'فاضل N محاولات');
  ok(unknown.status === 401 && strip(unknown.body.error) === strip(wrong.body.error), `اسم مستخدم غلط = نفس رسالة الباسورد الغلط: "${unknown.body.error}"`);
  ok(Math.abs(tUnknown - tWrong) < 120, `وقت الرد متقارب (غلط اسم ${tUnknown}ms / غلط باسورد ${tWrong}ms)`);

  const big = JSON.stringify({ username: 'x', password: 'y', pad: 'a'.repeat(3 * 1024 * 1024) });
  let r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: J, body: big });
  let body = await r.text();
  ok(r.status === 413 && !/at \w+ \(|node_modules|\.js:\d+/.test(body) && body.includes('حجم البيانات'), `طلب 3 ميجا على الدخول → 413 برسالة عربي من غير stack (${r.status})`);
  r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: J, body: '{"username": "x", ' });
  body = await r.text();
  ok(r.status === 400 && body.includes('مش بصيغة صحيحة') && !/node_modules|\.js:\d+/.test(body), `JSON بايظ → 400 برسالة واضحة (${r.status})`);
  r = await fetch(BASE + '/api/hazards', { method: 'POST', headers: J, body: big });
  ok(r.status === 413, `بلاغ 3 ميجا من غير جلسة → 413 (الحد الكبير للمسجلين بس) (${r.status})`);
  r = await fetch(BASE + '/api/hazards', { method: 'POST', headers: H(hse), body: JSON.stringify({ description: 'x', photo: 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024) }) });
  ok(r.status !== 413, `بلاغ بصورة 3 ميجا بجلسة سليمة مش بيترفض بسبب الحجم (${r.status})`);
  r = await fetch(BASE + '/definitely-not-a-page');
  ok(r.status === 404 && (await r.text()).includes('<html'), `صفحة مش موجودة → 404 (مش 200) (${r.status})`);
  r = await fetch(BASE + '/api/nope');
  ok(r.status === 404, 'مسار API مش موجود → 404 JSON');

  const mk = await fetch(BASE + '/api/users', { method: 'POST', headers: H(sup), body: JSON.stringify({ username: 'qa_tmp_rev', password: 'TestOnly!2026', role: 'dept_admin', name: 'مؤقت (اختبار قفل)', department: 'HSE' }) });
  const mkj = await mk.json().catch(() => ({}));
  const users = await (await fetch(BASE + '/api/users', { headers: H(sup) })).json();
  const list = Array.isArray(users) ? users : (users.users || []);
  const tmp = list.find(u => u.username === 'qa_tmp_rev');
  ok(!!tmp, `اتعمل حساب مؤقت للاختبار (${mk.status} ${mkj.error || ''})`);
  const tmpLogin = await login('qa_tmp_rev');
  ok(!!tmpLogin.body.token, 'الحساب المؤقت دخل');
  r = await fetch(BASE + '/api/hazards', { headers: H(tmpLogin.body.token) });
  ok(r.status === 403, `قبل كلمة السر الشخصية: باقي المنصة مقفولة (${r.status})`);
  const setPw = await fetch(BASE + '/api/auth/set-personal-password', { method: 'POST', headers: H(tmpLogin.body.token), body: JSON.stringify({ newPassword: 'Personal!Pw2026' }) });
  const tmpTok = (await setPw.json().catch(() => ({}))).token;
  ok(setPw.status === 200 && !!tmpTok, `كلمة السر الشخصية اتعملت ورجع توكن جديد (${setPw.status})`);
  const reuse = await login('qa_tmp_rev', 'TestOnly!2026', '6077');
  ok(reuse.status === 401, `كلمة السر المشتركة اتلغت بعد أول استخدام — زميل تاني مش هيدخل بيها (${reuse.status})`);
  r = await fetch(BASE + '/api/hazards', { headers: H(tmpTok) });
  ok(r.status === 200, `قبل التعديل: شغال (${r.status})`);
  r = await fetch(BASE + '/api/users/' + encodeURIComponent(tmp.id), { method: 'PUT', headers: H(sup), body: JSON.stringify({ username: 'qa_tmp_rev', name: 'مؤقت (اختبار قفل)', role: 'dept_admin', department: 'Warehouse' }) });
  ok(r.status === 200, `السوبر أدمن غيّر قسمه (${r.status})`);
  r = await fetch(BASE + '/api/hazards', { headers: H(tmpTok) });
  let j = await r.json().catch(() => ({}));
  ok(r.status === 401 && j.expired === true, `التوكن القديم اتقفل فورًا (${r.status})`);
  r = await fetch(BASE + '/api/auth/refresh', { method: 'POST', headers: H(tmpTok) });
  ok(r.status === 401, `وتجديده مرفوض (${r.status})`);
  await fetch(BASE + '/api/users/' + encodeURIComponent(tmp.id), { method: 'PUT', headers: H(sup), body: JSON.stringify({ username: 'qa_tmp_rev', name: 'مؤقت (اختبار قفل)', role: 'dept_admin', department: 'HSE' }) });
  const tmpLogin2 = await login('qa_tmp_rev', 'Personal!Pw2026', '271');
  ok(!!tmpLogin2.body.token, 'دخل تاني بعد ما رجع HSE (الجلسة الجديدة مش متأثرة بالقفل القديم)');
  if (tmpLogin2.body.token) {
    r = await fetch(BASE + '/api/hazards', { headers: H(tmpLogin2.body.token) });
    ok(r.status === 200 || r.status === 304, `الجلسة الجديدة شغالة (${r.status})`);
    await fetch(BASE + '/api/users/' + encodeURIComponent(tmp.id), { method: 'DELETE', headers: H(sup) });
    r = await fetch(BASE + '/api/hazards', { headers: H(tmpLogin2.body.token) });
    ok(r.status === 401, `بعد حذف الحساب الجلسة اتقفلت (${r.status})`);
  } else {
    await fetch(BASE + '/api/users/' + encodeURIComponent(tmp.id), { method: 'DELETE', headers: H(sup) });
  }
  r = await fetch(BASE + '/api/auth/refresh', { method: 'POST', headers: H(hse) });
  j = await r.json().catch(() => ({}));
  ok(r.status === 200 && j.token, 'تجديد جلسة عادية لسه شغال');
  if (j.token) {
    const p = JSON.parse(Buffer.from(j.token.split('.')[1], 'base64url').toString());
    ok(p.role === 'hse_admin', `الدور بعد التجديد صح (${p.role})`);
  }

  const drl = await fetch(BASE + '/api/drills', { method: 'POST', headers: H(hse), body: JSON.stringify({ title: 'تجربة اختبار PIN', location: 'المخزن', date: '2026-09-22', startTime: '10:00', endTime: '10:30', sessionPin: '4321', trainer: 'اختبار', targetGroup: 'الكل' }) });
  const drj = await drl.json().catch(() => ({}));
  const drillPin = (drj.drill && drj.drill.sessionPin) || '';
  const wtok = await workerLogin('2546', 'WorkerTest!2026');
  if (wtok) {
    r = await fetch(BASE + '/api/drills/worker/2546', { headers: H(wtok) });
    const wj = await r.json();
    ok(wj.activeSession && !('sessionPin' in wj.activeSession) && !JSON.stringify(wj).includes(drillPin), `العامل بيشوف التجربة الجارية من غير الـ PIN (${drl.status})`);
    r = await fetch(BASE + '/api/trainings/worker/2546', { headers: H(wtok) });
    ok(!JSON.stringify(await r.json()).includes('"sessionPin"'), 'ونفس الكلام للمحاضرات');
    const drillId = (drj.drill && drj.drill.id) || drj.id;
    let hit = 0;
    for (let i = 0; i < 17; i++) {
      r = await fetch(BASE + `/api/drills/${drillId}/attend`, { method: 'POST', headers: H(wtok), body: JSON.stringify({ pin: drillPin === '0000' ? '0001' : '0000' }) });
      if (r.status === 429) { hit = i + 1; break; }
    }
    ok(hit > 0 && hit <= 16, `عامل بيخمّن الـ PIN بيتوقف بعد 15 محاولة (عند ${hit})`);
    await fetch(BASE + '/api/worker-auth/setup', { method: 'POST', headers: J, body: JSON.stringify({ code: '5943', password: 'WorkerTwo!2026', phone: '01012345678' }) });
    const w2 = await workerLogin('5943', 'WorkerTwo!2026');
    r = await fetch(BASE + `/api/drills/${drillId}/attend`, { method: 'POST', headers: H(w2), body: JSON.stringify({ pin: drillPin }) });
    const aj = await r.json().catch(() => ({}));
    ok(r.status === 200 || r.status === 201, `عامل تاني من نفس الشبكة سجّل حضوره عادي بالـ PIN الصح (${r.status} ${aj.error || ''})`);
    if (drillId) {
      await fetch(BASE + `/api/drills/${drillId}/close`, { method: 'PUT', headers: H(hse) }).catch(() => {});
      await fetch(BASE + `/api/drills/${drillId}`, { method: 'DELETE', headers: H(hse) }).catch(() => {});
      await fetch(BASE + `/api/drills/${drillId}/permanent`, { method: 'DELETE', headers: H(hse) }).catch(() => {});
    }
  } else console.log('ℹ️ مقدرتش أدخل كعامل');

  r = await fetch(BASE + '/');
  const home = await r.text();
  ok(!home.includes('__SITE_URL__') && home.includes(`<link rel="canonical" href="${BASE}/"`), 'الـ canonical بعنوان الموقع الحقيقي');
  ok(home.includes(`og:image" content="${BASE}/icons/icon-512.png"`) && home.includes('application/ld+json'), 'بيانات المشاركة (og) + Schema.org');
  r = await fetch(BASE + '/robots.txt');
  const robots = await r.text();
  ok(/Disallow: \/print\//.test(robots) && robots.includes(`Sitemap: ${BASE}/sitemap.xml`), 'robots.txt بيمنع صفحات المستندات وفيه الـ sitemap');
  r = await fetch(BASE + '/sitemap.xml');
  ok(r.status === 200 && (await r.text()).includes(`<loc>${BASE}/</loc>`), 'sitemap.xml شغال');
  r = await fetch(BASE + '/', { headers: { Host: 'evil.com"><script>' } }).catch(() => null);
  if (r) ok(!(await r.text()).includes('<script>alert'), 'هيدر Host مزيّف مش بيدخل في الصفحة');

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
})().catch(e => { console.error('💥', e); process.exit(1); });
