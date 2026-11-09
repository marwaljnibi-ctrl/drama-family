// يولّد أيقونات PNG بلا اعتماديات: خلفية داكنة + دائرة ذهبية + مثلث تشغيل.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(n) {
  const raw = Buffer.alloc((n * 4 + 1) * n);
  const cx = n / 2, R = n * 0.34;
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    for (let x = 0; x < n; x++) {
      let rgb = [17, 17, 17];
      const d = Math.hypot(x - cx, y - cx);
      if (d < R) {
        rgb = [255, 255, 255];
        // مثلث تشغيل يشير لليمين
        const tx = (x - cx) / R, ty = (y - cx) / R;
        if (tx > -0.28 && tx < 0.45 && Math.abs(ty) < (0.45 - tx) * 0.9 + 0.0 && Math.abs(ty) < 0.5 - (tx + 0.28) * 0.69) rgb = [17, 17, 17];
      }
      const o = y * (n * 4 + 1) + 1 + x * 4; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255;
    }
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(n, 0); ih.writeUInt32BE(n, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('icons', { recursive: true });
for (const n of [180, 192, 512]) writeFileSync(`icons/icon-${n}.png`, png(n));
console.log('icons ok');
