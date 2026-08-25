/* todo-proposals-tests.js — surfacing the nightly reconciler's proposals (js/137).

   Ray, 2026-08-24: "is there a subagent that reads my journal entries and manages my to do list?"

   ⚠️ WHY THIS MODULE HAD TO EXIST AT ALL, which is also the regression this suite guards:
   js/57's approvals screen lists from `APPR_BIZES = ["obx","jam"]` — a hardcoded legacy pair — and the
   personal org deliberately has no Approvals tab. A proposal aimed at the personal org was therefore
   written to the server and then INVISIBLE. The reconciler would have run nightly into a void.

   ⭐ And the design rule: this file must NEVER grow its own apply logic. It delegates to js/57's
   apprApprove/apprReject, which are org-agnostic and already proven. Two implementations of "write the
   record and stamp the proposal" is how they drift.

   Pure node. Run: node todo-proposals-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const TP = fs.readFileSync(path.join(__dirname, "js", "137-todo-proposals.js"), "utf8");
const TD = fs.readFileSync(path.join(__dirname, "js", "10-to-do.js"), "utf8");
const AP = fs.readFileSync(path.join(__dirname, "js", "57-approvals.js"), "utf8");

/* run js/137 with a stubbed app around it */
function ctxWith(org, slab) {
  const S = { biz: org }; S[org] = slab;
  const c = {
    S: S, console: console, esc: s => String(s == null ? "" : s),
    confirm: () => true, render: () => {},
    document: { getElementById: () => null },
    __approved: [], __rejected: [],
    apprApprove: (b, id) => c.__approved.push(b + ":" + id),
    apprReject: (b, id) => c.__rejected.push(b + ":" + id)
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(TP, c, { filename: "js/137-todo-proposals.js" });
  return c;
}

const PENDING = [
  { id: "pc1", status: "pending", collection: "todos", type: "update", targetId: "t1", createdAt: 300,
    summary: "Close “Call the insurance guy” — \"Finally got hold of him\" — 2026-08-23" },
  { id: "pc2", status: "pending", collection: "todos", type: "create", createdAt: 200,
    after: { title: "Fix the rope in Mutiny", done: false }, summary: "Add “Fix the rope in Mutiny” — journal 08-23" },
  { id: "pc3", status: "applied", collection: "todos", type: "create", createdAt: 100, after: { title: "Old one" }, summary: "x" },
  { id: "pc4", status: "pending", collection: "quotes", type: "create", createdAt: 400, after: {}, summary: "not a to-do" },
  { id: "pc5", status: "pending", collection: "todos", type: "create", createdAt: 50, deleted: true, after: {}, summary: "deleted" }
];
const SLAB = { pendingChanges: PENDING, todos: [{ id: "t1", title: "Call the insurance guy" }] };

console.log("\n--- ⭐ it reads the CURRENT org, not a hardcoded pair ---");
{
  const c = ctxWith("mqwvs3mq98pij", SLAB);          // the personal org — invisible to js/57
  eq("two pending to-do proposals found", c.tpCount(), 2);
  eq("newest first", c.tpPending()[0].id, "pc1");
  ok("an applied one is excluded", !c.tpPending().some(p => p.id === "pc3"));
  ok("a non-todo collection is excluded", !c.tpPending().some(p => p.id === "pc4"));
  ok("a deleted one is excluded", !c.tpPending().some(p => p.id === "pc5"));

  const c2 = ctxWith("obx", { pendingChanges: [], todos: [] });
  eq("an org with nothing pending shows nothing", c2.tpCount(), 0);
  eq("...and renders no card at all", c2.tpCardHTML(), "");
  eq("a missing slab is safe", ctxWith("nope", undefined).tpCount(), 0);
}
ok("the reason js/57 couldn't be used is recorded", /APPR_BIZES = \["obx", "jam"\]/.test(TP));
ok("js/57 really is hardcoded (the bug this works around still exists)", /const APPR_BIZES = \["obx", "jam"\]/.test(AP));

console.log("\n--- ⭐ the same job proposed twice shows once ---");
{
  const dupes = [
    { id: "a1", status: "pending", collection: "todos", type: "create", createdAt: 300, after: { title: "Fix the lawnmower" }, summary: "Add “Fix the lawnmower” — journal 08-14" },
    { id: "a2", status: "pending", collection: "todos", type: "create", createdAt: 200, after: { title: "fix the LAWNMOWER" }, summary: "Add “fix the LAWNMOWER” — journal 08-14 again" },
    { id: "b1", status: "pending", collection: "todos", type: "update", createdAt: 250, targetId: "t9", summary: "Close “X” — done" },
    { id: "b2", status: "pending", collection: "todos", type: "update", createdAt: 150, targetId: "t9", summary: "Close “X” — done again" },
    { id: "c1", status: "pending", collection: "todos", type: "create", createdAt: 100, after: { title: "Something else" }, summary: "Add “Something else” — x" }
  ];
  const c = ctxWith("mqwvs3mq98pij", { pendingChanges: dupes, todos: [{ id: "t9", title: "X" }] });
  eq("five proposals, three distinct jobs", c.tpCount(), 3);
  ok("the newest of each pair is the one shown", c.tpPending().map(p => p.id).indexOf("a1") >= 0 && c.tpPending().map(p => p.id).indexOf("a2") < 0);
  ok("...matching case-insensitively", c.tpPending().filter(p => /lawnmower/i.test((p.after || {}).title || "")).length === 1);
  ok("duplicate CLOSES collapse by target too", c.tpPending().filter(p => p.targetId === "t9").length === 1);

  /* accepting must clear the twin, or the same to-do gets added twice */
  c.__approved.length = 0; c.__rejected.length = 0;
  c.tpAccept("a1");
  eq("accepting approves the one", c.__approved.join(","), "mqwvs3mq98pij:a1");
  eq("...and rejects its twin, so it can't be added again", c.__rejected.join(","), "mqwvs3mq98pij:a2");

  c.__rejected.length = 0;
  c.tpReject("b1");
  eq("dismissing one also dismisses its twin", c.__rejected.sort().join(","), "mqwvs3mq98pij:b1,mqwvs3mq98pij:b2");

  c.__rejected.length = 0;
  c.tpDismissAll();
  eq("'not now' clears every proposal including twins", c.__rejected.length, 5);
}
{
  const tp = require("./js/137-todo-proposals.js");
  eq("an add keys on its title", tp.tpDedupeKey({ type: "create", after: { title: "Do X" } }), "add:do x");
  eq("a close keys on its target", tp.tpDedupeKey({ type: "update", targetId: "t1" }), "update:t1");
  ok("different jobs don't collide", tp.tpDedupeKey({ type: "create", after: { title: "A" } }) !== tp.tpDedupeKey({ type: "create", after: { title: "B" } }));
  eq("null is safe", tp.tpDedupeKey(null), "");
}

console.log("\n--- the card ---");
{
  const c = ctxWith("mqwvs3mq98pij", SLAB);
  const h = c.tpCardHTML();
  ok("a close is labelled Close", /Close</.test(h), h.slice(0, 400));
  ok("an add is labelled Add", /Add</.test(h));
  ok("the close names the real to-do title", /Call the insurance guy/.test(h));
  ok("the add names its title", /Fix the rope in Mutiny/.test(h));
  ok("⭐ the evidence is shown, not hidden", /Finally got hold of him/.test(h));
  ok("it states nothing changes without a tap", /Nothing changes unless you tap it/.test(h));
  ok("there is a one-tap 'not now'", /tpDismissAll/.test(h));
}

console.log("\n--- title + evidence extraction ---");
{
  const c = ctxWith("mqwvs3mq98pij", SLAB);
  const tp = require("./js/137-todo-proposals.js");
  eq("the evidence is everything after the em dash", tp.tpWhyOf({ summary: "Close “X” — because Y" }), "because Y");
  eq("a summary with no dash is used whole", tp.tpWhyOf({ summary: "just this" }), "just this");
  eq("no summary is safe", tp.tpWhyOf({}), "");
  eq("a create's title comes off the proposal", c.tpTitleOf({ type: "create", after: { title: "New thing" } }), "New thing");
  eq("an update's title is looked up on the real to-do", c.tpTitleOf({ type: "update", targetId: "t1" }), "Call the insurance guy");
  eq("a missing target degrades readably", c.tpTitleOf({ type: "update", targetId: "gone" }), "(that to-do)");
}

console.log("\n--- ⭐ it delegates, it never applies ---");
{
  const c = ctxWith("mqwvs3mq98pij", SLAB);
  c.tpAccept("pc1");
  eq("accept calls js/57's apply with the CURRENT org", c.__approved[0], "mqwvs3mq98pij:pc1");
  c.tpReject("pc2");
  eq("reject calls js/57's reject with the current org", c.__rejected[0], "mqwvs3mq98pij:pc2");
  c.__rejected.length = 0;
  c.tpDismissAll();
  eq("dismiss-all rejects every pending one", c.__rejected.length, 2);
}
ok("no write logic is duplicated here — no direct todos push", !/todos\.push|\.done\s*=\s*true/.test(TP));
ok("...and the reason is recorded", /Two implementations/.test(TP) || /not duplicated here/.test(TP));

console.log("\n--- wired into the To-Do tab ---");
ok("the card renders on the To-Do list", /tpCardHTML==="function"\)\?tpCardHTML\(\):""/.test(TD));
ok("...above the list, where the to-dos are", TD.indexOf("tpCardHTML") < TD.indexOf("No to-dos yet"));
ok("...and degrades if js/137 is absent", /typeof tpCardHTML==="function"/.test(TD));
ok("js/137 is registered in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/137-todo-proposals.js"') > 0);

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
