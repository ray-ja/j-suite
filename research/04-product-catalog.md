# Product catalog — what to stock, where to buy it, what not to resell
_Research run 2026-08-08. Every price carries a source. Anything unverifiable is marked **NOT VERIFIED** rather than guessed. Prices in 2026 are genuinely volatile (tariff surcharges, the TP-Link ban, Starlink repricing) — treat this as seed data, not gospel._

## The five things that change the plan

**1. Open two accounts this week.**
- **ADI Global** — absorbed Snap One in 2024 and **completed its spin-off from Resideo on 2026-08-03 (now independent, NYSE: ADIG)**. One account covers cameras, Yale/Schlage locks, Resideo/2GIG/Alarm.com, eero Pro, **Araknis/Control4/OvrC**, wire and mounts. Trade-only; browse immediately, ordering unlocks after verification in 1–2 business days.
- **Ingram Micro** — mainly for the **Xvantage Reseller API**: a real REST API with **real-time price and availability**. This is the "pull live data to see where we can get it cheaper" capability, and it is the only verified one. https://developer.ingrammicro.com/reseller/getting-started/api-overview

**2. ⚠️ Do NOT standardize on TP-Link / Omada.** Commerce formally proposed banning TP-Link sales on 2025-10-30; the FCC put new foreign-made consumer routers on the Covered List 2026-03-23. Not retroactive — installed gear keeps working — but the new-model pipeline is frozen and prices are already spiking (an SG2428P switch went ~$300 → $436.99). Whether Omada "business" gear escapes the order is **unclear**. Wrong horse for a 3–5 year install base.

**3. NDAA compliance is a real filter here, not paperwork.** The OBX has Coast Guard contractors and federally funded projects; Section 889 bars agencies from contracting with entities that merely **use** the banned gear.
- **Ubiquiti — compliant.** **Reolink — claims compliant** (disputed at the edges, not TAA).
- **Amcrest — NOT compliant; it is a Dahua OEM.** **Lorex — NOT compliant by its own disclosure.**

**4. The margin is not where he'd expect.** Ubiquiti's public store price IS the customer's price check — dealer margin is anecdotally 5–15% and no official figure exists. Standardize on UniFi for quality and zero licensing, but **sell the labour and the design, not the box.** The margin actually lives in **Araknis** (dealer-only, ~40-point territory inferred from Snap One's SEC filings), pro-only SKUs (eero PoE line, ecobee P-SKUs, Honeywell T10 Pro at a verified ~21% under street), MAP-protected locks, mounting hardware, and **every recurring line**.

**5. Standardize the money layer on Z-Wave, not Matter.** Matter 1.6 (June 2026) added Joint Fabric aimed at managed properties, but the first Matter camera shipped March 2026 with one platform supporting it, cross-ecosystem lock PIN management is still ragged, and no Joint Fabric products ship yet. **You cannot sell a guest-access SLA on Matter in 2026.** Z-Wave is where access control actually lives — 125 Long Range certified devices at CES 2026, ~80% of the pipeline targeting ZWLR, and PointCentral shipped the first multi-credential ZWLR lock with Yale in March 2026. It is also hub-local with cellular backup, which matters on flaky beach-house internet. Re-evaluate in 18–24 months.

## Starter SKU list (good / better / best)
S = keep on the truck · O = order per job

| Category | Good | Better | Best |
|---|---|---|---|
| Gateway | UCG-Ultra $139 (S) | **UCG-Max ~$214 (S)** — doubles as a small-site NVR | UDM-Pro $408 (O) |
| Access point | U7 Lite $106 (S) | **U7 Pro $203 (S)** | U7 In-Wall $160 (S — rental bedrooms) · Araknis 830 (O — margin jobs) |
| Switch | Switch Ultra $139 (S) | Lite 16 PoE $214 (S) | Ultra 210W $214 (O) |
| Camera | Reolink RLC-811A ~$117 | **UniFi G6 Turret $228 (S)** | G6 PTZ $458 (O) |
| NVR | UCG-Max + NVMe | UNVR $322 (O) | UNVR Pro $538 (O) |
| Lock | Igloohome Deadbolt 2S $159.99 (S — offline algoPIN, for flaky-internet houses) | **Schlage Encode BE489 ~$250 (S)** — Grade 1, Airbnb-native | Yale Assure 2 Z-Wave ~$230 (O) |
| Lock platform (RMR) | Seam $5/device/mo (build our own portal) | **RemoteLock from $6/door/mo** | PointCentral (quote) |
| Thermostat | ecobee Essential $129.99 | **Honeywell T6 Pro Z-Wave ~$195 (S)** — runs on AA, retrofit-friendly | ecobee Premium Pro (5-yr warranty) · ADC-T40K-HD ~$250 |
| Hub | — | **HA Green $199 + ZWA-2 $69** (self-managed owners, only with a service contract) | Alarm.com panel (dealer channel, cellular backup) |
| Starlink mounts | Official Pipe Adapter ~$25–45 (S) | Winegard pole/roof mounts | **"Hurricane pole mount" — our own engineered pole + labour** |

## Starlink — the real opportunity is not the dish
Standard Kit **$349**, or the new default **$0 + $10/mo rental**. Mini $199. Performance $1,999. **Hardware margin is effectively zero** — Walmart has sold the kit at $279 with free install, below Starlink's own price. Reselling also tightened: all indirect resale relationships had to be registered by **2026-04-30**, and unregistered reselling is explicitly unauthorized.

**So the product is labour and mounting.** And there is a genuine gap: **Starlink publishes no wind rating for the Standard dish, and the Ridgeline mount is officially rated to only 50 mph** — inadequate for Dare County. An engineered, through-bolted or concrete-footed **hurricane-rated pole mount** is a defensible premium SKU that nobody official offers. Note also **Standby at $10/mo** — a real angle for seasonal beach houses.

## Recurring revenue lines (where the business actually compounds)
RemoteLock **from $6/door/mo** (manages Schlage Encode, Yale, August, Kwikset, Igloohome; integrates Airbnb, Vrbo, Guesty, Hostaway, OwnerRez) · Seam **$5/device/mo** API layer if we build our own portal · eero Plus $9.99/mo · PointCentral (quote) · monitoring and service contracts.
⚠️ Vrbo has **no** direct lock integration — it goes through middleware. Airbnb natively integrates Schlage/Yale/August.

## Live pricing — what can actually be wired in
- **Ingram Micro Xvantage API** — real-time price and availability. The one solid option. Needs an Ingram customer number then a developer-portal application.
- **ADI** — dealer-specific real-time pricing exists but only through integration partners (D-Tools, Simpro, VARStreet). No public dealer REST API found.
- **Ubiquiti** — no official API; the store loads prices client-side from a bot-protected backend. A polite scraper is possible; expect breakage.
- **Amazon PA-API 5.0 is deprecated 2026-05-15 and closed to new customers.** Not a practical feed.
- **B&H** affiliate product data feeds — free to join, a feed rather than a query API.

**Build note:** model every SKU with a **`priceSource`** field from day one. Half these prices are volatile and several channels are quote-only, so the app has to know whether a number came from a live feed, a dealer login, or a hand-entered quote.

## Do not resell (sell labour or subscriptions instead)
1. **Starlink hardware** — zero to negative margin.
2. **Ubiquiti hardware** — public store price is the customer's price check. Standardize on it, price the design.
3. **Nest / retail thermostats / retail eero packs** — big-box parity. (Exception: Honeywell T10 Pro, ~21% under street via Ferguson.)
4. **Reolink at Amazon parity** — only worth it through the partner program at bulk wholesale.

## NOT VERIFIED — do not treat as fact
Exact dealer margins for Ubiquiti, Araknis, locks, Yale4Pros/August Pro/Reolink/Amcrest/eero · ADI account document requirements and any dealer-facing pricing API · ecobee SmartBuildings and PointCentral pricing (both quote-only) · Amcrest current street prices (site bot-blocked) · official Starlink accessory prices · Starlink indirect-reseller full terms · whether Omada business gear sits inside or outside the FCC order.
