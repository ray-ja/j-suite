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

/* ---- BILLS ON THE CALENDAR --------------------------------------------------------------------------
   Ray, 2026-08-05: "map out my personal finances on the calendar... note which days which things are due,
   car insurance, the electric bill... so nothing's gonna catch us off guard."

   Bills live in budgetBills (js/79) with a dueDay; this only READS them, so there is one source of truth and
   editing a bill in Budget updates the calendar. They render distinctly from events (💵 vs a dot) because
   "the rent leaves on the 13th" and "Brooke's birthday" are different kinds of fact. */
function calBills() {
  try {
    return (D().budgetBills || []).filter(function (b) { return b && !b.deleted && b.active !== false; });
  } catch (e) { return []; }
}
/* ⚠️ A BILL'S FREQUENCY IS NOT DECORATION. This used to match on dueDay alone, so EVERY bill landed once a
   month whatever its frequency said — a quarterly bill appeared monthly, an annual one appeared monthly, and
   the "next 2 weeks" total on Today was inflated by money that isn't actually due. Ray's own store has a
   yearly bill (Polk County property tax, nextDue 2027-03-01) that was showing on the 1st of every month.

   Now: one-time and multi-month bills land on their `nextDue` DATE and nowhere else. Monthly and weekly keep
   their day rule.

   ⚠️ The fallback matters: a non-monthly bill with NO nextDue carries no information about which month it
   belongs to, so it keeps the old monthly behaviour rather than vanishing. Losing a bill off his radar is
   worse than showing it too often — but a one-time bill has no fallback, because a one-time bill with no
   date isn't a date at all. */
function calBillsOnDay(iso) {
  var dd = +iso.slice(8, 10);
  var y = +iso.slice(0, 4), mo = +iso.slice(5, 7);
  var dim = new Date(y, mo, 0).getDate();
  return calBills().filter(function (b) {
    var f = String(b.frequency || "monthly");
    if (f === "once") return b.nextDue === iso;                    // the one day it is ever due
    if (f !== "monthly" && f !== "weekly" && b.nextDue) return b.nextDue === iso;
    if (f === "weekly") {
      var wd = new Date(Date.UTC(y, mo - 1, dd)).getUTCDay();
      return wd === (((+b.dueDay || 0) % 7) + 7) % 7;
    }
    var d = Math.min(Math.max(1, +b.dueDay || 1), dim);   // a day-31 bill lands on the 28th in February
    return d === dd;
  });
}
function calMoney(n) { return "$" + (Math.round(n * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

/* what is due between today and `days` out — the "no surprises" surface */
function calBillsDueSoon(days) {
  var out = [], t = evTodayUTC();
  for (var i = 0; i <= (days == null ? 14 : days); i++) {
    var iso = evISO(t + i * 86400000);
    calBillsOnDay(iso).forEach(function (b) { out.push({ iso: iso, days: i, b: b }); });
  }
  return out;
}
function calBillsCardHTML(days) {
  var due = calBillsDueSoon(days == null ? 14 : days);
  if (!due.length) return "";
  var total = due.reduce(function (a, x) { return a + (+x.b.amount || 0); }, 0);
  return '<div class="card"><div class="row" style="gap:8px;align-items:flex-start">'
    + '<div class="grow"><div class="nm">💵 Bills due in the next ' + (days == null ? 14 : days) + ' days</div>'
    + '<div class="sub" style="margin-top:2px">' + calMoney(total) + ' in total</div>'
    + due.map(function (x) {
        var soon = x.days <= 3;
        return '<div class="row" style="gap:6px;align-items:baseline;margin-top:5px">'
          + '<div class="grow" style="font-size:13.5px' + (soon ? ';font-weight:700' : '') + '">' + esc(x.b.name || "bill") + '</div>'
          + '<div class="sub" style="flex:0 0 auto;font-size:11.5px">' + calMoney(+x.b.amount || 0) + '</div>'
          + '<div class="sub" style="flex:0 0 auto;font-size:11.5px;min-width:64px;text-align:right'
          + (soon ? ';color:var(--danger);font-weight:700' : '') + '">'
          + (x.days === 0 ? "today" : x.days === 1 ? "tomorrow" : "in " + x.days + "d") + '</div></div>'
          + (x.b.note ? '<div class="sub" style="white-space:normal;font-size:11px;margin-top:1px">' + esc(x.b.note) + '</div>' : '');
      }).join("")
    + '</div><button class="btn ghost sm" style="flex:0 0 auto" onclick="if(typeof navSub===\'function\')navSub(\'cal\')">Open</button></div></div>';
}
if (typeof window !== "undefined") { window.calBillsOnDay = calBillsOnDay; window.calBillsCardHTML = calBillsCardHTML; window.calBillsDueSoon = calBillsDueSoon; }

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

/* ---- MONTH VIEW ------------------------------------------------------------------------------------
   Ray asked "do we have a calendar view tab" — the tab existed but rendered an agenda list, which is not
   what a calendar view means. This is the grid. Mobile-first: seven narrow columns, a dot per event, and a
   tap on any day opens that day. Annual items resolve by month+day so a birthday shows in every year's grid. */
var CAL_VIEW = "month";        // "month" | "list"
var CAL_YM = null;             // the displayed month, "YYYY-MM"; null = the current one
var CAL_DOW = ["S", "M", "T", "W", "T", "F", "S"];
var CAL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function calYM() {
  if (CAL_YM) return CAL_YM;
  var t = evISO(evTodayUTC());
  return t.slice(0, 7);
}
if (typeof window !== "undefined") {
  window.calSetView = function (v) { CAL_VIEW = v; if (typeof render === "function") render(); };
  window.calShiftMonth = function (delta) {
    var ym = calYM(), y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + delta;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    CAL_YM = y + "-" + String(m + 1).padStart(2, "0");
    if (typeof render === "function") render();
  };
  window.calToday = function () { CAL_YM = null; if (typeof render === "function") render(); };
}

/* every event landing on a given ISO day — annual ones match month+day in ANY year */
function evOnDay(iso) {
  var mm = iso.slice(5, 7), dd = iso.slice(8, 10);
  return actEvents().filter(function (e) {
    var d = String(e.date || ""); if (d.length < 10) return false;
    return e.annual ? (d.slice(5, 7) === mm && d.slice(8, 10) === dd) : (d.slice(0, 10) === iso);
  });
}

function calMonthHTML() {
  var ym = calYM(), y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
  var first = new Date(Date.UTC(y, m, 1)).getUTCDay();          // 0=Sun
  var days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  var todayISO = evISO(evTodayUTC());

  var h = '<div class="card"><div class="row" style="gap:6px;align-items:center;margin-bottom:8px">'
    + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="calShiftMonth(-1)">‹</button>'
    + '<div class="grow" style="text-align:center;font-weight:800;font-size:15px">' + CAL_MONTHS[m] + ' ' + y + '</div>'
    + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="calShiftMonth(1)">›</button></div>';

  h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
  CAL_DOW.forEach(function (d) {
    h += '<div class="sub" style="text-align:center;font-size:10.5px;font-weight:700;padding:2px 0">' + d + '</div>';
  });
  for (var i = 0; i < first; i++) h += '<div></div>';            // lead-in blanks
  for (var day = 1; day <= days; day++) {
    var iso = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    var evs = evOnDay(iso), bills = calBillsOnDay(iso), isToday = iso === todayISO;
    h += '<div onclick="calOpenDay(\'' + iso + '\')" style="min-height:40px;padding:3px 1px 2px;text-align:center;border-radius:7px;cursor:pointer;'
      + (isToday ? 'background:var(--accent);color:var(--accent-ink,#fff);font-weight:800;' : ((evs.length || bills.length) ? 'background:var(--soft,rgba(0,0,0,.05));' : ''))
      + '">'
      + '<div style="font-size:12.5px;line-height:1.2">' + day + '</div>'
      + ((evs.length || bills.length)
          ? '<div style="display:flex;gap:2px;justify-content:center;align-items:center;margin-top:2px">'
            + evs.slice(0, 3).map(function () {
                return '<span style="width:5px;height:5px;border-radius:50%;background:' + (isToday ? 'var(--accent-ink,#fff)' : 'var(--accent)') + ';display:inline-block"></span>';
              }).join("")
            + (bills.length ? '<span style="font-size:8px;line-height:1;opacity:.85">💵</span>' : '')
            + '</div>'
          : '')
      + '</div>';
  }
  h += '</div></div>';

  /* what's in THIS month, under the grid, so the view is useful without tapping */
  var inMonth = [];
  for (var d2 = 1; d2 <= days; d2++) {
    var iso2 = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d2).padStart(2, "0");
    evOnDay(iso2).forEach(function (e) { inMonth.push({ iso: iso2, e: e }); });
  }
  /* the money side of the month, day by day */
  var billRows = [];
  for (var d3 = 1; d3 <= days; d3++) {
    var iso3 = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d3).padStart(2, "0");
    calBillsOnDay(iso3).forEach(function (b) { billRows.push({ iso: iso3, b: b }); });
  }
  if (billRows.length) {
    var mTotal = billRows.reduce(function (a, x) { return a + (+x.b.amount || 0); }, 0);
    h += '<div class="secthd" style="margin-top:12px"><h2>💵 Bills this month</h2><span class="ct">' + calMoney(mTotal) + '</span></div>'
      + '<div class="card" style="padding:6px 10px">' + billRows.map(function (x) {
        var past = x.iso < todayISO;
        return '<div class="row" style="gap:6px;align-items:baseline;padding:4px 0' + (past ? ';opacity:.45' : '') + '">'
          + '<div class="sub" style="flex:0 0 34px;font-size:11.5px">' + x.iso.slice(8, 10) + (past ? ' ✓' : '') + '</div>'
          + '<div class="grow" style="font-size:13.5px">' + esc(x.b.name || "bill") + '</div>'
          + '<div style="flex:0 0 auto;font-weight:700;font-size:13px">' + calMoney(+x.b.amount || 0) + '</div></div>'
          + (x.b.note ? '<div class="sub" style="white-space:normal;font-size:11px;margin:-2px 0 4px 34px">' + esc(x.b.note) + '</div>' : '');
      }).join("") + '</div>';
  }
  if (inMonth.length) {
    h += '<div class="card" style="padding:6px 10px">' + inMonth.map(function (x) {
      return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openEvent(\'' + x.e.id + '\')">'
        + '<div class="grow"><div class="nm">' + esc(evLabel(x.e)) + '</div>'
        + '<div class="sub">' + esc((typeof fmtDate === "function") ? fmtDate(x.iso) : x.iso)
        + (x.iso === todayISO ? ' · today' : '') + '</div>'
        + (x.e.note ? '<div class="sub" style="white-space:normal;margin-top:2px">' + esc(x.e.note) + '</div>' : '')
        + '</div></div>';
    }).join("") + '</div>';
  } else {
    h += '<div class="muted" style="text-align:center;font-size:13px;padding:6px 0">Nothing this month.</div>';
  }
  return h;
}

/* tapping a day: show it, and offer to add on that date */
if (typeof window !== "undefined") window.calOpenDay = function (iso) {
  var evs = evOnDay(iso), bills = calBillsOnDay(iso);
  var pretty = (typeof fmtDate === "function") ? fmtDate(iso) : iso;
  modal(pretty,
    (evs.length
      ? evs.map(function (e) {
          return '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="closeModal();openEvent(\'' + e.id + '\')">'
            + '<div class="grow"><div class="nm">' + esc(evLabel(e)) + '</div>'
            + (e.annual ? '<div class="sub">every year</div>' : '')
            + (e.note ? '<div class="sub" style="white-space:normal">' + esc(e.note) + '</div>' : '')
            + '</div></div>';
        }).join("")
      : '')
    + (bills.length
        ? bills.map(function (b) {
            return '<div class="li" style="align-items:flex-start"><div class="grow"><div class="nm">💵 ' + esc(b.name || "bill") + '</div>'
              + '<div class="sub">' + calMoney(+b.amount || 0) + ' · every month</div>'
              + (b.note ? '<div class="sub" style="white-space:normal">' + esc(b.note) + '</div>' : '') + '</div></div>';
          }).join("")
        : '')
    + ((!evs.length && !bills.length) ? '<div class="muted" style="font-size:13px">Nothing on this day.</div>' : '')
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="closeModal();openEventOn(\'' + iso + '\')">+ Add on this day</button>');
};
if (typeof window !== "undefined") window.openEventOn = function (iso) {
  window.openEvent(null);
  setTimeout(function () { var el = document.getElementById("ev_date"); if (el) el.value = iso; }, 80);
};

/* ---- the tab ---- */
function rCal() {
  var all = actEvents().map(function (e) { return { e: e, d: evDaysAway(e) }; })
    .filter(function (x) { return x.d != null; })
    .sort(function (a, b) { return a.d - b.d; });
  var future = all.filter(function (x) { return x.d >= 0; });
  var h = '<div class="secthd"><h2>📅 Calendar</h2><span class="ct">' + future.length + '</span>'
    + '<button class="btn ghost sm" style="margin-left:auto" onclick="openEvent(null)">+ Add</button></div>';
  h += '<div class="subnav">'
    + '<button class="subbtn ' + (CAL_VIEW === "month" ? "on" : "") + '" onclick="calSetView(\'month\')">🗓 Month</button>'
    + '<button class="subbtn ' + (CAL_VIEW === "list" ? "on" : "") + '" onclick="calSetView(\'list\')">📋 Upcoming</button>'
    + '</div>';
  if (CAL_VIEW === "month") {
    h += calMonthHTML();
    if (calYM() !== evISO(evTodayUTC()).slice(0, 7))
      h += '<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="calToday()">Back to this month</button>';
    view.innerHTML = h;
    return;
  }
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
  window.evOnDay = evOnDay; window.calMonthHTML = calMonthHTML;
}
if (typeof module !== "undefined" && module.exports) module.exports = { evNextISO: evNextISO, evDaysAway: evDaysAway, evCountdown: evCountdown };
