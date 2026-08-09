/* ---------- HOLIDAY LIGHTS — ONE-PAGE QUOTE MACHINE (js/126) --------------------------------------------
   Ray, 2026-08-08: "i have no idea on the pricing you gotta use the deep research fable agent to figure all
   that out ive never done this so make sure you include evidence to support everything in the app."

   So EVERY rate below carries its evidence and a confidence tag, surfaced in the UI (tap ⓘ), not just in a
   comment. He has never done this work and has nothing to sanity-check a number against — the sources ARE the
   product here.

   ⚠️ THIS ONE DOES NOT WORK LIKE THE OTHER ESTIMATORS.
   French drain (js/101) and stepping-stone (js/112) treat materials as PASS-THROUGH at cost: the material stays
   at the customer's house, so he charges exactly what he paid and all profit is labour. Holiday lighting is the
   opposite — HE OWNS THE LIGHTS and takes them home in January. So the strand cost is an ASSET AMORTISED across
   seasons, not a pass-through, and year 1 must recover only a share of it.

   That single difference drives three things:
     - Year 1 carries ~1/AMORT_YRS of the strand cost; year 2+ carries almost none, which is why the repeat year
       is where this business actually earns.
     - Coastal air shortens the amortisation window. Christmas Designers (the trade supplier) publishes: "if you
       live close to the ocean, you can expect to reduce the life of your light sets by up to 50%." 6-7 seasons
       inland becomes 3-4 here. DEFAULT 3 — deliberately conservative.
     - Cut-to-fit C9 is RECOVERABLE inventory (cut anywhere, re-terminate with a $0.75 vampire plug, bulbs
       transfer). Sealed mini-light strings are NOT. Losing a repeat customer strands mini-lights, not C9.

   Priced from research/05 (cost basis) + research/06 (market). The market band for THIS model — installer owns
   the lights, maintains, removes and stores them — is $8-12/linear ft, NOT the $2-5/ft figure that describes
   labour-only work on customer-owned lights. Getting that wrong underprices the whole business. */

if (typeof window === "undefined") { var window = {}; }   // node test shim

/* ---- RATES. Each carries {v, lo, hi, src, conf}. The UI renders src + conf next to the number. ---- */
const HL_RATES = {
  roof1: { v: 8,  lo: 8,  hi: 10, conf: "high",
           src: "Trade band for full-service (installer owns lights + maintains + removes + stores) is $8-12/ft — ChristmasLights.io, corroborated by ChristmasLightsHQ ($6-12, 'quick answer $8-12') and QuoteIQ. Budget operators run $4-6 and are the ones who go broke." },
  roof2: { v: 9.5, lo: 9, hi: 11, conf: "medium",
           src: "Thumbtack: 'most installers charge twice as much on the second story' (labour component). Fixr: roofs 16 ft+ run $3.50-6/ft with a 20-25% multi-level adder." },
  roof3: { v: 11.5, lo: 11, hi: 12, conf: "medium",
           src: "Angi: 3-storey jobs $700-1,800. HomeGuide: 3-storey $750-5,000. Plus a ~20% 'dangerous job' adder. No explicit pitch adder is published anywhere — pros capture steepness by measuring every peak." },
  rail:  { v: 6,  lo: 5,  hi: 7,  conf: "low",
           src: "NO published deck-railing rate exists — genuine industry gap. Nearest anchor: fence-line $5-8/ft (ChristmasLightsHQ). Priced BELOW roofline because deck rails are installed from the deck, at ground-level productivity." },
  treeFt:{ v: 45, lo: 30, hi: 60, conf: "high",
           src: "$30-60 per VERTICAL FOOT of tree height — ChristmasLights.io. ChristmasLightsHQ: $25-50/strand at roughly one strand per vertical foot, with a '$300 minimum on any tree'. Consumer guides quote far less (Fixr: 6-ft tree $75-125) — expect anchoring pushback." },
  bush:  { v: 75, lo: 50, hi: 100, conf: "medium", src: "ChristmasLightsHQ $50-150 each; QuoteIQ $25-75. Midpoint taken." },
  column:{ v: 110, lo: 75, hi: 150, conf: "medium", src: "ChristmasLightsHQ $75-150 per column/porch post." },
  window:{ v: 62, lo: 50, hi: 75, conf: "medium", src: "ChristmasLightsHQ $50-100 each; QuoteIQ $20-50." },
  garland:{ v: 17, lo: 15, hi: 20, conf: "high",
           src: "$15-20/ft installed (~$125-175 per 9-ft section) — ChristmasLightsHQ wreath & garland guide. Commercial runs over 100 ft drop to $12-15/ft." }
};
/* wreaths price by DIAMETER, not linear anything */
const HL_WREATHS = [
  { in: 24, price: 100, src: "$75-125 installed with bow — ChristmasLightsHQ" },
  { in: 32, price: 175, src: "30-36in: $150-225" },
  { in: 48, price: 300, src: "48in: $250-500" },
  { in: 60, price: 500, src: "60in: $400-800. Price top-of-range for a third-storey gable — that source charges no height premium, we should." }
];

const HL_MIN_JOB   = 1000;   // ⚠️ NOT his $375 trade minimum — that is one third of the full-service floor.
const HL_MIN_JOB_SRC = "An identical-model operator publishes 'minimum installation cost is $1000' (Saint Nick's). Trade norm is a $800-1,200 minimum ticket / 100-ft minimum. A $250 minimum exists ONLY for labour-only work on customer-owned lights.";
const HL_MIN_TREE  = 300;    // per-tree floor regardless of height
const HL_REPEAT_DISC = 0.125;  // repeat-year discount: 12.5% (band 10-15%)
const HL_REPEAT_SRC = "⚠️ Ray's published promise that repeat years cost less DIVERGES from industry norm — most full-service operators charge the SAME price every year ('you're not purchasing materials'). Published discount practice tops out at 10-15%. Do NOT go deeper: product is only 12-18% of a year-1 ticket and coastal strand life is short.";
const HL_DEPOSIT   = 0.50;   // 50% non-refundable at booking
const HL_DEPOSIT_SRC = "50% non-refundable at booking, balance on install day — verified across multiple operators (Suncor, Saint Nick's, The Light Pros). None charge 100% upfront. Early-bird 10% for booking by ~Sept 30 is standard; December rush premiums of 10-50% are normal.";

/* ---- COST SIDE (research/05). Materials are OURS and amortised, not passed through. ---- */
const HL_COST = {
  c9PerFt:   { v: 1.20, lo: 1.05, hi: 1.75, src: "C9 SPT-1 socket wire $0.31-0.66/ft (spool size dependent) + one LED retrofit bulb per foot at $0.76-1.48 — Christmas Light Source / Christmas Designers, open-web prices. A free Pro Installer account gets below these." },
  clipPerFt: { v: 0.20, lo: 0.13, hi: 0.43, src: "All-in-one / shingle-tab / C9 clips $12.70-42.95 per 100 — Christmas Designers. One clip per bulb-foot." },
  miniPerTreeFt: { v: 3.20, lo: 2.40, hi: 4.00, src: "M5 LED mini 70-ct/23.3ft at $13.70-21.95; roughly one strand per vertical foot of tree." },
  consumables: { v: 60, lo: 40, hi: 120, src: "Vampire plugs $0.75 each (4-8/house), timer ~$38, extension cords $15-40/run, ties and fuses." },
  storagePerJob: { v: 40, lo: 20, hi: 60, src: "OBX self-storage from $39/mo (Kill Devil Hills) / $44 (Nags Head), divided across ~30 customers' totes. Unit price sourced; the divisor is an assumption." },
  shrinkPerJob: { v: 25, lo: 15, hi: 40, src: "A 200-job contractor wastes $3,000-8,000/yr in product — ChristmasLightsHQ." },
  helperHr:  { v: 16.5, lo: 15, hi: 18, src: "ZipRecruiter US average $17.39/hr, most $13.46-18.99. Salary.com's $25-39 looks like job-title contamination — disregarded." },
  /* STOREY-DEPENDENT, and getting this wrong is how the model lies to him. Strandr publishes PER-INSTALLER
     rates: 15-25 ft/hr single-storey, 10-18 ft/hr two-storey. Doubled for a 2-man crew that is 30-50 ft/crew-hr
     on a ranch but only 20-36 on a two-storey — and the reference job is two-storey. Using the single-storey
     number everywhere made year 1 look like $211/crew-hr when the research says $94-150. */
  ftPerCrewHr1: { v: 40, lo: 30, hi: 50, src: "15-25 ft/hr per installer single-storey (Strandr) x2 for a 2-man crew." },
  ftPerCrewHr2: { v: 28, lo: 20, hi: 36, src: "10-18 ft/hr per installer two-storey (Strandr) x2 for a 2-man crew. Used for 2- and 3-storey work. ⚠️ One source claims 200-400 ft/crew-hr — 5-10x higher, unreconciled, and only plausible for repeat-year re-hangs of pre-cut strands." },
  /* Repeat years are faster: the strands are already cut to this house and just go back up. The research could
     only establish this QUALITATIVELY, so this multiplier is a deliberately conservative inference, not sourced. */
  repeatSpeed: { v: 0.65, lo: 0.5, hi: 0.8, src: "INFERENCE, not sourced: repeat-year re-hangs of pre-cut strands are materially faster. The trade's 200-400 ft/crew-hr outlier claim only makes sense for this case. 0.65 is deliberately conservative — the honest published answer is that no one quantifies it." },
  takedownPct: { v: 0.50, lo: 0.40, hi: 0.60, src: "Takedown runs 40-60% of install time — Strandr, LightQuoter and ChristmasLightsHQ agree." },
  serviceHrs: { v: 1.5, lo: 1.0, hi: 3.0, src: "~2 service visits x 90 min per account per season (commercial anchor; residential callback rates are published nowhere). ~90% of callbacks are GFCI trips from water in a ground-level plug connection — largely preventable." }
};
const HL_AMORT_YRS_DEF = 3;
const HL_AMORT_SRC = "Pro-grade LED is rated 6-7 seasons inland with proper storage. Christmas Designers, vendor-published: 'if you live close to the ocean, you can expect to reduce the life of your light sets by up to 50%.' 3 seasons is the deliberately conservative coastal default. ⚠️ No published coastal replacement RATE exists anywhere — ask a Christmas Designers Pro Installer rep; it is the single number that would most improve this model.";

/* ---- THE CORE. Pure function: geometry in → money out. No globals, node-testable. ---- */
function hlCalc(j) {
  j = j || {};
  const n = (x, d) => { const v = +x; return isFinite(v) && v > 0 ? v : (d || 0); };
  const R = j.rates || HL_RATES, C = j.costs || HL_COST;
  const repeat = !!j.repeatYear;
  const amortYrs = Math.max(1, n(j.amortYrs, HL_AMORT_YRS_DEF));

  /* --- PRICE --- */
  const roofFt = n(j.roofFt), storeys = Math.min(3, Math.max(1, Math.round(n(j.storeys, 1))));
  const roofRate = j.roofRate != null ? +j.roofRate : (storeys >= 3 ? R.roof3.v : storeys === 2 ? R.roof2.v : R.roof1.v);
  const roofPrice = roofFt * roofRate;

  const railFt = n(j.railFt);
  const railPrice = railFt * (j.railRate != null ? +j.railRate : R.rail.v);

  const trees = Array.isArray(j.trees) ? j.trees : [];
  const treePrice = trees.reduce((s, t) => {
    const ft = n(t && t.ft);
    return s + Math.max(HL_MIN_TREE, ft * (j.treeRate != null ? +j.treeRate : R.treeFt.v));
  }, 0);

  const bushPrice   = n(j.bushes)  * R.bush.v;
  const columnPrice = n(j.columns) * R.column.v;
  const windowPrice = n(j.windows) * R.window.v;
  const garlandPrice= n(j.garlandFt) * R.garland.v;
  const wreaths = Array.isArray(j.wreaths) ? j.wreaths : [];
  const wreathPrice = wreaths.reduce((s, w) => {
    const size = n(w && w.in, 24);
    const row = HL_WREATHS.slice().reverse().find(x => size >= x.in) || HL_WREATHS[0];
    return s + row.price * Math.max(1, Math.round(n(w && w.qty, 1)));
  }, 0);

  let price = roofPrice + railPrice + treePrice + bushPrice + columnPrice + windowPrice + garlandPrice + wreathPrice;
  const belowMin = price > 0 && price < HL_MIN_JOB;
  if (belowMin) price = HL_MIN_JOB;

  const repeatDisc = repeat ? Math.round(price * (j.repeatDisc != null ? +j.repeatDisc : HL_REPEAT_DISC)) : 0;
  price = Math.round(price - repeatDisc);

  /* portfolio discount — property managers, clustered same-week */
  const homes = Math.max(1, Math.round(n(j.homes, 1)));
  const pmPct = homes >= 10 ? 0.15 : homes >= 5 ? 0.10 : 0;
  const pmDisc = Math.round(price * pmPct);
  price = price - pmDisc;

  /* --- COST --- */
  const litFt = roofFt + railFt + n(j.garlandFt);
  const treeVertFt = trees.reduce((s, t) => s + n(t && t.ft), 0);

  const strandCost = litFt * C.c9PerFt.v + treeVertFt * C.miniPerTreeFt.v;   // the ASSET
  const strandAmort = repeat ? 0 : strandCost / amortYrs;                     // year 1 carries one slice
  const clips = litFt * C.clipPerFt.v;

  const crewFtHr = (storeys >= 2 ? C.ftPerCrewHr2.v : C.ftPerCrewHr1.v) * (repeat ? (1 / Math.max(0.1, C.repeatSpeed.v)) : 1);
  const instHrs = litFt > 0 ? litFt / Math.max(1, crewFtHr) : 0;
  const treeHrs = trees.length * 0.75;                                        // 1-2 trees/hr per crew
  const downHrs = (instHrs + treeHrs) * C.takedownPct.v;
  const crewHrs = instHrs + treeHrs + downHrs + C.serviceHrs.v;
  const labour = crewHrs * C.helperHr.v;                                      // helper cost; Ray's own time is the profit

  const cost = Math.round(strandAmort + clips + C.consumables.v + C.storagePerJob.v + C.shrinkPerJob.v + labour);
  const profit = price - cost;
  const margin = price > 0 ? Math.round(profit / price * 100) : 0;
  const perCrewHr = crewHrs > 0 ? Math.round(price / crewHrs) : 0;

  return {
    roofFt: roofFt, roofRate: roofRate, roofPrice: Math.round(roofPrice),
    railPrice: Math.round(railPrice), treePrice: Math.round(treePrice),
    bushPrice: bushPrice, columnPrice: columnPrice, windowPrice: windowPrice,
    garlandPrice: Math.round(garlandPrice), wreathPrice: wreathPrice,
    belowMin: belowMin, repeatDisc: repeatDisc, pmPct: pmPct, pmDisc: pmDisc, homes: homes,
    price: price, deposit: Math.round(price * HL_DEPOSIT),
    strandCost: Math.round(strandCost), strandAmort: Math.round(strandAmort), amortYrs: amortYrs,
    crewHrs: Math.round(crewHrs * 10) / 10, instHrs: Math.round(instHrs * 10) / 10, downHrs: Math.round(downHrs * 10) / 10,
    labour: Math.round(labour), cost: cost, profit: profit, margin: margin, perCrewHr: perCrewHr,
    lowMargin: margin < 35, belowTarget: perCrewHr < 125
  };
}

if (typeof window !== "undefined") {
  window.hlCalc = hlCalc; window.HL_RATES = HL_RATES; window.HL_COST = HL_COST;
  window.HL_WREATHS = HL_WREATHS; window.HL_MIN_JOB = HL_MIN_JOB;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { hlCalc: hlCalc, HL_RATES: HL_RATES, HL_COST: HL_COST, HL_WREATHS: HL_WREATHS,
                     HL_MIN_JOB: HL_MIN_JOB, HL_MIN_TREE: HL_MIN_TREE, HL_REPEAT_DISC: HL_REPEAT_DISC,
                     HL_AMORT_YRS_DEF: HL_AMORT_YRS_DEF, HL_DEPOSIT: HL_DEPOSIT };
}
