/* declutter-tests.js — lists open on the rows (js/187). Pure node. */
const D = require("./js/187-declutter.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
eq(D.dclJobsActive({}), 0, "fresh screen: nothing on");
eq(D.dclJobsActive({ QSEARCH: "  ", QSTAGE_SET: {}, QHIDE_DONE: true }), 0, "blank search and default hide-finished do not count");
eq(D.dclJobsActive({ QSEARCH: "mike" }), 1, "a search counts");
eq(D.dclJobsActive({ QSTAGE_SET: { quote: true, paid: true, job: false } }), 2, "each active stage counts");
eq(D.dclJobsActive({ QCREW_FILTER: "u1", QDATE_FROM: "2026-09-01", QDATE_TO: "2026-09-30" }), 3, "crew and both dates count");
eq(D.dclJobsActive({ QHIDE_DONE: false }), 1, "showing finished is a change from the default, so it counts");
eq(D.dclJobsActive(null), 0, "null state is safe");
eq(D.dclRowToSelect(13, 1, true), true, "Finance's 13 chips fold on a phone");
eq(D.dclRowToSelect(13, 1, false), false, "…but not on desktop");
eq(D.dclRowToSelect(5, 1, true), false, "five chips stay as chips");
eq(D.dclRowToSelect(7, 2, true), false, "a multi-select row (two on) is never turned into a dropdown");
eq(D.dclRowToSelect(7, 0, true), false, "no active chip → leave it");
eq(D.dclRowToSelect(6, 1, true, 8), false, "custom minimum is respected");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
