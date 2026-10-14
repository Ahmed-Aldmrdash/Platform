'use strict';

const whatsapp = require('./whatsapp');
const { createNotification } = require('./notifications');
const { enqueueWrite } = require('../data/write-queue');
const { readHazards, writeHazards, readTrainings, writeTrainings, readEmployees, readUsers } = require('../data/stores');
const { normalizeEmpCode } = require('../utils/validation');

const HOUR = 60 * 60 * 1000;
const STALE_HAZARD_MS = 48 * HOUR;
const EXPIRY_WINDOW_MS = 7 * 24 * HOUR;

// Each reminder fires once per record; the record is flagged afterwards.

function remindStaleHazards(now) {
  const hazards = readHazards();
  let changed = false;
  for (const h of hazards) {
    if (h.deletedAt || h.whatsappStaleAlertSent) continue;
    const isOpen = !h.status || h.status === 'مفتوح' || h.status === 'open';
    const submitted = new Date(h.submittedAt || h.createdAt || 0).getTime();
    if (!isOpen || !submitted || now - submitted <= STALE_HAZARD_MS) continue;

    h.whatsappStaleAlertSent = true;
    changed = true;
    const message = `البلاغ ${h.id} (${h.department || '—'}) لسه مفتوح من غير رد من أكتر من 48 ساعة.`;
    for (const role of ['hse_admin', 'super_admin']) {
      createNotification({ targetRole: role, type: 'hazard', title: '⏰ بلاغ خطورة متأخر', message, link: 'tabSupHazard' });
    }
    if (whatsapp.isConfigured()) {
      readUsers()
        .filter((u) => u.phone && ['super_admin', 'hse_admin'].includes(u.role))
        .forEach((u) => whatsapp.sendText(u.phone, `⏰ تذكير: ${message}`).catch(() => {}));
    }
  }
  if (changed) writeHazards(hazards);
}

function remindExpiringCertificates(now) {
  const trainings = readTrainings();
  const employees = readEmployees();
  let changed = false;
  for (const t of trainings) {
    if (t.deletedAt || t.whatsappExpiryAlertSent || !t.expiresAt) continue;
    const exp = new Date(t.expiresAt).getTime();
    if (!exp || exp <= now || exp > now + EXPIRY_WINDOW_MS) continue;

    t.whatsappExpiryAlertSent = true;
    changed = true;
    const label = t.title || t.topic || 'تدريب';
    for (const a of t.attendees || []) {
      const code = a.empCode || a.code;
      if (!code) continue;
      createNotification({
        targetEmpCode: code,
        type: 'training',
        title: '⏰ شهادة قريبة الانتهاء',
        message: `شهادة "${label}" هتنتهي خلال أيام قليلة.`,
        link: 'tabTrainingWorker',
      });
      const emp = employees.find((e) => normalizeEmpCode(e.code || e.empCode) === normalizeEmpCode(code));
      if (emp && emp.phone && whatsapp.isConfigured()) {
        whatsapp.sendText(emp.phone, `⏰ تذكير: شهادة "${label}" هتنتهي خلال أيام قليلة.`).catch(() => {});
      }
    }
  }
  if (changed) writeTrainings(trainings);
}

const preTrainingNotified = new Set();

/** Workers get a heads-up ten minutes before a training session starts (once per session). */
function remindUpcomingTrainings() {
  try {
    const trainings = readTrainings();
    const now = new Date();

    trainings.forEach(trn => {
      if (trn.status === 'active' || trn.status === 'scheduled' || !trn.status) {
        const [hours, minutes] = (trn.startTime || '00:00').split(':');
        const sessionStart = new Date(trn.date);
        sessionStart.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

        const diffMs = sessionStart - now;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins > 0 && diffMins <= 10 && !preTrainingNotified.has(trn.id)) {
          preTrainingNotified.add(trn.id);
          createNotification({
            targetRole: 'worker',
            targetGroup: trn.targetGroup,
            type: 'training',
            title: '⏰ تذكير: بدء محاضرة التدريب',
            message: `محاضرة ${trn.title} ستبدأ خلال 10 دقائق في ${trn.location || 'الموقع المحدد'}. يرجى التوجه وتجهيز الـ PIN.`,
            link: 'tabTrainingWorker'
          });
        }
      }
    });
  } catch(e) {
    console.error('[reminders] upcoming trainings:', e.message);
  }
}

function runReminders() {
  return enqueueWrite(async () => {
    const now = Date.now();
    try {
      remindStaleHazards(now);
      remindExpiringCertificates(now);
    } catch (err) {
      console.error('[reminders]', err.message);
    }
  });
}

function startReminders() {
  setInterval(remindUpcomingTrainings, 60 * 1000).unref();
  setTimeout(() => setInterval(runReminders, HOUR).unref(), 2 * 60 * 1000).unref();
}

module.exports = { startReminders, runReminders };
