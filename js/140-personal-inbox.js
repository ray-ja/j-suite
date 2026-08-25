/* ---------- ONE LIST TO LOOK AT (js/140) --------------------------------------------------------------
   Ray, 2026-08-24, going to bed after a long rant: "make sure it's all on the personal one. You know? You
   can have it have items from the multiple businesses, but the personal one is like my personal list. And
   that's where I'm gonna look. I don't wanna have to dig through each individual business to figure out
   what I need to do unless it's stuff that's specifically just for that business, and it's not critical."

   That is a precise spec, so here it is precisely:

     THE PERSONAL TO-DO LIST IS THE ONE PLACE HE LOOKS. Anything urgent from OBX, Jamieson or the escape
     room SURFACES there. Anything business-specific and not urgent stays in its own org, where it belongs
     and where it isn't in his face.

   WHAT COUNTS AS URGENT — deliberately mechanical, so it can't drift into me deciding what matters to him:
     · overdue                         (a date already passed)
     · due within the next 7 days
     · High priority
     · pinned by hand (todo.pin)
   Everything else stays home. A business item that is merely OPEN is not urgent; that is the whole point
   of not making him dig through four lists.

   ⚠️ IT IS A VIEW, NOT A COPY. The record stays in its own org — ticking it here writes to the origin org
   and syncs from there. Copying it would mean two records for one job and one of them going stale, which is
   exactly the "dig through each business" problem in a new costume.

   Only renders in a personal org, so a business org never grows a cross-business inbox it didn't ask for. */

var PI_SOON_DAYS = 7;

function piIsPersonal() { return (typeof orgIsPersonalOrg === "function") ? orgIsPersonalOrg() : false; }

/* every org except the one we're in, that actually has a local slab */
function piOtherOrgs() {
  var here = (typeof S !== "undefined" && S.biz) ? S.biz : "";
  return ((typeof S !== "undefined" && S.registry) || [])
    .filter(function (r) { return r && r.id && r.id !== here && S[r.id] && typeof S[r.id] === "object" && !Array.isArray(S[r.id]); })
    .map(function (r) { return { id: r.id, name: r.name || r.id }; });
}

/* the mechanical urgency test — pure, so it is tested by being called */
function piUrgent(td, todayStr, soonDays) {
  if (!td || td.done || td.deleted) return null;
  if (td.pin) return "pinned";
  if (String(td.priority) === "High") return "high";
  var due = String(td.due || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  if (due < todayStr) return "overdue";
  var d = new Date(due + "T12:00:00"), t = new Date(todayStr + "T12:00:00");
  var days = Math.round((d - t) / 86400000);
  return (days >= 0 && days <= (soonDays || PI_SOON_DAYS)) ? "soon" : null;
}

/* what surfaces, newest-urgency first */
function piCrossOrg() {
  var today_ = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
  var out = [];
  piOtherOrgs().forEach(function (o) {
    ((S[o.id] || {}).todos || []).forEach(function (td) {
      var why = piUrgent(td, today_, PI_SOON_DAYS);
      if (!why) return;
      out.push({ org: o.id, orgName: o.name, td: td, why: why });
    });
  });
  var RANK = { overdue: 0, pinned: 1, high: 2, soon: 3 };
  return out.sort(function (a, b) {
    return (RANK[a.why] - RANK[b.why]) || String(a.td.due || "9999").localeCompare(String(b.td.due || "9999"));
  });
}

function piWhyLabel(why, td, todayStr) {
  if (why === "overdue") return "overdue since " + ((typeof fmtDate === "function") ? fmtDate(td.due) : td.due);
  if (why === "soon") return "due " + ((typeof fmtDate === "function") ? fmtDate(td.due) : td.due);
  if (why === "high") return "high priority";
  return "pinned";
}

/* ---- the section on the personal to-do list ---- */
function piCardHTML() {
  if (!piIsPersonal()) return "";
  var list = piCrossOrg();
  if (!list.length) return "";
  var today_ = (typeof today === "function") ? today() : "";
  var h = '<div class="secthd"><h2 style="font-size:15px">From your businesses</h2><span class="ct">' + list.length + '</span></div>'
    + '<div class="card" style="padding:6px 10px">';
  list.forEach(function (x) {
    var od = x.why === "overdue";
    h += '<div class="li" style="align-items:flex-start">'
      + '<input type="checkbox" style="width:22px;height:22px;flex:0 0 auto" onchange="piTick(\'' + x.org + '\',\'' + x.td.id + '\')">'
      + '<div class="grow" style="cursor:pointer" onclick="piOpen(\'' + x.org + '\',\'' + x.td.id + '\')">'
      + '<div class="nm">' + esc(x.td.title || "(untitled)") + '</div>'
      + '<div class="sub"' + (od ? ' style="color:var(--danger);font-weight:600"' : '') + '>'
      + esc(x.orgName) + ' · ' + esc(piWhyLabel(x.why, x.td, today_)) + '</div></div></div>';
  });
  return h + '</div><div class="sub" style="padding:4px 2px 10px;white-space:normal">'
    + 'Only what\'s urgent shows here. Everything else stays on its own business list.</div>';
}

if (typeof window !== "undefined") {
  window.piCrossOrg = piCrossOrg; window.piUrgent = piUrgent; window.piCardHTML = piCardHTML;

  /* ⚠️ writes to the ORIGIN org, never a local copy — the record has exactly one home */
  window.piTick = function (org, id) {
    var td = ((S[org] || {}).todos || []).find(function (x) { return x && x.id === id; });
    if (!td) return;
    td.done = !td.done;
    if (typeof touch === "function") touch(td);
    if (typeof logChange === "function") { try { logChange("update", "todo", td.id, (td.done ? "Completed" : "Reopened") + " from the personal list — " + (td.title || "")); } catch (e) {} }
    if (typeof save === "function") save();
    if (typeof render === "function") render();
  };

  /* opening one switches to the org that owns it, so editing happens where the record lives */
  window.piOpen = function (org, id) {
    /* setBiz, not switchBiz — verified against js/03 rather than assumed */
    if (typeof setBiz === "function" && S.biz !== org) {
      try { setBiz(org); } catch (e) {}
    }
    setTimeout(function () {
      if (typeof openTodo === "function") openTodo(id);
      else if (typeof render === "function") render();
    }, 60);
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { piUrgent: piUrgent, PI_SOON_DAYS: PI_SOON_DAYS };
}
