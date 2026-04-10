self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data?.json() || {};
  } catch {
    payload = {};
  }

  const notification = payload.notification || {};
  const data = payload.data || notification.data || {};
  const title = notification.title || 'Incoming call';
  const body = notification.body || 'Someone is calling you';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon: notification.icon || '/favicon.svg',
      renotify: true,
      requireInteraction: true,
      tag: notification.tag || `call-${data.callId || 'incoming'}`,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/direct-call';

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      includeUncontrolled: true,
      type: 'window',
    });

    for (const client of windowClients) {
      if ('focus' in client && client.url.includes('/direct-call')) {
        client.postMessage({
          data: event.notification.data || {},
          type: 'incoming-call-focus',
        });
        await client.focus();
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
