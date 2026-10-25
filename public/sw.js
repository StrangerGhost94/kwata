// Flytte service worker: opens instantly from the home screen, stays current, and
// shows a friendly screen when there's no connection. Bump VERSION on each release.
//
// How it stays fast AND fresh:
// - Pages (HTML) come from the network, so a new deploy shows on the next open. If the
//   network is slow (3s) or down, the last saved page is used instead.
// - Each page links its scripts/styles with ?v=<deploy id>. Those exact files never change,
//   so they're served straight from the phone ("cache first") with no network wait.
//   A new deploy has new ?v= links, so the new files are fetched once and kept.
// - Maps, payments and live data are never cached.
const VERSION = 'flytte-v75';
const ASSETS = 'flytte-assets';        // versioned js/css; kept across releases, trimmed below
const SHELL = [
  '/offline.html', '/socket.io/socket.io.js',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/vendor/maplibre/maplibre-gl.mjs', '/vendor/maplibre/maplibre-gl-shared.mjs', '/vendor/maplibre/maplibre-gl-worker.mjs', '/vendor/maplibre/maplibre-gl.css', '/vendor/maplibre-leaflet/leaflet-maplibre-gl.js',
  '/icons/flytte-icon-192.png?v=2', '/icons/flytte-driver-192.png?v=2', '/img/welcome.jpg', '/img/vehicles/boda.svg', '/img/vehicles/car.svg', '/img/vehicles/comfort.svg', '/img/vehicles/parcel.svg', '/img/vehicles/airport.svg', '/manifest.json', '/manifest-driver.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== ASSETS) await caches.delete(k);
    // Keep only the newest ~40 versioned files (two or three releases' worth).
    const c = await caches.open(ASSETS), keys = await c.keys();
    for (const r of keys.slice(0, Math.max(0, keys.length - 40))) await c.delete(r);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;            // maps, payments: straight to network
  const isSocketLib = url.pathname === '/socket.io/socket.io.js';                 // the client library itself can be saved
  if (url.pathname.startsWith('/api/') || (url.pathname.startsWith('/socket.io/') && !isSocketLib)) return; // live data is never cached

  // Versioned app code (?v=deploy): the file for that version never changes → phone first.
  if ((url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) && url.searchParams.has('v')) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Unversioned app code and manifests: network, falling back to any saved copy.
  if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname.endsWith('.json')) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  if (req.mode === 'navigate') {
    // Pages: fresh from the network, but never keep the rider waiting on a bad connection.
    e.respondWith((async () => {
      const net = (async () => {
        const pre = e.preloadResponse && await e.preloadResponse;
        const res = pre || await fetch(req);
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(new URL(req.url).pathname, copy)); }
        return res;
      })();
      const saved = await caches.match(new URL(req.url).pathname);
      try { return await (saved ? Promise.race([net, timeout(3000)]) : net); }
      catch { return saved || (await caches.match('/offline.html')); }
    })());
    return;
  }

  // Images, icons, map library: from the phone instantly, refreshed in the background.
  e.respondWith(caches.match(req).then((cached) => {
    const fresh = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});

// ---------- Ride alerts (Web Push) ----------
// A new request rings on a locked phone; tapping it opens Flytte Driver on the request.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Flytte', body: e.data ? e.data.text() : '' }; }
  const offer = d.type === 'offer', rider = d.app === 'rider';
  const icon = rider ? '/icons/flytte-icon-192.png?v=2' : '/icons/flytte-driver-192.png?v=2';
  e.waitUntil(self.registration.showNotification(d.title || (rider ? 'Flytte' : 'Flytte Driver'), {
    body: d.body || '',
    tag: d.tag || 'flytte',
    renotify: true,
    requireInteraction: offer || (rider && d.type === 'arrived'),
    icon, badge: icon,
    vibrate: offer ? [400, 150, 400, 150, 400] : rider && (d.type === 'arrived' || d.type === 'near') ? [300, 120, 300] : [200],
    data: { url: rider ? '/' : '/driver', tripId: d.tripId || null },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/driver';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const want = url === '/' ? (p) => !p.startsWith('/driver') && !p.startsWith('/admin') : (p) => p.startsWith('/driver');
    const open = all.find((c) => want(new URL(c.url).pathname));
    if (open) { await open.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
