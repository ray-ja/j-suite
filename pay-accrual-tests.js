/* pay-accrual-tests.js — pay accrues on job completion (js/86 payAccruedIncome). Pure node. */
global.window = global;   // js/86 hangs helpers on window at load; only the pure helper is exercised here
const P = require("./js/86-my-pay.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
const jobs = [
  { id: "j1", quoteId: "q1", done: true, crew: ["a", "b"], completedAt: Date.parse("2026-09-20T15:00:00Z"), date: "2026-09-19" },
  { id: "j2", quoteId: "q2", done: true, crew: ["a"], date: "2026-09-10" },
  { id: "j3", quoteId: "q3", done: false, crew: ["a"], date: "2026-09-25" },
  { id: "j4", quoteId: "q4", done: true, crew: ["b"], date: "2026-09-01" },
  { id: "j5", quoteId: "q5", done: true, crew: ["b"], date: "2026-09-02" },
  { id: "j6", quoteId: "q6", done: true, crew: ["b"], date: "2026-09-03", deleted: true },
];
const quotes = [
  { id: "q1", invoiced: true, paid: false, finalPrice: 2235, total: 2000, acceptedDate: "2026-09-15", date: "2026-09-14" },
  { id: "q2", accepted: true, paid: true, total: 500 },
  { id: "q3", accepted: true, paid: false, total: 800 },
  { id: "q4", accepted: true, paid: false, total: 300, noSalesCredit: true, originator: "z" },
  { id: "q5", accepted: true, paid: false, total: 150, reconciledInvoiceId: "sq1" },
  { id: "q6", accepted: true, paid: false, total: 99 },
];
const acc = P.payAccruedIncome(jobs, quotes, [{ id: "inc_q_q2", quoteId: "q2" }]);
eq(acc.map(e => e.id), ["acc_q_q1", "acc_q_q4"], "done + unpaid + not reconciled + not already booked + not deleted accrue");
eq(acc[0].amount, 2235, "the final price, not the quote total");
eq(acc[0].date, "2026-09-20", "dated the day it was finished");
eq(acc[0].crew, ["a", "b"], "the job's crew");
eq(acc[1].date, "2026-09-01", "no completion stamp → the job date");
eq(acc[1].originator, "", "noSalesCredit → no originator");
eq(P.payAccruedIncome(jobs, quotes, [{ id: "inc_q_q1", quoteId: "q1" }, { id: "inc_q_q2", quoteId: "q2" }]).map(e => e.id), ["acc_q_q4"], "a booked income record wins over accrual");
eq(P.payAccruedIncome([], [], []), [], "empty");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
