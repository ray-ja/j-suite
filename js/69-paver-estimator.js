/* ---------- PAVER PATIO / PAD — ONE-PAGE QUOTE MACHINE ----------
   Pavers are simple enough to quote on a single screen: L×W, who supplies/picks up the pavers, and a
   $/sq ft SLIDER you drag along the market band while the price, the per-sq-ft rate, and the $45/$30
   pay check update live. We build it RIGHT every time (full crushed-stone base + sand + polymeric +
   edging + excavate/haul spoil) — so there's no base-prep choice. Drive is static from the property.
   Labor calibrated from 2026 research: ~0.10-0.12 crew-hr/sq ft on small jobs (a 10×10 ≈ 12 crew-hrs),
   tapering to ~0.075 on big jobs, plus a fixed mobilization minimum so a small pad isn't underpriced. */
const PAVER_AVG_COST   = 7;     // $/sq ft — AVERAGE premium paver material (a placeholder until they pick)
const PAVER_BASE_FULL  = 3.35;  // $/sq ft — crushed stone + sand + polymeric (the full proper build)
const PAVER_DIG_IN     = 8;     // inches excavated → spoil-haul volume
const PAVER_DIRT_TON   = 45;    // $/ton spoil tipping
const PAVER_PICKUP     = 75;    // $ paver pickup fee — a supplier run (drive + load) when WE haul them
const PAVER_PICKUP_MI  = 20;    // round-trip miles of that supplier run (mileage cost)
const PAVER_SQFT_DEF   = 22;    // default all-in $/sq ft
const PAVER_SQFT_MIN   = 12, PAVER_SQFT_MAX = 35;   // slider range
const PAVER_BAND       = { lo: 18, hi: 30 };        // good-value $/sq ft band (premium coastal market)

function pvCalc(){
  const pv = WZ.pv || {}, area = Math.max(0, (pv.L||0)*(pv.W||0)), sqft = pv.sqft || PAVER_SQFT_DEF;
  const dr = (typeof wizSiteDriveRT==="function") ? wizSiteDriveRT() : {rt:20,min:30};
  const MIL = (typeof QE!=="undefined"?QE.MILEAGE:0.725), LOADED = (typeof QE!=="undefined"?QE.TAKE_HOME/QE.FIELD_SPLIT:93.75);
  const driveCharge = Math.round(dr.rt*MIL + 2*(dr.min/60)*LOADED);
  const pickupFee = (pv.pickup==="us") ? PAVER_PICKUP : 0, pickupMil = pickupFee>0 ? Math.round(PAVER_PICKUP_MI*MIL) : 0;
  const work = Math.round(area*sqft);
  const price = Math.max(0, Math.ceil((work + driveCharge + pickupFee)/25)*25);
  const paverMat = (pv.supply==="us") ? Math.round(area*PAVER_AVG_COST) : 0;
  const baseMat = Math.round(area*PAVER_BASE_FULL);
  const spoilTip = Math.round(area*(PAVER_DIG_IN/12)/27*1.35*PAVER_DIRT_TON);
  const cost = paverMat + baseMat + spoilTip + Math.round(dr.rt*MIL) + pickupMil;
  const mpu = area<150 ? 6 : area<300 ? 5 : 4.5;   // crew-min/sq ft, taper on big jobs (research-calibrated)
  const workMin = Math.round(area*mpu) + 120;       // + ~2 crew-hr mobilization (setup/compactor/spoil) — small jobs don't scale down
  const crew = 2, totalPH = (workMin/60) + crew*(dr.min/60) + crew*(20/60), hours = crew>0?totalPH/crew:totalPH;
  const fieldPool = Math.max(0, price-cost)*0.48, perHr = hours>0 ? fieldPool/crew/hours : 0;
  return { area, sqft, work, price, cost, paverMat, baseMat, spoilTip, driveCharge, pickupFee, dr, crew, hours: Math.round(hours*10)/10, perHr: Math.floor(perHr), profit: price-cost };
}

function pvItem(c){
  const pv = WZ.pv || {};
  const notes = ["Full premium build — stone base + sand + polymeric + edging + excavate/haul spoil.",
    pv.supply==="us" ? "Pavers: we supply — included in the price (avg estimate; adjust once they pick)." : "Pavers: customer-supplied.",
    pv.pickup==="us" ? ("We pick up the pavers (+"+money(c.pickupFee)+") — customer can self-haul to the site to save this.") : "Customer hauls the pavers to the site (no pickup fee)."];
  return { serviceId:"", name:"Paver patio / pad install (full premium build)", unit:"job", price:c.price, qty:1, cost:c.cost, notes:notes, bandKey:"paver",
    breakdown:[ pv.L+"×"+pv.W+" = "+Math.round(c.area)+" sq ft @ $"+c.sqft+"/sq ft" ] };
}

/* entry from the service picker — go straight to the one-page paver builder (no modal) */
window.wizPaverStart = function () {
  if (typeof WZ === "undefined" || !WZ) return;
  if (!WZ.pv) WZ.pv = { L:10, W:10, sqft:PAVER_SQFT_DEF, supply:"us", pickup:"us" };
  WZ.svc = "paver"; WZ.disc = 0; WZ.discPct = null;
  WZ.step = "calc"; if (typeof render==="function") render();
};
window.openPaverEst = window.wizPaverStart;   // any legacy entry point routes to the one-page builder

function wizPaverUI(){
  if (!WZ.pv) WZ.pv = { L:10, W:10, sqft:PAVER_SQFT_DEF, supply:"us", pickup:"us" };
  const pv = WZ.pv, c = pvCalc();
  WZ.items = [ pvItem(c) ]; WZ.crewN = c.crew; WZ.hours = c.hours;   // keep the quote line live for the save

  const TGT = (typeof QE!=="undefined"?QE.TAKE_HOME:45), CF = (typeof QE!=="undefined"?QE.CREW_FLOOR:30);
  const tier = c.perHr>=TGT?2 : c.perHr>=CF?1 : 0, tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  // $/sq ft band (colored zones) — marker at the current rate
  const lo=PAVER_SQFT_MIN, hi=PAVER_SQFT_MAX, z1=(PAVER_BAND.lo-lo)/(hi-lo)*100, z2=((PAVER_BAND.lo+PAVER_BAND.hi)/2-lo)/(hi-lo)*100, z3=(PAVER_BAND.hi-lo)/(hi-lo)*100, mk=Math.min(99,Math.max(1,(c.sqft-lo)/(hi-lo)*100));
  const zone = c.sqft<PAVER_BAND.lo?["underpriced","#c1121f"]:c.sqft<(PAVER_BAND.lo+PAVER_BAND.hi)/2?["good value","#1a7f37"]:c.sqft<=PAVER_BAND.hi?["premium","#b8860b"]:["above market","#c1121f"];

  let h = `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">Paver patio / pad</div><div class="nm" style="font-size:18px">One-page quote</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;
  if (WZ.cust && WZ.cust.name) h += `<div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(WZ.cust.name)}</div>${WZ.cust.address?`<div class="sub">${esc(WZ.cust.address)}</div>`:""}<button class="btn ghost sm" style="margin-top:6px" onclick="WZ.step='cust';render()">↩ Change customer / property</button></div>`;
  // size
  h += `<div class="card"><div class="row" style="gap:8px">
    <div class="grow"><label style="margin-top:0">Length (ft)</label><input type="number" inputmode="decimal" value="${pv.L}" min="1" oninput="wizPvField('L',this.value)"></div>
    <div class="grow"><label style="margin-top:0">Width (ft)</label><input type="number" inputmode="decimal" value="${pv.W}" min="1" oninput="wizPvField('W',this.value)"></div>
    <div style="align-self:flex-end;padding-bottom:8px;font-weight:800">= ${Math.round(c.area)} sq ft</div></div></div>`;
  // pavers: supply + pickup
  h += `<div class="card"><label style="margin-top:0">Who supplies the pavers?</label>
    <div class="row" style="gap:6px">${[["us","We supply (in the price)"],["cust","Customer supplies"]].map(o=>`<button class="btn ${pv.supply===o[0]?"acc":"ghost"} sm grow" onclick="wizPvSet('supply','${o[0]}')">${o[1]}</button>`).join("")}</div>
    <label>Who picks them up?</label>
    <div class="row" style="gap:6px">${[["us","We pick up (+"+money(PAVER_PICKUP)+")"],["cust","Customer self-hauls ($0)"]].map(o=>`<button class="btn ${pv.pickup===o[0]?"acc":"ghost"} sm grow" onclick="wizPvSet('pickup','${o[0]}')">${o[1]}</button>`).join("")}</div>
    <div class="sub" style="margin-top:6px">We never mark up <i>buying</i> the pavers — only the pickup run. Customer can haul them to the site to skip the fee.</div></div>`;
  // the $/sq ft slider + band + live price + pay check
  h += `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:baseline"><div class="nm" style="font-size:28px" id="pv_price">${money(c.price)}</div><div style="text-align:right"><div class="nm" style="font-size:18px" id="pv_rate">$${c.sqft}/sq ft</div><div class="sub" id="pv_profit">profit ${money(c.profit)}</div></div></div>
    <input type="range" min="${lo}" max="${hi}" step="0.5" value="${pv.sqft}" oninput="wizPvSqft(this.value)" style="width:100%;accent-color:var(--accent);margin-top:8px">
    <div style="position:relative;height:13px;background:linear-gradient(90deg,#f1a9a9 0 ${z1}%,#9ed89e ${z1}% ${z2}%,#ffd97a ${z2}% ${z3}%,#ef9a6b ${z3}% 100%);border-radius:7px"><div id="pv_mk" style="position:absolute;top:-3px;bottom:-3px;left:${mk}%;width:3px;background:#0b1f3a"></div></div>
    <div class="sub" style="font-size:12px;margin-top:3px">📊 <b id="pv_zone" style="color:${zone[1]}">${zone[0]}</b> · $${PAVER_BAND.lo}–$${PAVER_BAND.hi}/sq ft market range (all-in)</div>
    <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><div class="row" style="gap:14px;flex-wrap:wrap"><div class="grow"><div class="sub" id="pv_hrs">${c.crew} people × ~${c.hours} hr each</div><div class="sub">drive + build + mobilization</div></div><div class="grow" style="text-align:right"><div class="sub">Per hour each</div><div class="nm" style="font-size:20px;color:${tCol}" id="pv_payhr">${money(c.perHr)}/hr ${tIcon}</div></div></div>
    <div class="sub" id="pv_paynote" style="margin-top:4px">${tier===2?'<span style="color:var(--accent)">✓ Clears your $45/hr floor.</span>':tier===1?'<span style="color:#b8860b">🟡 Below $45 but clears the $30/hr crew floor — good for Chase/Pierce.</span>':'<span style="color:var(--danger)">🔴 Below the $30/hr crew floor — slide up.</span>'}</div></div></div>`;
  // breakdown
  h += `<div class="card" id="pv_break">${pvBreakHTML(c)}</div>`;
  // collateral + save
  h += `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="wizPrint()">🖨 Print / PDF</button><button class="btn ghost grow" onclick="wizCopy()">Copy text</button></div>`;
  h += `<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b id="pv_foot">${money(c.price)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Services</button><button class="btn acc grow" onclick="wizFinish()">Save & present →</button></div>`;
  return h;
}
function pvBreakHTML(c){
  const pv = WZ.pv || {};
  return `<div style="font-size:13px;line-height:1.9">📐 ${Math.round(c.area)} sq ft × $${c.sqft}/sq ft (all-in): <b>${money(c.work)}</b>${pv.supply==="us"?` <span class="sub">— incl. pavers</span>`:""}<br>🚗 Drive — static (~${c.dr.rt} mi RT): <b>+${money(c.driveCharge)}</b>${c.pickupFee>0?`<br>🧱 Paver pickup run: <b>+${money(c.pickupFee)}</b>`:""}<br><span class="sub">Hard cost ${money(c.cost)} (${pv.supply==="us"?"pavers "+money(c.paverMat)+" + ":""}base ${money(c.baseMat)} + spoil ${money(c.spoilTip)} + mileage) · profit <b>${money(c.profit)}</b></span></div>`;
}
window.wizPvField = function (k, v) { if (!WZ.pv) return; WZ.pv[k] = Math.max(0, parseFloat(v)||0); render(); };
window.wizPvSet = function (k, v) { if (!WZ.pv) return; WZ.pv[k] = v; render(); };
/* live slider — recompute + update the DOM in place (don't full-render, so the drag is smooth) */
window.wizPvSqft = function (v) {
  if (!WZ.pv) return; WZ.pv.sqft = parseFloat(v) || PAVER_SQFT_DEF;
  const c = pvCalc(); WZ.items = [ pvItem(c) ]; WZ.crewN = c.crew; WZ.hours = c.hours;
  const TGT = (typeof QE!=="undefined"?QE.TAKE_HOME:45), CF = (typeof QE!=="undefined"?QE.CREW_FLOOR:30);
  const tier = c.perHr>=TGT?2 : c.perHr>=CF?1 : 0, tCol = ["var(--danger)","#b8860b","var(--accent)"][tier], tIcon = ["⚠","⚠","✓"][tier];
  const lo=PAVER_SQFT_MIN, hi=PAVER_SQFT_MAX, mk=Math.min(99,Math.max(1,(c.sqft-lo)/(hi-lo)*100));
  const zone = c.sqft<PAVER_BAND.lo?["underpriced","#c1121f"]:c.sqft<(PAVER_BAND.lo+PAVER_BAND.hi)/2?["good value","#1a7f37"]:c.sqft<=PAVER_BAND.hi?["premium","#b8860b"]:["above market","#c1121f"];
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set("pv_price", money(c.price)); set("pv_foot", money(c.price)); set("pv_rate", "$"+c.sqft+"/sq ft"); set("pv_profit", "profit "+money(c.profit));
  set("pv_payhr", money(c.perHr)+"/hr "+tIcon); const ph=document.getElementById("pv_payhr"); if(ph)ph.style.color=tCol;
  const zn=document.getElementById("pv_zone"); if(zn){zn.textContent=zone[0];zn.style.color=zone[1];}
  const m=document.getElementById("pv_mk"); if(m)m.style.left=mk+"%";
  const pn=document.getElementById("pv_paynote"); if(pn)pn.innerHTML=tier===2?'<span style="color:var(--accent)">✓ Clears your $45/hr floor.</span>':tier===1?'<span style="color:#b8860b">🟡 Below $45 but clears the $30/hr crew floor — good for Chase/Pierce.</span>':'<span style="color:var(--danger)">🔴 Below the $30/hr crew floor — slide up.</span>';
  const br=document.getElementById("pv_break"); if(br)br.innerHTML=pvBreakHTML(c);
};
