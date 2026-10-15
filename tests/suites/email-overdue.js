const fs = require('fs');
const path = require('path');
const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const OUT = process.env.HSE_TEST_OUT || (__dirname + '/out');
const ROOT = process.env.HSE_ROOT || path.join(__dirname, '..', '..');
const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs'));
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };
const J = { 'Content-Type': 'application/json' };
const H = (t) => ({ ...J, Authorization: 'Bearer ' + t });

async function login(username, empCode = '271') {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: J, body: JSON.stringify({ username, password: 'TestOnly!2026', empCode }) });
  const j = await r.json();
  if (!j.token) throw new Error(`login ${username} failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.token;
}
const get = async (url, tok) => { const r = await fetch(BASE + url, { headers: H(tok) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = async (url, tok, body) => { const r = await fetch(BASE + url, { method: 'POST', headers: H(tok), body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const mailNumbers = () => fs.readdirSync(OUT).filter((f) => /^mail-\d+\.eml$/.test(f)).map((f) => Number(f.match(/\d+/)[0])).sort((a, b) => a - b);
const lastMail = () => { const n = mailNumbers(); return n.length ? fs.readFileSync(`${OUT}/mail-${n[n.length - 1]}.eml`, 'binary') : ''; };
function decodeHeaders(raw) {
  // Long headers are split into several encoded words that can cut through a character,
  // so a run of them is joined as bytes before decoding.
  const head = raw.slice(0, raw.indexOf('\r\n\r\n')).replace(/\r?\n[ \t]+/g, ' ');
  return head.replace(/(?:=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\s*)+/gi, (run) =>
    Buffer.concat([...run.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi)].map((m) => Buffer.from(m[1], 'base64'))).toString('utf8') + ' ');
}
function decodeParts(raw) {
  // Every base64 / quoted-printable MIME part, decoded.
  const parts = [];
  const re = /Content-Transfer-Encoding: (base64|quoted-printable)\r\n(?:[^\r\n]+\r\n)*\r\n([\s\S]*?)(?=\r\n--)/g;
  let m;
  while ((m = re.exec(raw))) {
    parts.push(m[1] === 'base64'
      ? Buffer.from(m[2].replace(/\s+/g, ''), 'base64')
      : Buffer.from(m[2].replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary'));
  }
  return parts;
}
async function xlsxIds(raw) {
  const xlsx = decodeParts(raw).find((b) => b.slice(0, 2).toString() === 'PK');
  if (!xlsx) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx);
  const ids = [];
  wb.worksheets[0].eachRow((row) => { const v = String(row.getCell(1).value || ''); if (/^(PTW|HZ|PR|WP)?-?\S*\d/.test(v) && /-/.test(v)) ids.push(v); });
  return ids;
}

// Independent statement of the expected order.
const statusRank = (s) => (/^rejected/.test(s) ? 3 : /^closed/.test(s) || s === 'completed' ? 2 : s === 'approved' ? 1 : 0);
const typeRisk = { hot: 0, confined: 0, height: 0, lifting: 0, excavation: 0, lockout: 1, loto: 1, general: 2 };
const riskRank = (p) => {
  const top = Math.max(0, ...(p.risks || []).map((r) => Number(r.score) || 0));
  return top > 12 ? 0 : top > 4 ? 1 : top > 0 ? 2 : (typeRisk[p.typeKey] ?? 2);
};

(async () => {
  const hse = await login('qa_hse');
  const sup = await login('qa_super');
  const dept = await login('qa_dept', '5501');
  const ceo = await login('qa_ceo');

  // ── Permit order: open first, riskiest first inside each status group ──
  const list = (await get('/api/permits?limit=500', hse)).body.permits || [];
  let ordered = list.length > 20;
  for (let i = 1; i < list.length; i++) {
    const a = [statusRank(list[i - 1].status), riskRank(list[i - 1])];
    const b = [statusRank(list[i].status), riskRank(list[i])];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) { ordered = false; console.log('   out of order at', i, list[i - 1].id, list[i].id); break; }
  }
  ok(ordered, `التصاريح مترتبة: المفتوح الأول وجوه كل حالة الأخطر الأول (${list.length} تصريح)`);
  const groups = new Set(list.map((p) => `${statusRank(p.status)}:${riskRank(p)}`));
  ok(groups.size >= 4, `الترتيب اتختبر على أكتر من مستوى خطورة وحالة (${groups.size} مجموعة)`);

  // ── Excel by e-mail ──
  let r = await post('/api/permits/email-excel', hse, { to: 'not-an-email' });
  ok(r.status === 400 && /غير صحيح/.test(r.body.error || ''), `إيميل غلط → 400 (${r.status})`);
  r = await post('/api/permits/email-excel', hse, { to: '' });
  ok(r.status === 400, `من غير إيميل → 400 (${r.status})`);
  r = await post('/api/permits/email-excel', hse, { to: 'a@x.test,b@x.test,c@x.test,d@x.test,e@x.test,f@x.test' });
  ok(r.status === 400, `أكتر من 5 إيميلات → 400 (${r.status})`);
  r = await post('/api/permits/email-excel', ceo, { to: 'boss@test.local' });
  ok(r.status === 403, `حساب المتابعة مايقدرش يبعت (${r.status})`);

  let before = mailNumbers().length;
  r = await post('/api/permits/email-excel', dept, { to: 'boss@test.local, second@test.local' });
  ok(r.status === 200 && r.body.success && r.body.sentTo.length === 2, `أدمن القسم بعت شيت التصاريح لإيميلين (${r.status} ${r.body.error || ''})`);
  ok(mailNumbers().length === before + 1, 'الإيميل وصل الـ SMTP');
  let raw = lastMail();
  let head = decodeHeaders(raw);
  ok(/سجل تصاريح العمل/.test(head) && /boss@test\.local/.test(head) && /second@test\.local/.test(head), 'العنوان والمستلمين صح');
  ok(/spreadsheetml\.sheet/.test(raw) && /filename[^=\r\n]*=/.test(raw) && /\.xlsx/.test(raw), 'فيه ملف Excel مرفق');
  const deptList = (await get('/api/permits?limit=500', dept)).body.permits || [];
  const sheetIds = await xlsxIds(raw);
  ok(Array.isArray(sheetIds) && sheetIds.length === r.body.count && deptList.every((p) => p.department === 'Electrical Maintenance'),
    `الشيت فيه ${sheetIds ? sheetIds.length : 0} تصريح = عدد تصاريح القسم بس (${r.body.count})`);
  const firstIds = deptList.slice(0, 15).map((p) => p.id);
  let pos = -1, sameOrder = sheetIds && firstIds.length > 0;
  for (const id of firstIds) { const at = sheetIds ? sheetIds.indexOf(id) : -1; if (at <= pos) { sameOrder = false; break; } pos = at; }
  ok(sameOrder, 'ترتيب الشيت هو نفس ترتيب صفحة التصاريح');

  before = mailNumbers().length;
  r = await post('/api/hazards/email-excel', hse, { to: 'boss@test.local' });
  ok(r.status === 200 && r.body.count > 0, `شيت البلاغات اتبعت (${r.status}, ${r.body.count} بلاغ)`);
  raw = lastMail();
  ok(mailNumbers().length === before + 1 && /سجل بلاغات الخطورة/.test(decodeHeaders(raw)) && /spreadsheetml\.sheet/.test(raw), 'إيميل البلاغات وصل ومعاه الشيت');

  // ── Overdue permits: still awaiting approval after N days ──
  const allPermits = (await get('/api/permits?limit=500', hse)).body.permits || [];
  const cutoff = Date.now() - 2 * 24 * 3.6e6;
  const awaiting = (p) => !/^(rejected|closed)/.test(p.status) && p.status !== 'completed' && p.status !== 'approved';
  const expectPermits = allPermits.filter((p) => awaiting(p) && new Date(p.submittedAt).getTime() < cutoff);
  r = await get('/api/permits?overdue=2&limit=500', hse);
  const odPermits = r.body.permits || [];
  ok(r.status === 200 && odPermits.length > 0 && r.body.total === expectPermits.length,
    `التصاريح المتأخرة (يومين) = اللي لسه مستنية موافقة بس (${r.body.total} = المتوقع ${expectPermits.length})`);
  ok(odPermits.every((p, i) => i === 0 || riskRank(odPermits[i - 1]) < riskRank(p)
    || (riskRank(odPermits[i - 1]) === riskRank(p) && odPermits[i - 1].submittedAt <= p.submittedAt)), 'مترتبة: الأخطر الأول وبعدين الأقدم');
  const deptOverdue = (await get('/api/permits?overdue=0&limit=500', dept)).body.permits || [];
  ok(deptOverdue.length > 0 && deptOverdue.every((p) => p.department === 'Electrical Maintenance' && awaiting(p)), `أدمن القسم بيشوف متأخرات قسمه بس (${deptOverdue.length})`);

  // ── Who opened a hazard report ──
  const all = (await get('/api/hazards', hse)).body.hazards || [];
  const target = all.find((h) => h.status === 'open');
  r = await post('/api/hazards/seen', hse, { ids: [target.id] });
  ok(r.status === 200, `تسجيل الفتح (${r.status})`);
  await post('/api/hazards/seen', hse, { ids: [target.id] });
  await post('/api/hazards/seen', sup, { ids: [target.id] });
  const seen = ((await get('/api/hazards', hse)).body.hazards || []).find((h) => h.id === target.id);
  const roles = ((seen && seen.viewers) || []).map((v) => v.role);
  ok(roles.length === 2 && roles.includes('hse_admin') && roles.includes('super_admin'), `بيظهر مين فتحه، وكل شخص مرة واحدة (${roles.join(', ')})`);
  const closedHz = all.find((h) => h.status === 'closed');
  await post('/api/hazards/seen', hse, { ids: [closedHz.id] });
  const closedAfter = ((await get('/api/hazards', hse)).body.hazards || []).find((h) => h.id === closedHz.id);
  ok(!(closedAfter.viewers || []).length, 'البلاغ المقفول مابيتسجلش عليه مين فتحه');

  // ── Forward a hazard report by e-mail ──
  const alertBefore = (await get('/api/hazards/alert-settings', hse)).body.lastResult || null;
  before = mailNumbers().length;
  r = await post(`/api/hazards/${encodeURIComponent(target.id)}/forward`, hse, { to: 'boss@test.local', note: 'محتاجين إجراء النهارده' });
  ok(r.status === 200 && r.body.success, `توجيه البلاغ بالإيميل (${r.status} ${r.body.error || ''})`);
  raw = lastMail();
  head = decodeHeaders(raw);
  let body = decodeParts(raw).map((x) => x.toString('utf8')).join('\n');
  ok(mailNumbers().length === before + 1 && head.includes(target.id) && /محتاج متابعة/.test(head), 'الإيميل وصل وعنوانه فيه رقم البلاغ');
  ok(body.includes('محتاجين إجراء النهارده') && /وجّهلك البلاغ ده للمتابعة/.test(body), 'الملاحظة واسم اللي وجّه في الإيميل');
  const fwd = ((await get('/api/hazards', hse)).body.hazards || []).find((h) => h.id === target.id);
  ok(fwd && fwd.forwards.length === 1 && fwd.forwards[0].to.includes('boss@test.local') && fwd.forwards[0].by, 'التوجيه اتسجّل على البلاغ');
  const alertAfter = (await get('/api/hazards/alert-settings', hse)).body.lastResult || null;
  ok(JSON.stringify(alertBefore) === JSON.stringify(alertAfter), 'التوجيه اليدوي مابيغيرش "آخر تنبيه" في إعدادات التنبيهات');

  r = await post(`/api/hazards/${encodeURIComponent(closedHz.id)}/forward`, hse, { to: 'boss@test.local' });
  head = decodeHeaders(lastMail());
  ok(r.status === 200 && /للاطلاع/.test(head) && head.includes(closedHz.id), `البلاغ المقفول بيتوجّه للاطلاع (${r.status})`);
  r = await post(`/api/hazards/${encodeURIComponent(target.id)}/forward`, hse, { to: 'bad email' });
  ok(r.status === 400, `إيميل غلط → 400 (${r.status})`);
  r = await post('/api/hazards/HZ-0000-0000/forward', hse, { to: 'boss@test.local' });
  ok(r.status === 404, `بلاغ مش موجود → 404 (${r.status})`);
  const otherDeptHz = all.find((h) => h.department !== 'Electrical Maintenance' && h.assignedToMaintenance !== 'Electrical Maintenance');
  r = await post(`/api/hazards/${encodeURIComponent(otherDeptHz.id)}/forward`, dept, { to: 'boss@test.local' });
  ok(r.status === 404, `أدمن قسم مايقدرش يوجّه بلاغ قسم تاني (${r.status})`);
  r = await post(`/api/hazards/${encodeURIComponent(target.id)}/forward`, ceo, { to: 'boss@test.local' });
  ok(r.status === 403, `حساب المتابعة مايقدرش يوجّه (${r.status})`);

  // ── Forward a work permit by e-mail ──
  const permit = deptList[0];
  before = mailNumbers().length;
  r = await post(`/api/permits/${encodeURIComponent(permit.id)}/forward`, dept, { to: 'boss@test.local', note: 'راجعوا التصريح ده' });
  ok(r.status === 200 && r.body.success, `توجيه التصريح بالإيميل (${r.status} ${r.body.error || ''})`);
  raw = lastMail();
  head = decodeHeaders(raw);
  body = decodeParts(raw).map((x) => x.toString('utf8')).join('\n');
  ok(mailNumbers().length === before + 1 && head.includes(permit.id) && /تصريح عمل للمتابعة/.test(head), 'إيميل التصريح وصل وعنوانه فيه رقم التصريح');
  ok(body.includes('راجعوا التصريح ده') && /وجّهلك تصريح العمل ده/.test(body) && body.includes(permit.id), 'فيه الملاحظة ومستند التصريح');
  const fwdPermit = ((await get('/api/permits?limit=500', dept)).body.permits || []).find((p) => p.id === permit.id);
  ok(fwdPermit && (fwdPermit.forwards || []).length === 1 && fwdPermit.forwards[0].to.includes('boss@test.local'), 'التوجيه اتسجّل على التصريح');
  const otherPermit = allPermits.find((p) => p.department !== 'Electrical Maintenance');
  r = await post(`/api/permits/${encodeURIComponent(otherPermit.id)}/forward`, dept, { to: 'boss@test.local' });
  ok(r.status === 404, `أدمن قسم مايقدرش يوجّه تصريح قسم تاني (${r.status})`);
  r = await post('/api/permits/NOPE-1/forward', hse, { to: 'boss@test.local' });
  ok(r.status === 404, `تصريح مش موجود → 404 (${r.status})`);
  r = await post(`/api/permits/${encodeURIComponent(permit.id)}/forward`, hse, { to: 'x@' });
  ok(r.status === 400, `إيميل غلط → 400 (${r.status})`);
  r = await post(`/api/permits/${encodeURIComponent(permit.id)}/forward`, ceo, { to: 'boss@test.local' });
  ok(r.status === 403, `حساب المتابعة مايقدرش يوجّه (${r.status})`);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
