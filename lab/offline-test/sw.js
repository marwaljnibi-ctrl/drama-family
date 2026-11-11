// Service Worker للمختبر فقط: يحفظ صفحة الاختبار وملفاتها ليُفتح المختبر بلا إنترنت (وضع الطيران). لا يمس أي شيء آخر.
const V = 'offline-lab-v2';
const FILES = ['./', './index.html', './dl2.js', './opfs-writer.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || r.headers.has('range')) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then((m) => m || fetch(r)));
});
