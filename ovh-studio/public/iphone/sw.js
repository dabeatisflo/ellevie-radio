const CACHE_NAME = 'ellevie-iphone-v1.5.0-carplay.1';
const APP_SHELL = [
  '/iphone/',
  '/iphone/app.css?v=1.5.0-carplay.1',
  '/iphone/app.js?v=1.5.0-carplay.1',
  '/iphone/manifest.webmanifest',
  '/iphone/assets/icon-180.png',
  '/iphone/assets/icon-192.png',
  '/iphone/assets/icon-512.png',
  '/iphone/assets/ellevie-logo.webp',
  '/iphone/assets/nora.webp',
  '/iphone/assets/sofia.webp',
  '/iphone/assets/maya.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/iphone/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/iphone/', copy));
          return response;
        })
        .catch(() => caches.match('/iphone/'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof message.title === 'string' && message.title
    ? message.title
    : 'ellevie Radio';
  const options = {
    body: typeof message.body === 'string' ? message.body : 'Vous avez reçu une réponse du studio.',
    icon: '/iphone/assets/icon-192.png',
    badge: '/iphone/assets/icon-192.png',
    tag: typeof message.tag === 'string' ? message.tag : 'ellevie-studio-reply',
    renotify: true,
    data: {
      url: typeof message.url === 'string' ? message.url : '/iphone/#messages'
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/iphone/#messages', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (!client.url.startsWith(self.location.origin)) continue;
        if ('navigate' in client) await client.navigate(target);
        return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
