// تجربة مختبرية (غير مربوطة بالتطبيق): تنزيل متسلسل بقطع HTTP Range إلى OPFS مع الاستكمال والتحقق.
// لا تنزيل متوازٍ. لا وسيط CORS. المصدر يجب أن يسمح بـ CORS + Range (206 + Content-Range).
// الحلقة لا تُعتبر مكتملة إلا بعد: حجم أصلي موثوق، بايتات مكتوبة مسجلة ومطابقة، إغلاق الملف، فحص بنية MP4، واختبار تقديم/ترجيع.

export function createWriter() {
  const w = new Worker(new URL('./opfs-writer.js', import.meta.url));
  let id = 0; const p = new Map();
  w.onmessage = ({ data }) => { const x = p.get(data.id); p.delete(data.id); data.ok ? x.res(data.r) : x.rej(new Error(data.e)); };
  const call = (op, a = {}, tr = []) => new Promise((res, rej) => { const i = ++id; p.set(i, { res, rej }); w.postMessage({ id: i, op, ...a }, tr); });
  // يغلق كل المقابض قبل الإيقاف: إيقاف العامل وحده ترك الملف مقفلًا في Chromium فتعلّق الطلب التالي (وُجد في الاختبار)
  return { call, terminate: async () => { await call('closeAll').catch(() => {}); w.terminate(); } };
}

// 1) الحجم الأصلي الموثوق: من Content-Range لطلب bytes=0-0 (يجب أن يكون 206)
export async function probe(url) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
  if (r.status !== 206) throw new Error('NO_RANGE: status ' + r.status);
  const cr = r.headers.get('content-range') || '';
  const m = cr.match(/^bytes 0-0\/(\d+)$/);
  if (!m) throw new Error('NO_TOTAL: ' + cr);
  await r.arrayBuffer();
  return { total: +m[1], etag: r.headers.get('etag'), lm: r.headers.get('last-modified') };
}

const metaName = (name) => name + '.json';

export async function download(url, name, { chunk = 8 << 20, signal, onProgress } = {}) {
  const W = createWriter();
  try {
    const src = await probe(url);
    let meta = await W.call('getJson', { name: metaName(name) });
    if (!meta || meta.url !== url || meta.total !== src.total || (meta.etag || null) !== (src.etag || null)) {
      meta = { url, total: src.total, etag: src.etag, lm: src.lm, written: 0, complete: false };
      await W.call('truncate', { name, size: 0 });
      await W.call('putJson', { name: metaName(name), obj: meta });
    }
    if (meta.complete) return { ...meta, resumedFrom: meta.total };
    // نثق فقط بالبايتات التي سُجّلت بعد flush؛ أي زيادة على القرص (قطعة مقطوعة) تُحذف
    const disk = await W.call('size', { name });
    if (disk < meta.written) meta.written = disk;
    await W.call('truncate', { name, size: meta.written });
    const resumedFrom = meta.written;
    try {
    while (meta.written < meta.total) {
      if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
      const start = meta.written, end = Math.min(meta.total, start + chunk) - 1;
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal, cache: 'no-store' });
      if (r.status !== 206) throw new Error('RANGE_LOST: ' + r.status);
      const cr = r.headers.get('content-range');
      if (cr !== `bytes ${start}-${end}/${meta.total}`) throw new Error('BAD_RANGE: ' + cr);
      if (src.etag && r.headers.get('etag') && r.headers.get('etag') !== src.etag) throw new Error('SOURCE_CHANGED');
      const rd = r.body.getReader(); let at = start;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        const buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        await W.call('write', { name, at, buf }, [buf]);
        at += value.byteLength;
        onProgress && onProgress(at, meta.total);
      }
      // انقطاع وصل بعد استلام آخر بايت من القطعة: لا نسجّلها (لا نقطة حفظ لقطعة لم تُعتمد)
      if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (at !== end + 1) throw new Error(`SHORT_CHUNK ${at - start}/${end - start + 1}`);
      await W.call('flush', { name });
      meta.written = at;
      await W.call('putJson', { name: metaName(name), obj: meta });
    }
    } catch (e) {
      // انقطاع: نحذف ما بعد آخر نقطة حفظ مسجلة، ونُبقي الجزء المسجّل للاستكمال
      await W.call('truncate', { name, size: meta.written }).catch(() => {});
      throw e;
    }
    const v = await verify(name, W, meta);
    return { ...v, resumedFrom };
  } finally { await W.terminate(); }
}

// التحقق النهائي. لا يُكتب complete:true إلا إذا نجحت كل الشروط.
export async function verify(name, W0, meta0) {
  const W = W0 || createWriter();
  try {
    const meta = meta0 || await W.call('getJson', { name: metaName(name) });
    if (!meta) throw new Error('NO_META');
    const fail = async (why) => { meta.complete = false; meta.verifyError = why; await W.call('putJson', { name: metaName(name), obj: meta }); return { ...meta, ok: false }; };
    if (meta.written !== meta.total) return fail('WRITTEN_NE_TOTAL');
    await W.call('flush', { name });
    const size = await W.call('size', { name });
    if (size !== meta.total) return fail(`SIZE_MISMATCH ${size}/${meta.total}`);
    const mp4 = await checkMp4(W, name, size);
    if (!mp4.ok) return fail('MP4_INVALID: ' + mp4.why);
    await W.call('close', { name });
    const seek = await seekTest(name);
    if (!seek.ok) return fail('SEEK_FAILED: ' + seek.why);
    meta.complete = true; delete meta.verifyError;
    meta.verified = { size, boxes: mp4.boxes, seek: seek.points, hash: 'not-checked (no trusted source hash)', at: Date.now() };
    await W.call('putJson', { name: metaName(name), obj: meta });
    return { ...meta, ok: true };
  } finally { if (!W0) await W.terminate(); }
}

// بنية MP4: مرور على الصناديق العليا حتى نهاية الملف بالضبط، مع اشتراط ftyp وmoov وmdat
async function checkMp4(W, name, size) {
  const boxes = []; let at = 0;
  while (at < size) {
    const hb = new DataView(await W.call('read', { name, at, len: 16 }));
    if (hb.byteLength < 8) return { ok: false, why: 'TRUNCATED_HEADER@' + at };
    let bs = hb.getUint32(0); const type = String.fromCharCode(hb.getUint8(4), hb.getUint8(5), hb.getUint8(6), hb.getUint8(7));
    if (bs === 1) bs = Number(hb.getBigUint64(8)); else if (bs === 0) bs = size - at;
    if (!/^[\x20-\x7e]{4}$/.test(type) || bs < 8 || at + bs > size) return { ok: false, why: `BAD_BOX ${JSON.stringify(type)}@${at} size=${bs}` };
    boxes.push(type); at += bs;
    if (boxes.length > 10000) return { ok: false, why: 'TOO_MANY_BOXES' };
  }
  if (at !== size) return { ok: false, why: 'BOXES_NE_SIZE' };
  for (const t of ['ftyp', 'moov', 'mdat']) if (!boxes.includes(t)) return { ok: false, why: 'MISSING_' + t };
  return { ok: true, boxes };
}

// تقديم وترجيع حقيقيان على الملف المحفوظ (يتضمن الوصول لنهاية الملف)
async function seekTest(name) {
  const fh = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('dizi-dl')).getFileHandle(name);
  const url = URL.createObjectURL(await fh.getFile());
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto';
  const once = (ev, ms = 8000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); v.addEventListener('error', () => { clearTimeout(t); rej(new Error('media error ' + (v.error && v.error.code))); }, { once: true }); });
  try {
    v.src = url; await once('loadedmetadata');
    const d = v.duration; if (!isFinite(d) || d <= 0) return { ok: false, why: 'NO_DURATION' };
    const points = [];
    for (const f of [0.5, 0.97, 0.1]) { const tgt = d * f; v.currentTime = tgt; await once('seeked'); if (Math.abs(v.currentTime - tgt) > 1.5) return { ok: false, why: `SEEK ${f}` }; points.push(+v.currentTime.toFixed(1)); }
    return { ok: true, points, duration: +d.toFixed(1) };
  } catch (e) { return { ok: false, why: e.message }; } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

export async function status(name) {
  const W = createWriter();
  try { return { meta: await W.call('getJson', { name: metaName(name) }), size: await W.call('size', { name }) }; } finally { await W.terminate(); }
}
export async function removeAll(name) {
  const W = createWriter();
  try { await W.call('remove', { name }); await W.call('remove', { name: metaName(name) }); } finally { await W.terminate(); }
}
