'use strict';

const crypto = require('crypto');
const { readAuditLog, writeAuditLog } = require('../data/stores');

/**
 * Appends an entry to the append-only audit trail (who approved/rejected/
 * closed what, and the status before and after). Call it inside the same
 * enqueueWrite job as the change it records. Never throws.
 */
function logAuditEvent({ entityType, entityId, action, actor, previousStatus, newStatus, note }) {
  try {
    const log = readAuditLog();
    log.push({
      id: 'AUD-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'),
      entityType,
      entityId: String(entityId),
      action,
      actorId: (actor && (actor.id || actor.username)) || 'unknown',
      actorUsername: (actor && actor.username) || '',
      actorRole: (actor && actor.role) || '',
      actorName: (actor && (actor.name || actor.fullName)) || '',
      department: (actor && actor.department) || '',
      previousStatus: previousStatus || null,
      newStatus: newStatus || null,
      note: note || '',
      timestamp: new Date().toISOString(),
    });
    writeAuditLog(log);
  } catch (err) {
    console.error('[audit-log] failed to record event:', err);
  }
}

module.exports = { logAuditEvent };
