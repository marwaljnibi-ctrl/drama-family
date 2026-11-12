// اختيار بوستر عمودي أفضل لكل مسلسل (مجاني بالكامل): TMDB (إن وُجد مفتاح مجاني TMDB_API_KEY) ثم TVmaze (بلا مفتاح).
// السبب: بوسترات المصدر الحالية بانرات أفقية 600×326 تُقصّ عموديًا وتُكبَّر في Dizi فتبدو ضبابية.
// قواعد الأمان: لا نستبدل إلا عند تطابق مؤكد (الاسم التركي من الرابط يطابق اسم المسلسل + بلد تركيا + صورة صالحة)؛ غير ذلك تبقى الصورة الأصلية.
// القرار يُسجَّل في data/poster-map.json فلا يُعاد فحص المسلسل (المطابَق نهائيًا؛ غير المطابَق يُعاد بحد أقصى 4 مرات أسبوعيًا). الصور السابقة (img/img2) لا تُحذف.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UA = 'DiziPosterBot/1.0 (private family, non-commercial)';
const MAP = 'data/poster-map.json', DIR = 'data/posters/v3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TR = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u' };
export const norm = (s) => String(s || '').replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TR[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// أسماء بحث من معرّف المسلسل: الرابط غالبًا اسمه التركي بحروف لاتينية (tatli-kucuk-yalancilar). اللاحقة العشوائية (5 حروف بلا حروف علة) تُستبعد.
export function slugVariants(id) {
  const parts = String(id).toLowerCase().split('-').filter(Boolean); const v = [parts];
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last.length === 5 && (last.match(/[aeiou]/g) || []).length <= 1) v.unshift(parts.slice(0, -1));
  return v.map((p) => ({ q: p.join(' '), key: p.join('') })).filter((x) => x.key.length >= 3 && !/^\d+$/.test(x.key));
}

async function jget(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    let r; try { r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } }); } catch (e) { if (i === tries - 1) throw new Error('network: ' + (e.cause?.code || e.message)); await sleep(2000 * (i + 1)); continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) return null; return r.json();
  }
  return null;
}
const isTR = (s) => [s.network?.country?.code, s.webChannel?.country?.code].includes('TR') || s.language === 'Turkish';

// مرشحون من TMDB (يتطلب مفتاحًا مجانيًا) أو TVmaze؛ كلٌّ بتطابق تام للاسم وبلد تركيا
async function candidates(v, tmdbKey) {
  const out = [];
  if (tmdbKey) {
    const j = await jget(`https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(tmdbKey)}&language=tr-TR&query=${encodeURIComponent(v.q)}`); await sleep(120);
    for (const r of j?.results || []) if (r.poster_path && (r.origin_country || []).includes('TR') && [r.original_name, r.name].some((n) => norm(n) === v.key)) out.push({ src: 'tmdb', ref: String(r.id), name: r.original_name || r.name, premiered: (r.first_air_date || '').slice(0, 4), url: 'https://image.tmdb.org/t/p/w780' + r.poster_path });
  }
  const t = await jget('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(v.q)); await sleep(550);
  for (const x of t || []) { const s = x.show; if (s.image?.original && isTR(s) && norm(s.name) === v.key) out.push({ src: 'tvmaze', ref: String(s.id), name: s.name, premiered: (s.premiered || '').slice(0, 4), url: s.image.original }); }
  return out;
}

// جودة الصورة: دقة، نسبة عمودية، حدّة (انحراف معياري لمرشّح لابلاس)، وتعدد الألوان
export async function assess(buf, sharp) {
  const m = await sharp(buf).metadata(); const w = m.width || 0, h = m.height || 0, ar = w / (h || 1);
  const st = await sharp(buf).greyscale().resize({ width: 240 }).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 }).stats();
  const full = await sharp(buf).resize({ width: 120 }).stats();
  const sharpV = +st.channels[0].stdev.toFixed(2), ent = +full.entropy.toFixed(2);
  const reasons = [];
  if (w < 300) reasons.push('low-res'); if (ar < 0.55 || ar > 0.8) reasons.push('aspect'); if (sharpV < 3) reasons.push('soft'); if (ent < 4.5) reasons.push('flat');
  const score = +(Math.min(w, 1000) / 1000 * 0.45 + Math.min(sharpV / 20, 1) * 0.3 + Math.min(ent / 7.5, 1) * 0.15 + (1 - Math.min(Math.abs(ar - 0.667) / 0.15, 1)) * 0.1).toFixed(3);
  return { w, h, ar: +ar.toFixed(3), sharp: sharpV, ent, score, ok: reasons.length === 0 || (reasons.length === 1 && reasons[0] === 'low-res' && w >= 280), reasons };
}

// يعالج مسلسلًا واحدًا. يعيد سجل القرار (بلا كتابة ملفات إن dry)
export async function pickPoster(show, { tmdbKey = process.env.TMDB_API_KEY, sharp, dry = false } = {}) {
  const rec = { at: Date.now(), tries: 1 };
  let cands = [];
  for (const v of slugVariants(show.id)) { cands = await candidates(v, tmdbKey); if (cands.length) { rec.q = v.q; break; } }
  if (!cands.length) return { ...rec, status: 'unmatched', note: 'no exact Turkish-name match for ' + show.id };
  const distinct = new Set(cands.map((c) => c.src + ':' + c.ref)); const byRef = [...distinct];
  const tmdb = cands.filter((c) => c.src === 'tmdb'); const pool = tmdb.length ? tmdb : cands;
  if (new Set(pool.map((c) => c.ref)).size > 1) return { ...rec, status: 'review', note: 'ambiguous: ' + pool.map((c) => c.src + ':' + c.name + ' (' + c.premiered + ')').join(' | ') };
  let best = null;
  for (const c of pool) {
    const r = await fetch(c.url, { headers: { 'user-agent': UA } }); if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer()); let a = await assess(buf, sharp), pick = { c, a, buf };
    // صورة TVmaze الرئيسية أفقية؟ نجرّب بقية صور المسلسل من نوع poster بحثًا عن عمودية صالحة
    if (!a.ok && c.src === 'tvmaze' && a.reasons.includes('aspect')) {
      const imgs = await jget('https://api.tvmaze.com/shows/' + c.ref + '/images'); await sleep(550);
      for (const im of (imgs || []).filter((x) => x.type === 'poster').sort((p, q) => (q.resolutions?.original?.width || 0) - (p.resolutions?.original?.width || 0)).slice(0, 3)) {
        const u = im.resolutions?.original?.url; if (!u) continue; const rr = await fetch(u, { headers: { 'user-agent': UA } }); if (!rr.ok) continue;
        const b2 = Buffer.from(await rr.arrayBuffer()), a2 = await assess(b2, sharp); if (a2.ok) { pick = { c: { ...c, url: u }, a: a2, buf: b2 }; break; }
      }
    }
    if (!best || pick.a.score > best.a.score) best = pick;
  }
  if (!best) return { ...rec, status: 'review', note: 'image download failed' };
  const { c, a, buf } = best;
  const base = { ...rec, src: c.src, ref: c.ref, name: c.name, premiered: c.premiered, url: c.url, w: a.w, h: a.h, sharp: a.sharp, ent: a.ent, score: a.score };
  if (!a.ok) return { ...base, status: 'review', note: 'candidate rejected: ' + a.reasons.join(',') };
  const h = createHash('sha1').update(show.id).digest('hex').slice(0, 12), path = DIR + '/' + h + '.webp';
  if (!dry) { mkdirSync(DIR, { recursive: true }); writeFileSync(path, await sharp(buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()); }
  return { ...base, status: 'matched', path, prev: show.img2 || show.img || null };
}

// يُستدعى من sync-qesset بعد تنزيل الصور: يعالج فقط المسلسلات التي لا سجل لها (أو غير المطابقة المستحقة لإعادة المحاولة)
export async function upgradePosters(shows, { max = 8, tmdbKey = process.env.TMDB_API_KEY } = {}) {
  let sharp = null; try { sharp = (await import('sharp')).default; } catch { return; }
  const map = existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : {}; let done = 0, dirty = false;
  const now = Date.now();
  for (const s of shows) {
    const r = map[s.id];
    if (r && r.status === 'matched') { if (r.path && !s.img3 && existsSync(r.path)) s.img3 = r.path; continue; }   // معتمد سابقًا: لا إعادة فحص
    if (r && (r.status === 'review' || r.tries >= 4 || now < (r.next || 0))) continue;
    if (done >= max) break;
    done++;
    try {
      const rec = await pickPoster(s, { sharp, tmdbKey });
      if (r && r.tries) rec.tries = r.tries + 1; if (rec.status === 'unmatched') rec.next = now + 7 * 864e5;
      map[s.id] = rec; dirty = true; if (rec.status === 'matched') s.img3 = rec.path;
      console.log('poster', s.id, rec.status, rec.name || '', rec.w ? rec.w + 'x' + rec.h : '');
    } catch (e) { console.log('poster error', s.id, String(e).slice(0, 80)); }
  }
  if (dirty) writeFileSync(MAP, JSON.stringify(map, null, 1));
}

// node scripts/poster-pick.mjs --apply [file]  ← يضيف img3 من السجل إلى shows.json (بلا أي تغيير آخر)
if (process.argv.includes('--apply')) {
  const f = process.argv[process.argv.indexOf('--apply') + 1]?.endsWith('.json') ? process.argv[process.argv.indexOf('--apply') + 1] : 'data/shows.json';
  const data = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')), map = JSON.parse(readFileSync(MAP, 'utf8')); let n = 0;
  for (const s of data.shows) { const r = map[s.id]; if (r && r.status === 'matched' && existsSync(r.path)) { s.img3 = r.path; n++; } }
  writeFileSync(f, JSON.stringify(data)); console.log('applied img3 to', n, 'shows'); process.exit(0);
}
// CLI: node scripts/poster-pick.mjs [--ids a,b] [--limit N] [--all] [--dry] [--out report.json]
if (process.argv[1] && process.argv[1].endsWith('poster-pick.mjs') && process.argv.length > 2) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const sharp = (await import('sharp')).default; const dry = process.argv.includes('--dry');
  const data = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, '')); let list = data.shows;
  if (arg('--ids')) { const ids = new Set(arg('--ids').split(',')); list = list.filter((s) => ids.has(s.id)); }
  if (arg('--limit')) list = list.slice(0, +arg('--limit'));
  const map = existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : {}; const res = {};
  for (const [i, s] of list.entries()) {
    const old = map[s.id]; if (old && old.status === 'matched' && !process.argv.includes('--force')) { res[s.id] = old; continue; }
    let rec; try { rec = await pickPoster(s, { sharp, dry }); } catch (e) { console.log(`${i + 1}/${list.length}`, s.id, 'SKIPPED (transient)', String(e).slice(0, 60)); continue; }   // خطأ شبكة عابر: لا يُسجَّل ويُعاد لاحقًا
    res[s.id] = rec; if (!dry) { map[s.id] = rec; if (i % 10 === 9) writeFileSync(MAP, JSON.stringify(map, null, 1)); }
    console.log(`${i + 1}/${list.length}`, s.id, rec.status, rec.name || '', rec.w ? rec.w + 'x' + rec.h + ' s' + rec.sharp : rec.note || '');
  }
  if (!dry) writeFileSync(MAP, JSON.stringify(map, null, 1));
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(res, null, 1));
  const c = {}; for (const r of Object.values(res)) c[r.status] = (c[r.status] || 0) + 1; console.log(JSON.stringify(c));
}
