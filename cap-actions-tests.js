/* Cap-Today PHASE 2 — client confirm-card assert (js/97-cap-today.js). Runs inside the real app via verify-app.js:
     node verify-app.js "$(cat cap-actions-tests.js)"
   Proves: a returned clockIn action renders a confirm card narrated from LOCAL data; Confirm calls the mapped
   EXISTING fn (tcClockInWith — stubbed) with the resolved args; the card is SINGLE-USE (a second Confirm is a
   no-op); Cancel executes NOTHING; and the confirm-before-act gate holds (nothing runs without a Confirm tap). */

// --- setup: a signed-in owner + a job scheduled today so the card narration resolves a real title ---
S.biz = "obx";
var me = { id: "u_cap_test", username: "CapTest", active: true };
S.users.push(me);
if (typeof orgSetRole === "function") orgSetRole(me.id, "obx", "owner");
localStorage.setItem("jra_session", me.id); localStorage.setItem("jra_offline_ok", "1");
var job = { id: "j_cap_test", title: "Cap card test job", customerId: null, date: today(), crew: [me.id], done: false, updatedAt: now() };
D().jobs.push(job);

if (typeof capThreadInner !== "function" || typeof capConfirmAction !== "function" || typeof capCancelAction !== "function")
  __errs.push("cap-actions: js/97 Phase-2 functions (capThreadInner/capConfirmAction/capCancelAction) are missing");

// === 1) a returned clockIn action renders a confirm card with resolved job title + Confirm/Cancel ===
CAP_THREAD = [{ role: "action", action: { action: "clockIn", jobId: "j_cap_test", odometer: 45210, placeHint: "the shop", vehicleHint: null }, state: "pending", cid: "c1", err: null }];
var html = capThreadInner();
diag("card html includes title=" + /Cap card test job/.test(html) + " confirm=" + /Confirm/.test(html) + " odo=" + /45,210/.test(html));
if (!/Cap card test job/.test(html)) __errs.push("cap-actions: confirm card did not narrate the resolved job title (used raw id?)");
if (!/Confirm/.test(html) || !/Cancel/.test(html)) __errs.push("cap-actions: confirm card missing Confirm/Cancel buttons");
if (!/capConfirmAction\('c1'\)/.test(html) || !/capCancelAction\('c1'\)/.test(html)) __errs.push("cap-actions: confirm/cancel buttons not wired to this card's cid");

// === 2) Confirm → calls tcClockInWith (stub) with the resolved args; 3) card is SINGLE-USE ===
var callCount = 0, calledWith = null;
var _origClockIn = window.tcClockInWith;
window.tcClockInWith = function (args) { callCount++; calledWith = args; return { ok: true, entry: { id: "stub" } }; };
await capConfirmAction("c1");
diag("after Confirm: callCount=" + callCount + " jobId=" + (calledWith && calledWith.jobId));
if (callCount !== 1) __errs.push("cap-actions: Confirm did not call tcClockInWith exactly once (got " + callCount + ")");
if (!calledWith || calledWith.jobId !== "j_cap_test") __errs.push("cap-actions: tcClockInWith was not called with the resolved jobId");
var it1 = CAP_THREAD.find(function (m) { return m.cid === "c1"; });
if (!it1 || it1.state !== "done") __errs.push("cap-actions: card state is not 'done' after a successful Confirm");
if (!CAP_THREAD.some(function (m) { return m.role === "assistant" && /clocked in/i.test(m.content || ""); })) __errs.push("cap-actions: no Cap ack appended after Confirm");
// single-use: a SECOND confirm on the same card must be a no-op (rapid double-tap guard)
await capConfirmAction("c1");
if (callCount !== 1) __errs.push("cap-actions: card is NOT single-use — Confirm ran the action twice");
window.tcClockInWith = _origClockIn;

// === 4) Cancel executes NOTHING (confirm-before-act: no fn runs without a Confirm) ===
var cancelExec = 0;
var _o2 = window.tcClockInWith;
window.tcClockInWith = function () { cancelExec++; return { ok: true }; };
CAP_THREAD = [{ role: "action", action: { action: "clockIn", jobId: "j_cap_test", odometer: null, placeHint: null, vehicleHint: null }, state: "pending", cid: "c2", err: null }];
capCancelAction("c2");
diag("after Cancel: cancelExec=" + cancelExec);
if (cancelExec !== 0) __errs.push("cap-actions: Cancel executed the action (tcClockInWith was called)");
var it2 = CAP_THREAD.find(function (m) { return m.cid === "c2"; });
if (!it2 || it2.state !== "cancelled") __errs.push("cap-actions: Cancel did not mark the card cancelled");
window.tcClockInWith = _o2;

// cleanup so later state is clean
job.deleted = true; localStorage.removeItem("jra_session");
