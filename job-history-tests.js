/* job-history-tests.js — the Job History list (js/174) reconciles to the split engine and reads right.
   Pure node: runs the REAL js/39 engine on a small income set, hands its perJob to jhBuildRows with stub lookups,
   and asserts every row's money sums back to what was billed, names/dates/types resolve, filters and CSV work.
   Run: node job-history-tests.js → 0 failed (exit 0). Touches nothing real. */
const f = require("./js/39-finance-core");
const jh = require("./js/174-job-history");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } };

const income = [
  { id: "i1", jobId: "j1", quoteId: "q1", date: "2026-06-22", amount: 960, originator: "ray", bookedAt: "2026-06-20", crew: ["ray", "chase", "pierce"] },
  { id: "i2", jobId: "j2", quoteId: "q2", date: "2026-07-14", amount: 600, originator: "", bookedAt: "", crew: ["ray", "chase"], weights: { ray: 100, chase: 60 } },
  { id: "i3", jobId: "", quoteId: "q3", date: "2026-09-14", amount: 475, originator: "ray", bookedAt: "2026-09-14", crew: [] }
];
const jobs = { j1: { id: "j1", title: "Junk / move-out — 5 items", customerId: "c1", quoteId: "q1", date: "2026-06-22", workDays: ["2026-06-22"] },
               j2: { id: "j2", title: "Shed demo", customerId: "c2", quoteId: "q2", date: "2026-07-11", workDays: ["2026-06-22", "2026-07-11"] } };
const quotes = { q1: { id: "q1", cust: "Michelle Brown", items: [{ name: "Junk haul" }] }, q2: { id: "q2", cust: "Mike Green", items: [{ name: "Shed demolition" }, { name: "Haul-off" }] }, q3: { id: "q3", cust: "Emma", title: "Junk haul", items: [{ name: "Junk haul" }] } };
const names = { ray: "Rj", chase: "Chase", pierce: "Pierce" };
const L = { income: id => income.find(x => x.id === id), job: id => jobs[id], quote: id => quotes[id], custName: () => "", name: id => names[id],
            type: q => q.items[0].name + (q.items.length > 1 ? " +" + (q.items.length - 1) : ""), workDays: j => (j.workDays || [j.date]).slice().sort() };
const roll = f.finRollup(income.map(x => Object.assign({ _noPT: true }, x)), { adminMemberId: "ray" });
const hours = f.finHoursByJob([{ id: "h1", userId: "chase", jobId: "j1", clockIn: 0, clockOut: 2.5 * 3600000 }]);
const rows = jh.jhBuildRows(roll.perJob, hours, "ray", L);

console.log("— rows resolve names, dates, types, customers —");
ok("one row per income entry, newest paid first", rows.length === 3 && rows[0].id === "i3" && rows[2].id === "i1", rows.map(r => r.id));
const r1 = rows.find(r => r.id === "i1"), r2 = rows.find(r => r.id === "i2"), r3 = rows.find(r => r.id === "i3");
ok("title from the job, type from the quote, customer from the quote", r1.title === "Junk / move-out — 5 items" && r1.type === "Junk haul" && r1.cust === "Michelle Brown", [r1.title, r1.type, r1.cust]);
ok("multi-day job carries every work day", r2.days.join(",") === "2026-06-22,2026-07-11", r2.days);
ok("job-less income falls back to the paid date + quote title", r3.days.join() === "2026-09-14" && r3.title === "Junk haul" && r3.jobId === "", [r3.days, r3.title]);
ok("crew names + clocked hours resolve", r1.crew.length === 3 && r1.crew.every(c => /^(Rj|Chase|Pierce)$/.test(c.name)) && r1.crew.find(c => c.id === "chase").hours === 2.5, r1.crew);
ok("share weights surface (Chase 60%)", r2.crew.find(c => c.id === "chase").weight === 60 && r2.crew.find(c => c.id === "ray").weight === 100, r2.crew);

console.log("— every dollar billed lands somewhere: hard + tax + business + crew + unassigned = billed —");
rows.forEach(r => {
  const sum = r.hard + r.tax + r.business + r.crewTotal + r.unallocated;
  ok(r.id + ": " + r.gross + " = hard " + r.hard + " + tax " + r.tax + " + biz " + r.business + " + crew " + r.crewTotal + " + unassigned " + r.unallocated, sum === r.gross, sum);
});
ok("i1 sales credit goes to the originator (Rj, 15% of labor)", r1.salesTo && r1.salesTo.name === "Rj" && r1.salesTo.cents === Math.round(96000 * 0.60 * 0.15), r1.salesTo);
ok("i1 admin goes to the Admin Member (Rj)", r1.adminTo && r1.adminTo.name === "Rj" && r1.adminTo.cents > 0, r1.adminTo);
ok("i3 (no crew) shows the whole field pool as unassigned", r3.crew.length === 0 && r3.unallocated === r3.fieldPool && r3.fieldPool > 0, [r3.unallocated, r3.fieldPool]);
ok("per-person shares match the engine byte-for-byte", r1.crew.every(c => c.cents === roll.perJob.find(p => p.id === "i1").field[c.id]));
const totals = jh.jhTotals(rows);
ok("totals reconcile to the rollup (business kept = business + salesToBusiness)", totals.gross === roll.totals.gross && totals.tax === roll.totals.tax && totals.business === roll.totals.businessTotal, [totals, roll.totals]);

console.log("— filters —");
ok("year filter", jh.jhFilter(rows, { year: "2026" }).length === 3 && jh.jhFilter(rows, { year: "2025" }).length === 0);
ok("type filter", jh.jhFilter(rows, { type: "Shed demolition +1" }).map(r => r.id).join() === "i2");
ok("person filter (Pierce only on i1; Rj on all three via crew/sales/admin)", jh.jhFilter(rows, { who: "pierce" }).map(r => r.id).join() === "i1" && jh.jhFilter(rows, { who: "ray" }).length === 3);

console.log("— CSV —");
const csv = jh.jhBuildCSV(rows);
const lines = csv.split("\n");
ok("header + one line per row", lines.length === 4 && /^Paid,Work days,Job,Type,Customer,Billed/.test(lines[0]), lines[0]);
ok("the title with a comma/dash is quoted safely and the crew column reads 'Name $x (60%)'", /"Junk \/ move-out — 5 items"/.test(csv) === false && /Chase \$[0-9.]+ \(60%\)/.test(csv), csv);
ok("dates label: single / pair / range", jh.jhDaysLabel(["a"]) === "a" && jh.jhDaysLabel(["a", "b"]) === "a + b" && jh.jhDaysLabel(["a", "b", "c"]) === "a → c (3 days)");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
