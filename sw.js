// Weather to Travel — service worker.
// Makes the app installable and keeps working with a weak or no signal:
//   • app shell + libraries: cached, refreshed in the background
//   • API calls (forecast, routes, places, alerts): network first, last good answer when offline
//   • map tiles: cached as you browse (capped)
const VERSION = 'wtt-v5';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const TILES = `${VERSION}-tiles`;
const TILE_LIMIT = 800;

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
  './assets/img/favicon.svg',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
];

const API_HOSTS = [
  'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'router.project-osrm.org',
  'routing.openstreetmap.de', 'photon.komoot.io', 'api.weather.gov',
];
const LIB_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, TILES]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(async res => {
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      if (limit) trim(cache, limit);
    }
    return res;
  }).catch(() => hit);
  return hit || fresh;
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page loads: try the network, fall back to the cached app (any ?from=… link works offline).
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () =>
      (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html')));
    return;
  }
  if (API_HOSTS.includes(url.hostname)) { event.respondWith(networkFirst(req, DATA)); return; }
  if (url.hostname === 'tiles.openfreemap.org') { event.respondWith(staleWhileRevalidate(req, TILES, TILE_LIMIT)); return; }
  if (url.origin === self.location.origin || LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});
