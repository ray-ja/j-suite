/* money-card-tests.js — the money block on the personal Today: balances + the next two weeks of bills.

   Ray, 2026-08-25, with a screenshot: "the bills / money area, lets spruce it up. make it show upcoming
   bills over the next 2 weeks, have it show account balances for obx lot solutions, my personal account,
   and my business account. make it easier to read. its a wall of small text. lots of unneeded info in
   there. make it easier to scan, not read."

   WHAT THIS DEFENDS:

   1. ⭐ SCAN, NOT READ. Every bill used to drag its note along — a paragraph of loan numbers and escrow
      arithmetic in 11px, to say one number is due. One line per bill, three fixed columns, nothing wraps.

   2. ⚠️ NEVER INVENT A BALANCE. All three of his accounts sit at 0 because he has never entered one.
      Printing "$0.00" three times would be a fabrication in the one place it would do real damage — he
      would read it as his money. Unset renders as "Set balance" and taps into the editor.

   3. ⚠️ THE BOOK FILTER. actBudgetAccounts()/actBudgetTx() are scoped to the SELECTED budget book. Today is
      not inside a book, so using them would silently show one account instead of three.

   Pure node. Run: node money-card-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
/* strip comments before asserting on source — I have repeatedly written tests that passed by matching my
   own explanatory prose, including the comment that names the thing it says was removed */
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SRC = R("js/142-money-card.js"), CAL = R("js/126-calendar.js"), HOME = R("js/122-personal-home.js");
const SHELL = R("Business App (v1).html");
const TODAY = "2026-08-25";

function sandbox(store) {
  const ctx = {
    console, S: store, BIZ: "p", today: () => TODAY, window: {},
    esc: s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  };
  ctx.D = () => store.p;
  vm.createContext(ctx);
  vm.runInContext(CAL, ctx);
  vm.runInContext(SRC, ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}
/* his real shape: three accounts in three books, monthly bills keyed by day-of-month */
const store = () => ({ p: {
  budgetBooks: [
    { id: "bk-personal", name: "Personal" },
    { id: "bk-jam", name: "Jamieson Automation" },
    { id: "bk-obx", name: "OBX Lot Solutions" }
  ],
  budgetAccounts: [
    { id: "a1", bookId: "bk-personal", name: "Navy Federal — checking", type: "checking", balance: 0, order: 0 },
    { id: "a2", bookId: "bk-jam", name: "Navy Federal — business (ThemeForge)", type: "checking", balance: 0, order: 1 },
    { id: "a3", bookId: "bk-obx", name: "Square — OBX Lot Solutions", type: "checking", balance: 0, order: 2 }
  ],
  budgetTx: [],
  budgetBills: [
    { id: "b1", name: "Iowa mortgage (Johnston, IA rental)", amount: 2413, dueDay: 1,
      note: "Loan #1900642651 · 5.125% · principal balance $282,797.73 (Aug 2026). P&I $1,637.27 + ESCROW $775.73 = $2,413.00, due the 1st." },
    { id: "b2", name: "Groceries — Brooke", amount: 650, dueDay: 1, note: "monthly transfer" },
    { id: "b3", name: "SeaWorld pass", amount: 47.5, dueDay: 6, note: "fixed monthly" },
    { id: "b4", name: "Dominion Energy", amount: 240, dueDay: 20, note: "varies with season" }
  ]
} });

console.log("\n--- ⭐ scan, not read: one line per bill and nothing else ---");
{
  const c = sandbox(store());
  const html = c.mcBillsHTML();

  ok("the next two weeks are covered", /Iowa mortgage/.test(html) && /Groceries/.test(html) && /SeaWorld/.test(html));
  eq("...and two weeks means fourteen days", c.MC_DAYS, 14);
  ok("⛔ a bill due outside the window is not shown", !/Dominion/.test(html), "Sep 20 is 26 days out");

  /* THE WALL OF TEXT — the entire reason he asked */
  ok("⛔ NO note text anywhere", !/1900642651|principal balance|ESCROW|monthly transfer|fixed monthly/.test(html), html.slice(0, 400));
  ok("⛔ ...not even the short ones", !/note/i.test(html));

  /* ⭐ the qualifier that only matters on a page listing everything */
  ok("⭐ a bill's parenthetical is dropped", /Iowa mortgage</.test(html) && !/Johnston/.test(html));
  eq("...by rule, not by special case", c.mcBillName("Car loan (business acct)"), "Car loan");
  eq("a name with no parenthetical is untouched", c.mcBillName("SeaWorld pass"), "SeaWorld pass");
  eq("a name that is ONLY a parenthetical keeps something", c.mcBillName("(unnamed)"), "(unnamed)");
  eq("a missing name doesn't render blank", c.mcBillName(""), "bill");

  ok("⭐ amounts line up as a column", (html.match(/tabular-nums/g) || []).length >= 4);
  ok("⭐ nothing wraps — a wrapped row breaks the column", /white-space:nowrap;overflow:hidden;text-overflow:ellipsis/.test(html));
  ok("the total is shown once, at the top", (html.match(/\$3,110\.50/g) || []).length === 1, html.match(/\$[\d,]+\.\d\d/g));
  ok("...and it is the sum of what's listed", /\$3,110\.50/.test(html));
}

console.log("\n--- dates come off the ISO string, never through Date() ---");
{
  const c = sandbox(store());
  eq("today says today", c.mcWhen("2026-08-25", 0), "today");
  eq("tomorrow is short enough for a 52px column", c.mcWhen("2026-08-26", 1), "tmrw");
  eq("anything else is a date", c.mcWhen("2026-09-01", 7), "Sep 1");
  eq("⭐ ...parsed from the STRING, so a timezone can't move a bill a day", c.mcWhen("2026-01-31", 9), "Jan 31");
  eq("December doesn't fall off the end of the month table", c.mcWhen("2026-12-05", 9), "Dec 5");
  ok("⛔ no Date parsing of an ISO day anywhere in the module", !/new Date\((?!\))/.test(CODE(SRC)), (CODE(SRC).match(/new Date\([^)]+\)/) || [])[0]);

  const html = c.mcBillsHTML();
  ok("a bill due within 3 days is flagged", /var\(--danger\)/.test(sandbox({ p: Object.assign(store().p, {
    budgetBills: [{ id: "x", name: "Rent", amount: 100, dueDay: +TODAY.slice(8, 10) + 1 }] }) }).mcBillsHTML()));
  ok("...and one further out is not shouted about", !/danger/.test(html.split("Iowa mortgage")[0].split("border-top").pop() || ""));
}

console.log("\n--- ⚠️ balances: never invent one ---");
{
  const c = sandbox(store());
  const html = c.mcBalancesHTML();

  /* HIS LIVE STATE: three accounts, every balance zero because he has never entered one */
  ok("⛔ it does NOT print $0 as if that were his money", !/\$0/.test(html), html);
  /* ⭐ CHANGED 2026-08-25: the prompt is Reconcile, not "Set balance". A balance you type is stale the
     moment you type it — which is exactly why all three of his accounts sat at zero. Reconciling to a
     statement gives a dated fact, and everything after it is arithmetic (js/145). */
  ok("⭐ ...it offers to reconcile the account", (html.match(/Reconcile</g) || []).length === 3, html);
  ok("⛔ ...and no longer asks him to type a number", !/Set&nbsp;balance/.test(html));
  ok("...tapping it opens the reconcile dialog", /mcOpenAccount\('a1'\)/.test(html) && /openReconcile/.test(CODE(SRC)));
  ok("the editor is the app's own, not a second one that could drift", /openBudgetAccount/.test(CODE(SRC)));

  /* ⭐ the three he named: "obx lot solutions, my personal account, and my business account" */
  ok("⭐ all three accounts appear", /Personal/.test(html) && /Jamieson/.test(html) && /OBX/.test(html), html);
  eq("a short book name is used whole", c.mcAccountLabel({ bookId: "bk-personal" }), "Personal");
  eq("⭐ a long one drops to its first word rather than ellipsising to nothing",
    c.mcAccountLabel({ bookId: "bk-jam" }), "Jamieson");
  eq("...same for OBX", c.mcAccountLabel({ bookId: "bk-obx" }), "OBX");
  eq("an account with no book falls back to its own name", c.mcAccountLabel({ name: "Wallet" }), "Wallet");
  eq("...and the bank prefix is dropped from that fallback", c.mcAccountLabel({ name: "Navy Federal — checking" }), "Navy");

  /* now give them real balances */
  const s2 = store();
  s2.p.budgetAccounts[0].balance = 4182.10;
  s2.p.budgetAccounts[1].balance = 1268.44;
  s2.p.budgetAccounts[2].balance = 317.90;
  const filled = sandbox(s2).mcBalancesHTML();
  ok("a set balance shows as a number", /\$4,182/.test(filled) && /\$1,268/.test(filled) && /\$318/.test(filled), filled);
  ok("⭐ ...to the dollar, because cents are noise in a three-number glance", !/\$4,182\.10/.test(filled));
  ok("...and no longer offers to set it", !/Set&nbsp;balance/.test(filled));

  const s3 = store();
  s3.p.budgetAccounts[0].balance = -412.5;
  ok("a negative balance is called out", /var\(--danger\)/.test(sandbox(s3).mcBalancesHTML()));

  /* ⚠️ the book filter — the bug this would have had if it used the normal helpers */
  ok("⭐ it reads budgetAccounts directly, NOT the book-scoped helper",
    /D\(\)\.budgetAccounts/.test(CODE(SRC)) && !/actBudgetAccounts\(/.test(CODE(SRC)));
  ok("...and the reason is recorded so it isn't 'tidied' back", /SELECTED book/.test(SRC));

  /* a debt-only card is a debt, not an account he spends from */
  const s4 = store();
  s4.p.budgetAccounts.push({ id: "a4", bookId: "bk-personal", name: "Old Visa", type: "credit", debtOnly: true, balance: -9000 });
  ok("⛔ a debt-only card is not one of his spending accounts", !/Old Visa/.test(sandbox(s4).mcBalancesHTML()));
}

console.log("\n--- the block as a whole ---");
{
  const c = sandbox(store());
  const html = c.moneyCardHTML();
  ok("it carries one heading", (html.match(/<h2/g) || []).length === 1 && /Money/.test(html));
  ok("...with a way through to the full budget", /mcGoBudget/.test(html));
  ok("⭐ the Budget button is pushed to the far edge, not jammed against the heading", /<h2[^>]*>Money<\/h2><div class="grow">/.test(html));
  ok("balances come before bills — what he HAS, then what's leaving", html.indexOf("Personal") < html.indexOf("Next 2 weeks"));

  const empty = sandbox({ p: { budgetBooks: [], budgetAccounts: [], budgetBills: [], budgetTx: [] } });
  eq("⭐ no budget set up at all renders NOTHING, not an empty shell", empty.moneyCardHTML(), "");

  const noBills = sandbox({ p: Object.assign(store().p, { budgetBills: [] }) });
  ok("accounts but no bills still shows the accounts", /Personal/.test(noBills.moneyCardHTML()));
  ok("...and doesn't claim a total of zero", !/\$0\.00/.test(noBills.moneyCardHTML()));
}

console.log("\n--- wiring ---");
{
  ok("the module is registered in the shell", /js\/142-money-card\.js/.test(SHELL));
  ok("...after the routine it sits beside", SHELL.indexOf("js/142-money-card.js") > SHELL.indexOf("js/141-routine.js"));
  ok("⭐ Today uses it for the left column", /moneyCardHTML\(\)/.test(CODE(HOME)));
  ok("⭐ ...and falls back to the old card if the module is missing, so Today never loses money entirely",
    /typeof moneyCardHTML === "function"[\s\S]{0,180}calBillsCardHTML/.test(CODE(HOME)));
  ok("⛔ the raw bills card is no longer what Today calls first",
    !/^\s*if \(typeof calBillsCardHTML === "function"\) side \+= calBillsCardHTML/m.test(CODE(HOME)));
  ok("the calendar page keeps its own bills card, untouched", /function calBillsCardHTML/.test(CAL));
  ok("it never writes — a glance card that mutates is how data gets lost",
    !/\.push\(|save\(\)|touch\(/.test(CODE(SRC).replace(/openBudgetAccount/g, "")));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
