# PureFrame

Checks product photos against marketplace image rules (Amazon, Walmart, TikTok
Shop, eBay, Etsy, Shopify, Google Shopping) and fixes them in one click: pure
`#FFFFFF` background, product filling the frame, the right size, format and
colour. Everything runs in the browser; photos are never uploaded.

- **Free edition:** the public website. It has unlimited checks, 3 auto-fixes
  per visit, and single downloads.
- **Pro edition:** a single offline HTML file sold on Gumroad. It has
  unlimited fixes, ZIP export, bulk renaming and custom output settings.

**To go live and start selling, follow [LAUNCH.md](LAUNCH.md).**

## Layout

```
site/                   the website source (what GitHub Pages serves, after the build)
  index.html            landing page + tool. Blocks between <!-- free:start/end --> are
                        marketing and are stripped from the Pro build
  js/engine.js          pixel work: backdrop model, analysis, whitening, layout, resampling
  js/rules.js           marketplace presets (official rules + sources) and the grader
  js/zip.js             tiny ZIP writer for batch downloads
  js/app.js             UI: intake, check/fix pipeline, re-verification, free/Pro gating
  js/config.js          Gumroad link, price, free limit, analytics. Edit before launch
  css/styles.css
  og.png                social preview image
scripts/build.mjs       builds dist/site (guide page per preset, cheat sheet, articles, sitemap, robots)
                        and dist/PureFrame-Pro.zip
content/                how-to articles (HTML fragments with a <!--meta {...} --> header)
test/                   node:test unit tests, including a build + link check
marketing/              Gumroad cover, thumbnail, screenshots and launch-posts.md
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
6. **Export and verify.** JPEG quality steps down until the file fits the
   marketplace limit. The exported file is then decoded and graded again, which
   produces the "after" report.

## Develop

```sh
node --test pureframe/test/*.test.js
node pureframe/scripts/build.mjs        # SITE_URL=https://your.domain to set canonical URLs
npx serve pureframe/dist/site
```

To update marketplace rules, edit `PRESETS` in `site/js/rules.js`. The guide
pages, the in-app rules box and the checks all read from it.
