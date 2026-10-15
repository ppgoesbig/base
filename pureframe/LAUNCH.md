# PureFrame launch playbook

PureFrame is a free product photo checker for marketplace sellers, plus a paid
offline **Pro** version. The free site attracts sellers through search ("amazon
image requirements", "white background checker"...). Pro sells for a one-time
$29 on Gumroad.

There is no server, database or monthly bill. GitHub Pages hosts the site for
free, Gumroad handles payments and delivery, and every image is processed in
the visitor's own browser.

Setup takes about 30–45 minutes, once.

---

## 1. Create the Pro product on Gumroad (10 min)

1. Sign up at <https://gumroad.com> and connect your payout method.
2. **New product → Digital product**:
   - **Name:** `PureFrame Pro: Marketplace Product Photo Fixer`
   - **Price:** `$29`
   - **Custom URL:** `pureframe-pro`
3. **Content:** upload `PureFrame-Pro.zip`. To rebuild it, run
   `node pureframe/scripts/build.mjs`; it lands in `pureframe/dist/`.
4. **Cover:** `pureframe/marketing/gumroad-cover.png`, then
   `screenshot-pro.png` as a second image.
5. **Thumbnail:** `pureframe/marketing/gumroad-thumb.png`.
6. **Description:** paste the copy in [section 6](#6-gumroad-product-description).
7. **Refund policy:** 30 days. The site promises a 30-day money-back
   guarantee, so honor it.
8. Publish, then copy the product URL, e.g. `https://yourname.gumroad.com/l/pureframe-pro`.

Gumroad has been merchant of record since January 2025, so it collects and
remits sales tax / VAT for you. You still report payouts as income. Fees: 10% +
$0.50 per direct sale, about $25.60 kept from each $29 sale; 30% on sales that
come through Gumroad's Discover marketplace. Lemon Squeezy (also merchant of
record) and Payhip work the same way; just upload the same ZIP.

## 2. Point the site at your product (2 min)

Edit `pureframe/site/js/config.js`:

```js
proUrl: 'https://yourname.gumroad.com/l/pureframe-pro',  // your real link
price: '$29',
```

If you change the price, also update the `"price": "29"` offer in the JSON-LD
block of `pureframe/site/index.html`.

Commit and push.

## 3. Put the site online with GitHub Pages (5 min)

1. Merge this branch into the repo's default branch
   (`claude/macos-netspeed-menubar`).
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The **PureFrame** workflow tests, builds and deploys on every push to the
   default branch. The site goes live at **<https://ppgoesbig.github.io/base/>**.
   Use **Actions → PureFrame → Run workflow** to deploy right away.

**Custom domain (recommended, about $10/year).** A name like
`pureframe.app` ranks and converts better than a github.io path. Buy one,
then add it under **Settings → Pages → Custom domain**. Canonical links and
the sitemap pick up the new address automatically.

**About the public repo.** The repo is public, so the Pro source is visible
to anyone who goes looking. Buyers pay for convenience, so this rarely
matters. If you'd rather keep it private, make the repo private and host the
site on Cloudflare Pages, which is free for private repos:

- Build command: `node pureframe/scripts/build.mjs`
- Output directory: `pureframe/dist/site`
- Environment variable: `SITE_URL=https://your-domain`

GitHub Pages on a private repo needs a paid GitHub plan.

## 4. Get indexed (10 min)

1. **Google Search Console** (<https://search.google.com/search-console>):
   add the site, verify it, then **Sitemaps → submit `sitemap.xml`**.
2. **Bing Webmaster Tools:** import from Search Console in one click. It also
   feeds DuckDuckGo and ChatGPT search.
3. **Optional analytics:** create a free <https://www.goatcounter.com> site
   and put its code in `config.js` (`goatcounter: 'yourcode'`). It records
   page views plus `fix`, `zip`, `download` and `upsell-*` events, so you can
   see the funnel. It's cookie-free, so no consent banner is needed.

## 5. Get the first visitors (one-time pushes that compound)

The guide pages under `/guides/` target high-intent searches:

- 7 marketplace requirement pages ("Walmart image requirements", "Etsy photo
  size"...)
- a cross-marketplace cheat sheet that other sites can link to
- how-to articles on pure white backgrounds and rejected Amazon images

SEO takes 2–6 months to build. Ready-to-paste posts for Product Hunt, Hacker
News, Reddit, short videos and Pinterest are in
[`marketing/launch-posts.md`](marketing/launch-posts.md). To get sales sooner:

- **Show, don't tell.** Record 15-second before/after screen captures ("Amazon
  rejected my main image → fixed in one click") for TikTok, YouTube Shorts,
  Instagram Reels and Pinterest. Use **your own** photos, never employer or
  client images without permission.
- **Help in seller communities.** Answer "why was my image rejected"
  questions in r/AmazonSeller, r/FulfillmentByAmazon, r/EtsySellers,
  r/ecommerce, r/shopify and Facebook seller groups. Link the free checker
  where it genuinely helps. Read each community's self-promotion rules first.
- **Launch posts:** Product Hunt, Indie Hackers, Hacker News "Show HN"
  ("Show HN: A marketplace photo checker that runs entirely in your
  browser"), BetaList, SaaSHub, AlternativeTo (list it as an alternative to
  remove.bg, Photoroom and Pixc).
- **Date hook:** Google starts **blocking product images under 500 × 500 px
  on 31 January 2027**. In December and January, post "Will Google
  disapprove your product images?" content that links to the Google guide.
- **Gumroad Discover:** pick the *Software / Design* category and tag
  `amazon seller`, `product photography`, `ecommerce`, `white background`.
- **Launch discount:** a Gumroad code like `LAUNCH10` ($10 off) for Product
  Hunt day.

### Pricing ideas once sales come in

- Raise to $39 after the first 10–20 reviews.
- Add an **Agency** variant at $79 (Gumroad *versions*) for studios that
  edit for clients.
- Bundle: "Pro + 10-minute product photo lighting guide" if you want to sell
  your expertise.

### Realistic expectations

This is a real product in a real niche, not a guarantee. A small tool like
this typically converts 1–3% of active users to paid. For illustration only:
2,000 monthly tool users × 2% × $29 ≈ **$1,160/month**. Getting to 2,000
users usually takes months of search growth and some of the pushes above.
Expect a slow start. The cost of running it stays at $0 (or about $10/year
with a domain), so time works in your favor.

## 6. Gumroad product description

> **Stop getting product photos rejected.**
>
> PureFrame Pro checks and fixes your product photos for **Amazon, Walmart,
> TikTok Shop, eBay, Etsy, Shopify and Google Shopping** in one click:
>
> - **Pure #FFFFFF background.** Grey and off-white studio backdrops become
>   exact white, with soft shadows kept natural and white products kept
>   detailed.
> - **Perfect framing.** The product is recentred and scaled to fill 85%+
>   of the frame.
> - **Right size and format.** Exports at each marketplace's recommended size
>   (2000 × 2000 for Amazon, 2200 × 2200 for Walmart...) as sRGB JPEG under
>   the file-size limit.
> - **Verified.** Every exported photo is re-checked against the rules, so
>   you know it passes before you upload.
> - **Whole folders at once,** downloaded as one ZIP.
> - **Bulk rename** for upload: `B0C1234567.MAIN.jpg`, `.PT01`...
> - **Private and offline.** It's a single app file that runs in your browser
>   on Mac, Windows or Linux. Your photos never leave your computer.
>
> One-time payment, free updates when marketplace rules change, 30-day
> money-back guarantee.
>
> Try the free version first: **[your site URL]**
>
> *Works best with studio shots on a plain backdrop. For busy or lifestyle
> backgrounds, remove the background first, then run the photo through
> PureFrame.*

## 7. Keeping it running (about 1 hour per quarter)

- **Rules change.** Every few months, skim the official pages linked from each
  guide. Update numbers and wording in `pureframe/site/js/rules.js` (the
  `PRESETS` list) and bump `REVIEWED` in `pureframe/scripts/build.mjs`. Push,
  and the site updates itself.
- **Ship the update to buyers.** Run `node pureframe/scripts/build.mjs`, then
  replace the file on Gumroad with the new `pureframe/dist/PureFrame-Pro.zip`.
  Buyers always download the latest file from their Gumroad library. Use
  Gumroad's email feature to let them know an update is out.
- **Support** arrives as replies to Gumroad receipts. Refund quickly and
  politely; it keeps your Gumroad standing healthy.
- **Day job check.** If you work in product photography or e-commerce, read
  your employment agreement for side-business and IP clauses before you
  launch, and build marketing images from your own photos.

## Development

```sh
node --test pureframe/test/*.test.js       # unit tests (engine, rules, zip)
node pureframe/scripts/build.mjs           # builds dist/site and dist/PureFrame-Pro.zip
npx serve pureframe/dist/site              # preview the site locally
```

See `pureframe/README.md` for how the code is organized.
