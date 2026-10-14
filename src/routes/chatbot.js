'use strict';

const express = require('express');
const chatbot = require('../chatbot');
const chatbotFollowup = require('../chatbot/followup');
const { chatbotData } = require('../chatbot/data-source');
const { authenticateSession } = require('../middleware/auth');
const { chatbotLimiter } = require('../middleware/rate-limits');
const { normalizeEmpCode, sanitizeStr } = require('../utils/validation');

const router = express.Router();

/** The chatbot only ever answers about the session owner — identity comes from the token. */
function chatbotUserFromSession(req) {
  if (req.worker) return { role: 'worker', empCode: req.worker.empCode, name: req.worker.name, department: req.worker.department };
  const u = req.user || {};
  return { role: u.role, username: u.username, name: u.fullName || u.name || '', empCode: u.empCode ? normalizeEmpCode(u.empCode) : '', department: u.department || '' };
}

const CHATBOT_TOPICS = ['hazards', 'permits', 'trainings', 'drills', 'penalties', 'employees', 'compliance', 'inspections'];
function chatbotContextFromBody(body) {
  const c = body && body.context;
  if (!c || typeof c !== 'object') return null;
  const lastEntity = CHATBOT_TOPICS.includes(c.lastEntity) ? c.lastEntity : null;
  const depts = Array.isArray(c.depts) ? c.depts.slice(0, 5).map(d => sanitizeStr(d, 60)).filter(Boolean) : [];
  const pending = chatbotFollowup.sanitizePending(c.pending);
  if (!lastEntity && !pending) return null;
  return { lastEntity, depts, pending };
}

// Whitelist of UI actions the chatbot may trigger; anything else is dropped.
const CHATBOT_ACTION_TABS = [
  'dashboard', 'worker', 'myhistory', 'hazardWorker', 'myhazards', 'trainingWorker',
  'drillWorker', 'penaltiesWorker', 'sup', 'supHazard', 'trainingAdmin', 'drillAdmin',
  'penaltiesAdmin', 'employees', 'inspections', 'users', 'auditlog', 'executive',
];
const CHATBOT_ACTION_PERMIT_TYPES = ['general', 'height', 'confined', 'excavation', 'lifting', 'hot', 'loto'];
const CHATBOT_FILL_LIMITS = {
  desc: 600, workers: 600, location: 60, equip: 120,
  dept: 80, area: 120, injury: 200, solution: 300,
  likelihood: 2, severity: 2,
};

function sanitizeChatbotAction(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.type !== 'navigate' && action.type !== 'fill') return null;
  if (!CHATBOT_ACTION_TABS.includes(action.tab)) return null;
  const out = { type: action.type, tab: action.tab };
  if (CHATBOT_ACTION_PERMIT_TYPES.includes(action.permitType)) out.permitType = action.permitType;
  if (action.fill && typeof action.fill === 'object') {
    const fill = {};
    for (const [key, limit] of Object.entries(CHATBOT_FILL_LIMITS)) {
      const val = sanitizeStr(action.fill[key] || '', limit);
      if (!val) continue;
      if (key === 'likelihood' && !['1', '2', '3', '4', '5'].includes(val)) continue;
      if (key === 'severity' && !['A', 'B', 'C', 'D', 'E'].includes(val)) continue;
      fill[key] = val;
    }
    if (Object.keys(fill).length) out.fill = fill;
  }
  return out;
}

router.post('/api/chatbot/message', chatbotLimiter, authenticateSession, async (req, res) => {
  const text = sanitizeStr((req.body && req.body.text) || '', 500);
  if (!text) return res.status(400).json({ error: 'الرسالة فارغة' });
  try {
    const result = await chatbot.handleMessage({
      text,
      user: chatbotUserFromSession(req),
      data: chatbotData(),
      context: chatbotContextFromBody(req.body),
    });
    res.json({
      reply: result.reply,
      source: result.source || null,
      suggestions: (result.suggestions || []).slice(0, 4),
      topic: result.topic ? { lastEntity: result.topic.entity, depts: result.topic.depts || [] } : null,
      action: sanitizeChatbotAction(result.action),
      followup: chatbotFollowup.sanitizePending(result.followup),
    });
  } catch (err) {
    console.error('[chatbot]', err);
    res.status(500).json({ reply: 'حصل خطأ غير متوقع في الشات بوت، حاول تاني أو راجع مشرف السلامة.' });
  }
});

module.exports = router;
