const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const OUT_DIR = process.env.HSE_TEST_OUT || (__dirname + '/out');
const fs = require('fs');

async function login(username) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'TestOnly!2026', empCode: '271' }) });
  const j = await r.json(); if (!j.token) throw new Error('login ' + username + ': ' + JSON.stringify(j)); return j.token;
}
async function linkToken(token, path) {
  const r = await fetch(BASE + '/api/auth/link-token', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ path }) });
  return { status: r.status, body: await r.json() };
}
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

(async () => {
  const hse = await login('qa_hse');
  const hz = await (await fetch(BASE + '/api/hazards', { headers: { Authorization: 'Bearer ' + hse } })).json();
  const hazard = (Array.isArray(hz) ? hz : hz.hazards || []).find(h => h.photoUrl) || (Array.isArray(hz) ? hz : hz.hazards)[0];
  const st = await (await fetch(BASE + '/api/storage/work-permits', { headers: { Authorization: 'Bearer ' + hse } })).json();
  const permits = typeof st.value === 'string' ? JSON.parse(st.value) : (st.value || []);
  const permit = permits.find(p => p.description && p.description.length > 20 && p.department && p.department !== 'Department') || permits[0];

  const pPath = '/print/permit/' + encodeURIComponent(permit.id);
  const lt = await linkToken(hse, pPath);
  ok(lt.status === 200 && lt.body.token, 'link-token اتعمل للتصريح');
  const page = await fetch(BASE + pPath + '?dt=' + encodeURIComponent(lt.body.token));
  const html = await page.text();
  ok(page.status === 200 && html.includes('تصريح عمل') && html.includes('elsewedy-logo-print.png'), 'صفحة طباعة التصريح بتفتح وفيها الشعار');
  fs.writeFileSync(OUT_DIR + '/print-permit.html', html);

  const other = await fetch(BASE + '/print/hazard/' + encodeURIComponent(hazard.id) + '?dt=' + encodeURIComponent(lt.body.token));
  ok(other.status === 403, 'الرابط المؤقت مرفوض على ملف تاني (' + other.status + ')');

  const asBearer = await fetch(BASE + '/api/users', { headers: { Authorization: 'Bearer ' + lt.body.token } });
  ok(asBearer.status === 401, 'الرابط المؤقت مرفوض كتوكن جلسة (' + asBearer.status + ')');

  const bad = await linkToken(hse, 'https://evil.example/x');
  ok(bad.status === 400, 'مسار خارجي مرفوض (' + bad.status + ')');
  const bad2 = await linkToken(hse, '/print/../api/users');
  ok(bad2.status === 400, 'مسار فيه ../ مرفوض (' + bad2.status + ')');

  const hPath = '/print/hazard/' + encodeURIComponent(hazard.id);
  const lt2 = await linkToken(hse, hPath);
  const hp = await fetch(BASE + hPath + '?dt=' + encodeURIComponent(lt2.body.token));
  const hhtml = await hp.text();
  ok(hp.status === 200 && hhtml.includes('بلاغ خطورة'), 'صفحة طباعة البلاغ بتفتح');
  fs.writeFileSync(OUT_DIR + '/print-hazard.html', hhtml);

  const drillsRes = await fetch(BASE + '/api/drills', { headers: { Authorization: 'Bearer ' + hse } });
  const drillsJson = await drillsRes.json();
  const drillList = Array.isArray(drillsJson) ? drillsJson : (drillsJson.drills || []);
  const xPath = `/api/drills/export/${encodeURIComponent((drillList[0] && drillList[0].id) || 'LEGACY-001')}`;
  const lt3 = await linkToken(hse, xPath);
  const xr = await fetch(BASE + xPath + '?dt=' + encodeURIComponent(lt3.body.token));
  ok(xr.status === 200 && /sheet|excel|octet/.test(xr.headers.get('content-type') || ''), 'تحميل إكسل بالرابط المؤقت شغال (' + xr.status + ' ' + xr.headers.get('content-type') + ')');

  const vr = await fetch(BASE + '/verify/hazard/' + encodeURIComponent(hazard.id));
  ok(vr.status === 200, 'صفحة التحقق العامة شغالة');

  const lt4 = await linkToken(hse, pPath);
  const lt5 = await linkToken(hse, hPath);
  fs.writeFileSync(OUT_DIR + '/links.json', JSON.stringify({
    permit: BASE + pPath + '?dt=' + encodeURIComponent(lt4.body.token),
    hazard: BASE + hPath + '?dt=' + encodeURIComponent(lt5.body.token),
  }, null, 2));
  console.log('\nتصريح للاختبار:', permit.id, '| بلاغ:', hazard.id, hazard.photoUrl ? '(فيه صورة)' : '');
  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e.message); process.exit(1); });
