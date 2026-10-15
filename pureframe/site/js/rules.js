/* Marketplace presets and the checks that grade an image against them.
 * Pure data + functions; runs in the browser (window.PFRules) and in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MB = 1024 * 1024;
  const JPEG = 'image/jpeg', PNG = 'image/png', GIF = 'image/gif', TIFF = 'image/tiff', WEBP = 'image/webp', BMP = 'image/bmp';

  /* background: 'required' | 'recommended' | 'any'
   * fill: minimum share of the frame the product's longest side should span
   * out: what "Fix" produces (canvas size, product fill, file type) */
  const PRESETS = [
    {
      id: 'amazon', name: 'Amazon', label: 'Amazon main image',
      background: 'required', fill: 0.85, fillRule: 'required',
      minLongest: 500, recLongest: 1000, maxLongest: 10000,
      recNote: 'Zoom needs 1,000 px or more on the longest side; 1,600–2,000 px is the usual advice.',
      aspect: null,
      formats: [JPEG, PNG, TIFF, GIF], maxBytes: 10 * MB, cmyk: true,
      out: { width: 2000, height: 2000, fill: 0.88, type: JPEG, maxBytes: 10 * MB },
      naming: '{name}', amazonNaming: true,
      sources: [{ title: 'Amazon Seller Central: Product image requirements (G1881)', url: 'https://sellercentral.amazon.com/help/hub/reference/external/G1881' }],
      rules: [
        'Pure white background (RGB 255, 255, 255).',
        'The product fills at least 85% of the frame.',
        'At least 500 px on the longest side, and 1,000 px or more so zoom works (1,600–2,000 px is common advice).',
        'JPEG preferred; TIFF, PNG and non-animated GIF are also accepted. sRGB or CMYK.',
        'Only the product being sold: no text, logos, watermarks, borders, colour blocks or props that aren\'t included.',
        'The whole product is in the frame, not cropped.',
        'Bulk uploads use names like B000123456.MAIN.jpg, B000123456.PT01.jpg.',
      ],
    },
    {
      id: 'walmart', name: 'Walmart', label: 'Walmart Marketplace main image',
      background: 'required', fill: 0.85, fillRule: 'recommended',
      minLongest: null, minShortest: 1500, recShortest: 2200, maxLongest: null,
      recNote: '2,200 × 2,200 px is Walmart\'s recommended size.',
      aspect: 1, aspectRule: 'required',
      formats: [JPEG, PNG, BMP], maxBytes: 5 * MB, cmyk: false,
      out: { width: 2200, height: 2200, fill: 0.92, type: JPEG, maxBytes: 5 * MB },
      naming: '{name}',
      sources: [{ title: 'Walmart Marketplace Learn: Image guidelines & requirements', url: 'https://marketplacelearn.walmart.com/guides/Item%20setup/Item%20content%2C%20imagery%2C%20and%20media/Product-detail-page:-Image-guidelines-&-requirements' }],
      rules: [
        'Seamless white background (RGB 255, 255, 255).',
        'Square (1:1), at least 1,500 × 1,500 px for zoom; 2,200 × 2,200 px recommended.',
        'Crop as close to the product as possible (Walmart Canada specifies a 2.5% white border).',
        'JPEG, PNG or BMP, up to 5 MB, RGB colour.',
        'No watermarks, seller names, logos, text overlays, promotional claims or accessories that aren\'t included.',
        'Walmart recommends the 14-digit GTIN in the file name.',
      ],
    },
    {
      id: 'tiktok', name: 'TikTok Shop', label: 'TikTok Shop main image',
      background: 'required', fill: 0.8, fillRule: 'recommended',
      minShortest: 600, recShortest: 1600, maxLongest: 4000,
      recNote: '1,600 × 1,600 px is the recommended size.',
      aspect: 1, aspectRule: 'required',
      formats: [JPEG, PNG], maxBytes: 5 * MB, cmyk: false,
      out: { width: 1600, height: 1600, fill: 0.88, type: JPEG, maxBytes: 5 * MB },
      naming: '{name}',
      sources: [{ title: 'TikTok Shop Academy: Product listing policy', url: 'https://seller-us.tiktok.com/university/essay?knowledge_id=3196690250417921' }],
      rules: [
        'Pure white background, product shown from the front.',
        'Square (1:1), at least 600 × 600 px; 1,600 × 1,600 px recommended.',
        'JPG or PNG, up to 5 MB.',
        'No added logos, text, borders or watermarks.',
      ],
    },
    {
      id: 'ebay', name: 'eBay', label: 'eBay listing photo',
      background: 'recommended', fill: 0.8, fillRule: 'recommended',
      minLongest: 500, recLongest: 1600, maxLongest: null,
      recNote: 'eBay recommends about 1,600 px on the longest side.',
      aspect: 1, aspectRule: 'suggested',
      formats: [JPEG, PNG, GIF, TIFF, BMP, WEBP, 'image/heic', 'image/avif'], maxBytes: 12 * MB, cmyk: false,
      out: { width: 1600, height: 1600, fill: 0.85, type: JPEG, maxBytes: 12 * MB },
      naming: '{name}',
      sources: [{ title: 'eBay: Picture policy', url: 'https://www.ebay.com/help/policies/listing-policies/picture-policy?id=4370' }, { title: 'eBay: Adding pictures to your listings', url: 'https://www.ebay.com/help/selling/listings/adding-pictures-listings?id=4148' }],
      rules: [
        'At least 500 px on the longest side; about 1,600 px recommended.',
        'A white or light neutral background is recommended.',
        'No added borders, text, artwork or watermarks.',
        'Up to 12 MB per photo.',
      ],
    },
    {
      id: 'etsy', name: 'Etsy', label: 'Etsy listing photo',
      background: 'any', fill: null,
      minShortest: 635, recShortest: 2000, maxLongest: null,
      recNote: 'Etsy recommends at least 2,000 px for both width and height.',
      aspect: 4 / 3, aspectRule: 'suggested',
      formats: [JPEG, PNG, GIF, 'image/heic'], maxBytes: null, softMaxBytes: 1 * MB, cmyk: false,
      out: { width: 3000, height: 2250, fill: 0.8, type: JPEG, maxBytes: 1 * MB },
      naming: '{name}',
      sources: [{ title: 'Etsy Help: Image requirements for listings', url: 'https://help.etsy.com/hc/en-us/articles/115015663347' }],
      rules: [
        'At least 2,000 px for both width and height is recommended (635 px minimum to show well in search).',
        'Your first photo sets the shape for the rest. Landscape 4:3 (for example 3,000 × 2,250 px) is a common choice.',
        'One finished product in the first photo: no collages or stitched images.',
        'No transparent PNGs. Files over 1 MB may not finish uploading.',
      ],
    },
    {
      id: 'shopify', name: 'Shopify', label: 'Shopify product image',
      background: 'recommended', fill: 0.8, fillRule: 'recommended',
      minLongest: null, recLongest: 2048, maxLongest: 5000,
      recNote: '2,048 × 2,048 px is Shopify\'s recommended size.',
      aspect: 1, aspectRule: 'suggested',
      formats: [JPEG, PNG, GIF, WEBP, 'image/heic'], maxBytes: 20 * MB, cmyk: false,
      out: { width: 2048, height: 2048, fill: 0.85, type: JPEG, maxBytes: 20 * MB },
      naming: '{name}',
      sources: [{ title: 'Shopify Help Center: Product media types', url: 'https://help.shopify.com/en/manual/products/product-media/product-media-types' }],
      rules: [
        '2,048 × 2,048 px square is the recommended size.',
        'Up to 5,000 × 5,000 px (25 megapixels) and 20 MB.',
        'Keep one aspect ratio and background across the catalog so collection pages line up.',
      ],
    },
    {
      id: 'google', name: 'Google Shopping', label: 'Google Merchant Center image',
      background: 'recommended', fill: 0.75, fillRule: 'recommended',
      minShortest: 100, recShortest: 500, recLongest: 1500, maxLongest: null,
      recNote: 'Google is phasing out images under 500 × 500 px: warnings since April 2026, blocked from 31 January 2027.',
      aspect: null,
      formats: [JPEG, PNG, GIF, WEBP, BMP, TIFF], maxBytes: 16 * MB, cmyk: false,
      out: { width: 1500, height: 1500, fill: 0.85, type: JPEG, maxBytes: 16 * MB },
      naming: '{name}',
      sources: [{ title: 'Google Merchant Center: Image link [image_link]', url: 'https://support.google.com/merchants/answer/6324350' }, { title: 'Google Merchant Center: 2026 product data specification update', url: 'https://support.google.com/merchants/answer/16989427' }],
      rules: [
        'Images under 500 × 500 px get warnings now and are blocked from 31 January 2027. 1,500 px or more recommended.',
        'The product should take up 75–90% of the image.',
        'No promotional text, calls to action, watermarks or borders.',
        'Avoid dark or distracting backgrounds; white works well.',
        'Up to 16 MB, and the file extension must match the format.',
      ],
    },
  ];

  const ORDER = { pass: 0, info: 0, warn: 1, fail: 2 };
  const AMAZON_NAME = /^[A-Za-z0-9]+\.(MAIN|PT0[1-8]|SWCH)\.[a-z]+$/i;

  const pct = (v) => `${Math.round(v * 100)}%`;
  const px = (n) => `${n.toLocaleString('en-US')} px`;
  const fmtBytes = (b) => (b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const typeName = (t) => (t || 'unknown').replace('image/', '').toUpperCase();

  function ratioName(r) {
    const known = [[1, '1:1'], [4 / 3, '4:3'], [3 / 4, '3:4'], [3 / 2, '3:2'], [16 / 9, '16:9'], [5 / 4, '5:4']];
    for (const [v, n] of known) if (Math.abs(r - v) < 0.01) return n;
    return r.toFixed(2) + ':1';
  }

  /* a: PFEngine.analyze() result (may be measured on a downscaled copy)
   * file: { name, type, size, width, height, jpeg } of the original file */
  function evaluate(a, file, preset) {
    const checks = [];
    const add = (id, status, label, detail) => checks.push({ id, status, label, detail });
    const W = file.width, H = file.height, longest = Math.max(W, H), shortest = Math.min(W, H);

    // Background
    const bg = a.background, busy = a.uniformity < 0.6;
    const severity = preset.background === 'required' ? 'fail' : preset.background === 'recommended' ? 'warn' : 'info';
    if (busy) {
      add('background', severity, 'Busy background',
        'The edges aren\'t a plain backdrop, which suggests a lifestyle or cluttered shot. Main images need the product on plain white.');
    } else if (bg.pure >= 0.97) {
      add('background', 'pass', 'Pure white background', `${pct(bg.pure)} of the background is exactly #FFFFFF.`);
    } else if (bg.near >= 0.97) {
      add('background', preset.background === 'any' ? 'info' : 'warn', 'Almost white background',
        `It looks white, but only ${pct(bg.pure)} is exactly #FFFFFF. Automated checks can still reject off-white.`);
    } else {
      const m = bg.mean || a.backdrop;
      add('background', severity, 'Background isn\'t white',
        `The backdrop averages rgb(${m.join(', ')}). ${preset.background === 'required' ? `${preset.name} requires pure white (255, 255, 255).` : 'A white background is recommended.'}`);
    }

    // Product fill
    if (!a.fill) {
      add('fill', 'fail', 'No product found', 'Couldn\'t find anything that stands out from the background.');
    } else if (preset.fill) {
      const f = a.fill.longest;
      if (f >= preset.fill) add('fill', 'pass', 'Product fills the frame', `The product spans ${pct(f)} of the frame (target ${pct(preset.fill)}+).`);
      else {
        const status = preset.fillRule === 'required' && f < preset.fill - 0.1 ? 'fail' : 'warn';
        add('fill', status, 'Too much empty space', `The product spans only ${pct(f)} of the frame. ${preset.name} wants ${pct(preset.fill)} or more.`);
      }
    } else {
      add('fill', 'info', 'Product size in frame', `The product spans ${pct(a.fill.longest)} of the frame.`);
    }

    // Framing
    if (a.touches) {
      const edges = Object.keys(a.touches).filter((k) => a.touches[k]);
      if (edges.length && !busy) {
        add('framing', 'warn', 'Product touches the edge',
          `It reaches the ${edges.join(' and ')} edge${edges.length > 1 ? 's' : ''}, so it may look cropped. Leave a small margin.`);
      }
    }

    // Dimensions
    const dims = `${W.toLocaleString('en-US')} × ${H.toLocaleString('en-US')} px`;
    if (preset.minLongest && longest < preset.minLongest) {
      add('size', 'fail', 'Image too small', `${dims}. ${preset.name} needs at least ${px(preset.minLongest)} on the longest side.`);
    } else if (preset.minShortest && shortest < preset.minShortest) {
      add('size', 'fail', 'Image too small', `${dims}. ${preset.name} needs at least ${px(preset.minShortest)} on every side.`);
    } else if (preset.maxLongest && longest > preset.maxLongest) {
      add('size', 'fail', 'Image too large', `${dims}. ${preset.name} allows up to ${px(preset.maxLongest)}.`);
    } else if ((preset.recShortest && shortest < preset.recShortest) || (preset.recLongest && longest < preset.recLongest)) {
      add('size', 'warn', 'Below recommended size', `${dims}. ${preset.recNote || ''}`.trim());
    } else {
      add('size', 'pass', 'Good resolution', dims + '.');
    }

    // Aspect ratio
    if (preset.aspect) {
      const r = W / H, want = ratioName(preset.aspect);
      const verb = { required: 'requires', recommended: 'recommends', suggested: 'commonly uses' }[preset.aspectRule || 'recommended'];
      if (Math.abs(r - preset.aspect) / preset.aspect <= 0.01) add('aspect', 'pass', `${want} aspect ratio`, `Matches the shape ${preset.name} ${verb}.`);
      else add('aspect', { required: 'fail', recommended: 'warn', suggested: 'info' }[preset.aspectRule || 'recommended'],
        `Not ${want}`, `This image is ${ratioName(r)}. ${preset.name} ${verb} ${want}.`);
    }

    // File format and size
    if (file.type && !preset.formats.includes(file.type)) {
      add('format', 'fail', `${typeName(file.type)} not accepted`, `${preset.name} accepts ${preset.formats.map(typeName).join(', ')}.`);
    } else if (file.type) {
      add('format', 'pass', `${typeName(file.type)} format`, 'Accepted file type.');
    }
    if (preset.maxBytes && file.size > preset.maxBytes) {
      add('filesize', 'fail', 'File too big', `${fmtBytes(file.size)}. The limit is ${fmtBytes(preset.maxBytes)}.`);
    } else if (preset.softMaxBytes && file.size > preset.softMaxBytes) {
      add('filesize', 'warn', 'Large file', `${fmtBytes(file.size)}. Files over ${fmtBytes(preset.softMaxBytes)} may not finish uploading to ${preset.name}.`);
    }
    if (preset.amazonNaming && file.name && !AMAZON_NAME.test(file.name)) {
      add('naming', 'info', 'File name', 'For bulk uploads, name files like B000123456.MAIN.jpg (ASIN, UPC or SKU, then MAIN or PT01–PT08).');
    }

    // Colour
    if (file.jpeg && file.jpeg.components === 4) {
      add('color', preset.cmyk ? 'warn' : 'fail', 'CMYK colour',
        'This JPEG is CMYK. Convert it to sRGB so colours look right on screens.');
    }
    if (a.transparent) {
      add('transparency', preset.background === 'any' ? 'info' : 'warn', 'Transparent background',
        'Marketplaces render transparency unpredictably. Flatten it onto white.');
    }

    let status = 'pass';
    for (const c of checks) if (ORDER[c.status] > ORDER[status]) status = c.status;
    return { status, checks };
  }

  function preset(id) {
    return PRESETS.find((p) => p.id === id) || PRESETS[0];
  }

  // Applies a naming template like "{name}.MAIN" or "{sku}-{n}".
  function fileName(template, { name, index, preset: pid, width, height }, ext) {
    template = template || '{name}';
    // "B0C1234567.MAIN" + "{name}.MAIN" should stay B0C1234567.MAIN, not .MAIN.MAIN
    if (/\.(MAIN|PT|SWCH)/i.test(template)) name = name.replace(/\.(MAIN|PT0[1-8]|SWCH)$/i, '');
    const base = template
      .replace(/\{name\}/g, name)
      .replace(/\{n\}/g, String(index))
      .replace(/\{nn\}/g, String(index).padStart(2, '0'))
      .replace(/\{preset\}/g, pid)
      .replace(/\{size\}/g, `${width}x${height}`);
    return base.replace(/[\\/:*?"<>|]+/g, '-').trim() + ext;
  }

  return { PRESETS, preset, evaluate, fileName, fmtBytes, MB };
});
