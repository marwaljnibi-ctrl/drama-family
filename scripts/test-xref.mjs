// القاعدة الدائمة للبوسترات: 2:3 حقيقي فقط + هوية مؤكدة، وإلا غلاف مؤقت + مراجعة. اختبارات: مسلسل صحيح، تطابق خاطئ، بوستر مفقود، رابط صورة معطوب، بوستر عمودي غير 2:3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sharp = (await import('sharp')).default;
const { upgradePosters, xrefIdentityOk, IS_ACCEPTABLE } = await import('./poster-pick.mjs');
const noisy = (w, h) => { const b = Buffer.alloc(w * h * 3); for (let i = 0; i < b.length; i++) b[i] = (i * 7919 + ((i / 3) | 0) * 31) % 256; return sharp(b, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer(); };

test('xref identity: the right show passes; wrong country, wrong year, or a different name found by search are rejected', () => {
  const cur = { name: 'Gülümse Kaderine', premiered: '2022-09-05' };
  assert.equal(xrefIdentityOk(cur, { first_air_date: '2022-09-05', origin_country: ['TR'] }).ok, true);
  assert.equal(xrefIdentityOk(cur, { first_air_date: '2022-01-01', original_language: 'tr' }).ok, true);
  assert.equal(xrefIdentityOk(cur, { first_air_date: '2022-09-05', origin_country: ['US'], original_language: 'en' }).ok, false, 'not Turkish');
  assert.equal(xrefIdentityOk(cur, { first_air_date: '2017-09-05', origin_country: ['TR'] }).ok, false, 'wrong year');
  assert.equal(xrefIdentityOk(cur, null).ok, false);
  assert.equal(xrefIdentityOk(cur, { name: 'Baska Dizi', first_air_date: '2022-09-05', origin_country: ['TR'] }, { viaId: false }).ok, false, 'search hit with another name');
  assert.equal(xrefIdentityOk(cur, { name: 'Gulumse Kaderine', first_air_date: '2022-09-05', origin_country: ['TR'] }, { viaId: false }).ok, true);
});
test('acceptance rule: only a real 2:3 poster is acceptable (no landscape, no 4:5, no square, nothing missing)', () => {
  assert.equal(IS_ACCEPTABLE({ w: 680, h: 1000 }), true); assert.equal(IS_ACCEPTABLE({ w: 1000, h: 1500 }), true);
  for (const [w, h] of [[1000, 563], [863, 1080], [702, 1200], [1000, 1000]]) assert.equal(IS_ACCEPTABLE({ w, h }), false, w + 'x' + h);
  assert.equal(IS_ACCEPTABLE(null), false);
});
test('automation: a confirmed show whose only poster is a vertical non-2:3 image gets a placeholder + a review entry (never cropped/stretched); a real 2:3 is accepted; a missing poster stays a placeholder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xref-')); const prev = process.cwd(); process.chdir(dir); mkdirSync('data', { recursive: true });
  const p23 = await noisy(680, 1000), p45 = await noisy(680, 850); const realFetch = globalThis.fetch; const json = (o) => new Response(JSON.stringify(o));
  const W = { 501: { name: 'ايكي', original: 'Iki Dizi', ar: ['ايكي'], f: '/p23.jpg', w: 680, h: 1000 }, 502: { name: 'دورت', original: 'Dort Dizi', ar: ['دورت'], f: '/p45.jpg', w: 680, h: 850 }, 503: { name: 'يوك', original: 'Yok Dizi', ar: ['يوك'], f: null } };
  globalThis.fetch = async (u) => {
    u = String(u); const q = decodeURIComponent((/[?&](?:search|query)=([^&]*)/.exec(u) || [])[1] || '');
    if (u.includes('wikidata.org')) return json({ search: [], entities: {} });
    if (u.includes('/search/tv')) { const lang = (/language=([^&]*)/.exec(u) || [])[1]; return json({ results: Object.entries(W).filter(([, e]) => lang === 'ar' && e.ar.includes(q)).map(([id, e]) => ({ id: +id, origin_country: ['TR'], original_language: 'tr', name: e.name, original_name: e.original, first_air_date: '2023-01-01' })) }); }
    const im = /\/tv\/(\d+)\/images/.exec(u); if (im) { const e = W[im[1]]; return json({ posters: e.f ? [{ file_path: e.f, width: e.w, height: e.h, aspect_ratio: e.w / e.h, iso_639_1: null, vote_average: 5, vote_count: 3 }] : [], backdrops: [] }); }
    const d = /\/tv\/(\d+)\?/.exec(u); if (d && W[d[1]]) return json({ id: +d[1], name: W[d[1]].name, original_name: W[d[1]].original, first_air_date: '2023-01-01', number_of_episodes: 10, origin_country: ['TR'], original_language: 'tr', external_ids: {} });
    if (u.endsWith('/p23.jpg')) return new Response(p23); if (u.endsWith('/p45.jpg')) return new Response(p45); return new Response('', { status: 404 });
  };
  try {
    const s = [['a-iki', 'مسلسل ايكي'], ['b-dort', 'مسلسل دورت'], ['c-yok', 'مسلسل يوك']].map(([id, title]) => ({ id, title, eps: Array.from({ length: 10 }, () => ({})) }));
    await upgradePosters(s, { max: 10, tmdbKey: 'k' });
    const map = JSON.parse(readFileSync('data/poster-map.json', 'utf8')), rv = JSON.parse(readFileSync('data/poster-review.json', 'utf8'));
    assert.equal(map['a-iki'].status, 'matched'); assert.ok(s[0].img3 && existsSync(s[0].img3));
    assert.notEqual(map['b-dort'].status, 'matched', 'vertical but not 2:3 → not accepted'); assert.equal(s[1].img3, undefined);
    assert.notEqual(map['c-yok'].status, 'matched'); assert.equal(s[2].img3, undefined);
    assert.ok(rv.items['b-dort'] && rv.items['c-yok'] && !rv.items['a-iki'], 'incomplete ones are listed for review'); assert.match(rv.items['b-dort'].note, /2:3/);
  } finally { globalThis.fetch = realFetch; process.chdir(prev); }
});
