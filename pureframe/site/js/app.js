/* PureFrame UI: file intake, checks, fixes, downloads and free/Pro gating.
 * The heavy lifting lives in engine.js (pixels) and rules.js (grading). */
(function () {
  'use strict';
  const E = window.PFEngine, R = window.PFRules, Z = window.PFZip, Mt = window.PFMatte;
  const CFG = Object.assign({ edition: 'free', proUrl: '#pricing', price: '$39', freeFixLimit: 3, goatcounter: '' }, window.PF_CONFIG);
  const PRO = CFG.edition === 'pro';
  const WORK_MAX = 4000; // longest side we process at; bounds memory and time
  const THUMB_MAX = 480;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('pf.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('pf.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  // Free fixes are counted per day and per photo (re-fixing the same photo is
  // free), and survive reloads.
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function loadQuota() {
    const q = store.get('quota');
    return new Set(q && q.day === today() && Array.isArray(q.ids) ? q.ids : []);
  }
  const saveQuota = () => store.set('quota', { day: today(), ids: Array.from(state.fixedIds) });
  const signature = (item) => `${item.file.name}|${item.file.size}|${item.file.lastModified || 0}`;

  const params = new URLSearchParams(location.search);
  const state = {
    preset: R.preset(params.get('preset') || store.get('preset') || 'amazon'),
    settings: Object.assign({ tolerance: 14, levels: true, reframe: true, cutout: 'auto', shadow: false }, store.get('settings')),
    out: null,
    items: [],
    fixedIds: loadQuota(),
    quotaDay: today(),
    catalog: null,
    exporting: false,
    cancelExport: false,
    canvasExact: true, // false when the browser adds anti-fingerprinting noise to canvas pixels
  };
  let nextId = 1;

  // ---------- helpers ----------
  /* Yields so the page can repaint between heavy steps. Background tabs don't
   * run requestAnimationFrame (and throttle timers), so there a MessageChannel
   * task keeps a long batch moving. */
  function frame() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; document.removeEventListener('visibilitychange', onVis); resolve(); } };
      const viaMessage = () => { const c = new MessageChannel(); c.port1.onmessage = finish; c.port2.postMessage(0); };
      const onVis = () => { if (document.hidden) viaMessage(); };
      if (document.hidden) { viaMessage(); return; }
      document.addEventListener('visibilitychange', onVis);
      requestAnimationFrame(() => setTimeout(finish, 0));
    });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EXT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', avif: 'image/avif' };
  const fileType = (f) => f.type || EXT_TYPES[(f.name.split('.').pop() || '').toLowerCase()] || '';
  const stem = (name) => name.replace(/\.[^.]+$/, '');

  function track(event) {
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: event, event: true });
  }

  async function decode(blob) {
    try {
      return await createImageBitmap(blob);
    } catch (e) {
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } catch (e2) {
        if (blob.name) {
          try { await blob.slice(0, 1).arrayBuffer(); } catch (e3) {
            throw new Error(`${blob.name} changed or was moved after you added it. Remove it and add it again.`);
          }
        }
        throw new Error('Your browser can\'t open this file. Save it as JPEG or PNG and try again.');
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
  const dims = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height });
  const release = (src) => { if (src.close) src.close(); };

  function toImageData(src, maxSide) {
    const { w, h } = dims(src);
    const s = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch);
    return { width: cw, height: ch, data: d.data };
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn\'t export the image.'))), type, quality));
  }

  async function thumbnail(src, transparent) {
    const { w, h } = dims(src);
    const s = Math.min(1, THUMB_MAX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return URL.createObjectURL(await toBlob(c, transparent ? 'image/png' : 'image/jpeg', 0.85));
  }

  // JPEG at the requested quality, stepping down until it fits the size cap.
  async function encode(canvas, out) {
    if (out.type === 'image/png') return toBlob(canvas, 'image/png');
    let q = out.quality;
    for (;;) {
      const blob = await toBlob(canvas, 'image/jpeg', q);
      if (!out.maxBytes || blob.size <= out.maxBytes || q <= 0.5) return blob;
      q = Math.round((q - 0.07) * 100) / 100;
    }
  }

  function download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- output spec ----------
  function defaultOut(p) {
    return { width: p.out.width, height: p.out.height, fill: p.out.fill, type: p.out.type, quality: 0.92, naming: p.naming || '{name}', maxBytes: p.out.maxBytes };
  }
  function outputSpec() {
    const base = defaultOut(state.preset);
    return PRO && state.out ? Object.assign(base, state.out) : base;
  }
  const fixKey = () => JSON.stringify([state.preset.id, state.settings, outputSpec()]);

  // ---------- core actions ----------
  function addFiles(list) {
    const files = Array.from(list).filter((f) => f.type.startsWith('image/') || EXT_TYPES[(f.name.split('.').pop() || '').toLowerCase()]);
    if (!files.length) return;
    for (const file of files) {
      state.items.push({ id: nextId++, file, stem: stem(file.name), status: 'pending', fixed: null, showBefore: false });
    }
    track('add-photos');
    renderAll();
    runQueue();
  }

  // Checks pending photos one at a time. Every caller shares the same run, so
  // `await runQueue()` really waits until all added photos are checked.
  let queue = null;
  function runQueue() {
    if (!queue) {
      queue = (async () => {
        let item;
        while ((item = state.items.find((i) => i.status === 'pending' && !i.removed))) await check(item);
      })().finally(() => { queue = null; });
    }
    return queue;
  }

  async function check(item) {
    item.status = 'checking';
    renderItem(item);
    await frame();
    try {
      const src = await decode(item.file);
      const { w, h } = dims(src);
      const work = toImageData(src, WORK_MAX);
      const transparent = E.hasTransparency(work);
      item.thumb = await thumbnail(src, transparent);
      release(src);
      const head = new Uint8Array(await item.file.slice(0, 262144).arrayBuffer());
      item.info = { name: item.file.name, type: fileType(item.file), size: item.file.size, width: w, height: h, jpeg: E.jpegInfo(head) };
      await frame();
      item.analysis = E.analyze(work);
      item.report = R.evaluate(item.analysis, item.info, state.preset);
      item.status = 'ready';
      // A busy background will need the AI cut-out: start loading it now.
      if (needsAI(item) && window.PFCutout && !window.PFCutout.started()) window.PFCutout.load().catch(() => {});
    } catch (err) {
      item.status = 'error';
      item.error = err.message || String(err);
    }
    if (state.items.includes(item)) { renderItem(item); renderSummary(); }
  }

  function refreshQuota() {
    if (state.quotaDay !== today()) { state.fixedIds = new Set(); state.quotaDay = today(); }
    const q = store.get('quota');
    if (q && q.day === today() && Array.isArray(q.ids)) q.ids.forEach((id) => state.fixedIds.add(id));
  }
  const canFix = (item) => {
    if (PRO) return true;
    refreshQuota();
    return state.fixedIds.has(signature(item)) || state.fixedIds.size < CFG.freeFixLimit;
  };
  const isStale = (item) => item.fixed && item.fixed.key !== fixKey();

  const AI_MAX = 2400;     // working size for AI cut-outs
  const REFINE_MAX = 1280; // matte refinement size (sampled up when compositing)
  const needsAI = (item) => state.settings.cutout === 'ai' ||
    (state.settings.cutout !== 'off' && item.analysis && item.analysis.busy);

  /* Background work, done once per photo: returns the product on pure white at
   * working resolution, its bounds, and how that resolution relates to the
   * original. Busy backgrounds go through the on-device AI cut-out; studio
   * shots use the backdrop cleanup, which keeps real shadows. */
  function prepareAI(item, setStage) { return prepare(item, setStage, true); }

  async function prepare(item, setStage, forceAI) {
    const src = await decode(item.file);
    const { w } = dims(src);
    let aiError = null, aiTried = false;
    try {
      if ((forceAI || needsAI(item)) && window.PFCutout) {
        aiTried = true;
        try {
          setStage('Loading on-device AI…');
          await window.PFCutout.load((got, total) => setStage(total ? `Loading on-device AI… ${Math.min(100, Math.round((got / total) * 100))}%` : 'Loading on-device AI…'));
          setStage('Removing background…');
          await frame();
          let work = toImageData(src, Math.min(WORK_MAX, AI_MAX)), small = toImageData(src, REFINE_MAX);
          if (E.hasTransparency(work)) { work = E.composite(work); small = E.composite(small); }
          const coarse = await window.PFCutout.coarseMask(small);
          const alphaSmall = Mt.refine(coarse, window.PFCutout.SIZE, window.PFCutout.SIZE, small);
          const bg = Mt.backgroundEstimate(small, alphaSmall, Math.max(4, Math.round(Math.max(small.width, small.height) / 100)));
          const alpha = Mt.resize(alphaSmall, small.width, small.height, work.width, work.height);
          await frame();
          const img = Mt.compositeOnWhite(work, alpha, bg);
          if (state.settings.shadow) Mt.groundShadow(img, alpha, Mt.bbox(alpha, work.width, work.height), 0.32);
          const bbox = E.analyze(img).bbox;
          if (bbox) return { img, bbox, ws: work.width / w, ai: true, skipped: null };
          aiError = 'The AI couldn\'t find a clear product in this photo.';
        } catch (err) {
          aiError = `Couldn't run the on-device AI (${err.message || err}).`;
        }
      }
      setStage('Cleaning background…');
      const work = toImageData(src, WORK_MAX);
      await frame();
      const white = E.whiten(work, { tolerance: state.settings.tolerance, levels: state.settings.levels });
      await frame();
      const after = white.skipped ? null : E.analyze(white.img);
      // Safety net: if the cleanup couldn't separate product from background
      // (the "product" spans the whole frame), the backdrop wasn't plain after all.
      if (after && after.busy && !aiTried && state.settings.cutout !== 'off' && window.PFCutout) {
        return prepareAI(item, setStage);
      }
      return { img: white.img, bbox: after && after.bbox, ws: work.width / w, ai: false, skipped: white.skipped || (after && after.busy ? 'busy-background' : null), aiError, enclosed: white.enclosed };
    } finally {
      release(src);
    }
  }

  const PROOF_MARGIN = 8;     // px from the product beyond which the background must stay exactly white
  const PROOF_MAX_PX = 25e6;  // skip the pixel proof on huge custom sizes (memory)

  /* Encodes the canvas, decodes the saved bytes again and checks the result.
   * Wherever a white background is required or recommended, JPEG quality steps
   * up (then PNG, where accepted) until every background pixel more than
   * PROOF_MARGIN px from the product is exactly #FFFFFF in the saved file.
   * Keeps the cleanest candidate that fits the size limit. */
  async function proofEncode(canvas, rendered, out, preset) {
    const strictWanted = preset.background !== 'any' && !!window.PFProof && state.canvasExact && rendered.width * rendered.height <= PROOF_MAX_PX;
    const pngOK = preset.formats.includes('image/png');
    const plan = out.type === 'image/png' ? [['image/png']]
      // Below quality 1.0 browsers subsample colour in 16 px blocks, which leaves
      // off-white pixels near edges; 0.98 never cleared them in testing, so go straight to 1.0.
      : strictWanted ? [['image/jpeg', out.quality], ...(out.quality < 1 ? [['image/jpeg', 1]] : []), ...(pngOK ? [['image/png']] : [])]
      : [['image/jpeg', out.quality]];
    let best = null, attempts = 0;
    for (const [type, q] of plan) {
      attempts++;
      let blob = type === 'image/png' ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', q);
      let quality = q;
      if (out.maxBytes && blob.size > out.maxBytes) {
        if (best) continue; // a cleaner candidate that's too big doesn't help
        if (type === 'image/jpeg') {
          blob = await encode(canvas, Object.assign({}, out, { type: 'image/jpeg' })); // fit the limit first
          quality = null;
        }
        // An oversized PNG with nothing better is kept; the size note explains.
      }
      const src = await decode(blob);
      const decoded = toImageData(src, Infinity);
      release(src);
      const strict = window.PFProof && state.canvasExact && decoded.width === rendered.width && decoded.height === rendered.height && rendered.width * rendered.height <= PROOF_MAX_PX
        ? window.PFProof.strictBackground(rendered, decoded, { margin: PROOF_MARGIN }) : null;
      const cand = { blob, decoded, strict, type, encoder: type === 'image/png' ? 'PNG' : quality ? `JPEG q${Math.round(quality * 100)}` : 'JPEG (size-limited)' };
      if (!best || (strict && best.strict && strict.nonWhite < best.strict.nonWhite)) best = cand;
      if (!strictWanted || (strict && strict.nonWhite === 0)) break;
      await frame();
    }
    return Object.assign(best, { attempts });
  }

  // Lays out, renders, encodes and re-verifies one export of a prepared photo.
  // nameFor(ext) can supply the file name (spreadsheet naming); otherwise the template is used.
  async function exportPhoto(item, prep, preset, out, nameFor) {
    const reframe = state.settings.reframe && prep.bbox;
    const layout = E.computeLayout(reframe ? prep.bbox : null, prep.img.width, prep.img.height, out.width, out.height, reframe ? out.fill : 0);
    const img = E.render(prep.img, E.canvasLayout(layout, out.width, out.height), out.width, out.height);
    if (!prep.skipped) E.snapWhite(img, 250);
    await frame();
    const canvas = document.createElement('canvas');
    canvas.width = out.width; canvas.height = out.height;
    canvas.getContext('2d').putImageData(new ImageData(img.data, out.width, out.height), 0, 0);
    const proof = await proofEncode(canvas, img, out, preset);
    const blob = proof.blob;

    // Grade the saved file exactly as an uploaded photo would be.
    const verify = E.analyze(proof.decoded);
    const ext = proof.type === 'image/png' ? '.png' : '.jpg';
    const name = (nameFor && nameFor(ext)) || R.fileName(out.naming, { name: item.stem, index: state.items.indexOf(item) + 1, preset: preset.id, width: out.width, height: out.height }, ext);
    const report = R.evaluate(verify, { name, type: proof.type, size: blob.size, width: out.width, height: out.height, jpeg: null }, preset);
    if (proof.strict && proof.strict.checked) {
      const st = proof.strict;
      report.checks.push(st.nonWhite === 0
        ? { id: 'compression', status: 'pass', label: 'Stays #FFFFFF after compression',
          detail: `Every background pixel more than ${PROOF_MARGIN} px from the product and its shadow is exactly white in the saved file (${proof.encoder}).` }
        : { id: 'compression', status: preset.background === 'any' ? 'info' : 'warn', label: 'Off-white pixels after compression',
          detail: `${st.nonWhite.toLocaleString('en-US')} background pixels (darkest ${st.darkest}) aren't exactly white in the saved file. A higher quality or PNG avoids this.` });
    }

    const notes = [];
    if (prep.aiError) notes.push(prep.aiError);
    if (prep.ai) notes.push('Background removed with on-device AI. Zoom in to check fine details such as straps, fur or glass.');
    if (prep.skipped) {
      notes.push('The background is too busy to clean automatically, so it was left as is. Turn on "AI cut-out" in Fix settings, or remove the background in another tool first.');
      // The white padding would read as a clean backdrop; keep the original verdict.
      const orig = R.evaluate(item.analysis, item.info, preset).checks.find((c) => c.id === 'background');
      report.checks = report.checks.filter((c) => c.id !== 'framing').map((c) => (c.id === 'background' && orig ? orig : c));
    }
    if (prep.enclosed && prep.enclosed.regions && preset.background !== 'any') {
      report.checks.push({ id: 'enclosed', status: 'warn', label: 'Grey inside gaps',
        detail: `Backdrop showing through ${prep.enclosed.regions > 1 ? `${prep.enclosed.regions} gaps` : 'a gap'} (inside a handle or between parts) stayed as shot, about ${Math.max(0.1, prep.enclosed.share * 100).toFixed(1)}% of the photo. Whiten it in an editor, or try AI cut-out: Always.` });
    }
    if (!state.canvasExact) notes.push('Your browser adds tiny random changes to image pixels (a privacy setting), so PureFrame can\'t verify the saved file pixel by pixel here. Try another browser or turn off fingerprinting protection for this page.');
    const enlarged = layout.scale * prep.ws;
    if (enlarged > 2) {
      report.checks.push({ id: 'upscaled', status: 'warn', label: 'Enlarged from a small original',
        detail: `The product was scaled up ${enlarged.toFixed(1)}×, so it may look soft when shoppers zoom. A larger original will look sharper.` });
    } else if (reframe && enlarged > 1.3) {
      notes.push(`The product was enlarged ${enlarged.toFixed(1)}× from the original. It should still look fine, but a larger original is always sharper.`);
    }
    report.status = report.checks.reduce((s, c) => ((STATUS_RANK[c.status] || 0) > STATUS_RANK[s] ? c.status : s), 'pass');
    if (out.maxBytes && blob.size > out.maxBytes) notes.push(`Couldn't get the file under ${R.fmtBytes(out.maxBytes)}. Try JPEG or a smaller size.`);
    if (proof.type === 'image/png' && out.type !== 'image/png') notes.push('Saved as PNG: it was the only way to keep every background pixel exactly white within the size limit.');
    const evidence = window.PFProof ? window.PFProof.evidence({
      file: { name, size: blob.size, type: proof.type, width: out.width, height: out.height },
      marketplace: preset.name, preset, report, analysis: verify, strict: proof.strict, attempts: proof.attempts, encoder: proof.encoder,
    }) : null;
    return { blob, name, report, notes, evidence, width: out.width, height: out.height, preset: preset.id };
  }

  async function fix(item) {
    if (item.removed) return false;
    if (!canFix(item)) { upsell('limit'); return false; }
    const preset = state.preset;
    item.status = 'fixing';
    item.fixError = null;
    item.stage = '';
    renderItem(item);
    await frame();
    const setStage = (text) => {
      item.stage = text;
      const el = document.querySelector(`#item-${item.id} .stage`);
      if (el) el.textContent = text;
    };
    try {
      const out = outputSpec(), key = fixKey();
      const prep = await prepare(item, setStage);
      if (item.removed) return false;
      setStage('Exporting and re-checking…');
      const entries = catalogEntries(state.items.filter((i) => i.status !== 'error' && !i.removed));
      const entry = entries && entries.get(item.id);
      const nameFor = entry && entry.record ? (ext) => window.PFCatalog.name(entry, preset.id, ext).name : null;
      const result = await exportPhoto(item, prep, preset, out, nameFor);
      if (item.removed) return false;
      if (item.fixed) URL.revokeObjectURL(item.fixed.url);
      item.fixed = Object.assign(result, { url: URL.createObjectURL(result.blob), key, ai: prep.ai });
      item.showBefore = false;
      // A photo left as shot (busy background, AI unavailable) doesn't use up a free fix.
      if (!PRO && !prep.skipped) { refreshQuota(); state.fixedIds.add(signature(item)); saveQuota(); }
      track(prep.ai ? 'fix-ai' : 'fix');
    } catch (err) {
      item.fixError = err.message || String(err);
    }
    if (item.removed) return false;
    item.status = 'ready';
    renderItem(item); renderSummary();
    return true;
  }

  async function fixAll() {
    let limited = false;
    for (const item of state.items.slice()) {
      if (item.removed || item.status !== 'ready' || (item.fixed && !isStale(item))) continue;
      if (!canFix(item)) { limited = true; continue; }
      await fix(item);
    }
    if (limited) upsell('limit');
    return !limited;
  }

  // ---------- free audit report: every photo x every marketplace ----------
  function auditReport() {
    if (!window.PFProof) return;
    const records = [];
    for (const item of state.items) {
      if (!item.analysis) continue;
      for (const p of R.PRESETS) {
        const report = R.evaluate(item.analysis, item.info, p);
        records.push(window.PFProof.evidence({
          file: { name: item.file.name, size: item.info.size, type: item.info.type, width: item.info.width, height: item.info.height },
          marketplace: p.name, preset: p, report, analysis: item.analysis, strict: null, attempts: 0, encoder: 'original (not fixed)',
        }));
      }
    }
    if (!records.length) return;
    const date = new Date().toISOString().slice(0, 10);
    download(new Blob(['\ufeff' + window.PFProof.toCSV(records)], { type: 'text/csv;charset=utf-8' }), `pureframe-audit-${date}.csv`);
    track('audit-csv');
  }

  // ---------- multi-marketplace export (Pro) ----------
  const folderName = (p) => p.name.replace(/[\\/:*?"<>|]+/g, '-');
  const outFor = (p) => (PRO && state.out && p.id === state.preset.id ? outputSpec() : defaultOut(p));

  async function zipAll() {
    if (!PRO) { upsell('zip'); return; }
    openExport();
  }

  function openExport() {
    const box = $('exportTargets');
    const chosen = new Set(store.get('targets') || [state.preset.id]);
    box.querySelectorAll('label').forEach((l) => l.remove());
    for (const p of R.PRESETS) {
      const l = document.createElement('label');
      l.className = 'check';
      l.innerHTML = `<input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}> ${esc(p.label)}`;
      box.appendChild(l);
    }
    $('exportFolder').hidden = !('showDirectoryPicker' in window);
    $('exportProgress').textContent = '';
    renderCatalog();
    $('exportDlg').showModal();
  }

  const exportTargets = () => Array.from(document.querySelectorAll('#exportTargets input:checked')).map((i) => R.preset(i.value));

  // Spreadsheet naming: maps photo -> per-marketplace names (or problems).
  function catalogEntries(items) {
    if (!PRO || !state.catalog || !window.PFCatalog) return null;
    const entries = window.PFCatalog.match(items.map((i) => i.file.name), state.catalog.index);
    return new Map(items.map((it, k) => [it.id, entries[k]]));
  }

  async function writeToFolder(dir, path, blob) {
    const parts = path.split('/');
    let d = dir;
    for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  // A new, uniquely named folder inside the one the user picked, so an export
  // never overwrites anything already there (such as the original photos).
  async function freshExportDir(parent) {
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const base = `PureFrame export ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
    for (let n = 1; n < 100; n++) {
      const name = n === 1 ? base : `${base} (${n})`;
      try { await parent.getDirectoryHandle(name); } catch (e) { return parent.getDirectoryHandle(name, { create: true }); }
    }
    throw new Error('Couldn\'t create an export folder there.');
  }

  // Windows refuses some names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) even with an extension.
  const safeName = (name) => name.replace(/^(con|prn|aux|nul|com\d|lpt\d)(?=\.|$)/i, '$1_');

  async function runExport(toFolder) {
    if (state.exporting) return;
    const targets = exportTargets(), progress = (t) => { $('exportProgress').textContent = t; };
    if (!targets.length) { progress('Pick at least one marketplace.'); return; }
    store.set('targets', targets.map((p) => p.id));
    let dir = null;
    if (toFolder) {
      try {
        dir = await freshExportDir(await window.showDirectoryPicker({ mode: 'readwrite', id: 'pureframe-export' }));
      } catch (e) {
        if (e && e.name !== 'AbortError') progress(`Couldn't open that folder: ${e.message || e}`);
        return;
      }
    }
    const buttons = [$('exportZip'), $('exportFolder')];
    buttons.forEach((b) => { b.disabled = true; });
    state.exporting = true;
    state.cancelExport = false;
    try {
      if (state.items.some((i) => i.status === 'pending' || i.status === 'checking')) progress('Checking photos…');
      await runQueue();
      const items = state.items.filter((i) => !i.removed && i.analysis && i.status !== 'error');
      const unreadable = state.items.filter((i) => !i.removed && i.status === 'error').length;
      if (!items.length) { progress('Add some photos first.'); return; }
      const multi = targets.length > 1, entries = catalogEntries(items);
      const zipEntries = [], records = [], used = new Set(), failures = [], statuses = [];
      const unique = (path) => {
        let p = path, n = 2;
        const dot = path.lastIndexOf('.');
        while (used.has(p.toLowerCase())) p = `${path.slice(0, dot)}-${n++}${path.slice(dot)}`;
        used.add(p.toLowerCase());
        return p;
      };
      // Each file is written (folder) or kept as a Blob with its CRC (ZIP) right
      // away, so memory holds one photo's bytes at a time, not the whole batch.
      const save = async (path, blob) => {
        if (dir) { await writeToFolder(dir, path, blob); return; }
        zipEntries.push({ name: path, blob, crc: Z.crc32(new Uint8Array(await blob.arrayBuffer())) });
      };
      for (let k = 0; k < items.length && !state.cancelExport; k++) {
        const item = items[k], label = `Photo ${k + 1} of ${items.length}`;
        let prep;
        try {
          prep = await prepare(item, (t) => progress(`${label}: ${t}`));
        } catch (err) {
          failures.push(`${item.file.name}: ${err.message || err}`);
          continue;
        }
        for (const p of targets) {
          if (state.cancelExport) break;
          progress(`${label}: exporting for ${p.name}…`);
          try {
            const entry = entries && entries.get(item.id);
            const nameFor = entry && entry.record ? (ext) => window.PFCatalog.name(entry, p.id, ext).name : null;
            const res = await exportPhoto(item, prep, p, outFor(p), nameFor);
            const path = unique((multi ? `${folderName(p)}/` : '') + safeName(res.name));
            await save(path, res.blob);
            statuses.push(res.report.status);
            if (res.evidence) records.push(Object.assign(res.evidence, { file: path, source: item.file.name }));
          } catch (err) {
            failures.push(`${item.file.name} for ${p.name}: ${err.message || err}`);
          }
        }
      }
      if (state.cancelExport) { progress('Export cancelled. Nothing was downloaded.'); return; }
      if ($('exportReport').checked && records.length && window.PFProof) {
        const stamp = new Date().toLocaleString();
        // A UTF-8 byte order mark makes Excel on Windows read non-English names correctly.
        await save('evidence-report.csv', new Blob(['\ufeff' + window.PFProof.toCSV(records)], { type: 'text/csv;charset=utf-8' }));
        await save('evidence-report.html', new Blob([window.PFProof.reportHTML(records, { title: 'PureFrame evidence report', generatedAt: stamp, product: 'PureFrame Pro' })], { type: 'text/html' }));
      }
      if (!dir && zipEntries.length) {
        const date = new Date().toISOString().slice(0, 10);
        download(Z.buildBlob(zipEntries), `pureframe-${multi ? 'marketplaces' : targets[0].id}-${date}.zip`);
      }
      const done = statuses.length, failed = statuses.filter((x) => x === 'fail').length, warned = statuses.filter((x) => x === 'warn').length;
      const parts = [`Done: ${done} file${done === 1 ? '' : 's'} for ${targets.length} marketplace${targets.length === 1 ? '' : 's'}${dir ? `, saved in a new folder "${dir.name}"` : ''}.`];
      if (failed || warned) parts.push(`${failed ? `${failed} fail a check` : ''}${failed && warned ? ' and ' : ''}${warned ? `${warned} have warnings` : ''}${records.length && $('exportReport').checked ? '; see the evidence report' : ''}.`);
      else if (done) parts.push('Every file passed the measurable checks.');
      if (failures.length) parts.push(`Couldn't export ${failures.length}: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`);
      if (unreadable) parts.push(`${unreadable} photo${unreadable === 1 ? '' : 's'} couldn't be read and ${unreadable === 1 ? 'was' : 'were'} skipped.`);
      progress(parts.join(' '));
      track('export');
    } catch (err) {
      progress(`Export stopped: ${err.message || err}`);
    } finally {
      state.exporting = false;
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  // ---------- spreadsheet (catalog) naming ----------
  async function loadCatalog(file) {
    const C = window.PFCatalog;
    const text = await file.text();
    const { headers, rows } = C.parseCSV(text);
    const cols = C.columns(headers);
    if (!rows.length) throw new Error('That file has no rows.');
    if (!cols.file && !cols.sku) throw new Error('Add a column named "File" or "SKU" so photos can be matched to rows.');
    state.catalog = { name: file.name, rows: rows.length, cols, index: C.buildIndex(rows, cols) };
  }

  function renderCatalog() {
    const status = $('catalogStatus'), box = $('catalogPreview');
    $('catalogClear').hidden = !state.catalog;
    if (!state.catalog || !window.PFCatalog) { box.hidden = true; return; }
    const items = state.items.filter((i) => i.status !== 'error');
    const targets = exportTargets().map((p) => p.id);
    const rows = window.PFCatalog.preview(items.map((i) => i.file.name), state.catalog.index, targets.length ? targets : [state.preset.id], '.jpg');
    const matched = new Set(rows.filter((r) => r.name).map((r) => r.file)).size;
    status.textContent = `Using ${state.catalog.name}: ${state.catalog.rows} rows, ${matched} of ${items.length} photos matched. Unmatched photos keep their usual names.`;
    const shown = rows.slice(0, 40);
    box.hidden = !rows.length;
    box.innerHTML = `<table><thead><tr><th>Photo</th><th>Marketplace</th><th>New name</th></tr></thead><tbody>${shown.map((r) =>
      `<tr class="${r.problem ? 'row-problem' : ''}"><td>${esc(r.file)}</td><td>${esc(R.preset(r.marketplace).name)}</td><td>${r.name ? `<code>${esc(r.name)}</code>` : ''}${r.problem ? `<span class="problem">${esc(r.problem)}</span>` : ''}</td></tr>`).join('')}</tbody></table>${rows.length > shown.length ? `<p class="hint">…and ${rows.length - shown.length} more.</p>` : ''}`;
  }

  function remove(item) {
    item.removed = true;
    if (item.thumb) URL.revokeObjectURL(item.thumb);
    if (item.fixed) URL.revokeObjectURL(item.fixed.url);
    state.items = state.items.filter((i) => i !== item);
    const li = $('item-' + item.id);
    if (li) li.remove();
    renderSummary();
  }

  // ---------- upsell ----------
  function upsell(reason) {
    if (PRO) return;
    const text = {
      limit: `You've used today's ${CFG.freeFixLimit} free fixes. Pro fixes every photo, for every marketplace, with no limit.`,
      zip: 'Exporting a whole batch for every marketplace at once, with evidence reports and spreadsheet naming, is part of Pro.',
      settings: 'Custom output size, fill, format, quality and file names are part of Pro.',
    }[reason];
    $('upsellReason').textContent = text;
    track('upsell-' + reason);
    const d = $('upsell');
    if (d.showModal) d.showModal(); else location.hash = 'pricing';
  }

  // ---------- rendering ----------
  const ICONS = {
    pass: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 6.8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    warn: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v6M10 14v.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    fail: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    info: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 9v5.5M10 5.5V6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };
  const PILL = { pass: 'Ready to upload', warn: 'Check warnings', fail: 'Needs fixes' };
  const STATUS_RANK = { pass: 0, info: 0, warn: 1, fail: 2 };

  function currentReport(item) {
    if (item.fixed && !item.showBefore && !isStale(item)) return item.fixed.report;
    return item.report;
  }

  function cardHTML(item) {
    if (item.status === 'pending' || item.status === 'checking') {
      return `<div class="thumb thumb-loading"></div><div class="card-body"><div class="card-head"><p class="card-name">${esc(item.file.name)}</p></div><p class="muted">Checking…</p></div>`;
    }
    if (item.status === 'error') {
      return `<div class="thumb thumb-error">${ICONS.fail}</div><div class="card-body"><div class="card-head"><p class="card-name">${esc(item.file.name)}</p><span class="pill pill-fail">Can't read</span></div><p class="muted">${esc(item.error)}</p><div class="card-actions"><button class="btn btn-small btn-ghost" data-action="remove">Remove</button></div></div>`;
    }
    const fixed = item.fixed && !isStale(item);
    const after = fixed && !item.showBefore;
    const report = currentReport(item);
    const fixing = item.status === 'fixing';
    const imgSrc = after ? item.fixed.url : item.thumb;
    const pill = after && report.status === 'pass' ? 'Fixed · ready' : PILL[report.status];

    const rows = report.checks.map((c) => c.status === 'pass'
      ? `<li class="chk chk-pass">${ICONS.pass}<div><strong>${esc(c.label)}</strong></div></li>`
      : `<li class="chk chk-${c.status}">${ICONS[c.status]}<div><strong>${esc(c.label)}</strong><span>${esc(c.detail)}</span></div></li>`).join('');

    const meta = after
      ? `Fixed for ${esc(state.preset.name)} · ${item.fixed.width.toLocaleString('en-US')} × ${item.fixed.height.toLocaleString('en-US')} px · ${R.fmtBytes(item.fixed.blob.size)} · <span class="mono">${esc(item.fixed.name)}</span>`
      : `${item.info.width.toLocaleString('en-US')} × ${item.info.height.toLocaleString('en-US')} px · ${R.fmtBytes(item.info.size)}${item.showBefore ? ' · original' : ''}`;

    const notes = (fixing ? `<p class="stage muted">${esc(item.stage || 'Working…')}</p>` : '')
      + (after ? item.fixed.notes : []).map((n) => `<p class="note">${esc(n)}</p>`).join('')
      + (item.fixError ? `<p class="note note-error">${esc(item.fixError)}</p>` : '')
      + (item.fixed && isStale(item) ? '<p class="note">Settings changed since this photo was fixed. Fix it again to apply them.</p>' : '');

    const fixLabel = fixing ? 'Fixing…' : fixed ? 'Fix again' : 'Fix';
    const actions = [
      `<button class="btn btn-small ${fixed ? '' : 'btn-primary'}" data-action="fix" ${fixing ? 'disabled' : ''}>${fixLabel}</button>`,
      fixed ? `<button class="btn btn-small" data-action="toggle" aria-pressed="${item.showBefore}">${item.showBefore ? 'Show after' : 'Show before'}</button>` : '',
      fixed ? '<button class="btn btn-small btn-primary" data-action="download">Download</button>' : '',
      '<button class="btn btn-small btn-ghost" data-action="remove" aria-label="Remove photo">Remove</button>',
    ].join('');

    const matrix = after ? '' : `<div class="matrix" role="group" aria-label="Every marketplace">${R.PRESETS.map((p) => {
      const r = R.evaluate(item.analysis, item.info, p);
      const issues = r.checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => c.label);
      return `<button type="button" class="mx mx-${r.status}${p.id === state.preset.id ? ' mx-current' : ''}" data-action="preset" data-preset="${p.id}" title="${esc(`${p.name}: ${issues.length ? issues.join(', ') : 'passes every check'}`)}">${ICONS[r.status]}<span>${esc(p.name)}</span></button>`;
    }).join('')}</div>`;

    return `<button class="thumb${after ? ' thumb-after' : item.analysis.transparent ? ' thumb-alpha' : ''}" data-action="view" aria-label="Preview ${esc(item.file.name)}"><img src="${imgSrc}" alt="">${after ? '<span class="thumb-tag">After</span>' : fixed ? '<span class="thumb-tag thumb-tag-before">Before</span>' : ''}${fixing ? '<span class="thumb-busy"></span>' : ''}</button>
      <div class="card-body">
        <div class="card-head"><p class="card-name" title="${esc(item.file.name)}">${esc(item.file.name)}</p><span class="pill pill-${report.status}">${pill}</span></div>
        <p class="meta">${meta}</p>
        ${matrix}
        <ul class="checks">${rows}</ul>
        ${notes}
        <div class="card-actions">${actions}</div>
      </div>`;
  }

  function renderItem(item) {
    if (item.removed) return;
    let li = $('item-' + item.id);
    if (!li) {
      li = document.createElement('li');
      li.id = 'item-' + item.id;
      li.dataset.id = item.id;
      $('results').appendChild(li);
    }
    const report = item.report && currentReport(item);
    li.className = 'card' + (report ? ' card-' + report.status : '') + (item.status === 'error' ? ' card-fail' : '');
    li.innerHTML = cardHTML(item);
  }

  function renderSummary() {
    const items = state.items;
    $('summary').hidden = items.length === 0;
    const count = { pass: 0, warn: 0, fail: 0, error: 0, pending: 0 };
    for (const i of items) {
      if (i.status === 'error') count.error++;
      else if (!i.report) count.pending++;
      else count[currentReport(i).status]++;
    }
    const parts = [`${items.length} photo${items.length === 1 ? '' : 's'}`];
    if (count.pass) parts.push(`${count.pass} ready`);
    if (count.warn) parts.push(`${count.warn} with warnings`);
    if (count.fail) parts.push(`${count.fail} need${count.fail === 1 ? 's' : ''} fixes`);
    if (count.error) parts.push(`${count.error} couldn't be read`);
    if (count.pending) parts.push(`${count.pending} checking…`);
    $('summaryText').textContent = parts.join(' · ');

    const quota = $('quota');
    if (!PRO && items.length) {
      const left = Math.max(0, CFG.freeFixLimit - state.fixedIds.size);
      quota.hidden = false;
      quota.innerHTML = `Free version: <strong>${left} of ${CFG.freeFixLimit}</strong> fixes left today. Checks are unlimited. <a href="${esc(CFG.proUrl)}" data-pro-link>Pro</a> fixes every photo for every marketplace in one go.`;
    } else quota.hidden = true;
  }

  function renderAll() {
    $('results').innerHTML = '';
    for (const item of state.items) renderItem(item);
    renderSummary();
  }

  function renderRules() {
    const p = state.preset;
    $('rulesTitle').textContent = `${p.label} rules`;
    $('rulesList').innerHTML = p.rules.map((r) => `<li>${esc(r)}</li>`).join('');
    const guide = $('rulesGuide');
    if (guide) guide.href = `guides/${p.id}-image-requirements.html`;
  }

  // ---------- settings ----------
  function syncSettingsUI() {
    const s = state.settings, o = outputSpec();
    $('tolerance').value = s.tolerance;
    $('tolOut').textContent = s.tolerance;
    $('levels').checked = s.levels;
    $('reframe').checked = s.reframe;
    $('cutout').value = s.cutout;
    $('shadow').checked = s.shadow;
    $('outW').value = o.width;
    $('outH').value = o.height;
    $('fill').value = Math.round(o.fill * 100);
    $('fillOut').textContent = Math.round(o.fill * 100) + '%';
    $('outType').value = o.type;
    $('quality').value = Math.round(o.quality * 100);
    $('naming').value = o.naming;
  }

  function onSettingsChange() {
    state.settings = {
      tolerance: +$('tolerance').value,
      levels: $('levels').checked,
      reframe: $('reframe').checked,
      cutout: $('cutout').value,
      shadow: $('shadow').checked,
    };
    store.set('settings', state.settings);
    if (PRO) {
      const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
      const d = defaultOut(state.preset);
      state.out = {
        // 4096 px keeps every canvas under Safari's ~16.7 megapixel limit.
        width: clamp(+$('outW').value, 100, 4096, d.width),
        height: clamp(+$('outH').value, 100, 4096, d.height),
        fill: clamp(+$('fill').value, 60, 98, Math.round(d.fill * 100)) / 100,
        type: $('outType').value,
        quality: clamp(+$('quality').value, 60, 100, 92) / 100,
        naming: $('naming').value.trim() || d.naming,
      };
    }
    $('tolOut').textContent = state.settings.tolerance;
    $('fillOut').textContent = $('fill').value + '%';
    renderAll();
  }

  function setPreset(id) {
    state.preset = R.preset(id);
    state.out = null;
    store.set('preset', state.preset.id);
    for (const i of state.items) if (i.analysis) i.report = R.evaluate(i.analysis, i.info, state.preset);
    syncSettingsUI();
    renderRules();
    renderAll();
  }

  // ---------- viewer ----------
  let viewing = null, viewerOriginal = null;
  function openViewer(item) {
    viewing = item;
    if (viewerOriginal) URL.revokeObjectURL(viewerOriginal);
    viewerOriginal = URL.createObjectURL(item.file);
    const fixed = item.fixed && !isStale(item);
    item.viewBefore = !fixed;
    updateViewer();
    $('viewerToggle').hidden = !fixed;
    $('viewer').showModal();
  }
  function updateViewer() {
    const item = viewing;
    $('viewerImg').src = item.viewBefore ? viewerOriginal : item.fixed.url;
    $('viewerImg').alt = item.file.name + (item.viewBefore ? ' (original)' : ' (fixed)');
    $('viewerToggle').textContent = item.viewBefore ? 'Show after' : 'Show before';
  }

  // ---------- wiring ----------
  function init() {
    document.body.classList.toggle('edition-pro', PRO);
    document.body.classList.toggle('edition-free', !PRO);
    if (PRO) document.title = 'PureFrame Pro';
    for (const a of document.querySelectorAll('[data-pro-link]')) { a.href = CFG.proUrl; if (/^https?:/.test(CFG.proUrl)) a.rel = 'noopener'; }
    for (const el of document.querySelectorAll('[data-price]')) el.textContent = CFG.price;
    for (const el of document.querySelectorAll('[data-free-limit]')) el.textContent = CFG.freeFixLimit;
    const year = $('year');
    if (year) year.textContent = new Date().getFullYear();

    const sel = $('preset');
    sel.innerHTML = R.PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
    sel.value = state.preset.id;
    sel.addEventListener('change', () => setPreset(sel.value));

    syncSettingsUI();
    renderRules();
    for (const id of ['tolerance', 'levels', 'reframe', 'cutout', 'shadow', 'outW', 'outH', 'fill', 'outType', 'quality', 'naming']) {
      $(id).addEventListener('change', onSettingsChange);
    }
    // Sliders: live labels while dragging; the cards are rebuilt on release.
    $('tolerance').addEventListener('input', () => { $('tolOut').textContent = $('tolerance').value; });
    $('fill').addEventListener('input', () => { $('fillOut').textContent = $('fill').value + '%'; });

    // Privacy browsers (Brave shields, Firefox resist-fingerprinting) add noise to
    // canvas reads, which would make pixel-exact verification meaningless.
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const probe = new ImageData(4, 4);
      for (let i = 0; i < probe.data.length; i += 4) { probe.data[i] = (i * 7) % 256; probe.data[i + 1] = 255; probe.data[i + 2] = 128; probe.data[i + 3] = 255; }
      ctx.putImageData(probe, 0, 0);
      const back = ctx.getImageData(0, 0, 4, 4).data;
      state.canvasExact = back.every((v, i) => v === probe.data[i]);
    } catch (e) { state.canvasExact = true; }
    if (!PRO) {
      const fs = $('proFields');
      for (const el of fs.querySelectorAll('input, select')) el.tabIndex = -1;
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'pro-lock';
      lock.setAttribute('aria-label', 'Custom output settings are part of PureFrame Pro');
      lock.addEventListener('click', () => upsell('settings'));
      fs.appendChild(lock);
    }

    // File intake: picker, drag and drop, paste.
    const dz = $('dropzone'), input = $('fileInput');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
    let depth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; dz.classList.add('dragging'); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; dz.classList.remove('dragging'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0; dz.classList.remove('dragging');
      if (e.dataTransfer && e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
        $('tool').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    window.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i + 1}.png`, { type: f.type }))));
    });

    $('results').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const li = btn.closest('li.card');
      const item = state.items.find((i) => String(i.id) === li.dataset.id);
      if (!item) return;
      const action = btn.dataset.action;
      if (action === 'fix') fix(item);
      else if (action === 'remove') remove(item);
      else if (action === 'download') { download(item.fixed.blob, item.fixed.name); track('download'); }
      else if (action === 'toggle') { item.showBefore = !item.showBefore; renderItem(item); renderSummary(); }
      else if (action === 'view') openViewer(item);
      else if (action === 'preset') { $('preset').value = btn.dataset.preset; setPreset(btn.dataset.preset); }
    });

    $('fixAll').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await runQueue(); await fixAll(); } finally { $('fixAll').disabled = false; }
    });
    $('zipAll').addEventListener('click', zipAll);
    $('auditCsv').addEventListener('click', auditReport);
    $('exportZip').addEventListener('click', () => runExport(false));
    $('exportFolder').addEventListener('click', () => runExport(true));
    $('exportTargets').addEventListener('change', renderCatalog);
    $('exportDlg').addEventListener('close', () => { if (state.exporting) state.cancelExport = true; });
    $('catalogBtn').addEventListener('click', () => $('catalogInput').click());
    $('catalogClear').addEventListener('click', () => { state.catalog = null; renderCatalog(); $('catalogStatus').textContent = 'Spreadsheet removed. Photos keep their usual names.'; });
    $('catalogInput').addEventListener('change', async () => {
      const f = $('catalogInput').files[0];
      $('catalogInput').value = '';
      if (!f) return;
      try { await loadCatalog(f); renderCatalog(); } catch (err) { state.catalog = null; renderCatalog(); $('catalogStatus').textContent = err.message || String(err); }
    });
    $('clearAll').addEventListener('click', () => { for (const i of state.items.slice()) remove(i); });
    $('viewerToggle').addEventListener('click', () => { viewing.viewBefore = !viewing.viewBefore; updateViewer(); });
    $('viewer').addEventListener('close', () => { if (viewerOriginal) { URL.revokeObjectURL(viewerOriginal); viewerOriginal = null; } });

    if (CFG.goatcounter && !PRO && location.protocol.startsWith('http')) {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://gc.zgo.at/count.js';
      s.dataset.goatcounter = `https://${CFG.goatcounter}.goatcounter.com/count`;
      document.head.appendChild(s);
    }
  }

  init();
})();
