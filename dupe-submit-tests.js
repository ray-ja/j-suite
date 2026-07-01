/* DUPLICATE-SUBMIT INVARIANT — the "5 RJs on one job" / rapid-tap class, j-Suite's #1 recurring prod bug.
 *
 * On a weak jobsite signal a save looks like a no-op, so the crew taps the button 5-20 more times. If the
 * handler has no submit-in-flight guard, every tap independently creates its own record → duplicates.
 *
 * This test drives each user-facing create handler exactly the way a rapid tap does: it opens the real modal
 * (which bakes the record's stable id into the Save button's onclick), fills the required fields, then invokes
 * the SAME Save action N times back-to-back — and asserts AT MOST ONE new record lands in the collection.
 *
 * Known-guarded handlers (must PASS): jobAddMaterial / jobAddExpense (js/61, _jobMatAddBusy/_jobExpAddBusy).
 * Everything else is under audit — a handler that creates N records is FLAGGED as an unguarded dupe bug.
 *
 * Run inside the real app via verify-app.js (handlers are browser-defined):
 *     node verify-app.js "$(cat dupe-submit-tests.js)"
 * A pushed __errs line = an EXPOSED bug (that's the goal); diag() prints per-handler context. */

var TAPS = 8;   // "rapid taps" — how many times the crew jams the button

// native dialogs hang headless Chrome; stub so a validation alert() can't block the run
window.alert = function () {}; window.confirm = function () { return true; };

// ---- sign in a test owner (same bypass the other DOM tests use) ----
var duUser = { id: "u_dupe_test", username: "DupeTest", active: true };
S.users = S.users || [];
S.users.push(duUser);
if (typeof orgSetRole === "function") orgSetRole("u_dupe_test", "obx", "owner");
localStorage.setItem("jra_session", "u_dupe_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

function setVal(id, v) { var e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); } return !!e; }
function setChecked(id, v) { var e = document.getElementById(id); if (e) e.checked = v; return !!e; }
function collLen(getter) { try { return (getter() || []).filter(function (r) { return r && !r.deleted; }).length; } catch (e) { return 0; } }
function distinctIds(getter) { try { var s = {}; (getter() || []).forEach(function (r) { if (r && !r.deleted && r.id != null) s[r.id] = 1; }); return Object.keys(s).length; } catch (e) { return 0; } }

// Core helper: open a modal via `openFn`, run `fill()` to populate its fields, then tap Save `TAPS` times and
// report how many NEW records appeared. `saveSelector` finds the Save button in the modal; if absent we fall
// back to invoking the named window handler directly with the captured id.
function runDupe(name, opts) {
  var before = collLen(opts.count), idsBefore = distinctIds(opts.count);
  try { opts.open(); } catch (e) { diag(name + ": open() threw — " + (e && e.message)); }
  var fillOk = true;
  try { fillOk = opts.fill() !== false; } catch (e) { diag(name + ": fill() threw — " + (e && e.message)); fillOk = false; }
  if (!fillOk) { diag(name + ": SKIPPED (could not fill the form — modal fields missing)"); if (typeof closeModal === "function") closeModal(); return; }

  // find the Save button the way a finger would — the real onclick, baked with the stable id
  var saveBtn = document.querySelector('#sheet button[onclick*="' + opts.saveFn + '"]') ||
                document.querySelector('button[onclick*="' + opts.saveFn + '"]');
  var tapped = 0;
  for (var i = 0; i < TAPS; i++) {
    if (saveBtn) { saveBtn.click(); tapped++; }
    else if (opts.tap) { opts.tap(); tapped++; }
    // NOTE: if the first tap closes the modal + re-renders, saveBtn is detached but its onclick still fires the
    // same handler with the same baked id — which is exactly the real-world race (queued taps hit a stale node).
  }
  var after = collLen(opts.count);
  var created = after - before;
  var newIds = distinctIds(opts.count) - idsBefore;
  // newIds > 1 = the WORST case: every tap minted a fresh uid(), so all N survive a per-record LWW sync.
  // created > 1 with newIds <= 1 = N array entries sharing ONE id (still a local dupe, partially dedup-able by sync).
  var sev = newIds > 1 ? " [SEVERE: " + newIds + " DISTINCT ids — all survive sync]" : " [shared-id dupe]";
  diag(name + ": taps=" + tapped + " records_created=" + created + " distinct_new_ids=" + newIds + (saveBtn ? " (via Save button)" : " (via direct call)"));
  if (created > 1) __errs.push("UNGUARDED DUPLICATE-SUBMIT [" + name + " -> " + opts.saveFn + "()]: " + TAPS + " rapid taps created " + created + " records (expected 1)" + sev + " — file: " + opts.file);
  if (created === 0) diag(name + ": WARNING created 0 records — fill/validation may have blocked the save (not a dupe result)");
  if (typeof closeModal === "function") closeModal();
}

// need one job + customer to hang some records off of
var duJob = { id: "job_dupe_test", title: "Dupe-submit host job", date: today(), crew: ["u_dupe_test"], done: false, materials: [], expenses: [], updatedAt: now() };
D().jobs = D().jobs || []; D().jobs.push(duJob);
var duCust = { id: "cust_dupe_test", name: "Dupe Host Customer", notes: [], updatedAt: now() };
D().customers = D().customers || []; D().customers.push(duCust);

// ================= the audit =================

// --- add customer (js/06) ---
runDupe("add-customer", {
  file: "js/06-customers.js", saveFn: "saveCustomer",
  count: function () { return D().customers; },
  open: function () { openCustomer(); },
  fill: function () { return setVal("f_name", "Rapid Tap Customer"); }
});

// --- add property (js/07) ---
runDupe("add-property", {
  file: "js/07-properties-own-entity-m-n-wi.js", saveFn: "saveProperty",
  count: function () { return D().properties; },
  open: function () { openProperty(); },
  fill: function () { return setVal("p_label", "Rapid Tap Lot"); }
});

// --- add to-do (js/10) ---
runDupe("add-todo", {
  file: "js/10-to-do.js", saveFn: "saveTodo",
  count: function () { return D().todos; },
  open: function () { openTodo(); },
  fill: function () { return setVal("td_title", "Rapid Tap Task"); }
});

// --- schedule/save job (js/09) ---
runDupe("save-job", {
  file: "js/09-schedule.js", saveFn: "saveJob",
  count: function () { return D().jobs; },
  open: function () { openJob(); },
  fill: function () { return setVal("j_title", "Rapid Tap Job"); }
});

// --- add inventory item (js/31) ---
runDupe("add-inventory", {
  file: "js/31-inventory.js", saveFn: "saveInvItem",
  count: function () { return D().inventory; },
  open: function () { if (typeof openInvItem === "function") openInvItem(); },
  fill: function () { return setVal("iv_name", "Rapid Tap Tool"); }
});

// --- record income (js/40) ---
runDupe("record-income", {
  file: "js/40-finance.js", saveFn: "saveIncome",
  count: function () { return D().income; },
  open: function () { if (typeof openIncome === "function") openIncome(); },
  fill: function () { return setVal("in_amt", "500"); }
});

// --- add expense (js/40) ---
runDupe("add-expense", {
  file: "js/40-finance.js", saveFn: "saveExpense",
  count: function () { return D().expenses; },
  open: function () { if (typeof openExpense === "function") openExpense(); },
  fill: function () { return setVal("ex_amt", "73"); }
});

// --- record disbursement / owner draw (js/64) — generates a fresh uid() per save-with-no-id ---
runDupe("record-disbursement", {
  file: "js/64-finance-overview.js", saveFn: "saveDisbursement",
  count: function () { return D().disbursements; },
  open: function () { if (typeof recordDisbursement === "function") recordDisbursement("draw"); },
  fill: function () { return setVal("db_amt", "200"); }
});

// --- add change order (job page, js/61) — if present ---
if (typeof jobAddChangeOrder === "function") {
  runDupe("add-change-order", {
    file: "js/61-job-page.js", saveFn: "jobAddChangeOrder",
    count: function () { var j = actJ().find(function (x) { return x.id === duJob.id; }); return (j && j.changeOrders) || []; },
    open: function () { window.JOB_OPEN = duJob.id; TAB = "schedule"; render(); },
    fill: function () { var a = setVal("co_desc", "Extra haul"); setVal("co_amt", "150"); return a; },
    tap: function () { jobAddChangeOrder(duJob.id); }
  });
} else { diag("add-change-order: no jobAddChangeOrder() — skipped"); }

// ================= KNOWN-GUARDED (must PASS) =================
// jobAddExpense / jobAddMaterial already carry _jobExpAddBusy/_jobMatAddBusy guards. Prove they still hold so a
// future refactor can't silently drop the guard.
(function () {
  var j = actJ().find(function (x) { return x.id === duJob.id; });
  if (!j) { diag("guarded-check: host job missing"); return; }
  window.JOB_OPEN = duJob.id; TAB = "schedule"; render();
  var amtEl = document.getElementById("exp_amt") || document.getElementById("mat_amt");
  if (typeof jobAddExpense === "function" && document.getElementById("exp_amt")) {
    setVal("exp_amt", "40"); setVal("exp_desc", "Guarded dump fee");
    var before = ((j.expenses || []).filter(function (e) { return !e.deleted; })).length;
    for (var i = 0; i < TAPS; i++) jobAddExpense(duJob.id);
    var after = ((actJ().find(function (x) { return x.id === duJob.id; }).expenses || []).filter(function (e) { return !e.deleted; })).length;
    diag("GUARDED jobAddExpense: taps=" + TAPS + " created=" + (after - before) + " (want <=1)");
    if (after - before > 1) __errs.push("REGRESSION [jobAddExpense]: the _jobExpAddBusy guard no longer holds — " + TAPS + " taps created " + (after - before) + " expenses");
  } else { diag("GUARDED jobAddExpense: exp_amt field not rendered — skipped"); }
})();
