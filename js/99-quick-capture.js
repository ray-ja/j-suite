/* ============================== RECEIPT-SMOOTHING PHASE D — floating 📸 quick-capture ==============================
   A persistent, app-wide 📸 button (reachable from EVERY page) so the crew can snap a receipt at the register in one
   tap → straight into rcptUploadFiles (js/72), which already gives Phase-A smart-defaults + review + Phase-B auto-read
   + one-tap file. Client-only: no data/finance/sync change (every path still ends in the existing rcptApplyEdit).

   Boot-once, idempotent: the FAB + hidden file input + styles are injected into <body> ONE time (not per-render), so
   it survives every route change (render() only replaces #view). Visibility:
     • signed out  → hidden via `body.signedout #capFab` (render() toggles that class every render — automatic).
     • quote wizard→ hidden via `body.wizon #capFab` (matches the existing "+" .fab).
     • no server   → hidden (raw file:// with no S.sync.url can't upload) via the `capfab-off` class (JS-applied).
   PLACEMENT (non-overlap): the existing per-page "+" .fab lives bottom-RIGHT (right:16px/34px). To never cover it,
   this 📸 sits bottom-LEFT on phones (left:16px, same bottom:84px, clear of the bottom nav). On ≥900px desktop the
   nav becomes a LEFT sidebar, so bottom-left would collide with it — there it moves to the right and STACKS above the
   "+" fab (right:34px, bottom:106px = above the 60px "+" at bottom:34px). z-index 26 = above content, below the modal
   overlay (40) and the bottom nav (30), matching the "+" fab (25). */

function capFabMount() {
  try {
    if (typeof document === "undefined" || !document.body) return;
    if (document.getElementById("capFab")) { capFabApply(); return; }   // idempotent — never inject twice

    var style = document.createElement("style");
    style.id = "capFabStyle";
    style.textContent =
      "#capFab{position:fixed;left:16px;right:auto;bottom:84px;width:56px;height:56px;border-radius:50%;" +
      "background:var(--card,#fff);color:inherit;border:1px solid var(--line,#ddd);font-size:26px;line-height:1;" +
      "box-shadow:var(--sh-lg,0 6px 20px rgba(16,24,40,.18));z-index:26;display:flex;align-items:center;" +
      "justify-content:center;cursor:pointer;padding:0;transition:transform .1s,filter .15s}" +
      "#capFab:active{transform:scale(.94)}#capFab:hover{filter:brightness(1.06)}" +
      "body.signedout #capFab,body.wizon #capFab,#capFab.capfab-off{display:none!important}" +
      "@media(min-width:900px){#capFab{left:auto;right:34px;bottom:106px}}";
    document.head ? document.head.appendChild(style) : document.body.appendChild(style);

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

    var btn = document.createElement("button");
    btn.id = "capFab"; btn.type = "button";
    btn.title = "Snap a receipt"; btn.setAttribute("aria-label", "Snap a receipt");
    btn.textContent = "📸";
    btn.onclick = capQuickCapture;

    document.body.appendChild(input);
    document.body.appendChild(btn);
    capFabApply();
  } catch (e) { /* never throw — a capture button must never blank the app */ }
}

/* open the camera/file picker (shared by the FAB + the Today "Snap a receipt" button) */
function capQuickCapture() {
  try { var el = document.getElementById("capFabInput"); if (el) el.click(); } catch (e) {}
}

/* server gate: hide when there's no live server to upload to (raw file:// / no sync url). Signed-out + wizard are
   handled by CSS body classes, so this only toggles the no-server case. Cheap + idempotent; safe to call often. */
function capFabApply() {
  try {
    var btn = document.getElementById("capFab"); if (!btn) return;
    var live = !!(typeof S !== "undefined" && S && S.sync && S.sync.url);
    btn.classList.toggle("capfab-off", !live);
  } catch (e) {}
}

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
