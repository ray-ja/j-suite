/* ---------- QUOTES ---------- */
let QSEARCH="",QSTAGE_FILTER="all";
function quoteStage(q){ if(q.paid)return "paid"; if(q.invoiced)return "invoiced"; if(q.accepted||q.jobId)return "scheduled"; return "quoted"; }
const QSTAGE_META={ paid:{label:"Paid",color:"#1a7f37"}, invoiced:{label:"Invoiced",color:"#e0a800"}, scheduled:{label:"Scheduled",color:"#2f6fed"}, quoted:{label:"Quoted",color:"#97a0ad"} };
function quoteType(q){ const n=(q.items||[]).map(it=>it&&it.name).filter(Boolean); return n.length?(n[0]+(n.length>1?" +"+(n.length-1):"")):""; }
window.quoteFilter=function(k){ QSTAGE_FILTER=k; rQuotes(); };
function rQuotes(){
  if(WZON)return wizRender();
  const dm=(typeof wzDraftMeta==="function")?wzDraftMeta():null;
  let h=`<h2>Jobs</h2>`;
  if(dm)h+=`<div class="card" style="border-left:4px solid var(--accent);margin-bottom:10px"><div class="nm">📝 Unsaved draft${dm.editing?" (editing a quote)":""}</div><div class="sub">${dm.name?esc(dm.name)+" · ":""}${dm.items} item(s) · ${money(dm.total)}</div><div class="row" style="gap:8px;margin-top:8px"><button class="btn acc grow" onclick="wizResumeDraft()">Resume draft</button><button class="btn ghost grow" onclick="wizDiscardDraft()">Discard</button></div></div>`;
  h+=`<button class="btn acc" style="margin-bottom:10px" onclick="startWizard()">✨ Guided Quote (step-by-step)</button>
    <button class="btn ghost" style="margin-bottom:10px" onclick="openDemoEst()">🏚️ Shed / Structure Demolition</button>`;
  const all=actQ();let list=all.slice();
  if(QSEARCH){const qq=QSEARCH.toLowerCase();list=list.filter(q=>((q.cust||custName(q.customerId)||"")+" "+quoteType(q)+" "+(q.date||"")+" "+(q.invoiceNo||"")+" "+String(q.total||"")+" "+quoteStage(q)).toLowerCase().includes(qq));}
  if(QSTAGE_FILTER!=="all")list=list.filter(q=>quoteStage(q)===QSTAGE_FILTER);
  list.sort((a,b)=>(b.date||"").localeCompare(a.date||""));   // most recent first
  if(all.length){
    h+=`<input class="search" id="qsearch" placeholder="Search jobs (customer, type, date)…" value="${esc(QSEARCH)}">`;
    const stages=[["all","All"],["quoted","Quoted"],["scheduled","Scheduled"],["invoiced","Invoiced"],["paid","Paid"]];
    h+=`<div class="subnav" style="margin:8px 0">`+stages.map(s=>`<button class="subbtn ${QSTAGE_FILTER===s[0]?"on":""}" onclick="quoteFilter('${s[0]}')">${s[1]}</button>`).join("")+`</div>`;
  }
  if(!all.length)h+=`<div class="empty"><div class="big">🧾</div>No jobs yet.<br>Use Guided Quote above, or tap + for the quick builder.</div>`;
  else if(!list.length)h+=`<div class="empty">No matches.</div>`;
  else h+=`<div class="card grid2">`+list.map(q=>{
    const st=quoteStage(q),m=QSTAGE_META[st],cust=esc(q.cust||custName(q.customerId)||"—"),type=quoteType(q);
    return `<div class="li" onclick="openQuote('${q.id}')" style="border-left:4px solid ${m.color};padding-left:10px">
      <div class="grow"><div class="nm" style="white-space:normal">${cust}${type?` <span style="font-weight:600;color:var(--muted)">· ${esc(type)}</span>`:""}</div>
      <div class="sub">${fmtDate(q.date)} · <span style="color:${m.color};font-weight:700">${m.label}</span>${q.recurring?" · recurring":""}</div></div>
      <div style="font-weight:800;color:${st==="paid"?"#1a7f37":"var(--brand-text)"};text-align:right">${money(q.finalPrice||q.total)}${(q.finalPrice&&q.finalPrice!==q.total)?`<div class="sub" style="font-weight:400">quote ${money(q.total)}</div>`:""}</div></div>`;
  }).join("")+`</div>`;
  view.innerHTML=h;
  const s=document.getElementById("qsearch");
  if(s)s.oninput=e=>{QSEARCH=e.target.value;const p=s.selectionStart;rQuotes();const n=document.getElementById("qsearch");if(n){n.focus();n.setSelectionRange(p,p);}};
}
let QITEMS=[];let CURQ=null;
/* The standalone quote modal has been RETIRED — saved quotes now open INTO the guided
   wizard (js/23, window.openQuote) for full editing: line edits, dump-fee inline input,
   discount/miles, print/copy, payment link, mark-invoiced/paid, and delete all live there.
   QITEMS/CURQ remain as the data source for the shared print/copy helpers below; the wizard
   feeds them via wizSyncLegacy()/wizFinish(). */
function quoteFigures(){
  if(CURQ&&CURQ.total!=null)return{sub:CURQ.subtotal||0,disc:CURQ.discount||0,total:CURQ.total};
  let sub=0;QITEMS.forEach(it=>sub+=(it.price||0)*(it.qty||1));return{sub:sub,disc:0,total:sub};
}
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
  const OBX_LOGO="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHoAAABQCAMAAADhsJGGAAAAn1BMVEV8lXlTXnlwmVWCtkp1pkp/s0p/s0qCt0qHvUp6q0prmEt7rkp0pEp4qUqJwUqIv0qEuUp/s0qEukp+sUp+skqFvEqGvUqGvEp7rkp/s0qIv0pwnkp5qkp+sUqDuEqCtkp5qkp3qEqGvEqiqLazuMTLztaDuEp/s0rR1NuOponLz9efuZDCxs/Bxc+/ysHJzdW7wMrU193GydLb3uOKwkpVYJ4XAAAANHRSTlMBKRVeYYSnqq46IkRCM+/5zmfz3i7JvOdUTNmFcph+tigb3YRZnY54qip1MjVIG4tSWWp16y6x8QAABaZJREFUaN7tmAt3ojgUgJMrKo8Q22mxUKXCFLs+sFjK//9te/NAg+IUOnt2ds8hbRWSm3y5j9wkJeRPFfrHyAN6QA/oAT2gB/SAHtAD+h9FQ8e676BhZI0nU9ty3OaI4Hkew+LJwgDOzbLeN4YFJXUN+hXas3lVlykz4V5VzcQv/sxE6519ah4ref8ke/9DyD48dkfD42RWmWV6Ho2w6qoEGg5quvN6KvRJvt/3MLj3dDk4t36FrqpQj6jebC1qSwXGPXw94i2Ds7o1akM/u6pxoSaqhJfKJG539Ennh/FyaU8v9VZax8xnDqUvYz3NulWJ3wmcLx+fPNIZDYEabKX7JCvNTk30yYpu0LCxezI5qH4vpDtah+n4HNVWw4MKPbnwfY0mYSXtEGnb26Q7Wittm+tJLTSetKGu3m3tH/n184ZTW6s95aHGUky54U+nFRWe574yFsaondyOti/saZhc4VT8C2eKxElVGHPDSM4Z/Ur6oONGwOoyUhFvPFerAMtcxzf3TellTZ7fzBytDby5ilXRcStVS65XNW+Kw7RtQt9Ep4ZVRy0ZxW7uMIvqygvfRusEmd5CNym0zoZ2P3Srr1XkrAytH+JxbI/jSRyohcfPg9X2xpJBH7QyVtzsY0Y4vRCgwcVkl4Y1GGkvregX1afRBg/G6KNmIsVczRvLUaUYfie/1n1Sit5z3xrZzPTnpdbElT3qTVo5epHo7x7oWu2bOVxpHRtamxPTjp5C3Yv1QOsYr6aJek3tyojva4PDwkRroIOPE1VPe6BZvTbmCyu0Txm5jiOVUlbqUOg4FlfiE6NRyabPlemJLmjy0nZKseoR9LrmeCqc8ao+wynl0rva3FKH5py7oFuyhnE289pSig4n7Zs6gdo33X37MJzMmwPbzq/mddJMH9tOG6jLZ0YYdEPj2X1yHncamU3eTJ3Dz7ae3xvLjpvpU6+0uA9aTBkvH6vVZPxyIeaOPPyRhUZRGPmnEyfFNyzmCdRnIYtCdqX213cu6HGN6lVuoEHPO7FClGBsxF5koEASjsRMUGUQVzLx7IYg5CmzLMaAeiC6MTGwg7GWYD/qR15nX6cqaEJ00tMIYl6vzSnnfEzAnt39CCg6Vpy7FhjNbhWGKrDfMKAwK/BqKRLTI/lrBgQ7tSyvW1rLS5JXxTSZcJrShwcKckYLgrfKcTUC9jwH56dCPwp5oIsKdY0DzCkxpZPKwa1gBQuOClhAu0e4nOVblYikgLjVVFVj7FopBAERCzZx5OY2Fp9iqkuxmN/uMJH6ItSXgMrGiKaz2dzqbnAeSrQr0KgaD1TXNNrgSSgQb5ZAiwAQpERMVViexByWYi60WgCf3uMBAp+tecuF7wba5Uvfd50q9tlKXI35XPlh6YNduePZ8nHEbQQuKYWksrexmIRCB9iZMx/9RPgULcExDqnPJ13RaCs+i2GxwcsDE0f6lazebmS+BPFlu2KjCJ53ZKczRlbtCdlhNom4TLvAUdQOgKLhedQVTVyMX7RqynIpAWqtAWWRtPw234OsdjHqwHdAtYoFJ/ZVYDKFu/odfJaSzuh/oXwTbW1bKg86ijtmvw7oPaAlgZJt9i7f84ySYk/oYQsYuzhAnh8l7eOdvGd7jIQdgHNIvxq3A7rcbzeYJbdFVghdD69ZRj5zWhyLHMKseIdN+fkpBd/TdVYcyLoEVmT+V+N20fo1K7KSlutjccRXebYt8nxzeC2JtdlsSUHeNyC1PpZkvyYfW7IvSvercTugYV3QdUEOxf4ojLjLaI7o7To/0P3GR3RJoFBa7wv6sSNlDjTKNsT9bTRuuHBgBA6lvMNA+ZqTIyX5rkyhLD/xicCHkMuBZJ87IHmx3+52OWS/jz7r30f4y/L/W9cDekAP6AE9oP87aDA+oK45bVRQNxqfF3/nx3PF9e+ZI/6X/TdEQQ6aD7nc/AAAAABJRU5ErkJggg==";
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

