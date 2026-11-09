// اختبار نهاية لنهاية على التطبيق المنشور: يختار حلقة حقيقية محلولة السيرفرات، يفتحها في التطبيق، يضغط تشغيل، ويتحقق أن الفيديو يعمل داخل الـ iframe.
import { chromium } from 'playwright';
const APP = 'https://marwaljnibi-ctrl.github.io/drama-family/';
const data = await (await fetch(APP + 'data/shows.json?' + Date.now())).json();
const withSv = data.shows.flatMap((s) => s.eps.filter((e) => e.sv && e.sv.length).map((e) => ({ s, e })));
console.log('EPISODES WITH SERVERS:', withSv.length, 'of', data.shows.reduce((n, s) => n + s.eps.length, 0));
const kinds = {}; withSv.forEach(({ e }) => e.sv.forEach(([k]) => (kinds[k] = (kinds[k] || 0) + 1))); console.log('SERVER KINDS:', JSON.stringify(kinds));
const picks = [withSv[0], withSv[Math.floor(withSv.length / 2)], withSv[withSv.length - 1]];
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const { s, e } of picks) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const popups = []; ctx.on('page', (p) => popups.push(p.url().split('?')[0].slice(0, 80)));
  const url = `${APP}#/watch/${encodeURIComponent(s.id)}/${encodeURIComponent(e.id)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
  const info = await page.evaluate(() => ({ title: document.getElementById('title').textContent, iframe: document.querySelector('#pl iframe')?.src.split('?')[0], sandbox: document.querySelector('#pl iframe')?.getAttribute('sandbox'), buttons: [...document.querySelectorAll('#act button')].map((x) => x.textContent) }));
  const res = { ep: e.id, sv: e.sv.map((x) => x[0]), ...info };
  const fr = page.frames().find((f) => /arabhd|arabveturk|ok\.ru/.test(f.url()));
  const box = await page.locator('#pl').boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(7000);
  try { res.video = fr ? await fr.evaluate(() => { const v = document.querySelector('video'); return v ? { t: +v.currentTime.toFixed(1), paused: v.paused, dur: Math.round(v.duration), ready: v.readyState } : 'no video'; }) : 'no frame'; } catch (er) { res.video = 'ERR ' + String(er).slice(0, 60); }
  res.popups = popups;
  console.log('RESULT', JSON.stringify(res));
  await page.screenshot({ path: `probe-app-${picks.indexOf(picks.find((p) => p.e === e))}.png` });
  await ctx.close();
}
await b.close();
