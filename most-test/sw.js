// Сторож пробы «Мост тест» (30.09.2026): держит страницу В ТЕЛЕФОНЕ, как касса, но по правилам концепта v3:
// version.json — только из сети, мимо кэша; чистит только СВОЙ префикс кэша (у кассы на том же адресе свой).
const CACHE = 'most-test-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf('most-test-v') === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) {          // выключатель: только сеть, никакого кэша
    e.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }
  const net = fetch(req, { cache: 'no-cache' });
  e.waitUntil(net.then(r => {
    if (!r.ok) return;
    const copy = r.clone();
    return caches.open(CACHE).then(c => c.put(req, copy));
  }).catch(() => {}));
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true })).then(hit => hit || net.catch(() => Response.error())));
});
