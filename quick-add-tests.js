/* quick-add-tests.js — the one "+" sheet (js/185). Pure node. */
const Q = require("./js/185-quick-add.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
const keys = rows => rows.map(r => r.key);
const all = () => true;
eq(keys(Q.quickAddPick(Q.QUICK_ADD_ROWS, all, all)), ["customer", "lead", "quote", "job", "todo", "receipt", "expense", "clockin"], "owner in a business org sees every row");
eq(keys(Q.quickAddPick(Q.QUICK_ADD_ROWS, t => ["accounts", "schedule", "todo", "receipts", "time"].indexOf(t) >= 0, all)), ["customer", "job", "todo", "receipt", "clockin"], "crew: no lead, quote or expense");
eq(keys(Q.quickAddPick(Q.QUICK_ADD_ROWS, t => t === "todo", all)), ["todo"], "personal org: to-do only");
eq(keys(Q.quickAddPick(Q.QUICK_ADD_ROWS, all, name => name !== "capQuickCapture" && name !== "rcptPickFiles")), ["customer", "lead", "quote", "job", "todo", "expense", "clockin"], "a row disappears when neither function exists");
eq(keys(Q.quickAddPick(Q.QUICK_ADD_ROWS, all, name => name !== "capQuickCapture")), ["customer", "lead", "quote", "job", "todo", "receipt", "expense", "clockin"], "the alt function keeps the receipt row alive");
eq(Q.quickAddPick(null, all, all), [], "no rows → empty");
eq(keys(Q.quickAddPick(Q.QUICK_ADD_ROWS, undefined, all)).length, 8, "no visibility check → everything");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
