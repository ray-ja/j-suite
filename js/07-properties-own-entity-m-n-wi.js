/* ---- properties (own entity, M:N with customers) ---- */
let PCUSTS=[];
function geocodeProp(p){if(!p.address)return;fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+encodeURIComponent(p.address)).then(r=>r.json()).then(d=>{if(d&&d[0]){p.lat=+d[0].lat;p.lng=+d[0].lon;p.updatedAt=now();save();}}).catch(function(){});}
window.openProperty=function(id,linkCustId){
  const d=D();const p=id?d.properties.find(x=>x.id===id):{id:uid(),label:"",address:"",accessNotes:"",customerIds:linkCustId?[linkCustId]:[],lat:null,lng:null};
  const isNew=!id;PCUSTS=(p.customerIds||[]).slice();
  let histH="";
  if(!isNew){const myQ=actQ().filter(q=>q.propertyId===p.id);const myJ=actJ().filter(j=>j.propertyId===p.id);
    histH=`<h2 style="margin-top:14px">Quotes (${myQ.length})</h2>`+(myQ.length?myQ.map(q=>`<div class="li"><div class="grow" onclick="closeModal();${q.jobId?`openJobPage('${q.jobId}')`:`openQuote('${q.id}')`}"><div class="nm">${money(q.total)}</div><div class="sub">${fmtDate(q.date)}</div></div></div>`).join(""):`<div class="muted">None yet.</div>`)
      +`<h2 style="margin-top:14px">Jobs (${myJ.length})</h2>`+(myJ.length?myJ.map(j=>`<div class="li"><div class="grow" onclick="closeModal();openJob('${j.id}')"><div class="nm">${esc(j.title)}</div><div class="sub">${fmtDate(j.date)}</div></div></div>`).join(""):`<div class="muted">None yet.</div>`);}
  modal(isNew?"New property":"Property",`
    <label>Label</label><input id="p_label" value="${esc(p.label||"")}" placeholder="e.g. Main office, Beach house">
    <label>Address</label><div class="acwrap"><input id="p_addr" value="${esc(p.address||"")}" placeholder="Start typing the address…" oninput="addrSuggest('p_addr','p_box')"><div class="acbox" id="p_box"></div></div>
    <label>Access notes (gate code, pets, parking…)</label><textarea id="p_access">${esc(p.accessNotes||"")}</textarea>
    <h2 style="margin-top:14px">Linked customers</h2>
    <div id="p_custs"></div>
    <button class="btn acc" style="margin-top:14px" onclick="saveProperty('${p.id}',${isNew})">Save</button>
    ${!isNew?histH+`<button class="btn danger" style="margin-top:16px" onclick="delProperty('${p.id}')">Delete property</button>`:""}
  `);
  renderPropCusts();
  if(typeof lockGuard==="function")lockGuard("property",isNew?null:p.id,()=>openProperty(id));
};
function renderPropCusts(){const el=document.getElementById("p_custs");if(!el)return;
  const linked=PCUSTS.map(cid=>D().customers.find(c=>c.id===cid&&!c.deleted)).filter(Boolean);
  const avail=actC().filter(c=>PCUSTS.indexOf(c.id)<0);
  el.innerHTML=(linked.length?linked.map(c=>`<div class="li"><div class="grow">${esc(c.name||c.company)}</div><button class="btn danger sm" onclick="unlinkCust('${c.id}')">Unlink</button></div>`).join(""):`<div class="muted">None linked yet.</div>`)
    +`<label>Link a customer</label><select id="p_addcust" onchange="linkCust(this.value)"><option value="">— pick —</option>${avail.map(c=>`<option value="${c.id}">${esc(c.name||c.company)}</option>`).join("")}</select>`;}
window.linkCust=function(cid){if(cid&&PCUSTS.indexOf(cid)<0)PCUSTS.push(cid);renderPropCusts();};
window.unlinkCust=function(cid){PCUSTS=PCUSTS.filter(x=>x!==cid);renderPropCusts();};
window.saveProperty=function(id,isNew){
  const d=D();let p=isNew?{id:id,lat:null,lng:null,customerIds:[]}:d.properties.find(x=>x.id===id);
  p.label=val("p_label");p.address=val("p_addr");p.accessNotes=val("p_access");p.customerIds=PCUSTS.slice();
  if(!p.label&&!p.address){alert("Add a label or address.");return;}
  if(typeof submitGuard==="function"&&!submitGuard("saveProperty:"+id))return;   // rapid-tap dupe guard
  touch(p);if(isNew)d.properties.push(p);
  if(typeof logChange==="function")logChange(isNew?"create":"update","property",p.id,(isNew?"Added property ":"Updated property ")+(p.label||p.address||""));
  geocodeProp(p);save();closeModal();render();
};
window.delProperty=function(id){if(!confirm("Delete this property?"))return;
  const p=D().properties.find(x=>x.id===id);p.deleted=true;touch(p);if(typeof logChange==="function")logChange("delete","property",id,"Deleted property "+(p.label||p.address||""));save();closeModal();render();};
window.addNote=function(id){const txt=val("f_note");if(!txt)return;
  const c=D().customers.find(x=>x.id===id);c.notes=c.notes||[];
  c.notes.push({t:new Date().toLocaleString(),text:txt});touch(c);save();openCustomer(id);};
window.delCustomer=function(id){if(!confirm("Delete this customer?"))return;
  const c=D().customers.find(x=>x.id===id);c.deleted=true;touch(c);if(typeof logChange==="function")logChange("delete","customer",id,"Deleted "+(c.name||c.company||"customer"));save();closeModal();render();};

