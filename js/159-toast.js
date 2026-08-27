/* ---------- TOAST (js/159) — the confirmation sixteen call sites already thought they had ----------------
   ⚠️ FOUND BY THE PHANTOM-HELPER GUARD, 2026-08-27, while fixing the Plaid "forbidden" bug. `toast()` is
   called in 16 places across 14 modules — every one wrapped in `typeof toast === "function"` — and it was
   DEFINED NOWHERE. So every one of those calls has always evaluated to nothing.

   ⛔ AND SOME OF THEM WERE ERRORS, NOT CONFIRMATIONS. "Could not read that CSV file." · "Couldn't settle —
   the deposit or receipt isn't here anymore." · "Those rows are already imported." · "Nothing selected to
   import." Those are the app telling someone why nothing happened, and none of them ever reached a screen.
   A silent success is an annoyance; a silent failure is the user doing it again, differently, wrong.

   ⭐ THIS IS THE SAME BUG AS THE PLAID ONE, AT SCALE — a helper that sounds like it must exist, guarded by a
   `typeof` that turns its absence into silence rather than a ReferenceError. Defining it is the fix, because
   at all 16 sites the intent is plainly right: say what just happened.

   Mirrors js/104's shape deliberately (single body-level node, injected once, survives render() which only
   replaces #view, never throws — a status line must never blank the app). It sits at the BOTTOM so it can't
   cover the upload/read banner at the top, and clear of the mobile bottom nav. */

(function () {
  var TOAST_MS = 3200;
  var _t = null;

  function mount() {
    try {
      if (typeof document === "undefined" || !document.body) return null;
      var el = document.getElementById("toastBar");
      if (el) return el;
      if (!document.getElementById("toastStyle")) {
        var st = document.createElement("style");
        st.id = "toastStyle";
        st.textContent =
          "#toastBar{position:fixed;left:50%;transform:translateX(-50%) translateY(8px);bottom:96px;z-index:41;" +
          "max-width:calc(100% - 28px);box-sizing:border-box;padding:11px 16px;border-radius:12px;" +
          "font-size:14px;font-weight:600;line-height:1.35;text-align:center;cursor:pointer;" +
          "background:#1f2937;color:#f9fafb;box-shadow:0 8px 24px rgba(16,24,40,.30);" +
          "opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;white-space:normal}" +
          "#toastBar.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}" +
          "#toastBar.bad{background:#7f1d1d;color:#fee2e2}" +
          /* ⚠️ desktop turns the nav into a LEFT sidebar, so there is no bottom bar to clear down there */
          "@media(min-width:900px){#toastBar{bottom:28px}}";
        (document.head || document.body).appendChild(st);
      }
      el = document.createElement("div");
      el.id = "toastBar";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.onclick = function () { hide(); };
      document.body.appendChild(el);
      return el;
    } catch (e) { return null; }
  }

  function hide() {
    try {
      if (_t) { clearTimeout(_t); _t = null; }
      var el = document.getElementById("toastBar");
      if (el) el.className = "";
    } catch (e) {}
  }

  /* toast(message) — or toast(message, "bad") for the ones that are reporting a failure. Never throws. */
  function toast(msg, kind) {
    try {
      var s = String(msg == null ? "" : msg).trim();
      if (!s) return;
      var el = mount(); if (!el) return;
      if (_t) { clearTimeout(_t); _t = null; }
      el.textContent = s;                       // textContent, not innerHTML — these strings carry user data
      el.className = "show" + (kind === "bad" ? " bad" : "");
      /* a failure message gets longer on screen than a tick: he has to read it and decide what to do */
      _t = setTimeout(hide, kind === "bad" ? TOAST_MS + 2600 : TOAST_MS);
    } catch (e) { /* a confirmation must never take the app down */ }
  }

  if (typeof window !== "undefined") { window.toast = toast; window.toastHide = hide; }
  if (typeof module !== "undefined" && module.exports) module.exports = { toast: toast };
})();
