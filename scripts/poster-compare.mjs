// صورة مقارنة قبل/بعد: «قبل» = كما تظهر البوسترات الحالية في Dizi (بانر أفقي مقصوص عموديًا ومكبَّر)، «بعد» = البوستر العمودي الجديد.
// الاستخدام: node scripts/poster-compare.mjs out.jpg id1,id2,...
import sharp from 'sharp'; import { readFileSync } from 'node:fs';
const [out, ids] = [process.argv[2], (process.argv[3] || '').split(',')];
const shows = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, '')).shows; const map = JSON.parse(readFileSync('data/poster-map.json', 'utf8'));
const W = 210, H = 315, G = 10, per = 4; const cells = []; const list = ids.filter((i) => map[i] && map[i].path);
for (const [n, id] of list.entries()) {
  const s = shows.find((x) => x.id === id); const row = Math.floor(n / per), col = n % per; const x0 = col * (2 * W + 3 * G) + G, y0 = row * (H + 2 * G) + G;
  const old = await sharp(s.img2).resize(W, H, { fit: 'cover', position: 'centre' }).jpeg({ quality: 88 }).toBuffer();
  const neu = await sharp(map[id].path).resize(W, H, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
  cells.push({ input: old, left: x0, top: y0 }, { input: neu, left: x0 + W + G, top: y0 });
}
const rows = Math.ceil(list.length / per), width = per * (2 * W + 3 * G);
const base = sharp({ create: { width, height: rows * (H + 2 * G), channels: 3, background: '#141416' } });
await base.composite(cells).jpeg({ quality: 88 }).toFile(out); console.log(out, list.length);
