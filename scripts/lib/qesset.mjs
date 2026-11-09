// دوال نقية (بلا شبكة) لتحليل صفحات qesset.net. تُختبر في scripts/test.mjs.

// أنواع السيرفرات: a=Arab HD (arabhd.onl)، t=Turk (arabveturk.com)، o=ok.ru: تُعرض مضمّنة.
// e=Express (رابط عام على cloud.mail.ru): لا يُضمَّن، يُفتح للتنزيل في Safari.
export const SV_KEY = { 'Arab HD': 'a', estream: 't', turk: 't', ok: 'o', express: 'e' };
export const SV_VERSION = 2; // يزيد عند تغيير ما يُستخرج، فتُعاد دراسة الحلقات القديمة تدريجيًا
const ID_RE = /^[\w-]{4,40}$/;
const MAILRU_RE = /^https:\/\/cloud\.mail\.ru\/public\/[\w\-\/]{3,80}$/;

/** يستخرج قائمة [نوع، معرّف] من رابط «تشغيل» (qesen.net/watch/?post=<base64 JSON>) في صفحة الحلقة. null إن لم يوجد الرابط. */
export function parseServers(html) {
  const m = html.match(/qesen\.net\/watch\/?\?post=([^"'&\s<]+)/);
  if (!m) return null;
  try {
    const j = JSON.parse(Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8'));
    return (j.servers || [])
      .map((s) => [SV_KEY[s.name], String(s.id || '').replace(/\\\//g, '/')])
      .filter(([k, id]) => k && (k === 'e' ? MAILRU_RE.test(id) : ID_RE.test(id)));
  } catch { return null; }
}

/** مفتاح «سلسلة» الحلقة: المعرّف بعد حذف رقم الحلقة. حلقات المسلسل الواحد تشترك فيه غالبًا (وقد يتعدد للمسلسل الواحد). */
export const epKey = (id) => { let s = String(id); try { s = decodeURIComponent(s); } catch {} return s.replace(/\/$/, '').replace(/(-episode)?-\d+$/, ''); };

/** خريطة مفتاح الحلقة -> معرّف المسلسل من الفهرس المعروف. المفتاح المشترك بين مسلسلين يُلغى (غامض). */
export function buildKeyMap(shows) {
  const map = new Map();
  for (const s of shows) for (const e of s.eps) {
    const k = epKey(e.id);
    if (!map.has(k)) map.set(k, s.id); else if (map.get(k) !== s.id) map.set(k, null);
  }
  return map;
}

/** حلقات صفحة «آخر الحلقات» بترتيب ظهورها، بغض النظر عن شكل الرابط (إنجليزي أو عربي). */
export function parseLatest(html, abs, slugOf) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(/href="([^"]*\/clarus\/[^"?#]+)/g)) {
    const url = abs(m[1]), id = slugOf(url);
    if (!seen.has(id)) { seen.add(id); out.push({ id, url }); }
  }
  return out;
}

/** ربط حلقة بمسلسلها: عبر المفتاح، وإلا عبر روابط «الحلقات الأخرى» داخل صفحتها (siblingIds). */
export function resolveShowOf(epId, keyMap, idToShow, siblingIds = []) {
  const byKey = keyMap.get(epKey(epId));
  if (byKey) return byKey;
  for (const sid of siblingIds) if (idToShow.has(sid)) return idToShow.get(sid);
  return null;
}
