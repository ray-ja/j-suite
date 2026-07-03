/* OFFLINE / file:// LOGIN smoke — runs inside verify-app.js's instrumented headless load. Asserts:
 *   1) with the network down (fetch rejects), appLogin falls back to LOCAL password verification and grants
 *      LOCAL-ONLY access: jra_session → the real account, jra_offline_ok=1, and S.sync.token is UNTOUCHED
 *      (offline can never mint sync authority), and needLogin() is then false.
 *   2) the "browse while signed out" hole stays CLOSED: a cleared store (no user) + a stale jra_offline_ok +
 *      no token → needLogin() is still TRUE.
 *   3) a wrong password offline signs NOBODY in.
 * Throw / push to __errs to FAIL. Run: node verify-app.js "$(cat offline-login-tests.js)"   */

window.alert = function () {}; window.confirm = function () { return true; };
if (typeof appLogin !== "function" || typeof needLogin !== "function" || typeof appLoginOffline !== "function") throw new Error("offline-login: expected appLogin/appLoginOffline/needLogin to exist");

// hash "knownpw123" with the SAME hashPw the app uses, so it matches regardless of secure/insecure context
var KP = await hashPw("knownpw123");
if (!S.sync) S.sync = {};

// ---- 1) network-failure branch → offline fallback grants local access, token untouched ----
localStorage.removeItem("jra_session"); localStorage.removeItem("jra_offline_ok");
S.users = [{ id: "u_off_test", username: "offuser", active: true, passhash: KP, role: "crew", updatedAt: now() }];
S.biz = S.biz || "obx";
S.sync.url = "http://127.0.0.1:1";        // non-empty → appLogin attempts a real fetch first
S.sync.token = "SHARED-PLACEHOLDER";      // MUST remain byte-identical after an offline login
S.sync.auto = true; window.AUTH_401 = false;
renderLogin();
document.getElementById("lg_user").value = "offuser";
document.getElementById("lg_pw").value = "knownpw123";
var _fetch = window.fetch;
window.fetch = function () { return Promise.reject(new Error("network down")); };   // simulate the network being down
await appLogin();
window.fetch = _fetch;
if (localStorage.getItem("jra_session") !== "u_off_test") throw new Error("offline: jra_session not set to the local account");
if (localStorage.getItem("jra_offline_ok") !== "1") throw new Error("offline: jra_offline_ok not set");
if (S.sync.token !== "SHARED-PLACEHOLDER") throw new Error("offline: S.sync.token was modified (" + S.sync.token + ") — offline must NOT touch the sync token");
if (needLogin() !== false) throw new Error("offline: needLogin() should be false after a real-account offline login");
diag("offline-login: jra_session set, jra_offline_ok=1, S.sync.token untouched, needLogin()=false");

// ---- 2) cleared store + stale offline flag + no user → needLogin() MUST stay true (hole stays closed) ----
localStorage.setItem("jra_offline_ok", "1");
localStorage.removeItem("jra_session");
S.users = [];              // no account → curUser() === null
S.sync.token = "";         // no token
window.AUTH_401 = false;
if (needLogin() !== true) throw new Error("guard: needLogin() must be TRUE for a cleared store with a stale offline flag + no user");
diag("guard: cleared store + stale jra_offline_ok + no user → needLogin()=true (browse-while-signed-out hole stays closed)");

// ---- 3) wrong password offline signs nobody in ----
localStorage.removeItem("jra_session"); localStorage.removeItem("jra_offline_ok");
S.users = [{ id: "u_off_test", username: "offuser", active: true, passhash: KP, role: "crew", updatedAt: now() }];
S.sync.token = "SHARED-PLACEHOLDER";
var okBad = await appLoginOffline("offuser", "WRONGpw");
if (okBad !== false) throw new Error("offline wrong-pw: appLoginOffline should return false");
if (localStorage.getItem("jra_session")) throw new Error("offline wrong-pw: must NOT set a session");
if (S.sync.token !== "SHARED-PLACEHOLDER") throw new Error("offline wrong-pw: token must be untouched");
diag("offline wrong-password: no session set, token untouched");
