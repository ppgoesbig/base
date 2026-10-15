# Ready-to-paste launch posts

Create the `LAUNCH10` discount code in Gumroad before posting. Replace `SITE` with your live URL (e.g. `https://ppgoesbig.github.io/base/` or
your own domain) and `GUMROAD` with your Pro product link. Post as yourself,
answer comments, and follow each community's self-promotion rules.

---

## Product Hunt

**Name:** PureFrame

**Tagline (60 chars max):** Prove your product photos pass every marketplace check

**Description:**
> See how every product photo scores against Amazon, Walmart, TikTok Shop,
> eBay, Etsy, Shopify and Google Shopping at once. Fix what fails, including
> busy backgrounds, with AI that runs on your device. PureFrame then re-checks
> the saved file, so the background is still exactly #FFFFFF after JPEG
> compression. Nothing is uploaded. Free checks; Pro ($39 once) exports
> every photo for every marketplace, with spreadsheet naming and an evidence
> report.

**First comment (maker):**
> Hi Product Hunt! Main images get flagged for things you can't see: a
> "white" backdrop that's really RGB 240, a product filling 70% of the
> frame, or JPEG compression turning pixels next to the product 252 instead
> of 255.
>
> PureFrame measures what the marketplaces measure, fixes it, then opens the
> file it saved and measures again. You get the numbers, not a promise. The
> AI cutout, the checks and the exports all run in your browser, so
> unreleased products stay private.
>
> Checking is free. Today only, code `LAUNCH10` takes $10 off Pro. I'd love
> feedback from anyone selling on several marketplaces at once.

**Topics:** E-Commerce, Photography, Design Tools, Productivity

---

## Hacker News (Show HN)

**Title:** Show HN: PureFrame – proves product photos pass marketplace image checks, in-browser

**Text:**
> Amazon, Walmart and TikTok Shop want main images on exactly #FFFFFF with
> the product filling the frame. Studio "white" usually photographs at
> 230–250, and JPEG compression can push pixels next to the product to
> 249–254 even after you fix it. PureFrame checks, fixes and then proves it,
> client-side:
>
> - **Studio shots:** it fits a quadratic lighting surface to the border,
>   flood-fills the connected backdrop, and caps the exposure lift by the
>   product's 99.5th-percentile highlight so white products don't clip. Soft
>   shadow tails are ramped into the white.
> - **Busy backgrounds:** it runs U-2-Netp through ONNX Runtime Web (WASM),
>   then guided-filters the 320 px mask against the photo at up to 1280 px,
>   and decontaminates edge colours using a local estimate of the old
>   background.
> - **Proof:** it encodes the JPEG, decodes it again, and checks every
>   background pixel more than 8 px from the product. Where a white
>   background is required or recommended, it steps the quality up (and
>   falls back to PNG) until they're all 255. An independent numpy check of the exports agrees.
> - **Packaging:** no framework or build step for the app. The paid version
>   is the same code plus the model, shipped as files that run from file://.
>
> Free to use: SITE

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
> If you'd rather not do it by hand, I made a free browser tool that checks a
> photo against every marketplace at once and fixes the background and
> framing (even on busy backgrounds): SITE. Nothing is uploaded.

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
> - Pro is an offline app sold on Gumroad for $39, with the AI model bundled.
> - SEO pages for each marketplace's image rules bring in the traffic.
>
> I'll share the numbers as they come in. SITE
