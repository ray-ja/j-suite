/* calendar-tests.js — the personal calendar (js/126).
   Ray, 2026-08-05: "we do need a calendar... a personal calendar for sure" — said while carrying his wife's
   birthday, a friend's birthday and a party date in his head, the first eleven days out.
   The two behaviours that matter: an annual date must roll forward on its own forever, and an UNCONFIRMED
   date must never be presented as fact ("I think it was the twenty second").
   Pure node. Run: node calendar-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
const sv = require("./sync-server.js");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const CAL = fs.readFileSync(path.join(__dirname, "js", "126-calendar.js"), "utf8");
const R = fs.readFileSync(path.join(__dirname, "js", "03-routing.js"), "utf8");
const ST = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");

/* run the real date logic with a pinned "today" */
function calCtx(todayISO) {
  const c = { Date, Math, String, Number, console, JSON, Array, Object,
    today: () => todayISO, D: () => ({ personalEvents: [] }) };
  vm.createContext(c);
  ["evParse", "evTodayUTC", "evISO", "evNextISO", "evDaysAway", "evCountdown"].forEach(fn => {
    const m = CAL.match(new RegExp("function " + fn + "\\([\\s\\S]*?\\n\\}")) || CAL.match(new RegExp("function " + fn + "\\([^\\n]*\\}"));
    vm.runInContext((m || [""])[0], c);
  });
  vm.runInContext("this.evNextISO=evNextISO;this.evDaysAway=evDaysAway;this.evCountdown=evCountdown;", c);
  return c;
}

console.log("\n--- his actual dates, from today ---");
{
  const c = calCtx("2026-08-05");
  const wife = { date: "2026-08-16", annual: true };
  eq("wife's birthday is 11 days away", c.evDaysAway(wife), 11);
  eq("...and reads as a countdown", c.evCountdown(wife), "in 11 days");
  eq("the friend's birthday is 10 days away", c.evDaysAway({ date: "2026-08-15", annual: true }), 10);
  eq("the party is 17 days away", c.evDaysAway({ date: "2026-08-22" }), 17);
}

console.log("\n--- an annual date rolls forward on its own, forever ---");
{
  const before = calCtx("2026-08-05"), after = calCtx("2026-08-17"), next = calCtx("2027-03-01");
  const wife = { date: "2026-08-16", annual: true };
  eq("before it, this year", before.evNextISO(wife), "2026-08-16");
  eq("the day AFTER, it jumps to next year", after.evNextISO(wife), "2027-08-16");
  ok("...and is never negative once passed", after.evDaysAway(wife) > 0, String(after.evDaysAway(wife)));
  eq("months later it's still the next one", next.evNextISO(wife), "2027-08-16");
  eq("a birthday entered ONCE still works in 2031", calCtx("2031-01-01").evNextISO(wife), "2031-08-16");

  /* a leap-day birthday must not throw or silently vanish */
  const leap = { date: "2024-02-29", annual: true };
  ok("a Feb 29 birthday still resolves", /^\d{4}-\d{2}-\d{2}$/.test(calCtx("2026-01-01").evNextISO(leap)), calCtx("2026-01-01").evNextISO(leap));
}

console.log("\n--- a one-off date does NOT roll ---");
{
  const after = calCtx("2026-08-23");
  eq("the party stays in the past", after.evNextISO({ date: "2026-08-22" }), "2026-08-22");
  ok("...so it drops out of upcoming", after.evDaysAway({ date: "2026-08-22" }) < 0);
}

console.log("\n--- today / tomorrow read as words, not numbers ---");
{
  const c = calCtx("2026-08-16");
  eq("the day itself", c.evCountdown({ date: "2026-08-16", annual: true }), "today");
  eq("the day before", calCtx("2026-08-15").evCountdown({ date: "2026-08-16", annual: true }), "tomorrow");
}

console.log("\n--- a date he ISN'T sure of is never stated as fact ---");
ok("the label marks it with a ?", /confirmed === false \? " \(\?\)"/.test(CAL));
ok("the edit form can set it", /ev_unsure/.test(CAL));
ok("the server context flags it to the companion", /date NOT confirmed — don't state it as fact/.test(SV));

console.log("\n--- it is NOT a habit surface ---");
/* test the CODE, not the comment that explains the rule — stripping block comments first */
const CAL_CODE = CAL.replace(/\/\*[\s\S]*?\*\//g, "");
ok("no streak logic", !/streak/i.test(CAL_CODE), (/.*streak.*/i.exec(CAL_CODE) || [""])[0].trim());
ok("no completion/checkbox on a date", !/\bdone\b/.test(CAL_CODE));
ok("nothing scores or counts him", !/percent|compliance|score/i.test(CAL_CODE));
ok("...and the file says why", /Deliberately NOT a habit surface/.test(CAL));

console.log("\n--- the collection is wired the way the data layer requires ---");
ok("server COLLECTIONS lists it", /"personalEvents"/.test(SV));
ok("client blank() has it", /personalEvents:\[\]/.test(ST));
eq("both load() backfills present", (ST.match(/personalEvents\)\)S\[b\]\.personalEvents=\[\]/g) || []).length, 2);
ok("records carry a stable pev_ id", /"pev_" \+ \(typeof uid/.test(CAL));
ok("deletes are SOFT (never dropped from the store)", /e\.deleted = true/.test(CAL));

console.log("\n--- routing ---");
ok("cal has a screen", /cal:\(typeof rCal==="function"\?rCal:rToday\)/.test(R));
ok("cal has TAB_META", /cal:\{l:"Calendar"/.test(R));
ok("cal is a nav group", /key:"cal"[\s\S]{0,80}tabs:\["cal"\]/.test(R));
ok("cal is OPT-IN (never on OBX/Jamieson)", /ORG_OPTIN_TABS = \[[^\]]*"cal"/.test(R));
ok("the personal template includes it", /personal: \["life","journal","shelf","cal","budget","todo","messages"\]/.test(R));
ok("the module is in the shell",
  fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/126-calendar.js"') > 0);
ok("the home page shows what's close", /evHomeCardHTML\(30\)/.test(fs.readFileSync(path.join(__dirname, "js", "122-personal-home.js"), "utf8")));

console.log("\n--- the companion is TOLD the dates ---");
{
  const PERSONAL_TABS = ["life", "journal", "shelf", "cal", "budget", "todo", "messages"];
  const iso = new Date().toISOString().slice(0, 10);
  const yr = +iso.slice(0, 4);
  const store = {
    registry: [{ id: "p", name: "RBJVL", tabs: PERSONAL_TABS }],
    users: [{ id: "u1", username: "Ray" }],
    p: { personalEvents: [
      { id: "e1", date: (yr - 2) + "-08-16", annual: true, title: "Wife's birthday", note: "wants floats for the sound", confirmed: true },
      { id: "e2", date: iso, title: "Something today", confirmed: true },
      { id: "e3", date: (yr + 3) + "-01-01", title: "Far future", confirmed: true },
      { id: "e4", date: iso, title: "Maybe this", confirmed: false },
      { id: "e5", date: iso, title: "GONE", deleted: true, confirmed: true }
    ] }
  };
  const c = sv.capTodayContext(store, "p", "u1");
  ok("upcoming dates are in the context", /Coming up \(next 45 days\)/.test(c), c.slice(0, 500));
  ok("the annual birthday appears", c.indexOf("Wife's birthday") >= 0);
  ok("...with its gift note", c.indexOf("wants floats for the sound") >= 0);
  ok("today's item says today", /Something today[^\n]*\(today\)/.test(c), c);
  ok("an unconfirmed date is flagged", /Maybe this[^\n]*NOT confirmed/.test(c), c);
  ok("a deleted event never appears", c.indexOf("GONE") < 0);
  ok("something 3 years out is NOT surfaced", c.indexOf("Far future") < 0);

  const none = sv.capTodayContext({ registry: store.registry, users: store.users, p: {} }, "p", "u1");
  ok("no events -> the section is silent, not an empty header", !/Coming up/.test(none), none);
}

console.log("\n--- MONTH VIEW: the grid itself ---");
{
  /* render the real grid for August 2026 with his three dates */
  const els = {};
  const c = {
    console, JSON, Math, Date, String, Number, Array, Object,
    today: () => "2026-08-05",
    esc: x => String(x == null ? "" : x),
    fmtDate: d => d,
    D: () => ({ personalEvents: [
      { id: "e1", date: "2026-08-16", title: "Wife's birthday", annual: true, confirmed: true, note: "floats" },
      { id: "e2", date: "2026-08-15", title: "Friend birthday", annual: true, confirmed: true },
      { id: "e3", date: "2026-08-22", title: "Party", confirmed: true },
      { id: "e4", date: "2026-09-09", title: "Next month", confirmed: true },
      { id: "e5", date: "2026-08-16", title: "GONE", deleted: true }
    ] }),
    document: { getElementById: id => (els[id] = els[id] || { innerHTML: "", value: "" }) }
  };
  c.window = c; c.view = { innerHTML: "" };
  vm.createContext(c);
  vm.runInContext(CAL, c);

  const grid = c.calMonthHTML();
  ok("the grid renders", typeof grid === "string" && grid.length > 400, String(grid).length + " chars");
  ok("it names the month", grid.indexOf("August 2026") > 0);
  ok("it is a 7-column grid", /grid-template-columns:repeat\(7,1fr\)/.test(grid));

  /* August 2026 starts on a Saturday -> 6 lead-in blanks, and has 31 days */
  eq("Aug 1 2026 is a Saturday (6 blanks)", new Date(Date.UTC(2026, 7, 1)).getUTCDay(), 6);
  eq("exactly that many lead-in blanks", (grid.match(/<div><\/div>/g) || []).length, 6);
  eq("31 day cells", (grid.match(/onclick="calOpenDay\(/g) || []).length, 31);
  ok("the last day is the 31st", grid.indexOf("calOpenDay('2026-08-31')") > 0);
  ok("there is no 32nd", grid.indexOf("calOpenDay('2026-09-01')") < 0);

  ok("today is highlighted", /calOpenDay\('2026-08-05'\)[^>]*var\(--accent\)/.test(grid), "today cell not marked");
  ok("days with events are marked", grid.indexOf("calOpenDay('2026-08-16')") > 0);
  ok("this month's events are listed under the grid", grid.indexOf("Wife's birthday") > 0 && grid.indexOf("Party") > 0);
  ok("next month's event is NOT in this grid", grid.indexOf("Next month") < 0);
  ok("a deleted event never shows", grid.indexOf("GONE") < 0);

  /* evOnDay is the thing the whole grid leans on */
  eq("two events on the 16th? no — one (other is deleted)", c.evOnDay("2026-08-16").length, 1);
  eq("the 15th has one", c.evOnDay("2026-08-15").length, 1);
  eq("an empty day has none", c.evOnDay("2026-08-03").length, 0);
  eq("an ANNUAL birthday appears in a DIFFERENT year's grid", c.evOnDay("2031-08-16").length, 1);
  eq("...but a one-off does not", c.evOnDay("2031-08-22").length, 0);

  /* month arithmetic must not break at the year boundary */
  c.calShiftMonth(-8);
  ok("stepping back 8 months lands in 2025", c.calMonthHTML().indexOf("December 2025") > 0, c.calMonthHTML().slice(0, 200));
  c.calToday();
  ok("Back-to-this-month returns to August 2026", c.calMonthHTML().indexOf("August 2026") > 0);
  c.calShiftMonth(5);
  ok("forward 5 months crosses into 2027", c.calMonthHTML().indexOf("January 2027") > 0);
  c.calToday();

  /* February leap-year length */
  c.CAL_YM = "2028-02";
  eq("Feb 2028 has 29 cells", (c.calMonthHTML().match(/onclick="calOpenDay\(/g) || []).length, 29);
  c.CAL_YM = "2027-02";
  eq("Feb 2027 has 28", (c.calMonthHTML().match(/onclick="calOpenDay\(/g) || []).length, 28);
}

console.log("\n--- the tab offers both views ---");
ok("a Month / Upcoming toggle exists", CAL.indexOf("calSetView(") > 0 && CAL.indexOf("month") > 0 && CAL.indexOf("list") > 0);
ok("month is the default", /var CAL_VIEW = "month"/.test(CAL));
ok("tapping a day opens it", /window\.calOpenDay = function/.test(CAL));
ok("...and can add on that date", /openEventOn/.test(CAL));


console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
