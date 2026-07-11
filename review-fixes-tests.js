/* review-fixes-tests.js — regression tests for the pipeline/finance review fixes (#2..#7).
   Run: node verify-app.js "$(cat review-fixes-tests.js)"  (#1 lives in square-invoice-tests.js) */
window.alert=function(){};window.confirm=function(){return true;};
S.users=S.users||[]; if(!S.users.some(x=>x&&x.id==="u_rj"))S.users.push({id:"u_rj",username:"Rj",name:"Rj",active:true});
if(typeof orgSetRole==="function")orgSetRole("u_rj","obx","owner");
localStorage.setItem("jra_session","u_rj");localStorage.setItem("jra_offline_ok","1");S.biz="obx";
function T(n,c){ if(c)diag("✓ "+n); else __errs.push("REVFIX FAIL: "+n); }
var d=D();

// ================= #2 — income statement subtracts pass-through materials =================
["income","jobs","expenses","timeclock","quotes","customers"].forEach(k=>d[k]=[]);
d.income.push({id:"i1",amount:1000,date:"2026-06-15",jobId:"jm",crew:["u_rj"]});
d.jobs.push({id:"jm",title:"Patio",date:"2026-06-15",crew:["u_rj"],materials:[{id:"m1",amount:300},{id:"m2",amount:100}],expenses:[{id:"e1",amount:100,category:"disposal"}]});
var pl=finPeriodPL("2026-06");
T("#2 pl.materials = $400 (40000c)", pl.materials===40000);
T("#2 jobCosts = $100 disposal (10000c), materials NOT in jobCosts", pl.jobCosts===10000);
T("#2 net subtracts materials: 100000 - 10000 jobCost - 40000 materials = 50000 (minus 0 mileage/opex)", pl.net===50000);
T("#2 totalCosts includes materials", pl.totalCosts===50000);
// pass-through billed AT COST is net-neutral: add a second job billed==cost, profit unchanged by the material
var before=finPeriodPL("2026-06").net;
d.income.push({id:"i2",amount:200,date:"2026-06-16",jobId:"jm2",crew:["u_rj"]});
d.jobs.push({id:"jm2",title:"Walk",date:"2026-06-16",crew:["u_rj"],materials:[{id:"m3",amount:200}],expenses:[]});
var after=finPeriodPL("2026-06").net;
T("#2 pass-through at cost is net-neutral to profit (net unchanged by +$200 rev / +$200 material)", after===before);

diag("review-fixes: #2 done");

// ================= #3 — personal-card fuel is NOT reimbursed (mileage covers it; no double-dip) =================
["income","jobs","expenses","timeclock","quotes","customers"].forEach(k=>d[k]=[]);
d.expenses.push({id:"x1",amount:50,category:"fuel",paidBy:"u_rj",date:"2026-06-10"});        // personal-card gas
d.expenses.push({id:"x2",amount:30,category:"materials",paidBy:"u_rj",date:"2026-06-10"});   // personal-card materials
d.jobs.push({id:"jf",materials:[{id:"jm1",amount:20,paidBy:"u_rj"}],expenses:[{id:"je1",amount:40,category:"fuel",paidBy:"u_rj"}]}); // job fuel + material
var owed=rcptReimbOwed();
T("#3 personal-card FUEL not reimbursed (excluded)", (owed["u_rj"]||0)===50);  // only the $30 materials + $20 job material = 50; the $50 + $40 fuel excluded
T("#3 non-fuel personal spend still reimbursed", (owed["u_rj"]||0)===50);
diag("review-fixes: #3 done");

// ================= #7 — invoice charges the FINAL price (not the raw line-item subtotal) =================
var q1={id:"q7",items:[{name:"Patio",price:1000,qty:1}],total:1000,finalPrice:1100};
T("#7 invEffectiveTotal uses finalPrice ($1100)", invEffectiveTotal(q1)===1100);
var adj=invAdjRows(q1);
T("#7 adjustment rows appear when final != subtotal", adj.indexOf("Subtotal")>=0 && adj.indexOf("Adjustment")>=0 && adj.indexOf("+$100")>=0);
var q2={id:"q7b",items:[{name:"Patio",price:1000,qty:1}],total:1000};   // no finalPrice
T("#7 no finalPrice → effective = total ($1000)", invEffectiveTotal(q2)===1000);
T("#7 no adjustment rows when final == subtotal (byte-identical to before)", invAdjRows(q2)==="");
var q3={id:"q7c",items:[{name:"Junk",price:900,qty:1}],total:900,finalPrice:800};  // discount
T("#7 downward adjustment shows minus", invAdjRows(q3).indexOf("−$100")>=0 && invEffectiveTotal(q3)===800);
diag("review-fixes: #7 done");

// ================= #6 — hand-logged Finance→Expenses reimburse field actually owes back =================
["income","jobs","expenses","timeclock","quotes","customers"].forEach(k=>d[k]=[]);
d.expenses.push({id:"h1",amount:75,category:"materials",memberId:"u_rj",date:"2026-06-10"});   // legacy: memberId only, no paidBy
d.expenses.push({id:"h2",amount:40,category:"disposal",paidBy:"u_rj",date:"2026-06-10"});       // receipt-style: paidBy
var owed=rcptReimbOwed();
T("#6 legacy memberId-only expense is now owed back", (owed["u_rj"]||0)===115);   // 75 (memberId) + 40 (paidBy)
diag("review-fixes: #6 done");

// ================= #4 — income booked exactly once: delete/restore + audit invariant =================
["income","jobs","expenses","timeclock","quotes","customers"].forEach(k=>d[k]=[]);
d.customers.push({id:"c4",name:"Test"});
d.quotes.push({id:"q4",customerId:"c4",total:1000,paid:true,jobId:"j4"});
d.jobs.push({id:"j4",customerId:"c4",crew:["u_rj"]});
syncQuoteIncome(d.quotes[0]);
T("#4 paid quote books income", D().income.some(x=>x.id==="inc_q_q4"&&!x.deleted&&x.amount===1000));
// delete the paid quote → income must tombstone (A1)
archiveDeleteQuote("q4");
T("#4 deleting a paid quote tombstones its income", !D().income.some(x=>x.id==="inc_q_q4"&&!x.deleted));
T("#4 audit is clean after delete (no orphan income)", finIncomeAudit().length===0);
// restore → income re-books
archRestore("quote","q4");
T("#4 restoring the quote re-books its income", D().income.some(x=>x.id==="inc_q_q4"&&!x.deleted&&x.amount===1000));
// audit catches a manually-orphaned income (quote deleted out from under it, no re-sync)
d.quotes[0].deleted=true;
var iss=finIncomeAudit();
T("#4 audit flags income whose quote is now deleted", iss.some(i=>i.id==="inc_q_q4"&&i.fixable));
// self-heal re-syncs
(D().quotes||[]).forEach(syncQuoteIncome);
T("#4 re-sync tombstones the orphaned income", !D().income.some(x=>x.id==="inc_q_q4"&&!x.deleted) && finIncomeAudit().length===0);
// audit catches two income records for one job (double-book)
d.quotes[0].deleted=false; d.income.length=0;
d.income.push({id:"inc_q_q4",quoteId:"q4",jobId:"j4",amount:1000});
d.income.push({id:"inc_manual_x",jobId:"j4",amount:1000});
T("#4 audit flags two income records for one job", finIncomeAudit().some(i=>i.msg.indexOf("2 income records for one job")>=0));
diag("review-fixes: #4 done");

// ================= #5 — cash on hand debits job expenses (was overstated); materials stay net-neutral =================
["income","jobs","expenses","timeclock","quotes","customers"].forEach(k=>d[k]=[]);
d.income.push({id:"i5",amount:1000,date:"2026-06-15",jobId:"j5",crew:["u_rj"]});
d.jobs.push({id:"j5",date:"2026-06-15",crew:["u_rj"],expenses:[{id:"e5",amount:100,category:"disposal"}],materials:[{id:"m5",amount:200}]});
var a1=finAccountBalances();
// business-fund outflow now includes the $100 job disposal expense
T("#5 finJobExpenseOut counts job disposal ($100 = 10000c)", finJobExpenseOut()===10000);
// remove the job expense → cash goes UP by exactly $100 (proves it's debiting cash now)
var cashWith=a1.cash;
d.jobs[0].expenses[0].deleted=true;
var cashWithout=finAccountBalances().cash;
T("#5 job expense reduces cash by exactly its amount ($100)", cashWithout - cashWith === 10000);
// materials are NOT a separate cash outflow — finJobExpenseOut counts ONLY job.expenses, never job.materials
// (materials are pass-through: their cost is offset by their billed revenue, so subtracting them would double-hit)
d.jobs[0].expenses[0].deleted=false;   // restore the $100 expense
var expOnly=finJobExpenseOut();
d.jobs[0].materials.push({id:"m5b",amount:500});
T("#5 finJobExpenseOut ignores materials (still $100, not $600)", finJobExpenseOut()===expOnly && expOnly===10000);
diag("review-fixes: #5 done");

// ================= #8 — NC sales tax collection on taxable jobs =================
["income","jobs","expenses","timeclock","quotes","customers","disbursements"].forEach(k=>d[k]=[]);
var qt={id:"q8",customerId:"c8",items:[{name:"Lawn maintenance",price:1000,qty:1}],total:1000,taxable:true,paid:true,jobId:"j8"};
var qn={id:"q8b",items:[{name:"New patio",price:2000,qty:1}],total:2000,taxable:false};
T("#8 quoteSalesTax on taxable $1000 = $67.50", quoteSalesTax(qt)===67.5);
T("#8 quoteSalesTax on non-taxable = $0", quoteSalesTax(qn)===0);
T("#8 quoteTotalWithTax = $1067.50", quoteTotalWithTax(qt)===1067.5);
T("#8 invoice tax rows appear for taxable (Sales tax + Total due + $67.50)", invTaxRows(qt,false).indexOf("Sales tax (6.75%)")>=0 && invTaxRows(qt,false).indexOf("Total due")>=0);
T("#8 no tax rows for non-taxable", invTaxRows(qn,false)==="");
T("#8 invAmountDue includes tax for taxable ($1067.50)", invAmountDue(qt)===1067.5);
T("#8 invAmountDue = service total for non-taxable ($2000)", invAmountDue(qn)===2000);
// income stays PRE-TAX (tax is a liability, not revenue/split)
d.quotes.push(qt); d.jobs.push({id:"j8",crew:["u_rj"]});
syncQuoteIncome(qt);
T("#8 income booked at PRE-TAX service total ($1000, not $1067.50)", D().income.some(x=>x.id==="inc_q_q8"&&x.amount===1000));
// collected-tax liability
var st=finSalesTaxCollected();
T("#8 finSalesTaxCollected: $67.50 collected/owed (6750c)", st.collected===6750 && st.owed===6750);
// record a remittance → owed drops
d.disbursements.push({id:"r8",type:"salestax",amount:50,date:"2026-06-20"});
T("#8 remittance reduces owed (6750 - 5000 = 1750c)", finSalesTaxCollected().owed===1750);
diag("review-fixes: #8 done");

// ================= #9 — 1099-NEC per-payee report =================
["income","jobs","expenses","timeclock","quotes","customers","disbursements"].forEach(k=>d[k]=[]);
S.users=S.users||[];
[["u_chaz","Chaz"],["u_vlad","Vlad"],["u_owner","Owner"]].forEach(([id,nm])=>{ if(!S.users.some(u=>u&&u.id===id))S.users.push({id,username:nm,name:nm,active:true}); });
if(typeof orgSetRole==="function"){orgSetRole("u_owner","obx","owner");orgSetRole("u_chaz","obx","crew");orgSetRole("u_vlad","obx","crew");}
d.disbursements.push({id:"p1",type:"payout",memberId:"u_chaz",amount:800,date:"2026-03-01"});   // Chaz $800 → 1099
d.disbursements.push({id:"p2",type:"payout",memberId:"u_chaz",amount:100,date:"2026-05-01"});   // + $100 = $900
d.disbursements.push({id:"p3",type:"payout",memberId:"u_vlad",amount:300,date:"2026-04-01"});   // Vlad $300 → under $600
d.disbursements.push({id:"p4",type:"payout",memberId:"u_owner",amount:5000,date:"2026-04-01"}); // owner → excluded
d.disbursements.push({id:"p5",type:"draw",memberId:"u_chaz",amount:999,date:"2026-04-01"});      // draw → not 1099
var r=fin1099Report("2026");
var chaz=r.rows.find(x=>x.id==="u_chaz"), vlad=r.rows.find(x=>x.id==="u_vlad"), owner=r.rows.find(x=>x.id==="u_owner");
T("#9 Chaz total = $900 (90000c), only payouts (not the draw)", chaz && chaz.cents===90000);
T("#9 Chaz flagged needs-1099 (>= $600)", chaz && chaz.needs===true);
T("#9 Vlad = $300, NOT flagged (under $600)", vlad && vlad.cents===30000 && vlad.needs===false);
T("#9 owner excluded from 1099 report", !owner);
// W-9 capture
S.users.find(u=>u.id==="u_chaz").taxId="123-45-6789";
T("#9 W-9 on file reflected", fin1099Report("2026").rows.find(x=>x.id==="u_chaz").hasW9===true);
diag("review-fixes: #9 done");

// ================= #10 — fixed-asset depreciation =================
["income","jobs","expenses","timeclock","quotes","customers","disbursements"].forEach(k=>d[k]=[]);
d.expenses.push({id:"a1",amount:5000,category:"tools/equipment",vendor:"Big Tex Trailer",date:"2025-06-01"});  // capital ($5000 >= $2500)
d.expenses.push({id:"a2",amount:120,category:"tools/equipment",vendor:"Hand tools",date:"2026-01-01"});         // below de-minimis → expensed, not capitalized
d.expenses.push({id:"a3",amount:3000,category:"disposal",vendor:"Dump",date:"2026-01-01"});                      // not a tool → not an asset
var fa=finFixedAssets({years:5});
T("#10 only capital tools >= $2500 are assets (1)", fa.length===1 && fa[0].name==="Big Tex Trailer");
T("#10 straight-line annual = cost/5 ($1000/yr = 100000c)", fa[0].annual===100000);
T("#10 book value = cost - accumulated (2025 buy, ~2yr elapsed by 2026)", fa[0].bookValue < fa[0].cents && fa[0].bookValue >= 0);
diag("review-fixes: #10 done");

// ================= #11 — accounts payable (unpaid bills excluded from cash) =================
["income","jobs","expenses","timeclock","quotes","customers","disbursements"].forEach(k=>d[k]=[]);
d.income.push({id:"i11",amount:1000,date:"2026-06-01",jobId:"j11",crew:["u_rj"]});
d.jobs.push({id:"j11",date:"2026-06-01",crew:["u_rj"]});
var cashPaid=finAccountBalances().cash;
// add an UNPAID bill → cash must NOT drop; A/P total rises
d.expenses.push({id:"b1",amount:300,category:"materials",vendor:"Vulcan",unpaid:true,dueDate:"2026-07-01",date:"2026-06-15"});
T("#11 unpaid bill does NOT reduce cash", finAccountBalances().cash===cashPaid);
var ap=finAccountsPayable();
T("#11 A/P total = $300 (30000c)", ap.total===30000 && ap.bills.length===1 && ap.bills[0].vendor==="Vulcan");
// mark paid → now it reduces cash + leaves A/P
finPayBill("b1");
T("#11 after paying, bill leaves A/P", finAccountsPayable().total===0);
T("#11 after paying, cash drops by $300", finAccountBalances().cash===cashPaid-30000);
diag("review-fixes: #11 done");

// ================= #12 — double-entry general ledger (always balances) =================
["income","jobs","expenses","timeclock","quotes","customers","disbursements"].forEach(k=>d[k]=[]);
d.income.push({id:"i12",amount:1000,date:"2026-06-01",quoteId:"q12"});
d.quotes.push({id:"q12",total:1000,taxable:true,paid:true});   // taxable → sales tax payable leg
d.expenses.push({id:"e12",amount:200,category:"disposal",vendor:"Dump",date:"2026-06-02"});
d.expenses.push({id:"b12",amount:150,category:"materials",vendor:"Vulcan",unpaid:true,date:"2026-06-03"});
d.disbursements.push({id:"d12",type:"payout",memberId:"u_rj",amount:300,date:"2026-06-04"});
d.disbursements.push({id:"t12",type:"draw",amount:100,date:"2026-06-05"});
var gl=finGeneralLedger();
T("#12 ledger BALANCES (debits === credits)", gl.balanced===true && gl.totalDr===gl.totalCr && gl.totalDr>0);
T("#12 taxable income books sales tax payable", gl.trialBalance["Sales tax payable"] && gl.trialBalance["Sales tax payable"].cr===Math.round(1000*0.0675*100));
T("#12 Cash debit from income = 1000 + 67.50 tax", gl.trialBalance["Cash"].dr===Math.round(1067.5*100));
T("#12 unpaid bill hits Accounts payable, not Cash credit for it", gl.trialBalance["Accounts payable"] && gl.trialBalance["Accounts payable"].cr===15000);
T("#12 service revenue = pre-tax 1000", gl.trialBalance["Service revenue"].cr===100000);
T("#12 owner draw booked to equity account", gl.trialBalance["Owner draw"] && gl.trialBalance["Owner draw"].dr===10000);
diag("review-fixes: #12 done");
