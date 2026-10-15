/* Proof that an exported photo still meets the rules after it was saved: a
 * strict background test run on the decoded output file, plus evidence
 * records, a CSV export and a printable HTML report built from them.
 * Pure functions; runs in the browser (window.PFProof) and in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFProof = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MB = 1024 * 1024;

  /* rendered: the exact pixels PureFrame drew before encoding.
   * decoded: the same image after JPEG/PNG encode + decode.
   * The strict background is every pixel that is exactly #FFFFFF in rendered
   * and more than `margin` px (Chebyshev distance) from any pixel that isn't.
   * Those pixels have no reason to be anything but white in the saved file, so
   * any drift there is a compression artifact a marketplace checker can flag.
   * The neighbourhood test is a square dilation done as two running-count
   * passes (along rows, then down columns), so the cost is O(width × height)
   * whatever the margin. */
  function strictBackground(rendered, decoded, opts) {
    const W = rendered.width, H = rendered.height, N = W * H;
    if (!decoded || decoded.width !== W || decoded.height !== H) {
      throw new Error('The rendered and decoded images must be the same size.');
    }
    const m = Math.max(0, Math.floor(opts && opts.margin != null ? opts.margin : 2));
    const src = rendered.data, out = decoded.data;

    // 1 where the rendered pixel is not exactly white
    const ink = new Uint8Array(N);
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      ink[i] = src[p] !== 255 || src[p + 1] !== 255 || src[p + 2] !== 255 ? 1 : 0;
    }

    // Row pass: near[i] = 1 when ink lies within m px on the same row.
    // `count` is the ink in the window [x - m, x + m].
    const near = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let count = 0;
      for (let x = 0; x <= m && x < W; x++) count += ink[row + x];
      for (let x = 0; x < W; x++) {
        near[row + x] = count > 0 ? 1 : 0;
        if (x + m + 1 < W) count += ink[row + x + m + 1];
        if (x - m >= 0) count -= ink[row + x - m];
      }
    }

    // Column pass, walked row by row so memory access stays sequential:
    // cols[x] counts `near` pixels in rows [y - m, y + m] of column x.
    const cols = new Int32Array(W);
    const addRow = (r, sign) => { for (let x = 0, o = r * W; x < W; x++) cols[x] += sign * near[o + x]; };
    for (let y = 0; y <= m && y < H; y++) addRow(y, 1);

    let checked = 0, nonWhite = 0, darkest = 255;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (cols[x] !== 0) continue;
        checked++;
        const p = (row + x) * 4, r = out[p], g = out[p + 1], b = out[p + 2];
        if (r !== 255 || g !== 255 || b !== 255) {
          nonWhite++;
          const lo = Math.min(r, g, b);
          if (lo < darkest) darkest = lo;
        }
      }
      if (y + m + 1 < H) addRow(y + m + 1, 1);
      if (y - m >= 0) addRow(y - m, -1);
    }
    return { checked, nonWhite, darkest, pure: checked ? (checked - nonWhite) / checked : 1 };
  }

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v) => (v == null ? '' : String(v));
  // The objects in an array, skipping null and anything else that isn't one
  const objects = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && typeof x === 'object') : []);

  /* One JSON-serialisable record per exported file.
   * report: PFRules.evaluate() of the decoded export; analysis: PFEngine.analyze()
   * of it; strict: strictBackground() result (optional); file: { name, size,
   * type, width, height } of the export; preset: { id, name }.
   * A strict result that checked no pixels (no white far enough from the
   * product, e.g. a full-bleed photo) measured nothing: its pure 1 and
   * darkest 255 are placeholders, so the record says null rather than
   * presenting them as proof. */
  function evidence(input) {
    const { marketplace, preset, report, analysis, strict, attempts, encoder } = input || {};
    const file = (input && input.file) || {};
    const checks = objects(report && report.checks).map((c) => ({
      id: str(c.id), status: str(c.status), label: str(c.label), detail: str(c.detail),
    }));
    const labels = (status) => checks.filter((c) => c.status === status).map((c) => c.label);
    const bg = analysis && analysis.background;
    const measured = strict && num(strict.checked) > 0 ? strict : null;
    return {
      file: str(file.name),
      marketplace: str(marketplace || (preset && preset.name)),
      presetId: preset && preset.id != null ? String(preset.id) : null,
      status: report && ['pass', 'warn', 'fail'].includes(report.status) ? report.status : 'fail',
      width: num(file.width),
      height: num(file.height),
      bytes: num(file.size),
      type: str(file.type),
      colour: 'sRGB',
      backgroundPure: bg ? num(bg.pure) : null,
      strictPure: measured ? num(measured.pure) : null,
      darkestBackground: measured ? num(measured.darkest) : null,
      strayPixels: measured ? num(measured.nonWhite) : null,
      fill: analysis && analysis.fill ? num(analysis.fill.longest) : null,
      attempts: num(attempts),
      encoder: encoder == null ? null : String(encoder),
      checks,
      failed: labels('fail'),
      warned: labels('warn'),
    };
  }

  /* Percentage with one decimal, as a string of digits ("99.8"). A share that
   * isn't exactly 1 never rounds up to 100.0, and one above 0 never shows as
   * 0.0, so the evidence can't overstate or hide a single stray pixel. */
  function pct1(v) {
    if (num(v) == null) return null;
    let r = Math.round(v * 1000) / 10;
    if (r >= 100 && v < 1) r = 99.9;
    if (r <= 0 && v > 0) r = 0.1;
    return r.toFixed(1);
  }

  // '99.8%', or an en dash when there is nothing to show
  function fmtPct(v) {
    const s = pct1(v);
    return s == null ? '–' : s + '%';
  }

  const CSV_COLUMNS = ['file', 'marketplace', 'status', 'width', 'height', 'bytes', 'type', 'colour',
    'background_pure_pct', 'strict_pure_pct', 'darkest_background', 'stray_pixels', 'fill_pct',
    'encoder', 'attempts', 'failed', 'warned'];

  /* RFC 4180 cell. Text that a spreadsheet would run as a formula gets an
   * apostrophe; numbers are written as they are. Excel in many European
   * locales splits .csv files on ';' and only honours quotes at the start of
   * a line, so the guard also covers text right after every ';', and cells
   * with ';' are quoted for readers that accept either separator. */
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    const s = String(v).replace(/(^|;)(?=[=+\-@\t\r])/g, "$1'");
    return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const joined = (v) => (Array.isArray(v) ? v.filter((x) => x != null).join('; ') : '');

  function toCSV(records) {
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of objects(records)) {
      lines.push([
        r.file, r.marketplace, r.status, num(r.width), num(r.height), num(r.bytes), r.type, r.colour,
        pct1(r.backgroundPure), pct1(r.strictPure), num(r.darkestBackground), num(r.strayPixels), pct1(r.fill),
        r.encoder, num(r.attempts), joined(r.failed), joined(r.warned),
      ].map(csvCell).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  const esc = (v) => str(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const int = (v) => (num(v) == null ? '–' : v.toLocaleString('en-US'));
  const fmtBytes = (b) => (num(b) == null ? '–' : b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const dims = (r) => (num(r.width) == null || num(r.height) == null ? '–' : `${int(r.width)} × ${int(r.height)} px`);
  const typeName = (t) => (t ? String(t).replace('image/', '').toUpperCase() : '–');
  const STATUS_TEXT = { pass: 'Pass', warn: 'Warning', fail: 'Fail', info: 'Info' };
  const badge = (s) => {
    const k = Object.prototype.hasOwnProperty.call(STATUS_TEXT, s) ? s : 'info';
    return `<span class="badge ${k}">${esc(STATUS_TEXT[k])}</span>`;
  };
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

  const CSS = `
*{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;padding:32px 24px;background:#fff;color:#1b1f24;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:980px;margin:0 auto}
h1{font-size:22px;line-height:1.25;margin:0 0 4px}
h2{font-size:16px;margin:28px 0 10px}
.meta{color:#59616b;margin:0}
.summary{margin:14px 0 0;padding:10px 14px;border:1px solid #e2e5e9;border-radius:8px;background:#f8f9fa}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #e2e5e9}
th{font-weight:600;color:#59616b;border-bottom-color:#c8cdd3}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.name{word-break:break-all}
.badge{display:inline-block;padding:0 8px;border:1px solid;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
.pass{color:#14612f;background:#e8f6ed;border-color:#b4dfc2}
.warn{color:#7a4a00;background:#fff4dd;border-color:#efd398}
.fail{color:#a0141c;background:#fde9ea;border-color:#f1b7bb}
.info{color:#34475b;background:#eef2f6;border-color:#cdd6e0}
.glossary{margin:0;display:grid;grid-template-columns:minmax(150px,max-content) 1fr;gap:4px 16px;font-size:13px}
.glossary dt{font-weight:600}
.glossary dd{margin:0;color:#3c434b}
.record{border:1px solid #e2e5e9;border-radius:8px;padding:14px 16px;margin:0 0 14px;break-inside:avoid;page-break-inside:avoid}
.record h3{font-size:15px;margin:0 0 2px;word-break:break-all}
.record .sub{margin:0 0 8px;color:#59616b}
.facts{margin:0 0 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 16px}
.facts dt{color:#59616b;font-size:11.5px}
.facts dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.checks{list-style:none;margin:0;padding:0}
.checks li{display:grid;grid-template-columns:76px 1fr;gap:8px;padding:6px 0;border-top:1px solid #eef0f2}
.checks .label{font-weight:600}
.checks .detail{color:#3c434b}
footer{margin-top:28px;padding-top:12px;border-top:1px solid #e2e5e9;color:#59616b;font-size:12px}
footer p{margin:0 0 6px}
@page{margin:14mm}
@media print{
body{padding:0;font-size:10.5pt}
main{max-width:none}
.badge,.summary{-webkit-print-color-adjust:exact;print-color-adjust:exact}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
h2{break-after:avoid;page-break-after:avoid}
}`;

  /* A standalone, printable HTML document: inline CSS, no scripts, no external
   * resources. generatedAt is shown as given (this module never reads the
   * clock); product is the tool name, e.g. 'PureFrame Pro'. */
  function reportHTML(records, opts) {
    const { title, generatedAt, product } = opts || {};
    records = objects(records);
    const tool = product ? String(product) : 'PureFrame';
    const heading = title ? String(title) : `${tool} evidence report`;
    const count = { pass: 0, warn: 0, fail: 0 };
    for (const r of records) if (Object.prototype.hasOwnProperty.call(count, r.status)) count[r.status]++;

    const meta = generatedAt ? `Generated ${esc(generatedAt)} by ${esc(tool)}.` : `Generated by ${esc(tool)}.`;
    const summary = `${plural(records.length, 'file', 'files')}: ${int(count.pass)} passed, `
      + `${int(count.warn)} with warnings, ${int(count.fail)} failed.`;

    const rows = records.length ? records.map((r) => `<tr>
<td class="name">${esc(r.file)}</td><td>${esc(r.marketplace)}</td><td>${badge(r.status)}</td>
<td class="num">${esc(dims(r))}</td><td class="num">${esc(fmtBytes(r.bytes))}</td>
<td class="num">${esc(fmtPct(r.strictPure))}</td><td class="num">${esc(int(r.darkestBackground))}</td>
<td class="num">${esc(int(r.strayPixels))}</td><td class="num">${esc(fmtPct(r.fill))}</td>
</tr>`).join('\n') : '<tr><td colspan="9">No files in this report.</td></tr>';

    const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    const details = records.map((r) => {
      const checks = objects(r.checks).map((c) => `<li>${badge(c.status)}<div><div class="label">${esc(c.label)}</div>`
        + `${c.detail ? `<div class="detail">${esc(c.detail)}</div>` : ''}</div></li>`).join('\n');
      return `<section class="record">
<h3>${esc(r.file)}</h3>
<p class="sub">${esc(r.marketplace)} · ${badge(r.status)}</p>
<dl class="facts">
${fact('Size', dims(r))}
${fact('File size', fmtBytes(r.bytes))}
${fact('Format', r.encoder || typeName(r.type))}
${fact('Colour', r.colour || '–')}
${fact('Background exactly white', fmtPct(r.backgroundPure))}
${fact('Strict background', fmtPct(r.strictPure))}
${fact('Darkest background value', int(r.darkestBackground))}
${fact('Stray pixels', int(r.strayPixels))}
${fact('Product fill', fmtPct(r.fill))}
${fact('Encode attempts', int(r.attempts))}
</dl>
<ul class="checks">
${checks || '<li><span></span><div class="detail">No checks recorded.</div></li>'}
</ul>
</section>`;
    }).join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<style>${CSS}
</style>
</head>
<body>
<main>
<header>
<h1>${esc(heading)}</h1>
<p class="meta">${meta}</p>
<p class="summary">${esc(summary)}</p>
</header>
<h2>Files</h2>
<table>
<thead><tr><th scope="col">File</th><th scope="col">Marketplace</th><th scope="col">Status</th><th scope="col" class="num">Size</th><th scope="col" class="num">File size</th><th scope="col" class="num">Strict background</th><th scope="col" class="num">Darkest background</th><th scope="col" class="num">Stray pixels</th><th scope="col" class="num">Fill</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<h2>How to read this</h2>
<dl class="glossary">
<dt>Strict background</dt><dd>Share of the background, away from the product edge, that is exactly #FFFFFF (RGB 255, 255, 255) in the saved file, measured after compression. A dash means there was no such background to measure, for example when the photo fills the frame.</dd>
<dt>Darkest background</dt><dd>The lowest colour value found in that background. 255 means every pixel is pure white.</dd>
<dt>Stray pixels</dt><dd>How many background pixels are not exactly white in the saved file.</dd>
<dt>Fill</dt><dd>How much of the frame the product's longest side spans.</dd>
</dl>
${records.length ? `<h2>Details</h2>\n${details}` : ''}
<footer>
<p>These are measurements against each marketplace's published image rules, not a guarantee that a listing will be approved.</p>
<p>Content rules, such as no added text, logos, watermarks or props, need a human eye.</p>
</footer>
</main>
</body>
</html>
`;
  }

  return { strictBackground, evidence, toCSV, reportHTML, fmtPct };
});
