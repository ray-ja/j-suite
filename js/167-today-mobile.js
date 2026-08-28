/* ---------- TODAY, ON A PHONE (js/167) ------------------------------------------------------------------
   Ray, 2026-08-27: "the mobile and desktop should just have different pages honestly theres no decent
   middleground"

   ⭐ HE IS RIGHT, AND THIS PAGE IS THE PROOF. Two blocks on Today have no honest small-screen version:
     · the month grid — seven columns of readable text. At 390px each cell is 50px wide. The whole reason it
       stopped being dots was so he could READ what's coming; at phone width it goes straight back to being
       dots with extra steps.
     · the three-column movable layout — one column on a phone, so the arrows point at columns that aren't
       there and the resize buttons resize nothing.
   Everything else survives a narrow screen fine. Responsive CSS was making the two blocks that DON'T survive
   look like they had, which is the worst of both: a desktop page delivered badly rather than a phone page.

   ⛔⛔ AND YET THIS IS NOT A SECOND COPY OF TODAY. Every card here is the SAME function the desktop page
   calls — phTalkCard, tlRoutineHTML, moneyCardHTML, monthOutlookHTML, tcalDayHTML. What differs is the
   ARRANGEMENT, plus one genuinely phone-shaped rendering (the agenda below) that replaces the month grids.
   Two compositions over one set of blocks. If a card ever gets forked in here, the two pages start
   disagreeing about his money, and he'd have no way to know which one was lying.

   ⚠️ THE BREAKPOINT IS ONE NUMBER, SHARED WITH THE CSS. TM_BP must equal the min-width in app.css that turns
   .tl-grid into a grid. If JS and CSS disagree by even a pixel there is a window where the desktop page
   renders under phone rules — three columns' worth of blocks stacked in one column with the layout controls
   pointing nowhere. Asserted in tools-tests against app.css itself, not against a copy of the number. */

var TM_BP = 1180;

/* ⛔ matchMedia, not innerWidth. The CSS breakpoint is a media query, so the only way to be certain JS agrees
   with it is to ask the same engine the same question. innerWidth differs from the media-query width by the
   scrollbar on desktop Chrome — enough to disagree at exactly the boundary. */
function tmIsPhone() {
  try {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return !window.matchMedia("(min-width:" + TM_BP + "px)").matches;
  } catch (e) { return false; }
}

/* ---------- ⭐ THE AGENDA — what the month grid becomes on a phone --------------------------------------
   A month grid answers "what shape is my month". A phone can't ask that question legibly, and it isn't the
   one he has at 6am in the truck anyway — that one is "what's next". So: a straight run of the days that
   have something on them, newest first, each item on its own readable line with its time or its amount.
   ⛔ Reads through tcalItemsFor (js/163), so it is the same cross-org data as the desktop grid — jobs from
   every business, bills, to-dos, personal events. A phone page that quietly showed fewer things than the
   desktop one would be worse than no phone page. */
var TM_AGENDA_DAYS = 21;
var TM_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var TM_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tmDayLabel(iso, offset) {
  if (offset === 1) return "Tomorrow";
  var dow = (typeof tcalDow === "function") ? tcalDow(iso) : 0;
  return TM_DOW[dow] + " " + (+iso.slice(8, 10)) + " " + TM_MON[(+iso.slice(5, 7) || 1) - 1];
}

function tmAgendaHTML(days) {
  if (typeof tcalItemsFor !== "function" || typeof tcalShift !== "function") return "";
  var t = (typeof tcalToday === "function") ? tcalToday() : "";
  if (!t) return "";
  var n = days == null ? TM_AGENDA_DAYS : days;
  var rows = "", found = 0;
  /* ⛔ starts at TOMORROW. Today is the hour view above; listing it twice is two surfaces answering one
     question, which is how they start disagreeing. */
  for (var i = 1; i <= n; i++) {
    var iso = tcalShift(t, i);
    if (!iso) break;
    var items = [];
    try { items = tcalItemsFor(iso) || []; } catch (e) { items = []; }
    if (!items.length) continue;
    found++;
    rows += '<div class="tm-day"><div class="tm-dh">' + esc(tmDayLabel(iso, i)) + '</div>'
      + items.map(function (x) {
          var right = x.kind === "bill" ? ((typeof tcalAmt === "function") ? tcalAmt(x.amount) : "")
                    : (x.mins != null && typeof tcalClock === "function" ? tcalClock(x.mins) : "");
          return '<div class="tm-item" style="--pc:' + esc(x.color || "") + '"'
            + (x.tab ? ' onclick="tcalGo(\'' + esc(x.tab) + '\',\'' + esc(x.org || "") + '\')"' : '')
            + '><div class="tm-it">' + esc(x.title || "")
            + (x.confirmed === false ? ' <span style="opacity:.7">?</span>' : '') + '</div>'
            + (right ? '<div class="tm-ir">' + esc(right) + '</div>' : '')
            + '</div>';
        }).join("")
      + '</div>';
  }
  if (!found) {
    return '<div class="card"><div class="nm">What\'s next</div>'
      + '<div class="sub" style="white-space:normal;margin-top:4px">Nothing on the calendar for the next '
      + n + ' days.</div></div>';
  }
  return '<div class="card tm-agenda">'
    + '<div class="row" style="align-items:baseline;gap:8px">'
    +   '<div class="nm" style="font-size:15px">What\'s next</div><div class="grow"></div>'
    +   '<button class="btn ghost sm" style="width:auto;flex:0 0 auto;padding:2px 10px;font-size:12px"'
    +     ' onclick="navSub(\'cal\')">Calendar</button>'
    + '</div>' + rows + '</div>';
}

/* ---------- ⭐⭐ THE PHONE PAGE ---------------------------------------------------------------------------
   The order is the order of the morning, and it is FIXED — no arrows, no resize. On a page one column wide
   there is exactly one arrangement, so a control to change it would be a control that does nothing.

     1. Cap          — he does everything by voice that he can; it is how he actually operates the app
     2. Today        — the hours, so "what am I doing and when" is answered before he scrolls
     3. His day      — the routine, the checklist he works through (jobs omitted: the hours above cover them)
     4. Money        — four balances and whether the next six weeks hold
     5. What's next  — the agenda, in place of two month grids
     6. Month ahead  — the detail, last, because it is for thinking and not for doing */
function tmTodayHTML() {
  var h = "";
  var add = function (fn, arg) {
    try { if (typeof fn === "function") { var s = arg === undefined ? fn() : fn(arg); if (s) h += s; } } catch (e) {}
  };
  add(typeof phTalkCard !== "undefined" ? phTalkCard : null);

  /* today, by the hour — ONE day, not today-and-tomorrow side by side. Two hour grids next to each other is
     a desktop shape; on a phone they stack and the second one is just a long scroll past the first.
     ⛔ AND NOTHING AT ALL ON AN EMPTY DAY. On the desktop grid an empty "Nothing scheduled" panel keeps the
     two day views aligned, which is a real reason there. Here it is the FIRST thing he sees on a phone, and
     a 120px card announcing an absence is the worst use of the top of a small screen — the routine below it
     is what he actually opened the app for. Every other block on this page already vanishes when empty. */
  if (typeof tcalDayHTML === "function" && typeof tcalToday === "function" && typeof tcalItemsFor === "function") {
    try {
      var t = tcalToday();
      if ((tcalItemsFor(t) || []).length) {
        var d = tcalDayHTML(t, "Today");
        if (d) h += '<div class="card tcal tm-today">' + d + '</div>';
      }
    } catch (e) {}
  }

  if (typeof tlRoutineHTML === "function") {
    try {
      var r = tlRoutineHTML({ jobs: false });
      if (r) h += r;
    } catch (e) {}
  }

  add(typeof moneyCardHTML !== "undefined" ? moneyCardHTML : null);
  add(tmAgendaHTML, TM_AGENDA_DAYS);
  add(typeof monthOutlookHTML !== "undefined" ? monthOutlookHTML : null);
  return h;
}

if (typeof window !== "undefined") {
  window.tmIsPhone = tmIsPhone; window.tmTodayHTML = tmTodayHTML; window.tmAgendaHTML = tmAgendaHTML;
  window.tmDayLabel = tmDayLabel; window.TM_BP = TM_BP;

  /* ⭐ CROSSING THE BREAKPOINT RE-RENDERS. Rotating a phone, or dragging a desktop window narrow, has to
     switch pages — otherwise he lands on a desktop layout squeezed into a phone, which is the exact thing
     this module exists to stop.
     ⛔ REGISTERED ONCE, not per render. render() runs on every interaction; adding a listener each time would
     stack thousands of them and re-render once per listener on the first resize. */
  (function () {
    try {
      if (!window.matchMedia || window._tmBound) return;
      window._tmBound = true;
      var mq = window.matchMedia("(min-width:" + TM_BP + "px)");
      var onChange = function () { if (typeof render === "function") render(); };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);      // older WebKit
    } catch (e) {}
  })();
}
if (typeof module !== "undefined" && module.exports) module.exports = { TM_BP: TM_BP, TM_AGENDA_DAYS: TM_AGENDA_DAYS };
