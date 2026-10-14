const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  const r0 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'qa_hse', password: 'TestOnly!2026', empCode: '271' }) });
  const tok = (await r0.json()).token;
  const H = { Authorization: 'Bearer ' + tok };
  const get = async p => { const r = await fetch(BASE + p, { headers: H }); return { status: r.status, html: await r.text() }; };

  const opt = await (await fetch(BASE + '/api/reports/options', { headers: H })).json();
  ok(Array.isArray(opt.years) && opt.years.includes(new Date().getFullYear()), `قايمة السنين: ${JSON.stringify(opt.years)}`);

  const y = new Date().getFullYear();
  const cases = [
    [`?period=year&year=${y}`, `سنة ${y}`],
    [`?period=quarter&year=${y}&q=1`, `الربع الأول ${y} (يناير – مارس)`],
    [`?period=quarter&year=${y}&q=2`, `الربع الثاني ${y} (أبريل – يونيو)`],
    [`?period=quarter&year=${y}&q=3`, `الربع الثالث ${y} (يوليو – سبتمبر)`],
    [`?period=quarter&year=${y}&q=4`, `الربع الرابع ${y} (أكتوبر – ديسمبر)`],
    [`?period=month&year=${y}&m=1`, `شهر يناير ${y}`],
    [`?period=month&year=${y}&m=2`, `شهر فبراير ${y}`],
    [`?period=month&year=${y}&m=12`, `شهر ديسمبر ${y}`],
  ];
  for (const [qs, label] of cases) {
    const r = await get('/print/report' + qs);
    const t = text(r.html);
    const pen = (t.match(/الجزاءات \((\d+)\)/) || [])[1];
    ok(r.status === 200 && t.includes(label), `${label} → 200 (جزاءات: ${pen || 0})`);
  }

  const q1 = await get(`/print/report?period=quarter&year=${y}&q=1`);
  const tbl = (q1.html.match(/<table class="data">[\s\S]*?<\/table>/) || [''])[0];
  const rows = (tbl.match(/<tr>/g) || []).length - 1;
  const t1 = text(q1.html);
  const total = Number((t1.match(/الجزاءات \((\d+)\)/) || [])[1] || 0);
  ok(total <= 10 ? rows === total : (rows === 10 && t1.includes('آخر 10')), `جدول الجزاءات: ${rows} صف من ${total}${total > 10 ? ' (آخر 10)' : ''}`);

  const past = await get(`/print/report?period=year&year=${y - 1}`);
  const tp = text(past.html);
  ok(past.status === 200 && tp.includes(`سنة ${y - 1}`) && !tp.includes('الالتزام بالأهداف') && !tp.includes('متوسط الالتزام'), `سنة ${y - 1}: من غير قسم الالتزام بالأهداف`);
  const cur = text((await get(`/print/report?period=quarter&year=${y}&q=1`)).html);
  ok(cur.includes('الالتزام بالأهداف — لحد النهارده'), 'فترة في السنة الحالية: الالتزام بالأهداف ظاهر');

  const bad = await get('/print/report?period=quarter&year=abcd&q=9');
  ok(bad.status === 200, `قيم غلط في الفلتر مش بتوقّع التقرير (${bad.status})`);

  const emp = await get(`/print/report?emp=5943&period=month&year=${y}&m=3`);
  ok(emp.status === 200 && text(emp.html).includes(`شهر مارس ${y}`) && text(emp.html).includes('بيانات الموظف'), 'تقرير موظف لشهر معيّن');

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
})().catch(e => { console.error('💥', e); process.exit(1); });
