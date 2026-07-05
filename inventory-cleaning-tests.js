/* Inventory cleaning + gear-checklist tests (Phases 4 & 5) — exercised in the REAL headless app
 * (verify-app.js boots the full shell, so load()/render()/toggleJob/openInvItem all run for real).
 *
 * Covers:
 *   A1) completing a job auto-flags its dirtiesWithUse gear as needsCleaning (stamped when/who),
 *   A2) it's idempotent (re-completing doesn't re-stamp) + reopening a job does NOT clear the flag,
 *   A3) manual invFlagCleaning / invClearCleaning stamp correctly,
 *   A4) the "🧽 Needs cleaning" inventory view lists the flagged items with a Mark-cleaned action,
 *   B1) the job-page load checklist shows an N/M loaded progress count,
 *   B2) a needs-cleaning badge shows next to a flagged checklist item.
 *
 * Failures push to window.__errs (verify-app fails the run on any); diag() prints non-failing traces.
 * Run: node verify-app.js "$(cat inventory-cleaning-tests.js)"   */

window.alert = function () {}; window.confirm = function () { return true; };
function ok(name, cond) { if (!cond) __errs.push("CLEANING TEST FAIL: " + name); else diag("ok: " + name); }

// ---- sign in an OWNER so stamps resolve to a real user + role-gated pages render ----
var u = { id: "u_clean_test", username: "CleanTester", active: true };
S.users = S.users || [];
S.users.push(u);
if (typeof orgSetRole === "function") orgSetRole("u_clean_test", "obx", "owner");
localStorage.setItem("jra_session", "u_clean_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

var d = D();
function inv(id) { return D().inventory.find(function (x) { return x.id === id; }); }

// ---- two inventory items: one dirties-with-use (chainsaw), one not (rake) ----
d.inventory.push({ id: "invt_saw", name: "Test Chainsaw", cat: "equipment", have: true, qty: "1", dirtiesWithUse: true, tags: [], updatedAt: now() });
d.inventory.push({ id: "invt_rake", name: "Test Rake", cat: "tool", have: true, qty: "1", dirtiesWithUse: false, tags: [], updatedAt: now() });

// ---- a job with both attached; saw loaded, rake not (→ 1/2 loaded) ----
var jid = "jclean1";
d.jobs.push({ id: jid, title: "Cleaning Test Job", date: today(), crew: ["u_clean_test"], equipment: [{ itemId: "invt_saw", qty: 1, loaded: true }, { itemId: "invt_rake", qty: 1, loaded: false }], done: false, updatedAt: now() });

// ===== A1) auto-flag on job wrap =====
toggleJob(jid);
ok("job marked done", inv("invt_saw") && D().jobs.find(function (x) { return x.id === jid; }).done === true);
ok("A1: dirties-with-use saw flagged needsCleaning on wrap", inv("invt_saw").needsCleaning === true);
ok("A1: saw cleanFlaggedAt stamped", !!inv("invt_saw").cleanFlaggedAt);
ok("A1: saw cleanFlaggedBy = current user", inv("invt_saw").cleanFlaggedBy === "u_clean_test");
ok("A1: non-dirty rake NOT flagged", !inv("invt_rake").needsCleaning);

// ===== A2) idempotent + reopen doesn't clear =====
inv("invt_saw").cleanFlaggedAt = 12345;   // sentinel: prove a later flag pass won't overwrite it
toggleJob(jid);   // reopen
ok("A2: reopening the job does NOT clear needsCleaning", inv("invt_saw").needsCleaning === true);
toggleJob(jid);   // complete again
ok("A2: re-completing is idempotent — stamp not overwritten", inv("invt_saw").cleanFlaggedAt === 12345);

// ===== A3) manual flag / clear stamps =====
invClearCleaning("invt_saw");
ok("A3: manual clear sets needsCleaning=false", inv("invt_saw").needsCleaning === false);
ok("A3: clear stamps cleanClearedAt", !!inv("invt_saw").cleanClearedAt);
ok("A3: clear stamps cleanClearedBy", inv("invt_saw").cleanClearedBy === "u_clean_test");
invFlagCleaning("invt_rake");
ok("A3: manual flag sets needsCleaning=true", inv("invt_rake").needsCleaning === true);
ok("A3: flag stamps cleanFlaggedBy", inv("invt_rake").cleanFlaggedBy === "u_clean_test");

// ===== A4) needs-cleaning view lists flagged items =====
INVVIEW = "cleaning"; TAB = "inventory"; window.JOB_OPEN = null;
render();
var vhtml = (document.getElementById("view") || {}).innerHTML || "";
ok("A4: cleaning view lists the flagged rake", vhtml.indexOf("Test Rake") >= 0);
ok("A4: cleaning view offers a Mark cleaned action", vhtml.indexOf("Mark cleaned") >= 0);
ok("A4: cleared saw is NOT in the cleaning view", vhtml.indexOf("Test Chainsaw") < 0);

// ===== B) job-page load checklist — progress count + needs-cleaning badge =====
invFlagCleaning("invt_saw");   // re-flag the saw so a checklist item is dirty
window.JOB_OPEN = jid; TAB = "schedule";
render();
var jhtml = (document.getElementById("view") || {}).innerHTML || "";
ok("B1: load checklist shows an N/M loaded progress count (1/2)", /1\/2 loaded/.test(jhtml));
ok("B2: load checklist shows a needs-cleaning badge on the flagged item", jhtml.indexOf("needs cleaning") >= 0);

diag("cleaning tests complete");
