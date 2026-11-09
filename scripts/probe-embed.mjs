// فحص تشخيصي: هل تعمل مشغّلات التضمين داخل iframe من نطاق github.io؟ مع/بدون sandbox. لا يتجاوز أي حماية.
import { chromium } from 'playwright';
const APP = 'https://marwaljnibi-ctrl.github.io/drama-family/';
const CASES = [
  ['arabhd', 'https://arabhd.onl/embed-efqcj4z4mm0p.html'],
  ['turk', 'https://arabveturk.com/embed-p2y78po07xw1.html'],
  ['ok', 'https://ok.ru/videoembed/17479690095296'],
];
const SANDBOX = { none: null, safe: 'allow-scripts allow-same-origin allow-presentation allow-forms' };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const [name, url] of CASES) for (const [sbName, sb] of Object.entries(SANDBOX)) {
  const ctx = await b.newContext({ viewport: { width: 800, height: 520 } });
  const page = await ctx.newPage();
  const popups = []; ctx.on('page', (p) => popups.push(p.url().split('?')[0].slice(0, 90)));
  const media = []; page.on('request', (r) => { if (/\.m3u8|\.mp4|\.ts(\?|$)|videoPreview|okcdn|mycdn/i.test(r.url())) media.push(r.url().split('?')[0].slice(-60)); });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([u, sb]) => { document.body.innerHTML = `<iframe id="f" src="${u}" ${sb ? `sandbox="${sb}"` : ''} allowfullscreen allow="autoplay; fullscreen; picture-in-picture" style="width:760px;height:430px;border:0"></iframe>`; }, [url, sb]);
  await page.waitForTimeout(6000);
  const res = { case: name + '/' + sbName, frames: page.frames().length };
  const fr = page.frames().find((f) => f.url() && !f.url().startsWith(APP) && f.url() !== 'about:blank');
  res.frameUrl = fr ? fr.url().split('?')[0].slice(0, 80) : null;
  try { res.bodyText = fr ? (await fr.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 120))) : null; } catch (e) { res.bodyText = 'ERR ' + String(e).slice(0, 60); }
  await page.mouse.click(380, 215).catch(() => {}); await page.waitForTimeout(6000);
  try { res.video = fr ? await fr.evaluate(() => { const v = document.querySelector('video'); return v ? { t: +v.currentTime.toFixed(1), paused: v.paused, dur: v.duration, ready: v.readyState, err: v.error && v.error.code } : 'no video element'; }) : null; } catch (e) { res.video = 'ERR ' + String(e).slice(0, 60); }
  res.popups = popups; res.media = media.slice(0, 3);
  console.log('RESULT', JSON.stringify(res));
  await page.screenshot({ path: `probe-embed-${name}-${sbName}.png` });
  await ctx.close();
}
await b.close();
