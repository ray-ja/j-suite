/* Receipts overhaul — data-layer unit tests (DOM-free).
 * Loads js/72-receipts.js + js/87-receipt-edit.js under lightweight stubs and asserts the model:
 *   - mass upload creates N "needs review" receipts, and a busy batch can't double-create (dup guard)
 *   - the table sorts by every column (asc/desc toggle)
 *   - editing a receipt updates it IN PLACE (no id churn) and re-buckets billing when type/job changes
 *   - a pass-through receipt assigned to a job lands in that job's job.materials[] (its billable/invoice total)
 *   - crew see receipts uploaded-by / attributed-to / reimbursed-to THEM, never others'
 * Run: node receipts-tests.js  →  expect all passed, 0 failed. */

const fs = require("fs");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } }

/* ---- lightweight browser/global stubs ---- */
global.window = global;
global.document = { getElementById: function () { return null; } };
let STORE;
function resetStore() { STORE = { jobs: [{ id: "j1", title: "Paver patio", customerId: "c1", materials: [], expenses: [] }, { id: "j2", title: "Junk haul", customerId: "c2", materials: [], expenses: [] }], expenses: [], receipts: [], customers: [{ id: "c1", name: "Smith" }, { id: "c2", name: "Jones" }] }; }
resetStore();
global.D = function () { return STORE; };
global.now = function () { return Date.now(); };
let _n = 0; global.uid = function () { return "id_" + (++_n); };
global.today = function () { return "2026-07-01"; };
global.actJ = function () { return STORE.jobs.filter(j => !j.deleted); };
global.custName = function (id) { const c = STORE.customers.find(x => x.id === id); return c ? c.name : "—"; };
global.userName = function (id) { return ({ u_ray: "Ray", u_chase: "Chase", u_pierce: "Pierce" })[id] || id; };
global.schedMembers = function () { return [{ id: "u_chase", username: "Chase" }, { id: "u_pierce", username: "Pierce" }]; };
let CURUSER = { id: "u_ray", username: "Ray" };
global.curUser = function () { return CURUSER; };
global.finCanView = function () { return true; };
global.isOwner = function () { return true; };
global.touch = function (r) { r.updatedAt = Date.now(); return r; };
global.save = function () {};
global.render = function () {};
global.logChange = function () {};
global.alert = function () {};
global.confirm = function () { return true; };
global.esc = function (s) { return String(s == null ? "" : s); };
global.money = function (n) { return "$" + Math.round(n); };
global.fmtDate = function (d) { return d; };
global.jsUploadUrl = function (id) { return id ? "/uploads/" + id : ""; };
global.jsUpload = function () { return Promise.resolve("blob_" + (++_n)); };   // overridden per-test

const code = fs.readFileSync(__dirname + "/js/72-receipts.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/87-receipt-edit.js", "utf8");
try { eval(code); } catch (e) { console.log("FATAL eval error: " + (e && e.stack || e)); process.exit(1); }

/* helper: push a fully-attributed record straight into a home (simulate an already-filed receipt) */
function seedReview(fields) { const r = rcptNewReview(fields.receiptId || "blob"); Object.assign(r, fields); STORE.receipts.push(r); return r; }

async function main() {
  console.log("\n— review-record shape —");
  resetStore();
  const rev = rcptNewReview("blobA");
  ok("rcptNewReview → status 'review'", rev.status === "review", rev.status);
  ok("rcptNewReview → type null (unattributed)", rev.type === null);
  ok("rcptNewReview → attributedTo defaults to uploader", rev.attributedTo === "u_ray" && rev.uploadedBy === "u_ray");
  ok("rcptNewReview → carries the photo id", rev.receiptId === "blobA");

  console.log("— MASS UPLOAD: N photos → N review receipts —");
  resetStore();
  global.jsUpload = function () { return Promise.resolve("blob_" + (++_n)); };
  const f = { type: "image/jpeg", name: "r.jpg" };
  rcptUploadFiles([f, f, f]);
  await new Promise(r => setTimeout(r, 30));
  ok("3 photos create 3 review receipts", rcptReview().length === 3, rcptReview().length);

  console.log("— MASS UPLOAD dup-guard: a busy batch can't double-create —");
  resetStore();
  let releasers = [];
  global.jsUpload = function () { return new Promise(res => { releasers.push(() => res("blob_" + (++_n))); }); };
  rcptUploadFiles([f, f]);           // batch 1: 2 in flight, sets busy
  rcptUploadFiles([f, f, f]);        // batch 2 while busy → must be ignored
  releasers.forEach(fn => fn());
  await new Promise(r => setTimeout(r, 30));
  ok("second batch ignored while first in flight (only 2 created, not 5)", rcptReview().length === 2, rcptReview().length);
  global.jsUpload = function () { return Promise.resolve("blob_" + (++_n)); };

  console.log("— SORT: every column, asc/desc toggle —");
  resetStore();
  seedReview({ receiptId: "b1", vendor: "Zeus", amount: 30, date: "2026-06-01", ts: 100 });
  seedReview({ receiptId: "b2", vendor: "Apex", amount: 200, date: "2026-06-10", ts: 200 });
  seedReview({ receiptId: "b3", vendor: "Mid", amount: 90, date: "2026-06-05", ts: 300 });
  RCPT_FILTER = "all";
  rcptSortBy("vendor");   // → asc
  let r = rcptSortedRows();
  ok("sort by vendor asc", r.map(x => x.vendor).join(",") === "Apex,Mid,Zeus", r.map(x => x.vendor));
  rcptSortBy("vendor");   // → desc
  r = rcptSortedRows();
  ok("sort by vendor desc (toggle)", r.map(x => x.vendor).join(",") === "Zeus,Mid,Apex", r.map(x => x.vendor));
  rcptSortBy("amount");   // amount defaults desc
  r = rcptSortedRows();
  ok("sort by amount desc", r.map(x => x.amount).join(",") === "200,90,30", r.map(x => x.amount));
  rcptSortBy("amount");   // → asc
  r = rcptSortedRows();
  ok("sort by amount asc (toggle)", r.map(x => x.amount).join(",") === "30,90,200", r.map(x => x.amount));
  rcptSortBy("date");     // date defaults desc
  r = rcptSortedRows();
  ok("sort by date desc", r.map(x => x.date).join(",") === "2026-06-10,2026-06-05,2026-06-01", r.map(x => x.date));

  console.log("— EDIT IN PLACE: no id churn when the home doesn't change —");
  resetStore();
  const e1 = seedReview({ receiptId: "b1", vendor: "old", amount: 10 });
  const res1 = rcptApplyEdit({ store: "review", jobId: null, recId: e1.id }, { type: null, jobId: null, amount: 12, vendor: "new", desc: "d", receiptId: "b1" });
  ok("stays in review, same id (no delete-remake)", res1.ok && res1.newLoc.store === "review" && res1.newLoc.recId === e1.id, res1);
  ok("fields updated in place", rcptReview()[0].vendor === "new" && rcptReview()[0].amount === 12 && rcptReview().length === 1);

  console.log("— RE-BUCKET: review → pass-through → job.materials (billed to customer) —");
  resetStore();
  const e2 = seedReview({ receiptId: "b1", vendor: "Depot", amount: 150 });
  const res2 = rcptApplyEdit({ store: "review", jobId: null, recId: e2.id }, { type: "pass-through", jobId: "j1", amount: 150, vendor: "Depot", desc: "pavers", receiptId: "b1" });
  ok("moved to job.materials, id preserved", res2.ok && res2.newLoc.store === "jobmat" && res2.newLoc.recId === e2.id, res2);
  ok("review queue emptied", rcptReview().length === 0);
  const matTotal = STORE.jobs[0].materials.filter(m => !m.deleted).reduce((s, m) => s + (+m.amount || 0), 0);
  ok("pass-through appears in the job's billable total (job.materials sum = 150)", matTotal === 150, matTotal);
  ok("landed on the RIGHT job (j1)", STORE.jobs[0].materials.length === 1 && STORE.jobs[1].materials.length === 0);

  console.log("— RE-BUCKET: pass-through(j1) → job-expense(j2) moves between arrays, id kept —");
  const filedId = STORE.jobs[0].materials[0].id;
  const res3 = rcptApplyEdit({ store: "jobmat", jobId: "j1", recId: filedId }, { type: "job-expense", jobId: "j2", amount: 150, vendor: "Depot", desc: "pavers", receiptId: "b1" });
  ok("moved j1.materials → j2.expenses, same id", res3.ok && res3.newLoc.store === "jobexp" && res3.newLoc.recId === filedId, res3);
  ok("old j1.materials tombstoned (not double-counted)", STORE.jobs[0].materials.filter(m => !m.deleted).length === 0);
  ok("now in j2.expenses", STORE.jobs[1].expenses.filter(x => !x.deleted).length === 1 && STORE.jobs[1].expenses[0].amount === 150);

  console.log("— RE-BUCKET: job-expense → business expense (org expenses[]) —");
  const res4 = rcptApplyEdit({ store: "jobexp", jobId: "j2", recId: filedId }, { type: "business", jobId: null, amount: 150, vendor: "Depot", desc: "pavers", category: "materials", receiptId: "b1" });
  ok("moved to org expenses[] as a business expense, id kept", res4.ok && res4.newLoc.store === "biz" && res4.newLoc.recId === filedId, res4);
  ok("business expense has a date (feeds Finance month buckets)", STORE.expenses[0].date && STORE.expenses[0].category === "materials");
  ok("j2.expenses tombstoned", STORE.jobs[1].expenses.filter(x => !x.deleted).length === 0);

  console.log("— RE-BUCKET back to review (un-file) —");
  const res5 = rcptApplyEdit({ store: "biz", jobId: null, recId: filedId }, { type: null, jobId: null, amount: 150, vendor: "Depot", receiptId: "b1" });
  ok("business → review, id kept", res5.ok && res5.newLoc.store === "review" && res5.newLoc.recId === filedId);
  ok("back in the review queue, old biz record tombstoned", rcptReview().length === 1 && STORE.expenses.filter(x => !x.deleted).length === 0);

  console.log("— paidBy change clears a stale reimbursement settlement —");
  resetStore();
  const e6 = seedReview({ receiptId: "b1", vendor: "Gas", amount: 40, paidBy: "u_chase", reimbursedAt: 12345, status: "review" });
  const res6 = rcptApplyEdit({ store: "review", jobId: null, recId: e6.id }, { type: null, jobId: null, amount: 40, vendor: "Gas", paidBy: "u_pierce", receiptId: "b1" });
  ok("changing payer drops the old reimbursedAt", res6.ok && !("reimbursedAt" in rcptReview()[0]), rcptReview()[0]);

  console.log("— CREW view filter: mine = uploaded-by / attributed-to / reimbursed-to me —");
  resetStore();
  seedReview({ receiptId: "b1", uploadedBy: "u_chase", attributedTo: "u_chase" });     // Chase's own upload
  seedReview({ receiptId: "b2", uploadedBy: "u_ray", attributedTo: "u_chase" });        // owner uploaded, attributed to Chase
  seedReview({ receiptId: "b3", uploadedBy: "u_ray", attributedTo: "u_ray", paidBy: "u_chase" }); // reimburses Chase
  seedReview({ receiptId: "b4", uploadedBy: "u_pierce", attributedTo: "u_pierce" });     // Pierce's — NOT Chase's
  const rows = rcptAllRows();
  const chaseRows = rows.filter(x => rcptIsMine(x, "u_chase"));
  ok("Chase sees his upload + attributed-to-him + reimbursed-to-him (3)", chaseRows.length === 3, chaseRows.map(x => x.receiptId));
  ok("Chase does NOT see Pierce's receipt", !chaseRows.some(x => x.receiptId === "b4"));
  const pierceRows = rows.filter(x => rcptIsMine(x, "u_pierce"));
  ok("Pierce sees only his own (1)", pierceRows.length === 1 && pierceRows[0].receiptId === "b4", pierceRows.map(x => x.receiptId));

  console.log("— Cap suggestion is preserved through an in-place review edit (approve-in-edit hook) —");
  resetStore();
  const e7 = seedReview({ receiptId: "b1", suggested: { vendor: "Depot", amount: 99, type: "pass-through", confidence: 0.8 } });
  rcptApplyEdit({ store: "review", jobId: null, recId: e7.id }, { type: null, jobId: null, vendor: "", receiptId: "b1" });
  ok("suggested survives editing while unfiled", rcptReview()[0].suggested && rcptReview()[0].suggested.amount === 99, rcptReview()[0].suggested);

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main();
