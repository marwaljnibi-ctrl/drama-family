// اختبار نهاية لنهاية (Chromium) لميزة استيراد حلقة من الملفات: ربط، حفظ، استكمال، بلا إنترنت، حذف، وعدم المساس بمشغّلات Arab HD/Turk.
// يتطلب: خادم على 8123، وملف test/clip.mp4 (H.264+AAC، 90 ثانية). النتائج: سطر "T <اسم> PASS|FAIL <تفصيل>".
import { chromium } from 'playwright';
import { copyFileSync, existsSync, statSync, mkdtempSync, readFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
const BASE = process.env.BASE || 'http://localhost:8123/';
const EP = (n) => `${BASE}?demo=1#/watch/demo-b/demo-b-episode-${n}`;
copyFileSync('test/clip.mp4', 'test/Show 03.mp4'); copyFileSync('test/clip.mp4', 'test/Brother 22.mp4'); copyFileSync('test/clip.mp4', 'test/Show 05.mp4'); copyFileSync('test/clip.mp4', 'test/Show 06.mp4'); copyFileSync('test/clip.mp4', 'test/Show 07.mp4');
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

// T5b–T5e: حارس الاستكمال (fix/resume-zero) مع الملف المستورد
const prog = () => page.evaluate(async () => { const db = await import('./db.js'); const p = await db.progress.get('demo-b', 'demo-b-episode-3'); return p ? +p.time.toFixed(1) : null; });
const setProg = (t) => page.evaluate(async (t) => { const db = await import('./db.js'); await db.progress.save('demo-b', { id: 'demo-b-episode-3', n: 3 }, { time: t, duration: 90, done: false }); }, t);
// الخروج من الحلقة والعودة إليها
await page.goto(EP(2)); await page.waitForSelector('#pl iframe'); await setProg(40); await page.goto(EP(3)); await waitVideo(); await page.waitForTimeout(800);
const r1 = await video(); const p1 = await prog();
T('resume-after-exit-and-return', r1 && r1.t >= 39 && r1.t < 42 && p1 >= 39, JSON.stringify({ at: r1 && r1.t, saved: p1 }));
// خروج سريع فور فتح الحلقة: لا يُكتب الصفر فوق الدقيقة المحفوظة
await page.goto(EP(2)); await page.waitForSelector('#pl iframe'); await setProg(50);
await page.evaluate(() => { location.hash = location.hash.replace('episode-2', 'episode-3'); });
await page.waitForFunction(() => { const v = document.getElementById('v'); return v && v.readyState >= 1; });
await page.evaluate(() => { dispatchEvent(new Event('pagehide')); location.hash = location.hash.replace('episode-3', 'episode-2'); });
await page.waitForTimeout(800); const p2 = await prog();
T('quick-exit-does-not-save-zero', p2 >= 49, 'saved=' + p2);
// محاكاة iOS: المتصفح يتجاهل أول تعيين لـ currentTime
await setProg(45);
await page.evaluate(() => { const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime'); let n = 0; Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return d.get.call(this); }, set(x) { if (n++ === 0) return; d.set.call(this, x); } }); location.hash = location.hash.replace('episode-2', 'episode-3'); });
await waitVideo(); await page.waitForFunction(() => document.getElementById('v').readyState >= 3, null, { timeout: 15000 }); await page.waitForTimeout(800);
const r3 = await video(); await page.evaluate(() => dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(500); const p3 = await prog();
T('ios-sim-first-seek-ignored-still-resumes', r3 && r3.t >= 44 && r3.t < 48 && p3 >= 44, JSON.stringify({ at: r3 && r3.t, saved: p3 }));
await page.reload(); // يزيل المحاكاة
// إغلاق التطبيق وإعادة فتحه (صفحة جديدة بنفس التخزين)
await page.goto(EP(2)); await page.waitForSelector('#pl iframe'); await setProg(60);
await page.goto('about:blank'); // يُغلق التطبيق في هذه الصفحة
const pg2 = await ctx.newPage();
await pg2.goto(EP(3)); await pg2.waitForFunction(() => { const v = document.getElementById('v'); return v && v.readyState >= 1; }); await pg2.waitForTimeout(800);
const r4 = await pg2.evaluate(() => +document.getElementById('v').currentTime.toFixed(1));
T('resume-after-close-and-reopen', r4 >= 59 && r4 < 62, 'at=' + r4);
await pg2.close();

// T6: حلقة أخرى لا تتأثر (ما زالت iframe)، والملف مرتبط بحلقته فقط
await page.goto(EP(2)); await page.waitForSelector('#pl iframe');
const other = await page.evaluate(() => ({ iframe: /arabhd/.test(document.querySelector('#pl iframe').src), noVideo: !document.getElementById('v') }));
T('other-episode-unaffected', other.iframe && other.noVideo, JSON.stringify(other));

// T7: حذف الملف المحفوظ يعيد المشغّل المضمّن
await page.goto(EP(3)); await waitVideo(); await page.click('#rm'); await page.waitForSelector('#pl iframe', { timeout: 8000 }).catch(() => {});
const afterRm = await page.evaluate(async () => { const db = await import('./db.js'); return { metas: (await db.downloads.meta()).length, iframe: !!document.querySelector('#pl iframe') }; });
T('delete-restores-embed', afterRm.metas === 0 && afterRm.iframe, JSON.stringify(afterRm));


// ===== ملف كبير: متصفح بملف تعريف حقيقي على القرص + مراقب RSS مستقل (Linux). لا يُحمَّل الملف في الذاكرة ولا نسخ زائدة =====
if (existsSync('test/big.mp4') && process.platform === 'linux') {
  const size = statSync('test/big.mp4').size, MB = 1048576;
  const dir = mkdtempSync(tmpdir() + '/pw-prof-'), log = dir + '-rss.log';
  const bctx = await chromium.launchPersistentContext(dir, { viewport: { width: 390, height: 844 } });
  const bp = await bctx.newPage(); await bp.goto(EP(4)); await bp.waitForSelector('#imp', { state: 'attached' });
  const du = () => +execSync('du -sb ' + dir).toString().trim().split(/\s+/)[0];
  const sampler = spawn('sh', ['-c', "while true; do ps -eo rss=,args= | grep -i '[c]hrom' | awk '{s+=$1} END {print s*1024}' >> " + log + "; sleep 0.2; done"], { detached: true, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const disk0 = du();
  await bp.setInputFiles('#imp', 'test/big.mp4');
  await bp.waitForFunction(async () => { const db = await import('./db.js'); return (await db.downloads.meta()).some((m) => m.key.endsWith('episode-4')); }, null, { timeout: 240000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  try { process.kill(-sampler.pid); } catch {}
  const rows = readFileSync(log, 'utf8').trim().split(/\s+/).map(Number).filter(Boolean);
  const base = rows[0], peak = Math.max(...rows), disk1 = du();
  const saved = await bp.evaluate(async () => { const db = await import('./db.js'); const m = (await db.downloads.meta()).find((x) => x.key.endsWith('episode-4')); return m && m.size; });
  const growthMB = (peak - base) / MB, diskGrowth = (disk1 - disk0) / size;
  console.log('INFO fileMB', Math.round(size / MB), 'rssSamples', rows.length, 'baseRssMB', Math.round(base / MB), 'peakRssMB', Math.round(peak / MB), 'diskGrowthMB', Math.round((disk1 - disk0) / MB));
  T('large-import-saved-complete', saved === size, 'saved=' + saved + ' expected=' + size);
  T('large-import-not-in-ram', rows.length >= 5 && growthMB < size / MB * 0.5, 'peak RSS growth ' + Math.round(growthMB) + 'MB for a ' + Math.round(size / MB) + 'MB file');
  T('large-import-no-extra-copy-on-disk', diskGrowth > 0.9 && diskGrowth < 1.3, 'profile disk growth x' + diskGrowth.toFixed(2) + ' of file size (1.0 = a single copy)');
  await bctx.close();
} else console.log('T large-import SKIPPED (no test/big.mp4 or not linux)');

// ===== نقص المساحة: رسالة واضحة، ولا يُحفظ شيء =====
const toastHas = (txt, ms = 8000) => page.waitForFunction((t) => (document.getElementById('toast').textContent || '').includes(t), txt, { timeout: ms }).then(() => true).catch(() => false);
const metaCount = () => page.evaluate(async () => (await (await import('./db.js')).downloads.meta()).length);
await page.goto(EP(5)); await page.waitForSelector('#imp', { state: 'attached' });
await page.evaluate(() => { navigator.storage.estimate = async () => ({ quota: 1000000, usage: 0 }); });
await page.setInputFiles('#imp', 'test/Show 05.mp4');
const lowOk = await toastHas('المساحة لا تكفي');
T('low-space-clear-message-nothing-saved', lowOk && (await metaCount()) === 0, 'metas=' + (await metaCount()));
await page.reload(); await page.waitForSelector('#imp', { state: 'attached' });

// ===== فشل الحفظ بامتلاء الحصة (QuotaExceededError): رسالة واضحة وتنظيف =====
await page.goto(EP(6)); await page.waitForSelector('#imp', { state: 'attached' });
await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
await page.setInputFiles('#imp', 'test/Show 06.mp4');
const quotaOk = await toastHas('ممتلئة');
const quotaToast = await page.evaluate(() => document.getElementById('toast').textContent);
await page.reload(); await page.waitForSelector('#imp', { state: 'attached' });
T('quota-exceeded-clear-message', quotaOk && (await metaCount()) === 0, 'metas=' + (await metaCount()) + ' toast=' + quotaToast);

// ===== إلغاء العملية (abort) لا يعلّق التطبيق =====
await page.goto(EP(7)); await page.waitForSelector('#imp', { state: 'attached' });
await page.evaluate(() => { const o = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { const r = o.call(this, v, k); try { this.transaction.abort(); } catch {} return r; }; });
await page.setInputFiles('#imp', 'test/Show 07.mp4');
const abortOk = await toastHas('فشل الحفظ', 8000);
const abortToast = await page.evaluate(() => document.getElementById('toast').textContent);
await page.reload(); await page.waitForSelector('#imp', { state: 'attached' });
T('aborted-transaction-does-not-hang', abortOk && (await metaCount()) === 0, 'metas=' + (await metaCount()) + ' toast=' + abortToast);

T('no-page-errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed');
process.exit(out.every(Boolean) ? 0 : 1);
