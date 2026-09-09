/* Finance-core money-math unit tests (pure, exact integer-cent).
 * Run: node finance-tests.js  →  expect: all passed, 0 failed.
 * Proves the operating-agreement split: 25/15/60 → 80/15/5, sales 3-mo window + house redirect,
 * admin $500/mo cap with overflow → field, equal field split with exact cent remainders, and
 * mileage reimbursement ($0.725/mi) as a Business-Fund expense (not a distribution). */
const f = require("./js/39-finance-core");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + "  got " + JSON.stringify(got)); } }

console.log("\n— cents helpers —");
ok("finCents rounds dollars→cents", f.finCents(400) === 40000 && f.finCents(333.335) === 33334 && f.finCents(0.1) === 10, [f.finCents(400), f.finCents(333.335)]);
ok("finDollars cents→dollars", f.finDollars(40000) === 400 && f.finDollars(1) === 0.01, null);

console.log("— top-level split: 25/15/60 → 80/15/5, exact —");
const s = f.finSplitAmount(40000);   // $400
ok("$400 → tax 100, business 60, labor 240", s.tax === 10000 && s.business === 6000 && s.labor === 24000, s);
ok("$400 labor → field 192, sales 36, admin 12", s.field === 19200 && s.sales === 3600 && s.admin === 1200, s);
ok("top buckets sum to amount", s.tax + s.business + s.labor === s.amount, s);
ok("labor buckets sum to labor", s.field + s.sales + s.admin === s.labor, s);

console.log("— no cent ever leaks across a sweep of amounts —");
let leak = null;
for (let c = 0; c <= 250000; c += 1) {        // $0 … $2,500 every cent
  const x = f.finSplitAmount(c);
  if (x.tax + x.business + x.labor !== c) { leak = { c: c, lvl: "top", x: x }; break; }
  if (x.field + x.sales + x.admin !== x.labor) { leak = { c: c, lvl: "labor", x: x }; break; }
  if ([x.tax, x.business, x.labor, x.field, x.sales, x.admin].some(v => v < 0)) { leak = { c: c, lvl: "neg", x: x }; break; }
}
ok("every cent 0..$2,500 splits with zero remainder + no negatives", leak === null, leak);

console.log("— equal field split, deterministic cent remainders —");
const e3 = f.finSplitEqual(1000, ["m1", "m2", "m3"]);
ok("1000¢ / 3 → 334/333/333 (remainder to lowest id)", e3.perMember.m1 === 334 && e3.perMember.m2 === 333 && e3.perMember.m3 === 333, e3.perMember);
ok("equal split sums to input", e3.perMember.m1 + e3.perMember.m2 + e3.perMember.m3 === 1000, e3);
const e0 = f.finSplitEqual(5000, []);
ok("no workers → whole amount is unallocated", e0.unallocated === 5000 && Object.keys(e0.perMember).length === 0, e0);

console.log("— sales 3-month window + house-account redirect —");
ok("exactly 3 months later is inside the window", f.finWithinSalesWindow("2026-01-15", "2026-04-15") === true, null);
ok("one day past 3 months is outside", f.finWithinSalesWindow("2026-01-15", "2026-04-16") === false, null);
ok("no booking date → outside", f.finWithinSalesWindow(null, "2026-04-15") === false, null);
const jIn = f.finJobSplit({ amount: 400, date: "2026-06-10", bookedAt: "2026-06-01", originator: "m1", houseAccount: false, crew: ["m2", "m3"] });
ok("in-window sale → 36 to originator, field stays 192", jIn.salesToOriginator === 3600 && jIn.fieldBeforeAdmin === 19200, jIn);
const jHouse = f.finJobSplit({ amount: 400, date: "2026-06-10", bookedAt: "2026-06-01", originator: "m1", houseAccount: true, crew: ["m2", "m3"] });
ok("house account → sales redirected into field (192+36=228), 0 to originator", jHouse.salesToOriginator === 0 && jHouse.fieldBeforeAdmin === 22800, jHouse);
const jOut = f.finJobSplit({ amount: 400, date: "2026-12-10", bookedAt: "2026-06-01", originator: "m1", houseAccount: false, crew: ["m2"] });
ok("out-of-window sale → redirected into field", jOut.salesToOriginator === 0 && jOut.fieldBeforeAdmin === 22800, jOut);
const jNoOrig = f.finJobSplit({ amount: 400, date: "2026-06-10", bookedAt: "2026-06-01", originator: "", houseAccount: false, crew: ["m2"] });
ok("no originator → redirected into field", jNoOrig.salesToOriginator === 0 && jNoOrig.fieldBeforeAdmin === 22800, jNoOrig);

console.log("— rollup: monthly Admin $500 cap, overflow → field —");
const incomes = [
  { id: "i1", jobId: "j1", date: "2026-06-05", amount: 10000, originator: "m1", bookedAt: "2026-06-01", houseAccount: false, crew: ["m1", "m2"] },
  { id: "i2", jobId: "j2", date: "2026-06-20", amount: 10000, originator: "m1", bookedAt: "2026-06-01", houseAccount: false, crew: ["m1", "m2"] }
];
const R = f.finRollup(incomes, { adminMemberId: "admin1", from: "2026-06-01", to: "2026-06-30" });
ok("totals: amount 20000000¢, tax 5,000,000, business 3,000,000, labor 12,000,000",
  R.totals.amount === 2000000 && R.totals.tax === 500000 && R.totals.business === 300000 && R.totals.labor === 1200000, R.totals);
ok("admin to member capped at $500 (50,000¢), $100 overflowed", R.totals.admin === 50000 && R.totals.adminOverflow === 10000, R.totals);
ok("admin member receives exactly the cap", (R.member.admin1 || {}).admin === 50000, R.member.admin1);
ok("originator m1 sales = $180 (both jobs in window)", R.member.m1.sales === 180000, R.member.m1);
ok("field: job1 480,000 split + job2 (480,000+10,000 overflow) split → m1/m2 each 485,000",
  R.member.m1.field === 485000 && R.member.m2.field === 485000, { m1: R.member.m1, m2: R.member.m2 });
ok("distributions (field+sales+admin) sum back to labor", R.totals.field + R.totals.sales + R.totals.admin === R.totals.labor, R.totals);

console.log("— rollup: unworked job → field unallocated, nothing invented —");
const Ru = f.finRollup([{ id: "u1", jobId: "j9", date: "2026-06-10", amount: 400, originator: "m1", bookedAt: "2026-06-01", crew: [] }], { adminMemberId: "admin1" });
ok("no crew → field pool (192¢) unallocated, no member field", Ru.totals.unallocatedField === 19200 && Ru.totals.field === 0, Ru.totals);
ok("originator still gets sales credit even with no crew", (Ru.member.m1 || {}).sales === 3600, Ru.member.m1);
ok("admin still paid to the admin member (not folded to field) when one is set", (Ru.member.admin1 || {}).admin === 1200, Ru.member.admin1);
// no admin member AND no originator → both shares fold into field; the whole labor pool becomes field work
const Rna = f.finRollup([{ id: "x1", date: "2026-06-10", amount: 400, originator: "", crew: ["m2"] }], {});
ok("no admin member + no originator → entire labor pool ($240) becomes field work", (Rna.member.m2 || {}).field === 24000, Rna.member.m2);

console.log("— mileage: $0.725/mi reimbursement, confirmed-only + period filter —");
const tc = [
  { id: "t1", userId: "m1", clockIn: "2026-06-10T09:00", clockOut: "2026-06-10T12:00", miles: 10, milesConfirmed: true, rate: 0.725 },
  { id: "t2", userId: "m1", clockIn: "2026-06-12T09:00", clockOut: "2026-06-12T11:00", computedMiles: 4.4, milesConfirmed: false },
  { id: "t3", userId: "m2", clockIn: "2026-06-15T09:00", clockOut: null, miles: 99 },          // open shift → excluded
  { id: "t4", userId: "m2", clockIn: "2026-05-30T09:00", clockOut: "2026-05-30T10:00", miles: 50, milesConfirmed: true }  // before period → excluded
];
const milAll = f.finMileage(tc, { from: "2026-06-01", to: "2026-06-30" });
ok("all-miles in June: m1 = 10mi(725¢)+4.4mi(319¢) = 1044¢, total 1044", milAll.perMember.m1 === 1044 && milAll.total === 1044 && !milAll.perMember.m2, milAll);
const milConf = f.finMileage(tc, { from: "2026-06-01", to: "2026-06-30", confirmedOnly: true });
ok("confirmed-only: just the confirmed 10mi = 725¢", milConf.perMember.m1 === 725 && milConf.total === 725, milConf);

console.log("— account funding + per-member payout —");
const acct = f.finAccounts(R.totals, milAll.total, 5000 /* $50 other expenses */);
ok("tax reserve = total tax; business fund net = inflow − mileage − expenses",
  acct.taxReserve === 500000 && acct.businessFundNet === 300000 - 1044 - 5000, acct);
const pay = f.finPayouts(R, milAll);
ok("m1 payout = field+sales+admin distribution + mileage", pay.m1.distribution === 485000 + 180000 && pay.m1.total === 485000 + 180000 + 1044, pay.m1);
ok("admin member appears with admin-only distribution", pay.admin1.distribution === 50000 && pay.admin1.mileage === 0, pay.admin1);

console.log("— hours-weighted field split (per-person earnings) —");
// $1000 field pool, crew m1+m2; m1 clocked 3h, m2 clocked 1h → m1 gets 750¢, m2 250¢
const w = f.finSplitWeighted(1000, ["m1", "m2"], { m1: 3, m2: 1 });
ok("weighted split 3h:1h of 1000¢ → m1 750, m2 250", w.perMember.m1 === 750 && w.perMember.m2 === 250, w.perMember);
ok("weighted split sums to the pool exactly (no cent invented/lost)", w.perMember.m1 + w.perMember.m2 === 1000, w);
const wNoHrs = f.finSplitWeighted(1001, ["m1", "m2"], {});   // nobody clocked → falls back to EQUAL
ok("no clocked hours → falls back to equal split (501/500), still sums to pool", wNoHrs.perMember.m1 + wNoHrs.perMember.m2 === 1001, wNoHrs.perMember);
let wleak = null;   // sweep: weighted split never leaks a cent across many pools/weights
for (let c = 0; c <= 5000; c += 7) { const x = f.finSplitWeighted(c, ["a", "b", "c"], { a: 2.5, b: 1.1, c: 0.4 }); const sum = x.perMember.a + x.perMember.b + x.perMember.c; if (sum !== c) { wleak = { c: c, x: x }; break; } }
ok("weighted split never leaks a cent across a sweep", wleak === null, wleak);

console.log("— finFieldSplit: EQUAL by default (byte-identical), share-weighted only when a weight ≠ 100 —");
// no weights → identical to finSplitEqual (the byte-identity guarantee for existing data)
const fsNone = f.finFieldSplit(1000, ["m1", "m2", "m3"], null);
const fsEqual = f.finSplitEqual(1000, ["m1", "m2", "m3"]);
ok("finFieldSplit with no weights === finSplitEqual (byte-identical)", JSON.stringify(fsNone) === JSON.stringify(fsEqual), fsNone);
// every member at the 100 default → still equal (not weighted path)
const fsAll100 = f.finFieldSplit(1000, ["m1", "m2", "m3"], { m1: 100, m2: 100, m3: 100 });
ok("finFieldSplit with all-100 weights === finSplitEqual (default is a no-op)", JSON.stringify(fsAll100) === JSON.stringify(fsEqual), fsAll100);
ok("finWeightsActive false when no weight is dialed off 100", f.finWeightsActive(["m1", "m2"], { m1: 100, m2: 100 }) === false);
ok("finWeightsActive true when a partial helper is dialed to 60", f.finWeightsActive(["m1", "m2"], { m1: 100, m2: 60 }) === true);
// partial helper: full members 100, helper 50 → helper gets half a full share ($1000 across 100+100+50=250 → 400/400/200)
const fsPartial = f.finFieldSplit(1000, ["m1", "m2", "h1"], { h1: 50 });   // m1/m2 default to 100
ok("partial helper at 50 → 400/400/200 of a $1000 field pool", fsPartial.perMember.m1 === 400 && fsPartial.perMember.m2 === 400 && fsPartial.perMember.h1 === 200, fsPartial.perMember);
ok("weighted field pool sums to the pool exactly", fsPartial.perMember.m1 + fsPartial.perMember.m2 + fsPartial.perMember.h1 === 1000, fsPartial.perMember);
// through finRollup: a job whose income carries weights splits the FIELD pool proportionally, pool preserved
const Rw = f.finRollup([{ id: "iw", jobId: "jw", date: "2026-06-10", amount: 1000, crew: ["m1", "h1"], weights: { h1: 50 } }], {});
const pjw = Rw.perJob[0];
ok("finRollup honors income.weights (helper h1 gets less field than m1)", pjw.field.m1 > pjw.field.h1, pjw.field);
ok("finRollup weighted field pool still sums to the job's field pool", pjw.field.m1 + pjw.field.h1 === pjw.fieldPool, { field: pjw.field, pool: pjw.fieldPool });
// a job with NO weights through finRollup is unchanged vs equal
const Rn = f.finRollup([{ id: "in", jobId: "jn", date: "2026-06-10", amount: 1000, crew: ["m1", "m2"] }], {});
ok("finRollup with no weights splits field equally (byte-identical path)", Rn.perJob[0].field.m1 === Rn.perJob[0].field.m2, Rn.perJob[0].field);

console.log("— per-person earnings RECONCILE to the pooled rollup —");
// reuse R (two $100 jobs, crew m1+m2, m1 originator, admin1) + a timeclock with uneven hours on job1
const tcHrs = [
  { id: "h1", userId: "m1", jobId: "j1", clockIn: 0, clockOut: 3 * 3600000, deleted: false },   // m1: 3h on j1 (hours are tracked/shown but no longer size the split)
  { id: "h2", userId: "m2", jobId: "j1", clockIn: 0, clockOut: 1 * 3600000, deleted: false },   // m2: 1h on j1
];
const hByJob = f.finHoursByJob(tcHrs, {});
ok("finHoursByJob keys by jobId then member, in hours", hByJob.j1.m1 === 3 && hByJob.j1.m2 === 1, hByJob);
const payouts = { m1: 12345 };   // m1 already got a $123.45 payout
const pp = f.finPerPerson(R, milAll, hByJob, payouts);
// reconciliation: sum of per-person field+sales+admin + unallocated === pooled labor distribution
const ppDist = pp.totals.field + pp.totals.sales + pp.totals.admin + pp.unallocatedField;
const poolDist = R.totals.field + R.totals.sales + R.totals.admin;
ok("Σ per-person (field+sales+admin) + unallocated === pooled labor distribution", ppDist === poolDist, { ppDist: ppDist, poolDist: poolDist });
ok("per-person field total === pooled field total (no cent moved out of the pool)", pp.totals.field === R.totals.field, { pp: pp.totals.field, pool: R.totals.field });
ok("m1 sales/admin come straight from the pooled engine", pp.member.m1.sales === R.member.m1.sales, pp.member.m1);
// Ray's call: EQUAL split regardless of hours — job1 pool 480,000¢ → 240,000 each; job2 pool 490,000¢ → 245,000 each
ok("m1 field = 240,000 (j1 equal) + 245,000 (j2 equal) = 485,000 — unaffected by 3h vs 1h", pp.member.m1.field === 485000, pp.member.m1.field);
ok("m2 field = 240,000 (j1 equal) + 245,000 (j2 equal) = 485,000 — same as m1 despite fewer hours", pp.member.m2.field === 485000, pp.member.m2.field);
ok("the two members' field still sums to the pooled field (970,000)", pp.member.m1.field + pp.member.m2.field === R.totals.field, [pp.member.m1.field, pp.member.m2.field, R.totals.field]);
ok("m1 earned = field+sales+admin; owed = earned + mileage − paid", pp.member.m1.earned === 485000 + 180000 && pp.member.m1.owed === 485000 + 180000 + 1044 - 12345, pp.member.m1);
ok("payout subtracted only from m1 (m2 unpaid)", pp.member.m2.paid === 0 && pp.member.m1.paid === 12345, { m1: pp.member.m1.paid, m2: pp.member.m2.paid });

/* ═══ SPLIT MODEL V2 — hard costs off the top, junk's sales share to the business ═══════════════════════
   Ray, 2026-09-09: "ideally, the business card always pays for the hard cost… the reimbursement thing was a
   Band Aid because the business had no money." The bug it names: V1 split the dump ticket as if it were
   profit, then the Business Fund bought it back — a $650 job left the fund holding $1.72.
   ⛔ NO PERCENTAGE MOVED. 25/15/60 and 80/15/5 are identical in both models; only the BASE changes. */
console.log("\n— split model V2: the cutoff date —");
ok("V2 is off before the cutoff", f.finSplitV2({ date: "2026-09-08" }) === false, f.FIN.HARDCOST_FROM);
ok("V2 is on from the cutoff day itself", f.finSplitV2({ date: "2026-09-09" }) === true, null);
ok("V2 is on after it", f.finSplitV2({ date: "2027-01-01" }) === true, null);
ok("a dateless income never silently flips model", f.finSplitV2({}) === false, null);

console.log("— the percentages did NOT change —");
ok("FIN still reads 25 / 15 / 60", f.FIN.TAX === 0.25 && f.FIN.BUSINESS === 0.15 && f.FIN.LABOR === 0.60, f.FIN);
ok("labor pool still reads 80 / 15 / 5", f.FIN.FIELD === 0.80 && f.FIN.SALES === 0.15 && f.FIN.ADMIN === 0.05, f.FIN);

console.log("— Ray's $650 median junk job, both models —");
/* $650 billed · $67.50 disposal + $28.28 mileage = $95.78 hard costs · no originator (ads found it) */
const HARD = 9578, JUNK = { id: "i-junk", amount: 650, crew: ["m1"], jobId: "j-junk", date: "2026-09-09" };
const OLD = Object.assign({}, JUNK, { id: "i-old", date: "2026-09-08" });
/* the P&L-layer helpers live in js/52 (DOM); stand them in exactly as the guards expect */
global.finHardCostsForIncome = inc => (inc && inc.jobId === "j-junk" ? HARD : 0);
global.finSalesToBusiness = inc => !!(inc && inc.jobId === "j-junk");
const v2 = f.finJobSplit(JUNK), v1 = f.finJobSplit(OLD);

ok("V1 splits the whole $650 — the dump ticket included", v1.amount === 65000 && v1.hardCostMode === "v1", v1.amount);
ok("V2 splits $554.22 — hard costs came off the top first", v2.amount === 65000 - HARD && v2.hardCostMode === "v2", v2.amount);
ok("V2 nets the FULL hard cost, not just materials", v2.passThrough === HARD, v2.passThrough);

ok("V1 field pool is $370.50 — 48% plus the unclaimed sales share rolled in",
  v1.fieldBeforeAdmin === 31200 + 5850, { field: v1.fieldBeforeAdmin, sales: v1.sales });
ok("V2 field pool is $266.03 — 48% of the real base, sales no longer rolled in",
  v2.fieldBeforeAdmin === v2.field, { field: v2.fieldBeforeAdmin, base: v2.amount });
/* ⚠️ NOT round(base × 0.60 × 0.80) — that is 26603 and it is WRONG by design. finSplitAmount assigns each
   level's rounding remainder to one bucket so tax+business+labor and field+sales+admin sum EXACTLY; the
   naive product re-rounds and invents a cent. The engine's answer is $266.02, and $266.03 in the tables
   is that number to the nearest cent of a naive 48%. Assert the discipline, not the shortcut. */
ok("...which is the quote tool's $45/hr floor: 48% of net, remainder-exact",
  v2.field === Math.round(v2.labor * 0.80) && Math.abs(v2.field - v2.amount * 0.48) <= 1,
  { field: v2.field, naive: Math.round(v2.amount * 0.48) });

ok("V1 leaves the business $97.50 — which the dump ticket then eats to $1.72",
  v1.business === 9750 && v1.business - HARD === 172, v1.business - HARD);
ok("V2 leaves the business $133.01, clear", v2.businessTotal === 8313 + 4988, v2.businessTotal);
ok("...because junk's unclaimed sales share funds the ads instead of the crew",
  v2.salesToBusiness === v2.sales && v1.salesToBusiness === 0, { v2: v2.salesToBusiness, v1: v1.salesToBusiness });

console.log("— the invariants that must survive a model change —");
ok("V2 still reconciles: tax + business + labor === base",
  v2.tax + v2.business + v2.labor === v2.amount, v2);
ok("V2 labor still reconciles: field + sales + admin === labor",
  v2.field + v2.sales + v2.admin === v2.labor, v2);
ok("⛔ salesToBusiness is NOT folded into business — that would break the reconciliation",
  v2.business === 8313 && v2.businessTotal === v2.business + v2.salesToBusiness, v2);
ok("nothing is invented or lost: hard costs + every bucket === what the customer paid",
  v2.passThrough + v2.tax + v2.business + v2.field + v2.sales + v2.admin === v2.gross,
  { sum: v2.passThrough + v2.tax + v2.business + v2.field + v2.sales + v2.admin, gross: v2.gross });

console.log("— a REAL originator still gets paid, on either model —");
const SOLD = Object.assign({}, JUNK, { id: "i-sold", originator: "m2", bookedAt: "2026-09-01" });
const sold = f.finJobSplit(SOLD);
ok("a person who actually sold the job keeps the sales credit", sold.salesToOriginator === sold.sales, sold);
ok("...and the business does NOT also take it", sold.salesToBusiness === 0, sold);

console.log("— ⛔⛔ HISTORY DOES NOT MOVE —");
/* finRollup recomputes every past entry on every render and stores nothing, so a model flip without a
   cutoff would rewrite what people were already paid. Chaz and Vlad's settled $398.43 must not budge. */
const PAST = [
  { id: "p1", amount: 1378, crew: ["m1", "m2"], jobId: "j-junk", date: "2026-06-11" },
  { id: "p2", amount: 2005, crew: ["m1"], jobId: "j-junk", date: "2026-07-14" }
];
const before = f.finRollup(PAST, {});
ok("every pre-cutoff entry stays on V1", before.perJob.every(p => p.split.hardCostMode === "v1"), before.perJob.map(p => p.split.hardCostMode));
ok("the split base is still the full gross — no hard costs retro-netted",
  before.totals.amount === f.finCents(1378) + f.finCents(2005), before.totals.amount);
ok("no historical sales share was moved to the business", before.totals.salesToBusiness === 0, before.totals);
ok("the old rollup still reconciles exactly",
  before.totals.tax + before.totals.business + before.totals.labor === before.totals.amount, before.totals);

console.log("— a mixed period splits cleanly at the date —");
const MIXED = f.finRollup(PAST.concat([JUNK]), {});
ok("one V1 model and one V2 in the same rollup", MIXED.perJob.filter(p => p.split.hardCostMode === "v2").length === 1, MIXED.perJob.map(p => p.split.hardCostMode));
ok("only the V2 entry contributes hard costs", MIXED.totals.passThrough === HARD, MIXED.totals.passThrough);
ok("only the V2 entry contributes a business sales share", MIXED.totals.salesToBusiness === v2.sales, MIXED.totals.salesToBusiness);
ok("businessTotal === business + salesToBusiness across the period",
  MIXED.totals.businessTotal === MIXED.totals.business + MIXED.totals.salesToBusiness, MIXED.totals);
ok("the mixed rollup still reconciles",
  MIXED.totals.tax + MIXED.totals.business + MIXED.totals.labor === MIXED.totals.amount, MIXED.totals);
delete global.finHardCostsForIncome; delete global.finSalesToBusiness;

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
