/* ---------- BUDGET — a personal income/spending + monthly-plan tool (org-specific) ----------
   Built for Ray's personal organization (rbjvl). Ray's #1 personal priority. Two small synced
   collections, both per-org so they ride the existing per-record LWW sync exactly like customers:
     - budgetCats {id,name,kind,target,order,updatedAt,deleted}      categories + monthly PLANNED target
     - budgetTx   {id,date,amount,catId,note,dir,updatedAt,deleted}  one transaction (in or out)
   `dir` = "in" (income) | "out" (spending). `kind` on a category = "in" | "out" (what it's for).
   `target` = the monthly PLANNED amount for that category (0 = no plan, just track actuals).

   The month view compares PLANNED vs ACTUAL per category (remaining / over), shows income vs
   spending + net for the month, and a running balance across all time. Fast entry: amount,
   category, date, note, in/out. Its OWN settings tab (decentralized): categories + monthly
   targets + export/backup.

   Visibility: gated by the Phase-5 per-org tool system. The "budget" tab is an OPT-IN tab and part
   of the `personal` template (js/03), so it only appears for an org on that template — never for
   OBX / Jamieson. Feeds a month summary into orgAiContext (sync-server.js) so Cap can advise. */

/* ---- accessors (active = non-deleted, current org) ---- */
function actBudgetCats(){ return (D().budgetCats||[]).filter(function(c){return !c.deleted;})
  .sort(function(a,b){ return (a.order||0)-(b.order||0) || (a.name||"").localeCompare(b.name||""); }); }
function actBudgetTx(){ return (D().budgetTx||[]).filter(function(t){return !t.deleted;}); }
function budgetCat(id){ return actBudgetCats().find(function(c){return c.id===id;}); }
function budgetCatName(id){ var c=budgetCat(id); return c?c.name:"Uncategorized"; }
/* merchant→category memory (budgetMemo): {id,key,catId,updatedAt,deleted}; key = normalized description keyword */
function actBudgetMemo(){ return (D().budgetMemo||[]).filter(function(m){return !m.deleted;}); }

/* ---- month helpers ---- */
function budgetMonthOf(ds){ return (ds||today()).slice(0,7); }                  // "YYYY-MM"
function budgetThisMonth(){ return today().slice(0,7); }
function budgetMonthLabel(m){
  var p=(m||"").split("-"); if(p.length<2)return m||"";
  var MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return MO[(+p[1]||1)-1]+" "+p[0];
}
function budgetShiftMonth(m,delta){
  var p=(m||budgetThisMonth()).split("-"); var d=new Date(+p[0],(+p[1]||1)-1+delta,1);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}
function budgetMoney(n){ n=+n||0; return (n<0?"-$":"$")+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }

var BUDGET_SUB="month";       // "month" | "tx" | "settings"
var BUDGET_MONTH=null;        // the month being viewed (defaults to this month)
window.budgetSetSub=function(s){ BUDGET_SUB=s; render(); };
window.budgetSetMonth=function(m){ BUDGET_MONTH=m||budgetThisMonth(); render(); };
window.budgetNavMonth=function(delta){ BUDGET_MONTH=budgetShiftMonth(BUDGET_MONTH||budgetThisMonth(),delta); render(); };

/* the + FAB does the natural "add" for whatever sub-tab is open */
window.budgetFabAdd=function(){
  if(BUDGET_SUB==="settings")openBudgetCat(null);
  else openBudgetTx(null);
};

/* ---- totals ---- */
function budgetTxForMonth(m){ return actBudgetTx().filter(function(t){return budgetMonthOf(t.date)===m;}); }
function budgetSum(list,dir){ return list.filter(function(t){return t.dir===dir;}).reduce(function(s,t){return s+(+t.amount||0);},0); }
function budgetRunningBalance(){   // all-time income minus all-time spending
  var all=actBudgetTx(); return budgetSum(all,"in")-budgetSum(all,"out");
}
/* actual spent/earned for a category within a month */
function budgetCatActual(catId,m){
  return budgetTxForMonth(m).filter(function(t){return t.catId===catId;}).reduce(function(s,t){return s+(+t.amount||0);},0);
}

/* ---------- main render ---------- */
function rBudget(){
  var sub='<div class="subnav">'
    +'<button class="subbtn '+(BUDGET_SUB==="month"?"on":"")+'" onclick="budgetSetSub(\'month\')">📅 Month</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="tx"?"on":"")+'" onclick="budgetSetSub(\'tx\')">🧾 Transactions</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="settings"?"on":"")+'" onclick="budgetSetSub(\'settings\')">⚙️ Settings</button>'
    +'</div>';
  view.innerHTML=sub+'<div id="budget_body"></div>';
  if(BUDGET_SUB==="tx")budgetRenderTx();
  else if(BUDGET_SUB==="settings")budgetRenderSettings();
  else budgetRenderMonth();
}

/* ---------- MONTH — planned vs actual per category + income/spending/net + running balance ---------- */
function budgetRenderMonth(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var m=BUDGET_MONTH||budgetThisMonth();
  var rows=budgetTxForMonth(m);
  var income=budgetSum(rows,"in"), spending=budgetSum(rows,"out"), net=income-spending;
  var bal=budgetRunningBalance();

  var h='<div class="card"><div class="row" style="gap:8px;align-items:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(-1)" title="Previous month">‹</button>'
    +'<input type="month" value="'+m+'" onchange="budgetSetMonth(this.value)" style="flex:1;text-align:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(1)" title="Next month">›</button>'
    +'</div><div class="sub" style="text-align:center;margin-top:6px"><b>'+budgetMonthLabel(m)+'</b>'
    +(m===budgetThisMonth()?' · this month':'')+'</div></div>';

  /* the three headline numbers for the month + running balance */
  h+='<div class="card"><div class="row" style="text-align:center">'
    +budgetStat("Income","var(--ok,#1b7f4d)",budgetMoney(income))
    +budgetStat("Spending","var(--danger)",budgetMoney(spending))
    +budgetStat("Net",net>=0?"var(--ok,#1b7f4d)":"var(--danger)",(net>=0?"+":"")+budgetMoney(net))
    +'</div>'
    +'<div class="sub" style="text-align:center;margin-top:8px;border-top:1px solid var(--line,#eee);padding-top:8px">Running balance (all time): <b style="color:'+(bal>=0?"var(--ok,#1b7f4d)":"var(--danger)")+'">'+budgetMoney(bal)+'</b></div>'
    +'</div>';

  /* planned vs actual — spending categories first (the budget), then income categories */
  var cats=actBudgetCats();
  h+=budgetPlanSection("Spending plan","out",cats,m,spending);
  h+=budgetPlanSection("Income","in",cats,m,income);

  if(!cats.length){
    h+='<div class="empty"><div class="big">💰</div>No categories yet. Add spending + income categories with monthly targets on the <b>Settings</b> tab, then log transactions.</div>';
  }

  body.innerHTML=h;
}
function budgetStat(label,color,value){
  return '<div style="flex:1"><div class="sub">'+esc(label)+'</div><div style="font-weight:800;font-size:18px;color:'+color+'">'+value+'</div></div>';
}
function budgetPlanSection(title,kind,cats,m,monthTotal){
  var list=cats.filter(function(c){return (c.kind||"out")===kind;});
  if(!list.length)return "";
  var plannedTotal=list.reduce(function(s,c){return s+(+c.target||0);},0);
  var h='<div class="secthd"><h2>'+esc(title)+'</h2>'+(plannedTotal>0?'<span class="ct">plan '+budgetMoney(plannedTotal)+'</span>':'')+'</div>';
  h+='<div class="card" style="padding:6px 10px">'+list.map(function(c){
    var actual=budgetCatActual(c.id,m), target=+c.target||0;
    var pct=target>0?Math.min(100,Math.round(actual/target*100)):(actual>0?100:0);
    var over=target>0&&actual>target;
    var barColor=kind==="in"?"#1b7f4d":(over?"var(--danger)":(pct>=90?"#d98a00":"#1b7f4d"));
    var remLabel="";
    if(target>0){
      var rem=target-actual;
      remLabel=over?('<span style="color:var(--danger);font-weight:600">'+budgetMoney(-rem)+' over</span>')
                    :('<span style="color:var(--muted)">'+budgetMoney(rem)+' '+(kind==="in"?"to go":"left")+'</span>');
    }else remLabel='<span style="color:var(--muted)">no target</span>';
    return '<div class="li" style="align-items:flex-start;flex-direction:column;cursor:pointer" onclick="budgetSetSub(\'tx\')">'
      +'<div class="row" style="width:100%;justify-content:space-between"><div class="nm">'+esc(c.name)+'</div>'
      +'<div style="font-weight:700">'+budgetMoney(actual)+(target>0?' <span class="sub" style="font-weight:400">/ '+budgetMoney(target)+'</span>':'')+'</div></div>'
      +'<div style="width:100%;height:6px;background:var(--line,#eee);border-radius:4px;margin:5px 0 3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+barColor+'"></div></div>'
      +'<div class="sub" style="width:100%;text-align:right">'+remLabel+'</div>'
      +'</div>';
  }).join("")+'</div>';
  /* uncategorized for this kind */
  var uncat=budgetTxForMonth(m).filter(function(t){return t.dir===kind&&!budgetCat(t.catId);});
  if(uncat.length){
    var uTot=uncat.reduce(function(s,t){return s+(+t.amount||0);},0);
    h+='<div class="sub" style="margin:4px 8px 0">Uncategorized '+(kind==="in"?"income":"spending")+': <b>'+budgetMoney(uTot)+'</b> ('+uncat.length+')</div>';
  }
  return h;
}

/* ---------- TRANSACTIONS — list (this month, newest first) + fast entry ---------- */
function budgetRenderTx(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var m=BUDGET_MONTH||budgetThisMonth();
  var rows=budgetTxForMonth(m).sort(function(a,b){ return (b.date||"")<(a.date||"")?-1:((b.date||"")>(a.date||"")?1:(b.updatedAt||0)-(a.updatedAt||0)); });

  var h='<div class="card"><div class="row" style="gap:8px;align-items:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(-1)">‹</button>'
    +'<input type="month" value="'+m+'" onchange="budgetSetMonth(this.value)" style="flex:1;text-align:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(1)">›</button>'
    +'</div></div>';
  h+='<div class="row" style="gap:8px;margin-bottom:10px">'
    +'<button class="btn acc" style="flex:1" onclick="openBudgetTx(null)">＋ Add transaction</button>'
    +'<button class="btn ghost" style="flex:1" onclick="budgetImportOpen()">⬆️ Import CSV</button></div>';
  h+='<div class="secthd"><h2>'+budgetMonthLabel(m)+'</h2><span class="ct">'+rows.length+' '+(rows.length===1?"item":"items")+'</span></div>';
  if(!rows.length){
    h+='<div class="empty"><div class="big">🧾</div>No transactions this month. Tap <b>Add transaction</b> to log income or spending.</div>';
  }else{
    h+='<div class="card" style="padding:6px 10px">'+rows.map(function(t){
      var inc=t.dir==="in";
      return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openBudgetTx(\''+t.id+'\')">'
        +'<div class="grow"><div class="nm">'+esc(budgetCatName(t.catId))+(t.note?' <span class="sub" style="font-weight:400">· '+esc(t.note)+'</span>':'')+'</div>'
        +'<div class="sub">'+esc(fmtDate(t.date))+'</div></div>'
        +'<div style="font-weight:800;color:'+(inc?"var(--ok,#1b7f4d)":"var(--danger)")+'">'+(inc?"+":"−")+budgetMoney(t.amount)+'</div></div>';
    }).join("")+'</div>';
  }
  body.innerHTML=h;
}
window.openBudgetTx=function(id){
  var isNew=!id;
  var t=isNew?{id:"bgt-tx-"+uid(),date:today(),dir:"out",amount:"",catId:"",note:""}:actBudgetTx().find(function(x){return x.id===id;});
  if(!t)return;
  var cats=actBudgetCats();
  var dir=t.dir||"out";
  var catOpts='<option value="">— pick a category —</option>'+cats.map(function(c){
    return '<option value="'+c.id+'" data-kind="'+(c.kind||"out")+'" '+(t.catId===c.id?"selected":"")+'>'+esc(c.name)+' ('+((c.kind||"out")==="in"?"income":"spending")+')</option>';
  }).join("");
  modal(isNew?"Add transaction":"Edit transaction",''
    +'<div class="row" style="gap:8px;margin-bottom:8px">'
    +'<button class="btn '+(dir==="out"?"danger":"ghost")+'" style="flex:1" onclick="budgetTxDir(this,\'out\')">− Spending</button>'
    +'<button class="btn '+(dir==="in"?"acc":"ghost")+'" style="flex:1" onclick="budgetTxDir(this,\'in\')">＋ Income</button>'
    +'</div><input type="hidden" id="bt_dir" value="'+dir+'">'
    +'<label>Amount</label><input id="bt_amount" type="number" inputmode="decimal" step="0.01" value="'+esc(t.amount!=null?t.amount:"")+'" placeholder="0.00">'
    +'<label>Category</label><select id="bt_cat">'+catOpts+'</select>'
    +(cats.length?'':'<div class="sub" style="margin:4px 0">No categories yet — add some on the Settings tab. You can still log this; it\'ll show as uncategorized.</div>')
    +'<label>Date</label><input id="bt_date" type="date" value="'+(t.date||today())+'">'
    +'<label>Note (optional)</label><input id="bt_note" value="'+esc(t.note||"")+'" placeholder="e.g. groceries, paycheck">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetTx(\''+t.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetTx(\''+t.id+'\')">Delete</button>')
  );
};
window.budgetTxDir=function(btn,dir){
  var d=document.getElementById("bt_dir"); if(d)d.value=dir;
  var wrap=btn.parentNode; if(!wrap)return;
  var btns=wrap.querySelectorAll("button");
  btns[0].className="btn "+(dir==="out"?"danger":"ghost"); btns[0].style.flex="1";
  btns[1].className="btn "+(dir==="in"?"acc":"ghost"); btns[1].style.flex="1";
};
window.saveBudgetTx=function(id,isNew){
  var d=D(); if(!d.budgetTx)d.budgetTx=[];
  var t=isNew?{id:id}:d.budgetTx.find(function(x){return x.id===id;});
  if(!t){closeModal();return;}
  var amt=parseFloat(val("bt_amount"));
  if(isNaN(amt)||amt<=0){alert("Enter an amount greater than zero.");return;}
  t.amount=Math.round(amt*100)/100;
  t.dir=(document.getElementById("bt_dir")||{}).value||"out";
  t.catId=(document.getElementById("bt_cat")||{}).value||"";
  t.date=val("bt_date")||today();
  t.note=val("bt_note");
  t.deleted=false; touch(t); if(isNew)d.budgetTx.push(t);
  /* jump the month view to where this txn lives so it's visible after save */
  BUDGET_MONTH=budgetMonthOf(t.date);
  save(); closeModal(); render();
};
window.delBudgetTx=function(id){
  if(!confirm("Delete this transaction?"))return;
  var t=actBudgetTx().find(function(x){return x.id===id;}); if(!t)return;
  t.deleted=true; touch(t); save(); closeModal(); render();
};

/* ---------- SETTINGS — categories + monthly targets + export/backup (decentralized) ---------- */
function budgetRenderSettings(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var cats=actBudgetCats();
  var h='<p class="muted" style="margin:0 4px 8px;font-size:13px">Set up your spending + income categories and a monthly <b>target</b> (your plan) for each. The Month tab compares planned vs actual.</p>';
  h+='<button class="btn acc" style="width:100%;margin-bottom:10px" onclick="openBudgetCat(null)">＋ New category</button>';

  h+=budgetCatSection("Spending categories","out",cats);
  h+=budgetCatSection("Income categories","in",cats);

  if(!cats.length){
    h+='<div class="empty"><div class="big">⚙️</div>No categories yet. Add spending categories (rent, food, gas…) and income categories (paycheck, side work…).</div>';
  }

  /* import a bank CSV */
  h+='<div class="secthd"><h2>Import</h2></div>';
  h+='<div class="card"><p class="muted" style="margin:0 0 8px;font-size:13px">Import a month of transactions from a bank/card CSV: paste or upload, map the columns, then bulk-categorize. Re-importing skips obvious duplicates.</p>'
    +'<button class="btn acc" style="width:100%" onclick="budgetImportOpen()">⬆️ Import CSV</button></div>';

  /* export / backup */
  h+='<div class="secthd"><h2>Backup</h2></div>';
  h+='<div class="card"><p class="muted" style="margin:0 0 8px;font-size:13px">Download a JSON backup of every category + transaction, or a CSV of transactions for a spreadsheet.</p>'
    +'<div class="row" style="gap:8px"><button class="btn ghost" style="flex:1" onclick="budgetExport(\'json\')">⬇️ JSON backup</button>'
    +'<button class="btn ghost" style="flex:1" onclick="budgetExport(\'csv\')">⬇️ CSV (txns)</button></div></div>';

  body.innerHTML=h;
}
function budgetCatSection(title,kind,cats){
  var list=cats.filter(function(c){return (c.kind||"out")===kind;});
  var planTotal=list.reduce(function(s,c){return s+(+c.target||0);},0);
  var h='<div class="secthd"><h2>'+esc(title)+'</h2>'+(list.length?'<span class="ct">plan '+budgetMoney(planTotal)+'/mo</span>':'')+'</div>';
  if(!list.length)return h+'<div class="card"><div class="sub">None yet.</div></div>';
  h+='<div class="card" style="padding:6px 10px">'+list.map(function(c){
    return '<div class="li" style="cursor:pointer" onclick="openBudgetCat(\''+c.id+'\')">'
      +'<div class="grow"><div class="nm">'+esc(c.name)+'</div>'
      +'<div class="sub">'+((+c.target>0)?('target '+budgetMoney(c.target)+'/mo'):'no monthly target')+'</div></div>'
      +'<div class="btn ghost sm">Edit ›</div></div>';
  }).join("")+'</div>';
  return h;
}
window.openBudgetCat=function(id){
  var isNew=!id;
  var c=isNew?{id:"bgt-cat-"+uid(),name:"",kind:"out",target:""}:actBudgetCats().find(function(x){return x.id===id;});
  if(!c)return;
  var kind=c.kind||"out";
  modal(isNew?"New category":"Edit category",''
    +'<label>Name</label><input id="bc_name" value="'+esc(c.name||"")+'" placeholder="e.g. Rent · Groceries · Paycheck">'
    +'<label>Type</label><select id="bc_kind">'
    +'<option value="out" '+(kind==="out"?"selected":"")+'>Spending (money out)</option>'
    +'<option value="in" '+(kind==="in"?"selected":"")+'>Income (money in)</option>'
    +'</select>'
    +'<label>Monthly target (optional)</label><input id="bc_target" type="number" inputmode="decimal" step="0.01" value="'+esc(c.target!=null&&c.target!==""?c.target:"")+'" placeholder="0.00 — your monthly plan for this">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetCat(\''+c.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetCat(\''+c.id+'\')">Delete category</button>')
  );
};
window.saveBudgetCat=function(id,isNew){
  var d=D(); if(!d.budgetCats)d.budgetCats=[];
  var c=isNew?{id:id,order:actBudgetCats().length}:d.budgetCats.find(function(x){return x.id===id;});
  if(!c){closeModal();return;}
  c.name=val("bc_name"); if(!c.name){alert("Give the category a name.");return;}
  c.kind=(document.getElementById("bc_kind")||{}).value||"out";
  var tgt=parseFloat(val("bc_target")); c.target=(isNaN(tgt)||tgt<0)?0:Math.round(tgt*100)/100;
  c.deleted=false; touch(c); if(isNew)d.budgetCats.push(c);
  save(); closeModal(); BUDGET_SUB="settings"; render();
};
window.delBudgetCat=function(id){
  if(!confirm("Delete this category? Its transactions stay but will show as uncategorized."))return;
  var c=actBudgetCats().find(function(x){return x.id===id;}); if(!c)return;
  c.deleted=true; touch(c); save(); closeModal(); render();
};

/* ---------- export / backup ---------- */
function budgetDownload(name,text,mime){
  try{
    var blob=new Blob([text],{type:mime||"text/plain"});
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); },0);
  }catch(e){ alert("Export failed: "+e.message); }
}
window.budgetExport=function(fmt){
  var cats=actBudgetCats(), tx=actBudgetTx().slice().sort(function(a,b){return (a.date||"")<(b.date||"")?-1:1;});
  var stamp=today();
  if(fmt==="csv"){
    var head="date,direction,amount,category,note\n";
    var lines=tx.map(function(t){
      var cell=function(s){ s=(s==null?"":String(s)); return /[",\n]/.test(s)?('"'+s.replace(/"/g,'""')+'"'):s; };
      return [t.date,t.dir,(+t.amount||0).toFixed(2),budgetCatName(t.catId),t.note||""].map(cell).join(",");
    }).join("\n");
    budgetDownload("budget-"+stamp+".csv",head+lines,"text/csv");
  }else{
    var out={ exportedAt:stamp, categories:cats, transactions:tx };
    budgetDownload("budget-backup-"+stamp+".json",JSON.stringify(out,null,2),"application/json");
  }
};
