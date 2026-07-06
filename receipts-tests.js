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

const code = fs.readFileSync(__dirname + "/js/72-receipts.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/87-receipt-edit.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/88-cap-receipts.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/52-job-pl.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/92-receipt-split.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/80-budget-csv.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/93-receipt-csv.js", "utf8") + "\n" + fs.readFileSync(__dirname + "/js/94-card-attribution.js", "utf8");
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

  console.log("— client: Cap stamps ONLY `suggested` (never a real field) on approve-in-edit —");
  resetStore();
  const capRec = seedReview({ receiptId: "cap1.jpg", vendor: "", amount: null, type: null, jobId: null, category: "" });
  const before = JSON.stringify(capRec);
  CAP_FETCH = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ suggested: { vendor: "Depot", amount: 88, date: "2026-06-30", desc: "pavers", type: "pass-through", category: "materials", jobId: "j1", confidence: 0.9 } }); } }); };
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

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main();
