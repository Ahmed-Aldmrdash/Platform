'use strict';

const express = require('express');
const chatbot = require('../chatbot');
const whatsapp = require('../services/whatsapp');
const { readUsers, readHazards, writeHazards } = require('../data/stores');
const { enqueueWrite } = require('../data/write-queue');
const { chatbotData } = require('../chatbot/data-source');
const { logAuditEvent } = require('../services/audit-log');

const router = express.Router();

router.get('/api/whatsapp/webhook', (req, res) => {
  const result = whatsapp.verifyWebhook(req.query);
  if (result.ok) return res.status(200).send(result.challenge);
  return res.sendStatus(403);
});

function findAdminByWhatsAppPhone(fromPhone) {
  const from = whatsapp.normalizePhone(fromPhone);
  return readUsers().find((u) => u.phone && whatsapp.normalizePhone(u.phone) === from && chatbot.isAdminRole(u.role)) || null;
}

/** Accept / reject buttons on the new-hazard WhatsApp alert. */
async function handleButtonAction(incoming) {
  const admin = findAdminByWhatsAppPhone(incoming.from);
  if (!admin) {
    console.warn('[whatsapp] button press from a number that is not an admin');
    return;
  }
  const m = incoming.buttonId.match(/^hzact_(accept|reject)_(.+)$/);
  if (!m) return;
  const [, action, hazardId] = m;
  const actor = admin.name || admin.username;

  let previousStatus = null;
  let found = false;
  await enqueueWrite(async () => {
    const hazards = readHazards();
    const hazard = hazards.find((h) => h.id === hazardId);
    if (!hazard) return;
    found = true;
    previousStatus = hazard.status;
    hazard.status = action === 'accept' ? 'in_progress' : 'rejected';
    hazard.updatedBy = actor;
    hazard.updatedAt = new Date().toISOString();
    writeHazards(hazards);
  });

  if (!found) {
    await whatsapp.sendText(admin.phone, `⚠️ لم يتم العثور على البلاغ ${hazardId} (ربما تم التعامل معه بالفعل).`);
    return;
  }
  logAuditEvent({
    entityType: 'hazard',
    entityId: hazardId,
    action: `whatsapp_${action}`,
    actor: { id: admin.id, username: admin.username, role: admin.role, name: admin.name, department: admin.department },
    previousStatus,
    newStatus: action === 'accept' ? 'in_progress' : 'rejected',
    note: 'تحديث من أزرار تنبيه واتساب',
  });
  const label = action === 'accept' ? 'تم قبوله ومتابعته ✅' : 'تم رفضه ❌';
  await whatsapp.sendText(admin.phone, `تم تحديث البلاغ ${hazardId}: ${label}\n(بواسطة: ${actor} عبر واتساب)`);
}

async function handleTextMessage(incoming) {
  const admin = findAdminByWhatsAppPhone(incoming.from);
  const user = admin
    ? { role: admin.role, username: admin.username, name: admin.name, department: admin.department || '', empCode: '' }
    : { role: 'guest' };
  try {
    const result = await chatbot.handleMessage({ text: incoming.text, user, data: admin ? chatbotData() : {} });
    await whatsapp.sendText(incoming.from, result.reply);
  } catch (err) {
    console.error('[whatsapp] could not answer an incoming message:', err.message);
  }
}

router.post('/api/whatsapp/webhook', (req, res) => {
  if (!whatsapp.verifySignature(req.rawBody, req.headers['x-hub-signature-256'])) {
    console.warn('[whatsapp] webhook rejected: bad signature or WHATSAPP_APP_SECRET not set');
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  const incoming = whatsapp.parseIncoming(req.body);
  if (!incoming) return;
  const handler = incoming.kind === 'button' ? handleButtonAction : incoming.kind === 'text' ? handleTextMessage : null;
  if (handler) handler(incoming).catch((err) => console.error('[whatsapp] handler error:', err));
});

module.exports = router;
