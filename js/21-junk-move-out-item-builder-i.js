/* ---------- JUNK / MOVE-OUT ITEM BUILDER (inside the wizard) ---------- */
const JUNK_FULL=480;      // cu ft in a standard 18-cu-yd junk truck = industry "full load"
const JUNK_EIGHTH=60;     // cu ft = 1/8 of a standard truck
const JUNK_TRIPBASE=60;   // $ base (drive + dump minimum)
const JUNK_PEREIGHTH=80;  // $ per 1/8-truck of volume
const JUNK_MIN=95;        // minimum job ($)
const JUNK_TON=94;        // Dare County transfer $/ton (heavy/dense overage)
const JUNK_DENSITY=15;    // lb per cu ft treated as normal household junk
const JUNK_DUMP_DEFAULT=450; // default roll-off dumpster $ (NC 20-yd ≈ $300–450/wk)
/* suggest the cheapest adequate haul method from the load volume (eighths ≈ 60-cu-ft pickup loads) */
function junkHaulSuggest(c){const loads=c.eighths;
  if(loads<=1.5)return{method:"pickup",label:"Pickup (self-haul)",note:loads<=1?"one trip":"1–2 trips"};
  if(loads<=4)return{method:"trailer",label:"Rental dump trailer",note:"a few loads"};
  return{method:"rolloff",label:(loads<=6?"20-yd":"30-yd")+" roll-off dumpster",note:"whole-house volume"};}
const JUNK_FEE={freon:45,mattress:25,tire:8,ewaste:30,paint:10,appliance:25};
const JUNK_BEDBUG_FEE=75; // RAY: confirm — precaution surcharge for infested mattresses/upholstery (bagging + sealed handling); a risk/handling premium, not a hard-cost line
const JUNK_SOFT_KEYS=["mat_t","mat_q","box","sofa","sectional","loveseat","recliner"]; // soft goods that can carry bed bugs
const JUNK_LOCF={ground:0,curbside:-0.15,upstairs:0.25,basement:0.30,attic:0.50,farcarry:0.20};
const JUNK_LOC=[["ground","Ground floor (no add)"],["curbside","Curbside / outside (−15% labor)"],["upstairs","Upstairs (+25% labor)"],["basement","Basement (+30% labor)"],["attic","Attic / crawlspace (+50% labor)"],["farcarry","Long carry / no driveway (+20% labor)"]];
/* per-item modifiers (checkboxes) — each adds LOADING TIME, which the engine prices at $45/hr */
const JUNK_MODS=[{k:"heavy",short:"🏋️ Heavy",timeMult:1.75},{k:"disasm",short:"🔧 Disassembly",flatMin:12},{k:"bolted",short:"🔩 Bolted/mounted",flatMin:8}];
// Home Depot rental reference. Trailers = 4-hr price as quoted. Trucks = per-75-min rate × 4 increments to cover a 4-hr job.
const JUNK_RENTAL=[["none","No rental — using my own truck",0],["t_lg","Lawn & garden trailer 3×5 (4 hr)",25],["t_cf","Channel-frame trailer 5×8 (4 hr)",39],["t_sw","Solid-wall trailer 5×8 (4 hr)",42],["t_d58","Dump trailer 5×8 (4 hr)",157],["t_d610","Dump trailer 6×10 (4 hr)",172],["t_d714","Dump trailer 7×14 (4 hr)",187],["k_pickup","8-ft pickup truck (4 hr = 4×$18)",72],["k_flat8","8-ft flatbed truck (4 hr = 4×$19)",76],["k_flat10","10-ft flatbed truck (4 hr = 4×$19)",76],["k_van","Cargo van (4 hr = 4×$19)",76],["k_box","Box truck (4 hr = 4×$29)",116]];
function getTruckCap(){try{const d=S.obx.docs.find(x=>x.id==="truckcap"&&!x.deleted);if(d)return parseFloat(d.text)||95;}catch(e){}return 95;}
window.setTruckCap=function(v){v=parseFloat(v)||95;let d=S.obx.docs.find(x=>x.id==="truckcap");if(d){d.text=String(v);d.updatedAt=now();}else S.obx.docs.push({id:"truckcap",text:String(v),updatedAt:now()});save();const el=document.getElementById("je_trips");if(el)el.textContent=(calcJunk().cuft/getTruckCap()).toFixed(1);};
// [key, name, cubic feet (as-loaded), weight lb, special-flag]
const JUNK_CAT=[
 ["Furniture",[["sofa","Sofa / couch",30,100,""],["sectional","Sectional (per piece)",40,130,""],["loveseat","Loveseat",22,80,""],["recliner","Recliner / armchair",20,75,""],["dining_t","Dining table",22,90,""],["chair","Chair (each)",5,15,""],["table_sm","Coffee / end table",6,30,""],["dresser","Dresser",18,110,""],["nightstand","Nightstand",5,30,""],["bookshelf","Bookshelf",12,55,""],["desk","Desk",16,80,""],["wardrobe","Wardrobe / armoire",28,140,""],["bedframe","Bed frame / headboard",12,55,""],["cabinet","China cabinet / hutch",28,140,""]]],
 ["Mattresses",[["mat_t","Mattress – twin / full",12,45,"mattress"],["mat_q","Mattress – queen / king",18,75,"mattress"],["box","Box spring",12,40,"mattress"]]],
 ["Appliances",[["fridge","Refrigerator",32,220,"freon"],["freezer","Chest freezer",25,150,"freon"],["wac","Window AC unit",4,60,"freon"],["dehum","Dehumidifier",4,40,"freon"],["washer","Washer",16,160,"appliance"],["dryer","Dryer",16,110,"appliance"],["stove","Stove / oven",18,150,"appliance"],["dish","Dishwasher",12,80,"appliance"],["wh","Water heater",14,120,"appliance"],["micro","Microwave",2,35,""]]],
 ["Electronics",[["tv_flat","TV – flat screen",5,35,"ewaste"],["tv_crt","TV – old / CRT",8,80,"ewaste"],["computer","Computer / monitor",3,20,"ewaste"],["e_misc","Box of electronics",3,25,"ewaste"]]],
 ["Outdoor / garage",[["grill","Grill",14,70,""],["mower","Lawn mower",14,80,""],["tire","Tire (each)",4,25,"tire"],["bike","Bicycle",8,25,""],["patio","Patio set (per piece)",16,70,""],["hottub","Hot tub",110,600,"heavy"],["propane","Propane tank",3,30,"paint"]]],
 ["Construction / debris",[["debris","Bag of debris",4,50,""],["carpet","Carpet – per room",18,90,""],["wood","Wood / lumber pile",24,260,"heavy"],["drywall","Drywall pile",20,400,"heavy"],["concrete","Concrete / brick (per load)",10,500,"heavy"],["fixture","Toilet / sink",10,80,""]]],
 ["Boxes / bags",[["box_s","Small box",1.5,20,""],["box_l","Large box",3,30,""],["bag","Trash bag",4,25,""],["tote","Tote / bin",3.5,30,""]]],
 ["Hazardous / special",[["paint","Paint can",1,12,"paint"],["chem","Chemical / solvent",1,12,"paint"]]]
];
function junkItem(key){for(const g of JUNK_CAT)for(const it of g[1])if(it[0]===key)return it;return null;}
/* per-unit load time (min): ~5 for a couch (30 cu ft), ~1 for a microwave (2 cu ft), × access bump */
function junkItemMin(cuft){ return 0.5 + 0.15 * cuft; }
function calcJunk(){
  const items=WZ.junk||[];let cuft=0,lbs=0,locLabor=0,special=0,counts={},softGoods=false,loadMin=0;
  items.forEach(li=>{const it=junkItem(li.key);if(!it)return;const q=li.qty||0,v=it[2]*q,w=it[3]*q;cuft+=v;lbs+=w;locLabor+=(v/JUNK_EIGHTH*JUNK_PEREIGHTH)*(JUNK_LOCF[li.loc]||0);let _m=1,_f=0;JUNK_MODS.forEach(md=>{if(li[md.k]){if(md.timeMult)_m*=md.timeMult;if(md.flatMin)_f+=md.flatMin;}});loadMin+=q*junkItemMin(it[2])*_m*(1+(JUNK_LOCF[li.loc]||0))+_f*q;if(q>0&&JUNK_SOFT_KEYS.indexOf(li.key)>=0)softGoods=true;const fl=it[4];if(fl&&JUNK_FEE[fl]){special+=JUNK_FEE[fl]*q;counts[fl]=(counts[fl]||0)+q;}});
  const bedbug=(WZ.junkBedbug&&softGoods)?JUNK_BEDBUG_FEE:0;
  const eighths=cuft/JUNK_EIGHTH;
  const haul=cuft>0?JUNK_TRIPBASE+eighths*JUNK_PEREIGHTH:0;
  const overLbs=Math.max(0,lbs-cuft*JUNK_DENSITY);
  const dump=Math.round(overLbs/2000*JUNK_TON);
  // haul method drives the rental passthrough (cost model unchanged — just the source of "rental")
  const meth=WZ.junkHaul||"pickup";let rental=0,rentalName="";
  if(meth==="trailer"){const ro=JUNK_RENTAL.find(r=>r[0]===(WZ.junkRental||"t_d58"));rental=ro?ro[2]:0;rentalName=ro?ro[1]:"";}
  else if(meth==="rolloff"){rental=WZ.junkDump!=null?(+WZ.junkDump||0):JUNK_DUMP_DEFAULT;rentalName=(WZ.junkDumpSize||"20")+"-yd roll-off dumpster";}
  let total=0;if(cuft>0)total=Math.max(JUNK_MIN,Math.ceil((haul+locLabor+special+dump+rental+bedbug)/25)*25);
  return {cuft:Math.round(cuft),lbs:Math.round(lbs),eighths:eighths,trips:cuft/getTruckCap(),haul:Math.round(haul),locLabor:Math.round(locLabor),special:special,dump:dump,rental:rental,rentalName:rentalName,total:total,counts:counts,softGoods:softGoods,bedbug:bedbug,loadMin:loadMin};
}
/* build the shared-engine object from the load: loading person-hours + drive + stash/dump + hard costs */
function junkEngineObj(c){
  const crew=WZ.junkCrew||2,mode=WZ.junkMode||"stash",loadingHrs=(c.loadMin||0)/60;
  return {crew:crew,onsiteHrs:crew>0?loadingHrs/crew:loadingHrs,siteMiles:WZ.junkSiteMiles!=null?WZ.junkSiteMiles:10,siteDriveHrs:(WZ.junkSiteMin!=null?WZ.junkSiteMin:20)/60,mode:mode,lbs:c.lbs,dtype:"cd",dumpMiles:WZ.junkDumpMiles!=null?WZ.junkDumpMiles:50,dumpHrs:(WZ.junkDumpMin!=null?WZ.junkDumpMin:80)/60,materials:(c.special||0)+(c.rental||0)+(c.bedbug||0)};
}
function wizJunkUI(){
  if(!WZ.junk)WZ.junk=[];
  const qof=k=>{const li=WZ.junk.find(x=>x.key===k);return li?li.qty:0;};
  const locof=k=>{const li=WZ.junk.find(x=>x.key===k);return li?li.loc:"ground";};
  let h=wizHead(3,5,"Junk / move-out — build the load");
  h+=crewAidCard("junk");
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">📋 How to use this (tap)</summary><div style="font-size:13px;line-height:1.6;margin-top:8px"><b>Walk every room with the customer.</b> Tap + on each item that's going, and set <b>where it is</b> — upstairs and attic cost more because they're harder to carry.<br><br><b>Reading the truck:</b> you don't have to eyeball it. The tool adds each item's real size. A <b>full load ≈ 450 cu ft</b> — about a 15-yard dump trailer, or a pickup bed stacked roughly 4 ft above the rails. Stuff stacked high still counts as volume, so just add everything.<br><br><b>When done:</b> read the total off the green bar, say it once, and stop talking.</div></details>`;
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">💬 What to say to the customer (tap)</summary><div style="font-size:13px;line-height:1.6;margin-top:8px">1. "Let's walk through everything that's going, room by room."<br>2. Add items as you go; confirm what stays vs. goes.<br>3. "Okay — for all of this, hauled away and disposed of properly, it's <b>[the number]</b>." Then stop talking.<br>4. If they hesitate: "That covers the labor, the hauling, the dump fees, and certified disposal of the appliances." Don't drop the price first.<br>5. "I can get this knocked out [today / this week] — want me to put you down?"<br>6. After: take before/after photos and text them the review link.</div></details>`;
  h+=`<div class="card" style="padding:10px"><input id="je_search" value="${esc(WZ.junkSearch||"")}" placeholder="🔎 Search items — type TV, carpet, fridge…" autocomplete="off" oninput="wizJSearch()" style="margin:0">${WZ.junkSearch?`<button class="btn ghost sm" style="margin-top:8px" onclick="WZ.junkSearch='';render()">✕ Clear search</button>`:""}</div>`;
  h+=`<div id="je_catalog">`+junkCatalogHTML()+`</div>`;
  const c=calcJunk(),cap=getTruckCap();
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">💵 How the price is built (tap)</summary><div style="font-size:12.5px;line-height:1.6;margin-top:8px"><b>Volume — industry standard:</b> priced by fraction of a standard junk truck. A <b>full truck ≈ 480 cu ft (18 cu yd)</b> — the size 1-800-GOT-JUNK and the big guys use; one eighth ≈ 60 cu ft. <b>$${JUNK_TRIPBASE} base + $${JUNK_PEREIGHTH} per 1/8 truck.</b><br><b>Location labor</b> adds to each item: curbside −15%, upstairs +25%, basement +30%, attic +50%, long carry +20%.<br><b>Special items</b> are flat disposal fees: Freon $45, mattress $25, tire $8, e-waste $30, paint $10, other appliance $25.<br><b>Heavy/dense loads</b> (concrete, drywall, piles of appliances) add a landfill surcharge by weight.<br>Rounds up to the nearest $25; $${JUNK_MIN} minimum.</div></details>`;
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">🚚 Equipment rental costs (Home Depot, ~4 hr) — reference</summary><div style="font-size:12px;line-height:1.7;margin-top:8px"><b>Trailers (tow with your truck, 4-hr rate):</b><br>Lawn &amp; garden 3×5 — $25 · Channel-frame 5×8 — $39 · Solid-wall 5×8 — $42 · Dump 5×8 — $157 · Dump 6×10 — $172 · Dump 7×14 — $187<br><b>Trucks (per 75 min; a 4-hr job = 4 increments):</b><br>8-ft pickup $18 → $72 · 8-ft flatbed $19 → $76 · 10-ft flatbed $19 → $76 · Cargo van $19 → $76 · Box truck $29 → $116<br><span class="sub">Reference only — add one below to fold it into this quote when a job needs the gear.</span></div></details>`;
  // how you'll haul it — pickup (default) / rental trailer / roll-off dumpster, with the cheapest-adequate suggestion
  const haul=WZ.junkHaul||"pickup",sug=junkHaulSuggest(c);
  h+=`<div class="card"><div style="font-weight:800;margin-bottom:6px">🚚 How you'll haul it</div>
    <div class="row" style="gap:6px">${[["pickup","Pickup<small style='display:block;font-weight:400;font-size:10px'>self-haul</small>"],["trailer","Rental trailer<small style='display:block;font-weight:400;font-size:10px'>tow it</small>"],["rolloff","Roll-off<small style='display:block;font-weight:400;font-size:10px'>dumpster</small>"]].map(m=>`<button class="btn ${haul===m[0]?'acc':'ghost'} sm grow" style="line-height:1.15" onclick="WZ.junkHaul='${m[0]}';${m[0]==='trailer'?"if(!WZ.junkRental)WZ.junkRental='t_d58';":""}render()">${m[1]}</button>`).join("")}</div>
    <div class="sub" style="margin-top:6px">💡 Cheapest adequate for ~${c.eighths.toFixed(1)} pickup loads: <b>${sug.label}</b> (${sug.note}). ${haul===sug.method?"<b>✓ selected</b>":`<a href="#" onclick="WZ.junkHaul='${sug.method}';${sug.method==='trailer'?"if(!WZ.junkRental)WZ.junkRental='t_d58';":""}render();return false">use it</a>`}</div>`;
  if(haul==="pickup")h+=`<div class="sub" style="margin-top:6px">Your own truck — no rental cost. Multi-trip; add round-trip miles on the review for fuel.</div>`;
  else if(haul==="trailer")h+=`<label style="margin-top:6px">Trailer / truck rental (Home Depot, ~4 hr)</label><select onchange="WZ.junkRental=this.value;render()" style="font-size:13px">${JUNK_RENTAL.filter(r=>r[0]!=="none").map(r=>`<option value="${r[0]}" ${(WZ.junkRental||"t_d58")===r[0]?"selected":""}>${esc(r[1])}${r[2]?" — $"+r[2]:""}</option>`).join("")}</select>`;
  else h+=`<div class="row" style="gap:8px;margin-top:6px"><div class="grow"><label style="margin-top:0">Dumpster size</label><select onchange="WZ.junkDumpSize=this.value;render()" style="font-size:13px"><option value="20" ${(WZ.junkDumpSize||"20")==="20"?"selected":""}>20-yd (~2 loads)</option><option value="30" ${WZ.junkDumpSize==="30"?"selected":""}>30-yd (~3–4 loads)</option></select></div><div class="grow"><label style="margin-top:0">Dumpster $</label><input type="number" value="${WZ.junkDump!=null?WZ.junkDump:JUNK_DUMP_DEFAULT}" onchange="WZ.junkDump=parseFloat(this.value)||0;render()"></div></div><div class="sub" style="margin-top:4px">NC roll-off: 20-yd ≈ $300–450/wk · 30-yd ≈ $350–500/wk. Price includes haul + tonnage — pass it through.</div>`;
  h+=`<button class="btn ghost" style="margin-top:10px" onclick="openTrailerBuy()">🧮 Buy vs. rent a trailer? — full analysis</button></div>`;
  // volume — pickup loads (F-150 bed ≈ 1/8 box-truck) vs box-truck loads
  const unit=WZ.junkUnit||"pickup",pickupLoads=c.eighths,boxLoads=c.eighths/8,fillPct=Math.min(100,Math.round(c.eighths/8*100));
  h+=`<div class="card"><div class="row" style="align-items:center"><div class="grow" style="font-weight:800">${unit==="pickup"?`≈ ${pickupLoads.toFixed(1)} pickup loads`:`≈ ${boxLoads.toFixed(2)} box-truck loads`}</div><button class="btn ghost sm" onclick="WZ.junkUnit='${unit==="pickup"?"box":"pickup"}';render()">${unit==="pickup"?"↔ box truck":"↔ my pickup"}</button></div>
    <div class="sub">${c.cuft} cu ft · ${c.lbs} lb · F-150 8-ft bed ≈ 1/8 box-truck load (60 cu ft) · box truck ≈ 480 cu ft (18 cu yd)</div>
    <div style="height:12px;background:var(--soft);border-radius:7px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${fillPct}%;background:var(--accent)"></div></div>
    <div class="sub" style="margin-top:6px">${unit==="pickup"?`${Math.ceil(pickupLoads)} pickup trip(s) at ~60 cu ft each (multi-load). Heaped beds carry more — priced by the standard truck.`:`${boxLoads.toFixed(2)} of a full box-truck load.`}</div>
    <div style="font-size:13px;line-height:1.9;margin-top:10px">Loading work: <b>${(c.loadMin/60).toFixed(1)} hr</b> (≈${Math.round(c.loadMin)} min, access-adjusted)${c.special?`<br>Special-item disposal cost: <b>${money(c.special)}</b>`:""}${c.dump?`<br>Heavy/dense surcharge: <b>${money(c.dump)}</b>`:""}${c.rental?`<br>Equipment rental: <b>${money(c.rental)}</b>`:""}</div></div>`;
  if(c.counts.freon)h+=`<div class="card" style="border-left:4px solid var(--danger);font-size:12.5px;line-height:1.5">❄️ ${c.counts.freon} Freon unit(s): refrigerant must be recovered by an EPA-certified tech before the Dare County landfill will take them. The price includes the fee — line up your recovery plan before hauling.</div>`;
  // Bed-bug precaution — only surfaced when soft goods (mattresses/upholstery) are in the load
  if(c.softGoods)h+=`<div class="card" style="border-left:4px solid var(--danger)"><label class="toggle" style="margin:0"><input type="checkbox" ${WZ.junkBedbug?"checked":""} onchange="wizJunkBedbug(this.checked)"><span style="margin:0;font-weight:700">🐛 Bed bugs present / suspected?</span></label>
    ${WZ.junkBedbug?`<div style="margin-top:8px;font-size:13px;line-height:1.6"><b>Precaution — bag &amp; seal on site.</b> Wrap the infested mattress/upholstery in plastic before it leaves the room, keep it off your other gear, and disclose it at the transfer station. Adds a <b>${money(JUNK_BEDBUG_FEE)}</b> handling surcharge. <span class="sub">RAY: confirm the fee.</span></div>`:`<div class="sub" style="margin-top:4px">Mattresses/upholstery in this load — ask the customer before you load. If yes, flip this on to add the precaution note + surcharge.</div>`}</div>`;
  // Crew, drive & disposal → priced by the shared $45/hr-take-home engine (js/70)
  const _crew=WZ.junkCrew||2,_mode=WZ.junkMode||"stash";
  h+=`<div class="card"><div style="font-weight:800;margin-bottom:6px">Crew, drive &amp; disposal</div>
    <div class="row" style="gap:8px"><div class="grow"><label style="margin-top:0">Crew (people)</label><input type="number" value="${_crew}" min="1" onchange="WZ.junkCrew=parseFloat(this.value)||2;render()"></div><div class="grow"><label style="margin-top:0">Drive to site — RT min</label><input type="number" value="${WZ.junkSiteMin!=null?WZ.junkSiteMin:20}" min="0" onchange="WZ.junkSiteMin=parseFloat(this.value)||0;render()"></div></div>
    <label>Drive to site — RT miles</label><input type="number" value="${WZ.junkSiteMiles!=null?WZ.junkSiteMiles:10}" min="0" onchange="WZ.junkSiteMiles=parseFloat(this.value)||0;render()">
    <label>Where does it go?</label><select onchange="WZ.junkMode=this.value;render()"><option value="stash" ${_mode==="stash"?"selected":""}>Stash at the warehouse (dump later)</option><option value="dump" ${_mode==="dump"?"selected":""}>Straight to the dump (this job)</option></select>
    ${_mode==="dump"?`<div class="row" style="gap:8px"><div class="grow"><label>Dump run — RT miles</label><input type="number" value="${WZ.junkDumpMiles!=null?WZ.junkDumpMiles:50}" min="0" onchange="WZ.junkDumpMiles=parseFloat(this.value)||0;render()"></div><div class="grow"><label>RT min (1 person)</label><input type="number" value="${WZ.junkDumpMin!=null?WZ.junkDumpMin:80}" min="0" onchange="WZ.junkDumpMin=parseFloat(this.value)||0;render()"></div></div>`:""}</div>`;
  const o=junkEngineObj(c),q=qeQuote(o);
  h+=`<div class="card" style="background:var(--accent);color:var(--accent-ink);text-align:center"><div style="font-size:13px;font-weight:700">PRICE TO GIVE</div><div style="font-size:32px;font-weight:800;line-height:1.1">${money(q.floor)}</div><div style="font-size:12px;opacity:.85">${c.cuft} cu ft · ${c.lbs} lb · ${o.crew} crew · ${qePersonHours(o).toFixed(1)} person-hrs</div></div>`;
  h+=qeStrip(q.floor,o,"junk");
  // Move-out protection — prints on the quote
  h+=`<div class="card"><label class="toggle" style="margin:0"><input type="checkbox" ${WZ.junkCleared?"checked":""} onchange="wizJunkCleared(this.checked)"><span style="margin:0;font-weight:700">✔ Customer confirms all remaining items are cleared for disposal</span></label><div class="sub" style="margin-top:4px">Move-out protection — when checked, this prints on the quote as a record the customer OK'd hauling everything left behind.</div></div>`;
  h+=`<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b>${money(q.floor)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Back</button><button class="btn acc grow" onclick="wizAddJunk()">Add to quote</button></div>`;
  return h;
}
function junkCatalogHTML(){
  if(!WZ.junk)WZ.junk=[];
  const qof=k=>{const li=WZ.junk.find(x=>x.key===k);return li?li.qty:0;};
  const locof=k=>{const li=WZ.junk.find(x=>x.key===k);return li?li.loc:"ground";};
  const row=it=>{const q=qof(it[0]),loc=locof(it[0]);let r=`<div style="border-bottom:1px solid var(--line);padding:8px 0"><div class="row" style="align-items:center"><div class="grow"><div class="nm" style="font-size:14px">${esc(it[1])}${it[4]?` <span class="badge" style="background:var(--soft);color:var(--muted)">${esc(it[4])} +$${JUNK_FEE[it[4]]}</span>`:""}</div><div class="sub">${it[2]} cu ft · ${it[3]} lb each</div></div><div class="row" style="gap:6px;align-items:center"><button class="btn ghost sm" style="width:40px" onclick="wizJQ('${it[0]}',-1)">−</button><b style="min-width:20px;text-align:center">${q}</b><button class="btn ghost sm" style="width:40px" onclick="wizJQ('${it[0]}',1)">+</button></div></div>`;
    if(q>0){const li=(WZ.junk||[]).find(x=>x.key===it[0])||{};let mult=1,flat=0;JUNK_MODS.forEach(md=>{if(li[md.k]){if(md.timeMult)mult*=md.timeMult;if(md.flatMin)flat+=md.flatMin;}});const itemMin=q*junkItemMin(it[2])*mult*(1+(JUNK_LOCF[loc]||0))+flat*q;
      r+=`<div style="margin-top:6px"><select onchange="wizJL('${it[0]}',this.value)" style="font-size:13px">${JUNK_LOC.map(l=>`<option value="${l[0]}" ${loc===l[0]?"selected":""}>📍 ${l[1]}</option>`).join("")}</select></div>`;
      r+=`<div class="row" style="gap:12px;margin-top:5px;flex-wrap:wrap">${JUNK_MODS.map(md=>`<label class="toggle" style="margin:0;font-size:13px"><input type="checkbox" ${li[md.k]?"checked":""} onchange="wizJMod('${it[0]}','${md.k}',this.checked)"><span style="margin:0">${md.short}</span></label>`).join("")}</div>`;
      r+=`<div class="sub" style="margin-top:4px">${q}×${it[2]} = ${q*it[2]} cu ft · ~${Math.round(itemMin)} min to load${it[4]?` · +${money(JUNK_FEE[it[4]]*q)} ${esc(it[4])} disposal`:""}</div>`;}
    return r+`</div>`;};
  const s=(WZ.junkSearch||"").trim().toLowerCase();
  if(s){
    const hits=[];JUNK_CAT.forEach(g=>g[1].forEach(it=>{if(it[1].toLowerCase().indexOf(s)>=0||(it[4]||"").toLowerCase().indexOf(s)>=0)hits.push(it);}));
    if(!hits.length)return `<div class="card"><div class="muted">No items match “${esc(WZ.junkSearch)}”. Try a shorter word, or clear the search to browse categories. (Anything unusual? Add it as a Custom line back on the services screen.)</div></div>`;
    return `<div class="card"><div class="sub" style="margin-bottom:4px">${hits.length} match${hits.length>1?"es":""} for “${esc(WZ.junkSearch)}”</div>`+hits.map(row).join("")+`</div>`;
  }
  return JUNK_CAT.map((g,gi)=>{const op=(WZ.junkOpen&&(gi in WZ.junkOpen))?WZ.junkOpen[gi]:(gi<3);return `<details class="card" ${op?"open":""} ontoggle="wizJunkToggle(${gi},this.open)"><summary style="font-weight:800;cursor:pointer">${esc(g[0])}</summary><div style="margin-top:4px">`+g[1].map(row).join("")+`</div></details>`;}).join("");
}
window.wizJSearch=function(){const e=document.getElementById("je_search");WZ.junkSearch=e?e.value:"";const c=document.getElementById("je_catalog");if(c)c.innerHTML=junkCatalogHTML();};
window.wizJunkToggle=function(gi,open){if(!WZ.junkOpen)WZ.junkOpen={};WZ.junkOpen[gi]=open;};
window.wizJQ=function(key,d){if(!WZ.junk)WZ.junk=[];let li=WZ.junk.find(x=>x.key===key);if(!li&&d>0){li={key:key,qty:0,loc:"ground"};WZ.junk.push(li);}if(li){li.qty=Math.max(0,(li.qty||0)+d);if(li.qty===0)WZ.junk=WZ.junk.filter(x=>x.key!==key);}const _y=(document.scrollingElement||document.documentElement).scrollTop;render();(document.scrollingElement||document.documentElement).scrollTop=_y;};
window.wizJL=function(key,v){const li=(WZ.junk||[]).find(x=>x.key===key);if(li){li.loc=v;const _y=(document.scrollingElement||document.documentElement).scrollTop;render();(document.scrollingElement||document.documentElement).scrollTop=_y;}};
window.wizJMod=function(key,mk,on){const li=(WZ.junk||[]).find(x=>x.key===key);if(li){li[mk]=!!on;const _y=(document.scrollingElement||document.documentElement).scrollTop;render();(document.scrollingElement||document.documentElement).scrollTop=_y;}};
window.wizJunkBedbug=function(on){WZ.junkBedbug=!!on;const _y=(document.scrollingElement||document.documentElement).scrollTop;render();(document.scrollingElement||document.documentElement).scrollTop=_y;};
window.wizJunkCleared=function(on){WZ.junkCleared=!!on;const _y=(document.scrollingElement||document.documentElement).scrollTop;render();(document.scrollingElement||document.documentElement).scrollTop=_y;};
window.openTrailerBuy=function(){
  // break-even line chart: used utility trailer ($1,500) vs renting, at 4 uses/mo over 24 months
  const P=1500,carryM=30,uses=4,rate=39,months=24,W=320,H=150,L=34,B=20,T=8,pw=W-L-8,ph=H-T-B;
  const rent=[],own=[];for(let m=0;m<=months;m++){rent.push(uses*rate*m);own.push(P+carryM*m);}
  const maxY=Math.max(rent[months],own[months]);
  const X=m=>L+(m/months)*pw,Y=v=>T+ph-(v/maxY)*ph;
  const rentLine=rent.map((v,m)=>X(m).toFixed(0)+","+Y(v).toFixed(0)).join(" ");
  const ownLine=own.map((v,m)=>X(m).toFixed(0)+","+Y(v).toFixed(0)).join(" ");
  const be=Math.round(P/(uses*rate-carryM)); // ~12 months
  const chart=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="margin:6px 0"><line x1="${L}" y1="${T}" x2="${L}" y2="${T+ph}" stroke="var(--line)"/><line x1="${L}" y1="${T+ph}" x2="${L+pw}" y2="${T+ph}" stroke="var(--line)"/><polyline points="${rentLine}" fill="none" stroke="var(--danger)" stroke-width="2.5"/><polyline points="${ownLine}" fill="none" stroke="var(--accent)" stroke-width="2.5"/><line x1="${X(be)}" y1="${T}" x2="${X(be)}" y2="${T+ph}" stroke="var(--muted)" stroke-dasharray="3 3"/><text x="${X(be)}" y="${H-4}" font-size="8" text-anchor="middle" fill="var(--muted)">~mo ${be}</text><text x="${L}" y="${H-4}" font-size="8" fill="var(--muted)">0</text><text x="${L+pw}" y="${H-4}" font-size="8" text-anchor="end" fill="var(--muted)">24 mo</text></svg><div class="mlg" style="display:flex;gap:14px;font-size:12px"><span class="lg"><span class="sw" style="background:var(--danger)"></span>Renting (4×/mo)</span><span class="lg"><span class="sw" style="background:var(--accent)"></span>Owning a used utility</span></div>`;
  modal("Trailer: buy vs. rent",`
    ${mCallout("","Verdict — what to do","Buy a USED utility/landscape trailer now (~$1,500, or $700-1,200 on Marketplace) — it beats renting at under 1 use a month and holds its value. RENT the dump trailer ($157/4hr) until junk runs are steady (~3-4/month for 2+ months), THEN buy a used dump (~$4,000). Revisit a new dump (TAC Trailer in Moyock is closest) once you are doing 4+ dump jobs a month.")}
    <div class="secthd"><h2>Rent vs. own — break-even</h2></div>
    <div style="overflow-x:auto"><table class="otable"><thead><tr><th>Option</th><th>Buy price</th><th>Carry/yr</th><th>Rent/use</th><th>Beats renting at</th></tr></thead><tbody>
    <tr><td>Used utility 5×10</td><td>$1,500</td><td>~$360</td><td>$39</td><td><b>~1 use/mo</b></td></tr>
    <tr><td>Used dump 5×10</td><td>$4,000</td><td>~$840</td><td>$157</td><td><b>~0.5 use/mo</b></td></tr>
    <tr><td>New dump 6×10</td><td>$6,500</td><td>~$1,010</td><td>$157</td><td><b>~0.5 use/mo</b></td></tr>
    </tbody></table></div>
    <p class="sub" style="margin:6px 4px">"Beats renting at" uses annualized cost (depreciation + tags + insurance + upkeep) vs. the rental rate. The catch is cash up front — see the curve.</p>
    <div class="card"><strong>Cumulative cost: rent vs. own (used utility, 4 uses/mo)</strong>${chart}<div class="sub">Renting passes the purchase price around <b>month ${be}</b> — after that, owning is pure savings, and you still recover ~$1,000 at resale. Cheaper trailers cross even faster.</div></div>
    <div class="secthd"><h2>Trailers for sale — NC / OBX</h2></div>
    <p class="sub" style="margin:0 4px 6px">Representative listings &amp; sources (May 2026). Marketplace/Craigslist change daily — these are price ranges from each source. <b>TAC Trailer (Moyock) is the closest dealer to the OBX.</b></p>
    <div style="overflow-x:auto"><table class="otable"><thead><tr><th>Trailer</th><th>Size</th><th>Cond.</th><th>Price</th><th>Source</th></tr></thead><tbody>
    <tr><td>Carry-On utility (2021)</td><td>5×10</td><td>Used</td><td>$1,550</td><td>Boone Trailers</td></tr>
    <tr><td>Caliber utility (2022)</td><td>5×10</td><td>Used</td><td>$1,500</td><td>Boone Trailers</td></tr>
    <tr><td>Utility (new)</td><td>5×10</td><td>New</td><td>$1,800-2,400</td><td>TAC Trailer, Moyock</td></tr>
    <tr><td>Utility</td><td>5×10</td><td>Used</td><td>$1,850</td><td>Craigslist OBX/NC</td></tr>
    <tr><td>Enclosed w/ shelves</td><td>5×8</td><td>Used</td><td>$2,300</td><td>Craigslist NC</td></tr>
    <tr><td>Single-axle utility</td><td>5×8</td><td>Used</td><td>$700-1,200</td><td>FB Marketplace OBX</td></tr>
    <tr><td>Landscape/open</td><td>6×12</td><td>New</td><td>$2,200-3,000</td><td>NC Trailer Sales</td></tr>
    <tr><td>Dump (used tandem)</td><td>5×10</td><td>Used</td><td>$3,500-5,000</td><td>Equipment Trader NC</td></tr>
    <tr><td>Dump (factory-direct)</td><td>6×10</td><td>New</td><td>$6,000-7,000</td><td>Texas Pride, East Bend</td></tr>
    <tr><td>Dump</td><td>6×10</td><td>New</td><td>$6,000-7,500</td><td>NC Trailer Sales</td></tr>
    <tr><td>Dump</td><td>6×12</td><td>New</td><td>$7,000-9,000</td><td>Trailers Plus, Linwood</td></tr>
    <tr><td>Dump (14k)</td><td>7×14</td><td>New</td><td>$9,000-11,000</td><td>Capps Trailers, Dover</td></tr>
    </tbody></table></div>
    <div class="secthd"><h2>Ownership math (5-yr horizon)</h2></div>
    <div class="mcard"><div class="mt">Used utility 5×10 — buy first</div><div style="font-size:12.5px;line-height:1.6;margin-top:4px"><b>$1,500</b> + ~$56 NC title + ~$40/yr tags + ~$120/yr insurance rider + ~$100/yr upkeep. Holds value (~$1,000 resale at 5 yr). <b>Net ~$360/yr.</b> vs. renting at even 1×/mo ($468/yr) → owning wins. Covers brush, lot, light-junk hauls today.</div></div>
    <div class="mcard"><div class="mt">Used dump 5×10 — buy when junk is steady</div><div style="font-size:12.5px;line-height:1.6;margin-top:4px"><b>$4,000</b> + tags + ~$250/yr insurance + ~$300/yr upkeep (hydraulics, battery, tires). ~$2,800 resale at 5 yr. <b>Net ~$840/yr.</b> Dumping yourself saves big labor unloading — worth it once junk runs are regular.</div></div>
    <div class="mcard"><div class="mt">New dump 6×10 — revisit at scale</div><div style="font-size:12.5px;line-height:1.6;margin-top:4px"><b>$6,500</b>, warranty, ~$1,010/yr all-in. Best once you do 4+ dump jobs/month. Buy local (TAC, Moyock) for service. Finance only if cash flow is tight — adds ~10% APR.</div></div>
    ${mCallout("warn","Hidden costs first-timers forget","NC one-time title ~$56 + plate ~$36-52/yr. Good news: NC does NOT require annual safety inspection on trailers. Add a towing/cargo rider to your insurance (call your auto carrier — utility ~$120/yr, dump ~$250/yr). Budget ~$150 up front for a ball mount, wiring harness, and spare tire. Heavier dump trailers may need a brake controller and a hitch rated for the load — confirm the F-150's tow rating. Factor the parking footprint at home, and for dumps the hydraulic pump + battery upkeep. Trailers depreciate slowly (utility) to moderately (dump); plan resale value into the decision.")}
    <div class="card"><div class="msrc">Sources: <a href="https://www.tactrailer.com/" target="_blank" rel="noopener">TAC Trailer (Moyock)</a> · <a href="https://www.nctrailers.com/inventory/dump-trailers/" target="_blank" rel="noopener">NC Trailer Sales</a> · <a href="https://www.cappstrailers.com/" target="_blank" rel="noopener">Capps Trailers</a> · <a href="https://www.boonetrailers.com/all-inventory/pre-owned/" target="_blank" rel="noopener">Boone Trailers (used)</a> · <a href="https://texaspridetrailers.com/roll-off-dump-trailers-for-sale-in-north-carolina/" target="_blank" rel="noopener">Texas Pride</a> · <a href="https://www.equipmenttrader.com/North-Carolina-Dump-Trailer/equipment-for-sale" target="_blank" rel="noopener">Equipment Trader NC</a> · <a href="https://outerbanks.craigslist.org/search/tra" target="_blank" rel="noopener">Craigslist OBX</a> · <a href="https://www.trailersplus.com/North_Carolina/Linwood/inventory/Dump/" target="_blank" rel="noopener">Trailers Plus</a></div></div>`);
};
window.wizAddJunk=function(){
  if(!WZ.junk||!WZ.junk.length){alert("Add at least one item first.");return;}
  const c=calcJunk(),o=junkEngineObj(c),q=qeQuote(o),ev=qeEval(q.floor,o);
  const itemCount=WZ.junk.reduce((s,x)=>s+(x.qty||0),0),notes=[];
  if(c.counts.freon)notes.push(c.counts.freon+" Freon unit(s) — needs EPA-certified refrigerant recovery before disposal.");
  notes.push("≈ "+c.eighths.toFixed(1)+"/8 truck ("+c.cuft+" cu ft, "+c.lbs+" lb) · "+o.crew+" crew · "+qePersonHours(o).toFixed(1)+" person-hrs · "+(o.mode==="dump"?"straight to dump":"stash at warehouse")+" · take-home "+money(ev.takeHome)+"/hr each.");
  if(c.bedbug)notes.push("Bed bugs reported — items bagged/sealed on site and disclosed at the transfer station.");
  if(WZ.junkCleared)notes.push("Customer confirmed all remaining items are cleared for disposal (move-out — nothing to be kept).");
  WZ.items.push({name:"Junk / move-out — "+itemCount+" items (~"+c.eighths.toFixed(1)+"/8 truck)",price:q.floor,cost:Math.round(ev.hard*100)/100,notes:notes,qty:1,unit:"job",serviceId:""});
  WZ.junk=[];WZ.junkBedbug=false;WZ.junkCleared=false;WZ.junkCrew=null;WZ.junkMode=null;WZ.junkSiteMiles=null;WZ.junkSiteMin=null;WZ.junkDumpMiles=null;WZ.junkDumpMin=null;WZ.step="pick";render();
};
