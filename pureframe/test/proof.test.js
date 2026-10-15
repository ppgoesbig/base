const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../site/js/proof.js');
const R = require('../site/js/rules.js');

// Deterministic noise so tests don't flake.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function image(w, h, rgb = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return { width: w, height: h, data };
}
const set = (img, x, y, rgb) => img.data.set(rgb, (y * img.width + x) * 4);
const copy = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

// Reference implementation: check the whole (2m+1)^2 square around every pixel.
function brute(rendered, decoded, margin) {
  const W = rendered.width, H = rendered.height, s = rendered.data, d = decoded.data;
  const white = (a, i) => a[i] === 255 && a[i + 1] === 255 && a[i + 2] === 255;
  let checked = 0, nonWhite = 0, darkest = 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ok = true;
      for (let yy = Math.max(0, y - margin); ok && yy <= Math.min(H - 1, y + margin); yy++) {
        for (let xx = Math.max(0, x - margin); xx <= Math.min(W - 1, x + margin); xx++) {
          if (!white(s, (yy * W + xx) * 4)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      checked++;
      const p = (y * W + x) * 4;
      if (!white(d, p)) { nonWhite++; darkest = Math.min(darkest, d[p], d[p + 1], d[p + 2]); }
    }
  }
  return { checked, nonWhite, darkest, pure: checked ? (checked - nonWhite) / checked : 1 };
}

test('strict background skips pixels within the margin of the product', () => {
  const rendered = image(20, 20);
  set(rendered, 10, 10, [30, 60, 90]);
  const clean = P.strictBackground(rendered, copy(rendered));
  // default margin 2 excludes a 5 × 5 square around the product pixel
  assert.deepEqual(clean, { checked: 400 - 25, nonWhite: 0, darkest: 255, pure: 1 });

  // 2 px away (straight and diagonal, Chebyshev) is excluded
  const near = copy(rendered);
  set(near, 12, 10, [240, 240, 240]);
  set(near, 12, 12, [240, 240, 240]);
  set(near, 8, 8, [240, 240, 240]);
  assert.equal(P.strictBackground(rendered, near).nonWhite, 0);

  // 3 px away is included
  const far = copy(rendered);
  set(far, 13, 10, [250, 250, 250]);
  set(far, 13, 12, [250, 250, 250]);
  const r = P.strictBackground(rendered, far);
  assert.equal(r.nonWhite, 2);
  assert.equal(r.darkest, 250);
});

test('margin option widens or narrows the excluded band', () => {
  const rendered = image(20, 20);
  set(rendered, 10, 10, [0, 0, 0]);
  const decoded = copy(rendered);
  set(decoded, 13, 10, [250, 250, 250]);
  assert.equal(P.strictBackground(rendered, decoded, { margin: 3 }).nonWhite, 0);
  assert.equal(P.strictBackground(rendered, decoded, { margin: 3 }).checked, 400 - 49);
  assert.equal(P.strictBackground(rendered, decoded, { margin: 0 }).checked, 399);
  assert.equal(P.strictBackground(rendered, decoded, { margin: 0 }).nonWhite, 1);
});

test('the excluded square is clipped at the image border', () => {
  const rendered = image(10, 10);
  set(rendered, 0, 0, [10, 10, 10]);
  assert.equal(P.strictBackground(rendered, copy(rendered)).checked, 100 - 9);
});

test('finds a single JPEG stray pixel and ignores ringing at the product edge', () => {
  const rendered = image(64, 48);
  for (let y = 16; y < 32; y++) for (let x = 20; x < 44; x++) set(rendered, x, y, [180, 40, 40]);
  const decoded = copy(rendered);
  // ringing hugging the product edge, inside the 2 px margin
  for (let x = 18; x < 46; x++) { set(decoded, x, 14, [247, 250, 251]); set(decoded, x, 33, [246, 252, 249]); }
  for (let y = 14; y < 34; y++) { set(decoded, 18, y, [248, 248, 252]); set(decoded, 45, y, [250, 247, 250]); }
  // one off-white block artifact out in the open background
  set(decoded, 5, 40, [255, 254, 255]);
  const r = P.strictBackground(rendered, decoded);
  const expectChecked = 64 * 48 - (24 + 4) * (16 + 4);
  assert.equal(r.checked, expectChecked);
  assert.equal(r.nonWhite, 1);
  assert.equal(r.darkest, 254);
  assert.equal(r.pure, (expectChecked - 1) / expectChecked);
  assert.ok(r.pure < 1);
});

test('an all-white image is fully checked and pure', () => {
  const img = image(33, 21);
  assert.deepEqual(P.strictBackground(img, copy(img)), { checked: 33 * 21, nonWhite: 0, darkest: 255, pure: 1 });
});

test('an image with no white pixels checks nothing and reports pure', () => {
  const img = image(12, 12, [200, 200, 200]);
  assert.deepEqual(P.strictBackground(img, copy(img)), { checked: 0, nonWhite: 0, darkest: 255, pure: 1 });
});

test('darkest is the lowest channel over every stray pixel', () => {
  const rendered = image(30, 30);
  const decoded = copy(rendered);
  set(decoded, 3, 3, [255, 241, 255]);
  set(decoded, 20, 7, [250, 250, 250]);
  set(decoded, 9, 25, [255, 255, 238]);
  set(decoded, 25, 25, [253, 252, 251]);
  const r = P.strictBackground(rendered, decoded);
  assert.equal(r.nonWhite, 4);
  assert.equal(r.darkest, 238);
  assert.equal(r.checked, 900);
});

test('ignores alpha and only looks at colour channels', () => {
  const rendered = image(8, 8);
  const decoded = copy(rendered);
  decoded.data[(4 * 8 + 4) * 4 + 3] = 0;
  assert.equal(P.strictBackground(rendered, decoded).nonWhite, 0);
});

test('rejects images of different sizes', () => {
  assert.throws(() => P.strictBackground(image(10, 10), image(10, 11)), /same size/);
});

test('running-count implementation matches a brute-force reference', () => {
  const rand = rng(7);
  const sizes = [[31, 17], [40, 40], [1, 9], [9, 1], [5, 5], [2, 13]];
  for (const [w, h] of sizes) {
    for (let trial = 0; trial < 4; trial++) {
      const rendered = image(w, h);
      // sparse product pixels, some of them nearly white
      for (let i = 0; i < w * h; i++) {
        if (rand() < 0.04) {
          const v = rand() < 0.3 ? 254 : Math.floor(rand() * 255);
          rendered.data.set([v, rand() < 0.5 ? v : 255, 255], i * 4);
        }
      }
      // plus a small solid block
      const bx = Math.floor(rand() * w), by = Math.floor(rand() * h);
      for (let y = by; y < Math.min(h, by + 3); y++) for (let x = bx; x < Math.min(w, bx + 4); x++) set(rendered, x, y, [90, 90, 90]);
      // compression-like drift across much of the decoded image
      const decoded = copy(rendered);
      for (let i = 0; i < w * h; i++) {
        if (rand() < 0.3) decoded.data[i * 4 + Math.floor(rand() * 3)] -= 1 + Math.floor(rand() * 9);
      }
      for (const margin of [0, 1, 2, 3, 7, 60]) {
        assert.deepEqual(P.strictBackground(rendered, decoded, { margin }), brute(rendered, decoded, margin), `${w}x${h} trial ${trial} margin ${margin}`);
      }
    }
  }
});

test('handles a full-size export quickly', () => {
  const rendered = image(2000, 2000);
  for (let y = 300; y < 1700; y++) for (let x = 400; x < 1600; x++) set(rendered, x, y, [120, 80, 40]);
  const decoded = copy(rendered);
  set(decoded, 10, 10, [254, 255, 255]);
  const t0 = process.hrtime.bigint();
  const r = P.strictBackground(rendered, decoded, { margin: 25 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.checked, 2000 * 2000 - (1200 + 50) * (1400 + 50));
  assert.equal(r.nonWhite, 1);
  assert.ok(ms < 2000, `took ${ms} ms`);
});

// Shared fixtures for evidence, CSV and report tests.
const goodAnalysis = {
  transparent: false, uniformity: 0.99, backdrop: [255, 255, 255],
  background: { coverage: 0.4, pure: 0.998, near: 1, mean: [255, 255, 255] },
  bbox: { x0: 100, y0: 100, x1: 1900, y1: 1900 },
  fill: { x: 0.88, y: 0.88, longest: 0.88 },
  touches: { top: false, left: false, bottom: false, right: false },
};
const outFile = { name: 'B000123456.MAIN.jpg', size: 812345, type: 'image/jpeg', width: 2000, height: 2000 };
const amazon = R.preset('amazon');

test('evidence maps every field from the inputs', () => {
  const report = R.evaluate(goodAnalysis, outFile, amazon);
  const strict = { checked: 3000000, nonWhite: 6, darkest: 252, pure: 0.999998 };
  const e = P.evidence({ file: outFile, preset: amazon, report, analysis: goodAnalysis, strict, attempts: 2, encoder: 'JPEG q92' });
  assert.equal(e.file, 'B000123456.MAIN.jpg');
  assert.equal(e.marketplace, 'Amazon');
  assert.equal(e.presetId, 'amazon');
  assert.equal(e.status, 'pass');
  assert.equal(e.width, 2000);
  assert.equal(e.height, 2000);
  assert.equal(e.bytes, 812345);
  assert.equal(e.type, 'image/jpeg');
  assert.equal(e.colour, 'sRGB');
  assert.equal(e.backgroundPure, 0.998);
  assert.equal(e.strictPure, 0.999998);
  assert.equal(e.darkestBackground, 252);
  assert.equal(e.strayPixels, 6);
  assert.equal(e.fill, 0.88);
  assert.equal(e.attempts, 2);
  assert.equal(e.encoder, 'JPEG q92');
  assert.deepEqual(e.checks, report.checks.map(({ id, status, label, detail }) => ({ id, status, label, detail })));
  assert.deepEqual(e.failed, []);
  assert.deepEqual(e.warned, []);
  // JSON round trip loses nothing
  assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
});

test('evidence lists failed and warned check labels and copies the checks', () => {
  const a = JSON.parse(JSON.stringify(goodAnalysis));
  a.background = { coverage: 0.4, pure: 0.5, near: 0.99, mean: [254, 254, 254] };
  a.fill = { x: 0.5, y: 0.5, longest: 0.5 };
  const f = { ...outFile, width: 900, height: 900 };
  const report = R.evaluate(a, f, amazon);
  const e = P.evidence({ file: f, marketplace: 'Amazon US', preset: amazon, report, analysis: a, attempts: 1, encoder: 'JPEG q92' });
  assert.equal(e.status, 'fail');
  assert.equal(e.marketplace, 'Amazon US');
  assert.deepEqual(e.failed, ['Too much empty space']);
  assert.deepEqual(e.warned, ['Almost white background', 'Below recommended size']);
  assert.equal(e.strictPure, null);
  assert.equal(e.darkestBackground, null);
  assert.equal(e.strayPixels, null);
  report.checks[0].label = 'changed later';
  assert.notEqual(e.checks[0].label, 'changed later');
});

test('evidence leaves the strict background empty when no pixels were checked', () => {
  // A busy, full-bleed photo has no white anywhere, so nothing is measured.
  const busy = image(40, 40, [120, 90, 60]);
  const strict = P.strictBackground(busy, copy(busy), { margin: 8 });
  assert.equal(strict.checked, 0);
  const a = { ...goodAnalysis, background: { coverage: 0.4, pure: 0, near: 0, mean: [120, 90, 60] } };
  const f = { ...outFile, name: 'busy.jpg' };
  const report = R.evaluate(a, f, amazon);
  const e = P.evidence({ file: f, preset: amazon, report, analysis: a, strict, attempts: 1, encoder: 'JPEG q92' });
  assert.equal(e.status, 'fail');
  assert.equal(e.strictPure, null);
  assert.equal(e.darkestBackground, null);
  assert.equal(e.strayPixels, null);
  const cells = P.toCSV([e]).split('\r\n')[1].split(',');
  assert.deepEqual(cells.slice(9, 12), ['', '', ''], 'no 100.0% / 255 / 0 in the CSV');
  const row = P.reportHTML([e], {}).match(/<tr>\n<td class="name">busy\.jpg[\s\S]*?<\/tr>/)[0];
  assert.ok(!row.includes('100.0%') && !/>255</.test(row) && !/>0</.test(row), row);
  // a missing count is treated the same way
  assert.equal(P.evidence({ file: f, report, analysis: a, strict: { pure: 1, darkest: 255, nonWhite: 0 } }).strictPure, null);
  // one checked pixel is a real measurement
  assert.equal(P.evidence({ file: f, report, analysis: a, strict: { checked: 1, nonWhite: 0, darkest: 255, pure: 1 } }).strictPure, 1);
});

test('evidence, CSV and report tolerate null inputs and entries', () => {
  const e = P.evidence(null);
  assert.equal(e.file, '');
  assert.equal(e.status, 'fail');
  assert.deepEqual(e.checks, []);
  assert.deepEqual(P.evidence(), e);
  const withNullCheck = P.evidence({ file: outFile, report: { status: 'warn', checks: [null, { id: 'a', status: 'warn', label: 'Large file', detail: '' }] } });
  assert.deepEqual(withNullCheck.checks, [{ id: 'a', status: 'warn', label: 'Large file', detail: '' }]);
  assert.deepEqual(withNullCheck.warned, ['Large file']);

  assert.equal(P.toCSV([null, undefined, 'x']), HEADER + '\r\n');
  assert.equal(P.toCSV([null, record()]), P.toCSV([record()]));
  assert.equal(P.toCSV([record({ failed: null, warned: 'not a list' })]).split('\r\n')[1].slice(-2), ',,');

  const html = P.reportHTML([null, record({ checks: [null, { id: 'b', status: 'pass', label: 'Pure white', detail: '' }] })], null);
  assert.match(html, /<title>PureFrame evidence report<\/title>/);
  assert.match(html, /1 file: 1 passed/);
  assert.ok(html.includes('Pure white'));
  assert.match(P.reportHTML(null, null), /0 files/);
  assert.match(P.reportHTML({ length: 2 }), /0 files/);
});

test('evidence uses null when no product or measurement is available', () => {
  const a = { ...goodAnalysis, fill: null };
  const e = P.evidence({ file: outFile, preset: amazon, report: R.evaluate(a, outFile, amazon), analysis: a, encoder: 'PNG' });
  assert.equal(e.fill, null);
  assert.equal(e.attempts, null);
  assert.equal(e.encoder, 'PNG');
  assert.ok(e.failed.includes('No product found'));
});

const HEADER = 'file,marketplace,status,width,height,bytes,type,colour,background_pure_pct,strict_pure_pct,darkest_background,stray_pixels,fill_pct,encoder,attempts,failed,warned';

function record(over) {
  return {
    file: 'mug.jpg', marketplace: 'Amazon', presetId: 'amazon', status: 'pass', width: 2000, height: 2000,
    bytes: 812345, type: 'image/jpeg', colour: 'sRGB', backgroundPure: 0.998, strictPure: 1, darkestBackground: 255,
    strayPixels: 0, fill: 0.88, attempts: 1, encoder: 'JPEG q92', checks: [], failed: [], warned: [], ...over,
  };
}

test('CSV has a header row, CRLF line endings and formatted numbers', () => {
  const csv = P.toCSV([record(), record({ file: 'b.png', strictPure: null, darkestBackground: null, strayPixels: null, fill: null, type: 'image/png', encoder: 'PNG' })]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], HEADER);
  assert.equal(lines.length, 4);
  assert.equal(lines[3], '');
  assert.ok(!/[^\r]\n/.test(csv), 'no bare LF');
  assert.equal(lines[1], 'mug.jpg,Amazon,pass,2000,2000,812345,image/jpeg,sRGB,99.8,100.0,255,0,88.0,JPEG q92,1,,');
  assert.equal(lines[2], 'b.png,Amazon,pass,2000,2000,812345,image/png,sRGB,99.8,,,,,PNG,1,,');
  assert.equal(P.toCSV([]), HEADER + '\r\n');
});

test('CSV percentages never round a stray pixel up to 100 or down to 0', () => {
  const line = P.toCSV([record({ strictPure: 0.99996, backgroundPure: 0.00001 })]).split('\r\n')[1];
  assert.equal(line.split(',')[8], '0.1');
  assert.equal(line.split(',')[9], '99.9');
});

test('CSV quotes commas, quotes and newlines and joins failed checks', () => {
  const csv = P.toCSV([record({ file: 'mug, blue "large".jpg', marketplace: 'Line\nbreak', failed: ['Image too small', 'Too much empty space'], warned: ['Large file'] })]);
  const body = csv.slice(HEADER.length + 2);
  assert.ok(body.startsWith('"mug, blue ""large"".jpg","Line\nbreak",pass,'), body);
  // ';' is quoted too, so readers that split on it keep the list in one cell
  assert.ok(body.endsWith(',"Image too small; Too much empty space",Large file\r\n'), body);
});

// Split a line the way Excel does in locales whose list separator is ';':
// quotes only count at the start of a field.
function splitSemicolon(line) {
  const out = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ';') { out.push(cell); cell = ''; } else cell += c;
  }
  out.push(cell);
  return out;
}

test('CSV formula guard holds where Excel splits on semicolons', () => {
  const formula = /^[=+\-@\t\r]/;
  const name = R.fileName('{name}', { name: 'shoe;=HYPERLINK(CHAR(104)&CHAR(116));', index: 1, preset: 'amazon', width: 2000, height: 2000 }, '.jpg');
  assert.equal(name, 'shoe;=HYPERLINK(CHAR(104)&CHAR(116));.jpg', 'the file name sanitizer keeps these characters');
  for (const over of [
    { file: name },
    { file: 'x;=2+5;.jpg' },
    { file: 'a;+1;-2;@3;\t4.jpg' },
    // later columns are not at the start of a line, so quotes don't protect them
    { marketplace: 'Shop;=1+1' },
    { failed: ['Too small', '=1+1'] },
  ]) {
    const line = P.toCSV([record(over)]).split('\r\n')[1];
    for (const cell of splitSemicolon(line)) assert.doesNotMatch(cell, formula, line);
    for (const cell of line.split(';')) assert.doesNotMatch(cell, formula, line);
  }
  const line = P.toCSV([record({ file: 'x;=2+5;.jpg' })]).split('\r\n')[1];
  assert.ok(line.startsWith('"x;\'=2+5;.jpg",Amazon,'), line);
  // in the first column the quotes keep the whole name in one cell
  assert.ok(splitSemicolon(line)[0].startsWith("x;'=2+5;.jpg,Amazon,"), line);
  // ordinary text after '; ' is left alone
  const joinedLine = P.toCSV([record({ warned: ['Large file', 'Below recommended size'] })]).split('\r\n')[1];
  assert.ok(joinedLine.endsWith(',"Large file; Below recommended size"'), joinedLine);
});

test('CSV guards text cells against formula injection', () => {
  const cell = (file) => P.toCSV([record({ file })]).split('\r\n')[1].split(',')[0];
  assert.equal(cell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(cell('+1.jpg'), "'+1.jpg");
  assert.equal(cell('-2.jpg'), "'-2.jpg");
  assert.equal(cell('@SUM(A1).jpg'), "'@SUM(A1).jpg");
  assert.equal(cell('\tx.jpg'), "'\tx.jpg");
  assert.equal(cell('\rx.jpg'), '"\'\rx.jpg"');
  assert.equal(cell('a=b.jpg'), 'a=b.jpg');
  // numbers are written as numbers, even negative ones
  const line = P.toCSV([record({ attempts: -1 })]).split('\r\n')[1];
  assert.equal(line.split(',')[14], '-1');
});

test('fmtPct formats shares and missing values', () => {
  assert.equal(P.fmtPct(0.998), '99.8%');
  assert.equal(P.fmtPct(1), '100.0%');
  assert.equal(P.fmtPct(0.99996), '99.9%');
  assert.equal(P.fmtPct(0), '0.0%');
  assert.equal(P.fmtPct(null), '–');
  assert.equal(P.fmtPct(undefined), '–');
  assert.equal(P.fmtPct(NaN), '–');
});

test('report is a standalone document with a summary, table and details', () => {
  const report = R.evaluate(goodAnalysis, outFile, amazon);
  const e = P.evidence({ file: outFile, preset: amazon, report, analysis: goodAnalysis, strict: { checked: 10, nonWhite: 0, darkest: 255, pure: 1 }, attempts: 1, encoder: 'JPEG q92' });
  const warn = record({ file: 'shelf.jpg', status: 'warn', warned: ['Large file'], checks: [{ id: 'filesize', status: 'warn', label: 'Large file', detail: '1.4 MB. Files over 1.0 MB may not finish uploading to Etsy.' }] });
  const fail = record({ file: 'tiny.jpg', status: 'fail', failed: ['Image too small'], checks: [{ id: 'size', status: 'fail', label: 'Image too small', detail: '400 × 400 px.' }] });
  const html = P.reportHTML([e, warn, fail], { generatedAt: '15 October 2026', product: 'PureFrame Pro' });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>PureFrame Pro evidence report<\/title>/);
  assert.match(html, /Generated 15 October 2026 by PureFrame Pro\./);
  assert.match(html, /3 files: 1 passed, 1 with warnings, 1 failed\./);
  assert.match(html, /2,000 × 2,000 px/);
  assert.match(html, /793 KB/);
  for (const c of report.checks) assert.ok(html.includes(c.label), c.label);
  assert.ok(html.includes('Files over 1.0 MB may not finish uploading to Etsy.'));
  assert.match(html, /not a guarantee/);
  assert.match(html, /human eye/);
  assert.match(html, /<\/html>\s*$/);
  // standalone: no scripts, links or remote resources
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<link|<img|@import|url\(|\bsrc=/i);
  assert.equal(P.reportHTML([e], { generatedAt: 'x' }), P.reportHTML([e], { generatedAt: 'x' }));
});

test('report escapes every interpolated string', () => {
  const evil = '<img src=x onerror=alert(1)>.jpg';
  const r = record({
    file: evil, marketplace: '<b>Shop</b>', encoder: '<i>q</i>', status: 'fail',
    checks: [{ id: 'x', status: 'fail', label: '<script>alert(1)</script>', detail: 'a & "b" \'c\'' }],
  });
  const html = P.reportHTML([r], { title: '</title><script>x()</script>', generatedAt: '<u>today</u>', product: '<svg onload=1>' });
  assert.ok(!html.includes(evil));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;.jpg'));
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img|<svg|<b>|<i>|<u>/);
  assert.ok(html.includes('a &amp; &quot;b&quot; &#39;c&#39;'));
  assert.ok(html.includes('&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;'));
});

test('report handles an empty list and missing measurements', () => {
  const empty = P.reportHTML([], {});
  assert.match(empty, /<title>PureFrame evidence report<\/title>/);
  assert.match(empty, /0 files: 0 passed, 0 with warnings, 0 failed\./);
  assert.match(empty, /No files in this report\./);
  const html = P.reportHTML([record({ strictPure: null, darkestBackground: null, strayPixels: null, fill: null })], { generatedAt: '2026-10-15' });
  assert.match(html, /1 file: 1 passed/);
  assert.ok(html.includes('–'));
});
