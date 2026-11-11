// اختبار انحدار: الاستكمال الموحّد عند تبديل السيرفر (Arab HD <-> OK) للضيف وللمسجّل (مع مزامنة سحابية مُحاكاة).
// السيرفران مُحاكيان بصفحات تتكلم بروتوكول Userscript نفسه (hello / restore / time ← seek) على الأصلين الحقيقيين arabhd.onl وok.ru.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8123/';
const out = []; const T = (n, ok, d = '') => { out.push(ok); console.log('T', n, ok ? 'PASS' : 'FAIL', d); };
const SHOW = 'demo-a', EP = 'demo-a-episode-12', KEY = SHOW + '|' + EP;

const stub = (id, name) => `<!doctype html><meta charset=utf-8><script>
const id=${JSON.stringify(id)}; window.cur=5; window.got=[]; let restored=false;
addEventListener('message',e=>{const x=e.data; if(x&&x.src==='dizi-resume-host'&&x.type==='seek'&&x.id===id){window.got.push(x.t); if(x.t){window.cur=x.t; restored=true; parent.postMessage({src:'dizi-resume-ext',type:'restore',id},'*');}}});
const tell=(type,extra)=>parent.postMessage(Object.assign({src:'dizi-resume-ext',type,id},extra),'*');
tell('hello'); setInterval(()=>{window.cur+=1; tell('time',{t:window.cur,d:3000});},250);
</script><body>${name}</body>`;

async function scenario(b, { loggedIn }) {
  const label = loggedIn ? 'user' : 'guest';
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const demo = JSON.parse(await (await fetch(BASE + 'data/demo.json')).text());
  const ep = demo.shows.find((s) => s.id === SHOW).eps.find((e) => e.id === EP); ep.sv = [['a', 'AAA'], ['o', 'OOO']]; delete ep.v;
  await ctx.route('**/data/demo.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demo) }));
  await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('AAA', 'arab') }));
  await ctx.route('https://ok.ru/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('OOO', 'ok') }));
  const SV = { progress: [], pushes: [] };
  await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', async (rt) => {
    const rq = rt.request(); const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' };
    if (rq.method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: H });
    const p = new URL(rq.url()).pathname, bd = rq.postDataJSON() || {};
    if (p === '/api/sync') return rt.fulfill({ status: 200, headers: H, body: JSON.stringify({ favs: [], progress: SV.progress }) });
    if (p === '/api/progress') SV.pushes.push(...(bd.items || []));
    return rt.fulfill({ status: 200, headers: H, body: JSON.stringify({ name: 'علي', email: 'a@x.com', wa: { prompt: 'no', phone: null, verified: false, consent: false }, shows: [] }) });
  });
  if (loggedIn) {   // تقدم قديم على السحابة (أقدم ودقيقة أقل) يجب ألا يطغى على المحلي الأحدث
    SV.progress = [{ key: KEY, showId: SHOW, epId: EP, epNum: 12, time: 100, duration: 3000, done: false, hidden: false, updated: 1000 }];
    await ctx.addInitScript(() => { localStorage.setItem('df-session', 'd'.repeat(64)); localStorage.setItem('df-uid', 'g_77'); localStorage.setItem('df-import:g_77', '0'); });
  }
  const dbName = loggedIn ? 'dizi-u-g_77' : 'drama-family';
  const readProg = () => page.evaluate((n) => new Promise((res) => { const q = indexedDB.open(n); q.onsuccess = () => { const d = q.result; if (!d.objectStoreNames.contains('progress')) { d.close(); return res(null); } d.transaction('progress').objectStore('progress').get('demo-a|demo-a-episode-12').onsuccess = (e) => { d.close(); res(e.target.result || null); }; }; }), dbName);
  const frameOf = (host) => page.frames().find((f) => f.url().startsWith(host));
  const frameGot = (host) => frameOf(host) ? frameOf(host).evaluate(() => window.got.slice()).catch(() => []) : [];

  await page.goto(BASE + '?demo=1#/home'); await page.waitForSelector('#view .sec');
  // تقدم محلي سابق: الدقيقة 600 (محدّث الآن)
  await page.evaluate(async ({ n }) => { const db = await import('./db.js'); db.setDbName(n); await db.raw.putProgress({ key: 'demo-a|demo-a-episode-12', showId: 'demo-a', epId: 'demo-a-episode-12', epNum: 12, time: 600, duration: 3000, done: false, hidden: false, updated: Date.now() }); }, { n: dbName }).catch(() => {});
  if (!loggedIn) { /* الضيف يستعمل drama-family مباشرة */ }
  await page.goto(BASE + `?demo=1#/watch/${SHOW}/${EP}`); await page.reload(); await page.waitForSelector('#srv [data-k="a"]', { timeout: 10000 });
  const times = []; const sample = async () => { const r = await readProg(); if (r) times.push(Math.round(r.time)); return r; };
  // 1) Arab HD: يستعيد 600
  await page.click('#srv [data-k="a"]'); await page.waitForTimeout(2500); let r = await sample();
  const gotA = await frameGot('https://arabhd.onl');
  T(label + ': arabhd-receives-saved-minute', gotA.length >= 1 && Math.abs(gotA[0] - 600) < 3, JSON.stringify(gotA));
  T(label + ': arabhd-progress-continues-from-600', r && r.time >= 600, String(r && r.time));
  // 2) تبديل Arab HD -> OK: يستكمل من آخر دقيقة
  const beforeSwitch = (await readProg()).time;
  await page.click('#srv [data-k="o"]'); await page.waitForTimeout(2500); r = await sample();
  const gotO = await frameGot('https://ok.ru');
  T(label + ': arab-to-ok-seeks-last-minute', gotO.length >= 1 && gotO[0] >= beforeSwitch - 2 && gotO[0] >= 600, JSON.stringify(gotO) + ' before=' + beforeSwitch);
  T(label + ': arab-to-ok-progress-not-reset', r && r.time >= beforeSwitch, JSON.stringify({ now: r && r.time, beforeSwitch }));
  // 3) سحب سحابي أثناء المشاهدة (عودة للتطبيق) لا يخفض التقدم
  if (loggedIn) { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(1500); }
  const mid = (await readProg()).time;
  // 4) تبديل OK -> Arab HD
  await page.click('#srv [data-k="a"]'); await page.waitForTimeout(2500); r = await sample();
  const gotA2 = await frameGot('https://arabhd.onl');
  T(label + ': ok-to-arab-seeks-last-minute', gotA2.length >= 1 && gotA2[0] >= mid - 2 && gotA2[0] >= 600, JSON.stringify(gotA2) + ' mid=' + mid);
  T(label + ': ok-to-arab-progress-not-reset', r && r.time >= mid, JSON.stringify({ now: r && r.time, mid }));
  T(label + ': progress-never-dropped-below-600', times.every((x) => x >= 600), times.join(','));
  if (loggedIn) {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(1200);
    T(label + ': old-cloud-record-did-not-replace-local', r.time >= 600 && !SV.pushes.some((x) => x.key === KEY && x.time < 600), JSON.stringify(SV.pushes.slice(-2)));
  }
  // 5) رجوع متعمد إلى دقيقة سابقة ما زال ممكنًا (نفس الجلسة)
  const dropped = await page.evaluate(async () => { const db = await import('./db.js'); const ep = { id: 'demo-a-episode-12', n: 12 }; const cur = await db.progress.get('demo-a', ep.id); await db.progress.save('demo-a', ep, { time: 120, duration: 3000 }); return (await db.progress.get('demo-a', ep.id)).time; });
  T(label + ': deliberate-rewind-still-allowed', Math.abs(dropped - 120) < 1, String(dropped));
  T(label + ': no-page-errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// سيناريو جهاز جديد/قاعدة فارغة: التقدم على السحابة فقط (دقيقة 600). فتح الحلقة لا يجوز أن يكتب سجلًا فارغًا «أحدث» يطغى على السحابة.
async function crossDevice(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const demo = JSON.parse(await (await fetch(BASE + 'data/demo.json')).text());
  const ep = demo.shows.find((s) => s.id === SHOW).eps.find((e) => e.id === EP); ep.sv = [['a', 'AAA'], ['o', 'OOO']]; delete ep.v;
  await ctx.route('**/data/demo.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demo) }));
  await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('AAA', 'arab') }));
  await ctx.route('https://ok.ru/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('OOO', 'ok') }));
  const SV = { progress: [{ key: KEY, showId: SHOW, epId: EP, epNum: 12, time: 600, duration: 3000, done: false, hidden: false, updated: 1000 }], pushes: [] };
  await ctx.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', async (rt) => {
    const rq = rt.request(); const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' };
    if (rq.method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: H });
    const p = new URL(rq.url()).pathname, bd = rq.postDataJSON() || {};
    if (p === '/api/sync') { await new Promise((r) => setTimeout(r, 600)); return rt.fulfill({ status: 200, headers: H, body: JSON.stringify({ favs: [], progress: SV.progress }) }); }   // رد بطيء كالشبكة الضعيفة
    if (p === '/api/progress') { SV.pushes.push(...(bd.items || [])); for (const x of bd.items || []) { const c = SV.progress.find((q) => q.key === x.key); if (!c || x.updated > c.updated) SV.progress = [x]; } }
    return rt.fulfill({ status: 200, headers: H, body: JSON.stringify({ name: 'علي', email: 'a@x.com', wa: { prompt: 'no', phone: null, verified: false, consent: false }, shows: [] }) });
  });
  await ctx.addInitScript(() => { localStorage.setItem('df-session', 'e'.repeat(64)); localStorage.setItem('df-uid', 'g_88'); localStorage.setItem('df-import:g_88', '0'); });
  await page.goto(BASE + `?demo=1#/watch/${SHOW}/${EP}`); await page.waitForSelector('#srv [data-k="a"]', { timeout: 10000 });
  await page.click('#srv [data-k="a"]'); await page.waitForTimeout(3500);
  const got = await page.frames().find((f) => f.url().startsWith('https://arabhd.onl')).evaluate(() => window.got.slice());
  await page.waitForTimeout(1500); await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(1200);
  T('cross-device: opening-episode-restores-cloud-minute', got.some((x) => x && Math.abs(x - 600) < 3) || (got.length && got[got.length - 1] >= 590), JSON.stringify(got));
  T('cross-device: empty-placeholder-never-pushed-over-cloud', !SV.pushes.some((x) => x.key === KEY && !(x.time > 0)), JSON.stringify(SV.pushes.slice(0, 2)));
  T('cross-device: cloud-minute-never-lowered', SV.progress[0].time >= 600, String(SV.progress[0].time));
  T('cross-device: no-page-errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
await scenario(b, { loggedIn: false }); await scenario(b, { loggedIn: true });
await crossDevice(b);
await b.close();
console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
