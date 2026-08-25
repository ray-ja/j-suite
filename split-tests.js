/* split-tests.js — one payment, several categories.

   The Lowe's run that is half job materials and half a drill bit for the truck: one swipe at the bank, two
   things in the budget.

   WHAT THIS DEFENDS:

   1. ⭐ SPLITS ARE CHILD RECORDS, NOT AN ARRAY. Sync is per-record last-write-wins, so a nested array is
      clobbered wholesale by whichever device saved last. This app already paid for that lesson once —
      job.materials/expenses had to become their own collections. Each slice is a real row with its own id
      and updatedAt.

   2. ⚠️ THE DOUBLE-COUNT, WHICH RUNS IN BOTH DIRECTIONS AT ONCE. The money moved once:
          income & spending  →  count the SLICES, ignore the parent
          account balance    →  count the PARENT, ignore the slices
      Fix only one gate and the same dollar is either doubled or vanishes. The two gates live in different
      files (js/79 and js/145), so this is tested by running BOTH against the same store.

   3. ⛔ A SPLIT THAT DOESN'T ADD UP IS REFUSED. Not rounded, not padded with a leftover line — refused,
      with nothing written.

   Pure node. Run: node split-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SRC = R("js/148-split-tx.js"), BUD = R("js/79-budget.js"), REC = R("js/145-reconcile.js"), SHELL = R("Business App (v1).html");
const TODAY = "2026-08-25";

function sandbox(store) {
  const ctx = {
    console, S: store, BIZ: "p", BUDGET_BOOK: "__all__", BUDGET_MONTH: "2026-08",
    today: () => TODAY, now: () => 1, uid: () => "u" + (ctx._n = (ctx._n || 0) + 1),
    esc: s => String(s == null ? "" : s), touch: r => { r.updatedAt = 1; return r; },
    save: () => {}, render: () => {}, alert: () => {}, document: { getElementById: () => null, querySelector: () => null },
    window: {}
  };
  ctx.D = () => store.p;
  vm.createContext(ctx);
  const i = BUD.indexOf("function actBudgetBooks"), j = BUD.indexOf("/* ---------- main render");
  vm.runInContext(BUD.slice(i, j), ctx);
  vm.runInContext(REC, ctx);
  vm.runInContext(SRC, ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}
const store = () => ({ p: {
  budgetBooks: [{ id: "bk", name: "Personal" }],
  budgetCats: [{ id: "c_mat", bookId: "bk", name: "Job materials", kind: "out", order: 1 },
               { id: "c_tool", bookId: "bk", name: "Tools", kind: "out", order: 2 },
               { id: "c_in", bookId: "bk", name: "Income", kind: "in", order: 3 }],
  budgetAccounts: [{ id: "a_chk", bookId: "bk", name: "Checking", type: "checking", balance: 5000, balanceDate: "2026-07-31" }],
  budgetTx: [{ id: "t1", bookId: "bk", accountId: "a_chk", date: "2026-08-10", dir: "out", amount: 240,
               note: "LOWES #1234", catId: "", deleted: false }],
  budgetBudgets: [], budgetMemo: [], budgetBills: []
} });

console.log("\n--- ⭐ 1. slices are real records, not an array on the parent ---");
{
  const st = store(), c = sandbox(st);
  const res = c.splApply("t1", [{ amount: 180, catId: "c_mat" }, { amount: 60, catId: "c_tool" }]);
  ok("the split applies", !!res, res);
  eq("...two slices", res.slices, 2);

  const kids = c.splChildren("t1");
  eq("⭐ each slice is its own budgetTx row", kids.length, 2);
  ok("...with its own id", kids[0].id !== kids[1].id && kids[0].id !== "t1");
  ok("...its own updatedAt, so two devices can edit two slices and both survive", kids.every(k => k.updatedAt));
  ok("...linked by parentTxId", kids.every(k => k.parentTxId === "t1"));
  ok("⛔ NOTHING is stored as an array on the parent", !/splits *[:=] *\[/.test(CODE(SRC)));
  ok("...and the sync reason is recorded", /last-write-wins/.test(SRC) && /clobbered/.test(SRC));

  const parent = st.p.budgetTx.find(t => t.id === "t1");
  ok("⭐ the parent is marked as split", parent.isSplit === true);
  ok("⛔ ...and carries NO category, so it can't also be counted", parent.catId === "");
  eq("...and keeps the full amount", parent.amount, 240);
  eq("the slices carry the categories", kids.map(k => k.catId).sort().join(), "c_mat,c_tool");
  eq("...and inherit the date, account and direction", kids[0].date + "|" + kids[0].accountId + "|" + kids[0].dir, "2026-08-10|a_chk|out");
}

console.log("\n--- ⚠️ 2. the double-count, tested through BOTH real gates ---");
{
  const st = store(), c = sandbox(st);
  const acct = st.p.budgetAccounts[0];

  const spendBefore = c.budgetCatSpent("c_mat", "2026-08") + c.budgetCatSpent("c_tool", "2026-08");
  eq("before splitting, neither category has spending", spendBefore, 0);
  eq("...and the balance is the checkpoint minus the payment", c.budgetAccountBalance(acct), 4760);

  c.splApply("t1", [{ amount: 180, catId: "c_mat" }, { amount: 60, catId: "c_tool" }]);

  /* ⭐ GATE 1 — income & spending sees the SLICES */
  eq("⭐ the slices land in their categories", c.budgetCatSpent("c_mat", "2026-08"), 180);
  eq("...both of them", c.budgetCatSpent("c_tool", "2026-08"), 60);
  eq("⭐ ...and they add to the payment, not double it",
    c.budgetCatSpent("c_mat", "2026-08") + c.budgetCatSpent("c_tool", "2026-08"), 240);
  ok("⛔ the split parent is NOT in the spending set", !c.actBudgetTx().some(t => t.id === "t1"), c.actBudgetTx().map(t => t.id));
  eq("...so exactly two rows count", c.actBudgetTx().length, 2);

  /* ⭐ GATE 2 — the balance sees the PARENT */
  eq("⭐ the balance is UNCHANGED by splitting — the cash left once", c.budgetAccountBalance(acct), 4760);
  ok("⛔ the slices are not in the account's ledger", !c.acctTx("a_chk").some(t => t.parentTxId), c.acctTx("a_chk").map(t => t.id));
  eq("...only the parent is", c.acctTx("a_chk").length, 1);

  ok("⭐ both gates carry the warning, in both files", /SPLITS \(js\/148\)/.test(BUD) && /THE MIRROR OF actBudgetTx/.test(REC));
  ok("...naming the other one, so a change to one prompts a check of the other",
    /acctTx\(\) in js\/145/.test(BUD) && /js\/79/.test(REC));
}

console.log("\n--- ⛔ 3. a split that doesn't add up is refused ---");
{
  const st = store(), c = sandbox(st);
  ok("⛔ under the payment → refused", c.splApply("t1", [{ amount: 100, catId: "c_mat" }, { amount: 60, catId: "c_tool" }]) === null);
  ok("⛔ over the payment → refused", c.splApply("t1", [{ amount: 200, catId: "c_mat" }, { amount: 60, catId: "c_tool" }]) === null);
  ok("⛔ a single line is not a split", c.splApply("t1", [{ amount: 240, catId: "c_mat" }]) === null);
  eq("⭐ and NOTHING was written on any refusal", st.p.budgetTx.length, 1);
  ok("...the parent is untouched", !st.p.budgetTx[0].isSplit);

  ok("a penny of rounding is tolerated", !!c.splApply("t1", [{ amount: 179.995, catId: "c_mat" }, { amount: 60, catId: "c_tool" }]));
  ok("a missing transaction is refused, not created", c.splApply("nope", [{ amount: 1, catId: "c_mat" }, { amount: 1, catId: "c_tool" }]) === null);
  ok("garbage rows don't throw", c.splApply("t1", null) === null && c.splApply("t1", [null, undefined]) === null);

  const st2 = store(), c2 = sandbox(st2);
  c2.splApply("t1", [{ amount: 180, catId: "nonexistent" }, { amount: 60, catId: "c_tool" }]);
  eq("⭐ an unknown category is blanked, not trusted", c2.splChildren("t1").find(k => k.amount === 180).catId, "");
  eq("...and the slice still exists, so the money is still accounted for", c2.splChildren("t1").length, 2);
}

console.log("\n--- editing and undoing a split ---");
{
  const st = store(), c = sandbox(st);
  c.splApply("t1", [{ amount: 180, catId: "c_mat" }, { amount: 60, catId: "c_tool" }]);
  eq("two slices", c.splChildren("t1").length, 2);

  /* ⭐ re-splitting REPLACES, it does not accumulate */
  c.splApply("t1", [{ amount: 120, catId: "c_mat" }, { amount: 120, catId: "c_tool" }]);
  eq("⭐ re-splitting replaces the old slices", c.splChildren("t1").length, 2);
  eq("...with the new amounts", c.splChildren("t1").map(k => k.amount).join(), "120,120");
  eq("⭐ ...and the category totals are not doubled", c.budgetCatSpent("c_mat", "2026-08"), 120);
  ok("⛔ the replaced slices are soft-deleted, never spliced away", st.p.budgetTx.filter(t => t.deleted).length === 2 && !/splice\(/.test(CODE(SRC).split("splApply")[1] || ""));

  eq("the remaining-to-assign number is what he drives to zero", c.splRemaining(st.p.budgetTx[0]), 0);

  c.splUnsplit("t1", "c_mat");
  ok("⭐ undoing puts it back to one line", !st.p.budgetTx[0].isSplit);
  eq("...with the category he chose", st.p.budgetTx[0].catId, "c_mat");
  eq("...no live slices left", c.splChildren("t1").length, 0);
  eq("⭐ ...and the whole payment counts once again", c.budgetCatSpent("c_mat", "2026-08"), 240);
  eq("...with the balance still unchanged throughout", c.budgetAccountBalance(st.p.budgetAccounts[0]), 4760);
  ok("undoing something that isn't split does nothing", c.splUnsplit("t1", "c_mat") === null);
}

console.log("\n--- it composes with everything else that filters transactions ---");
{
  const st = store(), c = sandbox(st);
  c.splApply("t1", [{ amount: 180, catId: "c_mat" }, { amount: 60, catId: "c_tool" }]);

  /* ⚠️ a pending row is still not money (js/143), split or not */
  st.p.budgetTx.push({ id: "t2", bookId: "bk", accountId: "a_chk", date: "2026-08-12", dir: "out",
    amount: 99, catId: "c_tool", pending: true, deleted: false });
  eq("an unapproved transaction still doesn't count", c.budgetCatSpent("c_tool", "2026-08"), 60);
  eq("...nor move the balance", c.budgetAccountBalance(st.p.budgetAccounts[0]), 4760);

  /* the slices are dated and account-bound, so reconciliation still balances */
  const p = c.reconcilePreview(st.p.budgetAccounts[0], "2026-08-31", 4760);
  ok("⭐ reconciliation still matches after a split — the slices are invisible to it", p.matched, p);
}

console.log("\n--- wiring ---");
{
  ok("the module is in the shell", /js\/148-split-tx\.js/.test(SHELL));
  ok("...after the balance code whose gate it changes", SHELL.indexOf("145-reconcile") < SHELL.indexOf("148-split"));
  ok("⭐ the transaction editor offers a split", /openSplit\(/.test(BUD));
  ok("...and says 'Edit the split' once it is one", /Edit the split/.test(BUD));
  ok("⛔ a brand-new transaction can't be split before it exists", /isNew\?""/.test(CODE(BUD).slice(CODE(BUD).indexOf("openSplit") - 200, CODE(BUD).indexOf("openSplit"))));
  ok("the editor refuses to save until the lines add up", /disabled/.test(SRC) && /have to add up/.test(SRC));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
