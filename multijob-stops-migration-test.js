/* multijob-stops-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the multi-job (0/1/N)
   stop-attribution feature: job.parentJobId (scalar) -> job.sharedJobIds[] (array), extending the EXISTING
   sub-job mechanism (never a new collection). Loads a REALISTIC pre-change fixture — (a) a normal job with
   no parentJobId, (b) an EXISTING sub-job with parentJobId set (tonight's real shape, e.g. a pickupRun),
   (c) a job with real materials/expenses history — through:
     1) the client js/02-state.js load() migration (the ACTUAL browser code, run in a vm sandbox), and
     2) a sync-server migrateStore + mergeState round-trip (per-record LWW; sharedJobIds is an additive
        field on the already-synced `jobs` collection, so this is a passthrough, not a schema change),
   and asserts ZERO LOSS + the critical zero-regression assertion: jobProfit() on the parent produces the
   EXACT SAME dollar total after migration as it did under the OLD equality-match/no-split semantics — a
   1-element sharedJobIds array is a no-op divide, so tonight's real sub-jobs must show identical numbers.
   Run: node multijob-stops-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* job dates need to fall in plRows()'s CURRENT week window (it defaults to "this week") to exercise the
   plRows()/jobProfit() assertions below regardless of what day this test happens to run */
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const TODAY = ymd(new Date());

/* ---- realistic PRE-CHANGE fixture (server/data.json shape: top-level users/registry + org slabs) ---- */
function freshPre() {
  return {
    users: [
      { id: "u_ray", username: "Ray", role: "owner", updatedAt: 1 },
      { id: "u_chase", username: "Chase", role: "crew", updatedAt: 1 }
    ],
    registry: [],
    obx: {
      customers: [{ id: "c1", name: "Seaside HOA", updatedAt: 1 }],
      properties: [],
      quotes: [{ id: "q1", customerId: "c1", total: 1000, finalPrice: 1000, num: 1, updatedAt: 1 }],
      jobs: [
        // (a) a normal job — never a sub-job, no parentJobId at all
        { id: "jN", title: "Standalone wash", customerId: "c1", date: TODAY, crew: ["u_chase"], expenses: [], materials: [], updatedAt: 1 },
        // the "bigger job" a real sub-job files under
        { id: "jP", title: "Tree clear", customerId: "c1", quoteId: "q1", date: TODAY, crew: ["u_ray"], expenses: [{ id: "e1", amount: 50, deleted: false }], materials: [], updatedAt: 1 },
        // (b) an EXISTING sub-job — parentJobId set, exactly tonight's real shape (a pickupRun)
        { id: "jS", title: "Dump run", customerId: "c1", parentJobId: "jP", pickupRun: true, date: TODAY, crew: ["u_chase"], expenses: [{ id: "e2", amount: 73.16, deleted: false }], materials: [{ id: "m1", amount: 120, deleted: false }], updatedAt: 1 },
        // (c) a job with real materials/expenses history (unrelated to the sub-job mechanism)
        { id: "jH", title: "Paver patio", customerId: "c1", date: TODAY, crew: ["u_ray"], expenses: [{ id: "e3", amount: 200, deleted: false }, { id: "e4", amount: 15, deleted: true }], materials: [{ id: "m2", amount: 800, deleted: false }], updatedAt: 1 }
      ],
      income: [], expenses: [], inventory: [], locks: [], timeclock: [], messages: [], resale: [],
      pendingChanges: [], knowledge: [], disbursements: [], docs: [], places: [], changelog: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}

function census(store) {
  const c = {};
  const cols = ["customers", "properties", "quotes", "jobs", "income", "expenses", "inventory"];
  cols.forEach(col => { const a = (store.obx && store.obx[col]) || []; c["obx." + col] = a.filter(r => r && !r.deleted).length; });
  c._accounts = (store.users || []).filter(u => u && !u.kind && !u.deleted).length;
  return c;
}

/* ==================================================================================================
   1) SERVER SIDE — migrateStore + a no-op sync round-trip must drop nothing (sharedJobIds is additive,
      rides the existing `jobs` collection — no COLLECTIONS/schema change needed server-side).
   ================================================================================================== */
const pre = freshPre();
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});   // no-op sync round-trip
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "server round-trip: no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));

/* ==================================================================================================
   2) CLIENT SIDE — run the REAL js/02-state.js load() (in a vm sandbox) over the pre-change fixture,
      then load the REAL js/52-job-pl.js on top so jobProfit()/subJobsOf()/plRows()/overheadStops() are
      the actual shipped functions, not a re-implementation.
   ================================================================================================== */
const localStorageStub = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; }
};
const sandbox = {
  console, localStorage: localStorageStub, window: { __syncApplying: false },
  // migrateBudgetBooks lives in js/79-budget.js (not loaded here) and is called UNconditionally by load();
  // stub it out — it's unrelated to the sharedJobIds migration under test, and a no-op is loss-free
  migrateBudgetBooks: () => {}
};
const ctx = vm.createContext(sandbox);

// seed localStorage with the pre-change store, in the CLIENT'S key/shape (KEY="jra_app_v1"; client slabs are
// the SAME per-org collection shape as the server's — load() reads S.obx/S.jam directly)
const clientPre = JSON.parse(JSON.stringify(pre));
// mark every one-time seed migration already applied so load() only runs the sharedJobIds migration under
// test, not the (unrelated) seed/backfill content — those seeders are all self-contained in js/02-state.js
// and would run fine either way, but skipping them keeps this fixture's census points exact and stable
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);

vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext(fs.readFileSync("js/52-job-pl.js", "utf8"), ctx, { filename: "js/52-job-pl.js" });
vm.runInContext("load();", ctx);

const clientCensusBefore = census(pre);
const S_after = vm.runInContext("S", ctx);
const clientCensusAfter = census(S_after);
Object.keys(clientCensusBefore).forEach(k => ok(clientCensusAfter[k] >= clientCensusBefore[k], "client load(): no loss in " + k + " (before=" + clientCensusBefore[k] + " after=" + clientCensusAfter[k] + ")"));

const jN = S_after.obx.jobs.find(j => j.id === "jN");
const jP = S_after.obx.jobs.find(j => j.id === "jP");
const jS = S_after.obx.jobs.find(j => j.id === "jS");
const jH = S_after.obx.jobs.find(j => j.id === "jH");
ok(!!jN && jN.sharedJobIds === null, "normal job jN (never a sub-job) gets sharedJobIds=null, NOT []");
ok(!!jP && jP.sharedJobIds === null, "the parent job jP itself gets sharedJobIds=null (it's not anyone's stop)");
ok(!!jS && Array.isArray(jS.sharedJobIds) && jS.sharedJobIds.length === 1 && jS.sharedJobIds[0] === "jP", "existing sub-job jS.sharedJobIds === ['jP'] (promoted from parentJobId)");
ok(!!jS && jS.parentJobId === "jP", "jS.parentJobId is UNCHANGED (untouched audit trail, unread by new code)");
ok(!!jH && jH.sharedJobIds === null, "job jH (real materials/expenses history, never a sub-job) gets sharedJobIds=null");
ok(!!jH && jH.expenses.filter(e => !e.deleted).length === 1 && jH.materials.length === 1, "jH's real materials/expenses history survives untouched (1 live expense — the deleted one stays a tombstone, 1 material)");

/* ---- 3) THE CRITICAL ASSERTION — jobProfit(parent) is IDENTICAL to the pre-change (equality-match, no
   split) dollar total. Hand-computed OLD-semantics expected value: price 1000 − jP's own $50 expense −
   jS's full $73.16 expense − jS's full $120 material (parentJobId equality match, no divide) = $756.84. ---- */
const OLD_SEMANTICS_EXPECTED_PROFIT = 1000 - 50 - 73.16 - 120;   // = 756.84
const jobProfitFn = vm.runInContext("jobProfit", ctx);
const pAfter = jobProfitFn(jP);
ok(Math.abs(pAfter.profit - OLD_SEMANTICS_EXPECTED_PROFIT) < 0.001, "jobProfit(jP).profit after migration (" + pAfter.profit.toFixed(2) + ") EXACTLY matches the pre-change equality-match total (" + OLD_SEMANTICS_EXPECTED_PROFIT.toFixed(2) + ") — the 1-element sharedJobIds split is a true no-op");
ok(Math.abs(pAfter.cost - 243.16) < 0.001, "jobProfit(jP).cost after migration is still 243.16 (50 own + 73.16 + 120 rolled up from jS at a 1-way / no-op split)");

const subJobsOfFn = vm.runInContext("subJobsOf", ctx);
ok(subJobsOfFn("jP").some(x => x.id === "jS"), "subJobsOf('jP') finds jS via the NEW membership match (sharedJobIds), post-migration");

const plRowsFn = vm.runInContext("plRows", ctx);
const rows = plRowsFn();
ok(!rows.some(r => r.j.id === "jS"), "plRows() excludes the migrated sub-job jS from its own fake P&L row (sharedJobIds is now an array)");
ok(rows.some(r => r.j.id === "jP"), "plRows() still includes the parent job jP with its rolled-up cost");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS + ZERO REGRESSION — every record survives load()+sync round-trip, and the migrated sub-job's rolled-up P&L total is byte-identical to the pre-change number.");
process.exit(fail ? 1 : 0);
