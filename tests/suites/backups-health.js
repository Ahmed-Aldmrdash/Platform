const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
const SNAP_DIR = process.env.HSE_TEST_SNAP_DIR || path.join(__dirname, '..', '..', 'data', 'snapshots');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

(async () => {
  const login = async (u, p, c) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, empCode: c }) });
    const j = await r.json();
    if (!j.token) throw new Error(`login ${u}: ${JSON.stringify(j).slice(0, 150)}`);
    return j.token;
  };
  const sup = await login('qa_super', 'TestOnly!2026', '271');
  const H = { Authorization: 'Bearer ' + sup, 'Content-Type': 'application/json' };

  const hz = await fetch(BASE + '/healthz');
  const hj = await hz.json();
  ok(hz.status === 200 && hj.ok === true, `/healthz شغال (${hz.status})`);
  ok(typeof hj.uptimeSec === 'number' && !JSON.stringify(hj).match(/empCode|password|token|@/i), `/healthz مفيهوش بيانات حساسة: ${JSON.stringify(hj)}`);
  const hzNoAuth = await fetch(BASE + '/healthz', { headers: {} });
  ok(hzNoAuth.status === 200, '/healthz شغال من غير تسجيل دخول (عشان خدمات المراقبة)');

  const before = fs.existsSync(SNAP_DIR) ? fs.readdirSync(SNAP_DIR).length : 0;
  const snap = await fetch(BASE + '/api/admin/backup/snapshot-now', { method: 'POST', headers: H, body: '{}' });
  const sj = await snap.json().catch(() => ({}));
  ok(snap.status === 200 && sj.success, `نسخة محلية يدوية اتاخدت (${snap.status}: ${sj.file || sj.error})`);
  ok(sj.sizeKB > 0 && sj.counts && sj.counts.permits > 0, `النسخة فيها بيانات: ${JSON.stringify(sj.counts || {})} — ${sj.sizeKB} KB`);

  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json.gz'));
  ok(files.length >= 1 && files.length >= before, `الملف اتكتب على القرص (${files.length} نسخة)`);
  ok(!fs.readdirSync(SNAP_DIR).some(f => f.endsWith('.tmp')), 'مفيش ملفات مؤقتة متسايبة');

  const raw = zlib.gunzipSync(fs.readFileSync(path.join(SNAP_DIR, sj.file)));
  const data = JSON.parse(raw.toString('utf8'));
  ok(!!data.collections && Array.isArray(data.collections.hazards), `الملف بيتفك ويتقرا (${Object.keys(data.collections).length} مجموعة)`);

  const ver = await fetch(BASE + '/api/admin/backup/verify-snapshot', { method: 'POST', headers: H, body: '{}' });
  const vj = await ver.json();
  ok(ver.status === 200 && vj.ok === true && vj.total > 0, `اختبار الاسترجاع نجح (${vj.total} سجل من ${vj.file})`);

  const badName = 'hse-snapshot-2020-01-01_00-00.json.gz';
  fs.writeFileSync(path.join(SNAP_DIR, badName), Buffer.from('مش ملف مضغوط'));
  const ver2 = await fetch(BASE + '/api/admin/backup/verify-snapshot', { method: 'POST', headers: H, body: JSON.stringify({ file: badName }) });
  const vj2 = await ver2.json();
  ok(vj2.ok === false && /تالف|مش مضغوط/.test(vj2.error || ''), `النسخة التالفة اتكشفت: ${vj2.error}`);
  fs.unlinkSync(path.join(SNAP_DIR, badName));

  const list = await (await fetch(BASE + '/api/admin/backup/snapshots', { headers: H })).json();
  ok(Array.isArray(list.snapshots) && list.snapshots.length >= 1, `قايمة النسخ بترجع (${list.snapshots.length})`);
  ok(list.keepDaily === 14 && list.keepWeekly === 8, `سياسة الاحتفاظ: ${list.keepDaily} يوم + ${list.keepWeekly} أسبوع`);

  const dl = await fetch(`${BASE}/api/admin/backup/snapshots/${sj.file}`, { headers: { Authorization: 'Bearer ' + sup } });
  const buf = Buffer.from(await dl.arrayBuffer());
  ok(dl.status === 200 && buf[0] === 0x1f && buf[1] === 0x8b, `تنزيل النسخة شغال (${dl.status}, ${buf.length} بايت, gzip صحيح)`);
  const trav = await fetch(`${BASE}/api/admin/backup/snapshots/..%2F..%2Fapp.db`, { headers: { Authorization: 'Bearer ' + sup } });
  ok(trav.status === 400 || trav.status === 404, `محاولة الخروج من المجلد اترفضت (${trav.status})`);

  const hse = await login('qa_hse', 'TestOnly!2026', '271');
  const asHse = await fetch(BASE + '/api/admin/backup/snapshot-now', { method: 'POST', headers: { Authorization: 'Bearer ' + hse, 'Content-Type': 'application/json' }, body: '{}' });
  ok(asHse.status === 403, `أخذ نسخة: سوبر أدمن بس (${asHse.status} لمسئول السلامة)`);
  const dept = await login('qa_dept', 'TestOnly!2026', '5501');
  const asDept = await fetch(BASE + '/api/admin/backup/snapshots', { headers: { Authorization: 'Bearer ' + dept } });
  ok(asDept.status === 403, `قايمة النسخ ممنوعة على أدمن القسم (${asDept.status})`);
  const noTok = await fetch(BASE + '/api/admin/backup/snapshots');
  ok(noTok.status === 401, `قايمة النسخ ممنوعة من غير تسجيل دخول (${noTok.status})`);

  const ah = await (await fetch(BASE + '/api/admin/health', { headers: H })).json();
  ok(ah.ok === true && ah.db.ok === true && typeof ah.db.pendingWrites === 'number' && ah.snapshots.count >= 1, `صحة السيرفر: DB ${ah.db.driver} (${ah.db.latencyMs}ms)، ${ah.snapshots.count} نسخة، ذاكرة ${ah.memoryMB} ميجا`);
  ok(ah.errors && typeof ah.errors.total === 'number', `عدّاد الأخطاء شغال (${ah.errors.total} خطأ من وقت التشغيل)`);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
