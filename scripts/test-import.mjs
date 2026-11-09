// اختبار نهاية لنهاية (Chromium) لميزة استيراد حلقة من الملفات: ربط، حفظ، استكمال، بلا إنترنت، حذف، وعدم المساس بمشغّلات Arab HD/Turk.
// يتطلب: خادم على 8123، وملف test/clip.mp4 (H.264+AAC، 90 ثانية). النتائج: سطر "T <اسم> PASS|FAIL <تفصيل>".
import { chromium } from 'playwright';
import { copyFileSync } from 'node:fs';
const BASE = 'http://localhost:8123/';
const EP = (n) => `${BASE}?demo=1#/watch/demo-b/demo-b-episode-${n}`;
copyFileSync('test/clip.mp4', 'test/Show 03.mp4'); copyFileSync('test/clip.mp4', 'test/Brother 22.mp4');
const out = []; const T = (name, ok, d = '') => { out.push(ok); console.log('T', name, ok ? 'PASS' : 'FAIL', d); };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 100)));
const video = () => page.evaluate(() => { const v = document.getElementById('v'); return v ? { src: v.src.slice(0, 5), dur: Math.round(v.duration || 0), t: +v.currentTime.toFixed(1), paused: v.paused, err: v.error && v.error.code } : null; });
const waitVideo = async () => { await page.waitForFunction(() => { const v = document.getElementById('v'); return v && v.readyState >= 1; }, null, { timeout: 15000 }); };

// T1: بدون استيراد، مشغّلات Arab HD/Turk كما هي (iframe بالحماية، Arab HD الافتراضي)
await page.goto(EP(3)); await page.waitForSelector('#pl iframe');
const base = await page.evaluate(() => ({ src: document.querySelector('#pl iframe').src, sb: document.querySelector('#pl iframe').getAttribute('sandbox'), active: document.querySelector('#act button.pri')?.textContent, imp: !!document.getElementById('impbtn') }));
T('baseline-embed-unchanged', /arabhd\.onl/.test(base.src) && /allow-scripts/.test(base.sb) && base.active === 'Arab HD' && base.imp, JSON.stringify(base));

// T2: اسم الملف يشير لحلقة مختلفة: يسأل، وعند الرفض لا يُحفظ شيء
let dialogMsg = null; page.once('dialog', (d) => { dialogMsg = d.message(); d.dismiss(); });
await page.setInputFiles('#imp', 'test/Brother 22.mp4'); await page.waitForTimeout(1500);
const noVideo = await page.evaluate(() => !document.getElementById('v'));
T('mismatch-name-asks-and-cancel', !!dialogMsg && /22/.test(dialogMsg) && noVideo, String(dialogMsg).slice(0, 70));

// T3: استيراد صحيح (الرقم يطابق): يُحفظ ويُشغَّل بمشغّل HTML5
await page.setInputFiles('#imp', 'test/Show 03.mp4'); await waitVideo();
const v1 = await video();
const meta = await page.evaluate(async () => { const db = await import('./db.js'); const m = await db.downloads.meta(); return m.map((x) => x.key + ':' + x.size + ':' + !!x.imported); });
T('import-saves-and-plays-html5', v1 && v1.src === 'blob:' && v1.dur >= 85 && !v1.err && meta.length === 1 && /demo-b\|demo-b-episode-3/.test(meta[0]), JSON.stringify({ v1, meta }));

// T4: حفظ الدقيقة ثم الاستكمال بعد إعادة تحميل التطبيق
await page.evaluate(async () => { const v = document.getElementById('v'); v.muted = true; await v.play(); v.currentTime = 30.5; });
await page.waitForTimeout(2000); await page.evaluate(() => document.getElementById('v').pause()); await page.waitForTimeout(600);
const saved = await page.evaluate(async () => { const db = await import('./db.js'); const p = await db.progress.get('demo-b', 'demo-b-episode-3'); return p && { time: +p.time.toFixed(1), dur: Math.round(p.duration), done: p.done }; });
await page.reload(); await waitVideo(); await page.waitForTimeout(800);
const v2 = await video();
T('progress-saved-and-resumed', saved && saved.time >= 30 && saved.time < 40 && v2 && v2.t >= 29 && v2.t < 40, JSON.stringify({ saved, resumedAt: v2 && v2.t }));

// T5: بلا إنترنت: التطبيق من كاش الـ Service Worker والفيديو من الملف المحفوظ
await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForTimeout(1500);
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
await ctx.setOffline(true);
await page.goto(EP(3)).catch((e) => console.log('goto offline err', String(e).slice(0, 60)));
let offOk = false, v3 = null;
try { await waitVideo(); await page.evaluate(async () => { const v = document.getElementById('v'); v.muted = true; await v.play(); }); await page.waitForTimeout(2500); v3 = await video(); offOk = v3 && v3.src === 'blob:' && v3.t > 30.5 && !v3.err; } catch (e) { v3 = 'ERR ' + String(e).slice(0, 80); }
T('offline-playback-from-saved-file', controlled && offOk, JSON.stringify({ swControlled: controlled, v3 }));
await ctx.setOffline(false);

// T6: حلقة أخرى لا تتأثر (ما زالت iframe)، والملف مرتبط بحلقته فقط
await page.goto(EP(2)); await page.waitForSelector('#pl iframe');
const other = await page.evaluate(() => ({ iframe: /arabhd/.test(document.querySelector('#pl iframe').src), noVideo: !document.getElementById('v') }));
T('other-episode-unaffected', other.iframe && other.noVideo, JSON.stringify(other));

// T7: حذف الملف المحفوظ يعيد المشغّل المضمّن
await page.goto(EP(3)); await waitVideo(); await page.click('#rm'); await page.waitForSelector('#pl iframe', { timeout: 8000 }).catch(() => {});
const afterRm = await page.evaluate(async () => { const db = await import('./db.js'); return { metas: (await db.downloads.meta()).length, iframe: !!document.querySelector('#pl iframe') }; });
T('delete-restores-embed', afterRm.metas === 0 && afterRm.iframe, JSON.stringify(afterRm));

T('no-page-errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed');
process.exit(out.every(Boolean) ? 0 : 1);
