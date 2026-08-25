/* personal-actions-tests.js — the talk box on Today can now DO things (and still won't do them uninvited).

   Ray, 2026-08-25: "What is, like, the little chat feature on the today page? I wrote in it a little bit,
   and it told me that it can't add things to my calendar. Can we make it able to do that?"

   ⚠️ It was deliberately tool-less so it could never turn a bad day into a task list. That rule was right;
   refusing a DIRECT INSTRUCTION was not. The line, same as the journal extractor's, is who started it:
     ⛔ he vents  → never manufacture tasks
     ✅ he asks   → obviously do it
   And everything is a PROPOSAL: the server never executes, he taps Confirm.

   Pure node. Run: node personal-actions-tests.js */
const fs = require("fs"), path = require("path");
const t = require("./sync-server");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const PH = fs.readFileSync(path.join(__dirname, "js", "122-personal-home.js"), "utf8");
const LF = fs.readFileSync(path.join(__dirname, "js", "78-life-tracker.js"), "utf8");
const P = t.capParsePersonalAction;

console.log("\n--- the three things a personal app actually holds ---");
eq("three tools, no more", t.PERSONAL_TOOLS.length, 3);
eq("...calendar, to-do, reminder", t.PERSONAL_TOOLS.map(x => x.name).join(","), "addEvent,addTodo,addReminder");
ok("every tool is strict-schema'd", t.PERSONAL_TOOLS.every(x => x.strict === true));
ok("the personal org gets these, never the business ones", /orgIsPersonal\(store, org\) \? PERSONAL_TOOLS : CAP_TOOLS/.test(SV));
ok("...and tool_use is routed to the matching validator", /ctx && ctx\.personal\) \? capParsePersonalAction : capParseAction/.test(SV));
ok("...with ctx.personal actually set", /personal: orgIsPersonal\(store, org\)/.test(SV));

console.log("\n--- ⭐ the model is untrusted; every value is re-checked ---");
{
  eq("a good event survives", JSON.stringify(P("addEvent", { title: "Vera checkup", date: "2026-09-03", time: "14:00", annual: false })),
     JSON.stringify({ kind: "addEvent", title: "Vera checkup", date: "2026-09-03", time: "14:00", annual: false }));
  eq("an event with no date is refused", P("addEvent", { title: "x", date: "soon" }), null);
  eq("...and with no title", P("addEvent", { title: "  ", date: "2026-09-03" }), null);
  eq("a junk time is dropped, the event still stands", P("addEvent", { title: "x", date: "2026-09-03", time: "2pm" }).time, null);
  eq("annual is coerced to a real boolean", P("addEvent", { title: "x", date: "2026-09-03", annual: "yes" }).annual, true);

  eq("a to-do needs a title", P("addTodo", { title: "" }), null);
  eq("a dateless to-do is fine", P("addTodo", { title: "Call the insurance guy" }).due, null);
  eq("a junk due date is dropped", P("addTodo", { title: "x", due: "next week" }).due, null);

  eq("⭐ a reminder with NO DATE is refused — it could never fire", P("addReminder", { text: "x", date: null }), null);
  eq("a reminder with no time defaults to 9am, not midnight", P("addReminder", { text: "x", date: "2026-08-27", time: null }).time, "09:00");
  eq("reminder text is required", P("addReminder", { text: "", date: "2026-08-27" }), null);

  eq("⭐ a BUSINESS tool is not parseable from a personal chat", P("clockIn", { jobId: "j1" }), null);
  eq("an unknown tool is refused", P("nonsense", { a: 1 }), null);
  eq("null input is safe", P("addTodo", null), null);
  ok("long values are clipped, not stored whole", P("addTodo", { title: "z".repeat(500) }).title.length <= 200);
  ok("whitespace is collapsed", P("addTodo", { title: "a\n\n   b" }).title === "a b");
}

console.log("\n--- ⛔ the venting rule survives ---");
{
  const S = t.PERSONAL_COMPANION_SYSTEM;
  ok("it still says let him vent", /WHEN HE VENTS, LET HIM/.test(S));
  ok("...and not to turn it into an action item", /do not turn it into an action item/.test(S));
  ok("the tools are explicitly gated to being ASKED", /ONLY when he asks you to/.test(S));
  ok("...and forbidden while he's venting", /NEVER reach for a tool because he is venting/.test(S));
  ok("...with the reason stated plainly", /a bad day is not a task list/.test(S));
  ok("it's told that noise is what makes him stop reading", /noise is what makes him stop reading/.test(S));
  ok("therapy is still never suggested", /NEVER suggest therapy/.test(S));
}

console.log("\n--- nothing is written until he taps ---");
ok("the server never executes", /SERVER NEVER EXECUTES/.test(SV));
ok("actions arrive as pending cards", /state: "pending", cid:/.test(PH));
ok("there is a Confirm and a Cancel", /phConfirmAction/.test(PH) && /phCancelAction/.test(PH));
ok("confirming writes a calendar event", /d\.personalEvents\.push\(e\)/.test(PH));
ok("...a to-do", /d\.todos\.push\(t\)/.test(PH));
ok("...or a reminder", /d\.reminders\.push\(r\)/.test(PH));
ok("an unknown kind errors rather than writing something wrong", /I don\\'t know how to do that one/.test(PH));
/* \s+ — the phrase wraps a line in the source */
ok("the why is recorded", /never\s+silently does something to his life/.test(PH));

console.log("\n--- ⚠️ the four things a third message role broke ---");
ok("the thread loader keeps action cards (it filtered them out before)", /m\.role === "action" && m\.action/.test(PH));
ok("the renderer draws them as cards, not bubbles", /if \(m\.role === "action"\) \{ h \+= phActionCard\(m\); return; \}/.test(PH));
ok("⭐ only real turns are sent to the model — a card has no content", /m\.role === "user" \|\| m\.role === "assistant"\) && typeof m\.content === "string"\)\.slice\(-14\)/.test(PH));
ok("saving to the journal skips them instead of writing 'undefined'", /skip action cards/.test(PH));

console.log("\n--- the interests wall is off Today ---");
ok("Today no longer renders it", !/h \+= phInterestsCard\(\);/.test(PH));
ok("...and the reason is recorded", /NOT A HOME-SCREEN CARD/.test(PH));
ok("it moved to Life, still editable", /phInterestsCard==="function"\)h\+=phInterestsCard\(\)/.test(LF));
ok("...and is exported so Life can call it", /window\.phInterestsCard = phInterestsCard/.test(PH));
ok("the companion still gets the interests from the record either way", /feed the\s*\n?\s*companion's context|feed the companion/.test(PH));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
