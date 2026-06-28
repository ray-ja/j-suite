/* ---------- BUDGET — a personal income/spending + monthly-plan tool, now MULTI-ENTITY via "books" ----------
   Built for Ray's personal organization (rbjvl). Ray's #1 personal priority. Per-org synced collections that
   ride the existing per-record LWW sync exactly like customers:
     - budgetBooks {id,name,kind,linkedOrgId,color,order,updatedAt,deleted}   one ENTITY (a business or Personal)
     - budgetCats  {id,name,kind,target,bookId,order,updatedAt,deleted}        categories + monthly PLANNED target
     - budgetTx    {id,date,amount,catId,note,dir,bookId,isTransfer,transferId,updatedAt,deleted}  one transaction
     - budgetMemo  {id,key,catId,updatedAt,deleted}                            CSV merchant→category memory

   P0 = BOOKS foundation. Each business + personal entity = a `budgetBook`; `bookId` tags every cat + tx. A
   header SELECTOR picks one book OR "All (combined)". Per-book views filter by bookId; Combined aggregates
   across all books. Inter-book TRANSFERS (owner draw etc.) are recorded as a PAIRED out+in linked by a
   `transferId` with `isTransfer:true` — they only move cash, so they are EXCLUDED from income/spending /
   plan-vs-actual totals, and in Combined the paired legs net to zero. ALL inside rbjvl (no cross-org reads).

   `dir` = "in" (income) | "out" (spending). `kind` on a category = "in" | "out". `target` = the monthly
   PLANNED amount (0 = no plan). On load a default "Personal" book is created and every pre-books cat/tx is
   assigned to it (migrateBudgetBooks — loss-free + idempotent, deterministic id so devices converge).

   Visibility: gated by the Phase-5 per-org tool system — the "budget" tab is OPT-IN and part of the
   `personal` template (js/03), never shown for OBX / Jamieson. Feeds a per-book + combined month summary
   into orgAiContext (sync-server.js) so Cap can advise on his separate entities and the money hub. */

/* ---- MIGRATION (shared by client load() + sample-data + mirrors the server's migrateBudgetBooks) ----
   Ensure a default Personal book for any org that has touched the budget, then tag untagged cats/tx with it.
   Pure-additive: never renames a book, never drops a record, never reassigns a record that already has a
   bookId. Deterministic default id so independent devices / a re-seed converge instead of duplicating. */
function migrateBudgetBooks(o,oid){
  if(!o||typeof o!=="object"||Array.isArray(o))return o;
  if(!Array.isArray(o.budgetBooks))o.budgetBooks=[];
  var hasBudget=(o.budgetCats&&o.budgetCats.length)||(o.budgetTx&&o.budgetTx.length)||o.budgetBooks.length;
  if(!hasBudget)return o;                                  // org never used the budget tool → leave untouched
  var defId="bgt-book-default-"+oid;
  var def=o.budgetBooks.find(function(b){return b&&b.id===defId;});
  if(!def){ def={id:defId,name:"Personal",kind:"personal",linkedOrgId:"",color:"#1b7f4d",order:0,updatedAt:1,deleted:false}; o.budgetBooks.push(def); }
  var live=o.budgetBooks.find(function(b){return b&&!b.deleted&&b.id===defId;})||o.budgetBooks.find(function(b){return b&&!b.deleted;})||def;
  var target=live.id;
  (o.budgetCats||[]).forEach(function(c){ if(c&&!c.bookId){ c.bookId=target; if(!c.updatedAt)c.updatedAt=1; } });
  (o.budgetTx||[]).forEach(function(t){ if(t&&!t.bookId){ t.bookId=target; if(!t.updatedAt)t.updatedAt=1; } });
  return o;
}

/* ---- book state + accessors ---- */
var BUDGET_BOOK="__all__";    // selected book id, or "__all__" for Combined
function actBudgetBooks(){ return (D().budgetBooks||[]).filter(function(b){return !b.deleted;})
  .sort(function(a,b){ return (a.order||0)-(b.order||0) || (a.name||"").localeCompare(b.name||""); }); }
function budgetBook(id){ return actBudgetBooks().find(function(b){return b.id===id;}); }
function budgetIsAll(){ return BUDGET_BOOK==="__all__"; }
/* clamp the selection to an existing book (e.g. after a delete); "__all__" always valid */
function budgetCurrentBookId(){
  if(budgetIsAll())return "__all__";
  if(budgetBook(BUDGET_BOOK))return BUDGET_BOOK;
  var first=actBudgetBooks()[0]; BUDGET_BOOK=first?first.id:"__all__"; return BUDGET_BOOK;
}
/* a sensible default book to file NEW cats/tx into when Combined is selected: the default Personal book if present, else the first */
function budgetDefaultBookId(){
  var books=actBudgetBooks(); if(!books.length)return "";
  if(!budgetIsAll()&&budgetBook(BUDGET_BOOK))return BUDGET_BOOK;
  var def=books.find(function(b){return b.id==="bgt-book-default-"+S.biz;});
  return (def||books[0]).id;
}

/* ---- accessors (active = non-deleted, current org), scoped to the selected book unless Combined ---- */
function budgetInBook(r){ return budgetIsAll()||r.bookId===BUDGET_BOOK; }
function actBudgetCats(){ return (D().budgetCats||[]).filter(function(c){return !c.deleted&&budgetInBook(c);})
  .sort(function(a,b){ return (a.order||0)-(b.order||0) || (a.name||"").localeCompare(b.name||""); }); }
/* transactions in scope, EXCLUDING transfers (which never count as income/spending) */
function actBudgetTx(){ return (D().budgetTx||[]).filter(function(t){return !t.deleted&&!t.isTransfer&&budgetInBook(t);}); }
/* transfers in scope (for the Transactions list display) */
function actBudgetTransfers(){ return (D().budgetTx||[]).filter(function(t){return !t.deleted&&t.isTransfer&&budgetInBook(t);}); }
function budgetCat(id){ return (D().budgetCats||[]).filter(function(c){return !c.deleted;}).find(function(c){return c.id===id;}); }
function budgetCatName(id){ var c=budgetCat(id); return c?c.name:"Uncategorized"; }
function budgetBookName(id){ var b=budgetBook(id); return b?b.name:"—"; }
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
window.budgetSetBook=function(id){ BUDGET_BOOK=id||"__all__"; render(); };

/* the + FAB does the natural "add" for whatever sub-tab is open */
window.budgetFabAdd=function(){
  if(BUDGET_SUB==="settings")openBudgetCat(null);
  else openBudgetTx(null);
};

/* ---- totals (transfers already excluded by actBudgetTx) ---- */
function budgetTxForMonth(m){ return actBudgetTx().filter(function(t){return budgetMonthOf(t.date)===m;}); }
function budgetSum(list,dir){ return list.filter(function(t){return t.dir===dir;}).reduce(function(s,t){return s+(+t.amount||0);},0); }
function budgetRunningBalance(){   // all-time income minus all-time spending (in scope; transfers net out)
  var all=actBudgetTx(); return budgetSum(all,"in")-budgetSum(all,"out");
}
/* actual spent/earned for a category within a month */
function budgetCatActual(catId,m){
  return budgetTxForMonth(m).filter(function(t){return t.catId===catId;}).reduce(function(s,t){return s+(+t.amount||0);},0);
}

/* ---------- main render ---------- */
function rBudget(){
  budgetCurrentBookId();        // clamp selection to a still-existing book
  var sub='<div class="subnav">'
    +'<button class="subbtn '+(BUDGET_SUB==="month"?"on":"")+'" onclick="budgetSetSub(\'month\')">📅 Month</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="tx"?"on":"")+'" onclick="budgetSetSub(\'tx\')">🧾 Transactions</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="settings"?"on":"")+'" onclick="budgetSetSub(\'settings\')">⚙️ Settings</button>'
    +'</div>';
  view.innerHTML=sub+budgetBookBar()+'<div id="budget_body"></div>';
  if(BUDGET_SUB==="tx")budgetRenderTx();
  else if(BUDGET_SUB==="settings")budgetRenderSettings();
  else budgetRenderMonth();
}

/* ---------- book selector bar (header) — pick a book OR All (combined) ---------- */
function budgetBookBar(){
  var books=actBudgetBooks();
  var cur=budgetCurrentBookId();
  var opts='<option value="__all__"'+(budgetIsAll()?" selected":"")+'>📚 All (combined)</option>'
    +books.map(function(b){
      var dot=b.kind==="business"?"🏢":"👤";
      return '<option value="'+b.id+'"'+(cur===b.id?" selected":"")+'>'+dot+' '+esc(b.name)+'</option>';
    }).join("");
  var bk=budgetIsAll()?null:budgetBook(cur);
  var swatch=bk?('<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:'+esc(bk.color||"#1b7f4d")+';margin-right:6px;flex:0 0 auto"></span>'):'';
  return '<div class="card" style="padding:8px 10px"><div class="row" style="gap:8px;align-items:center">'
    +swatch
    +'<select onchange="budgetSetBook(this.value)" style="flex:1">'+opts+'</select>'
    +'</div>'
    +(budgetIsAll()&&books.length>1?'<div class="sub" style="margin-top:5px">Combined view across '+books.length+' books — transfers between books net to zero.</div>':'')
    +'</div>';
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
    +(m===budgetThisMonth()?' · this month':'')
    +(budgetIsAll()?' · all books':' · '+esc(budgetBookName(BUDGET_BOOK)))+'</div></div>';

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
    h+='<div class="empty"><div class="big">💰</div>No categories yet'+(budgetIsAll()?'':' in this book')+'. Add spending + income categories with monthly targets on the <b>Settings</b> tab, then log transactions.</div>';
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
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(c.bookId))+'</span>'):'';
    return '<div class="li" style="align-items:flex-start;flex-direction:column;cursor:pointer" onclick="budgetSetSub(\'tx\')">'
      +'<div class="row" style="width:100%;justify-content:space-between"><div class="nm">'+esc(c.name)+bookTag+'</div>'
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
  var rows=budgetTxForMonth(m);
  /* show transfers in the list too (clearly flagged), so the month's cash moves are visible */
  var xfers=actBudgetTransfers().filter(function(t){return budgetMonthOf(t.date)===m;});
  var all=rows.concat(xfers).sort(function(a,b){ return (b.date||"")<(a.date||"")?-1:((b.date||"")>(a.date||"")?1:(b.updatedAt||0)-(a.updatedAt||0)); });

  var h='<div class="card"><div class="row" style="gap:8px;align-items:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(-1)">‹</button>'
    +'<input type="month" value="'+m+'" onchange="budgetSetMonth(this.value)" style="flex:1;text-align:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(1)">›</button>'
    +'</div></div>';
  h+='<div class="row" style="gap:8px;margin-bottom:10px">'
    +'<button class="btn acc" style="flex:1" onclick="openBudgetTx(null)">＋ Add</button>'
    +'<button class="btn ghost" style="flex:1" onclick="openBudgetTransfer()">⇄ Transfer</button>'
    +'<button class="btn ghost" style="flex:1" onclick="budgetImportOpen()">⬆️ CSV</button></div>';
  h+='<div class="secthd"><h2>'+budgetMonthLabel(m)+'</h2><span class="ct">'+all.length+' '+(all.length===1?"item":"items")+'</span></div>';
  if(!all.length){
    h+='<div class="empty"><div class="big">🧾</div>No transactions this month'+(budgetIsAll()?'':' in this book')+'. Tap <b>Add</b> to log income or spending, or <b>Transfer</b> to move money between books.</div>';
  }else{
    h+='<div class="card" style="padding:6px 10px">'+all.map(function(t){
      if(t.isTransfer)return budgetTransferRow(t);
      var inc=t.dir==="in";
      var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(t.bookId))+'</span>'):'';
      return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openBudgetTx(\''+t.id+'\')">'
        +'<div class="grow"><div class="nm">'+esc(budgetCatName(t.catId))+(t.note?' <span class="sub" style="font-weight:400">· '+esc(t.note)+'</span>':'')+bookTag+'</div>'
        +'<div class="sub">'+esc(fmtDate(t.date))+'</div></div>'
        +'<div style="font-weight:800;color:'+(inc?"var(--ok,#1b7f4d)":"var(--danger)")+'">'+(inc?"+":"−")+budgetMoney(t.amount)+'</div></div>';
    }).join("")+'</div>';
  }
  body.innerHTML=h;
}
/* a transfer leg row (out of one book / in to another) — muted, flagged ⇄, tap to edit the pair */
function budgetTransferRow(t){
  var out=t.dir==="out";
  var other=budgetBookName(t.xferBookId||"");
  var label=out?("Transfer to "+other):("Transfer from "+other);
  var here=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(t.bookId))+'</span>'):'';
  return '<div class="li" style="align-items:flex-start;cursor:pointer;opacity:.85" onclick="openBudgetTransfer(\''+(t.transferId||"")+'\')">'
    +'<div class="grow"><div class="nm">⇄ '+esc(label)+(t.note?' <span class="sub" style="font-weight:400">· '+esc(t.note)+'</span>':'')+here+'</div>'
    +'<div class="sub">'+esc(fmtDate(t.date))+' · transfer</div></div>'
    +'<div style="font-weight:800;color:var(--muted)">'+(out?"−":"+")+budgetMoney(t.amount)+'</div></div>';
}
window.openBudgetTx=function(id){
  var isNew=!id;
  var books=actBudgetBooks();
  var t=isNew?{id:"bgt-tx-"+uid(),date:today(),dir:"out",amount:"",catId:"",note:"",bookId:budgetDefaultBookId()}
             :(D().budgetTx||[]).filter(function(x){return !x.deleted;}).find(function(x){return x.id===id;});
  if(!t)return;
  if(t.isTransfer){ openBudgetTransfer(t.transferId); return; }   // transfers edit via their own dialog
  /* categories available for THIS tx's book (so a tx always pairs with a same-book category) */
  var bid=t.bookId||budgetDefaultBookId();
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===bid;})
    .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
  var dir=t.dir||"out";
  var catOpts='<option value="">— pick a category —</option>'+cats.map(function(c){
    return '<option value="'+c.id+'" data-kind="'+(c.kind||"out")+'" '+(t.catId===c.id?"selected":"")+'>'+esc(c.name)+' ('+((c.kind||"out")==="in"?"income":"spending")+')</option>';
  }).join("");
  var bookSel=books.length>1?('<label>Book</label><select id="bt_book" onchange="budgetTxBookChange(this.value)">'
    +books.map(function(b){return '<option value="'+b.id+'"'+(bid===b.id?" selected":"")+'>'+esc(b.name)+'</option>';}).join("")+'</select>'):'<input type="hidden" id="bt_book" value="'+esc(bid)+'">';
  modal(isNew?"Add transaction":"Edit transaction",''
    +'<div class="row" style="gap:8px;margin-bottom:8px">'
    +'<button class="btn '+(dir==="out"?"danger":"ghost")+'" style="flex:1" onclick="budgetTxDir(this,\'out\')">− Spending</button>'
    +'<button class="btn '+(dir==="in"?"acc":"ghost")+'" style="flex:1" onclick="budgetTxDir(this,\'in\')">＋ Income</button>'
    +'</div><input type="hidden" id="bt_dir" value="'+dir+'">'
    +bookSel
    +'<label>Amount</label><input id="bt_amount" type="number" inputmode="decimal" step="0.01" value="'+esc(t.amount!=null?t.amount:"")+'" placeholder="0.00">'
    +'<label>Category</label><select id="bt_cat">'+catOpts+'</select>'
    +(cats.length?'':'<div class="sub" style="margin:4px 0">No categories in this book yet — add some on the Settings tab. You can still log this; it\'ll show as uncategorized.</div>')
    +'<label>Date</label><input id="bt_date" type="date" value="'+(t.date||today())+'">'
    +'<label>Note (optional)</label><input id="bt_note" value="'+esc(t.note||"")+'" placeholder="e.g. groceries, paycheck">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetTx(\''+t.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetTx(\''+t.id+'\')">Delete</button>')
  );
};
/* switching the book in the tx dialog: re-render so the category list matches the new book */
window.budgetTxBookChange=function(bid){
  var sel=document.getElementById("bt_cat"); if(!sel)return;
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===bid;})
    .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
  sel.innerHTML='<option value="">— pick a category —</option>'+cats.map(function(c){
    return '<option value="'+c.id+'" data-kind="'+(c.kind||"out")+'">'+esc(c.name)+' ('+((c.kind||"out")==="in"?"income":"spending")+')</option>';
  }).join("");
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
  t.bookId=(document.getElementById("bt_book")||{}).value||t.bookId||budgetDefaultBookId();
  t.date=val("bt_date")||today();
  t.note=val("bt_note");
  t.deleted=false; touch(t); if(isNew)d.budgetTx.push(t);
  /* jump the month view to where this txn lives so it's visible after save */
  BUDGET_MONTH=budgetMonthOf(t.date);
  save(); closeModal(); render();
};
window.delBudgetTx=function(id){
  if(!confirm("Delete this transaction?"))return;
  var t=(D().budgetTx||[]).find(function(x){return x.id===id;}); if(!t)return;
  t.deleted=true; touch(t); save(); closeModal(); render();
};

/* ---------- INTER-BOOK TRANSFER — a paired out+in linked by transferId (e.g. owner draw → Personal) ---------- */
window.openBudgetTransfer=function(transferId){
  var books=actBudgetBooks();
  if(books.length<2){ alert("You need at least two books to transfer between them. Add another book on the Settings tab first."); return; }
  var isNew=!transferId;
  var legs=transferId?(D().budgetTx||[]).filter(function(t){return !t.deleted&&t.transferId===transferId;}):[];
  var outLeg=legs.find(function(t){return t.dir==="out";})||{}, inLeg=legs.find(function(t){return t.dir==="in";})||{};
  var fromId=outLeg.bookId||(budgetIsAll()?books[0].id:BUDGET_BOOK);
  var toId=inLeg.bookId||books.find(function(b){return b.id!==fromId;}).id;
  var amount=outLeg.amount!=null?outLeg.amount:"";
  var date=outLeg.date||today();
  var note=outLeg.note||"";
  var bookOpts=function(sel){ return books.map(function(b){return '<option value="'+b.id+'"'+(sel===b.id?" selected":"")+'>'+esc(b.name)+'</option>';}).join(""); };
  modal(isNew?"Transfer between books":"Edit transfer",''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">Move cash from one book to another (e.g. an owner draw from a business to Personal). Transfers don\'t count as income or spending and net to zero in the combined view.</p>'
    +'<label>From book</label><select id="bx_from">'+bookOpts(fromId)+'</select>'
    +'<label>To book</label><select id="bx_to">'+bookOpts(toId)+'</select>'
    +'<label>Amount</label><input id="bx_amount" type="number" inputmode="decimal" step="0.01" value="'+esc(amount)+'" placeholder="0.00">'
    +'<label>Date</label><input id="bx_date" type="date" value="'+date+'">'
    +'<label>Note (optional)</label><input id="bx_note" value="'+esc(note)+'" placeholder="e.g. owner draw, reimburse">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetTransfer(\''+(transferId||"")+'\','+isNew+')">Save transfer</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetTransfer(\''+transferId+'\')">Delete transfer</button>')
  );
};
window.saveBudgetTransfer=function(transferId,isNew){
  var d=D(); if(!d.budgetTx)d.budgetTx=[];
  var from=(document.getElementById("bx_from")||{}).value, to=(document.getElementById("bx_to")||{}).value;
  if(!from||!to||from===to){ alert("Pick two different books to transfer between."); return; }
  var amt=parseFloat(val("bx_amount"));
  if(isNaN(amt)||amt<=0){ alert("Enter an amount greater than zero."); return; }
  amt=Math.round(amt*100)/100;
  var date=val("bx_date")||today(), note=val("bx_note");
  var tid=transferId||("bgt-xfer-"+uid());
  var legs=transferId?d.budgetTx.filter(function(t){return t.transferId===transferId;}):[];
  var outLeg=legs.find(function(t){return t.dir==="out";});
  var inLeg=legs.find(function(t){return t.dir==="in";});
  if(!outLeg){ outLeg={id:"bgt-tx-"+uid(),transferId:tid,isTransfer:true,dir:"out"}; d.budgetTx.push(outLeg); }
  if(!inLeg){ inLeg={id:"bgt-tx-"+uid(),transferId:tid,isTransfer:true,dir:"in"}; d.budgetTx.push(inLeg); }
  outLeg.bookId=from; outLeg.xferBookId=to;   outLeg.amount=amt; outLeg.date=date; outLeg.note=note; outLeg.catId=""; outLeg.deleted=false; touch(outLeg);
  inLeg.bookId=to;    inLeg.xferBookId=from;   inLeg.amount=amt; inLeg.date=date; inLeg.note=note; inLeg.catId="";  inLeg.deleted=false; touch(inLeg);
  BUDGET_MONTH=budgetMonthOf(date);
  save(); closeModal(); render();
};
window.delBudgetTransfer=function(transferId){
  if(!confirm("Delete this transfer (both legs)?"))return;
  (D().budgetTx||[]).filter(function(t){return t.transferId===transferId&&!t.deleted;}).forEach(function(t){ t.deleted=true; touch(t); });
  save(); closeModal(); render();
};

/* ---------- SETTINGS — books + categories + monthly targets + export/backup (decentralized) ---------- */
function budgetRenderSettings(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var cats=actBudgetCats();
  var h=budgetBooksSection();
  h+='<p class="muted" style="margin:12px 4px 8px;font-size:13px">Set up your spending + income categories and a monthly <b>target</b> (your plan) for each. The Month tab compares planned vs actual.'
    +(budgetIsAll()?' Showing categories across <b>all books</b>.':' Showing <b>'+esc(budgetBookName(BUDGET_BOOK))+'</b>.')+'</p>';
  h+='<button class="btn acc" style="width:100%;margin-bottom:10px" onclick="openBudgetCat(null)">＋ New category</button>';

  h+=budgetCatSection("Spending categories","out",cats);
  h+=budgetCatSection("Income categories","in",cats);

  if(!cats.length){
    h+='<div class="empty"><div class="big">⚙️</div>No categories yet'+(budgetIsAll()?'':' in this book')+'. Add spending categories (rent, food, gas…) and income categories (paycheck, side work…).</div>';
  }

  /* import a bank CSV */
  h+='<div class="secthd"><h2>Import</h2></div>';
  h+='<div class="card"><p class="muted" style="margin:0 0 8px;font-size:13px">Import a month of transactions from a bank/card CSV into the selected book: paste or upload, map the columns, then bulk-categorize. Re-importing skips obvious duplicates.</p>'
    +'<button class="btn acc" style="width:100%" onclick="budgetImportOpen()">⬆️ Import CSV</button></div>';

  /* export / backup */
  h+='<div class="secthd"><h2>Backup</h2></div>';
  h+='<div class="card"><p class="muted" style="margin:0 0 8px;font-size:13px">Download a JSON backup of every book, category + transaction, or a CSV of transactions for a spreadsheet.</p>'
    +'<div class="row" style="gap:8px"><button class="btn ghost" style="flex:1" onclick="budgetExport(\'json\')">⬇️ JSON backup</button>'
    +'<button class="btn ghost" style="flex:1" onclick="budgetExport(\'csv\')">⬇️ CSV (txns)</button></div></div>';

  body.innerHTML=h;
}
/* BOOKS management — create / rename / delete / reorder / kind + color */
function budgetBooksSection(){
  var books=actBudgetBooks();
  var h='<div class="secthd"><h2>Books</h2><span class="ct">'+books.length+'</span></div>';
  h+='<p class="muted" style="margin:0 4px 8px;font-size:13px">Each business or personal entity is a <b>book</b>. View one book at a time or All (combined) using the selector at the top.</p>';
  h+='<button class="btn acc" style="width:100%;margin-bottom:8px" onclick="openBudgetBook(null)">＋ New book</button>';
  if(!books.length)return h+'<div class="card"><div class="sub">No books yet.</div></div>';
  h+='<div class="card" style="padding:6px 10px">'+books.map(function(b,i){
    var dot='<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:'+esc(b.color||"#1b7f4d")+';margin-right:8px;flex:0 0 auto"></span>';
    return '<div class="li" style="align-items:center">'
      +dot
      +'<div class="grow" style="cursor:pointer" onclick="openBudgetBook(\''+b.id+'\')"><div class="nm">'+esc(b.name)+'</div>'
      +'<div class="sub">'+(b.kind==="business"?"🏢 business":"👤 personal")+'</div></div>'
      +'<button class="btn ghost sm" '+(i===0?"disabled":"")+' onclick="budgetMoveBook(\''+b.id+'\',-1)" title="Move up">↑</button>'
      +'<button class="btn ghost sm" '+(i===books.length-1?"disabled":"")+' onclick="budgetMoveBook(\''+b.id+'\',1)" title="Move down">↓</button>'
      +'</div>';
  }).join("")+'</div>';
  return h;
}
window.openBudgetBook=function(id){
  var isNew=!id;
  var b=isNew?{id:"bgt-book-"+uid(),name:"",kind:"personal",color:"#1b7f4d"}:budgetBook(id);
  if(!b)return;
  var kind=b.kind||"personal";
  var COLORS=["#1b7f4d","#0099e5","#1B2A4E","#d98a00","#8e44ad","#c0392b","#16a085","#7f8c8d"];
  var swatches=COLORS.map(function(c){
    return '<button type="button" onclick="budgetBookColor(\''+c+'\')" data-color="'+c+'" class="bkcolor" style="width:30px;height:30px;border-radius:6px;background:'+c+';border:3px solid '+((b.color||"#1b7f4d")===c?"var(--ink,#111)":"transparent")+'"></button>';
  }).join(" ");
  modal(isNew?"New book":"Edit book",''
    +'<label>Name</label><input id="bb_name" value="'+esc(b.name||"")+'" placeholder="e.g. Personal · OBX Lot Solutions · Jamieson">'
    +'<label>Type</label><select id="bb_kind">'
    +'<option value="personal" '+(kind==="personal"?"selected":"")+'>👤 Personal</option>'
    +'<option value="business" '+(kind==="business"?"selected":"")+'>🏢 Business</option>'
    +'</select>'
    +'<label>Color</label><input type="hidden" id="bb_color" value="'+esc(b.color||"#1b7f4d")+'">'
    +'<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">'+swatches+'</div>'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetBook(\''+b.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetBook(\''+b.id+'\')">Delete book</button>')
  );
};
window.budgetBookColor=function(c){
  var h=document.getElementById("bb_color"); if(h)h.value=c;
  Array.prototype.forEach.call(document.querySelectorAll(".bkcolor"),function(btn){
    btn.style.border="3px solid "+(btn.getAttribute("data-color")===c?"var(--ink,#111)":"transparent");
  });
};
window.saveBudgetBook=function(id,isNew){
  var d=D(); if(!d.budgetBooks)d.budgetBooks=[];
  var b=isNew?{id:id,order:actBudgetBooks().length}:d.budgetBooks.find(function(x){return x.id===id;});
  if(!b){closeModal();return;}
  b.name=val("bb_name"); if(!b.name){alert("Give the book a name.");return;}
  b.kind=(document.getElementById("bb_kind")||{}).value||"personal";
  b.color=(document.getElementById("bb_color")||{}).value||"#1b7f4d";
  if(b.linkedOrgId==null)b.linkedOrgId="";   // reserved for P5 business-bridge (unused in P0)
  b.deleted=false; touch(b); if(isNew){ d.budgetBooks.push(b); BUDGET_BOOK=b.id; }
  save(); closeModal(); BUDGET_SUB="settings"; render();
};
window.delBudgetBook=function(id){
  var books=actBudgetBooks();
  if(books.length<=1){ alert("You can't delete your only book. Create another book first if you want to replace this one."); return; }
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===id;}).length;
  var tx=(D().budgetTx||[]).filter(function(t){return !t.deleted&&t.bookId===id;}).length;
  if(!confirm("Delete this book?"+((cats||tx)?("\n\nIts "+cats+" categor"+(cats===1?"y":"ies")+" and "+tx+" transaction"+(tx===1?"":"s")+" will also be removed."):"")))return;
  var b=budgetBook(id); if(!b)return;
  /* soft-delete the book and everything filed under it (loss-free LWW: records carry deleted+touch) */
  b.deleted=true; touch(b);
  (D().budgetCats||[]).forEach(function(c){ if(c.bookId===id&&!c.deleted){ c.deleted=true; touch(c); } });
  (D().budgetTx||[]).forEach(function(t){ if(t.bookId===id&&!t.deleted){ t.deleted=true; touch(t); } });
  if(BUDGET_BOOK===id)BUDGET_BOOK="__all__";
  save(); closeModal(); render();
};
window.budgetMoveBook=function(id,dir){
  var books=actBudgetBooks();
  var i=books.findIndex(function(b){return b.id===id;});
  var j=i+dir; if(i<0||j<0||j>=books.length)return;
  var a=books[i], b=books[j];
  var ao=a.order||0, bo=b.order||0;
  a.order=bo; b.order=ao; touch(a); touch(b);
  save(); render();
};
function budgetCatSection(title,kind,cats){
  var list=cats.filter(function(c){return (c.kind||"out")===kind;});
  var planTotal=list.reduce(function(s,c){return s+(+c.target||0);},0);
  var h='<div class="secthd"><h2>'+esc(title)+'</h2>'+(list.length?'<span class="ct">plan '+budgetMoney(planTotal)+'/mo</span>':'')+'</div>';
  if(!list.length)return h+'<div class="card"><div class="sub">None yet.</div></div>';
  h+='<div class="card" style="padding:6px 10px">'+list.map(function(c){
    var bookTag=budgetIsAll()?(' <span class="sub" style="font-weight:400">· '+esc(budgetBookName(c.bookId))+'</span>'):'';
    return '<div class="li" style="cursor:pointer" onclick="openBudgetCat(\''+c.id+'\')">'
      +'<div class="grow"><div class="nm">'+esc(c.name)+bookTag+'</div>'
      +'<div class="sub">'+((+c.target>0)?('target '+budgetMoney(c.target)+'/mo'):'no monthly target')+'</div></div>'
      +'<div class="btn ghost sm">Edit ›</div></div>';
  }).join("")+'</div>';
  return h;
}
window.openBudgetCat=function(id){
  var isNew=!id;
  var books=actBudgetBooks();
  if(isNew&&!books.length){ alert("Create a book first (Settings → Books), then add categories to it."); return; }
  var c=isNew?{id:"bgt-cat-"+uid(),name:"",kind:"out",target:"",bookId:budgetDefaultBookId()}
             :(D().budgetCats||[]).filter(function(x){return !x.deleted;}).find(function(x){return x.id===id;});
  if(!c)return;
  var kind=c.kind||"out";
  var bid=c.bookId||budgetDefaultBookId();
  var bookSel=books.length>1?('<label>Book</label><select id="bc_book">'
    +books.map(function(b){return '<option value="'+b.id+'"'+(bid===b.id?" selected":"")+'>'+esc(b.name)+'</option>';}).join("")+'</select>'):'<input type="hidden" id="bc_book" value="'+esc(bid)+'">';
  modal(isNew?"New category":"Edit category",''
    +bookSel
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
  var c=isNew?{id:id,order:(d.budgetCats||[]).filter(function(x){return !x.deleted;}).length}:d.budgetCats.find(function(x){return x.id===id;});
  if(!c){closeModal();return;}
  c.name=val("bc_name"); if(!c.name){alert("Give the category a name.");return;}
  c.kind=(document.getElementById("bc_kind")||{}).value||"out";
  c.bookId=(document.getElementById("bc_book")||{}).value||c.bookId||budgetDefaultBookId();
  var tgt=parseFloat(val("bc_target")); c.target=(isNaN(tgt)||tgt<0)?0:Math.round(tgt*100)/100;
  c.deleted=false; touch(c); if(isNew)d.budgetCats.push(c);
  save(); closeModal(); BUDGET_SUB="settings"; render();
};
window.delBudgetCat=function(id){
  if(!confirm("Delete this category? Its transactions stay but will show as uncategorized."))return;
  var c=(D().budgetCats||[]).find(function(x){return x.id===id;}); if(!c)return;
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
  /* export the WHOLE org's budget (all books) regardless of the on-screen filter */
  var books=(D().budgetBooks||[]).filter(function(b){return !b.deleted;});
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted;});
  var tx=(D().budgetTx||[]).filter(function(t){return !t.deleted;}).slice().sort(function(a,b){return (a.date||"")<(b.date||"")?-1:1;});
  var bookName=function(id){ var b=books.find(function(x){return x.id===id;}); return b?b.name:""; };
  var catNm=function(id){ var c=cats.find(function(x){return x.id===id;}); return c?c.name:"Uncategorized"; };
  var stamp=today();
  if(fmt==="csv"){
    var head="date,book,direction,amount,category,note,transfer\n";
    var lines=tx.map(function(t){
      var cell=function(s){ s=(s==null?"":String(s)); return /[",\n]/.test(s)?('"'+s.replace(/"/g,'""')+'"'):s; };
      return [t.date,bookName(t.bookId),t.dir,(+t.amount||0).toFixed(2),t.isTransfer?"(transfer)":catNm(t.catId),t.note||"",t.isTransfer?"yes":""].map(cell).join(",");
    }).join("\n");
    budgetDownload("budget-"+stamp+".csv",head+lines,"text/csv");
  }else{
    var out={ exportedAt:stamp, books:books, categories:cats, transactions:tx };
    budgetDownload("budget-backup-"+stamp+".json",JSON.stringify(out,null,2),"application/json");
  }
};
