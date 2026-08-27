/* ---------- CALENDAR ON TODAY (js/163) ------------------------------------------------------------------
   Ray, 2026-08-27: "i need my calendar on today page, i need month view showing this month + next, and also
   2x day view showing times for things happening today and tomorrow."

   Four panels, and each answers a different question:
     · this month + next month  — "when is the thing, and how far away"  (shape, not detail)
     · today + tomorrow, by the hour — "what am I doing and when"        (detail, not shape)

   ⚠️ NOTHING IN THIS APP HAD A TIME ON IT. personalEvents are birthdays and to-dos have a due DATE — every
   record was all-day. A day view of eleven all-day items is a list with extra lines, so `time` (and optional
   `endTime`) are added to events here; anything without one still shows, pinned above the hours where an
   all-day item belongs. ⛔ The field is optional and always was — an existing birthday must never need
   editing to keep working.

   ⭐ IT READS ACROSS ORGS. His day is not one business: a Mike Green job sits in `obx` while his daughter's
   party sits in the personal org, and a calendar that shows one of those is worse than no calendar because
   he will trust it. uniInOrg (js/151) does the crossing and restores S.biz in a finally.

   ⛔ READ-ONLY. Nothing here creates, edits or completes anything — every item links back to the screen that
   owns it. A calendar that quietly becomes a second place to edit a job is how two records disagree. */

var TCAL_START = 7, TCAL_END = 21;      // the hours drawn by default; widened to fit anything outside them

function tcalToday() { try { return (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function tcalShift(iso, days) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); if (!m) return "";
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (days || 0)));
  return d.toISOString().slice(0, 10);
}
function tcalMonthKey(iso) { return String(iso || "").slice(0, 7); }
function tcalAddMonths(iso, n) {
  var m = /^(\d{4})-(\d{2})/.exec(String(iso || "")); if (!m) return "";
  var y = +m[1], mo = +m[2] - 1 + (n || 0);
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  return y + "-" + String(mo + 1).padStart(2, "0");
}
function tcalDaysIn(ym) { var m = /^(\d{4})-(\d{2})/.exec(ym); return m ? new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() : 30; }
function tcalDow(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : 0; }
function tcalMonthName(ym) {
  var m = /^(\d{4})-(\d{2})/.exec(ym); if (!m) return "";
  return ["January","February","March","April","May","June","July","August","September","October","November","December"][+m[2] - 1] + " " + m[1];
}
/* "14:30" -> 14.5 ; anything unparseable -> null, which means all-day rather than midnight */
function tcalMins(t) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (m) return Math.min(1439, (+m[1]) * 60 + (+m[2]));
  m = /^(\d{1,2})\s*(am|pm)$/i.exec(String(t || "").trim());
  if (m) { var h = (+m[1]) % 12; if (/pm/i.test(m[2])) h += 12; return h * 60; }
  return null;
}
function tcalClock(mins) {
  if (mins == null) return "";
  var h = Math.floor(mins / 60), mm = mins % 60;
  var ap = h >= 12 ? "pm" : "am", h12 = h % 12; if (!h12) h12 = 12;
  return h12 + (mm ? ":" + String(mm).padStart(2, "0") : "") + ap;
}

/* ⛔ SUCCINCT. "Iowa mortgage (Johnston, IA rental)" in a calendar cell is a wall; "Iowa mortgage" is the
   same information at a glance. Drop the parenthetical and anything after a dash — a bill's own name already
   leads with the thing it is. */
function tcalBillName(n) {
  return String(n || "Bill").replace(/\s*\(.*$/, "").replace(/\s+[—–-]\s+.*$/, "").trim().slice(0, 22) || "Bill";
}
/* ⛔ NO CHARACTER CAP. Ray, 2026-08-27: "why does the text get truncated so early on the calendar block?"
   Because I was cutting it at 26 characters in JavaScript — a number that knows nothing about how wide the
   cell actually is. "Truck registration — DUE THIS MONTH" became "Truck registration — D…" in a cell with
   room for half as much again, and it would have been just as wrong on a narrower one.
   ⭐ CSS already truncates by WIDTH (.tcal-pt has overflow:hidden + text-overflow:ellipsis), which is the
   only measure that knows the answer. Strip the parenthetical, hand over the whole name, let the box decide.
   The full text stays in the title attribute either way. */
function tcalShort(n) {
  return String(n || "").replace(/\s*\(.*$/, "").trim();
}
function tcalAmt(v) {
  var n = Math.round(Math.abs(+v || 0));
  return n >= 1000 ? "$" + (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + "k" : "$" + n;
}

/* ---------- everything happening on a given day, from every org ---------- */
function tcalItemsFor(iso) {
  var out = [];
  /* personal events — including annual ones, which is the whole reason evNextISO exists */
  try {
    (typeof actEvents === "function" ? actEvents() : []).forEach(function (e) {
      var when = (typeof evNextISO === "function") ? evNextISO(e) : e.date;
      if (when !== iso) return;
      out.push({ kind: "event", title: e.title || "Event", note: e.note || "",
        mins: tcalMins(e.time), endMins: tcalMins(e.endTime),
        confirmed: e.confirmed !== false, tab: "cal", color: "#7c5cff" });
    });
  } catch (e) {}
  /* to-dos due that day */
  try {
    (D().todos || []).forEach(function (t) {
      if (!t || t.deleted || t.done || t.due !== iso) return;
      out.push({ kind: "todo", title: t.title || "To-do", mins: tcalMins(t.time), confirmed: true, tab: "todo", color: "#e0a800" });
    });
  } catch (e) {}
  /* ⭐⭐ BILLS ARE CALENDAR ITEMS. Ray, 2026-08-27: "we have the bills coming up over the next two weeks.
     Can we just build those into the calendar?… the bills should be built into it with their values showing."
     He is right that they were in the wrong place: a bill IS a dated thing with a time cost, and keeping it
     in a separate list meant checking two surfaces to answer one question — what is coming.
     ⛔ A bill is a FORECAST, not a posted transaction. It is drawn so he can see it coming; nothing here
     books anything, and budgetBillNextDue (js/79) stays the single source of when. */
  try {
    (D().budgetBills || []).forEach(function (b) {
      if (!b || b.deleted || b.active === false) return;
      if (typeof budgetBillNextDue !== "function") return;
      if (budgetBillNextDue(b, iso) !== iso) return;      // due on exactly this day
      out.push({ kind: "bill", title: tcalBillName(b.name), amount: +b.amount || 0,
        mins: null, confirmed: true, tab: "budget", color: "#e8683f" });
    });
  } catch (e) {}
  /* ⭐ jobs, from every org he runs — his day is not one business */
  try {
    var orgs = (typeof uniOrgs === "function") ? uniOrgs() : [];
    orgs.forEach(function (o) {
      var got = (typeof uniInOrg === "function") ? uniInOrg(o.id, function () {
        try {
          return (D().jobs || []).filter(function (j) { return j && !j.deleted && j.date === iso; })
            .map(function (j) {
              return { kind: "job", title: j.title || "Job", note: o.name || o.id,
                mins: tcalMins(j.time || j.startTime), endMins: tcalMins(j.endTime),
                confirmed: true, tab: "schedule", org: o.id, color: "#1e9e5a" };
            });
        } catch (e) { return []; }
      }) : null;
      if (got && got.length) out = out.concat(got);
    });
  } catch (e) {}
  return out.sort(function (a, b) {
    if (a.mins == null && b.mins == null) return 0;
    if (a.mins == null) return -1;               // all-day first
    if (b.mins == null) return 1;
    return a.mins - b.mins;
  });
}

/* how many things land on each day of a month — for the dots */
function tcalMonthCounts(ym) {
  var n = tcalDaysIn(ym), counts = {};
  for (var d = 1; d <= n; d++) {
    var iso = ym + "-" + String(d).padStart(2, "0");
    var items = tcalItemsFor(iso);
    if (items.length) counts[iso] = items;
  }
  return counts;
}

/* ---------- month grid — READ IT, don't decode it ------------------------------------------------------
   Ray, 2026-08-27: "i dont wanna have just dots for events coming up. That's not gonna help me remember…
   I wanna be able to read what's actually coming up. It's just gonna have to be bigger."

   ⚠️ HE IS RIGHT AND THE DOTS WERE A COP-OUT. A dot says "something happens"; the entire question is WHAT.
   So each day carries up to three short labels, colour-coded by kind, with a bill's amount on it — and the
   card moved to FULL WIDTH on Today, because seven columns of readable text does not fit in a sidebar and
   pretending otherwise is how you end up with dots again. */
function tcalMonthHTML(ym) {
  var today = tcalToday(), counts = tcalMonthCounts(ym), days = tcalDaysIn(ym);
  var lead = tcalDow(ym + "-01");
  var h = '<div class="tcal-m"><div class="tcal-mh">' + esc(tcalMonthName(ym)) + '</div>'
    + '<div class="tcal-grid">'
    + ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(function (d) { return '<div class="tcal-dow">' + d + '</div>'; }).join("");
  for (var i = 0; i < lead; i++) h += '<div class="tcal-d tcal-pad"></div>';
  for (var d = 1; d <= days; d++) {
    var iso = ym + "-" + String(d).padStart(2, "0");
    var items = counts[iso] || [];
    var past = iso < today;
    var cls = "tcal-d" + (iso === today ? " tcal-now" : "") + (past ? " tcal-past" : "");
    h += '<div class="' + cls + '"><span class="tcal-num">' + d + '</span>';
    items.slice(0, 4).forEach(function (x) {
      /* ⭐ the AMOUNT is the point of a bill on a calendar — "Rent" tells him nothing he didn't know */
      var right = x.kind === "bill" ? tcalAmt(x.amount) : (x.mins != null ? tcalClock(x.mins) : "");
      h += '<div class="tcal-pill" style="--pc:' + x.color + '" title="' + esc(x.title + (right ? " · " + right : "")) + '">'
        + '<span class="tcal-pt">' + esc(tcalShort(x.title)) + '</span>'
        + (right ? '<span class="tcal-pr">' + esc(right) + '</span>' : '')
        + '</div>';
    });
    if (items.length > 4) h += '<div class="tcal-more">+' + (items.length - 4) + ' more</div>';
    h += '</div>';
  }
  return h + '</div></div>';
}

/* ---------- one day, by the hour ---------- */
function tcalDayHTML(iso, label) {
  var items = tcalItemsFor(iso);
  var timed = items.filter(function (x) { return x.mins != null; });
  var allday = items.filter(function (x) { return x.mins == null; });

  /* ⚠️ widen the window rather than clip: a 6am start or a 10pm thing must not fall off the bottom */
  var lo = TCAL_START * 60, hi = TCAL_END * 60;
  timed.forEach(function (x) {
    if (x.mins < lo) lo = Math.floor(x.mins / 60) * 60;
    var end = x.endMins != null ? x.endMins : x.mins + 60;
    if (end > hi) hi = Math.ceil(end / 60) * 60;
  });
  var hours = Math.max(1, (hi - lo) / 60);
  var PX = 38;

  var h = '<div class="tcal-day"><div class="tcal-dh">' + esc(label)
    + ' <span class="sub" style="font-weight:400">' + esc(iso) + '</span></div>';

  /* ⛔ THE STRIP IS ALWAYS RENDERED, EVEN EMPTY. Today had an all-day item and tomorrow did not, so the two
     hour grids started at different heights and 9am on the left sat beside 10am on the right — a calendar
     that reads wrong at a glance is worse than one that isn't there. */
  {
    h += '<div class="tcal-allday">' + allday.map(function (x) {
      return '<div class="tcal-chip" style="border-left-color:' + x.color + '"'
        + (x.tab ? ' onclick="tcalGo(\'' + esc(x.tab) + '\',\'' + esc(x.org || "") + '\')"' : '') + '>'
        + esc(x.title) + (x.confirmed ? '' : ' <span style="opacity:.7">?</span>') + '</div>';
    }).join("") + '</div>';
  }

  if (!timed.length) {
    h += '<div class="sub" style="padding:10px 2px;white-space:normal">'
      + (allday.length ? 'Nothing with a time on it.' : 'Nothing scheduled.') + '</div>';
    return h + '</div>';
  }

  h += '<div class="tcal-hours" style="height:' + (hours * PX) + 'px">';
  for (var m = lo; m < hi; m += 60) {
    h += '<div class="tcal-hr" style="top:' + ((m - lo) / 60 * PX) + 'px"><span>' + esc(tcalClock(m)) + '</span></div>';
  }
  timed.forEach(function (x) {
    var top = (x.mins - lo) / 60 * PX;
    var end = x.endMins != null && x.endMins > x.mins ? x.endMins : x.mins + 45;
    /* ⚠️ min-height, not height. A 45-minute block is 26px and "Mike Green — walkthrough" was being cut in
       half; a title that has to be guessed at is not information. The box grows to fit its own text and the
       hour lines behind it stay where they are. */
    var height = Math.max(22, (end - x.mins) / 60 * PX - 2);
    h += '<div class="tcal-ev" style="top:' + top + 'px;min-height:' + height + 'px;border-left-color:' + x.color + '"'
      + (x.tab ? ' onclick="tcalGo(\'' + esc(x.tab) + '\',\'' + esc(x.org || "") + '\')"' : '') + '>'
      + '<b>' + esc(tcalClock(x.mins)) + '</b> ' + esc(x.title)
      + (x.note ? ' <span style="opacity:.65">· ' + esc(String(x.note).slice(0, 24)) + '</span>' : '')
      + '</div>';
  });
  return h + '</div></div>';
}

function tcalHTML() {
  var t = tcalToday();
  /* ⛔ THE TWO-WEEK BILL TOTAL IS GONE FROM HERE. Ray, 2026-08-27: "the line above the calendar says bills
     due in the next two weeks. we dont need that we have a money area now." He is right, and it was my
     mistake twice over: I moved that number OFF the money card onto the calendar, then built a money card
     that says it properly. Two places saying the same thing is how they start disagreeing. The calendar
     shows WHEN each bill lands; the outlook card says what they add up to. One job each. */
  return '<div class="card tcal">'
    + '<div class="row" style="align-items:baseline;gap:10px;flex-wrap:wrap">'
    +   '<div class="nm" style="font-size:15px">📅 Calendar</div>'
    +   '<div class="grow"></div>'
    +   '<div class="sub tcal-key">'
    +     '<i style="background:#e8683f"></i>bill <i style="background:#1e9e5a"></i>job '
    +     '<i style="background:#7c5cff"></i>personal <i style="background:#e0a800"></i>to-do</div>'
    +   '<button class="btn ghost sm" style="width:auto" onclick="navSub(\'cal\')">Open</button>'
    + '</div>'
    + '<div class="tcal-months">' + tcalMonthHTML(tcalMonthKey(t)) + tcalMonthHTML(tcalAddMonths(tcalMonthKey(t), 1)) + '</div>'
    + '</div>';
}

/* ⭐ TODAY AND TOMORROW ARE THEIR OWN BLOCK. Ray, 2026-08-27: "the today / tomorrow section should be its
   own block, not inside calendar." He is right and it is not just tidiness — they answer different
   questions on different timescales, they want different widths, and while they were welded together he
   could not put the hours where he wanted them and the months somewhere else. */
function tcalDaysHTML() {
  var t = tcalToday();
  return '<div class="card tcal">'
    + '<div class="tcal-days">' + tcalDayHTML(t, "Today") + tcalDayHTML(tcalShift(t, 1), "Tomorrow") + '</div>'
    + '</div>';
}

if (typeof window !== "undefined") {
  window.tcalHTML = tcalHTML; window.tcalDaysHTML = tcalDaysHTML; window.tcalItemsFor = tcalItemsFor; window.tcalDayHTML = tcalDayHTML;
  window.tcalMonthHTML = tcalMonthHTML; window.tcalMins = tcalMins; window.tcalClock = tcalClock;
  window.tcalShift = tcalShift; window.tcalBillName = tcalBillName; window.tcalShort = tcalShort; window.tcalAmt = tcalAmt; window.tcalAddMonths = tcalAddMonths; window.tcalToday = tcalToday;
  /* ⛔ a calendar sends him to the screen that OWNS the record — it never edits one itself */
  window.tcalGo = function (tab, org) {
    try {
      if (org && typeof S !== "undefined" && S.biz !== org && typeof setBiz === "function") setBiz(org);
      if (typeof navSub === "function") navSub(tab);
      else if (typeof TAB !== "undefined") { TAB = tab; if (typeof render === "function") render(); }
    } catch (e) {}
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { tcalMins: tcalMins, tcalClock: tcalClock, tcalShift: tcalShift, tcalAddMonths: tcalAddMonths, tcalDaysIn: tcalDaysIn };
}
