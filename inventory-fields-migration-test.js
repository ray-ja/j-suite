/* inventory-fields-migration-test.js — MANDATORY migration fixture for the INVENTORY ASSET-REGISTER (Phase 3).
 * The new item fields (plate / location / heldBy / status) are ADDITIVE and tolerate-absent (no migration
 * backfill, no schema bump). This fixture loads a realistic PRE-change store and asserts that running it through
 * the new server's migrateStore + a no-op sync round-trip:
 *   • drops NO inventory item and NO existing item field — zero loss,
 *   • preserves items that ALREADY set the new fields (plate/location/heldBy/status) VERBATIM — no clobber,
 *   • leaves legacy items untouched (no forced keys, updatedAt unchanged) so the backfill can never lose to a
 *     real edit on merge,
 *   • keeps the personal clock-in vehicle (ownerId + clockIn + plate) intact — mileage semantics unchanged.
 * Read-only: builds its own fixture; writes nothing. Run: node inventory-fields-migration-test.js */
const SS = require("./sync-server");
const clone = o => JSON.parse(JSON.stringify(o));

// ---- a realistic pre-change store: obx inventory with varied item shapes ----
const fixture = {
  biz: "obx",
  obx: {
    customers: [{ id: "c1", name: "Jane Doe", updatedAt: 100 }], quotes: [], jobs: [],
    inventory: [
      // seeded master item — no asset-register fields at all (the common legacy shape)
      { id: "inv-chainsaw-small-16-18", name: "Chainsaw — small (16–18\")", cat: "equipment", have: true, qty: "", tags: ["brush"], section: "Yard / brush / land-clearing equipment", updatedAt: 200 },
      // hand-added tool with NO new fields
      { id: "inv-c-legacy1", name: "Random tool", cat: "tool", have: true, qty: "2", tags: [], section: "Other", updatedAt: 201 },
      // Phase-2 personal clock-in vehicle WITH a plate already entered (the urgent field)
      { id: "inv-veh-personal-u_owner", name: "Ray's vehicle", cat: "vehicle", personal: true, ownerId: "u_owner", clockIn: true, active: true, have: true, qty: "", plate: "LCW-4430", tags: [], section: "Vehicle & transport", updatedAt: 202 },
      // an item that ALREADY set every new asset-register field — must survive verbatim (no clobber)
      { id: "inv-c-full", name: "DeWalt drill", cat: "tool", have: true, qty: "1", plate: "", location: "Ray's garage", heldBy: "u_crew1", status: "needs-repair", tags: [], section: "Junk / clear-out tools", updatedAt: 203 },
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
["inv-chainsaw-small-16-18", "inv-c-legacy1", "inv-veh-personal-u_owner", "inv-c-full"].forEach(id =>
  check("item " + id + " present after round-trip", !!byId(round, id)));

// ---- 2) existing fields preserved verbatim (zero field loss) ----
invOf(before).forEach(b => {
  const r = byId(round, b.id);
  Object.keys(b).forEach(f => check(b.id + "." + f + " preserved", JSON.stringify(r && r[f]) === JSON.stringify(b[f])));
});

// ---- 3) the urgent field: the personal vehicle keeps its plate + clock-in/owner semantics ----
const veh = byId(round, "inv-veh-personal-u_owner");
check("personal vehicle keeps plate LCW-4430", veh && veh.plate === "LCW-4430");
check("personal vehicle keeps ownerId (mileage reimburses owner)", veh && veh.ownerId === "u_owner");
check("personal vehicle keeps clockIn flag", veh && veh.clockIn === true);

// ---- 4) an item that pre-set every new field is preserved verbatim (no clobber) ----
const full = byId(round, "inv-c-full");
check("pre-set location preserved", full && full.location === "Ray's garage");
check("pre-set heldBy preserved", full && full.heldBy === "u_crew1");
check("pre-set status preserved", full && full.status === "needs-repair");

// ---- 5) legacy items are NOT force-backfilled (no forced keys) + updatedAt unchanged (loses to a real edit) ----
const legacy = byId(round, "inv-c-legacy1");
check("legacy item not force-given a plate key", legacy && !("plate" in legacy));
check("legacy item not force-given a status key", legacy && !("status" in legacy));
invOf(before).forEach(b => { const r = byId(round, b.id); check(b.id + " updatedAt unchanged", r && r.updatedAt === b.updatedAt); });

// ---- 6) registry company truck (its plate) survives untouched ----
const rt = ((round.registry || []).find(x => x.id === "obx") || {}).vehicles || [];
check("registry F-150 truck survives with plate", rt.some(v => v.id === "veh_obx_f150" && v.plate === "LCW-4430"));

console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
