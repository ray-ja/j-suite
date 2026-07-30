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

console.log("\n--- ORG DISTINCTNESS SWEEP: no code path may cover only obx/jam ---");
const S2 = require("fs").readFileSync(__dirname + "/sync-server.js", "utf8");

/* ceoProjection: any REAL org must be requestable, and "all" must mean ALL real orgs */
function projStore() {
  const st = store();
  ["obx", "jam", "mqwvr5d7h4a7u", "mqwvs3mq98pij"].forEach(o => {
    st[o].customers = []; st[o].quotes = []; st[o].jobs = []; st[o].expenses = [];
  });
  return st;
}
if (typeof sv.ceoProjection === "function") {
  const one = sv.ceoProjection(projStore(), { biz: "mqwvs3mq98pij", view: "all" });
  ok("a newer org can be requested without falling back to 'all'", !!one, JSON.stringify(one).slice(0, 80));
}
ok("ceoProjection no longer validates against BIZES only", !/BIZES\.indexOf\(opts\.biz\)/.test(S2));
ok("ceoProjection resolves against the real org list", /_allOrgs = orgIdsOf\(store\)/.test(S2));

/* jobsForUser must reach a job in ANY org the person is crewed on */
if (typeof sv.jobsForUser === "function") {
  const st = projStore();
  const soon = new Date(Date.now() + 2 * 86400000);
  const d = soon.getFullYear() + "-" + String(soon.getMonth() + 1).padStart(2, "0") + "-" + String(soon.getDate()).padStart(2, "0");
  st.obx.jobs = [{ id: "j_obx", date: d, crew: [RAY], title: "OBX job" }];
  st.mqwvr5d7h4a7u.jobs = [{ id: "j_esc", date: d, crew: [RAY], title: "Escape room job" }];
  st.mqwvs3mq98pij.jobs = [{ id: "j_per", date: d, crew: [RAY], title: "Personal job" }];
  const got = sv.jobsForUser(st, RAY, new Date());
  const orgs = got.map(x => x.biz).sort();
  eq("reaches jobs in all three orgs", orgs.length, 3);
  ok("includes the escape-room org", orgs.indexOf("mqwvr5d7h4a7u") >= 0, JSON.stringify(orgs));
  ok("includes the personal org", orgs.indexOf("mqwvs3mq98pij") >= 0, JSON.stringify(orgs));
  ok("someone NOT on the crew gets nothing", sv.jobsForUser(st, CHASE, new Date()).length === 0);
} else {
  ok("jobsForUser iterates the real org list (source-checked)", /for \(const biz of \(orgIdsOf\(store\)/.test(S2));
}

/* the sync push path */
ok("push dedupe is built over every real org", /orgIdsOf\(pre\)\.forEach\(b => \{ hadMsg\[b\]/.test(S2));
ok("the push loop iterates the caller's orgs, not BIZES", /\(myOrgs \|\| \[\]\)\.forEach\(b =>/.test(S2));
ok("no BIZES.forEach left in the push path", !/BIZES\.forEach\(b => \(\(\(incoming/.test(S2));

/* Every remaining BIZES use must be a deliberate empty-store fallback, never the sole source of
   truth. Strip comments first — prose mentioning BIZES is fine, CODE using it alone is not. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))   // block comments -> blanks, keep line numbers
            .replace(/^([^"'`\n]*?)\/\/.*$/gm, "$1");                        // line comments (crude but fine here)
}
const codeOnly = stripComments(S2).split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /BIZES/.test(l));
const offenders = codeOnly.filter(([, l]) =>
  !/^const BIZES =/.test(l.trim())
  && !/orgIdsOf\(store\)\.indexOf\(p\.biz\) >= 0 \|\| BIZES/.test(l)
  && !/orgIdsOf\(store\)\.length \? orgIdsOf\(store\) : BIZES/.test(l));
ok("every surviving BIZES use in CODE is an empty-store fallback, not the primary source",
  offenders.length === 0, offenders.map(([n, l]) => "line " + n + ": " + l.trim().slice(0, 70)).join(" | "));
eq("BIZES appears in code exactly 5 times (1 declaration + 4 empty-store fallbacks)", codeOnly.length, 5);

/* the admin PIN unlock (js/32) must be org-scoped too — same class of bug */
const A = require("fs").readFileSync(__dirname + "/js/32-admin.js", "utf8");
ok("admin PIN unlock key includes the org", /adminPinKey\(me\) \{ return .*S\.biz/.test(A));

console.log("\n--- public customer-facing pages must never wear another org's brand ---");
if (typeof sv.pubBizOf === "function") {
  const st = store();
  st.registry = [{ id: "mqwvr5d7h4a7u", name: "OB-Xscape Rooms" }, { id: "mqwvs3mq98pij", name: "RBJVL" }];
  eq("obx keeps its real branding", sv.pubBizOf(st, "obx").name, "OBX Lot Solutions");
  eq("obx keeps its phone", sv.pubBizOf(st, "obx").phone, "(252) 207-5985");
  eq("escape room uses ITS registry name", sv.pubBizOf(st, "mqwvr5d7h4a7u").name, "OB-Xscape Rooms");
  eq("and NOT OBX's phone", sv.pubBizOf(st, "mqwvr5d7h4a7u").phone, "");
  eq("personal org uses its registry name", sv.pubBizOf(st, "mqwvs3mq98pij").name, "RBJVL");
  eq("unknown org degrades to its id, not to OBX", sv.pubBizOf(st, "zzz").name, "zzz");
  ok("never leaks OBX's name to another org", sv.pubBizOf(st, "mqwvr5d7h4a7u").name !== "OBX Lot Solutions");
}
ok("no call site defaults branding to OBX any more",
  !/name: "OBX Lot Solutions", phone: "\(252\) 207-5985" \}, \(typeof INV_BIZ/.test(S2));
eq("all three public pages use the resolver (+1 = the definition)", (S2.match(/pubBizOf\(store, org\)/g) || []).length, 4);

console.log("\n--- the audit trail + Cap's receipt reader must cover every org ---");
ok("auditDiff iterates the incoming orgs", /orgIdsOf\(incoming\)\.forEach\(b =>/.test(S2));
ok("auditDiff no longer hardcodes obx/jam", !/const now = Date\.now\(\), entries = \[\];\s*\n\s*\["obx", "jam"\]/.test(S2));
ok("the receipts view scans every real org", /const receipts = \[\], _bz = orgIdsOf\(store\);/.test(S2));

console.log("\n--- the two DELIBERATE obx/jam uses must survive (they are correct) ---");
ok("legacy membership synthesis still seeds obx/jam only (a pre-multi-org migration)",
  /\["obx", "jam"\]\.forEach\(oid => \{ if \(s\[oid\]\) s\.users\.push/.test(S2));
ok("the legacy shared token stays limited to obx/jam (new orgs stay isolated from it)",
  /orgsForUser\(pre, me\) : \["obx", "jam"\]\.filter\(o => pre\[o\]\)/.test(S2));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
