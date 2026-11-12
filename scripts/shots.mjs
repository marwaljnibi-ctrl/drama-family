// لقطات شاشة لمقارنة التصميم (قبل/بعد) بمقاسات iPhone، ببيانات الفهرس الحقيقية المحلية وبيانات مُبذَّرة (مفضلة/تقدم) وسيرفرات مُحاكاة.
// الاستخدام: BASE=http://localhost:8124/ node scripts/shots.mjs <label> <outDir>   (يتطلب playwright)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8124/';
const [label = 'shot', OUT = 'docs/design'] = process.argv.slice(2);
const DIR = `${OUT}/${label}`; mkdirSync(DIR, { recursive: true });
const SIZES = { se: [375, 667], i15: [390, 844], max: [430, 932] };
const data = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, ''));
const good = data.shows.filter((s) => (s.img2 || s.img) && s.eps.length >= 5);
const pick = good.slice(0, 14);
const now = Date.now();
const stub = (t) => `<!doctype html><meta charset=utf-8><body style="margin:0;background:#0b0b0d;color:#777;font:14px system-ui;display:flex;align-items:center;justify-content:center;height:100vh">${t}</body>`;

async function newPage(b, [w, h], { user = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'ar' });
  await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('Arab HD') }));
  await ctx.route('https://ok.ru/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('OK') }));
  await ctx.route('https://accounts.google.com/**', (r) => r.abort());
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());   // بلا إنترنت خارجي في اللقطات؛ الخط من النظام/المحلي
  await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', (r) => {
    const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: H });
    const p = new URL(r.request().url()).pathname;
    if (p === '/api/sync') return r.fulfill({ status: 200, headers: H, body: '{"favs":[],"progress":[]}' });
    return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ name: 'مروى', email: 'marwa@example.com', wa: { prompt: 'yes', phone: '+971•••••446', verified: true, consent: true }, shows: [{ showId: pick[0].id, title: pick[0].title }, { showId: pick[2].id, title: pick[2].title }] }) });
  });
  if (user) await ctx.addInitScript(() => { localStorage.setItem('df-session', 'f'.repeat(64)); localStorage.setItem('df-uid', 'g_shot'); localStorage.setItem('df-import:g_shot', '0'); localStorage.setItem('df-fav-nudge', '1'); });
  const page = await ctx.newPage(); return { ctx, page };
}
async function seed(page) {
  await page.goto(BASE + '#/home'); await page.waitForSelector('#view .sec, #view .empty-card, #view .grid', { timeout: 20000 });
  await page.evaluate(async ({ pick, now }) => {
    const db = await import('./db.js');
    for (const [i, s] of pick.slice(0, 7).entries()) await db.raw.putFav({ showId: s.id, at: now - i * 1000 });
    const prog = [[0, 3, 1250, 2700], [1, 2, 640, 2640], [2, 4, 2100, 2700], [3, 1, 300, 2600]];
    for (const [i, ep, t, d] of prog) { const s = pick[i], e = s.eps[Math.min(ep, s.eps.length - 1)]; await db.raw.putProgress({ key: s.id + '|' + e.id, showId: s.id, epId: e.id, epNum: e.n, time: t, duration: d, done: false, hidden: false, updated: now - i * 60000 }); }
    const s4 = pick[4], e4 = s4.eps[1]; await db.raw.putProgress({ key: s4.id + '|' + e4.id, showId: s4.id, epId: e4.id, epNum: e4.n, time: 2650, duration: 2700, done: true, hidden: false, updated: now - 5 * 60000 });
  }, { pick: pick.map((s) => ({ id: s.id, eps: s.eps.map((e) => ({ id: e.id, n: e.n })) })), now });
}
const shot = async (page, name, o = {}) => { await page.waitForTimeout(o.wait ?? 900); await page.screenshot({ path: `${DIR}/${name}.jpg`, type: 'jpeg', quality: 84, fullPage: !!o.full }); console.log('shot', name); };

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const [sz, dims] of Object.entries(SIZES)) {
  const { ctx, page } = await newPage(b, dims); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  await seed(page);
  await page.goto(BASE + '#/home'); await page.reload(); await page.waitForSelector('#view .sec'); await shot(page, `${sz}-home`, { wait: 1800 });
  if (sz === 'i15') await shot(page, `${sz}-home-full`, { full: true, wait: 600 });
  const sid = pick[0].id, ep = pick[0].eps[3];
  await page.goto(BASE + '#/show/' + encodeURIComponent(sid)); await page.waitForSelector('.eps'); await shot(page, `${sz}-show`, { wait: 1500 });
  if (sz === 'i15') {
    await page.goto(BASE + '#/shows'); await page.waitForSelector('#g .card'); await shot(page, `${sz}-shows`, { wait: 1800 });
    await page.goto(BASE + '#/favs'); await page.waitForSelector('.grid .card'); await shot(page, `${sz}-favs`, { wait: 1500 });
    await page.goto(BASE + '#/recent'); await page.waitForSelector('.list .row'); await shot(page, `${sz}-recent`, { wait: 1500 });
    await page.goto(BASE + '#/latest'); await page.waitForTimeout(600); await shot(page, `${sz}-latest`, { wait: 1200 });
    const s2 = pick[1], e2 = s2.eps[2];
    const withSv = { ...s2 };
    await page.goto(BASE + `#/watch/${encodeURIComponent(s2.id)}/${encodeURIComponent(e2.id)}`); await page.waitForSelector('#pl'); await shot(page, `${sz}-watch`, { wait: 1500 });
    await page.goto(BASE + '#/alerts'); await page.waitForSelector('#guest-card'); await shot(page, `${sz}-account-guest`, { wait: 800 });
  }
  await ctx.close();
  if (sz === 'i15') {
    const u = await newPage(b, dims, { user: true }); await seed(u.page);
    await u.page.goto(BASE + '#/alerts'); await u.page.reload(); await u.page.waitForSelector('#al-stop', { timeout: 8000 }); await shot(u.page, `${sz}-account-user`, { wait: 800 });
    await u.ctx.close();
  }
  if (errs.length) console.log('pageerrors', errs.join(' | '));
}
await b.close();
