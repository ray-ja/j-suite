/* ledger-tests.js — the cash-basis ingest → recognize → approve → learn engine.

   Ray, 2026-08-25: "lets just build the quickbooks / ynab style backend. cash based accounting.
   autotagging after something is recognized but everything needs approvals. like ynab."

   THE THREE PROPERTIES THIS FILE EXISTS TO DEFEND:

   1. ⭐ NOTHING POSTS WITHOUT APPROVAL. An ingested row is invisible to every envelope, total and report
      until he approves it. The proof isn't "we set a flag" — it's that actBudgetTx(), the one gate the
      whole budget reads through, excludes it. Asserted by running the real function.

   2. ⭐ THE MEMORY IS MADE OF HIS DECISIONS, NEVER OF MY GUESSES. A suggestion must never become a rule.
      If autotagging learned from its own output it would compound its first mistake across every future
      transaction from that payee, silently and confidently.

   3. ⭐ CASH BASIS. Date = the day cash moved. No accruals, no receivables, no payables. A transfer
      between his own accounts is not income, and a card payment is not spending — miss either and the
      same dollar gets counted twice.

   Pure node. Run: node ledger-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LEDGER = R("js/143-ledger.js"), UI = R("js/144-ledger-review.js");
const BUD = R("js/79-budget.js"), CSV = R("js/80-budget-csv.js"), SHELL = R("Business App (v1).html");
const TODAY = "2026-08-25";

/* a sandbox with the REAL budget helpers loaded, so "excluded from the totals" is proved, not asserted */
function sandbox(store) {
  const ctx = {
    console, S: store, BIZ: "p", BUDGET_BOOK: "__all__", BUDGET_SUB: "month", BUDGET_MONTH: "2026-08",
    today: () => TODAY, now: () => 1700000000000, uid: () => "u" + (ctx._n = (ctx._n || 0) + 1),
    esc: s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    touch: r => { r.updatedAt = 1; return r; }, save: () => { ctx.saves = (ctx.saves || 0) + 1; },
    render: () => {}, alert: () => {}, confirm: () => true, toast: () => {},
    document: { getElementById: () => null }, window: {}, saves: 0
  };
  ctx.D = () => store.p;
  vm.createContext(ctx);
  /* only the pure helpers from js/79 — the whole file needs a DOM */
  const i = BUD.indexOf("function actBudgetBooks"), j = BUD.indexOf("/* ---------- main render");
  vm.runInContext(BUD.slice(i, j), ctx);
  vm.runInContext(CSV.match(/function budgetMemoKey[\s\S]*?\n\}/)[0], ctx);
  vm.runInContext(LEDGER, ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}
const store = () => ({ p: {
  budgetBooks: [{ id: "bk", name: "Personal" }],
  budgetCats: [
    { id: "c_food", bookId: "bk", name: "Groceries", kind: "out", order: 1 },
    { id: "c_gas", bookId: "bk", name: "Fuel", kind: "out", order: 2 },
    { id: "c_pay", bookId: "bk", name: "Paycheck", kind: "in", order: 3 }
  ],
  budgetAccounts: [
    { id: "a_chk", bookId: "bk", name: "Navy Federal — checking", type: "checking", balance: 100 },
    { id: "a_sav", bookId: "bk", name: "Navy Federal — savings", type: "savings", balance: 500 },
    { id: "a_visa", bookId: "bk", name: "Visa Signature", type: "credit", mask: "4412", balance: -2000 }
  ],
  budgetTx: [], budgetMemo: [], budgetBills: [], budgetBudgets: []
} });
const row = (o) => Object.assign({ date: "2026-08-20", dir: "out", amount: 42.5, desc: "HARRIS TEETER #1234 KITTY HAWK NC" }, o);

console.log("\n--- ⭐ 1. nothing posts without approval ---");
{
  const st = store(), c = sandbox(st);
  const res = c.ledgerIngest([row({}), row({ amount: 90, desc: "WAWA 8823" })], { source: "csv", bookId: "bk" });
  eq("both rows landed", res.added, 2);
  eq("...as pending", st.p.budgetTx.filter(t => t.pending).length, 2);

  /* ⭐ THE PROOF: the real gate every envelope and total reads through */
  eq("⭐ actBudgetTx() — the one gate the whole budget uses — sees NONE of them", c.actBudgetTx().length, 0);
  eq("...so all-time income minus spending is still zero", c.budgetRunningBalance(), 0);
  eq("...and the category has no spending against it", c.budgetCatSpent("c_food", "2026-08"), 0);

  c.ledgerApprove(st.p.budgetTx[0].id, { catId: "c_food" });
  eq("⭐ approving ONE makes exactly one real", c.actBudgetTx().length, 1);
  eq("...and it lands in the category he chose", c.budgetCatSpent("c_food", "2026-08"), 42.5);
  eq("...the other is still waiting", c.ledgerInboxCount(), 1);

  ok("⛔ the ingest never pre-fills catId — the suggestion is a separate field",
    st.p.budgetTx[1].catId === "" && "suggestedCatId" in st.p.budgetTx[1]);
  ok("⛔ nor does it pre-set isTransfer/isCardPayment — those are proposals until approval",
    st.p.budgetTx[1].isTransfer === false && st.p.budgetTx[1].isCardPayment === false);
  ok("the queue is not book-scoped — a queue that hides rows never empties", !/budgetInBook/.test(CODE(LEDGER).split("function ledgerInbox")[1] || ""));
}

console.log("\n--- ⭐ 2. it learns from his decisions, never from its own guesses ---");
{
  const st = store(), c = sandbox(st);
  c.ledgerIngest([row({})], { source: "csv", bookId: "bk" });
  const t1 = st.p.budgetTx[0];

  eq("a brand-new payee is not recognized", (t1.suggestion || {}).confidence, "none");
  ok("...and says so plainly", /new payee/i.test(t1.suggestion.why), t1.suggestion.why);
  eq("⛔ INGEST ALONE TEACHES IT NOTHING", st.p.budgetMemo.length, 0);

  c.ledgerApprove(t1.id, { catId: "c_food" });
  eq("⭐ approving is what writes the rule", st.p.budgetMemo.length, 1);
  eq("...for the merchant, not the whole noisy description", st.p.budgetMemo[0].key, "harris teeter kitty");
  eq("...counted once", st.p.budgetMemo[0].hits, 1);

  /* now the same payee comes in again */
  c.ledgerIngest([row({ date: "2026-08-22", amount: 61.2 })], { source: "csv", bookId: "bk" });
  const t2 = st.p.budgetTx[1];
  eq("⭐ the second one is recognized", (t2.suggestion || {}).confidence, "high");
  eq("...with the category he picked", t2.suggestedCatId, "c_food");
  ok("⭐ ...and the reason is a fact he can check", /filed .*Groceries/i.test(t2.suggestion.why), t2.suggestion.why);

  c.ledgerApprove(t2.id);
  eq("approving again strengthens the rule", st.p.budgetMemo[0].hits, 2);
  eq("...and it took the suggested category with no argument", st.p.budgetTx[1].catId, "c_food");

  /* ⚠️ he corrects it — his newest decision wins, and the confidence resets with it */
  c.ledgerIngest([row({ date: "2026-08-24" })], { source: "csv", bookId: "bk" });
  c.ledgerApprove(st.p.budgetTx[2].id, { catId: "c_gas" });
  eq("a correction moves the rule", st.p.budgetMemo[0].catId, "c_gas");
  eq("⭐ ...and restarts the count, so it stops sounding confident about what he just rejected", st.p.budgetMemo[0].hits, 1);
  eq("still one rule for this payee, not two fighting", st.p.budgetMemo.length, 1);

  /* ⚠️ THE INVARIANT IS "ONLY FROM HIS DECISIONS", NOT "ONLY FROM approve()". It said the latter until
     2026-08-27, when ledgerBackfillMemo was added — which learns from ALREADY-APPROVED rows, i.e. the very
     same source of truth, just ones that arrived before this screen existed. Restated so it still forbids
     the thing that matters: learning from a GUESS. */
  ok("⭐ learning happens in exactly two places", (CODE(LEDGER).match(/ledgerLearn\(/g) || []).length === 3,
    (CODE(LEDGER).match(/.*ledgerLearn\(.*/g) || []));
  ok("⛔ ...ledgerIngest never calls it — an import is not a decision",
    !/ledgerLearn/.test(CODE(LEDGER).slice(CODE(LEDGER).indexOf("function ledgerIngest"), CODE(LEDGER).indexOf("function ledgerInbox"))));
  ok("⛔ ...nor does ledgerSuggest — a guess must never teach itself",
    !/ledgerLearn/.test(CODE(LEDGER).slice(CODE(LEDGER).indexOf("function ledgerSuggest"), CODE(LEDGER).indexOf("function ledgerDupKey"))));
  ok("⭐ the backfill reads ONLY approved rows carrying his own category",
    /rows = ledgerTx\(\)\.filter\(function \(t\) \{\s*return !t\.pending && t\.catId/.test(CODE(LEDGER)));
  ok("⛔ ...and never touches a transaction — rules only", (function () {
    var b = CODE(LEDGER).slice(CODE(LEDGER).indexOf("function ledgerBackfillMemo"), CODE(LEDGER).indexOf("function ledgerResuggest"));
    return !/t\.catId\s*=|t\.pending\s*=|t\.amount\s*=/.test(b);
  })());

  /* ⭐ re-asking after learning: suggestions may be rewritten, decisions may not */
  ok("⭐ ledgerResuggest touches PENDING rows only",
    /ledgerTx\(\)\.filter\(function \(t\) \{ return t\.pending; \}\)/.test(CODE(LEDGER)));
  ok("⛔ ...and never writes a real category, only the suggestion", (function () {
    /* ⚠️ bound the slice by the NEXT function, not by one several definitions away — ledgerAutoApprove was
       inserted between these two and dragged its (legitimate) writes into the window under test. */
    var b = CODE(LEDGER).slice(CODE(LEDGER).indexOf("function ledgerResuggest"), CODE(LEDGER).indexOf("function ledgerAutoStrip"));
    return /t\.suggestedCatId = next/.test(b) && !/[^t]t\.catId\s*=/.test(b);
  })());
}

console.log("\n--- ⭐ 3. cash basis: the same dollar must not be counted twice ---");
{
  const st = store(), c = sandbox(st);
  /* checking → savings: two legs of one movement, neither is income or spending */
  st.p.budgetTx.push({ id: "x1", bookId: "bk", accountId: "a_chk", date: "2026-08-18", dir: "out",
    amount: 500, note: "Transfer To Savings", catId: "", deleted: false });
  const s1 = c.ledgerSuggest({ date: "2026-08-19", dir: "in", amount: 500, desc: "Transfer From Checking", accountId: "a_sav" });
  ok("⭐ the matching leg of a transfer is spotted", s1.isTransfer, s1);
  ok("...and says which one it matched", /already here on 2026-08-18/.test(s1.why), s1.why);
  eq("...with no category, since it is neither income nor spending", s1.catId, "");

  const far = c.ledgerSuggest({ date: "2026-09-30", dir: "in", amount: 500, desc: "Transfer From Checking", accountId: "a_sav" });
  ok("⛔ a same-sized deposit six weeks later is NOT that transfer", !far.isTransfer);
  const same = c.ledgerSuggest({ date: "2026-08-19", dir: "in", amount: 500, desc: "x", accountId: "a_chk" });
  ok("⛔ nor is one inside the same account", !same.isTransfer);

  const cp = c.ledgerSuggest({ date: "2026-08-20", dir: "out", amount: 300, desc: "PAID TO - VISA SIGNATURE 4412", accountId: "a_chk" });
  ok("⭐ a payment to his own card is spotted", cp.isCardPayment, cp);
  ok("...named", /Visa Signature/.test(cp.why));
  const notCp = c.ledgerSuggest({ date: "2026-08-20", dir: "in", amount: 300, desc: "VISA SIGNATURE 4412", accountId: "a_chk" });
  ok("⛔ money coming IN is not a card payment", !notCp.isCardPayment);

  /* and on approval both are stripped of any category */
  c.ledgerIngest([{ date: "2026-08-19", dir: "in", amount: 500, desc: "Transfer From Checking", accountId: "a_sav" }], { bookId: "bk" });
  const tx = st.p.budgetTx.find(t => t.pending);
  c.ledgerApprove(tx.id, { catId: "c_pay" });
  ok("⭐ approving a transfer refuses the category — that's how a dollar gets counted twice", tx.catId === "" && tx.isTransfer);
  ok("⭐ ...and its PARTNER leg is marked too — flagging one leaves the other counted as spending",
    st.p.budgetTx.find(t => t.id === "x1").isTransfer === true, st.p.budgetTx.find(t => t.id === "x1"));
  eq("...linked by a shared transferId", st.p.budgetTx.find(t => t.id === "x1").transferId, tx.transferId);
  ok("...and that id is real", !!tx.transferId);
  eq("⭐ so the movement is out of the totals ENTIRELY, both ends", c.budgetRunningBalance(), 0);
  eq("...it taught nothing, because there was no category to learn", st.p.budgetMemo.length, 0);
}

console.log("\n--- ⚠️ the merchant key, against his bank's ACTUAL format ---");
{
  const c = sandbox(store());
  /* ⚠️ THE BUG THIS REPLACED: budgetMemoKey took the first ~3 words, and Navy Federal writes every card
     purchase as "POS Debit- Debit Card 9185 <date> <merchant> <city> <ST>". So all 122 of his card
     purchases keyed to "pos debit debit", one rule swallowed the lot, and it confidently filed everything
     as Groceries. Hold-out accuracy on his own filings: 37%. */
  const k = c.ledgerMerchantKey;
  eq("⭐ the bank's boilerplate is stripped, and the MERCHANT survives",
    k("POS Debit- Debit Card 9185 07-10-26 Google *jp Pokemon 855-836-3987 CA"), "jp pokemon");
  eq("...the other POS form too", k("POS Debit Transaction 07-13-26 Publix Kill Devil HI NC"), "publix kill devil");
  eq("...a processor prefix is not the merchant", k("POS Debit- Debit Card 9185 07-13-26 Sq *ashleys Espre Kill Devil HI NC"), "ashleys espre kill");
  eq("...ACH in", k("Deposit - ACH Paid From Venmo Cashout 01Afd5"), "venmo cashout afd");
  eq("...ACH out", k("ACH Paid To Ashley Belvin"), "ashley belvin");
  eq("...a card payment keeps the card's name", k("Paid To - Discover E-Payment Chk 9100001"), "discover e payment");
  eq("...Zelle", k("Zelle Cr Alexis Soukup"), "alexis soukup");
  eq("a clean description is untouched", k("HARRIS TEETER #1234 KITTY HAWK NC"), "harris teeter kitty");

  ok("⛔ the old catch-all key is dead — these must NOT collide",
    k("POS Debit- Debit Card 9185 07-10-26 Publix Kill Devil HI NC") !== k("POS Debit- Debit Card 9185 07-11-26 Wawa Nags Head NC"));
  /* ⚠️ and the width matters: at two words these three become one rule */
  ok("⭐ three different transfers stay three different keys",
    new Set([k("Transfer To Loan"), k("Transfer To Checking"), k("Transfer To Credit Card")]).size === 3);
  ok("the measured hold-out result is recorded, so the width isn't changed on a hunch",
    /MEASURED, on his 263 real filings/.test(LEDGER) && /37%/.test(LEDGER));

  /* ⭐ reading is a different job from matching: the key is for rules, this is for his eyes */
  const n = c.ledgerDisplayName;
  eq("the payee is shown as he'd recognise it", n("POS Debit- Debit Card 9185 07-10-26 Google *jp Pokemon 855-836-3987 CA"), "Google *jp Pokemon");
  eq("...phone numbers and card noise gone", n("POS Debit- Debit Card 9185 07-08-26 Jolly Roger Restau 252-4416530 NC"), "Jolly Roger Restau");
  eq("...check numbers too", n("Paid To - Discover E-Payment Chk 9100001"), "Discover E-Payment");
  eq("...ACH boilerplate", n("Deposit - ACH Paid From Venmo Cashout 01Afd5"), "Venmo Cashout 01Afd5");
  eq("a description with no boilerplate is left alone", n("Dividend"), "Dividend");
  eq("...as is a transfer, which reads fine already", n("Transfer To Loan"), "Transfer To Loan");
  ok("⛔ it keeps the ORIGINAL casing — the key lowercases, this must not", /Google/.test(n("POS Debit- Debit Card 9185 07-10-26 Google *jp Pokemon 855-836-3987 CA")));
  eq("an empty description doesn't render blank", n(""), "");
  ok("⭐ the raw bank line is still shown underneath, so he can check it against his statement",
    /esc\(String\(t\.note \|\| ""\)\.slice/.test(CODE(UI)));

  eq("junk in, empty key out — never a rule keyed on nothing", k("###"), "");
  eq("an empty description is safe", k(""), "");
  ok("an unkeyable row teaches nothing", c.ledgerLearn("###", "c_food") === null);
}

console.log("\n--- dedupe: a bank feed re-sends the same rows forever ---");
{
  const st = store(), c = sandbox(st);
  c.ledgerIngest([row({ externalId: "plaid_aaa" })], { source: "bank", bookId: "bk" });
  const again = c.ledgerIngest([row({ externalId: "plaid_aaa" }), row({ externalId: "plaid_bbb", amount: 9 })], { source: "bank", bookId: "bk" });
  eq("⭐ the same external id is not imported twice", again.duplicates, 1);
  eq("...and the new one still lands", again.added, 1);

  /* ⚠️ two identical coffees on the same day are two coffees */
  const st2 = store(), c2 = sandbox(st2);
  c2.ledgerIngest([row({ externalId: "p1", amount: 4.5, desc: "STARBUCKS 991" })], { source: "bank", bookId: "bk" });
  const twice = c2.ledgerIngest([row({ externalId: "p2", amount: 4.5, desc: "STARBUCKS 991" })], { source: "bank", bookId: "bk" });
  eq("⭐ ...and an id-bearing source keeps both", twice.added, 1);

  /* a CSV has no ids, so the fuzzy key is all there is — and it must not collide with the id-bearing rows */
  const st3 = store(), c3 = sandbox(st3);
  c3.ledgerIngest([row({})], { source: "csv", bookId: "bk" });
  eq("a CSV re-import of the same line is caught", c3.ledgerIngest([row({})], { source: "csv", bookId: "bk" }).duplicates, 1);
  ok("⭐ the fuzzy key only compares against rows that ALSO have no id",
    /!t\.externalId && ledgerDupKey/.test(CODE(LEDGER)));

  eq("a row with no date is refused", c3.ledgerIngest([{ dir: "out", amount: 5, desc: "x" }], { bookId: "bk" }).added, 0);
  eq("a row with no amount is refused", c3.ledgerIngest([{ date: TODAY, dir: "out", amount: 0, desc: "x" }], { bookId: "bk" }).added, 0);
  eq("garbage doesn't throw", c3.ledgerIngest([null, undefined, 5], { bookId: "bk" }).added, 0);
  ok("an unknown source is clamped, not trusted", c3.ledgerIngest([row({ date: "2026-01-01" })], { source: "<script>", bookId: "bk" }).source === "manual");
  ok("a negative amount is stored as magnitude + direction, never a sign",
    c3.ledgerIngest([{ date: "2026-02-02", dir: "out", amount: -33, desc: "REFUND TEST" }], { bookId: "bk" }).added === 1
    && st3.p.budgetTx.slice(-1)[0].amount === 33);
}

console.log("\n--- a bill he already told us about ---");
{
  const st = store(), c = sandbox(st);
  st.p.budgetBills.push({ id: "b1", bookId: "bk", name: "Dominion Energy", amount: 240, catId: "c_gas", dueDay: 20, active: true, deleted: false });
  const s = c.ledgerSuggest({ date: "2026-08-20", dir: "out", amount: 236.4, desc: "DOMINION ENERGY BILLPAY" });
  eq("a near-amount match to a known bill is a medium suggestion", s.confidence, "medium");
  ok("...named", /Dominion Energy/.test(s.why), s.why);
  const off = c.ledgerSuggest({ date: "2026-08-20", dir: "out", amount: 12, desc: "DOMINION ENERGY BILLPAY" });
  ok("⛔ a wildly different amount is not that bill", off.confidence !== "medium" || !/Dominion/.test(off.why), off);
  const inn = c.ledgerSuggest({ date: "2026-08-20", dir: "in", amount: 240, desc: "DOMINION ENERGY REFUND" });
  ok("⛔ money coming in is never a bill payment", !/Dominion Energy” bill/.test(inn.why));
}

console.log("\n--- the queue, and what it tells him before he starts ---");
{
  const st = store(), c = sandbox(st);
  c.ledgerIngest([
    row({ date: "2026-08-10", amount: 20 }),
    row({ date: "2026-08-22", amount: 30, desc: "WAWA 88" }),
    { date: "2026-08-21", dir: "in", amount: 1500, desc: "DIRECT DEP EMPLOYER" }
  ], { bookId: "bk" });
  const inbox = c.ledgerInbox();
  eq("everything waiting is in the queue", inbox.length, 3);
  ok("newest first — he reviews what just happened, not last month", inbox[0].date === "2026-08-22", inbox.map(t => t.date));

  const tot = c.ledgerInboxTotals();
  eq("it totals what's coming in", tot.in, 1500);
  eq("...and going out", tot.out, 50);
  eq("...and how many it can't place", tot.unrecognized, 3);

  c.ledgerReject(inbox[0].id);
  eq("rejecting removes it from the queue", c.ledgerInboxCount(), 2);
  ok("⛔ ...by soft delete — this app never hard-deletes a record", st.p.budgetTx.find(t => t.id === inbox[0].id).deleted === true);
  eq("...and it never reaches the budget", c.actBudgetTx().length, 0);
  ok("⛔ an already-approved row can't be re-approved or rejected",
    c.ledgerApprove(inbox[0].id) === null && c.ledgerReject(inbox[0].id) === null);
}

console.log("\n--- the review screen ---");
{
  ok("⭐ every row shows WHY it was suggested", /suggestion \|\| \{\}\)\.why/.test(CODE(UI)) && /esc\(why\)/.test(CODE(UI)));
  ok("⭐ recognized and new payees are separated", /Recognized/.test(UI) && /New payees/.test(UI));
  ok("⭐ ...only the recognized group gets a bulk approve", /Approve all/.test(UI));
  /* the bulk button is built per GROUP and only passed the recognized list — there is no all-inbox path */
  ok("⛔ ...and there is no button that approves both groups at once",
    !/lrApproveAll|ledgerApproveMany\(/.test(CODE(UI)) && /lrGroup\("New payees", unknown,[\s\S]{0,140}""\)/.test(CODE(UI)));
  ok("⚠️ bulk approve reads each row's ON-SCREEN category, not the stored suggestion",
    /lrApproveGroup[\s\S]{0,400}getElementById\("lrcat_"/.test(UI));
  ok("it says plainly that none of it is in the budget yet", /None of this is in your budget yet/.test(UI));
  ok("the empty state says what the queue is for", /Nothing waiting/.test(UI) && /until you approve/.test(UI));
  ok("a transfer/card-payment row offers no category at all", /Won\\'t count as income or spending/.test(UI));
}

console.log("\n--- wiring ---");
{
  ok("both modules are in the shell", /js\/143-ledger\.js/.test(SHELL) && /js\/144-ledger-review\.js/.test(SHELL));
  ok("the engine loads before the screen that uses it", SHELL.indexOf("143-ledger.js") < SHELL.indexOf("144-ledger-review.js"));
  ok("⭐ Review is a Budget sub-tab", /budgetSetSub\(\\?'review\\?'\)/.test(BUD), (BUD.match(/.{0,30}review.{0,20}/) || [])[0]);
  ok("...carrying the count, so it can't be missed", /ledgerInboxCount/.test(CODE(BUD)));
  ok("⭐ ...and it only exists while something is waiting", /_pend\?\(/.test(CODE(BUD)));
  ok("...falling back off the tab when the queue empties", /!_pend&&BUDGET_SUB==="review"/.test(CODE(BUD)));

  /* ⚠️ the import used to write straight into budgetTx — a CSV silently moved every envelope on read */
  ok("⭐ the CSV importer now goes through the ledger", /ledgerIngest/.test(CODE(CSV)));
  ok("⛔ ...and no longer pushes transactions itself", !/d\.budgetTx\.push/.test(CODE(CSV)), (CODE(CSV).match(/.*budgetTx\.push.*/) || [])[0]);
  ok("⛔ ...nor writes a rule at import time", !/budgetMemoRemember\(/.test(CODE(CSV).split("function budgetMemoRemember")[1] || ""));
  ok("it lands him on the Review tab", /BUDGET_SUB=res\.added\?"review"/.test(CODE(CSV)));
  ok("...and tells him how many were already there", /duplicates/.test(CODE(CSV)));

  ok("⭐ cash basis is stated as the rule, not left implied", /CASH BASIS/.test(LEDGER) && /date the cash actually moved/i.test(LEDGER));
  ok("...including that a bill is a forecast, never a posted liability", /forecast/i.test(LEDGER));
  ok("a bank feed has a door to come in through", /"bank"/.test(LEDGER) && /externalId/.test(CODE(LEDGER)));
}

console.log("\n--- ⭐⭐ both legs of a transfer, from one bank pull ---");
{
  /* Ray, 2026-08-27: "i want you to keep and track all of them. you should be able to catch the transactions
     moving between accounts, thats actually good for reconciliation."

     ⚠️ IT DIDN'T. ledgerFindTransfer skipped pending rows — and a bank pull delivers BOTH legs in the same
     batch, where everything lands pending. So every candidate mate was pending, every one was skipped, and
     the FIRST import (the one carrying months of history and every internal transfer in it) detected zero.
     Reproduced before fixing: $412.55 out of checking and $412.55 into the card, same day, same batch, both
     came back suggestTransfer:false. */
  const mk = () => {
    const vm = require("vm"), c = { console }; c.window = c;
    const D = { budgetTx: [], budgetCats: [], budgetMemo: [], budgetBills: [],
      budgetBooks: [{ id: "bk1", name: "Personal", deleted: false }],
      budgetAccounts: [
        { id: "chk", name: "EveryDay Checking", type: "checking", deleted: false },
        { id: "visa", name: "Visa", type: "credit", deleted: false },
        { id: "loan", name: "Used Vehicle Loan", type: "loan", deleted: false },
        { id: "sav", name: "Share Savings", type: "savings", deleted: false }] };
    c.D = () => D; c.uid = () => "u" + Math.floor(Math.random() * 1e9);
    c.now = () => 1756252800000; c.today = () => "2026-08-27";
    c.touch = o => { o.updatedAt = 1756252800000; }; c.save = () => {};
    vm.createContext(c);
    vm.runInContext(require("fs").readFileSync("js/143-ledger.js", "utf8"), c);
    return { c, D };
  };

  const { c, D } = mk();
  c.ledgerIngest([
    { externalId: "a", date: "2026-08-05", amount: 412.55, dir: "out", desc: "NFCU LOAN PMT", accountId: "chk" },
    { externalId: "b", date: "2026-08-05", amount: 412.55, dir: "in",  desc: "AUTO LOAN PAYMENT", accountId: "loan" },
    { externalId: "e", date: "2026-08-14", amount: 64.03,  dir: "out", desc: "LOWES #1234 KITTY HAWK NC", accountId: "visa" },
    { externalId: "f", date: "2026-08-15", amount: 25.00,  dir: "out", desc: "TRANSFER TO SAVINGS", accountId: "chk" },
    { externalId: "g", date: "2026-08-15", amount: 25.00,  dir: "in",  desc: "TRANSFER FROM CHECKING", accountId: "sav" }
  ], { source: "bank" });
  const by = x => D.budgetTx.find(t => t.externalId === x);

  ok("⭐⭐ the LATER leg spots its partner", by("b").suggestTransfer === true);
  ok("⭐⭐ and so does the EARLIER one — the back-fill pass, or half of every pair looks ordinary",
    by("a").suggestTransfer === true);
  ok("...same for a plain savings transfer, both ways",
    by("f").suggestTransfer === true && by("g").suggestTransfer === true);
  ok("⛔ a REAL purchase on the card is not swept up in it", by("e").suggestTransfer === false);
  ok("...and still gets its own honest suggestion", /new payee/.test(by("e").suggestion.why));
  ok("⚠️ the back-filled reason says where the partner came from", /came in on the same pull/.test(by("a").suggestion.why));
  ok("⛔ nothing is counted yet — every row is still pending", D.budgetTx.every(t => t.pending === true));

  c.ledgerApprove(by("a").id);
  ok("⭐ approving one leg reaches across and flags the other", by("b").isTransfer === true);
  ok("...with a shared transferId", !!by("a").transferId && by("a").transferId === by("b").transferId);
  c.ledgerApprove(by("b").id);
  ok("⭐⭐ approving the SECOND leg does not undo the pairing", by("b").isTransfer === true && by("a").isTransfer === true,
    JSON.stringify({ a: by("a").isTransfer, b: by("b").isTransfer }));
  ok("...and they still share one id", by("a").transferId === by("b").transferId);
  ok("⛔ neither leg carries a category — that is how one dollar becomes two",
    by("a").catId === "" && by("b").catId === "");

  const { c: c2, D: D2 } = mk();
  c2.ledgerIngest([
    { externalId: "x", date: "2026-08-05", amount: 50, dir: "out", desc: "MOVE", accountId: "chk" },
    { externalId: "y", date: "2026-08-05", amount: 50, dir: "in",  desc: "MOVE", accountId: "sav" }
  ], { source: "bank" });
  const rowX = D2.budgetTx.find(t => t.externalId === "x");
  c2.ledgerApprove(rowX.id, { isTransfer: false, catId: "" });
  ok("⭐ he can overrule it — an explicit false stays false", rowX.isTransfer === false);

  ok("⚠️ the pending-blindness is written down where it would be reinstated",
    /PENDING ROWS COUNT AS CANDIDATES/.test(require("fs").readFileSync("js/143-ledger.js", "utf8")));
  ok("⛔ and the clobber that came apart on the second approval",
    /DO NOT CLOBBER A FLAG THE OTHER LEG ALREADY SET/.test(require("fs").readFileSync("js/143-ledger.js", "utf8")));
}

console.log("\n--- ⛔ the same purchase, arriving twice from two sources ---");
{
  /* ⚠️ CAUGHT BEFORE RAY'S FIRST PLAID PULL, NOT AFTER. He has 263 transactions imported from Navy Federal
     STATEMENTS — none carrying an externalId, because a PDF hasn't got one — and 84 of them fall inside the
     window Plaid was about to return. The old rule was "if the incoming row has an id, only compare it to
     rows that also have an id." Statement rows have none, so not one of those 84 could match, and two months
     of his real spending would have been counted TWICE — silently, in the direction of looking poorer than
     he is, in the numbers he is about to make decisions from. */
  const vm = require("vm"), fs = require("fs");
  const mk = (hist) => {
    const c = { console }; c.window = c;
    const D = { budgetTx: hist, budgetCats: [], budgetMemo: [], budgetBills: [],
      budgetBooks: [{ id: "bk1", name: "Personal", deleted: false }],
      budgetAccounts: [{ id: "chk", name: "Checking", type: "checking", deleted: false },
                       { id: "sav", name: "Savings", type: "savings", deleted: false }] };
    c.D = () => D; c.uid = () => "u" + Math.floor(Math.random() * 1e9);
    c.now = () => 1756252800000; c.today = () => "2026-08-27";
    c.touch = o => { o.updatedAt = 1756252800000; }; c.save = () => {};
    vm.createContext(c); vm.runInContext(fs.readFileSync("js/143-ledger.js", "utf8"), c);
    return { c, D };
  };
  const stmt = (id, date, amount, note) => ({ id, accountId: "chk", date, amount, dir: "out", note,
    source: "nfcu-stmt", pending: false, deleted: false, catId: "" });

  /* ⭐ THE PAYEE TEST, ON HIS ACTUAL STRINGS. Whole-string matching caught 33 of 84 overlaps; these are the
     three shapes that made up the other 51. */
  const { c } = mk([]);
  const same = c.ledgerSamePayee;
  ok("⭐⭐ 'Walmart' matches 'POS Debit - Debit Card 9185 Transaction 06-02-26 Wal-Mart #2'",
    same("Walmart", "POS Debit - Debit Card 9185 Transaction 06-02-26 Wal-Mart #2"));
  ok("⭐⭐ the ACH pair, which share no prefix at all — only 'idahohousingmtgpmt' in the middle",
    same("ACH Transaction - IDAHO HOUSING MTGPMT 38356154 ACH DEBIT", "Paid To - Idaho Housing Mtgpmt Chk 12400005"));
  ok("⭐ a truncated merchant name still matches",
    same("Cke Noosa Scoops K Kill Devil", "POS Debit- Debit Card 9185 05-29-26 Cke*noosa Scoops K Kill"));
  ok("⛔ two genuinely different merchants do NOT match", !same("Walmart", "Harris Teeter"));
  ok("⛔ ...and statement boilerplate alone is not enough to match on",
    !same("POS Debit - Debit Card 9185 Transaction 06-02-26 Lowes", "POS Debit - Debit Card 9185 Transaction 06-02-26 Wendys"));
  ok("⚠️ the 8-char run threshold is deliberate", /8 is deliberate/.test(fs.readFileSync("js/143-ledger.js", "utf8")));
  /* ⚠️ AND THE BOILERPLATE THRESHOLD WAS MEASURED, NOT PICKED. At 8, "Transfer from…" (12 chars) counted as
     boilerplate and wrongly split four of his REAL transfers — "Transfer from THEMEFORGE LLC TFR FR OTHER"
     against "Transfer From Checking", $11,600 between them, landing straight on his balances. */
  ok("⭐⭐ 'Transfer from THEMEFORGE LLC TFR FR OTHER' matches 'Transfer From Checking'",
    same("Transfer from THEMEFORGE LLC TFR FR OTHER", "Transfer From Checking"));
  ok("...and the reverse direction too", same("Transfer to THEMEFORGE LLC TRF TO OTHER", "Transfer To Checking"));
  ok("⚠️ 20 is the boilerplate threshold, and the measurement behind it is recorded",
    /20, NOT 8 — MEASURED, NOT PICKED/.test(fs.readFileSync("js/143-ledger.js", "utf8")));
  ok("empty descriptions never match", !same("", "anything") && !same("x", ""));

  /* ⭐ ADOPTION: the historical row takes the id, so this is settled once rather than re-guessed forever */
  const hist = [stmt("h1", "2026-06-03", 23.13, "POS Debit - Debit Card 9185 Transaction 06-02-26 Wal-Mart #2")];
  const { c: c2, D: D2 } = mk(hist);
  const r1 = c2.ledgerIngest([{ externalId: "plaid-1", date: "2026-06-03", amount: 23.13, dir: "out", desc: "Walmart", accountId: "chk" }], { source: "bank" });
  ok("⭐⭐ the statement row claims the Plaid row — not counted twice", r1.added === 0 && r1.duplicates === 1,
    JSON.stringify(r1));
  ok("⭐⭐ ...and ADOPTS its id, so the next sync matches on the exact path", D2.budgetTx[0].externalId === "plaid-1");
  ok("...noting where the reconciliation came from", D2.budgetTx[0].reconciledFrom === "bank");
  ok("⛔ the ledger did not grow", D2.budgetTx.length === 1);

  /* re-running the same pull must now be a plain id match, not a second fuzzy one */
  const r2 = c2.ledgerIngest([{ externalId: "plaid-1", date: "2026-06-03", amount: 23.13, dir: "out", desc: "Walmart", accountId: "chk" }], { source: "bank" });
  ok("⭐ a repeat pull is an exact-id duplicate", r2.added === 0 && r2.duplicates === 1 && D2.budgetTx.length === 1);

  /* ⚠️ ONE-TO-ONE: two identical coffees are two coffees */
  const { c: c3, D: D3 } = mk([stmt("c1", "2026-06-04", 4.50, "COFFEE SHOP"), stmt("c2", "2026-06-04", 4.50, "COFFEE SHOP")]);
  const r3 = c3.ledgerIngest([
    { externalId: "p-a", date: "2026-06-04", amount: 4.50, dir: "out", desc: "Coffee Shop", accountId: "chk" },
    { externalId: "p-b", date: "2026-06-04", amount: 4.50, dir: "out", desc: "Coffee Shop", accountId: "chk" }
  ], { source: "bank" });
  ok("⭐⭐ two identical historical rows absorb two identical incoming rows — one each",
    r3.added === 0 && r3.duplicates === 2 && D3.budgetTx.length === 2, JSON.stringify(r3));
  ok("...and each got a DIFFERENT id", D3.budgetTx[0].externalId !== D3.budgetTx[1].externalId);

  /* and when there is only ONE historical coffee, the second real coffee is genuinely new */
  const { c: c4, D: D4 } = mk([stmt("c1", "2026-06-04", 4.50, "COFFEE SHOP")]);
  const r4 = c4.ledgerIngest([
    { externalId: "q-a", date: "2026-06-04", amount: 4.50, dir: "out", desc: "Coffee Shop", accountId: "chk" },
    { externalId: "q-b", date: "2026-06-04", amount: 4.50, dir: "out", desc: "Coffee Shop", accountId: "chk" }
  ], { source: "bank" });
  ok("⭐⭐ one historical row absorbs one; the second is correctly ADDED, not swallowed",
    r4.added === 1 && r4.duplicates === 1 && D4.budgetTx.length === 2, JSON.stringify(r4));

  /* the guards that stop a coincidence being treated as a match */
  const { c: c5, D: D5 } = mk([stmt("d1", "2026-06-04", 4.50, "COFFEE SHOP")]);
  c5.ledgerIngest([{ externalId: "z1", date: "2026-06-04", amount: 4.50, dir: "out", desc: "Coffee Shop", accountId: "sav" }], { source: "bank" });
  ok("⛔ a different ACCOUNT is never a match, however alike", D5.budgetTx.length === 2);
  const { c: c6, D: D6 } = mk([stmt("e1", "2026-06-04", 4.50, "COFFEE SHOP")]);
  c6.ledgerIngest([{ externalId: "z2", date: "2026-06-04", amount: 4.50, dir: "in", desc: "Coffee Shop", accountId: "chk" }], { source: "bank" });
  ok("⛔ nor the opposite direction — a refund is not the purchase", D6.budgetTx.length === 2);
  const { c: c7, D: D7 } = mk([stmt("f1", "2026-06-04", 4.51, "COFFEE SHOP")]);
  c7.ledgerIngest([{ externalId: "z3", date: "2026-06-04", amount: 4.50, dir: "out", desc: "Coffee Shop", accountId: "chk" }], { source: "bank" });
  ok("⛔ nor a one-cent difference", D7.budgetTx.length === 2);
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
