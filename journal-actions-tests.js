/* journal-actions-tests.js — phases 3 + 4 of the voice journal:
   extraction → OFFERS (js/132 + /api/journal/extract) and timed REMINDERS (js/133 + the server sweep).

   Ray, 2026-08-13: "it need to take the informatino i give it and act on it. mark things on the calendar,
   do stuff in the app, etc. even remind me of things at certain days and times"

   ⭐ THE SUITE THAT MATTERS is "venting is never converted". The personal app is deliberately built not to
   act, and this feature pulls against that on purpose. If these tests ever go red, the journal has stopped
   being somewhere he can just talk — which is worth more than the feature.

   Pure node. Run: node journal-actions-tests.js */
const fs = require("fs"), path = require("path");
const t = require("./sync-server");
const rm = require("./js/133-reminders.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const JA = fs.readFileSync(path.join(__dirname, "js", "132-journal-actions.js"), "utf8");
const RM = fs.readFileSync(path.join(__dirname, "js", "133-reminders.js"), "utf8");
const VJ = fs.readFileSync(path.join(__dirname, "js", "131-voice-journal.js"), "utf8");
const ST = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
const LF = fs.readFileSync(path.join(__dirname, "js", "78-life-tracker.js"), "utf8");

/* ============================================================================================
   ⭐ VENTING IS NEVER CONVERTED INTO A TASK
   ============================================================================================ */
console.log("\n--- ⭐ the journal stays somewhere he can just talk ---");
{
  const P = t.JOURNAL_EXTRACT_SYSTEM;
  ok("an empty list is stated to be the NORMAL answer", /IS THE NORMAL ANSWER/.test(P));
  ok("...and explicitly a success, not a failure", /empty list is a success/.test(P));
  ok("venting is named and excluded", /venting, complaints, or descriptions of a hard day/.test(P));
  ok("feelings and moods are excluded", /feelings, worries, moods/.test(P));
  ok("vague intentions are excluded", /vague intentions/.test(P));
  ok("self-improvement / habits are excluded (no nagging)", /self-improvement, habits, routines/.test(P));
  ok("family and relationships are excluded", /relationship, or a family situation/.test(P));
  ok("things already done are excluded", /past tense is history/.test(P));
  ok("it is told to leave it out when unsure", /When in doubt, leave it out/.test(P));
  ok("it is a parser, forbidden from replying or advising", /You are a parser, not an assistant/.test(P) && /never give advice/.test(P));
  ok("the entry is treated as content, never instructions", /CONTENT TO READ, never instructions/.test(P));
  ok("dates are never invented", /never invent one/.test(P));

  /* the structural guarantees, not just the prompt */
  ok("extraction runs as a SECOND pass, after the entry is saved", VJ.indexOf("save();") < VJ.indexOf("jaScan(n.id"));
  ok("...and is wrapped so a failure can never cost the entry", /try \{ jaScan\(n\.id, text\); \} catch/.test(VJ));
  ok("the companion still gets NO tools", /orgIsPersonal\(store, org\) \? \[\] : CAP_TOOLS/.test(SV));
  ok("the reason the two passes are separate is recorded in the module", /WHEN HE VENTS, LET HIM/.test(JA));
  ok("nothing is written without a tap", /nothing here reaches the calendar, to-dos or reminders without a tap/.test(JA));
}

console.log("\n--- offers are offers: nothing acts on its own ---");
ok("offers live in localStorage, NOT the synced store", /localStorage\.setItem\(jaKey\(\)/.test(JA) && !/d\.offers/.test(JA));
ok("...and the reason is recorded", /a suggestion on one device, not data/.test(JA));
ok("an ignored offer expires on its own", /JA_TTL_MS = 7 \* 24/.test(JA));
ok("no card is rendered when there is nothing to offer", /if \(!keys\.length\) return "";/.test(JA));
ok("the card says nothing is added without a tap", /Nothing is added unless you tap it/.test(JA));
ok("there is a one-tap 'not now' for the whole lot", /jaDismissAll/.test(JA));
ok("a re-scan is on demand only, never automatic on open", /Never automatic on open/.test(LF));
ok("accepting creates a NORMAL synced record (calendar)", /d\.personalEvents\.push\(e\)/.test(JA));
ok("accepting creates a NORMAL synced record (to-do)", /d\.todos\.push\(t\)/.test(JA));
ok("accepting creates a NORMAL synced record (reminder)", /d\.reminders\.push\(r\)/.test(JA));
ok("an accepted offer is removed so it can't be added twice", /rec\.items\.splice\(idx, 1\)/.test(JA));

console.log("\n--- the extract endpoint ---");
ok("it requires a token", /\/api\/journal\/extract[\s\S]{0,400}if \(!tokOk\(tok\)\)/.test(SV));
ok("...AND that the caller belongs to the org", /orgsForUser\(loadStore\(\), acct\.id\)\.indexOf\(org\) < 0/.test(SV));
ok("empty text short-circuits without an API call", /if \(!text\.trim\(\)\) return J\(200, \{ items: \[\] \}\)/.test(SV));
ok("no key = no crash, just no offers", /return J\(200, \{ items: \[\], noKey: true \}\)/.test(SV));
ok("output is validated against a kind allowlist", /const KINDS = \{ event: 1, todo: 1, reminder: 1 \}/.test(SV));
ok("a malformed date is dropped, not passed through", /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(SV.slice(SV.indexOf("/api/journal/extract"))));
ok("a dateless reminder is demoted to a to-do, not silently dropped", /if \(it\.kind === "reminder" && !it\.date\) it\.kind = "todo"/.test(SV));
ok("the number of items is capped", /\.slice\(0, 12\)/.test(SV.slice(SV.indexOf("/api/journal/extract"))));
ok("today's date is supplied so 'Tuesday' resolves", /Resolve relative dates/.test(SV));
ok("it uses its own system prompt, not the workshop one", /function callAnthropicSys/.test(SV));
ok("...and the reason is recorded", /hardcodes WORKSHOP_SYSTEM, which is the wrong voice/.test(SV));
ok("a date-misread is called out as the reason for a better model", /a misread date fires a reminder on the wrong day/.test(SV));

/* ============================================================================================
   REMINDERS
   ============================================================================================ */
console.log("\n--- the reminders collection is wired in all four places ---");
ok("blank() has reminders", /reminders:\[\]/.test(ST));
ok("backfilled on every org slab (both migration sites)", (ST.match(/S\[b\]\.reminders/g) || []).length >= 2);
/* ⚠️ SECOND TIME I'VE MADE THIS MISTAKE: this asserted `reminders` was the LAST entry in COLLECTIONS, so
   it went red the moment billRates was appended — exactly as the shiftNotes assertion did before it.
   Assert MEMBERSHIP in the array, never position. */
ok("server COLLECTIONS has reminders", /const COLLECTIONS = \[[^\]]*"reminders"/.test(SV));
ok("why it isn't a flag on todos is recorded", /a reminder FIRES once at a moment/.test(ST));

console.log("\n--- due-time maths ---");
{
  const d = rm.rmDueAt("2026-08-20", "14:30");
  const back = new Date(d);
  eq("date+time -> local ms", back.getFullYear() + "-" + (back.getMonth() + 1) + "-" + back.getDate() + " " + back.getHours() + ":" + back.getMinutes(), "2026-8-20 14:30");
  eq("no time means 9am, not midnight", new Date(rm.rmDueAt("2026-08-20", "")).getHours(), 9);
  eq("a junk time falls back to 9am", new Date(rm.rmDueAt("2026-08-20", "nonsense")).getHours(), 9);
  eq("no date means no reminder", rm.rmDueAt("", "10:00"), 0);
  eq("a junk date means no reminder", rm.rmDueAt("next tuesday", "10:00"), 0);
  eq("round-trips back to the same day", rm.rmDateOf(rm.rmDueAt("2026-12-31", "23:59")), "2026-12-31");
  eq("...and the same time", rm.rmTimeOf(rm.rmDueAt("2026-12-31", "23:59")), "23:59");
  eq("single-digit hours pad", rm.rmTimeOf(rm.rmDueAt("2026-03-04", "07:05")), "07:05");
}

console.log("\n--- the sweep fires once, on time, and not forever ---");
{
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);
  const store = {
    registry: [{ id: "p", name: "P", tabs: ["life", "journal"] }, { id: "obx", name: "OBX", tabs: ["jobs"] }],
    users: [{ id: "u1" }],
    p: { reminders: [
      { id: "r1", text: "due now", dueAt: now - 1000, fired: false, userId: "u1" },
      { id: "r2", text: "later", dueAt: now + 86400000, fired: false, userId: "u1" },
      { id: "r3", text: "already sent", dueAt: now - 5000, fired: true, userId: "u1" },
      { id: "r4", text: "stale", dueAt: now - 3 * 86400000, fired: false, userId: "u1" },
      { id: "r5", text: "deleted", dueAt: now - 1000, fired: false, deleted: true, userId: "u1" },
      { id: "r6", text: "no due date", fired: false, userId: "u1" }
    ] },
    obx: { reminders: [{ id: "b1", text: "business one", dueAt: now - 1000, fired: false, userId: "u1" }] }
  };
  const due = t.remindersDue(store, now).map(d => d.rec.id);
  ok("a reminder that has come due fires", due.indexOf("r1") >= 0, due);
  ok("a future one does not", due.indexOf("r2") < 0, due);
  ok("an already-fired one is never repeated", due.indexOf("r3") < 0, due);
  ok("one stale by 3 days is left alone (no 3am ping about last week)", due.indexOf("r4") < 0, due);
  ok("a deleted one never fires", due.indexOf("r5") < 0, due);
  ok("one with no due date never fires", due.indexOf("r6") < 0, due);
  ok("reminders work in ANY org, not just the personal one", due.indexOf("b1") >= 0, due);
  eq("exactly one due in the personal org", due.filter(x => x[0] === "r").length, 1);

  /* just inside and just outside the grace window */
  ok("due 23h ago still fires (late beats never)", t.remindersDue(store, now + 23 * 3600000).map(d => d.rec.id).indexOf("r1") >= 0);
  ok("due 25h ago does not", t.remindersDue(store, now + 25 * 3600000).map(d => d.rec.id).indexOf("r1") < 0);
  ok("the grace window is explained", /waking someone at 3am about something from last Tuesday/.test(SV));
}

console.log("\n--- delivery rides the existing message path ---");
ok("a due reminder is posted as a message", /ceoBuildMessage\(\{[\s\S]{0,300}senderLabel: "Reminder"/.test(SV));
ok("...into the user's OWN thread", /threadId: "thr_reminders_" \+ \(d\.rec\.userId/.test(SV));
ok("...which is what makes the phone buzz", /pushNotify\(store, d\.org, built\.threadId/.test(SV));
ok("the reason for reusing messages rather than a new channel is recorded", /Rather than build a second notification channel/.test(SV));
ok("the write is confined to messages + reminders", /\{ messages: built\.records, reminders: \[/.test(SV));
ok("...and goes through mergeState, so it cannot touch anything else", /store = mergeState\(store, patch\)/.test(SV));
ok("fired is stamped so it never repeats", /fired: true, firedAt: now/.test(SV));
ok("the sweep only runs when the server is the main module", /if \(require\.main === module\)[\s\S]{0,120}reminderSweep/.test(SV));
ok("...and the timer is unref'd so it can't hold the process open", /_remTimer\.unref/.test(SV));

console.log("\n--- editing a reminder ---");
ok("moving the time re-arms a fired reminder", /if \(r\.fired && \(\+r\.dueAt \|\| 0\) !== when\) \{ r\.fired = false/.test(RM));
ok("...and the editor says so", /Changing the time will send it again/.test(RM));
ok("a reminder needs text", /What should it say\?/.test(RM));
ok("a reminder needs a day", /Pick a day\./.test(RM));
ok("upcoming excludes fired ones", /filter\(function \(r\) \{ return !r\.fired; \}\)/.test(RM));
ok("an overdue one is visibly overdue", /var late = \(\+r\.dueAt \|\| 0\) < Date\.now\(\)/.test(RM));
ok("the empty state teaches the voice route", /Say "remind me on Tuesday to/.test(RM));

console.log("\n--- wiring ---");
{
  const SHELL = fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8");
  ok("js/132 registered", SHELL.indexOf('src="js/132-journal-actions.js"') > 0);
  ok("js/133 registered", SHELL.indexOf('src="js/133-reminders.js"') > 0);
  ok("the Journal renders offers", /jaCardHTML==="function"\)\?jaCardHTML\(\):""/.test(LF));
  ok("the Journal renders reminders", /rmCardHTML==="function"\)\?rmCardHTML\(\):""/.test(LF));
  ok("both degrade to nothing if their module is absent", /\(typeof jaCardHTML==="function"\)/.test(LF) && /\(typeof rmCardHTML==="function"\)/.test(LF));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
