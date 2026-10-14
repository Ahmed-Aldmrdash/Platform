const fs = require('fs');
const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const OUT = process.env.HSE_TEST_OUT || (__dirname + '/out');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

const mails = () => fs.readdirSync(OUT).filter(f => /^mail-\d+\.eml$/.test(f)).map(f => Number(f.match(/\d+/)[0])).sort((a, b) => a - b);
function decodeEml(raw) {
  const split = raw.indexOf('\r\n\r\n');
  const headRaw = split === -1 ? raw : raw.slice(0, split);
  const bodyRaw = split === -1 ? '' : raw.slice(split + 4);
  let head = headRaw.replace(/\r?\n[ \t]+/g, ' ').replace(/\?=\s+=\?UTF-8\?B\?/gi, '');
  head = head.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  const body = Buffer.from(bodyRaw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
  return head + '\n\n' + body;
}
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  const login = async (u, p = 'TestOnly!2026', c = '271') => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, empCode: c }) });
    const j = await r.json();
    if (!j.token) throw new Error(`login ${u}: ${JSON.stringify(j).slice(0, 150)}`);
    return j.token;
  };
  const hse = await login('qa_hse');
  const H = { Authorization: 'Bearer ' + hse, 'Content-Type': 'application/json' };

  const s0 = await (await fetch(BASE + '/api/reports/schedule', { headers: H })).json();
  ok(s0.enabled === false && s0.frequency === 'monthly', `الافتراضي مقفول وشهري (${JSON.stringify({ e: s0.enabled, f: s0.frequency, t: s0.time })})`);

  const bad = await fetch(BASE + '/api/reports/schedule', { method: 'PUT', headers: H, body: JSON.stringify({ enabled: true, recipients: '' }) });
  ok(bad.status === 400, `تفعيل من غير إيميل اترفض (${bad.status})`);
  const badMail = await fetch(BASE + '/api/reports/schedule', { method: 'PUT', headers: H, body: JSON.stringify({ enabled: true, recipients: 'مش-إيميل' }) });
  ok(badMail.status === 400, `إيميل غلط اترفض (${badMail.status})`);
  const badTime = await fetch(BASE + '/api/reports/schedule', { method: 'PUT', headers: H, body: JSON.stringify({ recipients: 'a@b.com', time: '99:99' }) });
  ok(badTime.status === 400, `ميعاد غلط اترفض (${badTime.status})`);

  const put = await fetch(BASE + '/api/reports/schedule', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ enabled: true, frequency: 'monthly', time: '07:00', recipients: 'boss@test.local, hse@test.local' }),
  });
  const pj = await put.json();
  ok(put.status === 200 && pj.enabled && pj.recipients.length === 2, `اتحفظت الإعدادات (${put.status}, ${pj.recipients && pj.recipients.join(',')})`);

  const n0 = mails().length;
  const send = await fetch(BASE + '/api/reports/schedule/send-now', { method: 'POST', headers: H, body: '{}' });
  const sj = await send.json().catch(() => ({}));
  await new Promise(r => setTimeout(r, 2000));
  ok(send.status === 200 && sj.success, `الإرسال الفوري نجح (${send.status}: ${sj.label || sj.error})`);
  ok(mails().length === n0 + 1, `اتبعت إيميل واحد (${mails().length - n0})`);

  const last = mails()[mails().length - 1];
  const eml = decodeEml(fs.readFileSync(`${OUT}/mail-${last}.eml`, 'binary'));
  const t = text(eml);
  ok(/boss@test\.local/.test(eml) && /hse@test\.local/.test(eml), 'اتبعت للإيميلين');
  ok(/تقرير السلامة الشهري/.test(eml), 'العنوان فيه "تقرير السلامة الشهري"');
  ok(/مقارنة بـ/.test(t), `قسم المقارنة موجود: ${(t.match(/مقارنة بـ[^ ]* [^ ]*/) || [])[0] || '—'}`);
  ok(/كانت/.test(t), 'المقارنة بتعرض الرقم القديم ("كانت ...")');
  ok(/▲|▼|زي ما هي/.test(t), 'فيه أسهم اتجاه (▲/▼) أو "زي ما هي"');
  ok(/HSE-Report-\d{4}-\d{2}\.html/.test(eml), 'نسخة الطباعة مرفقة');

  await fetch(BASE + '/api/reports/schedule', { method: 'PUT', headers: H, body: JSON.stringify({ enabled: true, frequency: 'quarterly', time: '07:00', recipients: 'boss@test.local' }) });
  const n1 = mails().length;
  const q = await fetch(BASE + '/api/reports/schedule/send-now', { method: 'POST', headers: H, body: '{}' });
  const qj = await q.json().catch(() => ({}));
  await new Promise(r => setTimeout(r, 2000));
  ok(q.status === 200 && /الربع/.test(qj.label || ''), `الربع سنوي: ${qj.label || qj.error}`);
  if (mails().length > n1) {
    const e2 = decodeEml(fs.readFileSync(`${OUT}/mail-${mails()[mails().length - 1]}.eml`, 'binary'));
    ok(/تقرير السلامة الربع سنوي/.test(e2), 'عنوان الربع سنوي صح');
    ok(/مقارنة بـ.*الربع/.test(text(e2)), `المقارنة بالربع اللي قبله: ${(text(e2).match(/مقارنة بـ[^0-9]*\d{4}/) || [])[0] || '—'}`);
  }

  const dept = await login('qa_dept', 'TestOnly!2026', '5501');
  const asDept = await fetch(BASE + '/api/reports/schedule', { method: 'PUT', headers: { Authorization: 'Bearer ' + dept, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false, recipients: '' }) });
  ok(asDept.status === 403, `أدمن القسم ممنوع من تغيير الجدولة (${asDept.status})`);
  const ceo = await login('qa_ceo', 'TestOnly!2026', '6077');
  const ceoPut = await fetch(BASE + '/api/reports/schedule', { method: 'PUT', headers: { Authorization: 'Bearer ' + ceo, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false, recipients: '' }) });
  ok(ceoPut.status === 403, `حساب المتابعة عرض بس — مش بيغيّر الجدولة (${ceoPut.status})`);

  await fetch(BASE + '/api/reports/schedule', { method: 'PUT', headers: H, body: JSON.stringify({ enabled: false, recipients: '' }) });

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
