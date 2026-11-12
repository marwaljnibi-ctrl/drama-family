// طبقة المصدر: الواجهة تقرأ فقط من هنا. تغيير المصدر لا يمس الواجهة.
// الشكل المتوقع لـ data/shows.json:
// { updated: ISO, source: 'qesset.net', shows: [{ id, title, poster, url,
//   eps: [{ id, n, title, url, ts?, v?: { src, type: 'mp4'|'hls' } }]  // الأحدث أولًا
// }], latest: [{ showId, epId, ts }] }
// المعاينة على pages.dev تقرأ الفهرس الحي وصوره من موقع GitHub Pages (يسمح بالقراءة عبر الأصول)، فتبقى محدّثة كل 5 دقائق.
const BASE_URL = /\.pages\.dev$/.test(location.hostname) ? 'https://marwaljnibi-ctrl.github.io/drama-family/' : '';
export const asset = (p) => (p && !/^(https?:|data:|blob:)/.test(p) ? BASE_URL + p : p);
// أساس روابط التنزيل العامة لـ cloud.mail.ru (يحدّثه المزامن كل 30 دقيقة)
export async function loadMailru() {
  try { const r = await fetch(asset('data/mailru.json'), { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
}
let cache = null;
export async function loadData(force = false) {
  if (cache && !force) return cache;
  const demo = new URLSearchParams(location.search).has('demo');
  const url = demo ? 'data/demo.json' : asset('data/shows.json');
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error('data ' + r.status);
  const d = await r.json();
  d.demo = demo;
  d.byId = new Map(d.shows.map((s) => [s.id, s]));
  cache = d;
  return d;
}
export const findEp = (show, epId) => show.eps.find((e) => e.id === epId);
export function latestEpisodes(d, limit = 60) {
  const list = (d.latest && d.latest.length ? d.latest : d.shows.flatMap((s) => s.eps.slice(0, 1).map((e) => ({ showId: s.id, epId: e.id, ts: e.ts || 0 }))))
    .slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return list.slice(0, limit).map((x) => ({ show: d.byId.get(x.showId), ep: null, epId: x.epId })).filter((x) => x.show)
    .map((x) => ({ ...x, ep: findEp(x.show, x.epId) })).filter((x) => x.ep);
}
