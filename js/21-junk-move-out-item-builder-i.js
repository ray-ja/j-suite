/* ---------- JUNK / MOVE-OUT ITEM BUILDER (inside the wizard) ---------- */
const JUNK_FULL=480;      // cu ft in a standard 18-cu-yd junk truck = industry "full load"
const JUNK_EIGHTH=60;     // cu ft = 1/8 of a standard truck
const JUNK_TRIPBASE=0;    // retired — "the truck is moving" is the static drive + the $175 minimum, NOT a volume base
const JUNK_PEREIGHTH=55;  // $ per 1/8-truck — the WORK value (loading + disposal margin); the drive is added separately. Tune to taste.
const JUNK_MIN=175;       // minimum job ($) — we don't walk out the door for less
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
const JUNK_LOCF={ground:0,curbside:-0.15,upstairs:0.25,basement:0.30,attic:0.50};
const JUNK_LOC=[["ground","Ground floor"],["curbside","Curbside / outside (−15%)"],["upstairs","Upstairs (+25%)"],["basement","Basement (+30%)"],["attic","Attic (+50%)"]];
/* realistic LOAD-TIME multiplier per location (feeds the $/hr check, not the price) — upstairs roughly doubles the time */
const JUNK_LOC_TIME={ground:1,curbside:0.85,upstairs:2,basement:2,attic:2.5};
/* per-item modifiers (checkboxes). Long carry is a +20% labor bump separate from the floor (a long
   driveway can be any floor). Heavy/disasm/bolted add to BOTH the volume price and the load-time check. */
const JUNK_MODS=[{k:"longcarry",short:"📏 Long carry",locf:0.20,timeMult:1.5},{k:"heavy",short:"🏋️ Heavy",priceMult:0.5,timeMult:1.75},{k:"disasm",short:"🔧 Disassembly",flatD:20,flatMin:12},{k:"bolted",short:"🔩 Bolted/mounted",flatD:12,flatMin:8}];
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
/* a line's total quantity across all its locations, and its total load minutes */
function junkLineQty(li){ return (li&&li.locs) ? Object.keys(li.locs).reduce((s,k)=>s+(+li.locs[k]||0),0) : 0; }
function junkLineLoadMin(it,li){
  let tMult=1,tFlat=0;
  JUNK_MODS.forEach(md=>{if(li[md.k]){if(md.timeMult)tMult*=md.timeMult;if(md.flatMin)tFlat+=md.flatMin;}});
  let m=0;const locs=li.locs||{};Object.keys(locs).forEach(loc=>{const q=+locs[loc]||0;if(q<=0)return;const lt=(JUNK_LOC_TIME[loc]!=null?JUNK_LOC_TIME[loc]:1);m+=q*junkItemMin(it[2])*tMult*lt+tFlat*q;});
  return m;
}
/* JUNK IS PRICED BY VOLUME (industry truck-fraction). Quantities are tracked PER LOCATION (a sofa
   upstairs + a sofa in the basement). The $45/hr engine is the floor / take-home CHECK, not the price. */
function calcJunk(){
  const items=WZ.junk||[];let cuft=0,lbs=0,locLabor=0,modLabor=0,special=0,counts={},softGoods=false,loadMin=0;
  items.forEach(li=>{const it=junkItem(li.key);if(!it)return;
    let pMult=1,pFlat=0,extraLocf=0;
    JUNK_MODS.forEach(md=>{if(li[md.k]){if(md.locf)extraLocf+=md.locf;if(md.priceMult)pMult+=md.priceMult;if(md.flatD)pFlat+=md.flatD;}});
    const locs=li.locs||{};
    Object.keys(locs).forEach(loc=>{const q=+locs[loc]||0;if(q<=0)return;
      const v=it[2]*q,w=it[3]*q;cuft+=v;lbs+=w;
      const share=(v/JUNK_EIGHTH)*JUNK_PEREIGHTH, locf=(JUNK_LOCF[loc]||0)+extraLocf;
      locLabor+=share*locf;                                                                                 // access + long-carry labor
      modLabor+=share*(pMult-1)+pFlat*q;                                                                     // heavy % · volume + disasm/bolted flat
      if(JUNK_SOFT_KEYS.indexOf(li.key)>=0)softGoods=true;
      const fl=it[4];if(fl&&JUNK_FEE[fl]){special+=JUNK_FEE[fl]*q;counts[fl]=(counts[fl]||0)+q;}});
    loadMin+=junkLineLoadMin(it,li);
  });
  const eighths=cuft/JUNK_EIGHTH;
  const haul=cuft>0?eighths*JUNK_PEREIGHTH:0;                                                               // PURE volume — no base (the static drive + $175 min already cover "the truck is moving")
  let total=0;if(cuft>0)total=Math.max(JUNK_MIN,Math.ceil((haul+locLabor+modLabor+special)/25)*25);          // residential: NO weight surcharge
  return {cuft:Math.round(cuft),lbs:Math.round(lbs),eighths:eighths,trips:cuft/getTruckCap(),haul:Math.round(haul),locLabor:Math.round(locLabor),modLabor:Math.round(modLabor),special:special,total:total,counts:counts,softGoods:softGoods,loadMin:loadMin};
}
/* round-trip drive to the job, auto-figured from the customer's address → home base */
function junkSiteDrive(){
  const pid=WZ.cust&&WZ.cust.propertyId;
  if(pid){const p=(D().properties||[]).find(x=>x.id===pid);if(p&&p.lat!=null&&typeof driveFromBase==="function"){const d=driveFromBase(p.lat,p.lng);if(d)return {rt:d.roundMiles,min:d.min*2};}}
  return {rt:20,min:30};                                                                                     // fallback until the address is geocoded
}
/* STATIC drive charge — fixed by the address (round trips to the site + the dump), NOT the load. Covers
   the miles (IRS rate) + the drive time paid at $45/hr take-home ($93.75/hr). Site = whole crew; dump run = 1. */
function junkDriveCharge(mode,crew){
  const dr=junkSiteDrive(),loaded=QE.TAKE_HOME/QE.FIELD_SPLIT;
  let miles=dr.rt, hrs=(crew||2)*(dr.min/60);
  if(mode!=="stash"){miles+=(typeof DISPOSAL_TRIP_MILES!=="undefined"?DISPOSAL_TRIP_MILES:55);hrs+=80/60;}
  return Math.round(miles*QE.MILEAGE + hrs*loaded);
}
/* the engine object for the take-home CHECK: loading person-hours + auto drive + the known dump run */
function junkEngineObj(c){
  const crew=WZ.junkCrew||2,mode=WZ.junkMode||"dump",loadingHrs=(c.loadMin||0)/60,dr=junkSiteDrive();
  return {crew:crew,onsiteHrs:crew>0?loadingHrs/crew:loadingHrs,siteMiles:dr.rt,siteDriveHrs:dr.min/60,mode:mode,lbs:c.lbs,dtype:"cd",dumpMiles:(typeof DISPOSAL_TRIP_MILES!=="undefined"?DISPOSAL_TRIP_MILES:55),dumpHrs:80/60,materials:(c.special||0)};
}
function wizJunkUI(){
  if(!WZ.junk)WZ.junk=[];
  let h=wizHead(3,5,"Junk / move-out — build the load");
  h+=`<div class="card" style="padding:10px"><input id="je_search" value="${esc(WZ.junkSearch||"")}" placeholder="🔎 Search items — type TV, carpet, fridge…" autocomplete="off" oninput="wizJSearch()" style="margin:0">${WZ.junkSearch?`<button class="btn ghost sm" style="margin-top:8px" onclick="WZ.junkSearch='';render()">✕ Clear search</button>`:""}</div>`;
  h+=`<div id="je_catalog">`+junkCatalogHTML()+`</div>`;
  const c=calcJunk(),cap=getTruckCap();
  if(c.counts.freon)h+=`<div class="card" style="border-left:4px solid var(--danger);font-size:12.5px;line-height:1.5">❄️ ${c.counts.freon} Freon unit(s): refrigerant must be recovered by an EPA-certified tech before the Dare County landfill will take them. The price includes the fee — line up your recovery plan before hauling.</div>`;
  // Bed bugs — we don't haul them, period. Always ask.
  h+=`<div class="card" style="border-left:4px solid var(--danger)"><label class="toggle" style="margin:0"><input type="checkbox" ${WZ.junkBedbug?"checked":""} onchange="wizJunkBedbug(this.checked)"><span style="margin:0;font-weight:700">🐛 Any bed bugs? — always ask</span></label>${WZ.junkBedbug?`<div style="margin-top:8px;font-size:13px;line-height:1.6;color:var(--danger);font-weight:700">🚫 We don't haul anything with bed bugs. One infestation contaminates the truck and every job after — it's not worth it. Decline the job, or exclude the infested items and quote only the rest.</div>`:`<div class="sub" style="margin-top:4px">Ask the customer before you load. If there are bed bugs, we pass.</div>`}</div>`;
  // PRICE = volume (premium band, incl. access & modifiers) + STATIC drive charge + special-item disposal
  const _crew=WZ.junkCrew||2,_mode=WZ.junkMode||"dump",_dr=junkSiteDrive();
  const drive=junkDriveCharge(_mode,_crew), work=c.haul+c.locLabor+c.modLabor;
  const price=Math.max(JUNK_MIN,Math.ceil((work+drive+c.special)/25)*25);
  // $/hr each CHECK — job time = 20-min baseline + item load times + drive (load times feed THIS, not the price)
  const onsiteHrs=(20+(c.loadMin||0))/60;
  const drivePH=_crew*(_dr.min/60)+(_mode!=="stash"?80/60:0);
  const totalPH=_crew*onsiteHrs+drivePH;
  const totalMi=Math.round(_dr.rt+(_mode!=="stash"?(typeof DISPOSAL_TRIP_MILES!=="undefined"?DISPOSAL_TRIP_MILES:55):0));
  const hourly=totalPH>0?Math.round((price-c.special-totalMi*QE.MILEAGE)*QE.FIELD_SPLIT/totalPH):0, okHr=hourly>=QE.TAKE_HOME;
  // sticky bottom bar — truck fill · market band · price · volume(cu ft) + drive(mi) · $/hr each · crew · dump/stash
  const fullCuft=480,barPct=Math.min(100,Math.round(c.cuft/fullCuft*100));
  const bandLo=(typeof MARKET_BANDS!=="undefined"&&MARKET_BANDS.junk)?MARKET_BANDS.junk.lo:150,bandHi=(typeof MARKET_BANDS!=="undefined"&&MARKET_BANDS.junk)?MARKET_BANDS.junk.hi:800;
  const pPct=Math.min(100,Math.max(0,(price-bandLo)/(bandHi-bandLo)*100)),inBand=price>=bandLo&&price<=bandHi;
  h+=`<div class="wizfoot" style="flex-wrap:wrap;gap:3px 8px">
    <div style="flex-basis:100%">
      <div style="height:11px;background:var(--soft);border-radius:6px;overflow:hidden"><div style="height:100%;width:${barPct}%;background:var(--accent)"></div></div>
      <div class="sub" style="font-size:11px;margin-top:1px">📦 ${barPct}% of a box truck · volume ${money(work)} (${c.cuft} cu ft) + drive ${money(drive)} (${totalMi} mi · static)${c.special?` + disposal ${money(c.special)}`:""}</div>
    </div>
    <div style="flex-basis:100%">
      <div style="position:relative;height:11px;background:linear-gradient(90deg,#e7f4ea,#e7f4ea 90%,#fff3d6);border-radius:6px"><div style="position:absolute;top:-3px;bottom:-3px;left:${pPct}%;width:3px;background:var(--brand-text)"></div></div>
      <div class="sub" style="font-size:11px;margin-top:1px">📊 ${money(bandLo)}–${money(bandHi)} band — <b style="color:${inBand?"#1a7f37":"var(--muted)"}">${inBand?"in band":price>bandHi?"above band":"below band"}</b> · <b style="color:${okHr?"#1a7f37":"#c1121f"}">~${money(hourly)}/hr each ${okHr?"✓":"⚠"}</b></div>
    </div>
    <div class="wf-amt"><span class="wf-lab">Quote</span><b>${money(price)}</b></div>
    <span style="white-space:nowrap;font-size:12px">👷<button class="btn ghost sm" style="width:30px;padding:2px;margin:0 2px" onclick="WZ.junkCrew=Math.max(1,(WZ.junkCrew||2)-1);render()">−</button>${_crew}<button class="btn ghost sm" style="width:30px;padding:2px;margin:0 2px" onclick="WZ.junkCrew=(WZ.junkCrew||2)+1;render()">+</button></span>
    <button class="btn ghost sm" style="white-space:nowrap" onclick="WZ.junkMode='${_mode==="dump"?"stash":"dump"}';render()">${_mode==="dump"?"🚛 Dump":"📦 Stash"}</button>
    <button class="btn ghost sm" onclick="WZ.step='pick';render()">←</button>
    <button class="btn acc grow" onclick="wizAddJunk()">Add to quote</button>
  </div>`;
  return h;
}
function junkCatalogHTML(){
  if(!WZ.junk)WZ.junk=[];
  const lineOf=k=>WZ.junk.find(x=>x.key===k);
  const row=it=>{const li=lineOf(it[0])||{};const locs=li.locs||{};const q=junkLineQty(li);
    let r=`<div style="border-bottom:1px solid var(--line);padding:8px 0"><div class="row" style="align-items:center"><div class="grow"><div class="nm" style="font-size:14px">${esc(it[1])}${it[4]?` <span class="badge" style="background:var(--soft);color:var(--muted)">${esc(it[4])} +$${JUNK_FEE[it[4]]}</span>`:""}</div><div class="sub">${it[2]} cu ft · ${it[3]} lb each</div></div><div class="row" style="gap:6px;align-items:center">${q>0?`<b style="min-width:20px;text-align:center">${q}</b>`:""}<button class="btn ${q>0?"ghost":"acc"} sm" onclick="wizJQ('${it[0]}','ground',1)">${q>0?"+":"+ Add"}</button></div></div>`;
    if(q>0){
      r+=`<div style="margin-top:6px">`+JUNK_LOC.filter(l=>(+locs[l[0]]||0)>0).map(l=>{const lq=+locs[l[0]]||0;return `<div class="row" style="align-items:center;gap:8px;margin:3px 0"><span class="grow" style="font-size:13px">📍 ${esc(l[1])}</span><button class="btn ghost sm" style="width:36px" onclick="wizJQ('${it[0]}','${l[0]}',-1)">−</button><b style="min-width:18px;text-align:center">${lq}</b><button class="btn ghost sm" style="width:36px" onclick="wizJQ('${it[0]}','${l[0]}',1)">+</button></div>`;}).join("")+`</div>`;
      r+=`<select onchange="if(this.value)wizJQ('${it[0]}',this.value,1)" style="font-size:13px;margin-top:2px"><option value="">📍 ＋ add at another spot…</option>${JUNK_LOC.map(l=>`<option value="${l[0]}">${esc(l[1])}</option>`).join("")}</select>`;
      r+=`<div class="row" style="gap:12px;margin-top:6px;flex-wrap:wrap">${JUNK_MODS.map(md=>`<label class="toggle" style="margin:0;font-size:13px"><input type="checkbox" ${li[md.k]?"checked":""} onchange="wizJMod('${it[0]}','${md.k}',this.checked)"><span style="margin:0">${md.short}</span></label>`).join("")}</div>`;
      r+=`<div class="sub" style="margin-top:4px">${q}×${it[2]} = ${q*it[2]} cu ft · ~${Math.round(junkLineLoadMin(it,li))} min${it[4]?` · +${money(JUNK_FEE[it[4]]*q)} ${esc(it[4])} disposal`:""}</div>`;
    }
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
window.wizJQ=function(key,loc,d){if(!WZ.junk)WZ.junk=[];let li=WZ.junk.find(x=>x.key===key);if(!li){if(d<=0)return;li={key:key,locs:{}};WZ.junk.push(li);}if(!li.locs)li.locs={};li.locs[loc]=Math.max(0,(+li.locs[loc]||0)+d);if(!li.locs[loc])delete li.locs[loc];if(junkLineQty(li)===0)WZ.junk=WZ.junk.filter(x=>x.key!==key);const _y=(document.scrollingElement||document.documentElement).scrollTop;render();(document.scrollingElement||document.documentElement).scrollTop=_y;};
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
  if(WZ.junkBedbug){if(!confirm("Bed bugs flagged — we don't haul bed-bug items. Make sure they're excluded from this quote before continuing."))return;}
  const c=calcJunk(),mode=WZ.junkMode||"dump",crew=WZ.junkCrew||2;
  const drive=junkDriveCharge(mode,crew),work=c.haul+c.locLabor+c.modLabor;
  const price=Math.max(JUNK_MIN,Math.ceil((work+drive+c.special)/25)*25);
  const itemCount=WZ.junk.reduce((s,x)=>s+junkLineQty(x),0),notes=[];
  if(c.counts.freon)notes.push(c.counts.freon+" Freon unit(s) — needs EPA-certified refrigerant recovery before disposal.");
  notes.push("≈ "+c.eighths.toFixed(1)+"/8 truck ("+c.cuft+" cu ft, "+c.lbs+" lb) · "+(mode==="dump"?"straight to dump":"stash at warehouse")+" · volume "+money(work)+" + static drive "+money(drive)+(c.special?" + disposal "+money(c.special):"")+".");
  const cost=Math.round((c.special+junkSiteDrive().rt*QE.MILEAGE+(mode!=="stash"?(typeof DISPOSAL_TRIP_MILES!=="undefined"?DISPOSAL_TRIP_MILES:55)*QE.MILEAGE:0))*100)/100;   // hard cost: disposal fees + mileage
  // estimate the job time so the review's pay check is real (not "?"): 20-min on-site baseline + load times + drive
  const _dr=junkSiteDrive(), totalPH=crew*((20+(c.loadMin||0))/60)+crew*(_dr.min/60)+(mode!=="stash"?80/60:0);
  WZ.items.push({name:"Junk / move-out — "+itemCount+" items (~"+c.eighths.toFixed(1)+"/8 truck)",price:price,cost:cost,notes:notes,qty:1,unit:"job",serviceId:""});
  WZ.crewN=crew; WZ.hours=Math.round(totalPH/crew*10)/10;   // carry crew + hours-each into the review
  WZ.junk=[];WZ.junkBedbug=false;WZ.junkCrew=null;WZ.junkMode=null;WZ.step="review";render();
};
