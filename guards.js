// حمايتان صغيرتان (دوال نقية قابلة للاختبار):
// 1) acceptTime: يمنع كاتبًا آخر نشطًا (تبويب آخر أو كاتب قديم متأخر) من خفض تقدم أحدث بكثير، دون منع الرجوع المتعمد.
// 2) canReloadNow: لا إعادة تحميل تلقائية أثناء مشاهدة الفيديو.
export const SESSION = Math.random().toString(36).slice(2);   // معرّف هذه الصفحة؛ يُكتب مع كل تقدم (sid)
const STALE_MS = 60000, DROP = 15, CONT_MS = 12000;

// cur: السجل الحالي، time: الوقت المطلوب كتابته، sid: جلسة الكاتب، rej: خريطة (key -> {t, at}) لآخر كتابة رُفضت من هذه الجلسة
// القواعد: نفس الجلسة = مسموح دائمًا (رجوع متعمد). سجل بلا sid أو كاتبه خامل منذ 60 ث = مسموح. انخفاض أقل من 15 ث = مسموح.
// وإلا نرفض الكتابة المنفردة، لكن إن تبعتها كتابة متسقة من الجلسة نفسها خلال 12 ث (استمرار مشاهدة من الموضع الجديد) نقبلها: رجوع متعمد.
export function acceptTime({ cur, time, sid, now = Date.now(), rej }) {
  if (!cur || typeof time !== 'number' || !Number.isFinite(time)) return { ok: true };
  if (!cur.sid || cur.sid === sid) return { ok: true };
  if (now - (cur.updated || 0) >= STALE_MS) return { ok: true };
  if (!(cur.time - time > DROP)) return { ok: true };
  const r = rej && rej.get(cur.key);
  if (r && now - r.at < CONT_MS && time >= r.t - 1 && time - r.t < 20) return { ok: true, deliberate: true };
  return { ok: false, remember: { t: time, at: now } };
}

// إعادة التحميل التلقائي (عند وصول نسخة جديدة) مؤجلة أثناء صفحة المشاهدة أو أي فيديو يعمل
export const canReloadNow = (hash, playing) => !/^#\/watch/.test(hash || '') && !playing;
