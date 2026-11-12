// أدوات الصور المشتركة (مصدر واحد): قاعدة العمودي الدائمة، تقييم الجودة، وبصمة بصرية (dHash) لمقارنة صورتين.
// القاعدة الدائمة: img3 (بوستر البطاقات والقوائم) لا يُعتمد إلا إذا كان عموديًا فعلًا؛ الأفقي لا يدخل img3 أبدًا.
export const PORTRAIT_MIN = 0.55, PORTRAIT_MAX = 0.9;
// نسبة 2:3 المعتمدة في كل الواجهات: كل ما بين STRICT_MIN و STRICT_MAX يُعرض بإطار 2:3 بلا قص يُذكر (≤ ~4%). ما خرج عنها يُقبل فقط إن لم يوجد بديل ضمنها.
export const RATIO = 2 / 3, STRICT_MIN = 0.62, STRICT_MAX = 0.72;
export const strictOk = (w, h) => !!(w && h && w / h >= STRICT_MIN && w / h <= STRICT_MAX);
export const portraitOk = (r) => !!(r && r.status === 'matched' && r.w && r.h && r.w / r.h >= PORTRAIT_MIN && r.w / r.h <= PORTRAIT_MAX && r.path);

// جودة الصورة: دقة، نسبة عمودية/أفقية، حدّة (انحراف معياري لمرشّح لابلاس)، وتعدد الألوان
export async function assess(buf, sharp, { landscape = false } = {}) {
  const m = await sharp(buf).metadata(); const w = m.width || 0, h = m.height || 0, ar = w / (h || 1);
  const st = await sharp(buf).greyscale().resize({ width: 240 }).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 }).stats();
  const full = await sharp(buf).resize({ width: 120 }).stats();
  const sharpV = +st.channels[0].stdev.toFixed(2), ent = +full.entropy.toFixed(2);
  const reasons = [];
  if (w < (landscape ? 900 : 300)) reasons.push('low-res'); if (landscape ? (ar < 1.5 || ar > 2.1) : (ar < PORTRAIT_MIN || ar > PORTRAIT_MAX)) reasons.push('aspect'); if (sharpV < 3) reasons.push('soft'); if (ent < 3.2) reasons.push('flat');
  const score = +(Math.min(w, 1000) / 1000 * 0.45 + Math.min(sharpV / 20, 1) * 0.3 + Math.min(ent / 7.5, 1) * 0.15 + (1 - Math.min(Math.abs(ar - 0.667) / 0.15, 1)) * 0.1).toFixed(3);
  return { w, h, ar: +ar.toFixed(3), sharp: sharpV, ent, score, ok: reasons.length === 0 || (!landscape && reasons.length === 1 && reasons[0] === 'low-res' && w >= 200), reasons };   // دقة 200-299 تُقبل وتُسجَّل low-res للمراجعة
}

// بصمة بصرية 64 بت (فرق التدرجات 9×8): صغيرة الفرق ⇒ الصورتان من نفس اللقطة/الملصق حتى مع اختلاف الحجم والضغط
export async function dhash(buf, sharp) {
  const raw = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer(); let s = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
  return s;
}
export const hamming = (a, b) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++; return n + Math.abs(a.length - b.length); };
