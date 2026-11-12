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
T('opened-never-played-not-in-continue', cards.length === 1 && withMin && withMin.bar && !opened, JSON.stringify(cards));

// T2b: إزالة من آخر المشاهدات: صفحة الحلقة ← زر إزالة ← تأكيد؛ لا يُحذف تقدم، وتعود عند مشاهدة جديدة
await page.goto(BASE + '?demo=1#/watch/demo-a/demo-a-episode-4'); await page.reload(); await page.waitForSelector('#rh');
let dlg = null; page.once('dialog', (d) => { dlg = d.message(); d.dismiss(); });
await page.click('#rh'); await page.waitForTimeout(300);
T('remove-asks-confirmation-and-cancel-keeps', /آخر المشاهدات/.test(dlg || '') && !!(await page.$('#rh')));
page.once('dialog', (d) => d.accept());
await page.click('#rh'); await page.waitForTimeout(800);
T('remove-hides-button-after', !(await page.$('#rh')));
await home();
T('removed-not-in-continue', (await page.$$('.ccard')).length === 0);
await page.goto(BASE + '?demo=1#/recent'); await page.reload(); await page.waitForSelector('#view');
T('removed-not-in-recent-tab', (await page.$$eval('#view .row', (a) => a.length)) === 0);
const kept = await page.evaluate(async () => { const db = await import('./db.js'); const p = (await db.progress.all()).find((x) => x.epId === 'demo-a-episode-4'); return !!p && p.time === 600 && p.hidden === true; });
T('remove-keeps-progress-data', kept);
await page.evaluate(async () => { const db = await import('./db.js'); const D = await (await fetch('data/demo.json')).json(); const A = D.shows[0]; await db.progress.save(A.id, A.eps.find((e) => e.n === 4), { time: 700, duration: 2700, done: false }); });
await home();
T('new-playback-brings-it-back', (await page.$$('.ccard')).length === 1);

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
// T11: حسابات + واتساب (الـWorker مُحاكى): بلا جلسة لا يظهر الجرس، السؤال الأول مرة واحدة، رقم+موافقة+رمز، جرس، إيقاف الكل، مزامنة
const TOK = 'b'.repeat(64); const WA = { prompt: null, phone: null, verified: false, consent: false, shows: [], calls: [], favs: [], progress: [] };
await page.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', async (route) => {
  const req = route.request(); const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (WA.offline) return route.abort('internetdisconnected');
  const p = new URL(req.url()).pathname; const b = req.postDataJSON() || {}; WA.calls.push({ p, b, auth: req.headers()['authorization'] });
  if (p === '/api/wa/prompt') WA.prompt = b.answer;
  if (p === '/api/wa/phone') { if (b.agree !== true) return route.fulfill({ status: 400, headers: H, body: '{"error":"consent required"}' }); WA.pending = b.phone; }
  if (p === '/api/wa/verify') { if (b.code !== '123456') return route.fulfill({ status: 400, headers: H, body: '{"error":"wrong code"}' }); WA.phone = '+971••••••446'; WA.verified = true; WA.consent = true; WA.prompt = 'yes'; }
  if (p === '/api/wa/stop') WA.consent = false;
  if (p === '/api/wa/resume') WA.consent = true;
  if (p === '/api/shows') WA.shows = b.on ? [...WA.shows.filter((s) => s.showId !== b.showId), { showId: b.showId, title: b.title }] : WA.shows.filter((s) => s.showId !== b.showId);
  if (p === '/api/fav') WA.favs.push(b);
  if (p === '/api/progress') WA.progress.push(...(b.items || []));
  if (p === '/api/sync') return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ favs: [], progress: [] }) });
  return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ name: 'علي', email: 'a@x.com', wa: { prompt: WA.prompt, phone: WA.phone, verified: WA.verified, consent: WA.consent }, shows: WA.shows }) });
});
await page.goto(BASE + '?demo=1#/show/demo-a'); await page.reload(); await page.waitForSelector('#fav');
T('guest-browses-without-login', !!(await page.$('#fav')) && (await page.textContent('#acct')).includes('تسجيل الدخول'));
await page.click('#wa'); await page.waitForTimeout(400);
T('guest-bell-goes-to-account-page', page.url().endsWith('#/alerts'));
await page.goto(BASE + '?demo=1#/show/demo-a'); await page.reload(); await page.waitForSelector('#fav');
await page.evaluate((tok) => { localStorage.setItem('df-session', tok); localStorage.setItem('df-uid', 'g_1'); }, TOK);
await page.reload(); await page.waitForSelector('#wa'); await page.waitForSelector('#ob-y', { timeout: 8000 });
T('onboarding-asked-with-two-choices', (await page.textContent('body')).includes('هل تريد تلقي إشعارات الحلقات الجديدة عبر واتساب؟') && !!(await page.$('#ob-n')));
await page.click('#ob-n'); await page.waitForTimeout(400);
T('onboarding-answer-saved-no', WA.prompt === 'no' && WA.calls.some((c) => c.p === '/api/wa/prompt' && c.auth === 'Bearer ' + TOK));
await page.reload(); await page.waitForSelector('#wa'); await page.waitForTimeout(800);
T('onboarding-not-repeated', !(await page.$('#ob-y')));
await page.click('#wa'); await page.waitForSelector('#al-send', { timeout: 5000 });
T('bell-without-whatsapp-goes-to-account', /#\/alerts$/.test(page.url()));
await page.click('#al-send'); await page.waitForTimeout(300);
T('phone-requires-explicit-consent', !WA.calls.some((c) => c.p === '/api/wa/phone'));
await page.fill('#al-phone', '+971 50 123 4567'); await page.check('#al-agree'); await page.click('#al-send'); await page.waitForSelector('#al-code');
T('phone-sent-with-agree-flag', WA.pending === '+971501234567');
await page.fill('#al-code', '000000'); await page.click('#al-verify'); await page.waitForTimeout(400);
T('wrong-code-rejected', WA.verified === false);
await page.fill('#al-code', '123456'); await page.click('#al-verify'); await page.waitForSelector('#al-stop');
T('phone-shown-masked-only', !(await page.textContent('body')).includes('501234567') && (await page.textContent('body')).includes('••••'));
await page.goto(BASE + '?demo=1#/show/demo-a'); await page.reload(); await page.waitForSelector('#wa');
await page.click('#wa'); await page.waitForTimeout(500);
T('alert-subscribe-sends-showId-title', WA.shows.length === 1 && WA.shows[0].showId === 'demo-a' && !!WA.shows[0].title, JSON.stringify(WA.shows));
await page.click('#wa'); await page.waitForTimeout(500);
T('alert-unsubscribe', WA.shows.length === 0);
await page.click('#wa'); await page.waitForTimeout(400);
await page.goto(BASE + '?demo=1#/alerts'); await page.reload(); await page.waitForSelector('#al-stop'); await page.click('#al-stop'); await page.waitForSelector('#al-resume');
T('stop-all-alerts', WA.consent === false);
await page.goto(BASE + '?demo=1#/show/demo-a'); await page.reload(); await page.waitForSelector('#fav'); await page.click('#fav'); await page.waitForTimeout(5500);
T('favorite-synced-to-account', WA.favs.some((f) => f.showId === 'demo-a' && f.on === true));

// T12: ضعف الإنترنت: التغييرات لا تضيع (طابور محلي) وتصل عند عودة الاتصال
WA.offline = true; WA.favs = [];
await page.goto(BASE + '?demo=1#/show/demo-b'); await page.reload(); await page.waitForSelector('#fav'); await page.click('#fav'); await page.waitForTimeout(5500);
const q1 = await page.evaluate(() => localStorage.getItem('df-syncq:g_1'));
T('offline-change-kept-in-queue', /demo-b/.test(q1 || '') && !WA.favs.length, q1);
WA.offline = false; await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(1500);
T('offline-change-delivered-after-reconnect', WA.favs.some((f) => f.showId === 'demo-b' && f.on === JSON.parse(q1).f['demo-b'].on), JSON.stringify(WA.favs));
const q2 = await page.evaluate(() => localStorage.getItem('df-syncq:g_1')); T('queue-emptied-after-delivery', !/demo-b/.test(q2 || ''), q2);
await page.reload(); await page.waitForSelector('#fav'); T('favorite-still-local-after-reload', (await page.evaluate(() => document.querySelector('#fav').classList.contains('on'))) === JSON.parse(q1).f['demo-b'].on);

// T13: الدخول اختياري: ضيف جديد (سياق نظيف) — رسالة الحساب، إشعار المفضلة مرة واحدة، الحفظ المحلي، ثم دمج بيانات الضيف مع الحساب
{
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } }); const g = await c2.newPage(); const g_errors = []; g.on('pageerror', (e) => g_errors.push(String(e).slice(0, 120)));
  await c2.route('https://accounts.google.com/**', (rt) => rt.abort());
  const SV = { favs: [{ showId: 'demo-c', on: true, at: 5 }], progress: [{ key: 'demo-a|e1', showId: 'demo-a', epId: 'e1', epNum: 1, time: 900, duration: 1000, done: false, hidden: false, updated: 5000 }], calls: [] };
  await c2.route('https://dizi-alerts.fufuu-crafts.workers.dev/**', async (rt) => {
    const rq = rt.request(); const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' };
    if (rq.method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: H });
    const p = new URL(rq.url()).pathname, bd = rq.postDataJSON() || {}; SV.calls.push({ p, bd });
    if (p === '/api/sync') return rt.fulfill({ status: 200, headers: H, body: JSON.stringify({ favs: SV.favs, progress: SV.progress }) });
    return rt.fulfill({ status: 200, headers: H, body: JSON.stringify({ name: 'علي', email: 'a@x.com', wa: { prompt: 'no', phone: null, verified: false, consent: false }, shows: [] }) });
  });
  const readDb = (name) => g.evaluate((n) => new Promise((res) => { const q = indexedDB.open(n); q.onsuccess = () => { const d = q.result, o = { favs: [], progress: [] }; const names = ['favs', 'progress'].filter((s) => d.objectStoreNames.contains(s)); if (!names.length) { d.close(); return res(o); } const tx = d.transaction(names); names.forEach((s) => { tx.objectStore(s).getAll().onsuccess = (e) => { o[s] = e.target.result; }; }); tx.oncomplete = () => { d.close(); res(o); }; }; }), name);
  // 1) ضيف: صفحة الحساب تُظهر الرسالة دائمًا وفيها زر Google، والتصفح مفتوح
  await g.goto(BASE + '?demo=1#/alerts'); await g.reload(); await g.waitForSelector('#guest-card');
  const msg = (await g.textContent('#guest-card')) || '';
  T('guest-account-message', msg.includes('سجّل الدخول لحفظ مفضلتك ومكان وصولك في الحلقات.') && msg.includes('ويمكنك أيضًا تفعيل تنبيهات واتساب للحلقات الجديدة.') && !!(await g.$('#g-btn')));
  await g.goto(BASE + '?demo=1#/home'); await g.waitForSelector('#view .sec'); await g.goto(BASE + '?demo=1#/alerts'); await g.waitForSelector('#guest-card');
  T('guest-message-shown-every-time', true);
  T('guest-account-no-modal', !(await g.$('[role=dialog]')));
  await g.goto(BASE + '?demo=1#/show/demo-a'); await g.reload(); await g.waitForSelector('#fav');
  T('guest-can-browse-show', !!(await g.$('.eps')));
  // 2) مفضلة الضيف: تُضاف فورًا ومحليًا + إشعار لطيف مرة واحدة
  await g.click('#fav'); await g.waitForSelector('#fav-nudge');
  T('guest-favorite-added-immediately', await g.$eval('#fav', (x) => x.classList.contains('on')));
  T('guest-nudge-text-and-login-option', ((await g.textContent('#fav-nudge')) || '').includes('سجّل دخولك لحفظ مسلسلاتك وآخر حلقة وصلت إليها، واستكمل من أي جهاز لك.') && !!(await g.$('#fn-go')));
  T('nudge-does-not-block-page', (await g.$$('#fav-nudge')).length === 1 && !!(await g.$('#fn-x')));
  await g.click('#fn-x'); await g.click('#fav'); await g.click('#fav'); await g.waitForTimeout(300);
  T('nudge-only-once-in-session', !(await g.$('#fav-nudge')));
  await g.reload(); await g.waitForSelector('#fav'); await g.click('#fav'); await g.click('#fav'); await g.waitForTimeout(300);
  T('nudge-not-repeated-after-reload', !(await g.$('#fav-nudge')) && (await g.evaluate(() => localStorage.getItem('df-fav-nudge'))) === '1');
  T('guest-favorite-saved-locally', (await readDb('drama-family')).favs.some((f) => f.showId === 'demo-a'));
  // 3) تقدم محلي للضيف (أقدم من السحابة لـ demo-a، ومحلي فقط لـ demo-b)
  await g.evaluate(async () => { const db = await import('./db.js'); await db.raw.putProgress({ key: 'demo-a|e1', showId: 'demo-a', epId: 'e1', epNum: 1, time: 300, duration: 1000, done: false, updated: 1000 }); await db.raw.putProgress({ key: 'demo-b|e2', showId: 'demo-b', epId: 'e2', epNum: 2, time: 200, duration: 1000, done: false, updated: 2000 }); });
  T('guest-progress-saved-locally', (await readDb('drama-family')).progress.length === 2);
  // 4) تسجيل الدخول (جلسة صالحة) ثم إعادة التحميل: تُدمج بيانات الضيف مع السحابة بلا فقد
  await g.evaluate(() => { localStorage.setItem('df-session', 'c'.repeat(64)); localStorage.setItem('df-uid', 'g_9'); });
  await g.goto(BASE + '?demo=1#/home'); await g.reload(); await g.waitForSelector('#view .sec'); await g.waitForTimeout(2500);
  const acct = await readDb('dizi-u-g_9'); const gst = await readDb('drama-family');
  const pa = acct.progress.find((p) => p.key === 'demo-a|e1'), pb = acct.progress.find((p) => p.key === 'demo-b|e2');
  T('merge-guest-favorite-and-cloud-favorite', acct.favs.some((f) => f.showId === 'demo-a') && acct.favs.some((f) => f.showId === 'demo-c'), JSON.stringify(acct.favs.map((f) => f.showId)));
  T('merge-newer-cloud-progress-kept', pa && pa.time === 900, JSON.stringify(pa));
  T('merge-guest-only-progress-kept', pb && pb.time === 200, JSON.stringify(pb));
  T('merge-pushes-local-only-data-to-cloud', SV.calls.some((c) => c.p === '/api/fav' && c.bd.showId === 'demo-a') && SV.calls.some((c) => c.p === '/api/progress' && c.bd.items.some((i) => i.key === 'demo-b|e2')) && !SV.calls.some((c) => c.p === '/api/progress' && c.bd.items.some((i) => i.key === 'demo-a|e1' && i.time === 300)));
  T('guest-data-not-deleted-or-replaced', gst.favs.some((f) => f.showId === 'demo-a') && gst.progress.find((p) => p.key === 'demo-a|e1').time === 300 && gst.progress.length === 2);
  // 5) بعد الدخول تختفي رسالة الضيف وتظهر صفحة الحساب
  await g.goto(BASE + '?demo=1#/alerts'); await g.reload(); await g.waitForSelector('.empty-card'); await g.waitForTimeout(500);
  T('guest-message-gone-after-login', !(await g.$('#guest-card')) && ((await g.textContent('#view')) || '').includes('مرحبًا'));
  T('no-page-errors-guest-flow', g_errors.length === 0, g_errors.join(' | '));
  await c2.close();
}

T('no-page-errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed');
process.exit(out.every(Boolean) ? 0 : 1);
