// اختبارات وحدة (Node) لمنطق التوصيات وجسر رسائل الاستكمال. تشغيل: node --test scripts/test-family.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../recommend.js';
import { validExtMessage, validClientMessage, ARAB_ORIGIN, OK_ORIGIN } from '../bridge.js';
import { acceptTime, canReloadNow } from '../guards.js';
import { pickDefault, alternatives } from '../servers.js';

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

test('bridge: OK origin is accepted only when requested; Arab origin rejected for OK and vice versa', () => {
  const e = ev({ origin: OK_ORIGIN, data: { src: 'dizi-resume-ext', type: 'time', id: '17432039066210', t: 300, d: 2700 } });
  assert.deepEqual(validExtMessage(e, win, '17432039066210', OK_ORIGIN), { t: 300, d: 2700 });
  assert.equal(validExtMessage(e, win, '17432039066210'), null);                       // أصل ok.ru لا يُقبل كـ Arab HD
  assert.equal(validExtMessage(ev({ origin: ARAB_ORIGIN }), win, 'abc123', OK_ORIGIN), null);  // أصل Arab HD لا يُقبل كـ OK
});

test('bridge: ready (hello/found) and time messages validated by frame, origin and video id', () => {
  const hello = ev({ data: { src: 'dizi-resume-ext', type: 'hello', id: 'abc123' } });
  assert.deepEqual(validClientMessage(hello, win, 'abc123', ARAB_ORIGIN), { type: 'ready' });
  assert.deepEqual(validClientMessage(ev({ data: { src: 'dizi-resume-ext', type: 'found', id: 'abc123' } }), win, 'abc123', ARAB_ORIGIN), { type: 'ready' });
  assert.equal(validClientMessage(hello, win, 'other', ARAB_ORIGIN), null);
  assert.equal(validClientMessage(hello, win, 'abc123', OK_ORIGIN), null);
  assert.equal(validClientMessage(ev({ source: {}, data: hello.data }), win, 'abc123', ARAB_ORIGIN), null);
  assert.deepEqual(validClientMessage(ev(), win, 'abc123', ARAB_ORIGIN), { type: 'time', t: 120, d: 2700 });
  assert.equal(validClientMessage(ev({ data: { src: 'dizi-resume-ext', type: 'time', id: 'abc123', t: 1, d: 2700 } }), win, 'abc123', ARAB_ORIGIN), null);
});

// ===== حماية التقدم من التعارض (guards.js) =====
const now = 1_000_000;
const cur = (o = {}) => ({ key: 's|e', time: 1800, updated: now - 5000, sid: 'A', ...o });
test('guard: another active session cannot lower newer progress with a one-off write', () => {
  const rej = new Map();
  const r = acceptTime({ cur: cur(), time: 200, sid: 'B', now, rej });
  assert.equal(r.ok, false);
});
test('guard: same session may rewind deliberately (even to zero)', () => {
  assert.equal(acceptTime({ cur: cur({ sid: 'A' }), time: 120, sid: 'A', now, rej: new Map() }).ok, true);
  assert.equal(acceptTime({ cur: cur({ sid: 'A' }), time: 0, sid: 'A', now, rej: new Map() }).ok, true);
});
test('guard: other session is accepted when idle for 60 s, for small drops, for forward moves and for old records', () => {
  assert.equal(acceptTime({ cur: cur({ updated: now - 61000 }), time: 200, sid: 'B', now, rej: new Map() }).ok, true);
  assert.equal(acceptTime({ cur: cur(), time: 1790, sid: 'B', now, rej: new Map() }).ok, true);
  assert.equal(acceptTime({ cur: cur(), time: 2400, sid: 'B', now, rej: new Map() }).ok, true);
  assert.equal(acceptTime({ cur: cur({ sid: undefined }), time: 200, sid: 'B', now, rej: new Map() }).ok, true);
});
test('guard: a consistent continuation after a rejected write is accepted as a deliberate rewind', () => {
  const rej = new Map();
  const first = acceptTime({ cur: cur(), time: 600, sid: 'B', now, rej });
  assert.equal(first.ok, false); rej.set('s|e', first.remember);
  const second = acceptTime({ cur: cur(), time: 603, sid: 'B', now: now + 3000, rej });
  assert.equal(second.ok, true); assert.equal(second.deliberate, true);
  const stale = acceptTime({ cur: cur(), time: 60, sid: 'B', now: now + 3000, rej });   // قفزة غير متسقة: ما زالت مرفوضة
  assert.equal(stale.ok, false);
});
test('update guard: no automatic reload on the watch page or while a video plays', () => {
  assert.equal(canReloadNow('#/home', false), true);
  assert.equal(canReloadNow('#/watch/show/ep', false), false);
  assert.equal(canReloadNow('#/home', true), false);
});
test('bridge: restore message type is accepted by origin/id check', () => {
  assert.deepEqual(validClientMessage(ev({ data: { src: 'dizi-resume-ext', type: 'restore', id: 'abc123', ok: 'yes' } }), win, 'abc123', ARAB_ORIGIN), { type: 'restore' });
});

test('servers: default is the last successful server when available, else the first', () => {
  assert.equal(pickDefault(['a', 'o'], 'o'), 'o');
  assert.equal(pickDefault(['a', 'o'], 't'), 'a');
  assert.equal(pickDefault(['a', 'o'], null), 'a');
});
test('servers: alternatives exclude the current one and keep registry order', () => {
  assert.deepEqual(alternatives(['a', 'o', 'd'], 'a'), ['o', 'd']);
  assert.deepEqual(alternatives(['a'], 'a'), []);
});
