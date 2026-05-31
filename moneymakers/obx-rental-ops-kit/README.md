# OBX Rental Owner's Operations Kit — sales page + product

A standalone sales/landing page for a **digital product** (the Ops Kit), plus the kit itself as downloadable PDFs. Own folder under `moneymakers/`, separate from the j-suite tree — deploys and sells independently.

**Stack:** one static HTML page + the OBX `style.css` (reused for brand consistency, green `#8BC34A` / navy `#1B2A4E`). No build step, no backend.

## Files
- `index.html` — the conversion landing page (hero → problem → what's inside → who it's for → free-sample funnel → pricing/buy → FAQ → CTA). SEO meta + **Product JSON-LD** (with `offers`) + FAQPage JSON-LD.
- `style.css` — shared OBX styles + product/pricing additions.
- `OBX-Rental-Ops-Kit.pdf` — **the product** (12 pages, 8 modules, branded cover, print-ready).
- `OBX-Rental-Ops-Kit-SAMPLE.pdf` — **free sample** (5 pages: Module 01 turnover checklist + "what's in the full kit" + buy CTA). Delivered by the Netlify lead form.

## ✅ Before launch — fill these in
1. **Gumroad buy link.** Search `index.html` for `REPLACE_WITH_GUMROAD_LINK` (3 spots: hero, pricing card, final CTA) and paste your Gumroad product URL. No payment is wired — Gumroad handles checkout/delivery. (Optional: use Gumroad's overlay by adding their `gumroad.js` and `class="gumroad-button"`; a plain link works fine.)
   - In Gumroad: create the product, upload `OBX-Rental-Ops-Kit.pdf` as the file, set the price ($29 launch / $49 list to match the page), publish, copy the URL.
2. **Domain.** Canonical/OG use placeholder `https://www.obxrentalkit.com/` — find-and-replace if you use a different domain (or host under the hub).
3. **Price.** Page + JSON-LD say $29 (from $49). Change in `index.html` (3 link labels + the pricing card + the JSON-LD `offers.price`) if you pick a different number.

## Deploy (Netlify — free, forms work)
1. Drag the **`obx-rental-ops-kit`** folder onto Netlify (or `netlify deploy --prod --dir=obx-rental-ops-kit`).
2. The free-sample form (`ops-kit-sample`) records the lead and serves `OBX-Rental-Ops-Kit-SAMPLE.pdf`. Add a Forms → notification to email new sample leads (they're warm — they wanted the product).
3. Point the buy buttons at Gumroad (above). The full PDF is delivered by Gumroad on purchase — don't host `OBX-Rental-Ops-Kit.pdf` publicly on the site.

> Note: keep the **full** kit PDF out of the deployed public folder once Gumroad hosts it (so it isn't free to anyone). The **sample** is meant to be public.

## How the kit was built / coordination note
Marketing was slated to write the kit copy; at build time their content wasn't in the project yet, so this is a **complete v1 authored from the established OBX brand voice** (plain-spoken, local, proof-over-adjectives) and grounded in the existing OBX/home-watch material. The 8 modules: turnover checklist, guest message templates, seasonal+storm calendar, vendor/emergency sheet, supply par list, damage/incident protocol, owner's property binder, pricing/margin guide.

Regenerate the PDFs anytime: the generator is at `/tmp/build_kit.py` (reportlab + DejaVuSans). **When Marketing delivers final copy, drop it into the module functions and re-run** to reskin/rewrite without touching layout. The landing page copy can likewise be swapped in place.

## Status
First-runnable: landing page (0 broken links, valid Product+FAQ schema, Netlify sample form, Gumroad placeholders) + both PDFs (12-page kit, 5-page sample, verified). **Not deployed.**
