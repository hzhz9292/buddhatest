
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Buddha Chat', {
    body: data.body || 'Новое сообщение',
    icon: data.icon || '/assets/icon-192.png',
    badge: data.badge || '/assets/icon-192.png',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
