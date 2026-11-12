const V = 'df-v36';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'source.js', 'components.js', 'store.js', 'home.js', 'recommend.js', 'search.js', 'bridge.js', 'servers.js', 'guards.js', 'alerts.js', 'auth.js', 'sync.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/dizi-wordmark.svg', 'icons/dizi-icon.svg', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon-167.png', 'icons/icon-152.png', 'icons/icon-32.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V && x !== 'df-img').map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
const netFirst = (r) => {
  const net = fetch(r).then((x) => { if (x.ok) { const c = x.clone(); caches.open(V).then((ch) => ch.put(r, c)); } return x; });
  return Promise.race([net, new Promise((res) => setTimeout(() => res(null), 2500))]).then((x) => x || caches.match(r).then((m) => m || net)).catch(() => caches.match(r).then((m) => m || Response.error()));
};
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (r.destination === 'video' || r.headers.has('range')) return;
  if (u.origin === location.origin) {
    // هيكل التطبيق والبيانات: الشبكة أولًا (مهلة 2.5ث) ثم الكاش، فتظهر النسخة الجديدة فورًا ولا يُعرض القديم أولًا.
    // الكاش للانقطاع/الضعف فقط. صور البوسترات (محتوى ثابت باسم مُهشَّم): الكاش أولًا.
    if (u.pathname.includes('/data/posters/')) { e.respondWith(caches.match(r).then((m) => m || fetch(r).then((x) => { if (x.ok) { const c = x.clone(); caches.open(V).then((ch) => ch.put(r, c)); } return x; }))); return; }
    e.respondWith(netFirst(r)); return;
  } else if (r.destination === 'image' || r.destination === 'font' || r.destination === 'style') {
    e.respondWith(caches.open('df-img').then((c) => c.match(r).then((m) => m || fetch(r, { mode: 'no-cors' }).then((x) => { c.put(r, x.clone()); return x; }).catch(() => m))));
  }
});
