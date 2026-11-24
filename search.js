// بحث محلي خفيف بلا شبكة: عربي + تركي (إن توفّر show.tr)، يتجاهل الهمزات والتشكيل والتطويل وتاء مربوطة/ياء، ويتسامح مع خطأ حرف واحد، ويرتّب الأدق أولًا.
export const norm = (s = '') => String(s).normalize('NFKD').replace(/[ً-ٰٟـ̀-ͯ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 1776)
  .toLowerCase().replace(/ı/g, 'i').replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter(Boolean);
const bare = (t) => (t.length >= 4 && t.startsWith('ال') ? t.slice(2) : t);   // «الحب» ~ «حب»
const lev1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
const tokScore = (q, t) => { const a = bare(q), b = bare(t); if (a === b) return 3; if (b.startsWith(a)) return 2.2; if (a.length >= 3 && b.includes(a)) return 1.2; if (a.length >= 4 && lev1(a, b)) return 0.9; return 0; };
export function prepare(s) { if (s._k) return s._k; const t = String(s.title || '').replace(/^\s*مسلسل\s+/, ''); const names = [t, s.tr, ...(s.alt || [])].filter(Boolean); return (s._k = { names: names.map(norm), toks: [...names, String(s.title || '')].flatMap(toks) }); }   // «مسلسل» يبقى قابلًا للبحث لكنه لا يؤثر في ترتيب الاسم
export function searchShows(shows, query) {
  const q = norm(query); if (!q) return shows; const qt = q.split(' ').filter(Boolean); const out = [];
  for (const s of shows) {
    const k = prepare(s); let total = 0, ok = true;
    for (const t of qt) { let best = 0; for (const x of k.toks) { const v = tokScore(t, x); if (v > best) best = v; } if (!best) { ok = false; break; } total += best; }
    if (!ok) continue;
    for (const n of k.names) { if (n === q) total += 6; else if (n.startsWith(q)) total += 3; else if (n.includes(q)) total += 1.5; }
    out.push([total, s]);
  }
  return out.sort((a, b) => b[0] - a[0] || String(a[1].title).localeCompare(String(b[1].title), 'ar')).map((x) => x[1]);
}
