/* mileage-cascade-tests.js — the ONE mileage cascade (js/52 jobMilesBilled).
 *
 * Ray, 2026-09-09: "mileage should just cascade based on available info. odometer is 1st truth, then
 * calculated mileage based on home to job to soundside recycling to home."
 *
 * WHAT WENT WRONG BEFORE: three mileage functions with three different orders, and the MONEY path used the
 * narrowest — jobMileageCost, which stops at the odometer and returns 0. A job nobody clocked miles on
 * carried no vehicle cost at all, so it never came off the split base: the crew divided the truck money and
 * the Business Fund bought the fuel back. The computed route already existed (js/61 jobRecalcRouteMiles,
 * OSRM over base → stops → site → base, parked on j.estRouteMiles); nothing read it for costing.
 *
 * Pure node. Run: node mileage-cascade-tests.js
 */
const fs = require("fs");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } }

const RATE = 0.725;
global.FIN = { MILEAGE_RATE: RATE };
let STORE = { jobs: [], quotes: [], timeclock: [], jobExpenses: [], jobMaterials: [] };
global.D = () => STORE;
global.actJ = () => STORE.jobs.filter(j => j && !j.deleted);
global.today = () => "2026-09-09";
global.now = () => 1;
global.touch = o => { o.updatedAt = 1; };
global.uid = () => "u1";
global.MARGIN_FLOOR = 0.35;
global.window = global;
let WORKDAYS = 1;
global.jobWorkDays = () => new Array(WORKDAYS).fill("d");

const code = fs.readFileSync(__dirname + "/js/52-job-pl.js", "utf8");
try { eval(code); } catch (e) { console.log("FATAL eval error: " + (e && e.stack || e)); process.exit(1); }

function reset() { STORE = { jobs: [], quotes: [], timeclock: [], jobExpenses: [], jobMaterials: [] }; WORKDAYS = 1; }
function job(fields) { const j = Object.assign({ id: "j1", deleted: false }, fields); STORE.jobs.push(j); return j; }

console.log("\n— the cascade, in Ray's order —");
{
  reset();
  /* every source present at once: the highest-ranked one must win outright, never blend */
  const j = job({ manualMiles: 163, estRouteMiles: 40, manualRouteMiles: 55, driveMiles: 12 });
  STORE.timeclock.push({ id: "t1", jobId: "j1", clockOut: 1, milesConfirmed: true, miles: 30, deleted: false });
  const b = jobMilesBilled(j);
  ok("1. the owner's typed actual miles win over everything", b.miles === 163 && b.source === "odometer", b);
  ok("...costed at the IRS rate", b.cost === Math.round(163 * RATE * 100) / 100, b.cost);
}
{
  reset();
  const j = job({ estRouteMiles: 40, manualRouteMiles: 55, driveMiles: 12 });
  STORE.timeclock.push({ id: "t1", jobId: "j1", clockOut: 1, milesConfirmed: true, miles: 18, deleted: false });
  STORE.timeclock.push({ id: "t2", jobId: "j1", clockOut: 1, milesConfirmed: true, miles: 12, deleted: false });
  const b = jobMilesBilled(j);
  ok("2. ⭐ the CONFIRMED ODOMETER beats the map — 'odometer is 1st truth'", b.source === "odometer", b);
  ok("...summing every day's reading (18 + 12 = 30)", Math.round(b.miles) === 30, b.miles);
}
{
  reset();
  const j = job({ estRouteMiles: 40, manualRouteMiles: 55 });
  const b = jobMilesBilled(j);
  ok("3. no odometer → the owner's own round-trip figure", b.miles === 55 && b.source === "manual route", b);
}
{
  reset();
  const j = job({ estRouteMiles: 40 });
  const b = jobMilesBilled(j);
  ok("4. ⭐ nothing manual → the COMPUTED ROUTE (base → stops → site → base)", b.miles === 40 && b.source === "route", b);
  ok("...which is $29.00 of truck at the IRS rate", b.cost === 29, b.cost);
}
{
  reset();
  const j = job({ driveMiles: 12 });
  ok("5. an old job's legacy driveMiles is still honoured", jobMilesBilled(j).source === "legacy", jobMilesBilled(j));
}
{
  reset();
  const j = job({});
  const b = jobMilesBilled(j);
  ok("nothing at all → zero, and it SAYS so rather than pretending", b.miles === 0 && b.source === "none", b);
}

console.log("\n— an unclocked job is no longer free to drive —");
{
  reset();
  /* THE BUG: this job has a computed route and no odometer. jobMileageCost sees 0. */
  const j = job({ estRouteMiles: 39 });
  ok("⛔ the bare odometer function still reads $0 — that was the leak", jobMileageCost(j) === 0, jobMileageCost(j));
  ok("⭐ the cascade costs the route instead", jobMilesBilled(j).cost === Math.round(39 * RATE * 100) / 100, jobMilesBilled(j));
  ok("⭐⭐ so hard costs now CARRY the truck — it comes off the split base",
    Math.round(jobHardCost(j).total * 100) / 100 === Math.round(39 * RATE * 100) / 100, jobHardCost(j));
  ok("...and the P&L names where the number came from", jobHardCost(j).milesSource === "route", jobHardCost(j).milesSource);
}

console.log("\n— multi-day: the route is driven once per work day, an odometer is not —");
{
  reset(); WORKDAYS = 3;
  const j = job({ estRouteMiles: 40 });
  ok("a 3-day job drives the computed route 3×", jobMilesBilled(j).miles === 120, jobMilesBilled(j));
  reset(); WORKDAYS = 3;
  const k = job({ id: "j1", manualMiles: 100 });
  ok("⛔ but a typed odometer total is NOT multiplied — it already counted every trip",
    jobMilesBilled(k).miles === 100, jobMilesBilled(k));
}
{
  reset(); WORKDAYS = 1;
  STORE.quotes.push({ id: "q1", jobId: "j1", deleted: false, estDays: 2 });
  const j = job({ estRouteMiles: 40 });
  ok("an estimate of 2 days counts before anyone has clocked a day", jobMilesBilled(j).miles === 80, jobMilesBilled(j));
}

console.log("\n— one number everywhere (the whole point) —");
{
  reset();
  const j = job({ estRouteMiles: 39 });
  ok("⭐⭐ the Jobs table, the P&L and the payout split agree by construction",
    jobMilesCost(j) === jobMilesCostEst(j) && jobMilesCostEst(j) === jobMilesBilled(j).cost,
    { cost: jobMilesCost(j), est: jobMilesCostEst(j), billed: jobMilesBilled(j).cost });
}

console.log("\n— a dump-run stop splits its miles across the jobs it served —");
{
  reset();
  const a = job({ id: "jA", estRouteMiles: 20 });
  job({ id: "jB", estRouteMiles: 20 });
  job({ id: "jS", estRouteMiles: 14, sharedJobIds: ["jA", "jB"] });   // one Soundside run for two jobs
  const hc = jobHardCost(a);
  ok("the shared dump run contributes HALF its miles to each job",
    Math.round(hc.mil * 100) / 100 === Math.round((20 * RATE) + (14 * RATE / 2), 2) ||
    Math.abs(hc.mil - ((20 * RATE) + (14 * RATE / 2))) < 0.02,
    { mil: hc.mil, want: (20 * RATE) + (14 * RATE / 2) });
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
