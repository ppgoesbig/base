const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Z = require('../site/js/zip.js');

test('crc32 matches the standard check value', () => {
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('build produces an archive Python\'s zipfile can read, with unique names', () => {
  const files = [
    { name: 'a.jpg', data: Uint8Array.from([1, 2, 3]) },
    { name: 'a.jpg', data: Uint8Array.from([4, 5]) },
    { name: 'ünïcode.MAIN.jpg', data: new Uint8Array(1000).fill(7) },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfzip-'));
  const zipPath = path.join(dir, 'out.zip');
  fs.writeFileSync(zipPath, Z.build(files, new Date(2026, 9, 14, 12, 0, 0)));
  const listing = execFileSync('python3', ['-I', '-c',
    'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; ' +
    'print(json.dumps([[i.filename, i.file_size] for i in z.infolist()]))', zipPath]).toString();
  assert.deepEqual(JSON.parse(listing), [['a.jpg', 3], ['a-2.jpg', 2], ['ünïcode.MAIN.jpg', 1000]]);
});

test('build can deflate entries (Node zlib) and stays readable', () => {
  const zlib = require('node:zlib');
  const text = new TextEncoder().encode('PureFrame '.repeat(5000));
  const files = [{ name: 'big.txt', data: text }, { name: 'tiny.bin', data: Uint8Array.from([9]) }];
  const zip = Z.build(files, new Date(2026, 9, 14), (d) => zlib.deflateRawSync(d));
  assert.ok(zip.length < text.length / 10, `compressed to ${zip.length}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfzip-'));
  const zipPath = path.join(dir, 'out.zip');
  fs.writeFileSync(zipPath, zip);
  const out = execFileSync('python3', ['-I', '-c',
    'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; ' +
    'print(json.dumps([[i.filename, i.compress_type, len(z.read(i))] for i in z.infolist()]))', zipPath]).toString();
  assert.deepEqual(JSON.parse(out), [['big.txt', 8, text.length], ['tiny.bin', 0, 1]]);
});
