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
    /* ⚠️ `w` IS HOW MUCH WIDTH THIS BLOCK NEEDS, AND IT TRAVELS WITH THE BLOCK.
       Ray, 2026-08-27: "i wanted to move the calendar to be centered but it did this because i cant resize
       anything." My bug entirely — the column widths were tied to POSITION (column 0 was always the wide
       one), so moving the calendar into the middle handed it the narrow slot and squeezed "Iowa mortgage"
       back to "I…". Width is a property of the CONTENT, not of where the content happens to sit: a month
       grid needs seven readable columns wherever he puts it, and a checklist doesn't stop being a checklist
       in the wide slot. A column now takes the width of the hungriest block in it. */
    { key: "calendar", label: "Calendar",  w: 2.4, html: function () { return (typeof tcalHTML === "function") ? tcalHTML() : ""; } },
    { key: "chat",     label: "Cap",       w: 1,   html: function () { return (typeof phTalkCard === "function") ? phTalkCard() : ""; } },
    { key: "routine",  label: "Your day",  w: 1.2, html: function () { return (typeof tlRoutineHTML === "function") ? tlRoutineHTML() : ""; } },
    /* ⛔ THE FALLBACK CHAIN STAYS. moneyCardHTML is itself a newer card; if that module is ever missing,
       Today drops back to the calendar's own bills card rather than losing the money block entirely. Three
       tests were asserting this before the layout rewrite and they were right to. */
    { key: "money",    label: "Money",     w: 1, html: function () {
        var m = (typeof moneyCardHTML === "function") ? moneyCardHTML() : "";
        if (m) return m;
        return (typeof calBillsCardHTML === "function")
          ? calBillsCardHTML(typeof MC_DAYS_FALLBACK !== "undefined" ? MC_DAYS_FALLBACK : 14) : "";
      } },
    /* ⭐ what he has vs what is leaving vs what might arrive (js/165) — sits with the money, because
       "how much is there" and "how much is going" are one thought */
    { key: "outlook",  label: "The month ahead", w: 1.05, html: function () { return (typeof monthOutlookHTML === "function") ? monthOutlookHTML() : ""; } },
    { key: "coming",   label: "Coming up", w: 0.9, html: function () { return (typeof evHomeCardHTML === "function") ? evHomeCardHTML(30) : ""; } }
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
        order: (s && isFinite(+s.order)) ? +s.order : d.order,
        /* ⭐ HIS OWN WIDTH, IF HE HAS SET ONE. Ray: "i cant resize anything." The content weight below is a
           good default, not a verdict — clamped so a column can never be squeezed to nothing or eat the row.
           ⚠️ `!= null && > 0`, NOT isFinite ALONE. A block with no override saves w:null, and isFinite(+null)
           is TRUE because +null is 0 — so every unset width round-tripped back as the 0.6 minimum and flattened
           every column to the same size. Caught by a test that moved a block twice and watched 2.4fr become
           1fr; the arithmetic was right and the falsy-check was not. */
        w: (s && s.w != null && isFinite(+s.w) && +s.w > 0) ? Math.max(0.6, Math.min(4, +s.w)) : null
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
    + '<button title="Narrower" class="tl-w" onclick="tlWide(\'' + b.key + '\',-1)">–</button>'
    + '<button title="Wider" class="tl-w" onclick="tlWide(\'' + b.key + '\',1)">+</button>'
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

  /* ⭐ THE COLUMN TAKES THE WIDTH OF ITS HUNGRIEST BLOCK. Emitted inline rather than as a CSS class, because
     the answer depends on where HE put things and CSS cannot know that. A column of ordinary cards is 1fr;
     put the calendar in it and it becomes 2.4fr, wherever "it" is. */
  var widths = live.map(function (c) {
    /* ⚠️ START AT 0, NOT 1. Starting at 1 floored every column there, so the "narrower" button did nothing
       at all below 1fr — the value moved in storage and the layout never changed, which reads as a broken
       button rather than a clamp. The real minimum is the 0.6 clamp in tlWide, and it belongs in one place. */
    var w = 0;
    c.items.forEach(function (x) {
      /* his override wins over the block's own appetite */
      var bw = (lay[x.b.key] && lay[x.b.key].w) || +x.b.w || 1;
      if (bw > w) w = bw;
    });
    return "minmax(0," + (Math.round((w || 1) * 100) / 100) + "fr)";
  }).join(" ");

  return '<div class="tl-grid tl-live-' + live.length + '" style="--tl-cols:' + esc(widths) + '"'
    + ' data-cols="' + live.map(function (c) { return c.i; }).join(",") + '">'
    + body + '</div>'
    + '<div class="sub tl-hint">Use ◀ ▲ ▼ ▶ on any block to rearrange this page. '
    + '<a href="#" onclick="tlReset();return false">Put it back the way it was</a></div>';
}

if (typeof window !== "undefined") {
  window.tlTodayHTML = tlTodayHTML; window.tlLayout = tlLayout; window.tlBlocks = tlBlocks;
  window.tlRoutineHTML = tlRoutineHTML; window.tlSave = tlSave; window.TL_DEFAULT = TL_DEFAULT;

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

  /* ⭐ RESIZE. Steps of 0.2fr, clamped 0.6–4. ⛔ Stored per BLOCK, not per column, so a width he set on the
     calendar follows it when he moves it — the same reason the defaults are content-based. */
  window.tlWide = function (key, dir) {
    var lay = tlLayout(), p = lay[key]; if (!p) return;
    var blocks = tlBlocks(), b = null;
    blocks.forEach(function (x) { if (x.key === key) b = x; });
    var cur = p.w || (b && +b.w) || 1;
    p.w = Math.max(0.6, Math.min(4, Math.round((cur + dir * 0.2) * 100) / 100));
    tlSave(lay);
    if (typeof render === "function") render();
  };

  window.tlReset = function () {
    try { localStorage.removeItem(tlKey()); } catch (e) {}
    if (typeof render === "function") render();
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { TL_DEFAULT: TL_DEFAULT, TL_COLS: TL_COLS };
