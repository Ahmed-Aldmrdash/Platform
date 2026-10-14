self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'منصة السلامة والصحة المهنية';
  const options = {
    body: data.body || 'إشعار جديد في المنصة',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [200, 100, 200],
    data: { url: data.link || data.actionUrl || '/', targetId: data.targetId || null, type: data.type || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Only links on this site are opened; anything else falls back to the home page.
function sameOriginUrl(raw) {
  try {
    const url = new URL(raw || '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : '/';
  } catch (e) {
    return '/';
  }
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = sameOriginUrl(notifData.url);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // An open tab is focused and routes itself from the posted message; otherwise open a new window on the deep link.
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          client.postMessage({ ...notifData, type: 'notification-click', ntype: notifData.type || '', url: targetUrl });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
