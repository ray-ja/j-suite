#!/usr/bin/env node
"use strict";
/*
 * stmt-import.js — put parsed Navy Federal rows into Ray's Budget (personal book).
 *
 * Runs AFTER stmt-parse.js has reconciled: every statement's parsed deposits/withdrawals match the bank's own
 * summary to the penny. Importing numbers that don't reconcile would be worse than importing nothing.
 *
 * RULES
 *  - CHECKING ONLY. The statements also carry Membership Savings; those rows are tagged and skipped here.
 *  - DETERMINISTIC IDS (nfcu-<date>-<amount>-<hash of desc>) so re-running never duplicates a transaction.
 *  - INTERNAL MOVES are flagged isTransfer, which js/79 excludes from income/expense totals — otherwise moving
 *    money to a credit card would read as "spending" and inflate his outflow twice.
 *  - The Themeforge draw is imported as INCOME to the personal book. It is genuinely income from Personal's
 *    point of view. When the business statements arrive it should become a PAIRED transfer instead, or it
 *    double-counts across books — that's a deliberate, noted trade-off, not an oversight.
 *
 *   node stmt-import.js --dry     show what would happen
 *   node stmt-import.js --commit  write it
 */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { execFileSync } = require("child_process");

const FILE = path.join(__dirname, "data.json");
const ORG = "mqwvs3mq98pij";
const BOOK = "bgt-book-default-" + ORG;
const ACCT = "bgt-acct-nfcu-personal";
const COMMIT = process.argv.indexOf("--commit") >= 0;

/* ---- categories: few, plain, and mapped from what the descriptions actually say ---- */
const CATS = [
  ["c_rent",      "Rent",                 "out"],
  ["c_mortgage",  "Idaho mortgage",       "out"],
  ["c_carloan",   "Car loan",             "out"],
  ["c_cards",     "Credit card payments", "out"],
  ["c_grocery",   "Groceries",            "out"],
  ["c_home",      "Home & hardware",      "out"],
  ["c_utilities", "Utilities",            "out"],
  ["c_spending",  "Everyday spending",    "out"],
  ["c_cash",      "Cash / ATM",           "out"],
  ["c_other_out", "Other",                "out"],
  ["c_rentinc",   "Rental income",        "in"],
  ["c_draw",      "Business draw",        "in"],
  ["c_venmo",     "Venmo cashouts",       "in"],
  ["c_invest",    "From investments",     "in"],
  ["c_other_in",  "Other income",         "in"]
];

function classify(r) {
  const d = r.desc.toLowerCase();
  if (r.dir === "in") {
    if (/zelle cr alexis/.test(d))            return { cat: "c_rentinc", xfer: false };
    if (/transfer from checking/.test(d))     return { cat: "c_draw",    xfer: false };
    if (/venmo cashout/.test(d))              return { cat: "c_venmo",   xfer: false };
    if (/schwab|brokerage|moneylink/.test(d)) return { cat: "c_invest",  xfer: false };
    if (/transfer from shares|dividend|reward redemption/.test(d)) return { cat: "c_other_in", xfer: /transfer from shares/.test(d) };
    return { cat: "c_other_in", xfer: false };
  }
  if (/ashley belvin/.test(d))                          return { cat: "c_rent",     xfer: false };
  if (/idaho housing/.test(d))                          return { cat: "c_mortgage", xfer: false };
  if (/transfer to loan/.test(d))                       return { cat: "c_carloan",  xfer: false };
  if (/credit card|discover|chase credit|citi autopay/.test(d)) return { cat: "c_cards", xfer: /transfer to credit card/.test(d) };
  if (/food lion|wal.?mart|wm supercenter|harris teeter|food ?a|publix/.test(d)) return { cat: "c_grocery", xfer: false };
  if (/home depot|lowe|ace hardware/.test(d))           return { cat: "c_home",     xfer: false };
  if (/dominion energy|duke energy|water|electric|spectrum|verizon|at&t/.test(d)) return { cat: "c_utilities", xfer: false };
  if (/atm withdrawal/.test(d))                         return { cat: "c_cash",     xfer: false };
  /* moving money between his OWN accounts is not spending */
  if (/transfer to shares|transfer to checking/.test(d)) return { cat: "c_other_out", xfer: true };
  if (/pos debit/.test(d))                              return { cat: "c_spending", xfer: false };
  return { cat: "c_other_out", xfer: false };
}

const FILES = ["66a5524cd12a6c5ba69c6dc4","e15da58601a84869933cdf1d","8536554506749e9d2669c1be",
               "be11f943c5eb182536408041","b681150aaf7bfdacf1e39d7f","7b1451b80f7aa212efec59bb",
               "67ebc541ae898f6860421fe2"];

let rows = [];
FILES.forEach(f => {
  const parsed = JSON.parse(execFileSync("node", [path.join(__dirname, "stmt-parse.js"), "--json",
    path.join(__dirname, "uploads", f + ".pdf")], { encoding: "utf8", maxBuffer: 32e6 }))[0];
  rows = rows.concat(parsed.rows.filter(r => /Checking/i.test(r.account || "")));
});
rows.sort((a, b) => (a.date < b.date ? -1 : 1));

const store = JSON.parse(fs.readFileSync(FILE, "utf8"));
const slab = store[ORG];
slab.budgetCats = slab.budgetCats || [];
slab.budgetTx = slab.budgetTx || [];
const now = Date.now();

let newCats = 0;
CATS.forEach(([id, name, kind], i) => {
  if (slab.budgetCats.some(c => c && c.id === id)) return;
  slab.budgetCats.push({ id, name, kind, bookId: BOOK, order: i, rollover: kind === "out", target: 0, deleted: false, updatedAt: now });
  newCats++;
});

const txId = r => "nfcu-" + r.date + "-" + Math.round(r.amount * 100) + "-" +
  crypto.createHash("sha1").update(r.desc).digest("hex").slice(0, 8);

const existing = new Set(slab.budgetTx.map(t => t && t.id));
let added = 0, dupes = 0, xfers = 0;
const byCat = {};
rows.forEach(r => {
  const id = txId(r);
  if (existing.has(id)) { dupes++; return; }
  const c = classify(r);
  if (c.xfer) xfers++;
  byCat[c.cat] = (byCat[c.cat] || 0) + r.amount;
  slab.budgetTx.push({
    id, bookId: BOOK, accountId: ACCT, date: r.date,
    dir: r.dir, amount: Math.round(r.amount * 100) / 100,
    catId: c.cat, note: r.desc.slice(0, 140),
    isTransfer: !!c.xfer, source: "nfcu-stmt", deleted: false, updatedAt: now
  });
  existing.add(id); added++;
});

const m = n => "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
console.log("\nparsed rows (checking only): " + rows.length);
console.log("  new categories:  " + newCats);
console.log("  new transactions:" + added + (dupes ? "   (skipped " + dupes + " already imported)" : ""));
console.log("  flagged as internal transfers: " + xfers + " (excluded from totals by js/79)");
console.log("\n  by category:");
Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  const c = CATS.find(x => x[0] === k);
  console.log("    " + m(v).padStart(12) + "  " + (c ? c[1] : k));
});

if (!COMMIT) { console.log("\n[dry run] nothing written. re-run with --commit\n"); process.exit(0); }
const tmp = FILE + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(store));
fs.renameSync(tmp, FILE);
console.log("\n✅ written to data.json\n");
