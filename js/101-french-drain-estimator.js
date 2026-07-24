/* ---------- FRENCH DRAIN / TRENCH DRAIN — ONE-PAGE QUOTE MACHINE ----------
   Mirrors the paver estimator (js/69) BEAT-FOR-BEAT. PRICING MODEL (Ray):
   - PRICE = LABOR only. The $/linear-ft slider + market band are the worth of the INSTALL (dig + lay +
     backfill), never the materials.
   - EVERY material is its own selector + its own EDITABLE price. Customer provides it, or we do; when WE do
     it's a PURE PASS-THROUGH (at cost, zero margin) → toggling one moves price + cost equally, labor profit
     unchanged. #57 drainage rock is weight-driven (tons from the trench cross-section), fabric is $/sq ft,
     perf pipe is $/linear ft (OFF by default), decorative cap rock defaults to CUSTOMER-provides (Ray's marble).
   - EXCAVATED SPOIL (the dug-out dirt) is a 3-way: leave/spread ($0), haul clean-fill ($45/ton + a dump run),
     or haul C&D ($73.16/ton + a dump run). Ray usually HAULS → haul-off is the default.
   - PICKUP is its own weight-driven mini-quote → a real sub-job (pvPickup pattern, softer rate). All editable.
   Cost / Price / Profit / Margin shown with the 35% margin-floor warning. Reference job that calibrated it:
   67 ft × 7.5" wide × 12" deep, 2" decorative cap, 1.4 t/cy, +10% settling → ~1.29 cy → ~2.0 tons #57. */

if (typeof window === "undefined") { var window = {}; }   // node test shim (browser: no-op — window already global)

const PIPE_SQIN         = 12.57;   // cross-section of a 4" perforated pipe (π·r², r=2") — displaces this much rock
const DIRT_DENSITY      = 1.35;    // t/cy of the dug-out native spoil (dirt/sand mix)
const FABRIC_WRAP       = 1.0;     // non-woven fabric wrap factor: 1.0 = bottom + 2 walls (Ray). Bump to ~1.15 for a full burrito wrap.
const FDRAIN_DENSITY_DEF = 1.4;    // t/cy of #57 washed drainage stone (editable per quote)
const FDRAIN_SETTLE     = 0.10;    // +10% stone for settling/compaction (toggle)
const FDRAIN_LABOR_DEF  = 12;      // $/linear ft install labor (dig + lay + backfill)
const FDRAIN_LABOR_MIN  = 6, FDRAIN_LABOR_MAX = 30;
const FDRAIN_LABOR_BAND = { lo: 9, hi: 18 };
const FDRAIN_MIN_PER_FT = 4;       // labor-time model: ~4 min of crew work per linear ft (× complexity) + mobilization

/* Materials — each priced off a GEOMETRY basis (a field on fdGeo): rockTon, fabricSF, pipeFt, capTon.
   lbs = pounds PER basis unit (rockTon×2000 = the real weight). def = who provides by default. */
const FDRAIN_MATS = [
  { key:"rock",  label:"#57 drainage rock",   unit:"ton",  cost:50.00, lbs:2000, basis:"rockTon",  def:"us"   },   // we provide + haul, $50/ton at the yard (Ray)
  { key:"fabric",label:"Filter fabric (non-woven)", unit:"sqft", cost:0.30, lbs:0.05, basis:"fabricSF", def:"us" },
  { key:"pipe",  label:"4\" perforated pipe",  unit:"ft",   cost:1.25,  lbs:0.3,  basis:"pipeFt",   def:"us"   },   // only counts when the pipe toggle is ON (pipeFt=0 otherwise)
  { key:"deco",  label:"Decorative cap rock",  unit:"ton",  cost:0.00,  lbs:2000, basis:"capTon",   def:"cust" }    // customer-provides by default (Ray's marble)
];

/* fdGeo — THE CORE. Pure trench geometry → material quantities. No globals, no side effects (node-testable).
   Validated: fdGeo({run:67,width:7.5,depth:12,cap:2,pipe:false,density:1.4,settle:true})
     → rockCY≈1.29, rockTon≈1.99 (settle) / 1.81 (no settle), fabricSF≈176, spoilCY≈1.55. */
function fdGeo(fd){
  fd = fd || {};
  const run  = Math.max(0, +fd.run || 0);
  const W    = Math.max(0, +fd.width || 0) / 12;      // trench width  → ft
  const D    = Math.max(0, +fd.depth || 0) / 12;      // trench depth  → ft
  const C    = Math.min(D, Math.max(0, +fd.cap || 0) / 12);   // decorative cap depth → ft (can't exceed total depth)
  const density = +fd.density > 0 ? +fd.density : FDRAIN_DENSITY_DEF;
  const settle  = !!fd.settle;
  const rockD = Math.max(0, D - C);                   // rock fills from the bottom up to the cap
  const xPipe = fd.pipe ? PIPE_SQIN / 144 : 0;        // pipe cross-section (sq ft) DISPLACES rock
  const rockCF  = Math.max(0, (W * rockD - xPipe)) * run;
  const rockCY  = rockCF / 27;
  const rockTon = rockCY * density * (settle ? 1 + FDRAIN_SETTLE : 1);
  const capCY   = (W * C * run) / 27;
  const capTon  = capCY * density;
  const spoilCY = (W * D * run) / 27;                 // the whole trench is dug out
  const spoilTon = spoilCY * DIRT_DENSITY;
  const pipeFt   = fd.pipe ? run : 0;
  const fabricSF = run * (W + 2 * D) * FABRIC_WRAP;   // bottom + 2 walls
  return { run, rockD, rockCY, rockTon, capTon, capCY, spoilTon, spoilCY, pipeFt, fabricSF };
}

/* ---- material helpers (parameterized by the fd state so they're node-testable) ---- */
function fdMatNorm(fd){ if(!fd)return; if(!fd.mats)fd.mats={}; FDRAIN_MATS.forEach(m=>{ if(fd.mats[m.key]==null)fd.mats[m.key]=m.def; }); }
function fdMats(fd){ return (fd && fd.mats) || {}; }
function fdWeProvide(fd,key){ const v=fdMats(fd)[key]; const m=FDRAIN_MATS.find(x=>x.key===key); return (v!=null?v:(m?m.def:"us")) === "us"; }
function fdMatCost(fd,key){ const o=(fd&&fd.matCosts)||{}; if(o[key]!=null) return o[key]; const m=FDRAIN_MATS.find(x=>x.key===key); return m?m.cost:0; }
function fdMatQty(m, geo){ return +geo[m.basis] || 0; }

/* pickup = its own weight-driven run (pvPickup re-parameterized onto the fd we-provide materials).
   Reuses the paver constants + drive helpers (PAVER_LOAD_CAP, driveFromBase, roadRouteCached, pvSiteLatLng). */
function fdPickup(geo, fd){
  fd = fd || {};
  const MIL   = (typeof QE!=="undefined"?QE.MILEAGE:0.725);
  const CAP   = (typeof PAVER_LOAD_CAP!=="undefined"?PAVER_LOAD_CAP:4000);
  const HND   = (typeof PAVER_HANDLE_PH_TON!=="undefined"?PAVER_HANDLE_PH_TON:1.3);
  const DEFMI = (typeof PAVER_PICKUP_DEF_MI!=="undefined"?PAVER_PICKUP_DEF_MI:20);
  const RATED = (typeof PAVER_PICKUP_RATE_DEF!=="undefined"?PAVER_PICKUP_RATE_DEF:30);
  const weight = FDRAIN_MATS.reduce((s,m)=> s + (fdWeProvide(fd,m.key) ? fdMatQty(m,geo)*m.lbs : 0), 0);
  if (weight <= 0) return { has:false, charge:0, cost:0, weight:0, tons:0, trips:0, miles:0, hoursEach:0, personHrs:0, rate:0, crew:0, exact:false, addr:"" };
  const rate = fd.pickupRate || RATED, crew = Math.max(1, fd.pickupCrew || 2);
  let loopMi = DEFMI, exact = false, legBP = null, legPS = null, suspect = false;
  const site = (typeof pvSiteLatLng==="function") ? pvSiteLatLng() : null;
  if (fd.pickupLat!=null && typeof driveFromBase==="function") {
    const bp = driveFromBase(fd.pickupLat, fd.pickupLng);
    let ps = null;
    if (site && typeof roadRouteCached==="function") {
      const psWp = [[fd.pickupLat, fd.pickupLng], [site.lat, site.lng]];
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
  const manual = fd.pickupMiles > 0;
  if (manual) { loopMi = +fd.pickupMiles; exact = true; suspect = false; }
  const trips = Math.max(1, Math.ceil(weight / CAP));
  const driveMin = Math.round(loopMi/35*60);
  const handlePH = (weight/2000) * HND;
  const drivePH  = crew * trips * (driveMin/60);
  const personHrs = handlePH + drivePH;
  const mileage  = Math.round(loopMi * trips * MIL);
  const labor    = personHrs * (rate/0.48);
  const charge   = Math.round((labor + mileage)/5)*5;
  return { has:true, charge, cost:mileage, weight:Math.round(weight), tons:Math.round(weight/2000*10)/10, trips, miles:loopMi, exact, manual, legBP, legPS, suspect, crew, personHrs:Math.round(personHrs*10)/10, hoursEach:Math.round(personHrs/crew*10)/10, rate, addr:fd.pickupAddr||"" };
}

/* fdCalc — mirror pvCalc. Price = labor + materials(pass-through) + spoil + drive; cost = materials + spoil +
   drive mileage (+ a dump-run mileage we eat when we haul the spoil). Materials net $0 to profit. */
function fdCalc(fd){
  fd = fd || (typeof WZ!=="undefined" && WZ && WZ.fd) || {};
  fdMatNorm(fd);
  const geo = fdGeo(fd), run = geo.run, lft = fd.lft || FDRAIN_LABOR_DEF;
  const MIL    = (typeof QE!=="undefined"?QE.MILEAGE:0.725);
  const LOADED = (typeof QE!=="undefined"?QE.TAKE_HOME/QE.FIELD_SPLIT:93.75);
  const FILL   = (typeof QE!=="undefined"?QE.FILL_TON:45);
  const CD     = (typeof QE!=="undefined"?QE.CD_TON:73.16);
  const FLOOR  = (typeof QE!=="undefined"?QE.MARGIN_FLOOR:0.35);
  const DUMPMI = (typeof DISPOSAL_TRIP_MILES!=="undefined"?DISPOSAL_TRIP_MILES:55);
  const dr = (typeof wizSiteDriveRT==="function") ? wizSiteDriveRT() : {rt:20,min:30};
  const driveCharge  = Math.round(dr.rt*MIL + 2*(dr.min/60)*LOADED), driveMileage = Math.round(dr.rt*MIL);
  const cplx = Math.max(1, fd.complexity || 1);   // 1 straight run · 1.25 tie-ins/bends · 1.5 hardpan/roots/tight access
  const laborPrice = Math.round(run*lft*cplx/25)*25;
  const matCost = FDRAIN_MATS.reduce((s,m)=> s + (fdWeProvide(fd,m.key) ? Math.round(fdMatQty(m,geo)*fdMatCost(fd,m.key)) : 0), 0);
  const haul = fd.haulSpoil !== false;
  const spoilRate = fd.spoilType==="cd" ? CD : FILL;
  const spoilCost  = haul ? Math.round(geo.spoilTon*spoilRate) : 0;
  const dumpMileage = haul ? Math.round(DUMPMI*MIL) : 0;
  const materials = matCost + spoilCost;
  const price = laborPrice + materials + driveCharge;
  const cost  = materials + driveMileage + dumpMileage;
  const profit = price - cost, margin = price>0 ? profit/price : 0;
  const allInFt = run>0 ? Math.round(price/run) : 0;
  // labor-time model (paver-style): trenching + laying + backfill, harder ground/tie-ins take longer
  const workMin = Math.round(run*FDRAIN_MIN_PER_FT*cplx) + 120;
  const crew = Math.max(1, fd.crew || 2), totalPH = (workMin/60) + crew*(dr.min/60) + crew*(20/60), hours = crew>0?totalPH/crew:totalPH;
  const fieldPool = Math.max(0, profit)*0.48, perHr = hours>0 ? fieldPool/crew/hours : 0;
  return { geo, run, lft, complexity:cplx, laborPrice, matCost, spoilCost, spoilTon:geo.spoilTon, spoilRate, dumpMileage, haul,
    materials, allInFt, price, cost, driveCharge, driveMileage, dr, crew, hours: Math.round(hours*10)/10, perHr: Math.floor(perHr),
    profit, margin, underFloor: margin < FLOOR, rockTon: geo.rockTon, rockCY: geo.rockCY };
}

/* MARKET band — national labor-only $/linear-ft (size-tapered + a mobilization floor) × the OBX premium,
   plus the pass-through materials/drive (cancel in the comparison). pay45 = price that clears $45/hr each. */
function fdMarketBand(run, baseCost, personHrs, cplx){
  run = Math.max(0, +run || 0); baseCost = +baseCost || 0; personHrs = Math.max(0, +personHrs || 0); cplx = Math.max(1, +cplx || 1);
  const loF = run<50?12:run<150?10:8, hiF = run<50?22:run<150?18:15;
  const labLo = Math.max(loF*run, 500)*cplx, labHi = Math.max(hiF*run, 750)*cplx;
  const r5 = n => Math.round(n/5)*5, OBX = (typeof PAVER_OBX_PREMIUM!=="undefined"?PAVER_OBX_PREMIUM:1.22), TGT = (typeof QE!=="undefined"?QE.TAKE_HOME:45);
  return { natLo:r5(labLo+baseCost), natHi:r5(labHi+baseCost), obxLo:r5(labLo*OBX+baseCost), obxHi:r5(labHi*OBX+baseCost), pay45:r5(TGT*personHrs/0.48+baseCost) };
}

function fdItem(c){
  const fd = (typeof WZ!=="undefined"&&WZ&&WZ.fd) || {};
  const ours   = FDRAIN_MATS.filter(m=>fdWeProvide(fd,m.key)).map(m=>m.label.toLowerCase());
  const theirs = FDRAIN_MATS.filter(m=>!fdWeProvide(fd,m.key)).map(m=>m.label.toLowerCase());
  const spoilTxt = !c.haul ? "leave/spread the spoil on site (no haul-off — $0)" : (c.spoilRate>=60?"excavate & haul the spoil to the dump (C&D)":"excavate & haul the spoil off (clean fill)");
  const notes = [
    "French drain — dig the trench, lay filter fabric"+(fd.pipe?" + 4\" perforated pipe":"")+", backfill with #57 washed stone, "+spoilTxt+".",
    "Labor (the install): $"+c.lft+"/linear ft · "+c.crew+"-person crew"+(c.complexity>1?" · ×"+c.complexity+" (ground/access)":"")+".",
    "Materials at COST, no markup — we provide: "+(ours.length?ours.join(", "):"none")+(theirs.length?("; customer provides: "+theirs.join(", ")):".")+" ~"+(Math.round(c.rockTon*10)/10)+" ton #57 ("+(Math.round(c.rockCY*100)/100)+" cy)."
  ];
  return { serviceId:"", name:"French drain — trench install", unit:"job", price:c.price, qty:1, cost:c.cost, estMat:Math.round((c.materials||0)*100)/100, notes:notes, bandKey:"frenchdrain",
    breakdown:[ c.run+" ft × "+fd.width+"″×"+fd.depth+"″ ("+fd.cap+"″ cap) · ~"+(Math.round(c.rockTon*10)/10)+" t #57 · $"+c.lft+"/ft" ] };
}
function fdPickupItem(pk){
  return { serviceId:"", name:"Materials pickup & delivery ("+pk.crew+"-person run)", unit:"job", price:pk.charge, qty:1, cost:pk.cost, bandKey:"frenchdrain", _pickup:true, estHours:pk.hoursEach, estCrew:pk.crew,
    notes:["Haul OUR materials (#57 stone, fabric"+(pk.trips?"":"")+") from "+(pk.addr||"the supplier")+" → the site, then unload.",
      "~"+pk.tons+" ton ("+pk.weight+" lb) · "+pk.trips+" trip(s) · "+pk.crew+" people × ~"+pk.hoursEach+" hr — heavy manual handling.",
      "Customer-service rate $"+pk.rate+"/hr each (softer than install). Customer can provide/haul the stone to skip this."],
    breakdown:[ pk.weight+" lb · "+pk.trips+" trip(s) · "+pk.crew+" × ~"+pk.hoursEach+" hr @ $"+pk.rate+"/hr" ] };
}

window.wizFrenchDrainStart = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  if (!WZ.fd) WZ.fd = { run:20, width:7.5, depth:12, cap:2, pipe:false, density:FDRAIN_DENSITY_DEF, settle:true, lft:FDRAIN_LABOR_DEF, crew:2, complexity:1, mats:{}, matCosts:{}, haulSpoil:true, spoilType:"fill", pickupAddr:"", pickupLat:null, pickupLng:null, pickupRate:(typeof PAVER_PICKUP_RATE_DEF!=="undefined"?PAVER_PICKUP_RATE_DEF:30), pickupCrew:2, pickupMiles:0 };
  fdMatNorm(WZ.fd);
  WZ.svc = "frenchdrain"; WZ.disc = 0; WZ.discPct = null;
  WZ.step = "calc"; if (typeof render==="function") render();
};
window.openFrenchDrainEst = window.wizFrenchDrainStart;

/* Change-order: re-open the full builder for a saved quote. Use the saved WZ.fd if present; else reconstruct
   the trench + labor + pipe + spoil + who-supplies from the saved line so old quotes are still fully editable. */
window.wizFrenchDrainEdit = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  const it = WZ.items && WZ.items[0];
  if (!WZ._fdFromSave && it) {
    if (!WZ.fd) WZ.fd = { run:20, width:7.5, depth:12, cap:2, pipe:false, density:FDRAIN_DENSITY_DEF, settle:true, lft:FDRAIN_LABOR_DEF, crew:2, complexity:1, mats:{}, matCosts:{}, haulSpoil:true, spoilType:"fill", pickupAddr:"", pickupLat:null, pickupLng:null, pickupRate:(typeof PAVER_PICKUP_RATE_DEF!=="undefined"?PAVER_PICKUP_RATE_DEF:30), pickupCrew:2, pickupMiles:0 };
    const bd = [].concat(it.breakdown||[]).join(" "), nt = [].concat(it.notes||[]).join(" ");
    const dim = /(\d+(?:\.\d+)?)\s*ft\s*×\s*(\d+(?:\.\d+)?)″×(\d+(?:\.\d+)?)″\s*\((\d+(?:\.\d+)?)″\s*cap\)/.exec(bd);
    if (dim) { WZ.fd.run=+dim[1]; WZ.fd.width=+dim[2]; WZ.fd.depth=+dim[3]; WZ.fd.cap=+dim[4]; }
    const lf = /\$(\d+(?:\.\d+)?)\/ft/.exec(bd); if (lf) WZ.fd.lft=+lf[1];
    const cr = /(\d+)-person crew/.exec(nt); if (cr) WZ.fd.crew=Math.max(1,Math.min(4,+cr[1]));
    WZ.fd.pipe = /perforated pipe/.test(nt);
    WZ.fd.haulSpoil = !/leave\/spread the spoil/.test(nt);
    WZ.fd.spoilType = /haul the spoil to the dump/.test(nt) ? "cd" : "fill";
    const theirs = ((/customer provides:\s*([^.]+)/i.exec(nt)||[])[1]||"").toLowerCase();
    if (!WZ.fd.mats) WZ.fd.mats = {};
    FDRAIN_MATS.forEach(m => { WZ.fd.mats[m.key] = theirs.indexOf(m.label.toLowerCase())>=0 ? "them" : "us"; });
  }
  fdMatNorm(WZ.fd);
  WZ.svc = "frenchdrain"; WZ.step = "calc"; if (typeof render==="function") render();
};

/* ---- little UI helpers (mirror the paver ones, fd-namespaced) ---- */
function fdCrewBtns(cur, fn){ return (typeof pvCrewBtns==="function") ? pvCrewBtns(cur, fn) : [1,2,3,4].map(n=>`<button class="btn ${cur===n?"acc":"ghost"} sm" style="flex:0 0 auto;min-width:34px;padding:4px 0" onclick="${fn}(${n})">${n}</button>`).join(""); }
function fdCplxBtns(cur){ return [[1,"─ Straight run"],[1.25,"Tie-ins & bends"],[1.5,"Hardpan / roots / tight"]].map(o=>`<button class="btn ${cur===o[0]?"acc":"ghost"} sm" style="flex:1 1 0;padding:5px 4px;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizFdComplexity(${o[0]})">${o[1]}</button>`).join(""); }
function fdTier(perHr){ const TGT=(typeof QE!=="undefined"?QE.TAKE_HOME:45), CF=(typeof QE!=="undefined"?QE.CREW_FLOOR:30); return perHr>=TGT?2 : perHr>=CF?1 : 0; }
function fdPayNote(tier){ return tier===2?'<span style="color:var(--accent)">✓ Clears your $45/hr floor.</span>':tier===1?'<span style="color:#b8860b">🟡 Below $45 but clears the $30/hr crew floor — good for Chase/Pierce.</span>':'<span style="color:var(--danger)">🔴 Below the $30/hr crew floor — slide up.</span>'; }
function fdMarginNote(c){ const pct=Math.round(c.margin*100); return `Cost ${money(c.cost)} · profit ${money(c.profit)} · <b>margin ${pct}%</b>${c.underFloor?' <span style="color:var(--danger);font-weight:700">⚠ under the 35% floor — raise the price or drop a we-provide material</span>':' <span style="color:#1a7f37">✓ clears the 35% floor</span>'}`; }

function fdPickupInfoHTML(pk){
  if (!pk.has) return "";
  const ex = (pk.exact||pk.suspect) ? "" : ` <span style="color:#b8860b">— est.; add the supplier address for exact</span>`;
  const legs = (!pk.manual && !pk.suspect && pk.legBP!=null && pk.legPS!=null) ? `base→supplier ${pk.legBP} mi + supplier→site ${pk.legPS} mi = ` : "";
  const milesTxt = pk.manual ? `${pk.miles} mi (you set it)` : pk.suspect ? `~${pk.miles} mi (estimate)` : `${legs}${pk.miles} mi`;
  const warn = (pk.suspect && !pk.manual) ? `<div class="sub" style="color:var(--danger);margin-top:2px">⚠ The geocoder put the supplier <b>${pk.legBP} mi</b> away — that's wrong. Type the real miles below.</div>` : "";
  const override = `<div class="row" style="gap:6px;align-items:center;margin-top:5px"><div class="grow sub">${pk.manual?'✓ <b>Using your miles</b>':'Drive off? Set the run miles'} <span style="opacity:.7">(base→supplier→site)</span>:</div><input type="number" inputmode="decimal" value="${pk.manual?pk.miles:''}" placeholder="auto ${pk.miles}" style="width:72px;padding:3px 6px;font-size:13px" onchange="wizFdPickMiles(this.value)"><span class="sub">mi</span></div>`;
  const tip = pk.trips>=2 ? `<div class="sub" style="color:#b8860b;margin-top:4px">💡 ${pk.trips} trips / ${pk.tons} ton — having the yard <b>deliver</b> usually beats self-haul once it's 2+ trips.</div>` : "";
  return `<div class="row" style="gap:6px;align-items:center;margin-bottom:4px"><div class="grow sub">Pickup crew</div>${fdCrewBtns(pk.crew,"wizFdPickCrew")}</div>⚖️ ~${pk.tons} ton (${pk.weight} lb) · ${pk.trips} trip(s) · ${pk.crew} × ~${pk.hoursEach} hr<br>🚗 ${milesTxt}${pk.trips>1?` × ${pk.trips} trips`:""}${ex}: mileage <b>${money(pk.cost)}</b>${warn}${override}<br><div class="row" style="justify-content:space-between;align-items:baseline;margin-top:4px"><div>Pickup charge <b>${money(pk.charge)}</b></div><div class="sub">each takes home <b>$${pk.rate}/hr</b></div></div><input type="range" min="${(typeof PAVER_PICKUP_RATE_MIN!=="undefined"?PAVER_PICKUP_RATE_MIN:20)}" max="${(typeof PAVER_PICKUP_RATE_MAX!=="undefined"?PAVER_PICKUP_RATE_MAX:45)}" step="1" value="${pk.rate}" oninput="wizFdPickRate(this.value)" style="width:100%;accent-color:#b8860b;margin-top:4px">${tip}`;
}

function fdBreakHTML(c, pk){
  let s = `<div style="font-size:13px;line-height:1.9">🔨 Labor: ${c.run} ft × $${c.lft}/ft${c.complexity>1?` × ${c.complexity} (ground)`:""} (${c.crew} crew): <b>${money(c.laborPrice)}</b><br>🪨 Materials — pass-through at cost: <b>+${money(c.materials)}</b> <span class="sub">(our materials ${money(c.matCost)}${c.spoilCost>0?` + spoil haul ${money(c.spoilCost)}`:""})</span><br>🚗 Drive — static (~${c.dr.rt} mi RT): <b>+${money(c.driveCharge)}</b>`;
  if (pk && pk.has) s += `<br>🚚 Materials pickup (own line, ${pk.crew}-person @ $${pk.rate}/hr): <b>+${money(pk.charge)}</b>`;
  s += `<br><span class="sub">Materials net <b>$0</b> to you (pass-through) — profit ${money(c.profit)} is labor + drive${c.dumpMileage>0?` (minus the ${money(c.dumpMileage)} dump-run miles`:""}${c.dumpMileage>0?")":""}.</span></div>`;
  return s;
}

function wizFrenchDrainUI(){
  if (!WZ.fd) wizFrenchDrainStart();
  fdMatNorm(WZ.fd);
  const fd = WZ.fd, c = fdCalc(fd), geo = c.geo, pk = fdPickup(geo, fd);
  const items = [ fdItem(c) ]; if (pk.has) items.push(fdPickupItem(pk));
  items[0].mkt = fdMarketBand(c.run, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity);
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;
  const total = c.price + (pk.has ? pk.charge : 0);
  const tier = fdTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const lo = FDRAIN_LABOR_MIN, hi = FDRAIN_LABOR_MAX;

  let h = `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">💧 French drain</div><div class="nm" style="font-size:18px">One-page quote</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;
  if (WZ.cust && WZ.cust.name) h += `<div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(WZ.cust.name)}</div>${WZ.cust.address?`<div class="sub">${esc(WZ.cust.address)}</div>`:""}<button class="btn ghost sm" style="margin-top:6px" onclick="WZ.step='cust';render()">↩ Change customer / property</button></div>`;
  // trench dimensions
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🚧 The trench</div><div class="row" style="gap:8px">
    <div class="grow"><label style="margin-top:0">Run (linear ft)</label><input type="number" inputmode="decimal" value="${fd.run}" min="1" onchange="wizFdField('run',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Width (in)</label><input type="number" inputmode="decimal" value="${fd.width}" min="1" onchange="wizFdField('width',this.value)"></div></div>
    <div class="row" style="gap:8px;margin-top:6px">
    <div class="grow"><label style="margin-top:0">Depth (in)</label><input type="number" inputmode="decimal" value="${fd.depth}" min="1" onchange="wizFdField('depth',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Decorative cap (in)</label><input type="number" inputmode="decimal" value="${fd.cap}" min="0" onchange="wizFdField('cap',this.value)"></div></div>
    <div class="toggle" style="margin-top:8px"><input type="checkbox" id="fd_pipe" ${fd.pipe?"checked":""} onchange="wizFdPipe(this.checked)"><label style="margin:0">4″ perforated pipe in the trench <span class="sub">(displaces some rock)</span></label></div>
    <div class="row" style="gap:8px;margin-top:6px"><div class="grow"><label style="margin-top:0">Stone density (t/cy)</label><input type="number" inputmode="decimal" step="0.05" value="${fd.density}" min="1" onchange="wizFdField('density',this.value)"></div>
    <div class="toggle" style="align-self:flex-end;padding-bottom:6px"><input type="checkbox" id="fd_settle" ${fd.settle?"checked":""} onchange="wizFdSettle(this.checked)"><label style="margin:0">+10% settling</label></div></div></div>`;
  // HERO tonnage
  h += `<div class="card" style="text-align:center;border:2px solid var(--accent)"><div style="font-size:12px;font-weight:700;color:var(--muted)">ORDER FROM THE YARD</div><div style="font-size:30px;font-weight:800;line-height:1.1;color:var(--accent)">≈ ${Math.round(c.rockTon*10)/10} tons</div><div style="font-size:13px;font-weight:700">#57 washed stone · ${Math.round(c.rockCY*100)/100} cy${fd.pipe?" · pipe displaces some":""}${fd.settle?" · +10% settle":""}</div><div class="sub" style="margin-top:2px">fabric ~${Math.round(geo.fabricSF)} sq ft · spoil ~${Math.round(geo.spoilTon*10)/10} ton (${Math.round(geo.spoilCY*100)/100} cy) dug out</div></div>`;
  // ground / access complexity
  h += `<div class="card" style="padding:10px"><div class="grow" style="margin-bottom:6px"><b>Ground / access</b> <span class="sub">hardpan, roots, tie-ins &amp; tight access = more dig labor</span></div><div class="row" style="gap:6px">${fdCplxBtns(c.complexity)}</div>${c.complexity>1?`<div class="sub" style="margin-top:6px;color:#b8860b">+${Math.round((c.complexity-1)*100)}% on labor time &amp; price.</div>`:""}</div>`;
  // materials
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🪨 Materials — who provides each? <span class="sub" style="font-weight:400">we = pass-through at cost</span></div>`;
  h += FDRAIN_MATS.map(m=>{ const we = fdWeProvide(fd,m.key), cost = fdMatCost(fd,m.key), qty = fdMatQty(m,geo), u = m.unit==="ton"?"ton":m.unit==="ft"?"ft":"sq ft"; const dim = m.key==="pipe"&&!fd.pipe; return `<div class="row" style="gap:6px;align-items:center;margin-bottom:5px${dim?";opacity:.5":""}"><div class="grow"><b>${m.label}</b> ${we?`$<input type="number" inputmode="decimal" value="${cost}" step="${m.unit==="sqft"?"0.05":m.unit==="ton"?"5":"0.25"}" min="0" style="width:58px;display:inline-block;padding:2px 5px;font-size:13px" onchange="wizFdMatCost('${m.key}',this.value)">/${u} <span class="sub">≈ ${Math.round(qty*100)/100} ${u} = ${money(Math.round(qty*cost))}</span>`:`<span class="sub">customer provides</span>`}</div>${[["us","We get it"],["them","They provide"]].map(o=>`<button class="btn ${fdMats(fd)[m.key]===o[0]?"acc":"ghost"} sm" style="flex:0 0 auto" onclick="wizFdMat('${m.key}','${o[0]}')">${o[1]}</button>`).join("")}</div>`; }).join("");
  // spoil 3-way
  const _st = fd.spoilType==="cd"?"cd":"fill", _haul = fd.haulSpoil !== false;
  h += `<div style="border-top:1px solid var(--line);margin:8px 0 2px;padding-top:8px"><div class="grow" style="margin-bottom:4px"><b>🟫 Excavated spoil</b> <span class="sub">~${Math.round(geo.spoilTon*10)/10} ton dug out</span></div><div class="row" style="gap:6px">
    <button class="btn ${!_haul?"acc":"ghost"} sm" style="flex:1 1 0;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizFdSpoil('leave')">Leave / spread<br><span class="sub">$0</span></button>
    <button class="btn ${_haul&&_st==="fill"?"acc":"ghost"} sm" style="flex:1 1 0;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizFdSpoil('fill')">Haul — clean fill<br><span class="sub">$45/ton</span></button>
    <button class="btn ${_haul&&_st==="cd"?"acc":"ghost"} sm" style="flex:1 1 0;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizFdSpoil('cd')">Haul — C&amp;D<br><span class="sub">$73.16/ton</span></button></div>
    ${_haul?`<div class="sub" style="margin-top:4px">Haul-off ${money(c.spoilCost)} (pass-through) + ~${money(c.dumpMileage)} dump-run miles.</div>`:`<div class="sub" style="margin-top:4px;color:var(--accent)">Customer keeps the dirt — no haul-off.</div>`}</div>`;
  h += `<div class="sub" style="margin-top:6px">Defaults are real-price estimates — change any to the actual yard price. Your labor price never changes with these.</div></div>`;
  // pickup mini-quote
  if (pk.has) h += `<div class="card" style="border-left:4px solid #b8860b"><div style="font-weight:800;margin-bottom:4px">🚚 Materials pickup — its own run</div>
    <label style="margin-top:0">Where are we picking up?</label>
    <div class="acwrap"><input id="fd_pickaddr" value="${esc(fd.pickupAddr||"")}" placeholder="Supplier address…" autocomplete="off" oninput="addrSuggest('fd_pickaddr','fd_pickbox')" onchange="wizFdGeoPickup(this.value)"><div class="acbox" id="fd_pickbox"></div></div>
    <div id="fd_pickinfo" style="margin-top:6px;white-space:normal;font-size:13px;line-height:1.8">${fdPickupInfoHTML(pk)}</div></div>`;
  // LABOR slider + crew + band + pay check + MARGIN/FLOOR
  h += `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:baseline"><div class="nm" style="font-size:28px" id="fd_price">${money(total)}</div><div style="text-align:right"><div class="nm" style="font-size:18px" id="fd_rate">$${c.lft}/ft labor</div><div class="sub" id="fd_allin">install ${money(c.price)}${pk.has?` + pickup ${money(pk.charge)}`:""}</div></div></div>
    <input type="range" min="${lo}" max="${hi}" step="0.5" value="${fd.lft}" oninput="wizFdLft(this.value)" style="width:100%;accent-color:var(--accent);margin-top:8px">
    <div class="sub" style="font-size:11px">Labor band $${FDRAIN_LABOR_BAND.lo}–$${FDRAIN_LABOR_BAND.hi}/ft · range $${lo}–$${hi}. Price to the market, not your floor.</div>
    <div id="fd_mktband" style="margin-top:6px">${(typeof pvBandHTML==="function"&&items[0].mkt)?pvBandHTML(items[0].mkt,total):""}</div>
    <div class="row" style="gap:6px;align-items:center;margin-top:8px"><div class="grow sub">Install crew</div>${fdCrewBtns(c.crew,"wizFdCrew")}</div>
    <div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px"><div class="row" style="gap:14px;flex-wrap:wrap"><div class="grow"><div class="sub" id="fd_hrs">Install: ${c.crew} people × ~${c.hours} hr each</div><div class="sub">dig + lay + backfill + drive</div></div><div class="grow" style="text-align:right"><div class="sub">Per hour each</div><div class="nm" style="font-size:20px;color:${tCol}" id="fd_payhr">${money(c.perHr)}/hr ${tIcon}</div></div></div>
    <div class="sub" id="fd_paynote" style="margin-top:4px">${fdPayNote(tier)}</div>
    <div class="sub" id="fd_margin" style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px">${fdMarginNote(c)}</div></div></div>`;
  h += `<div class="card" id="fd_break">${fdBreakHTML(c, pk)}</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="wizPrint()">🖨 Print / PDF</button><button class="btn ghost grow" onclick="wizCopy()">Copy text</button></div>`;
  h += `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b id="fd_foot">${money(total)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Services</button><button class="btn acc grow" onclick="wizFinish()">Save &amp; present →</button></div>`;
  return h;
}

/* ---- live handlers ---- */
window.wizFdField = function (k, v) { if (!WZ.fd) return; WZ.fd[k] = Math.max(0, parseFloat(v)||0); render(); };
window.wizFdPipe = function (v) { if (!WZ.fd) return; WZ.fd.pipe = !!v; render(); };
window.wizFdSettle = function (v) { if (!WZ.fd) return; WZ.fd.settle = !!v; render(); };
window.wizFdMat = function (key, v) { if (!WZ.fd) return; if (!WZ.fd.mats) WZ.fd.mats = {}; WZ.fd.mats[key] = v; render(); };
window.wizFdMatCost = function (key, v) { if (!WZ.fd) return; if (!WZ.fd.matCosts) WZ.fd.matCosts = {}; WZ.fd.matCosts[key] = Math.max(0, parseFloat(v)||0); render(); };
window.wizFdSpoil = function (mode) { if (!WZ.fd) return; if (mode==="leave") { WZ.fd.haulSpoil = false; } else { WZ.fd.haulSpoil = true; WZ.fd.spoilType = (mode==="cd")?"cd":"fill"; } render(); };
window.wizFdCrew = function (n) { if (!WZ.fd) return; WZ.fd.crew = Math.max(1, n); render(); };
window.wizFdComplexity = function (v) { if (!WZ.fd) return; WZ.fd.complexity = Math.max(1, +v || 1); render(); };
window.wizFdPickCrew = function (n) { if (!WZ.fd) return; WZ.fd.pickupCrew = Math.max(1, n); render(); };
window.wizFdPickMiles = function (v) { if (!WZ.fd) return; const n = parseFloat(v); WZ.fd.pickupMiles = (n>0) ? n : 0; if (typeof render==="function") render(); };
window.wizFdGeoPickup = function (addr) {
  if (!WZ.fd) return; WZ.fd.pickupAddr = addr;
  if (!addr) { WZ.fd.pickupLat = null; WZ.fd.pickupLng = null; if (typeof render==="function") render(); return; }
  const inp = document.getElementById("fd_pickaddr");
  if (inp && inp.dataset && inp.dataset.pickLat) {
    WZ.fd.pickupLat = +inp.dataset.pickLat; WZ.fd.pickupLng = +inp.dataset.pickLng;
    delete inp.dataset.pickLat; delete inp.dataset.pickLng;
    if (typeof render==="function") render(); return;
  }
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(addr))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d[0]) { WZ.fd.pickupLat = +d[0].lat; WZ.fd.pickupLng = +d[0].lon; } if (typeof render==="function") render(); })
    .catch(function () { if (typeof render==="function") render(); });
};
window.wizFdPickRate = function (v) {
  if (!WZ.fd) return; WZ.fd.pickupRate = parseInt(v,10) || (typeof PAVER_PICKUP_RATE_DEF!=="undefined"?PAVER_PICKUP_RATE_DEF:30);
  const c = fdCalc(WZ.fd), pk = fdPickup(c.geo, WZ.fd);
  const items = [ fdItem(c) ]; if (pk.has) items.push(fdPickupItem(pk)); items[0].mkt = fdMarketBand(c.run, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity); WZ.items = items;
  const total = c.price + (pk.has ? pk.charge : 0);
  const info = document.getElementById("fd_pickinfo"); if (info) info.innerHTML = fdPickupInfoHTML(pk);
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("fd_price", money(total)); set("fd_foot", money(total)); set("fd_allin", "install "+money(c.price)+(pk.has?" + pickup "+money(pk.charge):""));
  const br=document.getElementById("fd_break"); if(br)br.innerHTML=fdBreakHTML(c, pk);
  const mb=document.getElementById("fd_mktband"); if(mb&&typeof pvBandHTML==="function")mb.innerHTML=pvBandHTML(items[0].mkt,total);
  if(typeof wizAutosave==="function")wizAutosave();
};
window.wizFdLft = function (v) {
  if (!WZ.fd) return; WZ.fd.lft = parseFloat(v) || FDRAIN_LABOR_DEF;
  const c = fdCalc(WZ.fd), pk = fdPickup(c.geo, WZ.fd);
  const items = [ fdItem(c) ]; if (pk.has) items.push(fdPickupItem(pk)); items[0].mkt = fdMarketBand(c.run, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity);
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;
  const total = c.price + (pk.has ? pk.charge : 0);
  const tier = fdTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("fd_price", money(total)); set("fd_foot", money(total)); set("fd_rate", "$"+c.lft+"/ft labor"); set("fd_allin", "install "+money(c.price)+(pk.has?" + pickup "+money(pk.charge):""));
  set("fd_payhr", money(c.perHr)+"/hr "+tIcon); const ph=document.getElementById("fd_payhr"); if(ph)ph.style.color=tCol;
  const mb=document.getElementById("fd_mktband"); if(mb&&typeof pvBandHTML==="function")mb.innerHTML=pvBandHTML(items[0].mkt,total);
  const pn=document.getElementById("fd_paynote"); if(pn)pn.innerHTML=fdPayNote(tier);
  const mg=document.getElementById("fd_margin"); if(mg)mg.innerHTML=fdMarginNote(c);
  const br=document.getElementById("fd_break"); if(br)br.innerHTML=fdBreakHTML(c, pk);
  if(typeof wizAutosave==="function")wizAutosave();
};

/* node export (tests) — browser ignores this; top-level touches no browser globals */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fdGeo, fdCalc, fdMarketBand, fdPickup, fdMatNorm, fdWeProvide, fdMatCost, FDRAIN_MATS,
    PIPE_SQIN, DIRT_DENSITY, FABRIC_WRAP, FDRAIN_DENSITY_DEF, FDRAIN_SETTLE, FDRAIN_LABOR_DEF };
}
