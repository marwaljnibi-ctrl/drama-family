// مكوّنات الواجهة القابلة لإعادة الاستخدام (بلا منطق بيانات). كل الأقسام تبنى منها: بطاقة مسلسل، بطاقة متابعة، صف أفقي، هيكل تحميل، حالة فارغة.
import { asset } from './source.js';
import { favs } from './db.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (t) => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
export const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }

// الصور: النسخة الأوضح (img2، 600px) إن وُجدت، ثم القديمة، ثم رابط المصدر
export const poster = (s, cls = '') => { const src = asset(s.img2 || s.img) || s.poster; return src ? `<img class="${cls}" loading="lazy" referrerpolicy="no-referrer" src="${esc(src)}" alt="">` : `<div class="ph ${cls}"></div>`; };

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
export function continueCard(it) {
  const pct = it.hasMinute ? Math.min(100, (it.time / it.duration) * 100) : 0;
  const line = it.kind === 'next' ? `الحلقة التالية · ${it.ep.n}` : `حلقة ${it.ep.n}${it.hasMinute ? ' · توقفت عند ' + fmt(it.time) : ''}`;
  return `<a class="ccard" href="${watchHref(it.show, it.ep)}">${poster(it.show)}<div class="cm"><b>${esc(it.show.title)}</b><small>${esc(line)}</small>${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}<span class="go">${it.kind === 'next' ? 'شاهد التالية' : 'استكمال'}</span></div></a>`;
}

// قسم بصف أفقي: head = { title, sub?, all? (رابط عرض الكل) }
export const section = (head, inner, cls = '') => `<section class="sec"><div class="sec-h"><h2>${esc(head.title)}</h2>${head.all ? `<a class="all" href="${head.all}">عرض الكل</a>` : ''}</div>${head.sub ? `<p class="sec-s">${esc(head.sub)}</p>` : ''}<div class="rail ${cls}">${inner}</div></section>`;

export const skeletonHome = () => `<div class="sk"><div class="sk-h"></div><div class="rail"><div class="sk-c wide"></div><div class="sk-c wide"></div></div><div class="sk-h"></div><div class="rail">${'<div class="sk-c"></div>'.repeat(4)}</div><div class="sk-h"></div><div class="rail">${'<div class="sk-c"></div>'.repeat(4)}</div></div>`;
export const skeletonGrid = (n = 9) => `<div class="grid sk">${'<div class="sk-c grid-c"></div>'.repeat(n)}</div>`;

export const emptyState = (title, text, cta) => `<div class="empty-card"><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}${cta ? `<a href="${cta.href}"><button class="pri">${esc(cta.label)}</button></a>` : ''}</div>`;
