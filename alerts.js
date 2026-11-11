// تنبيهات واتساب للحلقات الجديدة: واجهة صغيرة فوق Worker (Cloudflare). لا حسابات: كل فرد له رابط خاص يُحفظ رمزه في هذا الجهاز فقط.
// الرمز لا يُرسل إلا في ترويسة Authorization إلى الـWorker، ولا يظهر في الرابط بعد الحفظ.
import { $, esc, toast, emptyState } from './components.js';

export const ALERTS_API = 'https://dizi-alerts.fufuu-crafts.workers.dev';
const KEY = 'df-alert-token';
export const alertToken = () => { try { const t = localStorage.getItem(KEY); return /^[0-9a-f]{32}$/.test(t || '') ? t : ''; } catch { return ''; } };
export const setAlertToken = (t) => { try { if (/^[0-9a-f]{32}$/.test(t || '')) localStorage.setItem(KEY, t); } catch {} };
export const clearAlertToken = () => { try { localStorage.removeItem(KEY); } catch {} };

export async function alertApi(path, body) {
  const r = await fetch(ALERTS_API + path, { method: 'POST', headers: { authorization: 'Bearer ' + alertToken(), 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'http ' + r.status), { status: r.status });
  return j;
}

// صفحة الإعدادات (#/alerts)
export async function renderAlerts(view) {
  if (!alertToken()) { view.innerHTML = emptyState('تنبيهات واتساب', 'افتح رابط التنبيهات الخاص بك (يرسله لك مدير Dizi) لتفعيلها على هذا الجهاز.'); return; }
  view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
  let me;
  try { me = await alertApi('/api/me'); } catch (e) {
    if (e.status === 401) { clearAlertToken(); view.innerHTML = emptyState('الرابط غير صالح', 'هذا الرابط أُلغي أو غير صحيح. اطلب رابطًا جديدًا من مدير Dizi.'); }
    else view.innerHTML = emptyState('تعذّر الاتصال', 'تحقق من الاتصال وأعد المحاولة.');
    return;
  }
  const draw = (m) => {
    view.innerHTML = `<div class="empty-card" style="text-align:right"><b>مرحبًا ${esc(m.name)}</b>
      ${m.consent ? '<p>تنبيهات واتساب مفعّلة. تصلك رسالة عند نزول حلقة جديدة من المسلسلات المحددة أدناه.</p><button id="al-off">سحب الموافقة</button>'
        : '<p>لتصلك رسائل واتساب عن الحلقات الجديدة، اضغط الزر أدناه. تصلك الرسائل على رقمك المسجّل فقط، ويمكنك إيقافها في أي وقت.</p><button class="pri" id="al-on">أوافق على استلام رسائل واتساب</button>'}</div>
      ${m.consent ? `<h3>المسلسلات المحددة</h3>${m.shows.length ? `<div class="list">${m.shows.map((s) => `<div class="row"><div class="m"><b>${esc(s.title)}</b></div><button data-s="${esc(s.showId)}" class="al-rm">إلغاء</button></div>`).join('')}</div>` : '<div class="hint">لم تحدد مسلسلًا بعد. افتح صفحة أي مسلسل واضغط «تنبيه واتساب».</div>'}` : ''}`;
    const on = $('#al-on'), off = $('#al-off');
    if (on) on.onclick = async () => { try { draw(await alertApi('/api/consent', { agree: true })); toast('تم تفعيل الموافقة'); } catch { toast('تعذّر الحفظ'); } };
    if (off) off.onclick = async () => { try { draw(await alertApi('/api/consent', { agree: false })); toast('أُوقفت التنبيهات'); } catch { toast('تعذّر الحفظ'); } };
    view.querySelectorAll('.al-rm').forEach((b) => (b.onclick = async () => { try { draw(await alertApi('/api/shows', { showId: b.dataset.s, on: false })); } catch { toast('تعذّر الحفظ'); } }));
  };
  draw(me);
}

// زر «تنبيه واتساب» في صفحة المسلسل (يظهر فقط إن كان هذا الجهاز مربوطًا برابط تنبيهات)
export async function bindShowAlert(btn, showId, title) {
  if (!btn) return;
  let me = null;
  const paint = () => { const on = !!(me && me.shows.some((s) => s.showId === showId)); btn.classList.toggle('on', on); btn.querySelector('span').textContent = on ? 'التنبيه مفعّل' : 'تنبيه واتساب'; };
  try { me = await alertApi('/api/me'); paint(); } catch { btn.hidden = true; return; }
  btn.onclick = async () => {
    if (!me.consent) { toast('وافق على استلام الرسائل أولًا'); location.hash = '#/alerts'; return; }
    const on = !me.shows.some((s) => s.showId === showId);
    try { me = await alertApi('/api/shows', { showId, title, on }); paint(); toast(on ? 'سيصلك تنبيه عند نزول حلقة جديدة' : 'أُلغي التنبيه'); } catch { toast('تعذّر الحفظ'); }
  };
}
