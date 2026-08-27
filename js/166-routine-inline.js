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
/* ⭐ WHICH DAY IS TODAY — AND HIS PLAN ANSWERS THAT DIRECTLY.
   ⚠️ I HAD THIS WRONG. My first version walked a rotation from his last logged session, which is how you'd
   read a programme that has no calendar attached. His does: reading workout.html, the days are keyed
   mon · tue · wed · thu · fri · sat, each already named ("Pull — Deadlift Focus"). So today's lift is simply
   today's weekday, and it is right whether or not he logged anything yesterday — which is exactly when a
   rotation guess would drift and start naming the wrong lift with total confidence.
   ⛔ Sunday isn't in the plan, so Sunday is a rest day and says so.
   ⛔ Falls back to the rotation only for a plan whose days AREN'T weekdays, and to null when there's no plan
   at all — "Workout" alone is honest; "Bench day" when it isn't is worse than saying nothing. */
var RI_DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function riNextWorkout() {
  try {
    var raw = (typeof wkRaw === "function") ? wkRaw() : null;
    if (!raw) return null;
    var days = (typeof wkPlanDays === "function") ? wkPlanDays(raw) : [];
    if (!days.length) return null;
    var sessions = (typeof wkSessions === "function") ? wkSessions(raw) : [];
    var lastDate = sessions.length ? sessions[0].date : "";

    /* is this a weekday-keyed plan? */
    var byId = {};
    days.forEach(function (d) { byId[String(d.id || "").toLowerCase()] = d; });
    var weekdayPlan = RI_DOW.some(function (k) { return !!byId[k]; });

    var d = null;
    if (weekdayPlan) {
      var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
      var dow = new Date(t + "T12:00:00").getDay();
      d = byId[RI_DOW[dow]] || null;
      if (!d) return { rest: true, day: "", label: "", lift: "", lastDate: lastDate };   // not in the plan = rest
    } else {
      var idx = 0;
      if (sessions.length) {
        var at = -1;
        days.forEach(function (x, i) { if (x.id === sessions[0].dayId) at = i; });
        idx = (at >= 0) ? (at + 1) % days.length : 0;
      }
      d = days[idx];
    }
    if (!d) return null;
    /* the "major lift" is the FIRST exercise on the day — that is how a programme is written: the big
       compound leads and the accessories follow. Not a guess about which is heaviest. */
    var first = (d.exercises || [])[0];
    return { rest: false, day: d.day || d.id, label: d.label || "",
             lift: first ? (first.name || "") : "", lastDate: lastDate };
  } catch (e) { return null; }
}

/* ⛔ SAY THE LIFT OR SAY NOTHING. Ray, 2026-08-27: "under workout it says 'open it to see today's day' —
   that doesn't even make any sense. that doesn't belong there."
   ⚠️ He is right, and it was filler I wrote for the case where the plan can't be read. It told him to open
   the app in order to learn something the app was supposed to be telling him — a label apologising for
   itself. When the lift is known it is worth a line; when it isn't, the button already says "Open workout"
   and that is the whole message. */
function riWorkoutHTML(r) {
  var w = riNextWorkout();
  return '<div class="ri-line">'
    + (!w ? ''
        : w.rest ? '<span class="sub">rest day — nothing programmed</span>'
        : '<span class="ri-lift">' + esc(w.lift || w.day || "") + '</span>'
          + (w.label ? '<span class="sub"> · ' + esc(w.label) + '</span>' : ''))
    + '<button class="btn acc sm ri-go" onclick="riWorkoutGo()">Open workout</button>'
    + '</div>';
}

/* ---------- 3. the journal — long-form, spoken, and NOT an evening thing ----------
   Ray, 2026-08-27: "journal entry doesnt have to be an evening thing. its just a once a day thing.
   sometimes i do it at lunch… journal is just long form how i feel or what im thinking about."
   ⛔ ONE TALK BUTTON, NOT TWO. "theres two large talk buttons on the journal entry area though we dont need
   both." The recorder bar (js/131) already has one, and it is the better one — it records properly and
   transcribes on this machine. The little browser-dictation button was a second door to the same room. */
function riJournalHTML(r) {
  var id = "ri_jrnl_" + r.id;
  var rec = (typeof vjBarHTML === "function" && typeof vjSecure === "function" && vjSecure());
  var h = '<div class="ri-inline">';
  if (rec) h += vjBarHTML();
  h += '<textarea id="' + id + '" class="ri-ta" rows="3" placeholder="what you\'re thinking about"></textarea>'
    + '<div class="row" style="gap:6px;margin-top:6px">'
    /* only offer the small dictation button when the real recorder ISN'T here */
    +   ((!rec && typeof vjSecure === "function" && vjSecure())
        ? '<button class="btn ghost sm" style="width:auto" onclick="riTalk(\'' + esc(id) + '\')">🎤 Talk</button>' : '')
    +   '<button class="btn acc sm" style="flex:1" onclick="riJournalSave(\'' + esc(r.id) + '\',\'' + esc(id) + '\')">Save entry</button>'
    + '</div></div>';
  return h;
}

/* ⭐ a short written box — the morning "how are you feeling" and the end-of-day review are the same shape:
   a line or two, typed or dictated, that ticks the item when saved. */
function riShortHTML(r, placeholder, button) {
  var id = "ri_short_" + r.id;
  return '<div class="ri-inline">'
    + '<textarea id="' + id + '" class="ri-ta" rows="2" placeholder="' + esc(placeholder) + '"></textarea>'
    + '<div class="row" style="gap:6px;margin-top:6px">'
    +   ((typeof vjSecure === "function" && vjSecure())
        ? '<button class="btn ghost sm" style="width:auto" onclick="riTalk(\'' + esc(id) + '\')">🎤 Talk</button>' : '')
    +   '<button class="btn acc sm" style="flex:1" onclick="riMoodSave(\'' + esc(r.id) + '\',\'' + esc(id) + '\')">' + esc(button) + '</button>'
    + '</div></div>';
}
function riMoodHTML(r)   { return riShortHTML(r, "how you woke up — a line is plenty", "Save"); }
function riReviewHTML(r) { return riShortHTML(r, "how the day actually went", "Save"); }

/* ⭐ WHAT AN ITEM RENDERS BELOW ITS LABEL. Keyed on the item's own `key` first — "feel", "journal",
   "review" — so it stays right wherever in the day he moves it. ⛔ NOT on which PART it's in: the journal
   was identified by sitting in the evening, and the moment he moves it to lunch that breaks. */
function riExtraHTML(r, done) {
  if (done) return "";                                   // finished items collapse to a struck-through line
  var k = String((r && r.key) || "").toLowerCase();
  var a = (r && r.action) || "";
  if (k === "feel") return riMoodHTML(r);
  if (k === "review" || k === "dayreview") return riReviewHTML(r);
  if (k === "journal" || a === "journal") return riJournalHTML(r);
  if (a === "workout") return riWorkoutHTML(r);
  return "";
}

if (typeof window !== "undefined") {
  window.riExtraHTML = riExtraHTML; window.riNextWorkout = riNextWorkout;
  window.riMoodHTML = riMoodHTML; window.riJournalHTML = riJournalHTML; window.riWorkoutHTML = riWorkoutHTML;
  window.riReviewHTML = riReviewHTML; window.riShortHTML = riShortHTML;

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
