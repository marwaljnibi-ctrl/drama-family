// اختبار نهاية لنهاية (Chromium) للرئيسية العائلية على بيانات demo. يتطلب خادمًا على 8123.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8123/';
const out = []; const T = (n, ok, d = '') => { out.push(ok); console.log('T', n, ok ? 'PASS' : 'FAIL', d); };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
const heads = () => page.$$eval('#view .sec-h h2', (a) => a.map((x) => x.textContent.trim()));
const home = async () => { await page.goto(BASE + '?demo=1#/home'); await page.reload(); await page.waitForSelector('#view .sec', { timeout: 15000 }); await page.waitForTimeout(400); };
const putFav = (showId, at) => page.evaluate(({ showId, at }) => new Promise((res) => { const r = indexedDB.open('drama-family', 1); r.onsuccess = () => { const tx = r.result.transaction('favs', 'readwrite'); tx.objectStore('favs').put({ showId, at }); tx.oncomplete = res; }; }), { showId, at });
const progKeys = () => page.evaluate(async () => { const db = await import('./db.js'); return (await db.progress.all()).map((p) => p.key + ':' + Math.round(p.time)).sort().join(); });
const mineCount = () => page.$$eval('#view .sec', (a) => { const s = a.find((x) => x.querySelector('h2') && x.querySelector('h2').textContent.trim() === 'مسلسلاتي'); return s ? s.querySelectorAll('.card').length : 0; });

// T1: أول استخدام: «اكتشف مسلسلك الأول» وبلا قسم متابعة فارغ، وأربعة تبويبات فقط
await home();
const first = await page.evaluate(() => ({ text: document.getElementById('view').innerText, tabs: [...document.querySelectorAll('#tabs a')].map((a) => a.textContent.trim()) }));
T('first-run-cta-and-no-empty-continue', /اكتشف مسلسلك الأول/.test(first.text) && !/متابعة المشاهدة/.test(first.text), first.text.slice(0, 80));
T('back-button-visible-on-home', await page.evaluate(() => !document.getElementById('back').hidden));
T('four-tabs-only', first.tabs.length === 4 && first.tabs[0] === 'الرئيسية', first.tabs.join('|'));
T('discover-not-claimed-personal', /اكتشف مسلسلات/.test(first.text) && !/حسب ذوقك/.test(first.text));

// T2: بيانات متابعة: ترتيب الأقسام، والدقيقة والشريط فقط عند وجود مدة مثبتة
await page.evaluate(async () => {
  const db = await import('./db.js'); const D = await (await fetch('data/demo.json')).json(); const [A, B, C] = D.shows;
  await db.progress.save(A.id, A.eps.find((e) => e.n === 4), { time: 600, duration: 2700, done: false });
  await db.progress.save(B.id, B.eps.find((e) => e.n === 3), { time: 0, duration: 0, done: false });
  await db.favs.toggle(C.id);
});
await home();
const order = await heads();
T('section-order-continue-then-mine', order[0] === 'متابعة المشاهدة' && order[1] === 'مسلسلاتي', order.join('|'));
const cards = await page.$$eval('.ccard', (a) => a.map((x) => ({ small: x.querySelector('small').textContent, bar: !!x.querySelector('.bar') })));
T('continue-label-is-متابعة-المشاهدة', await page.$$eval('.ccard .go', (a) => a.length > 0 && a.every((x) => x.textContent.trim() === 'متابعة المشاهدة' || x.textContent.trim() === 'شاهد التالية')));
const withMin = cards.find((c) => /توقفت عند/.test(c.small)), opened = cards.find((c) => !/توقفت عند/.test(c.small));
T('minute-and-bar-only-when-known', cards.length === 2 && withMin && withMin.bar && opened && !opened.bar, JSON.stringify(cards));

// T3: بطاقة المتابعة تفتح الحلقة
await page.click('.ccard >> nth=0'); await page.waitForSelector('#pl');
T('continue-opens-episode', /#\/watch\//.test(page.url()), page.url().split('#')[1]);

// T4: واجهة المشاهدة نظيفة
const watch = await page.evaluate(() => document.getElementById('view').innerText + (document.body.innerHTML.includes('DZ✓') ? ' DZ✓' : ''));
T('watch-page-clean', !/لقطة|تمت المشاهدة|عاد للمكان|بدأ من الصفر|انسخ التقرير|ARAB_HD_RESUME_TEST|DZ✓/.test(watch) && !(await page.$('#snap, #resume')), watch.slice(0, 60));

// T5: المفضلة قاعدة واحدة تغذي الرئيسية وتبويب المفضلة
await home();
const mine1 = await mineCount();
await page.goto(BASE + '?demo=1#/favs'); await page.waitForSelector('#view .grid');
const favN = await page.$$eval('#view .grid .card', (a) => a.length);
T('favorites-single-source', mine1 === 1 && favN === 1, `home=${mine1} favs=${favN}`);

// T6: إضافة من صف الاكتشاف تظهر في مسلسلاتي (نجعل demo-b غير مشاهد ليظهر في الاكتشاف)
await page.evaluate(async () => { const db = await import('./db.js'); for (const p of await db.progress.all()) if (p.showId === 'demo-b') await db.progress.reset(p.showId, p.epId); });
await home();
await page.click('#view .sec:has-text("اكتشف مسلسلات") .heart >> nth=0'); await page.waitForTimeout(1000);
T('add-from-discover-appears-in-mine', (await mineCount()) === 2, 'mine=' + (await mineCount()));

// T7: «حلقة جديدة» فقط لحلقة ظهرت بعد آخر حالة (مفضلة قديمة) وبعد بداية التتبع
await putFav('demo-c', 1);
await page.evaluate(() => localStorage.setItem('df-track-start', '1'));
await home();
const badge = await page.$$eval('#view .sec .card', (a) => a.filter((x) => /حلقة جديدة/.test(x.textContent)).length);
await putFav('demo-c', Date.now() + 1e10);
await home();
const badge2 = await page.$$eval('#view .sec .card .badge', (a) => a.filter((x) => x.textContent.trim() === 'حلقة جديدة').length);
T('new-episode-badge-only-after-last-state', badge >= 1 && badge2 === 0, `old-fav=${badge} future-fav=${badge2}`);

// T8: مسلسل جديد (عنوان) يختلف عن حلقة جديدة، ويظهر بعد خط الأساس فقط
await page.evaluate(() => localStorage.setItem('df-known-shows', JSON.stringify({ base: ['demo-a', 'demo-b'], added: {} })));
await home();
const h2 = await heads();
T('new-shows-distinct-from-new-episodes', h2.includes('المسلسلات الجديدة') && h2.includes('حلقات جديدة') && h2.indexOf('حلقات جديدة') < h2.indexOf('المسلسلات الجديدة'), h2.join('|'));

// T9: رسالة غير موثوقة (ليست من iframe) لا تغيّر سجل التقدم
const before = await progKeys();
await page.evaluate(() => postMessage({ src: 'dizi-resume-ext', type: 'time', id: 'x', t: 999, d: 2000 }, '*'));
await page.waitForTimeout(400);
T('untrusted-message-ignored', before === (await progKeys()));

// T10: التبويبات الأخرى تعمل
for (const [h, sel] of [['shows', '#view .grid'], ['recent', '#view .list']]) {
  const ok = await page.goto(BASE + '?demo=1#/' + h).then(() => page.waitForSelector(sel, { timeout: 8000 })).then(() => true, () => false);
  T('tab-' + h + '-renders', ok);
}
T('no-page-errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed');
process.exit(out.every(Boolean) ? 0 : 1);
