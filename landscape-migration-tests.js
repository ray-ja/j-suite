/* landscape-migration-tests.js — MANDATORY migration fixture (CLAUDE.md) for the LANDSCAPING SITE-SURVEY collection.
 * A NEW synced collection `siteSurveys` (per-org, LWW). A survey holds detected plants/tasks + drafted line items but
 * NO money of its own (it assembles into a normal quote), so this is a data-layer change that MUST prove ZERO LOSS +
 * byte-identical finance before it can ship.
 *
 * Loads a realistic PRE-change store (accounts, customers, properties, quotes, jobs, income, business expenses — and
 * NO siteSurveys key anywhere) through:
 *   1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough) — zero loss of any
 *      customer / property / quote / job / account; EVERY org slab gains an empty siteSurveys array (backfill).
 *   2) a sync round-trip that MERGES IN a survey record proves siteSurveys is a real LWW collection: the seeded
 *      survey survives byte-for-byte AND every prior record is still there.
 *   3) the REAL client js/02-state.js load() (vm sandbox) — same zero-loss backfill; a survey injected into the
 *      client store survives load() with its items intact; load() is idempotent.
 *   4) FINANCE BYTE-IDENTICAL: billingFingerprint (job pass-through materials + job expenses + business expenses, per
 *      org, in cents) is identical before → migrated → round-tripped. A survey holds no money → trivially unchanged.
 * Read-only: builds its own fixture; writes nothing.  Run: node landscape-migration-tests.js   (exit 0 = green) */
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

/* realistic PRE-change fixture (server/data.json shape) — a full obx business slice with NO siteSurveys key, and a
   jam org that also lacks one. Both must GAIN an empty siteSurveys array on migrate. */
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
      // NOTE: no siteSurveys key — the migration must add one
    },
    jam: { customers: [], quotes: [], jobs: [] }   // fresh org WITHOUT a siteSurveys array → migration must add one
  };
}
/* a realistic survey record (what js/113 writes) — merged in during the round-trip to prove LWW preservation */
function sampleSurvey() {
  return {
    id: "srv_1", customerId: "c1", propertyId: "p1", address: "1 Main St", title: "Alpha Cust — site survey",
    photoIds: ["ph_aaa.jpg", "ph_bbb.jpg"], status: "draft", quoteId: null, createdBy: "u_ray", ts: 1700000000000,
    items: [
      { id: "it1", photoId: "ph_aaa.jpg", plant: "Crape myrtle", latin: "Lagerstroemia", category: "tree",
        confidence: "high", count: 2, approxSize: "8-10 ft", condition: "overgrown", service: "prune",
        howTo: "Thin to structure", caution: "No crape murder", bestSeason: "late winter (Feb)", timingWarnNow: true,
        laborMin: 90, materials: "", recurring: true, price: 140, matCost: 0, status: "approved", suggested: {} },
      { id: "it2", photoId: "ph_bbb.jpg", plant: "unknown", latin: "", category: "shrub", confidence: "low",
        count: 1, approxSize: "", condition: "weedy", service: "weed", howTo: "", caution: "", bestSeason: "",
        timingWarnNow: false, laborMin: 20, materials: "3 bags mulch", recurring: false, price: 30, matCost: 25,
        status: "review", suggested: {} }
    ],
    deleted: false, updatedAt: 2
  };
}
const arr = (s, k) => ((s.obx && s.obx[k]) || []).filter(x => x && !x.deleted);
const surveyById = (s, id) => ((s.obx && s.obx.siteSurveys) || []).find(v => v && v.id === id) || null;

/* ============ 1) SERVER — migrateStore + a no-op round-trip: zero loss + empty siteSurveys backfilled ============ */
const pre = freshPre();
const counts = { customers: arr(pre, "customers").length, properties: arr(pre, "properties").length, quotes: arr(pre, "quotes").length, jobs: arr(pre, "jobs").length, income: arr(pre, "income").length, expenses: arr(pre, "expenses").length, users: (pre.users || []).length };
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
["customers", "properties", "quotes", "jobs", "income", "expenses"].forEach(k => ok(arr(round, k).length === counts[k], "server round-trip: no " + k + " loss (" + counts[k] + ")"));
ok((pre.users || []).every(u => (round.users || []).some(r => r && r.id === u.id)), "server round-trip: every original account survives (" + counts.users + ")");
ok(Array.isArray(round.obx && round.obx.siteSurveys) && round.obx.siteSurveys.length === 0, "server: obx (had no siteSurveys) gets an empty siteSurveys array");
ok(Array.isArray(round.jam && round.jam.siteSurveys) && round.jam.siteSurveys.length === 0, "server: fresh org (jam) gets an empty siteSurveys array");

/* ============ 2) SERVER — MERGE IN a survey: siteSurveys is a real LWW collection, prior records untouched ============ */
const withSurvey = SS.mergeState(migrated, { obx: { siteSurveys: [sampleSurvey()] } });
const sSv = surveyById(withSurvey, "srv_1");
ok(!!sSv, "server: a merged-in siteSurvey (srv_1) survives the sync round-trip");
ok(sSv && JSON.stringify(sSv) === JSON.stringify(sampleSurvey()), "server: srv_1 byte-identical (photoIds + 2 items preserved verbatim)");
ok(sSv && Array.isArray(sSv.items) && sSv.items.length === 2 && sSv.items[0].plant === "Crape myrtle", "server: survey items[] preserved");
["customers", "properties", "quotes", "jobs", "income", "expenses"].forEach(k => ok(arr(withSurvey, k).length === counts[k], "server: prior " + k + " still intact after merging the survey (" + counts[k] + ")"));
// a SECOND survey merges in without dropping the first (real LWW collection)
const withTwo = SS.mergeState(withSurvey, { obx: { siteSurveys: [{ id: "srv_2", status: "quoted", customerId: "c2", photoIds: [], items: [], updatedAt: 3 }] } });
ok((withTwo.obx.siteSurveys || []).some(v => v && v.id === "srv_1") && (withTwo.obx.siteSurveys || []).some(v => v && v.id === "srv_2"), "server: siteSurveys is LWW (new survey merges in, existing kept)");

/* ============ 3) CLIENT — the REAL js/02 load(): zero-loss backfill + survey survives + idempotent ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, isFinite: isFinite, parseFloat: parseFloat };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
clientPre.obx.siteSurveys = [sampleSurvey()];   // a survey already in the client store must survive load() with items intact
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext("load();", ctx);
const S_after = vm.runInContext("S", ctx);
["customers", "properties", "quotes", "jobs", "income", "expenses"].forEach(k => ok(arr(S_after, k).length === counts[k], "client load(): no " + k + " loss (" + counts[k] + ")"));
const cSv = surveyById(S_after, "srv_1");
ok(cSv && Array.isArray(cSv.items) && cSv.items.length === 2 && cSv.items[0].plant === "Crape myrtle" && cSv.items[0].status === "approved", "client: srv_1 survives load() with its items intact");
ok(Array.isArray(S_after.jam && S_after.jam.siteSurveys) && S_after.jam.siteSurveys.length === 0, "client: fresh org (jam) has an empty siteSurveys array after load()");
vm.runInContext("load();", ctx);
const S2 = vm.runInContext("S", ctx);
ok(arr(S2, "siteSurveys").length === 1, "client: load() is idempotent (no survey invented or dropped on re-run)");

/* ============ 4) FINANCE BYTE-IDENTICAL — billingFingerprint before vs migrated vs round-trip vs with-survey ============ */
const fpBefore = billingFingerprint(pre), fpMig = billingFingerprint(migrated), fpRound = billingFingerprint(round), fpSv = billingFingerprint(withSurvey);
let drift = 0;
Object.keys(fpBefore).forEach(k => { if (fpMig[k] !== fpBefore[k] || fpRound[k] !== fpBefore[k] || fpSv[k] !== fpBefore[k]) { drift++; console.log("    ✗ BILLING DRIFT " + k + ": before=" + fpBefore[k] + " migrated=" + fpMig[k] + " round=" + fpRound[k] + " withSurvey=" + fpSv[k]); } });
ok(drift === 0, "billing byte-identical: job materials + job expenses + business expenses unchanged by siteSurveys (" + Object.keys(fpBefore).length + " sums, 0 drift)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED — DO NOT SHIP") : "\n  ✓ ZERO LOSS — every customer/property/quote/job/account survives migrateStore + a sync round-trip + client load(); siteSurveys is a real LWW collection (a seeded survey + all prior records preserved); every org slab backfills an empty array; finance is byte-identical.");
process.exit(fail ? 1 : 0);
