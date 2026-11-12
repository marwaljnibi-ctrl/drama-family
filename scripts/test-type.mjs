// اختبار الخطوط والأرقام: خط النظام فقط (لا Google Fonts)، لا أرقام هندية/فارسية في أي نص معروض، RTL سليم، ولا تضخم لارتفاع البطاقات.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8123/';
const out = []; const T = (n, ok, d = '') => { out.push(ok); console.log('T', n, ok ? 'PASS' : 'FAIL', d); };
const data = await (await fetch(BASE + 'data/shows.json')).json();
const sh = data.shows.find((s) => (s.img2 || s.img) && s.eps.length > 5);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const external = []; ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !/dizi-alerts|accounts\.google|arabhd|ok\.ru/.test(u)) external.push(u); });
await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', (r) => r.abort()); await ctx.route('https://accounts.google.com/**', (r) => r.abort()); await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<body style=background:#000>' }));
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 90)));
await p.goto(BASE + '#/home'); await p.waitForSelector('#view .sec, #view .empty-card');
// بيانات فيها أرقام هندية وفارسية في العنوان لاختبار التوحيد (تُحقن في الذاكرة فقط)
await p.evaluate(async ({ id, ep }) => { const db = await import('./db.js'); await db.raw.putProgress({ key: id + '|' + ep.id, showId: id, epId: ep.id, epNum: ep.n, time: 1250, duration: 2700, done: false, hidden: false, updated: Date.now() }); await db.raw.putFav({ showId: id, at: Date.now() }); }, { id: sh.id, ep: { id: sh.eps[2].id, n: sh.eps[2].n } });
const AR = /[\u0660-\u0669\u06F0-\u06F9]/;
const pages = [['home', '#/home'], ['shows', '#/shows'], ['show', '#/show/' + encodeURIComponent(sh.id)], ['watch', `#/watch/${encodeURIComponent(sh.id)}/${encodeURIComponent(sh.eps[2].id)}`], ['favs', '#/favs'], ['recent', '#/recent'], ['latest', '#/latest'], ['account', '#/alerts']];
for (const [name, hash] of pages) {
  await p.goto(BASE + hash); await p.reload(); await p.waitForTimeout(1000);
  if (name === 'show') await p.evaluate(() => { const t = document.querySelector('.hero h2'); if (t) t.textContent = t.textContent + ' ٣٤ ۵۶'; });   // يجب أن تُحوَّل فورًا
  await p.waitForTimeout(150);
  const m = await p.evaluate(() => ({ text: document.body.innerText, fam: getComputedStyle(document.body).fontFamily, dir: getComputedStyle(document.body).direction }));
  T(`${name}: no Arabic-Indic/Persian digits shown`, !AR.test(m.text), (m.text.match(AR) || [''])[0]);
  if (name === 'home') { T('font stack is Apple system (no Tajawal/Google Fonts)', /-apple-system/.test(m.fam) && !/Tajawal/.test(m.fam), m.fam.slice(0, 80)); T('direction stays RTL', m.dir === 'rtl'); }
}
T('no external font/CSS requests', !external.some((u) => /fonts\.g|gstatic/.test(u)), external.slice(0, 3).join(' '));
// الأرقام الظاهرة فعلًا لاتينية (حلقة، وقت، نسبة)
await p.goto(BASE + '#/recent'); await p.reload(); await p.waitForTimeout(900);
const t = await p.evaluate(() => document.querySelector('.row small') && document.querySelector('.row small').textContent);
T('episode + time shown with 0-9', /\d/.test(t || '') && !AR.test(t || ''), t);
// ارتفاع البطاقات متساوٍ في الصف (لا يتغير بالخط) وعدم الخروج من الشاشة
await p.goto(BASE + '#/shows'); await p.waitForSelector('#g .card'); await p.waitForTimeout(500);
const g = await p.evaluate(() => { const c = [...document.querySelectorAll('#g .card')].slice(0, 8).map((x) => Math.round(x.getBoundingClientRect().height)); return { h: c, over: document.documentElement.scrollWidth - innerWidth }; });
T('card heights consistent', new Set(g.h).size <= 2, g.h.join(',')); T('no horizontal overflow', g.over <= 1, String(g.over));
T('no page errors', errs.length === 0, errs.join(' | '));
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
