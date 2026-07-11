/* Square invoice reconciliation (js/108) — run: node verify-app.js "(cat square-invoice-tests.js)"
   Parse, customer-level reconcile, commit+dedupe, and Phase-2 invoice-wins apply/undo income math.
   save/render stubbed (headless save hangs); emits SQINV-OK / SQINV-FAIL. */
window.save = function () {}; window.render = function () {}; window.syncNow = function () {};
window.toast = function () {}; window.closeModal = function () {}; window.finCanView = function () { return true; };
window.logChange = function () {};
var fails = [], d = D();
function ok(n, c) { if (!c) fails.push(n); }
["customers", "quotes", "invoices", "income", "jobs"].forEach(function (k) { d[k] = []; });
d.customers.push({ id: "cM", name: "Michelle Brown", phone: "+12524239195" });
d.customers.push({ id: "cV", name: "Virginia Tucker", phone: "+13042613711" });
d.jobs.push({ id: "jM1", crew: ["u1", "u2"], materials: [{ id: "mM1", amount: 400 }] });   // $400 pass-through on Michelle's $960 job
d.quotes.push({ id: "qM1", customerId: "cM", total: 960, paid: true, jobId: "jM1", items: [{ name: "Junk" }] });
d.quotes.push({ id: "qM2", customerId: "cM", total: 720, paid: true, items: [{ name: "Custom price" }], title: "Moving Labor" });
d.quotes.push({ id: "qV1", customerId: "cV", total: 192, paid: true, items: [{ name: "J" }] });
d.quotes.push({ id: "qV2", customerId: "cV", total: 285, paid: true, items: [{ name: "J" }] });
var H = "Invoice Token,Invoice Date,Time Zone,Invoice ID,Customer Name,Customer Email,Customer Phone,Invoice Title,Status,Requested Amount,Due Date,Last Payment Date,Amount Paid,Recurring Series ID,Invoice Delivery Method,Number of Installments,Tip Amount,Automatic Payment Source,Service date";
var csv = [H,
  "a5,d,ET,#5,Virginia Tucker,,+13042613711,,Paid,192.00,d,d,192.00,,T,1,0.00,N,d",
  "a3,d,ET,#3,Virginia Tucker,,+13042613711,Pickup,Paid,285.00,d,d,285.00,,T,1,0.00,N,d",
  "a2,d,ET,#2,Michelle Brown,,+12524239195,Moving Labor,Paid,960.00,d,d,960.00,,S,1,0.00,N,d",
  "aU,d,ET,#6,X,,+15550000000,Deck,Unpaid,500.00,d,,0.00,,T,1,0.00,N,d"].join("\n");
var parsed = sqInvParse(csv), paid = parsed.filter(function (p) { return /paid/i.test(p.status) && p.amountPaid > 0; });
ok("parse: paid-only = 3 of 4", paid.length === 3 && parsed.length === 4);
var R = sqReconcile(paid);
ok("reconcile: over-book = 720 (Michelle), Virginia clean", Math.round(R.cust.cM.over) === 720 && R.cust.cV.over < 0.5);
SQIMP = { all: parsed, list: paid }; sqInvCommit(); ok("commit: 3 stored", actInvoices().length === 3);
SQIMP = { all: parsed, list: paid }; sqInvCommit(); ok("commit: dedupe still 3", actInvoices().length === 3);
d.quotes.forEach(function (q) { syncQuoteIncome(q); });
var inc = function () { return D().income.filter(function (x) { return x && !x.deleted; }).reduce(function (a, e) { return a + (+e.amount || 0); }, 0); };
ok("income before apply = 2157", inc() === 2157);
sqInvApplyCustomer("cM");
ok("apply Michelle: books inc_sq 960, claims qM1, orphan qM2 KEPT pending choice (still 2157)", inc() === 2157 && !!D().income.find(function (x) { return x.id === "inc_sq_a2" && x.amount === 960; }) && !!D().quotes.find(function (q) { return q.id === "qM1"; }).reconciledInvoiceId);
sqInvOrphanResolve("qM2", "dup", "cM"); ok("resolve orphan qM2 as DUPLICATE → drops 720 → 1437", inc() === 1437 && D().quotes.find(function (q) { return q.id === "qM2"; }).reconciledDuplicate === true);
sqInvApplyCustomer("cV"); ok("apply Virginia (both claimed, no orphan): unchanged 1437", inc() === 1437);
sqInvUnapplyCustomer("cM"); ok("undo Michelle: back to 2157 (qM2 kept-flag cleared, re-booked)", inc() === 2157);

// ---- #1 FIX: Square-reconciled income carries jobId/jobIds so pass-through materials net off the split base ----
sqInvApplyCustomer("cM");
var sqInc = D().income.find(function (x) { return x.id === "inc_sq_a2" && !x.deleted; });
ok("inc_sq_a2 carries jobId of its backing job (jM1)", sqInc && sqInc.jobId === "jM1");
ok("inc_sq_a2 carries jobIds array", sqInc && Array.isArray(sqInc.jobIds) && sqInc.jobIds.indexOf("jM1") >= 0);
ok("finPassThroughForIncome(sq income) = $400 (40000c) via jobId", finPassThroughForIncome(sqInc) === 40000);
var sqSplit = finJobSplit(sqInc);
ok("Square split base nets the $400 materials: gross 96000 - 40000 = 56000", sqSplit.gross === 96000 && sqSplit.passThrough === 40000 && sqSplit.amount === 56000);
ok("Square labor pool now on labor value only (60% of 56000 = 33600)", sqSplit.labor === 33600);
// combo (multi-job) income: jobIds sums pass-through across jobs
d.jobs.push({ id: "jX", materials: [{ id: "mx", amount: 100 }] });
ok("jobIds combo sums pass-through across jobs ($400 + $100)", finPassThroughForIncome({ jobIds: ["jM1", "jX"] }) === 50000);
sqInvUnapplyCustomer("cM");

if (fails.length) console.error("SQINV-FAIL: " + fails.join(" | "));
else diag("SQINV-OK: parse, reconcile, commit+dedupe, apply/undo, + #1 jobId pass-through netting");
