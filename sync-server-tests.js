/* Data-layer migration + auth fixture test (touches accounts/sync).
 * Exercises the server's record-merge "migration" and the new /login verification with fixtures.
 * Run: node "sync-server-tests.js"  →  expect: all passed, 0 failed.
 * Requiring sync-server.js does NOT open a port (listen is guarded by require.main). */
const t = require("./sync-server");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + "  got " + JSON.stringify(got)); } }

console.log("\n— data-layer migration (mergeState) —");
// legacy fixture: old biz shape (customers only, missing collections), and NO users key at all
const stored = { obx: { customers: [{ id: "c1", name: "Old", updatedAt: 10 }] }, jam: { customers: [{ id: "jc1", name: "Jam Cust", updatedAt: 5 }] } };
const incoming = {
  obx: { customers: [{ id: "c1", name: "New", updatedAt: 20 }, { id: "c2", name: "Added", updatedAt: 5 }], quotes: [{ id: "q1", updatedAt: 1 }] },
  users: [{ id: "u1", username: "ray", passhash: t.hashPw("pw"), updatedAt: 3 }]
};   // incoming mentions ONLY obx — jam must survive from stored (never-drop-an-org)
const m = t.mergeState(stored, incoming);
ok("all collections present on obx", ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "changelog", "locks", "timeclock"].every(k => Array.isArray(m.obx[k])), Object.keys(m.obx));
ok("jam org preserved when incoming omits it (never-drop-an-org)", m.jam && Array.isArray(m.jam.customers) && !!m.jam.customers.find(x => x.id === "jc1"), m.jam);

console.log("\n— multi-org (Phase 1): dynamic orgs + registry —");
ok("orgIdsOf lists org keys, excludes users/registry", JSON.stringify(t.orgIdsOf({ obx: {}, jam: {}, users: [], registry: [] }).sort()) === JSON.stringify(["jam", "obx"]));
const moA = t.mergeState({ obx: { customers: [{ id: "oc", updatedAt: 5 }] }, jam: { customers: [{ id: "jcx", updatedAt: 5 }] } }, { escaperoom: { customers: [{ id: "ec", updatedAt: 5 }] } });
ok("a NEW org (escaperoom) merges in", moA.escaperoom && !!moA.escaperoom.customers.find(x => x.id === "ec"), moA.escaperoom);
ok("existing orgs preserved when a new org is added", !!moA.obx.customers.find(x => x.id === "oc") && !!moA.jam.customers.find(x => x.id === "jcx"), Object.keys(moA));
const moB = t.mergeState({ obx: { customers: [{ id: "oc", updatedAt: 5 }] }, escaperoom: { customers: [{ id: "ec", updatedAt: 5 }] } }, { obx: { customers: [{ id: "oc2", updatedAt: 6 }] } });
ok("never-drop-an-org: escaperoom survives an obx-only push", moB.escaperoom && !!moB.escaperoom.customers.find(x => x.id === "ec"), moB.escaperoom);
const mig = t.migrateStore({ obx: { customers: [{ id: "c1", updatedAt: 1 }] }, jam: { customers: [] }, users: [{ id: "u1", updatedAt: 1 }] });
ok("migration scaffolds the registry (obx + jam listed)", !!mig.registry.find(r => r.id === "obx") && !!mig.registry.find(r => r.id === "jam"), mig.registry);
ok("migration preserves every record (obx customer survives)", !!mig.obx.customers.find(x => x.id === "c1"), mig.obx);
ok("migration is idempotent (registry not duplicated on re-run)", t.migrateStore(t.migrateStore(mig)).registry.filter(r => r.id === "obx").length === 1);
ok("registry LWW-merges (newer org name wins)", t.mergeState({ registry: [{ id: "obx", name: "Old", updatedAt: 1 }] }, { registry: [{ id: "obx", name: "New", updatedAt: 9 }] }).registry.find(r => r.id === "obx").name === "New");

console.log("\n— multi-org (Phase 3a): memberships + scoping helpers —");
const mstore = { obx: {}, jam: {}, escaperoom: {}, users: [
  { id: "ray", username: "ray", role: "owner", superAdmin: true, updatedAt: 1 },
  { id: "joe", username: "joe", role: "crew", updatedAt: 1 },
  { id: "mem_obx_joe", kind: "membership", orgId: "obx", accountId: "joe", role: "crew", active: true, updatedAt: 1 },
  { id: "mem_jam_joe", kind: "membership", orgId: "jam", accountId: "joe", role: "admin", active: true, updatedAt: 1 },
] };
ok("accountById returns the account, not membership records", !!t.accountById(mstore, "joe") && t.accountById(mstore, "joe").username === "joe" && !t.accountById(mstore, "mem_obx_joe"));
ok("membershipsOfStore lists an account's memberships", t.membershipsOfStore(mstore, "joe").length === 2);
ok("orgsForUser(member) = only their orgs", JSON.stringify(t.orgsForUser(mstore, t.accountById(mstore, "joe")).sort()) === JSON.stringify(["jam", "obx"]));
ok("orgsForUser(super-admin) = every org", JSON.stringify(t.orgsForUser(mstore, t.accountById(mstore, "ray")).sort()) === JSON.stringify(["escaperoom", "jam", "obx"]));
const mm = t.migrateStore({ obx: {}, jam: {}, users: [{ id: "u1", role: "owner", updatedAt: 1 }, { id: "u2", role: "crew", updatedAt: 1 }] });
ok("migration synthesizes obx+jam memberships for pre-multi-org accounts", mm.users.filter(x => x.kind === "membership").length === 4);
ok("migration promotes the owner to super-admin", !!mm.users.find(x => x.id === "u1").superAdmin);
ok("membership migration is idempotent", t.migrateStore(t.migrateStore(mm)).users.filter(x => x.kind === "membership").length === 4);
ok("an account that already has a membership is NOT re-migrated into obx/jam", (function () { const s2 = t.migrateStore({ obx: {}, jam: {}, escaperoom: {}, users: [{ id: "u3", role: "crew", updatedAt: 1 }, { id: "mem_escaperoom_u3", kind: "membership", orgId: "escaperoom", accountId: "u3", active: true, updatedAt: 1 }] }); return s2.users.filter(x => x.kind === "membership" && x.accountId === "u3").length === 1; })());
ok("projectForUser sends only the caller's orgs", (function () { const p = t.projectForUser({ obx: { customers: [] }, jam: { customers: [] }, registry: [{ id: "obx" }, { id: "jam" }], users: [] }, ["obx"], { id: "z" }); return !!p.obx && !p.jam && p.registry.length === 1; })());
ok("orgAiContext is scoped to ONE org (its name + counts)", (function () { const c = t.orgAiContext({ obx: { customers: [{ id: "c1" }] }, jam: { customers: [{ id: "j1" }, { id: "j2" }] }, registry: [{ id: "obx", name: "OBX Lot" }] }, "obx"); return c.indexOf("OBX Lot") >= 0 && c.indexOf("Customers: 1") >= 0; })());
ok("users array migrated in", Array.isArray(m.users) && m.users.length === 1, m.users);
ok("LWW: newer customer record wins", (m.obx.customers.find(x => x.id === "c1") || {}).name === "New", m.obx.customers);
ok("merge brings in new record", !!m.obx.customers.find(x => x.id === "c2"), m.obx.customers);
ok("incoming-only collection merged", m.obx.quotes.length === 1, m.obx.quotes);

console.log("\n— PER-ORG NAV ORDER (admin-controlled menu order) migration fixture + LWW + permission gate —");
// Realistic pre-navOrder store: two orgs with real data + accounts/memberships. Owner+admin in obx, a crew member, all on the registry (no navOrder yet).
const noStored = {
  obx: { customers: [{ id: "c1", name: "Acme", updatedAt: 10 }], quotes: [{ id: "q1", updatedAt: 10 }], jobs: [{ id: "j1", title: "Haul", updatedAt: 10 }], properties: [{ id: "p1", address: "1 Sea", updatedAt: 10 }] },
  jam: { customers: [{ id: "jc1", name: "Mill", updatedAt: 10 }] },
  registry: [{ id: "obx", name: "OBX Lot Solutions", tabs: null, updatedAt: 5 }, { id: "jam", name: "Jamieson", updatedAt: 5 }],
  users: [
    { id: "own", username: "ray", role: "owner", superAdmin: true, updatedAt: 1 },
    { id: "adm", username: "amy", role: "crew", updatedAt: 1 },
    { id: "crw", username: "joe", role: "crew", updatedAt: 1 },
    { id: "mem_obx_own", kind: "membership", orgId: "obx", accountId: "own", role: "owner", active: true, updatedAt: 1 },
    { id: "mem_obx_adm", kind: "membership", orgId: "obx", accountId: "adm", role: "admin", active: true, updatedAt: 1 },
    { id: "mem_obx_crw", kind: "membership", orgId: "obx", accountId: "crw", role: "crew", active: true, updatedAt: 1 }
  ]
};
const noMig = t.migrateStore(JSON.parse(JSON.stringify(noStored)));
ok("nav-order fixture: migrate keeps every customer/quote/job/property/account (zero loss; org without navOrder unaffected)",
  noMig.obx.customers.some(c => c.id === "c1") && noMig.obx.quotes.some(q => q.id === "q1") && noMig.obx.jobs.some(j => j.id === "j1") &&
  noMig.obx.properties.some(p => p.id === "p1") && noMig.jam.customers.some(c => c.id === "jc1") &&
  noMig.users.filter(u => !u.kind).length === 3 && !noMig.registry.find(r => r.id === "obx").navOrder);
// an admin (msgAdminInOrg=true) sets navOrder → it survives the registry LWW merge + a round-trip with zero loss
const noWrite = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX Lot Solutions", navOrder: ["admin", "today", "money"], updatedAt: 20 }] }, noMig, "own");
const noMerged = t.mergeState(noMig, noWrite);
ok("nav-order: an admin's navOrder write survives sanitize + LWW merge", JSON.stringify((noMerged.registry.find(r => r.id === "obx") || {}).navOrder) === JSON.stringify(["admin", "today", "money"]));
ok("nav-order: setting navOrder did NOT drop the org's other data (customers/jobs intact)", noMerged.obx.customers.some(c => c.id === "c1") && noMerged.obx.jobs.some(j => j.id === "j1"));
const noRound = t.mergeState(noMerged, t.projectForUser(noMerged, ["obx", "jam"], { id: "own", superAdmin: true }));   // full round-trip
ok("nav-order: navOrder survives a sync round-trip (re-push) with zero loss", JSON.stringify((noRound.registry.find(r => r.id === "obx") || {}).navOrder) === JSON.stringify(["admin", "today", "money"]) && noRound.obx.customers.some(c => c.id === "c1"));
ok("nav-order: the OTHER org (jam, no navOrder) is unaffected by the migration/round-trip", !(noRound.registry.find(r => r.id === "jam") || {}).navOrder && noRound.jam.customers.some(c => c.id === "jc1"));
// PERMISSION GATE (server is the authority): a CREW member cannot set navOrder
const crewSet = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX Lot Solutions", navOrder: ["admin"], updatedAt: 30 }] }, noMerged, "crw");
ok("nav-order GATE: a crew member's navOrder write is REVERTED to the stored admin-set order", JSON.stringify(crewSet.registry[0].navOrder) === JSON.stringify(["admin", "today", "money"]));
const crewSet2 = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX Lot Solutions", navOrder: ["money"], updatedAt: 31 }] }, noMig, "crw");
ok("nav-order GATE: a crew write is STRIPPED when the org had no prior navOrder (no privileged field leaks in)", !Object.prototype.hasOwnProperty.call(crewSet2.registry[0], "navOrder"));
const crewTabs = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX", tabs: ["today"], updatedAt: 32 }] }, noMig, "crw");
ok("nav-order GATE: the same gate also protects `tabs` (crew cannot set the org's tool set → reverted to stored null)", crewTabs.registry[0].tabs === null);
const admSet = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX", navOrder: ["money", "today"], updatedAt: 33 }] }, noMig, "adm");
ok("nav-order GATE: an ADMIN (manager-tier) CAN set navOrder (write passes through)", JSON.stringify(admSet.registry[0].navOrder) === JSON.stringify(["money", "today"]));
const crewName = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "Renamed by crew", updatedAt: 34 }] }, noMig, "crw");
ok("nav-order GATE: a crew write that does NOT touch navOrder/tabs passes through untouched (non-privileged fields free)", crewName.registry[0].name === "Renamed by crew");

console.log("\n— WORKSHOP (customJobs): migration fixture (zero loss) + seeded Sentinel example + write-authz gate —");
// realistic pre-Workshop store: real data + accounts + memberships, a pre-existing customJob, NO seeded example yet
const wsStored = {
  obx: {
    customers: [{ id: "c1", name: "Acme", updatedAt: 10 }], quotes: [{ id: "q1", num: 1, updatedAt: 10 }],
    jobs: [{ id: "j1", title: "Haul", updatedAt: 10 }], properties: [{ id: "p1", address: "1 Sea", updatedAt: 10 }],
    income: [{ id: "i1", amount: 500, updatedAt: 10 }], expenses: [{ id: "e1", amount: 73, updatedAt: 10 }],
    customJobs: [{ id: "cjob_existing", org: "obx", name: "My quotes check", dataScope: ["quotes"], prompt: "list open quotes", schedule: { kind: "daily", hour: 7, min: 0 }, deliverTo: { mode: "private" }, action: { mode: "report" }, active: true, createdBy: "own", updatedAt: 10, deleted: false }]
  },
  jam: { customers: [{ id: "jc1", name: "Mill", updatedAt: 10 }] },
  registry: [{ id: "obx", name: "OBX Lot Solutions", updatedAt: 5 }, { id: "jam", name: "Jamieson", updatedAt: 5 }],
  users: [
    { id: "own", username: "ray", role: "owner", superAdmin: true, updatedAt: 1 },
    { id: "adm", username: "amy", role: "crew", updatedAt: 1 },
    { id: "crw", username: "joe", role: "crew", updatedAt: 1 },
    { id: "mem_obx_own", kind: "membership", orgId: "obx", accountId: "own", role: "owner", active: true, updatedAt: 1 },
    { id: "mem_obx_adm", kind: "membership", orgId: "obx", accountId: "adm", role: "admin", active: true, updatedAt: 1 },
    { id: "mem_obx_crw", kind: "membership", orgId: "obx", accountId: "crw", role: "crew", active: true, updatedAt: 1 }
  ]
};
const wsMig = t.migrateStore(JSON.parse(JSON.stringify(wsStored)));
ok("customJobs fixture: migrate keeps every customer/quote/job/property/income/expense/account + the pre-existing job (zero loss)",
  wsMig.obx.customers.some(c => c.id === "c1") && wsMig.obx.quotes.some(q => q.id === "q1") && wsMig.obx.jobs.some(j => j.id === "j1") &&
  wsMig.obx.properties.some(p => p.id === "p1") && wsMig.obx.income.some(i => i.id === "i1") && wsMig.obx.expenses.some(e => e.id === "e1") &&
  wsMig.jam.customers.some(c => c.id === "jc1") && wsMig.users.filter(u => !u.kind).length === 3 && wsMig.obx.customJobs.some(j => j.id === "cjob_existing"));
ok("customJobs: every org slab has a customJobs array after migrate", Array.isArray(wsMig.obx.customJobs) && Array.isArray(wsMig.jam.customJobs));
ok("customJobs: the Sentinel EXAMPLE is seeded into obx (example:true, active:false, broadcast — runner skips it)",
  (function () { const ex = wsMig.obx.customJobs.find(j => j.id === "cjob_sentinel_example"); return !!ex && ex.example === true && ex.active === false && ex.deliverTo.mode === "broadcast"; })());
ok("customJobs: jam (no obx) does NOT get the obx example", !wsMig.jam.customJobs.some(j => j.id === "cjob_sentinel_example"));
ok("customJobs: example seed is idempotent (re-migrate does not duplicate it)", t.migrateStore(JSON.parse(JSON.stringify(wsMig))).obx.customJobs.filter(j => j.id === "cjob_sentinel_example").length === 1);
// SYNC ROUND-TRIP: the existing job + the seeded example survive a no-op merge with zero loss
const wsRound = t.mergeState(wsMig, t.projectForUser(wsMig, ["obx", "jam"], { id: "own", superAdmin: true }));
ok("customJobs: a sync round-trip preserves the existing job, the example, AND all business data (zero loss)",
  wsRound.obx.customJobs.some(j => j.id === "cjob_existing") && wsRound.obx.customJobs.some(j => j.id === "cjob_sentinel_example") &&
  wsRound.obx.customers.some(c => c.id === "c1") && wsRound.obx.income.some(i => i.id === "i1"));
// WRITE AUTHZ (sanitizeCustomJobWrites). owner=own, admin=adm, crew=crw (per stored memberships).
const wsNewJob = (over) => Object.assign({ id: "cjob_new", org: "obx", name: "New", dataScope: ["quotes"], prompt: "x", schedule: { kind: "daily", hour: 7, min: 0 }, deliverTo: { mode: "private", threadId: null }, action: { mode: "report" }, model: null, maxRows: null, active: true, createdBy: "x", lastRun: null, createdAt: 50, updatedAt: 50, deleted: false }, over || {});
// crew → dropped entirely
const wsCrew = t.sanitizeCustomJobWrites({ obx: { customJobs: [wsNewJob()] } }, wsMig, "crw");
ok("customJobs GATE: a CREW member's new job is DROPPED server-side", !(wsCrew.obx.customJobs || []).some(j => j.id === "cjob_new"));
// crew editing an existing job → reverted to stored
const wsCrewEdit = t.sanitizeCustomJobWrites({ obx: { customJobs: [Object.assign({}, wsMig.obx.customJobs.find(j => j.id === "cjob_existing"), { prompt: "HACKED", updatedAt: 99 })] } }, wsMig, "crw");
ok("customJobs GATE: a CREW edit of an existing job is REVERTED to the stored record", (wsCrewEdit.obx.customJobs.find(j => j.id === "cjob_existing") || {}).prompt === "list open quotes");
// admin → a plain REPORT job persists
const wsAdmin = t.sanitizeCustomJobWrites({ obx: { customJobs: [wsNewJob()] } }, wsMig, "adm");
ok("customJobs: an ADMIN's plain report job PERSISTS (write passes through)", (wsAdmin.obx.customJobs || []).some(j => j.id === "cjob_new" && j.action.mode === "report"));
// admin → a FINANCE job is coerced safe (finance scope stripped, delivery forced private)
const wsAdminFin = t.sanitizeCustomJobWrites({ obx: { customJobs: [wsNewJob({ id: "cjob_fin", dataScope: ["income", "expenses"], deliverTo: { mode: "broadcast", threadId: null } })] } }, wsMig, "adm");
ok("customJobs GATE: an ADMIN's FINANCE+broadcast job is COERCED (finance scope stripped, delivery → private)",
  (function () { const j = (wsAdminFin.obx.customJobs || []).find(x => x.id === "cjob_fin"); return !!j && j.dataScope.indexOf("income") < 0 && j.dataScope.indexOf("expenses") < 0 && j.deliverTo.mode === "private"; })());
// admin → a BROADCAST (non-finance) job is coerced to private
const wsAdminBcast = t.sanitizeCustomJobWrites({ obx: { customJobs: [wsNewJob({ id: "cjob_bc", deliverTo: { mode: "broadcast", threadId: null } })] } }, wsMig, "adm");
ok("customJobs GATE: an ADMIN's BROADCAST job is coerced to private (broadcast is owner-only)", (wsAdminBcast.obx.customJobs.find(j => j.id === "cjob_bc") || {}).deliverTo.mode === "private");
// admin → a PROPOSE job is coerced to report
const wsAdminProp = t.sanitizeCustomJobWrites({ obx: { customJobs: [wsNewJob({ id: "cjob_pr", action: { mode: "propose" } })] } }, wsMig, "adm");
ok("customJobs GATE: an ADMIN's PROPOSE job is coerced to report (propose is owner-only)", (wsAdminProp.obx.customJobs.find(j => j.id === "cjob_pr") || {}).action.mode === "report");
// owner → finance + broadcast + propose all pass through
const wsOwner = t.sanitizeCustomJobWrites({ obx: { customJobs: [wsNewJob({ id: "cjob_own", dataScope: ["income"], deliverTo: { mode: "private", threadId: null }, action: { mode: "propose" } })] } }, wsMig, "own");
ok("customJobs: an OWNER's finance+propose job PASSES THROUGH unchanged", (function () { const j = wsOwner.obx.customJobs.find(x => x.id === "cjob_own"); return !!j && j.dataScope.indexOf("income") >= 0 && j.action.mode === "propose"; })());
ok("customJobIsFinance / customJobNeedsOwner helpers agree", t.customJobIsFinance({ dataScope: ["income"] }) === true && t.customJobIsFinance({ dataScope: ["jobs"] }) === false && t.customJobNeedsOwner({ dataScope: ["jobs"], deliverTo: { mode: "broadcast" }, action: { mode: "report" } }) === true);
// SCOPED CONTEXT (data-scope + cost cap): only requested collections appear; out-of-scope data is invisible
const wsCtxStore = { registry: [{ id: "obx", name: "OBX Lot Solutions", updatedAt: 1 }], obx: {
  customers: [{ id: "c1", name: "Secret Customer", updatedAt: 1 }],
  quotes: [{ id: "q1", num: 7, cust: "Acme", total: 200, accepted: false, updatedAt: 1 }],
  income: [{ id: "i1", amount: 999, date: "2026-06-01", source: "job", updatedAt: 1 }]
} };
const wsCtx = t.orgAiScopedContext(wsCtxStore, "obx", ["quotes"], { maxRows: 5 });
ok("orgAiScopedContext: includes ONLY the requested scope (quotes present, customers + income absent)",
  wsCtx.indexOf("#7") >= 0 && wsCtx.indexOf("Secret Customer") < 0 && wsCtx.indexOf("999") < 0);
ok("orgAiScopedContext: an empty/garbage scope yields no data sections (safe)", t.orgAiScopedContext(wsCtxStore, "obx", ["bogus"], {}).indexOf("Acme") < 0);
ok("orgAiScopedContext: caps total output at ~6000 chars", t.orgAiScopedContext(wsCtxStore, "obx", ["customers", "quotes", "income"], { maxRows: 200 }).length <= 6000);

console.log("— knowledge (Cap's Playbook) is a synced collection + survives merge with zero loss —");
const kbStored = { obx: { customers: [{ id: "c1", name: "Cust", updatedAt: 10 }], jobs: [{ id: "j1", title: "Job", updatedAt: 10 }], properties: [{ id: "p1", address: "X", updatedAt: 10 }], quotes: [{ id: "q1", updatedAt: 10 }] } };   // legacy: NO knowledge key
const km = t.mergeState(kbStored, { obx: { knowledge: [{ id: "k1", topic: "Currituck", fact: "Free for brush", updatedAt: 5 }] } });
ok("knowledge collection scaffolded on a legacy biz (no knowledge key)", Array.isArray(km.obx.knowledge), Object.keys(km.obx));
ok("knowledge record round-trips through the merge", (km.obx.knowledge.find(x => x.id === "k1") || {}).fact === "Free for brush", km.obx.knowledge);
ok("every pre-existing record survives the knowledge migration (customer/job/property/quote)", !!(km.obx.customers.find(x => x.id === "c1") && km.obx.jobs.find(x => x.id === "j1") && km.obx.properties.find(x => x.id === "p1") && km.obx.quotes.find(x => x.id === "q1")), km.obx);

console.log("— disbursements (account payouts/taxes paid) is a synced collection + survives merge —");
const dm = t.mergeState({ obx: { income: [{ id: "in1", amount: 100, date: "2026-06-01", updatedAt: 10 }] } }, { obx: { disbursements: [{ id: "db1", type: "payout", amount: 50, date: "2026-06-02", updatedAt: 5 }] } });
ok("disbursements scaffolded + record round-trips through the merge", Array.isArray(dm.obx.disbursements) && (dm.obx.disbursements.find(x => x.id === "db1") || {}).type === "payout", dm.obx.disbursements);
ok("income survives the disbursements-collection migration", (dm.obx.income.find(x => x.id === "in1") || {}).amount === 100, dm.obx.income);

console.log("— escape-room scheduler (escapeRooms + escapeBookings) sync collections + zero-loss merge —");
// realistic legacy fixture for a brand-new escape-room org: full prior data, NO escape keys
const esStored = { escaperoom: { customers: [{ id: "ec1", name: "Walk-in", updatedAt: 10 }], jobs: [{ id: "ej1", title: "Party", updatedAt: 10 }], properties: [{ id: "ep1", address: "Main St", updatedAt: 10 }], quotes: [{ id: "eq1", updatedAt: 10 }], income: [{ id: "ei1", amount: 200, updatedAt: 10 }] }, users: [{ id: "ray", role: "owner", superAdmin: true, updatedAt: 1 }] };
const es1 = t.mergeState(esStored, { escaperoom: { escapeRooms: [{ id: "erm-heist", name: "The Heist", color: "#1B2A4E", order: 0, updatedAt: 5 }], escapeBookings: [{ id: "ebk-erm-heist-2026-07-01-10:00", roomId: "erm-heist", date: "2026-07-01", slot: "10:00", status: "booked", party: "Miller", players: "6", guideId: "ray", updatedAt: 5 }] } });
ok("escapeRooms + escapeBookings scaffold on a legacy org (no escape keys)", Array.isArray(es1.escaperoom.escapeRooms) && Array.isArray(es1.escaperoom.escapeBookings), Object.keys(es1.escaperoom));
ok("a room record round-trips through the merge", (es1.escaperoom.escapeRooms.find(x => x.id === "erm-heist") || {}).name === "The Heist", es1.escaperoom.escapeRooms);
ok("a booking record round-trips through the merge", (es1.escaperoom.escapeBookings.find(x => x.id === "ebk-erm-heist-2026-07-01-10:00") || {}).party === "Miller", es1.escaperoom.escapeBookings);
ok("every pre-existing escape-org record survives (customer/job/property/quote/income)", !!(es1.escaperoom.customers.find(x => x.id === "ec1") && es1.escaperoom.jobs.find(x => x.id === "ej1") && es1.escaperoom.properties.find(x => x.id === "ep1") && es1.escaperoom.quotes.find(x => x.id === "eq1") && es1.escaperoom.income.find(x => x.id === "ei1")), es1.escaperoom);
// stable-id LWW: a second device editing the SAME cell upserts, never duplicates; newer status wins
const es2 = t.mergeState(es1, { escaperoom: { escapeBookings: [{ id: "ebk-erm-heist-2026-07-01-10:00", roomId: "erm-heist", date: "2026-07-01", slot: "10:00", status: "in-progress", party: "Miller", players: "6", guideId: "ray", updatedAt: 9 }] } });
ok("booking dedupes by stable id (no duplicate cell)", es2.escaperoom.escapeBookings.filter(x => x.id === "ebk-erm-heist-2026-07-01-10:00").length === 1, es2.escaperoom.escapeBookings);
ok("booking LWW: newer status (in-progress) wins", (es2.escaperoom.escapeBookings.find(x => x.id === "ebk-erm-heist-2026-07-01-10:00") || {}).status === "in-progress", es2.escaperoom.escapeBookings);
ok("never-drop-an-org: escaperoom + its escape collections survive an obx-only push", (function () { const e3 = t.mergeState(es1, { obx: { customers: [{ id: "oc", updatedAt: 6 }] } }); return e3.escaperoom && e3.escaperoom.escapeRooms.find(x => x.id === "erm-heist") && e3.escaperoom.escapeBookings.find(x => x.id === "ebk-erm-heist-2026-07-01-10:00"); })(), null);

console.log("— life tracker (personal org rbjvl): notes/trackers/logs are synced collections + survive a round-trip with zero loss —");
// realistic pre-life-tracker store: obx has real records, a personal org (rbjvl) exists with NO life keys yet
const lifeStored = {
  obx: { customers: [{ id: "c1", name: "Cust", updatedAt: 10 }], jobs: [{ id: "j1", title: "Job", updatedAt: 10 }], quotes: [{ id: "q1", updatedAt: 10 }], properties: [{ id: "p1", address: "X", updatedAt: 10 }] },
  rbjvl: { customers: [], quotes: [], jobs: [] },   // personal org, legacy shape (no life* keys)
  registry: [{ id: "obx", name: "OBX Lot Solutions", updatedAt: 1 }, { id: "rbjvl", name: "Ray — Personal", updatedAt: 1 }],
  users: [{ id: "u1", role: "owner", superAdmin: true, updatedAt: 1 }]
};
const lifeIncoming = { rbjvl: {
  lifeNotes: [{ id: "ln1", date: "2026-06-27", title: "Good day", body: "Shipped the life tracker.", updatedAt: 20 }],
  lifeTrackers: [{ id: "lt1", name: "Workout", type: "check", order: 0, updatedAt: 20 }, { id: "lt2", name: "Weight", type: "number", unit: "lbs", order: 1, updatedAt: 20 }],
  lifeLogs: [{ id: "lg1", trackerId: "lt1", date: "2026-06-27", value: true, updatedAt: 20 }, { id: "lg2", trackerId: "lt2", date: "2026-06-27", value: 182, updatedAt: 20 }]
} };
const lm = t.mergeState(lifeStored, lifeIncoming);
ok("life collections scaffolded on a legacy personal org (no life* keys)", Array.isArray(lm.rbjvl.lifeNotes) && Array.isArray(lm.rbjvl.lifeTrackers) && Array.isArray(lm.rbjvl.lifeLogs), Object.keys(lm.rbjvl));
ok("journal note round-trips through the merge", (lm.rbjvl.lifeNotes.find(x => x.id === "ln1") || {}).title === "Good day", lm.rbjvl.lifeNotes);
ok("both trackers + both daily logs round-trip", lm.rbjvl.lifeTrackers.length === 2 && lm.rbjvl.lifeLogs.length === 2 && (lm.rbjvl.lifeLogs.find(x => x.id === "lg2") || {}).value === 182, lm.rbjvl);
ok("never-drop-an-org: OBX (and every record) survives a personal-org-only push", !!(lm.obx.customers.find(x => x.id === "c1") && lm.obx.jobs.find(x => x.id === "j1") && lm.obx.quotes.find(x => x.id === "q1") && lm.obx.properties.find(x => x.id === "p1")), lm.obx);
// second round-trip (re-push the merged state) → still zero loss, ids stable (no duplication)
const lm2 = t.mergeState(lm, lifeIncoming);
ok("life records are stable across a second round-trip (no loss, no dup)", lm2.rbjvl.lifeNotes.length === 1 && lm2.rbjvl.lifeTrackers.length === 2 && lm2.rbjvl.lifeLogs.length === 2, { n: lm2.rbjvl.lifeNotes.length, t: lm2.rbjvl.lifeTrackers.length, l: lm2.rbjvl.lifeLogs.length });
ok("orgAiContext surfaces the personal org's trackers + journal", (function () { const c = t.orgAiContext(lm, "rbjvl"); return c.indexOf("Life trackers: 2") >= 0 && c.indexOf("Workout") >= 0 && c.indexOf("Good day") >= 0; })());

console.log("— BUDGET BOOKS (P0) migration fixture: pre-books rbjvl budget store survives load() + a sync round-trip with ZERO loss and gains a default Personal book —");
// a realistic PRE-CHANGE rbjvl budget store: cats + tx (incl. sample-marked), NO budgetBooks, NO bookId fields
const bookStored = {
  obx: { customers: [{ id: "c1", name: "Cust", updatedAt: 10 }], jobs: [{ id: "j1", updatedAt: 10 }], quotes: [{ id: "q1", updatedAt: 10 }] },
  rbjvl: {
    customers: [], quotes: [], jobs: [],
    budgetCats: [
      { id: "bgt-cat-pay", name: "Paycheck", kind: "in", target: 3200, order: 0, updatedAt: 10 },
      { id: "bgt-cat-rent", name: "Rent", kind: "out", target: 1200, order: 1, updatedAt: 10 },
      { id: "sample-cat-rbjvl-food", name: "SAMPLE — Groceries", kind: "out", target: 500, order: 2, sample: true, updatedAt: 10 }
    ],
    budgetTx: [
      { id: "bgt-tx-1", date: "2026-06-01", dir: "in", amount: 3200, catId: "bgt-cat-pay", note: "pay", updatedAt: 10 },
      { id: "bgt-tx-2", date: "2026-06-01", dir: "out", amount: 1200, catId: "bgt-cat-rent", note: "rent", updatedAt: 10 },
      { id: "sample-tx-rbjvl-1", date: "2026-06-04", dir: "out", amount: 96.4, catId: "sample-cat-rbjvl-food", note: "SAMPLE — groceries", sample: true, updatedAt: 10 }
    ],
    budgetMemo: [{ id: "bgt-memo-1", key: "harris teeter", catId: "sample-cat-rbjvl-food", updatedAt: 10 }]
  },
  registry: [{ id: "obx", name: "OBX Lot Solutions", updatedAt: 1 }, { id: "rbjvl", name: "Ray — Personal", updatedAt: 1 }],
  users: [{ id: "u1", role: "owner", superAdmin: true, updatedAt: 1 }]
};
const bm = t.migrateStore(JSON.parse(JSON.stringify(bookStored)));
const defBook = "bgt-book-default-rbjvl";
ok("default Personal book is created with the deterministic per-org id", (bm.rbjvl.budgetBooks || []).filter(b => b.id === defBook && b.name === "Personal" && b.kind === "personal").length === 1, bm.rbjvl.budgetBooks);
ok("ALL pre-existing categories survive AND gain the default bookId", bm.rbjvl.budgetCats.length === 3 && bm.rbjvl.budgetCats.every(c => c.bookId === defBook), bm.rbjvl.budgetCats);
ok("ALL pre-existing transactions survive AND gain the default bookId (incl. sample ones)", bm.rbjvl.budgetTx.length === 3 && bm.rbjvl.budgetTx.every(x => x.bookId === defBook), bm.rbjvl.budgetTx);
ok("existing budget data is otherwise UNTOUCHED (amounts/cats/notes preserved)", (bm.rbjvl.budgetTx.find(x => x.id === "bgt-tx-1") || {}).amount === 3200 && (bm.rbjvl.budgetCats.find(x => x.id === "bgt-cat-rent") || {}).target === 1200, bm.rbjvl);
ok("OBX (and every other org's records) survive the budget migration", !!(bm.obx.customers.find(x => x.id === "c1") && bm.obx.jobs.find(x => x.id === "j1") && bm.obx.quotes.find(x => x.id === "q1")), bm.obx);
// migration is idempotent: re-running it must not create a 2nd default book or re-tag (deterministic id)
const bm2 = t.migrateStore(JSON.parse(JSON.stringify(bm)));
ok("budget-books migration is idempotent (no duplicate default book, no re-tag)", (bm2.rbjvl.budgetBooks || []).filter(b => b.id === defBook).length === 1 && bm2.rbjvl.budgetCats.length === 3 && bm2.rbjvl.budgetTx.length === 3, bm2.rbjvl.budgetBooks);
// a full sync round-trip of the migrated store (re-push) must keep everything, ids + bookIds stable
const bmRound = t.mergeState(bm, bm);
ok("ZERO loss after a sync round-trip: books+cats+tx+memo all stable, bookIds intact", bmRound.rbjvl.budgetBooks.length === 1 && bmRound.rbjvl.budgetCats.length === 3 && bmRound.rbjvl.budgetTx.length === 3 && bmRound.rbjvl.budgetMemo.length === 1 && bmRound.rbjvl.budgetCats.every(c => c.bookId === defBook), { books: bmRound.rbjvl.budgetBooks.length, cats: bmRound.rbjvl.budgetCats.length, tx: bmRound.rbjvl.budgetTx.length });
// a transfer between books nets out of income/spending and to zero in combined totals
const xferStore = t.migrateStore(JSON.parse(JSON.stringify(bookStored)));
xferStore.rbjvl.budgetBooks.push({ id: "bgt-book-obxbiz", name: "OBX", kind: "business", order: 1, updatedAt: 11 });
xferStore.rbjvl.budgetTx.push({ id: "x-out", date: "2026-06-10", dir: "out", amount: 500, isTransfer: true, transferId: "xf1", bookId: "bgt-book-obxbiz", xferBookId: defBook, updatedAt: 11 });
xferStore.rbjvl.budgetTx.push({ id: "x-in", date: "2026-06-10", dir: "in", amount: 500, isTransfer: true, transferId: "xf1", bookId: defBook, xferBookId: "bgt-book-obxbiz", updatedAt: 11 });
ok("transfers are EXCLUDED from the orgAiContext income/spending totals (they net to zero in combined)", (function () { const c = t.orgAiContext(xferStore, "rbjvl"); const m = c.match(/combined balance \(all time\): \$([\-\d.]+)/); return m && Math.abs(parseFloat(m[1]) - (3200 - 1296.4)) < 0.01; })(), t.orgAiContext(xferStore, "rbjvl").split("\n").filter(l => l.indexOf("BUDGET") === 0 || l.indexOf("Book ·") === 0));
ok("orgAiContext is per-book aware (lists each book by name)", (function () { const c = t.orgAiContext(xferStore, "rbjvl"); return c.indexOf("Book · Personal") >= 0 && c.indexOf("Book · OBX") >= 0; })());

console.log("— BUDGET P1 (YNAB accounts + envelopes) migration fixture: a P0-shaped books store survives load()+round-trip; accounts/budgets are additive; zero loss; existing cats/tx keep their data + gain nothing harmful —");
// Start from the SAME pre-change P0 store (no budgetAccounts, no budgetBudgets, no rollover field) and prove the
// P1 collections backfill additively, every P0 record survives untouched, and the envelope math is exposed to Cap.
const p1Stored = JSON.parse(JSON.stringify(bookStored));
const p1m = t.migrateStore(JSON.parse(JSON.stringify(p1Stored)));
ok("P1 backfills empty budgetAccounts + budgetBudgets arrays on a P0 budget org", Array.isArray(p1m.rbjvl.budgetAccounts) && p1m.rbjvl.budgetAccounts.length === 0 && Array.isArray(p1m.rbjvl.budgetBudgets) && p1m.rbjvl.budgetBudgets.length === 0, { a: p1m.rbjvl.budgetAccounts, b: p1m.rbjvl.budgetBudgets });
ok("P1 migration does NOT touch existing cats/tx (counts, amounts, targets, ids all intact)", p1m.rbjvl.budgetCats.length === 3 && p1m.rbjvl.budgetTx.length === 3 && (p1m.rbjvl.budgetCats.find(c => c.id === "bgt-cat-rent") || {}).target === 1200 && (p1m.rbjvl.budgetTx.find(x => x.id === "bgt-tx-1") || {}).amount === 3200, p1m.rbjvl);
ok("P1 migration does NOT invent allocations (envelopes start empty — user allocates)", p1m.rbjvl.budgetBudgets.length === 0, p1m.rbjvl.budgetBudgets);
// Now a populated P1 store: an account ($2600), an allocation to Rent ($1200), with a $1200 rent spend already logged.
const thisMo = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");
const prevMo = (function () { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); })();
const yPop = {
  registry: [{ id: "rbjvl", name: "Ray — Personal", updatedAt: 1 }],
  users: [{ id: "u1", role: "owner", superAdmin: true, updatedAt: 1 }],
  rbjvl: {
    customers: [], quotes: [], jobs: [],
    budgetBooks: [{ id: "bgt-book-default-rbjvl", name: "Personal", kind: "personal", order: 0, updatedAt: 1 }],
    budgetCats: [
      { id: "c-rent", name: "Rent", kind: "out", target: 1200, rollover: false, bookId: "bgt-book-default-rbjvl", order: 0, updatedAt: 5 },
      { id: "c-save", name: "Savings", kind: "out", target: 200, rollover: true, bookId: "bgt-book-default-rbjvl", order: 1, updatedAt: 5 },
      { id: "c-pay", name: "Paycheck", kind: "in", bookId: "bgt-book-default-rbjvl", order: 2, updatedAt: 5 }
    ],
    budgetTx: [
      { id: "tx-pay", date: thisMo + "-01", dir: "in", amount: 3200, catId: "c-pay", bookId: "bgt-book-default-rbjvl", updatedAt: 5 },
      { id: "tx-rent", date: thisMo + "-03", dir: "out", amount: 1200, catId: "c-rent", bookId: "bgt-book-default-rbjvl", updatedAt: 5 }
    ],
    budgetAccounts: [{ id: "a-chk", bookId: "bgt-book-default-rbjvl", name: "Checking", type: "checking", balance: 2600, order: 0, updatedAt: 5 }],
    budgetBudgets: [
      { id: "al-rent", bookId: "bgt-book-default-rbjvl", catId: "c-rent", month: thisMo, allocated: 1200, updatedAt: 5 },
      { id: "al-save-prev", bookId: "bgt-book-default-rbjvl", catId: "c-save", month: prevMo, allocated: 200, updatedAt: 5 }   // last month's savings rolls in
    ]
  }
};
const yM = t.migrateStore(JSON.parse(JSON.stringify(yPop)));
const yRound = t.mergeState(yM, yM);
ok("P1 round-trip: accounts + budgets survive with zero loss (ids + balances stable)", yRound.rbjvl.budgetAccounts.length === 1 && (yRound.rbjvl.budgetAccounts[0] || {}).balance === 2600 && yRound.rbjvl.budgetBudgets.length === 2, { a: yRound.rbjvl.budgetAccounts.length, b: yRound.rbjvl.budgetBudgets.length });
const yctx = t.orgAiContext(yM, "rbjvl");
// total cash 2600; envelopes: Rent available = 1200 alloc − 1200 spent = 0; Savings = 200 carry (rollover) + 0 − 0 = 200 ⇒ assigned 200 ⇒ TBB = 2600 − 200 = 2400
ok("orgAiContext exposes total cash + To-Be-Budgeted (cash 2600, envelopes 200 ⇒ TBB 2400)", yctx.indexOf("total cash $2600.00") >= 0 && yctx.indexOf("TO BE BUDGETED $2400.00") >= 0, yctx.split("\n").filter(l => l.indexOf("YNAB combined") === 0));
ok("orgAiContext exposes a reset envelope drained to $0 (Rent: assigned 1200, spent 1200 → available 0)", /Envelope · Rent: available \$0.00/.test(yctx), yctx.split("\n").filter(l => l.indexOf("Envelope · Rent") >= 0));
ok("orgAiContext exposes a rollover envelope's carried balance (Savings available $200 from last month)", /Envelope · Savings: available \$200.00/.test(yctx), yctx.split("\n").filter(l => l.indexOf("Envelope · Savings") >= 0));
ok("orgAiContext exposes age of money (combined)", /Age of money \(combined\): \d+ day/.test(yctx), yctx.split("\n").filter(l => l.indexOf("Age of money") >= 0));

console.log("— BUDGET P2 (contractor tax set-aside) estimator math + migration fixture: a known business net + Ray's profile → expected reserve within tolerance; the tax envelope auto-funds; zero data loss on the round-trip —");
const TaxEst = require("./js/82-tax-estimator");
// MATH: Ray's profile (MFJ, no spouse income, 3 kids) on a known combined annual business net of $60,000.
// SE: 60000*0.9235=55410; SS 55410*0.124=6870.84; Med 55410*0.029=1606.89 ⇒ SE=8477.73, half=4238.865.
// Fed: AGI=60000-4238.865=55761.135; taxable=55761.135-30000=25761.135; bracket: 23850*0.10=2385 + (25761.135-23850)*0.12=229.336 ⇒ 2614.34 before credits; CTC 3*2000=6000 ⇒ federal=0.
// NC: (55761.135-25500)*0.0425=1286.10. Total=8477.73+0+1286.10=9763.83 ⇒ rate=9763.83/60000=16.27%.
const taxEst60 = TaxEst.estimateAnnualTax(60000, { filing: "mfj", spouseIncome: 0, dependents: 3, overrideRate: null });
ok("SE tax on $60k net SE income ≈ $8,477.73 (15.3% on 92.35%, under the SS wage cap)", Math.abs(taxEst60.se - 8477.73) < 0.5, taxEst60.se);
ok("3 child credits ($6,000) wipe out the federal income tax at $60k net (federal = $0)", taxEst60.federal === 0 && Math.abs(taxEst60.childCredit - 6000) < 0.01, { fed: taxEst60.federal, ctc: taxEst60.childCredit });
ok("NC state ≈ $1,286.10 (4.25% flat on AGI − NC std deduction)", Math.abs(taxEst60.state - 1286.10) < 0.5, taxEst60.state);
ok("total estimated tax ≈ $9,763.83 → effective reserve rate ≈ 16.27% (WELL under the 25% fallback — correct)", Math.abs(taxEst60.totalTax - 9763.83) < 1 && Math.abs(taxEst60.effectiveRate - 0.1627) < 0.001, { total: taxEst60.totalTax, rate: taxEst60.effectiveRate });
ok("a manual rate override WINS (open-ended, no floor): 12% on $60k → reserve $7,200", (function () { const e = TaxEst.estimateAnnualTax(60000, { dependents: 3, overrideRate: 0.12 }); return e.effectiveRate === 0.12 && Math.abs(e.reserve - 7200) < 0.01; })());
ok("low net + child credits → very low rate (at $30k net, federal = $0, rate < 16%)", (function () { const e = TaxEst.estimateAnnualTax(30000, { dependents: 3 }); return e.federal === 0 && e.effectiveRate < 0.16 && e.effectiveRate > 0; })());
ok("a loss/zero net reserves $0 (rate 0, no negative reserve)", (function () { const e = TaxEst.estimateAnnualTax(0, { dependents: 3 }); return e.reserve === 0 && e.totalTax === 0; })());
ok("quarterly due-date logic: mid-June → next due is Sep 15", (function () { const d = TaxEst.nextQuarterlyDue("2026-06-27"); return d.label === "Q3" && d.due === "2026-09-15"; })());
ok("quarterly due-date logic: late-Dec rolls to next year's Jan 15", (function () { const d = TaxEst.nextQuarterlyDue("2026-12-20"); return d.label === "Q4" && d.due === "2027-01-15"; })());

// MIGRATION + ENVELOPE FIXTURE: a budget store with a BUSINESS book + a taxProfile record; prove budgetTax survives
// load()+round-trip with zero loss, and that a tax envelope allocation (the auto-fund) is preserved + drives Cap context.
const taxStored = {
  registry: [{ id: "rbjvl", name: "Ray — Personal", updatedAt: 1 }],
  users: [{ id: "u1", role: "owner", superAdmin: true, updatedAt: 1 }],
  rbjvl: {
    customers: [], quotes: [], jobs: [],
    budgetBooks: [
      { id: "bgt-book-default-rbjvl", name: "Personal", kind: "personal", order: 0, updatedAt: 1 },
      { id: "bgt-book-biz", name: "OBX", kind: "business", order: 1, updatedAt: 1 }
    ],
    budgetCats: [
      { id: "c-bizinc", name: "Contract income", kind: "in", bookId: "bgt-book-biz", order: 0, updatedAt: 5 },
      { id: "c-bizexp", name: "Biz expenses", kind: "out", bookId: "bgt-book-biz", order: 1, updatedAt: 5 },
      { id: "bgt-cat-tax-rbjvl", name: "Tax set-aside", kind: "out", rollover: true, taxEnvelope: true, bookId: "bgt-book-default-rbjvl", order: -1, updatedAt: 5 }
    ],
    budgetTx: [
      { id: "btx-in", date: thisMo + "-02", dir: "in", amount: 6000, catId: "c-bizinc", bookId: "bgt-book-biz", updatedAt: 5 },
      { id: "btx-out", date: thisMo + "-05", dir: "out", amount: 3300, catId: "c-bizexp", bookId: "bgt-book-biz", updatedAt: 5 }
    ],
    budgetAccounts: [{ id: "a-chk", bookId: "bgt-book-default-rbjvl", name: "Checking", type: "checking", balance: 4000, order: 0, updatedAt: 5 }],
    budgetBudgets: [{ id: "al-tax", bookId: "bgt-book-default-rbjvl", catId: "bgt-cat-tax-rbjvl", month: thisMo, allocated: 450, updatedAt: 5 }],
    budgetTax: [{ id: "bgt-tax-rbjvl", filing: "mfj", state: "NC", spouseIncome: 0, dependents: 3, overrideRate: null, updatedAt: 5 }]
  }
};
const taxM = t.migrateStore(JSON.parse(JSON.stringify(taxStored)));
ok("P2 backfills an empty budgetTax array on any budget org (additive)", Array.isArray(taxM.rbjvl.budgetTax), taxM.rbjvl.budgetTax);
const taxRound = t.mergeState(taxM, taxM);
ok("P2 round-trip: the taxProfile + tax-envelope allocation survive with ZERO loss (ids + values stable)", taxRound.rbjvl.budgetTax.length === 1 && (taxRound.rbjvl.budgetTax[0] || {}).dependents === 3 && taxRound.rbjvl.budgetBudgets.length === 1 && (taxRound.rbjvl.budgetBudgets[0] || {}).allocated === 450, { tax: taxRound.rbjvl.budgetTax.length, bud: taxRound.rbjvl.budgetBudgets.length });
ok("P2 round-trip: business book + its income/expense tx survive (combined business net intact)", taxRound.rbjvl.budgetBooks.length === 2 && taxRound.rbjvl.budgetTx.length === 2, { books: taxRound.rbjvl.budgetBooks.length, tx: taxRound.rbjvl.budgetTx.length });
const taxCtx = t.orgAiContext(taxM, "rbjvl");
ok("orgAiContext surfaces the tax set-aside status (rate, reserved vs owed, next quarterly due)", taxCtx.indexOf("TAX set-aside (1099, combined)") >= 0 && /reserve rate \d/.test(taxCtx) && taxCtx.indexOf("reserved YTD") >= 0 && /next quarterly due Q\d/.test(taxCtx), taxCtx.split("\n").filter(l => l.indexOf("TAX set-aside") >= 0));
ok("orgAiContext tax line reflects the auto-funded reserve ($450 reserved YTD)", taxCtx.indexOf("reserved YTD $450.00") >= 0, taxCtx.split("\n").filter(l => l.indexOf("TAX set-aside") >= 0));

console.log("— BUDGET v2 (credit-card + debt) fixture: a card spend grows debt + funds the Payment envelope; paying the card reduces debt + the envelope; a debtOnly card's payoff math; zero-loss round-trip; Cap debt line —");
// A populated budget store with: an ACTIVE card (Visa, used) + a charge on it + a payment to it, plus a DEBT-ONLY card (Store).
// Charge $400 on Visa (Food cat had $400 assigned) → Visa live balance = -100 (start) - 400 charge + 250 payment = -250 (owed $250);
// Food envelope funded the charge → Payment: Visa envelope = +400 funded - 250 paid = $150 still set aside.
const ccStored = {
  registry: [{ id: "rbjvl", name: "Ray — Personal", updatedAt: 1 }],
  users: [{ id: "u1", role: "owner", superAdmin: true, updatedAt: 1 }],
  rbjvl: {
    customers: [], quotes: [], jobs: [],
    budgetBooks: [{ id: "bgt-book-default-rbjvl", name: "Personal", kind: "personal", order: 0, updatedAt: 1 }],
    budgetCats: [
      { id: "c-food", name: "Food", kind: "out", rollover: true, bookId: "bgt-book-default-rbjvl", order: 0, updatedAt: 5 },
      { id: "bgt-cat-cardpay-a-visa", name: "Payment: Visa", kind: "out", rollover: true, paymentEnvelope: true, creditAccountId: "a-visa", bookId: "bgt-book-default-rbjvl", order: -2, updatedAt: 5 }
    ],
    budgetTx: [
      { id: "btx-charge", date: thisMo + "-04", dir: "out", amount: 400, catId: "c-food", accountId: "a-visa", bookId: "bgt-book-default-rbjvl", updatedAt: 5 },   // charge on the card
      { id: "btx-pay", date: thisMo + "-20", dir: "out", amount: 250, isCardPayment: true, cardId: "a-visa", accountId: "a-chk", bookId: "bgt-book-default-rbjvl", updatedAt: 5 }   // payment to the card
    ],
    budgetAccounts: [
      { id: "a-chk", bookId: "bgt-book-default-rbjvl", name: "Checking", type: "checking", balance: 3000, order: 0, updatedAt: 5 },
      { id: "a-visa", bookId: "bgt-book-default-rbjvl", name: "Visa", type: "credit", balance: -100, apr: 22.99, minPayment: 35, creditLimit: 5000, debtOnly: false, order: 1, updatedAt: 5 },
      { id: "a-store", bookId: "bgt-book-default-rbjvl", name: "Store Card", type: "credit", balance: -1200, apr: 27.99, minPayment: 50, creditLimit: 2000, debtOnly: true, order: 2, updatedAt: 5 }
    ],
    budgetBudgets: [{ id: "al-food", bookId: "bgt-book-default-rbjvl", catId: "c-food", month: thisMo, allocated: 400, updatedAt: 5 }]
  }
};
const ccM = t.migrateStore(JSON.parse(JSON.stringify(ccStored)));
ok("budget v2 migration is loss-free: every account + tx survives (3 accounts, 2 tx, 2 cats)", ccM.rbjvl.budgetAccounts.length === 3 && ccM.rbjvl.budgetTx.length === 2 && ccM.rbjvl.budgetCats.length === 2, { a: ccM.rbjvl.budgetAccounts.length, tx: ccM.rbjvl.budgetTx.length });
ok("new account fields (apr/minPayment/creditLimit/debtOnly) survive untouched", (function () { const v = ccM.rbjvl.budgetAccounts.find(a => a.id === "a-visa"); const s = ccM.rbjvl.budgetAccounts.find(a => a.id === "a-store"); return v.apr === 22.99 && v.minPayment === 35 && v.creditLimit === 5000 && v.debtOnly === false && s.debtOnly === true && s.apr === 27.99; })(), ccM.rbjvl.budgetAccounts);
const ccRound = t.mergeState(ccM, ccM);
ok("budget v2 round-trip: zero loss (accounts/tx/budgets/cats stable, ids intact)", ccRound.rbjvl.budgetAccounts.length === 3 && ccRound.rbjvl.budgetTx.length === 2 && ccRound.rbjvl.budgetBudgets.length === 1 && !!ccRound.rbjvl.budgetTx.find(x => x.id === "btx-charge" && x.accountId === "a-visa") && !!ccRound.rbjvl.budgetTx.find(x => x.id === "btx-pay" && x.isCardPayment && x.cardId === "a-visa"), ccRound.rbjvl.budgetTx);
// CORE MECHANIC at the data layer: derived live balance = stored − charges + payments (matches the client's budgetAccountBalance).
const liveBal = (store, id) => { const a = store.rbjvl.budgetAccounts.find(x => x.id === id); const tx = store.rbjvl.budgetTx; const charges = tx.filter(t => !t.isTransfer && !t.isCardPayment && t.dir === "out" && t.accountId === id).reduce((s, t) => s + (+t.amount || 0), 0); const pays = tx.filter(t => t.isCardPayment && t.cardId === id).reduce((s, t) => s + (+t.amount || 0), 0); return Math.round(((+a.balance || 0) - charges + pays) * 100) / 100; };
ok("a card spend GROWS the debt: Visa start −$100, +$400 charge → before payment owes $500", (function () { const noPay = JSON.parse(JSON.stringify(ccM)); noPay.rbjvl.budgetTx = noPay.rbjvl.budgetTx.filter(x => !x.isCardPayment); return liveBal(noPay, "a-visa") === -500; })());
ok("paying the card REDUCES the debt: −$500 + $250 payment → live balance −$250 (owes $250)", liveBal(ccM, "a-visa") === -250, liveBal(ccM, "a-visa"));
// payoff math (pure — mirrors client budgetPayoffMonths): store card $1200 @ 27.99% APR, $50/mo → ~ amortization months
const payoffMonths = (balance, aprPct, monthly) => { balance = +balance || 0; if (balance <= 0) return 0; monthly = +monthly || 0; if (monthly <= 0) return null; const r = (+aprPct || 0) / 100 / 12; if (r <= 0) return Math.min(600, Math.ceil(balance / monthly)); if (monthly <= balance * r) return 600; return Math.min(600, Math.max(1, Math.ceil(Math.log(monthly / (monthly - balance * r)) / Math.log(1 + r)))); };
ok("debtOnly payoff math: $1,200 @ 27.99% APR, $50/mo → a finite payoff (~36 months), not a never-ending 600", (function () { const mo = payoffMonths(1200, 27.99, 50); return mo > 30 && mo < 45; })(), payoffMonths(1200, 27.99, 50));
ok("payoff math flags a min that barely covers interest as ~never (600 cap): $1,200 @ 27.99%, $20/mo", payoffMonths(1200, 27.99, 20) === 600, payoffMonths(1200, 27.99, 20));
ok("payoff math with no APR: $1,200 at $100/mo = 12 months flat", payoffMonths(1200, 0, 100) === 12, payoffMonths(1200, 0, 100));
// Cap context: total owed = $250 (Visa) + $1200 (Store) = $1450; highest APR = Store @ 27.99%; min payments = $35 + $50 = $85
const ccCtx = t.orgAiContext(ccM, "rbjvl");
ok("orgAiContext surfaces total debt owed ($1,450 across 2 accounts)", /DEBT \(credit cards\/loans, combined\): total owed \$1450\.00 across 2 account/.test(ccCtx), ccCtx.split("\n").filter(l => l.indexOf("DEBT") === 0));
ok("orgAiContext names the highest-APR card (Store Card @ 27.99%)", ccCtx.indexOf("highest-APR = Store Card @ 27.99%") >= 0, ccCtx.split("\n").filter(l => l.indexOf("DEBT") === 0));
ok("orgAiContext sums total minimum payments ($85.00/mo)", ccCtx.indexOf("total minimum payments $85.00/mo") >= 0, ccCtx.split("\n").filter(l => l.indexOf("DEBT") === 0));

console.log("— BUDGET v2 (recurring bills + historical-average + fund-ahead) fixture: budgetBills survives migration + round-trip; historical-average math; due-this-month + funded-vs-needed; Cap fund-ahead line —");
// month helpers mirroring the client (budgetShiftMonth)
const shiftMo = (mm, dl) => { const p = mm.split("-"); const d = new Date(+p[0], (+p[1] || 1) - 1 + dl, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
const m1 = shiftMo(thisMo, -1), m2 = shiftMo(thisMo, -2), m3 = shiftMo(thisMo, -3);
// A budget store with an Electric category that has 3 prior months of spending ($142.18, $128.40, $171.05),
// a $147 monthly Electric bill due the 15th, plus a Rent bill. Electric envelope funded $100 this month → gap.
const billStored = {
  registry: [{ id: "rbjvl", name: "Ray — Personal", updatedAt: 1 }],
  users: [{ id: "u1", role: "owner", superAdmin: true, updatedAt: 1 }],
  rbjvl: {
    customers: [], quotes: [], jobs: [],
    budgetBooks: [{ id: "bgt-book-default-rbjvl", name: "Personal", kind: "personal", order: 0, updatedAt: 1 }],
    budgetCats: [
      { id: "c-elec", name: "Electric", kind: "out", rollover: true, group: "bill", bookId: "bgt-book-default-rbjvl", order: 0, updatedAt: 5 },
      { id: "c-rent", name: "Rent", kind: "out", rollover: false, group: "bill", bookId: "bgt-book-default-rbjvl", order: 1, updatedAt: 5 }
    ],
    budgetTx: [
      { id: "e1", date: m1 + "-12", dir: "out", amount: 142.18, catId: "c-elec", bookId: "bgt-book-default-rbjvl", updatedAt: 5 },
      { id: "e2", date: m2 + "-12", dir: "out", amount: 128.40, catId: "c-elec", bookId: "bgt-book-default-rbjvl", updatedAt: 5 },
      { id: "e3", date: m3 + "-12", dir: "out", amount: 171.05, catId: "c-elec", bookId: "bgt-book-default-rbjvl", updatedAt: 5 }
    ],
    budgetAccounts: [{ id: "a-chk", bookId: "bgt-book-default-rbjvl", name: "Checking", type: "checking", balance: 3000, order: 0, updatedAt: 5 }],
    budgetBudgets: [
      { id: "al-elec", bookId: "bgt-book-default-rbjvl", catId: "c-elec", month: thisMo, allocated: 100, updatedAt: 5 },
      { id: "al-rent", bookId: "bgt-book-default-rbjvl", catId: "c-rent", month: thisMo, allocated: 1200, updatedAt: 5 }
    ],
    budgetBills: [
      { id: "bgt-bill-elec", bookId: "bgt-book-default-rbjvl", catId: "c-elec", name: "Electric", amount: 147, frequency: "monthly", dueDay: 15, nextDue: "", autoEstimate: true, active: true, updatedAt: 5 },
      { id: "bgt-bill-rent", bookId: "bgt-book-default-rbjvl", catId: "c-rent", name: "Rent", amount: 1200, frequency: "monthly", dueDay: 1, nextDue: "", autoEstimate: false, active: true, updatedAt: 5 }
    ]
  }
};
const billM = t.migrateStore(JSON.parse(JSON.stringify(billStored)));
ok("recurring-bills migration is loss-free: both bills survive + the budgetBills array exists", Array.isArray(billM.rbjvl.budgetBills) && billM.rbjvl.budgetBills.length === 2 && !!billM.rbjvl.budgetBills.find(b => b.id === "bgt-bill-elec" && b.amount === 147 && b.frequency === "monthly"), billM.rbjvl.budgetBills);
ok("category bill-group flag survives migration", (billM.rbjvl.budgetCats.find(c => c.id === "c-elec") || {}).group === "bill", billM.rbjvl.budgetCats);
const billRound = t.mergeState(billM, billM);
ok("recurring-bills round-trip: ZERO loss (2 bills, 2 cats, 3 tx, 2 allocs all stable, fields intact)", billRound.rbjvl.budgetBills.length === 2 && billRound.rbjvl.budgetCats.length === 2 && billRound.rbjvl.budgetTx.length === 3 && billRound.rbjvl.budgetBudgets.length === 2 && (billRound.rbjvl.budgetBills.find(b => b.id === "bgt-bill-elec") || {}).dueDay === 15, { bills: billRound.rbjvl.budgetBills.length, tx: billRound.rbjvl.budgetTx.length });
ok("backfill leaves a budget org with NO bills as an empty array (additive)", (function () { const s = t.migrateStore({ registry: [{ id: "rbjvl", updatedAt: 1 }], rbjvl: { budgetCats: [{ id: "x", bookId: "", updatedAt: 1 }], budgetTx: [], budgetBooks: [] } }); return Array.isArray(s.rbjvl.budgetBills) && s.rbjvl.budgetBills.length === 0; })());
// HISTORICAL AVERAGE (mirrors client budgetHistoryStats over the last N complete months, spend-only)
const histStats = (store, catId, nMonths) => {
  const tx = store.rbjvl.budgetTx.filter(x => !x.deleted && !x.isTransfer);
  const spentOf = mm => Math.round(tx.filter(t => t.catId === catId && t.dir === "out" && String(t.date || "").slice(0, 7) === mm).reduce((s, t) => s + (+t.amount || 0), 0) * 100) / 100;
  const vals = [];
  for (let i = 1; i <= (nMonths || 6); i++) { const v = spentOf(shiftMo(thisMo, -i)); if (v > 0.005) vals.push(v); }
  if (!vals.length) return { avg: 0, min: 0, max: 0, n: 0 };
  return { avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100, min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
};
const eh = histStats(billM, "c-elec", 6);
ok("historical-average of Electric = avg of 3 months ($147.21), min $128.40, max $171.05, n=3", eh.n === 3 && Math.abs(eh.avg - 147.21) < 0.005 && eh.min === 128.40 && eh.max === 171.05, eh);
ok("historical-average ignores the CURRENT (partial) month + months with no spending", histStats(billM, "c-rent", 6).n === 0, histStats(billM, "c-rent", 6));
// DUE-THIS-MONTH + nextDue logic (mirrors client budgetBillNextDue for monthly)
const onDay = (y, m0, day) => { const dim = new Date(y, m0 + 1, 0).getDate(); const dd = Math.min(Math.max(1, day || 1), dim); return y + "-" + String(m0 + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0"); };
const refToday = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0");
const nextDueMonthly = (day) => { const r = new Date(refToday + "T12:00:00"); const c = onDay(r.getFullYear(), r.getMonth(), day); return c >= refToday ? c : onDay(r.getFullYear(), r.getMonth() + 1, day); };
ok("a monthly bill's next due is always today-or-later (rolls forward when the day has passed)", nextDueMonthly(15) >= refToday && nextDueMonthly(1) >= refToday, { d15: nextDueMonthly(15), d1: nextDueMonthly(1) });
// FUNDED-VS-NEEDED (fund-ahead): the Cap line is the cleanest cross-check of the whole pipeline.
// Pin nextDue to TODAY (this month, never already-passed) so the due-this-month fund-ahead math is
// deterministic on EVERY run — a fixed day-of-month (e.g. the 28th) ages out once the real date passes it.
const fixedBills = JSON.parse(JSON.stringify(billStored));
const todayDom = String(new Date().getDate()).padStart(2, "0");
fixedBills.rbjvl.budgetBills = [{ id: "b-fix", bookId: "bgt-book-default-rbjvl", catId: "c-elec", name: "Electric", amount: 147, frequency: "monthly", dueDay: new Date().getDate(), nextDue: thisMo + "-" + todayDom, autoEstimate: false, active: true, updatedAt: 5 }];
const fixedM = t.migrateStore(fixedBills);
const fixedCtx = t.orgAiContext(fixedM, "rbjvl");
const fixedLine = fixedCtx.split("\n").filter(l => l.indexOf("BILLS (fund-ahead") === 0)[0] || "";
// Electric envelope this month: alloc $100, no spend this month → available $100; bill needs $147 → gap $47.
ok("fund-ahead: a $147 bill with $100 set aside → need $147.00, set aside $100.00, FUND THE GAP $47.00", /need \$147\.00; set aside \$100\.00; FUND THE GAP \$47\.00/.test(fixedLine), fixedLine);
// Fully-funded case: bump the allocation to $147 → no gap, "funded ahead".
const fundedFull = JSON.parse(JSON.stringify(fixedBills));
fundedFull.rbjvl.budgetBudgets.find(x => x.id === "al-elec").allocated = 147;
const fullCtx = t.orgAiContext(t.migrateStore(fundedFull), "rbjvl");
ok("fund-ahead: fully-funded bill reports 'every bill is funded ahead' (no gap)", /set aside \$147\.00; every bill is funded ahead/.test(fullCtx.split("\n").filter(l => l.indexOf("BILLS (fund-ahead") === 0)[0] || ""), fullCtx.split("\n").filter(l => l.indexOf("BILLS") === 0));

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

// REGRESSION (crew availability lost on a deploy, 2026-06-27): a CREW self-write of avail must survive the
// FULL write-authz path — scopedIncoming → sanitizeUserWrites(non-owner) → mergeState → projectForUser — and
// come back to the crew. Direct mergeState tests above didn't cover the non-owner sanitizer + the down-projection,
// which is exactly where a future write-authz change could silently drop a self-owned profile field again.
console.log("— REGRESSION: a CREW member's OWN availability survives the full write-authz + projection round-trip —");
(function () {
  const pre = {
    obx: { customers: [] }, jam: { customers: [] },
    registry: [{ id: "obx", name: "OBX", updatedAt: 1 }, { id: "jam", name: "JAM", updatedAt: 1 }],
    users: [
      { id: "owner", username: "ray", passhash: "OH", role: "owner", active: true, avail: { overrides: { "2026-07-01": "full" } }, updatedAt: 1 },
      { id: "crew", username: "joe", passhash: "CH", role: "crew", active: true, avail: { days: [false, true, true, true, true, true, false], start: "08:00", end: "17:00", overrides: { "2026-07-01": "full" } }, updatedAt: 5 },
      { kind: "membership", id: "mo1", accountId: "owner", orgId: "obx", role: "owner", updatedAt: 1 },
      { kind: "membership", id: "mo2", accountId: "owner", orgId: "jam", role: "owner", updatedAt: 1 },
      { kind: "membership", id: "mc1", accountId: "crew", orgId: "obx", role: "crew", updatedAt: 1 },
      { kind: "membership", id: "mc2", accountId: "crew", orgId: "jam", role: "crew", updatedAt: 1 },
      { kind: "roles", id: "__roles__", roles: {}, updatedAt: 1 },
    ],
  };
  const myOrgs = ["obx", "jam"], meRec = pre.users.find(u => u.id === "crew");
  // the crew client edits its OWN avail (touch bumps updatedAt) and pushes its FULL local users array (incl. memberships + the roles sentinel + the owner's record), exactly as the client does
  const crewEdit = JSON.parse(JSON.stringify(meRec));
  crewEdit.avail.overrides["2026-07-20"] = "off";                 // new per-day override
  crewEdit.avail.overrides["2026-07-21"] = { s: "partial", start: "08:00", end: "12:00" };
  crewEdit.avail.days = [false, true, true, true, true, false, false];   // edited base weekly pattern
  crewEdit.updatedAt = 100;
  const pushedUsers = pre.users.map(u => u.id === "crew" ? crewEdit : JSON.parse(JSON.stringify(u)));
  // server /sync path for a NON-owner crew token
  const scoped = t.scopedIncoming({ users: pushedUsers, obx: {}, jam: {} }, myOrgs);
  const sanitized = t.sanitizeUserWrites(scoped, pre, "crew");    // crew is NOT a verified owner → runs the sanitizer
  const merged = t.mergeState(pre, sanitized);
  const projected = t.projectForUser(merged, myOrgs, meRec);      // the ONLY thing /sync returns
  const back = (projected.users || []).find(u => u.id === "crew") || {};
  ok("crew sees its OWN account back in the projection (not dropped)", !!back.id, projected.users.map(u => u.id + (u.kind ? "/" + u.kind : "")));
  ok("crew's NEW per-day override persists (2026-07-20 = off)", back.avail && back.avail.overrides && back.avail.overrides["2026-07-20"] === "off", back.avail);
  ok("crew's partial-day override persists with hours", back.avail && back.avail.overrides && back.avail.overrides["2026-07-21"] && back.avail.overrides["2026-07-21"].s === "partial" && back.avail.overrides["2026-07-21"].start === "08:00", back.avail && back.avail.overrides);
  ok("crew's PRE-EXISTING override is not lost in the same write", back.avail && back.avail.overrides && back.avail.overrides["2026-07-01"] === "full", back.avail);
  ok("crew's edited base weekly pattern persists", back.avail && Array.isArray(back.avail.days) && back.avail.days[5] === false && back.avail.start === "08:00", back.avail);
  // SECURITY: the same self-write must NOT let the crew escalate or touch other accounts
  ok("crew CANNOT escalate role on the avail write", back.role === "crew", back.role);
  ok("crew's passhash is untouched (not dropped, not changed)", back.passhash === "CH", back.passhash);
  const ownerBack = (merged.users || []).find(u => u.id === "owner") || {};
  ok("the owner's record is untouched by the crew's push", ownerBack.role === "owner" && ownerBack.passhash === "OH" && ownerBack.avail.overrides["2026-07-01"] === "full", ownerBack);
  // a malicious crew that tries to revert the owner's avail (push a stale owner record) cannot
  const evil = pre.users.map(u => u.id === "owner" ? Object.assign(JSON.parse(JSON.stringify(u)), { avail: { overrides: {} }, role: "crew", passhash: "HACKED", updatedAt: 999 }) : (u.id === "crew" ? crewEdit : u));
  const evilMerged = t.mergeState(pre, t.sanitizeUserWrites(t.scopedIncoming({ users: evil, obx: {}, jam: {} }, myOrgs), pre, "crew"));
  const ownerAfterEvil = (evilMerged.users || []).find(u => u.id === "owner") || {};
  ok("crew CANNOT wipe the owner's avail / role / passhash even with a newer updatedAt", ownerAfterEvil.role === "owner" && ownerAfterEvil.passhash === "OH" && ownerAfterEvil.avail.overrides["2026-07-01"] === "full", ownerAfterEvil);
})();

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

console.log("— hardened login: scrypt at rest, legacy upgrade-on-login, per-account lockout —");
const sh = t.scryptHash("hunter2");
ok("scryptHash produces a scrypt$ record", t.isScrypt(sh), sh.slice(0, 12));
ok("scryptVerify accepts the right password, rejects the wrong one", t.scryptVerify("hunter2", sh) === true && t.scryptVerify("nope", sh) === false, null);
ok("scryptVerify rejects malformed/legacy/degenerate hashes (incl. empty-hash field that would else match any pw)", t.scryptVerify("x", "deadbeef") === false && t.scryptVerify("x", "scrypt$bad") === false && t.scryptVerify("anything", "scrypt$16384$8$1$" + "ab".repeat(16) + "$") === false, null);
const scStore = { users: [{ id: "u1", username: "Ray", passhash: t.scryptHash("s3cret"), updatedAt: 1 }] };
ok("verifyLogin works on a scrypt account (right pw), rejects wrong pw", (t.verifyLogin(scStore, "ray", "s3cret") || {}).id === "u1" && t.verifyLogin(scStore, "ray", "wrong") === null, null);
const emStore = { users: [{ id: "e1", username: "Ray", email: "ray@jamiesonautomation.com", passhash: t.scryptHash("pw12345678"), updatedAt: 1 }] };
ok("login by USERNAME or EMAIL both work (email case-insensitive); bad identifier rejected", (t.verifyLogin(emStore, "Ray", "pw12345678") || {}).id === "e1" && (t.verifyLogin(emStore, "RAY@JamiesonAutomation.com", "pw12345678") || {}).id === "e1" && t.verifyLogin(emStore, "nobody@x.com", "pw12345678") === null, null);
const legStore = { users: [{ id: "l1", username: "Sha", passhash: t.hashPw("legacy1"), updatedAt: 1 }, { id: "l2", username: "Djb", passhash: t.hashPwFallback("legacy2"), updatedAt: 1 }] };
ok("legacy SHA-256 + djb2 accounts STILL log in (no forced resets)", (t.verifyLogin(legStore, "sha", "legacy1") || {}).id === "l1" && (t.verifyLogin(legStore, "djb", "legacy2") || {}).id === "l2", null);
const upStore = { users: [{ id: "u9", username: "Up", passhash: t.hashPw("pw9"), role: "owner", email: "up@x.com", settings: { theme: "dark" }, updatedAt: 5 }] };
const upgraded = t.maybeUpgradeHash(upStore, "u9", "pw9");
const u9 = upStore.users.find(x => x.id === "u9");
ok("upgrade-on-login: legacy account re-hashed to scrypt, password still verifies, role/email/settings intact", upgraded === true && t.isScrypt(u9.passhash) && t.scryptVerify("pw9", u9.passhash) && u9.role === "owner" && u9.email === "up@x.com" && (u9.settings || {}).theme === "dark", u9 && u9.passhash.slice(0, 8));
ok("upgrade is a no-op on an already-scrypt account", t.maybeUpgradeHash({ users: [{ id: "a", passhash: t.scryptHash("x"), updatedAt: 1 }] }, "a", "x") === false, null);
t.clearFailedLogin("victim");
for (let i = 0; i < 8; i++) t.noteFailedLogin("victim");
ok("account locks after 8 failed attempts (case-insensitive), others unaffected", t.accountLocked("victim") === true && t.accountLocked("VICTIM") === true && t.accountLocked("bystander") === false, null);
t.clearFailedLogin("victim");
ok("a successful login (clearFailedLogin) resets the lock", t.accountLocked("victim") === false, null);

console.log("— password reset: one-time tokens + scrypt set —");
const rstore = { users: [{ id: "rr1", username: "Reset", passhash: t.hashPw("oldpw"), email: "r@x.com", updatedAt: 1 }] };
const rtok = t.makeResetToken("rr1");
const ruid = t.consumeResetToken(rtok);
const ru = rstore.users.find(x => x.id === "rr1");
if (ruid === "rr1") ru.passhash = t.scryptHash("brandnewpw8");   // mirrors the /reset handler's set
ok("reset: valid token -> userId; new scrypt password verifies; old password no longer works", ruid === "rr1" && t.scryptVerify("brandnewpw8", ru.passhash) && !t.scryptVerify("oldpw", ru.passhash), null);
ok("reset token is ONE-TIME (second consume returns null)", t.consumeResetToken(rtok) === null, null);
ok("reset rejects an unknown/empty token", t.consumeResetToken("deadbeef") === null && t.consumeResetToken("") === null, null);

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
ok("availabilityWeek = 14 days (2-week window) with buckets incl. unknown", proj.availabilityWeek.length === 14 && Array.isArray(proj.availabilityWeek[0].available) && Array.isArray(proj.availabilityWeek[0].unknown), proj.availabilityWeek[0]);
ok("view=jobs returns only openJobs (+counts), not crew/quotes", (() => { const p = t.ceoProjection(ceoStore, { view: "jobs" }); return !!p.openJobs && !p.crew && !p.openQuotes; })(), null);
ok("CEO token: correct accepted", t.ceoTokenOk("abc", "abc") === true, null);
ok("CEO token: wrong rejected", t.ceoTokenOk("abc", "xyz") === false, null);
ok("CEO token: empty configured token always rejects (endpoint off)", t.ceoTokenOk("", "") === false && t.ceoTokenOk("x", "") === false, null);
const AR = require("./availability-resolve");
ok("shared resolver: timeoff wins", AR.status({ timeoff: [{ start: "2026-06-20", end: "2026-06-20" }], avail: { days: [true, true, true, true, true, true, true] } }, "2026-06-20") === "timeoff", null);
ok("shared resolver: per-day override wins over baseline", AR.status({ avail: { days: [false, false, false, false, false, false, false], overrides: { "2026-06-20": "full" } } }, "2026-06-20") === "on", null);
ok("shared resolver: partial override", AR.status({ avail: { overrides: { "2026-06-20": "partial" } } }, "2026-06-20") === "partial", null);
ok("shared resolver: no avail set => unknown (gray, NOT assumed available)", AR.status({}, "2026-06-20") === "unknown", null);
ok("shared resolver: baseline workday WITHOUT confirmation => unknown, not auto-green", AR.status({ avail: { days: [true, true, true, true, true, true, true] } }, "2026-06-22") === "unknown", null);
ok("shared resolver: explicit full-day = confirmed available (green)", (function () { var r = AR.resolve({ avail: { overrides: { "2026-06-20": "full" } } }, "2026-06-20"); return r.status === "on" && r.confirmed === true; })(), null);
ok("shared resolver: unconfirmed expected day carries confirmed=false + expected=true", (function () { var r = AR.resolve({ avail: { days: [true, true, true, true, true, true, true] } }, "2026-06-22"); return r.confirmed === false && r.expected === true; })(), null);

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
const rcStore = { obx: { messages: [{ id: "m1", threadId: "t1", senderId: "u1", body: "hi", ts: 1, updatedAt: 1 }] } };
const rc1 = t.ceoSetReceipt(rcStore, "obx", "m1", "received");
ok("receipt: 'received' stamps capReceived + bumps updatedAt", rc1.ok && rcStore.obx.messages[0].capReceived > 0 && rcStore.obx.messages[0].updatedAt > 1, rcStore.obx.messages[0]);
ok("receipt: 'read' stamps capRead (and implies received)", t.ceoSetReceipt(rcStore, "obx", "m1", "read").ok && rcStore.obx.messages[0].capRead > 0 && rcStore.obx.messages[0].capReceived > 0, null);
ok("receipt: unknown message id → ok:false (no crash)", t.ceoSetReceipt(rcStore, "obx", "nope", "read").ok === false, null);
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
// (e) GUIDED PROCESS migration fixture: pre-change resale items (no `type`, no `steps`) survive migrate + a
//     round-trip with ZERO loss; the new intra-record fields are additive and never overwrite legacy data.
const rsLegacy = { obx: { customers: [{ id: "c9", name: "Acme", updatedAt: 5 }], quotes: [{ id: "q9", updatedAt: 5 }], jobs: [{ id: "j9", updatedAt: 5 }], resale: [{ id: "rsOld1", item: "Pre-process dresser", status: "to-list", jobId: "j9", createdAt: 5, updatedAt: 5 }, { id: "rsOld2", item: "Pre-process bike", status: "sold", price: 60, buyer: "Lee", soldDate: "2026-06-01", updatedAt: 5 }] }, jam: {}, users: [{ id: "u9", updatedAt: 5 }] };
const rsMig = t.migrateStore(JSON.parse(JSON.stringify(rsLegacy)));
const rsRound = t.mergeState(rsMig, {});
ok("guided-process migration: every legacy resale item survives migrate + round-trip (zero loss)", (() => { const a = (rsRound.obx.resale || []).filter(r => !r.deleted); return a.length === 2 && a.some(r => r.id === "rsOld1" && r.item === "Pre-process dresser") && a.some(r => r.id === "rsOld2" && r.price === 60 && r.buyer === "Lee"); })(), (rsRound.obx.resale || []).map(r => r.id));
ok("guided-process migration: customers/quotes/jobs/account also survive alongside resale (zero loss)", rsRound.obx.customers.length === 1 && rsRound.obx.quotes.length === 1 && rsRound.obx.jobs.length === 1 && (rsRound.users || []).some(u => u.id === "u9"), null);
ok("guided-process migration: legacy items carry no type/steps and don't fabricate them (additive)", (() => { const r = (rsMig.obx.resale || []).find(x => x.id === "rsOld1") || {}; return r.type === undefined && r.steps === undefined; })(), null);
// (f) the new `type` + `steps` (checklist progress) fields RIDE the record LWW: newer device's checklist + type win, item intact
const rsSteps = t.mergeState(
  { obx: { resale: [{ id: "rsP", item: "Drill", status: "to-list", type: "tools", steps: { photo: true }, updatedAt: 5 }] } },
  { obx: { resale: [{ id: "rsP", item: "Drill", status: "to-list", type: "tools", steps: { photo: true, clean: true, stage: true }, updatedAt: 9 }] } }
);
ok("resale checklist progress (steps{}) + type ride LWW (newer wins, item intact)", (() => { const r = rsSteps.obx.resale.find(x => x.id === "rsP") || {}; return r.type === "tools" && r.steps && r.steps.stage === true && Object.keys(r.steps).length === 3 && r.item === "Drill"; })(), null);

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
const revStore = t.ceoProjection({
  obx: { jobs: [{ id: "j2", title: "Junk haul", crew: ["u1", "u2"], done: true, updatedAt: 5 }], quotes: [{ id: "qPaid", cust: "Virginia Tucker", total: 275, finalPrice: 280, jobId: "j2", accepted: true, invoiced: true, paid: true, updatedAt: 5 }], timeclock: [] },
  jam: {}, users: [{ id: "u1", username: "Ray", role: "owner", updatedAt: 5 }]
}, { view: "ops" });
ok("view=ops exposes revenue for paid jobs (Cap sees money made)", Array.isArray(revStore.revenue) && revStore.revenue.some(r => r.id === "qPaid"), revStore.revenue);
const rev1 = (revStore.revenue || []).find(r => r.id === "qPaid") || {};
ok("view=ops revenue uses finalPrice over quote total + carries job crew", rev1.amount === 280 && rev1.quoted === 275 && Array.isArray(rev1.crew) && rev1.crew.indexOf("u2") >= 0, rev1);
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

console.log("— DM push: a freshly-synced human message tickles its thread (the /sync gate) —");
const _pwNow = 1700000000000;
ok("pushWorthy: new human DM → notify", t.pushWorthy({ id: "m1", threadId: "t1", senderId: "ray", ts: _pwNow }, new Set(), _pwNow) === true, null);
ok("pushWorthy: message already on server → skip (no re-ping)", t.pushWorthy({ id: "m1", threadId: "t1", senderId: "ray", ts: _pwNow }, new Set(["m1"]), _pwNow) === false, null);
ok("pushWorthy: Cap's own post → skip (notified via /api/ceo)", t.pushWorthy({ id: "m2", threadId: "t1", senderId: "__ceo__", ts: _pwNow }, new Set(), _pwNow) === false, null);
ok("pushWorthy: thread/read record → skip (not a message)", t.pushWorthy({ id: "t1", kind: "thread", threadId: "t1", senderId: "ray", ts: _pwNow }, new Set(), _pwNow) === false, null);
ok("pushWorthy: stale/backfilled message → skip", t.pushWorthy({ id: "m3", threadId: "t1", senderId: "ray", ts: _pwNow - 7 * 3600000 }, new Set(), _pwNow) === false, null);

console.log("\n— MESSAGES soft-delete + permission (tombstones ride the messages collection via LWW; non-admin can NEVER tombstone another's message/thread) —");
// realistic pre-change store: obx with a Cap DM thread + two messages (joe's + ray's), a read marker, a thread record.
const msgStored = {
  obx: { customers: [{ id: "mc1", name: "Cust", updatedAt: 1 }], jobs: [{ id: "mj1", title: "Haul", updatedAt: 1 }],
    messages: [
      { id: "thr_cap_joe", kind: "thread", threadId: "thr_cap_joe", title: "Joe ↔ Cap", type: "dm", toStrategy: true, members: ["joe"], createdBy: "joe", deleted: false, updatedAt: 10 },
      { id: "msg_a", threadId: "thr_cap_joe", senderId: "joe", senderLabel: "joe", body: "hi cap", ts: 11, deleted: false, updatedAt: 11 },
      { id: "msg_b", threadId: "thr_cap_joe", senderId: "ray", senderLabel: "ray", body: "owner note", ts: 12, deleted: false, updatedAt: 12 },
      { id: "rd_thr_cap_joe_joe", kind: "read", threadId: "thr_cap_joe", userId: "joe", lastReadTs: 12, updatedAt: 12 },
    ] },
  jam: { customers: [], jobs: [] },
  registry: [{ id: "obx", name: "OBX", updatedAt: 1 }, { id: "jam", name: "Jam", updatedAt: 1 }],
  users: [
    { id: "ray", username: "ray", role: "owner", updatedAt: 1 },
    { id: "joe", username: "joe", role: "crew", updatedAt: 1 },
    { id: "mem_obx_ray", kind: "membership", orgId: "obx", accountId: "ray", role: "owner", active: true, updatedAt: 1 },
    { id: "mem_obx_joe", kind: "membership", orgId: "obx", accountId: "joe", role: "crew", active: true, updatedAt: 1 },
  ],
};
const msgPre = t.migrateStore(JSON.parse(JSON.stringify(msgStored)));   // load() the fixture
ok("messages fixture: every pre-change record survives load() (cust/job/thread/2 msgs/read)", !!(msgPre.obx.customers.find(x => x.id === "mc1") && msgPre.obx.jobs.find(x => x.id === "mj1") && msgPre.obx.messages.length === 4), { n: msgPre.obx.messages.length });
const msgGet = (st, id) => (((st.obx || {}).messages) || []).find(m => m && m.id === id);

// 1) crew joe deletes his OWN message → allowed
const joeOwn = t.sanitizeMessageDeletes({ obx: { messages: [Object.assign({}, msgGet(msgPre, "msg_a"), { deleted: true, updatedAt: 100 })] } }, msgPre, "joe");
ok("crew deletes OWN message → tombstone allowed (deleted:true survives)", msgGet(t.mergeState(msgPre, joeOwn), "msg_a").deleted === true, msgGet(t.mergeState(msgPre, joeOwn), "msg_a"));

// 2) crew joe tries to delete RAY's message → blocked server-side (reverted to stored, NOT deleted)
const joeOther = t.sanitizeMessageDeletes({ obx: { messages: [Object.assign({}, msgGet(msgPre, "msg_b"), { deleted: true, updatedAt: 100 })] } }, msgPre, "joe");
ok("crew deletes ANOTHER's message → BLOCKED (record reverts, stays visible)", msgGet(t.mergeState(msgPre, joeOther), "msg_b").deleted !== true, msgGet(t.mergeState(msgPre, joeOther), "msg_b"));

// 3) owner ray deletes joe's message → allowed (admin may delete any)
const rayAny = t.sanitizeMessageDeletes({ obx: { messages: [Object.assign({}, msgGet(msgPre, "msg_a"), { deleted: true, updatedAt: 100 })] } }, msgPre, "ray");
ok("owner deletes ANY message → tombstone allowed", msgGet(t.mergeState(msgPre, rayAny), "msg_a").deleted === true, msgGet(t.mergeState(msgPre, rayAny), "msg_a"));

// 4) owner deletes the whole thread (+ tombstones its messages) → allowed
const rayThread = t.sanitizeMessageDeletes({ obx: { messages: [
  Object.assign({}, msgGet(msgPre, "thr_cap_joe"), { deleted: true, updatedAt: 100 }),
  Object.assign({}, msgGet(msgPre, "msg_a"), { deleted: true, updatedAt: 100 }),
  Object.assign({}, msgGet(msgPre, "msg_b"), { deleted: true, updatedAt: 100 }),
] } }, msgPre, "ray");
const rayThreadM = t.mergeState(msgPre, rayThread);
ok("owner deletes a THREAD → thread + its messages all tombstoned", msgGet(rayThreadM, "thr_cap_joe").deleted === true && msgGet(rayThreadM, "msg_a").deleted === true && msgGet(rayThreadM, "msg_b").deleted === true, null);

// 5) crew joe tries to delete the thread → blocked (thread reverts, stays alive)
const joeThread = t.sanitizeMessageDeletes({ obx: { messages: [Object.assign({}, msgGet(msgPre, "thr_cap_joe"), { deleted: true, updatedAt: 100 })] } }, msgPre, "joe");
ok("crew deletes a THREAD → BLOCKED (thread reverts, stays alive)", msgGet(t.mergeState(msgPre, joeThread), "thr_cap_joe").deleted !== true, null);

// 6) ZERO loss after a sync round-trip — including the legit tombstone (nothing resurrects, nothing dropped)
const afterDelete = t.mergeState(msgPre, joeOwn);                       // joe's own msg now tombstoned
const round1 = t.mergeState(afterDelete, afterDelete);                  // re-push the merged store
ok("round-trip: every message record survives (4 records, none dropped)", (((round1.obx || {}).messages) || []).length === 4, { n: (((round1.obx || {}).messages) || []).length });
ok("round-trip: the tombstone does NOT resurrect (deleted msg_a stays deleted)", msgGet(round1, "msg_a").deleted === true, msgGet(round1, "msg_a"));
ok("round-trip: NON-deleted messages + thread + read marker all intact", msgGet(round1, "msg_b").deleted !== true && !!msgGet(round1, "thr_cap_joe") && msgGet(round1, "rd_thr_cap_joe_joe").lastReadTs === 12, null);
ok("round-trip: customers/jobs/accounts all survive the message-delete merge", !!(round1.obx.customers.find(x => x.id === "mc1") && round1.obx.jobs.find(x => x.id === "mj1") && round1.users.find(x => x.id === "joe") && round1.users.find(x => x.id === "ray")), null);

// 7) a brand-new tombstone (record not yet on the server) from its sender is allowed (not "another user's")
const newTomb = t.sanitizeMessageDeletes({ obx: { messages: [{ id: "msg_new", threadId: "thr_cap_joe", senderId: "joe", body: "x", ts: 50, deleted: true, updatedAt: 50 }] } }, msgPre, "joe");
ok("new (not-yet-stored) tombstone passes through (nothing to protect)", (((newTomb.obx || {}).messages) || [])[0].deleted === true, null);

// 8) msgAdminInOrg: owner/super-admin = admin; crew = not. (the server permission predicate)
ok("msgAdminInOrg: owner is admin in their org; crew is not", t.msgAdminInOrg(msgPre, "ray", "obx") === true && t.msgAdminInOrg(msgPre, "joe", "obx") === false, null);

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

  console.log("\n— UTF-8 body decode (the ��� bug): Cap/Sentinel POST bodies must survive multibyte chars split across TCP chunks —");
  const EventEmitter = require("events");
  // A fake req that emits the JSON body as TWO raw Buffer chunks, split at an arbitrary BYTE offset
  // (mid-multibyte). This reproduces the exact failure: `body += chunk` utf8-decodes each chunk on its
  // own, so a smart quote (E2 80 99) / em-dash (E2 80 94) / 4-byte emoji straddling the boundary -> ���.
  function feed(json, splitAt) {
    const buf = Buffer.from(json, "utf8");
    const req = new EventEmitter();
    req.destroy = () => {};
    setImmediate(() => { req.emit("data", buf.slice(0, splitAt)); req.emit("data", buf.slice(splitAt)); req.emit("end"); });
    return req;
  }
  const readBody = (req, limit) => new Promise(r => t.readBodyUtf8(req, limit, r));

  // The message Cap sends: a smart quote, a 4-byte emoji, and an em-dash — all in body AND title.
  const capBody = "It’s done 🚀 — crew’s on the way";
  const capTitle = "Cap’s update 🧹 — OBX";
  const payload = JSON.stringify({ biz: "obx", title: capTitle, senderLabel: "Cap", body: capBody, to: "u1", members: ["u1"] });
  const rawBuf = Buffer.from(payload, "utf8");

  // 1) The fix: readBodyUtf8 must reassemble byte-intact regardless of where the chunk boundary falls.
  //    Split mid-rocket-emoji (find the emoji's byte offset and cut one byte into it — the worst case).
  const emojiByte = rawBuf.indexOf(Buffer.from("🚀", "utf8"));
  const decoded = await readBody(feed(payload, emojiByte + 1), 1e5);
  ok("readBodyUtf8 reassembles a body split mid-emoji byte-intact (no ���)", decoded === payload && !decoded.includes("�"), decoded.slice(0, 40));

  // 2) End-to-end through the real CEO message code path: decoded body -> ceoBuildMessage -> stored records.
  const p2 = JSON.parse(decoded);
  const built = t.ceoBuildMessage(p2, { obx: { messages: [] }, users: [{ id: "u1", role: "owner" }] });
  const msgRec = built.records.find(r => !r.kind);
  const thrRec = built.records.find(r => r.kind === "thread");
  ok("CEO message path: body stored byte-intact (smart quote + emoji + em-dash)", msgRec.body === capBody && !msgRec.body.includes("�"), msgRec.body);
  ok("CEO message path: thread TITLE stored byte-intact", thrRec.title === capTitle && !thrRec.title.includes("�"), thrRec.title);
  ok("byte-level proof: stored body == original UTF-8 bytes", Buffer.from(msgRec.body, "utf8").equals(Buffer.from(capBody, "utf8")));

  // 3) ceoBuildProposal (the /api/ceo/propose path, also switched to readBodyUtf8) preserves unicode text.
  const propRaw = JSON.stringify({ biz: "obx", kind: "note", title: "Raise — paver rate 💲", summary: "Margin’s thin — bump it" });
  const propDecoded = await readBody(feed(propRaw, 5), 1e5);   // split early, inside the first multibyte field
  ok("propose path: readBodyUtf8 keeps proposal JSON parseable + intact", propDecoded === propRaw && JSON.parse(propDecoded).title === "Raise — paver rate 💲", propDecoded.slice(0, 30));

  // 4) Negative control — proves the OLD `body += chunk` pattern WAS the bug (would have produced ���).
  function oldBuggyConcat(json, splitAt) { const b = Buffer.from(json, "utf8"); let s = ""; s += b.slice(0, splitAt); s += b.slice(splitAt); return s; }
  const corrupted = oldBuggyConcat(payload, emojiByte + 1);
  ok("control: the old body+=chunk pattern DID corrupt (boundary -> ���) — confirms root cause", corrupted !== payload && corrupted.includes("�"), corrupted.slice(emojiByte - 4, emojiByte + 8));

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
})();
