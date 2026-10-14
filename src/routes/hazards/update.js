'use strict';

// Hazard workflow updates: review, routing to maintenance, repair with an "after" photo, closure.

const express = require('express');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { enqueueWrite } = require('../../data/write-queue');
const { readHazards, writeHazards } = require('../../data/stores');
const { createNotification } = require('../../services/notifications');
const { logAuditEvent } = require('../../services/audit-log');
const { saveHazardPhoto } = require('../../services/hazard-photos');
const { readHazardAlertSettings } = require('../../services/hazard-alert-mailer');
const { sanitizeStr } = require('../../utils/validation');
const { ADMIN_ROLES, HSE_ROLES, MANUAL_STATUSES, reporterCode, respond, visibleTo } = require('./shared');

const router = express.Router();

function requireAfterPhoto(h, req, updater, now) {
  const url = saveHazardPhoto(req.body && req.body.afterPhoto, 'HZFIX');
  if (url) {
    h.afterPhotoUrl = url;
    h.afterPhotoAt = now;
    h.afterPhotoBy = updater;
    return null;
  }
  if (!h.afterPhotoUrl && readHazardAlertSettings().requireAfterPhoto) {
    return { status: 400, body: { error: 'لازم ترفع صورة بعد الإصلاح قبل إغلاق البلاغ', needAfterPhoto: true } };
  }
  return null;
}

/**
 * Hazard workflow: open → (HSE) assigned_to_maintenance → (maintenance) in_progress → resolved.
 * HSE can reject a report; maintenance can bounce a report back as not theirs.
 */
router.patch('/api/hazards/:id', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  const body = req.body || {};
  const { action, targetMaintenance, assignNotes, maintenanceAction, maintenanceTeamNames, status, actionTaken } = body;
  const rejectReason = body.reason || body.rejectReason || body.rejectionReason;
  const role = req.user.role;

  let result;
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const h = hazards.find((x) => x.id === req.params.id);
    if (!h) {
      result = { status: 404, body: { error: 'البلاغ غير موجود' } };
      return;
    }
    const updater = sanitizeStr(req.user.name || req.user.username || 'المشرف', 100);
    const now = new Date().toISOString();
    const previousStatus = h.status;
    const assignedToMe = role === 'maint_admin' && h.assignedToMaintenance === req.user.department;
    const deny = (error) => { result = { status: 403, body: { error } }; };

    if (action === 'assign_maintenance') {
      if (!HSE_ROLES.includes(role)) return deny('فقط مشرف السلامة يمكنه التوجيه للصيانة');
      if (!targetMaintenance) {
        result = { status: 400, body: { error: 'قسم الصيانة المستهدف مطلوب' } };
        return;
      }
      h.assignedToMaintenance = sanitizeStr(targetMaintenance, 100);
      if (assignNotes) h.assignNotes = sanitizeStr(assignNotes, 500);
      h.forwardedByHseName = updater;
      h.forwardedByHseAt = now;
      h.treatmentStartedAt = h.treatmentStartedAt || now;
      h.assignedAt = h.assignedAt || now;
      h.status = 'assigned_to_maintenance';
      h.updatedBy = updater;
      delete h.maintRejectReason;
      delete h.hseRejectReason;
      createNotification({
        targetRole: 'maint_admin',
        targetDept: h.assignedToMaintenance,
        type: 'hazard',
        title: 'بلاغ خطورة جديد',
        message: `تم توجيه بلاغ خطورة (${h.id}) إلى قسمكم من قبل ${updater}.`,
        link: 'tabSupHazard',
      });
    } else if (action === 'start_maintenance') {
      if (!['maint_admin', ...HSE_ROLES].includes(role)) return deny('غير مصرح ببدء الإصلاح');
      if (role === 'maint_admin' && !assignedToMe) return deny('هذا البلاغ غير موجه لقسمكم');
      h.status = 'in_progress';
      h.startedAt = now;
      if (!h.treatmentStartedAt) h.treatmentStartedAt = now;
      h.startedByName = updater;
      h.startedBy = req.user.name || req.user.fullName || req.user.empCode;
      h.assignedTechName = h.startedBy;
      h.assignedTechCode = req.user.empCode;
      h.updatedBy = updater;
    } else if (action === 'reject_maintenance' || action === 'reject_maint') {
      if (role !== 'maint_admin') return deny('فقط فريق الصيانة يمكنه رفض الإصلاح');
      if (!assignedToMe) return deny('هذا البلاغ غير موجه لقسمكم');
      if (!rejectReason) {
        result = { status: 400, body: { error: 'سبب الرفض مطلوب' } };
        return;
      }
      Object.assign(h, {
        status: 'rejected_by_maintenance',
        maintRejectReason: sanitizeStr(rejectReason, 500),
        maintRejectedBy: updater,
        maintRejectedAt: now,
        rejectedByMaintName: updater,
        rejectedByMaintAt: now,
        rejectedAt: now,
        rejectedBy: updater,
        updatedBy: updater,
      });
      h.rejectionReason = h.maintRejectReason;
      createNotification({
        targetRole: 'hse_admin',
        type: 'hazard',
        title: 'رفض بلاغ من الصيانة',
        message: `تم رفض البلاغ (${h.id}) من قسم ${h.assignedToMaintenance} بحجة عدم الاختصاص.`,
        link: 'tabSupHazard',
      });
    } else if (action === 'reject_hse' || action === 'reject') {
      if (!HSE_ROLES.includes(role)) return deny('غير مصرح');
      if (!rejectReason) {
        result = { status: 400, body: { error: 'سبب الرفض مطلوب' } };
        return;
      }
      Object.assign(h, {
        status: 'rejected_by_hse',
        hseRejectReason: sanitizeStr(rejectReason, 500),
        hseRejectedBy: updater,
        hseRejectedAt: now,
        rejectedByHseName: updater,
        rejectedByHseAt: now,
        rejectedAt: now,
        rejectedBy: updater,
        updatedBy: updater,
      });
      h.rejectionReason = h.hseRejectReason;
      if (reporterCode(h)) {
        createNotification({
          targetEmpCode: reporterCode(h),
          type: 'hazard',
          title: 'تم رفض بلاغ الخطورة',
          message: `تم رفض البلاغ (${h.id}) من قبل المشرف: ${h.hseRejectReason}`,
          link: 'tabMyHazards',
        });
      }
    } else if (action === 'resolve_maintenance') {
      if (!['maint_admin', ...HSE_ROLES].includes(role)) return deny('غير مصرح بإغلاق البلاغ');
      if (role === 'maint_admin' && !assignedToMe) return deny('هذا البلاغ غير موجه لقسمكم');
      const photoError = requireAfterPhoto(h, req, updater, now);
      if (photoError) {
        result = photoError;
        return;
      }
      h.completedAt = now;
      if (!h.treatmentStartedAt) h.treatmentStartedAt = now;
      if (!h.startedAt) {
        h.startedAt = now;
        h.startedByName = updater;
      }
      h.status = 'resolved';
      h.resolvedBy = req.user.name || req.user.fullName || req.user.empCode;
      h.assignedTechName = h.resolvedBy;
      h.assignedTechCode = req.user.empCode;
      h.maintenanceAction = sanitizeStr(maintenanceAction || '', 1000);
      h.maintenanceTeamNames = sanitizeStr(maintenanceTeamNames || '', 300);
      h.resolvedByMaintenanceName = updater;
      h.resolvedAt = now;
      h.updatedBy = updater;
      if (!h.inProgressAt) {
        h.inProgressAt = h.startedAt || h.resolvedAt;
        h.inProgressBy = h.startedByName || h.resolvedByMaintenanceName;
      }
      if (reporterCode(h)) {
        createNotification({
          targetEmpCode: reporterCode(h),
          type: 'hazard',
          title: 'تم إصلاح الخطورة',
          message: `تم الانتهاء من إصلاح بلاغ الخطورة (${h.id}) الخاص بك بواسطة قسم الصيانة.`,
          link: 'tabMyHazards',
        });
      }
      createNotification({ targetRole: 'hse_admin', type: 'hazard', title: 'إصلاح خطورة من الصيانة', message: `تم إصلاح بلاغ الخطورة (${h.id}) من قبل الصيانة.`, link: 'tabSupHazard' });
      if (h.department) {
        createNotification({ targetDept: h.department, targetRole: 'dept_admin', type: 'hazard', title: 'إصلاح خطورة في قسمك', message: `تم إصلاح بلاغ الخطورة (${h.id}) في قسمك.`, link: 'tabSupHazard' });
      }
    } else if (status) {
      if (!MANUAL_STATUSES.includes(status)) {
        result = { status: 400, body: { error: 'حالة غير معروفة' } };
        return;
      }
      if (!visibleTo(req.user, h)) return deny('ليس لديك صلاحية لتعديل هذا البلاغ');
      const closing = ['resolved', 'closed', 'completed'].includes(status);
      if (closing) {
        const photoError = requireAfterPhoto(h, req, updater, now);
        if (photoError) {
          result = photoError;
          return;
        }
      }
      h.status = status;
      if (actionTaken !== undefined) h.actionTaken = sanitizeStr(actionTaken, 1000);
      h.updatedBy = updater;
      if (closing) {
        h.resolvedAt = h.resolvedAt || now;
        h.resolvedBy = h.resolvedBy || updater;
        if (!h.inProgressAt) {
          h.inProgressAt = h.resolvedAt;
          h.inProgressBy = h.resolvedBy;
        }
      }
    } else {
      result = { status: 400, body: { error: 'إجراء غير معروف' } };
      return;
    }

    logAuditEvent({
      entityType: 'hazard',
      entityId: h.id,
      action: action || `status:${status}`,
      actor: req.user,
      previousStatus,
      newStatus: h.status,
      note: rejectReason || assignNotes || '',
    });
    writeHazards(hazards);
    result = { status: 200, body: { success: true, hazard: h } };
  });
  respond(res, result);
});

module.exports = router;
