// اختبارات معزولة لدوال التحليل. التشغيل: node --test scripts/test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseServers, epKey, buildKeyMap, parseLatest, resolveShowOf } from './lib/qesset.mjs';

const post = (servers) => Buffer.from(JSON.stringify({ codeDaily: 'x', servers })).toString('base64');
const page = (servers) => `<a href="https://qesen.net/watch/?post=${encodeURIComponent(post(servers))}">▶</a>`;

test('parseServers: يقرأ Arab HD وturk وok وexpress ويرفض غير الصالح', () => {
  const sv = parseServers(page([
    { name: 'Arab HD', id: 'efqcj4z4mm0p' }, { name: 'estream', id: 'p2y78po07xw1' },
    { name: 'express', id: 'https:\\/\\/cloud.mail.ru\\/public\\/7Ukz\\/bcpW5MWup' }, { name: 'ok', id: '17479690095296' },
    { name: 'Red HD', id: 'ooca6rou0woe' }, { name: 'ok', id: 'bad id!' }, { name: 'express', id: 'https://evil.example/x' },
  ]));
  assert.deepEqual(sv, [['a', 'efqcj4z4mm0p'], ['t', 'p2y78po07xw1'], ['e', 'https://cloud.mail.ru/public/7Ukz/bcpW5MWup'], ['o', '17479690095296']]);
});
test('parseServers: بلا رابط تشغيل = null، وJSON تالف = null', () => {
  assert.equal(parseServers('<html></html>'), null);
  assert.equal(parseServers('<a href="https://qesen.net/watch/?post=%%%">x</a>'), null);
});
test('epKey: يوحّد حلقات المسلسل (إنجليزي وعربي مرمّز)', () => {
  assert.equal(epKey('uzak-sehir-episode-71'), 'uzak-sehir');
  assert.equal(epKey('%d8%a7%d9%84%d8%ad%d9%84%d9%88%d8%a7%d8%aa-13'), 'الحلوات');
  assert.equal(epKey('karadeniz-episode-64'), epKey('karadeniz-episode-1'));
});
test('ربط الحلقة الجديدة بمسلسل اسمه مختلف عن مفتاحها', () => {
  const shows = [{ id: 'tatli-kucuk-yalancilar-fqvms', eps: [{ id: 'الحلوات-الصغيرات-الكاذبات-13' }, { id: 'الحلوات-الصغيرات-الكاذبات-12' }] }];
  const km = buildKeyMap(shows);
  assert.equal(resolveShowOf('الحلوات-الصغيرات-الكاذبات-14', km, new Map()), 'tatli-kucuk-yalancilar-fqvms');
});
test('ربط احتياطي عبر روابط الحلقات الأخرى، وغير المعروف = null', () => {
  const idToShow = new Map([['abc-episode-5', 'show-abc']]);
  assert.equal(resolveShowOf('zzz-episode-1', new Map(), idToShow, ['abc-episode-5']), 'show-abc');
  assert.equal(resolveShowOf('zzz-episode-1', new Map(), idToShow, []), null);
});
test('مفتاح مشترك بين مسلسلين يُعدّ غامضًا ولا يُستخدم', () => {
  const km = buildKeyMap([{ id: 'A', eps: [{ id: 'same-1' }] }, { id: 'B', eps: [{ id: 'same-2' }] }]);
  assert.equal(resolveShowOf('same-3', km, new Map()), null);
});
test('parseLatest: يحافظ على الترتيب ويقبل الروابط العربية ويحذف التكرار', () => {
  const html = '<a href="/clarus/a-episode-2/">x</a><a href="/clarus/%d8%b9-5/">y</a><a href="/clarus/a-episode-2/?x=1">z</a>';
  const abs = (u) => new URL(u, 'https://qesset.net').href; const slugOf = (u) => decodeURIComponent(new URL(u).pathname.replace(/\/$/, '').split('/').pop());
  assert.deepEqual(parseLatest(html, abs, slugOf).map((x) => x.id), ['a-episode-2', 'ع-5']);
});
