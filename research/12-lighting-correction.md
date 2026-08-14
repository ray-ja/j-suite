# 12 — Residential Lighting Correction

Ray's idea, 2026-08-13: *"lighting specialist, no wiring but I go through and fix the lighting in
people homes with the right color bulbs, adding dimmers and stuff, getting rid of white operating
room style LEDs."*

**VERDICT: real work, real expertise, thin standalone market — and half the idea as stated is
illegal. Do it as a productized add-on riding Milepost home watch and Jamieson Networks. Not a
brand. Drop the dimmer-switch half unless it is subbed to a licensed electrician.**

---

## 1. ⚠️ THE LEGAL LINE — this reshapes the idea

**Wall dimmer swaps for hire are NOT legal in NC without an electrical contractor licence.**

[NCGS 87-43](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.html):
> "Electrical contracting shall be defined as engaging or offering to engage in the business of
> installing, maintaining, altering or repairing any electric work, wiring, **devices**, appliances
> or equipment."

A hardwired dimmer is a *device*. Three things make this harder than it first looks:

1. **There is no small-job dollar exemption.** Verified as an *absence* in
   [87-43.1](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.1.html).
   The only dollar figures in the Article are caps on *licensed* classifications
   ([87-43.3](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.3.html)).
2. **"Offering to engage" is itself the violation.** Advertising dimmer work breaks the statute
   before any work is done. This is a marketing-copy constraint, not just a field constraint.
3. **The permit exemption is not a licence exemption.**
   [160D-1110(a)(4)](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_160D/GS_160D-1110.html)
   waives the *permit* for a like-kind switch swap — but explicitly conditions on "the work is
   performed by a person licensed under G.S. 87-43."

Violation = Class 2 misdemeanor
([87-48](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-48.html)).

### What IS expressly permitted — 87-43.1(7), verbatim
> "the replacement of lamps and fuses and … the installation and servicing of cord-connected
> appliances and equipment connected by means of attachment plug-in devices."

| ✅ CAN | ❌ CANNOT |
|---|---|
| Screw-in bulbs, any kind | Wall switches and wall dimmers |
| Smart bulbs + app/scene setup | Hardwired fixtures, sconces, ceiling fans |
| Plug-in lamps and fixtures | Receptacles (expressly excluded in (7)) |
| Plug-in dimmer modules | Anything inside a junction box |
| Smart plugs | **Advertising** any of the above |
| Fuse replacement | |

*Flagged, not board-confirmed:* whether re-wiring a lamp cord counts as "servicing of
cord-connected equipment." Reads permitted; don't build a service line on it without asking the
NC Board of Examiners of Electrical Contractors.

**The workaround is genuinely good:** dimmable smart bulbs (Hue, WiZ) deliver most of what a wall
dimmer delivers — dimming, scenes, scheduling — controlled by phone or remote, with no switch
touched. Legal, and a better product than a $169 installed Caseta in most rooms.

---

## 2. Does anyone sell this? Essentially nobody, standalone

- Closest match found: [Lighting & Bulbs Unlimited](https://lightingandbulbsunlimited.com/pages/our-services)
  (Charlotte NC) — in-home "LED Conversion" consult → survey → install, quote-only. A *showroom
  add-on*, not a standalone trade.
- Relamping is a real trade but **commercial only** (e.g. [Empire Electric](https://www.empireelec.com/group-relamping/)).
- Handyman chains list bulb/dimmer work as generic task lines
  ([Mr. Handyman](https://www.mrhandyman.com/handyman-services/electrical/electrical-services-and-installation/),
  [TaskRabbit](https://www.taskrabbit.com/services/handyman/light-installation)).
- Searches for "residential relamping," "lighting concierge," "bulb audit," "lighting makeover +
  Kelvin" returned **zero** businesses.

*Caveat: ~15 searches of consistent nulls, not an exhaustive negative.*

**Read:** whitespace — but whitespace every handyman in America *could* fill and hasn't. That says
standalone demand is thin, not that we found a secret.

---

## 3. Pricing

**Verified anchors**

| Anchor | Figure | Source |
|---|---|---|
| Lighting *design* plan | $1,823–$2,210/project | [Homewyse](https://www.homewyse.com/services/cost_to_specify_home_lighting_design.html) |
| Designer hourly (experienced) | $125–$250 | [Dominion Lighting](https://dominionlighting.com/professional-lighting-design-services/) (directional) |
| Handyman | ~$44/hr avg; $75–250/fixture | [TaskRabbit](https://www.taskrabbit.com/cost-guides/light-installation) |
| Caseta dimmer, installed | $169 all-in | [Nextech](https://shop.nextechenergy.com/products/smart-lighting-dimmer-switch-for-wall-and-ceiling-lights) |

**No published residential "lighting audit" price exists anywhere.** We would be setting it.

**Model — 4BR / ~40 lamps**

| Line | |
|---|---|
| Walkthrough + spec | 1.0–1.5 hr |
| Sourcing | 0.5–1.0 hr |
| Install | 1.5–2.5 hr |
| **Labour @ $125/hr** | **$440–625** |
| Bulbs at cost (90+ CRI, $3–7 ea) | $120–280 |
| Bulbs billed installed (~$8–10 ea) | $320–400 |
| *Hardware margin* | *only $50–150* |

**→ Defensible ticket: $795–995 flat.** Above handyman rates (we beat them on expertise), below
design fees (we undercut those). **The money is labour, not bulbs — price flat, never as a markup
on parts.**

**Draft sheet**
- Lighting audit — **$195**, credited if the correction is booked
- Whole-house correction, 4BR — **$895**, includes up to 40 lamps
- Smart-bulb / plug-in dimmer add-ons — parts + $125/hr
- PM portfolio rate — **~$600–700/house at 10+ homes**

---

## 4. Is the expertise real enough to charge for? Yes

- **CRI**: incandescent = 100, standard LED ≈ 83, high-CRI ≈ 95; plus R9 red rendering, which is
  what makes skin tones look alive ([CRI](https://en.wikipedia.org/wiki/Color_rendering_index)).
- **Colour temperature**: 2700K "soft white" vs 5000K "daylight" — the operating-room effect Ray
  named ([CCT](https://en.wikipedia.org/wiki/Color_temperature)).
- **LED dimming compatibility** — flicker, buzz, dropout, minimum load. Real enough that Lutron
  maintains a bulb-by-bulb [compatibility database](https://webtools.lutron.com/compatibility/us/en).
  This is the highest-value knowledge: most people who "tried dimmable LEDs" got a buzzing mess and
  gave up.
- Plus beam angle, lumens vs watts, colour consistency across a room, and warm-dim
  (Philips WarmGlow, Soraa Vivid Warm Dim — [Soraa](https://www.ecosenselighting.com/)).

A homeowner facing a wall of "60W equivalent / soft white / daylight" boxes genuinely cannot
navigate this. It supports a fee. **But it is an afternoon's teachable knowledge — the moat is
trust and already being in the house, not the knowledge itself.**

---

## 5. ⭐ The vacation-rental case — honest strength: practitioner consensus, NOT data

*I pitched this harder than the evidence supports before researching it. Corrected here.*

**Data-backed (but sells photography, not bulbs)**
- Professional photos raise occupancy **8.98%** — peer-reviewed causal study
  ([Zhang et al., *Management Science* 2022](https://econpapers.repec.org/RePEc:inm:ormnsc:v:68:y:2022:i:8:p:5644-5666)).
- Airbnb markets 21% earnings / 19% bookings, with an explicit no-guarantee disclaimer
  ([help/3381](https://www.airbnb.com/help/article/3381)).
- ⚠️ **That same Airbnb prep checklist tells photographers to shoot with all lights OFF.**
  This directly undercuts a "better listing photos" pitch.

**Consensus-backed (the defensible pitch)**
- Real-estate photographers' prep checklists *do* instruct matching bulb colour temperature at
  2700–3000K ([realestatepro.photography](https://realestatepro.photography/preparing-for-real-estate-photography/)).
- Hotels standardize 2700–3000K ([trade sources](https://guocio.com/blog/hotel-room-lighting-design/);
  brand standards non-public — flagged).
- STR furnisher [Fulhaus](https://fulhaus.com/for-airbnb) pre-installs 2700K in every package.

**Contradicted**
- "Guests complain about harsh lighting" — lighting appears in **none** of 18 complaint themes in a
  topic model of negative Airbnb reviews
  ([*Frontiers in Psychology* 2021](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.659481/full));
  only ~5% of 1.35M reviews mention *any* indoor-environment issue
  ([*Building and Environment* 2020](https://www.sciencedirect.com/science/article/pii/S036013231930767X)).

> **No study has ever isolated lighting's effect on bookings or nightly rate.**
> Say "bring your rental to the hotel 2700K standard." Never quote a booking-lift number for
> lighting — none exists, and anyone citing one made it up.

---

## 6. Sourcing — no hardware business, but one real differentiator

- Commodity 90-CRI lamps: $2–6/bulb at big-box (Feit Enhance at Costco — **the customer can
  price-check us**). Distributor case pricing maybe 20–40% under, unverified (behind logins).
- Trade brands via an electrical-distributor counter account: [Satco](https://www.satco.com/)
  (dealer-only), [TCP](https://www.tcpi.com/where-to-buy/) (contractor program).
- ⭐ **Product the customer cannot shelf-buy:** 95-CRI
  [Waveform](https://store.waveformlighting.com/collections/all) is DTC-only (~$28/multi-pack A19);
  Soraa is trade-channel only. Neither is at Lowe's. Unlike Starlink, there is something here we
  can supply that they can't.
- ⭐ **[Lutron Preferred Pro](https://www.lutron.com/us/en/resources/preferred-pro-residential-program)
  is free and open to low-voltage/AV installers — Jamieson qualifies today.** Worth taking
  regardless of this decision.

---

## 7. Business or service line? — Service line

**Against standalone:** cannot generate its own leads (nobody searches for it — which is *why* no
competitor owns it); ~$800 one-time ticket; weak recurrence for owner-occupied homes; null market
evidence.

**For an add-on — close to ideal:**
- **Milepost** is already inside vacant homes on a paid visit → **zero acquisition cost**. Annual
  relamp check is a natural home-watch upsell: rentals drift constantly as cleaners replace burned
  bulbs with whatever is in the closet, so a house mismatches itself over a season.
- **Jamieson Networks** already sells permanent LED lighting and holds the Lutron pro path.
- **PM channel** (Twiddy ~1,000 homes, Village ~600–900, Brindley 500+) buys it as a portfolio line
  item the way they already buy hot-tub service — pitched on hotel-standard consistency and
  photo-readiness, *not* invented ROI stats.

**Hard constraint on all marketing copy: never offer dimmer, switch, or fixture work.**

---

## Unverifiable this session (flagged, do not treat as known)
Big-box shelf prices and all distributor discounts (bot-blocked / behind login) · Waveform
per-pack quantities · Angi cost guides (403) · Airbnb "12 photo tips" page · hotel brand standards
documents · CES Outer Banks branch existence · whether lamp rewiring counts as "servicing" under
87-43.1(7) · **any lighting-specific booking-lift figure (none exists)**
