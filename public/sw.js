// Kwata service worker: opens instantly from the home screen and shows a
// friendly screen when there's no connection. Bump VERSION on each release.
const VERSION = 'kwata-v4';
const SHELL = [
  '/', '/driver', '/offline.html', '/css/app.css', '/js/common.js', '/js/rider.js', '/js/driver.js',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/vendor/maplibre/maplibre-gl.js', '/vendor/maplibre/maplibre-gl.css', '/vendor/maplibre-leaflet/leaflet-maplibre-gl.js',
  '/icons/icon-192.png', '/icons/driver-192.png', '/manifest.json', '/manifest-driver.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;            // maps, payments: straight to network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return; // live data is never cached

  if (req.mode === 'navigate') {
    // Pages: fresh from the network when online, cached copy (or offline screen) when not.
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('/offline.html'))));
    return;
  }

  // Static files: serve from cache instantly, refresh in the background.
  e.respondWith(caches.match(req).then((cached) => {
    const fresh = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
