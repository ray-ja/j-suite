# Per-Town Vendor Referral Module — Concept Spec
*A FUTURE option, not a build order. Concept + how it could monetize + what it'd take. No fee mechanism is being built — the referral-fee business model is Ray's call. Draft. May 2026.*

## The concept
Turn the verified vendor directory into a **per-town module**: a page for each market (Corolla, Duck, Southern Shores, Kitty Hawk, Kill Devil Hills, Nags Head, Manteo) listing trusted local vendors by category — pool/spa, pest, HVAC, septic, cleaning/linen, landscaping, washing, home-watch, handyman, etc. The owner picks their town and gets a vetted rolodex. **Our own services (washing, junk, home-watch, Jamieson tech) are the anchor rows** in every town; everything else is referral.

Why it works: absentee owners value a *curated, local, verified* list over a Google search. It's the stickiest part of the Ops Kit, it reinforces our "the reliable local who knows everyone" position, and it routes the high-margin jobs (washing, home-watch) to us while we stay the owner's single point of contact.

## How it could monetize *(options for Ray to weigh — none built)*
1. **Bundled into the paid Kit.** Simplest: the directory is a value driver that helps sell the Kit. No vendor-side money; zero conflict; cleanest to launch.
2. **Flat vendor listing fee.** Vendors pay a small monthly/annual fee for a verified listing or category exclusivity per town. Predictable; doesn't depend on tracking jobs.
3. **Featured / sponsored placement.** Free baseline listings; vendors pay to be the highlighted pick in a town/category. Must be labeled "sponsored" for trust.
4. **Per-referral / per-booked-job fee.** Vendor pays when we send a tracked lead or a booked job. Highest upside, but needs tracking + trust + clear terms, and is the most regulated.
5. **Lead-gen for ourselves only.** Skip vendor fees entirely; the directory exists to capture owners and funnel the in-house services to OBX Lot Solutions / Jamieson. Lowest complexity, compounding value.

> The choice among these is a **business-model decision for Ray** (and may have NC tax/registration and disclosure implications). This spec deliberately stops at describing them.

## What it would take
**Content & trust**
- Verified contacts per town (the Verified Directory is the seed; fill the coverage gaps).
- A written **vetting standard** (licensed/insured, primary-source contact, reviewed) and a **re-verify cadence** (e.g., quarterly) so a paid product never ships a dead number.
- Clear labeling of any sponsored/paid placement; an affiliate/referral **disclosure** if money changes hands.

**Build (Dev)**
- A reusable **vendor-card** component + a town→category filter (pairs with the Hub's component library).
- A simple vendor record (name, category, town(s), verified phone, site, status, last-verified date) — a sheet/CMS, not a custom app, to start.
- If per-referral is ever chosen: a lead-tracking mechanism (unique link/code or call tracking) — **out of scope here.**

**Ops**
- An owner of the directory (re-verification, adding vendors, handling vendor requests).
- A vendor outreach motion if any paid tier is used (this overlaps our existing partner/landscaper channel).

## Risks / watch-outs
- **Accuracy is the product.** One wrong number in a paid kit erodes trust — the verify cadence is non-negotiable.
- **Conflict of interest.** We list our own services alongside referrals; keep "ours" clearly marked and don't bury better local options.
- **Compliance.** Paid placements need disclosure; referral fees may carry tax/registration and contract requirements — Ray + an accountant/attorney before any money model.

## Suggested phasing
1. **Now:** ship the directory **bundled in the Kit** (option 1) using verified contacts — value, no fees, no conflict.
2. **Next:** fill coverage gaps to 1–2 verified vendors per category per town; add the re-verify cadence.
3. **Later (Ray's call):** if there's demand, layer a paid tier (listing fee or sponsored placement) — built only after the model and compliance are decided.

## Sources
Seed data: `OBX-Ops/research/OBX Vendor Directory — Verified Contacts`. Component reuse: `OBX-Ops/research/Hub — Affiliate Product Plan` (Dev notes).
