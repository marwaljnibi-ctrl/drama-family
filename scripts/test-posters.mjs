// اختبارات اختيار البوسترات: التطبيع، أسماء البحث من المعرّف، تقييم الجودة، وسلوك الأتمتة (مرة واحدة لكل مسلسل، لا إعادة فحص، حماية من التطابق الخاطئ).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sharp = (await import('sharp')).default;
const { norm, slugVariants, assess, upgradePosters } = await import('./poster-pick.mjs');
const { arKey } = await import('./lib/identity.mjs');

const noisy = (w, h) => { const b = Buffer.alloc(w * h * 3); for (let i = 0; i < b.length; i++) b[i] = (i * 7919 + ((i / 3) | 0) * 31) % 256; return sharp(b, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer(); };
const flat = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#cfe3e6' } }).jpeg().toBuffer();

test('norm: Turkish letters and punctuation fold to ascii keys', () => {
  assert.equal(norm('Küçük Gelin'), 'kucukgelin'); assert.equal(norm('Tatlı Küçük Yalancılar'), 'tatlikucukyalancilar'); assert.equal(norm('Kuzey Güney'), 'kuzeyguney');
});
test('slugVariants: strips the random 5-letter id suffix but keeps real words', () => {
  assert.equal(slugVariants('kuzey-guney-lfmpq')[0].key, 'kuzeyguney');      // لاحقة عشوائية بلا حروف علة
  assert.equal(slugVariants('kuzey-guney')[0].key, 'kuzeyguney');             // guney كلمة حقيقية: تبقى
  assert.deepEqual(slugVariants('46'), []); assert.deepEqual(slugVariants('fi'), []);   // قصيرة/رقمية: لا بحث
});
test('assess: portrait sharp image passes; landscape banner and flat/blank images are rejected', async () => {
  const ok = await assess(await noisy(680, 1000), sharp); assert.equal(ok.ok, true, JSON.stringify(ok));
  const banner = await assess(await noisy(600, 326), sharp); assert.equal(banner.ok, false); assert.ok(banner.reasons.includes('aspect'));
  const blank = await assess(await flat(600, 900), sharp); assert.equal(blank.ok, false);
});

test('automation: new shows go through the identity engine once, are recorded forever, never re-searched; unresolved wait and retry; approved/manual are never replaced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'poster-')); const prev = process.cwd(); process.chdir(dir); mkdirSync('data', { recursive: true });
  const port = await noisy(680, 1000), land = await noisy(1280, 720); let calls = []; const realFetch = globalThis.fetch;
  const TVW = { 201: { name: 'جديد', original: 'Yeni Dizi', first: '2023-01-01', eps: 20, ar: ['جديد'] }, 202: { name: 'ثاني', original: 'Ikinci Dizi', first: '2023-01-01', eps: 20, ar: ['ثاني'] } };
  const world = { tv: { ...TVW }, hidden: 301 };   // 301: مسلسل يظهر في TMDB لاحقًا فقط
  const later = { 301: { name: 'اسم جديد تماما', original: 'Sonradan Gelen', first: '2023-06-01', eps: 5, ar: ['اسم جديد تماما'] } };
  const json = (o) => new Response(JSON.stringify(o));
  globalThis.fetch = async (u) => {
    u = String(u); calls.push(u); const q = decodeURIComponent((/[?&](?:search|query)=([^&]*)/.exec(u) || [])[1] || '');
    if (u.includes('wikidata.org')) return json({ search: [], entities: {} });
    if (u.includes('/search/tv')) { const lang = (/language=([^&]*)/.exec(u) || [])[1]; return json({ results: Object.entries(world.tv).filter(([, e]) => (lang === 'ar' ? e.ar.some((a) => a === q) : false)).map(([id]) => ({ id: +id, origin_country: ['TR'], original_language: 'tr' })) }); }
    const m = /\/tv\/(\d+)\/images/.exec(u); if (m) return json({ posters: [{ file_path: '/land.jpg', width: 1280, height: 720, aspect_ratio: 1.78, iso_639_1: 'ar', vote_average: 9, vote_count: 9 }, { file_path: '/port.jpg', width: 680, height: 1000, aspect_ratio: 0.68, iso_639_1: 'ar', vote_average: 5, vote_count: 3 }], backdrops: [] });
    const d = /\/tv\/(\d+)\?/.exec(u); if (d) { const e = world.tv[d[1]]; return e ? json({ id: +d[1], name: e.name, original_name: e.original, first_air_date: e.first, number_of_episodes: e.eps, origin_country: ['TR'], original_language: 'tr', external_ids: {}, translations: { translations: [] }, alternative_titles: { results: [] }, networks: [] }) : new Response('', { status: 404 }); }
    if (u.endsWith('/port.jpg')) return new Response(port); if (u.endsWith('/land.jpg')) return new Response(land);   // w780/port.jpg
    return new Response('', { status: 404 });
  };
  try {
    const mk = () => [{ id: 'yeni-dizi-bcdfg', title: 'مسلسل جديد', img2: 'old.webp', eps: Array.from({ length: 20 }, () => ({})), poster: 'https://qesset.net/wp-content/uploads/2023/05/Yeni-dizi-large.jpg' }, { id: 'sonradan-xqwrt', title: 'مسلسل اسم جديد تماما', eps: Array.from({ length: 5 }, () => ({})), poster: 'https://qesset.net/wp-content/uploads/2023/05/q-large.jpg' }];
    const shows = mk(); await upgradePosters(shows, { max: 10, tmdbKey: 'k' });
    let map = JSON.parse(readFileSync('data/poster-map.json', 'utf8')), idx = JSON.parse(readFileSync('data/identity-index.json', 'utf8'));
    assert.equal(map['yeni-dizi-bcdfg'].status, 'matched'); assert.equal(map['yeni-dizi-bcdfg'].ref, '201'); assert.ok(existsSync(map['yeni-dizi-bcdfg'].path)); assert.equal(shows[0].img3, map['yeni-dizi-bcdfg'].path); assert.equal(map['yeni-dizi-bcdfg'].prev, 'old.webp');
    assert.ok(map['yeni-dizi-bcdfg'].h > map['yeni-dizi-bcdfg'].w, 'the landscape poster (higher votes) is never chosen for img3');
    assert.equal(idx.shows['yeni-dizi-bcdfg'].status, 'confirmed'); assert.equal(idx.shows['yeni-dizi-bcdfg'].ref, '201'); assert.ok(idx.shows['yeni-dizi-bcdfg'].evidence.length); assert.equal(idx.aliases[arKey('مسلسل جديد')], '201');   // الاسم العربي مُتعلَّم
    assert.ok(['review', 'unmatched'].includes(map['sonradan-xqwrt'].status)); assert.ok(map['sonradan-xqwrt'].next > Date.now(), 'unresolved waits (backoff), no image chosen'); assert.equal(shows[1].img3, undefined); assert.equal(idx.shows['sonradan-xqwrt'].status, 'unresolved');
    const n = calls.length; const s2 = mk(); await upgradePosters(s2, { max: 10, tmdbKey: 'k' });
    assert.equal(calls.length, n, 'no network calls on the second run (approved is final, unresolved is waiting)'); assert.equal(s2[0].img3, map['yeni-dizi-bcdfg'].path);
    // يظهر العمل في TMDB لاحقًا + يحين موعد إعادة المحاولة ⇒ يُحسم دون أي تدخل، والمعتمد سابقًا لا يتغير حتى لو تغيّر العالم
    world.tv[301] = later[301]; map['sonradan-xqwrt'].next = Date.now() - 1; writeFileSync('data/poster-map.json', JSON.stringify(map));
    world.tv[201] = { ...TVW[202] };   // لو وُجد "نفس الاسم" بمعرّف آخر: لا يهم، المعتمد نهائي
    const s3 = mk(); await upgradePosters(s3, { max: 10, tmdbKey: 'k' }); map = JSON.parse(readFileSync('data/poster-map.json', 'utf8'));
    assert.equal(map['sonradan-xqwrt'].status, 'matched'); assert.equal(map['sonradan-xqwrt'].ref, '301'); assert.equal(map['yeni-dizi-bcdfg'].ref, '201'); assert.equal(map['yeni-dizi-bcdfg'].name, 'Yeni Dizi');
    // تصحيح يدوي: يتفوّق على المعتمد ويُوسَم manual؛ وبعد إزالته لا يُستبدل أبدًا
    world.tv[201] = TVW[201]; writeFileSync('data/identity-overrides.json', JSON.stringify({ 'yeni-dizi-bcdfg': { tmdb: 202, note: 'human' } }));
    await upgradePosters(mk(), { max: 10, tmdbKey: 'k' }); map = JSON.parse(readFileSync('data/poster-map.json', 'utf8')); idx = JSON.parse(readFileSync('data/identity-index.json', 'utf8'));
    assert.equal(map['yeni-dizi-bcdfg'].ref, '202'); assert.equal(map['yeni-dizi-bcdfg'].conf, 'manual'); assert.equal(idx.shows['yeni-dizi-bcdfg'].manual, true);
    writeFileSync('data/identity-overrides.json', '{}'); const n3 = calls.length; await upgradePosters(mk(), { max: 10, tmdbKey: 'k' }); map = JSON.parse(readFileSync('data/poster-map.json', 'utf8'));
    assert.equal(map['yeni-dizi-bcdfg'].ref, '202'); assert.equal(calls.length, n3, 'manual correction is permanent and costs no network');
  } finally { globalThis.fetch = realFetch; process.chdir(prev); }
});

test('permanent rule: every approved poster (img3 candidate) in the library is a real portrait image', async () => {
  const { portraitOk, PORTRAIT_MIN, PORTRAIT_MAX } = await import('./poster-pick.mjs');
  const map = JSON.parse(readFileSync('data/poster-map.json', 'utf8')); let n = 0;
  for (const [id, r] of Object.entries(map)) { if (r.status !== 'matched') continue; assert.ok(portraitOk(r), id + ' not portrait by record'); const m = await sharp(r.path).metadata(); const ar = m.width / m.height; assert.ok(ar >= PORTRAIT_MIN && ar <= PORTRAIT_MAX, id + ' file ar ' + ar.toFixed(2)); n++; }
  assert.ok(n >= 200, 'matched count ' + n);
  assert.equal(portraitOk({ status: 'matched', w: 600, h: 326, path: 'x' }), false);   // الأفقية مرفوضة دائمًا
  assert.equal(portraitOk({ status: 'matched', w: 640, h: 960, path: 'x' }), true);
});
