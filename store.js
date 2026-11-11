// منطق البيانات المشتق (بلا واجهة): المتابعة، مسلسلاتي، الحلقات والمسلسلات الجديدة.
// المصدر الوحيد للمفضلة والتقدم هو db.js (favs, progress). هنا لا تُنشأ قاعدة ثانية ولا تُكرَّر البيانات.
import { favs, progress } from './db.js';
import { findEp } from './source.js';

// الحلقات مرتبة الأحدث أولًا؛ التالية = رقم أكبر مباشرة
export const nextEp = (show, ep) => { const i = show.eps.findIndex((e) => e.id === ep.id); return i > 0 ? show.eps[i - 1] : null; };

// بدأت المشاهدة فعلًا: سجّل المشغّل مدة (duration > 0) أو اكتملت. حلقة فُتحت فقط ولم تُشغَّل لا تُعدّ متابعة.
export const started = (p) => !!p && (p.done || p.duration > 0);

// آخر سجل تقدم لكل مسلسل
const latestByShow = (rows) => { const by = new Map(); for (const p of rows) { const c = by.get(p.showId); if (!c || (p.updated || 0) > (c.updated || 0)) by.set(p.showId, p); } return by; };

// عناصر المتابعة، الأحدث مشاهدة أولًا. all=false: تستبعد المسلسلات المكتملة حتى آخر حلقة متاحة.
// hasMinute صحيح فقط عند وجود مدة مسجّلة فعلًا (من المشغّل أو من رسائل الاستكمال المثبتة).
export async function continueItems(D, { all = false } = {}) {
  const by = latestByShow((await progress.all()).filter(started));
  const out = [];
  for (const p of [...by.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0))) {
    if (p.hidden) continue; // أُزيل من آخر المشاهدات (لم يُحذف شيء)
    const show = D.byId.get(p.showId), ep = show && findEp(show, p.epId);
    if (!ep) continue;
    const next = p.done ? nextEp(show, ep) : null;
    if (p.done && !next && !all) continue;
    out.push({ show, ep: next || ep, doneEp: p.done ? ep : null, kind: p.done ? (next ? 'next' : 'finished') : 'continue', p, time: p.time || 0, duration: p.duration || 0, hasMinute: !p.done && p.duration > 0 && p.time > 0, epNum: p.epNum, updated: p.updated || 0 });
  }
  return out;
}

// بداية التتبع على هذا الجهاز: حلقات/مسلسلات ظهرت قبلها لا تُعدّ «جديدة» أبدًا (فلا ادعاء كاذب عند أول تشغيل)
const LS = { start: 'df-track-start', shows: 'df-known-shows' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const trackStart = () => { let t = lsGet(LS.start, 0); if (!t) { t = Date.now(); lsSet(LS.start, t); } return t; };

// تتبع المسلسلات الجديدة: إن وفّر الفهرس حقل added نستخدمه، وإلا نسجّل أول ظهور على هذا الجهاز (بعد خط الأساس).
// لا يغيّر معرّفات ولا يحذف شيئًا. يعيد خريطة id -> وقت أول ظهور.
export function trackShows(D) {
  const start = trackStart();
  let known = lsGet(LS.shows, null);
  if (!known) { known = { base: D.shows.map((s) => s.id), added: {} }; lsSet(LS.shows, known); return known; }
  const have = new Set(known.base);
  let dirty = false;
  for (const s of D.shows) if (!have.has(s.id)) { have.add(s.id); known.base.push(s.id); known.added[s.id] = Date.now(); dirty = true; }
  if (dirty) lsSet(LS.shows, known);
  known.start = start;
  return known;
}
// مسلسلات جديدة (عنوان أُضيف حديثًا)، الأحدث أولًا. غير الحلقات الجديدة.
export function newShows(D, days = 14) {
  const known = trackShows(D), lim = Date.now() - days * 864e5;
  const stamp = (s) => s.added || known.added[s.id] || 0;
  return D.shows.map((s) => ({ s, at: stamp(s) })).filter((x) => x.at && x.at > lim).sort((a, b) => b.at - a.at).map((x) => x.s);
}

// مسلسلاتي = المفضلة (db.favs) + حالة المتابعة + علامة «حلقة جديدة»
// حلقة جديدة: حلقة فعلية ظهرت في الفهرس بعد آخر حالة سجلناها (آخر مشاهدة أو وقت الإضافة للمفضلة) وبعد بداية التتبع.
export async function myShows(D) {
  const [fl, prog] = await Promise.all([favs.all(), progress.all()]);
  const by = latestByShow(prog.filter(started)), start = trackStart();
  return fl.sort((a, b) => (b.at || 0) - (a.at || 0)).map((f) => {
    const show = D.byId.get(f.showId); if (!show) return null;
    const p = by.get(show.id);
    const basis = Math.max(p ? p.updated || 0 : 0, f.at || 0, start);
    const lastN = p ? p.epNum : null;
    const hasNew = show.eps.some((e) => e.ts && e.ts > basis && (lastN == null || e.n > lastN));
    return { show, fav: f, last: p || null, hasNew };
  }).filter(Boolean);
}

// حلقات جديدة (لمسلسل موجود): من قائمة latest في الفهرس، آخر 3 أيام ولم تُكتمل مشاهدتها
export async function newEpisodes(D, latest, limit = 12) {
  const prog = new Map((await progress.all()).map((p) => [p.key, p]));
  return latest.filter(({ show, ep }) => !(prog.get(show.id + '|' + ep.id) || {}).done).slice(0, limit);
}
