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

// ---- Cap read-progress banner (js/104 "reading" / "read-done") -------------------------------------------------
if (typeof uploadStatus === "function") {
  uploadStatus("reading", { done: 3, total: 12 });
  A(/🤖 Cap is reading 3 of 12/.test(bannerText()), "reading state text wrong: " + bannerText());
  var _rel = document.getElementById("upStatus");
  A(_rel && _rel.className.indexOf("read") >= 0, "reading not the .read (purple) style");
  var _bar = _rel && _rel.querySelector(".upbar > i");
  A(_bar && /(^|\D)25%/.test(_bar.style.width || ""), "reading bar should be 25% (3/12), got " + (_bar && _bar.style.width));
  // full-batch progression drives the bar
  uploadStatus("reading", { done: 12, total: 12 });
  A(/reading 12 of 12/.test(bannerText()), "reading should reach 12 of 12");
  var _bar2 = document.getElementById("upStatus").querySelector(".upbar > i");
  A(_bar2 && /100%/.test(_bar2.style.width || ""), "reading bar should be 100% at 12/12");
  uploadStatus("read-done", 12);
  A(/✓ Cap read 12 receipts/.test(bannerText()), "read-done text wrong: " + bannerText());
  A(document.getElementById("upStatus").className.indexOf("ok") >= 0, "read-done should be green (.ok)");
  uploadStatus("read-done", 1);
  A(/✓ Cap read 1 receipt(?!s)/.test(bannerText()), "read-done singular wrong: " + bannerText());
  uploadStatus("hide");
  diag("uploadStatus reading/read-done (🤖 bar → ✓): OK");
}

// ---- capRcptRun DRIVES the banner across a batch, ends at read-done, 0-unread shows NOTHING --------------------
if (typeof capRcptRun === "function" && typeof capRcptTargets === "function") {
  var _realRead = window.capRcptRead, _realCanRun = window.capRcptCanRun, _realTargets = window.capRcptTargets;
  window.CAP_RCPT_THROTTLE_MS = 0;                 // no wait between reads in the test
  window.capRcptCanRun = function () { return true; };   // owner/admin gate open for the harness
  // 4 fake needs-review receipts; capRcptTargets is stubbed to return only the still-unstamped ones (deterministic)
  var _fake = [];
  for (var i = 0; i < 4; i++) _fake.push({ id: "uptest_" + i, receiptId: "photo_" + i + ".jpg" });
  window.capRcptTargets = function () { return _fake.filter(function (r) { return !r.suggested; }); };
  var _maxSeen = 0, _reads = 0;
  var _origUS = window.uploadStatus;
  window.uploadStatus = function (state, arg) { if (state === "reading" && arg && arg.total > _maxSeen) _maxSeen = arg.total; return _origUS.apply(this, arguments); };
  window.capRcptRead = function () { return Promise.resolve({ suggested: { vendor: "T", amount: 1 } }); };
  var _realFind = window.rcptFindRecord;
  window.rcptFindRecord = function () { return null; };   // stamp lands on the passed record (our _fake entry) → next pass sees it done
  await capRcptRun({ auto: true });
  A(_maxSeen === 4, "banner 'reading' total should have reached 4, saw " + _maxSeen);
  A(/✓ Cap read 4 receipts/.test(bannerText()), "batch drain must end at read-done ✓: " + bannerText());
  diag("capRcptRun drives reading banner 1..4 → ✓ Cap read 4: OK");
  uploadStatus("hide");
  // 0-unread run: all 4 now stamped → capRcptTargets returns [] → banner must NOT show at all (no phantom bar)
  await capRcptRun({ auto: true });
  var _z = document.getElementById("upStatus");
  A(!_z || _z.style.display === "none" || _z.className.indexOf("show") < 0, "0-unread sweep must show NO banner (phantom bar): " + (_z && _z.className));
  diag("capRcptRun 0-unread → no banner (no phantom flash): OK");
  // restore stubs
  window.uploadStatus = _origUS; window.capRcptRead = _realRead; window.capRcptCanRun = _realCanRun; window.capRcptTargets = _realTargets; window.rcptFindRecord = _realFind;
  uploadStatus("hide");
}
