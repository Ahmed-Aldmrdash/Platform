const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

(async () => {
  const login = async (u, p = 'TestOnly!2026', c = '271') => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, empCode: c }) });
    const j = await r.json();
    if (!j.token) throw new Error(`login ${u}: ${JSON.stringify(j).slice(0, 150)}`);
    return j.token;
  };
  const hse = await login('qa_hse');
  const sup = await login('qa_super');
  const H = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
  const get = async (t, p) => { const r = await fetch(BASE + p, { headers: H(t) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  const legacy = await get(hse, '/api/storage/work-permits');
  ok(legacy.status === 200 && typeof legacy.body.value === 'string', `مسار التوافق القديم لسه شغال (${legacy.status})`);
  const all = JSON.parse(legacy.body.value);
  ok(Array.isArray(all) && all.length > 100, `الترحيل تمّ: ${all.length} تصريح في الجدول`);
  ok(all[0] && all[0].id && all[0].status !== undefined, 'شكل التصريح كامل زي ما كان');

  const page = await get(hse, '/api/permits?limit=50');
  ok(page.status === 200 && Array.isArray(page.body.permits), `صفحة التصاريح بترجع (${page.status})`);
  ok(page.body.permits.length <= 50, `الصفحة ${page.body.permits.length} تصريح (الحد 50)`);
  ok(typeof page.body.total === 'number' && page.body.total > 0, `الإجمالي بيرجع: ${page.body.total}`);

  const fullBytes = Buffer.byteLength(legacy.body.value);
  const pageBytes = Buffer.byteLength(JSON.stringify(page.body.permits));
  ok(pageBytes * 3 < fullBytes, `الصفحة ${Math.round(pageBytes / 1024)} كيلو مقابل ${Math.round(fullBytes / 1024)} كيلو للتحميل الكامل`);

  const rank = p => {
    const s = String(p.status || 'pending').toLowerCase();
    if (s.startsWith('rejected')) return 3;
    if (s.startsWith('closed') || s === 'completed') return 2;
    if (s === 'approved') return 1;
    return 0;
  };
  const ranks = page.body.permits.map(rank);
  ok(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), `الترتيب صح: ${ranks.slice(0, 8).join(',')}`);

  const p2 = await get(hse, '/api/permits?limit=50&offset=50');
  const ids1 = new Set(page.body.permits.map(p => p.id));
  const dupes = (p2.body.permits || []).filter(p => ids1.has(p.id));
  ok(p2.status === 200 && dupes.length === 0, `الصفحة التانية من غير تكرار (${(p2.body.permits || []).length} تصريح، ${dupes.length} مكرر)`);
  ok(p2.body.total === page.body.total, 'الإجمالي ثابت بين الصفحات');

  const some = page.body.permits[0];
  const byId = await get(hse, `/api/permits?q=${encodeURIComponent(some.id)}&limit=5`);
  ok(byId.status === 200 && (byId.body.permits || []).some(p => p.id === some.id), `البحث برقم التصريح لقاه (${(byId.body.permits || []).length} نتيجة)`);
  const junk = await get(hse, '/api/permits?q=zzz_no_such_thing_zzz&limit=5');
  ok(junk.body.total === 0, `بحث من غير نتيجة بيرجّع 0 (${junk.body.total})`);

  const facets = await get(hse, '/api/permits/facets');
  ok(facets.status === 200 && Array.isArray(facets.body.years) && facets.body.years.length, `خيارات الفلاتر: ${facets.body.years.length} سنة، ${(facets.body.departments || []).length} قسم`);
  const y = facets.body.years[0];
  const byYear = await get(hse, `/api/permits?year=${y}&limit=20`);
  ok(byYear.status === 200 && (byYear.body.permits || []).every(p => String(p.date || '').startsWith(String(y))), `فلتر سنة ${y}: كل النتايج من نفس السنة (${byYear.body.total})`);

  const appr = await get(hse, '/api/permits?status=approved&limit=20');
  ok(appr.status === 200 && (appr.body.permits || []).every(p => p.status === 'approved'), `فلتر "معتمد" شغال: ${appr.body.total} تصريح`);
  const closed = await get(hse, '/api/permits?status=closed&limit=20');
  ok(closed.status === 200 && (closed.body.permits || []).every(p => String(p.status).startsWith('closed') || p.status === 'completed'), `فلتر "مغلق" شغال: ${closed.body.total} تصريح`);
  const multi = await get(hse, '/api/permits?status=pending,pending_dept,pending_area_head&limit=20');
  ok(multi.status === 200 && (multi.body.permits || []).every(p => ['pending', 'pending_dept', 'pending_area_head'].includes(p.status)), `فلتر بأكتر من حالة شغال: ${multi.body.total}`);

  ok((page.body.permits || []).every(p => p.status !== 'rejected_area'), 'السلامة مش بتشوف المرفوض من رئيس القسم');

  const dept = await login('qa_dept', 'TestOnly!2026', '5501');
  const dPage = await get(dept, '/api/permits?limit=50&department=' + encodeURIComponent('M.B'));
  const depts = new Set((dPage.body.permits || []).map(p => p.department));
  ok(dPage.status === 200, `أدمن القسم بيقدر يجيب صفحته (${dPage.status})`);
  ok(depts.size <= 1 && (!depts.size || !depts.has('M.B') || 'M.B' === 'Electrical Maintenance'),
    `أدمن القسم اتقفل على قسمه رغم إنه طلب قسم تاني: ${[...depts].join(', ') || '(فاضي)'}`);

  const noTok = await fetch(BASE + '/api/permits?limit=5');
  ok(noTok.status === 401, `المسار مقفول من غير تسجيل دخول (${noTok.status})`);

  const created = await fetch(BASE + '/api/permits', {
    method: 'POST', headers: H(hse),
    body: JSON.stringify({ permit: {
      typeKey: 'general', typeLabel: 'عام', department: 'الصيانة الميكانيكية', shift: 'الأولى',
      date: new Date().toISOString().slice(0, 10), timeFrom: '08:00', timeTo: '10:00',
      workerName: 'اختبار الجدول', employeeId: '5943', description: 'اختبار آلي', location: 'ورشة',
    } }),
  });
  const cj = await created.json().catch(() => ({}));
  ok(created.status === 200 || created.status === 201, `إنشاء تصريح (${created.status})`);
  const newId = cj.permit && cj.permit.id;
  ok(!!newId && /^WP-\d{4}-\d+$/.test(newId), `المعرّف اتولّد صح: ${newId}`);

  const one = await get(hse, `/api/permits?q=${encodeURIComponent(newId)}&limit=5`);
  ok(!(one.body.permits || []).some(p => p.id === newId), 'التصريح اللي لسه مستني رئيس القسم مش بيوصل للسلامة');

  const patched = await fetch(`${BASE}/api/permits/${encodeURIComponent(newId)}`, {
    method: 'PATCH', headers: H(sup), body: JSON.stringify({ action: 'dept_approve' }),
  });
  const pjb = await patched.json().catch(() => ({}));
  ok(patched.status === 200, `موافقة رئيس القسم (${patched.status} ${pjb.error || ''})`);
  const after = await get(hse, `/api/permits?q=${encodeURIComponent(newId)}&limit=5`);
  const found = (after.body.permits || []).find(p => p.id === newId);
  ok(found && found.status === 'pending_hse', `الحالة اتحدّثت في الجدول: ${found && found.status}`);

  const fin = await fetch(`${BASE}/api/permits/${encodeURIComponent(newId)}`, {
    method: 'PATCH', headers: H(hse), body: JSON.stringify({ action: 'hse_approve' }),
  });
  ok(fin.status === 200, `الموافقة النهائية من السلامة (${fin.status})`);
  const fin2 = await get(hse, `/api/permits?q=${encodeURIComponent(newId)}&limit=5`);
  const f2 = (fin2.body.permits || []).find(p => p.id === newId);
  ok(f2 && f2.status === 'approved', `الحالة النهائية: ${f2 && f2.status}`);

  const snap = await fetch(BASE + '/api/admin/backup/snapshot-now', { method: 'POST', headers: H(sup), body: '{}' });
  const sj = await snap.json().catch(() => ({}));
  ok(snap.status === 200 && sj.counts && sj.counts.permits > 100, `النسخة الاحتياطية فيها التصاريح: ${sj.counts && sj.counts.permits}`);
  const ver = await fetch(BASE + '/api/admin/backup/verify-snapshot', { method: 'POST', headers: H(sup), body: '{}' });
  const vj = await ver.json();
  ok(vj.ok === true && vj.counts.permits > 100, `اختبار الاسترجاع شايف التصاريح: ${vj.counts && vj.counts.permits}`);

  ok(true, '—');

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
