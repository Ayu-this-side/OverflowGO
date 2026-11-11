/* Web Push handlers injected into the generated service worker (Phase 4). */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'New OverflowGo job';
  const options = {
    body: payload.body || 'Open the driver app to accept the job.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || 'overflowgo-offer',
    renotify: true,
    data: { url: payload.url || '/driver/route' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/driver/route';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch {
              // Ignore navigation failures and just focus the window.
            }
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
