const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const fs = require('fs');
const OUT = (process.env.HSE_TEST_OUT || (__dirname + '/out')) + '/';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

async function login(username, password = 'TestOnly!2026', empCode = '271') {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, empCode }) });
  const j = await r.json();
  if (!j.token) throw new Error('login ' + username + ': ' + JSON.stringify(j));
  return j.token;
}
const H = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
const get = (t, p) => fetch(BASE + p, { headers: t ? H(t) : {} });
const post = (t, p, b) => fetch(BASE + p, { method: 'POST', headers: H(t), body: JSON.stringify(b) });
const put = (t, p, b) => fetch(BASE + p, { method: 'PUT', headers: H(t), body: JSON.stringify(b) });
const email = (t, recipients, query = {}) => post(t, '/api/reports/email', { recipients, query });

(async () => {
  const hse = await login('qa_hse');
  const sup = await login('qa_super');
  const dept = await login('qa_dept', 'TestOnly!2026', '5501');

  let r = await get(hse, '/api/reports/options');
  let j = await r.json();
  ok(r.status === 200 && Array.isArray(j.departments) && j.departments.length > 5, `options: ${j.departments && j.departments.length} قسم، mailConfigured=${j.mailConfigured}`);
  const someDept = j.departments && j.departments[1] && j.departments[1].name;

  r = await get(dept, '/api/reports/options'); ok(r.status === 403, `أدمن قسم ممنوع من الخيارات (${r.status})`);
  r = await get(dept, '/print/report'); ok(r.status === 403, `أدمن قسم ممنوع من التقرير (${r.status})`);
  r = await email(dept, 'a@b.com'); ok(r.status === 403, `أدمن قسم ممنوع من الإرسال (${r.status})`);
  r = await get(null, '/print/report'); ok(r.status === 401, `من غير تسجيل دخول مرفوض (${r.status})`);
  r = await get(null, '/api/reports/options'); ok(r.status === 401, `الخيارات من غير تسجيل دخول مرفوضة (${r.status})`);

  const wl = await fetch(BASE + '/api/worker-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '2546', empCode: '2546', password: 'WorkerTest!2026' }) });
  const wj = await wl.json().catch(() => ({}));
  if (wj.token) {
    r = await get(wj.token, '/print/report'); ok(r.status === 401 || r.status === 403, `العامل ممنوع من التقرير (${r.status})`);
    r = await get(wj.token, '/api/reports/options'); ok(r.status === 401 || r.status === 403, `العامل ممنوع من الخيارات (${r.status})`);
  } else console.log('ℹ️ مقدرتش أدخل كعامل:', wl.status, JSON.stringify(wj).slice(0, 120));

  r = await get(hse, '/print/report');
  let html = await r.text();
  ok(r.status === 200 && html.includes('المؤشرات الرئيسية') && html.includes('elsewedy-logo-print.png') && html.includes('class="toolbar no-print"'), `تقرير المصنع (${r.status}, ${(html.length / 1024).toFixed(0)}KB) فيه الشعار وشريط الطباعة`);
  fs.writeFileSync(OUT + 'api-report-factory.html', html);
  r = await get(hse, '/print/report?embed=1');
  html = await r.text();
  ok(r.status === 200 && !html.includes('class="toolbar no-print"') && html.includes('المؤشرات الرئيسية'), 'embed=1 من غير شريط الأزرار');
  r = await get(hse, '/print/report?autoprint=1');
  html = await r.text();
  ok(html.includes('window.print()') && html.includes("addEventListener('load'"), 'autoprint=1 بيطبع لوحده');
  r = await get(hse, '/print/report?dept=' + encodeURIComponent(someDept));
  html = await r.text();
  ok(r.status === 200 && html.includes(someDept), `تقرير قسم "${someDept}"`);
  r = await get(hse, '/print/report?emp=5943&period=quarter');
  html = await r.text();
  ok(r.status === 200 && html.includes('بيانات الموظف') && html.includes('5943'), 'تقرير موظف بالكود + الربع الحالي');
  fs.writeFileSync(OUT + 'api-report-emp.html', html);
  r = await get(hse, '/print/report?emp=999999');
  html = await r.text();
  ok(r.status === 400 && html.includes('مش موجود'), `كود غلط → 400 برسالة واضحة`);
  r = await get(hse, '/print/report?dept=' + encodeURIComponent('<script>alert(1)</script>'));
  html = await r.text();
  ok(r.status === 400 && !html.includes('<script>alert(1)</script>'), 'اسم قسم فيه HTML مش بيتنفذ (متأمن)');
  r = await get(hse, '/print/report?period=custom&from=2026-01-01&to=2026-03-31');
  html = await r.text();
  ok(r.status === 200 && html.replace(/<[^>]+>/g, '').includes('من 2026-01-01 إلى 2026-03-31'), 'فترة مخصصة');

  r = await get(sup, '/print/report?period=last_month');
  ok(r.status === 200, `السوبر أدمن بيطلع التقرير (${r.status})`);

  const lt = await (await post(hse, '/api/auth/link-token', { path: '/print/report' })).json();
  r = await get(null, '/print/report?period=month&dt=' + encodeURIComponent(lt.token));
  ok(r.status === 200, `رابط مؤقت للتقرير شغال (${r.status})`);
  const ltOther = await (await post(hse, '/api/auth/link-token', { path: '/print/permit/x' })).json();
  r = await get(null, '/print/report?dt=' + encodeURIComponent(ltOther.token));
  ok(r.status === 403, `رابط مؤقت لملف تاني مرفوض على التقرير (${r.status})`);
  const ltDept = await post(dept, '/api/auth/link-token', { path: '/print/report' });
  const ltDeptJ = await ltDept.json();
  if (ltDeptJ.token) {
    r = await get(null, '/print/report?dt=' + encodeURIComponent(ltDeptJ.token));
    ok(r.status === 403, `رابط مؤقت لأدمن قسم مش بيفتح التقرير (${r.status})`);
  }

  r = await email(hse, ''); j = await r.json(); ok(r.status === 400, `إيميل فاضي → 400: ${j.error}`);
  r = await email(hse, 'a@b.com,b@c.com,c@d.com,d@e.com,e@f.com,f@g.com'); j = await r.json(); ok(r.status === 400, `6 إيميلات → 400: ${j.error}`);
  r = await email(hse, 'not-an-email'); j = await r.json(); ok(r.status === 400, `إيميل غلط → 400: ${j.error}`);
  r = await email(hse, 'x@y.com\r\nBcc: evil@z.com'); j = await r.json(); ok(r.status === 400, `حقن هيدر في الإيميل → 400: ${j.error}`);

  const smtpBefore = await (await get(sup, '/api/admin/smtp-settings')).json();
  if (!smtpBefore.configured) {
    r = await email(hse, 'qa-receiver@test.local'); j = await r.json();
    ok(r.status === 503 && j.notConfigured === true, `SMTP مش متظبط → 503 notConfigured (${r.status})`);
  }

  const sinkPort = Number(process.env.HSE_TEST_SMTP_PORT) || 2525;
  r = await put(sup, '/api/admin/smtp-settings', { host: '127.0.0.1', port: sinkPort, user: 'qa-sink@test.local', pass: 'sink-only-not-real', from: 'qa-sink@test.local', secure: false });
  ok(r.status === 200, `ضبط SMTP وهمي (${r.status})`);
  r = await get(hse, '/api/reports/options'); j = await r.json();
  ok(j.mailConfigured === true, 'options بقت mailConfigured=true');

  const before = fs.readdirSync(OUT).filter(f => /^mail-\d+\.eml$/.test(f)).length;
  r = await email(hse, 'qa-receiver@test.local, second@test.local', { dept: someDept, period: 'ytd' });
  j = await r.json();
  ok(r.status === 200 && j.success && j.sentTo.length === 2, `الإرسال نجح (${r.status}) → ${JSON.stringify(j.sentTo)}`);
  const listMails = () => fs.readdirSync(OUT).filter(f => /^mail-\d+\.eml$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
  let mails = listMails();
  for (let i = 0; i < 40 && mails.length <= before; i++) {
    await new Promise(res => setTimeout(res, 150));
    mails = listMails();
  }
  ok(mails.length > before, `السيرفر الوهمي استلم إيميل (${mails[mails.length - 1]})`);
  if (mails.length > before) {
    const eml = fs.readFileSync(OUT + mails[mails.length - 1], 'utf8');
    ok(/^Subject: /m.test(eml) && /=\?UTF-8\?/i.test(eml), 'العنوان متشفّر UTF-8 (عربي)');
    ok(/Content-ID: <elsewedy-logo>/i.test(eml), 'الشعار مرفق مضمّن (cid:elsewedy-logo)');
    ok(/filename=.?HSE-Report-\d{4}-\d{2}-\d{2}\.html/i.test(eml), 'نسخة الطباعة مرفقة (HSE-Report-YYYY-MM-DD.html)');
    ok(/text\/plain/i.test(eml) && /text\/html/i.test(eml), 'الإيميل فيه نسخة نص + HTML');
    ok(/^To: .*qa-receiver@test\.local.*second@test\.local/m.test(eml), 'المستلمين الاتنين في To');
    const m = eml.match(/Content-Type: text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n--/);
    if (m) {
      const isB64 = /Content-Transfer-Encoding: base64/i.test(eml.slice(eml.indexOf('Content-Type: text/html'), eml.indexOf('Content-Type: text/html') + 300));
      const qp = t => Buffer.from(t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
      const body = isB64 ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8') : qp(m[1]);
      ok(body.includes('src="cid:elsewedy-logo"') && !body.includes('class="toolbar'), 'جسم الإيميل بيعرض الشعار بـ cid ومن غير أزرار');
      ok(body.includes(someDept), 'جسم الإيميل فيه اسم القسم المختار');
      fs.writeFileSync(OUT + 'mail-body.html', body);
    } else ok(false, 'مقدرتش أطلع جزء الـ HTML من الإيميل');
  }

  r = await get(sup, '/api/audit-log?entityType=report&limit=5'); j = await r.json();
  const entry = (j.entries || [])[0];
  ok(entry && entry.action === 'email' && /qa-receiver@test\.local/.test(entry.note || ''), 'الإرسال اتسجّل في سجل التدقيق');

  r = await email(hse, 'qa-receiver@test.local', { dept: 'قسم مش موجود' }); j = await r.json();
  ok(r.status === 400 && /مش موجود/.test(j.error || ''), `قسم غلط في الإرسال → 400: ${j.error}`);

  let ceoTok = null;
  r = await post(sup, '/api/users', { username: 'qa_ceo', password: 'TestOnly!2026', role: 'ceo', name: 'مدير تنفيذي (اختبار)' });
  if (r.status === 200 || r.status === 201 || r.status === 409 || r.status === 400) {
    try { ceoTok = await login('qa_ceo'); } catch (e) { try { ceoTok = await login('qa_ceo', 'TestOnly!2026', '6077'); } catch (e2) { console.log('ℹ️', e2.message.slice(0, 160)); } }
  }
  if (ceoTok) {
    r = await get(ceoTok, '/api/reports/options'); ok(r.status === 200, `حساب المتابعة بيشوف الخيارات (${r.status})`);
    r = await get(ceoTok, '/print/report'); ok(r.status === 200, `حساب المتابعة بيشوف التقرير (${r.status})`);
    r = await post(ceoTok, '/api/auth/link-token', { path: '/print/report' }); ok(r.status === 200, `حساب المتابعة ياخد رابط طباعة (${r.status})`);
    r = await email(ceoTok, 'qa-receiver@test.local'); ok(r.status === 200, `حساب المتابعة يقدر يبعت التقرير (${r.status})`);
  }

  let hit = 0;
  for (let i = 0; i < 20; i++) {
    r = await email(sup, 'bad-address');
    if (r.status === 429) { hit = i + 1; break; }
  }
  ok(hit > 0 && hit <= 16, `حد الإرسال اشتغل عند الطلب رقم ${hit}`);

  const t0 = Date.now(); await (await get(hse, '/print/report')).text(); const t1 = Date.now();
  ok(t1 - t0 < 1500, `وقت تقرير المصنع كله: ${t1 - t0}ms`);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
})().catch(e => { console.error('💥', e); process.exit(1); });
