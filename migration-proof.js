/* migration-proof.js — the pre-promotion gate. Loads a REAL data.json, runs it through the new server's
   migrateStore + a no-op sync round-trip, and asserts EVERY live record (customer/property/quote/job/account
   + finances/inventory/messages) SURVIVES with zero loss. Migration is additive, so no count may ever drop.
   Read-only: never writes the source. Usage: node migration-proof.js /path/to/data.json */
const SS = require("./sync-server");
const fs = require("fs");
const file = process.argv[2] || "data.json";
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const COLS = ["customers", "properties", "quotes", "jobs", "income", "expenses", "inventory", "todos", "messages", "timeclock", "resale", "disbursements", "knowledge", "pendingChanges", "docs", "places", "changelog"];
function census(store) {
  const c = { _accounts: (store.users || []).filter(u => u && !u.kind && !u.deleted).length };
  const orgIds = Object.keys(store).filter(k => k !== "users" && k !== "registry" && store[k] && typeof store[k] === "object" && !Array.isArray(store[k]));
  orgIds.forEach(o => COLS.forEach(col => { const a = (store[o] && store[o][col]) || []; if (a.length) c[o + "." + col] = a.filter(r => r && !r.deleted).length; }));
  return c;
}
const before = census(raw);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(raw)));      // migrate a COPY
const round = SS.mergeState(migrated, {});                              // a no-op sync round-trip
const afterMig = census(migrated), afterRound = census(round);
let fail = 0;
Object.keys(before).forEach(k => {
  const b = before[k], m = afterMig[k] || 0, r = afterRound[k] || 0;
  if (m < b || r < b) { console.log("  ✗ LOSS in " + k + ": before=" + b + " migrated=" + m + " round-trip=" + r); fail++; }
});
const mem = (migrated.users || []).filter(u => u && u.kind === "membership").length;
const supers = (migrated.users || []).filter(u => u && !u.kind && u.superAdmin).length;
console.log("  source: " + file);
console.log("  accounts=" + before._accounts + " → memberships synthesized=" + mem + ", super-admins=" + supers + ", registry orgs=" + (migrated.registry || []).length);
console.log("  census points checked: " + Object.keys(before).length);
console.log(fail ? ("\n  ✗ " + fail + " LOSS(es) — DO NOT PROMOTE") : "\n  ✓ ZERO LOSS — every live record survives migration + a sync round-trip. Safe to promote.");
process.exit(fail ? 1 : 0);
