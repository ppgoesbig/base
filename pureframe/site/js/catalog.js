/* Spreadsheet naming for bulk uploads: reads the seller's product sheet (CSV),
 * matches photo files to rows and builds the file names each marketplace's
 * bulk uploader expects, such as B000123456.MAIN.jpg for Amazon.
 * Pure functions; runs in the browser (window.PFCatalog) and in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NO_MATCH = 'No matching row in the spreadsheet';
  const NO_ID = 'Row has no ASIN, UPC, EAN, GTIN or SKU';
  const AMAZON_SLOTS = 'Amazon allows MAIN plus PT01–PT08 only';
  const DUPLICATE = 'Two photos would get the same name';
  const BAD_BARCODE = 'This barcode isn\'t a valid UPC, EAN or GTIN. Check it for typos';
  const BAD_ASIN = 'ASINs are 10 letters and digits. Check this one for typos';
  const SKU_SYMBOLS = 'Amazon file names can\'t contain this SKU\'s symbols, so Amazon may not match it. Add the ASIN or UPC';
  const excelNumber = (v) => `This barcode was saved as ${v}, so digits are missing. Format the column as text and export again`;
  const ID_LABELS = { asin: 'ASIN', upc: 'UPC', ean: 'EAN', gtin: 'GTIN' };
  const conflict = (key) => `Rows with this SKU have different ${ID_LABELS[key]}s, so this photo can't be matched to one. Add its file name to the right row`;

  // Identifier preference for each marketplace's file names.
  const NAME_KEYS = {
    amazon: ['asin', 'upc', 'ean', 'gtin', 'sku'],
    walmart: ['gtin', 'upc', 'ean', 'sku'],
    other: ['sku', 'asin', 'upc', 'ean', 'gtin'],
  };
  const nameKeys = (mkt) => NAME_KEYS[mkt === 'amazon' || mkt === 'walmart' ? mkt : 'other'];
  const IMAGE_EXT = /\.(jpe?g|jpe|jfif|png|gif|webp|tiff?|bmp|heic|heif|avif|psd|svg)$/i;
  const SEPARATORS = ' _-.';
  // What a spreadsheet shows for a long number it stored as a float, e.g. 8.40123E+11
  const SCIENTIFIC = /^\d+(?:[.,]\d+)?e\+?\d+$/i;
  // Cells people fill in to mean "nothing here"
  const PLACEHOLDER = /^(?:n\/?a|none|null|nil|tbd|tba|unknown|-+|—|–|\?+|0)$/i;

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const str = (v) => (v == null ? '' : String(v));
  const fold = (s) => str(s).normalize('NFC').trim().toLowerCase();

  // A cell that holds an identifier: not blank, "N/A" or similar.
  function isReal(v) {
    const s = str(v).trim();
    return s !== '' && !PLACEHOLDER.test(s) && /[A-Za-z0-9]/.test(s);
  }

  // Comparable form of an identifier: "b0x-12" equals "B0X12", and a barcode
  // equals itself with leading zeros (UPC-A 036… is GTIN-14 00036…).
  function idKey(v) {
    const s = str(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^\d+$/.test(s) ? s.replace(/^0+/, '') : s;
  }

  // First identifier in `keys` the record fills in. One its rows disagree on
  // (see product()) stops the search: falling back to another identifier
  // would hide the disagreement.
  function pick(rec, keys) {
    const conflicts = Array.isArray(rec.conflicts) ? rec.conflicts : [];
    for (const k of keys) {
      if (conflicts.includes(k)) return { key: k, value: '', conflict: true };
      if (isReal(rec[k])) return { key: k, value: str(rec[k]).trim(), conflict: false };
    }
    return null;
  }

  /* ---------- CSV ---------- */

  // The header row picks the delimiter: comma, unless it has none and uses
  // semicolons or tabs instead (European Excel exports).
  function sniff(text) {
    let comma = 0, semi = 0, tab = 0, quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') quoted = !quoted;
      else if (quoted) continue;
      else if (c === '\n' || c === '\r') break;
      else if (c === ',') comma++;
      else if (c === ';') semi++;
      else if (c === '\t') tab++;
    }
    if (comma || (!semi && !tab)) return ',';
    return tab >= semi ? '\t' : ';';
  }

  // RFC 4180 records. Lenient like spreadsheets are: a stray quote inside an
  // unquoted field is kept as text, and an unclosed quote runs to the end.
  function records(text, delim) {
    const out = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c !== '"') field += c;
        else if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (c === '"' && field.trim() === '') {
        quoted = true; field = '';
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\r' || c === '\n') {
        row.push(field); out.push(row); row = []; field = '';
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); out.push(row); }
    return out;
  }

  function parseCSV(text) {
    if (typeof text !== 'string') return { headers: [], rows: [] };
    let s = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/^[\r\n]+/, '');
    // Excel's optional first line "sep=;" names the delimiter outright.
    const hint = /^sep=([^\r\n])[^\S\r\n]*(?:\r\n|\r|\n|$)/i.exec(s);
    const delim = hint ? hint[1] : sniff(s);
    if (hint) s = s.slice(hint[0].length);

    const recs = records(s, delim).filter((r) => r.some((c) => c.trim() !== ''));
    if (!recs.length) return { headers: [], rows: [] };
    const head = recs[0].map((h) => h.trim());
    const keep = head.map((h, i) => i).filter((i) => head[i] !== '');
    const rows = recs.slice(1).map((rec) => {
      const row = {};
      for (const i of keep) {
        const v = str(rec[i]).trim();
        // A repeated header keeps its first non-empty value.
        if (!hasOwn(row, head[i]) || row[head[i]] === '') row[head[i]] = v;
      }
      return row;
    });
    return { headers: keep.map((i) => head[i]), rows };
  }

  /* ---------- columns and index ---------- */

  // Header aliases, compared lowercase with spaces and punctuation removed.
  // A few common export headers are included beyond the obvious ones
  // (Shopify's "Variant SKU" and "Variant Barcode", Amazon's "asin1").
  const ALIASES = {
    file: ['file', 'filename', 'file name', 'image', 'image file', 'image file name', 'image name', 'photo', 'picture'],
    sku: ['sku', 'seller sku', 'item sku', 'product id', 'item id', 'style', 'variant sku', 'product sku', 'merchant sku'],
    asin: ['asin', 'asin1'],
    upc: ['upc', 'upc code'],
    ean: ['ean', 'ean13', 'barcode', 'ean code', 'variant barcode'],
    gtin: ['gtin', 'gtin14', 'gtin-14', 'gtin13', 'gtin12'],
    variant: ['variant', 'slot', 'position', 'image type', 'view', 'image variant'],
  };
  const headerKey = (h) => str(h).toLowerCase().replace(/[^a-z0-9]/g, '');

  function columns(headers) {
    const list = Array.isArray(headers) ? headers : [];
    const keys = list.map(headerKey), used = new Set(), out = {};
    for (const field of Object.keys(ALIASES)) {
      out[field] = null;
      for (const alias of ALIASES[field]) {
        const i = keys.findIndex((k, j) => k && k === headerKey(alias) && !used.has(j));
        if (i >= 0) { out[field] = list[i]; used.add(i); break; }
      }
    }
    return out;
  }

  // Lookup key for a file name or the File column: no folder, query string or
  // image extension; NFC so macOS names (decomposed accents) match the sheet.
  function fileStem(name) {
    let s = str(name).trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      s = s.replace(/[?#].*$/, '');
      try { s = decodeURIComponent(s); } catch (e) { /* keep as is */ }
    }
    s = s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1);
    return fold(s.replace(IMAGE_EXT, ''));
  }

  /* What the rows of one SKU say about the product: each identifier from
   * whichever rows fill it in, and no variant, since a variant describes one
   * photo. Rows that disagree (two ASINs under one parent style number, say)
   * leave that identifier blank and list it in `conflicts`, so a photo
   * matched only by SKU never takes another product's identifier. */
  function product(recs) {
    const p = Object.assign({}, recs[0], { variant: '' }), conflicts = [];
    for (const k of Object.keys(ID_LABELS)) {
      const real = recs.map((r) => r[k]).filter(isReal);
      if (!real.length) continue;
      if (new Set(real.map(idKey)).size > 1) { p[k] = ''; conflicts.push(k); } else p[k] = real[0];
    }
    if (conflicts.length) p.conflicts = conflicts;
    return p;
  }

  /* byFile holds each row under its file name. bySku holds each real SKU
   * (not "N/A" or similar): the row itself when the SKU is on one row that
   * names no file, so that row's variant can apply to the photo named after
   * the SKU; otherwise product() of its rows. */
  function buildIndex(rows, cols) {
    const byFile = new Map(), bySku = new Map(), skuRows = new Map();
    const list = Array.isArray(rows) ? rows : [];
    const c = cols || columns(list.length && list[0] ? Object.keys(list[0]) : []);
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const get = (f) => (c[f] && row[c[f]] != null ? str(row[c[f]]).trim() : '');
      const rec = { sku: get('sku'), asin: get('asin'), upc: get('upc'), ean: get('ean'), gtin: get('gtin'), variant: get('variant'), row };
      const fk = fileStem(get('file'));
      if (fk && !byFile.has(fk)) byFile.set(fk, rec);
      if (!isReal(rec.sku)) continue;
      const sk = fold(rec.sku);
      if (!skuRows.has(sk)) skuRows.set(sk, { recs: [], named: false });
      const s = skuRows.get(sk);
      s.recs.push(rec);
      if (fk) s.named = true;
    }
    for (const [sk, s] of skuRows) bySku.set(sk, s.recs.length === 1 && !s.named ? s.recs[0] : product(s.recs));
    return { byFile, bySku };
  }

  /* ---------- matching ---------- */

  // Longest SKU that is the whole stem or followed by a separator, so
  // "abc-1_2" picks SKU "abc-1" over "abc" and "abcd" doesn't match "abc".
  function skuPrefix(stem, bySku) {
    if (!stem || !bySku.size) return null;
    if (bySku.has(stem)) return { rec: bySku.get(stem), exact: true };
    for (let i = stem.length - 1; i > 0; i--) {
      if (SEPARATORS.includes(stem[i]) && bySku.has(stem.slice(0, i))) return { rec: bySku.get(stem.slice(0, i)), exact: false };
    }
    return null;
  }

  // Natural order: digit runs compare as numbers, so img2 < img10.
  function natural(a, b) {
    const ta = a.match(/\d+|\D+/g) || [], tb = b.match(/\d+|\D+/g) || [];
    for (let i = 0; i < ta.length && i < tb.length; i++) {
      const x = ta[i], y = tb[i];
      if (x === y) continue;
      if (/^\d/.test(x) && /^\d/.test(y)) {
        const nx = x.replace(/^0+/, ''), ny = y.replace(/^0+/, '');
        if (nx.length !== ny.length) return nx.length - ny.length;
        if (nx !== ny) return nx < ny ? -1 : 1;
        return x.length - y.length;
      }
      return x < y ? -1 : 1;
    }
    return ta.length - tb.length;
  }

  // Amazon image variant code, or '' when the cell isn't one.
  function amazonVariant(v) {
    const s = str(v).trim().toUpperCase().replace(/[\s.]/g, '');
    if (s === 'MAIN' || s === 'SWCH') return s;
    if (s === 'SWATCH') return 'SWCH';
    const pt = /^PT0?([1-8])$/.exec(s);
    return pt ? 'PT0' + pt[1] : '';
  }
  const variantRank = (code) => (code === 'MAIN' ? 0 : code === 'SWCH' ? Infinity : code ? Number(code.slice(2)) : null);

  /* Which product a photo belongs to, for numbering. Rows that share a real
   * SKU are one product unless they disagree on an ASIN or barcode (a parent
   * style number shared by colours, say). Otherwise a photo's product is the
   * identifiers its names would use on Amazon, Walmart and the rest, so
   * photos are only numbered together when every marketplace would name
   * them after the same identifier. */
  function productKey(rec, bySku, ids) {
    const sk = isReal(rec.sku) ? fold(rec.sku) : '';
    const p = sk && bySku.get(sk);
    if (sk && !(p && p.conflicts)) return 'sku:' + sk;
    const parts = Object.values(NAME_KEYS).map((keys) => {
      const id = pick(rec, keys);
      return id ? id.key + ':' + (id.conflict ? '?' : idKey(id.value)) : '';
    });
    if (parts.some(Boolean)) return 'ids:' + parts.join('|');
    if (!ids.has(rec)) ids.set(rec, 'row:' + ids.size);
    return ids.get(rec);
  }

  const isMainHint = (stem) => /(?:^|[ _.-])main$/.test(stem);

  /* Order of one product's photos. Photos with an explicit variant take their
   * place (MAIN first, PT01–PT08 next, SWCH last); the rest fill the free
   * places in natural order, with a name ending in "main" first. Placing
   * PT03 at position 3 rather than straight after MAIN means a photo
   * without a variant never gets a slot an explicit one already uses. */
  function order(group) {
    const explicit = [], plain = [];
    for (const it of group) (it.rank === null ? plain : explicit).push(it);
    const tie = (a, b) => natural(a.stem, b.stem) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.i - b.i;
    explicit.sort((a, b) => (a.rank === b.rank ? tie(a, b) : a.rank - b.rank));
    plain.sort((a, b) => isMainHint(b.stem) - isMainHint(a.stem) || tie(a, b));
    const out = [];
    let x = 0, p = 0;
    while (x < explicit.length || p < plain.length) {
      if (x < explicit.length && (explicit[x].rank <= out.length || p >= plain.length)) out.push(explicit[x++]);
      else out.push(plain[p++]);
    }
    return out;
  }

  function match(fileNames, index) {
    const list = Array.isArray(fileNames) ? fileNames : [];
    const byFile = index && index.byFile instanceof Map ? index.byFile : new Map();
    const bySku = index && index.bySku instanceof Map ? index.bySku : new Map();
    const extras = new Map();
    const items = list.map((f, i) => {
      const file = typeof f === 'string' ? f : f && typeof f.name === 'string' ? f.name : str(f);
      const stem = fileStem(file);
      let record = null, how = null, hit;
      if (stem && byFile.has(stem)) { record = byFile.get(stem); how = 'file'; }
      else if ((hit = skuPrefix(stem, bySku))) {
        record = hit.rec; how = 'sku';
        // A name longer than the SKU is an extra photo of the product, so a
        // row's variant (which describes one photo) isn't its own.
        if (!hit.exact && record.variant) {
          if (!extras.has(record)) extras.set(record, Object.assign({}, record, { variant: '' }));
          record = extras.get(record);
        }
      }
      return { i, file, stem, record, how, slot: null, rank: record ? variantRank(amazonVariant(record.variant)) : null };
    });

    const groups = new Map(), ids = new Map();
    for (const it of items) {
      if (!it.record) continue;
      const key = productKey(it.record, bySku, ids);
      if (groups.has(key)) groups.get(key).push(it);
      else groups.set(key, [it]);
    }
    for (const g of groups.values()) order(g).forEach((it, slot) => { it.slot = slot; });
    return items.map(({ file, record, slot, how }) => ({ file, record, slot, how }));
  }

  /* ---------- naming ---------- */

  // GTIN check digit (UPC-A, EAN-8/13 and GTIN-14 share it; leading zeros don't change it).
  function checkDigitOk(code) {
    let sum = 0;
    for (let i = code.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += (code.charCodeAt(i) - 48) * w;
    return (10 - (sum % 10)) % 10 === code.charCodeAt(code.length - 1) - 48;
  }

  // An 8-digit UPC-E (number system 0 or 1) written out as the UPC-A it
  // stands for, whose check digit it carries; '' when it can't be one.
  function upcA(e) {
    const [n, a, b, c, d, x, f, check] = e;
    if (n !== '0' && n !== '1') return '';
    const body = f <= '2' ? a + b + f + '0000' + c + d + x
      : f === '3' ? a + b + c + '00000' + d + x
        : f === '4' ? a + b + c + d + '00000' + x
          : a + b + c + d + x + '0000' + f;
    return n + body + check;
  }

  // Cleans a UPC/EAN/GTIN cell. An 11-digit UPC lost its leading zero to a
  // spreadsheet and gets it back; a value in scientific notation lost digits
  // for good, so it can't be used. Eight digits can be an EAN-8 or a UPC-E.
  function barcode(v) {
    if (SCIENTIFIC.test(v)) return { code: '', error: excelNumber(v) };
    const digits = v.replace(/[\s-]/g, '');
    if (!/^\d+$/.test(digits)) return { code: v.replace(/[^A-Za-z0-9]/g, ''), problem: BAD_BARCODE };
    const code = digits.length === 11 ? '0' + digits : digits;
    const ok = code.length === 8 ? checkDigitOk(code) || (upcA(code) !== '' && checkDigitOk(upcA(code)))
      : [12, 13, 14].includes(code.length) && checkDigitOk(code);
    return { code, problem: ok ? null : BAD_BARCODE };
  }

  // Output extension: the one given (with or without the dot), or the photo's own.
  function extension(ext, file) {
    if (typeof ext === 'string') {
      const e = ext.trim();
      return !e ? '' : e[0] === '.' ? e : '.' + e;
    }
    const m = IMAGE_EXT.exec(str(file));
    return m ? m[0].toLowerCase() : '';
  }

  /* entry: one result of match(); ext: '.jpg' etc. (omit to keep the photo's own).
   * Returns { name, problem }. A name with a problem is usable but worth a look;
   * a null name can't be built. */
  function name(entry, marketplace, ext) {
    const rec = entry && entry.record;
    if (!rec) return { name: null, problem: NO_MATCH };
    const slot = Number.isInteger(entry.slot) && entry.slot > 0 ? entry.slot : 0;
    const x = extension(ext, entry.file);
    const mkt = str(marketplace).toLowerCase();
    const id = pick(rec, nameKeys(mkt));
    if (!id) return { name: null, problem: NO_ID };
    if (id.conflict) return { name: null, problem: conflict(id.key) };

    let value, problem = null;
    if (id.key === 'asin') {
      value = id.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (value.length !== 10) problem = BAD_ASIN;
    } else if (id.key !== 'sku') {
      const b = barcode(id.value);
      if (b.error) return { name: null, problem: b.error };
      value = b.code;
      problem = b.problem;
    }

    if (mkt === 'amazon') {
      if (id.key === 'sku') {
        value = id.value.replace(/[^A-Za-z0-9]/g, '');
        if (value !== id.value) problem = SKU_SYMBOLS;
      }
      let variant = amazonVariant(rec.variant);
      if (!variant) {
        if (slot > 8) return { name: null, problem: AMAZON_SLOTS };
        variant = slot === 0 ? 'MAIN' : 'PT0' + slot;
      }
      return { name: `${value}.${variant}${x}`, problem };
    }
    if (mkt === 'walmart') {
      // Barcodes keep the length the sheet gives them; padding a UPC-E to
      // 14 digits would make a GTIN that doesn't exist.
      if (id.key === 'sku') value = id.value.replace(/[^A-Za-z0-9_-]/g, '');
      return { name: (slot ? `${value}_${slot}` : value) + x, problem };
    }
    // A leading dot would make a hidden file.
    if (id.key === 'sku') value = id.value.replace(/[^A-Za-z0-9_.-]/g, '').replace(/^\.+/, '');
    if (!value) return { name: null, problem: NO_ID };
    return { name: (slot ? `${value}-${slot}` : value) + x, problem };
  }

  /* Every photo × marketplace, photos in input order. Two photos that would
   * land on the same name for one marketplace both get flagged. The check
   * ignores case and extension: B0X.MAIN.jpg and b0x.MAIN.png still clash on
   * a case-insensitive disk and in Amazon's uploader. */
  function preview(fileNames, index, marketplaceIds, ext) {
    const mkts = Array.isArray(marketplaceIds) ? marketplaceIds : marketplaceIds ? [marketplaceIds] : [];
    const out = [], seen = new Map();
    for (const e of match(fileNames, index)) {
      const x = extension(ext, e.file);
      for (const m of mkts) {
        const r = name(e, m, ext);
        const item = { file: e.file, marketplace: m, name: r.name, problem: r.problem };
        out.push(item);
        if (!r.name) continue;
        const key = str(m).toLowerCase() + '\u0000' + fold(r.name.slice(0, r.name.length - x.length));
        if (seen.has(key)) seen.get(key).push(item);
        else seen.set(key, [item]);
      }
    }
    for (const list of seen.values()) if (list.length > 1) for (const it of list) it.problem = DUPLICATE;
    return out;
  }

  return { parseCSV, columns, buildIndex, match, name, preview };
});
