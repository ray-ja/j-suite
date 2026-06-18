/* ---------- ENV GUARDRAIL BANNER ----------
   Shows a 🟡 DEV marker on any host that is NOT confirmed production, so a dev instance can never be
   mistaken for prod (Ray hit exactly that — logged into dev, no indicator, thought it was prod).
   Host-based + FAIL-TOWARD-DEV: only the known prod box is treated as prod; everything else (the dev
   Tailscale host, localhost, file://, previews) shows the banner. This is COMMITTED code (not the
   gitignored bypass) because it's a safety guardrail, not a dev-only convenience — it must show even
   when logging in normally (the bypass-tied banner did not). */
(function () {
  // Production = the deployed Ubuntu box, by Tailscale hostname AND raw IP (served either way).
  var PROD_HOSTS = ["rzy-ubuntu-workstation-1.taila3fda5.ts.net", "100.103.109.41"];
  var host = (typeof location !== "undefined" && location.hostname || "").toLowerCase();
  if (PROD_HOSTS.indexOf(host) >= 0) return;   // confirmed prod → no banner
  function show() {
    if (!document.body || document.getElementById("envbanner")) return;
    var b = document.createElement("div");
    b.id = "envbanner";
    b.textContent = "🟡 DEV — " + (host || "local") + " · not production";
    b.style.cssText = "background:#b26a00;color:#fff;font:700 12px/1.4 system-ui,sans-serif;text-align:center;padding:5px 10px;letter-spacing:.3px";
    document.body.insertBefore(b, document.body.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else show();
})();
