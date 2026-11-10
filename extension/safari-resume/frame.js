// Runs only inside https://arabhd.onl frames (ISOLATED world; no MAIN world needed: it reads the <video> element's DOM properties).
// Key = embed id from the URL (stable per episode in Dizi's catalog), never the temporary stream URL.
(() => {
  const m = location.pathname.match(/^\/embed-([a-z0-9]+)\.html$/i);
  if (!m) return;
  const id = m[1], KEY = 'dizi:arabhd:' + id;
  const api = globalThis.browser || globalThis.chrome;
  const store = {
    get: () => new Promise((res) => { try { const r = api.storage.local.get(KEY, (o) => res(o && o[KEY])); if (r && r.then) r.then((o) => res(o && o[KEY])); } catch { res(null); } }),
    set: (v) => new Promise((res) => { try { const r = api.storage.local.set({ [KEY]: v }, res); if (r && r.then) r.then(res); } catch { res(); } }),
  };
  const parentOrigin = (() => { try { const o = (location.ancestorOrigins && location.ancestorOrigins[0]) || new URL(document.referrer).origin; return /(\.github\.io|\.pages\.dev)$/.test(new URL(o).hostname) ? o : null; } catch { return null; } })();
  const tell = (type, extra) => { if (parentOrigin && parent !== window) parent.postMessage(Object.assign({ src: 'dizi-resume-ext', type, id }, extra), parentOrigin); };
  let v = null, saved = null, armed = false, tries = 0, lastSave = 0, retryT = 0;
  const tail = (d) => Math.min(20, d * 0.05);
  const save = async (force) => {
    if (!v || !armed || !(v.duration > 0)) return;
    const now = Date.now(); if (!force && now - lastSave < 3000) return; lastSave = now;
    const t = v.currentTime, d = v.duration;
    if (t < 3) return;                                   // never overwrite a saved minute with ~0
    const done = d - t < tail(d);
    await store.set({ t: done ? 0 : t, d, at: now, done });
    tell('time', { t, d });
  };
  const tryRestore = () => {
    if (armed || !v || !(v.duration > 0)) return;
    if (!saved || !(saved.t > 5) || saved.done || saved.t > v.duration - tail(v.duration)) { armed = true; tell('restore', { ok: 'none' }); return; }
    if (Math.abs(v.currentTime - saved.t) < 3) { armed = true; tell('restore', { ok: 'yes', t: saved.t }); return; }
    if (++tries > 6) { armed = true; tell('restore', { ok: 'gave-up' }); return; }
    try { v.currentTime = saved.t; } catch {}
    clearTimeout(retryT); retryT = setTimeout(tryRestore, 1500);
  };
  const attach = async (el) => {
    v = el; saved = await store.get();
    ['loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'seeked'].forEach((e) => v.addEventListener(e, tryRestore));
    v.addEventListener('timeupdate', () => save(false));
    v.addEventListener('pause', () => save(true));
    v.addEventListener('ended', () => store.set({ t: 0, d: v.duration, at: Date.now(), done: true }));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save(true));
    addEventListener('pagehide', () => save(true));
    tell('found', { has: !!saved });
    tryRestore();
  };
  const poll = setInterval(() => { const el = document.querySelector('video'); if (el) { clearInterval(poll); attach(el); } }, 500);
  setTimeout(() => clearInterval(poll), 120000);
})();
