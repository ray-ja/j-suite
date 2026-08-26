/* match-tests.js — the bank row and the receipt are the same dollar.

   This is the piece that had to exist before he could safely link a BUSINESS bank account. He logs a
   Lowe's receipt on the job; three days later the feed delivers the same purchase. Both are true records
   of one $46.52, and if both count he has spent $93.04.

   ⚠️ THE THING THIS FILE REALLY DEFENDS IS THE THIRD GATE. Matching lands on three different questions in
   two different directions:

       income & spending   →  SKIP a matched row (its business record counts it)
       unified ledger      →  SKIP a matched row (same, across entities)
       account balance     →  COUNT it. The cash genuinely left the bank.

   Get the last one backwards and his reconciliation drifts by every matched purchase, silently, forever.
   All three are asserted here by running the REAL functions against one store, because they live in three
   different files and nothing else would catch a change to one of them.

   Pure node. Run: node match-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PROSE = (src) => src.replace(/\s+/g, " ");

const SRC = R("js/152-match.js"), BUD = R("js/79-budget.js"), REC = R("js/145-reconcile.js");
const UNI = R("js/151-unified-ledger.js"), UI = R("js/144-ledger-review.js"), SHELL = R("Business App (v1).html");

function sandbox(S) {
  const ctx = { console, S, BUDGET_BOOK: "__all__", today: () => "2026-08-25", now: () => 1,
    uid: () => "u" + Math.random().toString(36).slice(2, 8), window: {},
    esc: s => String(s == null ? "" : s), touch: r => { r.updatedAt = 1; return r; },
    save: () => {}, render: () => {}, budgetMoney: n => "$" + (+n || 0).toFixed(2), budgetCatName: id => id };
  ctx.D = () => S[S.biz];
  vm.createContext(ctx);
  const i = BUD.indexOf("function actBudgetBooks"), j = BUD.indexOf("/* ---------- main render");
  vm.runInContext(BUD.slice(i, j), ctx);
  vm.runInContext("function plExpenses(j){return (D().jobExpenses||[]).filter(e=>e&&!e.deleted&&e.jobId===j.id)}", ctx);
  vm.runInContext(REC, ctx); vm.runInContext(UNI, ctx); vm.runInContext(SRC, ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}
/* his real situation: the OBX expense exists, and the bank row for it arrives in the personal feed */
const store = () => ({
  biz: "me",
  registry: [{ id: "obx", name: "OBX Lot Solutions" }, { id: "me", name: "RBJVL" }],
  obx: {
    income: [], jobs: [{ id: "j1", date: "2026-08-08", deleted: false }],
    jobExpenses: [{ id: "je1", jobId: "j1", amount: 46.52, date: "2026-08-08", vendor: "Lowe's", desc: "Rope", deleted: false }],
    expenses: [{ id: "e1", amount: 254.49, date: "2026-08-08", vendor: "Lowe's", desc: "Pavers", deleted: false },
               { id: "e2", amount: 900, date: "2026-08-09", vendor: "X", desc: "A BILL", unpaid: true, deleted: false }],
    receipts: [], jobMaterials: [], budgetTx: [], budgetCats: [], budgetBooks: [], budgetAccounts: []
  },
  me: {
    income: [], expenses: [], jobs: [], jobExpenses: [], receipts: [], jobMaterials: [],
    budgetCats: [{ id: "c_out", bookId: "bk", name: "Tools", kind: "out" }],
    budgetBooks: [{ id: "bk", name: "Personal" }],
    budgetAccounts: [{ id: "a1", bookId: "bk", name: "Checking", type: "checking", balance: 1000, balanceDate: "2026-08-01" }],
    budgetTx: [{ id: "bank1", bookId: "bk", accountId: "a1", date: "2026-08-11", dir: "out", amount: 46.52,
                 note: "LOWES #1234", catId: "", externalId: "plaid_1", deleted: false }],
    budgetBudgets: []
  }
});

console.log("\n--- ⭐ finding the record the bank row already has ---");
{
  const S = store(), c = sandbox(S);
  const row = S.me.budgetTx[0];
  const best = c.matchBest(row);

  ok("⭐ the OBX job expense is found from the personal feed", !!best, best);
  eq("...in the right entity", best.orgName, "OBX Lot Solutions");
  eq("...the right record", best.id, "je1");
  eq("...the right kind", best.kind, "jobExpense");
  eq("...three days apart", best.gap, 3);

  ok("⛔ an UNPAID bill is never a match — it isn't cash yet",
    !c.matchCandidates({ id: "x", dir: "out", amount: 900, date: "2026-08-09" }).some(x => x.id === "e2"));
  eq("a different amount finds nothing", c.matchCandidates({ id: "x", dir: "out", amount: 12, date: "2026-08-11" }).length, 0);
  eq("⛔ too far apart is not the same purchase", c.matchCandidates({ id: "x", dir: "out", amount: 46.52, date: "2026-09-20" }).length, 0);
  ok("a couple of cents still matches", c.matchCandidates({ id: "x", dir: "out", amount: 46.51, date: "2026-08-11" }).length === 1);
  ok("⛔ money coming IN never matches an expense",
    !c.matchCandidates({ id: "x", dir: "in", amount: 46.52, date: "2026-08-11" }).some(x => x.kind === "jobExpense"));
  eq("garbage doesn't throw", c.matchCandidates(null).length, 0);

  /* ⛔ ambiguity is refused, not guessed */
  const S2 = store();
  S2.obx.expenses.push({ id: "dup", amount: 46.52, date: "2026-08-08", desc: "Also Lowe's", deleted: false });
  const c2 = sandbox(S2);
  ok("⭐ two records at the same amount and distance → no automatic offer",
    c2.matchBest(S2.me.budgetTx[0]) === null, c2.matchCandidates(S2.me.budgetTx[0]));
  ok("...but both are still listed for him to choose", c2.matchCandidates(S2.me.budgetTx[0]).length === 2);
  ok("the reason is recorded", /attached to the wrong job/.test(PROSE(SRC)));
}

console.log("\n--- ⚠️ THE THREE GATES, run for real against one store ---");
{
  const S = store(), c = sandbox(S);
  const acct = S.me.budgetAccounts[0];
  const row = S.me.budgetTx[0];

  /* BEFORE matching: the bank row counts as personal spending AND the OBX expense counts. Double. */
  const spendBefore = c.actBudgetTx().filter(t => t.dir === "out").reduce((s, t) => s + t.amount, 0);
  const uniBefore = c.uniRows("", "9999").filter(r => r.dir === "out").reduce((s, r) => s + r.amount, 0);
  const balBefore = c.budgetAccountBalance(acct);
  eq("before: the bank row is personal spending", spendBefore, 46.52);
  eq("⛔ before: the unified ledger counts the SAME purchase twice", Math.round(uniBefore * 100) / 100,
    Math.round((46.52 + 46.52 + 254.49) * 100) / 100);
  eq("before: the balance is down by the purchase", balBefore, 953.48);

  c.matchLink("bank1", c.matchBest(row));

  /* GATE 1 */
  eq("⭐ after: it is no longer personal spending", c.actBudgetTx().filter(t => t.dir === "out").reduce((s, t) => s + t.amount, 0), 0);
  /* GATE 2 */
  eq("⭐ after: the unified ledger counts the purchase ONCE", Math.round(c.uniRows("", "9999").filter(r => r.dir === "out").reduce((s, r) => s + r.amount, 0) * 100) / 100,
    Math.round((46.52 + 254.49) * 100) / 100);
  /* GATE 3 — the dangerous one */
  eq("⭐⭐ after: the BALANCE is unchanged — the cash really did leave the bank", c.budgetAccountBalance(acct), balBefore);

  ok("⛔ the balance gate explicitly does NOT filter matched rows", !/matchedTo/.test(CODE(REC)));
  ok("...and says so, so nobody 'tidies' it in", /Adding `!t\.matchedTo` here would make every reconciliation drift/.test(PROSE(REC)));
  ok("the spending gate DOES filter them", /matchedTo&&t\.matchedTo\.id/.test(CODE(BUD)));
  ok("...and so does the unified read", /matchedTo && t\.matchedTo\.id/.test(CODE(UNI)));
}

console.log("\n--- linking, and coming back from it ---");
{
  const S = store(), c = sandbox(S);
  c.matchLink("bank1", c.matchBest(S.me.budgetTx[0]));
  const row = S.me.budgetTx[0];

  ok("the ledger row points at the record", row.matchedTo && row.matchedTo.id === "je1");
  eq("...and at the entity", row.matchedTo.org, "obx");
  eq("⛔ ...and carries no category of its own", row.catId, "");
  ok("⭐ the business record is stamped back, so a second bank row can't claim it",
    S.obx.jobExpenses[0].matchedByTxId === "bank1");

  /* a second, identical bank row must not be offered the same record */
  S.me.budgetTx.push({ id: "bank2", bookId: "bk", accountId: "a1", date: "2026-08-11", dir: "out",
    amount: 46.52, note: "LOWES again", catId: "", externalId: "plaid_2", deleted: false });
  ok("⛔ an already-claimed record is not offered again", !c.matchCandidates(S.me.budgetTx[1]).some(x => x.id === "je1"));

  c.matchUnlink("bank1");
  ok("⭐ unmatching releases the ledger row", !c.matchIsMatched(row));
  ok("...and releases the record", !S.obx.jobExpenses[0].matchedByTxId);
  ok("...so it can be matched again", c.matchCandidates(S.me.budgetTx[1]).some(x => x.id === "je1"));
  eq("⭐ ...and it counts as spending once more", c.actBudgetTx().filter(t => t.dir === "out").length, 2);
  ok("unmatching something unmatched does nothing", c.matchUnlink("bank1") === null);
  ok("a missing row is refused, not created", c.matchLink("nope", { orgId: "obx", kind: "expense", id: "e1" }) === null);
  ok("a null candidate is refused", c.matchLink("bank1", null) === null);
}

console.log("\n--- what he sees in the review queue ---");
{
  const S = store(), c = sandbox(S);
  const html = c.matchRowHTML(S.me.budgetTx[0]);
  ok("⭐ the offer names the record and the entity", /Rope/.test(html) && /OBX Lot Solutions/.test(html), html);
  ok("...and the date and amount, so he can check it", /2026-08-08/.test(html) && /46\.52/.test(html));
  ok("⭐ ...and says what linking means in plain words", /don't count it twice/.test(PROSE(html)));

  c.matchLink("bank1", c.matchBest(S.me.budgetTx[0]));
  const after = c.matchRowHTML(S.me.budgetTx[0]);
  ok("once linked it explains what approving now does", /confirms the cash left/.test(PROSE(after)));
  ok("...and offers a way out", /not a match/.test(after));
  eq("a row with no candidate says nothing at all",
    c.matchRowHTML({ id: "z", dir: "out", amount: 3, date: "2026-08-11" }), "");

  ok("the review screen shows it", /matchRowHTML/.test(CODE(UI)));
  ok("⭐ ...and a matched row is not asked for a category", /matchIsMatched\(t\)/.test(CODE(UI)));
  ok("the module is in the shell", /js\/152-match\.js/.test(SHELL));
  ok("...after the unified read it uses", SHELL.indexOf("151-unified") < SHELL.indexOf("152-match"));
}

console.log("\n--- the org context is put back (js/151's rule still holds) ---");
{
  const S = store(), c = sandbox(S);
  eq("starts where it started", S.biz, "me");
  c.matchCandidates(S.me.budgetTx[0]);
  eq("⭐ scanning every entity restores the current one", S.biz, "me");
  c.matchLink("bank1", c.matchBest(S.me.budgetTx[0]));
  eq("...and so does linking across entities", S.biz, "me");
  c.matchUnlink("bank1");
  eq("...and unlinking", S.biz, "me");
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
