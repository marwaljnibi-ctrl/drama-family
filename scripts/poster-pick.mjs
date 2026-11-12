// Dizi — اختيار بوستر عمودي حقيقي لكل مسلسل، فوق محرك الهوية scripts/lib/identity.mjs (المصدر الوحيد للبحث والتحقق).
// السبب: بوسترات المصدر بانرات أفقية 600×326 تُقصّ وتُكبَّر في Dizi فتبدو ضبابية.
// السجلات الدائمة: data/identity-index.json (هويات + أسماء + معرّفات + أدلة)، data/poster-map.json (قرار البوستر)، data/identity-overrides.json (تصحيحات بشرية، لها الأولوية دائمًا ولا تُستبدل).
// القواعد: مطابقة مؤكدة فقط (دليل قوي + نقاط + هامش)؛ المعتمد لا يُعاد فحصه ولا يُستبدل؛ غير المؤكد = غلاف مؤقت وإعادة محاولة بتباعد (1/3/7/14/30 يومًا) دون اختيار صورة خاطئة.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assess, portraitOk, PORTRAIT_MIN, PORTRAIT_MAX } from './lib/images.mjs';
import { resolveIdentity, choosePoster, chooseBackdrop, makeHttp, buildCatalog, catalogIndex, arKey, norm, slugVariants, dice } from './lib/identity.mjs';
export { assess, portraitOk, PORTRAIT_MIN, PORTRAIT_MAX, norm, slugVariants, dice };

const CAT = 'data/tr-catalog.json', MAP = 'data/poster-map.json', IDX = 'data/identity-index.json', OVR = 'data/identity-overrides.json', DIR = 'data/posters/v3', DIR4 = 'data/posters/v4';
const J = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) : d);
const save = (f, o) => writeFileSync(f, JSON.stringify(o, null, 1));
const DAY = 864e5, BACKOFF = [1, 3, 7, 14, 30];
export const nextTry = (tries, now = Date.now()) => now + BACKOFF[Math.min(tries, BACKOFF.length) - 1] * DAY;
const hashOf = (id) => createHash('sha1').update(id).digest('hex').slice(0, 12);
const slim = (c) => ({ src: c.src, ref: c.ref, name: c.original, premiered: c.year, score: c.score, evidence: c.evidence });
// فهرس تركي مُخزَّن: يُبنى عند الحاجة فقط (غير موجود/أقدم من 45 يومًا) وبمفتاح TMDB؛ غيابه لا يعطّل شيئًا
export async function getCatalog({ http = makeHttp(), key = process.env.TMDB_API_KEY, force = false } = {}) {
  const c = J(CAT, null); const fresh = c && Date.now() - c.at < (c.items?.length >= 200 ? 45 : 1) * DAY;   // فهرس صغير/فاشل يُعاد بعد يوم فقط
  if (fresh && !force) return catalogIndex(c.items); if (!key) return c ? catalogIndex(c.items) : null;
  const items = await buildCatalog({ ...http, key }); if (items.length < 200 && c && c.items?.length >= 200) return catalogIndex(c.items);   // فشل جزئي: نُبقي القديم
  writeFileSync(CAT, JSON.stringify({ at: Date.now(), items })); return catalogIndex(items);
}
export const loadIndex = () => { const i = J(IDX, null) || {}; return { v: 1, shows: i.shows || {}, aliases: i.aliases || {} }; };

// يسجّل هوية في الفهرس الدائم (المؤكَّد لا يُستبدل بغير المؤكَّد أبدًا) ويتعلّم أسماءه العربية كأسماء بديلة
export function recordIdentity(idx, show, ident, tries, now = Date.now()) {
  const old = idx.shows[show.id];
  if (ident.status === 'confirmed') {
    const b = ident.best; const names = (a) => [...new Set(a)].slice(0, 14);
    idx.shows[show.id] = { status: 'confirmed', src: b.src, ref: b.ref, imdb: b.imdb || null, wikidata: b.wikidata || null, original: b.original, year: b.year, ar: names([show.title, ...(b.ar || [])]), lat: names(b.lat || []), score: b.score, evidence: b.evidence, manual: (b.evidence || []).includes('manual-override') || undefined, cast: ident.cast?.length ? ident.cast : old?.cast, at: now };
    for (const n of [show.title, ...(b.ar || [])]) { const k = arKey(n); if (k.length >= 3 && b.src === 'tmdb' && !(idx.aliases[k] && idx.aliases[k] !== b.ref)) idx.aliases[k] = b.ref; }
  } else if (!old || old.status !== 'confirmed') idx.shows[show.id] = { status: 'unresolved', tries, checked: now, next: nextTry(tries, now), reason: ident.reason, cast: ident.cast?.length ? ident.cast : old?.cast, cands: (ident.cands || []).map(slim) };
}

async function saveImages(show, poster, bd, dry) {
  const h = hashOf(show.id), path = DIR + '/' + h + '.webp'; let bg = null;
  if (!dry) { mkdirSync(DIR, { recursive: true }); writeFileSync(path, await poster.sharp(poster.buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()); }
  if (bd) { const p4 = DIR4 + '/' + h + '.webp'; if (!dry) { mkdirSync(DIR4, { recursive: true }); writeFileSync(p4, await poster.sharp(bd.buf).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer()); } bg = { path: p4, w: bd.w, url: bd.url }; }
  return { path, bg };
}

// يعالج مسلسلًا واحدًا. يعيد { rec (قرار البوستر), ident (الهوية) } بلا كتابة سجلات (الصور تُكتب إلا إن dry)
export async function pickPoster(show, { tmdbKey = process.env.TMDB_API_KEY, sharp, dry = false, http = makeHttp(), override = null, known = null, learned = null, cast = null, catalog = null, tries = 1 } = {}) {
  const ctx = { ...http, key: tmdbKey || '', sharp }; const rec = { at: Date.now(), tries };
  const ident = known ? { status: 'confirmed', best: { ...known, evidence: known.evidence || [], score: known.score || 0 }, cands: [] } : await resolveIdentity(show, ctx, { override, learned, cast, catalog });
  if (ident.status !== 'confirmed') return { ident, rec: { ...rec, status: ident.cands?.length ? 'review' : 'unmatched', note: ident.reason || 'no candidates', cands: (ident.cands || []).map(slim) } };
  const b = ident.best; const poster = await choosePoster(b, ctx);
  const base = { ...rec, conf: (b.evidence || []).includes('manual-override') ? 'manual' : 'identity', src: b.src, ref: b.ref, name: b.original, premiered: b.year, idscore: b.score, evidence: b.evidence };
  if (!poster) return { ident, rec: { ...base, status: 'review', note: 'identity confirmed (' + b.original + ') but no suitable vertical poster yet' } };
  let bd = null; try { bd = await chooseBackdrop(b, ctx); } catch {}
  const { path, bg } = await saveImages(show, { sharp, buf: poster.buf }, bd && { ...bd, sharp }, dry); if (bg && bd) bg.w = bd.w;
  return { ident, rec: { ...base, status: 'matched', url: poster.url, lang: poster.lang, w: poster.a.w, h: poster.a.h, sharp: poster.a.sharp, ent: poster.a.ent, score: poster.a.score, path, bg, bgAt: Date.now(), prev: show.img2 || show.img || null, ...(poster.a.reasons.includes('low-res') ? { lowres: true } : {}) } };
}
// خلفية أفقية لمسلسل معتمد سابقًا (مرة واحدة؛ تُعاد بعد 30 يومًا إن لم توجد)
export async function pickBackdropFor(show, rec, { sharp, tmdbKey = process.env.TMDB_API_KEY, http = makeHttp(), dry = false } = {}) {
  const ctx = { ...http, key: tmdbKey || '', sharp }; if (rec.src === 'tmdb' && !ctx.key) return rec;
  const bd = await chooseBackdrop({ src: rec.src, ref: rec.ref }, ctx); if (!bd) return { ...rec, bg: null, bgAt: Date.now() };
  const p4 = DIR4 + '/' + hashOf(show.id) + '.webp'; if (!dry) { mkdirSync(DIR4, { recursive: true }); writeFileSync(p4, await sharp(bd.buf).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer()); }
  return { ...rec, bg: { path: p4, w: bd.w, url: bd.url }, bgAt: Date.now() };
}

// يُستدعى من sync-qesset: كل مسلسل بلا قرار نهائي يمرّ بالمحرك عند استحقاقه؛ المعتمد لا يُعاد فحصه ولا يُستبدل (إلا بتصحيح يدوي مختلف في identity-overrides.json)
export async function upgradePosters(shows, { max = 8, tmdbKey = process.env.TMDB_API_KEY } = {}) {
  let sharp = null; try { sharp = (await import('sharp')).default; } catch { return; }
  const map = J(MAP, {}), idx = loadIndex(), ovr = J(OVR, {}), http = makeHttp(); let done = 0, dirty = false, catalog; const now = Date.now();
  for (const s of shows) {
    const r = map[s.id], ov = ovr[s.id] && ovr[s.id].tmdb ? ovr[s.id] : null; const forced = !!ov && !(r && r.status === 'matched' && String(r.ref) === String(ov.tmdb));
    if (r && r.status === 'matched' && !forced) {
      if (portraitOk(r) && !s.img3 && existsSync(r.path)) s.img3 = r.path;
      if ((r.bg === undefined || (r.bg === null && r.src === 'tmdb' && !r.bgAt) || (r.bg === null && r.bgAt && now - r.bgAt > 30 * DAY)) && done < max) { done++; try { map[s.id] = await pickBackdropFor(s, r, { sharp, tmdbKey, http }); dirty = true; console.log('backdrop', s.id, map[s.id].bg ? 'ok' : 'none'); } catch (e) { console.log('backdrop error', s.id, String(e).slice(0, 60)); } }
      const m = map[s.id]; if (m.bg && m.bg.path && !s.img4 && existsSync(m.bg.path)) s.img4 = m.bg.path;
      continue;
    }
    if (!forced && r && now < (r.next || 0)) continue;
    if (done >= max) break; done++;
    try {
      if (catalog === undefined) { try { catalog = tmdbKey ? await getCatalog({ http, key: tmdbKey }) : null; } catch { catalog = null; } }
      const tries = (r && r.tries ? r.tries : 0) + 1, i0 = idx.shows[s.id];
      const known = !forced && i0 && i0.status === 'confirmed' ? { src: i0.src, ref: i0.ref, original: i0.original, year: i0.year, ar: i0.ar, lat: i0.lat, imdb: i0.imdb, evidence: i0.evidence, score: i0.score } : null;
      const { rec, ident } = await pickPoster(s, { sharp, tmdbKey, http, override: ov, known, learned: idx.aliases[arKey(s.title)] || null, cast: i0?.cast || null, catalog, tries });
      if (rec.status !== 'matched') rec.next = ident.transient ? now + 6 * 3600e3 : nextTry(tries, now);   // فشل شبكة عابر ≠ "غير موجود": إعادة بعد 6 ساعات بلا زيادة التباعد
      if (ident.transient && rec.status !== 'matched') rec.tries = tries - 1;
      map[s.id] = rec; if (!known && !(ident.transient && ident.status !== 'confirmed')) recordIdentity(idx, s, ident, tries, now); dirty = true; if (rec.status === 'matched') { s.img3 = rec.path; if (rec.bg && rec.bg.path) s.img4 = rec.bg.path; }
      console.log('poster', s.id, rec.status, rec.name || '', rec.w ? rec.w + 'x' + rec.h : '', (rec.evidence || []).join(','));
    } catch (e) { console.log('poster error', s.id, String(e).slice(0, 80)); }
  }
  if (dirty) { save(MAP, map); save(IDX, idx); }
}

// ===== CLI =====
const A = process.argv, has = (k) => A.includes(k), arg = (k) => { const i = A.indexOf(k); return i > 0 ? A[i + 1] : null; };
const isMain = A[1] && A[1].endsWith('poster-pick.mjs');
// node scripts/poster-pick.mjs --apply [file]  ← يضيف img3/img4 من السجل إلى shows.json (بلا أي تغيير آخر)
if (isMain && has('--apply')) {
  const f = arg('--apply')?.endsWith('.json') ? arg('--apply') : 'data/shows.json'; const data = J(f, {}), map = J(MAP, {}); let n = 0;
  for (const s of data.shows) { const r = map[s.id]; if (portraitOk(r) && existsSync(r.path)) { s.img3 = r.path; n++; if (r.bg && r.bg.path && existsSync(r.bg.path)) s.img4 = r.bg.path; } }
  writeFileSync(f, JSON.stringify(data)); console.log('applied img3 to', n, 'shows'); process.exit(0);
}
// node scripts/poster-pick.mjs --backdrops [--limit N]  ← خلفيات أفقية للمعتمد الذي لم تُجرَّب له
if (isMain && has('--backdrops')) {
  const sharp = (await import('sharp')).default; const map = J(MAP, {}), data = J('data/shows.json', { shows: [] }); const lim = arg('--limit') ? +arg('--limit') : 1e9; let n = 0, ok = 0;
  for (const s of data.shows) { const r = map[s.id]; if (!r || r.status !== 'matched' || r.bg !== undefined && !(r.bg === null && r.src === 'tmdb' && !r.bgAt)) continue; if (n++ >= lim) break; try { map[s.id] = await pickBackdropFor(s, r, { sharp }); if (map[s.id].bg) ok++; } catch {} if (n % 10 === 0) save(MAP, map); }
  save(MAP, map); console.log('backdrops:', ok, 'of', n); process.exit(0);
}
// node scripts/poster-pick.mjs --catalog  ← يعيد بناء فهرس المسلسلات التركية
if (isMain && has('--catalog')) { const m = await getCatalog({ force: true }); console.log('catalog keys:', m ? m.size : 0); process.exit(0); }
// node scripts/poster-pick.mjs --resolve [--ids a,b] [--all] [--limit N] [--force]  ← يعالج غير المعتمد (أو المحدَّد) ويطبع الأدلة
if (isMain && has('--resolve')) {
  const sharp = (await import('sharp')).default; const map = J(MAP, {}), idx = loadIndex(), ovr = J(OVR, {}), data = J('data/shows.json', { shows: [] }), http = makeHttp(); const catalog = await getCatalog({ http });
  let list = data.shows; if (arg('--ids')) { const ids = new Set(arg('--ids').split(',')); list = list.filter((s) => ids.has(s.id)); } else if (!has('--all')) list = list.filter((s) => !map[s.id] || map[s.id].status !== 'matched');
  if (arg('--limit')) list = list.slice(0, +arg('--limit')); const c = {};
  for (const s of list) {
    const r = map[s.id]; if (r && r.status === 'matched' && !has('--force') && !(ovr[s.id])) continue; if (r && r.conf === 'manual' && !(ovr[s.id])) continue;
    const tries = (r && r.tries ? r.tries : 0) + 1; const { rec, ident } = await pickPoster(s, { sharp, http, override: ovr[s.id]?.tmdb ? ovr[s.id] : null, learned: idx.aliases[arKey(s.title)] || null, cast: idx.shows[s.id]?.cast || null, catalog, tries });
    if (rec.status !== 'matched') rec.next = nextTry(tries); map[s.id] = rec; recordIdentity(idx, s, ident, tries); c[rec.status] = (c[rec.status] || 0) + 1; save(MAP, map); save(IDX, idx);
    const b = ident.best; console.log(rec.status.toUpperCase(), s.id, '|', s.title, '|', b ? `${b.original} (${b.year}) ${b.src}#${b.ref} score=${b.score} [${(b.evidence || []).join(',')}]` : ident.reason, rec.status !== 'matched' ? '| ' + (rec.note || '') + ' | ' + (ident.cands || []).map((x) => `${x.original}(${x.year})#${x.ref}:${x.score}`).join(' ; ') : '');
  }
  console.log(JSON.stringify(c)); process.exit(0);
}
// node scripts/poster-pick.mjs --audit [--limit N]  ← يعيد حل مسلسلات TMDB المعتمدة بلا كتابة، ويقارن بالمسجَّل (معايرة المحرك)
if (isMain && has('--audit')) {
  const sharp = (await import('sharp')).default; const map = J(MAP, {}), data = J('data/shows.json', { shows: [] }), http = makeHttp(); const ctx = { ...http, key: process.env.TMDB_API_KEY, sharp }; const catalog = await getCatalog({ http }); const c = { agree: 0, diff: 0, unresolved: 0 }; let n = 0; const lim = arg('--limit') ? +arg('--limit') : 40;
  for (const s of data.shows) { const r = map[s.id]; if (!r || r.status !== 'matched' || r.src !== 'tmdb') continue; if (n++ >= lim) break; const x = await resolveIdentity(s, ctx, { catalog }); const k = x.status === 'confirmed' ? (String(x.best.ref) === String(r.ref) ? 'agree' : 'diff') : 'unresolved'; c[k]++; console.log(k.toUpperCase(), s.id, '|', s.title, '| stored', r.name, '#' + r.ref, '| engine', x.best ? x.best.original + ' #' + x.best.ref + ' ' + x.best.score + ' [' + (x.best.evidence || []).join(',') + ']' : x.reason); }
  console.log(JSON.stringify(c)); process.exit(0);
}
