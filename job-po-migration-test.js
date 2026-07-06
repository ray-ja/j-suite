/* job-po-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the PER-JOB PO CODE build.
 * Additive job field: j.poNum (int, floor 1000 → first 1001), DISPLAYED "P"+pad4 ("P1042"). No new collection,
 * no server change, no finance field. Legacy jobs get a poNum from a deterministic load()-time backfill
 * (js/02, a structural clone of the quote-num backfill: sort by date+id so every device agrees WITHOUT syncing,
 * continue the org's monotonic counter from its max, NO updatedAt bump, idempotent).
 *
 * Loads a realistic PRE-change store (obx + jam, jobs with/without poNum + a preset) through:
 *   1) sync-server migrateStore + a no-op mergeState round-trip — zero loss of any customer/property/quote/
 *      job/account; a preset poNum survives byte-for-byte.
 *   2) the REAL client js/02 load() (vm sandbox) — every job ends up with a UNIQUE poNum PER ORG (obx & jam both
 *      independently start at 1001), the preset is preserved, backfill continues from the org max, the whole
 *      thing is DETERMINISTIC (two fresh loads → identical assignment) and IDEMPOTENT (re-load never renumbers).
 *   3) FINANCE BYTE-IDENTICAL — a per-org finance fingerprint (A/R · quote balance · job costs · mileage ·
 *      payouts · revenue, mirroring stage-fingerprint-test) is computed raw → migrate → client-load; asserted
 *      identical, proving no cent reads or moves because of poNum.
 *   4) HELPERS (js/95) — jobByPO(jobPO(j))===j; "P1042"/"PO 1042"/"1042"/"p1042" all resolve to 1042; a name → null.
 * Read-only: builds its own fixture; writes nothing.
 * Run: node job-po-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
const F = require("./js/39-finance-core");
const PO = require("./js/95-job-po");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* realistic PRE-CHANGE fixture (server/data.json shape). obx: two jobs WITHOUT poNum (+ finance data so the
   fingerprint has something to sum). jam: one job with a PRESET poNum 1001 + one without — proving the two
   orgs are numbered independently (both legitimately contain 1001) and backfill continues past a preset. */
function freshPre() {
  return {
    users: [
      { id: "u_ray", username: "Ray", role: "owner", updatedAt: 1 },
      { id: "u_kc", username: "KC", role: "crew", updatedAt: 1 }
    ],
    registry: [],
    obx: {
      customers: [{ id: "c1", name: "Alpha Cust", phone: "2525551212", updatedAt: 1 }, { id: "c2", name: "Beta Cust", updatedAt: 1 }],
      properties: [{ id: "p1", label: "Prop One", address: "1 Main St", updatedAt: 1 }],
      quotes: [
        { id: "q1", cust: "Alpha Cust", customerId: "c1", jobId: "j1", total: 800, invoiced: true, updatedAt: 1 },
        { id: "q2", cust: "Beta Cust", customerId: "c2", jobId: "j2", total: 500, finalPrice: 520, paid: true, payments: [{ id: "pm1", amount: 520 }], updatedAt: 1 }
      ],
      jobs: [
        { id: "j1", quoteId: "q1", title: "Tree removal", customerId: "c1", date: "2026-06-01", done: true, crew: ["u_ray", "u_kc"],
          expenses: [{ id: "e1", amount: 73.16, desc: "dump fee" }, { id: "e2", amount: 20, desc: "gas" }], updatedAt: 1 },
        { id: "j2", quoteId: "q2", title: "Paver walkway", customerId: "c2", date: "2026-06-05", done: true, crew: ["u_ray"],
          expenses: [{ id: "e3", amount: 45, desc: "materials" }], updatedAt: 1 }
      ],
      income: [{ id: "in1", quoteId: "q2", amount: 520, ts: 1700000000000, updatedAt: 1 }],
      expenses: [], inventory: [], locks: [],
      timeclock: [{ id: "tc1", userId: "u_ray", jobId: "j1", clockIn: 1, clockOut: 2, miles: 30, milesConfirmed: true, updatedAt: 1 }],
      messages: [], resale: [], pendingChanges: [], knowledge: [], disbursements: [], changelog: [], docs: [], places: []
    },
    jam: {
      customers: [], properties: [], quotes: [],
      jobs: [
        { id: "jm1", title: "PLC panel", date: "2026-06-02", poNum: 1001, updatedAt: 1 },   // PRESET → must survive verbatim
        { id: "jm2", title: "Modbus wiring", date: "2026-06-04", updatedAt: 1 }             // no poNum → backfilled, continues past 1001
      ],
      income: [], expenses: [], timeclock: []
    }
  };
}
const arr = (s, o, k) => ((s[o] && s[o][k]) || []).filter(x => x && !x.deleted);
const jById = (s, o, id) => ((s[o] && s[o].jobs) || []).find(j => j && j.id === id) || null;

/* ============ 1) SERVER — migrateStore + no-op round-trip: zero loss + preset preserved ============ */
const pre = freshPre();
const counts = {
  obx_customers: arr(pre, "obx", "customers").length, obx_properties: arr(pre, "obx", "properties").length,
  obx_quotes: arr(pre, "obx", "quotes").length, obx_jobs: arr(pre, "obx", "jobs").length,
  jam_jobs: arr(pre, "jam", "jobs").length, users: (pre.users || []).length
};
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
ok(arr(round, "obx", "customers").length === counts.obx_customers, "server: no customer loss (" + counts.obx_customers + ")");
ok(arr(round, "obx", "properties").length === counts.obx_properties, "server: no property loss (" + counts.obx_properties + ")");
ok(arr(round, "obx", "quotes").length === counts.obx_quotes, "server: no quote loss (" + counts.obx_quotes + ")");
ok(arr(round, "obx", "jobs").length === counts.obx_jobs && arr(round, "jam", "jobs").length === counts.jam_jobs, "server: no job loss (obx " + counts.obx_jobs + " · jam " + counts.jam_jobs + ")");
ok((pre.users || []).every(u => (round.users || []).some(r => r && r.id === u.id)), "server: every original account survives (" + counts.users + ")");
ok(jById(round, "jam", "jm1").poNum === 1001, "server: preset poNum 1001 preserved verbatim (server never invents/renumbers)");
ok(!("poNum" in jById(round, "obx", "j1")), "server: a job WITHOUT poNum is NOT invented server-side (backfill is client-derived)");

/* ============ 2) CLIENT — the REAL js/02 load(): unique per org, preset kept, deterministic + idempotent ======= */
function loadOnce(fixture) {
  const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
  const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, isFinite: isFinite, parseFloat: parseFloat };
  const ctx = vm.createContext(sandbox);
  const clientPre = JSON.parse(JSON.stringify(fixture));
  Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
  localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
  vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
  vm.runInContext("load();", ctx);
  return ctx;
}
const ctxA = loadOnce(freshPre());
const S_A = vm.runInContext("S", ctxA);
ok(arr(S_A, "obx", "customers").length === counts.obx_customers && arr(S_A, "obx", "quotes").length === counts.obx_quotes && arr(S_A, "obx", "jobs").length === counts.obx_jobs && arr(S_A, "jam", "jobs").length === counts.jam_jobs, "client load(): zero loss (customers/quotes/jobs, obx+jam)");

// every job has a poNum
const obxJobs = arr(S_A, "obx", "jobs"), jamJobs = arr(S_A, "jam", "jobs");
ok(obxJobs.every(j => +j.poNum > 0) && jamJobs.every(j => +j.poNum > 0), "client: EVERY job has a poNum after load()");
// unique per org
const obxNums = obxJobs.map(j => j.poNum), jamNums = jamJobs.map(j => j.poNum);
ok(new Set(obxNums).size === obxNums.length, "client: obx poNums are UNIQUE (" + obxNums.slice().sort((a, b) => a - b).join(",") + ")");
ok(new Set(jamNums).size === jamNums.length, "client: jam poNums are UNIQUE (" + jamNums.slice().sort((a, b) => a - b).join(",") + ")");
// org-scoped independence — BOTH orgs legitimately contain 1001
ok(jById(S_A, "obx", "j1").poNum === 1001, "client: obx first backfilled job = 1001 (floor works, org-scoped)");
ok(jById(S_A, "jam", "jm1").poNum === 1001, "client: jam preset 1001 preserved → obx & jam BOTH have a P1001 (per-org counters)");
// continue-from-max past a preset, deterministic by date+id
ok(jById(S_A, "obx", "j2").poNum === 1002, "client: obx j2 (later date) = 1002 (monotonic, deterministic by date+id)");
ok(jById(S_A, "jam", "jm2").poNum === 1002, "client: jam jm2 backfilled = 1002 (continues past the 1001 preset)");

// deterministic: a SECOND fresh load assigns identically
const ctxB = loadOnce(freshPre());
const S_B = vm.runInContext("S", ctxB);
ok(jById(S_B, "obx", "j1").poNum === 1001 && jById(S_B, "obx", "j2").poNum === 1002 && jById(S_B, "jam", "jm2").poNum === 1002, "client: DETERMINISTIC — a second independent load() assigns the identical poNums");

// idempotent: re-running load() in the SAME context never renumbers (and hands out no new numbers)
const beforeReload = obxJobs.map(j => j.id + ":" + j.poNum).sort().join(",") + "|" + jamJobs.map(j => j.id + ":" + j.poNum).sort().join(",");
vm.runInContext("load();", ctxA);
const S_A2 = vm.runInContext("S", ctxA);
const afterReload = arr(S_A2, "obx", "jobs").map(j => j.id + ":" + j.poNum).sort().join(",") + "|" + arr(S_A2, "jam", "jobs").map(j => j.id + ":" + j.poNum).sort().join(",");
ok(beforeReload === afterReload, "client: IDEMPOTENT — re-load() never renumbers an already-numbered job");
// no updatedAt bump from the derived backfill
ok(jById(S_A2, "obx", "j1").updatedAt === 1 && jById(S_A2, "jam", "jm1").updatedAt === 1, "client: backfill does NOT bump updatedAt (derived-local; won't churn sync)");

/* ============ 3) FINANCE BYTE-IDENTICAL — raw → migrate → client-load, per org ============ */
function qTotal(q) { return (q.finalPrice || q.total || 0); }
function qPaid(q) { return (q.payments || []).filter(p => p && !p.deleted).reduce((s, p) => s + (+p.amount || 0), 0); }
const orgIds = s => Object.keys(s).filter(k => k !== "users" && k !== "registry" && s[k] && typeof s[k] === "object" && !Array.isArray(s[k]));
function financeFingerprint(store) {
  const fp = {};
  orgIds(store).forEach(o => {
    const s = store[o]; if (!s || typeof s !== "object") return;
    const quotes = (s.quotes || []).filter(q => q && !q.deleted);
    let ar = 0; quotes.forEach(q => { if (q.invoiced && !q.paid) ar += qTotal(q); });
    fp[o + "|ar¢"] = Math.round(ar * 100);
    let bal = 0; quotes.forEach(q => { if (qTotal(q) > 0 && !q.paid) bal += Math.max(0, qTotal(q) - qPaid(q)); });
    fp[o + "|quote_bal¢"] = Math.round(bal * 100);
    let jc = 0; (s.jobs || []).forEach(j => { if (j && !j.deleted) (j.expenses || []).forEach(e => { if (e && !e.deleted) jc += F.finCents(e.amount); }); });
    fp[o + "|job_costs¢"] = jc;
    const mil = F.finMileage(s.timeclock || [], { confirmedOnly: true });
    fp[o + "|mileage¢"] = mil.total;
    const roll = F.finRollup(s.income || [], {});
    const pay = F.finPayouts(roll, mil);
    Object.keys(pay).sort().forEach(id => { fp[o + "|payout:" + id + "¢"] = pay[id].total; });
    fp[o + "|revenue¢"] = roll.totals.amount;
  });
  return fp;
}
const fpRaw = financeFingerprint(freshPre());
const fpMig = financeFingerprint(SS.mergeState(SS.migrateStore(JSON.parse(JSON.stringify(freshPre()))), {}));
const fpLoad = financeFingerprint({ obx: S_A.obx, jam: S_A.jam });
const fkeys = Array.from(new Set([].concat(Object.keys(fpRaw), Object.keys(fpMig), Object.keys(fpLoad)))).sort();
let drift = 0;
fkeys.forEach(k => { if (!(fpRaw[k] === fpMig[k] && fpRaw[k] === fpLoad[k])) { drift++; console.log("    ✗ FINANCE DRIFT " + k + ": raw=" + fpRaw[k] + " migrate=" + fpMig[k] + " load=" + fpLoad[k]); } });
ok(drift === 0, "finance fingerprint BYTE-IDENTICAL raw → migrate → client-load (" + fkeys.length + " sums, 0 drift — poNum is finance-inert)");

/* ============ 4) HELPERS (js/95) — round-trip + tolerant normalize ============ */
const _helperJobs = [{ id: "jx", title: "Mike Green patio", customerId: "c9", poNum: 1042 }, { id: "jy", title: "Other", poNum: 7 }];
global.actJ = () => _helperJobs;
const jx = _helperJobs[0];
ok(PO.jobPO(jx) === "P1042", "jobPO(poNum 1042) === 'P1042'");
ok(PO.jobByPO(PO.jobPO(jx)) === jx, "jobByPO(jobPO(j)) === j (exact round-trip)");
["P1042", "PO 1042", "#1042", "1042", "p1042", "  1042  "].forEach(s => ok(PO.poToNum(s) === 1042, "poToNum(" + JSON.stringify(s) + ") === 1042"));
ok(PO.poToNum("mike green") === null && PO.poToNum("NA") === null && PO.poToNum("") === null, "poToNum(a name / 'NA' / '') === null");
ok(PO.jobByPO("P1042") === jx && PO.jobByPO("mike green") === null, "jobByPO: exact code → the job; a name → null (fuzzy fallback)");
ok(PO.jobByPO("P9999") === null, "jobByPO: no match → null (0 hits)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — every customer/property/quote/job/account survives migrateStore + a sync round-trip + client load(); j.poNum is additive (unique per org, obx & jam both start at 1001, a preset is kept, backfill is deterministic + idempotent + no updatedAt bump), finance is byte-identical raw→migrate→load, and the js/95 helpers round-trip a P#### code exactly.");
process.exit(fail ? 1 : 0);
