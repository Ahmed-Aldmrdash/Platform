'use strict';

const { normalizeEmpCode } = require('../../utils/validation');

const PIN_ROLES = ['super_admin', 'hse_admin'];
const MAX_RECORDING_UPLOAD_BYTES = 1536 * 1024 * 1024;
const DEFAULT_REVIEW_WINDOW_DAYS = 30;

/** Whether a session targets this employee (everyone, a department, or a list of codes). */
function trainingTargetsEmployee(training, empCode, employees) {
  const mode = training.targetMode || 'all';
  if (mode === 'all') return true;
  const nCode = normalizeEmpCode(empCode);
  if (mode === 'workers') {
    return (training.targetEmpCodes || []).map(normalizeEmpCode).includes(nCode);
  }
  if (mode === 'department') {
    const emp = (employees || []).find(e => normalizeEmpCode(e.code || e.empCode || e.id) === nCode);
    const myDept = emp ? String(emp.department || '').trim().toLowerCase() : '';
    return !!myDept && myDept === String(training.targetDept || '').trim().toLowerCase();
  }
  return true;
}

/** Quizzes and recordings stay available for review for a limited time after the session closes. */
function trainingReviewExpired(trn) {
  if (!trn || !trn.closedAt) return false;
  const days = Number.isFinite(trn.reviewWindowDays) ? trn.reviewWindowDays : DEFAULT_REVIEW_WINDOW_DAYS;
  if (!days || days <= 0) return false;
  const deadline = new Date(trn.closedAt).getTime() + days * 24 * 60 * 60 * 1000;
  return Date.now() > deadline;
}

function effectiveAllowedAttempts(quiz, empCode) {
  const base = (quiz && quiz.allowedAttempts) || 1;
  const extra = (quiz && quiz.perWorkerExtraAttempts && quiz.perWorkerExtraAttempts[normalizeEmpCode(empCode)]) || 0;
  return base + extra;
}

module.exports = { PIN_ROLES, MAX_RECORDING_UPLOAD_BYTES, DEFAULT_REVIEW_WINDOW_DAYS, trainingTargetsEmployee, trainingReviewExpired, effectiveAllowedAttempts };
