// اختيار بوستر عمودي أفضل لكل مسلسل (مجاني بالكامل): TMDB (إن وُجد مفتاح مجاني TMDB_API_KEY) ثم TVmaze (بلا مفتاح).
// السبب: بوسترات المصدر الحالية بانرات أفقية 600×326 تُقصّ عموديًا وتُكبَّر في Dizi فتبدو ضبابية.
// قواعد الأمان: لا نستبدل إلا عند تطابق مؤكد (الاسم التركي من الرابط يطابق اسم المسلسل + بلد تركيا + صورة صالحة)؛ غير ذلك تبقى الصورة الأصلية.
// القرار يُسجَّل في data/poster-map.json فلا يُعاد فحص المسلسل (المطابَق نهائيًا؛ غير المطابَق يُعاد بحد أقصى 4 مرات أسبوعيًا). الصور السابقة (img/img2) لا تُحذف.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UA = 'DiziPosterBot/1.0 (private family, non-commercial)';
const MAP = 'data/poster-map.json', DIR = 'data/posters/v3';
// القاعدة الدائمة: img3 (بوستر البطاقات والقوائم) لا يُعتمد إلا إذا كان عموديًا فعلًا (عرض/ارتفاع بين PORTRAIT_MIN و PORTRAIT_MAX). الصور الأفقية لا تدخل img3 أبدًا.
export const PORTRAIT_MIN = 0.55, PORTRAIT_MAX = 0.9;
export const portraitOk = (r) => !!(r && r.status === 'matched' && r.w && r.h && r.w / r.h >= PORTRAIT_MIN && r.w / r.h <= PORTRAIT_MAX && r.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TR = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u' };
export const norm = (s) => String(s || '').replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TR[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// أسماء بحث من معرّف المسلسل: الرابط غالبًا اسمه التركي بحروف لاتينية (tatli-kucuk-yalancilar). اللاحقة العشوائية (5 حروف بلا حروف علة) تُستبعد.
export function slugVariants(id) {
  const parts = String(id).toLowerCase().split('-').filter(Boolean); const v = [parts];
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last.length === 5) { if ((last.match(/[aeiou]/g) || []).length <= 1) v.unshift(parts.slice(0, -1)); else v.push(parts.slice(0, -1)); }   // لاحقة 5 حروف: تُجرَّب أولًا إن بلا حروف علة، وإلا كخيار أخير بعد الاسم الكامل
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

// مرشحون من TMDB (يتطلب مفتاحًا مجانيًا) أو TVmaze: exact = اسم مطابق تمامًا؛ partial = اسم يحتوي الآخر (يُقبل فقط بتأكيد عدد الحلقات). كلاهما بلد/لغة تركيا وبصورة.
async function candidates(v, tmdbKey) {
  const exact = [], partial = [];
  const add = (c, names) => { const ks = names.map(norm).filter(Boolean); if (ks.includes(v.key)) exact.push(c); else if (v.key.length >= 5 && ks.some((k) => k.length >= 5 && (k.includes(v.key) || v.key.includes(k)))) partial.push(c); };
  if (tmdbKey) {
    const j = await jget(`https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(tmdbKey)}&language=tr-TR&query=${encodeURIComponent(v.q)}`); await sleep(120);
    for (const r of j?.results || []) if (r.poster_path && (r.origin_country || []).includes('TR')) add({ src: 'tmdb', ref: String(r.id), name: r.original_name || r.name, premiered: (r.first_air_date || '').slice(0, 4), url: 'https://image.tmdb.org/t/p/w780' + r.poster_path }, [r.original_name, r.name]);
  }
  const t = await jget('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(v.q)); await sleep(550);
  for (const x of t || []) { const s = x.show; if (s.image?.original && isTR(s)) add({ src: 'tvmaze', ref: String(s.id), name: s.name, premiered: (s.premiered || '').slice(0, 4), url: s.image.original }, [s.name]); }
  return { exact, partial };
}
// مرحلة أخيرة للمسلسلات بلا تطابق اسمي تام: مرشحون تركيون بتشابه اسم معقول، وتُقبل فقط بتطابق عدد الحلقات الدقيق (±5%) — وإلا مراجعة.
const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
export const dice = (a, b) => { if (a.length < 2 || b.length < 2) return 0; const A = bigrams(a), B = bigrams(b); let n = 0; for (const [g, c] of A) n += Math.min(c, B.get(g) || 0); return (2 * n) / (a.length + b.length - 2); };
async function rawTR(q, tmdbKey) {
  const out = [];
  if (tmdbKey) { const j = await jget(`https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(tmdbKey)}&language=tr-TR&query=${encodeURIComponent(q)}`); await sleep(120); for (const r of j?.results || []) if (r.poster_path && (r.origin_country || []).includes('TR')) out.push({ src: 'tmdb', ref: String(r.id), name: r.original_name || r.name, premiered: (r.first_air_date || '').slice(0, 4), url: 'https://image.tmdb.org/t/p/w780' + r.poster_path }); }
  const t = await jget('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q)); await sleep(550);
  for (const x of t || []) { const s = x.show; if (s.image?.original && isTR(s)) out.push({ src: 'tvmaze', ref: String(s.id), name: s.name, premiered: (s.premiered || '').slice(0, 4), url: s.image.original }); }
  return out;
}
async function arabicTMDB(show, mine, tmdbKey) {   // TMDB يحوي ترجمات عربية لكثير من المسلسلات التركية: بحث بالعنوان العربي + بلد تركيا + تطابق عدد الحلقات
  if (!tmdbKey) return [];
  const q = String(show.title || '').replace(/^مسلسل\s+/, '').replace(/[«»]/g, '').trim(); if (q.length < 2) return [];
  const j = await jget(`https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(tmdbKey)}&language=ar&query=${encodeURIComponent(q)}`); await sleep(120);
  const ok = []; for (const r of (j?.results || []).slice(0, 5)) { if (!r.poster_path || !(r.origin_country || []).includes('TR')) continue; const c = { src: 'tmdb', ref: String(r.id), name: r.original_name || r.name, premiered: (r.first_air_date || '').slice(0, 4), url: 'https://image.tmdb.org/t/p/w780' + r.poster_path }; const n = await epCount(c, tmdbKey); if (near(n, mine, 2)) ok.push({ ...c, n, sim: 1 }); }
  return ok;
}
async function fuzzy(show, mine, tmdbKey) {
  const ar = await arabicTMDB(show, mine, tmdbKey); if (ar.length === 1) return { pool: ar, list: [ar[0].name], cands: ar, ok: ar };
  const vs = slugVariants(show.id); if (!vs.length) return { pool: [], list: [] };
  const words = vs[0].q.split(' '); const qs = [...new Set([vs[0].q, words.slice(0, 2).join(' '), ...words.filter((w) => w.length >= 5)])].slice(0, 4);
  const key = vs[0].key, seen = new Map();
  for (const q of qs) for (const c of await rawTR(q, tmdbKey)) { const k = c.src + ':' + c.ref; if (!seen.has(k)) seen.set(k, { ...c, sim: dice(norm(c.name), key) }); }
  const list = [...seen.values()].filter((c) => c.sim >= 0.45).sort((a, b) => b.sim - a.sim).slice(0, 3);
  const ok = []; for (const c of list) { const n = await epCount(c, tmdbKey); if (near(n, mine, 2)) ok.push({ ...c, n }); }
  return { pool: ok.length === 1 ? [ok[0]] : [], list: list.map((c) => c.name + ' (' + c.premiered + ')'), cands: list.map((c) => ({ src: c.src, ref: c.ref, name: c.name, premiered: c.premiered, url: c.url, sim: +c.sim.toFixed(2) })), ok };
}
// عدد حلقات المسلسل الأصلي (لحسم الأسماء المتشابهة وتأكيد المطابقة الجزئية)
async function epCount(c, tmdbKey) {
  if (c.src === 'tmdb') { const j = await jget(`https://api.themoviedb.org/3/tv/${c.ref}?api_key=${encodeURIComponent(tmdbKey)}`); await sleep(120); return j?.number_of_episodes ?? null; }
  const j = await jget('https://api.tvmaze.com/shows/' + c.ref + '/episodes'); await sleep(550);
  return Array.isArray(j) ? j.filter((x) => x.type === 'regular').length : null;
}
const near = (a, b, tol) => a != null && Math.abs(a - b) <= Math.max(tol, Math.round(b * (tol === 2 ? 0.05 : 0.1)));

// جودة الصورة: دقة، نسبة عمودية، حدّة (انحراف معياري لمرشّح لابلاس)، وتعدد الألوان
export async function assess(buf, sharp, { landscape = false } = {}) {
  const m = await sharp(buf).metadata(); const w = m.width || 0, h = m.height || 0, ar = w / (h || 1);
  const st = await sharp(buf).greyscale().resize({ width: 240 }).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 }).stats();
  const full = await sharp(buf).resize({ width: 120 }).stats();
  const sharpV = +st.channels[0].stdev.toFixed(2), ent = +full.entropy.toFixed(2);
  const reasons = [];
  if (w < (landscape ? 900 : 300)) reasons.push('low-res'); if (landscape ? (ar < 1.5 || ar > 2.1) : (ar < PORTRAIT_MIN || ar > PORTRAIT_MAX)) reasons.push('aspect'); if (sharpV < 3) reasons.push('soft'); if (ent < 3.2) reasons.push('flat');
  const score = +(Math.min(w, 1000) / 1000 * 0.45 + Math.min(sharpV / 20, 1) * 0.3 + Math.min(ent / 7.5, 1) * 0.15 + (1 - Math.min(Math.abs(ar - 0.667) / 0.15, 1)) * 0.1).toFixed(3);
  return { w, h, ar: +ar.toFixed(3), sharp: sharpV, ent, score, ok: reasons.length === 0 || (!landscape && reasons.length === 1 && reasons[0] === 'low-res' && w >= 200), reasons };   // دقة 200-299 تُقبل وتُسجَّل low-res للمراجعة
}

// خلفية أفقية سينمائية للـHero: أكبر صورة background (نسبة 16:9 تقريبًا، عرض ≥ 1000) من TVmaze، تُحفظ 1000px بجودة 72 في v4. غيابها لا يُعدّ خطأ.
const DIR4 = 'data/posters/v4';
export async function pickBackdrop(show, rec, { sharp, dry = false } = {}) {
  if (rec.src !== 'tvmaze') return { ...rec, bg: null };   // TMDB: backdrops تُضاف عند توفر مفتاح (غير مُجرَّب)
  const imgs = await jget('https://api.tvmaze.com/shows/' + rec.ref + '/images'); await sleep(550);
  const cand = (imgs || []).filter((x) => x.type === 'background').map((x) => x.resolutions?.original).filter((o) => o && o.url && o.width >= 1000 && o.width / o.height > 1.5 && o.width / o.height < 2.1).sort((p, q) => q.width - p.width);
  for (const o of cand.slice(0, 2)) {
    const r = await fetch(o.url, { headers: { 'user-agent': UA } }); if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer()); const a = await assess(buf, sharp, { landscape: true });
    if (!a.ok) continue;
    const h = createHash('sha1').update(show.id).digest('hex').slice(0, 12), path = DIR4 + '/' + h + '.webp';
    if (!dry) { mkdirSync(DIR4, { recursive: true }); writeFileSync(path, await sharp(buf).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer()); }
    return { ...rec, bg: { path, w: Math.min(o.width, 1000), url: o.url } };
  }
  return { ...rec, bg: null };
}

// يعالج مسلسلًا واحدًا. يعيد سجل القرار (بلا كتابة ملفات إن dry)
export async function pickPoster(show, { tmdbKey = process.env.TMDB_API_KEY, sharp, dry = false } = {}) {
  const rec = { at: Date.now(), tries: 1 };
  let found = { exact: [], partial: [] };
  for (const v of slugVariants(show.id)) { found = await candidates(v, tmdbKey); if (found.exact.length || found.partial.length) { rec.q = v.q; break; } }
  const mine = show.eps?.length || 0;
  let pool = [], conf = 'high';
  const uniq = (xs) => [...new Map(xs.map((c) => [c.src + ':' + c.ref, c])).values()];
  const tm = uniq(found.exact).filter((c) => c.src === 'tmdb'), ex = tm.length ? tm : uniq(found.exact);
  if (ex.length === 1) pool = ex;
  else if (ex.length > 1) {   // أسماء متطابقة (إعادة إنتاج): نحسم بعدد الحلقات، وإلا مراجعة
    const scored = []; for (const c of ex) scored.push({ c, n: await epCount(c, tmdbKey) });
    const ok = scored.filter((x) => near(x.n, mine, 3));
    if (ok.length === 1) { pool = [ok[0].c]; conf = 'medium'; rec.note = 'resolved by episode count ' + ok[0].n + '≈' + mine; }
    else return { ...rec, status: 'review', note: 'ambiguous: ' + ex.map((c) => c.name + ' (' + c.premiered + ')').join(' | ') };
  } else if (found.partial.length) {   // اسم جزئي: يُقبل فقط إن كان مرشحًا واحدًا وطابق عدد الحلقات بدقة
    const pc = uniq(found.partial);
    if (pc.length === 1) { const n = await epCount(pc[0], tmdbKey); if (near(n, mine, 2)) { pool = pc; conf = 'medium'; rec.note = 'partial name, episodes ' + n + '≈' + mine; } else return { ...rec, status: 'review', note: 'partial name "' + pc[0].name + '" but episodes ' + n + ' vs ' + mine, name: pc[0].name, url: pc[0].url }; }
    else return { ...rec, status: 'review', note: 'partial ambiguous: ' + pc.map((c) => c.name).join(' | ') };
  } else {
    const f = await fuzzy(show, mine, tmdbKey);
    if (f.pool.length === 1) { pool = f.pool; conf = 'low'; rec.note = 'fuzzy name sim ' + f.pool[0].sim.toFixed(2) + ', episodes ' + f.pool[0].n + '≈' + mine; }
    else if (f.list.length) return { ...rec, status: 'review', note: 'fuzzy candidates (episodes mismatch/ambiguous): ' + f.list.join(' | '), cands: f.cands };
    else return { ...rec, status: 'unmatched', note: 'no Turkish-name match for ' + show.id };
  }
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
  const base = { ...rec, conf, src: c.src, ref: c.ref, name: c.name, premiered: c.premiered, url: c.url, w: a.w, h: a.h, sharp: a.sharp, ent: a.ent, score: a.score };
  if (!a.ok) return { ...base, status: 'review', note: 'candidate rejected: ' + a.reasons.join(',') };
  const h = createHash('sha1').update(show.id).digest('hex').slice(0, 12), path = DIR + '/' + h + '.webp';
  if (!dry) { mkdirSync(DIR, { recursive: true }); writeFileSync(path, await sharp(buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()); }
  const matched = { ...base, status: 'matched', path, prev: show.img2 || show.img || null, ...(a.reasons.includes('low-res') ? { lowres: true } : {}) };
  try { return await pickBackdrop(show, matched, { sharp, dry }); } catch { return matched; }   // فشل شبكة عابر: يُعاد لاحقًا (bg غير مسجّل)
}

// يُستدعى من sync-qesset بعد تنزيل الصور: يعالج فقط المسلسلات التي لا سجل لها (أو غير المطابقة المستحقة لإعادة المحاولة)
export async function upgradePosters(shows, { max = 8, tmdbKey = process.env.TMDB_API_KEY } = {}) {
  let sharp = null; try { sharp = (await import('sharp')).default; } catch { return; }
  const map = existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : {}; let done = 0, dirty = false;
  const now = Date.now();
  for (const s of shows) {
    const r = map[s.id];
    if (r && r.status === 'matched') {   // معتمد سابقًا: لا إعادة فحص للبوستر؛ تُجلب الخلفية الأفقية مرة واحدة إن لم تُجرَّب بعد
      if (portraitOk(r) && !s.img3 && existsSync(r.path)) s.img3 = r.path;
      if (r.bg === undefined && done < max) { done++; try { map[s.id] = await pickBackdrop(s, r, { sharp }); dirty = true; console.log('backdrop', s.id, map[s.id].bg ? 'ok' : 'none'); } catch (e) { console.log('backdrop error', s.id, String(e).slice(0, 60)); } }
      const m = map[s.id]; if (m.bg && m.bg.path && !s.img4 && existsSync(m.bg.path)) s.img4 = m.bg.path;
      continue;
    }
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
  for (const s of data.shows) { const r = map[s.id]; if (portraitOk(r) && existsSync(r.path)) { s.img3 = r.path; n++; if (r.bg && r.bg.path && existsSync(r.bg.path)) s.img4 = r.bg.path; } }
  writeFileSync(f, JSON.stringify(data)); console.log('applied img3 to', n, 'shows'); process.exit(0);
}
// node scripts/poster-pick.mjs --backdrops [--limit N]  ← يجلب الخلفيات الأفقية للمسلسلات المطابَقة التي لم تُجرَّب
if (process.argv.includes('--backdrops')) {
  const sharp = (await import('sharp')).default; const map = JSON.parse(readFileSync(MAP, 'utf8')); const data = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, ''));
  const lim = process.argv.includes('--limit') ? +process.argv[process.argv.indexOf('--limit') + 1] : 1e9; let n = 0, ok = 0;
  for (const s of data.shows) { const r = map[s.id]; if (!r || r.status !== 'matched' || r.bg !== undefined) continue; if (n++ >= lim) break;
    try { map[s.id] = await pickBackdrop(s, r, { sharp }); if (map[s.id].bg) ok++; console.log(n, s.id, map[s.id].bg ? 'backdrop ' + map[s.id].bg.w : 'none'); } catch (e) { console.log(n, s.id, 'SKIPPED', String(e).slice(0, 50)); }
    if (n % 10 === 0) writeFileSync(MAP, JSON.stringify(map, null, 1)); }
  writeFileSync(MAP, JSON.stringify(map, null, 1)); console.log('backdrops:', ok, 'of', n); process.exit(0);
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
