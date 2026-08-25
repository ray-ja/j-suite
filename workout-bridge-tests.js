/* workout-bridge-tests.js — bridging Ray's own workout app into j-Suite (js/139).

   Ray, 2026-08-24, uploading rjworkout.html: "this is my workout app. could we integrate it or bridge it so
   you can track my workouts?"

   ⭐ BRIDGE, NOT PORT. His app is 92KB of working single-file HTML he built and uses. It is now served from
   j-Suite's own origin, so the two share a localStorage and this module can READ `rj-workout-v3` and mirror
   a summary in. His file must stay byte-identical to what he uploaded — the moment we start editing it, he
   can no longer improve his own app and drop the new version in.

   ⚠️ AND IT MIRRORS A SUMMARY, NOT THE RAW BLOB. His state copies the whole `intents` object into every one
   of up to 120 history days; storing that verbatim would bloat data.json for no benefit.

   Everything here is CALLED, not regex-matched.

   Pure node. Run: node workout-bridge-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
const wk = require("./js/139-workout.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const WK = fs.readFileSync(path.join(__dirname, "js", "139-workout.js"), "utf8");
const ST = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const LF = fs.readFileSync(path.join(__dirname, "js", "78-life-tracker.js"), "utf8");

/* his REAL plan shape, lifted straight out of his file so the tests can't drift from it */
const HTML = fs.readFileSync(path.join(__dirname, "workout.html"), "utf8");
const DAYS = (function () {
  const m = HTML.match(/function strengthDays\(\) \{ return \[[\s\S]*?\n\]; \}/);
  const c = {}; vm.createContext(c);
  vm.runInContext((m ? m[0] : "function strengthDays(){return []}") + ";this.d=strengthDays();", c);
  return c.d;
})();

const RAW = {
  version: 4, activePlanId: "p1",
  plans: [{ id: "p1", name: "Strength", days: DAYS, history: [
    { date: "2026-08-22", days: { mon: {
        bench: [{ weight: 135, reps: 10 }, { weight: 135, reps: 9 }],
        diamond_pushup: [{ weight: 0, reps: 15 }],
        lat_raise_mon: [{ weight: 0, reps: 0 }]            // untouched — must not count as a set
      } }, intents: { huge: "blob".repeat(500) } },
    { date: "2026-08-20", days: { tue: { bb_row: [{ weight: 115, reps: 12 }] } } }
  ] }],
  bodyLog: [{ date: "2026-08-23", weight: 196, bodyFat: 22, notes: "ok" },
            { date: "2026-08-16", weight: 198, bodyFat: null, notes: "" }],
  heightInches: 70
};

console.log("\n--- his real plan parses ---");
{
  ok("six training days come out of his own file", DAYS.length === 6, DAYS.map(d => d.id));
  const names = wk.wkNameMap(DAYS);
  eq("an exercise id resolves to its real name", names.mon.ex.bench.name, "Barbell Bench Press");
  eq("...with its unit", names.mon.ex.diamond_pushup.unit, "BW");
  eq("a day resolves to its weekday", names.tue.day, "Tuesday");
  eq("an unknown day is safe", JSON.stringify(wk.wkNameMap(null)), "{}");
}

console.log("\n--- ⭐ a history day becomes a readable session ---");
{
  const s = wk.wkSessions(RAW);
  eq("two sessions", s.length, 2);
  eq("newest first", s[0].date, "2026-08-22");
  eq("named by the weekday", s[0].dayName, "Monday");
  eq("only exercises he actually did", s[0].exercises.length, 2);
  ok("an all-zero exercise is not a set", !s[0].exercises.some(e => e.name === "DB Lateral Raise"), s[0].exercises.map(e => e.name));
  eq("sets are counted", s[0].setCount, 3);
  eq("volume is weight × reps summed", s[0].volume, 135 * 10 + 135 * 9);
  eq("exercise names are real, not ids", s[0].exercises[0].name, "Barbell Bench Press");
  eq("bodyweight work keeps its unit", s[0].exercises[1].unit, "BW");
  eq("...and its reps", s[0].exercises[1].sets[0].reps, 15);

  eq("the id is stable per date+day", s[0].id, "wk_2026-08-22_mon");
  eq("...so re-summarising is idempotent", wk.wkSessions(RAW)[0].id, s[0].id);

  ok("⚠️ the giant intents blob is NOT carried into the record", JSON.stringify(s[0]).indexOf("blobblob") < 0);
  ok("...and the reason is recorded", /would bloat data\.json/.test(WK));
}

console.log("\n--- shapes it must survive ---");
{
  eq("no data at all", wk.wkSessions(null).length, 0);
  eq("no plans", wk.wkSessions({}).length, 0);
  eq("a plan with no history", wk.wkSessions({ plans: [{ id: "p", days: DAYS }] }).length, 0);
  eq("a history day with nothing done", wk.wkSessions({ plans: [{ id: "p", days: DAYS, history: [{ date: "2026-01-01", days: { mon: {} } }] }] }).length, 0);
  /* rounds arrive as an object keyed by index in some of his saves, not always an array */
  const obj = wk.wkSessions({ plans: [{ id: "p", days: DAYS, history: [{ date: "2026-01-02", days: { mon: { bench: { "0": { weight: 100, reps: 5 } } } } }] }] });
  eq("object-keyed rounds still summarise", obj.length, 1);
  eq("...with the right volume", obj[0].volume, 500);
  eq("a history entry with no date is skipped", wk.wkSessions({ plans: [{ id: "p", days: DAYS, history: [{ days: { mon: { bench: [{ weight: 1, reps: 1 }] } } }] }] }).length, 0);
  eq("sessions across multiple plans all appear", wk.wkSessions({ plans: [RAW.plans[0], { id: "p2", days: DAYS, history: [{ date: "2026-08-25", days: { wed: {} } }] }] }).length, 2);
}

console.log("\n--- the body log ---");
{
  const b = wk.wkBody(RAW);
  eq("both weigh-ins", b.length, 2);
  eq("newest first", b[0].date, "2026-08-23");
  eq("weight comes through", b[0].weight, 196);
  eq("body fat comes through", b[0].bodyFat, 22);
  eq("a null body fat stays null, not 0", b[1].bodyFat, null);
  eq("no body log is safe", wk.wkBody({}).length, 0);
  eq("null is safe", wk.wkBody(null).length, 0);
}

console.log("\n--- ⭐ his file is the source of truth and is never edited ---");
{
  const orig = fs.readFileSync("/home/rzy/.claude/uploads/18f805d7-7735-4655-82ce-5b7c39964826/b5c826a3-rjworkout.html");
  const hosted = fs.readFileSync(path.join(__dirname, "workout.html"));
  ok("the hosted copy is byte-identical to what he uploaded", Buffer.compare(orig, hosted) === 0);
  ok("the bridge only READS his storage key", /localStorage\.getItem\(WK_KEY\)/.test(WK));
  ok("...and only writes it on the one-time import, never over existing data", /if \(!localStorage\.getItem\(WK_KEY\)\)/.test(WK));
  ok("the bridge-not-port decision is recorded", /BRIDGE, NOT PORT/.test(WK));
}

console.log("\n--- wired end to end ---");
ok("workoutLogs is in blank()", /workoutLogs:\[\]/.test(ST));
ok("...backfilled on every org slab", (ST.match(/S\[b\]\.workoutLogs/g) || []).length >= 2);
ok("...and in the server COLLECTIONS", /const COLLECTIONS = \[[^\]]*"workoutLogs"/.test(SV));
ok("the app is served from j-Suite's own origin", /path\.join\(__dirname,"workout\.html"\)/.test(SV));
ok("...with an html content type", /"\.html": "text\/html/.test(SV));
ok("...and the allowlist stays explicit, not 'any html'", /never becomes "any \.html in the folder"/.test(SV));
ok("the same-origin token exposure is called out", /can read the sync token/.test(SV));
ok("the card is on the Life tab", /wkCardHTML==="function"\)h\+=wkCardHTML\(\)/.test(LF));
ok("...and degrades if js/139 is absent", /typeof wkCardHTML==="function"/.test(LF));
ok("it mirrors on load without him pressing anything", /setTimeout\(function \(\) \{ try \{ wkSync\(\); \}/.test(WK));
ok("there is a one-time carry-over for his old history", /wkImportSave/.test(WK));
ok("js/139 is registered in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/139-workout.js"') > 0);

console.log("\n--- it logs, it doesn't grade ---");
{
  /* the RENDERED CARD, not the source — the source comment necessarily names the phrases it forbids,
     which is exactly what an earlier version of this assertion tripped over. */
  const store = { workoutLogs: [
    { id: "w1", date: "2026-08-22", dayName: "Monday", label: "Push", setCount: 3, volume: 2565, exercises: [] },
    { id: "w2", date: "2026-08-20", dayName: "Tuesday", label: "Pull", setCount: 1, volume: 1380, exercises: [] },
    { id: "wk_body", kind: "body", date: "2026-08-23", series: [{ date: "2026-08-23", weight: 196, bodyFat: 22 }] }
  ] };
  const c = { console: console, D: () => store, esc: s2 => String(s2 == null ? "" : s2),
              fmtDate: d2 => String(d2), localStorage: { getItem: () => null, setItem: () => {} },
              setTimeout: () => 0, modal: () => {}, render: () => {}, alert: () => {},
              document: { getElementById: () => null } };
  c.window = c; vm.createContext(c); vm.runInContext(WK, c, { filename: "js/139-workout.js" });
  const h = c.wkCardHTML();
  ok("the card shows what he did", /Monday/.test(h) && /3 sets/.test(h), h.slice(0, 200));
  ok("...and his own numbers", /2,565 lb moved/.test(h));
  ok("...and his latest weigh-in", /196 lb/.test(h));
  ok("no streak, target or shaming language in the card", !/streak|on track|goal|behind|haven't|should|missed/i.test(h), (h.match(/.{0,20}(streak|goal|behind|haven't|missed).{0,20}/i) || [])[0]);
  ok("no 'x of y' progress fraction", !/\d+\s*(of|\/)\s*\d+/.test(h.replace(/\d{4}-\d{2}-\d{2}/g, "")));
  ok("an empty mirror says nothing accusatory", !/haven't|behind|missed/i.test((function () {
    const s3 = { workoutLogs: [] }; c.D = () => s3; return c.wkCardHTML();
  })()));
}
ok("...and the rule is written down", /NO STREAKS, NO TARGETS/.test(WK));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
