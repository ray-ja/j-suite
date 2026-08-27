/* ---------- THE ROUTINE, DONE IN PLACE (js/166) ---------------------------------------------------------
   Ray, 2026-08-27, going through Today line by line:
     · "let me fill out the how are you feeling box right there in place… without me having to leave the
        today's screen. Once I fill it out, the lid would disappear."
     · "click on a button right there where it says workout to actually access my workout app… maybe you
        could even pull from the workout app and just tell me what kind of major lift today is."
     · "I tend to do them using voice. I just like to talk… if the little talk button was right there."

   ⭐ THE PRINCIPLE UNDERNEATH ALL THREE: a routine item that sends him somewhere else has already cost him
   the thing it was for. Opening a screen, writing, coming back and remembering to tick a box is four
   actions for one sentence about how he slept. Each of these does its whole job in the row it lives in.

   ⛔ AND FINISHING IS THE TICK. Writing the note IS doing the item — there is no second confirmation step,
   because a checkbox you have to remember to press after doing the work is just a way to be wrong about
   what you did. */

/* ---------- 1. how he's feeling, written where it's asked ---------- */
function riMoodOpen(id) { RI_OPEN[id] = true; if (typeof render === "function") render(); }
var RI_OPEN = {};

function riMoodHTML(r) {
  var id = "ri_mood_" + r.id;
  return '<div class="ri-inline">'
    + '<textarea id="' + id + '" class="ri-ta" rows="2" placeholder="how you woke up — a line is plenty"></textarea>'
    + '<div class="row" style="gap:6px;margin-top:6px">'
    +   ((typeof vjSecure === "function" && vjSecure())
        ? '<button class="btn ghost sm" style="width:auto" onclick="riTalk(\'' + esc(id) + '\')">🎤 Talk</button>' : '')
    +   '<button class="btn acc sm" style="flex:1" onclick="riMoodSave(\'' + esc(r.id) + '\',\'' + esc(id) + '\')">Save</button>'
    + '</div></div>';
}

/* ---------- 2. the workout, with what today actually is ---------- */
/* ⭐ WHICH DAY IS NEXT, from his own history. The plan is a rotation; the next day is the one after whatever
   he logged last. ⛔ Returns null rather than guessing when there's no plan or no history — "Workout" alone
   is honest, "Bench day" when it isn't is worse than saying nothing. */
function riNextWorkout() {
  try {
    var raw = (typeof wkRaw === "function") ? wkRaw() : null;
    if (!raw) return null;
    var days = (typeof wkPlanDays === "function") ? wkPlanDays(raw) : [];
    if (!days.length) return null;
    var sessions = (typeof wkSessions === "function") ? wkSessions(raw) : [];
    var idx = 0;
    if (sessions.length) {
      var lastId = sessions[0].dayId;
      var at = -1;
      days.forEach(function (d, i) { if (d.id === lastId) at = i; });
      idx = (at >= 0) ? (at + 1) % days.length : 0;
    }
    var d = days[idx];
    if (!d) return null;
    /* the "major lift" is the first exercise on the day — that is how a programme is written: the big
       compound leads, accessories follow. Not a guess about which is heaviest. */
    var first = (d.exercises || [])[0];
    return { day: d.day || d.id, label: d.label || "", lift: first ? (first.name || "") : "",
             lastDate: sessions.length ? sessions[0].date : "" };
  } catch (e) { return null; }
}

function riWorkoutHTML(r) {
  var w = riNextWorkout();
  return '<div class="ri-line">'
    + (w
        ? '<span class="ri-lift">' + esc(w.lift || w.day || "") + '</span>'
          + (w.label ? '<span class="sub"> · ' + esc(w.label) + '</span>' : '')
        : '<span class="sub">open it to see today\'s day</span>')
    + '<button class="btn acc sm ri-go" onclick="riWorkoutGo()">Open workout</button>'
    + '</div>';
}

/* ---------- 3. the journal, spoken ---------- */
function riJournalHTML(r) {
  var id = "ri_jrnl_" + r.id;
  var h = '<div class="ri-inline">';
  /* ⭐ the real voice recorder (js/131) if this device can do it — his own words, transcribed on the box's
     GPU, audio never leaving the house. Falls back to typing, which is what the textarea is for either way. */
  if (typeof vjBarHTML === "function" && typeof vjSecure === "function" && vjSecure()) h += vjBarHTML();
  h += '<textarea id="' + id + '" class="ri-ta" rows="3" placeholder="how the day actually went"></textarea>'
    + '<div class="row" style="gap:6px;margin-top:6px">'
    +   ((typeof vjSecure === "function" && vjSecure())
        ? '<button class="btn ghost sm" style="width:auto" onclick="riTalk(\'' + esc(id) + '\')">🎤 Talk</button>' : '')
    +   '<button class="btn acc sm" style="flex:1" onclick="riJournalSave(\'' + esc(r.id) + '\',\'' + esc(id) + '\')">Save entry</button>'
    + '</div></div>';
  return h;
}

/* ⭐ what an item renders BELOW its label, if anything. Keyed on the item's own `action`, so it follows him
   if he reorders or renames things. */
function riExtraHTML(r, done) {
  if (done) return "";                                   // finished items collapse to a struck-through line
  var a = (r && r.action) || "";
  if (a === "journal" && r.part === "morning") return riMoodHTML(r);
  if (a === "journal") return riJournalHTML(r);
  if (a === "workout") return riWorkoutHTML(r);
  return "";
}

if (typeof window !== "undefined") {
  window.riExtraHTML = riExtraHTML; window.riNextWorkout = riNextWorkout;
  window.riMoodHTML = riMoodHTML; window.riJournalHTML = riJournalHTML; window.riWorkoutHTML = riWorkoutHTML;

  window.riWorkoutGo = function () {
    try { location.href = (typeof WK_URL !== "undefined" ? WK_URL : "/workout.html"); } catch (e) {}
  };

  /* dictate into a specific field: focus it, then hand it to the existing dictation button (js/68) */
  window.riTalk = function (fieldId) {
    try {
      var el = document.getElementById(fieldId);
      if (el) { el.focus(); }
      var b = document.getElementById("dictbtn");
      if (b) b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    } catch (e) {}
  };

  /* ⛔ ONE WRITE, THEN TICK. The note is the work; the tick just records that the work happened. Doing them
     in the other order — or making him do the second one — is how a log stops matching reality. */
  function riSaveNote(routineId, fieldId, kind) {
    var el = document.getElementById(fieldId);
    var text = el ? String(el.value || "").trim() : "";
    if (!text) { if (el) el.focus(); return; }
    try {
      var d = D();
      d.lifeNotes = d.lifeNotes || [];
      var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
      var note = {
        id: "life-note-" + (typeof uid === "function" ? uid() : String(Date.now())),
        date: t,
        title: (typeof vjTitle === "function") ? vjTitle(text) : String(text).split(/[.\n]/)[0].slice(0, 60),
        body: text,
        kind: kind,                                   /* "mood" | "journal" — so a day's two entries stay distinct */
        deleted: false
      };
      if (typeof touch === "function") touch(note);
      d.lifeNotes.push(note);
      if (typeof rtTick === "function") rtTick(routineId);     // rtTick saves + renders
      else if (typeof save === "function") { save(); if (typeof render === "function") render(); }
      if (typeof toast === "function") toast(kind === "mood" ? "Noted" : "Journal entry saved");
    } catch (e) { alert("Couldn't save that: " + ((e && e.message) || e)); }
  }
  window.riMoodSave = function (rid, fid) { riSaveNote(rid, fid, "mood"); };
  window.riJournalSave = function (rid, fid) { riSaveNote(rid, fid, "journal"); };
}
if (typeof module !== "undefined" && module.exports) module.exports = { riNextWorkout: riNextWorkout };
