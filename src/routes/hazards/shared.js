'use strict';

const { LEGACY_DEPARTMENT_ALIASES } = require('../../constants');
const { getRoleKey } = require('../../utils/roles');

const ADMIN_ROLES = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin'];
const ALERT_ROLES = ['super_admin', 'hse_admin'];
const HSE_ROLES = ['super_admin', 'hse_admin'];
const MANUAL_STATUSES = ['open', 'notified', 'seen', 'in_progress', 'assigned_to_maintenance', 'resolved', 'closed', 'completed'];
const UNEXPECTED_ERROR = { error: 'حدث خطأ غير متوقع أثناء المعالجة، حاول مرة أخرى' };

const respond = (res, result) => res.status(result ? result.status : 500).json(result ? result.body : UNEXPECTED_ERROR);

/** Department heads see their own department (including its pre-split legacy name); maintenance also sees work routed to it. */
function visibleTo(user, hazard) {
  if (!['dept_admin', 'maint_admin'].includes(user.role) || !user.department) return true;
  const names = [user.department, ...(LEGACY_DEPARTMENT_ALIASES[user.department] || [])];
  if (names.includes(hazard.department)) return true;
  return user.role === 'maint_admin' && hazard.assignedToMaintenance === user.department;
}

const reporterCode = (h) => h.empCode || h.reporterId || '';

/** Reports this user moved to their trash (or deleted for good) stay out of their lists. */
function hiddenFor(user, h) {
  const roleKey = getRoleKey(user.role);
  if (h.permanentlyDeletedBy && h.permanentlyDeletedBy[roleKey] === true) return true;
  if (user.role === 'maint_admin') return Boolean(h.deletedByMaintenance || h.deleted);
  return Boolean((h.deletedBy && h.deletedBy[roleKey] === true) || h.deleted === true);
}

// Still where the reporter left it: nobody routed it to maintenance, started a repair or closed it.
const awaitingAction = (h) => !h.status || h.status === 'open';

module.exports = {
  ADMIN_ROLES,
  ALERT_ROLES,
  awaitingAction,
  hiddenFor,
  HSE_ROLES,
  MANUAL_STATUSES,
  reporterCode,
  respond,
  visibleTo,
};
