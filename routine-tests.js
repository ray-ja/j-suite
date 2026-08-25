/* routine-tests.js — Today, shaped like a day.

   Ray, 2026-08-25: "i want the today page to look more like a routine. in order of morning stuff, like mood
   journal a quick little note of how i feel and stuff, then workout, then morning tasks like email checks,
   invoice statuses, etc. i run multiple businesses, today needs to be my one stop shop for what my day
   looks like"

   THREE THINGS THIS FILE DEFENDS:

   1. ⭐ THE ORDER IS THE FEATURE. He asked for a sequence, and a sequence is only correct if it's actually
      in order: mood note before workout before the business checks, morning before the day before evening.
      A refactor that shuffles the cards silently turns his routine back into a pile.

   2. ⭐ THE RESET HAS NO MOVING PARTS. `doneOn` is a DATE, not a boolean, so tomorrow un-ticks everything by
      itself. If anyone ever "simplifies" it to `done: true`, the routine sticks completed forever and there
      is nothing running at midnight to notice.

   3. ⛔ NO STREAKS, STRUCTURALLY. One overwritten date per item makes completion history uncomputable. That
      is deliberate — a daily checklist that remembers every miss is how the things he "likes the idea of"
      become nudges. This asserts on RENDERED OUTPUT, not source, because I have written tests before that
      passed by matching my own comments.

   Pure node. Run: node routine-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const SRC = R("js/141-routine.js"), HOME = R("js/122-personal-home.js");
const STATE = R("js/02-state.js"), SERVER = R("sync-server.js"), SHELL = R("Business App (v1).html");

/* ---------- a real sandbox: load the module against a fake store and CALL it ---------- */
const TODAY = "2026-08-25", YDAY = "2026-08-24";
function sandbox(store, org) {
  const ctx = {
    console, S: store, BIZ: org || "personal",
    D: function () { return store[this.BIZ]; },
    today: () => TODAY,
    esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    touch: (r) => { r.updatedAt = 1; return r; },
    save: () => { ctx.saved = (ctx.saved || 0) + 1; },
    render: () => {},
    uid: () => "u1",
    jobWorkDays: (j) => (j.date ? [j.date] : []),
    jobOnDay: (j, ds) => (j.date === ds),
    window: {}, saved: 0
  };
  ctx.D = () => store[ctx.BIZ];
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  Object.assign(ctx, ctx.window);       // the module hangs its writers on window
  return ctx;
}
const blankOrg = () => ({ routineItems: [], jobs: [], customers: [], todos: [] });

console.log("\n--- ⭐ the order he asked for, in order ---");
{
  const c = sandbox({ personal: blankOrg() });
  eq("three parts to a day", c.ROUTINE_PARTS.length, 3);
  ok("...morning, then the day, then evening",
    c.ROUTINE_PARTS.map(p => p.key).join(",") === "morning,day,evening", c.ROUTINE_PARTS.map(p => p.key));

  c.rtSeed();
  const morning = c.actRoutine().filter(r => r.part === "morning").map(r => r.key);
  ok("⭐ how he feels comes FIRST — 'mood journal a quick little note of how i feel'", morning[0] === "feel", morning);
  ok("⭐ then the workout — 'then workout'", morning[1] === "workout", morning);
  ok("⭐ then the business checks — 'then morning tasks like email checks, invoice statuses'",
    morning.indexOf("email") > morning.indexOf("workout") && morning.indexOf("invoices") > morning.indexOf("email"), morning);
  ok("the evening is where writing the day up lives", c.actRoutine().some(r => r.part === "evening" && r.key === "journal"));
}

console.log("\n--- ⭐ the reset has no moving parts: doneOn is a DATE, not a flag ---");
{
  const store = { personal: blankOrg() };
  const c = sandbox(store);
  c.rtSeed();
  const item = c.actRoutine()[0];

  ok("nothing is ticked on a fresh routine", !c.rtDone(item));
  c.rtTick(item.id);
  ok("ticking it marks it done today", c.rtDone(c.actRoutine().find(r => r.id === item.id)));
  eq("⭐ ...by writing TODAY'S DATE, not true", store.personal.routineItems.find(r => r.id === item.id).doneOn, TODAY);

  /* THE WHOLE POINT: roll the clock forward and the same record is simply un-ticked. Nothing ran. */
  const tomorrow = sandbox(store);
  tomorrow.today = () => "2026-08-26";
  vm.runInContext(SRC, tomorrow); Object.assign(tomorrow, tomorrow.window);
  ok("⭐ tomorrow every item is un-ticked again, with nothing running at midnight",
    tomorrow.actRoutine().every(r => !tomorrow.rtDone(r)));
  ok("...and the record was never touched to make that happen",
    store.personal.routineItems.find(r => r.id === item.id).doneOn === TODAY);

  c.rtTick(item.id);
  eq("un-ticking clears the date", store.personal.routineItems.find(r => r.id === item.id).doneOn, "");
  ok("a date from yesterday does not count as done today", !c.rtDone({ doneOn: YDAY }));
  ok("no field anywhere is a plain done boolean", !/doneOn *[:=] *(true|false)/.test(SRC));
}

console.log("\n--- ⛔ a streak is not computable from this data, by design ---");
{
  const c = sandbox({ personal: blankOrg() });
  c.rtSeed();
  c.rtTick(c.actRoutine()[0].id);
  const keys = new Set();
  c.actRoutine().forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  ok("⛔ there is no history array to count from", !["history", "log", "days", "doneDates", "streak"].some(k => keys.has(k)), [...keys]);
  /* `updatedAt` is sync plumbing on every record in the app, not a completion record — exclude it */
  const completion = [...keys].filter(k => /done|(?<!up)dated?$/i.test(k) && k !== "updatedAt");
  ok("⛔ ...only ONE date per item, overwritten", completion.join(",") === "doneOn", completion);

  /* and the rendered page never scores him — asserted on OUTPUT, because I've been fooled by my own comments */
  const html = c.ROUTINE_PARTS.map(p => c.rtPartHTML(p)).join("");
  ok("the page never says streak", !/streak/i.test(html));
  ok("...never shows a fraction of a target", !/\d+ *\/ *\d+/.test(html), (html.match(/\d+ *\/ *\d+/) || [])[0]);
  ok("...never shows a percentage", !/\d%/.test(html));
  ok("...and never says he missed anything", !/miss|behind|fail/i.test(html));
}

console.log("\n--- rendering: a routine item shows what it is, and what's left ---");
{
  const c = sandbox({ personal: blankOrg() });
  c.rtSeed();
  const morning = c.ROUTINE_PARTS[0];
  let html = c.rtPartHTML(morning);
  ok("it renders the part heading", /Morning/.test(html));
  ok("it renders his first item", /How are you feeling\?/.test(html));
  ok("a hint explains an item that needs explaining", /who&#39;s paid, who hasn&#39;t/.test(html) || /who's paid/.test(html));
  ok("the workout item opens the workout app", /workout\.html/.test(html));
  ok("the mood note opens a journal entry", /openLifeNote/.test(html));
  ok("checkboxes are thumb-sized on a phone", /width:22px;height:22px/.test(html));

  c.actRoutine().forEach(r => { if (r.part === "morning") c.rtTick(r.id); });
  html = c.rtPartHTML(morning);
  ok("a finished morning says so", /done<\/span>/.test(html));
  ok("...and strikes the finished items through", /line-through/.test(html));
  ok("...and drops their hints, because a done item needs no instructions", !/person waiting/.test(html));

  const empty = sandbox({ personal: blankOrg() });
  eq("⭐ an empty part renders NOTHING — a quiet day is a short page", empty.rtPartHTML(morning), "");
}

console.log("\n--- ⭐ one stop shop: every business's work for today, in one list ---");
{
  const store = {
    registry: [{ id: "personal", name: "RBJVL" }, { id: "obx", name: "OBX Lot Solutions" }, { id: "jam", name: "Jamieson Automation" }],
    personal: blankOrg(),
    obx: { routineItems: [], customers: [{ id: "c1", name: "Mike Green" }], jobs: [{ id: "j1", title: "Gutter relocation", date: TODAY, time: "09:00", customerId: "c1" }] },
    jam: { routineItems: [], customers: [], jobs: [
      { id: "j2", title: "Starlink install", date: TODAY },
      { id: "j3", title: "Yesterday's job", date: YDAY },
      { id: "j4", title: "Finished", date: TODAY, done: true },
      { id: "j5", title: "Deleted", date: TODAY, deleted: true }
    ] }
  };
  const c = sandbox(store, "personal");
  const html = c.rtJobsTodayHTML();
  ok("⭐ it reaches ACROSS orgs from the personal one", /Gutter relocation/.test(html) && /Starlink install/.test(html));
  ok("...naming which business each belongs to", /OBX Lot Solutions/.test(html) && /Jamieson Automation/.test(html));
  ok("⭐ ...and the CUSTOMER, resolved in the job's OWN org", /Mike Green/.test(html), html);
  ok("⛔ ...not an em-dash placeholder from looking the id up in the wrong store", !/Mike Green/.test(html) === false && !/>—</.test(html));
  ok("yesterday's job is not today's", !/Yesterday/.test(html));
  ok("a finished job is not today's", !/Finished/.test(html));
  ok("a deleted job is not today's", !/Deleted/.test(html));
  ok("earliest first", html.indexOf("Gutter") < html.indexOf("Starlink"));
  eq("nothing on today renders nothing", sandbox({ registry: [], personal: blankOrg() }).rtJobsTodayHTML(), "");

  /* registry entries that aren't orgs must not crash the sweep */
  const messy = sandbox({ registry: [{ id: "ghost", name: "Gone" }, { id: "personal", name: "P" }], personal: blankOrg() }, "personal");
  eq("a registry entry with no store is skipped, not thrown on", messy.rtJobsTodayHTML(), "");
}

console.log("\n--- it stays HIS routine: add, edit, remove ---");
{
  const store = { personal: blankOrg() };
  const c = sandbox(store);
  c.rtSeed();
  const before = c.actRoutine().length;

  c.val = (id) => ({ rt_label: "Call the accountant", rt_part: "day", rt_hint: "about the S-corp", rt_act: "" })[id];
  c.rtSave("");
  eq("he can add his own", c.actRoutine().length, before + 1);
  const mine = c.actRoutine().find(r => r.label === "Call the accountant");
  eq("...in the part he chose", mine.part, "day");
  eq("...with his own note", mine.hint, "about the S-corp");

  c.confirm = () => true;
  c.rtDel(mine.id);
  eq("he can take one out", c.actRoutine().length, before);

  /* ⭐ THE SEED IS IDEMPOTENT AND RESPECTS A DELETION. If seeding re-added what he removed, the routine
     would be mine, not his — every reload would undo his edit. */
  const seeded = c.actRoutine().find(r => r.key === "email");
  c.rtDel(seeded.id);
  const gone = c.actRoutine().length;
  eq("re-seeding adds nothing that already exists", c.rtSeed(), 0);
  eq("⭐ ...and never resurrects something he deleted", c.actRoutine().length, gone);
  ok("...he can still take out the mood note if he wants to", !c.actRoutine().some(r => r.key === "email"));

  c.val = (id) => ({ rt_label: "", rt_part: "morning", rt_hint: "", rt_act: "" })[id];
  c.alert = () => { c.alerted = 1; };
  c.rtSave("");
  ok("a blank item is refused", c.alerted === 1 && c.actRoutine().length === gone);
}

console.log("\n--- tapping an item can open the thing it's about ---");
{
  const c = sandbox({ personal: blankOrg() });
  ok("'just tick it off' is the first, default choice", c.ROUTINE_ACTIONS[0].key === "" && c.ROUTINE_ACTIONS[0].go === "");
  ok("every action has a label a person would recognise", c.ROUTINE_ACTIONS.every(a => a.label && !/^[a-z]+$/.test(a.label)));
  eq("an item with no action just ticks", c.rtAction({ action: "" }), "");
  eq("an unknown action degrades to just ticking, it doesn't throw", c.rtAction({ action: "nonsense" }), "");
  ok("the daily check-in is reachable now phQuickCard is gone", c.ROUTINE_ACTIONS.some(a => a.key === "checkin" && /navSub/.test(a.go)));
  ok("...as is the workout app", c.ROUTINE_ACTIONS.some(a => /workout\.html/.test(a.go)));
}

console.log("\n--- ⭐ Today reads top-to-bottom as a day ---");
{
  const body = (HOME.match(/function personalHome\(\)[\s\S]*?\n\}/) || [""])[0];
  const at = (s) => body.indexOf(s);
  ok("the greeting opens it", at("phGreeting") > 0);
  ok("...then the box he talks to", at("phTalkCard") > at("phGreeting"));
  ok('⭐ then MORNING', at('part("morning")') > at("phTalkCard"), body);
  ok("⭐ then what's on today across the businesses", at("rtJobsTodayHTML") > at('part("morning")'));
  ok("then his own plan for the day", at("phPlanCard") > at("rtJobsTodayHTML"));
  ok("then what the businesses need from him", at("piCardHTML") > at("phPlanCard"));
  ok("then dates and money", at("evHomeCardHTML") > at("piCardHTML") && at("calBillsCardHTML") > at("evHomeCardHTML"));
  ok('⭐ then DURING THE DAY', at('part("day")') > at("calBillsCardHTML"));
  ok('⭐ and EVENING last, because that is when evening is', at('part("evening")') > at('part("day")'));
  ok("the routine is seeded before it's drawn", at("rtSeed") < at('part("morning")') && at("rtSeed") > 0);
  ok("he can add to the routine from the page itself", /rtEdit/.test(body));

  ok("⛔ the floating 'Record something' row is gone — those live in the day's order now", !/phQuickCard\(\)/.test(HOME));
  ok("⛔ ...and the interests wall he asked me to remove has not come back", !/interests/i.test(body));
  ok("⛔ ...nor 'send me a file', which he said doesn't belong on Today", !/send me a file/i.test(HOME));

  /* every helper it calls is guarded, because Today blanking is the worst failure this page has */
  ["rtPartHTML", "rtJobsTodayHTML", "piCardHTML", "evHomeCardHTML", "calBillsCardHTML", "rtSeed"].forEach(fn => {
    ok(fn + " is called defensively, so a missing module can't blank Today",
      new RegExp('typeof ' + fn + ' [!=]== "function"').test(body), fn);
  });
}

console.log("\n--- the collection is wired into all three places ---");
{
  ok("blank() creates it", /routineItems *: *\[\]/.test(STATE));
  ok("⭐ the per-org backfill exists, so an EXISTING store gets it too", /routineItems *= *\[\]/.test(STATE));
  ok("⭐ it's in the server's COLLECTIONS, or it would never sync", /const COLLECTIONS = \[[^\]]*"routineItems"/.test(SERVER));
  ok("the module is registered in the shell", /js\/141-routine\.js/.test(SHELL));
  ok("...after the inbox it sits beside", SHELL.indexOf("js/141-routine.js") > SHELL.indexOf("js/140-personal-inbox.js"));
  ok("ids are stable across devices, so a re-seed dedupes instead of duplicating", /"rt_" \+ s\.key/.test(SRC));
  ok("removal is a soft delete — nothing is ever hard-deleted from the store", /\.deleted = true/.test(SRC) && !/splice\(/.test(SRC));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
