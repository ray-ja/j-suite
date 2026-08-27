/* ---------- TODAY LAYOUT (js/164) — blocks he can move -------------------------------------------------
   Ray, 2026-08-27, looking at a 2000px screen with 440px of dead air down the right: "let's use our space
   more effectively… I wanna be able to see it all on one screen. Maybe you can make it, like, draggable, and
   then I can just try a few different ways to do it. If not, just try your best."

   ⭐ SO: A GOOD DEFAULT, AND HE CAN MOVE IT. He has told me where things go four times now — chat left, then
   routine linear on the right, then money in the corner, now chat top-right — and every one of those was
   right at the time. The lesson isn't the arrangement, it's that I keep guessing at something he can decide
   in ten seconds if the app lets him.

   ⛔ ARROWS, NOT HTML5 DRAG-AND-DROP. Dragging is fiddly with a mouse, close to unusable on a phone, and
   needs a drop-target dance to be accessible at all. ◀ ▶ moves a block between columns and ▲ ▼ moves it
   within one — the same interaction the nav-order editor already uses, works on a touchscreen, and cannot
   drop a card into nowhere.

   ⚠️ THE ARRANGEMENT IS PER-DEVICE, IN localStorage, NOT IN THE SYNCED STORE. A three-column layout he wants
   on a 2000px monitor is not the layout he wants on a phone, and syncing it would make one of those two
   experiences worse every time he touched the other. It is also, deliberately, not data: losing it costs him
   one re-arrangement, and it can never take a customer record with it. */

var TL_COLS = 3;
function tlKey() {
  try {
    var me = (typeof phMe === "function") ? phMe() : null;
    return "tl_layout_" + ((me && me.id) || "anon") + "_" + ((typeof S !== "undefined" && S.biz) || "");
  } catch (e) { return "tl_layout"; }
}

/* every block Today can show. `html` is called at render; a block that returns "" simply isn't drawn. */
function tlBlocks() {
  return [
    { key: "calendar", label: "Calendar",  html: function () { return (typeof tcalHTML === "function") ? tcalHTML() : ""; } },
    { key: "chat",     label: "Cap",       html: function () { return (typeof phTalkCard === "function") ? phTalkCard() : ""; } },
    { key: "routine",  label: "Your day",  html: function () { return (typeof tlRoutineHTML === "function") ? tlRoutineHTML() : ""; } },
    /* ⛔ THE FALLBACK CHAIN STAYS. moneyCardHTML is itself a newer card; if that module is ever missing,
       Today drops back to the calendar's own bills card rather than losing the money block entirely. Three
       tests were asserting this before the layout rewrite and they were right to. */
    { key: "money",    label: "Money",     html: function () {
        var m = (typeof moneyCardHTML === "function") ? moneyCardHTML() : "";
        if (m) return m;
        return (typeof calBillsCardHTML === "function")
          ? calBillsCardHTML(typeof MC_DAYS_FALLBACK !== "undefined" ? MC_DAYS_FALLBACK : 14) : "";
      } },
    /* ⭐ what he has vs what is leaving vs what might arrive (js/165) — sits with the money, because
       "how much is there" and "how much is going" are one thought */
    { key: "outlook",  label: "The month ahead", html: function () { return (typeof monthOutlookHTML === "function") ? monthOutlookHTML() : ""; } },
    { key: "coming",   label: "Coming up", html: function () { return (typeof evHomeCardHTML === "function") ? evHomeCardHTML(30) : ""; } }
  ];
}

/* ⭐ THE DEFAULT. Calendar takes the wide left column because a month grid is the one thing here that
   genuinely needs width; Cap sits top-right where he asked for it; the routine runs down the middle where a
   sequence reads as a sequence; money and dates stack in the narrow right column. */
var TL_DEFAULT = { calendar: { col: 0, order: 0 }, routine: { col: 1, order: 0 },
                   chat: { col: 2, order: 0 }, outlook: { col: 2, order: 1 },
                   money: { col: 2, order: 2 }, coming: { col: 2, order: 3 } };

function tlLayout() {
  var out = {};
  try {
    var raw = localStorage.getItem(tlKey());
    var saved = raw ? JSON.parse(raw) : null;
    tlBlocks().forEach(function (b) {
      var s = saved && saved[b.key];
      var d = TL_DEFAULT[b.key] || { col: 0, order: 9 };
      out[b.key] = {
        col: (s && isFinite(+s.col)) ? Math.max(0, Math.min(TL_COLS - 1, +s.col)) : d.col,
        order: (s && isFinite(+s.order)) ? +s.order : d.order
      };
    });
  } catch (e) {
    tlBlocks().forEach(function (b) { out[b.key] = TL_DEFAULT[b.key] || { col: 0, order: 9 }; });
  }
  return out;
}
function tlSave(layout) { try { localStorage.setItem(tlKey(), JSON.stringify(layout)); } catch (e) {} }

/* the routine column, assembled exactly as it was — one sequence, top to bottom */
function tlRoutineHTML() {
  var part = function (k) {
    if (typeof rtPartHTML !== "function" || typeof ROUTINE_PARTS === "undefined") return "";
    var p = ROUTINE_PARTS.filter(function (x) { return x.key === k; })[0];
    return p ? rtPartHTML(p) : "";
  };
  var h = part("morning");
  h += (typeof rtBillsTodayHTML === "function") ? rtBillsTodayHTML() : "";   /* what leaves the account today */
  h += (typeof rtJobsTodayHTML === "function") ? rtJobsTodayHTML() : "";
  h += (typeof phPlanCard === "function") ? phPlanCard() : "";
  h += (typeof piCardHTML === "function") ? piCardHTML() : "";
  h += part("day");
  h += part("evening");
  if (h) h += '<button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="rtEdit(\'\')">＋ Add to your routine</button>';
  return h;
}

/* ⛔ the handle is TINY and only on desktop — on a phone everything is one column and moving a block between
   columns that don't exist would be a control that lies. */
function tlHandle(b, lay) {
  var p = lay[b.key];
  return '<div class="tl-handle"><span class="tl-name">' + esc(b.label) + '</span>'
    + '<button title="Move left"  onclick="tlMove(\'' + b.key + '\',\'left\')"'  + (p.col === 0 ? ' disabled' : '') + '>◀</button>'
    + '<button title="Move up"    onclick="tlMove(\'' + b.key + '\',\'up\')">▲</button>'
    + '<button title="Move down"  onclick="tlMove(\'' + b.key + '\',\'down\')">▼</button>'
    + '<button title="Move right" onclick="tlMove(\'' + b.key + '\',\'right\')"' + (p.col === TL_COLS - 1 ? ' disabled' : '') + '>▶</button>'
    + '</div>';
}

function tlTodayHTML() {
  var lay = tlLayout(), blocks = tlBlocks();
  var cols = [];
  for (var i = 0; i < TL_COLS; i++) cols.push([]);
  blocks.forEach(function (b) {
    var html = "";
    try { html = b.html() || ""; } catch (e) { html = ""; }
    if (!html) return;                                     // a block with nothing to say draws nothing
    cols[lay[b.key].col].push({ b: b, html: html, order: lay[b.key].order });
  });
  cols.forEach(function (c) { c.sort(function (x, y) { return x.order - y.order; }); });

  /* ⚠️ a column with nothing in it must not hold width open — that is the dead air he is complaining about */
  var live = cols.map(function (c, i) { return { i: i, items: c }; }).filter(function (c) { return c.items.length; });
  var body = live.map(function (c) {
    return '<div class="tl-col tl-col-' + c.i + '">'
      + c.items.map(function (x) {
          return '<div class="tl-block">' + tlHandle(x.b, lay) + x.html + '</div>';
        }).join("")
      + '</div>';
  }).join("");

  return '<div class="tl-grid tl-live-' + live.length + '" data-cols="' + live.map(function (c) { return c.i; }).join(",") + '">'
    + body + '</div>'
    + '<div class="sub tl-hint">Use ◀ ▲ ▼ ▶ on any block to rearrange this page. '
    + '<a href="#" onclick="tlReset();return false">Put it back the way it was</a></div>';
}

if (typeof window !== "undefined") {
  window.tlTodayHTML = tlTodayHTML; window.tlLayout = tlLayout; window.tlBlocks = tlBlocks;
  window.tlRoutineHTML = tlRoutineHTML; window.TL_DEFAULT = TL_DEFAULT;

  window.tlMove = function (key, dir) {
    var lay = tlLayout();
    var p = lay[key]; if (!p) return;
    if (dir === "left" && p.col > 0) p.col--;
    else if (dir === "right" && p.col < TL_COLS - 1) p.col++;
    else if (dir === "up" || dir === "down") {
      /* ⭐ swap with the neighbour IN THIS COLUMN, so "up" means what it looks like rather than shuffling a
         global index that happens to belong to another column */
      var mates = Object.keys(lay).filter(function (k) { return lay[k].col === p.col; })
        .sort(function (a, b) { return lay[a].order - lay[b].order; });
      var i = mates.indexOf(key), j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= mates.length) return;
      var tmp = lay[mates[i]].order; lay[mates[i]].order = lay[mates[j]].order; lay[mates[j]].order = tmp;
    } else return;
    /* landing in a new column goes to the bottom of it, which is where a dropped thing would land */
    if (dir === "left" || dir === "right") {
      var here = Object.keys(lay).filter(function (k) { return k !== key && lay[k].col === p.col; });
      p.order = here.length ? Math.max.apply(null, here.map(function (k) { return lay[k].order; })) + 1 : 0;
    }
    tlSave(lay);
    if (typeof render === "function") render();
  };

  window.tlReset = function () {
    try { localStorage.removeItem(tlKey()); } catch (e) {}
    if (typeof render === "function") render();
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { TL_DEFAULT: TL_DEFAULT, TL_COLS: TL_COLS };
