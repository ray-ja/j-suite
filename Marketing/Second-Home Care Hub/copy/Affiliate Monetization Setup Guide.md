# Affiliate Monetization Setup Guide — OBX Second-Home Care Hub

*The playbook to turn the Hub's product recommendations into real revenue. Maps each of the 11 affiliate "pick cards" to a real program, with signup steps and exactly where Ray pastes each tracking ID into Dev's placeholder links. **Ray does all account creation and credentials — this is the instruction set, not the accounts.** Draft.*

> **Verified May 2026 (web-checked):** program availability and rates change. Amazon Associates is the universal fallback for every card — **Home Improvement / Tools / Home run 3% commission** as of 2025 (cut from higher rates in prior years). Brand/network programs are noted where they actually exist and usually pay better (e.g. **Reolink pays 6%**). Sign up for Amazon first to launch, then add brand programs as approvals come in. Confirm current terms on each program's site at signup.
>
> **What the research confirmed (so Ray doesn't chase dead ends):**
> - ✅ **Reolink** — real affiliate program, **6% commission**, via **FlexOffers** and **Awin** (the brand's own page: reolink.com/affiliate/). *Not on ShareASale/Impact.*
> - ✅ **Govee** — runs a direct affiliate program (us.govee.com).
> - ⚠️ **Starlink** — **no affiliate program**; only a referral *credit*, and "using the referral to make money is against their terms." → route Starlink mentions to a **Jamieson install lead**, never an affiliate link.
> - ❌ **Schlage / Yale (Allegion)** — no confirmed standalone affiliate program on major networks → **use Amazon** for smart locks.
> - ❌ **YoLink / Moen Flo** — no public affiliate program found → **use Amazon** (both are sold on Amazon; Moen Flo is the highest-ticket card, so its 3% Amazon payout is still the biggest single commission).
> - ❌ **Ubiquiti/UniFi** — no consumer affiliate program → not an affiliate card; if recommended, route to a **Jamieson install**.

---

## How this works (the 3-step model)

1. **Ray creates the accounts** (Amazon Associates first; then the brand/network programs below). Each approval gives Ray a **tracking ID / affiliate tag**.
2. **Dev has built every product link as a placeholder** with a slot for the tag (format in the next section). Ray pastes his tag into each; or hands the tags to Dev to wire in one pass.
3. **Links go live only after Ray approves** the page. Disclosures (already in the copy) must be present before any affiliate link publishes — it's FTC-expected and a trust asset.

**Sequence recommendation:** Launch on **Amazon Associates alone** (covers all 11 cards immediately), then layer in the higher-paying brand programs over the following weeks without blocking launch.

---

## Where the tracking ID goes (Dev placeholder format)

Dev's links use placeholders. Two patterns depending on program type:

**Amazon Associates** — the tag is appended as a URL parameter:
```
https://www.amazon.com/dp/PRODUCTID/?tag=AMAZON_TAG_HERE
```
Ray replaces `AMAZON_TAG_HERE` with his Associates **Store ID / tracking ID** (looks like `obxcarehub-20`). One tag works across every Amazon link site-wide — so this is a single find-and-replace.

**Brand / network programs** — each generates its own full tracking link (often via Impact, ShareASale, CJ, or the brand's dashboard). Dev's placeholder is the whole `href`:
```
href="BRAND_TRACKING_URL_HERE"   <!-- e.g. govee-card-1 -->
```
Ray pastes the brand-generated link into the matching slot. **Each card is labeled with its slot ID** (below) so there's no guesswork.

> **For Dev:** keep a single config/constants file mapping `slotID → href` so all links are maintainable in one place, and so the Amazon tag is set once as a variable. Recommended over hard-coding tags inline.

---

## The 11 affiliate cards → program map

*Cards follow the smart-monitoring + storm-prep + off-season pages. Each row: what it is, the page it lives on, the recommended program(s), and the Dev slot ID Ray pastes into.*

| # | Card (product type) | Lives on page | Primary program | Better-paying option to add | Dev slot ID |
|---|---|---|---|---|---|
| 1 | **Budget leak sensor** (single-point, wifi) | Smart Monitoring, Off-Season | Amazon (3%) | **Govee direct** (us.govee.com) | `aff-leak-budget` |
| 2 | **Whole-home leak + auto water shutoff** (YoLink / Moen Flo) | Smart Monitoring, Storm Prep | **Amazon (3%)** — no brand program found | — (highest-ticket card; biggest single payout even at 3%) | `aff-leak-wholehome` |
| 3 | **Temp & humidity monitor** (wifi, app alerts) | Smart Monitoring, Off-Season | Amazon (3%) | **Govee direct** | `aff-temp-humidity` |
| 4 | **Door/window & motion sensors** | Smart Monitoring | Amazon (3%) | Govee direct if Govee-brand | `aff-contact-motion` |
| 5 | **Wifi camera** (simple, exterior) | Smart Monitoring, Storm Prep | Amazon (3%) | **Reolink 6%** (FlexOffers/Awin) | `aff-cam-wifi` |
| 6 | **PoE / NVR camera kit** (serious coverage) | Smart Monitoring | Amazon (3%) | **Reolink 6%** (FlexOffers/Awin) | `aff-cam-poe` |
| 7 | **Smart thermostat** (wifi) | Smart Monitoring, Off-Season | Amazon (3%) | brand program if available | `aff-thermostat` |
| 8 | **Smart lock / keyless entry** (Schlage/Yale) | Smart Monitoring | **Amazon (3%)** — no brand program confirmed | (dual-path: also link Jamieson install) | `aff-smartlock` |
| 9 | **UPS / battery backup** (keeps router alive) | Smart Monitoring, Storm Prep | Amazon (3%) | APC/CyberPower if on a network | `aff-ups` |
| 10 | **Cellular failover gateway / power-loss alert** | Smart Monitoring, Storm Prep | Amazon (3%) | brand program if available | `aff-failover` |
| 11 | **Dehumidifier** (coastal humidity control) | Off-Season | Amazon (3%) | brand via FlexOffers/CJ if available | `aff-dehumidifier` |

> **Note on Starlink (cards reference it, but it's not an affiliate card):** Starlink does **not** run a standard commission affiliate program — only an on/off customer referral credit. So the Starlink mentions on the Smart Monitoring page should route to a **Jamieson Automation install lead** (the real monetization), not an affiliate link. This is intentional and already reflected in the page copy's CTAs.

---

## Signup steps — program by program

### A. Amazon Associates (do this first — covers all 11 cards)
1. Go to **affiliate-program.amazon.com** and sign in with Ray's Amazon account (use the business one if there is one).
2. Enter the Hub website URL as the promotional site (the Hub must be live or near-live with real content — Amazon reviews the site).
3. Choose a **Store ID** (e.g. `obxcarehub`); Amazon appends a number → your tag looks like `obxcarehub-20`.
4. Complete profile, payment, and tax info.
5. Amazon gives **immediate** tracking access, but requires **3 qualifying sales within 180 days** to stay approved — so launch the content and start driving traffic.
6. **Hand the tag (`obxcarehub-20`) to Dev** (or paste into the config file). One tag, all Amazon links.

*Commission reality: ~3–4% on most smart-home/home-improvement items. Volume + the higher-ticket cards (cameras, shutoff systems, dehumidifiers) are where it adds up.*

### B. Govee (cards 1, 3 — direct program, often better than Amazon)
1. Visit **us.govee.com** → footer "Affiliate" / partner program (Govee runs a direct program).
2. Apply with the Hub URL; on approval you get a dashboard to generate per-product tracking links.
3. Paste the generated links into slots `aff-leak-budget` and `aff-temp-humidity` (replacing Amazon there, or A/B which converts better).

### C. YoLink / Moen Flo (card 2 — whole-home shutoff, highest ticket) → **use Amazon**
No public affiliate program was found for either YoLink or Moen Flo (May 2026). Both are sold on Amazon, so:
1. Use the **Amazon link** for `aff-leak-wholehome` (Ray's single Amazon tag covers it).
2. Because this is the **highest-priced card on the site**, even Amazon's 3% is the biggest single commission — and it's the page's strongest "buy or have us install it" dual-path item, so make sure the **Jamieson install** cross-link is prominent here too.
3. *(Optional later: re-check Moen/YoLink for a brand program; swap the link if one launches.)*

### D. Reolink (cards 5, 6 — cameras; the best brand commission on the site, **6%**)
1. Go to **reolink.com/affiliate/** → the program runs through **FlexOffers** and **Awin** (not ShareASale/Impact).
2. Create a **FlexOffers** (or Awin) publisher account — one network login that can host other brands too.
3. Apply to Reolink; on approval, generate tracking links for the wifi cam and the PoE/NVR kit.
4. Paste into `aff-cam-wifi` and `aff-cam-poe`. *(6% vs Amazon's 3% — worth doing for cameras specifically.)*

### E. Smart locks — Yale / Schlage (card 8) → **use Amazon**
No standalone Schlage/Yale (Allegion) affiliate program was found on the major networks (May 2026).
1. Use the **Amazon link** for `aff-smartlock`.
2. Pair it with the **Jamieson install** cross-link (the dual-path move) — for locks, the install is often the bigger value anyway.
3. *(Optional later: re-check Awin/CJ for an Allegion program.)*

### F. UPS / battery & dehumidifiers (cards 9, 11) → **Amazon default**
1. **APC / CyberPower** (UPS) and **dehumidifier** brands may appear on **FlexOffers / CJ**; if Ray already has a FlexOffers account from Reolink, it's worth a look.
2. Otherwise leave the **Amazon link** in `aff-ups` / `aff-dehumidifier` — fine for launch.

### G. Cards 4, 7, 10 (contact/motion, thermostat, failover/power-alert)
- No strong standalone brand program needed — **Amazon Associates is the right call** for these. Dev's Amazon placeholders + Ray's one tag covers them.

---

## Network accounts worth creating once (reused across brands)
Creating these once unlocks several brand programs from one login:
- **FlexOffers** — **Reolink (6%)**, and a wide range of home/electronics brands. *(Primary network to create after Amazon.)*
- **Awin** — also carries Reolink and many smart-home brands.
- **CJ (Commission Junction)** — major retailers and some brands; check here for dehumidifier/UPS brands.
- *Optional:* **Best Buy** and **Home Depot/Lowe's** affiliate programs carry most of these products (YoLink and Moen Flo are both sold at Home Depot) if a retailer link ever converts better than Amazon.

---

## Ray's checklist (account creation — owner only)
- ☐ Create **Amazon Associates** account → get tag (e.g. `obxcarehub-20`) → give to Dev *(launch-critical; covers all 11 cards at 3%)*
- ☐ Create **Govee** affiliate → better-paying links for cards 1, 3
- ☐ Create **FlexOffers** (or Awin) account → apply to **Reolink (6%)** → cards 5, 6
- ☐ Leave cards 2, 4, 7, 8, 9, 10, 11 on **Amazon** for launch (no better program confirmed; revisit later)
- ☐ Make sure **Starlink** + **UniFi** mentions route to **Jamieson install leads**, not affiliate links (no programs exist)
- ☐ Confirm **all disclosures present** before any link publishes
- ☐ Approve the pages → Dev sets links live

## Dev's checklist (wiring — no credentials needed)
- ☐ Single config file mapping `slotID → href` + one Amazon `tag` variable
- ☐ All 11 cards reference their slot ID (table above)
- ☐ Amazon links use `?tag={AMAZON_TAG}`; brand links use the full pasted tracking URL
- ☐ Inline + footer affiliate disclosures rendered on every page with links
- ☐ Links open in new tab, `rel="sponsored nofollow"` on affiliate hrefs (SEO + compliance)
- ☐ Don't publish live links until Ray approves

---

## Honesty & compliance guardrails (non-negotiable)
- **Disclose every time** — footer on all pages + inline near the first link. Already written into the copy.
- **`rel="sponsored nofollow"`** on affiliate links (Google's requirement; protects the site's SEO).
- **Only recommend what we'd install ourselves** — the entire model depends on the trust; a card we wouldn't stand behind gets cut, not kept for the commission.
- **No fabricated specifics** — prices/specs pulled live or marked "check current price"; no invented discount or commission claims.

---

*Handoff: Ray runs the account-creation checklist; Dev wires slots from the config file; Marketing keeps the pick-card copy and disclosures current. Companion docs: `03 — Affiliate Framing & Lead-Funnel CTAs.md` (card pattern + voice), `copy/smart-monitoring-FINAL.md` (the highest-affiliate-value page).*
