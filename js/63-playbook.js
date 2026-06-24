/* ---------- CAP'S PLAYBOOK ----------
   A synced knowledge base of local facts Cap references as ground truth when he answers (transfer
   stations, dump rules, vendors, how-we-price, area know-how). Owner/admin curate; Cap reads it via the
   ops projection. Backed by the per-biz `knowledge` collection (js/02 blank/load + server COLLECTIONS). */
let PB_SEARCH = "";
function rPlaybook(){
  let list = (typeof actKnow === "function") ? actKnow() : [];
  if(PB_SEARCH){ const q=PB_SEARCH.toLowerCase(); list=list.filter(k=>(((k.topic||"")+" "+(k.fact||"")+" "+(k.tags||"")).toLowerCase().indexOf(q)>=0)); }
  list.sort((a,b)=>((a.topic||"")+"").localeCompare((b.topic||"")+""));
  let h=`<div class="secthd"><h2>📒 Cap's Playbook</h2><button class="btn acc sm" style="margin-left:auto" onclick="pbAdd()">+ Fact</button></div>`;
  h+=`<div class="card" style="background:var(--soft)"><div class="sub">Facts Cap treats as ground truth when he answers — transfer stations, dump rules, vendors, how we price. Add what you know so he stops guessing (and escalates when it's not in here).</div></div>`;
  h+=`<input class="search" id="pb_search" placeholder="Search the playbook…" value="${esc(PB_SEARCH)}" oninput="pbSearch(this.value)">`;
  h+= list.length
    ? `<div class="card">`+list.map(k=>`<div class="li" onclick="pbEdit('${k.id}')"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${esc(k.topic||"(untitled)")}</div><div class="sub" style="white-space:normal">${esc(k.fact||"")}</div>${k.tags?`<div class="sub" style="color:var(--brand-text);white-space:normal">${esc(k.tags)}</div>`:""}</div></div>`).join("")+`</div>`
    : `<div class="empty">No facts yet. Tap <b>+ Fact</b> to teach Cap something.</div>`;
  view.innerHTML=h;
}
window.pbSearch=function(v){ PB_SEARCH=v; rPlaybook(); const el=document.getElementById("pb_search"); if(el){ el.focus(); try{ el.setSelectionRange(el.value.length, el.value.length); }catch(e){} } };
window.pbAdd=function(){ pbForm(null); };
window.pbEdit=function(id){ pbForm((D().knowledge||[]).find(k=>k&&k.id===id)); };
function pbForm(k){
  modal(k?"Edit fact":"Add a fact",`
    <label>Topic</label><input id="pb_topic" value="${k?esc(k.topic||""):""}" placeholder="e.g. Currituck transfer station" autocomplete="off">
    <label>Fact</label><textarea id="pb_fact" style="min-height:80px" placeholder="e.g. Free for brush & yard debris. No bagged household trash accepted.">${k?esc(k.fact||""):""}</textarea>
    <label>Tags (optional, comma-separated)</label><input id="pb_tags" value="${k?esc(k.tags||""):""}" placeholder="disposal, brush, currituck" autocomplete="off">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="pbSave('${k?k.id:""}')">Save</button>
    ${k?`<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="pbDel('${k.id}')">Delete</button>`:""}`);
}
window.pbSave=function(id){
  const topic=val("pb_topic"), fact=val("pb_fact"), tags=val("pb_tags");
  if(!fact){ alert("Type the fact."); return; }
  const d=D(); if(!Array.isArray(d.knowledge))d.knowledge=[];
  let k=id?d.knowledge.find(x=>x&&x.id===id):null;
  if(!k){ k={id:uid()}; d.knowledge.push(k); }
  k.topic=topic; k.fact=fact; k.tags=tags; k.deleted=false; k.updatedAt=now();
  if(typeof touch==="function")touch(k); save(); if(typeof closeModal==="function")closeModal(); if(typeof render==="function")render();
};
window.pbDel=function(id){
  const d=D(); const k=(d.knowledge||[]).find(x=>x&&x.id===id); if(!k)return;
  if(!confirm("Delete this fact?"))return;
  k.deleted=true; k.updatedAt=now(); if(typeof touch==="function")touch(k); save(); if(typeof closeModal==="function")closeModal(); if(typeof render==="function")render();
};
