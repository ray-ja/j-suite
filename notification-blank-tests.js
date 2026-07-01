/* NEVER-BLANK REGRESSION — a push notification sent on an OLD build must never open the app to a white screen.
 *
 * Root cause this locks down: opening the app from such a notification can (a) hand render() a tab that no longer
 * exists (SW postMessage {type:"navigate",tab} / ?tab= deep link) and (b) route into a screen whose render fn
 * throws on stale-JS-meets-new-data. Unguarded, either left #view empty → white void (the cardinal sin here).
 *
 * This asserts the defense-in-depth holds:
 *   1. validTab() rejects unknown/old tabs and accepts real ones.
 *   2. render() with a bad TAB falls back to a real screen — #view NON-EMPTY.
 *   3. Simulating the SW postMessage handler body with an old/nonexistent tab → #view NON-EMPTY.
 *   4. When a screen's render fn THROWS, render() catches it and #view ends up NON-EMPTY (Today fallback).
 *   5. When even the Today fallback throws, renderRecovery writes an actionable card — #view NON-EMPTY + has a
 *      "get the latest" affordance (never a white void).
 *
 * Run: node verify-app.js "$(cat notification-blank-tests.js)"   */

window.alert = function () {}; window.confirm = function () { return true; };

// ---- sign in an OWNER on obx so screens are reachable ----
var u = { id: "u_nb_test", username: "NBTest", active: true };
S.users = S.users || []; S.users.push(u);
if (typeof orgSetRole === "function") orgSetRole("u_nb_test", "obx", "owner");
localStorage.setItem("jra_session", "u_nb_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

var view = document.getElementById("view");
var fails = [];
function ok(cond, label) { if (!cond) { fails.push(label); __errs.push("NEVER-BLANK FAIL: " + label); } diag((cond ? "ok  " : "FAIL") + " | " + label); }
function nonEmpty() { var h = (view && view.innerHTML) || ""; return h.replace(/\s+/g, "").length >= 20; }

// baseline
TAB = "today"; render();
ok(nonEmpty(), "baseline Today renders non-empty");

// ---- 1. validTab gate ----
ok(typeof validTab === "function", "validTab() helper exists");
if (typeof validTab === "function") {
  ok(validTab("today") === true, "validTab('today') true");
  ok(validTab("messages") === true, "validTab('messages') true");
  ["chat", "inbox", "home", "dashboard", "feed", "quote", "jobs2", ""].forEach(function (bad) {
    ok(validTab(bad) === false, "validTab('" + bad + "') false (unknown/old tab)");
  });
}

// ---- 2. render() with a bad TAB falls back to a real screen, non-empty ----
["chat", "inbox", "dashboard", "an_old_removed_tab"].forEach(function (bad) {
  view.innerHTML = "";           // start blank so a failure to render is visible
  TAB = bad;
  var threw = null; try { render(); } catch (e) { threw = (e && e.message) || String(e); }
  ok(!threw, "render(bad TAB '" + bad + "') did not throw");
  ok(nonEmpty(), "render(bad TAB '" + bad + "') left #view NON-EMPTY (not blank)");
});

// ---- 3. simulate the SW postMessage handler with an old/nonexistent tab ----
// (mirror js/29-boot's handler body: sanitize via validTab, then render)
function simNavigate(tab) {
  view.innerHTML = "";
  var t = tab;
  if (typeof validTab === "function" && !validTab(t)) t = (validTab("messages") ? "messages" : "today");
  TAB = t;
  var threw = null; try { render(); } catch (e) { threw = (e && e.message) || String(e); }
  return { threw: threw, landed: TAB };
}
["a_dead_old_tab", "legacychat", "notes"].forEach(function (bad) {
  var r = simNavigate(bad);
  ok(!r.threw, "SW navigate('" + bad + "') did not throw");
  ok(nonEmpty(), "SW navigate('" + bad + "') → #view NON-EMPTY (landed on " + r.landed + ")");
  ok(r.landed !== bad, "SW navigate('" + bad + "') sanitized away from the bad tab (→ " + r.landed + ")");
});
// a VALID tab still routes there
var rv = simNavigate("schedule");
ok(rv.landed === "schedule" && nonEmpty(), "SW navigate('schedule') routes to schedule, non-empty");

// NOTE: the blank-guard in render() intentionally console.error()s the swallowed throw so real stale-build skew
// is diagnosable in the field. The verify-app harness treats console.error as a failure, so we silence it ONLY
// around the two sections below where we deliberately force a render fn to throw (restored immediately after).
var _ce = console.error;

// ---- 4. a screen render fn THROWS → render() catches, falls back to Today, #view non-empty ----
var _origSched = window.rSchedule;
console.error = function () {};
window.rSchedule = function () { throw new Error("simulated stale-build crash in rSchedule"); };
view.innerHTML = "";
TAB = "schedule";
var threw4 = null; try { render(); } catch (e) { threw4 = (e && e.message) || String(e); }
window.rSchedule = _origSched;
console.error = _ce;
ok(!threw4, "render() swallows a throwing screen fn (did not propagate)");
ok(nonEmpty(), "throwing screen fn → #view NON-EMPTY (fell back to a real screen)");

// ---- 5. even the Today fallback throws → renderRecovery writes an actionable card ----
var _origToday = window.rToday, _origSched2 = window.rSchedule;
console.error = function () {};
window.rSchedule = function () { throw new Error("screen crash"); };
window.rToday = function () { throw new Error("even Today crashed"); };
view.innerHTML = "";
TAB = "schedule";
var threw5 = null; try { render(); } catch (e) { threw5 = (e && e.message) || String(e); }
window.rToday = _origToday; window.rSchedule = _origSched2;
console.error = _ce;
ok(!threw5, "render() swallows even a throwing Today fallback");
ok(nonEmpty(), "double-throw → renderRecovery leaves #view NON-EMPTY (never a white void)");
var rec = ((view && view.innerHTML) || "").toLowerCase();
ok(/forceupdate|get the latest|reload|refresh/.test(rec), "recovery card offers an actionable get-latest/reload affordance");

// restore a clean render
TAB = "today"; render();

diag("NEVER-BLANK summary: " + (fails.length ? (fails.length + " FAILED") : "ALL PASS"));
if (fails.length) throw new Error("never-blank regression: " + fails.length + " assertion(s) failed: " + fails.join(" | "));
