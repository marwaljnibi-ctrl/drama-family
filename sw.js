const V = 'df-v8';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'source.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V && x !== 'df-img').map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (r.destination === 'video' || r.headers.has('range')) return;
  if (u.origin === location.origin) {
    // البيانات: الشبكة أولًا ثم الكاش. الباقي: الكاش ثم تحديث بالخلفية.
    if (u.pathname.includes('/data/')) { e.respondWith(fetch(r).then((x) => { const c = x.clone(); caches.open(V).then((ch) => ch.put(r, c)); return x; }).catch(() => caches.match(r))); return; }
    e.respondWith(caches.match(r).then((m) => { const f = fetch(r).then((x) => { caches.open(V).then((ch) => ch.put(r, x.clone())); return x; }).catch(() => m); return m || f; }));
  } else if (r.destination === 'image' || r.destination === 'font' || r.destination === 'style') {
    e.respondWith(caches.open('df-img').then((c) => c.match(r).then((m) => m || fetch(r, { mode: 'no-cors' }).then((x) => { c.put(r, x.clone()); return x; }).catch(() => m))));
  }
});
