/* ---------- PAVER PATIO / PAD — ONE-PAGE QUOTE MACHINE ----------
   PRICING MODEL (Ray):
   - PRICE = LABOR only. The $/sq ft slider + band are the worth of your INSTALL work, never the materials.
   - EVERY material is its own selector + its own EDITABLE price (defaults are estimates — prices change, so
     they're knobs, not presets). Customer provides it, or we do; when WE do, it's a PURE PASS-THROUGH (at
     cost, zero margin). Materials are unit-aware: most are $/sq ft, EDGING is $/linear ft (the perimeter).
     Defaults calibrated from real OBX Home Depot prices (2026-06): bedding sand ~$1/sq ft ($6/0.5 cu ft),
     base rock ~$3/sq ft (3-4" — bulk beats bagged on big jobs), polymeric joint sand ~$0.50/sq ft
     ($30/35 lb bag), underlayment ~$0.20/sq ft, edging ~$1.75/ft ($77/48 ft), premium pavers $8/sq ft.
   - PICKUP is its own weight-driven mini-quote → a real sub-job (selectable crew + softer rate). All editable. */
const PAVER_MATS = [
  { key:"pavers", label:"Pavers",              unit:"sqft", cost:8.00, lbs:22 },   // premium "high end of good value" (we don't put our name on crap)
  { key:"rock",   label:"Base rock (crushed)", unit:"sqft", cost:1.50, lbs:30 },   // ~3-4" base, BULK from a stone yard (~$80/ton #57); bagged at Lowe's is ~$5/sq ft for 4" — bump it for bagged jobs. CONFIRM w/ the yard quote.
  { key:"bed",    label:"Bedding sand",        unit:"sqft", cost:0.40, lbs:9 },    // ~1" bedding — BULK concrete/coarse sand from the stone yard; Lowe's bags run ~$1/sq ft. CONFIRM w/ the yard quote.
  { key:"poly",   label:"Polymeric joint sand", unit:"sqft", cost:0.50, lbs:2 },   // swept into joints (~$30/35 lb bag ≈ 60 sq ft)
  { key:"fabric", label:"Underlayment fabric", unit:"sqft", cost:0.20, lbs:0.2 },  // weed/moisture barrier (rock holds it; +a $5 pack of fabric staples is negligible)
  { key:"edge",   label:"Paver edging",        unit:"ft",   cost:2.50, lbs:0.3 },  // per PERIMETER foot (~$15/6 ft at Lowe's)
  { key:"spikes", label:"Edging spikes",       unit:"ft",   cost:0.50, lbs:0.3 }   // anchor spikes for the edging, per PERIMETER foot (~1-1.5/ft; corners tighter)
];
const PAVER_DIG_IN     = 8;
const PAVER_DIRT_TON   = 45;
const PAVER_LABOR_DEF  = 16;
const PAVER_LABOR_MIN  = 8, PAVER_LABOR_MAX = 30;
const PAVER_LABOR_BAND = { lo: 12, hi: 22 };
const PAVER_PICKUP_CREW   = 2;
const PAVER_LOAD_CAP      = 4000;
const PAVER_HANDLE_PH_TON = 1.3;
const PAVER_PICKUP_DEF_MI = 20;
const PAVER_PICKUP_RATE_DEF = 30, PAVER_PICKUP_RATE_MIN = 20, PAVER_PICKUP_RATE_MAX = 45;
const PAVER_OBX_PREMIUM = 1.22;   // Outer Banks premium over the national market (2026 research: scarce trades + island logistics + tourist demand, +20-25%; NOT cost-of-living, which is only +4%). Tunable.

/* MARKET band for THIS job — what the OPEN MARKET pays, so we price to fair value (not to what Ray needs).
   National labor-only $/sq ft (2026 research: ~$6-11, small jobs higher per ft / mobilization), × the OBX
   premium, PLUS the actual pass-through materials + drive (same in the band AND the price, so they cancel
   in the comparison). pay45 = the total price that clears Ray's $45/hr each — shown as a MARKER, not the price. */
function pvMarketBand(area, baseCost, personHrs, cplx){
  area = Math.max(0, +area || 0); baseCost = +baseCost || 0; personHrs = Math.max(0, +personHrs || 0); cplx = Math.max(1, +cplx || 1);
  const loS = area<150?7:area<350?6:5, hiS = area<150?11:area<350?9:7.5;
  const labLo = Math.max(loS*area, 500)*cplx, labHi = Math.max(hiS*area, 750)*cplx;   // the market charges more for hard shapes too — scale the band so the marker still reads right
  const r5 = n => Math.round(n/5)*5, OBX = PAVER_OBX_PREMIUM, TGT = (typeof QE!=="undefined"?QE.TAKE_HOME:45);
  return { natLo:r5(labLo+baseCost), natHi:r5(labHi+baseCost), obxLo:r5(labLo*OBX+baseCost), obxHi:r5(labHi*OBX+baseCost), pay45:r5(TGT*personHrs/0.48+baseCost) };
}

function pvPerim(){ const pv=WZ.pv||{}; return 2*((+pv.L||0)+(+pv.W||0)); }
function pvMatQty(m, area){ return m.unit==="ft" ? pvPerim() : area; }
function pvMatNorm(){ if(!WZ.pv)return; if(!WZ.pv.mats)WZ.pv.mats={}; PAVER_MATS.forEach(m=>{ if(WZ.pv.mats[m.key]==null)WZ.pv.mats[m.key]="us"; }); }
function pvMats(){ return (WZ.pv && WZ.pv.mats) || {}; }
function pvWeProvide(key){ return pvMats()[key] === "us"; }
function pvMatCost(key){ const o=(WZ.pv&&WZ.pv.matCosts)||{}; if(o[key]!=null) return o[key]; const m=PAVER_MATS.find(x=>x.key===key); return m?m.cost:0; }
function pvSiteLatLng(){ const pid=(typeof WZ!=="undefined")&&WZ.cust&&WZ.cust.propertyId; if(pid){const p=(D().properties||[]).find(x=>x.id===pid); if(p&&p.lat!=null)return {lat:p.lat,lng:p.lng};} return null; }

function pvPickup(area){
  const pv = WZ.pv || {};
  const MIL=(typeof QE!=="undefined"?QE.MILEAGE:0.725);
  const weight = PAVER_MATS.reduce((s,m)=> s + (pvWeProvide(m.key) ? pvMatQty(m,area)*m.lbs : 0), 0);
  if (weight <= 0) return { has:false, charge:0, cost:0, weight:0, tons:0, trips:0, miles:0, hoursEach:0, personHrs:0, rate:0, crew:0, exact:false, addr:"" };
  const rate = pv.pickupRate || PAVER_PICKUP_RATE_DEF, crew = Math.max(1, pv.pickupCrew || PAVER_PICKUP_CREW);
  let loopMi = PAVER_PICKUP_DEF_MI, exact = false, legBP = null, legPS = null, suspect = false;
  const site = pvSiteLatLng();
  if (pv.pickupLat!=null && typeof driveFromBase==="function") {
    const bp = driveFromBase(pv.pickupLat, pv.pickupLng);                                   // home base → supplier
    let ps = 0; if (site && typeof haversineMi==="function") { const hv = haversineMi(pv.pickupLat, pv.pickupLng, site.lat, site.lng); if (hv!=null) ps = Math.round(hv*1.3*10)/10; }  // supplier → job site
    if (bp) {
      legBP = bp.miles; legPS = ps;
      const geoLoop = Math.round((bp.miles + ps)*10)/10;                                    // base → supplier → site (Ray's spec; no return-to-base leg)
      if (geoLoop > 80 || bp.miles > 60) suspect = true;                                    // absurd for a local pickup → a coord geocoded wrong; fall back to the estimate instead of billing it
      else { loopMi = geoLoop; exact = true; }
    }
  }
  const manual = pv.pickupMiles > 0;
  if (manual) { loopMi = +pv.pickupMiles; exact = true; suspect = false; }   // manual round-trip override — you know the real distance, the geocoder can't argue
  const trips = Math.max(1, Math.ceil(weight / PAVER_LOAD_CAP));   // vehicle capacity drives trips
  const driveMin = Math.round(loopMi/35*60);
  const handlePH = (weight/2000) * PAVER_HANDLE_PH_TON;
  const drivePH = crew * trips * (driveMin/60);
  const personHrs = handlePH + drivePH;
  const mileage = Math.round(loopMi * trips * MIL);
  const labor = personHrs * (rate/0.48);
  const charge = Math.round((labor + mileage)/5)*5;
  return { has:true, charge, cost:mileage, weight:Math.round(weight), tons:Math.round(weight/2000*10)/10, trips, miles:loopMi, exact, manual, legBP, legPS, suspect, crew, personHrs:Math.round(personHrs*10)/10, hoursEach:Math.round(personHrs/crew*10)/10, rate, addr:pv.pickupAddr||"" };
}

function pvCalc(){
  const pv = WZ.pv || {}, area = Math.max(0, (pv.L||0)*(pv.W||0)), laborSqft = pv.sqft || PAVER_LABOR_DEF;
  const dr = (typeof wizSiteDriveRT==="function") ? wizSiteDriveRT() : {rt:20,min:30};
  const MIL = (typeof QE!=="undefined"?QE.MILEAGE:0.725), LOADED = (typeof QE!=="undefined"?QE.TAKE_HOME/QE.FIELD_SPLIT:93.75);
  const driveCharge = Math.round(dr.rt*MIL + 2*(dr.min/60)*LOADED), driveMileage = Math.round(dr.rt*MIL);
  const cplx = Math.max(1, pv.complexity || 1);   // shape difficulty: 1 simple rectangle · 1.25 cuts/angles · 1.5 curves/transitions — scales labor TIME + PRICE
  const laborPrice = Math.round(area*laborSqft*cplx/25)*25;
  const matCost = PAVER_MATS.reduce((s,m)=> s + (pvWeProvide(m.key) ? Math.round(pvMatQty(m,area)*pvMatCost(m.key)) : 0), 0);
  const spoilTip = (pv.haulSpoil === false) ? 0 : Math.round(area*(PAVER_DIG_IN/12)/27*1.35*PAVER_DIRT_TON);   // customer keeping the dirt → no haul-off cost
  const materials = matCost + spoilTip;
  const price = laborPrice + materials + driveCharge;
  const cost = materials + driveMileage;
  const profit = price - cost, allInSqft = area>0 ? Math.round(price/area) : 0;
  const mpu = area<150 ? 6 : area<300 ? 5 : 4.5;
  const workMin = Math.round(area*mpu*cplx) + 120;   // harder shapes take longer to lay; mobilization is fixed
  const crew = Math.max(1, pv.crew || 2), totalPH = (workMin/60) + crew*(dr.min/60) + crew*(20/60), hours = crew>0?totalPH/crew:totalPH;
  const fieldPool = Math.max(0, profit)*0.48, perHr = hours>0 ? fieldPool/crew/hours : 0;
  return { area, laborSqft, complexity:cplx, laborPrice, matCost, spoilTip, materials, allInSqft, price, cost, driveCharge, dr, crew, hours: Math.round(hours*10)/10, perHr: Math.floor(perHr), profit };
}

function pvItem(c){
  const ours = PAVER_MATS.filter(m=>pvWeProvide(m.key)).map(m=>m.label.toLowerCase());
  const theirs = PAVER_MATS.filter(m=>!pvWeProvide(m.key)).map(m=>m.label.toLowerCase());
  const notes = ["Full premium build — base + bedding + polymeric joints + edging + "+(c.spoilTip>0?"excavate & haul off the spoil":"excavate (customer keeps the dirt — no haul-off)")+".",
    "Labor (the install): $"+c.laborSqft+"/sq ft · "+c.crew+"-person crew.",
    "Materials at COST, no markup — we provide: "+(ours.length?ours.join(", "):"none")+(theirs.length?("; customer provides: "+theirs.join(", ")):".")];
  return { serviceId:"", name:"Paver patio / pad install (full premium build)", unit:"job", price:c.price, qty:1, cost:c.cost, notes:notes, bandKey:"paver",
    breakdown:[ (WZ.pv.L)+"×"+(WZ.pv.W)+" = "+Math.round(c.area)+" sq ft · labor $"+c.laborSqft+"/sq ft + materials at cost" ] };
}
function pvPickupItem(pk){
  return { serviceId:"", name:"Materials pickup & delivery ("+pk.crew+"-person run)", unit:"job", price:pk.charge, qty:1, cost:pk.cost, bandKey:"paver", _pickup:true, estHours:pk.hoursEach, estCrew:pk.crew,
    notes:["Haul OUR materials from "+(pk.addr||"the supplier")+" → the site, then unload.",
      "~"+pk.tons+" ton ("+pk.weight+" lb) · "+pk.trips+" trip(s) · "+pk.crew+" people × ~"+pk.hoursEach+" hr — heavy manual handling, no forklift.",
      "Customer-service rate $"+pk.rate+"/hr each (softer than install). Customer can provide/haul materials to skip this."],
    breakdown:[ pk.weight+" lb · "+pk.trips+" trip(s) · "+pk.crew+" × ~"+pk.hoursEach+" hr @ $"+pk.rate+"/hr" ] };
}

window.wizPaverStart = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  if (!WZ.pv) WZ.pv = { L:10, W:10, sqft:PAVER_LABOR_DEF, crew:2, mats:{}, matCosts:{}, pickupAddr:"", pickupLat:null, pickupLng:null, pickupRate:PAVER_PICKUP_RATE_DEF, pickupCrew:2 };
  pvMatNorm();
  WZ.svc = "paver"; WZ.disc = 0; WZ.discPct = null;
  WZ.step = "calc"; if (typeof render==="function") render();
};
window.openPaverEst = window.wizPaverStart;

/* Change-order: re-open the full paver builder for a saved quote. If the quote carried its builder inputs
   (WZ.pv, restored by openQuote) use them; otherwise reconstruct size/labor/crew/materials from the saved
   line so old quotes are still fully editable. Keeps WZ.id + customer + any discount. */
window.wizPaverEdit = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  const it = WZ.items && WZ.items[0];
  if (!WZ._pvFromSave && it) {
    if (!WZ.pv) WZ.pv = { L:10, W:10, sqft:PAVER_LABOR_DEF, crew:2, mats:{}, matCosts:{}, pickupAddr:"", pickupLat:null, pickupLng:null, pickupRate:PAVER_PICKUP_RATE_DEF, pickupCrew:2 };
    const bd = [].concat(it.breakdown||[]).join(" "), nt = [].concat(it.notes||[]).join(" ");
    const lw = /(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)/.exec(bd); if (lw) { WZ.pv.L=+lw[1]; WZ.pv.W=+lw[2]; }
    const ls = /labor \$(\d+(?:\.\d+)?)/.exec(bd); if (ls) WZ.pv.sqft=+ls[1];
    const cr = /(\d+)-person crew/.exec(nt); if (cr) WZ.pv.crew=Math.max(1,Math.min(4,+cr[1]));
    const theirs = ((/customer provides:\s*([^.]+)/i.exec(nt)||[])[1]||"").toLowerCase();
    if (!WZ.pv.mats) WZ.pv.mats = {};
    PAVER_MATS.forEach(m => { WZ.pv.mats[m.key] = theirs.indexOf(m.label.toLowerCase())>=0 ? "them" : "us"; });
  }
  pvMatNorm();
  WZ.svc = "paver"; WZ.step = "calc"; if (typeof render==="function") render();
};

function pvTier(perHr){ const TGT=(typeof QE!=="undefined"?QE.TAKE_HOME:45), CF=(typeof QE!=="undefined"?QE.CREW_FLOOR:30); return perHr>=TGT?2 : perHr>=CF?1 : 0; }
function pvPayNote(tier){ return tier===2?'<span style="color:var(--accent)">✓ Clears your $45/hr floor.</span>':tier===1?'<span style="color:#b8860b">🟡 Below $45 but clears the $30/hr crew floor — good for Chase/Pierce.</span>':'<span style="color:var(--danger)">🔴 Below the $30/hr crew floor — slide up.</span>'; }
function pvZone(labor){ const mid=(PAVER_LABOR_BAND.lo+PAVER_LABOR_BAND.hi)/2; return labor<PAVER_LABOR_BAND.lo?["underpriced","#c1121f"]:labor<mid?["good value","#1a7f37"]:labor<=PAVER_LABOR_BAND.hi?["premium","#b8860b"]:["above market","#c1121f"]; }
function pvCrewBtns(cur, fn){ return [1,2,3,4].map(n=>`<button class="btn ${cur===n?"acc":"ghost"} sm" style="flex:0 0 auto;min-width:34px;padding:4px 0" onclick="${fn}(${n})">${n}</button>`).join(""); }
function pvCplxBtns(cur){ return [[1,"▢ Simple"],[1.25,"Cuts & angles"],[1.5,"Curves & transitions"]].map(o=>`<button class="btn ${cur===o[0]?"acc":"ghost"} sm" style="flex:1 1 0;padding:5px 4px;font-size:11.5px;white-space:normal;line-height:1.15" onclick="wizPvComplexity(${o[0]})">${o[1]}</button>`).join(""); }
function pvPickupInfoHTML(pk){
  if (!pk.has) return "";
  const ex = (pk.exact||pk.suspect) ? "" : ` <span style="color:#b8860b">— est.; add the supplier address for exact</span>`;
  const legs = (!pk.manual && !pk.suspect && pk.legBP!=null && pk.legPS!=null) ? `base→supplier ${pk.legBP} mi + supplier→site ${pk.legPS} mi = ` : "";
  const milesTxt = pk.manual ? `${pk.miles} mi (you set it)` : pk.suspect ? `~${pk.miles} mi (estimate)` : `${legs}${pk.miles} mi`;
  const warn = (pk.suspect && !pk.manual) ? `<div class="sub" style="color:var(--danger);margin-top:2px">⚠ The geocoder put the supplier <b>${pk.legBP} mi</b> away — that's wrong. Using a ~${pk.miles} mi estimate for now. Re-pick the supplier from the dropdown, or just <b>type the real miles</b> below.</div>` : "";
  const override = `<div class="row" style="gap:6px;align-items:center;margin-top:5px"><div class="grow sub">${pk.manual?'✓ <b>Using your miles</b>':'Drive off? Set the run miles'} <span style="opacity:.7">(base→supplier→site)</span>:</div><input type="number" inputmode="decimal" value="${pk.manual?pk.miles:''}" placeholder="auto ${pk.miles}" style="width:72px;padding:3px 6px;font-size:13px" onchange="wizPvPickMiles(this.value)"><span class="sub">mi</span></div>`;
  const tip = pk.trips>=2 ? `<div class="sub" style="color:#b8860b;margin-top:4px">💡 ${pk.trips} trips / ${pk.tons} ton — having the supplier <b>deliver</b> (~$50–150 flat) usually beats self-haul once it's 2+ trips. Or have the customer provide it.</div>` : "";
  return `<div class="row" style="gap:6px;align-items:center;margin-bottom:4px"><div class="grow sub">Pickup crew</div>${pvCrewBtns(pk.crew,"wizPvPickCrew")}</div>⚖️ ~${pk.tons} ton (${pk.weight} lb) · ${pk.trips} trip(s) · ${pk.crew} × ~${pk.hoursEach} hr<br>🚗 ${milesTxt}${pk.trips>1?` × ${pk.trips} trips`:""}${ex}: mileage <b>${money(pk.cost)}</b>${warn}${override}<br><div class="row" style="justify-content:space-between;align-items:baseline;margin-top:4px"><div>Pickup charge <b>${money(pk.charge)}</b></div><div class="sub">each takes home <b>$${pk.rate}/hr</b></div></div><input type="range" min="${PAVER_PICKUP_RATE_MIN}" max="${PAVER_PICKUP_RATE_MAX}" step="1" value="${pk.rate}" oninput="wizPvPickRate(this.value)" style="width:100%;accent-color:#b8860b;margin-top:4px"><div class="sub" style="font-size:11px">Customer-service rate $${PAVER_PICKUP_RATE_MIN}→$${PAVER_PICKUP_RATE_MAX}/hr. ${pk.crew} ppl × ~${pk.hoursEach} hr = ~${pk.personHrs} person-hr of work.</div>${tip}`;
}

function wizPaverUI(){
  if (!WZ.pv) wizPaverStart();
  pvMatNorm();
  const pv = WZ.pv, c = pvCalc(), pk = pvPickup(c.area), perim = pvPerim();
  const items = [ pvItem(c) ]; if (pk.has) items.push(pvPickupItem(pk)); items[0].mkt = pvMarketBand(c.area, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity);
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;
  const total = c.price + (pk.has ? pk.charge : 0);

  const tier = pvTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const lo=PAVER_LABOR_MIN, hi=PAVER_LABOR_MAX, mid=(PAVER_LABOR_BAND.lo+PAVER_LABOR_BAND.hi)/2;
  const z1=(PAVER_LABOR_BAND.lo-lo)/(hi-lo)*100, z2=(mid-lo)/(hi-lo)*100, z3=(PAVER_LABOR_BAND.hi-lo)/(hi-lo)*100, mk=Math.min(99,Math.max(1,(c.laborSqft-lo)/(hi-lo)*100));
  const zone = pvZone(c.laborSqft);

  let h = `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">Paver patio / pad</div><div class="nm" style="font-size:18px">One-page quote</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;
  if (WZ.cust && WZ.cust.name) h += `<div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(WZ.cust.name)}</div>${WZ.cust.address?`<div class="sub">${esc(WZ.cust.address)}</div>`:""}<button class="btn ghost sm" style="margin-top:6px" onclick="WZ.step='cust';render()">↩ Change customer / property</button></div>`;
  h += `<div class="card"><div class="row" style="gap:8px">
    <div class="grow"><label style="margin-top:0">Length (ft)</label><input type="number" inputmode="decimal" value="${pv.L}" min="1" onchange="wizPvField('L',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Width (ft)</label><input type="number" inputmode="decimal" value="${pv.W}" min="1" onchange="wizPvField('W',this.value)"></div>
    <div style="align-self:flex-end;padding-bottom:8px;font-weight:800">= ${Math.round(c.area)} sq ft</div></div>
    <div class="sub" style="margin-top:2px">perimeter ${Math.round(perim)} ft (edging)</div></div>`;
  // shape / layout complexity — a skinny-into-wide or curvy run is more layout + cuts than a clean square
  h += `<div class="card" style="padding:10px"><div class="grow" style="margin-bottom:6px"><b>Shape / layout</b> <span class="sub">cuts, curves &amp; transitions = more layout + labor</span></div><div class="row" style="gap:6px">${pvCplxBtns(c.complexity)}</div>${c.complexity>1?`<div class="sub" style="margin-top:6px;color:#b8860b">+${Math.round((c.complexity-1)*100)}% on labor time &amp; price — a skinny-into-wide or curvy run isn't a clean square.</div>`:""}</div>`;
  // per-material selectors with EDITABLE price (unit-aware)
  h += `<div class="card"><div style="font-weight:800;margin-bottom:6px">🧱 Materials — who provides each? <span class="sub" style="font-weight:400">we = pass-through at cost</span></div>`;
  h += PAVER_MATS.map(m=>{ const we = pvMats()[m.key]==="us", cost = pvMatCost(m.key), qty = m.unit==="ft"?perim:c.area, u = m.unit==="ft"?"ft":"sq ft"; return `<div class="row" style="gap:6px;align-items:center;margin-bottom:5px"><div class="grow"><b>${m.label}</b> ${we?`$<input type="number" inputmode="decimal" value="${cost}" step="0.25" min="0" style="width:58px;display:inline-block;padding:2px 5px;font-size:13px" onchange="wizPvMatCost('${m.key}',this.value)">/${u} <span class="sub">= ${money(Math.round(qty*cost))}</span>`:`<span class="sub">~$${cost}/${u}</span>`}</div>${[["us","We get it"],["cust","They provide"]].map(o=>`<button class="btn ${pvMats()[m.key]===o[0]?"acc":"ghost"} sm" style="flex:0 0 auto" onclick="wizPvMat('${m.key}','${o[0]}')">${o[1]}</button>`).join("")}</div>`; }).join("");
  const _spoilRaw = Math.round(c.area*(PAVER_DIG_IN/12)/27*1.35*PAVER_DIRT_TON), _spoilTons = Math.round(c.area*(PAVER_DIG_IN/12)/27*1.35*10)/10, _haul = WZ.pv.haulSpoil !== false;
  h += `<div class="row" style="gap:6px;align-items:center;margin:8px 0 2px;border-top:1px solid var(--line);padding-top:8px"><div class="grow"><b>🟫 Excavated dirt</b> ${_haul?`<span class="sub">~${_spoilTons} ton dug out · haul off + dump = ${money(_spoilRaw)}</span>`:`<span class="sub" style="color:var(--accent)">left on site — customer keeps it ($0)</span>`}</div><button class="btn ${_haul?"acc":"ghost"} sm" style="flex:0 0 auto" onclick="wizPvSpoil(1)">Haul off</button><button class="btn ${!_haul?"acc":"ghost"} sm" style="flex:0 0 auto" onclick="wizPvSpoil(0)">Leave it</button></div>`;
  h += `<div class="sub" style="margin-top:4px">Defaults are real-price estimates — change any to the actual cost. Quote premium pavers; drop only if they ask for cheaper. Your labor price never changes with these.</div></div>`;
  // pickup mini-quote
  if (pk.has) h += `<div class="card" style="border-left:4px solid #b8860b"><div style="font-weight:800;margin-bottom:4px">🚚 Materials pickup — its own run</div>
    <label style="margin-top:0">Where are we picking up?</label>
    <div class="acwrap"><input id="pv_pickaddr" value="${esc(pv.pickupAddr||"")}" placeholder="Supplier address…" autocomplete="off" oninput="addrSuggest('pv_pickaddr','pv_pickbox')" onchange="wizPvGeoPickup(this.value)"><div class="acbox" id="pv_pickbox"></div></div>
    <div id="pv_pickinfo" style="margin-top:6px;white-space:normal;font-size:13px;line-height:1.8">${pvPickupInfoHTML(pk)}</div></div>`;
  // LABOR slider + crew + band + paving pay check
  h += `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:baseline"><div class="nm" style="font-size:28px" id="pv_price">${money(total)}</div><div style="text-align:right"><div class="nm" style="font-size:18px" id="pv_rate">$${c.laborSqft}/sq ft labor</div><div class="sub" id="pv_allin">paving ${money(c.price)}${pk.has?` + pickup ${money(pk.charge)}`:""}</div></div></div>
    <input type="range" min="${lo}" max="${hi}" step="0.5" value="${pv.sqft}" oninput="wizPvSqft(this.value)" style="width:100%;accent-color:var(--accent);margin-top:8px">
    <div id="pv_mktband" style="margin-top:6px">${(typeof pvBandHTML==="function"&&items[0].mkt)?pvBandHTML(items[0].mkt,total):""}</div>
    <div class="row" style="gap:6px;align-items:center;margin-top:8px"><div class="grow sub">Paving crew</div>${pvCrewBtns(c.crew,"wizPvCrew")}</div>
    <div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px"><div class="row" style="gap:14px;flex-wrap:wrap"><div class="grow"><div class="sub" id="pv_hrs">Paving: ${c.crew} people × ~${c.hours} hr each</div><div class="sub">drive + build + mobilization</div></div><div class="grow" style="text-align:right"><div class="sub">Paving — per hour each</div><div class="nm" style="font-size:20px;color:${tCol}" id="pv_payhr">${money(c.perHr)}/hr ${tIcon}</div></div></div>
    <div class="sub" id="pv_paynote" style="margin-top:4px">${pvPayNote(tier)}</div></div></div>`;
  h += `<div class="card" id="pv_break">${pvBreakHTML(c, pk)}</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="wizPrint()">🖨 Print / PDF</button><button class="btn ghost grow" onclick="wizCopy()">Copy text</button></div>`;
  h += `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b id="pv_foot">${money(total)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Services</button><button class="btn acc grow" onclick="wizFinish()">Save & present →</button></div>`;
  return h;
}
function pvBreakHTML(c, pk){
  let s = `<div style="font-size:13px;line-height:1.9">🔨 Labor: ${Math.round(c.area)} sq ft × $${c.laborSqft}/sq ft${c.complexity>1?` × ${c.complexity} (shape)`:""} (${c.crew} crew): <b>${money(c.laborPrice)}</b><br>🧱 Materials — pass-through at cost: <b>+${money(c.materials)}</b> <span class="sub">(our materials ${money(c.matCost)} + spoil ${money(c.spoilTip)})</span><br>🚗 Drive — static (~${c.dr.rt} mi RT): <b>+${money(c.driveCharge)}</b>`;
  if (pk && pk.has) s += `<br>🚚 Materials pickup (own line, ${pk.crew}-person @ $${pk.rate}/hr): <b>+${money(pk.charge)}</b>`;
  s += `<br><span class="sub">Materials net <b>$0</b> to you (pass-through) — paving profit ${money(c.profit)} is labor + drive only.</span></div>`;
  return s;
}
window.wizPvField = function (k, v) { if (!WZ.pv) return; WZ.pv[k] = Math.max(0, parseFloat(v)||0); render(); };
window.wizPvMat = function (key, v) { if (!WZ.pv) return; if (!WZ.pv.mats) WZ.pv.mats = {}; WZ.pv.mats[key] = v; render(); };
window.wizPvSpoil = function (v) { if (!WZ.pv) return; WZ.pv.haulSpoil = !!v; render(); };   // haul the dig-out dirt (default) vs leave it for the customer
window.wizPvMatCost = function (key, v) { if (!WZ.pv) return; if (!WZ.pv.matCosts) WZ.pv.matCosts = {}; WZ.pv.matCosts[key] = Math.max(0, parseFloat(v)||0); render(); };
window.wizPvCrew = function (n) { if (!WZ.pv) return; WZ.pv.crew = Math.max(1, n); render(); };
window.wizPvComplexity = function (v) { if (!WZ.pv) return; WZ.pv.complexity = Math.max(1, +v || 1); render(); };
window.wizPvPickCrew = function (n) { if (!WZ.pv) return; WZ.pv.pickupCrew = Math.max(1, n); render(); };
window.wizPvGeoPickup = function (addr) {
  if (!WZ.pv) return; WZ.pv.pickupAddr = addr;
  if (!addr) { WZ.pv.pickupLat = null; WZ.pv.pickupLng = null; if (typeof render==="function") render(); return; }
  const inp = document.getElementById("pv_pickaddr");                          // if they PICKED a suggestion, use its exact coords — re-geocoding the text is what landed Lowe's 400mi off
  if (inp && inp.dataset && inp.dataset.pickLat) {
    WZ.pv.pickupLat = +inp.dataset.pickLat; WZ.pv.pickupLng = +inp.dataset.pickLng;
    delete inp.dataset.pickLat; delete inp.dataset.pickLng;
    if (typeof render==="function") render(); return;
  }
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(addr))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d[0]) { WZ.pv.pickupLat = +d[0].lat; WZ.pv.pickupLng = +d[0].lon; } if (typeof render==="function") render(); })
    .catch(function () { if (typeof render==="function") render(); });
};
window.wizPvPickMiles = function (v) { if (!WZ.pv) return; const n = parseFloat(v); WZ.pv.pickupMiles = (n>0) ? n : 0; if (typeof render==="function") render(); };   // manual round-trip override
window.wizPvPickRate = function (v) {
  if (!WZ.pv) return; WZ.pv.pickupRate = parseInt(v,10) || PAVER_PICKUP_RATE_DEF;
  const c = pvCalc(), pk = pvPickup(c.area);
  const items = [ pvItem(c) ]; if (pk.has) items.push(pvPickupItem(pk)); items[0].mkt = pvMarketBand(c.area, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity); WZ.items = items;
  const total = c.price + (pk.has ? pk.charge : 0);
  const info = document.getElementById("pv_pickinfo"); if (info) info.innerHTML = pvPickupInfoHTML(pk);
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("pv_price", money(total)); set("pv_foot", money(total)); set("pv_allin", "paving "+money(c.price)+(pk.has?" + pickup "+money(pk.charge):""));
  const br=document.getElementById("pv_break"); if(br)br.innerHTML=pvBreakHTML(c, pk);
  const mb=document.getElementById("pv_mktband"); if(mb&&typeof pvBandHTML==="function")mb.innerHTML=pvBandHTML(items[0].mkt,total);
  if(typeof wizAutosave==="function")wizAutosave();
};
window.wizPvSqft = function (v) {
  if (!WZ.pv) return; WZ.pv.sqft = parseFloat(v) || PAVER_LABOR_DEF;
  const c = pvCalc(), pk = pvPickup(c.area);
  const items = [ pvItem(c) ]; if (pk.has) items.push(pvPickupItem(pk)); items[0].mkt = pvMarketBand(c.area, c.materials + c.driveCharge + (pk.has?pk.charge:0), c.crew*c.hours, c.complexity);
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;
  const total = c.price + (pk.has ? pk.charge : 0);
  const tier = pvTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const lo=PAVER_LABOR_MIN, hi=PAVER_LABOR_MAX, mk=Math.min(99,Math.max(1,(c.laborSqft-lo)/(hi-lo)*100)), zone = pvZone(c.laborSqft);
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("pv_price", money(total)); set("pv_foot", money(total)); set("pv_rate", "$"+c.laborSqft+"/sq ft labor"); set("pv_allin", "paving "+money(c.price)+(pk.has?" + pickup "+money(pk.charge):""));
  set("pv_payhr", money(c.perHr)+"/hr "+tIcon); const ph=document.getElementById("pv_payhr"); if(ph)ph.style.color=tCol;
  const mb=document.getElementById("pv_mktband"); if(mb&&typeof pvBandHTML==="function")mb.innerHTML=pvBandHTML(items[0].mkt,total);
  const pn=document.getElementById("pv_paynote"); if(pn)pn.innerHTML=pvPayNote(tier);
  const br=document.getElementById("pv_break"); if(br)br.innerHTML=pvBreakHTML(c, pk);
  if(typeof wizAutosave==="function")wizAutosave();
};
