/* ---------- auto-update: pick up new deployments on running/installed PWAs ----------
   The SW is network-first, so a fresh navigation already gets new code. But an installed PWA
   (esp. an iOS home-screen install) that's resumed from the background never re-navigates — it
   keeps running yesterday's page and never sees new orgs/features. This polls the live build and
   nudges a refresh when prod has moved ahead of the page we're running.

   The server stamps the page it served with window.__BUILD and exposes GET /api/version → {build}.
   /api/version is under /api/ so the SW bypasses it → always the real current build. If they differ,
   a newer deploy is live. We also reload-guard: only auto-reload when it's clearly safe (nothing
   typed/open/syncing); otherwise show a tap-to-refresh banner so we never yank the page out from
   under someone mid-edit. Everything is guarded — no __BUILD, offline, or a failed fetch → do nothing. */
(function () {
  var MINE = (typeof window !== "undefined") ? window.__BUILD : null;
  if (!MINE) return;   // file:// or an un-stamped load → nothing to compare against; stay quiet

  var INTERVAL = 4 * 60 * 1000;   // ~4 min background poll
  var shown = false;              // banner is up — don't stack another
  var reloading = false;          // a reload is committed — don't double-fire
  var lastCheck = 0;              // throttle the focus/visibility bursts

  /* safe to reload WITHOUT asking? no focused/edited input, no open modal, not mid-sync. */
  function safeToAutoReload() {
    try {
      var ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return false;
      if (typeof WZON !== "undefined" && WZON) return false;                    // the QUOTE WIZARD is open — a reload nukes the whole in-progress quote (even between field taps). Banner instead.
      var ov = document.getElementById("overlay");
      if (ov && ov.classList && ov.classList.contains("show")) return false;   // the app's modal
      if (typeof SYNC_DIRTY !== "undefined" && SYNC_DIRTY) return false;        // unflushed local changes
      if (typeof _syncInflight !== "undefined" && _syncInflight) return false;  // mid round-trip
      if (typeof SYNC_STATE !== "undefined" && SYNC_STATE === "syncing") return false;
    } catch (e) { return false; }
    return true;
  }

  /* The hard part: a plain location.reload() re-serves the stale cache if the device is stuck on an old/
     cache-first service worker (which never updates itself on a resumed PWA). So before reloading we do the
     automatic equivalent of "clear site data": purge ALL caches AND unregister the service worker. The reload
     then hits the network with no SW interference → genuinely fresh code; js/29-boot re-registers the current
     SW. Loop-guarded via sessionStorage so a stubborn case shows the banner instead of reloading forever. */
  function doReload() {
    if (reloading) return;
    try {
      var last = +sessionStorage.getItem("jra_upd_reload") || 0;
      if (Date.now() - last < 20000) { banner(); return; }   // already tried very recently → don't loop; let the user tap
      sessionStorage.setItem("jra_upd_reload", String(Date.now()));
    } catch (e) {}
    reloading = true;
    var go = function () { try { location.reload(); } catch (e) { reloading = false; } };
    var steps = [];
    try { if (window.caches && caches.keys) steps.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) steps.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    if (steps.length) Promise.all(steps).then(go).catch(go); else go();
    setTimeout(go, 2000);   // hard fallback if the cache/SW ops hang
  }

  function banner() {
    if (shown || reloading) return;
    shown = true;
    var b = document.createElement("div");
    b.id = "updateBanner";
    b.setAttribute("role", "button");
    b.textContent = "🔄 New version available — tap to update";
    b.style.cssText = [
      "position:fixed", "left:12px", "right:12px",
      "bottom:calc(12px + env(safe-area-inset-bottom,0px))",
      "z-index:99999", "margin:0 auto", "max-width:480px",
      "padding:12px 16px", "border-radius:12px",
      "background:#1B2A4E", "color:#fff",
      "font:600 15px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "text-align:center", "cursor:pointer",
      "box-shadow:0 6px 24px rgba(0,0,0,.35)",
      "-webkit-tap-highlight-color:transparent"
    ].join(";");
    b.addEventListener("click", doReload);
    document.body.appendChild(b);
  }

  function check(allowAuto) {
    if (reloading) return;
    var now = Date.now();
    if (now - lastCheck < 4000) return;   // collapse focus+visibility firing together
    lastCheck = now;

    /* also let the SW notice the new build + purge the stale cache */
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (r) { if (r) try { var p = r.update(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }).catch(function () {});
      }
    } catch (e) {}

    var ctrl, to;
    try { ctrl = new AbortController(); to = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 6000); } catch (e) { ctrl = null; }
    fetch("/api/version", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (to) clearTimeout(to); return (r && r.ok) ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.build) return;                 // bad/missing response → ignore
        if (String(data.build) === String(MINE)) return;  // same build → nothing to do
        /* a newer deploy is live. Only the initial ON-LOAD check may auto-reload (self-heals a stale-cache load
           BEFORE any work). Every later trigger — focus / visibility / the interval — is BANNER-ONLY, so a deploy
           mid-session never yanks the page out from under someone who's typing/uploading. (Repeated deploys during
           a work session were re-arming the reload even between field taps; banner-only removes that entirely.) */
        if (allowAuto && safeToAutoReload()) doReload();
        else banner();
      })
      .catch(function () { /* offline / aborted / network blip → silently do nothing */ });
  }

  if (typeof window !== "undefined") {
    window.addEventListener("focus", function () { check(false); });                                  // banner-only
    document.addEventListener("visibilitychange", function () { if (!document.hidden) check(false); }); // banner-only
    setInterval(function () { check(false); }, INTERVAL);                                               // banner-only
    setTimeout(function () { check(false); }, 2500);   // FULLY BANNER-ONLY now: never auto-reload (not even on load) — it kept yanking the page mid-typing (admin PIN, address fields) because deploys land within 2.5s of a load. The user taps the banner when THEY choose.
  }
})();
