// 🌉 СТОРОЖ ЗАГРУЗЧИКА ПИЛОТА «МОСТ» (sklad2, 01.10.2026) — разбор в index.html и apps-script/bridge.js.
// Держит загрузчик В ТЕЛЕФОНЕ: тап по иконке открывается без сети за доли секунды (проба 30.09–01.10: 14–113 мс).
// Правила концепта (4.6; Фейбл MED-5, Кодекс MED-4 круга 2 — «свой сторож, не копия кассы»):
//   · version.json — ТОЛЬКО сеть, мимо кэша: это выключатель владельца;
//   · свои файлы — из кэша сразу, свежая копия фоном (подействует со следующего запуска);
//   · чистим ТОЛЬКО свой префикс кэша «sklad2-v…» (на том же адресе живут касса и проба), localStorage не трогаем;
//   · чужие адреса (Google, фото) сторож не трогает вовсе.
// Текст страницы аппки сторож НЕ хранит: он лежит в IndexedDB загрузчика и приходит только через мост за ключом.
const CACHE = 'sklad2-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './qrcode.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf('sklad2-v') === 0 && k !== CACHE).map(k => caches.delete(k))))
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
