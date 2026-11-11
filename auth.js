// الدخول بحساب Google (للمدعوين فقط). نستعمل «Sign in with Google» الرسمي ولا نبني مصادقة: Google تثبت الهوية، والـWorker يتحقق من التوكن ويصدر جلسة.
// الجلسة تبقى في هذا الجهاز (90 يومًا انزلاقيًا) فلا يحتاج الشخص لتسجيل الدخول عند كل زيارة.
import { setDbName } from './db.js';

export const API = 'https://dizi-alerts.fufuu-crafts.workers.dev';
export const GOOGLE_CLIENT_ID = '1081945666502-7qk073lrqol1jibp6mt3drs2qhtri87j.apps.googleusercontent.com';   // يُملأ بعد إنشاء Client ID في Google Cloud (قيمة عامة وليست سرًا). فارغ = الدخول غير مفعّل بعد
export const AUTH_REQUIRED = () => !!GOOGLE_CLIENT_ID && !new URLSearchParams(location.search).has('demo');

const S = 'df-session', U = 'df-uid', MAP = 'df-dbmap', OWNER = 'df-legacy-owner';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
export const getSession = () => { const t = ls.get(S); return /^[0-9a-f]{64}$/.test(t || '') ? t : ''; };
export const getUid = () => ls.get(U) || '';
export const saveSession = (token, uid) => { ls.set(S, token); ls.set(U, uid); };
export const clearSession = () => { ls.del(S); ls.del(U); };

// قاعدة المستخدم المحلية: الحساب الأول على الجهاز يرث القاعدة القديمة (بياناته القديمة تُحفظ ولا تُحذف)، والباقي قواعد منفصلة (عزل)
export function prepareDb() {
  const uid = getUid(); if (!uid) return;
  let map = {}; try { map = JSON.parse(ls.get(MAP) || '{}'); } catch {}
  if (!map[uid]) {
    if (!ls.get(OWNER)) { ls.set(OWNER, uid); map[uid] = 'drama-family'; }
    else map[uid] = 'dizi-u-' + uid.replace(/[^\w]/g, '').slice(0, 24);
    ls.set(MAP, JSON.stringify(map));
  }
  setDbName(map[uid]);
}

export async function authApi(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { authorization: 'Bearer ' + getSession(), 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { clearSession(); if (!/demo/.test(location.search)) location.reload(); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'http ' + r.status), { status: r.status, body: j });
  return j;
}

let gsi;
const loadGsi = () => gsi || (gsi = new Promise((res, rej) => { if (window.google && google.accounts) return res(); const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = () => rej(new Error('gsi')); document.head.append(s); }));

// يعرض زر «المتابعة بحساب Google» داخل el. onDone(profile) عند النجاح، onError(code) عند الرفض (not_invited ...)
export async function renderLogin(el, { onDone, onError }) {
  await loadGsi();
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID, auto_select: true, cancel_on_tap_outside: false,
    callback: async (resp) => {
      try {
        const r = await fetch(API + '/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return onError(j.error || 'failed');
        saveSession(j.session, j.uid); onDone(j.profile);
      } catch { onError('network'); }
    },
  });
  google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'ar', width: 280 });
  try { google.accounts.id.prompt(); } catch {}
}
export async function logout() { try { await authApi('/auth/logout'); } catch {} clearSession(); location.reload(); }
