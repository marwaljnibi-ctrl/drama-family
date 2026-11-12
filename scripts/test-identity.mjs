// اختبارات محرك الهوية (Dizi Turkish Series Identity & Poster Resolver) دون شبكة: عالم محاكى لـTMDB وWikidata وصفحة المصدر.
// يغطي: أسماء عربية بديلة مختلفة تمامًا عن التركي، تغيّر الاسم التركي، إعادة الإنتاج، العمل غير التركي، الممثلين، والأدلة والعتبات.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogIndex, norm, normAr, arKey, arTokens, arVariants, latinHints, sourceYear, fileHint, scoreCandidate, decide, resolveIdentity, parseCast, makeHttp } from './lib/identity.mjs';

// ---------- عالم محاكى ----------
const TV = {
  101: { name: 'فريد', original: 'Yalı Çapkını', first: '2022-09-16', eps: 90, imdb: 'tt101', ar: ['فريد'], alt: ['Kingfisher'] },
  102: { name: 'اشرح أيها البحر الأسود', original: 'Sen Anlat Karadeniz', first: '2018-09-18', eps: 67, imdb: 'tt102', ar: ['اشرح أيها البحر الأسود'], alt: [] },
  103: { name: 'زهور الثلج', original: 'Kardelenler', first: '2019-01-01', eps: 52, imdb: 'tt103', ar: ['زهور الثلج'], alt: ['Kar Çiçekleri'] },
  104: { name: 'Ask Yolu', original: 'Ask Yolu', first: '2014-01-01', eps: 20, imdb: 'tt104', ar: [], alt: [] },
  105: { name: 'Ask Yolu', original: 'Ask Yolu', first: '2020-01-01', eps: 60, imdb: 'tt105', ar: [], alt: [] },
  106: { name: 'Love Story', original: 'Love Story', first: '2019-01-01', eps: 10, imdb: 'tt106', ar: ['قصة حب'], alt: [], foreign: true },
  107: { name: 'عنوان لا علاقة له', original: 'Gizli Hikaye', first: '2019-03-01', eps: 12, imdb: 'tt107', ar: ['عنوان لا علاقة له'], alt: [] },
  109: { name: 'عنوان ثالث', original: 'İçimdeki Fırtına', first: '2017-05-01', eps: 6, imdb: 'tt109', ar: [], alt: [] },
  108: { name: 'عنوان آخر', original: 'Baska Hikaye', first: '2019-03-01', eps: 12, imdb: 'tt108', ar: [], alt: [] },
};
const WD = [
  { qid: 'Q101', tmdb: '101', imdb: 'tt101', ar: ['الطائر الرفراف', 'فريد'] },
  { qid: 'Q102', tmdb: '102', imdb: 'tt102', ar: ['أخبرهم أيها البحر الأسود', 'اشرح أيها البحر الأسود'] },
];
const PEOPLE = { 'أولاش تونا': 900, 'آسيا قصاب': 901, 'اسم مجهول تماما': 999 };
const CREDITS = { 900: [107, 108], 901: [107], 999: [] };
const words = (s) => String(s).split(/\s+/).map(norm).filter(Boolean);
const tr = (e) => (e.foreign ? ['US'] : ['TR']);
const route = (u) => {
  u = String(u); const q = decodeURIComponent((/[?&](?:search|query)=([^&]*)/.exec(u) || [])[1] || '');
  if (u.includes('wikidata.org') && u.includes('wbsearchentities')) return { search: WD.filter((e) => e.ar.some((a) => arKey(a) === arKey(q) || arTokens(a).filter((t) => arTokens(q).includes(t)).length >= 2)).map((e) => ({ id: e.qid })) };
  if (u.includes('wikidata.org') && u.includes('wbgetentities')) {
    const ids = decodeURIComponent((/[?&]ids=([^&]*)/.exec(u) || [])[1] || '').split('|'); const entities = {};
    for (const e of WD.filter((w) => ids.includes(w.qid))) entities[e.qid] = { id: e.qid, labels: { ar: { value: e.ar[0] } }, aliases: { ar: e.ar.slice(1).map((value) => ({ value })) }, claims: { P4983: [{ mainsnak: { datavalue: { value: e.tmdb } } }], P345: [{ mainsnak: { datavalue: { value: e.imdb } } }], P495: [{ mainsnak: { datavalue: { value: { id: 'Q43' } } } }] } };
    return { entities };
  }
  if (u.includes('/search/person')) { const id = PEOPLE[q]; return { results: id ? [{ id, known_for_department: 'Acting' }] : [] }; }
  const pc = /\/person\/(\d+)\/tv_credits/.exec(u); if (pc) return { cast: (CREDITS[pc[1]] || []).map((id) => ({ id, origin_country: tr(TV[id]), original_language: 'tr' })) };
  if (u.includes('/search/tv')) { const lang = (/language=([^&]*)/.exec(u) || [])[1]; return { results: Object.entries(TV).filter(([, e]) => (lang === 'ar' ? e.ar.some((a) => arTokens(a).join(' ').includes(arTokens(q).join(' ')) && arTokens(q).length) : words(q).every((w) => words(e.original + ' ' + e.alt.join(' ')).some((n) => n.startsWith(w))))).map(([id, e]) => ({ id: +id, origin_country: tr(e), original_language: e.foreign ? 'en' : 'tr' })) }; }
  const d = /\/tv\/(\d+)\?/.exec(u); if (d) { const e = TV[d[1]]; return e && { id: +d[1], name: e.name, original_name: e.original, first_air_date: e.first, number_of_episodes: e.eps, origin_country: tr(e), original_language: e.foreign ? 'en' : 'tr', external_ids: { imdb_id: e.imdb }, translations: { translations: e.ar.map((n) => ({ iso_639_1: 'ar', data: { name: n } })) }, alternative_titles: { results: e.alt.map((title) => ({ title })) }, networks: [] }; }
  return null;
};
const ctxFor = (extra = {}) => ({ json: async (u) => route(u), buf: async () => null, page: async () => '', key: 'k', ...extra });
const S = (o) => ({ eps: Array.from({ length: o.n ?? 0 }, () => ({})), ...o });

test('Arabic normalization: hamza/alef/ya/ta-marbuta/ال/kind prefixes fold to the same key', () => {
  assert.equal(arKey('اخبرهم ايها البحر الاسود'), arKey('أخبرهم أيها البحر الأسود'));
  assert.equal(arKey('مسلسل الطائر الرفراف'), arKey('الطائر  الرفراف'));
  assert.equal(arKey('برنامج من أنت أيها المقنع'), arKey('من انت ايها المقنع'));
  assert.equal(normAr('مَسلسل  الحُبّ'), 'مسلسل الحب');
  assert.deepEqual(arVariants('مسلسل « في »'), []);                         // قصير جدًا: لا بحث بالعنوان
  assert.ok(arVariants('اخبرهم ايها البحر الاسود').length >= 2);
});
test('latin hints: slug (without random suffix) and the source image file name both become search names', () => {
  const s = { id: 'karadeniz-hqvms', poster: 'https://qesset.net/wp-content/uploads/2020/05/Sen-anla-large.jpg' };
  assert.equal(sourceYear(s), 2020); assert.equal(fileHint(s).q, 'Sen anla');
  const h = latinHints(s).map((x) => x.key); assert.ok(h.includes('karadeniz') && h.includes('senanla'), h.join());
  assert.equal(fileHint({ poster: 'https://x/Tayer-large.jpg' }).key, 'tayer');
});
test('parseCast: reads the "بطولة :" line of the source page and stops at the arrow', () => {
  const html = '<p>قصة … بطولة ا هربًا</p><div><span>بطولة : آسيا قصاب ، أولاش تونا ، ايرام هيليفجي ، علي إرسان ، --> الحلقة الأخيرة</span></div>';
  assert.deepEqual(parseCast(html), ['آسيا قصاب', 'أولاش تونا', 'ايرام هيليفجي', 'علي إرسان']); assert.deepEqual(parseCast('<p>لا شيء</p>'), []);
});

test('decide: needs strong evidence, enough score and a clear margin', () => {
  const c = (score, strong, name = 'A') => ({ score, strong, original: name });
  assert.equal(decide([c(5, 1)]).status, 'confirmed');
  assert.equal(decide([c(3.5, 1)]).status, 'unresolved');                     // نقاط غير كافية
  assert.equal(decide([c(6, 0)]).status, 'unresolved');                       // بلا دليل قوي
  assert.equal(decide([c(6, 1), c(5.5, 1, 'B')]).status, 'unresolved');       // التباس بين اسمين
  assert.equal(decide([c(6, 1), c(3, 1, 'B')]).status, 'confirmed');
});
test('scoreCandidate: a non-Turkish work never passes, a lonely image match is weak, a later remake is penalised', () => {
  const x = { arKeys: new Set([arKey('عنوان')]), arTok: new Set(arTokens('عنوان')), hints: [], upYear: 2019, eps: 10 };
  const base = { tr: true, ar: [], lat: [], original: 'X', year: 2019, eps: 10 };
  assert.ok(scoreCandidate({ ...base, tr: false, ar: ['عنوان'] }, x).score < 0 + 4 - 0.1);
  assert.ok(!scoreCandidate({ ...base, imgDist: 3 }, x).strong);              // الصورة وحدها لا تكفي
  assert.ok(scoreCandidate({ ...base, imgDist: 3, castN: 1 }, x).strong >= 1); // مع ممثل مشترك واحد تصير دليلًا قويًا
  assert.ok(scoreCandidate({ ...base, year: 2024 }, x).evidence.includes('year-after-upload'));
});

test('engine: Arabic title unrelated to the Turkish one is found through Wikidata aliases (الطائر الرفراف = فريد = Yalı Çapkını)', async () => {
  const r = await resolveIdentity(S({ id: 'altayer-alrafraf-mqvts', title: 'مسلسل الطائر الرفراف', n: 101, poster: 'https://qesset.net/wp-content/uploads/2022/09/Tayer-large.jpg' }), ctxFor());
  assert.equal(r.status, 'confirmed', JSON.stringify(r.cands)); assert.equal(r.best.ref, '101'); assert.ok(r.best.evidence.includes('wikidata-ar-exact'));
});
test('engine: loose Arabic translation + poster file name (Sen-anla → Sen Anlat Karadeniz) resolves', async () => {
  const r = await resolveIdentity(S({ id: 'karadeniz-hqvms', title: 'اخبرهم ايها البحر الاسود', n: 64, poster: 'https://qesset.net/wp-content/uploads/2020/05/Sen-anla-large.jpg' }), ctxFor());
  assert.equal(r.status, 'confirmed'); assert.equal(r.best.ref, '102');
});
test('engine: renamed Turkish title (Kardelenler, formerly Kar Çiçekleri) resolves through the alternative title', async () => {
  const r = await resolveIdentity(S({ id: 'azhar-thalj-vqstm', title: 'مسلسل أزهار الثلج', n: 10, poster: 'https://qesset.net/wp-content/uploads/2019/12/Kar-cicekleri-large.jpg' }), ctxFor());
  assert.equal(r.status, 'confirmed', JSON.stringify(r.cands)); assert.equal(r.best.ref, '103'); assert.ok(r.best.evidence.some((e) => e.startsWith('latin-exact')));
});
test('engine: same Turkish name for two productions — decided by year/episodes, otherwise left unresolved (never guessed)', async () => {
  const sp = (n) => S({ id: 'ask-yolu-bcdfg', title: 'مسلسل طريق الحب', n, poster: 'https://qesset.net/wp-content/uploads/2020/05/x.jpg' });
  const ok = await resolveIdentity(sp(20), ctxFor()); assert.equal(ok.status, 'confirmed'); assert.equal(ok.best.ref, '104');
  const amb = await resolveIdentity(sp(0), ctxFor()); assert.equal(amb.status, 'unresolved');
});
test('engine: a foreign (non-Turkish) work with the same Arabic title is never accepted', async () => {
  const r = await resolveIdentity(S({ id: 'zzz-wxcvb', title: 'مسلسل قصة حب', n: 10, poster: 'https://qesset.net/wp-content/uploads/2020/05/y.jpg' }), ctxFor());
  assert.notEqual(r.status, 'confirmed');
});
test('engine: a title no source knows is resolved by the cast on the source page (actors shared with the TMDB work)', async () => {
  const show = S({ id: 'gizli-xyz', title: 'مسلسل اسم لا يعرفه أحد', n: 12, url: 'https://qesset.net/yeni-show/gizli-xyz/', poster: 'https://qesset.net/wp-content/uploads/2019/05/z.jpg' });
  const none = await resolveIdentity(show, ctxFor()); assert.notEqual(none.status, 'confirmed', 'no cast, no title → unresolved');
  const r = await resolveIdentity(show, ctxFor({ page: async () => '<div>بطولة : أولاش تونا ، آسيا قصاب ، اسم مجهول تماما ، --> الحلقة</div>' }));
  assert.equal(r.status, 'confirmed', JSON.stringify(r.cands)); assert.equal(r.best.ref, '107'); assert.ok(r.best.evidence.includes('cast:2'));   // 107 مشترك بين ممثلين، و108 بممثل واحد فقط
  assert.ok(r.cast.length >= 3);
});
test('engine: a manual override wins over everything and is flagged', async () => {
  const r = await resolveIdentity(S({ id: 'anything', title: 'مسلسل الطائر الرفراف' }), ctxFor(), { override: { tmdb: 105 } });
  assert.equal(r.status, 'confirmed'); assert.equal(r.best.ref, '105'); assert.deepEqual(r.best.evidence, ['manual-override']);
});
test('makeHttp: never logs the request URL (it can carry the TMDB key) and degrades to null on failures', async () => {
  const realFetch = globalThis.fetch, realLog = console.log; let logged = ''; console.log = (...a) => { logged += a.join(' '); };
  globalThis.fetch = async () => { throw new Error('boom api_key=SECRET'); };
  try { const h = makeHttp({ gap: 0 }); assert.equal(await h.json('https://x.test/?api_key=SECRET', 1), null); assert.equal(await h.buf('https://x.test/'), null); }
  finally { globalThis.fetch = realFetch; console.log = realLog; } assert.ok(!/SECRET/.test(logged));
});
test('engine: glued slug (icimdekifirtina) is found through the Turkish catalog by exact key, and a network failure is reported as transient (not as "unknown")', async () => {
  const show = S({ id: 'icimdekifirtina-pzvrl', title: 'مسلسل الإعصار الذي بداخلي', n: 6, poster: 'https://qesset.net/wp-content/uploads/2018/05/q-large.jpg' });
  const none = await resolveIdentity(show, ctxFor()); assert.notEqual(none.status, 'confirmed');
  const r = await resolveIdentity(show, ctxFor(), { catalog: catalogIndex([[109, 'İçimdeki Fırtına', 'İçimdeki Fırtına', 2017]]) });
  assert.equal(r.status, 'confirmed', JSON.stringify(r.cands)); assert.equal(r.best.ref, '109');
  const stats = { fail: 0 }; const down = await resolveIdentity(show, ctxFor({ stats, json: async () => { stats.fail++; return null; } }));
  assert.equal(down.status, 'unresolved'); assert.equal(down.transient, true);
});

// ---------- مجموعة الاختبار الدائمة (الـ24) ----------
import { readFileSync, existsSync } from 'node:fs';
test('permanent testset: every one of the 24 shows has its expected identity recorded; unresolved ones are never matched; manual hints are kept', () => {
  const set = JSON.parse(readFileSync('data/identity-testset.json', 'utf8')).shows, map = JSON.parse(readFileSync('data/poster-map.json', 'utf8')), idx = JSON.parse(readFileSync('data/identity-index.json', 'utf8'));
  const shows = JSON.parse(readFileSync('data/shows.json', 'utf8').replace(/^﻿/, '')).shows.map((s) => s.id); const ovr = JSON.parse(readFileSync('data/identity-overrides.json', 'utf8'));
  assert.equal(set.length, 24);
  for (const e of set) {
    assert.ok(shows.includes(e.id), 'show exists in the catalogue: ' + e.id);
    if (e.expect === 'confirmed') {
      assert.equal(map[e.id].status, 'matched', e.id); assert.equal(String(map[e.id].ref), String(e.tmdb), e.id); assert.equal(idx.shows[e.id].status, 'confirmed', e.id); assert.equal(String(idx.shows[e.id].ref), String(e.tmdb), e.id);
      assert.ok(idx.shows[e.id].evidence.length > 0, 'evidence recorded: ' + e.id); assert.ok(idx.shows[e.id].ar.length > 0, 'Arabic names recorded: ' + e.id);
      assert.ok(existsSync(map[e.id].path), 'poster file: ' + e.id);
    } else { assert.notEqual(map[e.id]?.status, 'matched', 'never matched by guess: ' + e.id); assert.notEqual(idx.shows[e.id]?.status, 'confirmed', e.id); }
  }
  assert.ok(ovr['azhar-thalj-vqstm'].names.includes('Kardelenler'));   // التلميحات البشرية محفوظة في الملف الدائم
});
