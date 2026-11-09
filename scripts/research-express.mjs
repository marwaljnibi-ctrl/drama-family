// بحث (يدوي): هل ملف Express (رابط عام على cloud.mail.ru) صالح للاستخدام مباشرة من التطبيق؟
// سلوك الزائر العادي فقط: لا ترويسات مزوّرة، لا تجاوز تحقق (يتوقف إن ظهر)، ويُلغى التنزيل بعد معرفة الرابط والترويسات.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const APP = 'https://marwaljnibi-ctrl.github.io/drama-family/';
const d = JSON.parse(readFileSync('data/shows.json', 'utf8'));
const hits = d.shows.flatMap((s) => s.eps.map((e) => ({ s, e }))).filter(({ e }) => (e.sv || []).some((x) => x[0] === 'e')).slice(0, 2);
const b = await chromium.launch();
for (const { s, e } of hits) {
  const link = e.sv.find((x) => x[0] === 'e')[1];
  console.log('EXPRESS episode', e.id, 'link', link);
  const ctx = await b.newContext({ acceptDownloads: true, locale: 'ar' });
  const page = await ctx.newPage();
  const files = []; page.on('response', (r) => { const ct = r.headers()['content-type'] || ''; if (/video|octet-stream/.test(ct) || /\.mp4/.test(r.url())) files.push(r.status() + ' ' + new URL(r.url()).host + ' ct=' + ct + ' len=' + r.headers()['content-length'] + ' ar=' + r.headers()['accept-ranges'] + ' acao=' + r.headers()['access-control-allow-origin']); });
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((er) => console.log('goto err', String(er).slice(0, 80)));
  await page.waitForTimeout(7000);
  const html = await page.content();
  if (/captcha|recaptcha|Я не робот|challenge/i.test(html.slice(0, 200000)) && !/video/.test(html)) console.log('CAPTCHA/CHALLENGE detected on page: stopping this link');
  const info = await page.evaluate(() => ({ title: document.title.slice(0, 60), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200), video: !!document.querySelector('video'), size: (document.body.innerText.match(/\d+([.,]\d+)?\s?(ГБ|МБ|GB|MB|غيغابايت|ميغابايت)/i) || [])[0] || null }));
  console.log('PAGE', JSON.stringify(info));
  // إلغاء شريط الخصوصية بأكثر الخيارات حفاظًا على الخصوصية (رفض) إن وُجد، ثم محاولة تنزيل كزائر عادي
  const reject = page.locator('button:has-text("Отклонить"), button:has-text("رفض"), button:has-text("Reject")').first();
  if (await reject.count()) { await reject.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1000); }
  const dlBtn = page.locator('text=/Скачать|Download|تنزيل|تحميل/i').first();
  console.log('download control count:', await page.locator('text=/Скачать|Download|تنزيل|تحميل/i').count());
  if (await dlBtn.count()) {
    const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await dlBtn.click({ timeout: 5000 }).catch((er) => console.log('click err', String(er).slice(0, 80)));
    const download = await dl;
    if (download) {
      const u = new URL(download.url());
      console.log('DOWNLOAD url host:', u.host, 'path:', u.pathname.slice(0, 40), 'params:', [...u.searchParams.keys()].join(','), 'name:', download.suggestedFilename());
      // اختبار CORS حقيقي من نطاق التطبيق (بلا تزوير): هل يستطيع التطبيق قراءة الملف من المتصفح؟
      const p2 = await (await b.newContext()).newPage();
      await p2.goto(APP, { waitUntil: 'domcontentloaded' });
      const cors = await p2.evaluate(async (url) => { try { const r = await fetch(url, { headers: { Range: 'bytes=0-1' } }); return { ok: r.status, status: r.status, ar: r.headers.get('accept-ranges'), cr: r.headers.get('content-range') }; } catch (er) { return { error: String(er).slice(0, 80) }; } }, download.url());
      console.log('BROWSER CORS FETCH from app origin:', JSON.stringify(cors));
      await download.cancel().catch(() => {});
    } else console.log('no download event (button may need consent or a different flow)');
  }
  console.log('FILE RESPONSES:', files.slice(0, 4));
  await ctx.close();
}
await b.close();
