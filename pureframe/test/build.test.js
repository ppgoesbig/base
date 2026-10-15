const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pfbuild-'));
execFileSync(process.execPath, [path.join(__dirname, '../scripts/build.mjs')], {
  env: { ...process.env, PF_DIST: dist, SITE_URL: 'https://example.test' }, stdio: 'pipe',
});
const site = path.join(dist, 'site');
const htmlFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? htmlFiles(path.join(dir, e.name)) : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);

test('every internal link and asset in the built site resolves', () => {
  const broken = [];
  for (const file of htmlFiles(site)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"#?]+)[^"]*"/g)) {
      if (/^(https?:|mailto:|data:)/.test(ref)) continue;
      let target = path.resolve(path.dirname(file), ref);
      if (ref.endsWith('/')) target = path.join(target, 'index.html');
      if (!fs.existsSync(target)) broken.push(`${path.relative(site, file)} -> ${ref}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('canonical URLs and sitemap use SITE_URL, with no placeholders left', () => {
  const sitemap = fs.readFileSync(path.join(site, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 12, `${locs.length} pages in sitemap`);
  for (const loc of locs) {
    assert.ok(loc.startsWith('https://example.test/'), loc);
    const rel = loc.replace('https://example.test/', '') || 'index.html';
    assert.ok(fs.existsSync(path.join(site, rel.endsWith('/') ? rel + 'index.html' : rel)), `sitemap entry exists: ${loc}`);
  }
  for (const file of htmlFiles(site)) assert.ok(!fs.readFileSync(file, 'utf8').includes('%%SITE_URL%%'), file);
});

test('the Pro build is one self-contained file with no marketing or upsell', () => {
  const pro = fs.readFileSync(path.join(dist, 'pro', 'PureFrame Pro.html'), 'utf8');
  assert.ok(!/<script[^>]+src=|<link[^>]+stylesheet/.test(pro), 'no external scripts or styles');
  assert.ok(!pro.includes('id="pricing"') && !pro.includes('id="upsell"'));
  assert.match(pro, /edition: 'pro'/);
  assert.ok(fs.statSync(path.join(dist, 'PureFrame-Pro.zip')).size > 10000);
});
