// اختبارات تكاملية للـWorker بلا شبكة: D1 مُحاكى بـ node:sqlite (SQLite حقيقي)، وخدمة الواتساب وهمية. تشغيل: node --test worker/test/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { runCron } from '../src/index.js';
import { parseLatestTail, epNum, detectNew, watchLink } from '../src/logic.js';

const mkDB = () => {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    prepare: (s) => { const st = db.prepare(s); return { bind: (...a) => ({ first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }), _run: () => st.run(...a) }) }; },
    batch: async (stmts) => { db.exec('BEGIN'); try { for (const s of stmts) s._run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; },
    raw: db,
  };
};
let LATEST = [], UM = [], UM_STATUS = 201;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === 'https://data.test/shows.json') return new Response('...junk...,"latest":' + JSON.stringify(LATEST) + '}', { status: 200 });
  if (u === 'https://api.unlimitedmessaging.app/message') { UM.push({ auth: init.headers.authorization, ...JSON.parse(init.body) }); return new Response(JSON.stringify({ id: 'msg1' }), { status: UM_STATUS }); }
  return realFetch(url, init);
};
const env = () => ({ DB: mkDB(), DATA_URL: 'https://data.test/shows.json', DIZI_URL: 'https://dizi.test/', SETTINGS_URL: 'https://settings.test/', ALLOWED_ORIGINS: 'https://settings.test', UM_API_KEY: 'ak_test', ADMIN_KEY: 'adm-secret' });
const cnt = async (e, t) => (await e.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).bind().first()).n;
const call = async (e, path, { method = 'POST', key, body } = {}) => { const r = await worker.fetch(new Request('https://w.test' + path, { method, headers: { authorization: key ? 'Bearer ' + key : '', 'content-type': 'application/json', origin: 'https://settings.test' }, body: body ? JSON.stringify(body) : undefined }), e); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const ep = (showId, n) => ({ showId, epId: `${showId}-episode-${n}`, ts: 1 });
const tokOf = (link) => link.split('#/alerts/')[1];
async function setup({ enable = true, subscribe = ['s1'] } = {}) {
  LATEST = [ep('s1', 5), ep('s2', 9), ep('s1', 4)]; UM = []; UM_STATUS = 201;
  const e = env(); await runCron(e, 1000);                      // نقطة البداية
  const r = await call(e, '/admin/member', { key: 'adm-secret', body: { name: 'Ali', phone: '+971500000001' } });
  const token = tokOf(r.body.link);
  await call(e, '/api/consent', { key: token, body: { agree: true } });
  for (const s of subscribe) await call(e, '/api/shows', { key: token, body: { showId: s, title: 'مسلسل ' + s, on: true } });
  if (enable) await call(e, '/admin/enable', { key: 'adm-secret', body: { on: true } });
  return { e, token };
}

test('logic: parse latest tail, episode number, detectNew, watch link', () => {
  const t = 'xxxx,"latest":[{"showId":"a","epId":"a-episode-7","ts":1},{"showId":"b","epId":"b-episode-2","ts":2}]}';
  assert.equal(parseLatestTail(t).length, 2);
  assert.equal(parseLatestTail('no latest here'), null);
  assert.equal(epNum('a-episode-12'), 12); assert.equal(epNum('sezon-3/'), 3); assert.equal(epNum('abc'), null);
  const d = detectNew([{ epId: 'x' }, { epId: 'y' }], ['x']); assert.deepEqual(d.fresh.map((z) => z.epId), ['y']);
  assert.equal(watchLink('https://d.test', 'مسلسل', 'ep 1'), 'https://d.test/#/watch/%D9%85%D8%B3%D9%84%D8%B3%D9%84/ep%201');
});

test('baseline: first run sends nothing and records existing episodes (old episodes are never notified)', async () => {
  LATEST = Array.from({ length: 30 }, (_, i) => ep('s' + (i % 5), i + 1)); UM = [];
  const e = env(); const r = await runCron(e, 1000);
  assert.equal(r.baseline, 30); assert.equal(UM.length, 0);
  const meta = JSON.parse((await e.DB.prepare("SELECT v FROM meta WHERE k='meta'").bind().first()).v); assert.equal(meta.enabled, false);
  await runCron(e, 2000); assert.equal(UM.length, 0);           // نفس القائمة: لا جديد
});

test('sending is disabled by default: new episodes advance seen but nothing is sent or queued', async () => {
  const { e } = await setup({ enable: false });
  LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 3000);
  assert.equal(UM.length, 0); assert.equal(await cnt(e, 'outbox'), 0);
  await call(e, '/admin/enable', { key: 'adm-secret', body: { on: true } });
  await runCron(e, 4000); assert.equal(UM.length, 0);           // لا فيضان بأثر رجعي عند التفعيل
});

test('new episode of a subscribed show -> exactly one WhatsApp message with title, number and link; never twice', async () => {
  const { e } = await setup();
  LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 3000);
  assert.equal(UM.length, 1);
  assert.equal(UM[0].recipient, '+971500000001'); assert.equal(UM[0].auth, 'Bearer ak_test');
  assert.match(UM[0].text, /مسلسل s1/); assert.match(UM[0].text, /الحلقة 6/); assert.match(UM[0].text, /https:\/\/dizi\.test\/#\/watch\/s1\/s1-episode-6/);
  await runCron(e, 4000); await runCron(e, 5000); assert.equal(UM.length, 1);   // لا تكرار
  const m = JSON.parse((await e.DB.prepare("SELECT v FROM meta WHERE k='meta'").bind().first()).v); m.seen = m.seen.filter((x) => x !== 's1-episode-6');
  await e.DB.prepare("UPDATE meta SET v=? WHERE k='meta'").bind(JSON.stringify(m)).run();
  await runCron(e, 6000); assert.equal(UM.length, 1);           // حتى لو عاد معرّف الحلقة «جديدًا»: علامة sent تمنع التكرار
});

test('other shows do not notify', async () => {
  const { e } = await setup();
  LATEST = [ep('s2', 10), ...LATEST]; await runCron(e, 3000); assert.equal(UM.length, 0);
});

test('unsubscribe stops pending messages immediately (strong consistency)', async () => {
  const { e, token } = await setup();
  UM_STATUS = 500;                                              // الإرسال يفشل: تبقى الرسالة معلقة في الطابور
  LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 3000);
  assert.equal(await cnt(e, 'outbox'), 1);
  await call(e, '/api/shows', { key: token, body: { showId: 's1', on: false } });
  assert.equal(await cnt(e, 'outbox'), 0);                      // حُذفت المعلقة فورًا
  UM_STATUS = 201; UM = []; await runCron(e, 4000); assert.equal(UM.length, 0);
});

test('withdrawing consent stops pending messages and new ones', async () => {
  const { e, token } = await setup();
  UM_STATUS = 500; LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 3000);
  await call(e, '/api/consent', { key: token, body: { agree: false } });
  assert.equal(await cnt(e, 'outbox'), 0);
  UM_STATUS = 201; UM = []; LATEST = [ep('s1', 7), ...LATEST]; await runCron(e, 4000); assert.equal(UM.length, 0);
});

test('failed sends retry at most 3 times; a later success never double-sends', async () => {
  const { e } = await setup();
  UM_STATUS = 500; LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 3000); await runCron(e, 4000); await runCron(e, 5000); await runCron(e, 6000);
  assert.equal(UM.length, 3); assert.equal(await cnt(e, 'outbox'), 0);
});

test('disabling sending clears the queue', async () => {
  const { e } = await setup();
  UM_STATUS = 500; LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 3000); assert.equal(await cnt(e, 'outbox'), 1);
  await call(e, '/admin/enable', { key: 'adm-secret', body: { on: false } }); assert.equal(await cnt(e, 'outbox'), 0);
});

test('security: private links are per-member, bad tokens rejected, admin key required, subscribe needs consent, tokens not stored', async () => {
  const { e, token } = await setup({ subscribe: [] });
  const r2 = await call(e, '/admin/member', { key: 'adm-secret', body: { name: 'Sara', phone: '+971500000002' } });
  const token2 = tokOf(r2.body.link);
  assert.notEqual(token, token2); assert.match(token, /^[0-9a-f]{32}$/);
  await call(e, '/api/consent', { key: token2, body: { agree: true } });
  await call(e, '/api/shows', { key: token2, body: { showId: 's1', title: 'x', on: true } });
  const me1 = await call(e, '/api/me', { key: token }); assert.equal(me1.body.shows.length, 0);   // اشتراك سارة لا يظهر لعلي
  assert.equal((await call(e, '/api/me', { key: 'f'.repeat(32) })).status, 401);
  assert.equal((await call(e, '/api/me', { key: 'short' })).status, 401);
  assert.equal((await call(e, '/admin/status', { key: 'nope', method: 'GET' })).status, 401);
  assert.equal((await call(e, '/admin/status', { key: '', method: 'GET' })).status, 401);
  const e2 = env(); const rr = await call(e2, '/admin/member', { key: 'adm-secret', body: { name: 'N', phone: '+971500000003' } });
  const t3 = tokOf(rr.body.link); assert.equal((await call(e2, '/api/shows', { key: t3, body: { showId: 's1', title: 'x', on: true } })).status, 403);   // بلا موافقة
  assert.equal((await call(e, '/admin/member', { key: 'adm-secret', body: { name: 'D', phone: '+971500000001' } })).status, 409);
  assert.equal((await call(e, '/admin/member', { key: 'adm-secret', body: { name: 'D', phone: '0500' } })).status, 400);
  const dump = JSON.stringify(e.DB.raw.prepare('SELECT * FROM members').all());
  assert.ok(!dump.includes(token) && !dump.includes(token2), 'raw token must not be stored');
});

test('rotate invalidates the old link and keeps subscriptions; remove deletes everything', async () => {
  const { e, token } = await setup();
  const r = await call(e, '/admin/rotate', { key: 'adm-secret', body: { phone: '+971500000001' } }); const nt = tokOf(r.body.link);
  assert.equal((await call(e, '/api/me', { key: token })).status, 401);
  assert.equal((await call(e, '/api/me', { key: nt })).body.shows.length, 1);
  assert.equal((await call(e, '/admin/remove', { key: 'adm-secret', body: { phone: '+971500000001' } })).body.removed, true);
  assert.equal(await cnt(e, 'members') + await cnt(e, 'subs') + await cnt(e, 'outbox'), 0);
});

test('CORS only for allowed origins', async () => {
  const e = env();
  const ok = await worker.fetch(new Request('https://w.test/api/health', { headers: { origin: 'https://settings.test' } }), e);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://settings.test');
  const bad = await worker.fetch(new Request('https://w.test/api/health', { headers: { origin: 'https://evil.test' } }), e);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('admin test message returns the provider message id; wa endpoints need admin key and a bad id is rejected', async () => {
  const e = env(); UM = []; UM_STATUS = 201;
  const r = await call(e, '/admin/test', { key: 'adm-secret', body: { phone: '+971500000001' } });
  assert.equal(r.status, 200); assert.equal(r.body.messageId, 'msg1'); assert.equal(UM.length, 1);
  assert.equal((await call(e, '/admin/wa/link', { key: 'bad', body: {} })).status, 401);
  assert.equal((await call(e, '/admin/wa/account', { key: 'adm-secret', body: { id: '!!' } })).status, 400);
});
