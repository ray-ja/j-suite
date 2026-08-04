/* ---------- THE SHELF (js/123) — a personal reference library ----------------------------------------
   Ray, 2026-08-04, after a conversation about the philosophy that built the 1900s: "Please have those
   somewhere in the app where I can go back to them. Some organized, you know, really nicely so I can go back
   and reference it."

   ⛔ THIS IS A SHELF, NOT A READING LIST. He has already told me that reading-as-much-as-he-used-to is one of
   the things he "likes the idea of but never got good at". A list with progress bars, unread counts, streaks
   or reminders would convert that straight into guilt — the exact machine he had to ask me to tear out of his
   check-in thread. So: no counters, no "0 of 6 read", no nudges, nothing aggregated. Status is optional, set
   only by him, shown as a quiet word, and never totalled.

   Two kinds of entry, because he asked for the INSIGHTS as well as the recommendations:
     kind:"idea" — an argument or framing worth keeping (the Brenner debate, the three rival mechanisms…)
     kind:"book" — a source, with why it's here and what it argues
   Grouped by topic so a subject reads as one place. shelfItems is a synced collection (stable "shf_" ids). */

var SHELF_TOPIC = null;    // null = show every topic

function actShelf() { return (D().shelfItems || []).filter(function (x) { return x && !x.deleted; }); }
function shelfTopics() {
  var seen = [], out = [];
  actShelf().forEach(function (x) { var t = x.topic || "Unfiled"; if (seen.indexOf(t) < 0) { seen.push(t); out.push(t); } });
  return out.sort();
}
function shelfStatusLabel(s) {
  return s === "read" ? "read" : s === "reading" ? "reading" : s === "want" ? "want to read" : "";
}

/* ---- render ---- */
function rShelf() {
  var items = actShelf(), topics = shelfTopics();
  var h = '<div class="secthd"><h2>📚 Shelf</h2>'
    + '<button class="btn ghost sm" style="margin-left:auto" onclick="openShelfItem(null)">＋ Add</button></div>';

  if (!items.length) {
    view.innerHTML = h + '<div class="empty"><div class="big">📚</div>Things worth keeping — books, arguments, '
      + 'ideas you want to come back to. Nothing here is a to-do list.'
      + '<br><button class="btn acc sm" style="margin-top:10px" onclick="openShelfItem(null)">Add the first one</button></div>';
    return;
  }

  if (topics.length > 1) {
    h += '<div class="subnav" style="margin-bottom:10px">'
      + '<button class="subbtn ' + (SHELF_TOPIC === null ? "on" : "") + '" onclick="shelfSetTopic(null)">All</button>'
      + topics.map(function (t) {
          return '<button class="subbtn ' + (SHELF_TOPIC === t ? "on" : "") + '" onclick="shelfSetTopic(' + JSON.stringify(t).replace(/"/g, "&quot;") + ')">' + esc(t) + '</button>';
        }).join("") + '</div>';
  }

  var shown = topics.filter(function (t) { return SHELF_TOPIC === null || t === SHELF_TOPIC; });
  shown.forEach(function (t) {
    var inTopic = items.filter(function (x) { return (x.topic || "Unfiled") === t; });
    /* ideas first: they're the frame the books hang off */
    var ideas = inTopic.filter(function (x) { return x.kind === "idea"; });
    var books = inTopic.filter(function (x) { return x.kind !== "idea"; });
    h += '<div class="secthd" style="margin-top:14px"><h2 style="font-size:16px">' + esc(t) + '</h2>'
      + '<span class="ct">' + inTopic.length + '</span></div>';

    if (ideas.length) {
      h += '<div class="card">';
      ideas.forEach(function (x) {
        h += '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openShelfItem(\'' + x.id + '\')">'
          + '<div class="grow"><div class="nm" style="white-space:normal">' + esc(x.title || "(untitled)") + '</div>'
          + (x.body ? '<div class="sub" style="white-space:pre-wrap;margin-top:3px">' + esc(x.body) + '</div>' : '')
          + (x.note ? '<div class="sub" style="white-space:pre-wrap;margin-top:5px;font-style:italic">Your note: ' + esc(x.note) + '</div>' : '')
          + '</div></div>';
      });
      h += '</div>';
    }
    if (books.length) {
      h += '<div class="card">';
      books.forEach(function (x) {
        var meta = [x.author, x.year].filter(Boolean).join(" · ");
        var st = shelfStatusLabel(x.status);
        h += '<div class="li" style="align-items:flex-start;cursor:pointer" onclick="openShelfItem(\'' + x.id + '\')">'
          + '<div class="grow"><div class="nm" style="white-space:normal">' + esc(x.title || "(untitled)")
          + (st ? ' <span class="muted" style="font-size:11px;font-weight:400">· ' + esc(st) + '</span>' : '')
          + '</div>'
          + (meta ? '<div class="sub">' + esc(meta) + '</div>' : '')
          + (x.body ? '<div class="sub" style="white-space:pre-wrap;margin-top:4px">' + esc(x.body) + '</div>' : '')
          + (x.note ? '<div class="sub" style="white-space:pre-wrap;margin-top:5px;font-style:italic">Your note: ' + esc(x.note) + '</div>' : '')
          + '</div></div>';
      });
      h += '</div>';
    }
  });
  view.innerHTML = h;
}
if (typeof window !== "undefined") window.shelfSetTopic = function (t) { SHELF_TOPIC = t; render(); };

/* ---- add / edit ---- */
if (typeof window !== "undefined") window.openShelfItem = function (id) {
  var isNew = !id;
  var x = isNew ? { id: "shf_" + uid(), kind: "book", topic: SHELF_TOPIC || "", title: "", author: "", year: "", body: "", note: "", status: "" }
                : actShelf().find(function (y) { return y.id === id; });
  if (!x) return;
  var topics = shelfTopics();
  modal(isNew ? "Add to the shelf" : "Shelf",
    '<label style="margin-top:0">Kind</label>'
    + '<select id="sh_kind"><option value="book"' + (x.kind !== "idea" ? " selected" : "") + '>Book / source</option>'
    + '<option value="idea"' + (x.kind === "idea" ? " selected" : "") + '>Idea / argument</option></select>'
    + '<label>Topic</label><input id="sh_topic" value="' + esc(x.topic || "") + '" placeholder="e.g. Feudalism → industry" autocomplete="off" list="sh_topics">'
    + '<datalist id="sh_topics">' + topics.map(function (t) { return '<option value="' + esc(t) + '">'; }).join("") + '</datalist>'
    + '<label>Title</label><input id="sh_title" value="' + esc(x.title || "") + '" autocomplete="off">'
    + '<div class="row" style="gap:8px"><div class="grow"><label>Author</label><input id="sh_author" value="' + esc(x.author || "") + '" autocomplete="off"></div>'
    + '<div style="flex:0 0 90px"><label>Year</label><input id="sh_year" value="' + esc(x.year || "") + '" autocomplete="off"></div></div>'
    + '<label>What it says / why it\'s here</label><textarea id="sh_body" rows="5">' + esc(x.body || "") + '</textarea>'
    + '<label>Your note</label><textarea id="sh_note" rows="3" placeholder="your own thoughts — optional">' + esc(x.note || "") + '</textarea>'
    + '<label>Status <span class="muted" style="font-weight:400">(optional — never counted or nagged)</span></label>'
    + '<select id="sh_status">'
    + ['', 'want', 'reading', 'read'].map(function (s) {
        return '<option value="' + s + '"' + (x.status === s ? " selected" : "") + '>' + (s ? shelfStatusLabel(s) : "—") + '</option>';
      }).join("") + '</select>'
    + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="saveShelfItem(\'' + x.id + '\',' + (isNew ? "true" : "false") + ')">Save</button>'
    + (isNew ? "" : '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="delShelfItem(\'' + x.id + '\')">Remove</button>'));
};
if (typeof window !== "undefined") window.saveShelfItem = function (id, isNew) {
  var title = val("sh_title"); if (!title) { alert("Give it a title."); return; }
  var d = D(); if (!d.shelfItems) d.shelfItems = [];
  var x = isNew ? { id: id } : d.shelfItems.find(function (y) { return y && y.id === id; });
  if (!x) return;
  x.kind = val("sh_kind") === "idea" ? "idea" : "book";
  x.topic = val("sh_topic") || "Unfiled";
  x.title = title;
  x.author = val("sh_author"); x.year = val("sh_year");
  x.body = val("sh_body"); x.note = val("sh_note"); x.status = val("sh_status");
  x.deleted = false;
  if (typeof touch === "function") touch(x);
  if (isNew) d.shelfItems.push(x);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  render();
};
if (typeof window !== "undefined") window.delShelfItem = function (id) {
  if (!confirm("Remove this from the shelf?")) return;
  var x = (D().shelfItems || []).find(function (y) { return y && y.id === id; });
  if (x) { x.deleted = true; if (typeof touch === "function") touch(x); if (typeof save === "function") save(); }
  if (typeof closeModal === "function") closeModal();
  render();
};

if (typeof window !== "undefined") { window.rShelf = rShelf; window.actShelf = actShelf; window.shelfTopics = shelfTopics; }
