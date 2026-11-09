// تشخيص (يدوي): هل رابط Express العام (cloud.mail.ru) يعمل بزيارة عادية؟ بلا تزوير ترويسات ولا استخراج روابط فيديو.
import { chromium } from 'playwright';
import { parseServers } from './lib/qesset.mjs';
const UA = 'DramaFamilyBot/1.0 (+personal family PWA; low-rate)';
const EP = 'https://qesset.net/clarus/karadeniz-episode-64/';
const html = await (await fetch(EP, { headers: { 'user-agent': UA } })).text();
const sv = parseServers(html) || [];
console.log('SERVERS', JSON.stringify(sv.map(([k, id]) => [k, k === 'e' ? id : id.slice(0, 4) + '…'])));
const ex = sv.find((x) => x[0] === 'e')?.[1];
if (!ex) { console.log('NO EXPRESS LINK for this episode'); process.exit(0); }
const r = await fetch(ex, { headers: { 'user-agent': UA }, redirect: 'follow' });
console.log('EXPRESS plain fetch', r.status, 'xfo=', r.headers.get('x-frame-options'));
const b = await chromium.launch();
const page = await (await b.newContext({ locale: 'ar' })).newPage();
await page.goto(ex, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch((e) => console.log('goto err', String(e).slice(0, 80)));
await page.waitForTimeout(6000);
console.log('EXPRESS title:', (await page.title()).slice(0, 80));
console.log('EXPRESS text:', (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 240));
console.log('EXPRESS download controls:', await page.locator('text=/Скачать|Download|تنزيل/i').count());
await b.close();
