/* Multi-job (0/1/N) attribution for dump runs / material pickups — Ray's 2026-06-30 ask, extending the
   EXISTING sub-job mechanism (job.parentJobId -> job.sharedJobIds[]). Run inside the real app via
   verify-app.js (the render fns + handlers are browser-defined):
       node verify-app.js "$(cat multijob-stops-smoke-tests.js)"

   Covers what a unit test can't: the REAL jobProfit()/subJobsOf()/plRows()/overheadStops() functions,
   AND the real jobOpenSplitPicker/jobSplitSubmit UI handlers against real DOM (the identical-behavior
   guarantee for the single-job-on-current-page case is a DOM/handler-level guarantee, not just data). */

// ---- sign in a test owner ----
var mjTestUser = { id: "u_mjstops_test", username: "MJStopsTest", active: true };
S.users = S.users || [];
S.users.push(mjTestUser);
if (typeof orgSetRole === "function") orgSetRole("u_mjstops_test", "obx", "owner");
localStorage.setItem("jra_session", "u_mjstops_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

var TODAY = (typeof today === "function") ? today() : "2026-06-30";

// ================= 1) N-way split: a $100 material cost linked to 2 jobs shows $50 attributed to each =================
var jobA = { id: "mj_jobA", title: "Job A", date: TODAY, crew: [], materials: [], expenses: [], deleted: false, updatedAt: now() };
var jobB = { id: "mj_jobB", title: "Job B", date: TODAY, crew: [], materials: [], expenses: [], deleted: false, updatedAt: now() };
D().jobs.push(jobA, jobB);
var stopAB = { id: "mj_stopAB", title: "Dump run", stopKind: "dump", date: TODAY, crew: ["u_mjstops_test"], sharedJobIds: ["mj_jobA", "mj_jobB"], materials: [{ id: "mj_m1", amount: 100, deleted: false }], expenses: [], deleted: false, updatedAt: now() };
D().jobs.push(stopAB);

var pA = jobProfit(jobA), pB = jobProfit(jobB);
diag("2-way split: jobA.matCost=" + pA.matCost + " jobB.matCost=" + pB.matCost);
if (pA.matCost !== 50) __errs.push("N-way split regression: jobA should be attributed $50 of the $100 stop (2-way split), got " + pA.matCost);
if (pB.matCost !== 50) __errs.push("N-way split regression: jobB should be attributed $50 of the $100 stop (2-way split), got " + pB.matCost);

var subsOfA = subJobsOf("mj_jobA"), subsOfB = subJobsOf("mj_jobB");
if (!subsOfA.some(function (x) { return x.id === "mj_stopAB"; })) __errs.push("subJobsOf('mj_jobA') should include the 2-linked stop-job (membership match)");
if (!subsOfB.some(function (x) { return x.id === "mj_stopAB"; })) __errs.push("subJobsOf('mj_jobB') should include the 2-linked stop-job (membership match)");

// ================= 2) 0-linked stop = general overhead: in overheadStops(), never in plRows() =================
var stopGeneric = { id: "mj_stopGeneric", title: "Dump run", stopKind: "dump", date: TODAY, crew: ["u_mjstops_test"], sharedJobIds: [], expenses: [{ id: "mj_e1", amount: 80, deleted: false }], materials: [], deleted: false, updatedAt: now() };
D().jobs.push(stopGeneric);

var oh = overheadStops();
if (!oh.some(function (x) { return x.id === "mj_stopGeneric"; })) __errs.push("overheadStops() should include the sharedJobIds=[] generic stop");
var rows = plRows();
if (rows.some(function (r) { return r.j.id === "mj_stopGeneric"; })) __errs.push("plRows() should NEVER show a sharedJobIds=[] generic stop as its own fake job row");
if (rows.some(function (r) { return r.j.id === "mj_stopAB"; })) __errs.push("plRows() should never show a linked stop-job (sharedJobIds=[...]) as its own row either — its cost already rolled up into jobA/jobB");
diag("overheadStops()=" + oh.length + " (expect >=1) · plRows() rows=" + rows.length + " none of which are stop-jobs");

// ================= 3) the logging UX: single-job-on-current-page path is byte-identical (zero new records) =================
var jobsBefore = D().jobs.length;
jobOpenSplitPicker("mj_jobA", "material");            // opens the real modal; default selection = just jobA (the page it was opened from)
document.getElementById("split_amt").value = "37.50";
document.getElementById("split_desc").value = "Test pass-through item";
document.getElementById("split_vendor").value = "Test Vendor";
jobSplitSubmit("material");
await new Promise(function (resolve) { setTimeout(resolve, 700); });   // let the (guarded) save + delayed close/render settle

var jobsAfterSingle = D().jobs.length;
diag("single-job path: jobs before=" + jobsBefore + " after=" + jobsAfterSingle);
if (jobsAfterSingle !== jobsBefore) __errs.push("IDENTICAL-BEHAVIOR regression: picking just the current job created " + (jobsAfterSingle - jobsBefore) + " new job record(s) — expected 0 (should write straight into jobA.materials[], same as the plain +Add material button)");
var jobAAfter = actJ().find(function (x) { return x.id === "mj_jobA"; });
var jobAMats = ((jobAAfter && jobAAfter.materials) || []).filter(function (m) { return m && !m.deleted; });
if (!jobAMats.some(function (m) { return m.amount === 37.5 && m.desc === "Test pass-through item"; })) __errs.push("single-job split path: the material didn't land in jobA.materials[] as expected");

// ================= 4) the logging UX: a DIFFERENT/multi job selection creates-or-reuses a stop-job =================
var jobsBefore2 = D().jobs.length;
jobOpenSplitPicker("mj_jobA", "expense");             // opened from jobA's page...
splitToggleJob("mj_jobA");                            // ...but deselect jobA...
splitToggleJob("mj_jobB");                            // ...and pick a DIFFERENT single job (jobB) instead
document.getElementById("split_cat").value = "pickup";
document.getElementById("split_amt").value = "22";
document.getElementById("split_desc").value = "Test different-job stop";
jobSplitSubmit("expense");
await new Promise(function (resolve) { setTimeout(resolve, 700); });

var jobsAfter2 = D().jobs.length;
diag("different-job path: jobs before=" + jobsBefore2 + " after=" + jobsAfter2);
if (jobsAfter2 !== jobsBefore2 + 1) __errs.push("create-or-reuse regression: picking a DIFFERENT single job (not the current page) should create exactly 1 new stop-job, saw a delta of " + (jobsAfter2 - jobsBefore2));
var newStop = actJ().find(function (x) { return Array.isArray(x.sharedJobIds) && x.sharedJobIds.length === 1 && x.sharedJobIds[0] === "mj_jobB" && x.stopKind === "pickup"; });
if (!newStop) __errs.push("create-or-reuse regression: expected a new stop-job with sharedJobIds=['mj_jobB'] and stopKind='pickup'");
else {
  var stopExp = (newStop.expenses || []).filter(function (e) { return e && !e.deleted; });
  if (!stopExp.some(function (e) { return e.amount === 22 && e.desc === "Test different-job stop"; })) __errs.push("create-or-reuse regression: the expense didn't land on the new stop-job's expenses[]");
  var jobADirect = actJ().find(function (x) { return x.id === "mj_jobA"; });
  if ((jobADirect.expenses || []).some(function (e) { return e && e.desc === "Test different-job stop"; })) __errs.push("create-or-reuse regression: the expense leaked into jobA (the page it was opened from) instead of the new stop-job");
}

diag("all multi-job-stops smoke checks ran (see any regressions above)");
