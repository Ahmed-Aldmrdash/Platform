const ROOT_DIR = require('path').join(__dirname, '..', '..') + '/';
const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const fs = require('fs');
const OUT = (process.env.HSE_TEST_OUT || (__dirname + '/out')) + '/';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };
async function login(username, empCode = '271') {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'TestOnly!2026', empCode }) });
  const j = await r.json(); if (!j.token) throw new Error(JSON.stringify(j)); return j.token;
}
const H = t => ({ Authorization: 'Bearer ' + t });

(async () => {
  const hse = await login('qa_hse');
  const dept = await login('qa_dept', '5501');
  const drills = await (await fetch(BASE + '/api/drills', { headers: H(hse) })).json();
  const list = Array.isArray(drills) ? drills : (drills.drills || []);
  const drill = list.find(d => d.report && !d.isDeleted) || list[0];
  ok(!!drill, `لقيت تجربة للاختبار: ${drill && drill.id}`);

  let r = await fetch(BASE + '/print/drill/' + encodeURIComponent(drill.id), { headers: H(hse) });
  let html = await r.text();
  fs.writeFileSync(OUT + 'print-drill.html', html);
  ok(r.status === 200 && html.includes('تقرير تجربة طوارئ') && html.includes('elsewedy-logo-print.png'), `صفحة طباعة التجربة (${r.status})`);
  ok(html.includes('الغرض من التجربة') && html.includes('الإيجابيات') && html.includes('SE-03-F1'), 'فيها كل أقسام النموذج + كود النموذج');
  ok(html.includes('class="kv"') && html.includes('<th>التاريخ</th>'), 'بيانات التجربة عنوان+قيمة جنب بعض');
  r = await fetch(BASE + '/print/drill/' + encodeURIComponent(drill.id), { headers: H(dept) });
  ok(r.status === 200, `أدمن القسم يقدر يطبع تقرير التجربة (نفس صلاحية الـ Word) (${r.status})`);
  r = await fetch(BASE + '/print/drill/NOPE', { headers: H(hse) });
  ok(r.status === 404, `تجربة مش موجودة → 404 (${r.status})`);
  r = await fetch(BASE + '/print/drill/' + encodeURIComponent(drill.id));
  ok(r.status === 401, `من غير تسجيل → 401 (${r.status})`);

  const st = await (await fetch(BASE + '/api/storage/work-permits', { headers: H(hse) })).json();
  const permits = typeof st.value === 'string' ? JSON.parse(st.value) : (st.value || []);
  const permit = permits.find(p => /^closed/.test(p.status || '')) || permits[0];
  r = await fetch(BASE + `/api/permits/${encodeURIComponent(permit.id)}/pdf?dt=${encodeURIComponent(hse)}`, { redirect: 'manual' });
  ok(r.status === 302 && (r.headers.get('location') || '').startsWith('/print/permit/'), `رابط PDF التصريح القديم بيتحوّل (${r.status} → ${r.headers.get('location') && r.headers.get('location').slice(0, 40)}…)`);
  r = await fetch(BASE + `/api/permits/${encodeURIComponent(permit.id)}/pdf?dt=${encodeURIComponent(hse)}`);
  ok(r.status === 401, `توكن الجلسة الكامل في الرابط مرفوض بعد التحويل — لازم رابط مؤقت (${r.status})`);
  r = await fetch(BASE + `/api/hazards/HAZ-x/pdf`, { redirect: 'manual' });
  ok(r.status === 302 && r.headers.get('location') === '/print/hazard/HAZ-x', `رابط PDF البلاغ القديم بيتحوّل (${r.headers.get('location')})`);

  r = await fetch(BASE + '/verify/permit/' + encodeURIComponent(permit.id));
  html = await r.text();
  const expected = { approved: 'معتمد', completed: 'مغلق' }[permit.status] || (/^closed/.test(permit.status) ? 'مغلق' : '');
  ok(r.status === 200 && html.includes(`<div class="status">${expected}`), `تحقق تصريح (${permit.status}) → "${expected}"`);
  const hz = await (await fetch(BASE + '/api/hazards', { headers: H(hse) })).json();
  const hazards = Array.isArray(hz) ? hz : (hz.hazards || []);
  const openHz = hazards.find(h => h.status === 'open');
  if (openHz) {
    r = await fetch(BASE + '/verify/hazard/' + encodeURIComponent(openHz.id));
    html = await r.text();
    ok(r.status === 200 && html.includes('مفتوح'), 'تحقق بلاغ مفتوح → "مفتوح"');
  }
  r = await fetch(BASE + '/verify/permit/NOPE');
  ok(r.status === 404, 'تحقق تصريح مش موجود → 404 "غير صالح"');

  r = await fetch(BASE + '/print/permit/' + encodeURIComponent(permit.id), { headers: H(hse) });
  html = await r.text();
  const m = html.match(/تاريخ الإصدار: <bdi>([^<]+)<\/bdi>/);
  const cairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(',', '');
  ok(m && m[1].slice(0, 13) === cairo.slice(0, 13), `وقت الإصدار بتوقيت القاهرة (${m && m[1]} ≈ ${cairo})`);

  const lt = await (await fetch(BASE + '/api/auth/link-token', { method: 'POST', headers: { ...H(hse), 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `/api/drills/export/${drill.id}` }) })).json();
  r = await fetch(BASE + `/api/drills/export/${encodeURIComponent(drill.id)}?dt=${encodeURIComponent(lt.token)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(OUT + 'drill-export.xlsx', buf);
  const logo = fs.readFileSync(ROOT_DIR + 'public/icons/elsewedy-logo-print.png');
  const ExcelJS = require(ROOT_DIR + 'node_modules/exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const imgs = wb.model.media || [];
  ok(r.status === 200 && imgs.some(im => im.buffer && Buffer.compare(Buffer.from(im.buffer), logo) === 0), `ملف الإكسيل فيه الشعار الجديد (${imgs.length} صورة)`);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
})().catch(e => { console.error('💥', e); process.exit(1); });
