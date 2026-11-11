// الحسابات العائلية: دخول Google (للمدعوين فقط)، جلسة دائمة، مفضلة وتقدم لكل مستخدم، وتنبيهات واتساب مرتبطة بالحساب.
// هذا الملف يضيف المسارات فقط؛ منطق الكشف والإرسال في index.js يبقى كما هو (يقرأ members وsubs وoutbox).
import { E164, sha, validShowId } from './logic.js';
import { verifyGoogle, newSession, sessionUser, isSessionToken, SESSION_MS } from './auth.js';

const sql = (env, s, ...a) => env.DB.prepare(s).bind(...a);
const mid = (uid) => 'u:' + uid;
const mask = (p) => (p ? p.slice(0, 4) + '•'.repeat(Math.max(0, p.length - 7)) + p.slice(-3) : null);
const OTP_TTL = 10 * 60000, OTP_MAX_SENDS = 3, OTP_WINDOW = 3600000, OTP_MAX_TRIES = 5;

export async function profile(env, uid) {
  const u = await sql(env, 'SELECT name, email, wa_prompt, phone, phone_verified_at FROM users WHERE id = ?', uid).first(); if (!u) return null;
  const m = await sql(env, 'SELECT consent_at FROM members WHERE h = ?', mid(uid)).first();
  const shows = (await sql(env, 'SELECT show_id, title FROM subs WHERE h = ? ORDER BY since', mid(uid)).all()).results.map((s) => ({ showId: s.show_id, title: s.title }));
  return { name: u.name, email: u.email, wa: { prompt: u.wa_prompt, phone: mask(u.phone), verified: u.phone_verified_at != null, consent: !!(m && m.consent_at != null) }, shows };
}

const otpCode = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, '0'); };

// يعيد Response أو null (ليست مسارًا للحسابات). deps: { sendWA, now }
export async function handleAccounts({ env, req, p, body, out, sendWA, now = Date.now(), getKeys }) {
  if (p === '/auth/google') {
    const g = await verifyGoogle(body.credential, env.GOOGLE_CLIENT_ID, now, getKeys);
    if (!g) return out({ error: 'invalid_token' }, 401);
    const inv = await sql(env, 'SELECT 1 AS x FROM invites WHERE email = ?', g.email).first();
    if (!inv) return out({ error: 'not_invited' }, 403);                 // فقط المدعوون يُنشئون حسابات
    const uid = 'g_' + g.sub;
    await sql(env, 'INSERT INTO users (id, email, name, created) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email', uid, g.email, g.name, now).run();
    const token = newSession(); await sql(env, 'INSERT INTO sessions (h, uid, created, expires) VALUES (?, ?, ?, ?)', await sha(token), uid, now, now + SESSION_MS).run();
    return out({ session: token, uid, profile: await profile(env, uid) });
  }
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!isSessionToken(tok)) return null;                                   // غير جلسة: يتابع المسار القديم (روابط خاصة)
  if (!p.startsWith('/api/') && p !== '/auth/logout') return null;
  const uid = await sessionUser(env, tok, now); if (!uid) return out({ error: 'unauthorized' }, 401);
  const h = mid(uid);

  if (p === '/auth/logout') { await sql(env, 'DELETE FROM sessions WHERE h = ?', await sha(tok)).run(); return out({ ok: true }); }
  if (p === '/api/profile' || p === '/api/me') return out(await profile(env, uid));

  // ----- واتساب -----
  if (p === '/api/wa/prompt') {
    if (!['yes', 'no'].includes(body.answer)) return out({ error: 'bad answer' }, 400);
    await sql(env, 'UPDATE users SET wa_prompt = ? WHERE id = ?', body.answer, uid).run(); return out(await profile(env, uid));
  }
  if (p === '/api/wa/phone') {   // يرسل رمز تحقق إلى الرقم عبر واتساب؛ الموافقة الصريحة شرط (agree:true)
    if (body.agree !== true) return out({ error: 'consent required' }, 400);
    if (!E164.test(body.phone || '')) return out({ error: 'bad phone' }, 400);
    const taken = await sql(env, 'SELECT 1 AS x FROM users WHERE phone = ? AND id != ? AND phone_verified_at IS NOT NULL', body.phone, uid).first();
    if (taken) return out({ error: 'phone in use' }, 409);
    const old = await sql(env, 'SELECT sends, window_start FROM otp WHERE uid = ?', uid).first();
    let sends = 1, ws = now;
    if (old && now - old.window_start < OTP_WINDOW) { if (old.sends >= OTP_MAX_SENDS) return out({ error: 'too many requests' }, 429); sends = old.sends + 1; ws = old.window_start; }
    const code = otpCode();
    await sql(env, 'INSERT INTO otp (uid, phone, code_h, expires, attempts, sends, window_start) VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT(uid) DO UPDATE SET phone=excluded.phone, code_h=excluded.code_h, expires=excluded.expires, attempts=0, sends=excluded.sends, window_start=excluded.window_start',
      uid, body.phone, await sha(uid + ':' + body.phone + ':' + code), now + OTP_TTL, sends, ws).run();
    const r = await sendWA(env, body.phone, 'رمز التحقق من Dizi: ' + code + '\nصالح 10 دقائق. إن لم تطلبه تجاهل هذه الرسالة.');
    if (!r.ok) return out({ error: 'send failed' }, 502);
    return out({ sent: true });
  }
  if (p === '/api/wa/verify') {
    const o = await sql(env, 'SELECT phone, code_h, expires, attempts FROM otp WHERE uid = ?', uid).first();
    if (!o || o.expires < now) return out({ error: 'expired' }, 400);
    if (o.attempts >= OTP_MAX_TRIES) return out({ error: 'too many attempts' }, 429);
    const good = (await sha(uid + ':' + o.phone + ':' + String(body.code || '').trim())) === o.code_h;
    if (!good) { await sql(env, 'UPDATE otp SET attempts = attempts + 1 WHERE uid = ?', uid).run(); return out({ error: 'wrong code' }, 400); }
    const u = await sql(env, 'SELECT name FROM users WHERE id = ?', uid).first();
    try {
      await env.DB.batch([
        sql(env, 'UPDATE users SET phone = ?, phone_verified_at = ?, wa_prompt = ? WHERE id = ?', o.phone, now, 'yes', uid),
        sql(env, 'INSERT INTO members (h, name, phone, consent_at, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(h) DO UPDATE SET phone = excluded.phone, consent_at = excluded.consent_at', h, u.name, o.phone, now, now),
        sql(env, 'DELETE FROM otp WHERE uid = ?', uid),
      ]);
    } catch { return out({ error: 'phone in use' }, 409); }
    return out(await profile(env, uid));
  }
  if (p === '/api/wa/stop') {   // إيقاف جميع تنبيهات واتساب فورًا (تبقى الاشتراكات محفوظة لكن متوقفة)
    await env.DB.batch([sql(env, 'UPDATE members SET consent_at = NULL WHERE h = ?', h), sql(env, 'DELETE FROM outbox WHERE h = ?', h)]);
    return out(await profile(env, uid));
  }
  if (p === '/api/wa/resume') {   // إعادة التشغيل لرقم سبق التحقق منه
    const u = await sql(env, 'SELECT phone_verified_at FROM users WHERE id = ?', uid).first();
    if (!u || u.phone_verified_at == null) return out({ error: 'verify phone first' }, 400);
    await sql(env, 'UPDATE members SET consent_at = ? WHERE h = ?', now, h).run(); return out(await profile(env, uid));
  }
  if (p === '/api/shows') {
    if (!validShowId(body.showId)) return out({ error: 'bad showId' }, 400);
    if (body.on === true) {
      const m = await sql(env, 'SELECT consent_at FROM members WHERE h = ?', h).first();
      if (!m || m.consent_at == null) return out({ error: 'wa_not_ready' }, 403);
      const c = await sql(env, 'SELECT COUNT(*) AS n FROM subs WHERE h = ?', h).first(); if (c.n >= 100) return out({ error: 'too many shows' }, 400);
      await sql(env, 'INSERT INTO subs (h, show_id, title, since) VALUES (?, ?, ?, ?) ON CONFLICT(h, show_id) DO UPDATE SET title = excluded.title', h, body.showId, String(body.title || body.showId).slice(0, 120), now).run();
    } else await env.DB.batch([sql(env, 'DELETE FROM subs WHERE h = ? AND show_id = ?', h, body.showId), sql(env, 'DELETE FROM outbox WHERE h = ? AND show_id = ?', h, body.showId)]);
    return out(await profile(env, uid));
  }

  // ----- مزامنة المفضلة والتقدم (لكل مستخدم على حدة؛ آخر كتابة أحدث تفوز) -----
  if (p === '/api/sync') {
    const f = (await sql(env, 'SELECT show_id, on_flag, at FROM favs WHERE uid = ?', uid).all()).results.map((r) => ({ showId: r.show_id, on: !!r.on_flag, at: r.at }));
    const g = (await sql(env, 'SELECT key, show_id, ep_id, ep_num, time, duration, done, hidden, updated FROM prog WHERE uid = ?', uid).all()).results.map((r) => ({ key: r.key, showId: r.show_id, epId: r.ep_id, epNum: r.ep_num, time: r.time, duration: r.duration, done: !!r.done, hidden: !!r.hidden, updated: r.updated }));
    return out({ favs: f, progress: g });
  }
  if (p === '/api/fav') {
    if (!validShowId(body.showId) || !Number.isFinite(body.at)) return out({ error: 'bad request' }, 400);
    await sql(env, 'INSERT INTO favs (uid, show_id, on_flag, at) VALUES (?, ?, ?, ?) ON CONFLICT(uid, show_id) DO UPDATE SET on_flag = excluded.on_flag, at = excluded.at WHERE excluded.at >= favs.at', uid, body.showId, body.on ? 1 : 0, body.at).run();
    return out({ ok: true });
  }
  if (p === '/api/progress') {
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : []; let n = 0;
    const stmts = [];
    for (const x of items) {
      if (!x || typeof x.key !== 'string' || x.key.length > 300 || !validShowId(x.showId) || typeof x.epId !== 'string' || !Number.isFinite(x.updated)) continue;
      stmts.push(sql(env, 'INSERT INTO prog (uid, key, show_id, ep_id, ep_num, time, duration, done, hidden, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid, key) DO UPDATE SET ep_num=excluded.ep_num, time=excluded.time, duration=excluded.duration, done=excluded.done, hidden=excluded.hidden, updated=excluded.updated WHERE excluded.updated > prog.updated',
        uid, x.key, x.showId, x.epId.slice(0, 300), Number.isFinite(x.epNum) ? x.epNum : null, +x.time || 0, +x.duration || 0, x.done ? 1 : 0, x.hidden ? 1 : 0, x.updated)); n++;
    }
    if (stmts.length) await env.DB.batch(stmts);
    return out({ accepted: n });
  }
  return null;
}
