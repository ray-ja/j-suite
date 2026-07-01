/* NO-DUPLICATE-OPEN-SHIFT INVARIANT — tonight's exact prod incident: one crew member ended up with 5
 * identical OPEN timeclock entries (no clockOut) for the same job, created 87ms apart, from rapid taps on
 * "Clock in".
 *
 * ROOT CAUSE shape (js/38-timeclock.js tcClockIn): the "you already have an open shift" guard runs
 * SYNCHRONOUSLY at the top, but the record is pushed only AFTER `await tcGetPos()`. Five rapid taps all pass
 * the guard (none has pushed yet), all await GPS, then all push — five open entries. A button-disable alone
 * doesn't help because queued taps already fired.
 *
 * INVARIANT under test: after a burst of rapid Clock-in taps for the same user+job, there is AT MOST ONE
 * non-deleted OPEN (clockOut == null) timeclock entry for that user. A concurrent agent may be landing a
 * busy-guard fix on tcClockIn; if it's landed here this PASSES, if not this FLAGS the still-open bug.
 *
 * Run inside the real app via verify-app.js:
 *     node verify-app.js "$(cat open-shift-invariant-tests.js)"
 * A pushed __errs line = the invariant is VIOLATED (bug exposed). diag() prints context. */

var TAPS = 6;

// native dialogs block/hang headless Chrome — stub them (a blocked alert() is also why a mobile PWA can look
// like it "did nothing", which is what drives the rapid re-taps this test is about)
window.alert = function () {}; window.confirm = function () { return true; };

// ---- signed-in driver + one job ----
var osUser = { id: "u_openshift_test", username: "OpenShiftTest", active: true };
S.users = S.users || [];
S.users.push(osUser);
if (typeof orgSetRole === "function") orgSetRole("u_openshift_test", "obx", "owner");
localStorage.setItem("jra_session", "u_openshift_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

var osJob = { id: "job_openshift_test", title: "Open-shift race job", date: today(), crew: ["u_openshift_test"], done: false, updatedAt: now() };
D().jobs = D().jobs || []; D().jobs.push(osJob);
D().timeclock = D().timeclock || [];

function openEntriesFor(userId, jobId) {
  return (D().timeclock || []).filter(function (e) {
    return e && !e.deleted && e.userId === userId && e.jobId === jobId && (e.clockOut == null);
  });
}

// ---- make GPS resolve fast + deterministically (no real geolocation in headless) ----
if (!navigator.geolocation) navigator.geolocation = {};
navigator.geolocation.getCurrentPosition = function (ok) {
  // resolve on a microtask-ish delay so the async await gap in tcClockIn is real (mirrors a live GPS wait
  // during which more taps land) — this is the window the prod race happened in.
  setTimeout(function () { ok({ coords: { latitude: 36.3, longitude: -75.8, accuracy: 5 } }); }, 5);
};

// ---- render the clock-in form so tc_job / tc_role exist, then select the job ----
TAB = "time";
if (typeof render === "function") render();
var jobSel = document.getElementById("tc_job");
if (!jobSel) {
  // fall back: synthesize the fields tcClockIn reads directly
  var wrap = document.createElement("div");
  wrap.innerHTML = '<select id="tc_job"><option value="' + osJob.id + '">job</option></select><input id="tc_role" value="none">';
  document.body.appendChild(wrap);
  jobSel = document.getElementById("tc_job");
} else {
  jobSel.value = osJob.id;
  var roleEl = document.getElementById("tc_role"); if (roleEl) roleEl.value = "none";   // no-vehicle shift = simplest path, no odometer/vehicle resolution
}
diag("clock-in form present=" + !!document.getElementById("tc_job") + " job selected=" + (jobSel && jobSel.value));

// ---- THE RAPID-TAP BURST: fire tcClockIn() TAPS times back-to-back (exactly what queued taps do) ----
var taps = 0;
for (var i = 0; i < TAPS; i++) {
  try { tcClockIn(); taps++; } catch (e) { diag("tap " + i + " threw: " + (e && e.message)); }
  // keep re-selecting the job in case an interim render() cleared the select
  var js = document.getElementById("tc_job"); if (js) js.value = osJob.id;
  var rl = document.getElementById("tc_role"); if (rl) rl.value = "none";
}

// ---- let every awaited GPS callback + push settle ----
await new Promise(function (resolve) { setTimeout(resolve, 400); });

var open = openEntriesFor("u_openshift_test", osJob.id);
diag("rapid taps=" + taps + " -> OPEN entries for this user+job = " + open.length + " (invariant: <=1)");
open.forEach(function (e, k) { diag("  open entry " + k + " id=" + e.id + " clockIn=" + e.clockIn); });

if (open.length > 1) {
  __errs.push("DUPLICATE OPEN SHIFT [tcClockIn -> js/38-timeclock.js]: " + taps + " rapid Clock-in taps left " + open.length + " simultaneous OPEN entries for one user+job (invariant is AT MOST 1). This is the '5 identical open entries 87ms apart' prod incident — the open-shift guard runs before the awaited GPS, so queued taps race past it.");
}

// ---- second angle: even AFTER one shift is open, a fresh tap must not open a second (guard on re-entry) ----
if (open.length >= 1) {
  var beforeSecond = openEntriesFor("u_openshift_test", osJob.id).length;
  var js2 = document.getElementById("tc_job"); if (js2) js2.value = osJob.id;
  var rl2 = document.getElementById("tc_role"); if (rl2) rl2.value = "none";
  tcClockIn();
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  var afterSecond = openEntriesFor("u_openshift_test", osJob.id).length;
  diag("single tap while already clocked in: open before=" + beforeSecond + " after=" + afterSecond);
  if (afterSecond > beforeSecond) __errs.push("DUPLICATE OPEN SHIFT [tcClockIn re-entry]: tapping Clock-in while ALREADY on the clock opened a SECOND open shift (open " + beforeSecond + " -> " + afterSecond + ")");
}
