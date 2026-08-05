/* ---------- HANDOFF FILES (js/127) ---------------------------------------------------------------------
   Ray, 2026-08-05: "Can you just make a spot in the app where I can upload the files? I don't have access to
   the workstation you're running on… I just wanna be able to give you screenshots and PDFs and CSVs and let
   you read them."

   Fair — I'd made him a folder on a machine he can't reach. This is the door, on the phone he actually holds.

   NOTHING NEW UNDER THE HOOD. /api/upload already accepts png/jpg/webp, PDF and CSV, and jsUpload (js/27)
   already downscales photos and reports progress. All this adds is a place to press the button on the personal
   org, plus a record of WHAT each file is — because a folder of hex-named blobs is useless without that.

   The note field is the point. "nfcu june" or "the truck loan" turns an anonymous blob into something I can
   act on without a round of twenty questions.

   Bank statements are sensitive, so the copy says plainly what this is and what it isn't: the file lands on
   HIS server, is never committed to git, and no password or full card number should ever go in here. */

var PF_BUSY = false, PF_MSG = "", PF_PCT = 0, PF_DONE = 0, PF_TOTAL = 0;

function actFiles() { return (D().personalFiles || []).filter(function (f) { return f && !f.deleted; }); }
function pfCanUpload() { return typeof jsUpload === "function" && !!(typeof S !== "undefined" && S.sync && S.sync.token); }
function pfSize(n) {
  n = +n || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return Math.round(n / 1024) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function pfIcon(f) {
  var t = String((f && (f.type || f.name)) || "").toLowerCase();
  if (/csv|excel/.test(t)) return "📊";
  if (/pdf/.test(t)) return "📄";
  return "🖼";
}

/* ---- the card, shown on the personal home ---- */
function pfCardHTML() {
  var list = actFiles();
  var unread = list.filter(function (f) { return !f.readAt; }).length;
  var h = '<div class="card">';
  if (PF_BUSY) {
    h += '<div style="font-weight:800">⬆ Uploading' + (PF_TOTAL > 1 ? " " + (PF_DONE + 1) + " of " + PF_TOTAL : "") + '…</div>'
      + '<div class="sub" style="margin-top:4px;white-space:normal">' + esc(PF_MSG || "") + '</div>'
      + '<div style="height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:8px">'
      + '<div style="height:100%;width:' + Math.max(4, Math.min(100, PF_PCT)) + '%;background:var(--accent);transition:width .2s"></div></div>';
  } else {
    h += '<div class="row" style="gap:8px;align-items:flex-start">'
      + '<div class="grow"><div class="nm">📎 Send me a file</div>'
      + '<div class="sub" style="white-space:normal">Statements, bills, screenshots, CSVs — anything you want me to read. '
      + 'It lands on your own server; nothing is emailed or posted anywhere.</div></div>'
      + (pfCanUpload()
          ? '<button class="btn acc" style="flex:0 0 auto" onclick="pfPick()">Upload</button>'
          : '<div class="sub" style="flex:0 0 auto">needs sign-in</div>')
      + '</div>';
    if (PF_MSG) h += '<div class="note" style="margin-top:8px;white-space:normal">' + esc(PF_MSG) + '</div>';
  }
  if (list.length) {
    h += '<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px">'
      + '<div class="row" style="gap:6px;align-items:center;margin-bottom:4px">'
      + '<div class="grow sub" style="white-space:normal"><b>' + list.length + ' file' + (list.length === 1 ? "" : "s") + ' sent</b>'
      + (unread ? ' · ' + unread + ' I haven\'t read yet' : '') + '</div>'
      + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="pfOpenList()">See all</button></div>';
    list.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 3).forEach(function (f) {
      h += '<div class="row" style="gap:6px;align-items:center;margin-top:3px">'
        + '<div class="grow" style="font-size:13px;white-space:normal">' + pfIcon(f) + ' ' + esc(f.note || f.name || "file")
        + '<span class="sub" style="font-size:11px"> · ' + esc(pfSize(f.size)) + '</span></div></div>';
    });
    h += '</div>';
  }
  return h + '</div>';
}

/* ---- pick + upload (multiple at once — a month of statements is never one file) ---- */
if (typeof window !== "undefined") window.pfPick = function () {
  if (!pfCanUpload()) { alert("This needs a signed-in, synced device."); return; }
  var inp = document.createElement("input");
  inp.type = "file"; inp.multiple = true;
  inp.accept = "image/*,application/pdf,text/csv,.csv";
  inp.onchange = function () { var fs = inp.files ? [].slice.call(inp.files) : []; if (fs.length) pfUploadAll(fs); };
  inp.click();
};
function pfStep(msg, pct) {
  PF_BUSY = true; PF_MSG = msg; PF_PCT = pct;
  if (typeof render === "function") render();
}
function pfEnd(msg) {
  PF_BUSY = false; PF_MSG = msg || ""; PF_PCT = 0; PF_DONE = 0; PF_TOTAL = 0;
  if (typeof render === "function") render();
}
if (typeof window !== "undefined") window.pfUploadAll = async function (files) {
  if (PF_BUSY) return;
  PF_TOTAL = files.length; PF_DONE = 0;
  var ok = 0, failed = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    PF_DONE = i;
    try {
      pfStep(f.name || "file", 5);
      var blobId = await jsUpload(f, function (p) { pfStep(f.name || "file", Math.max(5, p)); });
      if (!blobId) throw new Error("no id");
      var d = D(); if (!Array.isArray(d.personalFiles)) d.personalFiles = [];
      var rec = { id: "pf_" + (typeof uid === "function" ? uid() : String(Date.now()) + i),
                  blobId: blobId, name: String(f.name || "file").slice(0, 120),
                  size: f.size || 0, type: String(f.type || "").slice(0, 60),
                  note: "", ts: (typeof now === "function") ? now() : Date.now(), deleted: false };
      if (typeof touch === "function") touch(rec);
      d.personalFiles.push(rec);
      if (typeof save === "function") save();
      ok++;
    } catch (e) {
      failed.push((f && f.name ? f.name + ": " : "") + ((e && e.message) || "failed"));
    }
  }
  pfEnd(failed.length
    ? (ok ? ok + " sent. " : "") + "Couldn't send " + failed.length + ": " + failed.join("; ")
    : "");
  /* straight into naming them — an unlabelled blob is the thing that wastes both our time */
  if (ok) pfOpenList(true);
};

/* ---- the list: label what things are, delete what shouldn't be here ---- */
if (typeof window !== "undefined") window.pfOpenList = function (promptNotes) {
  var list = actFiles().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  modal("Files you've sent me",
    (promptNotes ? '<div class="sub" style="white-space:normal;margin-bottom:8px">Sent. A quick label on each one saves us a round of questions — "NFCU June", "the truck loan", "Visa statement".</div>' : '')
    + (list.length
        ? list.map(function (f) {
            return '<div style="border-bottom:1px solid var(--line);padding:7px 0">'
              + '<div class="row" style="gap:6px;align-items:center">'
              + '<div class="grow" style="font-size:13px;white-space:normal">' + pfIcon(f) + ' ' + esc(f.name || "file")
              + '<span class="sub" style="font-size:11px"> · ' + esc(pfSize(f.size))
              + (f.readAt ? ' · ✓ read' : '') + '</span></div>'
              + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="pfDel(\'' + f.id + '\')">✕</button></div>'
              + '<input placeholder="what is this?" value="' + esc(f.note || "") + '" style="margin-top:4px"'
              + ' oninput="pfNote(\'' + f.id + '\',this.value)"'
              + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">'
              + '</div>';
          }).join("")
        : '<div class="muted" style="font-size:13px">Nothing sent yet.</div>')
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="closeModal();pfPick()">＋ Send more</button>'
    + '<div class="sub" style="white-space:normal;margin-top:10px">These stay on your own server. Never put a password, '
    + 'a login, or a full card number in a file you send.</div>');
};
if (typeof window !== "undefined") window.pfNote = function (id, v) {
  var f = actFiles().find(function (x) { return x.id === id; }); if (!f) return;
  f.note = String(v || "").slice(0, 140);
  if (typeof touch === "function") touch(f);
  if (typeof save === "function") save();      // debounced by save() itself
};
if (typeof window !== "undefined") window.pfDel = function (id) {
  if (!confirm("Remove this file from the list?")) return;
  var f = (D().personalFiles || []).find(function (x) { return x && x.id === id; });
  if (f) { f.deleted = true; if (typeof touch === "function") touch(f); }
  if (typeof save === "function") save();
  pfOpenList();
};

if (typeof window !== "undefined") { window.pfCardHTML = pfCardHTML; window.actFiles = actFiles; window.pfSize = pfSize; }
if (typeof module !== "undefined" && module.exports) module.exports = { pfSize: pfSize };
