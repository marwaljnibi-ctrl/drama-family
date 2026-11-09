// فحص تشخيصي (يُشغَّل يدويًا): كيف تُحمَّل مشغّلات الحلقة في صفحة قصة عشق؟ لا يتجاوز أي تحقق: إن ظهر تحدٍّ يتوقف ويبلّغ.
import { chromium } from 'playwright';
const EP = process.env.EP || 'https://qesset.net/clarus/uzak-sehir-episode-70/';
const strip = (u) => String(u).split('?')[0].slice(0, 160);
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'ar', viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const seen = [];
page.on('request', (r) => { const u = r.url(); if (/m3u8|\.mp4|embed|player|turnstile|challenge|\.ts$|\.mpd/i.test(u)) seen.push(r.resourceType() + ' ' + strip(u)); });
const res = await page.goto(EP, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(7000);
const html = await page.content();
console.log('STATUS', res.status(), 'TITLE', (await page.title()).slice(0, 60));
console.log('CHALLENGE?', /just a moment|cf-challenge|turnstile/i.test(html), 'turnstile frames:', page.frames().filter((f) => /challenges\.cloudflare/.test(f.url())).length);
const iframes = async () => page.frames().map((f) => strip(f.url())).filter((u) => u && u !== 'about:blank' && !/qesset\.net|challenges\.cloudflare|googletagmanager|google/.test(u));
await page.screenshot({ path: 'probe-shot.png', fullPage: false });
console.log('VISIBLE TEXT:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 700));
console.log('PLAYER-ISH:', await page.$$eval('[class*=server],[class*=player],[class*=watch],[class*=embed],[id*=server],[id*=player],[id*=watch],[data-server],[onclick]', (els) => els.slice(0, 14).map((e) => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 40) + ' | ' + (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) + ' | ' + [...e.attributes].filter((a) => /^(data-|onclick|href)/.test(a.name)).map((a) => a.name + '=' + a.value.slice(0, 50)).join(','))));
console.log('EXTERNAL LINKS:', await page.$$eval('a[href]', (as) => [...new Set(as.map((a) => a.href.split('?')[0]).filter((h) => !/qesset\.net/.test(h)))].slice(0, 15)));
console.log('FRAMES initial:', await iframes());
// ضغطة تشغيل كما يفعل المستخدم، مع تسجيل النوافذ المنبثقة وما يظهر بعدها (بلا تجاوز أي تحقق)
const popups = [];
ctx.on('page', (p) => popups.push(strip(p.url())));
for (const sel of ['.player-button-area', '.player-overlay', '.modern-player-container']) {
  const el = page.locator(sel).first();
  if (await el.count()) { await el.click({ timeout: 4000, force: true }).catch((e) => console.log('click fail', sel, String(e).slice(0, 80))); console.log('clicked', sel); break; }
}
await page.waitForTimeout(8000);
await page.screenshot({ path: 'probe-shot2.png' });
console.log('POPUPS:', popups, 'pages:', ctx.pages().map((p) => strip(p.url())));
console.log('AFTER CLICK FRAMES:', page.frames().map((f) => strip(f.url())).filter((u) => u && u !== 'about:blank'));
console.log('AFTER CLICK TEXT:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 300));
console.log('AFTER CLICK BUTTONS:', await page.$$eval('.modern-player-container *, [class*=server] *, [class*=tab] *', (els) => els.filter((e) => e.children.length === 0 && (e.textContent || '').trim()).slice(0, 20).map((e) => e.tagName + '.' + String(e.className).slice(0, 25) + ':' + e.textContent.trim().slice(0, 20))));
console.log('MEDIA REQ:', seen.slice(0, 25));
// أزرار السيرفرات
const cand = await page.$$eval('a,li,button,div,span', (els) => els.filter((e) => /^(arab\s*hd|turk|express|ok)$/i.test((e.textContent || '').trim())).slice(0, 12).map((e) => e.tagName + '|' + e.className + '|' + (e.textContent || '').trim() + '|' + [...e.attributes].map((a) => a.name + '=' + a.value.slice(0, 30)).join(',')));
console.log('SERVER BUTTONS:', cand);
const names = ['Arab HD', 'turk', 'express', 'ok'];
const out = [];
for (const n of names) {
  const before = seen.length;
  const loc = page.locator(`text=/^\\s*${n.replace(' ', '\\s*')}\\s*$/i`).first();
  if (!(await loc.count())) { out.push({ n, found: false }); continue; }
  await loc.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(5000);
  out.push({ n, found: true, frames: await iframes(), newReq: seen.slice(before, before + 8) });
}
console.log('PER SERVER:', JSON.stringify(out, null, 1));
// رؤوس التضمين لمضيفي المشغّلات
const hosts = new Set(out.flatMap((o) => o.frames || []).map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean));
for (const h of hosts) {
  try { const r = await fetch(h, { redirect: 'manual' }); console.log('HOST', h, r.status, 'xfo=', r.headers.get('x-frame-options'), 'csp=', (r.headers.get('content-security-policy') || '').slice(0, 160)); } catch (e) { console.log('HOST', h, 'ERR', e.message); }
}

// تفاصيل صفحة المشاهدة: الرابط الكامل، طلبات XHR، وأي معرّفات للسيرفرات
const wp = ctx.pages().find((p) => /qesen\.net\/watch/.test(p.url())) || page;
console.log("WATCH URL FULL:", wp.url().slice(0, 300));
console.log("SERVER LIST HTML:", (await wp.evaluate(() => { const e = [...document.querySelectorAll("li,div,ul")].find((x) => /Arab HD/.test(x.textContent) && /Red HD/.test(x.textContent) && x.querySelectorAll("*").length < 60); return e ? e.outerHTML.replace(/\s+/g, " ").slice(0, 1500) : "none"; })));
const reqs = [];
wp.on("request", (r) => { if (/xhr|fetch/.test(r.resourceType()) && !/google|jwp|analytics/.test(r.url())) reqs.push(r.method() + " " + r.url().slice(0, 220)); });
await wp.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await wp.waitForTimeout(6000);
console.log("XHR on watch page:", reqs);
console.log("WATCH HTML has turnstile widget:", /cf-turnstile|data-sitekey/i.test(await wp.content()));
for (const u of ["https://arabveturk.com/embed-p2y78po07xw1.html", "https://arabhd.onl/embed-efqcj4z4mm0p.html"]) {
  try { const r = await fetch(u, { headers: { referer: "https://marwaljnibi-ctrl.github.io/" } }); console.log("EMBED", u, r.status, "xfo=", r.headers.get("x-frame-options"), "csp=", (r.headers.get("content-security-policy") || "").slice(0, 200)); } catch (e) { console.log("EMBED", u, "ERR", e.message); }
}
await b.close();
