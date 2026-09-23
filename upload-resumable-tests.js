/* upload-resumable-tests.js — chunk plan, resume math, backoff (js/190). Pure node. */
const U = require("./js/190-upload-resumable.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
const MB = 1024 * 1024;
eq(U.uprPlan(10 * MB + 1).length, 3, "10 MB + 1 byte is three 4 MB pieces");
eq(U.uprPlan(10 * MB + 1)[2], { n: 2, start: 8 * MB, end: 10 * MB + 1 }, "last piece ends exactly at the file size");
eq(U.uprPlan(100).length, 1, "a tiny file is one piece");
eq(U.uprPlan(0).length, 1, "zero bytes still plans one piece (the caller rejects empties)");
eq(U.uprPlan(1000, 100).length, 10, "custom chunk size");
eq(U.uprMissing(5, [0, 1, 3]), [2, 4], "missing pieces after a partial upload");
eq(U.uprMissing(3, []), [0, 1, 2], "nothing received → everything missing");
eq(U.uprMissing(3, [0, 1, 2]), [], "all received → nothing to send");
eq(U.uprMissing(3, ["1"]), [0, 2], "received indexes may arrive as strings");
eq(U.uprDelay(0), 800, "first retry waits 0.8 s");
eq(U.uprDelay(1) > U.uprDelay(0) && U.uprDelay(5) > U.uprDelay(1), true, "backoff grows");
eq(U.uprDelay(20), 15000, "backoff caps at 15 s");
eq(U.uprKey({ name: "a.pdf", size: 5, lastModified: 7 }), "jra_up_a.pdf|5|7", "resume key is the file fingerprint");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
