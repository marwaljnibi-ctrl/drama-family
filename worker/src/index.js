// Cloudflare Worker (مجاني): تنبيهات واتساب لحلقات Dizi الجديدة.
// - الكشف: آخر قائمة latest من data/shows.json (نظام الاكتشاف الموجود). لا فهرسة ثانية. الحلقات القديمة لا تُنبَّه أبدًا (نقطة بداية = seen).
// - التخزين: KV. الأعضاء مفاتيحهم SHA-256 للرابط الخاص (الرابط نفسه لا يُخزَّن).
// - الإرسال: UnlimitedMessaging REST (Bearer). الأسرار في Cloudflare Secrets: UM_API_KEY, ADMIN_KEY. الإرسال معطّل افتراضيًا (meta.enabled=false).
import { E164, sha, newToken, parseLatestTail, epNum, detectNew, shouldEnqueue, stillWanted, messageText, watchLink, validShowId } from './logic.js';

const UM = 'https://api.unlimitedmessaging.app/message';
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const cors = (env, req) => {
  const o = req.headers.get('origin') || ''; const ok = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).includes(o);
  return ok ? { 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,GET,OPTIONS', vary: 'origin' } : {};
};
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
const timingEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

const getMeta = async (env) => (await env.KV.get('meta', 'json')) || null;
const putMeta = (env, m) => env.KV.put('meta', JSON.stringify(m));
const getMember = async (env, h) => (await env.KV.get('m:' + h, 'json')) || null;
const putMember = (env, h, m) => env.KV.put('m:' + h, JSON.stringify(m));

async function sendWA(env, phone, text) {
  try {
    const r = await fetch(UM, { method: 'POST', headers: { authorization: 'Bearer ' + env.UM_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ recipient: phone, text }) });
    return { ok: r.status === 201 || r.status === 200, status: r.status };
  } catch (e) { return { ok: false, status: 0 }; }
}

// حذف طابور عضو (كله أو مسلسل بعينه) فورًا
async function clearOutbox(env, h, showId) {
  const l = await env.KV.list({ prefix: 'out:' + h + ':' });
  for (const k of l.keys) { if (!showId) { await env.KV.delete(k.name); continue; } const v = await env.KV.get(k.name, 'json'); if (v && v.showId === showId) await env.KV.delete(k.name); }
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
    if (meta.enabled) {
      const members = await env.KV.list({ prefix: 'm:' });
      for (const k of members.keys) {
        const h = k.name.slice(2); const m = await getMember(env, h);
        for (const ep of fresh) {
          if (!shouldEnqueue({ member: m, ep, enabled: meta.enabled })) continue;
          if (await env.KV.get('sent:' + h + ':' + ep.epId)) continue;   // لا تكرار لنفس الحلقة لنفس الشخص
          await env.KV.put('out:' + h + ':' + ep.epId, JSON.stringify({ showId: ep.showId, epId: ep.epId, created: now, tries: 0 }), { expirationTtl: 6 * 3600 });
        }
      }
    }
  }
  return { fresh: fresh.length, sent: await processOutbox(env, now) };
}

async function processOutbox(env, now) {
  const meta = await getMeta(env); let sent = 0;
  if (!meta || !meta.enabled) return 0;
  const l = await env.KV.list({ prefix: 'out:', limit: 10 });
  for (const k of l.keys) {
    const [, h, epId] = k.name.split(':'); const o = await env.KV.get(k.name, 'json');
    if (!o) continue;
    const m = await getMember(env, h);
    if (!stillWanted({ member: m, ep: { showId: o.showId }, enabled: meta.enabled })) { await env.KV.delete(k.name); continue; }   // أُلغي الاشتراك أو سُحبت الموافقة: تُحذف الرسالة المعلقة
    if (now - o.created > 6 * 3600 * 1000) { await env.KV.delete(k.name); continue; }
    const sentKey = 'sent:' + h + ':' + epId;
    if (await env.KV.get(sentKey)) { await env.KV.delete(k.name); continue; }
    await env.KV.put(sentKey, String(now), { expirationTtl: 90 * 86400 });   // نعلّم قبل الإرسال: الأولوية لمنع التكرار
    const sub = m.shows[o.showId];
    const res = await sendWA(env, m.phone, messageText({ title: sub.title, n: epNum(epId), link: watchLink(env.DIZI_URL, o.showId, epId) }));
    if (res.ok) { await env.KV.delete(k.name); sent++; }
    else { await env.KV.delete(sentKey); o.tries = (o.tries || 0) + 1; if (o.tries >= 3) await env.KV.delete(k.name); else await env.KV.put(k.name, JSON.stringify(o), { expirationTtl: 6 * 3600 }); }
  }
  return sent;
}

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
    if (p === '/admin/status') { const meta = await getMeta(env); const ms = await env.KV.list({ prefix: 'm:' }); const ob = await env.KV.list({ prefix: 'out:' }); return out({ startedAt: meta && meta.startedAt, enabled: !!(meta && meta.enabled), seen: meta ? meta.seen.length : 0, members: ms.keys.length, outbox: ob.keys.length, hasUmKey: !!env.UM_API_KEY }); }
    if (p === '/admin/enable') { const meta = (await getMeta(env)) || { startedAt: Date.now(), enabled: false, seen: [] }; meta.enabled = body.on === true; await putMeta(env, meta); if (!meta.enabled) { const ob = await env.KV.list({ prefix: 'out:' }); for (const k of ob.keys) await env.KV.delete(k.name); } return out({ enabled: meta.enabled }); }
    if (p === '/admin/member') {
      if (!body.name || !E164.test(body.phone || '')) return out({ error: 'name and E.164 phone required' }, 400);
      const ms = await env.KV.list({ prefix: 'm:' });
      for (const k of ms.keys) { const m = await env.KV.get(k.name, 'json'); if (m && m.phone === body.phone) return out({ error: 'phone already registered (use /admin/rotate)' }, 409); }
      const token = newToken(); await putMember(env, await sha(token), { name: String(body.name).slice(0, 60), phone: body.phone, consent: null, shows: {}, created: Date.now() });
      return out({ link: (env.SETTINGS_URL || '').replace(/\/?$/, '/') + '#/alerts/' + token });   // الرابط الخاص يظهر مرة واحدة فقط
    }
    if (p === '/admin/rotate') {
      const ms = await env.KV.list({ prefix: 'm:' });
      for (const k of ms.keys) { const m = await env.KV.get(k.name, 'json'); if (m && m.phone === body.phone) { const token = newToken(); await env.KV.delete(k.name); await putMember(env, await sha(token), m); await clearOutbox(env, k.name.slice(2)); return out({ link: (env.SETTINGS_URL || '').replace(/\/?$/, '/') + '#/alerts/' + token }); } }
      return out({ error: 'not found' }, 404);
    }
    if (p === '/admin/remove') {
      const ms = await env.KV.list({ prefix: 'm:' });
      for (const k of ms.keys) { const m = await env.KV.get(k.name, 'json'); if (m && m.phone === body.phone) { await clearOutbox(env, k.name.slice(2)); await env.KV.delete(k.name); return out({ removed: true }); } }
      return out({ error: 'not found' }, 404);
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
    const h = await sha(tok); const m = await getMember(env, h); if (!m) return out({ error: 'unauthorized' }, 401);
    const view = () => ({ name: m.name, consent: !!(m.consent && m.consent.at), shows: Object.entries(m.shows).filter(([, v]) => v.on).map(([id, v]) => ({ showId: id, title: v.title })) });
    if (p === '/api/me') return out(view());
    if (p === '/api/consent') {
      m.consent = body.agree === true ? { at: Date.now() } : null; await putMember(env, h, m);
      if (!m.consent) await clearOutbox(env, h);
      return out(view());
    }
    if (p === '/api/shows') {
      if (!validShowId(body.showId)) return out({ error: 'bad showId' }, 400);
      if (body.on === true) {
        if (!m.consent) return out({ error: 'consent required' }, 403);
        if (Object.keys(m.shows).filter((k) => m.shows[k].on).length >= 100) return out({ error: 'too many shows' }, 400);
        m.shows[body.showId] = { on: true, title: String(body.title || body.showId).slice(0, 120), since: Date.now() };
      } else { delete m.shows[body.showId]; }
      await putMember(env, h, m);
      if (body.on !== true) await clearOutbox(env, h, body.showId);   // الإلغاء يوقف الرسائل المعلقة فورًا
      return out(view());
    }
    return out({ error: 'not found' }, 404);
  }
  return out({ error: 'not found' }, 404);
}

export default {
  fetch: (req, env) => handle(req, env),
  scheduled: (ev, env, ctx) => ctx.waitUntil(runCron(env)),
};
