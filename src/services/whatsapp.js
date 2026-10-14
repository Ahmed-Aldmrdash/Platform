'use strict';

// WhatsApp Cloud API client: text and button messages plus webhook verification. Disabled unless configured.

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v20.0';
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';
const crypto = require('crypto');

function isConfigured() {
  return Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID);
}

function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[^0-9+]/g, '');
  p = p.replace(/^\+/, '');
  if (p.startsWith('0')) p = '20' + p.slice(1);
  if (!p.startsWith('20') && p.length === 10) p = '20' + p;
  return p;
}

async function callGraphAPI(payload) {
  if (!isConfigured()) {
    console.warn('[whatsapp] not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing), message skipped');
    return { sent: false, reason: 'not_configured' };
  }
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[whatsapp] send failed:', res.status, JSON.stringify(body));
      return { sent: false, reason: 'api_error', status: res.status, body };
    }
    return { sent: true, body };
  } catch (err) {
    console.error('[whatsapp] network error:', err.message);
    return { sent: false, reason: 'network_error', error: err.message };
  }
}

async function sendText(toPhoneRaw, text) {
  const to = normalizePhone(toPhoneRaw);
  if (!to) return { sent: false, reason: 'invalid_phone' };
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

async function sendInteractiveButtons(toPhoneRaw, bodyText, buttons) {
  const to = normalizePhone(toPhoneRaw);
  if (!to) return { sent: false, reason: 'invalid_phone' };
  if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
    return { sent: false, reason: 'invalid_buttons (1-3 required)' };
  }
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })),
      },
    },
  });
}

function verifySignature(rawBody, signatureHeader) {
  if (!WHATSAPP_APP_SECRET || !rawBody || typeof signatureHeader !== 'string') return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyWebhook(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN && WHATSAPP_VERIFY_TOKEN) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

function parseIncoming(body) {
  try {
    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const message = value && value.messages && value.messages[0];
    if (!message) return null;
    const from = message.from;
    if (message.type === 'text') {
      return { from, kind: 'text', text: message.text.body };
    }
    if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
      return { from, kind: 'button', buttonId: message.interactive.button_reply.id, buttonTitle: message.interactive.button_reply.title };
    }
    return { from, kind: 'unsupported' };
  } catch (err) {
    console.error('[whatsapp] could not parse incoming message:', err.message);
    return null;
  }
}

module.exports = {
  isConfigured,
  normalizePhone,
  sendText,
  sendInteractiveButtons,
  verifySignature,
  verifyWebhook,
  parseIncoming,
};
