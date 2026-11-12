// Dizi — اختيار بوستر عمودي حقيقي لكل مسلسل، فوق محرك الهوية scripts/lib/identity.mjs (المصدر الوحيد للبحث والتحقق).
// السبب: بوسترات المصدر بانرات أفقية 600×326 تُقصّ وتُكبَّر في Dizi فتبدو ضبابية.
// السجلات الدائمة: data/identity-index.json (هويات + أسماء + معرّفات + أدلة)، data/poster-map.json (قرار البوستر)، data/identity-overrides.json (تصحيحات بشرية، لها الأولوية دائمًا ولا تُستبدل).
// القواعد: مطابقة مؤكدة فقط (دليل قوي + نقاط + هامش)؛ المعتمد لا يُعاد فحصه ولا يُستبدل؛ غير المؤكد = غلاف مؤقت وإعادة محاولة بتباعد (1/3/7/14/30 يومًا) دون اختيار صورة خاطئة.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assess, portraitOk, PORTRAIT_MIN, PORTRAIT_MAX } from './lib/images.mjs';
import { strictOk } from './lib/images.mjs';
import { resolveIdentity, choosePoster, makeHttp, buildCatalog, catalogIndex, arKey, norm, slugVariants, dice } from './lib/identity.mjs';
export { assess, portraitOk, PORTRAIT_MIN, PORTRAIT_MAX, norm, slugVariants, dice };

const CAT = 'data/tr-catalog.json', MAP = 'data/poster-map.json', IDX = 'data/identity-index.json', OVR = 'data/identity-overrides.json', DIR = 'data/posters/v3';
const J = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) : d);
const save = (f, o) => writeFileSync(f, JSON.stringify(o, null, 1));
const DAY = 864e5, BACKOFF = [1, 3, 7, 14, 30];
export const nextTry = (tries, now = Date.now()) => now + BACKOFF[Math.min(tries, BACKOFF.length) - 1] * DAY;
// identity-overrides.json: { id: { tmdb: 123 } } تصحيح قاطع (يتفوق دائمًا) | { id: { names: ['Turkish Name'] } } تلميح اسم يتحقق منه المحرك بالأدلة (سنة/حلقات/ممثلون/صورة)
const withHints = (s, o) => (o && o.names ? { ...s, hints: { ...(s.hints || {}), names: o.names } } : s);
const hashOf = (id) => createHash('sha1').update(id).digest('hex').slice(0, 12);
const REV = 'data/poster-review.json';
// قائمة المراجعة: كل مسلسل بلا بوستر معتمد (لم يُحسم/بحاجة مراجعة) مع سبب ومرشحين وموعد المحاولة التالية. تُحدَّث تلقائيًا مع المزامنة؛ لا إشعارات ولا تنبيهات (لا تكرار). since يُحفظ من أول ظهور.
export function buildReview(map, idx, prev = {}) {
  const items = {};
  for (const [id, r] of Object.entries(map)) { if (!r || r.status === 'matched') continue; items[id] = { id, status: r.status, note: r.note || '', tries: r.tries || 0, since: prev[id]?.since || r.at || Date.now(), next: r.next || null, tr: idx?.shows?.[id]?.original || null, candidates: (r.cands || []).slice(0, 3).map((c) => ({ name: c.name, ref: c.ref, year: c.premiered, score: c.score })) }; }
  return { count: Object.keys(items).length, items };
}
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

async function saveImages(show, poster, dry) {
  const h = hashOf(show.id), path = DIR + '/' + h + '.webp';
  if (!dry) { mkdirSync(DIR, { recursive: true }); writeFileSync(path, await poster.sharp(poster.buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()); }
  return { path };
}

// يعالج مسلسلًا واحدًا. يعيد { rec (قرار البوستر), ident (الهوية) } بلا كتابة سجلات (الصور تُكتب إلا إن dry)
export async function pickPoster(show, { tmdbKey = process.env.TMDB_API_KEY, sharp, dry = false, http = makeHttp(), override = null, known = null, learned = null, cast = null, catalog = null, tries = 1 } = {}) {
  const ctx = { ...http, key: tmdbKey || '', sharp }; const rec = { at: Date.now(), tries };
  const ident = known ? { status: 'confirmed', best: { ...known, evidence: known.evidence || [], score: known.score || 0 }, cands: [] } : await resolveIdentity(show, ctx, { override, learned, cast, catalog });
  if (ident.status !== 'confirmed') return { ident, rec: { ...rec, status: ident.cands?.length ? 'review' : 'unmatched', note: ident.reason || 'no candidates', cands: (ident.cands || []).map(slim) } };
  const b = ident.best; const poster = await choosePoster(b, ctx);
  const base = { ...rec, conf: (b.evidence || []).includes('manual-override') ? 'manual' : 'identity', src: b.src, ref: b.ref, name: b.original, premiered: b.year, idscore: b.score, evidence: b.evidence };
  if (!poster) return { ident, rec: { ...base, status: 'review', note: 'identity confirmed (' + b.original + ') but no suitable vertical poster yet' } };
  // القاعدة الدائمة: لا يُعتمد بوستر إلا إن كان 2:3 حقيقيًا. غير ذلك = غلاف مؤقت + سجل مراجعة (تُعاد المحاولة لاحقًا بمصادر أخرى)، ولا قص ولا تمديد.
  if (!strictOk(poster.a.w, poster.a.h)) return { ident, rec: { ...base, status: 'review', note: 'identity confirmed (' + b.original + ') but best poster is not 2:3 (ratio ' + (poster.a.w / poster.a.h).toFixed(2) + ') — placeholder until a real 2:3 poster exists' } };
  const { path } = await saveImages(show, { sharp, buf: poster.buf }, dry);
  return { ident, rec: { ...base, status: 'matched', url: poster.url, lang: poster.lang, w: poster.a.w, h: poster.a.h, sharp: poster.a.sharp, ent: poster.a.ent, score: poster.a.score, path, prev: show.img2 || show.img || null, ...(poster.a.reasons.includes('low-res') ? { lowres: true } : {}) } };
}
// يُستدعى من sync-qesset: كل مسلسل بلا قرار نهائي يمرّ بالمحرك عند استحقاقه؛ المعتمد لا يُعاد فحصه ولا يُستبدل (إلا بتصحيح يدوي مختلف في identity-overrides.json)
export async function upgradePosters(shows, { max = 8, tmdbKey = process.env.TMDB_API_KEY } = {}) {
  let sharp = null; try { sharp = (await import('sharp')).default; } catch { return; }
  const map = J(MAP, {}), idx = loadIndex(), ovr = J(OVR, {}), http = makeHttp(); let done = 0, dirty = false, catalog; const now = Date.now();
  for (const s of shows) {
    { const i0 = idx.shows[s.id], r0 = map[s.id]; const tn = (i0 && i0.status === 'confirmed' && i0.original) || (r0 && r0.status === 'matched' && r0.name); if (tn) s.tr = tn; }   // الاسم التركي للبحث المحلي
    const r = map[s.id], ov = ovr[s.id] && ovr[s.id].tmdb ? ovr[s.id] : null; const forced = !!ov && !(r && r.status === 'matched' && String(r.ref) === String(ov.tmdb));
    if (r && r.status === 'matched' && !forced) {
      if (portraitOk(r) && !s.img3 && existsSync(r.path)) s.img3 = r.path;
      continue;
    }
    if (!forced && r && now < (r.next || 0)) continue;
    if (done >= max) break; done++;
    try {
      if (catalog === undefined) { try { catalog = tmdbKey ? await getCatalog({ http, key: tmdbKey }) : null; } catch { catalog = null; } }
      const tries = (r && r.tries ? r.tries : 0) + 1, i0 = idx.shows[s.id];
      const known = !forced && i0 && i0.status === 'confirmed' ? { src: i0.src, ref: i0.ref, original: i0.original, year: i0.year, ar: i0.ar, lat: i0.lat, imdb: i0.imdb, evidence: i0.evidence, score: i0.score } : null;
      const { rec, ident } = await pickPoster(withHints(s, ovr[s.id]), { sharp, tmdbKey, http, override: ov, known, learned: idx.aliases[arKey(s.title)] || null, cast: i0?.cast || null, catalog, tries });
      if (rec.status !== 'matched') rec.next = ident.transient ? now + 6 * 3600e3 : nextTry(tries, now);   // فشل شبكة عابر ≠ "غير موجود": إعادة بعد 6 ساعات بلا زيادة التباعد
      if (ident.transient && rec.status !== 'matched') rec.tries = tries - 1;
      map[s.id] = rec; if (!known && !(ident.transient && ident.status !== 'confirmed')) recordIdentity(idx, s, ident, tries, now); dirty = true; if (rec.status === 'matched') { s.img3 = rec.path; }
      console.log('poster', s.id, rec.status, rec.name || '', rec.w ? rec.w + 'x' + rec.h : '', (rec.evidence || []).join(','));
    } catch (e) { console.log('poster error', s.id, String(e).slice(0, 80)); }
  }
  if (dirty) { save(MAP, map); save(IDX, idx); try { const pr = J(REV, { items: {} }); const rv = buildReview(map, idx, pr.items || {}); save(REV, { updated: new Date().toISOString(), ...rv }); } catch {} }
}

// ===== CLI =====
const A = process.argv, has = (k) => A.includes(k), arg = (k) => { const i = A.indexOf(k); return i > 0 ? A[i + 1] : null; };
const isMain = A[1] && A[1].endsWith('poster-pick.mjs');
// node scripts/poster-pick.mjs --apply [file]  ← يضيف img3 (بوستر عمودي 2:3 فقط) من السجل إلى shows.json (بلا أي تغيير آخر)
if (isMain && has('--apply')) {
  const f = arg('--apply')?.endsWith('.json') ? arg('--apply') : 'data/shows.json'; const data = J(f, {}), map = J(MAP, {}); let n = 0;
  const idx0 = loadIndex();
  for (const s of data.shows) { const r = map[s.id]; if (portraitOk(r) && existsSync(r.path)) { s.img3 = r.path; n++; } delete s.img4; const i0 = idx0.shows[s.id]; const tn = (i0 && i0.status === 'confirmed' && i0.original) || (r && r.status === 'matched' && r.name); if (tn) s.tr = tn; }   // s.tr = الاسم التركي المؤكَّد (للبحث المحلي فقط)
  writeFileSync(f, JSON.stringify(data)); console.log('applied img3 to', n, 'shows'); process.exit(0);
}
// node scripts/poster-pick.mjs --catalog  ← يعيد بناء فهرس المسلسلات التركية
if (isMain && has('--catalog')) { const m = await getCatalog({ force: true }); console.log('catalog keys:', m ? m.size : 0); process.exit(0); }
// node scripts/poster-pick.mjs --resolve [--ids a,b] [--all] [--limit N] [--force]  ← يعالج غير المعتمد (أو المحدَّد) ويطبع الأدلة
if (isMain && has('--resolve')) {
  const sharp = (await import('sharp')).default; const map = J(MAP, {}), idx = loadIndex(), ovr = J(OVR, {}), data = J('data/shows.json', { shows: [] }), http = makeHttp(); const catalog = await getCatalog({ http });
  let list = data.shows; if (arg('--ids')) { const ids = new Set(arg('--ids').split(',')); list = list.filter((s) => ids.has(s.id)); } else if (!has('--all')) list = list.filter((s) => !map[s.id] || map[s.id].status !== 'matched');
  if (arg('--limit')) list = list.slice(0, +arg('--limit')); const c = {};
  for (const s of list) {
    const r = map[s.id]; if (r && r.status === 'matched' && !has('--force') && !(ovr[s.id]?.tmdb)) continue; if (r && r.conf === 'manual' && !(ovr[s.id]?.tmdb)) continue;
    const tries = (r && r.tries ? r.tries : 0) + 1, i0 = idx.shows[s.id]; const ovT = ovr[s.id]?.tmdb ? ovr[s.id] : null;
    const known = !ovT && i0 && i0.status === 'confirmed' ? { src: i0.src, ref: i0.ref, original: i0.original, year: i0.year, ar: i0.ar, lat: i0.lat, imdb: i0.imdb, evidence: i0.evidence, score: i0.score } : null;
    let out; for (let a = 0; a < 3; a++) { out = await pickPoster(withHints(s, ovr[s.id]), { sharp, http, override: ovT, known, learned: idx.aliases[arKey(s.title)] || null, cast: i0?.cast || null, catalog, tries }); if (!(out.ident.transient && out.ident.status !== 'confirmed')) break; console.log('transient network failure, retrying', s.id); await new Promise((r) => setTimeout(r, 20000)); }   // فشل شبكة عابر: نعيد حتى 3 مرات
    const { rec, ident } = out;
    if (rec.status !== 'matched') rec.next = ident.transient ? Date.now() + 6 * 3600e3 : nextTry(tries); map[s.id] = rec; if (!known && !(ident.transient && ident.status !== 'confirmed')) recordIdentity(idx, s, ident, tries); c[rec.status] = (c[rec.status] || 0) + 1; save(MAP, map); save(IDX, idx);
    const b = ident.best; console.log(rec.status.toUpperCase(), s.id, '|', s.title, '|', b ? `${b.original} (${b.year}) ${b.src}#${b.ref} score=${b.score} [${(b.evidence || []).join(',')}]` : ident.reason, rec.status !== 'matched' ? '| ' + (rec.note || '') + ' | ' + (ident.cands || []).map((x) => `${x.original}(${x.year})#${x.ref}:${x.score}`).join(' ; ') : '');
  }
  console.log(JSON.stringify(c)); process.exit(0);
}
// node scripts/poster-pick.mjs --audit [--limit N]  ← يعيد حل مسلسلات TMDB المعتمدة بلا كتابة، ويقارن بالمسجَّل (معايرة المحرك)
if (isMain && has('--audit')) {
  const sharp = (await import('sharp')).default; const map = J(MAP, {}), data = J('data/shows.json', { shows: [] }), http = makeHttp(); const ctx = { ...http, key: process.env.TMDB_API_KEY, sharp }; const catalog = await getCatalog({ http }); const ovr0 = J(OVR, {}); const c = { agree: 0, diff: 0, unresolved: 0 }; let n = 0; const lim = arg('--limit') ? +arg('--limit') : 40;
  for (const s of data.shows) { const r = map[s.id]; if (!r || r.status !== 'matched' || r.src !== 'tmdb') continue; if (n++ >= lim) break; const x = await resolveIdentity(withHints(s, ovr0[s.id]), ctx, { catalog }); const k = x.status === 'confirmed' ? (String(x.best.ref) === String(r.ref) ? 'agree' : 'diff') : 'unresolved'; c[k]++; console.log(k.toUpperCase(), s.id, '|', s.title, '| stored', r.name, '#' + r.ref, '| engine', x.best ? x.best.original + ' #' + x.best.ref + ' ' + x.best.score + ' [' + (x.best.evidence || []).join(',') + ']' : x.reason); }
  console.log(JSON.stringify(c)); process.exit(0);
}
// node scripts/poster-pick.mjs --testset  ← يعيد حل مجموعة الاختبار الدائمة (data/identity-testset.json) من الصفر بلا كتابة، ويفشل إن اختلف المعرّف المتوقع
if (isMain && has('--testset')) {
  const sharp = (await import('sharp')).default; const set = J('data/identity-testset.json', { shows: [] }), data = J('data/shows.json', { shows: [] }), ovr = J(OVR, {}), http = makeHttp(), catalog = await getCatalog({ http }); const ctx = { ...http, key: process.env.TMDB_API_KEY, sharp }; let bad = 0;
  for (const e of set.shows) { const s = data.shows.find((x) => x.id === e.id); if (!s) { console.log('MISSING', e.id); bad++; continue; } const x = await resolveIdentity(withHints(s, ovr[e.id]), ctx, { catalog }); const ok = e.expect === 'unresolved' ? x.status !== 'confirmed' : x.status === 'confirmed' && String(x.best.ref) === String(e.tmdb); if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', e.id, '| expected', e.original, '#' + e.tmdb, '| got', x.best ? x.best.original + ' #' + x.best.ref + ' ' + x.status + ' ' + x.best.score + ' [' + (x.best.evidence || []).join(',') + ']' : x.reason); }
  console.log('testset', set.shows.length - bad + '/' + set.shows.length, 'passed'); process.exit(bad ? 1 : 0);
}
// node scripts/poster-pick.mjs --reratio [--limit N]  ← للمعتمد الذي بوستره عمودي لكن ليس 2:3 حقيقيًا: يبحث عن بوستر 2:3 لنفس المعرّف المؤكَّد؛
// لا يستبدل إلا إذا كان البديل 2:3 وبجودة لا تقل عن الحالي (-0.08)، ولا يمس المطابقات اليدوية. لا يغيّر الهوية أبدًا.
if (isMain && has('--reratio')) {
  const sharp = (await import('sharp')).default; const map = J(MAP, {}), data = J('data/shows.json', { shows: [] }), http = makeHttp(); const ctx = { ...http, key: process.env.TMDB_API_KEY || '', sharp }; const lim = arg('--limit') ? +arg('--limit') : 1e9; let n = 0, up = 0, keep = 0;
  for (const s of data.shows) { const r = map[s.id]; if (!r || r.status !== 'matched' || r.conf === 'manual' || strictOk(r.w, r.h) || r.rerated) continue; if (n++ >= lim) break;
    try { const c = await choosePoster({ src: r.src, ref: r.ref }, ctx); const a = c && c.a;
      if (a && strictOk(a.w, a.h) && a.score >= (r.score || 0) - 0.08) { const { path } = await saveImages(s, { sharp, buf: c.buf }, false); map[s.id] = { ...r, url: c.url, lang: c.lang, w: a.w, h: a.h, sharp: a.sharp, ent: a.ent, score: a.score, path, rerated: Date.now(), prevRatio: +(r.w / r.h).toFixed(3) }; up++; console.log('2:3', s.id, (r.w / r.h).toFixed(3), '->', a.ar); }
      else { map[s.id] = { ...r, rerated: Date.now() }; keep++; } } catch (e) { console.log('reratio error', s.id, String(e).slice(0, 60)); }
    if (n % 10 === 0) save(MAP, map); }
  save(MAP, map); console.log('reratio: upgraded', up, 'kept', keep, 'of', n); process.exit(0);
}
// ---- مصدر إضافي بلا تخمين: التحقق من الهوية عبر سلسلة معرّفات (TVmaze externals → IMDb/TVDB → TMDB find) ----
// القاعدة الدائمة للأتمتة: لا يُقبل بوستر في Dizi إلا إذا كان (1) لنفس المسلسل بدليل هوية، و(2) عموديًا 2:3 حقيقيًا (strictOk). غير ذلك = غلاف مؤقت + سجل في poster-review.
export const IS_ACCEPTABLE = (a) => !!(a && a.ok !== false && strictOk(a.w, a.h));
const yearOf = (v) => { const m = /([0-9]{4})/.exec(String(v || '')); return m ? +m[1] : null; };
// هل نتيجة TMDB هي نفس مسلسلنا؟ التركي + السنة ±1 إلزاميان؛ وإن لم تأتِ عبر معرّف خارجي مؤكَّد (بحث بالاسم) يلزم تطابق الاسم تقريبًا تامًا.
export function xrefIdentityOk(cur, hit, { viaId = true } = {}) {
  if (!hit) return { ok: false, reason: 'no tmdb hit' };
  const tr = (hit.origin_country || []).includes('TR') || hit.original_language === 'tr'; if (!tr) return { ok: false, reason: 'not turkish' };
  const y = yearOf(hit.first_air_date), y0 = yearOf(cur.premiered); if (!y || !y0 || Math.abs(y - y0) > 1) return { ok: false, reason: 'year mismatch ' + y + ' vs ' + y0 };
  if (!viaId) { const a = norm(cur.name || ''), ok = [hit.name, hit.original_name].some((n) => n && (norm(n) === a || dice(norm(n), a) >= 0.92)); if (!ok) return { ok: false, reason: 'name mismatch' }; }
  return { ok: true };
}
// يُنزِل إلى «مراجعة + غلاف مؤقت» كل بوستر معتمد ليس 2:3 حقيقيًا بعد أن جُرّبت كل المصادر (xref). المطابقات اليدوية لا تُمس. الهوية تبقى محفوظة وتُعاد المحاولة لاحقًا بتباعد.
export function demoteNonStrict(map, now = Date.now()) {
  const out = [];
  for (const [id, r] of Object.entries(map)) { if (!r || r.status !== 'matched' || r.conf === 'manual' || strictOk(r.w, r.h) || !r.xref) continue;
    const ratio = +(r.w / r.h).toFixed(2); out.push(id);
    map[id] = { ...r, status: 'review', note: 'identity confirmed (' + (r.name || id) + ') but no real 2:3 poster found in TVmaze/TMDB (best ratio ' + ratio + ') — placeholder until one exists', tries: (r.tries || 0) + 1, at: r.at || now, next: now + 14 * 864e5, was: { src: r.src, ref: r.ref, url: r.url, w: r.w, h: r.h, path: r.path } }; }
  return out;
}
// node scripts/poster-pick.mjs --enforce  ← يطبّق القاعدة الدائمة على ما جُرِّب كله (بلا شبكة)
if (isMain && has('--enforce')) { const map = J(MAP, {}); const d = demoteNonStrict(map); save(MAP, map); try { const pr = J(REV, { items: {} }); save(REV, { updated: new Date().toISOString(), ...buildReview(map, loadIndex(), pr.items || {}) }); } catch {} console.log('enforce: demoted to placeholder', d.length, d.join(', ')); process.exit(0); }
// node scripts/poster-pick.mjs --xref [--limit N]  ← لما بقي غير 2:3: يبحث عن بوستر 2:3 لنفس المسلسل عبر TMDB (بمعرّف IMDb/TVDB الذي يعطيه TVmaze). يحتاج TMDB_API_KEY (سرّ GitHub فقط).
if (isMain && has('--xref')) {
  const key = process.env.TMDB_API_KEY || ''; if (!key) { console.log('xref: TMDB_API_KEY missing (runs in CI only)'); process.exit(0); }
  const sharp = (await import('sharp')).default; const map = J(MAP, {}), data = J('data/shows.json', { shows: [] }), http = makeHttp(); const ctx = { ...http, key, sharp }; const lim = arg('--limit') ? +arg('--limit') : 1e9; let n = 0, up = 0, no = 0; const TM = 'https://api.themoviedb.org/3';
  for (const s of data.shows) { const r = map[s.id]; if (!r || r.status !== 'matched' || r.conf === 'manual' || strictOk(r.w, r.h) || r.xref) continue; if (n++ >= lim) break;
    const note = (why) => { map[s.id] = { ...r, xref: Date.now(), xrefNote: why }; no++; console.log('xref keep', s.id, why); };
    try {
      let hit = null, viaId = true;
      if (r.src === 'tvmaze') { const tv = await ctx.json('https://api.tvmaze.com/shows/' + r.ref), e = (tv && tv.externals) || {};
        const q = e.imdb ? { id: e.imdb, ext: 'imdb_id' } : e.thetvdb ? { id: e.thetvdb, ext: 'tvdb_id' } : null;
        if (q) { const j = await ctx.json(TM + '/find/' + q.id + '?api_key=' + key + '&external_source=' + q.ext); hit = j && j.tv_results && j.tv_results[0]; } }
      else if (r.src === 'tmdb') { hit = { id: r.ref, ...(await ctx.json(TM + '/tv/' + r.ref + '?api_key=' + key)) }; }
      if (!hit) { viaId = false; const j = await ctx.json(TM + '/search/tv?api_key=' + key + '&query=' + encodeURIComponent(r.name || '') + '&first_air_date_year=' + (yearOf(r.premiered) || '')); const rs = (j && j.results) || []; const ok = rs.filter((x) => xrefIdentityOk(r, x, { viaId: false }).ok); hit = ok.length === 1 ? ok[0] : null; }
      const idv = xrefIdentityOk(r, hit, { viaId }); if (!idv.ok) { note(idv.reason); continue; }
      const c = await choosePoster({ src: 'tmdb', ref: hit.id }, ctx); const a = c && c.a;
      if (!IS_ACCEPTABLE(a)) { note('no 2:3 poster on tmdb:' + hit.id); continue; }
      if (a.score < (r.score || 0) - 0.08) { note('2:3 found but lower quality'); continue; }
      const { path } = await saveImages(s, { sharp, buf: c.buf }, false);
      map[s.id] = { ...r, src: 'tmdb', ref: String(hit.id), url: c.url, lang: c.lang, w: a.w, h: a.h, sharp: a.sharp, ent: a.ent, score: a.score, path, xref: Date.now(), prevRatio: +(r.w / r.h).toFixed(3), prevSrc: r.src + ':' + r.ref, rerated: Date.now() }; up++; console.log('xref 2:3', s.id, (r.w / r.h).toFixed(3), '->', a.ar, 'via', viaId ? 'id' : 'search');
    } catch (e) { console.log('xref error', s.id, String(e).slice(0, 80)); }
    if (n % 10 === 0) save(MAP, map); }
  const dem = demoteNonStrict(map); save(MAP, map); try { const pr = J(REV, { items: {} }); const rv = buildReview(map, loadIndex(), pr.items || {}); save(REV, { updated: new Date().toISOString(), ...rv }); } catch {}
  console.log('xref demoted to placeholder:', dem.length, dem.join(','));
  console.log('xref: upgraded', up, 'kept', no, 'of', n); process.exit(0);
}
// node scripts/poster-pick.mjs --review  ← يعيد بناء data/poster-review.json ويطبع الحالات التي تنتظر مراجعة
if (isMain && has('--review')) { const rv = buildReview(J(MAP, {}), loadIndex(), J(REV, { items: {} }).items || {}); save(REV, { updated: new Date().toISOString(), ...rv }); console.log('review items:', rv.count); for (const x of Object.values(rv.items)) console.log(x.status, x.id, x.tries + ' tries', x.candidates[0] ? '| best: ' + x.candidates[0].name + ' ' + x.candidates[0].score : '', x.note); process.exit(0); }
