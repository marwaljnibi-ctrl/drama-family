// مكوّنات الواجهة القابلة لإعادة الاستخدام (بلا منطق بيانات). كل الأقسام تبنى منها: بطاقة مسلسل، بطاقة متابعة، صف أفقي، هيكل تحميل، حالة فارغة.
import { asset } from './source.js';
import { favs } from './db.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (t) => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
export const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
// نافذة تأكيد سفلية بخيارين «تأكيد» و«إلغاء» (الإلغاء هو الافتراضي والأبرز للأمان). تُحلّ true فقط عند التأكيد؛ أي إغلاق آخر = إلغاء.
export function confirmSheet({ title, text = '', ok = 'تأكيد', danger = false }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}<div class="sheet-btns"><button class="${danger ? 'danger' : 'pri'}" data-ok>${esc(ok)}</button><button data-no>إلغاء</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey); bg.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    bg.onclick = (e) => { if (e.target === bg) done(false); };
    bg.querySelector('[data-ok]').onclick = () => done(true); bg.querySelector('[data-no]').onclick = () => done(false);
    document.addEventListener('keydown', onKey); document.body.append(bg); bg.querySelector('[data-no]').focus();
  });
}
export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }

// الصور: النسخة الأوضح (img2، 600px) إن وُجدت، ثم القديمة، ثم رابط المصدر
// img3 = بوستر عمودي مُختار آليًا (TMDB/TVmaze) إن وُجد؛ وإلا الصورة الأصلية (img2 بانر أفقي، img مصغّرة). wide=true للبطاقات الأفقية (بانر المصدر يناسبها).
// Poster = عمودي (img3 مُتحقَّق من أبعاده عند الاختيار). Backdrop = أفقي: img4 (16:9 سينمائي) ثم بانر المصدر img2. wide=true يطلب الأفقي (بطاقات المتابعة الأفقية).
// القاعدة الدائمة: أي صورة داخل بطاقة/صف عمودي يجب أن تكون Poster عموديًا (img3 مُتحقَّق من أبعاده في نظام اختيار الصور).
// لا تُستعمل الصور الأفقية (img2/img4/img) في الإطارات العمودية أبدًا؛ إن لم يوجد بوستر عمودي يظهر غلاف بعنوان المسلسل.
// الأفقية (wide=true) للبطاقات الأفقية والـHero وصفحة التفاصيل فقط.
export const posterUrl = (s, wide = false) => (wide ? asset(s.img4 || s.img2 || s.img) || s.poster || '' : asset(s.img3) || '');
export const backdropUrl = (s) => asset(s.img4 || s.img2 || s.img) || s.poster || '';
const hue = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
export const heroArt = (s) => { const a = asset(s.img4); if (a) return { mode: 'land', src: a }; const p = asset(s.img3); if (p) return { mode: 'poster', src: p }; return { mode: 'banner', src: asset(s.img2 || s.img) || s.poster || '' }; };
export const poster = (s, cls = '', wide = false) => {
  const src = posterUrl(s, wide), t = `<i class="ph-t">${esc(s.title || '')}</i>`;
  if (!src) return `<span class="pw pw-ph${wide ? ' pw-wide' : ''}" style="--h:${hue(s.id)}">${t}</span>`;   // لا بوستر عمودي: غلاف بعنوان المسلسل
  return `<span class="pw${wide ? ' pw-wide' : ''}" style="--bd:url(${esc(src)});--h:${hue(s.id)}"><img class="${cls}" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(src)}" alt="">${t}</span>`;
};

// قلب المفضلة موحّد في كل الصفحات: أيقونة Lucide Heart، فارغ رمادي، ممتلئ عنابي، مع نبضة عند الضغط
export const HEART = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
export const heartBtn = (id, on) => `<button class="heart ${on ? 'on' : ''}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="مفضلة">${HEART}</button>`;
export const pop = (el) => { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); };

// نقر القلب: يبدّل المفضلة (القاعدة الوحيدة: db.favs) ويزامن كل قلوب المسلسل نفسه في الصفحة
export function heartClick(root, fv, after) {
  return async (e) => {
    const b = e.target.closest('.heart'); if (!b) return;
    e.preventDefault();
    const on = await favs.toggle(b.dataset.id);
    on ? fv.add(b.dataset.id) : fv.delete(b.dataset.id);
    root.querySelectorAll('.heart[data-id]').forEach((x) => { if (x.dataset.id === b.dataset.id) { x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); } });
    pop(b);
    if (after) after(b.dataset.id, on);
  };
}

const showHref = (s) => `#/show/${encodeURIComponent(s.id)}`;
const watchHref = (s, e) => `#/watch/${encodeURIComponent(s.id)}/${encodeURIComponent(e.id)}`;

// بطاقة مسلسل عمودية: o = { fav, badge?, sub? }
export const showCard = (s, o = {}) => `<div class="card"><a href="${showHref(s)}">${poster(s)}${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ''}<div class="t">${esc(s.title)}</div>${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}</a>${heartBtn(s.id, !!o.fav)}</div>`;

// بطاقة متابعة: item = { show, ep (الحلقة المستهدفة), kind: 'continue'|'next', hasMinute, time, duration, epNum }
// الدقيقة والشريط يظهران فقط حين تكون القيم مثبتة (duration > 0)؛ لا تخمين.
// بطل «حلقة جديدة» لمن لم يبدأ مشاهدة: it = { show, ep }
export function newHero(it) {
  const { mode, src } = heroArt(it.show);
  return `<a class="hero-c hero-new m-${mode}" href="${watchHref(it.show, it.ep)}" style="--bd:url(${esc(src)})">${src ? `<img class="hero-art" loading="eager" fetchpriority="high" decoding="async" referrerpolicy="no-referrer" src="${esc(src)}" alt="">` : '<div class="hero-art ph"></div>'}<div class="cm"><b>${esc(it.show.title)}</b><small>الحلقة ${esc(it.ep.n)}</small><span class="go">شاهد الآن</span></div></a>`;
}
export function continueCard(it, hero = false) {
  const pct = it.hasMinute ? Math.min(100, (it.time / it.duration) * 100) : 0;
  const line = it.kind === 'next' ? `الحلقة التالية · ${it.ep.n}` : `حلقة ${it.ep.n}${it.hasMinute ? ' · توقفت عند ' + fmt(it.time) : ''}`;
  const art = hero ? heroArt(it.show) : null;
  const pic = hero ? (art.src ? `<img class="hero-art" loading="eager" fetchpriority="high" decoding="async" referrerpolicy="no-referrer" src="${esc(art.src)}" alt="">` : '<div class="hero-art ph"></div>') : poster(it.show, '', true);
  return `<a class="ccard${hero ? ' hero-c m-' + art.mode : ''}"${hero ? ` style="--bd:url(${esc(art.src)})"` : ''} href="${watchHref(it.show, it.ep)}">${pic}<div class="cm"><b>${esc(it.show.title)}</b><small>${esc(line)}</small>${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}<span class="go">${it.kind === 'next' ? 'شاهد التالية' : 'متابعة المشاهدة'}</span></div></a>`;
}

// قسم بصف أفقي: head = { title, sub?, all? (رابط عرض الكل) }
// الصور الأولى في كل صف تُحمَّل فورًا (التحميل الكسول داخل صفوف أفقية قد يتأخر على Safari)، والباقي كسول
const eager = (html) => { let n = 0; return html.replace(/loading="lazy"/g, (m) => (n++ < 6 ? 'loading="eager"' : m)); };
export const section = (head, inner, cls = '') => `<section class="sec"><div class="sec-h"><h2>${esc(head.title)}</h2>${head.all ? `<a class="all" href="${head.all}">عرض الكل</a>` : ''}</div>${head.sub ? `<p class="sec-s">${esc(head.sub)}</p>` : ''}<div class="rail ${cls}">${eager(inner)}</div></section>`;

export const skeletonHome = () => `<div class="sk"><div class="sk-c sk-hero"></div><div class="sk-h"></div><div class="rail"><div class="sk-c wide"></div><div class="sk-c wide"></div></div><div class="sk-h"></div><div class="rail">${'<div class="sk-c"></div>'.repeat(4)}</div><div class="sk-h"></div><div class="rail">${'<div class="sk-c"></div>'.repeat(4)}</div></div>`;
export const skeletonGrid = (n = 9) => `<div class="grid sk">${'<div class="sk-c grid-c"></div>'.repeat(n)}</div>`;

export const emptyState = (title, text, cta) => `<div class="empty-card"><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}${cta ? `<a href="${cta.href}"><button class="pri">${esc(cta.label)}</button></a>` : ''}</div>`;
