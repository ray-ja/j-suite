/* ---------- CAP'S PLAYBOOK ----------
   A synced knowledge base of local facts Cap references as ground truth when he answers (transfer
   stations, dump rules, vendors, how-we-price, area know-how). Owner/admin curate; Cap reads it via the
   ops projection. Backed by the per-biz `knowledge` collection (js/02 blank/load + server COLLECTIONS). */
let PB_SEARCH = "";
function rPlaybook(){
  let list = (typeof actKnow === "function") ? actKnow() : [];
  if(PB_SEARCH){ const q=PB_SEARCH.toLowerCase(); list=list.filter(k=>(((k.topic||"")+" "+(k.fact||"")+" "+(k.tags||"")).toLowerCase().indexOf(q)>=0)); }
  list.sort((a,b)=>((a.topic||"")+"").localeCompare((b.topic||"")+""));
  let h=`<div class="secthd"><h2>📒 Cap's Playbook</h2>${(typeof pbLibView==="function")?`<button class="btn ghost sm" style="margin-left:auto" onclick="pbLibView()">🌿 Guide library</button><button class="btn acc sm" onclick="pbAdd()">+ Fact</button>`:`<button class="btn acc sm" style="margin-left:auto" onclick="pbAdd()">+ Fact</button>`}</div>`;
  h+=`<div class="card" style="background:var(--soft)"><div class="sub">Facts Cap treats as ground truth when he answers — transfer stations, dump rules, vendors, how we price. Add what you know so he stops guessing (and escalates when it's not in here).</div></div>`;
  // TAX STARTER — one-tap load of grounded NC / Dare-County tax guidance (what's deductible + sales-taxable), so
  // Cap can answer "is Cloudflare taxable?" from ground truth. Insert-if-absent (your edits stick); shows how many
  // of the starter facts are still missing. Owner/admin curate like any fact.
  const _taxMissing = (typeof taxSeedMissing === "function") ? taxSeedMissing() : 0;
  if(_taxMissing>0) h+=`<div class="card" style="border-left:4px solid var(--brand)"><div class="nm" style="font-size:14px">🧾 Tax guidance (NC · Dare County)</div><div class="sub" style="white-space:normal;margin:2px 0 8px">Load ${_taxMissing} starter fact${_taxMissing===1?"":"s"} on what's deductible + what NC sales tax applies to your work — grounded, but verify money-significant calls with NCDOR / your accountant.</div><button class="btn acc sm" onclick="pbSeedTax()">🧾 Load NC tax starter guidance</button></div>`;
  // PLANT STARTER — one-tap load of the coastal-NC / OBX plant playbook (species IDs + how/when to prune-or-remove
  // each) so Cap's landscaping site-survey (js/113) and any plant-care answer come from ground truth. Insert-if-absent
  // (your edits stick). The SAME facts are mirrored server-side (LAND_PLAYBOOK) into the survey vision prompt.
  const _plantMissing = (typeof plantSeedMissing === "function") ? plantSeedMissing() : 0;
  if(_plantMissing>0) h+=`<div class="card" style="border-left:4px solid #1a7f37"><div class="nm" style="font-size:14px">🌿 Plant playbook (coastal NC · OBX)</div><div class="sub" style="white-space:normal;margin:2px 0 8px">Load ${_plantMissing} starter fact${_plantMissing===1?"":"s"} on the common OBX species — crape myrtle, live oak, wax myrtle, oleander, pampas, palms… — and how/when to prune or remove each in zone 8a. Feeds Cap's landscaping site-survey.</div><button class="btn acc sm" onclick="pbSeedPlants()">🌿 Load OBX plant playbook</button></div>`;
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
/* ---------- PLANT PLAYBOOK — coastal NC / OBX starter guidance ----------
   Species IDs + how/when to prune-or-remove each in zone 8a (salt/wind/sand). Grounds Cap's landscaping site-survey
   (js/113) AND is mirrored server-side (sync-server.js LAND_PLAYBOOK) into the survey vision prompt so IDs/timing are
   regionally correct. Loaded on demand (stable plant_* ids), INSERT-IF-ABSENT so re-loading only fills gaps and never
   clobbers an edit Ray made — same pattern as pbSeedTax. Owner/admin curate like any fact. NOT arborist advice: verify
   removals against Dare/local tree ordinances + HOA, and flag protected dune grasses. */
const PLANT_SEED = [
  { id:"plant_zone", topic:"Plant · OBX growing zone (read first)", tags:"plant, landscape, zone, coastal, salt", fact:"OBX is USDA zone 8a, maritime — sandy fast-draining soil, salt spray, high wind, hot humid summers, mild winters. Favor salt-/wind-tolerant species; expect salt burn on tender growth. This is starter horticulture guidance, not arborist advice — verify removals against Dare/local tree ordinances + the HOA." },
  { id:"plant_crape_myrtle", topic:"Plant · Crape myrtle (Lagerstroemia)", tags:"plant, prune, crape myrtle, late winter", fact:"Blooms on NEW wood. Prune LATE WINTER (Feb) before spring flush. DO NOT 'crape murder' (top to stubs) — thin to structure, remove crossing/inner twigs. Never hard-prune in fall. Very heat/salt tolerant." },
  { id:"plant_live_oak", topic:"Plant · Live oak (Quercus virginiana)", tags:"plant, prune, oak, tree, ordinance", fact:"Slow, sprawling, wind-firm — the signature OBX shade tree. Prune only for deadwood/structure in late winter–early spring; avoid heavy cuts. Never remove without checking local tree ordinances. Oak-wilt risk: don't prune Apr–Jun (fresh-wound window)." },
  { id:"plant_wax_myrtle", topic:"Plant · Wax myrtle / bayberry (Morella cerifera)", tags:"plant, hedge, screen, native, salt", fact:"Fast salt/wind-tolerant native screen. Trim any time; tolerates hard renovation. Great hedge; can get leggy — thin to shape." },
  { id:"plant_yaupon_holly", topic:"Plant · Yaupon holly (Ilex vomitoria)", tags:"plant, hedge, holly, native, shear", fact:"Salt-tolerant native, common hedge/topiary. Shear spring–summer; berries on female plants. Prune late winter for size." },
  { id:"plant_oleander", topic:"Plant · Oleander (Nerium oleander) — TOXIC", tags:"plant, oleander, toxic, caution, prune", fact:"Salt/heat tough, blooms on new + old wood; prune after bloom or late winter. CAUTION: ALL PARTS TOXIC — wear gloves/eye pro, bag clippings, never burn or chip near people. Flag it on the estimate." },
  { id:"plant_pampas_grass", topic:"Plant · Pampas grass (Cortaderia)", tags:"plant, grass, cut back, late winter, caution", fact:"Cut back HARD to ~12in in LATE WINTER (Feb–Mar) before new growth. Wear long sleeves/gloves — blades cut skin. Dispose as green waste. Big clumps = real labor; can require a saw." },
  { id:"plant_juniper", topic:"Plant · Juniper / red cedar (Juniperus)", tags:"plant, juniper, groundcover, shape", fact:"Salt/drought tolerant groundcover & trees. Do NOT cut into old bare wood — junipers don't regrow from bare wood. Light shaping only." },
  { id:"plant_muhly_grass", topic:"Plant · Pink muhly / ornamental grasses", tags:"plant, grass, muhly, cut back, late winter", fact:"Cut back to a few inches in late winter before new growth; do NOT cut in fall (crown protection). Easy." },
  { id:"plant_loropetalum", topic:"Plant · Loropetalum (Chinese fringe)", tags:"plant, prune, old wood, after bloom", fact:"Blooms on OLD wood — prune RIGHT AFTER spring bloom. Salt-moderate; can burn in exposed sites." },
  { id:"plant_azalea_camellia", topic:"Plant · Azaleas & camellias", tags:"plant, azalea, camellia, prune, old wood", fact:"Bloom on OLD wood. Prune RIGHT AFTER flowering; hard-pruning now removes next year's blooms. Acid-loving; watch salt/wind burn on exposed OBX lots." },
  { id:"plant_palm", topic:"Plant · Palms (windmill / sabal / pindo)", tags:"plant, palm, frond, prune", fact:"Cold-hardy palms. Remove only fully-brown fronds; do NOT over-prune green fronds ('hurricane cut' harms them). Watch for cold damage in a hard winter." },
  { id:"plant_turf", topic:"Plant · Coastal turf (centipede / St. Augustine / bermuda)", tags:"plant, turf, lawn, mow, edge", fact:"Usually centipede/St. Augustine/bermuda on sand. Don't scalp; mow high in heat. Weedy sandy lots are common. Edging + bed definition is high-value low-cost curb appeal." },
  { id:"plant_sea_oats", topic:"Plant · Sea oats / dune grasses (Uniola) — PROTECTED", tags:"plant, sea oats, dune, protected, legal, caution", fact:"Sea oats / dune grasses are PROTECTED on dunes in NC — do NOT cut or remove. Flag hard and refuse if a client asks; it's a legal issue." },
  { id:"plant_removal_general", topic:"Plant · Tree/shrub removal (rules + safety)", tags:"plant, removal, ordinance, disposal, safety", fact:"Check Dare/local ordinances + the HOA before removing large trees. Haul-off = weight-based disposal (ties to the disposal cost model). Stump grinding is a separate line. Storm-damaged/leaning trees near structures = a safety flag; may need a pro/insurance." }
];
function plantSeedMissing(){ try{ const have={}; (D().knowledge||[]).forEach(k=>{ if(k&&!k.deleted)have[k.id]=1; }); return PLANT_SEED.filter(t=>!have[t.id]).length; }catch(e){ return 0; } }
window.pbSeedPlants=function(){
  const d=D(); if(!Array.isArray(d.knowledge))d.knowledge=[];
  let added=0;
  PLANT_SEED.forEach(t=>{ if(!d.knowledge.find(k=>k&&k.id===t.id)){ const k={ id:t.id, topic:t.topic, fact:t.fact, tags:t.tags, deleted:false, updatedAt:(typeof now==="function"?now():Date.now()) }; d.knowledge.push(k); if(typeof touch==="function")touch(k); added++; } });
  if(typeof logChange==="function")logChange("create","knowledge","plants","Loaded "+added+" OBX plant playbook facts");
  if(typeof save==="function")save();
  if(S.sync&&S.sync.url&&S.sync.token&&S.sync.auto&&typeof syncNow==="function")syncNow();
  if(typeof toast==="function")toast(added?("Added "+added+" plant facts to the Playbook"):"Plant facts already loaded"); else alert(added?("Added "+added+" plant facts."):"Already loaded.");
  if(typeof render==="function")render();
};
