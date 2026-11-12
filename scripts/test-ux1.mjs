// تعديلات الواجهة: الشعار، أيقونات التنقل المعتمدة، جرس خطي بلا إيموجي، تنبيه واتساب في صفحة الحلقة، وحفظ موضع القوائم والبحث عند الرجوع.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8123/'; const out = []; const T = (n, ok, d = '') => { out.push(!!ok); console.log('T', n, ok ? 'PASS' : 'FAIL', ok ? '' : d); };
const data = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^\uFEFF/, '')); const s = data.shows.find((x) => x.eps.length > 8);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
for (const [w, h] of [[320, 568], [390, 844], [430, 932]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
  for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
  await p.goto(BASE + '#/home'); await p.waitForSelector('#view .sec');
  T(`${w}px logo wordmark in home header`, await p.evaluate(() => { const i = document.querySelector('#title img.wm'); return !!i && i.complete && i.naturalWidth > 100 && i.getBoundingClientRect().height > 20; }));
  const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs a')].map((a) => ({ t: a.dataset.t, w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height), svg: !!a.querySelector('svg'), fill: getComputedStyle(a.querySelector('svg')).fill })));
  T(`${w}px four outline tabs (home, shows, favs, recent), all tappable`, tabs.map((x) => x.t).join() === 'home,shows,favs,recent' && tabs.every((x) => x.svg && x.fill === 'none' && x.w >= 48 && x.h >= 44), JSON.stringify(tabs));
  // صفحة الحلقة: خيار تنبيه واتساب + جرس خطي، ولا إيموجي
  await p.goto(BASE + `#/watch/${encodeURIComponent(s.id)}/${encodeURIComponent(s.eps[1].id)}`); await p.waitForSelector('#wa', { timeout: 8000 });
  const wa = await p.evaluate(() => { const x = document.querySelector('#wa'); return { svg: !!x.querySelector('svg path'), fill: getComputedStyle(x.querySelector('svg')).fill, txt: x.textContent.trim(), emoji: /🔔|🔕/.test(document.body.innerText) }; });
  T(`${w}px watch page has WhatsApp alert toggle with outline bell`, wa.svg && wa.fill === 'none' && /تنبيه واتساب/.test(wa.txt) && !wa.emoji, JSON.stringify(wa));
  await p.goto(BASE + '#/show/' + encodeURIComponent(s.id)); await p.waitForSelector('#wa');
  T(`${w}px show page bell is outline too (no emoji)`, await p.evaluate(() => !!document.querySelector('#wa svg path') && !/🔔/.test(document.body.innerText)));
  // قائمة المسلسلات: البحث والموضع يعودان بعد فتح مسلسل والرجوع
  await p.goto(BASE + '#/shows'); await p.waitForSelector('#g .card'); await p.fill('#q', 'مسلسل'); await p.waitForTimeout(300);
  await p.evaluate(() => { document.getElementById('view').scrollTop = 1500; }); await p.waitForTimeout(400);
  const before = await p.evaluate(() => document.getElementById('view').scrollTop);
  const href = await p.evaluate(() => { const cs = [...document.querySelectorAll('#g .card a')]; const c = cs.find((a) => a.getBoundingClientRect().top > 70 && a.getBoundingClientRect().top < innerHeight - 140); return c && c.getAttribute('href'); });
  await p.evaluate((hh) => { location.hash = hh; }, href); await p.waitForSelector('.dhero'); await p.waitForTimeout(400);
  await p.click('#back'); await p.waitForSelector('#g .card'); await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({ top: document.getElementById('view').scrollTop, q: document.getElementById('q').value }));
  T(`${w}px shows: scroll position restored exactly after back (${before} -> ${after.top})`, before > 500 && Math.abs(after.top - before) <= 2, JSON.stringify({ before, after }));
  T(`${w}px shows: search text kept after back`, after.q === 'مسلسل', after.q);
  T(`${w}px no page errors`, errs.length === 0, errs.join(' | ')); await ctx.close();
}

// البحث المحلي في الواجهة: اسم تركي، همزات/تشكيل، وحالة «لا نتائج» واضحة
{ const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'ar' }); for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
  const p = await ctx.newPage(); await p.goto(BASE + '#/shows'); await p.waitForSelector('#g .card');
  const titles = async () => p.evaluate(() => [...document.querySelectorAll('#g .card .t')].map((x) => x.textContent.trim()));
  const q = async (v) => { await p.fill('#q', v); await p.waitForTimeout(250); return titles(); };
  const kar = data.shows.find((x) => x.tr === 'Kardelenler');
  if (kar) { const r = await q('kardelenler'); T('search by Turkish name finds the show first', r[0] === kar.title, r.slice(0, 2).join(' | ')); const r2 = await q('أَزهار الثلج'); T('search ignores hamza/tashkeel', r2.includes(kar.title), r2.slice(0, 2).join(' | ')); } else T('turkish name sample present in data', false);
  await p.fill('#q', 'zzzqqxx'); await p.waitForTimeout(250); T('clear no-results state mentions the query', await p.evaluate(() => /لا نتائج لـ «zzzqqxx»/.test(document.getElementById('g').innerText)));
  await ctx.close(); }
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
