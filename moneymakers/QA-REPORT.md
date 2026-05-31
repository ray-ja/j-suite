# QA Verification Report — OBX sites, money-makers & ops tools

*Full QA pass. Scope: everything in `moneymakers/` (fixable standalone) + read-only scan of the two repo sites in `websites/`. **No writes to the repo or the Business App** (per the safety override). Date: 2026-05-31.*

## Scope covered (113 pages)
| Area | Pages | Location |
|---|---|---|
| Second-Home Care Hub | 23 + 6 blog | `moneymakers/obx-second-home-hub/` |
| Rental Owner's Kit (landing) | 1 (+2 PDFs) | `moneymakers/obx-rental-owner-kit/` |
| Ops Tools (3 calculators + launcher) | 4 | `moneymakers/obx-ops-tools/` |
| Money-makers launcher | 1 | `moneymakers/index.html` |
| OBX Lot Solutions site | 38 | `websites/obx-lot-solutions/` *(repo — read-only)* |
| Jamieson Automation site | 38 | `websites/jamieson-automation/` *(repo — read-only)* |
| *(superseded)* Rental Ops Kit v1 | 1 | `moneymakers/obx-rental-ops-kit/` — SUPERSEDED notice in place |

---

## ✅ PASS (clean across every area)
- **Internal links:** 0 broken — all relative links resolve in all 8 areas.
- **Forms & CTA actions:** every Netlify form (`home-watch-lead`, `checklist-download`, `rental-kit-sample`, `ops-kit-sample`) has a valid `action` resolving to an existing target (`thanks.html` / the PDFs). All CTA hrefs resolve. *(Buy/affiliate placeholders are intentional — see flags.)*
- **JSON-LD:** 0 parse errors — every `application/ld+json` block validates (LocalBusiness, Product/AggregateOffer, FAQPage, BlogPosting, HowTo, ItemList, Blog).
- **Mobile:** `<meta viewport>` present on 100% of pages; mobile-first responsive CSS throughout (sticky call/result bars, single-column → grid breakpoints).
- **Images:** 0 broken — sites use inline SVG logos + emoji, no raster assets to break.
- **Brand colors:** correct everywhere — OBX green `#8BC34A` / navy `#1B2A4E` on the Hub, Kit, Ops Tools, launcher, and the OBX Lot Solutions site; Jamieson navy `#002052` / blue `#0099E5` on the Jamieson site.
- **"Land clearing":** **ZERO occurrences** anywhere (money-makers and both repo sites).

## 🔧 FIXED (in the standalone money-maker files)
- **Home-watch pricing was inconsistent.** The Hub pages and the cost calculator said **"$55/visit"**, but the canonical source (the app's `RATES_DEFAULT.housewatch`, the Service Guide, and Marketing's blog post) is **$50 monthly / $45 bi-weekly / $40 weekly** (+ $75 one-off, $95 storm). Aligned to canonical:
  - 12 Hub pages: `$55/visit` / `from $55` → `$50/visit` / `from $50`.
  - `cost-calculator.html`: per-visit base `{55,50,45}` → **`{50,45,40}`**.
  - Home page FAQ schema: "around $50 per visit".
  - Re-verified: 0 broken links, 0 JSON-LD errors; calculator small/monthly now reads **$50** (matches "from $50/visit" and the blog).

## ⚠️ FLAGS FOR RAY (cannot fix here)

**Repo files — off-limits this session (must be done on Ray's machine):**
1. **`websites/obx-lot-solutions/` home-watch pricing is mixed** ($55 / $50 / $45 across different pages) and now diverges from the canonical **$50/$45/$40**. Align it the same way the Hub was fixed. *(Not touched — repo.)*
2. **`websites/jamieson-automation/` phone is the placeholder `(252) 555-0143`** on ~39 pages (already noted in `websites/DEPLOY.md`). Replace with the real Jamieson number before launch.

**Account / config wiring (needed before go-live):**
3. **Gumroad buy links** — `obx-rental-owner-kit/index.html` has 3 `REPLACE_WITH_GUMROAD_LINK` placeholders (one per tier $29/$39/$49, $19 launch). Paste real URLs after creating the store.
4. **Affiliate links** — `obx-second-home-hub/recommended-gear.html` has 11 `REPLACE_WITH_AFFILIATE_LINK` placeholders. Paste after joining the program.
5. **Lead routing** — Netlify forms need a notification/webhook to route leads to OBX home-watch + the email sequence (per each folder's README).
6. **Domains** — canonicals are placeholders (`obxsecondhomehub.com`, `obxrentalkit.com`). Confirm/replace before deploy.

**Minor / informational (no action required):**
7. Lead-form input placeholders show an example phone `(252) 555-1234` — example formatting only, not a real number. Fine.
8. A few older Hub guide pages use a slightly shorter top-nav variant (Service Area / Blog reachable via the footer on every page, so navigation is complete). Cosmetic only — optional future polish.
9. `moneymakers/obx-rental-ops-kit/` is the superseded v1 (notice page in place) — safe to delete whenever convenient.

---

## Bottom line
All 113 pages pass links, forms, schema, mobile, images, brand, and the land-clearing check. The one substantive defect — home-watch pricing drift — is **fixed in the money-maker files** and **flagged for the matching repo site**. Everything in `moneymakers/` is launch-ready pending the account/domain wiring above. Nothing in the repo or the Business App was touched.
