// مزامنة فهرس qesset.net إلى data/shows.json. تُشغَّل بـ GitHub Actions (مجانًا) أو يدويًا:  node scripts/sync-qesset.mjs
// - تحترم robots.txt (الزواحف العامة مسموحة، وتعرّف بنفسها بوضوح).
// - لا تتجاوز أي حماية: إن أعاد الموقع 403/تحدّي Cloudflare يتوقف السكربت ويترك الفهرس السابق كما هو.
// - ضع SYNC_FULL=1 للمزامنة الكاملة، وإلا تُفحص صفحة «آخر الحلقات» فقط ثم المسلسلات المتأثرة.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseServers, buildKeyMap, parseLatest, resolveShowOf, epKey as slugKey, SV_VERSION } from './lib/qesset.mjs';
const BASE = 'https://qesset.net';
const UA = 'DramaFamilyBot/1.0 (+personal family PWA; low-rate; respects robots.txt)';
const OUT = 'data/shows.json';
const FULL = process.env.SYNC_FULL === '1';
const DELAY = +process.env.SYNC_DELAY_MS || 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Blocked extends Error {}

async function get(path) {
  const r = await fetch(path.startsWith('http') ? path : BASE + path, { headers: { 'user-agent': UA, 'accept-language': 'ar' }, redirect: 'follow' });
  if (r.status === 403 || r.status === 429 || r.status === 503) throw new Blocked(`${path} -> ${r.status}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  const t = await r.text();
  if (/cf-challenge|Just a moment|challenge-platform/i.test(t.slice(0, 4000))) throw new Blocked(`${path} -> challenge`);
  await sleep(DELAY);
  return t;
}
const dec = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const abs = (u) => (u ? new URL(u, BASE).href : '');
const slugOf = (u) => decodeURIComponent(new URL(u, BASE).pathname.replace(/\/$/, '').split('/').pop());

// بطاقة مسلسل في /discover/: <div class="block-post"><a href="/yeni-show/slug/"> … url(poster) … <div class="title">
function parseShows(html) {
  const out = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]*\/yeni-show\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = abs(m[1]), body = m[2];
    const img = (body.match(/url\(['"]?([^'")]+)['"]?\)/) || body.match(/<img[^>]+(?:data-src|src)="([^"]+)"/) || [])[1];
    const title = dec((body.match(/class="title"[^>]*>([\s\S]*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '') || '');
    if (title) out.push({ id: slugOf(url), title, poster: abs(img), url });
  }
  return out;
}
// صفحة المسلسل: روابط الحلقات /clarus/<slug>-episode-N/
function parseEps(html) {
  const seen = new Map();
  for (const m of html.matchAll(/<a[^>]+href="([^"]*\/clarus\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = abs(m[1]); const id = slugOf(url);
    const num = id.match(/episode-(\d+)/)?.[1] || dec(m[2].replace(/<[^>]+>/g, '')).match(/\d+/)?.[0];
    if (!num || seen.has(id)) continue;
    seen.set(id, { id, n: +num, title: dec(m[2].replace(/<[^>]+>/g, '')).slice(0, 80), url });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n);
}
const ogImage = (h) => (h.match(/property="og:image"[^>]+content="([^"]+)"/) || [])[1];

// يحلّ معرّفات السيرفرات للحلقات غير المحلولة: الأحدث أولًا في كل مسلسل، بحد أقصى لكل تشغيل.
async function resolveServers(shows) {
  const limit = +process.env.SYNC_SERVERS_PER_RUN || 900;
  const todo = [];
  shows.forEach((s) => s.eps.forEach((e, i) => { if (!e.sv || e.q !== SV_VERSION) todo.push({ s, e, rank: i }); }));
  todo.sort((a, b) => a.rank - b.rank);
  let ok = 0, empty = 0, fail = 0;
  for (const { e } of todo.slice(0, limit)) {
    try {
      const sv = parseServers(await get(e.url));
      if (sv && sv.length) { e.sv = sv; ok++; } else { e.sv = []; empty++; }
      e.q = SV_VERSION;
    } catch (err) { if (err instanceof Blocked) throw err; fail++; }
  }
  console.log(`servers: +${ok} resolved, ${empty} without supported servers, ${fail} failed, ${Math.max(0, todo.length - limit)} still pending`);
}

// ينزّل الملصقات إلى data/posters (مصغّرة إن توفر sharp) لأن المصدر قد يمنع عرض صوره في موقع آخر.
async function localizePosters(shows) {
  const { createHash } = await import('node:crypto');
  let sharp = null; try { sharp = (await import('sharp')).default; } catch {}
  mkdirSync('data/posters', { recursive: true });
  const ext = sharp ? 'webp' : 'jpg';
  let got = 0, fail = 0;
  if (sharp) mkdirSync('data/posters/v2', { recursive: true });
  const queue = shows.filter((s) => s.poster);
  const work = async () => {
    for (let s; (s = queue.shift()); ) {
      const h = createHash('sha1').update(s.id).digest('hex').slice(0, 12);
      const path = 'data/posters/' + h + '.' + ext;
      // v2: نسخة أوضح (600px، جودة 82) لشاشات iPhone عالية الدقة. الواجهة تفضّل img2 إن وُجدت.
      const path2 = sharp ? 'data/posters/v2/' + h + '.webp' : null;
      s.img = path; if (path2) s.img2 = path2;
      const need1 = !existsSync(path), need2 = path2 && !existsSync(path2);
      if (!need1 && !need2) continue;
      try {
        const r = await fetch(s.poster, { headers: { 'user-agent': UA, referer: BASE + '/' } });
        if (!r.ok) throw new Error(String(r.status));
        const src = Buffer.from(await r.arrayBuffer());
        if (need1) writeFileSync(path, sharp ? await sharp(src).resize({ width: 300, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer() : src);
        if (need2) writeFileSync(path2, await sharp(src).resize({ width: 600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer());
        got++;
      } catch (e) { fail++; if (need1) delete s.img; if (need2) delete s.img2; }
      await sleep(150);
    }
  };
  await Promise.all([work(), work(), work()]);
  console.log(`posters: +${got} new, ${fail} failed, sharp=${!!sharp}`);
}

async function main() {
  mkdirSync('data', { recursive: true });
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { shows: [] };
  const byId = new Map(prev.shows.map((s) => [s.id, s]));
  const now = Date.now();
  // 1) «آخر الحلقات» أولًا: نربط كل حلقة جديدة بمسلسلها (بمفتاح الحلقة، وإلا بروابط الحلقات الأخرى في صفحتها).
  const latestHtml = await get('/son-bolumler/').catch((e) => { if (e instanceof Blocked) throw e; return ''; });
  const latestPairs = parseLatest(latestHtml, abs, slugOf);
  const known = new Set(prev.shows.flatMap((s) => s.eps.map((e) => e.id)));
  const idToShowPrev = new Map(prev.shows.flatMap((s) => s.eps.map((e) => [e.id, s.id])));
  const keyMap = buildKeyMap(prev.shows);
  const affected = new Set(); let unknownShow = 0;
  for (const x of latestPairs.filter((p) => !known.has(p.id))) {
    let sib = [];
    if (!keyMap.get(slugKey(x.id))) { try { sib = [...(await get(x.url)).matchAll(/href="([^"]*\/clarus\/[^"?#]+)/g)].map((m) => slugOf(abs(m[1]))); } catch (e) { if (e instanceof Blocked) throw e; } }
    const sid = resolveShowOf(x.id, keyMap, idToShowPrev, sib);
    if (sid) affected.add(sid); else unknownShow++;
  }
  // 2) اكتشاف المسلسلات: كل الصفحات في المزامنة الكاملة أو عند وجود حلقة لمسلسل غير معروف، وإلا أول صفحتين.
  let pages = 1;
  const first = await get('/discover/');
  const pm = [...first.matchAll(/\/discover\/page\/(\d+)\//g)].map((x) => +x[1]);
  if (pm.length) pages = Math.max(...pm);
  const maxPages = FULL || !prev.shows.length ? pages : Math.min(pages, unknownShow ? 6 : 2);
  const found = new Map(parseShows(first).map((s) => [s.id, s]));
  for (let p = 2; p <= maxPages; p++) for (const s of parseShows(await get(`/discover/page/${p}/`))) found.set(s.id, s);
  // 3) نحدّث: الكل (كاملة)، وإلا المسلسلات الجديدة + المتأثرة بحلقات جديدة.
  const targets = FULL ? [...found.values()] : [...found.values(), ...[...affected].map((id) => byId.get(id)).filter(Boolean)].filter((s, i, arr) => (FULL || !byId.has(s.id) || affected.has(s.id)) && arr.findIndex((x) => x.id === s.id) === i);
  console.log(`index: ${latestPairs.length} latest, ${[...latestPairs].filter((p) => !known.has(p.id)).length} new eps, ${affected.size} affected shows, ${unknownShow} unmapped, ${targets.length} to refresh, pages=${maxPages}`);
  for (const s of targets) {
    const html = await get(s.url);
    const eps = parseEps(html);
    const old = byId.get(s.id);
    if (!eps.length && old && old.eps.length) { console.log('keep old episodes (empty parse):', s.id); continue; }
    const oldTs = new Map((old?.eps || []).map((e) => [e.id, e.ts]));
    const oldSv = new Map((old?.eps || []).map((e) => [e.id, [e.sv, e.q]]));
    for (const e of eps) { e.ts = oldTs.get(e.id) || now; const o = oldSv.get(e.id); if (o && o[0]) { e.sv = o[0]; if (o[1]) e.q = o[1]; } }
    // added: وقت أول ظهور للمسلسل في الفهرس (للمسلسلات التي تظهر بعد أول مزامنة فقط؛ القديمة بلا قيمة فلا تُعدّ جديدة)
    byId.set(s.id, { ...(old || {}), ...s, poster: s.poster || ogImage(html) || old?.poster || '', img: old?.img, added: old ? old.added : (prev.shows.length ? now : undefined), eps });
  }
  for (const s of found.values()) if (!byId.has(s.id)) byId.set(s.id, { ...s, eps: [] });
  const shows = [...byId.values()].filter((s) => s.eps.length).sort((a, b) => a.title.localeCompare(b.title, 'ar'));
  // الأحدث: من صفحة «آخر الحلقات» بترتيبها، وإلا بآخر ts
  const idToShow = new Map(shows.flatMap((s) => s.eps.map((e) => [e.id, s.id])));
  const latest = latestPairs.filter((x) => idToShow.has(x.id)).map((x, i) => ({ showId: idToShow.get(x.id), epId: x.id, ts: now - i }));
  await localizePosters(shows);
  try { await (await import('./poster-pick.mjs')).upgradePosters(shows, { max: 8 }); } catch (e) { console.log('poster upgrade skipped:', String(e).slice(0, 80)); }   // بوستر عمودي أفضل: مرة واحدة لكل مسلسل جديد فقط (سجل في data/poster-map.json)
  await resolveServers(shows);
  const json = { updated: new Date(now).toISOString(), source: 'qesset.net', shows, latest };
  const before = JSON.stringify({ s: prev.shows, l: prev.latest });
  if (before === JSON.stringify({ s: shows, l: latest })) { console.log('no changes'); return; }
  writeFileSync(OUT, JSON.stringify(json));
  console.log(`ok: ${shows.length} shows, ${shows.reduce((n, s) => n + s.eps.length, 0)} eps, ${latest.length} latest`);
}
main().catch((e) => { if (e instanceof Blocked) { console.error('BLOCKED by source, kept previous data:', e.message); process.exit(0); } console.error(e); process.exit(1); });
