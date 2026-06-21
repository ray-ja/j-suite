
"use strict";
/* ---------- EARLY ENV FLAGS (host-based, single source of truth) ----------
   Runs before every feature module, so flags are set before modules read them at load
   (e.g. js/47 evaluates MSG_ENABLED from window.DEV_MESSAGING at parse time). Host-based +
   FAIL-TOWARD-DEV: only the known prod box counts as prod; everything else is dev. js/55 (banner)
   and js/56 (auto-login) reuse window.jsIsDevHost so "dev or prod?" is decided in exactly one place. */
(function () {
  var PROD_HOSTS = ["app.jsuite.dev", "rzy-ubuntu-workstation-1.taila3fda5.ts.net", "100.103.109.41"];
  var host = (typeof location !== "undefined" && location.hostname || "").toLowerCase();
  window.JSUITE_IS_PROD_HOST = PROD_HOSTS.indexOf(host) >= 0;
  window.jsIsDevHost = function () { return !window.JSUITE_IS_PROD_HOST; };
  // DEV hosts: turn crew messaging ON in the UI (prod uses server-injected window.JSUITE_MESSAGING).
  if (!window.JSUITE_IS_PROD_HOST && typeof window.DEV_MESSAGING === "undefined") window.DEV_MESSAGING = true;
})();
