/* UPLOAD-STATUS DOM SMOKE — the "safe to close" sync-completion indicator.
 *
 * Run headless in the real app:  node verify-app.js "$(cat upload-status-tests.js)"
 *
 * Proves:
 *  1. uploadStatus(state,pct) renders a fixed banner for each stage: ⬆ Uploading X% → 💾 Saving… → ✓ safe to
 *     close / ⏳ keep the app open / ⚠ error, and hides on demand.
 *  2. uploadProgressCb() drives the ⬆ % (+ batch note).
 *  3. whenSynced() with NO sync configured (file:// / offline) resolves "pending" — never a crash, never a false ✓.
 *  4. uploadTrackSync ties the FINAL state to the RECORD's sync push: whenSynced→"synced" ⇒ "✓ safe to close";
 *     whenSynced→"pending" ⇒ "⏳ keep the app open" (a failed/offline push NEVER shows ✓).
 *  5. A full flow through rcptUploadFiles (stubbed jsUpload + push): a review RECORD is created, jsUpload receives
 *     an onProgress callback, and the banner ends at ✓ only after the (stubbed) push succeeds.  */

function A(c, m) { if (!c) __errs.push("upload-status: " + m); }
function bannerText() { var e = document.getElementById("upStatus"); return (e && e.textContent) || ""; }

A(typeof uploadStatus === "function", "uploadStatus() missing");
A(typeof uploadProgressCb === "function", "uploadProgressCb() missing");
A(typeof uploadTrackSync === "function", "uploadTrackSync() missing");
A(typeof whenSynced === "function", "whenSynced() missing (js/26)");

if (typeof uploadStatus === "function") {
  uploadStatus("uploading", 45);
  var el = document.getElementById("upStatus");
  A(!!el, "banner node not mounted");
  A(/Uploading photo… 45%/.test(bannerText()), "uploading 45% not shown: " + bannerText());
  A(el && /(^|\s)show(\s|$)/.test(el.className), "banner not visible (no .show)");
  uploadStatus("saving");
  A(/Saving…/.test(bannerText()), "saving not shown");
  uploadStatus("saved");
  A(/safe to close/.test(bannerText()), "✓ safe-to-close not shown");
  A(document.getElementById("upStatus").className.indexOf("ok") >= 0, "saved not the green (.ok) style");
  uploadStatus("pending");
  A(/Keep the app open/.test(bannerText()), "⏳ keep-the-app-open not shown");
  uploadStatus("error", null, "boom");
  A(/didn't finish/.test(bannerText()), "error state not shown");
  uploadStatus("hide");
  A(document.getElementById("upStatus").style.display === "none", "banner not hidden");
  diag("uploadStatus states (⬆%→💾→✓/⏳/⚠→hide): OK");
}

if (typeof uploadProgressCb === "function") {
  uploadProgressCb("(1 of 2)")(30);
  A(/Uploading photo… 30%/.test(bannerText()), "progress cb % wrong");
  A(/1 of 2/.test(bannerText()), "progress cb batch note missing");
  uploadStatus("hide");
  diag("uploadProgressCb: OK");
}

// file:// / offline degrade — no sync configured here → "pending", never a crash or a false ✓
if (typeof whenSynced === "function") {
  var rOff = await whenSynced(800);
  A(rOff === "pending", "whenSynced with no server should be 'pending', got " + rOff);
  diag("whenSynced offline → pending (file://-safe): OK");
}

// uploadTrackSync ties the ✓ strictly to the push result
var _realWS = window.whenSynced;
window.whenSynced = function () { return Promise.resolve("synced"); };
await uploadTrackSync();
A(/safe to close/.test(bannerText()), "trackSync(synced) must show ✓ safe-to-close");
diag("uploadTrackSync push-synced → ✓ safe-to-close: OK");

window.whenSynced = function () { return Promise.resolve("pending"); };
await uploadTrackSync();
A(/Keep the app open/.test(bannerText()), "trackSync(pending) must show ⏳ keep-the-app-open (NOT ✓)");
A(!/safe to close/.test(bannerText()), "a failed/offline push must NOT show ✓ safe-to-close");
diag("uploadTrackSync push-pending → ⏳ keep-open (no false ✓): OK");

// full flow: stub jsUpload + a successful push → a RECORD is created AND the banner ends at ✓
var _realUp = window.jsUpload, _gotProg = false;
window.jsUpload = function (f, cb) { if (typeof cb === "function") { cb(20); cb(100); _gotProg = true; } return Promise.resolve("blob_test_" + Math.random().toString(36).slice(2)); };
window.whenSynced = function () { return Promise.resolve("synced"); };
if (typeof rcptColl === "function" && typeof rcptUploadFiles === "function") {
  var before = rcptColl().length;
  rcptUploadFiles([{ name: "receipt.jpg", type: "image/jpeg" }]);
  await new Promise(function (res) { setTimeout(res, 350); });
  A(rcptColl().length === before + 1, "rcptUploadFiles must create exactly 1 review record");
  A(_gotProg, "jsUpload must receive an onProgress callback from the flow");
  A(/safe to close/.test(bannerText()), "the upload FLOW must end at ✓ safe-to-close (record synced): " + bannerText());
  diag("rcptUploadFiles flow → 1 record + ✓ safe-to-close: OK");
}
window.jsUpload = _realUp;
window.whenSynced = _realWS;
uploadStatus("hide");
