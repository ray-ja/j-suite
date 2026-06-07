/* ---------- GUIDED QUOTE WIZARD ---------- */
let WZON=false,WZ=null;
const WZ_SVC={obx:[["softwash","🏠 House soft wash"],["roofwash","🧽 Roof soft wash"],["pressure","🚗 Driveway / concrete"],["deck","🪵 Deck / patio"],["windows","🪟 Windows"],["gutters","🏚️ Gutters"],["lotclear","🌲 Lot / land clearing"],["brush","🍂 Brush & yard debris"],["storm","🌀 Storm cleanup"],["parking","🅿️ Parking lot"],["housewatch","👁️ House-watch"],["junk","🗑️ Junk removal"],["demo","🏚️ Shed / structure demo"],["custom","✏️ Custom line"]],
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
window.startWizard=function(){WZ={step:"cust",cust:{name:"",phone:"",address:"",source:"",notes:"",id:"",propertyId:"",soldBy:""},items:[],recurring:false,disc:0,miles:0,svc:null,inp:{},deep:{},deepMods:{},deepSearch:""};WZON=true;TAB="quotes";render();};
window.exitWizard=function(){WZON=false;render();};
function wizHead(n,total,title){return `<div class="row" style="margin:0 2px 10px"><div class="grow"><div class="sub">Step ${n} of ${total}</div><div class="nm" style="font-size:18px">${title}</div></div><button class="btn ghost sm" onclick="exitWizard()">Cancel</button></div>`;}
function wizRender(){const f={cust:wizCust,pick:wizPick,calc:wizCalc,review:wizReview,done:wizDone}[WZ.step];view.innerHTML=f();}
function wizCust(){const c=WZ.cust;
  return wizHead(1,5,"Who's the quote for?")+`<div class="card">
    <label>Find an existing customer</label>
    <div class="acwrap"><input id="wc_search" placeholder="Type a name…" autocomplete="off" oninput="wizCustSearch()"><div class="acbox" id="wc_sbox"></div></div>
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
window.wizCustSearch=function(){const q=val("wc_search").toLowerCase();const box=document.getElementById("wc_sbox");if(!box)return;if(q.length<2){box.innerHTML="";return;}
  const m=actC().filter(c=>(c.name||c.company||"").toLowerCase().indexOf(q)>=0).slice(0,6);
  box.innerHTML=m.length?m.map(c=>`<div class="acitem" onclick="wizPickCust('${c.id}')">${esc(c.name||c.company)}${c.phone?" · "+esc(c.phone):""}</div>`).join(""):`<div class="acitem muted">No match — just fill in the fields below to add new.</div>`;};
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
  WZ.step="pick";render();
};
function wizPick(){const list=WZ_SVC[S.biz];
  return wizHead(2,5,"What do they need?")+`<div class="card"><div class="muted" style="margin-bottom:8px">Tap a service to price it. You can add several.</div>
    <div class="grid2">`+list.map(s=>`<button class="btn ghost" style="text-align:left;margin-bottom:8px" onclick="wizSetSvc('${s[0]}')">${s[1]}</button>`).join("")+`</div></div>
    ${WZ.items.length?`<button class="btn acc" style="margin-top:4px" onclick="WZ.step='review';render()">Review ${WZ.items.length} item(s) →</button>`:""}`;}
window.wizSetSvc=function(k){if(k==="demo"){openDemoEst();return;}WZ.svc=k;WZ.inp={};WZ.deepSearch="";render2calc();};
function render2calc(){WZ.step="calc";render();setTimeout(wizLive,20);}
function wizCalc(){const k=WZ.svc,R=getRates(),r=R[k],fields=WZ_FIELDS[k];
  if(k==="junk")return wizJunkUI();
  if(DEEP[k])return wizDeepUI(k);
  const hint=(r&&r.hint)?`<p class="muted" style="margin-bottom:8px">${esc(r.hint)}</p>`:"";
  const f=fields.map(fl=>{
    const v=WZ.inp[fl.k]!=null?WZ.inp[fl.k]:"";
    if(fl.t==="num"||fl.t==="txt")return `<label>${fl.label}</label><input id="wf_${fl.k}" ${fl.t==="num"?'type="number" inputmode="decimal"':""} value="${esc(v)}" placeholder="${fl.ph||""}" oninput="wizLive()">`;
    if(fl.t==="sel")return `<label>${fl.label}</label><select id="wf_${fl.k}" onchange="wizLive()">${fl.opts.map(o=>`<option value="${o[0]}" ${v===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select>`;
    if(fl.t==="chk")return `<div class="toggle"><input type="checkbox" id="wf_${fl.k}" ${v?"checked":""} onchange="wizLive()"><label style="margin:0">${fl.label}</label></div>`;
    return "";
  }).join("");
  return wizHead(3,5,(r?r.label:"Custom line"))+`<div class="card">${hint}${f}
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
  WZ.step="pick";render();
};
window.wizRemItem=function(i){WZ.items.splice(i,1);render();};
window.wizDiscPct=function(p){let s=0;(WZ.items||[]).forEach(it=>s+=it.price);WZ.discPct=p||0;WZ.disc=Math.round(s*(p||0)/100);render();};
window.wizDiscFlat=function(v){WZ.disc=parseFloat(v)||0;WZ.discPct=null;render();};
function wizReview(){
  let sub=0;WZ.items.forEach(it=>sub+=it.price);
  const mc=mileageCost(WZ.miles);
  const rec=WZ.recurring&&BIZ[S.biz].recurring; const recDisc=rec?sub*0.2:0;
  const total=Math.max(0,sub-recDisc-(WZ.disc||0));
  // negotiation math (items 7-9)
  const cost=itemsCost(WZ.items)+mc;
  const profit=total-cost, margin=total>0?profit/total:0;
  const floorPrice=cost>0?cost/(1-MARGIN_FLOOR):0;          // lowest price that holds the 35% margin floor
  const maxDisc=Math.max(0,sub-floorPrice);                  // room to discount off the subtotal before breaching the floor
  const maxDiscPct=sub>0?(maxDisc/sub*100):0;
  const fieldPool=total*0.60*0.80;                           // OA: 60% Labor Pool -> 80% Field Work, then / # working
  const notes=[].concat.apply([],WZ.items.map(it=>it.notes||[]));
  return wizHead(4,5,"Review the quote")+`<div class="card">
    ${WZ.items.map((it,i)=>`<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(it.name)}</div></div><div style="font-weight:700">${money(it.price)}</div><button class="rm" onclick="wizRemItem(${i})">×</button></div>`).join("")||'<div class="muted">No items yet.</div>'}
    <button class="btn ghost sm" style="margin-top:8px" onclick="WZ.step='pick';render()">+ Add another service</button>
    ${BIZ[S.biz].recurring?`<div class="toggle"><input type="checkbox" id="wz_rec" ${WZ.recurring?"checked":""} onchange="WZ.recurring=this.checked;render()"><label style="margin:0">Recurring plan — 20% off</label></div>`:""}
    <label>Discount</label>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">
      ${[5,10,15,20,25,30].map(p=>`<button class="btn ghost sm" style="${WZ.discPct===p?'background:var(--accent);color:var(--accent-ink);border-color:var(--accent)':''}" onclick="wizDiscPct(${p})">${p}%</button>`).join("")}
      <button class="btn ghost sm" onclick="WZ.disc=0;WZ.discPct=null;render()">Clear</button>
    </div>
    <div class="row" style="gap:8px">
      <div class="grow"><label style="margin-top:0">Custom %</label><input type="number" id="wz_discpct" inputmode="decimal" value="${WZ.discPct||''}" placeholder="%" oninput="wizDiscPct(parseFloat(this.value)||0)"></div>
      <div class="grow"><label style="margin-top:0">Or flat $</label><input type="number" id="wz_disc" inputmode="decimal" value="${WZ.disc||0}" onchange="wizDiscFlat(this.value)"></div>
    </div>
    <label>Round-trip miles (drive cost @ ${MILEAGE_RATE_LABEL}/mi)</label><input type="number" id="wz_miles" inputmode="decimal" value="${WZ.miles||0}" onchange="WZ.miles=parseFloat(this.value)||0;render()">
    <div style="margin-top:10px;font-size:14px">Subtotal: ${money(sub)}${recDisc?"<br>Recurring −"+money(recDisc):""}${WZ.disc?"<br>Discount −"+money(WZ.disc)+(WZ.discPct?" ("+WZ.discPct+"%)":""):""}</div>
    ${cogsStrip(total, cost)}
    <div class="sub" style="margin-top:4px">Cost includes ${money(itemsCost(WZ.items))} job hard cost${WZ.miles?" + "+money(mc)+" drive ("+WZ.miles+" mi × "+MILEAGE_RATE_LABEL+")":""}.</div>
    ${cost>0?`<div class="card" style="background:var(--soft);margin-top:8px;padding:10px"><div style="font-weight:800;font-size:13px">🛑 Walk-away floor</div><div class="sub" style="margin-top:2px">Lowest price before you drop under the ${Math.round(MARGIN_FLOOR*100)}% floor: <b>${money(floorPrice)}</b>. Room to discount: <b>${money(maxDisc)} (${maxDiscPct.toFixed(0)}%)</b> off the ${money(sub)} subtotal.</div></div>`:''}
    <details class="card" style="margin-top:8px"><summary style="font-weight:800;cursor:pointer">💰 Why this margin + your take-home (tap)</summary>
      <div style="font-size:13px;line-height:1.7;margin-top:8px">
        <b>Margin = price vs. hard cost.</b> Price ${money(total)} − cost ${money(cost)} (job ${money(itemsCost(WZ.items))}${WZ.miles?` + drive ${money(mc)}`:''}) = profit <b>${money(profit)}</b> (${pct(margin)}). This margin <b>excludes your labor</b> — that's paid from the 60% Labor Pool, so it isn't a cost here.<br><br>
        <b>Your take-home from this job</b> — OA split: 25% tax · 15% business · 60% labor → 80% Field Work, split by who works:
        <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
          <tr><td>Solo (1 person)</td><td style="text-align:right;font-weight:800">${money(fieldPool)}</td></tr>
          <tr style="border-top:1px solid var(--line)"><td>2 people — each</td><td style="text-align:right;font-weight:800">${money(fieldPool/2)}</td></tr>
          <tr style="border-top:1px solid var(--line)"><td>3 people — each</td><td style="text-align:right;font-weight:800">${money(fieldPool/3)}</td></tr>
        </table>
        <div class="sub" style="margin-top:6px">Field-Work share only (80% of the 60% pool); Sales credit (15%) + Admin (5%) are separate. Hard out-of-pocket (dump/rental) comes from the 15% Business Fund. Industry margins for this kind of work run ~40–65% — but the take-home above is your real number.</div>
      </div>
    </details>
    <div class="totbar"><span class="lab">Total to present</span><span class="amt">${money(total)}</span></div>
    ${notes.length?`<div class="muted" style="font-size:13px;margin-top:6px"><b>To confirm on site:</b><br>`+notes.map(n=>"• "+esc(n)).join("<br>")+`</div>`:""}
    <button class="btn acc" style="margin-top:12px" onclick="wizFinish()" ${WZ.items.length?"":"disabled"}>Save &amp; present →</button>
  </div>`;}
window.wizFinish=function(){
  const d=D();let sub=0;WZ.items.forEach(it=>sub+=it.price);
  const rec=WZ.recurring&&BIZ[S.biz].recurring;const recDisc=rec?sub*0.2:0;const disc=recDisc+(WZ.disc||0);const total=Math.max(0,sub-disc);
  let cust=WZ.cust.id?d.customers.find(c=>c.id===WZ.cust.id):null;
  if(!cust)cust=d.customers.find(c=>!c.deleted&&(c.name||"").toLowerCase()===WZ.cust.name.toLowerCase());
  if(!cust){cust={id:uid(),name:WZ.cust.name,company:"",phone:WZ.cust.phone,email:"",town:"",type:"Residential",status:"Quoted",source:WZ.cust.source,soldBy:WZ.cust.soldBy,manager:WZ.cust.soldBy,notes:[],next:""};
    if(WZ.cust.notes)cust.notes.push({t:new Date().toLocaleString(),text:WZ.cust.notes});
    touch(cust);d.customers.push(cust);}
  else{cust.phone=cust.phone||WZ.cust.phone;if(WZ.cust.source&&!cust.source)cust.source=WZ.cust.source;if(WZ.cust.soldBy&&!cust.soldBy)cust.soldBy=WZ.cust.soldBy;
    if(cust.status==="Lead")cust.status="Quoted";if(WZ.cust.notes)cust.notes.push({t:new Date().toLocaleString(),text:WZ.cust.notes});touch(cust);}
  // resolve the property (existing, or create one for this address linked to the customer)
  let prop=WZ.cust.propertyId?d.properties.find(x=>x.id===WZ.cust.propertyId):null;
  if(!prop&&WZ.cust.address){prop=actProps().find(x=>(x.address||"").toLowerCase()===WZ.cust.address.toLowerCase()&&(x.customerIds||[]).indexOf(cust.id)>=0);}
  if(!prop){prop={id:uid(),label:"Main",address:WZ.cust.address||"",accessNotes:"",lat:null,lng:null,customerIds:[cust.id],updatedAt:now()};d.properties.push(prop);geocodeProp(prop);}
  else if((prop.customerIds||[]).indexOf(cust.id)<0){prop.customerIds.push(cust.id);touch(prop);}
  const q={id:uid(),customerId:cust.id,cust:cust.name,propertyId:prop.id,address:prop.address||WZ.cust.address||"",date:today(),items:WZ.items.map(it=>({serviceId:"",name:it.name,unit:"quote",price:it.price,qty:1,cost:it.cost||0})),recurring:rec,subtotal:sub,discount:disc,total:total,miles:(WZ.miles||0),cost:itemsCost(WZ.items)+mileageCost(WZ.miles),paymentLink:""};
  touch(q);d.quotes.push(q);logEvent("Quote created — "+money(total)+(cust&&cust.name?" · "+cust.name:""),"quote");save();
  CURQ=q;QITEMS=q.items;WZ.savedTotal=total;WZ.step="done";render();
};
function wizDone(){
  return `<div class="card" style="text-align:center;padding:30px 18px">
    <div style="font-size:40px">✅</div>
    <div class="nm" style="font-size:22px;margin:6px 0">Quote ready</div>
    <div style="font-size:34px;font-weight:800;color:var(--brand)">${money(WZ.savedTotal)}</div>
    <div class="muted">for ${esc(WZ.cust.name)}</div>
    <div class="row" style="gap:8px;margin-top:18px"><button class="btn acc grow" onclick="printQuote()">🖨 Print / share</button><button class="btn ghost grow" onclick="copyQuote()">Copy text</button></div>
    <button class="btn ghost" style="margin-top:8px" onclick="startWizard()">+ New guided quote</button>
    <button class="btn" style="margin-top:8px" onclick="exitWizard()">Done</button>
    <p class="muted" style="margin-top:10px">Saved to ${esc(WZ.cust.name)}'s record — follow up from the Customers tab.</p>
  </div>`;}

