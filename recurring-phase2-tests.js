/* RECURRING SERVICE — Phase 2 browser-context test (UI create path + lifecycle).
 * Runs inside the real app via:  node verify-app.js "$(cat recurring-phase2-tests.js)"
 * (all js/ modules loaded, window globals live — js/103 is a browser-only UI module, not node-requireable).
 *
 * Covers: recurPlanFromFields builds a plan → recurForceMaterialize generates the next ~weekly occurrences as
 * JOBS (planId set, deterministic recjob_ ids, all inside the 28-day horizon); a second pass makes NO dupes;
 * skip-next advances nextDue WITHOUT generating a job; pause STOPS generation; resume sets nextDue from TODAY
 * (no backfill) and resumes generation; end stops generation; and the rRecurring view renders the active plan
 * + its upcoming visits. Push to __errs to FAIL; diag() prints non-failing info. */

window.alert = function () {}; window.confirm = function () { return true; };

// ---- sign in an OWNER so the recurring tab + handlers are reachable ----
var ru = { id: "u_recur_test", username: "RecurTester", active: true };
S.users = S.users || []; S.users.push(ru);
if (typeof orgSetRole === "function") orgSetRole("u_recur_test", "obx", "owner");
localStorage.setItem("jra_session", "u_recur_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

function fail(m) { __errs.push("PHASE2: " + m); }
function assert(c, m) { if (!c) fail(m); }

var t = today();
var horizon = recurAddDays(t, 28);
var d = D();
d.customers = d.customers || [];
if (!d.customers.find(function (c) { return c.id === "c_recur"; })) d.customers.push({ id: "c_recur", name: "Recur Customer", notes: [], updatedAt: now() });
d.recurringPlans = d.recurringPlans || [];
d.jobs = d.jobs || [];

// ---- 1) BUILD A PLAN via the pure builder (same path recurSavePlan uses) + generate ----
var plan = recurPlanFromFields({
  customerId: "c_recur", title: "House-watch — weekly", price: 40, discountPct: 20,
  frequency: "weekly", weekday: new Date(t + "T12:00:00").getDay(), estDays: 1, startDate: t, endMode: "endless",
  autoQuote: false   // explicit jobs-only: this test asserts the pure JOB path (Phase 3 defaults autoQuote ON — covered by the engine test)
}, {});
assert(/^rp_/.test(plan.id), "plan id should be rp_* (got " + plan.id + ")");
assert(plan.autoQuote === false, "explicit autoQuote:false stays OFF (jobs-only)");
assert(plan.status === "active", "new plan should be active");
plan.nextDue = recurFirstOccurrence(plan, t);
d.recurringPlans.push(plan);

var gen1 = recurForceMaterialize();
assert(gen1 === true, "first materialize should report a change");
var jobsOf = function () { return D().jobs.filter(function (j) { return j && j.planId === plan.id && !j.deleted; }); };
var made = jobsOf();
diag("weekly occurrences generated in 28d horizon = " + made.length + " (dates " + made.map(function (j) { return j.date; }).sort().join(", ") + ")");
assert(made.length >= 4 && made.length <= 5, "weekly plan should generate ~4-5 occurrences in 28d (got " + made.length + ")");
made.forEach(function (j) {
  assert(j.id === "recjob_" + plan.id + "_" + j.date, "job id must be deterministic recjob_<plan>_<date> (got " + j.id + ")");
  assert(j.date >= t && j.date <= horizon, "occurrence " + j.date + " must be inside [" + t + ", " + horizon + "]");
  assert(j.done === false, "generated job starts not-done");
});
// deterministic id → no two jobs share a date
var dates = made.map(function (j) { return j.date; });
assert(new Set(dates).size === dates.length, "no duplicate occurrence dates");

// ---- 2) RE-RUN → NO DUPES (deterministic ids converge) ----
var countBefore = jobsOf().length;
recurForceMaterialize();
assert(jobsOf().length === countBefore, "re-running materialize must NOT create duplicate jobs (was " + countBefore + ", now " + jobsOf().length + ")");

// ---- 3) rRecurring VIEW renders the active plan + upcoming visits ----
TAB = "recurring"; window.JOB_OPEN = null;
var threw = null; try { render(); } catch (e) { threw = (e && (e.stack || e.message)) || String(e); }
var html = (document.getElementById("view") || {}).innerHTML || "";
assert(!threw, "rRecurring render threw: " + threw);
assert(html.replace(/\s+/g, "").length > 40, "rRecurring produced (near-)empty #view");
assert(html.indexOf("House-watch — weekly") >= 0, "active plan title should appear in the Recurring view");
assert(html.indexOf("New recurring plan") >= 0, "the '+ New recurring plan' button should render");
assert(html.indexOf("Upcoming visits") >= 0, "the Upcoming visits section should render");
diag("rRecurring rendered: len=" + html.length + " hasPlan=" + (html.indexOf("House-watch") >= 0) + " hasUpcoming=" + (html.indexOf("Upcoming visits") >= 0));

// ---- 4) SKIP NEXT advances nextDue by one step, generates NOTHING ----
var pre = recurPlanById(plan.id);
var dueBefore = pre.nextDue, jobsBeforeSkip = jobsOf().length;
window.recurSkipNext(plan.id);
var post = recurPlanById(plan.id);
assert(post.nextDue === recurAdvance(pre, dueBefore), "skip-next should advance nextDue exactly one cadence step (" + dueBefore + " -> " + post.nextDue + ")");
assert(jobsOf().length === jobsBeforeSkip, "skip-next must NOT generate a job");

// ---- 5) PAUSE stops generation ----
window.recurPause(plan.id);
assert(recurPlanById(plan.id).status === "paused", "pause should set status=paused");
var jobsBeforePausePass = jobsOf().length;
recurForceMaterialize();
assert(jobsOf().length === jobsBeforePausePass, "a paused plan must NOT generate new jobs");

// ---- 6) RESUME from today (no backfill) + resumes generation ----
window.recurResume(plan.id);
var res = recurPlanById(plan.id);
assert(res.status === "active", "resume should set status=active");
assert(res.nextDue >= t, "resume must set nextDue from TODAY forward (no backfill) — nextDue " + res.nextDue + " >= " + t);
assert(jobsOf().length >= 1, "resumed plan should still have its generated jobs");

// ---- 7) END stops generation ----
window.recurEnd(plan.id);
assert(recurPlanById(plan.id).status === "ended", "end should set status=ended");
var jobsBeforeEndPass = jobsOf().length;
recurForceMaterialize();
assert(jobsOf().length === jobsBeforeEndPass, "an ended plan must NOT generate new jobs");

// ---- 8) DELETE tombstones the plan but KEEPS the jobs ----
window.recurDeletePlan(plan.id);
assert(recurPlanById(plan.id) && recurPlanById(plan.id).deleted === true, "delete should tombstone the plan (deleted:true)");
assert(jobsOf().length === jobsBeforeEndPass, "deleting a plan must KEEP its already-generated jobs");

diag("Phase 2 test complete — errors so far: " + __errs.filter(function (e) { return /^PHASE2:/.test(e); }).length);
