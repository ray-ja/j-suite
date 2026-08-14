/* ---------- VOICE JOURNAL (js/131) — talk, and it writes it down -------------------------------------
   Ray, 2026-08-13: "in the personal app i need a voice to text journaling feature. it has to be accurate
   with the transcription. theres so much i need to get out."

   THE ONE FAILURE THIS CANNOT HAVE is losing a recording. If he talks for fifteen minutes about something
   that was hard to say and the upload dies, that is worse than the feature not existing. So the chain is
   durable at every step and nothing is ever the only copy in one place:

     MediaRecorder (5s slices)
       -> each slice written to IndexedDB THE MOMENT it arrives      (survives a crash, a locked phone,
                                                                       a killed tab, a dead battery)
       -> the recording appears in the Journal immediately            (visible before any network exists)
       -> uploaded in ~2MB batches, addressed by index                (a dropped chunk re-sends, no dupes)
       -> server writes the audio to disk BEFORE transcribing         (a failed transcript costs nothing)
       -> transcript comes back -> a normal lifeNotes entry
       -> only THEN is the local copy deleted

   Offline is a normal state, not an error: recordings sit in the local queue and drain when the server is
   reachable again. Nothing here needs the network to start.

   ⚠️ Microphone access requires a SECURE CONTEXT. Over the raw Tailscale IP (plain http) getUserMedia does
   not exist and the browser gives no useful reason — same constraint as installing the PWA. We detect it
   and say so plainly rather than failing silently.

   Transcription itself is js/../transcribe.py: faster-whisper large-v3 on this box's GPU. Local, free, and
   the audio never leaves the house. */

var VJ_DB = null, VJ_REC = null, VJ_ID = "", VJ_N = 0, VJ_T0 = 0, VJ_TICK = null, VJ_WAKE = null;
var VJ_PENDING = [];          // [{id, seconds, created, state, error}] — mirrored for render
var VJ_DRAINING = false, VJ_MSG = "";

function vjCan() { return !!(typeof S !== "undefined" && S.sync && S.sync.url && S.sync.token); }
function vjBase() { return ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, ""); }
function vjHdr() { return { "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") }; }
function vjSecure() { return (typeof window !== "undefined") && !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
function vjClock(s) {
  s = Math.max(0, Math.round(+s || 0));
  var m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}
/* THE FIRST SENTENCE becomes the title — no AI, no privacy cost, and he can rename it.
   It used to be the first seven words, which on speech reliably produced a mid-sentence fragment
   ("so today was kind of a…") that read like a rendering glitch. A sentence, even a rambling one, reads
   as a sentence. Falls back to a word cut only when the entry has no sentence break in range. */
function vjTitle(text) {
  var s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  var m = /^(.{10,80}?[.!?])(\s|$)/.exec(s);
  if (m) return m[1].length > 80 ? m[1].slice(0, 77) + "…" : m[1];
  if (s.length <= 60) return s;
  var cut = s.slice(0, 60);
  var sp = cut.lastIndexOf(" ");
  return (sp > 20 ? cut.slice(0, sp) : cut) + "…";
}

/* ---------- IndexedDB: the local safety net ---------- */
function vjOpen(cb) {
  if (VJ_DB) return cb(VJ_DB);
  if (typeof indexedDB === "undefined") return cb(null);
  var rq;
  try { rq = indexedDB.open("jsuite-voice", 1); } catch (e) { return cb(null); }
  rq.onupgradeneeded = function (e) {
    var db = e.target.result;
    if (!db.objectStoreNames.contains("recs")) db.createObjectStore("recs", { keyPath: "id" });
    if (!db.objectStoreNames.contains("chunks")) {
      var st = db.createObjectStore("chunks", { keyPath: "k", autoIncrement: true });
      st.createIndex("recId", "recId", { unique: false });
    }
  };
  rq.onsuccess = function (e) { VJ_DB = e.target.result; cb(VJ_DB); };
  rq.onerror = function () { cb(null); };
}
function vjPut(store, val, cb) {
  vjOpen(function (db) {
    if (!db) return cb && cb(false);
    try {
      var tx = db.transaction([store], "readwrite");
      tx.objectStore(store).put(val);
      tx.oncomplete = function () { cb && cb(true); };
      tx.onerror = function () { cb && cb(false); };
    } catch (e) { cb && cb(false); }
  });
}
function vjRecs(cb) {
  vjOpen(function (db) {
    if (!db) return cb([]);
    try {
      var out = [], tx = db.transaction(["recs"], "readonly");
      tx.objectStore("recs").openCursor().onsuccess = function (e) {
        var c = e.target.result;
        if (c) { out.push(c.value); c.continue(); } else cb(out.sort(function (a, b) { return (a.created || 0) - (b.created || 0); }));
      };
      tx.onerror = function () { cb([]); };
    } catch (e) { cb([]); }
  });
}
function vjChunksOf(recId, cb) {
  vjOpen(function (db) {
    if (!db) return cb([]);
    try {
      var out = [], tx = db.transaction(["chunks"], "readonly");
      tx.objectStore("chunks").index("recId").openCursor(IDBKeyRange.only(recId)).onsuccess = function (e) {
        var c = e.target.result;
        if (c) { out.push(c.value); c.continue(); } else cb(out.sort(function (a, b) { return a.n - b.n; }));
      };
      tx.onerror = function () { cb([]); };
    } catch (e) { cb([]); }
  });
}
function vjDrop(recId, cb) {
  vjOpen(function (db) {
    if (!db) return cb && cb();
    try {
      var tx = db.transaction(["recs", "chunks"], "readwrite");
      tx.objectStore("recs").delete(recId);
      var ix = tx.objectStore("chunks").index("recId");
      ix.openCursor(IDBKeyRange.only(recId)).onsuccess = function (e) {
        var c = e.target.result; if (c) { c.delete(); c.continue(); }
      };
      tx.oncomplete = function () { cb && cb(); };
      tx.onerror = function () { cb && cb(); };
    } catch (e) { cb && cb(); }
  });
}

/* ---------- recording ---------- */
function vjMime() {
  var want = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (var i = 0; i < want.length; i++) if (MediaRecorder.isTypeSupported(want[i])) return want[i];
  return "";
}

if (typeof window !== "undefined") window.vjStart = function () {
  if (VJ_REC) return;
  if (!vjSecure()) {
    alert("The microphone needs a secure connection.\n\nOpen the app on the https:// Tailscale hostname rather than the raw IP address — same as installing it to your home screen.");
    return;
  }
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  }).then(function (stream) {
    var mime = vjMime();
    var rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined); }
    catch (e) { try { rec = new MediaRecorder(stream); } catch (e2) { alert("This browser can't record audio."); return; } }

    VJ_ID = "vr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    VJ_N = 0; VJ_T0 = Date.now(); VJ_REC = rec;
    vjPut("recs", { id: VJ_ID, mime: rec.mimeType || mime || "audio/webm", created: Date.now(), seconds: 0, state: "recording" });

    /* every slice goes to disk as it arrives — this is the whole safety story */
    rec.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      var n = VJ_N++;
      vjPut("chunks", { recId: VJ_ID, n: n, blob: e.data });
    };
    rec.onstop = function () {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (x) {}
      var secs = Math.round((Date.now() - VJ_T0) / 1000);
      var id = VJ_ID;
      vjPut("recs", { id: id, mime: rec.mimeType || mime || "audio/webm", created: VJ_T0, seconds: secs, state: "pending" }, function () {
        VJ_REC = null; VJ_ID = ""; vjStopTick(); vjRefresh();
        vjDrain();
      });
    };
    rec.start(5000);      // 5-second slices
    vjWake(true);
    vjStartTick();
    vjRefresh();
  }).catch(function (err) {
    var n = (err && err.name) || "";
    alert(n === "NotAllowedError"
      ? "Microphone permission was refused. Allow it for this site and try again."
      : n === "NotFoundError" ? "No microphone found."
      : "Couldn't start recording" + (n ? " (" + n + ")" : "") + ".");
  });
};

if (typeof window !== "undefined") window.vjStop = function () {
  if (!VJ_REC) return;
  try { VJ_REC.stop(); } catch (e) { VJ_REC = null; vjStopTick(); vjRefresh(); }
  vjWake(false);
};

/* keep the screen awake while recording — a locked phone can suspend the recorder mid-sentence */
function vjWake(on) {
  try {
    if (on && navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request("screen").then(function (w) { VJ_WAKE = w; }).catch(function () {});
    } else if (!on && VJ_WAKE) { VJ_WAKE.release().catch(function () {}); VJ_WAKE = null; }
  } catch (e) {}
}

/* the timer updates its own node — a full render every second would fight the page */
function vjStartTick() {
  vjStopTick();
  VJ_TICK = setInterval(function () {
    var el = document.getElementById("vj_clock");
    if (el) el.textContent = vjClock((Date.now() - VJ_T0) / 1000);
    else vjStopTick();
  }, 1000);
}
function vjStopTick() { if (VJ_TICK) { clearInterval(VJ_TICK); VJ_TICK = null; } }

/* ---------- upload + transcribe ---------- */
function vjDrain() {
  if (VJ_DRAINING) return;
  VJ_DRAINING = true;
  vjRecs(function (recs) {
    var todo = recs.filter(function (r) { return r && r.state === "pending"; });
    if (!todo.length || !vjCan()) { VJ_DRAINING = false; return vjRefresh(); }
    vjSend(todo[0], function () { VJ_DRAINING = false; vjDrain(); });
  });
}

function vjSend(rec, done) {
  vjChunksOf(rec.id, function (chunks) {
    if (!chunks.length) { return vjDrop(rec.id, function () { vjRefresh(); done(); }); }
    VJ_MSG = "Sending…"; vjRefresh();
    var hdr = vjHdr();
    fetch(vjBase() + "/api/voice/init", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": hdr.Authorization },
      body: JSON.stringify({ mime: rec.mime || "audio/webm", seconds: rec.seconds || 0 })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.id) throw new Error((j && j.error) || "upload refused");
      /* group the 5s slices into ~2MB posts — 240 tiny requests over cellular is its own failure mode */
      var groups = [], cur = [], size = 0;
      chunks.forEach(function (c) {
        var s = (c.blob && c.blob.size) || 0;
        if (size && size + s > 2e6) { groups.push(cur); cur = []; size = 0; }
        cur.push(c.blob); size += s;
      });
      if (cur.length) groups.push(cur);

      var i = 0;
      function next() {
        if (i >= groups.length) {
          return fetch(vjBase() + "/api/voice/done?id=" + encodeURIComponent(j.id)
              + "&org=" + encodeURIComponent((typeof S !== "undefined" && S.biz) || ""),
              { method: "POST", headers: hdr })
            .then(function (r) { return r.json(); }).then(function (d) {
              if (!d || !d.ok) throw new Error((d && d.error) || "could not finish the upload");
              vjPut("recs", Object.assign({}, rec, { state: "transcribing", serverId: j.id }), function () {
                VJ_MSG = ""; vjRefresh(); vjPoll(rec.id, j.id, 0); done();
              });
            });
        }
        var n = i++;
        VJ_MSG = "Sending… " + Math.round((n / groups.length) * 100) + "%"; vjRefresh();
        fetch(vjBase() + "/api/voice/chunk?id=" + encodeURIComponent(j.id) + "&n=" + n,
              { method: "POST", headers: hdr, body: new Blob(groups[n]) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (!d || !d.ok) throw new Error((d && d.error) || "chunk rejected"); next(); })
          .catch(function (e) { vjFail(rec, e); done(); });
      }
      next();
    }).catch(function (e) { vjFail(rec, e); done(); });
  });
}

function vjFail(rec, e) {
  /* stays "pending" on purpose — the audio is still here and it retries. Never a dead end. */
  VJ_MSG = "";
  vjPut("recs", Object.assign({}, rec, { state: "pending", error: String((e && e.message) || e || "").slice(0, 140) }), vjRefresh);
}

function vjPoll(localId, serverId, tries) {
  if (tries > 600) return;    // ~20 min ceiling; the audio survives regardless
  setTimeout(function () {
    fetch(vjBase() + "/api/voice/status?id=" + encodeURIComponent(serverId), { headers: vjHdr() })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j) throw new Error("no answer");
        if (j.state === "done") return vjLand(localId, serverId, j.text || "");
        if (j.state === "error") {
          return vjRecs(function (rs) {
            var r = rs.find(function (x) { return x.id === localId; }) || { id: localId };
            vjPut("recs", Object.assign({}, r, { state: "failed", serverId: serverId, error: String(j.error || "transcription failed").slice(0, 140) }), vjRefresh);
          });
        }
        vjPoll(localId, serverId, tries + 1);
      })
      .catch(function () { vjPoll(localId, serverId, tries + 1); });
  }, tries < 5 ? 1500 : 3000);
}

/* the transcript becomes a normal journal entry — same record type as a typed one */
function vjLand(localId, serverId, text) {
  if (!String(text || "").trim()) {
    return vjRecs(function (rs) {
      var r = rs.find(function (x) { return x.id === localId; }) || { id: localId };
      vjPut("recs", Object.assign({}, r, { state: "failed", serverId: serverId, error: "nothing was said in that recording" }), vjRefresh);
    });
  }
  var d = D(); if (!Array.isArray(d.lifeNotes)) d.lifeNotes = [];
  var n = {
    id: "life-note-" + (typeof uid === "function" ? uid() : String(Date.now())),
    date: (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10),
    title: vjTitle(text), body: String(text), audioId: serverId, voice: true, deleted: false
  };
  if (typeof touch === "function") touch(n);
  d.lifeNotes.push(n);
  if (typeof save === "function") save();
  /* SECOND PASS (js/132) — only after the entry is safely saved, and it can only ever offer. Venting
     returns nothing and shows nothing; see the header of js/132 for why this is deliberately separate. */
  if (typeof jaScan === "function") { try { jaScan(n.id, text); } catch (e) {} }
  /* local copy goes only now that the entry exists and is queued to sync */
  vjDrop(localId, function () { vjRefresh(); if (typeof render === "function") render(); });
}

if (typeof window !== "undefined") {
  window.vjRetry = function (localId) {
    vjRecs(function (rs) {
      var r = rs.find(function (x) { return x.id === localId; }); if (!r) return;
      if (r.serverId) {
        fetch(vjBase() + "/api/voice/retry?id=" + encodeURIComponent(r.serverId)
            + "&org=" + encodeURIComponent((typeof S !== "undefined" && S.biz) || ""),
            { method: "POST", headers: vjHdr() })
          .then(function () {
            vjPut("recs", Object.assign({}, r, { state: "transcribing", error: "" }), function () {
              vjRefresh(); vjPoll(r.id, r.serverId, 0);
            });
          }).catch(function () {});
      } else {
        vjPut("recs", Object.assign({}, r, { state: "pending", error: "" }), function () { vjRefresh(); vjDrain(); });
      }
    });
  };
  window.vjDiscard = function (localId) {
    if (!confirm("Delete this recording? The audio and anything said in it are gone for good.")) return;
    vjDrop(localId, function () { vjRefresh(); });
  };
  window.vjKick = function () { vjDrain(); };
}

/* ---------- the UI: one button ---------- */
function vjRefresh() {
  vjRecs(function (recs) {
    VJ_PENDING = recs;
    var host = document.getElementById("vj_host");
    if (host) host.innerHTML = vjInnerHTML();
  });
}

function vjInnerHTML() {
  var rec = !!VJ_REC;
  var h = "";
  if (!vjSecure()) {
    h += '<div class="card"><div style="font-weight:800">🎙️ Voice entry</div>'
      + '<div class="sub" style="white-space:normal;margin-top:6px">The microphone needs a secure connection. '
      + 'Open the app on the <b>https://</b> Tailscale hostname rather than the raw IP — the same one that lets you install it to your home screen.</div></div>';
    return h;
  }
  h += '<div class="card">';
  if (rec) {
    h += '<div class="row" style="align-items:center;gap:10px">'
      + '<div style="width:12px;height:12px;border-radius:50%;background:var(--danger);flex:0 0 auto"></div>'
      + '<div style="font-weight:800;font-size:22px;font-variant-numeric:tabular-nums" id="vj_clock">' + vjClock((Date.now() - VJ_T0) / 1000) + '</div>'
      + '<div class="sub grow">Listening…</div></div>'
      + '<button class="btn acc" style="width:100%;margin-top:10px;font-size:17px;padding:14px" onclick="vjStop()">■ Stop &amp; save</button>';
  } else {
    h += '<button class="btn acc" style="width:100%;font-size:17px;padding:16px" onclick="vjStart()">🎙️ Talk</button>'
      + '<div class="sub" style="margin-top:6px;white-space:normal">Say whatever you want, for as long as you want. It writes itself down here — on this machine, not anyone\'s server.</div>';
  }
  if (VJ_MSG) h += '<div class="sub" style="margin-top:8px">' + esc(VJ_MSG) + '</div>';
  h += '</div>';

  var live = (VJ_PENDING || []).filter(function (r) { return r && r.state !== "recording"; });
  if (live.length) {
    h += '<div class="card" style="padding:6px 10px">';
    live.forEach(function (r) {
      var lbl = r.state === "transcribing" ? "writing it down…"
              : r.state === "failed" ? "couldn't transcribe"
              : vjCan() ? "waiting to send" : "saved here — will send when the server is reachable";
      h += '<div class="li" style="align-items:flex-start">'
        + '<div class="grow"><div class="nm">🎙️ ' + esc(vjClock(r.seconds)) + ' recording</div>'
        + '<div class="sub" style="white-space:normal">' + esc(lbl) + (r.error ? ' · ' + esc(r.error) : '') + '</div></div>';
      if (r.state === "failed") {
        h += '<button class="btn ghost sm" style="flex:0 0 auto" onclick="vjRetry(\'' + r.id + '\')">Try again</button>'
          + '<button class="btn ghost sm" style="flex:0 0 auto;color:var(--danger)" onclick="vjDiscard(\'' + r.id + '\')">✕</button>';
      } else if (r.state === "pending" && vjCan()) {
        h += '<button class="btn ghost sm" style="flex:0 0 auto" onclick="vjKick()">Send</button>';
      }
      h += '</div>';
    });
    h += '<div class="sub" style="padding:4px 2px 6px;white-space:normal">Nothing here is lost — the audio is saved on this device until the words are safely in your journal.</div>';
    h += '</div>';
  }
  return h;
}

/* the mount point js/78 renders; content fills in async once IndexedDB answers */
function vjBarHTML() {
  setTimeout(vjRefresh, 0);
  return '<div id="vj_host">' + vjInnerHTML() + '</div>';
}

if (typeof window !== "undefined") {
  window.vjBarHTML = vjBarHTML;
  window.vjInnerHTML = vjInnerHTML;
  /* pick up anything stranded by a closed tab or a dead network */
  window.addEventListener("online", function () { vjDrain(); });
  setTimeout(function () { if (vjCan()) vjDrain(); }, 4000);
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { vjTitle: vjTitle, vjClock: vjClock };
}
