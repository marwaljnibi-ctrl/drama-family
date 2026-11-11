// IndexedDB محلي لكل جهاز: المفضلة، التقدم، الحلقات المحمّلة. لا خادم ولا حسابات.
let DB_NAME = 'drama-family'; const VER = 1;
let _db;
// اسم القاعدة لكل مستخدم (يُضبط قبل أول استخدام): الحساب الأول على الجهاز يرث قاعدة «drama-family» القديمة كما هي (لا حذف ولا نسخ)، والبقية قواعد منفصلة.
export const setDbName = (n) => { if (!_db) DB_NAME = n; };
const listeners = new Set();
export const onWrite = (cb) => listeners.add(cb);
const emit = (t, v) => listeners.forEach((cb) => { try { cb(t, v); } catch {} });
function open() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('favs', { keyPath: 'showId' });
      const p = d.createObjectStore('progress', { keyPath: 'key' }); // key = showId|epId
      p.createIndex('showId', 'showId');
      d.createObjectStore('dlmeta', { keyPath: 'key' });
      d.createObjectStore('dlblob');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _db;
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    // durability 'strict': لا تكتمل المعاملة إلا بعد الكتابة على القرص (مهم إن أُطفئ الجهاز). المتصفح الذي لا يدعمها يتجاهلها.
    const t = mode === 'readwrite' ? d.transaction(store, mode, { durability: 'strict' }) : d.transaction(store, mode), s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = (ev) => rej((ev && ev.target && ev.target.error) || t.error || new DOMException('IndexedDB error', 'UnknownError'));
    // امتلاء التخزين قد يظهر كإلغاء للعملية (abort) بلا حدث error: نرفضه بدل التعليق بصمت.
    t.onabort = () => rej(t.error || new DOMException('Transaction aborted', 'AbortError'));
  });
}
const all = (s) => tx(s, 'readonly', (st) => st.getAll());
const get = (s, k) => tx(s, 'readonly', (st) => st.get(k));
const put = (s, v, k) => tx(s, 'readwrite', (st) => st.put(v, k));
const del = (s, k) => tx(s, 'readwrite', (st) => st.delete(k));

export const favs = {
  all: () => all('favs'),
  has: async (id) => !!(await get('favs', id)),
  toggle: async (id) => {
    const at = Date.now();
    if (await get('favs', id)) { await del('favs', id); emit('fav', { showId: id, on: false, at }); return false; }
    await put('favs', { showId: id, at }); emit('fav', { showId: id, on: true, at }); return true;
  },
};
import { acceptTime, SESSION } from './guards.js';
const rejected = new Map();   // آخر كتابة تقدم رُفضت (حماية التعارض بين الجلسات)
export const progress = {
  all: () => all('progress'),
  get: (showId, epId) => get('progress', showId + '|' + epId),
  // opts.force: كتابة متعمدة من المستخدم (مثل «إعادة تشغيلها») تتجاوز حماية التعارض
  async save(showId, ep, patch, opts = {}) {
    const key = showId + '|' + ep.id;
    const rec = await get('progress', key);
    const cur = rec || { key, showId, epId: ep.id, epNum: ep.n, time: 0, duration: 0, done: false };
    if (!opts.force && 'time' in patch) {
      const dec = acceptTime({ cur: rec, time: patch.time, sid: SESSION, rej: rejected });
      if (!dec.ok) { rejected.set(key, dec.remember); return cur; }   // كاتب آخر نشط كتب تقدمًا أحدث: لا نخفضه بكتابة منفردة
      rejected.delete(key);
    }
    const next = { ...cur, ...patch, epNum: ep.n, updated: Date.now(), sid: SESSION };
    if (!('hidden' in patch)) next.hidden = false; // مشاهدة جديدة تعيد المسلسل إلى آخر المشاهدات تلقائيًا
    await put('progress', next); emit('progress', next);
    return next;
  },
  reset: (showId, epId) => del('progress', showId + '|' + epId),
  // «إزالة من آخر المشاهدات»: علامة إخفاء فقط على سجلات المسلسل؛ لا يُحذف أي تقدم ولا علامات الحلقات المشاهدة
  async hideShow(showId) { for (const p of await all('progress')) if (p.showId === showId) { const n = { ...p, hidden: true, updated: Date.now() }; await put('progress', n); emit('progress', n); } },
};
export const downloads = {
  meta: () => all('dlmeta'),
  getMeta: (key) => get('dlmeta', key),
  getBlob: (key) => get('dlblob', key),
  async save(key, blob, info) { await put('dlblob', blob, key); await put('dlmeta', { key, size: blob.size, at: Date.now(), ...info }); },
  async remove(key) { await del('dlblob', key); await del('dlmeta', key); },
};
export async function persistStorage() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

// قراءة بيانات الضيف من قاعدة أخرى (للقراءة فقط، لا تُنشئ ولا تعدّل ولا تحذف شيئًا)
export function readOther(name) {
  const empty = { favs: [], progress: [] };
  return new Promise(async (res) => {
    try {
      if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === name)) return res(empty);
      const r = indexedDB.open(name);
      r.onerror = () => res(empty);
      r.onsuccess = () => {
        const d = r.result, out = { favs: [], progress: [] }, names = ['favs', 'progress'].filter((s) => d.objectStoreNames.contains(s));
        if (!names.length) { d.close(); return res(out); }
        const tx = d.transaction(names, 'readonly');
        names.forEach((n) => { const q = tx.objectStore(n).getAll(); q.onsuccess = () => { out[n] = q.result; }; });
        tx.oncomplete = () => { d.close(); res(out); }; tx.onerror = () => { d.close(); res(empty); };
      };
    } catch { res(empty); }
  });
}
// كتابات خام بلا إطلاق أحداث: تستعملها المزامنة عند سحب بيانات الحساب (حتى لا تُدفع من جديد)
export const raw = {
  favs: () => all('favs'), progress: () => all('progress'),
  putFav: (v) => put('favs', v), delFav: (id) => del('favs', id), putProgress: (v) => put('progress', v),
};
