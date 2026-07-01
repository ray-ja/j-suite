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
