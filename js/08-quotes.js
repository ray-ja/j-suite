/* ---------- QUOTES ---------- */
function rQuotes(){
  if(WZON)return wizRender();
  let h=`<h2>Quotes</h2>
    <button class="btn acc" style="margin-bottom:10px" onclick="startWizard()">✨ Guided Quote (step-by-step)</button>
    <button class="btn ghost" style="margin-bottom:10px" onclick="openDemoEst()">🏚️ Shed / Structure Demolition</button>
    <button class="btn ghost" style="margin-bottom:10px" onclick="reviewAsk()">⭐ Ask for a Google review</button>`;
  const list=actQ();
  if(!list.length)h+=`<div class="empty"><div class="big">🧾</div>No quotes yet.<br>Use Guided Quote above, or tap + for the quick builder.</div>`;
  else h+=`<div class="card grid2">`+list.slice().reverse().map(q=>`
    <div class="li" onclick="openQuote('${q.id}')"><div class="grow">
    <div class="nm">${esc(q.cust||custName(q.customerId))}</div>
    <div class="sub">${fmtDate(q.date)} · ${q.items.length} item(s)${q.recurring?" · recurring":""}${q.paid?" · ✓ paid":q.invoiced?" · invoiced":""}</div></div>
    <div style="font-weight:800;color:var(--brand)">${money(q.total)}</div></div>`).join("")+`</div>`;
  view.innerHTML=h;
}
let QITEMS=[];let CURQ=null;
window.openQuote=function(id,customerId,preset){
  const d=D();const q=id?d.quotes.find(x=>x.id===id):null;CURQ=q;
  QITEMS=q?JSON.parse(JSON.stringify(q.items)):(preset?JSON.parse(JSON.stringify(preset)):[]);
  const custDefault=q?q.customerId:(customerId||"");const custFree=q?q.cust:"";
  const opts=`<option value="">— pick customer —</option>`+actC().map(c=>`<option value="${c.id}" ${custDefault===c.id?"selected":""}>${esc(c.name||c.company)}</option>`).join("");
  modal(id?"Quote":"New quote",`
    <label>Customer</label><select id="q_cust">${opts}</select>
    <input id="q_custfree" style="margin-top:6px" placeholder="…or type a name" value="${esc(custFree)}">
    <h2 style="margin-top:14px">Line items</h2><div id="qlines"></div>
    <button class="btn ghost sm" style="margin-top:6px" onclick="addLine()">+ Add line</button>
    ${(BIZ[S.biz].recurring && !QITEMS.some(it=>/junk|haul|move-?out|clear|storm|debris|dump|clean-?out/i.test(it.name||"")))?`<div class="toggle"><input type="checkbox" id="q_rec" ${q&&q.recurring?"checked":""} onchange="renderTot()"><label style="margin:0">Recurring service — 20% off</label></div>`:""}
    <label>Extra discount ($, optional)</label><input type="number" id="q_disc" value="${q?Math.max(0,(q.discount||0)-(q.recurring?Math.round((q.subtotal||0)*0.2):0)):0}" oninput="renderTot()">
    <label>Round-trip miles (drive cost @ ${MILEAGE_RATE_LABEL}/mi)</label><input type="number" id="q_miles" value="${q?(q.miles||0):0}" oninput="renderTot()">
    <div class="totbar" style="position:static"><span class="lab">Total</span><span class="amt" id="q_tot">$0</span></div>
    <div id="q_cogs"></div>
    <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn acc grow" onclick="saveQuote('${q?q.id:""}')">Save quote</button>
      <button class="btn ghost grow" onclick="copyQuote()">Copy as text</button></div>
    <button class="btn ghost" style="margin-top:8px" onclick="printQuote()">🖨 Print / Save PDF</button>
    ${id?`<div class="row" style="gap:8px;margin-top:8px">
      <button class="btn ghost sm grow" onclick="toggleInvoiced('${id}')">${q&&q.invoiced?"✓ Invoiced":"Mark invoiced"}</button>
      <button class="btn ghost sm grow" onclick="togglePaid('${id}')">${q&&q.paid?"✓ Paid":"Mark paid"}</button></div>
      ${q&&q.paymentLink?`<a class="btn acc" style="margin-top:8px" href="${esc(q.paymentLink)}" target="_blank" rel="noopener">💳 Pay now</a>`:`<div class="note" style="margin-top:8px">Add a payment link (Stripe Payment Links recommended — no monthly fee, ~2.9%+30¢, one link per amount). Paste it once your Stripe account is connected.</div><input id="q_paylink" style="margin-top:6px" placeholder="https://buy.stripe.com/..." value=""><button class="btn ghost sm" style="margin-top:6px" onclick="setPayLink('${id}')">Save link</button>`}
      <button class="btn danger" style="margin-top:10px" onclick="delQuote('${id}')">Delete quote</button>`:""}
  `);
  renderLines();
};
function renderLines(){
  const c=cat();
  document.getElementById("qlines").innerHTML=QITEMS.map((it,i)=>{
    const groups=[];c.forEach(s=>{if(!groups.includes(s.cat))groups.push(s.cat);});
    const opts=groups.map(g=>`<optgroup label="${esc(g)}">`+c.filter(s=>s.cat===g).map(s=>`<option value="${s.id}" ${it.serviceId===s.id?"selected":""}>${esc(s.name)}</option>`).join("")+`</optgroup>`).join("");
    const isQuote=it.unit==="quote";
    const isJunk=/junk|haul|debris|clear|cleanout|dump|move-out/i.test(it.name||"");
    return `<div class="qline">
      <select onchange="lineSvc(${i},this.value)"><option value="">— service —</option>${opts}</select>
      <input class="q" type="number" min="1" value="${it.qty}" oninput="lineQty(${i},this.value)" title="qty">
      <input class="pr" type="number" value="${it.price}" ${isQuote?"":"readonly"} oninput="linePrice(${i},this.value)" title="price">
      <input class="pr" type="number" value="${it.cost||0}" oninput="lineCost(${i},this.value)" title="cost" placeholder="cost">
      <button class="rm" onclick="rmLine(${i})">×</button>${isJunk?`<button class="btn ghost sm" style="margin-top:4px" onclick="junkHelper(${i})">⚖ Dump fee from load weight</button>`:""}</div>`;
  }).join("")||`<div class="muted">No items yet — add one.</div>`;
  renderTot();
}
window.addLine=function(){QITEMS.push({serviceId:"",name:"",unit:"flat",price:0,qty:1});renderLines();};
window.rmLine=function(i){QITEMS.splice(i,1);renderLines();};
window.lineSvc=function(i,sid){const s=cat().find(x=>x.id===sid);if(!s)return;
  QITEMS[i]={serviceId:s.id,name:s.name,unit:s.unit,price:s.price,qty:QITEMS[i].qty||1};renderLines();};
window.lineQty=function(i,v){QITEMS[i].qty=Math.max(1,parseInt(v)||1);renderTot();};
window.linePrice=function(i,v){QITEMS[i].price=parseFloat(v)||0;renderTot();};
window.lineCost=function(i,v){QITEMS[i].cost=parseFloat(v)||0;renderTot();};
window.junkHelper=function(i){const lbs=parseFloat(prompt("Estimated load weight (lbs)? Pickup load ≈ 1500–2500.","2000"));if(!lbs)return;const veg=confirm("Is this CLEAN vegetative debris (yard/brush only)?\n\nOK = clean veg → dumps FREE in Dare County.\nCancel = mixed C&D load → $73.16/ton over the first 500 lbs.");QITEMS.splice(i+1,0,disposalLine(lbs,veg));renderLines();};
function quoteCalc(){let sub=0;QITEMS.forEach(it=>sub+=(it.price||0)*(it.qty||1));
  const rec=document.getElementById("q_rec")&&document.getElementById("q_rec").checked;
  const recDisc=rec?sub*0.2:0;
  const md=document.getElementById("q_disc")?(parseFloat(document.getElementById("q_disc").value)||0):0;
  const disc=recDisc+md;
  const miles=document.getElementById("q_miles")?(parseFloat(document.getElementById("q_miles").value)||0):0;
  return{sub,disc,manualDisc:md,recDisc,miles,total:Math.max(0,sub-disc),rec};}
window.renderTot=function(){const t=quoteCalc();const el=document.getElementById("q_tot");if(el)el.textContent=money(t.total);const ce=document.getElementById("q_cogs");if(ce)ce.innerHTML=cogsStrip(t.total,itemsCost(QITEMS)+mileageCost(t.miles))+(t.miles?`<div class="sub" style="margin-top:2px">Incl. ${money(mileageCost(t.miles))} drive (${t.miles} mi × ${MILEAGE_RATE_LABEL})</div>`:"");};
function quoteFigures(){if(!document.getElementById("q_rec")&&CURQ&&CURQ.total!=null)return{sub:CURQ.subtotal,disc:CURQ.discount,total:CURQ.total};return quoteCalc();}
window.saveQuote=function(id){
  const t=quoteCalc();const d=D();
  const obj={id:id||uid(),customerId:val("q_cust"),cust:val("q_custfree")||(val("q_cust")?custName(val("q_cust")):""),
    date:today(),items:JSON.parse(JSON.stringify(QITEMS)),recurring:t.rec,subtotal:t.sub,discount:t.disc,manualDisc:t.manualDisc,miles:t.miles,total:t.total,cost:itemsCost(QITEMS)+mileageCost(t.miles),paymentLink:CURQ?(CURQ.paymentLink||""):""};
  if(!obj.items.length){alert("Add at least one line item.");return;}
  touch(obj);
  if(id){const i=d.quotes.findIndex(x=>x.id===id);d.quotes[i]=obj;}else d.quotes.push(obj);
  if(obj.customerId){const c=d.customers.find(x=>x.id===obj.customerId);if(c&&(c.status==="Lead"||c.status==="Contacted")){c.status="Quoted";touch(c);}}
  if(!id)logEvent("Quote created — "+money(obj.total)+(obj.cust?" · "+obj.cust:""),"quote");
  save();closeModal();render();
};
window.delQuote=function(id){if(!confirm("Delete this quote?"))return;
  const q=D().quotes.find(x=>x.id===id);q.deleted=true;touch(q);save();closeModal();render();};
window.toggleInvoiced=function(id){const q=D().quotes.find(x=>x.id===id);q.invoiced=!q.invoiced;touch(q);save();openQuote(id);};
window.togglePaid=function(id){const q=D().quotes.find(x=>x.id===id);q.paid=!q.paid;if(q.paid){q.invoiced=true;logEvent("Invoice paid — "+money(q.total)+(q.cust?" · "+q.cust:""),"paid");}touch(q);save();openQuote(id);};
window.setPayLink=function(id){const q=D().quotes.find(x=>x.id===id);if(!q)return;q.paymentLink=val("q_paylink").trim();touch(q);save();openQuote(id);};
window.copyQuote=function(){
  const t=quoteFigures();const who=val("q_custfree")||(val("q_cust")?custName(val("q_cust")):"")||(CURQ&&CURQ.cust)||"";
  let lines=QITEMS.filter(it=>it.serviceId||it.name).map(it=>`• ${it.name}${it.qty>1?" ×"+it.qty:""} — ${money(it.price*it.qty)}`);
  let txt=`${S.biz==="obx"?"OBX Lot Solutions":"Jamieson Automation"} — Quote\n`+
    (who?`For: ${who}\n`:"")+
    "\n"+lines.join("\n")+(t.disc?`\nRecurring discount (20%): -${money(t.disc)}`:"")+`\n\nTotal: ${money(t.total)}`+
    (BIZ[S.biz].phone?`\n\n${BIZ[S.biz].phone}`:"");
  if(navigator.clipboard)navigator.clipboard.writeText(txt);
  alert("Quote copied — paste it into a text or email:\n\n"+txt);
};
window.printQuote=function(){
  const t=quoteFigures();const biz=S.biz;const isObx=biz==="obx";
  const brand=isObx?"#1B2A4E":"#002052";const acc=isObx?"#8BC34A":"#0099E5";
  const name=isObx?"OBX Lot Solutions":"Jamieson Automation";
  const phone=BIZ[biz].phone||"";
  const who=val("q_custfree")||(val("q_cust")?custName(val("q_cust")):"")||(CURQ&&CURQ.cust)||"";
  const rows=QITEMS.filter(it=>it.serviceId||it.name).map(it=>`<tr><td>${esc(it.name)}</td><td style="text-align:center">${it.qty||1}</td><td style="text-align:right">${money((it.price||0)*(it.qty||1))}</td></tr>`).join("");
  const nameHtml=name.replace(/ ([^ ]+)$/,' <span style="color:'+acc+'">$1</span>');
  // Logo on the PDF header: OBX logo base64-embedded so the printed quote is fully self-contained (works when Ray opens the app as a local file:// — a served URL would not resolve there).
  const OBX_LOGO="data:image/png;base64,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";
  const brandHtml=isObx?`<img src="${OBX_LOGO}" alt="${esc(name)}" style="height:48px;max-width:260px;object-fit:contain;background:#fff;border-radius:8px;padding:5px 10px">`:`<div class="n">${nameHtml}</div>`;
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Quote - ${esc(name)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;color:#1b2330;margin:0;padding:32px}
  .hd{background:${brand};color:#fff;padding:18px 22px;border-radius:10px;display:flex;justify-content:space-between;align-items:center}
  .hd .n{font-size:22px;font-weight:800}
  h2{margin:22px 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{padding:10px 8px;border-bottom:1px solid #e2e7ee;font-size:14px}
  th{text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase}
  .tot{margin-top:14px;text-align:right;font-size:22px;font-weight:800;color:${brand}}
  .disc{text-align:right;color:#6b7280;font-size:13px;margin-top:6px}
  .ft{margin-top:28px;color:#6b7280;font-size:12px}
  @media print{body{padding:6px}}</style></head>
  <body><div class="hd">${brandHtml}<div style="font-weight:700">${(CURQ&&CURQ.invoiced)?"INVOICE":"QUOTE"}</div></div>
  ${who?`<h2>Prepared for</h2><div>${esc(who)}${(CURQ&&CURQ.address)?"<br>"+esc(CURQ.address):""}</div>`:""}
  <h2>Services</h2><table><tr><th>Service</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th></tr>${rows}</table>
  ${t.disc?`<div class="disc">Discount: -${money(t.disc)}</div>`:""}
  <div class="tot">Total: ${money(t.total)}</div>
  <div class="ft">${esc(name)}${phone?" &middot; "+phone:""} &middot; ${new Date().toLocaleDateString()}</div>
  <script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script></body></html>`;
  const w=window.open("","_blank");if(!w){alert("Allow pop-ups for this page to print the quote.");return;}
  w.document.write(html);w.document.close();
};

