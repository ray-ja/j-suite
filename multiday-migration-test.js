/* multiday-migration-test.js — MANDATORY migration fixture for the MULTI-DAY jobs feature (CLAUDE.md).
   Loads a realistic PRE-CHANGE store (jobs have only `date`, NO workDays — exactly what's on the server today),
   runs it through the new server migrateStore + a sync round-trip, and asserts:
     1. ZERO LOSS — every customer/property/quote/job/account survives.
     2. A legacy single-`date` job is untouched (still appears on its date via the client fallback).
     3. A job carrying workDays=[Mon,Wed] rides the job-record LWW intact through a sync round-trip
        (workDays is a field on the already-synced `jobs` collection — no schema/COLLECTIONS change).
     4. The client placement contract: jobOnDay(job, ds) is true on each work day and false off them,
        and jobWorkDays() falls back to [date] for legacy jobs.
   Run: node multiday-migration-test.js   (exit 0 = green) */
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* ---- 1) realistic PRE-CHANGE store: jobs with date only, no workDays (today's prod shape) ---- */
const pre = {
  users: [
    { id: "u_ray", username: "Ray", role: "owner", updatedAt: 1 },
    { id: "u_chase", username: "Chase", role: "crew", updatedAt: 1 }
  ],
  registry: [],
  obx: {
    customers: [{ id: "c1", name: "Seaside HOA", updatedAt: 1 }, { id: "c2", name: "Joe Lamb", updatedAt: 1 }],
    properties: [{ id: "p1", label: "Lot A", address: "1 Beach Rd", customerIds: ["c1"], updatedAt: 1 }],
    quotes: [{ id: "q1", customerId: "c1", total: 480, num: 1, updatedAt: 1 }],
    jobs: [
      // legacy single-day job — date only, NO workDays
      { id: "jA", title: "Power wash", customerId: "c1", date: "2026-07-07", crew: ["u_chase"], updatedAt: 1 },
      // multi-day job already carrying workDays (Mon + Wed, skipping Tue)
      { id: "jB", title: "Tree clear", customerId: "c2", date: "2026-07-06", workDays: ["2026-07-06", "2026-07-08"], crew: ["u_ray"], expenses: [{ id: "ex1", cat: "disposal", amount: 73.16 }], updatedAt: 1 }
    ],
    income: [{ id: "i1", amount: 200, date: "2026-07-01", updatedAt: 1 }],
    expenses: [{ id: "e1", amount: 40, date: "2026-07-01", updatedAt: 1 }],
    inventory: [{ id: "inv1", name: "Pressure washer", updatedAt: 1 }],
    timeclock: [], messages: [], resale: [], disbursements: [], knowledge: [],
    pendingChanges: [], docs: [], places: [], changelog: []
  },
  jam: { customers: [], quotes: [], jobs: [] }
};

function census(store) {
  const c = {};
  const cols = ["customers", "properties", "quotes", "jobs", "income", "expenses", "inventory"];
  cols.forEach(col => { const a = (store.obx && store.obx[col]) || []; c["obx." + col] = a.filter(r => r && !r.deleted).length; });
  c._accounts = (store.users || []).filter(u => u && !u.kind && !u.deleted).length;
  return c;
}
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});   // no-op sync round-trip

/* ---- 1) zero loss ---- */
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));

/* ---- 2) legacy job untouched ---- */
const jA = round.obx.jobs.find(j => j.id === "jA");
ok(jA && jA.date === "2026-07-07", "legacy job jA keeps its date 2026-07-07");

/* ---- 3) workDays rides the job LWW through a sync round-trip, intact ---- */
const jB = round.obx.jobs.find(j => j.id === "jB");
ok(jB && Array.isArray(jB.workDays) && jB.workDays.length === 2 && jB.workDays[0] === "2026-07-06" && jB.workDays[1] === "2026-07-08", "multi-day jB.workDays=[Mon,Wed] survives migrate + sync intact");
ok(jB && (round.obx.jobExpenses || []).filter(e => e.jobId === "jB").length === 1, "jB per-job expense survives alongside workDays");

/* ---- 4) client placement contract (jobWorkDays / jobOnDay) — load the helper block from js/09 ---- */
const fs = require("fs");
const src = fs.readFileSync("js/09-schedule.js", "utf8");
const m = src.match(/function jobWorkDays\(j\)\{[\s\S]*?function jobOnDay\(j,ds\)\{return jobWorkDays\(j\)\.indexOf\(ds\)>=0;\}/);
ok(!!m, "found jobWorkDays/jobOnDay helpers in js/09");
if (m) {
  // eslint-disable-next-line no-eval
  eval(m[0]);
  const jLegacy = round.obx.jobs.find(j => j.id === "jA");
  const jMulti = round.obx.jobs.find(j => j.id === "jB");
  ok(jobOnDay(jLegacy, "2026-07-07"), "legacy job appears on its date (fallback to [date])");
  ok(jobOnDay(jMulti, "2026-07-06") && jobOnDay(jMulti, "2026-07-08"), "multi-day job appears on BOTH Mon and Wed");
  ok(!jobOnDay(jMulti, "2026-07-07"), "multi-day job does NOT appear on the skipped Tue");
  const wl = jobWorkDays(jLegacy);
  ok(wl.length === 1 && wl[0] === "2026-07-07", "jobWorkDays falls back to [date] for a legacy job");
}

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ all multi-day migration checks pass — zero loss, legacy untouched, workDays round-trips, placement correct");
process.exit(fail ? 1 : 0);
