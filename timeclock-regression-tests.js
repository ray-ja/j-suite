/* Timeclock regression tests (js/38-timeclock.js) — three real bugs Ray hit in the field today, all on
   mobile, all in the timeclock area.

   BUG 1 (CRITICAL) — a starting odometer reading typed mid-shift silently vanished.
   ROOT CAUSE: the header reminder banner (js/85-mileage-reminder.js) opens tcEnterStartOdo(), which used
   window.prompt()/alert() to collect + validate the reading. Native JS dialogs are unreliable/silently
   no-op in an INSTALLED (standalone/home-screen) PWA — exactly how this app is meant to run on a crew
   phone (js/34-pwa-install.js). The typed value never reliably reached the app, and the old code's
   `if (reading == null) return;` swallowed that failure with ZERO user-visible feedback — Ray thought he'd
   entered it; there was no error, no save, and by the time he noticed, the real reading was gone.
   FIX: tcEnterStartOdo now opens a real DOM modal (matching every other timeclock dialog in this file —
   clock-out, entry-edit, default-vehicle) with a plain <input>, read by tcSaveLateOdo the same way the
   rest of the app reads form fields. A DOM input works identically in the browser, the installed PWA, and
   headless tests — there is nothing left that can silently swallow the value.
   Also fixed here: the clock-in form's OWN odometer field could render hidden even though a vehicle WAS
   auto-selected (a first-time driver with no saved default) — tcRoleDetail's old `_hasVeh` check was
   computed from the (possibly empty) default value, not the vehicle the <select> actually force-selects.

   BUG 3 — the active-shift card crammed the job title + elapsed time so they were unreadable on a phone.
   ROOT CAUSE: the global `.sub` CSS class is single-line ellipsis (right for tight list rows) but was
   applied, un-overridden, to this card's fuller lines (name, job title + customer, the "Est ~X hr" line,
   the vehicle/odometer line) — while ONE line lower in the very same card already had the
   `white-space:normal` override, showing the fix pattern was known but inconsistently applied. The
   elapsed/miles pair also sat in one unconditional side-by-side flex row at every viewport width.
   FIX: every descriptive line in the active-shift card opts back into wrapping (white-space:normal); the
   elapsed/miles pair now uses a `.tc-metrics` class that STACKS full-width by default (mobile-first) and
   only goes side-by-side at >=480px (app.css).

   DUPLICATE CLOCK-IN (June 30 incident, confirmed in prod data.json) — rapid-tapping "Clock in" created 5
   identical OPEN shifts ~15-90ms apart, all for the same job. ROOT CAUSE: the only guard was
   `tcOpenShift(who.userId)`, a check-then-act race — it reads tcoll() SYNCHRONOUSLY, but the new entry isn't
   pushed until AFTER `await tcGetPos()` resolves, and a real phone's GPS fix can take anywhere from tens of ms
   to its full 12s timeout. Every tap landing before the FIRST call's fix resolved saw "no open shift yet" and
   independently created its own entry — there was ZERO re-entrancy protection during that async gap.
   FIX: same busy-flag + 20s watchdog + button disable/relabel pattern already used for the dupe-expense/
   dupe-material bug in js/61-job-page.js (_tcInBusy, checked synchronously before anything else runs).

   VEHICLE NOT ATTACHING (June 30 incident, same session — 6 duplicate entries all had riderRole:"driver",
   vehicleId:null, vehicleOwnerId:null, vehicle:"", despite a REAL odometer reading (58366.5) having been
   typed). ROOT CAUSE: tcClockIn() never validated that resolving the vehicle picker's value actually
   produced a vehicle — it trusted tcResolveVehicle(val("tc_vehicle"), ...) unconditionally. The picker
   (tcDriverVehicleOptions) is supposed to ALWAYS force-select a real option for the driver role, but its old
   implementation detected "did anything get selected" by string-searching the built HTML for the literal
   substring "selected" and could only fall back to "select the first option" if there WAS a first option —
   when an org has zero assignable vehicles (no company trucks AND no resolvable crew members), there is
   nothing to select at all and the <select> silently rendered with ZERO <option>s. Reading its value then
   returned "", and the code proceeded to save riderRole:"driver" with no vehicle whatsoever.
   FIX: tcDriverVehicleOptions rebuilt around an explicit options array + selected INDEX (no string-sniffing),
   returns "" when genuinely empty; tcRoleDetail shows a clear "no vehicles set up" warning instead of a dead
   <select>; tcClockIn now blocks (alert + no entry created) if the driver role ever resolves to no vehicle at
   all, rather than silently saving that combination.

   FEATURE — "Change job": the active shift is really ONE continuous work session (same truck, same trip)
   that sometimes needs re-attributing to a different job partway through. tcChangeJob() picks a different
   open job, then CLOSES the current segment exactly like a normal clock-out (reuses tcClockOut's odometer/
   GPS-estimate modal + the new shared tcFinalizeSegment() math — not duplicated) and immediately OPENS a new
   segment on the picked job, carrying over vehicle/trailer/rider-role (no re-pick) and anchoring the new
   segment's start-odometer to the old segment's real end-odometer (continuous driving, no gap).

   Runs inside the real app via verify-app.js, which now boots at a 390x844 (narrow-phone) viewport by
   default so mobile-only layout bugs are exercised on every run:
       node verify-app.js "$(cat timeclock-regression-tests.js)"
   Pushes to __errs to FAIL; diag() prints non-failing context lines. */

// ---- fixtures: a signed-in driver with exactly one (personal) vehicle available, a job, no company trucks ----
var driver = { id: "u_tc_test", username: "TcTest", active: true };
S.users = S.users || [];
S.users.push(driver);
if (typeof orgSetRole === "function") orgSetRole("u_tc_test", "obx", "owner");
S.biz = "obx";
localStorage.setItem("jra_session", "u_tc_test");
localStorage.setItem("jra_offline_ok", "1");   // signed-in + offline is a legitimate "connected" state (needLogin())

var job = { id: "j_tc_test", title: "Mulch delivery + cleanup — Smith Properties (Corolla)", customerId: null, date: today(), crew: ["u_tc_test"], done: false, updatedAt: now() };
D().jobs = D().jobs || [];
D().jobs.push(job);

// ===== BUG 1a — clock-in form: the odometer field must be visible whenever a vehicle IS selected =====
var detailHtml = tcRoleDetail("driver", "", "u_tc_test");   // "" = no saved default -> the auto-fallback case
var vehSelectHasSelection = /<option[^>]*selected/.test(detailHtml);
var odoWrapHidden = /id="tc_odo_wrap"[^>]*display:\s*none/.test(detailHtml);
diag("clock-in form: vehicle auto-selected=" + vehSelectHasSelection + " | odometer wrap hidden=" + odoWrapHidden);
if (vehSelectHasSelection && odoWrapHidden) __errs.push("BUG 1a regression: a vehicle is auto-selected on the clock-in form but the odometer field is hidden");
if (!/id="tc_odo_start"/.test(detailHtml)) __errs.push("BUG 1a regression: the clock-in odometer input is missing entirely");

// ===== BUG 1 — the late-entry odometer modal must actually persist the typed reading =====
var entry = {
  id: "tc_test_entry", jobId: job.id, userId: "u_tc_test", userName: "TcTest",
  clockIn: now() - 30 * 60000, clockOut: null,
  inLoc: null, outLoc: null, pings: [], stops: [],
  computedMiles: 1.2, miles: null, milesConfirmed: false, milesSource: null,
  odoStart: null, odoEnd: null,
  riderRole: "driver", trailerId: null, rodeWith: null,
  vehicleId: null, vehicle: "TcTest's vehicle", vehicleOwnerId: "u_tc_test", rate: 0.725, updatedAt: now()
};
D().timeclock = D().timeclock || [];
D().timeclock.push(entry);

if (!tcNeedsOdo(entry)) __errs.push("fixture setup broken: tcNeedsOdo() should be true before the late entry");

tcEnterStartOdo();   // must open a real DOM modal — there is no window.prompt() for headless Chrome to intercept
var modalOpen = overlay.classList.contains("show");
var inputEl = document.getElementById("tc_late_odo");
diag("late-odo modal open=" + modalOpen + " | input present=" + !!inputEl);
if (!modalOpen || !inputEl) __errs.push("BUG 1 regression: tcEnterStartOdo() did not open a real DOM modal (still relying on window.prompt()?)");

if (inputEl) {
  // simulate what a mobile numeric keypad actually does: set the value then fire a real 'input' event (the
  // same event an on-screen keyboard dispatches per keystroke), THEN tap Save — not a raw JS function call
  // with no UI in between.
  inputEl.value = "45231";
  inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  var saveBtn = document.querySelector('button[onclick*="tcSaveLateOdo"]');
  if (!saveBtn) { __errs.push("BUG 1 regression: no Save button wired to tcSaveLateOdo in the modal"); }
  else saveBtn.click();
}

var afterSave = D().timeclock.find(function (e) { return e.id === "tc_test_entry"; });
diag("odoStart after save=" + (afterSave && afterSave.odoStart) + " | odoStartReading=" + (afterSave && afterSave.odoStartReading));
if (!afterSave || afterSave.odoStart == null) __errs.push("BUG 1 regression: the odometer reading did NOT save (odoStart is still null after the modal Save tap)");
if (afterSave && afterSave.odoStartReading !== 45231) __errs.push("BUG 1 regression: odoStartReading !== the typed value (45231)");
if (afterSave && tcNeedsOdo(afterSave)) __errs.push("BUG 1 regression: tcNeedsOdo() is still true after the odometer was entered");
if (overlay.classList.contains("show")) diag("modal still open after save (non-fatal, but unexpected)");

// prove it's a REAL save (localStorage), not just an in-memory mutation — reload the store from scratch
var reloaded = JSON.parse(localStorage.getItem(KEY));
var reEntry = reloaded && reloaded.obx && (reloaded.obx.timeclock || []).find(function (e) { return e.id === "tc_test_entry"; });
diag("odoStart after a FRESH localStorage reload=" + (reEntry && reEntry.odoStart));
if (!reEntry || reEntry.odoStart == null) __errs.push("BUG 1 regression: the odometer did not survive a save + reload from localStorage");

// a subsequent re-render (nav away and back, e.g.) must not wipe it back to null
TAB = "time"; render();
var reRendered = D().timeclock.find(function (e) { return e.id === "tc_test_entry"; });
if (!reRendered || reRendered.odoStart == null) __errs.push("BUG 1 regression: the odometer was lost across a re-render");

// ===== BUG 3 — the active-shift card must stack the job title + elapsed time, not truncate/cram them, at
//       a narrow (mobile) viewport — verify-app.js now boots at 390px by default =====
var cardHtml = tcClockHTML();
if (!/tc-metrics/.test(cardHtml)) __errs.push("BUG 3 regression: active-shift card is missing the tc-metrics stacked layout");
if (!/On the clock/.test(cardHtml) || !/id="tc_elapsed"/.test(cardHtml)) __errs.push("BUG 3 regression: active-shift card did not render (job title / elapsed block missing)");

view.innerHTML = cardHtml;   // inject + measure the REAL computed layout at this harness's narrow viewport
diag("window.innerWidth=" + window.innerWidth);
var metricsEl = document.querySelector(".tc-metrics");
if (!metricsEl) {
  __errs.push("BUG 3 regression: .tc-metrics element not found in the rendered card");
} else {
  var cs = getComputedStyle(metricsEl);
  diag("tc-metrics computed flex-direction=" + cs.flexDirection);
  if (cs.flexDirection !== "column") __errs.push("BUG 3 regression: elapsed/miles are side-by-side (not stacked) at a narrow (" + window.innerWidth + "px) viewport");
  var kids = metricsEl.children;
  if (kids.length >= 2) {
    var w0 = kids[0].getBoundingClientRect().width, parentW = metricsEl.getBoundingClientRect().width;
    diag("elapsed block width=" + w0 + " vs container width=" + parentW);
    if (parentW > 0 && w0 < parentW * 0.9) __errs.push("BUG 3 regression: the elapsed block is not full-width on a narrow viewport (still crammed side-by-side)");
  }
}
var titleEl = document.querySelector(".card .nm");
if (titleEl) {
  var tcs = getComputedStyle(titleEl);
  diag("job title computed white-space=" + tcs.whiteSpace);
  if (tcs.whiteSpace === "nowrap") __errs.push("BUG 3 regression: the job title is forced single-line (nowrap) and will truncate on a narrow phone");
}
// the specific lines that used to be silently truncated (NOT the short "elapsed"/"pings" metric labels,
// which are one word and never lose information by staying single-line)
var contentLines = Array.prototype.filter.call(document.querySelectorAll(".card .sub"), function (el) {
  var t = (el.textContent || "").trim();
  return el.id !== "tc_pings" && t !== "" && t !== "elapsed";
});
var stillNowrap = contentLines.filter(function (el) { return getComputedStyle(el).whiteSpace === "nowrap"; });
diag("content .sub lines checked=" + contentLines.length + " | still forced nowrap=" + stillNowrap.length);
stillNowrap.forEach(function (el) { diag("  nowrap line text: " + (el.textContent || "").slice(0, 60)); });
if (stillNowrap.length) __errs.push("BUG 3 regression: a descriptive line in the active-shift card is still forced single-line (will cut off on a narrow phone)");

// ============================================================================================
// ===== DUPLICATE CLOCK-IN — 5 rapid taps must create exactly ONE open shift (June 30 incident) =====
// ============================================================================================
await (function () {
  var u = { id: "u_dupe_test", username: "DupeTest", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var job = { id: "j_dupe_test", title: "Dupe-tap test job", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(job);
  TAB = "time"; render();
  tcRoleChanged("driver");   // pick a real vehicle, like Ray had
  // mock a slow real-device GPS fix so the async gap tcClockIn awaits on is wide open — a real phone's
  // getCurrentPosition() can take anywhere from tens of ms to seconds, which is exactly the window the June 30
  // taps landed in (they were 15-90ms apart)
  var _origGetPos = tcGetPos;
  window.tcGetPos = function () { return new Promise(function (res) { setTimeout(function () { res(null); }, 120); }); };
  var calls = [];
  for (var i = 0; i < 5; i++) { calls.push(new Promise(function (resolve) { setTimeout(function () { tcClockIn().then(resolve); }, i * 20); })); }
  return Promise.all(calls).then(function () {
    window.tcGetPos = _origGetPos;
    var open = D().timeclock.filter(function (e) { return e.jobId === "j_dupe_test" && !e.clockOut; });
    diag("rapid-tap open entries created=" + open.length);
    if (open.length !== 1) __errs.push("DUPLICATE CLOCK-IN regression: 5 rapid taps created " + open.length + " open entries, expected exactly 1");
    // clean up so it doesn't collide with later sections' open-shift checks
    open.forEach(function (e) { e.deleted = true; });
    localStorage.removeItem("jra_session");
  });
})();

// ============================================================================================
// ===== VEHICLE NOT ATTACHING — a driver clock-in with a real vehicle available must ALWAYS
//       capture a real vehicleId/vehicleOwnerId; an org with zero vehicles must block, not
//       silently save "driver" with nothing attached (June 30 incident) =====
// ============================================================================================
await (async function () {
  // (b) normal case: a vehicle IS available -> must attach
  var u = { id: "u_veh_test", username: "VehTest", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var job = { id: "j_veh_test", title: "Vehicle-attach test job", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(job);
  TAB = "time"; render();
  tcRoleChanged("driver");
  var vehSel = document.getElementById("tc_vehicle");
  diag("veh-attach test: tc_vehicle value=" + (vehSel && vehSel.value));
  await tcClockIn();
  var e = D().timeclock.find(function (x) { return x.jobId === "j_veh_test"; });
  diag("veh-attach test: created entry vehicleId=" + (e && e.vehicleId) + " vehicleOwnerId=" + (e && e.vehicleOwnerId) + " vehicle=" + (e && e.vehicle));
  if (!e) __errs.push("VEHICLE NOT ATTACHING regression: clock-in as driver created no entry at all");
  else if (!e.vehicleId && !e.vehicleOwnerId && !e.vehicle) __errs.push("VEHICLE NOT ATTACHING regression: driver clock-in saved with NO vehicle attached even though a vehicle was available");
  if (e) { e.deleted = true; e.clockOut = e.clockOut || now(); }   // close it out so later sections don't see it as this user's open shift
  localStorage.removeItem("jra_session");

  // guard case: an org with ZERO vehicles (no company trucks, no crew members) must refuse to save
  // riderRole:"driver" with an empty vehicle, and must say so — not silently proceed
  var u2 = { id: "u_veh_none", username: "VehNone", active: true };
  S.users = [u2];   // the ONLY account -> personal-vehicle list is forced empty too
  if (typeof orgSetRole === "function") orgSetRole(u2.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u2.id); localStorage.setItem("jra_offline_ok", "1");
  var savedVehicles = ((S.registry || []).find(function (r) { return r && r.id === "obx"; }) || {}).vehicles;
  var reg = (S.registry || []).find(function (r) { return r && r.id === "obx"; });
  if (reg) reg.vehicles = [];
  var _origSchedMembers = window.schedMembers;
  window.schedMembers = function () { return []; };
  var job2 = { id: "j_veh_none", title: "No-vehicle-org test job", customerId: null, date: today(), crew: [u2.id], done: false, updatedAt: now() };
  D().jobs.push(job2);
  TAB = "time"; render();
  tcRoleChanged("driver");
  var detailHtml = (document.getElementById("tc_role_detail") || {}).innerHTML || "";
  diag("no-vehicle-org: warning shown=" + /No vehicles are set up/.test(detailHtml) + " | select present=" + !!document.getElementById("tc_vehicle"));
  if (!/No vehicles are set up/.test(detailHtml)) __errs.push("VEHICLE NOT ATTACHING regression: no clear warning shown when the org has zero assignable vehicles");
  var alertMsgs = [];
  var _origAlert = window.alert;
  window.alert = function (m) { alertMsgs.push(m); };
  await tcClockIn();
  window.alert = _origAlert;
  var e2 = D().timeclock.find(function (x) { return x.jobId === "j_veh_none"; });
  diag("no-vehicle-org: entry created=" + !!e2 + " | alerts=" + JSON.stringify(alertMsgs));
  if (e2) __errs.push("VEHICLE NOT ATTACHING regression: an entry was created despite zero vehicle options for the driver role");
  if (!alertMsgs.length) __errs.push("VEHICLE NOT ATTACHING regression: no blocking alert shown when clocking in as driver with zero vehicle options");
  window.schedMembers = _origSchedMembers;
  if (reg) reg.vehicles = savedVehicles;
  localStorage.removeItem("jra_session");
})();

// ============================================================================================
// ===== FEATURE — Change job: closes the old segment (real clockOut + computed miles), opens a new
//       one on the picked job carrying vehicle/trailer/role + odometer continuity =====
// ============================================================================================
await (async function () {
  var u = { id: "u_chg_test", username: "ChgTest", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var jobA = { id: "j_chg_a", title: "Change-job A", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  var jobB = { id: "j_chg_b", title: "Change-job B", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(jobA, jobB);
  TAB = "time"; render();
  tcRoleChanged("driver");
  var startOdoEl = document.getElementById("tc_odo_start");
  if (startOdoEl) { startOdoEl.value = "1000"; startOdoEl.dispatchEvent(new Event("input", { bubbles: true })); }
  await tcClockIn();
  var segA = D().timeclock.find(function (e) { return e.jobId === "j_chg_a" && !e.clockOut; });
  if (!segA) { __errs.push("Change Job regression: could not set up job A's open segment"); return; }
  diag("job A segment: vehicleId=" + segA.vehicleId + " riderRole=" + segA.riderRole + " odoStart=" + segA.odoStart);

  render();   // re-render so the active-shift card (with the Change job button) is current
  var cardHtml2 = tcClockHTML();
  if (!/Change job/.test(cardHtml2) || !/tcChangeJob\('/.test(cardHtml2)) __errs.push("Change Job regression: the Change job button is missing from the active-shift card");

  tcChangeJob(segA.id);   // opens the job picker modal
  var jobSel = document.getElementById("tc_changejob_sel");
  if (!jobSel) { __errs.push("Change Job regression: job picker did not render"); return; }
  jobSel.value = "j_chg_b";
  tcChangeJobPicked(segA.id);   // closes segA via the SAME odometer modal used by a normal clock-out
  var odoEndEl = document.getElementById("tc_odo_end");
  if (!odoEndEl) { __errs.push("Change Job regression: the odometer-end modal did not open (should reuse tcClockOut's modal)"); return; }
  odoEndEl.value = "1042"; odoEndEl.dispatchEvent(new Event("input", { bubbles: true }));
  var switchBtn = document.querySelector('button[onclick*="tcFinishChangeJob"]');
  if (!switchBtn) { __errs.push("Change Job regression: no Switch-job button wired to tcFinishChangeJob"); return; }
  switchBtn.click();

  var segAafter = D().timeclock.find(function (e) { return e.id === segA.id; });
  var segB = D().timeclock.find(function (e) { return e.jobId === "j_chg_b" && !e.clockOut; });
  diag("segA after change: clockOut=" + (segAafter && segAafter.clockOut) + " miles=" + (segAafter && segAafter.miles) + " milesSource=" + (segAafter && segAafter.milesSource));
  diag("segB after change: vehicleId=" + (segB && segB.vehicleId) + " riderRole=" + (segB && segB.riderRole) + " odoStart=" + (segB && segB.odoStart));

  if (!segAafter || segAafter.clockOut == null) __errs.push("Change Job regression: job A's segment was not closed (clockOut still null)");
  if (!segAafter || segAafter.miles == null || !(segAafter.miles > 0)) __errs.push("Change Job regression: job A's segment has no computed miles after Change Job (expected 42 mi from the odometer delta)");
  if (segAafter && segAafter.milesSource !== "odometer") __errs.push("Change Job regression: job A's closing miles should be sourced from the odometer, got " + (segAafter && segAafter.milesSource));
  if (!segB) { __errs.push("Change Job regression: no new open segment was created for job B"); }
  else {
    if (segB.clockOut != null) __errs.push("Change Job regression: job B's new segment should be OPEN");
    if (segB.vehicleId !== segA.vehicleId) __errs.push("Change Job regression: job B's segment vehicleId (" + segB.vehicleId + ") should match job A's (" + segA.vehicleId + ")");
    if (segB.riderRole !== "driver") __errs.push("Change Job regression: job B's segment should carry over riderRole=driver, got " + segB.riderRole);
    if (segAafter && segB.odoStart !== segAafter.odoEnd) __errs.push("Change Job regression: job B's start-odometer (" + segB.odoStart + ") should equal job A's end-odometer (" + (segAafter && segAafter.odoEnd) + ")");
  }
  localStorage.removeItem("jra_session");
})();
