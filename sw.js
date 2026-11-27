// Weather to Travel — service worker.
// Makes the app installable and lets it open with a weak or no signal:
//   • the app's own files: network first (so updates show up at once), cached copy when offline
//   • libraries & fonts: cached, refreshed in the background
//   • map tiles: cached as you browse (capped)
// Live API calls (forecast, routes, places, alerts) are NOT handled here: the page talks to those
// services directly and keeps its own copy of the last good answers (see api.js). On iOS Safari,
// relaying them through a service worker could leave a request hanging.
const VERSION = 'wtt-v6';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const PAGE_DATA = 'wtt-data-v1'; // owned by the page (api.js); keep it across updates
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
const LIB_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, TILES, PAGE_DATA]);
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

  // Page loads: network first; offline, any ?from=… link opens the cached app.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () =>
      (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./')) || caches.match('./index.html')));
    return;
  }
  if (url.origin === self.location.origin) { event.respondWith(networkFirst(req, SHELL)); return; }
  if (url.hostname === 'tiles.openfreemap.org') { event.respondWith(staleWhileRevalidate(req, TILES, TILE_LIMIT)); return; }
  if (LIB_HOSTS.includes(url.hostname)) { event.respondWith(staleWhileRevalidate(req, SHELL)); return; }
  // Everything else (the live APIs) goes straight to the network.
});
