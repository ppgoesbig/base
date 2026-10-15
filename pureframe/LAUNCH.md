# PureFrame launch playbook

PureFrame is a free product photo checker for marketplace sellers, plus a paid
offline **Pro** version. It checks every photo against 7 marketplaces at once,
fixes what fails (including busy backgrounds, with on-device AI), and re-checks
the saved file so the proof holds after compression. The free site attracts
sellers through search ("amazon image requirements", "white background
checker"...). Pro sells for a one-time $39 on Gumroad.

There is no server, database or monthly bill. GitHub Pages hosts the site for
free, Gumroad handles payments and delivery, and every image is processed in
the visitor's own browser.

Setup takes about 30–45 minutes, once.

---

## 1. Create the Pro product on Gumroad (10 min)

1. Sign up at <https://gumroad.com> and connect your payout method.
2. **New product → Digital product**:
   - **Name:** `PureFrame Pro: Prove Your Product Photos Pass`
   - **Price:** `$39`
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
$0.50 per direct sale, about $34.60 kept from each $39 sale; 30% on sales that
come through Gumroad's Discover marketplace. Lemon Squeezy (also merchant of
record) and Payhip work the same way; just upload the same ZIP.

## 2. Point the site at your product (2 min)

Edit `pureframe/site/js/config.js`:

```js
proUrl: 'https://yourname.gumroad.com/l/pureframe-pro',  // your real link
price: '$39',
```

If you change the price, also update the `"price": "39"` offer in the JSON-LD
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
   page views plus the events `add-photos`, `fix`, `fix-ai`, `download`,
   `audit-csv` and `upsell-limit` / `upsell-zip` / `upsell-settings`, so you
   can see the funnel. It's cookie-free, so no consent banner is needed. The
   Pro app never loads analytics.

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
  Hunt day. Set it to expire at the end of that day in Gumroad, so "today
  only" stays true.

### Pricing ideas once sales come in

- Raise to $49 after the first 10–20 reviews.
- Add a **Team** variant at $149 (Gumroad *versions*) for agencies and
  virtual-assistant teams: the same app, licensed for up to 5 people. The
  standard licence already covers one person's client work.
- Updates: every buyer can re-download the latest file from Gumroad, so rule
  updates reach everyone. The site promises free updates for at least 12
  months. If you build a much bigger version later, sell it as a new product
  (PureFrame Pro 2) with an upgrade discount.
- Bundle: "Pro + 10-minute product photo lighting guide" if you want to sell
  your expertise.

### Realistic expectations

This is a real product in a real niche, not a guarantee. A small tool like
this typically converts 1–3% of active users to paid. For illustration only:
2,000 monthly tool users × 2% × $39 ≈ **$1,560/month**. Getting to 2,000
users usually takes months of search growth and some of the pushes above.
Expect a slow start. The cost of running it stays at $0 (or about $10/year
with a domain), so time works in your favor.

## 6. Gumroad product description

> **Prove your product photos pass before the marketplace checks them.**
>
> PureFrame Pro checks, fixes and verifies product photos for **Amazon,
> Walmart, TikTok Shop, eBay, Etsy, Shopify and Google Shopping**, on your own
> computer.
>
> - **Every marketplace at once.** Each photo shows a verdict for all 7. One
>   click turns your batch into correctly sized files for every marketplace
>   you pick, in a folder per marketplace (ZIP, or saved straight to a folder
>   in Chrome and Edge).
> - **Any background.** Studio backdrops become exact #FFFFFF with natural
>   shadows and white products kept detailed. Phone photos on tables, desks
>   or floors are cut out by AI that runs on your device.
> - **Proof after compression.** PureFrame opens the file it saved and
>   measures every background pixel more than 8 px from the product. Where a
>   white background is required or recommended, it raises the quality or
>   saves a PNG until the numbers are clean.
> - **Evidence report.** You get a CSV and a printable page with the measured
>   values for every file: useful for clients, VAs and your own records.
> - **Names from your spreadsheet.** `ASIN.MAIN.jpg`, `ASIN.PT01.jpg`... for
>   Amazon, GTINs for Walmart, SKUs everywhere else.
> - **Private and offline.** No uploads, no account, no subscription.
>
> One-time payment, 12 months of rule updates included, 30-day money-back
> guarantee. Try the free version first: **[your site URL]**
>
> *Measurements are against each marketplace's published rules. Content rules
> (no text, logos or props) still need your eye.*

## Positioning: what makes PureFrame different

Research in October 2026 found real competitors, so lead with what they don't
combine:

- **Free browser tools** check and export for several marketplaces, some
  with AI cutouts.
- **Desktop tools** sell a similar audit-and-export workflow for about $30–50
  one-time.
- **Cloud tools** charge monthly and upload your photos.

None we found re-checks the *saved* file after compression, covers Google
Shopping's 2027 size rule, and names files from a product spreadsheet, all
on-device. Lead with **"proof, not promises"**. If the "built by a product
photographer" story is true for you, use it: it's the one thing a clone
can't copy.

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
