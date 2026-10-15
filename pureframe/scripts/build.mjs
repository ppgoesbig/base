#!/usr/bin/env node
// Builds everything PureFrame ships:
//   dist/site/              the free website (GitHub Pages), with one guide page per marketplace
//   dist/PureFrame-Pro.zip  the paid offline app, ready to upload to Gumroad
// Usage: SITE_URL=https://example.com node pureframe/scripts/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const VENDOR = path.join(ROOT, 'vendor');
const DIST = process.env.PF_DIST ? path.resolve(process.env.PF_DIST) : path.join(ROOT, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://ppgoesbig.github.io/base').replace(/\/+$/, '');
const R = require(path.join(SITE, 'js/rules.js'));
const Z = require(path.join(SITE, 'js/zip.js'));

const read = (p) => fs.readFileSync(path.join(SITE, p), 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stripFree = (html) => html.replace(/[ \t]*<!-- free:start -->[\s\S]*?<!-- free:end -->\n?/g, '');
const REVIEWED = 'October 2026';
const YEAR = 2026;

fs.rmSync(DIST, { recursive: true, force: true });

// ---------- website ----------
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (/\.(html|xml|txt)$/.test(e.name)) fs.writeFileSync(d, fs.readFileSync(s, 'utf8').replaceAll('%%SITE_URL%%', SITE_URL));
    else fs.copyFileSync(s, d);
  }
}
const OUT = path.join(DIST, 'site');
copyDir(SITE, OUT);
// On-device AI runtime + model (loaded lazily by js/cutout.js from vendor/).
copyDir(VENDOR, path.join(OUT, 'vendor'));

const INTROS = {
  amazon: 'Amazon is the strictest marketplace about the main image. Its systems scan for an exact white background and a product that fills the frame, and a listing whose main image fails can be suppressed from search until it\'s fixed. Here is what the main image needs, in one place.',
  walmart: 'Walmart Marketplace wants square, high-resolution main images on seamless white, cropped close to the product. Images that miss the size or background rules can hold up item setup or lower your listing quality score.',
  tiktok: 'TikTok Shop grades listings on image quality, and the main image is the first thing shoppers see in the feed. It needs a square photo of the product from the front on pure white, within TikTok\'s size and file limits.',
  ebay: 'eBay is more relaxed than Amazon or Walmart, but its picture policy still sets a minimum size and bans added borders, text and watermarks. A clean white or light neutral background makes your item stand out in search results.',
  etsy: 'Etsy leaves styling to you, but size and shape matter: your first photo sets the crop for search thumbnails, and small images look soft when shoppers zoom in. These are the numbers to aim for.',
  shopify: 'Shopify accepts almost any image, but your store looks far more professional when every product photo shares the same size, shape and background. These are Shopify\'s recommended specs and limits.',
  google: 'Google Merchant Center reviews every product image, and small or cluttered images get disapproved. Google is also raising its minimum size: images under 500 × 500 px get warnings now and are blocked from 31 January 2027.',
};

function specRows(p) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const px = (n) => `${n.toLocaleString('en-US')} px`;
  const fmtType = (t) => t.replace('image/', '').toUpperCase();
  const ratio = (r) => (Math.abs(r - 1) < 0.01 ? '1:1 square' : Math.abs(r - 4 / 3) < 0.01 ? '4:3 landscape' : r.toFixed(2));
  const min = p.minLongest ? `${px(p.minLongest)} on the longest side` : p.minShortest ? `${px(p.minShortest)} × ${px(p.minShortest)}` : 'Not specified';
  return [
    ['Background', { required: 'Pure white, RGB 255, 255, 255 (required)', recommended: 'White or light neutral (recommended)', any: 'Your choice; clean and light reads best' }[p.background]],
    ['Product fill', p.fill ? `${pct(p.fill)} of the frame or more (${p.fillRule || 'recommended'})` : 'No fixed rule'],
    ['Minimum size', min],
    ['Recommended size', p.recNote || 'Not specified'],
    ['Maximum size', p.maxLongest ? `${px(p.maxLongest)} on the longest side` : 'Not specified'],
    ['Shape', p.aspect ? `${ratio(p.aspect)} (${p.aspectRule === 'suggested' ? 'common choice' : p.aspectRule})` : 'Any; square is the safe choice'],
    ['File types', p.formats.map(fmtType).join(', ')],
    ['Max file size', p.maxBytes ? R.fmtBytes(p.maxBytes) : p.softMaxBytes ? `No hard limit; over ${R.fmtBytes(p.softMaxBytes)} may fail to upload` : 'Not specified'],
    ['PureFrame exports', `${p.out.width.toLocaleString('en-US')} × ${p.out.height.toLocaleString('en-US')} px ${fmtType(p.out.type)}, product at ${pct(p.out.fill)}`],
  ];
}

function rejections(p) {
  const list = [];
  if (p.background !== 'any') list.push(['Off-white background', 'Studio "white" usually photographs as light grey (around 235–250). It looks white to you but not to an automated check. The fix is a white-point correction plus a clean fill of the backdrop to exact #FFFFFF.']);
  if (p.fill) list.push(['Too much empty space', `Products shot from a distance end up small in the frame. Crop and scale so the product spans ${Math.round(p.fill * 100)}% or more of the image.`]);
  list.push(['Too small for zoom', 'Low-resolution photos look soft and can disable zoom. Export at the recommended size from the largest original you have.']);
  if (p.aspect && p.aspectRule === 'required') list.push(['Wrong shape', `${p.name} requires square images. Pad the photo onto a square white canvas instead of stretching it.`]);
  if (p.background !== 'any' && p.id !== 'shopify') list.push(['Added text, logos or borders', `${p.name} doesn't allow badges, watermarks, "sale" text or frames on the main image. Remove them in your editor; no automated tool can judge content for you.`]);
  return list;
}

const header = (prefix) => `<header class="site-header"><div class="wrap header-row">
  <a class="brand" href="${prefix}./" aria-label="PureFrame home"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="6" fill="currentColor"/><rect x="9" y="9" width="14" height="14" rx="2" fill="var(--bg)"/></svg><span>PureFrame</span></a>
  <nav class="nav" aria-label="Main"><a href="${prefix}./#tool">Check photos</a><a href="${prefix}guides/">Requirements</a><a href="${prefix}./#pricing">Pricing</a><a class="btn btn-small btn-primary" href="${prefix}./#pricing">Get Pro</a></nav>
</div></header>`;
const footer = `<footer class="site-footer"><div class="wrap footer-row"><p>© ${YEAR} PureFrame. Photos are processed on your device and never uploaded.</p>
  <nav class="footer-links" aria-label="Requirements guides">${R.PRESETS.map((p) => `<a href="${p.id}-image-requirements.html">${esc(p.name)}</a>`).join('')}<a href="image-size-cheat-sheet.html">Cheat sheet</a></nav></div></footer>`;
const icon = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 32 32\'%3E%3Crect x=\'3\' y=\'3\' width=\'26\' height=\'26\' rx=\'6\' fill=\'%23111827\'/%3E%3Crect x=\'9\' y=\'9\' width=\'14\' height=\'14\' rx=\'2\' fill=\'%23fff\'/%3E%3C/svg%3E">';

function page({ title, description, canonical, body, jsonld, wide }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  ${icon}
  <link rel="stylesheet" href="../css/styles.css">
  ${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body>
${header('../')}
<main class="wrap guide${wide ? ' guide-wide' : ''}">
${body}
</main>
${footer}
</body>
</html>
`;
}

const guideUrl = (p) => `${SITE_URL}/guides/${p.id}-image-requirements.html`;
for (const p of R.PRESETS) {
  const rows = specRows(p);
  const rej = rejections(p);
  const checkUrl = `../?preset=${p.id}#tool`;
  const faq = [
    [`What background does ${p.name} require?`, rows[0][1] + '.'],
    [`What size should ${p.name} product images be?`, `Minimum: ${rows[2][1]}. ${p.recNote || ''}`.trim()],
    [`How do I check my photos against ${p.name}'s rules?`, `Drop them into PureFrame with the ${p.name} preset. It measures the background, frame fill, size, shape, format, file size and colour mode in your browser and can fix them in one click.`],
  ];
  const body = `
<p class="muted"><a href="./">Image requirements</a> › ${esc(p.name)}</p>
<h1>${esc(p.name)} image requirements (${YEAR})</h1>
<p class="updated">Last reviewed ${REVIEWED}. Official sources are linked at the bottom.</p>
<p>${esc(INTROS[p.id])}</p>
<div class="cta"><p>Check your photos against ${esc(p.name)}'s rules, free and private.</p><a class="btn btn-primary" href="${checkUrl}">Check my photos</a></div>
<h2>Quick specs</h2>
<table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
<h2>Checklist</h2>
<ul>${p.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
<h2>${p.background === 'required' ? `Why ${esc(p.name)} photos get rejected` : `Common problems with ${esc(p.name)} photos`}</h2>
${rej.map(([h, t]) => `<h3>${esc(h)}</h3><p>${esc(t)}</p>`).join('\n')}
<h2>Fix a photo in seconds</h2>
<ol>
  <li>Open <a href="${checkUrl}">PureFrame</a> and choose <strong>${esc(p.label)}</strong>.</li>
  <li>Drop in your photos. Each one is graded rule by rule.</li>
  <li>Click <strong>Fix</strong>. PureFrame makes the backdrop exactly #FFFFFF, scales the product to the right fill, exports at ${p.out.width.toLocaleString('en-US')} × ${p.out.height.toLocaleString('en-US')} px and checks the result again.</li>
</ol>
<p>Your photos never leave your computer: everything runs in the browser.</p>
<div class="cta"><p>Listing a whole catalog? PureFrame Pro fixes unlimited photos and names them for bulk upload.</p><a class="btn" href="../#pricing">See Pro</a></div>
<h2>Sources</h2>
<ul>${p.sources.map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.title)}</a></li>`).join('')}</ul>
<p class="hint">Marketplaces update their rules from time to time. When in doubt, the official page wins.</p>`;
  write(path.join(OUT, 'guides', `${p.id}-image-requirements.html`), page({
    title: `${p.name} Image Requirements ${YEAR}: Size, Background & Checklist | PureFrame`,
    description: `${p.name} product image requirements for ${YEAR}: ${rows[0][1].toLowerCase()}, ${p.fill ? Math.round(p.fill * 100) + '% frame fill, ' : ''}minimum ${rows[2][1]}. Free checker and one-click fix.`,
    canonical: guideUrl(p),
    body,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  }));
}

// How-to articles: pureframe/content/*.html, metadata in a leading <!--meta {...} --> comment.
const CONTENT = path.join(ROOT, 'content');
const articles = fs.readdirSync(CONTENT).filter((f) => f.endsWith('.html')).sort().map((f) => {
  const src = fs.readFileSync(path.join(CONTENT, f), 'utf8');
  const m = src.match(/^<!--meta (\{[\s\S]*?\}) -->\n/);
  if (!m) throw new Error(`${f}: missing <!--meta {...} --> header`);
  return { ...JSON.parse(m[1]), body: src.slice(m[0].length) };
});
for (const a of articles) {
  const url = `${SITE_URL}/guides/${a.slug}.html`;
  write(path.join(OUT, 'guides', `${a.slug}.html`), page({
    title: a.title, description: a.description, canonical: url,
    body: `<p class="muted"><a href="./">Guides</a> › ${esc(a.h1)}</p>\n<h1>${esc(a.h1)}</h1>\n<p class="updated">Last reviewed ${REVIEWED}.</p>\n${a.body}`,
    jsonld: { '@context': 'https://schema.org', '@type': 'Article', headline: a.h1, description: a.description, dateModified: new Date().toISOString().slice(0, 10), mainEntityOfPage: url },
  }));
}

// One table with every marketplace: the page people bookmark and link to.
const cheatCols = ['Background', 'Product fill', 'Minimum size', 'Recommended size', 'Shape', 'File types', 'Max file size'];
const cheatRows = R.PRESETS.map((p) => {
  const r = Object.fromEntries(specRows(p));
  return `<tr><th scope="row"><a href="${p.id}-image-requirements.html">${esc(p.name)}</a></th>${cheatCols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`;
}).join('');
write(path.join(OUT, 'guides', 'image-size-cheat-sheet.html'), page({
  title: `Product Image Size Cheat Sheet ${YEAR}: Amazon, Walmart, Etsy, eBay & More | PureFrame`,
  description: `Every marketplace's product image rules in one table: background, frame fill, minimum and recommended size, shape, file types and file size for Amazon, Walmart, TikTok Shop, eBay, Etsy, Shopify and Google Shopping (${YEAR}).`,
  canonical: `${SITE_URL}/guides/image-size-cheat-sheet.html`,
  wide: true,
  body: `<p class="muted"><a href="./">Guides</a> › Cheat sheet</p>
<h1>Product image size cheat sheet (${YEAR})</h1>
<p class="updated">Last reviewed ${REVIEWED}. Each marketplace links to its full guide and official sources.</p>
<p>The main-image rules for every major marketplace, side by side. Selling on several? Shoot at 2,200 px or more on a white backdrop with the product filling about 88% of the frame, and you can export for all of them from one original.</p>
<div class="table-scroll"><table class="wide"><thead><tr><th scope="col">Marketplace</th>${cheatCols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${cheatRows}</tbody></table></div>
<div class="cta"><p>Check a photo against any of these in seconds, free.</p><a class="btn btn-primary" href="../#tool">Check my photos</a></div>
<p class="hint">Feel free to link to or share this table. Marketplaces update their rules from time to time; the official page always wins.</p>`,
}));

write(path.join(OUT, 'guides', 'index.html'), page({
  title: `Marketplace Product Image Requirements ${YEAR} | PureFrame`,
  description: 'Product photo requirements for Amazon, Walmart, TikTok Shop, eBay, Etsy, Shopify and Google Shopping in one place, with a free checker.',
  canonical: `${SITE_URL}/guides/`,
  body: `<h1>Product image requirements by marketplace</h1>
<p class="updated">Last reviewed ${REVIEWED}.</p>
<p>Background, size, shape and file rules for the main product image on each major marketplace, with links to the official pages.</p>
<ul class="guide-list">${R.PRESETS.map((p) => `<li><a href="${p.id}-image-requirements.html"><strong>${esc(p.name)}</strong><span>${esc(specRows(p)[0][1])}</span></a></li>`).join('')}</ul>
<h2>How-to guides</h2>
<ul class="guide-list"><li><a href="image-size-cheat-sheet.html"><strong>Image size cheat sheet</strong><span>Every marketplace's rules in one table.</span></a></li>${articles.map((a) => `<li><a href="${a.slug}.html"><strong>${esc(a.h1)}</strong><span>${esc(a.card)}</span></a></li>`).join('')}</ul>
<div class="cta"><p>Check your photos against any of these, free.</p><a class="btn btn-primary" href="../#tool">Check my photos</a></div>`,
}));

const pages = ['/', '/guides/', ...R.PRESETS.map((p) => `/guides/${p.id}-image-requirements.html`), '/guides/image-size-cheat-sheet.html', ...articles.map((a) => `/guides/${a.slug}.html`)];
const today = new Date().toISOString().slice(0, 10);
write(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((u) => `  <url><loc>${SITE_URL}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
write(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
write(path.join(OUT, '404.html'), page({
  title: 'Page not found | PureFrame', description: 'Page not found.', canonical: `${SITE_URL}/`,
  body: '<h1>Page not found</h1><p><a href="../">Go to the PureFrame photo checker</a></p>',
}).replace('../css/styles.css', `${SITE_URL}/css/styles.css`).replaceAll('href="../', `href="${SITE_URL}/`)
  .replace(/href="([a-z0-9-]+\.html)"/g, `href="${SITE_URL}/guides/$1"`));

// ---------- Pro: one offline HTML file ----------
let pro = stripFree(read('index.html'));
const inline = (file) => read(file).replace(/<\/script/gi, '<\\/script');
pro = pro.replace('<link rel="stylesheet" href="css/styles.css">', () => `<style>\n${read('css/styles.css')}</style>`);
pro = pro.replace('<script src="js/config.js"></script>', () => `<script>window.PF_CONFIG = { edition: 'pro', proUrl: '', price: '', freeFixLimit: Infinity, goatcounter: '', aiAssets: 'script', aiScript: 'PureFrame AI.js' };</script>`);
for (const f of ['engine', 'rules', 'zip', 'matte', 'cutout', 'proof', 'catalog', 'app']) pro = pro.replace(`<script src="js/${f}.js"></script>`, () => `<script>\n${inline(`js/${f}.js`)}</script>`);
pro = pro.replace('<body class="edition-free">', '<body class="edition-pro">');
pro = pro.replace('<a class="brand" href="./"', '<a class="brand" href="#tool"'); // "./" from file:// opens a folder listing and loses work
pro = pro.replace(/<title>[^<]*<\/title>/, '<title>PureFrame Pro</title>');
if (/src="js\/|href="css\//.test(pro)) throw new Error('Pro build still references external files');
write(path.join(DIST, 'pro', 'PureFrame Pro.html'), pro);

// The AI runtime and model, base64-encoded in a classic script: browsers
// refuse fetch() from file://, but a <script src> next to the HTML loads fine.
const vendor = (f) => fs.readFileSync(path.join(VENDOR, f));
const aiScript = `/* PureFrame Pro on-device AI: ONNX Runtime Web 1.30.0 (MIT) and the U-2-Netp model (Apache-2.0).\n   See the licenses folder. Keep this file next to PureFrame Pro.html. */\n` +
  `window.PF_AI_ASSETS = { ort: ${JSON.stringify(vendor('ort.wasm.bundle.min.mjs').toString('utf8'))}, ` +
  `wasm: "${vendor('ort-wasm-simd-threaded.wasm').toString('base64')}", model: "${vendor('u2netp.onnx').toString('base64')}" };\n`;
write(path.join(DIST, 'pro', 'PureFrame AI.js'), aiScript);

const readme = `PureFrame Pro
=============

Thanks for buying PureFrame Pro!

GETTING STARTED
1. Unzip this folder anywhere you like (Desktop, Documents...). Keep the
   files together: "PureFrame AI.js" powers the AI background removal.
2. Double-click "PureFrame Pro.html". It opens in your web browser
   (Chrome, Edge, Safari or Firefox) on Mac, Windows or Linux.
3. Drop in your photos. Each one shows a verdict for all 7 marketplaces.
   Click "Fix all" for one marketplace, or "Export for marketplaces" to
   get every photo for every marketplace you pick, in folders, with an
   evidence report.

Tip: bookmark the file in your browser, or keep it in your Dock or
taskbar, so it's one click away.

WHAT'S INCLUDED
- Unlimited checks and one-click fixes for Amazon, Walmart, TikTok Shop,
  eBay, Etsy, Shopify and Google Shopping.
- On-device AI background removal for photos shot anywhere (kitchen
  table, desk, outdoors). Runs offline; nothing is uploaded.
- One photo -> every marketplace: correctly sized files sorted into a
  folder per marketplace, as a ZIP or saved straight to a folder
  (Chrome and Edge).
- Proof after compression: every saved file is decoded and re-checked;
  wherever a white background is required or recommended, the background
  more than 8 px from the product is exactly #FFFFFF.
- Evidence report for each file: evidence-report.csv and a printable
  evidence-report.html with the measured numbers.
- Names from your product spreadsheet: in the export window choose
  "Name files from a spreadsheet" and pick a CSV with a File or SKU
  column plus ASIN / UPC / EAN / GTIN. Amazon files become
  ASIN.MAIN.jpg, ASIN.PT01.jpg...; Walmart files use the GTIN.
  Without a spreadsheet: Fix settings > Output > File names.
- Custom output size, product fill, format and JPEG quality.
- Works fully offline. Your photos never leave your computer.

TIPS FOR BEST RESULTS
- Shoot on a white or light grey backdrop with even light.
- If grey patches remain, raise "Background cleanup". If a white product
  loses its edges, lower it.
- Studio shots use the backdrop cleanup, which keeps real shadows. Busy
  backgrounds are cut out by the on-device AI automatically (Fix settings >
  AI cut-out). Zoom in to check fine details such as straps, fur or glass.
- Content rules (no text, logos or props) still need your eye.

UPDATES & SUPPORT
Rule updates are free for at least 12 months: when marketplace rules
change, download the new version from the same place you got this one. For help, reply to your
purchase receipt email.

LICENSE
This copy is licensed to one person or business, for your own products
and for client work, on any number of your own devices. Please don't
share or resell the files.
`;
write(path.join(DIST, 'pro', 'READ ME FIRST.txt'), readme);
const licenses = ['README.md', 'LICENSE-onnxruntime-web.txt', 'LICENSE-U2Net-Apache-2.0.txt']
  .map((f) => ({ name: `PureFrame Pro/licenses/${f === 'README.md' ? 'THIRD-PARTY.md' : f}`, data: vendor(f) }));
const zip = Z.build([
  { name: 'PureFrame Pro/PureFrame Pro.html', data: new TextEncoder().encode(pro) },
  { name: 'PureFrame Pro/PureFrame AI.js', data: new TextEncoder().encode(aiScript) },
  { name: 'PureFrame Pro/READ ME FIRST.txt', data: new TextEncoder().encode(readme) },
  ...licenses,
], undefined, (d) => zlib.deflateRawSync(d, { level: 9 }));
write(path.join(DIST, 'PureFrame-Pro.zip'), zip);

console.log(`Built dist/site (${pages.length} pages, SITE_URL=${SITE_URL}) and dist/PureFrame-Pro.zip (${(zip.length / 1048576).toFixed(1)} MB)`);
