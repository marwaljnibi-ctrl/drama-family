// Cloudflare Pages Function — للمختبر فقط: Pages لا يحترم Range للملفات الثابتة (يعيد 200 بالملف كاملًا).
// يقدّم ملفات المعاينة نفسها (نفس الأصل) مع دعم Range/206/Content-Range لاختبار التنزيل المتقطع على iPhone.
// مقصور على مجلد lab/ وعلى ملفات صغيرة.
export async function onRequest({ request, env, params }) {
  const path = '/' + [].concat(params.path || []).join('/');
  if (!path.startsWith('/lab/')) return new Response('not found', { status: 404 });
  const asset = await env.ASSETS.fetch(new URL(path, request.url));
  if (!asset.ok) return asset;
  const buf = await asset.arrayBuffer(); const total = buf.byteLength;
  if (total > 50 * 1048576) return new Response('too large for lab', { status: 413 });
  const h = new Headers({ 'content-type': asset.headers.get('content-type') || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!m || (m[1] === '' && m[2] === '')) { h.set('content-length', String(total)); return new Response(buf, { status: 200, headers: h }); }
  let s, e;
  if (m[1] === '') { s = Math.max(0, total - +m[2]); e = total - 1; } else { s = +m[1]; e = m[2] === '' ? total - 1 : Math.min(+m[2], total - 1); }
  if (s > e || s >= total) { h.set('content-range', `bytes */${total}`); return new Response(null, { status: 416, headers: h }); }
  h.set('content-range', `bytes ${s}-${e}/${total}`); h.set('content-length', String(e - s + 1));
  return new Response(buf.slice(s, e + 1), { status: 206, headers: h });
}
