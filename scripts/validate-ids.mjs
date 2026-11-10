// يفحص صلاحية معرّفات المسلسلات والحلقات لربط ملفات بها لاحقًا (قراءة فقط، لا يعدّل الفهرس).
// الاستخدام: node scripts/validate-ids.mjs [data/shows.json]
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(process.argv[2] || 'data/shows.json', 'utf8'));
const bad = {}; const note = (k, v) => (bad[k] ||= []).push(v);
const showIds = new Set(), epIds = new Map(), keys = new Set();
let eps = 0, maxKey = 0;
for (const s of d.shows) {
  if (!s.id || typeof s.id !== 'string') note('show-without-id', s.title);
  if (showIds.has(s.id)) note('dup-show-id', s.id); showIds.add(s.id);
  if (/[|\/\?#\s]/.test(s.id)) note('show-id-unsafe-chars', s.id);
  const ns = new Map();
  for (const e of s.eps) {
    eps++;
    if (!e.id || typeof e.id !== 'string') { note('ep-without-id', s.id); continue; }
    if (epIds.has(e.id)) note('dup-ep-id-global', `${e.id} in ${epIds.get(e.id)} & ${s.id}`); epIds.set(e.id, s.id);
    if (/[|\/\?#\s]/.test(e.id)) note('ep-id-unsafe-chars', e.id);
    if (!Number.isInteger(e.n) || e.n < 0) note('ep-n-invalid', `${s.id}/${e.id}:${e.n}`);
    if (ns.has(e.n)) note('dup-ep-number-in-show', `${s.id}: ${e.n} (${ns.get(e.n)} & ${e.id})`); ns.set(e.n, e.id);
    const k = s.id + '|' + e.id; if (keys.has(k)) note('dup-key', k); keys.add(k); maxKey = Math.max(maxKey, k.length);
    if (!e.url) note('ep-without-url', e.id);
  }
}
console.log(JSON.stringify({ shows: showIds.size, eps, keys: keys.size, maxKeyLen: maxKey, problems: Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 4) }])) }, null, 1));
