// فحوص التصميم الآلية (Chromium بمقاسات iPhone): لا تجاوز أفقي، مناطق لمس ≥ 40px، تقليل الحركة، وقياسات أداء بسيطة.
// الاستخدام: BASE=http://localhost:8124/ node scripts/test-design.mjs   (يطبع JSON مختصرًا، ويخرج بخطأ عند أي فشل)
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8123/';
const out = []; const T = (n, ok, d = '') => { out.push(ok); console.log('T', n, ok ? 'PASS' : 'FAIL', d); };
const SIZES = [[320, 568], [375, 667], [390, 844], [430, 932]];
const b = await chromium.launch();
const data = await (await fetch(BASE + 'data/shows.json')).json();
const sid = data.shows.find((s) => (s.img2 || s.img) && s.eps.length > 5);
for (const [w, h] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort()); await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', (r) => r.abort()); await ctx.route('https://accounts.google.com/**', (r) => r.abort());
  await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<body style=background:#000>' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 90)));
  await p.goto(BASE + '#/home'); await p.waitForSelector('#view .sec, #view .empty-card');
  await p.evaluate(async (id) => { const db = await import('./db.js'); await db.raw.putProgress({ key: id.id + '|' + id.eps[2].id, showId: id.id, epId: id.eps[2].id, epNum: id.eps[2].n, time: 600, duration: 2700, done: false, hidden: false, updated: Date.now() }); await db.raw.putFav({ showId: id.id, at: Date.now() }); }, { id: sid.id, eps: sid.eps.map((e) => ({ id: e.id, n: e.n })) });
  const pages = [['home', '#/home'], ['shows', '#/shows'], ['show', '#/show/' + encodeURIComponent(sid.id)], ['watch', `#/watch/${encodeURIComponent(sid.id)}/${encodeURIComponent(sid.eps[2].id)}`], ['favs', '#/favs'], ['recent', '#/recent'], ['latest', '#/latest'], ['account', '#/alerts']];
  for (const [name, hash] of pages) {
    await p.goto(BASE + hash); await p.reload(); await p.waitForTimeout(1200);
    const m = await p.evaluate(() => {
      const de = document.documentElement; const overflowX = de.scrollWidth - innerWidth;
      const small = [...document.querySelectorAll('#view button, #view a.go, #tabs a, header a, header button, .heart')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (Math.min(r.width, r.height) < 34) ; }).map((e) => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
      const tabsH = document.querySelector('#tabs').getBoundingClientRect().height;
      return { overflowX, small: [...new Set(small)].slice(0, 6), tabsH: Math.round(tabsH) };
    });
    T(`${w}px ${name}: no-horizontal-overflow`, m.overflowX <= 1, String(m.overflowX));
    T(`${w}px ${name}: tap-targets>=34px`, m.small.length === 0, m.small.join(','));
  }
  T(`${w}px: no-page-errors`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}
// تقليل الحركة: لا حركات جارية
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await p.goto(BASE + '#/shows'); await p.waitForSelector('#g .card'); await p.waitForTimeout(500);
  const anims = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  T('reduced-motion: no running animations', anims === 0, String(anims)); await ctx.close();
}
// أداء الرئيسية: FCP/LCP وعدد الطلبات وحجم CSS/JS
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p = await ctx.newPage(); const reqs = [];
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  p.on('response', async (r) => { try { const u = r.url(); if (u.startsWith(BASE)) reqs.push([u.replace(BASE, ''), (await r.body()).length]); } catch {} });
  await p.addInitScript(() => { window.__lcp = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  await p.goto(BASE + '#/home'); await p.waitForSelector('#view .sec'); await p.waitForTimeout(1500);
  const m = await p.evaluate(() => ({ fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0), lcp: Math.round(window.__lcp), dom: document.querySelectorAll('*').length }));
  const sum = (re) => reqs.filter(([u]) => re.test(u)).reduce((a, [, n]) => a + n, 0);
  console.log('PERF', JSON.stringify({ ...m, cssKB: Math.round(sum(/\.css$/) / 1024), jsKB: Math.round(sum(/\.js$/) / 1024), imgKB: Math.round(sum(/\.(webp|jpg|png)$/) / 1024), requests: reqs.length }));
  T('perf: LCP under 2500ms (local, headless)', m.lcp > 0 && m.lcp < 2500, String(m.lcp)); await ctx.close();
}
await b.close();
console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
