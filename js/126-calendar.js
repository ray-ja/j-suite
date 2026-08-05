/* ---------- PERSONAL CALENDAR (js/126) -----------------------------------------------------------------
   Ray, 2026-08-05: "we do need a calendar, by the way. We need a personal calendar for sure" — said while
   holding his wife's birthday, a friend's birthday and a party date in his head at once, with the first of
   them eleven days out. That is the whole brief: get the dates out of his head.

   NOT js/09-schedule.js. That calendar is job-driven — it renders crew, jobs and availability, and there is
   nothing on it for a birthday. This is its own small collection on the personal org.

   ANNUAL BY DEFAULT FOR BIRTHDAYS. A birthday entered once should never need entering again, so `annual`
   items match on month+day and roll forward every year on their own.

   CONFIRMED vs NOT. He said of the party "I think it was the twenty second" — so an event can be marked
   unconfirmed and it renders with a "?" instead of quietly becoming a fact he plans around.

   Deliberately NOT a habit surface: no streaks, no completion, no "you didn't do this". A date passes and it
   just moves on. Reference + lead time, like the rest of the personal org. */

function actEvents() { return (D().personalEvents || []).filter(function (e) { return e && !e.deleted; }); }

/* ---- date helpers (UTC-normalised so a timezone offset can't shift a birthday by a day) ---- */
function evParse(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
function evTodayUTC() { var p = evParse((typeof today === "function") ? today() : ""); if (p != null) return p; var d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
function evISO(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }

/* the NEXT occurrence of an event — for an annual item that's this year's or next year's, never the past */
function evNextISO(e) {
  var base = evParse(e && e.date); if (base == null) return "";
  if (!e.annual) return evISO(base);
  var b = new Date(base), t = new Date(evTodayUTC());
  var cand = Date.UTC(t.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  if (cand < evTodayUTC()) cand = Date.UTC(t.getUTCFullYear() + 1, b.getUTCMonth(), b.getUTCDate());
  return evISO(cand);
}
function evDaysAway(e) {
  var n = evParse(evNextISO(e)); if (n == null) return null;
  return Math.round((n - evTodayUTC()) / 86400000);
}
function evCountdown(e) {
  var d = evDaysAway(e); if (d == null) return "";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 0) return (-d) + " days ago";
  return "in " + d + " days";
}
/* upcoming, soonest first. `within` days (default 60). */
function evUpcoming(within) {
  var lim = (within == null) ? 60 : within;
  return actEvents().map(function (e) { return { e: e, d: evDaysAway(e) }; })
    .filter(function (x) { return x.d != null && x.d >= 0 && x.d <= lim; })
    .sort(function (a, b) { return a.d - b.d; })
    .map(function (x) { return x.e; });
}
function evLabel(e) {
  return (e.title || "Something") + (e.confirmed === false ? " (?)" : "");
}
function evWhen(e) {
  var iso = evNextISO(e);
  return ((typeof fmtDate === "function") ? fmtDate(iso) : iso) + " · " + evCountdown(e);
}

/* ---- the card for the personal home page: only what's actually close ---- */
function evHomeCardHTML(within) {
  var up = evUpcoming(within == null ? 30 : within);
  if (!up.length) return "";
  return '<div class="card"><div class="row" style="gap:8px;align-items:flex-start">'
    + '<div class="grow"><div class="nm">📅 Coming up</div>'
    + up.slice(0, 5).map(function (e) {
        var d = evDaysAway(e), soon = d <= 7;
        return '<div class="row" style="gap:6px;align-items:baseline;margin-top:5px">'
          + '<div class="grow" style="font-size:13.5px' + (soon ? ';font-weight:700' : '') + '">' + esc(evLabel(e)) + '</div>'
          + '<div class="sub" style="flex:0 0 auto;font-size:11.5px' + (soon ? ';color:var(--danger);font-weight:700' : '') + '">' + esc(evCountdown(e)) + '</div></div>'
          + (e.note ? '<div class="sub" style="white-space:normal;font-size:11.5px;margin-top:1px">' + esc(e.note) + '</div>' : '');
      }).join("")
    + '</div><button class="btn ghost sm" style="flex:0 0 auto" onclick="if(typeof navSub===\'function\')navSub(\'cal\')">Open</button></div></div>';
}

/* ---- the tab ---- */
function rCal() {
  var all = actEvents().map(function (e) { return { e: e, d: evDaysAway(e) }; })
    .filter(function (x) { return x.d != null; })
    .sort(function (a, b) { return a.d - b.d; });
  var future = all.filter(function (x) { return x.d >= 0; });
  var h = '<div class="secthd"><h2>📅 Calendar</h2><span class="ct">' + future.length + '</span>'
    + '<button class="btn ghost sm" style="margin-left:auto" onclick="openEvent(null)">+ Add</button></div>';
  if (!future.length) {
    h += '<div class="empty"><div class="big">📅</div>Nothing coming up. Add a birthday once and it repeats every year.'
      + '<br><button class="btn ghost sm" style="margin-top:8px" onclick="openEvent(null)">+ Add a date</button></div>';
  } else {
    h += '<div class="card" style="padding:6px 10px">' + future.map(function (x) {
      var e = x.e, soon = x.d <= 7;
      return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openEvent(\'' + e.id + '\')">'
        + '<div class="grow"><div class="nm"' + (soon ? ' style="color:var(--danger)"' : '') + '>' + esc(evLabel(e))
        + (e.annual ? ' <span class="sub" style="font-weight:400">· every year</span>' : '') + '</div>'
        + '<div class="sub">' + esc(evWhen(e)) + '</div>'
        + (e.note ? '<div class="sub" style="white-space:normal;margin-top:2px">' + esc(e.note) + '</div>' : '')
        + '</div></div>';
    }).join("") + '</div>';
  }
  view.innerHTML = h;
}
if (typeof window !== "undefined") window.rCal = rCal;

/* ---- add / edit ---- */
if (typeof window !== "undefined") window.openEvent = function (id) {
  var e = id ? actEvents().find(function (x) { return x.id === id; }) : null;
  var isNew = !e;
  e = e || { id: "", date: (typeof today === "function") ? today() : "", title: "", note: "", annual: false, confirmed: true };
  modal(isNew ? "Add a date" : "Date", ''
    + '<label style="margin-top:0">What is it?</label><input id="ev_title" value="' + esc(e.title || "") + '" placeholder="e.g. Jess\'s birthday" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();saveEvent(\'' + (e.id || "") + '\');}">'
    + '<label>Date</label><input id="ev_date" type="date" value="' + esc(evNextISO(e) || e.date || "") + '">'
    + '<label>Note</label><input id="ev_note" value="' + esc(e.note || "") + '" placeholder="optional — e.g. wants floats for the sound" autocomplete="off" '
    + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();saveEvent(\'' + (e.id || "") + '\');}">'
    + '<label class="toggle" style="margin-top:10px"><input type="checkbox" id="ev_annual" ' + (e.annual ? "checked" : "") + '> Repeats every year</label>'
    + '<label class="toggle"><input type="checkbox" id="ev_unsure" ' + (e.confirmed === false ? "checked" : "") + '> Not sure about this date yet</label>'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="saveEvent(\'' + (e.id || "") + '\')">Save</button>'
    + (isNew ? '' : '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="delEvent(\'' + e.id + '\')">Delete</button>'));
  setTimeout(function () { var el = document.getElementById("ev_title"); if (el) el.focus(); }, 60);
};
if (typeof window !== "undefined") window.saveEvent = function (id) {
  var g = function (x) { var el = document.getElementById(x); return el ? (el.value || "").trim() : ""; };
  var ck = function (x) { var el = document.getElementById(x); return !!(el && el.checked); };
  var title = g("ev_title"); if (!title) { alert("Give it a name."); return; }
  var d = D(); if (!Array.isArray(d.personalEvents)) d.personalEvents = [];
  var e = id ? d.personalEvents.find(function (x) { return x && x.id === id; }) : null;
  if (!e) { e = { id: "pev_" + (typeof uid === "function" ? uid() : String(Date.now())) }; d.personalEvents.push(e); }
  e.title = title.slice(0, 80);
  e.date = g("ev_date") || ((typeof today === "function") ? today() : "");
  e.note = g("ev_note").slice(0, 160);
  e.annual = ck("ev_annual");
  e.confirmed = !ck("ev_unsure");
  e.deleted = false;
  if (typeof touch === "function") touch(e);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};
if (typeof window !== "undefined") window.delEvent = function (id) {
  if (!confirm("Delete this date?")) return;
  var e = (D().personalEvents || []).find(function (x) { return x && x.id === id; });
  if (e) { e.deleted = true; if (typeof touch === "function") touch(e); }
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") {
  window.actEvents = actEvents; window.evUpcoming = evUpcoming; window.evHomeCardHTML = evHomeCardHTML;
  window.evNextISO = evNextISO; window.evDaysAway = evDaysAway; window.evCountdown = evCountdown;
}
if (typeof module !== "undefined" && module.exports) module.exports = { evNextISO: evNextISO, evDaysAway: evDaysAway, evCountdown: evCountdown };
