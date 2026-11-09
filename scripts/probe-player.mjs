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
console.log('FRAMES initial:', await iframes());
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
await b.close();
