// جسر تقدم Arab HD: يستقبل رسائل postMessage الصادرة من سكربت Userscripts (إن كان مثبتًا) ويحفظ التقدم في سجل Dizi.
// لا يصل Dizi إلى تخزين Userscripts ولا إلى داخل iframe؛ يعتمد فقط على الرسائل التي يرسلها السكربت بنفسه.
// التحقق: المصدر هو نافذة iframe الحالية بالذات، الأصل https://arabhd.onl، وmessage.id = معرّف الحلقة المعروضة، والقيم رقمية معقولة.
export const ARAB_ORIGIN = 'https://arabhd.onl';
export const OK_ORIGIN = 'https://ok.ru';

export function validExtMessage(e, frameWin, expectedId, origin = ARAB_ORIGIN) {
  const d = e.data;
  if (!frameWin || e.source !== frameWin || e.origin !== origin) return null;
  if (!d || typeof d !== 'object' || d.src !== 'dizi-resume-ext' || d.id !== expectedId) return null;
  if (d.type !== 'time') return null;
  if (!Number.isFinite(d.t) || !Number.isFinite(d.d) || d.d <= 0 || d.t < 3 || d.t > d.d + 1) return null;
  return { t: d.t, d: d.d };
}

export function bindArabProgress({ getFrame, expectedId, onTime, origin = ARAB_ORIGIN }) {
  const h = (e) => { const f = getFrame(); const m = validExtMessage(e, f && f.contentWindow, expectedId, origin); if (m) onTime(m.t, m.d); };
  addEventListener('message', h);
  return () => removeEventListener('message', h);
}

// رسائل السكربت إلى Dizi (hello/found = جاهز، time = تقدم) بعد التحقق من الإطار والأصل ومعرّف الفيديو
export function validClientMessage(e, frameWin, expectedId, origin) {
  const d = e.data;
  if (!frameWin || e.source !== frameWin || e.origin !== origin) return null;
  if (!d || typeof d !== 'object' || d.src !== 'dizi-resume-ext' || d.id !== expectedId) return null;
  if (d.type === 'hello' || d.type === 'found') return { type: 'ready' };
  if (d.type === 'time' && Number.isFinite(d.t) && Number.isFinite(d.d) && d.d > 0 && d.t >= 3 && d.t <= d.d + 1) return { type: 'time', t: d.t, d: d.d };
  return null;
}
// Playback Adapter موحّد (getCurrentTime / seekTo / onProgress / onReady) فوق postMessage. أي سيرفر مضمّن جديد يستعمله كما هو.
export function embedAdapter({ getFrame, origin, id }) {
  let last = 0, lastD = 0; const prog = [], ready = [];
  const h = (e) => {
    const f = getFrame(); const m = validClientMessage(e, f && f.contentWindow, id, origin); if (!m) return;
    if (m.type === 'ready') ready.forEach((fn) => fn()); else { last = m.t; lastD = m.d; prog.forEach((fn) => fn(m.t, m.d)); }
  };
  addEventListener('message', h);
  return {
    getCurrentTime: () => last, getDuration: () => lastD,
    seekTo: (t, d) => { const f = getFrame(); if (f && f.contentWindow) f.contentWindow.postMessage({ src: 'dizi-resume-host', v: 1, type: 'seek', id, t: t || null, d: d || null }, origin); },
    onProgress: (fn) => prog.push(fn), onReady: (fn) => ready.push(fn),
    destroy: () => removeEventListener('message', h),
  };
}
