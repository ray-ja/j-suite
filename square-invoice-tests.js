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
d.jobs.push({ id: "jM1", crew: ["u1", "u2"] });
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
sqInvApplyCustomer("cM"); ok("apply Michelle: 2157 -> 1437 (books 960, drops 1680)", inc() === 1437);
ok("apply: orphan qM2 flagged duplicate + inc_sq booked", D().quotes.find(function (q) { return q.id === "qM2"; }).reconciledDuplicate === true && !!D().income.find(function (x) { return x.id === "inc_sq_a2" && x.amount === 960; }));
sqInvApplyCustomer("cV"); ok("apply Virginia: unchanged 1437", inc() === 1437);
sqInvUnapplyCustomer("cM"); ok("undo Michelle: back to 2157", inc() === 2157);
if (fails.length) console.error("SQINV-FAIL: " + fails.join(" | "));
else console.error("SQINV-OK: parse, reconcile(over720), commit+dedupe, apply/undo income math");
