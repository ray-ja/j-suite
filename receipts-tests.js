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
global.toast = function () {};
global.pad2 = function (n) { return String(n).padStart(2, "0"); };
/* minimal synchronous FileReader stub so rcptCsvHandle (js/93) can be exercised headless — a fake file carries
   its text on __text; readAsText fires onload immediately. */
global.FileReader = function () { this.readAsText = function (file) { this.result = (file && file.__text != null) ? file.__text : String(file || ""); if (this.onload) this.onload(); }; };

/* stubs for the Cap auto-categorize client module (js/88) — org-AI plumbing lives in js/75 (not loaded here) */
global.orgAiBase = function () { return "http://x"; };
global.orgAiHeaders = function () { return { "Content-Type": "application/json" }; };
global.S = { biz: "obx" };
let CAP_FETCH = null;   // per-test mock; capRcptRead uses global.fetch
global.fetch = function (url, opts) { return CAP_FETCH ? CAP_FETCH(url, opts) : Promise.reject(new Error("no mock")); };

const code = fs.readFileSync(__dirname + "/js/72-receipts.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/87-receipt-edit.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/88-cap-receipts.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/52-job-pl.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/92-receipt-split.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/80-budget-csv.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/93-receipt-csv.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/94-card-attribution.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/95-job-po.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/96-rental-deposits.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/98-receipt-spine.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/100-job-receipt.js", "utf8");

/* js/98 spine leans on js/38 tcOpenShift (clocked-in job). Not loaded here — a configurable stub. */
let OPEN_SHIFT = null;   // per-test: {userId, jobId}
global.tcOpenShift = function (userId) { return (OPEN_SHIFT && OPEN_SHIFT.userId === userId) ? OPEN_SHIFT : null; };

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

  // ========================= FLAT-VALUE RECEIPT SPLITTING (js/92) =========================
  console.log("\n— SPLIT: $200 receipt → 🧱 $120 pass-through (job) + 🔧 $80 business tool —");
  resetStore();
  const sp = seedReview({ receiptId: "bSplit", vendor: "Home Depot", amount: 200, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const spRes = rcptApplySplit(
    { store: "review", jobId: null, recId: sp.id }, 200,
    [ { amount: 120, type: "pass-through", jobId: "j1", category: "", desc: "pavers" },
      { amount: 80, type: "business", jobId: null, category: "tools/equipment", desc: "wet saw" } ],
    { vendor: "Home Depot", date: "2026-07-01", paidBy: null, attributedTo: "u_ray", category: "", desc: "", receiptId: "bSplit" });
  ok("split ok → 2 new locations", spRes.ok && spRes.newLocs.length === 2, spRes);
  ok("original review record consumed (queue empty)", rcptReview().length === 0, rcptReview().length);
  const spMat = STORE.jobs[0].materials.filter(m => !m.deleted);
  const spBiz = STORE.expenses.filter(e => !e.deleted);
  ok("🧱 $120 pass-through landed in j1.materials", spMat.length === 1 && spMat[0].amount === 120, spMat);
  ok("🔧 $80 tool landed in org expenses[] w/ category tools/equipment", spBiz.length === 1 && spBiz[0].amount === 80 && spBiz[0].category === "tools/equipment", spBiz);
  ok("Σ of the 2 slices == the receipt total (200)", (spMat.reduce((s, m) => s + m.amount, 0) + spBiz.reduce((s, e) => s + e.amount, 0)) === 200);
  const sg = spMat[0].splitGroup;
  ok("both slices share the SAME splitGroup", !!sg && spBiz[0].splitGroup === sg, { mat: spMat[0].splitGroup, biz: spBiz[0].splitGroup });
  ok("both slices share the receiptId (one photo)", spMat[0].receiptId === "bSplit" && spBiz[0].receiptId === "bSplit");
  ok("slice[0] REUSED the original record id (id preserved, not remade)", spMat[0].id === sp.id, { got: spMat[0].id, orig: sp.id });
  // P&L (js/52): the material is a real cost on j1; the tool is overhead, off EVERY job's P&L
  const pj1 = jobProfit(STORE.jobs[0]);
  ok("🧱 material counted in j1 jobProfit cost ($120)", pj1.matCost === 120 && pj1.cost === 120 && pj1.expCost === 0, pj1);
  const pj2 = jobProfit(STORE.jobs[1]);
  ok("🔧 tool EXCLUDED from j2's P&L (off every job)", pj2.matCost === 0 && pj2.expCost === 0 && pj2.cost === 0, pj2);
  ok("🔧 tool is in NO job.expenses/materials array (org overhead only)", STORE.jobs.every(j => (j.expenses || []).concat(j.materials || []).every(x => x.amount !== 80 || x.deleted)));

  console.log("— SPLIT: N==1 is byte-identical to a single route (no splitGroup, same record) —");
  resetStore();
  const nSave = _n;
  const one1 = seedReview({ receiptId: "bOne", vendor: "Depot", amount: 50, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const one1ts = one1.ts;
  rcptApplySplit({ store: "review", jobId: null, recId: one1.id }, 50, [{ amount: 50, type: "pass-through", jobId: "j1", category: "", desc: "" }],
    { vendor: "Depot", date: "2026-07-01", paidBy: null, attributedTo: "u_ray", category: "materials", desc: "sand", receiptId: "bOne" });
  const viaSplit = STORE.jobs[0].materials.filter(m => !m.deleted);
  resetStore();
  _n = nSave;   // reset the uid counter so the review record gets the SAME id → the final records are comparable
  const one2 = seedReview({ receiptId: "bOne", vendor: "Depot", amount: 50, uploadedBy: "u_ray", attributedTo: "u_ray" });
  one2.ts = one1ts;   // same carried ts so the built records match on every meaningful field
  rcptApplyEdit({ store: "review", jobId: null, recId: one2.id }, { type: "pass-through", jobId: "j1", amount: 50, vendor: "Depot", date: "2026-07-01", category: "materials", paidBy: null, attributedTo: "u_ray", desc: "sand", receiptId: "bOne" });
  const viaRoute = STORE.jobs[0].materials.filter(m => !m.deleted);
  const norm = a => { const c = Object.assign({}, a); delete c.updatedAt; return c; };
  ok("N==1 split writes ONE record with NO splitGroup field", viaSplit.length === 1 && !("splitGroup" in viaSplit[0]), viaSplit[0]);
  ok("N==1 split record == the single-route record (byte-identical)", JSON.stringify(norm(viaSplit[0])) === JSON.stringify(norm(viaRoute[0])), { split: norm(viaSplit[0]), route: norm(viaRoute[0]) });

  console.log("— SPLIT validation: over / under / $0 slice / missing job all BLOCK (no records written) —");
  resetStore();
  const v = seedReview({ receiptId: "bV", vendor: "X", amount: 100 });
  const vloc = { store: "review", jobId: null, recId: v.id };
  const vsh = { vendor: "X", date: "", paidBy: null, attributedTo: null, category: "", desc: "", receiptId: "bV" };
  const over = rcptApplySplit(vloc, 100, [{ amount: 70, type: "business" }, { amount: 50, type: "business" }], vsh);
  ok("OVER the total blocks (nothing written, review intact)", !over.ok && /over/i.test(over.error) && STORE.expenses.length === 0 && rcptReview().length === 1, over);
  const under = rcptApplySplit(vloc, 100, [{ amount: 30, type: "business" }, { amount: 40, type: "business" }], vsh);
  ok("UNDER the total blocks (with a 'put the rest' nudge)", !under.ok && /short/i.test(under.error) && STORE.expenses.length === 0, under);
  const zero = rcptApplySplit(vloc, 100, [{ amount: 0, type: "business" }, { amount: 100, type: "business" }], vsh);
  ok("a $0 slice blocks", !zero.ok && STORE.expenses.length === 0, zero);
  const nojob = rcptApplySplit(vloc, 100, [{ amount: 60, type: "pass-through", jobId: null }, { amount: 40, type: "business" }], vsh);
  ok("a 🧱/🚚 slice with no job blocks", !nojob.ok && STORE.expenses.length === 0, nojob);
  const tol = rcptApplySplit(vloc, 100, [{ amount: 33.33, type: "business" }, { amount: 33.33, type: "business" }, { amount: 33.34, type: "business" }], vsh);
  ok("Σ within ±$0.01 is accepted (33.33+33.33+33.34=100.00 → 3 records)", tol.ok && STORE.expenses.filter(e => !e.deleted).length === 3, tol);

  // ========================= UNIFIED JOB RECEIPT (js/100) → rcptApplySplit =========================
  console.log("\n— JOB RECEIPT: jobRcptSeed builds rows from Cap lineItems (+ whole-receipt client fallback) —");
  const seedFull = jobRcptSeed({ amount: 200, lineItems: [{ desc: "pavers", amount: 120, bucket: "pass-through" }, { desc: "wet saw", amount: 80, bucket: "business" }] });
  ok("seed: 2 rows from 2 lineItems, total from suggested.amount", seedFull.rows.length === 2 && seedFull.total === 200 && seedFull.rows[0].bucket === "pass-through" && seedFull.rows[1].bucket === "business", seedFull);
  const seedFallback = jobRcptSeed({ amount: 60, type: "pass-through" });   // NO lineItems → one whole-receipt line
  ok("seed: no lineItems → ONE '(whole receipt)' line at the total", seedFallback.rows.length === 1 && seedFallback.rows[0].desc === "(whole receipt)" && seedFallback.rows[0].amount === "60" && seedFallback.rows[0].bucket === "pass-through", seedFallback);
  const seedNone = jobRcptSeed(null);   // no suggestion at all → one blank line
  ok("seed: no suggestion → one blank line (bucket pass-through)", seedNone.rows.length === 1 && seedNone.rows[0].amount === "" && seedNone.rows[0].bucket === "pass-through", seedNone);
  ok("clampBucket: unknown → pass-through, known preserved", jobRcptClampBucket("junk") === "pass-through" && jobRcptClampBucket("business") === "business" && jobRcptClampBucket("job-expense") === "job-expense");

  console.log("— JOB RECEIPT: a 4-line receipt files as 4 records (🧱×2, 🚚×1, 🔧×1) sharing receiptId + splitGroup —");
  resetStore();
  const jr4 = seedReview({ receiptId: "bJR4", vendor: "Home Depot", amount: 300, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const jr4rows = [
    { desc: "pavers", amount: "120", bucket: "pass-through" },
    { desc: "base rock", amount: "60", bucket: "pass-through" },
    { desc: "dump fee", amount: "40", bucket: "job-expense" },
    { desc: "impact driver", amount: "80", bucket: "business" }
  ];
  const jr4alloc = jobRcptBuildAllocations(jr4rows, "j1");
  ok("buildAllocations: 🔧 business → jobId null + cat tools/equipment; 🚚 → cat job; 🧱 → no cat", jr4alloc[3].jobId === null && jr4alloc[3].category === "tools/equipment" && jr4alloc[2].category === "job" && jr4alloc[0].category === "" && jr4alloc[0].jobId === "j1", jr4alloc);
  const jr4res = rcptApplySplit({ store: "review", jobId: null, recId: jr4.id }, 300, jr4alloc, { vendor: "Home Depot", date: "2026-07-01", paidBy: null, attributedTo: "u_ray", receiptId: "bJR4", cardLast4: "" });
  ok("job receipt split ok → 4 new locations", jr4res.ok && jr4res.newLocs.length === 4, jr4res);
  const jrMat = STORE.jobs[0].materials.filter(m => !m.deleted);
  const jrExp = STORE.jobs[0].expenses.filter(e => !e.deleted);
  const jrBiz = STORE.expenses.filter(e => !e.deleted);
  ok("🧱 ×2 → j1.materials ($120 + $60)", jrMat.length === 2 && jrMat.reduce((s, m) => s + m.amount, 0) === 180, jrMat);
  ok("🚚 ×1 → j1.expenses cat 'job' ($40)", jrExp.length === 1 && jrExp[0].amount === 40 && jrExp[0].category === "job", jrExp);
  ok("🔧 ×1 → org expenses cat 'tools/equipment' ($80), off every job", jrBiz.length === 1 && jrBiz[0].amount === 80 && jrBiz[0].category === "tools/equipment", jrBiz);
  const jrGroup = jrMat[0].splitGroup;
  ok("all 4 share ONE splitGroup + the receiptId (one photo)", !!jrGroup && jrMat.every(m => m.splitGroup === jrGroup) && jrExp[0].splitGroup === jrGroup && jrBiz[0].splitGroup === jrGroup && jrMat.concat(jrExp, jrBiz).every(r => r.receiptId === "bJR4"), { jrGroup });

  console.log("— JOB RECEIPT: byte-identical to a hand Receipts split (same allocations) —");
  resetStore();
  const nSaveJR = _n;
  const jrA = seedReview({ receiptId: "bJRid", vendor: "HD", amount: 100, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const jrAts = jrA.ts;
  const jrShared = { vendor: "HD", date: "2026-07-01", paidBy: null, attributedTo: "u_ray", receiptId: "bJRid", cardLast4: "" };
  const jrAllocs = jobRcptBuildAllocations([{ desc: "rock", amount: "70", bucket: "pass-through" }, { desc: "saw", amount: "30", bucket: "business" }], "j1");
  rcptApplySplit({ store: "review", jobId: null, recId: jrA.id }, 100, jrAllocs, jrShared);
  const viaJob = STORE.jobs[0].materials.filter(m => !m.deleted).concat(STORE.expenses.filter(e => !e.deleted)).map(r => { const c = Object.assign({}, r); delete c.updatedAt; return c; });
  resetStore(); _n = nSaveJR;
  const jrB = seedReview({ receiptId: "bJRid", vendor: "HD", amount: 100, uploadedBy: "u_ray", attributedTo: "u_ray" });
  jrB.ts = jrAts;
  rcptApplySplit({ store: "review", jobId: null, recId: jrB.id }, 100, [{ amount: 70, type: "pass-through", jobId: "j1", category: "", desc: "rock" }, { amount: 30, type: "business", jobId: null, category: "tools/equipment", desc: "saw" }], jrShared);
  const viaHand = STORE.jobs[0].materials.filter(m => !m.deleted).concat(STORE.expenses.filter(e => !e.deleted)).map(r => { const c = Object.assign({}, r); delete c.updatedAt; return c; });
  ok("job-receipt records == a hand Receipts split (byte-identical)", JSON.stringify(viaJob) === JSON.stringify(viaHand), { viaJob, viaHand });

  console.log("— JOB RECEIPT: N==1 (one bucket, no split) = a single record —");
  resetStore();
  const jr1 = seedReview({ receiptId: "bJR1", vendor: "Lowes", amount: 45, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const jr1res = rcptApplySplit({ store: "review", jobId: null, recId: jr1.id }, 45, jobRcptBuildAllocations([{ desc: "base rock", amount: "45", bucket: "pass-through" }], "j1"), { vendor: "Lowes", date: "", paidBy: null, attributedTo: "u_ray", receiptId: "bJR1", cardLast4: "" });
  const jr1mat = STORE.jobs[0].materials.filter(m => !m.deleted);
  ok("N==1 → ONE material record, no splitGroup", jr1res.ok && jr1mat.length === 1 && jr1mat[0].amount === 45 && !("splitGroup" in jr1mat[0]), jr1mat);

  console.log("— JOB RECEIPT: the balance guard blocks an unbalanced set (nothing filed) —");
  resetStore();
  const jrU = seedReview({ receiptId: "bJRU", vendor: "X", amount: 100 });
  const jrUres = rcptApplySplit({ store: "review", jobId: null, recId: jrU.id }, 100, jobRcptBuildAllocations([{ desc: "a", amount: "70", bucket: "business" }, { desc: "b", amount: "40", bucket: "business" }], "j1"), { vendor: "X", receiptId: "bJRU" });
  ok("unbalanced (70+40 over 100) BLOCKS — nothing filed, review intact", !jrUres.ok && STORE.expenses.filter(e => !e.deleted).length === 0 && rcptReview().length === 1, jrUres);

  console.log("— JOB RECEIPT: fault-dock stamps faultMemberId onto the 🚚 job-expense slices only —");
  resetStore();
  const jrF = seedReview({ receiptId: "bJRF", vendor: "HD", amount: 150, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const jrFres = rcptApplySplit({ store: "review", jobId: null, recId: jrF.id }, 150, jobRcptBuildAllocations([{ desc: "rock", amount: "100", bucket: "pass-through" }, { desc: "re-dump (wrong load)", amount: "50", bucket: "job-expense" }], "j1"), { vendor: "HD", receiptId: "bJRF", attributedTo: "u_ray" });
  const stamped = jobRcptStampFault(jrFres.newLocs, "u_chase");
  const jrFexp = STORE.jobs[0].expenses.filter(e => !e.deleted);
  const jrFmat = STORE.jobs[0].materials.filter(m => !m.deleted);
  ok("fault-dock stamped exactly the ONE 🚚 slice", stamped === 1 && jrFexp.length === 1 && jrFexp[0].faultMemberId === "u_chase", { stamped, jrFexp });
  ok("fault-dock did NOT touch the 🧱 material slice", jrFmat.length === 1 && !jrFmat[0].faultMemberId, jrFmat);
  ok("fault-dock is a no-op with no member selected", jobRcptStampFault(jrFres.newLocs, "") === 0);
  ok("the accepted split consumed the original review record", rcptReview().length === 0);

  // ========================= CAP AUTO-CATEGORIZE =========================
  const SS = require("./sync-server.js");
  // RCPT_CATS is `const` inside the eval'd js/72 (block-scoped, doesn't leak) — mirror it here for the server-arg tests
  const CATS = ["materials", "tools/equipment", "disposal", "fuel", "rentals", "subscription/software", "marketing/ads", "uniforms", "office/admin", "other"];
  const JOBIDS = ["j1", "j2"];

  console.log("— server: rcptParseSuggestion returns the EXACT shape the edit modal reads —");
  const parsed = SS.rcptParseSuggestion('{"vendor":"Home Depot","amount":42.5,"date":"2026-06-30","desc":"pavers","type":"pass-through","category":"materials","jobId":"j1","confidence":0.82}', CATS, JOBIDS);
  ok("parsed has every field js/87 reads", parsed && "vendor" in parsed && "amount" in parsed && "type" in parsed && "jobId" in parsed && "category" in parsed && "confidence" in parsed, parsed);
  ok("amount coerced to a number", typeof parsed.amount === "number" && parsed.amount === 42.5, parsed && parsed.amount);
  ok("type kept (valid enum)", parsed.type === "pass-through");
  ok("category clamped to RCPT_CATS", CATS.indexOf(parsed.category) >= 0);
  ok("jobId clamped to a real active job", parsed.jobId === "j1");

  console.log("— server: model wrapping prose + fences is still parsed —");
  const wrapped = SS.rcptParseSuggestion('Here you go:\n```json\n{"vendor":"Dump","amount":73,"type":"job-expense","category":"disposal","confidence":0.6}\n```', CATS, JOBIDS);
  ok("JSON extracted from wrapping prose", wrapped && wrapped.vendor === "Dump" && wrapped.type === "job-expense", wrapped);

  console.log("— server: a MALFORMED reply is skipped (null), never crashes —");
  ok("garbage → null", SS.rcptParseSuggestion("sorry, I can't read this", CATS, JOBIDS) === null);
  ok("empty → null", SS.rcptParseSuggestion("", CATS, JOBIDS) === null);
  ok("half-JSON → null", SS.rcptParseSuggestion('{"vendor":"x", amount:', CATS, JOBIDS) === null);
  ok("bogus type/category/job coerced to safe values, not applied", (function () { const s = SS.rcptParseSuggestion('{"vendor":"X","amount":"nope","type":"delete-everything","category":"hacked","jobId":"j999","confidence":9}', CATS, JOBIDS); return s && s.type === null && s.category === "" && s.jobId === null && s.amount === null && s.confidence === 1; })());

  console.log("— server: rcptOwnedByOrg guards cross-org blob reads —");
  const vstore = { obx: { receipts: [{ receiptId: "mine.jpg" }], jobs: [{ materials: [{ receiptId: "jobmat.jpg" }], expenses: [] }], expenses: [{ receiptId: "biz.jpg" }] }, jam: { receipts: [], jobs: [], expenses: [] } };
  ok("own review blob → true", SS.rcptOwnedByOrg(vstore, "obx", "mine.jpg"));
  ok("own job-material blob → true", SS.rcptOwnedByOrg(vstore, "obx", "jobmat.jpg"));
  ok("own business blob → true", SS.rcptOwnedByOrg(vstore, "obx", "biz.jpg"));
  ok("another org's blob → false", !SS.rcptOwnedByOrg(vstore, "jam", "mine.jpg"));
  ok("unknown blob → false", !SS.rcptOwnedByOrg(vstore, "obx", "nope.jpg"));

  console.log("— client: Cap stamps ONLY `suggested` (never a real field) on a NON-auto-filed (low-confidence) read —");
  resetStore();
  const capRec = seedReview({ receiptId: "cap1.jpg", vendor: "", amount: null, type: null, jobId: null, category: "" });
  const before = JSON.stringify(capRec);
  // confidence 0.5 (< the 0.8 one-tap bar) → NOT auto-filed → stays a review row with ONLY `suggested` stamped
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ suggested: { vendor: "Depot", amount: 88, date: "2026-06-30", desc: "pavers", type: "pass-through", category: "materials", jobId: "j1", confidence: 0.5 } }); } }); };
  global.finCanView = function () { return true; };   // owner/admin
  await capRcptRun();
  const capAfter = rcptReview().find(r => r.id === capRec.id);
  ok("Cap wrote receipt.suggested", capAfter && capAfter.suggested && capAfter.suggested.amount === 88, capAfter && capAfter.suggested);
  ok("suggested is the exact shape the edit modal reads", capAfter.suggested && "vendor" in capAfter.suggested && "amount" in capAfter.suggested && "type" in capAfter.suggested && "jobId" in capAfter.suggested && "category" in capAfter.suggested && "confidence" in capAfter.suggested);
  ok("real fields UNCHANGED (only suggested added — no auto-apply)", capAfter.vendor === "" && capAfter.amount === null && capAfter.type === null && capAfter.jobId === null && capAfter.category === "" && capAfter.status === "review", { v: capAfter.vendor, a: capAfter.amount, t: capAfter.type });
  ok("everything except suggested is byte-identical to before", (function () { const c = Object.assign({}, capAfter); delete c.suggested; delete c.updatedAt; const b = JSON.parse(before); delete b.suggested; delete b.updatedAt; return JSON.stringify(c) === JSON.stringify(b); })());

  console.log("— client: crew (non owner/admin) can NOT trigger Cap —");
  resetStore();
  const crewRec = seedReview({ receiptId: "crew1.jpg" });
  let fetched = false;
  CAP_FETCH = function () { fetched = true; return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ suggested: { vendor: "X", amount: 1, type: "business", category: "other", jobId: null, confidence: 0.5 } }); } }); };
  global.finCanView = function () { return false; };   // crew
  await capRcptRun();
  ok("crew trigger is blocked (no network call, no suggestion written)", !fetched && !rcptReview().find(r => r.id === crewRec.id).suggested);
  global.finCanView = function () { return true; };

  console.log("— client: a malformed/empty AI response does not crash the batch or stamp anything —");
  resetStore();
  const badRec = seedReview({ receiptId: "bad1.jpg" });
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ skip: true, reason: "unparseable" }); } }); };
  await capRcptRun();
  ok("skip reply → no suggested written, no throw", !rcptReview().find(r => r.id === badRec.id).suggested);

  console.log("— client: reread ESCALATES (Opus) vs default & bulk (Sonnet) — client sends only the boolean —");
  resetStore(); global.finCanView = function () { return true; }; global.modal = global.modal || function () {};
  // default read forwards NO escalate flag → server reads on Sonnet 4.6
  let bodyDefault = null;
  CAP_FETCH = function (url, opts) { bodyDefault = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ skip: true }) }); };
  await capRcptRead("d1.jpg");
  ok("capRcptRead(id) default sends NO escalate flag (server → Sonnet 4.6)", bodyDefault && bodyDefault.escalate === undefined, bodyDefault);
  // opts.escalate is forwarded as escalate:true → server reads on Opus 4.8
  let bodyEsc = null;
  CAP_FETCH = function (url, opts) { bodyEsc = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ skip: true }) }); };
  await capRcptRead("d2.jpg", { escalate: true });
  ok("capRcptRead(id,{escalate:true}) forwards escalate:true (server → Opus 4.8)", bodyEsc && bodyEsc.escalate === true, bodyEsc);
  // backward-compatible signature: existing single-arg callers are unchanged
  ok("capRcptRead signature is backward-compatible (opts optional, no escalate by default)", bodyDefault && bodyDefault.escalate === undefined && bodyEsc && bodyEsc.escalate === true, null);
  // capRcptOne (the reread button) escalates on the currently-open receipt
  const oneRec = seedReview({ receiptId: "one1.jpg" });
  global.val = global.val || function () { return ""; };   // rcptEditOpen → rcptEditTypeChange reads form fields
  rcptEditOpen("review", null, oneRec.id);   // sets RCPT_EDIT to this receipt
  let bodyOne = null;
  CAP_FETCH = function (url, opts) { bodyOne = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ skip: true }) }); };
  await capRcptOne();
  ok("capRcptOne (reread button) escalates → escalate:true on THIS receipt", bodyOne && bodyOne.escalate === true && bodyOne.receiptId === "one1.jpg", bodyOne);
  // the bulk auto-read queue stays on the default (never escalates)
  resetStore(); _capRcptSkip = {}; global.finCanView = function () { return true; };
  seedReview({ receiptId: "bulk1.jpg" });
  let bulkBody = null;
  CAP_FETCH = function (url, opts) { bulkBody = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: { vendor: "V", amount: 1, type: "business", category: "other", jobId: null, confidence: 0.9 } }) }); };
  await capRcptRun({ auto: true });
  ok("bulk auto-read does NOT escalate (stays on the default Sonnet read)", bulkBody && bulkBody.escalate === undefined, bulkBody);

  // ===================== UNCAPPED / RESUMABLE ONE-AT-A-TIME QUEUE =====================
  console.log("— QUEUE: a large batch drains FULLY, strictly one vision call in flight at a time —");
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; global.finCanView = function () { return true; };
  window.CAP_RCPT_THROTTLE_MS = 0;                 // no inter-read pause in the test
  const BIG = 30; for (let i = 0; i < BIG; i++) seedReview({ receiptId: "big" + i + ".jpg" });
  let inFlight = 0, maxInFlight = 0, reads = 0;
  CAP_FETCH = function () {
    inFlight++; reads++; if (inFlight > maxInFlight) maxInFlight = inFlight;
    return new Promise(res => setTimeout(() => { inFlight--; res({ ok: true, json: () => Promise.resolve({ suggested: { vendor: "V", amount: 5, date: "2026-06-01", desc: "d", type: "business", category: "other", jobId: null, confidence: 0.7 } }) }); }, 0));   // 0.7 < one-tap bar → stays in review (this test isolates DRAIN mechanics, not the auto-file gate)
  };
  await capRcptRun({ auto: true });
  ok("all " + BIG + " receipts were read (past the old cap of 15) — none silently skipped", reads === BIG, reads);
  ok("every receipt got a Cap suggestion", rcptReview().filter(r => r.suggested).length === BIG, rcptReview().filter(r => r.suggested).length);
  ok("STRICTLY sequential — never more than 1 vision call in flight", maxInFlight === 1, maxInFlight);
  ok("queue fully drained — 0 unread pending remain", capRcptPending().length === 0, capRcptPending().length);

  console.log("— QUEUE: an unreadable receipt is skipped ONCE and never loops the drain —");
  resetStore(); _capRcptSkip = {}; global.finCanView = function () { return true; };
  seedReview({ receiptId: "good.jpg" }); const stuck = seedReview({ receiptId: "stuck.jpg" });
  let stuckReads = 0;
  CAP_FETCH = function (url, opts) {
    const body = JSON.parse(opts.body);
    if (body.receiptId === "stuck.jpg") { stuckReads++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ skip: true, reason: "blurry" }) }); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: { vendor: "V", amount: 1, type: "business", category: "other", jobId: null, confidence: 0.7 } }) });   // 0.7 → stays in review (drain-mechanics test)
  };
  await capRcptRun({ auto: true });
  ok("drain terminated (did not loop on the unreadable one)", stuckReads === 1, stuckReads);
  ok("the readable one still got read past the stuck one", rcptReview().find(r => r.id !== stuck.id && r.receiptId === "good.jpg").suggested, true);

  console.log("— QUEUE: the busy flag blocks a SECOND drain launched while the first is in flight —");
  resetStore(); global.finCanView = function () { return true; };
  seedReview({ receiptId: "b0.jpg" }); seedReview({ receiptId: "b1.jpg" });
  let busyReads = 0;
  CAP_FETCH = function () { busyReads++; return new Promise(res => setTimeout(() => res({ ok: true, json: () => Promise.resolve({ suggested: { vendor: "V", amount: 1, type: "business", category: "other", jobId: null, confidence: 0.9 } }) }), 0)); };
  const p1 = capRcptRun({ auto: true });          // drain #1: sets _capRcptBusy, fires read #1, yields at the await
  const p2 = capRcptRun({ auto: true });          // drain #2: launched while #1 is in flight → must no-op on the busy flag
  await Promise.all([p1, p2]);
  ok("busy flag blocks the concurrent drain (2 receipts read once total, not 4)", busyReads === 2, busyReads);

  console.log("— RESUMABLE SWEEP: leftover unread receipts get read on a simulated re-open —");
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; global.finCanView = function () { return true; };
  for (let i = 0; i < 5; i++) seedReview({ receiptId: "left" + i + ".jpg" });
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: { vendor: "V", amount: 2, type: "business", category: "other", jobId: null, confidence: 0.7 } }) }); };   // 0.7 → stays in review (sweep-mechanics test)
  capRcptSweep();                                  // fire-and-forget (as js/26 does on the boot pull / after sync)
  await new Promise(r => setTimeout(r, 60));       // let the drain complete
  ok("sweep drained all 5 leftover receipts", capRcptPending().length === 0 && rcptReview().filter(r => r.suggested).length === 5, rcptReview().filter(r => r.suggested).length);

  console.log("— RESUMABLE SWEEP: crew (non owner/admin) sweep is a silent no-op —");
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0;
  seedReview({ receiptId: "crewsweep.jpg" });
  let crewSweepReads = 0; CAP_FETCH = function () { crewSweepReads++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: {} }) }); };
  global.finCanView = function () { return false; };   // crew
  capRcptSweep(); await new Promise(r => setTimeout(r, 30));
  ok("crew sweep fires no vision call", crewSweepReads === 0, crewSweepReads);
  global.finCanView = function () { return true; };

  console.log("— RESUMABLE SWEEP: no-op when there are 0 unread —");
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0;
  let emptyReads = 0; CAP_FETCH = function () { emptyReads++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: {} }) }); };
  capRcptSweep(); await new Promise(r => setTimeout(r, 20));
  ok("empty pile → no vision call", emptyReads === 0, emptyReads);
  delete window.CAP_RCPT_THROTTLE_MS;

  // ========================= PER-JOB RECEIPT CLOSE-OUT =========================
  console.log("— close-out: helpers tolerate a legacy job with no receiptsClosedBy —");
  resetStore();
  ok("jobReceiptsClosedBy([]) on a legacy job → empty, no throw", jobReceiptsClosedBy(STORE.jobs[0]).length === 0);
  ok("jobReceiptsClosedByMe → false on legacy job", jobReceiptsClosedByMe(STORE.jobs[0], "u_chase") === false);
  ok("jobReceiptsFullyClosed → false when no crew assigned (no false ready signal)", jobReceiptsFullyClosed(STORE.jobs[0]) === false);

  console.log("— close-out: a crew member closes their OWN status, idempotently —");
  resetStore();
  STORE.jobs[0].crew = ["u_chase", "u_pierce"];
  CURUSER = { id: "u_chase", username: "Chase" };
  jobCloseReceipts("j1");
  ok("Chase is now in receiptsClosedBy", jobReceiptsClosedByMe(STORE.jobs[0], "u_chase"), STORE.jobs[0].receiptsClosedBy);
  ok("entry carries {userId, ts}", STORE.jobs[0].receiptsClosedBy[0].userId === "u_chase" && typeof STORE.jobs[0].receiptsClosedBy[0].ts === "number");
  jobCloseReceipts("j1");   // close again
  ok("closing again is idempotent (no duplicate entry)", STORE.jobs[0].receiptsClosedBy.filter(x => x.userId === "u_chase").length === 1, STORE.jobs[0].receiptsClosedBy);

  console.log("— close-out: a crew member can NOT close/reopen for someone else —");
  ok("Chase closing did NOT add Pierce", !jobReceiptsClosedByMe(STORE.jobs[0], "u_pierce"));
  // reopen is scoped to self: Chase reopening leaves any other member's close-out untouched
  STORE.jobs[0].receiptsClosedBy.push({ userId: "u_pierce", ts: 111 });   // simulate Pierce having closed
  CURUSER = { id: "u_chase", username: "Chase" };
  jobReopenReceipts("j1");
  ok("Chase's reopen removed ONLY Chase", !jobReceiptsClosedByMe(STORE.jobs[0], "u_chase") && jobReceiptsClosedByMe(STORE.jobs[0], "u_pierce"), STORE.jobs[0].receiptsClosedBy);

  console.log("— close-out: fullyClosed true ONLY when every active crew member has closed —");
  resetStore();
  STORE.jobs[0].crew = ["u_chase", "u_pierce"];
  STORE.jobs[0].receiptsClosedBy = [];
  CURUSER = { id: "u_chase", username: "Chase" };
  jobCloseReceipts("j1");
  ok("1 of 2 closed → NOT fully closed", jobReceiptsFullyClosed(STORE.jobs[0]) === false);
  ok("open crew list = [Pierce]", jobReceiptsOpenCrew(STORE.jobs[0]).join(",") === "u_pierce", jobReceiptsOpenCrew(STORE.jobs[0]));
  CURUSER = { id: "u_pierce", username: "Pierce" };
  jobCloseReceipts("j1");
  ok("both closed → fully closed (ready to invoice)", jobReceiptsFullyClosed(STORE.jobs[0]) === true);
  ok("open crew list now empty", jobReceiptsOpenCrew(STORE.jobs[0]).length === 0);
  // reopening drops it back below the bar
  jobReopenReceipts("j1");
  ok("Pierce reopens → no longer fully closed", jobReceiptsFullyClosed(STORE.jobs[0]) === false);

  console.log("— close-out: an inactive/removed crew id can't block 'fully closed' —");
  resetStore();
  STORE.jobs[0].crew = ["u_chase", "u_ghost"];   // u_ghost is not in schedMembers() (inactive/removed)
  STORE.jobs[0].receiptsClosedBy = [{ userId: "u_chase", ts: 1 }];
  ok("only active crew (Chase) counts → fully closed", jobReceiptsFullyClosed(STORE.jobs[0]) === true, jobCrewActiveIds(STORE.jobs[0]));

  console.log("— close-out queue: jobs the crew WORKED (crew / receipt / timeclock) —");
  resetStore();
  STORE.jobs[0].crew = ["u_chase"];                                   // on the crew
  STORE.jobs[1].materials.push({ id: "m1", amount: 5, attributedTo: "u_chase" });   // has a receipt attributed to them
  STORE.timeclock = [{ id: "t1", userId: "u_chase", jobId: "j1", clockIn: 1 }];
  const worked = rcptWorkedJobsForMe("u_chase").map(j => j.id).sort();
  ok("worked union includes both j1 (crew+clock) and j2 (receipt)", worked.join(",") === "j1,j2", worked);
  ok("Pierce (no crew/receipt/clock) has an empty queue", rcptWorkedJobsForMe("u_pierce").length === 0);

  // ========================= CSV RECEIPT IMPORT (js/93) =========================
  const LOWES_CSV =
    "Order Date,Item Description,Unit Price,Quantity,Line Total,Store,Order #\r\n" +
    "2026-06-30,Quikrete 60lb Concrete Mix,6.98,4,27.92,Lowe's Kitty Hawk,123456\r\n" +
    "2026-06-30,\"Paver, Holland 6x9 Red\",0.98,200,196.00,Lowe's Kitty Hawk,123456\r\n" +
    "2026-06-30,Sales Tax,,,15.34,Lowe's Kitty Hawk,123456\r\n" +
    "2026-06-30,Order Total,,,239.26,Lowe's Kitty Hawk,123456\r\n" +
    "2026-05-01,Landscape Fabric 3x50,18.98,2,37.96,Lowe's Nags Head,999888\r\n";

  console.log("\n— CSV auto-map: header detected, amount = LINE total (not unit price) —");
  const csvRows = budgetParseCSV(LOWES_CSV);
  const am = rcptCsvAutoMap(csvRows);
  ok("header row detected", am.hasHeader === true);
  ok("amount → 'Line Total' col (index 4), NOT 'Unit Price'", am.map.amount === 4, am.map);
  ok("date → 'Order Date' (0)", am.map.date === 0, am.map);
  ok("desc → 'Item Description' (1)", am.map.desc === 1, am.map);
  ok("store → 'Store' (5)", am.map.store === 5, am.map);
  ok("order # → 'Order #' (6)", am.map.order === 6, am.map);

  console.log("— CSV parse → one review record per line item, junk rows skipped + counted —");
  resetStore();
  CURUSER = { id: "u_ray", username: "Ray" };
  rcptCsvHandle({ name: "lowes-history.csv", __text: LOWES_CSV });   // FileReader stub → rcptCsvStart → preview built
  ok("RCSV session parsed 3 line items", RCSV && RCSV.parsed.length === 3, RCSV && RCSV.parsed.length);
  ok("2 junk rows (Sales Tax + Order Total) skipped + counted", RCSV && RCSV.skipped === 2, RCSV && RCSV.skipped);
  ok("amounts parsed from LINE total (27.92 / 196 / 37.96)", RCSV && RCSV.parsed.map(p => p.rec.amount).sort((a, b) => a - b).join(",") === "27.92,37.96,196", RCSV && RCSV.parsed.map(p => p.rec.amount));
  ok("dates parsed (2× 2026-06-30, 1× 2026-05-01)", RCSV && RCSV.parsed.filter(p => p.rec.date === "2026-06-30").length === 2 && RCSV.parsed.some(p => p.rec.date === "2026-05-01"));
  ok("desc carries item + order #", RCSV && RCSV.parsed.some(p => /Quikrete/.test(p.rec.desc) && /order #123456/.test(p.rec.desc)), RCSV && RCSV.parsed[0].rec.desc);
  ok("per-row store detected as vendor", RCSV && RCSV.parsed.every(p => /Lowe's/.test(p.store) && /Lowe's/.test(p.rec.vendor)));
  ok("Vendor-for-all default = most-common store", RCSV && RCSV.detStore === "Lowe's Kitty Hawk", RCSV && RCSV.detStore);

  // ---- P&L INVARIANCE: snapshot every finance-relevant total BEFORE commit ----
  const plSnap = () => JSON.stringify({
    mat: STORE.jobs.reduce((s, j) => s + (j.materials || []).filter(x => !x.deleted).reduce((a, x) => a + (+x.amount || 0), 0), 0),
    exp: STORE.jobs.reduce((s, j) => s + (j.expenses || []).filter(x => !x.deleted).reduce((a, x) => a + (+x.amount || 0), 0), 0),
    biz: (STORE.expenses || []).filter(x => !x.deleted).reduce((a, x) => a + (+x.amount || 0), 0),
    prof: STORE.jobs.map(j => jobProfit(j))
  });
  const beforePL = plSnap();

  console.log("— CSV commit → N review records land in receipts[], receiptId:null / status:review —");
  rcptCsvCommit();   // headless: no checkboxes → keeps all parsed rows, vendor input null → per-row store
  const imported = rcptReview().filter(r => r.source === "csv");
  ok("3 review records committed", imported.length === 3, imported.length);
  ok("every imported record is receiptId:null (photo-less)", imported.every(r => r.receiptId === null));
  ok("every imported record is status:review, type:null (not billing)", imported.every(r => r.status === "review" && r.type === null));
  ok("all share ONE importId", imported.every(r => r.importId && r.importId === imported[0].importId));
  ok("all carry the same csvFp (rowCount|cents|min|max)", imported.every(r => r.csvFp && r.csvFp === imported[0].csvFp) && /^3\|/.test(imported[0].csvFp), imported[0].csvFp);
  ok("vendor = each row's own store", imported.filter(r => r.vendor === "Lowe's Kitty Hawk").length === 2 && imported.some(r => r.vendor === "Lowe's Nags Head"));

  console.log("— P&L INVARIANCE: importing review records moves NOTHING into any billing array —");
  ok("job.materials / job.expenses / business expenses UNCHANGED after import", plSnap() === beforePL, { before: beforePL, after: plSnap() });
  ok("imported rows are in NO job array (review only)", STORE.jobs.every(j => (j.materials || []).concat(j.expenses || []).every(x => (x.source !== "csv"))));

  console.log("— CSV soft dedup: re-importing the SAME file pre-unchecks every row —");
  rcptCsvHandle({ name: "lowes-history.csv", __text: LOWES_CSV });   // build a fresh preview against the now-populated queue
  ok("second import flags all 3 as likely dups", RCSV && RCSV.parsed.length === 3 && RCSV.parsed.every(p => p.dup === true), RCSV && RCSV.parsed.map(p => p.dup));
  ok("dups are pre-UNCHECKED (keep=false) so nothing double-imports by default", RCSV && RCSV.parsed.every(p => p.keep === false));
  ok("re-import fingerprint matches the first import's csvFp (already-imported signal)", RCSV && RCSV.fp === imported[0].csvFp, RCSV && RCSV.fp);

  console.log("— CSV round-trip: imported review records survive migrateStore + a no-op sync merge (zero loss) —");
  const csvWrapped = SS.migrateStore({ obx: { receipts: STORE.receipts.slice() } });
  const rt = SS.mergeState(csvWrapped, csvWrapped);
  const survived = (rt.obx.receipts || []).filter(r => r.source === "csv");
  ok("all 3 imported receipts survive the round-trip", survived.length === 3, survived.length);
  ok("survivors keep receiptId:null + importId + csvFp intact", survived.every(r => r.receiptId === null && r.importId && r.csvFp), survived[0]);

  // ===================== CSV SOURCE-FILE LINK (js/93 blob-store + js/72/87 render) =====================
  console.log("\n— CSV blob-link: import stores the raw CSV once + tags every row with csvFile/csvName —");
  resetStore();
  let csvUploads = 0, csvBlob = null;
  global.jsUpload = function () { csvUploads++; csvBlob = "csvblob_" + csvUploads; return Promise.resolve(csvBlob); };
  rcptCsvHandle({ name: "lowes-history.csv", __text: LOWES_CSV });
  rcptCsvCommit();
  await new Promise(r => setTimeout(r, 20));   // let the async blob-store resolve + attach
  const linked = rcptReview().filter(r => r.source === "csv");
  ok("the CSV was uploaded exactly once (one blob for the whole file)", csvUploads === 1, csvUploads);
  ok("every imported row carries csvFile = the stored blob id", linked.length === 3 && linked.every(r => r.csvFile === csvBlob), linked.map(r => r.csvFile));
  ok("every imported row carries csvName (source-file label for a nicer link)", linked.every(r => r.csvName === "lowes-history.csv"), linked[0] && linked[0].csvName);
  ok("csvFile rows stay photo-less (receiptId null) — the link is the CSV, not a photo", linked.every(r => r.receiptId === null));

  console.log("— CSV blob-link: the 📎 cell → 📄 CSV for a csvFile row; a photo (receiptId) still wins —");
  const csvCell = rcptAttachLink(linked[0]);
  ok("csvFile + no photo → a 📄 CSV link to the stored blob", /📄 CSV/.test(csvCell) && csvCell.indexOf(jsUploadUrl(csvBlob)) >= 0, csvCell);
  ok("photo takes precedence: a receiptId row → 📎 (never the CSV link)", (function () { const c = rcptAttachLink({ receiptId: "p.jpg", csvFile: csvBlob }); return /📎/.test(c) && !/📄 CSV/.test(c); })());
  ok("neither photo nor csvFile → a blank cell", rcptAttachLink({}) === "");
  // edit modal (js/87): a csvFile row (no photo) renders a "View source CSV" link
  let LAST_MODAL_HTML = "";
  global.modal = function (title, html) { LAST_MODAL_HTML = String(html || ""); };
  rcptEditOpen("review", null, linked[0].id);
  ok("edit modal shows 'View source CSV' for a csvFile row (links the stored blob)", /View source CSV/.test(LAST_MODAL_HTML) && LAST_MODAL_HTML.indexOf(jsUploadUrl(csvBlob)) >= 0, LAST_MODAL_HTML.slice(0, 60));
  // a row WITH a photo must not show the CSV link in the modal (photo wins)
  const photoRec = seedReview({ receiptId: "photo1.jpg", vendor: "Depot", amount: 10 }); photoRec.csvFile = csvBlob; photoRec.source = "csv";
  rcptEditOpen("review", null, photoRec.id);
  ok("a photo'd row shows the photo, NOT the CSV link, in the modal", !/View source CSV/.test(LAST_MODAL_HTML), LAST_MODAL_HTML.slice(0, 60));
  STORE.receipts = STORE.receipts.filter(r => r.id !== photoRec.id);   // drop the extra so re-import counts stay clean
  global.modal = function () {};

  console.log("— CSV re-import: a dedup MATCH ATTACHES csvFile to the EXISTING record (no dupe, no billing change) —");
  const beforeLink = linked.map(r => JSON.stringify({ id: r.id, amount: r.amount, vendor: r.vendor, attributedTo: r.attributedTo, refNo: r.refNo || "" })).sort();
  linked.forEach(r => { delete r.csvFile; delete r.csvName; });   // simulate Ray's pre-existing rows that never had a link
  const csvCountBefore = rcptReview().filter(r => r.source === "csv").length;
  global.jsUpload = function () { return Promise.resolve("csvblob_reimport"); };
  rcptCsvHandle({ name: "lowes-history.csv", __text: LOWES_CSV });   // same file → all rows dup-match
  ok("re-import pre-unchecks all rows (nothing new to create)", RCSV && RCSV.parsed.length === 3 && RCSV.parsed.every(p => p.keep === false));
  rcptCsvCommit();
  await new Promise(r => setTimeout(r, 20));
  const afterReimport = rcptReview().filter(r => r.source === "csv");
  ok("NO duplicate rows created on re-import (same count as before)", afterReimport.length === csvCountBefore && afterReimport.length === 3, { before: csvCountBefore, after: afterReimport.length });
  ok("the EXISTING rows got csvFile attached in place (Ray's already-imported rows get their link)", afterReimport.every(r => r.csvFile === "csvblob_reimport"), afterReimport.map(r => r.csvFile));
  ok("re-import changed ONLY csvFile/csvName — id/amount/vendor/attribution/refNo untouched (no billing change)", afterReimport.map(r => JSON.stringify({ id: r.id, amount: r.amount, vendor: r.vendor, attributedTo: r.attributedTo, refNo: r.refNo || "" })).sort().join("|") === beforeLink.join("|"), { before: beforeLink, after: afterReimport.map(r => ({ id: r.id, amount: r.amount })) });
  global.jsUpload = function () { return Promise.resolve("blob_" + (++_n)); };   // restore the default stub for later tests

  console.log("— CSV robustness: a header-less / all-junk / empty file never crashes —");
  ok("empty text → empty auto-map, no throw", (function () { try { const a = rcptCsvAutoMap(budgetParseCSV("")); return a.map.amount === -1; } catch (e) { return false; } })());
  ok("a junk-only body parses to 0 records (all skipped)", (function () {
    const rows = budgetParseCSV("Date,Item,Amount\n2026-07-01,Subtotal,10\n2026-07-01,Tax,1\n");
    const mp = rcptCsvAutoMap(rows).map; let kept = 0, skip = 0;
    rows.slice(1).forEach(r => { const rec = rcptCsvRecord(r, mp, "X", "i1"); if (rec) kept++; else skip++; });
    return kept === 0 && skip === 2;
  })());
  ok("a $0 / unparseable amount row is skipped, not imported", rcptCsvRecord(["2026-07-01", "Freebie", "$0.00"], { date: 0, desc: 1, amount: 2, store: -1, order: -1 }, "X", "i1") === null);

  console.log("\n— CARD LAST-4 (js/94): capture carries through rcptApplyEdit / split / CSV; manual paidBy always wins —");
  resetStore();
  // a review receipt carrying a captured card last-4, filed to a job-expense with an explicit paidBy (manual choice)
  const cr = seedReview({ receiptId: "bCard", vendor: "Depot", amount: 90, uploadedBy: "u_ray", attributedTo: "u_ray", cardLast4: "4242" });
  const rFile = rcptApplyEdit({ store: "review", jobId: null, recId: cr.id }, { type: "job-expense", jobId: "j1", amount: 90, vendor: "Depot", date: "2026-07-01", category: "fuel", paidBy: "u_chase", attributedTo: "u_chase", desc: "gas", receiptId: "bCard", cardLast4: "4242" });
  const filed = rcptFindRecord(rFile.newLoc.store, rFile.newLoc.jobId, rFile.newLoc.recId);
  ok("cardLast4 filed onto the job-expense record", filed && filed.cardLast4 === "4242", filed && filed.cardLast4);
  ok("manual paidBy WINS on save — record.paidBy is the chosen payer (money path unchanged)", filed && filed.paidBy === "u_chase", filed && filed.paidBy);
  // re-bucket (type change) with fields OMITTING cardLast4 → the carry preserves it (like capRead)
  const rMove = rcptApplyEdit({ store: rFile.newLoc.store, jobId: rFile.newLoc.jobId, recId: rFile.newLoc.recId }, { type: "business", jobId: null, amount: 90, vendor: "Depot", date: "2026-07-01", category: "fuel", paidBy: "u_chase", attributedTo: "u_chase", desc: "gas", receiptId: "bCard" });
  const moved = rcptFindRecord(rMove.newLoc.store, rMove.newLoc.jobId, rMove.newLoc.recId);
  ok("cardLast4 SURVIVES a type/job change even when fields omit it (carry preserves it)", moved && moved.cardLast4 === "4242", moved && moved.cardLast4);
  // explicit empty cardLast4 CLEARS it (form value wins over carry)
  const rClear = rcptApplyEdit({ store: rMove.newLoc.store, jobId: rMove.newLoc.jobId, recId: rMove.newLoc.recId }, { type: "business", jobId: null, amount: 90, vendor: "Depot", date: "2026-07-01", category: "fuel", paidBy: "u_chase", attributedTo: "u_chase", desc: "gas", receiptId: "bCard", cardLast4: "" });
  const cleared = rcptFindRecord(rClear.newLoc.store, rClear.newLoc.jobId, rClear.newLoc.recId);
  ok("an explicit empty cardLast4 CLEARS the field (form value beats carry)", cleared && !cleared.cardLast4, cleared && cleared.cardLast4);

  // SPLIT: the shared card last-4 rides EVERY slice
  resetStore();
  const cs = seedReview({ receiptId: "bCS", vendor: "Home Depot", amount: 100, uploadedBy: "u_ray", attributedTo: "u_ray", cardLast4: "1005" });
  const csRes = rcptApplySplit({ store: "review", jobId: null, recId: cs.id }, 100,
    [{ amount: 60, type: "pass-through", jobId: "j1", category: "", desc: "pavers" }, { amount: 40, type: "business", category: "tools/equipment", desc: "saw" }],
    { vendor: "Home Depot", date: "2026-07-01", paidBy: null, attributedTo: "u_ray", category: "", desc: "", receiptId: "bCS", cardLast4: "1005" });
  const csMat = STORE.jobs[0].materials.filter(m => !m.deleted);
  const csBiz = STORE.expenses.filter(e => !e.deleted);
  ok("split: BOTH slices carry the shared card last-4", csRes.ok && csMat[0] && csMat[0].cardLast4 === "1005" && csBiz[0] && csBiz[0].cardLast4 === "1005", { mat: csMat[0] && csMat[0].cardLast4, biz: csBiz[0] && csBiz[0].cardLast4 });

  // CSV: a parsed review row carries a (blank) cardLast4 key so the field is first-class + routable later
  const csvRec = rcptCsvRecord(["2026-07-01", "Quikrete 60lb", "$6.98"], { date: 0, desc: 1, amount: 2, store: -1, order: -1 }, "Lowe's", "i1");
  ok("CSV import record carries a cardLast4 field (empty, routable later)", csvRec && Object.prototype.hasOwnProperty.call(csvRec, "cardLast4") && csvRec.cardLast4 === "", csvRec && csvRec.cardLast4);

  // cardOwner (js/94) against a stubbed store — personal single-match / company / none / ambiguous
  const _u = S.users, _r = S.registry;
  S.users = [{ id: "u_ray", username: "Ray", cards: [{ id: "k1", last4: "4242", kind: "personal" }] }, { id: "u_chase", username: "Chase", cards: [{ id: "k2", last4: "1005", kind: "personal" }, { id: "k3", last4: "7777", kind: "personal" }] }, { id: "u_pierce", username: "Pierce", cards: [{ id: "k4", last4: "7777", kind: "personal" }] }];
  S.registry = [{ id: "obx", businessCards: [{ id: "b1", last4: "3005", active: true }] }];
  ok("cardOwner: single personal match → reimburse that owner", cardOwner("4242").resolution === "personal" && cardOwner("4242").ownerId === "u_ray");
  ok("cardOwner: company card → business (no reimburse)", cardOwner("3005").resolution === "business" && cardOwner("3005").ownerId === null);
  ok("cardOwner: two owners share a last-4 → ambiguous", cardOwner("7777").resolution === "ambiguous");
  ok("cardOwner: unknown last-4 → none", cardOwner("0000").resolution === "none");
  S.users = _u; S.registry = _r;

  // ========================= VENDOR-SPECIFIC CSV IMPORTERS (js/93) =========================
  // Synthetic Lowe's "Order History" export — mimics the REAL header + a spread of rows:
  //   · a PO customer-hint row (PO "mike green"), a PO prefix row ("mike g"), a "no" PO row, an "NA" PO row
  //   · VISA / DEBITVISA / DEBITMC card types in the "************2469" masked format
  //   · the trailing "multiple*:" note row that must be SKIPPED
  const LOWES_V2_HDR = "Date,Purchased From,Fulfillment Type,Fulfillment Store #,Fulfillment Store Location,Fulfillment Status,PO Number,Group Name,Purchaser Name,Purchaser Email,Purchaser Phone Number,Order # / Trans. #,Invoice Number,Tax,Order Total,CC Type,CC# (last 4),Loyalty Rewards Earned,Order Ref";
  const LOWES_V2 =
    LOWES_V2_HDR + "\r\n" +
    "2-Jul-2026,Lowe's,In-Store,1521,Kill Devil Hills Lowe's,Fulfilled,mike green,,Ray,ray@obx.com,2525550000,147424942,,$4.29,$65.07,VISA,************2469,$0.65,REF1\r\n" +
    "30-Jun-2026,Lowe's,Pickup,1521,Nags Head Lowe's,Fulfilled,no,,Ray,ray@obx.com,2525550000,147000001,,$0.81,$12.34,DEBITVISA,************1005,$0.12,REF2\r\n" +
    "1-May-2026,Lowe's,In-Store,1521,Kill Devil Hills Lowe's,Fulfilled,NA,,Ray,ray@obx.com,2525550000,147000002,,$13.11,$200.00,DEBITMC,************3005,$2.00,REF3\r\n" +
    "2-Jul-2026,Lowe's,In-Store,1521,Kill Devil Hills Lowe's,Fulfilled,mike g,,Ray,ray@obx.com,2525550000,147000003,,$2.49,$37.96,VISA,************2469,$0.38,REF4\r\n" +
    "multiple*: indicates an order was paid across more than one card\r\n";

  console.log("\n— VENDOR CSV: Lowe's detected by header signature, unknown files fall back to generic —");
  const detected = rcptCsvDetectVendor(budgetParseCSV(LOWES_V2)[0]);
  ok("detect(headerCells) → Lowe's parser (id 'lowes')", detected && detected.id === "lowes", detected && detected.id);
  ok("unknown/generic header → no vendor (null → generic fallback)", rcptCsvDetectVendor(budgetParseCSV(LOWES_CSV)[0]) === null);

  console.log("— VENDOR CSV: zero-map parse — Order Total / D-Mon-YYYY date / cardLast4 / PO hint —");
  resetStore();
  CURUSER = { id: "u_ray", username: "Ray" };
  STORE.customers.push({ id: "cMG", name: "Mike Green" });   // the PO soft-match target
  const beforeV = plSnap();
  rcptCsvHandle({ name: "PurchaseHistory.csv", __text: LOWES_V2 });   // FileReader stub → detect → vendor preview
  ok("Lowe's detected → RCSV.vendorId 'lowes' (column-map step skipped)", RCSV && RCSV.vendorId === "lowes", RCSV && RCSV.vendorId);
  ok("4 line items parsed, 'multiple*' trailer skipped + counted", RCSV && RCSV.parsed.length === 4 && RCSV.skipped === 1, RCSV && [RCSV && RCSV.parsed.length, RCSV && RCSV.skipped]);
  const vRecs = RCSV.parsed.map(p => p.rec);
  ok("amount = Order Total incl tax (12.34 / 37.96 / 65.07 / 200)", vRecs.map(r => r.amount).sort((a, b) => a - b).join(",") === "12.34,37.96,65.07,200", vRecs.map(r => r.amount));
  ok("D-Mon-YYYY → YYYY-MM-DD (2× 2026-07-02, 2026-06-30, 2026-05-01)", vRecs.filter(r => r.date === "2026-07-02").length === 2 && vRecs.some(r => r.date === "2026-06-30") && vRecs.some(r => r.date === "2026-05-01"), vRecs.map(r => r.date));
  ok("vendor = \"Lowe's\" for every row", vRecs.every(r => r.vendor === "Lowe's"));
  ok("cardLast4 = trailing 4 of CC# (last 4) → 2469/1005/3005/2469 (feeds card-attribution)", vRecs.map(r => r.cardLast4).join(",") === "2469,1005,3005,2469", vRecs.map(r => r.cardLast4));
  const mgRow = vRecs.find(r => /147424942/.test(r.desc));
  ok("desc = 'Order #<n> · <store>'", /^Order #147424942 · Kill Devil Hills Lowe's/.test(mgRow.desc), mgRow.desc);
  ok("PO surfaced on desc (· PO: mike green)", /· PO: mike green/.test(mgRow.desc), mgRow.desc);
  ok("PO 'mike green' soft-matches exactly one customer → custHint {customerId,name}", mgRow.custHint && mgRow.custHint.customerId === "cMG" && mgRow.custHint.name === "Mike Green", mgRow.custHint);
  const mgPrefix = vRecs.find(r => /147000003/.test(r.desc));
  ok("PO prefix 'mike g' also soft-matches Mike Green (contained-in-name)", mgPrefix.custHint && mgPrefix.custHint.customerId === "cMG", mgPrefix.custHint);
  const noRow = vRecs.find(r => /147000001/.test(r.desc)), naRow = vRecs.find(r => /147000002/.test(r.desc));
  ok("PO 'no' / 'NA' rows → NO PO note, NO custHint (sentinels skipped)", !/PO:/.test(noRow.desc) && !noRow.custHint && !/PO:/.test(naRow.desc) && !naRow.custHint, { no: noRow.desc, na: naRow.desc });
  ok("every parsed record is status:review / receiptId:null / type:null (not billing)", vRecs.every(r => r.status === "review" && r.receiptId === null && r.type === null));

  console.log("— VENDOR CSV commit → review queue; P&L invariant; survives sync round-trip —");
  rcptCsvCommit();   // headless: no checkboxes kept → all 4; vendor input null → per-row 'Lowe's'
  const vImported = rcptReview().filter(r => r.source === "csv");
  ok("4 review records committed to receipts[]", vImported.length === 4, vImported.length);
  ok("committed records keep a 4-digit cardLast4 (card-attribution auto-matches paidBy later)", vImported.every(r => /^\d{4}$/.test(r.cardLast4)));
  ok("committed records keep the PO custHint suggestion (2 rows matched)", vImported.filter(r => r.custHint && r.custHint.customerId === "cMG").length === 2, vImported.filter(r => r.custHint).length);
  ok("P&L INVARIANCE: Σ job.materials/job.expenses/biz UNCHANGED after import (review-only)", plSnap() === beforeV, { before: beforeV, after: plSnap() });
  ok("imported rows are in NO job/biz array (review only)", STORE.jobs.every(j => (j.materials || []).concat(j.expenses || []).every(x => x.source !== "csv")) && (STORE.expenses || []).every(x => x.source !== "csv"));
  const vWrapped = SS.migrateStore({ obx: { receipts: STORE.receipts.slice() } });
  const vRt = SS.mergeState(vWrapped, vWrapped);
  const vSurv = (vRt.obx.receipts || []).filter(r => r.source === "csv");
  ok("all 4 vendor records survive migrate + no-op merge with cardLast4 + custHint intact", vSurv.length === 4 && vSurv.every(r => r.receiptId === null) && vSurv.filter(r => r.custHint).length === 2, vSurv.length);

  console.log("— VENDOR CSV: an UNKNOWN header still routes through the generic auto-map path —");
  resetStore();
  CURUSER = { id: "u_ray", username: "Ray" };
  rcptCsvHandle({ name: "mystery.csv", __text: LOWES_CSV });
  ok("unknown file → no vendorId, generic auto-map still parses its 3 line items", RCSV && !RCSV.vendorId && RCSV.parsed.length === 3, RCSV && [RCSV && RCSV.vendorId, RCSV && RCSV.parsed.length]);

  // ================= PER-JOB PO CODE — CSV EXACT-match (js/95 ↔ js/93) =================
  console.log("\n— VENDOR CSV: a register-typed P#### PO EXACT-matches its job → hard jobId (supersedes the fuzzy hint) —");
  resetStore();
  CURUSER = { id: "u_ray", username: "Ray" };
  STORE.jobs.push({ id: "jPO", title: "Mike Green patio", customerId: "cMG2", poNum: 1042, materials: [], expenses: [] });
  STORE.customers.push({ id: "cMG2", name: "Mike Green" });
  // one row with the app's own PO "P1042" (exact) + one row with a fuzzy name PO "mike green" (fallback)
  const PO_CSV = LOWES_V2_HDR + "\r\n" +
    "2-Jul-2026,Lowe's,In-Store,1521,Kill Devil Hills Lowe's,Fulfilled,P1042,,Ray,ray@obx.com,2525550000,147424999,,$4.29,$65.07,VISA,************2469,$0.65,REFX\r\n" +
    "2-Jul-2026,Lowe's,In-Store,1521,Kill Devil Hills Lowe's,Fulfilled,mike green,,Ray,ray@obx.com,2525550000,147424998,,$4.29,$30.00,VISA,************2469,$0.65,REFY\r\n";
  RCSV = null;
  rcptCsvHandle({ name: "po.csv", __text: PO_CSV });
  const poRecs = RCSV.parsed.map(p => p.rec);
  const poExact = poRecs.find(r => /147424999/.test(r.desc));
  const poFuzzy = poRecs.find(r => /147424998/.test(r.desc));
  ok("PO 'P1042' EXACT-matches job jPO → rec.jobId hard-set", poExact && poExact.jobId === "jPO", poExact && poExact.jobId);
  ok("exact match also sets customerId + _poMatch badge (P1042)", poExact && poExact.customerId === "cMG2" && poExact._poMatch && poExact._poMatch.po === "P1042", poExact && poExact._poMatch);
  ok("exact match SUPERSEDES the fuzzy hint (no custHint on the matched row)", poExact && !poExact.custHint, poExact && poExact.custHint);
  ok("a NON-numeric PO ('mike green') → NO exact match → falls back to custHint, jobId stays null", poFuzzy && poFuzzy.jobId === null && !poFuzzy._poMatch && poFuzzy.custHint && poFuzzy.custHint.customerId === "cMG2", { jobId: poFuzzy && poFuzzy.jobId, hint: poFuzzy && poFuzzy.custHint });
  ok("still review-only (exact match does NOT file it into billing)", poExact && poExact.status === "review" && poExact.type === null, poExact && [poExact.status, poExact.type]);

  // ================= RENTAL DEPOSIT / REFUND (js/96 HOLD-OUT) + the Phase-0 sign fix =================
  console.log("\n— RENTAL DEPOSIT: money() is sign-correct; CSV keeps a negative sign; a refund toggle stores negative —");
  // the REAL money() (js/02) — sign-correct "-$90", byte-identical for >=0. Extracted so the file's own money() stub is untouched.
  const realMoney = eval("(function(){ " + fs.readFileSync(__dirname + "/js/02-state.js", "utf8").match(/function money\(n\)\{[^\n]*\}/)[0] + " return money; })()");
  ok("money(-90) === '-$90' (minus BEFORE the $, not '$-90')", realMoney(-90) === "-$90", realMoney(-90));
  ok("money(90) === '$90' (byte-identical for >= 0 → fingerprint-neutral)", realMoney(90) === "$90", realMoney(90));
  ok("money(0) === '$0' (unchanged)", realMoney(0) === "$0", realMoney(0));
  ok("money(1500) === '$1,500' (grouping unchanged for >= 0)", realMoney(1500) === "$1,500", realMoney(1500));

  // CSV: a negative Order Total (generic parser) imports as a NEGATIVE review receipt tagged kind:"refund" — not +90, not skipped
  const csvRefund = rcptCsvRecord(["2026-07-01", "Return / credit", "-$90.00"], { date: 0, desc: 1, amount: 2, store: -1, order: -1 }, "Lowe's", "i1");
  ok("CSV refund row keeps the NEGATIVE sign (imports as -90, not +90 or skipped)", csvRefund && csvRefund.amount === -90, csvRefund && csvRefund.amount);
  ok("CSV refund row is tagged kind:'refund'", csvRefund && csvRefund.kind === "refund", csvRefund && csvRefund.kind);
  ok("CSV positive row is unchanged (no kind, positive amount)", (function () { const r = rcptCsvRecord(["2026-07-01", "Pavers", "$6.98"], { date: 0, desc: 1, amount: 2, store: -1, order: -1 }, "Lowe's", "i1"); return r && r.amount === 6.98 && !r.kind; })());
  // the Lowe's vendor parser also keeps the sign on a negative Order Total (a return row)
  const lowesHdr = "Date,Fulfillment Store Location,PO Number,Order # / Trans. #,Tax,Order Total,CC Type,CC# (last 4)";
  const lowesRefundRows = budgetParseCSV(lowesHdr + "\r\n2-Jul-2026,KDH Lowe's,NA,147999001,-$1.00,-$90.00,VISA,************2469\r\n");
  const lowesParser = rcptCsvDetectVendor ? VENDOR_PARSERS.find(p => p.id === "lowes") : null;
  const lowesRefund = lowesParser ? lowesParser.parseRow(lowesRefundRows[1], rcptVendorH(lowesRefundRows[0])) : null;
  ok("Lowe's parser keeps a negative Order Total (return row → -90, kind refund)", lowesRefund && lowesRefund.amount === -90 && lowesRefund.kind === "refund", lowesRefund && [lowesRefund.amount, lowesRefund.kind]);

  // the refund toggle path (rcptApplyEdit fields) stores a NEGATIVE amount + kind:"refund"
  resetStore();
  const rrev = seedReview({ receiptId: "bRef", vendor: "Sunbelt", amount: 90, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const rRefRes = rcptApplyEdit({ store: "review", jobId: null, recId: rrev.id }, { type: "job-expense", jobId: "j1", amount: -90, vendor: "Sunbelt", date: "2026-07-01", category: "rentals", desc: "trailer refund", receiptId: "bRef", kind: "refund" });
  const refFiled = rcptFindRecord(rRefRes.newLoc.store, rRefRes.newLoc.jobId, rRefRes.newLoc.recId);
  ok("refund toggle: filed record stores NEGATIVE amount + kind:'refund'", refFiled && refFiled.amount === -90 && refFiled.kind === "refund", refFiled && [refFiled.amount, refFiled.kind]);

  console.log("— RENTAL DEPOSIT: a deposit+refund on a job is $0 while HELD, nets to (deposit − refund) once SETTLED —");
  resetStore();
  // file a $300 deposit onto j1 (isDeposit, category rentals), then a −$90 refund linked to it
  const depRev = seedReview({ receiptId: "bDep", vendor: "Sunbelt", amount: 300, uploadedBy: "u_ray", attributedTo: "u_ray" });
  const depRes = rcptApplyEdit({ store: "review", jobId: null, recId: depRev.id }, { type: "job-expense", jobId: "j1", amount: 300, vendor: "Sunbelt", date: "2026-07-01", category: "rentals", desc: "trailer deposit", receiptId: "bDep", isDeposit: true });
  const depRec = rcptFindRecord(depRes.newLoc.store, depRes.newLoc.jobId, depRes.newLoc.recId);
  ok("deposit filed with isDeposit + category rentals", depRec && depRec.isDeposit === true && depRec.category === "rentals", depRec && [depRec.isDeposit, depRec.category]);
  ok("depositHeld(deposit) is TRUE while unsettled", depositHeld(depRec) === true, depositHeld(depRec));
  // link a refund to the deposit
  const jobJ1 = STORE.jobs.find(j => j.id === "j1");
  jobJ1.expenses.push({ id: "ref1", amount: -90, vendor: "Sunbelt", desc: "partial refund", category: "rentals", kind: "refund", refundOfId: depRec.id, deleted: false });
  const refRec = jobJ1.expenses.find(e => e.id === "ref1");
  ok("depositHeld(linked refund) is TRUE while unsettled", depositHeld(refRec) === true, depositHeld(refRec));
  ok("jobExpenseTotal EXCLUDES the held deposit group ($0 to the job)", jobExpenseTotal(jobJ1) === 0, jobExpenseTotal(jobJ1));
  ok("depositsAwaitingRefund() surfaces the open deposit with its net", (function () { const d = depositsAwaitingRefund(); return d.length === 1 && d[0].deposit.id === depRec.id && d[0].hasRefund === true && d[0].net === 210; })());
  ok("depositNetCost = deposit − refund = 210", depositNetCost(depRec) === 210, depositNetCost(depRec));
  // SETTLE → the group counts at NET
  ok("depositSettle(id) returns true (found the deposit)", depositSettle(depRec.id) === true);
  ok("after settle: deposit + refund both depositSettled", depRec.depositSettled === true && refRec.depositSettled === true, [depRec.depositSettled, refRec.depositSettled]);
  ok("after settle: depositHeld is FALSE for both (group counts now)", depositHeld(depRec) === false && depositHeld(refRec) === false);
  ok("after settle: jobExpenseTotal counts the NET (300 − 90 = 210)", jobExpenseTotal(jobJ1) === 210, jobExpenseTotal(jobJ1));
  ok("after settle: depositsAwaitingRefund() is empty", depositsAwaitingRefund().length === 0, depositsAwaitingRefund().length);

  // a plain expense with no deposit/refund flags behaves exactly as today (not held)
  ok("an ordinary expense is NOT held (== today)", depositHeld({ amount: 50, category: "fuel" }) === false);

  // ================= CENTS DISPLAY (money2) — receipts show $38.94, not $39 =================
  console.log("\n— CENTS: money2() formats receipt money to exact cents (display-only; money() untouched) —");
  const realMoney2 = eval("(function(){ " + fs.readFileSync(__dirname + "/js/02-state.js", "utf8").match(/function money2\(n\)\{[^\n]*\}/)[0] + " return money2; })()");
  ok("money2(38.94) === '$38.94' (the exact cents Ray saw rounded to $39)", realMoney2(38.94) === "$38.94", realMoney2(38.94));
  ok("money2(-90) === '-$90.00' (sign before $, two decimals)", realMoney2(-90) === "-$90.00", realMoney2(-90));
  ok("money2(1234.5) === '$1,234.50' (thousands separator + padded cents)", realMoney2(1234.5) === "$1,234.50", realMoney2(1234.5));
  ok("money2(0) === '$0.00'", realMoney2(0) === "$0.00", realMoney2(0));
  // money() itself stays whole-dollar (fingerprint-neutral) — confirm the two are distinct
  ok("money() still rounds to whole dollars ($39 for 38.94) — shared plumbing untouched", realMoney(38.94) === "$39", realMoney(38.94));

  // ================= DEDUP ON VENDOR TRANSACTION # (refNo) — the real bug =================
  console.log("\n— DEDUP: two distinct Lowe's orders (same $/day, DIFFERENT order #) are NOT false-flagged as dupes —");
  const DUP_HDR = "Date,Fulfillment Store Location,PO Number,Order # / Trans. #,Tax,Order Total,CC Type,CC# (last 4)";
  const dupRows = budgetParseCSV(DUP_HDR + "\r\n" +
    "2-Jul-2026,KDH Lowe's,NA,#147424942,$0.65,$38.94,VISA,************2469\r\n" +
    "2-Jul-2026,KDH Lowe's,NA,#494486963,$0.65,$38.94,VISA,************2469\r\n");
  const lp = VENDOR_PARSERS.find(p => p.id === "lowes");
  const dupH = rcptVendorH(dupRows[0]);
  const rA = lp.parseRow(dupRows[1], dupH), rB = lp.parseRow(dupRows[2], dupH);
  ok("(e) refNo extracted from 'Order # / Trans. #' column as digits (strip '#')", rA.refNo === "147424942" && rB.refNo === "494486963", [rA.refNo, rB.refNo]);
  ok("both keep exact cents (38.94, not 39) — dedup is on cents, never rounded", rA.amount === 38.94 && rB.amount === 38.94, [rA.amount, rB.amount]);
  ok("(b) same $/day but DIFFERENT order # → rcptCsvDupKey DIFFERS (not a dup) — the fix", rcptCsvDupKey(rA) !== rcptCsvDupKey(rB), [rcptCsvDupKey(rA), rcptCsvDupKey(rB)]);
  ok("    keys are refNo-based (exact transaction identity)", /^ref\|lowe's\|147424942$/.test(rcptCsvDupKey(rA)), rcptCsvDupKey(rA));
  console.log("— DEDUP: an exact re-import (SAME order #) IS caught —");
  const rAgain = lp.parseRow(dupRows[1], dupH);   // re-parse the same row
  ok("(c) same refNo → SAME rcptCsvDupKey → flagged dup on re-import", rcptCsvDupKey(rAgain) === rcptCsvDupKey(rA), [rcptCsvDupKey(rAgain), rcptCsvDupKey(rA)]);

  console.log("— DEDUP: no-refNo rows fall back to date+cents+vendor (+card disambiguator) —");
  const fA = { date: "2026-07-02", amount: 38.94, vendor: "Lowe's", cardLast4: "2469" };
  const fB = { date: "2026-07-02", amount: 38.94, vendor: "Lowe's", cardLast4: "1005" };   // DIFFERENT card
  const fC = { date: "2026-07-02", amount: 38.94, vendor: "Lowe's", cardLast4: "2469" };   // same card as fA
  const fNoCard1 = { date: "2026-07-02", amount: 38.94, vendor: "Lowe's" };
  const fNoCard2 = { date: "2026-07-02", amount: 38.94, vendor: "Lowe's" };
  ok("(d) fallback key = date|cents|vendor(+card)", rcptCsvDupKey(fA) === "2026-07-02|3894|lowe's|2469", rcptCsvDupKey(fA));
  ok("(d) two same-$/day rows on DIFFERENT cards → different keys (NOT dup)", rcptCsvDupKey(fA) !== rcptCsvDupKey(fB), [rcptCsvDupKey(fA), rcptCsvDupKey(fB)]);
  ok("(d) same card, same $/day → same key (dup)", rcptCsvDupKey(fA) === rcptCsvDupKey(fC));
  ok("(d) card absent → key has no card suffix; two absent-card same rows → same key (dup)", rcptCsvDupKey(fNoCard1) === "2026-07-02|3894|lowe's" && rcptCsvDupKey(fNoCard1) === rcptCsvDupKey(fNoCard2), rcptCsvDupKey(fNoCard1));

  console.log("— DEDUP: the receipts-table badge (rcptDupKey, js/72) agrees with the import (refNo exact else cents+vendor+card) —");
  ok("rcptDupKey: distinct order #s → different keys (table badge won't false-flag)", rcptDupKey({ refNo: "147424942", vendor: "Lowe's" }) !== rcptDupKey({ refNo: "494486963", vendor: "Lowe's" }));
  ok("rcptDupKey: same refNo → same key", rcptDupKey({ refNo: "147424942", vendor: "Lowe's" }) === rcptDupKey({ refNo: "147424942", vendor: "Lowe's", amount: 999 }));
  ok("rcptDupKey: no refNo → cents+vendor(+card); different cards → different keys", rcptDupKey({ amount: 38.94, vendor: "Lowe's", cardLast4: "2469" }) !== rcptDupKey({ amount: 38.94, vendor: "Lowe's", cardLast4: "1005" }));
  ok("rcptDupKey: no refNo, same cents+vendor, no card → same key (dup)", rcptDupKey({ amount: 38.94, vendor: "Lowe's" }) === rcptDupKey({ amount: 38.94, vendor: "Lowe's" }));

  // ============ TOLERANT POSSIBLE-DUPLICATE DETECTION (js/72 rcptVendorNorm + rcptDupGroups) ============
  console.log("\n— DUP-NORM: rcptVendorNorm folds 'the ' + legal suffixes + punctuation —");
  ok("'The Home Depot' == 'Home Depot'", rcptVendorNorm("The Home Depot") === rcptVendorNorm("Home Depot") && rcptVendorNorm("Home Depot") === "home depot", [rcptVendorNorm("The Home Depot"), rcptVendorNorm("Home Depot")]);
  ok("\"Lowe's Home Centers, LLC\" == 'lowes home centers'", rcptVendorNorm("Lowe's Home Centers, LLC") === "lowes home centers", rcptVendorNorm("Lowe's Home Centers, LLC"));
  ok("\"Lowe's\" == 'Lowes' (apostrophe folded)", rcptVendorNorm("Lowe's") === rcptVendorNorm("Lowes") && rcptVendorNorm("Lowe's") === "lowes", rcptVendorNorm("Lowe's"));
  ok("blank vendor → '' (no false match on empties)", rcptVendorNorm("") === "" && rcptVendorNorm(null) === "");

  console.log("— DUP-GROUP: $26.67 Lowe's filed twice, card on ONE copy only → flagged (the missed case) —");
  resetStore();
  const dA = seedReview({ receiptId: "d26a", vendor: "Lowe's", amount: 26.67, cardLast4: "8355" });
  const dB = seedReview({ receiptId: "d26b", vendor: "Lowe's", amount: 26.67 });   // NO card
  let dg = rcptDupGroups();
  ok("one group of 2 flagged (card-as-wildcard, same vendor+amount)", dg.length === 1 && dg[0].length === 2, dg.map(g => g.length));
  const dgIx = rcptDupIndex();
  ok("both copies are in dupIndex.byId", !!dgIx.byId[dA.id] && !!dgIx.byId[dB.id]);

  console.log("— DUP-GROUP: 'The Home Depot' vs 'Home Depot', same amount → flagged (vendor normalized) —");
  resetStore();
  seedReview({ receiptId: "hd1", vendor: "The Home Depot", amount: 58.67 });
  seedReview({ receiptId: "hd2", vendor: "Home Depot", amount: 58.67 });
  dg = rcptDupGroups();
  ok("normalized-vendor match flags the pair", dg.length === 1 && dg[0].length === 2, dg.map(g => g.length));

  console.log("— DUP-GROUP: blank vendor on one copy + SAME card → flagged (card links them) —");
  resetStore();
  seedReview({ receiptId: "bc1", vendor: "Home Depot", amount: 46.52, cardLast4: "8355" });
  seedReview({ receiptId: "bc2", vendor: "", amount: 46.52, cardLast4: "8355" });   // blank vendor, same card
  dg = rcptDupGroups();
  ok("same-card match flags even with a blank vendor", dg.length === 1 && dg[0].length === 2, dg.map(g => g.length));

  console.log("— DUP-GROUP: a REVIEW copy of a FILED receipt flags (compares review + filed union) —");
  resetStore();
  STORE.expenses.push({ id: "fe1", receiptId: "fe1p", vendor: "Home Depot", amount: 99.99, cardLast4: "8355", date: "2026-07-01", category: "materials" });   // filed business expense
  seedReview({ receiptId: "rv1", vendor: "Home Depot", amount: 99.99 });   // a review copy of the same purchase
  dg = rcptDupGroups();
  ok("review-vs-filed pair flagged", dg.length === 1 && dg[0].length === 2, dg.map(g => g.length));

  console.log("— DUP-GROUP: two GENUINELY different same-amount receipts (diff vendor, no shared card, no ref) do NOT flag —");
  resetStore();
  seedReview({ receiptId: "x1", vendor: "Lowe's", amount: 42.00, cardLast4: "8355" });
  seedReview({ receiptId: "x2", vendor: "Chevron", amount: 42.00, cardLast4: "1005" });   // different vendor AND different card
  ok("no group (different vendor, different card) → not over-flagged", rcptDupGroups().length === 0, rcptDupGroups().map(g => g.length));
  console.log("— DUP-GROUP: same amount, both blank vendor + no card → NOT flagged (too weak, manual-only) —");
  resetStore();
  seedReview({ receiptId: "w1", vendor: "", amount: 30.00 });
  seedReview({ receiptId: "w2", vendor: "", amount: 30.00 });
  ok("amount-only with no signal is NOT auto-flagged", rcptDupGroups().length === 0, rcptDupGroups().map(g => g.length));
  console.log("— DUP-GROUP: two CSV rows, same $/vendor but DIFFERENT refNo → NOT flagged (distinct orders) —");
  resetStore();
  seedReview({ receiptId: "o1", vendor: "Lowe's", amount: 38.94, refNo: "147424942" });
  seedReview({ receiptId: "o2", vendor: "Lowe's", amount: 38.94, refNo: "494486963" });
  ok("distinct transaction #s override the vendor+amount match (no false dup)", rcptDupGroups().length === 0, rcptDupGroups().map(g => g.length));

  console.log("— DUP-DELETE: rcptDupDelete soft-deletes one copy via the existing path, KEEPS the other —");
  resetStore(); global.finCanView = function () { return true; };
  const kA = seedReview({ receiptId: "k1", vendor: "Lowe's", amount: 26.67, cardLast4: "8355" });
  const kB = seedReview({ receiptId: "k2", vendor: "Lowe's", amount: 26.67 });
  ok("pre: the pair is flagged", rcptDupGroups().length === 1);
  rcptDupDelete("review", "", kB.id);   // confirm() stub returns true
  ok("deleted copy is tombstoned (soft, not hard)", STORE.receipts.find(r => r.id === kB.id).deleted === true);
  ok("kept copy survives untouched", !STORE.receipts.find(r => r.id === kA.id).deleted);
  ok("no group remains after resolving", rcptDupGroups().length === 0);

  console.log("— DUP-DELETE: a FILED (business) copy removes from org expenses[]; the review copy stays —");
  resetStore();
  const fBiz = { id: "fb1", receiptId: "fb1p", vendor: "Home Depot", amount: 77.77, cardLast4: "8355", date: "2026-07-01", category: "materials", deleted: false };
  STORE.expenses.push(fBiz);
  const rKeep = seedReview({ receiptId: "rk1", vendor: "Home Depot", amount: 77.77 });
  ok("pre: filed + review flagged as a pair", rcptDupGroups().length === 1);
  rcptDupDelete("biz", "", "fb1");   // delete the FILED billing record
  ok("filed business record tombstoned (charge drops from the books)", STORE.expenses.find(e => e.id === "fb1").deleted === true);
  ok("review copy kept", !STORE.receipts.find(r => r.id === rKeep.id).deleted);

  console.log("— DUP-KEEP: rcptDupKeep keeps one + deletes ALL other copies of the group —");
  resetStore();
  const g3a = seedReview({ receiptId: "g3a", vendor: "Home Depot", amount: 12.34, cardLast4: "8355" });
  const g3b = seedReview({ receiptId: "g3b", vendor: "The Home Depot", amount: 12.34 });
  const g3c = seedReview({ receiptId: "g3c", vendor: "", amount: 12.34, cardLast4: "8355" });
  ok("pre: all 3 form one group", rcptDupGroups().length === 1 && rcptDupGroups()[0].length === 3);
  rcptDupKeep("review", "", g3a.id);
  ok("kept copy alive", !STORE.receipts.find(r => r.id === g3a.id).deleted);
  ok("both other copies tombstoned", STORE.receipts.find(r => r.id === g3b.id).deleted === true && STORE.receipts.find(r => r.id === g3c.id).deleted === true);

  // ============ INFO-RICHNESS SCORE + "keep the richest" RECOMMENDATION (js/72 rcptInfoScore / resolver) ============
  global.money2 = global.money2 || function (n) { return "$" + (+n || 0).toFixed(2); };
  console.log("\n— INFO-SCORE: photo dominates; a photo+lineItems+card receipt outscores a bare CSV row —");
  const rich = rcptInfoScore({ receiptId: "p.jpg", suggested: { lineItems: [1, 2] }, cardLast4: "8355", category: "materials", jobId: "j1", desc: "pavers and sand delivery", vendor: "Lowe's", date: "2026-07-01" });
  const bare = rcptInfoScore({ vendor: "Lowe's", amount: 26.67, refNo: "999" });   // thin CSV row: vendor + (no photo/items/card/cat/job/date)
  ok("rich copy outscores the bare CSV row", rich.score > bare.score, [rich.score, bare.score]);
  ok("photo dominates: same row WITH a photo outscores WITHOUT (a re-uploaded photo beats a thin CSV row)", rcptInfoScore({ receiptId: "x", vendor: "Lowe's" }).score > rcptInfoScore({ vendor: "Lowe's" }).score, [rcptInfoScore({ receiptId: "x", vendor: "Lowe's" }).score, rcptInfoScore({ vendor: "Lowe's" }).score]);
  ok("photo (+5) is the single largest weight (beats line items +3)", rcptInfoScore({ receiptId: "x" }).score === 5 && rcptInfoScore({ suggested: { lineItems: [1] } }).score === 3);
  ok("has/missing explain the reasons", rich.has.indexOf("photo") >= 0 && rich.has.indexOf("line items") >= 0 && bare.missing.indexOf("photo") >= 0, { has: rich.has, missing: bare.missing });
  ok("weights: photo 5 + items 3 + card/cat/job/desc/vendor/date 1 ea = 14 (max)", rich.score === 14, rich.score);
  ok("short desc (<12 chars) does NOT score", rcptInfoScore({ desc: "paver" }).has.indexOf("description") < 0 && rcptInfoScore({ desc: "pavers & 3 bags sand" }).has.indexOf("description") >= 0);
  ok("a Cap-'unknown' date does NOT count as a date", rcptInfoScore({ date: "unknown" }).has.indexOf("date") < 0 && rcptInfoScore({ date: "2026-07-01" }).has.indexOf("date") >= 0);

  console.log("— RESOLVER (MERGE-first): '🔗 Merge into one receipt' is the primary action + a preview —");
  resetStore(); global.finCanView = function () { return true; };
  const recKeep = seedReview({ receiptId: "photo.jpg", vendor: "Lowe's", amount: 26.67, cardLast4: "8355", category: "materials", jobId: "j1", desc: "pavers and sand delivery" });
  const recThin = seedReview({ receiptId: "", vendor: "Lowe's", amount: 26.67, refNo: "1234" });   // thin CSV row (no photo)
  recThin.receiptId = "";
  const rankHtml = rcptDupResolveHTML();
  ok("resolver's PRIMARY action is '🔗 Merge into one receipt' (not delete)", /🔗 Merge into one receipt/.test(rankHtml) && /rcptDupMerge\(/.test(rankHtml));
  ok("the delete-the-thinner one-tap is GONE (no longer the recommended default)", !/Keep the richest · delete/.test(rankHtml) && !/rcptDupKeepRichest\(/.test(rankHtml));
  ok("a merge PREVIEW of what it keeps is shown (Keeps: … photo …)", /Keeps:/.test(rankHtml) && /photo/.test(rankHtml));
  ok("the survivor row is labeled '✅ Survivor — keeps its billing + your categorization'", /✅ Survivor — keeps its billing/.test(rankHtml));
  ok("the absorbed copy is labeled '↪ folds into the survivor' (nothing lost)", /↪ folds into the survivor/.test(rankHtml));
  ok("per-copy '🗑 Delete this copy' stays as a SECONDARY manual option", /rcptDupDelete\(/.test(rankHtml) && /🗑 Delete this copy/.test(rankHtml));

  console.log("— RESOLVER: two photo copies filed to DIFFERENT jobs surface the landing job + per-copy 'Merge into THIS one' —");
  resetStore(); global.finCanView = function () { return true; };
  seedReview({ receiptId: "a.jpg", vendor: "Home Depot", amount: 40.00, cardLast4: "8355", jobId: "j1" });   // photo + card + job
  seedReview({ receiptId: "b.jpg", vendor: "Home Depot", amount: 40.00, cardLast4: "8355", jobId: "j2" });   // photo + card + job (diff job) → near-tie
  const tieHtml = rcptDupResolveHTML();
  ok("near-tie is labeled '≈ Similar — your call'", /≈ Similar — your call/.test(tieHtml));
  ok("still offers MERGE on a near-tie (no delete-one-tap)", /🔗 Merge into one receipt/.test(tieHtml) && !/rcptDupKeepRichest\(/.test(tieHtml));
  ok("surfaces which job the merged receipt lands on (different jobs warning)", /filed to <b>different jobs<\/b>/.test(tieHtml) && /The merge lands on/.test(tieHtml));
  ok("lets Ray pick the survivor per copy (🔗 Merge into THIS one)", /🔗 Merge into THIS one/.test(tieHtml));

  console.log("— ONE-TAP: rcptDupKeepRichest keeps the top, soft-deletes exactly the thinner via rcptTombstone —");
  resetStore(); global.finCanView = function () { return true; };
  const otKeep = seedReview({ receiptId: "keep.jpg", vendor: "Lowe's", amount: 55.55, cardLast4: "8355", category: "materials", jobId: "j1", desc: "long enough description here" });
  const otThin1 = seedReview({ receiptId: "", vendor: "Lowe's", amount: 55.55, refNo: "a" }); otThin1.receiptId = "";
  const otThin2 = seedReview({ receiptId: "", vendor: "Lowe's", amount: 55.55, cardLast4: "8355" }); otThin2.receiptId = "";
  const topId = rcptInfoScore(otKeep).score;   // sanity: keep scores highest
  ok("pre: all 3 in one group, keep scores highest", rcptDupGroups().length === 1 && rcptDupGroups()[0].length === 3 && rcptInfoScore(otKeep).score > rcptInfoScore(otThin1).score && rcptInfoScore(otKeep).score > rcptInfoScore(otThin2).score);
  rcptDupKeepRichest("review", "", otKeep.id);
  ok("richest (recommended-keep) is NEVER deleted", !STORE.receipts.find(r => r.id === otKeep.id).deleted);
  ok("both thinner copies soft-deleted via the existing tombstone path", STORE.receipts.find(r => r.id === otThin1.id).deleted === true && STORE.receipts.find(r => r.id === otThin2.id).deleted === true);
  ok("no group remains after the one-tap", rcptDupGroups().length === 0);

  console.log("— ONE-TAP GUARD: rcptDupKeepRichest refuses when the id isn't the richest (never deletes the richer copy) —");
  resetStore(); global.finCanView = function () { return true; };
  const grKeep = seedReview({ receiptId: "rich.jpg", vendor: "Lowe's", amount: 33.33, cardLast4: "8355", category: "materials", jobId: "j1", desc: "long enough description here" });
  const grThin = seedReview({ receiptId: "", vendor: "Lowe's", amount: 33.33, refNo: "z" }); grThin.receiptId = "";
  rcptDupKeepRichest("review", "", grThin.id);   // caller passes the THIN id → must refuse
  ok("passing the thinner id deletes NOTHING (guard refuses)", !STORE.receipts.find(r => r.id === grKeep.id).deleted && !STORE.receipts.find(r => r.id === grThin.id).deleted);

  console.log("— ONE-TAP: refuses on a near-tie (owner's call, no auto-delete) —");
  resetStore(); global.finCanView = function () { return true; };
  const ntA = seedReview({ receiptId: "na.jpg", vendor: "Home Depot", amount: 41.00, cardLast4: "8355", jobId: "j1" });
  const ntB = seedReview({ receiptId: "nb.jpg", vendor: "Home Depot", amount: 41.00, cardLast4: "8355", jobId: "j2" });
  rcptDupKeepRichest("review", "", ntA.id);
  ok("near-tie one-tap deletes nothing", !STORE.receipts.find(r => r.id === ntA.id).deleted && !STORE.receipts.find(r => r.id === ntB.id).deleted);

  console.log("— DETECTION unchanged: recommendation is display-only, groups match the pre-change detector —");
  resetStore();
  seedReview({ receiptId: "p1.jpg", vendor: "Lowe's", amount: 26.67, cardLast4: "8355" });
  seedReview({ receiptId: "", vendor: "Lowe's", amount: 26.67 });
  ok("scoring adds NO groups and drops none (same tolerant detection)", rcptDupGroups().length === 1 && rcptDupGroups()[0].length === 2, rcptDupGroups().map(g => g.length));

  // ============ DUPLICATE MERGE (Ray's insight: COMBINE copies, don't delete one) — js/72 rcptMergeFields / rcptMergeGroup ============
  console.log("\n— MERGE CORE (rcptMergeFields): folds the best of each copy; never blanks a field any copy had —");
  // a FILED copy (human categorized/billed, no photo) + a REVIEW copy (clearer photo + richest Cap read, blank category)
  const mfFiled = { store: "jobexp", jobId: "j1", recId: "s1", receiptId: "", category: "fuel", vendor: "Depot", amount: 90, date: "2026-07-01", paidBy: "u_chase", desc: "gas station" };
  const mfReview = { store: "review", jobId: null, recId: "r1", receiptId: "clear.jpg", suggested: { lineItems: [1, 2, 3] }, category: "", vendor: "Depot", amount: 90, cardLast4: "8355" };
  const mf = rcptMergeFields([mfFiled, mfReview]);
  ok("survivor is the FILED copy when one exists (billing home preserved)", mf.survivor === mfFiled && mf.survivorLoc.store === "jobexp" && mf.survivorLoc.jobId === "j1");
  ok("keeps the PHOTO from the copy that has one (a re-uploaded clearer photo)", mf.fields.receiptId === "clear.jpg");
  ok("keeps the human-set CATEGORY over a blank/guess", mf.fields.category === "fuel");
  ok("keeps the human-set JOB (survivor's billing home)", mf.fields.jobId === "j1" && mf.fields.type === "job-expense");
  ok("keeps the RICHEST line items", mf.fields.suggested && mf.fields.suggested.lineItems.length === 3);
  ok("never blanks a field any copy had — pulls the card the review copy carried", mf.fields.cardLast4 === "8355");
  ok("survivor's manual work wins but the review's photo folds in (both survive — nothing lost)", mf.fields.category === "fuel" && mf.fields.receiptId === "clear.jpg" && mf.fields.vendor === "Depot" && mf.fields.amount === 90);

  console.log("— MERGE CORE: a REAL date beats a Cap 'unknown' (the ISO guard) —");
  const mfDate = rcptMergeFields([
    { store: "review", recId: "a", receiptId: "x", date: "unknown", vendor: "V", amount: 5 },   // survivor (first) has a Cap 'unknown'
    { store: "review", recId: "b", receiptId: "y", date: "2026-07-02", vendor: "V", amount: 5 }
  ]);
  ok("merged date is the real YYYY-MM-DD, not 'unknown'", mfDate.fields.date === "2026-07-02");

  console.log("— MERGE CORE: never blanks a value — a field the survivor lacks is filled from another copy —");
  const mfFill = rcptMergeFields([
    { store: "review", recId: "a", receiptId: "x", vendor: "Lowe's", amount: 12, category: "" },
    { store: "review", recId: "b", receiptId: "", vendor: "", amount: 12, category: "materials", desc: "pavers and sand" }
  ]);
  ok("blank category filled from the other copy (materials)", mfFill.fields.category === "materials");
  ok("blank desc filled from the other copy", mfFill.fields.desc === "pavers and sand");
  ok("survivor's vendor kept (its own non-blank value wins)", mfFill.fields.vendor === "Lowe's");

  console.log("— MERGE CORE: near-tie survivor selection is EXPLICIT (forcedSurvivorId → lands on THAT copy's job) —");
  const twoJobsGroup = [
    { store: "jobmat", jobId: "j1", recId: "pa", receiptId: "a.jpg", vendor: "Home Depot", amount: 40, cardLast4: "8355" },
    { store: "jobmat", jobId: "j2", recId: "pb", receiptId: "b.jpg", vendor: "Home Depot", amount: 40, cardLast4: "8355" }
  ];
  ok("forcing copy B → survivor is B, merge lands on job j2", rcptMergeFields(twoJobsGroup, "pb").survivor.recId === "pb" && rcptMergeFields(twoJobsGroup, "pb").fields.jobId === "j2");
  ok("forcing copy A → survivor is A, merge lands on job j1", rcptMergeFields(twoJobsGroup, "pa").survivor.recId === "pa" && rcptMergeFields(twoJobsGroup, "pa").fields.jobId === "j1");

  console.log("— MERGE END-TO-END (rcptMergeGroup): ONE record via rcptApplyEdit + the others soft-deleted (reversible) —");
  resetStore(); global.finCanView = function () { return true; };
  const survRev = seedReview({ receiptId: "old.jpg", vendor: "Depot", amount: 90, date: "2026-07-01" });
  const fres = rcptApplyEdit({ store: "review", jobId: null, recId: survRev.id }, { type: "job-expense", jobId: "j1", amount: 90, vendor: "Depot", date: "2026-07-01", category: "fuel", paidBy: "u_chase", attributedTo: "u_chase", desc: "gas station", receiptId: "old.jpg" });
  ok("pre: the manual copy is FILED to j1.expenses (human categorized)", fres.ok && STORE.jobs[0].expenses.some(e => e.id === survRev.id && !e.deleted));
  const better = seedReview({ receiptId: "clear.jpg", vendor: "Depot", amount: 90, suggested: { lineItems: [1, 2, 3] } });
  const grp = rcptDupGroups()[0];
  ok("pre: the filed copy + the clearer review copy form ONE dup group of 2", grp && grp.length === 2);
  const mres = rcptMergeGroup(grp);
  ok("merge succeeds, absorbs exactly 1 copy", mres.ok && mres.absorbed === 1, mres);
  const survFiled = rcptFindRecord("jobexp", "j1", survRev.id);
  ok("survivor keeps its id + billing home (still in j1.expenses)", !!survFiled && mres.newLoc.store === "jobexp" && mres.newLoc.jobId === "j1" && mres.newLoc.recId === survRev.id);
  ok("survivor kept the human category (fuel) + swapped in the CLEARER photo", survFiled.category === "fuel" && survFiled.receiptId === "clear.jpg");
  ok("survivor absorbed the richest line items", survFiled.suggested && survFiled.suggested.lineItems.length === 3);
  ok("the absorbed copy is soft-deleted (reversible, not hard-gone)", STORE.receipts.find(r => r.id === better.id).deleted === true);
  ok("exactly ONE live copy remains — no dup group left", rcptDupGroups().length === 0);
  ok("merge NEVER blanked the vendor/amount the survivor had", survFiled.vendor === "Depot" && survFiled.amount === 90);

  console.log("— MERGE END-TO-END: forcing the OTHER copy as survivor lands the merge on ITS home (Ray overrides) —");
  resetStore(); global.finCanView = function () { return true; };
  const revA = seedReview({ receiptId: "pa.jpg", vendor: "Home Depot", amount: 40, date: "2026-07-01" });
  const mgFileA = rcptApplyEdit({ store: "review", jobId: null, recId: revA.id }, { type: "pass-through", jobId: "j1", amount: 40, vendor: "Home Depot", date: "2026-07-01", category: "materials", desc: "pavers here", receiptId: "pa.jpg" });
  const revJB = seedReview({ receiptId: "pb.jpg", vendor: "Home Depot", amount: 40, date: "2026-07-01" });
  const mgFileB = rcptApplyEdit({ store: "review", jobId: null, recId: revJB.id }, { type: "pass-through", jobId: "j2", amount: 40, vendor: "Home Depot", date: "2026-07-01", category: "materials", desc: "pavers here", receiptId: "pb.jpg" });
  ok("pre: two photo copies filed to DIFFERENT jobs (near-tie)", mgFileA.ok && mgFileB.ok && rcptDupGroups().length === 1 && rcptDupGroups()[0].length === 2);
  const grp2 = rcptDupGroups()[0];
  const mres2 = rcptMergeGroup(grp2, revJB.id);   // Ray picks copy B (j2) as survivor
  ok("merge lands on the CHOSEN survivor's job (j2), not the auto pick", mres2.ok && mres2.newLoc.jobId === "j2" && mres2.newLoc.recId === revJB.id);
  ok("the other job's copy (j1) is soft-deleted", !STORE.jobs[0].materials.find(e => e.id === revA.id && !e.deleted) && STORE.jobs[1].materials.some(e => e.id === revJB.id && !e.deleted));

  console.log("— MARK-AS-DUP: the edit-modal rcptEditMarkDup soft-deletes THIS receipt (existing path), keeps the other —");
  resetStore(); global.finCanView = function () { return true; }; global.modal = global.modal || function () {}; global.val = global.val || function () { return ""; };
  const mKeep = seedReview({ receiptId: "m1", vendor: "Lowe's", amount: 26.67, cardLast4: "8355" });
  const mDel = seedReview({ receiptId: "m2", vendor: "Lowe's", amount: 26.67 });
  rcptEditOpen("review", null, mDel.id);   // sets RCPT_EDIT to the copy to delete
  rcptEditMarkDup();                        // confirm() stub → true
  ok("marked receipt is tombstoned", STORE.receipts.find(r => r.id === mDel.id).deleted === true);
  ok("the other copy is untouched", !STORE.receipts.find(r => r.id === mKeep.id).deleted);

  // ================= RECEIPT SPINE (js/98) — smart-defaults + the BYTE-IDENTICAL file funnel =================
  console.log("\n— SPINE: rcptFileFromFields produces a BYTE-IDENTICAL record to a hand rcptApplyEdit save —");
  OPEN_SHIFT = null; delete CURUSER.cards;   // no clocked job + no cards → smart-defaults add nothing to fully-specified fields

  function stripVol(r) { if (!r) return r; const c = Object.assign({}, r); delete c.id; delete c.ts; delete c.updatedAt; return c; }
  // hand path: the exact human save = a review stub + rcptApplyEdit(store:review) with the same fields
  function handSave(fields) {
    resetStore();
    const stub = rcptNewReview(fields.receiptId || null); STORE.receipts.push(stub);
    const res = rcptApplyEdit({ store: "review", jobId: null, recId: stub.id }, fields);
    return { res: res, rec: res.ok ? rcptFindRecord(res.newLoc.store, res.newLoc.jobId, res.newLoc.recId) : null };
  }
  function funnelSave(fields) {
    resetStore();
    const res = rcptFileFromFields(fields, { meId: "u_nobody", batch: true });
    return { res: res, rec: res.ok ? rcptFindRecord(res.newLoc.store, res.newLoc.jobId, res.newLoc.recId) : null };
  }
  function identity(name, fields, expectStore, extra) {
    const h = handSave(fields), f = funnelSave(fields);
    ok(name + ": funnel filed into " + expectStore, f.res.ok && f.res.newLoc.store === expectStore, f.res);
    const eq = JSON.stringify(stripVol(f.rec)) === JSON.stringify(stripVol(h.rec));
    ok(name + ": DEEP-EQUAL to hand-saved (minus id/ts)", eq, eq ? undefined : { funnel: stripVol(f.rec), hand: stripVol(h.rec) });
    if (typeof extra === "function") extra(f.rec);
  }

  identity("business", { type: "business", jobId: null, amount: 120, vendor: "CostcoBiz", date: "2026-07-01", category: "office/admin", paidBy: null, desc: "paper", receiptId: "blobB", cardLast4: "", isDeposit: false, kind: "" }, "biz",
    rec => ok("  business → org expenses[] with category", rec.category === "office/admin", rec.category));
  identity("pass-through", { type: "pass-through", jobId: "j1", amount: 200, vendor: "PaverCo", category: "materials", paidBy: "u_chase", cardLast4: "4321", desc: "pavers", receiptId: "blobP" }, "jobmat",
    rec => ok("  pass-through carries cardLast4 4321", rec.cardLast4 === "4321", rec.cardLast4));
  identity("job-expense", { type: "job-expense", jobId: "j1", amount: 45, vendor: "DumpCo", category: "disposal", paidBy: "u_chase", desc: "dump", receiptId: "blobJ" }, "jobexp",
    rec => ok("  job-expense carries its category", rec.category === "disposal", rec.category));
  identity("refund (negative)", { type: "job-expense", jobId: "j1", amount: -30, vendor: "RefundCo", category: "disposal", paidBy: null, receiptId: "blobR", kind: "refund" }, "jobexp",
    rec => ok("  refund → NEGATIVE amount + kind:refund", rec.amount === -30 && rec.kind === "refund", { amt: rec.amount, kind: rec.kind }));
  identity("deposit", { type: "job-expense", jobId: "j1", amount: 150, vendor: "RentCo", category: "rentals", paidBy: "u_chase", cardLast4: "1234", receiptId: "blobD", isDeposit: true }, "jobexp",
    rec => ok("  deposit → isDeposit:true flag carried", rec.isDeposit === true && rec.cardLast4 === "1234", { dep: rec.isDeposit, card: rec.cardLast4 }));

  console.log("— SPINE: rcptFileFromFields validation guards (no alert, returns {ok:false,error}) —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  ok("rejects a job-type WITHOUT a job", rcptFileFromFields({ type: "job-expense", vendor: "X", amount: 50 }, { meId: "u_nobody", batch: true }).ok === false);
  ok("rejects a filed type with amount 0", rcptFileFromFields({ type: "business", vendor: "X", amount: 0 }, { meId: "u_nobody", batch: true }).ok === false);
  ok("rejects a filed type with NO vendor", rcptFileFromFields({ type: "business", vendor: "", amount: 50 }, { meId: "u_nobody", batch: true }).ok === false);
  ok("rejects a negative amount that is NOT a refund", rcptFileFromFields({ type: "business", vendor: "X", amount: -5 }, { meId: "u_nobody", batch: true }).ok === false);
  ok("a valid business receipt files ok", rcptFileFromFields({ type: "business", vendor: "X", amount: 50, category: "other" }, { meId: "u_nobody", batch: true }).ok === true);

  console.log("— SPINE: rcptVendorMemory returns the LAST filed vendor's category + bucket —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  rcptFileFromFields({ type: "business", vendor: "Lowe's", amount: 40, category: "materials", receiptId: "blobL" }, { meId: "u_nobody", batch: true });
  const mem = rcptVendorMemory("lowe's");
  ok("vendor memory (case-insensitive) → last category", mem && mem.category === "materials", mem);
  ok("vendor memory → bucket→type (business)", mem && mem.type === "business", mem);
  ok("vendor memory → null for an unseen vendor", rcptVendorMemory("NeverBoughtHere") === null);

  console.log("— SPINE: rcptSmartDefaults resolves the clocked-in job but NEVER stamps the viewer as payer —");
  resetStore();
  CURUSER.cards = [{ id: "c1", last4: "9999", kind: "personal" }];
  OPEN_SHIFT = { userId: "u_ray", jobId: "j1" };
  const sd = rcptSmartDefaults({ meId: "u_ray" });
  ok("clocked-in job → jobId j1", sd.jobId === "j1", sd.jobId);
  ok("NO LONGER stamps the viewer as payer — paidBy '' + cardLast4 '' even with a personal card", sd.paidBy === "" && sd.cardLast4 === "", sd);
  OPEN_SHIFT = null; delete CURUSER.cards;
  CURUSER.cards = [{ id: "c2", last4: "1000", kind: "business" }];
  const sdBiz = rcptSmartDefaults({ meId: "u_ray" });
  ok("business-only card → still paidBy '' + NO card stamped (who-paid follows the card, not the viewer)", sdBiz.paidBy === "" && sdBiz.cardLast4 === "", sdBiz);
  delete CURUSER.cards;
  const sdNone = rcptSmartDefaults({ meId: "u_ray" });
  ok("no card → paidBy '' + cardLast4 ''", sdNone.paidBy === "" && sdNone.cardLast4 === "", sdNone);

  console.log("— WHO PAID follows the CARD, never the viewer (js/98 mergeDefaults + rcptFileSuggestion; unknown 1077 = NOBODY) —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; CURUSER = { id: "u_ray", username: "Ray" };   // the VIEWER/filer = Ray
  const _uW = S.users, _rW = S.registry;
  S.users = [{ id: "u_chase", username: "Chase", cards: [{ id: "kC", last4: "4242", kind: "personal" }] }, { id: "u_ray", username: "Ray", cards: [] }];
  S.registry = [{ id: "obx", businessCards: [{ id: "bB", last4: "3005", active: true }] }];
  // helper: file a review row (uploaded by Chase) from a Cap suggestion carrying a card last-4, return the filed biz record
  function fileCardSugg(receiptId, last4) {
    const rec = seedReview({ receiptId: receiptId, uploadedBy: "u_chase", attributedTo: "u_chase" });   // Chase uploaded it
    rec.suggested = { confidence: 0.95, amount: 50, type: "business", vendor: "V", category: "other", desc: "x", last4: last4 };
    rcptFileSuggestion("review", null, rec.id);
    return (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === receiptId);
  }
  const pcFiled = fileCardSugg("wp_personal", "4242");   // Chase's registered personal card
  ok("PERSONAL card → paidBy = the card owner (Chase), NOT the viewer (Ray)", pcFiled && pcFiled.paidBy === "u_chase", pcFiled && pcFiled.paidBy);
  ok("PERSONAL card → attributedTo = the card owner (Chase), never the viewer", pcFiled && pcFiled.attributedTo === "u_chase", pcFiled && pcFiled.attributedTo);
  resetStore();
  const bcFiled = fileCardSugg("wp_business", "3005");   // registered company card
  ok("BUSINESS card → paidBy '' (no reimburse), NOT the viewer", bcFiled && !bcFiled.paidBy, bcFiled && bcFiled.paidBy);
  ok("BUSINESS card → attributedTo = the uploader (Chase), never the viewer (Ray)", bcFiled && bcFiled.attributedTo === "u_chase", bcFiled && bcFiled.attributedTo);
  resetStore();
  const ukFiled = fileCardSugg("wp_unknown", "1077");   // Ray's real bug: an UNKNOWN/unregistered card
  ok("UNKNOWN card 1077 → paidBy '' (NOBODY), NOT the viewer (Ray)", ukFiled && !ukFiled.paidBy, ukFiled && ukFiled.paidBy);
  ok("UNKNOWN card 1077 → attributedTo = the uploader (Chase), never the viewer (Ray)", ukFiled && ukFiled.attributedTo === "u_chase", ukFiled && ukFiled.attributedTo);
  // rcptFileFromFields funnel (snap/floating capture): a personal card resolves the payer, no card → nobody
  resetStore();
  rcptFileFromFields({ type: "business", vendor: "V2", amount: 25, category: "other", receiptId: "wp_ff", cardLast4: "4242" }, { meId: "u_ray", batch: true });
  const ffFiled = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "wp_ff");
  ok("funnel: a receipt on Chase's personal card → paidBy = Chase, not the filer (Ray)", ffFiled && ffFiled.paidBy === "u_chase", ffFiled && ffFiled.paidBy);
  resetStore();
  rcptFileFromFields({ type: "business", vendor: "V3", amount: 25, category: "other", receiptId: "wp_ff2" }, { meId: "u_ray", batch: true });
  const ffNone = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "wp_ff2");
  ok("funnel: NO card → paidBy '' (nobody), never the filer", ffNone && !ffNone.paidBy, ffNone && ffNone.paidBy);
  S.users = _uW; S.registry = _rW;

  console.log("— PO AUTO-FILL (js/87 rcptJobPONote + js/95 jobPO): picking/assigning a job fills the PO field —");
  resetStore();
  STORE.jobs[0].poNum = 1042;   // jobPO(j1) → "P1042"
  STORE.jobs[1].poNum = 1050;   // jobPO(j2) → "P1050"
  const _valPO = global.val, _geiPO = global.document.getElementById;
  const poEls = { rcpt_po: { value: "" }, rcpt_po_note: { innerHTML: "" }, rcpt_job: { value: "" } };
  let _poJob = "j1";
  global.document.getElementById = function (id) { return Object.prototype.hasOwnProperty.call(poEls, id) ? poEls[id] : null; };
  global.val = function (id) { return id === "rcpt_job" ? _poJob : ""; };
  rcptJobPONote();
  ok("selecting job j1 auto-fills rcpt_po = P1042 (no button)", poEls.rcpt_po.value === "P1042", poEls.rcpt_po.value);
  ok("the PO note shows the job's PO", /P1042/.test(poEls.rcpt_po_note.innerHTML), poEls.rcpt_po_note.innerHTML);
  _poJob = "j2"; rcptJobPONote();   // Cap/owner switches the job → the PO follows
  ok("switching to j2 (owner or Cap) updates rcpt_po = P1050", poEls.rcpt_po.value === "P1050", poEls.rcpt_po.value);
  _poJob = ""; poEls.rcpt_po.value = "P1050"; rcptJobPONote();   // no job selected → a typed lookup PO is left alone
  ok("no job selected → does NOT clobber a PO the owner is typing to look up", poEls.rcpt_po.value === "P1050", poEls.rcpt_po.value);
  global.val = _valPO; global.document.getElementById = _geiPO;

  console.log("— SPINE: rcptSuggestionOneTapOk threshold + job-resolution —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  ok("high-confidence business → ok", rcptSuggestionOneTapOk({ suggested: { confidence: 0.9, amount: 50, type: "business" } }) === true);
  ok("below-threshold (0.7) → NOT ok", rcptSuggestionOneTapOk({ suggested: { confidence: 0.7, amount: 50, type: "business" } }) === false);
  ok("job-type WITH suggested job → ok", rcptSuggestionOneTapOk({ suggested: { confidence: 0.85, amount: 50, type: "job-expense", jobId: "j1" } }) === true);
  ok("job-type WITHOUT a resolvable job → NOT ok", rcptSuggestionOneTapOk({ suggested: { confidence: 0.9, amount: 50, type: "job-expense" } }) === false);
  ok("zero amount → NOT ok", rcptSuggestionOneTapOk({ suggested: { confidence: 0.9, amount: 0, type: "business" } }) === false);
  OPEN_SHIFT = { userId: "u_ray", jobId: "j1" };
  ok("job-type, no suggested job but clocked-in job resolves → ok", rcptSuggestionOneTapOk({ suggested: { confidence: 0.9, amount: 50, type: "job-expense", vendor: "X" } }) === true);
  OPEN_SHIFT = null;

  // ================= PHASE B — ONE-TAP + BULK FILE (js/72 + js/88, funneled through the js/98 spine) =================
  console.log("\n— PHASE B: one-tap file lands a confident review row in the right home, BYTE-IDENTICAL to a hand save —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  const handFieldsB = { type: "business", jobId: null, amount: 120, vendor: "CostcoBiz", date: "2026-07-01", category: "office/admin", desc: "paper", paidBy: null, receiptId: "blobBB", cardLast4: "", isDeposit: false, kind: "" };
  const handRefB = handSave(handFieldsB).rec;   // the manual save (handSave resets the store)
  resetStore();
  const sugB = { confidence: 0.9, amount: 120, type: "business", vendor: "CostcoBiz", date: "2026-07-01", category: "office/admin", desc: "paper" };
  const revB = seedReview({ receiptId: "blobBB", suggested: sugB });
  ok("predicate gates the button: confident business row → one-tap OK", rcptSuggestionOneTapOk(revB) === true);
  rcptFileItRow("review", null, revB.id);
  const filedBizB = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "blobBB");
  ok("one-tap → landed in org expenses[] (business home)", !!filedBizB);
  ok("one-tap → the review row left the queue (tombstoned)", rcptReview().every(r => r.id !== revB.id));
  const eqB = filedBizB && JSON.stringify(stripVol(filedBizB)) === JSON.stringify(stripVol(handRefB));
  ok("one-tap filed record is BYTE-IDENTICAL to the hand save (minus id/ts)", eqB, eqB ? undefined : { oneTap: stripVol(filedBizB), hand: stripVol(handRefB) });

  console.log("— PHASE B: rcptFileAllConfident files EVERY confident row in ONE save, LEAVES low-confidence in review —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  seedReview({ receiptId: "blobC1", suggested: { confidence: 0.9, amount: 60, type: "business", vendor: "Lowe's", category: "materials", desc: "screws" } });
  seedReview({ receiptId: "blobC2", suggested: { confidence: 0.88, amount: 45, type: "job-expense", jobId: "j1", vendor: "DumpCo", category: "disposal", desc: "dump" } });
  seedReview({ receiptId: "blobLo", suggested: { confidence: 0.5, amount: 20, type: "business", vendor: "Gas", category: "fuel" } });
  seedReview({ receiptId: "blobNo" });   // no suggestion at all
  let bulkSaves = 0; const _origSave = global.save; global.save = function () { bulkSaves++; };
  rcptFileAllConfident();
  global.save = _origSave;
  ok("bulk → exactly ONE save() for the whole batch", bulkSaves === 1, bulkSaves);
  ok("bulk → c1 (business) filed into org expenses[]", (STORE.expenses || []).some(e => e && !e.deleted && e.receiptId === "blobC1"));
  ok("bulk → c2 (job-expense) filed into job j1 expenses[]", ((STORE.jobs.find(j => j.id === "j1") || {}).expenses || []).some(e => e && !e.deleted && e.receiptId === "blobC2"));
  const stillReviewIds = rcptReview().map(r => r.receiptId);
  ok("bulk → LOW-confidence row stays in review", stillReviewIds.indexOf("blobLo") >= 0);
  ok("bulk → no-suggestion row stays in review", stillReviewIds.indexOf("blobNo") >= 0);
  ok("bulk → confident rows left review", stillReviewIds.indexOf("blobC1") < 0 && stillReviewIds.indexOf("blobC2") < 0);
  let bulkSaves2 = 0; global.save = function () { bulkSaves2++; };
  rcptFileAllConfident();   // idempotent — nothing confident left to file
  global.save = _origSave;
  ok("bulk re-run → nothing to file, no save() (idempotent)", bulkSaves2 === 0, bulkSaves2);

  console.log("— PHASE B: rcptTableHTML renders the one-tap 'file it' button on a confident review row (gated by the predicate) —");
  global.money2 = function (n) { return "$" + (+n || 0).toFixed(2); };   // js/02 helper (not loaded here)
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  const smokeRow = seedReview({ receiptId: "blobSmoke", suggested: { confidence: 0.9, amount: 99, type: "business", vendor: "SmokeCo", category: "other", desc: "x" } });
  const tblSmoke = rcptTableHTML(rcptAllRows(), {});
  ok("table shows a 'file it' button wired to rcptFileItRow on the confident row", /file it/.test(tblSmoke) && /rcptFileItRow\(/.test(tblSmoke));
  rcptFileItRow("review", smokeRow.jobId || "", smokeRow.id);
  ok("tapping 'file it' filed the smoke receipt (left review + landed in a home)", rcptReview().every(r => r.id !== smokeRow.id) && (STORE.expenses || []).some(e => e && e.receiptId === "blobSmoke"));
  resetStore();
  seedReview({ receiptId: "blobLow2", suggested: { confidence: 0.4, amount: 10, type: "business", vendor: "L", category: "other" } });
  const tblLow = rcptTableHTML(rcptAllRows(), {});
  ok("table shows NO 'file it' button on a LOW-confidence row", !/rcptFileItRow\(/.test(tblLow));

  // ================= CAP AUTO-APPLY + PURPLE "🤖 review" MARK (js/88 auto-file, js/72 mark/clear/filter) =================
  // Ray: "default to using Cap's guess … mark everything Cap put in with that purple mark so I know I need to
  // review it … future only." Auto-apply reuses rcptFileSuggestion (the SAME spine the "✓ file it" button uses) →
  // byte-identical filed record + additive capAutoFiled/capReviewedAt flags. NON-RETROACTIVE; finance-safe.
  console.log("\n— CAP AUTO-APPLY: a CONFIDENT read auto-files via rcptFileSuggestion + stamps capAutoFiled/capReviewedAt:null —");
  const stripCap = r => { if (!r) return r; const c = stripVol(r); delete c.capAutoFiled; delete c.capReviewedAt; delete c.capAutoAt; return c; };
  window.CAP_RCPT_THROTTLE_MS = 0;
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; CURUSER = { id: "u_ray", username: "Ray" };
  global.finCanView = function () { return true; };
  const AUTO_SUGG = { confidence: 0.92, amount: 88, type: "business", vendor: "AutoCostco", date: "2026-07-01", category: "office/admin", desc: "paper" };
  const autoRec = seedReview({ receiptId: "blobAuto", vendor: "", amount: null, type: null, jobId: null, category: "" });
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: AUTO_SUGG }) }); };
  await capRcptRun({ auto: true });
  const autoFiled = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "blobAuto");
  ok("confident read → auto-filed into org expenses[] (left the review queue)", !!autoFiled && rcptReview().every(r => r.id !== autoRec.id), { autoFiled: !!autoFiled, stillReview: rcptReview().map(r => r.receiptId) });
  ok("auto-filed record stamped capAutoFiled:true + capReviewedAt:null", !!autoFiled && autoFiled.capAutoFiled === true && autoFiled.capReviewedAt === null, autoFiled && { f: autoFiled.capAutoFiled, r: autoFiled.capReviewedAt });
  ok("auto-filed record stamped capAutoAt (a timestamp)", !!autoFiled && typeof autoFiled.capAutoAt === "number");
  ok("auto-filed record carries NO leftover `suggested` (distinct from the pre-file 🤖 Cap badge)", !!autoFiled && !autoFiled.suggested);
  // BYTE-IDENTICAL to a manual one-tap file of the SAME suggestion (minus id/ts + the additive cap* flags)
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; CURUSER = { id: "u_ray", username: "Ray" };
  const manualRec = seedReview({ receiptId: "blobAuto", vendor: "", amount: null, type: null, jobId: null, category: "", suggested: AUTO_SUGG });
  const manRes = rcptFileSuggestion("review", null, manualRec.id);
  const manualFiled = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "blobAuto");
  const eqAuto = autoFiled && manualFiled && JSON.stringify(stripCap(autoFiled)) === JSON.stringify(stripCap(manualFiled));
  ok("auto-filed record is BYTE-IDENTICAL to the manual one-tap file (minus id/ts + additive cap flags)", eqAuto, eqAuto ? undefined : { auto: stripCap(autoFiled), manual: stripCap(manualFiled) });
  ok("the manual one-tap file has NO cap flags (non-retroactive / marker is auto-only)", !!manualFiled && !("capAutoFiled" in manualFiled) && !("capReviewedAt" in manualFiled));

  console.log("— CAP AUTO-APPLY: a LOW-confidence / incomplete guess is NOT auto-filed (stays suggested in review) —");
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  const lowRec = seedReview({ receiptId: "blobLowAuto" });
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: { confidence: 0.5, amount: 20, type: "business", vendor: "Gas", category: "fuel" } }) }); };
  await capRcptRun({ auto: true });
  const lowAfter = rcptReview().find(r => r.id === lowRec.id);
  ok("low-confidence → NOT auto-filed (still in review)", !!lowAfter, lowAfter);
  ok("low-confidence review row got the suggestion (owner reviews it as today)", !!lowAfter && lowAfter.suggested && lowAfter.suggested.amount === 20);
  ok("low-confidence row has NO capAutoFiled flag", !!lowAfter && !("capAutoFiled" in lowAfter));
  ok("low-confidence row did NOT land in any billing home", (STORE.expenses || []).every(e => e.receiptId !== "blobLowAuto"));
  // incomplete: confident job-type but NO resolvable job → also stays in review
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  const incRec = seedReview({ receiptId: "blobIncAuto" });
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: { confidence: 0.95, amount: 50, type: "job-expense", vendor: "DumpCo" } }) }); };
  await capRcptRun({ auto: true });
  const incAfter = rcptReview().find(r => r.id === incRec.id);
  ok("confident job-type WITH no resolvable job → NOT auto-filed (stays in review)", !!incAfter && !("capAutoFiled" in incAfter), incAfter);

  console.log("— CAP AUTO-APPLY: rcptNeedsCapReview + the purple badge/tint show ONLY on unreviewed auto-filed rows —");
  global.money2 = function (n) { return "$" + (+n || 0).toFixed(2); };
  ok("rcptNeedsCapReview: auto-filed + not-yet-reviewed → true", rcptNeedsCapReview({ capAutoFiled: true, capReviewedAt: null }) === true);
  ok("rcptNeedsCapReview: reviewed → false", rcptNeedsCapReview({ capAutoFiled: true, capReviewedAt: 123 }) === false);
  ok("rcptNeedsCapReview: plain owner-filed (no flag) → false (non-retroactive)", rcptNeedsCapReview({ amount: 5 }) === false);
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  STORE.expenses.push({ id: "eAuto", receiptId: "bMark", vendor: "AutoCo", amount: 25, category: "other", date: "2026-07-01", capAutoFiled: true, capReviewedAt: null, capAutoAt: Date.now(), deleted: false, updatedAt: Date.now() });
  STORE.expenses.push({ id: "ePlain", receiptId: "bPlain", vendor: "PlainCo", amount: 30, category: "other", date: "2026-07-01", deleted: false, updatedAt: Date.now() });
  const tblMark = rcptTableHTML(rcptAllRows(), {});
  ok("table shows the purple '🤖 review' badge on the auto-filed row", /🤖 review/.test(tblMark));
  ok("table wires a '✓ Reviewed' button to rcptMarkReviewed on the auto-filed row", /rcptMarkReviewed\(/.test(tblMark) && /✓ Reviewed/.test(tblMark));
  ok("table applies the purple left-border tint (#6b3fa0) to the auto-filed row", /border-left:3px solid #6b3fa0/.test(tblMark));

  console.log("— CAP AUTO-APPLY: rcptMarkReviewed + inline edit + modal save each set capReviewedAt (drop the mark) —");
  // (a) explicit "✓ Reviewed"
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  STORE.expenses.push({ id: "eRev", receiptId: "bRev", vendor: "RevCo", amount: 25, category: "other", date: "2026-07-01", capAutoFiled: true, capReviewedAt: null, capAutoAt: Date.now(), deleted: false, updatedAt: Date.now() });
  rcptMarkReviewed("biz", null, "eRev");
  const revd = STORE.expenses.find(e => e.id === "eRev");
  ok("rcptMarkReviewed → capReviewedAt set", typeof revd.capReviewedAt === "number" && revd.capReviewedAt > 0, revd.capReviewedAt);
  ok("rcptMarkReviewed → rcptNeedsCapReview now false (mark dropped)", rcptNeedsCapReview(revd) === false);
  ok("rcptMarkReviewed → capAutoFiled preserved (audit trail intact)", revd.capAutoFiled === true);
  const prevRev = revd.capReviewedAt; rcptMarkReviewed("biz", null, "eRev");
  ok("rcptMarkReviewed is idempotent (a second tap doesn't re-stamp)", STORE.expenses.find(e => e.id === "eRev").capReviewedAt === prevRev);
  // (b) an inline edit (same-home) clears the mark
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  STORE.expenses.push({ id: "eInl", receiptId: "bInl", vendor: "InlCo", amount: 25, category: "other", date: "2026-07-01", capAutoFiled: true, capReviewedAt: null, capAutoAt: Date.now(), deleted: false, updatedAt: Date.now() });
  rcptInlineSet("biz", null, "eInl", "category", "office/admin");
  const inl = STORE.expenses.find(e => e && !e.deleted && e.id === "eInl");
  ok("inline edit → capReviewedAt set (human touch = reviewed)", inl && typeof inl.capReviewedAt === "number" && inl.category === "office/admin", inl && { r: inl.capReviewedAt, c: inl.category });
  ok("inline edit → rcptNeedsCapReview false (mark dropped)", inl && rcptNeedsCapReview(inl) === false);
  // (c) a modal save (same-home) clears the mark
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; }; global.modal = global.modal || function () {};
  STORE.expenses.push({ id: "eMod", receiptId: "bMod", vendor: "ModCo", amount: 25, category: "other", date: "2026-07-01", capAutoFiled: true, capReviewedAt: null, capAutoAt: Date.now(), deleted: false, updatedAt: Date.now() });
  rcptEditOpen("biz", null, "eMod");
  const _prevVal = global.val;
  global.val = function (id) { return ({ rcpt_type: "business", rcpt_amt: "25", rcpt_vendor: "ModCo", rcpt_date: "2026-07-01", rcpt_cat: "other", rcpt_paidby: "", rcpt_attr: "", rcpt_desc: "", rcpt_card4: "" })[id] || ""; };
  rcptSaveEdit();
  global.val = _prevVal;
  const modRec = STORE.expenses.find(e => e && !e.deleted && e.id === "eMod");
  ok("modal save → capReviewedAt set (mark dropped)", modRec && typeof modRec.capReviewedAt === "number" && rcptNeedsCapReview(modRec) === false, modRec && modRec.capReviewedAt);

  console.log("— CAP AUTO-APPLY: the '🤖 To review' filter selects EXACTLY the unreviewed auto-filed rows —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  global.render = function () {};
  rcptSetFilter("all"); rcptClearFilters();
  STORE.expenses.push({ id: "cap1", receiptId: "cp1", vendor: "Cap1", amount: 10, category: "other", date: "2026-07-01", capAutoFiled: true, capReviewedAt: null, capAutoAt: Date.now(), deleted: false, updatedAt: Date.now() });
  STORE.expenses.push({ id: "cap2", receiptId: "cp2", vendor: "Cap2", amount: 20, category: "other", date: "2026-07-01", capAutoFiled: true, capReviewedAt: null, capAutoAt: Date.now(), deleted: false, updatedAt: Date.now() });
  STORE.expenses.push({ id: "cap3", receiptId: "cp3", vendor: "Cap3", amount: 30, category: "other", date: "2026-07-01", capAutoFiled: true, capReviewedAt: Date.now(), capAutoAt: Date.now(), deleted: false, updatedAt: Date.now() });   // already reviewed
  STORE.expenses.push({ id: "plain", receiptId: "cp4", vendor: "Plain", amount: 40, category: "other", date: "2026-07-01", deleted: false, updatedAt: Date.now() });   // never auto-filed
  ok("rcptCapReviewCount = 2 (only the two unreviewed auto-filed)", rcptCapReviewCount() === 2, rcptCapReviewCount());
  rcptSetFilter("capreview");
  const capRows = rcptSortedRows().map(r => r.receiptId).sort();
  ok("filter 'capreview' selects EXACTLY cp1 + cp2 (not the reviewed one, not the plain one)", capRows.join(",") === "cp1,cp2", capRows);
  rcptSetFilter("all");
  ok("filter 'all' still shows every row (filter is view-only)", rcptSortedRows().length === 4, rcptSortedRows().length);
  // NON-RETROACTIVE: the plain (pre-feature) record is never marked, never in the pile
  ok("a plain record without the flag is never counted / never marked (non-retroactive)", rcptCapReviewCount() === 2 && rcptNeedsCapReview(STORE.expenses.find(e => e.id === "plain")) === false);
  delete window.CAP_RCPT_THROTTLE_MS;

  console.log("\n— MEALS category: allowed in RCPT_CATS + files as a business expense (never billed to a customer) —");
  ok("'meals' is in RCPT_CATS (Cap can classify it)", (capRcptCtx().cats || []).indexOf("meals") >= 0);
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  const mealRev = seedReview({ receiptId: "blobMeal", amount: 42.5, vendor: "Cookout", desc: "crew lunch" });
  const mealRes = rcptApplyEdit({ store: "review", jobId: null, recId: mealRev.id }, { type: "business", jobId: null, amount: 42.5, vendor: "Cookout", date: "2026-07-01", category: "meals", desc: "crew lunch", receiptId: "blobMeal" });
  ok("meals receipt files into org expenses[] (business)", mealRes.ok && mealRes.newLoc.store === "biz");
  const mealFiled = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "blobMeal");
  ok("filed meals record keeps category 'meals'", !!mealFiled && mealFiled.category === "meals", mealFiled && mealFiled.category);
  ok("meals record lands in NO job's materials/expenses (not billed to a customer)", STORE.jobs.every(j => !(j.materials || []).concat(j.expenses || []).some(e => e && e.receiptId === "blobMeal")));

  console.log("— PASTE FROM CLIPBOARD: image clipboard → an uploadable File; non-image → nothing —");
  const pf = rcptImageBlobToFile({ type: "image/png" }, 1700000000000);
  ok("image blob → a File-shaped object rcptUploadFiles accepts", !!pf && rcptIsReceipt(pf), pf && pf.type);
  ok("pasted file name uses the pasted-<ts> convention + image ext", !!pf && /^pasted-1700000000000\.png$/.test(pf.name), pf && pf.name);
  ok("non-image clipboard blob → null (no upload)", rcptImageBlobToFile({ type: "text/plain" }, 1) === null);
  ok("empty/missing blob → null (no upload)", rcptImageBlobToFile(null, 1) === null);
  // paste-EVENT path: a Ctrl+V with an image item on the Receipts tab uploads through the shared pipeline
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  global.TAB = "receipts";
  global.jsUpload = function () { return Promise.resolve("blob_paste_" + (++_n)); };
  let prevented = false;
  rcptOnPaste({ preventDefault: function () { prevented = true; }, clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: function () { return { type: "image/png" }; } }] } });
  await new Promise(r => setTimeout(r, 30));
  ok("Ctrl+V image on Receipts tab creates a review receipt", rcptReview().length === 1, rcptReview().length);
  ok("Ctrl+V with an image calls preventDefault", prevented === true);
  // a non-image paste (or the wrong tab) must NOT upload or preventDefault
  resetStore(); OPEN_SHIFT = null;
  let prevented2 = false;
  rcptOnPaste({ preventDefault: function () { prevented2 = true; }, clipboardData: { items: [{ kind: "string", type: "text/plain", getAsFile: function () { return null; } }] } });
  await new Promise(r => setTimeout(r, 10));
  ok("non-image paste → no upload, no preventDefault", rcptReview().length === 0 && prevented2 === false);
  global.TAB = "today";
  let prevented3 = false;
  rcptOnPaste({ preventDefault: function () { prevented3 = true; }, clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: function () { return { type: "image/png" }; } }] } });
  await new Promise(r => setTimeout(r, 10));
  ok("image paste OFF the Receipts tab is ignored (no upload)", rcptReview().length === 0 && prevented3 === false);

  // ========================= SEARCH + FILTER (display-only) =========================
  // rcptSortedRows() honors RCPT_SEARCH + each MULTI-SELECT filter (OR within, AND across) + the date range,
  // Clear resets, a no-match yields 0 rows, and NONE of them mutate the underlying data (a view narrower only).
  console.log("\n— SEARCH + MULTI-FILTER: rcptSortedRows honors search, each multi-select (OR/AND), date range, combine + clear —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  global.render = function () {};
  // NOTE: the RCPT_* filter state are eval-scoped `let`s (like RCPT_FILTER) — drive them through the window
  // rcptSet*/rcptClearFilters setters (which close over the eval scope), not by assigning the names here.
  rcptSetFilter("all");
  rcptClearFilters();   // start from a clean filter state
  // j1 = "Paver patio" (customer Smith) · j2 = "Junk haul" (customer Jones)
  seedReview({ receiptId: "s1", vendor: "Home Depot", amount: 120.5, category: "materials", cardLast4: "1234", jobId: "j1", type: "pass-through", uploadedBy: "u_ray", attributedTo: "u_chase", date: "2026-06-01", ts: 100 });
  seedReview({ receiptId: "s2", vendor: "Lowes", amount: 75, category: "tools/equipment", cardLast4: "9999", jobId: "j2", type: "business", uploadedBy: "u_chase", attributedTo: "u_chase", date: "2026-06-10", ts: 200 });
  seedReview({ receiptId: "s3", vendor: "Shell Gas", amount: 40, category: "fuel", cardLast4: "1234", jobId: null, type: "job-expense", uploadedBy: "u_pierce", attributedTo: "u_pierce", date: "2026-06-20", ts: 300 });
  const totalRcptRows = rcptAllRows().length;   // 3
  const rcptSnapBefore = JSON.stringify(STORE);
  const ids = () => rcptSortedRows().map(r => r.receiptId).sort().join(",");

  // SEARCH — over the concatenated haystack (vendor/desc/amount/category/card/job/customer/person)
  rcptClearFilters(); rcptSetSearch("home");
  ok("search 'home' → vendor Home Depot (s1 only)", ids() === "s1", ids());
  rcptClearFilters(); rcptSetSearch("75");
  ok("search '75' → matches amount (s2)", ids() === "s2", ids());
  rcptClearFilters(); rcptSetSearch("fuel");
  ok("search 'fuel' → matches category (s3)", ids() === "s3", ids());
  rcptClearFilters(); rcptSetSearch("9999");
  ok("search '9999' → matches card last-4 (s2)", ids() === "s2", ids());
  rcptClearFilters(); rcptSetSearch("pierce");
  ok("search 'pierce' → matches uploader/for name (s3)", ids() === "s3", ids());
  rcptClearFilters(); rcptSetSearch("paver");
  ok("search 'paver' → matches job label (s1)", ids() === "s1", ids());
  rcptClearFilters(); rcptSetSearch("jones");
  ok("search 'jones' → matches customer name (s2)", ids() === "s2", ids());
  rcptClearFilters(); rcptSetSearch("LOWES");
  ok("search is case-insensitive (s2)", ids() === "s2", ids());

  // TYPE — single value (checkbox toggle) + MULTI-SELECT (OR within the filter)
  rcptClearFilters(); rcptToggleTypeF("pass-through");
  ok("type filter pass-through → s1", ids() === "s1", ids());
  rcptClearFilters(); rcptToggleTypeF("job-expense");
  ok("type filter job-expense → s3", ids() === "s3", ids());
  rcptClearFilters(); rcptToggleTypeF("pass-through"); rcptToggleTypeF("job-expense");
  ok("MULTI type pass-through OR job-expense → s1,s3", ids() === "s1,s3", ids());
  rcptClearFilters(); rcptToggleTypeF("pass-through"); rcptToggleTypeF("job-expense"); rcptToggleTypeF("pass-through");
  ok("toggling a type OFF again removes it (job-expense only → s3)", ids() === "s3", ids());
  // CATEGORY — single + MULTI (union)
  rcptClearFilters(); rcptToggleCatF("tools/equipment");
  ok("category filter → s2", ids() === "s2", ids());
  rcptClearFilters(); rcptToggleCatF("materials"); rcptToggleCatF("fuel");
  ok("MULTI category materials OR fuel → union s1,s3", ids() === "s1,s3", ids());
  // PERSON (uploader OR attributedTo) — single + MULTI (union)
  rcptClearFilters(); rcptTogglePersonF("u_chase");
  ok("person filter matches uploader OR attributedTo (s1,s2)", ids() === "s1,s2", ids());
  rcptClearFilters(); rcptTogglePersonF("u_pierce");
  ok("person filter (s3)", ids() === "s3", ids());
  rcptClearFilters(); rcptTogglePersonF("u_pierce"); rcptTogglePersonF("u_ray");
  ok("MULTI person u_pierce OR u_ray → union s1,s3 (s1 uploaded by u_ray)", ids() === "s1,s3", ids());
  // JOB — single + MULTI (union)
  rcptClearFilters(); rcptToggleJobF("j2");
  ok("job filter → s2", ids() === "s2", ids());
  rcptClearFilters(); rcptToggleJobF("j1"); rcptToggleJobF("j2");
  ok("MULTI job j1 OR j2 → union s1,s2", ids() === "s1,s2", ids());
  // CARD — single + MULTI (union)
  rcptClearFilters(); rcptToggleCardF("1234");
  ok("card filter → s1,s3", ids() === "s1,s3", ids());
  rcptClearFilters(); rcptToggleCardF("1234"); rcptToggleCardF("9999");
  ok("MULTI card 1234 OR 9999 → union s1,s2,s3", ids() === "s1,s2,s3", ids());
  // DATE RANGE (unchanged — single value)
  rcptClearFilters(); rcptSetDateF("from", "2026-06-05"); rcptSetDateF("to", "2026-06-15");
  ok("date range 06-05..06-15 → s2", ids() === "s2", ids());
  rcptClearFilters(); rcptSetDateF("from", "2026-06-15");
  ok("date from only → s3", ids() === "s3", ids());
  rcptClearFilters(); rcptSetDateF("to", "2026-06-05");
  ok("date to only → s1", ids() === "s1", ids());

  // COMBINED — OR within a filter, AND across filters
  rcptClearFilters(); rcptToggleCardF("1234"); rcptSetSearch("home");
  ok("combined card+search AND → s1", ids() === "s1", ids());
  rcptClearFilters(); rcptToggleTypeF("business"); rcptToggleJobF("j1");
  ok("combined type+job with no overlap → 0 rows", rcptSortedRows().length === 0, ids());
  // MULTI type OR'd, then AND'd with a card filter: {s1,s3} ∩ {card 1234 → s1,s3} = s1,s3
  rcptClearFilters(); rcptToggleTypeF("pass-through"); rcptToggleTypeF("job-expense"); rcptToggleCardF("1234");
  ok("MULTI type (s1,s3) AND card 1234 (s1,s3) → s1,s3", ids() === "s1,s3", ids());
  // {type multi s1,s3} ∩ {category materials → s1} = s1 (proves AND narrows the OR'd set)
  rcptClearFilters(); rcptToggleTypeF("pass-through"); rcptToggleTypeF("job-expense"); rcptToggleCatF("materials");
  ok("MULTI type (s1,s3) AND category materials (s1) → s1", ids() === "s1", ids());
  // NO MATCH
  rcptClearFilters(); rcptSetSearch("zzznope");
  ok("no-match search → 0 rows", rcptSortedRows().length === 0, ids());
  // EMPTY set = filter OFF (toggling a value on then off leaves the full list)
  rcptClearFilters(); rcptToggleTypeF("business"); rcptToggleTypeF("business");
  ok("empty set (toggled on then off) = no filter → full list", rcptSortedRows().length === totalRcptRows && rcptAnyFilterActive() === false, ids());

  // CLEAR resets every filter + restores the full list (verified via behavior + rcptAnyFilterActive())
  rcptSetSearch("home"); rcptToggleTypeF("business"); rcptToggleTypeF("pass-through"); rcptToggleCatF("fuel"); rcptTogglePersonF("u_chase"); rcptToggleJobF("j1"); rcptToggleCardF("1234"); rcptSetDateF("from", "2026-01-01"); rcptSetDateF("to", "2026-12-31");
  ok("rcptAnyFilterActive() true while filters are set", rcptAnyFilterActive() === true);
  rcptClearFilters();
  ok("rcptClearFilters clears everything (rcptAnyFilterActive() false)", rcptAnyFilterActive() === false);
  ok("after clear, the full list shows again", rcptSortedRows().length === totalRcptRows, rcptSortedRows().length);

  // NO MUTATION — running every filter (multi-select + the pure list renderer) must never change the underlying data
  rcptSetSearch("home"); rcptToggleTypeF("pass-through"); rcptToggleTypeF("job-expense"); rcptToggleCatF("materials"); rcptTogglePersonF("u_chase"); rcptToggleJobF("j1"); rcptToggleCardF("1234"); rcptSetDateF("from", "2026-06-01"); rcptSetDateF("to", "2026-06-30");
  rcptSortedRows(); rcptListInner(); rcptSortedRows();
  rcptClearFilters();
  ok("filters + rcptListInner NEVER mutate data (STORE byte-identical)", JSON.stringify(STORE) === rcptSnapBefore);

  console.log("\n— INLINE CLICK-TO-EDIT (rcptInlineSet): full fields rebuilt + one override → rcptApplyEdit —");
  const inlNorm = r => { const c = Object.assign({}, r); delete c.updatedAt; delete c.ts; delete c.id; return c; };   // id preservation asserted separately; the uid counter differs between the two seeds
  // helper: seed a review record then file it as a job-expense on j1 (a realistic filed receipt with a photo)
  function seedFiledJobExp() {
    resetStore();
    const rv = rcptNewReview("bX"); Object.assign(rv, { amount: 90, vendor: "Depot", date: "2026-07-02", category: "fuel", paidBy: "u_chase", attributedTo: "u_chase", desc: "gas", cardLast4: "4242" });
    STORE.receipts.push(rv);
    const f = rcptApplyEdit({ store: "review", jobId: null, recId: rv.id }, { type: "job-expense", jobId: "j1", amount: 90, vendor: "Depot", date: "2026-07-02", category: "fuel", paidBy: "u_chase", attributedTo: "u_chase", desc: "gas", receiptId: "bX", cardLast4: "4242" });
    return { id: rv.id, loc: f.newLoc };
  }
  // (A) CATEGORY change → same home (jobexp) + same id, only category changes, nothing else dropped
  const A = seedFiledJobExp();
  rcptInlineSet("jobexp", "j1", A.id, "category", "tools/equipment");
  let aRec = STORE.jobs[0].expenses.find(x => x.id === A.id);
  ok("category updated in place — same home + id", !!aRec && aRec.id === A.id && aRec.category === "tools/equipment" && !aRec.deleted, aRec);
  ok("no id churn / one live record", STORE.jobs[0].expenses.filter(x => !x.deleted).length === 1);
  ok("category change dropped nothing else", aRec.vendor === "Depot" && aRec.amount === 90 && aRec.desc === "gas" && aRec.cardLast4 === "4242" && aRec.attributedTo === "u_chase" && aRec.paidBy === "u_chase", aRec);
  const aInlineJson = JSON.stringify(inlNorm(aRec));
  // …byte-identical to the equivalent modal save (rcptApplyEdit with the fields rcptSaveEdit would gather)
  const A2 = seedFiledJobExp();
  rcptApplyEdit({ store: "jobexp", jobId: "j1", recId: A2.id }, { type: "job-expense", jobId: "j1", amount: 90, vendor: "Depot", date: "2026-07-02", category: "tools/equipment", paidBy: "u_chase", attributedTo: "u_chase", desc: "gas", receiptId: "bX", cardLast4: "4242", isDeposit: false, kind: "" });
  const aModalJson = JSON.stringify(inlNorm(STORE.jobs[0].expenses.find(x => x.id === A2.id)));
  ok("category inline edit is BYTE-IDENTICAL to the modal save", aInlineJson === aModalJson, { inline: aInlineJson, modal: aModalJson });

  // (B) CARD + (C) FOR change in place — same home + id
  const B = seedFiledJobExp();
  rcptInlineSet("jobexp", "j1", B.id, "cardLast4", "1357");
  let bRec = STORE.jobs[0].expenses.find(x => x.id === B.id);
  ok("card updated in place (same home+id)", bRec && bRec.cardLast4 === "1357" && bRec.category === "fuel", bRec);
  const C = seedFiledJobExp();
  rcptInlineSet("jobexp", "j1", C.id, "attributedTo", "u_pierce");
  let cRec = STORE.jobs[0].expenses.find(x => x.id === C.id);
  ok("For (attributedTo) updated in place (same home+id)", cRec && cRec.attributedTo === "u_pierce", cRec);
  ok("clearing the card via '' drops it in place", (function () { const Z = seedFiledJobExp(); rcptInlineSet("jobexp", "j1", Z.id, "cardLast4", ""); const z = STORE.jobs[0].expenses.find(x => x.id === Z.id); return !z.cardLast4; })());

  // (D) TYPE → job-type WITH a job re-buckets into job.materials, preserving id + photo
  resetStore();
  const rvMat = rcptNewReview("bMat"); Object.assign(rvMat, { amount: 150, vendor: "Depot", desc: "pavers", jobId: "j1", attributedTo: "u_ray" });
  STORE.receipts.push(rvMat);
  rcptInlineSet("review", "j1", rvMat.id, "type", "pass-through");
  ok("Type→pass-through WITH job re-buckets into job.materials (id+photo preserved)", STORE.jobs[0].materials.some(x => x.id === rvMat.id && x.receiptId === "bMat" && !x.deleted) && !rcptReview().some(x => x.id === rvMat.id), { mat: STORE.jobs[0].materials, rev: rcptReview() });

  // (E) TYPE → job-type with NO job stays in review (rcptTargetHome behavior preserved)
  resetStore();
  const rvNo = rcptNewReview("bNo"); Object.assign(rvNo, { amount: 20, vendor: "Gas" });
  STORE.receipts.push(rvNo);
  rcptInlineSet("review", "", rvNo.id, "type", "job-expense");
  const noRec = rcptColl().find(x => x.id === rvNo.id);
  ok("Type→job-expense with NO job stays in review store", !!noRec && !noRec.deleted && noRec.status === "review" && noRec.type === "job-expense", noRec);
  ok("…and is in no job array", !STORE.jobs.some(j => (j.expenses || []).concat(j.materials || []).some(x => x.id === rvNo.id && !x.deleted)));

  // (F) JOB inline on a pass-through (review) row → re-buckets to job.materials
  resetStore();
  const rvPT = rcptNewReview("bPT"); Object.assign(rvPT, { amount: 75, vendor: "Depot", type: "pass-through" });   // pass-through, no job → lives in review
  STORE.receipts.push(rvPT);
  rcptInlineSet("review", "", rvPT.id, "jobId", "j2");
  ok("Job inline on a pass-through review row → job.materials on j2 (id+photo kept)", STORE.jobs[1].materials.some(x => x.id === rvPT.id && x.receiptId === "bPT" && !x.deleted) && !rcptReview().some(x => x.id === rvPT.id), { mat: STORE.jobs[1].materials });

  // ========================= REFUND / DEPOSIT ARE CONFIRMATION-ONLY (Cap may suggest, NEVER auto-applies) =========================
  // A wrong Cap "refund" read would auto-file the receipt with its amount flipped NEGATIVE; a wrong "deposit" would
  // hold money out of a job's cost. Ray's rule: those two flags are set ONLY by his tick + Save. So (a) the Cap
  // auto-file spine (rcptFileSuggestion) NEVER sets kind:"refund"/isDeposit and always files a POSITIVE amount, and
  // (b) "Use Cap's guess" (rcptApplySuggestion) surfaces a hint but leaves the boxes UNCHECKED.
  console.log("\n— REFUND/DEPOSIT confirmation-only: Cap auto-file (rcptFileSuggestion) IGNORES suggested.refund/deposit —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards;
  const refSug = seedReview({ receiptId: "autoref", vendor: "Sunbelt", amount: 50 });
  refSug.suggested = { confidence: 0.95, amount: 50, type: "business", vendor: "Sunbelt", category: "rentals", desc: "credit", refund: true };
  rcptFileSuggestion("review", null, refSug.id);
  const caRefFiled = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "autoref");
  ok("Cap auto-file with suggested.refund:true → amount stays POSITIVE (never negated)", caRefFiled && caRefFiled.amount === 50, caRefFiled && caRefFiled.amount);
  ok("Cap auto-file with suggested.refund:true → kind is NOT 'refund'", caRefFiled && caRefFiled.kind !== "refund", caRefFiled && caRefFiled.kind);
  resetStore();
  const depSug = seedReview({ receiptId: "autodep", vendor: "Sunbelt", amount: 300 });
  depSug.suggested = { confidence: 0.95, amount: 300, type: "business", vendor: "Sunbelt", category: "rentals", desc: "deposit", deposit: true };
  rcptFileSuggestion("review", null, depSug.id);
  const depFiled = (STORE.expenses || []).find(e => e && !e.deleted && e.receiptId === "autodep");
  ok("Cap auto-file with suggested.deposit:true → amount POSITIVE", depFiled && depFiled.amount === 300, depFiled && depFiled.amount);
  ok("Cap auto-file with suggested.deposit:true → isDeposit is NOT set", depFiled && !depFiled.isDeposit, depFiled && depFiled.isDeposit);

  console.log("— REFUND/DEPOSIT confirmation-only: 'Use Cap's guess' (rcptApplySuggestion) surfaces a hint but does NOT tick the box —");
  resetStore(); global.finCanView = function () { return true; }; global.modal = global.modal || function () {};
  const supRec = seedReview({ receiptId: "sugg1", vendor: "Sunbelt", amount: 50 });
  supRec.suggested = { confidence: 0.9, amount: 50, type: "business", vendor: "Sunbelt", category: "other", desc: "x", refund: true, deposit: true };   // category NON-rentals → proves the deposit flag no longer forces "rentals"
  rcptEditOpen("review", "", supRec.id);   // sets the module-scoped RCPT_EDIT.suggested (only way in)
  const _geiS = global.document.getElementById, _valS = global.val;
  const sEls = { rcpt_refund: { checked: false }, rcpt_deposit: { checked: false }, rcpt_refund_hint: { innerHTML: "" }, rcpt_deposit_hint: { innerHTML: "" }, rcpt_type: { value: "" }, rcpt_cat: { value: "" }, rcpt_jobwrap: { style: {} }, rcpt_vendor: { value: "" }, rcpt_amt: { value: "" }, rcpt_desc: { value: "" }, rcpt_suggbanner: { innerHTML: "" } };
  global.document.getElementById = function (id) { return Object.prototype.hasOwnProperty.call(sEls, id) ? sEls[id] : null; };
  global.val = function (id) { return (sEls[id] && sEls[id].value != null) ? sEls[id].value : ""; };
  rcptApplySuggestion();
  global.document.getElementById = _geiS; global.val = _valS;
  ok("'Use Cap's guess' does NOT tick the refund box", sEls.rcpt_refund.checked === false);
  ok("'Use Cap's guess' does NOT tick the deposit box", sEls.rcpt_deposit.checked === false);
  ok("a suggested refund SURFACES a highlighted hint next to the box", /Cap thinks/.test(sEls.rcpt_refund_hint.innerHTML), sEls.rcpt_refund_hint.innerHTML);
  ok("a suggested deposit SURFACES a highlighted hint next to the box", /Cap thinks/.test(sEls.rcpt_deposit_hint.innerHTML), sEls.rcpt_deposit_hint.innerHTML);
  ok("suggested deposit does NOT auto-nudge the category to rentals (rides on tick)", sEls.rcpt_cat.value !== "rentals", sEls.rcpt_cat.value);

  console.log("— REFUND/DEPOSIT: the ONLY way the flags get set is an explicit tick + Save (rcptSaveEdit) —");
  resetStore(); global.finCanView = function () { return true; }; global.modal = global.modal || function () {};
  const _geiT = global.document.getElementById, _valT = global.val;
  const tickRec = seedReview({ receiptId: "tickref", vendor: "Sunbelt", amount: 90 });
  rcptEditOpen("review", "", tickRec.id);
  global.val = function (id) { return ({ rcpt_type: "job-expense", rcpt_job: "j1", rcpt_amt: "90", rcpt_vendor: "Sunbelt", rcpt_date: "2026-07-01", rcpt_cat: "rentals", rcpt_paidby: "", rcpt_attr: "", rcpt_desc: "trailer", rcpt_card4: "" })[id] || ""; };
  global.document.getElementById = function (id) { return id === "rcpt_refund" ? { checked: true } : (id === "rcpt_deposit" ? { checked: false } : null); };
  rcptSaveEdit();
  const tickFiled = STORE.jobs[0].expenses.find(e => e && !e.deleted && e.receiptId === "tickref");
  ok("explicit refund tick + Save → kind:'refund' + NEGATIVE amount (the ONE path that sets it)", tickFiled && tickFiled.kind === "refund" && tickFiled.amount === -90, tickFiled && [tickFiled.kind, tickFiled.amount]);
  resetStore();
  const dTick = seedReview({ receiptId: "tickdep", vendor: "Sunbelt", amount: 300 });
  rcptEditOpen("review", "", dTick.id);
  global.val = function (id) { return ({ rcpt_type: "job-expense", rcpt_job: "j1", rcpt_amt: "300", rcpt_vendor: "Sunbelt", rcpt_date: "2026-07-01", rcpt_cat: "rentals", rcpt_paidby: "", rcpt_attr: "", rcpt_desc: "deposit", rcpt_card4: "" })[id] || ""; };
  global.document.getElementById = function (id) { return id === "rcpt_deposit" ? { checked: true } : null; };
  rcptSaveEdit();
  const depTick = STORE.jobs[0].expenses.find(e => e && !e.deleted && e.receiptId === "tickdep");
  ok("explicit deposit tick + Save → isDeposit:true (the ONE path that sets it)", depTick && depTick.isDeposit === true, depTick && depTick.isDeposit);
  global.val = _valT; global.document.getElementById = _geiT;

  // ========================= DATE-EDIT BUG: capRead.date "unknown" must not mask/blank the date field =========================
  // The Cloudflare biz expense carries capRead.date:"unknown" (Cap couldn't read a date). The old rcptDate returned
  // "unknown", which an <input type=date> silently REJECTS (renders BLANK) AND which masked the record's real
  // e.date — so on Ray's device the date field looked empty and un-settable. rcptDate now only accepts a real
  // YYYY-MM-DD. Prove both editors set + persist a new date on the Cloudflare-shaped record.
  console.log("\n— DATE BUG: capRead.date 'unknown' no longer masks/blanks the date; both editors persist a date change —");
  resetStore(); OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; }; global.modal = global.modal || function () {};
  global.closeModal = global.closeModal || function () {};
  const cfShape = { id: "cf1", receiptId: "cfblob.png", vendor: "Cloudflare", amount: 10.46, desc: "J-suite DNS", category: "subscription/software", paidBy: "u_ray", by: "Rj", date: "2026-06-01", note: "J-suite DNS", memberId: "u_ray", capRead: { date: "unknown", vendor: "Cloudflare", amount: 10.46, match: false }, deleted: false, updatedAt: Date.now(), ts: Date.now() };
  STORE.expenses.push(cfShape);
  ok("rcptDate rejects capRead.date 'unknown' → falls through to the record's real date (2026-06-01)", rcptDate(STORE.expenses.find(e => e.id === "cf1")) === "2026-06-01", rcptDate(STORE.expenses.find(e => e.id === "cf1")));
  ok("rcptDate on a genuine capRead date still prefers it", rcptDate({ capRead: { date: "2026-05-20" }, date: "2026-06-01" }) === "2026-05-20");
  // (a) Receipts modal (js/87 rcptSaveEdit) — set a new date + Save → persists on the biz record
  rcptEditOpen("biz", null, "cf1");
  const _valD = global.val;
  global.val = function (id) { return ({ rcpt_type: "business", rcpt_amt: "10.46", rcpt_vendor: "Cloudflare", rcpt_date: "2026-06-15", rcpt_cat: "subscription/software", rcpt_paidby: "", rcpt_attr: "", rcpt_desc: "J-suite DNS", rcpt_card4: "" })[id] || ""; };
  rcptSaveEdit();
  global.val = _valD;
  const cfAfter = STORE.expenses.find(e => e && !e.deleted && e.id === "cf1");
  ok("Receipts modal: setting a new date on the Cloudflare biz record persists (e.date → 2026-06-15)", cfAfter && cfAfter.date === "2026-06-15", cfAfter && cfAfter.date);
  ok("…and the date now DISPLAYS on reopen (rcptDate returns the saved date, no longer 'unknown')", rcptDate(cfAfter) === "2026-06-15", rcptDate(cfAfter));
  // (b) Finance editor (js/40 saveExpense) — same record shape, set a new date + Save → persists
  const j40Src = fs.readFileSync(__dirname + "/js/40-finance.js", "utf8");
  const saveExpSrc = (j40Src.match(/window\.saveExpense = function[\s\S]*?\n\};/) || [])[0];
  ok("js/40 saveExpense extractable for the finance-editor date test", !!saveExpSrc);
  if (saveExpSrc) {
    eval(saveExpSrc.replace("window.saveExpense", "global.saveExpense"));
    resetStore();
    STORE.expenses.push({ id: "cffin", vendor: "Cloudflare", amount: 10.46, category: "subscription/software", date: "2026-06-01", note: "J-suite DNS", memberId: "", capRead: { date: "unknown" }, deleted: false, updatedAt: Date.now() });
    const _valF = global.val;
    global.val = function (id) { return ({ ex_amt: "10.46", ex_date: "2026-06-20", ex_cat: "subscription/software", ex_note: "J-suite DNS", ex_vendor: "Cloudflare", ex_member: "" })[id] || ""; };
    global.saveExpense("cffin", false);
    global.val = _valF;
    const cffin = STORE.expenses.find(e => e && !e.deleted && e.id === "cffin");
    ok("Finance editor (js/40 saveExpense): setting a new date on the Cloudflare biz record persists (2026-06-20)", cffin && cffin.date === "2026-06-20", cffin && cffin.date);
  }

  // ========================= STATEMENT FAN-OUT: one review receipt PER transaction =========================
  // Ray uploaded a card-statement screenshot with TWO POS debits (Vulcan -$68.69 + Home Depot -$67.21, card 8355).
  // The OLD path made ONE blank review receipt. A read returning suggested.transactions must fan out into one
  // review record PER transaction, sharing the SAME source image, with DETERMINISTIC _tx ids (idempotent on
  // re-read), each a POSITIVE expense (the minus sign on a statement debit must NOT flag a refund).
  console.log("\n— STATEMENT FAN-OUT: a 2-transaction read → 2 review records sharing the image, deterministic _tx ids —");
  window.CAP_RCPT_THROTTLE_MS = 0;
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; CURUSER = { id: "u_ray", username: "Ray" };
  global.finCanView = function () { return true; };
  const stmtRec = seedReview({ receiptId: "stmt8355.png" });   // the ONE upload of the statement screenshot
  const pid = stmtRec.id;
  // low confidence (0.5) → the fanned rows STAY in review (so we can inspect their ids + suggestions), amounts NEGATIVE
  // on the statement to prove they come back POSITIVE and NOT flagged as refunds.
  const STMT_TX = { confidence: 0.5, transactions: [
    { vendor: "VULCAN MIDEAST", amount: -68.69, date: "2026-07-08", last4: "8355", type: "job-expense", category: "materials", refund: false },
    { vendor: "THE HOME DEPOT #3650", amount: -67.21, date: "2026-07-08", last4: "8355", type: "pass-through", category: "materials", refund: false }
  ] };
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: STMT_TX }) }); };
  await capRcptRun({ auto: true });
  const fanRows = rcptReview().filter(r => r.receiptId === "stmt8355.png");
  ok("2-transaction statement fanned into 2 review records", fanRows.length === 2, fanRows.map(r => r.id));
  const prim = rcptReview().find(r => r.id === pid);
  const sib1 = rcptReview().find(r => r.id === pid + "_tx1");
  ok("primary keeps the SOURCE record id + transactions[0] (Vulcan)", prim && prim.suggested && prim.suggested.vendor === "VULCAN MIDEAST", prim && prim.suggested);
  ok("sibling id is DETERMINISTIC (<primary>_tx1) + carries transactions[1] (Home Depot)", !!sib1 && sib1.suggested && sib1.suggested.vendor === "THE HOME DEPOT #3650", sib1 && sib1.id);
  ok("both fanned rows SHARE the one source image (receiptId)", prim.receiptId === "stmt8355.png" && sib1.receiptId === "stmt8355.png");
  ok("statement DEBITS shown NEGATIVE become POSITIVE suggestions (money out = a normal expense)", prim.suggested.amount === 68.69 && sib1.suggested.amount === 67.21, [prim.suggested.amount, sib1.suggested.amount]);
  ok("a statement debit is NOT a refund (the minus sign must not flag one)", prim.suggested.refund === false && sib1.suggested.refund === false);
  ok("each fanned row carries card last4 + date", prim.suggested.last4 === "8355" && prim.suggested.date === "2026-07-08" && sib1.suggested.last4 === "8355");

  console.log("— STATEMENT FAN-OUT: re-reading the SAME image does NOT duplicate (idempotent _tx ids) —");
  prim.suggested = null; if (typeof touch === "function") touch(prim);   // simulate Ray tapping 'Reread' on the (re-blanked) primary
  await capRcptRun({ auto: true });                                       // re-reads the primary → fans AGAIN
  const afterReread = rcptReview().filter(r => r.receiptId === "stmt8355.png");
  ok("re-read fans to the SAME 2 records (no 3rd / no _tx1 duplicate)", afterReread.length === 2, afterReread.map(r => r.id));
  ok("still exactly ONE sibling with id <primary>_tx1", rcptReview().filter(r => r.id === pid + "_tx1").length === 1);

  console.log("— STATEMENT FAN-OUT: a confident statement AUTO-FILES each row as a POSITIVE expense, not a refund —");
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; CURUSER = { id: "u_ray", username: "Ray" };
  global.finCanView = function () { return true; };
  seedReview({ receiptId: "stmtB.png" });
  const STMT_B = { confidence: 0.92, transactions: [
    { vendor: "VULCAN MIDEAST", amount: -68.69, date: "2026-07-08", last4: "8355", type: "business", category: "materials", refund: false },
    { vendor: "THE HOME DEPOT #3650", amount: -67.21, date: "2026-07-08", last4: "8355", type: "business", category: "materials", refund: false }
  ] };
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: STMT_B }) }); };
  await capRcptRun({ auto: true });
  const filedB = (STORE.expenses || []).filter(e => e && !e.deleted && e.receiptId === "stmtB.png");
  ok("confident statement auto-files BOTH transactions into expenses[]", filedB.length === 2, filedB.map(e => [e.vendor, e.amount]));
  ok("each fanned expense is POSITIVE (a debit shown -$ files as +$)", filedB.every(e => e.amount > 0) && filedB.some(e => e.amount === 68.69) && filedB.some(e => e.amount === 67.21), filedB.map(e => e.amount));
  ok("no fanned expense is a refund (kind never 'refund')", filedB.every(e => e.kind !== "refund"), filedB.map(e => e.kind));
  ok("both fanned rows left the review queue", rcptReview().filter(r => r.receiptId === "stmtB.png").length === 0);
  ok("fanned expenses stamped capAutoFiled (purple 🤖 review)", filedB.every(e => e.capAutoFiled === true && e.capReviewedAt === null));

  console.log("— STATEMENT FAN-OUT: a SINGLE / normal receipt makes exactly ONE record, unchanged —");
  // (a) explicit transactions:[] (a normal itemized receipt) → single-object path, no fan, one record
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  const normRec = seedReview({ receiptId: "norm.png" });
  const npid = normRec.id;
  const NORM_SUGG = { vendor: "Depot", amount: 50, date: "2026-07-01", type: "business", category: "materials", jobId: null, confidence: 0.5, transactions: [] };
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: NORM_SUGG }) }); };
  await capRcptRun({ auto: true });
  ok("transactions:[] → exactly ONE review record (no fan)", rcptReview().filter(r => r.receiptId === "norm.png").length === 1);
  ok("its suggested is the WHOLE object (not a wrapped transaction)", rcptReview().find(r => r.id === npid).suggested.vendor === "Depot" && rcptReview().find(r => r.id === npid).suggested.amount === 50);
  ok("no _tx sibling was created for a single/normal read", rcptReview().filter(r => r.id === npid + "_tx1").length === 0 && rcptColl().filter(r => r.id === npid + "_tx1").length === 0);
  // (b) a ONE-entry transactions array is NOT a fan (needs ≥2) → single-object path unchanged
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  const fanOneRec = seedReview({ receiptId: "one.png" }); const opid = fanOneRec.id;
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({ suggested: { vendor: "Solo", amount: 9, type: "business", category: "materials", confidence: 0.5, transactions: [{ vendor: "Solo", amount: 9 }] } }) }); };
  await capRcptRun({ auto: true });
  ok("1-entry transactions array → exactly ONE record, no sibling", rcptReview().filter(r => r.receiptId === "one.png").length === 1 && rcptColl().filter(r => r.id === opid + "_tx1").length === 0);

  console.log("— PDF receipts are now valid Cap read targets (server reads them via a document block) —");
  resetStore(); _capRcptSkip = {}; _capSweepLast = 0; OPEN_SHIFT = null; delete CURUSER.cards; global.finCanView = function () { return true; };
  const pdfRow = seedReview({ receiptId: "contract42.pdf", uploadedBy: "u_ray", attributedTo: "u_ray" });
  seedReview({ receiptId: "photo1.png", uploadedBy: "u_ray", attributedTo: "u_ray" });
  seedReview({ receiptId: null, source: "csv", uploadedBy: "u_ray", attributedTo: "u_ray" });
  const tgtIds = capRcptTargets().map(r => r.receiptId);
  ok("PDF receipt IS a Cap read target now (no longer skipped)", tgtIds.indexOf("contract42.pdf") >= 0, tgtIds);
  ok("photo receipt still a target", tgtIds.indexOf("photo1.png") >= 0, tgtIds);
  ok("CSV row (receiptId:null) is NOT a vision target (parsed, not read)", tgtIds.indexOf(null) < 0 && capRcptTargets().every(r => r.receiptId), tgtIds);
  ok("PDF is in the pending drain (capRcptPending includes it)", capRcptPending().some(r => r.receiptId === "contract42.pdf"), capRcptPending().map(r => r.receiptId));
  pdfRow.suggested = { vendor: "Home Depot", amount: 72.59, confidence: 0.9 };
  ok("an already-read PDF (has suggested) is NOT re-targeted", capRcptTargets().every(r => r.id !== pdfRow.id), capRcptTargets().map(r => r.receiptId));

  console.log("— 🔗 DEPOSIT-SETTLEMENT: Cap matches a rental cost to its open deposit + settles from the receipt —");
  // Set up the REAL scenario: an open $300 The Home Depot deposit (HELD) on the Paver job + a separate $72.59
  // Home Depot rental review receipt Cap read (net cost · rentals) → the same rental, currently double-countable.
  resetStore(); global.finCanView = function () { return true; };
  const dsPaver = STORE.jobs.find(j => j.id === "j1");
  const dsDep = { id: "dep_hd", amount: 300, vendor: "The Home Depot", category: "rentals", isDeposit: true, depositSettled: false, desc: "Trailer rental deposit", deleted: false, updatedAt: Date.now() };
  dsPaver.expenses.push(dsDep);
  const dsRcpt = seedReview({ receiptId: "hd_contract.pdf", vendor: "The Home Depot", amount: null, category: "", jobId: "j1", suggested: { vendor: "The Home Depot", amount: 72.59, category: "rentals", confidence: 0.9 } });

  const dsM = rcptDepositMatch(dsRcpt);
  ok("rcptDepositMatch finds the $300 Home Depot open deposit", !!dsM && dsM.deposit && dsM.deposit.id === "dep_hd", dsM && dsM.deposit && dsM.deposit.id);
  ok("match net cost = the receipt's 72.59", !!dsM && dsM.net === 72.59, dsM && dsM.net);
  ok("match implied refund = 300 − 72.59 = 227.41", !!dsM && dsM.impliedRefund === 227.41, dsM && dsM.impliedRefund);
  ok("match carries the deposit's job", !!dsM && dsM.job && dsM.job.id === "j1", dsM && dsM.job && dsM.job.id);

  // NO match when the vendor differs
  const dsWrongVendor = seedReview({ receiptId: "x.pdf", vendor: "Lowe's", category: "rentals", jobId: "j1", suggested: { amount: 50, category: "rentals" } });
  ok("no match when vendor differs (Lowe's vs Home Depot)", rcptDepositMatch(dsWrongVendor) === null);
  // NO match when the job differs (receipt on j2, deposit on j1)
  const dsWrongJob = seedReview({ receiptId: "y.pdf", vendor: "The Home Depot", category: "rentals", jobId: "j2", suggested: { amount: 50, category: "rentals" } });
  ok("no match when the job differs", rcptDepositMatch(dsWrongJob) === null);
  // NO match when the deposit is SMALLER than the rental cost (deposit can't cover it)
  const dsTooBig = seedReview({ receiptId: "z.pdf", vendor: "The Home Depot", category: "rentals", jobId: "j1", suggested: { amount: 400, category: "rentals" } });
  ok("no match when deposit < receipt net (deposit can't cover it)", rcptDepositMatch(dsTooBig) === null);
  // NO match for a non-rental receipt / a deposit itself
  ok("no match for a non-rentals receipt", rcptDepositMatch(seedReview({ receiptId: "n.pdf", vendor: "The Home Depot", category: "materials", jobId: "j1", suggested: { amount: 20, category: "materials" } })) === null);
  ok("a deposit receipt never matches itself", rcptDepositMatch(dsDep) === null);

  // the page suggestion only surfaces the real match, and only for owner/admin
  global.finCanView = function () { return true; };
  const dsSugIds = rcptDepositSuggestions().map(s => s.receipt.id);
  ok("suggestion surfaces the real $72.59 match", dsSugIds.indexOf(dsRcpt.id) >= 0, dsSugIds);
  ok("suggestion does NOT surface the non-matches", dsSugIds.indexOf(dsWrongVendor.id) < 0 && dsSugIds.indexOf(dsWrongJob.id) < 0 && dsSugIds.indexOf(dsTooBig.id) < 0);
  global.finCanView = function () { return false; };   // crew
  ok("crew see NO deposit-settlement suggestions (owner/admin only)", rcptDepositSuggestions().length === 0);
  global.finCanView = function () { return true; };

  // ONE-TAP SETTLE: adds a −227.41 refund + settles → net 72.59; attaches the contract photo; absorbs the receipt
  const dsRes = rcptSettleDepositFromReceipt({ store: "review", jobId: null, recId: dsRcpt.id }, "dep_hd");
  ok("rcptSettleDepositFromReceipt returns ok", !!dsRes && dsRes.ok === true, dsRes);
  ok("computed refund = 227.41", dsRes.refund === 227.41, dsRes.refund);
  const dsRefunds = dsPaver.expenses.filter(e => e.refundOfId === "dep_hd");
  ok("a −227.41 refund record was added against the deposit", dsRefunds.length === 1 && dsRefunds[0].amount === -227.41, dsRefunds.map(r => r.amount));
  ok("the deposit is now settled", dsDep.depositSettled === true && dsRefunds[0].depositSettled === true);
  ok("depositNetCost = 72.59 (the real rental cost)", depositNetCost(dsDep) === 72.59, depositNetCost(dsDep));
  ok("the deposit no longer counts as HELD (settled)", depositHeld(dsDep) === false);
  ok("contract photo attached to the deposit as proof", dsDep.receiptId === "hd_contract.pdf", dsDep.receiptId);
  ok("the separate rental receipt was soft-deleted (no double-count)", rcptReview().every(r => r.id !== dsRcpt.id) && STORE.receipts.find(r => r.id === dsRcpt.id).deleted === true);
  ok("the settled deposit dropped off depositsAwaitingRefund", depositsAwaitingRefund().every(d => d.deposit.id !== "dep_hd"));
  // reversible: un-tombstone the receipt brings it back
  STORE.receipts.find(r => r.id === dsRcpt.id).deleted = false;
  ok("absorb is reversible (clearing the tombstone restores the receipt)", rcptReview().some(r => r.id === dsRcpt.id));
  STORE.receipts.find(r => r.id === dsRcpt.id).deleted = true;

  // GUARD: a receipt net > deposit is refused (numbers don't work) — nothing settled, both left alone
  resetStore(); global.finCanView = function () { return true; };
  const dsPaver2 = STORE.jobs.find(j => j.id === "j1");
  const dsSmall = { id: "dep_small", amount: 50, vendor: "The Home Depot", category: "rentals", isDeposit: true, depositSettled: false, deleted: false, updatedAt: Date.now() };
  dsPaver2.expenses.push(dsSmall);
  const dsBig = seedReview({ receiptId: "big.pdf", vendor: "The Home Depot", amount: 80, category: "rentals", jobId: "j1" });
  const dsBad = rcptSettleDepositFromReceipt({ store: "review", jobId: null, recId: dsBig.id }, "dep_small");
  ok("settle refused when the rental cost exceeds the deposit", !dsBad.ok && dsBad.reason === "numbers", dsBad);
  ok("refused settle left the deposit unsettled + the receipt intact", dsSmall.depositSettled !== true && rcptReview().some(r => r.id === dsBig.id));

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main();
