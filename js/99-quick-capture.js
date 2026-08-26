/* ============================== QUICK RECEIPT CAPTURE — the picker, not a floating button ==============================
   One tap from the register to rcptUploadFiles (js/72), which already gives smart-defaults + review + auto-read
   + one-tap file. Client-only: no data/finance/sync change (every path still ends in rcptApplyEdit).

   ⛔ THE FLOATING 📸 IS GONE. Ray, 2026-08-26: "theres also floating buttons in the bottom right for adding
   receipts and new leads, we dont need those. we have places for those now." He is right that they are now
   duplicates: Today carries a full-width "📸 Snap a receipt" button (js/05), and Receipts is its own screen
   under Money. Two circular buttons stacked in the corner of a 1440px screen were paying rent on nothing.

   ⚠️ WHAT STAYS IS THE PART THAT ACTUALLY WORKS: capQuickCapture() opens the camera/file picker and
   capCaptureReady() reports whether an upload can even reach a server. Both are called by Today and the job
   page. Deleting the button is not the same as deleting the capability — the hidden <input> is still mounted
   once at boot, because that is what capQuickCapture() clicks. */

function capFabMount() {
  try {
    if (typeof document === "undefined" || !document.body) return;
    if (document.getElementById("capFabInput")) return;   // idempotent — never inject twice

    // hidden camera/file picker — capture="environment" is a mobile hint (desktop ignores it → normal file picker)
    var input = document.createElement("input");
    input.type = "file"; input.id = "capFabInput";
    input.accept = "image/*"; input.setAttribute("capture", "environment"); input.multiple = true;
    input.style.display = "none";
    input.onchange = function () {
      var files = (this.files && this.files.length) ? Array.prototype.slice.call(this.files) : [];
      this.value = "";   // clear so the same batch can't re-fire on a second tap
      if (files.length && typeof rcptUploadFiles === "function") rcptUploadFiles(files);
    };
    document.body.appendChild(input);

    /* ⭐ AND REMOVE THE OLD BUTTON FROM A DEVICE THAT ALREADY HAS ONE. The FAB was injected into <body>, which
       survives render() — so a phone with the app still open from before this change would keep showing it
       until a hard reload. Clean it up on boot rather than waiting for one. */
    ["capFab", "capFabStyle"].forEach(function (id) {
      var el = document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  } catch (e) { /* never throw — a capture helper must never blank the app */ }
}

/* open the camera/file picker (shared by the FAB + the Today "Snap a receipt" button) */
function capQuickCapture() {
  try { var el = document.getElementById("capFabInput"); if (el) el.click(); } catch (e) {}
}

/* kept as a no-op so the boot/focus/online listeners below and any older caller stay valid — the thing it used
   to gate (the floating button) is gone, and capCaptureReady() is now the only server check that matters. */
function capFabApply() {}

/* true when the quick-capture button/entry should be available (signed in + a live server). Used by js/05 Today to
   decide whether to render the "📸 Snap a receipt" button (else it'd offer an upload that can't connect). */
function capCaptureReady() {
  try {
    var live = !!(typeof S !== "undefined" && S && S.sync && S.sync.url);
    var out = (typeof needLogin === "function") ? needLogin() : false;
    return live && !out;
  } catch (e) { return false; }
}

if (typeof window !== "undefined") {
  window.capFabMount = capFabMount;
  window.capQuickCapture = capQuickCapture;
  window.capFabApply = capFabApply;
  window.capCaptureReady = capCaptureReady;
  // Boot-once: defer past js/29-boot's synchronous top-level (load()/setBiz/sync-url) so S.sync.url + sign-in are
  // resolved before we mount + gate. Re-apply the server gate on focus/online in case sync config appears later.
  setTimeout(capFabMount, 0);
  window.addEventListener("focus", capFabApply);
  window.addEventListener("online", capFabApply);
}

if (typeof module !== "undefined" && module.exports) module.exports = { capFabMount: capFabMount, capQuickCapture: capQuickCapture, capFabApply: capFabApply, capCaptureReady: capCaptureReady };
