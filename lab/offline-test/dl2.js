// نسخة مختبر «الأوفلاين» من opfs-dl.js (مختبر OPFS السابق نجح على iPhone). الإضافات: kind (mp4|webm)، ملء اصطناعي للأحجام الكبيرة بلا شبكة، قائمة الملفات، فحص سريع.
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
  await r.arrayBuffer();
  let total = m ? +m[1] : null, via = 'content-range';
  if (total == null) {   // عبر CORS لا يُقرأ Content-Range إلا إن كشفه المصدر؛ Content-Length مسموح قراءته
    const h = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
    const cl = h && h.ok && h.headers.get('content-length');
    if (cl && +cl > 1) { total = +cl; via = 'head-content-length'; }
  }
  if (!total) throw new Error('NO_TOTAL: content-range hidden by CORS and no HEAD length');
  return { total, via, etag: r.headers.get('etag'), lm: r.headers.get('last-modified') };
}

const metaName = (name) => name + '.json';

export async function download(url, name, { chunk = 8 << 20, signal, onProgress, kind = 'mp4' } = {}) {
  const W = createWriter();
  try {
    const src = await probe(url);
    let meta = await W.call('getJson', { name: metaName(name) });
    if (!meta || meta.url !== url || meta.total !== src.total || (meta.etag || null) !== (src.etag || null)) {
      meta = { url, total: src.total, etag: src.etag, lm: src.lm, written: 0, complete: false, kind };
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
      if (cr && cr !== `bytes ${start}-${end}/${meta.total}`) throw new Error('BAD_RANGE: ' + cr);   // إن كان مكشوفًا يجب أن يطابق؛ وإلا نعتمد على عدد البايتات المستلمة
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
    const mp4 = meta.kind === 'webm' ? await checkEbml(W, name, size) : await checkMp4(W, name, size);
    if (!mp4.ok) return fail((meta.kind === 'webm' ? 'WEBM_INVALID: ' : 'MP4_INVALID: ') + mp4.why);
    await W.call('close', { name });
    const seek = await seekTest(name);
    if (!seek.ok) return fail('SEEK_FAILED: ' + seek.why);
    meta.complete = true; delete meta.verifyError;
    meta.verified = { size, boxes: mp4.boxes, seek: seek.points, hash: 'not-checked (no trusted source hash)', at: Date.now() };
    await W.call('putJson', { name: metaName(name), obj: meta });
    return { ...meta, ok: true };
  } finally { if (!W0) await W.terminate(); }
}

// WebM/Matroska: توقيع EBML في البداية (فحص خفيف؛ لا نملك مفكّك WebM كاملًا)
async function checkEbml(W, name, size) {
  const b = new Uint8Array(await W.call('read', { name, at: 0, len: 4 }));
  if (!(b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)) return { ok: false, why: 'NO_EBML_HEADER' };
  return { ok: true, boxes: ['ebml'] };
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
export async function seekTest(name) {
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

// ===== ملء اصطناعي (بلا شبكة): ملف MP4 صالح = عيّنة حقيقية + صندوق free ضخم، لاختبار التخزين بأحجام 1–4 غ.ب =====
// يكتب قطعًا بحجم 8 م.ب مع flush ونقطة حفظ؛ لا يجمع الملف في الذاكرة؛ قابل للإيقاف والاستكمال.
export async function fillSynthetic(name, sample, total, { signal, onProgress, chunk = 8 << 20 } = {}) {
  const W = createWriter();
  try {
    let meta = await W.call('getJson', { name: metaName(name) });
    if (!meta || meta.kind !== 'synthetic' || meta.total !== total) {
      meta = { kind: 'synthetic', url: 'synthetic:' + total, total, written: 0, complete: false, sampleLen: sample.byteLength };
      await W.call('truncate', { name, size: 0 });
      await W.call('putJson', { name: metaName(name), obj: meta });
    }
    if (meta.complete) return { ...meta, resumedFrom: meta.total, ok: true };
    const disk = await W.call('size', { name });
    if (disk < meta.written) meta.written = disk;
    await W.call('truncate', { name, size: meta.written });
    const resumedFrom = meta.written;
    const head = new Uint8Array(16); const dv = new DataView(head.buffer);
    const freeSize = total - sample.byteLength;        // صندوق free يمتد إلى نهاية الملف
    dv.setUint32(0, 1); head.set([0x66, 0x72, 0x65, 0x65], 4); dv.setBigUint64(8, BigInt(freeSize));
    try {
      while (meta.written < meta.total) {
        if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
        const start = meta.written, end = Math.min(meta.total, start + chunk);
        const buf = new Uint8Array(end - start);                      // أصفار (البطانة)
        // ننسخ الأجزاء الحقيقية التي تقع في هذه القطعة: العيّنة ثم رأس صندوق free
        const sEnd = sample.byteLength, hEnd = sEnd + 16;
        if (start < sEnd) buf.set(sample.subarray(start, Math.min(end, sEnd)), 0);
        if (end > sEnd && start < hEnd) { const from = Math.max(start, sEnd); buf.set(head.subarray(from - sEnd, Math.min(end, hEnd) - sEnd), from - start); }
        await W.call('write', { name, at: start, buf: buf.buffer }, [buf.buffer]);
        await W.call('flush', { name });
        meta.written = end;
        await W.call('putJson', { name: metaName(name), obj: meta });
        onProgress && onProgress(end, total);
      }
    } catch (e) { await W.call('truncate', { name, size: meta.written }).catch(() => {}); throw e; }
    const v = await verify(name, W, meta);
    return { ...v, resumedFrom };
  } finally { await W.terminate(); }
}

// ===== قائمة ما في OPFS (الحجم على القرص مقابل المسجّل) =====
export async function listFiles() {
  const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('dizi-dl', { create: true }); const out = [];
  for await (const [n, h] of dir.entries()) { if (h.kind === 'file' && !n.endsWith('.json')) { const f = await h.getFile(); out.push({ name: n, size: f.size }); } }
  return out;
}
export async function quickCheck(name) {
  const W = createWriter();
  try {
    const meta = await W.call('getJson', { name: metaName(name) }); const size = await W.call('size', { name });
    if (!meta) return { ok: false, why: 'NO_META', size };
    if (size !== meta.total) return { ok: false, why: 'SIZE ' + size + '/' + meta.total, size, meta };
    const m = meta.kind === 'webm' ? await checkEbml(W, name, size) : await checkMp4(W, name, size);
    return { ok: !!meta.complete && m.ok, why: meta.complete ? (m.ok ? 'OK' : m.why) : 'NOT_COMPLETE', size, meta };
  } finally { await W.terminate(); }
}
export async function fileUrl(name) {
  const fh = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('dizi-dl')).getFileHandle(name);
  return URL.createObjectURL(await fh.getFile());
}
