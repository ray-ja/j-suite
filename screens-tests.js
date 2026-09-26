/* screens-tests.js — Phase 8 (js/198): reading-width tabs, redundant chip row, tail folding, toolbar pairing;
   plus the Work sidebar heads (js/155). Pure node. */
const S = require("./js/198-screens.js"); const N = require("./js/155-nav-deep.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
/* rule 1 */
eq(S.scNarrow("time"), true, "clock in is a form");
eq(S.scNarrow("data"), true, "settings is a stack of short cards");
eq(S.scNarrow("messages"), true, "the inbox is one list");
eq(S.scNarrow("receipts"), true, "receipts is one list");
eq(S.scNarrow("schedule"), false, "the calendar keeps the width");
eq(S.scNarrow("finance"), false, "the finance overview is three columns");
eq(S.scNarrow("accounts"), false, "customers is a grid");
eq(S.scNarrow("today"), false, "today is the dashboard");
eq(S.scNarrow(""), false, "nothing");
/* rule 2 */
const money = [{ plain: false, tab: "finance" }, { plain: false, tab: "finance" }, { plain: true, tab: "invoices" }, { plain: true, tab: "receipts" }, { plain: true, tab: "pay" }];
eq(S.scRowRedundant(money, "receipts"), true, "Receipts is a sidebar row → the chip row repeats it");
eq(S.scRowRedundant(money, "finance"), false, "Finance is covered by its sub-rows, not a plain row (js/03 handles that case)");
eq(S.scRowRedundant([{ plain: true, tab: "messages" }], "messages"), false, "a lone row is not a list; nothing to hide");
eq(S.scRowRedundant([], "x"), false, "empty");
/* rule 5 */
eq(S.scFoldTail([{ chars: 40 }, { chars: 200 }, { chars: 120 }], 220), 3, "three trailing paragraphs over the limit fold together");
eq(S.scFoldTail([{ chars: 40 }, { chars: 200 }, { chars: 120 }], 400), 0, "…and stay put under it");
eq(S.scFoldTail([{ chars: 300, control: false }, { chars: 10, control: true }, { chars: 250 }], 220), 1, "the fold stops at the first control");
eq(S.scFoldTail([{ chars: 300 }, { chars: 10, control: true }], 220), 0, "a control at the end means no fold");
eq(S.scFoldTail([], 220), 0, "empty");
/* rule 3 */
eq(S.scToolbarPair(["div", "search", "select", "div"]), 1, "search then sort → one toolbar");
eq(S.scToolbarPair(["search", "div", "select"]), -1, "not adjacent → leave alone");
eq(S.scToolbarPair(["select", "search"]), -1, "wrong order → leave alone");
eq(S.scToolbarPair([]), -1, "empty");
/* Work heads */
eq(N.NAV_PLAIN_HEADS["work/leads"], "Plan", "Leads starts the Plan head");
eq(N.NAV_PLAIN_HEADS["work/routes"], "+", "Route review joins Drive");
eq(N.NAV_PLAIN_HEADS["work/jobs"], "+", "Jobs joins Plan");
eq(N.NAV_DEEP.filter(d => d.tab === "schedule").every(d => d.join), true, "Calendar and My availability join Plan (a different tab would otherwise start a flat section)");
eq(N.NAV_DEEP.find(d => d.tab === "time" && d.sub === "clock").head, "Clock", "Clock starts its head");
eq(N.NAV_DEEP.find(d => d.tab === "route" && d.sub === "prospect").head, "Drive", "Prospecting route starts Drive");
eq(N.NAV_DEEP.filter(d => d.group === "work" && d.head).length, 2, "no other Work row starts a head (Calendar and My availability sit under Plan)");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
