# Ready-to-paste launch posts

Create the `LAUNCH10` discount code in Gumroad before posting. Replace `SITE` with your live URL (e.g. `https://ppgoesbig.github.io/base/` or
your own domain) and `GUMROAD` with your Pro product link. Post as yourself,
answer comments, and follow each community's self-promotion rules.

---

## Product Hunt

**Name:** PureFrame

**Tagline (60 chars max):** Product photos that pass Amazon's image check, in 1 click

**Description:**
> Check product photos against Amazon, Walmart, TikTok Shop, eBay, Etsy,
> Shopify and Google Shopping image rules, then fix them in one click: pure
> #FFFFFF background, product filling 85%+ of the frame, right size and format.
> Everything runs in your browser, so photos are never uploaded. Free checks;
> Pro ($29 once) fixes whole folders, exports a ZIP and renames files for bulk
> upload.

**First comment (maker):**
> Hi Product Hunt! I built PureFrame after watching main images get flagged
> over things you can't see: a "white" backdrop that's really RGB 240, or a
> product filling 70% of the frame instead of 85%.
>
> PureFrame measures exactly what the marketplaces measure and fixes it in one
> click. It keeps soft shadows natural and doesn't blow out white products.
> Each export is re-checked before you download it. It all runs locally in
> your browser, so it's fast and private.
>
> Checking is free forever. Today only, code `LAUNCH10` takes $10 off Pro.
> I'd love feedback, especially from anyone selling on Walmart or TikTok Shop.

**Topics:** E-Commerce, Photography, Design Tools, Productivity

---

## Hacker News (Show HN)

**Title:** Show HN: PureFrame – checks and fixes marketplace product photos in the browser

**Text:**
> Amazon, Walmart and TikTok Shop reject main images whose background isn't
> exactly #FFFFFF or where the product fills too little of the frame. Studio
> "white" usually photographs at 230–250, so this trips up a lot of small
> sellers.
>
> PureFrame does the checks and the fix client-side, in a second or two
> per photo:
>
> - It fits a quadratic lighting surface to the border to model the backdrop,
>   so vignettes and sweep falloff aren't mistaken for product.
> - It flood-fills the connected backdrop. Interiors are never touched, so a
>   white plate keeps its tone.
> - It white-balances from the backdrop, with exposure capped by the
>   product's 99.5th-percentile highlight.
> - Shadow tails are grown with an edge-aware fill and ramped to white, so
>   they don't end in a hard edge.
> - It crops and scales to the fill target with an antialiased resampler,
>   then decodes the exported JPEG and grades it again.
>
> No dependencies or build step. The ZIP writer is about 100 lines. Free to
> use: SITE

---

## Reddit (helpful answer template)

Use this when someone asks why their main image was rejected, in
r/AmazonSeller, r/FulfillmentByAmazon, r/EtsySellers, r/ecommerce or
r/shopify. Answer the question first; the link is optional.

> Nine times out of ten it's the background. Amazon wants exactly RGB 255,
> 255, 255, and a white sweep usually photographs around 235–250. It looks
> white but fails the check. Hover the backdrop in Photoshop's Info panel
> (corners especially), or add a Threshold layer at 254: anything not pure
> white turns black.
>
> The other usual suspects: the product filling less than 85% of the frame,
> under 1,000 px on the long side (no zoom), and any text, badges or props.
>
> If you'd rather not do it by hand, I made a free browser tool that checks
> all of this and fixes the background and framing: SITE. Nothing is
> uploaded.

---

## Short video script (TikTok / Reels / YouTube Shorts, 15–20 s)

1. **0–2 s:** a screenshot of a flagged listing or an Amazon email about the
   main image. Text overlay: *"Amazon flagged my main image 😩"*
2. **2–6 s:** drop the photo into PureFrame; the red checks appear.
   Overlay: *"Background: rgb(236,236,236) ✕ · Fill: 61% ✕"*
3. **6–10 s:** click **Fix**; cut to the after image with green checks.
   Overlay: *"Pure #FFFFFF ✓ · 88% fill ✓ · 2000×2000 ✓"*
4. **10–15 s:** before/after side by side. Overlay: *"Free, in your browser.
   Link in bio."*

Caption: `Why "white" backgrounds fail Amazon's check (and the 1-click fix)
#amazonseller #productphotography #ecommerce #amazonfba #etsyseller`

Use your own product photos for the demo.

---

## Pinterest (one pin per guide)

**Title:** Amazon Image Requirements 2026: Size, Background & Checklist
**Description:** Every rule for your Amazon main image in one place: pure white
RGB 255 background, 85% frame fill, 1,000 px+ for zoom, and what gets
listings flagged. Free checker included.
**Link:** SITE/guides/amazon-image-requirements.html
**Image:** `pureframe/marketing/gumroad-cover.png`, or a tall 1000×1500
version of it.

Repeat for Walmart, Etsy, eBay, Shopify, TikTok Shop, Google Shopping and the
cheat sheet (`SITE/guides/image-size-cheat-sheet.html`).

---

## Indie Hackers / X thread starter

> I built a tiny product with $0 running costs: PureFrame, a product photo
> checker for Amazon, Walmart and Etsy sellers.
>
> - Free tool on GitHub Pages; all processing happens in the browser.
> - Pro is a single offline HTML file sold on Gumroad for $29.
> - SEO pages for each marketplace's image rules bring in the traffic.
>
> I'll share the numbers as they come in. SITE
