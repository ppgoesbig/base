/* PureFrame UI: file intake, checks, fixes, downloads and free/Pro gating.
 * The heavy lifting lives in engine.js (pixels) and rules.js (grading). */
(function () {
  'use strict';
  const E = window.PFEngine, R = window.PFRules, Z = window.PFZip;
  const CFG = Object.assign({ edition: 'free', proUrl: '#pricing', price: '$29', freeFixLimit: 3, goatcounter: '' }, window.PF_CONFIG);
  const PRO = CFG.edition === 'pro';
  const WORK_MAX = 4000; // longest side we process at; bounds memory and time
  const THUMB_MAX = 480;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('pf.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('pf.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  const params = new URLSearchParams(location.search);
  const state = {
    preset: R.preset(params.get('preset') || store.get('preset') || 'amazon'),
    settings: Object.assign({ tolerance: 14, levels: true, reframe: true }, store.get('settings')),
    out: null,
    items: [],
    fixedIds: new Set(),
    busy: false,
  };
  let nextId = 1;

  // ---------- helpers ----------
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
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

  async function runQueue() {
    if (state.busy) return;
    state.busy = true;
    try {
      let item;
      while ((item = state.items.find((i) => i.status === 'pending'))) await check(item);
    } finally {
      state.busy = false;
    }
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
    } catch (err) {
      item.status = 'error';
      item.error = err.message || String(err);
    }
    if (state.items.includes(item)) { renderItem(item); renderSummary(); }
  }

  const canFix = (item) => PRO || state.fixedIds.has(item.id) || state.fixedIds.size < CFG.freeFixLimit;
  const isStale = (item) => item.fixed && item.fixed.key !== fixKey();

  async function fix(item) {
    if (!canFix(item)) { upsell('limit'); return false; }
    item.status = 'fixing';
    item.fixError = null;
    renderItem(item);
    await frame();
    try {
      const out = outputSpec(), key = fixKey();
      const src = await decode(item.file);
      const { w, h } = dims(src);
      const ws = Math.min(1, WORK_MAX / Math.max(w, h));
      const work = toImageData(src, WORK_MAX);
      release(src);
      await frame();
      const white = E.whiten(work, { tolerance: state.settings.tolerance, levels: state.settings.levels });
      await frame();
      const bbox = state.settings.reframe && !white.skipped ? E.analyze(white.img).bbox : null;
      const layout = E.computeLayout(bbox, white.img.width, white.img.height, out.width, out.height, state.settings.reframe ? out.fill : 0);
      const img = E.render(white.img, layout, out.width, out.height);
      await frame();
      const canvas = document.createElement('canvas');
      canvas.width = out.width; canvas.height = out.height;
      canvas.getContext('2d').putImageData(new ImageData(img.data, out.width, out.height), 0, 0);
      const blob = await encode(canvas, out);

      // Re-check the exported file exactly as an uploaded photo would be.
      const vsrc = await decode(blob);
      const verify = E.analyze(toImageData(vsrc, WORK_MAX));
      release(vsrc);
      const ext = out.type === 'image/png' ? '.png' : '.jpg';
      const name = R.fileName(out.naming, { name: item.stem, index: state.items.indexOf(item) + 1, preset: state.preset.id, width: out.width, height: out.height }, ext);
      const report = R.evaluate(verify, { name, type: out.type, size: blob.size, width: out.width, height: out.height, jpeg: null }, state.preset);

      const notes = [];
      if (white.skipped) {
        notes.push('The background is too busy to clean automatically, so it was left as is. Remove the background with a cut-out tool first, then run the photo through PureFrame.');
        // The white padding would read as a clean backdrop; keep the original verdict.
        const orig = item.report.checks.find((c) => c.id === 'background');
        report.checks = report.checks.filter((c) => c.id !== 'framing').map((c) => (c.id === 'background' && orig ? orig : c));
      }
      const enlarged = layout.scale * ws;
      if (enlarged > 2) {
        report.checks.push({ id: 'upscaled', status: 'warn', label: 'Enlarged from a small original',
          detail: `The product was scaled up ${enlarged.toFixed(1)}×, so it may look soft when shoppers zoom. A larger original will look sharper.` });
      } else if (bbox && enlarged > 1.3) {
        notes.push(`The product was enlarged ${enlarged.toFixed(1)}× from the original. It should still look fine, but a larger original is always sharper.`);
      }
      report.status = report.checks.reduce((s, c) => ((STATUS_RANK[c.status] || 0) > STATUS_RANK[s] ? c.status : s), 'pass');
      if (out.maxBytes && blob.size > out.maxBytes) notes.push(`Couldn't get the file under ${R.fmtBytes(out.maxBytes)}. Try JPEG or a smaller size.`);

      if (item.fixed) URL.revokeObjectURL(item.fixed.url);
      item.fixed = { blob, url: URL.createObjectURL(blob), name, report, notes, key, width: out.width, height: out.height };
      item.showBefore = false;
      state.fixedIds.add(item.id);
      track('fix');
    } catch (err) {
      item.fixError = err.message || String(err);
    }
    item.status = 'ready';
    if (state.items.includes(item)) { renderItem(item); renderSummary(); }
    return true;
  }

  async function fixAll() {
    for (const item of state.items.slice()) {
      if (item.status !== 'ready' || (item.fixed && !isStale(item))) continue;
      if (!canFix(item)) { upsell('limit'); return false; }
      await fix(item);
    }
    return true;
  }

  async function zipAll() {
    if (!PRO) { upsell('zip'); return; }
    const btn = $('zipAll');
    btn.disabled = true;
    try {
      await runQueue();
      await fixAll();
      const done = state.items.filter((i) => i.fixed && !isStale(i));
      if (!done.length) return;
      const files = [];
      for (const i of done) files.push({ name: i.fixed.name, data: new Uint8Array(await i.fixed.blob.arrayBuffer()) });
      const date = new Date().toISOString().slice(0, 10);
      download(new Blob([Z.build(files)], { type: 'application/zip' }), `pureframe-${state.preset.id}-${date}.zip`);
      track('zip');
    } finally {
      btn.disabled = false;
    }
  }

  function remove(item) {
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
      limit: `You've used the ${CFG.freeFixLimit} free fixes for this visit. Pro fixes every photo in one click, with no limit.`,
      zip: 'Downloading the whole batch as a ZIP is part of Pro.',
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

    const notes = (after ? item.fixed.notes : []).map((n) => `<p class="note">${esc(n)}</p>`).join('')
      + (item.fixError ? `<p class="note note-error">${esc(item.fixError)}</p>` : '')
      + (item.fixed && isStale(item) ? '<p class="note">Settings changed since this photo was fixed. Fix it again to apply them.</p>' : '');

    const fixLabel = fixing ? 'Fixing…' : fixed ? 'Fix again' : 'Fix';
    const actions = [
      `<button class="btn btn-small ${fixed ? '' : 'btn-primary'}" data-action="fix" ${fixing ? 'disabled' : ''}>${fixLabel}</button>`,
      fixed ? `<button class="btn btn-small" data-action="toggle" aria-pressed="${item.showBefore}">${item.showBefore ? 'Show after' : 'Show before'}</button>` : '',
      fixed ? '<button class="btn btn-small btn-primary" data-action="download">Download</button>' : '',
      '<button class="btn btn-small btn-ghost" data-action="remove" aria-label="Remove photo">Remove</button>',
    ].join('');

    return `<button class="thumb${after ? ' thumb-after' : item.analysis.transparent ? ' thumb-alpha' : ''}" data-action="view" aria-label="Preview ${esc(item.file.name)}"><img src="${imgSrc}" alt="">${after ? '<span class="thumb-tag">After</span>' : fixed ? '<span class="thumb-tag thumb-tag-before">Before</span>' : ''}${fixing ? '<span class="thumb-busy"></span>' : ''}</button>
      <div class="card-body">
        <div class="card-head"><p class="card-name" title="${esc(item.file.name)}">${esc(item.file.name)}</p><span class="pill pill-${report.status}">${pill}</span></div>
        <p class="meta">${meta}</p>
        <ul class="checks">${rows}</ul>
        ${notes}
        <div class="card-actions">${actions}</div>
      </div>`;
  }

  function renderItem(item) {
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
      quota.innerHTML = `Free version: <strong>${left} of ${CFG.freeFixLimit}</strong> auto-fixes left this visit. <a href="${esc(CFG.proUrl)}" data-pro-link>Pro</a> fixes unlimited photos and downloads them as one ZIP.`;
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
    };
    store.set('settings', state.settings);
    if (PRO) {
      const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
      const d = defaultOut(state.preset);
      state.out = {
        width: clamp(+$('outW').value, 100, 10000, d.width),
        height: clamp(+$('outH').value, 100, 10000, d.height),
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
    for (const id of ['tolerance', 'levels', 'reframe', 'outW', 'outH', 'fill', 'outType', 'quality', 'naming']) {
      $(id).addEventListener(id === 'tolerance' || id === 'fill' ? 'input' : 'change', onSettingsChange);
    }
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
    });

    $('fixAll').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await runQueue(); await fixAll(); } finally { $('fixAll').disabled = false; }
    });
    $('zipAll').addEventListener('click', zipAll);
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
