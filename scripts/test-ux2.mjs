// اقتراح «الحلقة التالية» (عند اقتراب النهاية فقط، بلا تشغيل تلقائي) + تذكّر المشغّل لكل مسلسل. السيرفران مُحاكيان ببروتوكول Userscript نفسه.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8123/'; const out = []; const T = (n, ok, d = '') => { out.push(!!ok); console.log('T', n, ok ? 'PASS' : 'FAIL', ok ? '' : d); };
// المحاكي يبدأ من START ويزيد ثانية كل 250ms؛ D = المدة (0 = غير معروفة)
const stub = (id, name, start, D) => `<!doctype html><meta charset=utf-8><script>
const id=${JSON.stringify(id)}; let cur=${start};
const tell=(type,extra)=>parent.postMessage(Object.assign({src:'dizi-resume-ext',type,id},extra),'*');
addEventListener('message',e=>{const x=e.data; if(x&&x.src==='dizi-resume-host'&&x.type==='seek'&&x.id===id&&x.t){cur=x.t; tell('restore');}});
tell('hello'); setInterval(()=>{cur+=1; tell('time',{t:cur,d:${D}});},250);
</script><body>${name}</body>`;
// 0) الهوية: ملفات SVG متجهية حقيقية (مسارات، لا صور PNG مضمّنة)، ومربوطة في الصفحة والـmanifest والكاش
import { readFileSync, existsSync } from 'node:fs';
for (const [f, min] of [['icons/dizi-icon.svg', 800], ['icons/dizi-icon-tile.svg', 800], ['icons/dizi-wordmark.svg', 5000]]) { const s = existsSync(f) ? readFileSync(f, 'utf8') : ''; T('brand ' + f + ' is a real vector (paths, no embedded raster)', s.startsWith('<svg') && /<path[^>]+ d="M/.test(s) && !/<image|data:image|base64/.test(s) && s.length > min, f + ' ' + s.length); }
{ const idx = readFileSync('index.html', 'utf8'), app = readFileSync('app.js', 'utf8'), sw = readFileSync('sw.js', 'utf8'), mf = readFileSync('manifest.webmanifest', 'utf8');
  T('brand: svg icon linked in head, wordmark svg in header, both precached, manifest lists svg + PNGs for iOS', idx.includes('type="image/svg+xml" href="icons/dizi-icon.svg"') && app.includes('icons/dizi-wordmark.svg') && sw.includes('icons/dizi-wordmark.svg') && sw.includes('icons/dizi-icon.svg') && mf.includes('dizi-icon.svg') && mf.includes('icon-512.png') && idx.includes('apple-touch-icon" sizes="180x180"')); }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
async function scene({ start, D, hosts = { a: 'a', o: 'o' } }, fn) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar' });
  for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
  const demo = JSON.parse(await (await fetch(BASE + 'data/demo.json')).text());
  for (const s of demo.shows) for (const e of s.eps) { e.sv = [['a', 'AAA'], ['o', 'OOO']]; delete e.v; }
  await ctx.route('**/data/demo.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demo) }));
  await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('AAA', 'arab', start, D) }));
  await ctx.route('https://ok.ru/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: stub('OOO', 'ok', start, D) }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  await fn(p, ctx); T('no page errors', errs.length === 0, errs.join('|')); await ctx.close();
}
const W = (s, n) => `${BASE}?demo=1#/watch/demo-${s}/demo-${s}-episode-${n}`;
const frameSrc = (p) => p.evaluate(() => (document.querySelector('#pl iframe') || {}).src || '');

// 1) قرب النهاية: يظهر الاقتراح، لا تشغيل تلقائي، يُغلق ولا يتكرر
await scene({ start: 2850, D: 3000 }, async (p) => {
  await p.goto(W('a', 5)); await p.waitForSelector('#pl iframe'); await p.waitForSelector('.nx', { timeout: 8000 });
  const t = await p.evaluate(() => document.querySelector('.nx').innerText);
  T('near end: suggestion shows next episode number (6)', /6/.test(t), t);
  await p.waitForTimeout(2500); T('no autoplay: still on the same episode', /demo-a-episode-5$/.test(await p.evaluate(() => location.hash)));
  T('suggestion has a link to the next episode', (await p.getAttribute('.nx a', 'href')) === '#/watch/demo-a/demo-a-episode-6');
  const bb = await p.locator('.nx .nx-x').boundingBox(); T('dismiss target >= 44px', bb && bb.width >= 44 && bb.height >= 44, JSON.stringify(bb));
  await p.click('.nx .nx-x'); await p.waitForTimeout(1200); T('dismissed: does not nag again', (await p.locator('.nx').count()) === 0);
  await p.reload(); await p.waitForSelector('#pl iframe'); await p.waitForTimeout(2500); T('once per episode per session (reload does not show it again)', (await p.locator('.nx').count()) === 0);
});
// 2) في منتصف الحلقة: لا يظهر
await scene({ start: 300, D: 3000 }, async (p) => { await p.goto(W('a', 5)); await p.waitForSelector('#pl iframe'); await p.waitForTimeout(3000); T('mid-episode: no suggestion', (await p.locator('.nx').count()) === 0); });
// 3) مدة غير معروفة: لا يظهر
await scene({ start: 2990, D: 0 }, async (p) => { await p.goto(W('a', 5)); await p.waitForSelector('#pl iframe'); await p.waitForTimeout(3000); T('unknown duration: no suggestion', (await p.locator('.nx').count()) === 0); });
// 4) آخر حلقة (لا تالية): لا يظهر
await scene({ start: 2850, D: 3000 }, async (p) => { await p.goto(W('a', 12)); await p.waitForSelector('#pl iframe'); await p.waitForTimeout(3000); T('no next episode: no suggestion', (await p.locator('.nx').count()) === 0); });
// 5) تذكّر المشغّل لكل مسلسل
await scene({ start: 100, D: 3000 }, async (p) => {
  await p.goto(W('a', 5)); await p.waitForSelector('#pl iframe'); const first = await frameSrc(p);
  T('default (no memory): first available server', /arabhd\.onl/.test(first), first);
  await p.click('#srv [data-k="o"]'); await p.waitForTimeout(1800);
  const mem = await p.evaluate(() => JSON.parse(localStorage.getItem('df-sv-show') || '{}'));
  T('successful server remembered for this show only', mem['demo-a'] === 'o' && !('demo-b' in mem), JSON.stringify(mem));
  await p.goto(W('a', 6)); await p.reload(); await p.waitForSelector('#pl iframe'); T('another episode of the same show opens on the remembered server', /ok\.ru/.test(await frameSrc(p)), await frameSrc(p));
  await p.goto(W('b', 3)); await p.reload(); await p.waitForSelector('#pl iframe'); T('a show with no memory of its own falls back to the last server that worked anywhere (OK) and gets no entry yet', /ok\.ru/.test(await frameSrc(p)) && !('demo-b' in (await p.evaluate(() => JSON.parse(localStorage.getItem('df-sv-show') || '{}')))), await frameSrc(p));
  await p.goto(W('a', 6)); await p.reload(); await p.waitForSelector('#pl iframe'); await p.click('#srv [data-k="a"]'); await p.waitForTimeout(500);
  T('server can be changed at any time', /arabhd\.onl/.test(await frameSrc(p)));
  await p.waitForTimeout(1500); const mem2 = await p.evaluate(() => JSON.parse(localStorage.getItem('df-sv-show') || '{}')); T('new successful choice replaces the memory', mem2['demo-a'] === 'a', JSON.stringify(mem2));
  await p.evaluate(() => localStorage.setItem('df-sv-show', '{bad json')); await p.goto(W('a', 7)); await p.reload(); await p.waitForSelector('#pl iframe'); T('corrupt memory is ignored safely', /arabhd\.onl|ok\.ru/.test(await frameSrc(p)));
});
// 6) أخطاء هادئة: المشغّل لا يحمّل (سيرفر واحد فقط) -> رسالة عربية وزر إعادة تحميل يعمل
{ const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'ar' });
  for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
  const demo = JSON.parse(await (await fetch(BASE + 'data/demo.json')).text()); for (const s of demo.shows) for (const e of s.eps) { e.sv = [['a', 'AAA']]; delete e.v; }
  await ctx.route('**/data/demo.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demo) }));
  let hits = 0, hang = true; await ctx.route('https://arabhd.onl/**', (r) => { hits++; if (hang) return; r.fulfill({ status: 200, contentType: 'text/html', body: stub('AAA', 'arab', 10, 3000) }); });
  const p = await ctx.newPage(); await p.goto(W('a', 5)); await p.waitForSelector('#pl iframe'); await p.waitForSelector('#retry-pl', { timeout: 20000 });
  const txt = await p.evaluate(() => document.getElementById('msg').innerText); T('slow player: calm Arabic message with retry (single server)', /تأخر تحميل/.test(txt) && /[؀-ۿ]/.test(txt) && !/undefined|Error|http/i.test(txt), txt);
  hang = false; const h0 = hits; await p.click('#retry-pl'); await p.waitForTimeout(1500); T('retry reloads the player and clears the message', hits > h0 && (await p.locator('#retry-pl').count()) === 0);
  await ctx.close(); }
// 7) فشل تحميل القائمة: رسالة + زر يعيد المحاولة ويعمل بعد عودة الاتصال
{ const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'ar', serviceWorkers: 'block' });
  for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
  let down = true; await ctx.route('**/data/shows.json*', (r) => (down ? r.abort() : r.continue()));
  const p = await ctx.newPage(); await p.goto(BASE + '#/shows'); await p.waitForSelector('#retry-data', { timeout: 15000 });
  T('list load failure: calm message + retry button', /تعذّر تحميل قائمة المسلسلات/.test(await p.evaluate(() => document.getElementById('view').innerText)));
  down = false; await p.click('#retry-data'); await p.waitForSelector('#g .card', { timeout: 15000 }); T('retry works after connection returns', (await p.locator('#g .card').count()) > 0);
  await ctx.close(); }
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
