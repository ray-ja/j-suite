/* recurring-engine-tests.js — the pure-engine test suite for RECURRING SERVICE Phase 1 (js/102-recurring.js).
 * Pure Node (no Chrome, no server). Covers: each frequency's date math (weekly / biweekly / monthly-date /
 * monthly-nthWeekday / quarterly / seasonal-skip+jump / custom), recurMonthlyEquiv per frequency, and the
 * recurMaterialize rolling generator — idempotency (run twice → no dupes via deterministic ids), deleted-stays-
 * deleted (a tombstoned occurrence is never regenerated), the 28-day horizon boundary, the once/day guard, and
 * end conditions (count / date). Run: node recurring-engine-tests.js   (exit 0 = green) */
const R = require("./js/102-recurring.js");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }
function eq(a, b, m) { ok(a === b, m + "  (got " + JSON.stringify(a) + (a === b ? "" : ", want " + JSON.stringify(b)) + ")"); }

/* ---- env for the engine (recurMaterialize/recurMakeOccurrence read app globals) ---- */
function withEnv(store, todayStr, fn) {
  global.D = () => store; global.S = {}; global.today = () => todayStr;
  global.now = () => 1; global.save = () => {}; global.touch = (r) => { r.updatedAt = 1; return r; };
  try { return fn(global.S); } finally { delete global.D; delete global.S; delete global.today; delete global.now; delete global.save; delete global.touch; }
}
const liveRec = store => store.jobs.filter(j => j && !j.deleted && /^recjob_/.test(j.id));

/* ================= 1) FREQUENCY DATE MATH ================= */
console.log("— frequency math —");
eq(R.recurAdvance({ frequency: "weekly" }, "2026-07-01"), "2026-07-08", "weekly advances +7");
eq(R.recurAdvance({ frequency: "biweekly" }, "2026-07-01"), "2026-07-15", "biweekly advances +14");
// monthly (date mode): next month, same day-of-month
eq(R.recurAdvance({ frequency: "monthly", dayOfMonth: 15 }, "2026-07-15"), "2026-08-15", "monthly-date advances to next month's day-of-month");
// monthly (date mode) clamp: day 31 → clamped to 28 so every month has it
eq(R.recurAdvance({ frequency: "monthly", dayOfMonth: 31 }, "2026-02-10"), "2026-03-28", "monthly-date clamps day 31 → 28");
// month-overflow safety: December → January of next YEAR, never a bogus month 13
eq(R.recurAdvance({ frequency: "monthly", dayOfMonth: 10 }, "2026-12-10"), "2027-01-10", "monthly-date rolls Dec → next Jan (no month-13 bug)");
// monthly (nthWeekday): 2nd Tuesday of next month
const nw = R.recurAdvance({ frequency: "monthly", monthlyMode: "nthWeekday", weekday: 2, nthWeek: 2 }, "2026-07-20");
ok(new Date(nw + "T12:00:00").getDay() === 2 && +nw.slice(8, 10) >= 8 && +nw.slice(8, 10) <= 14 && nw.slice(0, 7) === "2026-08", "monthly-nthWeekday → 2nd Tuesday of Aug (" + nw + ")");
// nthWeekday clamp-to-last: 5th Friday when the month has only 4 → last Friday, still in-month
const nw5 = R.recurNthWeekday(2026, 1, 5, 5);   // Feb 2026, 5th Friday (doesn't exist)
ok(new Date(nw5 + "T12:00:00").getDay() === 5 && nw5.slice(0, 7) === "2026-02", "nthWeekday clamps 5th→last Friday, stays in month (" + nw5 + ")");
// quarterly: +3 months on the anchor day
eq(R.recurAdvance({ frequency: "quarterly", dayOfMonth: 10 }, "2026-07-10"), "2026-10-10", "quarterly advances +3 months on anchor");
// custom: interval in DAYS, or interval in WEEKS
eq(R.recurAdvance({ frequency: "custom", intervalDays: 10 }, "2026-07-01"), "2026-07-11", "custom advances +intervalDays");
eq(R.recurAdvance({ frequency: "custom", interval: 2 }, "2026-07-01"), "2026-07-15", "custom advances +interval*7 when no intervalDays");

/* ================= 2) SEASONAL ================= */
console.log("— seasonal —");
const summer = { frequency: "seasonal", seasonStart: "06-01", seasonEnd: "08-31", interval: 1 };
ok(R.recurInSeason(summer, "2026-07-15") === true, "in-season: Jul 15 inside Jun-Aug");
ok(R.recurInSeason(summer, "2026-09-15") === false, "out-of-season: Sep 15 outside Jun-Aug");
// advancing past season end jumps to NEXT year's season start
eq(R.recurAdvance(summer, "2026-08-25"), "2027-06-01", "seasonal jumps past season end → next season start");
// year-wrapping season (winter)
const winter = { frequency: "seasonal", seasonStart: "11-01", seasonEnd: "02-28" };
ok(R.recurInSeason(winter, "2026-01-15") === true, "wrap-season: Jan 15 inside Nov-Feb");
ok(R.recurInSeason(winter, "2026-06-15") === false, "wrap-season: Jun 15 outside Nov-Feb");

/* ================= 3) recurMonthlyEquiv (Phase-3 MRR helper) ================= */
console.log("— monthly-equivalent (MRR) —");
eq(R.recurMonthlyEquiv({ frequency: "weekly", price: 100 }), 433.33, "weekly ≈ 4.333×");
eq(R.recurMonthlyEquiv({ frequency: "biweekly", price: 100 }), 216.67, "biweekly ≈ 2.167×");
eq(R.recurMonthlyEquiv({ frequency: "monthly", price: 100 }), 100, "monthly = 1×");
eq(R.recurMonthlyEquiv({ frequency: "quarterly", price: 100 }), 33.33, "quarterly ≈ 0.333×");
eq(R.recurMonthlyEquiv({ frequency: "seasonal", price: 100, visits: 6 }), 50, "seasonal = visits÷12 × price");
eq(R.recurMonthlyEquiv({ frequency: "custom", price: 100, intervalDays: 10 }), 300, "custom = 30÷intervalDays × price");
eq(R.recurMonthlyEquiv({ frequency: "weekly", price: 100, discountPct: 20 }), 346.67, "20% discount applied to the monthly-equiv");

/* ================= 4) recurMaterialize — horizon, idempotency, dedup, guards, end ================= */
console.log("— recurMaterialize —");
// 4a) 28-day horizon boundary: weekly from today → occurrences on 01,08,15,22,29; 08-05 (day 35) excluded
(function () {
  const store = { jobs: [], recurringPlans: [{ id: "rp1", frequency: "weekly", status: "active", startDate: "2026-07-01", crew: [], estDays: 1, generatedJobIds: [] }] };
  const ch = withEnv(store, "2026-07-01", () => R.recurMaterialize());
  const dates = liveRec(store).map(j => j.occurrenceDate).sort();
  ok(ch === true, "materialize returns changed=true when it generates");
  eq(dates.length, 5, "horizon: exactly 5 weekly occurrences within today+28d");
  ok(dates[0] === "2026-07-01" && dates[4] === "2026-07-29", "horizon: last occurrence is exactly +28d (2026-07-29), boundary inclusive");
  ok(dates.indexOf("2026-08-05") < 0, "horizon: the +35d occurrence is NOT generated");
  ok(liveRec(store).every(j => j.planId === "rp1" && j.id === "recjob_rp1_" + j.occurrenceDate && j.done === false), "generated jobs carry planId + deterministic id + done:false");
})();
// 4b) idempotency: run TWICE (reset the once/day guard) → identical job set, no dupes
(function () {
  const store = { jobs: [], recurringPlans: [{ id: "rp1", frequency: "weekly", status: "active", startDate: "2026-07-01", crew: [], estDays: 1, generatedJobIds: [] }] };
  withEnv(store, "2026-07-01", () => R.recurMaterialize());
  const after1 = liveRec(store).length;
  // reset the plan's nextDue is kept; clear the day-guard by running in a fresh env (S is per-call)
  const ch2 = withEnv(store, "2026-07-01", () => R.recurMaterialize());
  const after2 = liveRec(store).length;
  eq(after1, 5, "first run generated 5");
  eq(after2, 5, "second run generated 0 new (deterministic ids dedupe)");
  ok(ch2 === false, "second run reports changed=false (nothing new)");
  const ids = store.jobs.map(j => j.id);
  ok(new Set(ids).size === ids.length, "no duplicate job ids after two runs");
  const plan = store.recurringPlans[0];
  ok(plan.generatedJobIds.length === 5 && new Set(plan.generatedJobIds).size === 5, "plan.generatedJobIds has 5 unique entries (no dupes)");
})();
// 4c) deleted-stays-deleted: a tombstoned occurrence is NOT regenerated
(function () {
  const store = { jobs: [{ id: "recjob_rp1_2026-07-08", planId: "rp1", occurrenceDate: "2026-07-08", deleted: true, updatedAt: 1 }],
    recurringPlans: [{ id: "rp1", frequency: "weekly", status: "active", startDate: "2026-07-01", crew: [], estDays: 1, generatedJobIds: [] }] };
  withEnv(store, "2026-07-01", () => R.recurMaterialize());
  ok(liveRec(store).every(j => j.occurrenceDate !== "2026-07-08"), "deleted occurrence (07-08) is NOT regenerated");
  ok(store.jobs.filter(j => j.id === "recjob_rp1_2026-07-08").length === 1, "the tombstone still exists exactly once");
  eq(liveRec(store).length, 4, "the other 4 in-horizon occurrences still generate");
})();
// 4d) once/day guard: a second run in the SAME env (S.recurLastRun set) is a no-op
(function () {
  const store = { jobs: [], recurringPlans: [{ id: "rp1", frequency: "weekly", status: "active", startDate: "2026-07-01", crew: [], estDays: 1, generatedJobIds: [] }] };
  withEnv(store, "2026-07-01", (S) => {
    const c1 = R.recurMaterialize();
    const n1 = liveRec(store).length;
    const c2 = R.recurMaterialize();   // same S → S.recurLastRun === today → skip
    ok(c1 === true && c2 === false && liveRec(store).length === n1, "once/day guard: same-day re-run is a no-op (S.recurLastRun)");
  });
})();
// 4e) empty collection → true no-op (Phase 1 reality)
(function () {
  const store = { jobs: [], recurringPlans: [] };
  const ch = withEnv(store, "2026-07-01", () => R.recurMaterialize());
  ok(ch === false && store.jobs.length === 0, "empty recurringPlans → no-op (no jobs, changed=false)");
})();
// 4f) end by COUNT: caps generation then marks the plan ended
(function () {
  const store = { jobs: [], recurringPlans: [{ id: "rp1", frequency: "weekly", status: "active", startDate: "2026-07-01", crew: [], estDays: 1, endMode: "count", count: 3, generatedJobIds: [] }] };
  withEnv(store, "2026-07-01", () => R.recurMaterialize());
  eq(liveRec(store).length, 3, "endMode count: exactly `count` occurrences generated");
  eq(store.recurringPlans[0].status, "ended", "endMode count: plan flips to 'ended' when reached");
})();
// 4g) end by DATE: occurrences after endDate are not generated
(function () {
  const store = { jobs: [], recurringPlans: [{ id: "rp1", frequency: "weekly", status: "active", startDate: "2026-07-01", crew: [], estDays: 1, endMode: "date", endDate: "2026-07-16", generatedJobIds: [] }] };
  withEnv(store, "2026-07-01", () => R.recurMaterialize());
  const dates = liveRec(store).map(j => j.occurrenceDate).sort();
  ok(dates.every(d => d <= "2026-07-16"), "endMode date: no occurrence past endDate");
  eq(dates.length, 3, "endMode date: 07-01,07-08,07-15 generated; 07-22 past endDate excluded");
})();
// 4h) estDays → multi-day workDays on the generated job
(function () {
  const store = { jobs: [], recurringPlans: [{ id: "rp1", frequency: "monthly", dayOfMonth: 5, status: "active", startDate: "2026-07-01", crew: ["u1"], estDays: 3, generatedJobIds: [] }] };
  withEnv(store, "2026-07-01", () => R.recurMaterialize());
  const j = liveRec(store)[0];
  ok(j && Array.isArray(j.workDays) && j.workDays.length === 3 && j.workDays[0] === j.occurrenceDate, "estDays:3 → 3 consecutive workDays starting at the occurrence date");
})();

/* ================= 5) PHASE 3 — quote-per-occurrence, recurMRR, finance-invariance ================= */
console.log("— phase 3: quote-per-occurrence + MRR + finance invariance —");

/* env that also provides custName + nextQuoteNum (the quote path reads them via typeof guards) */
function withEnv3(store, todayStr, fn) {
  global.custName = id => { const c = (store.customers || []).find(x => x && x.id === id); return c ? (c.name || c.company || "—") : "—"; };
  global.nextQuoteNum = () => (store.quotes || []).reduce((m, q) => Math.max(m, +q.num || 0), 0) + 1;
  try { return withEnv(store, todayStr, fn); } finally { delete global.custName; delete global.nextQuoteNum; }
}
const liveRecQ = store => (store.quotes || []).filter(q => q && !q.deleted && /^recq_/.test(q.id));
/* the finance surfaces a recurring quote MUST NOT move (it's unpaid/uninvoiced): A/R, income count, billing fp */
function arCents(store) { return (store.quotes || []).filter(q => q && !q.deleted && q.invoiced && !q.paid).reduce((s, q) => s + Math.round((+(q.finalPrice || q.total) || 0) * 100), 0); }
function incCount(store) { return (store.income || []).filter(e => e && !e.deleted).length; }
function billFP(store) {
  let mat = 0, exp = 0, biz = 0;
  (store.jobs || []).forEach(j => { if (!j || j.deleted) return;
    (j.materials || []).forEach(m => { if (m && !m.deleted) mat += Math.round((+m.amount || 0) * 100); });
    (j.expenses || []).forEach(e => { if (e && !e.deleted) exp += Math.round((+e.amount || 0) * 100); });
  });
  (store.expenses || []).forEach(e => { if (e && !e.deleted) biz += Math.round((+e.amount || 0) * 100); });
  return mat + "|" + exp + "|" + biz;
}

// 5a) autoQuote ON → each occurrence makes BOTH a recjob_ job AND a recq_ quote (deterministic, 20% off, unbilled)
(function () {
  const store = {
    customers: [{ id: "c1", name: "Alpha Cust" }],
    quotes: [{ id: "q_ar", customerId: "c1", total: 800, finalPrice: 800, invoiced: true, paid: false }],   // an existing A/R invoice
    income: [{ id: "in_old", quoteId: "q_paid", amount: 300, deleted: false }],                              // an existing income record
    jobs: [],
    expenses: [{ id: "be1", amount: 99.5 }],
    recurringPlans: [{ id: "rp1", customerId: "c1", propertyId: "pr1", title: "Weekly house-watch", serviceId: "hw1",
      price: 40, discountPct: 20, frequency: "weekly", status: "active", startDate: "2026-07-01", crew: ["u1"], estDays: 1,
      autoQuote: true, generatedJobIds: [] }]
  };
  const arBefore = arCents(store), incBefore = incCount(store), fpBefore = billFP(store);

  const ch = withEnv3(store, "2026-07-01", () => R.recurMaterialize());
  const jobs = liveRec(store), quotes = liveRecQ(store);
  ok(ch === true, "phase3: materialize reports a change");
  eq(jobs.length, 5, "phase3: 5 weekly occurrence JOBS in horizon");
  eq(quotes.length, 5, "phase3: 5 matching occurrence QUOTES (one per visit)");
  // deterministic ids pair job↔quote and link job.quoteId
  ok(jobs.every(j => j.id === "recjob_rp1_" + j.occurrenceDate), "phase3: jobs keep deterministic recjob_ ids");
  ok(quotes.every(q => q.id === "recq_rp1_" + q.date), "phase3: quotes have deterministic recq_<plan>_<date> ids");
  ok(jobs.every(j => j.quoteId === "recq_rp1_" + j.occurrenceDate), "phase3: each job.quoteId links its recq_ quote");
  // the recurring 20%-off math + finance-neutral flags
  ok(quotes.every(q => q.discount === 8 && q.total === 32 && q.subtotal === 40), "phase3: 20% recurring discount applied ($40 → −$8 → $32)");
  ok(quotes.every(q => q.invoiced === false && q.paid === false), "phase3: every generated quote is invoiced:false + paid:false ($0 to finance)");
  ok(quotes.every(q => q.recurring === true && q.planId === "rp1" && q.customerId === "c1" && q.cust === "Alpha Cust"), "phase3: quote carries recurring flag + planId + customer");
  ok(quotes.every(q => q.num >= 1) && new Set(quotes.map(q => q.num)).size === quotes.length, "phase3: each quote gets a unique nextQuoteNum()");

  // 5b) FINANCE INVARIANCE — generating recurring quotes leaves A/R + income + billing fingerprint BYTE-IDENTICAL
  eq(arCents(store), arBefore, "phase3 INVARIANCE: A/R (Σ invoiced&&!paid) is byte-identical after generating quotes");
  eq(incCount(store), incBefore, "phase3 INVARIANCE: income record count unchanged (no income until a human marks paid)");
  eq(billFP(store), fpBefore, "phase3 INVARIANCE: billingFingerprint (job materials/expenses + business expenses) byte-identical");

  // 5c) IDEMPOTENT — re-run makes NO new jobs and NO new quotes (deterministic ids dedupe)
  const jN = liveRec(store).length, qN = liveRecQ(store).length;
  withEnv3(store, "2026-07-01", () => R.recurMaterialize());
  eq(liveRec(store).length, jN, "phase3: re-run generates 0 new jobs");
  eq(liveRecQ(store).length, qN, "phase3: re-run generates 0 new quotes (recq_ dedupe)");
  ok(new Set(store.quotes.map(q => q.id)).size === store.quotes.length, "phase3: no duplicate quote ids after two runs");
})();

// 5d) autoQuote:false (a Phase-2 plan) → jobs only, NO quotes (forward-only respected)
(function () {
  const store = { customers: [{ id: "c1", name: "Alpha" }], quotes: [], jobs: [], recurringPlans: [
    { id: "rp2", customerId: "c1", title: "Jobs-only", price: 40, discountPct: 20, frequency: "weekly", status: "active", startDate: "2026-07-01", crew: [], estDays: 1, autoQuote: false, generatedJobIds: [] }] };
  withEnv3(store, "2026-07-01", () => R.recurMaterialize());
  ok(liveRec(store).length === 5 && liveRecQ(store).length === 0, "phase3: autoQuote:false plan makes JOBS but NO quotes (jobs-only preserved)");
})();

// 5e) recurMRR sums active, non-deleted plans' monthly-equivalent (paused/ended/deleted excluded)
(function () {
  const store = { recurringPlans: [
    { id: "a", frequency: "weekly", price: 100, discountPct: 0, status: "active" },      // 433.33
    { id: "b", frequency: "monthly", price: 200, discountPct: 0, status: "active" },     // 200
    { id: "c", frequency: "weekly", price: 100, discountPct: 0, status: "paused" },      // excluded
    { id: "d", frequency: "weekly", price: 100, discountPct: 0, status: "active", deleted: true } // excluded
  ] };
  const mrr = withEnv3(store, "2026-07-01", () => R.recurMRR());
  eq(mrr, 633.33, "recurMRR = Σ active non-deleted monthly-equiv (433.33 + 200), excludes paused/deleted");
  const empty = withEnv3({ recurringPlans: [] }, "2026-07-01", () => R.recurMRR());
  eq(empty, 0, "recurMRR = 0 with no plans");
})();

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ all recurring-engine tests pass — frequency math, MRR equiv, horizon, idempotency/dedup, deleted-stays-deleted, guards, end conditions, quote-per-occurrence (deterministic recq_ ids, 20% discount, unbilled), recurMRR, and finance invariance (A/R + income + billing fingerprint byte-identical).");
process.exit(fail ? 1 : 0);
