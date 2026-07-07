/* migration-proof.js — the pre-promotion gate. Loads a REAL data.json, runs it through the new server's
   migrateStore + a no-op sync round-trip, and asserts EVERY live record (customer/property/quote/job/account
   + finances/inventory/messages) SURVIVES with zero loss. Migration is additive, so no count may ever drop.
   Read-only: never writes the source. Usage: node migration-proof.js /path/to/data.json */
const SS = require("./sync-server");
const fs = require("fs");
const file = process.argv[2] || "data.json";
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const COLS = ["customers", "properties", "quotes", "jobs", "income", "expenses", "inventory", "todos", "messages", "timeclock", "resale", "disbursements", "knowledge", "pendingChanges", "docs", "places", "changelog", "budgetBooks", "budgetCats", "budgetTx", "budgetMemo", "budgetAccounts", "budgetBudgets", "budgetTax", "budgetBills", "customJobs", "receipts", "recurringPlans"];
// BILLING FINGERPRINT — the receipts overhaul must NOT change a single dollar of what feeds job cost /
// customer invoicing. Sum every job's pass-through materials + job expenses + each org's business expenses,
// per org, in integer cents. Migration is additive (nothing moves an existing receipt), so these must be
// BYTE-IDENTICAL before → migrated → round-tripped. Any drift = a billing regression → fail the gate.
function billingFingerprint(store) {
  const fp = {};
  const orgIds = Object.keys(store).filter(k => k !== "users" && k !== "registry" && store[k] && typeof store[k] === "object" && !Array.isArray(store[k]));
  const cents = n => Math.round((+n || 0) * 100);
  orgIds.forEach(o => {
    let mat = 0, exp = 0, biz = 0;
    (store[o].jobs || []).forEach(j => { if (!j || j.deleted) return;
      (j.materials || []).forEach(m => { if (m && !m.deleted) mat += cents(m.amount); });
      (j.expenses || []).forEach(e => { if (e && !e.deleted) exp += cents(e.amount); });
    });
    (store[o].expenses || []).forEach(e => { if (e && !e.deleted) biz += cents(e.amount); });
    fp[o + ".job-materials¢"] = mat; fp[o + ".job-expenses¢"] = exp; fp[o + ".business-expenses¢"] = biz;
  });
  return fp;
}
function census(store) {
  const c = { _accounts: (store.users || []).filter(u => u && !u.kind && !u.deleted).length };
  const orgIds = Object.keys(store).filter(k => k !== "users" && k !== "registry" && store[k] && typeof store[k] === "object" && !Array.isArray(store[k]));
  orgIds.forEach(o => COLS.forEach(col => { const a = (store[o] && store[o][col]) || []; if (a.length) c[o + "." + col] = a.filter(r => r && !r.deleted).length; }));
  // AVAILABILITY is account-record content (u.avail.overrides + base pattern), NOT a COLLECTIONS collection —
  // it rides the users-array LWW, so a count-only census would miss it being silently dropped (the 2026-06-27
  // crew-availability regression class). Census the per-day OVERRIDE COUNT per account so migration + a sync
  // round-trip must preserve every posted availability day (additive: a count may never drop).
  (store.users || []).forEach(u => {
    if (!u || u.kind || u.deleted || !u.avail) return;
    const ov = u.avail.overrides;
    if (ov && typeof ov === "object") { const n = Object.keys(ov).length; if (n) c["avail." + u.id] = n; }
  });
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
// BYTE-IDENTICAL BILLING — before vs migrated vs round-trip must match to the cent.
const fpBefore = billingFingerprint(raw), fpMig = billingFingerprint(migrated), fpRound = billingFingerprint(round);
let billFail = 0;
Object.keys(fpBefore).forEach(k => {
  if (fpMig[k] !== fpBefore[k] || fpRound[k] !== fpBefore[k]) { console.log("  ✗ BILLING DRIFT in " + k + ": before=" + fpBefore[k] + " migrated=" + fpMig[k] + " round-trip=" + fpRound[k]); billFail++; }
});
if (!billFail) console.log("  ✓ billing byte-identical: job materials + job expenses + business expenses unchanged (" + Object.keys(fpBefore).length + " sums checked)");
fail += billFail;
const mem = (migrated.users || []).filter(u => u && u.kind === "membership").length;
const supers = (migrated.users || []).filter(u => u && !u.kind && u.superAdmin).length;
console.log("  source: " + file);
console.log("  accounts=" + before._accounts + " → memberships synthesized=" + mem + ", super-admins=" + supers + ", registry orgs=" + (migrated.registry || []).length);
console.log("  census points checked: " + Object.keys(before).length);
console.log(fail ? ("\n  ✗ " + fail + " LOSS(es) — DO NOT PROMOTE") : "\n  ✓ ZERO LOSS — every live record survives migration + a sync round-trip. Safe to promote.");
process.exit(fail ? 1 : 0);
