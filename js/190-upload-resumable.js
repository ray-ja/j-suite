/* ---------- RESUMABLE UPLOAD (js/190) — any size, survives a dropped connection ----------
   Ray, 2026-09-23: "it said file too big max 10MB but there should be no limit, it's an internal network
   transfer… a file transfer tool that doesn't fail even if connection is lost."

   /api/upload takes one base64 JSON body (whole file in memory, +33%, 10 MB cap). This is the other path, the
   one the voice recorder uses: the file goes up in numbered 4 MB pieces, each piece is its own request, a
   dropped piece is re-sent (same number overwrites, never duplicates), and the server assembles the pieces on
   `done` into a normal blob under /uploads/<id>.<ext>, so the record keeps the same small id as always.

   RESUME: the upload id and the file's fingerprint (name+size+mtime) are kept in localStorage. Reopen the app,
   pick the same file again, and it asks the server which pieces it already has and sends only the rest.
   OFFLINE: a piece that fails waits for the browser's `online` event (or 15 s) and tries again, up to 12 times
   with backoff, before giving up. Nothing is written to the record until `done` succeeds.
   Pure helpers (piece plan, missing pieces, retry delay) are node-testable: upload-resumable-tests.js. */
var UPR_CHUNK = 4 * 1024 * 1024;
var UPR_TRIES = 12;
function uprPlan(size, chunk) { chunk = chunk || UPR_CHUNK; var n = Math.max(1, Math.ceil((+size || 0) / chunk)); var out = []; for (var i = 0; i < n; i++) out.push({ n: i, start: i * chunk, end: Math.min(+size || 0, (i + 1) * chunk) }); return out; }
function uprMissing(total, received) { var have = {}; (received || []).forEach(function (n) { have[+n] = 1; }); var out = []; for (var i = 0; i < total; i++) if (!have[i]) out.push(i); return out; }
function uprDelay(attempt) { return Math.min(15000, 800 * Math.pow(1.7, Math.max(0, attempt))); }
function uprKey(file) { return "jra_up_" + String((file && file.name) || "") + "|" + ((file && file.size) || 0) + "|" + ((file && file.lastModified) || 0); }
if (typeof window !== "undefined") {
  function uprBase() { return ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, ""); }
  function uprHdr() { return { "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") }; }
  function uprWaitOnline(ms) {
    return new Promise(function (done) {
      if (navigator.onLine !== false) return setTimeout(done, ms);
      var t = setTimeout(fin, ms); function fin() { clearTimeout(t); window.removeEventListener("online", fin); done(); }
      window.addEventListener("online", fin);
    });
  }
  async function uprJson(url, opts) { var r = await fetch(url, opts); var j = null; try { j = await r.json(); } catch (e) {} if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status)); return j || {}; }
  /* upload `file` → resolves the blob id. onProgress(pct, label) optional. */
  window.jsUploadResumable = async function (file, onProgress) {
    onProgress = (typeof onProgress === "function") ? onProgress : function () {};
    if (!file || !file.size) throw new Error("empty file");
    var key = uprKey(file), base = uprBase(), plan = uprPlan(file.size), id = null, received = [];
    /* resume if we were part-way through this exact file */
    try { var prev = JSON.parse(localStorage.getItem(key) || "null"); if (prev && prev.id) { var st = await uprJson(base + "/api/files/status?id=" + encodeURIComponent(prev.id), { headers: uprHdr() }); if (st && st.ok) { id = prev.id; received = st.received || []; } } } catch (e) { id = null; }
    if (!id) {
      var init = await uprJson(base + "/api/files/init", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, uprHdr()), body: JSON.stringify({ name: file.name, size: file.size, type: file.type || "", chunk: UPR_CHUNK }) });
      id = init.id; received = [];
      try { localStorage.setItem(key, JSON.stringify({ id: id, ts: Date.now() })); } catch (e) {}
    }
    var todo = uprMissing(plan.length, received);
    var done = plan.length - todo.length;
    onProgress(Math.round(done / plan.length * 100), done ? ("resuming, " + done + " of " + plan.length + " pieces already there") : "starting");
    for (var k = 0; k < todo.length; k++) {
      var piece = plan[todo[k]]; var ok = false, lastErr = "";
      for (var attempt = 0; attempt < UPR_TRIES && !ok; attempt++) {
        if (attempt) { onProgress(Math.round(done / plan.length * 100), "piece " + (piece.n + 1) + " of " + plan.length + ", retry " + attempt); await uprWaitOnline(uprDelay(attempt)); }
        try {
          var cr = await fetch(base + "/api/files/chunk?id=" + encodeURIComponent(id) + "&n=" + piece.n, { method: "POST", headers: Object.assign({ "Content-Type": "application/octet-stream" }, uprHdr()), body: file.slice(piece.start, piece.end) });
          ok = cr.ok; if (!ok) { try { lastErr = (await cr.json()).error || ("HTTP " + cr.status); } catch (e) { lastErr = "HTTP " + cr.status; } if (cr.status === 404) break; }
        } catch (e) { lastErr = (e && e.message) || "network"; }
      }
      if (!ok) throw new Error("stalled on piece " + (piece.n + 1) + " of " + plan.length + (lastErr ? " (" + lastErr + ")" : "") + ". Pick the same file again to resume.");
      done++; onProgress(Math.round(done / plan.length * 100), "piece " + done + " of " + plan.length);
    }
    onProgress(99, "finishing");
    var fin = await uprJson(base + "/api/files/done?id=" + encodeURIComponent(id), { method: "POST", headers: uprHdr() });
    if (!fin.ok || !fin.blobId) throw new Error(fin.error || "could not finalise");
    try { localStorage.removeItem(key); } catch (e) {}
    onProgress(100, "done");
    return fin.blobId;
  };
  window.uprPlan = uprPlan; window.uprMissing = uprMissing;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { uprPlan: uprPlan, uprMissing: uprMissing, uprDelay: uprDelay, uprKey: uprKey, UPR_CHUNK: UPR_CHUNK }; }
