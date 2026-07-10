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

// ============================================================================================
// ===== VEHICLE UNIFICATION — an inventory vehicle flows into clock-in; mileage reimburses the right
//       person (personal → OWNER, company truck → DRIVER); the "＋ Add my vehicle" inline flow writes a
//       real inventory record; the legacy migration is idempotent; aspirational seed rows never pollute
//       the picker. The mileage math (finMileage, keyed vehicleOwnerId || userId) is UNCHANGED. =====
// ============================================================================================

// ---- (2) a COMPANY truck (vehicleOwnerId null) still reimburses the DRIVER (finMileage falls back to userId),
//          and mileage NEVER keys on vehicleId — proves the invariant is untouched by the inv: additions ----
(function () {
  if (typeof finMileage !== "function") { __errs.push("VEHICLE UNIFICATION regression: finMileage global not available"); return; }
  var e = { id: "tc_truck_mi", jobId: "x", userId: "driverX", clockIn: 1, clockOut: 2, miles: 30, milesConfirmed: true, vehicleId: "veh_obx_f150", vehicleOwnerId: null, rate: 0.725 };
  var mil = finMileage([e], { confirmedOnly: true });
  diag("finMileage company truck: perMember=" + JSON.stringify(mil.perMember));
  if (!(mil.perMember["driverX"] > 0)) __errs.push("VEHICLE UNIFICATION regression: a company truck (vehicleOwnerId null) must reimburse the DRIVER (userId)");
  if (mil.perMember["veh_obx_f150"] != null) __errs.push("VEHICLE UNIFICATION regression: mileage must NOT key on vehicleId");
})();

await (async function () {
  var u = { id: "u_inv_veh", username: "InvVeh", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  D().inventory = D().inventory || [];

  // ---- (5) aspirational INV_SEED vehicle rows (no clockIn flag) must NOT be clockable ----
  var clockableHasAspirational = tcClockableVehicles().some(function (v) { return v && v.id === "inv-pickup-truck"; });
  diag("aspirational inv-pickup-truck in tcClockableVehicles=" + clockableHasAspirational);
  if (clockableHasAspirational) __errs.push("VEHICLE UNIFICATION regression: an aspirational inventory row (inv-pickup-truck, no clockIn flag) leaked into tcClockableVehicles()");

  // ---- (1) a PERSONAL inventory vehicle resolves to vehicleOwnerId = its owner (reimburses the OWNER) ----
  var pv = { id: "inv-veh-test-personal", name: "InvVeh's Subaru", cat: "vehicle", personal: true, ownerId: u.id, clockIn: true, active: true, have: true, plate: "OBX-1", updatedAt: now() };
  D().inventory.push(pv);
  if (!tcClockableVehicles().some(function (v) { return v.id === pv.id; })) __errs.push("VEHICLE UNIFICATION regression: a clockIn inventory vehicle is missing from tcClockableVehicles()");
  var resolved = tcResolveVehicle("inv:" + pv.id, u.id);
  diag("resolve inv personal: vehicleOwnerId=" + resolved.vehicleOwnerId + " vehicleId=" + resolved.vehicleId + " invVehicleId=" + resolved.invVehicleId);
  if (resolved.vehicleOwnerId !== u.id) __errs.push("VEHICLE UNIFICATION regression: inv: personal vehicle must resolve vehicleOwnerId=owner (reimburses owner), got " + resolved.vehicleOwnerId);
  if (resolved.vehicleId !== null) __errs.push("VEHICLE UNIFICATION regression: inv: personal vehicle must have vehicleId=null (not a registry truck)");
  if (resolved.invVehicleId !== pv.id) __errs.push("VEHICLE UNIFICATION regression: inv: resolve must set invVehicleId provenance");

  // clock in as driver on the inventory personal vehicle → odometer/GPS flow active + reimburses the OWNER
  var jobIV = { id: "j_inv_veh", title: "Airport pickup — personal car", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(jobIV);
  TAB = "time"; render();
  tcRoleChanged("driver");
  var sel = document.getElementById("tc_vehicle"); if (sel) sel.value = "inv:" + pv.id;
  var jsel = document.getElementById("tc_job"); if (jsel) jsel.value = "j_inv_veh";
  await tcClockIn();
  var eIV = D().timeclock.find(function (e) { return e.jobId === "j_inv_veh" && !e.clockOut; });
  diag("inv-veh clock-in: vehicleOwnerId=" + (eIV && eIV.vehicleOwnerId) + " invVehicleId=" + (eIV && eIV.invVehicleId) + " hasVehicle=" + (eIV && tcEntryHasVehicle(eIV)));
  if (!eIV) __errs.push("VEHICLE UNIFICATION regression: clock-in on an inventory personal vehicle created no entry");
  else {
    if (eIV.vehicleOwnerId !== u.id) __errs.push("VEHICLE UNIFICATION regression: clocked-in entry vehicleOwnerId should be the vehicle owner, got " + eIV.vehicleOwnerId);
    if (eIV.vehicleId !== null) __errs.push("VEHICLE UNIFICATION regression: an inv: personal shift must have vehicleId=null");
    if (eIV.invVehicleId !== pv.id) __errs.push("VEHICLE UNIFICATION regression: clocked-in entry should carry invVehicleId");
    if (!tcEntryHasVehicle(eIV)) __errs.push("VEHICLE UNIFICATION regression: an inv: driver shift must count as having a vehicle (odometer/GPS flow)");
    eIV.clockOut = eIV.clockIn + 3600000; eIV.miles = 20; eIV.milesConfirmed = true; touch(eIV);
    var mil2 = finMileage([eIV], { confirmedOnly: true });
    diag("finMileage inv personal: perMember=" + JSON.stringify(mil2.perMember));
    if (!(mil2.perMember[u.id] > 0)) __errs.push("VEHICLE UNIFICATION regression: personal inventory vehicle mileage must reimburse the OWNER (vehicleOwnerId)");
    eIV.deleted = true;
  }
  localStorage.removeItem("jra_session");
})();

// ---- (3) a crew member can ADD a clock-in vehicle inline (tcAddMyVehicle → tcSaveMyVehicle inventory write) ----
await (async function () {
  var u = { id: "u_add_veh", username: "Chase", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "crew");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var before = (D().inventory || []).length;
  tcAddMyVehicle(false);
  var nameEl = document.getElementById("tc_mv_name");
  if (!nameEl) { __errs.push("VEHICLE UNIFICATION regression: Add-my-vehicle modal did not open"); }
  else {
    nameEl.value = "Chase's Silverado"; nameEl.dispatchEvent(new Event("input", { bubbles: true }));
    var plateEl = document.getElementById("tc_mv_plate"); if (plateEl) { plateEl.value = "NC-777"; plateEl.dispatchEvent(new Event("input", { bubbles: true })); }
    var saveBtn = document.querySelector('button[onclick*="tcSaveMyVehicle"]');
    if (!saveBtn) __errs.push("VEHICLE UNIFICATION regression: no Save button wired to tcSaveMyVehicle");
    else saveBtn.click();
  }
  var mine = (D().inventory || []).filter(function (i) { return i.cat === "vehicle" && i.personal && i.ownerId === u.id && i.clockIn && i.name === "Chase's Silverado"; });
  diag("add-my-vehicle: inventory " + before + "->" + (D().inventory || []).length + " | mine=" + mine.length);
  if (!mine.length) __errs.push("VEHICLE UNIFICATION regression: tcSaveMyVehicle did not create a personal clock-in inventory vehicle owned by the member");
  else if (!tcClockableVehicles().some(function (v) { return v.id === mine[0].id; })) __errs.push("VEHICLE UNIFICATION regression: a just-added personal vehicle is not clockable");
  var reloaded = JSON.parse(localStorage.getItem(KEY));
  var reInv = reloaded && reloaded.obx && (reloaded.obx.inventory || []).some(function (i) { return i.name === "Chase's Silverado" && i.ownerId === u.id; });
  if (!reInv) __errs.push("VEHICLE UNIFICATION regression: the added vehicle did not persist to localStorage");
  localStorage.removeItem("jra_session");
})();

// ---- (4) the legacy migration (seedClockInVehicles) is idempotent — a double run makes NO duplicate rows ----
(function () {
  if (typeof seedClockInVehicles !== "function") { __errs.push("VEHICLE UNIFICATION regression: seedClockInVehicles not defined"); return; }
  S.biz = "obx";
  seedClockInVehicles();
  var members = (typeof schedMembers === "function") ? schedMembers() : [];
  var stableIds = members.map(function (m) { return "inv-veh-personal-" + m.id; });
  var count1 = (D().inventory || []).filter(function (i) { return stableIds.indexOf(i.id) >= 0; }).length;
  seedClockInVehicles();   // run again — must dedupe on the stable id
  var count2 = (D().inventory || []).filter(function (i) { return stableIds.indexOf(i.id) >= 0; }).length;
  var seen = {}, dup = false;
  (D().inventory || []).forEach(function (i) { if (i && i.id && i.id.indexOf("inv-veh-personal-") === 0) { if (seen[i.id]) dup = true; seen[i.id] = 1; } });
  diag("seedClockInVehicles idempotency: members=" + members.length + " seeded1=" + count1 + " seeded2=" + count2 + " anyDup=" + dup);
  if (members.length && count1 === 0) __errs.push("VEHICLE UNIFICATION regression: seedClockInVehicles seeded nothing for active members");
  if (count2 !== count1) __errs.push("VEHICLE UNIFICATION regression: seedClockInVehicles is NOT idempotent (row count changed " + count1 + " -> " + count2 + ")");
  if (dup) __errs.push("VEHICLE UNIFICATION regression: duplicate inv-veh-personal-* rows after a double seed run");
})();

// ============================================================================================
// ===== SUGGESTED CLOCK-OUT (home GPS) — when a shift's own GPS pings show the phone got back home a
//       while ago (the forgot-to-clock-out case), the clock-out modal recommends that time; using it sets
//       clockOut to the home-arrival ts (so hours = arrival − clockIn) + clockOutSource:"home-gps". No home
//       location OR no home-matching ping → NO suggestion, and the normal clock-out still works. Miles/odometer/
//       verify are unchanged; hours stay clockOut−clockIn (role-independent for passenger vs driver). =====
// ============================================================================================

// (a) a home-arrival ping → suggestion detected + using it re-times the clock-out (no vehicle shift)
await (async function () {
  var u = { id: "u_home_test", username: "HomeTest", active: true, homeLocation: { lat: 36.10, lng: -75.72, label: "Home" } };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var jobH = { id: "j_home", title: "Home-suggest job", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(jobH);
  var cin = now() - 5 * 3600000;          // clocked in 5h ago (from home, when leaving)
  var homeArr = now() - 90 * 60000;       // phone back home 90 min ago (forgot to clock out)
  var e = {
    id: "tc_home_entry", jobId: "j_home", userId: u.id, userName: "HomeTest",
    clockIn: cin, clockOut: null,
    inLoc: { lat: 36.10, lng: -75.72, ts: cin, dev: "mobile" },          // at home at clock-in (must be ignored)
    outLoc: null,
    pings: [
      { lat: 36.20, lng: -75.80, ts: cin + 30 * 60000, dev: "mobile" },  // at the job site (left home)
      { lat: 36.20, lng: -75.80, ts: cin + 120 * 60000, dev: "mobile" }, // still on the job
      { lat: 36.10, lng: -75.72, ts: homeArr, dev: "mobile" }            // back home
    ],
    stops: [], computedMiles: 0, miles: null, milesConfirmed: false, milesSource: null,
    odoStart: null, odoEnd: null, riderRole: "none", trailerId: null, rodeWith: null,
    vehicleId: null, vehicle: "", vehicleOwnerId: null, rate: 0.725, updatedAt: now()
  };
  D().timeclock.push(e);
  var arr = tcHomeArrival(e, tcUserHome(u.id));
  diag("home arrival detected=" + arr + " expected=" + homeArr);
  if (arr !== homeArr) __errs.push("SUGGESTED CLOCK-OUT regression: home arrival must be the FIRST home-match AFTER leaving (ignoring the at-home clock-in), got " + arr);
  tcClockOut("tc_home_entry");   // real clock-out modal → should carry the recommendation
  var recBtn = document.querySelector('button[onclick*="tcHomeClockOut"]');
  diag("recommendation button present=" + !!recBtn);
  if (!recBtn) __errs.push("SUGGESTED CLOCK-OUT regression: the recommended-clock-out button did not render in the modal");
  tcHomeClockOut("tc_home_entry", homeArr);   // pick the recommended time
  var after = D().timeclock.find(function (x) { return x.id === "tc_home_entry"; });
  diag("after home clockout: clockOut=" + (after && after.clockOut) + " source=" + (after && after.clockOutSource) + " hours=" + (after && tcHours(after)));
  if (!after || after.clockOut !== homeArr) __errs.push("SUGGESTED CLOCK-OUT regression: using the recommendation must set clockOut to the home-arrival ts");
  if (after && after.clockOutSource !== "home-gps") __errs.push("SUGGESTED CLOCK-OUT regression: clockOutSource should be 'home-gps'");
  var expHrs = (homeArr - cin) / 3600000;
  if (after && Math.abs(tcHours(after) - expHrs) > 0.001) __errs.push("SUGGESTED CLOCK-OUT regression: hours must equal arrival − clockIn (" + expHrs + "), got " + tcHours(after));
  localStorage.removeItem("jra_session");
})();

// (b) no home location AND no home ping → NO suggestion; the normal clock-out still closes the shift
await (async function () {
  var u = { id: "u_nohome_test", username: "NoHome", active: true };   // no homeLocation
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var job = { id: "j_nohome", title: "No-home job", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(job);
  var cin = now() - 2 * 3600000;
  var e = {
    id: "tc_nohome_entry", jobId: "j_nohome", userId: u.id, userName: "NoHome",
    clockIn: cin, clockOut: null, inLoc: null, outLoc: null,
    pings: [{ lat: 36.20, lng: -75.80, ts: cin + 60 * 60000, dev: "mobile" }],   // only a job-site ping, never home
    stops: [], computedMiles: 0, miles: null, milesConfirmed: false, milesSource: null,
    odoStart: null, odoEnd: null, riderRole: "none", trailerId: null, rodeWith: null,
    vehicleId: null, vehicle: "", vehicleOwnerId: null, rate: 0.725, updatedAt: now()
  };
  D().timeclock.push(e);
  if (tcUserHome(u.id) !== null) __errs.push("SUGGESTED CLOCK-OUT regression: a user with no homeLocation must return null from tcUserHome");
  tcClockOut("tc_nohome_entry");
  if (document.querySelector('button[onclick*="tcHomeClockOut"]')) __errs.push("SUGGESTED CLOCK-OUT regression: no suggestion may show when the user has no home location");
  var finishBtn = document.querySelector('button[onclick*="tcFinishClockOut"]');
  if (!finishBtn) __errs.push("SUGGESTED CLOCK-OUT regression: the normal clock-out button is missing for a no-home no-vehicle shift");
  else finishBtn.click();
  var after = D().timeclock.find(function (x) { return x.id === "tc_nohome_entry"; });
  diag("no-home clockout: clockOut=" + (after && after.clockOut) + " source=" + (after && after.clockOutSource));
  if (!after || after.clockOut == null) __errs.push("SUGGESTED CLOCK-OUT regression: the normal clock-out must still close the shift");
  if (after && after.clockOutSource) __errs.push("SUGGESTED CLOCK-OUT regression: a normal clock-out must NOT set clockOutSource=home-gps");
  localStorage.removeItem("jra_session");
})();

// (c) home set but the phone never recorded LEAVING home (backgrounded whole drive) → no arrival, no suggestion
(function () {
  var home = { lat: 36.10, lng: -75.72, label: "Home" };
  var e = { id: "x_bg", clockIn: now() - 3600000, inLoc: { lat: 36.10, lng: -75.72, ts: now() - 3600000 }, pings: [], stops: [] };
  if (tcHomeArrival(e, home) !== null) __errs.push("SUGGESTED CLOCK-OUT regression: arrival must be null when the phone never recorded leaving home (backgrounded)");
  if (tcHomeArrival(e, null) !== null) __errs.push("SUGGESTED CLOCK-OUT regression: arrival must be null when no home location is set");
})();

// (d) hours stay role-INDEPENDENT (passenger vs driver) and are exactly clockOut − clockIn, unaffected by any suggestion
(function () {
  var cin = now() - 4 * 3600000, cout = now() - 1 * 3600000;
  var driver = { clockIn: cin, clockOut: cout, riderRole: "driver" };
  var passenger = { clockIn: cin, clockOut: cout, riderRole: "passenger" };
  diag("role-independent hours: driver=" + tcHours(driver) + " passenger=" + tcHours(passenger));
  if (tcHours(driver) !== tcHours(passenger)) __errs.push("SUGGESTED CLOCK-OUT regression: driver/passenger hours must be role-independent");
  if (Math.abs(tcHours(driver) - (cout - cin) / 3600000) > 0.0001) __errs.push("SUGGESTED CLOCK-OUT regression: hours must be clockOut − clockIn");
})();

/* =====================================================================================================
   CLUSTER A — CLOCK-IN & JOB-TIME REDESIGN (2026-07-05). New coverage for the shared clock-in picker on the
   job page, clock-in → work-day auto-add, manual time-only punches (zero mileage), the work-days⇄punches
   coherence rules, and jobHourly deriving from clocked time. All additive — the billed mileage never moves.
   ===================================================================================================== */

// make GPS resolve fast + deterministically (no real geolocation in headless — mirrors open-shift-invariant-tests)
if (!navigator.geolocation) navigator.geolocation = {};
navigator.geolocation.getCurrentPosition = function (ok) { try { ok({ coords: { latitude: 36.1, longitude: -75.7, accuracy: 10 } }); } catch (e) {} };
// native alert()/confirm() BLOCK a headless dump — stub them (we exercise the guard PATHS, not the dialogs)
window.alert = function () {}; window.confirm = function () { return true; };

// (A1) job-page SHARED clock-in picker attaches the vehicle (driver → vehicleId/owner set, NOT blocked). This is
// the fix for the OLD free-text vehicle input that resolved empty and blocked the driver clock-in.
await (async function () {
  var u = { id: "u_ca_driver", username: "CaDriver", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var j = { id: "j_ca1", title: "Paver install — CA1", customerId: null, date: today(), crew: [u.id], done: false, estRouteMiles: 12.4, updatedAt: now() };
  D().jobs.push(j);
  var form = tcClockInFormHTML(j.id);
  if (!/id="tc_job"[^>]*value="j_ca1"/.test(form)) __errs.push("CA1: shared clock-in form did not pin the job (hidden tc_job) when pre-scoped");
  if (/id="tc_vehicle"[^>]*\blist=/.test(form) || /pick a truck — or type your own car/.test(form)) __errs.push("CA1: job page still renders the OLD free-text vehicle input");
  view.innerHTML = form;   // put the job-scoped form in the DOM, like the real job page does
  if (!document.getElementById("tc_job")) __errs.push("CA1: shared form missing hidden tc_job in the DOM");
  tcRoleChanged("driver");   // force the driver role → the grouped vehicle <select> appears
  var vehSel = document.getElementById("tc_vehicle");
  if (!vehSel) { __errs.push("CA1: driver role did not render the grouped vehicle <select>"); return; }
  if (!vehSel.value) __errs.push("CA1: the vehicle <select> force-selected nothing (would block the driver clock-in)");
  if (!/Est\. route/.test(view.innerHTML)) __errs.push("CA1: the informational route estimate is not shown in the driver vehicle box");
  await tcClockIn();
  var e = (D().timeclock || []).find(function (x) { return x.jobId === "j_ca1" && !x.deleted; });
  if (!e) __errs.push("CA1: driver clock-in created NO entry (blocked?) — the shared-picker regression is back");
  else {
    if (e.riderRole !== "driver") __errs.push("CA1: entry riderRole should be driver");
    if (!(e.vehicleId || e.vehicleOwnerId || e.vehicle)) __errs.push("CA1: driver entry saved with NO vehicle attached (the old broken-input bug)");
  }
  diag("CA1 clock-in: entry=" + (!!e) + " veh=" + (e && (e.vehicle || e.vehicleId || e.vehicleOwnerId)));
  // (A2) clocking in AUTO-ADDS today to the job's work days (Set-union, additive)
  var wd = (typeof jobWorkDays === "function") ? jobWorkDays(j) : (j.workDays || []);
  if (wd.indexOf(today()) < 0) __errs.push("CA2: clock-in did not auto-add today to the job's work days");
})();

// (A3) a MANUAL time-only punch adds hours but ZERO miles, and does NOT move the mileage total (fingerprint).
(function () {
  var u = { id: "u_ca_man", username: "CaMan", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var j = { id: "j_ca2", title: "Cleanup — CA2", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(j);
  function miTotal() { return (typeof finMileage === "function") ? finMileage(D().timeclock || [], {}).total : null; }
  var before = miTotal();
  tcAddPunch(j.id, today());   // opens the manual-punch modal
  var din = document.getElementById("tc_ap_in"), dout = document.getElementById("tc_ap_out");
  if (!din || !dout) { __errs.push("CA3: Add-punch modal did not render time inputs"); }
  else {
    din.value = "08:00"; dout.value = "11:30";
    tcSaveManualPunch(j.id);
    var e = (D().timeclock || []).find(function (x) { return x.jobId === "j_ca2" && x.manual && !x.deleted; });
    if (!e) __errs.push("CA3: manual punch was not created");
    else {
      if (!(e.clockOut > e.clockIn)) __errs.push("CA3: manual punch has no valid duration");
      if (e.miles !== 0) __errs.push("CA3: manual punch must carry 0 miles (never invents mileage)");
      if (e.riderRole !== "none" || e.vehicle) __errs.push("CA3: manual punch must be time-only (no vehicle)");
      var hrs = (typeof jobClockedHrs === "function") ? jobClockedHrs(j) : 0;
      if (!(hrs > 0)) __errs.push("CA3: manual punch did not add clocked hours to the job");
    }
  }
  var after = miTotal();
  if (before !== after) __errs.push("CA3: a manual time-only punch MOVED the mileage total (" + before + " → " + after + ") — it must add 0 miles");
  diag("CA3 manual punch: mileage total before=" + before + " after=" + after);
})();

// (A4/A5) work-days ⇄ punches coherence: a day WITH punches can't be chip-removed; removing a PUNCH keeps the day;
// an EMPTY planned day is removable.
(function () {
  var _confirm = window.confirm; window.confirm = function () { return true; };
  try {
    var u = { id: "u_ca_day", username: "CaDay", active: true };
    S.users.push(u);
    if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
    S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
    var startDay = "2026-07-01", punchDay = "2026-07-03";
    var j = { id: "j_ca3", title: "Multi — CA3", customerId: null, date: startDay, crew: [u.id], workDays: [startDay, punchDay], done: false, updatedAt: now() };
    D().jobs.push(j);
    var pin = new Date(punchDay + "T08:00").getTime(), pout = new Date(punchDay + "T12:00").getTime();
    D().timeclock.push({ id: "tc_ca3_p", jobId: "j_ca3", userId: u.id, userName: "CaDay", clockIn: pin, clockOut: pout, inLoc: null, outLoc: null, pings: [], stops: [], computedMiles: 0, miles: 0, milesConfirmed: false, milesSource: null, odoStart: null, odoEnd: null, riderRole: "none", trailerId: null, rodeWith: null, vehicleId: null, vehicle: "", vehicleOwnerId: null, rate: 0.725, updatedAt: now() });
    // (A5) a day WITH punches must be protected from chip-removal
    jobPageRemoveDay("j_ca3", punchDay);
    var wdAfter = (typeof jobWorkDays === "function") ? jobWorkDays(j) : (j.workDays || []);
    if (wdAfter.indexOf(punchDay) < 0) __errs.push("CA5: a day WITH punches was removed — it must be protected until the punches are gone");
    // an EMPTY planned day must be chip-removable; a day with punches must NOT render a chip-remove
    jobPageCommitDays(j, wdAfter.concat(["2026-07-05"]));
    var card = jobPageWorkDaysCard(j);
    if (!/jobPageRemoveDay\('j_ca3','2026-07-05'\)/.test(card)) __errs.push("CA5: an EMPTY planned day should be chip-removable");
    if (/jobPageRemoveDay\('j_ca3','2026-07-03'\)/.test(card)) __errs.push("CA5: the card offered to remove a day that HAS punches");
    // (A4) removing the PUNCH soft-deletes only the entry; the day stays
    tcDelPunch("tc_ca3_p");
    var ent = D().timeclock.find(function (x) { return x.id === "tc_ca3_p"; });
    if (!ent || !ent.deleted) __errs.push("CA4: tcDelPunch did not soft-delete the entry");
    var wd2 = (typeof jobWorkDays === "function") ? jobWorkDays(j) : (j.workDays || []);
    if (wd2.indexOf(punchDay) < 0) __errs.push("CA4: removing a punch dropped its work day — the day must stay");
    diag("CA4/CA5 coherence: punchDay still present=" + (wd2.indexOf(punchDay) >= 0));
  } finally { window.confirm = _confirm; }
})();

// (A6) jobHourly derives person-hours + crew from the TIMECLOCK (not typed-in fields); perHr is null until someone
// clocks in (no stale number).
(function () {
  var u = { id: "u_ca_hh", username: "CaHh", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx";
  var j = { id: "j_ca4", title: "Hourly — CA4", customerId: null, date: today(), crew: [u.id, "u_ca_hh2"], done: false, updatedAt: now() };
  D().jobs.push(j);
  D().quotes = D().quotes || [];
  D().quotes.push({ id: "q_ca4", jobId: "j_ca4", total: 1000, finalPrice: 1000, deleted: false, updatedAt: now() });
  var hhBefore = jobHourly(j);
  if (hhBefore.perHr !== null) __errs.push("CA6: jobHourly.perHr must be null before anyone clocks in (no stale number)");
  var ci = new Date(today() + "T08:00").getTime(), co = new Date(today() + "T10:00").getTime();
  D().timeclock.push({ id: "tc_ca4", jobId: "j_ca4", userId: u.id, userName: "CaHh", clockIn: ci, clockOut: co, inLoc: null, outLoc: null, pings: [], stops: [], computedMiles: 0, miles: 0, milesConfirmed: false, milesSource: null, odoStart: null, odoEnd: null, riderRole: "none", trailerId: null, rodeWith: null, vehicleId: null, vehicle: "", vehicleOwnerId: null, rate: 0.725, updatedAt: now() });
  var hhAfter = jobHourly(j);
  if (hhAfter.perHr == null) __errs.push("CA6: jobHourly.perHr should be set once time is clocked");
  if (Math.abs(hhAfter.personHrs - 2) > 0.05) __errs.push("CA6: jobHourly.personHrs must equal the clocked hours (expected 2, got " + hhAfter.personHrs + ")");
  if (hhAfter.crew !== 1) __errs.push("CA6: crew must be the DISTINCT punchers (1), got " + hhAfter.crew);
  if (Math.abs(hhAfter.perHr - 240) > 0.5) __errs.push("CA6: perHr must derive from clocked hours (fieldPool 480 / 2h = 240, got " + hhAfter.perHr + ")");
  diag("CA6 jobHourly: personHrs=" + hhAfter.personHrs + " crew=" + hhAfter.crew + " perHr=" + hhAfter.perHr);
})();

// (A7) "Add someone who was here" — tcAddPersonToPunch clones the source punch's TIMES onto a NEW passenger entry
// for the picked user (same clockIn/clockOut/jobId, manual, NO vehicle/miles), adds them to job.crew, is owner/admin
// gated, and skips a duplicate overlap. It must NOT move the mileage total (passenger has no miles).
(function () {
  var owner = { id: "u_ca7_own", username: "Ca7Owner", active: true };
  var chase = { id: "u_ca7_chase", username: "Chase", active: true };
  var joe = { id: "u_ca7_joe", username: "Joe", active: true };
  S.users.push(owner, chase, joe);
  if (typeof orgSetRole === "function") { orgSetRole(owner.id, "obx", "owner"); orgSetRole(chase.id, "obx", "crew"); orgSetRole(joe.id, "obx", "crew"); }
  S.biz = "obx"; localStorage.setItem("jra_session", owner.id); localStorage.setItem("jra_offline_ok", "1");
  var day = "2026-07-06";
  var ci = new Date(day + "T08:00").getTime(), co = new Date(day + "T14:00").getTime();
  var j = { id: "j_ca7", title: "Paver — CA7", customerId: null, date: day, crew: [owner.id, chase.id], workDays: [day], done: false, updatedAt: now() };
  D().jobs.push(j);
  // the owner's REAL driver punch (has a vehicle + miles) — the source we add Chase to
  var src = { id: "tc_ca7_src", jobId: "j_ca7", userId: owner.id, userName: "Ca7Owner", clockIn: ci, clockOut: co, inLoc: null, outLoc: null, pings: [], stops: [], computedMiles: 12, miles: 12, milesConfirmed: true, milesSource: "odo", odoStart: 1000, odoEnd: 1012, riderRole: "driver", trailerId: null, rodeWith: null, vehicleId: "v1", vehicle: "F-250", vehicleOwnerId: owner.id, rate: 0.725, updatedAt: now() };
  D().timeclock.push(src);
  function miTotal() { return (typeof finMileage === "function") ? finMileage(D().timeclock || [], {}).total : null; }
  var before = miTotal();
  // add Chase (a passenger who rode along)
  tcAddPersonToPunch("tc_ca7_src", chase.id);
  var pass = (D().timeclock || []).find(function (x) { return x.userId === chase.id && x.jobId === "j_ca7" && !x.deleted; });
  if (!pass) __errs.push("CA7: tcAddPersonToPunch did not create a passenger entry for the picked user");
  else {
    if (pass.clockIn !== src.clockIn || pass.clockOut !== src.clockOut) __errs.push("CA7: passenger entry must copy the SAME clockIn/clockOut");
    if (pass.jobId !== src.jobId) __errs.push("CA7: passenger entry must be on the same job");
    if (pass.manual !== true) __errs.push("CA7: passenger entry must be manual:true");
    if (pass.by !== owner.id) __errs.push("CA7: passenger entry must record by:<me>");
    if (pass.addedFrom !== "tc_ca7_src") __errs.push("CA7: passenger entry must record addedFrom:<source>");
    if (pass.vehicleId || pass.vehicle || pass.vehicleOwnerId) __errs.push("CA7: passenger entry must carry NO vehicle (rode along)");
    if (pass.miles !== 0 || pass.computedMiles !== 0) __errs.push("CA7: passenger entry must carry NO miles (no duplicate trip)");
    if (pass.milesConfirmed) __errs.push("CA7: passenger entry must NOT be milesConfirmed");
    if (pass.riderRole !== "none") __errs.push("CA7: passenger entry must be riderRole:none");
  }
  if (j.crew.indexOf(chase.id) < 0) __errs.push("CA7: the added person must be in the job's crew");
  var after = miTotal();
  if (before !== after) __errs.push("CA7: adding a passenger MOVED the mileage total (" + before + " → " + after + ") — it must add 0 miles");
  // dup-skip: adding Chase AGAIN (already overlapping) must not create a second entry
  var _alert = window.alert; window.alert = function () {}; var cntBefore = (D().timeclock || []).filter(function (x) { return x.userId === chase.id && x.jobId === "j_ca7" && !x.deleted; }).length;
  tcAddPersonToPunch("tc_ca7_src", chase.id);
  var cntAfter = (D().timeclock || []).filter(function (x) { return x.userId === chase.id && x.jobId === "j_ca7" && !x.deleted; }).length;
  window.alert = _alert;
  if (cntAfter !== cntBefore) __errs.push("CA7: a duplicate overlapping add was NOT skipped (created " + (cntAfter - cntBefore) + " extra)");
  // owner/admin gate: a crew member (no manage-members) must NOT be able to add for someone else
  localStorage.setItem("jra_session", joe.id);
  var _alert2 = window.alert; window.alert = function () {};
  tcAddPersonToPunch("tc_ca7_src", joe.id);
  window.alert = _alert2;
  var joeEntry = (D().timeclock || []).find(function (x) { return x.userId === joe.id && x.jobId === "j_ca7" && !x.deleted; });
  if (joeEntry) __errs.push("CA7: a non-owner/non-admin was able to add a person to a punch (gate failed)");
  localStorage.setItem("jra_session", owner.id);
  diag("CA7 add-person: passenger=" + (!!pass) + " inCrew=" + (j.crew.indexOf(chase.id) >= 0) + " miTotal " + before + "→" + after + " dupSkipped=" + (cntAfter === cntBefore) + " gated=" + (!joeEntry));
})();

/* =====================================================================================================
   CLUSTER B — TIMECLOCK UX REDESIGN (2026-07-09). Ray's field report: (1) clock-out must COMPLETE without
   the odometer and be unmistakable; (2) an absurd distance (he clocked out to "2000 miles") must be FLAGGED
   for review, not silently confirmed; (3) an admin LIVE roster of who's on the clock + clock-out-this-person;
   (4) the mileage/hours MATH is unchanged (flag + UX + roster only). All additive — billed mileage never moves.
   ===================================================================================================== */

// (B1) CLOCK-OUT COMPLETES via the PRIMARY "✓ Clock out now" button with NO odometer entered → clockOut set,
//      odometer marked PENDING (not a blocker), and the shift is no longer open. Never stuck clocked in.
await (async function () {
  var u = { id: "u_b1", username: "B1 Driver", active: true };
  S.users.push(u);
  if (typeof orgSetRole === "function") orgSetRole(u.id, "obx", "owner");
  S.biz = "obx"; localStorage.setItem("jra_session", u.id); localStorage.setItem("jra_offline_ok", "1");
  var job = { id: "j_b1", title: "Clock-out-no-odo job", customerId: null, date: today(), crew: [u.id], done: false, updatedAt: now() };
  D().jobs.push(job);
  var e = {
    id: "tc_b1", jobId: "j_b1", userId: u.id, userName: "B1 Driver",
    clockIn: now() - 90 * 60000, clockOut: null,
    inLoc: { lat: 36.1, lng: -75.7, ts: now() - 90 * 60000, dev: "mobile" }, outLoc: null,
    pings: [{ lat: 36.15, lng: -75.75, ts: now() - 60 * 60000, dev: "mobile" }], stops: [],
    computedMiles: 6.0, miles: null, milesConfirmed: false, milesSource: null,
    odoStart: 1000, odoEnd: null, riderRole: "driver", trailerId: null, rodeWith: null,
    vehicleId: null, vehicle: "B1's truck", vehicleOwnerId: u.id, rate: 0.725, updatedAt: now()
  };
  D().timeclock.push(e);
  if (!tcEntryHasVehicle(e)) __errs.push("B1: fixture broken — driver shift must count as having a vehicle");
  if (tcOpenShift(u.id) == null) __errs.push("B1: fixture broken — the shift should be open before clock-out");
  tcClockOut("tc_b1");   // opens the redesigned clock-out modal
  var primary = document.querySelector('button[onclick*="tcClockOutNow"]');
  diag("B1 primary button present=" + !!primary);
  if (!primary) __errs.push("B1: the redesigned clock-out modal has no primary ✓ Clock out now button (tcClockOutNow)");
  var odoEl = document.getElementById("tc_odo_end");
  if (odoEl) { odoEl.value = ""; odoEl.dispatchEvent(new Event("input", { bubbles: true })); }   // leave the odometer BLANK
  if (primary) primary.click();   // tap ✓ Clock out now with no odometer
  var after = D().timeclock.find(function (x) { return x.id === "tc_b1"; });
  diag("B1 after clock-out: clockOut=" + (after && after.clockOut) + " odoPending=" + (after && after.odoPending) + " source=" + (after && after.milesSource) + " open=" + !!tcOpenShift(u.id));
  if (!after || after.clockOut == null) __errs.push("B1: ✓ Clock out now did NOT complete the clock-out (clockOut still null) — Ray's stuck-clocked-in bug");
  if (after && tcOpenShift(u.id)) __errs.push("B1: the shift is STILL OPEN after clocking out (never-stuck invariant violated)");
  if (after && after.odoPending !== true) __errs.push("B1: a deferred (no-odometer) clock-out must mark the shift odometer-pending, got " + (after && after.odoPending));
  if (after && after.milesSource !== "gps") __errs.push("B1: a no-odometer clock-out must fall to the GPS estimate (milesSource gps), got " + (after && after.milesSource));
  if (after && after.milesConfirmed) __errs.push("B1: a GPS-estimate clock-out must NOT be auto-confirmed");
  if (typeof closeModal === "function") closeModal();
  localStorage.removeItem("jra_session");
})();

// (B2) ABSURD-MILEAGE SANITY FLAG — a shift over TC_SANE_MAX_MILES flags "needs review" and is NOT auto-confirmed;
//      a normal local shift does not flag and DOES auto-confirm. Display-only: the odometer delta math is unchanged.
(function () {
  if (typeof TC_SANE_MAX_MILES !== "number") { __errs.push("B2: TC_SANE_MAX_MILES constant is missing"); return; }
  // absurd: 1000 -> 3200 odometer = 2200 mi (Ray's "2000 miles" case)
  var big = { id: "tc_b2_big", jobId: "x", userId: "d", userName: "D", clockIn: now() - 3600000, clockOut: null, inLoc: null, outLoc: null, pings: [], stops: [], computedMiles: 0, miles: null, milesConfirmed: false, milesSource: null, odoStart: 1000, odoEnd: null, riderRole: "driver", trailerId: null, rodeWith: null, vehicleId: null, vehicle: "Truck", vehicleOwnerId: "d", rate: 0.725, updatedAt: now() };
  tcFinalizeSegment(big, 3200);
  diag("B2 absurd: miles=" + big.miles + " source=" + big.milesSource + " confirmed=" + big.milesConfirmed + " sane=" + JSON.stringify(tcSaneMiles(big)));
  if (big.miles !== 2200) __errs.push("B2: odometer delta math changed — expected 2200 mi, got " + big.miles);
  if (big.milesSource !== "odometer") __errs.push("B2: the odometer must still be the number of record (source odometer)");
  if (big.milesConfirmed) __errs.push("B2: an implausible-distance shift must NOT be auto-confirmed (owner reviews it)");
  var sf = tcSaneMiles(big);
  if (!sf || !sf.flag) __errs.push("B2: a shift over TC_SANE_MAX_MILES must flag needs-review via tcSaneMiles");
  // a GPS-estimate shift with an absurd computed distance must also flag
  var bigGps = { id: "tc_b2_gps", clockOut: now(), miles: 2000, computedMiles: 2000, milesConfirmed: false };
  if (!tcSaneMiles(bigGps)) __errs.push("B2: a GPS shift with absurd miles must also flag needs-review");
  // normal local shift: 1000 -> 1042 = 42 mi → NO flag, auto-confirmed
  var ok = { id: "tc_b2_ok", jobId: "x", userId: "d", userName: "D", clockIn: now() - 3600000, clockOut: null, inLoc: null, outLoc: null, pings: [], stops: [], computedMiles: 0, miles: null, milesConfirmed: false, milesSource: null, odoStart: 1000, odoEnd: null, riderRole: "driver", trailerId: null, rodeWith: null, vehicleId: null, vehicle: "Truck", vehicleOwnerId: "d", rate: 0.725, updatedAt: now() };
  tcFinalizeSegment(ok, 1042);
  diag("B2 normal: miles=" + ok.miles + " confirmed=" + ok.milesConfirmed + " sane=" + !!tcSaneMiles(ok));
  if (ok.miles !== 42) __errs.push("B2: normal odometer delta changed — expected 42 mi, got " + ok.miles);
  if (tcSaneMiles(ok)) __errs.push("B2: a normal local shift (42 mi) must NOT flag as implausible");
  if (!ok.milesConfirmed) __errs.push("B2: a normal odometer shift must still auto-confirm");
})();

// (B3) ADMIN LIVE ROSTER — lists everyone on the clock with their job + a clock-out-THIS-person action; owner/admin
//      only. A crew member must not reach it.
(function () {
  var owner = { id: "u_b3_own", username: "B3 Owner", active: true };
  var hand = { id: "u_b3_hand", username: "Buddy", active: true };
  S.users.push(owner, hand);
  if (typeof orgSetRole === "function") { orgSetRole(owner.id, "obx", "owner"); orgSetRole(hand.id, "obx", "crew"); }
  S.biz = "obx"; localStorage.setItem("jra_session", owner.id); localStorage.setItem("jra_offline_ok", "1");
  var job = { id: "j_b3", title: "Roster-visible job", customerId: null, date: today(), crew: [hand.id], done: false, updatedAt: now() };
  D().jobs.push(job);
  var open = { id: "tc_b3_open", jobId: "j_b3", userId: hand.id, userName: "Buddy", clockIn: now() - 45 * 60000, clockOut: null, inLoc: { lat: 36.12, lng: -75.73, ts: now() - 40 * 60000, dev: "mobile" }, outLoc: null, pings: [], stops: [], computedMiles: 3, miles: null, milesConfirmed: false, milesSource: null, odoStart: null, odoEnd: null, riderRole: "none", trailerId: null, rodeWith: null, vehicleId: null, vehicle: "", vehicleOwnerId: null, rate: 0.725, updatedAt: now() };
  D().timeclock.push(open);
  var html = tcRosterHTML();
  diag("B3 roster: hasName=" + /Buddy/.test(html) + " hasJob=" + /Roster-visible job/.test(html) + " hasClockOut=" + /tcClockOut\('tc_b3_open'\)/.test(html) + " hasWhere=" + /maps\.google/.test(html));
  if (!/Buddy/.test(html)) __errs.push("B3: the roster does not list the on-the-clock person by name");
  if (!/Roster-visible job/.test(html)) __errs.push("B3: the roster does not show which job the person is on");
  if (!/On the clock now/.test(html)) __errs.push("B3: the roster is missing the 'On the clock now' section");
  if (!/tcClockOut\('tc_b3_open'\)/.test(html)) __errs.push("B3: the roster has no clock-out-THIS-person action wired to the shared tcClockOut core");
  // owner reaches the roster via the sub-tab
  TCSUB = "roster"; TAB = "time"; render();
  if (!/On the clock now/.test(view.innerHTML)) __errs.push("B3: owner could not reach the live roster via the Time page sub-tab");
  if (!/tcClockOut\('tc_b3_open'\)/.test(view.innerHTML)) __errs.push("B3: the rendered owner roster is missing the clock-out-this-person button");
  // a CREW member must NOT reach it (owner/admin gate)
  localStorage.setItem("jra_session", hand.id);
  if (typeof orgSetRole === "function") orgSetRole(hand.id, "obx", "crew");
  var gated = tcRosterHTML();
  if (!/Owner\/admin only/.test(gated)) __errs.push("B3: tcRosterHTML is not owner/admin gated for a crew member");
  TCSUB = "roster"; TAB = "time"; render();
  // a crew member with TCSUB=roster must fall through to the plain Clock view — never the owner roster section
  // (they may still see their OWN active-shift clock-out button; the gate is the roster SECTION, not that button)
  if (/On the clock now/.test(view.innerHTML) || /Off the clock/.test(view.innerHTML)) __errs.push("B3: a crew member reached the owner live-roster section (gate failed)");
  // owner clocks the person OUT from the roster (reuses tcClockOut → tcClockOutNow, no-vehicle path completes)
  localStorage.setItem("jra_session", owner.id);
  TCSUB = "clock";
  tcClockOut("tc_b3_open");
  var doneBtn = document.querySelector('button[onclick*="tcClockOutNow"]') || document.querySelector('button[onclick*="tcFinishClockOut"]');
  if (doneBtn) doneBtn.click();
  var closed = D().timeclock.find(function (x) { return x.id === "tc_b3_open"; });
  diag("B3 owner clocked out buddy: clockOut=" + (closed && closed.clockOut));
  if (!closed || closed.clockOut == null) __errs.push("B3: the owner could not clock the person out from the roster");
  if (typeof closeModal === "function") closeModal();
  localStorage.removeItem("jra_session");
})();

// (B4) MATH UNCHANGED — tcMiles / tcOdoMiles / tcComputeMiles are pure and untouched by the flag/UX/roster work.
(function () {
  var e = { odoStart: 100, odoEnd: 140, miles: 40, computedMiles: 37.6 };
  if (tcOdoMiles(e) !== 40) __errs.push("B4: tcOdoMiles math changed — expected 40, got " + tcOdoMiles(e));
  if (tcMiles(e) !== 40) __errs.push("B4: tcMiles must return the confirmed miles (40), got " + tcMiles(e));
  var g = { computedMiles: 12.34 };   // no e.miles → tcMiles = rounded computedMiles
  if (tcMiles(g) !== 12.3) __errs.push("B4: tcMiles GPS-fallback rounding changed — expected 12.3, got " + tcMiles(g));
  var path = { inLoc: { lat: 36.0, lng: -75.7 }, pings: [{ lat: 36.1, lng: -75.7 }], outLoc: { lat: 36.2, lng: -75.7 }, stops: [] };
  var d = tcComputeMiles(path);   // two ~6.9-mi legs of pure-latitude travel
  diag("B4 tcComputeMiles two legs=" + d);
  if (!(d > 13 && d < 14.5)) __errs.push("B4: tcComputeMiles haversine drifted — expected ~13.8 mi, got " + d);
})();
