/* recurring-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the RECURRING SERVICE collection.
 * A NEW synced collection `recurringPlans` (per-org, LWW) + additive job fields (job.planId / job.occurrenceDate)
 * that Phase-1's engine (js/102) writes. This is a data-layer change → it MUST prove ZERO LOSS + byte-identical
 * finance before it can ship.
 *
 * Loads a realistic PRE-change store (accounts, customers, properties, quotes, jobs, income, business expenses,
 * ONE active weekly recurringPlan, and ONE already-generated occurrence job carrying planId/occurrenceDate)
 * through:
 *   1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough) — zero loss of any
 *      customer / property / quote / job / account / recurringPlan; the plan + every field survive byte-for-byte;
 *      the generated occurrence job (with planId) survives; a fresh empty org gets an empty recurringPlans array.
 *   2) the REAL client js/02-state.js load() (vm sandbox) — same zero-loss, the plan + its fields intact.
 *   3) FINANCE BYTE-IDENTICAL: migration-proof's billingFingerprint (job pass-through materials + job expenses +
 *      business expenses, per org, in cents) is asserted identical before → migrated → round-tripped. A plan holds
 *      no money, so this is trivially unchanged — the assertion locks that in.
 * Read-only: builds its own fixture; writes nothing.  Run: node recurring-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* ---- billingFingerprint: copied verbatim from migration-proof.js (single source-of-truth math) ---- */
function billingFingerprint(store) {
  const fp = {};
  const orgIds = Object.keys(store).filter(k => k !== "users" && k !== "registry" && store[k] && typeof store[k] === "object" && !Array.isArray(store[k]));
  const cents = n => Math.round((+n || 0) * 100);
  orgIds.forEach(o => {
    let mat = 0, exp = 0, biz = 0;
    (store[o].jobs || []).forEach(j => { if (!j || j.deleted) return;
      (j.materials || []).forEach(m => { if (m && !m.deleted) mat += cents(m.amount); });
      (j.expenses || []).forEach(e => { if (e && !e.deleted) exp += cents(e.amount); });
    });
    (store[o].expenses || []).forEach(e => { if (e && !e.deleted) biz += cents(e.amount); });
    fp[o + ".job-materials¢"] = mat; fp[o + ".job-expenses¢"] = exp; fp[o + ".business-expenses¢"] = biz;
  });
  return fp;
}

/* realistic PRE-change fixture (server/data.json shape). obx has a full business slice PLUS one active weekly
   recurring plan and the one occurrence job it has already generated (planId/occurrenceDate + deterministic id). */
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
        { id: "j1", quoteId: "q1", title: "Tree removal", customerId: "c1", done: true, crew: ["u_ray", "u_kc"],
          expenses: [{ id: "e1", amount: 73.16, desc: "dump fee" }, { id: "e2", amount: 20, desc: "gas" }], updatedAt: 1 },
        { id: "j2", quoteId: "q2", title: "Paver walkway", customerId: "c2", done: true, crew: ["u_ray"],
          materials: [{ id: "m1", amount: 140, desc: "pavers" }],
          expenses: [{ id: "e3", amount: 45, desc: "materials" }], updatedAt: 1 },
        // an ALREADY-GENERATED recurring occurrence — deterministic id, planId back-link, occurrenceDate
        { id: "recjob_rp1_2026-07-06", title: "Weekly house-watch", customerId: "c1", propertyId: "p1",
          done: false, crew: ["u_kc"], date: "2026-07-06", occurrenceDate: "2026-07-06", planId: "rp1",
          workDays: ["2026-07-06"], updatedAt: 1 }
      ],
      income: [{ id: "in1", quoteId: "q2", amount: 520, ts: 1700000000000, updatedAt: 1 }],
      expenses: [{ id: "be1", amount: 99.5, desc: "insurance", updatedAt: 1 }],
      recurringPlans: [
        { id: "rp1", customerId: "c1", propertyId: "p1", title: "Weekly house-watch", price: 60, discountPct: 20,
          frequency: "weekly", weekday: 1, time: "09:00", crew: ["u_kc"], estDays: 1,
          startDate: "2026-06-01", endMode: "endless", status: "active",
          nextDue: "2026-07-13", lastGeneratedDate: "2026-07-06", generatedCount: 1,
          generatedJobIds: ["recjob_rp1_2026-07-06"], autoQuote: false, notes: "check the house", updatedAt: 1 }
      ],
      inventory: [], locks: [], timeclock: [], messages: [], resale: [], pendingChanges: [], knowledge: [],
      disbursements: [], changelog: [], docs: [], places: []
    },
    jam: { customers: [], quotes: [], jobs: [] }   // fresh org WITHOUT a recurringPlans array → migration must add one
  };
}
const arr = (s, k) => ((s.obx && s.obx[k]) || []).filter(x => x && !x.deleted);
const planById = (s, id) => ((s.obx && s.obx.recurringPlans) || []).find(p => p && p.id === id) || null;
const jobById = (s, id) => ((s.obx && s.obx.jobs) || []).find(j => j && j.id === id) || null;

/* ============ 1) SERVER — migrateStore + a no-op round-trip: zero loss + plan/fields preserved ============ */
const pre = freshPre();
const counts = { customers: arr(pre, "customers").length, properties: arr(pre, "properties").length, quotes: arr(pre, "quotes").length, jobs: arr(pre, "jobs").length, recurringPlans: arr(pre, "recurringPlans").length, income: arr(pre, "income").length, expenses: arr(pre, "expenses").length, users: (pre.users || []).length };
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
["customers", "properties", "quotes", "jobs", "recurringPlans", "income", "expenses"].forEach(k => ok(arr(round, k).length === counts[k], "server round-trip: no " + k + " loss (" + counts[k] + ")"));
ok((pre.users || []).every(u => (round.users || []).some(r => r && r.id === u.id)), "server round-trip: every original account survives (" + counts.users + ")");
// the plan survives with every field intact
const sp = planById(round, "rp1");
const preP = planById(pre, "rp1");
ok(!!sp, "server: recurringPlan rp1 survives migrate + round-trip");
ok(sp && JSON.stringify(sp) === JSON.stringify(preP), "server: rp1 byte-identical (every field preserved verbatim)");
ok(sp && Array.isArray(sp.generatedJobIds) && sp.generatedJobIds[0] === "recjob_rp1_2026-07-06", "server: rp1.generatedJobIds preserved");
// the generated occurrence job survives with its back-link + occurrenceDate
const sj = jobById(round, "recjob_rp1_2026-07-06");
ok(sj && sj.planId === "rp1" && sj.occurrenceDate === "2026-07-06", "server: generated occurrence job survives with planId + occurrenceDate");
// a fresh org that had no recurringPlans array gets one (migrateStore backfill)
ok(Array.isArray(round.jam && round.jam.recurringPlans), "server: fresh org (jam) gets an empty recurringPlans array");
// COLLECTIONS wiring: an ADDED plan on the incoming side is merged in (never dropped)
const withNew = SS.mergeState(migrated, { obx: { recurringPlans: [{ id: "rp2", frequency: "monthly", status: "active", updatedAt: 2 }] } });
ok((withNew.obx.recurringPlans || []).some(p => p && p.id === "rp2") && (withNew.obx.recurringPlans || []).some(p => p && p.id === "rp1"), "server: recurringPlans is a real LWW collection (new plan merges in, existing kept)");

/* ============ 2) CLIENT — the REAL js/02 load(): zero loss, plan + fields intact ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, isFinite: isFinite, parseFloat: parseFloat };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext("load();", ctx);
const S_after = vm.runInContext("S", ctx);
["customers", "properties", "quotes", "jobs", "recurringPlans", "income", "expenses"].forEach(k => ok(arr(S_after, k).length === counts[k], "client load(): no " + k + " loss (" + counts[k] + ")"));
const cp = planById(S_after, "rp1");
ok(cp && cp.frequency === "weekly" && cp.price === 60 && cp.nextDue === "2026-07-13" && cp.generatedJobIds[0] === "recjob_rp1_2026-07-06", "client: rp1 survives load() with fields intact");
ok(Array.isArray(S_after.jam && S_after.jam.recurringPlans), "client: fresh org (jam) has an empty recurringPlans array after load()");
vm.runInContext("load();", ctx);
const S2 = vm.runInContext("S", ctx);
ok(arr(S2, "recurringPlans").length === counts.recurringPlans, "client: load() is idempotent (no plan invented or dropped on re-run)");

/* ============ 3) FINANCE BYTE-IDENTICAL — billingFingerprint before vs migrated vs round-trip ============ */
const fpBefore = billingFingerprint(pre), fpMig = billingFingerprint(migrated), fpRound = billingFingerprint(round);
let drift = 0;
Object.keys(fpBefore).forEach(k => { if (fpMig[k] !== fpBefore[k] || fpRound[k] !== fpBefore[k]) { drift++; console.log("    ✗ BILLING DRIFT " + k + ": before=" + fpBefore[k] + " migrated=" + fpMig[k] + " round=" + fpRound[k]); } });
ok(drift === 0, "billing byte-identical: job materials + job expenses + business expenses unchanged (" + Object.keys(fpBefore).length + " sums, 0 drift)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED — DO NOT SHIP") : "\n  ✓ ZERO LOSS — every customer/property/quote/job/account + the recurringPlan (and its generated occurrence job) survive migrateStore + a sync round-trip + client load(); recurringPlans is a real LWW collection; finance is byte-identical.");
process.exit(fail ? 1 : 0);
