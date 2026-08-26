/* ============================== UPLOAD STATUS — "safe to close" sync-completion banner ==============================
   THE INCIDENT this fixes: a photo/receipt upload has TWO stages —
     (1) the blob POSTs to the server immediately (jsUpload),
     (2) the RECORD that references that blob rides the periodic sync PUSH.
   A crew member closed the app AFTER (1) but BEFORE (2) → the photo sat on the server orphaned, no record, invisible
   (7 of Chase's receipts, gone). This banner narrates the whole sequence and only ever shows "✓ safe to close" once
   the RECORD has actually SYNCED to the server (whenSynced() in js/26 watches the existing push) — never merely after
   the blob uploaded. If offline/pending it stays on the ⏳ "keep the app open" warning until it truly syncs.

   UX only: no data/schema/finance/sync-protocol change. The banner is a single body-level node injected ONCE (it
   survives render(), which only replaces #view), file://-safe, and never throws (a status line must never blank the
   app). States: "uploading" (⬆ %) → "saving" (💾) → "saved" (✓, auto-dismiss) / "pending" (⏳, persistent) — or
   "error" (⚠). */

(function () {
  var AUTO_MS = 5000;         // how long the ✓ / ⚠ toast lingers before auto-dismiss
  var _dismissT = null;

  /* ---------- ⏱ WATCHDOG ON THE PROGRESS STATES — the last line of defence -------------------------------
     Ray, 2026-08-26: "i see cap is reading 1 of 1, its been there a long time i think its bugged."
     ⬆/🤖 are the only two states with no self-expiry, by design: they end when the caller says they end. That
     is correct right up until the caller never says anything again — and then this banner, which exists to tell
     him what is safe to close, is the thing lying to him on every page.

     The real causes are fixed upstream (sync-server aiSend's socket deadline · orgAiFetch's abort · js/88's
     finally). This is the backstop for the NEXT one: a progress state that has not been re-asserted in
     WATCHDOG_MS stops claiming to be progress. Every uploadStatus() call re-arms it, so a live drain — which
     re-asserts before every read, including the slow escalate retry — never trips it.
     ⚠️ The window is deliberately wider than the longest legitimate silence (one 150s client read deadline),
     so this can only fire on something genuinely stuck, never on slow-but-working. */
  var WATCHDOG_MS = 240000;
  var _watchT = null;
  function armWatch(state) {
    if (_watchT) { clearTimeout(_watchT); _watchT = null; }
    if (state !== "uploading" && state !== "reading") return;   // terminal states have their own auto-dismiss
    _watchT = setTimeout(function () {
      /* honest, dismissible, and it disappears on its own — never a silent hide, which would just move the
         confusion from "why is it stuck" to "where did my upload go" */
      uploadStatus("error", null, "that stalled — nothing was lost, it'll try again");
    }, WATCHDOG_MS);
  }

  function mount() {
    try {
      if (typeof document === "undefined" || !document.body) return null;
      var el = document.getElementById("upStatus");
      if (el) return el;
      if (!document.getElementById("upStatusStyle")) {
        var st = document.createElement("style");
        st.id = "upStatusStyle";
        st.textContent =
          "#upStatus{position:fixed;left:50%;transform:translateX(-50%);top:10px;z-index:39;max-width:calc(100% - 24px);" +
          "box-sizing:border-box;padding:10px 16px;border-radius:12px;font-size:14px;font-weight:600;line-height:1.35;" +
          "text-align:center;box-shadow:0 6px 20px rgba(16,24,40,.22);display:none;pointer-events:auto;cursor:default;" +
          "border:1px solid rgba(0,0,0,.06)}" +
          "#upStatus.show{display:block}" +
          "#upStatus.up{background:#eef2ff;color:#3538cd;border-color:#c7d2fe}" +
          "#upStatus.read{background:#f5f3ff;color:#6b21a8;border-color:#ddd6fe}" +
          "#upStatus.read .upbar{background:rgba(124,58,237,.18)}" +
          "#upStatus.read .upbar > i{background:#7c3aed}" +
          "#upStatus.save{background:#fef3c7;color:#92400e;border-color:#fde68a}" +
          "#upStatus.ok{background:#dcfce7;color:#166534;border-color:#bbf7d0;cursor:pointer}" +
          "#upStatus.warn{background:#fef3c7;color:#92400e;border-color:#fcd34d;cursor:pointer}" +
          "#upStatus.err{background:#fee2e2;color:#991b1b;border-color:#fecaca;cursor:pointer}" +
          "#upStatus .upbar{height:4px;border-radius:2px;background:rgba(53,56,205,.18);margin-top:7px;overflow:hidden}" +
          "#upStatus .upbar > i{display:block;height:100%;background:#4f46e5;width:0;transition:width .2s ease}" +
          "body.dark #upStatus{border-color:rgba(255,255,255,.08)}";
        (document.head || document.body).appendChild(st);
      }
      el = document.createElement("div");
      el.id = "upStatus";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.onclick = function () { hide(); };   // tap the ✓/⏳/⚠ to dismiss it
      document.body.appendChild(el);
      return el;
    } catch (e) { return null; }
  }

  function hide() {
    try { if (_watchT) { clearTimeout(_watchT); _watchT = null; } } catch (e) {}
    try { if (_dismissT) { clearTimeout(_dismissT); _dismissT = null; } var el = document.getElementById("upStatus"); if (el) { el.className = ""; el.style.display = "none"; el.innerHTML = ""; } } catch (e) {}
  }

  /* state: "uploading" (arg=pct number) | "reading" (arg={done,total}) | "read-done" (arg=count) | "saving" |
     "saved" | "pending" | "error" | falsy/"hide".
     note: optional small text appended (e.g. batch "(2 of 3)" or an error message). */
  function uploadStatus(state, arg, note) {
    try {
      if (!state || state === "hide") { hide(); return; }
      var el = mount(); if (!el) return;
      if (_dismissT) { clearTimeout(_dismissT); _dismissT = null; }
      var suffix = note ? (" <span style='opacity:.75;font-weight:500'>" + escUp(note) + "</span>") : "";
      var cls = "", html = "", auto = 0;
      if (state === "uploading") {
        var pct = (typeof arg === "number" && isFinite(arg)) ? Math.max(0, Math.min(100, Math.round(arg))) : 0;
        cls = "up";
        html = "⬆ Uploading photo… " + pct + "%" + suffix + "<div class='upbar'><i style='width:" + pct + "%'></i></div>";
      } else if (state === "reading") {
        // Cap draining the receipt read-queue → 🤖 progress bar filled to done/total (a distinct purple accent).
        var d = (arg && typeof arg === "object") ? arg : {};
        var rt = (typeof d.total === "number" && isFinite(d.total) && d.total > 0) ? Math.round(d.total) : 0;
        var rd = (typeof d.done === "number" && isFinite(d.done) && d.done >= 0) ? Math.round(d.done) : 0;
        if (rt && rd > rt) rd = rt;
        var rpct = rt ? Math.max(0, Math.min(100, Math.round((rd / rt) * 100))) : 0;
        cls = "read";
        html = "🤖 Cap is reading " + rd + " of " + (rt || "?") + "…" + suffix +
               "<div class='upbar'><i style='width:" + rpct + "%'></i></div>";
      } else if (state === "read-done") {
        var rn = (typeof arg === "number" && isFinite(arg)) ? Math.max(0, Math.round(arg)) : 0;
        cls = "ok"; html = "✓ Cap read " + rn + " receipt" + (rn === 1 ? "" : "s") + suffix; auto = AUTO_MS;
      } else if (state === "saving") {
        cls = "save"; html = "💾 Saving…" + suffix;
      } else if (state === "saved") {
        cls = "ok"; html = "✓ Saved to the cloud — safe to close" + suffix; auto = AUTO_MS;
      } else if (state === "pending") {
        cls = "warn"; html = "⏳ Saved on this device — will sync when you're back online. Keep the app open until you see ✓." + suffix;
      } else if (state === "error") {
        cls = "err"; html = "⚠ Upload didn't finish" + (note ? " — " + escUp(note) : " — try again") + "."; auto = AUTO_MS + 3000;
      } else { hide(); return; }
      el.className = cls + " show";
      el.innerHTML = html;
      if (auto) _dismissT = setTimeout(hide, auto);
      armWatch(state);          // ⏱ re-armed by every call; only an ABANDONED progress state ever trips it
    } catch (e) {}
  }

  function escUp(s) { try { return (typeof esc === "function") ? esc(s) : String(s == null ? "" : s); } catch (e) { return ""; } }

  /* a fresh onProgress callback to hand jsUpload(file, cb) → drives the ⬆ % bar. `note` prints alongside (batches). */
  function uploadProgressCb(note) { return function (pct) { uploadStatus("uploading", pct, note); }; }

  /* Call AFTER an upload flow has created its record + save()'d. Shows 💾 Saving…, then ties the FINAL "✓ safe to
     close" to the RECORD's sync PUSH (whenSynced in js/26) — resolves "saved" only once the record reached the
     server; "pending" if offline/stalled (⏳ keep the app open). Returns the promise so callers can chain. */
  function uploadTrackSync(note) {
    uploadStatus("saving", null, note);
    var p = (typeof whenSynced === "function") ? whenSynced() : Promise.resolve("pending");
    return p.then(function (r) {
      uploadStatus(r === "synced" ? "saved" : "pending", null, note);
      return r;
    }).catch(function () { uploadStatus("pending", null, note); return "pending"; });
  }

  if (typeof window !== "undefined") {
    window.uploadStatus = uploadStatus;
    window.uploadStatusHide = hide;
    window.uploadProgressCb = uploadProgressCb;
    window.uploadTrackSync = uploadTrackSync;
    window.uploadStatusMount = mount;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { uploadStatus: uploadStatus, uploadProgressCb: uploadProgressCb, uploadTrackSync: uploadTrackSync };
})();
