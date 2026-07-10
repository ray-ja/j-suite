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
  // TAX STARTER — one-tap load of grounded NC / Dare-County tax guidance (what's deductible + sales-taxable), so
  // Cap can answer "is Cloudflare taxable?" from ground truth. Insert-if-absent (your edits stick); shows how many
  // of the starter facts are still missing. Owner/admin curate like any fact.
  const _taxMissing = (typeof taxSeedMissing === "function") ? taxSeedMissing() : 0;
  if(_taxMissing>0) h+=`<div class="card" style="border-left:4px solid var(--brand)"><div class="nm" style="font-size:14px">🧾 Tax guidance (NC · Dare County)</div><div class="sub" style="white-space:normal;margin:2px 0 8px">Load ${_taxMissing} starter fact${_taxMissing===1?"":"s"} on what's deductible + what NC sales tax applies to your work — grounded, but verify money-significant calls with NCDOR / your accountant.</div><button class="btn acc sm" onclick="pbSeedTax()">🧾 Load NC tax starter guidance</button></div>`;
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
/* ---------- TAX STARTER GUIDANCE ----------
   Grounded starter facts for a small OBX services business (NC, Dare/Currituck County), so Cap answers taxability
   questions from ground truth instead of guessing. NOT tax advice — every entry says to verify money-significant
   calls with NCDOR / an accountant. Loaded on demand (stable tax_* ids), INSERT-IF-ABSENT so re-loading only fills
   gaps and never clobbers an edit Ray made. Sources: NCDOR real-property services taxability chart; NC treats
   SaaS/cloud as non-taxable (2026); Dare County combined rate 6.75% (4.75% state + 2.0% county). */
const TAX_SEED = [
  { id:"tax_disclaimer", topic:"Tax · How to use this (read first)", tags:"tax, disclaimer", fact:"These are starter notes so Cap stops guessing — NOT tax advice. NC sales-tax rules on services have real exceptions. Verify anything money-significant with NCDOR (ncdor.gov) or your accountant, and edit these facts as you confirm them." },
  { id:"tax_deductible_overhead", topic:"Tax · What's income-tax DEDUCTIBLE", tags:"tax, deduction, income tax, cloudflare, hosting, insurance", fact:"Ordinary + necessary business costs are deductible on your federal + NC INCOME tax: Cloudflare, website hosting, domains, software subscriptions, business insurance, phone/internet, fuel, mileage (already tracked at the IRS rate), disposal/dump fees, equipment, tools, materials. Keep the receipt. (Deductible ≠ sales-taxable — different tax.)" },
  { id:"tax_nc_saas", topic:"Tax · SaaS / hosting / insurance are NOT NC sales-taxed", tags:"tax, sales tax, saas, cloudflare, hosting, insurance", fact:"NC treats SaaS / cloud / web hosting as services and does NOT charge sales tax on them — so Cloudflare, your website hosting, and software subscriptions have no NC sales tax and you owe no use tax on them (exception: if bundled with taxable digital goods or hardware). Insurance premiums are not sales-taxed either. So: yes deduct them; no sales tax." },
  { id:"tax_dare_rate", topic:"Tax · Sales-tax rate you CHARGE (Dare County)", tags:"tax, sales tax, rate, dare, currituck", fact:"When a sale IS taxable, the combined rate in Dare County is 6.75% (4.75% NC state + 2.0% county). Currituck County is also 6.75%. Charge that on taxable services/goods you sell." },
  { id:"tax_services_rmi", topic:"Tax · Which of OUR services are sales-taxable", tags:"tax, sales tax, services, paver, landscaping, junk, capital improvement", fact:"NC taxes 'repair, maintenance & installation' (RMI) services to real property — so recurring LAWN/LANDSCAPE MAINTENANCE, cleanups, and (likely) JUNK HAULING are generally TAXABLE at 6.75%. BUT a CAPITAL IMPROVEMENT — a NEW paver patio/walkway, new construction, a permitted build — is NOT taxed to the customer; instead YOU pay sales tax on the materials and keep Form E-589CI for the job. Maintenance = taxable; new-install/capital-improvement = tax the materials, not the customer. Confirm each service type with NCDOR before deciding to collect." },
  { id:"tax_use_tax", topic:"Tax · Use tax on out-of-state / untaxed purchases", tags:"tax, use tax, materials, equipment", fact:"If you buy materials or equipment and NO NC sales tax was charged (out-of-state seller, some online), you owe NC USE tax at 6.75% — report it on your sales/use return. If the vendor already charged NC sales tax, you don't owe use tax again." }
];
function taxSeedMissing(){ try{ const have={}; (D().knowledge||[]).forEach(k=>{ if(k&&!k.deleted)have[k.id]=1; }); return TAX_SEED.filter(t=>!have[t.id]).length; }catch(e){ return 0; } }
window.pbSeedTax=function(){
  const d=D(); if(!Array.isArray(d.knowledge))d.knowledge=[];
  let added=0;
  TAX_SEED.forEach(t=>{ if(!d.knowledge.find(k=>k&&k.id===t.id)){ const k={ id:t.id, topic:t.topic, fact:t.fact, tags:t.tags, deleted:false, updatedAt:(typeof now==="function"?now():Date.now()) }; d.knowledge.push(k); if(typeof touch==="function")touch(k); added++; } });
  if(typeof logChange==="function")logChange("create","knowledge","tax","Loaded "+added+" NC tax starter facts");
  if(typeof save==="function")save();
  if(S.sync&&S.sync.url&&S.sync.token&&S.sync.auto&&typeof syncNow==="function")syncNow();
  if(typeof toast==="function")toast(added?("Added "+added+" tax facts to the Playbook"):"Tax facts already loaded"); else alert(added?("Added "+added+" tax facts."):"Already loaded.");
  if(typeof render==="function")render();
};
