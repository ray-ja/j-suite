/* job-lineitem-collections-tests.js — proves the job.materials/expenses → jobMaterials/jobExpenses collection
   migration is loss-free, idempotent, and (the whole point) that CONCURRENT same-job edits merge element-wise
   instead of clobbering via whole-record LWW. Pure node. Run: node job-lineitem-collections-tests.js */
const t = require("./sync-server.js");
let pass = 0, fail = 0; const ok = (n, c) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

// 1) HOIST — idempotent + loss-free, nested cleared, job.updatedAt untouched
let s = { obx: { jobs: [{ id: "j1", updatedAt: 5, materials: [{ id: "m1", amount: 100, updatedAt: 3 }], expenses: [{ id: "e1", amount: 50, updatedAt: 4 }] }] } };
t.hoistJobLineItems(s);
ok("hoist: material → jobMaterials (stamped jobId)", (s.obx.jobMaterials || []).some(m => m.id === "m1" && m.jobId === "j1" && m.amount === 100));
ok("hoist: expense → jobExpenses", (s.obx.jobExpenses || []).some(e => e.id === "e1" && e.jobId === "j1"));
ok("hoist: nested arrays cleared", s.obx.jobs[0].materials.length === 0 && s.obx.jobs[0].expenses.length === 0);
ok("hoist: job.updatedAt NOT bumped (no server-invented now)", s.obx.jobs[0].updatedAt === 5);
const before = JSON.stringify(s); t.hoistJobLineItems(s);
ok("hoist: idempotent (no dup on re-run)", JSON.stringify(s) === before && s.obx.jobMaterials.length === 1);

// 2) id-less legacy row → deterministic id, still no dup on rerun
let s2 = { obx: { jobs: [{ id: "j9", materials: [{ amount: 7 }] }] } };
t.hoistJobLineItems(s2); t.hoistJobLineItems(s2);
ok("hoist: id-less row gets stable id (jm_j9_0), no dup on rerun", s2.obx.jobMaterials.length === 1 && s2.obx.jobMaterials[0].id === "jm_j9_0");

// 3) THE FIX — concurrent same-job edits merge element-wise (no whole-record clobber)
const stored = t.migrateStore({ obx: { jobs: [{ id: "j1", updatedAt: 10 }], jobExpenses: [{ id: "e1", jobId: "j1", amount: 100, updatedAt: 10 }] }, jam: {} });
const incoming = { obx: { jobs: [{ id: "j1", updatedAt: 11 }], jobExpenses: [{ id: "e2", jobId: "j1", amount: 200, updatedAt: 11 }] } };
const je = (t.mergeState(stored, incoming).obx.jobExpenses || []).filter(e => e.jobId === "j1" && !e.deleted);
ok("CONCURRENT: BOTH e1 and e2 survive (the clobber is fixed)", je.length === 2 && je.some(e => e.id === "e1") && je.some(e => e.id === "e2"));

// 4) delete tombstone (newer) beats a stale-live nested re-push from an old cached client
const stored2 = { obx: { jobs: [{ id: "j1", updatedAt: 20 }], jobExpenses: [{ id: "e1", jobId: "j1", amount: 100, deleted: true, updatedAt: 30 }] }, jam: {} };
const oldClient = { obx: { jobs: [{ id: "j1", updatedAt: 21, expenses: [{ id: "e1", amount: 100, updatedAt: 5 }] }] } };
const merged2 = t.mergeState(stored2, oldClient);
const survivor = (merged2.obx.jobExpenses || []).find(e => e.id === "e1");
ok("DELETE: tombstone beats a stale-live nested re-push (hoist → element LWW)", survivor && survivor.deleted === true);
ok("DELETE: the stale nested copy was hoisted + cleared", (merged2.obx.jobs[0].expenses || []).length === 0);

// 5) migrateStore backfills empty collections on a slab that never had them
const s3 = t.migrateStore({ obx: { jobs: [] }, jam: { jobs: [] } });
ok("migrateStore: jobExpenses/jobMaterials backfilled as arrays", Array.isArray(s3.obx.jobExpenses) && Array.isArray(s3.obx.jobMaterials));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
