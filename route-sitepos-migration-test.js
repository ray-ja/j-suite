/* route-sitepos-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the MOVABLE JOB SITE feature.
   The feature adds ONE additive field on the already-synced `jobs` collection — no new collection, no schema
   change: j.sitePos (integer 0..plannedStops.length = the job site sits immediately BEFORE plannedStops[k];
   null/absent = the job site is LAST = today's behavior, byte-identical, NO backfill). Legacy jobs are NEVER
   stamped with sitePos.
   Loads a REALISTIC pre-change fixture through:
     1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough), and
     2) the REAL client js/02-state.js load() (in a vm sandbox), then js/62 + js/61 loaded on top,
   and asserts ZERO LOSS + that:
     - a legacy job with NO sitePos stays sitePos-absent after load()+round-trip AND jobRouteOrdered() puts the
       job site LAST (byte-identical to today);
     - a job with sitePos:0 survives + jobRouteOrdered() orders the site FIRST;
     - the reorder/delete index math (jobPageRouteMove / jobPageStopDel) is correct across all swap cases;
     - clamp-on-read self-heals an out-of-range sitePos.
   Run: node route-sitepos-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const TODAY = ymd(new Date());

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
      quotes: [{ id: "q1", customerId: "c1", total: 1000, finalPrice: 1000, num: 1, updatedAt: 1 }],
      docs: [{ id: "homeBase", address: "Base St, KDH NC", lat: 36.00, lng: -75.70, resolved: "", updatedAt: 1 }],
      jobs: [
        // (a) LEGACY job with a route BUT no sitePos — today's shape. Must stay sitePos-absent; site orders LAST.
        {
          id: "jLegacy", title: "Limb haul", customerId: "c1", propertyId: "p1", date: TODAY, crew: ["u_chase"],
          plannedStops: [
            { id: "s1", label: "Stoneworks", address: "5 Quarry Rd", lat: 36.10, lng: -75.75 },
            { id: "s2", label: "Transfer station", address: "9 Dump Rd", lat: 36.12, lng: -75.80 }
          ],
          estRouteMiles: 30.5, expenses: [], materials: [], updatedAt: 1
        },
        // (b) a job that WAS reordered with the new feature — sitePos:0 (job site FIRST). Must survive + order site-first.
        {
          id: "jSiteFirst", title: "Site-first run", customerId: "c1", propertyId: "p1", date: TODAY, crew: ["u_ray"],
          plannedStops: [{ id: "s3", label: "Transfer station", address: "9 Dump Rd", lat: 36.12, lng: -75.80 }],
          sitePos: 0, expenses: [], materials: [], updatedAt: 1
        },
        // (c) a job with real materials/expenses history (billing must stay untouched)
        { id: "jH", title: "Paver patio", customerId: "c1", date: TODAY, crew: ["u_ray"], expenses: [{ id: "e3", amount: 200, deleted: false }], materials: [{ id: "m2", amount: 800, deleted: false }], updatedAt: 1 }
      ],
      income: [], expenses: [], inventory: [], locks: [], timeclock: [], messages: [], resale: [],
      pendingChanges: [], knowledge: [], disbursements: [], places: [], changelog: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}

function census(store) {
  const c = {};
  ["customers", "properties", "quotes", "jobs", "docs", "income", "expenses", "inventory"].forEach(col => { const a = (store.obx && store.obx[col]) || []; c["obx." + col] = a.filter(r => r && !r.deleted).length; });
  c._accounts = (store.users || []).filter(u => u && !u.kind && !u.deleted).length;
  return c;
}

/* ============ 1) SERVER — migrateStore + a no-op round-trip drops nothing and preserves sitePos exactly ============ */
const pre = freshPre();
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "server round-trip: no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));
const sLegacy = round.obx.jobs.find(j => j.id === "jLegacy");
ok(!!sLegacy && sLegacy.sitePos === undefined, "server: a LEGACY job stays sitePos-ABSENT (never backfilled = site last = byte-identical)");
ok(!!sLegacy && Array.isArray(sLegacy.plannedStops) && sLegacy.plannedStops.length === 2, "server: legacy plannedStops[] (2 ordered stops) survives");
const sFirst = round.obx.jobs.find(j => j.id === "jSiteFirst");
ok(!!sFirst && sFirst.sitePos === 0, "server: j.sitePos=0 (site-first) survives the round-trip byte-for-byte");
const sH = round.obx.jobs.find(j => j.id === "jH");
ok(!!sH && (round.obx.jobExpenses || []).filter(e => e.jobId === "jH" && !e.deleted).length === 1 && (round.obx.jobMaterials || []).filter(m => m.jobId === "jH").length === 1, "server: unrelated job's materials/expenses history untouched");

/* ============ 2) CLIENT — the REAL js/02 load(), then js/62 + js/61 on top ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, setTimeout, clearTimeout };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext(fs.readFileSync("js/62-homebase.js", "utf8"), ctx, { filename: "js/62-homebase.js" });
vm.runInContext(fs.readFileSync("js/61-job-page.js", "utf8"), ctx, { filename: "js/61-job-page.js" });
vm.runInContext("load();", ctx);

const S_after = vm.runInContext("S", ctx);
const cB = census(pre), cA = census(S_after);
Object.keys(cB).forEach(k => ok(cA[k] >= cB[k], "client load(): no loss in " + k + " (before=" + cB[k] + " after=" + cA[k] + ")"));
const cLegacy = S_after.obx.jobs.find(j => j.id === "jLegacy");
ok(!!cLegacy && cLegacy.sitePos === undefined, "client load(): a LEGACY job stays sitePos-absent (default = site last)");
ok(!!cLegacy && Array.isArray(cLegacy.plannedStops) && cLegacy.plannedStops.length === 2, "client load(): legacy plannedStops[] preserved");
const cFirst = S_after.obx.jobs.find(j => j.id === "jSiteFirst");
ok(!!cFirst && cFirst.sitePos === 0, "client load(): j.sitePos=0 preserved (load() never strips it)");

/* ---- unit: jobRouteOrdered() — the ONE shared ordered list ---- */
const jobRouteOrdered = vm.runInContext("jobRouteOrdered", ctx);
// LEGACY (no sitePos) → site LAST (byte-identical to today's "stops then site appended")
const ordL = jobRouteOrdered(cLegacy);
ok(ordL.length === 3 && ordL[0].kind === "stop" && ordL[1].kind === "stop" && ordL[2].kind === "site", "jobRouteOrdered(legacy, no sitePos): [stop, stop, SITE] — site LAST, byte-identical to today");
ok(ordL[0].raw === 0 && ordL[1].raw === 1, "jobRouteOrdered: stop tokens carry their RAW plannedStops index (0,1)");
// sitePos:0 → site FIRST
const ordF = jobRouteOrdered(cFirst);
ok(ordF.length === 2 && ordF[0].kind === "site" && ordF[1].kind === "stop", "jobRouteOrdered(sitePos:0): [SITE, stop] — site FIRST");
// sitePos:1 in the middle of 2 stops → [stop, site, stop]
const ordMid = jobRouteOrdered({ plannedStops: [{ id: "a", address: "a" }, { id: "b", address: "b" }], sitePos: 1 });
ok(ordMid.length === 3 && ordMid[0].kind === "stop" && ordMid[1].kind === "site" && ordMid[2].kind === "stop", "jobRouteOrdered(sitePos:1): [stop, SITE, stop] — site in the middle");
// clamp-on-read: an out-of-range sitePos self-heals to the end
const ordClamp = jobRouteOrdered({ plannedStops: [{ id: "a", address: "a" }], sitePos: 9 });
ok(ordClamp.length === 2 && ordClamp[1].kind === "site", "jobRouteOrdered(sitePos:9, 1 stop): clamps to site LAST (self-heals a stale modal edit)");
// no stops at all → just the site
const ordNone = jobRouteOrdered({ plannedStops: [] });
ok(ordNone.length === 1 && ordNone[0].kind === "site", "jobRouteOrdered(no stops): [SITE] — the site is always present");

/* ---- functional: the REAL window handlers (jobPageRouteMove / jobPageStopDel) with stubbed globals ---- */
vm.runInContext("function isOwner(){return true} function canDo(){return true} function actJ(){return S.obx.jobs} function touch(){} function save(){} function render(){} function alert(){}", ctx);
// seed a job with ONE coord'd stop + NO sitePos (= site last), then walk it through the reorder cases
S_after.obx.jobs.push({ id: "jF", title: "Reorder me", plannedStops: [{ id: "sA", label: "Supplier", address: "a", lat: 36.0, lng: -75.7 }], expenses: [], materials: [], updatedAt: 1 });
const jF = () => S_after.obx.jobs.find(j => j.id === "jF");
const routeMove = vm.runInContext("window.jobPageRouteMove", ctx);
const stopDel = vm.runInContext("window.jobPageStopDel", ctx);
// start: [stop, site] (sitePos absent)
ok(jobRouteOrdered(jF())[0].kind === "stop" && jobRouteOrdered(jF())[1].kind === "site", "functional start: jobRouteOrdered = [stop, site], sitePos absent");
// move the SITE up (comboIndex 1 → 0): site becomes first → sitePos=0
routeMove("jF", 1, -1);
ok(jF().sitePos === 0, "SWAP (site↔stop, site moves up): sitePos = 0 (site first)");
ok(jobRouteOrdered(jF())[0].kind === "site" && jobRouteOrdered(jF())[1].kind === "stop", "  …order is now [site, stop]");
ok(jF().plannedStops.length === 1 && jF().plannedStops[0].id === "sA", "  …plannedStops still holds the one stop (never polluted with the site)");
// move the SITE back down (comboIndex 0 → 1): site lands at the very end → STICKY-LAST stores null
routeMove("jF", 0, 1);
ok(jF().sitePos === null, "SWAP (site↔stop, site moves to the very end): STICKY-LAST → sitePos = null (not ps.length)");
ok(jobRouteOrdered(jF())[1].kind === "site", "  …order is back to [stop, site]");
// stop↔stop swap: two stops, site last; swapping the two stops keeps sitePos null
S_after.obx.jobs.push({ id: "jSS", title: "two stops", plannedStops: [{ id: "x", address: "x", lat: 36, lng: -75 }, { id: "y", address: "y", lat: 36, lng: -75 }], expenses: [], materials: [], updatedAt: 1 });
routeMove("jSS", 0, 1);   // swap stop0 <-> stop1 (both before the last site row)
const jSS = S_after.obx.jobs.find(j => j.id === "jSS");
ok(jSS.plannedStops[0].id === "y" && jSS.plannedStops[1].id === "x" && jSS.sitePos === null, "SWAP (stop↔stop): plannedStops reorder to [y,x], sitePos stays null (site still last)");
// delete a stop BEFORE the site → sitePos decrements
S_after.obx.jobs.push({ id: "jDel", title: "del", plannedStops: [{ id: "A", address: "a" }, { id: "B", address: "b" }, { id: "C", address: "c" }], sitePos: 2, expenses: [], materials: [], updatedAt: 1 });
stopDel("jDel", 0);   // remove stop A (raw index 0), which sits BEFORE the site (sitePos 2)
const jDel = S_after.obx.jobs.find(j => j.id === "jDel");
ok(jDel.plannedStops.length === 2 && jDel.sitePos === 1, "DELETE a stop before the site: plannedStops→2 and sitePos decrements 2→1 (site stays anchored)");
ok(jobRouteOrdered(jDel)[0].stop.id === "B" && jobRouteOrdered(jDel)[1].kind === "site" && jobRouteOrdered(jDel)[2].stop.id === "C", "  …order is [B, site, C] (unchanged relative to what remains)");
// delete the stop AFTER the site → sitePos unchanged, but clamp keeps it valid
S_after.obx.jobs.push({ id: "jDel2", title: "del2", plannedStops: [{ id: "A", address: "a" }, { id: "B", address: "b" }], sitePos: 1, expenses: [], materials: [], updatedAt: 1 });
stopDel("jDel2", 1);   // remove stop B (after the site at sitePos 1) → site now last → sticky-last null
const jDel2 = S_after.obx.jobs.find(j => j.id === "jDel2");
ok(jDel2.plannedStops.length === 1 && jDel2.sitePos === null, "DELETE the last stop (after the site): site becomes last → sitePos clamps to null (sticky-last)");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — j.sitePos is additive (legacy stays absent = site last = byte-identical); survives migrate + round-trip + load(); jobRouteOrdered orders correctly (last/first/middle/clamp); reorder + delete index math holds across every swap case.");
process.exit(fail ? 1 : 0);
