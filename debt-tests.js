/* debt-tests.js — the payoff simulation.

   His largest single leak is interest: $289/month on one card, ~$3,467/yr, on a balance that barely moved
   across seven months of statements. The Debts tab could already suggest an ORDER; it could not say how
   long, what it costs, or what one more $100 a month would do — which is the only part that changes a
   decision.

   WHAT THIS DEFENDS:

   1. ⭐ THE ARITHMETIC IS RIGHT. Checked against an independent payment calculator, not against itself.

   2. ⛔ IT SAYS "NEVER" WHEN THAT IS THE TRUTH. If the minimum is smaller than the monthly interest the
      balance grows forever — the real situation on a card at 97-100% utilisation. And a stalled plan
      reports NO interest total: running the loop to its 600-month cap accumulated $3.5 BILLION on his
      Visa, a number that reads as a bug and poisons every comparison it touches.

   3. ⚠️ A PROMO RATE EXPIRES. His Citi is 0% until 2026-09-24 and 28.24% after. Assuming 0% forever
      understated the plan by $2,912 and ranked that card LAST as it became his most expensive.

   Pure node. Run: node debt-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
function near(n, g, w, tol) { ok(n, Math.abs(g - w) <= tol, "got " + g + " want ~" + w + " ±" + tol); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SRC = R("js/147-debt-payoff.js"), BUD = R("js/79-budget.js"), SHELL = R("Business App (v1).html");
const START = "2026-08-25";

function sandbox(accounts) {
  const store = { p: { budgetAccounts: accounts || [], budgetTx: [], budgetCats: [], budgetBooks: [] } };
  const ctx = {
    console, S: store, BIZ: "p", today: () => START, window: {},
    esc: s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    budgetMoney: n => "$" + (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    budgetAccountBalance: a => +a.balance || 0
  };
  ctx.D = () => store.p;
  vm.createContext(ctx); vm.runInContext(SRC, ctx); Object.assign(ctx, ctx.window);
  return ctx;
}
const c = sandbox([]);
const sim = (debts, o) => c.debtSimulate(debts, Object.assign({ start: START }, o || {}));

console.log("\n--- ⭐ 1. the arithmetic, against an independent calculator ---");
{
  /* $10,000 at 12% APR paying $200/month → 70 months, about $3,958 of interest */
  const r = sim([{ id: "x", name: "Card", balance: 10000, apr: 12, minPayment: 200 }], { strategy: "min" });
  eq("70 months, same as a payment calculator", r.months, 70);
  near("...and the interest agrees within rounding", r.totalInterest, 3958, 40);

  /* zero interest is exact and easy to check by hand */
  const z = sim([{ id: "z", name: "Free", balance: 1200, apr: 0, minPayment: 100 }], { strategy: "min" });
  eq("at 0% it's just division", z.months, 12);
  eq("...with no interest at all", z.totalInterest, 0);

  eq("a debt already at zero needs no plan", sim([{ id: "q", name: "x", balance: 0, apr: 20, minPayment: 50 }], { strategy: "min" }).months, 0);
  eq("no debts at all is not an error", sim([], { strategy: "min" }).months, 0);
  ok("a final payment never overshoots into credit",
    sim([{ id: "p", name: "x", balance: 250, apr: 0, minPayment: 100 }], { strategy: "min" }).perDebt[0].stillOwing === 0);
}

console.log("\n--- ⭐ the rollover is what makes a payoff plan work ---");
{
  const debts = [{ id: "a", name: "Small", balance: 500, apr: 0, minPayment: 100 },
                 { id: "b", name: "Big", balance: 2000, apr: 0, minPayment: 100 }];
  const minOnly = sim(debts, { strategy: "min" });
  const rolled = sim(debts, { strategy: "snowball" });
  eq("minimums alone: the big one takes 20 months", minOnly.months, 20);
  ok("⭐ rolling the cleared minimum onto the next finishes sooner", rolled.months < minOnly.months, { minOnly: minOnly.months, rolled: rolled.months });
  eq("...13 months, because $200/mo attacks what's left", rolled.months, 13);
  ok("the mechanism is written down, not assumed", /ROLLOVER/.test(SRC));
}

console.log("\n--- ⛔ 2. it says never, and reports no fictional total ---");
{
  /* his real Visa: $24,400 at 14.15% is $288/month of interest — a $250 minimum never catches it */
  const r = sim([{ id: "v", name: "Visa", balance: 24400, apr: 14.15, minPayment: 250 }], { strategy: "min" });
  ok("⭐ a minimum below the interest never clears", r.stalled);
  eq("...months is null, not a made-up date", r.months, null);
  eq("...and the payoff date is null", r.payoffIso, null);
  eq("⛔ ...and there is NO interest total — 600 months of compounding made $3.5bn", r.totalInterest, null);
  ok("...the debt is named, so he knows which one", r.stalledOn.join() === "Visa");
  ok("the raw figure is kept out of the way for debugging only", typeof r.rawInterest === "number");
  ok("the reason is recorded where the next person would 'fix' it", /3\.5 BILLION/.test(SRC));

  /* one more dollar a month than the interest, and it finishes */
  const fixed = sim([{ id: "v", name: "Visa", balance: 24400, apr: 14.15, minPayment: 530 }], { strategy: "min" });
  ok("⭐ a payment above the interest does clear", !fixed.stalled && fixed.months > 0, fixed.months);

  /* ⛔ and nothing downstream does arithmetic on the null */
  const cc = sandbox([{ id: "v", type: "credit", name: "Visa", balance: -24400, apr: 14.15, minPayment: 250, deleted: false }]);
  const cmp = cc.debtCompare(0);
  eq("a comparison against a stalled plan reports no saving rather than NaN", cmp.interestSaved, null);
  const html = cc.debtPlanHTML();
  ok("⛔ no NaN, no $null, no billions on screen", !/NaN|null|3,501/.test(html), html.slice(0, 300));
  ok("⭐ ...it says plainly that the minimums never clear it", /never clears/.test(html));
  ok("...and that the payment has to go up", /payment has to go up/.test(html) || /interest is\s+bigger/.test(html));
}

console.log("\n--- ⚠️ 3. a promo rate expires, and his is about to ---");
{
  const citi = { id: "c", name: "Citi", balance: 4200, apr: 28.24, minPayment: 25, promoUntil: "2026-09-24", promoApr: 0 };
  eq("during the promo the rate is the promo rate", c.debtRateOn(citi, "2026-09-01"), 0);
  eq("on the last day it is still the promo rate", c.debtRateOn(citi, "2026-09-24"), 0);
  eq("⭐ the day after, it is the real rate", c.debtRateOn(citi, "2026-09-25"), 28.24);
  eq("a card with no promo just uses its APR", c.debtRateOn({ apr: 19.99 }, "2026-09-25"), 19.99);

  const real = sim([citi], { strategy: "min", extra: 0 });
  const pretend = sim([{ id: "c", name: "Citi", balance: 4200, apr: 0, minPayment: 25 }], { strategy: "min" });
  ok("⛔ assuming 0% forever gives a different, wrong answer",
    real.stalled !== pretend.stalled || real.totalInterest !== pretend.totalInterest);
  ok("⭐ ...and reality is the worse one", real.stalled || (real.totalInterest > (pretend.totalInterest || 0)));

  /* it must also change the ORDER — the point of the whole feature */
  const debts = [citi, { id: "v", name: "Visa", balance: 4200, apr: 14.15, minPayment: 25 }];
  const after = debts.slice().sort((a, b) => c.debtRateOn(b, "2026-10-01") - c.debtRateOn(a, "2026-10-01"));
  eq("⭐ after the promo ends, Citi is the most expensive card he owns", after[0].name, "Citi");
  const before = debts.slice().sort((a, b) => c.debtRateOn(b, "2026-09-01") - c.debtRateOn(a, "2026-09-01"));
  eq("...and before it ends, it is the cheapest", before[0].name, "Visa");

  const warn = sandbox([{ id: "c", type: "credit", name: "Citi Simplicity", balance: -4200, apr: 28.24,
    minPayment: 25, promoUntil: "2026-09-24", promoApr: 0, deleted: false }]);
  const w = warn.debtPromoWarnings(60);
  eq("⭐ an expiring promo is surfaced", w.length, 1);
  eq("...counted in days", w[0].days, 30);
  ok("...with the rate it becomes", w[0].to === 28.24 && w[0].from === 0);
  ok("the warning says what it will cost per month", /a month in interest/.test(warn.debtPromoHTML()));
  eq("⛔ a promo far out is not shouted about yet", warn.debtPromoWarnings(10).length, 0);
  ok("⛔ a card whose promo is WORSE than its APR isn't a warning",
    sandbox([{ id: "z", type: "credit", name: "Odd", balance: -100, apr: 0, minPayment: 5,
      promoUntil: "2026-09-24", promoApr: 20, deleted: false }]).debtPromoWarnings(60).length === 0);
}

console.log("\n--- avalanche vs snowball, on his real card terms ---");
{
  /* APRs are his, from his own bill notes; balances are illustrative */
  const debts = [
    { id: "visa", name: "Visa", balance: 24400, apr: 14.15, minPayment: 530 },
    { id: "disc", name: "Discover", balance: 9600, apr: 24.6, minPayment: 215 },
    { id: "citi", name: "Citi", balance: 4200, apr: 28.24, minPayment: 25, promoUntil: "2026-09-24", promoApr: 0 }
  ];
  const a0 = sim(debts, { strategy: "avalanche", extra: 0 });
  const a2 = sim(debts, { strategy: "avalanche", extra: 200 });
  ok("both plans finish", !a0.stalled && !a2.stalled);
  ok("⭐ $200/month more finishes sooner", a2.months < a0.months, { a0: a0.months, a2: a2.months });
  ok("⭐ ...and costs less in interest", a2.totalInterest < a0.totalInterest,
    { a0: a0.totalInterest, a2: a2.totalInterest });

  const s2 = sim(debts, { strategy: "snowball", extra: 200 });
  ok("snowball also finishes", !s2.stalled);
  /* ⚠️ avalanche is usually cheaper but NOT always — the card picks whichever actually is */
  ok("⭐ the card picks by cost, not by dogma", /ai <= si \? c\.avalanche : c\.snowball/.test(CODE(SRC)));
  ok("...and a stalled plan can never win that comparison", /si == null \? c\.avalanche/.test(CODE(SRC)));

  const extraCard = sandbox(debts.map(d => ({ id: d.id, type: "credit", name: d.name, balance: -d.balance,
    apr: d.apr, minPayment: d.minPayment, promoUntil: d.promoUntil, promoApr: d.promoApr, deleted: false })));
  const html = extraCard.debtPlanHTML();
  /* ⭐ and it SHOWS both, because on his real card terms snowball came out $9 ahead of avalanche — the
     interaction of minimums, balances and a promo expiry beats any rule of thumb */
  ok("⭐ both strategies are shown, not just the winner",
    /Highest rate first/.test(html) && /Smallest balance first/.test(html), html.slice(0, 240));
  ok("...the cheaper one is emphasised", /font-weight:700/.test(html));
  ok("⛔ a long label wraps instead of truncating", /white-space:normal/.test(html));
  ok("the card offers the extra-payment lever", /debtSetExtra\(200\)/.test(html));
  ok("...and shows the payoff order by rate", /Order:/.test(html));
  ok("...naming a saving only when there is one", !/Saves \$0\.00/.test(html));
}

console.log("\n--- durations read like a person would say them ---");
{
  eq("under a year, months", c.debtDur(7), "7 months");
  eq("exactly a year", c.debtDur(12), "1 yr");
  eq("a year and a bit", c.debtDur(14), "1 yr 2 mo");
  eq("years", c.debtDur(36), "3 yrs");
  eq("⛔ never is never, not 'Infinity months'", c.debtDur(null), "never");
  eq("nothing owed", c.debtDur(0), "already clear");
}

console.log("\n--- wiring ---");
{
  ok("the module is in the shell", /js\/147-debt-payoff\.js/.test(SHELL));
  ok("...after the balance derivation it reads", SHELL.indexOf("145-reconcile") < SHELL.indexOf("147-debt-payoff"));
  ok("⭐ the plan and the promo warning are on the Debts tab", /debtPlanHTML/.test(CODE(BUD)) && /debtPromoHTML/.test(CODE(BUD)));
  ok("...above the existing ordering advice, which it explains", CODE(BUD).indexOf("debtPlanHTML") < CODE(BUD).indexOf("Payoff order"));
  ok("⭐ a promo rate can actually be entered", /ba_promountil/.test(BUD) && /ba_promoapr/.test(BUD));
  ok("...and saved", /a\.promoUntil=val\("ba_promountil"\)/.test(CODE(BUD)));
  ok("⛔ ...and cleared when an account stops being a credit card", /a\.promoUntil=""; a\.promoApr=""/.test(CODE(BUD)));
  ok("⭐ balances come from the derived figure, not a stale typed one", /budgetAccountBalance/.test(CODE(SRC)));
  ok("it never writes — a planner that mutates accounts is how a balance gets lost",
    !/\.push\(|save\(\)|touch\(/.test(CODE(SRC)));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
