/* Job-page receipt double-submit + missing-photo regression — Ray's exact June 2026 report:
   took a photo, tapped once, saw nothing happen (a slow save over weak jobsite signal looked like a no-op),
   so he tapped ~20 more times → ~20 duplicate records, NONE carrying the receipt photo.

   The two old add-forms (jobAddExpense/jobAddMaterial) were RETIRED (Phase 3) and replaced by the UNIFIED
   receipt card (js/100 jobRcptCardHTML → rcptApplySplit). This test now proves the SAME two protections hold on
   the new path:
     1) jobRcptUpload carries a submit-in-flight guard (_jobRcptUpBusy) — 20 rapid taps against a slow upload
        create exactly ONE review stub carrying the ONE photo (no dupes, photo not lost).
     2) jobRcptConfirm files exactly ONE set of records for 20 rapid taps (it clears JOB_RCPT synchronously on
        success, and carries _jobRcptConfirmBusy), and every filed line carries the uploaded photo's receiptId.

   Run inside the real app via verify-app.js (the render fns + handlers are browser-defined):
       node verify-app.js "$(cat job-material-dupe-tests.js)" */

// ---- sign in a test owner ----
var matTestUser = { id: "u_matdupe_test", username: "MatDupeTest", active: true };
S.users = S.users || [];
S.users.push(matTestUser);
if (typeof orgSetRole === "function") orgSetRole("u_matdupe_test", "obx", "owner");
localStorage.setItem("jra_session", "u_matdupe_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

// ---- seed one job to attach the receipt to ----
var matTestJobId = "job_matdupe_test";
D().jobs.push({
  id: matTestJobId, title: "Dupe-Receipt Regression Job", date: (typeof today === "function" ? today() : "2026-06-30"),
  customerId: null, materials: [], expenses: [], deleted: false, updatedAt: now()
});

// ---- open the job page (same path rSchedule takes for window.JOB_OPEN) ----
window.JOB_OPEN = matTestJobId;
TAB = "schedule";
render();

// the unified receipt card must render (its photo picker) — the two old add-forms are gone
var pageHtml = (document.getElementById("view") || {}).innerHTML || "";
if (pageHtml.indexOf("job_rcpt_file") < 0) __errs.push("job page did not render the unified receipt card (js/100 jobRcptCardHTML → #job_rcpt_file)");
if (typeof jobRcptUpload !== "function" || typeof jobRcptConfirm !== "function") __errs.push("js/100 handlers (jobRcptUpload / jobRcptConfirm) not defined");

// This test asserts the DATA MODEL (exactly-one record + the photo carried), not the DOM. Neutralize the full
// re-render during the mutation loops: under headless virtual-time the real render pipeline (toast node + a
// changelog entry + a filed-receipt job-page rebuild all firing pending timers) never reaches quiescence and the
// dump stalls. The guards + records we assert are unaffected. render() is restored at the end.
var _origRender = window.render; window.render = function () {};

// ---- mock a SLOW upload (weak jobsite signal) so repeated taps race a real in-flight save ----
var MOCK_RECEIPT_ID = "mock_receipt_dupe_test";
var _origJsUpload = window.jsUpload, uploadCalls = 0;
window.jsUpload = function (file) { uploadCalls++; return new Promise(function (resolve) { setTimeout(function () { resolve(MOCK_RECEIPT_ID); }, 60); }); };

// a fake file-input, exactly what the onchange passes (input.files[0])
var fakeInput = { files: [new File(["fake-receipt-bytes"], "receipt.jpg", { type: "image/jpeg" })] };

// ---- 20 rapid taps on "upload" while the upload is in flight (the actual bug Ray hit) ----
var _reviewBefore = (D().receipts || []).filter(function (r) { return r && !r.deleted; }).length;
for (var i = 0; i < 20; i++) { jobRcptUpload(fakeInput, matTestJobId); }
await new Promise(function (resolve) { setTimeout(resolve, 700); });   // let the single guarded upload settle

var reviewStubs = (D().receipts || []).filter(function (r) { return r && !r.deleted && r.receiptId === MOCK_RECEIPT_ID; });
diag("uploadCalls=" + uploadCalls + " reviewStubsCreated=" + reviewStubs.length);
if (uploadCalls !== 1) __errs.push("DOUBLE-SUBMIT regression: 20 rapid taps triggered " + uploadCalls + " upload(s) — expected exactly 1 (jobRcptUpload guard)");
if (reviewStubs.length !== 1) __errs.push("DOUBLE-SUBMIT regression: 20 rapid taps created " + reviewStubs.length + " review stub(s) — expected exactly 1");
if (reviewStubs.length && reviewStubs[0].receiptId !== MOCK_RECEIPT_ID) __errs.push("MISSING-PHOTO regression: the review stub's receiptId is '" + (reviewStubs[0] && reviewStubs[0].receiptId) + "', expected '" + MOCK_RECEIPT_ID + "'");

// ---- now confirm the line items (one $45 pass-through) and prove 20 rapid Confirm taps → ONE filing ----
if (typeof JOB_RCPT !== "undefined" && JOB_RCPT && JOB_RCPT.jobId === matTestJobId) {
  JOB_RCPT.suggested = { vendor: "Lowes" };
  JOB_RCPT.total = "45";
  JOB_RCPT.rows = [{ desc: "Paver base rock", amount: "45", bucket: "pass-through" }];
  for (var k = 0; k < 20; k++) { jobRcptConfirm(matTestJobId); }
  await new Promise(function (resolve) { setTimeout(resolve, 200); });

  var _j = actJ().find(function (x) { return x.id === matTestJobId; });
  var mats = ((_j && _j.materials) || []).filter(function (m) { return m && !m.deleted; });
  diag("confirmTaps=20 materialsCreated=" + mats.length + " receiptId=" + (mats[0] && mats[0].receiptId));
  if (mats.length !== 1) __errs.push("DOUBLE-SUBMIT regression: 20 rapid Confirm taps created " + mats.length + " material record(s) — expected exactly 1");
  if (mats.length && mats[0].receiptId !== MOCK_RECEIPT_ID) __errs.push("MISSING-PHOTO regression: the filed material's receiptId is '" + (mats[0].receiptId) + "', expected '" + MOCK_RECEIPT_ID + "'");
  if (mats.length && (mats[0].amount !== 45 || mats[0].vendor !== "Lowes" || mats[0].desc !== "Paver base rock")) __errs.push("the filed material's amount/vendor/desc don't match what was entered");
} else {
  __errs.push("post-upload state (JOB_RCPT) not set for the test job — the upload path didn't seed the editor");
}

window.jsUpload = _origJsUpload;
window.render = _origRender;
