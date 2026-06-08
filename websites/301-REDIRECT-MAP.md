# 301 Redirect Map — Squarespace → new static sites (DRAFT)

**Status:** read-only prep for task #7 (sites + Stripe + cutover). Built by JS Dev Ops, 2026-05-31. **Nothing here is deployed.** No DNS cutover without Ray's go.

## Why this exists
Ray's **Google Search Ads point at live Squarespace paths** on `obxlotsolutions.com`. If we cut over without redirects, those ad-landing URLs 404 and burn ad spend. Safe sequence:

1. Stand up the new static site (Cloudflare Pages / Netlify), domain still on Squarespace.
2. Stage these **301 redirects** on the new host (`_redirects` file).
3. **Verify** every current ad Final URL maps to a live new page (301 → 200, no chains/loops).
4. **Then** switch DNS, retire Squarespace. No window where ads 404.

301 (permanent) preserves SEO authority and ad quality score; use 301, not 302.

---

## ⚠️ The one input only Ray can supply (authoritative)
The **exact** current Squarespace slugs aren't in the repo — they live in Ray's accounts. The old-path column below is **assumed from Squarespace conventions + the known product set** and must be confirmed. Two-minute pull:

- **Google Ads** → Campaigns → **Landing pages** report (or Ads → customize columns → **Final URL** + **Final mobile URL**). Export every URL receiving spend — those are the must-not-404 rows.
- **Squarespace** → Pages panel + Selling → Products: copy each page/product **URL slug**.

Send me that list and I'll lock the left column exactly.

---

## New site inventory (redirect targets)

### OBX Lot Solutions — `obxlotsolutions.com` (38 pages, built; commercial page still to build)
Core: `index.html` · `services.html` · `service-area.html` · `about.html` · `contact.html` · `estimate.html` · `faq.html` · `reviews.html` · `case-studies.html` · `blog.html` · `thanks.html`
Services: `soft-washing.html` · `pressure-washing-*` · `soft-washing-vs-pressure-washing.html` · `home-watch.html` · `home-watch-checklist.html` · `junk-removal-rental-estate-cleanout-obx.html` · `rental-turnover-cleanout-obx.html`
Town pages: `corolla` `duck` `southern-shores` `kitty-hawk` `kill-devil-hills` `nags-head` `manteo` `rodanthe` `hatteras` `frisco` `buxton` `ocracoke` `avon`
Blog/SEO: `how-often-wash-house-outer-banks` · `pressure-washing-cost-outer-banks` · `what-is-home-watch-obx` · `why-algae-comes-back-coastal-homes` · `outer-banks-storm-prep-checklist`
> **✅ Built (2026-06-08):** `commercial-cleanup.html` now exists as the dedicated 1:1 target for the old parking-lot/storefront/dumpster/roadside/event commercial ads (was dumping to `services.html#commercial`). The 5 commercial product redirects in `_redirects` point at it. Also added this launch: `shed-demolition.html` and `moving-loading.html` (new services — no inbound legacy ad URLs, so no redirects needed).

### Jamieson Automation — `jamiesonautomation.com` (37 pages, built)
Per web-presence memory, Jamieson has **no existing commerce/Squarespace site** → likely **no inbound ad URLs to redirect**. Fresh launch. **Confirm with Ray** there's no current `jamiesonautomation.com` taking ad traffic; if there is, send those Final URLs and I'll add a Jamieson block.

---

## OBX redirect map (DRAFT — old paths ASSUMED, confirm from Ads)

| # | Old Squarespace path (ASSUMED — confirm) | → New path | Type | Notes |
|---|---|---|---|---|
| 1 | `/` | `/` | 301 | Homepage. New hero leads washing + home-watch (old leads commercial litter). |
| 2 | `/shop` or `/store` (store landing) | `/services.html` | 301 | Old commerce hub → new services overview. |
| 3 | `/shop/p/parking-lot-cleanup` (+ any `-cleanup` product slugs) | `/commercial-cleanup.html` ✅ | 301 | Old core commercial product. |
| 4 | `/shop/p/storefront-walkway-cleanup` | `/commercial-cleanup.html` ✅ | 301 | |
| 5 | `/shop/p/dumpster-area-cleanup` | `/commercial-cleanup.html` ✅ | 301 | New site also has a "dumpster pad wash" under soft-washing — pick one target with Ray. |
| 6 | `/shop/p/roadside-cleanup` | `/commercial-cleanup.html` ✅ | 301 | |
| 7 | `/shop/p/event-cleanup` | `/commercial-cleanup.html` ✅ | 301 | Event/festival cleanup = quote-only on new site. |
| 8 | `/shop/p/junk-removal` | `/junk-removal-rental-estate-cleanout-obx.html` | 301 | Was a $0 quote SKU; new page is fuller. |
| 9 | `/about` | `/about.html` | 301 | |
| 10 | `/contact` | `/contact.html` | 301 | |
| 11 | `/services` (if exists) | `/services.html` | 301 | |
| 12 | `/account`, `/account/login` | `/contact.html` | 301 | New site has no Squarespace accounts (Stripe Checkout instead). See subscriptions note. |
| 13 | `/cart`, `/checkout` | `/services.html` | 301 | Buying moves to per-service Stripe `[BOOK & PAY]`. |
| 14 | `/review` | **external Google review URL** | 301 | Already used in review-request kit — **must keep working post-cutover.** Preserve the exact destination. |
| 15 | *(any town/service slugs the ads use, e.g. `/pressure-washing`)* | closest new service/town page | 301 | Fill from the Ads export. |
| 16 | **catch-all** `/*` | `/` | 301 | Safety net so no old deep link 404s. Keep LAST, after specific rules. |

### Funnel-critical flags (Ray decisions, not pure Dev Ops)
- **Existing Squarespace subscriptions ("20% off recurring"):** a 301 sends *new* visitors to `/home-watch.html`, but it does **not** migrate current paying subscribers' billing — that's a Stripe-migration step in task #7 / payments cutover. `❓ASK FOR RZY: are there active Squarespace subscribers to migrate, or is the recurring base empty?` (web-presence memory notes "no active Squarespace subscriptions exist" — confirm before cutover.)
- **`/review` destination:** I need the exact current target URL (Google review link) so the redirect preserves it byte-for-byte.

---

## Implementation (Cloudflare Pages / Netlify)
Both read a plaintext **`_redirects`** file at the site root. Starter for `obx-lot-solutions/_redirects` (to finalize once Ray confirms slugs):

> **The live `obx-lot-solutions/_redirects` file now matches this** (commercial slugs → `commercial-cleanup.html`). The block below is the reference copy.

```
# OBX Lot Solutions — Squarespace → new site (301s). Specific rules first, catch-all last.
/shop/p/parking-lot-cleanup      /commercial-cleanup.html   301
/shop/p/storefront-walkway-cleanup /commercial-cleanup.html 301
/shop/p/dumpster-area-cleanup    /commercial-cleanup.html   301
/shop/p/roadside-cleanup         /commercial-cleanup.html   301
/shop/p/event-cleanup            /commercial-cleanup.html   301
/shop/p/junk-removal             /junk-removal-rental-estate-cleanout-obx.html 301
/shop                            /services.html             301
/store                           /services.html             301
/account/*                       /contact.html              301
/cart                            /services.html             301
/checkout                        /services.html             301
/review                          https://g.page/r/REPLACE-WITH-REAL  301
/*                               /                          301
```
Cloudflare Pages note: it also supports a `_redirects` file (same Netlify syntax); per-line limit is generous for this size. If we host the OBX site behind Cloudflare's DNS anyway, **Bulk Redirects / a Redirect Rule** is an alternative that doesn't require touching the site files.

## Verification plan (before DNS cutover)
1. Export current ad Final URLs (above). For each: `curl -sI https://<newhost>/<oldpath>` → expect `301` then a `200` at the target (no chains, no loops).
2. Confirm every Google Ads Final URL resolves to a live new page; update any ad whose intent has no good target.
3. After cutover: re-test the same list on the live domain; submit the new `sitemap.xml` in Search Console; watch Ads for disapprovals/landing-page errors for 48h.

---
*Left column is assumed and WILL change once Ray sends the Ads Final-URL export + Squarespace slugs. Targets and structure are solid; only the source slugs are pending.*
