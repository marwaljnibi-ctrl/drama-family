// اختبارات وحدة (Node) لمنطق التوصيات وجسر رسائل الاستكمال. تشغيل: node --test scripts/test-family.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../recommend.js';
import { validExtMessage, ARAB_ORIGIN } from '../bridge.js';

const mk = (id, genres) => ({ id, eps: [{ id: id + '-1' }], ...(genres ? { genres } : {}) });

test('recommend: no genres in index -> honest discover mode, excludes favs and seen', () => {
  const shows = ['a', 'b', 'c', 'd', 'e'].map((x) => mk(x));
  const r = recommend({ shows, favIds: new Set(['a']), seenIds: new Set(['b']), day: 1 });
  assert.equal(r.mode, 'discover');
  assert.equal(r.title, 'اكتشف مسلسلات');
  assert.deepEqual(r.items.map((s) => s.id).sort(), ['c', 'd', 'e']);
});
test('recommend: discover order is stable within a day and changes across days', () => {
  const shows = Array.from({ length: 30 }, (_, i) => mk('s' + i));
  const f = (day) => recommend({ shows, favIds: new Set(), seenIds: new Set(), day }).items.map((s) => s.id).join();
  assert.equal(f(5), f(5));
  assert.notEqual(f(5), f(6));
});
test('recommend: personal mode only when genres cover most of the index and taste exists', () => {
  const shows = [mk('a', ['drama', 'romance']), mk('b', ['drama', 'romance']), mk('c', ['comedy']), mk('d', ['drama']), mk('e', ['action']), mk('f', ['drama', 'thriller']), mk('g', ['romance'])];
  const r = recommend({ shows, favIds: new Set(['a']), seenIds: new Set(), day: 1 });
  assert.equal(r.mode, 'personal');
  assert.equal(r.items[0].id, 'b');
  assert.ok(!r.items.some((s) => s.id === 'a'));
  const few = [mk('a', ['drama']), mk('b'), mk('c'), mk('d'), mk('e')];
  assert.equal(recommend({ shows: few, favIds: new Set(['a']), seenIds: new Set(), day: 1 }).mode, 'discover');
});

const win = {};
const ev = (over = {}) => ({ source: win, origin: ARAB_ORIGIN, data: { src: 'dizi-resume-ext', type: 'time', id: 'abc123', t: 120, d: 2700 }, ...over });
test('bridge: accepts a valid message from the iframe window, origin and episode id', () => {
  assert.deepEqual(validExtMessage(ev(), win, 'abc123'), { t: 120, d: 2700 });
});
test('bridge: rejects wrong source, origin, id, type and bad numbers', () => {
  assert.equal(validExtMessage(ev({ source: {} }), win, 'abc123'), null);
  assert.equal(validExtMessage(ev({ origin: 'https://evil.example' }), win, 'abc123'), null);
  assert.equal(validExtMessage(ev(), win, 'other'), null);
  assert.equal(validExtMessage(ev({ data: { src: 'dizi-resume-ext', type: 'found', id: 'abc123' } }), win, 'abc123'), null);
  assert.equal(validExtMessage(ev({ data: { src: 'x', type: 'time', id: 'abc123', t: 120, d: 2700 } }), win, 'abc123'), null);
  assert.equal(validExtMessage(ev({ data: { src: 'dizi-resume-ext', type: 'time', id: 'abc123', t: 1, d: 2700 } }), win, 'abc123'), null);
  assert.equal(validExtMessage(ev({ data: { src: 'dizi-resume-ext', type: 'time', id: 'abc123', t: 'NaN', d: 2700 } }), win, 'abc123'), null);
  assert.equal(validExtMessage(ev({ data: { src: 'dizi-resume-ext', type: 'time', id: 'abc123', t: 5000, d: 2700 } }), win, 'abc123'), null);
  assert.equal(validExtMessage(ev(), null, 'abc123'), null);
});
