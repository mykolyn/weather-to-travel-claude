// Weather to Travel — service worker.
// Makes the app installable and lets it open with a weak or no signal:
//   • the app's own files: network first (so updates show up at once), cached copy when offline
//   (MapLibre is bundled in assets/vendor, so the map code is available offline too)
// Nothing from other sites is handled here — APIs, map tiles and web fonts go straight to the
// network. Relaying cross-origin requests through a service worker misbehaved in Safari (hung
// requests, "access control" failures on map files). The page keeps its own copy of the last
// good API answers for offline use (see api.js).
const VERSION = 'wtt-v7';
const SHELL = `${VERSION}-shell`;
const PAGE_DATA = 'wtt-data-v1'; // owned by the page (api.js); keep it across updates

const SHELL_FILES = [
  './',
  './index.html',
  './case-study.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/api.js',
  './assets/js/model.js',
  './assets/js/icons.js',
  './assets/js/poster.js',
  './assets/vendor/maplibre-gl-4.7.1/maplibre-gl.js',
  './assets/vendor/maplibre-gl-4.7.1/maplibre-gl.css',
  './assets/img/favicon.svg',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, PAGE_DATA]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName, { ignoreSearch = false } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page loads: network first; offline, any ?from=… link opens the cached app.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () =>
      (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./')) || caches.match('./index.html')));
    return;
  }
  if (url.origin === self.location.origin) event.respondWith(networkFirst(req, SHELL));
  // Anything cross-origin is left alone and goes straight to the network.
});
