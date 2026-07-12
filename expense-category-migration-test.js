/* expense-category-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the 3-WAY EXPENSE
   CATEGORIZATION build. The change is purely ADDITIVE: a `category` string is backfilled onto every existing
   job.expenses[] item — NEVER moving a record between collections, NEVER re-amounting. This loads a REALISTIC
   pre-change fixture — a job with (a) an uncategorized dump-fee expense, (b) a TOOL expense filed from a
   tools/equipment receipt (a tombstoned review record retains the category, matched by photo receiptId),
   (c) pass-through materials, plus (d) org business expenses — through:
     1) the client js/02-state.js load() migration (the ACTUAL browser code, in a vm sandbox), and
     2) a sync-server migrateStore + mergeState round-trip (per-record LWW; `category` is an additive subfield
        on the already-synced `jobs` collection — a passthrough, not a schema change),
   and asserts ZERO LOSS, correct category backfill (tool item → "tools/equipment" AUTO-RECLASSIFIED from its
   receipt; everything else → "job"), Σ job.expenses UNCHANGED, and BOTH finance fingerprints (job-cost cents +
   mileage cents, category-agnostic raw sums) BYTE-IDENTICAL across raw → migrate → client-load.
   Run: node expense-category-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
const f = require("./js/39-finance-core");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

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
        // the tree job — a plain dump-fee expense (no category yet) + a TOOL expense filed from a tools/equipment
        // receipt (no category on the item; resolvable from the tombstoned review record via the photo receiptId).
        { id: "jP", title: "Tree clear", customerId: "c1", quoteId: "q1", date: TODAY, crew: ["u_ray"],
          expenses: [
            { id: "e_dump", amount: 73.16, desc: "dump fee", deleted: false },
            { id: "e_tool", amount: 250, desc: "chainsaw", receiptId: "ph_tool", deleted: false }
          ],
          materials: [{ id: "m1", amount: 800, desc: "pavers", deleted: false }], updatedAt: 1 },
        // a job with a deleted expense (must stay a tombstone) + an item that ALREADY carries a category (idempotent)
        { id: "jH", title: "Paver patio", customerId: "c1", date: TODAY, crew: ["u_chase"],
          expenses: [
            { id: "e3", amount: 200, desc: "sand", deleted: false },
            { id: "e4", amount: 15, desc: "voided", deleted: true },
            { id: "e5", amount: 40, desc: "already tagged", category: "disposal", deleted: false }
          ],
          materials: [], updatedAt: 1 }
      ],
      // the tombstoned review record the tool expense was filed FROM — retains category "tools/equipment"
      receipts: [
        { id: "r_tool", receiptId: "ph_tool", amount: 250, vendor: "Home Depot", category: "tools/equipment", type: "job-expense", jobId: "jP", status: "review", deleted: true, updatedAt: 1 }
      ],
      income: [], expenses: [{ id: "biz1", amount: 60, category: "subscription/software", note: "domain", date: TODAY, deleted: false, updatedAt: 1 }],
      inventory: [], locks: [], timeclock: [], messages: [], resale: [],
      pendingChanges: [], knowledge: [], disbursements: [], docs: [], places: [], changelog: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}

function census(store) {
  const c = {};
  const cols = ["customers", "properties", "quotes", "jobs", "income", "expenses", "inventory", "receipts"];
  cols.forEach(col => { const a = (store.obx && store.obx[col]) || []; c["obx." + col] = a.filter(r => r && !r.deleted).length; });
  // per-job expense/material record counts (incl. tombstones — nothing may vanish)
  let jexp = 0, jmat = 0;
  ((store.obx && store.obx.jobs) || []).forEach(j => { jexp += (j.expenses || []).length; jmat += (j.materials || []).length; });
  jexp += ((store.obx && store.obx.jobExpenses) || []).length; jmat += ((store.obx && store.obx.jobMaterials) || []).length;   // union: nested (raw) + promoted collection (migrated)
  c["obx.jobExpenses(all)"] = jexp; c["obx.jobMaterials(all)"] = jmat;
  c._accounts = (store.users || []).filter(u => u && !u.kind && !u.deleted).length;
  return c;
}
/* the FINGERPRINT the stage/mileage gates use — category-agnostic raw Σ job.expenses cents + mileage cents. */
function fingerprint(store) {
  const fp = {};
  ["obx", "jam"].forEach(o => {
    const s = store[o]; if (!s) return;
    let jc = 0; const seen = {}, liveJ = {};   // union of nested + jobExpenses collection, deduped by (jobId,id), live jobs only
    (s.jobs || []).forEach(j => { if (j && !j.deleted) { liveJ[j.id] = 1; (j.expenses || []).forEach((e, i) => { if (e && !e.deleted) { const k = j.id + "|" + (e.id != null ? e.id : i); if (!seen[k]) { seen[k] = 1; jc += f.finCents(e.amount); } } }); } });
    (s.jobExpenses || []).forEach(e => { if (e && !e.deleted && liveJ[e.jobId]) { const k = e.jobId + "|" + e.id; if (!seen[k]) { seen[k] = 1; jc += f.finCents(e.amount); } } });
    fp[o + "|job_costs¢"] = jc;
    fp[o + "|mileage¢"] = f.finMileage(s.timeclock || [], { confirmedOnly: true }).total;
  });
  return fp;
}

/* ==================================================================================================
   1) SERVER SIDE — migrateStore + a no-op sync round-trip drop nothing (category is additive on `jobs`).
   ================================================================================================== */
const pre = freshPre();
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "server round-trip: no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));

/* ==================================================================================================
   2) CLIENT SIDE — run the REAL js/02-state.js load() (vm sandbox) over the pre-change fixture, then load
      js/52-job-pl.js so jobProfit()/expenseIsTool()/jobCostBreakdown() are the actual shipped functions.
   ================================================================================================== */
const localStorageStub = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; }
};
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {} };
const ctx = vm.createContext(sandbox);

const clientPre = JSON.parse(JSON.stringify(pre));
// mark the UNRELATED one-time seeds already applied, but LEAVE expCatV1 unset so the migration under test runs.
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true, quoteVersionsV1: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);

vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext(fs.readFileSync("js/52-job-pl.js", "utf8"), ctx, { filename: "js/52-job-pl.js" });
vm.runInContext("load();", ctx);

const S_after = vm.runInContext("S", ctx);
const clientCensusBefore = census(pre), clientCensusAfter = census(S_after);
Object.keys(clientCensusBefore).forEach(k => ok(clientCensusAfter[k] >= clientCensusBefore[k], "client load(): no loss in " + k + " (before=" + clientCensusBefore[k] + " after=" + clientCensusAfter[k] + ")"));

const jP = S_after.obx.jobs.find(j => j.id === "jP");
const jH = S_after.obx.jobs.find(j => j.id === "jH");
// after load() the expenses live in the jobExpenses collection (with the backfilled category) — search there
const findExp = (store, jobId, id) => ((store.obx.jobExpenses || []).find(e => e && e.jobId === jobId && e.id === id))
  || (((store.obx.jobs.find(j => j.id === jobId) || {}).expenses || []).find(e => e && e.id === id)) || null;
const eDump = findExp(S_after, "jP", "e_dump");
const eTool = findExp(S_after, "jP", "e_tool");
const e3 = findExp(S_after, "jH", "e3");
const e4 = findExp(S_after, "jH", "e4");
const e5 = findExp(S_after, "jH", "e5");

ok(eTool.category === "tools/equipment", "TOOL expense AUTO-RECLASSIFIED: e_tool.category === 'tools/equipment' (resolved from its tombstoned tools/equipment receipt via receiptId)");
ok(eDump.category === "job", "plain dump-fee e_dump.category backfilled to 'job'");
ok(e3.category === "job", "uncategorized e3.category backfilled to 'job'");
ok(e5.category === "disposal", "already-categorized e5.category is UNCHANGED ('disposal') — idempotent, never overridden");
ok(e4.deleted === true, "the deleted expense e4 stays a tombstone (not resurrected, not dropped)");

// Σ job.expenses (live, non-deleted) UNCHANGED by the migration
function sumJobExp(store) { let s = 0; const seen = {}, liveJ = {}; (store.obx.jobs || []).forEach(j => { if (j && !j.deleted) { liveJ[j.id] = 1; (j.expenses || []).forEach((e, i) => { if (e && !e.deleted) { const k = j.id + "|" + (e.id != null ? e.id : i); if (!seen[k]) { seen[k] = 1; s += (+e.amount || 0); } } }); } }); (store.obx.jobExpenses || []).forEach(e => { if (e && !e.deleted && liveJ[e.jobId]) { const k = e.jobId + "|" + e.id; if (!seen[k]) { seen[k] = 1; s += (+e.amount || 0); } } }); return s; }
const sumBefore = sumJobExp(pre), sumAfter = sumJobExp(S_after);
ok(Math.abs(sumBefore - sumAfter) < 0.0001, "Σ live job.expenses UNCHANGED after migration (" + sumBefore.toFixed(2) + " → " + sumAfter.toFixed(2) + ")");

/* ---- 3) FINGERPRINTS byte-identical: raw → server-migrated → client-loaded (job-cost + mileage cents) ---- */
const fpRaw = fingerprint(pre), fpMig = fingerprint(migrated), fpClient = fingerprint(S_after);
const keys = Array.from(new Set([].concat(Object.keys(fpRaw), Object.keys(fpMig), Object.keys(fpClient)))).sort();
let drift = 0;
keys.forEach(k => { if (!(fpRaw[k] === fpMig[k] && fpRaw[k] === fpClient[k])) { console.log("    ✗ FP DRIFT " + k + ": raw=" + fpRaw[k] + " mig=" + fpMig[k] + " client=" + fpClient[k]); drift++; } });
ok(drift === 0, "BOTH fingerprints (job-cost + mileage cents) byte-identical across raw → migrate → client-load (" + keys.length + " sums, 0 drift)");

/* ---- 4) BEHAVIOR: jobProfit excludes the tool from jP's cost (auto-reclassify), materials/mileage still counted ---- */
const jobProfitFn = vm.runInContext("jobProfit", ctx);
const bdFn = vm.runInContext("jobCostBreakdown", ctx);
const p = jobProfitFn(jP), bd = bdFn(jP);
// price 1000 − dump 73.16 − materials 800 − mileage 0 (no timeclock/route) = 126.84; the $250 tool is EXCLUDED
ok(Math.abs(p.cost - (73.16 + 800)) < 0.001, "jobProfit(jP).cost EXCLUDES the $250 tool: cost=" + p.cost.toFixed(2) + " (dump 73.16 + materials 800, tool NOT counted)");
ok(Math.abs(p.profit - (1000 - 873.16)) < 0.001, "jobProfit(jP).profit = 126.84 (tool re-attributed to business overhead)");
ok(Math.abs(bd.tool - 250) < 0.001 && Math.abs(bd.jobExp - 73.16) < 0.001 && Math.abs(bd.materials - 800) < 0.001, "jobCostBreakdown splits jP correctly: jobExp=73.16 · materials=800 · tool=250 (tool kept separate)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS + category backfill (tool auto-reclassified, rest 'job') + Σ job.expenses unchanged + both fingerprints byte-identical — records never moved.");
process.exit(fail ? 1 : 0);
