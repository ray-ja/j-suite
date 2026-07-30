/* ---------- BRUSH / SHRUB / SMALL-TREE REMOVAL ESTIMATOR ----------
   On-site, value-priced. Ray quotes the cut-down and the stump/root removal
   as SEPARATE, independently-selectable line items, so it outputs TWO quote
   lines: "Brush/shrub removal — cut & haul" and "Stump/root removal".
   Cost model: veg disposal is NOT free for a CONTRACTOR (corrected 2026-07-27 — this file was
   missed in the 2026-07-25 sweep). Dare charges commercial veg/yard debris ~$58-65/ton; the free
   residential yard site EXCLUDES contractor-generated material. Priced via qeTipFee(lbs,"veg").
   Hard costs = stump-grinder rental (only if a stump line is selected) + optional
   trailer (passthrough). NO labor line, and NO chainsaw rental — the saw is owned.
   Drive is static-from-the-property-address via wizDriveCharge (the legacy js/41 travel-zone line is retired).
   Scope cap: ground-based shrubs/small trees up to ~30 ft, no climbing. Over that,
   or anything needing climbing/rigging/large-trunk felling → out of scope, refer. */

// Per-item price bands (editable in the rate editor). Heights map to the size tiers.
const BRUSH_BANDS_DEFAULT={
  small:  {label:"Small — ≤4 ft",      cut:50,  stump:40},
  medium: {label:"Medium — 4–8 ft",    cut:110, stump:80},
  large:  {label:"Large — 8–15 ft",    cut:200, stump:150},
  xlarge: {label:"X-Large — 15–30 ft", cut:325, stump:275}
};
const BRUSH_TIER_ORDER=["small","medium","large","xlarge"];
// Rough GREEN-WEIGHT estimate per item (lb), used only to price the veg tip fee. Estimates —
// override the total on the Hard costs card when you know the real load.
const BRUSH_LBS={small:40,medium:150,large:400,xlarge:900};
// [value, label, multiplier] — applied to both cut and stump per item.
const BRUSH_ACCESS=[["open","Open — clear drop zone",1.0],["near","Near structures (fence/shed) +15%",1.15],["tight","Tight access +30%",1.30]];
const BRUSH_RENT_DEFAULT={grinder:100}; // chainsaw rental removed — saw is owned; pole-saw rental can be added here if one is ever rented
const BRUSH_SRC="Value/undercut pricing for OBX shrub & small-tree removal; COMMERCIAL veg disposal ~$58-65/ton (NOT free for a contractor); saw owned (no rental); stump-grinder rental at Home Depot day rates (2026).";

// Editable-rate overlay (doc id "brushrates"), same pattern as deepOverrides / truckcap.
function brushOverrides(){try{const d=D().docs.find(x=>x.id==="brushrates"&&!x.deleted);if(d)return JSON.parse(d.text);}catch(e){}return {};}
function setBrushOverrides(o){let d=D().docs.find(x=>x.id==="brushrates");if(d){d.text=JSON.stringify(o);d.updatedAt=now();}else D().docs.push({id:"brushrates",text:JSON.stringify(o),updatedAt:now()});save();}
function getBrushBands(){const base=JSON.parse(JSON.stringify(BRUSH_BANDS_DEFAULT));const ov=brushOverrides().bands||{};BRUSH_TIER_ORDER.forEach(t=>{if(ov[t]){if(ov[t].cut!=null)base[t].cut=ov[t].cut;if(ov[t].stump!=null)base[t].stump=ov[t].stump;}});return base;}
function getBrushRent(){const base=Object.assign({},BRUSH_RENT_DEFAULT);const ov=brushOverrides().rent||{};if(ov.grinder!=null)base.grinder=ov.grinder;return base;}
function brushAccessMult(a){const o=BRUSH_ACCESS.find(x=>x[0]===a);return o?o[2]:1;}
/* Estimated green weight of the brush being hauled. Only CUT items generate debris — a stump
   that's ground in place stays on site. Ray can override the total on the Hard costs card. */
function brushEstLbs(){let lb=0;(( typeof WZ!=="undefined"&&WZ&&WZ.brush)||[]).forEach(li=>{
  if(!li||!li.cut)return;lb+=(BRUSH_LBS[li.tier]||0)*Math.max(1,+li.qty||1);});return Math.round(lb);}
function brushVegLbs(){const ov=(typeof WZ!=="undefined"&&WZ)?WZ.brushVegLbs:null;
  return (ov!=null&&ov!==""&&+ov>=0)?Math.round(+ov):brushEstLbs();}

function calcBrush(){
  const bands=getBrushBands(),rent=getBrushRent();
  const lines=WZ.brush||[];
  const TMIN={small:{cut:12,stump:10},medium:{cut:25,stump:20},large:{cut:45,stump:35},xlarge:{cut:75,stump:60}};   // work-minutes per item → pay check
  let cutSub=0,stumpSub=0,mins=0,rows=[];
  lines.forEach(li=>{
    const b=bands[li.tier];if(!b)return;
    const q=Math.max(0,li.qty||0);if(!q)return;
    const am=brushAccessMult(li.access);
    const cutEach=li.cut?b.cut*am:0, stumpEach=li.stump?b.stump*am:0;
    const lc=cutEach*q, ls=stumpEach*q;
    if(lc<=0&&ls<=0)return;
    cutSub+=lc;stumpSub+=ls;
    const tm=TMIN[li.tier]||{cut:20,stump:15};mins+=q*am*((li.cut?tm.cut:0)+(li.stump?tm.stump:0));
    const acc=(BRUSH_ACCESS.find(x=>x[0]===li.access)||BRUSH_ACCESS[0]);
    rows.push({label:q+"× "+b.label+(am!==1?" · "+acc[1]:""),cut:Math.round(lc),stump:Math.round(ls)});
  });
  const cutLine=cutSub>0?rnd5(cutSub):0;
  const stumpLine=stumpSub>0?rnd5(stumpSub):0;
  const price=cutLine+stumpLine;
  // Hard costs — veg DISPOSAL (a contractor pays for it), chainsaw is owned (no rental). Drive is
  // the separate travel line (js/41), so it's not folded in here. Grinder applies only with a stump line.
  const trailer=Math.max(0,WZ.brushTrailer||0);
  const grinder=stumpLine>0?rent.grinder:0;
  const vegLbs=brushVegLbs();
  const dump=(typeof qeTipFee==="function")?qeTipFee(vegLbs,"veg"):0;
  const cost=grinder+trailer+dump;
  return {rows:rows,cutLine:cutLine,stumpLine:stumpLine,price:price,mins:Math.round(mins),
    grinder:grinder,trailer:trailer,vegLbs:vegLbs,dump:Math.round(dump*100)/100,cost:Math.round(cost*100)/100};
}

function brushLineRow(li,i){
  const bands=getBrushBands(),b=bands[li.tier];
  const am=brushAccessMult(li.access);
  const cutEach=Math.round(b.cut*am), stumpEach=Math.round(b.stump*am);
  return `<div style="border-bottom:1px solid var(--line);padding:10px 0">
    <div class="row" style="align-items:center"><div class="grow"><div class="nm" style="font-size:14px">${esc(b.label)}</div><div class="sub">cut ${money(cutEach)}${li.stump?" · stump "+money(stumpEach):""} each${am!==1?" (access)":""}</div></div>
      <div class="row" style="gap:6px;align-items:center"><button class="btn ghost sm" style="width:40px" onclick="wizBrushQ('${li.id}',-1)">−</button><b style="min-width:20px;text-align:center">${li.qty}</b><button class="btn ghost sm" style="width:40px" onclick="wizBrushQ('${li.id}',1)">+</button><button class="rm" onclick="wizBrushRem('${li.id}')">×</button></div></div>
    <div style="margin-top:6px"><select onchange="wizBrushAccess('${li.id}',this.value)" style="font-size:13px">${BRUSH_ACCESS.map(a=>`<option value="${a[0]}" ${li.access===a[0]?"selected":""}>📍 ${esc(a[1])}</option>`).join("")}</select></div>
    <div class="row" style="gap:14px;margin-top:8px;flex-wrap:wrap">
      <label class="toggle" style="margin:0"><input type="checkbox" ${li.cut?"checked":""} onchange="wizBrushFlag('${li.id}','cut',this.checked)"><span style="margin:0">Cut &amp; haul</span></label>
      <label class="toggle" style="margin:0"><input type="checkbox" ${li.stump?"checked":""} onchange="wizBrushFlag('${li.id}','stump',this.checked)"><span style="margin:0">Stump / root removal</span></label>
    </div>
    ${(!li.cut&&!li.stump)?`<div class="sub" style="color:var(--danger);margin-top:4px">Pick at least one removal type for this item.</div>`:""}
  </div>`;
}

function wizBrushUI(){
  if(!WZ.brush)WZ.brush=[];
  const oos=!!WZ.brushOOS;
  const c=calcBrush();
  const crew=Math.max(1,WZ.brushCrew||2);
  const _drv=(typeof wizDriveCharge==="function")?wizDriveCharge(crew):{charge:0,miles:0,min:0};
  const _totalPH=((c.mins||0)/60)+crew*((_drv.min||0)/60)+crew*(15/60);
  const _perHr=_totalPH>0?Math.floor((c.price+_drv.charge-c.cost)*0.48/_totalPH):0;
  const _hrsEach=crew>0?Math.round(_totalPH/crew*10)/10:0;
  const _TGT=(typeof QE!=="undefined"?QE.TAKE_HOME:45),_CF=(typeof QE!=="undefined"?QE.CREW_FLOOR:30),_tier=_perHr>=_TGT?2:_perHr>=_CF?1:0;
  let h=wizHead(3,5,"Brush / shrub / small-tree removal");
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">📋 How to use this (tap)</summary><div style="font-size:13px;line-height:1.6;margin-top:8px"><b>Walk the yard with the customer.</b> For each shrub or small tree, tap its <b>size band</b> (by height), set <b>how many</b> of that size, and the <b>access</b>. Then choose what they want: <b>cut &amp; haul</b>, <b>stump/root removal</b>, or both — they're priced and presented separately so the customer can pick either or both.<br><br><b>Ground-based work only, up to ~30 ft.</b> Anything taller, or that needs climbing, rigging, or felling a real trunk, is a tree-service job — flip the toggle at the top and refer it out.</div></details>`;
  h+=`<details class="card"><summary style="font-weight:800;cursor:pointer">💬 What to say to the customer (tap)</summary><div style="font-size:13px;line-height:1.6;margin-top:8px">1. "Let's walk the yard and I'll note each shrub and small tree."<br>2. "I price the cut-down and the stump separately — you can do just the tops, or have me grind the stumps too. Your call."<br>3. "For the brush cut and hauled it's <b>[cut number]</b>; to also pull the stumps it's <b>[stump number]</b>." Then stop talking.<br>4. "That price covers the work and hauling it to the county — yard debris is charged by the ton for a contractor, so it's built in."<br>5. If anything's a real tree: "That one's a tree job — I'd bring in a tree service so it's done safely, I won't cut corners on that."</div></details>`;

  // Scope cap — enforce + warn
  h+=`<div class="card" style="border-left:4px solid var(--danger)"><label class="toggle" style="margin:0"><input type="checkbox" ${oos?"checked":""} onchange="wizBrushOOS(this.checked)"><span style="margin:0;font-weight:700">⚠ Anything over 30 ft, or needs climbing / rigging / large-trunk felling?</span></label>
    ${oos?`<div style="margin-top:8px;font-size:13px;line-height:1.6"><b>Out of scope — refer to a tree service.</b> This estimator covers ground-based shrubs and small trees up to ~30 ft, no climbing. For anything taller or that needs to be climbed, rigged, or felled as a real trunk, refer it to a licensed/insured tree service — don't quote it here. You can still quote any in-scope brush below by unchecking this once the big stuff is excluded.</div>`:`<div class="sub" style="margin-top:4px">Keeps the crew safe and the quote honest — over 30 ft is a tree-service job.</div>`}</div>`;

  // Builder
  h+=`<div class="card"><div style="font-weight:800;margin-bottom:6px">Add an item</div><div class="grid2">`+BRUSH_TIER_ORDER.map(t=>`<button class="btn ghost" style="text-align:left;margin-bottom:8px" onclick="wizBrushAdd('${t}')">+ ${esc(BRUSH_BANDS_DEFAULT[t].label)}</button>`).join("")+`</div>
    ${WZ.brush.length?WZ.brush.map(brushLineRow).join(""):`<div class="muted" style="font-size:13px">No items yet — tap a size above for each shrub or small tree.</div>`}</div>`;

  // Cost inputs (rentals only — drive is the separate travel line)
  const rent=getBrushRent();
  h+=`<div class="card"><div style="font-weight:800;margin-bottom:4px">Hard costs</div>
    <div class="sub" style="margin-bottom:6px">Veg disposal is <b>NOT free for a contractor</b> — Dare charges commercial yard debris by the ton (the free residential site excludes contractor material). The chainsaw is <b>owned — no rental</b>. The stump grinder ${money(rent.grinder)} applies only when a stump line is selected. Rentals are editable in the rate editor; travel is its own line below.</div>
    <label style="margin-top:0">Brush weight hauled (lb) — est. ${brushEstLbs().toLocaleString()}</label><input type="number" inputmode="numeric" min="0" value="${WZ.brushVegLbs!=null&&WZ.brushVegLbs!==""?WZ.brushVegLbs:""}" placeholder="${brushEstLbs()}" onchange="wizBrushCost('brushVegLbs',this.value)">
    <div class="sub" style="font-size:11px;margin-top:2px">Rough estimate from the item sizes — override it when you know the real load. Ground-in-place stumps don't get hauled, so they don't count.</div>
    <label>Optional trailer rental (passthrough $)</label><input type="number" inputmode="decimal" value="${WZ.brushTrailer||0}" onchange="wizBrushCost('brushTrailer',this.value)">
    <div class="sub" style="margin-top:4px">Work cost in this quote: grinder ${money(c.grinder)} + trailer ${money(c.trailer)} + veg dump ${money(c.dump)} (${c.vegLbs.toLocaleString()} lb) = <b>${money(c.cost)}</b>. 🚗 Drive is figured automatically from the property address.</div></div>`;

  if(!oos){
    // Breakdown
    h+=`<div class="card"><div style="font-weight:800;margin-bottom:6px">Itemized breakdown</div><div style="font-size:13px;line-height:1.9">${
      c.rows.length?c.rows.map(r=>`${esc(r.label)}: ${r.cut?"cut <b>"+money(r.cut)+"</b>":""}${r.cut&&r.stump?" · ":""}${r.stump?"stump <b>"+money(r.stump)+"</b>":""}`).join("<br>"):'<span class="muted">No priced items yet.</span>'
    }</div><div style="border-top:1px solid var(--line);margin:8px 0"></div>
    <div class="row" style="justify-content:space-between"><span class="sub">Brush/shrub removal — cut &amp; haul</span><b>${money(c.cutLine)}</b></div>
    <div class="row" style="justify-content:space-between"><span class="sub">Stump / root removal</span><b>${money(c.stumpLine)}</b></div></div>`;

    // COGS / margin strip + floor
    if(c.price>0){
      h+=`<div class="card">${cogsStrip(c.price,c.cost)}<div class="sub">Hard cost only (veg disposal + rentals + drive); no labor line — the crew is paid from the revenue split.</div></div>`;
    }

    // Crew selector + live pay check (paver-standard)
    h+=`<div class="card"><div class="row" style="gap:6px;align-items:center"><div class="grow" style="font-weight:800">Crew on this job</div>${(typeof pvCrewBtns==="function")?pvCrewBtns(crew,"wizBrushCrew"):""}</div>
      <div class="row" style="justify-content:space-between;align-items:baseline;margin-top:8px"><div class="sub">${crew} ${crew===1?"person":"people"} × ~${_hrsEach} hr each · drive + work</div><div class="nm" style="font-size:18px;color:${["var(--danger)","#b8860b","var(--accent)"][_tier]}">${money(_perHr)}/hr each ${["⚠","⚠","✓"][_tier]}</div></div>
      <div class="sub">${_tier===2?'<span style="color:var(--accent)">✓ Clears your $45/hr floor.</span>':_tier===1?'<span style="color:#b8860b">🟡 Below $45 but clears the $30/hr crew floor — good for Chase/Pierce.</span>':'<span style="color:var(--danger)">🔴 Below the $30/hr crew floor.</span>'}</div></div>`;

    // Green on-site quote — distinct lines (cut / stump) + travel
    const grand=c.price+_drv.charge;
    h+=`<div class="card" style="background:var(--accent);color:var(--accent-ink)"><div style="font-size:13px;font-weight:700;text-align:center">QUOTE TO GIVE ON SITE</div>
      ${c.cutLine>0?`<div class="row" style="justify-content:space-between;margin-top:6px"><span>Cut &amp; haul</span><b>${money(c.cutLine)}</b></div>`:""}
      ${c.stumpLine>0?`<div class="row" style="justify-content:space-between"><span>Stump / root removal</span><b>${money(c.stumpLine)}</b></div>`:""}
      <div class="row" style="justify-content:space-between"><span>Drive (round trip, from address)</span><b>${money(_drv.charge)}</b></div>
      <div style="font-size:32px;font-weight:800;line-height:1.1;text-align:center;margin-top:4px">${money(grand)}</div>
      <div style="font-size:12px;opacity:.9;text-align:center">Cut &amp; stump are separate — the customer can take either or both; travel applies to the trip.</div></div>`;
    h+=`<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b>${money(grand)}</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Back</button><button class="btn acc grow" onclick="wizAddBrush()">Add to quote</button></div>`;
  } else {
    h+=`<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Refer out</span><b>—</b></div><button class="btn ghost grow" onclick="WZ.step='pick';render()">← Back</button></div>`;
  }
  h+=`<button class="btn ghost sm" style="margin-top:8px" onclick="openBrushEditor()">⚙️ Edit price bands &amp; rental rates</button>`;
  return h;
}

function brushScrollKeepRender(){const _y=(document.scrollingElement||document.documentElement).scrollTop;render();(document.scrollingElement||document.documentElement).scrollTop=_y;}
window.wizBrushAdd=function(tier){if(!WZ.brush)WZ.brush=[];WZ.brush.push({id:uid(),tier:tier,access:"open",qty:1,cut:true,stump:false});brushScrollKeepRender();};
window.wizBrushQ=function(id,d){const li=(WZ.brush||[]).find(x=>x.id===id);if(!li)return;li.qty=Math.max(1,(li.qty||1)+d);brushScrollKeepRender();};
window.wizBrushAccess=function(id,v){const li=(WZ.brush||[]).find(x=>x.id===id);if(li){li.access=v;brushScrollKeepRender();}};
window.wizBrushFlag=function(id,which,on){const li=(WZ.brush||[]).find(x=>x.id===id);if(li){li[which]=!!on;brushScrollKeepRender();}};
window.wizBrushRem=function(id){WZ.brush=(WZ.brush||[]).filter(x=>x.id!==id);brushScrollKeepRender();};
window.wizBrushCost=function(k,v){WZ[k]=Math.max(0,parseFloat(v)||0);brushScrollKeepRender();};
window.wizBrushCrew=function(n){WZ.brushCrew=Math.max(1,n);brushScrollKeepRender();};
window.wizBrushOOS=function(on){WZ.brushOOS=!!on;render();};
window.wizAddBrush=function(){
  if(WZ.brushOOS){alert("This job is out of scope for the brush estimator (over 30 ft or needs climbing/rigging). Refer it to a tree service — don't quote it here.");return;}
  const c=calcBrush();
  if(c.price<=0){alert("Add at least one item with a removal type selected.");return;}
  const rent=getBrushRent(),trailer=Math.max(0,WZ.brushTrailer||0);
  const accNote=(WZ.brush||[]).some(l=>l.access!=="open")?" Some items have access adders (near structures / tight).":"";
  if(c.cutLine>0){
    WZ.items.push({name:"Brush/shrub removal — cut & haul",price:c.cutLine,cost:trailer+c.dump,
      notes:["Includes hauling and county veg disposal (charged by the ton for a contractor); saw is owned (no rental)."+accNote,"Ground-based, ≤30 ft, no climbing."],qty:1,unit:"job",serviceId:"",bandKey:"brush"});
  }
  if(c.stumpLine>0){
    WZ.items.push({name:"Stump/root removal",price:c.stumpLine,cost:rent.grinder+(c.cutLine>0?0:trailer),
      notes:["Stump/root grinding — separate, optional line."],qty:1,unit:"job",serviceId:"",bandKey:"brush"});
  }
  // static drive from the property address + pay-check hours (selectable crew)
  const crew=Math.max(1,WZ.brushCrew||2), drv=(typeof wizDriveCharge==="function")?wizDriveCharge(crew):{charge:0,miles:0,min:0};
  const MIL=(typeof QE!=="undefined"?QE.MILEAGE:0.725);
  if(drv.charge>0)WZ.items.push({name:"Drive — round trip to site",price:drv.charge,cost:Math.round((drv.miles||0)*MIL),qty:1,unit:"job",serviceId:"",bandKey:"brush"});
  const totalPH=((c.mins||0)/60)+crew*((drv.min||0)/60)+crew*(15/60);
  WZ.crewN=crew; WZ.hours=totalPH>0?Math.round(totalPH/crew*10)/10:0;
  WZ.step="review";render();   // keep WZ.brush so the review's ← back returns to the build
};

/* ----- rate editor (price bands + rental cost defaults) ----- */
function brushEditorHTML(){
  const bands=getBrushBands(),rent=getBrushRent(),edited=!!(brushOverrides().bands||brushOverrides().rent);
  let h=`<div class="sub" style="margin-bottom:8px;line-height:1.5">📚 <b>Source:</b> ${esc(BRUSH_SRC)}${edited?` <span class="badge" style="background:var(--accent);color:var(--accent-ink)">edited</span>`:""}</div>`;
  h+=`<div class="card"><div style="font-weight:800;margin-bottom:6px">Price bands — per item</div>`;
  h+=BRUSH_TIER_ORDER.map(t=>`<div style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px"><div class="nm" style="font-size:14px">${esc(bands[t].label)}</div>
    <div class="row" style="gap:10px;align-items:center;margin-top:4px"><div class="grow sub">Cut &amp; haul</div><span class="sub">$</span><input type="number" style="width:90px" value="${bands[t].cut}" onchange="setBrushBand('${t}','cut',this.value)"></div>
    <div class="row" style="gap:10px;align-items:center;margin-top:4px"><div class="grow sub">Stump / root add</div><span class="sub">$</span><input type="number" style="width:90px" value="${bands[t].stump}" onchange="setBrushBand('${t}','stump',this.value)"></div></div>`).join("");
  h+=`</div><div class="card"><div style="font-weight:800;margin-bottom:6px">Rental cost defaults (hard cost)</div>
    <div class="sub" style="margin-bottom:6px">The chainsaw is owned — no rental line. Add a pole-saw rental here if one is ever rented.</div>
    <div class="row" style="gap:10px;align-items:center"><div class="grow sub">Stump-grinder rental</div><span class="sub">$</span><input type="number" style="width:90px" value="${rent.grinder}" onchange="setBrushRent('grinder',this.value)"></div>
    <div class="sub" style="margin-top:8px">Access multipliers (open ×1.0 · near structures ×1.15 · tight ×1.30) are fixed by policy. Veg disposal is charged by the ton (~$${(typeof QE!=="undefined"?QE.VEG_TON:58.46)}/ton for a contractor) off the estimated brush weight.</div></div>`;
  h+=`<button class="btn ghost" style="margin-top:6px" onclick="resetBrushRates()">↺ Reset to defaults</button>`;
  return h;
}
window.openBrushEditor=function(){modal("Brush / tree removal rates",`<p class="muted" style="margin-bottom:8px">Per-item, value-priced bands plus the rental cost defaults behind the live margin. Changes flow straight into the Guided Quote.</p><div id="brushEditBody">${brushEditorHTML()}</div>`);};
function _brushOvSet(fn){const o=brushOverrides();fn(o);setBrushOverrides(o);const b=document.getElementById("brushEditBody");if(b)b.innerHTML=brushEditorHTML();}
window.setBrushBand=function(t,which,v){_brushOvSet(o=>{o.bands=o.bands||{};o.bands[t]=o.bands[t]||{};o.bands[t][which]=Math.max(0,parseFloat(v)||0);});};
window.setBrushRent=function(which,v){_brushOvSet(o=>{o.rent=o.rent||{};o.rent[which]=Math.max(0,parseFloat(v)||0);});};
window.resetBrushRates=function(){if(!confirm("Reset brush / tree removal rates to defaults?"))return;setBrushOverrides({});const b=document.getElementById("brushEditBody");if(b)b.innerHTML=brushEditorHTML();};

// Register in the guided-quote picker (OBX) and the job-scheduler service catalog.
(function(){
  if(typeof WZ_SVC!=="undefined"&&WZ_SVC.obx&&!WZ_SVC.obx.some(s=>s[0]==="shrubrem")){
    // place right after the existing brush/yard-debris entry for grouping
    const i=WZ_SVC.obx.findIndex(s=>s[0]==="brush");
    WZ_SVC.obx.splice(i>=0?i+1:WZ_SVC.obx.length,0,["shrubrem","🌳 Brush / shrub / tree removal"]);
  }
  if(typeof CATALOG!=="undefined"&&CATALOG.obx&&!CATALOG.obx.some(s=>s.id==="br1")){
    CATALOG.obx.push({id:"br1",cat:"Brush & Tree",name:"Brush / shrub / small-tree removal — cut & haul (quote)",price:0,unit:"quote"});
    CATALOG.obx.push({id:"br2",cat:"Brush & Tree",name:"Stump / root removal (quote)",price:0,unit:"quote"});
  }
})();
