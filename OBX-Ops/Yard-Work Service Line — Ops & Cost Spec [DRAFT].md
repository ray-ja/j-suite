# Yard-Work Service Line — Ops & Cost Spec  *(DRAFT)*

*Spec for the new OBX Lot Solutions yard-work line. Purpose: give Dev the **cost inputs** to seed the corrected COGS model, and give the site/menu a clean **service list + value-pricing frame**. Cost figures are freshly researched June 2026; sources at the bottom. Pricing numbers are starting anchors to validate against what closes (same convention as the Service Menu).*

> **Gear & consumables for this line now live in `Inventory/master-inventory.md`** (tags `yard`, `brush`, `land-clearing`) and its generated lenses — that's the canonical equipment list. This doc keeps the **cost model, rental rates, pricing frame, and Dev spec.**

> **Why this line fits:** it's low-skill, brother-friendly, and **recurring** — same profile as washing. It pairs directly with the existing wedges: a PM who books mowing is a warm lead for soft-washing + home-watch, and a realtor's listing shows far better with a cleared, mowed lot. It also leans into the "Lot Solutions" name. **One big margin edge no other line has: clean green-waste disposal is FREE in Dare County.**

---

## 1 · The services (online-bookable SKUs + quote work)

| Service | Format | Notes |
|---|---|---|
| **Lawn mowing & maintenance** | Recurring SKU, tiered by lot size | The recurring engine — weekly/bi-weekly. Trim + edge + blow included. |
| **String trimming / edging** | Add-on or standalone | Bundled into mowing; standalone for hardscape edges. |
| **Leaf & yard-debris cleanup** | Tiered by volume / quote | Seasonal spikes. Free disposal = high margin. |
| **Brush & overgrowth clearing / lot clearing** | Quote (area or day-rate) | Ties to the cleanup brand. Bigger gear (brush mower/chipper) may be rented. |
| **Hedge & shrub trimming** | Per-job / by linear ft | Light skill, good attach to mowing accounts. |
| **Storm debris cleanup** | Premium / quote | Post-storm, seasonal, high-value on OBX. Pairs with home-watch storm checks. |
| **Mulch & bed refresh** | Quote (materials pass-through) | Materials billed as a separate cost+markup line. |
| **Small limb / sapling removal** | Quote — **with the limit below** | See the licensing/safety line. |

**⚠ Scope/safety line (the yard-work equivalent of Jamieson's "no line-voltage" rule):** OBXLS does **ground-level brush, saplings, and small limbs only.** Felling mature trees, climbing/aerial work, anything near power lines, or large-trunk removal goes to a **licensed, insured tree service** (e.g., sub or refer — Crew Cutters does tree removal) or is declined. Tree work is the #1 injury/liability category in this trade; our GL policy and crew aren't set up for it. Protects the crew and the brand.

---

## 2 · Cost inputs to seed the COGS model

### A) Disposal — **the margin edge**
- **Clean vegetative debris (brush, leaves, pine needles/straw, grass clippings) = $0** at the **Dare County C&D Landfill (1603 Cub Rd, Manns Harbor)** and the **Public Works Recycling facility.** Confirmed June 2026.
- **Mixed loads** (vegetative + bagged trash, lumber, C&D) lose the free rate → falls back to **$73.16/ton** (first 500 lbs free) at the C&D landfill, or **$94.04/ton** at the transfer stations.
- **Model rule:** default yard-debris disposal cost = **$0**; expose a toggle "mixed/contaminated load" that flips to the $73.16/ton tonnage helper (same helper already spec'd for junk). **Ops rule for the crew: keep green waste clean and separate — mixing it in throws away free disposal.**
- Public Works info line: **252-475-5844** (confirm hours/load rules before a big haul).

### B) Mileage — **update the rate**
- **IRS 2026 business standard mileage rate = 72.5¢/mile** (up 2.5¢ from 70¢ in 2025). The DYAD operating agreement reimburses mileage at the IRS rate, so the cost model should use **0.725**, not 0.70. **Flag for Dev: bump the mileage constant if it's still seeded at 70¢.**
- Per-job cost = round-trip miles (shop ↔ site, plus dump run if any) × $0.725.

### C) Labor
- **$18/crew-hour** (the two brothers) — unchanged from the existing model. Yard jobs are labor-dominant; estimate crew-hours per job and this is the bulk of true cost.

### D) Consumables & wear (owned equipment)
- Fuel + 2-stroke mix, trimmer line, blade wear, oil: small but real → seed an **"equipment fuel & wear" allowance ≈ $8–15/job** (tune with real receipts). Keeps owned-gear cost off the books per-job without full depreciation modeling.
- Mulch / plant materials when applicable: **pass-through line = cost + markup**, like Jamieson hardware — never bundle into the labor price.

### E) Equipment rentals (only when the job needs big gear — pass-through line)
*Home Depot Rental is local in Kill Devil Hills; rates June 2026:*
- **Stump grinder:** ~$85–160/day (+ $150–300 refundable deposit, + ~$50–60 trailer if needed).
- **Wood chipper / chipper-shredder:** similar day-rate tier; 4-hr and weekly options exist.
- **Brush mower / utility trailer:** trailer ~$20–44/day (per the Hauling Equipment doc).
- **Model rule:** when a quote needs rented gear, add it as a **pass-through cost line** (rental + deposit risk + fuel), then labor + margin on top — same pattern as the roll-off dumpster for whole-house junk.

### F) Equipment buy (one-time; confirm locally at the KDH Home Depot)
Starter kit to own the recurring/light work; rent the heavy/occasional gear until volume justifies buying.

| Gear | Typical 2026 retail (confirm locally) | Buy now? |
|---|---|---|
| Commercial self-propelled mower (or used zero-turn) | push $400–700 · used ZT $1,500–4,000 | Push to start; ZT once mowing routes are steady |
| Backpack blower (commercial) | $250–450 | Yes — daily driver |
| String trimmer (commercial) | $200–400 | Yes |
| Hedge trimmer | $150–350 | Yes |
| Pole saw / small chainsaw | $150–400 | Yes (small limbs only — see safety line) |
| Hand tools, rakes, tarps, PPE, gas cans | $200–400 | Yes |
| **Starter kit total** | **~$1,400–2,800** | Flag to Ray as the line's startup capital |

*(Equipment buy is a Ray spend decision — see escalation.)*

---

## 3 · Pricing frame (value pricing — anchors to validate)
Price the **result and the recurring relationship**, not cost-plus; the COGS floor above just guarantees you never go underwater. Recurring = **20% off** (house standard). These are starting numbers — adjust to what closes.

| Service | Starting anchor | Basis |
|---|---|---|
| Mowing — small lot (≤¼ acre / typical OBX lot) | $45–55/visit | recurring discount applies |
| Mowing — medium (¼–½ acre) | $60–85/visit | |
| Mowing — large / multi-lot | quote | |
| Leaf & debris cleanup | from $149 (by volume) | free disposal = strong margin |
| Brush / lot clearing | quote — day-rate ~$600–900/crew-day + any rental | scope-variable |
| Hedge / shrub trimming | from $99 | attach to mowing |
| Storm debris cleanup | premium / quote | seasonal, urgent |
| Mulch & bed refresh | labor + materials pass-through | |

**Cross-sell hooks (build into the site + quote flow):** mowing/cleanup customer → offer soft-wash + home-watch; realtor listing prep → "cleared, mowed, and washed for showings" bundle.

---

## 4 · Spec for J-Suite Dev — COGS model + site
*(Dev Ops implements; OBXLS Ops does not touch the app or git.)*

1. **New service category "Yard Work"** in the quote engine with the SKUs in §1; recurring-discount flag honored (20%).
2. **Disposal default = $0** for yard debris, with a **"mixed/contaminated load" toggle** that switches to the existing tonnage→$73.16/ton helper. Don't let the default silently apply the junk dump fee to clean green waste.
3. **Mileage constant → 0.725** (IRS 2026). Verify wherever the model currently stores the per-mile rate.
4. **Equipment line types:** (a) owned → "fuel & wear" allowance default ~$10/job; (b) rented → pass-through cost line (rental + fuel); (c) materials (mulch) → cost + markup pass-through. All visible on the margin readout.
5. **Site/menu:** add the Yard Work services to the OBX Lot Solutions site service list with the value-pricing anchors and the recurring offer; add the cross-sell bundle CTA.
6. **Verify:** unit-test that a clean-debris yard job shows ~$0 disposal and correct margin, and that the mixed-load toggle restores the tonnage cost.

---

## ❓ASK FOR RZY
**Approve the ~$1,400–2,800 starter-equipment spend to launch the yard-work line (buy the light kit, rent the heavy gear), and confirm we cap tree work at ground-level brush/small limbs (sub or refer anything bigger)?**
*Default if unanswered:* I keep this as a spec only — no spend, no site changes go live — and the line stays "rent-everything" so it can run with zero capital until you decide.

---

## Sources
- [Dare County — Residential Yard Debris (free vegetative disposal)](https://www.darenc.gov/departments/public-works/residential-yard-debris) · [Dare County C&D Landfill / Transfer Station tipping fees](https://www.darenc.gov/departments/public-works/c-d-landfill-rubble-transfer-station)
- [IRS — 2026 business standard mileage rate 72.5¢/mi](https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents)
- [Home Depot stump grinder / wood chipper rental (HomeGuide 2026)](https://homeguide.com/costs/stump-grinder-rental-cost) · [Home Depot Rental — chipper & stump grinder](https://www.homedepot.com/c/chipper-and-stump-grinder-equipment-rental)
- Internal: `Job Cost & Materials Model (v1).md`, `Hauling Equipment — Rent vs Buy.md`, `Service Menu & Pricing Plan.md`
