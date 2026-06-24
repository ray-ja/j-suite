/* ---------- QUOTE WIZARD: configurable sliding-scale rate engine ---------- */
const RATES_DEFAULT={
 obx:{
  softwash:{label:"House soft wash (siding)",unit:"sq ft",hint:"Exterior wall area = footprint perimeter × wall height. Soft wash uses low pressure + solution — safe for siding.",tiers:[[1500,0.18],[3000,0.15],[1e9,0.12]],min:199,stories2:1.25,stories3:1.5,heavy:1.2},
  roofwash:{label:"Roof soft wash",unit:"sq ft",hint:"Roof surface area. ALWAYS soft-wash a roof — high pressure strips shingle granules.",tiers:[[2000,0.30],[1e9,0.25]],min:299,steep:1.3,heavy:1.2},
  pressure:{label:"Pressure wash — concrete/driveway",unit:"sq ft",hint:"Flat concrete area = length × width. High pressure is fine on concrete.",tiers:[[600,0.30],[2000,0.22],[1e9,0.18]],min:99,oil:1.25},
  deck:{label:"Deck / patio wash",unit:"sq ft",hint:"Deck or patio surface area.",tiers:[[300,0.45],[1e9,0.35]],min:129},
  windows:{label:"Window cleaning",unit:"panes",hint:"Number of window panes. Interior + exterior costs more (≈1.5×).",tiers:[[20,14],[40,11],[1e9,9]],min:99,intext:1.5,upperAdd:4},
  gutters:{label:"Gutter cleaning",unit:"linear ft",hint:"Total linear feet of gutter — roughly the home's perimeter.",tiers:[[150,1.5],[1e9,1.2]],min:149,stories2:1.3},
  parking:{label:"Parking-lot cleanup",unit:"spaces",hint:"Number of parking spaces — use the Map tool to estimate from satellite.",tiers:[[25,3.2],[100,2.6],[300,2.0],[1e9,1.6]],min:79,freq:{"one-time":1,weekly:0.8,daily:0.7}},
  housewatch:{label:"House-watch (per visit)",unit:"visit",hint:"Recurring property checks for absentee owners — photo report each visit.",base:50,size:{small:0,medium:10,large:25},freq:{monthly:1,"bi-weekly":0.9,weekly:0.8}},
  junk:{label:"Junk removal",unit:"load",hint:"Estimate the fraction of a truck bed it fills.",base:120,perEighth:90,dumpFee:60}
 },
 jam:{
  lock:{label:"Smart lock(s)",hint:"Lock + install. Wi-Fi suits most rentals; add a hub for Z-Wave or many doors.",hardware:{wifi:280,retrofit:200,budget:160,"customer-supplied":0},install:129,addl:99,hub:149,code:39},
  camera:{label:"PoE camera system",hint:"Wired cameras to an NVR (no monthly fee). Each camera needs a Cat6 run.",nvr:430,perCam:180,install1:200,addl:120,run:89},
  network:{label:"Networking / WiFi",hint:"Coverage that keeps locks, cameras, and Starlink reliable.",base:249,perAp:279,perDrop:89,design:149},
  starlink:{label:"Starlink install",hint:"Kit is customer-supplied ($349). You're pricing the mount + clean cable run.",mount:{eave:299,roof:449,pole:499},perExt:59},
  labor:{label:"Tech labor",hint:"Hourly for custom or uncatalogued work.",rate:125}
 }
};
function getRates(){try{const d=D().docs.find(x=>x.id==="rates"&&!x.deleted);if(d)return JSON.parse(d.text);}catch(e){}return JSON.parse(JSON.stringify(RATES_DEFAULT[S.biz]));}
function setRates(obj){let d=D().docs.find(x=>x.id==="rates");if(d){d.text=JSON.stringify(obj);d.updatedAt=now();}else D().docs.push({id:"rates",text:JSON.stringify(obj),updatedAt:now()});save();}
/* COGS layer — Part 2: cost overlay (same persisted-doc pattern as getRates/setRates). */
function getCosts(){try{const d=D().docs.find(x=>x.id==="costs"&&!x.deleted);if(d)return JSON.parse(d.text);}catch(e){}return JSON.parse(JSON.stringify(COST_DEFAULT));}
function setCosts(obj){let d=D().docs.find(x=>x.id==="costs");if(d){d.text=JSON.stringify(obj);d.updatedAt=now();}else D().docs.push({id:"costs",text:JSON.stringify(obj),updatedAt:now()});save();}
function tierPrice(qty,tiers){let rem=qty,prev=0,sum=0;for(let k=0;k<tiers.length;k++){const cap=tiers[k][0],rate=tiers[k][1];const span=Math.min(rem,cap-prev);if(span>0){sum+=span*rate;rem-=span;}prev=cap;if(rem<=0)break;}return sum;}
function rnd5(n){return Math.round(n/5)*5;}
/* each calculator returns {name, price, notes:[]} */
function calcQuote(key,inp){
  const R=getRates(),r=R[key];if(!r)return null;
  let price=0,notes=[],name=r.label,qty=inp.qty||0;
  if(key==="softwash"||key==="roofwash"||key==="pressure"||key==="deck"){
    price=tierPrice(qty,r.tiers);
    if(inp.stories>=3&&r.stories3)price*=r.stories3;else if(inp.stories>=2&&r.stories2)price*=r.stories2;
    if(inp.steep&&r.steep)price*=r.steep;
    if(inp.heavy&&r.heavy){price*=r.heavy;notes.push("Heavy soiling/algae — extra solution & dwell time.");}
    if(inp.oil&&r.oil)price*=r.oil;
    price=Math.max(price,r.min);name=r.label+" — "+qty+" "+r.unit;
  } else if(key==="windows"){
    price=tierPrice(qty,r.tiers); if(inp.intext)price*=r.intext; if(inp.upper)price+=r.upperAdd*inp.upper;
    price=Math.max(price,r.min);name=r.label+" — "+qty+" panes"+(inp.intext?" (in+out)":"");
  } else if(key==="gutters"){
    price=tierPrice(qty,r.tiers); if(inp.stories>=2)price*=r.stories2; price=Math.max(price,r.min);
    name=r.label+" — "+qty+" ft";
  } else if(key==="parking"){
    price=tierPrice(qty,r.tiers)*(r.freq[inp.freq]||1); price=Math.max(price,r.min);
    name=r.label+" — "+qty+" spaces ("+(inp.freq||"one-time")+")";
    if((inp.freq||"one-time")!=="one-time")notes.push("Recurring route — price is per service.");
  } else if(key==="housewatch"){
    price=(r.base+(r.size[inp.size]||0))*(r.freq[inp.freq]||1);
    name=r.label+" — "+(inp.size||"medium")+" home, "+(inp.freq||"monthly")+" (per visit)";
    notes.push("Recurring — bill per visit on the chosen frequency.");
  } else if(key==="junk"){
    price=r.base+r.perEighth*(inp.eighths||1)+r.dumpFee; name=r.label+" — ~"+(inp.eighths||1)+"/8 truck";
    notes.push("Includes ~$"+r.dumpFee+" dump fee estimate; confirm on site.");
  } else if(key==="lock"){
    const n=Math.max(1,inp.count||1),hw=r.hardware[inp.type]||0;
    price=hw*n+r.install+r.addl*(n-1)+(inp.hub?r.hub:0)+(inp.code?r.code*n:0);
    name=r.label+" — "+n+"× "+(inp.type||"wifi");
    if(inp.weakwifi)notes.push("Weak Wi-Fi at the door — add a mesh node / access point or it'll drop.");
  } else if(key==="camera"){
    const n=Math.max(1,inp.count||1);
    price=r.nvr+r.perCam*n+r.install1+r.addl*(n-1)+r.run*(inp.runs||n);
    name=r.label+" — "+n+" cameras";
  } else if(key==="network"){
    price=r.base+r.perAp*(inp.aps||0)+r.perDrop*(inp.drops||0)+(inp.design?r.design:0);
    name=r.label+" — "+(inp.aps||0)+" AP / "+(inp.drops||0)+" drops";
  } else if(key==="starlink"){
    price=(r.mount[inp.mount]||r.mount.eave)+r.perExt*(inp.ext||0); name=r.label+" — "+(inp.mount||"eave")+" mount";
  } else if(key==="labor"){
    price=r.rate*(inp.hours||1); name=r.label+" — "+(inp.hours||1)+" hr";
  }
  return {name:name,price:rnd5(price),cost:calcCost(key,inp),notes:notes};
}

/* COGS_LAYER_V1 — COGS + payment layer, Part 1 (pure logic). Idempotency sentinel; do not duplicate. */
var DISPOSAL_RATE_PER_TON = 73.16;   // $/ton (Dare County C&D, Manns Harbor)
var DISPOSAL_FREE_LBS     = 500;     // residential free allowance
var LBS_PER_TON           = 2000;
var VEG_RATE_PER_TON      = 58.46;   // $/ton brush/veg — Currituck transfer station ($38 / 1,300 lb). NOT free.
var DISPOSAL_TRIP_MILES   = 55;      // round-trip miles to the transfer station (Point Harbor base → Maple, OSRM)
var MARGIN_FLOOR          = 0.35;    // soft floor — warn below 35%
var MILEAGE_RATE          = 0.725;   // $/mi round-trip vehicle cost — 2026 IRS rate 72.5¢ (absorbs fuel; no separate gas line, no hourly wage)
var MILEAGE_RATE_LABEL    = "72.5¢"; // display form (avoids $0.725 rounding to $0.72)
var CONSUMABLES_PCT       = 0.05;    // washing/cleaning chemical + consumable allowance, as % of labor sub
var VEG_FREE              = true;    // clean vegetative debris dumps FREE in Dare County (mixed loads = $73.16/ton)
function mileageCost(miles){ return Math.round((Math.max(0,+miles||0) * MILEAGE_RATE) * 100) / 100; }
function disposalCost(lbs){
  lbs = Math.max(0, +lbs || 0);
  var billable = Math.max(0, lbs - DISPOSAL_FREE_LBS);
  return Math.round((billable / LBS_PER_TON) * DISPOSAL_RATE_PER_TON * 100) / 100;
}
function lineFigures(price, cost, qty){
  qty = qty || 1;
  var P = (+price || 0) * qty;
  var C = (+cost  || 0) * qty;
  var profit = P - C;
  return { price: P, cost: C, profit: profit, margin: P > 0 ? profit / P : 0 };
}
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
function belowMarginFloor(margin, floor){
  return margin < (floor == null ? MARGIN_FLOOR : floor);
}
function pct(margin){ return (margin * 100).toFixed(1) + "%"; }
var COST_DEFAULT = {
  obx: {
    softwash:  { base: 8,  perUnit: 0.0088 },
    roofwash:  { base: 8,  perUnit: 0.011  },
    pressure:  { base: 12, perUnit: 0.004  },
    deck:      { base: 8,  perUnit: 0.010  },
    windows:   { base: 5,  perUnit: 0.10   },
    gutters:   { base: 10, perUnit: 0.05   },
    parking:   { base: 15, perUnit: 0.20   },
    housewatch:{ base: 4                    },
    junk:      { base: 25, lbsPerEighth: 312.5 }
  },
  jam: {
    lock:    { hardware: { wifi: 220, retrofit: 210, budget: 100, "customer-supplied": 0 }, addlHw: 200, hub: 130, misc: 10 },
    camera:  { nvr: 300, perCam: 129, run: 20, misc: 15 },
    network: { base: 120, perAp: 130, perDrop: 20, design: 0 },
    starlink:{ mount: { eave: 50, roof: 50, pole: 65 }, perExt: 25 },
    labor:   { rate: 0 }
  }
};
function calcCost(key, inp, costs){
  costs = costs || COST_DEFAULT;
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
function vegDisposalCost(lbs){ lbs = Math.max(0, +lbs || 0); return Math.round((lbs / LBS_PER_TON) * VEG_RATE_PER_TON * 100) / 100; }
function disposalLine(lbs, veg){
  var c = veg ? vegDisposalCost(lbs) : disposalCost(lbs);
  return { serviceId: "", name: "Dump fee — " + lbs + " lbs " + (veg ? "(brush/veg @ $" + VEG_RATE_PER_TON + "/ton)" : "(mixed C&D, first 500 lbs free)"),
           unit: "cost", price: 0, qty: 1, cost: c, costLine: true };
}

