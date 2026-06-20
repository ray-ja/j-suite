/* Data-layer migration + auth fixture test (touches accounts/sync).
 * Exercises the server's record-merge "migration" and the new /login verification with fixtures.
 * Run: node "sync-server-tests.js"  →  expect: all passed, 0 failed.
 * Requiring sync-server.js does NOT open a port (listen is guarded by require.main). */
const t = require("./sync-server");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + "  got " + JSON.stringify(got)); } }

console.log("\n— data-layer migration (mergeState) —");
// legacy fixture: old biz shape (customers only, missing collections), and NO users key at all
const stored = { obx: { customers: [{ id: "c1", name: "Old", updatedAt: 10 }] } };
const incoming = {
  obx: { customers: [{ id: "c1", name: "New", updatedAt: 20 }, { id: "c2", name: "Added", updatedAt: 5 }], quotes: [{ id: "q1", updatedAt: 1 }] },
  users: [{ id: "u1", username: "ray", passhash: t.hashPw("pw"), updatedAt: 3 }]
};
const m = t.mergeState(stored, incoming);
ok("all collections present on obx", ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "changelog", "locks", "timeclock"].every(k => Array.isArray(m.obx[k])), Object.keys(m.obx));
ok("jam business scaffolded", m.jam && Array.isArray(m.jam.customers), m.jam);
ok("users array migrated in", Array.isArray(m.users) && m.users.length === 1, m.users);
ok("LWW: newer customer record wins", (m.obx.customers.find(x => x.id === "c1") || {}).name === "New", m.obx.customers);
ok("merge brings in new record", !!m.obx.customers.find(x => x.id === "c2"), m.obx.customers);
ok("incoming-only collection merged", m.obx.quotes.length === 1, m.obx.quotes);

console.log("— changelog (activity log) syncs per business, append-union —");
const cl = t.mergeState(
  { obx: { changelog: [{ id: "e1", ts: 10, action: "create", entity: "customer", entityId: "c1", user: "u1", summary: "Logged Smith", updatedAt: 10 }] } },
  { obx: { changelog: [{ id: "e2", ts: 20, action: "create", entity: "quote", entityId: "q1", user: "u2", summary: "Quoted $400", updatedAt: 20 }] } }
);
ok("changelog present on obx", Array.isArray(cl.obx.changelog), cl.obx);
ok("entries from both devices merge (append-union)", cl.obx.changelog.length === 2 && cl.obx.changelog.some(e => e.id === "e1") && cl.obx.changelog.some(e => e.id === "e2"), cl.obx.changelog.map(e => e.id));
ok("attribution fields preserved", (cl.obx.changelog.find(e => e.id === "e1") || {}).user === "u1", cl.obx.changelog);

console.log("— per-user settings survive the merge —");
const s2 = t.mergeState(
  { users: [{ id: "u1", username: "ray", passhash: "x", settings: { theme: "light" }, updatedAt: 1 }] },
  { users: [{ id: "u1", username: "ray", passhash: "x", settings: { theme: "dark" }, updatedAt: 2 }] }
);
ok("newer per-user settings win (theme=dark)", (s2.users[0].settings || {}).theme === "dark", s2.users[0]);
ok("older settings preserved when nothing newer", t.mergeState({ users: [{ id: "u9", username: "a", settings: { theme: "dark" }, updatedAt: 5 }] }, {}).users[0].settings.theme === "dark", null);

console.log("— admin: roles + access-map ride the account merge —");
const ad = t.mergeState(
  { users: [
    { id: "u1", username: "ray", passhash: "x", role: "owner", updatedAt: 5 },
    { id: "__roles__", kind: "roles", roles: [{ key: "crew", pages: ["today"] }], updatedAt: 5 }
  ] },
  { users: [
    { id: "u1", username: "ray", passhash: "x", role: "admin", updatedAt: 9 },               // role change, newer
    { id: "__roles__", kind: "roles", roles: [{ key: "crew", pages: ["today", "quotes"] }], updatedAt: 9 }
  ] }
);
ok("role field LWW-merges on the account (admin wins)", (ad.users.find(u => u.id === "u1") || {}).role === "admin", ad.users);
const rolesRec = ad.users.find(u => u.id === "__roles__");
ok("roles config record survives merge as a synced record", rolesRec && rolesRec.kind === "roles", rolesRec);
ok("newer access-map wins (crew gains quotes)", rolesRec && (rolesRec.roles[0].pages || []).indexOf("quotes") >= 0, rolesRec);

console.log("— scheduling: crew on jobs + member availability ride the merge (per-record LWW) —");
const sc = t.mergeState(
  { obx: { jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", crew: ["u1"], updatedAt: 5 }] },
    users: [{ id: "u1", username: "ray", avail: { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00" }, updatedAt: 5 }] },
  { obx: { jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", crew: ["u1", "u2"], updatedAt: 9 }] },
    users: [{ id: "u1", username: "ray", avail: { days: [false, true, true, true, true, true, false] }, timeoff: [{ id: "b1", start: "2026-06-12", end: "2026-06-14", note: "PTO" }], updatedAt: 9 }] }
);
ok("job crew LWW-merges (newer assignment wins)", ((sc.obx.jobs.find(j => j.id === "j1") || {}).crew || []).length === 2, sc.obx.jobs);
ok("member weekly availability persists on the account", !!(sc.users.find(u => u.id === "u1") || {}).avail, sc.users);
ok("time-off blocks ride the account record", (((sc.users.find(u => u.id === "u1") || {}).timeoff) || []).length === 1, sc.users);

console.log("— scheduler: per-day availability overrides ride the account merge (LWW), no field loss —");
const ovr = t.mergeState(
  { users: [{ id: "u1", username: "ray", role: "owner",
      avail: { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00", overrides: { "2026-06-20": "off" } },
      timeoff: [{ id: "b1", start: "2026-07-01", end: "2026-07-03", note: "PTO" }], updatedAt: 5 }] },
  { users: [{ id: "u1", username: "ray", role: "owner",
      avail: { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00", overrides: { "2026-06-20": "full", "2026-06-21": "partial" } },
      timeoff: [{ id: "b1", start: "2026-07-01", end: "2026-07-03", note: "PTO" }], updatedAt: 9 }] }
);
const ou = ovr.users.find(u => u.id === "u1") || {};
ok("per-day overrides ride the account record", !!(ou.avail && ou.avail.overrides), ou.avail);
ok("newer overrides win, multi-day (20=full, 21=partial)", ou.avail.overrides["2026-06-20"] === "full" && ou.avail.overrides["2026-06-21"] === "partial", ou.avail.overrides);
ok("baseline weekday pattern + hours preserved alongside overrides", Array.isArray(ou.avail.days) && ou.avail.start === "08:00", ou.avail);
ok("time-off + role survive the overrides merge (no field loss)", (ou.timeoff || []).length === 1 && ou.role === "owner", ou);
const ovrBc = t.mergeState(
  { users: [{ id: "u2", username: "old", avail: { days: [true, true, true, true, true, true, true], start: "09:00", end: "17:00" }, updatedAt: 5 }] },
  {}
);
ok("legacy account without overrides survives untouched (backward compatible)",
  (() => { const u = ovrBc.users.find(x => x.id === "u2") || {}; return u.avail && !u.avail.overrides && u.avail.start === "09:00"; })(), ovrBc.users);

console.log("— quote → job conversion: the link survives the merge (per-record LWW) —");
const qj = t.mergeState(
  { obx: { quotes: [{ id: "q1", cust: "Acme", total: 400, accepted: false, updatedAt: 5 }],
           jobs: [] } },
  { obx: { quotes: [{ id: "q1", cust: "Acme", total: 400, accepted: true, jobId: "j1", acceptedDate: "2026-06-10", updatedAt: 9 }],
           jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", time: "09:00", customerId: "c1", address: "1 Main", crew: ["u1"], quoteId: "q1", updatedAt: 9 }] } }
);
const mq = qj.obx.quotes.find(x => x.id === "q1") || {}, mj = qj.obx.jobs.find(x => x.id === "j1") || {};
ok("accepted quote keeps its jobId link (newer wins)", mq.accepted === true && mq.jobId === "j1", mq);
ok("scheduled job links back to the quote + carries crew/date", mj.quoteId === "q1" && mj.date === "2026-06-10" && (mj.crew || []).length === 1, mj);

console.log("— equipment ↔ job: required-equipment links survive the merge (per-record LWW) —");
// equipment lives ON the job record (job.equipment = [{itemId,qty}]), so it rides the same
// per-record LWW as crew/quoteId with zero merge-layer changes. The inventory master co-merges.
const eq = t.mergeState(
  { obx: { jobs: [{ id: "j1", title: "Clear-out", date: "2026-06-10", equipment: [{ itemId: "inv-hand-truck-dolly", qty: 1 }], updatedAt: 5 }],
           inventory: [{ id: "inv-hand-truck-dolly", name: "Hand truck / dolly", have: true, qty: "2", updatedAt: 5 }] } },
  { obx: { jobs: [{ id: "j1", title: "Clear-out", date: "2026-06-10", equipment: [{ itemId: "inv-hand-truck-dolly", qty: 2 }], updatedAt: 9 }],
           inventory: [{ id: "inv-hand-truck-dolly", name: "Hand truck / dolly", have: true, qty: "2", updatedAt: 9 }] } }
);
const ej = eq.obx.jobs.find(j => j.id === "j1") || {};
ok("job keeps its required-equipment link after merge", Array.isArray(ej.equipment) && ej.equipment.length === 1 && (ej.equipment[0] || {}).itemId === "inv-hand-truck-dolly", ej);
ok("equipment qty LWW-merges (newer attach wins: 2)", (ej.equipment[0] || {}).qty === 2, ej.equipment);
ok("inventory master item co-merges (owned qty preserved)", (eq.obx.inventory.find(i => i.id === "inv-hand-truck-dolly") || {}).qty === "2", eq.obx.inventory);
const eqDetach = t.mergeState(
  { obx: { jobs: [{ id: "j2", title: "Wash", date: "2026-06-11", equipment: [{ itemId: "inv-pressure-washer-gas-4-gpm", qty: 1 }], updatedAt: 5 }] } },
  { obx: { jobs: [{ id: "j2", title: "Wash", date: "2026-06-11", equipment: [], updatedAt: 9 }] } }   // owner detached the gear later
);
ok("detaching equipment LWW-merges (newer empty list wins)", ((eqDetach.obx.jobs.find(j => j.id === "j2") || {}).equipment || ["x"]).length === 0, eqDetach.obx.jobs);

console.log("— in-use soft locks: ride the sync as a per-business collection, LWW, release tombstone —");
const lk = t.mergeState(
  { obx: { locks: [{ id: "lk_quote_q1", entity: "quote", recId: "q1", userId: "u1", name: "Ray", initials: "RA", ts: 100, updatedAt: 100 }] } },
  { obx: { locks: [{ id: "lk_quote_q1", entity: "quote", recId: "q1", userId: "u2", name: "Pierce", initials: "PI", ts: 200, updatedAt: 200 }] },   // take-over: newer heartbeat wins
    jam: { locks: [{ id: "lk_job_j9", entity: "job", recId: "j9", userId: "u3", ts: 50, updatedAt: 50 }] } }
);
ok("locks collection scaffolded on both businesses", Array.isArray(lk.obx.locks) && Array.isArray(lk.jam.locks), { obx: lk.obx.locks, jam: lk.jam.locks });
ok("lock LWW-merges (newer take-over heartbeat wins)", (lk.obx.locks.find(l => l.id === "lk_quote_q1") || {}).userId === "u2", lk.obx.locks);
ok("locks are per-business (jam lock kept separate)", lk.jam.locks.length === 1 && lk.jam.locks[0].recId === "j9", lk.jam.locks);
const lkRel = t.mergeState(
  { obx: { locks: [{ id: "lk_quote_q1", userId: "u1", ts: 100, updatedAt: 100 }] } },
  { obx: { locks: [{ id: "lk_quote_q1", userId: "u1", ts: 0, deleted: true, updatedAt: 300 }] } }   // release on save/close
);
ok("released lock tombstone propagates (record freed)", (lkRel.obx.locks.find(l => l.id === "lk_quote_q1") || {}).deleted === true, lkRel.obx.locks);

console.log("— time clock + GPS mileage: per-business collection, LWW, delete tombstone —");
const tc = t.mergeState(
  { obx: { timeclock: [
    { id: "t1", jobId: "j1", userId: "u1", userName: "Ray", clockIn: 1000, clockOut: 4600000, computedMiles: 12.3, miles: 12.3, milesConfirmed: false, vehicle: "Ray's truck", rate: 0.725, updatedAt: 100 },
    { id: "t2", jobId: "j1", userId: "u2", userName: "Pierce", clockIn: 1000, clockOut: null, computedMiles: 2, vehicle: "", updatedAt: 100 }   // still open
  ] } },
  { obx: { timeclock: [
    { id: "t1", jobId: "j1", userId: "u1", userName: "Ray", clockIn: 1000, clockOut: 4600000, computedMiles: 12.3, miles: 9, milesConfirmed: true, vehicle: "Ray's truck", rate: 0.725, updatedAt: 200 }   // owner confirmed/adjusted miles, newer
  ] },
    jam: { timeclock: [{ id: "t9", jobId: "j9", userId: "u3", clockIn: 5, clockOut: 10, miles: 1, updatedAt: 5 }] } }
);
ok("timeclock collection scaffolded on both businesses", Array.isArray(tc.obx.timeclock) && Array.isArray(tc.jam.timeclock), { obx: tc.obx.timeclock, jam: tc.jam.timeclock });
ok("owner-confirmed mileage LWW-wins (9 mi, confirmed)", (() => { const e = tc.obx.timeclock.find(x => x.id === "t1") || {}; return e.miles === 9 && e.milesConfirmed === true; })(), tc.obx.timeclock.find(x => x.id === "t1"));
ok("open shift on the other device merges in untouched", (tc.obx.timeclock.find(x => x.id === "t2") || {}).clockOut === null, tc.obx.timeclock);
ok("attribution (user + vehicle) preserved", (tc.obx.timeclock.find(x => x.id === "t1") || {}).userName === "Ray" && (tc.obx.timeclock.find(x => x.id === "t1") || {}).vehicle === "Ray's truck", tc.obx.timeclock);
ok("timeclock is per-business (jam entry kept separate)", tc.jam.timeclock.length === 1 && tc.jam.timeclock[0].jobId === "j9", tc.jam.timeclock);
const tcDel = t.mergeState(
  { obx: { timeclock: [{ id: "t1", jobId: "j1", userId: "u1", miles: 9, updatedAt: 100 }] } },
  { obx: { timeclock: [{ id: "t1", jobId: "j1", userId: "u1", deleted: true, updatedAt: 300 }] } }
);
ok("deleted time entry tombstone propagates", (tcDel.obx.timeclock.find(x => x.id === "t1") || {}).deleted === true, tcDel.obx.timeclock);

console.log("— finance: income + expenses per-business collections, LWW, delete tombstone —");
const fin = t.mergeState(
  { obx: {
      income: [{ id: "in1", jobId: "j1", quoteId: "q1", invoice: "1001", amount: 400, date: "2026-06-10", crew: ["u1"], originator: "u2", bookedAt: "2026-06-01", houseAccount: false, updatedAt: 5 }],
      expenses: [{ id: "ex1", date: "2026-06-09", category: "disposal", amount: 73.16, note: "C&D 1 ton", updatedAt: 5 }] } },
  { obx: {
      income: [{ id: "in1", jobId: "j1", quoteId: "q1", invoice: "1001", amount: 450, date: "2026-06-10", crew: ["u1", "u3"], originator: "u2", bookedAt: "2026-06-01", houseAccount: false, updatedAt: 9 }],  // owner corrected the amount/crew, newer
      expenses: [{ id: "ex2", date: "2026-06-11", category: "rentals", amount: 120, note: "trailer day", updatedAt: 9 }] },
    jam: { income: [{ id: "in9", jobId: "j9", amount: 1000, date: "2026-06-12", crew: ["u3"], updatedAt: 5 }] } }
);
ok("income + expenses scaffolded on both businesses", ["income", "expenses"].every(k => Array.isArray(fin.obx[k]) && Array.isArray(fin.jam[k])), { obx: Object.keys(fin.obx) });
ok("income LWW-merges (owner's corrected amount/crew wins)", (() => { const e = fin.obx.income.find(x => x.id === "in1") || {}; return e.amount === 450 && (e.crew || []).length === 2; })(), fin.obx.income.find(x => x.id === "in1"));
ok("income keeps its links (job / quote / invoice / originator)", (() => { const e = fin.obx.income.find(x => x.id === "in1") || {}; return e.jobId === "j1" && e.quoteId === "q1" && e.invoice === "1001" && e.originator === "u2"; })(), fin.obx.income.find(x => x.id === "in1"));
ok("expenses from both devices union-merge with categories", fin.obx.expenses.length === 2 && fin.obx.expenses.some(e => e.category === "disposal") && fin.obx.expenses.some(e => e.category === "rentals"), fin.obx.expenses.map(e => e.category));
ok("finance collections are per-business (jam income kept separate)", fin.jam.income.length === 1 && fin.jam.income[0].jobId === "j9", fin.jam.income);
const finDel = t.mergeState(
  { obx: { income: [{ id: "in1", amount: 400, date: "2026-06-10", updatedAt: 100 }], expenses: [{ id: "ex1", amount: 50, updatedAt: 100 }] } },
  { obx: { income: [{ id: "in1", deleted: true, updatedAt: 300 }], expenses: [{ id: "ex1", deleted: true, updatedAt: 300 }] } }
);
ok("deleted income + expense tombstones propagate", (finDel.obx.income.find(x => x.id === "in1") || {}).deleted === true && (finDel.obx.expenses.find(x => x.id === "ex1") || {}).deleted === true, finDel.obx);

console.log("— auth: /login verification —");
const store = {
  users: [
    { id: "u1", username: "Ray", passhash: t.hashPw("hunter2"), role: "owner", updatedAt: 1 },
    { id: "u2", username: "gone", passhash: t.hashPw("x"), deleted: true, updatedAt: 1 },
    { id: "u3", username: "benched", passhash: t.hashPw("x"), active: false, updatedAt: 1 },
    { id: "__roles__", kind: "roles", roles: [], updatedAt: 1 }
  ]
};
ok("correct password verifies (case-insensitive username)", (t.verifyLogin(store, "ray", "hunter2") || {}).id === "u1", null);
ok("UPPERCASE username verifies (case-insensitive)", (t.verifyLogin(store, "RAY", "hunter2") || {}).id === "u1", null);
ok("whitespace-padded username verifies (trim, no lockout)", (t.verifyLogin(store, "  Ray  ", "hunter2") || {}).id === "u1", null);
ok("wrong password rejected", t.verifyLogin(store, "ray", "nope") === null, null);
ok("unknown user rejected", t.verifyLogin(store, "nobody", "x") === null, null);
ok("soft-deleted account rejected", t.verifyLogin(store, "gone", "x") === null, null);
ok("deactivated account rejected (active:false)", t.verifyLogin(store, "benched", "x") === null, null);
ok("roles config record is not a loginable account", t.accountByName(store, "__roles__") === null && t.verifyLogin(store, "", "") === null, null);
ok("djb2 fallback hash (file://-created account) also verifies",
  !!t.verifyLogin({ users: [{ id: "u3", username: "leg", passhash: t.hashPwFallback("legacy"), updatedAt: 1 }] }, "leg", "legacy"), null);
ok("empty store rejects (bootstrap: no accounts yet)", t.verifyLogin({ users: [] }, "ray", "hunter2") === null, null);

console.log("— Access SSO: email->account mapping + account.email rides the merge (zero loss) —");
const ssoStore = { users: [
  { id: "u1", username: "Ray", email: "ray@obxlotsolutions.com", role: "owner", passhash: t.hashPw("x"), updatedAt: 1 },
  { id: "u2", username: "Pierce", email: "PIERCE@obxlotsolutions.com", role: "crew", passhash: t.hashPw("x"), updatedAt: 1 },
  { id: "u3", username: "gone", email: "gone@x.com", deleted: true, updatedAt: 1 },
  { id: "u4", username: "off", email: "off@x.com", active: false, updatedAt: 1 },
  { id: "__roles__", kind: "roles", roles: [], updatedAt: 1 }
] };
ok("accountByEmail matches (case-insensitive)", (t.accountByEmail(ssoStore, "ray@obxlotsolutions.com") || {}).id === "u1" && (t.accountByEmail(ssoStore, "pierce@obxlotsolutions.com") || {}).id === "u2", null);
ok("accountByEmail skips deleted/deactivated/roles + unknown -> null", t.accountByEmail(ssoStore, "gone@x.com") === null && t.accountByEmail(ssoStore, "off@x.com") === null && t.accountByEmail(ssoStore, "nobody@x.com") === null && t.accountByEmail(ssoStore, "") === null, null);
const emMerge = t.mergeState({ users: [{ id: "u1", username: "Ray", role: "owner", passhash: "x", updatedAt: 1 }] }, { users: [{ id: "u1", username: "Ray", role: "owner", passhash: "x", email: "ray@obxlotsolutions.com", updatedAt: 2 }] });
ok("account.email LWW-merges onto the account (newer wins, no field loss)", (() => { const u = emMerge.users.find(x => x.id === "u1") || {}; return u.email === "ray@obxlotsolutions.com" && u.role === "owner" && !!u.passhash; })(), emMerge.users[0]);
ok("legacy account WITHOUT email round-trips zero-loss (backward compatible)", (() => { const m = t.mergeState({ users: [{ id: "u9", username: "a", passhash: "x", updatedAt: 5 }] }, {}); const u = m.users.find(x => x.id === "u9") || {}; return u.username === "a" && !("email" in u); })(), null);

console.log("— calendar feed: per-user .ics of upcoming assigned jobs —");
const fixed = new Date("2026-06-08T12:00:00Z");   // "now" for deterministic upcoming/past filtering
const calStore = {
  obx: {
    customers: [{ id: "c1", name: "Seaside Mgmt", address: "100 Ocean Blvd, Corolla NC" }],
    properties: [{ id: "p1", address: "55 Duck Rd, Duck NC", customerIds: ["c1"] }],
    jobs: [
      { id: "j1", title: "Soft wash, house", customerId: "c1", date: "2026-06-10", time: "09:00", crew: ["u1"], notes: "Gate code 1234; back deck", updatedAt: 5 },
      { id: "j2", title: "House-watch check", customerId: "c1", propertyId: "p1", date: "2026-06-12", crew: ["u1", "u2"], updatedAt: 5 }, // all-day (no time)
      { id: "j3", title: "Old job", date: "2026-06-01", crew: ["u1"], updatedAt: 5 },          // past → excluded
      { id: "j4", title: "Done job", date: "2026-06-20", crew: ["u1"], done: true, updatedAt: 5 }, // done → excluded
      { id: "j5", title: "Someone else's", date: "2026-06-15", crew: ["u2"], updatedAt: 5 },    // not assigned to u1 → excluded
      { id: "j6", title: "Deleted job", date: "2026-06-18", crew: ["u1"], deleted: true, updatedAt: 5 } // deleted → excluded
    ]
  },
  jam: { jobs: [{ id: "j7", title: "Starlink install; mount, run cable", customerId: "cz", date: "2026-06-14", time: "13:30", crew: ["u1"], updatedAt: 5 }] },
  users: [
    { id: "u1", username: "Pierce", calToken: "tok_pierce_unguessable", updatedAt: 5 },
    { id: "u2", username: "Chase", updatedAt: 5 },
    { id: "z9", username: "ghost", deleted: true, calToken: "tok_ghost", updatedAt: 5 }
  ]
};
ok("token resolves to the right account", (t.userByCalToken(calStore, "tok_pierce_unguessable") || {}).id === "u1", null);
ok("unknown token resolves to nobody", t.userByCalToken(calStore, "nope") === null, null);
ok("empty token resolves to nobody", t.userByCalToken(calStore, "") === null, null);
ok("a deleted account's token is not honored", t.userByCalToken(calStore, "tok_ghost") === null, null);
const feed = t.jobsForUser(calStore, "u1", fixed);
ok("feed includes only upcoming, assigned, non-done, non-deleted jobs (both businesses)",
  feed.length === 3 && feed.map(x => x.job.id).join(",") === "j1,j2,j7", feed.map(x => x.job.id));
const ics = t.buildIcs(calStore, calStore.users[0], fixed);
ok("ics is a well-formed VCALENDAR envelope", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.trimEnd().endsWith("END:VCALENDAR"), ics.slice(0, 40));
ok("every VEVENT is balanced (3 events)", (ics.match(/BEGIN:VEVENT/g) || []).length === 3 && (ics.match(/END:VEVENT/g) || []).length === 3, null);
ok("timed job → floating DTSTART/DTEND with a 2h block", ics.indexOf("DTSTART:20260610T090000") >= 0 && ics.indexOf("DTEND:20260610T110000") >= 0, null);
ok("untimed job → all-day VALUE=DATE spanning one day", ics.indexOf("DTSTART;VALUE=DATE:20260612") >= 0 && ics.indexOf("DTEND;VALUE=DATE:20260613") >= 0, null);
ok("each event carries both reminders (1 day + 1 hour before)", (ics.match(/TRIGGER:-P1D/g) || []).length === 3 && (ics.match(/TRIGGER:-PT1H/g) || []).length === 3, null);
ok("event summary carries title + customer", ics.indexOf("SUMMARY:Soft wash\\, house — Seaside Mgmt") >= 0, null);
ok("text escaping applied (semicolons/commas in notes & title)", ics.indexOf("Gate code 1234\\; back deck") >= 0 && ics.indexOf("Starlink install\\; mount\\, run cable") >= 0, null);
ok("location resolves: job→customer address, and property when set", ics.indexOf("LOCATION:100 Ocean Blvd\\, Corolla NC") >= 0 && ics.indexOf("LOCATION:55 Duck Rd\\, Duck NC") >= 0, null);
const icsUnfolded = ics.replace(/\r\n /g, "");   // RFC 5545: undo line folding before content checks
ok("crew names listed in description", icsUnfolded.indexOf("Crew: Pierce\\, Chase") >= 0, null);
ok("no CRLF-folded line exceeds 75 octets", ics.split("\r\n").every(l => l.length <= 75), ics.split("\r\n").filter(l => l.length > 75));
ok("calToken rides the account merge (LWW) like other account fields",
  (t.mergeState({ users: [{ id: "u1", username: "p", updatedAt: 1 }] }, { users: [{ id: "u1", username: "p", calToken: "tok9", updatedAt: 2 }] }).users[0] || {}).calToken === "tok9", null);

console.log("— rate limit —");
let blocked = false;
for (let i = 0; i < 40; i++) { if (!t.rateCheck("1.2.3.4").ok) blocked = true; }
ok("excess attempts get blocked (429)", blocked, null);
ok("a fresh IP is not blocked", t.rateCheck("9.9.9.9").ok === true, null);

console.log("— realistic pre-scheduler data.json: full load + sync round-trip, ZERO loss (CLAUDE.md migration fixture) —");
// Load a realistic pre-change store (accounts with legacy u.avail {days,start,end} + timeoff, NO overrides).
// Stand in real password hashes (the committed fixture carries placeholders, never secrets).
const fx = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "fixtures", "data-pre-scheduler.json"), "utf8"));
delete fx._note;
fx.users.forEach(u => { if (u.passhash && /_PLACEHOLDER$/.test(u.passhash)) u.passhash = t.hashPw("pw-" + u.id); });
// inventory of every record id we must never lose, by business+collection and the top-level accounts
const census = s => {
  const c = {};
  for (const biz of ["obx", "jam"]) for (const k of Object.keys(s[biz] || {})) c[biz + "." + k] = (s[biz][k] || []).map(r => r.id).sort();
  c["users"] = (s.users || []).map(r => r.id).sort();
  return c;
};
const before = census(fx);
const sameIds = (a, b) => Object.keys(a).every(k => b[k] && a[k].length === b[k].length && a[k].every((id, i) => id === b[k][i]));

// (1) PULL round-trip — a fresh device pulls the whole store (server merges stored over empty incoming): every record survives.
const pulled = t.mergeState(fx, {});
ok("pull round-trip preserves every customer/property/quote/job/account (zero loss)", sameIds(before, census(pulled)), { before, after: census(pulled) });
ok("legacy accounts arrive with avail but no overrides (backward compatible)",
  (() => { const u = pulled.users.find(x => x.id === "u1") || {}; return u.avail && u.avail.start === "08:00" && !u.avail.overrides; })(), (pulled.users.find(x => x.id === "u1") || {}).avail);
ok("the __roles__ config record survives the load", !!(pulled.users.find(x => x.id === "__roles__") || {}).kind, pulled.users.map(u => u.id));

// (3) A device adds per-day overrides to one account + books a new job, then PUSHES. All prior records survive; overrides persist.
const devicePush = {
  obx: { jobs: [{ id: "j4", title: "Gutter clean", customerId: "c2", date: "2026-06-18", crew: ["u1"], updatedAt: 1717100000000 }] },
  users: [{ id: "u1", username: "Ray", passhash: t.hashPw("pw-u1"), role: "owner",
    avail: { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00",
      overrides: { "2026-06-20": "full", "2026-06-21": "partial", "2026-06-22": "off" } },
    timeoff: [{ id: "to1", start: "2026-07-01", end: "2026-07-03", note: "Family trip" }],
    settings: { theme: "dark" }, calToken: "tok_ray_unguessable", updatedAt: 1717100000000 }]
};
const merged = t.mergeState(pulled, devicePush);
const expectAfterPush = census(pulled); expectAfterPush["obx.jobs"] = [...expectAfterPush["obx.jobs"], "j4"].sort();
ok("post-override merge keeps every prior record + adds the new job (no drop)", sameIds(expectAfterPush, census(merged)), { expected: expectAfterPush, got: census(merged) });
const mu1 = merged.users.find(x => x.id === "u1") || {};
ok("per-day overrides persist after the round-trip (full/partial/off)",
  mu1.avail && mu1.avail.overrides && mu1.avail.overrides["2026-06-20"] === "full" && mu1.avail.overrides["2026-06-21"] === "partial" && mu1.avail.overrides["2026-06-22"] === "off", mu1.avail);
// (4) LWW: the newer account record with overrides must NOT drop timeoff / role / passhash / settings / calToken.
ok("LWW account merge keeps timeoff/role/passhash/settings/calToken alongside new overrides (no field loss)",
  (mu1.timeoff || []).length === 1 && mu1.role === "owner" && !!mu1.passhash && (mu1.settings || {}).theme === "dark" && mu1.calToken === "tok_ray_unguessable", mu1);
ok("untouched accounts (Pierce/Chase) ride through unchanged",
  (() => { const p = merged.users.find(x => x.id === "u2") || {}, c = merged.users.find(x => x.id === "u3") || {};
    return p.avail && p.avail.start === "07:30" && (c.timeoff || []).length === 1; })(), { u2: merged.users.find(x => x.id === "u2"), u3: merged.users.find(x => x.id === "u3") });

// (full) Re-pull the merged store on a third device — still zero loss end to end.
ok("second pull (third device) is still zero-loss end to end", sameIds(census(merged), census(t.mergeState(merged, {}))), null);

console.log("— crew messaging: messages collection rides per-record LWW (new synced feature, data-safe) —");
const mg = t.mergeState(
  { obx: { messages: [
      { id: "thr_crew", kind: "thread", threadId: "thr_crew", title: "Crew", type: "broadcast", members: ["u1", "u2", "u3"], createdBy: "u1", updatedAt: 5 },
      { id: "msg_1", threadId: "thr_crew", senderId: "u1", senderLabel: "Ray", body: "Start at 8", ts: 100, updatedAt: 100 },
      { id: "rd_thr_crew_u2", kind: "read", threadId: "thr_crew", userId: "u2", lastReadTs: 100, updatedAt: 110 }   // Pierce's read marker, device A
    ] },
    jam: { messages: [{ id: "msg_j1", threadId: "thr_j", senderId: "u1", senderLabel: "Ray", body: "jam note", ts: 50, updatedAt: 50 }] } },
  { obx: { messages: [
      { id: "msg_1", threadId: "thr_crew", senderId: "u1", senderLabel: "Ray", body: "Start at 8:30 (edited)", ts: 100, updatedAt: 200 },  // sender edited, newer wins
      { id: "msg_2", threadId: "thr_crew", senderId: "u2", senderLabel: "Pierce", body: "On it", ts: 300, updatedAt: 300 },
      { id: "rd_thr_crew_u3", kind: "read", threadId: "thr_crew", userId: "u3", lastReadTs: 300, updatedAt: 120 }   // Chase's read marker, device B (DIFFERENT recipient)
    ] } }
);
ok("messages collection scaffolded on both businesses", Array.isArray(mg.obx.messages) && Array.isArray(mg.jam.messages), { obx: mg.obx.messages, jam: mg.jam.messages });
ok("thread descriptor survives merge as a kind-discriminated record", (mg.obx.messages.find(m => m.id === "thr_crew") || {}).kind === "thread", mg.obx.messages.filter(m => m.kind === "thread"));
ok("message LWW: edited body wins (newer updatedAt)", (mg.obx.messages.find(m => m.id === "msg_1") || {}).body === "Start at 8:30 (edited)", mg.obx.messages.find(m => m.id === "msg_1"));
ok("new message from the other device merges in (append-union)", !!mg.obx.messages.find(m => m.id === "msg_2"), mg.obx.messages.map(m => m.id));
// THE core proof: two recipients' read markers (distinct deterministic ids) must BOTH survive.
// This is the test that FAILS under a readBy[] field on the message (cross-recipient clobber).
const r2 = mg.obx.messages.find(m => m.id === "rd_thr_crew_u2"), r3 = mg.obx.messages.find(m => m.id === "rd_thr_crew_u3");
ok("read-state does NOT clobber across recipients (both per-user markers survive)", !!r2 && !!r3 && r2.lastReadTs === 100 && r3.lastReadTs === 300, { r2, r3 });
ok("messaging is per-business (jam message kept separate)", mg.jam.messages.length === 1 && mg.jam.messages[0].id === "msg_j1", mg.jam.messages);
// one user's read marker, same deterministic id from two devices → monotonic LWW, no duplicate
const rdU2 = t.mergeState(
  { obx: { messages: [{ id: "rd_thr_crew_u2", kind: "read", threadId: "thr_crew", userId: "u2", lastReadTs: 100, updatedAt: 100 }] } },
  { obx: { messages: [{ id: "rd_thr_crew_u2", kind: "read", threadId: "thr_crew", userId: "u2", lastReadTs: 500, updatedAt: 200 }] } }
);
ok("one user's read marker is monotonic LWW across devices (newer lastReadTs wins, no dup)",
  (() => { const ms = rdU2.obx.messages.filter(m => m.id === "rd_thr_crew_u2"); return ms.length === 1 && ms[0].lastReadTs === 500; })(), rdU2.obx.messages);
// retract a message → delete tombstone propagates
const mgDel = t.mergeState(
  { obx: { messages: [{ id: "msg_x", threadId: "thr_crew", body: "oops", ts: 10, updatedAt: 10 }] } },
  { obx: { messages: [{ id: "msg_x", threadId: "thr_crew", deleted: true, updatedAt: 50 }] } }
);
ok("retracted message tombstone propagates", (mgDel.obx.messages.find(m => m.id === "msg_x") || {}).deleted === true, mgDel.obx.messages);
// thread-IA cleanup: relabel an existing thread + add new threads (avail/ops) rides LWW with ZERO message loss
const iaMerge = t.mergeState(
  { obx: { messages: [
    { id: "thr_bc", kind: "thread", threadId: "thr_bc", title: "Strategy", type: "broadcast", members: ["u1", "u2", "u3"], updatedAt: 5 },
    { id: "m_keep1", threadId: "thr_bc", senderId: "u2", body: "im here", ts: 10, updatedAt: 10 },
    { id: "m_keep2", threadId: "thr_bc", senderId: "__ceo__", body: "Cap reply", ts: 11, updatedAt: 11 } ] } },
  { obx: { messages: [
    { id: "thr_bc", kind: "thread", threadId: "thr_bc", title: "Crew — Broadcast", type: "broadcast", members: ["u1", "u2", "u3"], updatedAt: 99 },         // relabel (newer wins)
    { id: "thr_avail_u2", kind: "thread", threadId: "thr_avail_u2", title: "Chase — Availability", type: "dm", availChannel: true, members: ["u2"], updatedAt: 99 },  // new per-crew avail channel
    { id: "thr_ops_capray", kind: "thread", threadId: "thr_ops_capray", title: "Cap ops", type: "dm", members: ["u1"], updatedAt: 99 } ] } }                  // new Ray-only ops thread
);
ok("thread-IA: broadcast relabel wins (Strategy → Crew — Broadcast) via LWW", (iaMerge.obx.messages.find(m => m.id === "thr_bc") || {}).title === "Crew — Broadcast", iaMerge.obx.messages.filter(m => m.kind === "thread").map(m => m.title));
ok("thread-IA: both prior crew messages survive the relabel (ZERO message loss)", !!iaMerge.obx.messages.find(m => m.id === "m_keep1") && !!iaMerge.obx.messages.find(m => m.id === "m_keep2"), iaMerge.obx.messages.filter(m => !m.kind).map(m => m.id));
ok("thread-IA: new per-crew availability channel merges in (members-scoped dm)", (() => { const a = iaMerge.obx.messages.find(m => m.id === "thr_avail_u2") || {}; return a.availChannel === true && a.type === "dm" && (a.members || []).length === 1; })(), null);
ok("thread-IA: new Ray-only ops thread is a dm scoped to the owner (NOT broadcast)", (() => { const o = iaMerge.obx.messages.find(m => m.id === "thr_ops_capray") || {}; return o.type === "dm" && (o.members || [])[0] === "u1"; })(), null);
// backward-compat: the pre-messages realistic fixture gains a messages push with ZERO loss of prior records
const msgPush = { obx: { messages: [
  { id: "thr_crew", kind: "thread", threadId: "thr_crew", title: "Crew", type: "broadcast", members: ["u1", "u2", "u3"], createdBy: "u1", updatedAt: 1717200000000 },
  { id: "msg_a", threadId: "thr_crew", senderId: "u1", senderLabel: "Ray", body: "hello crew", ts: 1717200000000, updatedAt: 1717200000000 }
] } };
const mergedMsg = t.mergeState(pulled, msgPush);
const expectMsg = census(pulled); expectMsg["obx.messages"] = ["msg_a", "thr_crew"].sort();
ok("adding messages to a pre-messages store keeps every prior customer/quote/job/account (zero loss)", sameIds(expectMsg, census(mergedMsg)), { expected: expectMsg, got: census(mergedMsg) });

console.log("— CEO read path: read-only, whitelisted projection (no mutation, no secrets/PII) —");
const ceoStore = {
  obx: {
    customers: [{ id: "c1", name: "Seaside Mgmt", phone: "252-555-0101", email: "sea@x.com" }],
    jobs: [
      { id: "j1", title: "Soft wash", customerId: "c1", address: "100 Ocean Blvd", date: "2026-06-18", crew: ["u1"], done: false, updatedAt: 5 },
      { id: "j2", title: "Done job", customerId: "c1", date: "2026-06-10", done: true, updatedAt: 5 }
    ],
    quotes: [
      { id: "q1", cust: "Seaside Mgmt", total: 480, accepted: true, updatedAt: 5 },
      { id: "q2", cust: "Duck Realty", total: 1250, accepted: false, updatedAt: 5 }
    ],
    timeclock: [{ id: "tc1", jobId: "j1", userId: "u1", clockIn: 1000, clockOut: null, updatedAt: 5 }]   // u1 on a job right now
  },
  jam: { jobs: [], quotes: [], timeclock: [] },
  users: [
    { id: "u1", username: "Ray", passhash: "SECRET_HASH", role: "owner", calToken: "tok_secret", avail: { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00" }, updatedAt: 5 },
    { id: "u2", username: "Pierce", passhash: "SECRET2", role: "crew", avail: { days: [true, true, true, true, true, true, true] }, updatedAt: 5 },
    { id: "__roles__", kind: "roles", roles: [], updatedAt: 5 }
  ]
};
const ceoSnap = JSON.stringify(ceoStore);
const proj = t.ceoProjection(ceoStore, { biz: "all", view: "all" });
ok("projection does NOT mutate the store (read-only by construction)", JSON.stringify(ceoStore) === ceoSnap, null);
const pjs = JSON.stringify(proj);
ok("projection leaks no secrets/PII (no passhash/calToken/phone/email)", !/passhash|calToken|SECRET_HASH|tok_secret|252-555-0101|sea@x\.com/.test(pjs), pjs.slice(0, 160));
ok("crew on an open job shows onJob + title", (() => { const c = proj.crew.find(x => x.id === "u1") || {}; return c.clockedIn === true && c.onJob && c.onJob.jobId === "j1" && c.onJob.title === "Soft wash"; })(), proj.crew.find(x => x.id === "u1"));
ok("idle crew shows onJob null", (() => { const c = proj.crew.find(x => x.id === "u2") || {}; return c.clockedIn === false && c.onJob === null; })(), proj.crew.find(x => x.id === "u2"));
ok("roles config record is not surfaced as crew", !proj.crew.find(x => x.id === "__roles__"), proj.crew.map(c => c.id));
ok("open jobs exclude done jobs", proj.openJobs.length === 1 && proj.openJobs[0].id === "j1", proj.openJobs.map(j => j.id));
ok("open quotes exclude accepted quotes", proj.openQuotes.length === 1 && proj.openQuotes[0].id === "q2", proj.openQuotes.map(q => q.id));
ok("counts reflect on-job / idle / open", proj.counts.crewOnJob === 1 && proj.counts.crewIdle === 1 && proj.counts.openJobs === 1 && proj.counts.openQuotes === 1, proj.counts);
ok("availabilityWeek = 7 days with buckets", proj.availabilityWeek.length === 7 && Array.isArray(proj.availabilityWeek[0].available), proj.availabilityWeek[0]);
ok("view=jobs returns only openJobs (+counts), not crew/quotes", (() => { const p = t.ceoProjection(ceoStore, { view: "jobs" }); return !!p.openJobs && !p.crew && !p.openQuotes; })(), null);
ok("CEO token: correct accepted", t.ceoTokenOk("abc", "abc") === true, null);
ok("CEO token: wrong rejected", t.ceoTokenOk("abc", "xyz") === false, null);
ok("CEO token: empty configured token always rejects (endpoint off)", t.ceoTokenOk("", "") === false && t.ceoTokenOk("x", "") === false, null);
const AR = require("./availability-resolve");
ok("shared resolver: timeoff wins", AR.status({ timeoff: [{ start: "2026-06-20", end: "2026-06-20" }], avail: { days: [true, true, true, true, true, true, true] } }, "2026-06-20") === "timeoff", null);
ok("shared resolver: per-day override wins over baseline", AR.status({ avail: { days: [false, false, false, false, false, false, false], overrides: { "2026-06-20": "full" } } }, "2026-06-20") === "on", null);
ok("shared resolver: partial override", AR.status({ avail: { overrides: { "2026-06-20": "partial" } } }, "2026-06-20") === "partial", null);
ok("shared resolver: no avail set => unset", AR.status({}, "2026-06-20") === "unset", null);

console.log("— scoped CEO write path: messages-collection-ONLY (cannot touch any other record) —");
const wStore = {
  obx: {
    customers: [{ id: "c1", name: "Seaside Mgmt", phone: "252-555-0101", updatedAt: 5 }],
    quotes: [{ id: "q1", total: 480, updatedAt: 5 }],
    jobs: [{ id: "j1", title: "Soft wash", updatedAt: 5 }],
    messages: []
  },
  jam: { customers: [{ id: "jc1", name: "Sound Side", updatedAt: 5 }] },
  users: [{ id: "u1", username: "Ray", passhash: "SECRET", role: "owner", updatedAt: 5 }]
};
const otherBefore = JSON.stringify({ obxC: wStore.obx.customers, obxQ: wStore.obx.quotes, obxJ: wStore.obx.jobs, jam: wStore.jam, users: wStore.users });
const built = t.ceoBuildMessage({ biz: "obx", title: "Strategy", body: "Handshake — wire test.", senderLabel: "Strategy" }, wStore);
ok("ceoBuildMessage produces ONLY message records (thread + message, all in messages)", built.records.length === 2 && built.records.every(r => r.kind === "thread" || (!r.kind && r.threadId)) && !!built.messageId, built.records.map(r => r.kind || "msg"));
const wMerged = t.mergeState(wStore, { obx: { messages: built.records } });
const otherAfter = JSON.stringify({ obxC: wMerged.obx.customers, obxQ: wMerged.obx.quotes, obxJ: wMerged.obx.jobs, jam: { customers: wMerged.jam.customers }, users: wMerged.users });
ok("scoped write does NOT touch customers/quotes/jobs/accounts/other-biz (byte-identical)", otherBefore === otherAfter, { before: otherBefore.slice(0, 80), after: otherAfter.slice(0, 80) });
ok("scoped write DID append the message + thread to obx.messages", wMerged.obx.messages.length === 2 && wMerged.obx.messages.some(m => m.id === built.messageId) && wMerged.obx.messages.some(m => m.kind === "thread"), wMerged.obx.messages.map(m => m.kind || "msg"));
ok("CEO message is attributed to the sender label, senderId sentinel (not a real account)", (() => { const m = wMerged.obx.messages.find(x => x.id === built.messageId) || {}; return m.senderLabel === "Strategy" && m.senderId === "__ceo__"; })(), wMerged.obx.messages.find(x => x.id === built.messageId));
// write token is independent of the read token (read key can never write; write key only via /api/ceo/message)
ok("write token gate is independent (own token required)", t.ceoTokenOk("WTOK", "WTOK") === true && t.ceoTokenOk("RTOK", "WTOK") === false, null);
// read view=messages surfaces threads + messages for the round-trip (Strategy reads the reply)
const replyStore = t.mergeState(wMerged, { obx: { messages: [{ id: "msg_reply", threadId: built.threadId, senderId: "u1", senderLabel: "Ray", body: "Got it — handshake received.", ts: Date.now() + 1, updatedAt: Date.now() + 1 }] } });
const mv = t.ceoProjection(replyStore, { view: "messages" });
ok("read view=messages returns the thread with both the CEO message and the crew reply", (() => {
  const thr = (mv.threads || []).find(x => x.threadId === built.threadId); return thr && thr.messages.length === 2 && thr.messages.some(m => m.senderLabel === "Strategy") && thr.messages.some(m => m.body === "Got it — handshake received.");
})(), mv.threads);
ok("read view=messages leaks no secrets (no passhash)", !/passhash|SECRET/.test(JSON.stringify(mv)), null);
// per-user read markers surface (so the watcher can derive unread / read-no-reply / replied)
const readStore = t.mergeState(replyStore, { obx: { messages: [{ id: "rd_" + built.threadId + "_u1", kind: "read", threadId: built.threadId, userId: "u1", lastReadTs: Date.now() + 5, updatedAt: Date.now() + 5 }] } });
const thr2 = (t.ceoProjection(readStore, { view: "messages" }).threads || []).find(x => x.threadId === built.threadId);
ok("read view=messages surfaces per-user read markers (userId/name/lastReadTs)", !!thr2 && Array.isArray(thr2.reads) && thr2.reads.some(r => r.userId === "u1" && r.name === "Ray" && r.lastReadTs > 0), thr2 && thr2.reads);

console.log("— web push: u.pushSubs rides account LWW (data-layer — zero account loss, non-negotiable) —");
const psBase = { users: [
  { id: "u1", username: "Ray", passhash: t.hashPw("pw"), role: "owner", avail: { days: [true, true, true, true, true, true, true] }, updatedAt: 5 },
  { id: "u2", username: "Pierce", passhash: t.hashPw("pw2"), role: "crew", updatedAt: 5 },
  { id: "__roles__", kind: "roles", roles: [], updatedAt: 5 }
] };
// (1) a device adds a pushSub to u2 (newer record) — must merge without dropping any account or u2's other fields
const psMerged = t.mergeState(psBase, { users: [
  { id: "u2", username: "Pierce", passhash: t.hashPw("pw2"), role: "crew", pushSubs: [{ endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } }], updatedAt: 9 }
] });
ok("all accounts survive the pushSubs merge (zero account loss)", ["u1", "u2", "__roles__"].every(id => psMerged.users.find(u => u.id === id)), psMerged.users.map(u => u.id));
ok("pushSubs persists on the account after merge", (() => { const u = psMerged.users.find(x => x.id === "u2") || {}; return Array.isArray(u.pushSubs) && u.pushSubs.length === 1 && u.pushSubs[0].endpoint === "https://push.example/abc"; })(), psMerged.users.find(x => x.id === "u2"));
ok("pushSubs LWW keeps the account's other fields (role + passhash)", (() => { const u = psMerged.users.find(x => x.id === "u2") || {}; return u.role === "crew" && !!u.passhash; })(), null);
ok("untouched account (u1 owner + avail) unaffected by the merge", (() => { const u = psMerged.users.find(x => x.id === "u1") || {}; return u.role === "owner" && !!u.avail && !!u.passhash; })(), null);
// (2) backward-compat: a pre-push store (no pushSubs anywhere) round-trips with zero account loss
const psRt = t.mergeState(psBase, {});
ok("pre-push accounts round-trip zero-loss + no pushSubs field (backward compatible)", ["u1", "u2", "__roles__"].every(id => psRt.users.find(u => u.id === id)) && !(psRt.users.find(u => u.id === "u1") || {}).pushSubs, null);

console.log("— ops-brain Phase A: last-active (read-only, not in data.json) + job.completedAt rides LWW —");
// last-active: noteActive stamps an in-memory map; surfaced read-only on the CEO read path crew[]
t.noteActive("u1");
const laProj = t.ceoProjection({ obx: { jobs: [], quotes: [], timeclock: [] }, jam: {}, users: [{ id: "u1", username: "Ray", role: "owner", updatedAt: 5 }] }, { view: "crew" });
ok("last-active surfaced on the read path (crew[].lastActive > 0 after noteActive)", (() => { const c = (laProj.crew || []).find(x => x.id === "u1") || {}; return c.lastActive > 0; })(), (laProj.crew || []).find(x => x.id === "u1"));
ok("last-active is in-memory only — NOT written into data.json by the merge", (() => { const m = t.mergeState({ users: [{ id: "u1", username: "Ray", updatedAt: 5 }] }, {}); return !("lastActive" in (m.users.find(u => u.id === "u1") || {})); })(), null);
ok("extra /sync payload field (userId) doesn't pollute the merged state", (() => { const m = t.mergeState({ obx: { customers: [{ id: "c1", updatedAt: 5 }] } }, {}); return !("userId" in m) && Array.isArray(m.obx.customers); })(), null);
// job.completedAt/completedBy ride per-record job LWW (jobs collection — no schema change), zero loss
const cj = t.mergeState(
  { obx: { jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", crew: ["u1"], done: false, updatedAt: 5 }] } },
  { obx: { jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", crew: ["u1"], done: true, completedAt: 1718600000000, completedBy: "u1", updatedAt: 9 }] } }
);
ok("completed job keeps completedAt/completedBy via job LWW (newer wins, other fields intact)", (() => { const j = cj.obx.jobs.find(x => x.id === "j1") || {}; return j.done === true && j.completedAt === 1718600000000 && j.completedBy === "u1" && j.title === "Wash" && (j.crew || []).length === 1; })(), cj.obx.jobs.find(x => x.id === "j1"));
ok("pre-capture job (no completedAt) round-trips zero-loss (backward compatible)", (() => { const m = t.mergeState({ obx: { jobs: [{ id: "j2", title: "Old", done: false, updatedAt: 5 }] } }, {}); const j = m.obx.jobs.find(x => x.id === "j2") || {}; return j.title === "Old" && !("completedAt" in j); })(), null);

console.log("— per-job P&L: job.expenses[] on-job array rides job LWW (Cap #3, additive) —");
// (a) a newer job record adds an expense line; all other job fields intact, zero loss
const exA = t.mergeState(
  { obx: { jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", crew: ["u1"], expenses: [{ id: "ex1", cat: "disposal", amount: 73.16, note: "C&D", addedAt: 5, addedBy: "u1" }], updatedAt: 5 }] } },
  { obx: { jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", crew: ["u1"], expenses: [{ id: "ex1", cat: "disposal", amount: 73.16, note: "C&D", addedAt: 5, addedBy: "u1" }, { id: "ex2", cat: "mileage", amount: 14.5, miles: 20, addedAt: 9, addedBy: "u1" }], updatedAt: 9 }] } }
);
ok("job.expenses LWW-merges (newer record adds a line; title/crew intact)", (() => { const j = exA.obx.jobs.find(x => x.id === "j1") || {}; return (j.expenses || []).length === 2 && j.expenses.some(e => e.cat === "mileage" && e.miles === 20 && e.amount === 14.5) && j.title === "Wash" && (j.crew || []).length === 1; })(), exA.obx.jobs.find(x => x.id === "j1"));
// (b) pre-expenses job (no expenses array) round-trips zero-loss — backward compatible
ok("pre-expenses job (no expenses array) round-trips zero-loss (backward compatible)", (() => { const m = t.mergeState({ obx: { jobs: [{ id: "j7", title: "Old", done: false, updatedAt: 5 }] } }, {}); const j = m.obx.jobs.find(x => x.id === "j7") || {}; return j.title === "Old" && !("expenses" in j); })(), null);
// (c) deleting an expense line: newer shorter list wins, no resurrection of the removed line
ok("deleting an expense line LWW-merges (newer wins, removed line does not resurrect)", (() => { const m = t.mergeState({ obx: { jobs: [{ id: "j8", expenses: [{ id: "e1", cat: "misc", amount: 5 }, { id: "e2", cat: "misc", amount: 9 }], updatedAt: 5 }] } }, { obx: { jobs: [{ id: "j8", expenses: [{ id: "e2", cat: "misc", amount: 9 }], updatedAt: 9 }] } }); const j = m.obx.jobs.find(x => x.id === "j8") || {}; return (j.expenses || []).length === 1 && j.expenses[0].id === "e2"; })(), null);

console.log("— resale tracker: first-class resale[] collection (Cap #5, LWW + zero-loss) —");
// (a) scaffolds on both businesses; two devices union-merge resale items
const rsM = t.mergeState(
  { obx: { resale: [{ id: "rs1", item: "Oak dresser", status: "to-list", jobId: "j1", createdAt: 5, updatedAt: 5 }] } },
  { obx: { resale: [{ id: "rs2", item: "Bike", status: "posted", platform: "Facebook Marketplace", listedDate: "2026-06-12", updatedAt: 7 }] }, jam: { resale: [] } }
);
ok("resale[] scaffolded on both businesses", Array.isArray(rsM.obx.resale) && Array.isArray(rsM.jam.resale), { obx: Object.keys(rsM.obx) });
ok("resale items from both devices union-merge", rsM.obx.resale.length === 2 && rsM.obx.resale.some(r => r.id === "rs1") && rsM.obx.resale.some(r => r.id === "rs2"), rsM.obx.resale.map(r => r.id));
// (b) status advance LWW: posted→sold (newer wins, price/buyer captured, other fields intact)
const rsSold = t.mergeState(
  { obx: { resale: [{ id: "rs3", item: "Couch", status: "posted", platform: "OfferUp", listedDate: "2026-06-10", updatedAt: 5 }] } },
  { obx: { resale: [{ id: "rs3", item: "Couch", status: "sold", platform: "OfferUp", price: 120, buyer: "Dana", soldDate: "2026-06-15", updatedAt: 9 }] } }
);
ok("resale status advance LWW-merges (sold + price/buyer win, item intact)", (() => { const r = rsSold.obx.resale.find(x => x.id === "rs3") || {}; return r.status === "sold" && r.price === 120 && r.buyer === "Dana" && r.item === "Couch"; })(), rsSold.obx.resale[0]);
// (c) delete tombstone survives
ok("resale delete tombstone LWW-merges", (() => { const m = t.mergeState({ obx: { resale: [{ id: "rs4", item: "Lamp", status: "to-list", updatedAt: 5 }] } }, { obx: { resale: [{ id: "rs4", item: "Lamp", status: "to-list", deleted: true, updatedAt: 9 }] } }); const r = m.obx.resale.find(x => x.id === "rs4") || {}; return r.deleted === true; })(), null);
// (d) a pre-resale store (no resale key) round-trips zero-loss + scaffolds resale empty
ok("pre-resale store: every customer/quote/job survives + resale scaffolds (zero loss)", (() => { const m = t.mergeState({ obx: { customers: [{ id: "c1", updatedAt: 5 }], quotes: [{ id: "q1", updatedAt: 5 }], jobs: [{ id: "j1", updatedAt: 5 }] } }, {}); return m.obx.customers.length === 1 && m.obx.quotes.length === 1 && m.obx.jobs.length === 1 && Array.isArray(m.obx.resale); })(), null);

console.log("— Step 2 data spine: pendingChanges approval queue (synced collection, LWW, zero-loss migration) —");
// (a) scaffolds on both businesses; proposals from two devices union-merge
const pc1 = t.mergeState(
  { obx: { pendingChanges: [{ id: "pc1", proposedBy: "finance", type: "create", collection: "todos", targetId: null, before: null, after: { id: "td_new", title: "Follow up Mike re: 3rd-tree pricing" }, summary: "Add to-do: follow up Mike", status: "pending", createdAt: 5, updatedAt: 5 }] } },
  { obx: { pendingChanges: [{ id: "pc2", proposedBy: "ops", type: "create", collection: "todos", after: { id: "td_2", title: "Order bags" }, summary: "Add to-do: order bags", status: "pending", createdAt: 7, updatedAt: 7 }] }, jam: { pendingChanges: [] } }
);
ok("pendingChanges scaffolded on both businesses", Array.isArray(pc1.obx.pendingChanges) && Array.isArray(pc1.jam.pendingChanges), { obx: Object.keys(pc1.obx) });
ok("proposals from both devices union-merge", pc1.obx.pendingChanges.length === 2 && pc1.obx.pendingChanges.some(p => p.id === "pc1") && pc1.obx.pendingChanges.some(p => p.id === "pc2"), pc1.obx.pendingChanges.map(p => p.id));
ok("proposal carries before/after snapshot + summary (diff + undo)", (() => { const p = pc1.obx.pendingChanges.find(x => x.id === "pc1") || {}; return p.before === null && (p.after || {}).id === "td_new" && p.summary === "Add to-do: follow up Mike"; })(), pc1.obx.pendingChanges.find(x => x.id === "pc1"));
// (b) status advance LWW: pending → applied (newer wins, after/before intact, no field loss)
const pcApplied = t.mergeState(
  { obx: { pendingChanges: [{ id: "pc3", collection: "todos", type: "create", before: null, after: { id: "td_3", title: "X" }, summary: "add X", status: "pending", createdAt: 5, updatedAt: 5 }] } },
  { obx: { pendingChanges: [{ id: "pc3", collection: "todos", type: "create", before: null, after: { id: "td_3", title: "X" }, summary: "add X", status: "applied", decidedBy: "u1", decidedAt: 9, updatedAt: 9 }] } }
);
ok("proposal status advance LWW-merges (applied wins, after intact, decidedBy captured)", (() => { const p = pcApplied.obx.pendingChanges.find(x => x.id === "pc3") || {}; return p.status === "applied" && p.decidedBy === "u1" && (p.after || {}).id === "td_3"; })(), pcApplied.obx.pendingChanges[0]);
// (c) reject/discard tombstone propagates (soft-delete only — no hard deletes)
ok("rejected proposal tombstone LWW-merges (soft-delete)", (() => { const m = t.mergeState({ obx: { pendingChanges: [{ id: "pc4", status: "pending", updatedAt: 5 }] } }, { obx: { pendingChanges: [{ id: "pc4", status: "rejected", deleted: true, updatedAt: 9 }] } }); const p = m.obx.pendingChanges.find(x => x.id === "pc4") || {}; return p.deleted === true && p.status === "rejected"; })(), null);
// (d) THE migration fixture: a fresh device pulling the pre-Step2 store scaffolds pendingChanges empty (clean init)
ok("pre-Step2 store scaffolds pendingChanges empty on pull (blank()/load()/COLLECTIONS init clean)", (() => { const m = t.mergeState(fx, {}); return Array.isArray(m.obx.pendingChanges) && Array.isArray(m.jam.pendingChanges) && m.obx.pendingChanges.length === 0 && m.jam.pendingChanges.length === 0; })(), null);
// (e) THE zero-loss proof: adding a proposal to the realistic pre-change store keeps EVERY prior record
const pcPush = { obx: { pendingChanges: [{ id: "pc_seed", proposedBy: "finance", type: "create", collection: "todos", targetId: null, before: null, after: { id: "td_seed", title: "Follow up Mike re: 3rd-tree pricing" }, summary: "Add to-do", status: "pending", createdAt: 1717300000000, updatedAt: 1717300000000 }] } };
const pcMerged = t.mergeState(pulled, pcPush);
const expectPc = census(pulled); expectPc["obx.pendingChanges"] = ["pc_seed"];
ok("adding pendingChanges to the realistic store keeps every prior customer/property/quote/job/account (ZERO loss)", sameIds(expectPc, census(pcMerged)), { expected: expectPc["obx.pendingChanges"], got: census(pcMerged)["obx.pendingChanges"] });
ok("the proposal landed in the queue (and nowhere else)", (() => { const c = census(pcMerged); return c["obx.pendingChanges"].length === 1 && c["obx.pendingChanges"][0] === "pc_seed"; })(), census(pcMerged)["obx.pendingChanges"]);

console.log("— Step 2 scoped CEO propose path: writes pendingChanges ONLY, whitelist-enforced (cannot touch business data) —");
const propStore = {
  obx: { customers: [{ id: "c1", name: "Seaside", updatedAt: 5 }], quotes: [{ id: "q1", total: 480, updatedAt: 5 }], jobs: [{ id: "j1", title: "Wash", updatedAt: 5 }], todos: [{ id: "t0", title: "existing", updatedAt: 5 }], pendingChanges: [] },
  jam: { customers: [{ id: "jc1", name: "Sound Side", updatedAt: 5 }] },
  users: [{ id: "u1", username: "Ray", passhash: "SECRET", role: "owner", updatedAt: 5 }]
};
const propBefore = JSON.stringify({ c: propStore.obx.customers, q: propStore.obx.quotes, j: propStore.obx.jobs, td: propStore.obx.todos, jam: propStore.jam, users: propStore.users });
const builtP = t.ceoBuildProposal({ biz: "obx", proposedBy: "finance", type: "create", collection: "todos", after: { id: "td_mike", title: "Follow up Mike re: 3rd-tree pricing", priority: "Medium" }, summary: "Add to-do: follow up Mike re: 3rd-tree pricing" }, propStore);
ok("ceoBuildProposal produces ONE pending pendingChanges record (status=pending, todos)", builtP.ok && builtP.record && builtP.record.status === "pending" && builtP.record.collection === "todos" && !!builtP.proposalId, builtP);
const pwMerged = t.mergeState(propStore, { obx: { pendingChanges: [builtP.record] } });
const propAfter = JSON.stringify({ c: pwMerged.obx.customers, q: pwMerged.obx.quotes, j: pwMerged.obx.jobs, td: pwMerged.obx.todos, jam: { customers: pwMerged.jam.customers }, users: pwMerged.users });
ok("propose does NOT touch customers/quotes/jobs/todos/accounts/other-biz (byte-identical)", propBefore === propAfter, { before: propBefore.slice(0, 70), after: propAfter.slice(0, 70) });
ok("propose appended exactly one proposal to pendingChanges", pwMerged.obx.pendingChanges.length === 1 && pwMerged.obx.pendingChanges[0].id === builtP.proposalId, pwMerged.obx.pendingChanges.map(p => p.id));
ok("proposal carries the pre-allocated target id (idempotent client apply) + summary", (pwMerged.obx.pendingChanges[0].after || {}).id === "td_mike" && /follow up Mike/i.test(pwMerged.obx.pendingChanges[0].summary), pwMerged.obx.pendingChanges[0]);
// whitelist enforcement (defense in depth — Cap cannot escape the lane even if it tries)
ok("propose REJECTS system/meta collections (messages/changelog/locks/pendingChanges)", ["messages", "changelog", "locks", "pendingChanges"].every(c => t.ceoBuildProposal({ biz: "obx", type: "update", collection: c, targetId: "x", after: { id: "x" }, summary: "x" }, propStore).ok === false), null);
ok("propose now ACCEPTS all business collections (customers/quotes/jobs/income/expenses/resale)", ["customers", "quotes", "jobs", "income", "expenses", "resale"].every(c => { const r = t.ceoBuildProposal({ biz: "obx", type: "create", collection: c, after: { title: "x" }, summary: "add " + c }, propStore); return r.ok === true && r.record.collection === c && r.record.status === "pending"; }), null);
ok("propose (non-todos) generates a collection-prefixed id for create (idempotent apply)", (() => { const r = t.ceoBuildProposal({ biz: "obx", type: "create", collection: "customers", after: { name: "New Co" }, summary: "add customer" }, propStore); return r.ok && /^cus_/.test((r.record.after || {}).id); })(), null);
ok("propose REJECTS a non-whitelisted type (hard delete)", t.ceoBuildProposal({ biz: "obx", type: "delete", collection: "todos", targetId: "t0", summary: "remove" }, propStore).ok === false, null);
ok("propose REJECTS empty summary", t.ceoBuildProposal({ biz: "obx", type: "create", collection: "todos", after: { id: "x" }, summary: "   " }, propStore).ok === false, null);
ok("propose create without after rejected", t.ceoBuildProposal({ biz: "obx", type: "create", collection: "todos", summary: "x" }, propStore).ok === false, null);
ok("propose update/softDelete require a targetId", t.ceoBuildProposal({ biz: "obx", type: "update", collection: "todos", after: { title: "x" }, summary: "x" }, propStore).ok === false && t.ceoBuildProposal({ biz: "obx", type: "softDelete", collection: "todos", summary: "x" }, propStore).ok === false, null);
ok("propose generates a stable collection-prefixed id when create omits after.id (idempotent apply)", (() => { const r = t.ceoBuildProposal({ biz: "obx", type: "create", collection: "todos", after: { title: "no id" }, summary: "add" }, propStore); return r.ok && /^tod_/.test((r.record.after || {}).id); })(), null);
ok("propose uses the WRITE token gate (independent of the read token)", t.ceoTokenOk("WTOK", "WTOK") === true && t.ceoTokenOk("RTOK", "WTOK") === false, null);

console.log("— ops-brain Phase B: view=ops projection + opsFindings gap rules —");
const opsmod = require("./tools/ops-sweep");
const opsView = t.ceoProjection({
  obx: { jobs: [{ id: "j1", title: "Wash", date: "2026-06-10", crew: ["u1"], done: false, updatedAt: 5 }], todos: [{ id: "t1", title: "Bags", due: "2026-06-10", done: false, priority: "High", updatedAt: 5 }], quotes: [{ id: "q1", cust: "Acme", total: 400, accepted: true, updatedAt: 5 }], timeclock: [], resale: [{ id: "rs1", item: "Dresser", status: "to-list", jobId: "j1", updatedAt: 5 }, { id: "rsSold", item: "Bike", status: "sold", price: 50, updatedAt: 5 }] },
  jam: {}, users: [{ id: "u1", username: "Ray", role: "owner", updatedAt: 5 }]
}, { view: "ops" });
ok("view=ops returns jobs/todos/openShifts/unscheduledQuotes/crew/resale arrays", ["jobs", "todos", "openShifts", "unscheduledQuotes", "crew", "resale"].every(k => Array.isArray(opsView[k])), Object.keys(opsView));
ok("view=ops surfaces open resale items but EXCLUDES sold", opsView.resale.some(r => r.id === "rs1") && !opsView.resale.some(r => r.id === "rsSold"), opsView.resale.map(r => r.id));
ok("view=ops jobs carry done + completedAt (Phase A capture surfaced)", (() => { const j = opsView.jobs.find(x => x.id === "j1") || {}; return "done" in j && "completedAt" in j; })(), opsView.jobs[0]);
ok("view=ops surfaces accepted-but-unscheduled quote", opsView.unscheduledQuotes.some(q => q.id === "q1"), opsView.unscheduledQuotes);
const synthOps = {
  today: "2026-06-15", asOf: Date.parse("2026-06-15T12:00:00Z"),
  jobs: [{ id: "j1", title: "Overdue wash", date: "2026-06-10", crew: ["u1"], done: false }, { id: "j2", title: "Done", date: "2026-06-10", done: true }, { id: "j3", title: "Cover", date: "2026-06-15", crew: ["u2"], done: false }],
  todos: [{ id: "t1", title: "Bags", due: "2026-06-10", done: false, priority: "High" }],
  openShifts: [{ id: "s1", userId: "u1", jobId: "jX", clockIn: Date.parse("2026-06-15T00:00:00Z") }],
  unscheduledQuotes: [{ id: "q1", customer: "Acme", total: 400, acceptedDate: "2026-06-09" }],
  crew: [{ id: "u1", name: "Ray", today: "on", lastActive: 0 }, { id: "u2", name: "Chase", today: "off" }],
  resale: [{ id: "rs1", item: "Oak dresser", status: "to-list", updatedAt: Date.parse("2026-06-01T00:00:00Z") }, { id: "rs2", item: "Fresh chair", status: "to-list", updatedAt: Date.parse("2026-06-14T00:00:00Z") }]
};
const F = opsmod.opsFindings(synthOps), keys = F.map(f => f.key);
ok("opsFindings: overdue job flagged high", keys.indexOf("missedjob:j1") >= 0 && (F.find(f => f.key === "missedjob:j1") || {}).sev === "high", keys);
ok("opsFindings: done job NOT flagged", keys.indexOf("missedjob:j2") < 0, keys);
ok("opsFindings: coverage gap (all crew off) flagged", keys.indexOf("coverage:j3") >= 0, keys);
ok("opsFindings: overdue task flagged", keys.indexOf("overduetask:t1") >= 0, keys);
ok("opsFindings: forgot-to-clock-out flagged", keys.indexOf("openshift:s1") >= 0, keys);
ok("opsFindings: accepted-unscheduled quote flagged", keys.indexOf("unschedquote:q1") >= 0, keys);
ok("opsFindings: aging to-list resale flagged (>7d), fresh one not", keys.indexOf("resaleaging:rs1") >= 0 && keys.indexOf("resaleaging:rs2") < 0, keys);
ok("opsFindings: high severity sorts first", F.length > 0 && F[0].sev === "high", F[0]);
ok("formatBrief renders a prioritized digest (counts + icons)", (() => { const b = opsmod.formatBrief(F, "Sweep"); return /high/.test(b) && b.indexOf("🔴") >= 0 && b.split("\n").length > 1; })(), null);
ok("formatBrief on no findings = all clear", /all clear/.test(opsmod.formatBrief([])), null);

console.log("— ops-brain Phase C: autonomous voice (gap-report + Cap's read + Ray-only audience gate) —");
const briefmod = require("./tools/ops-brief");
ok("capRead maps each finding type to a recommendation (no generic fallback for known keys)", (() => {
  const keys = ["missedjob:j1", "coverage:j2", "overduetask:t1", "staletask:t2", "openshift:s1", "unschedquote:q1", "eqconflict:k", "quiet:u1", "resaleaging:rs1"];
  return keys.every(k => { const r = opsmod.capRead({ key: k }); return r && r !== "Review and resolve."; });
})(), null);
ok("capRead falls back gracefully on an unknown key", opsmod.capRead({ key: "mystery:x" }) === "Review and resolve.", null);
const gr = opsmod.buildGapReport(F, "2026-06-15");
ok("buildGapReport: digest has the date label, counts, per-finding Cap's read (↳), severity icons", /2026-06-15/.test(gr) && /high/.test(gr) && gr.indexOf("↳") >= 0 && gr.indexOf("🔴") >= 0, null);
ok("buildGapReport: empty findings = all clear", /All clear/.test(opsmod.buildGapReport([])), null);
// THE GATE: pre-meeting the brief routes to the Ray-only OPS thread; crew-facing is built but OFF
ok("audience=ray → routes to the Ray-only ops thread (never a crew-visible thread)", (() => { const t = briefmod.audienceTarget("ray", briefmod.CREW_FACING_ENABLED); return !t.blocked && t.target === "ops"; })(), null);
ok("audience=crew is BLOCKED while the switch is off (CREW_FACING_ENABLED=false)", (() => { const t = briefmod.audienceTarget("crew", briefmod.CREW_FACING_ENABLED); return t.blocked === true && /GATED OFF/.test(t.reason); })(), null);
ok("the switch is shipped OFF (crew not yet initiated)", briefmod.CREW_FACING_ENABLED === false, briefmod.CREW_FACING_ENABLED);
ok("audience=crew WOULD broadcast once the switch is flipped on (path is built)", (() => { const t = briefmod.audienceTarget("crew", true); return !t.blocked && t.target === "crew"; })(), null);

console.log("— push content: SW peek returns the real latest inbound message (Cap #6) —");
const peekStore = {
  users: [
    { id: "u1", username: "Ray", pushSubs: [{ endpoint: "https://push.example/RAY" }], updatedAt: 5 },
    { id: "u2", username: "Chase", pushSubs: [{ endpoint: "https://push.example/CHASE" }], updatedAt: 5 },
    { id: "u3", username: "Lonely", pushSubs: [{ endpoint: "https://push.example/LONELY" }], updatedAt: 5 }
  ],
  obx: { messages: [
    { id: "thrA", kind: "thread", threadId: "tA", type: "dm", members: ["u1", "u2"], title: "Cap", updatedAt: 5 },
    { id: "m1", threadId: "tA", senderId: "u1", senderLabel: "Ray", body: "first", ts: 100 },
    { id: "m2", threadId: "tA", senderId: "__ceo__", senderLabel: "Cap", body: "Pierce double-booked Saturday — sort it?", ts: 200 },
    { id: "thrB", kind: "thread", threadId: "tB", type: "broadcast", members: [], title: "Crew", updatedAt: 5 },
    { id: "m3", threadId: "tB", senderId: "u2", senderLabel: "Chase", body: "on my way", ts: 300 }
  ] }
};
ok("pushPeek: Ray gets the latest inbound (broadcast incl.) — Chase's 'on my way'", (() => { const r = t.pushPeek(peekStore, "https://push.example/RAY"); return r.ok && r.title === "Chase" && r.body === "on my way"; })(), t.pushPeek(peekStore, "https://push.example/RAY"));
ok("pushPeek: Chase gets the Cap DM, NOT his own broadcast message", (() => { const r = t.pushPeek(peekStore, "https://push.example/CHASE"); return r.ok && r.title === "Cap" && /double-booked/.test(r.body); })(), t.pushPeek(peekStore, "https://push.example/CHASE"));
ok("pushPeek: unknown endpoint → ok:false (no leak)", t.pushPeek(peekStore, "https://push.example/NOPE").ok === false, null);
ok("pushPeek: broadcast reaches everyone — Lonely also gets the broadcast", (() => { const r = t.pushPeek(peekStore, "https://push.example/LONELY"); return r.ok && r.body === "on my way"; })(), null);
ok("pushPeek: user in no thread → generic fallback (always shows something)", (() => { const iso = { users: [{ id: "u9", pushSubs: [{ endpoint: "e9" }], updatedAt: 5 }], obx: { messages: [{ id: "th", kind: "thread", threadId: "t", type: "dm", members: ["uX", "uY"], title: "DM", updatedAt: 5 }, { id: "m", threadId: "t", senderId: "uX", senderLabel: "X", body: "private", ts: 1 }] } }; const r = t.pushPeek(iso, "e9"); return r.ok && /New message/.test(r.body) && !/private/.test(r.body); })(), null);
ok("pushPeek: body is truncated to a short preview", (() => { const big = { users: [{ id: "u1", pushSubs: [{ endpoint: "e" }], updatedAt: 5 }], obx: { messages: [{ id: "th", kind: "thread", threadId: "t", type: "broadcast", title: "Crew", updatedAt: 5 }, { id: "m", threadId: "t", senderId: "x", senderLabel: "X", body: "y".repeat(500), ts: 1 }] } }; return t.pushPeek(big, "e").body.length <= 140; })(), null);

console.log("— Access SSO: signed-JWT verification is FORGERY-PROOF (the security gate) —");
(async function () {
  const c2 = require("crypto");
  const { publicKey, privateKey } = c2.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }); jwk.kid = "testkid";   // stand-in for Cloudflare's signing key
  const DOMAIN = "team.cloudflareaccess.com";
  const b64url = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const mkJwt = (payload, opt) => { opt = opt || {}; const h = b64url(JSON.stringify({ alg: "RS256", kid: "testkid", typ: "JWT" })); const p = b64url(JSON.stringify(payload)); const sig = c2.sign("RSA-SHA256", Buffer.from(h + "." + p), opt.key || privateKey); return h + "." + p + "." + b64url(sig); };
  const n = Math.floor(Date.now() / 1000), opt = { domain: DOMAIN, keys: [jwk] };
  const good = mkJwt({ iss: "https://" + DOMAIN, email: "ray@obxlotsolutions.com", exp: n + 300 });
  const v = await t.verifyAccessJwt(good, opt);
  ok("SSO: a genuine Cloudflare-signed token verifies -> email claim", !!v && v.email === "ray@obxlotsolutions.com", v);
  const parts = good.split(".");
  const forged = parts[0] + "." + b64url(JSON.stringify({ iss: "https://" + DOMAIN, email: "attacker@evil.com", exp: n + 300 })) + "." + parts[2];
  ok("SSO: tampered payload (email swapped, old signature) -> REJECTED", (await t.verifyAccessJwt(forged, opt)) === null, null);
  const atk = c2.generateKeyPairSync("rsa", { modulusLength: 2048 });
  ok("SSO: token signed by a NON-Cloudflare key (header spoof) -> REJECTED", (await t.verifyAccessJwt(mkJwt({ iss: "https://" + DOMAIN, email: "ray@obxlotsolutions.com", exp: n + 300 }, { key: atk.privateKey }), opt)) === null, null);
  ok("SSO: wrong issuer -> REJECTED", (await t.verifyAccessJwt(mkJwt({ iss: "https://evil.cloudflareaccess.com", email: "ray@obxlotsolutions.com", exp: n + 300 }), opt)) === null, null);
  ok("SSO: expired token -> REJECTED", (await t.verifyAccessJwt(mkJwt({ iss: "https://" + DOMAIN, email: "ray@obxlotsolutions.com", exp: n - 10 }), opt)) === null, null);
  ok("SSO: empty token / SSO-off (no domain) -> null", (await t.verifyAccessJwt("", opt)) === null && (await t.verifyAccessJwt(good, { domain: "", keys: [jwk] })) === null, null);

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
})();
