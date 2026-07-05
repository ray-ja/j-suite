/* stage-fingerprint-test.js — the PROMOTION GATE for the job-status-pipeline build.
 *
 * The pipeline (workStage / js/60) is a pure DERIVED read layer: it stores NOTHING and adds NO field or
 * migration. Finance / billing / invoicing / payouts never read a status field, so not one cent may move.
 * This computes a "finance fingerprint" per org — everything the money side reads — over a REAL data.json,
 * and asserts it is BYTE-IDENTICAL across: raw → server migrateStore() → a no-op sync round-trip (mergeState).
 *
 * Fingerprint (per org): confirmed + all-in mileage cents (js/39 finMileage), A/R owed (js/64: invoiced &
 * !paid), outstanding quote-balance cents (js/50 quoteBalAmt logic), job-cost cents (js/64 finPeriodPL job
 * expenses), per-member payout cents (js/39 finRollup → finPayouts) + period revenue cents. Nothing here is
 * invented by the test — it mirrors the exact math finance uses, so any drift = a real finance regression.
 * Read-only: never writes the source. Mirrors mileage-fingerprint-test.js + migration-proof.js.
 *
 * Usage:  node stage-fingerprint-test.js [/path/to/data.json]   (default: ./data.json)
 */
const SS = require("./sync-server");
const f = require("./js/39-finance-core");
const fs = require("fs");
const file = process.argv[2] || "data.json";
const raw = JSON.parse(fs.readFileSync(file, "utf8"));

const orgIds = s => Object.keys(s).filter(k => k !== "users" && k !== "registry" && s[k] && typeof s[k] === "object" && !Array.isArray(s[k]));

/* pure quote-money helpers — identical logic to js/50 quoteTotalAmt/quotePaidAmt/quoteBalAmt */
function qTotal(q) { return (q.finalPrice || q.total || 0); }
function qPaid(q) { return (q.payments || []).filter(p => p && !p.deleted).reduce((s, p) => s + (+p.amount || 0), 0); }
function qBal(q) { return Math.max(0, qTotal(q) - qPaid(q)); }

function financeFingerprint(store) {
  const fp = {};
  orgIds(store).forEach(o => {
    const s = store[o]; if (!s || typeof s !== "object") return;
    const quotes = (s.quotes || []).filter(q => q && !q.deleted);

    // A/R (js/64 rFinOverview): invoiced && !paid → finalPrice||total
    let ar = 0, arN = 0;
    quotes.forEach(q => { if (q.invoiced && !q.paid) { ar += qTotal(q); arN++; } });
    fp[o + "|ar_owed¢"] = Math.round(ar * 100); fp[o + "|ar_count"] = arN;

    // outstanding quote balance (js/50 recBuckets): total>0 && !paid → sum of quoteBalAmt
    let bal = 0; quotes.forEach(q => { if (qTotal(q) > 0 && !q.paid) bal += qBal(q); });
    fp[o + "|quote_bal¢"] = Math.round(bal * 100);

    // job costs (js/64 finPeriodPL, all-time): non-deleted job.expenses
    let jc = 0; (s.jobs || []).forEach(j => { if (j && !j.deleted) (j.expenses || []).forEach(e => { if (e && !e.deleted) jc += f.finCents(e.amount); }); });
    fp[o + "|job_costs¢"] = jc;

    // mileage reimbursement (js/39 finMileage) — confirmed + all
    const mil = f.finMileage(s.timeclock || [], { confirmedOnly: true });
    fp[o + "|mileage¢"] = mil.total;
    fp[o + "|mileage_all¢"] = f.finMileage(s.timeclock || [], {}).total;

    // payouts (js/39 finRollup → finPayouts) — per-member distribution + mileage reimbursement
    const roll = f.finRollup(s.income || [], {});
    const pay = f.finPayouts(roll, mil);
    Object.keys(pay).sort().forEach(id => { fp[o + "|payout:" + id + "¢"] = pay[id].total; });
    fp[o + "|revenue¢"] = roll.totals.amount;
  });
  return fp;
}

const before = financeFingerprint(raw);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(raw)));   // migrate a COPY (server's load-equivalent)
const round = SS.mergeState(migrated, {});                          // no-op sync round-trip
const afterMig = financeFingerprint(migrated), afterRound = financeFingerprint(round);

let fail = 0;
const keys = Array.from(new Set([].concat(Object.keys(before), Object.keys(afterMig), Object.keys(afterRound)))).sort();
keys.forEach(k => {
  const b = before[k], m = afterMig[k], r = afterRound[k];
  if (!(b === m && b === r)) { console.log("  ✗ FINANCE DRIFT in " + k + ": before=" + b + " migrated=" + m + " round-trip=" + r); fail++; }
});

console.log("\n  Finance fingerprint (per org · A/R · quote balance · job costs · mileage · payouts · revenue):");
Object.keys(before).sort().forEach(k => console.log("    " + k + " = " + before[k]));

if (!fail) {
  console.log("\n  ✓ finance byte-identical across raw → migrate → round-trip (" + Object.keys(before).length + " sums checked, 0 drift)");
  console.log("\n  =========  stage fingerprint GREEN — finance provably unchanged (derived-only)  =========");
  process.exit(0);
} else {
  console.log("\n  =========  " + fail + " FINANCE DRIFT(S) — money moved, gate FAILED  =========");
  process.exit(1);
}
