/* ---------- TODAY'S LIST, MADE WORKABLE (js/168) ---------------------------------------------------------
   Ray, 2026-08-27: "the to do list items there on today I would like it to be more interactive… at the
   bottom something that lets me search / add a new one, so I can start typing. It searches my to do list. I
   can select one to slot in. If it doesn't exist yet, I can just hit enter and create it… the ones that are
   already on there, I would like to be able to set dates for them… It'd be cool if I could just drag them
   onto the calendar… and I need to be able to delete them without actually checking them off. Sometimes I
   just have to delete something instead of mark that it was done."

   ⭐⭐ SCHEDULING SETS `planDate`, NEVER `due`. This is the decision the whole module turns on.
     · `due`      — a deadline. Something outside him closes on that date. It drives "overdue", it drives the
                    hard-deadline countdown, and it is a fact about the world.
     · `planDate` — the day HE intends to do it. A fact about his week, and the one he rearranges.
   "Sometimes I gotta rearrange things" is planDate, every time. If dragging a to-do rewrote `due`, then
   moving "truck registration" off a busy Tuesday would quietly move the DEADLINE — and for the one class of
   item where the date is real (hardDeadline), that is the exact field that must not move. Measured on his
   store first: 3 of his to-dos carry a `due`, 0 carry a `planDate`, so nothing here disturbs existing data.

   ⚠️ AND THE CALENDAR HAD TO LEARN THE SAME THING, or dragging would be a lie. js/163 read to-dos by `due`
   only, so a to-do dragged onto the 3rd would vanish from Today and appear nowhere. It now places a to-do on
   `planDate || due` — ONE entry, the scheduled day winning when he has picked one. The deadline is still in
   the record and Today still says "overdue" off `due`; showing both dates would mean one to-do appearing
   twice on a calendar, which is noise rather than information.

   ⛔ NO CONFIRM ON DELETE, AN UNDO INSTEAD. He said "sometimes I just have to delete something" — that is a
   fast action, and a modal asking whether he meant it makes the fast action slow every single time to guard
   against a mistake that is already recoverable. The delete is a soft delete (as everything in this app is),
   and an Undo row appears in the card itself rather than in a toast that disappears after three seconds.

   ⚠️ THE SEARCH BOX MUST NOT CALL render() ON KEYSTROKE. render() rebuilds the page, which destroys the input
   and its cursor — the box would drop focus after every letter. Typing updates only the results list, by
   id, in place. A full render happens exactly twice: when he picks something and when he creates something,
   and both refocus the box so he can add several in a row. */

var TTD_Q = "";               // what he has typed
var TTD_SEL = 0;              // which result row is highlighted
var TTD_DATE_OPEN = {};       // todo id -> is the date row expanded
var TTD_UNDO = null;          // {id, title} of the last delete, for the Undo row
var TTD_MAX = 6;              // results shown at once

function ttdToday() { try { return (typeof today === "function") ? today() : ""; } catch (e) { return ""; } }
function ttdAll() {
  try {
    if (typeof actTodo === "function") return actTodo();
    return (D().todos || []).filter(function (x) { return x && !x.deleted; });
  } catch (e) { return []; }
}
function ttdById(id) {
  try { return (D().todos || []).find(function (x) { return x && x.id === id; }) || null; } catch (e) { return null; }
}
/* ⭐ IS THIS ITEM ALREADY ON THE CARD? — ASKED, NOT RE-DERIVED.
   ⚠️ My first version restated phPlanItems' rule (planDate <= today || due <= today) and was wrong on his
   real list within a minute of rendering it. phPlanItems has a FALLBACK: when nothing is explicitly planned
   it shows every open item, which is exactly his situation today — so the search offered to "slot in" a
   to-do he was looking at three rows above. Two copies of one rule, and the copy didn't know about the
   branch. Call the function instead; it is the thing that decides what's on the page. */
function ttdOnToday(td) {
  if (!td || td.done) return false;
  try {
    if (typeof phPlanItems === "function") {
      return phPlanItems().some(function (x) { return x && x.id === td.id; });
    }
  } catch (e) {}
  var t = ttdToday();
  if (td.planDate && String(td.planDate) <= t) return true;
  if (td.due && String(td.due) <= t) return true;
  return false;
}

/* ---------- the search / add box ---------- */
function ttdMatches(q) {
  var s = String(q || "").trim().toLowerCase();
  if (!s) return [];
  return ttdAll().filter(function (x) {
    return !x.done && String(x.title || "").toLowerCase().indexOf(s) >= 0;
  }).slice(0, TTD_MAX);
}
/* an exact title match, so Enter never silently creates a second copy of something he already has */
function ttdExact(q) {
  var s = String(q || "").trim().toLowerCase();
  if (!s) return null;
  return ttdAll().filter(function (x) { return !x.done && String(x.title || "").trim().toLowerCase() === s; })[0] || null;
}

/* the rows below the input. Built as a string and dropped into #ttd-res on every keystroke — no render(). */
function ttdResultsHTML() {
  var q = String(TTD_Q || "").trim();
  if (!q) return "";
  var m = ttdMatches(q);
  var rows = m.map(function (x, i) {
    var on = ttdOnToday(x);
    return '<div class="ttd-r' + (i === TTD_SEL ? " sel" : "") + (on ? " off" : "") + '"'
      + (on ? '' : ' onclick="ttdPick(\'' + esc(x.id) + '\')"') + '>'
      + '<div class="ttd-rt">' + esc(x.title || "(untitled)") + '</div>'
      + '<div class="ttd-rm">' + (on ? "already on today" : (x.due ? "due " + esc(x.due) : "slot in")) + '</div>'
      + '</div>';
  }).join("");
  /* ⛔ the create row is ALWAYS offered unless the title already exists exactly — "if it doesn't exist yet,
     I can just hit enter and create it", and he can also create something whose name merely resembles one
     he already has. An exact duplicate is the only case worth refusing. */
  var dup = ttdExact(q);
  if (!dup) {
    var ci = m.length;
    rows += '<div class="ttd-r ttd-new' + (ci === TTD_SEL ? " sel" : "") + '" onclick="ttdCreate()">'
      + '<div class="ttd-rt">＋ Create “' + esc(q) + '”</div>'
      + '<div class="ttd-rm">new, on today</div></div>';
  }
  return rows;
}

function ttdSearchHTML() {
  var h = '<div class="ttd-add">'
    + '<input id="ttd-q" class="ttd-in" autocomplete="off" placeholder="Search your list, or type something new…"'
    +   ' value="' + esc(TTD_Q) + '"'
    +   ' oninput="ttdInput(this.value)" onkeydown="ttdKey(event)">'
    + '<div id="ttd-res" class="ttd-res">' + ttdResultsHTML() + '</div>'
    + '</div>';
  return h;
}

/* ---------- what each row on Today gains ---------- */
var TTD_QUICK = [
  { k: "today", label: "Today", days: 0 },
  { k: "tmrw", label: "Tomorrow", days: 1 },
  { k: "wk", label: "+1 week", days: 7 }
];
function ttdShift(iso, n) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); if (!m) return "";
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (n || 0)));
  return d.toISOString().slice(0, 10);
}

/* the two small controls on the right of a to-do row, plus the date panel when it's open.
   ⛔ These stay visible rather than hiding behind an edit mode: they are per-ITEM actions on a list he is
   working through, not page furniture. The edit-mode lesson was about six layout buttons on every card. */
function ttdRowCtrlHTML(td) {
  return '<div class="ttd-ctl">'
    + '<button title="When are you doing this?" onclick="event.stopPropagation();ttdDateToggle(\'' + esc(td.id) + '\')">📅</button>'
    + '<button title="Delete — this is not the same as done" class="ttd-x"'
    +   ' onclick="event.stopPropagation();ttdDelete(\'' + esc(td.id) + '\')">✕</button>'
    + '</div>';
}
function ttdDateRowHTML(td) {
  if (!TTD_DATE_OPEN[td.id]) return "";
  var t = ttdToday();
  var cur = td.planDate || "";
  var h = '<div class="ttd-dates" onclick="event.stopPropagation()">'
    + TTD_QUICK.map(function (q) {
        var iso = ttdShift(t, q.days);
        return '<button class="ttd-chip' + (cur === iso ? " on" : "") + '"'
          + ' onclick="ttdSchedule(\'' + esc(td.id) + '\',\'' + esc(iso) + '\')">' + esc(q.label) + '</button>';
      }).join("")
    + '<input type="date" class="ttd-date" value="' + esc(cur) + '"'
    +   ' onchange="ttdSchedule(\'' + esc(td.id) + '\',this.value)">'
    + (cur ? '<button class="ttd-chip" onclick="ttdSchedule(\'' + esc(td.id) + '\',\'\')">Clear</button>' : '')
    /* ⭐ the deadline is shown here but NOT editable from this row — it is a different fact, it lives in the
       to-do editor, and a date control that silently moved it would be the bug this module was built to avoid */
    + (td.due ? '<span class="ttd-due">deadline ' + esc(td.due) + '</span>' : '')
    + '</div>';
  return h;
}

/* the Undo row, shown only right after a delete */
function ttdUndoHTML() {
  if (!TTD_UNDO) return "";
  return '<div class="ttd-undo">Deleted “' + esc(String(TTD_UNDO.title || "").slice(0, 48)) + '”'
    + '<button onclick="ttdUndo()">↩ Undo</button></div>';
}

if (typeof window !== "undefined") {
  window.ttdSearchHTML = ttdSearchHTML; window.ttdRowCtrlHTML = ttdRowCtrlHTML;
  window.ttdDateRowHTML = ttdDateRowHTML; window.ttdUndoHTML = ttdUndoHTML;
  window.ttdResultsHTML = ttdResultsHTML; window.ttdMatches = ttdMatches; window.ttdOnToday = ttdOnToday;
  window.ttdExact = ttdExact; window.ttdShift = ttdShift;

  /* ⚠️ IN PLACE, NOT render(). Rebuilding the page on keystroke destroys the input and the caret with it. */
  function ttdPaint() {
    try {
      var box = document.getElementById("ttd-res");
      if (box) box.innerHTML = ttdResultsHTML();
    } catch (e) {}
  }
  function ttdRefocus() {
    setTimeout(function () {
      try {
        var el = document.getElementById("ttd-q");
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      } catch (e) {}
    }, 30);
  }
  window.ttdInput = function (v) { TTD_Q = v; TTD_SEL = 0; ttdPaint(); };

  window.ttdKey = function (ev) {
    if (!ev) return;
    var m = ttdMatches(TTD_Q), n = m.length + (ttdExact(TTD_Q) ? 0 : 1);
    if (ev.key === "ArrowDown") { ev.preventDefault(); TTD_SEL = Math.min(n - 1, TTD_SEL + 1); ttdPaint(); return; }
    if (ev.key === "ArrowUp") { ev.preventDefault(); TTD_SEL = Math.max(0, TTD_SEL - 1); ttdPaint(); return; }
    if (ev.key === "Escape") { TTD_Q = ""; TTD_SEL = 0; ttdPaint(); return; }
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    /* ⭐ ENTER TAKES THE HIGHLIGHTED ROW — which is the create row when nothing matched, so "just hit enter
       and create it" works exactly as he described, and picking an existing one never needs the mouse. */
    if (TTD_SEL < m.length) {
      var pick = m[TTD_SEL];
      if (pick && !ttdOnToday(pick)) return window.ttdPick(pick.id);
      return;
    }
    window.ttdCreate();
  };

  /* slot an existing to-do onto today = plan it for today. ⛔ Never touches its deadline. */
  window.ttdPick = function (id) {
    var td = ttdById(id); if (!td) return;
    td.planDate = ttdToday();
    td.done = false;
    if (typeof touch === "function") touch(td);
    if (typeof logChange === "function") logChange("update", "todo", td.id, "Planned for today: " + (td.title || ""));
    TTD_Q = ""; TTD_SEL = 0;
    if (typeof save === "function") save();
    if (typeof toast === "function") toast("On today’s list");
    if (typeof render === "function") render();
    ttdRefocus();
  };

  window.ttdCreate = function () {
    var title = String(TTD_Q || "").trim();
    if (!title) return;
    var dup = ttdExact(title);
    if (dup) return window.ttdPick(dup.id);        // never make a second copy of the same thing
    try {
      var d = D(); if (!Array.isArray(d.todos)) d.todos = [];
      var td = { id: (typeof uid === "function" ? "todo-" + uid() : "todo-" + Date.now()),
                 title: title, priority: "Medium", done: false, planDate: ttdToday(), deleted: false };
      if (typeof touch === "function") touch(td);
      d.todos.push(td);
      if (typeof logChange === "function") logChange("create", "todo", td.id, "Added to-do " + title);
      TTD_Q = ""; TTD_SEL = 0;
      if (typeof save === "function") save();
      if (typeof toast === "function") toast("Added");
      if (typeof render === "function") render();
      ttdRefocus();
    } catch (e) { alert("Couldn't add that: " + ((e && e.message) || e)); }
  };

  window.ttdDateToggle = function (id) {
    TTD_DATE_OPEN[id] = !TTD_DATE_OPEN[id];
    if (typeof render === "function") render();
  };

  /* ⭐ THE ONE WRITE THAT SCHEDULING DOES. planDate only. */
  window.ttdSchedule = function (id, iso) {
    var td = ttdById(id); if (!td) return;
    td.planDate = iso || "";
    if (typeof touch === "function") touch(td);
    if (typeof logChange === "function") {
      logChange("update", "todo", td.id, iso ? ("Planned " + iso + ": " + (td.title || "")) : ("Unscheduled " + (td.title || "")));
    }
    TTD_DATE_OPEN[id] = false;
    if (typeof save === "function") save();
    if (typeof toast === "function") toast(iso ? ("Planned for " + iso) : "Date cleared");
    if (typeof render === "function") render();
  };

  /* ⛔ DELETE IS NOT DONE. Ray was explicit that these are different things — ticking it says the work
     happened, and sometimes the work simply isn't going to. Soft delete, with Undo sitting in the card. */
  window.ttdDelete = function (id) {
    var td = ttdById(id); if (!td) return;
    td.deleted = true;
    if (typeof touch === "function") touch(td);
    if (typeof logChange === "function") logChange("delete", "todo", td.id, "Deleted to-do " + (td.title || ""));
    TTD_UNDO = { id: td.id, title: td.title || "" };
    if (typeof save === "function") save();
    if (typeof render === "function") render();
  };
  window.ttdUndo = function () {
    if (!TTD_UNDO) return;
    var td = ttdById(TTD_UNDO.id);
    if (td) {
      td.deleted = false;
      if (typeof touch === "function") touch(td);
      if (typeof logChange === "function") logChange("update", "todo", td.id, "Restored to-do " + (td.title || ""));
      if (typeof save === "function") save();
    }
    TTD_UNDO = null;
    if (typeof render === "function") render();
  };

  /* ---------- ⭐ DRAG ONTO THE CALENDAR ------------------------------------------------------------------
     "It'd be cool if I could just drag them onto the calendar. That'd be really awesome. if it's possible.
     If not, then I'll set the date on it."
     ⚠️ IT IS THE BONUS PATH, NOT THE PATH. HTML5 drag doesn't fire from touch, so on the phone — where he
     actually works — this does nothing, and the 📅 button above is the real answer. I said in js/164 that
     arrows beat drag-and-drop, and that still holds for anything that is the ONLY way to do a thing. Here
     every drag has an identical two-tap equivalent, so it costs nothing and he gets the gesture he wanted
     on the machine that can do it. */
  window.ttdDragStart = function (ev, id) {
    try {
      ev.dataTransfer.setData("text/plain", "todo:" + id);
      ev.dataTransfer.effectAllowed = "move";
      document.body.classList.add("ttd-dragging");
    } catch (e) {}
  };
  window.ttdDragEnd = function () {
    try { document.body.classList.remove("ttd-dragging"); } catch (e) {}
  };
  window.ttdDragOver = function (ev) {
    try {
      var d = ev.dataTransfer && ev.dataTransfer.types;
      if (!d) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.add("ttd-over");
    } catch (e) {}
  };
  window.ttdDragLeave = function (ev) {
    try { if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.remove("ttd-over"); } catch (e) {}
  };
  window.ttdDrop = function (ev, iso) {
    try {
      ev.preventDefault();
      if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.remove("ttd-over");
      document.body.classList.remove("ttd-dragging");
      var raw = ev.dataTransfer.getData("text/plain") || "";
      if (raw.indexOf("todo:") !== 0) return;
      window.ttdSchedule(raw.slice(5), iso);
    } catch (e) {}
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { TTD_MAX: TTD_MAX };
