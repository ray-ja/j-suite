/* PER-SCREEN RENDER SMOKE — navigate to EVERY nav tab/screen and assert each renders with zero console/runtime
 * errors AND non-empty content. A single per-screen render throw (or a screen that silently renders blank) is a
 * whole tab dead in the field; this catches both on every run.
 *
 * Tabs are taken from render()'s dispatch table in js/03-routing.js (the authoritative list) plus the opt-in
 * tabs (escape/booking/life/budget), which we enable on the obx org so render() routes them naturally instead
 * of coercing to Today.
 *
 * Errors are captured by verify-app.js's window.__errs (console.error / thrown / unhandledrejection). This test
 * ADDS: per-tab it clears/snapshots __errs, renders, and flags (a) any NEW error during that tab's render and
 * (b) an empty #view. Any flagged tab is a broken screen.
 *
 * Run: node verify-app.js "$(cat render-smoke-tests.js)"   */

// native dialogs hang headless; some render paths may alert on missing config
window.alert = function () {}; window.confirm = function () { return true; };

// ---- sign in an OWNER so every role-gated page is reachable ----
var rsUser = { id: "u_rendersmoke_test", username: "RenderSmoke", active: true };
S.users = S.users || [];
S.users.push(rsUser);
if (typeof orgSetRole === "function") orgSetRole("u_rendersmoke_test", "obx", "owner");
localStorage.setItem("jra_session", "u_rendersmoke_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

// ---- enable ALL tabs on obx (incl. the opt-in escape/booking/life/budget) so render() routes each one ----
(function () {
  var reg = (S.registry || []).find(function (r) { return r && r.id === "obx"; });
  if (reg && typeof ALL_TABS !== "undefined") {
    // include the standard tabs (ALL_TABS) + the opt-in niche tabs so nothing gets coerced to Today
    var extra = ["escape", "booking", "life", "budget"];
    reg.tabs = ALL_TABS.slice().concat(extra.filter(function (t) { return ALL_TABS.indexOf(t) < 0; }));
  }
})();

// ---- seed a little data so screens have something to render (and exercise their row/card templates) ----
var d = D();
d.customers = d.customers || []; if (!d.customers.length) d.customers.push({ id: "c_rs", name: "Smoke Customer", notes: [], updatedAt: now() });
d.jobs = d.jobs || []; if (!d.jobs.length) d.jobs.push({ id: "j_rs", title: "Smoke Job", date: today(), crew: ["u_rendersmoke_test"], done: false, updatedAt: now() });
d.todos = d.todos || []; if (!d.todos.length) d.todos.push({ id: "t_rs", title: "Smoke todo", done: false, updatedAt: now() });

// ---- the authoritative screen list (keys from render()'s dispatch map in js/03) ----
var SCREENS = ["today", "messages", "schedule", "leads", "quotes", "recurring", "accounts",
  "finance", "receipts", "pay", "inventory", "resale", "admin", "data", "playbook",
  "research", "todo", "map", "route", "plan", "market", "opps", "sites", "buildplan",
  "training", "time", "approvals", "escape", "booking", "life", "budget", "team", "routes"];

var view = document.getElementById("view");
var totalErrsBefore, results = [];

SCREENS.forEach(function (tab) {
  var errAt = window.__errs.length;   // snapshot: anything appended below is THIS tab's fault
  TAB = tab;
  window.JOB_OPEN = null;
  var threw = null;
  try { render(); } catch (e) { threw = (e && (e.stack || e.message)) || String(e); }
  var routedTo = TAB;   // render()/applyAccess may have coerced TAB elsewhere
  var html = (view && view.innerHTML) || "";
  var newErrs = window.__errs.slice(errAt);
  // if applyAccess coerced this tab to "today", the org can't see it — note it but don't fail (visibility, not a crash)
  var coerced = routedTo !== tab;
  var empty = html.replace(/\s+/g, "").length < 20;
  results.push({ tab: tab, coerced: coerced, routedTo: routedTo, empty: empty, threw: threw, newErrs: newErrs.length });

  if (threw) __errs.push("RENDER THREW [" + tab + "]: " + threw);
  // a NEW captured error during this tab's render (console.error / unhandledrejection) — but the harness already
  // globally fails on __errs, so those surface anyway; we annotate which tab caused them via diag below.
  if (!coerced && empty && !threw) __errs.push("BLANK SCREEN [" + tab + "]: render() produced (near-)empty #view content (" + html.length + " chars) — screen may be dead");
});

// ---- JOB PAGE + movable-route card (js/61): open a job with a planned stop + a site-first sitePos, render, and
//      assert the reorderable route card renders with the ▲▼ handler (jobPageRouteMove) + the movable 🏁 site row. ----
(function () {
  var jr = D().jobs.find(function (x) { return x.id === "j_rs"; });
  if (jr) { jr.address = "1 Job Site Rd"; jr.plannedStops = [{ id: "s_rs", label: "Supplier", address: "2 Supply Ave", lat: null, lng: null }]; jr.sitePos = 0; }
  TAB = "schedule"; window.JOB_OPEN = "j_rs";
  var threw = null;
  try { render(); } catch (e) { threw = (e && (e.stack || e.message)) || String(e); }
  var html = (document.getElementById("view") || {}).innerHTML || "";
  if (threw) __errs.push("JOB PAGE RENDER THREW: " + threw);
  if (html.indexOf("jobPageRouteMove") < 0) __errs.push("JOB PAGE: route card missing the ▲▼ reorder handler (jobPageRouteMove)");
  if (html.indexOf("🏁 Job site") < 0) __errs.push("JOB PAGE: movable job-site row (🏁 Job site) not rendered");
  diag("job page: threw=" + (threw ? "YES" : "no") + " | hasRouteMove=" + (html.indexOf("jobPageRouteMove") >= 0) + " | hasSiteRow=" + (html.indexOf("🏁 Job site") >= 0) + " | len=" + html.length);
  window.JOB_OPEN = null;
})();

results.forEach(function (r) {
  diag("screen " + r.tab + (r.coerced ? " (coerced->" + r.routedTo + ", org-hidden)" : "") + " | empty=" + r.empty + " | threw=" + (r.threw ? "YES" : "no") + " | newErrs=" + r.newErrs);
});
diag("screens rendered=" + results.length + " | threw=" + results.filter(function (r) { return r.threw; }).length + " | blank=" + results.filter(function (r) { return !r.coerced && r.empty && !r.threw; }).length);
