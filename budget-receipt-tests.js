/* budget-receipt-tests.js — js/121 receipt photo -> budget transaction.
   The two invariants that matter: an UNCONFIRMED scan must never move a number, and the server must
   recognise a budgetTx's receiptId as belonging to the org (or the read 404s).
   Pure node. Run: node budget-receipt-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
const sv = require("./sync-server.js");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const SRC121 = fs.readFileSync(path.join(__dirname, "js", "121-budget-receipt.js"), "utf8");
const SRC79 = fs.readFileSync(path.join(__dirname, "js", "79-budget.js"), "utf8");
const SRCSV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");

console.log("\n--- SERVER: a budgetTx receiptId must count as owned by the org ---");
function st(slab) { return { obx: {}, mqwvs3mq98pij: slab }; }
ok("a budgetTx receipt is owned",
  sv.rcptOwnedByOrg(st({ budgetTx: [{ id: "t1", receiptId: "abc123.jpg" }] }), "mqwvs3mq98pij", "abc123.jpg"));
ok("an unrelated blob is NOT owned",
  !sv.rcptOwnedByOrg(st({ budgetTx: [{ id: "t1", receiptId: "abc123.jpg" }] }), "mqwvs3mq98pij", "other.jpg"));
ok("a budgetTx in ANOTHER org does not grant ownership",
  !sv.rcptOwnedByOrg({ obx: { budgetTx: [{ id: "t1", receiptId: "abc123.jpg" }] }, mqwvs3mq98pij: {} }, "mqwvs3mq98pij", "abc123.jpg"));
ok("empty receiptId is never owned", !sv.rcptOwnedByOrg(st({ budgetTx: [] }), "mqwvs3mq98pij", ""));
ok("the pre-existing paths still work (expenses)",
  sv.rcptOwnedByOrg(st({ expenses: [{ id: "e", receiptId: "x.png" }] }), "mqwvs3mq98pij", "x.png"));
ok("...and jobExpenses",
  sv.rcptOwnedByOrg(st({ jobExpenses: [{ id: "e", receiptId: "y.png" }] }), "mqwvs3mq98pij", "y.png"));

console.log("\n--- THE MONEY INVARIANT: a pending scan moves no number ---");
ok("actBudgetTx excludes t.pending", /!t\.deleted&&!t\.pending&&!t\.isTransfer/.test(SRC79));
ok("confirming in the edit modal clears pending", /if\(t\.pending\)delete t\.pending;/.test(SRC79));
/* prove the accessor really filters, by running it against a stub D() */
const ctx = {
  console: console, Math: Math, JSON: JSON, String: String, Number: Number, Array: Array, Object: Object,
  D: () => ({
    budgetTx: [
      { id: "real", amount: 100, date: "2026-07-01", bookId: "b1" },
      { id: "scan", amount: 999, date: "2026-07-01", bookId: "b1", pending: true },
      { id: "gone", amount: 50, date: "2026-07-01", bookId: "b1", deleted: true },
      { id: "xfer", amount: 20, date: "2026-07-01", bookId: "b1", isTransfer: true }
    ]
  }),
  budgetInBook: () => true
};
vm.createContext(ctx);
const fnSrc = (SRC79.match(/function actBudgetTx\(\)\{[^\n]*\}/) || [])[0];
ok("found actBudgetTx to execute", !!fnSrc);
if (fnSrc) {
  vm.runInContext(fnSrc + "\nthis.actBudgetTx=actBudgetTx;", ctx);
  const got = ctx.actBudgetTx().map(t => t.id);
  eq("only the real txn survives the accessor", JSON.stringify(got), JSON.stringify(["real"]));
  ok("the pending scan is excluded", got.indexOf("scan") < 0);
  eq("so the month total ignores it", ctx.actBudgetTx().reduce((s, t) => s + t.amount, 0), 100);
}

console.log("\n--- the read is mapped defensively (all AI output untrusted) ---");
const c2 = {
  console: console, Math: Math, JSON: JSON, String: String, Number: Number, Array: Array, Object: Object, isNaN: isNaN,
  touch: () => {}, uid: () => "x", today: () => "2026-07-27"
};
let TX;
c2.D = () => ({
  budgetTx: [TX],
  budgetCats: [
    { id: "c_food", name: "Groceries", kind: "out", bookId: "b1" },
    { id: "c_pay", name: "Paycheck", kind: "in", bookId: "b1" },
    { id: "c_other", name: "Groceries", kind: "out", bookId: "b2" }   // same name, WRONG book
  ]
});
vm.createContext(c2);
vm.runInContext((SRC121.match(/function bgtRcptApply\(txId, s\) \{[\s\S]*?\n\}/) || [""])[0] + "\nthis.bgtRcptApply=bgtRcptApply;", c2);
function fresh() { TX = { id: "t1", bookId: "b1", date: "2026-07-27", dir: "out", amount: 0, catId: "", note: "" }; return TX; }

fresh(); c2.bgtRcptApply("t1", { amount: 42.5, date: "2026-07-20", vendor: "Food Lion", category: "Groceries" });
eq("amount applied", TX.amount, 42.5);
eq("date applied", TX.date, "2026-07-20");
eq("vendor becomes the note", TX.note, "Food Lion");
eq("category resolved to an id IN THIS BOOK", TX.catId, "c_food");
eq("direction follows the category kind", TX.dir, "out");

fresh(); c2.bgtRcptApply("t1", { amount: 900, category: "Paycheck" });
eq("an income category flips the direction", TX.dir, "in");

fresh(); c2.bgtRcptApply("t1", { amount: 30, refund: true, category: "Groceries" });
eq("a refund becomes income", TX.dir, "in");
eq("...with a positive amount", TX.amount, 30);

fresh(); c2.bgtRcptApply("t1", { amount: "not a number", date: "20-07-2026", category: "Nope" });
eq("a junk amount leaves it at 0", TX.amount, 0);
eq("a badly formatted date is ignored", TX.date, "2026-07-27");
eq("an unknown category is ignored", TX.catId, "");

fresh(); c2.bgtRcptApply("t1", { amount: -18, category: "Groceries" });
eq("a negative amount is taken as magnitude spending", TX.amount, 18);
eq("...and stays spending", TX.dir, "out");

fresh(); c2.bgtRcptApply("t1", {});
eq("an empty read changes nothing harmful", TX.amount, 0);
fresh(); c2.bgtRcptApply("t1", null);
ok("a null read doesn't throw", true);

fresh(); c2.bgtRcptApply("t1", { vendor: "x".repeat(400) });
ok("the note is length-clamped", TX.note.length <= 120, TX.note.length + " chars");

console.log("\n--- THE RACE GUARD must never be removed ---");
ok("whenSynced is awaited before the read", /await whenSynced\(/.test(SRC121));
const upIdx = SRC121.indexOf("await jsUpload"), syncIdx = SRC121.indexOf("await whenSynced("), readIdx = SRC121.indexOf("await bgtRcptRead(");
ok("order is upload -> whenSynced -> read", upIdx > 0 && syncIdx > upIdx && readIdx > syncIdx,
  "upload@" + upIdx + " sync@" + syncIdx + " read@" + readIdx);
ok("the pending record is pushed BEFORE the sync wait", SRC121.indexOf("d.budgetTx.push(t)") < syncIdx);

console.log("\n--- wiring ---");
ok("registered in the shell",
  fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/121-budget-receipt.js"') > 0);
ok("the scan card renders on the Transactions tab", /body\.innerHTML=_rcptCard\+h;/.test(SRC79));
ok("the card is built via the js/121 helper", /bgtRcptCardHTML\(\)/.test(SRC79));
ok("the server ownership check includes budgetTx", /\(s\.budgetTx \|\| \[\]\)\.some\(t => t && t\.receiptId === receiptId\)/.test(SRCSV));
ok("no jobs are sent with a personal receipt read", /jobs: \[\]/.test(SRC121));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
