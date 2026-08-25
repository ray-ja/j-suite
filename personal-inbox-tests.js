/* personal-inbox-tests.js — one list to look at (js/140) + the scoped to-do write route.

   Ray, 2026-08-24, going to bed: "make sure it's all on the personal one… You can have it have items from
   the multiple businesses, but the personal one is like my personal list. And that's where I'm gonna look.
   I don't wanna have to dig through each individual business to figure out what I need to do unless it's
   stuff that's specifically just for that business, and it's not critical."

   ⭐ THE SUITE THAT MATTERS is piUrgent(). The rule for what surfaces has to stay MECHANICAL — a date, a
   priority, a pin — because the moment it becomes a judgement call it becomes me deciding what matters in
   his life, and he'd be back to not trusting the one list he's supposed to be able to trust.

   Pure node. Run: node personal-inbox-tests.js */
const fs = require("fs"), path = require("path");
const pi = require("./js/140-personal-inbox.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const PI = fs.readFileSync(path.join(__dirname, "js", "140-personal-inbox.js"), "utf8");
const TD = fs.readFileSync(path.join(__dirname, "js", "10-to-do.js"), "utf8");
const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const TODAY = "2026-08-25";

console.log("\n--- ⭐ what surfaces is mechanical, never a judgement call ---");
{
  eq("recently overdue surfaces", pi.piUrgent({ due: "2026-08-20" }, TODAY), "overdue");
  eq("due today surfaces", pi.piUrgent({ due: TODAY }, TODAY), "soon");
  eq("due in 7 days surfaces", pi.piUrgent({ due: "2026-09-01" }, TODAY), "soon");
  eq("due in 8 days does NOT", pi.piUrgent({ due: "2026-09-02" }, TODAY), null);
  eq("pinned surfaces", pi.piUrgent({ pin: true }, TODAY), "pinned");
  eq("⭐ merely being OPEN does not surface", pi.piUrgent({ title: "someday" }, TODAY), null);

  /* ⚠️ BOTH CALIBRATED AGAINST HIS REAL STORE. The first draft surfaced anything High and treated any past
     date as overdue — that produced THIRTY-TWO items, which is the wall of everything he asked me to fix. */
  eq("⭐ High priority ALONE no longer surfaces — the most-abused field on a to-do", pi.piUrgent({ priority: "High" }, TODAY), null);
  eq("...not even High with a far-future date", pi.piUrgent({ priority: "High", due: "2027-01-01" }, TODAY), null);
  eq("...but High with a real near date still does, via the date", pi.piUrgent({ priority: "High", due: "2026-08-27" }, TODAY), "soon");
  eq("⭐ overdue EXPIRES — 3 months past is abandoned, not urgent", pi.piUrgent({ due: "2026-05-01" }, TODAY), null);
  eq("...30 days overdue still counts", pi.piUrgent({ due: "2026-07-26" }, TODAY), "overdue");
  eq("...31 days does not", pi.piUrgent({ due: "2026-07-25" }, TODAY), null);
  eq("a pinned ancient item still surfaces — the explicit escape hatch", pi.piUrgent({ pin: true, due: "2020-01-01" }, TODAY), "pinned");
  eq("the stale window is configurable", pi.piUrgent({ due: "2026-05-01" }, TODAY, 7, 400), "overdue");

  eq("done never surfaces", pi.piUrgent({ due: "2026-08-01", done: true }, TODAY), null);
  eq("...not even pinned", pi.piUrgent({ pin: true, done: true }, TODAY), null);
  eq("deleted never surfaces", pi.piUrgent({ pin: true, deleted: true }, TODAY), null);
  eq("null is safe", pi.piUrgent(null, TODAY), null);
  eq("a malformed date is ignored, not crashed on", pi.piUrgent({ due: "next tuesday" }, TODAY), null);
  eq("an empty due is ignored", pi.piUrgent({ due: "" }, TODAY), null);
  eq("pin wins over everything", pi.piUrgent({ pin: true, priority: "High", due: "2026-08-27" }, TODAY), "pinned");
  ok("the recalibration and why it happened are recorded", /THIRTY-TWO items/.test(PI));
  ok("...including that High is the most-abused field", /most-abused field/.test(PI));
  ok("...and that an abandoned task dressed as urgent teaches him to stop reading", /stop reading the list/.test(PI));
  eq("the window is configurable", pi.piUrgent({ due: "2026-09-02" }, TODAY, 30), "soon");
  ok("the mechanical rule is written down", /never a judgement call|deliberately mechanical/.test(PI));
}

console.log("\n--- it is a VIEW, not a copy ---");
{
  ok("ticking writes to the ORIGIN org", /S\[org\] \|\| \{\}\)\.todos/.test(PI) && /window\.piTick/.test(PI));
  ok("...never into the personal org's own todos", !/D\(\)\.todos\.push/.test(PI));
  ok("opening switches to the org that owns it", /setBiz\(org\)/.test(PI));
  ok("...using the real function name, verified not assumed", /setBiz, not switchBiz/.test(PI));
  ok("the reason a copy would be wrong is recorded", /in a new costume|VIEW, NOT A COPY/.test(PI));
}

console.log("\n--- it only exists where he asked for it ---");
ok("nothing renders in a business org", /if \(!piIsPersonal\(\)\) return "";/.test(PI));
ok("...and nothing renders when nothing qualifies", /if \(!all\.length\) return "";/.test(PI));
ok("⭐ the section is capped so a backlog can never flood the one screen he trusts", /PI_MAX = 8/.test(PI) && /all\.slice\(0, PI_MAX\)/.test(PI));
ok("...and says how many it held back", /\+ ' \+ hidden \+ ' more urgent/.test(PI));
/* the source escapes the apostrophe (what\'s) — match either form */
ok("the card says what it is and isn't", /Only what\\?'s urgent shows here/.test(PI));
ok("it is rendered on the To-Do list", /piCardHTML==="function"\)\?piCardHTML\(\):""/.test(TD));
ok("...and degrades if js/140 is absent", /typeof piCardHTML==="function"/.test(TD));
ok("js/140 is registered in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/140-personal-inbox.js"') > 0);

console.log("\n--- ⚠️ the To-Do heading bug this uncovered ---");
ok("the heading no longer hardcodes two org names", !/S\.biz==="obx"\?"OBX Lot Solutions":"Jamieson Automation"/.test(TD));
ok("...it uses the registry's real name", /\(\(S\.registry\|\|\[\]\)\.find\(r=>r&&r\.id===S\.biz\)\|\|\{\}\)\.name/.test(TD));
ok("...and the bug is recorded", /captioned "Jamieson\s*\n?\s*Automation"/.test(TD) || /wrong everywhere except two orgs/.test(TD));

console.log("\n--- the scoped to-do write route ---");
ok("POST /api/ceo/todo exists", /\/api\/ceo\/todo/.test(SV));
ok("...gated by the CEO write token", /\/api\/ceo\/todo"\)[\s\S]{0,400}ceoTokenOk\(tok, CEO_WRITE_TOKEN\)/.test(SV));
ok("⭐ ONLY todos can be written", /mergeState\(store, \{ \[biz\]: \{ todos: recs \} \}\)/.test(SV));
ok("...and it says so", /ONLY `todos` in the incoming/.test(SV));
ok("an unknown org is refused", /return J\(400, \{ error: "unknown org" \}\)/.test(SV));
ok("ids are derived from title+day, so re-running updates instead of duplicating", /createHash\("sha1"\)\.update\(biz \+ "\|" \+ day \+ "\|" \+ title\.toLowerCase\(\)\)/.test(SV));
ok("the number of items is capped", /p\.items\.slice\(0, 40\)/.test(SV));
ok("priority is validated against an allowlist", /\["High", "Medium", "Low"\]\.indexOf/.test(SV));
ok("a malformed due date is dropped, not stored", /\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(String\(it\.due/.test(SV));
ok("why this writes rather than proposes is recorded", /a proposal is a decision he has to make/.test(SV));
ok("...and that deleting is the undo", /delete anything he disagrees with/.test(SV));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
