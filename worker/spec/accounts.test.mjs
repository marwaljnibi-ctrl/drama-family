// اختبارات الحسابات: توكنات Google مُحاكاة (مفتاح RSA حقيقي يُولَّد في الاختبار) + SQLite حقيقي + واتساب وهمي.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle } from '../src/index.js';
import { runCron } from '../src/index.js';
import { resetGoogleKeys } from '../src/auth.js';

const CLIENT = 'client-123.apps.googleusercontent.com';
const mkDB = () => {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return { prepare: (s) => { const st = db.prepare(s); return { bind: (...a) => ({ first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }), _run: () => st.run(...a) }) }; },
    batch: async (stmts) => { db.exec('BEGIN'); try { for (const s of stmts) s._run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; }, raw: db };
};
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('jwk', kp.publicKey); pub.kid = 'k1';
const kp2 = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = async (payload, key = kp.privateKey, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) => { const h = b64u(JSON.stringify(header)), p = b64u(JSON.stringify(payload)); const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p)); return h + '.' + p + '.' + b64u(s); };
const NOW = 1_800_000_000_000;
const idt = (o = {}, key) => sign({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'sub1', email: 'ali@example.com', email_verified: true, name: 'Ali', exp: NOW / 1000 + 3600, ...o }, key);
const getKeys = async () => [pub];
let UM = [], UM_STATUS = 201, LATEST = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === 'https://data.test/shows.json') return new Response('..,"latest":' + JSON.stringify(LATEST) + '}', { status: 200 });
  if (u === 'https://api.unlimitedmessaging.app/message') { UM.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'm' + UM.length }), { status: UM_STATUS }); }
  return realFetch(url, init);
};
const env = () => ({ DB: mkDB(), GOOGLE_CLIENT_ID: CLIENT, REQUIRE_INVITE: '1', DATA_URL: 'https://data.test/shows.json', DIZI_URL: 'https://dizi.test/', SETTINGS_URL: 'https://app.test/', ALLOWED_ORIGINS: 'https://app.test', UM_API_KEY: 'ak', ADMIN_KEY: 'adm-secret' });
const call = async (e, path, { key, body, now = NOW, ip } = {}) => { const r = await handle(new Request('https://w.test' + path, { method: 'POST', headers: { authorization: key ? 'Bearer ' + key : '', 'content-type': 'application/json', origin: 'https://app.test', ...(ip ? { 'cf-connecting-ip': ip } : {}) }, body: JSON.stringify(body || {}) }), e, { now, getKeys }); return { status: r.status, body: await r.json().catch(() => null) }; };
const adm = (e, path, body) => call(e, path, { key: 'adm-secret', body });
async function login(e, who = {}, invite = true) {
  if (invite) await adm(e, '/admin/invite', { email: who.email || 'ali@example.com' });
  return call(e, '/auth/google', { body: { credential: await idt(who) } });
}
const cnt = async (e, t) => (await e.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).bind().first()).n;
const lastCode = () => UM.filter((m) => /رمز التحقق/.test(m.text)).pop().text.match(/(\d{6})/)[1];

test('google token: valid + invited -> session; not invited -> 403; forged/expired/wrong audience -> 401', async () => {
  resetGoogleKeys(); const e = env();
  const bad = await call(e, '/auth/google', { body: { credential: await idt() } });
  assert.equal(bad.status, 403); assert.equal(bad.body.error, 'not_invited');
  await adm(e, '/admin/invite', { email: 'Ali@Example.com' });
  const ok = await call(e, '/auth/google', { body: { credential: await idt() } });
  assert.equal(ok.status, 200); assert.match(ok.body.session, /^[0-9a-f]{64}$/); assert.equal(ok.body.profile.wa.prompt, 'pending');
  for (const [name, tok] of [['forged', await idt({}, kp2.privateKey)], ['expired', await idt({ exp: NOW / 1000 - 10 })], ['wrong-aud', await idt({ aud: 'other' })], ['unverified', await idt({ email_verified: false })], ['wrong-iss', await idt({ iss: 'https://evil.test' })], ['garbage', 'a.b.c']]) {
    assert.equal((await call(e, '/auth/google', { body: { credential: tok } })).status, 401, name);
  }
  assert.equal(await cnt(e, 'users'), 1);
});

test('session persists (sliding), logout kills it, unknown session rejected, uninvite revokes access', async () => {
  const e = env(); const { body: { session } } = await login(e);
  assert.equal((await call(e, '/api/profile', { key: session, now: NOW + 30 * 86400000 })).status, 200);     // بعد 30 يومًا ما زالت صالحة
  assert.equal((await call(e, '/api/profile', { key: session, now: NOW + 130 * 86400000 })).status, 401);     // بعد انتهاء المدة
  const s2 = (await login(e)).body.session;
  assert.equal((await call(e, '/auth/logout', { key: s2 })).status, 200);
  assert.equal((await call(e, '/api/profile', { key: s2 })).status, 401);
  assert.equal((await call(e, '/api/profile', { key: 'a'.repeat(64) })).status, 401);
  const s3 = (await login(e)).body.session; await adm(e, '/admin/uninvite', { email: 'ali@example.com' });
  assert.equal((await call(e, '/api/profile', { key: s3 })).status, 401);
  assert.equal((await call(e, '/auth/google', { body: { credential: await idt() } })).status, 403);
});

test('two accounts are isolated: favorites, progress, subscriptions', async () => {
  const e = env();
  const A = (await login(e, { sub: 'A', email: 'a@example.com', name: 'A' })).body.session;
  const B = (await login(e, { sub: 'B', email: 'b@example.com', name: 'B' })).body.session;
  await call(e, '/api/fav', { key: A, body: { showId: 'show1', on: true, at: 10 } });
  await call(e, '/api/progress', { key: A, body: { items: [{ key: 'show1|ep1', showId: 'show1', epId: 'ep1', epNum: 1, time: 600, duration: 2700, done: false, updated: 100 }] } });
  const sa = (await call(e, '/api/sync', { key: A })).body, sb = (await call(e, '/api/sync', { key: B })).body;
  assert.equal(sa.favs.length, 1); assert.equal(sa.progress.length, 1); assert.equal(sa.progress[0].time, 600);
  assert.equal(sb.favs.length, 0); assert.equal(sb.progress.length, 0);                              // حساب B لا يرى شيئًا من A
  await call(e, '/api/fav', { key: B, body: { showId: 'show1', on: true, at: 11 } });
  await call(e, '/api/fav', { key: B, body: { showId: 'show1', on: false, at: 12 } });
  assert.equal((await call(e, '/api/sync', { key: A })).body.favs[0].on, true);                      // إلغاء B لا يمس A
});

test('sync is last-writer-wins and never lets an older write overwrite newer data', async () => {
  const e = env(); const A = (await login(e)).body.session;
  const put = (t, u) => call(e, '/api/progress', { key: A, body: { items: [{ key: 's|e', showId: 's', epId: 'e', epNum: 1, time: t, duration: 100, done: false, updated: u }] } });
  await put(50, 200); await put(10, 100);                                                             // كتابة أقدم متأخرة: تُتجاهل
  assert.equal((await call(e, '/api/sync', { key: A })).body.progress[0].time, 50);
  await put(70, 300); assert.equal((await call(e, '/api/sync', { key: A })).body.progress[0].time, 70);
  await call(e, '/api/fav', { key: A, body: { showId: 's', on: true, at: 5 } }); await call(e, '/api/fav', { key: A, body: { showId: 's', on: false, at: 3 } });
  assert.equal((await call(e, '/api/sync', { key: A })).body.favs[0].on, true);
});

test('whatsapp: phone needs explicit consent, code verification, then subscriptions; wrong code/attempts/expiry/rate limit', async () => {
  const e = env(); UM = []; UM_STATUS = 201;
  const A = (await login(e)).body.session;
  assert.equal((await call(e, '/api/shows', { key: A, body: { showId: 's1', title: 't', on: true } })).body.error, 'wa_not_ready');      // قبل التفعيل
  assert.equal((await call(e, '/api/wa/phone', { key: A, body: { phone: '+971500000001' } })).status, 400);                              // بلا موافقة
  assert.equal((await call(e, '/api/wa/phone', { key: A, body: { phone: '0500', agree: true } })).status, 400);
  assert.equal((await call(e, '/api/wa/phone', { key: A, body: { phone: '+971500000001', agree: true } })).body.sent, true);
  assert.equal(UM.length, 1); assert.equal(UM[0].recipient, '+971500000001');
  assert.equal((await call(e, '/api/shows', { key: A, body: { showId: 's1', title: 't', on: true } })).status, 403);                     // لم يتأكد الرقم بعد
  assert.equal((await call(e, '/api/wa/verify', { key: A, body: { code: '000000' } })).body.error, 'wrong code');
  const prof = await call(e, '/api/wa/verify', { key: A, body: { code: lastCode() } });
  assert.equal(prof.body.wa.verified, true); assert.equal(prof.body.wa.consent, true); assert.match(prof.body.wa.phone, /^\+971•+001$/);
  assert.ok(!JSON.stringify(prof.body).includes('500000001'), 'full phone never returned');
  const sub = await call(e, '/api/shows', { key: A, body: { showId: 's1', title: 'مسلسل', on: true } });
  assert.equal(sub.body.shows.length, 1);
  // 5 محاولات خاطئة ثم الحظر؛ رمز منتهي؛ 3 إرسالات في الساعة
  const e2 = env(); const B = (await login(e2, { sub: 'B', email: 'b@example.com' })).body.session;
  await call(e2, '/api/wa/phone', { key: B, body: { phone: '+971500000002', agree: true } });
  for (let i = 0; i < 5; i++) await call(e2, '/api/wa/verify', { key: B, body: { code: '111111' } });
  assert.equal((await call(e2, '/api/wa/verify', { key: B, body: { code: lastCode() } })).status, 429);
  const e3 = env(); const C = (await login(e3, { sub: 'C', email: 'c@example.com' })).body.session;
  await call(e3, '/api/wa/phone', { key: C, body: { phone: '+971500000003', agree: true } });
  assert.equal((await call(e3, '/api/wa/verify', { key: C, body: { code: lastCode() }, now: NOW + 11 * 60000 })).body.error, 'expired');
  const t0 = NOW + 12 * 60000;
  await call(e3, '/api/wa/phone', { key: C, now: t0, body: { phone: '+971500000003', agree: true } }); await call(e3, '/api/wa/phone', { key: C, now: t0 + 70000, body: { phone: '+971500000003', agree: true } });
  assert.equal((await call(e3, '/api/wa/phone', { key: C, now: t0 + 140000, body: { phone: '+971500000003', agree: true } })).status, 429);
});

test('a phone number can belong to one account only', async () => {
  const e = env(); UM = [];
  const A = (await login(e, { sub: 'A', email: 'a@example.com' })).body.session; const B = (await login(e, { sub: 'B', email: 'b@example.com' })).body.session;
  await call(e, '/api/wa/phone', { key: A, body: { phone: '+971500000009', agree: true } }); await call(e, '/api/wa/verify', { key: A, body: { code: lastCode() } });
  assert.equal((await call(e, '/api/wa/phone', { key: B, body: { phone: '+971500000009', agree: true } })).status, 409);
});

async function ready(e, sess, phone, shows = ['s1']) {
  await call(e, '/api/wa/phone', { key: sess, body: { phone, agree: true } }); await call(e, '/api/wa/verify', { key: sess, body: { code: lastCode() } });
  for (const s of shows) await call(e, '/api/shows', { key: sess, body: { showId: s, title: 'مسلسل ' + s, on: true } });
}
const ep = (showId, n) => ({ showId, epId: `${showId}-episode-${n}`, ts: 1 });

test('alerts through accounts: baseline silent, one message per new episode, no duplicates, stop-all and unsubscribe are immediate', async () => {
  const e = env(); UM = []; UM_STATUS = 201; LATEST = [ep('s1', 5), ep('s2', 9)];
  const A = (await login(e)).body.session;
  await runCron(e, 1000); await ready(e, A, '+971500000001'); const before = UM.length;
  await adm(e, '/admin/enable', { on: true });
  LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 3000);
  assert.equal(UM.length, before + 1); assert.match(UM[UM.length - 1].text, /الحلقة 6/);
  await runCron(e, 4000); await runCron(e, 5000); assert.equal(UM.length, before + 1);                                 // لا تكرار
  UM_STATUS = 500; LATEST = [ep('s1', 7), ...LATEST]; await runCron(e, 6000);                                       // معلّقة (فشل الإرسال)
  assert.equal(await cnt(e, 'outbox'), 1);
  await call(e, '/api/wa/stop', { key: A }); assert.equal(await cnt(e, 'outbox'), 0);                                  // إيقاف الكل يحذف المعلّق فورًا
  UM_STATUS = 201; const n = UM.length; LATEST = [ep('s1', 8), ...LATEST]; await runCron(e, 7000); assert.equal(UM.length, n);   // لا رسائل بعد الإيقاف
  const p = await call(e, '/api/wa/resume', { key: A }); assert.equal(p.body.wa.consent, true); assert.equal(p.body.shows.length, 1);      // الاشتراك بقي محفوظًا
  LATEST = [ep('s1', 9), ...LATEST]; await runCron(e, 8000); assert.equal(UM.length, n + 1);
  await call(e, '/api/shows', { key: A, body: { showId: 's1', on: false } });
  LATEST = [ep('s1', 10), ...LATEST]; await runCron(e, 9000); assert.equal(UM.length, n + 1);                          // بعد إلغاء المسلسل لا رسائل
});

test('onboarding decision is stored once; legacy private-link members keep working', async () => {
  const e = env(); const A = (await login(e)).body.session;
  assert.equal((await call(e, '/api/wa/prompt', { key: A, body: { answer: 'no' } })).body.wa.prompt, 'no');
  assert.equal((await login(e)).body.profile.wa.prompt, 'no');                                                         // لا يُسأل مرة أخرى بعد الدخول من جديد
  assert.equal((await call(e, '/api/wa/prompt', { key: A, body: { answer: 'maybe' } })).status, 400);
  const m = await adm(e, '/admin/member', { name: 'Old', phone: '+971500000077' }); const tok = m.body.link.split('#/alerts/')[1];
  assert.equal((await call(e, '/api/me', { key: tok })).body.name, 'Old');
});

// ===== حماية الإرسال: فاصل لكل مستخدم، حد لكل رقم، حد لكل IP، سقف عام =====
const users = async (e, n) => { const out = []; for (let i = 0; i < n; i++) out.push((await login(e, { sub: 'U' + i, email: `u${i}@example.com`, name: 'U' + i })).body.session); return out; };
const sendCode = (e, key, phone, o = {}) => call(e, '/api/wa/phone', { key, body: { phone, agree: true }, ...o });

test('otp limits: per-user cooldown, per-phone cap (any account), per-IP cap, global daily cap, window reopens', async () => {
  const e = env(); UM = []; const [A, B, C, D] = await users(e, 4);
  assert.equal((await sendCode(e, A, '+971500000050')).status, 200);
  assert.equal((await sendCode(e, A, '+971500000051', { now: NOW + 30000 })).body.error, 'slow down');                  // طلبات متتالية سريعة (آلية)
  assert.equal((await sendCode(e, B, '+971500000050', { now: NOW + 1000 })).status, 200);
  assert.equal((await sendCode(e, C, '+971500000050', { now: NOW + 2000 })).status, 200);
  const r = await sendCode(e, D, '+971500000050', { now: NOW + 3000 });                                                // رقم رابع في الساعة: مرفوض (حماية رقم الضحية)
  assert.equal(r.status, 429); assert.equal(UM.length, 3, 'rejected requests send nothing');
  assert.equal((await sendCode(e, D, '+971500000050', { now: NOW + 3700000 })).status, 200);                           // بعد ساعة يُفتح
  const e2 = env(); const many = await users(e2, 11); let ok = 0;
  for (let i = 0; i < 11; i++) if ((await sendCode(e2, many[i], '+9715000001' + String(10 + i), { ip: '9.9.9.9', now: NOW + i * 1000 })).status === 200) ok++;
  assert.equal(ok, 10);                                                                                                // IP واحد: 10 في الساعة
  const e3 = env(); e3.OTP_DAILY_CAP = '3'; UM = []; const few = await users(e3, 4);
  for (let i = 0; i < 3; i++) assert.equal((await sendCode(e3, few[i], '+9715000002' + i, { ip: '1.1.1.' + i, now: NOW + i * 1000 })).status, 200);
  assert.equal((await sendCode(e3, few[3], '+971500000299', { ip: '1.1.1.9', now: NOW + 5000 })).body.error, 'busy');   // السقف العام يحمي رقم الإرسال
  assert.equal(UM.length, 3);
});

// ===== عزل الحسابات ومحاولات الوصول لبيانات الغير =====
test('isolation: a session can never read or change another user (forged uid fields, unsubscribe, admin, logout)', async () => {
  const e = env(); UM = []; LATEST = [ep('s1', 1), ep('s2', 1)];
  const A = (await login(e, { sub: 'A', email: 'a@example.com', name: 'A' })).body.session, B = (await login(e, { sub: 'B', email: 'b@example.com', name: 'B' })).body.session;
  await runCron(e, 1000); await ready(e, A, '+971500000061', ['s1']); await ready(e, B, '+971500000062', ['s2']);
  await call(e, '/api/fav', { key: A, body: { showId: 's1', on: true, at: 5 } });
  await call(e, '/api/progress', { key: A, body: { items: [{ key: 's1|e1', showId: 's1', epId: 'e1', epNum: 1, time: 123, duration: 900, updated: 50 }] } });
  // B يحاول انتحال A بحقول إضافية: تُتجاهل، ويُنسب كل شيء إلى B
  await call(e, '/api/fav', { key: B, body: { showId: 's1', on: false, at: 99, uid: 'g_A', h: 'u:g_A' } });
  await call(e, '/api/progress', { key: B, body: { uid: 'g_A', items: [{ key: 's1|e1', showId: 's1', epId: 'e1', time: 1, duration: 900, updated: 999, uid: 'g_A' }] } });
  await call(e, '/api/shows', { key: B, body: { showId: 's1', on: false, uid: 'g_A', h: 'u:g_A' } });
  const sa = (await call(e, '/api/sync', { key: A })).body, pa = (await call(e, '/api/profile', { key: A })).body;
  assert.equal(sa.favs[0].on, true); assert.equal(sa.progress[0].time, 123); assert.equal(pa.shows.length, 1); assert.equal(pa.shows[0].showId, 's1');
  assert.equal((await call(e, '/api/profile', { key: B })).body.shows[0].showId, 's2');
  for (const path of ['/admin/status', '/admin/users', '/admin/invite', '/admin/enable']) { const r = await call(e, path, { key: A, body: { email: 'x@x.com' } }); assert.ok([401, 403].includes(r.status), path + ' ' + r.status); }
  await call(e, '/auth/logout', { key: A }); assert.equal((await call(e, '/api/profile', { key: B })).status, 200);   // خروج A لا يمس جلسة B
  assert.equal((await call(e, '/api/profile', { key: A })).status, 401);
  // التنبيه يصل لصاحب الاشتراك فقط
  await adm(e, '/admin/enable', { on: true }); const n = UM.length; LATEST = [ep('s1', 2), ...LATEST]; await runCron(e, 3000);
  const sent = UM.slice(n); assert.equal(sent.length, 1); assert.equal(sent[0].recipient, '+971500000061');         // اشتراك A باقٍ بعد خروجه، وB (مسلسل آخر) لا يستلم شيئًا
  assert.ok(!sent[0].text.includes('+9715000000'), 'no phone numbers inside messages');
});

// ===== مزامنة جهازين لنفس الحساب، وبقاء بيانات الحسابين منفصلة =====
test('two devices of one account converge (favorites, progress, removals) while another account stays untouched', async () => {
  const e = env(); const d1 = (await login(e, { sub: 'A', email: 'a@example.com' })).body.session, d2 = (await login(e, { sub: 'A', email: 'a@example.com' })).body.session;
  const other = (await login(e, { sub: 'B', email: 'b@example.com' })).body.session;
  const prog = (t, u) => ({ items: [{ key: 'sx|e1', showId: 'sx', epId: 'e1', epNum: 1, time: t, duration: 1000, updated: u }] });
  await call(e, '/api/fav', { key: d1, body: { showId: 'sx', on: true, at: 10 } }); await call(e, '/api/progress', { key: d1, body: prog(300, 100) });
  let s2 = (await call(e, '/api/sync', { key: d2 })).body; assert.equal(s2.favs[0].on, true); assert.equal(s2.progress[0].time, 300);       // الجهاز الثاني يستلم
  await call(e, '/api/progress', { key: d2, body: prog(450, 200) }); await call(e, '/api/progress', { key: d1, body: prog(320, 150) });       // كتابة أقدم متأخرة من الجهاز الأول
  await call(e, '/api/fav', { key: d2, body: { showId: 'sx', on: false, at: 20 } });
  const s1 = (await call(e, '/api/sync', { key: d1 })).body; assert.equal(s1.progress[0].time, 450); assert.equal(s1.favs[0].on, false);        // الإزالة والدقيقة الأحدث تصل
  const sb = (await call(e, '/api/sync', { key: other })).body; assert.equal(sb.favs.length + sb.progress.length, 0);
});

// ===== الحلقات القديمة المُعاد فهرستها لا تُنبَّه =====
test('re-indexing old episodes (new timestamps, reordered, dropped and returning) never triggers alerts', async () => {
  const e = env(); UM = []; UM_STATUS = 201; LATEST = [ep('s1', 5), ep('s1', 4), ep('s2', 9)];
  const A = (await login(e)).body.session; await runCron(e, 1000); await ready(e, A, '+971500000071', ['s1', 's2']); await adm(e, '/admin/enable', { on: true });
  const n = UM.length;
  LATEST = [ep('s2', 9), ep('s1', 4), ep('s1', 5)].map((x, i) => ({ ...x, ts: 9999 + i })); await runCron(e, 2000);       // أُعيد ترتيبها بطوابع جديدة
  LATEST = [ep('s1', 5)]; await runCron(e, 3000); LATEST = [ep('s1', 4), ep('s1', 5), ep('s2', 9)]; await runCron(e, 4000);   // سقطت ثم عادت
  assert.equal(UM.length, n);
  LATEST = [ep('s1', 6), ...LATEST]; await runCron(e, 5000); assert.equal(UM.length, n + 1);                              // الحلقة الجديدة فعلًا فقط
});
