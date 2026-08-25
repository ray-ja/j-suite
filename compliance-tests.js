/* compliance-tests.js — the accountability system, rebuilt so it can't keep score of him.

   Ray, 2026-08-25, after being told "You've been silent for four days. I'm not going to keep pinging into
   a void": "remember how i said i want you to be in control of compliance? what do you think would work
   best?" — and then "yes" to the design below.

   THE PRINCIPLE: compliance is measured against OUTCOMES, never against his attention.

   1. ⭐ IT CANNOT COUNT HIS SILENCE. Not "shouldn't" — cannot. The unanswered tail of pings is stripped
      before the agent's context is built, and the two fields that existed only to score his
      responsiveness (`repliedSinceLastCheckin`, `hoursSinceLastPing`) are gone. An instruction to be
      polite about it is what failed the first time; the prompt literally said "say so lightly, once", and
      with four stacked pings in view that compounded into the message above.

   2. ⭐ IT GOES QUIET INSTEAD OF LOUDER. If the last thing in the thread is a ping he never answered, the
      next one does not go out. His live thread had FORTY unanswered pings and zero replies — ever.

   3. ⭐ ONLY THE WORLD ESCALATES. A hard deadline is opt-in per item and counts down what is about to
      close, never what he failed to do. Nothing becomes urgent on its own — an urgency rule that fires by
      itself is how the list became a wall of 32 items on 2026-08-24.

   Pure node. Run: node compliance-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SENT = "/home/rzy/sentinel";
const chk = require(path.join(SENT, "checkers/checkin.js"));
const PROMPT = fs.readFileSync(path.join(SENT, "agents/checkin.md"), "utf8");
const RUNNER = fs.readFileSync(path.join(SENT, "checkin.js"), "utf8");
const CLI = fs.readFileSync(path.join(SENT, "run.js"), "utf8");
const TODO = fs.readFileSync(path.join(__dirname, "js/10-to-do.js"), "utf8");
const HOME = fs.readFileSync(path.join(__dirname, "js/122-personal-home.js"), "utf8");

const TID = "thr-checkin";
const DAY = 86400000;
const NOW = Date.parse("2026-08-25T16:00:00Z");
const msg = (who, daysAgo, body) => ({ id: "m" + Math.random(), threadId: TID, senderId: who === "assistant" ? "__ceo__" : "u1",
  ts: NOW - daysAgo * DAY, body: body, deleted: false });
const slab = (msgs, todos) => ({ messages: msgs || [], todos: todos || [], budgetBills: [], lifeLogs: [], lifeTrackers: [], lifeNotes: [] });

console.log("\n--- ⭐ 1. it cannot count his silence ---");
{
  /* his real situation, in miniature: he spoke once, long ago, then a run of unanswered pings */
  const thread = [
    msg("assistant", 9, "Morning. What are you working on?"),
    msg("you", 9, "regrading the Currituck lot"),
    msg("assistant", 8, "How'd the regrade go?"),
    msg("assistant", 7, "Still on the lot?"),
    msg("assistant", 6, "Checking in."),
    msg("assistant", 5, "You've been silent for four days. I'm not going to keep pinging into a void.")
  ];
  const ctx = chk.build(slab(thread), { nowMs: NOW, threadId: TID });

  ok("⛔ the field that scored his replies is gone", !("repliedSinceLastCheckin" in ctx), Object.keys(ctx));
  ok("⛔ ...and the one that timed his last ping", !("hoursSinceLastPing" in ctx), Object.keys(ctx));

  /* ⭐ THE STRUCTURAL FIX: the agent literally cannot see the pile */
  const seen = ctx.conversation.map(m => m.who);
  ok("⭐ the unanswered run of pings is not in what the agent sees", seen.filter(w => w === "assistant").length === 1, seen);
  ok("⭐ ...specifically, the message he complained about is not there",
    !ctx.conversation.some(m => /silent|void/i.test(m.body)), ctx.conversation.map(m => m.body));
  ok("the exchange he DID take part in survives — his words are the memory",
    ctx.conversation.length === 2 && ctx.conversation[1].body === "regrading the Currituck lot", ctx.conversation);
  eq("...and what he last said is still available", ctx.lastStatus, "regrading the Currituck lot");
  eq("...with how long ago HE spoke, which is about him, not about his compliance", ctx.hoursSinceHeSpoke, 216);

  /* ⚠️ NOT JUST THE TRAILING RUN — the hole the simulation found. The moment one reply of his lands at the
     end, everything before it counts as "answered" by position and the whole back catalogue returns. */
  const cameBack = chk.build(slab([
    msg("assistant", 8, "How'd the regrade go?"),
    msg("assistant", 7, "Still on the lot?"),
    msg("assistant", 5, "You've been silent for four days. I'm not going to keep pinging into a void."),
    msg("you", 0, "on a roof all day")
  ]), { nowMs: NOW, threadId: TID });
  ok("⭐ a reply at the end does NOT resurrect every earlier ping",
    !cameBack.conversation.some(m => m.who === "assistant"), cameBack.conversation.map(m => m.who + ": " + m.body));
  ok("...and his own words still survive", cameBack.conversation.length === 1 && cameBack.lastStatus === "on a roof all day");

  /* an exchange means the reply BELONGS to the ping */
  const prompt2 = chk.build(slab([msg("assistant", 1.0, "What are you on?"), msg("you", 0.9, "framing")]), { nowMs: NOW, threadId: TID });
  ok("a ping he answered the same day is a real exchange, and survives",
    prompt2.conversation.filter(m => m.who === "assistant").length === 1, prompt2.conversation);
  const late = chk.build(slab([msg("assistant", 5, "What are you on?"), msg("you", 0, "back now")]), { nowMs: NOW, threadId: TID });
  ok("⭐ a reply five days later is him coming back, not an answer — the ping is dropped",
    !late.conversation.some(m => m.who === "assistant"), late.conversation);

  /* ⭐ and messages written under the OLD rules are removed outright, not pretended away */
  ok("silence-counting is recognised as a rule break", chk.brokeTheRules({ who: "assistant", body: "You've been silent for four days." }));
  ok("...as is the business nag from the 2026-08-03 break", chk.brokeTheRules({ who: "assistant", body: "Wife's floats are nine days overdue." }));
  ok("⛔ HIS messages are never filtered, whatever they say", !chk.brokeTheRules({ who: "you", body: "the invoice is overdue and i've been silent, sorry" }));
  ok("an ordinary ping of mine is untouched", !chk.brokeTheRules({ who: "assistant", body: "Morning. What are you on today?" }));
  ok("⭐ the prompt no longer ASKS it to ignore them — they are gone",
    /have been REMOVED/.test(PROMPT) && !/Treat them as if they are not there/i.test(PROMPT));

  /* the count still exists for the runner, but is namespaced away from the agent */
  eq("the runner can still count the pile", ctx._unansweredPings, 4);
  ok("⭐ ...under a private key the agent has no reason to read", Object.keys(ctx).filter(k => k[0] === "_").join() === "_unansweredPings");
}

console.log("\n--- ⭐ 2. it goes quiet instead of louder ---");
{
  ok("the gate exists in the runner", /_unansweredPings/.test(CODE(RUNNER)) && /skip: true/.test(CODE(RUNNER)));
  ok("⭐ ...and a hard deadline is the one thing that overrides it", /hardDeadlines[\s\S]{0,120}d\.days <= 3/.test(CODE(RUNNER)));
  ok("⭐ nothing announces the pause — a message about messaging is still a message",
    /body: ""/.test(CODE(RUNNER)));
  ok("the CLI prints the quiet path instead of posting", /STAYING QUIET/.test(CLI) && /if \(res\.skip\)/.test(CODE(CLI)));
  ok("...and returns BEFORE the post call", CODE(CLI).indexOf("res.skip") < CODE(CLI).indexOf("report.postCheckin"));
  ok("the threshold is configurable, defaulting to one", /maxUnanswered != null[\s\S]{0,80}: 1/.test(CODE(RUNNER)));

  /* ⭐ and it resumes the instant he says anything — silence from him, silence from me; a word from him,
     a word back. Nothing has to be reset by hand. */
  const quiet = chk.build(slab([msg("assistant", 1, "ping")]), { nowMs: NOW, threadId: TID });
  eq("one unanswered ping is enough to hold the next one", quiet._unansweredPings, 1);
  const spoke = chk.build(slab([msg("assistant", 1, "ping"), msg("you", 0, "on a roof all day")]), { nowMs: NOW, threadId: TID });
  eq("⭐ he replies → the count is zero again, with nothing to reset", spoke._unansweredPings, 0);
  eq("...and it picks up what he actually said", spoke.lastStatus, "on a roof all day");
}

console.log("\n--- ⭐ 3. only the world escalates ---");
{
  const todos = [
    { id: "t1", title: "Holiday-light deposits", due: "2026-09-15", hardDeadline: true,
      deadlineWhy: "competitors take deposits in September" },
    { id: "t2", title: "Tidy the shed", due: "2026-06-01" },                      // long overdue, NOT urgent
    { id: "t3", title: "Renew the GL policy", due: "2027-06-01", hardDeadline: true, deadlineWhy: "policy lapses" },
    { id: "t4", title: "Something done", due: "2026-08-26", hardDeadline: true, done: true }
  ];
  const d = chk.hardDeadlines(slab([], todos), "2026-08-25", NOW, 30);

  ok("⭐ a marked item inside the window is a deadline", d.length === 1 && d[0].title === "Holiday-light deposits", d);
  eq("...counted in days", d[0].days, 21);
  eq("⭐ ...and carries HIS reason, in world terms", d[0].why, "competitors take deposits in September");
  ok("⛔ an overdue but UNMARKED to-do never escalates — a to-do that slipped is not an emergency",
    !d.some(x => /shed/i.test(x.title)));
  ok("⛔ a marked item far outside the window waits its turn", !d.some(x => /GL policy/.test(x.title)));
  ok("⛔ a done one is not a deadline", !d.some(x => /done/i.test(x.title)));
  ok("⭐ nothing becomes urgent by accident — it is opt-in per item", /t\.hardDeadline/.test(CODE(fs.readFileSync(path.join(SENT, "checkers/checkin.js"), "utf8"))));
  ok("...and the 32-item wall is why", /32 items|wall/i.test(TODO) || /by accident/.test(TODO));
}

console.log("\n--- the prompt can no longer be talked into it ---");
{
  ok("⛔ the branch that told it to mention non-response is gone",
    !/didn't reply/i.test(PROMPT) && !/haven't heard back/i.test(PROMPT), (PROMPT.match(/.*didn't reply.*/i) || [])[0]);
  ok("⭐ it is told there is no such field, and that this is deliberate",
    /no field telling you whether he replied/i.test(PROMPT) && /deliberate/i.test(PROMPT));
  ok("⭐ ...and told not to infer it from gaps either", /infer his responsiveness/i.test(PROMPT));
  ok("⛔ mentioning his silence is banned in every form it takes",
    /Never mention his silence/i.test(PROMPT) && /no rush/i.test(PROMPT) && /whenever you get a chance/i.test(PROMPT));
  ok("⭐ the actual message that caused this is quoted, so the rule has a reason attached",
    /pinging into a void/.test(PROMPT) && /Ray was working/.test(PROMPT));
  ok("⛔ it can't comment on its own cadence either", /never comment on your own cadence/i.test(PROMPT));
  ok("⭐ urgency is defined as coming from the world", /Urgency comes from the world/i.test(PROMPT));
  /* ⚠️ collapse whitespace before matching a phrase in a markdown prompt — it wraps across lines */
  const P1 = PROMPT.replace(/\s+/g, " ");
  ok("...with the framing spelled out", /say what the WORLD is about to do/.test(P1), P1.slice(P1.indexOf("Urgency comes"), P1.indexOf("Urgency comes") + 260));
  ok("⭐ and repeated ignoring is named as MY failure, not his", /I got wrong, not a thing he needs told again/i.test(PROMPT));
  ok("the therapy / wellness / more-structure bans all survived",
    /wellness app/i.test(PROMPT) && /more tracking/i.test(PROMPT));
  ok("the personal/business wall survived", /cap should be separate/i.test(PROMPT));
}

console.log("\n--- the templated fallback got the same treatment ---");
{
  const t1 = chk.template(chk.build(slab([msg("assistant", 2, "ping"), msg("assistant", 1, "ping again")]), { nowMs: NOW, threadId: TID }));
  ok("⛔ no message about not hearing back", !/heard back|haven't|silent|waiting/i.test(t1), t1);
  ok("...it just asks", /working on right now/i.test(t1));

  const t2 = chk.template(chk.build(slab([msg("you", 0.2, "digging the french drain")]), { nowMs: NOW, threadId: TID }));
  ok("a recent thing he said is picked up", /french drain/.test(t2), t2);

  /* ⚠️ but not one from last week, as if no time had passed */
  const t3 = chk.template(chk.build(slab([msg("you", 8, "digging the french drain")]), { nowMs: NOW, threadId: TID }));
  ok("⚠️ a stale status is NOT resurfaced as though it were current", !/french drain/.test(t3), t3);

  const t4 = chk.template(chk.build(slab([], [{ id: "h", title: "Holiday-light deposits", due: "2026-08-27", hardDeadline: true, deadlineWhy: "competitors take deposits in September" }]), { nowMs: NOW, threadId: TID }));
  ok("⭐ a hard deadline surfaces with a countdown", /Holiday-light deposits/.test(t4) && /in 2 days/.test(t4), t4);
  ok("⭐ ...framed as what the world does", /competitors take deposits/.test(t4));
  ok("⛔ ...and never as something he failed to do", !/you (still )?haven'?t|forgot|again/i.test(t4));
}

console.log("\n--- one place: it shows up on Today too ---");
{
  ok("Today marks a hard-deadline item", /td\.hardDeadline \? '⏳ '/.test(HOME));
  ok("⭐ ...with a countdown of what closes", /phDeadlineHTML/.test(CODE(HOME)));
  ok("...and his own reason beside it", /deadlineWhy/.test(CODE(HOME)));

  const c = { console, window: {}, esc: s => String(s == null ? "" : s) };
  vm.createContext(c);
  const i = HOME.indexOf("function phDeadlineHTML"), j = HOME.indexOf("\n}", i);
  vm.runInContext(HOME.slice(i, j + 2) + ";this.f=phDeadlineHTML;", c);
  const txt = (due, today) => c.f({ due: due }, today).replace(/<[^>]+>/g, "");
  eq("⭐ it counts down the window, not him", txt("2026-09-15", "2026-08-25"), "closes in 21 days");
  eq("today", txt("2026-08-25", "2026-08-25"), "closes today");
  eq("tomorrow", txt("2026-08-26", "2026-08-25"), "closes tomorrow");
  eq("⭐ and past is stated as a fact about the window, not a failure of his",
    txt("2026-08-22", "2026-08-25"), "the window closed 3 days ago");
  eq("a missing date renders nothing rather than NaN", txt("", "2026-08-25"), "");
  ok("⛔ the word 'overdue' is not used for a deadline — that's for ordinary to-dos",
    !/overdue/i.test(c.f({ due: "2026-08-22" }, "2026-08-25")));

  /* the marker has to be settable, or the whole category is inert */
  ok("⭐ a to-do can be marked as a hard deadline", /id="td_hard"/.test(TODO));
  ok("...with a place to say what closes", /id="td_hardwhy"/.test(TODO));
  ok("⚠️ and it is refused without a date, since a deadline with no date can never fire",
    /hardDeadline&&!td\.due/.test(CODE(TODO)));
  ok("the reason is saved, and cleared when unmarked", /td\.deadlineWhy=td\.hardDeadline\?/.test(CODE(TODO)));
}

console.log("\n--- ⛔ nothing here writes to his data ---");
{
  const src = fs.readFileSync(path.join(SENT, "checkers/checkin.js"), "utf8");
  ok("the checker is read-only", !/\.push\(|save\(|writeFile/.test(CODE(src).replace(/out\.push|L\.push/g, "")));
  ok("the runner posts a message and nothing else", !/\/api\/ceo\/(todo|propose)/.test(CODE(RUNNER)));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
