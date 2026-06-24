/* ---------- CUSTOMERS ---------- */
let CSEARCH="",PSEARCH="",ACCTSUB="customers";
function acctSubnav(){return `<div class="subnav"><button class="subbtn ${ACCTSUB==="customers"?"on":""}" onclick="switchAcct('customers')">Customers (${actC().length})</button><button class="subbtn ${ACCTSUB==="properties"?"on":""}" onclick="switchAcct('properties')">Properties (${actProps().length})</button><button class="subbtn ${ACCTSUB==="calllead"?"on":""}" onclick="switchAcct('calllead')">📞 Call Lead</button></div>`;}
window.switchAcct=function(s){ACCTSUB=s;render();};
function rAccounts(){if(ACCTSUB==="properties")return rProperties();if(ACCTSUB==="calllead"&&typeof rCallLead==="function")return rCallLead();return rCustomers();}
function rCustomers(){
  let list=actC().slice().sort((a,b)=>(a.name||a.company||"").localeCompare(b.name||b.company||""));
  if(CSEARCH){const q=CSEARCH.toLowerCase();
    list=list.filter(c=>((c.name||"")+(c.company||"")+(c.phone||"")).toLowerCase().includes(q));}
  let h=acctSubnav()+`<input class="search" id="csearch" placeholder="Search customers…" value="${esc(CSEARCH)}">`;
  if(!actC().length)h+=`<div class="empty"><div class="big">👥</div>No customers yet.<br>Tap + to add your first one.</div>`;
  else if(!list.length)h+=`<div class="empty">No matches.</div>`;
  else h+=`<div class="card grid2">`+list.map(liCustomer).join("")+`</div>`;
  view.innerHTML=h;
  const s=document.getElementById("csearch");
  if(s)s.oninput=e=>{CSEARCH=e.target.value;const p=s.selectionStart;rCustomers();const n=document.getElementById("csearch");n.focus();n.setSelectionRange(p,p);};
}
function rProperties(){
  let list=actProps().slice().sort((a,b)=>(a.label||a.address||"").localeCompare(b.label||b.address||""));
  if(PSEARCH){const q=PSEARCH.toLowerCase();list=list.filter(p=>((p.label||"")+(p.address||"")).toLowerCase().includes(q));}
  let h=acctSubnav()+`<input class="search" id="psearch" placeholder="Search properties…" value="${esc(PSEARCH)}">`;
  if(!actProps().length)h+=`<div class="empty"><div class="big">📍</div>No properties yet.<br>Add one, or they're created when you quote.</div>`;
  else if(!list.length)h+=`<div class="empty">No matches.</div>`;
  else h+=`<div class="card grid2">`+list.map(liProp).join("")+`</div>`;
  view.innerHTML=h;
  const s=document.getElementById("psearch");
  if(s)s.oninput=e=>{PSEARCH=e.target.value;const p=s.selectionStart;rProperties();const n=document.getElementById("psearch");n.focus();n.setSelectionRange(p,p);};
}
function liProp(p){const cs=custsForProp(p);const addr=p.address||"";const who=cs.length?" · "+esc(cs.map(c=>c.name||c.company).join(", ")):"";const _drive=(p.lat!=null&&typeof driveBadge==="function")?driveBadge(p.lat,p.lng):"";const addrHtml=addr?`<a href="https://maps.google.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--brand-text);text-decoration:underline">${esc(addr)}</a>`:"no address";return `<div class="li" onclick="openProperty('${p.id}')"><div class="grow"><div class="nm">${esc(p.label||p.address||"Property")}</div><div class="sub" style="white-space:normal">${addrHtml}${who}${_drive?" · "+_drive:""}</div></div></div>`;}
function liCustomer(c){
  const tel=(c.phone||"").replace(/[^0-9+]/g,"");
  const parts=[]; const meta=[c.company&&c.name?c.company:"",c.town].filter(Boolean).join(" · "); if(meta)parts.push(esc(meta));
  if(c.phone)parts.push(`<a href="tel:${tel}" onclick="event.stopPropagation()" style="color:var(--brand-text);text-decoration:underline">📞 ${esc(c.phone)}</a>`);
  return `<div class="li" onclick="openCustomer('${c.id}')">
    <div class="grow"><div class="nm">${esc(c.name||c.company||"Unnamed")}</div>
    <div class="sub" style="white-space:normal">${parts.join(" · ")||"&nbsp;"}</div></div>
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
  const d=D();let c=isNew?{id,notes:[]}:d.customers.find(x=>x.id===id);
  ["name","company","phone","email"].forEach(k=>c[k]=val("f_"+k));
  c.type=val("f_type");c.status=val("f_status");c.next=val("f_next");c.manager=val("f_manager");c.soldBy=val("f_soldby");c.source=val("f_source");
  touch(c);if(isNew)d.customers.push(c);
  if(typeof logChange==="function")logChange(isNew?"create":"update","customer",c.id,(isNew?"Logged ":"Updated ")+(c.name||c.company||"customer")+(c.status?" · "+c.status:""));
  save();if(document.getElementById("f_name"))closeModal();render();
};
