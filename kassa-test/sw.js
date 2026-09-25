// Пробная «Касса» (25.09.2026): держит страницу В ТЕЛЕФОНЕ, чтобы она открывалась без сети.
// Область — только папка kassa-test/: сканер и ярлык склада этот сторож не видит.
// Порядок: сразу отдаём сохранённую копию, а свежую тянем с GitHub в фоне на следующий раз.
const CACHE = 'kassa-test-v2';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf('kassa-test-') === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const net = fetch(req);
  // Свежая копия на следующий раз; запись ждём внутри waitUntil, иначе iOS может усыпить сторожа раньше
  e.waitUntil(net.then(r => {
    if (!r.ok) return;
    const copy = r.clone();
    return caches.open(CACHE).then(c => c.put(req, copy));
  }).catch(() => {}));
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true })).then(hit => hit || net.catch(() => Response.error())));
});
