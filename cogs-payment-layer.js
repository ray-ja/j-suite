/* ============================================================================
 *  J-Suite — COGS + PAYMENT LAYER  (drop-in patch for "Business App (v1).html")
 *  Spec: "Job Cost & Materials Model (v1).md" → "Spec for J-Suite Dev"
 *
 *  WHY A PATCH FILE (not committed in-place):
 *  When this was built, the bash/git working tree was a STALE 32KB cache of the
 *  465KB live app, and .git/index.lock was held by another session. Committing
 *  from that state would have regressed the app and wiped other lanes' uncommitted
 *  work. So the layer ships here, fully unit-tested, anchored to the exact engine
 *  functions, ready to inline + commit in ONE clean pass once the repo is healthy.
 *
 *  This file is also directly require()-able by the test runner: the PURE LOGIC
 *  block (Part 1) has no DOM/app deps, so cogs-payment-tests.mjs verifies it
 *  standalone. Parts 2–4 are the app glue with copy-in anchors.
 * ==========================================================================*/

/* ===========================================================================
 *  PART 1 — PURE LOGIC  (paste just after calcQuote(); also used by tests)
 * ==========================================================================*/

/* COGS_LAYER_V1 — idempotency sentinel. The apply runbook greps the live app for
 * this exact token; if it's already present, the patch has been applied — skip,
 * do not paste again. (Paste this whole Part-1 block verbatim, sentinel included.) */

/* Dare County C&D Landfill tipping fee. */
var DISPOSAL_RATE_PER_TON = 90;      // $/ton — the close station (2026-08-28; was $73.16, 1603 Cub Rd, Manns Harbor)
/* ⛔ NO FREE ALLOWANCE. Ray, 2026-08-26: "the station only waives some trash once per year its irrelevant
   and shouldn't be in any quote tool."
   The 500 lb waiver is an ANNUAL RESIDENTIAL allowance — a household's once-a-year cleanout, not something a
   contractor gets on every load. Subtracting it from a job quote under-costed EVERY C&D dump line by
   500/2000 × the C&D rate (then $73.16 → $18.29), silently and in the customer's favour, on every job that hauled.
   ⚠️ THIS IS THE THIRD TIME THE SAME MISTAKE HAS BEEN CAUGHT (see VEG_FREE below, corrected 2026-07-25, and
   Dare's free residential yard site that excludes contractor debris). The pattern: a rate sheet written for
   households gets read as if it applied to the business. If a disposal number is described as free, assume it
   is free for a RESIDENT and check what the commercial line says before it reaches a quote. */

var LBS_PER_TON           = 2000;
var MARGIN_FLOOR          = 0.35;    // soft floor — warn below 35%

/* Disposal cost for an estimated load weight (lbs) — every pound billable.
 * disposalCost(2000) === 90 ; disposalCost(500) === 22.50 */
function disposalCost(lbs){
  lbs = Math.max(0, +lbs || 0);
  return Math.round((lbs / LBS_PER_TON) * DISPOSAL_RATE_PER_TON * 100) / 100;
}

/* Cost / Price / Profit$ / Margin% for a single line (qty-aware). */
function lineFigures(price, cost, qty){
  qty = qty || 1;
  var P = (+price || 0) * qty;
  var C = (+cost  || 0) * qty;
  var profit = P - C;
  return { price: P, cost: C, profit: profit, margin: P > 0 ? profit / P : 0 };
}

/* Roll up a list of {price, cost, qty} line items into quote-level figures.
 * `discount` (a $ amount off the price side only) lowers price + profit, never cost —
 * exactly how an on-site discount eats margin. */
function quoteCogs(items, discount){
  var price = 0, cost = 0;
  (items || []).forEach(function(it){
    var f = lineFigures(it.price, it.cost, it.qty);
    price += f.price; cost += f.cost;
  });
  price = Math.max(0, price - (+discount || 0));
  var profit = price - cost;
  return { price: price, cost: cost, profit: profit, margin: price > 0 ? profit / price : 0 };
}

/* Floor test — true when margin is under the (configurable) floor. */
function belowMarginFloor(margin, floor){
  return margin < (floor == null ? MARGIN_FLOOR : floor);
}

function pct(margin){ return (margin * 100).toFixed(1) + "%"; }

/* ---- COGS overlay: per-service material/hardware cost defaults from the doc ----
 * Parallel to RATES_DEFAULT (sell side). Editable in Settings via getCosts()/setCosts(),
 * same doc-overlay pattern as getRates()/setRates(). Figures sourced from
 * "Job Cost & Materials Model (v1).md" (2026 researched costs). */
var COST_DEFAULT = {
  obx: {
    // chem (SH ~$2.50-3/gal + surfactant) + gas; ~$30 on a typical 2500 sqft house
    softwash:  { base: 8,  perUnit: 0.0088 },   // 2500 sqft -> ~$30
    roofwash:  { base: 8,  perUnit: 0.011  },   // same cheap chem, more area
    pressure:  { base: 12, perUnit: 0.004  },   // mostly gas; 600 sqft -> ~$14
    deck:      { base: 8,  perUnit: 0.010  },
    windows:   { base: 5,  perUnit: 0.10   },   // negligible consumables
    gutters:   { base: 10, perUnit: 0.05   },   // bags + gas
    parking:   { base: 15, perUnit: 0.20   },   // bags + dump + gas
    housewatch:{ base: 4                    },   // gas only ~ a few $ / visit
    // junk: gas/labor-fuel base + disposal driven by load weight (tonnage helper)
    junk:      { base: 25, lbsPerEighth: 312.5 } // full truck ~2500 lbs / 8
  },
  jam: {
    // hardware pass-through is the real cost; install labor is Ray's own time (~0 COGS)
    lock:    { hardware: { wifi: 220, retrofit: 210, budget: 100, "customer-supplied": 0 }, addlHw: 200, hub: 130, misc: 10 },
    camera:  { nvr: 300, perCam: 129, run: 20, misc: 15 },     // G5 Bullet ~$129 ea
    network: { base: 120, perAp: 130, perDrop: 20, design: 0 },// UniFi U6 Lite ~$130
    starlink:{ mount: { eave: 50, roof: 50, pole: 65 }, perExt: 25 }, // kit customer-supplied = $0
    labor:   { rate: 0 }                                        // own labor
  }
};

/* COGS for one calculated line, mirroring calcQuote(key, inp). Returns a $ cost. */
function calcCost(key, inp, costs){
  costs = costs || COST_DEFAULT; // app passes getCosts(); tests pass defaults
  var biz = (typeof S !== "undefined" && S.biz) ? S.biz : (costs.obx && costs.obx[key] ? "obx" : "jam");
  var table = costs[biz] || {};
  var c = table[key];
  if (!c) return 0;
  inp = inp || {};
  var qty = inp.qty || 0, n = Math.max(1, inp.count || 1);
  switch (key) {
    case "softwash": case "roofwash": case "pressure": case "deck": case "windows": case "gutters":
      return Math.round(((c.base || 0) + (c.perUnit || 0) * qty) * 100) / 100;
    case "parking":
      return Math.round(((c.base || 0) + (c.perUnit || 0) * qty) * 100) / 100;
    case "housewatch":
      return c.base || 0;
    case "junk": {
      var lbs = inp.lbs != null ? inp.lbs : (inp.eighths || 1) * (c.lbsPerEighth || 312.5);
      return Math.round(((c.base || 0) + disposalCost(lbs)) * 100) / 100;
    }
    case "lock":
      return (c.hardware[inp.type] || 0) * n + (c.addlHw || 0) * (n - 1) + (inp.hub ? c.hub : 0) + (c.misc || 0);
    case "camera":
      return (c.nvr || 0) + (c.perCam || 0) * n + (c.run || 0) * (inp.runs != null ? inp.runs : n) + (c.misc || 0);
    case "network":
      return (c.base || 0) + (c.perAp || 0) * (inp.aps || 0) + (c.perDrop || 0) * (inp.drops || 0) + (inp.design ? c.design : 0);
    case "starlink":
      return (c.mount[inp.mount] || c.mount.eave) + (c.perExt || 0) * (inp.ext || 0);
    case "labor":
      return (c.rate || 0) * (inp.hours || 1);
    default:
      return 0;
  }
}

/* Build the disposal-cost line the junk helper auto-adds (a COGS line). */
function disposalLine(lbs){
  return { serviceId: "", name: "Dump fee — " + lbs + " lbs (Dare C&D @ $" + DISPOSAL_RATE_PER_TON + "/ton)",
           unit: "cost", price: 0, qty: 1, cost: disposalCost(lbs), costLine: true };
}

/* node/test export — ignored in the browser */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DISPOSAL_RATE_PER_TON, LBS_PER_TON, MARGIN_FLOOR,
    disposalCost, lineFigures, quoteCogs, belowMarginFloor, pct, COST_DEFAULT, calcCost, disposalLine };
}

/* ===========================================================================
 *  PART 2 — RATE/COST OVERLAY  (paste just after setRates())
 *  Same persisted-doc overlay as getRates/setRates, so costs are editable in
 *  Settings and survive like the deep rates.
 * ==========================================================================*/
/*
function getCosts(){try{const d=D().docs.find(x=>x.id==="costs"&&!x.deleted);if(d)return JSON.parse(d.text);}catch(e){}return JSON.parse(JSON.stringify(COST_DEFAULT));}
function setCosts(obj){let d=D().docs.find(x=>x.id==="costs");if(d){d.text=JSON.stringify(obj);d.updatedAt=now();}else D().docs.push({id:"costs",text:JSON.stringify(obj),updatedAt:now()});save();}
*/

/* ===========================================================================
 *  PART 3 — RENDER HELPER  (paste near money())
 *  A reusable Cost / Price / Profit$ / Margin% strip + sub-35% floor warning,
 *  used on both the wizard review and the saved/quick quote.
 * ==========================================================================*/
/*
function cogsStrip(price, cost){
  const profit = price - cost, margin = price>0 ? profit/price : 0;
  const warn = belowMarginFloor(margin);
  return `<div class="cogs" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
    <div class="kp"><b>${money(cost)}</b><span class="kl">Cost</span></div>
    <div class="kp"><b>${money(price)}</b><span class="kl">Price</span></div>
    <div class="kp"><b>${money(profit)}</b><span class="kl">Profit</span></div>
    <div class="kp" style="${warn?'color:#c0392b':''}"><b>${pct(margin)}</b><span class="kl">Margin</span></div>
  </div>${warn?`<div class="note" style="border-left:4px solid #c0392b;background:#fdecea;color:#922">
    ⚠ Margin ${pct(margin)} is under the ${Math.round(MARGIN_FLOOR*100)}% floor — this discount is eating your profit. Hold the price or trim scope.</div>`:""}`;
}
// Sum the COGS of the current line set (cost defaults to 0 on lines without one,
// so the strip prompts you to set it). Pass post-discount price from the caller.
function itemsCost(items){let c=0;(items||[]).forEach(it=>c+=(+it.cost||0)*(it.qty||1));return c;}
*/

/* ===========================================================================
 *  PART 4 — INTEGRATION ANCHORS  (exact find → replace edits)
 *  Apply against the live "Business App (v1).html" once the repo is healthy.
 * ==========================================================================*/
/*
[A] calcQuote(): also stamp a cost on every wizard line.
    FIND:   return {name:name,price:rnd5(price),notes:notes};
    ADD ->  return {name:name,price:rnd5(price),cost:calcCost(key,inp),notes:notes};

[B] Wizard "custom" + catalog lines carry a cost too.
    In wizReadInp/wizFinish where items are pushed, default it.cost to 0 if undefined
    so manual lines show a "set your cost" prompt rather than a fake 100% margin.

[C] wizReview(): show the COGS strip + floor warning above the present-total bar.
    FIND:   <div class="totbar"><span class="lab">Total to present</span>
    INSERT (before it): ${cogsStrip(total, itemsCost(WZ.items))}
    (total here is already post-discount, so the warning reacts to on-site discounts.)

[D] wizFinish(): persist per-line cost, quote-level cost, and an empty paymentLink.
    FIND:   items:WZ.items.map(it=>({serviceId:"",name:it.name,unit:"quote",price:it.price,qty:1})),recurring:rec,subtotal:sub,discount:disc,total:total};
    REPLACE items map -> ...,price:it.price,qty:1,cost:it.cost||0})),
            and append:  cost:itemsCost(WZ.items), paymentLink:"" , to the quote object.

[E] Quick builder — renderLines(): add an editable Cost input + (junk) tonnage helper.
    In the .qline template add after the price input:
      <input class="pr" type="number" value="${it.cost||0}" oninput="lineCost(${i},this.value)" title="cost" placeholder="cost">
    window.lineCost=function(i,v){QITEMS[i].cost=parseFloat(v)||0;renderTot();};
    Junk helper button (shown when a junk service is selected):
      <button class="btn ghost sm" onclick="junkHelper(${i})">⚖ Dump fee from load weight</button>
    window.junkHelper=function(i){const lbs=parseFloat(prompt("Estimated load weight (lbs)? Pickup load ≈ 1500–2500.","2000"));
      if(!lbs)return; QITEMS.splice(i+1,0,disposalLine(lbs)); renderLines();};

[F] quoteCalc()/renderTot(): also surface live COGS on the quick builder.
    After the total bar, render cogsStrip(t.total, itemsCost(QITEMS)).

[G] saveQuote(): mirror [D] — persist items with cost, quote cost:itemsCost(QITEMS),
    and paymentLink (preserve existing on edit: paymentLink: CURQ?CURQ.paymentLink:"").

[H] Saved-quote view (openQuote modal) + wizDone(): "Pay now" button (scaffold).
    Show when q.paymentLink is set; otherwise a "Add payment link" field.
      ${q.paymentLink
        ? `<a class="btn acc" href="${esc(q.paymentLink)}" target="_blank" rel="noopener">💳 Pay now</a>`
        : `<div class="note">Add a payment link (Stripe Payment Links recommended — no monthly fee,
             ~2.9%+30¢, one link per amount). Paste it here once your Stripe account is connected.</div>
           <input id="q_paylink" placeholder="https://buy.stripe.com/..." value="">
           <button class="btn ghost sm" onclick="setPayLink('${q.id}')">Save link</button>`}
    window.setPayLink=function(id){const d=D(),q=d.quotes.find(x=>x.id===id);
      if(!q)return; q.paymentLink=val("q_paylink").trim(); touch(q); save(); openQuote(id);};
    // SCAFFOLD ONLY: no keys, no API, no money movement. Ray pastes a link or connects Stripe himself.

[I] Settings (rData): add a "Job costs" editor mirroring the deep-rate editor, backed by
    getCosts()/setCosts(), plus a "Reset costs to defaults" that writes COST_DEFAULT.
*/
