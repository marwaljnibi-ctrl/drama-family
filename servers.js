// سجل السيرفرات المضمّنة. إضافة سيرفر جديد = سطر هنا + Userscript يتكلم بالبروتوكول نفسه (docs/playback-adapter.md). لا تغيير في منطق حفظ التقدم.
// المفتاح = رمز السيرفر في فهرس الحلقة (ep.sv). hint: تنبيه يظهر تحت المشغّل.
export const SERVERS = {
  a: { name: 'Arab HD', origin: 'https://arabhd.onl', url: (id) => `https://arabhd.onl/embed-${id}.html` },
  o: { name: 'OK', origin: 'https://ok.ru', url: (id) => `https://ok.ru/videoembed/${id}`, hint: 'إن لم يظهر الفيديو جرّب Arab HD.' },
  // t: Turk — مؤجل (لا يصل الدومين على شبكتنا حاليًا). يُضاف هنا لاحقًا مع سكربته.
};
