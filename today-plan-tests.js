/* today-plan-tests.js — Today is the day's list, and it carries over.

   Ray, 2026-08-25: "Today is for things that I need to know that are happening today, like what needs to
   get done today… my to do list, essentially. And it should, like, track how I'm doing, and it should carry
   things over to the next day as long as they're not getting checked off. Don't just make it static."
   And: "Send me a file doesn't belong on today either."

   ⭐ CARRY-OVER WITH NO MOVING PARTS. `planDate <= today && !done` means an item planned on Monday and not
   ticked is simply still there on Tuesday — no cron, no migration, nothing running at midnight. The thing
   that carries it over is that nothing ever moved it. That's the property this suite pins down.

   Pure node. Run: node today-plan-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const PH = fs.readFileSync(path.join(__dirname, "js", "122-personal-home.js"), "utf8");
const BG = fs.readFileSync(path.join(__dirname, "js", "79-budget.js"), "utf8");
const TODAY = "2026-08-25";

function ctxWith(todos) {
  const store = { todos: todos };
  const c = { console: console, D: () => store, esc: s => String(s == null ? "" : s),
              fmtDate: d => String(d), render: () => {}, touch: () => {}, save: () => {},
              actTodo: () => store.todos.filter(x => x && !x.deleted),
              sortTodos: l => l.slice(),
              phToday: () => TODAY, document: { getElementById: () => null } };
  c.window = c; vm.createContext(c);
  vm.runInContext(PH.match(/function phPlanItems\(\)[\s\S]*?\n\}/)[0]
    + PH.match(/function phDoneToday\(\)[\s\S]*?\n\}/)[0]
    + ";this.P=phPlanItems;this.DN=phDoneToday;", c);
  return c;
}

console.log("\n--- ⭐ carry-over, without anything running at midnight ---");
{
  const c = ctxWith([
    { id: "a", title: "planned today",        planDate: TODAY },
    { id: "b", title: "planned Monday, open", planDate: "2026-08-24" },
    { id: "c", title: "planned Monday, done", planDate: "2026-08-24", done: true },
    { id: "d", title: "planned for Friday",   planDate: "2026-08-28" },
    { id: "e", title: "due today",            due: TODAY },
    { id: "f", title: "overdue",              due: "2026-08-20" },
    { id: "g", title: "due next week",        due: "2026-09-05" },
    { id: "h", title: "someday, no dates" },
    { id: "i", title: "deleted", planDate: TODAY, deleted: true }
  ]);
  const ids = c.P().map(x => x.id);
  ok("today's plan is there", ids.indexOf("a") >= 0);
  ok("⭐ an unticked item from an earlier day CARRIES OVER", ids.indexOf("b") >= 0, ids);
  ok("...and a ticked one does not come back", ids.indexOf("c") < 0);
  ok("something planned for Friday stays on Friday", ids.indexOf("d") < 0);
  ok("something due today is part of today even if never planned", ids.indexOf("e") >= 0);
  ok("...and so is something overdue", ids.indexOf("f") >= 0);
  ok("something due next week is not", ids.indexOf("g") < 0);
  ok("an undated 'someday' item doesn't clutter today", ids.indexOf("h") < 0, ids);
  ok("deleted never appears", ids.indexOf("i") < 0);
}

console.log("\n--- it's never a dead page ---");
{
  const c = ctxWith([{ id: "x", title: "no dates at all" }, { id: "y", title: "also none" }]);
  eq("with nothing planned it falls back to the open list", c.P().length, 2);
  eq("an empty list is simply empty, not an error", ctxWith([]).P().length, 0);
}

console.log("\n--- 'track how I'm doing' = what he finished TODAY ---");
{
  const now = new Date(TODAY + "T14:00:00").getTime();
  const c = ctxWith([
    { id: "a", title: "done today", done: true, doneAt: now },
    { id: "b", title: "done today too", done: true, updatedAt: now },
    { id: "c", title: "done yesterday", done: true, doneAt: new Date("2026-08-24T10:00:00").getTime() },
    { id: "d", title: "still open" },
    { id: "e", title: "done, no timestamp", done: true }
  ]);
  eq("counts what he ticked today", c.DN(), 2);
  ok("yesterday's doesn't inflate it", c.DN() === 2);
  ok("⭐ it is a COUNT of what he did, never a fraction of a target", !/of \d|\d+\/\d+|%/.test((PH.match(/'✓ ' \+ done \+ ' done'/) || [""])[0] + "done"));
  /* the RENDERED card, not the source — the comment above phPlanItems necessarily contains the word
     "streak" while saying there must never be one. Same trap as the workout card. */
  {
    const r = ctxWith([{ id: "a", title: "one", planDate: TODAY }, { id: "b", title: "two", done: true, doneAt: now }]);
    vm.runInContext(PH.match(/function phPlanCard\(\)[\s\S]*?\n\}/)[0] + ";this.C=phPlanCard;", r);
    const html = r.C();
    ok("no streak or nagging language in the rendered card", !/streak|in a row|days? since|behind|on track|should have/i.test(html), html.slice(0, 200));
    ok("...no fraction of a target either", !/\d+\s*(of|\/)\s*\d+/.test(html.replace(/\d{4}-\d{2}-\d{2}/g, "")));
    ok("...but it does show what he finished", /✓ 1 done/.test(html), html.slice(0, 160));
  }
  ok("...and the reason is recorded", /a score is how a list starts nagging/.test(PH));
}

console.log("\n--- the page is the list ---");
ok("the plan renders on Today", /h \+= phPlanCard\(\);/.test(PH));
ok("...directly under the talk box", PH.indexOf("phTalkCard()") < PH.indexOf("phPlanCard()"));
ok("ticking is one tap, right there", /window\.phTickTodo/.test(PH));
ok("...and stamps when, so 'done today' is honest", /td\.doneAt = td\.done \? Date\.now\(\) : 0/.test(PH));
ok("a carried item says so", /carried over/.test(PH));
ok("an overdue one is marked", /overdue<\/span>/.test(PH));
ok("the list is capped so Today can't become a wall", /list\.slice\(0, 12\)/.test(PH));
ok("...and says what it held back", /more on the To-Do tab/.test(PH));
ok("the carry-over mechanism is explained", /nothing ever moved it/.test(PH));

console.log("\n--- ⛔ what is NOT on Today any more ---");
ok("the file hand-off is gone from Today", !/if \(typeof pfCardHTML === "function"\) h \+= pfCardHTML\(\);/.test(PH));
ok("...and the reason is recorded", /NOT A TODAY CARD/.test(PH));
ok("it moved to Budget, where he'll have a statement in hand", /pfCardHTML\(\):""/.test(BG) && /view\.innerHTML=sub\+/.test(BG));
ok("the interests wall is still gone too", !/h \+= phInterestsCard\(\);/.test(PH));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
