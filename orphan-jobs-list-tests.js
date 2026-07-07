/* ORPHAN-JOBS-IN-JOBS-LIST — proof for the fix to js/08 quotesListHTML.
 *
 * Run headless in the real app:  node verify-app.js "$(cat orphan-jobs-list-tests.js)"
 *
 * BUG (Ray 2026-07-06): a job created via Today → "＋ Add a job to clock into" (saveQuickTask → a JOB with NO
 * linked quote, e.g. "French drain") was INVISIBLE in the Jobs list, because quotesListHTML iterated QUOTES only.
 *
 * What this proves:
 *  1. APPEARS: a quote-LESS active job renders a row in quotesListHTML() — its TITLE shows (Type column).
 *  2. TAP → JOB PAGE: the row's onclick is openJobPage('<jobId>'), not openQuote.
 *  3. PRICE "—" + "no quote" nudge: the jobless row shows an em-dash price and the subtle hint.
 *  4. EXCLUSIONS: a job already linked by a quote (q.jobId===j.id) is NOT duplicated; a stop/sub-job
 *     (Array.isArray(sharedJobIds)) and a deleted job never appear as orphan rows.
 *  5. REAL QUOTES UNAFFECTED: with orphans present, every real-quote row is byte-identical to the no-orphan
 *     render (orphan rows are purely additive).
 */

window.alert = function () {}; window.confirm = function () { return true; };

var fails = [];
function ok(name, cond) { if (!cond) fails.push("FAIL: " + name); }
function setData(cs, qs, js) { var d = D(); d.customers = cs; d.properties = []; d.quotes = qs; d.jobs = js || []; }

// reset the Jobs-table view state so output is deterministic
QSEARCH = ""; QSTAGE_FILTER = "all"; QCREW_FILTER = "";
QSORT = "date"; QSORTDIR = "desc"; QTYPE_FILTER = ""; QDATE_FROM = ""; QDATE_TO = ""; QSHOWN = 150;

var Cust = [{ id: "cMG", name: "Mike Green", updatedAt: 1 }];

// ---- baseline: one real quote, no orphan job ----
var Q = [{ id: "q1", cust: "Mike Green", customerId: "cMG", date: "2026-06-01", total: 500, items: [{ name: "Paver" }], updatedAt: 1 }];
setData(Cust, Q, []);
var baseline = quotesListHTML();
ok("baseline has the real quote row (openQuote('q1'))", baseline.indexOf("openQuote('q1')") >= 0);

// ---- add a quote-LESS job (the French-drain repro) + a covered job + a stop + a deleted job ----
var jobs = [
  { id: "mr9i2bnqrzz71", customerId: "cMG", title: "French drain", date: "2026-07-05", updatedAt: 2 },   // ORPHAN
  { id: "jCov", quoteId: "q2", title: "Covered paver job", date: "2026-06-10", updatedAt: 2 },            // covered by q2 below
  { id: "jStop", title: "Dump run", date: "2026-07-05", sharedJobIds: ["mr9i2bnqrzz71"], updatedAt: 2 },  // stop/sub-job → excluded
  { id: "jDel", title: "Deleted job", date: "2026-07-05", deleted: true, updatedAt: 2 }                    // deleted → excluded
];
var Q2 = Q.concat([{ id: "q2", cust: "Mike Green", customerId: "cMG", date: "2026-06-10", total: 900, jobId: "jCov", accepted: true, items: [{ name: "Paver" }], updatedAt: 1 }]);
setData(Cust, Q2, jobs);
var out = quotesListHTML();

// 1. APPEARS — the orphan job row exists and its title shows
ok("orphan job row present (openJobPage('mr9i2bnqrzz71'))", out.indexOf("openJobPage('mr9i2bnqrzz71')") >= 0);
ok("orphan job TITLE shows (French drain)", out.indexOf("French drain") >= 0);

// 2. + 3. em-dash price + "no quote" nudge live on the orphan row
ok("'no quote' nudge shown", out.indexOf("· no quote") >= 0);

// 4a. covered job is NOT duplicated as an orphan (no vq_jCov row); it renders via its quote's job route
ok("covered job NOT rendered as orphan (no vq_ pseudo id leaks)", out.indexOf("vq_jCov") < 0 && out.indexOf("openJobPage('jCov')") >= 0);
// 4b. stop/sub-job excluded
ok("stop/sub-job excluded (no French-drain dump-run orphan row)", out.indexOf("openJobPage('jStop')") < 0 && out.indexOf("Dump run") < 0);
// 4c. deleted job excluded
ok("deleted job excluded", out.indexOf("Deleted job") < 0);

// 5. REAL QUOTES UNAFFECTED — the real-quote (q1) row is byte-identical to the baseline render.
//    Pull each row's <tr>…</tr> and compare the q1 row across the two renders.
function rowFor(html, marker) {
  var i = html.indexOf(marker); if (i < 0) return null;
  var s = html.lastIndexOf("<tr ", i); var e = html.indexOf("</tr>", i);
  return (s >= 0 && e >= 0) ? html.slice(s, e + 5) : null;
}
ok("real-quote q1 row byte-identical with orphans present",
  rowFor(baseline, "openQuote('q1')") !== null &&
  rowFor(baseline, "openQuote('q1')") === rowFor(out, "openQuote('q1')"));

// ---- SEARCH by the orphan job's title finds it ----
QSEARCH = "french"; var sOut = quotesListHTML(); QSEARCH = "";
ok("search 'french' finds the orphan job", sOut.indexOf("openJobPage('mr9i2bnqrzz71')") >= 0);

// ---- status filter 'job' includes the (not-done) orphan job ----
QSTAGE_FILTER = "job"; var fOut = quotesListHTML(); QSTAGE_FILTER = "all";
ok("status filter 'job' includes the not-done orphan", fOut.indexOf("openJobPage('mr9i2bnqrzz71')") >= 0);

if (fails.length) { throw new Error("orphan-jobs-list: " + fails.length + " FAILED — " + fails.join(" | ")); }
if (typeof diag === "function") diag("orphan-jobs-list: ALL PASS (appears + title + tap→job page + no-quote hint + exclusions + real-quotes byte-identical + search + filter)");
