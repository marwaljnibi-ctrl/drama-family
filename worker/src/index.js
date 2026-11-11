// Cloudflare Worker (مجاني): تنبيهات واتساب لحلقات Dizi الجديدة.
// - الكشف: آخر قائمة latest من data/shows.json (نظام الاكتشاف الموجود). لا فهرسة ثانية. الحلقات القديمة لا تُنبَّه أبدًا (نقطة بداية = seen).
// - التخزين: D1 (متسق فورًا؛ KV غير مناسب لأن قراءاته قد تتأخر دقيقة فلا يُوقف الإلغاء الرسائل فورًا).
// - الأعضاء مفاتيحهم SHA-256 لرابطهم الخاص (الرابط نفسه لا يُخزَّن). الإرسال: UnlimitedMessaging REST. الأسرار في Cloudflare Secrets. الإرسال معطّل افتراضيًا.
import { E164, sha, newToken, parseLatestTail, epNum, detectNew, messageText, watchLink, validShowId } from './logic.js';

const UM = 'https://api.unlimitedmessaging.app/message';
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const cors = (env, req) => {
  const o = req.headers.get('origin') || ''; const ok = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).includes(o);
  return ok ? { 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,GET,OPTIONS', vary: 'origin' } : {};
};
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
const timingEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const sql = (env, s, ...a) => env.DB.prepare(s).bind(...a);

const getMeta = async (env) => { const r = await sql(env, "SELECT v FROM meta WHERE k='meta'").first(); return r ? JSON.parse(r.v) : null; };
const putMeta = (env, m) => sql(env, "INSERT INTO meta (k, v) VALUES ('meta', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", JSON.stringify(m)).run();

async function sendWA(env, phone, text) {
  try {
    const r = await fetch(UM, { method: 'POST', headers: { authorization: 'Bearer ' + env.UM_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ recipient: phone, text }) });
    return { ok: r.status === 201 || r.status === 200, status: r.status };
  } catch { return { ok: false, status: 0 }; }
}

// نقرأ shows.json كله بالتدفق ونحتفظ بآخر 40 ك.ب فقط (فيها latest). طلب Range لا يصلح: Cloudflare يضغط الملف فيُطبَّق Range على النسخة المضغوطة.
async function fetchLatest(env) {
  const r = await fetch(env.DATA_URL, { cf: { cacheTtl: 0 } });
  if (!r.ok || !r.body) return null;
  const KEEP = 40000, parts = []; let total = 0; const rd = r.body.getReader();
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    parts.push(value); total += value.length;
    while (parts.length > 1 && total - parts[0].length >= KEEP) total -= parts.shift().length;
  }
  const buf = new Uint8Array(total); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return parseLatestTail(new TextDecoder().decode(buf));
}

// ===== الجدولة: اكتشاف ثم إرسال =====
export async function runCron(env, now = Date.now()) {
  const latest = await fetchLatest(env);
  if (!latest || !latest.length) return { skipped: 'no latest' };
  let meta = await getMeta(env);
  if (!meta) { meta = { startedAt: now, enabled: false, seen: latest.map((x) => x.epId) }; await putMeta(env, meta); return { baseline: meta.seen.length }; }   // أول تشغيل: نقطة البداية، بلا أي رسالة
  const { fresh, seen } = detectNew(latest, meta.seen);
  if (fresh.length) {
    meta.seen = seen; await putMeta(env, meta);
    if (meta.enabled) for (const ep of fresh) {
      // الإدراج في الطابور فقط لمن وافق صراحة واشترك بهذا المسلسل ولم تُرسل له هذه الحلقة من قبل
      await sql(env, `INSERT INTO outbox (h, ep_id, show_id, created) SELECT m.h, ?1, ?2, ?3 FROM members m JOIN subs s ON s.h = m.h
        WHERE s.show_id = ?2 AND m.consent_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sent x WHERE x.h = m.h AND x.ep_id = ?1) ON CONFLICT DO NOTHING`, ep.epId, ep.showId, now).run();
    }
  }
  await sql(env, 'DELETE FROM outbox WHERE created < ?', now - 6 * 3600 * 1000).run();
  return { fresh: fresh.length, sent: await processOutbox(env, now) };
}

const WANTED = `FROM outbox o JOIN members m ON m.h = o.h JOIN subs s ON s.h = o.h AND s.show_id = o.show_id WHERE m.consent_at IS NOT NULL`;
async function processOutbox(env, now) {
  const meta = await getMeta(env); let sent = 0;
  if (!meta || !meta.enabled) return 0;
  await sql(env, `DELETE FROM outbox WHERE NOT EXISTS (SELECT 1 FROM members m JOIN subs s ON s.h = m.h WHERE m.h = outbox.h AND s.show_id = outbox.show_id AND m.consent_at IS NOT NULL)`).run();   // أُلغي الاشتراك/الموافقة: تُحذف المعلّقة
  const rows = (await sql(env, `SELECT o.h, o.ep_id, o.show_id, o.tries, m.phone, s.title ${WANTED} ORDER BY o.created LIMIT 10`).all()).results;
  for (const o of rows) {
    // إعادة تحقق فورية قبل الإرسال (الإلغاء يوقف الرسالة)، ثم «حجز» الإرسال: الأولوية لمنع التكرار
    const still = await sql(env, `SELECT 1 AS x ${WANTED} AND o.h = ? AND o.ep_id = ?`, o.h, o.ep_id).first();
    if (!still) continue;
    const claim = await sql(env, 'INSERT INTO sent (h, ep_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', o.h, o.ep_id, now).run();
    if (!claim.meta.changes) { await sql(env, 'DELETE FROM outbox WHERE h = ? AND ep_id = ?', o.h, o.ep_id).run(); continue; }
    const res = await sendWA(env, o.phone, messageText({ title: o.title, n: epNum(o.ep_id), link: watchLink(env.DIZI_URL, o.show_id, o.ep_id) }));
    if (res.ok) { await sql(env, 'DELETE FROM outbox WHERE h = ? AND ep_id = ?', o.h, o.ep_id).run(); sent++; }
    else {   // فشل الإرسال: نفكّ الحجز ونعيد المحاولة حتى 3 مرات
      await sql(env, 'DELETE FROM sent WHERE h = ? AND ep_id = ?', o.h, o.ep_id).run();
      if (o.tries + 1 >= 3) await sql(env, 'DELETE FROM outbox WHERE h = ? AND ep_id = ?', o.h, o.ep_id).run();
      else await sql(env, 'UPDATE outbox SET tries = tries + 1 WHERE h = ? AND ep_id = ?', o.h, o.ep_id).run();
    }
  }
  if (Math.random() < 0.02) await sql(env, 'DELETE FROM sent WHERE at < ?', now - 90 * 86400000).run();
  return sent;
}

const memberView = async (env, h) => {
  const m = await sql(env, 'SELECT name, consent_at FROM members WHERE h = ?', h).first(); if (!m) return null;
  const shows = (await sql(env, 'SELECT show_id, title FROM subs WHERE h = ? ORDER BY since', h).all()).results.map((s) => ({ showId: s.show_id, title: s.title }));
  return { name: m.name, consent: m.consent_at != null, shows };
};
const link = (env, token) => (env.SETTINGS_URL || '').replace(/\/?$/, '/') + '#/alerts/' + token;

// ===== HTTP =====
async function handle(req, env) {
  const url = new URL(req.url); const C = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: C });
  const out = (o, s = 200) => json(o, s, C);
  const p = url.pathname;
  if (p === '/api/health') return out({ ok: true });
  let body = {}; if (req.method === 'POST') { try { body = await req.json(); } catch {} }

  if (p.startsWith('/admin/')) {
    if (!env.ADMIN_KEY || !timingEq(bearer(req), env.ADMIN_KEY)) return out({ error: 'unauthorized' }, 401);
    if (p === '/admin/status') {
      const meta = await getMeta(env); const c = async (t) => (await sql(env, `SELECT COUNT(*) AS n FROM ${t}`).first()).n;
      return out({ startedAt: meta && meta.startedAt, enabled: !!(meta && meta.enabled), seen: meta ? meta.seen.length : 0, members: await c('members'), subs: await c('subs'), outbox: await c('outbox'), sent: await c('sent'), hasUmKey: !!env.UM_API_KEY });
    }
    if (p === '/admin/enable') {
      const meta = (await getMeta(env)) || { startedAt: Date.now(), enabled: false, seen: [] }; meta.enabled = body.on === true; await putMeta(env, meta);
      if (!meta.enabled) await sql(env, 'DELETE FROM outbox').run();   // الإيقاف يمسح الطابور
      return out({ enabled: meta.enabled });
    }
    if (p === '/admin/member') {
      if (!body.name || !E164.test(body.phone || '')) return out({ error: 'name and E.164 phone required' }, 400);
      const token = newToken();
      try { await sql(env, 'INSERT INTO members (h, name, phone, consent_at, created) VALUES (?, ?, ?, NULL, ?)', await sha(token), String(body.name).slice(0, 60), body.phone, Date.now()).run(); }
      catch { return out({ error: 'phone already registered (use /admin/rotate)' }, 409); }
      return out({ link: link(env, token) });   // الرابط الخاص يظهر مرة واحدة فقط
    }
    if (p === '/admin/rotate') {
      const m = await sql(env, 'SELECT h FROM members WHERE phone = ?', body.phone || '').first(); if (!m) return out({ error: 'not found' }, 404);
      const token = newToken(), nh = await sha(token);
      await env.DB.batch([sql(env, 'UPDATE members SET h = ? WHERE h = ?', nh, m.h), sql(env, 'UPDATE subs SET h = ? WHERE h = ?', nh, m.h), sql(env, 'DELETE FROM outbox WHERE h = ?', m.h), sql(env, 'UPDATE sent SET h = ? WHERE h = ?', nh, m.h)]);
      return out({ link: link(env, token) });
    }
    if (p === '/admin/remove') {
      const m = await sql(env, 'SELECT h FROM members WHERE phone = ?', body.phone || '').first(); if (!m) return out({ error: 'not found' }, 404);
      await env.DB.batch(['members', 'subs', 'outbox', 'sent'].map((t) => sql(env, `DELETE FROM ${t} WHERE h = ?`, m.h)));
      return out({ removed: true });
    }
    if (p === '/admin/test') {   // رسالة واحدة إلى رقم معتمد صراحةً (رقم المالك)
      if (!E164.test(body.phone || '')) return out({ error: 'E.164 phone required' }, 400);
      const r = await sendWA(env, body.phone, '✅ رسالة تجريبية من Dizi: تنبيهات الحلقات الجديدة جاهزة.');
      return out({ sent: r.ok, status: r.status }, r.ok ? 200 : 502);
    }
    if (p === '/admin/cron') return out(await runCron(env));
    return out({ error: 'not found' }, 404);
  }

  if (p.startsWith('/api/')) {   // واجهة العضو: كل عملية على بياناته هو فقط (المفتاح = SHA-256 لرابطه الخاص)
    const tok = bearer(req); if (!/^[0-9a-f]{32}$/.test(tok)) return out({ error: 'unauthorized' }, 401);
    const h = await sha(tok); const me = await memberView(env, h); if (!me) return out({ error: 'unauthorized' }, 401);
    if (p === '/api/me') return out(me);
    if (p === '/api/consent') {
      if (body.agree === true) await sql(env, 'UPDATE members SET consent_at = ? WHERE h = ?', Date.now(), h).run();
      else await env.DB.batch([sql(env, 'UPDATE members SET consent_at = NULL WHERE h = ?', h), sql(env, 'DELETE FROM outbox WHERE h = ?', h)]);
      return out(await memberView(env, h));
    }
    if (p === '/api/shows') {
      if (!validShowId(body.showId)) return out({ error: 'bad showId' }, 400);
      if (body.on === true) {
        if (!me.consent) return out({ error: 'consent required' }, 403);
        if (me.shows.length >= 100) return out({ error: 'too many shows' }, 400);
        await sql(env, 'INSERT INTO subs (h, show_id, title, since) VALUES (?, ?, ?, ?) ON CONFLICT(h, show_id) DO UPDATE SET title = excluded.title', h, body.showId, String(body.title || body.showId).slice(0, 120), Date.now()).run();
      } else {   // الإلغاء يوقف الرسائل المعلقة فورًا (ذريًا مع حذف الاشتراك)
        await env.DB.batch([sql(env, 'DELETE FROM subs WHERE h = ? AND show_id = ?', h, body.showId), sql(env, 'DELETE FROM outbox WHERE h = ? AND show_id = ?', h, body.showId)]);
      }
      return out(await memberView(env, h));
    }
    return out({ error: 'not found' }, 404);
  }
  return out({ error: 'not found' }, 404);
}

export default {
  fetch: (req, env) => handle(req, env),
  scheduled: (ev, env, ctx) => ctx.waitUntil(runCron(env)),
};
