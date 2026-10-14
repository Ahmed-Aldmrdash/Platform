'use strict';

const webpush = require('web-push');
const { makeStore } = require('../data/stores');

// VAPID keys must stay stable across deploys or every browser subscription
// breaks, so they come from the environment or are generated once and stored
// in the database.
function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const store = makeStore('vapid-keys', {});
  const saved = store.read();
  if (saved && saved.publicKey && saved.privateKey) return saved;
  const generated = webpush.generateVAPIDKeys();
  store.write(generated);
  return generated;
}

const vapidKeys = loadVapidKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@elsewedy.com', vapidKeys.publicKey, vapidKeys.privateKey);

function sendPush(subscription, payload) {
  return webpush.sendNotification(subscription, payload);
}

module.exports = { vapidPublicKey: vapidKeys.publicKey, sendPush };
