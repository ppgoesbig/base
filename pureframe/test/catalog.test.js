const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../site/js/catalog.js');

// UPC/EAN values below have correct check digits.
const UPC = '036000291452', EAN = '4006381333931';

const indexOf = (csv) => {
  const { headers, rows } = C.parseCSV(csv);
  return C.buildIndex(rows, C.columns(headers));
};
const names = (entries, mkt, ext = '.jpg') => entries.map((e) => C.name(e, mkt, ext).name);

/* ---------- parseCSV ---------- */

test('quoted fields keep commas, newlines and escaped quotes', () => {
  const csv = 'sku,title,note\n"A,1","12"" ruler","line one\nline two"\nB,plain,"say ""hi"""\n';
  const { headers, rows } = C.parseCSV(csv);
  assert.deepEqual(headers, ['sku', 'title', 'note']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { sku: 'A,1', title: '12" ruler', note: 'line one\nline two' });
  assert.deepEqual(rows[1], { sku: 'B', title: 'plain', note: 'say "hi"' });
});

test('BOM, CRLF, blank lines and a trailing newline', () => {
  const csv = '﻿ SKU , ASIN \r\n\r\nA1 , B000123456 \r\n,\r\nA2,B000123457\r\n';
  const { headers, rows } = C.parseCSV(csv);
  assert.deepEqual(headers, ['SKU', 'ASIN']);
  assert.deepEqual(rows, [{ SKU: 'A1', ASIN: 'B000123456' }, { SKU: 'A2', ASIN: 'B000123457' }]);
});

test('old Mac CR line endings and short rows', () => {
  const { rows } = C.parseCSV('sku,asin,upc\rA1,B1\rA2,B2,123');
  assert.deepEqual(rows, [{ sku: 'A1', asin: 'B1', upc: '' }, { sku: 'A2', asin: 'B2', upc: '123' }]);
});

test('semicolon and tab delimiters are detected from the header row', () => {
  const semi = C.parseCSV('SKU;EAN;Prix\nA1;4006381333931;"12,50"\n');
  assert.deepEqual(semi.headers, ['SKU', 'EAN', 'Prix']);
  assert.deepEqual(semi.rows[0], { SKU: 'A1', EAN: EAN, Prix: '12,50' });
  const tab = C.parseCSV('sku\tasin\nA1\tB000123456\n');
  assert.deepEqual(tab.rows[0], { sku: 'A1', asin: 'B000123456' });
  // A comma in the header keeps comma mode even if semicolons appear later.
  assert.deepEqual(C.parseCSV('sku,note\nA1,a;b\n').rows[0], { sku: 'A1', note: 'a;b' });
});

test('Excel "sep=" hint line sets the delimiter', () => {
  const { headers, rows } = C.parseCSV('sep=;\r\nsku;asin\r\nA1;B000123456\r\n');
  assert.deepEqual(headers, ['sku', 'asin']);
  assert.deepEqual(rows[0], { sku: 'A1', asin: 'B000123456' });
});

test('empty header columns are dropped and repeated headers keep the first value', () => {
  const { headers, rows } = C.parseCSV('sku,,asin,sku\nA1,x,B1,A9\n,y,B2,A2\n');
  assert.deepEqual(headers, ['sku', 'asin', 'sku']);
  assert.deepEqual(rows, [{ sku: 'A1', asin: 'B1' }, { sku: 'A2', asin: 'B2' }]);
});

/* ---------- columns ---------- */

test('header aliases ignore case, spaces, underscores and hyphens', () => {
  const cols = C.columns(['Image_File', 'SELLER-SKU', 'asin', 'UPC Code', 'EAN13', 'GTIN-14', 'Image Type', 'Price']);
  assert.deepEqual(cols, {
    file: 'Image_File', sku: 'SELLER-SKU', asin: 'asin', upc: 'UPC Code', ean: 'EAN13', gtin: 'GTIN-14', variant: 'Image Type',
  });
  assert.deepEqual(C.columns(['File Name', 'Product ID', 'Barcode', 'View']),
    { file: 'File Name', sku: 'Product ID', asin: null, upc: null, ean: 'Barcode', gtin: null, variant: 'View' });
  assert.equal(C.columns(['Variant SKU', 'Title']).sku, 'Variant SKU');
  assert.deepEqual(C.columns(['Title', 'Price']), { file: null, sku: null, asin: null, upc: null, ean: null, gtin: null, variant: null });
});

/* ---------- buildIndex ---------- */

test('index keys are normalised and missing values are empty strings', () => {
  const idx = indexOf('File,SKU\nphotos/Front Shot.JPG,Mug-01\nhttps://cdn.example.com/a/Back%20Shot.png?v=3,Mug-02\n');
  assert.ok(idx.byFile.has('front shot'));
  assert.ok(idx.byFile.has('back shot'));
  assert.ok(idx.bySku.has('mug-01'));
  const rec = idx.bySku.get('mug-01');
  assert.deepEqual({ ...rec, row: undefined }, { sku: 'Mug-01', asin: '', upc: '', ean: '', gtin: '', variant: '', row: undefined });
  assert.equal(rec.row.File, 'photos/Front Shot.JPG');
});

test('a repeated SKU merges identifiers and drops the per-photo variant', () => {
  const idx = indexOf('file,sku,asin,variant\na.jpg,ABC,,MAIN\nb.jpg,ABC,B000123456,PT01\n');
  const sku = idx.bySku.get('abc');
  assert.equal(sku.asin, 'B000123456');
  assert.equal(sku.variant, '');
  assert.equal(idx.byFile.get('a').variant, 'MAIN');
});

/* ---------- match ---------- */

test('exact file stem wins, then the longest SKU prefix', () => {
  const idx = indexOf('file,sku\nhero.jpg,ZED\n,ABC\n,ABC-1\n');
  const m = C.match(['hero.png', 'ABC-1_2.jpg', 'ABC_2.jpg', 'ABC-1.jpg', 'ABCD.jpg', 'abc 3.jpg', 'abc.front.jpg'], idx);
  assert.deepEqual(m.map((e) => e.how), ['file', 'sku', 'sku', 'sku', null, 'sku', 'sku']);
  assert.deepEqual(m.map((e) => e.record && e.record.sku), ['ZED', 'ABC-1', 'ABC', 'ABC-1', null, 'ABC', 'ABC']);
  assert.equal(m[4].slot, null);
  assert.deepEqual(m.map((e) => e.file), ['hero.png', 'ABC-1_2.jpg', 'ABC_2.jpg', 'ABC-1.jpg', 'ABCD.jpg', 'abc 3.jpg', 'abc.front.jpg']);
});

test('macOS decomposed accents still match the spreadsheet', () => {
  const idx = indexOf('sku,asin\nCafé,B000123456\n');
  const [e] = C.match(['Café_1.jpg'], idx);
  assert.equal(e.how, 'sku');
  assert.equal(e.record.asin, 'B000123456');
});

test('photos of one product are numbered in natural order', () => {
  const idx = indexOf('sku,asin\nMUG,B000123456\n');
  const m = C.match(['mug_img10.jpg', 'mug_img2.jpg', 'mug_img1.jpg', 'MUG.jpg'], idx);
  assert.deepEqual(m.map((e) => e.slot), [3, 2, 1, 0]);
  assert.deepEqual(names(m, 'amazon'), ['B000123456.PT03.jpg', 'B000123456.PT02.jpg', 'B000123456.PT01.jpg', 'B000123456.MAIN.jpg']);
});

test('a photo named "main" goes first', () => {
  const idx = indexOf('sku,asin\nMUG,B000123456\n');
  const m = C.match(['MUG-1.jpg', 'MUG-2.jpg', 'MUG-main.jpg'], idx);
  assert.deepEqual(names(m, 'amazon'), ['B000123456.PT01.jpg', 'B000123456.PT02.jpg', 'B000123456.MAIN.jpg']);
});

test('explicit variants set the order: MAIN, PT01–PT08, then SWCH', () => {
  const idx = indexOf('file,sku,asin,variant\na.jpg,MUG,B000123456,swch\nb.jpg,MUG,B000123456,PT02\nc.jpg,MUG,B000123456,main\nd.jpg,MUG,B000123456,pt1\n');
  const m = C.match(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'], idx);
  assert.deepEqual(m.map((e) => e.slot), [3, 2, 0, 1]);
  assert.deepEqual(names(m, 'amazon'), ['B000123456.SWCH.jpg', 'B000123456.PT02.jpg', 'B000123456.MAIN.jpg', 'B000123456.PT01.jpg']);
  assert.deepEqual(names(m, 'walmart'), ['MUG_3.jpg', 'MUG_2.jpg', 'MUG.jpg', 'MUG_1.jpg']);
});

test('photos without a variant fill the free slots around explicit ones', () => {
  // PT01 and PT02 are taken, so the unlabelled photos become MAIN and PT03.
  const idx = indexOf('file,sku,asin,variant\nside.jpg,MUG,B000123456,PT01\nback.jpg,MUG,B000123456,PT02\n,MUG,,\n');
  const m = C.match(['side.jpg', 'MUG_z.jpg', 'back.jpg', 'MUG_a.jpg'], idx);
  assert.deepEqual(names(m, 'amazon'), ['B000123456.PT01.jpg', 'B000123456.PT03.jpg', 'B000123456.PT02.jpg', 'B000123456.MAIN.jpg']);
  assert.equal(new Set(names(m, 'amazon')).size, 4);
});

/* ---------- name ---------- */

test('Amazon prefers the ASIN and cleans it up', () => {
  const idx = indexOf(`sku,asin,upc\nMUG,"b00 012-3456 ",${UPC}\n`);
  const [e] = C.match(['MUG.png'], idx);
  assert.deepEqual(C.name(e, 'amazon', '.jpg'), { name: 'B000123456.MAIN.jpg', problem: null });
  // No ext: the photo keeps its own extension.
  assert.equal(C.name(e, 'amazon').name, 'B000123456.MAIN.png');
  assert.equal(C.name(e, 'amazon', 'tif').name, 'B000123456.MAIN.tif');
});

test('Amazon falls back to UPC, EAN, GTIN, then SKU', () => {
  const rec = (r) => ({ file: 'x.jpg', how: 'sku', slot: 0, record: { sku: '', asin: '', upc: '', ean: '', gtin: '', variant: '', row: {}, ...r } });
  assert.equal(C.name(rec({ upc: UPC, ean: EAN, sku: 'S1' }), 'amazon', '.jpg').name, `${UPC}.MAIN.jpg`);
  assert.equal(C.name(rec({ ean: EAN, sku: 'S1' }), 'amazon', '.jpg').name, `${EAN}.MAIN.jpg`);
  assert.equal(C.name(rec({ asin: 'N/A', sku: 'S1' }), 'amazon', '.jpg').name, 'S1.MAIN.jpg');
  assert.deepEqual(C.name(rec({ sku: 'MUG-01 BLU' }), 'amazon', '.jpg'),
    { name: 'MUG01BLU.MAIN.jpg', problem: 'Amazon file names can\'t contain this SKU\'s symbols, so Amazon may not match it. Add the ASIN or UPC' });
});

test('Amazon allows MAIN plus PT01–PT08 only', () => {
  const idx = indexOf('sku,asin\nMUG,B000123456\n');
  const files = Array.from({ length: 10 }, (_, i) => `MUG_${i + 1}.jpg`);
  const res = C.match(files, idx).map((e) => C.name(e, 'amazon', '.jpg'));
  assert.equal(res[0].name, 'B000123456.MAIN.jpg');
  assert.equal(res[8].name, 'B000123456.PT08.jpg');
  assert.deepEqual(res[9], { name: null, problem: 'Amazon allows MAIN plus PT01–PT08 only' });
});

test('Walmart uses the 14-digit GTIN with _N for extra photos', () => {
  const idx = indexOf(`sku,upc,gtin\nMUG,${UPC},\nCUP,,00${UPC}\nBOWL #2,,\n`);
  const m = C.match(['MUG.jpg', 'MUG_2.jpg', 'CUP.jpg', 'BOWL #2.jpg', 'BOWL #2 b.jpg'], idx);
  assert.deepEqual(names(m, 'walmart'), [`00${UPC}.jpg`, `00${UPC}_1.jpg`, `00${UPC}.jpg`, 'BOWL2.jpg', 'BOWL2_1.jpg']);
});

test('other marketplaces use the SKU with -N for extra photos', () => {
  const idx = indexOf('sku,asin\nMug Blue.v2,B000123456\n,B000999999\n');
  const m = C.match(['mug blue.v2.jpg', 'Mug Blue.v2 (1).jpg'], idx);
  for (const mkt of ['ebay', 'etsy', 'shopify', 'tiktok', 'google']) {
    assert.deepEqual(names(m, mkt), ['MugBlue.v2.jpg', 'MugBlue.v2-1.jpg']);
  }
  const noSku = { file: 'x.jpg', slot: 2, how: 'file', record: { sku: '', asin: 'b000999999', upc: '', ean: '', gtin: '', variant: '', row: {} } };
  assert.equal(C.name(noSku, 'etsy', '.jpg').name, 'B000999999-2.jpg');
});

test('unmatched photos and rows without identifiers get a problem', () => {
  assert.deepEqual(C.name({ file: 'x.jpg', record: null, slot: null, how: null }, 'amazon', '.jpg'),
    { name: null, problem: 'No matching row in the spreadsheet' });
  const blank = { file: 'x.jpg', slot: 0, how: 'file', record: { sku: '', asin: 'N/A', upc: '-', ean: '', gtin: '', variant: '', row: {} } };
  for (const mkt of ['amazon', 'walmart', 'shopify']) {
    assert.deepEqual(C.name(blank, mkt, '.jpg'), { name: null, problem: 'Row has no ASIN, UPC, EAN, GTIN or SKU' });
  }
});

test('barcodes damaged by spreadsheets are caught or repaired', () => {
  const rec = (r) => ({ file: 'x.jpg', how: 'sku', slot: 0, record: { sku: 'S1', asin: '', upc: '', ean: '', gtin: '', variant: '', row: {}, ...r } });
  const sci = C.name(rec({ upc: '3.60003E+11' }), 'amazon', '.jpg');
  assert.equal(sci.name, null);
  assert.match(sci.problem, /3\.60003E\+11.*text/);
  // Leading zero dropped by Excel: put back.
  assert.deepEqual(C.name(rec({ upc: UPC.slice(1) }), 'amazon', '.jpg'), { name: `${UPC}.MAIN.jpg`, problem: null });
  // Wrong check digit: still named, but flagged.
  const typo = C.name(rec({ upc: '036000291453' }), 'walmart', '.jpg');
  assert.equal(typo.name, '00036000291453.jpg');
  assert.match(typo.problem, /typos/);
  assert.match(C.name(rec({ asin: 'B00012345' }), 'amazon', '.jpg').problem, /10 letters/);
});

/* ---------- preview ---------- */

test('preview lists every photo for every marketplace in order', () => {
  const idx = indexOf('sku,asin\nMUG,B000123456\n');
  const rows = C.preview(['MUG.jpg', 'nope.jpg'], idx, ['amazon', 'etsy'], '.jpg');
  assert.deepEqual(rows, [
    { file: 'MUG.jpg', marketplace: 'amazon', name: 'B000123456.MAIN.jpg', problem: null },
    { file: 'MUG.jpg', marketplace: 'etsy', name: 'MUG.jpg', problem: null },
    { file: 'nope.jpg', marketplace: 'amazon', name: null, problem: 'No matching row in the spreadsheet' },
    { file: 'nope.jpg', marketplace: 'etsy', name: null, problem: 'No matching row in the spreadsheet' },
  ]);
});

test('preview flags photos that would get the same name', () => {
  // Two rows, one product, both labelled MAIN.
  const idx = indexOf('file,sku,asin,variant\na.jpg,MUG,B000123456,MAIN\nb.jpg,MUG,B000123456,main\n');
  const rows = C.preview(['a.jpg', 'b.png'], idx, ['amazon', 'walmart']);
  const amazon = rows.filter((r) => r.marketplace === 'amazon');
  assert.deepEqual(amazon.map((r) => r.name), ['B000123456.MAIN.jpg', 'B000123456.MAIN.png']);
  assert.deepEqual(amazon.map((r) => r.problem), ['Two photos would get the same name', 'Two photos would get the same name']);
  // Walmart numbers by slot, so no clash there.
  assert.deepEqual(rows.filter((r) => r.marketplace === 'walmart').map((r) => [r.name, r.problem]), [['MUG.jpg', null], ['MUG_1.png', null]]);
});

test('duplicate check ignores case', () => {
  // One row labelled MAIN shared by two photos whose names differ only in case.
  const clash = C.preview(['Mug.jpg', 'MUG.jpg'], indexOf('sku,variant\nmug,MAIN\n'), ['amazon'], '.jpg');
  assert.deepEqual(clash.map((r) => r.name), ['mug.MAIN.jpg', 'mug.MAIN.jpg']);
  assert.deepEqual(clash.map((r) => r.problem), ['Two photos would get the same name', 'Two photos would get the same name']);
  // Shopify's SKU-N scheme can collide with a real SKU: "ABC" photo 2 vs SKU "ABC-1".
  const rows = C.preview(['ABC.jpg', 'ABC_b.jpg', 'abc-1.jpg'], indexOf('sku\nABC\nabc-1\n'), ['shopify'], '.jpg');
  assert.deepEqual(rows.map((r) => r.name), ['ABC.jpg', 'ABC-1.jpg', 'abc-1.jpg']);
  assert.deepEqual(rows.map((r) => r.problem), [null, 'Two photos would get the same name', 'Two photos would get the same name']);
});

/* ---------- robustness ---------- */

test('nothing throws on empty or missing input', () => {
  assert.deepEqual(C.parseCSV(''), { headers: [], rows: [] });
  assert.deepEqual(C.parseCSV('﻿\r\n\r\n'), { headers: [], rows: [] });
  assert.deepEqual(C.parseCSV(undefined), { headers: [], rows: [] });
  assert.deepEqual(C.parseCSV('sku,asin\n'), { headers: ['sku', 'asin'], rows: [] });
  assert.equal(C.columns(undefined).sku, null);
  const empty = C.buildIndex([], C.columns([]));
  assert.equal(empty.byFile.size + empty.bySku.size, 0);
  assert.equal(C.buildIndex(undefined).bySku.size, 0);
  assert.deepEqual(C.match([], empty), []);
  assert.deepEqual(C.match(undefined, undefined), []);
  assert.deepEqual(C.match(['a.jpg'], null), [{ file: 'a.jpg', record: null, slot: null, how: null }]);
  assert.equal(C.name(null, 'amazon', '.jpg').problem, 'No matching row in the spreadsheet');
  assert.deepEqual(C.preview([], empty, ['amazon'], '.jpg'), []);
  assert.deepEqual(C.preview(['a.jpg'], empty, [], '.jpg'), []);
  assert.deepEqual(C.preview(undefined, undefined, undefined), []);
});

test('buildIndex works out the columns when none are given', () => {
  const { rows } = C.parseCSV('Item SKU,ASIN\nMUG,B000123456\n');
  const idx = C.buildIndex(rows);
  assert.equal(idx.bySku.get('mug').asin, 'B000123456');
});
