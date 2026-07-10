/* logdrive-tests.js — 🚗 Log-a-drive (retroactive mileage) INVARIANTS.
 *
 * A logged drive MUST be an ordinary CONFIRMED mileage timeclock entry (clockOut set + milesConfirmed:true +
 * riderRole:"driver" + miles + vehicle + userId + jobId) so it flows through the EXISTING reimbursement
 * (finMileage) + per-job cost (jobMileageCost / jobMilesCostEst) with zero new math. This asserts:
 *   1) tcLogDrive() creates that entry → jobMileageCost(j) == miles × IRS 0.725, and the DRIVER shows up in
 *      the finMileage reimbursement roll-up.
 *   2) The job/receipts close-out summary now shows the mileage cost (jobMilesCostEst > 0, "🚗 mileage" in the
 *      close-out HTML) for a job with a logged drive and NO receipts — not "$0".
 *   3) Hours are NOT meaningfully inflated (the nominal span is a minute).
 *   4) Owner/admin gated — a crew member's tcLogDrive() is refused.
 *   5) The entry is editable/deletable via the existing punch editor (tcCanEditEntry true for owner; tcDelPunch
 *      soft-deletes it → jobMileageCost back to 0).
 *
 * Run inside the real app:  node verify-app.js "$(cat logdrive-tests.js)"
 * A pushed __errs line = a broken invariant. diag() prints context.
 */

window.alert = function () {}; window.confirm = function () { return true; };
function ldAssert(cond, msg) { if (!cond) __errs.push("LOGDRIVE: " + msg); }
function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.01 : tol); }

var RATE = 0.725;

// ---- owner + driver + crew members in org obx ----
S.users = S.users || [];
var owner  = { id: "u_ld_owner",  username: "LdOwner",  active: true };
var driver = { id: "u_ld_driver", username: "LdDriver", active: true };
var crew   = { id: "u_ld_crew",   username: "LdCrew",   active: true };
S.users.push(owner, driver, crew);
if (typeof orgSetRole === "function") { orgSetRole("u_ld_owner", "obx", "owner"); orgSetRole("u_ld_driver", "obx", "crew"); orgSetRole("u_ld_crew", "obx", "crew"); }
localStorage.setItem("jra_session", "u_ld_owner");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

// ---- a job like "Chaz & Vlad fly in": a route estimate, NO timeclock entries ----
var job = { id: "job_ld_airport", title: "Chaz & Vlad fly in (test)", date: today(), crew: [], done: false, estRouteMiles: 170, updatedAt: now() };
D().jobs = D().jobs || []; D().jobs.push(job);
D().timeclock = D().timeclock || [];

diag("isOwner (as owner) = " + (typeof isOwner === "function" && isOwner()));
diag("baseline jobMileageCost = " + jobMileageCost(job) + " · jobMilesCostEst = " + jobMilesCostEst(job) + " · clockedHrs = " + jobClockedHrs(job));
ldAssert(jobMileageCost(job) === 0, "baseline job should have $0 confirmed mileage (had " + jobMileageCost(job) + ")");
var hrsBefore = jobClockedHrs(job);

// ---- 1) tcLogDrive core creates a CONFIRMED driver mileage entry ----
var r = tcLogDrive(job.id, { userId: "u_ld_driver", vehicle: "owner:u_ld_driver", miles: 170, date: today() });
diag("tcLogDrive -> ok=" + (r && r.ok) + " err=" + (r && r.error));
ldAssert(r && r.ok, "tcLogDrive should succeed for the owner (got " + (r && r.error) + ")");
var e = r && r.entry;
ldAssert(e && e.clockOut != null, "entry must have clockOut set (confirmed/closed)");
ldAssert(e && e.milesConfirmed === true, "entry must be milesConfirmed:true");
ldAssert(e && e.riderRole === "driver", "entry riderRole must be 'driver'");
ldAssert(e && +e.miles === 170, "entry miles must be 170 (got " + (e && e.miles) + ")");
ldAssert(e && e.userId === "u_ld_driver", "entry userId must be the driver");
ldAssert(e && e.jobId === job.id, "entry jobId must be the job");
ldAssert(e && !!(e.vehicleId || e.vehicleOwnerId || e.vehicle), "entry must carry a vehicle");
ldAssert(e && e.source === "admin-logged", "entry provenance source must be 'admin-logged'");

// job cost picks it up at the IRS rate
diag("after log: jobMileageCost = " + jobMileageCost(job) + " (expect " + (170 * RATE) + ")");
ldAssert(approx(jobMileageCost(job), 170 * RATE), "jobMileageCost must be 170×0.725=" + (170 * RATE) + " (got " + jobMileageCost(job) + ")");
ldAssert(approx(jobMilesCostEst(job), 170 * RATE), "jobMilesCostEst must equal the confirmed mileage " + (170 * RATE) + " (got " + jobMilesCostEst(job) + ")");

// driver appears in the finMileage reimbursement roll-up
var mil = finMileage(D().timeclock, { confirmedOnly: true });
var driverCents = mil.perMember["u_ld_driver"] || 0;
diag("finMileage perMember[driver] cents = " + driverCents + " (expect " + Math.round(170 * RATE * 100) + ")");
ldAssert(driverCents === Math.round(170 * RATE * 100), "driver must be reimbursed 170×0.725 in the mileage roll-up (got " + driverCents + " cents)");

// ---- 2) close-out summary now shows mileage, not $0 ----
if (typeof RCPT_JOBFILTER !== "undefined") RCPT_JOBFILTER = "all";
var summaryHTML = (typeof rcptJobCloseoutHTML === "function") ? rcptJobCloseoutHTML() : "";
var shows = summaryHTML.indexOf("Chaz &amp; Vlad fly in (test)") >= 0 || summaryHTML.indexOf("Chaz & Vlad fly in (test)") >= 0;
var showsMileage = summaryHTML.indexOf("🚗 mileage") >= 0;
diag("close-out summary contains job=" + shows + " · contains '🚗 mileage'=" + showsMileage);
ldAssert(showsMileage, "the job close-out summary must surface the mileage cost ('🚗 mileage') for a drive with no receipts");
ldAssert(jobMilesCostEst(job) > 0, "the summary mileage value (jobMilesCostEst) must be > $0 for a logged drive");

// ---- 3) hours not meaningfully inflated ----
var hrsAfter = jobClockedHrs(job);
diag("clockedHrs before=" + hrsBefore + " after=" + hrsAfter + " (delta " + (hrsAfter - hrsBefore) + ")");
ldAssert((hrsAfter - hrsBefore) < 0.05, "a logged drive must not meaningfully inflate hours (delta " + (hrsAfter - hrsBefore) + "h)");

// ---- 5) editable/deletable via the existing punch editor (owner) ----
ldAssert(typeof tcCanEditEntry === "function" && tcCanEditEntry(e) === true, "owner must be able to edit/delete the logged entry (tcCanEditEntry)");

// ---- 4) owner/admin gated — a crew member is refused ----
localStorage.setItem("jra_session", "u_ld_crew");
diag("as crew: isOwner=" + (isOwner && isOwner()) + " canManageMembers=" + (typeof canManageMembers === "function" && canManageMembers()));
var rc = tcLogDrive(job.id, { userId: "u_ld_driver", vehicle: "owner:u_ld_driver", miles: 50, date: today() });
diag("tcLogDrive as crew -> ok=" + (rc && rc.ok) + " err=" + (rc && rc.error));
ldAssert(rc && rc.ok === false && rc.error === "not-allowed", "a crew member's tcLogDrive must be refused (not-allowed)");
localStorage.setItem("jra_session", "u_ld_owner");   // restore owner

// ---- 5b) delete it via the existing punch editor → cost back to 0 ----
tcDelPunch(e.id);
diag("after tcDelPunch: entry.deleted=" + e.deleted + " jobMileageCost=" + jobMileageCost(job));
ldAssert(e.deleted === true, "tcDelPunch must soft-delete the logged entry");
ldAssert(jobMileageCost(job) === 0, "after deleting the logged drive, jobMileageCost must return to $0 (got " + jobMileageCost(job) + ")");

diag("logdrive-tests complete — errs so far: " + __errs.length);
