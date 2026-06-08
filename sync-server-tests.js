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
ok("wrong password rejected", t.verifyLogin(store, "ray", "nope") === null, null);
ok("unknown user rejected", t.verifyLogin(store, "nobody", "x") === null, null);
ok("soft-deleted account rejected", t.verifyLogin(store, "gone", "x") === null, null);
ok("deactivated account rejected (active:false)", t.verifyLogin(store, "benched", "x") === null, null);
ok("roles config record is not a loginable account", t.accountByName(store, "__roles__") === null && t.verifyLogin(store, "", "") === null, null);
ok("djb2 fallback hash (file://-created account) also verifies",
  !!t.verifyLogin({ users: [{ id: "u3", username: "leg", passhash: t.hashPwFallback("legacy"), updatedAt: 1 }] }, "leg", "legacy"), null);
ok("empty store rejects (bootstrap: no accounts yet)", t.verifyLogin({ users: [] }, "ray", "hunter2") === null, null);

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

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
