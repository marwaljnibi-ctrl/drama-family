// اختبارات «تجربة التطبيق»: واجهة ثابتة، Hero، قاعدة عرض الصور (Poster/Backdrop بلا قص ضار)، والكاش (لا وميض للشكل القديم).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8123/';
const out = []; const T = (n, ok, d = '') => { out.push(ok); console.log('T', n, ok ? 'PASS' : 'FAIL', d); };
const b = await chromium.launch();
const mk = async (extra = {}) => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...extra }); await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort()); await ctx.route('https://accounts.google.com/**', (r) => r.abort()); await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', (r) => { const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' }; if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: H }); const p = new URL(r.request().url()).pathname; return r.fulfill({ status: 200, headers: H, body: p === '/api/sync' ? '{"favs":[],"progress":[]}' : JSON.stringify({ name: 'م', email: 'a@x.com', wa: { prompt: 'no', phone: null, verified: false, consent: false }, shows: [] }) }); }); return ctx; };
const real = await (await fetch(BASE + 'data/shows.json')).json();

// ===== أ) واجهة ثابتة =====
{
  const ctx = await mk(); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  await p.goto(BASE + '#/shows'); await p.waitForSelector('#g .card'); await p.waitForTimeout(800);
  const r0 = await p.evaluate(() => { const t = document.getElementById('tabs').getBoundingClientRect(), h = document.getElementById('top').getBoundingClientRect(); return { tt: Math.round(t.top), tb: Math.round(t.bottom), ht: Math.round(h.top), hb: Math.round(h.bottom), ih: innerHeight }; });
  await p.evaluate(() => { document.getElementById('view').scrollTop = 2400; }); await p.waitForTimeout(300);
  const r1 = await p.evaluate(() => { const t = document.getElementById('tabs').getBoundingClientRect(), h = document.getElementById('top').getBoundingClientRect(); return { tt: Math.round(t.top), tb: Math.round(t.bottom), ht: Math.round(h.top), st: document.getElementById('view').scrollTop, winY: scrollY, de: document.documentElement.scrollTop, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
  T('tabs-bar-fixed-while-scrolling', r1.tt === r0.tt && r1.tb === r0.ih && r1.tb === r0.tb, JSON.stringify({ r0, r1 }));
  T('top-bar-fixed-while-scrolling', r1.ht === 0 && r1.ht === r0.ht);
  T('only-content-scrolls', r1.st > 500 && r1.winY === 0 && r1.de === 0, JSON.stringify({ st: r1.st, winY: r1.winY }));
  T('no-horizontal-movement', r1.sw <= r1.iw + 1, r1.sw + '/' + r1.iw);
  const z = await p.evaluate(() => ({ ta: getComputedStyle(document.documentElement).touchAction, vp: document.querySelector('meta[name=viewport]').content, bh: Math.round(document.body.getBoundingClientRect().height), ih: innerHeight }));
  T('no-accidental-zoom-but-pinch-allowed', /manipulation/.test(z.ta) && !/maximum-scale|user-scalable\s*=\s*(no|0)/.test(z.vp), JSON.stringify(z));
  T('app-height-equals-visible-viewport', Math.abs(z.bh - z.ih) <= 1);
  const wrap = await p.evaluate(() => [...document.querySelectorAll('input')].every((i) => parseFloat(getComputedStyle(i).fontSize) >= 16));
  await p.goto(BASE + '#/shows'); await p.waitForSelector('#q'); T('inputs-16px-no-focus-zoom', await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('q')).fontSize) >= 16));
  T('no-page-errors-fixed-layout', errs.length === 0, errs.join(' | ')); await ctx.close();
}

// ===== ب) كاش: لا وميض لشكل قديم، ويعمل بلا اتصال =====
{
  const sw = await (await fetch(BASE + 'sw.js')).text();
  T('sw-shell-network-first-not-stale-first', /netFirst/.test(sw) && !/return m \|\| f/.test(sw));
  const ctx = await mk(); const p = await ctx.newPage(); await p.goto(BASE + '#/shows'); await p.waitForSelector('#g .card');
  await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(1500); await p.reload(); await p.waitForSelector('#g .card'); await p.waitForTimeout(1500);   // زيارة ثانية تحت الخدمة: تُخزَّن البيانات
  await ctx.setOffline(true); await p.reload(); await p.waitForSelector('#g .card', { timeout: 10000 }).then(() => T('works-offline-from-cache-fallback', true), () => T('works-offline-from-cache-fallback', false)); await ctx.close();
}

// ===== ج) Hero =====
{
  const ctx = await mk(); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  const demo = await (await fetch(BASE + 'data/demo.json')).json(); const latest = demo.latest.slice().sort((a, c) => c.ts - a.ts)[0];
  await p.goto(BASE + '?demo=1#/home'); await p.reload(); await p.waitForSelector('#view .sec');
  const h1 = await p.evaluate(() => { const a = document.querySelector('.hero-new'); return a ? { href: a.getAttribute('href'), text: a.innerText } : null; });
  T('hero-guest-latest-episode', !!h1 && h1.href.includes(encodeURIComponent(latest.epId)) && /شاهد الآن/.test(h1.text) && /الحلقة/.test(h1.text), JSON.stringify(h1));
  // فتح صفحة حلقة بلا تشغيل لا يغيّر الـHero
  const other = demo.shows.find((s) => s.id !== latest.showId);
  await p.goto(BASE + `?demo=1#/watch/${other.id}/${other.eps[1].id}`); await p.waitForSelector('#pl'); await p.goto(BASE + '?demo=1#/home'); await p.reload(); await p.waitForSelector('#view .sec');
  T('opening-episode-page-is-not-watching', !!(await p.$('.hero-new')) && !(await p.$('.ccard.hero-c')));
  // مشاهدة فعلية ⇒ Hero آخر مسلسل شوهد
  await p.evaluate(async ({ s, e }) => { const db = await import('./db.js'); await db.progress.save(s, e, { time: 900, duration: 2700, done: false }); }, { s: other.id, e: { id: other.eps[1].id, n: other.eps[1].n } });
  await p.goto(BASE + '?demo=1#/home'); await p.reload(); await p.waitForSelector('#view .sec');
  const h2 = await p.evaluate(() => { const a = document.querySelector('.ccard.hero-c'); return a ? { t: a.querySelector('b').textContent.trim(), s: a.querySelector('small').textContent, go: a.querySelector('.go').textContent.trim(), bar: !!a.querySelector('.bar') } : null; });
  T('hero-switches-to-last-watched', !!h2 && h2.t === other.title && /توقفت عند/.test(h2.s) && h2.go === 'متابعة المشاهدة' && h2.bar && !(await p.$('.hero-new')), JSON.stringify(h2));
  await p.reload(); await p.waitForSelector('.ccard.hero-c'); T('hero-persists-after-reload', (await p.textContent('.ccard.hero-c b')).trim() === other.title);
  // آخر مسلسل شوهد يتقدم على الأقدم
  const third = demo.shows.find((s) => s.id !== other.id);
  await p.evaluate(async ({ s, e }) => { const db = await import('./db.js'); await db.progress.save(s, e, { time: 300, duration: 2700, done: false }); }, { s: third.id, e: { id: third.eps[1].id, n: third.eps[1].n } });
  await p.reload(); await p.waitForSelector('.ccard.hero-c'); T('hero-uses-most-recent-show', (await p.textContent('.ccard.hero-c b')).trim() === third.title);
  T('no-autoplay-in-hero', !(await p.$('.hero-c video, .hero-c iframe')));
  // اختلاف الـHero بين حسابين (قاعدتان محليتان منفصلتان)
  const res = [];
  for (const [uid, show] of [['g_A', demo.shows[0]], ['g_B', demo.shows[1]]]) {
    const c2 = await mk(); await c2.addInitScript((u) => { localStorage.setItem('df-session', 'a'.repeat(64)); localStorage.setItem('df-uid', u); localStorage.setItem('df-import:' + u, '0'); localStorage.setItem('df-fav-nudge', '1'); }, uid);
    const q = await c2.newPage(); await q.goto(BASE + '?demo=1#/home'); await q.waitForSelector('#view .sec');
    await q.evaluate(async ({ s, e }) => { const db = await import('./db.js'); await db.progress.save(s, e, { time: 500, duration: 2700, done: false }); }, { s: show.id, e: { id: show.eps[1].id, n: show.eps[1].n } });
    await q.reload(); await q.waitForSelector('.ccard.hero-c'); res.push((await q.textContent('.ccard.hero-c b')).trim()); await c2.close();
  }
  T('hero-differs-between-two-accounts', res[0] === demo.shows[0].title && res[1] === demo.shows[1].title && res[0] !== res[1], res.join(' | '));
  const art = await p.evaluate(async () => { const c = await import('./components.js'); return [c.heroArt({ img4: 'a', img3: 'b', img2: 'c' }).mode, c.heroArt({ img3: 'b', img2: 'c' }).mode, c.heroArt({ img2: 'c' }).mode]; });
  T('hero-art-priority-landscape-then-poster-then-banner', art.join() === 'land,poster,banner', art.join());
  T('no-page-errors-hero', errs.length === 0, errs.join(' | ')); await ctx.close();
}

// ===== د) قاعدة عرض الصور (بيانات حقيقية): فحص الأبعاد الفعلية =====
{
  const ctx = await mk(); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  await p.goto(BASE + '#/shows'); await p.waitForSelector('#g .card');
  // نمرّر القائمة لتحميل صور كثيرة ثم نفحص كل صورة محمّلة: هل القاعدة مطبّقة حسب أبعادها الفعلية؟
  for (let i = 0; i < 14; i++) { await p.evaluate((y) => { document.getElementById('view').scrollTop = y; }, i * 900); await p.waitForTimeout(250); }
  const audit = await p.evaluate(() => { const rows = []; for (const w of document.querySelectorAll('#g .pw')) { const i = w.querySelector('img'); const ph = w.classList.contains('pw-ph'); if (ph) { rows.push({ ph: true, title: (w.querySelector('.ph-t') || {}).textContent || '' }); continue; } if (!i || !i.complete || !i.naturalWidth) continue; const r = w.getBoundingClientRect(); rows.push({ ph: false, ia: +(i.naturalWidth / i.naturalHeight).toFixed(2), bad: w.classList.contains('bad'), shown: getComputedStyle(i).display !== 'none', fit: w.classList.contains('fit'), of: getComputedStyle(i).objectFit }); } return rows; });
  const imgs = audit.filter((x) => !x.ph), phs = audit.filter((x) => x.ph);
  T('audited-many-real-cards', imgs.length >= 40 && phs.length >= 5, `images=${imgs.length} placeholders=${phs.length}`);
  T('vertical-cards-show-only-portrait-images', imgs.every((x) => x.ia <= 0.9 && x.shown && !x.bad), JSON.stringify(imgs.filter((x) => !(x.ia <= 0.9 && x.shown && !x.bad)).slice(0, 3)));
  T('no-landscape-image-inside-any-vertical-card', imgs.every((x) => !(x.ia > 1.05 && x.shown)));
  T('shows-without-portrait-get-title-cover-not-a-landscape-crop', phs.every((x) => x.title.length > 1), JSON.stringify(phs.slice(0, 2)));
  // حارس وقت التشغيل: لو حُمّلت صورة أفقية داخل بطاقة عمودية تُخفى ويظهر غلاف العنوان
  const guard = await p.evaluate(async () => { const c = await import('./components.js'); const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:150px'; host.innerHTML = c.poster({ id: 'x', title: 'اختبار', img3: 'data/posters/v2/' + (document.querySelector('#g img').getAttribute('src').split('/').pop()) }); document.body.append(host); const i = host.querySelector('img'); await new Promise((r) => (i.complete ? r() : i.addEventListener('load', r))); await new Promise((r) => setTimeout(r, 100)); const w = host.querySelector('.pw'); const out = { bad: w.classList.contains('bad'), hidden: getComputedStyle(i).display === 'none', title: getComputedStyle(host.querySelector('.ph-t')).display !== 'none' }; host.remove(); return out; });
  T('runtime-guard-hides-landscape-in-portrait-frame', guard.bad && guard.hidden && guard.title, JSON.stringify(guard));
  const urls = await p.evaluate(async () => { const c = await import('./components.js'); return [c.posterUrl({ img2: 'a', img: 'b', img4: 'c' }), c.posterUrl({ img3: 'p', img2: 'a' }), c.posterUrl({ img2: 'a', img4: 'c' }, true)]; });
  T('poster-url-never-falls-back-to-landscape', urls[0] === '' && /p$/.test(urls[1]) && /c$/.test(urls[2]), JSON.stringify(urls));
  // صفحة التفاصيل: مسلسل بانر فقط (مثال المستخدم) + مسلسل بخلفية سينمائية + بوستر عمودي
  const pick = (f) => real.shows.find(f);
  const banner = pick((s) => /هذا البحر سوف يفيض/.test(s.title)) || pick((s) => !s.img3 && !s.img4), land = pick((s) => s.img4), posterOnly = pick((s) => s.img3 && !s.img4);
  for (const [name, s] of [['banner-only', banner], ['cinematic-backdrop', land], ['poster-no-backdrop', posterOnly]]) {
    if (!s) { T('detail ' + name + ' sample exists', false); continue; }
    await p.goto(BASE + '#/show/' + encodeURIComponent(s.id)); await p.waitForSelector('.dh-art', { timeout: 10000 }); await p.waitForFunction(() => { const i = document.querySelector('.dh-art'); return i && i.complete && i.naturalWidth; }, null, { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(300);
    const d = await p.evaluate(() => { const i = document.querySelector('.dh-art'), r = i.getBoundingClientRect(), cs = getComputedStyle(i); return { src: i.getAttribute('src'), nw: i.naturalWidth, nh: i.naturalHeight, w: Math.round(r.width), h: Math.round(r.height), of: cs.objectFit, full: Math.round(r.width) === innerWidth, titleVisible: !!document.querySelector('.dh-body h2') && document.querySelector('.dh-body h2').getBoundingClientRect().bottom <= innerHeight && !!document.getElementById('fav') }; });
    const ratio = d.nw / d.nh;
    T(`detail ${name}: full-width landscape image, uncropped (contain), not stretched`, d.full && d.of === 'contain' && ratio > 1.5 && ratio < 2.1 && d.nw > 0, JSON.stringify(d));
    T(`detail ${name}: uses ${s.img4 ? 'cinematic backdrop' : 'source banner'} (not the portrait poster)`, d.src.includes(s.img4 || s.img2), d.src);
    T(`detail ${name}: title + buttons visible over gradient`, d.titleVisible);
  }
  T('no-page-errors-images', errs.length === 0, errs.join(' | ')); await ctx.close();
}
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
