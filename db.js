// IndexedDB محلي لكل جهاز: المفضلة، التقدم، الحلقات المحمّلة. لا خادم ولا حسابات.
const DB_NAME = 'drama-family', VER = 1;
let _db;
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
    const t = d.transaction(store, mode), s = t.objectStore(store);
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
  toggle: async (id) => ((await get('favs', id)) ? (await del('favs', id), false) : (await put('favs', { showId: id, at: Date.now() }), true)),
};
export const progress = {
  all: () => all('progress'),
  get: (showId, epId) => get('progress', showId + '|' + epId),
  async save(showId, ep, patch) {
    const key = showId + '|' + ep.id;
    const cur = (await get('progress', key)) || { key, showId, epId: ep.id, epNum: ep.n, time: 0, duration: 0, done: false };
    const next = { ...cur, ...patch, epNum: ep.n, updated: Date.now() };
    await put('progress', next);
    return next;
  },
  reset: (showId, epId) => del('progress', showId + '|' + epId),
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
