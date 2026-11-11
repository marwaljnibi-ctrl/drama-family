// ==UserScript==
// @name         Dizi - OK resume (test)
// @namespace    https://github.com/marwaljnibi-ctrl/drama-family
// @version      0.1.0
// @description  Remembers the playback position of OK (ok.ru) embeds, per video id, and restores it. Separate from the Arab HD script on purpose.
// @match        https://ok.ru/videoembed/*
// @grant        GM.getValue
// @grant        GM.setValue
// @run-at       document-idle
// @inject-into  content
// ==/UserScript==
// نفس منطق سكربت Arab HD الناجح (حفظ كل 3 ث، استعادة بعد جاهزية الفيديو، لا كتابة فوق وقت محفوظ بصفر)، بمفتاح مستقل لكل فيديو.
(async () => {
  'use strict';
  const m = location.pathname.match(/^\/videoembed\/(\d+)/);
  if (!m) return;
  const id = m[1], KEY = 'pos:ok:' + id;
  let DEBUG = false; try { DEBUG = !!(await GM.getValue('debug', false)); } catch {}
  const fmt = (t) => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), mi = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(mi).padStart(2, '0') : mi) + ':' + String(s).padStart(2, '0'); };
  let badge = null; const st = { video: 'waiting', saved: '-', restore: '-', writes: 0, err: '' };
  const draw = () => {
    if (!DEBUG) return;
    if (!badge) { badge = document.createElement('div'); badge.style.cssText = 'position:fixed;left:6px;top:6px;z-index:2147483647;background:rgba(0,0,0,.65);color:#fff;font:11px/1.4 monospace;padding:4px 6px;border-radius:6px;pointer-events:none;direction:ltr;max-width:90%'; (document.body || document.documentElement).appendChild(badge); }
    badge.textContent = `DZ-OK✓ ${window !== top ? 'iframe' : 'top'} id=${id.slice(0, 6)}… video:${st.video} saved:${st.saved} restore:${st.restore} w=${st.writes}${st.err ? ' ERR:' + st.err : ''}`;
  };
  const parentOrigin = (() => { try { const o = (location.ancestorOrigins && location.ancestorOrigins[0]) || new URL(document.referrer).origin; return /(\.github\.io|\.pages\.dev)$/.test(new URL(o).hostname) ? o : null; } catch { return null; } })();
  const tell = (type, extra) => { try { if (parentOrigin && parent !== window) parent.postMessage(Object.assign({ src: 'dizi-resume-ext', type, id }, extra), parentOrigin); } catch {} };
  draw(); tell('hello');
  let saved = null;
  try { saved = await GM.getValue(KEY, null); } catch (e) { st.err = 'get:' + (e && e.message || e); }
  st.saved = saved && saved.t ? fmt(saved.t) : 'none'; draw();
  let v = null, armed = false, tries = 0, lastSave = 0, retryT = 0;
  const tail = (d) => Math.min(20, d * 0.05);
  const save = async (force) => {
    if (!v || !armed || !(v.duration > 0)) return;
    const now = Date.now(); if (!force && now - lastSave < 3000) return; lastSave = now;
    const t = v.currentTime, d = v.duration;
    if (t < 3) return;                                   // لا نكتب فوق دقيقة محفوظة بقيمة ~0
    const done = d - t < tail(d);
    try { await GM.setValue(KEY, { t: done ? 0 : t, d, at: now, done }); st.writes++; st.saved = done ? 'done' : fmt(t); } catch (e) { st.err = 'set:' + (e && e.message || e); }
    draw(); tell('time', { t, d });
  };
  const tryRestore = () => {
    if (armed || !v || !(v.duration > 0)) return;
    if (!saved || !(saved.t > 5) || saved.done || saved.t > v.duration - tail(v.duration)) { armed = true; st.restore = 'none'; draw(); tell('restore', { ok: 'none' }); return; }
    if (Math.abs(v.currentTime - saved.t) < 3) { armed = true; st.restore = 'yes@' + fmt(saved.t); draw(); tell('restore', { ok: 'yes', t: saved.t }); return; }
    if (++tries > 6) { armed = true; st.restore = 'gave-up'; draw(); tell('restore', { ok: 'gave-up' }); return; }
    st.restore = 'seek#' + tries; draw();
    try { v.currentTime = saved.t; } catch {}
    clearTimeout(retryT); retryT = setTimeout(tryRestore, 1500);
  };
  const attach = (el) => {
    v = el; st.video = 'found'; draw(); tell('found', { has: !!(saved && saved.t) });
    ['loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'seeked'].forEach((e) => v.addEventListener(e, tryRestore));
    v.addEventListener('timeupdate', () => save(false));
    v.addEventListener('pause', () => save(true));
    v.addEventListener('ended', async () => { try { await GM.setValue(KEY, { t: 0, d: v.duration, at: Date.now(), done: true }); st.saved = 'done'; draw(); } catch {} });
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save(true));
    addEventListener('pagehide', () => save(true));
    tryRestore();
  };
  // مشغّل OK قد ينشئ عنصر video متأخرًا (عند أول تشغيل) أو يستبدله؛ نراقب بلا حد زمني
  let cur = null;
  setInterval(() => { const el = document.querySelector('video'); if (el && el !== cur) { cur = el; attach(el); } }, 1000);
})();
