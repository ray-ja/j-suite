/* ceo-org-routing-tests.js — /api/ceo/message + /api/ceo/propose must honour the TARGET ORG.
   Regression guard for: BIZES was the legacy ["obx","jam"] pair, so ceoBuildMessage/ceoBuildProposal
   silently coerced every other org id to "obx". A Sentinel/Cap post aimed at the escape-room or the
   personal org landed in OBX — and a broadcast would have landed crew-visible in the wrong org.
   Pure node. Run: node ceo-org-routing-tests.js */
const sv = require("./sync-server.js");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

/* a store shaped like the real one: four orgs + a users list */
const RAY = "u_ray", CHASE = "u_chase";
function store() {
  return {
    users: [
      { id: RAY, name: "Ray", role: "owner", superAdmin: true },
      { id: CHASE, name: "Chase", role: "owner" }
    ],
    registry: {},
    obx: { messages: [] },
    jam: { messages: [] },
    mqwvr5d7h4a7u: { messages: [] },     // escape room
    mqwvs3mq98pij: { messages: [] }      // personal (rbjvl)
  };
}
/* which org does a built record set belong to? ceoBuildMessage returns {biz, records, threadId} */
function bizOf(p) { return sv.ceoBuildMessage(p, store()).biz; }

console.log("\n--- THE BUG: a non-BIZES org must NOT be coerced to obx ---");
eq("personal org keeps its id", bizOf({ biz: "mqwvs3mq98pij", body: "hi", to: RAY, members: [RAY] }), "mqwvs3mq98pij");
eq("escape-room org keeps its id", bizOf({ biz: "mqwvr5d7h4a7u", body: "hi", to: "__crew__" }), "mqwvr5d7h4a7u");

console.log("\n--- the legacy pair still works ---");
eq("obx", bizOf({ biz: "obx", body: "hi", to: "__crew__" }), "obx");
eq("jam", bizOf({ biz: "jam", body: "hi", to: "__crew__" }), "jam");

console.log("\n--- garbage still falls back safely, never throws ---");
eq("unknown org -> obx", bizOf({ biz: "not_a_real_org", body: "hi" }), "obx");
eq("empty biz -> obx", bizOf({ biz: "", body: "hi" }), "obx");
eq("missing biz -> obx", bizOf({ body: "hi" }), "obx");
eq("null biz -> obx", bizOf({ biz: null, body: "hi" }), "obx");
eq("non-string biz -> obx", bizOf({ biz: 42, body: "hi" }), "obx");

console.log("\n--- an empty store falls back to the legacy pair (partial-store safety) ---");
eq("obx works with an empty store", sv.ceoBuildMessage({ biz: "obx", body: "x" }, {}).biz, "obx");
eq("jam works with an empty store", sv.ceoBuildMessage({ biz: "jam", body: "x" }, {}).biz, "jam");
eq("an unknown org with an empty store -> obx", sv.ceoBuildMessage({ biz: "zzz", body: "x" }, {}).biz, "obx");

console.log("\n--- records land in the target org, and nowhere else ---");
const built = sv.ceoBuildMessage(
  { biz: "mqwvs3mq98pij", threadId: "thr_checkin_mqwvs3mq98pij", title: "Assistant",
    senderLabel: "Assistant", to: RAY, members: [RAY], body: "Afternoon check-in." }, store());
eq("biz is the personal org", built.biz, "mqwvs3mq98pij");
eq("thread id preserved", built.threadId, "thr_checkin_mqwvs3mq98pij");
const thread = built.records.find(r => r.kind === "thread");
const msg = built.records.find(r => !r.kind);
ok("a thread record was created", !!thread);
eq("the thread is a DM (participant-strict)", thread.type, "dm");
eq("members is Ray alone", JSON.stringify(thread.members), JSON.stringify([RAY]));
ok("Chase is NOT a member", thread.members.indexOf(CHASE) < 0);
eq("sender is the CEO sentinel id", msg.senderId, "__ceo__");
eq("sender label carries through", msg.senderLabel, "Assistant");

console.log("\n--- broadcast vs DM typing is unchanged ---");
const bc = sv.ceoBuildMessage({ biz: "mqwvr5d7h4a7u", to: "__crew__", body: "x" }, store());
eq("__crew__ -> broadcast", bc.records.find(r => r.kind === "thread").type, "broadcast");
const dm = sv.ceoBuildMessage({ biz: "mqwvr5d7h4a7u", to: RAY, members: [RAY], body: "x" }, store());
eq("a named recipient -> dm", dm.records.find(r => r.kind === "thread").type, "dm");

console.log("\n--- thread REUSE is per-org (same id in two orgs must not cross over) ---");
const s2 = store();
s2.obx.messages.push({ id: "thr_x", kind: "thread", threadId: "thr_x", title: "In OBX", type: "dm", members: [RAY] });
const reuse = sv.ceoBuildMessage({ biz: "mqwvs3mq98pij", threadId: "thr_x", to: RAY, members: [RAY], body: "y" }, s2);
eq("targets the personal org", reuse.biz, "mqwvs3mq98pij");
ok("creates its OWN thread record (does not adopt the OBX one)", !!reuse.records.find(r => r.kind === "thread"));
const reuseSame = sv.ceoBuildMessage({ biz: "obx", threadId: "thr_x", to: RAY, members: [RAY], body: "y" }, s2);
ok("reuses the existing thread inside the SAME org (no duplicate header)",
  !reuseSame.records.find(r => r.kind === "thread"));

console.log("\n--- the propose route got the same fix ---");
if (typeof sv.ceoBuildProposal === "function") {
  const pr = sv.ceoBuildProposal({ biz: "mqwvs3mq98pij", type: "create", collection: "todos", record: { id: "t1", title: "x" } }, store());
  ok("proposal targets the personal org", pr.biz === "mqwvs3mq98pij" || pr.ok === false, JSON.stringify(pr).slice(0, 120));
} else {
  ok("ceoBuildProposal not exported — source-checked instead",
    /orgIdsOf\(store\)\.indexOf\(p\.biz\)/.test(require("fs").readFileSync(__dirname + "/sync-server.js", "utf8")));
}
const src = require("fs").readFileSync(__dirname + "/sync-server.js", "utf8");
eq("no bare BIZES-only coercion left", (src.match(/const biz = \(BIZES\.indexOf\(p\.biz\) >= 0\)/g) || []).length, 0);
eq("both builders use the org-aware resolver", (src.match(/orgIdsOf\(store\)\.indexOf\(p\.biz\) >= 0/g) || []).length, 2);

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
