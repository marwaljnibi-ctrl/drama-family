// قاعدة التصميم النهائية: كل صور المسلسلات بوسترات عمودية 2:3، ولا صور أفقية ولا بانرات ولا خلفيات ضبابية في أي واجهة.
// (1) فحص ثابت لمصدر الواجهة  (2) فحص بيانات: كل img3 عمودي فعلًا  (3) فحص حي على مقاسات iPhone لكل صفحات التطبيق.
// الاستخدام: BASE=http://localhost:8123/ node scripts/test-portrait-only.mjs
import { chromium } from 'playwright'; import { readFileSync, existsSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8123/'; const out = []; const T = (n, ok, d = '') => { out.push(!!ok); console.log('T', n, ok ? 'PASS' : 'FAIL', ok ? '' : d); };
// 1) ثابت: لا تسرب للصور الأفقية في كود الواجهة
const src = Object.fromEntries(['components.js', 'app.js', 'home.js', 'recommend.js'].map((f) => [f, existsSync(f) ? readFileSync(f, 'utf8') : '']));
const css = readFileSync('styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
for (const [f, s] of Object.entries(src)) { const code = s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); T(`static ${f}: no landscape fields (img2/img4/img/backdrop)`, !/\.(img2|img4|backdrop)\b|\bs\.img\b|show\.img\b|backdropUrl|heroArt|dh-art|pw-wide/.test(code), (code.match(/\.(img2|img4|backdrop)\b|backdropUrl|heroArt|dh-art|pw-wide/) || [])[0]); }
T('static css: no blur-fill / banner / landscape art rules', !/\.pw\.fit|m-banner|m-land|dh-art|hero-art|pw-wide|\.dhero::before/.test(css) && !/\.(pw|dhero|hero-c)[^{]*\{[^}]*(backdrop-filter|filter:\s*blur)/.test(css));
T('static css: poster frame is 2:3', /\.pw\{[^}]*aspect-ratio:2\/3/.test(css));
// 2) بيانات: كل img3 عمودي (0.55–0.9) والملف موجود
const data = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, '')); const map = JSON.parse(readFileSync('data/poster-map.json', 'utf8'));
const bad = Object.entries(map).filter(([, r]) => r.status === 'matched' && !(r.w && r.h && r.w / r.h >= 0.55 && r.w / r.h <= 0.9)).map(([k, r]) => k + ':' + (r.w / r.h).toFixed(2));
T('data: every matched poster in poster-map is portrait', bad.length === 0, bad.slice(0, 5).join(','));
T('data: shows.json carries no landscape field applied by the poster system', data.shows.every((s) => !s.img4));
// 3) حي: كل صورة مسلسل ظاهرة في أي صفحة = بوستر عمودي بإطار 2:3
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }); const sid = data.shows.find((s) => s.img3 && s.eps.length > 8), sid2 = data.shows.find((s) => s.img3 && s.id !== sid.id && s.eps.length > 8), noP = data.shows.find((s) => !s.img3);
const audit = async (p, label) => {
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const imgs = [...document.querySelectorAll('#view img')].filter((i) => i.getBoundingClientRect().width > 0 && !i.closest('.pw.bad'));
    const bad = []; let n = 0;
    for (const i of imgs) { if (!i.naturalWidth) continue; n++; const w = i.closest('.pw'); const rr = (w || i).getBoundingClientRect(), nr = i.naturalWidth / i.naturalHeight, fr = rr.width / rr.height, cs = getComputedStyle(i);
      if (!w) bad.push('img-outside-.pw ' + i.src.slice(-30)); else if (nr > 0.9) bad.push('landscape ' + nr.toFixed(2)); else if (Math.abs(fr - 2 / 3) > 0.025) bad.push('frame ' + fr.toFixed(2)); else if (cs.objectFit !== 'cover') bad.push('fit ' + cs.objectFit); }
    const bgs = [...document.querySelectorAll('#view *')].filter((e) => { const x = getComputedStyle(e); return /url\(/.test(x.backgroundImage) && !/url\(["']?data:/.test(x.backgroundImage) && !e.closest('svg'); }).length;   // أيقونات SVG المضمّنة (data:) مسموحة؛ أي رابط صورة غيرها ممنوع
    const fx = [...document.querySelectorAll('#view .pw, #view .dhero, #view .hero-c')].filter((e) => { const x = getComputedStyle(e); return x.filter !== 'none' || (x.backdropFilter && x.backdropFilter !== 'none'); }).length;
    const wide = [...document.querySelectorAll('#view .pw, #view .hero-c, #view .dhero')].filter((e) => e.getBoundingClientRect().width > innerWidth * 0.99).length;
    return { n, bad, bgs, fx, wide };
  });
  T(`${label}: only 2:3 portrait images (${r.n} checked)`, r.bad.length === 0, r.bad.slice(0, 3).join(' | '));
  T(`${label}: no background-image / blur / full-width banner`, r.bgs === 0 && r.fx === 0 && r.wide === 0, JSON.stringify(r));
};
for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
  for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
  await p.goto(BASE + '#/home'); await p.waitForSelector('#view .sec'); await audit(p, `${w}px home (latest hero)`);
  await p.evaluate(async ({ a, c, n }) => { const db = await import('./db.js'); let t = Date.now(); for (const s of [a, c, n].filter(Boolean)) await db.raw.putProgress({ key: s.id + '|' + s.eps[2].id, showId: s.id, epId: s.eps[2].id, epNum: s.eps[2].n, time: 900, duration: 2700, done: false, hidden: false, updated: t-- }); await db.favs.toggle(a.id); await db.favs.toggle(c.id); }, { a: sid, c: sid2, n: noP });
  await p.reload(); await p.waitForSelector('#view .sec'); await audit(p, `${w}px home (continue hero + rail + favourites)`);
  for (const [name, hash] of [['shows', '#/shows'], ['favs', '#/favs'], ['recent', '#/recent'], ['latest', '#/latest'], ['show', '#/show/' + encodeURIComponent(sid.id)], ['show-no-poster', noP ? '#/show/' + encodeURIComponent(noP.id) : '#/shows']]) { await p.goto(BASE + hash); await p.reload(); await p.waitForTimeout(500); await audit(p, `${w}px ${name}`); }
  T(`${w}px: no page errors`, errs.length === 0, errs.join(' | ')); await ctx.close();
}
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
