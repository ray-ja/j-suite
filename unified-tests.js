/* unified-tests.js — one ledger across every entity.

   Ray, 2026-08-25, choosing how to resolve the two-ledger split: "single source."

   WHAT THIS DEFENDS:

   1. ⛔ THE MULTIPLY-COUNT. The business side is five overlapping collections that cross-reference each
      other by receiptId. `receipts` is an INBOX that routes into the others; `jobMaterials` are
      pass-through, billed on to the customer. Counting all five inflates his costs — on his live OBX book
      by $2,345.37, which is more than half of what that business has actually spent.

   2. ⭐ IT AGREES WITH THE EXISTING AUTHORITY. js/64 already knows what a business spent: paid `expenses`
      + finJobExpenseOut(). Two functions that both claim to know that will eventually disagree and only
      one will get fixed, so this asserts they produce the SAME number on the same data.

   3. ⚠️ THE ORG CONTEXT IS ALWAYS PUT BACK. Every business helper reads D() = S[S.biz]. Totalling another
      org means borrowing S.biz — and if a throw escapes before it is restored, he is left looking at
      another company's books with no indication anything happened.

   4. ⛔ NOTHING MOVES. "Single source" is a single READ, not a migration of a hundred live money records.
      js/40, js/64, js/109, the payout waterfall and the GL all read those collections today.

   Pure node. Run: node unified-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PROSE = (src) => src.replace(/\s+/g, " ");

const SRC = R("js/151-unified-ledger.js"), STMT = R("js/149-statements.js"), SHELL = R("Business App (v1).html");

function sandbox(S) {
  const ctx = { console, S, today: () => "2026-08-25", now: () => 1, window: {},
    esc: s => String(s == null ? "" : s), touch: r => r, save: () => {}, render: () => {},
    budgetMoney: n => "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2),
    budgetCatName: id => id };
  ctx.D = () => S[S.biz];
  vm.createContext(ctx);
  vm.runInContext("function plExpenses(j){return (D().jobExpenses||[]).filter(e=>e&&!e.deleted&&e.jobId===j.id)}", ctx);
  vm.runInContext(SRC, ctx);
  Object.assign(ctx, ctx.window);
  return ctx;
}
/* a store shaped like his: a business org with all five collections, and a personal org with budgetTx */
const store = () => ({
  biz: "obx",
  registry: [{ id: "obx", name: "OBX Lot Solutions" }, { id: "jam", name: "Jamieson" }, { id: "me", name: "RBJVL" }],
  obx: {
    income: [{ id: "i1", amount: 960, date: "2026-08-10", deleted: false },
             { id: "i2", amount: 290, date: "2026-08-12", deleted: false }],
    expenses: [{ id: "e1", amount: 39, date: "2026-08-05", category: "software", desc: "Hosting", deleted: false },
               { id: "e2", amount: 500, date: "2026-08-06", category: "office", desc: "A BILL", unpaid: true, deleted: false }],
    jobs: [{ id: "j1", date: "2026-08-08", deleted: false }],
    jobExpenses: [{ id: "je1", jobId: "j1", amount: 46.52, date: "2026-08-08", vendor: "Lowe's", deleted: false }],
    /* ⛔ the two that must NEVER be counted */
    receipts: [{ id: "r1", amount: 71.99, date: "2026-08-08", vendor: "Home Depot", deleted: false },
               { id: "r2", amount: 254.49, date: "2026-08-08", vendor: "Lowe's", deleted: false }],
    jobMaterials: [{ id: "m1", jobId: "j1", amount: 54.98, date: "2026-08-08", deleted: false }],
    budgetTx: [], budgetCats: [], budgetBooks: [], budgetAccounts: []
  },
  jam: { income: [], expenses: [], jobs: [], jobExpenses: [], receipts: [], jobMaterials: [], budgetTx: [] },
  me: {
    income: [], expenses: [], jobs: [], jobExpenses: [], receipts: [], jobMaterials: [],
    budgetTx: [{ id: "b1", date: "2026-08-11", dir: "in", amount: 1500, catId: "c_in", bookId: "bk", deleted: false },
               { id: "b2", date: "2026-08-13", dir: "out", amount: 200, catId: "c_out", bookId: "bk", deleted: false },
               /* each of these must be skipped, for the reasons the other gates already established */
               { id: "b3", date: "2026-08-14", dir: "out", amount: 99, pending: true, deleted: false },
               { id: "b4", date: "2026-08-15", dir: "out", amount: 88, isTransfer: true, deleted: false },
               { id: "b5", date: "2026-08-16", dir: "out", amount: 77, isSplit: true, deleted: false }],
    budgetCats: [], budgetBooks: [], budgetAccounts: []
  }
});

console.log("\n--- ⛔ 1. the multiply-count ---");
{
  const S = store(), c = sandbox(S);
  const rows = c.uniOrgRows("obx", "", "9999");
  const out = rows.filter(r => r.dir === "out").reduce((s, r) => s + r.amount, 0);

  eq("⭐ cash out is paid expenses + job expenses, and nothing else", Math.round(out * 100) / 100, 85.52);
  ok("⛔ receipts are NOT counted — a receipt is filed as one of the others",
    !rows.some(r => r.amount === 71.99 || r.amount === 254.49), rows.map(r => r.amount));
  ok("⛔ pass-through materials are NOT his cost — they're billed to the customer",
    !rows.some(r => r.amount === 54.98));
  ok("⛔ an UNPAID expense is a bill, not cash out", !rows.some(r => r.amount === 500));
  ok("...and the A/P reason is recorded", /unpaid` is a BILL, not cash out/.test(PROSE(SRC)));

  const sources = {};
  rows.forEach(r => sources[r.source] = (sources[r.source] || 0) + 1);
  eq("only the three counting sources appear", Object.keys(sources).sort().join(), "expense,income,jobExpense");
  ok("⛔ neither excluded collection is even read into a row", !/receipts/.test(CODE(SRC).replace(/jobMaterials/g, "")) || !/uniActive\(d\.receipts\)/.test(CODE(SRC)));
  ok("the whole hazard is documented at the top", /NEVER COUNT/.test(SRC) && /multiply-count/.test(PROSE(SRC)));
}

console.log("\n--- ⭐ 2. it agrees with the existing authority ---");
{
  const S = store(), c = sandbox(S);
  /* js/64's rule, computed independently right here */
  const d = S.obx;
  const authoritative = d.expenses.filter(e => !e.deleted && !e.unpaid).reduce((s, e) => s + e.amount, 0)
    + d.jobExpenses.filter(e => !e.deleted && !e.unpaid).reduce((s, e) => s + e.amount, 0);
  const rows = c.uniOrgRows("obx", "", "9999");
  const unified = rows.filter(r => r.dir === "out").reduce((s, r) => s + r.amount, 0);
  eq("⭐ the unified total EQUALS js/64's cash-out rule", Math.round(unified * 100) / 100, Math.round(authoritative * 100) / 100);

  const incAuth = d.income.filter(i => !i.deleted).reduce((s, i) => s + i.amount, 0);
  const incUni = rows.filter(r => r.dir === "in").reduce((s, r) => s + r.amount, 0);
  eq("...and income matches too", incUni, incAuth);
  ok("⭐ it reuses plExpenses rather than re-deriving per-job costs", /plExpenses\(j\)/.test(CODE(SRC)));
  ok("...and says why two totals must never both exist", /only one of them will get fixed/.test(PROSE(SRC)));
}

console.log("\n--- ⚠️ 3. the org context is always put back ---");
{
  const S = store(), c = sandbox(S);
  eq("it starts where it started", S.biz, "obx");
  c.uniOrgRows("jam", "", "9999");
  eq("⭐ reading another org restores the current one", S.biz, "obx");
  c.uniRows("", "9999");
  eq("...and so does sweeping every org", S.biz, "obx");

  /* ⚠️ THE DANGEROUS PATH: a throw inside the borrowed context */
  const threw = c.uniInOrg("jam", function () { throw new Error("boom"); });
  eq("⭐ a THROW still restores it — otherwise he's looking at another company's books", S.biz, "obx");
  eq("...and the failure is a null, not a crash", threw, null);
  ok("the restore is in a finally, not just on the happy path", /finally \{ S\.biz = prev; \}/.test(CODE(SRC)));
  ok("...and the danger is written down", /wrong company/.test(PROSE(SRC)));

  eq("an unknown org is null, not a throw", c.uniInOrg("nope", () => 1), null);
  eq("...and doesn't disturb the context either", S.biz, "obx");
}

console.log("\n--- every entity, one list ---");
{
  const S = store(), c = sandbox(S);
  const g = c.uniByOrg("2026-08-01", "2026-08-31");

  eq("all three orgs are swept", c.uniOrgs().length, 3);
  const obx = g.orgs.find(o => o.orgId === "obx");
  const me = g.orgs.find(o => o.orgId === "me");
  eq("⭐ the business nets out correctly", obx.net, Math.round((1250 - 85.52) * 100) / 100);
  eq("⭐ the personal book is in the same list", me.net, 1300);
  ok("...and an empty org simply isn't listed", !g.orgs.some(o => o.orgId === "jam"), g.orgs.map(o => o.orgId));
  eq("the combined line adds the parts", g.total.net, Math.round((obx.net + me.net) * 100) / 100);
  ok("each entity is named", obx.orgName === "OBX Lot Solutions" && me.orgName === "RBJVL");
  ok("margin is only shown where there was income", obx.margin != null && obx.margin > 0);

  /* the personal side keeps every gate it already had */
  const rows = c.uniOrgRows("me", "", "9999");
  ok("⛔ an unapproved row is still not money", !rows.some(r => r.amount === 99));
  ok("⛔ a transfer is still not income or spending", !rows.some(r => r.amount === 88));
  ok("⛔ a split parent still defers to its slices", !rows.some(r => r.amount === 77));
  eq("...leaving exactly the two real ones", rows.length, 2);
}

console.log("\n--- dates and ordering ---");
{
  const S = store(), c = sandbox(S);
  eq("a window excludes what's outside it", c.uniRows("2026-08-11", "2026-08-12").length, 2);
  /* 2 income + 1 paid expense + 1 job expense on OBX, + 2 real budget rows = 6.
     ⚠️ NOT 7 — the unpaid $500 bill is A/P, not cash, and must not appear. */
  eq("an open window takes everything that is actually cash", c.uniRows("", "9999").length, 6);
  const rows = c.uniRows("", "9999");
  ok("⛔ and the A/P bill is still absent from the open window", !rows.some(r => r.amount === 500));
  ok("newest first", rows[0].date >= rows[rows.length - 1].date, rows.map(r => r.date));
  ok("every row says which entity it came from", rows.every(r => r.orgId && r.orgName));
  ok("...and which collection", rows.every(r => c.UNI_SOURCES.indexOf(r.source) >= 0));
}

console.log("\n--- ⛔ 4. nothing moved ---");
{
  const S = store(), c = sandbox(S);
  const before = JSON.stringify(S);
  c.uniRows("", "9999"); c.uniByOrg("", "9999"); c.uniAllEntitiesHTML({ from: "", to: "9999", label: "x" });
  eq("⭐ reading the unified ledger changes NOTHING in the store", JSON.stringify(S), before);
  ok("⛔ it never writes", !/save\(\)|touch\(|\.push\(D\(\)|D\(\)\.\w+\.push/.test(CODE(SRC)));
  ok("⭐ ...and the staged plan is recorded, so nobody 'finishes' it by moving the data",
    /the WRITES migrate afterwards/.test(PROSE(SRC)));
  ok("...including what has to exist first", /matching/.test(PROSE(SRC)));
}

console.log("\n--- what he sees ---");
{
  const S = store(), c = sandbox(S);
  const html = c.uniAllEntitiesHTML({ from: "2026-08-01", to: "2026-08-31", label: "2026-08" });
  ok("every business is named", /OBX Lot Solutions/.test(html) && /RBJVL/.test(html));
  ok("...with a combined line", /Together/.test(html));
  ok("⭐ and it says where the numbers come from", /Business figures come from your jobs/.test(PROSE(html)));
  ok("⭐ ...including that receipts and materials aren't double-counted", /aren't counted twice/.test(PROSE(html)));
  eq("⛔ an empty period renders nothing rather than a row of zeroes",
    sandbox({ biz: "x", registry: [], x: {} }).uniAllEntitiesHTML({ from: "a", to: "b", label: "x" }), "");

  ok("it's on the Statements screen", /uniAllEntitiesHTML/.test(CODE(STMT)));
  ok("...above the single-book statement", CODE(STMT).indexOf("uniAllEntitiesHTML") < CODE(STMT).indexOf("stmtLine(\"Total in\""));
  ok("the module is in the shell", /js\/151-unified-ledger\.js/.test(SHELL));
  ok("...after the statements it feeds", SHELL.indexOf("149-statements") < SHELL.indexOf("151-unified"));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
