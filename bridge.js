// جسر تقدم Arab HD: يستقبل رسائل postMessage الصادرة من سكربت Userscripts (إن كان مثبتًا) ويحفظ التقدم في سجل Dizi.
// لا يصل Dizi إلى تخزين Userscripts ولا إلى داخل iframe؛ يعتمد فقط على الرسائل التي يرسلها السكربت بنفسه.
// التحقق: المصدر هو نافذة iframe الحالية بالذات، الأصل https://arabhd.onl، وmessage.id = معرّف الحلقة المعروضة، والقيم رقمية معقولة.
export const ARAB_ORIGIN = 'https://arabhd.onl';

export function validExtMessage(e, frameWin, expectedId) {
  const d = e.data;
  if (!frameWin || e.source !== frameWin || e.origin !== ARAB_ORIGIN) return null;
  if (!d || typeof d !== 'object' || d.src !== 'dizi-resume-ext' || d.id !== expectedId) return null;
  if (d.type !== 'time') return null;
  if (!Number.isFinite(d.t) || !Number.isFinite(d.d) || d.d <= 0 || d.t < 3 || d.t > d.d + 1) return null;
  return { t: d.t, d: d.d };
}

export function bindArabProgress({ getFrame, expectedId, onTime }) {
  const h = (e) => { const f = getFrame(); const m = validExtMessage(e, f && f.contentWindow, expectedId); if (m) onTime(m.t, m.d); };
  addEventListener('message', h);
  return () => removeEventListener('message', h);
}
