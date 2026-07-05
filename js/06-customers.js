/* ---------- CUSTOMERS ---------- */
let CSEARCH="",PSEARCH="",ACCTSUB="customers";
/* In-view accounts subnav. The accounts screen now lives in the "People & Places" nav group (js/03), whose
   renderSubnav emits ONE merged row (ppSubnav below: 👥 People · Customers · Properties · 📍 Places · 📞 Call
   Lead). So this in-view row would be a DUPLICATE — suppress it whenever we're inside that group (which is the
   only place accounts renders). The old markup is kept for any other context / defensiveness. */
function acctSubnav(){
  if(typeof tabGroup==="function" && tabGroup(TAB).key==="team") return "";   // merged group row (ppSubnav) covers it — no double subnav
  return `<div class="subnav"><button class="subbtn ${ACCTSUB==="customers"?"on":""}" onclick="switchAcct('customers')">Customers (${actC().length})</button><button class="subbtn ${ACCTSUB==="properties"?"on":""}" onclick="switchAcct('properties')">Properties (${actProps().length})</button><button class="subbtn ${ACCTSUB==="places"?"on":""}" onclick="switchAcct('places')">📍 Places${typeof actPlaces==="function"?` (${actPlaces().length})`:""}</button></div>`;
}
/* The MERGED People & Places sub-tab row (rendered into #subnav by renderSubnav for the "team" group). One clean
   row: People → the crew directory (team tab); the other four → the accounts tab with the matching ACCTSUB.
   `tabs` = the role-visible tabs of the group (groupTabs), so a role that can't see "team" or "accounts" loses
   the corresponding buttons — role gating is preserved, not reinvented. Highlights the active sub-view. */
function ppSubnav(tabs){
  const canPeople=tabs.indexOf("team")>=0, canAcct=tabs.indexOf("accounts")>=0;
  const btns=[];
  if(canPeople) btns.push(`<button class="subbtn ${TAB==="team"?"on":""}" onclick="ppGo('team')">👥 People</button>`);
  if(canAcct){
    const sub=(s,label)=>`<button class="subbtn ${(TAB==="accounts"&&ACCTSUB===s)?"on":""}" onclick="ppGo('accounts','${s}')">${label}</button>`;
    btns.push(sub("customers",`Customers (${actC().length})`));
    btns.push(sub("properties",`Properties (${actProps().length})`));
    btns.push(sub("places",`📍 Places${typeof actPlaces==="function"?` (${actPlaces().length})`:""}`));
  }
  return btns.length?`<div class="subnav">`+btns.join("")+`</div>`:"";
}
window.ppSubnav=ppSubnav;
// merged-row click: People → team tab; an account sub-view → set ACCTSUB then route to the accounts tab.
window.ppGo=function(tab,sub){ if(tab==="accounts"&&sub)ACCTSUB=sub; if(typeof navSub==="function")navSub(tab); };
window.switchAcct=function(s){ACCTSUB=s;render();};
function rAccounts(){if(ACCTSUB==="properties")return rProperties();if(ACCTSUB==="places"&&typeof rPlaces==="function")return rPlaces();return rCustomers();}
/* PURE results-list HTML (empty / "No matches" / card grid) — kept pure so the SEARCH keystroke path can
   rebuild ONLY #clist without re-rendering the #csearch input (focus & caret survive, no setSelectionRange). */
/* Customer list sort (survives re-render; NOT persisted). Default "name" = the exact pre-change comparator, so
   the default output stays byte-identical. cSetSort repaints ONLY #clist (like search) — the <select> lives
   OUTSIDE #clist so it's never destroyed. Sort runs on the FULL list, ABOVE the search filter + Load-more slice. */
let CSORT="name";   // name (A–Z, default) | namez (Z–A) | recent (newest updatedAt first)
function custSortHTML(){
  const o=(v,l)=>`<option value="${v}"${CSORT===v?" selected":""}>${l}</option>`;
  return `<select aria-label="Sort customers" onchange="cSetSort(this.value)" style="font-size:13px;margin-bottom:10px">`
    +o("name","Name A–Z")+o("namez","Name Z–A")+o("recent","Recently added")+`</select>`;
}
window.cSetSort=function(v){ CSORT=v; CSHOWN=150; const c=document.getElementById("clist"); if(c)c.innerHTML=customersListHTML(); };
function customersListHTML(){
  const cn=c=>(c.name||c.company||"");
  let list=actC().slice();
  if(CSORT==="namez") list.sort((a,b)=>cn(b).localeCompare(cn(a)));
  else if(CSORT==="recent") list.sort((a,b)=>((b.updatedAt||0)-(a.updatedAt||0))||cn(a).localeCompare(cn(b)));
  else list.sort((a,b)=>cn(a).localeCompare(cn(b)));   // default: identical to the pre-sort behavior
  if(CSEARCH){const q=CSEARCH.toLowerCase();
    list=list.filter(c=>((c.name||"")+(c.company||"")+(c.phone||"")).toLowerCase().includes(q));}
  if(!actC().length)return `<div class="empty"><div class="big">👥</div>No customers yet.<br>Tap + to add your first one.</div>`;
  if(!list.length)return `<div class="empty">No matches.</div>`;
  /* Load-more cap: sort+search ABOVE run on the FULL list; slice ONLY the display array. list.length<=CSHOWN → no
     button, byte-identical to pre-cap. */
  const more=list.length>CSHOWN?`<button class="btn ghost" onclick="cLoadMore()">Load more (${Math.min(150,list.length-CSHOWN)} of ${list.length-CSHOWN} left)</button>`:"";
  return `<div class="card grid2">`+list.slice(0,CSHOWN).map(liCustomer).join("")+`</div>`+more;
}
/* Per-list shown cap (initial 150). cLoadMore bumps by 150 and repaints ONLY #clist. */
let CSHOWN=150;
window.cLoadMore=function(){ CSHOWN+=150; const c=document.getElementById("clist"); if(c)c.innerHTML=customersListHTML(); };
/* scoped SEARCH re-render: rebuild ONLY #clist so #csearch is never destroyed (mirrors adminFilterAccounts, js/32).
   RESET the cap first so a new filtered result set re-caps from the top. */
window.cSearchOn=function(v){ CSHOWN=150; CSEARCH=v; const c=document.getElementById("clist"); if(c)c.innerHTML=customersListHTML(); };
function rCustomers(){
  let h=acctSubnav()+`<input class="search" id="csearch" placeholder="Search customers…" value="${esc(CSEARCH)}" oninput="cSearchOn(this.value)">`;
  h+=custSortHTML();
  h+=`<div id="clist">${customersListHTML()}</div>`;
  view.innerHTML=h;
}
/* PURE results-list HTML — see customersListHTML above. */
function propertiesListHTML(){
  let list=actProps().slice().sort((a,b)=>(a.label||a.address||"").localeCompare(b.label||b.address||""));
  if(PSEARCH){const q=PSEARCH.toLowerCase();list=list.filter(p=>((p.label||"")+(p.address||"")).toLowerCase().includes(q));}
  if(!actProps().length)return `<div class="empty"><div class="big">📍</div>No properties yet.<br>Add one, or they're created when you quote.</div>`;
  if(!list.length)return `<div class="empty">No matches.</div>`;
  /* Load-more cap: sort+search ABOVE run on the FULL list; slice ONLY the display array. list.length<=PSHOWN → no
     button, byte-identical to pre-cap. */
  const more=list.length>PSHOWN?`<button class="btn ghost" onclick="pLoadMore()">Load more (${Math.min(150,list.length-PSHOWN)} of ${list.length-PSHOWN} left)</button>`:"";
  return `<div class="card grid2">`+list.slice(0,PSHOWN).map(liProp).join("")+`</div>`+more;
}
/* Per-list shown cap (initial 150). pLoadMore bumps by 150 and repaints ONLY #plist. */
let PSHOWN=150;
window.pLoadMore=function(){ PSHOWN+=150; const c=document.getElementById("plist"); if(c)c.innerHTML=propertiesListHTML(); };
/* scoped SEARCH re-render — RESET the cap first so a new filtered result set re-caps from the top. */
window.pSearchOn=function(v){ PSHOWN=150; PSEARCH=v; const c=document.getElementById("plist"); if(c)c.innerHTML=propertiesListHTML(); };
function rProperties(){
  let h=acctSubnav()+`<input class="search" id="psearch" placeholder="Search properties…" value="${esc(PSEARCH)}" oninput="pSearchOn(this.value)">`;
  h+=`<div id="plist">${propertiesListHTML()}</div>`;
  view.innerHTML=h;
}
function liProp(p){const cs=custsForProp(p);const addr=p.address||"";const who=cs.length?" · "+esc(cs.map(c=>c.name||c.company).join(", ")):"";const _drive=(p.lat!=null&&typeof driveBadge==="function")?driveBadge(p.lat,p.lng):"";const addrHtml=addr?`<a href="https://maps.google.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--brand-text);text-decoration:underline">${esc(addr)}</a>`:"no address";return `<div class="li" onclick="openProperty('${p.id}')"><div class="grow"><div class="nm">${esc(p.label||p.address||"Property")}</div><div class="sub" style="white-space:normal">${addrHtml}${who}${_drive?" · "+_drive:""}</div></div></div>`;}
/* pretty US phone: (252) 475-4152 */
function fmtPhone(p){ const d=(p||"").replace(/\D/g,""); if(d.length===10)return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`; if(d.length===11&&d[0]==="1")return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`; return p||""; }
function liCustomer(c){
  const tel=(c.phone||"").replace(/[^0-9+]/g,"");
  const np=(typeof propsForCust==="function")?propsForCust(c.id).length:0;
  const lines=[];
  if(c.company && c.name) lines.push(esc(c.company));                                                                                              // business
  if(c.phone) lines.push(`<a href="tel:${tel}" onclick="event.stopPropagation()" style="color:var(--brand-text);text-decoration:underline">📞 ${esc(fmtPhone(c.phone))}</a>`);   // phone
  if(c.email) lines.push(`<a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()" style="color:var(--brand-text);text-decoration:underline">✉️ ${esc(c.email)}</a>`);   // email
  lines.push(`🏠 ${np} ${np===1?"property":"properties"}`);                                                                                         // properties linked
  return `<div class="li" onclick="openCustomer('${c.id}')">
    <div class="grow"><div class="nm">${esc(c.name||c.company||"Unnamed")}</div>
    ${lines.map(l=>`<div class="sub" style="white-space:normal">${l}</div>`).join("")}</div>
    <span class="badge s-${c.status||"Lead"}">${c.status||"Lead"}</span></div>`;
}
const SOURCES=["","Referral","Google","Facebook/Instagram","Nextdoor","Door hanger / sign","Cold call / in-person","Property manager","Other"];
let CPROPS=[];
window.openCustomer=function(id){
  const d=D();const c=id?d.customers.find(x=>x.id===id):{id:uid(),status:"Lead",notes:[]};
  const isNew=!id;const f=k=>`value="${esc(c[k]||"")}"`;
  const uopts=sel=>`<option value="">— none —</option>`+users().map(u=>`<option value="${u.id}" ${sel===u.id?"selected":""}>${esc(u.username)}</option>`).join("");
  let notesH=(c.notes||[]).slice().reverse().map(n=>`<div class="note"><div class="t">${esc(n.t)}</div>${esc(n.text)}</div>`).join("")||`<div class="muted">No notes yet.</div>`;
  let propsH="",histH="";
  if(!isNew){
    propsH=`<h2 style="margin-top:14px">Properties</h2>`+(propsForCust(c.id).map(p=>`<div class="li" onclick="closeModal();openProperty('${p.id}')"><div class="grow"><div class="nm" style="font-size:15px">${esc(p.label||p.address||"Property")}</div><div class="sub">${esc(p.address||"")}</div></div></div>`).join("")||`<div class="muted">No properties yet.</div>`)
      +`<button class="btn ghost sm" style="margin-top:6px" onclick="saveCustomer('${c.id}',false);openProperty(null,'${c.id}')">+ Add property</button>`;
    const myQ=actQ().filter(q=>q.customerId===c.id);const myJ=actJ().filter(j=>j.customerId===c.id);
    histH=`<h2 style="margin-top:16px">Quotes (${myQ.length})</h2>`+(myQ.length?myQ.map(q=>`<div class="li"><div class="grow" onclick="closeModal();openQuote('${q.id}')"><div class="nm">${money(q.total)}${q.paid?" · paid":q.invoiced?" · invoiced":""}</div><div class="sub">${fmtDate(q.date)} · ${q.items.length} item(s)</div></div><button class="btn ghost sm" title="Invoice" onclick="event.stopPropagation();openInvoice('${q.id}')">🧾</button></div>`).join(""):`<div class="muted">None yet.</div>`)
      +`<h2 style="margin-top:16px">Jobs (${myJ.length})</h2>`+(myJ.length?myJ.map(j=>`<div class="li"><div class="grow" onclick="closeModal();openJob('${j.id}')"><div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(j.title)}</div><div class="sub">${fmtDate(j.date)}</div></div></div>`).join(""):`<div class="muted">None yet.</div>`);
  }
  modal(isNew?"New customer":"Customer",`
    <label>Name</label><input id="f_name" ${f("name")} placeholder="Contact name">
    <label>Company</label><input id="f_company" ${f("company")} placeholder="Company / property">
    <div class="row" style="gap:8px"><div class="grow"><label>Phone</label><input id="f_phone" ${f("phone")} inputmode="tel"></div>
    <div class="grow"><label>Email</label><input id="f_email" ${f("email")} inputmode="email"></div></div>
    <div class="row" style="gap:8px"><div class="grow"><label>Managed by</label><select id="f_manager">${uopts(c.manager)}</select></div>
    <div class="grow"><label>Sold by (credit)</label><select id="f_soldby">${uopts(c.soldBy)}</select></div></div>
    <label>How they found us</label><select id="f_source">${SOURCES.map(o=>`<option value="${o}" ${c.source===o?"selected":""}>${o||"— select —"}</option>`).join("")}</select>
    <div class="row" style="gap:8px;margin-top:12px"><div class="grow"><label>Type</label><select id="f_type">${TYPES.map(t=>`<option ${c.type===t?"selected":""}>${t}</option>`).join("")}</select></div>
    <div class="grow"><label>Status</label><select id="f_status">${STATUSES.map(s=>`<option ${(c.status||"Lead")===s?"selected":""}>${s}</option>`).join("")}</select></div></div>
    <label>Next follow-up date</label><input id="f_next" type="date" value="${c.next||""}">
    <button class="btn acc" style="margin-top:14px" onclick="saveCustomer('${c.id}',${isNew})">Save</button>
    ${isNew?`<p class="muted" style="margin-top:8px">Save the customer, then reopen to add properties.</p>`:`${propsH}
      ${(()=>{const tel=(c.phone||"").replace(/[^0-9+]/g,"");const ap=propsForCust(c.id)[0];const addr=c.address||(ap&&ap.address)||"";return (tel||addr)?`<div class="row" style="gap:8px;margin-top:10px">${tel?`<a class="btn ghost sm grow" href="tel:${tel}" style="text-align:center">📞 Call</a><a class="btn ghost sm grow" href="sms:${tel}" style="text-align:center">💬 Text</a>`:""}${addr?`<a class="btn ghost sm grow" href="https://maps.google.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener" style="text-align:center">🗺️ Directions</a>`:""}</div>`:"";})()}
      <div class="row" style="gap:8px;margin-top:12px">
       <button class="btn ghost sm grow" onclick="openQuote(null,'${c.id}')">New quote</button>
       <button class="btn ghost sm grow" onclick="openJob(null,'${c.id}')">Schedule job</button>
       <button class="btn ghost sm grow" onclick="openMessageComposer('${c.id}')">Message</button></div>
      <label>Add note</label><textarea id="f_note" placeholder="Call outcome, details…"></textarea>
      <button class="btn sm" style="margin-top:6px" onclick="addNote('${c.id}')">Add note</button>
      <h2 style="margin-top:16px">Notes</h2>${notesH}${histH}
      <button class="btn danger" style="margin-top:16px" onclick="delCustomer('${c.id}')">Delete customer</button>`}
  `);
  if(typeof lockGuard==="function")lockGuard("customer",isNew?null:c.id,()=>openCustomer(id));
};
window.saveCustomer=function(id,isNew){
  if(typeof submitGuard==="function"&&!submitGuard("saveCustomer:"+id))return;   // rapid-tap dupe guard
  const d=D();let c=isNew?{id,notes:[]}:d.customers.find(x=>x.id===id);
  ["name","company","phone","email"].forEach(k=>c[k]=val("f_"+k));
  c.type=val("f_type");c.status=val("f_status");c.next=val("f_next");c.manager=val("f_manager");c.soldBy=val("f_soldby");c.source=val("f_source");
  touch(c);if(isNew)d.customers.push(c);
  if(typeof logChange==="function")logChange(isNew?"create":"update","customer",c.id,(isNew?"Logged ":"Updated ")+(c.name||c.company||"customer")+(c.status?" · "+c.status:""));
  save();if(document.getElementById("f_name"))closeModal();render();
};
