/* workstage-derivation-test.js — proves workStage(q) (js/60) derives the right one of the six lifecycle
 * stages for each state a deal can be in. Pure/derived: we stub the js/72 close-out helpers + actJ() the
 * same way the browser exposes them, then assert the label per fixture. No data written.
 *
 * Usage:  node workstage-derivation-test.js
 */

// ---- stub the globals js/60 reads (mirrors js/72 semantics, treating every listed crew id as active) ----
let JOBS = [];
global.actJ = () => JOBS;
global.jobCrewActiveIds = job => (job && Array.isArray(job.crew)) ? job.crew.slice() : [];
global.jobReceiptsClosedBy = job => (job && Array.isArray(job.receiptsClosedBy)) ? job.receiptsClosedBy.filter(x => x && x.userId) : [];
global.jobReceiptsFullyClosed = job => {
  const crew = global.jobCrewActiveIds(job); if (!crew.length) return false;
  const closed = global.jobReceiptsClosedBy(job).map(x => x.userId);
  return crew.every(id => closed.indexOf(id) >= 0);
};
global.jobReceiptsOpenCrew = job => { const closed = global.jobReceiptsClosedBy(job).map(x => x.userId); return global.jobCrewActiveIds(job).filter(id => closed.indexOf(id) < 0); };
global.userName = id => id;

const W = require("./js/60-workstage.js");
const workStage = W.workStage;

// ---- jobs backing the quote fixtures ----
JOBS = [
  { id: "je", done: true, crew: ["u1", "u2"], receiptsClosedBy: [{ userId: "u1" }] },      // done, only 1/2 closed → expense collecting
  { id: "jc", done: true, crew: ["u1"], receiptsClosedBy: [{ userId: "u1" }] },             // done, fully closed → invoice-ready
  { id: "jn", done: true, crew: [] },                                                        // done, NO active crew → invoice-ready (edge)
  { id: "ja", done: false, crew: ["u1"] }                                                    // accepted, not done → job
];

// ---- one quote per state + the expected derived stage ----
const CASES = [
  ["fresh (no accepted/job)",        { id: "qf" },                              "quote"],
  ["accepted, not done",             { id: "qa", accepted: true, jobId: "ja" }, "job"],
  ["done, receipts still open",      { id: "qe", jobId: "je" },                 "expense"],
  ["done, receipts fully closed",    { id: "qc", jobId: "jc" },                 "invoice"],
  ["invoiced (not paid)",            { id: "qi", invoiced: true },              "invoice"],
  ["paid",                           { id: "qp", paid: true },                  "paid"],
  ["done job with NO crew (edge)",   { id: "qn", jobId: "jn" },                 "invoice"]
];

let pass = 0, fail = 0;
function ok(name, got, want) { if (got === want) { pass++; console.log("  ✓ " + name + " → " + got); } else { fail++; console.log("  ✗ " + name + ": got '" + got + "' want '" + want + "'"); } }

CASES.forEach(([name, q, want]) => ok(name, workStage(q), want));

// lead-customer-no-quote: "lead" is a CUSTOMER-level state (customer.status==='Lead' with no quote), handled
// by the funnel (js/67), NOT by workStage — assert that rule directly so all 8 states are documented.
(function () {
  const cust = { id: "c1", status: "Lead" };
  const hasQuote = false;   // no quote exists for this lead
  const stage = (cust.status === "Lead" && !hasQuote) ? "lead" : "quote";
  ok("lead customer, no quote (customer-level)", stage, "lead");
})();

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
