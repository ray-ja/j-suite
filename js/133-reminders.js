/* ---------- REMINDERS (js/133) — told at a time, not just written down --------------------------------
   Ray, 2026-08-13: "even remind me of things at certain days and times"

   A reminder is NOT a to-do. A to-do is a standing item you tick off and can see whenever you look; a
   reminder is a message that arrives at a moment and is then history. That is why this is its own
   collection rather than a flag on `todos` — the server sweep stamps `fired` on the record, and it needs
   to be a normal synced record so per-record LWW carries that stamp to every device (a phone that was
   offline at the due moment must see an already-fired reminder, not be told a second time).

   Record: { id:"rm_…", text, dueAt (ms), fired, firedAt, sourceNoteId, userId, deleted, updatedAt }

   DELIVERY IS THE SERVER'S JOB (sync-server reminderSweep): at the due minute it posts the reminder as a
   message in his own DM thread, which is what makes the phone buzz — web push here is event-driven off
   messages and has no scheduler of its own. This file is only the list and the editor. */

function actReminders() { return (D().reminders || []).filter(function (r) { return r && !r.deleted; }); }

/* "2026-08-20" + "14:30" -> ms local. The date is authoritative; a missing time means 9am, because a
   reminder with no time attached is a morning reminder, not a midnight one. */
function rmDueAt(dateISO, timeHM) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || ""))) return 0;
  var t = /^\d{1,2}:\d{2}$/.test(String(timeHM || "")) ? timeHM : "09:00";
  var p = String(dateISO).split("-"), q = String(t).split(":");
  var d = new Date(+p[0], +p[1] - 1, +p[2], +q[0], +q[1], 0, 0);
  var ms = d.getTime();
  return isNaN(ms) ? 0 : ms;
}
function rmDateOf(ms) {
  try {
    var d = new Date(+ms), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  } catch (e) { return ""; }
}
function rmTimeOf(ms) {
  try {
    var d = new Date(+ms), p = function (n) { return String(n).padStart(2, "0"); };
    return p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (e) { return "09:00"; }
}
function rmWhen(ms) {
  var now = Date.now(), diff = +ms - now;
  var day = 86400000;
  var t = rmTimeOf(ms);
  if (diff < 0) return "was due " + ((typeof fmtDate === "function") ? fmtDate(rmDateOf(ms)) : rmDateOf(ms));
  if (diff < day && new Date(+ms).getDate() === new Date(now).getDate()) return "today at " + t;
  if (diff < 2 * day) return "tomorrow at " + t;
  return ((typeof fmtDate === "function") ? fmtDate(rmDateOf(ms)) : rmDateOf(ms)) + " at " + t;
}

function rmUpcoming() {
  return actReminders().filter(function (r) { return !r.fired; })
    .sort(function (a, b) { return (a.dueAt || 0) - (b.dueAt || 0); });
}

/* ---- the card. Silent when there is nothing pending. ---- */
function rmCardHTML() {
  var up = rmUpcoming();
  var h = '<div class="card">'
    + '<div class="row" style="align-items:center;gap:8px"><div class="grow" style="font-weight:800">⏰ Reminders</div>'
    + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="rmEdit(\'\')">＋ Add</button></div>';
  if (!up.length) {
    h += '<div class="sub" style="white-space:normal;margin-top:6px">Nothing pending. Say "remind me on Tuesday to…" in a journal entry, or add one here.</div>';
  } else {
    up.slice(0, 8).forEach(function (r) {
      var late = (+r.dueAt || 0) < Date.now();
      h += '<div class="li" style="align-items:flex-start">'
        + '<div class="grow"><div class="nm">' + esc(r.text || "") + '</div>'
        + '<div class="sub"' + (late ? ' style="color:var(--danger)"' : '') + '>' + esc(rmWhen(r.dueAt)) + '</div></div>'
        + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="rmEdit(\'' + r.id + '\')">✎</button></div>';
    });
    if (up.length > 8) h += '<div class="sub" style="padding:4px 2px">+ ' + (up.length - 8) + ' more</div>';
  }
  return h + '</div>';
}

if (typeof window !== "undefined") window.rmEdit = function (id) {
  var r = id ? actReminders().find(function (x) { return x.id === id; }) : null;
  var due = r ? (+r.dueAt || Date.now()) : Date.now() + 3600000;
  modal(r ? "Reminder" : "New reminder", ''
    + '<label style="margin-top:0">Remind me to…</label>'
    + '<input id="rm_text" value="' + esc(r ? (r.text || "") : "") + '" placeholder="e.g. send Mike the invoice" autofocus>'
    + '<div class="row" style="gap:8px"><div class="grow"><label>Day</label><input id="rm_date" type="date" value="' + esc(rmDateOf(due)) + '"></div>'
    + '<div class="grow"><label>Time</label><input id="rm_time" type="time" value="' + esc(rmTimeOf(due)) + '"></div></div>'
    + (r && r.fired ? '<div class="sub" style="margin-top:8px">Already sent ' + esc(rmWhen(r.firedAt || r.dueAt)) + '. Changing the time will send it again.</div>' : '')
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="rmSave(\'' + (id || "") + '\')">Save</button>'
    + (r ? '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="rmDel(\'' + r.id + '\')">Delete</button>' : ''));
  setTimeout(function () { var el = document.getElementById("rm_text"); if (el) el.focus(); }, 60);
};

if (typeof window !== "undefined") window.rmSave = function (id) {
  var text = (typeof val === "function" ? val("rm_text") : "").trim();
  if (!text) { alert("What should it say?"); return; }
  var when = rmDueAt(val("rm_date"), val("rm_time"));
  if (!when) { alert("Pick a day."); return; }
  var d = D(); if (!Array.isArray(d.reminders)) d.reminders = [];
  var r = id ? d.reminders.find(function (x) { return x && x.id === id; }) : null;
  if (!r) {
    var me = (typeof curUser === "function") ? curUser() : null;
    r = { id: "rm_" + (typeof uid === "function" ? uid() : String(Date.now())), userId: (me && me.id) || "" };
    d.reminders.push(r);
  }
  /* moving the time re-arms it — otherwise a fired reminder could never be reused */
  if (r.fired && (+r.dueAt || 0) !== when) { r.fired = false; r.firedAt = 0; }
  r.text = text.slice(0, 500);
  r.dueAt = when;
  r.deleted = false;
  if (typeof touch === "function") touch(r);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") window.rmDel = function (id) {
  if (!confirm("Delete this reminder?")) return;
  var r = actReminders().find(function (x) { return x.id === id; }); if (!r) return;
  r.deleted = true;
  if (typeof touch === "function") touch(r);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") {
  window.actReminders = actReminders;
  window.rmUpcoming = rmUpcoming;
  window.rmCardHTML = rmCardHTML;
  window.rmDueAt = rmDueAt;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { rmDueAt: rmDueAt, rmDateOf: rmDateOf, rmTimeOf: rmTimeOf };
}
