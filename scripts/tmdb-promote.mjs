// يعتمد مطابقات TMDB راجعها إنسان (معرّف المسلسل ← اسم تركي + سنة): يجلب البوستر ويتحقق أنه عمودي ويحفظه كمعتمد (conf=manual) مع خلفية إن وُجدت.
import sharp from 'sharp'; import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'; import { createHash } from 'node:crypto';
import { assess, portraitOk } from './poster-pick.mjs';
const K = process.env.TMDB_API_KEY, MAP = 'data/poster-map.json'; const map = JSON.parse(readFileSync(MAP, 'utf8'));
const L = {
  'ilk-ask-lpvrm': ['4N1K İlk Aşk', 2018], 'hayat-vqrnt': ['Hayat Sevince Güzel', 2016], 'sosyete-jrqmv': ['Yüksek Sosyete', 2016], 'abqari-kntvs': ['Deha', 2024], 'alp-arslan-kqvdr': ['Alparslan: Büyük Selçuklu', 2021],
  'uckizkardes-mplfv': ['Üç Kız Kardeş', 2022], 'olenekadar-rmpts': ['Ölene Kadar', 2017], 'eskiya-kqvmt': ['Eşkıya Dünyaya Hükümdar Olmaz', 2015], 'benbucihana-vtspq': ['Ben Bu Cihana Sığmazam', 2022],
  'barbaros-kqvmp': ['Barbaroslar', 2021], 'bodrummasali-rgxne': ['Bodrum Masalı', 2016], 'banasevmeyi-kmfrs': ['Bana Sevmeyi Anlat', 2016], 'yildizlarsahidim-bqtsv': ['Yıldızlar Şahidim', 2017], 'cobanyildizi-mfrqe': ['Çoban Yıldızı', 2017],
  'gulumseyeter-vcpam': ['Gülümse Yeter', 2016], 'adisevgi-ltqmp': ['Adı Sevgi', 2022], 'fariha-lqvts': ['Adını Feriha Koydum', 2011], 'lissw-hqvnt': ['Hayat Bazen Tatlıdır', 2016], 'atroq-babi-fqvms': ['Sen Çal Kapımı', 2020],
  'tlsth-vqgmn': ['Eve Düşen Yıldırım', 2012], 'efsane-wqjtm': ['Adı Efsane', 2017] };
const J = async (u) => (await fetch(u)).json();
for (const [id, [q, y]] of Object.entries(L)) {
  const r = await J(`https://api.themoviedb.org/3/search/tv?api_key=${K}&language=tr-TR&query=${encodeURIComponent(q)}`); const x = (r.results || []).find((z) => z.poster_path && (z.origin_country || []).includes('TR') && String(z.first_air_date || '').startsWith(String(y)));
  if (!x) { console.log(id, 'NOT FOUND'); continue; }
  const buf = Buffer.from(await (await fetch('https://image.tmdb.org/t/p/w780' + x.poster_path)).arrayBuffer()); const a = await assess(buf, sharp); if (!a.ok) { console.log(id, 'rejected', a.reasons.join()); continue; }
  const h = createHash('sha1').update(id).digest('hex').slice(0, 12), path = 'data/posters/v3/' + h + '.webp'; mkdirSync('data/posters/v3', { recursive: true });
  writeFileSync(path, await sharp(buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  const rec = { at: Date.now(), tries: 1, status: 'matched', conf: 'manual', src: 'tmdb', ref: String(x.id), name: x.original_name, premiered: String(y), url: 'https://image.tmdb.org/t/p/w780' + x.poster_path, w: a.w, h: a.h, sharp: a.sharp, ent: a.ent, score: a.score, path, note: 'approved after human review of Arabic/Turkish title + year + episode count' };
  let bg = null; try { const im = await J(`https://api.themoviedb.org/3/tv/${x.id}/images?api_key=${K}`); const b = (im.backdrops || []).filter((z) => z.aspect_ratio > 1.6 && z.width >= 1000)[0]; if (b) { const bb = Buffer.from(await (await fetch('https://image.tmdb.org/t/p/w1280' + b.file_path)).arrayBuffer()); mkdirSync('data/posters/v4', { recursive: true }); const p4 = 'data/posters/v4/' + h + '.webp'; writeFileSync(p4, await sharp(bb).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()); bg = { path: p4, w: Math.min(b.width, 1000), url: 'https://image.tmdb.org/t/p/w1280' + b.file_path }; } } catch {}
  rec.bg = bg; map[id] = rec; console.log(id, 'promoted', x.original_name, x.first_air_date, portraitOk(rec) ? 'portrait-ok' : 'NOT-PORTRAIT', bg ? 'bg' : 'no-bg');
}
writeFileSync(MAP, JSON.stringify(map, null, 1));
