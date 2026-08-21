/* clock-when-tests.js — editable clock-in/out times + evidence-backed suggestions (js/135).

   Ray, 2026-08-19: "when I hit clock in, it should pull up a clock where I can input the time… default to
   the current time… same when I clock out… edit the date as well… a recommended date and time based on
   activity… I'm probably not working overnight, right?"

   ⚠️ EVERY suggestion function here is CALLED, not regex-matched. That is a direct response to the
   `opts`/`args` crash on 2026-08-19, where two source-text assertions passed for six days while the code
   threw in the field. Timesheet maths decides what people get paid — it gets executed by tests.

   Pure node. Run: node clock-when-tests.js */
const fs = require("fs"), path = require("path");
const cw = require("./js/135-clock-when.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const TC = fs.readFileSync(path.join(__dirname, "js", "38-timeclock.js"), "utf8");
const H = 3600000, M = 60000;
/* a fixed local wall-clock moment so the tests don't drift with the real clock or the box's timezone */
const NOW = new Date(2026, 7, 19, 17, 7, 0, 0).getTime();   // Wed 19 Aug 2026, 5:07pm local

console.log("\n--- ⭐ the overnight runaway (the case Ray named) ---");
{
  eq("a normal 6-hour shift is not flagged", cw.cwOvernight(NOW - 6 * H, NOW), null);
  eq("a long-but-same-day 13-hour shift is not flagged", cw.cwOvernight(NOW - 13 * H, NOW), null);
  const o = cw.cwOvernight(NOW - 20 * H, NOW);
  ok("left clocked in overnight IS flagged", !!o, o);
  ok("...as both long and across days", o.long === true && o.crossedMidnight === true, o);
  eq("...with the hours stated", o.hours, 20);
  ok("...and says why in plain words", /different day and has been running/.test(o.why), o.why);
  const y = cw.cwOvernight(new Date(2026, 7, 18, 23, 30).getTime(), NOW);
  ok("started yesterday evening is flagged even under 14h", !!y, y);
  ok("...and names that reason", /started on a different day|started yesterday/.test(y.why), y.why);
  const b = cw.cwOvernight(NOW - 15 * H, NOW);
  ok("a 15-hour same-day shift is flagged on duration alone", !!b && b.long === true, b);
}

console.log("\n--- clock-out suggestions come from real evidence, ranked ---");
{
  const entry = { clockIn: NOW - 8 * H, pings: [
    { ts: NOW - 7 * H, lat: 1, lng: 1 }, { ts: NOW - 3 * H, lat: 1, lng: 1 }, { ts: NOW - 90 * M, lat: 1, lng: 1 }
  ] };
  const notes = [{ ts: NOW - 4 * H }, { ts: NOW - 100 * M }];
  const s = cw.cwSuggestOut(entry, { nowMs: NOW, homeArrival: NOW - 45 * M, notes: notes });
  eq("three sources, three suggestions", s.length, 3);
  ok("got-home ranks first — strongest forgot-to-clock-out signal", /Got home/.test(s[0].label), s.map(x => x.label));
  ok("last note ranks second", /Last note/.test(s[1].label), s.map(x => x.label));
  ok("last GPS fix ranks third", /Last GPS fix/.test(s[2].label), s.map(x => x.label));
  ok("every suggestion says where it came from", s.every(x => x.why && x.why.length > 20), s.map(x => x.why));
  ok("every suggestion is after the shift started", s.every(x => x.ts > entry.clockIn));
  ok("none is in the future", s.every(x => x.ts <= NOW));
}

console.log("\n--- it never suggests something impossible ---");
{
  const entry = { clockIn: NOW - 2 * H, pings: [{ ts: NOW - 3 * H }] };   // a ping from BEFORE the shift
  const s = cw.cwSuggestOut(entry, { nowMs: NOW });
  eq("a ping before clock-in is discarded", s.length, 0);

  const fut = cw.cwSuggestOut({ clockIn: NOW - 2 * H, pings: [{ ts: NOW + H }] }, { nowMs: NOW });
  eq("a future ping is discarded", fut.length, 0);

  const close = cw.cwSuggestOut({ clockIn: NOW - 2 * H, pings: [{ ts: NOW - 20000 }] }, { nowMs: NOW });
  eq("a ping 20 seconds ago isn't offered — it isn't a choice", close.length, 0);

  eq("no evidence at all yields no suggestions", cw.cwSuggestOut({ clockIn: NOW - H }, { nowMs: NOW }).length, 0);
  eq("a null entry is safe", cw.cwSuggestOut(null, { nowMs: NOW }).length, 0);

  const dup = cw.cwSuggestOut({ clockIn: NOW - 5 * H, pings: [{ ts: NOW - 2 * H }] },
    { nowMs: NOW, homeArrival: NOW - 2 * H - 10000, notes: [{ ts: NOW - 2 * H + 5000 }] });
  eq("three sources within a minute of each other collapse to one", dup.length, 1);
}

console.log("\n--- clock-in suggestions are honest about being thin ---");
{
  /* ⚠️ there is NO arrival data: pings only start once you clock in. The schedule is the only real signal. */
  const s = cw.cwSuggestIn({ nowMs: NOW, job: { time: "09:00" } });
  ok("the job's scheduled start is offered", s.some(x => /Scheduled start/.test(x.label)), s.map(x => x.label));
  ok("...and says so", s.some(x => /scheduled to start/.test(x.why)));
  ok("a round-down is offered", s.some(x => /Round down/.test(x.label)), s.map(x => x.label));
  ok("...and admits it is not evidence", s.some(x => /not based on any data/.test(x.why)));
  eq("5:07pm rounds down to 5:00pm", cw.cwClock(s.filter(x => /Round down/.test(x.label))[0].ts), cw.cwClock(new Date(2026, 7, 19, 17, 0).getTime()));

  const later = cw.cwSuggestIn({ nowMs: NOW, job: { time: "19:00" } });
  ok("a schedule LATER than now is not offered", !later.some(x => /Scheduled start/.test(x.label)), later.map(x => x.label));

  const floored = cw.cwSuggestIn({ nowMs: NOW, job: { time: "09:00" }, lastShiftEnd: NOW - 2 * H });
  ok("a start before the previous shift ended is not offered", !floored.some(x => /Scheduled start/.test(x.label)), floored.map(x => x.label));

  const onTheDot = cw.cwSuggestIn({ nowMs: new Date(2026, 7, 19, 17, 0, 0, 0).getTime() });
  eq("already on a quarter hour — nothing to round", onTheDot.length, 0);
}

console.log("\n--- the field value round-trips ---");
{
  const v = cw.cwLocalValue(NOW);
  eq("formats for datetime-local", v, "2026-08-19T17:07");
  eq("parses back to the same moment", cw.cwParse(v), NOW);
  eq("junk parses to 0, not NaN", cw.cwParse("not a time"), 0);
  eq("empty parses to 0", cw.cwParse(""), 0);
  eq("a scheduled time lands on the right day", cw.cwLocalValue(cw.cwTimeOnDay("09:30", NOW)), "2026-08-19T09:30");
  eq("a malformed schedule yields 0", cw.cwTimeOnDay("nine", NOW), 0);
}

console.log("\n--- wired into both ends of the clock ---");
ok("the clock-in form carries the control", /\$\{tcWhenInHTML\(jobId\)\}/.test(TC));
ok("clock-in reads the chosen time", /cwRead\("tc_when_in", now\(\)\)/.test(TC));
/* membership, not adjacency — this broke the moment another argument was inserted between them, while
   the property it checks (the chosen time reaches the core) still held perfectly. */
ok("...and passes it to the core", /tcClockInWith\(\{ at: _at[,\s]/.test(TC));
ok("the core honours it", /clockIn: tcClampStart\(args\.at\)/.test(TC));
ok("clock-out carries the control", /cwWhenHTML\("tc_when_out"/.test(TC));
ok("clock-out reads the chosen time", /cwRead\("tc_when_out", now\(\)\)/.test(TC));
ok("...and passes it through", /tcClockOutWith\(id, \{ at: _at/.test(TC));
ok("the shared core honours it", /tcFinalizeSegment\(e, odoEnd, \(opts\.at != null \? opts\.at : null\)\)/.test(TC));
ok("the overnight warning is shown on clock-out", /That's a \$\{over\.hours\}-hour shift/.test(TC));
ok("the field is read BEFORE the modal closes", TC.indexOf('cwRead("tc_when_out"') < TC.indexOf('if (typeof closeModal === "function") closeModal();\n  // delegate the close'));
ok("everything degrades if js/135 is absent", /typeof cwRead === "function"/.test(TC) && /typeof cwWhenHTML !== "function"/.test(TC));
ok("the no-arrival-data limitation is recorded, not papered over", /the app wasn't watching/.test(fs.readFileSync(path.join(__dirname, "js", "135-clock-when.js"), "utf8")));

console.log("\n--- a chosen start time is clamped ---");
{
  const vm = require("vm");
  const ctx = { now: () => NOW };
  vm.createContext(ctx);
  vm.runInContext((TC.match(/function tcClampStart\(at\) \{[\s\S]*?\n\}/) || [""])[0] + ";this.C=tcClampStart;", ctx);
  eq("a sensible earlier time is kept", ctx.C(NOW - 3 * H), NOW - 3 * H);
  eq("nothing means now", ctx.C(null), NOW);
  eq("the future is clamped to now", ctx.C(NOW + 5 * H), NOW);
  eq("more than 24h back is clamped to 24h", ctx.C(NOW - 5 * 86400000), NOW - 86400000);
  eq("zero means now", ctx.C(0), NOW);
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
