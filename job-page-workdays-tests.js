/* Job-page fast "Work days" add/remove — regression + smoke test for Ray's live tonight-notes:
   the multi-day work-day picker already existed (js/09 openJob → JOBWORKDAYS/renderJobWorkDays), but it's
   buried behind customer/service/crew/equipment fields in the FULL job-edit modal, and Ray's real workflow
   is "mark today, hop back in later and add the next day" without opening that whole form. This adds a
   "📅 Work days" section to the top of the crew-facing job page (js/61 rJobWorkDaysCard) with:
     - a compact chip list of jobWorkDays(j)
     - "+ Add today" — one tap, no modal, writes straight to j.workDays
     - "+ Add another day" — opens a SMALL modal (just the mini tap-on/off calendar, reusing js/09's
       wdpkGridHtml/wdpkChipsHtml widget) instead of the full editor
     - removing a day (✕ on a chip) from the same compact view
   Both the fast path and the full-editor path write straight to the SAME j.workDays[] (via jobWorkDays()),
   so this also asserts the two stay in sync — whichever was used most recently is what the other shows.

   Run inside the real app via verify-app.js (the render fns + handlers are browser-defined):
       node verify-app.js "$(cat job-page-workdays-tests.js)" */

// ---- sign in a test owner (bypasses the login gate, same pattern as the other job-page regression tests) ----
var wdTestUser = { id: "u_wdfast_test", username: "WdFastTest", active: true };
S.users = S.users || [];
S.users.push(wdTestUser);
if (typeof orgSetRole === "function") orgSetRole("u_wdfast_test", "obx", "owner");
localStorage.setItem("jra_session", "u_wdfast_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

// ---- seed a legacy single-day job (no workDays[] yet) with a START date that is NOT today, so "+ Add
//      today" has something real to do and the start-day-can't-be-removed rule is exercised on a day
//      that differs from "today" ----
var wdJobId = "job_wdfast_test";
var wdStart = "2026-06-01";
D().jobs.push({ id: wdJobId, title: "Fast Work-Day Regression Job", date: wdStart, customerId: null, crew: [], deleted: false, updatedAt: now() });

window.JOB_OPEN = wdJobId; TAB = "schedule"; render();

// ==== 1) "+ Add today" — one tap, no modal ====
var addTodayBtn = Array.prototype.find.call(document.querySelectorAll("button"), function (b) { return /Add today/.test(b.textContent); });
if (!addTodayBtn) __errs.push("job page did not render the '+ Add today' button");

jobWdAddToday(wdJobId);   // this is literally what the button's onclick fires

var _j1 = actJ().find(function (x) { return x.id === wdJobId; });
var _today = today();
if (!_j1 || (_j1.workDays || []).indexOf(_today) < 0) __errs.push("'+ Add today' did not add today (" + _today + ") to j.workDays — got " + JSON.stringify(_j1 && _j1.workDays));
if (overlay.classList.contains("show")) __errs.push("'+ Add today' opened a modal — it must be a single tap with NO modal/navigation");

// a second tap must be a harmless no-op (button is hidden once today's covered, but the handler itself must guard too)
var _beforeLen = (_j1.workDays || []).length;
jobWdAddToday(wdJobId);
if ((actJ().find(function (x) { return x.id === wdJobId; }).workDays || []).length !== _beforeLen) __errs.push("a second '+ Add today' tap duplicated today in workDays instead of being a no-op");

render();
var afterAddHtml = document.getElementById("view").innerHTML;
if (!/already a work day/i.test(afterAddHtml)) __errs.push("after adding today, the job page should confirm 'already a work day' instead of still offering to add it");

// ==== 2) "+ Add another day" — small focused picker modal, not the full job-edit form ====
jobWdOpenPicker(wdJobId);
if (!overlay.classList.contains("show")) __errs.push("'+ Add another day' did not open a modal");
var pickerBox = document.getElementById("jpwd_box");
if (!pickerBox || !pickerBox.querySelector(".wdpk-grid")) __errs.push("the '+ Add another day' modal did not render the mini tap-on/off calendar (.wdpk-grid)");
// the full job-edit fields must NOT be present in this modal — it's meant to be small/focused
if (document.getElementById("j_crew") || document.getElementById("j_cust")) __errs.push("'+ Add another day' opened something resembling the FULL job-edit form — it must be a small focused picker only");

// tap a future day in the grid (simulate exactly what a grid-cell tap fires)
var wdFuture = "2026-06-15";
jobWdPickerToggle(wdFuture);
var _j2 = actJ().find(function (x) { return x.id === wdJobId; });
if ((_j2.workDays || []).indexOf(wdFuture) < 0) __errs.push("tapping " + wdFuture + " in the mini picker did not persist it to j.workDays");
if (typeof jobOnDay === "function" && !jobOnDay(_j2, wdFuture)) __errs.push("jobOnDay() (the schedule-placement check js/09 calendar/week/day views all use) does not see " + wdFuture + " as a work day after the picker toggle");

// the picker's own chip list must reflect the new day immediately (no separate save step)
var pickerHtmlAfterToggle = document.getElementById("jpwd_box").innerHTML;
if (pickerHtmlAfterToggle.indexOf("Jun 15") < 0 && pickerHtmlAfterToggle.indexOf("06/15") < 0 && !/15/.test(pickerHtmlAfterToggle)) diag("picker chip text did not obviously contain the 15th — non-fatal, formatting-dependent");

// the picker must refuse to remove the START day
jobWdPickerToggle(wdStart);
var _j3 = actJ().find(function (x) { return x.id === wdJobId; });
if ((_j3.workDays || []).indexOf(wdStart) < 0) __errs.push("the picker removed the START day (" + wdStart + ") — the start day must never be removable here, same rule as the full editor");

closeModal(); render();

// ==== 3) remove a mistakenly-added day from the compact chip list (✕), without the modal ====
jobWdToggle(wdJobId, wdFuture);
var _j4 = actJ().find(function (x) { return x.id === wdJobId; });
if ((_j4.workDays || []).indexOf(wdFuture) >= 0) __errs.push("jobWdToggle (the chip ✕ handler) did not remove " + wdFuture + " from j.workDays");

// re-add it for the sync check below
jobWdToggle(wdJobId, wdFuture);

// ==== 4) full-editor path stays in sync — whichever was used most recently is what the OTHER shows ====
openJob(wdJobId);   // js/09's full job-edit modal
if (JOBWORKDAYS.indexOf(_today) < 0 || JOBWORKDAYS.indexOf(wdFuture) < 0) __errs.push("opening the FULL editor after using the fast job-page path does not show the fast-path-added days (today, " + wdFuture + ") — JOBWORKDAYS=" + JSON.stringify(JOBWORKDAYS));
// use the full editor to add one more day, save, and confirm the FAST path (job-page card) now shows it too
var wdFromEditor = "2026-06-20";
jobToggleWorkDay(wdFromEditor);
saveJob(wdJobId, false);
var _j5 = actJ().find(function (x) { return x.id === wdJobId; });
if ((_j5.workDays || []).indexOf(wdFromEditor) < 0) __errs.push("saving the FULL editor after adding " + wdFromEditor + " did not persist it to j.workDays");
window.JOB_OPEN = wdJobId; render();
var jobPageHtmlAfterEditorSave = document.getElementById("view").innerHTML;
if (jobPageHtmlAfterEditorSave.indexOf("4 days") < 0 && !/·\s*4\s*days/.test(jobPageHtmlAfterEditorSave)) diag("job-page work-day count text not found as expected — checking chip count instead");
var chipCountAfter = (jobPageHtmlAfterEditorSave.match(/wdpk-chip/g) || []).length;
if (chipCountAfter < 4) __errs.push("job page's fast Work-days card does not reflect the day added via the FULL editor — expected >=4 chips (start + today + " + wdFuture + " + " + wdFromEditor + "), saw " + chipCountAfter);

diag("final workDays=" + JSON.stringify(_j5.workDays));
