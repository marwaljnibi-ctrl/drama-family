import { loadData, asset, findEp, latestEpisodes } from './source.js';
import { favs, progress, downloads, persistStorage } from './db.js';
import { $, esc, fmt, mb, toast, poster, HEART, pop, heartClick, showCard, skeletonGrid, emptyState } from './components.js';
import { continueItems, myShows, nextEp, started } from './store.js';
import { renderHome } from './home.js';
import { embedAdapter } from './bridge.js';
import { SERVERS, pickDefault, alternatives } from './servers.js';
import { canReloadNow } from './guards.js';
import { renderAlerts, bindShowAlert, askOnboarding, signedIn } from './alerts.js';
import { AUTH_REQUIRED, getSession, prepareDb, renderLogin } from './auth.js';
import { startSync } from './sync.js';

const view = $('#view'), titleEl = $('#title'), backBtn = $('#back');
// تشخيص للمطوّر فقط: يظهر عند فتح الموقع بـ ?arabtest=1 (ويُطفأ بـ ?arabtest=0). للقراءة فقط: لا أزرار ولا إرسال للمشغّل. لا يظهر للمستخدم العادي.
const arabTestOn = () => {
  try { const q = new URLSearchParams(location.search).get('arabtest'); if (q === '1') localStorage.setItem('ARAB_HD_RESUME_TEST', '1'); if (q === '0') localStorage.removeItem('ARAB_HD_RESUME_TEST'); return localStorage.getItem('ARAB_HD_RESUME_TEST') === '1'; } catch { return false; }
};
let arabMsgH = null;
function arabTestPanel(box, pl, epId) {
  let n = 0, last = ''; const types = {};
  box.innerHTML = '<div class="note" dir="ltr" style="direction:ltr;text-align:left"><b>dev: Arab HD bridge</b><div id="at-st" style="white-space:pre-wrap;font:12px/1.6 monospace"></div></div>';
  const draw = () => { const el = box.querySelector('#at-st'); if (el) el.textContent = 'build=' + BUILD + ' | episode=' + epId + ' | messages from iframe=' + n + ' ' + JSON.stringify(types) + '\nlast: ' + last; };
  if (arabMsgH) removeEventListener('message', arabMsgH);
  arabMsgH = (e) => { const f = pl.querySelector('iframe'); if (f && e.source === f.contentWindow) { n++; const d = e.data || {}; const t = d.type; types[t] = (types[t] || 0) + 1; last = JSON.stringify({ type: d.type, id: d.id, t: d.t && Math.round(d.t), d: d.d && Math.round(d.d), ok: d.ok, origin: e.origin }); draw(); } };
  addEventListener('message', arabMsgH); draw();
}
let D;
let cleanup = null;
const BUILD = 'df-v24';   // رقم النسخة (يطابق sw.js)؛ يظهر في لوحة المطوّر ?arabtest=1 فقط
let pendingReload = false, reloaded = false;   // إعادة تحميل مؤجلة بعد وصول نسخة جديدة أثناء المشاهدة
const isPlaying = () => [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended);
const demoQ = () => (D && D.demo ? '?demo=1' : '');

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (pendingReload && !reloaded && canReloadNow(location.hash, isPlaying())) { reloaded = true; location.reload(); return; }   // نفّذ التحديث المؤجل عند مغادرة صفحة المشاهدة
  view.onclick = null;
  let [, name, a, b] = (location.hash || '#/home').split('/');
  if (!name || name === 'new') name = 'home';
  const TAB = { home: 'home', latest: 'home', shows: 'shows', show: 'shows', watch: 'shows', favs: 'favs', recent: 'recent' }[name];
  document.querySelectorAll('#tabs a').forEach((x) => x.classList.toggle('on', x.dataset.t === TAB));
  backBtn.hidden = false; // زر رجوع في كل صفحة (طلب سابق)
  window.scrollTo(0, 0);
  if (!D) {
    view.innerHTML = name === 'home' ? '' : skeletonGrid();
    if (name === 'home') { const { skeletonHome } = await import('./components.js'); view.innerHTML = skeletonHome(); }
    try { D = await loadData(); } catch { view.innerHTML = '<div class="empty">تعذّر تحميل قائمة المسلسلات.<br>تأكد من الاتصال ثم أعد المحاولة.</div>'; return; }
  }
  const R = { alerts: () => renderAlerts(view), home: vHome, latest: vLatest, shows: vShows, favs: vFavs, recent: vRecent, show: () => vShow(decodeURIComponent(a)), watch: () => vWatch(decodeURIComponent(a), decodeURIComponent(b)) };
  titleEl.textContent = { home: 'Dizi', latest: 'الحلقات الجديدة', shows: 'المسلسلات', favs: 'المفضلة', recent: 'آخر المشاهدات', alerts: 'تنبيهات واتساب' }[name] || 'Dizi';
  await (R[name] || vHome)();
}
backBtn.onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/home'; };
addEventListener('hashchange', route);

const emptyData = () => '<div class="empty">لم تتم مزامنة فهرس المسلسلات بعد.<br>عند أول تحديث ناجح من المصدر ستظهر المسلسلات هنا.</div>';
const demoBanner = () => (D.demo ? '<div class="note">وضع تجريبي: بيانات وهمية لاختبار الواجهة فقط وليست من المصدر.</div>' : '');

// ---------- الرئيسية ----------
async function vHome() {
  if (!D.shows.length) return (view.innerHTML = emptyData());
  await renderHome(D, view, { demoBanner: demoBanner() });
}

// ---------- كل الحلقات الجديدة (حلقات لمسلسلات موجودة) ----------
async function vLatest() {
  if (!D.shows.length) return (view.innerHTML = emptyData());
  const [pa, fa] = await Promise.all([progress.all(), favs.all()]);
  const prog = new Map(pa.map((p) => [p.key, p])), fv = new Set(fa.map((f) => f.showId));
  const items = latestEpisodes(D);
  view.innerHTML = demoBanner() + (items.length ? `<div class="grid">${items.map(({ show, ep }) => {
    const p = prog.get(show.id + '|' + ep.id);
    const isNew = ep.ts && Date.now() - ep.ts < 3 * 864e5 && !(p && p.done);
    return `<div class="card"><a href="#/watch/${encodeURIComponent(show.id)}/${encodeURIComponent(ep.id)}">${poster(show)}${isNew ? '<span class="badge">حلقة جديدة</span>' : ''}<div class="t">${esc(show.title)}</div><div class="s">حلقة ${esc(ep.n)}${p && p.done ? ' ✓' : ''}</div></a>${heartBtn(show.id, fv.has(show.id))}</div>`;
  }).join('')}</div>` : '<div class="empty">لا حلقات جديدة.</div>');
  view.onclick = heartClick(view, fv);
}

// ---------- قائمة المسلسلات ----------
async function vShows() {
  if (!D.shows.length) return (view.innerHTML = emptyData());
  const fv = new Set((await favs.all()).map((f) => f.showId));
  view.innerHTML = demoBanner() + '<input class="search" id="q" type="search" placeholder="ابحث عن مسلسل" enterkeyhint="search" autocomplete="off"><div class="grid" id="g"></div>';
  const g = $('#g');
  const norm = (s) => s.replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  const draw = () => {
    const q = norm($('#q').value.trim());
    const list = D.shows.filter((s) => !q || norm(s.title).includes(q));
    g.innerHTML = list.length ? list.map((s) => showCard(s, { fav: fv.has(s.id) })).join('') : '<div class="empty" style="grid-column:1/-1">لا نتائج.</div>';
  };
  $('#q').oninput = draw; draw();
  g.onclick = heartClick(view, fv);
}
// ---------- المفضلة ----------
async function vFavs() {
  const fv = new Set((await favs.all()).map((f) => f.showId));
  const draw = async () => {
    const list = await myShows(D);
    view.innerHTML = demoBanner() + (list.length ? `<div class="grid">${list.map((m) => showCard(m.show, { fav: true, badge: m.hasNew ? 'حلقة جديدة' : '', sub: m.last ? 'وصلت إلى حلقة ' + m.last.epNum : '' })).join('')}</div>` : emptyState('لم تضف أي مسلسل بعد', 'اضغط ♥ على أي مسلسل ليظهر هنا.', { href: '#/shows', label: 'تصفّح المسلسلات' }));
    view.onclick = heartClick(view, fv, draw);
  };
  await draw();
}

// ---------- آخر المشاهدات (سجل المتابعة الكامل) ----------
async function vRecent() {
  const items = await continueItems(D, { all: true });
  if (!items.length) return (view.innerHTML = demoBanner() + emptyState('لم تبدأ مشاهدة أي مسلسل بعد', 'ما تشاهده يظهر هنا لتستكمله بضغطة واحدة.', { href: '#/shows', label: 'تصفّح المسلسلات' }));
  view.innerHTML = demoBanner() + `<div class="list">${items.map((it) => {
    const pct = it.hasMinute ? Math.min(100, (it.time / it.duration) * 100) : 0;
    const info = it.kind === 'finished' ? `حلقة ${it.epNum} مكتملة ✓ · آخر حلقة متاحة` : it.kind === 'next' ? `حلقة ${it.epNum} مكتملة ✓ · التالية: ${it.ep.n}` : `حلقة ${it.ep.n}${it.hasMinute ? ' · توقفت عند ' + fmt(it.time) : ' · قيد المشاهدة'}`;
    return `<div class="row"><a href="#/show/${encodeURIComponent(it.show.id)}" style="display:contents">${poster(it.show)}</a><div class="m"><b>${esc(it.show.title)}</b><small>${esc(info)}</small>${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div><a href="#/watch/${encodeURIComponent(it.show.id)}/${encodeURIComponent(it.ep.id)}"><button class="pri">${it.kind === 'next' ? 'التالية' : it.kind === 'finished' ? 'إعادة' : 'متابعة المشاهدة'}</button></a></div>`;
  }).join('')}</div>`;
}

// ---------- صفحة المسلسل ----------
async function vShow(id) {
  const show = D.byId.get(id); if (!show) return (view.innerHTML = '<div class="empty">المسلسل غير موجود.</div>');
  titleEl.textContent = show.title;
  const [fv, prog, dls] = await Promise.all([favs.has(id), progress.all(), downloads.meta()]);
  const mine = new Map(prog.filter((p) => p.showId === id && started(p)).map((p) => [p.epId, p]));
  const dl = new Set(dls.map((d) => d.key));
  const last = [...mine.values()].sort((a, b) => b.updated - a.updated)[0];
  const lastEp = last && findEp(show, last.epId);
  const cont = lastEp ? (last.done ? nextEp(show, lastEp) || lastEp : lastEp) : null;
  const dlAble = show.eps.filter((e) => e.v && e.v.type === 'mp4');
  view.innerHTML = `${demoBanner()}<div class="hero">${poster(show)}<div><h2>${esc(show.title)}</h2><small style="color:var(--mute)">${show.eps.length} حلقة</small>
    <div class="actions"><button id="fav" class="favbtn ${fv ? 'on' : ''}">${HEART}<span>${fv ? 'في المفضلة' : 'أضف للمفضلة'}</span></button>${signedIn() ? '<button id="wa" class="favbtn">🔔 <span>تنبيه واتساب</span></button>' : ''}</div></div></div>
    <div class="actions">${cont ? `<a style="flex:1" href="#/watch/${encodeURIComponent(id)}/${encodeURIComponent(cont.id)}"><button class="pri" style="width:100%">${last.done ? 'الحلقة التالية ' + cont.n : 'متابعة المشاهدة · حلقة ' + cont.n + (last.duration ? ' (' + fmt(last.time) + ')' : '')}</button></a>` : ''}
    ${dlAble.length ? '<button id="dlall">تحميل الكل</button>' : ''}</div>
    <div class="eps">${show.eps.map((e) => { const p = mine.get(e.id); return `<a class="ep ${p ? (p.done ? 'done' : 'part') : ''} ${lastEp && lastEp.id === e.id ? 'last' : ''} ${dl.has(id + '|' + e.id) ? 'dl' : ''}" href="#/watch/${encodeURIComponent(id)}/${encodeURIComponent(e.id)}">${esc(e.n)}</a>`; }).join('')}</div>`;
  bindShowAlert($('#wa'), id, show.title);
  $('#fav').onclick = async () => { const b = $('#fav'); const on = await favs.toggle(id); b.classList.toggle('on', on); b.querySelector('span').textContent = on ? 'في المفضلة' : 'أضف للمفضلة'; pop(b); };
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

// ---------- استيراد حلقة من تطبيق الملفات (تجريبي) ----------
// الملف يُربط بالمسلسل والحلقة المفتوحة، ويُحفظ على الجهاز (IndexedDB)، ثم يعمل بمشغّل HTML5 مع الاستكمال وبلا إنترنت.
const epNumFromName = (n) => { const m = String(n).replace(/\.[^.]+$/, '').match(/(\d{1,4})(?!.*\d)/); return m ? +m[1] : null; };
async function importEp(show, ep, file) {
  if (!/^video\//.test(file.type) && !/\.(mp4|m4v|mov)$/i.test(file.name)) throw new Error('اختر ملف فيديو (mp4)');
  const n = epNumFromName(file.name);
  if (n && n !== +ep.n && !confirm(`اسم الملف يشير إلى الحلقة ${n} وأنت في الحلقة ${ep.n}. هل تريد ربطه بالحلقة ${ep.n}؟`)) throw new Error('أُلغي الاستيراد');
  // 1) المساحة: نقارن حجم الملف بالمتاح قبل أي كتابة. التقدير قد يكون تقريبيًا على iOS، لذا نعالج فشل الحفظ أيضًا (أدناه).
  let free = null;
  if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e.quota) free = Math.max(0, e.quota - (e.usage || 0)); }
  if (free !== null && free < file.size * 1.05) throw new Error(`المساحة لا تكفي: الملف ${mb(file.size)} والمتاح نحو ${mb(free)}. احذف حلقات محفوظة أو حرّر مساحة في الجهاز ثم أعد المحاولة.`);
  await persistStorage();
  toast(`جارٍ حفظ الملف (${mb(file.size)})… لا تغلق التطبيق`);
  const key = show.id + '|' + ep.id;
  // 2) نمرّر ملف المستخدم نفسه إلى IndexedDB دون قراءته في ذاكرة الصفحة ودون slice/arrayBuffer: المتصفح ينقله من الملف إلى التخزين مباشرة.
  //    (slice فقط إن كان نوع الملف فارغًا، وهو مجرد مؤشر بلا نسخ.)
  const blob = file.type ? file : file.slice(0, file.size, 'video/mp4');
  try {
    await downloads.save(key, blob, { showId: show.id, epId: ep.id, title: show.title, n: ep.n, fname: file.name, imported: true });
    const back = await downloads.getBlob(key); // مؤشر فقط: نتحقق من الحجم دون قراءة المحتوى
    if (!back || back.size !== file.size) throw new Error('حجم الملف المحفوظ لا يطابق الأصل');
  } catch (e) {
    try { await downloads.remove(key); } catch {} // لا نترك ملفًا ناقصًا
    if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) throw new Error('فشل الحفظ: مساحة التخزين المخصصة للتطبيق ممتلئة. احذف حلقات محفوظة أو حرّر مساحة في الجهاز ثم أعد المحاولة.');
    if (e && e.name === 'AbortError') throw new Error('فشل الحفظ: أُلغيت العملية (غالبًا بسبب نقص المساحة). لم يُحفظ أي شيء.');
    throw new Error('فشل حفظ الملف: ' + ((e && (e.message || e.name)) || 'خطأ غير معروف'));
  }
}
function addImport(container, show, ep, onDone) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/mp4,video/*,.mp4,.m4v,.mov'; inp.hidden = true; inp.id = 'imp';
  const btn = document.createElement('button'); btn.id = 'impbtn'; btn.textContent = '📥 استيراد من الملفات'; btn.onclick = () => inp.click();
  inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; try { await importEp(show, ep, f); toast('تم حفظ الحلقة'); onDone(); } catch (e) { toast(e.message || 'فشل الاستيراد'); } finally { inp.value = ''; } };
  container.append(btn, inp);
}

async function vWatch(showId, epId) {
  const show = D.byId.get(showId), ep = show && findEp(show, epId);
  if (!ep) return (view.innerHTML = '<div class="empty">الحلقة غير موجودة.</div>');
  titleEl.textContent = `${show.title} - حلقة ${ep.n}`;
  const key = showId + '|' + epId;
  // تنقّل سريع: إن تغيّر المسار أثناء الانتظار فهذه صفحة قديمة، تتوقف ولا تلمس الصفحة الجديدة
  const h0 = location.hash, stale = () => location.hash !== h0;
  const [p0, meta] = await Promise.all([progress.get(showId, epId), downloads.getMeta(key)]);
  if (stale()) return;
  const next = nextEp(show, ep);
  // سيرفران فقط: Arab HD (مشغّل مضمّن) وcloud.mail.ru.
  // cloud.mail.ru لا يُضمَّن ولا يُقرأ من داخل التطبيق: رابط الملف المباشر مرتبط بعنوان IP لمن طلبه (اختُبر: 206 لنفس الجهاز، 404 لغيره)،
  // وطلبه من المتصفح يمنعه CORS. لذلك زره يفتح صفحة الملف العامة في Safari للمشاهدة أو التنزيل.
  const ids = {}; for (const x of ep.sv || []) if (SERVERS[x[0]]) ids[x[0]] = x[1];   // معرّفات السيرفرات المضمّنة المعروفة لهذه الحلقة
  const exLink = ((ep.sv || []).find((x) => x[0] === 'e') || [])[1];
  const SRC = [];
  if (meta) SRC.push({ k: 'f', name: 'الملف المحفوظ', video: true });
  if (ep.v) SRC.push({ k: 'v', name: 'مباشر', video: true });
  for (const k of Object.keys(SERVERS)) if (ids[k]) SRC.push({ k, name: SERVERS[k].name, video: false });
  if (exLink) SRC.push({ k: 'e', name: 'cloud.mail.ru ↗', video: false, href: exLink });
  const dlHref = exLink || null;

  view.innerHTML = `${demoBanner()}<div class="player" id="pl"></div>
    <div class="actions" id="srv"></div>
    <div class="actions" id="act"></div>
    <div id="msg"></div>
    <div class="actions">${next ? `<a style="flex:1" href="#/watch/${encodeURIComponent(showId)}/${encodeURIComponent(next.id)}"><button style="width:100%">الحلقة التالية (${esc(next.n)})</button></a>` : ''}<a style="flex:1" href="#/show/${encodeURIComponent(showId)}"><button style="width:100%">كل الحلقات</button></a></div>`;
  const pl = $('#pl'), srv = $('#srv'), act = $('#act'), msg = $('#msg');
  const setDone = async (done) => { await progress.save(showId, ep, { done, ...(done ? {} : { time: 0 }) }, { force: true }); toast(done ? 'تم وضع علامة ✓' : 'أُعيدت الحلقة للبداية'); route(); };
  if (!p0) await progress.save(showId, ep, { done: false });
  if (stale()) return;

  let cur = null, curV = null, teardown = null, blobUrl = null, noSave = false; // noSave: أثناء «إزالة من آخر المشاهدات» لا يكتب المشغّل تقدمًا يلغي الإزالة
  const stopCur = () => { if (teardown) { teardown(); teardown = null; } curV = null; };
  cleanup = () => { stopCur(); if (blobUrl) URL.revokeObjectURL(blobUrl); };

  // مشغّل HTML5: حفظ تلقائي كل 3 ثوانٍ، واستكمال مؤكد بحدث seeked (منقول كما هو من النسخة المختبرة على iPhone)
  const mountVideo = (src, startAt) => {
    pl.innerHTML = '<video id="v" controls playsinline webkit-playsinline preload="metadata"></video>';
    const v = pl.querySelector('#v'); curV = v;
    v.addEventListener('error', () => {
      if (cur === 'e') msg.innerHTML = '<div class="note">لم يعمل cloud.mail.ru داخل التطبيق على هذا الجهاز. استخدم Arab HD أو زر «تنزيل».</div>';
      else if (cur === 'f') msg.innerHTML = '<div class="note">تعذّر تشغيل الملف المحفوظ (قد تكون صيغته غير مدعومة على هذا الجهاز). يمكنك حذفه واستيراد ملف آخر.</div>';
    });
    if (cur === 'v' && ep.v.type === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) {
      import('https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.mjs').then((m) => { const h = new m.default(); h.loadSource(src); h.attachMedia(v); });
    } else v.src = src;
    const tail = () => Math.min(20, v.duration * 0.05);
    let armed = !(startAt > 3), tries = 0, retryT;
    const applySeek = () => {
      if (armed || !(v.duration > 0)) return;
      if (!(startAt < v.duration - tail())) { armed = true; return; }
      if (tries >= 6) return; tries++;
      try { v.currentTime = startAt; } catch {}
      clearTimeout(retryT); retryT = setTimeout(() => { if (!armed && Math.abs(v.currentTime - startAt) > 2) applySeek(); }, 1500);
    };
    for (const ev of ['loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing']) v.addEventListener(ev, () => { if (!armed && Math.abs(v.currentTime - startAt) > 2) applySeek(); });
    v.addEventListener('seeked', () => { if (!armed && Math.abs(v.currentTime - startAt) <= 2) { armed = true; clearTimeout(retryT); } });
    let lastSave = 0;
    const save = (force) => {
      if (noSave) return;
      if (!armed) { if (tries >= 2 && v.currentTime > 5) armed = true; else return; }
      if (!(v.duration > 0)) return;
      const now = Date.now(); if (!force && now - lastSave < 3000) return; lastSave = now;
      const t = v.currentTime, d = v.duration;
      return progress.save(showId, ep, { time: t, duration: d, done: p0 && p0.done && t < d * 0.9 ? false : (d - t < tail() || t / d > 0.95) })
        .then(() => { v.dataset.savedAt = t.toFixed(1); }).catch(() => {});
    };
    v.addEventListener('timeupdate', () => save(false));
    v.addEventListener('pause', () => save(true));
    v.addEventListener('ended', () => { progress.save(showId, ep, { time: v.duration, duration: v.duration, done: true }); toast('اكتملت الحلقة ✓'); });
    const vis = () => document.visibilityState === 'hidden' && save(true);
    document.addEventListener('visibilitychange', vis); addEventListener('pagehide', vis);
    teardown = () => { save(true); clearTimeout(retryT); document.removeEventListener('visibilitychange', vis); removeEventListener('pagehide', vis); try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} };
  };
  // مشغّل مضمّن من سجل SERVERS. تقدم واحد لكل حلقة (showId + epId): Dizi هو المصدر الأساسي.
  // السيرفر الجديد يستعيد دقيقة Dizi (يرسلها Dizi له) لا دقيقته المحلية، ولا نقبل منه دقيقة أقدم بكثير في أول 30 ث (يمنع الكتابة فوق التقدم الصحيح عند التبديل).
  const mountServer = (k) => {
    const S = SERVERS[k], id = ids[k];
    pl.innerHTML = `<iframe src="${esc(S.url(id))}" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    const ad = embedAdapter({ getFrame: () => pl.querySelector('iframe'), origin: S.origin, id });
    let okMarked = false, loaded = false, base = 0, restored = false; const guardUntil = Date.now() + 30000;
    ad.onRestore(() => { restored = true; });
    ad.onReady(async () => { const q = await progress.get(showId, epId); const ok = q && !q.done && q.duration > 0 && q.time > 5; base = ok ? q.time : 0; ad.seekTo(ok ? q.time : null, ok ? q.duration : null); });
    ad.onProgress((t, d) => { if (!okMarked) { okMarked = true; try { localStorage.setItem('df-sv-ok', k); } catch {} }
      if (stale() || noSave) return; if (!restored && Date.now() < guardUntil && base && t < base - 15) return; progress.save(showId, ep, { time: t, duration: d, done: d - t < Math.min(20, d * 0.05), by: 'ext' }).catch(() => {}); });
    const fr = pl.querySelector('iframe'); const failT = setTimeout(() => { if (loaded || stale()) return; const alts = alternatives(SRC.filter((x) => !x.href && SERVERS[x.k]).map((x) => x.k), k); if (!alts.length) return; msg.innerHTML = `<div class="note">تأخر تحميل ${esc(S.name)}. ${alts.map((x) => `<button class="alt" data-k="${x}">جرّب ${esc(SERVERS[x].name)}</button>`).join(' ')}</div>`; msg.querySelectorAll('.alt').forEach((b) => (b.onclick = () => select(b.dataset.k))); }, 15000);
    if (fr) fr.addEventListener('load', () => { loaded = true; clearTimeout(failT); });
    teardown = () => { clearTimeout(failT); ad.destroy(); };
    msg.innerHTML = S.hint ? `<div class="note">${esc(S.hint)}</div>` : '';
    if (arabTestOn()) arabTestPanel(msg, pl, epId, showId);
  };
  const drawSrv = () => {
    srv.innerHTML = SRC.map((s) => s.href
      ? `<a style="flex:1;min-width:120px" href="${esc(s.href)}" target="_blank" rel="noopener"><button style="width:100%">${esc(s.name)}</button></a>`
      : `<button data-k="${s.k}" class="${s.k === cur ? 'pri' : ''}">${esc(s.name)}</button>`).join('');
    srv.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => select(b.dataset.k)));
  };
  const select = async (k, startAt) => {
    stopCur(); msg.innerHTML = ''; cur = k;
    drawSrv();
    if (SERVERS[k]) return mountServer(k);
    if (startAt == null) { const p = await progress.get(showId, epId); if (stale()) return; startAt = p && !p.done ? p.time || 0 : 0; }
    if (k === 'v') return mountVideo(ep.v.src, startAt);
    if (k === 'f') {
      if (!blobUrl) { const b = await downloads.getBlob(key); if (stale()) return; if (!b) { toast('الملف المحفوظ غير موجود'); return; } blobUrl = URL.createObjectURL(b); }
      return mountVideo(blobUrl, startAt);
    }
  };

  const exportFile = async () => {
    const b = await downloads.getBlob(key); if (!b) return toast('الملف المحفوظ غير موجود');
    const name = `${show.title} - الحلقة ${ep.n}.mp4`.replace(/[\\/:*?"<>|]/g, ' ');
    const f = new File([b], name, { type: 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); } catch (e) { if (e.name !== 'AbortError') toast('تعذّر الحفظ: ' + e.message); } }
    else { const u = URL.createObjectURL(f); const a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
  };

  act.innerHTML = `${dlHref ? `<a style="flex:1;min-width:120px" href="${esc(dlHref)}" target="_blank" rel="noopener"><button style="width:100%">⬇ تنزيل</button></a>` : ''}
    ${p0 && p0.done ? '<button id="rs">إعادة تشغيلها</button>' : ''}
    ${meta ? `<button id="exp">حفظ في الملفات</button><button id="rm">حذف الملف المحفوظ (${mb(meta.size)})</button>` : ''}`;
  const inHistory = (await progress.all()).some((p) => p.showId === showId && started(p) && !p.hidden);
  if (stale()) return;
  if (inHistory) act.insertAdjacentHTML('beforeend', '<button id="rh">إزالة من آخر المشاهدات</button>');
  addImport(act, show, ep, () => route());
  const rh = $('#rh'); if (rh) rh.onclick = async () => { if (!confirm(`إزالة «${show.title}» من آخر المشاهدات؟\nلن يُحذف تقدمك، وتعود إليها تلقائيًا عند مشاهدة أي حلقة منها.`)) return; noSave = true; stopCur(); await progress.hideShow(showId); toast('أُزيل من آخر المشاهدات'); route(); };
  const rs = $('#rs'); if (rs) rs.onclick = () => setDone(false);
  const ex = $('#exp'); if (ex) ex.onclick = exportFile;
  const rm = $('#rm'); if (rm) rm.onclick = async () => { stopCur(); await downloads.remove(key); route(); };

  if (!SRC.length) {
    // لا سيرفر معروف لهذه الحلقة بعد: الحلقات القديمة تُفهرس تدريجيًا في الخلفية. نقول ذلك، والمصدر الخارجي خيار ثانوي
    pl.style.cssText = 'aspect-ratio:auto;background:none';
    pl.innerHTML = `<div class="empty-card"><b>جارٍ فهرسة سيرفرات هذه الحلقة</b><p>جرّب حلقة أحدث أو عد لاحقًا.</p><a href="${esc(ep.url)}" target="_blank" rel="noopener"><button>فتح الحلقة في المصدر ↗</button></a></div>`;
    return;
  }
  let pref = null; try { pref = localStorage.getItem('df-sv-ok'); } catch {}
  const playable = SRC.filter((s) => !s.href);
  if (!playable.length) { pl.innerHTML = `<a href="${esc(exLink)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:12px;background:#000;color:#fff;font-size:18px">▶ فتح الحلقة على cloud.mail.ru</a>`; return; }
  const first = (meta && 'f') || pickDefault(playable.map((s) => s.k), pref);
  select(first);
}

// ---------- تشغيل وتحديث دوري ----------
if ('serviceWorker' in navigator) {
  // عند وصول نسخة جديدة نعيد التحميل مرة واحدة ليظهر التحديث فورًا (لا نقطع مشاهدة حلقة).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloaded) return; if (canReloadNow(location.hash, isPlaying())) { reloaded = true; location.reload(); } else pendingReload = true; });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// ---------- الدخول (Google) ----------
function showGate(msg) {
  document.getElementById('tabs').style.display = 'none'; backBtn.hidden = true; titleEl.textContent = 'Dizi';
  view.innerHTML = '<div class="empty-card" style="margin-top:40px"><b>أهلًا بك في Dizi</b><p>موقع العائلة. سجّل الدخول بحساب Google الذي دعوناك به.</p><div id="g-btn" style="display:flex;justify-content:center;min-height:44px"></div><p id="g-err" style="margin-top:12px;color:var(--danger,#c0392b)">' + (msg || '') + '</p></div>';
  const err = (c) => { document.getElementById('g-err').textContent = c === 'not_invited' ? 'هذا الحساب غير مدعو. اطلب دعوة من صاحب الموقع.' : c === 'network' ? 'تعذّر الاتصال، أعد المحاولة.' : 'تعذّر تسجيل الدخول، حاول مرة أخرى.'; };
  renderLogin(document.getElementById('g-btn'), { onDone: () => location.reload(), onError: err }).catch(() => err('network'));
}
if (AUTH_REQUIRED() && !getSession()) showGate();
else {
  prepareDb();
  if (getSession()) {
    const top = document.getElementById('top'), ac = document.createElement('a');
    ac.id = 'acct'; ac.href = '#/alerts'; ac.textContent = '👤'; ac.setAttribute('aria-label', 'حسابي'); ac.style.cssText = 'margin-inline-start:auto;text-decoration:none;font-size:20px;padding:4px 8px';
    top.append(ac);
  }
  persistStorage();
  route();
  if (getSession()) startSync().then(async () => { try { askOnboarding(await (await import('./auth.js')).authApi('/api/profile'), () => (location.hash = '#/alerts')); } catch {} });
}
// فحص الحلقات الجديدة كل 5 دقائق، وعند العودة إلى التطبيق
const refresh = async () => { if (document.visibilityState !== 'visible' || !D) return; try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) reg.update(); } catch {} try { const n = await loadData(true); if (n.updated !== D.updated) { D = n; if (/#\/(home|new|shows|latest)?$/.test(location.hash) || !location.hash) route(); } } catch {} };
setInterval(refresh, 5 * 60 * 1000);
document.addEventListener('visibilitychange', refresh);

// الأرقام العربية (١٢٣) في كل نص معروض، بلا المساس بالروابط أو القيم.
{
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const conv = (n) => { if (n.nodeType === 3) { if (/\d/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\d/g, (d) => AR[d]); } else if (n.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|INPUT|TEXTAREA)$/.test(n.tagName)) n.childNodes.forEach(conv); };
  const mo = new MutationObserver((ms) => { mo.disconnect(); ms.forEach((m) => (m.type === 'characterData' ? conv(m.target) : m.addedNodes.forEach(conv))); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); });
  conv(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}
