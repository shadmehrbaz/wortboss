// sw.js — service worker: caches the whole app on first load so it runs 100% offline afterwards.
// Bump CACHE_VERSION whenever you change any file, so installed copies pick up the update.
const CACHE_VERSION = 'wortboss-v1.0.0';
const CORE = [
  './', 'index.html', 'manifest.json', 'css/style.css',
  'js/app.js', 'js/state.js', 'js/store.js', 'js/xlsx-reader.js', 'js/parser.js', 'js/german.js', 'js/srs.js',
  'js/questions.js', 'js/fight.js', 'js/progression.js', 'js/audio.js', 'js/monsters.js', 'js/i18n.js', 'js/ui.js',
  'js/screens/home.js', 'js/screens/fight.js', 'js/screens/quests.js', 'js/screens/stats.js', 'js/screens/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];
const OPTIONAL = ['vendor/xlsx.full.min.js'];        // SheetJS, if you added it

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(OPTIONAL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wortboss-') && k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
