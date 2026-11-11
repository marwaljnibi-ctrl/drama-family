// حسابي وتنبيهات واتساب: واجهة صغيرة فوق الـWorker. الدخول بحساب Google (جلسة)، والرقم لا يُعرض كاملًا أبدًا.
import { $, esc, toast } from './components.js';
import { authApi, getSession, logout } from './auth.js';

export const alertApi = authApi;
export const signedIn = () => !!getSession();

const ERR = { 'consent required': 'يلزم الموافقة أولًا', 'bad phone': 'اكتب الرقم بصيغة دولية مثل ‎+9715XXXXXXXX', 'phone in use': 'هذا الرقم مرتبط بحساب آخر', 'too many requests': 'محاولات كثيرة، جرّب بعد قليل', 'send failed': 'تعذّر إرسال الرمز، جرّب لاحقًا', expired: 'انتهت صلاحية الرمز، اطلب رمزًا جديدًا', 'wrong code': 'الرمز غير صحيح', 'too many attempts': 'محاولات كثيرة، اطلب رمزًا جديدًا' };
const errMsg = (e) => ERR[e.message] || 'تعذّر الحفظ';

// صفحة حسابي (#/alerts)
export async function renderAlerts(view) {
  if (!signedIn()) { view.innerHTML = '<div class="empty">سجّل الدخول أولًا.</div>'; return; }
  view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
  let me;
  try { me = await authApi('/api/profile'); } catch { view.innerHTML = '<div class="empty">تعذّر الاتصال. تحقق من الاتصال وأعد المحاولة.</div>'; return; }
  let step = 'form';   // form | code
  const draw = (m) => {
    me = m; const w = m.wa;
    let wa;
    if (w.verified && w.consent) wa = `<p>تنبيهات واتساب <b>مفعّلة</b> على الرقم ${esc(w.phone)}. تصلك رسالة فقط عند نزول حلقة جديدة من المسلسلات التي تفعّل جرسها.</p><button id="al-stop">إيقاف جميع تنبيهات واتساب</button>`;
    else if (w.verified) wa = `<p>التنبيهات <b>متوقفة</b>. رقمك ${esc(w.phone)} محفوظ ولن تصلك أي رسالة.</p><button class="pri" id="al-resume">إعادة تشغيل التنبيهات</button>`;
    else if (step === 'code') wa = `<p>أرسلنا رمزًا من 6 أرقام إلى واتساب. اكتبه هنا:</p><input id="al-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" style="text-align:center;font-size:20px;width:100%;box-sizing:border-box"><div class="actions"><button class="pri" id="al-verify">تأكيد</button><button id="al-back">تغيير الرقم</button></div>`;
    else wa = `<p>أضف رقم واتساب لتصلك رسالة عند نزول حلقة جديدة. سنرسل لك رمز تحقق للتأكد أن الرقم لك.</p><input id="al-phone" type="tel" inputmode="tel" placeholder="+9715XXXXXXXX" dir="ltr" style="width:100%;box-sizing:border-box;margin-bottom:8px"><label style="display:flex;gap:8px;align-items:flex-start;text-align:right;margin-bottom:10px"><input type="checkbox" id="al-agree"><span>أوافق على استلام رسائل واتساب من Dizi عن الحلقات الجديدة، وأعرف أنني أستطيع إيقافها في أي وقت.</span></label><button class="pri" id="al-send">إرسال رمز التحقق</button>`;
    view.innerHTML = `<div class="empty-card" style="text-align:right"><b>مرحبًا ${esc(m.name)}</b><p style="margin:0">${esc(m.email)}</p></div>
      <div class="empty-card" style="text-align:right;margin-top:12px"><b>تنبيهات واتساب</b>${wa}</div>
      ${w.verified && w.consent ? `<h3>المسلسلات التي تصلك تنبيهاتها</h3>${m.shows.length ? `<div class="list">${m.shows.map((s) => `<div class="row"><div class="m"><b>${esc(s.title)}</b></div><button data-s="${esc(s.showId)}" class="al-rm">إلغاء</button></div>`).join('')}</div>` : '<div class="hint">لم تحدد مسلسلًا بعد. افتح صفحة أي مسلسل واضغط زر الجرس 🔔.</div>'}` : ''}
      <div style="margin-top:20px;text-align:center"><button id="al-logout">تسجيل الخروج</button></div>`;
    const run = (id, fn) => { const b = $(id); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { toast(errMsg(e)); b.disabled = false; } }; };
    run('#al-send', async () => { const phone = $('#al-phone').value.replace(/[\s-]/g, ''); if (!$('#al-agree').checked) { toast('يلزم الموافقة أولًا'); $('#al-send').disabled = false; return; } await authApi('/api/wa/phone', { phone, agree: true }); step = 'code'; toast('أُرسل الرمز'); draw(me); });
    run('#al-verify', async () => { draw(await authApi('/api/wa/verify', { code: $('#al-code').value.trim() })); toast('تم تفعيل التنبيهات'); });
    run('#al-back', async () => { step = 'form'; draw(me); });
    run('#al-stop', async () => { draw(await authApi('/api/wa/stop')); toast('أُوقفت جميع التنبيهات'); });
    run('#al-resume', async () => { draw(await authApi('/api/wa/resume')); toast('أُعيد تشغيل التنبيهات'); });
    run('#al-logout', async () => { await logout(); });
    view.querySelectorAll('.al-rm').forEach((b) => (b.onclick = async () => { try { draw(await authApi('/api/shows', { showId: b.dataset.s, on: false })); } catch { toast('تعذّر الحفظ'); } }));
  };
  draw(me);
}

// سؤال أول دخول (مرة واحدة فقط): يُحفظ الجواب في الحساب فلا يتكرر على أي جهاز
export function askOnboarding(profile, go) {
  if (!profile || profile.wa.prompt) return;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50;display:flex;align-items:flex-end;justify-content:center;padding:16px';
  d.innerHTML = '<div class="empty-card" style="background:var(--surface,#fff);max-width:420px;width:100%"><b>هل تريد تلقي إشعارات الحلقات الجديدة عبر واتساب؟</b><p>تصلك رسالة فقط عند نزول حلقة جديدة، ويمكنك الإيقاف في أي وقت.</p><div class="actions" style="justify-content:center"><button class="pri" id="ob-y">نعم</button><button id="ob-n">ليس الآن</button></div></div>';
  document.body.append(d);
  const answer = async (a) => { d.remove(); try { await authApi('/api/wa/prompt', { answer: a }); } catch {} if (a === 'yes') go(); };
  d.querySelector('#ob-y').onclick = () => answer('yes'); d.querySelector('#ob-n').onclick = () => answer('no');
}

// زر الجرس في صفحة المسلسل (يظهر لكل حساب مسجّل)
export async function bindShowAlert(btn, showId, title) {
  if (!btn) return;
  if (!signedIn()) { btn.onclick = () => { toast('سجّل الدخول أولًا لتفعيل التنبيهات'); location.hash = '#/login'; }; return; }
  let me = null;
  const paint = () => { const on = !!(me && me.shows.some((s) => s.showId === showId)); btn.classList.toggle('on', on); btn.querySelector('span').textContent = on ? 'التنبيه مفعّل' : 'تنبيه واتساب'; };
  try { me = await authApi('/api/profile'); paint(); } catch { btn.hidden = true; return; }
  btn.onclick = async () => {
    if (!(me.wa.verified && me.wa.consent)) { toast('فعّل واتساب أولًا من حسابي'); location.hash = '#/alerts'; return; }
    const on = !me.shows.some((s) => s.showId === showId);
    try { me = await authApi('/api/shows', { showId, title, on }); paint(); toast(on ? 'سيصلك تنبيه عند نزول حلقة جديدة' : 'أُلغي التنبيه'); } catch { toast('تعذّر الحفظ'); }
  };
}
