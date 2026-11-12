// خادم محلي بسيط مع دعم Range (ضروري لتقديم الفيديو). الاستخدام: node scripts/dev-server.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const T = { '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4' };
const root = process.cwd();
createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const fp = normalize(join(root, u)); if (!fp.startsWith(root)) { r.writeHead(403); return r.end(); }
  let st; try { st = statSync(fp); } catch { r.writeHead(404); return r.end(); }
  const h = { 'content-type': T[extname(fp)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' };
  const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
  if (m) { const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : st.size - 1; r.writeHead(206, { ...h, 'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1 }); createReadStream(fp, { start: s, end: e }).pipe(r); }
  else { r.writeHead(200, { ...h, 'content-length': st.size }); createReadStream(fp).pipe(r); }
}).listen(+process.argv[2] || 8123, () => console.log('http://localhost:' + (process.argv[2] || 8123)));
