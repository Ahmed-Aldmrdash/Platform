'use strict';

const express = require('express');
const mailer = require('../services/mailer');
const hazardAlerts = require('../services/hazard-alerts');
const { authenticateSession, authenticateToken, requireRole } = require('../middleware/auth');
const { enqueueWrite } = require('../data/write-queue');
const { readEmployees, readPenalties, writePenalties } = require('../data/stores');
const { createNotification } = require('../services/notifications');
const { readHazardAlertSettings } = require('../services/hazard-alert-mailer');
const { parsePenaltiesWorkbook } = require('../importers/penalties-excel');
const { normalizeEmpCode, sanitizeStr, deptMatches } = require('../utils/validation');

const router = express.Router();

const REPEAT_PENALTY_THRESHOLD = 3;
const byNewest = (a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0);
const isDepartmentScoped = (user) => ['dept_admin', 'maint_admin'].includes(user.role) && Boolean(user.department);

/** Penalties keep the employee's details from when they were issued; show the current job title and department instead. */
function withLiveEmployeeData(penalties) {
  const byCode = new Map();
  const byName = new Map();
  for (const e of readEmployees()) {
    const code = normalizeEmpCode(e.empCode);
    if (code) byCode.set(code, e);
    const name = String(e.name || '').trim();
    if (name) byName.set(name, e);
  }
  return penalties.map((p) => {
    const emp = byCode.get(normalizeEmpCode(p.empCode)) || byName.get(String(p.empName || '').trim());
    return emp ? { ...p, jobTitle: emp.jobTitle || p.jobTitle || '', department: emp.department || p.department || '' } : p;
  });
}

router.get('/api/penalties', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin', 'maint_admin'), (req, res) => {
  let penalties = readPenalties();
  if (isDepartmentScoped(req.user)) penalties = penalties.filter((p) => deptMatches(p.department, req.user.department));
  res.json({ penalties: withLiveEmployeeData(penalties.slice().sort(byNewest)) });
});

router.get('/api/my-penalties/:empCode', authenticateSession, (req, res) => {
  const code = req.worker ? req.worker.empCode : normalizeEmpCode(req.params.empCode || '');
  if (!code) return res.status(400).json({ error: 'الكود الوظيفي مطلوب' });
  if (!req.worker && isDepartmentScoped(req.user)) {
    const emp = readEmployees().find((e) => normalizeEmpCode(e.empCode) === code);
    if (!emp || !deptMatches(emp.department, req.user.department)) return res.status(403).json({ error: 'الموظف ده مش في قسمك' });
  }
  const penalties = readPenalties()
    .filter((p) => normalizeEmpCode(p.empCode) === code && p.status !== 'deleted')
    .sort(byNewest);
  res.json({ penalties: withLiveEmployeeData(penalties) });
});

function countActivePenaltiesThisYear(empCode) {
  const code = normalizeEmpCode(empCode);
  if (!code) return 0;
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  return readPenalties().filter((p) => {
    if (!p || p.status === 'deleted' || p.status === 'cancelled') return false;
    if (normalizeEmpCode(p.empCode || p.code) !== code) return false;
    const t = new Date(p.date || p.createdAt || 0).getTime();
    return !isNaN(t) && t >= yearStart;
  }).length;
}

/** Repeated penalties go to the same HSE recipients as high-risk hazard alerts. */
function queueRepeatPenaltyEmail(penalty, count) {
  if (!mailer.isConfigured()) return;
  const to = hazardAlerts.activeEmails(readHazardAlertSettings());
  if (!to.length) return;
  setImmediate(() => {
    mailer.sendMail({
      to: to.join(', '),
      subject: `⚠️ تكرار جزاءات (${count}) — ${penalty.empName || penalty.empCode}`,
      text: [
        `الموظف ده وصل ${count} جزاءات في سنة ${new Date().getFullYear()} — التكرار ده محتاج متابعة مش جزاء جديد بس.`,
        '',
        `الاسم: ${penalty.empName || '—'}`,
        `الكود: ${penalty.empCode}`,
        `القسم: ${penalty.department || '—'}`,
        `المسمى الوظيفي: ${penalty.jobTitle || '—'}`,
        '',
        `آخر جزاء (${penalty.date}): ${penalty.reason}`,
        `مسجّل بواسطة: ${penalty.issuedBy || '—'}`,
        '',
        'المقترح: مراجعة سبب التكرار — تدريب إضافي، تغيير مكان العمل، أو مقابلة مع المسئول المباشر.',
      ].join('\n'),
    }).catch((err) => console.error('[penalty-alert] send failed:', err && err.message));
  });
}

router.post('/api/penalties', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const { empCode, date, reason, issuedBy } = req.body || {};
  if (!empCode || !reason) return res.status(400).json({ error: 'الكود الوظيفي وسبب الجزاء مطلوبان' });
  const code = normalizeEmpCode(empCode);
  const employee = readEmployees().find((e) => normalizeEmpCode(e.empCode) === code);
  if (!employee) return res.status(404).json({ error: `الموظف غير موجود بكود ${sanitizeStr(empCode, 20)}` });

  const actor = sanitizeStr(req.user.name || req.user.username || 'المشرف', 150);
  const penalty = {
    id: `PEN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    empCode: normalizeEmpCode(employee.empCode),
    empName: employee.name || '',
    department: employee.department || '',
    jobTitle: employee.jobTitle || '',
    date: sanitizeStr(date || new Date().toISOString().slice(0, 10), 30),
    reason: sanitizeStr(reason, 1000),
    issuedBy: sanitizeStr(issuedBy || actor, 150),
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: actor,
  };
  await enqueueWrite(async () => {
    const penalties = readPenalties();
    penalties.push(penalty);
    writePenalties(penalties);
  });

  createNotification({
    targetEmpCode: penalty.empCode,
    type: 'penalty',
    title: 'جزاء جديد',
    message: `تم تسجيل جزاء عليك بتاريخ ${penalty.date}: ${penalty.reason}`,
    link: 'penaltiesWorker',
  });
  const repeat = countActivePenaltiesThisYear(penalty.empCode);
  const repeatAlert = repeat >= REPEAT_PENALTY_THRESHOLD;
  if (repeatAlert) {
    createNotification({
      targetRole: 'hse_admin',
      type: 'penalty',
      title: `تكرار جزاءات ⚠️ (${repeat})`,
      message: `${penalty.empName || penalty.empCode} (${penalty.empCode} — ${penalty.department || 'غير محدد'}) وصل ${repeat} جزاءات السنة دي. محتاج متابعة.`,
      link: 'tabPenaltiesAdmin',
    });
    queueRepeatPenaltyEmail(penalty, repeat);
  }
  res.json({ success: true, penalty, repeatCount: repeat, repeatAlert });
});

router.post('/api/penalties/upload-excel', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  try {
    const { base64Data } = req.body || {};
    if (!base64Data) return res.status(400).json({ success: false, message: 'لا توجد بيانات ملف' });
    const { penalties: imported, skipped } = await parsePenaltiesWorkbook(
      Buffer.from(base64Data, 'base64'),
      readEmployees(),
      req.user.name || req.user.username,
    );
    await enqueueWrite(async () => writePenalties([...readPenalties(), ...imported]));
    res.json({ success: true, count: imported.length, skipped });
  } catch (err) {
    console.error('[penalties] Excel import failed:', err);
    res.status(500).json({ success: false, message: 'فشل استيراد الملف' });
  }
});

router.delete('/api/penalties/:id', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  const reason = req.body && req.body.reason;
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'سبب حذف الجزاء مطلوب' });

  let result;
  await enqueueWrite(async () => {
    const penalties = readPenalties();
    const penalty = penalties.find((p) => p.id === req.params.id);
    if (!penalty) {
      result = { status: 404, body: { error: 'الجزاء غير موجود' } };
      return;
    }
    Object.assign(penalty, {
      status: 'deleted',
      deleteReason: sanitizeStr(reason, 1000),
      deletedBy: sanitizeStr(req.user.name || req.user.username || 'المشرف', 150),
      deletedAt: new Date().toISOString(),
    });
    writePenalties(penalties);
    result = { status: 200, body: { success: true } };
  });
  res.status(result ? result.status : 500).json(result ? result.body : { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' });
});

module.exports = router;
