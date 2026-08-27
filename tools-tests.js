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

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
