// محرك التوصيات (خفيف، مجاني، بلا API). مدخلاته: الفهرس + مفضلة العائلة + ما شوهد. ذوق العائلة واحد مشترك.
// الحقيقة المهمة: الفهرس الحالي لا يحتوي تصنيفات ولا وصفًا ولا سنة، لذلك لا توجد توصيات «شخصية» موثوقة بعد.
// - mode 'personal': يعمل فقط إذا وُجدت تصنيفات (show.genres: string[]) لأغلب المسلسلات؛ تشابه Jaccard مع ما أحببنا وشاهدنا.
// - mode 'discover': البديل الصادق الآن: مسلسلات لم نشاهدها ولم نضفها، بتدوير يومي ثابت، دون ادعاء أنها مبنية على الذوق.
// البيانات المطلوبة لتحسينه لاحقًا موثقة في docs/recommendations-data.md؛ إضافتها للفهرس تفعّل الوضع الشخصي بلا تغيير في الواجهة.
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; A.forEach((x) => B.has(x) && i++); const u = A.size + B.size - i; return u ? i / u : 0; };

export function recommend({ shows, favIds, seenIds, limit = 12, day = Math.floor(Date.now() / 864e5) }) {
  const excluded = new Set([...favIds, ...seenIds]);
  const pool = shows.filter((s) => !excluded.has(s.id) && s.eps && s.eps.length);
  const withGenres = shows.filter((s) => Array.isArray(s.genres) && s.genres.length).length;
  const taste = shows.filter((s) => (favIds.has(s.id) || seenIds.has(s.id)) && Array.isArray(s.genres) && s.genres.length).flatMap((s) => s.genres);
  if (shows.length && withGenres / shows.length >= 0.6 && taste.length) {
    const items = pool.filter((s) => Array.isArray(s.genres) && s.genres.length)
      .map((s) => ({ s, score: jaccard(s.genres, taste) })).filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id)).slice(0, limit).map((x) => x.s);
    if (items.length >= 3) return { mode: 'personal', title: 'مقترحات حسب ذوقك', sub: 'بحسب تصنيفات ما أحببتموه وشاهدتموه', items };
  }
  const items = pool.slice().sort((a, b) => hash(day + ':' + a.id) - hash(day + ':' + b.id)).slice(0, limit);
  return { mode: 'discover', title: 'اكتشف مسلسلات', sub: 'مسلسلات لم تشاهدوها بعد', items };
}
