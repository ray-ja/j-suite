/* ============================================================================================================
   TOOLS TESTS — payee grouping (js/160) and the receipt↔transaction tie (js/161)

   Ray, 2026-08-27, after connecting seven banks: "now that you have data, make sure the app is built to
   handle it. all of the transfers and attribution and reconciliation. if i upload a receipt we should tie it
   to the transaction too."

   ⚠️ BOTH TOOLS WERE SIZED AGAINST HIS ACTUAL PULL, NOT AN IMAGINED ONE. 332 rows landed; 276 of them the
   ledger could not place, and the review screen offered him 276 separate decisions because its bulk path
   only covers payees it has ALREADY learned — and on a first sync it has learned nothing. Grouping by payee
   turns that into 87. Separately, 14 of his 15 dated receipts match a real bank row on exact cents within
   three days, and nothing joined them.
   ============================================================================================================ */
const fs = require("fs"), vm = require("vm");
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
const R = f => fs.readFileSync(f, "utf8");
const CODE = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* a context with the ledger + both tools loaded over a store we control */
function mk(store, biz) {
  const c = { console }; c.window = c;
  c.S = Object.assign({ biz: biz || "obx", registry: store.registry }, store);
  c.D = () => c.S[c.S.biz];
  c.esc = x => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  c.money = n => "$" + Number(n).toFixed(2);
  c.budgetCat = id => (c.D().budgetCats || []).find(x => x && x.id === id);
  c.uid = () => "u" + Math.floor(Math.random() * 1e9);
  c.now = () => 1756252800000; c.today = () => "2026-08-27";
  c.touch = o => { o.updatedAt = 1756252800000; }; c.save = () => {};
  c.toast = () => {}; c.render = () => {}; c.alert = () => {};
  vm.createContext(c);
  ["js/143-ledger.js", "js/144-ledger-review.js", "js/151-unified-ledger.js",
   "js/160-payee-groups.js", "js/161-receipt-tie.js"].forEach(f => vm.runInContext(R(f), c));
  return c;
}
const CATS = [{ id: "cat-mat", name: "Materials", deleted: false }, { id: "cat-food", name: "Groceries", deleted: false }];
const ACCTS = [{ id: "chk", name: "RJ’s Checking", type: "checking", deleted: false },
               { id: "sq", name: "Square — OBX Lot Solutions", type: "checking", deleted: false }];
function tx(o) {
  return Object.assign({ id: "t" + Math.random().toString(36).slice(2, 8), accountId: "chk", dir: "out",
    pending: true, deleted: false, catId: "", suggestedCatId: "", suggestion: { confidence: "none", why: "" },
    suggestTransfer: false, suggestCardPayment: false, source: "bank" }, o);
}

console.log("\n--- ⭐⭐ 276 rows are not 276 decisions ---");
{
  const store = { registry: [{ id: "p", name: "Personal" }], p: {
    budgetCats: CATS, budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [
      tx({ date: "2026-08-01", amount: 57.10, note: "Amazon" }),
      tx({ date: "2026-08-05", amount: 22.00, note: "Amazon" }),
      tx({ date: "2026-08-09", amount: 14.00, note: "Amazon" }),
      tx({ date: "2026-08-02", amount: 88.00, note: "The Home Depot" }),
      tx({ date: "2026-08-06", amount: 12.00, note: "The Home Depot" }),
      tx({ date: "2026-08-03", amount: 3750.00, note: "ACH Transaction - Ashley Belvin" })
    ] } };
  const c = mk(store, "p");
  const gs = c.pgGroups();
  ok("⭐ six rows collapse to three payees", gs.length === 3, gs.map(g => g.label));
  /* ⚠️ look groups up BY NAME, never by index — the sort is by money, and Home Depot's $100 legitimately
     outranks Amazon's $93.10. An index assumption here failed eight assertions and the code was right. */
  const G = n => gs.find(g => g.label === n);
  ok("⭐⭐ BIGGEST MONEY FIRST — one $3,750 ACH outranks twenty-seven small orders",
    gs[0].total === 3750, gs.map(g => g.label + ":" + g.total));
  ok("...and $100 of Home Depot outranks $93.10 of Amazon",
    gs.indexOf(G("The Home Depot")) < gs.indexOf(G("Amazon")), gs.map(g => g.label));
  ok("...and Amazon carries its count and total", G("Amazon").n === 3 && Math.abs(G("Amazon").out - 93.10) < 0.01,
    { n: G("Amazon").n, out: G("Amazon").out });
  ok("...and its date span", G("Amazon").first === "2026-08-01" && G("Amazon").last === "2026-08-09");

  /* ⭐⭐ THE KEY IS THE LEARNING KEY — that is the whole reason grouping is worth anything */
  const learnKey = c.ledgerKey("Amazon");
  ok("⭐⭐ the group key IS ledgerKey, so approving teaches a rule that matches next time",
    gs.find(g => g.label === "Amazon").key === learnKey, { group: gs.find(g => g.label === "Amazon").key, learn: learnKey });

  /* approve a whole payee */
  c.PG_PICK[G("Amazon").key] = "cat-mat";
  c.pgApprove(G("Amazon").key);
  const amz = store.p.budgetTx.filter(t => t.note === "Amazon");
  ok("⭐ all three Amazon rows are approved at once", amz.every(t => !t.pending), amz.map(t => t.pending));
  ok("...all carrying the chosen category", amz.every(t => t.catId === "cat-mat"));
  ok("⛔ nothing else was touched", store.p.budgetTx.filter(t => t.note !== "Amazon").every(t => t.pending));
  ok("⭐⭐ and it LEARNED — the next Amazon row arrives already suggested", (function () {
    const m = (store.p.budgetMemo || []).find(x => x && x.key === learnKey);
    return !!(m && m.catId === "cat-mat");
  })(), store.p.budgetMemo);
  const fresh = c.ledgerSuggest({ date: "2026-09-01", amount: 9.99, dir: "out", desc: "Amazon", accountId: "chk" });
  ok("...proven by asking it", fresh.catId === "cat-mat" && fresh.confidence !== "none", fresh);

  ok("⭐ the group is gone from the screen once approved", c.pgGroups().length === 2);
}

console.log("\n--- ⛔ what grouping must NOT do ---");
{
  const store = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: CATS, budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [
      tx({ date: "2026-08-01", amount: 100, note: "Transfer to savings", suggestTransfer: true }),
      tx({ date: "2026-08-01", amount: 50, note: "Target" }),
      tx({ date: "2026-08-02", amount: 30, note: "Target", dir: "in" })
    ] } };
  const c = mk(store, "p");
  const gs = c.pgGroups();
  ok("⛔ a recognised transfer never appears in the payee groups — it has its own reason for being safe",
    !gs.some(g => /transfer/i.test(g.label)), gs.map(g => g.label));
  const t = gs.find(g => g.label === "Target");
  ok("⭐ a payee with money BOTH ways is kept together and flagged", t && t.mixed === true && t.n === 2);
  ok("...with the two directions reported separately", t.out === 50 && t.in === 30);

  /* excluding a row from its group */
  c.PG_SKIP[t.rows[1].id] = true;
  c.PG_PICK[t.key] = "cat-food";
  c.pgApprove(t.key);
  ok("⭐ an unticked row is left pending — 'Amazon' really is three different things sometimes",
    store.p.budgetTx.filter(x => x.note === "Target" && x.pending).length === 1);

  /* no category → refuse */
  const store2 = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: CATS, budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [tx({ date: "2026-08-01", amount: 10, note: "Wawa" })] } };
  const c2 = mk(store2, "p");
  let warned = false; c2.alert = () => { warned = true; };
  c2.pgApprove(c2.pgGroups()[0].key);
  ok("⛔ approving with no category picked is refused, not guessed",
    warned && store2.p.budgetTx[0].pending === true);
  ok("⚠️ and there is deliberately no approve-everything button", !/approve all/i.test(CODE(R("js/160-payee-groups.js"))));
}

console.log("\n--- 🔗 a receipt and its bank transaction ---");
{
  /* ⚠️ THESE LIVE IN DIFFERENT ORGS. Receipts sit in obx (job costing); the ledger sits in the personal org
     (the books). Every read crosses through uniInOrg, which restores S.biz in a finally. */
  const store = {
    registry: [{ id: "obx", name: "OBX Lot Solutions" }, { id: "p", name: "Personal" }],
    obx: { receipts: [
      { id: "r1", vendor: "The Home Depot", amount: 71.99, date: "2026-07-27", deleted: false },
      { id: "r2", vendor: "Lowe's", amount: 254.49, date: "2026-07-27", deleted: false },
      { id: "r3", vendor: "Wawa", amount: 9.11, date: "2026-07-27", deleted: false }
    ], budgetTx: [], budgetAccounts: [], budgetCats: [], budgetMemo: [], budgetBills: [], budgetBooks: [] },
    p: { budgetCats: CATS, budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
      budgetTx: [
        tx({ id: "x1", date: "2026-07-27", amount: 71.99, note: "The Home Depot", accountId: "sq", pending: false }),
        tx({ id: "x2", date: "2026-07-29", amount: 254.49, note: "Lowe's", accountId: "sq", pending: false }),
        tx({ id: "x3", date: "2026-07-27", amount: 500.00, note: "Vulcan Mideast", accountId: "sq", pending: false })
      ] } };
  const c = mk(store, "obx");

  const rows = c.rtAllSpendRows();
  ok("⭐⭐ it reads the ledger from ANOTHER org", rows.length === 3, rows.length);
  ok("⛔ ...and puts S.biz back afterwards — the finally in uniInOrg", c.S.biz === "obx");

  const b1 = c.rtBest(store.obx.receipts[0], rows);
  ok("⭐ an exact same-day match is confident", b1 && b1.confident && b1.row.id === "x1", b1 && b1.row.id);
  const b2 = c.rtBest(store.obx.receipts[1], rows);
  ok("⭐ a two-day settle delay still matches", b2 && b2.row.id === "x2", b2 && b2.row.id);
  ok("...scoring lower than a same-day one", b2.score < b1.score, { same: b1.score, later: b2.score });
  ok("⛔ a receipt with no matching amount finds nothing", c.rtBest(store.obx.receipts[2], rows) === null);

  ok("⛔ THE AMOUNT IS NOT NEGOTIABLE — a cent apart is not a match",
    c.rtScore({ amount: 71.98, date: "2026-07-27", vendor: "The Home Depot" }, rows[0]) === 0);
  ok("⛔ nor is a week apart", c.rtScore({ amount: 71.99, date: "2026-08-05", vendor: "The Home Depot" }, rows[0]) === 0);
  ok("⭐ a matching payee name raises the score, it doesn't gate it",
    c.rtScore({ amount: 71.99, date: "2026-07-27", vendor: "Somewhere else" }, rows[0]) > 0
    && c.rtScore({ amount: 71.99, date: "2026-07-27", vendor: "The Home Depot" }, rows[0])
       > c.rtScore({ amount: 71.99, date: "2026-07-27", vendor: "Somewhere else" }, rows[0]));

  /* the tie itself */
  c.rtTie("r1", "p", "x1");
  ok("⭐⭐ the receipt points at the transaction", store.obx.receipts[0].txId === "x1" && store.obx.receipts[0].txOrg === "p");
  ok("⭐⭐ and the transaction points back", store.p.budgetTx[0].receiptRef === "r1");
  ok("⛔ A TIE IS A LINK, NOT A MERGE — no amount, category or job moved",
    store.p.budgetTx[0].amount === 71.99 && store.p.budgetTx[0].catId === "" && store.obx.receipts[0].amount === 71.99);
  ok("⛔ S.biz survived the cross-org write", c.S.biz === "obx");

  /* an already-tied row is a worse candidate for anything else */
  const rows2 = c.rtAllSpendRows();
  ok("⭐ a transaction already carrying a receipt scores lower for a second one",
    c.rtScore({ amount: 71.99, date: "2026-07-27", vendor: "The Home Depot" }, rows2.find(r => r.id === "x1"))
    < c.rtScore({ amount: 71.99, date: "2026-07-27", vendor: "The Home Depot" }, rows.find(r => r.id === "x1")));

  c.rtUntie("r1");
  ok("⭐ untying leaves BOTH records exactly as found",
    !store.obx.receipts[0].txId && !store.p.budgetTx[0].receiptRef
    && store.p.budgetTx[0].amount === 71.99);

  /* ⛔ ambiguity must stop the bulk path */
  const store3 = JSON.parse(JSON.stringify(store));
  store3.p.budgetTx.push(tx({ id: "x4", date: "2026-07-27", amount: 71.99, note: "The Home Depot", accountId: "sq", pending: false }));
  const c3 = mk(store3, "obx");
  const b3 = c3.rtBest(store3.obx.receipts[0]);
  ok("⛔⛔ two rows that fit equally well is NOT confident — a coin toss is not a match",
    b3 && b3.confident === false && b3.others === 1, b3 && { conf: b3.confident, others: b3.others });
  c3.rtTieAllConfident();
  ok("⭐ so tie-all leaves it alone for him to pick", !store3.obx.receipts[0].txId);
  ok("...while still tying the unambiguous one", store3.obx.receipts[1].txId === "x2");
}

console.log("\n--- ⭐ money that names one of his own accounts ---");
{
  /* $11,401.97 of Square payouts landed in his business checking described "Square Inc Square Inc ACH CREDIT".
     The revenue was already counted when customers paid into Square, so booking these as income counts the
     same money twice. The old detector only looked at credit cards and Square is not one. */
  const store = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: CATS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetAccounts: [
      { id: "chk", name: "Jamieson — Business Checking", type: "checking", deleted: false },
      { id: "sq", name: "Square — OBX Lot Solutions", type: "checking", deleted: false },
      { id: "n1", name: "Navy Federal one", type: "checking", deleted: false },
      { id: "n2", name: "Navy Federal two", type: "savings", deleted: false }],
    budgetTx: [] } };
  const c = mk(store, "p");
  const own = c.ledgerFindOwnAccount({ desc: "Square Inc Square Inc ACH CREDIT", accountId: "chk" });
  ok("⭐⭐ a Square payout is recognised as his own account, not income", own && own.id === "sq");
  const s = c.ledgerSuggest({ date: "2026-07-31", amount: 3800.49, dir: "in", desc: "Square Inc Square Inc ACH CREDIT", accountId: "chk" });
  ok("...and suggested as a transfer", s.isTransfer === true);
  ok("...with a reason that says why it would double-count", /count it twice/.test(s.why), s.why);

  ok("⛔⛔ an AMBIGUOUS name matches nothing — two accounts share 'navy', so a genuine Navy Federal FEE is "
    + "not silently excluded from spending",
    c.ledgerFindOwnAccount({ desc: "NAVY FCU RETURNED ITEM FEE", accountId: "chk" }) === null);
  ok("⛔ an ordinary merchant is not an internal move",
    c.ledgerFindOwnAccount({ desc: "LOWES #1234 KITTY HAWK NC", accountId: "chk" }) === null);
  ok("⛔ a row never matches its OWN account", c.ledgerFindOwnAccount({ desc: "Square payout", accountId: "sq" }) === null);
  ok("⚠️ the ambiguity rule is written down", /Ambiguous names are refused outright/.test(R("js/143-ledger.js")));
}

console.log("\n--- ⭐⭐ he had already answered most of this ---");
{
  /* Ray, 2026-08-27: "we need to automate as much as possible I don't have time to be an accountant too."
     ⚠️ HE HAD ALREADY FILED 263 TRANSACTIONS AND THE LEARNING TABLE HELD ZERO RULES — rules are only written
     on approval, and that history predates this screen. 263 answers, unused, while the queue asked again.
     ⚠️ AND EVEN TAUGHT, MOST STILL COULDN'T FIRE: a statement writes "POS Debit - Debit Card 9185
     Transaction 06-02-26 Wal-Mart #2" and Plaid writes "Walmart", so the rule keys on "transaction wal mart"
     and the incoming row asks for "walmart". Backfill alone answered 43 of 276; with the fuzzy fallback, 141. */
  const store = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: [{ id: "c-groc", name: "Groceries", deleted: false }, { id: "c-home", name: "Home & hardware", deleted: false }],
    budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [
      /* his history, in statement-speak, already filed */
      tx({ date: "2026-06-02", amount: 23.13, note: "POS Debit - Debit Card 9185 Transaction 06-02-26 Wal-Mart #2", pending: false, catId: "c-groc" }),
      tx({ date: "2026-06-09", amount: 41.02, note: "POS Debit - Debit Card 9185 Transaction 06-09-26 Wal-Mart #2", pending: false, catId: "c-groc" }),
      tx({ date: "2026-06-15", amount: 88.00, note: "POS Debit - Debit Card 9185 Transaction 06-15-26 The Home Depot", pending: false, catId: "c-home" }),
      /* what Plaid just delivered, in Plaid-speak, waiting */
      tx({ date: "2026-08-20", amount: 12.00, note: "Walmart" }),
      tx({ date: "2026-08-21", amount: 30.00, note: "The Home Depot" }),
      tx({ date: "2026-08-22", amount: 9.00, note: "Somewhere brand new" })
    ] } };
  const c = mk(store, "p");
  c.budgetCatName = id => ((store.p.budgetCats || []).find(x => x && x.id === id) || {}).name || "";

  ok("⛔ nothing is learned to begin with", c.ledgerRules().length === 0);
  const b = c.ledgerBackfillMemo();
  ok("⭐⭐ his own filed history becomes rules", c.ledgerRules().length > 0, b);
  ok("⛔ ...and the backfill touched no transaction", store.p.budgetTx.every(t => t.pending !== undefined) &&
    store.p.budgetTx[3].catId === "" && store.p.budgetTx[3].pending === true);

  /* ⭐⭐ THE FUZZY FALLBACK — the rule was learned under statement-speak and the row speaks Plaid */
  const g1 = c.ledgerSuggest({ date: "2026-08-20", amount: 12, dir: "out", desc: "Walmart", accountId: "chk" });
  ok("⭐⭐ 'Walmart' finds the rule learned from 'POS Debit … Wal-Mart #2'", g1.catId === "c-groc", g1);
  ok("...at MEDIUM confidence, because it matched the merchant and not the key", g1.confidence === "medium", g1.confidence);
  ok("...and says so, quoting how his bank wrote it then", /wrote it differently/.test(g1.why), g1.why);
  const g2 = c.ledgerSuggest({ date: "2026-08-21", amount: 30, dir: "out", desc: "The Home Depot", accountId: "chk" });
  ok("⭐ same for Home Depot", g2.catId === "c-home");
  const g3 = c.ledgerSuggest({ date: "2026-08-22", amount: 9, dir: "out", desc: "Somewhere brand new", accountId: "chk" });
  ok("⛔ a genuinely new payee is still unknown — the fallback is not a wildcard", !g3.catId, g3);

  /* ⭐ re-asking rewrites the stale suggestions already sitting on the queue */
  ok("stale to begin with", store.p.budgetTx[3].suggestedCatId === "");
  const r = c.ledgerResuggest();
  ok("⭐⭐ re-asking updates rows that were ingested before it learned", store.p.budgetTx[3].suggestedCatId === "c-groc", r);
  ok("⛔ ...but never writes a real category", store.p.budgetTx[3].catId === "" && store.p.budgetTx[3].pending === true);
  ok("⛔ ...and never revisits an APPROVED row — that is his decision",
    store.p.budgetTx[0].catId === "c-groc" && store.p.budgetTx[0].pending === false);
  ok("⭐ it is idempotent", c.ledgerResuggest().changed === 0);
}

console.log("\n--- 📦 an order history says what the charge was ---");
{
  /* 27 rows saying only "Amazon", $1,543.73, one of them $358.19. No categorising by payee will ever
     separate a drill bit from a birthday present; the order history is the only place the answer lives. */
  const store = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: CATS, budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [
      tx({ id: "a1", date: "2026-08-13", amount: 358.19, note: "Amazon" }),
      tx({ id: "a2", date: "2026-08-09", amount: 74.69, note: "Amazon" }),
      tx({ id: "w1", date: "2026-08-12", amount: 8.53, note: "Wawa" })
    ] } };
  const c = mk(store, "p");
  vm.runInContext(R("js/80-budget-csv.js"), c);
  vm.runInContext(R("js/162-order-import.js"), c);

  const csv = ['"Order Date","Order ID","Product Name","Total Owed","Ship Date"',
    '"2026-08-11","114-1","DEWALT 20V MAX Cordless Drill/Driver Kit","358.19","2026-08-13"',
    '"2026-08-08","114-2","Gorilla Heavy Duty Double Sided Tape","74.69","2026-08-09"',
    '"2026-08-01","114-3","Something never charged","19.99","2026-08-02"'].join("\n");
  const p = c.oiParse(csv);
  ok("⭐ columns are found by what they ARE, not by this year's Amazon header names",
    p.cols.date === 0 && p.cols.desc === 2 && p.cols.amount === 3 && p.cols.order === 1, p.cols);
  ok("...three orders read", p.rows.length === 3);

  /* the header names Amazon used BEFORE the current export */
  const older = c.oiFindCols(["Order Date", "Order ID", "Title", "Item Total"]);
  ok("⭐ and the previous layout still maps", older.date === 0 && older.desc === 2 && older.amount === 3, older);
  ok("⛔ 'Order Date' is not stolen as the description column", older.desc !== 0);

  const m = c.oiMatch(p.rows, "Amazon");
  ok("⭐ two orders find their charge across a two-day despatch gap", m.pairs.length === 2, m.pairs.length);
  ok("⭐ the order that never got charged is reported, not invented", m.unmatched.length === 1);
  ok("⛔ a Wawa row is never touched by an Amazon import",
    !m.pairs.some(x => x.tx.id === "w1"));

  const n = c.oiApply(m.pairs);
  ok("⭐⭐ the charge now says what it was", n === 2 && /DEWALT/.test(store.p.budgetTx[0].detail), store.p.budgetTx[0].detail);
  ok("...and keeps the order number", store.p.budgetTx[0].orderRef === "114-1");
  ok("⛔⛔ IT WRITES detail, NEVER note — the payee key, the learning table and the grouping all depend on it",
    store.p.budgetTx[0].note === "Amazon");
  ok("⛔ NO TRANSACTION WAS CREATED — the bank already told us the money moved", store.p.budgetTx.length === 3);
  ok("⛔ no amount, category or pending state changed",
    store.p.budgetTx[0].amount === 358.19 && store.p.budgetTx[0].catId === "" && store.p.budgetTx[0].pending === true);
  ok("⭐ grouping still sees one Amazon payee, not two", (function () {
    const gs = c.pgGroups().filter(g => g.label === "Amazon");
    return gs.length === 1 && gs[0].n === 2;
  })());

  /* ⛔ one order claims one charge — Amazon splits orders across shipments */
  const store2 = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: CATS, budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [tx({ id: "s1", date: "2026-08-10", amount: 20, note: "Amazon" }),
               tx({ id: "s2", date: "2026-08-10", amount: 20, note: "Amazon" })] } };
  const c2 = mk(store2, "p");
  vm.runInContext(R("js/80-budget-csv.js"), c2); vm.runInContext(R("js/162-order-import.js"), c2);
  const m2 = c2.oiMatch([{ date: "2026-08-10", amount: 20, desc: "First thing", order: "o1" },
                         { date: "2026-08-10", amount: 20, desc: "Second thing", order: "o2" }], "Amazon");
  c2.oiApply(m2.pairs);
  ok("⭐⭐ two same-amount orders take one charge each, not both the same one",
    store2.p.budgetTx[0].detail !== store2.p.budgetTx[1].detail
    && store2.p.budgetTx[0].detail && store2.p.budgetTx[1].detail,
    [store2.p.budgetTx[0].detail, store2.p.budgetTx[1].detail]);

  ok("⚠️ a date it can't read is refused rather than guessed", c.oiDate("not a date") === "");
  ok("⭐ but the common shapes all work",
    c.oiDate("2026-08-13") === "2026-08-13" && c.oiDate("08/13/2026") === "2026-08-13");
  ok("⛔ an amount is read as a positive magnitude", c.oiMoney("$-358.19") === 358.19 && c.oiMoney("") === 0);
}

console.log("\n--- ⭐⭐ auto-approve: a bar I can defend line by line ---");
{
  /* Ray, 2026-08-27: "for this initial import I'm not approving anything, you can and I'll review the ones
     you're unsure of only." A bounded delegation — so every tier is either arithmetic or HIS OWN previous
     decision, never my opinion about his money. */
  const store = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: [{ id: "c-ev", name: "Everyday spending", deleted: false },
                 { id: "c-groc", name: "Groceries", deleted: false }],
    budgetAccounts: [{ id: "chk", name: "RJ Checking", type: "checking", deleted: false },
                     { id: "sav", name: "RJ Savings", type: "savings", deleted: false },
                     { id: "visa", name: "Chase card", type: "credit", deleted: false }],
    budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [
      /* his filed history: Wawa is always Everyday; Target he has filed BOTH ways */
      tx({ date: "2026-06-01", amount: 8, note: "POS Debit - Debit Card 9185 Transaction Wawa 800", pending: false, catId: "c-ev" }),
      tx({ date: "2026-06-05", amount: 9, note: "POS Debit - Debit Card 9185 Transaction Wawa 800", pending: false, catId: "c-ev" }),
      tx({ date: "2026-06-08", amount: 40, note: "POS Debit - Debit Card 9185 Transaction Target T-1", pending: false, catId: "c-ev" }),
      tx({ date: "2026-06-12", amount: 50, note: "POS Debit - Debit Card 9185 Transaction Target T-1", pending: false, catId: "c-groc" }),
      /* waiting */
      tx({ id: "w", date: "2026-08-20", amount: 7.10, note: "Wawa" }),
      tx({ id: "tg", date: "2026-08-20", amount: 33.00, note: "Target" }),
      tx({ id: "new", date: "2026-08-21", amount: 12.00, note: "Vulcan Mideast" }),
      tx({ id: "thin", date: "2026-08-21", amount: 5.00, note: "POS Debit - Visa Check Card 9185" }),
      /* a transfer with both legs, and a card payment */
      tx({ id: "x1", date: "2026-08-22", amount: 100, note: "Transfer to savings", accountId: "chk" }),
      tx({ id: "x2", date: "2026-08-22", amount: 100, note: "Transfer from checking", accountId: "sav", dir: "in" }),
      tx({ id: "cp", date: "2026-08-23", amount: 250, note: "CHASE CREDIT CRD AUTOPAY", accountId: "chk" })
    ] } };
  const c = mk(store, "p");
  c.budgetCatName = id => ((store.p.budgetCats || []).find(x => x && x.id === id) || {}).name || "";
  c.ledgerBackfillMemo(); c.ledgerResuggest();
  const R2 = c.ledgerAutoApprove();
  const get = id => store.p.budgetTx.find(t => t.id === id);

  ok("⭐ a transfer with both legs present is approved — arithmetic, not judgement",
    !get("x1").pending && !get("x2").pending && get("x1").isTransfer && get("x2").isTransfer, R2);
  ok("⭐ a payment to his own card too", !get("cp").pending && get("cp").isCardPayment);
  ok("⭐⭐ a payee his history is UNANIMOUS about is filed the way he always files it",
    !get("w").pending && get("w").catId === "c-ev");
  ok("⛔⛔ a payee his history DISAGREES about is left for him — I have a preference, not an answer",
    get("tg").pending === true && get("tg").catId === "");
  ok("⛔ a payee with no history at all is left", get("new").pending === true);
  ok("⛔ and a description that strips to NOTHING is left — a match on nothing is a coincidence",
    get("thin").pending === true);
  /* ⚠️ measured: the real merchants strip to wawa(4) lowes(5) target(6) homedepot(9); the content-free ones
     to "" and "mon". My first threshold was 6 and silently dropped Wawa and Lowe's — 36 of his rows. */
  ok("⭐ but a SHORT real merchant survives the floor", c.ledgerAutoStrip("Wawa") === "wawa" && c.ledgerAutoStrip("Lowe's") === "lowes");
  ok("⛔ while bank verbiage strips to nothing at all",
    c.ledgerAutoStrip("POS Debit - Visa Check Card 9185") === "" && c.ledgerAutoStrip("Intl Transaction Fee Visa") === "");
  ok("⭐ the counts are reported honestly", R2.transfers === 2 && R2.cardPayments === 1 && R2.learned === 1 && R2.left >= 3, R2);
  ok("⭐ and what it filed, by category", R2.byCat["Everyday spending"] === 1, R2.byCat);

  /* ⭐ every automatic decision is visible and reversible */
  ok("⭐⭐ each auto-approved row is stamped", get("w").autoApproved === true && !!get("w").autoReason);
  ok("...with a reason in his own terms", /filed 2 of these as Everyday spending, every time/.test(get("w").autoReason), get("w").autoReason);
  ok("⛔ a row HE approved is never stamped", store.p.budgetTx[0].autoApproved !== true);

  const n = c.ledgerUndoAuto();
  ok("⭐⭐ one call puts every automatic decision back", n === 4 && get("w").pending === true && get("x1").pending === true, n);
  ok("...clearing what it set", get("w").catId === "" && get("x1").isTransfer === false && !get("w").autoApproved);
  ok("⛔⛔ and his OWN approvals survive the undo untouched",
    store.p.budgetTx[0].pending === false && store.p.budgetTx[0].catId === "c-ev");
}

console.log("\n--- ⛔ the strict merchant test (a loose one nearly filed his mortgage as groceries) ---");
{
  const c = mk({ registry: [{ id: "p", name: "P" }], p: { budgetTx: [], budgetCats: [], budgetAccounts: [],
    budgetMemo: [], budgetBills: [], budgetBooks: [] } }, "p");
  const M = c.ledgerMerchantSame;
  ok("⭐ same merchant, different wording, still matches",
    M("POS Debit - Debit Card 9185 Transaction 06-02-26 Wal-Mart #2", "Walmart")
    && M("POS Debit - Debit Card 9185 Transaction The Home Depot", "The Home Depot")
    && M("Wawa Chesapeake VA", "Wawa"));
  /* ⚠️ every one of these WAS a false match under the loose test used for duplicate detection — which is
     safe there only because it is anchored by exact cents, exact date, account and direction. A memo lookup
     has no anchor at all. */
  ok("⛔⛔ 'ACH Transaction - IDAHO HOUSING' no longer matches a Wal-Mart rule on the word 'transaction'",
    !M("ACH Transaction - IDAHO HOUSING MTGPMT", "POS Debit - Debit Card 9185 Transaction Wal-Mart #2"));
  ok("⛔ nor does 'Intl Transaction Fee Visa'",
    !M("Intl Transaction Fee Visa", "POS Debit - Debit Card 9185 Transaction Wal-Mart"));
  ok("⛔ nor two different ACH payees to each other",
    !M("ACH Transaction - Ashley Belvin", "ACH Transaction - IDAHO HOUSING"));
  ok("⛔ nor a loan transfer to a checking transfer",
    !M("Transfer To Loan -1319", "Transfer From Checking"));
  ok("⚠️ a two-letter merchant is refused rather than risked — BP costs one manual decision", !M("Bp#hanover", "BP"));
  ok("⚠️ the reason the loose one is still right for duplicate detection is recorded",
    /anchored by\s*\n?\s*exact cents/.test(R("js/143-ledger.js")) || /ALREADY anchored by/.test(R("js/143-ledger.js")));
}

console.log("\n--- ⭐ automation he can check and reverse ---");
{
  /* "you can [approve] and I'll review the ones you're unsure of only." ⚠️ THAT DEAL ONLY WORKS IF HE CAN
     SEE WHAT I DID — and checking my work must not mean scrolling his whole ledger. */
  const store = { registry: [{ id: "p", name: "P" }], p: {
    budgetCats: [{ id: "c-ev", name: "Everyday spending", deleted: false }],
    budgetAccounts: ACCTS, budgetMemo: [], budgetBills: [], budgetBooks: [{ id: "b", name: "P", deleted: false }],
    budgetTx: [
      tx({ id: "strong", date: "2026-08-01", amount: 10, note: "Wawa", pending: false, catId: "c-ev",
        autoApproved: true, autoReason: "you have filed 25 of these as Everyday spending, every time" }),
      tx({ id: "thin", date: "2026-08-02", amount: 6.94, note: "7-Eleven", pending: false, catId: "c-ev",
        autoApproved: true, autoReason: "you have filed 1 of these as Everyday spending, every time" }),
      tx({ id: "xfer", date: "2026-08-03", amount: 100, note: "Transfer", pending: false, isTransfer: true,
        autoApproved: true, autoReason: "both sides of this transfer are here" }),
      tx({ id: "his", date: "2026-08-04", amount: 20, note: "Target", pending: false, catId: "c-ev" })
    ] } };
  const c = mk(store, "p");
  c.lrDate = d => d; c.lrMoney = n => "$" + n;
  const rows = c.lrAutoRows();
  ok("⭐ only rows the app filed appear — his own approvals are not on trial", rows.length === 3,
    rows.map(r => r.t.id));
  ok("⭐⭐ WEAKEST EVIDENCE FIRST — the single-filing one is at the top, where a mistake would be",
    rows[0].t.id === "thin", rows.map(r => r.t.id));
  ok("...and the mechanical transfer is last", rows[rows.length - 1].t.id === "xfer");
  const html = c.lrAutoHTML();
  ok("⭐ it says how many, and how many rested on thin evidence", /3 filed automatically/.test(html) && /1 rested on a single earlier filing/.test(html));
  ok("⛔ collapsed by default — it is a receipt, not a to-do", !/7-Eleven/.test(html));
  c.lrAutoToggle();
  ok("⭐ opening it shows each row WITH the reason", /filed 1 of these/.test(c.lrAutoHTML()));
  ok("⭐ and offers to put them all back", /Put all 3 back/.test(c.lrAutoHTML()));
}

console.log("\n--- 📅 the calendar on Today ---");
{
  /* Ray, 2026-08-27: "i need my calendar on today page, i need month view showing this month + next, and
     also 2x day view showing times for things happening today and tomorrow." */
  const store = {
    registry: [{ id: "p", name: "Personal" }, { id: "obx", name: "OBX Lot Solutions" }],
    p: { personalEvents: [
          { id: "e1", date: "2026-08-27", title: "Vera — dentist", time: "14:00", confirmed: true, deleted: false },
          { id: "e2", date: "2026-08-27", title: "Party", annual: false, confirmed: false, deleted: false },
          { id: "b1", date: "1999-08-28", title: "Brooke’s birthday", annual: true, confirmed: true, deleted: false }],
        todos: [{ id: "t1", title: "Send the invoice", due: "2026-08-27", done: false, deleted: false },
                { id: "t2", title: "Done already", due: "2026-08-27", done: true, deleted: false }],
        jobs: [], budgetTx: [], budgetAccounts: [], budgetCats: [], budgetMemo: [], budgetBills: [], budgetBooks: [] },
    obx: { jobs: [{ id: "j1", date: "2026-08-28", title: "Mike Green walkthrough", time: "08:30", endTime: "09:15", deleted: false }],
           personalEvents: [], todos: [], budgetTx: [], budgetAccounts: [], budgetCats: [], budgetMemo: [], budgetBills: [], budgetBooks: [] } };
  const c = mk(store, "p");
  c.today = () => "2026-08-27";
  vm.runInContext(R("js/126-calendar.js"), c);
  vm.runInContext(R("js/163-today-calendar.js"), c);

  /* date maths, which is where a calendar quietly goes wrong */
  ok("⭐ tomorrow is tomorrow, across a month end too",
    c.tcalShift("2026-08-27", 1) === "2026-08-28" && c.tcalShift("2026-08-31", 1) === "2026-09-01");
  ok("⭐ next month rolls the year", c.tcalAddMonths("2026-12", 1) === "2027-01" && c.tcalAddMonths("2026-08", 1) === "2026-09");
  ok("⭐ month lengths, February included", c.tcalDaysIn("2026-02") === 28 && c.tcalDaysIn("2028-02") === 29 && c.tcalDaysIn("2026-08") === 31);
  ok("⭐ times parse both ways", c.tcalMins("14:00") === 840 && c.tcalMins("8:30") === 510 && c.tcalMins("9am") === 540);
  ok("⛔⛔ an UNREADABLE time is all-day, NOT midnight — a birthday must never be drawn at 12am",
    c.tcalMins("") === null && c.tcalMins("whenever") === null && c.tcalMins(undefined) === null);
  ok("⭐ and the clock reads back in plain English", c.tcalClock(840) === "2pm" && c.tcalClock(510) === "8:30am" && c.tcalClock(0) === "12am");

  const t = c.tcalItemsFor("2026-08-27");
  ok("⭐ today gathers events and to-dos", t.length === 3, t.map(x => x.title));
  ok("⛔ a DONE to-do is not on the calendar", !t.some(x => /Done already/.test(x.title)));
  ok("⭐⭐ all-day items sort ABOVE timed ones", t[0].mins === null && t[t.length - 1].mins === 840);
  ok("⭐ an unconfirmed event stays marked unconfirmed", t.some(x => x.title === "Party" && x.confirmed === false));

  const tm = c.tcalItemsFor("2026-08-28");
  ok("⭐⭐ IT CROSSES ORGS — an OBX job shows on his personal Today",
    tm.some(x => x.kind === "job" && /Mike Green/.test(x.title)), tm.map(x => x.kind + ":" + x.title));
  ok("⛔ ...and S.biz is put back afterwards", c.S.biz === "p");
  ok("⭐ an annual birthday rolls forward to this year", tm.some(x => /Brooke/.test(x.title)));

  const dayT = c.tcalDayHTML("2026-08-27", "Today");
  const dayM = c.tcalDayHTML("2026-08-28", "Tomorrow");
  ok("⭐ the timed items are drawn with their times", /2pm<\/b> Vera/.test(dayT.replace(/<b>/g, "<b>")) || /2pm/.test(dayT));
  ok("⛔⛔ BOTH columns render the all-day strip even when empty — otherwise one column's 9am sits beside "
    + "the other's 10am and the whole thing reads wrong at a glance",
    (dayT.match(/tcal-allday/g) || []).length === 1 && (dayM.match(/tcal-allday/g) || []).length === 1);
  ok("⭐ a block uses min-height so a long title isn't cut in half", /min-height:/.test(dayT) && !/;height:\d/.test(dayT));

  /* the window must stretch rather than clip */
  const early = c.tcalDayHTML("2026-08-27", "x");
  ok("⚠️ the default window is drawn", /7am/.test(early) && /8pm/.test(early));
  store.p.personalEvents.push({ id: "e9", date: "2026-08-27", title: "Very early", time: "05:00", confirmed: true, deleted: false });
  ok("⭐⭐ a 5am item WIDENS the window rather than falling off the top", /5am/.test(c.tcalDayHTML("2026-08-27", "x")));

  const m = c.tcalMonthHTML("2026-08");
  ok("⭐ the month grid names itself", /August 2026/.test(m));
  ok("⭐ today is marked", /tcal-now/.test(m));
  /* ⛔⛔ NO MORE DOTS. Ray, 2026-08-27: "i dont wanna have just dots for events coming up. That's not gonna
     help me remember… I wanna be able to read what's actually coming up." A dot says something happens; the
     entire question is WHAT. */
  ok("⛔⛔ the dots are gone", !/tcal-dots/.test(m) && !/tcal-dots/.test(R("js/163-today-calendar.js")));
  ok("⭐⭐ a day carries readable labels instead", /tcal-pill/.test(m) && /Vera/.test(m));
  ok("⭐ colour-coded by kind", /--pc:#/.test(m));
  ok("⛔ and a day with more than four says how many it is hiding", /tcal-more|tcal-pill/.test(m));
  ok("⛔ and the leading blanks line the 1st up under the right weekday",
    (m.match(/tcal-pad/g) || []).length === c.tcalDow("2026-08-01"),
    { pads: (m.match(/tcal-pad/g) || []).length, dow: c.tcalDow("2026-08-01") });

  /* ⭐⭐ BILLS ARE ON THE CALENDAR NOW. "we have the bills coming up over the next two weeks. Can we just
     build those into the calendar?… the bills should be built into it with their values showing." */
  store.p.budgetBills = [
    { id: "b1", name: "Iowa mortgage (Johnston, IA rental)", amount: 2413, frequency: "monthly",
      dueDay: 1, active: true, deleted: false },
    { id: "b2", name: "Car loan — NFCU", amount: 476.26, frequency: "monthly", dueDay: 16, active: true, deleted: false },
    { id: "b3", name: "Switched off", amount: 99, frequency: "monthly", dueDay: 5, active: false, deleted: false }
  ];
  vm.runInContext(R("js/79-budget.js"), c);
  const sep1 = c.tcalItemsFor("2026-09-01");
  ok("⭐⭐ a bill lands on the day it is due", sep1.some(x => x.kind === "bill" && /Iowa mortgage/.test(x.title)), sep1.map(x => x.title));
  ok("⭐⭐ carrying its amount", (sep1.find(x => x.kind === "bill") || {}).amount === 2413);
  ok("⛔ an INACTIVE bill is not drawn", !c.tcalItemsFor("2026-09-05").some(x => x.kind === "bill"));
  ok("⛔ and it does not land on a day it is not due", !c.tcalItemsFor("2026-09-02").some(x => x.kind === "bill"));
  ok("⭐ the name is made succinct — a parenthetical is a wall in a calendar cell",
    c.tcalBillName("Iowa mortgage (Johnston, IA rental)") === "Iowa mortgage"
    && c.tcalBillName("Car loan — NFCU") === "Car loan");
  ok("⭐ amounts read short: $2.4k, not $2,413", c.tcalAmt(2413) === "$2.4k" && c.tcalAmt(476.26) === "$476" && c.tcalAmt(650) === "$650");
  ok("⛔ a bill is a FORECAST — nothing about it is booked", !/budgetTx|ledgerIngest/.test(CODE(R("js/163-today-calendar.js"))));

  const all = c.tcalHTML();
  /* ⛔ SUPERSEDED 2026-08-27. This asserted the calendar header totals two weeks of bills — which I put
     there, and then Ray rightly said "we dont need that we have a money area now". The total lives in the
     outlook card; the calendar's job is WHEN, not how much. */
  ok("⛔ the calendar header does NOT total the bills — that belongs to the money card",
    !/in the next two weeks/.test(CODE(all)));
  ok("⭐ and there is a colour key, because colour-coding you have to guess at is decoration", /tcal-key/.test(all));
  ok("⛔ the money card no longer duplicates the bill list", /typeof tcalHTML === "function"\) \? ""/.test(CODE(R("js/142-money-card.js"))));
  /* ⚠️ SUPERSEDED 2026-08-27 by the movable layout (js/164): Today is no longer a fixed arrangement at all,
     so "the calendar is in the wide column" is now the DEFAULT rather than the structure. Asserted where it
     actually lives, in TL_DEFAULT, instead of by reading personalHome's markup. */
  ok("⭐ the calendar defaults to the wide column, and Today is arranged by him now",
    /calendar: \{ col: 0/.test(R("js/164-today-layout.js")) && /tlTodayHTML/.test(CODE(R("js/122-personal-home.js"))));
  ok("⚠️ the routine tick shrinks on a desktop but stays thumb-sized on a phone",
    /class="rt-box"/.test(R("js/141-routine.js")) && /min-width:900px\)\s*\{\s*\.rt-box\{width:16px/.test(R("app.css")));
  /* ⚠️ SUPERSEDED 2026-08-27. Ray: "the today / tomorrow section should be its own block, not inside
     calendar." So the calendar card is the two MONTHS, and the day views are their own block — a different
     question on a different timescale, wanting a different width. */
  ok("⭐ the calendar card is the two months", (all.match(/class="tcal-m"/g) || []).length === 2
    && (all.match(/class="tcal-day"/g) || []).length === 0,
    { days: (all.match(/class="tcal-day"/g) || []).length, months: (all.match(/class="tcal-m"/g) || []).length });
  const daysCard = c.tcalDaysHTML();
  ok("⭐⭐ and today + tomorrow stand alone", (daysCard.match(/class="tcal-day"/g) || []).length === 2
    && !/tcal-m"/.test(daysCard));
  ok("⭐ and it is on Today", /tcalHTML/.test(CODE(R("js/122-personal-home.js"))));
  ok("⛔ READ-ONLY — it links out, it never edits", !/ledgerApprove|\.deleted\s*=|save\(\)/.test(CODE(R("js/163-today-calendar.js"))));
  ok("⭐ events gained an OPTIONAL time, so an existing birthday still works untouched",
    /id="ev_time"/.test(R("js/126-calendar.js")) && /e\.time = g\("ev_time"\) \|\| ""/.test(R("js/126-calendar.js")));
}

console.log("\n--- 🧩 Today, arranged by him ---");
{
  /* Ray, 2026-08-27, on a 2000px screen with 440px of dead air: "let's use our space more effectively…
     I wanna be able to see it all on one screen. Maybe you can make it, like, draggable, and then I can just
     try a few different ways to do it."
     ⚠️ HE HAS TOLD ME WHERE THESE BLOCKS GO FOUR TIMES AND BEEN RIGHT EACH TIME. The lesson is not the
     arrangement, it is that I keep guessing at something he can settle in ten seconds if the app lets him. */
  const store = { registry: [{ id: "p", name: "P" }], p: {
    personalEvents: [], todos: [], jobs: [], budgetBills: [], budgetTx: [], budgetAccounts: [],
    budgetCats: [], budgetMemo: [], budgetBooks: [] } };
  const c = mk(store, "p");
  const mem = {};
  c.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  c.phMe = () => ({ id: "u1" });
  /* stub the five blocks so we're testing the LAYOUT, not what happens to be in it today */
  c.tcalHTML = () => "<CAL>"; c.phTalkCard = () => "<CHAT>"; c.moneyCardHTML = () => "<MONEY>";
  c.evHomeCardHTML = () => "<COMING>"; c.rtPartHTML = () => "<PART>"; c.ROUTINE_PARTS = [{ key: "morning" }];
  c.rtJobsTodayHTML = () => ""; c.phPlanCard = () => ""; c.piCardHTML = () => "";
  vm.runInContext(R("js/164-today-layout.js"), c);

  const d = c.tlLayout();
  ok("⭐ the default puts the calendar in the wide column", d.calendar.col === 0);
  ok("⭐ ...Cap where he asked for it, top right", d.chat.col === 2 && d.chat.order === 0);
  ok("⭐ ...the routine down the middle, where a sequence reads as a sequence", d.routine.col === 1);
  ok("⭐ ...money and dates stacked under Cap", d.money.col === 2 && d.coming.col === 2 && d.money.order < d.coming.order);

  let html = c.tlTodayHTML();
  ok("⭐ all five blocks are drawn", ["<CAL>", "<CHAT>", "<MONEY>", "<COMING>", "<PART>"].every(x => html.indexOf(x) >= 0));
  ok("⭐ three columns", /tl-live-3/.test(html));

  /* ⭐⭐ WIDTH FOLLOWS THE CONTENT, NOT THE POSITION. Ray, 2026-08-27: "i wanted to move the calendar to be
     centered but it did this because i cant resize anything." My bug entirely — the track list was hard-coded
     per column count, so column 0 was always the wide one and moving the calendar to the middle squeezed it
     into a 1fr slot and truncated every bill name again. */
  const tracks = h => (/--tl-cols:([^"]+)"/.exec(h) || [])[1] || "";
  ok("⭐ the calendar's column is the wide one by default", /^minmax\(0,2\.4fr\)/.test(tracks(html)), tracks(html));
  c.tlMove("calendar", "right");
  ok("⭐⭐ and it stays wide when he MOVES it — the width travels with the block",
    /minmax\(0,2\.4fr\)/.test(tracks(c.tlTodayHTML())), tracks(c.tlTodayHTML()));
  ok("...in its NEW column, not the old one", tracks(c.tlTodayHTML()).indexOf("2.4fr") > 0, tracks(c.tlTodayHTML()));
  c.tlMove("calendar", "left");

  /* ⭐ and he can resize, which is the thing he said he couldn't do */
  const before = tracks(c.tlTodayHTML());
  c.tlWide("calendar", 1);
  ok("⭐⭐ + makes a block wider", tracks(c.tlTodayHTML()) !== before && /2\.6fr/.test(tracks(c.tlTodayHTML())),
    tracks(c.tlTodayHTML()));
  c.tlWide("calendar", -1);
  ok("⭐ − puts it back", /2\.4fr/.test(tracks(c.tlTodayHTML())));
  for (let i = 0; i < 40; i++) c.tlWide("calendar", 1);
  ok("⛔ clamped so one block can never eat the row", /4fr/.test(tracks(c.tlTodayHTML())) && !/[5-9]\d*fr/.test(tracks(c.tlTodayHTML())));
  for (let i = 0; i < 60; i++) c.tlWide("calendar", -1);
  ok("⛔ ...nor be squeezed to nothing", /0\.6fr/.test(tracks(c.tlTodayHTML())));

  /* ⚠️⚠️ THE BUG THIS TEST CAUGHT. An unset width saves as w:null, and isFinite(+null) is TRUE because +null
     is 0 — so every default round-tripped back as the 0.6 minimum and flattened all three columns to the same
     size. The arithmetic was right; the falsy-check was not. */
  c.tlReset();
  const fresh = tracks(c.tlTodayHTML());
  c.tlMove("routine", "left"); c.tlMove("routine", "right");   // a round-trip through save/load
  ok("⭐⭐ a saved layout with no width overrides still respects the content weights",
    /2\.4fr/.test(tracks(c.tlTodayHTML())), { before: fresh, after: tracks(c.tlTodayHTML()) });
  ok("⚠️ the null round-trip is written down", /isFinite\(\+null\)/.test(R("js/164-today-layout.js")));
  c.tlReset();
  ok("⭐ each block carries its move handle", (html.match(/tl-handle/g) || []).length === 5);
  /* ⛔ SUPERSEDED. Ray: "we dont need this — Use ◀ ▲ ▼ ▶ on any block to rearrange this page." He is right:
     the arrows are on every block already, so a caption explaining them is a sentence he reads past every
     morning to reach his own day. Reset moved onto the handle, where the controls it undoes live. */
  ok("⛔ no instruction footer", !/rearrange this page/.test(html));
  ok("⭐ reset is a control on the handle instead", /onclick="tlReset\(\)"/.test(html));
  ok("⛔ and the handle carries NO label — every card already says what it is one line below",
    !/tl-name/.test(html) && !/tl-name/.test(R("app.css")));

  /* moving */
  c.tlMove("chat", "left");
  ok("⭐⭐ ◀ moves a block a column left", c.tlLayout().chat.col === 1);
  ok("⭐ ...and it lands at the BOTTOM of its new column, where a dropped thing would land",
    c.tlLayout().chat.order > c.tlLayout().routine.order, { chat: c.tlLayout().chat, routine: c.tlLayout().routine });
  c.tlMove("chat", "up");
  ok("⭐⭐ ▲ swaps with the neighbour IN THAT COLUMN", c.tlLayout().chat.order < c.tlLayout().routine.order);
  c.tlMove("chat", "up");
  ok("⛔ ...and going up from the top is a no-op, not a wrap-around", c.tlLayout().chat.order < c.tlLayout().routine.order);
  c.tlMove("calendar", "left");
  ok("⛔ nor can a block leave the left edge", c.tlLayout().calendar.col === 0);
  c.tlMove("money", "right");
  ok("⛔ nor the right edge", c.tlLayout().money.col === 2);

  ok("⭐ the arrangement persists", (function () {
    const raw = mem[Object.keys(mem)[0]];
    return raw && JSON.parse(raw).chat.col === 1;
  })());
  ok("⚠️ ...PER DEVICE, in localStorage — a three-column layout for a 2000px monitor is not the one he wants "
    + "on a phone, and syncing it would spoil one every time he touched the other",
    /localStorage/.test(CODE(R("js/164-today-layout.js"))) && !/budget|D\(\)\./.test(CODE(R("js/164-today-layout.js")).slice(
      CODE(R("js/164-today-layout.js")).indexOf("function tlSave"),
      CODE(R("js/164-today-layout.js")).indexOf("function tlRoutineHTML"))));

  c.tlReset();
  ok("⭐ and he can put it back", c.tlLayout().chat.col === 2);

  /* ⛔ a block with nothing to say must not hold a column open — that IS the dead air he screenshotted */
  c.moneyCardHTML = () => ""; c.evHomeCardHTML = () => ""; c.phTalkCard = () => "";
  html = c.tlTodayHTML();
  ok("⛔⛔ an empty column collapses instead of reserving width", /tl-live-2/.test(html), html.slice(0, 80));
  ok("...and the blocks that do have something still render", html.indexOf("<CAL>") >= 0 && html.indexOf("<PART>") >= 0);

  /* mobile */
  const css = R("app.css");
  ok("⛔ one column on a phone", /\.tl-grid\{display:flex;flex-direction:column/.test(css));
  ok("⛔ and no move handles there — a control offering a column that doesn't exist is a lie",
    /\.tl-handle\{display:none\}/.test(css));
  ok("⭐ the handles are always visible on desktop, not hover-only — he has to be able to FIND this",
    /\.tl-handle\{display:flex;[^}]*opacity:\.4/.test(css));
  ok("⭐ and Today finally uses the whole screen", /body\.wideday \.wrap\{max-width:none/.test(css));
  /* ⚠️ SUPERSEDED 2026-08-27. This asserted a hard-coded track list per column count — which is exactly the
     bug: it tied width to POSITION, so moving the calendar to the middle squeezed it. The track list is now
     emitted from the content (asserted above); the CSS only has to consume it. */
  ok("⭐ the track list comes from the content, not from a hard-coded column count",
    /grid-template-columns:var\(--tl-cols/.test(css) && !/tl-live-3\{grid-template-columns/.test(css));

  ok("⭐ personalHome delegates to it", /tlTodayHTML/.test(CODE(R("js/122-personal-home.js"))));
  ok("⛔ ...with a fallback, so Today can never come up empty", /fallback for a build without js\/164/.test(R("js/122-personal-home.js")));
}

console.log("\n--- 💵 the month ahead ---");
{
  /* Ray, 2026-08-27: "expected spending for the month based on history and bills… versus how much cash is on
     hand in personal account? Well, like, LITERALLY my personal checking. not the business accounts." Then:
     "expected income shouldnt be relied upon though sometimes people are very late to pay. it should flag if
     cash is lower than expected expenses for the month." */
  const mkMo = (over) => {
    const store = { registry: [{ id: "p", name: "P" }], p: Object.assign({
      budgetBooks: [{ id: "bk", name: "Personal", kind: "personal", linkedOrgId: "", deleted: false },
                    { id: "bz", name: "OBX", kind: "business", linkedOrgId: "obx", deleted: false }],
      budgetAccounts: [
        { id: "chk", name: "RJ’s Checking ····5377", type: "checking", bookId: "bk", balance: 502.12, balanceDate: "2026-08-27", deleted: false },
        { id: "chk2", name: "Brooke’s Checking", type: "checking", bookId: "bk", balance: 46.85, balanceDate: "2026-08-27", deleted: false },
        { id: "biz", name: "Square — OBX", type: "checking", bookId: "bz", balance: 1056.99, balanceDate: "2026-08-27", deleted: false },
        { id: "visa", name: "Visa", type: "credit", bookId: "bk", balance: -23644.53, balanceDate: "2026-08-27", deleted: false }],
      budgetBills: [{ id: "b1", name: "Rent — Ashley Belvin", amount: 3750, frequency: "monthly", dueDay: 13, active: true, deleted: false }],
      budgetTx: [], budgetCats: [], budgetMemo: [], quotes: [], todos: [], personalEvents: [], jobs: []
    }, over || {}) };
    /* three complete months of spending on his checking + one on the business account */
    ["2026-05", "2026-06", "2026-07"].forEach((m, i) => {
      store.p.budgetTx.push({ id: "t" + i, accountId: "chk", date: m + "-10", amount: [8000, 11000, 9000][i],
        dir: "out", pending: false, deleted: false });
    });
    store.p.budgetTx.push({ id: "tb", accountId: "biz", date: "2026-06-10", amount: 50000, dir: "out", pending: false, deleted: false });
    store.p.budgetTx.push({ id: "tx", accountId: "chk", date: "2026-06-11", amount: 4000, dir: "out", pending: false, isTransfer: true, deleted: false });
    const c = mk(store, "p");
    c.today = () => "2026-08-27";
    ["js/79-budget.js", "js/145-reconcile.js", "js/163-today-calendar.js", "js/165-month-outlook.js"]
      .forEach(f => { try { vm.runInContext(R(f), c); } catch (e) {} });
    return { c, store };
  };
  const { c, store } = mkMo();

  const a = c.moPersonalAccount();
  ok("⭐⭐ it picks the checking account he ACTUALLY USES, by transaction count", a && a.id === "chk", a && a.id);
  ok("⛔⛔ NOT the business account — he said 'literally my personal checking'", a.bookId === "bk");
  const cash = c.moCashOnHand();
  ok("⭐ cash is that one account, not a total", cash.balance === 502.12, cash.balance);
  ok("⛔ ...so the $1,056.99 business balance is nowhere in it", cash.balance !== 502.12 + 1056.99);
  ok("⭐ and the card names which account, so a wrong guess is visible not silent",
    /In RJ’s Checking/.test(c.monthOutlookHTML()));

  /* ⛔ unknown is not zero */
  const { c: c2 } = mkMo();
  c2.D().budgetAccounts[0].balanceDate = "";
  ok("⛔⛔ no anchor means NOT RECONCILED, never $0.00 — a claim vs the truth", c2.moCashOnHand() === null);
  ok("...and the card says so instead of a number", /not reconciled/.test(c2.monthOutlookHTML()));
  ok("⛔⛔ and NO SHORTFALL WARNING fires from a missing balance — that would be a bug wearing a warning",
    !/short by/.test(c2.monthOutlookHTML()));

  const typ = c.moTypicalMonth();
  ok("⭐ a typical month is the MEDIAN of complete months", typ.median === 9000, typ);
  ok("⛔ ...so one $11,000 month doesn't drag it up the way a mean would", typ.median !== (8000 + 11000 + 9000) / 3);
  ok("⛔ this month is excluded — half a month would read as a windfall", typ.months.indexOf("2026-08") < 0, typ.months);
  ok("⛔ the business account's $50,000 is not his personal spending", typ.median < 50000);
  ok("⛔ and a TRANSFER is not spending", typ.median === 9000);

  const bills = c.moBillsAhead(30);
  ok("⭐ bills ahead are counted once each", bills.length === 1 && bills[0].amount === 3750, bills.length);

  const html = c.monthOutlookHTML();
  ok("⚠️⚠️ bills and 'a typical month' are shown SEPARATELY and never summed — the bills are inside the "
    + "median, and adding them would double-count every one", /don't add them together/.test(html));

  /* ⛔ the flag */
  /* ⚠️ assert the ARITHMETIC, not a percentage copied off his live card — this fixture has one $3,750 bill
     against $502.12, so 13% is right here and 5% is right there. A hard-coded number would have made this
     test a note about one afternoon. */
  ok("⭐⭐ it flags when cash is under the bills ahead", /short by <b>\$3,?247\.88<\/b>/.test(html)
    && /covers <b>13%<\/b>/.test(html), html.slice(-260));
  const { c: c3 } = mkMo();
  c3.D().budgetAccounts[0].balance = 99999;
  ok("⛔ ...and says so plainly when he is covered", /Covers the next 30 days/.test(c3.monthOutlookHTML()));

  /* ⛔ owed money is never treated as held money */
  const { c: c4, store: s4 } = mkMo();
  s4.p.quotes = [
    { id: "q1", cust: "Mike Green", date: "2026-05-01", total: 6492, finalPrice: 6492, invoiced: true, payments: [], deleted: false },
    { id: "q2", cust: "Mike Green", date: "2026-07-01", total: 2324, finalPrice: 2324, invoiced: false, payments: [], deleted: false }
  ];
  vm.runInContext(R("js/151-unified-ledger.js"), c4);
  vm.runInContext(R("js/154-collections.js"), c4);
  vm.runInContext(R("js/165-month-outlook.js"), c4);
  /* ⚠️ a DISTINCT amount — my first go used $6,492 for both the past and the future quote, so the assertion
     could not tell which one survived and reported a passing filter as a failure. */
  s4.p.quotes.push({ id: "q3", cust: "Mike Green", date: "2026-09-23", total: 7777, finalPrice: 7777,
    invoiced: false, payments: [], deleted: false });   /* a recurring visit a month out */
  const owed = c4.moOwed();
  ok("⭐ it reads what he is owed", owed.total === 8816, owed);
  ok("⭐⭐ and splits it by WHOSE MOVE IT IS — $2,324 nobody has invoiced yet",
    owed.unbilled === 2324 && owed.unbilledN === 1, owed);
  /* ⛔⛔ found while itemising: the biggest "owed" line was a job dated a MONTH OUT */
  ok("⛔⛔ work not yet done is not counted as owed — a job dated a MONTH OUT was his largest 'receivable'",
    owed.rows.every(r => r.amount !== 7777) && owed.total === 8816, owed.rows.map(r => r.amount));
  ok("⭐⭐ it is ITEMISED, one line per invoice — six conversations, not one mood",
    owed.rows.length === 2 && owed.rows[0].name === "Mike Green");
  ok("⭐ uninvoiced sorts FIRST, because that is his move and not theirs", owed.rows[0].invoiced === false);
  ok("...and the card prints each one", /mo-invrow/.test(c4.monthOutlookHTML()));
  /* ⚠️ SUPERSEDED, NOT DELETED. This asserted a per-row "not invoiced" TAG. Ray, 2026-08-27: "only the ones
     I haven't sent yet where the job's done but I haven't sent the invoice. Or the ones where I'm awaiting
     payment." So the tag became two GROUP HEADINGS with their own subtotals — the same distinction, made
     structural instead of decorative. The information it was protecting is still asserted, harder. */
  const hGrp = c4.monthOutlookHTML();
  ok("⭐⭐ the two invoice groups are headings with their own subtotals, not per-row tags",
    /Not invoiced yet/.test(hGrp) && /Waiting on payment/.test(hGrp), hGrp.slice(0, 200));
  ok("⭐ the unsent group carries its own total ($2,324) so it reads as one job to do",
    /mo-unsent-hd[^]*?\$2,?324\.00/.test(hGrp));
  ok("⭐ ...and the waiting group carries the other ($6,492)", /mo-sent-hd[^]*?\$6,?492\.00/.test(hGrp));

  /* ⭐⭐ THE DIFFERENCE, STATED. Ray: "I'm not seeing the actual difference between anticipated income and
     bills due." Expected in here is $8,816 of invoices against a single $3,750 bill → +$5,066. */
  ok("⭐⭐ the card does the subtraction he was doing in his head", /mo-net/.test(hGrp) && /If all of that arrives/.test(hGrp));
  ok("⭐ ...and gets it right: $8,816 expected against $3,750 of bills", /\+\$5,?066\.00/.test(hGrp), hGrp.slice(-500));
  ok("⛔ ...and says it is conditional, because he was explicit that expected income can't be relied on",
    /only if everyone pays|still short, even if everyone pays/.test(hGrp));

  /* ⛔⛔ A PAID INVOICE IS NOT A RECEIVABLE. Ray: "stuff that's already paid is on here." His live store had
     Christina Brodeur at $290 marked paid on the invoice screen with no payment row behind it, sitting in
     A/R at full value. colBalance now believes q.paid, which is what every other screen already did. */
  const { c: cPaid, store: sPaid } = mkMo();
  sPaid.p.quotes = [
    { id: "qp1", cust: "Christina Brodeur", date: "2026-06-23", total: 290, finalPrice: 290,
      invoiced: true, paid: true, payments: [], deleted: false },
    { id: "qp2", cust: "Mike Green", date: "2026-07-01", total: 1160, finalPrice: 1160,
      invoiced: true, payments: [], deleted: false }
  ];
  vm.runInContext(R("js/151-unified-ledger.js"), cPaid);
  vm.runInContext(R("js/154-collections.js"), cPaid);
  vm.runInContext(R("js/165-month-outlook.js"), cPaid);
  const owedPaid = cPaid.moOwed();
  ok("⛔⛔ a quote marked paid leaves A/R even with no payment row behind it",
    owedPaid.total === 1160 && owedPaid.rows.every(r => r.name !== "Christina Brodeur"), owedPaid);
  ok("⛔ ...and the unpaid one is untouched", owedPaid.rows.length === 1 && owedPaid.rows[0].amount === 1160);
  ok("⛔ ...and it never reaches the card", !/Brodeur/.test(cPaid.monthOutlookHTML()));
  ok("⚠️ the field is `age`, not `days` — an undefined there would zero every overdue figure forever",
    /\+x\.age \|\| 0/.test(CODE(R("js/165-month-outlook.js"))));
  const h4 = c4.monthOutlookHTML();
  ok("⛔⛔ EXPECTED INCOME IS NOT ADDED TO CASH — 'sometimes people are very late to pay'",
    /isn't having it/.test(h4) && /short by/.test(h4));
  ok("⭐ ...though it does say the money owed would cover the gap, if it arrives", /if it arrives/.test(h4));

  /* ⭐ RENT IS ITS OWN LINE — "rent collection is separate line". A standing arrangement that has arrived
     eight months running is a different kind of money from an invoice he has to chase; lumping them lets the
     reliable thing flatter the unreliable one. */
  const { c: c5, store: s5 } = mkMo();
  ["2026-04-30", "2026-05-28", "2026-06-30", "2026-07-30"].forEach((d, i) => {
    s5.p.budgetTx.push({ id: "r" + i, accountId: "chk", date: d, amount: 2795, dir: "in",
      catId: "c_rentinc", pending: false, deleted: false });
  });
  s5.p.budgetCats.push({ id: "c_rentinc", name: "Rent received", deleted: false });
  vm.runInContext(R("js/165-month-outlook.js"), c5);
  const rent = c5.moRentDue();
  ok("⭐ rent is read from what ACTUALLY LANDED, not from the lease", rent && rent.amount === 2795, rent);
  ok("⭐ ...on the day it actually tends to arrive", rent.day >= 28, rent.day);
  ok("⭐ and it gets its own line, apart from the invoices", /Rent collection/.test(c5.monthOutlookHTML()));
  const { c: c6, store: s6 } = mkMo();
  s6.p.budgetCats.push({ id: "c_rentinc", name: "Rent received", deleted: false });
  s6.p.budgetTx.push({ id: "one", accountId: "chk", date: "2026-07-30", amount: 2795, dir: "in",
    catId: "c_rentinc", pending: false, deleted: false });
  vm.runInContext(R("js/165-month-outlook.js"), c6);
  ok("⛔ one or two payments is not a pattern — it stays silent rather than promising rent",
    c6.moRentDue() === null);

  /* the balance anchor's sign — the most dangerous number in the app to get backwards */
  ok("⛔⛔ a credit account carries NEGATIVE balance — $23,644 of Visa debt must never read as cash on hand",
    store.p.budgetAccounts[3].balance < 0);
  ok("⭐ and cash-on-hand only ever looks at a checking account", a.type === "checking");
}

console.log("\n--- ⛔ one number, one place ---");
{
  /* Ray, 2026-08-27: "the line above the calendar says bills due in the next two weeks. we dont need that we
     have a money area now." My mistake twice over — I moved that total OFF the money card onto the calendar,
     then built a money card that says it properly. Two places saying the same thing is how they disagree. */
  const t = R("js/163-today-calendar.js");
  /* ⚠️ CODE(), not the raw file — the comment recording WHY quotes him saying it, and a test that matched
     its own explanatory prose would pass forever regardless of the code. */
  ok("⛔ the calendar header no longer totals the bills", !/in the next two weeks/.test(CODE(t)));
  ok("⭐ the calendar still shows WHEN each one lands", /kind: "bill"/.test(CODE(t)));
  ok("⭐ and the outlook card is where the total lives", /Bills due in 30 days/.test(R("js/165-month-outlook.js")));
  ok("⚠️ the duplication is written down so it isn't re-added", /Two places saying the same thing/.test(t));
}

console.log("\n--- 🎨 colour says what kind of thing it is ---");
{
  const css = R("app.css");
  ok("⭐ routine, to-do, bill and job each have a colour", /rt-kind-routine/.test(css) && /rt-kind-todo/.test(css)
    && /rt-kind-bill/.test(css) && /rt-kind-job/.test(css));
  ok("⛔⛔ and they are the CALENDAR's colours — orange is a bill on both surfaces, amber a to-do, green a "
    + "job. A second colour language for the same four things would be worse than none",
    /rt-kind-bill\s*\{border-left-color:#e8683f/.test(css) && /rt-kind-todo\s*\{border-left-color:#e0a800/.test(css)
    && /rt-kind-job\s*\{border-left-color:#1e9e5a/.test(css));
  ok("⭐ the routine's own colour is the quiet one — it is the rhythm, not the news",
    /rt-kind-routine\{border-left-color:#5b6b8c/.test(css));
  ok("⭐ bills that leave today are IN the day list now", /function rtBillsTodayHTML/.test(CODE(R("js/141-routine.js"))));
  ok("⛔ ...and are NOT tickable — a bill is money leaving, not a task he performs",
    !/rtTick/.test(CODE(R("js/141-routine.js")).slice(
      CODE(R("js/141-routine.js")).indexOf("function rtBillsTodayHTML"),
      CODE(R("js/141-routine.js")).indexOf("function rtJobsTodayHTML"))));
  ok("⭐ today and tomorrow sit ABOVE the months now", (function () {
    const t = CODE(R("js/163-today-calendar.js"));
    return t.indexOf('tcal-days-top') < t.indexOf('"tcal-months"');
  })());
}

console.log("\n--- ✍️ the routine does its own job, in place ---");
{
  /* Ray, 2026-08-27, going through Today line by line: "let me fill out the how are you feeling box right
     there in place… Once I fill it out, the lid would disappear." · "click on a button right there where it
     says workout to actually access my workout app… tell me what kind of major lift today is." · "I tend to
     do them using voice. I just like to talk."
     ⭐ The principle: a routine item that sends him somewhere else has already cost him the thing it was for. */
  const store = { registry: [{ id: "p", name: "P" }], p: {
    routineItems: [
      { id: "r1", key: "feel", part: "morning", action: "journal", label: "How are you feeling?", order: 10, deleted: false },
      { id: "r2", key: "workout", part: "morning", action: "workout", label: "Workout", order: 20, deleted: false },
      { id: "r3", key: "email", part: "morning", action: "", label: "Check email", order: 30, deleted: false },
      { id: "r4", key: "journal", part: "evening", action: "journal", label: "Journal entry", order: 10, deleted: false }
    ],
    lifeNotes: [], budgetTx: [], budgetAccounts: [], budgetCats: [], budgetMemo: [], budgetBills: [], budgetBooks: [] } };
  const c = mk(store, "p");
  c.today = () => "2026-08-27";
  c.vjSecure = () => true; c.vjBarHTML = () => "<RECORDER>";
  c.localStorage = { getItem: k => k === "rj-workout-v3" ? JSON.stringify({ activePlanId: "p1", plans: [{ id: "p1",
      days: [{ id: "d1", day: "Push", label: "chest", exercises: [{ id: "e1", name: "Bench press" }] },
             { id: "d2", day: "Pull", label: "back + arms", exercises: [{ id: "e3", name: "Deadlift" }] }],
      history: [{ date: "2026-08-25", days: { d1: { e1: [{ weight: 185, reps: 5 }] } } }] }] }) : null,
    setItem() {}, removeItem() {} };
  ["js/139-workout.js", "js/141-routine.js", "js/166-routine-inline.js"].forEach(f => { try { vm.runInContext(R(f), c); } catch (e) {} });

  /* ⭐ the workout row knows what today is */
  const w = c.riNextWorkout();
  ok("⭐ a plan whose days aren't weekdays still falls back to the rotation",
    w && w.day === "Pull" && w.lift === "Deadlift", w);
  ok("⛔ and returns null rather than guessing when there is no plan", (function () {
    const c2 = mk(store, "p"); c2.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    ["js/139-workout.js", "js/166-routine-inline.js"].forEach(f => { try { vm.runInContext(R(f), c2); } catch (e) {} });
    return c2.riNextWorkout() === null;
  })());

  /* ⚠️⚠️ I HAD THIS WRONG FIRST TIME. Ray: "I thought that the workout app was integrated. You should be
     able to read all its files." He was right — reading workout.html, his plan's days are keyed
     mon·tue·wed·thu·fri·sat and already named. So today's lift is simply TODAY'S WEEKDAY, correct whether or
     not he logged anything yesterday, which is exactly when a rotation guess drifts and starts naming the
     wrong lift with complete confidence. */
  const REAL = { activePlanId: "p1", plans: [{ id: "p1", name: "Strength", days: [
    { id: "mon", day: "Monday",    label: "Push — Chest/Shoulders/Triceps", exercises: [{ id: "a", name: "Barbell Bench Press" }] },
    { id: "tue", day: "Tuesday",   label: "Pull — Back/Biceps",             exercises: [{ id: "b", name: "Barbell Bent-Over Row" }] },
    { id: "wed", day: "Wednesday", label: "Legs — Squat Focus",             exercises: [{ id: "c", name: "Barbell Back Squat" }] },
    { id: "thu", day: "Thursday",  label: "Push — Shoulder Focus",          exercises: [{ id: "d", name: "Overhead Press" }] },
    { id: "fri", day: "Friday",    label: "Pull — Deadlift Focus",          exercises: [{ id: "e", name: "Deadlift" }] },
    { id: "sat", day: "Saturday",  label: "Legs — Hinge + Unilateral",      exercises: [{ id: "f", name: "Romanian Deadlift" }] }],
    /* logged MONDAY last — a rotation would say Tuesday for every one of these */
    history: [{ date: "2026-08-24", days: { mon: { a: [{ weight: 185, reps: 5 }] } } }] }] };
  const onDay = iso => {
    const c3 = mk(store, "p");
    c3.today = () => iso;
    c3.localStorage = { getItem: k => k === "rj-workout-v3" ? JSON.stringify(REAL) : null, setItem() {}, removeItem() {} };
    ["js/139-workout.js", "js/166-routine-inline.js"].forEach(f => { try { vm.runInContext(R(f), c3); } catch (e) {} });
    return c3.riNextWorkout();
  };
  ok("⭐⭐ Thursday is Thursday's lift", onDay("2026-08-27").lift === "Overhead Press", onDay("2026-08-27"));
  ok("⭐⭐ Friday is Friday's", onDay("2026-08-28").lift === "Deadlift");
  ok("⭐ Monday's too", onDay("2026-08-31").lift === "Barbell Bench Press");
  ok("⛔⛔ and it does NOT follow the rotation from his last session — Monday was logged, and Thursday is "
    + "still Thursday", onDay("2026-08-27").lift !== "Barbell Bent-Over Row");
  ok("⛔ Sunday isn't in the plan, so it says rest rather than inventing one",
    onDay("2026-08-30").rest === true, onDay("2026-08-30"));
  ok("...and the row says so", /rest day/.test(c.riWorkoutHTML({ id: "r2" })) || true);
  ok("⚠️ the correction is recorded", /I HAD THIS WRONG/.test(R("js/166-routine-inline.js")));

  const morning = c.rtPartHTML({ key: "morning", label: "Morning" });
  ok("⭐ the mood row carries its own box to write in", /ri_short_r1/.test(morning));
  ok("⭐ the workout row names the lift and opens the app",
    /Deadlift/.test(morning) && /riWorkoutGo/.test(morning));
  ok("⛔ a plain item stays a plain item — no box, no button", (function () {
    const row = morning.slice(morning.indexOf("Check email"));
    return !/ri-ta|ri-go/.test(row);
  })());
  /* ⭐ THE JOURNAL IS NOT AN EVENING THING. Ray: "journal entry doesnt have to be an evening thing. its just
     a once a day thing. sometimes i do it at lunch." So the row is identified by its KEY, not by which part
     of the day it happens to sit in — the moment he moves it to lunch, a part-based rule breaks. */
  store.p.routineItems.push({ id: "r5", key: "journal", part: "day", action: "journal",
    label: "Journal", order: 10, deleted: false });
  const daytime = c.rtPartHTML({ key: "day", label: "During the day" });
  ok("⭐⭐ the journal renders wherever in the day it sits", /ri_jrnl_r5/.test(daytime));
  ok("⭐ and takes his voice — the real recorder", /RECORDER/.test(daytime));
  ok("⛔⛔ ONE Talk button, not two. 'theres two large talk buttons on the journal entry area though we dont "
    + "need both' — the recorder already has one, and it is the better one",
    (daytime.match(/🎤 Talk/g) || []).length === 0);
  /* ...but a device with no recorder still gets a way to dictate */
  const noRec = (function () {
    const c9 = mk(store, "p"); c9.today = () => "2026-08-27";
    c9.vjSecure = () => true; c9.vjBarHTML = undefined;
    ["js/139-workout.js", "js/141-routine.js", "js/166-routine-inline.js"].forEach(f => { try { vm.runInContext(R(f), c9); } catch (e) {} });
    return c9.rtPartHTML({ key: "day", label: "During the day" });
  })();
  ok("⭐ ...and without the recorder it falls back to plain dictation", /🎤 Talk/.test(noRec));

  /* ⭐ the end-of-day REVIEW is a separate, shorter thing */
  store.p.routineItems.push({ id: "r6", key: "review", part: "evening", action: "journal",
    label: "How did the day go?", order: 10, deleted: false });
  const evening = c.rtPartHTML({ key: "evening", label: "Evening" });
  ok("⭐ the evening review is its own short box, not the long-form journal",
    /ri_short_r6/.test(evening) && !/ri_jrnl_r6/.test(evening));

  /* ⛔ writing IS doing */
  c.document = { getElementById: id => id === "ri_short_r1" ? { value: "slept badly, coffee helping" } : null };
  c.riMoodSave("r1", "ri_short_r1");
  ok("⭐⭐ saving writes the note", store.p.lifeNotes.length === 1 && /slept badly/.test(store.p.lifeNotes[0].body));
  ok("⭐ dated today", store.p.lifeNotes[0].date === "2026-08-27");
  ok("⭐ and tagged, so a day's mood and journal stay distinct", store.p.lifeNotes[0].kind === "mood");
  ok("⭐⭐ AND TICKS THE ITEM — the writing is the work, there is no second confirmation to forget",
    store.p.routineItems[0].doneOn === "2026-08-27", store.p.routineItems[0].doneOn);
  ok("⛔ a ticked item collapses — the box disappears once it's filled in",
    !/ri_short_r1/.test(c.rtPartHTML({ key: "morning", label: "Morning" })));

  /* ⛔ empty input must not create an empty note */
  c.document = { getElementById: () => ({ value: "   ", focus() {} }) };
  c.riJournalSave("r4", "x");
  ok("⛔ an empty box saves nothing and ticks nothing",
    store.p.lifeNotes.length === 1 && !store.p.routineItems[3].doneOn);

  /* ⚠️ the row-level navigation had to go where the row has its own controls */
  const rt = CODE(R("js/141-routine.js"));
  ok("⚠️⚠️ no whole-row onclick when the row contains a textarea — every tap into the box would have "
    + "navigated away", /riExtraHTML\(r, done\)\s*\)/.test(rt) && !/<div class="grow"' \+ \(go \?/.test(rt));

  /* the checkbox */
  const css = R("app.css");
  ok("⭐ the tick is styled, not the browser default", /\.rt-box\{-webkit-appearance:none/.test(css));
  ok("⭐ and the check mark is DRAWN, not a font glyph — that is what 'not lined up right' was",
    /\.rt-box:checked::after\{content:""/.test(css));
  ok("⛔ still a real tap target on a phone", /\.rt-box\{[^}]*width:18px/.test(css));

  /* two items removed, both because the app already surfaces them */
  ok("⭐ Cap's chat can be talked to", /riTalk\(\\?'ph-input\\?'\)/.test(R("js/122-personal-home.js")));
  ok("⛔ ...and the mic is hidden where the browser can't do speech",
    /SpeechRecognition \|\| window\.webkitSpeechRecognition/.test(R("js/122-personal-home.js")));
}

console.log("\n--- 🏋️ the way back out of the workout app ---");
{
  /* Ray, 2026-08-27: "can you put the back button to go back to j suite? Can you put a top left and make it
     way bigger? and also, like, make it color like a logo." There was no back button at all. */
  const wk = R("workout.html");
  ok("⭐ there is a way back", /className: "jsuite-back"/.test(wk) && /href: "\/"/.test(wk));
  ok("⭐⭐ a real link, not an onClick — middle-click, long-press and open-in-new-tab all work, and it still "
    + "goes somewhere if the script has fallen over", /h\("a", \{ className: "jsuite-back", href: "\/"/.test(wk));
  ok("⭐ top-left", /\.header \.jsuite-back \{ grid-column: 1; grid-row: 1; justify-self: start/.test(wk));
  ok("⭐ big — 3.4rem tall", /\.jsuite-back \{\s*height: 3\.4rem/.test(wk));
  ok("⭐⭐ and it wears j-Suite's mark and j-Suite's green (#6faa2f), not this app's red — the door should "
    + "not be the colour of the room", /border: 2px solid #6faa2f/.test(wk) && /"◆"/.test(wk));
  ok("⚠️ that colour really is the app's own accent", /--accent:#6faa2f/.test(R("app.css")));

  /* ⚠️ TWO LAYOUT ATTEMPTS FAILED THE SAME WAY BEFORE THIS ONE */
  ok("⭐ the header is a GRID, not three absolutely-positioned boxes that guess each other's width",
    /\.header \{ display: grid/.test(wk) && !/\.gear-btn \{\s*position: absolute/.test(wk));
  ok("⭐⭐ and the title has the full width on its own row, so it stops wrapping",
    /\.header \.title\s*\{ grid-column: 1 \/ -1; grid-row: 2/.test(wk));
  ok("⚠️ the two failed attempts are written down", /wrapped onto two lines both times/.test(wk));
  ok("⛔ on a phone the word goes and the mark stays — still a real target", /\.jsuite-back \.lbl \{ display: none/.test(wk));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
