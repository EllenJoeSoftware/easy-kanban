// Minimal offline shell: cache the app shell + static assets, never cache /api.
const CACHE = 'ek-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;
  if (e.request.mode === 'navigate') {
    // Network first for pages so updates show immediately; fall back to cached shell offline.
    e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put('/', r.clone())); return r; }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname))) {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return r;
  })));
});
