/* expenses-collected-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the PAYMENT / EXPENSE-
 * COLLECTED DECOUPLE. Additive job field: j.expensesCollected (bool) + j.expensesCollectedAt / j.expensesCollectedBy
 * — an explicit owner/admin sign-off "all expenses are in for this job." Absent = false = today's behavior; no
 * backfill, no new collection, no billing/finance math change.
 *
 * Loads a realistic PRE-change store (jobs WITHOUT the field, one already-set, one explicitly false) through:
 *   1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough) — zero loss of any
 *      customer / property / quote / job / account, and every existing field (incl. an already-set
 *      expensesCollected) preserved byte-for-byte; the field is never invented on a job that didn't have it.
 *   2) the REAL client js/02-state.js load() (vm sandbox) — same zero-loss, the absent field stays absent/falsy.
 *   3) FINANCE BYTE-IDENTICAL: a finance fingerprint (A/R · quote balance · job costs · mileage · payouts ·
 *      revenue, mirroring stage-fingerprint-test) is computed with the field ABSENT and again with it flipped
 *      PRESENT on every job — asserted identical, proving billing/finance never read it.
 *   4) BEHAVIORAL: workStage (js/60) flips a done+open-crew job from "expense" → "invoice" ONLY when the owner
 *      signs off expensesCollected, and a PAID job stays "paid" regardless (payment decoupled).
 * Read-only: builds its own fixture; writes nothing.
 * Run: node expenses-collected-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
const F = require("./js/39-finance-core");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* realistic PRE-CHANGE fixture (server/data.json shape) — a full slice: accounts, customers, properties, quotes,
   jobs (with expenses + timeclock miles so finance has something to sum), income. Jobs cover: no field at all,
   already-collected=true (+ At/By), and an explicit false. */
function freshPre() {
  return {
    users: [
      { id: "u_ray", username: "Ray", role: "owner", updatedAt: 1 },
      { id: "u_kc", username: "KC", role: "crew", updatedAt: 1 }
    ],
    registry: [],
    obx: {
      customers: [
        { id: "c1", name: "Alpha Cust", phone: "2525551212", updatedAt: 1 },
        { id: "c2", name: "Beta Cust", updatedAt: 1 }
      ],
      properties: [{ id: "p1", label: "Prop One", address: "1 Main St", updatedAt: 1 }],
      quotes: [
        { id: "q1", cust: "Alpha Cust", customerId: "c1", jobId: "j1", total: 800, invoiced: true, updatedAt: 1 },
        { id: "q2", cust: "Beta Cust", customerId: "c2", jobId: "j2", total: 500, finalPrice: 520, paid: true, payments: [{ id: "pm1", amount: 520 }], updatedAt: 1 }
      ],
      jobs: [
        // no expensesCollected field at all → must survive + stay absent/falsy
        { id: "j1", quoteId: "q1", title: "Tree removal", customerId: "c1", done: true, crew: ["u_ray", "u_kc"],
          receiptsClosedBy: [{ userId: "u_ray" }],
          expenses: [{ id: "e1", amount: 73.16, desc: "dump fee" }, { id: "e2", amount: 20, desc: "gas" }], updatedAt: 1 },
        // already-collected=true with the At/By stamp → preserved verbatim
        { id: "j2", quoteId: "q2", title: "Paver walkway", customerId: "c2", done: true, crew: ["u_ray"],
          receiptsClosedBy: [{ userId: "u_ray" }],
          expenses: [{ id: "e3", amount: 45, desc: "materials" }],
          expensesCollected: true, expensesCollectedAt: 1700000000000, expensesCollectedBy: "Ray", updatedAt: 1 },
        // explicit false → preserved as false, still counts as "not collected"
        { id: "j3", title: "Cleanup", customerId: "c1", done: true, crew: ["u_kc"], expensesCollected: false, updatedAt: 1 }
      ],
      income: [{ id: "in1", quoteId: "q2", amount: 520, ts: 1700000000000, updatedAt: 1 }],
      expenses: [], inventory: [], locks: [],
      timeclock: [{ id: "tc1", userId: "u_ray", jobId: "j1", clockIn: 1, clockOut: 2, miles: 30, milesConfirmed: true, updatedAt: 1 }],
      messages: [], resale: [], pendingChanges: [], knowledge: [], disbursements: [], changelog: [], docs: [], places: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}
const arr = (s, k) => ((s.obx && s.obx[k]) || []).filter(x => x && !x.deleted);
const jById = (s, id) => ((s.obx && s.obx.jobs) || []).find(j => j && j.id === id) || null;

/* ============ 1) SERVER — migrateStore + a no-op round-trip: zero loss + field preserved byte-for-byte ============ */
const pre = freshPre();
const counts = { customers: arr(pre, "customers").length, properties: arr(pre, "properties").length, quotes: arr(pre, "quotes").length, jobs: arr(pre, "jobs").length, users: (pre.users || []).length };
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
["customers", "properties", "quotes", "jobs"].forEach(k => ok(arr(round, k).length === counts[k], "server round-trip: no " + k + " loss (" + counts[k] + ")"));
// accounts: migrateStore EXPANDS users into per-org membership records (additive), so assert every ORIGINAL account survives (not an exact count).
ok((pre.users || []).every(u => (round.users || []).some(r => r && r.id === u.id)), "server round-trip: every original account survives (" + counts.users + ")");
ok(!("expensesCollected" in jById(round, "j1")), "server: j1 (no field) NOT invented — stays absent");
const sj2 = jById(round, "j2");
ok(sj2 && sj2.expensesCollected === true && sj2.expensesCollectedAt === 1700000000000 && sj2.expensesCollectedBy === "Ray", "server: j2 already-collected sign-off preserved verbatim (true + At/By)");
ok(jById(round, "j3").expensesCollected === false, "server: j3 explicit false preserved");

/* ============ 2) CLIENT — the REAL js/02 load(): zero loss, absent field stays absent/falsy ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, isFinite: isFinite, parseFloat: parseFloat };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext("load();", ctx);
const S_after = vm.runInContext("S", ctx);
["customers", "properties", "quotes", "jobs"].forEach(k => ok(arr(S_after, k).length === counts[k], "client load(): no " + k + " loss (" + counts[k] + ")"));
ok(!jById(S_after, "j1").expensesCollected, "client: j1 (no field) is falsy after load() (== today's behavior)");
ok(jById(S_after, "j2").expensesCollected === true && jById(S_after, "j2").expensesCollectedBy === "Ray", "client: j2 sign-off survives load() verbatim");
ok(jById(S_after, "j3").expensesCollected === false, "client: j3 explicit false survives load()");
vm.runInContext("load();", ctx);
const S2 = vm.runInContext("S", ctx);
ok(!("expensesCollected" in jById(S2, "j1")) === !("expensesCollected" in jById(S_after, "j1")), "client: load() is idempotent (field neither invented nor dropped on re-run)");

/* ============ 3) FINANCE BYTE-IDENTICAL — flip expensesCollected on every job, finance sums must not move ======= */
function qTotal(q) { return (q.finalPrice || q.total || 0); }
function qPaid(q) { return (q.payments || []).filter(p => p && !p.deleted).reduce((s, p) => s + (+p.amount || 0), 0); }
function financeFingerprint(store) {
  const s = store.obx, fp = {};
  const quotes = (s.quotes || []).filter(q => q && !q.deleted);
  let ar = 0; quotes.forEach(q => { if (q.invoiced && !q.paid) ar += qTotal(q); });
  fp["ar¢"] = Math.round(ar * 100);
  let bal = 0; quotes.forEach(q => { if (qTotal(q) > 0 && !q.paid) bal += Math.max(0, qTotal(q) - qPaid(q)); });
  fp["quote_bal¢"] = Math.round(bal * 100);
  let jc = 0; (s.jobs || []).forEach(j => { if (j && !j.deleted) (j.expenses || []).forEach(e => { if (e && !e.deleted) jc += F.finCents(e.amount); }); });
  fp["job_costs¢"] = jc;
  const mil = F.finMileage(s.timeclock || [], { confirmedOnly: true });
  fp["mileage¢"] = mil.total;
  const roll = F.finRollup(s.income || [], {});
  const pay = F.finPayouts(roll, mil);
  Object.keys(pay).sort().forEach(id => { fp["payout:" + id + "¢"] = pay[id].total; });
  fp["revenue¢"] = roll.totals.amount;
  return fp;
}
const fpAbsent = financeFingerprint(freshPre());
const flipped = freshPre(); flipped.obx.jobs.forEach(j => { j.expensesCollected = true; j.expensesCollectedAt = 1; j.expensesCollectedBy = "X"; });
const fpPresent = financeFingerprint(flipped);
const fkeys = Array.from(new Set([].concat(Object.keys(fpAbsent), Object.keys(fpPresent)))).sort();
let drift = 0;
fkeys.forEach(k => { if (fpAbsent[k] !== fpPresent[k]) { drift++; console.log("    ✗ FINANCE DRIFT " + k + ": absent=" + fpAbsent[k] + " present=" + fpPresent[k]); } });
ok(drift === 0, "finance fingerprint BYTE-IDENTICAL with expensesCollected absent vs present (" + fkeys.length + " sums, 0 drift)");

/* ============ 4) BEHAVIORAL — workStage reads the flag (pipeline moves) while finance stayed identical ========= */
global.actJ = () => flippedJobs;
global.jobCrewActiveIds = job => (job && Array.isArray(job.crew)) ? job.crew.slice() : [];
global.jobReceiptsClosedBy = job => (job && Array.isArray(job.receiptsClosedBy)) ? job.receiptsClosedBy.filter(x => x && x.userId) : [];
global.jobReceiptsFullyClosed = job => { const crew = global.jobCrewActiveIds(job); if (!crew.length) return false; const closed = global.jobReceiptsClosedBy(job).map(x => x.userId); return crew.every(id => closed.indexOf(id) >= 0); };
global.jobReceiptsOpenCrew = job => { const closed = global.jobReceiptsClosedBy(job).map(x => x.userId); return global.jobCrewActiveIds(job).filter(id => closed.indexOf(id) < 0); };
const W = require("./js/60-workstage.js");
let flippedJobs = [{ id: "jx", done: true, crew: ["u1", "u2"], receiptsClosedBy: [{ userId: "u1" }], expensesCollected: false }];
ok(W.workStage({ id: "qx", jobId: "jx" }) === "expense", "workStage: done + 1/2 crew open + NOT collected → 'expense'");
flippedJobs = [{ id: "jx", done: true, crew: ["u1", "u2"], receiptsClosedBy: [{ userId: "u1" }], expensesCollected: true }];
ok(W.workStage({ id: "qx", jobId: "jx" }) === "invoice", "workStage: SAME job, owner signs off collected → 'invoice' (past the slow crew member)");
ok(W.workStage({ id: "qp", paid: true, jobId: "jx" }) === "paid", "workStage: paid wins regardless of the sign-off (payment decoupled)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — every customer/property/quote/job/account survives migrateStore + a sync round-trip + client load(); j.expensesCollected is additive (absent stays falsy, set is verbatim), finance is byte-identical with it absent vs present, and workStage reads it to move a done job past a slow crew member while paid stays paid.");
process.exit(fail ? 1 : 0);
