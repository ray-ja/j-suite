/* nav-return-tests.js — RETURN-TO-ORIGIN invariant, driven through the REAL handlers.
 *
 * Run inside the browser-context harness (NOT standalone node):
 *     node verify-app.js "$(cat nav-return-tests.js)"
 *
 * The bug (Ray, recurring app-wide): after you COMPLETE / DELETE / CLOSE a subpage, the app must return
 * you to the PAGE YOU WERE ON, not a default tab. Concrete repro: Receipts → tap a job closeout (opens the
 * job page inside the Schedule tab) → delete → you landed on SCHEDULE instead of back on RECEIPTS.
 *
 * These tests set an origin TAB, open the real take-over subpage (openJobPage / openQuote) or a real modal
 * detail, run the REAL delete/close handler (delJob, jobPageBack, wizDelete, exitWizard, delCustomer,
 * delProperty, delPlaceRec, rcptDelRow), and assert TAB returned to the ORIGIN — never the host default.
 * Assertions THROW so verify-app reports the failure.
 *
 * render() is stubbed to a no-op here on purpose: the fix sets TAB *before* render(), so this isolates the
 * pure routing invariant. (That destination pages actually render without throwing is covered by
 * render-smoke-tests 32/32; the never-blank guard by notification-blank-tests.) */

let __p = 0;
function A(cond, msg) { if (!cond) throw new Error("NAV-RETURN FAIL: " + msg); __p++; diag("ok · " + msg); }

/* ---- isolate: stub render + force the permission/lock gates open, stub the map re-render ---- */
const _render = window.render, _confirm = window.confirm, _alert = window.alert,
      _isOwner = window.isOwner, _finCanView = window.finCanView, _canEditPlan = window.jobCanEditPlan,
      _renderPlaces = window.renderPlaces;
window.render = function () {};                 // isolate the routing invariant from screen-render fragility
window.confirm = function () { return true; };  // auto-confirm every "Delete this…?" prompt
window.alert = function () {};
window.isOwner = function () { return true; };
window.finCanView = function () { return true; };
window.jobCanEditPlan = function () { return true; };
window.renderPlaces = function () {};           // delPlace() (js/19) re-renders the map list — not under test

const d = D();
d.jobs = d.jobs || []; d.quotes = d.quotes || []; d.customers = d.customers || [];
d.properties = d.properties || []; d.places = d.places || []; d.receipts = d.receipts || [];

function seedJob(id) { const j = { id: id, title: "Nav test job", customerId: null, crew: [], materials: [], expenses: [], date: today() }; d.jobs.push(j); return j; }
function seedQuote(id) { const q = { id: id, cust: "Nav Test", customerId: null, address: "", items: [], total: 0, subtotal: 0 }; d.quotes.push(q); return q; }

/* ========================================================================================
 * 1) JOB PAGE — the exact bug: Receipts → openJobPage → delete → must land back on RECEIPTS
 * ====================================================================================== */
seedJob("nav_job_rc");
TAB = "receipts";
openJobPage("nav_job_rc");
A(window.JOB_OPEN === "nav_job_rc" && TAB === "schedule", "openJobPage takes over the Schedule tab (JOB_OPEN set, TAB=schedule)");
A(window.JOB_RETURN_TAB === "receipts" && navOriginFor("schedule") === "receipts", "origin (receipts) recorded via the shared nav-return helper");
delJob("nav_job_rc");
A(TAB === "receipts", "DELETE on the job page returns to RECEIPTS (the bug: was landing on Schedule) — got " + TAB);
A(window.JOB_OPEN === null, "job page closed after delete (JOB_OPEN cleared)");

/* generic invariant: opened from X, deleted → TAB === X (try several origins) */
["jobs", "today", "receipts"].forEach(function (origin) {
  const id = "nav_job_" + origin;
  seedJob(id);
  TAB = origin;
  openJobPage(id);
  A(TAB === "schedule", "[" + origin + "] openJobPage → schedule host");
  delJob(id);
  A(TAB === origin, "[" + origin + "] delete on job page → TAB===origin (" + origin + "), got " + TAB);
});

/* opened from within Schedule (no cross-tab origin) → delete falls back to Schedule, never crashes */
seedJob("nav_job_sched");
TAB = "schedule";
openJobPage("nav_job_sched");
A(window.JOB_RETURN_TAB === null, "no origin recorded when opened from the host tab itself");
delJob("nav_job_sched");
A(TAB === "schedule", "delete with no recorded origin falls back to Schedule (safe default), got " + TAB);

/* CLOSE (Back), not delete: jobPageBack must also honor the origin */
seedJob("nav_job_close");
TAB = "today";
openJobPage("nav_job_close");
jobPageBack();
A(TAB === "today" && window.JOB_OPEN === null, "jobPageBack (close/×) returns to origin (today), got " + TAB);

/* ========================================================================================
 * 2) QUOTE WIZARD — opened from the Jobs table → delete/close must return to JOBS, not Quotes
 * ====================================================================================== */
seedQuote("nav_q_del");
TAB = "jobs";
openQuote("nav_q_del");
if (typeof WZ !== "undefined" && WZ) WZ.readonly = false;   // not lock-blocked in headless
A(WZON === true && TAB === "quotes", "openQuote takes over the Quotes tab (WZON, TAB=quotes)");
A(navOriginFor("quotes") === "jobs", "wizard recorded origin (jobs) via the shared helper");
wizDelete();
A(WZON === false && TAB === "jobs", "DELETE quote returns to the JOBS table (not Quotes), got " + TAB);

/* CLOSE/cancel the wizard (exitWizard) from the Jobs table → back to Jobs */
seedQuote("nav_q_close");
TAB = "jobs";
openQuote("nav_q_close");
if (typeof WZ !== "undefined" && WZ) WZ.readonly = false;
exitWizard();
A(WZON === false && TAB === "jobs", "CLOSE/cancel wizard returns to the JOBS table, got " + TAB);

/* new quote started from the Quotes tab → exit stays on Quotes (fallback, no regression to forward nav) */
TAB = "quotes";
startWizard();
A(navOriginFor("quotes") === null, "new quote from Quotes tab records no cross-tab origin");
exitWizard();
A(TAB === "quotes", "exit of a Quotes-tab-started wizard stays on Quotes (safe default), got " + TAB);

/* ========================================================================================
 * 3) MODAL detail deletes — already float over the current tab; lock the invariant so it stays that way.
 *    People & Places sub-tab (ACCTSUB) must be preserved across a customer / property / place delete.
 * ====================================================================================== */
(function () {
  const c = { id: "nav_cust", name: "Nav Cust", status: "Lead", notes: [] }; d.customers.push(c);
  TAB = "accounts"; ACCTSUB = "customers";
  delCustomer("nav_cust");
  A(TAB === "accounts" && ACCTSUB === "customers", "delete customer stays on People&Places → Customers, got " + TAB + "/" + ACCTSUB);
})();
(function () {
  const p = { id: "nav_prop", label: "Nav Prop", address: "1 Nav St", customerIds: [] }; d.properties.push(p);
  TAB = "accounts"; ACCTSUB = "properties";
  delProperty("nav_prop");
  A(TAB === "accounts" && ACCTSUB === "properties", "delete property stays on People&Places → Properties, got " + TAB + "/" + ACCTSUB);
})();
(function () {
  const pl = { id: "nav_place", name: "Nav Place", type: "saved", lat: null, lng: null }; d.places.push(pl);
  TAB = "accounts"; ACCTSUB = "places";
  delPlaceRec("nav_place");
  A(TAB === "accounts" && ACCTSUB === "places", "delete place stays on People&Places → Places, got " + TAB + "/" + ACCTSUB);
})();

/* ========================================================================================
 * 4) RECEIPT delete on the Receipts page — stays on Receipts (modal delete over the current tab)
 * ====================================================================================== */
(function () {
  const r = (typeof rcptNewReview === "function") ? rcptNewReview("nav_blob.jpg") : { id: "nav_rcpt", status: "review", receiptId: "nav_blob.jpg" };
  r.id = "nav_rcpt"; d.receipts.push(r);
  TAB = "receipts";
  rcptDelRow("review", "", "nav_rcpt");
  A(TAB === "receipts", "delete a receipt on the Receipts page stays on Receipts, got " + TAB);
})();

/* ---- restore the harness globals ---- */
window.render = _render; window.confirm = _confirm; window.alert = _alert;
window.isOwner = _isOwner; window.finCanView = _finCanView; window.jobCanEditPlan = _canEditPlan;
window.renderPlaces = _renderPlaces;

diag("nav-return-tests: ALL " + __p + " assertions passed");
