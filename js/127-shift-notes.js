/* ---------- SHIFT NOTES (js/127) — what you did, logged as you go ------------------------------------
   Ray, 2026-08-13, replacing QuickBooks Time: "i should be able to take notes assigned to shifts to list out
   what I do as I work piecemeal."

   PIECEMEAL is the whole point. This is not one description field you overwrite at the end of the day — it is a
   running list of timestamped entries you add THROUGHOUT a shift, so an eight-hour day reads as what actually
   happened in it. That is the thing an invoice line and a client question both need later.

   ⚠️ WHY ITS OWN COLLECTION AND NOT AN ARRAY ON THE PUNCH
   A `notes:[]` array on the timeclock entry would be simpler — and would silently lose notes. Add one on the
   phone at 10am and another on the laptop at 2pm and whole-record last-write-wins keeps only one device's copy
   of the array. That is the exact bug that forced job.materials/job.expenses out into their own collections
   (jobMaterials/jobExpenses). Each note is therefore its own record with its own id and updatedAt, so two
   devices adding notes to the same shift both survive.

   Record: { id:"sn_…", entryId, ts, text, userId, userName, deleted, updatedAt }
   `ts` is when the work happened (defaults to now, editable) — NOT when the record was typed. */

function actShiftNotes() { return (D().shiftNotes || []).filter(function (n) { return n && !n.deleted; }); }

/* every note on one punch, oldest first — the order you did the work in */
function shiftNotesFor(entryId) {
  if (!entryId) return [];
  return actShiftNotes().filter(function (n) { return n.entryId === entryId; })
    .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
}
function shiftNoteCount(entryId) { return shiftNotesFor(entryId).length; }

function snWho() {
  var u = (typeof curUser === "function") ? curUser() : null;
  return { userId: (u && u.id) || "", userName: (u && u.username) || "" };
}
function snTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
}
/* datetime-local value for an editable timestamp */
function snDtLocal(ms) {
  try {
    var d = new Date(ms), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (e) { return ""; }
}

/* ---- the running list, rendered under a punch ---- */
function shiftNotesHTML(entryId, opts) {
  opts = opts || {};
  var list = shiftNotesFor(entryId);
  var canEdit = opts.canEdit !== false;
  var h = "";
  if (list.length) {
    h += '<div style="border-left:2px solid var(--line);margin:6px 0 4px;padding-left:10px">';
    list.forEach(function (n) {
      h += '<div class="row" style="gap:6px;align-items:flex-start;margin-bottom:5px">'
        + '<div class="sub" style="flex:0 0 52px;font-variant-numeric:tabular-nums">' + esc(snTime(n.ts)) + '</div>'
        + '<div class="grow" style="font-size:13.5px;white-space:pre-wrap">' + esc(n.text || "") + '</div>'
        + (canEdit ? '<button class="btn ghost sm" style="flex:0 0 auto;padding:2px 7px" onclick="snEdit(\'' + n.id + '\')">✎</button>' : '')
        + '</div>';
    });
    h += '</div>';
  }
  if (canEdit) {
    h += '<button class="btn ghost sm" style="width:100%;margin-top:2px" onclick="snAdd(\'' + entryId + '\')">'
      + (list.length ? '＋ Add another note' : '＋ What did you do?') + '</button>';
  }
  return h;
}

/* ---- add ---- */
if (typeof window !== "undefined") window.snAdd = function (entryId, presetTs) {
  if (!entryId) return;
  var ts = presetTs || Date.now();
  modal("Add a note", ''
    + '<div class="sub" style="white-space:normal;margin-bottom:8px">One line about what you just did. Add as many as you like through the shift.</div>'
    + '<label style="margin-top:0">What did you do?</label>'
    + '<textarea id="sn_text" rows="3" placeholder="e.g. Ran cable to the second-floor AP" autofocus></textarea>'
    + '<label>When</label><input id="sn_ts" type="datetime-local" value="' + snDtLocal(ts) + '">'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="snSave(\'' + entryId + '\',\'\')">Save note</button>');
  setTimeout(function () { var el = document.getElementById("sn_text"); if (el) el.focus(); }, 60);
};

/* ---- edit / delete ---- */
if (typeof window !== "undefined") window.snEdit = function (id) {
  var n = actShiftNotes().find(function (x) { return x.id === id; }); if (!n) return;
  modal("Edit note", ''
    + '<label style="margin-top:0">What did you do?</label>'
    + '<textarea id="sn_text" rows="3">' + esc(n.text || "") + '</textarea>'
    + '<label>When</label><input id="sn_ts" type="datetime-local" value="' + snDtLocal(n.ts) + '">'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="snSave(\'' + n.entryId + '\',\'' + n.id + '\')">Save</button>'
    + '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="snDel(\'' + n.id + '\')">Delete note</button>');
};

if (typeof window !== "undefined") window.snSave = function (entryId, id) {
  var text = (typeof val === "function" ? val("sn_text") : "").trim();
  if (!text) { alert("Type what you did."); return; }
  var tsV = (typeof val === "function") ? val("sn_ts") : "";
  var ts = tsV ? new Date(tsV).getTime() : Date.now();
  if (!(ts > 0)) ts = Date.now();
  var d = D(); if (!Array.isArray(d.shiftNotes)) d.shiftNotes = [];
  var n = id ? d.shiftNotes.find(function (x) { return x && x.id === id; }) : null;
  if (!n) {
    var who = snWho();
    n = { id: "sn_" + (typeof uid === "function" ? uid() : String(Date.now())), entryId: entryId,
          userId: who.userId, userName: who.userName };
    d.shiftNotes.push(n);
  }
  n.text = text.slice(0, 1000);
  n.ts = ts;
  n.deleted = false;
  if (typeof touch === "function") touch(n);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") window.snDel = function (id) {
  if (!confirm("Delete this note?")) return;
  var n = (D().shiftNotes || []).find(function (x) { return x && x.id === id; });
  if (n) { n.deleted = true; if (typeof touch === "function") touch(n); if (typeof save === "function") save(); }
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") {
  window.actShiftNotes = actShiftNotes;
  window.shiftNotesFor = shiftNotesFor;
  window.shiftNoteCount = shiftNoteCount;
  window.shiftNotesHTML = shiftNotesHTML;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { shiftNotesFor: shiftNotesFor, shiftNoteCount: shiftNoteCount };
}
