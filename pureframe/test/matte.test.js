const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../site/js/matte.js');
const E = require('../site/js/engine.js');

function rect(W, H, [x0, y0, x1, y1], fg, bg) {
  const img = E.createImage(W, H, bg);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = (y * W + x) * 4; img.data[p] = fg[0]; img.data[p + 1] = fg[1]; img.data[p + 2] = fg[2];
  }
  return img;
}
function maskRect(W, H, [x0, y0, x1, y1], v = 1) {
  const m = new Float32Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = v;
  return m;
}

test('toTensor produces normalised NCHW data', () => {
  const img = E.createImage(10, 10, [255, 0, 128]);
  const t = M.toTensor(img, 4);
  assert.equal(t.length, 3 * 16);
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-5);          // R plane
  assert.ok(Math.abs(t[16] - (0 - 0.456) / 0.224) < 1e-5);         // G plane
  assert.ok(Math.abs(t[32] - (128 / 255 - 0.406) / 0.225) < 1e-5); // B plane
});

test('normalize stretches to [0, 1]', () => {
  assert.deepEqual(Array.from(M.normalize(Float32Array.from([2, 4, 6]))), [0, 0.5, 1]);
});

test('boxMean matches a brute-force window mean (clipped at borders)', () => {
  const W = 7, H = 5, r = 2, src = Float32Array.from({ length: W * H }, (_, i) => (i * 37) % 11);
  const fast = M.boxMean(src, W, H, r);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++)
      for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) { s += src[yy * W + xx]; n++; }
    assert.ok(Math.abs(fast[y * W + x] - s / n) < 1e-4, `(${x},${y})`);
  }
});

test('refine snaps a blurry low-res mask to the real product edge', () => {
  const W = 240, H = 240, box = [60, 50, 180, 190];
  const img = rect(W, H, box, [30, 40, 60], [200, 170, 120]);
  // Coarse 30x30 mask, blurred: what a 320px model output looks like on a big photo.
  let coarse = M.resize(maskRect(W, H, box), W, H, 30, 30);
  coarse = M.boxMean(coarse, 30, 30, 1);
  const alpha = M.refine(coarse, 30, 30, img);
  const at = (x, y) => alpha[y * W + x];
  assert.ok(at(120, 120) > 0.99, 'inside is solid');
  assert.ok(at(10, 10) < 0.01, 'far background is clear');
  assert.ok(at(62, 120) > 0.9 && at(57, 120) < 0.1, `left edge is crisp: ${at(57, 120).toFixed(2)} | ${at(62, 120).toFixed(2)}`);
  assert.ok(at(120, 192) < 0.1 && at(120, 187) > 0.9, 'bottom edge is crisp');
});

test('keepMainSubject drops small stray blobs and their fringe', () => {
  const W = 100, H = 100;
  const a = maskRect(W, H, [20, 20, 70, 70]);
  for (let y = 85; y < 90; y++) for (let x = 85; x < 90; x++) a[y * W + x] = 0.9; // stray blob
  a[84 * W + 87] = 0.3; // its soft fringe
  assert.equal(M.keepMainSubject(a, W, H, 0.15), 1);
  assert.equal(a[87 * W + 87], 0);
  assert.equal(a[84 * W + 87], 0);
  assert.equal(a[40 * W + 40], 1);
});

test('compositeOnWhite: pure white background, untouched product, decontaminated edges', () => {
  const W = 60, H = 60, bg = [40, 160, 60], fg = [200, 30, 30];
  const img = rect(W, H, [20, 20, 40, 40], fg, bg);
  const alpha = maskRect(W, H, [20, 20, 40, 40]);
  // An edge column: half product, half green background.
  for (let y = 20; y < 40; y++) {
    const i = y * W + 19, p = i * 4;
    alpha[i] = 0.5;
    for (let c = 0; c < 3; c++) img.data[p + c] = (fg[c] + bg[c]) / 2;
  }
  const out = M.compositeOnWhite(img, alpha, M.backgroundEstimate(img, alpha, 4)).data;
  const px = (x, y) => Array.from(out.slice((y * W + x) * 4, (y * W + x) * 4 + 3));
  assert.deepEqual(px(5, 5), [255, 255, 255]);
  assert.deepEqual(px(30, 30), fg);
  const edge = px(19, 30), expect = fg.map((c) => (c + 255) / 2); // product blended with white, no green
  edge.forEach((v, c) => assert.ok(Math.abs(v - expect[c]) <= 3, `edge ${edge} vs ${expect}`));
});

test('groundShadow darkens only under the product', () => {
  const W = 100, H = 100, box = { x0: 30, y0: 20, x1: 69, y1: 69 };
  const img = E.createImage(W, H, [255, 255, 255]);
  const alpha = maskRect(W, H, [30, 20, 70, 70]);
  M.groundShadow(img, alpha, box, 0.4);
  const v = (x, y) => img.data[(y * W + x) * 4];
  assert.ok(v(50, 71) < 245, `under the product: ${v(50, 71)}`);
  assert.equal(v(50, 95), 255);
  assert.equal(v(5, 71), 255);
  assert.equal(v(50, 10), 255);
});

test('bbox from alpha ignores single specks', () => {
  const W = 50, H = 50, a = maskRect(W, H, [10, 12, 30, 40]);
  a[2 * W + 45] = 1;
  assert.deepEqual(M.bbox(a, W, H), { x0: 10, y0: 12, x1: 29, y1: 39 });
});

test('compositeOnWhite samples a low-resolution background estimate', () => {
  const W = 80, H = 80, bg = [40, 160, 60], fg = [200, 30, 30];
  const img = rect(W, H, [20, 20, 60, 60], fg, bg);
  const alpha = maskRect(W, H, [20, 20, 60, 60]);
  for (let y = 20; y < 60; y++) { const i = y * W + 19; alpha[i] = 0.5; for (let c = 0; c < 3; c++) img.data[i * 4 + c] = (fg[c] + bg[c]) / 2; }
  // estimate at half resolution, composite at full
  const small = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) };
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) for (let c = 0; c < 4; c++) small.data[(y * 40 + x) * 4 + c] = img.data[((2 * y) * W + 2 * x) * 4 + c];
  const smallAlpha = M.resize(alpha, W, H, 40, 40);
  const out = M.compositeOnWhite(img, alpha, M.backgroundEstimate(small, smallAlpha, 3)).data;
  const edge = Array.from(out.slice((40 * W + 19) * 4, (40 * W + 19) * 4 + 3));
  assert.ok(edge[1] < 150, `no green fringe: ${edge}`);
  assert.deepEqual(Array.from(out.slice(0, 3)), [255, 255, 255]);
});
