// يعتمد مرشحين تقريبيين بعد مراجعة بصرية بشرية (الصورة القديمة مقابل المرشح): node scripts/promote-candidates.mjs id1,id2,...
// يستعمل المرشح الأول المحفوظ في poster-map (review.cands)، يتحقق من أنه عمودي، ويحفظه كبوستر معتمد (conf=manual) مع خلفية أفقية إن وُجدت.
import sharp from 'sharp'; import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'; import { createHash } from 'node:crypto';
import { assess, pickBackdrop, portraitOk } from './poster-pick.mjs';
const MAP = 'data/poster-map.json'; const map = JSON.parse(readFileSync(MAP, 'utf8')); const ids = (process.argv[2] || '').split(',').filter(Boolean);
const shows = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, '')).shows;
for (const id of ids) {
  const r = map[id]; const c = r && r.cands && r.cands[0]; if (!c) { console.log(id, 'no candidate'); continue; }
  const buf = Buffer.from(await (await fetch(c.url, { headers: { 'user-agent': 'DiziPosterBot/1.0' } })).arrayBuffer()); const a = await assess(buf, sharp);
  if (!a.ok) { console.log(id, 'rejected by assess', a.reasons.join()); continue; }
  const h = createHash('sha1').update(id).digest('hex').slice(0, 12), path = 'data/posters/v3/' + h + '.webp'; mkdirSync('data/posters/v3', { recursive: true });
  writeFileSync(path, await sharp(buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  const s = shows.find((x) => x.id === id) || { id };
  let rec = { at: Date.now(), tries: (r.tries || 1), status: 'matched', conf: 'manual', src: c.src, ref: c.ref, name: c.name, premiered: c.premiered, url: c.url, w: a.w, h: a.h, sharp: a.sharp, ent: a.ent, score: a.score, path, prev: s.img2 || s.img || null, note: 'approved after visual comparison with the original banner' };
  try { rec = await pickBackdrop(s, rec, { sharp }); } catch {}
  map[id] = rec; console.log(id, 'promoted', c.name, portraitOk(rec) ? 'portrait-ok' : 'NOT PORTRAIT', rec.bg ? 'backdrop' : 'no-backdrop');
}
writeFileSync(MAP, JSON.stringify(map, null, 1));
