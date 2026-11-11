// ==UserScript==
// @name         Dizi - OK resume (test)
// @namespace    https://github.com/marwaljnibi-ctrl/drama-family
// @version      0.2.0
// @description  Remembers the playback position of OK (ok.ru) embeds, per video id, and restores it. Separate from the Arab HD script. Shows a temporary diagnostic badge.
// @match        https://ok.ru/videoembed/*
// @grant        GM.getValue
// @grant        GM.setValue
// @run-at       document-idle
// @inject-into  content
// ==/UserScript==
// نفس فكرة سكربت Arab HD الناجح، مع تحصينات خاصة بمشغّل OK: يبحث عن الفيديو الحقيقي (حتى داخل shadow DOM)، يتجاهل فيديوهات الإعلانات
// (المدة < 120 ث)، ويعيد الربط والاستعادة إن استُبدل عنصر الفيديو أو تغيّر مصدره. الشارة (DZ-OK) تشخيص مؤقت: عطّلها بـ GM.setValue('debug', false).
(async () => {
  'use strict';
  const m = location.pathname.match(/^\/videoembed\/(\d+)/);
  if (!m) return;
  const id = m[1], KEY = 'pos:ok:' + id, MIN_DUR = 120;
  let DEBUG = true; try { DEBUG = !!(await GM.getValue('debug', true)); } catch {}
  const fmt = (t) => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), mi = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(mi).padStart(2, '0') : mi) + ':' + String(s).padStart(2, '0'); };
  const st = { gm: '?', video: 'none', dur: '-', cur: '-', saved: '-', restore: '-', writes: 0, att: 0, err: '' };
  let badge = null;
  const frames = () => [...document.querySelectorAll('iframe')].map((f) => { try { return new URL(f.src, location.href).host; } catch { return '?'; } }).slice(0, 3).join(',') || '0';
  const draw = () => {
    if (!DEBUG) return;
    if (!badge) { badge = document.createElement('div'); badge.style.cssText = 'position:fixed;left:6px;top:6px;z-index:2147483647;background:rgba(0,0,0,.7);color:#fff;font:11px/1.4 monospace;padding:4px 6px;border-radius:6px;pointer-events:none;direction:ltr;max-width:92%'; (document.body || document.documentElement).appendChild(badge); }
    badge.textContent = `DZ-OK✓ run ${window !== top ? 'iframe' : 'top'} id=${id.slice(0, 6)} gm:${st.gm} video:${st.video} dur:${st.dur} cur:${st.cur} saved:${st.saved} restore:${st.restore} w=${st.writes} att=${st.att} frames:${frames()}${st.err ? ' ERR:' + st.err : ''}`;
  };
  const parentOrigin = (() => { try { const o = (location.ancestorOrigins && location.ancestorOrigins[0]) || new URL(document.referrer).origin; return /(\.github\.io|\.pages\.dev)$/.test(new URL(o).hostname) ? o : null; } catch { return null; } })();
  const tell = (type, extra) => { try { if (parentOrigin && parent !== window) parent.postMessage(Object.assign({ src: 'dizi-resume-ext', type, id }, extra), parentOrigin); } catch {} };
  draw(); tell('hello', { po: !!parentOrigin });
  // اختبار GM: كتابة ثم قراءة
  try { await GM.setValue('selftest', Date.now()); const v = await GM.getValue('selftest', null); st.gm = v ? 'ok' : 'read-empty'; } catch (e) { st.gm = 'FAIL'; st.err = 'gm:' + (e && e.message || e); }
  let saved = null;
  try { saved = await GM.getValue(KEY, null); } catch (e) { st.err = 'get:' + (e && e.message || e); }
  st.saved = saved && saved.t ? fmt(saved.t) : 'none'; draw();

  const tail = (d) => Math.min(20, d * 0.05);
  // البحث عن فيديو الحلقة: كل عناصر video في المستند وفي shadow roots المفتوحة، نختار الأطول مدةً (>= 120 ث)
  const allVideos = (root, out = []) => { root.querySelectorAll('video').forEach((v) => out.push(v)); root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) allVideos(el.shadowRoot, out); }); return out; };
  const pick = () => { const all = allVideos(document); st.video = all.length ? all.length + ' el' : 'none'; return all.filter((v) => isFinite(v.duration) && v.duration >= MIN_DUR).sort((a, b) => b.duration - a.duration)[0] || null; };

  let v = null, ac = null, armed = false, tries = 0, lastSave = 0, retryT = 0;
  const save = async (force) => {
    if (!v || !armed || !(v.duration >= MIN_DUR)) return;
    const now = Date.now(); if (!force && now - lastSave < 3000) return; lastSave = now;
    const t = v.currentTime, d = v.duration;
    if (t < 3) return;                                   // لا نكتب فوق دقيقة محفوظة بقيمة ~0
    const done = d - t < tail(d);
    try { await GM.setValue(KEY, { t: done ? 0 : t, d, at: now, done }); st.writes++; st.saved = done ? 'done' : fmt(t); } catch (e) { st.err = 'set:' + (e && e.message || e); }
    draw(); tell('time', { t, d });
  };
  const tryRestore = () => {
    if (armed || !v || !(v.duration >= MIN_DUR)) return;
    if (!saved || !(saved.t > 5) || saved.done || saved.t > v.duration - tail(v.duration)) { armed = true; st.restore = 'none'; draw(); tell('restore', { ok: 'none' }); return; }
    if (Math.abs(v.currentTime - saved.t) < 3) { armed = true; st.restore = 'yes@' + fmt(saved.t); draw(); tell('restore', { ok: 'yes', t: saved.t }); return; }
    if (++tries > 8) { armed = true; st.restore = 'gave-up'; draw(); tell('restore', { ok: 'gave-up' }); return; }
    st.restore = 'seek#' + tries + '->' + fmt(saved.t); draw();
    try { v.currentTime = saved.t; } catch (e) { st.err = 'seek:' + (e && e.message || e); }
    clearTimeout(retryT); retryT = setTimeout(tryRestore, 1500);
  };
  const reset = () => { armed = false; tries = 0; clearTimeout(retryT); };
  const attach = (el) => {
    if (ac) ac.abort(); ac = new AbortController(); const o = { signal: ac.signal };
    v = el; st.att++; reset(); draw(); tell('found', { has: !!(saved && saved.t), dur: Math.round(el.duration) });
    ['loadedmetadata', 'durationchange', 'loadeddata', 'canplay', 'play', 'playing', 'seeked'].forEach((e) => v.addEventListener(e, tryRestore, o));
    v.addEventListener('loadstart', reset, o);            // مصدر جديد في العنصر نفسه (مثلًا بعد إعلان): استعادة من جديد
    v.addEventListener('emptied', reset, o);
    v.addEventListener('timeupdate', () => { st.cur = fmt(v.currentTime); save(false); }, o);
    v.addEventListener('pause', () => save(true), o);
    v.addEventListener('ended', async () => { try { await GM.setValue(KEY, { t: 0, d: v.duration, at: Date.now(), done: true }); st.saved = 'done'; draw(); } catch {} }, o);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save(true), o);
    addEventListener('pagehide', () => save(true), o);
    tryRestore();
  };
  // مراقبة دائمة: يظهر الفيديو متأخرًا أو يُستبدل
  setInterval(() => {
    const el = pick();
    if (el && el !== v) attach(el);
    if (v) { st.dur = Math.round(v.duration) || '-'; st.cur = fmt(v.currentTime); }
    draw();
  }, 1000);
})();
