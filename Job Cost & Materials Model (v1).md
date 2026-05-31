# Job Cost & Materials Model — v1

*Built by the Strategy lane to give Ray his **true cost floor** on every job, so quoting blind is no longer a thing. Sell-price anchors come from the existing Opportunity model; the **material/disposal costs here are freshly researched (2026)** and are what feed the new COGS layer in the quote tool. Sources at the bottom.*

**The point:** the app already tells you what to *charge*. This tells you what it *costs you* — so every quote shows live profit + margin and you know the lowest number you can say yes to without losing money.

---

## OBX Lot Solutions — consumable & disposal costs

### Soft wash (the engine)
The chemical is cheap; you're selling labor, skill, and the result — not materials.

| Item | Cost basis | Per typical house |
|---|---|---|
| Sodium hypochlorite 12.5% (SH) | $2.50–3.00/gal bulk (fill your own jugs to stay low) | 3 gal (sm) / 5 gal (med) / 8 gal (lg) → **$8–24** |
| Surfactant ("snot") | ~$0.20–0.30/oz; 1 oz per gal of mix | **$5–12** |
| Gas (machine/buffer) + wear | est. | **$5–10** |
| Water | usually customer's spigot | $0 |
| **Total material COGS** | | **~$20–45/house** |

- **House-wash mix:** ~2.5% SH for siding (1 gal SH : 4 gal water). Concrete/masonry steps up to ~4%.
- **Margin reality:** at a $399 house wash, materials are ~8–11% of the ticket. **~$30 cost.** Everything else is labor + margin. *Don't discount on the theory that "it's just bleach" — you're paid for not stripping their roof.*
- **Roof = soft wash only**, never high pressure (strips granules). Price roofs higher (~$700) — same cheap chemical, more risk/time.

### Pressure wash — concrete / driveway
- Material: surface-cleaner + a degreaser/higher-SH mix → **~$10–25/job.** Mostly gas + labor.
- $149 driveway → material is ~10–15%.

### Junk / debris removal — *disposal is your real variable cost*
- **Dare County C&D Landfill (1603 Cub Rd, Manns Harbor): $73.16/ton.** First 500 lbs residential **free**.
- **Transfer Stations (Manns Harbor & Buxton): $94.04/ton** (higher — material trucked offsite).
- A pickup-truck load of mixed C&D ≈ 1,500–2,500 lbs ≈ 0.75–1.25 tons → **~$55–$120 disposal per load**, plus gas.
- **Quote rule:** always price the dump fee *into* the job — estimate the load, add the tonnage cost, then your labor/margin on top. This is the line most new haulers eat by accident.

### House-watch — *near-zero cost, pure margin*
- Materials: $0. Cost = drive time/gas only (a few $ per visit).
- This is why it's the wedge: a $50 check is ~$45 margin and it's recurring. Sell it hard.

---

## Jamieson Automation — rental-tech package bill of materials

Real 2026 hardware costs. **Flag for Ray:** at the modeled $1,200 package price, hardware alone is ~$1,000 — so that number only works as **labor + install**, with hardware billed as a pass-through line (cost + markup). Quoting it as all-in $1,200 would hand the customer your hardware for free.

| Component | Real cost (2026) | Notes |
|---|---|---|
| Starlink Standard Kit | $349 | hardware; some low-congestion areas as low as $89 |
| Roof/pole mount | $35–65 | |
| Ethernet adapter | $25 | for mesh hand-off |
| Smart lock (Yale Assure Lock 2) | $188–260 | native Airbnb code integration — the host favorite |
| Mesh Wi-Fi AP (UniFi U6 Lite/Pro) | $99–159 | or use Starlink's free mesh node on Residential plan to cut this |
| PoE camera (UniFi G5 Bullet/Flex) | $129 ea | G6 Bullet $199 for 4K |
| Cable / mounts / misc | $30–60 | |
| **Hardware subtotal (typical 1-cam package)** | **~$950–1,100** | |

**Pricing structure to use:** Hardware (cost + ~15–25% markup) **+** flat install labor. Keep hardware and labor as separate quote lines so margin is visible and the customer sees what they're buying. *This is exactly what the COGS layer is for.*

---

## Spec for J-Suite Dev — COGS + payment layer

**1. True-cost (COGS) field per quote line.**
- Add an optional `unitCost` to each line item in the deep-quote engine (alongside the existing sell rate).
- Seed defaults from this doc (SH, surfactant, dump fee/ton, hardware costs above); editable in Settings → Pricing rates, same overlay pattern as the existing deep-rate editor.
- For junk: a **tonnage→disposal** helper (load size estimate × $73.16/ton, first 500 lbs free) that drops a disposal cost line automatically.

**2. Live margin readout on every quote.**
- Show **Cost / Price / Profit $ / Margin %** on the quote review screen and the saved quote.
- Add a soft **floor warning** if a manual price drops margin below a set threshold (default 35%) — so a discount on site never quietly goes underwater.

**3. Payment-link field (scaffold only).**
- Add a `paymentLink` field to the quote/invoice and a "Pay now" button that opens it.
- Build it provider-agnostic; **Stripe Payment Links** is the recommended default (no monthly fee, ~2.9%+30¢, link-per-amount, no code). **Ray connects the Stripe account himself** — do not wire live keys or move money; leave the field empty until he pastes a link or connects.

**4. Verify:** unit-test the margin math (cost/price/profit/margin) and the disposal helper against the figures in this doc.

---

## Sources

SH / soft-wash chemistry & cost: [PoolDial — liquid chlorine by state](https://pooldial.com/resources/articles/business/liquid-chlorine-cost-by-state) · [Softwash Technologies — SH 101](https://softwashtechnologies.com/sodium-hypochlorite-101/) · [J. Racenstein — soft wash mix](https://jracenstein.com/expert-advice-learning/what-mix-should-i-use-for-soft-washing)

Disposal: [Dare County C&D Landfill / Transfer Station tipping fees](https://www.darenc.gov/departments/public-works/c-d-landfill-rubble-transfer-station)

Jamieson hardware: [Starlink pricing 2026 (US Mobile)](https://www.usmobile.com/blog/starlink-cost/) · [Smart locks for Airbnb 2026 (GleamSync)](https://gleamsync.com/blog/best-smart-locks-airbnb) · [UniFi G5/G6 cameras (Ubiquiti Store)](https://store.ui.com/us/en/products/uvc-g6-bullet)
