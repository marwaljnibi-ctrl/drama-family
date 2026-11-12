// بحث يدوي مساعد: للمسلسلات غير المطابَقة يجلب أفضل مرشحي TMDB (بالعنوان العربي، بلا قيود) ويحفظها في poster-map (cands) للمراجعة البشرية.
import { readFileSync, writeFileSync } from 'node:fs';
const K = process.env.TMDB_API_KEY; const MAP = 'data/poster-map.json'; const map = JSON.parse(readFileSync(MAP, 'utf8'));
const shows = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, '')).shows;
const j = async (u) => { try { return await (await fetch(u)).json(); } catch { return null; } };
const out = [];
for (const s of shows) {
  if (map[s.id]?.status === 'matched') continue;
  const q = String(s.title || '').replace(/^مسلسل\s+/, '').replace(/[«»]/g, '').trim(); const cands = [];
  for (const lang of ['ar', 'tr-TR']) { const r = await j(`https://api.themoviedb.org/3/search/tv?api_key=${K}&language=${lang}&query=${encodeURIComponent(q)}`); for (const x of (r?.results || []).slice(0, 4)) if (x.poster_path && !cands.some((c) => c.ref === String(x.id))) cands.push({ src: 'tmdb', ref: String(x.id), name: x.original_name || x.name, ar: x.name, premiered: (x.first_air_date || '').slice(0, 4), country: (x.origin_country || []).join(), url: 'https://image.tmdb.org/t/p/w780' + x.poster_path }); }
  for (const c of cands.slice(0, 4)) { const d = await j(`https://api.themoviedb.org/3/tv/${c.ref}?api_key=${K}`); c.n = d?.number_of_episodes ?? null; }
  out.push({ id: s.id, title: s.title, eps: s.eps.length, cands: cands.slice(0, 4) });
  map[s.id] = { ...(map[s.id] || { status: 'review' }), lookup: cands.slice(0, 4) };
  console.log(s.id, '|', q, '|', s.eps.length, '|', cands.slice(0, 3).map((c) => `${c.name}/${c.ar} ${c.premiered} ${c.country} n${c.n}`).join(' ; '));
}
writeFileSync('lookup.json', JSON.stringify(out, null, 1));
