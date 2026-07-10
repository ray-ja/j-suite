/* Customer materials report (js/106) — runs inside the real app via verify-app.js:
       node verify-app.js "$(cat materials-report-tests.js)"

   Proves the report is ONLY the customer-billed PASS-THROUGH items, totals them correctly, carries the
   receipt image URLs for items with photos, and that the job-page button shows exactly when the job has
   pass-through items AND the viewer is owner/admin (finCanView) — a job with none → no button, no throw.
   Read/display only: never writes the data. */

// ---- sign in a test owner ----
var mrUser = { id: "u_matrep_test", username: "MatRepTest", active: true };
S.users = S.users || [];
S.users.push(mrUser);
if (typeof orgSetRole === "function") orgSetRole("u_matrep_test", "obx", "owner");
localStorage.setItem("jra_session", "u_matrep_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

// ---- a customer + a job with a MIX: pass-through material (w/ receipt), pass-through material (no receipt),
//      an internal job-expense, and a pass-through-tagged expense (rare). Plus a job with NOTHING. ----
var mrCustId = "cust_matrep_test";
D().customers.push({ id: mrCustId, name: "Test Customer LLC", address: "123 Beach Rd, Nags Head NC", deleted: false, updatedAt: now() });

var mrJobId = "job_matrep_test";
D().jobs.push({
  id: mrJobId, title: "Paver Patio (report test)", date: "2026-07-05", customerId: mrCustId, deleted: false, updatedAt: now(),
  materials: [
    { id: "m1", amount: 46.52, vendor: "Lowe's", desc: "sand + spacers", receiptId: "photo_a.png", date: "2026-07-03" },
    { id: "m2", amount: 76.57, vendor: "Home Depot", desc: "marble chips", receiptId: null, date: "2026-07-04" },
    { id: "m3", amount: 10.00, vendor: "Excluded", desc: "should NOT show — tagged job-expense on materials", type: "job-expense", date: "2026-07-02" }
  ],
  expenses: [
    { id: "e1", amount: 999.00, vendor: "Internal", desc: "internal dump fee — MUST be excluded", date: "2026-07-01" },
    { id: "e2", amount: 30.00, vendor: "Sunbelt", desc: "pass-through rental", type: "pass-through", receiptId: "photo_r.png", date: "2026-07-06" }
  ]
});

var mrEmptyJobId = "job_matrep_empty";
D().jobs.push({ id: mrEmptyJobId, title: "No-materials job", date: "2026-07-05", customerId: mrCustId, deleted: false, updatedAt: now(), materials: [], expenses: [{ id: "x1", amount: 50, desc: "internal only", date: "2026-07-01" }] });

var jFull = D().jobs.find(function (x) { return x.id === mrJobId; });
var jEmpty = D().jobs.find(function (x) { return x.id === mrEmptyJobId; });

// ---- 1) collection: ONLY pass-through (m1, m2, e2) — never m3 (job-expense) or e1 (internal) ----
if (typeof jobPassThroughItems !== "function") __errs.push("js/106 jobPassThroughItems not defined");
var items = jobPassThroughItems(jFull);
var ids = items.map(function (i) { return i.id; });
if (items.length !== 3) __errs.push("expected 3 pass-through items, got " + items.length + " [" + ids.join(",") + "]");
if (ids.indexOf("m3") >= 0) __errs.push("m3 (job-expense on materials) leaked into the customer report");
if (ids.indexOf("e1") >= 0) __errs.push("e1 (internal job-expense) leaked into the customer report");
if (ids.indexOf("m1") < 0 || ids.indexOf("m2") < 0 || ids.indexOf("e2") < 0) __errs.push("a real pass-through item is missing: " + ids.join(","));

// sorted by date (m1 07-03, m2 07-04, e2 07-06)
if (!(ids[0] === "m1" && ids[1] === "m2" && ids[2] === "e2")) __errs.push("items not date-sorted: " + ids.join(","));

// ---- 2) total = ONLY the pass-through sum (46.52 + 76.57 + 30 = 153.09), never the internal $999 ----
var tot = jobPassThroughTotal(jFull);
if (Math.abs(tot - 153.09) > 0.001) __errs.push("total wrong: expected 153.09, got " + tot);

// ---- 3) report HTML embeds the receipt image URLs for items WITH photos, excludes internal, has total ----
var html = jobMaterialsReportHTML(jFull);
var urlA = (typeof jsUploadUrl === "function") ? jsUploadUrl("photo_a.png") : "photo_a.png";
var urlR = (typeof jsUploadUrl === "function") ? jsUploadUrl("photo_r.png") : "photo_r.png";
if (html.indexOf(urlA) < 0) __errs.push("report missing receipt image URL for photo_a.png");
if (html.indexOf(urlR) < 0) __errs.push("report missing receipt image URL for pass-through rental photo_r.png");
if (html.indexOf("internal dump fee") >= 0) __errs.push("report EXPOSED an internal job-expense to the customer");
if (html.indexOf("should NOT show") >= 0) __errs.push("report EXPOSED a job-expense-tagged material to the customer");
if (html.indexOf("Test Customer LLC") < 0) __errs.push("report missing customer name");
if (html.indexOf("123 Beach Rd") < 0) __errs.push("report missing customer address");
if (html.indexOf("window.print()") < 0) __errs.push("report missing the Print / Save-as-PDF button");
if (html.indexOf("@media print") < 0) __errs.push("report missing @media print (button hides in print)");
if (html.indexOf("OBX Lot Solutions") < 0) __errs.push("report missing BIZ branding");

// ---- 4) button visibility: owner/admin + has pass-through → button; empty job → no button; never throws ----
if (!jobHasPassThrough(jFull)) __errs.push("jobHasPassThrough false on a job that HAS pass-through");
if (jobHasPassThrough(jEmpty)) __errs.push("jobHasPassThrough true on a job with NO pass-through");

window.JOB_OPEN = mrJobId; TAB = "schedule"; render();
var fullHtml = (document.getElementById("view") || {}).innerHTML || "";
if (fullHtml.indexOf("jobMaterialsReport('" + mrJobId + "')") < 0) __errs.push("materials-report button did NOT render on a job with pass-through (owner)");

window.JOB_OPEN = mrEmptyJobId; render();
var emptyHtml = (document.getElementById("view") || {}).innerHTML || "";
if (emptyHtml.indexOf("jobMaterialsReport(") >= 0) __errs.push("materials-report button rendered on a job with NO pass-through");

// ---- 5) crew (not finCanView) → no button on the SAME job ----
if (typeof orgSetRole === "function") {
  orgSetRole("u_matrep_test", "obx", "crew");
  window.JOB_OPEN = mrJobId; render();
  var crewHtml = (document.getElementById("view") || {}).innerHTML || "";
  if (typeof finCanView === "function" && !finCanView() && crewHtml.indexOf("jobMaterialsReport(") >= 0) __errs.push("materials-report button shown to a non-finance (crew) viewer");
  orgSetRole("u_matrep_test", "obx", "owner");
}

diag("materials-report: " + items.length + " pass-through items, total $" + tot.toFixed(2) + ", receipts embedded, button gated ✓");
