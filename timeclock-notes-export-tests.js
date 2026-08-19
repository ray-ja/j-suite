/* timeclock-notes-export-tests.js — the QuickBooks Time replacement (js/127 notes + js/128 report export).
   Ray, 2026-08-13: "vehicle tracking should be optional… very reliable… review and export a report of my
   hours… take notes assigned to shifts to list out what I do as I work piecemeal… easily edit the clock in
   and clock out times whether I am clocked in or not… gps data shown on a map is a plus."
   One test per requirement, plus the regression that matters: OBX job-costing must not lose attribution.
   Pure node. Run: node timeclock-notes-export-tests.js */
const fs = require("fs"), path = require("path");
const hx = require("./js/128-hours-export.js");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const TC = fs.readFileSync(path.join(__dirname, "js", "38-timeclock.js"), "utf8");
const SN = fs.readFileSync(path.join(__dirname, "js", "127-shift-notes.js"), "utf8");
const ST = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");

console.log("\n--- REQ: notes are their own records, not an array on the punch ---");
ok("shiftNotes is a real synced collection in blank()", /shiftNotes:\[\]/.test(ST));
ok("...backfilled on every org slab", (ST.match(/S\[b\]\.shiftNotes/g) || []).length >= 2);
/* membership, not position — this asserted shiftNotes was the LAST entry, so it went red the moment
   another collection was appended after it. */
ok("...and in the server COLLECTIONS", /const COLLECTIONS = \[[^\]]*"shiftNotes"/.test(SV));
ok("the reason is recorded so nobody 'simplifies' it back", /would silently lose notes|whole-record last-write-wins/.test(SN));
ok("each note carries its own id", /id: "sn_"/.test(SN));
ok("notes are NOT stored on the timeclock entry", !/\.notes\s*=\s*\[/.test(TC));

console.log("\n--- REQ: piecemeal — many notes per shift, in the order the work happened ---");
{
  const c = { D: () => ({ shiftNotes: [
    { id: "a", entryId: "e1", ts: 300, text: "third" },
    { id: "b", entryId: "e1", ts: 100, text: "first" },
    { id: "c", entryId: "e1", ts: 200, text: "second" },
    { id: "d", entryId: "e2", ts: 150, text: "other shift" },
    { id: "e", entryId: "e1", ts: 400, text: "deleted", deleted: true }
  ] }) };
  const vm = require("vm"); vm.createContext(c);
  vm.runInContext((SN.match(/function actShiftNotes\(\)[^\n]*\n/) || [""])[0]
    + (SN.match(/function shiftNotesFor\(entryId\) \{[\s\S]*?\n\}/) || [""])[0]
    + (SN.match(/function shiftNoteCount\(entryId\)[^\n]*\n/) || [""])[0]
    + "\nthis.f=shiftNotesFor;this.n=shiftNoteCount;", c);
  eq("three live notes on the shift", c.n("e1"), 3);
  eq("...in chronological order", c.f("e1").map(n => n.text).join(","), "first,second,third");
  ok("another shift's notes don't bleed in", !c.f("e1").some(n => n.text === "other shift"));
  ok("a deleted note is excluded", !c.f("e1").some(n => n.text === "deleted"));
  eq("a shift with no notes is empty, not an error", c.n("nope"), 0);
  eq("no entryId yields nothing", c.f("").length, 0);
}
ok("the note timestamp is when the WORK happened, and is editable", /sn_ts.*datetime-local|type="datetime-local"/.test(SN) && /ts = tsV \? new Date\(tsV\)\.getTime\(\)/.test(SN));
ok("notes surface on the OPEN shift card — the piecemeal capture point", /shiftNotesHTML\(open\.id/.test(TC));
/* superseded 2026-08-19: a bare count told you nothing. The row now shows the note TEXT — what you
   actually did that day — which is what makes a timesheet readable. */
ok("a shift row shows what you actually did, not a count", (TC.match(/shiftPunchDesc\(e\.id\)/g) || []).length >= 2);

console.log("\n--- ⭐ notes are reachable ON TODAY, where he actually lands ---");
{
  const TD = fs.readFileSync(path.join(__dirname, "js", "05-today.js"), "utf8");
  ok("the clocked-in card on Today renders the notes", /shiftNotesHTML\(open\.id,\{max:3\}\)/.test(TD));
  ok("...capped so a note-heavy day can't bury the rest of Today", /max:3/.test(TD));
  ok("...and it degrades if js/127 is absent", /typeof shiftNotesHTML==="function"/.test(TD));
  ok("the reason it moved to Today is recorded", /only got written up after the fact/.test(TD));
  ok("the card names what the shift is for", /tcEntryLabel\(open\)/.test(TD));
}

console.log("\n--- the punch DESCRIPTION: one source, used everywhere ---");
{
  const c = { D: () => ({ shiftNotes: [
    { id: "a", entryId: "e1", ts: 200, text: "Swapped the failed switch" },
    { id: "b", entryId: "e1", ts: 100, text: "Ran cable to the second-floor AP" },
    { id: "c", entryId: "e1", ts: 300, text: "  " },
    { id: "d", entryId: "e1", ts: 400, text: "Tested both APs", deleted: true },
    { id: "e", entryId: "e2", ts: 100, text: "other shift" }
  ] }) };
  const vm = require("vm"); vm.createContext(c);
  vm.runInContext((SN.match(/function actShiftNotes\(\)[^\n]*\n/) || [""])[0]
    + (SN.match(/function shiftNotesFor\(entryId\) \{[\s\S]*?\n\}/) || [""])[0]
    + (SN.match(/function shiftPunchDesc\(entryId, sep\) \{[\s\S]*?\n\}/) || [""])[0]
    + "\nthis.d=shiftPunchDesc;", c);
  eq("notes join in the order the work happened", c.d("e1"), "Ran cable to the second-floor AP · Swapped the failed switch");
  ok("a blank note doesn't leave a dangling separator", c.d("e1").indexOf("·  ·") < 0 && !/·\s*$/.test(c.d("e1")), c.d("e1"));
  ok("a deleted note is excluded", c.d("e1").indexOf("Tested both APs") < 0);
  ok("another shift's notes don't bleed in", c.d("e1").indexOf("other shift") < 0);
  eq("a shift with no notes is an empty string, not 'undefined'", c.d("nope"), "");
  eq("a custom separator is honoured", c.d("e1", " | "), "Ran cable to the second-floor AP | Swapped the failed switch");
  eq("no entryId is safe", c.d(""), "");
}
ok("the timesheet shows the note TEXT, not just a count", /shiftPunchDesc\(e\.id\)/.test(TC));
ok("...and the count-only version is gone from the report row", !/📝 \$\{shiftNoteCount\(e\.id\)\} · /.test(TC));
ok("the CSV export still carries notes", /"Notes": notes/.test(fs.readFileSync(path.join(__dirname, "js", "128-hours-export.js"), "utf8")));
ok("why one shared description exists is recorded", /never see two different accounts of one shift/.test(SN));

console.log("\n--- older notes are counted, never silently hidden ---");
{
  const many = { D: () => ({ shiftNotes: Array.from({ length: 7 }, (_, i) => ({ id: "n" + i, entryId: "e1", ts: i * 100, text: "note " + i })) }) };
  const vm = require("vm"); vm.createContext(many);
  many.esc = (x) => String(x == null ? "" : x);
  vm.runInContext((SN.match(/function actShiftNotes\(\)[^\n]*\n/) || [""])[0]
    + (SN.match(/function shiftNotesFor\(entryId\) \{[\s\S]*?\n\}/) || [""])[0]
    + (SN.match(/function snTime\(ts\) \{[\s\S]*?\n\}/) || [""])[0]
    + (SN.match(/function shiftNotesHTML\(entryId, opts\) \{[\s\S]*?\n\}/) || [""])[0]
    + "\nthis.h=shiftNotesHTML;", many);
  const capped = many.h("e1", { max: 3 });
  ok("only the most recent 3 render", (capped.match(/note \d/g) || []).length === 3, (capped.match(/note \d/g) || []));
  ok("...the most RECENT ones", /note 6/.test(capped) && !/note 0/.test(capped));
  ok("the earlier ones are counted", /4 earlier notes/.test(capped), capped.slice(0, 120));
  const full = many.h("e1", {});
  ok("no max means the full list (the Time tab)", (full.match(/note \d/g) || []).length === 7);
  ok("...with no 'earlier' line", !/earlier note/.test(full));
}

console.log("\n--- REQ: vehicle tracking is OPTIONAL ---");
ok("a no-vehicle shift role exists", /role === "none": no vehicle, no mileage/.test(TC));
ok("...and carries no mileage", (TC.match(/role === "none": no vehicle, no mileage/g) || []).length >= 2);

console.log("\n--- REQ: edit clock in/out whether clocked in or NOT ---");
ok("the punch editor takes both times", /id="tc_p_in"/.test(TC) && /id="tc_p_out"/.test(TC));
ok("an OPEN shift can be edited and stay open", /leave blank to keep it open/.test(TC));
ok("clock-out must be after clock-in", /Clock-out must be after clock-in/.test(TC));
ok("editing times never invents mileage", /Never invents or changes mileage — times only/.test(TC));

console.log("\n--- REQ: clock in with NO job (Jamieson) — without breaking OBX job costing ---");
/* was a source regex matching the undefined `opts` — see clockin-runtime-tests.js for why that was useless */
ok("the core accepts an explicit noJob opt-in", /if \(!jobId && !\(args && args\.noJob\)\)/.test(TC));
/* was: a separate "Just track time (no job)" button. That button is gone — "— No specific job —" is a real
   option in the picker now, which is equally explicit AND lets you say who the time was for. */
ok("it is an explicit CHOICE in the picker, not a silent bypass", /— No specific job —/.test(TC));
ok("...and the programmatic entry point still exists", /tcClockInNoJob/.test(TC));
ok("...and the reason is recorded", /EXPLICIT opt-in from a separate button, never a silent bypass/.test(TC));
/* the FORM-level guard is intentionally gone (2026-08-14): picking "— No specific job —" is now a legitimate
   choice, so rejecting an empty job there would block the thing Ray asked for. The guard that matters — the
   one protecting PROGRAMMATIC callers from silently creating a jobless shift — is still in tcClockInWith,
   and the form opts in only when there is genuinely no job. */
ok("the form opts in explicitly, only when there is no job", /noJob: !jobId, jobId: jobId/.test(TC));

console.log("\n--- REQ: date range on the report ---");
{
  const E = [
    { id: "1", userId: "u1", clockIn: new Date(2026, 6, 15, 9).getTime(), clockOut: new Date(2026, 6, 15, 17).getTime() },
    { id: "2", userId: "u1", clockIn: new Date(2026, 7, 3, 9).getTime(), clockOut: new Date(2026, 7, 3, 12).getTime() },
    { id: "3", userId: "u2", clockIn: new Date(2026, 7, 4, 9).getTime(), clockOut: new Date(2026, 7, 4, 12).getTime() },
    { id: "4", userId: "u1", clockIn: new Date(2026, 7, 9, 9).getTime(), clockOut: null },
    { id: "5", userId: "u1", clockIn: new Date(2026, 7, 3, 9).getTime(), deleted: true }
  ];
  eq("a month range picks only that month", hx.hxFilter(E, { from: "2026-08-01", to: "2026-08-31" }, "").length, 3);
  eq("...and July is excluded", hx.hxFilter(E, { from: "2026-08-01", to: "2026-08-31" }, "").filter(e => e.id === "1").length, 0);
  eq("range is INCLUSIVE of both ends (1 live entry that day; the other is deleted)", hx.hxFilter(E, { from: "2026-08-03", to: "2026-08-03" }, "").length, 1);
  eq("filtering by person works", hx.hxFilter(E, { from: "2026-08-01", to: "2026-08-31" }, "u1").length, 2);
  eq("an OPEN shift is still included", hx.hxFilter(E, { from: "2026-08-01", to: "2026-08-31" }, "u1").filter(e => !e.clockOut).length, 1);
  ok("a deleted entry never appears", !hx.hxFilter(E, {}, "").some(e => e.id === "5"));
  eq("no range = everything live", hx.hxFilter(E, {}, "").length, 4);
  /* a shift is counted on the day it STARTED — a night shift must not land in two periods */
  const night = [{ id: "n", userId: "u1", clockIn: new Date(2026, 7, 31, 22).getTime(), clockOut: new Date(2026, 8, 1, 2).getTime() }];
  eq("a night shift counts in the month it started", hx.hxFilter(night, { from: "2026-08-01", to: "2026-08-31" }, "").length, 1);
  eq("...and NOT in the next month", hx.hxFilter(night, { from: "2026-09-01", to: "2026-09-30" }, "").length, 0);
}
console.log("\n--- presets are payroll-shaped ---");
["week", "lastweek", "month", "lastmonth", "year"].forEach(k => {
  const r = hx.hxPreset(k);
  ok("preset '" + k + "' returns a range", !!r.from && !!r.to && r.from <= r.to, JSON.stringify(r));
});
eq("'all' means no bounds", JSON.stringify(hx.hxPreset("all")), JSON.stringify({ from: "", to: "" }));

console.log("\n--- REQ: the CSV export ---");
{
  const rows = hx.hxRows([{ id: "e1", userId: "u1", userName: "Ray", jobId: "", vehicle: "F-150",
    clockIn: new Date(2026, 7, 3, 9).getTime(), clockOut: new Date(2026, 7, 3, 12, 30).getTime(),
    computedMiles: 12.34, milesConfirmed: true, startLat: 36.1, startLng: -75.7, endLat: 35.9, endLng: -75.6 }]);
  const r = rows[0];
  eq("one row per shift", rows.length, 1);
  eq("hours are decimal, for payroll", r.Hours, "3.50");
  eq("a no-job shift is labelled, not blank", r.Job, "(no job — time only)");
  eq("mileage is costed", r["Mileage $"], "8.95");
  eq("confirmed mileage is marked", r["Miles confirmed"], "yes");
  ok("GPS start is exported", /36\.1, -75\.7/.test(r["GPS start"]));
  ok("GPS end is exported", /35\.9, -75\.6/.test(r["GPS end"]));
  ok("a MAP LINK is built from the GPS", /google\.com\/maps\/dir\/36\.1,-75\.7\/35\.9,-75\.6/.test(r.Map), r.Map);

  const csv = hx.hxBuildCSV(rows);
  const head = csv.split("\n")[0];
  ["Date", "Person", "Job", "Hours", "Miles", "Notes", "GPS start", "Map"].forEach(c =>
    ok("CSV header has '" + c + "'", head.indexOf(c) >= 0));
  eq("header + one data row", csv.split("\n").length, 2);
}
console.log("\n--- CSV escaping (a note WILL contain a comma one day) ---");
eq("a comma is quoted", hx.hxCsvCell("ran cable, then tested"), '"ran cable, then tested"');
eq("a quote is doubled", hx.hxCsvCell('said "done"'), '"said ""done"""');
eq("a newline is quoted", hx.hxCsvCell("line1\nline2"), '"line1\nline2"');
eq("a plain value is untouched", hx.hxCsvCell("Ray"), "Ray");
eq("null becomes empty", hx.hxCsvCell(null), "");
ok("a note with a comma survives a round trip",
  hx.hxBuildCSV([{ Date: "2026-08-03", Notes: "ran cable, tested AP" }]).indexOf('"ran cable, tested AP"') > 0);

console.log("\n--- map link degrades safely ---");
eq("no GPS at all -> no link", hx.hxMapLink({}), "");
ok("start only -> a search link", /maps\/search/.test(hx.hxMapLink({ startLat: 1, startLng: 2 })));
ok("start and end -> a directions link", /maps\/dir/.test(hx.hxMapLink({ startLat: 1, startLng: 2, endLat: 3, endLng: 4 })));

console.log("\n--- the report actually uses the range (no silent all-time totals) ---");
ok("the report scopes to the filtered set", /const _scope = \(typeof hxFilter === "function"/.test(TC));
ok("...and totals come from that scope", /const all = _scope\.filter\(e => e\.clockOut\)/.test(TC));
ok("the filter bar renders above the report", /let h = _bar \+/.test(TC));
ok("the empty state says 'in this period', not 'ever'", /No time logged in this period/.test(TC));
ok("it degrades gracefully if js/128 is absent", /\(typeof hxBarHTML === "function"\) \? hxBarHTML\(\) : ""/.test(TC));

console.log("\n--- wiring ---");
{
  const SHELL = fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8");
  ok("js/127 registered", SHELL.indexOf('src="js/127-shift-notes.js"') > 0);
  ok("js/128 registered", SHELL.indexOf('src="js/128-hours-export.js"') > 0);
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
