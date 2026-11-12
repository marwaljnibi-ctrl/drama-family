// «آخر المشاهدات»: إزالة بالسحب الأفقي (لمس حقيقي عبر CDP) أو بزر «إزالة»، بتأكيد، دون حذف التقدم/المفضلة، ودون تعارض مع التمرير العمودي والضغط.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8123/'; const out = []; const T = (n, ok, d = '') => { out.push(!!ok); console.log('T', n, ok ? 'PASS' : 'FAIL', ok ? '' : d); };
const data = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^\uFEFF/, '')); const L = data.shows.filter((x) => x.eps.length > 4).slice(0, 4);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
for (const [w, h] of [[320, 568], [390, 844], [430, 932]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
  for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 80))); const cdp = await ctx.newCDPSession(p);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (x0, y0, x1, y1) => { await touch('touchStart', x0, y0); for (let i = 1; i <= 8; i++) { await touch('touchMove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await p.waitForTimeout(16); } await touch('touchEnd'); await p.waitForTimeout(350); };
  await p.goto(BASE + '#/home'); await p.waitForSelector('#view .sec');
  await p.evaluate(async (l) => { const db = await import('./db.js'); let t = Date.now(); for (const s of l) { await db.raw.putProgress({ key: s.id + '|' + s.eps[2].id, showId: s.id, epId: s.eps[2].id, epNum: s.eps[2].n, time: 900, duration: 2700, done: false, hidden: false, updated: t-- }); } await db.favs.toggle(l[0].id); }, L.map((s) => ({ id: s.id, eps: [s.eps[0], s.eps[1], s.eps[2]] })));
  await p.goto(BASE + '#/recent'); await p.reload(); await p.waitForSelector('.sw');
  const rows = async () => p.evaluate(() => [...document.querySelectorAll('.sw')].map((s) => s.dataset.id));
  const r0 = await rows(); const first = r0[0];
  const box = async () => p.evaluate(() => { const r = document.querySelector('.sw .sw-row').getBoundingClientRect(); const s = document.querySelector('.sw').getBoundingClientRect(); return { x: r.left - s.left, y: r.top + r.height / 2, w: r.width, left: s.left }; });
  let bx = await box(); const y = bx.y;
  // 1) سحب عمودي: لا يفتح الإزالة ويمرّر الصفحة
  await swipe(w / 2, y + 30, w / 2 + 10, y - 40); T(`${w}px vertical swipe does not reveal remove`, (await box()).x === 0 && (await p.locator('.sw.open').count()) === 0);
  // 2) سحب أفقي نحو اليمين (RTL): يظهر زر «إزالة»
  await swipe(w * 0.35, y, w * 0.85, y + 4); const open = await box(); T(`${w}px horizontal swipe reveals remove (translate ${open.x})`, open.x >= 90 && (await p.locator('.sw.open').count()) === 1, JSON.stringify(open));
  // 3) «إزالة» -> نافذة تأكيد -> إلغاء: تعود البطاقة
  await p.click('.sw.open .sw-del'); await p.waitForSelector('.sheet, [role=dialog], .confirm', { timeout: 3000 }).catch(() => {});
  const asked = await p.evaluate(() => /إزالة من آخر المشاهدات/.test(document.body.innerText)); T(`${w}px confirmation shown before removal`, asked);
  await p.getByRole('button', { name: /إلغاء/ }).first().click(); await p.waitForTimeout(450);
  T(`${w}px cancel returns the card and removes nothing`, (await box()).x === 0 && (await rows()).length === r0.length, JSON.stringify(await rows()));
  // 4) ضغط على البطاقة يفتح الحلقة (لا يتعارض مع السحب)
  // 5) تأكيد الإزالة: تختفي من القائمة فقط
  await swipe(w * 0.35, y, w * 0.85, y); await p.click('.sw.open .sw-del'); await p.getByRole('button', { name: /تأكيد الإزالة/ }).click(); await p.waitForTimeout(700);
  const after = await rows(); T(`${w}px confirmed removal hides only that card`, after.length === r0.length - 1 && !after.includes(first), JSON.stringify(after));
  const keep = await p.evaluate(async (id) => { const db = await import('./db.js'); const pr = (await db.progress.all()).filter((x) => x.showId === id); return { n: pr.length, time: pr[0] && pr[0].time, fav: await db.favs.has(id) }; }, first);
  T(`${w}px progress and favourite untouched after removal`, keep.n >= 1 && keep.time === 900 && keep.fav === true, JSON.stringify(keep));
  // 6) زر «إزالة» الصريح (إتاحة الوصول)
  const second = (await rows())[0]; await p.click('.sw .rm-mini'); await p.getByRole('button', { name: /إلغاء/ }).first().click(); await p.waitForTimeout(300);
  T(`${w}px explicit remove button asks and cancel keeps card`, (await rows())[0] === second);
  // 7) الضغط على «متابعة» يفتح الحلقة
  await p.click('.sw .sw-row a button'); await p.waitForTimeout(600); T(`${w}px tap opens the episode`, /#\/watch\//.test(await p.evaluate(() => location.hash)));
  T(`${w}px no page errors`, errs.length === 0, errs.join(' | ')); await ctx.close();
}
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
