// فحص صغير ومحدود (آخر 30 حلقة فقط): أسماء السيرفرات الخام في qesen post، لمعرفة كيف يظهر Dailymotion. لا يكتب شيئًا.
const BASE = 'https://qesset.net', UA = 'DramaFamilyBot/1.0 (+personal family PWA; low-rate; respects robots.txt)';
const get = async (u) => { const r = await fetch(u.startsWith('http') ? u : BASE + u, { headers: { 'user-agent': UA, 'accept-language': 'ar' } }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latest = await get('/son-bolumler/');
const eps = [...new Set([...latest.matchAll(/href="([^"]*\/clarus\/[^"?#]+)/g)].map((m) => m[1]))].slice(0, 30);
const names = {}, daily = [];
for (const u of eps) {
  try {
    const html = await get(u); const m = html.match(/qesen\.net\/watch\/?\?post=([^"'&\s<]+)/);
    if (!m) continue;
    const j = JSON.parse(Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8'));
    for (const s of j.servers || []) { names[s.name] = (names[s.name] || 0) + 1; if (/daily|dm|dai/i.test(s.name + ' ' + s.id)) daily.push({ ep: u.split('/').filter(Boolean).pop(), name: s.name, id: String(s.id).slice(0, 60), keys: Object.keys(s).join(',') }); }
  } catch (e) { console.log('ERR', u, e.message); }
  await sleep(700);
}
console.log('SERVER NAMES (last', eps.length, 'episodes):', JSON.stringify(names));
console.log('DAILY CANDIDATES:', JSON.stringify(daily.slice(0, 6), null, 1));
