'use strict';

const { ADMIN_TIER_ROLES, VIEWER_ROLES } = require('../constants');
const { enqueueWrite } = require('../data/write-queue');
const { readNotifications, writeNotifications, readSubscriptions, writeSubscriptions, readEmployees } = require('../data/stores');
const { normalizeEmpCode, sanitizeStr } = require('../utils/validation');
const { sendPush } = require('./push');

const MAX_STORED_NOTIFICATIONS = 1000;

function pushUrlFor(n) {
  return '/?openTab=' + encodeURIComponent(n.link || '')
    + '&ntype=' + encodeURIComponent(n.type || '')
    + (n.targetId ? '&targetId=' + encodeURIComponent(n.targetId) : '')
    + '&nid=' + encodeURIComponent(n.id);
}

function roleMatches(targetRole, role) {
  if (!targetRole || !role) return false;
  if (targetRole === role) return true;
  if (targetRole === 'admin' && ADMIN_TIER_ROLES.includes(role)) return true;
  if (targetRole === 'dept_admin' && role === 'maint_admin') return true;
  if (targetRole === 'maint_admin' && role === 'dept_admin') return true;
  return false;
}

/**
 * Stores an in-app notification and sends a web push to every matching
 * subscription. Targeting: targetRole ('all', 'admin' or a role), targetEmpCode
 * (one person) and optionally targetDept to narrow a role-based notification
 * to one department. Read-only oversight accounts never get pushes.
 */
function createNotification({ targetRole, targetEmpCode, targetGroup, targetDept, type, title, message, link, targetId }) {
  return enqueueWrite(async () => {
    const notification = {
      id: `NT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      targetRole: targetRole || null,
      targetEmpCode: targetEmpCode ? normalizeEmpCode(targetEmpCode) : null,
      targetGroup: targetGroup || null,
      targetDept: targetDept || null,
      type: type || 'system',
      title: sanitizeStr(title, 200),
      message: sanitizeStr(message, 1000),
      link: link || '',
      targetId: targetId || null,
      readBy: [],
      createdAt: new Date().toISOString(),
    };

    const notifications = readNotifications();
    notifications.push(notification);
    if (notifications.length > MAX_STORED_NOTIFICATIONS) {
      notifications.splice(0, notifications.length - MAX_STORED_NOTIFICATIONS);
    }
    writeNotifications(notifications);

    const deptOf = notification.targetDept
      ? new Map(readEmployees().map((e) => [normalizeEmpCode(e.code || e.empCode || e.id), String(e.department || '').trim().toLowerCase()]))
      : null;
    const wantedDept = String(notification.targetDept || '').trim().toLowerCase();

    const shouldReceive = (sub) => {
      if (VIEWER_ROLES.includes(sub.role)) return false;
      if (notification.targetRole === 'all') return true;
      if (notification.targetEmpCode && sub.empCode && notification.targetEmpCode === normalizeEmpCode(sub.empCode)) return true;
      if (!roleMatches(notification.targetRole, sub.role)) return false;
      if (deptOf && !notification.targetEmpCode) return (deptOf.get(normalizeEmpCode(sub.empCode || '')) || '') === wantedDept;
      return true;
    };

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.message,
      link: pushUrlFor(notification),
      targetId: notification.targetId,
      type: notification.type,
    });

    const targets = readSubscriptions().filter(shouldReceive);
    if (targets.length) deliverPush(targets, payload);
  });
}

// Runs outside the write queue so a slow push service never delays other writes.
function deliverPush(targets, payload) {
  const expired = new Set();
  Promise.all(targets.map((sub) =>
    sendPush(sub.subscription, payload).catch((err) => {
      if (err.statusCode === 410 || err.statusCode === 404) expired.add(sub.subscription && sub.subscription.endpoint);
      else console.error('[push] send failed:', err.statusCode || err.message);
    }))).then(() => {
    if (!expired.size) return;
    enqueueWrite(async () => {
      writeSubscriptions(readSubscriptions().filter((s) => !(s.subscription && expired.has(s.subscription.endpoint))));
    });
  });
}

const ATTENDANCE_NOTICE_MS = 5 * 60 * 1000;
const lastAttendanceNotice = new Map();

/**
 * Check-ins come in bursts at the start of a session; admins get one update
 * per session every few minutes instead of one notification per worker.
 */
function notifyAttendance(session, attendeeName, { type, link }) {
  const now = Date.now();
  if (now - (lastAttendanceNotice.get(session.id) || 0) < ATTENDANCE_NOTICE_MS) return;
  lastAttendanceNotice.set(session.id, now);
  const count = (session.attendees || []).length;
  createNotification({
    targetRole: 'admin',
    type,
    title: 'تسجيل حضور 👤',
    message: `${attendeeName} سجّل حضوره في "${session.title || 'الجلسة'}" — ${count} حاضر لحد دلوقتي`,
    link,
  });
}

module.exports = { createNotification, notifyAttendance };
