/* ---------- BANK FEED BANNER (js/202) ------------------------------------------------------------------
   Ray, 2026-10-14: "the feed stopped? i should get an alert / warning banner for that. your numbers may be
   wrong then." Navy Federal had wanted a fresh sign-in since 2026-09-08; the cron pull logged it three times
   a day to a file, the bank card said "last checked" in small grey text, and every balance on seven accounts
   quietly went five weeks stale.

   WHAT: a red bar across the top of the app (same slot as the odometer bar, js/85) whenever the server's
   /api/plaid/status lists a problem for the current org — a bank that needs a sign-in, a pull that failed,
   or a connection that has simply gone quiet for two days. Tap = Reconnect (Plaid update mode, js/150).
   WHEN: checked on first paint and then at most every 10 minutes per org; the server answer is cached in
   BANK_STATUS, which the bank card reads too, so both say the same thing.
   Owner only by construction (the status route is owner-gated; a 403 just means no banner). Fails open. */
(function () {
  var AGE_MS = 10 * 60 * 1000;
  var lastOrg = "", lastAt = 0, inflight = false;

  function problems() {
    try { return (typeof BANK_STATUS !== "undefined" && BANK_STATUS && BANK_STATUS.problems) || []; } catch (e) { return []; }
  }
  function text(p) {
    var since = p.since ? new Date(p.since).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    return "⚠️ Bank feed stopped: " + p.label + " (" + p.accounts + (p.accounts === 1 ? " account" : " accounts") + ") "
      + p.reason + (since ? ", last update " + since : "") + " — tap to reconnect";
  }
  function paint() {
    if (typeof document === "undefined" || !document.body) return;
    var ps = problems(), bar = document.getElementById("bankbanner");
    var signedOut = document.body.classList.contains("signedout");
    if (!ps.length || signedOut) {
      if (bar) bar.remove();
      document.body.classList.remove("has-bank-banner");
      return;
    }
    var p = ps[0];
    if (!bar) {
      bar = document.createElement("button");
      bar.id = "bankbanner"; bar.type = "button";
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.onclick = function () { if (typeof bankConnect === "function") bankConnect(p.itemId); };
    bar.textContent = text(p) + (ps.length > 1 ? " (+" + (ps.length - 1) + " more)" : "");
    document.body.classList.add("has-bank-banner");
  }
  function refresh() {
    try {
      var org = (typeof S !== "undefined" && S && S.biz) || "";
      if (!org || inflight) return;
      if (typeof bankRefresh !== "function" || typeof S === "undefined" || !S.sync || !S.sync.token) return;
      var now = Date.now();
      if (org === lastOrg && now - lastAt < AGE_MS) return;
      inflight = true; lastOrg = org; lastAt = now;
      bankRefresh(function () { inflight = false; paint(); });
    } catch (e) { inflight = false; }
  }
  function renderBankBanner() { try { paint(); refresh(); } catch (e) {} }
  window.renderBankBanner = renderBankBanner;
  window.bankBannerProblems = problems;

  /* after every render, like the odometer bar — wrap rather than edit js/03 */
  if (typeof render === "function") {
    var _r0 = render;
    render = function () { var r = _r0.apply(this, arguments); renderBankBanner(); return r; };
    window.render = render;
  }
  if (typeof document !== "undefined") {
    if (document.readyState !== "loading") setTimeout(renderBankBanner, 0);
    else document.addEventListener("DOMContentLoaded", renderBankBanner);
  }
})();
