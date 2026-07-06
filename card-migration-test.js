/* card-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for CARD LAST-4 AUTO-ATTRIBUTION.
   The change is purely ADDITIVE — three optional fields on ALREADY-SYNCED collections, NEVER moving a record
   or re-amounting anything:
     · u.cards[]                    on the synced `users` collection      (self-write, rides S.users LWW)
     · registry[org].businessCards[] on the synced `registry` collection  (owner/admin-gated via REG_ADMIN_FIELDS)
     · receipt.cardLast4            on the synced `receipts` collection
   This loads a REALISTIC pre/at-change fixture (a full data.json shape: accounts, jobs w/ expenses+materials,
   review receipts, org business expenses — plus the new card fields) through:
     1) the sync-server migrateStore + mergeState per-record LWW round-trip, and
     2) the ACTUAL client js/02-state.js load() (in a vm sandbox),
   and asserts ZERO LOSS of every account / job / receipt / expense, that the new card fields SURVIVE both paths,
   and that BOTH finance fingerprints (Σ job-cost cents + mileage cents) are BYTE-IDENTICAL raw → migrate →
   client-load (card/paidBy are reimbursement-attribution, NOT in the fingerprints).
   Run: node card-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
const f = require("./js/39-finance-core");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const TODAY = ymd(new Date());

/* ---- realistic fixture WITH the new card fields present ---- */
function freshPre() {
  return {
    users: [
      { id: "u_ray", username: "Ray", role: "owner", superAdmin: true, cards: [{ id: "cd_ray1", last4: "4242", label: "Ray Visa", kind: "personal", addedAt: 1 }], updatedAt: 1 },
      { id: "u_chase", username: "Chase", role: "crew", cards: [{ id: "cd_ch1", last4: "1005", label: "Chase debit", kind: "personal", addedAt: 1 }], updatedAt: 1 },
      { id: "u_pierce", username: "Pierce", role: "crew", updatedAt: 1 },   // no cards — must stay byte-identical (no card fields materialized)
      { id: "mem_obx_ray", kind: "membership", orgId: "obx", accountId: "u_ray", role: "owner", updatedAt: 1 }
    ],
    registry: [
      { id: "obx", name: "OBX Lot Solutions", businessCards: [{ id: "bc_amex", last4: "3005", label: "Business Amex", active: true, addedAt: 1 }], updatedAt: 1 },
      { id: "jam", name: "JAM", updatedAt: 1 }   // org WITHOUT businessCards — must stay unaffected
    ],
    obx: {
      customers: [{ id: "c1", name: "Seaside HOA", updatedAt: 1 }],
      properties: [{ id: "p1", customerId: "c1", updatedAt: 1 }],
      quotes: [{ id: "q1", customerId: "c1", total: 1000, finalPrice: 1000, num: 1, updatedAt: 1 }],
      jobs: [
        { id: "jP", title: "Paver patio", customerId: "c1", quoteId: "q1", date: TODAY, crew: ["u_ray"],
          expenses: [{ id: "e_dump", amount: 73.16, desc: "dump fee", category: "job", paidBy: "u_chase", cardLast4: "1005", deleted: false }],
          materials: [{ id: "m1", amount: 800, desc: "pavers", paidBy: "u_ray", cardLast4: "4242", deleted: false }], updatedAt: 1 }
      ],
      // a review receipt carrying a captured card last-4 (business-card match)
      receipts: [
        { id: "r_rev", receiptId: "ph_rev", amount: 120, vendor: "Home Depot", status: "review", cardLast4: "3005", deleted: false, updatedAt: 1 }
      ],
      income: [], expenses: [{ id: "biz1", amount: 60, category: "subscription/software", note: "domain", date: TODAY, paidBy: "u_ray", cardLast4: "4242", deleted: false, updatedAt: 1 }],
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
  let jexp = 0, jmat = 0;
  ((store.obx && store.obx.jobs) || []).forEach(j => { jexp += (j.expenses || []).length; jmat += (j.materials || []).length; });
  c["obx.jobExpenses(all)"] = jexp; c["obx.jobMaterials(all)"] = jmat;
  c._accounts = (store.users || []).filter(u => u && !u.kind && !u.deleted).length;
  c._memberships = (store.users || []).filter(u => u && u.kind === "membership").length;
  c._registry = (store.registry || []).filter(r => r && !r.deleted).length;
  return c;
}
/* the FINGERPRINT the stage/mileage gates use — card/paidBy-agnostic raw Σ job.expenses cents + mileage cents. */
function fingerprint(store) {
  const fp = {};
  ["obx", "jam"].forEach(o => {
    const s = store[o]; if (!s) return;
    let jc = 0; (s.jobs || []).forEach(j => { if (j && !j.deleted) (j.expenses || []).forEach(e => { if (e && !e.deleted) jc += f.finCents(e.amount); }); });
    fp[o + "|job_costs¢"] = jc;
    fp[o + "|mileage¢"] = f.finMileage(s.timeclock || [], { confirmedOnly: true }).total;
  });
  return fp;
}
/* pull the three new card fields out of a store so we can assert survival */
function cardsOf(store) {
  const ray = (store.users || []).find(u => u.id === "u_ray") || {};
  const chase = (store.users || []).find(u => u.id === "u_chase") || {};
  const pierce = (store.users || []).find(u => u.id === "u_pierce") || {};
  const obxReg = (store.registry || []).find(r => r.id === "obx") || {};
  const jamReg = (store.registry || []).find(r => r.id === "jam") || {};
  const rev = ((store.obx && store.obx.receipts) || []).find(r => r.id === "r_rev") || {};
  const jP = ((store.obx && store.obx.jobs) || []).find(j => j.id === "jP") || {};
  const mat = (jP.materials || []).find(m => m.id === "m1") || {};
  const exp = (jP.expenses || []).find(e => e.id === "e_dump") || {};
  return {
    rayCard: (ray.cards && ray.cards[0] && ray.cards[0].last4) || null,
    chaseCard: (chase.cards && chase.cards[0] && chase.cards[0].last4) || null,
    pierceHasCardsKey: Object.prototype.hasOwnProperty.call(pierce, "cards"),
    bizCard: (obxReg.businessCards && obxReg.businessCards[0] && obxReg.businessCards[0].last4) || null,
    jamHasBizKey: Object.prototype.hasOwnProperty.call(jamReg, "businessCards"),
    revCard: rev.cardLast4 || null,
    matCard: mat.cardLast4 || null,
    expCard: exp.cardLast4 || null
  };
}

/* ==================================================================================================
   1) SERVER SIDE — migrateStore + a no-op sync round-trip drop nothing; the card fields survive LWW.
   ================================================================================================== */
const pre = freshPre();
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "server round-trip: no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));
const cMig = cardsOf(migrated), cRound = cardsOf(round);
ok(cRound.rayCard === "4242" && cRound.chaseCard === "1005", "server: personal u.cards survive migrate + round-trip (Ray 4242, Chase 1005)");
ok(cRound.bizCard === "3005", "server: registry.businessCards survives (obx Business Amex 3005)");
ok(cRound.revCard === "3005" && cRound.matCard === "4242" && cRound.expCard === "1005", "server: receipt/material/expense cardLast4 all survive the merge");
ok(cRound.pierceHasCardsKey === false, "server: an account WITHOUT cards never grows a cards field (byte-identical)");
ok(cRound.jamHasBizKey === false, "server: an org WITHOUT businessCards is unaffected (no field materialized)");

/* ==================================================================================================
   2) CLIENT SIDE — run the REAL js/02-state.js load() (vm sandbox) over the fixture; nothing lost, cards survive.
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
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true, quoteVersionsV1: true, expCatV1: true, membersV1: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext("load();", ctx);
const S_after = vm.runInContext("S", ctx);

const cbBefore = census(pre), cbAfter = census(S_after);
Object.keys(cbBefore).forEach(k => ok(cbAfter[k] >= cbBefore[k], "client load(): no loss in " + k + " (before=" + cbBefore[k] + " after=" + cbAfter[k] + ")"));
const cClient = cardsOf(S_after);
ok(cClient.rayCard === "4242" && cClient.chaseCard === "1005", "client load(): personal u.cards survive");
ok(cClient.bizCard === "3005", "client load(): registry.businessCards survives");
ok(cClient.revCard === "3005" && cClient.matCard === "4242" && cClient.expCard === "1005", "client load(): receipt/material/expense cardLast4 survive");
ok(cClient.pierceHasCardsKey === false && cClient.jamHasBizKey === false, "client load(): card-less accounts/orgs stay byte-identical (no field added)");

/* ---- 3) FINGERPRINTS byte-identical: raw → server-migrated → client-loaded ---- */
const fpRaw = fingerprint(pre), fpMig = fingerprint(migrated), fpClient = fingerprint(S_after);
const keys = Array.from(new Set([].concat(Object.keys(fpRaw), Object.keys(fpMig), Object.keys(fpClient)))).sort();
let drift = 0;
keys.forEach(k => { if (!(fpRaw[k] === fpMig[k] && fpRaw[k] === fpClient[k])) { console.log("    ✗ FP DRIFT " + k + ": raw=" + fpRaw[k] + " mig=" + fpMig[k] + " client=" + fpClient[k]); drift++; } });
ok(drift === 0, "BOTH fingerprints (job-cost + mileage cents) byte-identical across raw → migrate → client-load (" + keys.length + " sums, 0 drift)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — every account/job/receipt/expense survives, u.cards + businessCards + cardLast4 ride the sync intact, card-less records byte-identical, both fingerprints unchanged.");
process.exit(fail ? 1 : 0);
