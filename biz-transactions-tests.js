/* biz-transactions-tests.js — Business Transactions (js/175): tags, suggestions, the expense an approval writes,
   and the MANDATORY migration fixture (CLAUDE.md): a realistic pre-change store with Square rows filed under the
   Personal book survives migrateStore + a sync round-trip with zero loss, and the refile lands them in the OBX book.
   Run: node biz-transactions-tests.js → 0 failed (exit 0). Touches nothing real. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const SS = require("./sync-server");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } };

/* load js/143's key helpers + js/175 in one sandbox so the real merchant-key logic is exercised */
const sb = { console, module: { exports: {} }, S: { biz: "obx" }, D: () => sb.S.obx, RCPT_CATS: ["materials", "tools/equipment", "disposal", "fuel", "rentals", "subscription/software", "marketing/ads", "uniforms", "meals", "crew supplies", "office/admin", "other"], uid: () => "t1", now: () => 1 };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, "js", "143-ledger.js"), "utf8"), sb, { filename: "js/143-ledger.js" });
vm.runInContext(fs.readFileSync(path.join(__dirname, "js", "175-biz-transactions.js"), "utf8"), sb, { filename: "js/175-biz-transactions.js" });
const B = sb.module.exports;

console.log("— tag vocabulary —");
const custom = [{ name: "Gravel", cat: "materials" }, { name: "Trailer parts", cat: "nonsense" }];
const tags = B.btxTagList(custom);
ok("base categories first, custom tags after, each rolling up to a real category", tags.length === 14 && tags[12].name === "Gravel" && tags[12].cat === "materials" && tags[13].cat === "other", tags.slice(12));
ok("btxTagCat resolves a custom tag to its category and a base tag to itself", B.btxTagCat("Gravel", custom) === "materials" && B.btxTagCat("fuel", custom) === "fuel" && B.btxTagCat("???", custom) === "other");

console.log("— suggestions carry a reason and never fire without evidence —");
let memo = [];
const wawa = { id: "t1", note: "Wawa", dir: "out", amount: 18.29, date: "2026-09-09" };
let s = B.btxSuggest(wawa, memo);
ok("new payee → no tag, 'none', explained", s.tag === "" && s.confidence === "none" && /new payee/.test(s.why), s);
B.btxLearn(memo, "Wawa", "fuel", "");
s = B.btxSuggest(wawa, memo);
ok("after one approval the same payee is recognized (high) with the count in the reason", s.tag === "fuel" && s.confidence === "high" && /before/.test(s.why), s);
B.btxLearn(memo, "Wawa", "fuel", ""); B.btxLearn(memo, "Wawa #1234", "fuel", "");
ok("hits accumulate across key-equal descriptions", memo[0].hits === 3 && B.btxSuggest(wawa, memo).why.indexOf("3 times") > 0, memo[0]);
B.btxLearn(memo, "Wawa", "crew supplies", "");
ok("re-tagging a payee resets the count to 1 (the newest decision wins)", memo[0].catId === "crew supplies" && memo[0].hits === 1, memo[0]);
B.btxLearn(memo, "HOMEDEPOT.COM 800-430-3376", "tools/equipment", "");
s = B.btxSuggest({ note: "The Home Depot #3033 Kill Devil Hi NC", dir: "out", amount: 50 }, memo);
ok("different key, same merchant → fuzzy 'probably' (medium), not high", s.confidence === "medium" && s.tag === "tools/equipment", s);
s = B.btxSuggest({ note: "The Home Depot #3033", dir: "out", amount: 50 }, (B.btxLearn(memo, "The Home Depot #3033 Kill Devil Hi NC", "tools/equipment", ""), memo));
ok("same three-word key → exact (high)", s.confidence === "high", s);
s = B.btxSuggest({ note: "Card payment", dir: "in", amount: 966.7 }, memo);
ok("money in labelled Card payment → Square payout, high", s.tag === "__payout" && s.confidence === "high", s);
s = B.btxSuggest({ note: "The Home Depot", dir: "in", amount: 24.47 }, memo);
ok("money in from a KNOWN merchant → the tag it refunds, worded as a refund", s.tag === "tools/equipment" && /refund/.test(s.why), s);
s = B.btxSuggest({ note: "Some Store", dir: "in", amount: 9 }, memo);
ok("money in from an unknown merchant → no tag, refund question", s.tag === "" && /refund/.test(s.why), s);
ok("a learned job rides the suggestion (Vulcan → hot tub pad)", (B.btxLearn(memo, "Vulcan Mideast", "Gravel", "job_hottub"), B.btxSuggest({ note: "Vulcan Mideast", dir: "out", amount: 33.7 }, memo).jobId === "job_hottub"));

console.log("— the expense an approval writes —");
const rec = B.btxExpenseRecord({ id: "bgt-tx-1", note: "Soundside Recycling & Materials Inc.", dir: "out", amount: 33.12, date: "2026-08-18" }, "disposal", "disposal", { txOrg: "mqwvs3mq98pij", by: "Rj", note: "dump run" });
ok("shape: ex_ id, positive amount, vendor/desc from the payee, category+tag, bank source, back-links to the tx", rec.id === "ex_t1" && rec.amount === 33.12 && rec.vendor === "Soundside Recycling & Materials Inc." && rec.category === "disposal" && rec.tag === "disposal" && rec.source === "bank" && rec.txId === "bgt-tx-1" && rec.txOrg === "mqwvs3mq98pij" && rec.paidBy === "" && rec.note === "dump run" && rec.deleted === false, rec);
const refund = B.btxExpenseRecord({ id: "bgt-tx-2", note: "The Home Depot", dir: "in", amount: 24.47, date: "2026-09-05" }, "Gravel", "materials", {});
ok("a refund is a NEGATIVE expense in the tag's category", refund.amount === -24.47 && refund.category === "materials" && /refund/.test(refund.desc), refund);

console.log("— rows: only this business's accounts; tagged here = done, a personal-side category does not count —");
const tx = [
  { id: "a", accountId: "sq", date: "2026-09-09", dir: "out", amount: 1, catId: "", pending: true },
  { id: "b", accountId: "sq", date: "2026-06-12", dir: "out", amount: 2, catId: "c_home", pending: false },   // approved on the personal side with a personal cat
  { id: "c", accountId: "sq", date: "2026-08-01", dir: "out", amount: 3, btxTag: "fuel", pending: false },
  { id: "d", accountId: "nfcu", date: "2026-09-10", dir: "out", amount: 4 },
  { id: "e", accountId: "sq", date: "2026-09-10", dir: "out", amount: 5, deleted: true }
];
const rows = B.btxRowsFrom(tx, ["sq"]);
ok("three rows, newest first, other accounts and deleted rows excluded", rows.map(r => r.id).join() === "a,c,b", rows.map(r => r.id));
ok("status: untagged and personally-categorised rows are inbox; a btxTag makes it done", rows.map(r => r.status).join() === "inbox,done,inbox", rows.map(r => r.status));

console.log("— MIGRATION FIXTURE: Square rows filed under the Personal book, refiled to the OBX book, zero loss —");
const pre = {
  users: [{ id: "u_ray", username: "Rj", role: "owner", updatedAt: 1 }],
  registry: [{ id: "obx", name: "OBX Lot Solutions", updatedAt: 1 }],
  obx: {
    customers: [{ id: "c1", name: "Mike Green", updatedAt: 1 }], properties: [], quotes: [{ id: "q1", customerId: "c1", total: 600, updatedAt: 1 }],
    jobs: [{ id: "j1", title: "Hot Tub Pad", customerId: "c1", date: "2026-06-30", updatedAt: 1 }],
    income: [{ id: "i1", amount: 600, date: "2026-07-14", crew: ["u_ray"], updatedAt: 1 }],
    expenses: [{ id: "e1", amount: 913.74, category: "tools/equipment", vendor: "Ace Hardware", date: "2026-06-12", updatedAt: 1 }],
    jobExpenses: [], budgetMemo: [], timeclock: [], messages: [], disbursements: [], knowledge: [], pendingChanges: [], docs: [], places: [], changelog: []
  },
  mqwvs3mq98pij: {
    customers: [], quotes: [], jobs: [],
    budgetBooks: [{ id: "bgt-book-default-mqwvs3mq98pij", name: "Personal", kind: "personal", updatedAt: 1 }, { id: "bgt-book-obx", name: "OBX Lot Solutions", kind: "business", linkedOrgId: "obx", updatedAt: 1 }],
    budgetAccounts: [{ id: "bgt-acct-nfcu-personal", bookId: "bgt-book-default-mqwvs3mq98pij", name: "RJ's Checking", type: "checking", updatedAt: 1 }, { id: "bgt-acct-square-obx", bookId: "bgt-book-obx", name: "Square — OBX Lot Solutions", type: "checking", updatedAt: 1 }],
    budgetCats: [{ id: "c_home", name: "Home & hardware", kind: "out", bookId: "bgt-book-default-mqwvs3mq98pij", updatedAt: 1 }],
    budgetTx: [
      { id: "bgt-tx-p1", accountId: "bgt-acct-nfcu-personal", bookId: "bgt-book-default-mqwvs3mq98pij", date: "2026-09-01", dir: "out", amount: 55, note: "Publix", catId: "", pending: true, updatedAt: 1 },
      { id: "bgt-tx-s1", accountId: "bgt-acct-square-obx", bookId: "bgt-book-default-mqwvs3mq98pij", date: "2026-08-25", dir: "out", amount: 200, note: "Anthropic Claude Team", catId: "", pending: true, source: "bank", updatedAt: 1 },
      { id: "bgt-tx-s2", accountId: "bgt-acct-square-obx", bookId: "bgt-book-default-mqwvs3mq98pij", date: "2026-06-15", dir: "out", amount: 202.95, note: "The Home Depot", catId: "c_home", pending: false, source: "bank", updatedAt: 1 },
      { id: "bgt-tx-s3", accountId: "bgt-acct-square-obx", bookId: "bgt-book-obx", date: "2026-09-09", dir: "out", amount: 18.29, note: "Wawa", catId: "", pending: true, source: "bank", updatedAt: 1 }
    ],
    budgetMemo: [], budgetBudgets: [], budgetTax: [], budgetBills: [], income: [], expenses: []
  }
};
function census(st) {
  const c = {};
  ["customers", "quotes", "jobs", "income", "expenses"].forEach(k => { c["obx." + k] = ((st.obx || {})[k] || []).filter(r => r && !r.deleted).length; });
  ["budgetBooks", "budgetAccounts", "budgetCats", "budgetTx"].forEach(k => { c["personal." + k] = ((st.mqwvs3mq98pij || {})[k] || []).filter(r => r && !r.deleted).length; });
  c._accounts = (st.users || []).filter(u => u && !u.kind && !u.deleted).length;
  return c;
}
const before = census(pre);
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(pre)));
const n = B.btxRefileBooks(migrated.mqwvs3mq98pij);
const round = SS.mergeState(migrated, {});
const am = census(migrated), ar = census(round);
Object.keys(before).forEach(k => ok("no loss in " + k + " (before=" + before[k] + " migrated=" + am[k] + " round=" + ar[k] + ")", am[k] >= before[k] && ar[k] >= before[k]));
ok("exactly the two mis-filed Square rows were refiled (the right one and the personal one untouched)", n === 2, n);
const P = round.mqwvs3mq98pij.budgetTx;
ok("Square rows now sit in the OBX book", P.filter(t => t.accountId === "bgt-acct-square-obx").every(t => t.bookId === "bgt-book-obx"), P.map(t => [t.id, t.bookId]));
ok("the personal row keeps the Personal book", P.find(t => t.id === "bgt-tx-p1").bookId === "bgt-book-default-mqwvs3mq98pij");
ok("nothing else on the rows changed (catId, pending, amount, note intact)", (function () { const s2 = P.find(t => t.id === "bgt-tx-s2"); return s2.catId === "c_home" && s2.pending === false && s2.amount === 202.95 && s2.note === "The Home Depot"; })());
ok("refile is idempotent", B.btxRefileBooks(round.mqwvs3mq98pij) === 0);
const rows2 = B.btxRowsFrom(P, ["bgt-acct-square-obx"]);
ok("the business screen sees all three Square rows as inbox (the personal category never counted as a business decision)", rows2.length === 3 && rows2.every(r => r.status === "inbox"), rows2.map(r => [r.id, r.status]));

console.log("— ingest files a new row under the paired account's book (js/143 fix) —");
const ing = { console, S: { biz: "p" }, D: () => ing.S.p, uid: () => "n1", now: () => 2, budgetDefaultBookId: () => "bgt-book-default-p", budgetCat: () => null, module: { exports: {} } };
ing.S.p = { budgetTx: [], budgetAccounts: [{ id: "acct-sq", bookId: "book-obx" }], budgetBooks: [{ id: "book-obx" }], budgetMemo: [], budgetBills: [] };
vm.createContext(ing);
vm.runInContext(fs.readFileSync(path.join(__dirname, "js", "143-ledger.js"), "utf8"), ing, { filename: "js/143-ledger.js" });
const res = vm.runInContext('ledgerIngest([{ externalId: "x1", date: "2026-09-10", dir: "out", amount: 12.5, desc: "Wawa", accountId: "acct-sq" }, { externalId: "x2", date: "2026-09-10", dir: "out", amount: 3, desc: "Publix", accountId: "acct-none" }], { source: "bank" })', ing);
const T = ing.S.p.budgetTx;
ok("row on a paired account → that account's book; row on an unknown account → the default book", res.added === 2 && T.find(t => t.externalId === "x1").bookId === "book-obx" && T.find(t => t.externalId === "x2").bookId === "bgt-book-default-p", T.map(t => [t.externalId, t.bookId]));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
