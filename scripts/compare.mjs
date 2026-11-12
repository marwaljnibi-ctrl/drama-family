// يركّب لقطات قبل/بعد جنبًا إلى جنب في صور مقارنة (docs/design/compare-*.jpg)
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
const D = resolve('docs/design').split('\\').join('/');
const sets = { 'compare-type-1': ['i15-home', 'i15-show', 'i15-recent'], 'compare-type-2': ['i15-shows', 'i15-watch', 'i15-account-user'] };
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
for (const [name, list] of Object.entries(sets)) {
  const html = `<body style="margin:0;background:#1c1c1e;font:600 20px system-ui;color:#fff;direction:ltr"><div style="display:flex;gap:28px;padding:24px">${list.map((s) => `<div style="flex:1;text-align:center"><div style="margin-bottom:10px;color:#aaa">${s}</div><div style="display:flex;gap:14px"><div style="flex:1"><div style="color:#f77;margin-bottom:6px">قبل (الخط/الأرقام)</div><img style="width:100%;border-radius:18px" src="file:///${D}/after/${s}.jpg"></div><div style="flex:1"><div style="color:#7f7;margin-bottom:6px">بعد</div><img style="width:100%;border-radius:18px" src="file:///${D}/type-after/${s}.jpg"></div></div></div>`).join('')}</div>`;
  writeFileSync(D + "/_cmp.html", html); await p.goto("file:///" + D + "/_cmp.html"); await p.waitForTimeout(800);
  await p.screenshot({ path: `${D}/${name}.jpg`, type: 'jpeg', quality: 86, fullPage: true }); console.log(name);
}
await b.close(); rmSync(D + "/_cmp.html", { force: true });
