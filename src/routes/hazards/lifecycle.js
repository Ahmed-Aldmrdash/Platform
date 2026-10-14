'use strict';

// Soft delete, restore and permanent delete.

const express = require('express');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { enqueueWrite } = require('../../data/write-queue');
const { readHazards, writeHazards } = require('../../data/stores');
const { emptyDeleteFlags } = require('../../constants');
const { getRoleKey } = require('../../utils/roles');
const { sanitizeStr } = require('../../utils/validation');
const { ADMIN_ROLES, respond, visibleTo } = require('./shared');

const router = express.Router();

router.delete('/api/hazards/:id', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  const reason = req.body && req.body.reason;
  let result;
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const h = hazards.find((x) => x.id === req.params.id);
    if (!h) {
      result = { status: 404, body: { error: 'البلاغ غير موجود' } };
      return;
    }
    if (req.user.role === 'dept_admin' && !visibleTo(req.user, h)) {
      result = { status: 403, body: { error: 'لا تملك صلاحية حذف هذا البلاغ' } };
      return;
    }

    const softDelete = () => {
      h.deletedBy = h.deletedBy && typeof h.deletedBy === 'object' ? h.deletedBy : emptyDeleteFlags();
      h.deletedBy[getRoleKey(req.user.role)] = true;
      h.lastDeletedByUsername = req.user.username || 'Admin';
    };

    if (req.user.role === 'maint_admin') {
      const userDept = String(req.user.department || '').trim().toLowerCase();
      const hazardDept = String(h.department || '').trim().toLowerCase();
      const assignedDept = String(h.assignedToMaintenance || '').trim().toLowerCase();
      if (hazardDept && hazardDept === userDept) {
        softDelete();
      } else {
        // A repair ticket from another department: deleting it bounces it back to HSE.
        if (assignedDept !== userDept && h.status !== 'rejected_by_maintenance') {
          result = { status: 403, body: { error: 'لا تملك صلاحية حذف بلاغ غير موجه لقسمك' } };
          return;
        }
        h.deletedByMaintenance = true;
        h.maintenanceDeletedBy = sanitizeStr(req.user.name || req.user.username, 100);
        h.maintenanceDeletedDept = req.user.department;
        h.status = 'rejected_by_maintenance';
        h.maintRejectReason = sanitizeStr(reason || `تم حذف/رفض البلاغ من قسم الصيانة ${req.user.department}`, 1000);
        h.maintRejectedBy = h.maintenanceDeletedBy;
        h.maintRejectedAt = new Date().toISOString();
      }
    } else {
      softDelete();
    }
    writeHazards(hazards);
    result = { status: 200, body: { success: true } };
  });
  respond(res, result);
});

router.post('/api/hazards/:id/restore', authenticateToken, requireRole(...ADMIN_ROLES), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const h = hazards.find((x) => x.id === req.params.id);
    if (!h) {
      result = { status: 404, body: { error: 'البلاغ غير موجود' } };
      return;
    }
    if (req.user.role === 'dept_admin' && !visibleTo(req.user, h)) {
      result = { status: 403, body: { error: 'لا تملك صلاحية استعادة هذا البلاغ' } };
      return;
    }
    const restoreForRole = () => {
      const roleKey = getRoleKey(req.user.role);
      if (h.deletedBy && typeof h.deletedBy === 'object') h.deletedBy[roleKey] = false;
      h.permanentlyDeletedBy = h.permanentlyDeletedBy || emptyDeleteFlags();
      h.permanentlyDeletedBy[roleKey] = false;
      h.deleted = false;
    };

    if (req.user.role === 'maint_admin') {
      const userDept = String(req.user.department || '').trim().toLowerCase();
      const hazardDept = String(h.department || '').trim().toLowerCase();
      const assignedDept = String(h.assignedToMaintenance || '').trim().toLowerCase();
      if (hazardDept && hazardDept === userDept && !h.deletedByMaintenance) {
        restoreForRole();
      } else {
        if (assignedDept !== userDept && h.maintenanceDeletedDept !== req.user.department) {
          result = { status: 403, body: { error: 'لا تملك صلاحية استعادة هذا البلاغ' } };
          return;
        }
        h.deletedByMaintenance = false;
        h.status = 'assigned_to_maintenance';
        for (const key of ['maintenanceDeletedBy', 'maintenanceDeletedDept', 'maintRejectReason', 'maintRejectedBy', 'maintRejectedAt']) delete h[key];
      }
    } else {
      restoreForRole();
    }
    writeHazards(hazards);
    result = { status: 200, body: { success: true } };
  });
  respond(res, result);
});

// Removed from the table only after every role has permanently deleted it.
router.delete('/api/hazards/:id/permanent', authenticateToken, requireRole('super_admin', 'hse_admin', 'maint_admin'), async (req, res) => {
  let result;
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const idx = hazards.findIndex((x) => x.id === req.params.id);
    if (idx === -1) {
      result = { status: 404, body: { error: 'البلاغ غير موجود' } };
      return;
    }
    const h = hazards[idx];
    if (req.user.role === 'maint_admin') {
      if (h.maintenanceDeletedDept !== req.user.department) {
        result = { status: 403, body: { error: 'لا تملك صلاحية حذف هذا البلاغ نهائياً' } };
        return;
      }
      h.deletedByMaintenance = false;
      delete h.maintenanceDeletedBy;
      delete h.maintenanceDeletedDept;
    } else {
      const roleKey = getRoleKey(req.user.role);
      if (h.deletedBy && typeof h.deletedBy === 'object' && !h.deletedBy[roleKey] && !h.deleted) {
        result = { status: 400, body: { error: 'البلاغ ليس في سلة المحذوفات الخاصة بك' } };
        return;
      }
      h.permanentlyDeletedBy = h.permanentlyDeletedBy || emptyDeleteFlags();
      h.permanentlyDeletedBy[roleKey] = true;
      const perm = h.permanentlyDeletedBy;
      if (perm.areaAdmin && perm.safetyAdmin && perm.superAdmin && perm.worker) hazards.splice(idx, 1);
    }
    writeHazards(hazards);
    result = { status: 200, body: { success: true } };
  });
  respond(res, result);
});

module.exports = router;
