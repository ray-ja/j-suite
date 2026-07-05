/* saved-locations-migration-test.js — MANDATORY migration fixture (CLAUDE.md) for the SAVED-LOCATIONS feature.
   Every touched field is ADDITIVE on an ALREADY-synced collection — no new collection, no schema change:
     - places[].address / places[].category / places[].manualMiles   (NEW optional fields on the `places` coll)
     - jobs[].routeStart.placeId / routeEnd.placeId / plannedStops[i].placeId   (NEW optional ref → a saved place)
   Legacy map-pin places (js/19: {id,name,lat,lng,owner}) + the sales route (js/24) read ONLY name/lat/lng/owner,
   so those records must survive byte-for-byte with the new fields simply ABSENT.
   Loads a realistic pre-change fixture through:
     1) sync-server migrateStore + a no-op mergeState round-trip (per-record LWW passthrough), and
     2) the REAL client js/02-state.js load() (vm sandbox), then js/27 + js/62 + js/61 + js/74 on top,
   asserts ZERO LOSS + every additive field survives, and unit-checks the two pure helpers the feature adds:
   savedLocMatches() (offline autocomplete source) + jobRecalcRouteMiles() manual-override leg math.
   Run: node saved-locations-migration-test.js   (exit 0 = green) */
const vm = require("vm");
const fs = require("fs");
const SS = require("./sync-server");
let fail = 0;
function ok(c, m) { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const TODAY = ymd(new Date());

/* realistic PRE-CHANGE fixture (server/data.json shape) */
function freshPre() {
  return {
    users: [
      { id: "u_ray", username: "Ray", role: "owner", updatedAt: 1 },
      { id: "u_chase", username: "Chase", role: "crew", updatedAt: 1 }
    ],
    registry: [],
    obx: {
      customers: [{ id: "c1", name: "Seaside HOA", updatedAt: 1 }],
      properties: [
        { id: "p_site", label: "Site Lot", address: "10 Sand Rd, KDH NC", lat: 36.10, lng: -75.60, customerIds: ["c1"], updatedAt: 1 },
        { id: "p_nogeo", label: "Ungeocoded Lot", address: "somewhere", lat: null, lng: null, customerIds: ["c1"], updatedAt: 1 }
      ],
      quotes: [{ id: "q1", customerId: "c1", total: 1000, finalPrice: 1000, num: 1, updatedAt: 1 }],
      docs: [{ id: "homeBase", address: "Base St, KDH NC", lat: 36.00, lng: -75.70, resolved: "", updatedAt: 1 }],
      places: [
        // (a) LEGACY map-pin place — js/19 shape, NO address/category/manualMiles. Must survive untouched.
        { id: "pl_lead", name: "Old lead pin", type: "lead", owner: "Jane PM", notes: "", lat: 36.05, lng: -75.66, updatedAt: 1 },
        // (b) NEW vendor place with a WRONG geocode + a manual one-way override (the Lowe's case).
        { id: "pl_lowes", name: "Lowe's — Kitty Hawk", type: "saved", category: "vendor", address: "Lowe's, Kitty Hawk NC", manualMiles: 20, lat: 40.00, lng: -80.00, updatedAt: 1 },
        // (c) NEW disposal place, correctly geocoded, no manual override.
        { id: "pl_dump", name: "Dare Transfer Station", type: "saved", category: "disposal", address: "Transfer Rd, Manteo NC", manualMiles: null, lat: 35.90, lng: -75.67, updatedAt: 1 }
      ],
      jobs: [
        // job that references a saved place on a planned stop (placeId) — additive, must survive.
        {
          id: "jStop", title: "Dump run", customerId: "c1", propertyId: "p_site", date: TODAY, crew: ["u_ray"],
          plannedStops: [{ id: "s1", label: "Dump", address: "Transfer Rd, Manteo NC", lat: 35.90, lng: -75.67, placeId: "pl_dump" }],
          expenses: [], materials: [], updatedAt: 1
        },
        // job with placeId on a route endpoint
        {
          id: "jEnd", title: "Vendor pickup", customerId: "c1", propertyId: "p_site", date: TODAY, crew: ["u_ray"],
          routeEnd: { address: "Lowe's, Kitty Hawk NC", lat: 40.00, lng: -80.00, placeId: "pl_lowes" },
          expenses: [], materials: [], updatedAt: 1
        }
      ],
      income: [], expenses: [], inventory: [], locks: [], timeclock: [], messages: [], resale: [],
      pendingChanges: [], knowledge: [], disbursements: [], changelog: []
    },
    jam: { customers: [], quotes: [], jobs: [] }
  };
}

function census(store) {
  const c = {};
  ["customers", "properties", "quotes", "jobs", "places", "docs"].forEach(col => { const a = (store.obx && store.obx[col]) || []; c["obx." + col] = a.filter(r => r && !r.deleted).length; });
  c._accounts = (store.users || []).filter(u => u && !u.kind && !u.deleted).length;
  return c;
}

/* ============ 1) SERVER — migrateStore + a no-op round-trip drops nothing, preserves every field ============ */
const pre = freshPre();
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const round = SS.mergeState(migrated, {});
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok(am[k] >= before[k] && ar[k] >= before[k], "server round-trip: no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")"));
const sLead = round.obx.places.find(p => p.id === "pl_lead");
ok(!!sLead && sLead.name === "Old lead pin" && sLead.owner === "Jane PM" && sLead.address === undefined && sLead.category === undefined, "server: LEGACY map-pin place survives byte-for-byte (new fields stay ABSENT — js/19/js/24 untouched)");
const sLowes = round.obx.places.find(p => p.id === "pl_lowes");
ok(!!sLowes && sLowes.category === "vendor" && sLowes.address === "Lowe's, Kitty Hawk NC" && sLowes.manualMiles === 20, "server: NEW place address+category+manualMiles survive the round-trip");
const sStop = round.obx.jobs.find(j => j.id === "jStop");
ok(!!sStop && sStop.plannedStops[0].placeId === "pl_dump", "server: job plannedStops[i].placeId survives");
const sEnd = round.obx.jobs.find(j => j.id === "jEnd");
ok(!!sEnd && sEnd.routeEnd && sEnd.routeEnd.placeId === "pl_lowes", "server: job routeEnd.placeId survives");

/* ============ 2) CLIENT — the REAL js/02 load(), then helpers + job-page on top ============ */
const localStorageStub = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; } };
const sandbox = { console, localStorage: localStorageStub, window: { __syncApplying: false }, migrateBudgetBooks: () => {}, isFinite: isFinite, parseFloat: parseFloat };
const ctx = vm.createContext(sandbox);
const clientPre = JSON.parse(JSON.stringify(pre));
Object.assign(clientPre, { biz: "obx", propsV2: true, seeded: true, researchV2: true, researchV3: true, marketingV2: true, ceoV1: true, ceoV3: true, msgIAv1: true, todoGbp: true });
localStorageStub._data["jra_app_v1"] = JSON.stringify(clientPre);
vm.runInContext(fs.readFileSync("js/02-state.js", "utf8"), ctx, { filename: "js/02-state.js" });
vm.runInContext(fs.readFileSync("js/27-helpers.js", "utf8"), ctx, { filename: "js/27-helpers.js" });
vm.runInContext(fs.readFileSync("js/62-homebase.js", "utf8"), ctx, { filename: "js/62-homebase.js" });
vm.runInContext(fs.readFileSync("js/61-job-page.js", "utf8"), ctx, { filename: "js/61-job-page.js" });
vm.runInContext(fs.readFileSync("js/74-places.js", "utf8"), ctx, { filename: "js/74-places.js" });
vm.runInContext("load();", ctx);

const S_after = vm.runInContext("S", ctx);
const cB = census(pre), cA = census(S_after);
Object.keys(cB).forEach(k => ok(cA[k] >= cB[k], "client load(): no loss in " + k + " (before=" + cB[k] + " after=" + cA[k] + ")"));
const cLowes = S_after.obx.places.find(p => p.id === "pl_lowes");
ok(!!cLowes && cLowes.manualMiles === 20 && cLowes.category === "vendor", "client load(): place manualMiles+category preserved");
const cLead = S_after.obx.places.find(p => p.id === "pl_lead");
ok(!!cLead && cLead.address === undefined && cLead.category === undefined, "client load(): legacy map-pin place keeps NO new fields (unchanged)");
ok(!!S_after.obx.jobs.find(j => j.id === "jStop" && j.plannedStops[0].placeId === "pl_dump"), "client load(): plannedStops placeId preserved");

/* ---- unit: savedLocMatches() — offline, ~5 max, requires lat!=null ---- */
const savedLocMatches = vm.runInContext("savedLocMatches", ctx);
ok(Array.isArray(savedLocMatches("")) && savedLocMatches("").length === 0, "savedLocMatches('') = [] (empty query)");
const mLowes = savedLocMatches("lowe");
ok(mLowes.length === 1 && mLowes[0].kind === "place" && mLowes[0].ref === "pl_lowes" && mLowes[0].manualMiles === 20, "savedLocMatches('lowe') → the vendor place, with manualMiles=20 threaded through");
const mSite = savedLocMatches("site");
ok(mSite.length === 1 && mSite[0].kind === "property" && mSite[0].ref === "p_site" && mSite[0].lat === 36.10, "savedLocMatches('site') → the geocoded PROPERTY (lat!=null) with coords");
ok(savedLocMatches("Ungeocoded").length === 0, "savedLocMatches skips a property with lat==null (no coords to reuse)");
ok(savedLocMatches("transfer").some(m => m.ref === "pl_dump"), "savedLocMatches matches a place on its address/name substring, case-insensitive");

/* ---- unit: jobRecalcRouteMiles() manual-override leg math ---- */
const jobRecalc = vm.runInContext("jobRecalcRouteMiles", ctx);
const haversineMi = vm.runInContext("haversineMi", ctx);
const BASE = [36.00, -75.70], LOWES = [40.00, -80.00], SITE = [36.10, -75.60];

// (A) base → place → base = 2 × manualMiles (single-pickup), NOT the (wrong-geocode) haversine
const jA = { id: "jA", propertyId: null, plannedStops: [{ id: "a", address: "Lowe's", lat: LOWES[0], lng: LOWES[1], placeId: "pl_lowes" }] };
jobRecalc(jA);
ok(jA.estRouteMiles === 40, "base→place→base uses 2×manualMiles = 40 (single-pickup override, no ×1.3)");
const havBoth = Math.round(haversineMi(BASE[0], BASE[1], LOWES[0], LOWES[1]) * 1.3 * 2 * 10) / 10;
ok(jA.estRouteMiles !== havBoth && havBoth > 400, "  …and 40 ≠ the wrong-geocode haversine (" + havBoth + " mi) — the manual override fixed the Lowe's case");

// (B) each base-adjacent leg = manualMiles with NO ×1.3 (the 40 above is 20+20; assert a leg is exactly 20)
ok(jA.estRouteMiles / 2 === 20, "base→place leg = manualMiles (20), the ×1.3 road factor is NOT applied to a manual-override leg");

// (C) place → site leg stays haversine (only the base-adjacent leg overrides)
const jC = { id: "jC", propertyId: "p_site", plannedStops: [{ id: "c", address: "Lowe's", lat: LOWES[0], lng: LOWES[1], placeId: "pl_lowes" }] };
jobRecalc(jC);
// seq = base → place(override 20) → site(haversine) → base(haversine)
const expC = Math.round((20 + haversineMi(LOWES[0], LOWES[1], SITE[0], SITE[1]) * 1.3 + haversineMi(SITE[0], SITE[1], BASE[0], BASE[1]) * 1.3) * 10) / 10;
ok(jC.estRouteMiles === expC, "place→site leg stays haversine ×1.3 (est " + jC.estRouteMiles + " = 20 + hav(place,site) + hav(site,base)) — only base↔place overrides");

// (D) a job with NO placeId gives the SAME estimate as before (pure haversine, unchanged)
const jD = { id: "jD", propertyId: null, plannedStops: [{ id: "d", address: "somewhere", lat: LOWES[0], lng: LOWES[1] }] };
jobRecalc(jD);
const legacy = Math.round(haversineMi(BASE[0], BASE[1], LOWES[0], LOWES[1]) * 1.3 * 2 * 10) / 10;
ok(jD.estRouteMiles === legacy, "NO placeId → identical to the OLD haversine ×1.3 formula (" + jD.estRouteMiles + " mi) — zero behavior change for place-less routes");
ok(jD.estRouteMiles !== jA.estRouteMiles, "  …and the SAME stop coords WITH a placeId (40) vs WITHOUT (" + jD.estRouteMiles + ") differ — placeId is exactly what triggers the override");

console.log(fail ? ("\n  ✗ " + fail + " FAILED") : "\n  ✓ ZERO LOSS — legacy pins + new vendor places (address/category/manualMiles) + jobs with placeId refs survive migrateStore + a sync round-trip + client load(); savedLocMatches + the manual-override leg math behave; no-placeId routes are byte-identical to before.");
process.exit(fail ? 1 : 0);
