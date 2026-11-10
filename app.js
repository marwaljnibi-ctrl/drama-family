import { loadData, loadMailru, asset, findEp, latestEpisodes } from './source.js';
import { favs, progress, downloads, persistStorage } from './db.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view'), titleEl = $('#title'), backBtn = $('#back');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }
// الصور: النسخة الأوضح (img2، 600px) إن وُجدت، ثم القديمة، ثم رابط المصدر
const poster = (s, cls = '') => { const src = asset(s.img2 || s.img) || s.poster; return src ? `<img class="${cls}" loading="lazy" referrerpolicy="no-referrer" src="${esc(src)}" alt="">` : `<div class="ph ${cls}"></div>`; };
// قلب المفضلة موحّد في كل الصفحات: أيقونة Lucide Heart، فارغ رمادي، ممتلئ عنابي، مع نبضة عند الضغط
const HEART = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
const heartBtn = (id, on) => `<button class="heart ${on ? 'on' : ''}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="مفضلة">${HEART}</button>`;
const pop = (el) => { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); };

let D;
let cleanup = null;
const demoQ = () => (D && D.demo ? '?demo=1' : '');

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [, name, a, b] = (location.hash || '#/new').split('/');
  document.querySelectorAll('#tabs a').forEach((x) => x.classList.toggle('on', x.dataset.t === name || (name === 'show' && x.dataset.t === 'shows') || (name === 'watch' && x.dataset.t === 'shows')));
  backBtn.hidden = false; // زر رجوع في كل صفحة
  window.scrollTo(0, 0);
  if (!D) {
    try { D = await loadData(); } catch { view.innerHTML = '<div class="empty">تعذّر تحميل قائمة المسلسلات.<br>تأكد من الاتصال ثم أعد المحاولة.</div>'; return; }
  }
  const R = { new: vNew, shows: vShows, favs: vFavs, recent: vRecent, show: () => vShow(decodeURIComponent(a)), watch: () => vWatch(decodeURIComponent(a), decodeURIComponent(b)) };
  titleEl.textContent = { new: 'الحلقات الجديدة', shows: 'قائمة المسلسلات', favs: 'المفضلة', recent: 'آخر المشاهدات' }[name] || 'Dizi';
  await (R[name] || vNew)();
}
backBtn.onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/new'; };
addEventListener('hashchange', route);

const emptyData = () => '<div class="empty">لم تتم مزامنة فهرس المسلسلات بعد.<br>عند أول تحديث ناجح من المصدر ستظهر المسلسلات هنا.</div>';
const demoBanner = () => (D.demo ? '<div class="note">وضع تجريبي: بيانات وهمية لاختبار الواجهة فقط وليست من المصدر.</div>' : '');

// ---------- الحلقات الجديدة ----------
async function vNew() {
  if (!D.shows.length) return (view.innerHTML = emptyData());
  const [pa, fa] = await Promise.all([progress.all(), favs.all()]);
  const prog = new Map(pa.map((p) => [p.key, p])), fv = new Set(fa.map((f) => f.showId));
  const items = latestEpisodes(D);
  view.innerHTML = demoBanner() + (items.length ? `<div class="grid">${items.map(({ show, ep }) => {
    const p = prog.get(show.id + '|' + ep.id);
    const isNew = ep.ts && Date.now() - ep.ts < 3 * 864e5 && !(p && p.done);
    return `<div class="card"><a href="#/watch/${encodeURIComponent(show.id)}/${encodeURIComponent(ep.id)}">${poster(show)}${isNew ? '<span class="badge">جديد</span>' : ''}<div class="t">${esc(show.title)}</div><div class="s">حلقة ${esc(ep.n)}${p && p.done ? ' ✓' : ''}</div></a>${heartBtn(show.id, fv.has(show.id))}</div>`;
  }).join('')}</div>` : '<div class="empty">لا حلقات جديدة.</div>');
  const g = $('.grid'); if (g) g.onclick = heartClick(fv);
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
const cardHtml = (s, fv) => `<div class="card"><a href="#/show/${encodeURIComponent(s.id)}">${poster(s)}<div class="t">${esc(s.title)}</div></a>${heartBtn(s.id, fv.has(s.id))}</div>`;
function heartClick(fv, after) {
  return async (e) => {
    const b = e.target.closest('.heart'); if (!b) return;
    e.preventDefault();
    const on = await favs.toggle(b.dataset.id);
    on ? fv.add(b.dataset.id) : fv.delete(b.dataset.id);
    // كل قلوب المسلسل نفسه في الصفحة تتحدث معًا
    view.querySelectorAll('.heart[data-id]').forEach((x) => { if (x.dataset.id === b.dataset.id) { x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); } });
    pop(b);
    if (after) after();
  };
}

// ---------- المفضلة ----------
async function vFavs() {
  const fv = new Set((await favs.all()).map((f) => f.showId));
  const draw = () => {
    const list = D.shows.filter((s) => fv.has(s.id));
    view.innerHTML = demoBanner() + (list.length ? `<div class="grid">${list.map((s) => cardHtml(s, fv)).join('')}</div>` : '<div class="empty">لم تضف أي مسلسل بعد.<br>اضغط على القلب في أي مسلسل لإضافته.</div>');
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
    <div class="actions"><button id="fav" class="favbtn ${fv ? 'on' : ''}">${HEART}<span>${fv ? 'في المفضلة' : 'أضف للمفضلة'}</span></button></div></div></div>
    <div class="actions">${cont ? `<a style="flex:1" href="#/watch/${encodeURIComponent(id)}/${encodeURIComponent(cont.id)}"><button class="pri" style="width:100%">${last.done ? 'الحلقة التالية ' + cont.n : 'استكمال حلقة ' + cont.n + (last.duration ? ' (' + fmt(last.time) + ')' : '')}</button></a>` : ''}
    ${dlAble.length ? '<button id="dlall">تحميل الكل</button>' : ''}</div>
    <div class="eps">${show.eps.map((e) => { const p = mine.get(e.id); return `<a class="ep ${p ? (p.done ? 'done' : 'part') : ''} ${lastEp && lastEp.id === e.id ? 'last' : ''} ${dl.has(id + '|' + e.id) ? 'dl' : ''}" href="#/watch/${encodeURIComponent(id)}/${encodeURIComponent(e.id)}">${esc(e.n)}</a>`; }).join('')}</div>`;
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

// يحوّل «23:10» أو «1:02:05» أو «23» (دقائق) إلى ثوانٍ؛ يقبل الأرقام العربية.
const parseTime = (s) => {
  s = String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  if (!s) return null;
  const p = s.split(/[:.،,]/).map((x) => x.trim()).filter((x) => x !== '').map(Number);
  if (!p.length || p.length > 3 || p.some((x) => !Number.isFinite(x) || x < 0)) return null;
  return p.length === 1 ? p[0] * 60 : p.reduce((a, x) => a * 60 + x, 0);
};
const ago = (at) => { try { return new Date(at).toLocaleString('ar', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

async function vWatch(showId, epId) {
  const show = D.byId.get(showId), ep = show && findEp(show, epId);
  if (!ep) return (view.innerHTML = '<div class="empty">الحلقة غير موجودة.</div>');
  titleEl.textContent = `${show.title} - حلقة ${ep.n}`;
  const key = showId + '|' + epId;
  // تنقّل سريع: إن تغيّر المسار أثناء الانتظار فهذه صفحة قديمة، تتوقف ولا تلمس الصفحة الجديدة
  const h0 = location.hash, stale = () => location.hash !== h0;
  const [p0, meta, mr] = await Promise.all([progress.get(showId, epId), downloads.getMeta(key), D.demo ? null : loadMailru()]);
  if (stale()) return;
  const next = nextEp(show, ep);
  // سيرفران فقط: Arab HD (مشغّل مضمّن) وcloud.mail.ru (ملف MP4 عام يُشغَّل بمشغّل HTML5)
  const arab = ((ep.sv || []).find((x) => x[0] === 'a') || [])[1];
  const exLink = ((ep.sv || []).find((x) => x[0] === 'e') || [])[1];
  const exPath = exLink && (String(exLink).match(/\/public\/(.+)$/) || [])[1];
  const cmUrl = exPath && mr && mr.base ? `${mr.base}/${exPath}` : null;
  const SRC = [];
  if (meta) SRC.push({ k: 'f', name: 'الملف المحفوظ', video: true });
  if (ep.v) SRC.push({ k: 'v', name: 'مباشر', video: true });
  if (arab) SRC.push({ k: 'a', name: 'Arab HD', video: false });
  if (cmUrl) SRC.push({ k: 'e', name: 'cloud.mail.ru', video: true });
  const dlHref = cmUrl || exLink || null;

  view.innerHTML = `${demoBanner()}<div class="player" id="pl"></div>
    <div class="actions" id="srv"></div>
    <div class="actions" id="act"></div>
    <div class="snaps" id="snaps"></div>
    <div id="msg"></div>
    <div class="note">لا تنسَ حفظ اللقطة قبل الخروج من الصفحة لكي تستطيع الرجوع لها بسهولة.</div>
    <div class="actions">${next ? `<a style="flex:1" href="#/watch/${encodeURIComponent(showId)}/${encodeURIComponent(next.id)}"><button style="width:100%">الحلقة التالية (${esc(next.n)})</button></a>` : ''}<a style="flex:1" href="#/show/${encodeURIComponent(showId)}"><button style="width:100%">كل الحلقات</button></a></div>`;
  const pl = $('#pl'), srv = $('#srv'), act = $('#act'), msg = $('#msg'), snapsEl = $('#snaps');
  const setDone = async (done) => { await progress.save(showId, ep, { done, ...(done ? {} : { time: 0 }) }); toast(done ? 'تم وضع علامة ✓' : 'أُعيدت الحلقة للبداية'); route(); };
  if (!p0) await progress.save(showId, ep, { done: false });
  if (stale()) return;

  let cur = null, curV = null, teardown = null, blobUrl = null;
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
  const mountArab = () => {
    pl.innerHTML = `<iframe src="${esc(`https://arabhd.onl/embed-${arab}.html`)}" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  };
  const drawSrv = () => {
    srv.innerHTML = SRC.map((s) => `<button data-k="${s.k}" class="${s.k === cur ? 'pri' : ''}">${esc(s.name)}</button>`).join('');
    srv.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => select(b.dataset.k)));
  };
  const select = async (k, startAt) => {
    stopCur(); msg.innerHTML = ''; cur = k;
    try { if (k === 'a' || k === 'e') localStorage.setItem('df-sv2', k); } catch {}
    drawSrv();
    if (k === 'a') return mountArab();
    if (startAt == null) { const p = await progress.get(showId, epId); if (stale()) return; startAt = p && !p.done ? p.time || 0 : 0; }
    if (k === 'e') return mountVideo(cmUrl, startAt);
    if (k === 'v') return mountVideo(ep.v.src, startAt);
    if (k === 'f') {
      if (!blobUrl) { const b = await downloads.getBlob(key); if (stale()) return; if (!b) { toast('الملف المحفوظ غير موجود'); return; } blobUrl = URL.createObjectURL(b); }
      return mountVideo(blobUrl, startAt);
    }
  };

  // اللقطات: آخر 3 مواضع حفظتها بنفسك (مع وقت الحفظ)
  const drawSnaps = (snaps) => {
    snaps = snaps || [];
    const rb = $('#resume'); if (rb) rb.disabled = !snaps.length;
    snapsEl.innerHTML = snaps.length ? `<div class="snaps-t">آخر اللقطات</div>${snaps.map((s, i) => `<button class="snap" data-i="${i}">⏱ ${fmt(s.t)}<small>${esc(ago(s.at))}</small></button>`).join('')}` : '';
    snapsEl.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => playFrom(snaps[+b.dataset.i].t)));
  };
  const playFrom = (t) => {
    const vk = SRC.some((s) => s.video && s.k === cur) ? cur : (SRC.find((s) => s.k === 'f') || SRC.find((s) => s.k === 'e') || SRC.find((s) => s.k === 'v') || {}).k;
    if (!vk) return toast(`انتقل في المشغّل إلى ${fmt(t)} (Arab HD لا يسمح بالتحكم من التطبيق)`);
    if (curV && cur === vk && curV.duration > 0) { curV.currentTime = t; curV.play().catch(() => {}); toast('تشغيل من ' + fmt(t)); }
    else select(vk, t);
  };
  const saveSnap = async () => {
    let t;
    if (curV && curV.duration > 0) t = curV.currentTime;
    else {
      const s = prompt('مشغّل Arab HD لا يسمح للتطبيق بقراءة الوقت.\nاكتب الدقيقة التي توقفت عندها (مثال 23:10):');
      if (s == null) return;
      t = parseTime(s); if (t == null) return toast('صيغة الوقت غير صحيحة. مثال: 23:10');
    }
    const p = (await progress.get(showId, epId)) || {};
    const snaps = [{ t, at: Date.now(), src: cur }, ...(p.snaps || [])].slice(0, 3);
    await progress.save(showId, ep, { snaps, time: t, done: false });
    toast('حُفظت اللقطة عند ' + fmt(t)); drawSnaps(snaps);
  };
  const exportFile = async () => {
    const b = await downloads.getBlob(key); if (!b) return toast('الملف المحفوظ غير موجود');
    const name = `${show.title} - الحلقة ${ep.n}.mp4`.replace(/[\\/:*?"<>|]/g, ' ');
    const f = new File([b], name, { type: 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); } catch (e) { if (e.name !== 'AbortError') toast('تعذّر الحفظ: ' + e.message); } }
    else { const u = URL.createObjectURL(f); const a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
  };

  act.innerHTML = `${dlHref ? `<a style="flex:1;min-width:120px" href="${esc(dlHref)}" target="_blank" rel="noopener"><button style="width:100%">⬇ تنزيل</button></a>` : ''}
    <button id="snap">احفظ آخر لقطة</button><button id="resume">تشغيل من آخر لقطة</button>
    ${p0 && p0.done ? '<button id="rs">إعادة تشغيلها</button>' : '<button id="ok">تمت المشاهدة ✓</button>'}
    ${meta ? `<button id="exp">حفظ في الملفات</button><button id="rm">حذف الملف المحفوظ (${mb(meta.size)})</button>` : ''}`;
  addImport(act, show, ep, () => route());
  $('#snap').onclick = saveSnap;
  $('#resume').onclick = async () => { const p = await progress.get(showId, epId); const s = p && p.snaps && p.snaps[0]; if (s) playFrom(s.t); };
  const ok = $('#ok'); if (ok) ok.onclick = () => setDone(true);
  const rs = $('#rs'); if (rs) rs.onclick = () => setDone(false);
  const ex = $('#exp'); if (ex) ex.onclick = exportFile;
  const rm = $('#rm'); if (rm) rm.onclick = async () => { stopCur(); await downloads.remove(key); route(); };
  drawSnaps(p0 && p0.snaps);

  if (!SRC.length) {
    // لا سيرفر معروف بعد لهذه الحلقة: زر يفتح صفحة المصدر
    pl.innerHTML = `<a href="${esc(ep.url)}" target="_blank" rel="noopener" id="go" style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:12px;overflow:hidden;background:#000">${(show.img || show.poster) ? `<img src="${esc(asset(show.img2 || show.img) || show.poster)}" referrerpolicy="no-referrer" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.35">` : ''}<span style="position:relative;font-size:64px;line-height:1;color:#fff">▶</span></a>`;
    return;
  }
  let pref = null; try { pref = localStorage.getItem('df-sv2'); } catch {}
  const first = (meta && 'f') || (SRC.some((s) => s.k === pref) && pref) || SRC[0].k;
  select(first);
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
// فحص الحلقات الجديدة كل 5 دقائق، وعند العودة إلى التطبيق
const refresh = async () => { if (document.visibilityState !== 'visible' || !D) return; try { const n = await loadData(true); if (n.updated !== D.updated) { D = n; if (/#\/(new|shows)?$/.test(location.hash) || !location.hash) route(); } } catch {} };
setInterval(refresh, 5 * 60 * 1000);
document.addEventListener('visibilitychange', refresh);

// الأرقام العربية (١٢٣) في كل نص معروض، بلا المساس بالروابط أو القيم.
{
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const conv = (n) => { if (n.nodeType === 3) { if (/\d/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\d/g, (d) => AR[d]); } else if (n.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|INPUT|TEXTAREA)$/.test(n.tagName)) n.childNodes.forEach(conv); };
  const mo = new MutationObserver((ms) => { mo.disconnect(); ms.forEach((m) => (m.type === 'characterData' ? conv(m.target) : m.addedNodes.forEach(conv))); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); });
  conv(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}
