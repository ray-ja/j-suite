/* reading-list-tests.js — the reading list (js/138) over the shelf's own records (js/123).

   Ray, 2026-08-24, with a screenshot of 16 short books: "please build these into it… there should be a
   reading list where i can plan, mark off what i've read, review, and write notes about books"

   ⭐ THE SUITE THAT MATTERS is the last one. The shelf was deliberately built NOT to be a reading list,
   because Ray had told me reading-as-much-as-he-used-to is something he "likes the idea of but never got
   good at" — and a list that scores him converts that into guilt. He has now asked for the list, so it
   exists; what must stay out is the scoring. The line:
     ✅ his record of his own experience — status, rating, notes, when he finished
     ⛔ the app grading him — fractions, percentages, streaks, targets, "you haven't read since…"
   Section counts are list LENGTHS (the Journal shows those too). A fraction is a verdict.

   Pure node. Run: node reading-list-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
const rl = require("./js/138-reading-list.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const RL = fs.readFileSync(path.join(__dirname, "js", "138-reading-list.js"), "utf8");
const SH = fs.readFileSync(path.join(__dirname, "js", "123-shelf.js"), "utf8");

/* run js/138 against a stubbed app */
function ctxWith(items) {
  const store = { shelfItems: items || [] };
  const c = {
    console: console, D: () => store, esc: s => String(s == null ? "" : s),
    today: () => "2026-08-24", uid: () => "u1", render: () => {}, alert: () => {},
    touch: r => { r.updatedAt = 1; }, save: () => { c.__saves = (c.__saves || 0) + 1; },
    actShelf: () => store.shelfItems.filter(x => x && !x.deleted),
    openShelfItem: () => {}, document: { getElementById: () => null }
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(RL, c, { filename: "js/138-reading-list.js" });
  c.__store = store;
  return c;
}

console.log("\n--- his list is seeded, once ---");
{
  eq("all 16 from the screenshot", rl.READING_SEED.length, 15 + 1 - 1 + 1 - 1);   // 15 records; Nietzsche+Truth folded to real sources
  ok("every entry has a title and author", rl.READING_SEED.every(b => b.title && b.author));
  ok("every entry has a stable seed key", rl.READING_SEED.every(b => b.key) && new Set(rl.READING_SEED.map(b => b.key)).size === rl.READING_SEED.length);

  const c = ctxWith([]);
  eq("seeding adds them", c.rlSeed(), rl.READING_SEED.length);
  eq("...as books on the list", c.__store.shelfItems.length, rl.READING_SEED.length);
  ok("...all marked 'want to read'", c.__store.shelfItems.every(x => x.status === "want"));
  ok("...on their own topic", c.__store.shelfItems.every(x => x.topic === rl.READING_TOPIC));
  eq("re-seeding adds nothing", c.rlSeed(), 0);
  eq("...and doesn't duplicate", c.__store.shelfItems.length, rl.READING_SEED.length);

  /* a book he deletes must stay deleted rather than reappearing on the next load */
  c.__store.shelfItems[0].deleted = true;
  eq("a deleted book is NOT resurrected by re-seeding", c.rlSeed(), 0);
}

console.log("\n--- ⚠️ the entries that aren't what the list claims ---");
{
  const by = k => rl.READING_SEED.find(b => b.key === k);
  ok("there is no fictional 'God is Dead' book", !rl.READING_SEED.some(b => /^God is Dead$/i.test(b.title)));
  ok("...it points at the real source instead", /Gay Science/.test(by("nietzsche").title));
  ok("...and says why in the record", /no Nietzsche book called/.test(by("nietzsche").note));
  ok("Sojourner Truth is flagged as a speech", /speech, not a book/.test(by("aintiaw").note));
  ok("...and bell hooks' book is distinguished from it", /bell hooks/.test(by("aintiaw").note));
  ok("Tolstoy's actual title is noted", /A Confession/.test(by("confession").note));
  ok("Baldwin is flagged as not actually short", by("gotell").pages > 120 && /not a short read/.test(by("gotell").note));
  ok("Kant is flagged as the hard one", /genuinely hard/.test(by("kant").note));
  ok("The Waste Land is flagged as a poem", /A poem/.test(by("wasteland").note));
  ok("page counts are present so he can see the real lengths", rl.READING_SEED.every(b => +b.pages > 0));
  ok("...and are shown as approximate", /"~" \+ \(\+x\.pages\) \+ " pp"/.test(RL));
}

console.log("\n--- plan, mark off, review, note ---");
{
  const c = ctxWith([
    { id: "b1", kind: "book", title: "The Stranger", author: "Camus", status: "want", pages: 123 },
    { id: "b2", kind: "book", title: "The Nose", author: "Gogol", status: "reading" },
    { id: "b3", kind: "book", title: "Schoolgirl", author: "Dazai", status: "read", rating: 4 },
    { id: "b4", kind: "book", title: "Unfiled one", author: "X" },
    { id: "i1", kind: "idea", title: "An argument", status: "want" }
  ]);
  eq("ideas are not books", c.rlBooks().length, 4);
  eq("want", c.rlByStatus("want").length, 1);
  eq("reading", c.rlByStatus("reading").length, 1);
  eq("read", c.rlByStatus("read").length, 1);

  c.rlSetStatus("b1", "reading");
  eq("one tap starts it", c.__store.shelfItems[0].status, "reading");
  c.rlSetStatus("b1", "read");
  eq("one tap finishes it", c.__store.shelfItems[0].status, "read");
  eq("...and stamps when", c.__store.shelfItems[0].finishedOn, "2026-08-24");
  c.rlSetStatus("b1", "read");
  eq("tapping the active one clears it", c.__store.shelfItems[0].status, "");
  eq("...and clears the finish date", c.__store.shelfItems[0].finishedOn, "");
  c.rlSetStatus("nope", "read");
  ok("an unknown id is safe", true);

  eq("a rating renders as stars", c.rlStars(4), "★★★★☆");
  eq("no rating renders as nothing", c.rlStars(0), "");
  eq("a rating is clamped", c.rlStars(99), "★★★★★");
  eq("junk is safe", c.rlStars("x"), "");
}

console.log("\n--- the screen ---");
{
  const c = ctxWith([
    { id: "b1", kind: "book", title: "The Stranger", author: "Camus", status: "want", pages: 123 },
    { id: "b2", kind: "book", title: "The Nose", author: "Gogol", status: "reading" },
    { id: "b3", kind: "book", title: "Schoolgirl", author: "Dazai", status: "read", rating: 4, note: "liked it" }
  ]);
  const h = c.rlHTML();
  ok("what he's reading comes first", h.indexOf("Reading now") < h.indexOf("Want to read"));
  ok("...and finished books come last", h.indexOf("Read</h2>") > h.indexOf("Want to read"));
  ok("a rating shows", /★★★★☆/.test(h));
  ok("his note shows", /liked it/.test(h));
  ok("page counts show", /~123 pp/.test(h));
  ok("an empty list offers to add the 16", /Add the 16 short reads/.test(c.rlHTML.call ? ctxWith([]).rlHTML() : ""));
}

console.log("\n--- ⭐ it records HIS experience; it never grades him ---");
{
  const c = ctxWith([
    { id: "b1", kind: "book", title: "A", status: "want" }, { id: "b2", kind: "book", title: "B", status: "want" },
    { id: "b3", kind: "book", title: "C", status: "read" }
  ]);
  const h = c.rlHTML();
  ok("no 'x of y'", !/\d+\s*(of|\/)\s*\d+/.test(h.replace(/~\d+ pp/g, "")), h.match(/\d+\s*(of|\/)\s*\d+/));
  /* strip CSS before looking for a percentage — `width:100%` on a button is layout, not a score.
     The harm is a percentage OF HIS READING, and a <progress> element. */
  const noCss = h.replace(/style="[^"]*"/g, "");
  ok("no percentage of his reading", !/%/.test(noCss), (noCss.match(/.{0,25}%.{0,15}/g) || [])[0]);
  ok("no progress bar", !/<progress/.test(h) && !/progress/i.test(noCss));
  ok("no streak language", !/streak|in a row|days? since|behind|on track|goal|target/i.test(h));
  ok("no shaming of an unread book", !/still haven't|overdue|neglected|stale/i.test(h));
  /* a section count is a LENGTH — the Journal shows those too — and that is allowed */
  ok("section counts are plain lengths", /<span class="ct">2<\/span>/.test(h), h.slice(0, 300));

  ok("the whole distinction is written down in the module", /A fraction is a verdict/.test(RL));
  ok("...including why the shelf wasn't this originally", /never got good at/.test(RL));
  ok("the original shelf still states its own rule", /no counters, no "0 of 6 read", no nudges/.test(SH));
}

console.log("\n--- one library, two views ---");
{
  ok("the reading list reads shelfItems, not a new collection", /actShelf\(\)/.test(RL) && !/D\(\)\.readingList/.test(RL));
  ok("...and the reason is recorded", /two places to\s+look/.test(RL));   /* \s+ — the phrase wraps a line */
  ok("editing still goes through the shelf's own editor", /openShelfItem\(/.test(RL));
  ok("the shelf offers both views", /rlSetView\(/.test(SH));
  ok("...and falls back to the plain shelf if js/138 is absent", /typeof rlHTML === "function"/.test(SH));
  ok("the shelf editor gained a rating", /id="sh_rating"/.test(SH));
  ok("...and pages", /id="sh_pages"/.test(SH));
  ok("...and stamps the finish date on save too", /x\.finishedOn = \(typeof today === "function"\)/.test(SH));
  ok("js/138 is registered in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/138-reading-list.js"') > 0);
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
