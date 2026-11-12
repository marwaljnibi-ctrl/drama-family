// اختبارات اختيار البوسترات: التطبيع، أسماء البحث من المعرّف، تقييم الجودة، وسلوك الأتمتة (مرة واحدة لكل مسلسل، لا إعادة فحص، حماية من التطابق الخاطئ).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sharp = (await import('sharp')).default;
const { norm, slugVariants, assess, upgradePosters } = await import('./poster-pick.mjs');

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

test('automation: a new show is matched once, recorded, and never re-evaluated; unmatched waits a week; wrong-country/inexact names are rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'poster-')); const prev = process.cwd(); process.chdir(dir);
  const img = await noisy(680, 1000); let calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    u = String(u); calls.push(u);
    if (u.startsWith('https://api.tvmaze.com/search/shows')) {
      const q = decodeURIComponent(u.split('q=')[1]);
      const show = (name, country = 'TR') => ({ show: { id: 7, name, language: country === 'TR' ? 'Turkish' : 'English', network: { country: { code: country } }, premiered: '2020-01-01', image: { original: 'https://img.test/p.jpg' } } });
      if (q === 'yeni dizi') return new Response(JSON.stringify([show('Yeni Dizi')]));
      if (q === 'ayni isim') return new Response(JSON.stringify([show('Ayni Isim', 'US')]));        // بلد غير تركيا
      if (q === 'baska') return new Response(JSON.stringify([show('Baska Dizi')]));                  // اسم غير مطابق تمامًا
      if (q === 'remake dizi') return new Response(JSON.stringify([{ show: { ...show('Remake Dizi').show, id: 11, premiered: '2014-01-01' } }, { show: { ...show('Remake Dizi').show, id: 12, premiered: '2020-01-01' } }]));
      return new Response('[]');
    }
    if (u.endsWith('/shows/11/episodes')) return new Response(JSON.stringify(Array.from({ length: 20 }, () => ({ type: 'regular' }))));
    if (u.endsWith('/shows/12/episodes')) return new Response(JSON.stringify(Array.from({ length: 60 }, () => ({ type: 'regular' }))));
    if (u === 'https://img.test/p.jpg') return new Response(img);
    return new Response('', { status: 404 });
  };
  try {
    const shows = [{ id: 'yeni-dizi-bcdfg', img2: 'old.webp' }, { id: 'ayni-isim-qwrty' }, { id: 'baska-xyzqw' }, { id: 'remake-dizi-bcdfg', eps: Array.from({ length: 20 }, () => ({})) }];
    await upgradePosters(shows, { max: 10, tmdbKey: '' });
    const map = JSON.parse(readFileSync('data/poster-map.json', 'utf8'));
    assert.equal(map['yeni-dizi-bcdfg'].status, 'matched'); assert.ok(existsSync(map['yeni-dizi-bcdfg'].path)); assert.equal(shows[0].img3, map['yeni-dizi-bcdfg'].path); assert.equal(map['yeni-dizi-bcdfg'].prev, 'old.webp');
    assert.equal(map['ayni-isim-qwrty'].status, 'unmatched'); assert.equal(map['baska-xyzqw'].status, 'review');   // اسم جزئي بلا تأكيد عدد حلقات = مراجعة
    assert.equal(map['remake-dizi-bcdfg'].status, 'matched'); assert.equal(map['remake-dizi-bcdfg'].ref, '11'); assert.equal(map['remake-dizi-bcdfg'].conf, 'medium');   // أسماء متطابقة: حُسمت بعدد الحلقات        // التطابق غير المؤكد = تبقى الصورة الأصلية
    assert.equal(shows[1].img3, undefined); assert.equal(shows[2].img3, undefined);
    const n = calls.length; const s2 = [{ id: 'yeni-dizi-bcdfg' }, { id: 'ayni-isim-qwrty' }, { id: 'baska-xyzqw' }, { id: 'remake-dizi-bcdfg' }];
    await upgradePosters(s2, { max: 10, tmdbKey: '' });
    assert.equal(calls.length, n, 'no network calls on the second run (matched final, unmatched waits)');
    assert.equal(s2[0].img3, map['yeni-dizi-bcdfg'].path);                                                                  // المعتمد يُطبَّق بلا إعادة فحص
  } finally { globalThis.fetch = realFetch; process.chdir(prev); }
});
