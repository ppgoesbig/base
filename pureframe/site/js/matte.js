/* PureFrame matte: turns a coarse AI saliency mask into a clean cut-out on
 * pure white. Pure functions (no DOM, no model), so they run in the browser
 * (window.PFMatte) and in the Node tests. The model itself lives in cutout.js.
 *
 * Masks are Float32Array alpha in [0, 1], one value per pixel, row-major. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFMatte = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // U2-Net family input: RGB / 255, ImageNet mean/std, NCHW float32.
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

  /* Bilinear-resamples an RGBA image to size x size (ignoring aspect, as the
   * model was trained) and returns the normalised NCHW tensor data. */
  function toTensor(img, size) {
    const { width: W, height: H, data } = img;
    const n = size * size, out = new Float32Array(3 * n);
    const sx = W / size, sy = H / size;
    for (let y = 0; y < size; y++) {
      const fy = Math.min(H - 1, Math.max(0, (y + 0.5) * sy - 0.5));
      const y0 = fy | 0, y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < size; x++) {
        const fx = Math.min(W - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const x0 = fx | 0, x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
        const p00 = (y0 * W + x0) * 4, p01 = (y0 * W + x1) * 4, p10 = (y1 * W + x0) * 4, p11 = (y1 * W + x1) * 4;
        const i = y * size + x;
        for (let c = 0; c < 3; c++) {
          const top = data[p00 + c] * (1 - tx) + data[p01 + c] * tx;
          const bot = data[p10 + c] * (1 - tx) + data[p11 + c] * tx;
          out[c * n + i] = ((top * (1 - ty) + bot * ty) / 255 - MEAN[c]) / STD[c];
        }
      }
    }
    return out;
  }

  // Stretches raw model output to [0, 1] (min-max), the way U2-Net is used.
  function normalize(raw) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < raw.length; i++) { const v = raw[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const out = new Float32Array(raw.length), span = hi - lo || 1;
    for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - lo) / span;
    return out;
  }

  // Bilinear resize of a single-channel mask.
  function resize(mask, mw, mh, W, H) {
    const out = new Float32Array(W * H);
    const sx = mw / W, sy = mh / H;
    for (let y = 0; y < H; y++) {
      const fy = Math.min(mh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
      const y0 = fy | 0, y1 = Math.min(mh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(mw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const x0 = fx | 0, x1 = Math.min(mw - 1, x0 + 1), tx = fx - x0;
        const top = mask[y0 * mw + x0] * (1 - tx) + mask[y0 * mw + x1] * tx;
        const bot = mask[y1 * mw + x0] * (1 - tx) + mask[y1 * mw + x1] * tx;
        out[y * W + x] = top * (1 - ty) + bot * ty;
      }
    }
    return out;
  }

  // Mean over a (2r+1)^2 window clipped at the borders, O(N) via running sums.
  function boxMean(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let sum = 0;
      for (let x = 0; x <= Math.min(r, W - 1); x++) sum += src[row + x];
      for (let x = 0; x < W; x++) {
        const lo = x - r, hi = x + r;
        tmp[row + x] = sum / (Math.min(hi, W - 1) - Math.max(lo, 0) + 1);
        if (hi + 1 < W) sum += src[row + hi + 1];
        if (lo >= 0) sum -= src[row + lo];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = 0; y <= Math.min(r, H - 1); y++) sum += tmp[y * W + x];
      for (let y = 0; y < H; y++) {
        const lo = y - r, hi = y + r;
        out[y * W + x] = sum / (Math.min(hi, H - 1) - Math.max(lo, 0) + 1);
        if (hi + 1 < H) sum += tmp[(hi + 1) * W + x];
        if (lo >= 0) sum -= tmp[lo * W + x];
      }
    }
    return out;
  }

  function luminance(img) {
    const { width: W, height: H, data } = img, out = new Float32Array(W * H);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
    return out;
  }

  /* Guided filter (He et al.): smooths the mask while snapping its edges to
   * edges in the guide image, which turns a blurry low-res mask into one that
   * follows the real product outline. */
  function guidedFilter(guide, p, W, H, r, eps) {
    const N = W * H, Ip = new Float32Array(N), II = new Float32Array(N);
    for (let i = 0; i < N; i++) { Ip[i] = guide[i] * p[i]; II[i] = guide[i] * guide[i]; }
    const mI = boxMean(guide, W, H, r), mP = boxMean(p, W, H, r);
    const mIp = boxMean(Ip, W, H, r), mII = boxMean(II, W, H, r);
    const a = Ip, b = II; // reuse buffers
    for (let i = 0; i < N; i++) {
      const varI = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mP[i];
      a[i] = cov / (varI + eps);
      b[i] = mP[i] - a[i] * mI[i];
    }
    const mA = boxMean(a, W, H, r), mB = boxMean(b, W, H, r);
    const q = new Float32Array(N);
    for (let i = 0; i < N; i++) q[i] = Math.min(1, Math.max(0, mA[i] * guide[i] + mB[i]));
    return q;
  }

  /* Keeps the main subject: labels connected regions of alpha > 0.5 and clears
   * the ones much smaller than the largest (stray props, background clutter
   * the model half-picked up). Modifies alpha in place; returns regions kept. */
  function keepMainSubject(alpha, W, H, minShare) {
    const N = W * H, label = new Int32Array(N), areas = [0];
    const stack = new Int32Array(N);
    let next = 1;
    for (let s = 0; s < N; s++) {
      if (label[s] || alpha[s] <= 0.5) continue;
      let sp = 0, area = 0;
      stack[sp++] = s; label[s] = next;
      while (sp) {
        const i = stack[--sp], x = i % W;
        area++;
        if (x > 0 && !label[i - 1] && alpha[i - 1] > 0.5) { label[i - 1] = next; stack[sp++] = i - 1; }
        if (x < W - 1 && !label[i + 1] && alpha[i + 1] > 0.5) { label[i + 1] = next; stack[sp++] = i + 1; }
        if (i >= W && !label[i - W] && alpha[i - W] > 0.5) { label[i - W] = next; stack[sp++] = i - W; }
        if (i + W < N && !label[i + W] && alpha[i + W] > 0.5) { label[i + W] = next; stack[sp++] = i + W; }
      }
      areas.push(area); next++;
    }
    let largest = 0;
    for (const a of areas) if (a > largest) largest = a;
    if (!largest) return 0;
    const share = minShare == null ? 0.15 : minShare;
    const kept = new Float32Array(N);
    let count = 0;
    for (let l = 1; l < areas.length; l++) if (areas[l] >= largest * share) count++;
    for (let i = 0; i < N; i++) {
      const l = label[i];
      if (l && areas[l] >= largest * share) kept[i] = 1;
      else if (l) alpha[i] = 0;
    }
    // Soft edge pixels (alpha <= 0.5) only survive near a kept region, so the
    // faint fringe of a dropped blob goes with it.
    const near = boxMean(kept, W, H, Math.max(2, Math.round(Math.max(W, H) / 200)));
    for (let i = 0; i < N; i++) if (near[i] === 0) alpha[i] = 0;
    return count;
  }

  // Product bounds from alpha (rows/columns with a few solid pixels).
  function bbox(alpha, W, H, thr) {
    const t = thr == null ? 0.5 : thr;
    const rows = new Uint32Array(H), cols = new Uint32Array(W);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (alpha[i] > t) { rows[y]++; cols[x]++; }
    const minC = Math.max(2, Math.round(H * 0.002)), minR = Math.max(2, Math.round(W * 0.002));
    let x0 = -1, x1 = -1, y0 = -1, y1 = -1;
    for (let x = 0; x < W; x++) if (cols[x] >= minC) { if (x0 < 0) x0 = x; x1 = x; }
    for (let y = 0; y < H; y++) if (rows[y] >= minR) { if (y0 < 0) y0 = y; y1 = y; }
    return x0 < 0 || y0 < 0 ? null : { x0, y0, x1, y1 };
  }

  /* Local background colour around the product edge: the mean colour of
   * nearby clearly-background pixels (alpha < 0.1). Smooth by nature, so it is
   * computed at the (small) refine resolution and sampled up later. */
  function backgroundEstimate(img, alpha, r) {
    const { width: W, height: H, data } = img, N = W * H;
    const k = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      if (alpha[i] >= 0.1) continue;
      k[i] = 1; cr[i] = data[p]; cg[i] = data[p + 1]; cb[i] = data[p + 2];
    }
    const mk = boxMean(k, W, H, r), mr = boxMean(cr, W, H, r), mg = boxMean(cg, W, H, r), mb = boxMean(cb, W, H, r);
    for (let i = 0; i < N; i++) {
      const w = mk[i] > 1e-3 ? 1 / mk[i] : -1;
      // -1 marks "no background nearby" (deep inside the product).
      mr[i] = w > 0 ? mr[i] * w : -1; mg[i] = w > 0 ? mg[i] * w : -1; mb[i] = w > 0 ? mb[i] * w : -1;
    }
    return { width: W, height: H, r: mr, g: mg, b: mb };
  }

  function sample(arr, W, H, fx, fy) {
    const x = Math.min(W - 1, Math.max(0, fx)), y = Math.min(H - 1, Math.max(0, fy));
    const x0 = x | 0, y0 = y | 0, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = x - x0, ty = y - y0;
    return (arr[y0 * W + x0] * (1 - tx) + arr[y0 * W + x1] * tx) * (1 - ty) + (arr[y1 * W + x0] * (1 - tx) + arr[y1 * W + x1] * tx) * ty;
  }

  /* Composites the photo onto pure white using alpha (at the photo's size),
   * with colour decontamination: an edge pixel C is a blend of product F and
   * background B, C = aF + (1-a)B. On white the same pixel is aF + (1-a)255,
   * which equals C + (1-a)(255 - B). B comes from backgroundEstimate (any
   * resolution), so edges lose the old background's colour instead of keeping
   * a halo. */
  function compositeOnWhite(img, alpha, bg) {
    const { width: W, height: H, data } = img, N = W * H;
    const sx = bg.width / W, sy = bg.height / H;
    const out = { width: W, height: H, data: new Uint8ClampedArray(N * 4) };
    const o = out.data;
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        const p = i * 4, a = alpha[i];
        o[p + 3] = 255;
        if (a < 0.04) { o[p] = o[p + 1] = o[p + 2] = 255; continue; }
        if (a > 0.98) { o[p] = data[p]; o[p + 1] = data[p + 1]; o[p + 2] = data[p + 2]; continue; }
        const k = 1 - a, fx = (x + 0.5) * sx - 0.5, fy = (y + 0.5) * sy - 0.5;
        let br = sample(bg.r, bg.width, bg.height, fx, fy);
        let bgc = sample(bg.g, bg.width, bg.height, fx, fy);
        let bb = sample(bg.b, bg.width, bg.height, fx, fy);
        if (br < 0 || bgc < 0 || bb < 0) { br = data[p]; bgc = data[p + 1]; bb = data[p + 2]; }
        o[p] = data[p] + k * (255 - br);
        o[p + 1] = data[p + 1] + k * (255 - bgc);
        o[p + 2] = data[p + 2] + k * (255 - bb);
      }
    }
    return out;
  }

  /* Adds a soft ground shadow under the product: an ellipse as wide as its
   * base, blurred and multiplied in under the bottom of the bbox. Works in a
   * small window around the shadow only. */
  function groundShadow(img, alpha, box, strength) {
    if (!box) return img;
    const { width: W, height: H, data } = img;
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    const cx = (box.x0 + box.x1) / 2, cy = box.y1 + bh * 0.01;
    const rx = bw * 0.48, ry = Math.max(3, bh * 0.035), blur = Math.max(2, Math.round(ry));
    const wx0 = Math.max(0, Math.floor(cx - rx - 3 * blur)), wx1 = Math.min(W - 1, Math.ceil(cx + rx + 3 * blur));
    const wy0 = Math.max(0, Math.floor(cy - ry - 3 * blur)), wy1 = Math.min(H - 1, Math.ceil(cy + ry + 3 * blur));
    const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1;
    if (ww < 2 || wh < 2) return img;
    const sh = new Float32Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const d = ((x + wx0 - cx) / rx) ** 2 + ((y + wy0 - cy) / ry) ** 2;
      if (d < 1) sh[y * ww + x] = 1 - d;
    }
    const blurred = boxMean(boxMean(sh, ww, wh, blur), ww, wh, blur);
    const k = strength == null ? 0.35 : strength;
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = (y + wy0) * W + x + wx0, s = blurred[y * ww + x] * k * (1 - alpha[i]);
      if (s > 0.004) { const p = i * 4, m = 1 - s; data[p] *= m; data[p + 1] *= m; data[p + 2] *= m; }
    }
    return img;
  }

  /* Full refinement: coarse model mask (mw x mh) -> clean alpha at W x H.
   * guideImg is the photo at W x H. */
  function refine(coarse, mw, mh, guideImg) {
    const { width: W, height: H } = guideImg;
    const up = resize(coarse, mw, mh, W, H);
    // The window must span the blur of the upscaled mask to recover a sharp edge.
    const r = Math.max(3, Math.round(2 * Math.max(W / mw, H / mh)));
    // eps and the 0.25-0.75 ramp were tuned on real photos against U2-Netp:
    // smaller values let background texture (gravel, wood grain) cling to edges.
    const alpha = guidedFilter(luminance(guideImg), up, W, H, r, 1e-2);
    // Firm up the matte: clear haze, keep a soft 1-2 px edge.
    for (let i = 0; i < alpha.length; i++) {
      const t = Math.min(1, Math.max(0, (alpha[i] - 0.25) / 0.5));
      alpha[i] = t * t * (3 - 2 * t);
    }
    keepMainSubject(alpha, W, H, 0.15);
    return alpha;
  }

  return { MEAN, STD, toTensor, normalize, resize, boxMean, luminance, guidedFilter, keepMainSubject, bbox, backgroundEstimate, compositeOnWhite, groundShadow, refine };
});
