/* SQUARE INVOICE IMPORT + RECONCILIATION tests (js/108) — run via the verify-app harness:
     node verify-app.js "(cat square-invoice-tests.js)"
   Covers: CSV parse, customer-level reconcile (per-invoice claim + over-book detection), commit+dedupe, and the
   Phase-2 invoice-wins apply/undo income math (the finance-critical part). save()/render() are stubbed (the
   headless fixture's real save hangs); every other path is the real module code. Emits SQINV-OK / SQINV-FAIL. */
(function () {
  var fails = [];
  function ok(name, cond) { if (!cond) fails.push(name); }
  window.save = function () {}; window.render = function () {}; window.syncNow = function () {};
  window.toast = function () {}; window.closeModal = function () {}; window.finCanView = function () { return true; };
  window.logChange = function () {};
  var d = D(); ["customers", "quotes", "invoices", "income", "jobs"].forEach(function (k) { d[k] = []; });
  d.customers.push({ id: "cM", name: "Michelle Brown", phone: "+12524239195" });
  d.customers.push({ id: "cV", name: "Virginia Tucker", phone: "+13042613711" });
  d.customers.push({ id: "cC", name: "Christina Brodeur", phone: "+12524754152" });
  d.jobs.push({ id: "jM1", crew: ["u1", "u2"] }); d.jobs.push({ id: "jM2", crew: ["u1"] });
  d.quotes.push({ id: "qM1", customerId: "cM", total: 960, paid: true, jobId: "jM1", items: [{ name: "Junk" }] });
  d.quotes.push({ id: "qM2", customerId: "cM", total: 720, paid: true, jobId: "jM2", items: [{ name: "Custom price" }], title: "Moving Labor" });
  d.quotes.push({ id: "qV1", customerId: "cV", total: 192, paid: true, items: [{ name: "Junk" }] });
  d.quotes.push({ id: "qV2", customerId: "cV", total: 285, paid: true, items: [{ name: "Junk" }] });
  d.quotes.push({ id: "qC1", customerId: "cC", total: 290, paid: true, items: [{ name: "Junk" }] });

  // ---- PARSE (the real Square export column layout) ----
  var H = "Invoice Token,Invoice Date,Time Zone,Invoice ID,Customer Name,Customer Email,Customer Phone,Invoice Title,Status,Requested Amount,Due Date,Last Payment Date,Amount Paid,Recurring Series ID,Invoice Delivery Method,Number of Installments,Tip Amount,Automatic Payment Source,Service date";
  var csv = [H,
    "inv:tok5,2026-06-19,ET,#000005,Virginia Tucker,,+13042613711,,Paid,192.00,2026-06-19,2026-06-19,192.00,,Text,1,0.00,None,2026-06-19",
    "inv:tok3,2026-06-12,ET,#000003,Virginia Tucker,,+13042613711,Item Pickup,Paid,285.00,2026-06-12,2026-06-12,285.00,,Text,1,0.00,None,2026-06-12",
    "inv:tok2,2026-06-10,ET,#000002,Michelle Brown,michelle@x.com,+12524239195,Moving Labor,Paid,960.00,2026-06-10,2026-06-10,960.00,,Share,1,0.00,None,2026-06-10",
    "inv:tok1,2026-06-04,ET,#000001,Christina Brodeur,,+12524754152,Shed,Paid,290.00,2026-06-04,2026-06-11,290.00,,Text,1,0.00,None,2026-06-04",
    "inv:tokU,2026-06-20,ET,#000006,Nobody Owes,,+15550000000,Deck,Unpaid,500.00,2026-06-27,,0.00,,Text,1,0.00,None,2026-06-20"].join("\n");
  var parsed = sqInvParse(csv);
  ok("parse: 5 invoices", parsed.length === 5);
  ok("parse: 960.00 -> 960 dollars", parsed[2].amountPaid === 960 && parsed[2].invoiceNo === "#000002");
  var paidOnly = parsed.filter(function (p) { return /paid/i.test(p.status) && p.amountPaid > 0; });
  ok("parse: unpaid invoice excluded (paid-only)", paidOnly.length === 4);

  // ---- RECONCILE (customer-level) ----
  var R = sqReconcile(paidOnly);
  ok("reconcile: truth = 1,727 (sum of paid invoices)", Math.round(R.truth) === 1727);
  ok("reconcile: booked = 2,447 (sum of matched customers' paid quotes)", Math.round(R.booked) === 2447);
  ok("reconcile: delta = 720 over-booked", Math.round(R.delta) === 720);
  var byNo = {}; R.rows.forEach(function (r) { byNo[r.inv.invoiceNo] = r; });
  ok("reconcile: Virginia's 2 invoices each claim their own quote (per-invoice, not per-total)", byNo["#000005"].quoteIds[0] === "qV1" && byNo["#000003"].quoteIds[0] === "qV2");
  ok("reconcile: over-book is Michelle's alone (orphan qM2 720)", Math.round(R.cust.cM.over) === 720 && R.cust.cM.orphans.length === 1 && R.cust.cM.orphans[0].id === "qM2");
  ok("reconcile: Virginia + Christina NOT over-booked (no false positive)", R.cust.cV.over < 0.5 && R.cust.cC.over < 0.5);

  // ---- COMMIT + dedupe ----
  window.SQIMP = { all: parsed, list: paidOnly }; sqInvCommit();
  ok("commit: 4 paid invoices stored", actInvoices().length === 4);
  ok("commit: stored customerId + quoteIds + reconciled=false", (function () { var iv = actInvoices().find(function (x) { return x.invoiceNo === "#000002"; }); return iv && iv.customerId === "cM" && iv.quoteIds[0] === "qM1" && iv.reconciled === false; })());
  window.SQIMP = { all: parsed, list: paidOnly }; sqInvCommit();
  ok("commit: re-import dedupes on the Square token (still 4)", actInvoices().length === 4);

  // ---- income before apply (each paid quote booked its own) ----
  d.quotes.forEach(function (q) { syncQuoteIncome(q); });
  var inc = function () { return (D().income || []).filter(function (x) { return x && !x.deleted; }).reduce(function (a, e) { return a + (+e.amount || 0); }, 0); };
  ok("income before apply = 2,447 (all quotes)", inc() === 2447);

  // ---- APPLY Michelle (invoice wins) ----
  sqInvApplyCustomer("cM");
  ok("apply Michelle: income drops to 1,727 (her 1,680 quotes -> the 960 invoice)", inc() === 1727);
  ok("apply Michelle: inc_sq booked at 960", (function () { var e = D().income.find(function (x) { return x.id === "inc_sq_inv:tok2"; }); return e && e.amount === 960 && !e.deleted; })());
  ok("apply Michelle: both her inc_q tombstoned (no double count)", D().income.find(function (x) { return x.id === "inc_q_qM1"; }).deleted === true && D().income.find(function (x) { return x.id === "inc_q_qM2"; }).deleted === true);
  ok("apply Michelle: orphan qM2 flagged reconciledDuplicate, claimed qM1 not", D().quotes.find(function (q) { return q.id === "qM2"; }).reconciledDuplicate === true && D().quotes.find(function (q) { return q.id === "qM1"; }).reconciledDuplicate === false);
  ok("apply Michelle: inc_sq carries crew from the linked jobs", (function () { var e = D().income.find(function (x) { return x.id === "inc_sq_inv:tok2"; }); return e.crew.indexOf("u1") >= 0 && e.crew.indexOf("u2") >= 0; })());
  ok("apply Michelle: her invoice marked reconciled", actInvoices().find(function (x) { return x.id === "inv:tok2"; }).reconciled === true);

  // ---- APPLY Virginia (2 invoices -> 2 quotes, net unchanged) ----
  sqInvApplyCustomer("cV");
  ok("apply Virginia: income unchanged (she was never over-booked) = 1,727", inc() === 1727);

  // ---- UNDO Michelle ----
  sqInvUnapplyCustomer("cM");
  ok("undo Michelle: income back to 2,447 (quotes re-book)", inc() === 2447);
  ok("undo Michelle: reconciledInvoiceId cleared", !D().quotes.find(function (q) { return q.id === "qM1"; }).reconciledInvoiceId && !actInvoices().find(function (x) { return x.id === "inv:tok2"; }).reconciled);

  if (fails.length) console.error("SQINV-FAIL: " + fails.join(" | "));
  else console.error("SQINV-OK: all " + 22 + " checks passed (parse, reconcile, commit+dedupe, apply/undo income math)");
})();
