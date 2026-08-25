/* cashflow-tests.js — derived balances by reconciliation, and the cash-flow forecast.

   Ray, 2026-08-25: "instead of me setting the balance for my accounts, i want to be able to link them"
   … and "prioritize what is most useful to us, you know our businesses."

   WHAT THIS DEFENDS:

   1. ⭐ A BALANCE IS DERIVED, NOT TYPED. checkpoint + every approved transaction since. A balance you type
      is stale the moment you type it, which is why all three of his accounts sat at $0.

   2. ⚠️ AND IT CHANGES NOTHING UNTIL HE RECONCILES. Fourteen call sites read budgetAccountBalance().
      An account with no checkpoint must behave exactly as it did before, or To-Be-Budgeted, every
      envelope and every cash total move in one commit.

   3. ⭐ THE FORECAST WAS WRONG TWICE, BOTH TIMES BY UNDER-COUNTING HIS INCOME — and both times it was
      ready to tell him he runs out of money on a specific date that wasn't real. Measured against his
      own six full months, not reasoned about:
         payee-grouping        → $4,727/mo vs actual $10,245  (his $36k "Business draw" invisible)
         + description filter  → $4,310/mo  (the draw is literally described "Transfer From Checking")
         category wins         → $10,227/mo — within 0.2%
      These assertions exist so nobody re-introduces either filter.

   4. ⛔ NO STARTING BALANCE, NO FORECAST. Every account reads zero today; projecting from $0 would
      announce he runs out today, on the screen he reads every morning.

   Pure node. Run: node cashflow-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const REC = R("js/145-reconcile.js"), CF = R("js/146-cashflow.js"), BUD = R("js/79-budget.js");
const MC = R("js/142-money-card.js"), SHELL = R("Business App (v1).html");
const TODAY = "2026-08-25";

function sandbox(store) {
  const ctx = {
    console, S: store, BIZ: "p", BUDGET_BOOK: "__all__", BUDGET_MONTH: "2026-08",
    today: () => TODAY, now: () => 1700000000000, uid: () => "u" + (ctx._n = (ctx._n || 0) + 1),
    esc: s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    touch: r => { r.updatedAt = 1; return r; }, save: () => {}, render: () => {}, alert: () => {},
    document: { getElementById: () => null }, window: {}
  };
  ctx.D = () => store.p;
  vm.createContext(ctx);
  const i = BUD.indexOf("function actBudgetBooks"), j = BUD.indexOf("/* ---------- main render");
  vm.runInContext(BUD.slice(i, j), ctx);
  [R("js/126-calendar.js"), R("js/143-ledger.js"), REC, CF].forEach(src => vm.runInContext(src, ctx));
  Object.assign(ctx, ctx.window);
  return ctx;
}
const base = () => ({ p: {
  budgetBooks: [{ id: "bk", name: "Personal" }],
  budgetCats: [{ id: "c_draw", bookId: "bk", name: "Business draw", kind: "in" },
               { id: "c_rent", bookId: "bk", name: "Rent received", kind: "in" },
               { id: "c_food", bookId: "bk", name: "Groceries", kind: "out" },
               { id: "c_xfer", bookId: "bk", name: "Transfers", kind: "in" }],
  budgetAccounts: [{ id: "a_chk", bookId: "bk", name: "Checking", type: "checking", balance: 0 },
                   { id: "a_visa", bookId: "bk", name: "Visa", type: "credit", balance: -1000 }],
  budgetTx: [], budgetBills: [], budgetMemo: [], budgetBudgets: []
} });
const tx = (o) => Object.assign({ id: "t" + Math.random().toString(36).slice(2, 8), bookId: "bk", accountId: "a_chk",
  date: "2026-08-01", dir: "out", amount: 100, note: "x", catId: "", deleted: false }, o);

console.log("\n--- ⭐ 1. a balance is derived from a checkpoint ---");
{
  const st = base(), c = sandbox(st);
  st.p.budgetTx.push(tx({ date: "2026-08-02", dir: "out", amount: 200 }),
                     tx({ date: "2026-08-05", dir: "in", amount: 50 }),
                     tx({ date: "2026-09-01", dir: "out", amount: 999 }));   // after today — not yet
  const a = st.p.budgetAccounts[0];

  /* ⚠️ 2. NOTHING CHANGES UNTIL HE RECONCILES */
  eq("⚠️ with no checkpoint, the balance behaves exactly as it always did", c.budgetAccountBalance(a), 0);
  ok("...and the derived branch is guarded on balanceDate", /a\.balanceDate&&typeof acctBalanceAt/.test(CODE(BUD)));
  ok("⛔ ...and is not derived", !c.acctIsDerived(a));

  c.reconcileApply("a_chk", "2026-08-01", 1000);
  ok("⭐ now it is derived", c.acctIsDerived(a));
  eq("⭐ checkpoint + everything since = the live balance", c.budgetAccountBalance(a), 850);
  eq("...and acctLive agrees with the function the whole budget calls", c.acctLive(a), c.budgetAccountBalance(a));
  eq("⭐ a future transaction is not spent yet", c.acctBalanceAt(a, "2026-08-31"), 850);
  eq("...but it lands when its day comes", c.acctBalanceAt(a, "2026-09-30"), -149);
  eq("a date before the checkpoint is just the checkpoint", c.acctBalanceAt(a, "2026-07-01"), 1000);
  eq("transactions on the checkpoint day are already inside it", c.acctSinceCheckpoint(a).length, 3);

  /* ⚠️ pending rows are not money yet (js/143) */
  st.p.budgetTx.push(tx({ date: "2026-08-06", dir: "out", amount: 500, pending: true }));
  eq("⭐ an unapproved transaction does not move the balance", c.budgetAccountBalance(a), 850);

  /* ⚠️ A BALANCE COUNTS TRANSFERS. Income and spending don't — the classic ledger bug. */
  st.p.budgetTx.push(tx({ date: "2026-08-07", dir: "out", amount: 300, isTransfer: true }));
  eq("⭐ a transfer OUT still reduces this account's balance", c.budgetAccountBalance(a), 550);
  eq("...even though it is not spending", c.actBudgetTx().filter(t => t.isTransfer).length, 0);
  ok("...and the reason is written down", /A BALANCE COUNTS TRANSFERS/.test(REC));
}

console.log("\n--- reconciling against a statement ---");
{
  const st = base(), c = sandbox(st);
  st.p.budgetTx.push(tx({ date: "2026-08-02", dir: "out", amount: 200 }));
  const a = st.p.budgetAccounts[0];
  c.reconcileApply("a_chk", "2026-08-01", 1000);

  const good = c.reconcilePreview(a, "2026-08-10", 800);
  ok("⭐ a statement that agrees is flagged as matching", good.matched, good);
  eq("...with no difference", good.difference, 0);

  const gap = c.reconcilePreview(a, "2026-08-10", 950);
  ok("⭐ a statement that disagrees is NOT quietly accepted", !gap.matched);
  eq("⭐ ...and the difference is the interesting number: money the app doesn't know about", gap.difference, 150);
  ok("...the dialog says which direction, in plain words", /never recorded/.test(REC));

  /* ⛔ THE ONE THING IT MUST NEVER DO */
  ok("⛔ reconciling never edits or deletes a transaction to force a match",
    !/\.amount *=|\.deleted *= *true|splice\(/.test(CODE(REC).slice(CODE(REC).indexOf("function reconcileApply"))));
  ok("...and says so", /never edits or deletes a transaction to force a match/.test(REC));

  c.reconcileApply("a_chk", "2026-08-10", 950);
  eq("accepting a statement makes it the new truth", c.budgetAccountBalance(a), 950);
  eq("...dated", a.balanceDate, "2026-08-10");
  eq("everything up to that date is marked cleared", st.p.budgetTx.filter(t => t.cleared).length, 1);
  eq("...and a fresh reconciliation starts from there", c.acctSinceCheckpoint(a).length, 0);
  ok("a missing account or date is refused, not guessed", c.reconcileApply("nope", "2026-01-01", 5) === null && c.reconcileApply("a_chk", "", 5) === null);
}

console.log("\n--- ⭐ 3. the forecast counts his income (it got this wrong twice) ---");
{
  const st = base(), c = sandbox(st);
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  /* ⚠️ HIS ACTUAL DATA: every "Business draw" deposit is DESCRIBED "Transfer From Checking" — a draw out
     of the ThemeForge business account. $36,454, his single largest income source. */
  months.forEach(m => {
    st.p.budgetTx.push(tx({ date: m + "-20", dir: "in", amount: 1500, catId: "c_draw", note: "Transfer From Checking" }));
    st.p.budgetTx.push(tx({ date: m + "-20", dir: "in", amount: 1500, catId: "c_draw", note: "Transfer From Checking" }));
    st.p.budgetTx.push(tx({ date: m + "-28", dir: "in", amount: 2795, catId: "c_rent", note: "Zelle CR Alexis Soukup" }));
  });
  const inc = c.cfRecurringIncome();

  ok("⭐ his business draw IS counted, despite being described as a transfer",
    inc.some(r => r.label === "Business draw" && r.amount === 3000), inc);
  ok("...and so is the rent", inc.some(r => r.label === "Rent received" && r.amount === 2795));
  eq("⭐ the total matches what actually lands each month", inc.reduce((s, r) => s + r.amount, 0), 5795);

  /* the two regressions, pinned */
  ok("⛔ REGRESSION GUARD: income is grouped by CATEGORY, not by payee string",
    /byCat\[t\.catId\]/.test(CODE(CF)) && !/ledgerMerchantKey\(t\.note\)[\s\S]{0,80}groups\[/.test(CODE(CF)));
  ok("⛔ REGRESSION GUARD: the internal filter tests the CATEGORY NAME, never the description",
    /CF_INTERNAL\.test\(nm\)/.test(CODE(CF)) && !/CF_INTERNAL\.test\(String\(t\.note/.test(CODE(CF)));
  ok("⭐ both measured failures are written down with their numbers",
    /\$4,727\/mo/.test(CF) && /\$4,310\/mo/.test(CF) && /\$10,227\/mo/.test(CF));

  /* a category he calls internal is still excluded */
  months.forEach(m => st.p.budgetTx.push(tx({ date: m + "-05", dir: "in", amount: 250, catId: "c_xfer", note: "Transfer From Checking" })));
  ok("⛔ a category actually NAMED for transfers is excluded", !c.cfRecurringIncome().some(r => r.label === "Transfers"));

  /* a one-off never becomes a pattern */
  st.p.budgetTx.push(tx({ date: "2026-06-11", dir: "in", amount: 7400, catId: "c_food", note: "Schwab" }));
  ok("⛔ one appearance is not a pattern — a windfall is not projected forward",
    !c.cfRecurringIncome().some(r => r.amount === 7400));
  ok("...and the reason is recorded", /doesn't quietly assume he'll keep selling investments/.test(CF));

  /* noise */
  months.forEach(m => st.p.budgetTx.push(tx({ date: m + "-02", dir: "in", amount: 0.03, catId: "c_rent", note: "Dividend" })));
  ok("⛔ three-cent dividends don't change anything", c.cfRecurringIncome().find(r => r.label === "Rent received").amount === 2795);
}

console.log("\n--- the forecast itself ---");
{
  const st = base(), c = sandbox(st);
  ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].forEach(m =>
    st.p.budgetTx.push(tx({ date: m + "-20", dir: "in", amount: 3000, catId: "c_draw", note: "Transfer From Checking" })));
  st.p.budgetBills.push({ id: "b1", bookId: "bk", name: "Rent", amount: 3750, dueDay: 13, frequency: "monthly", active: true, deleted: false });
  c.reconcileApply("a_chk", "2026-08-24", 900);

  const f = c.cashflowForecast(45);
  eq("it starts from the reconciled cash", f.start, 900);
  ok("⭐ it finds the low point", f.low.balance < 900, f.low);
  ok("⭐ ...and the day the money runs out", f.negativeOn === "2026-09-13", f.negativeOn);
  ok("the timeline only lists days where something moves", f.timeline.every(d => d.events.length));
  ok("⭐ the income lines are RETURNED, so its assumptions are visible not hidden", f.income.length === 1);
  ok("...and it says what it is not counting", /one-off/.test(f.excludes));
  eq("today's movements are not double-counted — they already happened", f.timeline[0].date > TODAY, true);

  /* ⛔ 4. NO STARTING BALANCE, NO FORECAST */
  const blank = sandbox(base());
  ok("⛔ with every account at zero it refuses to project", !blank.cfHasStartingPoint());
  ok("⭐ ...and asks to be reconciled instead of announcing he's broke",
    /Reconcile an account/.test(blank.cashflowLineHTML()) && !/Runs out/.test(blank.cashflowLineHTML()));
  ok("a typed balance also counts as a starting point", (function () {
    const s2 = base(); s2.p.budgetAccounts[0].balance = 500; return sandbox(s2).cfHasStartingPoint();
  })());
  ok("⛔ a credit card alone is not a starting point for CASH", (function () {
    const s3 = base(); s3.p.budgetAccounts[0].balance = 0; return !sandbox(s3).cfHasStartingPoint();
  })());

  const line = c.cashflowLineHTML();
  ok("the card says when it runs out", /Runs out/.test(line), line);
  ok("⭐ ...and is honest about what it counted", /one-offs not counted/.test(line));
}

console.log("\n--- the money card uses it ---");
{
  ok("⭐ a reconciled account is never called 'unset', even at exactly zero", /!derived && !\(\+a\.balance\)/.test(CODE(MC)));
  ok("⭐ the prompt is now Reconcile, not 'Set balance'", /Reconcile</.test(MC) && !/Set&nbsp;balance/.test(CODE(MC)));
  ok("...and tapping an un-checkpointed account opens the reconcile dialog", /!a\.balanceDate && typeof openReconcile/.test(CODE(MC)));
  ok("the forecast line sits with the balances", /cashflowLineHTML/.test(CODE(MC)) && /bal \+ flow \+ bills/.test(CODE(MC)));
  ok("both modules are registered in the shell", /js\/145-reconcile\.js/.test(SHELL) && /js\/146-cashflow\.js/.test(SHELL));
  ok("reconcile loads before the forecast that reads its balances", SHELL.indexOf("145-reconcile") < SHELL.indexOf("146-cashflow"));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
