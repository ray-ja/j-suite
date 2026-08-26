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
  if(!Array.isArray(o.budgetBills))o.budgetBills=[];         // v2: recurring/scheduled bills linked to a category — additive
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
/* transactions in scope, EXCLUDING transfers + card payments (neither counts as income/spending — they only move cash) */
/* t.pending = a receipt scan (js/121) that has been read but not confirmed yet. Excluded HERE, at the one
   accessor every total/envelope/TBB/tax figure flows through, so an unconfirmed scan can never move a number. */
/* ⚠️ SPLITS (js/148): a split parent carries the whole payment but NO category — its slices carry the
   money into the envelopes. Count both and every split is doubled. So income/spending sees the SLICES and
   skips the parent. The mirror rule lives in acctTx() in js/145, where the BALANCE counts the parent and
   skips the slices, because the cash left the account exactly once. Change one, check the other. */
/* ⚠️ MATCHED ROWS (js/152): a bank row linked to an expense he already logged is the CASH CONFIRMATION
   of that record, not a second expense. Counted here it doubles the purchase. ⭐ But acctTx() in js/145
   must still count it — the cash really did leave the bank. Third time this shape appears; get the
   balance side backwards and his reconciliation drifts by every matched purchase, silently, forever. */
function actBudgetTx(){ return (D().budgetTx||[]).filter(function(t){return !t.deleted&&!t.pending&&!t.isTransfer&&!t.isCardPayment&&!t.isSplit&&!(t.matchedTo&&t.matchedTo.id)&&budgetInBook(t);}); }
/* transfers + card payments in scope (for the Transactions list display) */
function actBudgetTransfers(){ return (D().budgetTx||[]).filter(function(t){return !t.deleted&&(t.isTransfer||t.isCardPayment)&&budgetInBook(t);}); }
function budgetCat(id){ return (D().budgetCats||[]).filter(function(c){return !c.deleted;}).find(function(c){return c.id===id;}); }
function budgetCatName(id){ var c=budgetCat(id); return c?c.name:"Uncategorized"; }
function budgetBookName(id){ var b=budgetBook(id); return b?b.name:"—"; }
/* merchant→category memory (budgetMemo): {id,key,catId,updatedAt,deleted}; key = normalized description keyword */
function actBudgetMemo(){ return (D().budgetMemo||[]).filter(function(m){return !m.deleted;}); }

/* ---- P1: accounts (real cash) + budgets (monthly envelope allocations), book-scoped ---- */
function actBudgetAccounts(){ return (D().budgetAccounts||[]).filter(function(a){return !a.deleted&&budgetInBook(a);})
  .sort(function(a,b){ return (a.order||0)-(b.order||0) || (a.name||"").localeCompare(b.name||""); }); }
function budgetAccount(id){ return (D().budgetAccounts||[]).filter(function(a){return !a.deleted;}).find(function(a){return a.id===id;}); }

/* ============================================================================================================
   BUDGET v2 — YNAB CREDIT-CARD + DEBT (cards Ray USES) + debt-payoff (cards he OWES on). Built on P1 accounts.
   A credit account carries a NEGATIVE balance = debt owed. Two flavors of credit account:
     • a card he USES → full YNAB credit-card flow (spend funds a "Payment: <card>" envelope; balance grows; pay it down).
     • debtOnly:true → a card/loan he OWES on but doesn't use → no spend flow, just a balance to pay down.
   ADDITIVE, MIGRATION-SAFE — no new collections. New account fields default empty/false:
     apr (decimal %, e.g. 24.99), minPayment ($), creditLimit ($), debtOnly (bool).
   New budgetTx field: accountId = the PAYMENT SOURCE (which account the money came from). Empty = legacy/unassigned
   (behaves exactly as before P1). A spend with accountId on a CREDIT account = a charge to that card.
   CARD PAYMENT = a budgetTx with isCardPayment:true, accountId=<checking source>, cardId=<credit acct>, dir:"out".
   Like a transfer it is EXCLUDED from income/spending totals; it moves cash to the card (debt → 0) and draws the
   card's Payment envelope down. All math below is DERIVED (no side-effect records) — keeps the round-trip loss-free.

   THE MECHANIC, exactly:
     1. Charge $X to card C, category Food: Food's envelope draws down $X (spent += X, same as cash). Up to the
        amount Food HAD available, that $X moves INTO C's Payment envelope (cash now set aside to pay C). C's live
        balance goes $X more negative. If Food was underfunded, only the funded portion moves to the Payment
        envelope — the unfunded (overspent) portion stays as debt you DIDN'T budget for → it reduces TBB (classic
        YNAB "you spent money you hadn't budgeted").
     2. Pay card C $Y from Checking: Checking cash −$Y, C's debt +$Y toward zero, C's Payment envelope drawn −$Y.
   Payment-envelope available(C) = Σ(funded portion of charges to C) + Σ(manual allocations to it) − Σ(payments to C). */

/* a credit-type account that is NOT debtOnly = a card he actively uses (full payment-envelope flow) */
function budgetIsActiveCard(a){ return a&&a.type==="credit"&&!a.debtOnly; }
/* charges put ON a card (spends whose accountId is that credit account); excludes transfers/payments */
function budgetCardCharges(acctId){
  return (D().budgetTx||[]).filter(function(t){ return !t.deleted&&!t.isTransfer&&!t.isCardPayment&&t.dir==="out"&&t.accountId===acctId; });
}
function budgetCardChargesTotal(acctId){ return budgetCardCharges(acctId).reduce(function(s,t){return s+(+t.amount||0);},0); }
/* payments made TO a card (cash → card; reduces debt). isCardPayment legs carry cardId=<the card> + accountId=<source cash acct> */
function budgetCardPayments(acctId){
  return (D().budgetTx||[]).filter(function(t){ return !t.deleted&&t.isCardPayment&&t.cardId===acctId; });
}
function budgetCardPaymentsTotal(acctId){ return budgetCardPayments(acctId).reduce(function(s,t){return s+(+t.amount||0);},0); }
/* payments SOURCED FROM a (cash) account — they reduce its real cash */
function budgetCardPaymentsFrom(acctId){
  return (D().budgetTx||[]).filter(function(t){ return !t.deleted&&t.isCardPayment&&t.accountId===acctId; })
    .reduce(function(s,t){return s+(+t.amount||0);},0);
}
/* LIVE balance of any account. Credit: stored(debt, negative) − charges + payments. Cash: stored − card-payments sourced here. */
function budgetAccountBalance(a){
  if(!a)return 0;
  /* ⭐ RECONCILED ACCOUNTS DERIVE THEIR BALANCE (js/145): checkpoint + every approved transaction since.
     ⚠️ Guarded on balanceDate so an account he has never reconciled behaves EXACTLY as it always has —
     14 call sites read this function, and changing its meaning for existing records would have silently
     moved To-Be-Budgeted, every envelope and every cash total in one commit. */
  if(a.balanceDate&&typeof acctBalanceAt==="function")return acctBalanceAt(a,null);
  var stored=+a.balance||0;
  if(a.type==="credit") return Math.round((stored-budgetCardChargesTotal(a.id)+budgetCardPaymentsTotal(a.id))*100)/100;
  return Math.round((stored-budgetCardPaymentsFrom(a.id))*100)/100;
}
/* SPENDABLE cash in scope = Σ LIVE balances of NON-credit accounts. Credit-card debt is NOT spendable cash; it is
   represented entirely by its Payment envelope (YNAB model) — so it never inflates To-Be-Budgeted. */
function budgetTotalCash(){ return Math.round(actBudgetAccounts().filter(function(a){return a.type!=="credit";})
  .reduce(function(s,a){return s+budgetAccountBalance(a);},0)*100)/100; }
/* total DEBT in scope = Σ |live balance| of every credit account (active cards + debtOnly), as a positive number */
function budgetTotalDebt(){ return Math.round(actBudgetAccounts().filter(function(a){return a.type==="credit";})
  .reduce(function(s,a){ var b=budgetAccountBalance(a); return s+(b<0?-b:0); },0)*100)/100; }
/* allocation record for a cat+month (book implied by the cat) */
function budgetAllocRec(catId,m){ return (D().budgetBudgets||[]).filter(function(x){return !x.deleted;})
  .find(function(x){return x.catId===catId&&x.month===m;}); }
function budgetAllocated(catId,m){ var r=budgetAllocRec(catId,m); return r?(+r.allocated||0):0; }
/* ---- PAYMENT ENVELOPE per active card: a special spending category creditAccountId=<card>, stable id. ----
   Its AVAILABLE = funded inflow from charges + manual allocations − payments made to the card. This is the cash
   you've set aside to pay this card; paying the card draws it down. */
function paymentCatId(acctId){ return "bgt-cat-cardpay-"+acctId; }
function budgetPaymentCat(acctId){ return (D().budgetCats||[]).filter(function(c){return !c.deleted;}).find(function(c){return c.creditAccountId===acctId||c.id===paymentCatId(acctId);}); }
/* ensure a Payment envelope category exists for a card (same book as the card; rollover; flagged paymentEnvelope) */
function ensurePaymentCat(a){
  if(!a||a.type!=="credit"||a.debtOnly)return null;
  var c=budgetPaymentCat(a.id); if(c){ if(c.deleted){c.deleted=false;touch(c);} return c; }
  var d=D(); if(!d.budgetCats)d.budgetCats=[];
  c={id:paymentCatId(a.id),name:"Payment: "+(a.name||"Card"),kind:"out",target:0,rollover:true,
     paymentEnvelope:true,creditAccountId:a.id,bookId:a.bookId||budgetDefaultBookId(),order:-2,deleted:false};
  touch(c); d.budgetCats.push(c); save();
  return c;
}
/* keep every active card's Payment envelope present + named (idempotent; called on render) */
function ensureAllPaymentCats(){
  (D().budgetAccounts||[]).filter(function(a){return !a.deleted&&budgetIsActiveCard(a);}).forEach(function(a){
    var c=ensurePaymentCat(a); if(c&&c.name!=="Payment: "+(a.name||"Card")){ c.name="Payment: "+(a.name||"Card"); touch(c); }
    if(c&&c.bookId!==a.bookId){ c.bookId=a.bookId; touch(c); }
  });
}
/* a spending category is "regular" (user-facing) when it is NOT a payment envelope or the tax envelope */
function budgetIsRegularSpend(c){ return c&&(c.kind||"out")==="out"&&!c.paymentEnvelope&&!c.taxEnvelope; }
/* FUNDED inflow into a card's Payment envelope from charges: each charge contributes up to what its spending
   category had AVAILABLE at the charge's month (the funded portion). Underfunded (overspent) credit purchases
   contribute nothing here → that debt was never budgeted (it shows as reduced TBB via the envelope going negative). */
function budgetPaymentFundedInflow(cardId){
  var charges=budgetCardCharges(cardId);
  if(!charges.length)return 0;
  // group charges by spending category + month, cap each (cat,month) group's inflow by that envelope's funded spend
  var byKey={};
  charges.forEach(function(t){
    var cat=budgetCat(t.catId); if(!cat||!budgetIsRegularSpend(cat))return;   // uncategorized/payment/tax charges fund nothing
    var k=t.catId+"|"+budgetMonthOf(t.date);
    (byKey[k]=byKey[k]||{catId:t.catId,m:budgetMonthOf(t.date),amt:0}).amt+=(+t.amount||0);
  });
  var funded=0;
  Object.keys(byKey).forEach(function(k){
    var g=byKey[k];
    // available in that envelope BEFORE this month's spending = carryover-in + this month's allocation
    var avail=budgetCarryIn(g.catId,g.m)+budgetAllocated(g.catId,g.m);
    if(avail<0)avail=0;
    funded+=Math.min(g.amt,avail);   // only the covered portion of the charges moves to the payment envelope
  });
  return Math.round(funded*100)/100;
}
/* AVAILABLE in a card's Payment envelope (current) = funded inflow + manual allocations − payments made to the card */
function budgetPaymentEnvelopeAvailable(cardId){
  var alloc=0;
  (D().budgetBudgets||[]).forEach(function(x){ if(!x.deleted&&x.catId===paymentCatId(cardId))alloc+=(+x.allocated||0); });
  var v=budgetPaymentFundedInflow(cardId)+alloc-budgetCardPaymentsTotal(cardId);
  return Math.round(v*100)/100;
}

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
  var cat=budgetCat(catId);
  if(cat&&cat.paymentEnvelope&&cat.creditAccountId) return budgetPaymentEnvelopeAvailable(cat.creditAccountId);  // special derived (funded inflow + allocs − payments)
  var rollover=cat?(cat.rollover!==false):true;   // default rollover = true
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
/* Σ of every spending envelope's POSITIVE balance (end of month m), in scope — cash "spoken for" (incl. Payment envelopes) */
function budgetEnvelopesTotal(m){
  return actBudgetCats().filter(function(c){return (c.kind||"out")==="out";})
    .reduce(function(s,c){ var b=budgetEnvelopeBalance(c.id,m); return s+(b>0?b:0); },0);
}
/* Σ of NEGATIVE (overspent) balances across regular spending envelopes — the classic YNAB "you spent money you
   hadn't budgeted." Overspending on a CREDIT card lands here (cash didn't move) and so reduces To-Be-Budgeted. */
function budgetOverspendTotal(m){
  return actBudgetCats().filter(function(c){return budgetIsRegularSpend(c);})
    .reduce(function(s,c){ var b=budgetEnvelopeBalance(c.id,m); return s+(b<0?-b:0); },0);
}
/* To-Be-Budgeted (in scope) = spendable cash − Σ positive envelope balances − Σ overspending. Drive to zero. */
function budgetTBB(m){ return Math.round((budgetTotalCash()-budgetEnvelopesTotal(m)-budgetOverspendTotal(m))*100)/100; }

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
  else if(BUDGET_SUB==="bills")openBudgetBill(null);      // adding on the Bills tab = add a recurring bill
  else if(BUDGET_SUB==="debts")openBudgetAccount(null);   // adding on the Debts tab = add a credit-card/debt account
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
  ensureAllPaymentCats();       // every active credit card has its auto-managed "Payment: <card>" envelope
  /* ⭐ REVIEW COMES FIRST, and only exists when something is waiting. Ray, 2026-08-25: "everything needs
     approvals. like ynab." A queue you have to go looking for is a queue that never empties — and until
     he approves them those rows are in NO total anywhere, so they have to be visible. */
  var _pend=(typeof ledgerInboxCount==="function")?ledgerInboxCount():0;
  if(_pend&&BUDGET_SUB==="review"){} else if(!_pend&&BUDGET_SUB==="review")BUDGET_SUB="tx";
  var sub='<div class="subnav">'
    +(_pend?('<button class="subbtn '+(BUDGET_SUB==="review"?"on":"")+'" onclick="budgetSetSub(\'review\')">📥 Review <span class="badge" style="background:var(--danger);color:#fff;margin-left:4px">'+_pend+'</span></button>'):'')
    +'<button class="subbtn '+(BUDGET_SUB==="month"?"on":"")+'" onclick="budgetSetSub(\'month\')">📅 Month</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="tx"?"on":"")+'" onclick="budgetSetSub(\'tx\')">🧾 Transactions</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="bills"?"on":"")+'" onclick="budgetSetSub(\'bills\')">🔁 Bills</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="debts"?"on":"")+'" onclick="budgetSetSub(\'debts\')">💳 Debts</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="stmt"?"on":"")+'" onclick="budgetSetSub(\'stmt\')">📊 Statements</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="tax"?"on":"")+'" onclick="budgetSetSub(\'tax\')">🧮 Tax</button>'
    +'<button class="subbtn '+(BUDGET_SUB==="settings"?"on":"")+'" onclick="budgetSetSub(\'settings\')">⚙️ Settings</button>'
    +'</div>';
  /* the Tax sub-tab has its own combined view (one taxpayer) — no per-book bar there */
  var _pf=(typeof pfCardHTML==="function")?pfCardHTML():"";   // the file hand-off, moved off Today
  view.innerHTML=sub+(BUDGET_SUB==="tax"?"":budgetBookBar())+_pf+'<div id="budget_body"></div>';
  if(BUDGET_SUB==="review"&&typeof rLedgerReview==="function"){document.getElementById("budget_body").innerHTML=rLedgerReview();}
  else if(BUDGET_SUB==="tx")budgetRenderTx();
  else if(BUDGET_SUB==="bills")budgetRenderBills();
  else if(BUDGET_SUB==="debts")budgetRenderDebts();
  else if(BUDGET_SUB==="stmt"&&typeof stmtHTML==="function"){document.getElementById("budget_body").innerHTML=stmtHTML();}
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
  h+=budgetBillsMonthCard(m);
  h+=budgetEnvelopeSection("Envelopes — spending","out",cats,m);
  h+=budgetPaymentEnvelopesCard(m);
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
    var meta=acctTypeMeta(a.type), bal=budgetAccountBalance(a);   // LIVE balance (credit reflects charges + payments)
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(a.bookId))+'</span>'):'';
    var sub=esc(meta.label)+(a.type==="credit"?(a.debtOnly?" · debt only":""):"");
    return '<div class="li" style="cursor:pointer" onclick="openBudgetAccount(\''+a.id+'\')">'
      +'<div class="grow"><div class="nm">'+meta.icon+' '+esc(a.name)+(a.mask?' <span class="sub" style="font-weight:400">··'+esc(a.mask)+'</span>':'')+bookTag+'</div>'
      +'<div class="sub">'+sub+'</div></div>'
      +'<div style="font-weight:800;color:'+(bal<0?"var(--danger)":"var(--ink,#111)")+'">'+budgetMoney(bal)+'</div></div>';
  }).join("")+'</div>';
  var debt=budgetTotalDebt();
  if(debt>0.005)h+='<div class="sub" style="margin:4px 8px 0">💳 Credit-card debt <b style="color:var(--danger)">'+budgetMoney(debt)+'</b> — see the <span style="cursor:pointer;text-decoration:underline" onclick="budgetSetSub(\'debts\')">Debts</span> tab to pay it down. (Card debt is shown separately, not as spendable cash.)</div>';
  h+='<button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="openBudgetAccount(null)">＋ Add account</button>';
  return h;
}
/* ENVELOPE rows: spending cats show AVAILABLE NOW (envelope balance) + allocate controls + spent + activity */
function budgetEnvelopeSection(title,kind,cats,m){
  var list=cats.filter(function(c){return (c.kind||"out")===kind&&!c.paymentEnvelope;});   // Payment envelopes render in their own card
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

/* ---------- CREDIT-CARD PAYMENT ENVELOPES card (Month view) — one per active card he uses ---------- */
function budgetPaymentEnvelopesCard(m){
  var cards=actBudgetAccounts().filter(function(a){return budgetIsActiveCard(a);});
  if(!cards.length)return "";
  var h='<div class="secthd"><h2>Credit-card payments</h2><span class="ct" style="cursor:pointer" onclick="budgetSetSub(\'debts\')">Debts ›</span></div>';
  h+='<div class="card" style="padding:6px 10px">'+cards.map(function(a){
    var avail=budgetPaymentEnvelopeAvailable(a.id);   // cash set aside to pay this card
    var owed=-budgetAccountBalance(a);                 // positive = debt owed
    var col=avail<-0.005?"var(--danger)":(avail<0.005?"var(--muted)":"var(--ok,#1b7f4d)");
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(a.bookId))+'</span>'):'';
    return '<div class="li" style="align-items:flex-start;flex-direction:column">'
      +'<div class="row" style="width:100%;justify-content:space-between;align-items:flex-start">'
      +'<div class="grow"><div class="nm">💳 '+esc(a.name)+bookTag+'</div>'
      +'<div class="sub">owed '+budgetMoney(owed>0?owed:0)+' · budgeted to pay '+budgetMoney(avail)+'</div></div>'
      +'<div style="text-align:right;flex:0 0 auto"><div class="sub">to pay</div>'
      +'<div style="font-weight:800;font-size:17px;color:'+col+'">'+budgetMoney(avail)+'</div></div></div>'
      +'<div class="row" style="gap:6px;width:100%;margin-top:6px">'
      +'<button class="btn ghost sm" style="flex:1" onclick="budgetAllocSet(\''+paymentCatId(a.id)+'\',\''+m+'\')" title="Set aside more cash to pay this card">Set aside…</button>'
      +(owed>0.005?'<button class="btn acc sm" style="flex:1" onclick="openCardPayment(\''+a.id+'\')">Pay this card</button>':'')
      +'</div></div>';
  }).join("")+'</div>'
    +'<div class="sub" style="margin:4px 8px 0">Spending on a card moves that cash here automatically. Paying the card draws this down + shrinks the balance.</div>';
  return h;
}

/* ---------- DEBTS — payoff view: every credit + debtOnly account, total debt, utilization, snowball/avalanche ---------- */
function budgetRenderDebts(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var debts=actBudgetAccounts().filter(function(a){return a.type==="credit";});
  var h='';
  if(!debts.length){
    h+='<div class="empty"><div class="big">💳</div>No credit cards or debts yet. On the <b>Month</b> tab (Accounts) add a <b>Credit card</b> — a card you <b>use</b> gets the full YNAB payment flow; tick <b>Debt only</b> for a card/loan you just owe on and want to pay down.</div>';
    body.innerHTML=h; return;
  }
  /* total debt headline */
  var total=budgetTotalDebt();
  var minTotal=debts.reduce(function(s,a){return s+(+a.minPayment||0);},0);
  h+='<div class="card" style="text-align:center;border-left:4px solid var(--danger)">'
    +'<div class="sub">Total debt'+(budgetIsAll()?' · all books':'')+'</div>'
    +'<div style="font-weight:800;font-size:30px;color:var(--danger)">'+budgetMoney(total)+'</div>'
    +'<div class="sub" style="margin-top:4px">across '+debts.length+' account'+(debts.length===1?'':'s')
    +(minTotal>0?(' · minimum payments '+budgetMoney(minTotal)+'/mo'):'')+'</div></div>';

  /* ⭐ what it COSTS and what extra buys (js/147) — the ordering advice below says which card first, this
     says how long, how much interest, and what one more slice a month would do. */
  if(typeof debtPromoHTML==="function")h+=debtPromoHTML();
  if(typeof debtPlanHTML==="function")h+='<div id="debt_plan">'+debtPlanHTML()+'</div>';

  /* snowball (smallest balance first) vs avalanche (highest APR first) ordering suggestion */
  var owed=function(a){ var b=budgetAccountBalance(a); return b<0?-b:0; };
  var withDebt=debts.filter(function(a){return owed(a)>0.005;});
  var snowball=withDebt.slice().sort(function(x,y){ return owed(x)-owed(y); });
  var avalanche=withDebt.slice().sort(function(x,y){ return (+y.apr||0)-(+x.apr||0); });
  if(withDebt.length>1){
    h+='<div class="secthd"><h2>Payoff order</h2></div>';
    h+='<div class="card" style="padding:8px 10px">'
      +'<div class="sub" style="margin-bottom:4px"><b>❄️ Snowball</b> (smallest balance first — fastest wins):</div>'
      +'<div style="margin-bottom:8px">'+snowball.map(function(a,i){return (i+1)+'. '+esc(a.name)+' '+budgetMoney(owed(a));}).join('<br>')+'</div>'
      +'<div class="sub" style="margin-bottom:4px"><b>🏔️ Avalanche</b> (highest APR first — least interest):</div>'
      +'<div>'+avalanche.map(function(a,i){var apr=+a.apr||0;return (i+1)+'. '+esc(a.name)+(apr>0?' @ '+apr+'%':' (no APR set)');}).join('<br>')+'</div>'
      +'</div>';
  }

  /* per-account detail: balance, limit/utilization, APR, min payment, payoff timeline, Make a payment */
  h+='<div class="secthd"><h2>Accounts</h2></div>';
  h+=debts.map(function(a){
    var bal=budgetAccountBalance(a), debt=bal<0?-bal:0;
    var limit=+a.creditLimit||0, util=(limit>0)?(debt/limit):null;
    var apr=+a.apr||0, minp=+a.minPayment||0;
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(a.bookId))+'</span>'):'';
    var pay=budgetIsActiveCard(a)?budgetPaymentEnvelopeAvailable(a.id):null;
    var months=budgetPayoffMonths(debt,apr,minp);
    var h2='<div class="card" style="padding:10px">'
      +'<div class="row" style="justify-content:space-between;align-items:flex-start">'
      +'<div class="grow"><div class="nm">💳 '+esc(a.name)+(a.debtOnly?' <span class="sub" style="font-weight:400">· debt only</span>':'')+bookTag+'</div>'
      +'<div class="sub">'+(apr>0?apr+'% APR':'no APR set')+(minp>0?' · min '+budgetMoney(minp)+'/mo':'')+'</div></div>'
      +'<div style="text-align:right;flex:0 0 auto"><div class="sub">owed</div>'
      +'<div style="font-weight:800;font-size:18px;color:var(--danger)">'+budgetMoney(debt)+'</div></div></div>';
    if(util!=null){
      var uc=util>0.7?"var(--danger)":(util>0.3?"#d98a00":"var(--ok,#1b7f4d)");
      h2+='<div style="margin-top:8px"><div class="sub">utilization '+Math.round(util*100)+'% of '+budgetMoney(limit)+' limit</div>'
        +'<div style="height:7px;border-radius:4px;background:var(--line,#eee);overflow:hidden;margin-top:3px"><div style="height:100%;width:'+Math.min(100,Math.round(util*100))+'%;background:'+uc+'"></div></div></div>';
    }
    if(pay!=null&&pay>0.005)h2+='<div class="sub" style="margin-top:6px">Set aside to pay: <b style="color:var(--ok,#1b7f4d)">'+budgetMoney(pay)+'</b></div>';
    if(debt>0.005&&months!=null)h2+='<div class="sub" style="margin-top:6px">At '+budgetMoney(minp)+'/mo'+(apr>0?' & '+apr+'% APR':'')+': paid off in <b>~'+months+' month'+(months===1?'':'s')+'</b>'+(months>=600?' (min barely covers interest — pay more)':'')+'</div>';
    else if(debt>0.005&&minp<=0)h2+='<div class="sub" style="margin-top:6px">Set a minimum payment to estimate a payoff timeline.</div>';
    h2+='<div class="row" style="gap:6px;margin-top:8px">';
    if(debt>0.005)h2+='<button class="btn acc sm" style="flex:1" onclick="openCardPayment(\''+a.id+'\')">＋ Make a payment</button>';
    h2+='<button class="btn ghost sm" style="flex:1" onclick="openBudgetAccount(\''+a.id+'\')">Edit card</button></div>';
    return h2+'</div>';
  }).join("");
  body.innerHTML=h;
}
/* estimate months to pay off a balance at a fixed monthly payment + APR. null if no payment; cap at 600 (≈never). */
function budgetPayoffMonths(balance,aprPct,monthly){
  balance=+balance||0; if(balance<=0)return 0;
  monthly=+monthly||0; if(monthly<=0)return null;
  var r=(+aprPct||0)/100/12;
  if(r<=0)return Math.min(600,Math.ceil(balance/monthly));
  if(monthly<=balance*r)return 600;                 // payment doesn't even cover the interest
  var n=Math.log(monthly/(monthly-balance*r))/Math.log(1+r);
  return Math.min(600,Math.max(1,Math.ceil(n)));
}

/* ---------- MAKE A PAYMENT — cash from a checking/savings/cash account → pay down a card (reduces debt + draws
   the card's Payment envelope). Stored as a budgetTx isCardPayment:true {accountId:<source>, cardId:<card>, dir:out}. ---------- */
window.openCardPayment=function(cardId){
  var card=budgetAccount(cardId); if(!card){ alert("Card not found."); return; }
  var sources=actBudgetAccounts().filter(function(a){return a.type!=="credit"&&!a.deleted;});
  if(!sources.length){ alert("Add a checking/savings/cash account first — that's where the payment comes from."); return; }
  var owed=-budgetAccountBalance(card); if(owed<0)owed=0;
  var setAside=budgetIsActiveCard(card)?budgetPaymentEnvelopeAvailable(cardId):null;
  var srcOpts=sources.map(function(a){return '<option value="'+a.id+'">'+esc(a.name)+' — '+budgetMoney(budgetAccountBalance(a))+'</option>';}).join("");
  var suggest=setAside!=null&&setAside>0?Math.min(setAside,owed):owed;
  modal("Pay "+esc(card.name),''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">Move cash to pay this card down. Reduces the card balance toward $0'
    +(setAside!=null?' and draws its Payment envelope':'')+'.</p>'
    +'<div class="sub" style="margin-bottom:6px">Owed <b>'+budgetMoney(owed)+'</b>'+(setAside!=null?(' · set aside to pay <b>'+budgetMoney(setAside)+'</b>'):'')+'</div>'
    +'<label>Pay from</label><select id="cp_src">'+srcOpts+'</select>'
    +'<label>Amount</label><input id="cp_amount" type="number" inputmode="decimal" step="0.01" value="'+(suggest>0?suggest.toFixed(2):"")+'" placeholder="0.00">'
    +'<label>Date</label><input id="cp_date" type="date" value="'+today()+'">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveCardPayment(\''+cardId+'\')">Pay card</button>'
  );
};
window.saveCardPayment=function(cardId){
  var card=budgetAccount(cardId); if(!card){ closeModal(); return; }
  var src=(document.getElementById("cp_src")||{}).value;
  if(!src){ alert("Pick an account to pay from."); return; }
  var amt=parseFloat(val("cp_amount"));
  if(isNaN(amt)||amt<=0){ alert("Enter an amount greater than zero."); return; }
  amt=Math.round(amt*100)/100;
  var d=D(); if(!d.budgetTx)d.budgetTx=[];
  var pay={ id:"bgt-pay-"+uid(), date:val("cp_date")||today(), dir:"out", amount:amt,
            isCardPayment:true, cardId:cardId, accountId:src, bookId:card.bookId||budgetDefaultBookId(),
            note:"Payment to "+(card.name||"card"), catId:"", deleted:false };
  touch(pay); d.budgetTx.push(pay);
  BUDGET_MONTH=budgetMonthOf(pay.date);
  save(); closeModal(); render();
};

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
  var isCredit=(a.type==="credit");
  var live=(!isNew&&a.type==="credit")?budgetAccountBalance(a):null;
  /* credit-only fields (APR / min payment / limit / debt-only) — shown when type=credit; toggled live by ba_type onchange */
  var creditBox='<div id="ba_credit" style="display:'+(isCredit?"block":"none")+'">'
    +'<label>APR % (optional)</label><input id="ba_apr" type="number" inputmode="decimal" step="0.01" value="'+esc(a.apr!=null&&a.apr!==""?a.apr:"")+'" placeholder="e.g. 24.99">'
    +'<label>Minimum payment $/mo (optional)</label><input id="ba_minpay" type="number" inputmode="decimal" step="0.01" value="'+esc(a.minPayment!=null&&a.minPayment!==""?a.minPayment:"")+'" placeholder="e.g. 35">'
    +'<label>Credit limit $ (optional)</label><input id="ba_limit" type="number" inputmode="decimal" step="0.01" value="'+esc(a.creditLimit!=null&&a.creditLimit!==""?a.creditLimit:"")+'" placeholder="e.g. 5000">'
    /* ⚠️ A PROMO RATE IS A DIFFERENT CARD AFTER ITS DATE. His Citi is 0% until 2026-09-24 and 28.24%
       after — a payoff plan that assumed 0% forever would rank it LAST right as it becomes the most
       expensive thing he owns. */
    +'<label>Promo rate ends (optional)</label><input id="ba_promountil" type="date" value="'+esc(a.promoUntil||"")+'">'
    +'<label>Promo APR % until then</label><input id="ba_promoapr" type="number" inputmode="decimal" step="0.01" value="'+esc(a.promoApr!=null&&a.promoApr!==""?a.promoApr:"")+'" placeholder="0">'
    +'<label class="row" style="gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="ba_debtonly" '+(a.debtOnly?"checked":"")+' style="width:auto"> Debt only — I owe on it but don\'t use it</label>'
    +'<div class="sub" style="margin:2px 0 0">Debt-only cards/loans skip the spending flow — they just show up in <b>Debts</b> to pay down.</div></div>';
  modal(isNew?"Add account":"Edit account",''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">Enter the real balance — this is the cash the budget works from. (Bank-link comes later; for now keep it current by hand.)</p>'
    +bookSel
    +'<label>Name</label><input id="ba_name" value="'+esc(a.name||"")+'" placeholder="e.g. Checking · Savings · Wallet · Visa">'
    +'<label>Type</label><select id="ba_type" onchange="budgetAccountTypeChange(this.value)">'+typeOpts+'</select>'
    +'<label>'+(isCredit?"Balance owed":"Current balance")+'</label><input id="ba_balance" type="number" inputmode="decimal" step="0.01" value="'+esc(a.balance!=null&&a.balance!==""?a.balance:"")+'" placeholder="0.00">'
    +'<div class="sub" style="margin:4px 0">For a credit card, enter what you OWE as a negative number (e.g. −250). Charges + payments you log adjust it from there.</div>'
    +(live!=null?('<div class="sub" style="margin:4px 0">Live balance (after logged charges/payments): <b style="color:'+(live<0?"var(--danger)":"var(--ok,#1b7f4d)")+'">'+budgetMoney(live)+'</b></div>'):'')
    +creditBox
    +'<label>Last 4 (optional)</label><input id="ba_mask" value="'+esc(a.mask||"")+'" placeholder="1234" maxlength="4" inputmode="numeric">'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetAccount(\''+a.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetAccount(\''+a.id+'\')">Delete account</button>')
  );
};
/* toggle the credit-only fields when the account type changes in the dialog */
window.budgetAccountTypeChange=function(type){
  var box=document.getElementById("ba_credit"); if(box)box.style.display=(type==="credit")?"block":"none";
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
  if(a.type==="credit"){
    var apr=parseFloat(val("ba_apr")); a.apr=(isNaN(apr)||apr<0)?"":Math.round(apr*100)/100;
    var mp=parseFloat(val("ba_minpay")); a.minPayment=(isNaN(mp)||mp<0)?"":Math.round(mp*100)/100;
    var cl=parseFloat(val("ba_limit")); a.creditLimit=(isNaN(cl)||cl<0)?"":Math.round(cl*100)/100;
    a.promoUntil=val("ba_promountil")||"";
    var pa=parseFloat(val("ba_promoapr")); a.promoApr=(a.promoUntil&&!isNaN(pa)&&pa>=0)?pa:"";
    var dbo=document.getElementById("ba_debtonly"); a.debtOnly=!!(dbo&&dbo.checked);
  }else{ a.apr=""; a.minPayment=""; a.creditLimit=""; a.debtOnly=false; a.promoUntil=""; a.promoApr=""; }   // non-credit never carries debt fields
  a.deleted=false; touch(a); if(isNew)d.budgetAccounts.push(a);
  /* an active card (credit, not debt-only) needs its auto-managed Payment envelope; a debt-only card retires it */
  if(budgetIsActiveCard(a))ensurePaymentCat(a);
  else { var pc=budgetPaymentCat(a.id); if(pc&&!pc.deleted){ pc.deleted=true; touch(pc); } }
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
  var _rcptCard=(typeof bgtRcptCardHTML==="function")?bgtRcptCardHTML():"";   /* js/121 — snap a receipt into a txn */

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
      if(t.isCardPayment)return budgetCardPaymentRow(t);
      if(t.isTransfer)return budgetTransferRow(t);
      var inc=t.dir==="in";
      var acct=t.accountId?budgetAccount(t.accountId):null;
      var onCard=acct&&acct.type==="credit"?(' <span class="sub" style="font-weight:400">💳 '+esc(acct.name)+'</span>'):'';
      var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(t.bookId))+'</span>'):'';
      return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openBudgetTx(\''+t.id+'\')">'
        +'<div class="grow"><div class="nm">'+esc(budgetCatName(t.catId))+(t.note?' <span class="sub" style="font-weight:400">· '+esc(t.note)+'</span>':'')+onCard+bookTag+'</div>'
        +'<div class="sub">'+esc(fmtDate(t.date))+'</div></div>'
        +'<div style="font-weight:800;color:'+(inc?"var(--ok,#1b7f4d)":"var(--danger)")+'">'+(inc?"+":"−")+budgetMoney(t.amount)+'</div></div>';
    }).join("")+'</div>';
  }
  body.innerHTML=_rcptCard+h;
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
/* a card-payment row (cash → card) — muted, flagged 💳, tap to delete (payments aren't edited in place) */
function budgetCardPaymentRow(t){
  var card=budgetAccount(t.cardId||""), src=budgetAccount(t.accountId||"");
  var here=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(t.bookId))+'</span>'):'';
  return '<div class="li" style="align-items:flex-start;cursor:pointer;opacity:.85" onclick="delCardPayment(\''+t.id+'\')">'
    +'<div class="grow"><div class="nm">💳 Paid '+esc(card?card.name:"card")+(src?' <span class="sub" style="font-weight:400">from '+esc(src.name)+'</span>':'')+here+'</div>'
    +'<div class="sub">'+esc(fmtDate(t.date))+' · card payment</div></div>'
    +'<div style="font-weight:800;color:var(--muted)">−'+budgetMoney(t.amount)+'</div></div>';
}
window.delCardPayment=function(id){
  var t=(D().budgetTx||[]).find(function(x){return x.id===id&&x.isCardPayment;}); if(!t)return;
  if(!confirm("Delete this card payment? The card balance goes back up by "+budgetMoney(t.amount)+"."))return;
  t.deleted=true; touch(t); save(); render();
};
window.openBudgetTx=function(id){
  var isNew=!id;
  var books=actBudgetBooks();
  var t=isNew?{id:"bgt-tx-"+uid(),date:today(),dir:"out",amount:"",catId:"",note:"",bookId:budgetDefaultBookId()}
             :(D().budgetTx||[]).filter(function(x){return !x.deleted;}).find(function(x){return x.id===id;});
  if(!t)return;
  if(t.isTransfer){ openBudgetTransfer(t.transferId); return; }   // transfers edit via their own dialog
  if(t.isCardPayment){ openCardPayment(t.cardId); return; }       // card payments use their own dialog
  /* categories available for THIS tx's book (so a tx always pairs with a same-book category); Payment envelopes are auto-managed, not picked */
  var bid=t.bookId||budgetDefaultBookId();
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===bid&&!c.paymentEnvelope;})
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
    +budgetTxAccountSelect(bid,t.accountId)
    +'<label>Date</label><input id="bt_date" type="date" value="'+(t.date||today())+'">'
    +'<label>Note (optional)</label><input id="bt_note" value="'+esc(t.note||"")+'" placeholder="e.g. groceries, paycheck">'
    +/* ⭐ one payment, several categories (js/148) — the Lowe's run that is half job materials */
    +(isNew?"":'<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="closeModal();openSplit(\''+t.id+'\')">'+(t.isSplit?"Edit the split":"🔀 Split into categories")+'</button>')
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetTx(\''+t.id+'\','+isNew+')">Save</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetTx(\''+t.id+'\')">Delete</button>')
  );
};
/* "Paid from" account picker for a tx (which account the money came from). A credit account = a charge to that
   card (funds its Payment envelope + grows its debt). Empty = unassigned/cash (legacy behavior, no account effect). */
function budgetTxAccountSelect(bid,sel){
  var accts=(D().budgetAccounts||[]).filter(function(a){return !a.deleted&&a.bookId===bid&&!a.debtOnly;})
    .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
  if(!accts.length)return '<input type="hidden" id="bt_acct" value="'+esc(sel||"")+'">';
  var opts='<option value="">— cash / unassigned —</option>'+accts.map(function(a){
    var meta=acctTypeMeta(a.type);
    return '<option value="'+a.id+'"'+(sel===a.id?" selected":"")+'>'+meta.icon+' '+esc(a.name)+(a.type==="credit"?" (credit)":"")+'</option>';
  }).join("");
  return '<label>Paid from</label><select id="bt_acct">'+opts+'</select>'
    +'<div class="sub" style="margin:2px 0">Pick a credit card to charge it — that sets cash aside in its Payment envelope and grows the balance.</div>';
}
/* switching the book in the tx dialog: re-render so the category + account lists match the new book */
window.budgetTxBookChange=function(bid){
  var sel=document.getElementById("bt_cat");
  if(sel){
    var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===bid&&!c.paymentEnvelope;})
      .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
    sel.innerHTML='<option value="">— pick a category —</option>'+cats.map(function(c){
      return '<option value="'+c.id+'" data-kind="'+(c.kind||"out")+'">'+esc(c.name)+' ('+((c.kind||"out")==="in"?"income":"spending")+')</option>';
    }).join("");
  }
  var asel=document.getElementById("bt_acct");
  if(asel&&asel.tagName==="SELECT"){
    var accts=(D().budgetAccounts||[]).filter(function(a){return !a.deleted&&a.bookId===bid&&!a.debtOnly;})
      .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
    asel.innerHTML='<option value="">— cash / unassigned —</option>'+accts.map(function(a){
      var meta=acctTypeMeta(a.type);
      return '<option value="'+a.id+'">'+meta.icon+' '+esc(a.name)+(a.type==="credit"?" (credit)":"")+'</option>';
    }).join("");
  }
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
  var acct=(document.getElementById("bt_acct")||{}).value||"";
  t.accountId=(t.dir==="out")?acct:"";   // payment-source only applies to spending; income lands in cash via TBB
  if(t.accountId){ var pa=budgetAccount(t.accountId); if(pa&&budgetIsActiveCard(pa))ensurePaymentCat(pa); }   // make sure the card's Payment envelope exists
  t.date=val("bt_date")||today();
  t.note=val("bt_note");
  t.deleted=false;
  if(t.pending)delete t.pending;   // js/121: confirming the scan in this modal is what promotes it to a real txn
  touch(t); if(isNew)d.budgetTx.push(t);
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

/* ============================================================================================================
   RECURRING / SCHEDULED BILLS + HISTORICAL-AVERAGE PLANNING (budget v2 — Ray's core "fund ahead" workflow).
   A budgetBill {id,bookId,catId,name,amount,frequency,dueDay,nextDue,autoEstimate,active,deleted,updatedAt}
   links to a budget CATEGORY (its envelope). Multiple bills can share one category (e.g. subscriptions). The
   workflow: look at HISTORICAL spending for a bill/category → set how much to set aside → FUND that envelope
   IN ADVANCE → pay everything debit/cash. The Bills tab manages the schedule, shows the historical average to
   apply with one tap, and surfaces a fund-ahead view (this month's bills total, funded vs needed, fund the gap).

   FUNDED = the bill's category envelope AVAILABLE (carryover + this-month allocation − spent), shared across the
   bills under that category. FUNDING = allocating to that envelope (budgetSetAllocation, the same plumbing the
   Month view uses). PAY a bill = log a budgetTx in its category (linked via openBudgetTx). All DERIVED — no
   side-effect records beyond the bill itself and the normal alloc/tx, so the sync round-trip stays loss-free. */

var BUDGET_FREQS=[
  {k:"weekly",   label:"Weekly",    perMonth:52/12, perYear:52},
  {k:"monthly",  label:"Monthly",   perMonth:1,     perYear:12},
  {k:"quarterly",label:"Quarterly", perMonth:1/3,   perYear:4},
  {k:"annual",   label:"Annual",    perMonth:1/12,  perYear:1},
  /* ⭐ ONE-TIME. Ray, 2026-08-25: "i owe 736.24 to JT Jones Propane for our home propane, add that to bills."
     A propane delivery is a real bill he owes on a real date, and it is not a monthly obligation — filing it
     as one would have claimed $736.24/month of his money forever, in the money card he reads every morning.
     perMonth 0 keeps it OUT of the fund-ahead target (that's for recurring commitments) while it still shows
     in what's due. */
  {k:"once",     label:"One-time",  perMonth:0,     perYear:0}
];
/* "yearly" is an older spelling that exists in live data — treat it as annual rather than silently as
   monthly, which is what the default did (a 12× overstatement in every fund-ahead number). */
function budgetFreqMeta(k){ if(k==="yearly")k="annual";
  return BUDGET_FREQS.find(function(f){return f.k===k;})||BUDGET_FREQS[1]; }
/* a bill's contribution to a SINGLE month's needed-to-fund total (weekly ≈ 4.33×, quarterly ⅓, annual 1/12) */
function budgetBillMonthlyAmount(b){ return Math.round((+b.amount||0)*budgetFreqMeta(b.frequency).perMonth*100)/100; }

/* active (non-deleted, in-scope) bills */
function actBudgetBills(){ return (D().budgetBills||[]).filter(function(b){return !b.deleted&&budgetInBook(b);})
  .sort(function(a,b){ return (a.nextDue||"").localeCompare(b.nextDue||"") || (a.name||"").localeCompare(b.name||""); }); }
function budgetBill(id){ return (D().budgetBills||[]).filter(function(b){return !b.deleted;}).find(function(b){return b.id===id;}); }

/* ---- NEXT-DUE math: from a frequency + a dueDay (1-28 for monthly/quarterly/annual; weekday 0-6 for weekly),
   compute the next due date on/after a reference date. Stored nextDue (an explicit override) wins when present
   and still in the future; otherwise we roll it forward from today so a bill always shows its upcoming date. ---- */
function budgetDateAddDays(ds,n){ var d=new Date(ds+"T12:00:00"); d.setDate(d.getDate()+n);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function budgetDateOnDay(year,month0,day){ var dim=new Date(year,month0+1,0).getDate(); var dd=Math.min(Math.max(1,day||1),dim);
  return year+"-"+String(month0+1).padStart(2,"0")+"-"+String(dd).padStart(2,"0"); }
/* compute the next due date (>= ref) for a bill from its frequency + dueDay */
function budgetBillNextDue(b,ref){
  ref=ref||today();
  if(b.nextDue&&b.nextDue>=ref)return b.nextDue;   // explicit, still-future override wins
  var freq=b.frequency||"monthly";
  var r=new Date(ref+"T12:00:00");
  if(freq==="weekly"){
    var wd=(b.dueDay!=null&&b.dueDay!=="")?(((+b.dueDay)%7)+7)%7:r.getDay();
    var diff=(wd-r.getDay()+7)%7;   // 0..6 days ahead
    return budgetDateAddDays(ref,diff);
  }
  var day=(b.dueDay!=null&&b.dueDay!=="")?(+b.dueDay):1;
  if(freq==="monthly"){
    var cand=budgetDateOnDay(r.getFullYear(),r.getMonth(),day);
    if(cand>=ref)return cand;
    return budgetDateOnDay(r.getFullYear(),r.getMonth()+1,day);   // JS Date normalizes month overflow
  }
  if(freq==="quarterly"){
    for(var i=0;i<5;i++){ var c=budgetDateOnDay(r.getFullYear(),r.getMonth()+i*3-((r.getMonth())%3),day); if(c>=ref)return c; }
    return budgetDateOnDay(r.getFullYear()+1,0,day);
  }
  /* annual: anchor month from nextDue if set, else use the ref month; roll to next year if past */
  var anchorMonth=(b.nextDue?(+b.nextDue.slice(5,7)-1):r.getMonth());
  var ca=budgetDateOnDay(r.getFullYear(),anchorMonth,day);
  if(ca>=ref)return ca;
  return budgetDateOnDay(r.getFullYear()+1,anchorMonth,day);
}
/* a bill is "due in month m" if its next due date falls inside that calendar month */
function budgetBillDueInMonth(b,m){ return budgetMonthOf(budgetBillNextDue(b,m+"-01"))===m; }

/* ---- HISTORICAL AVERAGE: average / min / max of actual ACTUAL out-spending in a category over the last N
   COMPLETE months (excluding the current, partial month). Used to suggest a bill amount or an envelope target.
   Returns {avg,min,max,n,months} where n = how many of those months actually had spending. ---- */
function budgetHistoryStats(catId,nMonths){
  nMonths=nMonths||6;
  var cur=budgetThisMonth();
  var vals=[], considered=0;
  for(var i=1;i<=nMonths;i++){
    var m=budgetShiftMonth(cur,-i);
    var spent=budgetCatSpent(catId,m);
    considered++;
    if(spent>0.005)vals.push(spent);   // only months WITH spending count toward the average (skip empty months)
  }
  if(!vals.length)return {avg:0,min:0,max:0,n:0,months:considered};
  var sum=vals.reduce(function(s,v){return s+v;},0);
  return {
    avg:Math.round(sum/vals.length*100)/100,
    min:Math.round(Math.min.apply(null,vals)*100)/100,
    max:Math.round(Math.max.apply(null,vals)*100)/100,
    n:vals.length, months:considered
  };
}

/* FUNDED toward a category's bills THIS month = cash actually set aside now: a non-negative carry-in (prior
   unfunded overspend never counts AGAINST this month's bill money) + this month's allocation − this month's
   spend. Floored at 0. This is "how much is sitting in the envelope ready to pay the bill," which is what the
   fund-ahead prompt needs (vs the raw rollover balance, which ancient unfunded spending can drag negative). */
function budgetBillFunded(catId,m){
  var carry=budgetCarryIn(catId,m); if(carry<0)carry=0;
  var v=carry+budgetAllocated(catId,m)-budgetCatSpent(catId,m);
  return Math.round((v>0?v:0)*100)/100;
}

/* ---- FUND-AHEAD rollup for a month: every active bill due that month, grouped by category, with that
   category's envelope AVAILABLE (funded) vs the bills' total (needed). Returns the per-category rows + totals. ---- */
function budgetBillsFundPlan(m){
  var bills=actBudgetBills().filter(function(b){return b.active!==false&&budgetBillDueInMonth(b,m);});
  var byCat={};
  bills.forEach(function(b){
    var k=b.catId||"__none__";
    (byCat[k]=byCat[k]||{catId:b.catId,bills:[],needed:0}).bills.push(b);
    byCat[k].needed+=(+b.amount||0);
  });
  var rows=Object.keys(byCat).map(function(k){
    var g=byCat[k];
    var funded=g.catId?budgetBillFunded(g.catId,m):0;   // cash set aside in the envelope this month (floored at 0)
    g.needed=Math.round(g.needed*100)/100;
    g.funded=Math.round(funded*100)/100;
    g.gap=Math.round(Math.max(0,g.needed-g.funded)*100)/100;
    return g;
  }).sort(function(a,b){ return (budgetCatName(a.catId)||"").localeCompare(budgetCatName(b.catId)||""); });
  var needed=Math.round(rows.reduce(function(s,r){return s+r.needed;},0)*100)/100;
  var funded=Math.round(rows.reduce(function(s,r){return s+r.funded;},0)*100)/100;
  var gap=Math.round(rows.reduce(function(s,r){return s+r.gap;},0)*100)/100;
  return {rows:rows, needed:needed, funded:funded, gap:gap, count:bills.length};
}

/* ---------- BILLS render: fund-ahead summary (this month) + upcoming list + the scheduled-bills manager ---------- */
function budgetRenderBills(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var m=BUDGET_MONTH||budgetThisMonth();
  var books=actBudgetBooks();

  var h='<div class="card"><div class="row" style="gap:8px;align-items:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(-1)" title="Previous month">‹</button>'
    +'<input type="month" value="'+m+'" onchange="budgetSetMonth(this.value)" style="flex:1;text-align:center">'
    +'<button class="btn ghost sm" onclick="budgetNavMonth(1)" title="Next month">›</button>'
    +'</div><div class="sub" style="text-align:center;margin-top:6px"><b>Bills · '+budgetMonthLabel(m)+'</b>'
    +(budgetIsAll()?' · all books':' · '+esc(budgetBookName(BUDGET_BOOK)))+'</div></div>';

  if(!books.length){
    h+='<div class="empty"><div class="big">🔁</div>No books yet. Create one on the <b>Settings</b> tab first.</div>';
    body.innerHTML=h; return;
  }

  h+='<button class="btn acc" style="width:100%;margin-bottom:10px" onclick="openBudgetBill(null)">＋ Add a recurring bill</button>';

  var bills=actBudgetBills();
  if(!bills.length){
    h+='<div class="empty"><div class="big">🔁</div>No recurring bills yet'+(budgetIsAll()?'':' in this book')+'.<br>Add your bills + subscriptions (electric, rent, internet, streaming…) so you can <b>fund the month in advance</b> and pay them from cash. Each bill links to a category envelope.</div>';
    body.innerHTML=h; return;
  }

  /* ---- FUND-AHEAD headline: this month's bills total, funded vs needed, fund the gap ---- */
  h+=budgetBillsFundCard(m);

  /* ---- UPCOMING — next due dates this month (+ a peek at next month) ---- */
  h+=budgetBillsUpcoming(m);

  /* ---- the scheduled bills, grouped bill / subscription / other ---- */
  h+=budgetBillsManager();

  body.innerHTML=h;
}
/* FUND-AHEAD card: "this month you need $X, you've set aside $Y — fund the $Z gap now." One-tap fund-the-gap. */
function budgetBillsFundCard(m){
  var plan=budgetBillsFundPlan(m);
  if(!plan.count){
    return '<div class="card" style="text-align:center;border-left:4px solid var(--ok,#1b7f4d)"><div class="sub">No bills due in '+budgetMonthLabel(m)+'.</div></div>';
  }
  var color=plan.gap<0.005?"var(--ok,#1b7f4d)":"#d98a00";
  var h='<div class="card" style="text-align:center;border-left:4px solid '+color+'">'
    +'<div class="sub">Bills due in '+budgetMonthLabel(m)+' ('+plan.count+')</div>'
    +'<div style="font-weight:800;font-size:28px">'+budgetMoney(plan.needed)+'</div>'
    +'<div class="sub" style="margin-top:4px;border-top:1px solid var(--line,#eee);padding-top:6px">'
    +'Set aside <b style="color:var(--ok,#1b7f4d)">'+budgetMoney(plan.funded)+'</b> · still need <b style="color:'+color+'">'+budgetMoney(plan.gap)+'</b></div>';
  if(plan.gap>0.005){
    h+='<div class="sub" style="margin-top:6px;color:'+color+'">⚠ Fund the '+budgetMoney(plan.gap)+' gap now so every bill is covered before it\'s due.</div>'
      +'<button class="btn acc sm" style="margin-top:8px" onclick="budgetFundBillGap(\''+m+'\')">💧 Fund the gap ('+budgetMoney(plan.gap)+')</button>';
  }else{
    h+='<div class="sub" style="margin-top:6px;color:var(--ok,#1b7f4d)">✓ Every bill this month is funded ahead. 🎯</div>';
  }
  /* per-category breakdown (funded vs needed) */
  h+='<div style="margin-top:8px;text-align:left;border-top:1px solid var(--line,#eee);padding-top:6px">'
    +plan.rows.map(function(r){
      var nm=r.catId?budgetCatName(r.catId):"Uncategorized";
      var rc=r.gap>0.005?"#d98a00":"var(--ok,#1b7f4d)";
      return '<div class="row" style="justify-content:space-between;align-items:baseline;margin:2px 0">'
        +'<span class="sub">'+esc(nm)+' <span style="font-weight:400">('+r.bills.length+')</span></span>'
        +'<span style="font-weight:600;color:'+rc+'">'+budgetMoney(r.funded)+' / '+budgetMoney(r.needed)+'</span></div>';
    }).join("")
    +'</div>';
  return h+'</div>';
}
/* compact bills card for the MONTH view — links to the Bills tab; shows this month's needed vs funded + the gap */
function budgetBillsMonthCard(m){
  var bills=actBudgetBills();
  if(!bills.length)return "";
  var plan=budgetBillsFundPlan(m);
  if(!plan.count)return "";
  var color=plan.gap<0.005?"var(--ok,#1b7f4d)":"#d98a00";
  var h='<div class="secthd"><h2>Bills this month</h2><span class="ct" style="cursor:pointer" onclick="budgetSetSub(\'bills\')">Bills ›</span></div>';
  h+='<div class="card" style="padding:8px 10px;border-left:4px solid '+color+'">'
    +'<div class="row" style="justify-content:space-between;align-items:baseline">'
    +'<span class="sub">'+plan.count+' bill'+(plan.count===1?"":"s")+' due · need '+budgetMoney(plan.needed)+'</span>'
    +'<span style="font-weight:700;color:'+color+'">'+(plan.gap<0.005?'✓ funded':'gap '+budgetMoney(plan.gap))+'</span></div>'
    +'<div class="sub" style="margin-top:4px">Set aside '+budgetMoney(plan.funded)+' of '+budgetMoney(plan.needed)+'.'
    +(plan.gap>0.005?' <span style="cursor:pointer;text-decoration:underline" onclick="budgetSetSub(\'bills\')">Fund the gap →</span>':' Funded ahead. 🎯')+'</div>'
    +'</div>';
  return h;
}
/* one-tap: top up each due-this-month bill category's allocation so its envelope covers the bills due (the gap). */
window.budgetFundBillGap=function(m){
  var plan=budgetBillsFundPlan(m);
  var todo=plan.rows.filter(function(r){return r.catId&&r.gap>0.005;});
  if(!todo.length){ alert("Every bill this month is already funded."); return; }
  if(!confirm("Fund "+budgetMoney(plan.gap)+" across "+todo.length+" envelope"+(todo.length===1?"":"s")+" so this month's bills are covered ahead of time?\n\nTo Be Budgeted will drop by that amount."))return;
  todo.forEach(function(r){
    var cur=budgetAllocated(r.catId,m);
    budgetSetAllocation(r.catId,m,Math.round((cur+r.gap)*100)/100);   // add exactly the gap to the current allocation
  });
  render();
};
/* UPCOMING list — bills due this month (and a peek at next month), each with its next due date + amount + funded mark */
function budgetBillsUpcoming(m){
  var nextM=budgetShiftMonth(m,1);
  var thisMo=actBudgetBills().filter(function(b){return b.active!==false&&budgetBillDueInMonth(b,m);})
    .map(function(b){return {b:b,due:budgetBillNextDue(b,m+"-01")};}).sort(function(a,b){return a.due.localeCompare(b.due);});
  var peek=actBudgetBills().filter(function(b){return b.active!==false&&budgetBillDueInMonth(b,nextM);})
    .map(function(b){return {b:b,due:budgetBillNextDue(b,nextM+"-01")};}).sort(function(a,b){return a.due.localeCompare(b.due);});
  if(!thisMo.length&&!peek.length)return "";
  var h='<div class="secthd"><h2>Upcoming</h2></div>';
  function row(x){
    var b=x.b, freq=budgetFreqMeta(b.frequency);
    var funded=b.catId?budgetBillFunded(b.catId,budgetMonthOf(x.due)):0;
    var covered=funded>=(+b.amount||0)-0.005;
    var catTag=b.catId?('<span class="sub" style="font-weight:400"> · '+esc(budgetCatName(b.catId))+'</span>'):'';
    var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(b.bookId))+'</span>'):'';
    return '<div class="li" style="cursor:pointer" onclick="openBudgetBill(\''+b.id+'\')">'
      +'<div class="grow"><div class="nm">'+(covered?'✅':'⏳')+' '+esc(b.name||"Bill")+catTag+bookTag+'</div>'
      +'<div class="sub">due '+esc(fmtDate(x.due))+' · '+esc(freq.label.toLowerCase())+(covered?' · funded':' · not yet funded')+'</div></div>'
      +'<div style="font-weight:800">'+budgetMoney(b.amount)+'</div></div>';
  }
  h+='<div class="card" style="padding:6px 10px">';
  if(thisMo.length)h+='<div class="sub" style="font-weight:600;margin:2px 0 4px">'+budgetMonthLabel(m)+'</div>'+thisMo.map(row).join("");
  if(peek.length)h+='<div class="sub" style="font-weight:600;margin:8px 0 4px;border-top:1px solid var(--line,#eee);padding-top:6px">'+budgetMonthLabel(nextM)+' (next)</div>'+peek.map(row).join("");
  h+='</div>';
  return h;
}
/* MANAGER — every scheduled bill, grouped bill / subscription / other; tap to edit; shows amount + frequency + cat */
function budgetBillsManager(){
  var bills=actBudgetBills();
  var groups=[{key:"bill",label:"🔁 Bills",icon:"🔁"},{key:"subscription",label:"📺 Subscriptions"},{key:"other",label:"📄 Other recurring"}];
  var monthlyTotal=Math.round(bills.filter(function(b){return b.active!==false;}).reduce(function(s,b){return s+budgetBillMonthlyAmount(b);},0)*100)/100;
  var h='<div class="secthd"><h2>Scheduled bills</h2><span class="ct">'+budgetMoney(monthlyTotal)+'/mo</span></div>';
  groups.forEach(function(grp){
    var list=bills.filter(function(b){
      var g=budgetBillGroupOf(b);
      return grp.key==="other"?(g!=="bill"&&g!=="subscription"):(g===grp.key);
    });
    if(!list.length)return;
    h+='<div class="sub" style="font-weight:600;margin:8px 4px 4px">'+esc(grp.label)+'</div>';
    h+='<div class="card" style="padding:6px 10px">'+list.map(function(b){
      var freq=budgetFreqMeta(b.frequency);
      var catTag=b.catId?('<span class="sub" style="font-weight:400"> · '+esc(budgetCatName(b.catId))+'</span>'):'<span class="sub" style="font-weight:400"> · no category</span>';
      var bookTag=budgetIsAll()?('<span class="sub" style="font-weight:400"> · '+esc(budgetBookName(b.bookId))+'</span>'):'';
      var inactive=b.active===false?' <span class="sub" style="font-weight:400">· paused</span>':'';
      return '<div class="li" style="cursor:pointer'+(b.active===false?';opacity:.6':'')+'" onclick="openBudgetBill(\''+b.id+'\')">'
        +'<div class="grow"><div class="nm">'+esc(b.name||"Bill")+catTag+bookTag+inactive+'</div>'
        +'<div class="sub">'+esc(freq.label)+' · next '+esc(fmtDate(budgetBillNextDue(b)))+'</div></div>'
        +'<div style="font-weight:800">'+budgetMoney(b.amount)+'</div></div>';
    }).join("")+'</div>';
  });
  return h;
}
/* a bill's group = its category's group flag (bill/subscription) — that's how bills cluster */
function budgetBillGroupOf(b){ var c=b.catId?budgetCat(b.catId):null; return (c&&c.group)||""; }

/* ---------- BILL editor — add/edit a recurring bill; historical-average suggestion with one-tap apply ---------- */
window.openBudgetBill=function(id){
  var isNew=!id;
  var books=actBudgetBooks();
  if(isNew&&!books.length){ alert("Create a book first (Settings → Books), then add a bill."); return; }
  var b=isNew?{id:"bgt-bill-"+uid(),name:"",amount:"",frequency:"monthly",dueDay:1,catId:"",bookId:budgetDefaultBookId(),autoEstimate:false,active:true}
             :budgetBill(id);
  if(!b)return;
  var bid=b.bookId||budgetDefaultBookId();
  /* spending categories in this book (a bill funds a spending envelope); payment/tax envelopes excluded */
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===bid&&(c.kind||"out")==="out"&&!c.paymentEnvelope&&!c.taxEnvelope;})
    .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
  var catOpts='<option value="">— pick a category envelope —</option>'+cats.map(function(c){
    var g=c.group==="bill"?" 🔁":(c.group==="subscription"?" 📺":"");
    return '<option value="'+c.id+'"'+(b.catId===c.id?" selected":"")+'>'+esc(c.name)+g+'</option>';
  }).join("");
  var freqOpts=BUDGET_FREQS.map(function(f){return '<option value="'+f.k+'"'+((b.frequency||"monthly")===f.k?" selected":"")+'>'+f.label+'</option>';}).join("");
  var bookSel=books.length>1?('<label>Book</label><select id="bl_book" onchange="budgetBillBookChange(this.value)">'
    +books.map(function(bk){return '<option value="'+bk.id+'"'+(bid===bk.id?" selected":"")+'>'+esc(bk.name)+'</option>';}).join("")+'</select>'):'<input type="hidden" id="bl_book" value="'+esc(bid)+'">';
  var stats=b.catId?budgetHistoryStats(b.catId,6):null;
  var suggestBox=(stats&&stats.n)?(
    '<div id="bl_suggest" class="card" style="padding:8px 10px;margin:6px 0;background:var(--accent-soft,#eef7f1)">'
    +'<div class="sub">📊 Suggested <b>'+budgetMoney(stats.avg)+'</b> — avg of '+stats.n+' month'+(stats.n===1?"":"s")+' with '+esc(budgetCatName(b.catId))+' spending (min '+budgetMoney(stats.min)+', max '+budgetMoney(stats.max)+')</div>'
    +'<button type="button" class="btn ghost sm" style="margin-top:6px" onclick="budgetBillApplySuggestion('+stats.avg+')">Use '+budgetMoney(stats.avg)+'</button></div>'
  ):'<div id="bl_suggest"></div>';
  modal(isNew?"Add a recurring bill":"Edit bill",''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">Schedule a bill or subscription so you can fund it ahead. It links to a category envelope — fund the envelope, pay the bill from cash.</p>'
    +bookSel
    +'<label>Name</label><input id="bl_name" value="'+esc(b.name||"")+'" placeholder="e.g. Electric · Internet · Netflix">'
    +'<label>Category envelope</label><select id="bl_cat" onchange="budgetBillCatChange()">'+catOpts+'</select>'
    +(cats.length?'':'<div class="sub" style="margin:4px 0">No spending categories in this book yet — add one on the Settings tab (tip: set its Group to “Bill” or “Subscription”).</div>')
    +suggestBox
    +'<label>Amount</label><input id="bl_amount" type="number" inputmode="decimal" step="0.01" value="'+esc(b.amount!=null&&b.amount!==""?b.amount:"")+'" placeholder="0.00">'
    +'<label>Frequency</label><select id="bl_freq" onchange="budgetBillFreqChange(this.value)">'+freqOpts+'</select>'
    +'<div id="bl_duewrap"></div>'
    +'<label class="row" style="gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="bl_active" '+(b.active!==false?"checked":"")+' style="width:auto"> Active (counts toward fund-ahead)</label>'
    +'<button class="btn acc" style="margin-top:12px" onclick="saveBudgetBill(\''+b.id+'\','+isNew+')">Save bill</button>'
    +(isNew?"":'<button class="btn danger" style="margin-top:10px" onclick="delBudgetBill(\''+b.id+'\')">Delete bill</button>')
  );
  budgetBillRenderDue(b.frequency||"monthly",b.dueDay,b.nextDue);
};
/* render the due-day control appropriate to the frequency (weekday for weekly, day-of-month otherwise) */
function budgetBillRenderDue(freq,dueDay,nextDue){
  var wrap=document.getElementById("bl_duewrap"); if(!wrap)return;
  if(freq==="weekly"){
    var DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    var sel=(dueDay!=null&&dueDay!=="")?(+dueDay):0;
    wrap.innerHTML='<label>Due weekday</label><select id="bl_dueday">'
      +DOW.map(function(d,i){return '<option value="'+i+'"'+(sel===i?" selected":"")+'>'+d+'</option>';}).join("")+'</select>';
  }else if(freq==="once"){
    /* a one-time bill has exactly one date and no day-of-month at all */
    wrap.innerHTML='<label>Due date</label><input id="bl_nextdue" type="date" value="'+esc(nextDue||"")+'">'
      +'<div class="sub" style="margin:4px 0">Shows up once, on that day, then drops off by itself.</div>';
  }else{
    var dd=(dueDay!=null&&dueDay!=="")?(+dueDay):1;
    wrap.innerHTML='<label>Due day of month (1–28)</label><input id="bl_dueday" type="number" inputmode="numeric" min="1" max="28" step="1" value="'+dd+'">'
      +(freq==="annual"||freq==="quarterly"?'<label>Next due (anchors the '+(freq==="annual"?"month":"cycle")+')</label><input id="bl_nextdue" type="date" value="'+esc(nextDue||"")+'">':'');
  }
}
window.budgetBillFreqChange=function(freq){
  var dd=(document.getElementById("bl_dueday")||{}).value;
  var nd=(document.getElementById("bl_nextdue")||{}).value;
  budgetBillRenderDue(freq,dd,nd);
};
/* switching the book re-builds the category list to that book's spending envelopes */
window.budgetBillBookChange=function(bid){
  var sel=document.getElementById("bl_cat"); if(!sel)return;
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===bid&&(c.kind||"out")==="out"&&!c.paymentEnvelope&&!c.taxEnvelope;})
    .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
  sel.innerHTML='<option value="">— pick a category envelope —</option>'+cats.map(function(c){
    var g=c.group==="bill"?" 🔁":(c.group==="subscription"?" 📺":"");
    return '<option value="'+c.id+'">'+esc(c.name)+g+'</option>';
  }).join("");
  budgetBillCatChange();
};
/* when the category changes, refresh the historical-average suggestion box */
window.budgetBillCatChange=function(){
  var catId=(document.getElementById("bl_cat")||{}).value||"";
  var box=document.getElementById("bl_suggest"); if(!box)return;
  if(!catId){ box.innerHTML=""; return; }
  var stats=budgetHistoryStats(catId,6);
  if(!stats.n){ box.innerHTML='<div class="sub" style="margin:6px 0">No spending history yet for '+esc(budgetCatName(catId))+' — enter the amount manually; the suggestion appears once you log a few months.</div>'; return; }
  box.innerHTML='<div class="card" style="padding:8px 10px;margin:6px 0;background:var(--accent-soft,#eef7f1)">'
    +'<div class="sub">📊 Suggested <b>'+budgetMoney(stats.avg)+'</b> — avg of '+stats.n+' month'+(stats.n===1?"":"s")+' with '+esc(budgetCatName(catId))+' spending (min '+budgetMoney(stats.min)+', max '+budgetMoney(stats.max)+')</div>'
    +'<button type="button" class="btn ghost sm" style="margin-top:6px" onclick="budgetBillApplySuggestion('+stats.avg+')">Use '+budgetMoney(stats.avg)+'</button></div>';
};
window.budgetBillApplySuggestion=function(amt){
  var inp=document.getElementById("bl_amount"); if(inp)inp.value=(+amt||0).toFixed(2);
};
/* apply a historical-average suggestion to the category editor's goal field */
window.budgetBillApplyTarget=function(amt){
  var inp=document.getElementById("bc_target"); if(inp)inp.value=(+amt||0).toFixed(2);
};
window.saveBudgetBill=function(id,isNew){
  var d=D(); if(!d.budgetBills)d.budgetBills=[];
  var b=isNew?{id:id}:d.budgetBills.find(function(x){return x.id===id;});
  if(!b){closeModal();return;}
  b.name=val("bl_name"); if(!b.name){alert("Give the bill a name.");return;}
  var amt=parseFloat(val("bl_amount"));
  if(isNaN(amt)||amt<=0){alert("Enter an amount greater than zero.");return;}
  b.amount=Math.round(amt*100)/100;
  b.frequency=(document.getElementById("bl_freq")||{}).value||"monthly";
  b.bookId=(document.getElementById("bl_book")||{}).value||b.bookId||budgetDefaultBookId();
  b.catId=(document.getElementById("bl_cat")||{}).value||"";
  var ddEl=document.getElementById("bl_dueday");
  if(ddEl){ var dv=parseInt(ddEl.value,10); b.dueDay=isNaN(dv)?(b.frequency==="weekly"?0:1):dv; }
  var ndEl=document.getElementById("bl_nextdue");
  b.nextDue=(ndEl&&ndEl.value)?ndEl.value:(b.nextDue||"");
  /* a one-time bill IS its date — without one it would never appear anywhere, which is worse than refusing */
  if(b.frequency==="once"&&!b.nextDue){alert("Give the one-time bill a due date.");return;}
  var act=document.getElementById("bl_active"); b.active=act?!!act.checked:true;
  if(b.autoEstimate==null)b.autoEstimate=false;
  b.deleted=false; touch(b); if(isNew)d.budgetBills.push(b);
  save(); closeModal(); render();
};
window.delBudgetBill=function(id){
  if(!confirm("Delete this recurring bill? (Your transactions + envelope stay.)"))return;
  var b=budgetBill(id); if(!b)return;
  b.deleted=true; touch(b); save(); closeModal(); render();
};

/* ---------- SETTINGS — books + categories + monthly targets + export/backup (decentralized) ---------- */
function budgetRenderSettings(){
  var body=document.getElementById("budget_body"); if(!body)return;
  var cats=actBudgetCats();
  var h=budgetBooksSection();
  /* ⭐ bank connections (js/150) — a linked feed lands in Review, exactly like a CSV import */
  if(typeof bankCardHTML==="function")h+=bankCardHTML();
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
  var list=cats.filter(function(c){return (c.kind||"out")===kind&&!c.paymentEnvelope;});   // Payment envelopes are auto-managed by their card, not edited here
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
    +((!isNew&&kind==="out"&&(function(){var s=budgetHistoryStats(c.id,6);return s.n;})())?(function(){var s=budgetHistoryStats(c.id,6);
       return '<div class="sub" style="margin:4px 0">📊 Suggested <b>'+budgetMoney(s.avg)+'</b> — avg of '+s.n+' month'+(s.n===1?"":"s")+' of actual spending (min '+budgetMoney(s.min)+', max '+budgetMoney(s.max)+'). '
       +'<button type="button" class="btn ghost sm" onclick="budgetBillApplyTarget('+s.avg+')">Use as goal</button></div>';})():'')
    +'<div class="sub" style="margin:4px 0">A goal just powers the “fill from goal” shortcut on the Month tab — you still assign cash to the envelope yourself.</div>'
    +(kind==="out"?('<label class="row" style="gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="bc_rollover" '+((c.rollover!==false)?"checked":"")+' style="width:auto"> Roll leftover into next month</label>'
      +'<div class="sub" style="margin:2px 0 0">On = a sinking fund (savings build up). Off = resets each month (e.g. rent — unused cash goes back to To Be Budgeted).</div>'
      +'<label>Group</label><select id="bc_group">'
      +'<option value=""'+(!c.group?" selected":"")+'>None — regular spending</option>'
      +'<option value="bill"'+(c.group==="bill"?" selected":"")+'>🔁 Bill (electric, rent, utilities…)</option>'
      +'<option value="subscription"'+(c.group==="subscription"?" selected":"")+'>📺 Subscription (streaming, software…)</option>'
      +'</select>'
      +'<div class="sub" style="margin:2px 0 0">Grouping a category as a bill/subscription clusters it on the <b>Bills</b> tab and the Month view. Recurring bills you schedule live there too.</div>'):'')
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
  var grp=(document.getElementById("bc_group")||{}).value||"";
  c.group=(c.kind==="out")?grp:"";   // "bill" | "subscription" | "" — clusters bills/subs (out cats only)
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
      return [t.date,bookName(t.bookId),t.dir,(+t.amount||0).toFixed(2),t.isTransfer?"(transfer)":catNm(t.catId),t.note||"",t.isTransfer?"yes":""].map(csvCell).join(",");
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
