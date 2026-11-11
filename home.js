// الصفحة الرئيسية: متابعة المشاهدة ← مسلسلاتي ← مقترحات ← المسلسلات الجديدة (ثم الحلقات الجديدة كقسم فرعي).
// تعتمد فقط على components/store/recommend. لا بيانات وهمية: كل قسم فارغ يُخفى (إلا عند أول استخدام فتظهر دعوة واضحة).
import { $, esc, poster, section, showCard, continueCard, emptyState, heartClick, skeletonHome } from './components.js';
import { favs, progress } from './db.js';
import { continueItems, myShows, newShows, newEpisodes } from './store.js';
import { recommend } from './recommend.js';
import { latestEpisodes } from './source.js';

export async function renderHome(D, view, { demoBanner = '', quiet = false } = {}) {
  if (!quiet) view.innerHTML = skeletonHome();
  const [cont, mine, favRows, progRows] = await Promise.all([continueItems(D), myShows(D), favs.all(), progress.all()]);
  const fv = new Set(favRows.map((f) => f.showId));
  const latest = latestEpisodes(D);
  const [fresh, epsNew] = [newShows(D), await newEpisodes(D, latest)];
  const rec = recommend({ shows: D.shows, favIds: fv, seenIds: new Set(progRows.map((p) => p.showId)) });
  const parts = [demoBanner];
  const firstRun = !cont.length && !mine.length;

  // 1) متابعة المشاهدة — دائمًا في الأعلى عند وجودها؛ عند أول استخدام تُستبدل بدعوة «اكتشف مسلسلك الأول»
  if (cont.length) parts.push(section({ title: 'متابعة المشاهدة' }, cont.map(continueCard).join(''), 'cont'));
  else parts.push(`<section class="sec first">${emptyState('اكتشف مسلسلك الأول', 'اختر مسلسلًا وابدأ المشاهدة. سيظهر هنا فورًا لتستكمله بضغطة واحدة.', { href: '#/shows', label: 'تصفّح المسلسلات' })}</section>`);

  // 2) مسلسلاتي (المفضلة)
  if (mine.length) parts.push(section({ title: 'مسلسلاتي', all: '#/favs' }, mine.slice(0, 12).map((m) => showCard(m.show, { fav: true, badge: m.hasNew ? 'حلقة جديدة' : '', sub: m.last ? 'آخر ما شاهدته: حلقة ' + m.last.epNum : '' })).join('')));
  else if (!firstRun) parts.push(`<section class="sec"><div class="sec-h"><h2>مسلسلاتي</h2></div><div class="hint">اضغط ♥ على أي مسلسل ليظهر هنا.</div></section>`);

  // 3) مقترحات (شخصية فقط إن توفرت بيانات كافية، وإلا «اكتشف مسلسلات» بلا ادعاء)
  if (rec.items.length) parts.push(section({ title: rec.title, sub: rec.sub }, rec.items.map((s) => showCard(s, { fav: fv.has(s.id) })).join('')));

  // 4) المسلسلات الجديدة (عناوين أُضيفت حديثًا) — ثم الحلقات الجديدة (حلقات لمسلسلات موجودة) كقسم فرعي منفصل
  if (fresh.length) parts.push(section({ title: 'المسلسلات الجديدة', sub: 'عناوين أُضيفت حديثًا' }, fresh.slice(0, 12).map((s) => showCard(s, { fav: fv.has(s.id), badge: 'جديد' })).join('')));
  if (epsNew.length) parts.push(section({ title: 'حلقات جديدة', sub: 'حلقات جديدة لمسلسلات موجودة', all: '#/latest' }, epsNew.map(({ show, ep }) => `<div class="card"><a href="#/watch/${encodeURIComponent(show.id)}/${encodeURIComponent(ep.id)}">${poster(show)}<span class="badge">حلقة ${esc(ep.n)}</span><div class="t">${esc(show.title)}</div></a></div>`).join('')));

  view.innerHTML = parts.join('');
  view.onclick = heartClick(view, fv, () => { const y = scrollY; renderHome(D, view, { demoBanner, quiet: true }).then(() => scrollTo(0, y)); });
}
