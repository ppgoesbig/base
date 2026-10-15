// Run with: node --test pureframe/test
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../site/js/engine.js');

// Deterministic noise so tests don't flake.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// A product shot: an ellipse "product" on a flat backdrop with sensor noise.
function scene({ w = 400, h = 300, bg = [235, 235, 238], fg = [40, 90, 160], box = [100, 60, 300, 240], noise = 2, alpha = false, seed = 1 }) {
  const img = E.createImage(w, h);
  const rand = rng(seed);
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const inside = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
      const c = inside ? fg : bg;
      for (let k = 0; k < 3; k++) img.data[p + k] = c[k] + Math.round((rand() - 0.5) * 2 * noise);
      img.data[p + 3] = alpha ? (inside ? 255 : 0) : 255;
    }
  }
  return img;
}

test('analyze measures product bounds and fill on a grey backdrop', () => {
  const a = E.analyze(scene({}));
  assert.ok(a.bbox, 'found product');
  assert.ok(Math.abs(a.bbox.x0 - 100) <= 2 && Math.abs(a.bbox.x1 - 299) <= 2, JSON.stringify(a.bbox));
  assert.ok(Math.abs(a.bbox.y0 - 60) <= 2 && Math.abs(a.bbox.y1 - 239) <= 2, JSON.stringify(a.bbox));
  assert.ok(Math.abs(a.fill.longest - 0.6) < 0.02, `fill ${a.fill.longest}`);
  assert.ok(a.background.pure < 0.01, 'grey backdrop is not pure white');
  assert.ok(a.uniformity > 0.95);
  assert.deepEqual(a.touches, { top: false, left: false, bottom: false, right: false });
});

test('analyze reports a pure white backdrop as pure', () => {
  const a = E.analyze(scene({ bg: [255, 255, 255], noise: 0 }));
  assert.equal(a.background.pure, 1);
  assert.equal(a.background.near, 1);
});

test('analyze ignores dust specks when computing bounds', () => {
  const img = scene({ bg: [255, 255, 255], noise: 0 });
  // three isolated dark specks near the corners
  for (const [x, y] of [[5, 5], [390, 8], [10, 290]]) {
    const p = (y * img.width + x) * 4;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = 0;
  }
  const a = E.analyze(img);
  assert.ok(a.bbox.x0 >= 98 && a.bbox.x1 <= 301, JSON.stringify(a.bbox));
});

test('analyze flags a product that touches the frame edge', () => {
  const a = E.analyze(scene({ box: [100, 60, 300, 300] }));
  assert.equal(a.touches.bottom, true);
  assert.equal(a.touches.top, false);
});

test('analyze treats transparent pixels as white', () => {
  const a = E.analyze(scene({ alpha: true, noise: 0 }));
  assert.equal(a.transparent, true);
  assert.equal(a.background.pure, 1);
  assert.ok(Math.abs(a.fill.longest - 0.6) < 0.02);
});

test('analyze reports low uniformity for a busy background', () => {
  const img = E.createImage(200, 200);
  const rand = rng(7);
  for (let p = 0; p < img.data.length; p += 4) {
    img.data[p] = rand() * 255; img.data[p + 1] = rand() * 255; img.data[p + 2] = rand() * 255; img.data[p + 3] = 255;
  }
  const a = E.analyze(img);
  assert.ok(a.uniformity < 0.3, `uniformity ${a.uniformity}`);
});

test('whiten turns a grey, colour-cast backdrop pure white and keeps the product', () => {
  const src = scene({ bg: [228, 232, 240], noise: 3 });
  const { img, skipped, gains } = E.whiten(src);
  assert.equal(skipped, null);
  assert.ok(gains, 'applied white-point correction');
  const a = E.analyze(img);
  assert.ok(a.background.pure > 0.99, `pure ${a.background.pure}`);
  // Product centre keeps its hue: still clearly blue.
  const p = (150 * img.width + 200) * 4;
  assert.ok(img.data[p + 2] > img.data[p] + 60, 'product still blue');
  assert.ok(Math.abs(a.fill.longest - 0.6) < 0.02);
});

test('whiten leaves an enclosed light area alone (white products keep shading)', () => {
  // dark ring product with a light-grey hole the flood fill can't reach
  const img = scene({ bg: [255, 255, 255], fg: [30, 30, 30], noise: 0 });
  const hole = [240, 240, 240];
  for (let y = 130; y < 170; y++) for (let x = 180; x < 220; x++) {
    const p = (y * img.width + x) * 4;
    img.data[p] = hole[0]; img.data[p + 1] = hole[1]; img.data[p + 2] = hole[2];
  }
  const out = E.whiten(img).img;
  const p = (150 * img.width + 200) * 4;
  assert.deepEqual([out.data[p], out.data[p + 1], out.data[p + 2]], hole);
});

test('whiten skips busy backgrounds instead of damaging them', () => {
  const img = E.createImage(120, 120);
  const rand = rng(3);
  for (let p = 0; p < img.data.length; p += 4) {
    img.data[p] = rand() * 255; img.data[p + 1] = rand() * 255; img.data[p + 2] = rand() * 255; img.data[p + 3] = 255;
  }
  assert.equal(E.whiten(img).skipped, 'busy-background');
});

test('whiten flattens transparency', () => {
  const { img } = E.whiten(scene({ alpha: true, noise: 0 }));
  assert.equal(E.hasTransparency(img), false);
  assert.equal(E.analyze(img).background.pure, 1);
});

test('computeLayout centres the product at the target fill', () => {
  const L = E.computeLayout({ x0: 100, y0: 60, x1: 299, y1: 239 }, 400, 300, 2000, 2000, 0.85);
  assert.equal(L.dw, 1700); // the 200px-wide product spans 85% of 2000
  assert.equal(L.dh, 1530);
  assert.equal(L.dx, 150);
  assert.equal(L.dy, 235);
});

test('computeLayout without a bbox fits the whole image', () => {
  const L = E.computeLayout(null, 400, 200, 1000, 1000, 0.85);
  assert.equal(L.dw, 1000);
  assert.equal(L.dh, 500);
  assert.equal(L.dy, 250);
});

test('full pipeline: whiten + reframe passes Amazon-style checks', () => {
  const src = scene({ w: 800, h: 600, box: [300, 200, 500, 400], bg: [236, 236, 236], noise: 3 });
  const before = E.analyze(src);
  assert.ok(before.fill.longest < 0.4);
  const { img } = E.whiten(src);
  const bbox = E.analyze(img).bbox;
  const L = E.computeLayout(bbox, img.width, img.height, 1000, 1000, 0.88);
  const out = E.render(img, L, 1000, 1000);
  const after = E.analyze(out);
  assert.ok(after.background.pure > 0.99, `pure ${after.background.pure}`);
  assert.ok(Math.abs(after.fill.longest - 0.88) < 0.02, `fill ${after.fill.longest}`);
  assert.equal(out.width, 1000);
  assert.equal(out.height, 1000);
});

test('render downscales smoothly (antialiased) and upscales', () => {
  // 1px black/white checkerboard downscaled 4x should average to mid-grey.
  const src = E.createImage(400, 400);
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) {
    const p = (y * 400 + x) * 4, v = (x + y) % 2 ? 255 : 0;
    src.data[p] = src.data[p + 1] = src.data[p + 2] = v; src.data[p + 3] = 255;
  }
  const down = E.render(src, E.computeLayout(null, 400, 400, 100, 100, 0), 100, 100);
  const mid = (50 * 100 + 50) * 4;
  assert.ok(Math.abs(down.data[mid] - 128) < 8, `got ${down.data[mid]}`);
  const up = E.render(scene({ w: 50, h: 50, box: [10, 10, 40, 40], noise: 0 }), E.computeLayout(null, 50, 50, 500, 500, 0), 500, 500);
  assert.equal(up.width, 500);
});

test('jpegInfo reads dimensions and component count', () => {
  // Minimal SOF0 segment: FFD8, FFC0 len=17, precision 8, h=300, w=400, 3 comps
  const sof = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  assert.deepEqual(E.jpegInfo(Uint8Array.from(sof)), { height: 300, width: 400, components: 3, progressive: false, icc: false });
  const cmyk = sof.slice(); cmyk[11] = 4;
  assert.equal(E.jpegInfo(Uint8Array.from(cmyk)).components, 4);
  assert.equal(E.jpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), null);
});

test('soft shadows next to the product don\'t count against a white backdrop', () => {
  const img = scene({ w: 600, h: 600, box: [150, 150, 450, 450], bg: [255, 255, 255], noise: 0 });
  // a soft grey gradient (shadow tail) hugging the bottom of the product
  for (let y = 450; y < 462; y++) for (let x = 150; x < 450; x++) {
    const p = (y * 600 + x) * 4, v = 236 + (y - 450) * 1.5;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
  }
  const a = E.analyze(img);
  assert.equal(a.background.pure, 1);
});

// Radial fall-off like a studio sweep: centre `bg`, corners darker by `drop`.
function vignette(img, drop) {
  const { width: w, height: h, data } = img, R = Math.hypot(w / 2, h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4, k = drop * (Math.hypot(x - w / 2, y - h / 2) / R) ** 2;
    data[p] -= k; data[p + 1] -= k; data[p + 2] -= k;
  }
  return img;
}

test('a white plate on a grey backdrop keeps its detail (no blown highlights)', () => {
  const img = scene({ w: 500, h: 500, bg: [226, 226, 226], fg: [246, 246, 246], box: [100, 100, 400, 400], noise: 1 });
  // darker rim so the plate has a visible edge, like a real plate
  for (let y = 0; y < 500; y++) for (let x = 0; x < 500; x++) {
    const r = Math.hypot(x + 0.5 - 250, y + 0.5 - 250);
    if (r > 146 && r <= 150) { const p = (y * 500 + x) * 4; img.data[p] = img.data[p + 1] = img.data[p + 2] = 205; }
  }
  const { img: out } = E.whiten(img);
  const centre = (250 * 500 + 250) * 4;
  assert.ok(out.data[centre] < 254 && out.data[centre] >= 244, `plate centre ${out.data[centre]}`);
  const a = E.analyze(out);
  assert.ok(a.background.pure > 0.99, `pure ${a.background.pure}`);
  assert.ok(Math.abs(a.fill.longest - 0.6) < 0.02, `fill ${a.fill.longest}`);
});

test('a strong vignette is followed, not mistaken for product', () => {
  const src = vignette(scene({ w: 600, h: 400, bg: [238, 238, 238], box: [200, 120, 400, 280], noise: 2 }), 45);
  const before = E.analyze(src);
  assert.ok(Math.abs(before.fill.longest - 0.4) < 0.03, `measured fill ${before.fill.longest}`);
  const { img, skipped } = E.whiten(src);
  assert.equal(skipped, null);
  const a = E.analyze(img);
  assert.ok(a.background.pure > 0.99, `pure ${a.background.pure}`);
});

test('specular highlights cap the exposure lift (chrome stays unclipped)', () => {
  const img = scene({ w: 300, h: 300, bg: [230, 230, 230], fg: [120, 120, 125], box: [80, 80, 220, 220], noise: 0 });
  for (let y = 120; y < 160; y++) for (let x = 120; x < 160; x++) {
    const p = (y * 300 + x) * 4; img.data[p] = img.data[p + 1] = img.data[p + 2] = 252;
  }
  const { gains } = E.whiten(img);
  assert.ok(gains.every((g) => g <= 1.001), `gains ${gains}`);
  const { gains: lifted } = E.whiten(scene({ w: 300, h: 300, bg: [230, 230, 230], fg: [120, 120, 125], box: [80, 80, 220, 220], noise: 0 }));
  assert.ok(lifted[0] > 1.05, 'a matte product does get brightened');
});

test('soft shadows fade into the white backdrop without a hard edge', () => {
  const img = scene({ w: 400, h: 400, bg: [228, 228, 228], fg: [40, 60, 120], box: [100, 80, 300, 240], noise: 0 });
  // shadow under the product: 70 levels darker at the contact line, fading over 60 px
  for (let y = 240; y < 300; y++) for (let x = 110; x < 290; x++) {
    const p = (y * 400 + x) * 4, k = 70 * (1 - (y - 240) / 60) ** 2;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = 228 - k;
  }
  const { img: out } = E.whiten(img);
  let maxJump = 0;
  for (let y = 241; y < 320; y++) {
    const a = out.data[((y - 1) * 400 + 200) * 4], b = out.data[(y * 400 + 200) * 4];
    maxJump = Math.max(maxJump, Math.abs(a - b));
  }
  assert.ok(maxJump <= 12, `largest step down the shadow: ${maxJump}`);
  assert.equal(out.data[(330 * 400 + 200) * 4], 255, 'below the shadow is pure white');
  assert.ok(out.data[(242 * 400 + 200) * 4] < 200, 'shadow core is kept');
});
