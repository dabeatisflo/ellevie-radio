const CACHE_NAME = 'ellevie-iphone-v1.4.0';
const APP_SHELL = [
  '/iphone/',
  '/iphone/app.css?v=1.4.0',
  '/iphone/app.js?v=1.4.0',
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
