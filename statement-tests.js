/* statement-tests.js — cash-basis P&L and cash-flow, per book.

   He runs four sets of books out of one app: Personal, Jamieson Automation, OBX Lot Solutions, and the
   Iowa rental — which is a Schedule E in its own right. The app could say what an envelope had left; it
   could not answer "what did OBX make last quarter", which is the form an accountant, a lender and the
   IRS all ask the question in.

   WHAT THIS DEFENDS:

   1. ⭐ IT REUSES THE GATES INSTEAD OF RE-FILTERING. Every subtlety already fought for — pending isn't
      money, transfers and card payments aren't income or spending, a split parent defers to its slices —
      has to hold here too. Re-implementing that filter is how two screens start disagreeing about the
      same month, and only one of them gets fixed.

   2. ⚠️ IT SHOWS WHAT IT EXCLUDED. A statement that silently omits rows can't be reconciled against a
      bank statement, and an unexplained gap is worse than a smaller number.

   3. ⭐ BOOKS DON'T LEAK. The Iowa rental's numbers go on a Schedule E. One stray Personal transaction in
      that column is a wrong tax return.

   Pure node. Run: node statement-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SRC = R("js/149-statements.js"), BUD = R("js/79-budget.js"), SHELL = R("Business App (v1).html");
const TODAY = "2026-05-15";

function sandbox(store) {
  const ctx = {
    console, S: store, BIZ: "p", BUDGET_BOOK: "__all__", BUDGET_MONTH: "2026-05",
    today: () => TODAY, now: () => 1, uid: () => "u" + (ctx._n = (ctx._n || 0) + 1),
    esc: s => String(s == null ? "" : s), touch: r => r, save: () => {}, render: () => {},
    document: { getElementById: () => null }, window: {}
  };
  ctx.D = () => store.p;
  vm.createContext(ctx);
  const i = BUD.indexOf("function actBudgetBooks"), j = BUD.indexOf("/* ---------- main render");
  vm.runInContext(BUD.slice(i, j), ctx);
  vm.runInContext(R("js/145-reconcile.js"), ctx);
  vm.runInContext(R("js/148-split-tx.js"), ctx);
  vm.runInContext(SRC, ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}
const tx = (o) => Object.assign({ id: "t" + Math.random().toString(36).slice(2, 9), bookId: "obx",
  accountId: "a1", date: "2026-05-10", dir: "out", amount: 100, catId: "c_fuel", note: "x", deleted: false }, o);
const store = () => ({ p: {
  budgetBooks: [{ id: "obx", name: "OBX Lot Solutions" }, { id: "iowa", name: "Iowa rental" }],
  budgetCats: [{ id: "c_fuel", bookId: "obx", name: "Fuel", kind: "out" },
               { id: "c_dump", bookId: "obx", name: "Disposal", kind: "out" },
               { id: "c_job", bookId: "obx", name: "Job income", kind: "in" },
               { id: "c_rent", bookId: "iowa", name: "Rent received", kind: "in" }],
  budgetAccounts: [{ id: "a1", bookId: "obx", name: "Square", type: "checking", balance: 0 }],
  budgetTx: [], budgetBudgets: [], budgetMemo: [], budgetBills: []
} });

console.log("\n--- the periods an owner-operator thinks in ---");
{
  const c = sandbox(store());
  const m = c.stmtRange("month", "2026-05-15");
  eq("a month runs to its real last day", m.from + "→" + m.to, "2026-05-01→2026-05-31");
  eq("February knows how long it is", c.stmtRange("month", "2026-02-09").to, "2026-02-28");
  const q = c.stmtRange("quarter", "2026-05-15");
  eq("⭐ a quarter is a real quarter", q.from + "→" + q.to, "2026-04-01→2026-06-30");
  eq("...labelled the way he'd say it", q.label, "Q2 2026");
  eq("Q1", c.stmtRange("quarter", "2026-02-01").label, "Q1 2026");
  eq("Q4 ends on the 31st", c.stmtRange("quarter", "2026-11-30").to, "2026-12-31");
  eq("a year is the year", c.stmtRange("year", "2026-05-15").from + "→" + c.stmtRange("year", "2026-05-15").to, "2026-01-01→2026-12-31");
}

console.log("\n--- ⭐ 1. the gates hold, without being re-implemented ---");
{
  const st = store(), c = sandbox(st);
  st.p.budgetTx.push(
    tx({ dir: "in", amount: 2000, catId: "c_job" }),
    tx({ dir: "out", amount: 300, catId: "c_fuel" }),
    tx({ dir: "out", amount: 500, catId: "c_dump" }),
    /* ⚠️ each of these must be excluded, and each for a different reason */
    tx({ dir: "in", amount: 9999, catId: "c_job", pending: true }),
    tx({ dir: "in", amount: 8888, isTransfer: true }),
    tx({ dir: "out", amount: 7777, isCardPayment: true })
  );
  const pl = c.stmtProfitLoss("obx", c.stmtRange("month"));

  eq("⭐ income is what actually landed", pl.totalIncome, 2000);
  eq("...expenses are what was actually paid", pl.totalExpense, 800);
  eq("...net", pl.net, 1200);
  eq("...and the margin", pl.margin, 60);
  ok("⛔ an unapproved row is not in the statement", pl.totalIncome !== 11999);
  ok("⛔ a transfer is not income", !pl.income.some(x => x.amount === 8888));
  ok("⛔ a card payment is not an expense", !pl.expense.some(x => x.amount === 7777));

  /* ⭐ a split defers to its slices, exactly as everywhere else */
  const st2 = store(), c2 = sandbox(st2);
  st2.p.budgetTx.push(tx({ id: "big", amount: 240, catId: "" }));
  c2.splApply("big", [{ amount: 180, catId: "c_fuel" }, { amount: 60, catId: "c_dump" }]);
  const pl2 = c2.stmtProfitLoss("obx", c2.stmtRange("month"));
  eq("⭐ a split payment is counted ONCE, via its slices", pl2.totalExpense, 240);
  eq("...split across the right categories", pl2.expense.map(x => x.name + ":" + x.amount).sort().join(), "Disposal:60,Fuel:180");
  ok("⛔ the split parent is not a line of its own", !pl2.expense.some(x => x.amount === 240));

  ok("⭐ the reason for reusing the gate is written down", /two screens start disagreeing/.test(SRC));
}

console.log("\n--- ⚠️ 2. it shows what it excluded ---");
{
  const st = store(), c = sandbox(st);
  st.p.budgetTx.push(
    tx({ dir: "in", amount: 500, catId: "c_job" }),
    tx({ dir: "in", amount: 100, isTransfer: true }),
    tx({ dir: "out", amount: 200, isCardPayment: true }),
    tx({ dir: "out", amount: 50, pending: true }),
    tx({ dir: "out", amount: 75, catId: "" })
  );
  const pl = c.stmtProfitLoss("obx", c.stmtRange("month"));
  eq("transfers are counted and reported", pl.excluded.transfers, 1);
  eq("card payments too", pl.excluded.cardPayments, 1);
  eq("...and what's still waiting for approval", pl.excluded.pending, 1);
  eq("⭐ ...and anything with no category, which IS in the totals but needs attention", pl.excluded.uncategorized, 1);

  const html = c.stmtHTML();
  ok("⭐ the exclusions are printed, not silently dropped", /Not counted:/.test(html), html.slice(-400));
  ok("...with the reason", /aren't income or spending/.test(html));
  ok("⭐ ...and uncategorized rows are flagged in red", /no category yet/.test(html));
  ok("an uncategorized expense still appears in the totals", pl.totalExpense === 75, pl.totalExpense);
  ok("...named honestly", pl.expense.some(x => x.name === "Uncategorized"));
}

console.log("\n--- ⭐ 3. books don't leak (the Iowa rental is a Schedule E) ---");
{
  const st = store(), c = sandbox(st);
  st.p.budgetTx.push(
    tx({ bookId: "obx", dir: "in", amount: 2000, catId: "c_job" }),
    tx({ bookId: "iowa", dir: "in", amount: 2795, catId: "c_rent" }),
    tx({ bookId: "iowa", dir: "out", amount: 2413, catId: "" })
  );
  const obx = c.stmtProfitLoss("obx", c.stmtRange("month"));
  const iowa = c.stmtProfitLoss("iowa", c.stmtRange("month"));
  const all = c.stmtProfitLoss(null, c.stmtRange("month"));

  eq("⭐ OBX sees only OBX", obx.totalIncome, 2000);
  eq("⭐ the rental sees only the rental", iowa.totalIncome, 2795);
  eq("...and its expenses", iowa.totalExpense, 2413);
  eq("⭐ ...which is the Schedule E number", iowa.net, 382);
  eq("no book means everything combined", all.totalIncome, 4795);
  eq("...and the parts add to the whole", obx.totalIncome + iowa.totalIncome, all.totalIncome);
  ok("each statement is labelled with its book", obx.bookName === "OBX Lot Solutions" && iowa.bookName === "Iowa rental");
  ok("...and the combined one says so", all.bookName === "All books");
}

console.log("\n--- dates: cash basis means the day the cash moved ---");
{
  const st = store(), c = sandbox(st);
  st.p.budgetTx.push(
    tx({ date: "2026-04-30", dir: "in", amount: 111, catId: "c_job" }),
    tx({ date: "2026-05-01", dir: "in", amount: 222, catId: "c_job" }),
    tx({ date: "2026-05-31", dir: "in", amount: 333, catId: "c_job" }),
    tx({ date: "2026-06-01", dir: "in", amount: 444, catId: "c_job" })
  );
  const may = c.stmtProfitLoss("obx", c.stmtRange("month", "2026-05-15"));
  eq("⭐ the month is inclusive at both ends", may.totalIncome, 555);
  ok("⛔ the day before doesn't leak in", may.totalIncome !== 666);
  ok("⛔ nor the day after", may.totalIncome !== 999);
  eq("the quarter holds all of them but June", c.stmtProfitLoss("obx", c.stmtRange("quarter", "2026-05-15")).totalIncome, 666 + 444 - 555 + 555 - 444 + 444);
  ok("⭐ cash basis is stated, not implied", /CASH BASIS/.test(SRC) && /day it landed/.test(SRC));
  /* ⚠️ collapse whitespace — prose in a header comment wraps, and a regex across the break fails */
  ok("...including what that means for a December invoice paid in January",
    /paid in January is January income/.test(SRC.replace(/\s+/g, " ")));
}

console.log("\n--- empty and edge cases ---");
{
  const c = sandbox(store());
  const pl = c.stmtProfitLoss("obx", c.stmtRange("month"));
  eq("an empty period has no income", pl.totalIncome, 0);
  eq("...no expenses", pl.totalExpense, 0);
  eq("⛔ ...and NO margin, rather than a division by zero", pl.margin, null);
  ok("the screen says so plainly", /Nothing recorded in this period/.test(c.stmtHTML()));
  ok("⛔ no NaN anywhere", !/NaN/.test(c.stmtHTML()));

  const st2 = store(), c2 = sandbox(st2);
  st2.p.budgetTx.push(tx({ dir: "out", amount: 500, catId: "c_fuel" }));
  const loss = c2.stmtProfitLoss("obx", c2.stmtRange("month"));
  eq("a loss is a negative net", loss.net, -500);
  eq("⛔ ...with no margin, because there was no income to have a margin of", loss.margin, null);
  ok("a loss is shown in the danger colour", /var\(--danger\)/.test(c2.stmtHTML()));
}

console.log("\n--- the cash-flow view answers a different question ---");
{
  const st = store(), c = sandbox(st);
  st.p.budgetTx.push(
    tx({ dir: "in", amount: 2000, catId: "c_job" }),
    tx({ dir: "out", amount: 800, catId: "c_fuel" }),
    tx({ dir: "out", amount: 500, isTransfer: true }),
    tx({ dir: "out", amount: 300, isCardPayment: true })
  );
  const cf = c.stmtCashFlow("obx", c.stmtRange("month"));
  eq("operating cash in", cf.operatingIn, 2000);
  eq("operating cash out", cf.operatingOut, 800);
  eq("⭐ ...and unlike the P&L, transfers and card payments ARE cash movements", cf.transfersOut, 500);
  eq("...card payments too", cf.cardPayments, 300);
  eq("⭐ net change in cash counts all of it", cf.netChange, 400);
  ok("⛔ a split's slices are not double-counted as cash", (function () {
    const s2 = store(), k = sandbox(s2);
    s2.p.budgetTx.push(tx({ id: "b", amount: 240, catId: "" }));
    k.splApply("b", [{ amount: 180, catId: "c_fuel" }, { amount: 60, catId: "c_dump" }]);
    return k.stmtCashFlow("obx", k.stmtRange("month")).operatingOut === 240;
  })());
}

console.log("\n--- wiring ---");
{
  ok("the module is in the shell", /js\/149-statements\.js/.test(SHELL));
  ok("...after the split gate it has to respect", SHELL.indexOf("148-split") < SHELL.indexOf("149-statements"));
  ok("⭐ Statements is a Budget sub-tab", /budgetSetSub\(\\?'stmt\\?'\)/.test(BUD));
  ok("...and renders there", /BUDGET_SUB==="stmt"/.test(CODE(BUD)));
  ok("month / quarter / year are switchable", /stmtSetPeriod/.test(SRC));
  /* ⚠️ pushing onto a LOCAL array is not a write. What matters is that nothing reaches his store. */
  ok("it never writes to the store — a report that mutates is a bug waiting to happen",
    !/save\(\)|touch\(|D\(\)\.\w+\.push/.test(CODE(SRC)), (CODE(SRC).match(/.*(save\(\)|touch\(|D\(\)\.\w+\.push).*/) || [])[0]);
  ok("...it only ever reads", /stmtActive\(D\(\)\.budgetTx\)/.test(CODE(SRC)));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
