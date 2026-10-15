/* PureFrame engine: pixel analysis and fixes for marketplace product photos.
 *
 * Everything here is a pure function over { width, height, data } where data is
 * RGBA in a Uint8ClampedArray (the ImageData layout). No DOM access, so the same
 * file runs in the browser (window.PFEngine) and in the Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WHITE = [255, 255, 255];
  // Tolerance used to tell product pixels from backdrop pixels when measuring.
  const DETECT_TOLERANCE = 24;

  function createImage(width, height, fill) {
    const data = new Uint8ClampedArray(width * height * 4);
    if (fill) {
      for (let p = 0; p < data.length; p += 4) {
        data[p] = fill[0]; data[p + 1] = fill[1]; data[p + 2] = fill[2]; data[p + 3] = 255;
      }
    }
    return { width, height, data };
  }

  function hasTransparency(img) {
    const d = img.data;
    for (let p = 3; p < d.length; p += 4) if (d[p] < 255) return true;
    return false;
  }

  // Returns a copy with any transparency flattened onto white.
  function composite(img) {
    const src = img.data, out = new Uint8ClampedArray(src.length);
    for (let p = 0; p < src.length; p += 4) {
      const a = src[p + 3];
      if (a === 255) {
        out[p] = src[p]; out[p + 1] = src[p + 1]; out[p + 2] = src[p + 2];
      } else {
        const k = a / 255, w = 255 * (1 - k);
        out[p] = src[p] * k + w; out[p + 1] = src[p + 1] * k + w; out[p + 2] = src[p + 2] * k + w;
      }
      out[p + 3] = 255;
    }
    return { width: img.width, height: img.height, data: out };
  }

  function cheb(d, p, ref) {
    const r = d[p] - ref[0], g = d[p + 1] - ref[1], b = d[p + 2] - ref[2];
    return Math.max(r < 0 ? -r : r, g < 0 ? -g : g, b < 0 ? -b : b);
  }

  function borderBand(width, height) {
    return Math.max(2, Math.round(Math.min(width, height) * 0.015));
  }

  // Calls fn(pixelIndex) for every pixel in the outer band of the image.
  function forEachBorder(W, H, band, fn) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      if (y < band || y >= H - band || W <= 2 * band) {
        for (let x = 0; x < W; x++) fn(row + x);
      } else {
        for (let x = 0; x < band; x++) fn(row + x);
        for (let x = W - band; x < W; x++) fn(row + x);
      }
    }
  }

  function histMedian(hist, n) {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc * 2 >= n) return v; }
    return 255;
  }

  // Least-squares solve for a small dense system (Gaussian elimination).
  function solve(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-9) return null;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let v = b[r];
      for (let k = r + 1; k < n; k++) v -= A[r][k] * x[k];
      x[r] = v / A[r][r];
    }
    return x;
  }

  /* Models the backdrop seen in the border band: its median colour, plus a smooth
   * quadratic surface fitted per channel so lighting fall-off (vignetting, a
   * sweep that darkens toward the corners) is followed rather than mistaken for
   * product. The surface is stored on a coarse grid for fast lookups.
   * uniformity = share of border pixels within tol of the surface (low = busy). */
  function backdropModel(img, tol) {
    const { width: W, height: H, data } = img;
    const band = borderBand(W, H);
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    let n = 0;
    forEachBorder(W, H, band, (i) => {
      const p = i * 4;
      hr[data[p]]++; hg[data[p + 1]]++; hb[data[p + 2]]++; n++;
    });
    const bg = [histMedian(hr, n), histMedian(hg, n), histMedian(hb, n)];

    // Fit c(u, v) = k0 + k1 u + k2 v + k3 u^2 + k4 uv + k5 v^2 to backdrop-like border pixels.
    const ata = Array.from({ length: 6 }, () => new Float64Array(6));
    const atb = [new Float64Array(6), new Float64Array(6), new Float64Array(6)];
    const f = new Float64Array(6);
    const sx = 2 / Math.max(1, W - 1), sy = 2 / Math.max(1, H - 1);
    const stride = Math.max(1, Math.floor(n / 20000));
    let k = 0, used = 0;
    forEachBorder(W, H, band, (i) => {
      if (k++ % stride) return;
      const p = i * 4;
      if (cheb(data, p, bg) > tol * 3) return;
      const u = (i % W) * sx - 1, v = ((i / W) | 0) * sy - 1;
      f[0] = 1; f[1] = u; f[2] = v; f[3] = u * u; f[4] = u * v; f[5] = v * v;
      for (let a = 0; a < 6; a++) {
        for (let c = 0; c < 6; c++) ata[a][c] += f[a] * f[c];
        atb[0][a] += f[a] * data[p]; atb[1][a] += f[a] * data[p + 1]; atb[2][a] += f[a] * data[p + 2];
      }
      used++;
    });
    let coef = null;
    if (used >= 50) {
      coef = [0, 1, 2].map((c) => solve(ata.map((r) => Array.from(r)), Array.from(atb[c])));
      if (coef.some((c) => !c)) coef = null;
    }

    const step = Math.max(1, Math.ceil(Math.max(W, H) / 512));
    const gw = Math.ceil(W / step), gh = Math.ceil(H / step);
    const grid = new Uint8ClampedArray(gw * gh * 3);
    for (let gy = 0, q = 0; gy < gh; gy++) {
      const v = Math.min(H - 1, gy * step + step / 2) * sy - 1;
      for (let gx = 0; gx < gw; gx++, q += 3) {
        const u = Math.min(W - 1, gx * step + step / 2) * sx - 1;
        for (let c = 0; c < 3; c++) {
          const K = coef && coef[c];
          grid[q + c] = K ? K[0] + K[1] * u + K[2] * v + K[3] * u * u + K[4] * u * v + K[5] * v * v : bg[c];
        }
      }
    }
    const model = { bg, band, step, gw, grid, uniformity: 0 };
    let similar = 0;
    forEachBorder(W, H, band, (i) => { if (distToBackdrop(data, i * 4, model, i % W, (i / W) | 0) <= tol) similar++; });
    model.uniformity = similar / n;
    return model;
  }

  function distToBackdrop(d, p, m, x, y) {
    const q = (((y / m.step) | 0) * m.gw + ((x / m.step) | 0)) * 3, g = m.grid;
    const r = d[p] - g[q], gg = d[p + 1] - g[q + 1], b = d[p + 2] - g[q + 2];
    return Math.max(r < 0 ? -r : r, gg < 0 ? -gg : gg, b < 0 ? -b : b);
  }

  // Scanline flood fill from every border pixel through pixels within tol of the
  // backdrop model. Returns a Uint8Array mask where 1 marks the connected backdrop.
  function floodBackground(img, model, tol) {
    const { width: W, height: H, data } = img;
    const mask = new Uint8Array(W * H);
    const ok = (x, y) => { const i = y * W + x; return mask[i] === 0 && distToBackdrop(data, i * 4, model, x, y) <= tol; };
    let stack = new Int32Array(4096), sp = 0;
    const push = (i) => {
      if (sp === stack.length) { const s = new Int32Array(sp * 2); s.set(stack); stack = s; }
      stack[sp++] = i;
    };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 1; y < H - 1; y++) { push(y * W); push(y * W + W - 1); }

    const seedRow = (ny, l, r) => {
      let inRun = false;
      for (let x = l; x <= r; x++) {
        if (ok(x, ny)) { if (!inRun) { push(ny * W + x); inRun = true; } } else inRun = false;
      }
    };
    while (sp > 0) {
      const i = stack[--sp];
      const y = (i / W) | 0, row = y * W;
      let l = i - row, r = l;
      if (!ok(l, y)) continue;
      while (l > 0 && ok(l - 1, y)) l--;
      while (r < W - 1 && ok(r + 1, y)) r++;
      for (let x = l; x <= r; x++) mask[row + x] = 1;
      if (y > 0) seedRow(y - 1, l, r);
      if (y < H - 1) seedRow(y + 1, l, r);
    }
    return mask;
  }

  // Product bounds from per-row/column counts of non-backdrop pixels. Requiring a
  // few pixels per row/column keeps dust specks from stretching the box.
  function boundsFromCounts(rows, cols) {
    const H = rows.length, W = cols.length;
    const minInCol = Math.max(2, Math.round(H * 0.002));
    const minInRow = Math.max(2, Math.round(W * 0.002));
    let x0 = -1, x1 = -1, y0 = -1, y1 = -1;
    for (let x = 0; x < W; x++) if (cols[x] >= minInCol) { if (x0 < 0) x0 = x; x1 = x; }
    for (let y = 0; y < H; y++) if (rows[y] >= minInRow) { if (y0 < 0) y0 = y; y1 = y; }
    if (x0 < 0 || y0 < 0) return null;
    return { x0, y0, x1, y1 };
  }

  /* Measures an image the way marketplace checks do:
   *   background  share of backdrop pixels that are pure #FFFFFF / near-white
   *   bbox, fill  product bounds and how much of the frame they span
   *   touches     which image edges the product reaches (looks cropped)
   *   uniformity  how plain the border is (low = lifestyle/busy background) */
  function analyze(input, opts) {
    const tol = (opts && opts.tolerance) || DETECT_TOLERANCE;
    const transparent = hasTransparency(input);
    const img = transparent ? composite(input) : input;
    const { width: W, height: H, data } = img;
    const model = backdropModel(img, tol);
    const mask = floodBackground(img, model, tol);

    const rows = new Uint32Array(H), cols = new Uint32Array(W);
    let bgCount = 0;
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        if (mask[i]) bgCount++;
        else { rows[y]++; cols[x]++; }
      }
    }
    const bbox = boundsFromCounts(rows, cols);
    let fill = null, touches = null;
    if (bbox) {
      const fx = (bbox.x1 - bbox.x0 + 1) / W, fy = (bbox.y1 - bbox.y0 + 1) / H;
      fill = { x: fx, y: fy, longest: Math.max(fx, fy) };
      touches = { top: bbox.y0 === 0, left: bbox.x0 === 0, bottom: bbox.y1 === H - 1, right: bbox.x1 === W - 1 };
    }

    // Whiteness is judged on the backdrop away from the product: soft shadows
    // and JPEG ringing right at the product's edge are allowed and expected.
    let n = 0, pure = 0, near = 0, sr = 0, sg = 0, sb = 0;
    const tally = (i) => {
      const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
      n++; sr += r; sg += g; sb += b;
      if (r === 255 && g === 255 && b === 255) pure++;
      if (r >= 250 && g >= 250 && b >= 250) near++;
    };
    const m = Math.max(2, Math.round(Math.min(W, H) * 0.03));
    const bx0 = bbox ? bbox.x0 - m : W, bx1 = bbox ? bbox.x1 + m : -1;
    const by0 = bbox ? bbox.y0 - m : H, by1 = bbox ? bbox.y1 + m : -1;
    for (let y = 0, i = 0; y < H; y++) {
      const rowOut = y < by0 || y > by1;
      for (let x = 0; x < W; x++, i++) if (mask[i] && (rowOut || x < bx0 || x > bx1)) tally(i);
    }
    if (n < W * H * 0.02) {
      // The product fills the frame: fall back to the backdrop along the border.
      n = pure = near = sr = sg = sb = 0;
      forEachBorder(W, H, borderBand(W, H), (i) => { if (mask[i]) tally(i); });
    }
    return {
      width: W, height: H, transparent,
      backdrop: model.bg, uniformity: model.uniformity,
      background: {
        coverage: bgCount / (W * H),
        pure: n ? pure / n : 0,
        near: n ? near / n : 0,
        mean: n ? [sr / n, sg / n, sb / n].map(Math.round) : null,
      },
      bbox, fill, touches,
    };
  }

  function applyGains(img, gains) {
    const luts = gains.map((g) => {
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = Math.round(v * g);
      return lut;
    });
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      d[p] = luts[0][d[p]]; d[p + 1] = luts[1][d[p + 1]]; d[p + 2] = luts[2][d[p + 2]];
    }
  }

  /* Turns the backdrop pure white while keeping the product as shot.
   *  1. Flatten transparency onto white and model the backdrop (colour + fall-off).
   *  2. Flood-fill from the border through backdrop pixels to get the mask.
   *  3. With `levels`, neutralise the colour cast the backdrop reveals and lift
   *     exposure toward its white point, but never so far that the product's own
   *     highlights clip, so white plates and chrome keep their detail.
   *  4. Paint the mask #FFFFFF and feather a 2px ring so edges stay smooth.
   * Interior gaps (inside a mug handle) are left alone. */
  function whiten(input, opts) {
    const o = Object.assign({ tolerance: 14, levels: true }, opts);
    const img = composite(input);
    const { width: W, height: H, data } = img;
    const model = backdropModel(img, DETECT_TOLERANCE);
    const res = { img, skipped: null, gains: null, backdrop: model.bg, whitened: 0 };
    if (model.uniformity < 0.6) { res.skipped = 'busy-background'; return res; }

    const tol = o.tolerance;
    const mask = floodBackground(img, model, tol);

    const bg = model.bg, top = Math.max(bg[0], bg[1], bg[2]);
    if (o.levels && Math.min(bg[0], bg[1], bg[2]) >= 120) {
      const wb = bg.map((v) => Math.min(1.25, top / Math.max(1, v)));
      // Brightest product highlight after white balance (99.5th percentile).
      const hist = new Uint32Array(256);
      let n = 0;
      for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
        if (mask[i]) continue;
        hist[Math.min(255, Math.max(data[p] * wb[0], data[p + 1] * wb[1], data[p + 2] * wb[2]) | 0)]++;
        n++;
      }
      let hi = 0;
      for (let v = 255, acc = 0; v >= 0 && n; v--) { acc += hist[v]; if (acc >= n * 0.005) { hi = v; break; } }
      const exposure = Math.max(1, Math.min(1.35, 255 / top, hi ? 252 / hi : 1.35));
      res.gains = wb.map((g) => g * exposure);
      applyGains(img, res.gains);
      const g = model.grid;
      for (let q = 0; q < g.length; q += 3) { g[q] *= res.gains[0]; g[q + 1] *= res.gains[1]; g[q + 2] *= res.gains[2]; }
    }

    // Shadow tails: grow from the backdrop through neutral pixels that are a bit
    // darker than it and change gently (shadows are soft, product edges are
    // sharp), then ramp them toward white so a shadow fades out instead of
    // ending in a hard edge. Marked 4 in the mask.
    const far = tol * 3, maxStep = 6, g = model.grid;
    const shadowLike = (i, from) => {
      if (mask[i]) return false;
      const x = i % W, y = (i / W) | 0, p = i * 4;
      const d = distToBackdrop(data, p, model, x, y);
      if (d <= tol || d > far) return false;
      const f = from * 4;
      if (Math.abs(data[p] - data[f]) > maxStep || Math.abs(data[p + 1] - data[f + 1]) > maxStep || Math.abs(data[p + 2] - data[f + 2]) > maxStep) return false;
      const q = (((y / model.step) | 0) * model.gw + ((x / model.step) | 0)) * 3;
      if (data[p] + data[p + 1] + data[p + 2] >= g[q] + g[q + 1] + g[q + 2]) return false;
      const r0 = data[p] / Math.max(1, g[q]), r1 = data[p + 1] / Math.max(1, g[q + 1]), r2 = data[p + 2] / Math.max(1, g[q + 2]);
      return Math.max(r0, r1, r2) - Math.min(r0, r1, r2) <= 0.06;
    };
    let queue = new Int32Array(4096), qn = 0;
    const enqueue = (i) => {
      if (qn === queue.length) { const s = new Int32Array(qn * 2); s.set(queue); queue = s; }
      mask[i] = 4; queue[qn++] = i;
    };
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        if (mask[i] !== 1) continue;
        if (x > 0 && shadowLike(i - 1, i)) enqueue(i - 1);
        if (x < W - 1 && shadowLike(i + 1, i)) enqueue(i + 1);
        if (y > 0 && shadowLike(i - W, i)) enqueue(i - W);
        if (y < H - 1 && shadowLike(i + W, i)) enqueue(i + W);
      }
    }
    while (qn > 0) {
      const i = queue[--qn], x = i % W;
      if (x > 0 && shadowLike(i - 1, i)) enqueue(i - 1);
      if (x < W - 1 && shadowLike(i + 1, i)) enqueue(i + 1);
      if (i >= W && shadowLike(i - W, i)) enqueue(i - W);
      if (i + W < mask.length && shadowLike(i + W, i)) enqueue(i + W);
    }

    // Feather: mark two rings of pixels just outside the backdrop and pull them
    // toward white in proportion to how backdrop-like they are.
    const soft = tol * 2.5 + 6;
    for (let pass = 2; pass <= 3; pass++) {
      const prev = pass - 1;
      for (let y = 0, i = 0; y < H; y++) {
        for (let x = 0; x < W; x++, i++) {
          if (mask[i]) continue;
          if ((x > 0 && mask[i - 1] === prev) || (x < W - 1 && mask[i + 1] === prev) ||
              (y > 0 && mask[i - W] === prev) || (y < H - 1 && mask[i + W] === prev)) mask[i] = pass;
        }
      }
    }
    let whitened = 0;
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        const m = mask[i], p = i * 4;
        if (m === 1) {
          data[p] = data[p + 1] = data[p + 2] = 255; whitened++;
        } else if (m > 1) {
          const dist = distToBackdrop(data, p, model, x, y);
          const t = m === 4 ? (far - dist) / (far - tol) : dist < soft ? Math.min(1, (soft - dist) / (soft - tol)) : 0;
          if (t > 0) {
            data[p] += (255 - data[p]) * t; data[p + 1] += (255 - data[p + 1]) * t; data[p + 2] += (255 - data[p + 2]) * t;
          }
        }
      }
    }
    res.whitened = whitened / (W * H);
    return res;
  }

  /* Where to draw the product on the output canvas. With a bbox and a fill
   * target, the product's limiting side spans exactly `fill` of the canvas and
   * is centred. Without a bbox (or fill = 0) the whole image is fitted. */
  function computeLayout(bbox, srcW, srcH, outW, outH, fill) {
    const box = bbox && fill ? bbox : { x0: 0, y0: 0, x1: srcW - 1, y1: srcH - 1 };
    const target = bbox && fill ? fill : 1;
    const sw = box.x1 - box.x0 + 1, sh = box.y1 - box.y0 + 1;
    const scale = target * Math.min(outW / sw, outH / sh);
    const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
    return {
      sx: box.x0, sy: box.y0, sw, sh,
      dx: Math.round((outW - dw) / 2), dy: Math.round((outH - dh) / 2), dw, dh,
      scale,
    };
  }

  // 1-D resampling weights with a triangle filter widened when downscaling
  // (antialiased bilinear, the approach Pillow uses).
  function weights(srcStart, srcLen, dstLen, srcLimit) {
    const scale = dstLen / srcLen;
    const support = scale < 1 ? 1 / scale : 1;
    const taps = [];
    for (let o = 0; o < dstLen; o++) {
      const center = srcStart + (o + 0.5) / scale;
      const lo = Math.max(0, Math.floor(center - support)), hi = Math.min(srcLimit - 1, Math.ceil(center + support));
      const idx = [], w = [];
      let sum = 0;
      for (let s = lo; s <= hi; s++) {
        const k = 1 - Math.abs(s + 0.5 - center) / support;
        if (k > 0) { idx.push(s); w.push(k); sum += k; }
      }
      if (!idx.length) { idx.push(Math.min(srcLimit - 1, Math.max(0, Math.floor(center)))); w.push(1); sum = 1; }
      taps.push({ idx, w: w.map((v) => v / sum) });
    }
    return taps;
  }

  // Draws the layout's source region into a new white outW x outH image.
  function render(src, layout, outW, outH) {
    const out = createImage(outW, outH, WHITE);
    const { sx, sy, sw, sh, dx, dy, dw, dh } = layout;
    const xt = weights(sx, sw, dw, src.width);
    const yt = weights(sy, sh, dh, src.height);
    let rMin = src.height, rMax = 0;
    for (const t of yt) { rMin = Math.min(rMin, t.idx[0]); rMax = Math.max(rMax, t.idx[t.idx.length - 1]); }
    const rows = rMax - rMin + 1;
    // Horizontal pass into an 8-bit RGB buffer covering only the rows we need.
    const tmp = new Uint8ClampedArray(dw * rows * 3);
    const s = src.data;
    for (let r = 0; r < rows; r++) {
      const srow = (rMin + r) * src.width;
      for (let x = 0; x < dw; x++) {
        const { idx, w } = xt[x];
        let cr = 0, cg = 0, cb = 0;
        for (let k = 0; k < idx.length; k++) {
          const p = (srow + idx[k]) * 4, wk = w[k];
          cr += s[p] * wk; cg += s[p + 1] * wk; cb += s[p + 2] * wk;
        }
        const q = (r * dw + x) * 3;
        tmp[q] = cr; tmp[q + 1] = cg; tmp[q + 2] = cb;
      }
    }
    const o = out.data;
    for (let y = 0; y < dh; y++) {
      const { idx, w } = yt[y];
      const orow = ((dy + y) * outW + dx) * 4;
      for (let x = 0; x < dw; x++) {
        let cr = 0, cg = 0, cb = 0;
        for (let k = 0; k < idx.length; k++) {
          const q = ((idx[k] - rMin) * dw + x) * 3, wk = w[k];
          cr += tmp[q] * wk; cg += tmp[q + 1] * wk; cb += tmp[q + 2] * wk;
        }
        const p = orow + x * 4;
        o[p] = cr; o[p + 1] = cg; o[p + 2] = cb;
      }
    }
    return out;
  }

  /* Reads a JPEG's frame header: dimensions, component count (4 = CMYK) and
   * whether it's progressive. Returns null for anything that isn't a JPEG. */
  function jpegInfo(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2, icc = false;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const m = bytes[i + 1];
      if (m === 0xff) { i++; continue; }
      i += 2;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
      if (m === 0xd9 || m === 0xda) break;
      if (i + 1 >= bytes.length) break;
      const len = (bytes[i] << 8) | bytes[i + 1];
      if (m === 0xe2 && String.fromCharCode(...bytes.subarray(i + 2, i + 13)) === 'ICC_PROFILE') icc = true;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        if (i + 7 >= bytes.length) break;
        return {
          height: (bytes[i + 3] << 8) | bytes[i + 4],
          width: (bytes[i + 5] << 8) | bytes[i + 6],
          components: bytes[i + 7],
          progressive: m === 0xc2,
          icc,
        };
      }
      i += len;
    }
    return null;
  }

  return {
    DETECT_TOLERANCE, createImage, composite, hasTransparency, backdropModel,
    floodBackground, analyze, whiten, computeLayout, render, jpegInfo,
  };
});
