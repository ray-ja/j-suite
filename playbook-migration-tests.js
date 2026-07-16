/* playbook-migration-tests.js — MANDATORY migration fixture (CLAUDE.md) for the PLAYBOOK LIBRARY collection.
 * A NEW synced collection `playbookLib` (per-org, LWW): reusable plant/process GUIDE entries the crew guides PULL
 * from. It holds NO money of its own (reference content only), so this data-layer change MUST prove ZERO LOSS +
 * byte-identical finance before it can ship.
 *
 * Loads a realistic PRE-change store (accounts, customers, properties, quotes, jobs, income, business expenses — and
 * NO playbookLib key anywhere) through:
 *   1) sync-server migrateStore + a no-op mergeState round-trip — zero loss of any customer/property/quote/job/
 *      account; EVERY org slab gains an empty playbookLib array (backfill).
 *   2) a sync round-trip that MERGES IN a playbookLib record proves it's a real LWW collection: the seeded record
 *      survives byte-for-byte AND every prior record is still there; a 2nd record merges in without dropping the 1st.
 *   3) the REAL client js/02-state.js load() (vm sandbox) — same zero-loss backfill; a playbookLib record injected
 *      into the client store survives load() with its fields intact; load() is idempotent.
 *   4) FINANCE BYTE-IDENTICAL: billingFingerprint (job pass-through materials + job expenses + business expenses,
 *      per org, in cents) is identical before → migrated → round-tripped. The library holds no money → unchanged.
 * Read-only: builds its own fixture; writes nothing.  Run: node playbook-migration-tests.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }

/* ---- billingFingerprint: copied verbatim from landscape-migration-tests.js (single source-of-truth math) ---- */
function billingFingerprint(store) {
  const fp = {};
  const orgIds = Object.keys(store).filter(k => k !== "users" && k !== "registry" && store[k] && typeof store[k] === "object" && !Array.isArray(store[k]));
  const cents = n => Math.round((+n || 0) * 100);
  orgIds.forEach(o => {
    let biz = 0;
    const matM = {}, expM = {};
    const liveJob = {}; (store[o].jobs || []).forEach(j => { if (j && j.id && !j.deleted) liveJob[j.id] = 1; });
    const put = (m, key, row) => { const c = m[key]; if (!c || (+row.updatedAt || 0) >= (+c.updatedAt || 0)) m[key] = row; };
    (store[o].jobs || []).forEach(j => { if (!j || j.deleted) return;
      (j.materials || []).forEach((m, i) => { if (m && !m.deleted) put(matM, j.id + "|" + (m.id != null ? m.id : ("jm_" + j.id + "_" + i)), m); });
      (j.expenses || []).forEach((e, i) => { if (e && !e.deleted) put(expM, j.id + "|" + (e.id != null ? e.id : ("je_" + j.id + "_" + i)), e); });
    });
    (store[o].jobMaterials || []).forEach(m => { if (m && !m.deleted && m.id != null && liveJob[m.jobId]) put(matM, (m.jobId || "") + "|" + m.id, m); });
    (store[o].jobExpenses || []).forEach(e => { if (e && !e.deleted && e.id != null && liveJob[e.jobId]) put(expM, (e.jobId || "") + "|" + e.id, e); });
    (store[o].expenses || []).forEach(e => { if (e && !e.deleted) biz += cents(e.amount); });
    const sum = m => Object.keys(m).reduce((s, k) => s + cents(m[k].amount), 0);
    fp[o + ".job-materials¢"] = sum(matM); fp[o + ".job-expenses¢"] = sum(expM); fp[o + ".business-expenses¢"] = biz;
  });
  return fp;
}

/* realistic PRE-change fixture (server/data.json shape) — a full obx business slice with NO playbookLib key, and a
   jam org that also lacks one. Both must GAIN an empty playbookLib array on migrate. */
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
          expenses: [{ id: "e3", amount: 45, desc: "materials" }], updatedAt: 1 }
      ],
      income: [{ id: "in1", quoteId: "q2", amount: 520, ts: 1700000000000, updatedAt: 1 }],
      expenses: [{ id: "be1", amount: 99.5, desc: "insurance", updatedAt: 1 }],
      inventory: [], locks: [], timeclock: [], messages: [], resale: [], pendingChanges: [], knowledge: [],
      disbursements: [], changelog: [], docs: [], places: []
      // NOTE: no playbookLib key — the migration must add one
    },
    jam: { customers: [], quotes: [], jobs: [] }   // fresh org WITHOUT a playbookLib array → migration must add one
  };
}
/* a realistic playbookLib record (what js/114 seeds/writes) — merged in during the round-trip to prove LWW */
function samplePl() {
  return {
    id: "pl_crape_myrtle", kind: "plant", key: "crape_myrtle", name: "Crape myrtle", latin: "Lagerstroemia indica",
    category: "tree", identify: "Multi-trunk small tree; mottled peeling bark; crinkled summer blooms.",
    do: ["Thin to structure"], dont: ["Do NOT top to stubs ('crape murder')"], when: "Late winter (February)",
    tools: ["Hand pruners", "Loppers"], safety: [], refImage: "e208c71b1e7d539e89bf1ccb.jpg",
    aliases: ["crepe myrtle"], deleted: false, updatedAt: 2
  };
}
const arr = (s, k) => ((s.obx && s.obx[k]) || []).filter(x => x && !x.deleted);
const plById = (s, id) => ((s.obx && s.obx.playbookLib) || []).find(v => v && v.id === id) || null;

/* ============ 1) SERVER — migrateStore + a no-op round-trip: zero loss + empty playbookLib backfilled ============ */
const pre = freshPre();
const counts = { customers: arr(pre, "customers").length, properties: arr(pre, "properties").length, quotes: arr(pre, "quotes").length, jobs: arr(pre, "jobs").length, income: arr(pre, "income").length, expenses: arr(pre, "expenses").length, users: (pre.users || []).length };
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
["customers", "properties", "quotes", "jobs", "income", "expenses"].forEach(k => ok(arr(round, k).length === counts[k], "server round-trip: no " + k + " loss (" + counts[k] + ")"));
ok((pre.users || []).every(u => (round.users || []).some(r => r && r.id === u.id)), "server round-trip: every original account survives (" + counts.users + ")");
ok(Array.isArray(round.obx && round.obx.playbookLib) && round.obx.playbookLib.length === 0, "server: obx (had no playbookLib) gets an empty playbookLib array");
ok(Array.isArray(round.jam && round.jam.playbookLib) && round.jam.playbookLib.length === 0, "server: fresh org (jam) gets an empty playbookLib array");

/* ============ 2) SERVER — MERGE IN a playbookLib record: real LWW collection, prior records untouched ============ */
const withPl = SS.mergeState(migrated, { obx: { playbookLib: [samplePl()] } });
const sPl = plById(withPl, "pl_crape_myrtle");
ok(!!sPl, "server: a merged-in playbookLib record (pl_crape_myrtle) survives the sync round-trip");
ok(sPl && JSON.stringify(sPl) === JSON.stringify(samplePl()), "server: pl_crape_myrtle byte-identical (do/dont/tools/refImage/aliases preserved verbatim)");
["customers", "properties", "quotes", "jobs", "income", "expenses"].forEach(k => ok(arr(withPl, k).length === counts[k], "server: prior " + k + " still intact after merging the library record (" + counts[k] + ")"));
// a SECOND record merges in without dropping the first (real LWW collection)
const withTwo = SS.mergeState(withPl, { obx: { playbookLib: [{ id: "pl_french_drain", kind: "process", key: "french_drain", name: "French drain", do: ["Trench to slope"], dont: [], tools: [], safety: [], aliases: [], updatedAt: 3 }] } });
ok((withTwo.obx.playbookLib || []).some(v => v && v.id === "pl_crape_myrtle") && (withTwo.obx.playbookLib || []).some(v => v && v.id === "pl_french_drain"), "server: playbookLib is LWW (new record merges in, existing kept)");

/* ============ 3) CLIENT — the REAL js/02 load(): zero-loss backfill + record survives + idempotent ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, isFinite: isFinite, parseFloat: parseFloat };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
clientPre.obx.playbookLib = [samplePl()];   // a record already in the client store must survive load() with fields intact
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext("load();", ctx);
const S_after = vm.runInContext("S", ctx);
["customers", "properties", "quotes", "jobs", "income", "expenses"].forEach(k => ok(arr(S_after, k).length === counts[k], "client load(): no " + k + " loss (" + counts[k] + ")"));
const cPl = plById(S_after, "pl_crape_myrtle");
ok(cPl && Array.isArray(cPl.do) && cPl.do[0] === "Thin to structure" && cPl.refImage === "e208c71b1e7d539e89bf1ccb.jpg" && cPl.kind === "plant", "client: pl_crape_myrtle survives load() with its fields intact");
ok(Array.isArray(S_after.jam && S_after.jam.playbookLib) && S_after.jam.playbookLib.length === 0, "client: fresh org (jam) has an empty playbookLib array after load()");
vm.runInContext("load();", ctx);
const S2 = vm.runInContext("S", ctx);
ok(arr(S2, "playbookLib").length === 1, "client: load() is idempotent (no record invented or dropped on re-run — pbLibSeed absent in sandbox)");

/* ============ 4) FINANCE BYTE-IDENTICAL — billingFingerprint before vs migrated vs round-trip vs with-record ============ */
const fpBefore = billingFingerprint(pre), fpMig = billingFingerprint(migrated), fpRound = billingFingerprint(round), fpPl = billingFingerprint(withPl);
let drift = 0;
Object.keys(fpBefore).forEach(k => { if (fpMig[k] !== fpBefore[k] || fpRound[k] !== fpBefore[k] || fpPl[k] !== fpBefore[k]) { drift++; console.log("    ✗ BILLING DRIFT " + k + ": before=" + fpBefore[k] + " migrated=" + fpMig[k] + " round=" + fpRound[k] + " withPl=" + fpPl[k]); } });
ok(drift === 0, "billing byte-identical: job materials + job expenses + business expenses unchanged by playbookLib (" + Object.keys(fpBefore).length + " sums, 0 drift)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED — DO NOT SHIP") : "\n  ✓ ZERO LOSS — every customer/property/quote/job/account survives migrateStore + a sync round-trip + client load(); playbookLib is a real LWW collection (a seeded record + all prior records preserved); every org slab backfills an empty array; finance is byte-identical.");
process.exit(fail ? 1 : 0);
