// عامل (Worker) يكتب إلى OPFS عبر createSyncAccessHandle: متاح في Chromium وSafari (15.2+) داخل Worker فقط.
// لا يحمل الملف في الذاكرة: يكتب كل قطعة تصله عند الإزاحة المطلوبة.
let dir; const h = {};
const getDir = async () => (dir ||= await (await navigator.storage.getDirectory()).getDirectoryHandle('dizi-dl', { create: true }));
async function open(name) {
  if (h[name]) return h[name];
  const fh = await (await getDir()).getFileHandle(name, { create: true });
  return (h[name] = await fh.createSyncAccessHandle());
}
const enc = new TextEncoder(), dec = new TextDecoder();
onmessage = async ({ data: m }) => {
  try {
    let r;
    switch (m.op) {
      case 'size': r = (await open(m.name)).getSize(); break;
      case 'truncate': { const a = await open(m.name); a.truncate(m.size); a.flush(); r = a.getSize(); break; }
      case 'write': {
        const a = await open(m.name); const n = a.write(new Uint8Array(m.buf), { at: m.at });
        if (n !== m.buf.byteLength) throw new Error(`short write ${n}/${m.buf.byteLength}`);
        r = n; break;
      }
      case 'flush': (await open(m.name)).flush(); r = true; break;
      case 'read': { const a = await open(m.name); const b = new Uint8Array(m.len); const n = a.read(b, { at: m.at }); r = b.slice(0, n).buffer; break; }
      case 'putJson': { const a = await open(m.name); const b = enc.encode(JSON.stringify(m.obj)); a.truncate(0); a.write(b, { at: 0 }); a.flush(); r = true; break; }
      case 'getJson': { const a = await open(m.name); const n = a.getSize(); if (!n) { r = null; break; } const b = new Uint8Array(n); a.read(b, { at: 0 }); r = JSON.parse(dec.decode(b)); break; }
      case 'close': if (h[m.name]) { h[m.name].flush(); h[m.name].close(); delete h[m.name]; } r = true; break;
      case 'closeAll': for (const k of Object.keys(h)) { h[k].flush(); h[k].close(); delete h[k]; } r = true; break;
      case 'remove': { if (h[m.name]) { h[m.name].close(); delete h[m.name]; } await (await getDir()).removeEntry(m.name).catch(() => {}); r = true; break; }
      default: throw new Error('unknown op ' + m.op);
    }
    postMessage({ id: m.id, ok: true, r }, r instanceof ArrayBuffer ? [r] : []);
  } catch (e) { postMessage({ id: m.id, ok: false, e: `${e.name}: ${e.message}` }); }
};
