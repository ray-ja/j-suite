/* job-location-multistop-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the job-page
   location-edit + on-job-page ordered multi-stop feature. All THREE touched fields are ADDITIVE on the
   already-synced `jobs` collection — no new collection, no schema change:
     - j.address       (pre-existing; jobAddr's free-text fallback — now editable on the job page)
     - j.plannedStops[] (pre-existing ordered {id,label,address,lat,lng} — now editable on the job page too)
     - j.estRouteMiles  (NEW; informational offline mileage estimate — never the billed number)
   Loads a REALISTIC pre-change fixture (jobs with/without address, with pre-existing plannedStops, with a
   real materials/expenses history) through:
     1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough), and
     2) the REAL client js/02-state.js load() (in a vm sandbox), then js/62 + js/61 loaded on top,
   and asserts ZERO LOSS + that every additive field survives byte-for-byte, plus unit-checks the two pure
   helpers the feature adds/relies on: jobAddr() (j.address fallback) and jobRecalcRouteMiles() (haversine
   ×1.3 round-trip estimate, informational).
   Run: node job-location-multistop-migration-test.js   (exit 0 = green) */
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
        // (a) a normal job with a linked property (has a location the normal way)
        { id: "jN", title: "Lot mow", customerId: "c1", propertyId: "p1", date: TODAY, crew: ["u_chase"], expenses: [], materials: [], updatedAt: 1 },
        // (b) the airport-pickup shape: NO customer address / NO property — a free-text j.address + ORDERED
        //     plannedStops + a pre-existing estRouteMiles. Every one of these additive fields must survive.
        {
          id: "jAir", title: "Chaz & Vlad fly in", date: TODAY, crew: ["u_ray"],
          address: "Norfolk Airport (ORF)",
          plannedStops: [
            { id: "s1", label: "Office", address: "Base St, KDH NC", lat: 36.00, lng: -75.70 },
            { id: "s2", label: "Airport pickup", address: "Norfolk Airport (ORF)", lat: 36.90, lng: -76.20 },
            { id: "s3", label: "Company dinner", address: "Restaurant, VA Beach", lat: 36.85, lng: -75.98 }
          ],
          estRouteMiles: 142.7,
          // NEW additive endpoints: this job starts at Chase's house + ends at the shop, NOT the base — both
          // must survive load()+round-trip. null/absent on every other job = "use the home base" (default).
          routeStart: { address: "Chase's house, KDH NC", lat: 36.05, lng: -75.68 },
          routeEnd: { address: "Shop, KDH NC", lat: 36.01, lng: -75.71 },
          expenses: [], materials: [], updatedAt: 1
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

/* ============ 1) SERVER — migrateStore + a no-op round-trip drops nothing and preserves every field ============ */
const pre = freshPre();
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "server round-trip: no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));
const sAir = round.obx.jobs.find(j => j.id === "jAir");
ok(!!sAir && sAir.address === "Norfolk Airport (ORF)", "server: j.address survives the round-trip byte-for-byte");
ok(!!sAir && Array.isArray(sAir.plannedStops) && sAir.plannedStops.length === 3, "server: j.plannedStops[] (3 ordered stops) survives");
ok(!!sAir && sAir.plannedStops[0].label === "Office" && sAir.plannedStops[2].label === "Company dinner", "server: plannedStops ORDER + labels + coords preserved");
ok(!!sAir && sAir.estRouteMiles === 142.7, "server: j.estRouteMiles (new additive field) survives");
ok(!!sAir && sAir.routeStart && sAir.routeStart.address === "Chase's house, KDH NC" && sAir.routeStart.lat === 36.05, "server: j.routeStart {address,lat,lng} survives the round-trip");
ok(!!sAir && sAir.routeEnd && sAir.routeEnd.address === "Shop, KDH NC" && sAir.routeEnd.lng === -75.71, "server: j.routeEnd {address,lat,lng} survives the round-trip");
const sN0 = round.obx.jobs.find(j => j.id === "jN");
ok(!!sN0 && sN0.routeStart === undefined && sN0.routeEnd === undefined, "server: a legacy job has NO routeStart/routeEnd backfilled (stays absent = use base)");
const sH = round.obx.jobs.find(j => j.id === "jH");
ok(!!sH && sH.expenses.filter(e => !e.deleted).length === 1 && sH.materials.length === 1, "server: unrelated job's materials/expenses history untouched");

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
const cAir = S_after.obx.jobs.find(j => j.id === "jAir");
ok(!!cAir && cAir.address === "Norfolk Airport (ORF)", "client load(): j.address preserved (load() never strips it)");
ok(!!cAir && Array.isArray(cAir.plannedStops) && cAir.plannedStops.length === 3, "client load(): plannedStops[] preserved");
ok(!!cAir && cAir.estRouteMiles === 142.7, "client load(): estRouteMiles preserved");
ok(!!cAir && cAir.routeStart && cAir.routeStart.address === "Chase's house, KDH NC", "client load(): j.routeStart preserved (load() never strips it)");
ok(!!cAir && cAir.routeEnd && cAir.routeEnd.address === "Shop, KDH NC", "client load(): j.routeEnd preserved");
const _cN0 = S_after.obx.jobs.find(j => j.id === "jN");
ok(_cN0 && _cN0.routeStart === undefined && _cN0.routeEnd === undefined, "client load(): a legacy job stays routeStart/routeEnd-absent (default = home base at both ends)");

/* ---- unit: jobAddr() free-text fallback (the airport-pickup case) ---- */
const jobAddr = vm.runInContext("jobAddr", ctx);
ok(jobAddr(cAir) === "Norfolk Airport (ORF)", "jobAddr(job with no customer/property) returns j.address — the airport-pickup location shows");
const cN = S_after.obx.jobs.find(j => j.id === "jN");
ok(jobAddr(cN) === "10 Sand Rd, KDH NC", "jobAddr(job with a property) still prefers the property address (unchanged)");
const emptyJob = { id: "jX", title: "no loc" };
ok(jobAddr(emptyJob) === "", "jobAddr(job with nothing) is empty — then setting j.address makes it show:");
emptyJob.address = "123 Test Ave";
ok(jobAddr(emptyJob) === "123 Test Ave", "  …after j.address is set, jobAddr returns it");

/* ---- unit: jobRecalcRouteMiles() — REAL road miles via OSRM → MANUAL fallback → existing, NEVER a 1.3× guess ---- */
const jobRecalc = vm.runInContext("jobRecalcRouteMiles", ctx);
const jobSrc = vm.runInContext("jobRouteMilesSource", ctx);
/* (A) OFFLINE (this sandbox has no `fetch` → the map can't route). The OLD build returned a haversine ×1.3 GUESS
   here; that guess is GONE. Geocoded stops but no manual miles → the estimate is null + prompts for manual. */
const routeJob = { id: "jR", plannedStops: [ { id: "a", label: "Office", address: "x", lat: 36.00, lng: -75.70 }, { id: "b", label: "Airport", address: "y", lat: 36.90, lng: -76.20 } ], propertyId: null };
jobRecalc(routeJob);
ok(routeJob.estRouteMiles === null, "OFFLINE + no manual: estimate is null — the map couldn't route + NO 1.3× guess (got " + routeJob.estRouteMiles + ")");
ok(jobSrc(routeJob) === "none", "OFFLINE source = 'none' (map tried + failed) → the UI prompts for manual miles");
routeJob.manualRouteMiles = 90; jobRecalc(routeJob);
ok(routeJob.estRouteMiles === 90, "MANUAL fallback: with the map down, j.manualRouteMiles (round-trip) becomes the estimate (" + routeJob.estRouteMiles + " mi)");
ok(jobSrc(routeJob) === "manual", "source = 'manual' when the manual round-trip is in use");
const noGeo = { id: "jNoGeo", plannedStops: [{ id: "c", label: "Somewhere", address: "z", lat: null, lng: null }], propertyId: null };
jobRecalc(noGeo);
ok(noGeo.estRouteMiles === null, "nothing geocoded → null (no bogus 0-mile estimate)");
/* (B) SAVED-PLACE manualMiles override — preserved WITHOUT any map call: base→place→base = 2×12mi = 24mi. */
const placesArr = vm.runInContext("D().places", ctx); placesArr.push({ id: "pl1", name: "Quarry", manualMiles: 12, updatedAt: 1 });
const placeJob = { id: "jPlace", plannedStops: [{ id: "d", label: "Quarry", address: "q", lat: 36.20, lng: -75.80, placeId: "pl1" }], propertyId: null };
jobRecalc(placeJob);
ok(placeJob.estRouteMiles === 24, "PLACE-MANUAL override preserved (offline): base→place→base = 2×12mi = 24mi (no map, no 1.3×)");
/* (C) NO-CLOBBER — the map down + no manual leaves a previously-good estimate untouched (never null-clobbered). */
const priorJob = { id: "jPrior", estRouteMiles: 55.5, plannedStops: [{ id: "e", label: "S", address: "s", lat: 36.5, lng: -75.9 }], propertyId: null };
jobRecalc(priorJob);
ok(priorJob.estRouteMiles === 55.5, "NO-CLOBBER: map down + no manual leaves a previously-good estimate untouched (never null-clobbered, never 1.3×)");

/* (D) STUBBED OSRM — inject a deterministic fake router so the ROAD path can be exercised. Fake distance = the
   sum of the leg great-circle miles (a road factor is irrelevant here — the APP never computes one; this is the
   TEST simulating the OSRM server, which returns metres in routes[0].distance). */
function havMi(a1, o1, a2, o2) { const R = 3958.8, toR = x => x * Math.PI / 180, dLat = toR(a2 - a1), dLng = toR(o2 - o1); const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a1)) * Math.cos(toR(a2)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
sandbox.fetch = function (url) {
  const m = String(url).match(/driving\/([^?]+)/); const pts = m[1].split(";").map(s => s.split(",").map(Number)); // [lng,lat]
  let mi = 0; for (let i = 1; i < pts.length; i++) mi += havMi(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
  return Promise.resolve({ json: () => Promise.resolve({ code: "Ok", routes: [{ distance: mi * 1609.34 }] }) });
};
const flush = () => new Promise(r => setTimeout(r, 0));
async function settle(j) { jobRecalc(j); for (let k = 0; k < 6; k++) await flush(); jobRecalc(j); }
(async function () {
  // via roads — FRESH coords (not the offline "none"-cached keys)
  const roadsJob = { id: "jRoads", plannedStops: [ { id: "ra", label: "Office", address: "x", lat: 35.95, lng: -75.62 }, { id: "rb", label: "Airport", address: "y", lat: 36.88, lng: -76.15 } ], propertyId: null };
  await settle(roadsJob);
  ok(typeof roadsJob.estRouteMiles === "number" && roadsJob.estRouteMiles > 0, "VIA ROADS: with the map reachable, jobRecalc uses OSRM road miles (" + roadsJob.estRouteMiles + " mi)");
  ok(jobSrc(roadsJob) === "roads", "source = 'roads' when OSRM answered");
  const baseEst = roadsJob.estRouteMiles;
  jobRecalc(roadsJob);   // 2nd recompute is SYNC from ROAD_CACHE — no re-fetch
  ok(roadsJob.estRouteMiles === baseEst, "cached: a 2nd recompute is synchronous from ROAD_CACHE — same value, no re-hit");
  roadsJob.manualRouteMiles = 3; jobRecalc(roadsJob);
  ok(roadsJob.estRouteMiles === baseEst && roadsJob.estRouteMiles > 3, "OSRM WINS over manual: road miles override the manual fallback when the map can route");
  // default (null endpoints) vs a far custom start → the road route is longer; reset → the exact default
  const dJob = { id: "jD", plannedStops: [{ id: "da", label: "S", address: "x", lat: 35.90, lng: -75.55 }], propertyId: null };
  await settle(dJob); const dDefault = dJob.estRouteMiles;
  dJob.routeStart = { address: "Far", lat: 34.50, lng: -78.40 }; await settle(dJob);
  ok(dJob.estRouteMiles > dDefault, "CUSTOM START farther out → the road route is LONGER than the base default (" + dJob.estRouteMiles + " > " + dDefault + ")");
  dJob.routeStart = null; await settle(dJob);
  ok(dJob.estRouteMiles === dDefault, "RESET to base → the exact base road estimate again (lossless)");
  // mixed: a saved-place manual leg (12mi) + OSRM road legs coexist
  const mixJob = { id: "jMix", plannedStops: [ { id: "mp", label: "Quarry", address: "q", lat: 36.20, lng: -75.80, placeId: "pl1" }, { id: "ms", label: "Site", address: "s", lat: 36.30, lng: -75.60 } ], propertyId: null };
  await settle(mixJob);
  ok(typeof mixJob.estRouteMiles === "number" && mixJob.estRouteMiles > 12, "MIXED route: a place-manual base↔place leg (12mi) + OSRM road legs sum together (" + mixJob.estRouteMiles + " mi)");

  console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — additive fields survive migrate + round-trip + load(); jobRecalcRouteMiles now uses OSRM road miles → manual → existing (NEVER a 1.3× guess); place-manual overrides + no-clobber preserved.");
  process.exit(fail ? 1 : 0);
})();
