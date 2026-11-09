import { loadData, findEp, latestEpisodes } from './source.js';
import { favs, progress, downloads, persistStorage } from './db.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view'), titleEl = $('#title'), backBtn = $('#back');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }
const poster = (s, cls = '') => (s.img || s.poster) ? `<img class="${cls}" loading="lazy" referrerpolicy="no-referrer" src="${esc(s.img || s.poster)}" alt="">` : `<div class="ph ${cls}"></div>`;

let D;
let cleanup = null;
const demoQ = () => (D && D.demo ? '?demo=1' : '');

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [, name, a, b] = (location.hash || '#/new').split('/');
  document.querySelectorAll('#tabs a').forEach((x) => x.classList.toggle('on', x.dataset.t === name || (name === 'show' && x.dataset.t === 'shows') || (name === 'watch' && x.dataset.t === 'shows')));
  const sub = name === 'show' || name === 'watch';
  backBtn.hidden = !sub;
  window.scrollTo(0, 0);
  if (!D) {
    try { D = await loadData(); } catch { view.innerHTML = '<div class="empty">تعذّر تحميل قائمة المسلسلات.<br>تأكد من الاتصال ثم أعد المحاولة.</div>'; return; }
  }
  const R = { new: vNew, shows: vShows, favs: vFavs, recent: vRecent, show: () => vShow(decodeURIComponent(a)), watch: () => vWatch(decodeURIComponent(a), decodeURIComponent(b)) };
  titleEl.textContent = { new: 'الحلقات الجديدة', shows: 'قائمة المسلسلات', favs: 'المفضلة', recent: 'آخر المشاهدات' }[name] || 'Dizi';
  await (R[name] || vNew)();
}
backBtn.onclick = () => history.back();
addEventListener('hashchange', route);

const emptyData = () => '<div class="empty">لم تتم مزامنة فهرس المسلسلات بعد.<br>عند أول تحديث ناجح من المصدر ستظهر المسلسلات هنا.</div>';
const demoBanner = () => (D.demo ? '<div class="note">وضع تجريبي: بيانات وهمية لاختبار الواجهة فقط وليست من المصدر.</div>' : '');

// ---------- الحلقات الجديدة ----------
async function vNew() {
  if (!D.shows.length) return (view.innerHTML = emptyData());
  const prog = new Map((await progress.all()).map((p) => [p.key, p]));
  const items = latestEpisodes(D);
  view.innerHTML = demoBanner() + (items.length ? `<div class="grid">${items.map(({ show, ep }) => {
    const p = prog.get(show.id + '|' + ep.id);
    const isNew = ep.ts && Date.now() - ep.ts < 3 * 864e5 && !(p && p.done);
    return `<a class="card" href="#/watch/${encodeURIComponent(show.id)}/${encodeURIComponent(ep.id)}">${poster(show)}${isNew ? '<span class="badge">جديد</span>' : ''}<div class="t">${esc(show.title)}</div><div class="s">حلقة ${esc(ep.n)}${p && p.done ? ' ✓' : ''}</div></a>`;
  }).join('')}</div>` : '<div class="empty">لا حلقات جديدة.</div>');
}

// ---------- قائمة المسلسلات ----------
async function vShows() {
  if (!D.shows.length) return (view.innerHTML = emptyData());
  const fv = new Set((await favs.all()).map((f) => f.showId));
  view.innerHTML = demoBanner() + '<input class="search" id="q" type="search" placeholder="ابحث عن مسلسل" autocomplete="off"><div class="grid" id="g"></div>';
  const g = $('#g');
  const norm = (s) => s.replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  const draw = () => {
    const q = norm($('#q').value.trim());
    const list = D.shows.filter((s) => !q || norm(s.title).includes(q));
    g.innerHTML = list.length ? list.map((s) => cardHtml(s, fv)).join('') : '<div class="empty" style="grid-column:1/-1">لا نتائج.</div>';
  };
  $('#q').oninput = draw; draw();
  g.onclick = heartClick(fv);
}
const cardHtml = (s, fv) => `<div class="card"><a href="#/show/${encodeURIComponent(s.id)}">${poster(s)}<div class="t">${esc(s.title)}</div></a><button class="heart ${fv.has(s.id) ? 'on' : ''}" data-id="${esc(s.id)}" aria-label="مفضلة">${fv.has(s.id) ? '♥' : '♡'}</button></div>`;
function heartClick(fv, after) {
  return async (e) => {
    const b = e.target.closest('.heart'); if (!b) return;
    e.preventDefault();
    const on = await favs.toggle(b.dataset.id);
    on ? fv.add(b.dataset.id) : fv.delete(b.dataset.id);
    b.classList.toggle('on', on); b.textContent = on ? '♥' : '♡';
    if (after) after();
  };
}

// ---------- المفضلة ----------
async function vFavs() {
  const fv = new Set((await favs.all()).map((f) => f.showId));
  const draw = () => {
    const list = D.shows.filter((s) => fv.has(s.id));
    view.innerHTML = demoBanner() + (list.length ? `<div class="grid">${list.map((s) => cardHtml(s, fv)).join('')}</div>` : '<div class="empty">لم تضف أي مسلسل بعد.<br>اضغط ♡ على أي مسلسل لإضافته.</div>');
    const g = $('.grid'); if (g) g.onclick = heartClick(fv, draw);
  };
  draw();
}

// ---------- آخر المشاهدات ----------
async function vRecent() {
  const all = await progress.all();
  const by = new Map();
  for (const p of all) { const c = by.get(p.showId); if (!c || p.updated > c.updated) by.set(p.showId, p); }
  const rows = [...by.values()].sort((a, b) => b.updated - a.updated).map((p) => ({ p, show: D.byId.get(p.showId) })).filter((x) => x.show);
  if (!rows.length) return (view.innerHTML = demoBanner() + '<div class="empty">لم تبدأ مشاهدة أي مسلسل بعد.</div>');
  view.innerHTML = demoBanner() + `<div class="list">${rows.map(({ p, show }) => {
    const ep = findEp(show, p.epId), next = p.done && ep ? nextEp(show, ep) : null;
    const target = next || ep;
    const pct = p.duration ? Math.min(100, (p.time / p.duration) * 100) : 0;
    const info = p.done ? `حلقة ${p.epNum} مكتملة ✓${next ? ' · التالية: ' + next.n : ' · آخر حلقة متاحة'}` : p.duration ? `حلقة ${p.epNum} · توقفت عند ${fmt(p.time)}` : `حلقة ${p.epNum} · قيد المشاهدة`;
    return `<div class="row">${poster(show)}<div class="m"><b>${esc(show.title)}</b><small>${info}</small>${!p.done && p.duration ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>${target ? `<a href="#/watch/${encodeURIComponent(show.id)}/${encodeURIComponent(target.id)}"><button class="pri">${p.done ? 'التالية' : 'استكمال'}</button></a>` : ''}</div>`;
  }).join('')}</div>`;
}
// الحلقات مرتبة الأحدث أولًا؛ التالية = رقم أكبر مباشرة
const nextEp = (show, ep) => { const i = show.eps.findIndex((e) => e.id === ep.id); return i > 0 ? show.eps[i - 1] : null; };

// ---------- صفحة المسلسل ----------
async function vShow(id) {
  const show = D.byId.get(id); if (!show) return (view.innerHTML = '<div class="empty">المسلسل غير موجود.</div>');
  titleEl.textContent = show.title;
  const [fv, prog, dls] = await Promise.all([favs.has(id), progress.all(), downloads.meta()]);
  const mine = new Map(prog.filter((p) => p.showId === id).map((p) => [p.epId, p]));
  const dl = new Set(dls.map((d) => d.key));
  const last = [...mine.values()].sort((a, b) => b.updated - a.updated)[0];
  const lastEp = last && findEp(show, last.epId);
  const cont = lastEp ? (last.done ? nextEp(show, lastEp) || lastEp : lastEp) : null;
  const dlAble = show.eps.filter((e) => e.v && e.v.type === 'mp4');
  view.innerHTML = `${demoBanner()}<div class="hero">${poster(show)}<div><h2>${esc(show.title)}</h2><small style="color:var(--mute)">${show.eps.length} حلقة</small>
    <div class="actions"><button id="fav">${fv ? '♥ في المفضلة' : '♡ أضف للمفضلة'}</button></div></div></div>
    <div class="actions">${cont ? `<a style="flex:1" href="#/watch/${encodeURIComponent(id)}/${encodeURIComponent(cont.id)}"><button class="pri" style="width:100%">${last.done ? 'الحلقة التالية ' + cont.n : 'استكمال حلقة ' + cont.n + (last.duration ? ' (' + fmt(last.time) + ')' : '')}</button></a>` : ''}
    ${dlAble.length ? '<button id="dlall">تحميل الكل</button>' : ''}</div>
    <div class="eps">${show.eps.map((e) => { const p = mine.get(e.id); return `<a class="ep ${p ? (p.done ? 'done' : 'part') : ''} ${lastEp && lastEp.id === e.id ? 'last' : ''} ${dl.has(id + '|' + e.id) ? 'dl' : ''}" href="#/watch/${encodeURIComponent(id)}/${encodeURIComponent(e.id)}">${esc(e.n)}</a>`; }).join('')}</div>
    <div class="note">✓ باهتة: مكتملة · إطار عنابي: بدأتها ولم تكتمل · عنابي ممتلئ: آخر حلقة وصلت إليها</div>`;
  $('#fav').onclick = async (e) => { const on = await favs.toggle(id); e.target.textContent = on ? '♥ في المفضلة' : '♡ أضف للمفضلة'; };
  const da = $('#dlall');
  if (da) da.onclick = async () => { let n = 0; for (const e of dlAble) { if (!dl.has(id + '|' + e.id)) { try { await downloadEp(show, e, (m) => (da.textContent = m)); n++; } catch (err) { toast('توقف التحميل: ' + err.message); break; } } } da.textContent = 'تحميل الكل'; if (n) vShow(id); };
}

// ---------- المشاهدة ----------
async function downloadEp(show, ep, onProgress) {
  if (!ep.v || ep.v.type !== 'mp4') throw new Error('لا يوجد ملف قابل للتنزيل لهذه الحلقة');
  const key = show.id + '|' + ep.id;
  if (await downloads.getMeta(key)) return;
  await persistStorage();
  const r = await fetch(ep.v.src);
  if (!r.ok || !r.body) throw new Error('رفض المصدر التنزيل (' + r.status + ')');
  const total = +r.headers.get('content-length') || 0;
  if (total && navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e.quota && e.quota - e.usage < total * 1.1) throw new Error('المساحة غير كافية'); }
  const reader = r.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress && onProgress(total ? `جارٍ التحميل ${Math.round((got / total) * 100)}%` : `جارٍ التحميل ${mb(got)}`); }
  await downloads.save(key, new Blob(chunks, { type: 'video/mp4' }), { showId: show.id, epId: ep.id, title: show.title, n: ep.n });
}

async function vWatch(showId, epId) {
  const show = D.byId.get(showId), ep = show && findEp(show, epId);
  if (!ep) return (view.innerHTML = '<div class="empty">الحلقة غير موجودة.</div>');
  titleEl.textContent = `${show.title} - حلقة ${ep.n}`;
  const key = showId + '|' + epId;
  const [p0, meta] = await Promise.all([progress.get(showId, epId), downloads.getMeta(key)]);
  const next = nextEp(show, ep);
  const direct = ep.v || meta;
  view.innerHTML = `${demoBanner()}<div class="player" id="pl"></div>
    <div class="actions" id="act"></div><div id="msg"></div>
    <div class="actions">${next ? `<a style="flex:1" href="#/watch/${encodeURIComponent(showId)}/${encodeURIComponent(next.id)}"><button style="width:100%">الحلقة التالية (${esc(next.n)})</button></a>` : ''}<a style="flex:1" href="#/show/${encodeURIComponent(showId)}"><button style="width:100%">كل الحلقات</button></a></div>`;
  const pl = $('#pl'), act = $('#act'), msg = $('#msg');
  const setDone = async (done) => { await progress.save(showId, ep, { done, ...(done ? {} : { time: 0 }) }); toast(done ? 'تم وضع علامة ✓' : 'أُعيدت الحلقة للبداية'); route(); };

  if (direct) {
    // مشغّل أصلي: تحكم كامل وحفظ كل 5 ثوانٍ
    let src = ep.v && ep.v.src, blobUrl;
    if (meta) { const b = await downloads.getBlob(key); if (b) { blobUrl = URL.createObjectURL(b); src = blobUrl; } }
    pl.innerHTML = '<video id="v" controls playsinline webkit-playsinline preload="metadata"></video>';
    const v = $('#v');
    if (ep.v && ep.v.type === 'hls' && !blobUrl) {
      if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = ep.v.src;
      else { const m = await import('https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.mjs'); const h = new m.default(); h.loadSource(ep.v.src); h.attachMedia(v); }
    } else v.src = src;
    const startAt = p0 && !p0.done ? p0.time : 0;
    v.addEventListener('loadedmetadata', () => { if (startAt > 3 && startAt < v.duration - 5) v.currentTime = startAt; });
    let lastSave = 0;
    const save = (force) => { if (!v.duration || isNaN(v.duration)) return; const now = Date.now(); if (!force && now - lastSave < 5000) return; lastSave = now; progress.save(showId, ep, { time: v.currentTime, duration: v.duration, done: p0 && p0.done && v.currentTime < v.duration * 0.9 ? false : (v.duration - v.currentTime < 20 || v.currentTime / v.duration > 0.95) }); };
    v.addEventListener('timeupdate', () => save(false));
    v.addEventListener('pause', () => save(true));
    v.addEventListener('ended', () => { progress.save(showId, ep, { time: v.duration, duration: v.duration, done: true }); toast('اكتملت الحلقة ✓'); });
    const vis = () => document.visibilityState === 'hidden' && save(true);
    document.addEventListener('visibilitychange', vis); addEventListener('pagehide', vis);
    cleanup = () => { save(true); document.removeEventListener('visibilitychange', vis); removeEventListener('pagehide', vis); blobUrl && URL.revokeObjectURL(blobUrl); };
    act.innerHTML = `${meta ? `<button id="rm">حذف التحميل (${mb(meta.size)})</button>` : ep.v && ep.v.type === 'mp4' ? '<button class="pri" id="dl">تحميل الحلقة</button>' : ''}<button id="rs">إعادة من البداية</button>`;
    const dlb = $('#dl'); if (dlb) dlb.onclick = async () => { try { await downloadEp(show, ep, (m) => (dlb.textContent = m)); toast('تم التحميل'); route(); } catch (e) { toast(e.message); dlb.textContent = 'تحميل الحلقة'; } };
    const rm = $('#rm'); if (rm) rm.onclick = async () => { await downloads.remove(key); route(); };
    $('#rs').onclick = () => { v.currentTime = 0; setDone(false); };
    if (!(ep.v && ep.v.type === 'mp4') && !meta) msg.innerHTML = '<div class="note">التحميل غير متاح لهذه الحلقة: المصدر يبثها بصيغة لا تُحفظ على الجهاز.</div>';
  } else {
    // مشغّلات التضمين العامة (Arab HD / Turk / OK): تُعرض مباشرة داخل التطبيق بلا صفحة المصدر وإعلاناتها.
    // اختُبرت من أصل github.io: تعمل داخل iframe بدون نوافذ منبثقة. لا يمكن قراءة ثانية التوقف من مشغّل خارجي.
    const EMB = { a: ['Arab HD', (i) => `https://arabhd.onl/embed-${i}.html`], t: ['Turk', (i) => `https://arabveturk.com/embed-${i}.html`], o: ['OK', (i) => `https://ok.ru/videoembed/${i}`] };
    const sv = (ep.sv || []).filter((x) => EMB[x[0]]).sort((x, y) => 'ato'.indexOf(x[0]) - 'ato'.indexOf(y[0]));
    // Express = رابط عام لملف على cloud.mail.ru: لا يُضمَّن. يُفتح للتنزيل عبر Safari (يحفظه في تطبيق الملفات).
    const exLink = ((ep.sv || []).find((x) => x[0] === 'e') || [])[1];
    const exBtn = exLink ? `<a style="flex:1;min-width:120px" href="${esc(exLink)}" target="_blank" rel="noopener"><button style="width:100%">⬇ تنزيل (Express)</button></a>` : '';
    const exNote = exLink ? ' زر «تنزيل (Express)» يفتح صفحة الملف العامة على cloud.mail.ru، وتنزّله منها عبر Safari إلى تطبيق الملفات.' : '';
    if (sv.length) {
      // الافتراضي: Arab HD ثم Turk. نتذكر اختيارك لهما فقط. OK يعتمد على المنطقة فلا يصير افتراضيًا أبدًا.
      let cur = 0; try { const k = localStorage.getItem('df-sv'); const i = k === 'o' ? -1 : sv.findIndex((x) => x[0] === k); if (i >= 0) cur = i; } catch {}
      let nosb = false; // خيار تجريبي لحل مشاكل بعض الأجهزة: تعطيل sandbox لهذا المشغّل
      const SB = 'sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"';
      const draw = () => {
        const [k, id] = sv[cur];
        const embUrl = EMB[k][1](id);
        pl.innerHTML = `<iframe src="${esc(embUrl)}" ${nosb ? '' : SB} allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
        msg.innerHTML = `<div class="note">${k === 'o' ? 'OK لا يعمل في بعض الدول (يعرض «غير متاح للمنطقة»)، جرّب Arab HD أو Turk. ' : 'إن لم يعمل المشغّل جرّب الآخر. '}التطبيق يحفظ آخر حلقة فتحتها، لكنه لا يعرف الدقيقة التي توقفت عندها ولا يستطيع تنزيل الحلقة من المشغّل نفسه. اضغط «تمت المشاهدة» عند الانتهاء.${exNote}<br>المشغّل لا يعمل؟ <a href="#" id="nb">${nosb ? 'أعد الحماية' : 'جرّب بدون حماية'}</a> · <a href="${esc(embUrl)}" target="_blank" rel="noopener">افتح المشغّل في Safari</a></div>`;
        $('#nb').onclick = (ev) => { ev.preventDefault(); nosb = !nosb; draw(); };
        act.innerHTML = sv.map(([kk], i) => `<button data-i="${i}" class="${i === cur ? 'pri' : ''}">${EMB[kk][0]}</button>`).join('') + (p0 && p0.done ? '<button id="rs">إعادة تشغيلها</button>' : '<button id="ok">تمت المشاهدة ✓</button>') + exBtn;
        act.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { cur = +b.dataset.i; nosb = false; try { if (sv[cur][0] !== 'o') localStorage.setItem('df-sv', sv[cur][0]); } catch {} draw(); }));
        const ok = $('#ok'); if (ok) ok.onclick = () => setDone(true);
        const rs = $('#rs'); if (rs) rs.onclick = () => setDone(false);
      };
      if (!p0) await progress.save(showId, ep, { done: false });
      draw();
      return;
    }
    // لا سيرفر معروف بعد لهذه الحلقة (لم يُحلّ في المزامنة): نفتح صفحة المصدر بزر واحد.
    pl.innerHTML =`<a href="${esc(ep.url)}" target="_blank" rel="noopener" id="go" style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:12px;overflow:hidden;background:#000">${(show.img || show.poster) ? `<img src="${esc(show.img || show.poster)}" referrerpolicy="no-referrer" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.35">` : ''}<span style="position:relative;font-size:64px;line-height:1">▶</span></a>`;
    $('#go').onclick = () => { progress.save(showId, ep, { done: false }); };
    act.innerHTML = `<a style="flex:1" href="${esc(ep.url)}" target="_blank" rel="noopener"><button class="pri" style="width:100%">▶ تشغيل الحلقة</button></a>${p0 && p0.done ? '<button id="rs">إعادة تشغيلها</button>' : '<button id="ok">تمت المشاهدة ✓</button>'}${exBtn}`;
    const ok = $('#ok'); if (ok) ok.onclick = () => setDone(true);
    const rs = $('#rs'); if (rs) rs.onclick = () => setDone(false);
    msg.innerHTML = '<div class="note">تُفتح الحلقة في صفحة المصدر. يحفظ التطبيق أنك فتحتها وآخر حلقة وصلت إليها، لكنه لا يعرف الدقيقة التي توقفت عندها ولا يستطيع تنزيلها. اضغط «تمت المشاهدة» عند الانتهاء.</div>';
  }
}

// ---------- تشغيل وتحديث دوري ----------
if ('serviceWorker' in navigator) {
  // عند وصول نسخة جديدة نعيد التحميل مرة واحدة ليظهر التحديث فورًا (لا نقطع مشاهدة حلقة).
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !/^#\/watch/.test(location.hash)) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
persistStorage();
route();
setInterval(async () => { if (document.visibilityState !== 'visible') return; try { const n = await loadData(true); if (n.updated !== D.updated) { D = n; if (/#\/(new|shows)?$/.test(location.hash) || !location.hash) route(); } } catch {} }, 15 * 60 * 1000);

// الأرقام العربية (١٢٣) في كل نص معروض، بلا المساس بالروابط أو القيم.
{
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const conv = (n) => { if (n.nodeType === 3) { if (/\d/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\d/g, (d) => AR[d]); } else if (n.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|INPUT|TEXTAREA)$/.test(n.tagName)) n.childNodes.forEach(conv); };
  const mo = new MutationObserver((ms) => { mo.disconnect(); ms.forEach((m) => (m.type === 'characterData' ? conv(m.target) : m.addedNodes.forEach(conv))); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); });
  conv(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}
