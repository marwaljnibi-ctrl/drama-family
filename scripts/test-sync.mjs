// اختبار منطق دمج المزامنة (آخر كتابة أحدث تفوز) بلا متصفح
import test from 'node:test';
import assert from 'node:assert/strict';
const { planMerge } = await import('../sync.js');

const P = (key, updated, time = 10) => ({ key, showId: 's', epId: key.split('|')[1], epNum: 1, time, duration: 100, done: false, hidden: false, updated });

test('server-only data is pulled; local-only data is pushed (legacy data is preserved, never dropped)', () => {
  const r = planMerge({ favs: [{ showId: 'L', at: 5 }], progress: [P('s|L1', 50)] }, { favs: [{ showId: 'S', on: true, at: 6 }], progress: [P('s|S1', 60)] });
  assert.deepEqual(r.putFav.map((f) => f.showId), ['S']); assert.deepEqual(r.putProg.map((p) => p.key), ['s|S1']);
  assert.deepEqual(r.pushFav.map((f) => f.showId), ['L']); assert.deepEqual(r.pushProg.map((p) => p.key), ['s|L1']);
  assert.equal(r.delFav.length, 0);
});
test('newer wins both ways: older server value does not overwrite newer local, newer server replaces older local', () => {
  const r = planMerge({ favs: [], progress: [P('s|a', 200, 90), P('s|b', 100, 10)] }, { favs: [], progress: [P('s|a', 100, 5), P('s|b', 300, 70)] });
  assert.deepEqual(r.pushProg.map((p) => p.key), ['s|a']); assert.deepEqual(r.putProg.map((p) => p.key), ['s|b']); assert.equal(r.putProg[0].time, 70);
});
test('favorite removed on another device is removed here only if the removal is newer', () => {
  assert.deepEqual(planMerge({ favs: [{ showId: 'x', at: 10 }], progress: [] }, { favs: [{ showId: 'x', on: false, at: 20 }], progress: [] }).delFav, ['x']);
  const keep = planMerge({ favs: [{ showId: 'x', at: 30 }], progress: [] }, { favs: [{ showId: 'x', on: false, at: 20 }], progress: [] });
  assert.equal(keep.delFav.length, 0); assert.equal(keep.pushFav[0].showId, 'x');
});

test('guest import: adds missing favorites/progress, keeps the newer progress, never mutates inputs', async () => {
  const { mergeGuest } = await import('../sync.js');
  const guest = { favs: [{ showId: 'a', at: 1 }, { showId: 'b', at: 2 }], progress: [P('s|1', 100, 30), P('s|2', 300, 50), P('s|3', 50, 5)] };
  const mine = { favs: [{ showId: 'a', at: 9 }], progress: [P('s|1', 200, 90), P('s|2', 100, 10)] };
  const add = mergeGuest(guest, mine);
  assert.deepEqual(add.favs.map((f) => f.showId), ['b']);                       // لا تكرار، ولا استبدال لما في الحساب
  assert.deepEqual(add.progress.map((p) => p.key).sort(), ['s|2', 's|3']);      // s|1 الأحدث في الحساب يبقى، وs|2 الأحدث عند الضيف يُضاف
  assert.equal(guest.favs.length, 2); assert.equal(mine.favs.length, 1);
});

test('an empty placeholder record (episode opened, nothing watched) never beats real cloud progress and is never pushed', async () => {
  const { isReal } = await import('../sync.js');
  const empty = { key: 's|e', showId: 's', epId: 'e', epNum: 1, time: 0, duration: 0, done: false, hidden: false, updated: 9999 };
  assert.equal(isReal(empty), false); assert.equal(isReal(P('s|e', 1, 5)), true);
  const r = planMerge({ favs: [], progress: [empty] }, { favs: [], progress: [P('s|e', 1000, 600)] });
  assert.deepEqual(r.putProg.map((p) => p.time), [600]); assert.equal(r.pushProg.length, 0);
  assert.equal(planMerge({ favs: [], progress: [empty] }, { favs: [], progress: [] }).pushProg.length, 0);
});
