const BASE = process.env.HSE_TEST_BASE || 'http://localhost:3300';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

(async () => {
  const login = async (u, p, c) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, empCode: c }) });
    const j = await r.json();
    if (!j.token) throw new Error(`login ${u}: ${JSON.stringify(j).slice(0, 150)}`);
    return j.token;
  };
  const hse = await login('qa_hse', 'TestOnly!2026', '271');
  const H = { Authorization: 'Bearer ' + hse, 'Content-Type': 'application/json' };

  const s = await (await fetch(BASE + '/api/hazards/alert-settings', { headers: H })).json();
  ok(s.requireAfterPhoto === true, 'طلب صورة بعد الإصلاح مفعّل افتراضيًا');

  const mk = async () => {
    const r = await fetch(BASE + '/api/hazards', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        reporterName: 'اختبار صورة', empCode: '5943', department: 'الصيانة الميكانيكية', area: 'ورشة',
        description: 'اختبار صورة بعد الإصلاح', potentialInjury: 'جرح', proposedSolution: 'تأمين',
        likelihood: 2, severity: 'B', riskLevel: 'M', date: new Date().toISOString().slice(0, 10),
      }),
    });
    return (await r.json()).hazard;
  };
  const patch = (id, body) => fetch(`${BASE}/api/hazards/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });

  const h1 = await mk();
  const r1 = await patch(h1.id, { action: 'resolve_maintenance', maintenanceAction: 'اتصلّح', maintenanceTeamNames: 'فريق أ' });
  const j1 = await r1.json().catch(() => ({}));
  ok(r1.status === 400 && j1.needAfterPhoto === true, `إغلاق من غير صورة اترفض (${r1.status}: ${j1.error || ''})`);

  const r2 = await patch(h1.id, { action: 'resolve_maintenance', maintenanceAction: 'اتصلّح', maintenanceTeamNames: 'فريق أ', afterPhoto: JPEG });
  const j2 = await r2.json().catch(() => ({}));
  ok(r2.status === 200 && j2.success, `إغلاق بصورة نجح (${r2.status})`);
  ok(j2.hazard && /^\/uploads\/hazards\/HZFIX-/.test(j2.hazard.afterPhotoUrl || ''), `الصورة اتحفظت: ${j2.hazard && j2.hazard.afterPhotoUrl}`);
  ok(j2.hazard && j2.hazard.status === 'resolved', `حالة البلاغ بقت resolved`);

  if (j2.hazard && j2.hazard.afterPhotoUrl) {
    const img = await fetch(BASE + j2.hazard.afterPhotoUrl);
    const buf = Buffer.from(await img.arrayBuffer());
    ok(img.status === 200 && buf[0] === 0xFF && buf[1] === 0xD8, `الصورة بترجع من السيرفر (${img.status}, ${buf.length} بايت, JPEG صحيح)`);
  }

  const pr = await fetch(`${BASE}/print/hazard/${j2.hazard.id}`, { headers: { Authorization: 'Bearer ' + hse } });
  const html = await pr.text();
  ok(pr.status === 200 && html.includes('صورة بعد الإصلاح') && html.includes(j2.hazard.afterPhotoUrl), 'صورة بعد الإصلاح ظاهرة في الطباعة');

  const h2 = await mk();
  const fake = 'data:image/jpeg;base64,' + Buffer.from('<?php echo 1; ?>').toString('base64');
  const r5 = await patch(h2.id, { action: 'resolve_maintenance', maintenanceAction: 'x', maintenanceTeamNames: 'y', afterPhoto: fake });
  const j5 = await r5.json().catch(() => ({}));
  ok(r5.status === 400 && j5.needAfterPhoto, `ملف مش صورة اترفض والبلاغ مااتقفلش (${r5.status})`);

  await fetch(BASE + '/api/hazards/alert-settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ requireAfterPhoto: false, highRiskEnabled: false, recipients: s.recipients }),
  });
  const r6 = await patch(h2.id, { action: 'resolve_maintenance', maintenanceAction: 'x', maintenanceTeamNames: 'y' });
  ok(r6.status === 200, `بعد إطفاء الإعداد: الإغلاق من غير صورة بيعدّي (${r6.status})`);
  await fetch(BASE + '/api/hazards/alert-settings', {
    method: 'PUT', headers: H,
    body: JSON.stringify({ requireAfterPhoto: true, highRiskEnabled: true, overdueEnabled: true, overdueHours: 48, recipients: s.recipients }),
  });

  const h3 = await mk();
  const r7 = await patch(h3.id, { status: 'resolved', actionTaken: 'اتقفل' });
  const j7 = await r7.json().catch(() => ({}));
  ok(r7.status === 400 && j7.needAfterPhoto, `الإغلاق المباشر بالحالة كمان بيطلب صورة (${r7.status})`);
  const r7b = await patch(h3.id, { status: 'resolved', actionTaken: 'اتقفل', afterPhoto: JPEG });
  ok(r7b.status === 200, `الإغلاق المباشر بصورة نجح (${r7b.status})`);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
