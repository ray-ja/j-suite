/* inventory-cleaning-migration-test.js — MANDATORY migration fixture for the INVENTORY CLEANING/MAINTENANCE
 * fields (Phase 4). The new item fields (dirtiesWithUse / needsCleaning + the clean-audit stamps
 * cleanFlaggedAt/By, cleanClearedAt/By) are ADDITIVE and tolerate-absent (no migration backfill, no schema
 * bump). This fixture loads a realistic PRE-change store and asserts that running it through the new server's
 * migrateStore + a no-op sync round-trip:
 *   • drops NO inventory item and NO existing item field — zero loss,
 *   • preserves items that ALREADY set the cleaning fields (dirtiesWithUse/needsCleaning/stamps) VERBATIM,
 *   • leaves legacy items untouched (no forced keys, updatedAt unchanged) so a backfill can never lose to a
 *     real edit on merge,
 *   • keeps the co-existing asset-register fields (plate/heldBy/status) + the personal clock-in vehicle intact.
 * Read-only: builds its own fixture; writes nothing. Run: node inventory-cleaning-migration-test.js */
const SS = require("./sync-server");
const clone = o => JSON.parse(JSON.stringify(o));

const fixture = {
  biz: "obx",
  obx: {
    customers: [{ id: "c1", name: "Jane Doe", updatedAt: 100 }], quotes: [], jobs: [],
    inventory: [
      // legacy seeded item — NO cleaning fields at all (the common shape)
      { id: "inv-c-legacy1", name: "Random tool", cat: "tool", have: true, qty: "2", tags: [], section: "Other", updatedAt: 201 },
      // a "dirties with use" tool NOT currently flagged
      { id: "inv-chainsaw-small-16-18", name: "Chainsaw — small (16–18\")", cat: "equipment", have: true, qty: "", dirtiesWithUse: true, tags: ["brush"], section: "Yard / brush / land-clearing equipment", updatedAt: 202 },
      // a tool that is CURRENTLY flagged needs-cleaning with full audit stamps — must survive verbatim
      { id: "inv-c-dirty", name: "Mower", cat: "equipment", have: true, qty: "1", dirtiesWithUse: true, needsCleaning: true, cleanFlaggedAt: 1700000000000, cleanFlaggedBy: "u_crew1", plate: "", location: "trailer", heldBy: "u_crew1", status: "in-service", tags: ["yard"], section: "Yard / brush / land-clearing equipment", updatedAt: 203 },
      // a tool that was flagged and cleared — keeps both flag + cleared stamps (history survives)
      { id: "inv-c-cleared", name: "Trimmer", cat: "equipment", have: true, qty: "1", dirtiesWithUse: true, needsCleaning: false, cleanFlaggedAt: 1699000000000, cleanFlaggedBy: "u_crew1", cleanClearedAt: 1699500000000, cleanClearedBy: "u_owner", tags: ["yard"], section: "Yard / brush / land-clearing equipment", updatedAt: 204 },
      // personal clock-in vehicle WITH a plate — mileage semantics unchanged
      { id: "inv-veh-personal-u_owner", name: "Ray's vehicle", cat: "vehicle", personal: true, ownerId: "u_owner", clockIn: true, active: true, have: true, qty: "", plate: "LCW-4430", tags: [], section: "Vehicle & transport", updatedAt: 205 },
    ],
  },
  jam: { customers: [], quotes: [], jobs: [], inventory: [] },
  registry: [{ id: "obx", vehicles: [{ id: "veh_obx_f150", name: "F-150", plate: "LCW-4430", active: true, kind: "vehicle" }], updatedAt: 50 }],
  users: [
    { id: "u_owner", username: "ray", passhash: "hashOWNER", role: "owner", active: true, updatedAt: 111 },
    { id: "u_crew1", username: "chase", passhash: "hashC", role: "crew", active: true, updatedAt: 222 },
  ],
};

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL: " + name); } };
const invOf = st => ((st.obx || {}).inventory || []).filter(r => r && !r.deleted);
const byId = (st, id) => invOf(st).find(r => r.id === id) || null;

const before = clone(fixture);
const migrated = SS.migrateStore(clone(fixture));
const round = SS.mergeState(clone(migrated), {});   // no-op sync round-trip (server merge)

// ---- 1) zero inventory loss ----
check("every inventory item survives migrate", invOf(migrated).length === invOf(before).length);
check("every inventory item survives the sync round-trip", invOf(round).length === invOf(before).length);
["inv-c-legacy1", "inv-chainsaw-small-16-18", "inv-c-dirty", "inv-c-cleared", "inv-veh-personal-u_owner"].forEach(id =>
  check("item " + id + " present after round-trip", !!byId(round, id)));

// ---- 2) every existing field preserved verbatim (zero field loss) ----
invOf(before).forEach(b => {
  const r = byId(round, b.id);
  Object.keys(b).forEach(f => check(b.id + "." + f + " preserved", JSON.stringify(r && r[f]) === JSON.stringify(b[f])));
});

// ---- 3) the currently-flagged tool keeps its needs-cleaning state + stamps ----
const dirty = byId(round, "inv-c-dirty");
check("flagged tool keeps needsCleaning=true", dirty && dirty.needsCleaning === true);
check("flagged tool keeps dirtiesWithUse=true", dirty && dirty.dirtiesWithUse === true);
check("flagged tool keeps cleanFlaggedAt", dirty && dirty.cleanFlaggedAt === 1700000000000);
check("flagged tool keeps cleanFlaggedBy", dirty && dirty.cleanFlaggedBy === "u_crew1");
check("flagged tool keeps co-existing asset-register fields (heldBy/status/location)", dirty && dirty.heldBy === "u_crew1" && dirty.status === "in-service" && dirty.location === "trailer");

// ---- 4) the cleared tool keeps BOTH flag + cleared audit stamps ----
const cleared = byId(round, "inv-c-cleared");
check("cleared tool needsCleaning=false", cleared && cleared.needsCleaning === false);
check("cleared tool keeps cleanFlaggedAt/By (history)", cleared && cleared.cleanFlaggedAt === 1699000000000 && cleared.cleanFlaggedBy === "u_crew1");
check("cleared tool keeps cleanClearedAt/By", cleared && cleared.cleanClearedAt === 1699500000000 && cleared.cleanClearedBy === "u_owner");

// ---- 5) legacy items are NOT force-backfilled (no forced cleaning keys) + updatedAt unchanged ----
const legacy = byId(round, "inv-c-legacy1");
check("legacy item not force-given a dirtiesWithUse key", legacy && !("dirtiesWithUse" in legacy));
check("legacy item not force-given a needsCleaning key", legacy && !("needsCleaning" in legacy));
invOf(before).forEach(b => { const r = byId(round, b.id); check(b.id + " updatedAt unchanged", r && r.updatedAt === b.updatedAt); });

// ---- 6) the personal clock-in vehicle keeps plate + clock-in/owner semantics ----
const veh = byId(round, "inv-veh-personal-u_owner");
check("personal vehicle keeps plate LCW-4430", veh && veh.plate === "LCW-4430");
check("personal vehicle keeps ownerId + clockIn", veh && veh.ownerId === "u_owner" && veh.clockIn === true);

console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
