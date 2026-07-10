/* ---------- CLIENT ERROR LOG ----------
   Captures runtime JS errors (window.onerror + unhandledrejection) into a local ring buffer AND posts each one to
   the sync server (/api/clientlog → client-errors.log) so the owner (and whoever's building) can SEE errors that
   happen in the field instead of guessing. Fire-and-forget, deduped, never throws, never blocks the app. Ignores
   3rd-party/map noise (leaflet/unpkg/nominatim/tiles). Viewer: window.showErrorLog() (also on the Data page). */
(function () {
  const KEY = "jsuite_errlog", MAX = 60;
  const _seen = {};   // msg -> last ts, to dedupe error bursts
  function readBuf() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function writeBuf(a) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX))); } catch (e) { } }
  function nowMs() { try { return Date.now(); } catch (e) { return 0; } }
  function iso() { try { return new Date().toISOString(); } catch (e) { return ""; } }
  function post(rec) {
    try {
      if (typeof S === "undefined" || !S || !S.sync || !S.sync.url || typeof fetch !== "function") return;
      fetch(String(S.sync.url).replace(/\/+$/, "") + "/api/clientlog", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (S.sync.token || "") },
        body: JSON.stringify({ org: rec.biz || "", tab: rec.tab || "", ver: (typeof BUILD !== "undefined" ? String(BUILD) : ""), who: rec.who || "", msg: rec.msg, stack: rec.stack, url: (typeof location !== "undefined" && location.href) || "" })
      }).catch(function () { });
    } catch (e) { }
  }
  function record(msg, stack, src) {
    try {
      msg = String(msg == null ? "" : msg).slice(0, 500); if (!msg) return;
      stack = String(stack == null ? "" : stack).slice(0, 2500);
      const t = nowMs(); if (_seen[msg] && (t - _seen[msg]) < 15000) return;   // same error within 15s → skip (burst guard)
      _seen[msg] = t;
      const who = (typeof curUser === "function" && curUser()) ? (curUser().username || "") : "";
      const rec = { t: iso(), msg: msg, stack: stack, src: src || "", tab: (typeof TAB !== "undefined" ? TAB : ""), biz: (typeof S !== "undefined" && S ? S.biz : ""), who: who };
      const a = readBuf(); a.push(rec); writeBuf(a);
      post(rec);
    } catch (e) { }
  }
  if (typeof window !== "undefined") {
    window.addEventListener("error", function (e) {
      try {
        const src = (e && e.filename) || "";
        if (/unpkg|leaflet|nominatim|openstreetmap|tile|maps\.google|gstatic/i.test(src)) return;   // 3rd-party/map noise
        if (!e || (!e.message && !e.error)) return;   // resource-load (404) events carry no message
        record((e.message || "error") + (src ? " @ " + String(src).split("/").pop() + ":" + (e.lineno || "") : ""), (e.error && e.error.stack) || "", "onerror");
      } catch (x) { }
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      try { const r = e && e.reason; record("promise: " + ((r && r.message) || r || "rejection"), (r && r.stack) || "", "promise"); } catch (x) { }
    });
    // manual capture hook (call errCapture("...") from a catch to record a handled problem)
    window.errCapture = function (msg, stack) { record(msg, stack, "manual"); };
    window.errLogRead = readBuf;
    window.errLogClear = function () { writeBuf([]); if (typeof render === "function") render(); };
  }
  /* viewer — a modal of the recent errors with a Copy button (so the owner can paste them, and they're on the server). */
  window.showErrorLog = function () {
    if (typeof modal !== "function") return;
    const a = readBuf().slice().reverse();
    const esc2 = (typeof esc === "function") ? esc : (s => String(s == null ? "" : s));
    let body = `<p class="muted" style="white-space:normal;margin:0 0 8px">Recent JavaScript errors on this device (newest first). These are also sent to the server. If something misbehaves, reproduce it, then check here.</p>`;
    if (!a.length) body += `<div class="card"><div class="muted">No errors logged. 🎉</div></div>`;
    else body += `<div style="max-height:52vh;overflow:auto">` + a.map(r => `<div class="card" style="padding:6px 8px;margin-bottom:6px"><div class="nm" style="font-size:13px;white-space:normal;color:var(--danger)">${esc2(r.msg)}</div><div class="sub" style="white-space:normal">${esc2((r.t || "").slice(0, 19).replace("T", " "))}${r.tab ? " · " + esc2(r.tab) : ""}${r.who ? " · " + esc2(r.who) : ""}</div>${r.stack ? `<pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);margin:4px 0 0;max-height:120px;overflow:auto">${esc2(r.stack)}</pre>` : ""}</div>`).join("") + `</div>`;
    body += `<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="(function(){try{navigator.clipboard.writeText(localStorage.getItem('jsuite_errlog')||'[]');if(typeof toast==='function')toast('Copied the error log');else alert('Copied.');}catch(e){alert('Copy failed');}})()">📋 Copy log</button><button class="btn ghost grow" style="color:var(--danger)" onclick="errLogClear();closeModal()">Clear</button></div>`;
    modal("🐞 Error log", body);
  };
})();
