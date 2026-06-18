/* ---------- DEV AUTO-LOGIN (admin/admin) ----------
   Testing convenience: on a DEV host, fill admin/admin on the login screen and submit automatically,
   so dev opens straight into the app. Exercises the REAL /login flow (not a bypass) — just instant.

   SAFETY (single point of trust = the host check in js/55):
     • Runs ONLY when window.jsIsDevHost() is true. On the prod host/IP it never even arms.
     • Fails toward safe twice over: (1) host-gated; (2) even in a freak case where a non-prod host
       served prod, admin/admin is not prod's password, so /login just rejects → manual login. It can
       never grant access it shouldn't.
     • Only acts while needLogin() is true and only ONCE; if it fails, the manual screen stays usable.
   Committed (not the gitignored bypass) so dev testing is consistent and not "janky". */
(function () {
  if (typeof window === "undefined") return;
  if (!window.jsIsDevHost || !window.jsIsDevHost()) return;        // not a confirmed dev host → never auto-login
  if (typeof location === "undefined" || location.protocol.indexOf("http") !== 0) return;  // need a real server (/login); file:// skips
  var tried = false, ticks = 0;
  function attempt() {
    if (tried) return true;
    if (typeof needLogin !== "function" || !needLogin()) return true;   // already connected → done, stop polling
    var u = document.getElementById("lg_user"), p = document.getElementById("lg_pw");
    if (!u || !p || typeof appLogin !== "function") return false;       // login screen not up yet → keep waiting
    if (u.value && u.value !== "admin") return true;                    // user is typing their own → back off
    tried = true;
    u.value = "admin"; p.value = "admin";
    if (typeof loginMsg === "function") loginMsg("Dev auto-login (admin/admin)…");
    try { appLogin(); } catch (e) { tried = false; }                   // on throw, let the manual screen work
    return true;
  }
  var iv = setInterval(function () { ticks++; if (attempt() || ticks > 60) clearInterval(iv); }, 200);  // ~12s cap
  if (document.readyState !== "loading") attempt();
  else document.addEventListener("DOMContentLoaded", attempt);
})();
