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
    const model = { bg, band, step, gw, grid, uniformity: 0, roughness: 0 };
    let similar = 0;
    forEachBorder(W, H, band, (i) => { if (distToBackdrop(data, i * 4, model, i % W, (i / W) | 0) <= tol) similar++; });
    model.uniformity = similar / n;
    model.roughness = roughness(img, band);
    return model;
  }

  /* Texture of the border band: mean luminance change between pixels a fixed
   * fraction of the image apart. Seamless paper and sweeps are smooth (well
   * under 3, mostly sensor noise); tables, bricks and rooms are rough. */
  const ROUGH = 5;
  function roughness(img, band) {
    const { width: W, height: H, data } = img;
    const s = Math.max(1, Math.round((2 * Math.max(W, H)) / 1000));
    const lum = (i) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    let sum = 0, n = 0;
    forEachBorder(W, H, band, (i) => {
      const x = i % W, y = (i / W) | 0, l = lum(i);
      if (x + s < W) { sum += Math.abs(lum(i + s) - l); n++; }
      if (y + s < H) { sum += Math.abs(lum(i + s * W) - l); n++; }
    });
    return n ? sum / n : 0;
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

  /* Splits the non-backdrop pixels into connected regions on a coarse grid
   * and picks out the product: the largest region plus anything close to it or
   * of comparable size (handles, pairs, sets). Everything else is a stray mark:
   * dust, a scuff on the sweep, a crumb. Returns the grid cells that belong to
   * the product and the stray tally. */
  function productGroup(mask, W, H) {
    const cell = Math.max(1, Math.round(Math.max(W, H) / 400));
    const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), G = gw * gh;
    const count = new Uint32Array(G);
    for (let y = 0, i = 0; y < H; y++) {
      const row = ((y / cell) | 0) * gw;
      for (let x = 0; x < W; x++, i++) if (!mask[i]) count[row + ((x / cell) | 0)]++;
    }
    const label = new Int32Array(G).fill(-1), stack = new Int32Array(G), comps = [];
    for (let s0 = 0; s0 < G; s0++) {
      if (!count[s0] || label[s0] >= 0) continue;
      const c = { id: comps.length, pixels: 0, x0: gw, y0: gh, x1: -1, y1: -1 };
      let sp = 0;
      stack[sp++] = s0; label[s0] = c.id;
      while (sp) {
        const k = stack[--sp], kx = k % gw, ky = (k / gw) | 0;
        c.pixels += count[k];
        if (kx < c.x0) c.x0 = kx; if (kx > c.x1) c.x1 = kx; if (ky < c.y0) c.y0 = ky; if (ky > c.y1) c.y1 = ky;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = kx + dx, ny = ky + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const nk = ny * gw + nx;
          if (count[nk] && label[nk] < 0) { label[nk] = c.id; stack[sp++] = nk; }
        }
      }
      comps.push(c);
    }
    if (!comps.length) return null;
    let main = comps[0];
    for (const c of comps) if (c.pixels > main.pixels) main = c;
    const inGroup = new Uint8Array(comps.length);
    inGroup[main.id] = 1;
    const gb = { x0: main.x0, y0: main.y0, x1: main.x1, y1: main.y1 };
    const gap = Math.max(1, Math.round(Math.max(gw, gh) * 0.02));
    for (let changed = true; changed;) {
      changed = false;
      for (const c of comps) {
        if (inGroup[c.id]) continue;
        const dx = Math.max(0, c.x0 - gb.x1, gb.x0 - c.x1), dy = Math.max(0, c.y0 - gb.y1, gb.y0 - c.y1);
        if (Math.max(dx, dy) <= gap || c.pixels >= main.pixels * 0.05) {
          inGroup[c.id] = 1; changed = true;
          gb.x0 = Math.min(gb.x0, c.x0); gb.y0 = Math.min(gb.y0, c.y0); gb.x1 = Math.max(gb.x1, c.x1); gb.y1 = Math.max(gb.y1, c.y1);
        }
      }
    }
    let strayCount = 0, strayPixels = 0;
    for (const c of comps) if (!inGroup[c.id] && c.pixels >= 3) { strayCount++; strayPixels += c.pixels; } // 1-2 px is sensor noise
    const cellIn = new Uint8Array(G);
    for (let k = 0; k < G; k++) if (label[k] >= 0 && inGroup[label[k]]) cellIn[k] = 1;
    return { cell, gw, cellIn, strayCount, strayPixels };
  }

  /* Measures an image the way marketplace checks do:
   *   background  share of backdrop pixels that are pure #FFFFFF / near-white
   *   bbox, fill  product bounds and how much of the frame they span
   *               (stray marks on the backdrop are excluded and counted in stray)
   *   fullBbox    bounds of everything that isn't backdrop, marks included
   *   touches     which image edges the product reaches (looks cropped)
   *   uniformity  how plain the border is (low = lifestyle/busy background) */
  function analyze(input, opts) {
    const tol = (opts && opts.tolerance) || DETECT_TOLERANCE;
    const transparent = hasTransparency(input);
    const img = transparent ? composite(input) : input;
    const { width: W, height: H, data } = img;
    const model = backdropModel(img, tol);
    const mask = floodBackground(img, model, tol);

    const grp = productGroup(mask, W, H);
    const rows = new Uint32Array(H), cols = new Uint32Array(W);
    const prows = new Uint32Array(H), pcols = new Uint32Array(W);
    let bgCount = 0;
    for (let y = 0, i = 0; y < H; y++) {
      const crow = grp ? ((y / grp.cell) | 0) * grp.gw : 0;
      for (let x = 0; x < W; x++, i++) {
        if (mask[i]) { bgCount++; continue; }
        rows[y]++; cols[x]++;
        if (grp && grp.cellIn[crow + ((x / grp.cell) | 0)]) { prows[y]++; pcols[x]++; }
      }
    }
    const fullBbox = boundsFromCounts(rows, cols);
    const bbox = grp ? boundsFromCounts(prows, pcols) || fullBbox : fullBbox;
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
    // Not a plain backdrop: a cluttered or textured border, or a "product" that
    // fills the whole frame because the backdrop never separated from it.
    const edgesTouched = touches ? Object.values(touches).filter(Boolean).length : 0;
    const busy = model.uniformity < 0.6 || model.roughness > ROUGH || (!!fill && fill.x >= 0.97 && fill.y >= 0.97 && edgesTouched >= 3);
    return {
      width: W, height: H, transparent, busy,
      backdrop: model.bg, uniformity: model.uniformity, roughness: model.roughness,
      background: {
        coverage: bgCount / (W * H),
        pure: n ? pure / n : 0,
        near: n ? near / n : 0,
        mean: n ? [sr / n, sg / n, sb / n].map(Math.round) : null,
      },
      bbox, fill, touches, fullBbox,
      stray: { count: grp ? grp.strayCount : 0, pixels: grp ? grp.strayPixels : 0 },
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

  // Grid regions of backdrop-coloured, still non-white pixels the flood fill couldn't reach.
  function enclosedBackdrop(img, mask, model, tol) {
    const { width: W, height: H, data } = img;
    const cell = Math.max(1, Math.round(Math.max(W, H) / 300));
    const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), G = gw * gh;
    const hits = new Uint32Array(G), area = new Uint32Array(G);
    for (let y = 0, i = 0; y < H; y++) {
      const row = ((y / cell) | 0) * gw;
      for (let x = 0; x < W; x++, i++) {
        const k = row + ((x / cell) | 0), p = i * 4;
        area[k]++;
        if (mask[i] || Math.min(data[p], data[p + 1], data[p + 2]) >= 250) continue;
        // Backdrop seen through a gap matches the backdrop within noise; a white
        // product's interior is usually brighter than a grey backdrop (it's lit).
        const q = (((y / model.step) | 0) * model.gw + ((x / model.step) | 0)) * 3, g = model.grid;
        const lum = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
        const bgLum = g[q] * 0.299 + g[q + 1] * 0.587 + g[q + 2] * 0.114;
        if (distToBackdrop(data, p, model, x, y) <= tol * 0.5 && lum <= bgLum + 3) hits[k]++;
      }
    }
    const on = new Uint8Array(G);
    for (let k = 0; k < G; k++) if (hits[k] * 2 >= area[k]) on[k] = 1;
    const seen = new Uint8Array(G), stack = new Int32Array(G), minPx = W * H * 0.0005;
    let regions = 0, pixels = 0;
    for (let s0 = 0; s0 < G; s0++) {
      if (!on[s0] || seen[s0]) continue;
      let sp = 0, px = 0;
      stack[sp++] = s0; seen[s0] = 1;
      while (sp) {
        const k = stack[--sp], kx = k % gw;
        px += hits[k];
        const nb = [kx > 0 ? k - 1 : -1, kx < gw - 1 ? k + 1 : -1, k >= gw ? k - gw : -1, k + gw < G ? k + gw : -1];
        for (const n of nb) if (n >= 0 && on[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; }
      }
      if (px >= minPx) { regions++; pixels += px; }
    }
    return { regions, share: pixels / (W * H) };
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
    const res = { img, skipped: null, gains: null, backdrop: model.bg, whitened: 0, enclosed: null };
    if (model.uniformity < 0.6 || model.roughness > ROUGH) { res.skipped = 'busy-background'; return res; }

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

    // Backdrop showing through enclosed gaps (inside a handle, between parts)
    // isn't reachable from the border, so it isn't whitened: white products keep
    // their shading. Measure what's left that a checker could read as grey.
    res.enclosed = enclosedBackdrop(img, mask, model, tol);

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

  /* Snaps near-white pixels (every channel >= threshold) to exact white.
   * Values of 250-254 are invisible against white, but they are exactly what
   * a strict background checker counts as "off-white", e.g. the faint outer
   * tail of a soft shadow. Returns how many pixels changed. */
  function snapWhite(img, threshold) {
    const t = threshold == null ? 250 : threshold, d = img.data;
    let n = 0;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p] >= t && d[p + 1] >= t && d[p + 2] >= t && (d[p] !== 255 || d[p + 1] !== 255 || d[p + 2] !== 255)) {
        d[p] = d[p + 1] = d[p + 2] = 255; n++;
      }
    }
    return n;
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
  // (antialiased bilinear, the approach Pillow uses). Source positions outside
  // the image count as white ("out" weight), so the canvas around a reframed
  // product is clean instead of smearing edge pixels.
  function weights(srcStart, srcLen, dstLen, srcLimit) {
    const scale = dstLen / srcLen;
    const support = scale < 1 ? 1 / scale : 1;
    const taps = [];
    for (let o = 0; o < dstLen; o++) {
      const center = srcStart + (o + 0.5) / scale;
      const lo = Math.floor(center - support), hi = Math.ceil(center + support);
      const idx = [], w = [];
      let sum = 0, out = 0;
      for (let s = lo; s <= hi; s++) {
        const k = 1 - Math.abs(s + 0.5 - center) / support;
        if (k <= 0) continue;
        if (s < 0 || s >= srcLimit) out += k; else { idx.push(s); w.push(k); }
        sum += k;
      }
      if (!sum) {
        const s = Math.floor(center);
        if (s < 0 || s >= srcLimit) { out = 1; sum = 1; } else { idx.push(s); w.push(1); sum = 1; }
      }
      taps.push({ idx, w: w.map((v) => v / sum), out: out / sum });
    }
    return taps;
  }

  /* Expands a layout so it covers the whole output canvas with the same
   * transform: everything around the product that falls inside the frame is
   * kept (and checked) rather than silently dropped. */
  function canvasLayout(layout, outW, outH) {
    const s = layout.dw / layout.sw;
    return { sx: layout.sx - layout.dx / s, sy: layout.sy - layout.dy / s, sw: outW / s, sh: outH / s, dx: 0, dy: 0, dw: outW, dh: outH, scale: layout.scale };
  }

  // Draws the layout's source region into a new white outW x outH image.
  function render(src, layout, outW, outH) {
    const out = createImage(outW, outH, WHITE);
    const { sx, sy, sw, sh, dx, dy, dw, dh } = layout;
    const xt = weights(sx, sw, dw, src.width);
    const yt = weights(sy, sh, dh, src.height);
    let rMin = src.height, rMax = -1;
    for (const t of yt) if (t.idx.length) { rMin = Math.min(rMin, t.idx[0]); rMax = Math.max(rMax, t.idx[t.idx.length - 1]); }
    if (rMax < rMin) return out; // the source doesn't reach the canvas at all
    const rows = rMax - rMin + 1;
    // Horizontal pass into an 8-bit RGB buffer covering only the rows we need.
    const tmp = new Uint8ClampedArray(dw * rows * 3);
    const s = src.data;
    for (let r = 0; r < rows; r++) {
      const srow = (rMin + r) * src.width;
      for (let x = 0; x < dw; x++) {
        const { idx, w, out: ow } = xt[x];
        let cr = 255 * ow, cg = cr, cb = cr;
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
      const { idx, w, out: ow } = yt[y];
      const orow = ((dy + y) * outW + dx) * 4;
      for (let x = 0; x < dw; x++) {
        let cr = 255 * ow, cg = cr, cb = cr;
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
    DETECT_TOLERANCE, ROUGH, createImage, composite, hasTransparency, backdropModel,
    floodBackground, analyze, whiten, snapWhite, computeLayout, canvasLayout, render, jpegInfo,
  };
});
