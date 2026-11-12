// Dizi Turkish Series Identity & Poster Resolver — المصدر الوحيد لتحديد هوية المسلسل واختيار بوستره.
// مجاني بالكامل (TMDB بمفتاح مجاني موجود + Wikidata + TVmaze)، بلا AI. الفكرة: لا نثق بالعنوان العربي وحده.
//   1) نجمع مرشحين من عدة مصادر باسم عربي (وكل مشتقاته)، وباسم لاتيني مستخرج من slug الرابط واسم ملف صورة المصدر.
//   2) نحقق الهوية بأدلة مستقلة: تطابق عربي بين TMDB/ويكيبيديا، ربط Wikidata↔TMDB↔IMDb، سنة الإنتاج، وبصمة بصرية لصورة المصدر مقابل لقطات المسلسل الرسمية.
//   3) نقبل فقط عند دليل قوي + نقاط كافية + هامش واضح عن ثاني مرشح. عدد الحلقات عامل مساعد خفيف وليس شرطًا.
//   4) نحفظ كل ما اكتُشف (أسماء/معرّفات/أدلة) في data/identity-index.json، ونتعلم أسماءً عربية بديلة لتُستعمل مستقبلًا.
import { readFileSync, existsSync } from 'node:fs';
import { dhash, hamming, assess, PORTRAIT_MIN, PORTRAIT_MAX } from './images.mjs';

export const UA = 'DiziIdentityBot/1.0 (private family, non-commercial)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRF = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u' };
export const norm = (s) => String(s || '').replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TRF[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const tokensOf = (s) => String(s || '').split(/[^A-Za-z0-9ıİşŞğĞçÇöÖüÜ]+/).map(norm).filter((t) => t.length >= 2);
const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
export const dice = (a, b) => { if (a.length < 2 || b.length < 2) return 0; const A = bigrams(a), B = bigrams(b); let n = 0; for (const [g, c] of A) n += Math.min(c, B.get(g) || 0); return (2 * n) / (a.length + b.length - 2); };

// ---------- الأسماء العربية ----------
const AR_MARKS = /[ً-ْٰـ]/g;
const AR_STOP = new Set(['في', 'من', 'يا', 'و', 'ايها', 'على', 'الى', 'عن', 'مع']);
export const normAr = (s) => String(s || '').replace(AR_MARKS, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[^ء-ي0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const stripKind = (s) => normAr(s).replace(/^(مسلسل|المسلسل|برنامج|البرنامج|فيلم)\s+/, '');
const dropAl = (w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w);
export const arKey = (s) => stripKind(s).split(' ').map(dropAl).join('');
export const arTokens = (s) => stripKind(s).split(' ').map(dropAl).filter((w) => w.length >= 2 && !AR_STOP.has(w));
export const hasAr = (s) => /[؀-ۿ]/.test(s || '');
// مشتقات البحث: العنوان كاملًا، ثم أول 3 كلمات، ثم آخر 3 كلمات (العناوين المترجمة بحرية تتفق غالبًا في جزء منها)
export function arVariants(title) {
  const base = stripKind(String(title || '').replace(/[«»"]/g, ' ')); if (arKey(base).length < 3) return [];
  const w = base.split(' ').filter(Boolean); const out = [base];
  if (w.length > 3) { out.push(w.slice(0, 3).join(' ')); out.push(w.slice(-3).join(' ')); }
  return [...new Set(out)].slice(0, 3);
}

// ---------- الأسماء اللاتينية من الرابط واسم ملف الصورة ----------
export function slugVariants(id) {
  const parts = String(id).toLowerCase().split('-').filter(Boolean); const v = [parts];
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last.length === 5) { if ((last.match(/[aeiou]/g) || []).length <= 1) v.unshift(parts.slice(0, -1)); else v.push(parts.slice(0, -1)); }   // لاحقة عشوائية بلا حروف علة تُجرَّب أولًا
  return v.map((p) => ({ q: p.join(' '), key: p.join('') })).filter((x) => x.key.length >= 3 && !/^\d+$/.test(x.key));
}
export const sourceYear = (show) => { const m = /\/uploads\/(\d{4})\//.exec(show.poster || ''); return m ? +m[1] : null; };
export function fileHint(show) {   // Sen-anla-large.jpg → "sen anla"
  const m = /\/([^\/?#]+)\.(?:jpe?g|png|webp)(?:[?#]|$)/i.exec(show.poster || ''); if (!m) return null;
  const q = m[1].replace(/[-_]+(large|scaled|thumb|medium|small|poster|banner|cover)\b/gi, '').replace(/[-_]\d{2,4}x\d{2,4}/g, '').replace(/[-_]\d+$/, '').replace(/[-_]+/g, ' ').trim();
  const t = tokensOf(q); return t.length && t.join('').length >= 4 ? { q, key: t.join(''), tokens: t, from: 'file' } : null;
}
export function latinHints(show) {
  const out = []; for (const v of slugVariants(show.id)) out.push({ q: v.q, key: v.key, tokens: tokensOf(v.q), from: 'slug' });
  const f = fileHint(show); if (f && !out.some((h) => h.key === f.key)) out.push(f);
  for (const o of show.hints?.names || []) { const t = tokensOf(o); if (t.length) out.push({ q: o, key: t.join(''), tokens: t, from: 'hint' }); }
  return out.slice(0, 4);
}
function latinMatch(h, names) {
  const ht = h.tokens.filter((t) => t.length >= 3); let best = null;
  for (const n of names) {
    const k = norm(n); if (!k) continue; if (k === h.key) return { pts: 4, tag: 'latin-exact', strong: true, from: h.from };
    const nt = tokensOf(n); const hit = ht.filter((t) => nt.some((u) => u === t || (t.length >= 4 && u.startsWith(t)) || (u.length >= 4 && t.startsWith(u)))).length; const frac = ht.length ? hit / ht.length : 0;
    if (frac === 1 && (ht.length >= 2 || (ht[0] && ht[0].length >= 6))) best = best && best.pts >= 2 ? best : { pts: 2, tag: 'latin-tokens', strong: false, from: h.from };
    else if (frac >= 0.6 && ht.length >= 3 && !best) best = { pts: 1.5, tag: 'latin-partial', strong: false, from: h.from };
  }
  return best;
}

// ---------- HTTP ----------
export function makeHttp({ gap = 150 } = {}) {
  async function json(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
      let r; try { r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } }); } catch { await sleep(1500 * (i + 1)); continue; }   // لا نطبع الرابط (قد يحمل مفتاحًا)
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return null; await sleep(gap); try { return await r.json(); } catch { return null; }
    }
    return null;
  }
  async function page(url) { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; DiziIdentityBot/1.0)', 'accept-language': 'ar' } }); if (!r.ok) return ''; const h = await r.text(); return /cf-challenge|Just a moment|challenge-platform/i.test(h.slice(0, 4000)) ? '' : h; }
  async function buf(url) { try { const r = await fetch(url, { headers: { 'user-agent': UA } }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); } catch { return null; } }
  return { json, buf, page };
}

// ---------- المصادر ----------
const T = 'https://api.themoviedb.org/3', W = 'https://www.wikidata.org/w/api.php';
const WD_TV = new Set(['Q5398426', 'Q15416', 'Q1259759', 'Q21191270', 'Q63952888', 'Q117467246']);
async function wikidata(ctx, queries) {   // [{q, lang}] ← كيانات ويكي داتا مع التسميات/الأسماء البديلة ومعرّفات TMDB وIMDb
  const ids = []; for (const { q, lang } of queries) { const j = await ctx.json(`${W}?action=wbsearchentities&format=json&type=item&limit=6&language=${lang}&uselang=${lang}&search=${encodeURIComponent(q)}`); for (const x of j?.search || []) if (!ids.includes(x.id)) ids.push(x.id); }
  if (!ids.length) return []; const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const j = await ctx.json(`${W}?action=wbgetentities&format=json&props=labels|aliases|claims&languages=ar|tr|en&ids=${ids.slice(i, i + 40).join('|')}`);
    for (const e of Object.values(j?.entities || {})) {
      const cl = e.claims || {}, v = (p) => cl[p]?.[0]?.mainsnak?.datavalue?.value; const vals = (p) => (cl[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
      const tmdb = v('P4983'), imdb = v('P345'); const trc = vals('P495').includes('Q43') || vals('P364').includes('Q256'); const isTV = vals('P31').some((q) => WD_TV.has(q));
      if (!tmdb && !imdb) continue;
      const lab = (l) => [e.labels?.[l]?.value, ...(e.aliases?.[l] || []).map((a) => a.value)].filter(Boolean);
      out.push({ qid: e.id, tmdb: tmdb ? String(tmdb) : null, imdb: imdb || null, trc, isTV, ar: lab('ar'), lat: [...lab('tr'), ...lab('en')] });
    }
  }
  return out;
}
const isTR = (r) => (r.origin_country || []).includes('TR') || r.original_language === 'tr';
async function tmdbSearch(ctx, q, lang) { const j = await ctx.json(`${T}/search/tv?api_key=${ctx.key}&language=${lang}&query=${encodeURIComponent(q)}`); return (j?.results || []).filter((r) => isTR(r)).slice(0, 5); }
async function tmdbCandidate(ctx, id) {
  const d = await ctx.json(`${T}/tv/${id}?api_key=${ctx.key}&language=ar&append_to_response=alternative_titles,translations,external_ids`); if (!d || !d.id) return null;
  const ar = [], lat = []; const put = (s) => { if (!s) return; (hasAr(s) ? ar : lat).push(s); };
  put(d.name); put(d.original_name); for (const t of d.translations?.translations || []) put(t.data?.name); for (const t of d.alternative_titles?.results || []) put(t.title);
  return { src: 'tmdb', ref: String(d.id), original: d.original_name || d.name, year: +String(d.first_air_date || '').slice(0, 4) || null, eps: d.number_of_episodes ?? null, tr: isTR(d), imdb: d.external_ids?.imdb_id || null, ar: [...new Set(ar)], lat: [...new Set(lat)], networks: (d.networks || []).map((n) => n.name), type: d.type || null, via: new Set() };
}
async function tvmazeCandidates(ctx, hints) {
  const out = new Map();
  for (const h of hints.slice(0, 3)) { const t = await ctx.json('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(h.q)); await sleep(350); for (const x of t || []) { const s = x.show; const tr = [s.network?.country?.code, s.webChannel?.country?.code].includes('TR') || s.language === 'Turkish'; if (!tr || out.has(s.id)) continue; out.set(s.id, { src: 'tvmaze', ref: String(s.id), original: s.name, year: +String(s.premiered || '').slice(0, 4) || null, eps: null, tr: true, imdb: s.externals?.imdb || null, ar: [], lat: [s.name], networks: [s.network?.name || s.webChannel?.name].filter(Boolean), via: new Set(['tvmaze-hint']), image: s.image?.original || null }); } }
  return [...out.values()];
}

// ---------- التسجيل بالأدلة ----------
export function scoreCandidate(c, x) {
  const ev = []; let s = 0, strong = 0;
  if (!c.tr) { s -= 6; ev.push('not-turkish'); }
  const keys = c.ar.map(arKey).filter(Boolean);
  if (keys.some((k) => x.arKeys.has(k))) { s += 4; strong++; ev.push('ar-exact'); }
  else { let best = 0; for (const n of c.ar) { const a = arTokens(n), shared = a.filter((t) => x.arTok.has(t)).length, j = shared / (new Set([...a, ...x.arTok]).size || 1); if (shared >= 2 && j > best) best = j; } if (best >= 0.6) { s += 1.5; ev.push('ar-tokens'); } else if (best >= 0.4) { s += 0.75; ev.push('ar-tokens-weak'); } }
  if (c.wd === 'exact') { s += 3; strong++; ev.push('wikidata-ar-exact'); } else if (c.wd === 'tokens') { s += 1.5; ev.push('wikidata-ar-tokens'); }
  if (c.wdIdAgree) { s += 1; ev.push('wikidata-id-agrees'); }
  let lat = null; for (const h of x.hints) { const m = latinMatch(h, [c.original, ...c.lat]); if (m && (!lat || m.pts > lat.pts)) lat = m; }
  if (lat) { s += lat.pts; if (lat.strong) strong++; ev.push(lat.tag + ':' + lat.from); }
  if (c.castN) { if (c.castN >= 3) { s += 4; strong++; ev.push('cast:' + c.castN); } else if (c.castN === 2) { s += 3; strong++; ev.push('cast:2'); } else { s += 1; ev.push('cast:1'); } }
  if (c.imgDist != null) { if (c.imgDist <= 10) { if (s >= 1) { s += 3; strong++; ev.push('image-match:' + c.imgDist); } else { s += 1; ev.push('image-match-lonely:' + c.imgDist); } } else if (c.imgDist <= 14) { s += 1.5; ev.push('image-near:' + c.imgDist); } }
  if (c.year && x.upYear) { if (c.year > x.upYear + 1) { s -= 3; ev.push('year-after-upload'); } else { s += 0.5; ev.push('year-ok'); } }
  if (c.eps && x.eps) { const r = Math.min(c.eps, x.eps) / Math.max(c.eps, x.eps); const p = r >= 0.9 ? 1 : r >= 0.75 ? 0.6 : r >= 0.5 ? 0.3 : r < 0.25 ? -0.5 : 0; if (p) { s += p; ev.push('eps:' + c.eps + '~' + x.eps); } }
  if (x.learned && x.learned === c.ref) { s += 1.5; ev.push('learned-alias'); }
  return { score: +s.toFixed(2), strong, evidence: ev };
}
export function decide(scored, { min = 4, margin = 1.5 } = {}) {
  const r = [...scored].sort((a, b) => b.score - a.score); const best = r[0], second = r[1];
  if (!best) return { status: 'unresolved', reason: 'no candidates' };
  if (best.score < min) return { status: 'unresolved', reason: 'score ' + best.score + ' < ' + min, best };
  if (best.strong < 1) return { status: 'unresolved', reason: 'no strong evidence', best };
  if (second && best.score - second.score < margin) return { status: 'unresolved', reason: 'ambiguous with ' + second.original, best };
  return { status: 'confirmed', best };
}

// ---------- الممثلون من صفحة المصدر (دليل مستقل عن العنوان) ----------
export function parseCast(html) {   // "بطولة : آسيا قصاب ، أولاش تونا ، … -->"
  const t = String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ');
  const m = /بطولة\s*[:：]\s*(.{4,400}?)(?:-->|الحلقة|\||$)/.exec(t); if (!m) return [];
  return m[1].split(/[،,]/).map((s) => s.trim()).filter((n) => { const w = n.split(' ').length; return w >= 2 && w <= 4 && /[؀-ۿ]/.test(n); }).slice(0, 6);
}
export async function fetchSourceCast(show, ctx) {   // مرة واحدة لكل مسلسل غير محسوم؛ يفشل بهدوء إن حُجب المصدر
  if (!show.url || !ctx.page) return [];
  try { return parseCast(await ctx.page(show.url)); } catch { return []; }
}
async function castCandidates(ctx, names) {   // اسم ممثل بالعربية ← شخص في TMDB ← أعماله التركية؛ عدد الممثلين المشتركين في العمل = قوة الدليل
  const per = new Map();
  for (const n of names.slice(0, 5)) {
    const s = await ctx.json(`${T}/search/person?api_key=${ctx.key}&language=ar&query=${encodeURIComponent(n)}`);
    const p = (s?.results || []).find((r) => r.known_for_department === 'Acting' || !r.known_for_department); if (!p) continue;
    const c = await ctx.json(`${T}/person/${p.id}/tv_credits?api_key=${ctx.key}&language=ar`);
    for (const t of c?.cast || []) if ((t.origin_country || []).includes('TR') || t.original_language === 'tr') { if (!per.has(String(t.id))) per.set(String(t.id), new Set()); per.get(String(t.id)).add(p.id); }
  }
  return new Map([...per].map(([id, s]) => [id, s.size]));
}

// ---------- قلب المحرك ----------
// ctx: { json, buf, page?, key (TMDB), sharp?, root? }. show: {id,title,url,poster,img,img2,eps,hints?:{names,cast}}. extra: { override?:{tmdb}, learned?:string, cast?:string[] }
// تمرّ المطابقة بمرحلتين: (1) العنوان العربي وأسماؤه + الاسم اللاتيني + ويكي داتا؛ (2) إن لم تُحسم: ممثلو صفحة المصدر. وبصمة الصورة تُضاف لأعلى المرشحين في كل مرحلة.
export async function resolveIdentity(show, ctx, extra = {}) {
  const arV = arVariants(show.title), hints = latinHints(show), upYear = sourceYear(show), eps = Array.isArray(show.eps) ? show.eps.length : +show.eps || 0;
  const x = { arKeys: new Set([arKey(show.title), ...arV.map(arKey)].filter(Boolean)), arTok: new Set(arTokens(show.title)), hints, upYear, eps, learned: extra.learned || null };
  const queries = { ar: arV, lat: hints.map((h) => h.q) };
  const pool = new Map(); const hit = (id, how) => { if (!pool.has(id)) pool.set(id, new Set()); pool.get(id).add(how); };
  const cache = new Map(), imgCache = new Map(); let wd = [];
  const detail = async (id) => { if (!cache.has(id)) cache.set(id, await tmdbCandidate(ctx, id)); const c = cache.get(id); return c ? { ...c, via: new Set(pool.get(id) || []) } : null; };
  if (extra.override?.tmdb) hit(String(extra.override.tmdb), 'manual');
  else {
    try { wd = await wikidata(ctx, [...arV.map((q) => ({ q, lang: 'ar' })), ...hints.slice(0, 2).map((h) => ({ q: h.q, lang: 'en' }))]); } catch { wd = []; }
    if (ctx.key) {
      for (const q of arV) for (const r of await tmdbSearch(ctx, q, 'ar')) hit(String(r.id), 'tmdb-ar');
      for (const h of hints.slice(0, 3)) for (const r of await tmdbSearch(ctx, h.q, 'tr-TR')) hit(String(r.id), 'tmdb-hint');
      if (extra.learned) hit(String(extra.learned), 'learned');
      for (const e of wd) { if (e.tmdb) hit(e.tmdb, 'wikidata'); else if (e.imdb) { const f = await ctx.json(`${T}/find/${e.imdb}?api_key=${ctx.key}&external_source=imdb_id`); for (const r of f?.tv_results || []) hit(String(r.id), 'wikidata-imdb'); } }
    }
  }
  const castN = new Map();
  async function evaluate() {
    let cands = [];
    if (ctx.key) { const ids = [...pool.entries()].sort((a, b) => (castN.get(b[0]) || 0) - (castN.get(a[0]) || 0) || b[1].size - a[1].size).slice(0, 8).map((e) => e[0]); for (const id of ids) { const c = await detail(id); if (c) cands.push(c); } }
    else cands = await tvmazeCandidates(ctx, hints);
    for (const c of cands) {   // ربط Wikidata بالمرشح (معرّف TMDB أو IMDb) وقياس تطابق عنوان المصدر مع تسميات ويكي داتا العربية
      c.castN = castN.get(c.ref) || 0;
      for (const e of wd) {
        if (!((c.src === 'tmdb' && e.tmdb === c.ref) || (e.imdb && c.imdb && e.imdb === c.imdb))) continue;
        const exact = e.ar.map(arKey).some((k) => x.arKeys.has(k)); const a = e.ar.flatMap(arTokens); const shared = a.filter((t) => x.arTok.has(t)).length; const j = shared / (new Set([...a, ...x.arTok]).size || 1);
        const m = exact ? 'exact' : shared >= 2 && j >= 0.5 ? 'tokens' : null; if (m && c.wd !== 'exact') c.wd = m;
        if (e.imdb && c.imdb && e.imdb === c.imdb && e.tmdb === c.ref) c.wdIdAgree = true;
        c.ar = [...new Set([...c.ar, ...e.ar])]; c.lat = [...new Set([...c.lat, ...e.lat])]; c.wikidata = e.qid;
      }
    }
    let scored = cands.map((c) => ({ ...c, ...scoreCandidate(c, x) }));
    if (ctx.key && ctx.sharp && scored.length) {   // أدلة بصرية للمرشحين الأعلى (طلب صور واحد لكل مرشح، يُعاد استخدامه لاختيار البوستر)
      const bp = show.img2 || show.img; const path = bp && ((ctx.root || '.') + '/' + bp); let bh = null;
      try { if (path && existsSync(path)) bh = await dhash(readFileSync(path), ctx.sharp); } catch {}
      if (bh) for (const c of [...scored].sort((a, b) => b.score - a.score).slice(0, 3)) {
        if (!c.tr) continue; if (!imgCache.has(c.ref)) imgCache.set(c.ref, await ctx.json(`${T}/tv/${c.ref}/images?api_key=${ctx.key}&include_image_language=ar,tr,en,null`)); c.images = imgCache.get(c.ref); let best = null;
        if (c.imgDist == null) { for (const b of (c.images?.backdrops || []).slice(0, 8)) { const buf = await ctx.buf('https://image.tmdb.org/t/p/w300' + b.file_path); if (!buf) continue; try { const d = hamming(bh, await dhash(buf, ctx.sharp)); if (best == null || d < best) best = d; } catch {} } if (best != null) c.imgDist = best; }
      }
      scored = scored.map((c) => ({ ...c, ...scoreCandidate(c, x) }));
    }
    return scored;
  }
  let scored = await evaluate(), d = decide(scored), cast = extra.cast || show.hints?.cast || null;
  if (extra.override?.tmdb) { const c = scored[0]; if (!c) return { status: 'unresolved', reason: 'override id not found on TMDB', cands: [] }; return { status: 'confirmed', best: { ...c, score: 99, strong: 9, evidence: ['manual-override'] }, cands: [], queries, hints: [] }; }
  if (d.status !== 'confirmed' && ctx.key) {   // المرحلة 2: الممثلون
    if (!cast) cast = await fetchSourceCast(show, ctx);
    if (cast.length) { for (const [id, n] of await castCandidates(ctx, cast)) if (n >= 1) { castN.set(id, n); hit(id, 'cast'); } if (castN.size) { scored = await evaluate(); d = decide(scored); } }
  }
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 3).map(({ images, via, ...c }) => ({ ...c, via: [...(via || [])] }));
  return { ...d, cands: top, queries, hints: hints.map((h) => h.q), cast: cast || [] };
}

// ---------- اختيار أفضل بوستر عمودي لهوية مؤكدة ----------
const LANGW = { ar: 1, tr: 0.9, null: 0.75, en: 0.6 };
export async function choosePoster(c, ctx) {
  if (c.src === 'tvmaze') {
    const urls = []; if (c.image) urls.push(c.image); const imgs = await ctx.json('https://api.tvmaze.com/shows/' + c.ref + '/images'); for (const im of (imgs || []).filter((i) => i.type === 'poster').sort((p, q) => (q.resolutions?.original?.width || 0) - (p.resolutions?.original?.width || 0)).slice(0, 3)) if (im.resolutions?.original?.url) urls.push(im.resolutions.original.url);
    let best = null; for (const u of [...new Set(urls)]) { const buf = await ctx.buf(u); if (!buf) continue; const a = await assess(buf, ctx.sharp); if (a.ok && (!best || a.score > best.a.score)) best = { buf, a, url: u, lang: null }; } return best;
  }
  const im = c.images || await ctx.json(`${T}/tv/${c.ref}/images?api_key=${ctx.key}&include_image_language=ar,tr,en,null`); if (!im) return null;
  const ps = (im.posters || []).filter((p) => p.width >= 400 && p.aspect_ratio >= PORTRAIT_MIN && p.aspect_ratio <= PORTRAIT_MAX).map((p) => ({ p, pri: (LANGW[p.iso_639_1 ?? 'null'] ?? 0.3) * 0.35 + Math.min(p.width, 2000) / 2000 * 0.25 + (p.vote_average / 10) * Math.min(p.vote_count || 0, 10) / 10 * 0.2 + (1 - Math.min(Math.abs(p.aspect_ratio - 0.667) / 0.15, 1)) * 0.2 })).sort((a, b) => b.pri - a.pri).slice(0, 4);
  let best = null; for (const { p, pri } of ps) { const buf = await ctx.buf('https://image.tmdb.org/t/p/w780' + p.file_path); if (!buf) continue; const a = await assess(buf, ctx.sharp); if (!a.ok) continue; const f = a.score * 0.5 + pri * 0.5; if (!best || f > best.f) best = { buf, a, f, url: 'https://image.tmdb.org/t/p/w780' + p.file_path, lang: p.iso_639_1 ?? null }; }
  return best;
}
export async function chooseBackdrop(c, ctx) {   // خلفية أفقية سينمائية (بلا نص أولًا) للـHero؛ غيابها ليس خطأ
  let list = [];
  if (c.src === 'tmdb') { const im = c.images || await ctx.json(`${T}/tv/${c.ref}/images?api_key=${ctx.key}&include_image_language=ar,tr,en,null`); list = (im?.backdrops || []).filter((b) => b.width >= 1000 && b.aspect_ratio > 1.6 && b.aspect_ratio < 2.1).sort((a, b) => (a.iso_639_1 ? 1 : 0) - (b.iso_639_1 ? 1 : 0) || b.vote_average - a.vote_average || b.width - a.width).slice(0, 2).map((b) => ({ url: 'https://image.tmdb.org/t/p/w1280' + b.file_path, w: b.width })); }
  else { const imgs = await ctx.json('https://api.tvmaze.com/shows/' + c.ref + '/images'); list = (imgs || []).filter((x) => x.type === 'background').map((x) => x.resolutions?.original).filter((o) => o && o.url && o.width >= 1000 && o.width / o.height > 1.5 && o.width / o.height < 2.1).sort((p, q) => q.width - p.width).slice(0, 2).map((o) => ({ url: o.url, w: o.width })); }
  for (const o of list) { const buf = await ctx.buf(o.url); if (!buf) continue; const a = await assess(buf, ctx.sharp, { landscape: true }); if (a.ok) return { buf, url: o.url, w: Math.min(o.w, 1000) }; }
  return null;
}
