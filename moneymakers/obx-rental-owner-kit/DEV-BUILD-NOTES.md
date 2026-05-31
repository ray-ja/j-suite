# Dev build notes — OBX Rental Owner's Kit

Built per `DEV HANDOFF — PDF Reskin Spec.md`. Marketing's `kit-contents/` + `sales/Sales Page Copy.md` are canonical; everything here is generated from them.

## What Dev shipped
- `index.html` — sales page built from `sales/Sales Page Copy.md`. SEO meta + **Product JSON-LD** (AggregateOffer $19–$49) + FAQ schema. Mobile-first, OBX brand. Free-sample **Netlify form** (`rental-kit-sample`) delivers the sample PDF.
- **3 pricing tiers**, each with its own Gumroad placeholder `REPLACE_WITH_GUMROAD_LINK`:
  1. Core — **$29 (launch $19)**
  2. Kit + Tech-Ready Guide — **$39**
  3. Kit + Tech + 20-min consult — **$49**
  (Hero + final CTAs anchor to `#pricing`, so there are exactly 3 Gumroad placeholders = the 3 tiers.)
- `OBX-Rental-Owner-Kit.pdf` — **combined master** (20 pages): cover + contents + all 7 components, branded (green/navy; tech guide #7 uses a blue accent bar), real checkboxes, ★ accents, styled `[fill-in]` blanks, fillable tables, footer per spec ("Need it done for you? obxlotsolutions.com · (252) 564-8717").
- `OBX-Rental-Owner-Kit-SAMPLE.pdf` — **free "lite"** (5 pages): Turnover Checklist + "what's in the full kit" + tier CTA. This is the lead-magnet the form delivers.
- `build-pdfs.py` — the generator. It **parses the markdown in `kit-contents/` directly**, so when Marketing edits copy, just re-run: `python3 build-pdfs.py` (needs reportlab + DejaVu fonts). No transcription — copy stays canonical.

## Verified locally
Landing page: 0 broken links, valid Product+FAQ JSON-LD, 3 Gumroad placeholders, Netlify form → sample PDF. PDFs: all 7 components present, checkboxes/★/fill-ins render, full = 20pp, sample = 5pp. **Not deployed.**

## Before launch (Ray)
1. Create the store (Gumroad/Payhip — Ray's account + payment); make 3 products/variants; paste each URL into the matching `REPLACE_WITH_GUMROAD_LINK`. Upload `OBX-Rental-Owner-Kit.pdf` (and gate the tech guide / consult per tier).
2. Keep the full master PDF **out of the public deploy folder** (Gumroad hosts/delivers it); the **sample** is public.
3. Wire the Netlify `rental-kit-sample` form → the existing email sequence.
4. Confirm domain (placeholder `obxrentalkit.com`) and current county occupancy-tax/permit specifics before the pricing/tax copy prints (caveats are already in the PDFs).

## Notes
- Spec suggested WeasyPrint; it isn't installed in this environment, so the PDFs use reportlab (DejaVuSans) at matching polish (cover, footer, palette, checkboxes). Re-skin via WeasyPrint later if desired — copy is markdown, so portable.
- Open question Marketing raised in the source research: a full per-town **Vendor Directory** module (lead-gen/referral channel). Not built yet — flag to Strategy if wanted.
