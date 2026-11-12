// حماية Dizi من الإعلانات والنوافذ المنبثقة (ما يقدر عليه الموقع وحده): CSP للموقع، sandbox المشغّل، منع النوافذ وتحويل الصفحة الرئيسية، وعدم تعطيل الفيديو.
// مشغّل مزيّف يحاول window.open وتحويل top والإطار إلى نطاق إعلاني: يجب ألا ينجح شيء منها بينما يبقى الإطار يعمل.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8123/'; const out = []; const T = (n, ok, d = '') => { out.push(!!ok); console.log('T', n, ok ? 'PASS' : 'FAIL', ok ? '' : d); };
const html = readFileSync('index.html', 'utf8'); const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
T('csp present: object-src none, base-uri self, frames only Arab HD + OK (+Google sign-in)', /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /frame-src https:\/\/arabhd\.onl https:\/\/ok\.ru( https:\/\/accounts\.google\.com\/gsi\/)?(;|$)/.test(csp), csp.slice(0, 120));
T('csp: scripts only from self, Google sign-in and hls.js CDN', /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client https:\/\/cdn\.jsdelivr\.net;/.test(csp));
const src = readFileSync('app.js', 'utf8'); const sb = (src.match(/<iframe src="\$\{esc\(S\.url\(id\)\)\}" sandbox="([^"]+)"/) || [])[1] || '';
T('player sandbox has no popups / top-navigation / downloads / modals', sb && !/allow-popups|allow-top-navigation|allow-downloads|allow-modals|allow-pointer-lock|allow-orientation-lock/.test(sb), sb);
const data = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^\uFEFF/, '')); const s = data.shows.find((x) => x.eps.some((e) => e.sv && e.sv.some((v) => v[0] === 'a'))); const ep = s.eps.find((e) => e.sv && e.sv.some((v) => v[0] === 'a'));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar' });
for (const u of ['https://fonts.googleapis.com/**', 'https://accounts.google.com/**', 'https://dizi-alerts.fufuu-crafts.workers.dev/**']) await ctx.route(u, (r) => r.abort());
const evil = []; await ctx.route(/evil\.example/, (r) => { evil.push(r.request().url()); r.abort(); });
await ctx.route('https://arabhd.onl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: `<body style="margin:0;background:#000"><video id="v" playsinline style="width:100%"></video><script>
  var res = {}; try { res.open = !!window.open('https://evil.example/pop'); } catch (e) { res.open = 'threw'; }
  try { top.location = 'https://evil.example/top'; res.top = 'assigned'; } catch (e) { res.top = 'blocked'; }
  try { var a = document.createElement('a'); a.href = 'https://evil.example/dl'; a.download = 'x'; document.body.appendChild(a); a.click(); } catch (e) {}
  parent.postMessage({ probe: res }, '*'); setTimeout(function () { location.href = 'https://evil.example/frame'; }, 300);
  </script>` }));
const p = await ctx.newPage(); const pops = []; ctx.on('page', (pg) => pops.push(pg.url())); const viol = []; const msgs = [];
p.on('console', (m) => { if (/Content Security Policy|content-security-policy/i.test(m.text())) viol.push(m.text().slice(0, 140)); });
await p.addInitScript(() => { addEventListener('message', (e) => { if (e.data && e.data.probe) window.__probe = e.data.probe; }); });
await p.goto(BASE + `#/watch/${encodeURIComponent(s.id)}/${encodeURIComponent(ep.id)}`); await p.waitForSelector('#pl iframe', { timeout: 15000 }); await p.waitForTimeout(2500);
const probe = await p.evaluate(() => window.__probe || null);
T('player cannot open a popup window', pops.length === 0 && (!probe || probe.open !== true), JSON.stringify({ pops, probe }));
T('player cannot redirect the Dizi page (top navigation)', p.url().startsWith(BASE) && /#\/watch\//.test(p.url()), p.url());
T('player frame cannot navigate to a non-allowed (ad) origin; nothing requested from it', evil.length === 0, JSON.stringify(evil));
T('player iframe element still present and pointing at Arab HD', await p.evaluate(() => /^https:\/\/arabhd\.onl\//.test((document.querySelector('#pl iframe') || {}).src || '')));
T('no CSP violations caused by Dizi itself in normal browsing (home, shows, show, watch)', await (async () => { const v0 = viol.length; for (const h of ['#/home', '#/shows', '#/show/' + encodeURIComponent(s.id), '#/recent', '#/favs']) { await p.goto(BASE + h); await p.reload(); await p.waitForTimeout(600); } return viol.length === v0 || viol.filter((x) => !/evil\.example|arabhd/.test(x)).length === 0; })(), viol.join(' | '));
await b.close(); console.log('SUMMARY', out.filter(Boolean).length + '/' + out.length, 'passed'); process.exit(out.every(Boolean) ? 0 : 1);
