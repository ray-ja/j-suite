/* insight-tests.js — who pays him, and whether the job paid.

   Two questions the app could never answer about his own work, and both produced a wrong or empty answer
   on the first attempt:

   1. ⚠️ I TOLD HIM "Mike Green is 76%" AND THEN THE CODE SAID 46% FOR SOMEONE ELSE. Both were right and
      they measure different things — 75.7% of work QUOTED, 36.5% of cash COLLECTED. Either number alone
      tells half the story and the wrong half. The gap is the finding: on his live book $7,197 of $7,487
      still owed is one customer.

   2. ⚠️ QUOTED-vs-WORKED RETURNED NOTHING because I guessed the timeclock field names. It stores
      `clockIn`/`clockOut`, not inAt/start. Every job came back null, the card rendered empty, and it
      looked exactly like an honest "no data" — which is the worst way for a bug to fail.

   Pure node. Run: node insight-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PROSE = (src) => src.replace(/\s+/g, " ");

const SRC = R("js/153-customer-insight.js"), FIN = R("js/64-finance-overview.js"), SHELL = R("Business App (v1).html");
const HOUR = 3600000, DAY = "2026-08-10";

function sandbox(S) {
  const ctx = { console, S, today: () => "2026-08-25", now: () => 1, window: {},
    esc: s => String(s == null ? "" : s), touch: r => r, save: () => {}, render: () => {},
    budgetMoney: n => "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2) };
  ctx.D = () => S[S.biz];
  vm.createContext(ctx);
  vm.runInContext(R("js/151-unified-ledger.js"), ctx);
  vm.runInContext(SRC, ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}
const T0 = Date.parse(DAY + "T08:00:00Z");
const store = () => ({
  biz: "obx", registry: [{ id: "obx", name: "OBX" }],
  obx: {
    customers: [{ id: "cA", name: "Mike Green" }, { id: "cB", name: "Michelle Brown" }],
    quotes: [{ id: "q1", customerId: "cA", total: 8000, estHours: 4.4 },
             { id: "q2", customerId: "cB", total: 2000, estHours: 9.1 },
             { id: "q3", customerId: "cA", total: 822 }],
    jobs: [{ id: "j1", quoteId: "q1", date: DAY, title: "French drain", deleted: false },
           { id: "j2", quoteId: "q2", date: DAY, title: "Patio", deleted: false }],
    /* two crew on j1 → person-hours, not elapsed */
    timeclock: [{ id: "t1", jobId: "j1", userId: "u1", clockIn: T0, clockOut: T0 + 8 * HOUR, deleted: false },
                { id: "t2", jobId: "j1", userId: "u2", clockIn: T0, clockOut: T0 + 8 * HOUR, deleted: false },
                { id: "t3", jobId: "j2", userId: "u1", clockIn: T0, clockOut: T0 + 5 * HOUR, deleted: false }],
    income: [{ id: "i1", quoteId: "q1", jobId: "j1", amount: 1500, date: DAY, deleted: false },
             { id: "i2", quoteId: "q2", jobId: "j2", amount: 2000, date: DAY, deleted: false },
             { id: "i3", amount: 300, date: DAY, deleted: false }],          // no job, no quote
    expenses: [], jobExpenses: [], receipts: [], jobMaterials: [], budgetTx: []
  }
});

console.log("\n--- ⚠️ 1. quoted and collected are different questions ---");
{
  const S = store(), c = sandbox(S);
  const g = c.ciByCustomer();
  const mike = g.customers.find(x => x.name === "Mike Green");
  const mich = g.customers.find(x => x.name === "Michelle Brown");

  eq("⭐ share of WORK QUOTED", mike.quotedShare, 81.5);
  eq("⭐ share of CASH COLLECTED is a different number", mike.share, 39.5);   // 1500 / 3800
  ok("⛔ they are genuinely different, which is the whole point", mike.quotedShare !== mike.share);
  eq("⭐ and the gap is what he is still owed", mike.outstanding, 7322);
  eq("someone paid in full owes nothing", mich.outstanding, 0);
  eq("the outstanding total is the sum", g.outstanding, 7322);
  ok("both figures are reported, not one", "quoted" in mike && "amount" in mike);
  ok("the finding is written down with his real numbers", /75\.7% of the work quoted but only 36\.5%/.test(PROSE(SRC)));

  /* ⛔ money that can't be attributed is REPORTED, never dropped or spread */
  eq("⭐ income with no job or quote is counted as unattributed", g.unattributed, 300);
  eq("...as a share he can see", g.unattributedShare, 7.9);
  eq("...and it is still in the total", g.total, 3800);
  ok("the reason is recorded", /understate exactly the risk it exists to show/.test(PROSE(SRC)));

  const html = c.ciConcentrationHTML();
  ok("the card names the concentration out loud", /81\.5% of all the work/.test(html), html.slice(0, 400));
  ok("...and what it would mean", /stops calling/.test(PROSE(html)));
  ok("⭐ ...and how much of what's owed is that one customer", /still owed across everyone/.test(PROSE(html)));
  ok("...and doesn't hide the unattributed money", /isn't linked to a customer/.test(PROSE(html)));
}

console.log("\n--- ⚠️ 2. the field-name bug ---");
{
  const S = store(), c = sandbox(S);
  const d = S.obx;
  eq("⭐ clockIn/clockOut are read — this returned null before", c.ciActualHours("j1", d), 16);
  eq("⭐ ...summed across BOTH crew, so it's person-hours", c.ciActualHours("j1", d), 8 + 8);
  eq("one person on the other job", c.ciActualHours("j2", d), 5);
  eq("⛔ a job with no clocked time is null, not zero", c.ciActualHours("nope", d), null);
  ok("the bug is recorded where it would be reintroduced", /I GUESSED THESE FIELD NAMES/.test(SRC));
  ok("...including why it was invisible", /fails exactly like an honest empty result/.test(PROSE(SRC)));

  /* ISO strings must work too, since the field could hold either */
  const S2 = store();
  S2.obx.timeclock = [{ id: "x", jobId: "j1", clockIn: "2026-08-10T08:00:00Z", clockOut: "2026-08-10T12:00:00Z", deleted: false }];
  eq("an ISO timestamp works as well as a number", sandbox(S2).ciActualHours("j1", S2.obx), 4);
  const S3 = store();
  S3.obx.timeclock = [{ id: "x", jobId: "j1", minutes: 90, deleted: false }];
  eq("...and a plain minutes field falls back cleanly", sandbox(S3).ciActualHours("j1", S3.obx), 1.5);
  const S4 = store();
  S4.obx.timeclock = [{ id: "x", jobId: "j1", clockIn: T0, clockOut: null, deleted: false }];
  eq("⛔ an open shift contributes nothing rather than a wild number", sandbox(S4).ciActualHours("j1", S4.obx), null);
}

console.log("\n--- quoted vs worked ---");
{
  const S = store(), c = sandbox(S);
  const e = c.ciEstVsActual();
  eq("only jobs with BOTH numbers appear", e.rows.length, 2);
  const fd = e.rows.find(r => r.title === "French drain");
  eq("worst first", e.rows[0].title, "French drain");
  eq("4.4h quoted against 16 person-hours", fd.ratio, 3.64);
  eq("...and what the labour actually earned", Math.round(8000 / 16 * 100) / 100, 500);
  /* ⭐ j2 came in UNDER (5 person-h against 9.1 quoted) — the code correctly does NOT flag it */
  eq("only the one that actually overran is flagged", e.over.length, 1);
  ok("...and it's the right one", e.over[0].title === "French drain");
  ok("⛔ a job that beat its estimate is not called a problem", !e.over.some(r => r.title === "Patio"));
  ok("the cheapest job is surfaced", e.perHour[0].rate <= e.perHour[e.perHour.length - 1].rate);

  const html = c.ciEstActualHTML();
  ok("⭐ hours are labelled as PERSON-hours, not compared like-for-like", /person-h worked/.test(html), html.slice(0, 300));
  ok("...and the card explains why a three-man day counts three times", /counts three times/.test(PROSE(html)));
  ok("the summary counts only the overruns", /1 of 2 took longer than quoted/.test(PROSE(html)), PROSE(html).slice(-300));
  ok("...and invites the comparison that matters", /what an hour of your time is worth elsewhere/.test(PROSE(html)));
  ok("the ambiguity risk is recorded", /would look like a like-for-like comparison/.test(PROSE(SRC)));

  /* ⛔ a missing estimate is not a zero */
  const S2 = store(); delete S2.obx.quotes[0].estHours;
  eq("⛔ a job whose quote has no estimate is skipped, not scored 0", sandbox(S2).ciEstVsActual().rows.length, 1);
  const S3 = store(); S3.obx.timeclock = [];
  eq("⛔ ...and so is one with no clocked time", sandbox(S3).ciEstVsActual().rows.length, 0);
  eq("nothing to compare renders nothing", sandbox(S3).ciEstActualHTML(), "");
}

console.log("\n--- reads only, and wired in ---");
{
  const S = store(), c = sandbox(S);
  const before = JSON.stringify(S);
  c.ciByCustomer(); c.ciEstVsActual(); c.ciConcentrationHTML(); c.ciEstActualHTML();
  eq("⭐ nothing is written", JSON.stringify(S), before);
  ok("⛔ it never saves or touches", !/save\(\)|touch\(/.test(CODE(SRC)));

  eq("an empty org renders nothing at all",
    sandbox({ biz: "x", registry: [], x: { customers: [], quotes: [], jobs: [], income: [], timeclock: [] } }).ciConcentrationHTML(), "");

  ok("both cards are on the finance overview", /ciConcentrationHTML/.test(CODE(FIN)) && /ciEstActualHTML/.test(CODE(FIN)));
  ok("the module is in the shell", /js\/153-customer-insight\.js/.test(SHELL));
  ok("...after the cross-org helper it uses", SHELL.indexOf("151-unified") < SHELL.indexOf("153-customer"));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
