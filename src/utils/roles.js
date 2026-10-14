'use strict';

const { MAINTENANCE_DEPARTMENTS } = require('../constants');

/** Which slot of a record's per-role `deletedBy` flags belongs to this role. */
function getRoleKey(role) {
  if (role === 'dept_admin' || role === 'area_admin' || role === 'maint_admin') return 'areaAdmin';
  if (role === 'hse_admin' || role === 'safety_admin') return 'safetyAdmin';
  if (role === 'super_admin') return 'superAdmin';
  return 'worker';
}

/**
 * Older accounts were all created as dept_admin; the HSE and maintenance
 * departments later got their own roles. Applied to every issued/verified token.
 */
function normalizeSessionRole(session) {
  if (session.role === 'dept_admin') {
    const dept = session.department || '';
    if (dept.toUpperCase() === 'HSE') {
      session.role = 'hse_admin';
      session.department = '';
    } else if (MAINTENANCE_DEPARTMENTS.includes(dept)) {
      session.role = 'maint_admin';
    }
  }
  if (session.username === 'hse_admin') session.role = 'hse_admin';
  return session;
}

module.exports = { getRoleKey, normalizeSessionRole };
