// فحص مؤقت: لكل سيرفر في حلقتين محددتين، هل يتحمّل ويعمل داخل iframe من أصل github.io (مع sandbox الحالي وبدونه)؟
import { chromium } from 'playwright';
const APP = 'https://marwaljnibi-ctrl.github.io/drama-family/';
const EMB = { a: (i) => `https://arabhd.onl/embed-${i}.html`, t: (i) => `https://arabveturk.com/embed-${i}.html`, o: (i) => `https://ok.ru/videoembed/${i}` };
const d = await (await fetch(APP + 'data/shows.json?' + Date.now())).json();
const eps = d.shows.flatMap((s) => s.eps);
const SB = 'allow-scripts allow-same-origin allow-presentation allow-forms';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const id of ['omur-usta-episode-7', 'uzak-sehir-episode-72']) {
  const e = eps.find((x) => x.id === id);
  for (const [k, vid] of e.sv.filter((x) => EMB[x[0]])) for (const sb of [SB, null]) {
    const ctx = await b.newContext({ viewport: { width: 800, height: 520 } });
    const page = await ctx.newPage();
    const docs = []; page.on('response', (r) => { if (r.request().resourceType() === 'document' && /arabhd|arabveturk|ok\.ru/.test(r.url())) docs.push(r.status() + ' ' + r.url().split('?')[0].slice(0, 60) + ' xfo=' + r.headers()['x-frame-options']); });
    const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([u, sb]) => { document.body.innerHTML = `<iframe src="${u}" ${sb ? `sandbox="${sb}"` : ''} allow="autoplay; fullscreen" style="width:760px;height:430px;border:0"></iframe>`; }, [EMB[k](vid), sb]);
    await page.waitForTimeout(6000);
    const fr = page.frames().find((f) => /arabhd|arabveturk|ok\.ru/.test(f.url()));
    let text = null; try { text = fr ? await fr.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 90)) : 'NO FRAME'; } catch (er) { text = 'ERR'; }
    await page.mouse.click(380, 215).catch(() => {}); await page.waitForTimeout(6000);
    let v = null; try { v = fr ? await fr.evaluate(() => { const x = document.querySelector('video'); return x ? { t: +x.currentTime.toFixed(1), paused: x.paused, ready: x.readyState, err: x.error && x.error.code } : 'no video'; }) : null; } catch (er) { v = 'ERR'; }
    console.log('RES', id, k, sb ? 'sandbox' : 'nosandbox', JSON.stringify({ docs: docs.slice(0, 2), text, video: v, errs: errs.slice(0, 2) }));
    await ctx.close();
  }
}
await b.close();
