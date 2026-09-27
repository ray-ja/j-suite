/* money-tiles-tests.js — cash on hand, fixed costs, delta (js/200). Pure node. */
const M = require("./js/200-money-tiles.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
/* recurring vendors */
const ex = [
  { vendor: "Square", amount: 33, date: "2026-08-03" }, { vendor: "Square", amount: 33, date: "2026-09-03" },
  { vendor: "Next Insurance", amount: 61, date: "2026-07-10" }, { vendor: "Next Insurance", amount: 61, date: "2026-08-10" }, { vendor: "Next Insurance", amount: 64, date: "2026-09-10" },
  { vendor: "Lowe's", amount: 360, date: "2026-06-25" }, { vendor: "Lowe's", amount: 264, date: "2026-07-25" },
  { vendor: "Ace Hardware", amount: 944, date: "2026-06-05" },
  { vendor: "Rj · skid steer", amount: 473.17, date: "2026-09-14", source: "installment" },
  { vendor: "Old", amount: 5, date: "2026-05-01" }, { vendor: "Old", amount: 5, date: "2026-04-01" },
];
const rec = M.mtRecurringVendors(ex, "2026-09-27");
eq(rec.map(r => r.vendor), ["Next Insurance", "Square"], "two-of-three-months vendors, biggest first; June-only, installment postings and old ones excluded");
eq(rec[0].monthly, 61, "median of the monthly totals");
eq(rec[1].months, 2, "months seen");
eq(M.mtRecurringVendors([], "2026-09-27"), [], "empty");
/* installments due */
const plans = [
  { id: "skid", label: "Skid steer", payeeName: "Rj", total: 5678.09, count: 12, start: "2026-09", paidNs: [1], paidBy: "ray" },
  { id: "trailer", label: "Trailer", payeeName: "Chase", total: 10541.74, count: 24, start: "2026-07", paidNs: [] },
  { id: "done", label: "Done", total: 100, count: 1, start: "2026-01", paidNs: [1] },
  { id: "future", label: "Later", total: 100, count: 2, start: "2026-11", paidNs: [] },
  { id: "gone", label: "Gone", total: 100, count: 2, start: "2026-01", paidNs: [], deleted: true },
];
const due = M.mtInstallmentsDue(plans, "2026-09");
eq(due.map(d => d.plan + ":" + d.n), ["trailer:1"], "September: skid #1 is logged so nothing more this month; the trailer's first unpaid is due (July, overdue); done/future/deleted skip");
eq(due[0].amount, 439.24, "per-payment amount");
eq(M.mtInstallmentsDue(plans, "2026-10").map(d => d.plan + ":" + d.n), ["skid:2", "trailer:1"], "October: skid #2 comes due, trailer #1 still unpaid (one per plan per month)");
eq(M.mtInstallmentsDue([{ id: "x", total: 100, count: 3, start: "2026-08", paidNs: [] }], "2026-10")[0].amount, 33.33, "rounding: middle payments");
eq(M.mtInstallmentsDue([{ id: "x", total: 100, count: 3, start: "2026-08", paidNs: [1, 2] }], "2026-10")[0].amount, 33.34, "the last payment absorbs the remainder");
/* partner debt */
eq(M.mtPartnerDebt(plans).map(r => r.plan + ":" + r.remaining), ["skid:5204.92", "trailer:10541.74", "future:100"], "remaining per open plan; the paid-off and deleted ones drop");
eq(M.mtPartnerDebt([]), [], "empty");
/* cash pick */
const accts = [
  { id: "a", name: "Square — OBX Lot Solutions", type: "checking", balance: 106.44 },
  { id: "b", name: "Jamieson — Business Checking", type: "checking", balance: 246.06 },
  { id: "c", name: "RJ's NFCU Credit Card", type: "credit", balance: -23709 },
  { id: "d", name: "Jamieson — Business Savings", type: "savings", balance: 5 },
];
eq(M.mtCashPick(accts, null, "OBX Lot Solutions").map(a => a.id), ["a"], "default: name match on the org's first word");
eq(M.mtCashPick(accts, null, "Jamieson Automation").map(a => a.id), ["b", "d"], "Jamieson picks both its accounts");
eq(M.mtCashPick(accts, ["b"], "OBX Lot Solutions").map(a => a.id), ["b"], "a saved pick wins over the name match");
eq(M.mtCashPick(accts, ["c"], "x"), [], "a credit card is never cash, even if picked");
eq(M.mtCashPick([], null, "x"), [], "empty");
/* delta */
eq(M.mtDelta(10644, 94500, 490800), -574656, "cash − fixed − owed, in cents");
eq(M.mtDelta(0, 0, 0), 0, "zero");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
