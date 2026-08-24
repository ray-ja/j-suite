/* ---------- READING LIST (js/138) — plan it, mark it off, rate it, write about it ---------------------
   Ray, 2026-08-24, with a screenshot of 16 short books: "please build these into it. this is a list of short
   stories i want to read. there should be a reading list where i can plan, mark off what i've read, review,
   and write notes about books"

   ⚠️ THE SHELF (js/123) WAS DELIBERATELY NOT THIS. Its header says so in as many words, because he had told
   me that reading-as-much-as-he-used-to is one of the things he "likes the idea of but never got good at",
   and a list with progress bars would convert that straight into guilt.

   He has now asked for a reading list. That is his call and it gets built. What stays out is the specific
   thing that would hurt, and the line is sharper than "no reading list":

     ✅ HIS record of HIS experience — read/reading/want, a rating, notes, when he finished it.
     ⛔ THE APP SCORING HIM — "3 of 16 read", a percentage, a streak, "you haven't read since Tuesday",
        a target, or anything that turns an unread book into a debt.

   Section headings show how many books are IN a section, the same way the Journal shows how many entries
   exist. That is a list length. A fraction is a verdict. Length yes, fraction never.

   ⭐ IT IS THE SAME RECORDS AS THE SHELF, not a parallel library. A book he wants to read, then reads, then
   keeps notes on IS a shelfItem moving through its status. Two places for books would mean two places to
   look and two places to forget. This module is a VIEW plus a seeder; editing still goes through js/123's
   openShelfItem. */

/* ---- the list from his screenshot. `pages` is approximate and is shown as "~N pp" for exactly that reason.
   `note` is used only where the entry needs a fact to be findable — several of these are not what the list
   claims, and he'd hit a wall searching. Stated once, in the record, not as a lecture. ---- */
var READING_SEED = [
  { key: "stranger",   title: "The Stranger",                    author: "Albert Camus",        year: "1942", pages: 123 },
  { key: "nose",       title: "The Nose",                        author: "Nikolai Gogol",       year: "1836", pages: 30 },
  { key: "venice",     title: "Death in Venice",                 author: "Thomas Mann",         year: "1912", pages: 80 },
  { key: "siddhartha", title: "Siddhartha",                      author: "Hermann Hesse",       year: "1922", pages: 152 },
  { key: "metam",      title: "The Metamorphosis",               author: "Franz Kafka",         year: "1915", pages: 55 },
  { key: "gotell",     title: "Go Tell It on the Mountain",      author: "James Baldwin",       year: "1953", pages: 256,
    note: "Nearer 250 pages than 120 — a full novel, not a short read. Worth it, but don't slot it into an evening." },
  { key: "kant",       title: "Critique of Practical Reason",    author: "Immanuel Kant",       year: "1788", pages: 200,
    note: "~200 pages and genuinely hard going — the only thing here that is difficult rather than just short." },
  { key: "confession", title: "A Confession",                    author: "Leo Tolstoy",         year: "1882", pages: 90,
    note: "Usually published as “A Confession”, not “Confessions” (that's Augustine and Rousseau)." },
  { key: "aintiaw",    title: "Ain't I a Woman?",                author: "Sojourner Truth",     year: "1851", pages: 3,
    note: "A speech, not a book — a few minutes to read. The BOOK of that title is bell hooks (1981), which is a different and much longer thing." },
  { key: "nietzsche",  title: "The Gay Science §125 / Zarathustra", author: "Friedrich Nietzsche", year: "1882", pages: 10,
    note: "⚠️ There is no Nietzsche book called “God is Dead”. The line is from The Gay Science §125 (“The Madman”) and returns in Thus Spoke Zarathustra. §125 alone is a couple of pages." },
  { key: "roomofown",  title: "A Room of One's Own",             author: "Virginia Woolf",      year: "1929", pages: 112 },
  { key: "nausea",     title: "Nausea",                          author: "Jean-Paul Sartre",    year: "1938", pages: 178 },
  { key: "schoolgirl", title: "Schoolgirl",                      author: "Osamu Dazai",         year: "1939", pages: 88 },
  { key: "wasteland",  title: "The Waste Land",                  author: "T. S. Eliot",         year: "1922", pages: 30,
    note: "A poem, ~430 lines. Short to read, slow to get through — most editions carry more notes than poem." },
  { key: "melancholy", title: "Memories of My Melancholy Whores", author: "Gabriel García Márquez", year: "2004", pages: 115 }
];
var READING_TOPIC = "Short reads";

var RL_VIEW = "list";     // "list" = the reading list, "shelf" = the reference shelf (js/123)

function rlBooks() {
  return ((typeof actShelf === "function") ? actShelf() : [])
    .filter(function (x) { return x && x.kind !== "idea"; });
}
function rlByStatus(s) {
  return rlBooks().filter(function (x) { return (x.status || "") === s; })
    .sort(function (a, b) { return String(a.title || "").localeCompare(String(b.title || "")); });
}
function rlStars(n) {
  n = Math.max(0, Math.min(5, +n || 0));
  return n ? "★".repeat(n) + "☆".repeat(5 - n) : "";
}
function rlPages(x) { return (+x.pages > 0) ? "~" + (+x.pages) + " pp" : ""; }

/* seed his list once. Idempotent by `seedKey`, same pattern as the playbook library — re-running adds
   only what's missing, so a book he deletes stays deleted rather than reappearing every load. */
function rlSeed() {
  try {
    var d = D(); if (!Array.isArray(d.shelfItems)) d.shelfItems = [];
    var have = {};
    d.shelfItems.forEach(function (x) { if (x && x.seedKey) have[x.seedKey] = 1; });
    var added = 0;
    READING_SEED.forEach(function (s) {
      if (have[s.key]) return;
      var r = { id: "shf_rl_" + s.key, seedKey: s.key, kind: "book", topic: READING_TOPIC,
                title: s.title, author: s.author, year: s.year || "", pages: s.pages || 0,
                body: "", note: s.note || "", status: "want", rating: 0, finishedOn: "", deleted: false };
      if (typeof touch === "function") touch(r);
      d.shelfItems.push(r); added++;
    });
    if (added && typeof save === "function") save();
    return added;
  } catch (e) { return 0; }
}

/* ---- the reading list screen ---- */
function rlHTML() {
  var want = rlByStatus("want"), reading = rlByStatus("reading"), read = rlByStatus("read");
  var unset = rlBooks().filter(function (x) { return !x.status; });
  var h = "";

  if (!rlBooks().length) {
    return '<div class="empty"><div class="big">📖</div>Nothing on the list yet.'
      + '<br><button class="btn acc sm" style="margin-top:10px" onclick="rlAddSeed()">Add the 16 short reads</button>'
      + '<button class="btn ghost sm" style="margin-top:8px" onclick="openShelfItem(null)">Add a book yourself</button></div>';
  }

  h += rlSection("Reading now", reading, true);
  h += rlSection("Want to read", want, false);
  h += rlSection("Unfiled", unset, false);
  h += rlSection("Read", read, false);
  h += '<button class="btn ghost sm" style="width:100%;margin-top:10px" onclick="openShelfItem(null)">＋ Add a book</button>';
  return h;
}

/* a section. The count is the LENGTH of the section, never a fraction of a target. */
function rlSection(label, list, openFirst) {
  if (!list.length) return "";
  var h = '<div class="secthd"><h2 style="font-size:15px">' + esc(label) + '</h2><span class="ct">' + list.length + '</span></div>';
  h += '<div class="card" style="padding:6px 10px">';
  list.forEach(function (x) {
    var meta = [x.author || "", x.year || "", rlPages(x)].filter(Boolean).join(" · ");
    h += '<div class="li" style="align-items:flex-start">'
      + '<div class="grow" style="cursor:pointer" onclick="openShelfItem(\'' + x.id + '\')">'
      + '<div class="nm">' + esc(x.title || "Untitled") + '</div>'
      + (meta ? '<div class="sub" style="white-space:normal">' + esc(meta) + '</div>' : '')
      + (x.rating ? '<div class="sub" style="margin-top:2px;letter-spacing:1px">' + rlStars(x.rating) + '</div>' : '')
      + (x.note ? '<div class="sub" style="white-space:normal;margin-top:3px;font-style:italic">' + esc(x.note) + '</div>' : '')
      + '</div>'
      + rlStatusBtns(x)
      + '</div>';
  });
  return h + '</div>';
}

/* one tap to move a book along. No confirmation — it's his list and it's trivially reversible. */
function rlStatusBtns(x) {
  var s = x.status || "";
  var b = function (to, label, title) {
    return '<button class="btn ' + (s === to ? "acc" : "ghost") + ' sm" style="flex:0 0 auto;padding:3px 8px"'
      + ' title="' + esc(title) + '" onclick="rlSetStatus(\'' + x.id + '\',\'' + to + '\')">' + label + '</button>';
  };
  return '<div class="row" style="flex:0 0 auto;gap:4px">'
    + b("reading", "📖", "Reading now")
    + b("read", "✓", "Finished it")
    + '</div>';
}

if (typeof window !== "undefined") {
  window.READING_SEED = READING_SEED;
  window.rlSeed = rlSeed;
  window.rlHTML = rlHTML;
  window.rlBooks = rlBooks;
  window.rlByStatus = rlByStatus;
  window.rlStars = rlStars;

  window.rlAddSeed = function () {
    var n = rlSeed();
    if (typeof render === "function") render();
    if (!n) alert("They're already on your list.");
  };

  window.rlSetStatus = function (id, to) {
    var x = ((typeof actShelf === "function") ? actShelf() : []).find(function (y) { return y.id === id; });
    if (!x) return;
    x.status = (x.status === to) ? "" : to;           // tapping the active one clears it
    /* stamp when he finished it — useful to look back on, and never used to compute a rate or a streak */
    if (x.status === "read" && !x.finishedOn) x.finishedOn = (typeof today === "function") ? today() : "";
    if (x.status !== "read") x.finishedOn = "";
    if (typeof touch === "function") touch(x);
    if (typeof save === "function") save();
    if (typeof render === "function") render();
  };

  window.rlSetView = function (v) { RL_VIEW = (v === "shelf") ? "shelf" : "list"; if (typeof render === "function") render(); };
  window.rlView = function () { return RL_VIEW; };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { READING_SEED: READING_SEED, rlStars: rlStars, READING_TOPIC: READING_TOPIC };
}
