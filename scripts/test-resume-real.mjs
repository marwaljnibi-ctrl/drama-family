// اختبار تكامل حقيقي للاستكمال بين المشغلات: نُشغّل سكربتي Userscripts الفعليين (Arab HD وOK) داخل صفحتي مشغّل محاكاتين بعنصر video مُحاكى،
// وDizi الحقيقي كأصل pages.dev. نتحقق أن من يتوقف في مشغّل يكمل في الآخر من آخر نقطة (وفي الاتجاهين، وبعد إعادة تحميل الصفحة، ومع اختلاف مدة الفيديو).
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8123/'; const REAL = process.env.REAL_ORIGIN;   // REAL_ORIGIN: نفحص موقعًا منشورًا فعليًا (الإنتاج/المعاينة) بدل خادم محلي
const ORIGIN = REAL || 'https://dizi-test.pages.dev/';
const out = []; const T = (n, ok, d = '') => { out.push(ok); console.log('T', n, ok ? 'PASS' : 'FAIL', d); };
const AR = readFileSync('extension/userscripts/dizi-arabhd-resume.user.js', 'utf8'), OK = readFileSync('extension/userscripts/dizi-ok-resume.user.js', 'utf8');
const SHOW = 'demo-a', EP = 'demo-a-episode-12', KEY = SHOW + '|' + EP;
const stub = (dur, start = 5) => `<!doctype html><meta charset=utf-8><body style="background:#000"><video id=v></video><script>
const v=document.getElementById('v'); let cur=${start}, dur=${dur};
Object.defineProperty(v,'duration',{get:()=>dur}); Object.defineProperty(v,'currentTime',{get:()=>cur,set:(x)=>{cur=+x; setTimeout(()=>v.dispatchEvent(new Event('seeked')),40)}});
setTimeout(()=>{v.dispatchEvent(new Event('loadedmetadata'));v.dispatchEvent(new Event('playing'))},300);
setInterval(()=>{cur+=1; v.dispatchEvent(new Event('timeupdate'))},250); window.__cur=()=>cur;
</script></body>`;
const GM = () => { window.GM = { getValue: async (k, d) => { try { const v = localStorage.getItem('GM_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, setValue: async (k, v) => { try { localStorage.setItem('GM_' + k, JSON.stringify(v)); } catch {} } }; };

async function setup(b, { arabDur = 2700, okDur = 2640, user = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const demo = JSON.parse(await (await fetch((REAL || BASE) + 'data/demo.json')).text()); const ep = demo.shows.find((s) => s.id === SHOW).eps.find((e) => e.id === EP); ep.sv = [['a', 'AAA'], ['o', '777']]; delete ep.v;
  await ctx.route(ORIGIN + '**', async (r) => { const path0 = new URL(r.request().url()).pathname; if (REAL && !path0.endsWith('data/demo.json')) return r.continue(); const path = path0.replace(/^\//, ''); if (path.endsWith('data/demo.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demo) }); const x = await fetch(BASE + path); const ct = x.headers.get('content-type') || 'text/plain'; return r.fulfill({ status: x.status, contentType: ct, body: Buffer.from(await x.arrayBuffer()) }); });
  await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub(arabDur) }));
  await ctx.route('https://ok.ru/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub(okDur) }));
  if (user) { const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' }; await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: H }); const q = new URL(r.request().url()).pathname; return r.fulfill({ status: 200, headers: H, body: q === '/api/sync' ? '{"favs":[],"progress":[]}' : JSON.stringify({ name: 'م', email: 'a@x.com', wa: { prompt: 'no', phone: null, verified: false, consent: false }, shows: [] }) }); }); await ctx.addInitScript(() => { localStorage.setItem('df-session', 'c'.repeat(64)); localStorage.setItem('df-uid', 'g_55'); localStorage.setItem('df-import:g_55', '0'); localStorage.setItem('df-fav-nudge', '1'); }); }
  else await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  p.on('frameattached', (f) => { const tryInject = async () => { await new Promise((r) => setTimeout(r, 120)); const u = f.url(); const src = /arabhd\.onl/.test(u) ? AR : /ok\.ru/.test(u) ? OK : null; if (!src) return; try { await f.evaluate(GM); await f.addScriptTag({ content: src }); } catch {} }; f.page().on('framenavigated', (fr) => { if (fr === f) tryInject(); }); });
  return { ctx, p, errs };
}
const cur = (p, host) => { const f = p.frames().find((x) => x.url().includes(host)); return f ? f.evaluate(() => window.__cur()).catch(() => -1) : -1; };
const prog = (p) => p.evaluate(async () => { const db = await import('./db.js'); const r = await db.progress.get('demo-a', 'demo-a-episode-12'); return r ? { t: Math.round(r.time), d: Math.round(r.duration), done: r.done } : null; });
const open = async (p) => { await p.goto(ORIGIN + `?demo=1#/watch/${SHOW}/${EP}`); await p.waitForSelector('#srv [data-k="a"]', { timeout: 15000 }); };

const b = await chromium.launch();
{ // Arab HD ← → OK بسكربتات حقيقية
  const { ctx, p, errs } = await setup(b);
  await open(p); await p.click('#srv [data-k="a"]'); await p.waitForTimeout(9000);
  const a1 = await cur(p, 'arabhd.onl'), s1 = await prog(p);
  T('arabhd: real userscript reports time and Dizi saves it', s1 && s1.t > 20 && s1.d === 2700, JSON.stringify({ a1, s1 }));
  await p.click('#srv [data-k="o"]'); await p.waitForTimeout(6000);
  const o1 = await cur(p, 'ok.ru'), s2 = await prog(p);
  T('arab → ok: OK continues from the last point (not from the start)', o1 >= s1.t - 3 && o1 > 20, JSON.stringify({ stoppedAt: s1.t, okNow: o1, saved: s2 }));
  T('arab → ok: saved progress never dropped', s2 && s2.t >= s1.t - 1, JSON.stringify(s2));
  await p.waitForTimeout(4000); await p.click('#srv [data-k="a"]'); await p.waitForTimeout(6000);
  const s3 = await prog(p), a2 = await cur(p, 'arabhd.onl');
  T('ok → arab: Arab HD continues from the last point', a2 >= s2.t - 3 && a2 > s1.t, JSON.stringify({ before: s2.t, arabNow: a2, saved: s3 }));
  T('no page errors (switching)', errs.length === 0, errs.join(' | ')); await ctx.close();
}
{ // بعد إعادة تحميل الصفحة بين المشغلين
  const { ctx, p } = await setup(b);
  await open(p); await p.click('#srv [data-k="a"]'); await p.waitForTimeout(8000); const s1 = await prog(p);
  await p.reload(); await p.waitForSelector('#srv [data-k="o"]'); await p.click('#srv [data-k="o"]'); await p.waitForTimeout(6000);
  const o1 = await cur(p, 'ok.ru'), s2 = await prog(p);
  T('reload between players: OK continues from the Arab HD point', o1 >= s1.t - 3 && o1 > 15 && s2.t >= s1.t - 1, JSON.stringify({ arabStopped: s1.t, okNow: o1, saved: s2.t })); await ctx.close();
}
{ // أول مشغّل OK ثم Arab HD، ومدتان مختلفتان بأكثر من 90 ث (تحويل نسبي)
  const { ctx, p } = await setup(b, { arabDur: 2700, okDur: 2400 });
  await open(p); await p.click('#srv [data-k="o"]'); await p.waitForTimeout(8000); const s1 = await prog(p);
  await p.click('#srv [data-k="a"]'); await p.waitForTimeout(6000); const a1 = await cur(p, 'arabhd.onl'), s2 = await prog(p);
  const expected = s1.t * 2700 / 2400;
  T('different durations: position is mapped proportionally', Math.abs(a1 - expected) < 25 && s2.d === 2700, JSON.stringify({ okStopped: s1.t, expected: Math.round(expected), arabNow: a1, saved: s2 })); await ctx.close();
}
{ // تقدم محفوظ سابقًا (جلسة سابقة) ثم فتح الحلقة على مشغّل آخر
  const { ctx, p } = await setup(b);
  await p.goto(ORIGIN + '?demo=1#/home'); await p.waitForSelector('#view .sec');
  await p.evaluate(async () => { const db = await import('./db.js'); await db.raw.putProgress({ key: 'demo-a|demo-a-episode-12', showId: 'demo-a', epId: 'demo-a-episode-12', epNum: 12, time: 1500, duration: 2700, done: false, hidden: false, updated: Date.now() - 3 * 3600e3 }); });
  await open(p); await p.click('#srv [data-k="o"]'); await p.waitForTimeout(6000); const o1 = await cur(p, 'ok.ru');
  T('saved earlier (hours ago): OK opens at the saved minute', o1 >= 1495, String(o1)); await p.click('#srv [data-k="a"]'); await p.waitForTimeout(6000); const a1 = await cur(p, 'arabhd.onl');
  T('then Arab HD opens at the same or later minute', a1 >= 1495, String(a1)); await ctx.close();
}
{ // مستخدم مسجّل (مزامنة سحابية مُحاكاة) نفس السيناريو
  const { ctx, p } = await setup(b, { user: true });
  await open(p); await p.click('#srv [data-k="a"]'); await p.waitForTimeout(9000);
  const dbn = () => p.evaluate(async () => { const db = await import('./db.js'); const r = await db.progress.get('demo-a', 'demo-a-episode-12'); return r ? Math.round(r.time) : null; });
  const s1 = await dbn(); await p.click('#srv [data-k="o"]'); await p.waitForTimeout(6000); const o1 = await cur(p, 'ok.ru'); const s2 = await dbn();
  T('logged-in user: arab → ok continues from the last point', s1 > 20 && o1 >= s1 - 3 && s2 >= s1 - 1, JSON.stringify({ arabStopped: s1, okNow: o1, saved: s2 }));
  await p.waitForTimeout(3000); await p.click('#srv [data-k="a"]'); await p.waitForTimeout(6000); const a2 = await cur(p, 'arabhd.onl');
  T('logged-in user: ok → arab continues from the last point', a2 >= s2 - 3, JSON.stringify({ before: s2, arabNow: a2 })); await ctx.close();
}
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
