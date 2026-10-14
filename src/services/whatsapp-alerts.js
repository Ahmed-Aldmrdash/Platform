'use strict';

const whatsapp = require('./whatsapp');
const { readUsers, readEmployees } = require('../data/stores');
const { normalizeEmpCode } = require('../utils/validation');

// Best effort only: a failed WhatsApp message is logged and never blocks the action.

function notifyAdminsWhatsAppNewHazard(hazard) {
  if (!whatsapp.isConfigured()) return;
  try {
    const recipients = readUsers().filter((u) => {
      if (!u.phone || u.whatsappOptIn === false) return false;
      if (['super_admin', 'hse_admin'].includes(u.role)) return true;
      return u.role === 'dept_admin' && u.department && u.department === hazard.department;
    });
    const body = `🚨 بلاغ خطورة جديد (${hazard.id})\nالقسم: ${hazard.department || '—'}\nالوصف: ${(hazard.description || '').slice(0, 200)}`;
    recipients.forEach((u) => {
      whatsapp.sendInteractiveButtons(u.phone, body, [
        { id: `hzact_accept_${hazard.id}`, title: 'قبول ومتابعة ✅' },
        { id: `hzact_reject_${hazard.id}`, title: 'رفض ❌' },
      ]).catch((err) => console.error('[whatsapp] new-hazard alert failed:', err.message));
    });
  } catch (err) {
    console.error('[whatsapp] new-hazard alert error:', err.message);
  }
}

const PERMIT_STATUS_LABELS = {
  approved: 'تمت الموافقة النهائية ✅',
  pending_hse: 'وافق رئيس القسم، بانتظار اعتماد السلامة ⏳',
  pending_dept: 'قيد الانتظار عند رئيس القسم ⏳',
};

function notifyWorkerWhatsAppPermitStatus(permit) {
  if (!whatsapp.isConfigured() || !permit.employeeId) return;
  try {
    const emp = readEmployees().find((e) => normalizeEmpCode(e.code || e.empCode) === normalizeEmpCode(permit.employeeId));
    if (!emp || !emp.phone) return;
    const s = String(permit.status || '');
    let label = PERMIT_STATUS_LABELS[s] || s;
    if (s === 'rejected' || s.startsWith('rejected_')) label = 'مرفوض ❌';
    else if (s.startsWith('closed_')) label = 'مغلق 🔒';
    whatsapp.sendText(emp.phone, `تحديث تصريح العمل ${permit.id}\nالحالة الجديدة: ${label}`)
      .catch((err) => console.error('[whatsapp] permit update failed:', err.message));
  } catch (err) {
    console.error('[whatsapp] permit update error:', err.message);
  }
}

module.exports = { notifyAdminsWhatsAppNewHazard, notifyWorkerWhatsAppPermitStatus };
