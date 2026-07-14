/* ---------- STEPPING-STONE / ROCK PATH — ONE-PAGE QUOTE MACHINE ----------
   Mirrors the French-drain estimator (js/101) BEAT-FOR-BEAT — same pricing model (Ray):
   - PRICE = LABOR only. The $/linear-ft slider + market band are the worth of the INSTALL (excavate, set the
     stones, spread the decorative rock), NEVER the materials.
   - EVERY material is its own selector + its own EDITABLE price. Customer provides it, or we do; when WE do it's
     a PURE PASS-THROUGH (at cost, zero margin) → toggling one moves price + cost equally, labor profit unchanged.
   - EXCAVATED SPOIL (the dig for the base) is a 3-way: leave/spread ($0), haul clean-fill ($45/ton + a dump run),
     or haul C&D ($73.16/ton + a dump run). Ray usually HAULS → haul-off is the default.
   - PICKUP is its own weight-driven mini-quote → a real sub-job (self-haul the pavers + marble, softer rate).
   Cost / Price / Profit / Margin shown with the 35% margin-floor warning. Reference job that calibrated it:
   40 ft × 3 ft path · 24×24 stones · 3" marble gap · 4" marble side border · 2" rock depth · 4" base. */

if (typeof window === "undefined") { var window = {}; }   // node test shim (browser: no-op)

const STEPPATH_DENSITY_DEF = 1.4;    // t/cy of decorative marble / crushed stone (editable per quote)
const STEPPATH_SETTLE      = 0.10;   // +10% rock for settling/compaction (toggle)
const STEPPATH_LABOR_DEF   = 14;     // $/linear ft install labor — DEFAULT = the LOW end of the band (undercut/value)
const STEPPATH_LABOR_MIN   = 8, STEPPATH_LABOR_MAX = 35;
const STEPPATH_LABOR_BAND  = { lo: 14, hi: 25 };   // national labor-only band (setting stones + decorative rock is labor-intensive)
const STEPPATH_MIN_PER_STONE = 6;    // labor-time model: ~6 min/crew to set + level each stone (× complexity)
const STEPPATH_MIN_PER_SQFT  = 2.5;  // + base prep & rock spreading per sq ft of path (× complexity)

/* Materials — each priced off a GEOMETRY basis (a field on spGeo). lbs = pounds PER basis unit. def = who provides. */
const STEPPATH_MATS = [
  { key:"pavers", label:"Stepping-stone pavers",      unit:"each", cost:8.00,  lbs:90,   basis:"stoneCount", def:"us" },   // ~$8/stone; 24×24 concrete ≈ 90 lb each (pickup weight)
  { key:"marble", label:"Marble rock (joints + border)", unit:"ton", cost:90.00, lbs:2000, basis:"marbleTon",  cf:"marbleCF", bag:true, def:"us" },   // decorative marble, ~$90/ton at the yard (editable); baggable for small jobs
  { key:"base",   label:"Base rock (crushed)",        unit:"ton",  cost:50.00, lbs:2000, basis:"baseTon",    cf:"baseCF",   bag:true, def:"us" },   // compacted base, ~$50/ton; baggable
  { key:"fabric", label:"Underlayment fabric",        unit:"sqft", cost:0.20,  lbs:0.05, basis:"fabricSqft", def:"us" }    // weed/moisture barrier, ~$0.20/sq ft
];

/* spGeo — THE CORE. Pure path geometry → material quantities. No globals, no side effects (node-testable).
   Validated: spGeo({runFt:40,widthFt:3,stoneL:24,stoneW:24,gap:3,borderW:4,rockDepth:2,baseDepth:4,stonesAcross:1,settle:true})
     → stoneCount 17, marbleTon ≈ 0.75, baseTon ≈ 2.53, fabricSqft ≈ 147. */
function spGeo(sp){
  sp = sp || {};
  const DIRT = (typeof DIRT_DENSITY!=="undefined" ? DIRT_DENSITY : 1.35);
  const runFt   = Math.max(0, +sp.runFt || 0);
  const widthFt = Math.max(0, +sp.widthFt || 0);
  const stoneL  = Math.max(1, +sp.stoneL || 24);      // paver length (in)
  const stoneW  = Math.max(1, +sp.stoneW || 24);      // paver width  (in)
  const gap     = Math.max(0, +sp.gap || 0);          // marble gap between stones (in)
  const borderW = Math.max(0, +sp.borderW || 0);      // marble border width per side (in)
  const rockDepth = Math.max(0, +sp.rockDepth || 0);  // legacy single marble depth (fallback for old quotes)
  const jointDepth = Math.max(0, +(sp.jointDepth ?? sp.rockDepth ?? 2));   // marble depth in the joints (in)
  const borderDepth = Math.max(0, +(sp.borderDepth ?? sp.rockDepth ?? 2)); // marble depth on the side borders (in)
  const baseDepth = Math.max(0, +sp.baseDepth || 0);  // compacted base depth (in)
  const baseUnder = sp.baseUnder === "stones" ? "stones" : "full";
  const density = +sp.density > 0 ? +sp.density : STEPPATH_DENSITY_DEF;
  const settle  = !!sp.settle;
  const stonesAcross = Math.max(1, +sp.stonesAcross || 1);
  const pathArea = runFt * widthFt;
  const stonesLen = Math.max(1, Math.floor((runFt*12 + gap) / (stoneL + gap)));
  const stoneCount = stonesLen * stonesAcross;
  const stoneCoverSqft = stoneCount * (stoneL * stoneW) / 144;
  const jointArea = Math.max(0, pathArea - stoneCoverSqft);
  const borderArea = 2 * (borderW/12) * runFt;
  const marbleArea = jointArea + borderArea;
  const settleFactor = settle ? 1 + STEPPATH_SETTLE : 1;
  // marble volume, joints + borders at their own depths (settle factor folded in so a bag count buys the overage too)
  const marbleCF = (jointArea * (jointDepth/12) + borderArea * (borderDepth/12)) * settleFactor;
  const marbleTon = (marbleCF / 27) * density;
  const baseArea = (baseUnder === "full") ? (pathArea + borderArea) : stoneCoverSqft;
  const baseCF   = baseArea * (baseDepth/12);
  const baseTon  = (baseCF / 27) * density;
  const fabricSqft = pathArea + borderArea;
  const spoilCY  = (baseArea * (baseDepth/12)) / 27;   // the dig for the base
  const spoilTon = spoilCY * DIRT;
  return { runFt, widthFt, pathArea, stonesLen, stoneCount, stonesAcross, stoneCoverSqft, jointArea, borderArea,
    marbleArea, marbleCF, marbleTon, jointDepth, borderDepth, baseArea, baseCF, baseTon, fabricSqft, spoilCY, spoilTon, density };
}

/* ---- material helpers (parameterized by the sp state so they're node-testable) ---- */
function spMatNorm(sp){ if(!sp)return; if(!sp.mats)sp.mats={}; STEPPATH_MATS.forEach(m=>{ if(sp.mats[m.key]==null)sp.mats[m.key]=m.def; }); }
function spMats(sp){ return (sp && sp.mats) || {}; }
function spWeProvide(sp,key){ const v=spMats(sp)[key]; const m=STEPPATH_MATS.find(x=>x.key===key); return (v!=null?v:(m?m.def:"us")) === "us"; }
function spMatCost(sp,key){ const o=(sp&&sp.matCosts)||{}; if(o[key]!=null) return o[key]; const m=STEPPATH_MATS.find(x=>x.key===key); return m?m.cost:0; }
function spMatQty(m, geo){ return +geo[m.basis] || 0; }
/* rock materials can be bought bulk (tonnage × $/ton) or in bags (ceil(volCF/bagSize) × $/bag) — small jobs bag better */
function spMatSource(sp,key){ const o=(sp&&sp.matSource)||{}; return o[key]==="bags" ? "bags" : "bulk"; }
function spBagSize(sp,key){ const o=(sp&&sp.bagSize)||{}; return o[key]>0 ? +o[key] : 0.5; }        // cu ft per bag
function spBagPrice(sp,key){ const o=(sp&&sp.bagPrice)||{}; if(o[key]!=null) return +o[key]; return 8.00; }  // $ per bag
/* the material's dollar cost by its chosen source — used in spCalc AND every per-material display so the two never diverge */
function spMatLineCost(sp, key, geo){
  const m = STEPPATH_MATS.find(x=>x.key===key); if(!m) return 0;
  if (m.bag && spMatSource(sp,key)==="bags"){
    const volCF = +geo[m.cf] || 0;
    return Math.max(0, Math.ceil(volCF / spBagSize(sp,key))) * spBagPrice(sp,key);
  }
  return Math.round(spMatQty(m,geo) * spMatCost(sp,key));
}

/* pickup = its own weight-driven run (mirrors fdPickup). Reuses the paver constants + drive helpers. */
function spPickup(geo, sp){
  sp = sp || {};
  const MIL   = (typeof QE!=="undefined"?QE.MILEAGE:0.725);
  const CAP   = (typeof PAVER_LOAD_CAP!=="undefined"?PAVER_LOAD_CAP:4000);
  const HND   = (typeof PAVER_HANDLE_PH_TON!=="undefined"?PAVER_HANDLE_PH_TON:1.3);
  const DEFMI = (typeof PAVER_PICKUP_DEF_MI!=="undefined"?PAVER_PICKUP_DEF_MI:20);
  const RATED = (typeof PAVER_PICKUP_RATE_DEF!=="undefined"?PAVER_PICKUP_RATE_DEF:30);
  const weight = STEPPATH_MATS.reduce((s,m)=> s + (spWeProvide(sp,m.key) ? spMatQty(m,geo)*m.lbs : 0), 0);
  if (weight <= 0) return { has:false, charge:0, cost:0, weight:0, tons:0, trips:0, miles:0, hoursEach:0, personHrs:0, rate:0, crew:0, exact:false, addr:"" };
  const rate = sp.pickupRate || RATED, crew = Math.max(1, sp.pickupCrew || 2);
  let loopMi = DEFMI, exact = false, legBP = null, legPS = null, suspect = false;
  const site = (typeof pvSiteLatLng==="function") ? pvSiteLatLng() : null;
  if (sp.pickupLat!=null && typeof driveFromBase==="function") {
    const bp = driveFromBase(sp.pickupLat, sp.pickupLng);
    let ps = null;
    if (site && typeof roadRouteCached==="function") {
      const psWp = [[sp.pickupLat, sp.pickupLng], [site.lat, site.lng]];
      const psc = roadRouteCached(psWp);
      if (typeof psc === "number") ps = Math.round(psc*10)/10;
      else if (psc !== "none" && typeof roadRouteMiles==="function") roadRouteMiles(psWp, function(mi){ if(mi!=null&&typeof render==="function"){try{render();}catch(e){}} });
    }
    if (bp && ps != null) {
      legBP = bp.miles; legPS = ps;
      const geoLoop = Math.round((bp.miles + ps)*10)/10;
      if (geoLoop > 80 || bp.miles > 60) suspect = true;
      else { loopMi = geoLoop; exact = true; }
    }
  }
  const manual = sp.pickupMiles > 0;
  if (manual) { loopMi = +sp.pickupMiles; exact = true; suspect = false; }
  const trips = Math.max(1, Math.ceil(weight / CAP));
  const driveMin = Math.round(loopMi/35*60);
  const handlePH = (weight/2000) * HND;
  const drivePH  = crew * trips * (driveMin/60);
  const personHrs = handlePH + drivePH;
  const mileage  = Math.round(loopMi * trips * MIL);
  const labor    = personHrs * (rate/0.48);
  const charge   = Math.round((labor + mileage)/5)*5;
  return { has:true, charge, cost:mileage, weight:Math.round(weight), tons:Math.round(weight/2000*10)/10, trips, miles:loopMi, exact, manual, legBP, legPS, suspect, crew, personHrs:Math.round(personHrs*10)/10, hoursEach:Math.round(personHrs/crew*10)/10, rate, addr:sp.pickupAddr||"" };
}

/* spCalc — mirror fdCalc. Price = labor + materials(pass-through) + spoil + drive; cost = materials + spoil +
   drive mileage (+ a dump-run mileage we eat when we haul the spoil). Materials net $0 to profit. */
function spCalc(sp){
  sp = sp || (typeof WZ!=="undefined" && WZ && WZ.sp) || {};
  spMatNorm(sp);
  const geo = spGeo(sp), run = geo.runFt, lft = sp.lft || STEPPATH_LABOR_DEF;
  const MIL    = (typeof QE!=="undefined"?QE.MILEAGE:0.725);
  const LOADED = (typeof QE!=="undefined"?QE.TAKE_HOME/QE.FIELD_SPLIT:93.75);
  const FILL   = (typeof QE!=="undefined"?QE.FILL_TON:45);
  const CD     = (typeof QE!=="undefined"?QE.CD_TON:73.16);
  const FLOOR  = (typeof QE!=="undefined"?QE.MARGIN_FLOOR:0.35);
  const DUMPMI = (typeof DISPOSAL_TRIP_MILES!=="undefined"?DISPOSAL_TRIP_MILES:55);
  const dr = (typeof wizSiteDriveRT==="function") ? wizSiteDriveRT() : {rt:20,min:30};
  const driveCharge = Math.round(dr.rt*MIL + 2*(dr.min/60)*LOADED), driveMileage = Math.round(dr.rt*MIL);
  const cplx = Math.max(1, sp.complexity || 1);   // 1 straight path · 1.25 curves/tie-ins · 1.5 hard access
  const laborPrice = Math.round(run*lft*cplx/25)*25;
  const matCost = STEPPATH_MATS.reduce((s,m)=> s + (spWeProvide(sp,m.key) ? spMatLineCost(sp,m.key,geo) : 0), 0);
  const haul = sp.haulSpoil !== false;
  const spoilRate = sp.spoilType==="cd" ? CD : FILL;
  const spoilCost  = haul ? Math.round(geo.spoilTon*spoilRate) : 0;
  const dumpMileage = haul ? Math.round(DUMPMI*MIL) : 0;
  const materials = matCost + spoilCost;
  const price = laborPrice + materials + driveCharge;
  const cost  = materials + driveMileage + dumpMileage;
  const profit = price - cost, margin = price>0 ? profit/price : 0;
  const allInFt = run>0 ? Math.round(price/run) : 0;
  // labor-time model: set each stone + base prep per sq ft + mobilization; harder access takes longer
  const workMin = Math.round(geo.stoneCount*STEPPATH_MIN_PER_STONE*cplx + geo.pathArea*STEPPATH_MIN_PER_SQFT*cplx) + 120;
  const crew = Math.max(1, sp.crew || 2), totalPH = (workMin/60) + crew*(dr.min/60) + crew*(20/60), hours = crew>0?totalPH/crew:totalPH;
  const fieldPool = Math.max(0, profit)*0.48, perHr = hours>0 ? fieldPool/crew/hours : 0;
  return { geo, run, lft, complexity:cplx, laborPrice, matCost, spoilCost, spoilTon:geo.spoilTon, spoilRate, dumpMileage, haul,
    materials, allInFt, price, cost, driveCharge, driveMileage, dr, crew, hours: Math.round(hours*10)/10, perHr: Math.floor(perHr),
    fieldPool, profit, margin, underFloor: margin < FLOOR };
}

/* MARKET band — national labor-only $/linear-ft (size-tapered) × the OBX premium, plus the pass-through
   materials/drive (cancel in the comparison). Higher per-ft than the French drain — precise stone placement +
   decorative rock is labor-intensive. pay45 = price that clears $45/hr each. */
function spMarketBand(run, baseCost, personHrs, cplx){
  run = Math.max(0, +run || 0); baseCost = +baseCost || 0; personHrs = Math.max(0, +personHrs || 0); cplx = Math.max(1, +cplx || 1);
  const loF = run<25?16:run<75?14:12, hiF = run<25?28:run<75?25:22;   // national $12–28/ft, small jobs richer per ft
  const labLo = Math.max(loF*run, 500)*cplx, labHi = Math.max(hiF*run, 750)*cplx;
  const r5 = n => Math.round(n/5)*5, OBX = (typeof PAVER_OBX_PREMIUM!=="undefined"?PAVER_OBX_PREMIUM:1.22), TGT = (typeof QE!=="undefined"?QE.TAKE_HOME:45);
  return { natLo:r5(labLo+baseCost), natHi:r5(labHi+baseCost), obxLo:r5(labLo*OBX+baseCost), obxHi:r5(labHi*OBX+baseCost), pay45:r5(TGT*personHrs/0.48+baseCost) };
}

function spItem(c){
  const sp = (typeof WZ!=="undefined"&&WZ&&WZ.sp) || {};
  const g = c.geo;
  const ours   = STEPPATH_MATS.filter(m=>spWeProvide(sp,m.key)).map(m=>m.label.toLowerCase());
  const theirs = STEPPATH_MATS.filter(m=>!spWeProvide(sp,m.key)).map(m=>m.label.toLowerCase());
  const spoilTxt = !c.haul ? "leave/spread the spoil on site (no haul-off — $0)" : (c.spoilRate>=60?"excavate & haul the spoil to the dump (C&D)":"excavate & haul the spoil off (clean fill)");
  const notes = [
    "Stepping-stone path — excavate & compact a base, lay fabric, set the pavers, fill the "+sp.gap+"″ joints + "+sp.borderW+"″ side border with marble rock, "+spoilTxt+".",
    "Labor (the install): $"+c.lft+"/linear ft · "+c.crew+"-person crew"+(c.complexity>1?" · ×"+c.complexity+" (curves/access)":"")+".",
    "Materials at COST, no markup — we provide: "+(ours.length?ours.join(", "):"none")+(theirs.length?("; customer provides: "+theirs.join(", ")):".")+" ~"+g.stoneCount+" stones · ~"+(Math.round(g.marbleTon*100)/100)+" ton marble · ~"+(Math.round(g.baseTon*100)/100)+" ton base · ~"+Math.round(g.fabricSqft)+" sq ft fabric."
  ];
  return { serviceId:"", name:"Stepping-stone path — install", unit:"job", price:c.price, qty:1, cost:c.cost, notes:notes, bandKey:"steppath",
    breakdown:[ c.run+" ft × "+sp.widthFt+" ft · "+sp.stoneL+"×"+sp.stoneW+"″ stones ("+g.stoneCount+") · "+sp.gap+"″ gap · "+sp.borderW+"″ border · $"+c.lft+"/ft" ] };
}
function spPickupItem(pk){
  return { serviceId:"", name:"Materials pickup & delivery ("+pk.crew+"-person run)", unit:"job", price:pk.charge, qty:1, cost:pk.cost, bandKey:"steppath", _pickup:true, estHours:pk.hoursEach, estCrew:pk.crew,
    notes:["Haul OUR materials (pavers, marble rock, base, fabric) from "+(pk.addr||"the supplier")+" → the site, then unload.",
      "~"+pk.tons+" ton ("+pk.weight+" lb) · "+pk.trips+" trip(s) · "+pk.crew+" people × ~"+pk.hoursEach+" hr — heavy manual handling.",
      "Customer-service rate $"+pk.rate+"/hr each (softer than install). Customer can provide/haul the materials to skip this."],
    breakdown:[ pk.weight+" lb · "+pk.trips+" trip(s) · "+pk.crew+" × ~"+pk.hoursEach+" hr @ $"+pk.rate+"/hr" ] };
}

function spDefaults(){
  return { runFt:20, widthFt:3, stoneL:24, stoneW:24, gap:3, borderW:4, rockDepth:2, jointDepth:2, borderDepth:2, baseDepth:4, baseUnder:"full",
    density:STEPPATH_DENSITY_DEF, settle:true, stonesAcross:1, lft:STEPPATH_LABOR_DEF, crew:2, complexity:1, mats:{}, matCosts:{},
    matSource:{}, bagSize:{}, bagPrice:{},
    haulSpoil:true, spoilType:"fill", pickupAddr:"", pickupLat:null, pickupLng:null,
    pickupRate:(typeof PAVER_PICKUP_RATE_DEF!=="undefined"?PAVER_PICKUP_RATE_DEF:30), pickupCrew:2, pickupMiles:0 };
}

window.wizStepPathStart = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  if (!WZ._spFromSave || !WZ.sp) WZ.sp = spDefaults();
  spMatNorm(WZ.sp);
  WZ.svc = "steppath"; WZ.disc = 0; WZ.discPct = null;
  WZ.step = "calc"; if (typeof render==="function") render();
};
window.openStepPathEst = window.wizStepPathStart;

/* Change-order: re-open the full builder for a saved quote. Uses the saved WZ.sp if present; else reconstruct
   the path + labor + who-supplies from the saved line so old quotes are still fully editable. */
window.wizStepPathEdit = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  const it = WZ.items && WZ.items[0];
  if (!WZ._spFromSave && it) {
    if (!WZ.sp) WZ.sp = spDefaults();
    const bd = [].concat(it.breakdown||[]).join(" "), nt = [].concat(it.notes||[]).join(" ");
    const dim = /(\d+(?:\.\d+)?)\s*ft\s*×\s*(\d+(?:\.\d+)?)\s*ft\s*·\s*(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)″\s*stones[^·]*·\s*(\d+(?:\.\d+)?)″\s*gap\s*·\s*(\d+(?:\.\d+)?)″\s*border/.exec(bd);
    if (dim) { WZ.sp.runFt=+dim[1]; WZ.sp.widthFt=+dim[2]; WZ.sp.stoneL=+dim[3]; WZ.sp.stoneW=+dim[4]; WZ.sp.gap=+dim[5]; WZ.sp.borderW=+dim[6]; }
    const lf = /\$(\d+(?:\.\d+)?)\/ft/.exec(bd); if (lf) WZ.sp.lft=+lf[1];
    const cr = /(\d+)-person crew/.exec(nt); if (cr) WZ.sp.crew=Math.max(1,Math.min(4,+cr[1]));
    WZ.sp.haulSpoil = !/leave\/spread the spoil/.test(nt);
    WZ.sp.spoilType = /haul the spoil to the dump/.test(nt) ? "cd" : "fill";
    const theirs = ((/customer provides:\s*([^.]+)/i.exec(nt)||[])[1]||"").toLowerCase();
    if (!WZ.sp.mats) WZ.sp.mats = {};
    STEPPATH_MATS.forEach(m => { WZ.sp.mats[m.key] = theirs.indexOf(m.label.toLowerCase())>=0 ? "them" : "us"; });
  }
  spMatNorm(WZ.sp);
  WZ.svc = "steppath"; WZ.step = "calc"; if (typeof render==="function") render();
};

/* ---- little UI helpers (mirror the FD ones, sp-namespaced) ---- */
function spCrewBtns(cur, fn){ return (typeof pvCrewBtns==="function") ? pvCrewBtns(cur, fn) : [1,2,3,4].map(n=>`<button class="btn ${cur===n?"acc":"ghost"} sm" style="flex:0 0 auto;min-width:34px;padding:4px 0" onclick="${fn}(${n})">${n}</button>`).join(""); }
function spCplxBtns(cur){ return [[1,"─ Straight path"],[1.25,"Curves & tie-ins"],[1.5,"Hard access"]].map(o=>`<button class="btn ${cur===o[0]?"acc":"ghost"} sm" style="flex:1 1 0;padding:5px 4px;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizSpComplexity(${o[0]})">${o[1]}</button>`).join(""); }
function spTier(perHr){ const TGT=(typeof QE!=="undefined"?QE.TAKE_HOME:45), CF=(typeof QE!=="undefined"?QE.CREW_FLOOR:30); return perHr>=TGT?2 : perHr>=CF?1 : 0; }
function spPayNote(tier){ return tier===2?'<span style="color:var(--accent)">✓ Clears your $45/hr floor.</span>':tier===1?'<span style="color:#b8860b">🟡 Below $45 but clears the $30/hr crew floor — good for Chase/Pierce.</span>':'<span style="color:var(--danger)">🔴 Below the $30/hr crew floor — slide up.</span>'; }
function spMarginNote(c){ const pct=Math.round(c.margin*100); return `Cost ${money(c.cost)} · profit ${money(c.profit)} · <b>margin ${pct}%</b>${c.underFloor?' <span style="color:var(--danger);font-weight:700">⚠ under the 35% floor — raise the price or drop a we-provide material</span>':' <span style="color:#1a7f37">✓ clears the 35% floor</span>'}`; }

function spPickupInfoHTML(pk){
  if (!pk.has) return "";
  const ex = (pk.exact||pk.suspect) ? "" : ` <span style="color:#b8860b">— est.; add the supplier address for exact</span>`;
  const legs = (!pk.manual && !pk.suspect && pk.legBP!=null && pk.legPS!=null) ? `base→supplier ${pk.legBP} mi + supplier→site ${pk.legPS} mi = ` : "";
  const milesTxt = pk.manual ? `${pk.miles} mi (you set it)` : pk.suspect ? `~${pk.miles} mi (estimate)` : `${legs}${pk.miles} mi`;
  const warn = (pk.suspect && !pk.manual) ? `<div class="sub" style="color:var(--danger);margin-top:2px">⚠ The geocoder put the supplier <b>${pk.legBP} mi</b> away — that's wrong. Type the real miles below.</div>` : "";
  const override = `<div class="row" style="gap:6px;align-items:center;margin-top:5px"><div class="grow sub">${pk.manual?'✓ <b>Using your miles</b>':'Drive off? Set the run miles'} <span style="opacity:.7">(base→supplier→site)</span>:</div><input type="number" inputmode="decimal" value="${pk.manual?pk.miles:''}" placeholder="auto ${pk.miles}" style="width:72px;padding:3px 6px;font-size:13px" onchange="wizSpPickMiles(this.value)"><span class="sub">mi</span></div>`;
  const tip = pk.trips>=2 ? `<div class="sub" style="color:#b8860b;margin-top:4px">💡 ${pk.trips} trips / ${pk.tons} ton — having the yard <b>deliver</b> usually beats self-haul once it's 2+ trips.</div>` : "";
  return `<div class="row" style="gap:6px;align-items:center;margin-bottom:4px"><div class="grow sub">Pickup crew</div>${spCrewBtns(pk.crew,"wizSpPickCrew")}</div>⚖️ ~${pk.tons} ton (${pk.weight} lb) · ${pk.trips} trip(s) · ${pk.crew} × ~${pk.hoursEach} hr<br>🚗 ${milesTxt}${pk.trips>1?` × ${pk.trips} trips`:""}${ex}: mileage <b>${money(pk.cost)}</b>${warn}${override}<br><div class="row" style="justify-content:space-between;align-items:baseline;margin-top:4px"><div>Pickup charge <b>${money(pk.charge)}</b></div><div class="sub">each takes home <b>$${pk.rate}/hr</b></div></div><input type="range" min="${(typeof PAVER_PICKUP_RATE_MIN!=="undefined"?PAVER_PICKUP_RATE_MIN:20)}" max="${(typeof PAVER_PICKUP_RATE_MAX!=="undefined"?PAVER_PICKUP_RATE_MAX:45)}" step="1" value="${pk.rate}" oninput="wizSpPickRate(this.value)" style="width:100%;accent-color:#b8860b;margin-top:4px">${tip}`;
}

function spBreakHTML(c, pk){
  let s = `<div style="font-size:13px;line-height:1.9">🔨 Labor: ${c.run} ft × $${c.lft}/ft${c.complexity>1?` × ${c.complexity} (access)`:""} (${c.crew} crew): <b>${money(c.laborPrice)}</b><br>🪨 Materials — pass-through at cost: <b>+${money(c.materials)}</b> <span class="sub">(our materials ${money(c.matCost)}${c.spoilCost>0?` + spoil haul ${money(c.spoilCost)}`:""})</span><br>🚗 Drive — static (~${c.dr.rt} mi RT): <b>+${money(c.driveCharge)}</b>`;
  if (pk && pk.has) s += `<br>🚚 Materials pickup (own line, ${pk.crew}-person @ $${pk.rate}/hr): <b>+${money(pk.charge)}</b>`;
  s += `<br><span class="sub">Materials net <b>$0</b> to you (pass-through) — profit ${money(c.profit)} is labor + drive${c.dumpMileage>0?` (minus the ${money(c.dumpMileage)} dump-run miles)`:""}.</span></div>`;
  return s;
}

function wizStepPathUI(){
  if (!WZ.sp) wizStepPathStart();
  spMatNorm(WZ.sp);
  const sp = WZ.sp, c = spCalc(sp), geo = c.geo, pk = spPickup(geo, sp);
  const items = [ spItem(c) ]; if (pk.has) items.push(spPickupItem(pk));
  items[0].mkt = spMarketBand(c.run, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity);
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;
  const total = c.price + (pk.has ? pk.charge : 0);
  const tier = spTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const lo = STEPPATH_LABOR_MIN, hi = STEPPATH_LABOR_MAX;

  let h = `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">🪨 Stepping-stone path</div><div class="nm" style="font-size:18px">One-page quote</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;
  if (WZ.cust && WZ.cust.name) h += `<div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(WZ.cust.name)}</div>${WZ.cust.address?`<div class="sub">${esc(WZ.cust.address)}</div>`:""}<button class="btn ghost sm" style="margin-top:6px" onclick="WZ.step='cust';render()">↩ Change customer / property</button></div>`;
  // path dimensions
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🚶 The path</div><div class="row" style="gap:8px">
    <div class="grow"><label style="margin-top:0">Length (linear ft)</label><input type="number" inputmode="decimal" value="${sp.runFt}" min="1" onchange="wizSpField('runFt',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Width (ft)</label><input type="number" inputmode="decimal" value="${sp.widthFt}" min="0.5" step="0.5" onchange="wizSpField('widthFt',this.value)"></div></div>
    <div class="row" style="gap:8px;margin-top:6px">
    <div class="grow"><label style="margin-top:0">Stone length (in)</label><input type="number" inputmode="decimal" value="${sp.stoneL}" min="1" onchange="wizSpField('stoneL',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Stone width (in)</label><input type="number" inputmode="decimal" value="${sp.stoneW}" min="1" onchange="wizSpField('stoneW',this.value)"></div>
    <div style="align-self:flex-end;padding-bottom:8px;font-weight:800">×${sp.stonesAcross}</div></div>
    <div class="row" style="gap:8px;margin-top:6px">
    <div class="grow"><label style="margin-top:0">Marble gap (in)</label><input type="number" inputmode="decimal" value="${sp.gap}" min="0" onchange="wizSpField('gap',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Marble border / side (in)</label><input type="number" inputmode="decimal" value="${sp.borderW}" min="0" onchange="wizSpField('borderW',this.value)"></div></div>
    <div class="row" style="gap:8px;margin-top:6px">
    <div class="grow"><label style="margin-top:0">Marble depth · joints (in)</label><input type="number" inputmode="decimal" value="${geo.jointDepth}" min="0" onchange="wizSpField('jointDepth',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Marble depth · sides (in)</label><input type="number" inputmode="decimal" value="${geo.borderDepth}" min="0" onchange="wizSpField('borderDepth',this.value)"></div></div>
    <div class="row" style="gap:8px;margin-top:6px">
    <div class="grow"><label style="margin-top:0">Base depth (in)</label><input type="number" inputmode="decimal" value="${sp.baseDepth}" min="0" onchange="wizSpField('baseDepth',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Stones across</label><input type="number" inputmode="numeric" value="${sp.stonesAcross}" min="1" step="1" onchange="wizSpField('stonesAcross',this.value)"></div></div>
    <div class="row" style="gap:6px;margin-top:8px"><button class="btn ${sp.baseUnder!=='stones'?'acc':'ghost'} sm" style="flex:1 1 0;font-size:11.5px" onclick="wizSpBaseUnder('full')">Base under whole path</button><button class="btn ${sp.baseUnder==='stones'?'acc':'ghost'} sm" style="flex:1 1 0;font-size:11.5px" onclick="wizSpBaseUnder('stones')">Base under stones only</button></div>
    <div class="row" style="gap:8px;margin-top:6px"><div class="grow"><label style="margin-top:0">Rock density (t/cy)</label><input type="number" inputmode="decimal" step="0.05" value="${sp.density}" min="1" onchange="wizSpField('density',this.value)"></div>
    <div class="toggle" style="align-self:flex-end;padding-bottom:6px"><input type="checkbox" id="sp_settle" ${sp.settle?"checked":""} onchange="wizSpSettle(this.checked)"><label style="margin:0">+10% settling</label></div></div></div>`;
  // HERO tonnage
  h += `<div class="card" style="text-align:center;border:2px solid var(--accent)"><div style="font-size:12px;font-weight:700;color:var(--muted)">ORDER FROM THE YARD</div><div style="font-size:26px;font-weight:800;line-height:1.15;color:var(--accent)">${geo.stoneCount} stones · ≈ ${Math.round(geo.marbleTon*100)/100} t marble</div><div style="font-size:13px;font-weight:700">+ ${Math.round(geo.baseTon*100)/100} t base rock${sp.settle?" · +10% settle":""}</div><div class="sub" style="margin-top:2px">fabric ~${Math.round(geo.fabricSqft)} sq ft · path ${Math.round(geo.pathArea)} sq ft · spoil ~${Math.round(geo.spoilTon*10)/10} ton (${Math.round(geo.spoilCY*100)/100} cy) dug out</div></div>`;
  // ground / access complexity
  h += `<div class="card" style="padding:10px"><div class="grow" style="margin-bottom:6px"><b>Ground / access</b> <span class="sub">curves, tie-ins &amp; tight access = more layout + labor</span></div><div class="row" style="gap:6px">${spCplxBtns(c.complexity)}</div>${c.complexity>1?`<div class="sub" style="margin-top:6px;color:#b8860b">+${Math.round((c.complexity-1)*100)}% on labor time &amp; price.</div>`:""}</div>`;
  // materials
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🪨 Materials — who provides each? <span class="sub" style="font-weight:400">we = pass-through at cost</span></div>`;
  h += STEPPATH_MATS.map(m=>{
    const we = spWeProvide(sp,m.key), u = m.unit==="ton"?"ton":m.unit==="each"?"ea":"sq ft"; const step = m.unit==="sqft"?"0.05":m.unit==="ton"?"5":"0.5";
    let inner;
    if (!we) { inner = `<span class="sub">customer provides</span>`; }
    else {
      const cost = spMatCost(sp,m.key), qty = spMatQty(m,geo);
      const bulkInput = `$<input type="number" inputmode="decimal" value="${cost}" step="${step}" min="0" style="width:58px;display:inline-block;padding:2px 5px;font-size:13px" onchange="wizSpMatCost('${m.key}',this.value)">/${u} <span class="sub">≈ ${Math.round(qty*100)/100} ${u} = ${money(spMatLineCost(sp,m.key,geo))}</span>`;
      if (m.bag) {
        const src = spMatSource(sp,m.key);
        const toggle = `<div class="row" style="gap:4px;margin:3px 0">${[["bulk","Bulk"],["bags","Bags"]].map(o=>`<button class="btn ${src===o[0]?"acc":"ghost"} sm" style="flex:0 0 auto;padding:2px 10px;font-size:11.5px" onclick="wizSpMatSource('${m.key}','${o[0]}')">${o[1]}</button>`).join("")}</div>`;
        if (src==="bags") {
          const bs = spBagSize(sp,m.key), bp = spBagPrice(sp,m.key), volCF = +geo[m.cf] || 0, bags = Math.max(0, Math.ceil(volCF/bs));
          inner = toggle + `<span class="sub">bag </span><input type="number" inputmode="decimal" value="${bs}" step="0.05" min="0.05" style="width:52px;display:inline-block;padding:2px 5px;font-size:13px" onchange="wizSpBagSize('${m.key}',this.value)"><span class="sub"> cu ft · $</span><input type="number" inputmode="decimal" value="${bp}" step="0.5" min="0" style="width:52px;display:inline-block;padding:2px 5px;font-size:13px" onchange="wizSpBagPrice('${m.key}',this.value)"><span class="sub">/bag · ≈ ${bags} bags = ${money(spMatLineCost(sp,m.key,geo))}</span>`;
        } else { inner = toggle + bulkInput; }
      } else { inner = bulkInput; }
    }
    return `<div class="row" style="gap:6px;align-items:center;margin-bottom:5px"><div class="grow"><b>${m.label}</b> ${inner}</div>${[["us","We get it"],["them","They provide"]].map(o=>`<button class="btn ${spMats(sp)[m.key]===o[0]?"acc":"ghost"} sm" style="flex:0 0 auto" onclick="wizSpMat('${m.key}','${o[0]}')">${o[1]}</button>`).join("")}</div>`;
  }).join("");
  // spoil 3-way
  const _st = sp.spoilType==="cd"?"cd":"fill", _haul = sp.haulSpoil !== false;
  h += `<div style="border-top:1px solid var(--line);margin:8px 0 2px;padding-top:8px"><div class="grow" style="margin-bottom:4px"><b>🟫 Excavated spoil</b> <span class="sub">~${Math.round(geo.spoilTon*10)/10} ton dug out (base)</span></div><div class="row" style="gap:6px">
    <button class="btn ${!_haul?"acc":"ghost"} sm" style="flex:1 1 0;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizSpSpoil('leave')">Leave / spread<br><span class="sub">$0</span></button>
    <button class="btn ${_haul&&_st==="fill"?"acc":"ghost"} sm" style="flex:1 1 0;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizSpSpoil('fill')">Haul — clean fill<br><span class="sub">$45/ton</span></button>
    <button class="btn ${_haul&&_st==="cd"?"acc":"ghost"} sm" style="flex:1 1 0;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizSpSpoil('cd')">Haul — C&amp;D<br><span class="sub">$73.16/ton</span></button></div>
    ${_haul?`<div class="sub" style="margin-top:4px">Haul-off ${money(c.spoilCost)} (pass-through) + ~${money(c.dumpMileage)} dump-run miles.</div>`:`<div class="sub" style="margin-top:4px;color:var(--accent)">Customer keeps the dirt — no haul-off.</div>`}</div>`;
  h += `<div class="sub" style="margin-top:6px">Defaults are real-price estimates — change any to the actual yard price. Your labor price never changes with these.</div></div>`;
  // pickup mini-quote
  if (pk.has) h += `<div class="card" style="border-left:4px solid #b8860b"><div style="font-weight:800;margin-bottom:4px">🚚 Materials pickup — its own run</div>
    <label style="margin-top:0">Where are we picking up?</label>
    <div class="acwrap"><input id="sp_pickaddr" value="${esc(sp.pickupAddr||"")}" placeholder="Supplier address…" autocomplete="off" oninput="addrSuggest('sp_pickaddr','sp_pickbox')" onchange="wizSpGeoPickup(this.value)"><div class="acbox" id="sp_pickbox"></div></div>
    <div id="sp_pickinfo" style="margin-top:6px;white-space:normal;font-size:13px;line-height:1.8">${spPickupInfoHTML(pk)}</div></div>`;
  // LABOR slider + crew + band + pay check + MARGIN/FLOOR
  h += `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:baseline"><div class="nm" style="font-size:28px" id="sp_price">${money(total)}</div><div style="text-align:right"><div class="nm" style="font-size:18px" id="sp_rate">$${c.lft}/ft labor</div><div class="sub" id="sp_allin">install ${money(c.price)}${pk.has?` + pickup ${money(pk.charge)}`:""}</div></div></div>
    <input type="range" min="${lo}" max="${hi}" step="0.5" value="${sp.lft}" oninput="wizSpLft(this.value)" style="width:100%;accent-color:var(--accent);margin-top:8px">
    <div class="sub" style="font-size:11px">Labor band $${STEPPATH_LABOR_BAND.lo}–$${STEPPATH_LABOR_BAND.hi}/ft · range $${lo}–$${hi}. Default sits at the low end (undercut/value) — price to the market.</div>
    <div id="sp_mktband" style="margin-top:6px">${(typeof pvBandHTML==="function"&&items[0].mkt)?pvBandHTML(items[0].mkt,total):""}</div>
    <div class="row" style="gap:6px;align-items:center;margin-top:8px"><div class="grow sub">Install crew</div>${spCrewBtns(c.crew,"wizSpCrew")}</div>
    <div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px"><div class="row" style="gap:14px;flex-wrap:wrap"><div class="grow"><div class="sub" id="sp_hrs">Install: ${c.crew} people × ~${c.hours} hr each</div><div class="sub">excavate + set stones + rock + drive</div></div><div class="grow" style="text-align:right"><div class="sub">Per hour each</div><div class="nm" style="font-size:20px;color:${tCol}" id="sp_payhr">${money(c.perHr)}/hr ${tIcon}</div></div></div>
    <div class="sub" id="sp_paynote" style="margin-top:4px">${spPayNote(tier)}</div>
    <div class="sub" id="sp_margin" style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px">${spMarginNote(c)}</div></div></div>`;
  h += `<div class="card" id="sp_break">${spBreakHTML(c, pk)}</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="wizPrint()">🖨 Print / PDF</button><button class="btn ghost grow" onclick="wizCopy()">Copy text</button></div>`;
  h += `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b id="sp_foot">${money(total)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Services</button><button class="btn acc grow" onclick="wizFinish()">Save &amp; present →</button></div>`;
  return h;
}

/* ---- live handlers ---- */
window.wizSpField = function (k, v) { if (!WZ.sp) return; WZ.sp[k] = Math.max(0, parseFloat(v)||0); render(); };
window.wizSpSettle = function (v) { if (!WZ.sp) return; WZ.sp.settle = !!v; render(); };
window.wizSpBaseUnder = function (v) { if (!WZ.sp) return; WZ.sp.baseUnder = (v==="stones")?"stones":"full"; render(); };
window.wizSpMat = function (key, v) { if (!WZ.sp) return; if (!WZ.sp.mats) WZ.sp.mats = {}; WZ.sp.mats[key] = v; render(); };
window.wizSpMatCost = function (key, v) { if (!WZ.sp) return; if (!WZ.sp.matCosts) WZ.sp.matCosts = {}; WZ.sp.matCosts[key] = Math.max(0, parseFloat(v)||0); render(); };
window.wizSpMatSource = function (key, v) { if (!WZ.sp) return; if (!WZ.sp.matSource) WZ.sp.matSource = {}; WZ.sp.matSource[key] = (v==="bags")?"bags":"bulk"; render(); };
window.wizSpBagSize = function (key, v) { if (!WZ.sp) return; if (!WZ.sp.bagSize) WZ.sp.bagSize = {}; WZ.sp.bagSize[key] = Math.max(0.05, parseFloat(v)||0.5); render(); };
window.wizSpBagPrice = function (key, v) { if (!WZ.sp) return; if (!WZ.sp.bagPrice) WZ.sp.bagPrice = {}; WZ.sp.bagPrice[key] = Math.max(0, parseFloat(v)||0); render(); };
window.wizSpSpoil = function (mode) { if (!WZ.sp) return; if (mode==="leave") { WZ.sp.haulSpoil = false; } else { WZ.sp.haulSpoil = true; WZ.sp.spoilType = (mode==="cd")?"cd":"fill"; } render(); };
window.wizSpCrew = function (n) { if (!WZ.sp) return; WZ.sp.crew = Math.max(1, n); render(); };
window.wizSpComplexity = function (v) { if (!WZ.sp) return; WZ.sp.complexity = Math.max(1, +v || 1); render(); };
window.wizSpPickCrew = function (n) { if (!WZ.sp) return; WZ.sp.pickupCrew = Math.max(1, n); render(); };
window.wizSpPickMiles = function (v) { if (!WZ.sp) return; const n = parseFloat(v); WZ.sp.pickupMiles = (n>0) ? n : 0; if (typeof render==="function") render(); };
window.wizSpGeoPickup = function (addr) {
  if (!WZ.sp) return; WZ.sp.pickupAddr = addr;
  if (!addr) { WZ.sp.pickupLat = null; WZ.sp.pickupLng = null; if (typeof render==="function") render(); return; }
  const inp = document.getElementById("sp_pickaddr");
  if (inp && inp.dataset && inp.dataset.pickLat) {
    WZ.sp.pickupLat = +inp.dataset.pickLat; WZ.sp.pickupLng = +inp.dataset.pickLng;
    delete inp.dataset.pickLat; delete inp.dataset.pickLng;
    if (typeof render==="function") render(); return;
  }
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(addr))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d[0]) { WZ.sp.pickupLat = +d[0].lat; WZ.sp.pickupLng = +d[0].lon; } if (typeof render==="function") render(); })
    .catch(function () { if (typeof render==="function") render(); });
};
window.wizSpPickRate = function (v) {
  if (!WZ.sp) return; WZ.sp.pickupRate = parseInt(v,10) || (typeof PAVER_PICKUP_RATE_DEF!=="undefined"?PAVER_PICKUP_RATE_DEF:30);
  const c = spCalc(WZ.sp), pk = spPickup(c.geo, WZ.sp);
  const items = [ spItem(c) ]; if (pk.has) items.push(spPickupItem(pk)); items[0].mkt = spMarketBand(c.run, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity); WZ.items = items;
  const total = c.price + (pk.has ? pk.charge : 0);
  const info = document.getElementById("sp_pickinfo"); if (info) info.innerHTML = spPickupInfoHTML(pk);
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("sp_price", money(total)); set("sp_foot", money(total)); set("sp_allin", "install "+money(c.price)+(pk.has?" + pickup "+money(pk.charge):""));
  const br=document.getElementById("sp_break"); if(br)br.innerHTML=spBreakHTML(c, pk);
  const mb=document.getElementById("sp_mktband"); if(mb&&typeof pvBandHTML==="function")mb.innerHTML=pvBandHTML(items[0].mkt,total);
  if(typeof wizAutosave==="function")wizAutosave();
};
window.wizSpLft = function (v) {
  if (!WZ.sp) return; WZ.sp.lft = parseFloat(v) || STEPPATH_LABOR_DEF;
  const c = spCalc(WZ.sp), pk = spPickup(c.geo, WZ.sp);
  const items = [ spItem(c) ]; if (pk.has) items.push(spPickupItem(pk)); items[0].mkt = spMarketBand(c.run, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity);
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;
  const total = c.price + (pk.has ? pk.charge : 0);
  const tier = spTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("sp_price", money(total)); set("sp_foot", money(total)); set("sp_rate", "$"+c.lft+"/ft labor"); set("sp_allin", "install "+money(c.price)+(pk.has?" + pickup "+money(pk.charge):""));
  set("sp_payhr", money(c.perHr)+"/hr "+tIcon); const ph=document.getElementById("sp_payhr"); if(ph)ph.style.color=tCol;
  const mb=document.getElementById("sp_mktband"); if(mb&&typeof pvBandHTML==="function")mb.innerHTML=pvBandHTML(items[0].mkt,total);
  const pn=document.getElementById("sp_paynote"); if(pn)pn.innerHTML=spPayNote(tier);
  const mg=document.getElementById("sp_margin"); if(mg)mg.innerHTML=spMarginNote(c);
  const br=document.getElementById("sp_break"); if(br)br.innerHTML=spBreakHTML(c, pk);
  if(typeof wizAutosave==="function")wizAutosave();
};

/* node export (tests) — browser ignores this; top-level touches no browser globals */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { spGeo, spCalc, spMarketBand, spPickup, spMatNorm, spWeProvide, spMatCost, spMatLineCost,
    spMatSource, spBagSize, spBagPrice, STEPPATH_MATS, STEPPATH_DENSITY_DEF, STEPPATH_SETTLE, STEPPATH_LABOR_DEF };
}
