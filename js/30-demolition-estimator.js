/* ---------- SHED / STRUCTURE DEMOLITION ESTIMATOR (on-site quoting) ----------
   Tear-down + haul-off pricing for sheds and small outbuildings.
   Cost model (no hourly labor line — crew is paid from the revenue split):
     cost = C&D disposal (tons × $73.16, EVERY pound billable) + round-trip mileage + consumables.
   Price is set by value bands (footprint) and pushed toward the top by the factors that
   actually make the job harder: shingles, wood floor, anchors, bad access, height, uncleared.
   Drive is static-from-the-property (site + a full dump run, since demo is must-dump). "Review quote →"
   routes through the wizard review for the $45/$30 pay check, the demo market band, and customer linking. */
var DEMO_TON_FEE   = 73.16;   // mixed C&D, per ton (Dare County transfer)
/* ⛔ NO FREE ALLOWANCE. Ray, 2026-08-26: "the station only waives some trash once per year its irrelevant
   and shouldn't be in any quote tool."
   The 500 lb waiver is an ANNUAL RESIDENTIAL allowance — a household's once-a-year cleanout, not something a
   contractor gets on every load. Subtracting it from a job quote under-costed EVERY C&D dump line by
   500/2000 × $73.16 = $18.29, silently and in the customer's favour, on every job that hauled.
   ⚠️ THIS IS THE THIRD TIME THE SAME MISTAKE HAS BEEN CAUGHT (see VEG_FREE below, corrected 2026-07-25, and
   Dare's free residential yard site that excludes contractor debris). The pattern: a rate sheet written for
   households gets read as if it applied to the business. If a disposal number is described as free, assume it
   is free for a RESIDENT and check what the commercial line says before it reaches a quote. */

var DEMO_CONSUM    = 25;      // blades, fuel for saws, bags, fasteners (flat allowance)

/* lbs of debris from footprint + build. Calibrated so a small-medium wood shed lands ~1–2 tons. */
function demoWeight(area, h, roof, floor, anchor){
  const hf   = Math.max(0.7, Math.min(1.8, (h||8)/8));        // taller walls = more framing/siding
  const struct = area * 12 * hf;                              // framing, sheathing, siding
  const roofL  = roof==="shingles" ? area*1.2*2.5 : roof==="metal" ? area*1.2*1.0 : 0;
  const floorL = floor==="wood" ? area*5 : 0;                 // dirt / slab-stays add nothing to haul
  const anchorL= anchor==="concrete" ? 250 : anchor==="light" ? 50 : 0;
  return Math.round(struct + roofL + floorL + anchorL);
}
/* value bands by footprint (sq ft) — [low, high] $ */
function demoBand(area){
  if(area<=64)  return [350,450];   // ≤ 8×8
  if(area<=120) return [450,650];   // 8×10 – 10×12
  if(area<=176) return [600,850];   // bridge toward the top band
  return [700,1000];                // 12×16+
}

window.openDemoEst=function(){
  if(!window._demoCrew)window._demoCrew=2;
  modal("Shed / Structure Demolition",`
    <p class="muted" style="margin:0 0 8px">Tear-down + haul-off. The price updates live as you tap. Crew labor is paid from the revenue split, so it isn't a cost line — only disposal, drive, and consumables are.</p>
    <div class="row" style="gap:8px">
      <div class="grow"><label>Footprint length (ft)</label><input id="dm_l" type="number" inputmode="decimal" value="8" min="1" oninput="demoCalc()"></div>
      <div class="grow"><label>Width (ft)</label><input id="dm_w" type="number" inputmode="decimal" value="10" min="1" oninput="demoCalc()"></div>
      <div class="grow"><label>Wall height (ft)</label><input id="dm_h" type="number" inputmode="decimal" value="8" min="1" oninput="demoCalc()"></div>
    </div>
    <label>Roof</label>
    <select id="dm_roof" onchange="demoCalc()"><option value="shingles">Asphalt shingles</option><option value="metal">Metal</option><option value="none">None / open</option></select>
    <label>Floor</label>
    <select id="dm_floor" onchange="demoCalc()"><option value="wood">Wood floor (haul it)</option><option value="dirt">Dirt / gravel (nothing to haul)</option><option value="slab">Concrete slab — stays (not removed)</option></select>
    <label>Anchoring</label>
    <select id="dm_anchor" onchange="demoCalc()"><option value="none">None</option><option value="light">Light (ground anchors / straps)</option><option value="concrete">Concrete footings</option></select>
    <label>Access</label>
    <select id="dm_access" onchange="demoCalc()"><option value="easy">Easy — truck/trailer reaches it</option><option value="tight">Tight — long carry / hand-out</option></select>
    <div class="toggle"><input type="checkbox" id="dm_cleared" checked onchange="demoCalc()"><label style="margin:0">Contents already cleared out</label></div>
    <div class="row" style="gap:6px;align-items:center;margin-top:8px"><div class="grow sub" style="font-weight:700">Crew on this job</div><span id="dm_crew">${(typeof pvCrewBtns==="function")?pvCrewBtns(window._demoCrew||2,"demoSetCrew"):""}</span></div>
    <div class="sub" style="margin-top:6px">🚗 Drive is figured automatically — to the property + a full dump run (demo debris is must-dump).</div>

    <div class="card" id="dm_break" style="margin-top:12px"></div>
    <div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center;margin-top:8px"><div style="font-size:13px;font-weight:700">PRICE TO GIVE</div><div id="dm_price" style="font-size:32px;font-weight:800;line-height:1.1">$0</div><div id="dm_band" style="font-size:12px;opacity:.85"></div></div>

    <div class="card" style="border-left:4px solid var(--danger);font-size:12.5px;line-height:1.55">
      <b>Excluded — say this out loud:</b><br>
      • <b>No concrete-slab removal.</b> Slabs/foundations are a separate quote (breaking + hauling concrete is heavy work).<br>
      • <b>Power must be disconnected by the owner</b> before we touch it — any wired sub-panel, lights, or outlets killed at the source.<br>
      • <b>Contents emptied first.</b> We demo an empty structure. If it's full, add the junk line — <a href="#" onclick="closeModal();openJunkEst();return false">open the Junk / Move-Out estimator</a> for that load.
    </div>

    <label>Save under customer / job name</label><input id="dm_name" placeholder="e.g. Wilson backyard shed">
    <button class="btn acc" style="margin-top:10px" onclick="saveDemoQuote()">Review quote →</button>`);
  setTimeout(demoCalc,40);
};

window.demoCalc=function(){
  const L=parseFloat(val("dm_l"))||0, W=parseFloat(val("dm_w"))||0, H=parseFloat(val("dm_h"))||8;
  const roof=val("dm_roof")||"shingles", floor=val("dm_floor")||"wood", anchor=val("dm_anchor")||"none";
  const access=val("dm_access")||"easy";
  const cleared=(document.getElementById("dm_cleared")||{}).checked!==false;
  const area=Math.max(0,L*W);

  // --- weight + C&D tipping ---
  const lbs=demoWeight(area,H,roof,floor,anchor), tons=lbs/2000;
  const billLbs=Math.max(0,lbs);
  const disposal=Math.round(billLbs/2000*DEMO_TON_FEE*100)/100;
  const consum=DEMO_CONSUM+(anchor==="concrete"?15:0);   // extra blades for cutting footings
  // --- STATIC drive from the property address + a FULL dump run (demo is must-dump, can't be stashed) ---
  const crew=window._demoCrew||2;
  const dr=(typeof wizDriveCharge==="function")?wizDriveCharge(crew):{charge:0,miles:0,min:0};
  const MIL=(typeof QE!=="undefined"?QE.MILEAGE:0.725), LOADED=(typeof QE!=="undefined"?QE.TAKE_HOME/QE.FIELD_SPLIT:93.75), DUMPMI=(typeof DISPOSAL_TRIP_MILES!=="undefined"?DISPOSAL_TRIP_MILES:55);
  const dumpRun=Math.round(DUMPMI*MIL+(80/60)*LOADED);
  const driveCharge=dr.charge+dumpRun, driveMileage=Math.round((dr.miles+DUMPMI)*MIL);
  const cost=Math.round((disposal+consum+driveMileage)*100)/100;   // hard cost = tipping + consumables + drive mileage (no labor line)

  // --- value-band price for the tear-down, pushed toward the top by the hard factors ---
  const [lo,hi]=demoBand(area);
  let push=0;
  if(roof==="shingles")push+=0.25; if(floor==="wood")push+=0.20;
  if(anchor==="concrete")push+=0.30; else if(anchor==="light")push+=0.10;
  if(access==="tight")push+=0.25; if(H>8)push+=0.15; if(!cleared)push+=0.20;
  push=Math.min(1,push);
  const workPrice=Math.round((lo+(hi-lo)*push)/25)*25;
  const grand=workPrice+driveCharge;
  const workMin=Math.round(area*4.5*(1+push*0.5));   // tear-down + load minutes, scaled by the hard factors → pay check
  const _totalPH=(workMin/60)+crew*((dr.min+80)/60)+crew*(20/60);
  const _perHr=_totalPH>0?Math.floor((grand-cost)*0.48/_totalPH):0;
  const _hrsEach=crew>0?Math.round(_totalPH/crew*10)/10:0;
  const _tier=_perHr>=(typeof QE!=="undefined"?QE.TAKE_HOME:45)?2:_perHr>=(typeof QE!=="undefined"?QE.CREW_FLOOR:30)?1:0;

  // --- breakdown ---
  const b=document.getElementById("dm_break");
  if(b)b.innerHTML=`<div style="font-size:13px;line-height:1.85">
      Footprint: <b>${L}×${W} = ${Math.round(area)} sq ft</b> · ${H} ft walls<br>
      Est. debris: <b>${lbs.toLocaleString()} lb (${tons.toFixed(2)} ton)</b><br>
      C&amp;D tipping (${Math.round(billLbs).toLocaleString()} lb @ $${DEMO_TON_FEE}/ton): <b>${money(disposal)}</b><br>
      Consumables (blades/fuel/bags): <b>${money(consum)}</b><br>
      🚗 Drive — static (~${dr.miles} mi site + ${DUMPMI} mi dump run): <b>${money(driveCharge)}</b>
    </div>
    <div class="sub" style="margin-top:6px">Value band for this footprint: ${money(lo)}–${money(hi)}.${push>=1?" Factors max it toward the top.":""} Demolition ${money(workPrice)} + drive ${money(driveCharge)} = <b>${money(grand)}</b>.</div>
    <div class="row" style="justify-content:space-between;align-items:baseline;margin-top:6px"><div class="sub">${crew} ${crew===1?"person":"people"} × ~${_hrsEach} hr each</div><div class="nm" style="font-size:17px;color:${["var(--danger)","#b8860b","var(--accent)"][_tier]}">${money(_perHr)}/hr each ${["⚠","⚠","✓"][_tier]}</div></div>`;
  const p=document.getElementById("dm_price");if(p)p.textContent=money(grand);
  const bd=document.getElementById("dm_band");if(bd)bd.textContent=`work ${money(workPrice)} (band ${money(lo)}–${money(hi)}) + drive ${money(driveCharge)}${!cleared?" · contents NOT cleared — quote junk separately":""}`;

  window._demo={workPrice:workPrice,price:grand,cost:cost,lbs:lbs,tons:tons,disposal:disposal,driveCharge:driveCharge,driveMin:(dr.min+80),mins:workMin,consum:consum,area:area,L:L,W:W,H:H,crew:crew};
};
window.demoSetCrew=function(n){window._demoCrew=Math.max(1,n);const r=document.getElementById("dm_crew");if(r&&typeof pvCrewBtns==="function")r.innerHTML=pvCrewBtns(window._demoCrew,"demoSetCrew");demoCalc();};

window.saveDemoQuote=function(){
  const d=window._demo||{};
  const grand=d.price||0;
  if(!(grand>0)){alert("Enter the footprint first.");return;}
  if(typeof WZON==="undefined"||!WZON||typeof WZ==="undefined"||!WZ){alert("Open this from a quote so it links the customer.");return;}
  const nm=val("dm_name"); if(nm&&WZ.cust&&!WZ.cust.name)WZ.cust.name=nm;
  const notes=["Shed/structure demolition + haul-off.","Excludes: no slab removal · power disconnected by owner · contents emptied first.","Must-dump — price includes a full dump run + C&D tipping ("+(d.tons||0).toFixed(2)+" ton)."];
  WZ.items=WZ.items||[];
  WZ.items.push({serviceId:"",name:"Shed / structure demolition + haul-off",unit:"job",price:grand,qty:1,cost:d.cost||0,notes:notes,bandKey:"demo",breakdown:(d.L&&d.W)?[d.L+"×"+d.W+" = "+Math.round(d.area)+" sq ft · "+(d.tons||0).toFixed(2)+" ton"]:[]});
  const crew=d.crew||window._demoCrew||2, totalPH=((d.mins||0)/60)+crew*((d.driveMin||0)/60)+crew*(20/60);
  WZ.crewN=crew; WZ.hours=totalPH>0?Math.round(totalPH/crew*10)/10:0;
  WZ.modalBuilt=true;   // modal-built → review hides back-to-build (rebuild via the picker)
  closeModal(); WZ.step="review"; render();
};
