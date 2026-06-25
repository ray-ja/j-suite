/* ---------- PAVER PATIO / PAD — ONE-PAGE QUOTE MACHINE ----------
   One screen: L×W, who supplies/picks up the pavers, and a LABOR $/sq ft SLIDER you drag along the
   market band while the total + the $45/$30 pay check update live.

   PRICING MODEL (Ray, 2026-06-25): PRICE is set by LABOR only — the band/value/$ per sq ft is the worth
   of your INSTALL work, not the pavers. Materials (pavers + base + spoil) are a PURE PASS-THROUGH: added
   to the total at cost, never marked up, never eaten — so toggling "we supply / customer supplies" moves
   the TOTAL by exactly the material cost and your labor profit doesn't budge.

   PICKUP (Ray, 2026-06-25): if WE haul the pavers it's a real 2-PERSON RUN, not a flat fee — heavy manual
   load + unload + long carry (no forklift at the house). It's priced as its OWN line (mileage from the
   supplier ADDRESS through the site + 2-person labor) so it can become a sub-job assigned to a different
   person, who's paid for the run — not a full split of the paving. Customer self-haul = $0, no line. */
const PAVER_AVG_COST   = 7;     // $/sq ft — AVERAGE premium paver material (pass-through; placeholder until they pick)
const PAVER_BASE_FULL  = 3.35;  // $/sq ft — crushed stone + sand + polymeric (pass-through)
const PAVER_DIG_IN     = 8;     // inches excavated → spoil-haul volume
const PAVER_DIRT_TON   = 45;    // $/ton spoil tipping
const PAVER_LABOR_DEF  = 16;    // default LABOR $/sq ft (materials are separate, on top, at cost)
const PAVER_LABOR_MIN  = 8, PAVER_LABOR_MAX = 30;   // labor slider range
const PAVER_LABOR_BAND = { lo: 12, hi: 22 };        // good-value LABOR $/sq ft band (tunable; pay check is the real guide)
const PAVER_PICKUP_CREW    = 2;    // a pickup is priced as a 2-person job (heavy, no forklift)
const PAVER_PICKUP_BASE_MIN= 30;   // fixed handling minutes (strap/rig)
const PAVER_PICKUP_PER_SQFT= 0.5;  // + load/unload/carry minutes per sq ft of pavers (heavy manual handling)
const PAVER_PICKUP_DEF_MI  = 20;   // fallback loop miles until the supplier address is geocoded

function pvSiteLatLng(){ const pid=(typeof WZ!=="undefined")&&WZ.cust&&WZ.cust.propertyId; if(pid){const p=(D().properties||[]).find(x=>x.id===pid); if(p&&p.lat!=null)return {lat:p.lat,lng:p.lng};} return null; }

/* the pickup run as its OWN priced unit — real mileage (base→supplier→site→base) + 2-person labor.
   Charged at the loaded rate so whoever runs it clears the $45/hr floor. */
function pvPickup(area){
  const pv = WZ.pv || {};
  const MIL=(typeof QE!=="undefined"?QE.MILEAGE:0.725), LOADED=(typeof QE!=="undefined"?QE.TAKE_HOME/QE.FIELD_SPLIT:93.75);
  if (pv.pickup!=="us") return { has:false, charge:0, cost:0, miles:0, personHrs:0, hoursEach:0, perHr:0, exact:false, addr:"" };
  let loopMi = PAVER_PICKUP_DEF_MI, exact = false;
  const site = pvSiteLatLng();
  if (pv.pickupLat!=null && typeof driveFromBase==="function") {
    const bp = driveFromBase(pv.pickupLat, pv.pickupLng);   // base → supplier (one-way)
    let ps = 0; if (site && typeof haversineMi==="function") { const hv = haversineMi(pv.pickupLat, pv.pickupLng, site.lat, site.lng); if (hv!=null) ps = hv*1.3; }
    const sb = site ? ((driveFromBase(site.lat, site.lng)||{}).miles||0) : 0;   // site → base
    if (bp) { loopMi = Math.round((bp.miles + ps + sb)*10)/10; exact = true; }
  }
  const driveMin = Math.round(loopMi/35*60);
  const handleMin = Math.round(PAVER_PICKUP_BASE_MIN + Math.max(0,area)*PAVER_PICKUP_PER_SQFT);
  const crew = PAVER_PICKUP_CREW, personHrs = crew*(driveMin+handleMin)/60;
  const mileage = Math.round(loopMi*MIL), labor = Math.round(personHrs*LOADED);
  const charge = Math.round((mileage+labor)/5)*5, profit = charge - mileage;
  const perHr = personHrs>0 ? Math.floor(profit*0.48/personHrs) : 0;
  return { has:true, charge, cost:mileage, miles:loopMi, exact, driveMin, handleMin, crew, personHrs:Math.round(personHrs*10)/10, hoursEach:Math.round((driveMin+handleMin)/60*10)/10, perHr, addr:pv.pickupAddr||"" };
}

function pvCalc(){
  const pv = WZ.pv || {}, area = Math.max(0, (pv.L||0)*(pv.W||0)), laborSqft = pv.sqft || PAVER_LABOR_DEF;
  const dr = (typeof wizSiteDriveRT==="function") ? wizSiteDriveRT() : {rt:20,min:30};
  const MIL = (typeof QE!=="undefined"?QE.MILEAGE:0.725), LOADED = (typeof QE!=="undefined"?QE.TAKE_HOME/QE.FIELD_SPLIT:93.75);
  const driveCharge = Math.round(dr.rt*MIL + 2*(dr.min/60)*LOADED), driveMileage = Math.round(dr.rt*MIL);
  const laborPrice = Math.round(area*laborSqft/25)*25;   // LABOR = your value (clean $25)
  const paverMat = (pv.supply==="us") ? Math.round(area*PAVER_AVG_COST) : 0;
  const baseMat = Math.round(area*PAVER_BASE_FULL), spoilTip = Math.round(area*(PAVER_DIG_IN/12)/27*1.35*PAVER_DIRT_TON);
  const materials = paverMat + baseMat + spoilTip;   // pure pass-through — same in price AND cost → zero margin
  const price = laborPrice + materials + driveCharge;   // the PAVING line (pickup is its own line)
  const cost = materials + driveMileage;
  const profit = price - cost, allInSqft = area>0 ? Math.round(price/area) : 0;
  const mpu = area<150 ? 6 : area<300 ? 5 : 4.5;
  const workMin = Math.round(area*mpu) + 120;   // + ~2 crew-hr mobilization
  const crew = 2, totalPH = (workMin/60) + crew*(dr.min/60) + crew*(20/60), hours = crew>0?totalPH/crew:totalPH;
  const fieldPool = Math.max(0, profit)*0.48, perHr = hours>0 ? fieldPool/crew/hours : 0;
  return { area, laborSqft, laborPrice, materials, allInSqft, price, cost, paverMat, baseMat, spoilTip, driveCharge, dr, crew, hours: Math.round(hours*10)/10, perHr: Math.floor(perHr), profit };
}

function pvItem(c){
  const pv = WZ.pv || {};
  const notes = ["Full premium build — stone base + sand + polymeric + edging + excavate/haul spoil.",
    "Labor (the install): $"+c.laborSqft+"/sq ft.",
    "Materials billed at COST — no markup: "+(pv.supply==="us" ? "we supply the pavers ("+money(c.paverMat)+") + base/spoil." : "customer-supplied pavers; base/spoil at cost.")];
  return { serviceId:"", name:"Paver patio / pad install (full premium build)", unit:"job", price:c.price, qty:1, cost:c.cost, notes:notes, bandKey:"paver",
    breakdown:[ pv.L+"×"+pv.W+" = "+Math.round(c.area)+" sq ft · labor $"+c.laborSqft+"/sq ft + materials at cost" ] };
}
function pvPickupItem(pk){
  return { serviceId:"", name:"Paver pickup & delivery (2-person run)", unit:"job", price:pk.charge, qty:1, cost:pk.cost, bandKey:"paver", _pickup:true,
    notes:["Pickup from "+(pk.addr||"the supplier")+" → the site, then unload.",
      "Priced as a 2-person job: "+pk.miles+" mi loop (base → supplier → site) + heavy manual load/unload, no forklift, possible long carry.",
      "Customer can self-haul the pavers to the site to skip this charge."],
    breakdown:[ pk.miles+" mi · 2 people × ~"+pk.hoursEach+" hr" ] };
}

window.wizPaverStart = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  if (!WZ.pv) WZ.pv = { L:10, W:10, sqft:PAVER_LABOR_DEF, supply:"us", pickup:"us", pickupAddr:"", pickupLat:null, pickupLng:null };
  WZ.svc = "paver"; WZ.disc = 0; WZ.discPct = null;
  WZ.step = "calc"; if (typeof render==="function") render();
};
window.openPaverEst = window.wizPaverStart;

function pvTier(perHr){ const TGT=(typeof QE!=="undefined"?QE.TAKE_HOME:45), CF=(typeof QE!=="undefined"?QE.CREW_FLOOR:30); return perHr>=TGT?2 : perHr>=CF?1 : 0; }
function pvPayNote(tier){ return tier===2?'<span style="color:var(--accent)">✓ Clears your $45/hr floor.</span>':tier===1?'<span style="color:#b8860b">🟡 Below $45 but clears the $30/hr crew floor — good for Chase/Pierce.</span>':'<span style="color:var(--danger)">🔴 Below the $30/hr crew floor — slide up.</span>'; }
function pvZone(labor){ const mid=(PAVER_LABOR_BAND.lo+PAVER_LABOR_BAND.hi)/2; return labor<PAVER_LABOR_BAND.lo?["underpriced","#c1121f"]:labor<mid?["good value","#1a7f37"]:labor<=PAVER_LABOR_BAND.hi?["premium","#b8860b"]:["above market","#c1121f"]; }
function pvPickupInfoHTML(pk){
  if (!pk.has) return "";
  const ex = pk.exact ? "" : ` <span style="color:#b8860b">— estimated ${pk.miles} mi; add the supplier address for exact mileage</span>`;
  const t = pvTier(pk.perHr), col = ["var(--danger)","#b8860b","var(--accent)"][t], ic = ["🔴","🟡","✓"][t];
  return `🚗 ${pk.miles} mi loop (base → supplier → site)${ex}: mileage <b>${money(pk.cost)}</b><br>💪 2 people × ~${pk.hoursEach} hr — heavy manual load/unload, no forklift<br>Pickup charge <b>${money(pk.charge)}</b> · <span style="color:${col}">${money(pk.perHr)}/hr each ${ic}</span>`;
}

function wizPaverUI(){
  if (!WZ.pv) WZ.pv = { L:10, W:10, sqft:PAVER_LABOR_DEF, supply:"us", pickup:"us", pickupAddr:"", pickupLat:null, pickupLng:null };
  const pv = WZ.pv, c = pvCalc(), pk = pvPickup(c.area);
  const items = [ pvItem(c) ]; if (pk.has) items.push(pvPickupItem(pk));
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;   // the PAVING is the main job; pickup is its own line
  const total = c.price + (pk.has ? pk.charge : 0);

  const tier = pvTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const lo=PAVER_LABOR_MIN, hi=PAVER_LABOR_MAX, mid=(PAVER_LABOR_BAND.lo+PAVER_LABOR_BAND.hi)/2;
  const z1=(PAVER_LABOR_BAND.lo-lo)/(hi-lo)*100, z2=(mid-lo)/(hi-lo)*100, z3=(PAVER_LABOR_BAND.hi-lo)/(hi-lo)*100, mk=Math.min(99,Math.max(1,(c.laborSqft-lo)/(hi-lo)*100));
  const zone = pvZone(c.laborSqft);

  let h = `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">Paver patio / pad</div><div class="nm" style="font-size:18px">One-page quote</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;
  if (WZ.cust && WZ.cust.name) h += `<div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(WZ.cust.name)}</div>${WZ.cust.address?`<div class="sub">${esc(WZ.cust.address)}</div>`:""}<button class="btn ghost sm" style="margin-top:6px" onclick="WZ.step='cust';render()">↩ Change customer / property</button></div>`;
  h += `<div class="card"><div class="row" style="gap:8px">
    <div class="grow"><label style="margin-top:0">Length (ft)</label><input type="number" inputmode="decimal" value="${pv.L}" min="1" oninput="wizPvField('L',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Width (ft)</label><input type="number" inputmode="decimal" value="${pv.W}" min="1" oninput="wizPvField('W',this.value)"></div>
    <div style="align-self:flex-end;padding-bottom:8px;font-weight:800">= ${Math.round(c.area)} sq ft</div></div></div>`;
  h += `<div class="card"><label style="margin-top:0">Who supplies the pavers?</label>
    <div class="row" style="gap:6px">${[["us","We supply"],["cust","Customer supplies"]].map(o=>`<button class="btn ${pv.supply===o[0]?"acc":"ghost"} sm grow" onclick="wizPvSet('supply','${o[0]}')">${o[1]}</button>`).join("")}</div>
    <label>Who picks them up?</label>
    <div class="row" style="gap:6px">${[["us","We pick up (2-person run)"],["cust","Customer self-hauls ($0)"]].map(o=>`<button class="btn ${pv.pickup===o[0]?"acc":"ghost"} sm grow" onclick="wizPvSet('pickup','${o[0]}')">${o[1]}</button>`).join("")}</div>
    <div class="sub" style="margin-top:6px">Pavers are <b>pass-through at cost</b> either way — your labor price never changes. The pickup is the only labor charge here.</div></div>`;
  // pickup card (its own priced line — can become a sub-job assigned to a different person)
  if (pk.has) h += `<div class="card" style="border-left:4px solid #b8860b"><div style="font-weight:800;margin-bottom:4px">🚚 Paver pickup — its own 2-person run</div>
    <label style="margin-top:0">Where are we picking up the pavers?</label>
    <div class="acwrap"><input id="pv_pickaddr" value="${esc(pv.pickupAddr||"")}" placeholder="Supplier address…" autocomplete="off" oninput="addrSuggest('pv_pickaddr','pv_pickbox')" onchange="wizPvGeoPickup(this.value)"><div class="acbox" id="pv_pickbox"></div></div>
    <div class="sub" id="pv_pickinfo" style="margin-top:6px;white-space:normal">${pvPickupInfoHTML(pk)}</div></div>`;
  // LABOR slider + band + paving pay check
  h += `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:baseline"><div class="nm" style="font-size:28px" id="pv_price">${money(total)}</div><div style="text-align:right"><div class="nm" style="font-size:18px" id="pv_rate">$${c.laborSqft}/sq ft labor</div><div class="sub" id="pv_allin">paving ${money(c.price)}${pk.has?` + pickup ${money(pk.charge)}`:""}</div></div></div>
    <input type="range" min="${lo}" max="${hi}" step="0.5" value="${pv.sqft}" oninput="wizPvSqft(this.value)" style="width:100%;accent-color:var(--accent);margin-top:8px">
    <div style="position:relative;height:13px;background:linear-gradient(90deg,#f1a9a9 0 ${z1}%,#9ed89e ${z1}% ${z2}%,#ffd97a ${z2}% ${z3}%,#ef9a6b ${z3}% 100%);border-radius:7px"><div id="pv_mk" style="position:absolute;top:-3px;bottom:-3px;left:${mk}%;width:3px;background:#0b1f3a"></div></div>
    <div class="sub" style="font-size:12px;margin-top:3px">📊 <b id="pv_zone" style="color:${zone[1]}">${zone[0]}</b> · $${PAVER_LABOR_BAND.lo}–$${PAVER_LABOR_BAND.hi}/sq ft <b>labor</b> band (materials extra, at cost)</div>
    <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><div class="row" style="gap:14px;flex-wrap:wrap"><div class="grow"><div class="sub" id="pv_hrs">Paving: ${c.crew} people × ~${c.hours} hr each</div><div class="sub">drive + build + mobilization</div></div><div class="grow" style="text-align:right"><div class="sub">Paving — per hour each</div><div class="nm" style="font-size:20px;color:${tCol}" id="pv_payhr">${money(c.perHr)}/hr ${tIcon}</div></div></div>
    <div class="sub" id="pv_paynote" style="margin-top:4px">${pvPayNote(tier)}</div></div></div>`;
  h += `<div class="card" id="pv_break">${pvBreakHTML(c, pk)}</div>`;
  h += `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="wizPrint()">🖨 Print / PDF</button><button class="btn ghost grow" onclick="wizCopy()">Copy text</button></div>`;
  h += `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b id="pv_foot">${money(total)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Services</button><button class="btn acc grow" onclick="wizFinish()">Save & present →</button></div>`;
  return h;
}
function pvBreakHTML(c, pk){
  const pv = WZ.pv || {};
  let s = `<div style="font-size:13px;line-height:1.9">🔨 Labor: ${Math.round(c.area)} sq ft × $${c.laborSqft}/sq ft: <b>${money(c.laborPrice)}</b><br>🧱 Materials — pass-through at cost: <b>+${money(c.materials)}</b> <span class="sub">(${pv.supply==="us"?"pavers "+money(c.paverMat)+" + ":"customer's pavers + "}base ${money(c.baseMat)} + spoil ${money(c.spoilTip)})</span><br>🚗 Drive — static (~${c.dr.rt} mi RT): <b>+${money(c.driveCharge)}</b>`;
  if (pk && pk.has) s += `<br>🚚 Paver pickup (own line, 2-person): <b>+${money(pk.charge)}</b>`;
  s += `<br><span class="sub">Materials net <b>$0</b> to you (pass-through) — paving profit ${money(c.profit)} is labor + drive only.</span></div>`;
  return s;
}
window.wizPvField = function (k, v) { if (!WZ.pv) return; WZ.pv[k] = Math.max(0, parseFloat(v)||0); render(); };
window.wizPvSet = function (k, v) { if (!WZ.pv) return; WZ.pv[k] = v; render(); };
/* geocode the supplier address (async) → exact pickup mileage, then re-render */
window.wizPvGeoPickup = function (addr) {
  if (!WZ.pv) return; WZ.pv.pickupAddr = addr;
  if (!addr) { WZ.pv.pickupLat = null; WZ.pv.pickupLng = null; if (typeof render==="function") render(); return; }
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(addr))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d[0]) { WZ.pv.pickupLat = +d[0].lat; WZ.pv.pickupLng = +d[0].lon; } if (typeof render==="function") render(); })
    .catch(function () { if (typeof render==="function") render(); });
};
/* live slider — recompute the PAVING (labor) + total in place, smooth drag */
window.wizPvSqft = function (v) {
  if (!WZ.pv) return; WZ.pv.sqft = parseFloat(v) || PAVER_LABOR_DEF;
  const c = pvCalc(), pk = pvPickup(c.area);
  const items = [ pvItem(c) ]; if (pk.has) items.push(pvPickupItem(pk));
  WZ.items = items; WZ.crewN = c.crew; WZ.hours = c.hours;
  const total = c.price + (pk.has ? pk.charge : 0);
  const tier = pvTier(c.perHr), tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const lo=PAVER_LABOR_MIN, hi=PAVER_LABOR_MAX, mk=Math.min(99,Math.max(1,(c.laborSqft-lo)/(hi-lo)*100)), zone = pvZone(c.laborSqft);
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("pv_price", money(total)); set("pv_foot", money(total)); set("pv_rate", "$"+c.laborSqft+"/sq ft labor"); set("pv_allin", "paving "+money(c.price)+(pk.has?" + pickup "+money(pk.charge):""));
  set("pv_payhr", money(c.perHr)+"/hr "+tIcon); const ph=document.getElementById("pv_payhr"); if(ph)ph.style.color=tCol;
  const zn=document.getElementById("pv_zone"); if(zn){zn.textContent=zone[0];zn.style.color=zone[1];}
  const m=document.getElementById("pv_mk"); if(m)m.style.left=mk+"%";
  const pn=document.getElementById("pv_paynote"); if(pn)pn.innerHTML=pvPayNote(tier);
  const br=document.getElementById("pv_break"); if(br)br.innerHTML=pvBreakHTML(c, pk);
  if(typeof wizAutosave==="function")wizAutosave();
};
