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

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
