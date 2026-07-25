# Dev Handoff — OBX Rental Owner's Operations Kit (PDF Reskin)

*The kit copy is **canonical and final.** This is the single source — build the saleable PDFs from these markdown files. Marketing is done on the kit; ping only for copy questions. **Nothing sells/publishes until Ray approves the designed proofs.***

---

## Status: FINAL ✅ (QA-passed)
- 7 components present and consistent (6 core + 1 premium-tier bonus), 594–857 words each.
- Pricing locked everywhere: **$29 core / $39 + tech guide / $49 + consult, $19 launch promo**, plus a free "lite" lead-magnet (the Turnover Checklist).
- Voice, OBX-specificity, and cross-sells consistent across all files.
- Cross-references between components resolve; tax/permit and insurance claims carry "verify with county / ask your carrier" caveats (keep these in the design).

---

## What to build

### A. The product PDFs (from `kit-contents/`)
Reskin each of the 7 markdown files into a polished, branded PDF:

| # | Source file | Output | Notes |
|---|---|---|---|
| 1 | `1 — OBX Turnover & Cleaning Checklist.md` | Checklist PDF | Real checkboxes; print-friendly; ★ items can use an accent |
| 2 | `2 — OBX Guest Welcome Book Template.md` | Fillable template | `[bracketed]` = fillable fields (form fields or clearly styled blanks) |
| 3 | `3 — OBX Seasonal Maintenance Calendar.md` | Calendar PDF | Month blocks; checkboxes; "DIY/pro" tags styled |
| 4 | `4 — OBX Storm-Prep Plan.md` | Plan PDF | Before/during/after sections; the guest-comms template as a callout box |
| 5 | `5 — OBX Vendor Contact Sheet.md` | Fillable sheet | Tables = fillable; one-page-friendly |
| 6 | `6 — OBX Pricing & Seasonality Cheat Sheet.md` | Cheat sheet PDF | Keep the demand-curve table prominent |
| 7 | `7 — OBX Tech-Ready Rental Setup Guide (premium bonus).md` | Premium guide PDF | Self-audit = checkboxes; gate to the $39/$49 tiers |

Plus:
- **Cover / title page** for the bundle.
- **Bundle delivery:** a combined PDF *and/or* a zip of the individual PDFs (a combined master PDF is the cleanest single download).

### B. The sales page (from `sales/Sales Page Copy.md`)
Build the page as written. The 3 pricing tiers + free lite variant are in the copy. Wire the checkout + cross-sell links (placeholders noted in the copy).

---

## Design spec

- **Fillable fields:** every `[bracketed]` placeholder (Welcome Book) and every blank table cell (Vendor Sheet) should be a real form field or a cleanly styled blank line — owners fill these in.
- **Checkboxes:** the `- [ ]` items render as actual checkboxes (print-tickable; interactive nice-to-have).
- **★ markers:** the ★ in the source flags OBX-specific items — give them a subtle accent (color/icon), don't delete the star meaning.
- **Footer each page:** kit name + "© OBX Lot Solutions" + soft "Need it done for you? obxlotsolutions.com · (252) 207-5985".
- **Palette/brand:** OBX Lot Solutions green `#8BC34A` / navy `#1B2A4E` (this is an OBX Lot Solutions product). The tech-guide component (#7) may use Jamieson navy `#002052` / blue `#0099E5` accents to signal the tech cross-sell — Marketing's call if you want consistency vs. the subtle brand cue; either is fine.
- **Print + screen:** US Letter, readable on a phone too (owners use these on-site).
- **Keep the caveats:** county tax/permit and insurance-discount disclaimers stay visible in the designed versions (compliance).

---

## Tooling note
Source is markdown for easy edits/re-skins. For PDF generation, the same HTML→PDF (WeasyPrint) approach Marketing used for the Home-Watch Checklist and the Jamieson leave-behind works well and keeps brand consistency — those are good visual reference points for type/spacing/footer treatment. Match that polish level.

---

## Production checklist (Dev + Ray)
- [ ] Dev: reskin 7 components → branded PDFs (fillable fields + checkboxes)
- [ ] Dev: cover page + combined master PDF (+ optional zip)
- [ ] Dev: build sales page from copy; wire checkout (Gumroad/Payhip/Stripe — Ray's account) + cross-sell links
- [ ] Dev: set up the free "lite" capture (Turnover Checklist) → existing email sequence
- [ ] Ray: create the sales/checkout account + payment
- [ ] Ray: review designed proofs → approve before anything goes live
- [ ] Ray: confirm current county occupancy-tax/STR-permit specifics before tax/pricing copy prints

---

*Canonical source: this folder. Companion context: `README — Kit Overview & Production Notes.md` (the why + monetization), `research/Comparable Pricing...` (price justification). Marketing is complete on the kit — copy is final.*
