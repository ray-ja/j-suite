/* crossorg-tests.js — projects across orgs (js/189). Pure node. */
const X = require("./js/189-crossorg.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
const store = {
  stone: { quotes: [] },
  jam: { quotes: [{ id: "qf", num: 5, cust: "Christina Jamieson", total: 6544, updatedAt: 5 }, { id: "q1", num: 1, cust: "OB-Xscape Rooms", total: 1186.35, updatedAt: 9 }, { id: "qd", num: 2, cust: "Christina Jamieson", deleted: true }] },
  obx: { quotes: [{ id: "q40", num: 40, cust: "Mike Renken", total: 175, updatedAt: 7 }] }
};
const c = X.xqCandidates(store, ["stone", "jam", "obx"], "stone", "Christina Jamieson");
eq(c.map(x => x.org + ":" + x.id), ["jam:qf", "jam:q1", "obx:q40"], "same-customer quote first, then the rest newest first; deleted and current-org quotes excluded");
eq(c[0].match, true, "the customer match is flagged");
eq(X.xqCandidates(store, ["stone", "jam", "obx"], "stone", "").map(x => x.id), ["q1", "q40", "qf"], "no customer → newest first");
eq(X.xqCandidates(store, ["stone"], "stone", "x"), [], "only the current org → nothing to link");
eq(X.xqCandidates(store, ["stone", "jam", "obx"], "stone", "christina", 1).length, 1, "limit respected");
eq(X.xqState({ paid: true, invoiced: true }), "paid", "state: paid wins");
eq(X.xqState({ invoiced: true }), "invoiced", "state: invoiced");
eq(X.xqState({ depositLink: "x" }), "deposit link out", "state: deposit link out");
eq(X.xqState({ accepted: true }), "accepted", "state: accepted");
eq(X.xqState({}), "quote", "state: plain quote");
eq(X.orgLastResolve({ tab: "finance", job: null }, t => true), { tab: "finance", job: null }, "saved tab restored");
eq(X.orgLastResolve({ tab: "escape", job: "j1" }, t => t !== "escape"), { tab: "today", job: null }, "a tab the new org cannot see → Today, and the job is dropped");
eq(X.orgLastResolve(null, t => true), { tab: "today", job: null }, "nothing saved → Today");
eq(X.orgLastResolve({ tab: "schedule", job: "j9" }, t => true), { tab: "schedule", job: "j9" }, "a job page comes back with its tab");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
