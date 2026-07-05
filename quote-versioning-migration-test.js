/* quote-versioning-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for CHANGE-ORDERS → QUOTE
   VERSIONING (Cluster C). The whole feature is ADDITIVE on the already-synced `quotes` collection — a new
   append-only q.versions[] change-event log that rides quote LWW. No new collection, no COLLECTIONS change.
   The money side (js/50 quoteTotalAmt/quoteBalAmt, js/40 syncQuoteIncome, js/52 jobProfit, js/64 A/R) reads
   ONLY q.finalPrice||q.total + q.payments[] — NEVER q.versions — so versioning must be BYTE-IDENTICAL for
   every existing quote's total / A/R / balance / income.

   Loads a REALISTIC pre-change fixture with:
     (i)   an accepted + invoiced quote that ALREADY carries versions[] (must survive byte-for-byte, no drop),
     (ii)  a paid quote with payments[] (finance total + paid + balance must be untouched), and
     (iii) a job with legacy job.changeOrders[] linked to a COMMITTED quote — the old display-only mechanism;
           load() must FOLD each CO into the linked quote's versions[] as a source:"legacy-change-order" entry
           WITHOUT adding coTotal to the quote total (coTotal was never billed — adding would double-count).
   through:
     1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough), and
     2) the REAL client js/02-state.js load() (in a vm sandbox), then js/90 loaded on top,
   and asserts ZERO LOSS + finance byte-identical + the versions census never drops + the legacy-CO fold.
   Run: node quote-versioning-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const TODAY = ymd(new Date());

/* pure quote-money helpers — IDENTICAL logic to js/50 quoteTotalAmt/quotePaidAmt/quoteBalAmt + js/40/64 A/R */
function qTotal(q) { return (q.finalPrice || q.total || 0); }
function qPaid(q) { return (q.payments || []).filter(p => p && !p.deleted).reduce((s, p) => s + (+p.amount || 0), 0); }
function qBal(q) { return Math.max(0, qTotal(q) - qPaid(q)); }
/* the full finance fingerprint the money side reads off the quotes of one org slab */
function financeFP(slab) {
  const quotes = (slab.quotes || []).filter(q => q && !q.deleted);
  const fp = { total: 0, ar: 0, arN: 0, bal: 0, income: 0, perQuote: {} };
  quotes.forEach(q => {
    const t = qTotal(q);
    fp.total += t;
    fp.perQuote[q.id] = Math.round(t * 100);
    if (q.invoiced && !q.paid) { fp.ar += t; fp.arN++; }
    if (qTotal(q) > 0 && !q.paid) fp.bal += qBal(q);
    if (q.paid) fp.income += t;   // cash-basis income = paid quotes' effective total (js/40 syncQuoteIncome amount)
  });
  fp.total = Math.round(fp.total * 100); fp.ar = Math.round(fp.ar * 100);
  fp.bal = Math.round(fp.bal * 100); fp.income = Math.round(fp.income * 100);
  return fp;
}
function fpEqual(a, b, label) {
  ok(a.total === b.total, label + ": total¢ byte-identical (" + a.total + " vs " + b.total + ")");
  ok(a.ar === b.ar && a.arN === b.arN, label + ": A/R owed¢ + count byte-identical (" + a.ar + "/" + a.arN + " vs " + b.ar + "/" + b.arN + ")");
  ok(a.bal === b.bal, label + ": outstanding balance¢ byte-identical (" + a.bal + " vs " + b.bal + ")");
  ok(a.income === b.income, label + ": paid-income¢ byte-identical (" + a.income + " vs " + b.income + ")");
  const keys = Object.keys(a.perQuote);
  ok(keys.every(k => a.perQuote[k] === b.perQuote[k]), label + ": EVERY quote's finalPrice||total is byte-identical");
}

/* realistic PRE-CHANGE fixture (server/data.json shape: top-level users/registry + org slabs) */
function freshPre() {
  return {
    users: [
      { id: "u_ray", username: "Ray", role: "owner", updatedAt: 1 },
      { id: "u_chase", username: "Chase", role: "crew", updatedAt: 1 }
    ],
    registry: [],
    obx: {
      customers: [{ id: "c1", name: "Seaside HOA", address: "1 Ocean Blvd, KDH NC", updatedAt: 1 }],
      properties: [{ id: "p1", label: "Lot A", address: "10 Sand Rd, KDH NC", lat: 36.02, lng: -75.67, customerIds: ["c1"], updatedAt: 1 }],
      quotes: [
        // (i) accepted + invoiced quote that ALREADY carries a versions[] history (from a prior change order)
        {
          id: "qVer", customerId: "c1", num: 1, cust: "Seaside HOA",
          items: [{ name: "Paver patio", price: 4200, qty: 1, cost: 1500 }],
          total: 4200, finalPrice: 4500, subtotal: 4200, discount: 0,
          accepted: true, acceptedDate: TODAY, jobId: "jVer", invoiced: true, paid: false,
          versions: [
            { v: 1, ts: 1000, by: "Ray", note: "added a second pad", prevTotal: 4200, newTotal: 4500, delta: 300, prevItems: [{ name: "Paver patio", price: 4200, qty: 1, cost: 1500 }], source: "edit" }
          ],
          updatedAt: 1
        },
        // (ii) a PAID quote with a partial + final payment history — total/paid/balance must stay exact
        {
          id: "qPaid", customerId: "c1", num: 2, cust: "Seaside HOA",
          items: [{ name: "Soft wash", price: 800, qty: 1, cost: 120 }],
          total: 800, finalPrice: 0, subtotal: 800, discount: 0,
          accepted: true, invoiced: true, paid: true,
          payments: [{ id: "pay1", amount: 300, date: TODAY, deleted: false }, { id: "pay2", amount: 500, date: TODAY, deleted: false }],
          updatedAt: 1
        },
        // (iii) a COMMITTED quote (accepted) linked to a job that has legacy job.changeOrders[] (folded below)
        {
          id: "qLeg", customerId: "c1", num: 3, cust: "Seaside HOA",
          items: [{ name: "Junk removal", price: 600, qty: 1, cost: 90 }],
          total: 600, finalPrice: 0, subtotal: 600, discount: 0,
          accepted: true, acceptedDate: TODAY, jobId: "jLeg", invoiced: false, paid: false,
          updatedAt: 1
        }
      ],
      docs: [{ id: "homeBase", address: "Base St, KDH NC", lat: 36.00, lng: -75.70, updatedAt: 1 }],
      jobs: [
        { id: "jVer", title: "Paver patio", customerId: "c1", quoteId: "qVer", date: TODAY, crew: ["u_ray"], expenses: [], materials: [], updatedAt: 1 },
        // (iii) legacy change orders on the job — display-only in the old world; fold into qLeg.versions[]
        {
          id: "jLeg", title: "Junk removal", customerId: "c1", quoteId: "qLeg", date: TODAY, crew: ["u_chase"],
          changeOrders: [
            { id: "co1", desc: "Extra mattress haul", amount: 75, ts: 2000, by: "Chase" },
            { id: "co2", desc: "Second trip", amount: 120, ts: 3000, by: "Chase" }
          ],
          expenses: [], materials: [], updatedAt: 1
        }
      ],
      income: [], expenses: [], inventory: [], locks: [], timeclock: [], messages: [], resale: [],
      pendingChanges: [], knowledge: [], disbursements: [], places: [], changelog: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}

function census(store) {
  const c = {};
  ["customers", "properties", "quotes", "jobs", "docs", "income", "expenses"].forEach(col => { const a = (store.obx && store.obx[col]) || []; c["obx." + col] = a.filter(r => r && !r.deleted).length; });
  c._accounts = (store.users || []).filter(u => u && !u.kind && !u.deleted).length;
  return c;
}
function versionCensus(slab) { const c = {}; (slab.quotes || []).filter(q => q && !q.deleted).forEach(q => { c[q.id] = (Array.isArray(q.versions) ? q.versions.length : 0); }); return c; }

/* ============ 1) SERVER — migrateStore + a no-op round-trip drops nothing; finance + versions preserved ============ */
const pre = freshPre();
const before = census(pre);
const preFP = financeFP(pre.obx);
const preVC = versionCensus(pre.obx);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "server round-trip: no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));
fpEqual(preFP, financeFP(round.obx), "server round-trip");
const rVer = round.obx.quotes.find(q => q.id === "qVer");
ok(!!rVer && Array.isArray(rVer.versions) && rVer.versions.length === 1, "server: pre-existing versions[] survives the round-trip (count preserved)");
ok(!!rVer && rVer.versions[0].delta === 300 && rVer.versions[0].source === "edit", "server: version fields (delta/source/prevItems) survive byte-for-byte");
const rVC = versionCensus(round.obx);
Object.keys(preVC).forEach(id => ok((rVC[id] || 0) >= preVC[id], "server: versions census never drops for " + id + " (" + preVC[id] + " → " + (rVC[id] || 0) + ")"));
const rLegJob = round.obx.jobs.find(j => j.id === "jLeg");
ok(!!rLegJob && Array.isArray(rLegJob.changeOrders) && rLegJob.changeOrders.length === 2, "server: legacy job.changeOrders[] left intact (audit trail, zero-loss)");

/* ============ 2) CLIENT — the REAL js/02 load(), then js/90 on top ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {} };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext(fs.readFileSync("js/90-quote-versions.js", "utf8"), ctx, { filename: "js/90-quote-versions.js" });
vm.runInContext("load();", ctx);

const S_after = vm.runInContext("S", ctx);
const cB = census(pre), cA = census(S_after);
Object.keys(cB).forEach(k => ok(cA[k] >= cB[k], "client load(): no loss in " + k + " (before=" + cB[k] + " after=" + cA[k] + ")"));
fpEqual(preFP, financeFP(S_after.obx), "client load()");

/* ---- versions census never drops on the client ---- */
const cVC = versionCensus(S_after.obx);
Object.keys(preVC).forEach(id => ok((cVC[id] || 0) >= preVC[id], "client: versions census never drops for " + id + " (" + preVC[id] + " → " + (cVC[id] || 0) + ")"));
const cVer = S_after.obx.quotes.find(q => q.id === "qVer");
ok(!!cVer && cVer.versions.length === 1 && cVer.versions[0].delta === 300, "client: pre-existing versions[] preserved exactly (no re-fold, no drop)");

/* ---- the legacy-CO FOLD: both changeOrders became source:"legacy-change-order" version entries ---- */
const cLeg = S_after.obx.quotes.find(q => q.id === "qLeg");
ok(!!cLeg && Array.isArray(cLeg.versions), "client: linked quote qLeg has a versions[] array");
const legEntries = (cLeg.versions || []).filter(v => v && v.source === "legacy-change-order");
ok(legEntries.length === 2, "client: BOTH legacy changeOrders folded as source:\"legacy-change-order\" entries (" + legEntries.length + "/2)");
ok(legEntries.some(v => v.note === "Extra mattress haul" && v.delta === 75), "client: fold carries the CO desc→note + amount→delta (Extra mattress haul / $75)");
ok(legEntries.some(v => v.note === "Second trip" && v.delta === 120), "client: fold carries the second CO (Second trip / $120)");
ok(legEntries.every(v => v.prevTotal === v.newTotal), "client: folded entries DO NOT move the quote total (prevTotal===newTotal — coTotal was never billed)");
ok(qTotal(cLeg) === 600, "client: qLeg's billed total stays $600 — the $195 of legacy COs is history-only, NOT added (no double-count)");
const cLegJob = S_after.obx.jobs.find(j => j.id === "jLeg");
ok(!!cLegJob && Array.isArray(cLegJob.changeOrders) && cLegJob.changeOrders.length === 2, "client: original job.changeOrders[] left in place (audit trail, zero-loss)");

/* ---- idempotent: a SECOND load() must not double-fold (legacyId dedupe) ---- */
vm.runInContext("load();", ctx);
const S2 = vm.runInContext("S", ctx);
const cLeg2 = S2.obx.quotes.find(q => q.id === "qLeg");
ok((cLeg2.versions || []).filter(v => v && v.source === "legacy-change-order").length === 2, "client: a second load() does NOT re-fold — legacy entries stay at 2 (idempotent)");
fpEqual(preFP, financeFP(S2.obx), "client second load()");

/* ---- snapshotQuoteVersion unit checks (the engine js/90 exports) ---- */
const snap = vm.runInContext("snapshotQuoteVersion", ctx);
const isCommitted = vm.runInContext("quoteIsCommitted", ctx);
ok(typeof snap === "function", "js/90 exposes snapshotQuoteVersion()");
// a DRAFT (not committed) never records a version, even with a real change
const draft = { id: "d1", total: 100, items: [{ name: "x", price: 100, qty: 1 }] };
ok(isCommitted(draft) === false && snap(draft, "n", "edit", 100, [{ name: "x", price: 100, qty: 1 }]) === null && !draft.versions, "draft quote: snapshot is a no-op (drafts overwrite silently, no versions[])");
// a committed quote with NO effective change → no-op
const c1 = { id: "cc1", accepted: true, total: 500, items: [{ name: "y", price: 500, qty: 1 }] };
ok(snap(c1, "", "edit", 500, [{ name: "y", price: 500, qty: 1 }]) === null, "committed quote, nothing changed: snapshot is a no-op (only total OR items trigger a version)");
// a committed quote whose total changed → one version with the right delta
const c2 = { id: "cc2", accepted: true, total: 500, finalPrice: 650, items: [{ name: "y", price: 650, qty: 1 }] };
const v2 = snap(c2, "added a door", "final-price", 500, [{ name: "y", price: 500, qty: 1 }]);
ok(!!v2 && v2.delta === 150 && v2.prevTotal === 500 && v2.newTotal === 650 && v2.source === "final-price" && v2.note === "added a door", "committed quote, total 500→650: records ONE version delta +$150, source final-price");
ok(Array.isArray(c2.versions) && c2.versions.length === 1, "  …and it was appended to q.versions[] (length 1)");
ok(c2.finalPrice === 650 && c2.total === 500, "  …WITHOUT touching q.finalPrice/q.total (snapshot never writes finance fields)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — q.versions[] survives migrateStore + a sync round-trip + client load(); every quote's finalPrice||total / A/R / balance / income is byte-identical; versions census never drops; legacy changeOrders fold to history-only source:\"legacy-change-order\" entries (idempotent) WITHOUT moving the billed total.");
process.exit(fail ? 1 : 0);
