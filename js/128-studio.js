/* ---------- STUDIO (js/128) — drop a video in, it lands where the edit pipeline expects it -------------
   Ray, 2026-08-06: "build it into the j suite app so I can just put the videos there, and you know that
   it's a video that needs to be edited for TikTok or Twitter."

   WHY THIS DOESN'T USE js/127's UPLOADER. That one base64-encodes the whole file in browser memory and the
   server caps it at 10MB — fine for a statement, hopeless for a 900MB phone video. This talks to
   /api/video/* instead: raw binary, 4MB at a time, straight to disk in ~/studio/raw/ where ingest.py
   already looks. Nothing is held whole at either end.

   CHUNKS ARE RETRIED, NOT RESTARTED. He is uploading from a phone, often from a site with bad signal. A
   failed chunk retries three times with backoff; only then does the whole upload give up. Losing 4MB and
   redoing it is survivable — losing 900MB is not.

   The record carries TARGETS (tiktok / x) and a note, because the point isn't storage, it's telling me what
   this footage is for. Status walks: uploaded -> transcribed -> clips cut. ingest.py fills the middle. */

var STU_BUSY = false, STU_MSG = "", STU_PCT = 0, STU_FILE = "";
var STU_TARGETS = { tiktok: true, x: true };

function actVideos() { return (D().studioVideos || []).filter(function (v) { return v && !v.deleted; }); }
function stuCan() { return !!(typeof S !== "undefined" && S.sync && S.sync.url && S.sync.token); }
function stuBase() { return ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, ""); }
function stuHdr() { return { "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") }; }
function stuMB(n) { n = +n || 0; return n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(0) + " MB"; }
function stuDur(s) { s = Math.round(+s || 0); if (!s) return ""; var m = Math.floor(s / 60); return m ? m + "m " + (s % 60) + "s" : s + "s"; }

var STU_STATUS = {
  uploaded:    { label: "waiting on me",  hint: "I'll pull a transcript off it" },
  transcribed: { label: "transcribed",    hint: "I'm picking the moments" },
  cut:         { label: "clips ready",    hint: "" }
};

/* ---- the card ---- */
function stuCardHTML() {
  var list = actVideos().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  var h = '<div class="card">';
  if (STU_BUSY) {
    h += '<div style="font-weight:800">🎬 Uploading ' + esc(STU_FILE) + '…</div>'
      + '<div class="sub" style="margin-top:4px;white-space:normal">' + esc(STU_MSG || "") + '</div>'
      + '<div style="height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin-top:8px">'
      + '<div style="height:100%;width:' + Math.max(2, Math.min(100, STU_PCT)) + '%;background:var(--accent);transition:width .3s"></div></div>'
      + '<div class="sub" style="font-size:11px;margin-top:4px">Keep this page open — it uploads in pieces so a dropped signal only costs the current piece.</div>';
  } else {
    h += '<div class="row" style="gap:8px;align-items:flex-start">'
      + '<div class="grow"><div class="nm">🎬 Send footage to edit</div>'
      + '<div class="sub" style="white-space:normal">Long video in — I pull a transcript, pick the moments, and cut vertical captioned clips.</div></div>'
      + (stuCan() ? '<button class="btn acc" style="flex:0 0 auto" onclick="stuPick()">Upload</button>'
                  : '<div class="sub" style="flex:0 0 auto">needs sign-in</div>') + '</div>'
      + '<div class="row" style="gap:10px;margin-top:8px;align-items:center">'
      + '<label class="toggle" style="margin:0"><input type="checkbox" ' + (STU_TARGETS.tiktok ? "checked" : "") + ' onchange="stuTarget(\'tiktok\',this.checked)"> TikTok</label>'
      + '<label class="toggle" style="margin:0"><input type="checkbox" ' + (STU_TARGETS.x ? "checked" : "") + ' onchange="stuTarget(\'x\',this.checked)"> X</label>'
      + '</div>';
    if (STU_MSG) h += '<div class="note" style="margin-top:8px;white-space:normal">' + esc(STU_MSG) + '</div>';
    h += '<div class="sub" style="white-space:normal;margin-top:8px;font-size:11.5px">'
      + '<b>Talk while you work.</b> I read transcripts, not pictures — silent footage is invisible to me.</div>';
  }
  if (list.length) {
    h += '<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px">';
    list.slice(0, 6).forEach(function (v) {
      var st = STU_STATUS[v.status || "uploaded"] || STU_STATUS.uploaded;
      h += '<div class="row" style="gap:6px;align-items:baseline;margin-top:5px">'
        + '<div class="grow" style="font-size:13px;white-space:normal">' + esc(v.note || v.name || "video")
        + '<span class="sub" style="font-size:11px"> · ' + esc(stuMB(v.size)) + (v.duration ? " · " + esc(stuDur(v.duration)) : "") + '</span></div>'
        + '<div class="sub" style="flex:0 0 auto;font-size:11px">' + esc(st.label) + '</div></div>'
        + ((v.targets || []).length ? '<div class="sub" style="font-size:10.5px;margin-top:1px">→ ' + esc((v.targets || []).join(" · ")) + '</div>' : '');
    });
    h += '</div>';
  }
  return h + '</div>';
}
if (typeof window !== "undefined") window.stuTarget = function (k, on) { STU_TARGETS[k] = !!on; };

/* ---- pick + chunked upload ---- */
if (typeof window !== "undefined") window.stuPick = function () {
  if (!stuCan()) { alert("This needs a signed-in, synced device."); return; }
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = "video/*";
  inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) stuUpload(f); };
  inp.click();
};
function stuStep(msg, pct) { STU_BUSY = true; STU_MSG = msg; STU_PCT = pct; if (typeof render === "function") render(); }
function stuEnd(msg) { STU_BUSY = false; STU_MSG = msg || ""; STU_PCT = 0; STU_FILE = ""; if (typeof render === "function") render(); }

var STU_CHUNK = 4 * 1024 * 1024;      // 4MB — small enough that a retry is cheap on cellular

if (typeof window !== "undefined") window.stuUpload = async function (file) {
  if (STU_BUSY) return;
  STU_FILE = file.name || "video";
  var targets = Object.keys(STU_TARGETS).filter(function (k) { return STU_TARGETS[k]; });
  try {
    stuStep("starting", 1);
    var r = await fetch(stuBase() + "/api/video/init", {
      method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, stuHdr()),
      body: JSON.stringify({ name: file.name, size: file.size, org: (typeof S !== "undefined" ? S.biz : ""), targets: targets })
    });
    var j = await r.json();
    if (!r.ok || !j.id) throw new Error(j.error || "could not start the upload");

    var total = Math.ceil(file.size / STU_CHUNK);
    for (var i = 0; i < total; i++) {
      var blob = file.slice(i * STU_CHUNK, Math.min(file.size, (i + 1) * STU_CHUNK));
      var ok = false, lastErr = "";
      for (var attempt = 0; attempt < 3 && !ok; attempt++) {
        if (attempt) { stuStep("piece " + (i + 1) + " of " + total + " — retrying", Math.round(i / total * 100)); await new Promise(function (z) { setTimeout(z, 1200 * attempt); }); }
        try {
          var cr = await fetch(stuBase() + "/api/video/chunk?id=" + encodeURIComponent(j.id) + "&n=" + i,
                               { method: "POST", headers: stuHdr(), body: blob });
          ok = cr.ok;
          if (!ok) { try { lastErr = (await cr.json()).error || ("HTTP " + cr.status); } catch (e) { lastErr = "HTTP " + cr.status; } }
        } catch (e) { lastErr = (e && e.message) || "network"; }
      }
      if (!ok) throw new Error("upload stalled on piece " + (i + 1) + " of " + total + (lastErr ? " (" + lastErr + ")" : ""));
      stuStep("piece " + (i + 1) + " of " + total, Math.round((i + 1) / total * 100));
    }

    stuStep("finishing", 99);
    var dr = await fetch(stuBase() + "/api/video/done?id=" + encodeURIComponent(j.id), { method: "POST", headers: stuHdr() });
    var dj = await dr.json();
    if (!dr.ok || !dj.ok) throw new Error(dj.error || "could not finalise");

    var d = D(); if (!Array.isArray(d.studioVideos)) d.studioVideos = [];
    var rec = { id: "sv_" + (typeof uid === "function" ? uid() : String(Date.now())),
                name: dj.name, size: dj.bytes, targets: targets, note: "",
                status: "uploaded", ts: (typeof now === "function") ? now() : Date.now(), deleted: false };
    if (typeof touch === "function") touch(rec);
    d.studioVideos.push(rec);
    if (typeof save === "function") save();
    stuEnd("");
    stuNote(rec.id, true);
  } catch (e) {
    stuEnd("Upload failed: " + ((e && e.message) || "unknown") + ". Nothing was saved — try again.");
  }
};

/* ---- say what the footage is, while he still remembers ---- */
if (typeof window !== "undefined") window.stuNote = function (id, fresh) {
  var v = actVideos().find(function (x) { return x.id === id; }); if (!v) return;
  modal("What's in this one?",
    (fresh ? '<div class="sub" style="white-space:normal;margin-bottom:8px">Landed. One line about what happens in it saves me guessing from the transcript.</div>' : '')
    + '<label style="margin-top:0">What is it</label>'
    + '<input id="stu_note" value="' + esc(v.note || "") + '" placeholder="e.g. rewiring the maglock on Meltdown" autocomplete="off"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();stuSaveNote(\'' + id + '\');}">'
    + '<div class="sub" style="white-space:normal;margin-top:10px">' + esc(v.name || "") + ' · ' + esc(stuMB(v.size)) + '</div>'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="stuSaveNote(\'' + id + '\')">Save</button>');
  setTimeout(function () { var el = document.getElementById("stu_note"); if (el) el.focus(); }, 60);
};
if (typeof window !== "undefined") window.stuSaveNote = function (id) {
  var v = actVideos().find(function (x) { return x.id === id; }); if (!v) return;
  var el = document.getElementById("stu_note");
  v.note = el ? (el.value || "").slice(0, 160) : "";
  if (typeof touch === "function") touch(v);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") { window.stuCardHTML = stuCardHTML; window.actVideos = actVideos; window.stuMB = stuMB; }
if (typeof module !== "undefined" && module.exports) module.exports = { stuMB: stuMB };

/* ---- the tab ---- */
function rStudio() {
  var list = actVideos().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  var h = '<div class="secthd"><h2>🎬 Studio</h2><span class="ct">' + list.length + '</span></div>';
  h += stuCardHTML();
  if (!list.length) {
    h += '<div class="empty"><div class="big">🎬</div>Nothing here yet. Film the work, talk while you do it, '
      + 'and drop the file in — I\'ll cut it into vertical clips with captions.</div>';
    view.innerHTML = h; return;
  }
  h += '<div class="secthd" style="margin-top:14px"><h2>Footage</h2></div><div class="card" style="padding:6px 10px">';
  list.forEach(function (v) {
    var st = STU_STATUS[v.status || "uploaded"] || STU_STATUS.uploaded;
    h += '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="stuNote(\'' + v.id + '\')">'
      + '<div class="grow"><div class="nm">' + esc(v.note || v.name || "video") + '</div>'
      + '<div class="sub">' + esc(stuMB(v.size)) + ' · ' + esc(st.label)
      + ((v.targets || []).length ? ' · → ' + esc((v.targets || []).join(", ")) : '') + '</div>'
      + (st.hint ? '<div class="sub" style="white-space:normal;font-size:11.5px">' + esc(st.hint) + '</div>' : '')
      + '</div></div>';
  });
  view.innerHTML = h + '</div>';
}
if (typeof window !== "undefined") window.rStudio = rStudio;
