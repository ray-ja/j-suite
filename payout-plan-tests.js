/* PAYOUT-PLAN math tests (js/107). Run inside the headless app so the real functions + finance engine load:
 *   node verify-app.js "$(cat payout-plan-tests.js)"
 * Covers popProRata (conservation + cap), popPool (partial payments), popModel (weighted wages, subtract
 * already-paid payouts + fault), popAcceptedIncome (carries job.crewWeights), and popBorrowSums (ledger math).
 * On any failure it console.error()s (which the verify-app harness reports as an error → FAIL); all-pass = clean. */
window.canSee = function () { return true; };   // owner view
let _pf = 0, _pp = 0;
function pok(n, c) { if (c) { _pp++; } else { _pf++; console.error("PAYOUT-TEST FAIL: " + n); } }

/* ---- popProRata: never invents/loses a cent, never exceeds a member's cap ---- */
for (let pot = 0; pot <= 6000; pot += 7) {
  const x = popProRata(pot, { a: 733, b: 220, c: 47 });
  const sum = (x.a || 0) + (x.b || 0) + (x.c || 0);
  pok("popProRata conserves at pot=" + pot, sum === Math.min(pot, 1000));
}
const capped = popProRata(100000, { a: 100, b: 50 });
pok("popProRata caps each id at its weight when pot exceeds total", capped.a === 100 && capped.b === 50);
const zeroPot = popProRata(0, { a: 100 });
pok("popProRata with pot 0 → everyone 0", zeroPot.a === 0);
const noWeight = popProRata(500, {});
pok("popProRata with no weights → empty (nothing to split)", Object.keys(noWeight).length === 0);

/* ---- fresh scenario ---- */
D().jobs = []; D().quotes = []; D().income = []; D().disbursements = []; D().timeclock = []; D().expenses = []; D().docs = (D().docs || []).filter(x => x && x.id !== "taxBorrow");
D().customers = D().customers || [];
S.users = (S.users || []).concat([{ id: "A", username: "Aaa", role: "crew" }, { id: "H", username: "Helper", role: "crew" }]);

/* ---- popPool: counts partial payments/deposits, not just the paid flag ---- */
D().quotes.push({ id: "q1", accepted: true, total: 1000, payments: [{ amount: 400 }] });   // $400 partial, NOT invoiced
const pool1 = popPool();
pok("popPool: $400 partial on a $1000 quote → $400 collected", pool1.collected === 40000);
pok("popPool: the $600 remainder goes to backlog (uninvoiced)", pool1.backlog === 60000);
D().quotes.push({ id: "q2", accepted: true, total: 500, invoiced: true, payments: [] });     // invoiced, unpaid → A/R
const pool2 = popPool();
pok("popPool: an invoiced-unpaid quote's remainder is A/R", pool2.ar === 50000);
pok("popPool: expected = collected + ar + backlog", pool2.expected === pool2.collected + pool2.ar + pool2.backlog);

/* ---- popAcceptedIncome: carries job.crewWeights ---- */
D().jobs.push({ id: "jW", crew: ["A", "H"], date: "2026-07-01", crewWeights: { H: 50 } });
D().quotes.push({ id: "qW", jobId: "jW", accepted: true, total: 1000, acceptedDate: "2026-07-01" });
const acc = popAcceptedIncome().find(x => x.jobId === "jW");
pok("popAcceptedIncome carries the job's crewWeights", acc && acc.weights && acc.weights.H === 50);

/* ---- popModel: weighted wages (A full, H at 50) ---- */
const m = popModel();
pok("popModel: weighted wage — A earns more field than H", m.member.A && m.member.H && m.member.A.wage > m.member.H.wage);
pok("popModel: wage pool conserved (A + H = the job's field pool, split 2:1)", m.member.A.wage === 2 * m.member.H.wage);
const hWageBefore = m.member.H.wage;

/* ---- popModel: subtracts a payout already disbursed ---- */
D().disbursements.push({ id: "d1", type: "payout", memberId: "H", amount: 3, date: "2026-07-02" });   // $3 paid to H
const m2 = popModel();
pok("popModel: a recorded payout reduces that member's remaining wage", m2.member.H.wage < hWageBefore);
pok("popModel: wage floored at 0 (never negative) when overpaid", (function () { D().disbursements.push({ id: "d2", type: "payout", memberId: "H", amount: 9999, date: "2026-07-03" }); const mm = popModel(); return mm.member.H.wage === 0; })());

/* ---- popBorrowSums: tax-reserve ledger running balance ---- */
D().docs.push({ id: "taxBorrow", entries: [{ id: "b1", type: "borrow", amount: 500 }, { id: "r1", type: "repay", amount: 200 }] });
const s = popBorrowSums();
pok("popBorrowSums: borrowed 500, repaid 200, balance 300 (cents)", s.borrowed === 50000 && s.repaid === 20000 && s.balance === 30000);
D().docs.push({ id: "taxBorrow2unused", entries: [] });
const overRepay = (function () { const d = D().docs.find(x => x.id === "taxBorrow"); d.entries.push({ id: "r2", type: "repay", amount: 9999 }); return popBorrowSums().balance; })();
pok("popBorrowSums: over-repayment floors the balance at 0 (never negative)", overRepay === 0);

// Failures already console.error()'d above (the verify-app harness reports those as errors → FAIL). On all-pass
// we stay silent so the harness prints its own "PASS". _pp/_pf are left as a summary for anyone reading inline.
if (_pf > 0) console.error("PAYOUT-PLAN TESTS: " + _pf + " FAILED, " + _pp + " passed");
