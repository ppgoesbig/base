const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../site/js/rules.js');

const good = {
  transparent: false, uniformity: 0.99, backdrop: [255, 255, 255],
  background: { coverage: 0.4, pure: 0.995, near: 1, mean: [255, 255, 255] },
  bbox: { x0: 100, y0: 100, x1: 1900, y1: 1900 },
  fill: { x: 0.9, y: 0.9, longest: 0.9 },
  touches: { top: false, left: false, bottom: false, right: false },
};
const file = { name: 'B000123456.MAIN.jpg', type: 'image/jpeg', size: 800 * 1024, width: 2000, height: 2000, jpeg: { components: 3 } };
const byId = (r, id) => r.checks.find((c) => c.id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));

test('a compliant Amazon main image passes every check', () => {
  const r = R.evaluate(good, file, R.preset('amazon'));
  assert.equal(r.status, 'pass', JSON.stringify(r.checks.filter((c) => c.status !== 'pass')));
});

test('grey backdrop fails Amazon but only warns on eBay', () => {
  const a = clone(good);
  a.background = { coverage: 0.4, pure: 0, near: 0, mean: [232, 232, 232] };
  assert.equal(byId(R.evaluate(a, file, R.preset('amazon')), 'background').status, 'fail');
  assert.equal(byId(R.evaluate(a, file, R.preset('ebay')), 'background').status, 'warn');
  assert.equal(byId(R.evaluate(a, file, R.preset('etsy')), 'background').status, 'info');
});

test('near-white backdrop is a warning, not a pass', () => {
  const a = clone(good);
  a.background.pure = 0.4;
  const c = byId(R.evaluate(a, file, R.preset('amazon')), 'background');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /40%/);
});

test('fill thresholds', () => {
  const a = clone(good);
  a.fill.longest = 0.8;
  assert.equal(byId(R.evaluate(a, file, R.preset('amazon')), 'fill').status, 'warn');
  a.fill.longest = 0.5;
  assert.equal(byId(R.evaluate(a, file, R.preset('amazon')), 'fill').status, 'fail');
  assert.equal(byId(R.evaluate(a, file, R.preset('walmart')), 'fill').status, 'warn');
});

test('size checks use min, recommended and max', () => {
  const amazon = R.preset('amazon');
  assert.equal(byId(R.evaluate(good, { ...file, width: 400, height: 400 }, amazon), 'size').status, 'fail');
  assert.equal(byId(R.evaluate(good, { ...file, width: 900, height: 900 }, amazon), 'size').status, 'warn');
  assert.equal(byId(R.evaluate(good, { ...file, width: 12000, height: 9000 }, amazon), 'size').status, 'fail');
  const g = byId(R.evaluate(good, { ...file, width: 400, height: 400 }, R.preset('google')), 'size');
  assert.equal(g.status, 'warn');
  assert.match(g.detail, /2027/);
});

test('aspect ratio severity follows the preset rule', () => {
  const wide = { ...file, width: 3000, height: 2000 };
  assert.equal(byId(R.evaluate(good, wide, R.preset('walmart')), 'aspect').status, 'fail');
  assert.equal(byId(R.evaluate(good, wide, R.preset('shopify')), 'aspect').status, 'info');
  assert.equal(byId(R.evaluate(good, wide, R.preset('amazon')), 'aspect'), undefined);
});

test('format, file size, CMYK and transparency', () => {
  const webp = R.evaluate(good, { ...file, type: 'image/webp' }, R.preset('amazon'));
  assert.equal(byId(webp, 'format').status, 'fail');
  const big = R.evaluate(good, { ...file, size: 6 * R.MB }, R.preset('walmart'));
  assert.equal(byId(big, 'filesize').status, 'fail');
  const etsy = R.evaluate(good, { ...file, size: 3 * R.MB }, R.preset('etsy'));
  assert.equal(byId(etsy, 'filesize').status, 'warn');
  const cmyk = R.evaluate(good, { ...file, jpeg: { components: 4 } }, R.preset('amazon'));
  assert.equal(byId(cmyk, 'color').status, 'warn');
  const t = clone(good); t.transparent = true;
  assert.equal(byId(R.evaluate(t, file, R.preset('amazon')), 'transparency').status, 'warn');
});

test('Amazon file-name hint only appears for non-standard names', () => {
  assert.equal(byId(R.evaluate(good, file, R.preset('amazon')), 'naming'), undefined);
  assert.equal(byId(R.evaluate(good, { ...file, name: 'IMG_2231.jpg' }, R.preset('amazon')), 'naming').status, 'info');
});

test('busy background and edge contact', () => {
  const a = clone(good);
  a.uniformity = 0.2;
  assert.equal(byId(R.evaluate(a, file, R.preset('amazon')), 'background').label, 'Busy background');
  const b = clone(good);
  b.touches.left = true;
  assert.match(byId(R.evaluate(b, file, R.preset('amazon')), 'framing').detail, /left edge/);
});

test('fileName applies templates and strips unsafe characters', () => {
  const info = { name: 'SKU-1', index: 3, preset: 'amazon', width: 2000, height: 2000 };
  assert.equal(R.fileName('{name}.MAIN', info, '.jpg'), 'SKU-1.MAIN.jpg');
  assert.equal(R.fileName('{name}.PT{nn}', info, '.jpg'), 'SKU-1.PT03.jpg');
  assert.equal(R.fileName('{preset}/{size}', info, '.jpg'), 'amazon-2000x2000.jpg');
});

test('fileName does not double an existing Amazon variant code', () => {
  const info = { name: 'B0C1234567.MAIN', index: 1, preset: 'amazon', width: 2000, height: 2000 };
  assert.equal(R.fileName('{name}.MAIN', info, '.jpg'), 'B0C1234567.MAIN.jpg');
  assert.equal(R.fileName('{name}', info, '.jpg'), 'B0C1234567.MAIN.jpg');
  assert.equal(R.fileName('{name}.PT{nn}', { ...info, name: 'B0C1234567.PT02', index: 4 }, '.jpg'), 'B0C1234567.PT04.jpg');
});
