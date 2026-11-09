// فحص: هل ترسل مشغّلات التضمين رسائل postMessage (موضع التشغيل مثلًا) إلى الصفحة الأم؟ وهل تدعم تحكمًا عبر الرسائل؟
import { chromium } from 'playwright';
const APP = 'https://marwaljnibi-ctrl.github.io/drama-family/';
const CASES = { arabhd: 'https://arabhd.onl/embed-lmesk8d8jxrl.html', turk: 'https://arabveturk.com/embed-l70zp39m8os3.html' };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const [name, url] of Object.entries(CASES)) {
  const page = await (await b.newContext()).newPage();
  await page.addInitScript(() => { window.__msgs = []; window.addEventListener('message', (e) => { try { window.__msgs.push(e.origin + ' ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)).slice(0, 160)); } catch {} }); });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate((u) => { document.body.innerHTML = `<iframe id="f" src="${u}" allow="autoplay; fullscreen" style="width:760px;height:430px;border:0"></iframe>`; }, url);
  await page.waitForTimeout(5000); await page.mouse.click(380, 215); await page.waitForTimeout(12000);
  // محاولة تحكم عبر رسائل JW/عامة: لا ينجح إن لم يدعمها المضيف
  await page.evaluate(() => { const w = document.getElementById('f').contentWindow; for (const m of ['{"event":"command","func":"getCurrentTime"}', '{"method":"getCurrentTime"}', 'getCurrentTime']) { try { w.postMessage(m, '*'); } catch {} } });
  await page.waitForTimeout(2000);
  const fr = page.frames().find((f) => /arabhd|arabveturk/.test(f.url()));
  const t = fr ? await fr.evaluate(() => document.querySelector('video')?.currentTime).catch(() => null) : null;
  console.log('MSG', name, 'playing t=', t, 'messages:', JSON.stringify(await page.evaluate(() => window.__msgs.slice(0, 10))));
}
await b.close();
