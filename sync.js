// مزامنة المفضلة وتقدم المشاهدة مع حساب المستخدم (الخادم مصدر الحقيقة بين الأجهزة، وIndexedDB نسخة محلية تعمل بلا إنترنت).
// القاعدة: آخر كتابة أحدث تفوز (at/updated). ما يُكتب محليًا يُدفع بعد ثوانٍ، وما لم يُدفع (انقطاع) يبقى في طابور محلي ويُعاد لاحقًا.
import { onWrite, raw, readOther } from './db.js';
import { authApi, getSession, getUid, lsGet, lsDel, OWNER_KEY } from './auth.js';

const QK = () => 'df-syncq:' + getUid();
const loadQ = () => { try { return JSON.parse(localStorage.getItem(QK()) || '{"f":{},"p":{}}'); } catch { return { f: {}, p: {} }; } };
const saveQ = (q) => { try { localStorage.setItem(QK(), JSON.stringify(q)); } catch {} };
let timer = 0, busy = false;

// دمج بيانات الخادم في المحلي (بلا إعادة دفع) وإرجاع ما هو أحدث محليًا لدفعه
// سجل «فارغ» = حلقة فُتحت ولم يُشاهَد منها شيء (time=0, duration=0): لا قيمة له ولا يجوز أن يطغى على تقدم حقيقي
export const isReal = (p) => !!(p && (p.time > 0 || p.duration > 0 || p.done || p.hidden));
export function planMerge(local, server) {
  const out = { putFav: [], delFav: [], putProg: [], pushFav: [], pushProg: [] };
  const lf = new Map(local.favs.map((f) => [f.showId, f])), sf = new Map(server.favs.map((f) => [f.showId, f]));
  for (const s of server.favs) {
    const l = lf.get(s.showId);
    if (s.on) { if (!l) out.putFav.push({ showId: s.showId, at: s.at }); else if (l.at > s.at) out.pushFav.push({ showId: s.showId, on: true, at: l.at }); }
    else if (l && l.at <= s.at) out.delFav.push(s.showId);
    else if (l && l.at > s.at) out.pushFav.push({ showId: s.showId, on: true, at: l.at });
  }
  for (const l of local.favs) if (!sf.has(l.showId)) out.pushFav.push({ showId: l.showId, on: true, at: l.at });
  const lp = new Map(local.progress.filter(isReal).map((p) => [p.key, p])), sp = new Map(server.progress.map((p) => [p.key, p]));
  for (const s of server.progress) {
    const l = lp.get(s.key);
    if (!l || s.updated > (l.updated || 0)) out.putProg.push({ key: s.key, showId: s.showId, epId: s.epId, epNum: s.epNum, time: s.time, duration: s.duration, done: s.done, hidden: s.hidden, updated: s.updated });
    else if ((l.updated || 0) > s.updated) out.pushProg.push(l);
  }
  for (const l of local.progress) if (isReal(l) && !sp.has(l.key)) out.pushProg.push(l);
  return out;
}
const progBody = (p) => ({ key: p.key, showId: p.showId, epId: p.epId, epNum: p.epNum, time: p.time, duration: p.duration, done: !!p.done, hidden: !!p.hidden, updated: p.updated || Date.now() });

export async function flush() {
  if (!getSession() || busy) return;
  busy = true;
  try {
    const q = loadQ();
    for (const [showId, v] of Object.entries(q.f)) { await authApi('/api/fav', { showId, on: v.on, at: v.at }); const c = loadQ(); if (c.f[showId] && c.f[showId].at === v.at) { delete c.f[showId]; saveQ(c); } }
    const keys = Object.keys(q.p);
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100); await authApi('/api/progress', { items: chunk.map((k) => progBody(q.p[k])) });
      const c = loadQ(); for (const k of chunk) if (c.p[k] && c.p[k].updated === q.p[k].updated) delete c.p[k]; saveQ(c);
    }
  } catch { /* بلا إنترنت: يبقى في الطابور */ } finally { busy = false; }
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, 4000); };

export async function pull() {
  if (!getSession()) return;
  const server = await authApi('/api/sync');
  const plan = planMerge({ favs: await raw.favs(), progress: await raw.progress() }, server);
  for (const f of plan.putFav) await raw.putFav(f);
  for (const id of plan.delFav) await raw.delFav(id);
  for (const p of plan.putProg) { const cur = await raw.getProgress(p.key); if (!cur || !isReal(cur) || p.updated > (cur.updated || 0)) await raw.putProgress(p); }   // لا نكتب فوق تقدم محلي حُفظ أثناء السحب
  const q = loadQ();
  for (const f of plan.pushFav) q.f[f.showId] = { on: f.on, at: f.at };
  for (const p of plan.pushProg) q.p[p.key] = p;
  saveQ(q); await flush();
  return plan;
}

// أول دخول لحساب جديد على هذا الجهاز: تُدمج مفضلة الضيف وتقدمه (قاعدة drama-family) في قاعدة الحساب بلا حذف من الأصل،
// وأحدث تقدم هو الذي يبقى. تُتخطى إن كانت drama-family مملوكة لحساب سابق (حتى لا تتسرب بيانات حساب آخر).
export function mergeGuest(guest, mine) {
  const lf = new Set(mine.favs.map((f) => f.showId)), lp = new Map(mine.progress.map((p) => [p.key, p]));
  return { favs: guest.favs.filter((f) => !lf.has(f.showId)), progress: guest.progress.filter((p) => !lp.has(p.key) || (p.updated || 0) > (lp.get(p.key).updated || 0)) };
}
export async function importGuest() {
  const k = 'df-import:' + getUid(); if (!getUid() || lsGet(k) !== '1') return;
  try {
    if (!lsGet(OWNER_KEY)) {
      const add = mergeGuest(await readOther('drama-family'), { favs: await raw.favs(), progress: await raw.progress() });
      for (const f of add.favs) await raw.putFav(f);
      for (const p of add.progress) await raw.putProgress(p);
    }
    lsDel(k);
  } catch { /* يُعاد في الزيارة التالية */ }
}

// يُحلّ عند انتهاء أول سحب من الحساب (نجح أو فشل)، وللضيف فورًا. صفحة المشاهدة تنتظره بمهلة قصيرة.
let firstDone; const first = new Promise((r) => { firstDone = r; });
export const whenSynced = (ms = 4000) => (getSession() ? Promise.race([first, new Promise((r) => setTimeout(r, ms))]) : Promise.resolve());
let started = false;
export async function startSync() {
  if (started || !getSession()) return; started = true;
  onWrite((t, v) => {
    const q = loadQ();
    if (t === 'fav') q.f[v.showId] = { on: v.on, at: v.at };
    else if (t === 'progress' && isReal(v)) q.p[v.key] = v;
    saveQ(q); schedule();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else pull().catch(() => {}); });
  addEventListener('pagehide', () => { flush(); });
  setInterval(() => pull().catch(() => {}), 5 * 60 * 1000);
  try { await pull(); } catch { /* أول مزامنة تُعاد لاحقًا */ } finally { firstDone(); }
}
