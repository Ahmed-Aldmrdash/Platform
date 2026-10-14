const fs = require('fs');
const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const OUT = process.env.HSE_TEST_OUT || (__dirname + '/out');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

const mails = () => fs.readdirSync(OUT).filter(f => /^mail-\d+\.eml$/.test(f)).length;
function decodeEml(raw) {
  const split = raw.indexOf('\r\n\r\n');
  const headRaw = split === -1 ? raw : raw.slice(0, split);
  const bodyRaw = split === -1 ? '' : raw.slice(split + 4);
  let head = headRaw.replace(/\r?\n[ \t]+/g, ' ').replace(/\?=\s+=\?UTF-8\?B\?/gi, '');
  head = head.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  const isB64 = /content-transfer-encoding:\s*base64/i.test(headRaw);
  const body = isB64
    ? Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64').toString('utf8')
    : Buffer.from(bodyRaw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
  return head + '\n\n' + body;
}
const lastMail = () => {
  const files = fs.readdirSync(OUT).filter(f => /^mail-\d+\.eml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return files.length ? decodeEml(fs.readFileSync(`${OUT}/${files[files.length - 1]}`, 'binary')) : '';
};
const waitMail = async (before) => {
  for (let i = 0; i < 40 && mails() <= before; i++) await new Promise(r => setTimeout(r, 150));
  return mails();
};

(async () => {
  const login = async (u, p = 'TestOnly!2026', c = '271') => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, empCode: c }) });
    const j = await r.json();
    if (!j.token) throw new Error(`login ${u}: ${JSON.stringify(j).slice(0, 150)}`);
    return j.token;
  };
  const hse = await login('qa_hse');
  const H = { Authorization: 'Bearer ' + hse, 'Content-Type': 'application/json' };

  await fetch(BASE + '/api/hazards/alert-settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ highRiskEnabled: false, recipients: [{ empCode: '6173', name: 'مستلم اختبار', email: 'pen-alert@test.local', enabled: true }] }),
  });

  const emps = await (await fetch(BASE + '/api/employees', { headers: H })).json();
  const list = Array.isArray(emps) ? emps : (emps.employees || []);
  const pens = await (await fetch(BASE + '/api/penalties', { headers: H })).json();
  const penList = Array.isArray(pens) ? pens : (pens.penalties || []);
  const yr = new Date().getFullYear();
  const used = new Set(penList.filter(p => String(p.date || '').startsWith(String(yr))).map(p => String(p.empCode || '').replace(/^0+/, '')));
  const target = list.find(e => e.empCode && !used.has(String(e.empCode).replace(/^0+/, '')));
  ok(!!target, `لقيت موظف من غير جزاءات السنة دي: ${target && target.empCode} — ${target && target.name}`);
  if (!target) { console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`); process.exit(1); }

  const addPenalty = (n) => fetch(BASE + '/api/penalties', {
    method: 'POST', headers: H,
    body: JSON.stringify({ empCode: target.empCode, date: `${yr}-0${n}-10`, reason: `مخالفة اختبار ${n}`, issuedBy: 'اختبار آلي' }),
  });

  const before = mails();
  const r1 = await (await addPenalty(1)).json();
  ok(r1.success && r1.repeatCount === 1 && !r1.repeatAlert, `الجزاء الأول: العدّاد 1، مفيش تنبيه`);
  const r2 = await (await addPenalty(2)).json();
  ok(r2.success && r2.repeatCount === 2 && !r2.repeatAlert, `الجزاء التاني: العدّاد 2، مفيش تنبيه`);
  await new Promise(r => setTimeout(r, 800));
  ok(mails() === before, `مفيش إيميل لحد الجزاء التاني (${mails() - before})`);

  const r3 = await (await addPenalty(3)).json();
  ok(r3.success && r3.repeatCount === 3 && r3.repeatAlert === true, `الجزاء التالت: العدّاد 3 والتنبيه اشتغل`);
  const after = await waitMail(before);
  ok(after === before + 1, `اتبعت إيميل تنبيه واحد (${after - before})`);
  const eml = lastMail();
  ok(/pen-alert@test\.local/.test(eml), 'اتبعت للمستلم الصح');
  ok(/تكرار جزاءات/.test(eml), 'العنوان فيه "تكرار جزاءات"');
  ok(eml.includes(String(target.empCode)), `الإيميل فيه كود الموظف (${target.empCode})`);
  ok(/تدريب إضافي|مقابلة/.test(eml), 'الإيميل فيه اقتراح إجراء مش رقم بس');

  const notes = await (await fetch(BASE + '/api/notifications', { headers: H })).json();
  const nlist = Array.isArray(notes) ? notes : (notes.notifications || []);
  ok(nlist.some(n => /تكرار جزاءات/.test(n.title || '')), `الإشعار الداخلي اتسجّل (${nlist.length} إشعار)`);

  const r4 = await (await addPenalty(4)).json();
  ok(r4.repeatCount === 4 && r4.repeatAlert === true, `الجزاء الرابع: العدّاد 4 والتنبيه لسه شغال`);

  const dept = await login('qa_dept', 'TestOnly!2026', '5501');
  const asDept = await fetch(BASE + '/api/penalties', {
    method: 'POST', headers: { Authorization: 'Bearer ' + dept, 'Content-Type': 'application/json' },
    body: JSON.stringify({ empCode: target.empCode, reason: 'x' }),
  });
  ok(asDept.status === 403, `أدمن القسم ممنوع من تسجيل جزاء (${asDept.status})`);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
