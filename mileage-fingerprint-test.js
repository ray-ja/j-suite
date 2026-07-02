/* mileage-fingerprint-test.js — the #1 GATE for the vehicle-unification build (Inventory → clock-in).
 *
 * The mileage-reimbursement invariant (js/39-finance-core.js finMileage, keyed vehicleOwnerId || userId)
 * MUST NOT MOVE: a company truck (vehicleOwnerId=null) reimburses the DRIVER; a personal vehicle
 * (vehicleOwnerId=owner) reimburses the OWNER. This test computes a "mileage fingerprint" — per-member
 * CONFIRMED mileage cents, per org, straight out of finMileage — over a REAL data.json, and asserts it is
 * BYTE-IDENTICAL across: raw  →  server migrateStore()  →  a no-op sync round-trip (mergeState).
 *
 * Migration for this feature is purely additive (new inventory vehicle rows + additive timeclock entry
 * fields that finMileage never reads), so not a single reimbursement cent may drift. Any drift = a mileage
 * regression → fail the gate. Read-only: never writes the source.
 *
 * Usage:  node mileage-fingerprint-test.js [/path/to/data.json]   (default: ./data.json)
 * Mirrors migration-proof.js (the promotion gate) + reuses the real finMileage from finance-core.
 */
const SS = require("./sync-server");
const f = require("./js/39-finance-core");
const fs = require("fs");
const file = process.argv[2] || "data.json";
const raw = JSON.parse(fs.readFileSync(file, "utf8"));

const orgIds = s => Object.keys(s).filter(k => k !== "users" && k !== "registry" && s[k] && typeof s[k] === "object" && !Array.isArray(s[k]));

/* the fingerprint: per org, per reimbursement-owner CONFIRMED mileage cents (finMileage's own key +
   totals). Nothing here is derived by this test — it is finMileage's exact output, so it captures any
   change to the reimbursement math, the entry fields it reads, or which owner gets paid. */
function mileageFingerprint(store) {
  const fp = {};
  orgIds(store).forEach(o => {
    const m = f.finMileage((store[o].timeclock) || [], { confirmedOnly: true });
    Object.keys(m.perMember).sort().forEach(owner => { fp[o + "|owner:" + owner + "¢"] = m.perMember[owner]; });
    fp[o + "|__total¢"] = m.total;
    fp[o + "|__miles"] = m.miles;
    // also fingerprint UNCONFIRMED-inclusive totals so a change that (wrongly) flips confirmation is caught too
    const all = f.finMileage((store[o].timeclock) || [], {});
    fp[o + "|__all_total¢"] = all.total;
    fp[o + "|__all_miles"] = all.miles;
  });
  return fp;
}

const before = mileageFingerprint(raw);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(raw)));   // migrate a COPY (server's load-equivalent)
const round = SS.mergeState(migrated, {});                          // no-op sync round-trip
const afterMig = mileageFingerprint(migrated), afterRound = mileageFingerprint(round);

let fail = 0;
const keys = Array.from(new Set([].concat(Object.keys(before), Object.keys(afterMig), Object.keys(afterRound)))).sort();
keys.forEach(k => {
  const b = before[k], m = afterMig[k], r = afterRound[k];
  if (!(b === m && b === r)) {
    console.log("  ✗ MILEAGE DRIFT in " + k + ": before=" + b + " migrated=" + m + " round-trip=" + r);
    fail++;
  }
});

console.log("\n  Mileage fingerprint (confirmed reimbursement cents, per org · per owner):");
Object.keys(before).sort().forEach(k => console.log("    " + k + " = " + before[k]));

if (!fail) {
  console.log("\n  ✓ mileage byte-identical across raw → migrate → round-trip (" + Object.keys(before).length + " sums checked, 0 drift)");
  console.log("\n  =========  mileage fingerprint GREEN — reimbursement provably unchanged  =========");
  process.exit(0);
} else {
  console.log("\n  =========  " + fail + " MILEAGE DRIFT(S) — reimbursement moved, gate FAILED  =========");
  process.exit(1);
}
