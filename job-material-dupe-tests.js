/* Job-page "+ Add material" double-submit + missing-photo regression — Ray's exact June 2026 report:
   took a photo, filled in price/vendor/description, tapped "Add material" once, saw nothing happen
   (a slow save over weak jobsite signal looked like a no-op), so he tapped ~20 more times. Result:
   ~20 duplicate pass-through-material records were created, and NONE of them carried the receipt photo.

   Root causes fixed in js/61-job-page.js:
     1) jobAddMaterial (and its sibling jobAddExpense) had ZERO submit-in-flight guard — every tap
        independently re-read the same amount/vendor/desc/receipt-file off the DOM and created its own
        record.
     2) Because every tap independently kicked off its own upload/create, whichever DOM state a LATER tap
        saw (after an earlier tap's completion re-rendered the page) could already be blank/stale — the
        fix locks out repeat taps entirely so only the ONE record from the ONE allowed tap is created,
        carrying the ONE photo that was actually selected.

   Simulates 20 rapid repeated taps (calling the handler directly, exactly what the onclick does) against
   a slow (mocked) upload, and asserts exactly ONE material record is created, and it carries the photo.

   Run inside the real app via verify-app.js (the render fns + handlers are browser-defined):
       node verify-app.js "$(cat job-material-dupe-tests.js)" */

// ---- sign in a test owner (bypasses the login gate the same way availability-display-tests.js does) ----
var matTestUser = { id: "u_matdupe_test", username: "MatDupeTest", active: true };
S.users = S.users || [];
S.users.push(matTestUser);
if (typeof orgSetRole === "function") orgSetRole("u_matdupe_test", "obx", "owner");
localStorage.setItem("jra_session", "u_matdupe_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

// ---- seed one job to attach the pass-through material to ----
var matTestJobId = "job_matdupe_test";
D().jobs.push({
  id: matTestJobId, title: "Dupe-Material Regression Job", date: (typeof today === "function" ? today() : "2026-06-30"),
  customerId: null, materials: [], expenses: [], deleted: false, updatedAt: now()
});

// ---- open the job page (same path rSchedule takes for window.JOB_OPEN) ----
window.JOB_OPEN = matTestJobId;
TAB = "schedule";
render();

var matAmtEl = document.getElementById("mat_amt"), matVendorEl = document.getElementById("mat_vendor"), matDescEl = document.getElementById("mat_desc"), matReceiptEl = document.getElementById("mat_receipt");
if (!matAmtEl || !matVendorEl || !matDescEl || !matReceiptEl) __errs.push("job page did not render the pass-through material form (mat_amt/mat_vendor/mat_desc/mat_receipt missing)");

// ---- fill the form, exactly as Ray did: photo, price, vendor, description ----
var _dt = new DataTransfer();
_dt.items.add(new File(["fake-receipt-bytes"], "receipt.jpg", { type: "image/jpeg" }));
matReceiptEl.files = _dt.files;
matAmtEl.value = "45";
matVendorEl.value = "Lowes";
matDescEl.value = "Paver base rock";

// ---- mock a SLOW upload (weak jobsite signal) so repeated taps race a real in-flight save ----
var MOCK_RECEIPT_ID = "mock_receipt_dupe_test";
var _origJsUpload = window.jsUpload, uploadCalls = 0;
window.jsUpload = function (file) { uploadCalls++; return new Promise(function (resolve) { setTimeout(function () { resolve(MOCK_RECEIPT_ID); }, 60); }); };

// ---- simulate ~20 rapid repeated taps on "Add material" (this is literally what the onclick fires) ----
for (var i = 0; i < 20; i++) { jobAddMaterial(matTestJobId); }

// ---- let the (single, guarded) save + its delayed render settle ----
await new Promise(function (resolve) { setTimeout(resolve, 900); });

window.jsUpload = _origJsUpload;

var _j = actJ().find(function (x) { return x.id === matTestJobId; });
var mats = ((_j && _j.materials) || []).filter(function (m) { return m && !m.deleted; });
diag("uploadCalls=" + uploadCalls + " materialsCreated=" + mats.length + " receiptId=" + (mats[0] && mats[0].receiptId));

if (uploadCalls !== 1) __errs.push("DOUBLE-SUBMIT regression: 20 rapid taps triggered " + uploadCalls + " upload(s) — expected exactly 1 (no submit-in-flight guard)");
if (mats.length !== 1) __errs.push("DOUBLE-SUBMIT regression: 20 rapid taps created " + mats.length + " material record(s) — expected exactly 1");
if (mats.length && mats[0].receiptId !== MOCK_RECEIPT_ID) __errs.push("MISSING-PHOTO regression: the created material record's receiptId is '" + (mats[0].receiptId) + "', expected the uploaded photo's id '" + MOCK_RECEIPT_ID + "'");
if (mats.length && (mats[0].amount !== 45 || mats[0].vendor !== "Lowes" || mats[0].desc !== "Paver base rock")) __errs.push("the created material record's amount/vendor/desc don't match what was entered");
