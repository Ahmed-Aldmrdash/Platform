'use strict';

const express = require('express');
const { vapidPublicKey } = require('../services/push');
const {
  readEmployees, readNotifications, readSubscriptions, writeNotifications, writeSubscriptions,
} = require('../data/stores');
const { enqueueWrite } = require('../data/write-queue');
const { authenticateSession, authenticateToken, requireRole } = require('../middleware/auth');
const { normalizeEmpCode } = require('../utils/validation');
const { ADMIN_TIER_ROLES, VIEWER_ROLES } = require('../constants');

const router = express.Router();

function getWorkerDepartment(empCode) {
  if (!empCode) return '';
  const emp = readEmployees().find(e => normalizeEmpCode(e.code || e.empCode || e.id) === normalizeEmpCode(empCode));
  return emp ? String(emp.department || '').trim() : '';
}

router.get('/api/notifications', authenticateSession, (req, res) => {
  const role = req.worker ? 'worker' : req.user.role;
  const empCode = req.worker ? req.worker.empCode : '';
  const department = req.worker ? getWorkerDepartment(empCode) : (req.user.department || '');
  if (VIEWER_ROLES.includes(role)) {
    return res.json({ notifications: [] });
  }
  const notifications = readNotifications();

  let userNotifs = notifications.filter(n => {
    if (n.targetRole === 'all') return true;
    if (role === 'super_admin') return true;
    if (n.targetEmpCode && empCode && normalizeEmpCode(n.targetEmpCode) === normalizeEmpCode(empCode)) return true;
    const roleMatches = n.targetRole && role && (
      n.targetRole === role ||
      (n.targetRole === 'admin' && ADMIN_TIER_ROLES.includes(role)) ||
      (n.targetRole === 'dept_admin' && role === 'maint_admin') ||
      (n.targetRole === 'maint_admin' && role === 'dept_admin')
    );
    if (roleMatches) {
      if (n.targetDept) return String(n.targetDept).trim().toLowerCase() === String(department).trim().toLowerCase();
      return true;
    }
    return false;
  });

  userNotifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ notifications: userNotifs });
});

function markNotificationsRead(req, id) {
  const identifier = req.worker ? req.worker.empCode : req.user.role;
  const role = req.worker ? 'worker' : req.user.role;
  const empCode = req.worker ? req.worker.empCode : '';
  const department = req.worker ? getWorkerDepartment(empCode) : (req.user.department || '');
  enqueueWrite(async () => {
    const notifications = readNotifications();
    let changed = false;
    notifications.forEach(n => {
      if (!(id === 'all' || n.id === id) || (n.readBy || []).includes(identifier)) return;
      let canRead = n.targetRole === 'all';
      if (n.targetEmpCode && empCode && normalizeEmpCode(n.targetEmpCode) === empCode) canRead = true;
      if (n.targetRole && role !== 'worker') {
        if (role === 'super_admin') canRead = true;
        if (n.targetRole === 'admin' && ADMIN_TIER_ROLES.includes(role)) canRead = true;
        const sameRole = n.targetRole === role
          || (n.targetRole === 'dept_admin' && role === 'maint_admin')
          || (n.targetRole === 'maint_admin' && role === 'dept_admin');
        if (sameRole && (!n.targetDept || String(n.targetDept).trim().toLowerCase() === String(department).trim().toLowerCase())) canRead = true;
      }
      if (n.targetRole === 'worker' && role === 'worker' && !n.targetEmpCode && !n.targetDept) canRead = true;
      if (n.targetRole === 'worker' && role === 'worker' && n.targetDept &&
          String(n.targetDept).trim().toLowerCase() === String(department).trim().toLowerCase()) canRead = true;
      if (canRead) {
        n.readBy = n.readBy || [];
        n.readBy.push(identifier);
        changed = true;
      }
    });
    if (changed) writeNotifications(notifications);
  });
}

router.post('/api/notifications/mark-read', authenticateSession, (req, res) => {
  markNotificationsRead(req, String((req.body || {}).id || ''));
  res.json({ success: true });
});

router.post('/api/notifications/read/:id', authenticateSession, (req, res) => {
  markNotificationsRead(req, String(req.params.id || ''));
  res.json({ success: true });
});

router.post('/api/notifications/read-all', authenticateSession, (req, res) => {
  markNotificationsRead(req, 'all');
  res.json({ success: true });
});

router.delete('/api/notifications/:id', authenticateToken, requireRole('super_admin', 'hse_admin'), (req, res) => {
  enqueueWrite(async () => {
    const notifications = readNotifications();
    const filtered = notifications.filter(n => n.id !== req.params.id);
    if (filtered.length !== notifications.length) {
      writeNotifications(filtered);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

router.get(['/api/vapid-publicKey', '/api/vapid-public-key'], (req, res) => {
  res.json({ publicKey: vapidPublicKey || '' });
});

// Only real browser push services; anything else would make the server send requests to arbitrary hosts.
const PUSH_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)(:\d+)?\//i;
const MAX_SUBSCRIPTIONS_PER_USER = 5;

router.post('/api/notifications/subscribe', authenticateSession, (req, res) => {
  const { subscription } = req.body || {};
  const role = req.worker ? 'worker' : req.user.role;
  const empCode = req.worker ? req.worker.empCode : '';
  if (VIEWER_ROLES.includes(role)) {
    return res.status(200).json({ success: true, skipped: true });
  }
  const endpoint = subscription && subscription.endpoint;
  if (!subscription || typeof endpoint !== 'string' || !PUSH_HOST_RE.test(endpoint) || endpoint.length > 1000) {
    return res.status(400).json({ error: 'Subscription object missing' });
  }

  enqueueWrite(async () => {
    let subscriptions = readSubscriptions();
    const existingIdx = subscriptions.findIndex(sub => sub.subscription.endpoint === subscription.endpoint);

    const subData = {
      subscription,
      role: role || null,
      empCode: empCode ? normalizeEmpCode(empCode) : null,
      updatedAt: new Date().toISOString()
    };

    if (existingIdx !== -1) {
      subscriptions[existingIdx] = subData;
    } else {
      subscriptions.push(subData);
      // Keep only the newest few subscriptions per person.
      const owner = (sub) => (subData.empCode ? sub.empCode === subData.empCode : sub.role === subData.role && !sub.empCode);
      const mine = subscriptions.filter(owner);
      if (mine.length > MAX_SUBSCRIPTIONS_PER_USER) {
        const drop = new Set(mine.slice(0, mine.length - MAX_SUBSCRIPTIONS_PER_USER));
        subscriptions = subscriptions.filter((sub) => !drop.has(sub));
      }
    }

    writeSubscriptions(subscriptions);
  });

  res.status(201).json({ success: true });
});

module.exports = router;
