// منطق نقي (بلا شبكة ولا تخزين) لنظام تنبيهات واتساب. يُختبر بـ node --test في worker/test.
export const E164 = /^\+[1-9]\d{7,14}$/;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
export const newToken = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); };   // 128 بت: رابط خاص لكل فرد

// آخر قائمة «latest» من نهاية shows.json (طلب Range صغير): [{showId, epId, ts}]. null إن لم توجد.
export function parseLatestTail(text) {
  const i = text.lastIndexOf('"latest":[');
  if (i < 0) return null;
  const j = text.indexOf(']', i);
  if (j < 0) return null;
  try { const a = JSON.parse(text.slice(i + 9, j + 1)); return a.filter((x) => x && typeof x.showId === 'string' && typeof x.epId === 'string'); } catch { return null; }
}
export const epNum = (epId) => { const m = String(epId).match(/-episode-(\d+)\/?$/) || String(epId).match(/(\d+)\/?$/); return m ? +m[1] : null; };

// الحلقات الجديدة = ما في latest ولم يُرَ من قبل. seen يُقتطع إلى آخر 400 معرّف.
export function detectNew(latest, seen) {
  const s = new Set(seen);
  const fresh = latest.filter((x) => !s.has(x.epId));
  return { fresh, seen: [...seen, ...fresh.map((x) => x.epId)].slice(-400) };
}

// هل نضع حلقة جديدة في طابور عضو؟ يشترط: الإرسال مفعّل، موافقة صريحة، اشتراك فعّال بهذا المسلسل.
export function shouldEnqueue({ member, ep, enabled }) {
  if (!enabled || !member || !member.consent || !member.consent.at) return false;
  const sub = member.shows && member.shows[ep.showId];
  return !!(sub && sub.on);
}
// قبل كل إرسال: نعيد التحقق (إلغاء الاشتراك أو سحب الموافقة أو تعطيل الإرسال يوقف الرسالة المعلقة فورًا)
export const stillWanted = shouldEnqueue;

// أرقام لاتينية فقط في رسائل واتساب (عنوان المصدر قد يحوي ٠-٩)
const latin = (s) => String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) & 15);
export function messageText({ title, n, link }) {
  return ['🔔 حلقة جديدة', latin(title + (n ? ' - الحلقة ' + n : '')), 'شاهدها في Dizi:', link].join('\n');
}
export const watchLink = (base, showId, epId) => base.replace(/\/?$/, '/') + '#/watch/' + encodeURIComponent(showId) + '/' + encodeURIComponent(epId);
export const validShowId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 160 && !/[\s"<>\\]/.test(s);
