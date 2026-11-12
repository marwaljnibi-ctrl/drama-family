// مصادقة Google: نتحقق من «ID token» الصادر من Google (توقيع RS256 بمفاتيح Google العامة + iss + aud + exp + email_verified).
// لا نبني نظام مصادقة: Google تثبت الهوية، ونحن نصدر جلسة عشوائية فقط (نخزّن SHA-256 لها).
import { sha } from './logic.js';

let KEYS = { at: 0, keys: null };
export async function googleKeys(fetchFn = fetch) {
  if (KEYS.keys && Date.now() - KEYS.at < 3600000) return KEYS.keys;
  const r = await fetchFn('https://www.googleapis.com/oauth2/v3/certs'); const j = await r.json();
  KEYS = { at: Date.now(), keys: j.keys || [] }; return KEYS.keys;
}
export const resetGoogleKeys = () => { KEYS = { at: 0, keys: null }; };
const b64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0)); };
const dec = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

// يعيد { sub, email, name } أو null. clientId = تطبيق Dizi في Google Cloud.
export async function verifyGoogle(idToken, clientId, now = Date.now(), getKeys = googleKeys) {
  try {
    if (!clientId || typeof idToken !== 'string') return null;
    const [h, p, s] = idToken.split('.'); if (!h || !p || !s) return null;
    const header = dec(h), pl = dec(p);
    if (header.alg !== 'RS256') return null;
    const jwk = (await getKeys()).find((k) => k.kid === header.kid); if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(h + '.' + p));
    if (!ok) return null;
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(pl.iss)) return null;
    if (pl.aud !== clientId) return null;
    if (!(pl.exp * 1000 > now)) return null;
    if (pl.email_verified !== true || !pl.sub || !pl.email) return null;
    return { sub: String(pl.sub), email: String(pl.email).toLowerCase(), name: String(pl.name || pl.email).slice(0, 80) };
  } catch { return null; }
}

export const SESSION_MS = 90 * 86400000;
export const newSession = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); };
export const isSessionToken = (t) => /^[0-9a-f]{64}$/.test(t || '');
// يعيد uid أو null؛ ويجدد الجلسة (انزلاقية) إن مضى أكثر من يوم على آخر تجديد
export async function sessionUser(env, token, now = Date.now()) {
  if (!isSessionToken(token)) return null;
  const h = await sha(token);
  const s = await env.DB.prepare('SELECT uid, created, expires FROM sessions WHERE h = ?').bind(h).first();
  if (!s || s.expires < now) { if (s) await env.DB.prepare('DELETE FROM sessions WHERE h = ?').bind(h).run(); return null; }
  const u = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(s.uid).first(); if (!u) return null;   // حُذف الحساب
  if (now - s.created > 86400000) await env.DB.prepare('UPDATE sessions SET created = ?, expires = ? WHERE h = ?').bind(now, now + SESSION_MS, h).run();
  return s.uid;
}
