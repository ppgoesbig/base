# PureFrame

Checks product photos against marketplace image rules (Amazon, Walmart, TikTok
Shop, eBay, Etsy, Shopify, Google Shopping) all at once, fixes them, and proves
the saved file passes: pure `#FFFFFF` background (still exact after JPEG
compression), product filling the frame, the right size, format and colour.
Busy backgrounds are cut out with on-device AI. Everything runs in the browser;
photos are never uploaded.

- **Free edition:** the public website. It has unlimited checks against every
  marketplace, 3 fixes per day (AI included) and single downloads.
- **Pro edition:** an offline app (HTML plus an AI assets file) sold on
  Gumroad. It has unlimited fixes, every photo for every marketplace in one
  export (ZIP or straight to a folder), evidence reports, spreadsheet naming
  and custom output settings.

**To go live and start selling, follow [LAUNCH.md](LAUNCH.md).**

## Layout

```
site/                   the website source (what GitHub Pages serves, after the build)
  index.html            landing page + tool. Blocks between <!-- free:start/end --> are
                        marketing and are stripped from the Pro build
  js/engine.js          pixel work: backdrop model, analysis, whitening, layout, resampling
  js/rules.js           marketplace presets (official rules + sources) and the grader
  js/zip.js             tiny ZIP writer for batch downloads (optional deflate for the build)
  js/matte.js           AI cut-out maths: guided-filter refinement, decontamination, shadow
  js/cutout.js          loads ONNX Runtime Web + U-2-Netp lazily and runs the model
  js/proof.js           compression-proof background check, evidence CSV / HTML report
  js/catalog.js         product-spreadsheet parsing and per-marketplace file naming
  js/app.js             UI: intake, check/fix pipeline, re-verification, free/Pro gating
  js/config.js          Gumroad link, price, free limit, analytics. Edit before launch
  css/styles.css
  og.png                social preview image
scripts/build.mjs       builds dist/site (guide page per preset, cheat sheet, articles, sitemap, robots)
                        and dist/PureFrame-Pro.zip
content/                how-to articles (HTML fragments with a <!--meta {...} --> header)
test/                   node:test unit tests, including a build + link check
marketing/              Gumroad cover, thumbnail, screenshots and launch-posts.md
vendor/                 ONNX Runtime Web (MIT) and the U-2-Netp model (Apache-2.0), with notices
```

## How the fix works

1. **Backdrop model.** A per-channel median of the border, plus a quadratic
   lighting surface fitted to it, so sweeps and vignettes are followed instead
   of being mistaken for product. A busy border (lifestyle shot) is detected and
   left alone.
2. **Backdrop mask.** A scanline flood fill from the border through
   backdrop-like pixels. Enclosed areas, such as a white plate's centre, are
   never touched.
3. **Colour and exposure.** White balance comes from the backdrop. Exposure is
   lifted toward its white point, but capped so the product's own highlights
   never clip.
4. **Shadows.** Soft shadows ramp smoothly into the white instead of ending in
   a hard edge. Product edges are feathered over 2 px.
5. **Framing.** The product is cropped and scaled to the preset's fill
   (e.g. 88%), centred on the output canvas and resampled with an antialiased
   filter.
6. **Export and verify.** The saved bytes are decoded and graded again, which
   produces the "after" report. Wherever a white background is required or recommended, every
   background pixel more than 8 px from the product must be exactly #FFFFFF in
   the decoded file. JPEG quality steps up, then PNG is tried, until that
   holds within the size limit.

**AI cut-out** (busy backgrounds): U-2-Netp gives a 320 px saliency mask. A
guided filter at ≤1280 px snaps it to real edges, small blobs are dropped, and
edge colours are decontaminated against a local estimate of the old
background. An optional soft ground shadow is added. Routing between the
backdrop cleanup and the AI uses border uniformity, border texture
(roughness) and whether the backdrop separated at all.

## Develop

```sh
node --test pureframe/test/*.test.js
node pureframe/scripts/build.mjs        # SITE_URL=https://your.domain to set canonical URLs
npx serve pureframe/dist/site
```

To update marketplace rules, edit `PRESETS` in `site/js/rules.js`. The guide
pages, the in-app rules box and the checks all read from it.
