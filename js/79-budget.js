/* ---------- BUDGET — a personal income/spending + monthly-plan tool, now MULTI-ENTITY via "books" ----------
   Built for Ray's personal organization (rbjvl). Ray's #1 personal priority. Per-org synced collections that
   ride the existing per-record LWW sync exactly like customers:
     - budgetBooks {id,name,kind,linkedOrgId,color,order,updatedAt,deleted}   one ENTITY (a business or Personal)
     - budgetCats  {id,name,kind,target,rollover,bookId,order,updatedAt,deleted}  categories; target=optional GOAL; rollover flag
     - budgetTx    {id,date,amount,catId,note,dir,bookId,isTransfer,transferId,updatedAt,deleted}  one transaction
     - budgetMemo  {id,key,catId,updatedAt,deleted}                            CSV merchant→category memory
     - budgetAccounts {id,bookId,name,type,balance,mask,order,updatedAt,deleted}   P1: real cash accounts (TRUTH for available cash)
     - budgetBudgets  {id,bookId,catId,month,allocated,updatedAt,deleted}          P1: monthly envelope allocations (YNAB "allocated this month")

   P1 = YNAB ZERO-BASED ENVELOPE budgeting on top of P0. Real cash lives in budgetAccounts (manual entry in P1;
   bank-link is P3). To-Be-Budgeted (TBB) = Σ account balances − Σ envelope balances; drive it to zero = give every
   dollar a job. Envelope balance = carryover(prior month) + allocated(this month) − spent(this month); spent = out-txns
   in that cat/book/month (transfers excluded). Positive leftover rolls into next month; overspend goes negative and
   reduces next month's TBB. Per-category `rollover` flag: true → leftover carries (sinking fund), false → resets each
   month (rent). Age-of-Money = derived FIFO days from a dollar arriving to being spent. All per-book + Combined.

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
  if(!Array.isArray(o.budgetAccounts))o.budgetAccounts=[];   // P1 (YNAB): real cash accounts — additive
  if(!Array.isArray(o.budgetBudgets))o.budgetBudgets=[];     // P1 (YNAB): monthly envelope allocations — additive
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

/* ---- P1: accounts (real cash) + budgets (monthly envelope allocations), book-scoped ---- */
function actBudgetAccounts(){ return (D().budgetAccounts||[]).filter(function(a){return !a.deleted&&budgetInBook(a);})
  .sort(function(a,b){ return (a.order||0)-(b.order||0) || (a.name||"").localeCompare(b.name||""); }); }
function budgetAccount(id){ return (D().budgetAccounts||[]).filter(function(a){return !a.deleted;}).find(function(a){return a.id===id;}); }
/* total cash in scope = Σ account balances (credit accounts carry a negative balance — money owed) */
function budgetTotalCash(){ return actBudgetAccounts().reduce(function(s,a){return s+(+a.balance||0);},0); }
/* allocation record for a cat+month (book implied by the cat) */
function budgetAllocRec(catId,m){ return (D().budgetBudgets||[]).filter(function(x){return !x.deleted;})
  .find(function(x){return x.catId===catId&&x.month===m;}); }
function budgetAllocated(catId,m){ var r=budgetAllocRec(catId,m); return r?(+r.allocated||0):0; }
function ACCT_TYPES(){ return [
  {k:"checking",label:"Checking",icon:"🏦"},
  {k:"savings", label:"Savings", icon:"🐖"},
  {k:"cash",    label:"Cash",    icon:"💵"},
  {k:"credit",  label:"Credit card",icon:"💳"}
]; }
function acctTypeMeta(k){ return ACCT_TYPES().find(function(t){return t.k===k;})||ACCT_TYPES()[0]; }

/* ---- ENVELOPE MATH (per book; respects the Combined filter via the *InBook accessors) ----
   spent(cat,month) = Σ out-txns in that cat & month (transfers already excluded by actBudgetTx).
   carryover(cat,month) = running envelope balance at the END of the prior month, but ONLY for rollover cats;
                          a reset (non-rollover) cat starts each month at 0 (overspend still carries as debt).
   envelope balance(cat,month) = carryover + allocated(month) − spent(month).
   To keep this cheap + bounded we walk months from the category's first activity (alloc or tx) up to `month`. */
function budgetCatSpent(catId,m){
  return budgetTxForMonth(m).filter(function(t){return t.catId===catId&&t.dir==="out";})
    .reduce(function(s,t){return s+(+t.amount||0);},0);
}
/* earliest month with any allocation or transaction for a category (for the carryover walk) */
function budgetCatFirstMonth(catId,upto){
  var first=upto;
  (D().budgetBudgets||[]).forEach(function(x){ if(!x.deleted&&x.catId===catId&&x.month&&x.month<first)first=x.month; });
  (D().budgetTx||[]).forEach(function(t){ if(!t.deleted&&!t.isTransfer&&t.catId===catId){ var mm=budgetMonthOf(t.date); if(mm&&mm<first)first=mm; } });
  return first;
}
/* envelope balance available in a cat AT THE END of month m (carryover + allocated − spent, walked forward) */
function budgetEnvelopeBalance(catId,m){
  var cat=budgetCat(catId); var rollover=cat?(cat.rollover!==false):true;   // default rollover = true
  var start=budgetCatFirstMonth(catId,m);
  var bal=0, cur=start, guard=0;
  while(cur<=m && guard<600){
    var carry=bal;
    if(!rollover&&carry>0)carry=0;                 // reset cats drop a POSITIVE leftover each month (overspend debt still carries)
    bal=carry+budgetAllocated(catId,cur)-budgetCatSpent(catId,cur);
    if(cur===m)break;
    cur=budgetShiftMonth(cur,1); guard++;
  }
  return Math.round(bal*100)/100;
}
/* carryover INTO month m = envelope balance at the end of the prior month (rollover-aware) */
function budgetCarryIn(catId,m){
  var cat=budgetCat(catId); var rollover=cat?(cat.rollover!==false):true;
  var prev=budgetShiftMonth(m,-1);
  var c=budgetEnvelopeBalance(catId,prev);
  if(!rollover&&c>0)c=0;
  return Math.round(c*100)/100;
}
/* Σ of every spending envelope's CURRENT balance (end of month m), in scope — the cash that's "spoken for" */
function budgetEnvelopesTotal(m){
  return actBudgetCats().filter(function(c){return (c.kind||"out")==="out";})
    .reduce(function(s,c){ var b=budgetEnvelopeBalance(c.id,m); return s+(b>0?b:0); },0);
}
/* To-Be-Budgeted (in scope) = total cash − Σ positive envelope balances. Drive to zero. */
function budgetTBB(m){ return Math.round((budgetTotalCash()-budgetEnvelopesTotal(m))*100)/100; }

/* ---- AGE OF MONEY (derived, FIFO): for the most-recently spent dollars, how many days since the income
   that funded them arrived. Compute per scope across ALL history up to the end of month m. No new storage. ---- */
function budgetAgeOfMoney(m){
  var end=budgetShiftMonth(m,1)+"-01";   // exclusive upper bound = first of next month
  var tx=actBudgetTx().filter(function(t){ return (t.date||"")<end; })
    .slice().sort(function(a,b){ return (a.date||"")<(b.date||"")?-1:((a.date||"")>(b.date||"")?1:0); });
  var income=tx.filter(function(t){return t.dir==="in";}).map(function(t){return {date:t.date,amt:+t.amount||0};});
  var ages=[], ii=0, rem=income.length?income[0].amt:0;
  function dayDiff(a,b){ return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000); }
  tx.filter(function(t){return t.dir==="out";}).forEach(function(o){
    var need=+o.amount||0;
    while(need>0.0001 && ii<income.length){
      if(rem<=0.0001){ ii++; rem=ii<income.length?income[ii].amt:0; if(ii>=income.length)break; continue; }
      var take=Math.min(need,rem);
      ages.push({d:dayDiff(income[ii].date,o.date),w:take});
      need-=take; rem-=take;
    }
  });
  if(!ages.length)return null;
  var recent=ages.slice(-Math.min(ages.length,40));   // last ~40 fundings (≈ YNAB's rolling window feel)
  var tot=recent.reduce(function(s,a){return s+a.w;},0);
  if(tot<=0)return null;
  var wAvg=recent.reduce(function(s,a){return s+a.d*a.w;},0)/tot;
  return Math.max(0,Math.round(wAvg));
}

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
  else if(BUDGET_SUB==="tax")openTaxProfile();
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
    +'<button class="subbtn '+(BUDGET_SUB==="tax"?"on":"")+'" onclick="budgetSetSub(\'tax\')">🧮 Tax</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="settings"?"on":"")+'" onclick="budgetSetSub(\'settings\')">⚙️ Settings</button>'
    +'</div>';
  /* the Tax sub-tab has its own combined view (one taxpayer) — no per-book bar there */
  view.innerHTML=sub+(BUDGET_SUB==="tax"?"":budgetBookBar())+'<div id="budget_body"></div>';
  if(BUDGET_SUB==="tx")budgetRenderTx();
  else if(BUDGET_SUB==="tax")budgetRenderTax();
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

/* ---------- MONTH — YNAB ENVELOPE view: To-Be-Budgeted + Accounts + per-cat AVAILABLE NOW ---------- */
function budgetRenderMonth(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var m=BUDGET_MONTH||budgetThisMonth();
  var books=actBudgetBooks();

  var h='<div class="card"><div class="row" style="gap:8px;align-items:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(-1)" title="Previous month">‹</button>'
    +'<input type="month" value="'+m+'" onchange="budgetSetMonth(this.value)" style="flex:1;text-align:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(1)" title="Next month">›</button>'
    +'</div><div class="sub" style="text-align:center;margin-top:6px"><b>'+budgetMonthLabel(m)+'</b>'
    +(m===budgetThisMonth()?' · this month':'')
    +(budgetIsAll()?' · all books':' · '+esc(budgetBookName(BUDGET_BOOK)))+'</div></div>';

  if(!books.length){
    h+='<div class="empty"><div class="big">📚</div>No books yet. Create one on the <b>Settings</b> tab, then add an account and categories.</div>';
    body.innerHTML=h; return;
  }

  /* ---- TO BE BUDGETED — the headline. Drive to zero = "give every dollar a job." ---- */
  h+=budgetTBBCard(m);

  /* ---- ACCOUNTS — real cash; the truth for available money ---- */
  h+=budgetAccountsSection();

  /* ---- ENVELOPES — spending categories, each with AVAILABLE NOW + allocate controls ---- */
  var cats=actBudgetCats();
  var aom=budgetAgeOfMoney(m);
  if(aom!=null){
    h+='<div class="card" style="padding:8px 10px;text-align:center"><span class="sub">Age of money</span> '
      +'<b style="font-size:16px">'+aom+' day'+(aom===1?"":"s")+'</b>'
      +'<span class="sub"> — how long your money sits before you spend it</span></div>';
  }
  h+=budgetEnvelopeSection("Envelopes — spending","out",cats,m);
  h+=budgetEnvelopeSection("Income","in",cats,m);

  if(!cats.length){
    h+='<div class="empty"><div class="big">💰</div>No categories yet'+(budgetIsAll()?'':' in this book')+'. Add spending + income categories on the <b>Settings</b> tab, then allocate cash to each envelope.</div>';
  }
  body.innerHTML=h;
}
/* TBB card: total cash − Σ envelope balances, in scope. Green at 0, amber when there's money to assign, red when over. */
function budgetTBBCard(m){
  var cash=budgetTotalCash(), tbb=budgetTBB(m);
  var color=Math.abs(tbb)<0.005?"var(--ok,#1b7f4d)":(tbb>0?"#d98a00":"var(--danger)");
  var msg=Math.abs(tbb)<0.005?"Every dollar has a job. 🎯"
        :(tbb>0?"You have money to assign — give it a job below."
               :"You’ve assigned more than you have. Pull some back.");
  var h='<div class="card" style="text-align:center;border-left:4px solid '+color+'">'
    +'<div class="sub">To Be Budgeted'+(budgetIsAll()?' · all books':'')+'</div>'
    +'<div style="font-weight:800;font-size:30px;color:'+color+'">'+budgetMoney(tbb)+'</div>'
    +'<div class="sub" style="margin-top:2px">'+esc(msg)+'</div>'
    +'<div class="sub" style="margin-top:6px;border-top:1px solid var(--line,#eee);padding-top:6px">Total cash <b>'+budgetMoney(cash)+'</b> − assigned to envelopes <b>'+budgetMoney(cash-tbb)+'</b></div>';
  /* one-tap: fill THIS month's allocations from category targets (only when there's something to fill) */
  var fillable=actBudgetCats().filter(function(c){return (c.kind||"out")==="out"&&(+c.target||0)>0&&budgetAllocated(c.id,m)<(+c.target||0);}).length;
  if(fillable)h+='<button class="btn ghost sm" style="margin-top:8px" onclick="budgetFillFromTargets(\''+m+'\')">⚡ Fill this month from targets</button>';
  return h+'</div>';
}
/* ACCOUNTS section: list balances + add/adjust; inviting empty state (cash 0 until the first account) */
function budgetAccountsSection(){
  var accts=actBudgetAccounts();
  var h='<div class="secthd"><h2>Accounts</h2>'+(accts.length?'<span class="ct">'+budgetMoney(budgetTotalCash())+'</span>':'')+'</div>';
  if(!accts.length){
    h+='<div class="card" style="text-align:center;border:1px dashed var(--line,#ccc)">'
      +'<div style="font-size:24px">🏦</div>'
      +'<div class="sub" style="margin:4px 0 8px">No accounts yet — your cash is <b>$0.00</b>. Add a checking, savings, cash, or credit account to tell the budget how much real money you have to work with.</div>'
      +'<button class="btn acc" onclick="openBudgetAccount(null)">＋ Add an account</button></div>';
    return h;
  }
  h+='<div class="card" style="padding:6px 10px">'+accts.map(function(a){
    var meta=acctTypeMeta(a.type), bal=+a.balance||0;
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(a.bookId))+'</span>'):'';
    return '<div class="li" style="cursor:pointer" onclick="openBudgetAccount(\''+a.id+'\')">'
      +'<div class="grow"><div class="nm">'+meta.icon+' '+esc(a.name)+(a.mask?' <span class="sub" style="font-weight:400">··'+esc(a.mask)+'</span>':'')+bookTag+'</div>'
      +'<div class="sub">'+esc(meta.label)+'</div></div>'
      +'<div style="font-weight:800;color:'+(bal<0?"var(--danger)":"var(--ink,#111)")+'">'+budgetMoney(bal)+'</div></div>';
  }).join("")+'</div>';
  h+='<button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="openBudgetAccount(null)">＋ Add account</button>';
  return h;
}
/* ENVELOPE rows: spending cats show AVAILABLE NOW (envelope balance) + allocate controls + spent + activity */
function budgetEnvelopeSection(title,kind,cats,m){
  var list=cats.filter(function(c){return (c.kind||"out")===kind;});
  if(!list.length)return "";
  if(kind==="in")return budgetIncomeSection(list,m);
  var allocTotal=list.reduce(function(s,c){return s+budgetAllocated(c.id,m);},0);
  var h='<div class="secthd"><h2>'+esc(title)+'</h2>'+(allocTotal>0?'<span class="ct">assigned '+budgetMoney(allocTotal)+'</span>':'')+'</div>';
  h+='<div class="card" style="padding:6px 10px">'+list.map(function(c){
    var avail=budgetEnvelopeBalance(c.id,m), alloc=budgetAllocated(c.id,m), spent=budgetCatSpent(c.id,m), carry=budgetCarryIn(c.id,m);
    var target=+c.target||0;
    var availColor=avail<-0.005?"var(--danger)":(avail<0.005?"var(--muted)":"var(--ok,#1b7f4d)");
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(c.bookId))+'</span>'):'';
    var meta='';
    if(carry>0.005||carry<-0.005)meta+='carry '+budgetMoney(carry)+' · ';
    meta+='assigned '+budgetMoney(alloc)+' · spent '+budgetMoney(spent);
    if(target>0)meta+=' · goal '+budgetMoney(target);
    if(c.rollover===false)meta+=' · resets';
    return '<div class="li" style="align-items:flex-start;flex-direction:column">'
      +'<div class="row" style="width:100%;justify-content:space-between;align-items:flex-start">'
      +'<div class="grow" style="cursor:pointer" onclick="budgetOpenCatTx(\''+c.id+'\')"><div class="nm">'+esc(c.name)+bookTag+'</div>'
      +'<div class="sub">'+esc(meta)+'</div></div>'
      +'<div style="text-align:right;flex:0 0 auto"><div class="sub">available</div>'
      +'<div style="font-weight:800;font-size:17px;color:'+availColor+'">'+budgetMoney(avail)+'</div></div></div>'
      +'<div class="row" style="gap:6px;width:100%;margin-top:6px">'
      +'<button class="btn ghost sm" onclick="budgetAlloc(\''+c.id+'\',\''+m+'\',-1)" title="Take $10 back">−</button>'
      +'<button class="btn ghost sm" onclick="budgetAlloc(\''+c.id+'\',\''+m+'\',1)" title="Add $10">＋</button>'
      +'<button class="btn ghost sm" style="flex:1" onclick="budgetAllocSet(\''+c.id+'\',\''+m+'\')">Set…</button>'
      +(target>0&&alloc<target?'<button class="btn ghost sm" onclick="budgetAllocToTarget(\''+c.id+'\',\''+m+'\')" title="Assign up to the goal">→ goal</button>':'')
      +'</div></div>';
  }).join("")+'</div>';
  /* uncategorized spending for this month */
  var uncat=budgetTxForMonth(m).filter(function(t){return t.dir==="out"&&!budgetCat(t.catId);});
  if(uncat.length){
    var uTot=uncat.reduce(function(s,t){return s+(+t.amount||0);},0);
    h+='<div class="sub" style="margin:4px 8px 0">Uncategorized spending: <b>'+budgetMoney(uTot)+'</b> ('+uncat.length+') — categorize on the Transactions tab.</div>';
  }
  return h;
}
function budgetIncomeSection(list,m){
  var inc=budgetSum(budgetTxForMonth(m),"in");
  var h='<div class="secthd"><h2>Income</h2>'+(inc>0?'<span class="ct">'+budgetMoney(inc)+' in</span>':'')+'</div>';
  h+='<div class="card" style="padding:6px 10px">'+list.map(function(c){
    var got=budgetCatActual(c.id,m), target=+c.target||0;
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(c.bookId))+'</span>'):'';
    return '<div class="li" style="cursor:pointer" onclick="budgetOpenCatTx(\''+c.id+'\')">'
      +'<div class="grow"><div class="nm">'+esc(c.name)+bookTag+'</div>'
      +'<div class="sub">'+(target>0?'expected '+budgetMoney(target):'income')+'</div></div>'
      +'<div style="font-weight:800;color:var(--ok,#1b7f4d)">'+budgetMoney(got)+'</div></div>';
  }).join("")+'</div>'
    +'<div class="sub" style="margin:4px 8px 0">Income lands in <b>To Be Budgeted</b> — assign it to envelopes above.</div>';
  return h;
}
/* tap an envelope → jump to its transactions for the month */
window.budgetOpenCatTx=function(catId){ var c=budgetCat(catId); if(c&&c.bookId)BUDGET_BOOK=c.bookId; budgetSetSub("tx"); };

/* ---------- ALLOCATION — write/adjust a budgetBudgets {bookId,catId,month,allocated} record ---------- */
function budgetSetAllocation(catId,m,amount){
  var c=budgetCat(catId); if(!c)return;
  amount=Math.round((+amount||0)*100)/100;
  var d=D(); if(!d.budgetBudgets)d.budgetBudgets=[];
  var r=d.budgetBudgets.find(function(x){return !x.deleted&&x.catId===catId&&x.month===m;});
  if(!r){ r={id:"bgt-alloc-"+uid(),bookId:c.bookId,catId:catId,month:m,allocated:amount,deleted:false}; d.budgetBudgets.push(r); }
  else { r.allocated=amount; r.bookId=c.bookId; r.deleted=false; }
  touch(r); save();
}
window.budgetAlloc=function(catId,m,sign){
  var cur=budgetAllocated(catId,m);
  var next=Math.max(0,Math.round((cur+sign*10)*100)/100);   // quick ±$10
  budgetSetAllocation(catId,m,next); render();
};
window.budgetAllocSet=function(catId,m){
  var c=budgetCat(catId); if(!c)return;
  var cur=budgetAllocated(catId,m);
  var v=prompt("Assign to “"+c.name+"” for "+budgetMonthLabel(m)+" (dollars):",cur||"");
  if(v==null)return;
  var n=parseFloat(v); if(isNaN(n)||n<0){ alert("Enter a number ≥ 0."); return; }
  budgetSetAllocation(catId,m,n); render();
};
window.budgetAllocToTarget=function(catId,m){
  var c=budgetCat(catId); if(!c)return;
  budgetSetAllocation(catId,m,+c.target||0); render();
};
/* one-tap: top up every spending envelope's allocation to its target for this month (never lowers an over-target alloc) */
window.budgetFillFromTargets=function(m){
  var cats=actBudgetCats().filter(function(c){return (c.kind||"out")==="out"&&(+c.target||0)>0;});
  var todo=cats.filter(function(c){return budgetAllocated(c.id,m)<(+c.target||0);});
  if(!todo.length){ alert("Every envelope is already funded to its goal for "+budgetMonthLabel(m)+"."); return; }
  if(!confirm("Assign cash so each spending envelope hits its monthly goal for "+budgetMonthLabel(m)+"?\n\n"+todo.length+" envelope"+(todo.length===1?"":"s")+" will be topped up. To Be Budgeted will drop accordingly."))return;
  todo.forEach(function(c){ budgetSetAllocation(c.id,m,+c.target||0); });
  render();
};

/* ---------- ACCOUNTS — real cash per book; manual entry/adjust in P1 ---------- */
window.openBudgetAccount=function(id){
  var isNew=!id;
  var books=actBudgetBooks();
  if(isNew&&!books.length){ alert("Create a book first (Settings → Books), then add an account to it."); return; }
  var a=isNew?{id:"bgt-acct-"+uid(),name:"",type:"checking",balance:"",mask:"",bookId:budgetDefaultBookId()}
             :budgetAccount(id);
  if(!a)return;
  var bid=a.bookId||budgetDefaultBookId();
  var typeOpts=ACCT_TYPES().map(function(t){return '<option value="'+t.k+'"'+((a.type||"checking")===t.k?" selected":"")+'>'+t.icon+' '+t.label+'</option>';}).join("");
  var bookSel=books.length>1?('<label>Book</label><select id="ba_book">'
    +books.map(function(b){return '<option value="'+b.id+'"'+(bid===b.id?" selected":"")+'>'+esc(b.name)+'</option>';}).join("")+'</select>'):'<input type="hidden" id="ba_book" value="'+esc(bid)+'">';
  modal(isNew?"Add account":"Edit account",''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">Enter the real balance — this is the cash the budget works from. (Bank-link comes later; for now keep it current by hand.)</p>'
    +bookSel
    +'<label>Name</label><input id="ba_name" value="'+esc(a.name||"")+'" placeholder="e.g. Checking · Savings · Wallet · Visa">'
    +'<label>Type</label><select id="ba_type">'+typeOpts+'</select>'
    +'<label>Current balance</label><input id="ba_balance" type="number" inputmode="decimal" step="0.01" value="'+esc(a.balance!=null&&a.balance!==""?a.balance:"")+'" placeholder="0.00">'
    +'<div class="sub" style="margin:4px 0">For a credit card, enter what you OWE as a negative number (e.g. −250).</div>'
    +'<label>Last 4 (optional)</label><input id="ba_mask" value="'+esc(a.mask||"")+'" placeholder="1234" maxlength="4" inputmode="numeric">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetAccount(\''+a.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetAccount(\''+a.id+'\')">Delete account</button>')
  );
};
window.saveBudgetAccount=function(id,isNew){
  var d=D(); if(!d.budgetAccounts)d.budgetAccounts=[];
  var a=isNew?{id:id,order:(d.budgetAccounts||[]).filter(function(x){return !x.deleted;}).length}:d.budgetAccounts.find(function(x){return x.id===id;});
  if(!a){closeModal();return;}
  a.name=val("ba_name"); if(!a.name){alert("Give the account a name.");return;}
  a.type=(document.getElementById("ba_type")||{}).value||"checking";
  a.bookId=(document.getElementById("ba_book")||{}).value||a.bookId||budgetDefaultBookId();
  var bal=parseFloat(val("ba_balance")); a.balance=isNaN(bal)?0:Math.round(bal*100)/100;
  a.mask=(val("ba_mask")||"").replace(/[^0-9]/g,"").slice(0,4);
  a.deleted=false; touch(a); if(isNew)d.budgetAccounts.push(a);
  save(); closeModal(); render();
};
window.delBudgetAccount=function(id){
  if(!confirm("Delete this account? Its balance no longer counts toward your cash. (Transactions stay.)"))return;
  var a=budgetAccount(id); if(!a)return;
  a.deleted=true; touch(a); save(); closeModal(); render();
};

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
  h+='<p class="muted" style="margin:12px 4px 8px;font-size:13px">Set up your spending + income categories. Each spending category is an <b>envelope</b> you assign cash to on the Month tab; an optional monthly <b>goal</b> powers the one-tap fill.'
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
  var h='<div class="secthd"><h2>'+esc(title)+'</h2>'+(list.length&&planTotal>0?'<span class="ct">goals '+budgetMoney(planTotal)+'/mo</span>':'')+'</div>';
  if(!list.length)return h+'<div class="card"><div class="sub">None yet.</div></div>';
  h+='<div class="card" style="padding:6px 10px">'+list.map(function(c){
    var bookTag=budgetIsAll()?(' <span class="sub" style="font-weight:400">· '+esc(budgetBookName(c.bookId))+'</span>'):'';
    var sub=(+c.target>0)?('goal '+budgetMoney(c.target)+'/mo'):'no monthly goal';
    if((c.kind||"out")==="out"&&c.rollover===false)sub+=' · resets';
    return '<div class="li" style="cursor:pointer" onclick="openBudgetCat(\''+c.id+'\')">'
      +'<div class="grow"><div class="nm">'+esc(c.name)+bookTag+'</div>'
      +'<div class="sub">'+sub+'</div></div>'
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
    +'<label>Monthly goal (optional)</label><input id="bc_target" type="number" inputmode="decimal" step="0.01" value="'+esc(c.target!=null&&c.target!==""?c.target:"")+'" placeholder="0.00 — how much you aim to fund this each month">'
    +'<div class="sub" style="margin:4px 0">A goal just powers the “fill from goal” shortcut on the Month tab — you still assign cash to the envelope yourself.</div>'
    +(kind==="out"?('<label class="row" style="gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="bc_rollover" '+((c.rollover!==false)?"checked":"")+' style="width:auto"> Roll leftover into next month</label>'
      +'<div class="sub" style="margin:2px 0 0">On = a sinking fund (savings build up). Off = resets each month (e.g. rent — unused cash goes back to To Be Budgeted).</div>'):'')
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
  var roll=document.getElementById("bc_rollover");
  c.rollover=(c.kind==="out")?(roll?!!roll.checked:(c.rollover!==false)):true;   // income cats: rollover flag irrelevant
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
    var accounts=(D().budgetAccounts||[]).filter(function(a){return !a.deleted;});
    var budgets=(D().budgetBudgets||[]).filter(function(x){return !x.deleted;});
    var out={ exportedAt:stamp, books:books, categories:cats, transactions:tx, accounts:accounts, budgets:budgets };
    budgetDownload("budget-backup-"+stamp+".json",JSON.stringify(out,null,2),"application/json");
  }
};

/* ============================================================================================================
   P2 — CONTRACTOR (1099) TAX SET-ASIDE. One taxpayer: ALL business-book net flows to one 1040, so we estimate on
   COMBINED business net (income − expenses; transfers excluded) regardless of the on-screen book filter. The math
   lives in js/82-tax-estimator.js (pure, node-tested). Here: the taxProfile record, the business-net rollup, the
   Tax set-aside ENVELOPE auto-fund, the quarterly card, and the combined "not really yours" view.
   FRAME: an ESTIMATE, not tax advice. 25% is only the fallback; Ray's real rate is well under it (low net + child
   credits) and he can override the rate open-endedly. ============================================================ */

/* ---- taxProfile: ONE settings record per org. Defaults = Ray's profile (NC, MFJ, no spouse income, 3 kids). ---- */
function taxProfileId(){ return "bgt-tax-"+S.biz; }
function taxProfileRec(){ return (D().budgetTax||[]).filter(function(r){return !r.deleted;}).find(function(r){return r.id===taxProfileId();}); }
function taxProfile(){
  var r=taxProfileRec()||{};
  return {
    filing: r.filing||"mfj",
    state: r.state||"NC",
    spouseIncome: (+r.spouseIncome||0),
    dependents: (r.dependents!=null?(+r.dependents||0):3),
    overrideRate: (r.overrideRate!=null&&r.overrideRate!=="")?(+r.overrideRate):null
  };
}
function saveTaxProfile(p){
  var d=D(); if(!d.budgetTax)d.budgetTax=[];
  var r=d.budgetTax.find(function(x){return x.id===taxProfileId();});
  if(!r){ r={id:taxProfileId()}; d.budgetTax.push(r); }
  r.filing=p.filing; r.state=p.state; r.spouseIncome=p.spouseIncome; r.dependents=p.dependents;
  r.overrideRate=(p.overrideRate==null||p.overrideRate==="")?null:p.overrideRate;
  r.deleted=false; touch(r); save();
}

/* ---- COMBINED BUSINESS NET — across ALL business-kind books (ignores the book filter; one taxpayer). Transfers
   already excluded (D().budgetTx isTransfer flagged). Returns net for a date predicate. ---- */
function taxBusinessBookIds(){ return (D().budgetBooks||[]).filter(function(b){return !b.deleted&&b.kind==="business";}).map(function(b){return b.id;}); }
function taxBusinessNet(fromDate,toDate){
  var ids=taxBusinessBookIds(); if(!ids.length)return 0;
  var net=0;
  (D().budgetTx||[]).forEach(function(t){
    if(t.deleted||t.isTransfer)return;
    if(ids.indexOf(t.bookId)<0)return;
    var dt=t.date||"";
    if(fromDate&&dt<fromDate)return;
    if(toDate&&dt>toDate)return;
    net+=(t.dir==="in"?1:-1)*(+t.amount||0);
  });
  return Math.round(net*100)/100;
}
function taxYearOf(m){ return parseInt(String(m||budgetThisMonth()).slice(0,4),10)||new Date().getFullYear(); }
function taxBusinessNetMonth(m){ return taxBusinessNet(m+"-01",m+"-31"); }
function taxBusinessNetYTD(year){ return taxBusinessNet(year+"-01-01",year+"-12-31"); }
/* annualized projection from YTD: scale by 12/monthsElapsed (only meaningful mid-year; clamp ≥1 month) */
function taxAnnualizedNet(year){
  var ytd=taxBusinessNetYTD(year);
  var now=new Date(); var curY=now.getFullYear();
  var monthsElapsed=(year<curY)?12:(year>curY?1:(now.getMonth()+1));
  if(monthsElapsed<1)monthsElapsed=1;
  return Math.round(ytd*(12/monthsElapsed)*100)/100;
}

/* ---- the estimate (annualized) for the displayed year, using the live profile ---- */
function taxEstimate(year){ return estimateAnnualTax(taxAnnualizedNet(year), taxProfile()); }
/* effective reserve rate to apply to a month's net (override wins; else computed from the annualized estimate). */
function taxReserveRate(year){ var e=taxEstimate(year); return e.effectiveRate; }

/* ---- TAX SET-ASIDE ENVELOPE — a special spending category (stable per-org id) on the default Personal book.
   Auto-fund a month = set its allocation to (that month's combined business net × effective reserve rate).
   Allocating to it removes those dollars from To-Be-Budgeted = the reserve is a real funded envelope. ---- */
function taxEnvelopeId(){ return "bgt-cat-tax-"+S.biz; }
function taxEnvelopeCat(){ return (D().budgetCats||[]).filter(function(c){return !c.deleted;}).find(function(c){return c.id===taxEnvelopeId();}); }
function ensureTaxEnvelope(){
  var c=taxEnvelopeCat(); if(c)return c;
  var d=D(); if(!d.budgetCats)d.budgetCats=[];
  c={id:taxEnvelopeId(),name:"Tax set-aside",kind:"out",target:0,rollover:true,taxEnvelope:true,
     bookId:budgetDefaultBookId(),order:-1,deleted:false};
  touch(c); d.budgetCats.push(c); save();
  return c;
}
/* fund THIS month's tax envelope to (month business net × rate). Never lowers below what's already there unless
   the user opts to true-up exactly. Returns the dollar amount funded. */
function taxFundMonth(m,exact){
  var rate=taxReserveRate(taxYearOf(m));
  var net=taxBusinessNetMonth(m);
  var want=Math.max(0,Math.round(net*rate*100)/100);   // a loss month wants $0 added (never negative)
  ensureTaxEnvelope();
  var cur=budgetAllocated(taxEnvelopeId(),m);
  var next=exact?want:Math.max(cur,want);
  budgetSetAllocation(taxEnvelopeId(),m,next);
  return next;
}
window.taxFundThisMonth=function(m){
  var net=taxBusinessNetMonth(m);
  if(net<=0){ alert("No business net to reserve against for "+budgetMonthLabel(m)+" (a loss month reserves $0)."); return; }
  taxFundMonth(m,false); render();
};
window.taxTrueUpMonth=function(m){
  if(!confirm("Set this month's Tax set-aside exactly to (this month's business net × your reserve rate)? This can raise OR lower the current allocation."))return;
  taxFundMonth(m,true); render();
};

/* YTD reserved (Σ allocations to the tax envelope this calendar year) vs YTD estimated owed */
function taxYtdReserved(year){
  var sum=0;
  (D().budgetBudgets||[]).forEach(function(x){ if(!x.deleted&&x.catId===taxEnvelopeId()&&String(x.month||"").slice(0,4)===String(year))sum+=(+x.allocated||0); });
  return Math.round(sum*100)/100;
}
/* YTD estimated owed = YTD business net × the effective rate (what should be reserved so far) */
function taxYtdOwed(year){ return Math.round(taxBusinessNetYTD(year)*taxReserveRate(year)*100)/100; }

/* ---------- TAX render: profile summary · estimate breakdown · Tax envelope · quarterly card · combined reserve ---------- */
function budgetRenderTax(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var m=BUDGET_MONTH||budgetThisMonth();
  var year=taxYearOf(m);
  var bizBooks=taxBusinessBookIds();
  var p=taxProfile();
  var est=taxEstimate(year);
  var ytdNet=taxBusinessNetYTD(year), annNet=taxAnnualizedNet(year), moNet=taxBusinessNetMonth(m);
  var rate=est.effectiveRate;
  var pct=function(r){ return (Math.round(r*1000)/10).toFixed(1)+"%"; };

  var h='<div class="card"><div class="row" style="gap:8px;align-items:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(-1)" title="Previous month">‹</button>'
    +'<input type="month" value="'+m+'" onchange="budgetSetMonth(this.value)" style="flex:1;text-align:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(1)" title="Next month">›</button>'
    +'</div><div class="sub" style="text-align:center;margin-top:6px"><b>Tax set-aside · '+year+'</b> · combined across all business books (one taxpayer)</div></div>';

  h+='<div class="card" style="border-left:4px solid #8e44ad"><p class="muted" style="margin:0;font-size:13px">'
    +'<b>Estimate — not tax advice.</b> All your businesses’ 1099 net flows to one 1040, so this estimates SE + federal (MFJ, child credits) + NC state on your <b>combined business net</b>. Heavy expenses + child credits keep your real rate well under 25%. Adjust your profile or override the rate anytime.</p></div>';

  if(!bizBooks.length){
    h+='<div class="empty"><div class="big">🧮</div>No <b>business</b> books yet. On the Settings tab, set a book’s type to <b>Business</b> — its net income drives your tax reserve. (Personal books don’t count toward 1099 tax.)</div>';
    body.innerHTML=h; return;
  }

  /* ---- PROFILE summary + edit ---- */
  h+='<div class="secthd"><h2>Your tax profile</h2><span class="ct" style="cursor:pointer" onclick="openTaxProfile()">Edit ›</span></div>';
  h+='<div class="card" style="padding:8px 10px"><div class="sub">'
    +'Filing <b>'+(p.filing==="mfj"?"Married filing jointly":esc(p.filing).toUpperCase())+'</b> · State <b>'+esc(p.state)+'</b> · '
    +'Spouse income <b>'+budgetMoney(p.spouseIncome)+'</b> · Dependent kids <b>'+p.dependents+'</b>'
    +(p.overrideRate!=null?(' · <b style="color:#8e44ad">manual rate '+pct(p.overrideRate)+'</b>'):'')
    +'</div></div>';

  /* ---- the headline reserve rate ---- */
  var rateColor=p.overrideRate!=null?"#8e44ad":"var(--ok,#1b7f4d)";
  h+='<div class="card" style="text-align:center;border-left:4px solid '+rateColor+'">'
    +'<div class="sub">Effective reserve rate'+(p.overrideRate!=null?" (manual override)":" (estimated)")+'</div>'
    +'<div style="font-weight:800;font-size:34px;color:'+rateColor+'">'+pct(rate)+'</div>'
    +'<div class="sub" style="margin-top:2px">of business net — set aside this share of every business dollar</div>'
    +'<button class="btn ghost sm" style="margin-top:8px" onclick="openTaxRate()">Override the rate…</button>'
    +(p.overrideRate!=null?' <button class="btn ghost sm" style="margin-top:8px" onclick="taxClearOverride()">Use estimate ('+pct(est.computedRate)+')</button>':'')
    +'</div>';

  /* ---- breakdown (annualized) — transparent, line by line ---- */
  h+='<div class="secthd"><h2>Estimate breakdown</h2><span class="ct">annualized</span></div>';
  h+='<div class="card" style="padding:8px 10px">'
    +taxLine("Combined business net (annualized)",budgetMoney(annNet),true)
    +'<div class="sub" style="margin:2px 0 8px">YTD net '+budgetMoney(ytdNet)+' projected to a full year.</div>'
    +taxLine("Self-employment tax (15.3% on 92.35%)",budgetMoney(est.se))
    +taxLine("Federal income tax (MFJ, after child credit)",budgetMoney(est.federal))
    +'<div class="sub" style="margin:0 0 6px;padding-left:2px">before credits '+budgetMoney(est.federalBeforeCredits)+' − child tax credit '+budgetMoney(est.childCredit)+' ('+p.dependents+' × $2,000)</div>'
    +taxLine("NC state income tax (4.25% flat)",budgetMoney(est.state))
    +'<div style="border-top:1px solid var(--line,#eee);margin-top:6px;padding-top:6px">'
    +taxLine("Total estimated tax",budgetMoney(est.totalTax),true)
    +taxLine("Effective rate (tax ÷ business net)",pct(est.computedRate),true)
    +'</div></div>';

  /* ---- THIS MONTH's reserve → the Tax set-aside envelope ---- */
  var envAlloc=budgetAllocated(taxEnvelopeId(),m);
  var moWant=Math.max(0,Math.round(moNet*rate*100)/100);
  h+='<div class="secthd"><h2>'+budgetMonthLabel(m)+' set-aside</h2></div>';
  h+='<div class="card" style="padding:10px">'
    +taxLine("This month’s business net",budgetMoney(moNet))
    +taxLine("× reserve rate "+pct(rate)+" =",budgetMoney(moWant),true)
    +'<div class="sub" style="margin:6px 0">Funded into the <b>Tax set-aside</b> envelope: <b>'+budgetMoney(envAlloc)+'</b>'
    +(Math.abs(envAlloc-moWant)>0.005?' — '+(envAlloc<moWant?'short '+budgetMoney(moWant-envAlloc):'over '+budgetMoney(envAlloc-moWant)):' ✓ on target')+'</div>'
    +'<div class="row" style="gap:8px">'
    +'<button class="btn acc" style="flex:1" onclick="taxFundThisMonth(\''+m+'\')">💧 Fund to '+budgetMoney(moWant)+'</button>'
    +'<button class="btn ghost" style="flex:1" onclick="taxTrueUpMonth(\''+m+'\')">True-up exactly</button>'
    +'</div>'
    +'<div class="sub" style="margin-top:6px">Funding moves dollars OUT of To-Be-Budgeted into the tax envelope — that’s the reserve. You only “spend” it when you pay the IRS.</div>'
    +'</div>';

  /* ---- QUARTERLY CARD ---- */
  h+=taxQuarterlyCard(year);

  /* ---- COMBINED "this isn't really yours" reserve vs cash ---- */
  var reservedNow=budgetEnvelopeBalance(taxEnvelopeId(),m);   // current balance in the tax envelope
  var allCash=(D().budgetAccounts||[]).filter(function(a){return !a.deleted;}).reduce(function(s,a){return s+(+a.balance||0);},0);
  h+='<div class="secthd"><h2>Reserve vs cash</h2></div>';
  h+='<div class="card" style="text-align:center;border-left:4px solid #c0392b">'
    +'<div class="sub">In the Tax set-aside envelope (not really yours)</div>'
    +'<div style="font-weight:800;font-size:26px;color:#c0392b">'+budgetMoney(reservedNow<0?0:reservedNow)+'</div>'
    +'<div class="sub" style="margin-top:4px;border-top:1px solid var(--line,#eee);padding-top:6px">Total cash across all books <b>'+budgetMoney(allCash)+'</b> · truly yours <b>'+budgetMoney(allCash-(reservedNow<0?0:reservedNow))+'</b></div>'
    +'</div>';

  body.innerHTML=h;
}
function taxLine(label,value,strong){
  return '<div class="row" style="justify-content:space-between;align-items:baseline;margin:2px 0">'
    +'<span class="'+(strong?"":"sub")+'"'+(strong?' style="font-weight:600"':'')+'>'+esc(label)+'</span>'
    +'<span style="font-weight:'+(strong?"800":"600")+'">'+value+'</span></div>';
}
/* QUARTERLY: reserve $X by [next due]; YTD reserved vs YTD owed; on-track / behind. */
function taxQuarterlyCard(year){
  var due=nextQuarterlyDue(today());
  var ytdReserved=taxYtdReserved(year), ytdOwed=taxYtdOwed(year);
  var behind=Math.round((ytdOwed-ytdReserved)*100)/100;
  var onTrack=behind<=0.005;
  var color=onTrack?"var(--ok,#1b7f4d)":"#d98a00";
  var h='<div class="secthd"><h2>Quarterly estimate</h2></div>';
  h+='<div class="card" style="border-left:4px solid '+color+'">'
    +'<div class="sub">Next federal quarterly due</div>'
    +'<div style="font-weight:800;font-size:18px">'+esc(due.label)+' · '+esc(fmtDate(due.due))+'</div>'
    +'<div class="sub" style="margin-top:8px;border-top:1px solid var(--line,#eee);padding-top:8px">'
    +'YTD reserved <b>'+budgetMoney(ytdReserved)+'</b> · YTD estimated owed <b>'+budgetMoney(ytdOwed)+'</b></div>'
    +'<div style="font-weight:700;color:'+color+';margin-top:4px">'
    +(onTrack?'✓ On track'+(ytdReserved-ytdOwed>0.005?' — '+budgetMoney(ytdReserved-ytdOwed)+' ahead':''):'⚠ Behind by '+budgetMoney(behind)+' — fund the tax envelope to catch up')
    +'</div>'
    +'<div class="sub" style="margin-top:6px">Estimated payments are due Apr 15, Jun 15, Sep 15, and Jan 15. This is a planning estimate — confirm amounts with your CPA / 1040-ES.</div>'
    +'</div>';
  return h;
}

/* ---------- profile + rate editors ---------- */
window.openTaxProfile=function(){
  var p=taxProfile();
  modal("Tax profile",''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">Defaults match your situation. This drives the estimate — it’s not a tax filing.</p>'
    +'<label>Filing status</label><select id="tp_filing">'
    +'<option value="mfj"'+(p.filing==="mfj"?" selected":"")+'>Married filing jointly</option>'
    +'<option value="single"'+(p.filing==="single"?" selected":"")+'>Single (approx — uses MFJ figures)</option>'
    +'</select>'
    +'<label>State</label><input id="tp_state" value="'+esc(p.state)+'" maxlength="2" style="text-transform:uppercase" placeholder="NC">'
    +'<div class="sub" style="margin:2px 0">State tax is modeled as NC flat 4.25%. Other states approximate.</div>'
    +'<label>Spouse income (W-2, if any)</label><input id="tp_spouse" type="number" inputmode="decimal" step="100" value="'+(p.spouseIncome||"")+'" placeholder="0">'
    +'<label>Dependent children</label><input id="tp_deps" type="number" inputmode="numeric" step="1" min="0" value="'+p.dependents+'" placeholder="3">'
    +'<div class="sub" style="margin:2px 0">Each qualifying child = up to a $2,000 child tax credit.</div>'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveTaxProfileForm()">Save profile</button>'
  );
};
window.saveTaxProfileForm=function(){
  var cur=taxProfile();
  var sp=parseFloat(val("tp_spouse")); var dep=parseInt(val("tp_deps"),10);
  saveTaxProfile({
    filing:(document.getElementById("tp_filing")||{}).value||"mfj",
    state:(val("tp_state")||"NC").toUpperCase().slice(0,2),
    spouseIncome:isNaN(sp)?0:Math.max(0,sp),
    dependents:isNaN(dep)?0:Math.max(0,dep),
    overrideRate:cur.overrideRate   // keep any existing rate override
  });
  closeModal(); render();
};
window.openTaxRate=function(){
  var p=taxProfile(); var est=taxEstimate(taxYearOf(BUDGET_MONTH||budgetThisMonth()));
  var cur=p.overrideRate!=null?(Math.round(p.overrideRate*1000)/10):"";
  modal("Override reserve rate",''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">The estimate suggests <b>'+(Math.round(est.computedRate*1000)/10).toFixed(1)+'%</b>. Set your own rate (open-ended — no floor). Leave blank to use the estimate.</p>'
    +'<label>Reserve rate (%)</label><input id="tp_rate" type="number" inputmode="decimal" step="0.5" min="0" value="'+cur+'" placeholder="e.g. 18">'
    +'<div class="sub" style="margin:4px 0">Set aside this % of every business dollar. 25% is just the operating-agreement fallback — your real rate is likely lower.</div>'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveTaxRate()">Save rate</button>'
    +'<button class="btn ghost" style="margin-top:10px" onclick="closeModal();taxClearOverride()">Clear (use estimate)</button>'
  );
};
window.saveTaxRate=function(){
  var v=val("tp_rate"); var p=taxProfile();
  var rate=(v==="")?null:(parseFloat(v)/100);
  if(rate!=null&&(isNaN(rate)||rate<0)){ alert("Enter a percentage ≥ 0, or leave blank."); return; }
  saveTaxProfile({filing:p.filing,state:p.state,spouseIncome:p.spouseIncome,dependents:p.dependents,overrideRate:rate});
  closeModal(); render();
};
window.taxClearOverride=function(){
  var p=taxProfile();
  saveTaxProfile({filing:p.filing,state:p.state,spouseIncome:p.spouseIncome,dependents:p.dependents,overrideRate:null});
  render();
};
