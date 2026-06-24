/* ---------- GUIDED QUOTE WIZARD ---------- */
let WZON=false,WZ=null;
const WZ_SVC={obx:[["softwash","🏠 House soft wash"],["roofwash","🧽 Roof soft wash"],["pressure","🚗 Driveway / concrete"],["deck","🪵 Deck / patio"],["windows","🪟 Windows"],["gutters","🏚️ Gutters"],["lotclear","🌲 Lot / land clearing"],["brush","🍂 Brush & yard debris"],["storm","🌀 Storm cleanup"],["parking","🅿️ Parking lot"],["housewatch","👁️ House-watch"],["junk","🗑️ Junk removal"],["demo","🏚️ Shed / structure demo"],["paver","🧱 Paver patio / pad"],["custom","✏️ Custom line"]],
  jam:[["lock","🔒 Smart locks"],["camera","🎥 Cameras"],["network","📶 Networking / WiFi"],["starlink","🛰️ Starlink"],["labor","🔧 Tech labor"],["custom","✏️ Custom line"]]};
const WZ_FIELDS={
 softwash:[{k:"qty",t:"num",label:"Wall area (sq ft)",ph:"e.g. 2000",warn:8000},{k:"stories",t:"sel",label:"Stories",opts:[["1","1 story"],["2","2 stories"],["3","3 stories"]]},{k:"heavy",t:"chk",label:"Heavy algae / soiling"}],
 roofwash:[{k:"qty",t:"num",label:"Roof area (sq ft)",ph:"e.g. 2000",warn:8000},{k:"steep",t:"chk",label:"Steep or hard access"},{k:"heavy",t:"chk",label:"Heavy soiling"}],
 pressure:[{k:"qty",t:"num",label:"Concrete area (sq ft)",ph:"e.g. 600",warn:6000},{k:"oil",t:"chk",label:"Oil / rust stains"}],
 deck:[{k:"qty",t:"num",label:"Deck area (sq ft)",ph:"e.g. 300",warn:2000}],
 windows:[{k:"qty",t:"num",label:"Number of panes",ph:"e.g. 24",warn:120},{k:"intext",t:"chk",label:"Interior + exterior"},{k:"upper",t:"num",label:"Upper-floor panes",ph:"0"}],
 gutters:[{k:"qty",t:"num",label:"Linear feet of gutter",ph:"e.g. 160",warn:600},{k:"stories",t:"sel",label:"Stories",opts:[["1","1 story"],["2","2 stories"]]}],
 parking:[{k:"qty",t:"num",label:"Number of spaces",ph:"e.g. 80",warn:800},{k:"freq",t:"sel",label:"Frequency",opts:[["one-time","One-time"],["weekly","Weekly"],["daily","Daily"]]}],
 housewatch:[{k:"size",t:"sel",label:"Home size",opts:[["small","Small"],["medium","Medium"],["large","Large"]]},{k:"freq",t:"sel",label:"Frequency",opts:[["monthly","Monthly"],["bi-weekly","Bi-weekly"],["weekly","Weekly"]]}],
 junk:[{k:"eighths",t:"num",label:"Truck fraction (1–8 eighths)",ph:"e.g. 4",warn:8}],
 lock:[{k:"count",t:"num",label:"How many locks?",ph:"1",warn:30},{k:"type",t:"sel",label:"Lock type",opts:[["wifi","Wi-Fi deadbolt (Yale/Schlage)"],["retrofit","Retrofit (August — keeps key)"],["budget","Budget (Ultraloq/Wyze)"],["customer-supplied","Customer-supplied (install only)"]]},{k:"hub",t:"chk",label:"Z-Wave/Zigbee hub needed"},{k:"code",t:"chk",label:"PIN / PMS code setup"},{k:"weakwifi",t:"chk",label:"Weak Wi-Fi at the door"}],
 camera:[{k:"count",t:"num",label:"How many cameras?",ph:"4",warn:32},{k:"runs",t:"num",label:"Cable runs (blank = same as cameras)",ph:""}],
 network:[{k:"aps",t:"num",label:"WiFi access points",ph:"0"},{k:"drops",t:"num",label:"Cat6 data drops",ph:"0"},{k:"design",t:"chk",label:"Network design + config"}],
 starlink:[{k:"mount",t:"sel",label:"Mount type",opts:[["eave","Eave / ground (simple)"],["roof","Roof pivot mount"],["pole","Pole / mast"]]},{k:"ext",t:"num",label:"50-ft cable extensions",ph:"0"}],
 labor:[{k:"hours",t:"num",label:"Hours",ph:"2",warn:40}],
 custom:[{k:"name",t:"txt",label:"Describe the line item",ph:"e.g. Travel surcharge"},{k:"price",t:"num",label:"Price ($)",ph:"0"}]
};
window.startWizard=function(){WZ={step:"cust",cust:{name:"",phone:"",address:"",source:"",notes:"",id:"",propertyId:"",soldBy:""},items:[],recurring:false,disc:0,discPct:null,miles:0,hours:0,haul:"pickup",zone:"local",travelMiles:null,svc:null,inp:{},deep:{},deepMods:{},deepSearch:"",id:null,invoiced:false,paid:false,paymentLink:"",finalPrice:0,adjNote:""};WZON=true;TAB="quotes";render();};
/* Open a saved quote (or a preset line / known customer) straight INTO the wizard — the
   single quote editor. Replaces the retired standalone modal that used to live in js/08. */
window.openQuote=function(id,customerId,preset){
  const d=D();const q=id?d.quotes.find(x=>x.id===id):null;
  startWizard();
  if(q){
    WZ.id=q.id;
    WZ.cust={id:q.customerId||"",name:q.cust||(q.customerId?custName(q.customerId):""),phone:"",address:q.address||"",source:"",soldBy:"",notes:"",propertyId:q.propertyId||""};
    if(q.customerId){const c=d.customers.find(x=>x.id===q.customerId);if(c){WZ.cust.phone=c.phone||"";WZ.cust.source=c.source||"";WZ.cust.soldBy=c.soldBy||"";}}
    WZ.items=JSON.parse(JSON.stringify(q.items||[]));
    WZ.recurring=!!q.recurring;WZ.miles=q.miles||0;WZ.hours=q.hours||0;WZ.crewN=q.crewN||1;WZ.disposalTrip=!!q.disposalTrip;WZ.haul=q.haul||"pickup";
    WZ.disc=q.manualDisc!=null?q.manualDisc:Math.max(0,(q.discount||0)-(q.recurring?Math.round((q.subtotal||0)*0.2):0));
    WZ.discPct=null;WZ.invoiced=!!q.invoiced;WZ.paid=!!q.paid;WZ.paymentLink=q.paymentLink||"";WZ.finalPrice=q.finalPrice||0;WZ.adjNote=q.adjNote||"";
    WZ.accepted=!!q.accepted;WZ.jobId=q.jobId||"";WZ.acceptedDate=q.acceptedDate||"";
    WZ.step="review";
  } else {
    if(preset)WZ.items=JSON.parse(JSON.stringify(preset));
    if(customerId){const c=d.customers.find(x=>x.id===customerId);if(c){WZ.cust.id=c.id;WZ.cust.name=c.name||c.company||"";WZ.cust.phone=c.phone||"";WZ.cust.source=c.source||"";WZ.cust.soldBy=c.soldBy||"";const ps=propsForCust(c.id);if(ps[0]){WZ.cust.address=ps[0].address||"";WZ.cust.propertyId=ps[0].id||"";}}}
    WZ.step=(WZ.items&&WZ.items.length)?"review":(customerId?"pick":"cust");
  }
  wizLockReconcile();
  render();
};
/* ---- in-use soft lock for the quote being edited (js/35-locks.js) ---- */
function wizAlive(){return !!(typeof WZON!=="undefined"&&WZON&&TAB==="quotes"&&WZ&&WZ.id&&!WZ.readonly);}
function wizOnLost(){if(WZON&&WZ){WZ.readonly=true;WZ.lockBy=(typeof findLockRec==="function")?findLockRec("quote",WZ.id):null;render();}}
function wizLockReconcile(){
  if(typeof lockAcquire!=="function")return;
  if(!WZON||!WZ||!WZ.id||WZ.readonly)return;
  const other=otherActiveLock("quote",WZ.id);
  if(other){WZ.readonly=true;WZ.lockBy=other;return;}
  if(!lockHeld("quote",WZ.id))lockAcquire("quote",WZ.id,{onLost:wizOnLost,alive:wizAlive});
}
function wizLockedAlert(){if(WZ&&WZ.readonly){alert("This quote is being edited by "+((WZ.lockBy&&WZ.lockBy.name)||"another user")+". Take over editing to make changes.");return true;}return false;}
window.wizTakeOver=function(){if(!WZ||!WZ.id)return;WZ.readonly=false;WZ.lockBy=null;
  if(typeof lockAcquire==="function")lockAcquire("quote",WZ.id,{onLost:wizOnLost,alive:wizAlive});render();};
window.exitWizard=function(){if(typeof lockReleaseCurrent==="function")lockReleaseCurrent();wizClearDraft();WZON=false;render();};
/* ---- draft autosave + resume (survive back / close) ---- */
const WZ_DRAFT_KEY="jsuite_wzdraft";
window.wizAutosave=function(){try{if(WZON&&WZ&&WZ.step&&WZ.step!=="done")localStorage.setItem(WZ_DRAFT_KEY,JSON.stringify({biz:S.biz,ts:now(),wz:WZ}));}catch(e){}};
function wzDraftMeta(){try{const d=JSON.parse(localStorage.getItem(WZ_DRAFT_KEY)||"null");if(!d||!d.wz||d.biz!==S.biz)return null;const wz=d.wz;let sub=0;(wz.items||[]).forEach(it=>sub+=(it.price||0)*(it.qty||1));return{name:(wz.cust&&wz.cust.name)||"",items:(wz.items||[]).length,total:sub,editing:!!wz.id};}catch(e){return null;}}
window.wizResumeDraft=function(){try{const d=JSON.parse(localStorage.getItem(WZ_DRAFT_KEY)||"null");if(!d||!d.wz)return;if(d.biz&&d.biz!==S.biz)setBiz(d.biz);WZ=d.wz;if(!WZ.step||WZ.step==="done")WZ.step=(WZ.items&&WZ.items.length)?"review":"cust";WZON=true;TAB="quotes";render();}catch(e){}};
window.wizDiscardDraft=function(){wizClearDraft();WZON=false;render();};
function wizHead(n,total,title){return `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">Step ${n} of ${total}</div><div class="nm" style="font-size:18px">${title}</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;}
function wizRender(){wizAutosave();const f={cust:wizCust,pick:wizPick,calc:wizCalc,review:wizReview,done:wizDone}[WZ.step];view.innerHTML=f();}
function wizCust(){const c=WZ.cust;
  return wizHead(1,5,"Who's the quote for?")+`<div class="card">
    <label>Find an existing customer</label>
    <div class="acwrap"><input id="wc_search" placeholder="Type a name, or tap to browse…" autocomplete="off" oninput="wizCustSearch()" onfocus="wizCustSearch()" onblur="setTimeout(function(){var b=document.getElementById('wc_sbox');if(b)b.innerHTML='';},200)"><div class="acbox" id="wc_sbox" style="max-height:260px;overflow-y:auto"></div></div>
    ${c.id?`<div class="muted" style="margin-top:4px">Linked: <b>${esc(c.name)}</b> — <a href="#" onclick="wizClearCust();return false">clear</a></div>`:""}
    <div id="wc_propwrap">${wizPropPicker()}</div>
    <div style="border-top:1px solid var(--line);margin:14px 0"></div>
    <label>Name *</label><input id="wc_name" value="${esc(c.name)}" placeholder="Customer or property name">
    <label>Phone *</label><input id="wc_phone" value="${esc(c.phone)}" inputmode="tel" placeholder="(252) ___-____">
    <label>Property address *</label><div class="acwrap"><input id="wc_address" value="${esc(c.address)}" placeholder="Start typing the address…" oninput="addrSuggest('wc_address','wc_abox')"><div class="acbox" id="wc_abox"></div></div>
    <label>How'd they find us?</label><select id="wc_source" onchange="WZ.cust.source=this.value;var w=document.getElementById('wc_soldwrap');if(w)w.innerHTML=wizSoldPicker()">${SOURCES.map(o=>`<option value="${o}" ${c.source===o?"selected":""}>${o||"— select —"}</option>`).join("")}</select>
    <div id="wc_soldwrap">${wizSoldPicker()}</div>
    <label>Notes (gate code, pets, access…)</label><textarea id="wc_notes">${esc(c.notes)}</textarea>
    <p class="muted" id="wc_err" style="margin-top:8px"></p>
    <button class="btn acc" style="margin-top:6px" onclick="wizCustNext()">Next: pick services →</button>
  </div>`;}
function wizPropPicker(){const c=WZ.cust;if(!c.id)return"";const ps=propsForCust(c.id);if(ps.length<2)return"";
  return `<label>Which property?</label><select onchange="wizPickProp(this.value)">${ps.map(p=>`<option value="${p.id}" ${c.propertyId===p.id?"selected":""}>${esc(p.label||"")} — ${esc(p.address||"")}</option>`).join("")}</select>`;}
function wizSoldPicker(){const c=WZ.cust;if(c.source!=="Cold call / in-person")return"";
  return `<label>Which team member made this sale? (credit)</label><select id="wc_sold"><option value="">— none —</option>${users().map(u=>`<option value="${u.id}" ${c.soldBy===u.id?"selected":""}>${esc(u.username)}</option>`).join("")}</select>`;}
window.wizCustSearch=function(){
  const q=val("wc_search").toLowerCase().trim();const box=document.getElementById("wc_sbox");if(!box)return;
  let m=actC().slice().sort((a,b)=>(a.name||a.company||"").toLowerCase().localeCompare((b.name||b.company||"").toLowerCase()));   // alphabetical — browse the whole list on focus
  if(q)m=m.filter(c=>((c.name||"")+" "+(c.company||"")+" "+(c.phone||"")).toLowerCase().indexOf(q)>=0);                          // …and filter as you type
  m=m.slice(0,50);
  box.innerHTML=m.length?m.map(c=>`<div class="acitem" onclick="wizPickCust('${c.id}')">${esc(c.name||c.company)}${c.phone?" · "+esc(typeof fmtPhone==="function"?fmtPhone(c.phone):c.phone):""}</div>`).join(""):`<div class="acitem muted">No match — just fill in the fields below to add new.</div>`;};
window.wizPickCust=function(id){const cust=D().customers.find(x=>x.id===id);if(!cust)return;
  const ps=propsForCust(cust.id);const prop=ps[0]||{address:"",id:""};
  WZ.cust={id:cust.id,name:cust.name||cust.company||"",phone:cust.phone||"",address:prop.address||"",propertyId:prop.id||"",source:cust.source||"",soldBy:cust.soldBy||"",notes:""};render();};
window.wizClearCust=function(){WZ.cust={name:"",phone:"",address:"",source:"",notes:"",id:"",propertyId:"",soldBy:""};render();};
window.wizPickProp=function(pid){const p=D().properties.find(x=>x.id===pid);if(p){WZ.cust.propertyId=p.id;WZ.cust.address=p.address;render();}};
window.wizCustNext=function(){
  WZ.cust.name=val("wc_name");WZ.cust.phone=val("wc_phone");WZ.cust.address=val("wc_address");WZ.cust.source=val("wc_source");WZ.cust.notes=val("wc_notes");
  const sold=document.getElementById("wc_sold");if(sold)WZ.cust.soldBy=sold.value;
  const miss=[];if(!WZ.cust.name)miss.push("name");if(!WZ.cust.phone)miss.push("phone");if(!WZ.cust.address)miss.push("address");
  if(miss.length){document.getElementById("wc_err").innerHTML='<span style="color:var(--danger)">Please fill in: '+miss.join(", ")+" (required).</span>";return;}
  WZ.step=(WZ.items&&WZ.items.length)?"review":"pick";render();
};
function wizPick(){const list=WZ_SVC[S.biz];
  return wizHead(2,5,"What do they need?")+`<div class="card"><div class="muted" style="margin-bottom:8px">Tap a service to price it. You can add several.</div>
    <div class="grid2">`+list.map(s=>`<button class="btn ghost" style="text-align:left;margin-bottom:8px" onclick="wizSetSvc('${s[0]}')">${s[1]}</button>`).join("")+`</div></div>
    ${WZ.items.length?`<button class="btn acc" style="margin-top:4px" onclick="WZ.step='review';render()">Review ${WZ.items.length} item(s) →</button>`:""}`;}
window.wizSetSvc=function(k){if(k==="demo"){openDemoEst();return;}if(k==="paver"){openPaverEst();return;}if(k==="parking"){WZON=false;TAB="map";if(typeof render==="function")render();return;}WZ.svc=k;WZ.inp={};WZ.deepSearch="";render2calc();};   /* junk falls through to wizCalc → wizJunkUI (the comprehensive item builder) */
function render2calc(){WZ.step="calc";render();setTimeout(wizLive,20);}
function wizCalc(){const k=WZ.svc,R=getRates(),r=R[k],fields=WZ_FIELDS[k];
  if(k==="junk")return wizJunkUI();
  if(k==="shrubrem")return wizBrushUI();
  if(DEEP[k])return wizDeepUI(k);
  const hint=(r&&r.hint)?`<p class="muted" style="margin-bottom:8px">${esc(r.hint)}</p>`:"";
  const f=fields.map(fl=>{
    const v=WZ.inp[fl.k]!=null?WZ.inp[fl.k]:"";
    if(fl.t==="num"||fl.t==="txt")return `<label>${fl.label}</label><input id="wf_${fl.k}" ${fl.t==="num"?'type="number" inputmode="decimal"':""} value="${esc(v)}" placeholder="${fl.ph||""}" oninput="wizLive()">`;
    if(fl.t==="sel")return `<label>${fl.label}</label><select id="wf_${fl.k}" onchange="wizLive()">${fl.opts.map(o=>`<option value="${o[0]}" ${v===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select>`;
    if(fl.t==="chk")return `<div class="toggle"><input type="checkbox" id="wf_${fl.k}" ${v?"checked":""} onchange="wizLive()"><label style="margin:0">${fl.label}</label></div>`;
    return "";
  }).join("");
  return wizHead(3,5,(r?r.label:"Custom line"))+crewAidCard(k)+`<div class="card">${hint}${f}
    <div class="totbar" style="border-top-color:var(--accent)"><span class="lab">This line</span><span class="amt" id="wz_live">$0</span></div>
    <div id="wz_note" class="muted" style="font-size:13px"></div>
  </div>
  <div class="wizfoot"><div class="wf-amt"><span class="wf-lab">This line</span><b id="wz_foot">$0</b></div><button class="btn ghost sm" onclick="WZ.step='pick';render()">← Back</button><button class="btn acc grow" onclick="wizAddItem()">Add to quote</button></div>`;}
function wizReadInp(){const fields=WZ_FIELDS[WZ.svc];if(!fields)return WZ.inp||{};const o={};fields.forEach(fl=>{const e=document.getElementById("wf_"+fl.k);if(!e)return;o[fl.k]=fl.t==="chk"?e.checked:(fl.t==="num"?parseFloat(e.value)||0:e.value);});WZ.inp=o;return o;}
window.wizLive=function(){if(!WZ_FIELDS[WZ.svc])return;const inp=wizReadInp();let res;
  if(WZ.svc==="custom")res={name:inp.name||"Custom line",price:rnd5(inp.price||0),notes:[]};
  else res=calcQuote(WZ.svc,inp)||{price:0,notes:[]};
  const el=document.getElementById("wz_live");if(el)el.textContent=money(res.price);
  const ft=document.getElementById("wz_foot");if(ft)ft.textContent=money(res.price);
  const nb=document.getElementById("wz_note");if(nb){let notes=(res.notes||[]).slice();
    const fl=WZ_FIELDS[WZ.svc].find(x=>x.warn);if(fl&&(inp[fl.k]||0)>fl.warn)notes.unshift("⚠ That's a big number ("+inp[fl.k]+") — double-check before quoting.");
    nb.innerHTML=notes.map(n=>"• "+esc(n)).join("<br>");}
};
window.wizAddItem=function(){const inp=wizReadInp();let res;
  if(WZ.svc==="custom"){if(!inp.name||!inp.price){alert("Add a description and price.");return;}res={name:inp.name,price:rnd5(inp.price),notes:[]};}
  else{if(!inp.qty&&!inp.count&&!inp.hours&&WZ.svc!=="housewatch"&&WZ.svc!=="starlink"&&WZ.svc!=="network"){alert("Enter the amount of work first.");return;}res=calcQuote(WZ.svc,inp);}
  WZ.items.push({name:res.name,price:res.price,cost:(res.cost||0),notes:res.notes||[],qty:1,unit:"quote",serviceId:""});
  WZ.step="review";render();
};
window.wizRemItem=function(i){WZ.items.splice(i,1);render();};
/* discount: chips re-render (to re-highlight); the live %/flat inputs update in place to keep focus */
window.wizDiscPct=function(p){p=p||0;let s=0;(WZ.items||[]).forEach(it=>s+=(it.price||0)*(it.qty||1));WZ.discPct=p;WZ.disc=Math.round(s*p/100);render();};
window.wizDiscPctLive=function(v){let p=parseFloat(v)||0,s=0;(WZ.items||[]).forEach(it=>s+=(it.price||0)*(it.qty||1));WZ.discPct=p;WZ.disc=Math.round(s*p/100);const fl=document.getElementById("wz_disc");if(fl)fl.value=WZ.disc;wizReviewTotals();};
window.wizDiscFlat=function(v){WZ.disc=parseFloat(v)||0;WZ.discPct=null;wizReviewTotals();};
/* the price dial: sets the final price directly. disc = quote − price (negative disc = markup). updates inputs + live summary */
window.wizPriceSlide=function(price,sub){price=parseFloat(price)||0;WZ.disc=Math.round((sub||0)-price);WZ.discPct=null;
  const fl=document.getElementById("wz_disc");if(fl)fl.value=WZ.disc>0?WZ.disc:"";const pf=document.getElementById("wz_discpct");if(pf)pf.value="";
  wizReviewTotals();};
/* ← from the review back to the load builder; drop the line being edited so re-adding doesn't duplicate (the builder still holds WZ.junk / WZ.inp) */
window.wizBackToBuild=function(){if(WZ.items&&WZ.items.length)WZ.items.pop();WZ.step="calc";render();setTimeout(function(){if(typeof wizLive==="function")wizLive();},20);};

/* ---- the single editable review/edit screen ---- */
function reviewSummaryHTML(){
  let sub=0;WZ.items.forEach(it=>sub+=(it.price||0)*(it.qty||1));
  const total=Math.max(0,sub-(WZ.disc||0));
  const cost=itemsCost(WZ.items);                        // hard cost only (disposal + mileage already baked into the line)
  const profit=total-cost;
  const crewN=Math.max(1,WZ.crewN||1), hrs=WZ.hours||0, personHrs=crewN*hrs;
  const fieldPool=Math.max(0,total-cost)*0.48;           // (revenue − hard costs) × 60% labor × 80% field work
  const perPersonField=fieldPool/crewN, perHr=hrs>0?perPersonField/hrs:0, TGT=45;
  const notes=[].concat.apply([],WZ.items.map(it=>it.notes||[]));
  // market band (colored zones) — same look as the junk builder; the price marker slides as you discount
  const B=(typeof MARKET_BANDS!=="undefined"&&MARKET_BANDS.junk)?MARKET_BANDS.junk:{lo:150,hi:800};
  const bandLo=B.lo,bandHi=B.hi,bMid=(bandLo+bandHi)/2,bMax=bandHi*1.3;
  const z1=bandLo/bMax*100,z2=bMid/bMax*100,z3=bandHi/bMax*100,pPct=Math.min(99,Math.max(1,total/bMax*100));
  const zone=total<bandLo?["underpriced","#c1121f"]:total<bMid?["good value","#1a7f37"]:total<=bandHi?["premium","#b8860b"]:["above market","#c1121f"];
  let h=`<div class="card" style="margin-top:10px">
    <div class="row" style="justify-content:space-between;align-items:baseline"><div class="nm" style="font-size:26px">${money(total)}</div><div class="sub" style="text-align:right">${WZ.disc>0?`was ${money(sub)} · −${money(WZ.disc)}${WZ.discPct?` (${WZ.discPct}%)`:""}`:WZ.disc<0?`marked up +${money(-WZ.disc)} over ${money(sub)}`:`hard cost ${money(cost)}`}<br>profit ${money(profit)}</div></div>
    <div style="position:relative;height:13px;margin-top:8px;background:linear-gradient(90deg,#f1a9a9 0 ${z1}%,#9ed89e ${z1}% ${z2}%,#ffd97a ${z2}% ${z3}%,#ef9a6b ${z3}% 100%);border-radius:7px"><div style="position:absolute;top:-3px;bottom:-3px;left:${pPct}%;width:3px;background:#0b1f3a"></div></div>
    <div class="sub" style="font-size:12px;margin-top:3px">📊 <b style="color:${zone[1]}">${zone[0]}</b> · ${money(bandLo)}–${money(bandHi)} market range</div>
    <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><div class="row" style="gap:14px;flex-wrap:wrap"><div class="grow"><div class="sub">${crewN} ${crewN===1?"person":"people"} × ~${hrs||"?"} hr each${personHrs?` (${Math.round(personHrs*10)/10} crew-hrs · drive + load + 20-min on-site)`:""}</div><div class="nm" style="font-size:15px">${money(perPersonField)} each</div></div><div class="grow" style="text-align:right"><div class="sub">Per hour each</div><div class="nm" style="font-size:20px;color:${hrs>0&&perHr<TGT?"var(--danger)":"var(--accent)"}">${hrs>0?money(perHr)+"/hr "+(perHr>=TGT?"✓":"⚠"):"—"}</div></div></div>`;
  if(hrs>0&&perHr<TGT){const need=Math.ceil((TGT*personHrs/0.48+cost)/5)*5;h+=`<div class="note" style="margin-top:6px;white-space:normal">⚠️ Below your <b>${money(TGT)}/hr</b> floor — full price is ${money(sub)}; you'd need ~${money(need)} to clear $45/hr. Ease off the discount.</div>`;}
  else if(hrs>0)h+=`<div class="sub" style="margin-top:4px;color:var(--accent)">✓ Clears your $45/hr floor.</div>`;
  h+=`</div></div>`;
  if(notes.length)h+=`<div class="muted" style="font-size:13px;margin-top:6px"><b>To confirm on site:</b><br>`+notes.map(n=>"• "+esc(n)).join("<br>")+`</div>`;
  return h;
}
function wizReviewTotals(){
  const s=document.getElementById("wz_summary");if(s)s.innerHTML=reviewSummaryHTML();
  let sub=0;WZ.items.forEach(it=>sub+=(it.price||0)*(it.qty||1));
  const total=Math.max(0,sub-(WZ.disc||0));
  const f=document.getElementById("wz_rtotal");if(f)f.textContent=money(total);
  wizAutosave();
}
function wizReview(){
  if(!WZ.items)WZ.items=[];
  if(typeof wizLockReconcile==="function")wizLockReconcile();
  const editing=!!WZ.id;
  let h=`<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">${editing?"Editing saved quote":"Review"}</div><div class="nm" style="font-size:18px">${editing?"Edit quote":"Review the quote"}</div></div><button class="btn ghost sm" onclick="exitWizard()">${editing?"Close":"Cancel"}</button></div>`;
  if(WZ.readonly)h=`<div class="lockbanner"><div class="grow">🔒 <b>${esc((WZ.lockBy&&WZ.lockBy.name)||"Someone")}</b>${WZ.lockBy&&WZ.lockBy.initials?` (${esc(WZ.lockBy.initials)})`:""} is editing this — read-only.</div><button class="btn acc sm" onclick="wizTakeOver()">Take over editing</button></div>`+h;
  // customer mini-form (full single flow — no bounce required)
  h+=`<div class="card"><label style="margin-top:0">Customer / name</label>
    <input id="r_name" value="${esc(WZ.cust.name||"")}" placeholder="Customer or property name" onchange="WZ.cust.name=this.value;wizAutosave()">
    <label>Phone</label><input id="r_phone" value="${esc(WZ.cust.phone||"")}" inputmode="tel" placeholder="(252) ___-____" onchange="WZ.cust.phone=this.value;wizAutosave()">
    <label>Property address</label><input id="r_addr" value="${esc(WZ.cust.address||"")}" placeholder="Address" onchange="WZ.cust.address=this.value;wizAutosave()"></div>`;
  // price dial — drag LEFT to discount (down to your good-value floor), RIGHT to mark up jobs you don't want (to +20%)
  let sub=0;WZ.items.forEach(it=>sub+=(it.price||0)*(it.qty||1));
  const _cost=itemsCost(WZ.items),_B=(typeof MARKET_BANDS!=="undefined"&&MARKET_BANDS.junk)?MARKET_BANDS.junk:{lo:150,hi:800};
  const floorP=Math.max(_B.lo,Math.ceil(_cost*1.2/5)*5),ceilP=Math.max(floorP+5,Math.round(sub*1.2/5)*5),curP=Math.max(floorP,Math.min(ceilP,sub-(WZ.disc||0)));
  h+=`<div class="card" style="margin-top:10px"><label style="margin-top:0">Set the price — ◀ discount · mark up ▶</label>
    <input type="range" min="${floorP}" max="${ceilP}" step="5" value="${curP}" oninput="wizPriceSlide(this.value,${sub})" style="width:100%;accent-color:var(--accent)">
    <div class="row" style="justify-content:space-between"><span class="sub">◀ floor ${money(floorP)}</span><span class="sub">full ${money(sub)} · +20% ${money(ceilP)} ▶</span></div>
    <div class="row" style="gap:8px;margin-top:6px"><div class="grow"><label style="margin-top:0">Custom % off</label><input type="number" id="wz_discpct" inputmode="decimal" value="${WZ.discPct||''}" placeholder="%" oninput="wizDiscPctLive(this.value)"></div><div class="grow"><label style="margin-top:0">Or flat $ off</label><input type="number" id="wz_disc" inputmode="decimal" value="${WZ.disc>0?WZ.disc:''}" oninput="wizDiscFlat(this.value)"></div></div></div>`;
  // live summary region (partial-updated to preserve input focus)
  h+=`<div id="wz_summary">${reviewSummaryHTML()}</div>`;
  // collateral
  h+=`<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="wizPrint()">🖨 Print / PDF</button><button class="btn ghost grow" onclick="wizCopy()">Copy text</button></div>`;
  // edit-mode actions (only for a saved quote)
  if(editing){
    // Accept the quote → schedule a job (crew availability for the chosen date)
    h+=`<div class="card" style="margin-top:10px"><div style="font-weight:800;margin-bottom:6px">Accept &amp; schedule</div>`;
    const job=(WZ.accepted&&WZ.jobId)?D().jobs.find(j=>j.id===WZ.jobId&&!j.deleted):null;
    if(job){
      h+=`<div class="row"><div class="grow"><div class="nm" style="font-size:15px">✓ Scheduled — ${fmtDate(job.date)}${job.time?" · "+esc(job.time):""}</div><div class="sub" style="margin-top:2px">${(typeof crewChips==="function")?crewChips(job):""}</div></div><button class="btn ghost sm" onclick="closeWizToJob('${job.id}')">Open job</button></div>
        <button class="btn ghost sm" style="margin-top:8px" onclick="openAcceptSchedule('${WZ.id}')">Reschedule / reassign crew</button>`;
    } else if(WZ.accepted&&WZ.jobId){
      h+=`<div class="muted" style="margin-bottom:8px">The linked job was removed.</div><button class="btn acc" onclick="openAcceptSchedule('${WZ.id}')">Schedule again →</button>`;
    } else {
      h+=`<div class="sub" style="white-space:normal;margin-bottom:8px">Customer accepted? Turn this quote into a scheduled job — it carries the customer &amp; address, and lets you assign crew for the date.</div>
        <button class="btn acc" onclick="openAcceptSchedule('${WZ.id}')">Accept &amp; schedule job →</button>`;
    }
    h+=`</div>`;
    let _qsub=0;WZ.items.forEach(it=>_qsub+=(it.price||0)*(it.qty||1));const _qtot=Math.max(0,_qsub-(WZ.disc||0));
    h+=`<div class="card" style="margin-top:10px"><div style="font-weight:800;margin-bottom:6px">Invoice &amp; payment</div>
      <div class="row" style="gap:8px"><button class="btn ghost sm grow" onclick="wizToggleInvoiced()">${WZ.invoiced?"✓ Invoiced":"Mark invoiced"}</button><button class="btn ghost sm grow" onclick="wizTogglePaid()">${WZ.paid?"✓ Paid":"Mark paid"}</button></div>
      <label style="margin-top:10px">Final price charged <span class="sub">— if different from the ${money(_qtot)} quote (add-ons, discount)</span></label>
      <div class="row" style="gap:8px"><input type="number" id="wz_final" inputmode="decimal" placeholder="${_qtot}" value="${WZ.finalPrice||''}" style="flex:1"><button class="btn ghost sm" onclick="wizSetFinal()">Save</button></div>
      <input id="wz_adjnote" placeholder="Reason (e.g. added interior door, gave a discount)" value="${esc(WZ.adjNote||'')}" style="margin-top:6px">
      ${WZ.finalPrice?`<div class="note" style="margin-top:6px">Charging <b>${money(WZ.finalPrice)}</b> (quote was ${money(_qtot)})${WZ.adjNote?" · "+esc(WZ.adjNote):""}</div>`:""}`;
    if(WZ.paymentLink)h+=`<a class="btn acc" style="margin-top:8px" href="${esc(WZ.paymentLink)}" target="_blank" rel="noopener">💳 Pay now</a><button class="btn ghost sm" style="margin-top:6px" onclick="WZ.paymentLink='';wizPersist();render()">Remove link</button>`;
    else h+=`<div class="note" style="margin-top:8px">Add a Stripe Payment Link (no monthly fee, ~2.9%+30¢, one link per amount).</div><input id="wz_paylink" style="margin-top:6px" placeholder="https://buy.stripe.com/..." value=""><button class="btn ghost sm" style="margin-top:6px" onclick="wizSetPayLink()">Save link</button>`;
    h+=`</div><button class="btn danger" style="margin-top:10px" onclick="wizDelete()">Delete quote</button>`;
  }
  // sticky footer: back to the load + crew (−/+) + total + save
  const total=Math.max(0,sub-(WZ.disc||0)),cN=Math.max(1,WZ.crewN||1);
  h+=`<div class="wizfoot" style="gap:6px">${editing?"":`<button class="btn ghost sm" onclick="wizBackToBuild()" title="Back to the load">←</button>`}<span style="white-space:nowrap;font-size:12px">👷<button class="btn ghost sm" style="width:28px;padding:2px;margin:0 2px" onclick="WZ.crewN=Math.max(1,(WZ.crewN||2)-1);render()">−</button>${cN}<button class="btn ghost sm" style="width:28px;padding:2px;margin:0 2px" onclick="WZ.crewN=(WZ.crewN||1)+1;render()">+</button></span><div class="wf-amt"><span class="wf-lab">Total</span><b id="wz_rtotal">${money(total)}</b></div><button class="btn acc grow" onclick="wizFinish()" ${WZ.items.length?"":"disabled"}>${editing?"Save changes":"Save & present"} →</button></div>`;
  return h;
}
/* line editing */
window.wizItemField=function(i,field,v){if(!WZ.items[i])return;
  if(field==="qty")WZ.items[i].qty=Math.max(1,parseInt(v)||1);
  else if(field==="price")WZ.items[i].price=parseFloat(v)||0;
  else if(field==="cost")WZ.items[i].cost=parseFloat(v)||0;
  else WZ.items[i][field]=v;
  const lt=document.getElementById("lt_"+i);if(lt)lt.textContent=money((WZ.items[i].price||0)*(WZ.items[i].qty||1));
  wizReviewTotals();};
window.wizAddBlankLine=function(){WZ.items.push({serviceId:"",name:"",unit:"flat",price:0,qty:1,cost:0});render();};
window.wizLineSvc=function(i,sid){const s=cat().find(x=>x.id===sid);if(!s){WZ.items[i].serviceId="";render();return;}WZ.items[i]=Object.assign({},WZ.items[i],{serviceId:s.id,name:s.name,unit:s.unit,price:s.price,qty:WZ.items[i].qty||1});render();};
window.wizDumpFee=function(i){const e=document.getElementById("df_lbs_"+i);const lbs=parseFloat(e?e.value:"")||0;if(!lbs){alert("Enter a load weight in pounds first.");return;}const veg=!!(document.getElementById("df_veg_"+i)||{}).checked;WZ.items.splice(i+1,0,disposalLine(lbs,veg));if(!WZ.disposalTrip){WZ.miles=(WZ.miles||0)+DISPOSAL_TRIP_MILES;WZ.disposalTrip=true;}render();};
/* upsert WZ -> quotes (create or update), resolving customer + property */
function wizResolveCust(){
  const d=D();
  let cust=WZ.cust.id?d.customers.find(c=>c.id===WZ.cust.id):null;
  if(!cust&&WZ.cust.name)cust=d.customers.find(c=>!c.deleted&&(c.name||"").toLowerCase()===WZ.cust.name.toLowerCase());
  if(!cust){
    if(!WZ.cust.name)return{cust:null,prop:null};
    cust={id:uid(),name:WZ.cust.name,company:"",phone:WZ.cust.phone,email:"",town:"",type:"Residential",status:"Quoted",source:WZ.cust.source,soldBy:WZ.cust.soldBy,manager:WZ.cust.soldBy,notes:[],next:""};
    if(WZ.cust.notes)cust.notes.push({t:new Date().toLocaleString(),text:WZ.cust.notes});
    touch(cust);d.customers.push(cust);
  } else {
    cust.phone=cust.phone||WZ.cust.phone;if(WZ.cust.source&&!cust.source)cust.source=WZ.cust.source;if(WZ.cust.soldBy&&!cust.soldBy)cust.soldBy=WZ.cust.soldBy;
    if(cust.status==="Lead")cust.status="Quoted";if(WZ.cust.notes)cust.notes.push({t:new Date().toLocaleString(),text:WZ.cust.notes});touch(cust);
  }
  WZ.cust.notes="";WZ.cust.id=cust.id;
  let prop=WZ.cust.propertyId?d.properties.find(x=>x.id===WZ.cust.propertyId):null;
  if(!prop&&WZ.cust.address)prop=actProps().find(x=>(x.address||"").toLowerCase()===WZ.cust.address.toLowerCase()&&(x.customerIds||[]).indexOf(cust.id)>=0);
  if(!prop&&WZ.cust.address){prop={id:uid(),label:"Main",address:WZ.cust.address||"",accessNotes:"",lat:null,lng:null,customerIds:[cust.id],updatedAt:now()};d.properties.push(prop);geocodeProp(prop);}
  else if(prop&&(prop.customerIds||[]).indexOf(cust.id)<0){prop.customerIds.push(cust.id);touch(prop);}
  if(prop)WZ.cust.propertyId=prop.id;
  return{cust:cust,prop:prop};
}
window.wizPersist=function(){
  if(WZ&&WZ.readonly)return (D().quotes.find(x=>x.id===WZ.id))||{};   // read-only (someone else holds the lock): never write
  const d=D();const r=wizResolveCust(),cust=r.cust,prop=r.prop;
  let sub=0;WZ.items.forEach(it=>sub+=(it.price||0)*(it.qty||1));
  const rec=WZ.recurring&&BIZ[S.biz].recurring;const recDisc=rec?sub*0.2:0;const manual=(WZ.disc||0);const disc=recDisc+manual;const total=Math.max(0,sub-disc);
  const base=WZ.id?(d.quotes.find(x=>x.id===WZ.id)||{}):{};
  const q=Object.assign(base,{
    id:WZ.id||base.id||uid(),
    customerId:cust?cust.id:(base.customerId||null),
    cust:WZ.cust.name||(cust?cust.name:(base.cust||"")),
    propertyId:prop?prop.id:(base.propertyId||null),
    address:(prop&&prop.address)||WZ.cust.address||base.address||"",
    date:base.date||today(),
    items:WZ.items.map(it=>({serviceId:it.serviceId||"",name:it.name||"",unit:it.unit||"quote",price:+it.price||0,qty:it.qty||1,cost:+it.cost||0,notes:(it.notes&&it.notes.length?it.notes:undefined),breakdown:it.breakdown})),
    recurring:rec,subtotal:sub,discount:disc,manualDisc:manual,miles:(WZ.miles||0),disposalTrip:!!WZ.disposalTrip,total:total,
    cost:itemsCost(WZ.items)+mileageCost(WZ.miles),
    paymentLink:WZ.paymentLink||base.paymentLink||"",invoiced:!!WZ.invoiced,paid:!!WZ.paid,finalPrice:+WZ.finalPrice||0,adjNote:WZ.adjNote||base.adjNote||"",hours:+WZ.hours||0,crewN:+WZ.crewN||1,haul:WZ.haul||base.haul||"pickup"
  });
  touch(q);
  if(!q.num){ const _ex=WZ.id?d.quotes.find(x=>x.id===WZ.id):null; q.num=(_ex&&_ex.num)||(typeof nextQuoteNum==="function"?nextQuoteNum():0); }
  if(WZ.id){const i=d.quotes.findIndex(x=>x.id===WZ.id);if(i>=0)d.quotes[i]=q;else d.quotes.push(q);
    if(typeof logChange==="function")logChange("update","quote",q.id,"Updated quote "+money(total)+(q.cust?" · "+q.cust:""));}
  else{d.quotes.push(q);WZ.id=q.id;if(typeof logChange==="function")logChange("create","quote",q.id,"Quoted "+money(total)+(q.cust?" · "+q.cust:""));}
  if(q.customerId){const c=d.customers.find(x=>x.id===q.customerId);if(c&&(c.status==="Lead"||c.status==="Contacted")){c.status="Quoted";touch(c);}}
  save();return q;
};
window.wizFinish=function(){if(wizLockedAlert())return;const q=wizPersist();CURQ=q;QITEMS=q.items;WZ.savedTotal=q.total;if(typeof lockReleaseCurrent==="function")lockReleaseCurrent();wizClearDraft();WZ.step="done";render();};
window.wizToggleInvoiced=function(){if(wizLockedAlert())return;WZ.invoiced=!WZ.invoiced;wizPersist();render();};
window.wizTogglePaid=function(){if(wizLockedAlert())return;WZ.paid=!WZ.paid;if(WZ.paid)WZ.invoiced=true;const q=wizPersist();if(typeof syncQuoteIncome==="function"){syncQuoteIncome(q);save();}if(typeof logChange==="function")logChange("update","quote",q.id,(WZ.paid?"Marked paid ":"Unmarked paid ")+money(q.finalPrice||q.total)+(q.cust?" · "+q.cust:""));render();};
window.wizSetFinal=function(){if(wizLockedAlert())return;const v=val("wz_final");WZ.finalPrice=(v===""||v==null)?0:Math.max(0,parseFloat(v)||0);WZ.adjNote=val("wz_adjnote")||"";const q=wizPersist();if(q.paid&&typeof syncQuoteIncome==="function"){syncQuoteIncome(q);save();}if(typeof logChange==="function")logChange("update","quote",q.id,"Final price "+money(q.finalPrice||q.total)+(q.cust?" · "+q.cust:""));render();};
window.wizSetPayLink=function(){if(wizLockedAlert())return;const e=document.getElementById("wz_paylink");if(e)WZ.paymentLink=e.value.trim();wizPersist();render();};
window.wizDelete=function(){if(!WZ.id){exitWizard();return;}if(wizLockedAlert())return;if(!confirm("Delete this quote?"))return;const q=D().quotes.find(x=>x.id===WZ.id);if(q){q.deleted=true;touch(q);if(typeof logChange==="function")logChange("delete","quote",q.id,"Deleted quote"+(q.cust?" · "+q.cust:""));save();}wizClearDraft();exitWizard();};
/* feed the shared print/copy helpers (js/08) from the wizard's state */
function wizSyncLegacy(){
  let sub=0;WZ.items.forEach(it=>sub+=(it.price||0)*(it.qty||1));
  const rec=WZ.recurring&&BIZ[S.biz].recurring;const recDisc=rec?sub*0.2:0;const disc=recDisc+(WZ.disc||0);const total=Math.max(0,sub-disc);
  QITEMS=WZ.items.map(it=>({serviceId:it.serviceId||"",name:it.name||"",unit:it.unit||"quote",price:+it.price||0,qty:it.qty||1,cost:+it.cost||0}));
  CURQ={cust:WZ.cust.name||"",address:WZ.cust.address||"",invoiced:!!WZ.invoiced,paymentLink:WZ.paymentLink||"",subtotal:sub,discount:disc,total:total};
}
window.wizPrint=function(){wizSyncLegacy();printQuote();};
window.wizCopy=function(){wizSyncLegacy();copyQuote();};
/* draft autosave hook — fleshed out in the autosave chunk; safe no-op clear here */
function wizClearDraft(){try{localStorage.removeItem("jsuite_wzdraft");}catch(e){}}
function wizDone(){
  return `<div class="card" style="text-align:center;padding:30px 18px">
    <div style="font-size:40px">✅</div>
    <div class="nm" style="font-size:22px;margin:6px 0">Quote ready</div>
    <div style="font-size:34px;font-weight:800;color:var(--brand-text)">${money(WZ.savedTotal)}</div>
    <div class="muted">for ${esc(WZ.cust.name)}</div>
    <div class="row" style="gap:8px;margin-top:18px"><button class="btn acc grow" onclick="printQuote()">🖨 Print / share</button><button class="btn ghost grow" onclick="copyQuote()">Copy text</button></div>
    <button class="btn ghost" style="margin-top:8px" onclick="startWizard()">+ New guided quote</button>
    <button class="btn" style="margin-top:8px" onclick="exitWizard()">Done</button>
    <p class="muted" style="margin-top:10px">Saved to ${esc(WZ.cust.name)}'s record — follow up from the Customers tab.</p>
  </div>`;}

