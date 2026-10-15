/* PureFrame cutout: on-device AI background removal.
 *
 * Runs U2-Netp (Apache-2.0) with ONNX Runtime Web (MIT) entirely in the
 * browser; photos never leave the device. Loaded lazily on first use:
 *   website: fetches vendor/ort.wasm.bundle.min.mjs, vendor/ort-wasm-simd-threaded.wasm
 *            and vendor/u2netp.onnx from the same origin (cached by the browser)
 *   Pro:     the offline file ships the same bytes, base64-encoded, in
 *            "PureFrame AI.js" next to the HTML (a classic script works from file://)
 * Mask math lives in matte.js. */
(function () {
  'use strict';
  const SIZE = 320;
  const STALL_MS = 30000; // give up on a download that receives nothing for this long
  const cfg = () => window.PF_CONFIG || {};
  let loading = null;
  // Every caller of load() gets progress, including one that joins a download
  // already started in the background.
  const listeners = new Set();
  let lastProgress = null;
  const emit = (got, total) => { lastProgress = [got, total]; listeners.forEach((fn) => { try { fn(got, total); } catch (e) { /* ignore */ } }); };

  function fromBase64(s) {
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Couldn't load ${src}. Keep it in the same folder as PureFrame Pro.html.`));
      document.head.appendChild(el);
    });
  }

  // Fetch with progress reporting (bytes received / total) and stall detection.
  async function fetchBytes(url, onBytes, asText) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const arm = () => {
      clearTimeout(timer);
      if (ctrl) timer = setTimeout(() => ctrl.abort(), STALL_MS);
    };
    arm();
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error(`Couldn't download ${url} (${res.status}).`);
      if (asText) return await res.text();
      const total = +res.headers.get('content-length') || 0;
      if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
      const reader = res.body.getReader(), chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        chunks.push(value); got += value.length;
        if (onBytes) onBytes(got, total);
      }
      const out = new Uint8Array(got);
      let pos = 0;
      for (const c of chunks) { out.set(c, pos); pos += c.length; }
      return out;
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('The AI download stalled. Check your connection and try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function assets() {
    const c = cfg();
    if (c.aiAssets === 'script') {
      if (!window.PF_AI_ASSETS) await loadScript(c.aiScript || 'PureFrame AI.js');
      const a = window.PF_AI_ASSETS;
      return { ortSource: a.ort, wasm: fromBase64(a.wasm), model: fromBase64(a.model) };
    }
    const base = c.aiBase || 'vendor/';
    const parts = { wasm: [0, 0], model: [0, 0] };
    const report = () => emit(parts.wasm[0] + parts.model[0], parts.wasm[1] + parts.model[1]);
    const [ortSource, wasm, model] = await Promise.all([
      fetchBytes(base + 'ort.wasm.bundle.min.mjs', null, true),
      fetchBytes(base + 'ort-wasm-simd-threaded.wasm', (g, t) => { parts.wasm = [g, t]; report(); }),
      fetchBytes(base + 'u2netp.onnx', (g, t) => { parts.model = [g, t]; report(); }),
    ]);
    return { ortSource, wasm, model };
  }

  /* Loads the runtime and model once. onProgress(gotBytes, totalBytes) fires
   * while downloading on the website. */
  function load(onProgress) {
    if (onProgress) {
      listeners.add(onProgress);
      if (lastProgress) onProgress(lastProgress[0], lastProgress[1]);
    }
    if (!loading) {
      loading = (async () => {
        const a = await assets();
        // Importing from a blob URL works both over http and from file://.
        const url = URL.createObjectURL(new Blob([a.ortSource], { type: 'text/javascript' }));
        let ort;
        try { ort = await import(url); } finally { URL.revokeObjectURL(url); }
        ort.env.wasm.wasmBinary = a.wasm;
        ort.env.wasm.numThreads = 1; // static hosting can't enable cross-origin isolation
        const session = await ort.InferenceSession.create(a.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        return { ort, session };
      })().catch((err) => { loading = null; lastProgress = null; throw err; });
      loading.then(() => listeners.clear(), () => listeners.clear());
    }
    return loading;
  }

  /* Runs the model on an RGBA image ({width, height, data}) and returns the
   * coarse saliency mask (SIZE x SIZE, values 0..1). */
  async function coarseMask(img) {
    const { ort, session } = await load();
    const input = new ort.Tensor('float32', window.PFMatte.toTensor(img, SIZE), [1, 3, SIZE, SIZE]);
    const out = await session.run({ [session.inputNames[0]]: input });
    const first = out[session.outputNames[0]];
    return window.PFMatte.normalize(first.data);
  }

  window.PFCutout = { SIZE, load, coarseMask, started: () => !!loading };
})();
