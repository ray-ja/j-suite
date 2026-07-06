/* rental-deposit-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for RENTAL DEPOSIT / REFUND handling
 * (js/96 HOLD-OUT model). Additive receipt/expense fields only: isDeposit (a refundable rental deposit),
 * depositSettled (owner has reconciled it), refundOfId (the deposit id a refund offsets), kind ("refund" = a
 * negative credit). NO new collection, NO record movement, NO re-amounting. Absent = today's behavior.
 *
 * Loads a realistic PRE-change store (jobs/receipts WITHOUT the fields, plus a deposit+refund pair) through:
 *   1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW) — zero loss of any customer /
 *      property / quote / job / account; a record WITHOUT the new fields is never invented them; a deposit+refund
 *      pair survives VERBATIM (isDeposit/refundOfId/kind/amount intact, incl. the negative refund amount).
 *   2) the REAL client js/02 load() (vm sandbox) — same zero-loss; absent fields stay absent/falsy; and money()
 *      is sign-correct ("-$90", byte-identical for every >= 0).
 *   3) FINGERPRINT BYTE-IDENTICAL: the raw-Σ finance fingerprint (mirrors stage-fingerprint-test) is computed with
 *      the deposit FLAGS absent and again with them PRESENT on the same records — asserted identical, proving the
 *      sync/finance fingerprints never read the flags (existing data.json has no deposits → nothing excluded).
 *   4) BEHAVIORAL (js/52 jobProfit / jobCostBreakdown + js/72 jobExpenseTotal + js/96 depositHeld/depositSettle):
 *      an UNSETTLED deposit group is HELD → $0 to the job; once SETTLED it counts at NET (deposit + refund).
 * Read-only: builds its own fixture; writes nothing.
 * Run: node rental-deposit-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
const F = require("./js/39-finance-core");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* realistic PRE-CHANGE fixture — a full slice with a deposit+refund pair on j1 (rental) and a plain expense on j2. */
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
        { id: "q1", cust: "Alpha Cust", customerId: "c1", jobId: "j1", total: 2000, finalPrice: 2000, invoiced: true, updatedAt: 1 },
        { id: "q2", cust: "Beta Cust", customerId: "c2", jobId: "j2", total: 500, finalPrice: 520, paid: true, payments: [{ id: "pm1", amount: 520 }], updatedAt: 1 }
      ],
      jobs: [
        // j1: a $300 rental DEPOSIT (isDeposit) + a −$90 REFUND (refundOfId) — the deposit+refund pair; plus a plain expense
        { id: "j1", quoteId: "q1", title: "Paver walkway", customerId: "c1", done: true, crew: ["u_ray", "u_kc"], date: "2026-07-01",
          receiptsClosedBy: [{ userId: "u_ray" }],
          expenses: [
            { id: "e_dep", amount: 300, vendor: "Sunbelt", desc: "trailer deposit", category: "rentals", isDeposit: true, deleted: false },
            { id: "e_ref", amount: -90, vendor: "Sunbelt", desc: "partial refund", category: "rentals", kind: "refund", refundOfId: "e_dep", deleted: false },
            { id: "e_dump", amount: 73.16, vendor: "dump", desc: "disposal", category: "disposal", deleted: false }
          ], materials: [], updatedAt: 1 },
        // j2: a plain expense, NO deposit fields at all → must survive + stay absent
        { id: "j2", quoteId: "q2", title: "Cleanup", customerId: "c2", done: true, crew: ["u_ray"], date: "2026-07-01",
          expenses: [{ id: "e3", amount: 45, desc: "materials", category: "materials", deleted: false }], materials: [], updatedAt: 1 }
      ],
      income: [{ id: "in1", quoteId: "q2", amount: 520, ts: 1700000000000, updatedAt: 1 }],
      expenses: [], inventory: [], locks: [],
      timeclock: [{ id: "tc1", userId: "u_ray", jobId: "j1", clockIn: 1, clockOut: 2, miles: 30, milesConfirmed: true, updatedAt: 1 }],
      receipts: [], messages: [], resale: [], pendingChanges: [], knowledge: [], disbursements: [], changelog: [], docs: [], places: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}
const arr = (s, k) => ((s.obx && s.obx[k]) || []).filter(x => x && !x.deleted);
const jById = (s, id) => ((s.obx && s.obx.jobs) || []).find(j => j && j.id === id) || null;
const eById = (j, id) => ((j && j.expenses) || []).find(e => e && e.id === id) || null;

/* ============ 1) SERVER — migrateStore + a no-op round-trip: zero loss + deposit/refund preserved verbatim ============ */
const pre = freshPre();
const counts = { customers: arr(pre, "customers").length, properties: arr(pre, "properties").length, quotes: arr(pre, "quotes").length, jobs: arr(pre, "jobs").length, users: (pre.users || []).length };
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
["customers", "properties", "quotes", "jobs"].forEach(k => ok(arr(round, k).length === counts[k], "server round-trip: no " + k + " loss (" + counts[k] + ")"));
ok((pre.users || []).every(u => (round.users || []).some(r => r && r.id === u.id)), "server round-trip: every original account survives (" + counts.users + ")");
const rj1 = jById(round, "j1"), rDep = eById(rj1, "e_dep"), rRef = eById(rj1, "e_ref");
ok(rDep && rDep.isDeposit === true && rDep.amount === 300 && rDep.category === "rentals", "server: the $300 deposit survives verbatim (isDeposit + amount + category)");
ok(rRef && rRef.refundOfId === "e_dep" && rRef.kind === "refund" && rRef.amount === -90, "server: the −$90 refund survives verbatim (refundOfId + kind + NEGATIVE amount)");
ok(eById(rj1, "e_dump") && !("isDeposit" in eById(rj1, "e_dump")), "server: a plain expense is NOT invented deposit fields");
ok(!("isDeposit" in eById(jById(round, "j2"), "e3")), "server: j2's plain expense stays field-free");

/* ============ 2) CLIENT — the REAL js/02 load(): zero loss; absent stays falsy; money() sign-correct ============ */
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
const cj1 = jById(S_after, "j1");
ok(eById(cj1, "e_dep").isDeposit === true && eById(cj1, "e_ref").amount === -90 && eById(cj1, "e_ref").refundOfId === "e_dep", "client: deposit+refund pair survives load() verbatim");
ok(!eById(cj1, "e_dump").isDeposit, "client: a plain expense is falsy for isDeposit after load() (== today)");
// money() is sign-correct in the loaded client context — byte-identical for every >= 0
const cmoney = vm.runInContext("money", ctx);
ok(cmoney(-90) === "-$90", "client money(-90) === '-$90' (sign-correct, not '$-90')");
ok(cmoney(90) === "$90" && cmoney(0) === "$0" && cmoney(1500) === "$1,500", "client money() byte-identical for >= 0 (fingerprint-neutral)");

/* ============ 3) FINGERPRINT BYTE-IDENTICAL — the deposit FLAGS never move the raw-Σ finance fingerprint ======= */
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
  fp["job_costs¢"] = jc;   // RAW Σ — signed, flag-agnostic (a −90 refund nets the 300 deposit by construction)
  const mil = F.finMileage(s.timeclock || [], { confirmedOnly: true });
  fp["mileage¢"] = mil.total;
  const roll = F.finRollup(s.income || [], {});
  const pay = F.finPayouts(roll, mil);
  Object.keys(pay).sort().forEach(id => { fp["payout:" + id + "¢"] = pay[id].total; });
  fp["revenue¢"] = roll.totals.amount;
  return fp;
}
// STRIP the deposit flags off every record (the "before this feature" shape), fingerprint; then WITH the flags on.
const stripped = freshPre();
stripped.obx.jobs.forEach(j => (j.expenses || []).forEach(e => { delete e.isDeposit; delete e.depositSettled; delete e.refundOfId; delete e.kind; }));
const fpAbsent = financeFingerprint(stripped);
const fpPresent = financeFingerprint(freshPre());
const fkeys = Array.from(new Set([].concat(Object.keys(fpAbsent), Object.keys(fpPresent)))).sort();
let drift = 0;
fkeys.forEach(k => { if (fpAbsent[k] !== fpPresent[k]) { drift++; console.log("    ✗ FINGERPRINT DRIFT " + k + ": absent=" + fpAbsent[k] + " present=" + fpPresent[k]); } });
ok(drift === 0, "raw-Σ fingerprint BYTE-IDENTICAL with the deposit flags absent vs present (" + fkeys.length + " sums, 0 drift)");

/* ============ 4) BEHAVIORAL — HOLD-OUT: held → $0, settled → net (js/52 jobProfit + js/72 jobExpenseTotal) ======= */
const behav = freshPre();
const bj1 = jById(behav, "j1");
global.window = global;
global.D = () => behav.obx;
global.now = () => Date.now();
let _bn = 0; global.uid = () => "bid_" + (++_bn);
global.touch = r => { if (r) r.updatedAt = Date.now(); return r; };
global.save = () => {};
global.plExpenses = j => (j && j.expenses) || [];
global.plMaterials = j => (j && j.materials) || [];
global.subJobsOf = () => [];
global.stopSplitN = () => 1;
global.jobMileageCost = () => 0;
global.jobMilesCostEst = () => 0;
global.plQuoteFor = j => (behav.obx.quotes || []).find(q => q && q.jobId === j.id) || null;
global.quoteType = () => "Paver";
global.custName = () => "Alpha Cust";
const bcode = fs.readFileSync(__dirname + "/js/96-rental-deposits.js", "utf8") + "\n"
  + fs.readFileSync(__dirname + "/js/52-job-pl.js", "utf8") + "\n"
  + fs.readFileSync(__dirname + "/js/72-receipts.js", "utf8");
eval(bcode);
// while HELD: the $300 deposit + −$90 refund are excluded; only the $73.16 dump counts
ok(depositHeld(eById(bj1, "e_dep")) === true && depositHeld(eById(bj1, "e_ref")) === true, "behavioral: the deposit + its refund are HELD while unsettled");
ok(Math.round(jobExpenseTotal(bj1) * 100) === 7316, "behavioral: jobExpenseTotal HELD → only the $73.16 dump (deposit group = $0)");
const pHeld = jobProfit(bj1);
ok(Math.round(pHeld.expCost * 100) === 7316, "behavioral: jobProfit.expCost HELD → $73.16 (deposit group excluded)");
const bdHeld = jobCostBreakdown(bj1);
ok(Math.round(bdHeld.jobExp * 100) === 7316, "behavioral: jobCostBreakdown.jobExp HELD → $73.16");
// SETTLE the group → the net (300 − 90 = 210) now counts, plus the dump = 283.16
ok(depositSettle("e_dep") === true, "behavioral: depositSettle('e_dep') settles the deposit + its linked refund");
ok(depositHeld(eById(bj1, "e_dep")) === false && depositHeld(eById(bj1, "e_ref")) === false, "behavioral: after settle nothing is held");
ok(Math.round(jobExpenseTotal(bj1) * 100) === 28316, "behavioral: jobExpenseTotal SETTLED → 210 net + 73.16 dump = $283.16");
ok(Math.round(jobProfit(bj1).expCost * 100) === 28316, "behavioral: jobProfit.expCost SETTLED → $283.16 (net counted)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — every customer/property/quote/job/account survives migrateStore + a sync round-trip + client load(); the deposit/refund fields are additive (absent stays falsy, a deposit+refund pair is verbatim incl. the negative amount), the raw-Σ finance fingerprint is byte-identical with the flags absent vs present, and the HOLD-OUT model holds a deposit group out of job cost ($0) until settle, then counts it at net.");
process.exit(fail ? 1 : 0);
