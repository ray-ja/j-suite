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

console.log("\n— MILEAGE / ODOMETER / GPS (managed truck list + timeclock additive fields): migration fixture (zero loss + legacy defaults) + F-150 seed + vehicles write-authz gate —");
// Realistic PRE-mileage store: legacy timeclock entries with the OLD shape (no stops[]/vehicleId/milesSource;
// a required odoStart per the old blocking flow), plus a no-vehicle-era entry. Two orgs, owner+admin+crew.
const mlStored = {
  obx: {
    customers: [{ id: "c1", name: "Acme", updatedAt: 10 }], jobs: [{ id: "j1", title: "Haul", updatedAt: 10 }],
    timeclock: [
      { id: "tc1", jobId: "j1", userId: "crw", userName: "joe", clockIn: 100, clockOut: 200, inLoc: { lat: 36, lng: -75 }, outLoc: { lat: 36.1, lng: -75.1 }, pings: [], computedMiles: 8.2, miles: 9, milesConfirmed: true, odoStart: 1000, odoEnd: 1009, vehicle: "joe's vehicle", vehicleOwnerId: "crw", rate: 0.725, updatedAt: 10 },
      { id: "tc2", jobId: "j1", userId: "crw", userName: "joe", clockIn: 300, clockOut: 400, inLoc: null, outLoc: null, pings: [], computedMiles: 4.4, miles: null, milesConfirmed: false, odoStart: null, odoEnd: null, vehicle: "ray's vehicle", vehicleOwnerId: "own", rate: 0.725, updatedAt: 10 }
    ]
  },
  jam: { customers: [{ id: "jc1", name: "Mill", updatedAt: 10 }], timeclock: [{ id: "jtc1", jobId: "jj1", userId: "own", clockIn: 1, clockOut: 2, miles: 3, milesConfirmed: true, updatedAt: 10 }] },
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
const mlMig = t.migrateStore(JSON.parse(JSON.stringify(mlStored)));
ok("mileage fixture: migrate keeps EVERY legacy timeclock entry across both orgs (zero loss)",
  mlMig.obx.timeclock.length === 2 && mlMig.obx.timeclock.some(e => e.id === "tc1") && mlMig.obx.timeclock.some(e => e.id === "tc2") && mlMig.jam.timeclock.some(e => e.id === "jtc1"));
ok("mileage fixture: legacy entries keep their existing fields intact (odometer, miles, vehicleOwnerId)",
  (function () { const a = mlMig.obx.timeclock.find(e => e.id === "tc1"); return a.odoStart === 1000 && a.odoEnd === 1009 && a.miles === 9 && a.milesConfirmed === true && a.vehicleOwnerId === "crw"; })());
ok("mileage fixture: customers/jobs/accounts all survive migration (zero loss)",
  mlMig.obx.customers.some(c => c.id === "c1") && mlMig.obx.jobs.some(j => j.id === "j1") && mlMig.jam.customers.some(c => c.id === "jc1") && mlMig.users.filter(u => !u.kind).length === 3);
// F-150 SEED: obx's managed truck list is seeded idempotently with Ray's truck
const obxReg = mlMig.registry.find(r => r.id === "obx");
ok("mileage: obx registry seeded with the F-150 (name + plate, active)",
  Array.isArray(obxReg.vehicles) && obxReg.vehicles.some(v => v.id === "veh_obx_f150" && v.name === "F-150" && v.plate === "LCW-4430" && v.active === true));
ok("mileage: jam gets an (empty) vehicles[] but is NOT seeded with the obx truck",
  Array.isArray(mlMig.registry.find(r => r.id === "jam").vehicles) && mlMig.registry.find(r => r.id === "jam").vehicles.length === 0);
ok("mileage: F-150 seed is IDEMPOTENT (re-migrate does not duplicate it)",
  t.migrateStore(t.migrateStore(mlMig)).registry.find(r => r.id === "obx").vehicles.filter(v => v.id === "veh_obx_f150").length === 1);
// A full sync round-trip preserves every timeclock entry AND the seeded vehicles
const mlRound = t.mergeState(mlMig, t.projectForUser(mlMig, ["obx", "jam"], { id: "own", superAdmin: true }));
ok("mileage: a sync round-trip preserves all timeclock entries + the F-150 vehicle (zero loss)",
  mlRound.obx.timeclock.length === 2 && mlRound.jam.timeclock.some(e => e.id === "jtc1") && mlRound.registry.find(r => r.id === "obx").vehicles.some(v => v.id === "veh_obx_f150"));
// VEHICLES WRITE-AUTHZ GATE (server is the authority): owner/admin can manage the truck list; crew cannot.
const admVeh = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX Lot Solutions", vehicles: [{ id: "veh_obx_f150", name: "F-150", plate: "LCW-4430", active: true }, { id: "veh_x", name: "Dump trailer", active: true }], updatedAt: 40 }] }, mlMig, "own");
ok("mileage GATE: an owner CAN add a vehicle (write passes through)", admVeh.registry[0].vehicles.some(v => v.id === "veh_x"));
const crewVeh = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX Lot Solutions", vehicles: [{ id: "veh_hax", name: "Crew's fake truck", active: true }], updatedAt: 41 }] }, mlMig, "crw");
ok("mileage GATE: a CREW member's vehicles write is REVERTED to the stored (seeded F-150 only) list",
  JSON.stringify(crewVeh.registry[0].vehicles) === JSON.stringify(obxReg.vehicles) && !crewVeh.registry[0].vehicles.some(v => v.id === "veh_hax"));
const mlMerged = t.mergeState(mlMig, admVeh);
ok("mileage GATE: the owner's vehicle add survives the LWW merge without dropping any timeclock data",
  mlMerged.registry.find(r => r.id === "obx").vehicles.some(v => v.id === "veh_x") && mlMerged.obx.timeclock.length === 2);

console.log("\n— CARD LAST-4 AUTO-ATTRIBUTION: businessCards is an owner/admin-only registry field (like vehicles); u.cards is a self-write-only account field —");
// COMPANY CARDS (registry.businessCards) — protected by REG_ADMIN_FIELDS exactly like vehicles/navOrder.
const ownBiz = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX Lot Solutions", businessCards: [{ id: "bc_amex", last4: "3005", label: "Business Amex", active: true }], updatedAt: 60 }] }, noMig, "own");
ok("card GATE: an owner CAN set the org businessCards list (write passes through)", ownBiz.registry[0].businessCards.some(c => c.last4 === "3005"));
const admBiz = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX", businessCards: [{ id: "bc2", last4: "1212", active: true }], updatedAt: 61 }] }, noMig, "adm");
ok("card GATE: an ADMIN (manager-tier) CAN set businessCards (passes through)", admBiz.registry[0].businessCards.some(c => c.last4 === "1212"));
const crwBizStrip = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX", businessCards: [{ id: "hax", last4: "0000" }], updatedAt: 62 }] }, noMig, "crw");
ok("card GATE: a CREW businessCards write is STRIPPED when the org had none (privileged field can't leak in)", !Object.prototype.hasOwnProperty.call(crwBizStrip.registry[0], "businessCards"));
const bizMerged = t.mergeState(noMig, ownBiz);
const crwBizRevert = t.sanitizeRegistryWrites({ registry: [{ id: "obx", name: "OBX", businessCards: [{ id: "hax", last4: "6666" }], updatedAt: 63 }] }, bizMerged, "crw");
ok("card GATE: a CREW businessCards write is REVERTED to the owner-set list (no crew card injected)",
  JSON.stringify(crwBizRevert.registry[0].businessCards) === JSON.stringify(bizMerged.registry.find(r => r.id === "obx").businessCards) && !crwBizRevert.registry[0].businessCards.some(c => c.last4 === "6666"));
// PERSONAL CARDS (u.cards) — a self-write on the caller's OWN account (non-sensitive → passes), but NEVER another user's.
const crwCardsSelf = t.sanitizeUserWrites({ users: [{ id: "crw", username: "joe", role: "crew", cards: [{ id: "cd1", last4: "4242", kind: "personal" }], updatedAt: 50 }] }, noMig, "crw");
const crwSelfOut = crwCardsSelf.users.find(u => u.id === "crw");
ok("card GATE: a crew member CAN save cards to their OWN account (self-write rides S.users LWW)", !!crwSelfOut && Array.isArray(crwSelfOut.cards) && crwSelfOut.cards.some(c => c.last4 === "4242"));
const crwCardsOther = t.sanitizeUserWrites({ users: [{ id: "own", username: "ray", role: "owner", superAdmin: true, cards: [{ id: "hax", last4: "9999", kind: "personal" }], updatedAt: 51 }] }, noMig, "crw");
const ownOtherOut = crwCardsOther.users.find(u => u.id === "own");
ok("card GATE: a crew member CANNOT write ANOTHER user's cards (reverted to stored — no card injected on Ray's account)", !!ownOtherOut && !Object.prototype.hasOwnProperty.call(ownOtherOut, "cards"));

// ARCHIVED is owner-only (SENSITIVE). A verified OWNER bypasses sanitizeUserWrites entirely (handler line ~2221),
// so owner archiving persists; a crew member must not be able to archive anyone via a crafted sync, and an
// archived account must survive the merge with its flag (kept for pay + history — never dropped).
const archPre = { users: [{ id: "own", username: "ray", role: "owner", passhash: "x", updatedAt: 1 }, { id: "crw2", username: "vlad", role: "crew", passhash: "y", updatedAt: 1 }] };
const crwSelfArch = t.sanitizeUserWrites({ users: [{ id: "crw2", username: "vlad", role: "crew", archived: true, updatedAt: 50 }] }, archPre, "crw2");
const crwSelfArchOut = crwSelfArch.users.find(u => u.id === "crw2");
ok("archive GATE: a crew member CANNOT archive themselves via sync (archived reverted — owner-only)", !!crwSelfArchOut && !crwSelfArchOut.archived);
const crwArchOther = t.sanitizeUserWrites({ users: [{ id: "own", username: "ray", role: "owner", archived: true, updatedAt: 60 }] }, archPre, "crw2");
const crwArchOtherOut = crwArchOther.users.find(u => u.id === "own");
ok("archive GATE: a crew member CANNOT archive ANOTHER account (reverted to stored)", !!crwArchOtherOut && !crwArchOtherOut.archived);
const archRT = t.mergeState({ users: [{ id: "own", username: "ray", role: "owner", passhash: "x", updatedAt: 1 }, { id: "gone", username: "vlad", role: "crew", passhash: "y", archived: true, updatedAt: 5 }] }, { users: [] });
const goneRT = archRT.users.find(u => u.id === "gone");
ok("archive: an archived account SURVIVES a sync round-trip with the flag intact (kept for pay + history, never dropped)", !!goneRT && goneRT.archived === true && goneRT.username === "vlad");

// ── SECURITY: identity-field takeover guard + read-side secret stripping (2026-07-12 Fable-review batch) ──
// EMAIL is the password-reset anchor. A shared-token device (verifiedId=null) claiming a victim's id must NOT be
// able to change that account's email (→ reset → takeover), while a per-user token (verifiedId===self) still can.
const emPre = { users: [{ id: "own", username: "ray", role: "owner", passhash: "x", updatedAt: 1 }, { id: "crw3", username: "joe", role: "crew", email: "joe@real.com", passhash: "y", updatedAt: 1 }] };
const emShared = t.sanitizeUserWrites({ users: [{ id: "crw3", username: "joe", role: "crew", email: "attacker@evil.com", updatedAt: 50 }] }, emPre, "crw3", null);   // claimed self, but verifiedId=null (shared token)
const emSharedOut = emShared.users.find(u => u.id === "crw3");
ok("email GUARD: a SHARED-token write (verifiedId=null) CANNOT change the account email (reverted — closes reset-takeover)", !!emSharedOut && emSharedOut.email === "joe@real.com");
const emVerified = t.sanitizeUserWrites({ users: [{ id: "crw3", username: "joe", role: "crew", email: "joe@new.com", updatedAt: 51 }] }, emPre, "crw3", "crw3");   // per-user token: verifiedId === self
const emVerOut = emVerified.users.find(u => u.id === "crw3");
ok("email GUARD: a VERIFIED per-user write (verifiedId===self) CAN change its own email (self-service preserved)", !!emVerOut && emVerOut.email === "joe@new.com");
const emCross = t.sanitizeUserWrites({ users: [{ id: "own", username: "ray", role: "owner", email: "hax@evil.com", updatedAt: 60 }] }, emPre, "crw3", "crw3");   // verified as crw3, but writing OWN(er)'s record
const emCrossOut = emCross.users.find(u => u.id === "own");
ok("email GUARD: a verified user CANNOT change ANOTHER account's email (cross-account write reverted to stored)", !!emCrossOut && emCrossOut.email !== "hax@evil.com");
// Non-sensitive self-writes (availability/phone/title) must still ride the shared-token path (the availability incident).
const emAvail = t.sanitizeUserWrites({ users: [{ id: "crw3", username: "joe", role: "crew", email: "joe@real.com", phone: "252-555-0100", updatedAt: 52 }] }, emPre, "crw3", null);
const emAvailOut = emAvail.users.find(u => u.id === "crw3");
ok("email GUARD is SURGICAL: a shared-token self-write still saves non-identity fields (phone) — availability path intact", !!emAvailOut && emAvailOut.phone === "252-555-0100");
// READ strip: another account's calToken (calendar-feed bearer) must never be projected to a co-member; self keeps it.
const projPre = { users: [{ id: "own", username: "ray", role: "owner", calToken: "OWN-secret", updatedAt: 1 }, { id: "crw3", username: "joe", role: "crew", calToken: "JOE-secret", updatedAt: 1 }, { id: "m1", kind: "membership", accountId: "own", orgId: "obx", role: "owner", active: true }, { id: "m2", kind: "membership", accountId: "crw3", orgId: "obx", role: "crew", active: true }] };
const projected = t.projectUsers(projPre.users, ["obx"], { id: "crw3" });
const projSelf = projected.find(u => u.id === "crw3"), projOther = projected.find(u => u.id === "own");
ok("calToken STRIP: a co-member's calendar-feed token is NOT projected to another user", !!projOther && !Object.prototype.hasOwnProperty.call(projOther, "calToken"));
ok("calToken STRIP: the caller KEEPS their own calToken (own feed URL still works)", !!projSelf && projSelf.calToken === "JOE-secret");

// ── Hosted public invoice page (GET /i/<token> → renderInvoicePage) ──
(function () {
  const biz = { name: "OBX Lot Solutions", phone: "(252) 564-8717", logo: "/assets/logo-obx.png" };
  const cust = { name: "Michelle Brown", company: "OBX Home Pros", email: "m@x.com" };
  const q = { id: "q1", invoiceNo: "INV-1", date: "2026-06-23", invoiced: true, taxable: false, total: 380, items: [{ name: "Junk / move-out", qty: 1, price: 280 }, { name: "Travel", qty: 1, price: 100 }], paymentLink: "https://buy.stripe.com/abc" };
  const html = t.renderInvoicePage(biz, cust, q);
  ok("invoice page: renders the business + invoice no", html.indexOf("OBX Lot Solutions") >= 0 && html.indexOf("INV-1") >= 0);
  ok("invoice page: shows the line items + total ($380)", html.indexOf("Junk / move-out") >= 0 && html.indexOf("$380") >= 0);
  ok("invoice page: shows the Pay-online button when unpaid + linked", /class="pay"[^>]*href="https:\/\/buy\.stripe\.com\/abc"/.test(html) && html.indexOf("Pay online") >= 0);
  ok("invoice page: a PAID invoice shows the PAID stamp, NO pay button", (() => { const h = t.renderInvoicePage(biz, cust, Object.assign({}, q, { paid: true })); return h.indexOf("PAID") >= 0 && h.indexOf('class="pay"') < 0; })());
  ok("invoice page: taxable invoice adds 6.75% sales tax + total due", (() => { const h = t.renderInvoicePage(biz, cust, Object.assign({}, q, { taxable: true })); return h.indexOf("Sales tax (6.75%)") >= 0 && h.indexOf("Total due") >= 0; })());
  ok("invoice page: escapes a customer name (no HTML injection)", t.renderInvoicePage(biz, { name: "<script>x</script>" }, q).indexOf("<script>x") < 0);
})();

// ── Stripe webhook signature verification (the paid-webhook's ONLY auth) ──
(function () {
  const crypto = require("crypto");
  const secret = "whsec_test_123", raw = '{"type":"checkout.session.completed"}';
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(ts + "." + raw).digest("hex");
  ok("verifyStripeSig: a genuine fresh signature VERIFIES", t.verifyStripeSig(raw, "t=" + ts + ",v1=" + sig, secret) === true);
  ok("verifyStripeSig: a wrong secret is REJECTED", t.verifyStripeSig(raw, "t=" + ts + ",v1=" + sig, "whsec_wrong") === false);
  ok("verifyStripeSig: a tampered body is REJECTED", t.verifyStripeSig(raw + " ", "t=" + ts + ",v1=" + sig, secret) === false);
  ok("verifyStripeSig: an OLD timestamp (replay) is REJECTED", t.verifyStripeSig(raw, "t=" + (ts - 100000) + ",v1=" + crypto.createHmac("sha256", secret).update((ts - 100000) + "." + raw).digest("hex"), secret) === false);
  ok("verifyStripeSig: a missing header/secret is REJECTED", t.verifyStripeSig(raw, "", secret) === false && t.verifyStripeSig(raw, "t=" + ts + ",v1=" + sig, "") === false);
})();

// ── Stripe pay-link: form-encoding of the price + payment-link params ──
ok("stripeForm: encodes flat bracketed keys as x-www-form-urlencoded", t.stripeForm({ currency: "usd", unit_amount: "12500", "product_data[name]": "INV-1 · Mike" }) === "currency=usd&unit_amount=12500&product_data%5Bname%5D=INV-1%20%C2%B7%20Mike");
ok("stripeForm: encodes payment-link line items", t.stripeForm({ "line_items[0][price]": "price_abc", "line_items[0][quantity]": "1" }) === "line_items%5B0%5D%5Bprice%5D=price_abc&line_items%5B0%5D%5Bquantity%5D=1");

// ── S6: bootstrap (zero accounts) strips a client-claimed superAdmin, but still creates the account ──
const bootOut = t.sanitizeUserWrites({ users: [{ id: "first", username: "ray", role: "owner", superAdmin: true, updatedAt: 5 }] }, { users: [] }, null, null);
const bootAcct = (bootOut.users || []).find(u => u.id === "first");
ok("bootstrap: the first account is still CREATED (no lockout on first run)", !!bootAcct && bootAcct.username === "ray" && bootAcct.role === "owner");
ok("bootstrap: a client-claimed superAdmin is STRIPPED (platform super-admin is server-assigned only)", !!bootAcct && !bootAcct.superAdmin);

// ── S10: real client IP for rate-limiting (behind Cloudflare) + per-user token TTL ──
ok("clientIp: prefers CF-Connecting-IP (real client behind Cloudflare, not the proxy socket)", t.clientIp({ headers: { "cf-connecting-ip": "203.0.113.9" }, socket: { remoteAddress: "10.0.0.1" } }) === "203.0.113.9");
ok("clientIp: falls back to first x-forwarded-for hop", t.clientIp({ headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }, socket: { remoteAddress: "10.0.0.1" } }) === "198.51.100.7");
ok("clientIp: falls back to the socket when no proxy headers", t.clientIp({ headers: {}, socket: { remoteAddress: "192.0.2.5" } }) === "192.0.2.5");
ok("tokenExpired: a fresh token is NOT expired", t.tokenExpired({ issued: Date.now() }) === false);
ok("tokenExpired: a token older than the TTL IS expired (→ 401 re-login)", t.tokenExpired({ issued: Date.now() - t.TOKEN_TTL_MS - 1000 }) === true);
ok("tokenExpired: a record with no 'issued' is treated as live (legacy, never auto-expired)", t.tokenExpired({ userId: "u1" }) === false);

// TAX-BORROW LEDGER — a per-org docs sentinel (id "taxBorrow", like financeConfig). Must survive a round-trip
// with its borrow/repay entries intact so the running balance is never lost.
const tbRT = t.mergeState({ obx: { docs: [{ id: "taxBorrow", entries: [{ id: "b1", type: "borrow", amount: 500, date: "2026-07-10" }, { id: "r1", type: "repay", amount: 200, date: "2026-07-11" }], updatedAt: 5 }] } }, { obx: { docs: [] } });
const tbDoc = (((tbRT.obx) || {}).docs || []).find(d => d && d.id === "taxBorrow");
ok("tax-borrow ledger doc survives a sync round-trip with borrow + repay entries intact", !!tbDoc && Array.isArray(tbDoc.entries) && tbDoc.entries.length === 2 && tbDoc.entries[0].amount === 500 && tbDoc.entries[1].type === "repay");

// NESTED DUP HEAL — job.materials/expenses ride inside the job record, so mergeColl can't dedupe them. A bulk
// restore can leave two entries with the SAME id in one array (the "duplicate that won't delete"). mergeState
// must collapse them to the NEWEST and bump the job so the clean version propagates to every device.
const dupStored = { obx: { jobs: [
  { id: "jDup", updatedAt: 100, materials: [
    { id: "m1", amount: 34.39, updatedAt: 200, splitGroup: "sg1" },   // the real split slice
    { id: "m1", amount: 114.57 },                                     // the orphan (no updatedAt) — same id
    { id: "m2", amount: 9.99, updatedAt: 150 }                        // a distinct, legit record
  ], expenses: [] },
  { id: "jClean", updatedAt: 300, materials: [{ id: "x1", amount: 5, updatedAt: 50 }], expenses: [] }
] } };
const dupOut = t.mergeState(dupStored, {});
const jd = dupOut.obx.jobs.find(j => j.id === "jDup"), jc = dupOut.obx.jobs.find(j => j.id === "jClean");
// dedupNested heals same-id nested dups (newest wins) BEFORE the hoist promotes them to the jobMaterials collection
// and clears the nested arrays — so the healed records now live in dupOut.obx.jobMaterials, keyed by jobId.
const jmColl = dupOut.obx.jobMaterials || [];
const m1s = jmColl.filter(r => r.jobId === "jDup" && r.id === "m1");
ok("nested dup HEAL: two same-id materials collapse to ONE (the newer $34.39, orphan dropped)", m1s.length === 1 && m1s[0].amount === 34.39, m1s);
ok("nested dup HEAL: distinct records are preserved (m2 survives, hoisted)", jmColl.some(r => r.jobId === "jDup" && r.id === "m2" && r.amount === 9.99), jmColl);
ok("nested dup HEAL: the healed job's updatedAt is bumped (propagates to every device)", jd.updatedAt > 100, jd.updatedAt);
ok("nested dup HEAL: a CLEAN job's material is hoisted intact + updatedAt not needlessly bumped", jc.updatedAt === 300 && jmColl.some(r => r.jobId === "jClean" && r.id === "x1"), jc);
ok("nested dup HEAL: bump is max(nested)+1, NOT server-now (won't clobber a genuine unsynced edit)", jd.updatedAt === 201, jd.updatedAt);
ok("nested dup HEAL: nested arrays cleared after hoist (data lives in the collection now)", (jd.materials || []).length === 0 && (jc.materials || []).length === 0, { jd: jd.materials, jc: jc.materials });

// ARCHIVED accounts cannot log in — accountByName skips them (a departed helper stays in pay/history but no access).
const alStore = { users: [{ id: "a1", username: "vlad", passhash: "x", archived: true }, { id: "a2", username: "chase", passhash: "y" }, { id: "a3", username: "gone", passhash: "z", active: false }] };
ok("archived account is NOT found by login (accountByName skips archived)", t.accountByName(alStore, "vlad") === null);
ok("deactivated (active:false) account still not found by login", t.accountByName(alStore, "gone") === null);
ok("a normal active account still logs in fine", (t.accountByName(alStore, "chase") || {}).id === "a2");
// CLIENT load() defaults (mirror js/02): legacy timeclock entries get stops:[]/nullable odo/derived milesSource,
// + the RIDER-ROLE redesign fields (riderRole/trailerId/rodeWith). We replicate the exact derivation here so the
// server suite proves the client migration is loss-free + sane.
function clientTimeclockDefault(e) {
  if (!Array.isArray(e.stops)) e.stops = [];
  if (e.odoStart === undefined) e.odoStart = null;
  if (e.odoEnd === undefined) e.odoEnd = null;
  if (e.vehicleId === undefined) e.vehicleId = null;
  if (!e.milesSource) { if (e.odoStart != null && e.odoEnd != null) e.milesSource = "odometer"; else if (e.miles != null) e.milesSource = "gps"; else e.milesSource = null; }
  // RIDER ROLE: a legacy entry WITH a vehicle/owner logged the truck's miles ⇒ "driver"; a no-vehicle entry ⇒ "none".
  if (!e.riderRole) e.riderRole = (e.vehicleId || e.vehicleOwnerId || e.vehicle) ? "driver" : "none";
  if (e.trailerId === undefined) e.trailerId = null;
  if (e.rodeWith === undefined) e.rodeWith = null;
  return e;
}
const cd1 = clientTimeclockDefault({ id: "x", odoStart: 1000, odoEnd: 1009, miles: 9, clockOut: 2, vehicle: "joe's vehicle", vehicleOwnerId: "crw" });
ok("client default: an odometer-pair legacy entry derives milesSource=odometer + gets stops[]/vehicleId",
  cd1.milesSource === "odometer" && Array.isArray(cd1.stops) && cd1.stops.length === 0 && cd1.vehicleId === null);
ok("rider-role default: a legacy entry that logged miles (had a vehicle) → riderRole=driver, trailerId/rodeWith null",
  cd1.riderRole === "driver" && cd1.trailerId === null && cd1.rodeWith === null);
const cd2 = clientTimeclockDefault({ id: "y", miles: 4, clockOut: 2 });   // miles set but no odometer/vehicle → gps + driver? no vehicle → none
ok("client default: a miles-only legacy entry (no odometer) derives milesSource=gps", cd2.milesSource === "gps");
const cd3 = clientTimeclockDefault({ id: "z", clockOut: null });   // still open, no miles → null source, nullable odo
ok("client default: an open/no-miles legacy entry gets nullable odometer + milesSource=null (no false provenance)",
  cd3.odoStart === null && cd3.odoEnd === null && cd3.milesSource === null);
ok("rider-role default: a no-vehicle legacy entry → riderRole=none (logs no miles, can't be double-counted)",
  cd3.riderRole === "none");
// EQUIPMENT KIND: the server migration tags every registry vehicle with a kind; legacy + the F-150 → "vehicle".
ok("equipment kind: migration defaults the seeded F-150 to kind=vehicle (carries odometer + reimbursement owner)",
  obxReg.vehicles.find(v => v.id === "veh_obx_f150").kind === "vehicle");
ok("equipment kind: a pre-kind legacy registry vehicle is defaulted to kind=vehicle (idempotent, loss-free)",
  (function () { const s = t.migrateStore({ obx: {}, jam: {}, registry: [{ id: "obx", vehicles: [{ id: "veh_old", name: "Old truck", active: true }], updatedAt: 5 }], users: [] }); const v = s.registry.find(r => r.id === "obx").vehicles.find(x => x.id === "veh_old"); return v.kind === "vehicle"; })());
ok("equipment kind: an admin-added TRAILER (kind=trailer) keeps its kind through migration + sync round-trip",
  (function () {
    const s0 = { obx: {}, jam: {}, registry: [{ id: "obx", vehicles: [{ id: "veh_obx_f150", name: "F-150", plate: "LCW-4430", active: true, kind: "vehicle" }, { id: "veh_trl", name: "Dump trailer", active: true, kind: "trailer" }], updatedAt: 50 }], users: [{ id: "own", role: "owner", superAdmin: true, updatedAt: 1 }] };
    const sm = t.migrateStore(JSON.parse(JSON.stringify(s0)));
    const rt = t.mergeState(sm, t.projectForUser(sm, ["obx"], { id: "own", superAdmin: true }));
    const trl = rt.registry.find(r => r.id === "obx").vehicles.find(v => v.id === "veh_trl");
    return trl && trl.kind === "trailer" && trl.name === "Dump trailer";
  })());
// FULL RIDER-ROLE FIXTURE: a passenger entry (no miles) + a driver entry (miles) survive migration with ZERO loss,
// and the passenger's milesConfirmed/miles stay absent so finance (jobMileageCost keys off miles+milesConfirmed)
// attributes ZERO mileage to the passenger — no double-counting on a shared truck.
const rrStored = {
  obx: {
    customers: [{ id: "c1", name: "Acme", updatedAt: 10 }], jobs: [{ id: "j1", title: "Haul", updatedAt: 10 }],
    timeclock: [
      { id: "drv", jobId: "j1", userId: "own", clockIn: 100, clockOut: 200, riderRole: "driver", vehicleId: "veh_obx_f150", trailerId: "veh_trl", miles: 12, milesConfirmed: true, milesSource: "odometer", odoStart: 1000, odoEnd: 1012, updatedAt: 10 },
      { id: "pax", jobId: "j1", userId: "crw", clockIn: 100, clockOut: 200, riderRole: "passenger", rodeWith: "own", miles: null, milesConfirmed: false, milesSource: null, updatedAt: 10 }
    ]
  },
  jam: {}, registry: [{ id: "obx", vehicles: [{ id: "veh_obx_f150", name: "F-150", active: true, kind: "vehicle" }, { id: "veh_trl", name: "Trailer", active: true, kind: "trailer" }], updatedAt: 5 }],
  users: [{ id: "own", role: "owner", superAdmin: true, updatedAt: 1 }, { id: "crw", role: "crew", updatedAt: 1 }]
};
const rrMig = t.migrateStore(JSON.parse(JSON.stringify(rrStored)));
const rrRound = t.mergeState(rrMig, t.projectForUser(rrMig, ["obx"], { id: "own", superAdmin: true }));
ok("rider-role fixture: driver + passenger entries both survive migration + sync (zero loss)",
  rrRound.obx.timeclock.length === 2 && rrRound.obx.timeclock.some(e => e.id === "drv") && rrRound.obx.timeclock.some(e => e.id === "pax"));
ok("rider-role fixture: the DRIVER keeps its vehicle + trailer + miles (logs the truck's mileage)",
  (function () { const d = rrRound.obx.timeclock.find(e => e.id === "drv"); return d.riderRole === "driver" && d.vehicleId === "veh_obx_f150" && d.trailerId === "veh_trl" && d.miles === 12 && d.milesConfirmed === true; })());
ok("rider-role fixture: the PASSENGER logs ZERO confirmed miles → contributes no mileage cost (no double-counting)",
  (function () { const p = rrRound.obx.timeclock.find(e => e.id === "pax"); return p.riderRole === "passenger" && p.rodeWith === "own" && !p.miles && p.milesConfirmed === false; })());
// finance parity: jobMileageCost sums only confirmed miles → the shared-truck job's mileage = the driver's 12 mi ONLY
ok("rider-role fixture: finance (confirmed-miles sum) counts the shared truck ONCE — driver's 12 mi, passenger 0",
  (function () { const es = rrRound.obx.timeclock.filter(e => e.clockOut && e.milesConfirmed); const mi = es.reduce((s, e) => s + (+e.miles || 0), 0); return mi === 12; })());

console.log("\n— ADMIN-PLANNED JOB ROUTE STOPS (plannedStops[]): additive job field, migration fixture (zero loss) —");
// Realistic PRE-plannedStops store: a legacy job with no plannedStops key at all (every job before this
// feature), alongside a NEW job that already carries an admin-planned 2-stop route (materials supplier,
// then the job site is implicit — the crew page appends it). Both must survive migrateStore + a sync
// round-trip untouched: plannedStops is purely additive to the existing `jobs` collection (no new
// collection, no COLLECTIONS/blank() change needed), so a legacy job must NOT gain the key, and a job
// that already has stops must keep them byte-for-byte (id/label/address/lat/lng).
const psStored = {
  obx: {
    customers: [{ id: "c1", name: "Legacy Cust", updatedAt: 1 }],
    jobs: [
      { id: "jlegacy", title: "Old job, no stops field", customerId: "c1", date: "2026-01-01", updatedAt: 1 },
      { id: "jstops", title: "Paver job — needs base rock", customerId: "c1", date: "2026-06-01", address: "1 Client Rd, Kill Devil Hills, NC", plannedStops: [
        { id: "ps1", label: "Stoneworks — pick up base", address: "200 Stoneworks Rd, Point Harbor, NC", lat: null, lng: null },
        { id: "ps2", label: "Lowe's — sand", address: "1400 S Croatan Hwy, Kill Devil Hills, NC", lat: 36.02, lng: -75.67 }
      ], updatedAt: 1 }
    ]
  },
  jam: {}, users: [{ id: "own", role: "owner", superAdmin: true, updatedAt: 1 }]
};
const psMig = t.migrateStore(JSON.parse(JSON.stringify(psStored)));
const psRound = t.mergeState(psMig, {});   // no-op sync round-trip
ok("plannedStops fixture: both jobs survive migration + round-trip (zero loss)",
  psRound.obx.jobs.length === 2 && !!psRound.obx.jobs.find(j => j.id === "jlegacy") && !!psRound.obx.jobs.find(j => j.id === "jstops"));
ok("plannedStops fixture: a LEGACY job with no plannedStops key is unaffected (stays undefined, not backfilled to something lossy)",
  (function () { const j = psRound.obx.jobs.find(x => x.id === "jlegacy"); return j.plannedStops === undefined; })());
ok("plannedStops fixture: a job's planned route keeps every stop, in order, with label + address + lat/lng intact",
  (function () {
    const j = psRound.obx.jobs.find(x => x.id === "jstops"); const s = (j && j.plannedStops) || [];
    return s.length === 2 && s[0].id === "ps1" && s[0].label === "Stoneworks — pick up base" && s[0].address.indexOf("Stoneworks") >= 0 && s[1].id === "ps2" && s[1].lat === 36.02;
  })());

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

console.log("— RESEARCH library (Data → Research): the `research` collection is synced + survives load()/merge with ZERO loss; a seeded note round-trips; orgs without it get an empty array —");
// realistic PRE-CHANGE store: obx + jam full of real records, NO research key anywhere; a third org (jam) must
// just gain an empty array (no seed). The seeded crew-comp note arrives from another device's push.
const rsStored = {
  obx: { customers: [{ id: "c1", name: "Cust", updatedAt: 10 }], jobs: [{ id: "j1", title: "Job", updatedAt: 10 }], properties: [{ id: "p1", address: "X", updatedAt: 10 }], quotes: [{ id: "q1", updatedAt: 10 }] },   // legacy: NO research key
  jam: { customers: [{ id: "jc1", name: "JamCust", updatedAt: 10 }], jobs: [{ id: "jj1", title: "Install", updatedAt: 10 }], quotes: [{ id: "jq1", updatedAt: 10 }], properties: [{ id: "jp1", address: "Y", updatedAt: 10 }] }
};
const rsNote = { id: "research_crewcomp", title: "Adding crew — comp & legal options (research)", body: "Recommendation: profits-interest LLC members, paid via the field-work split, with vesting.", tags: "crew, comp, legal", createdBy: "__system__", updatedAt: 1, deleted: false };
const rm = t.mergeState(rsStored, { obx: { research: [rsNote] } });
ok("research collection scaffolded on a legacy biz (no research key)", Array.isArray(rm.obx.research), Object.keys(rm.obx));
ok("the seeded crew-comp note round-trips through the merge (title + body intact)", (function () { const r = rm.obx.research.find(x => x.id === "research_crewcomp") || {}; return r.title === rsNote.title && r.body === rsNote.body && r.tags === "crew, comp, legal"; })(), rm.obx.research);
ok("every pre-existing obx record survives the research migration (customer/job/property/quote)", !!(rm.obx.customers.find(x => x.id === "c1") && rm.obx.jobs.find(x => x.id === "j1") && rm.obx.properties.find(x => x.id === "p1") && rm.obx.quotes.find(x => x.id === "q1")), rm.obx);
ok("an org WITHOUT the seed survives + gets an empty research array (jam: no note, all records intact)", (function () { return Array.isArray(rm.jam.research) && rm.jam.research.length === 0 && rm.jam.customers.find(x => x.id === "jc1") && rm.jam.jobs.find(x => x.id === "jj1") && rm.jam.quotes.find(x => x.id === "jq1") && rm.jam.properties.find(x => x.id === "jp1"); })(), rm.jam);
// stable-id LWW: a re-seed on a fresh device (same id, updatedAt:1) dedupes — never duplicates the note
const rm2 = t.mergeState(rm, { obx: { research: [rsNote] } });
ok("research note dedupes by stable id across a re-push (no duplicate)", rm2.obx.research.filter(x => x.id === "research_crewcomp").length === 1, rm2.obx.research);
ok("never-drop-an-org: jam (+ every record) survives an obx-only research push", !!(rm.jam.customers.find(x => x.id === "jc1") && rm.jam.jobs.find(x => x.id === "jj1")), rm.jam);

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
ok("job.expenses hoist to jobExpenses collection (both lines present; job title/crew intact; nested cleared)", (() => { const j = exA.obx.jobs.find(x => x.id === "j1") || {}; const je = (exA.obx.jobExpenses || []).filter(e => e.jobId === "j1" && !e.deleted); return je.length === 2 && je.some(e => e.cat === "mileage" && e.miles === 20 && e.amount === 14.5) && j.title === "Wash" && (j.crew || []).length === 1 && (j.expenses || []).length === 0; })(), exA.obx.jobExpenses);
// (b) pre-expenses job (no expenses array) round-trips zero-loss — backward compatible
ok("pre-expenses job (no expenses array) round-trips zero-loss (backward compatible)", (() => { const m = t.mergeState({ obx: { jobs: [{ id: "j7", title: "Old", done: false, updatedAt: 5 }] } }, {}); const j = m.obx.jobs.find(x => x.id === "j7") || {}; return j.title === "Old" && !("expenses" in j); })(), null);
// (c) deleting an expense line is now a TOMBSTONE (deleted:true) on the collection element — element-level LWW,
// NOT delete-by-omission (which would resurrect the line off a stale device — the whole reason for the migration).
ok("deleting an expense line = TOMBSTONE (deleted:true wins element-wise; the other line lives; no resurrect)", (() => {
  const m = t.mergeState(
    { obx: { jobs: [{ id: "j8", updatedAt: 5 }], jobExpenses: [{ id: "e1", jobId: "j8", cat: "misc", amount: 5, updatedAt: 5 }, { id: "e2", jobId: "j8", cat: "misc", amount: 9, updatedAt: 5 }] } },
    { obx: { jobExpenses: [{ id: "e1", jobId: "j8", cat: "misc", amount: 5, deleted: true, updatedAt: 9 }] } });
  const je = (m.obx.jobExpenses || []).filter(e => e.jobId === "j8");
  const e1 = je.find(e => e.id === "e1"), e2 = je.find(e => e.id === "e2");
  return e1 && e1.deleted === true && e2 && !e2.deleted && e2.amount === 9;
})(), null);

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

console.log("\n— Cap receipt vision (rcptParseSuggestion): Phase 4 last4 / refund / deposit —");
const rpsCats = ["materials", "rentals", "fuel"];
const rpsJobs = ["job_a", "job_b"];
// baseline reply the model would return before Phase 4 (no last4/refund/deposit keys)
const rpsBase = t.rcptParseSuggestion('{"vendor":"Home Depot","amount":38.94,"date":"2026-07-06","desc":"pavers","type":"pass-through","category":"materials","jobId":"job_a","confidence":0.8}', rpsCats, rpsJobs);
ok("existing suggestion fields unchanged (vendor/amount/type/category/jobId/confidence)", rpsBase && rpsBase.vendor === "Home Depot" && rpsBase.amount === 38.94 && rpsBase.type === "pass-through" && rpsBase.category === "materials" && rpsBase.jobId === "job_a" && rpsBase.confidence === 0.8, rpsBase);
ok("defaults when the 3 new keys are absent → last4 null, refund false, deposit false (today's behavior)", rpsBase && rpsBase.last4 === null && rpsBase.refund === false && rpsBase.deposit === false, rpsBase);
// last4 extraction + clamp
const rpsL4 = t.rcptParseSuggestion('{"vendor":"Sunbelt","amount":300,"last4":"2469","type":"job-expense","category":"rentals"}', rpsCats, rpsJobs);
ok("extracts a valid 4-digit last4", rpsL4 && rpsL4.last4 === "2469", rpsL4);
ok("clamps a non-4-digit last4 (\"123\") to null", t.rcptParseSuggestion('{"vendor":"x","last4":"123"}', rpsCats, rpsJobs).last4 === null, null);
ok("clamps a numeric (non-string) last4 to null", t.rcptParseSuggestion('{"vendor":"x","last4":2469}', rpsCats, rpsJobs).last4 === null, null);
ok("clamps a masked last4 (\"**1234\") to null (not 4 bare digits)", t.rcptParseSuggestion('{"vendor":"x","last4":"**1234"}', rpsCats, rpsJobs).last4 === null, null);
// refund + deposit booleans (strict === true)
ok("refund:true → refund true", t.rcptParseSuggestion('{"vendor":"x","refund":true}', rpsCats, rpsJobs).refund === true, null);
ok("refund non-boolean (\"yes\") → refund false (strict === true)", t.rcptParseSuggestion('{"vendor":"x","refund":"yes"}', rpsCats, rpsJobs).refund === false, null);
ok("deposit:true → deposit true", t.rcptParseSuggestion('{"vendor":"x","deposit":true}', rpsCats, rpsJobs).deposit === true, null);
ok("deposit:1 (truthy non-bool) → deposit false (strict === true)", t.rcptParseSuggestion('{"vendor":"x","deposit":1}', rpsCats, rpsJobs).deposit === false, null);
// PRIMARY REFERENCE NUMBER (js/72 "Ref #" column) — order/contract/invoice/transaction/rental #
ok("absent refNo/refType → null (today's behavior)", rpsBase && rpsBase.refNo === null && rpsBase.refType === null, rpsBase);
// a rental CONTRACT: Cap returns the CONTRACT # (186510) as the primary ref, not the transaction/rental id
const rpsRefRental = t.rcptParseSuggestion('{"vendor":"The Home Depot","amount":72.59,"date":"2026-07-06","desc":"Vibratory Plate Compactor","type":"job-expense","category":"rentals","refNo":"186510","refType":"contract"}', rpsCats, rpsJobs);
ok("rental contract → refNo '186510' (the contract #, primary reference)", rpsRefRental && rpsRefRental.refNo === "186510", rpsRefRental);
ok("rental contract → refType 'contract'", rpsRefRental && rpsRefRental.refType === "contract", rpsRefRental);
// a store receipt order # is kept as-is
ok("store receipt Order # '147424942' → refNo intact, refType 'order'", (function () { var r = t.rcptParseSuggestion('{"vendor":"Lowe\'s","amount":38,"refNo":"147424942","refType":"order"}', rpsCats, rpsJobs); return r.refNo === "147424942" && r.refType === "order"; })(), null);
// an alphanumeric invoice ref keeps its letters + dashes
ok("invoice ref 'INV-2024-118' keeps letters + dash", t.rcptParseSuggestion('{"vendor":"x","refNo":"INV-2024-118"}', rpsCats, rpsJobs).refNo === "INV-2024-118", null);
// clamp: junk chars stripped, length capped at 40
ok("garbage/long ref clamped (junk stripped, ≤40 chars)", (function () { var r = t.rcptParseSuggestion('{"vendor":"x","refNo":"##Contract*/ 1234567890123456789012345678901234567890EXTRA"}', rpsCats, rpsJobs); return typeof r.refNo === "string" && r.refNo.length <= 40 && !/[#*\/]/.test(r.refNo); })(), t.rcptParseSuggestion('{"vendor":"x","refNo":"##Contract*/ 1234567890123456789012345678901234567890EXTRA"}', rpsCats, rpsJobs).refNo);
ok("non-string refNo (number) → null", t.rcptParseSuggestion('{"vendor":"x","refNo":186510}', rpsCats, rpsJobs).refNo === null, null);
ok("unknown refType → null", t.rcptParseSuggestion('{"vendor":"x","refNo":"A1","refType":"purchase-order"}', rpsCats, rpsJobs).refType === null, null);
// a statement fan-out transaction can carry its own refNo
ok("transaction-level refNo clamped + kept", (function () { var r = t.rcptParseSuggestion('{"vendor":"Bank","transactions":[{"vendor":"Shell","amount":40,"type":"job-expense","refNo":"TXN-9910"}]}', rpsCats, rpsJobs); return r.transactions.length === 1 && r.transactions[0].refNo === "TXN-9910"; })(), null);
// a malformed reply still returns null (unchanged — a bad reply is never applied)
ok("malformed reply (no JSON object) still returns null", t.rcptParseSuggestion("sorry, I can't read that", rpsCats, rpsJobs) === null, null);
ok("broken JSON still returns null", t.rcptParseSuggestion('{"vendor":"x", "last4":', rpsCats, rpsJobs) === null, null);

console.log("\n— Cap SPLIT suggestion (rcptParseSuggestion.splits): only a genuine ≥2-bucket MIX, balanced to total —");
// today's behavior: a reply with NO splits key → splits:[] (an all-materials receipt stays one bucket)
ok("no splits key → splits:[] (single categorization, today's behavior)", Array.isArray(rpsBase.splits) && rpsBase.splits.length === 0, rpsBase.splits);
ok("explicit empty splits array → splits:[]", t.rcptParseSuggestion('{"vendor":"x","amount":50,"splits":[]}', rpsCats, rpsJobs).splits.length === 0, null);
// a valid 2-bucket split (materials $120 + tool $80, sum 200 == amount 200) → returned intact
const rpsSplit = t.rcptParseSuggestion('{"vendor":"Home Depot","amount":200,"type":"pass-through","category":"materials","splits":[{"amount":120,"type":"pass-through","category":"materials","note":"pavers"},{"amount":80,"type":"business","category":"tools/equipment","note":"tamper"}]}', rpsCats.concat(["materials", "tools/equipment"]), rpsJobs);
ok("valid 2-bucket balanced split (120+80==200) → 2 entries returned", rpsSplit && rpsSplit.splits.length === 2 && rpsSplit.splits[0].amount === 120 && rpsSplit.splits[1].amount === 80, rpsSplit && rpsSplit.splits);
ok("split entry types survive (pass-through + business)", rpsSplit.splits[0].type === "pass-through" && rpsSplit.splits[1].type === "business", rpsSplit.splits);
ok("split entry category clamped to allowed set (materials / tools/equipment)", rpsSplit.splits[0].category === "materials" && rpsSplit.splits[1].category === "tools/equipment", rpsSplit.splits);
ok("split entry note is a string (≤120)", typeof rpsSplit.splits[0].note === "string" && rpsSplit.splits[0].note === "pavers", rpsSplit.splits);
// UNBALANCED (sum 150 ≠ amount 200) → dropped to []
ok("unbalanced split (120+30=150 ≠ 200 total) → dropped to []", t.rcptParseSuggestion('{"vendor":"x","amount":200,"splits":[{"amount":120,"type":"pass-through"},{"amount":30,"type":"business"}]}', rpsCats.concat(["materials", "tools/equipment"]), rpsJobs).splits.length === 0, null);
// a single-entry split is not a MIX → []
ok("1-entry split (not a real mix) → dropped to []", t.rcptParseSuggestion('{"vendor":"x","amount":200,"splits":[{"amount":200,"type":"pass-through"}]}', rpsCats, rpsJobs).splits.length === 0, null);
// garbage / non-array splits → []
ok("non-array splits (\"foo\") → []", t.rcptParseSuggestion('{"vendor":"x","amount":50,"splits":"foo"}', rpsCats, rpsJobs).splits.length === 0, null);
ok("splits with garbage entries (bad type / non-numeric amount) drop to <2 valid → []", t.rcptParseSuggestion('{"vendor":"x","amount":100,"splits":[{"amount":"abc","type":"pass-through"},{"amount":50,"type":"nope"},{"amount":100,"type":"business"}]}', rpsCats.concat(["tools/equipment"]), rpsJobs).splits.length === 0, null);
// a bad category inside an otherwise-valid split entry → clamped to "" (entry kept, not dropped)
const rpsBadCat = t.rcptParseSuggestion('{"vendor":"x","amount":100,"splits":[{"amount":60,"type":"pass-through","category":"materials"},{"amount":40,"type":"business","category":"NOT_A_CAT"}]}', rpsCats.concat(["materials"]), rpsJobs);
ok("bad split category clamped to \"\" (entry retained, balanced 60+40==100)", rpsBadCat.splits.length === 2 && rpsBadCat.splits[1].category === "", rpsBadCat && rpsBadCat.splits);
// within tolerance (±$0.05): 120 + 79.97 = 199.97 vs 200 → still balanced
ok("split within $0.05 tolerance (199.97 vs 200) → kept", t.rcptParseSuggestion('{"vendor":"x","amount":200,"splits":[{"amount":120,"type":"pass-through"},{"amount":79.97,"type":"business"}]}', rpsCats, rpsJobs).splits.length === 2, null);
// existing fields still intact when a split is present
ok("existing fields unchanged when splits present (vendor/amount/type)", rpsSplit.vendor === "Home Depot" && rpsSplit.amount === 200 && rpsSplit.type === "pass-through", rpsSplit);

console.log("\n— Cap LINE-ITEM extraction (rcptParseSuggestion.lineItems): per-PRODUCT rows, KEPT even on sum-mismatch —");
// absent lineItems key on prior fixtures → lineItems:[] (additive; every earlier field byte-identical)
ok("no lineItems key → lineItems:[] (additive default)", Array.isArray(rpsBase.lineItems) && rpsBase.lineItems.length === 0, rpsBase.lineItems);
ok("base reply: splits + all prior fields unchanged alongside lineItems", rpsBase.splits.length === 0 && rpsBase.vendor === "Home Depot" && rpsBase.amount === 38.94 && rpsBase.type === "pass-through" && rpsBase.category === "materials" && rpsBase.jobId === "job_a" && rpsBase.last4 === null && rpsBase.refund === false && rpsBase.deposit === false, rpsBase);
ok("explicit empty lineItems array → lineItems:[]", t.rcptParseSuggestion('{"vendor":"x","amount":50,"lineItems":[]}', rpsCats, rpsJobs).lineItems.length === 0, null);
ok("non-array lineItems (\"foo\") → lineItems:[]", t.rcptParseSuggestion('{"vendor":"x","amount":50,"lineItems":"foo"}', rpsCats, rpsJobs).lineItems.length === 0, null);
// a valid 4-line receipt (fabric/sand/rock = pass-through/job-expense + impact driver = business), summing to 170
const rpsLi = t.rcptParseSuggestion('{"vendor":"Home Depot","amount":170,"type":"pass-through","category":"materials","lineItems":[{"desc":"landscape fabric","amount":20,"bucket":"pass-through"},{"desc":"sand","amount":30,"bucket":"pass-through"},{"desc":"disposal","amount":40,"bucket":"job-expense"},{"desc":"impact driver","amount":80,"bucket":"business"}]}', rpsCats, rpsJobs);
ok("valid 4-line lineItems → 4 entries kept", rpsLi && rpsLi.lineItems.length === 4, rpsLi && rpsLi.lineItems);
ok("line desc + amount survive", rpsLi.lineItems[0].desc === "landscape fabric" && rpsLi.lineItems[0].amount === 20 && rpsLi.lineItems[3].amount === 80, rpsLi.lineItems);
ok("line buckets survive (pass-through / job-expense / business)", rpsLi.lineItems[0].bucket === "pass-through" && rpsLi.lineItems[2].bucket === "job-expense" && rpsLi.lineItems[3].bucket === "business", rpsLi.lineItems);
ok("prior fields untouched when lineItems present (vendor/amount/type)", rpsLi.vendor === "Home Depot" && rpsLi.amount === 170 && rpsLi.type === "pass-through", rpsLi);
// bad / missing bucket → defaulted to pass-through (NOT dropped)
const rpsLiBad = t.rcptParseSuggestion('{"vendor":"x","amount":50,"lineItems":[{"desc":"mystery","amount":50,"bucket":"NOPE"}]}', rpsCats, rpsJobs);
ok("bad bucket → defaulted to pass-through (entry kept)", rpsLiBad.lineItems.length === 1 && rpsLiBad.lineItems[0].bucket === "pass-through", rpsLiBad.lineItems);
ok("missing bucket → defaulted to pass-through", t.rcptParseSuggestion('{"vendor":"x","amount":10,"lineItems":[{"desc":"nails","amount":10}]}', rpsCats, rpsJobs).lineItems[0].bucket === "pass-through", null);
// amount ≤0 / non-numeric entries dropped; valid ones retained
const rpsLiDrop = t.rcptParseSuggestion('{"vendor":"x","amount":25,"lineItems":[{"desc":"good","amount":25,"bucket":"pass-through"},{"desc":"zero","amount":0,"bucket":"business"},{"desc":"neg","amount":-5,"bucket":"business"},{"desc":"nan","amount":"abc","bucket":"business"}]}', rpsCats, rpsJobs);
ok("amount ≤0 / non-numeric line entries dropped, valid kept", rpsLiDrop.lineItems.length === 1 && rpsLiDrop.lineItems[0].desc === "good", rpsLiDrop.lineItems);
// sum-mismatch: UNLIKE splits, lineItems are KEPT (client reconciles per line)
const rpsLiMismatch = t.rcptParseSuggestion('{"vendor":"x","amount":200,"lineItems":[{"desc":"partial a","amount":50,"bucket":"pass-through"},{"desc":"partial b","amount":30,"bucket":"business"}]}', rpsCats, rpsJobs);
ok("sum-mismatch lineItems (50+30 ≠ 200) → STILL KEPT (unlike splits)", rpsLiMismatch.lineItems.length === 2, rpsLiMismatch.lineItems);
ok("single-line fallback (one line = whole total) kept", t.rcptParseSuggestion('{"vendor":"x","amount":90,"lineItems":[{"desc":"whole receipt","amount":90,"bucket":"pass-through"}]}', rpsCats, rpsJobs).lineItems.length === 1, null);
// desc coerced to string + truncated to 120
const rpsLiDesc = t.rcptParseSuggestion('{"vendor":"x","amount":5,"lineItems":[{"desc":' + JSON.stringify("D".repeat(200)) + ',"amount":5,"bucket":"business"}]}', rpsCats, rpsJobs);
ok("line desc truncated to 120 chars", rpsLiDesc.lineItems[0].desc.length === 120, rpsLiDesc.lineItems[0].desc.length);
ok("non-string line desc coerced to string (\"\")", t.rcptParseSuggestion('{"vendor":"x","amount":5,"lineItems":[{"desc":null,"amount":5,"bucket":"business"}]}', rpsCats, rpsJobs).lineItems[0].desc === "", null);
// regression: last4 / refund / deposit / splits still parse when lineItems ride along
const rpsLiMix = t.rcptParseSuggestion('{"vendor":"Sunbelt","amount":300,"last4":"2469","refund":true,"deposit":true,"splits":[{"amount":120,"type":"pass-through","category":"materials","note":"pavers"},{"amount":180,"type":"business","category":"tools/equipment","note":"tamper"}],"lineItems":[{"desc":"pavers","amount":120,"bucket":"pass-through"},{"desc":"tamper","amount":180,"bucket":"business"}]}', rpsCats.concat(["materials", "tools/equipment"]), rpsJobs);
ok("splits + last4 + refund + deposit UNCHANGED with lineItems present", rpsLiMix.splits.length === 2 && rpsLiMix.last4 === "2469" && rpsLiMix.refund === true && rpsLiMix.deposit === true && rpsLiMix.lineItems.length === 2, rpsLiMix);

console.log("\n— Cap STATEMENT fan-out (rcptParseSuggestion.transactions): one entry per POS transaction, debit = POSITIVE expense —");
// SINGLE-RECEIPT PATH UNCHANGED: no transactions key → transactions:[] (a normal receipt never fans out)
ok("no transactions key → transactions:[] (single-receipt path unchanged)", Array.isArray(rpsBase.transactions) && rpsBase.transactions.length === 0, rpsBase.transactions);
ok("explicit empty transactions array → transactions:[]", t.rcptParseSuggestion('{"vendor":"x","amount":50,"transactions":[]}', rpsCats, rpsJobs).transactions.length === 0, null);
ok("non-array transactions (\"foo\") → transactions:[]", t.rcptParseSuggestion('{"vendor":"x","amount":50,"transactions":"foo"}', rpsCats, rpsJobs).transactions.length === 0, null);
// Ray's real statement: TWO POS debits on card 8355 (both printed with a minus sign) → 2 POSITIVE, not-refund entries
const rpsStmt = t.rcptParseSuggestion('{"vendor":"","amount":null,"transactions":[{"vendor":"VULCAN MIDEAST","amount":-68.69,"date":"2026-07-08","last4":"8355","type":"job-expense","category":"materials","refund":false},{"vendor":"THE HOME DEPOT #3650","amount":-67.21,"date":"2026-07-08","last4":"8355","type":"pass-through","category":"materials","refund":false}]}', rpsCats.concat(["materials"]), rpsJobs);
ok("statement with 2 POS debits → 2 transaction entries", rpsStmt && rpsStmt.transactions.length === 2, rpsStmt && rpsStmt.transactions);
ok("a statement DEBIT shown NEGATIVE comes back POSITIVE (money out = a normal expense)", rpsStmt.transactions[0].amount === 68.69 && rpsStmt.transactions[1].amount === 67.21, rpsStmt.transactions.map(x => x.amount));
ok("a statement debit is refund:FALSE (the minus sign must NOT flag a refund)", rpsStmt.transactions[0].refund === false && rpsStmt.transactions[1].refund === false, rpsStmt.transactions.map(x => x.refund));
ok("each entry keeps vendor / date / last4 / type / category", rpsStmt.transactions[0].vendor === "VULCAN MIDEAST" && rpsStmt.transactions[0].date === "2026-07-08" && rpsStmt.transactions[0].last4 === "8355" && rpsStmt.transactions[0].type === "job-expense" && rpsStmt.transactions[0].category === "materials" && rpsStmt.transactions[1].vendor === "THE HOME DEPOT #3650", rpsStmt.transactions);
// even a POSITIVE-printed statement debit stays positive & not-refund (Math.abs); refund:true honored ONLY when explicit
const rpsStmt2 = t.rcptParseSuggestion('{"transactions":[{"vendor":"Store","amount":10,"refund":false},{"vendor":"Return","amount":5,"refund":true}]}', rpsCats, rpsJobs);
ok("explicit refund:true on a genuine credit line is honored (positive amount kept)", rpsStmt2.transactions.length === 2 && rpsStmt2.transactions[1].refund === true && rpsStmt2.transactions[1].amount === 5, rpsStmt2.transactions);
// MALFORMED entries dropped (no usable amount / not an object); valid ones survive
const rpsStmtBad = t.rcptParseSuggestion('{"transactions":[{"vendor":"Good","amount":30},{"vendor":"NoAmt"},{"vendor":"ZeroAmt","amount":0},{"vendor":"NaN","amount":"abc"},null,"foo",{"vendor":"Good2","amount":12.5}]}', rpsCats, rpsJobs);
ok("malformed transaction entries (no/zero/NaN amount, non-object) dropped; valid kept", rpsStmtBad.transactions.length === 2 && rpsStmtBad.transactions[0].vendor === "Good" && rpsStmtBad.transactions[1].vendor === "Good2", rpsStmtBad.transactions);
// bad type / category inside a valid entry → clamped (entry retained, not dropped — the owner classifies it)
const rpsStmtClamp = t.rcptParseSuggestion('{"transactions":[{"vendor":"V","amount":9,"type":"NOPE","category":"NOTACAT"}]}', rpsCats, rpsJobs);
ok("bad type/category inside a valid entry → clamped to null/\"\" (entry retained)", rpsStmtClamp.transactions.length === 1 && rpsStmtClamp.transactions[0].type === null && rpsStmtClamp.transactions[0].category === "", rpsStmtClamp.transactions);
// LENGTH CAP: a 45-transaction statement caps at 40
const rpsBig = t.rcptParseSuggestion('{"transactions":[' + Array.from({ length: 45 }, (_, i) => '{"vendor":"V' + i + '","amount":' + (i + 1) + '}').join(",") + ']}', rpsCats, rpsJobs);
ok("transactions array capped at 40 (45 valid entries → 40)", rpsBig.transactions.length === 40, rpsBig.transactions.length);
// vendor coerced/truncated to 120
ok("transaction vendor truncated to 120 chars", t.rcptParseSuggestion('{"transactions":[{"vendor":' + JSON.stringify("V".repeat(200)) + ',"amount":1}]}', rpsCats, rpsJobs).transactions[0].vendor.length === 120, null);
// regression: transactions ride alongside everything else without disturbing the single-object fields
ok("all prior fields intact when transactions present", rpsStmt.vendor === "" && Array.isArray(rpsStmt.splits) && rpsStmt.splits.length === 0 && Array.isArray(rpsStmt.lineItems) && rpsStmt.lineItems.length === 0 && rpsStmt.refund === false, rpsStmt);

console.log("\n— Cap receipt-vision RENTAL CONTRACT (rcptParseSuggestion): net rental cost, NOT the deposit —");
// A Home Depot rental contract read: the CORRECT shape the (prompted) model returns — amount = rental + tax
// (the 'Estimated Total' $72.59), category rentals, refund:false. The $300 deposit + the negative Due-on-Return
// WASH, so they never become the amount and the contract is NOT flagged as a refund. Parse passes it through clean.
const rpsRental = t.rcptParseSuggestion('{"vendor":"The Home Depot","amount":72.59,"date":"2026-07-03","desc":"Vibratory Plate Compactor 14\\"","type":"job-expense","category":"rentals","jobId":null,"refund":false,"deposit":false,"confidence":0.9}', rpsCats, rpsJobs);
ok("rental contract: amount = net rental (rental+tax) 72.59, NOT the $300 deposit", rpsRental && rpsRental.amount === 72.59, rpsRental);
ok("rental contract: category = rentals", rpsRental.category === "rentals", rpsRental.category);
ok("rental contract: refund FALSE (the contract is a charge, not a refund)", rpsRental.refund === false, rpsRental.refund);
ok("rental contract: deposit FALSE on the main charge (deposit/return wash)", rpsRental.deposit === false, rpsRental.deposit);
ok("rental contract: equipment kept in desc", rpsRental.desc === 'Vibratory Plate Compactor 14"', rpsRental.desc);
ok("rental contract: ONE transaction — NOT a statement (no fanned transactions, no lineItems to sum)", rpsRental.transactions.length === 0 && rpsRental.lineItems.length === 0, { tx: rpsRental.transactions, li: rpsRental.lineItems });

console.log("\n— Cap receipt-vision REQUEST SHAPE (callAnthropicVision): PDF → document block, photo → image block —");
(function () {
  const https = require("https");
  const orig = https.request;
  let captured = null;
  // spy: capture the request BODY (what we'd send to Anthropic) without any network I/O
  https.request = function (url, opts, cb) { return { on: function () { return this; }, write: function (p) { captured = p; }, end: function () {} }; };
  try {
    t.callAnthropicVision("k", "claude-sonnet-4-6", "application/pdf", "UERGQg==", "read it", function () {}, 1500);
    let body = null; try { body = JSON.parse(captured); } catch (e) {}
    const pblock = body && body.messages && body.messages[0] && body.messages[0].content && body.messages[0].content[0];
    ok("application/pdf → a `document` content block (base64 application/pdf, the PDF bytes)", !!pblock && pblock.type === "document" && pblock.source && pblock.source.type === "base64" && pblock.source.media_type === "application/pdf" && pblock.source.data === "UERGQg==", pblock);
    ok("PDF request keeps a text (task) block AFTER the document block", !!(body.messages[0].content[1] && body.messages[0].content[1].type === "text"), body && body.messages[0].content.map(function (b) { return b.type; }));

    captured = null;
    t.callAnthropicVision("k", "claude-sonnet-4-6", "image/png", "SU1H", "read it", function () {}, 1500);
    body = JSON.parse(captured);
    const iblock = body.messages[0].content[0];
    ok("image/png → an `image` content block (NOT document)", iblock.type === "image" && iblock.source.media_type === "image/png" && iblock.source.data === "SU1H", iblock);

    captured = null;
    t.callAnthropicVision("k", "claude-sonnet-4-6", "image/jpeg", "SU1H", "read it", function () {}, 1500);
    body = JSON.parse(captured);
    ok("image/jpeg → an `image` content block (media_type image/jpeg)", body.messages[0].content[0].type === "image" && body.messages[0].content[0].source.media_type === "image/jpeg", body.messages[0].content[0]);
  } finally { https.request = orig; }
})();

console.log("\n— Cap read-receipt endpoint: PDFs are read (no early skip), mapped to application/pdf, size-guarded —");
(function () {
  const srv = require("fs").readFileSync(require("path").join(__dirname, "sync-server.js"), "utf8");
  ok("endpoint no longer early-returns skip:pdf for a .pdf (the skip line is gone)", srv.indexOf('reason: "pdf" }') < 0 && srv.indexOf("vision reads images, not PDFs") < 0, null);
  ok("endpoint maps a .pdf to the application/pdf media type", /isPdf \? "application\/pdf"/.test(srv), null);
  ok("endpoint size-guards a PDF (graceful skip, never hangs the drain)", srv.indexOf('reason: "pdf-too-large"') >= 0, null);
})();

console.log("\n— Cap receipt-vision MODEL (server-authoritative: Sonnet 4.6 default, Opus 4.8 escalate; no client model) —");
// rcptVisionModel maps the strictly-boolean escalate flag → a model. cfg.model is IGNORED (Ray: never Haiku for reads).
ok("default read → Sonnet 4.6 even when cfg.model = Haiku", t.rcptVisionModel({ model: "claude-haiku-4-5-20251001" }, false) === "claude-sonnet-4-6", t.rcptVisionModel({ model: "claude-haiku-4-5-20251001" }, false));
ok("escalate:true → Opus 4.8 (smartest model), cfg.model still ignored", t.rcptVisionModel({ model: "claude-haiku-4-5-20251001" }, true) === "claude-opus-4-8", null);
ok("per-org cfg.receiptModel override honored for the DEFAULT read only", t.rcptVisionModel({ receiptModel: "claude-opus-4-6" }, false) === "claude-opus-4-6", null);
ok("escalate ALWAYS wins with Opus 4.8, overriding cfg.receiptModel", t.rcptVisionModel({ receiptModel: "claude-opus-4-6" }, true) === "claude-opus-4-8", null);
ok("non-boolean escalate (\"true\" string) is NOT an escalation → Sonnet 4.6 (strict === true)", t.rcptVisionModel({}, "true") === "claude-sonnet-4-6", null);
ok("no cfg at all → Sonnet 4.6 default", t.rcptVisionModel(null, false) === "claude-sonnet-4-6", null);
// The client can NEVER pick the model: rcptVisionModel takes (cfg, escalate) only — a free-form `model` in the
// request body has no path in. Even a hostile-looking cfg.model resolves to the server default, not the string.
ok("a client-supplied model string can never reach the call (helper reads only cfg + boolean escalate)", t.rcptVisionModel({ model: "attacker/model" }, false) === "claude-sonnet-4-6", null);

console.log("\n— receipt ownership guard (rcptOwnedByOrg): job line items live in jobMaterials/jobExpenses post-migration —");
ok("finds a standalone Receipts-page receipt (s.receipts)", t.rcptOwnedByOrg({ obx: { receipts: [{ receiptId: "abc.jpg" }] } }, "obx", "abc.jpg"), null);
ok("finds a business-expense receipt (s.expenses)", t.rcptOwnedByOrg({ obx: { expenses: [{ receiptId: "exp.png" }] } }, "obx", "exp.png"), null);
// The regression: after hoistJobLineItems empties job.materials/.expenses, a job-attached receipt lives ONLY in
// the jobMaterials/jobExpenses collection. Guard must look there or every read of it 404s (Cap can't read job receipts).
ok("finds a job MATERIAL receipt in the jobMaterials collection", t.rcptOwnedByOrg({ obx: { jobMaterials: [{ id: "jm_1", jobId: "j1", receiptId: "mat.jpg" }], jobs: [{ id: "j1", materials: [] }] } }, "obx", "mat.jpg"), null);
ok("finds a job EXPENSE receipt in the jobExpenses collection", t.rcptOwnedByOrg({ obx: { jobExpenses: [{ id: "je_1", jobId: "j1", receiptId: "je.webp" }], jobs: [{ id: "j1", expenses: [] }] } }, "obx", "je.webp"), null);
ok("still finds a legacy nested job.materials receipt (pre-migration data)", t.rcptOwnedByOrg({ obx: { jobs: [{ id: "j1", materials: [{ receiptId: "legacy.jpg" }] }] } }, "obx", "legacy.jpg"), null);
ok("rejects a receiptId that belongs to no record in the org", !t.rcptOwnedByOrg({ obx: { receipts: [], jobMaterials: [], jobExpenses: [] } }, "obx", "ghost.jpg"), null);
ok("rejects a receipt owned by a DIFFERENT org (cross-org isolation intact)", !t.rcptOwnedByOrg({ obx: { jobMaterials: [{ receiptId: "mine.jpg" }] }, jam: {} }, "jam", "mine.jpg"), null);

console.log("\n— vision rate limiter (batch drains get their OWN bucket, NOT the 20/5min login bucket) —");
// A 12-photo drop that 429'd was hitting the login limiter (LOGIN_MAX=20). visionRateCheck must allow a real batch.
(function () {
  const ip = "1.2.3.4-vision";
  let firstBlockAt = 0;
  for (let i = 1; i <= 200; i++) if (!t.visionRateCheck(ip).ok && !firstBlockAt) firstBlockAt = i;
  ok("visionRateCheck allows a full 200-read batch before throttling (a 12-photo upload never trips it)", firstBlockAt === 0, { firstBlockAt });
  ok("visionRateCheck DOES backstop a runaway (blocks the 201st, with a retry hint)", (function () { const r = t.visionRateCheck(ip); return !r.ok && r.retry > 0; })(), null);
})();
// Decoupled buckets: hammering the LOGIN limiter must NOT throttle vision, and vice-versa.
(function () {
  const ip = "5.6.7.8-decouple";
  for (let i = 0; i < 25; i++) t.rateCheck(ip);   // blow past LOGIN_MAX=20 on the login bucket
  ok("login-bucket exhaustion does NOT throttle the vision endpoint (separate Map)", t.visionRateCheck(ip).ok, null);
})();
// Assert the model + max_tokens ACTUALLY SENT to the Anthropic call, by spying on the shared https module.
(function () {
  const https = require("https");
  const orig = https.request, captured = [];
  https.request = function () { const req = { on() { return req; }, write(p) { captured.push(p); return true; }, end() {} }; return req; };
  try {
    t.callAnthropicVision("key", t.rcptVisionModel({ model: "claude-haiku-4-5-20251001" }, false), "image/jpeg", "AAAA", "task", function () {}, 1500);
    const dflt = JSON.parse(captured[0] || "{}");
    ok("wire: default read SENDS model=claude-sonnet-4-6 + max_tokens=1500", dflt.model === "claude-sonnet-4-6" && dflt.max_tokens === 1500, { model: dflt.model, max_tokens: dflt.max_tokens });
    t.callAnthropicVision("key", t.rcptVisionModel({}, true), "image/jpeg", "AAAA", "task", function () {}, 1500);
    const esc = JSON.parse(captured[1] || "{}");
    ok("wire: escalate read SENDS model=claude-opus-4-8 + max_tokens=1500", esc.model === "claude-opus-4-8" && esc.max_tokens === 1500, { model: esc.model, max_tokens: esc.max_tokens });
    t.callAnthropicVision("key", "claude-sonnet-4-6", "image/jpeg", "AAAA", "task", function () {});
    const leg = JSON.parse(captured[2] || "{}");
    ok("wire: omitted maxTokens keeps the legacy 512 default (backward-compatible)", leg.max_tokens === 512, leg.max_tokens);
  } finally { https.request = orig; }
})();

console.log("\n— PER-FUNCTION AI MODEL PICKER (resolveModel: allowlisted pick, else the fn default) —");
// resolveModel returns the org's configured, ALLOWLISTED model per function; unset OR off-allowlist → the fn default.
ok("resolveModel: configured allowlisted model per fn is used", t.resolveModel({ models: { ask: "claude-opus-4-8" } }, "ask") === "claude-opus-4-8", null);
ok("resolveModel: unset fn → the fn default (ask → Haiku)", t.resolveModel({ models: {} }, "ask") === "claude-haiku-4-5-20251001", null);
ok("resolveModel: no cfg / no models → the fn default (digest → Haiku)", t.resolveModel(null, "digest") === "claude-haiku-4-5-20251001", null);
ok("resolveModel: OFF-allowlist stored value → default (cost/abuse guard)", t.resolveModel({ models: { assistant: "gpt-4o" } }, "assistant") === "claude-sonnet-4-6", null);
ok("resolveModel: assistant default is Sonnet 4.6", t.resolveModel({ models: {} }, "assistant") === "claude-sonnet-4-6", null);
ok("resolveModel: receipt default Sonnet 4.6, receiptEscalate default Opus 4.8", t.resolveModel({}, "receipt") === "claude-sonnet-4-6" && t.resolveModel({}, "receiptEscalate") === "claude-opus-4-8", null);
ok("resolveModel: Fable 5 is allowlisted + selectable", t.resolveModel({ models: { digest: "claude-fable-5" } }, "digest") === "claude-fable-5", null);
ok("AI_MODELS allowlist = the 4 known ids only", (function () { const ids = t.AI_MODELS.map(m => m.id).slice().sort().join(","); return ids === ["claude-fable-5", "claude-haiku-4-5-20251001", "claude-opus-4-8", "claude-sonnet-4-6"].slice().sort().join(","); })(), t.AI_MODELS.map(m => m.id));
// rcptVisionModel now honors the picker's models.receipt / models.receiptEscalate (allowlisted) with legacy fallbacks.
ok("picker: models.receipt (allowlisted) overrides the default read", t.rcptVisionModel({ models: { receipt: "claude-fable-5" } }, false) === "claude-fable-5", null);
ok("picker: escalate uses models.receiptEscalate (allowlisted) when set", t.rcptVisionModel({ models: { receiptEscalate: "claude-sonnet-4-6" } }, true) === "claude-sonnet-4-6", null);
ok("picker: off-allowlist models.receipt IGNORED → legacy cfg.receiptModel still honored", t.rcptVisionModel({ models: { receipt: "evil/model" }, receiptModel: "claude-opus-4-6" }, false) === "claude-opus-4-6", null);
ok("picker: models.receipt (allowlisted) beats legacy cfg.receiptModel", t.rcptVisionModel({ models: { receipt: "claude-opus-4-8" }, receiptModel: "claude-opus-4-6" }, false) === "claude-opus-4-8", null);
// Wire: the ask/assistant/digest callers SEND the resolved model on the actual Anthropic HTTPS payload (spy).
(function () {
  const https = require("https");
  const orig = https.request, captured = [];
  https.request = function () { const req = { on() { return req; }, write(p) { captured.push(p); return true; }, end() {} }; return req; };
  try {
    t.callAnthropic("key", t.resolveModel({ models: { ask: "claude-opus-4-8" } }, "ask"), "ctx", "q", function () {});
    ok("wire: ask SENDS the resolved picker model (Opus 4.8)", JSON.parse(captured[0] || "{}").model === "claude-opus-4-8", JSON.parse(captured[0] || "{}").model);
    t.callAnthropicTask("key", t.resolveModel({ models: { digest: "claude-fable-5" } }, "digest"), "ctx", "task", function () {});
    ok("wire: digest/task SENDS the resolved picker model (Fable 5)", JSON.parse(captured[1] || "{}").model === "claude-fable-5", JSON.parse(captured[1] || "{}").model);
    t.callAnthropicTask("key", t.resolveModel({ models: {} }, "digest"), "ctx", "task", function () {});
    ok("wire: digest unset → default Haiku on the wire", JSON.parse(captured[2] || "{}").model === "claude-haiku-4-5-20251001", JSON.parse(captured[2] || "{}").model);
  } finally { https.request = orig; }
})();

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

  // ---- CAP TODAY (Phase 1, read-only /api/org-ai/assistant) — user/org-scoped context + gate + no-network guard ----
  console.log("\n— Cap Today (read-only assistant) —");
  const capToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const capStore = {
    obx: {
      jobs: [
        { id: "jobA", title: "Nags Head cleanout", date: capToday, crew: ["joe", "sam"], time: "08:00", customerId: "c1", updatedAt: 1 },
        { id: "jobT", title: "Teammate-only paver", date: capToday, crew: ["sam"], time: "09:00", updatedAt: 1 }
      ],
      customers: [{ id: "c1", name: "Mike Green" }], properties: [],
      timeclock: [{ id: "tc1", userId: "joe", clockIn: Date.now() - 3600000, clockOut: null, jobId: "jobA", vehicle: "Ram 2500", updatedAt: 1 }],
      docs: [{ id: "homeBase", label: "The shop" }], places: [{ id: "p1", label: "Transfer station" }]
    },
    jam: { jobs: [{ id: "jobJam", title: "Jamieson secret job", date: capToday, crew: ["joe"], time: "07:00", updatedAt: 1 }] },
    registry: [{ id: "obx", name: "OBX Lot Solutions" }, { id: "jam", name: "Jamieson" }],
    users: [
      { id: "joe", username: "Joe", role: "crew", updatedAt: 1 },
      { id: "sam", username: "Sam", role: "crew", updatedAt: 1 },
      { id: "stranger", username: "Stranger", role: "crew", updatedAt: 1 },
      { id: "mem_obx_joe", kind: "membership", orgId: "obx", accountId: "joe", role: "crew", active: true, updatedAt: 1 }
    ]
  };
  const capCtx = t.capTodayContext(capStore, "obx", "joe");
  ok("capTodayContext names the user + role + org", capCtx.indexOf("Joe") >= 0 && capCtx.indexOf("role: crew") >= 0 && capCtx.indexOf("OBX Lot Solutions") >= 0, capCtx.split("\n").slice(0, 2));
  ok("capTodayContext includes the user's OWN job today (with customer + route context)", capCtx.indexOf("Nags Head cleanout") >= 0 && capCtx.indexOf("Mike Green") >= 0, capCtx);
  ok("capTodayContext reflects the OPEN shift (clocked in)", /CLOCKED IN/.test(capCtx) && capCtx.indexOf("Ram 2500") >= 0, capCtx.split("\n").filter(l => /Clock state/.test(l)));
  ok("capTodayContext surfaces home base + saved places (the shop / transfer station)", capCtx.indexOf("The shop") >= 0 && capCtx.indexOf("Transfer station") >= 0, capCtx);
  ok("capTodayContext EXCLUDES a teammate-only job (user-scoped, not on joe's crew)", capCtx.indexOf("Teammate-only paver") < 0, capCtx);
  ok("capTodayContext EXCLUDES the OTHER org's job (org-scoped isolation)", capCtx.indexOf("Jamieson secret job") < 0, capCtx);
  ok("capTodayContext carries no finance/pay lines (read-only, no money leak)", !/\$\d/.test(capCtx) && capCtx.indexOf("payout") < 0, capCtx);
  // member-gate (the endpoint's 403 predicate: orgsForUser(store, acct).indexOf(org) < 0)
  ok("assistant member-gate: a member passes for their org (joe ∈ obx)", t.orgsForUser(capStore, t.accountById(capStore, "joe")).indexOf("obx") >= 0);
  ok("assistant member-gate: a member of obx is a NON-member of jam → 403", t.orgsForUser(capStore, t.accountById(capStore, "joe")).indexOf("jam") < 0);
  ok("assistant member-gate: a stranger with no membership → 403 everywhere", t.orgsForUser(capStore, t.accountById(capStore, "stranger")).length === 0);
  // callAnthropicAssistant: trims to a valid leading user turn; returns a friendly opener + empty actions WITHOUT a network call
  let capR1 = null, capR1a = null, capR2 = null;
  t.callAnthropicAssistant("k", "m", "sys", [{ role: "assistant", content: "hi" }], null, null, (e, r, a) => { capR1 = r; capR1a = a; });
  t.callAnthropicAssistant("k", "m", "sys", [], t.CAP_TOOLS, { jobIds: [] }, (e, r) => { capR2 = r; });
  ok("callAnthropicAssistant early-returns (no network) when there's no leading user turn, actions []", typeof capR1 === "string" && /help/i.test(capR1) && Array.isArray(capR1a) && capR1a.length === 0 && typeof capR2 === "string", [capR1, capR1a, capR2]);

  // ===== Cap Today PHASE 2 — capParseAction server-side CLAMP (AI output is untrusted; server never executes) =====
  console.log("\n— Cap Today Phase 2 (action clamp) —");
  const capActCtx = { jobIds: ["jobA", "jobB"], todayIso: "2026-07-06" };
  ok("clockIn with a valid today jobId → KEPT (jobId + odometer clamped)",
    (function () { const a = t.capParseAction("clockIn", { jobId: "jobA", placeHint: "the shop", odometer: 45210, vehicleHint: "Ram" }, capActCtx); return a && a.action === "clockIn" && a.jobId === "jobA" && a.odometer === 45210 && a.placeHint === "the shop"; })());
  ok("clockIn with a jobId NOT in today's/active jobs → DROPPED (null)",
    t.capParseAction("clockIn", { jobId: "jobZZZ", placeHint: null, odometer: null, vehicleHint: null }, capActCtx) === null);
  ok("clockIn odometer non-numeric → DROPPED (null)",
    t.capParseAction("clockIn", { jobId: "jobA", placeHint: null, odometer: "banana", vehicleHint: null }, capActCtx) === null);
  ok("setOdometer non-numeric miles → DROPPED (null)",
    t.capParseAction("setOdometer", { miles: "lots" }, capActCtx) === null);
  ok("setOdometer valid miles → KEPT",
    (function () { const a = t.capParseAction("setOdometer", { miles: 58366 }, capActCtx); return a && a.action === "setOdometer" && a.miles === 58366; })());
  ok("clockOut without odometer → KEPT with odometer null",
    (function () { const a = t.capParseAction("clockOut", { odometer: null }, capActCtx); return a && a.action === "clockOut" && a.odometer === null; })());
  ok("assignSelfToJob to a valid job → KEPT; to an unknown job → DROPPED",
    (function () { const ok1 = t.capParseAction("assignSelfToJob", { jobId: "jobB" }, capActCtx); const ok2 = t.capParseAction("assignSelfToJob", { jobId: "nope" }, capActCtx); return ok1 && ok1.jobId === "jobB" && ok2 === null; })());
  ok("markWorkDay date clamp: valid YYYY-MM-DD kept; absent → defaults to today; bad format → DROPPED",
    (function () { const good = t.capParseAction("markWorkDay", { jobId: "jobA", date: "2026-07-05" }, capActCtx); const dflt = t.capParseAction("markWorkDay", { jobId: "jobA", date: null }, capActCtx); const bad = t.capParseAction("markWorkDay", { jobId: "jobA", date: "July 5" }, capActCtx); return good && good.date === "2026-07-05" && dflt && dflt.date === "2026-07-06" && bad === null; })());
  ok("a tool with a targetPerson-ish field (cross-user) → DROPPED (crew act on self only)",
    t.capParseAction("clockIn", { jobId: "jobA", targetPerson: "sam", placeHint: null, odometer: null, vehicleHint: null }, capActCtx) === null
    && t.capParseAction("assignSelfToJob", { jobId: "jobA", userId: "sam" }, capActCtx) === null);
  ok("an unknown tool name → DROPPED (null)",
    t.capParseAction("deleteEverything", { all: true }, capActCtx) === null);
  ok("CAP_TOOLS exports 6 self-scoped tools, none taking a target/userId field",
    Array.isArray(t.CAP_TOOLS) && t.CAP_TOOLS.length === 6 && t.CAP_TOOLS.every(tl => tl && tl.strict === true && tl.input_schema && tl.input_schema.additionalProperties === false && !Object.keys(tl.input_schema.properties || {}).some(k => /user|person|target|assignee|member/i.test(k))));

  // ===== Cap Today PHASE C — logExpense clamp (receipt filing via Cap; AI output untrusted, crew self-scoped) =====
  console.log("\n— Cap Today Phase C (logExpense clamp) —");
  const capExpCtx = { jobIds: ["jobA", "jobB"], todayIso: "2026-07-06", cats: ["materials", "fuel", "disposal"] };
  ok("logExpense fully valid → KEPT (amount/vendor/type/jobId/category/paidBy/refund/deposit all clamped through)",
    (function () { const a = t.capParseAction("logExpense", { amount: 65, vendor: "Lowe's", type: "pass-through", jobId: "jobA", category: "materials", paidBy: "self", note: "pavers", refund: false, deposit: false }, capExpCtx);
      return a && a.action === "logExpense" && a.amount === 65 && a.vendor === "Lowe's" && a.type === "pass-through" && a.jobId === "jobA" && a.category === "materials" && a.paidBy === "self" && a.note === "pavers" && a.refund === false && a.deposit === false; })());
  ok("logExpense category NOT in ctx.cats → cleared to \"\" (action still kept)",
    (function () { const a = t.capParseAction("logExpense", { amount: 20, vendor: "X", type: "business", jobId: null, category: "gold-bars", paidBy: null, note: null, refund: false, deposit: false }, capExpCtx); return a && a.action === "logExpense" && a.category === ""; })());
  ok("logExpense type NOT a real type → null (action still kept, app fills default)",
    (function () { const a = t.capParseAction("logExpense", { amount: 20, vendor: "X", type: "groceries", jobId: null, category: "fuel", paidBy: null, note: null, refund: false, deposit: false }, capExpCtx); return a && a.type === null; })());
  ok("logExpense jobId NOT in ctx.jobIds → cleared to null",
    (function () { const a = t.capParseAction("logExpense", { amount: 20, vendor: "X", type: "job-expense", jobId: "jobZZZ", category: "fuel", paidBy: "self", note: null, refund: false, deposit: false }, capExpCtx); return a && a.jobId === null; })());
  ok("logExpense paidBy 'chase' (a card/other value, not 'self') → collapsed to \"\" (never another person)",
    (function () { const a = t.capParseAction("logExpense", { amount: 20, vendor: "X", type: "business", jobId: null, category: "fuel", paidBy: "chase", note: null, refund: false, deposit: false }, capExpCtx); return a && a.paidBy === ""; })());
  ok("logExpense with a targetPerson-ish field (cross-user) → DROPPED (null) by the TARGET_KEYS guard",
    t.capParseAction("logExpense", { amount: 20, vendor: "X", type: "business", jobId: null, category: "fuel", paidBy: "self", note: null, refund: false, deposit: false, teammate: "sam" }, capExpCtx) === null);
  ok("logExpense negative amount WITHOUT refund → DROPPED (null); WITH refund=true → KEPT",
    t.capParseAction("logExpense", { amount: -30, vendor: "X", type: "business", jobId: null, category: "fuel", paidBy: null, note: null, refund: false, deposit: false }, capExpCtx) === null
    && (function () { const a = t.capParseAction("logExpense", { amount: -30, vendor: "X", type: "business", jobId: null, category: "fuel", paidBy: null, note: null, refund: true, deposit: false }, capExpCtx); return a && a.amount === -30 && a.refund === true; })());
  ok("logExpense zero / non-numeric amount → DROPPED (null)",
    t.capParseAction("logExpense", { amount: 0, vendor: "X", type: "business", jobId: null, category: "fuel", paidBy: null, note: null, refund: false, deposit: false }, capExpCtx) === null
    && t.capParseAction("logExpense", { amount: "lots", vendor: "X", type: "business", jobId: null, category: "fuel", paidBy: null, note: null, refund: false, deposit: false }, capExpCtx) === null);
  ok("logExpense no cats in ctx → any category clears to \"\" (safe default)",
    (function () { const a = t.capParseAction("logExpense", { amount: 20, vendor: "X", type: "business", jobId: null, category: "materials", paidBy: null, note: null, refund: false, deposit: false }, { jobIds: [], todayIso: "2026-07-06" }); return a && a.category === ""; })());

  // ===== Cap Crew Brief — crewBriefParse (AI output untrusted; clamp + null-on-garbage) =====
  console.log("\n— Cap Crew Brief (crewBriefParse) —");
  const cbGood = JSON.stringify({
    intro: "Two-plant job at 123 Sound Rd — text Ray with questions.",
    tools: ["bypass pruners", "loppers", "gloves", "tarp"],
    order: ["Prune the crape myrtle", "Cut back the pampas grass", "Haul off clippings"],
    safety: ["Oleander is toxic — wear gloves", "Do not touch protected dune sea oats"],
    tasks: [
      { ref: "Crape myrtle", where: "front bed", do: ["Thin crossing branches"], dont: ["Do not top it (no crape murder)"], note: "Best in late winter" },
      { ref: "Pampas grass", where: "back corner", do: ["Cut to ~12in"], dont: ["Don't burn clippings"], note: "" }
    ],
    closing: "Clean up all debris and take after photos."
  });
  const cbP = t.crewBriefParse("Here you go:\n" + cbGood + "\nThanks");
  ok("crewBriefParse parses a realistic brief (intro/tools/order/safety/tasks/closing all present)",
    !!cbP && cbP.intro.indexOf("123 Sound Rd") >= 0 && cbP.tools.length === 4 && cbP.order.length === 3 && cbP.safety.length === 2 && cbP.tasks.length === 2 && cbP.tasks[0].ref === "Crape myrtle" && cbP.tasks[0].do.length === 1 && cbP.tasks[0].dont.length === 1 && cbP.closing.indexOf("after photos") >= 0, cbP);
  const cbClamp = t.crewBriefParse(JSON.stringify({
    intro: "x".repeat(1000),
    tools: Array.from({ length: 40 }, (_, i) => "tool" + i),
    order: Array.from({ length: 40 }, (_, i) => "step" + i),
    safety: Array.from({ length: 40 }, (_, i) => "safe" + i),
    tasks: Array.from({ length: 60 }, (_, i) => ({ ref: "p" + i, do: Array.from({ length: 20 }, (_, k) => "d" + k), dont: Array.from({ length: 20 }, (_, k) => "n" + k) }))
  }));
  ok("crewBriefParse clamps every array/string (tools≤25 order≤20 safety≤15 tasks≤40 do/dont≤12 intro≤400)",
    !!cbClamp && cbClamp.intro.length === 400 && cbClamp.tools.length === 25 && cbClamp.order.length === 20 && cbClamp.safety.length === 15 && cbClamp.tasks.length === 40 && cbClamp.tasks[0].do.length === 12 && cbClamp.tasks[0].dont.length === 12, cbClamp && { intro: cbClamp.intro.length, tools: cbClamp.tools.length, order: cbClamp.order.length, safety: cbClamp.safety.length, tasks: cbClamp.tasks.length });
  ok("crewBriefParse drops empty strings inside arrays", (function () { const r = t.crewBriefParse(JSON.stringify({ intro: "hi", tools: ["a", "", "  ", "b"], tasks: [] })); return r && r.tools.length === 2; })());
  ok("crewBriefParse returns null on garbage / non-JSON", t.crewBriefParse("not json at all, no braces") === null && t.crewBriefParse("") === null && t.crewBriefParse(null) === null);
  ok("crewBriefParse returns null on an empty object (no usable content)", t.crewBriefParse("{}") === null);

  // ===== Show-the-after (Gemini image) — callGeminiImage + /api/org-ai/show-after gating (no live Gemini calls) =====
  console.log("\n— Show the after (Gemini image gen) —");
  ok("callGeminiImage is exported as a function", typeof t.callGeminiImage === "function");
  ok("SHOW_AFTER_PROMPT is the verified coastal-NC after-trim prompt", typeof t.SHOW_AFTER_PROMPT === "string" && /Outer Banks of North Carolina/.test(t.SHOW_AFTER_PROMPT) && /AFTER a professional landscaping crew/.test(t.SHOW_AFTER_PROMPT) && /same lighting/.test(t.SHOW_AFTER_PROMPT));
  // response-parse: callGeminiImage must pull inlineData.data from candidates[0].content.parts (source-level assert;
  // a real call needs a live key, which we never make in tests). Also assert the endpoint's gating chain is present.
  const _srv = require("fs").readFileSync(require("path").join(__dirname, "sync-server.js"), "utf8");
  const _cgi = _srv.slice(_srv.indexOf("function callGeminiImage"), _srv.indexOf("function callGeminiImage") + 2600);
  ok("callGeminiImage builds the generateContent endpoint with the key in the URL query", /generativelanguage\.googleapis\.com\/v1beta\/models\/.*:generateContent\?key=/.test(_cgi));
  ok("callGeminiImage request body sends inlineData image + text + responseModalities:[IMAGE]", /inlineData/.test(_cgi) && /responseModalities/.test(_cgi));
  ok("callGeminiImage parses the image from candidates[0].content.parts inlineData.data", /candidates\[0\]\.content\.parts/.test(_cgi) && /inlineData\b/.test(_cgi) && /\.data/.test(_cgi));
  ok("callGeminiImage surfaces 429 quota / 402 billing errors", /429/.test(_cgi) && /402/.test(_cgi));
  const _ep = _srv.slice(_srv.indexOf('"/api/org-ai/show-after"'), _srv.indexOf('"/api/org-ai/show-after"') + 3600);
  ok("show-after endpoint gates rate → account → member(orgsForUser) → owner/admin(writerManagesOrg) → photo-owned(landPhotoOwnedByOrg)", /rateCheck/.test(_ep) && /apiAccount/.test(_srv.slice(_srv.indexOf('"/api/org-ai/show-after"') - 400, _srv.indexOf('"/api/org-ai/show-after"') + 2600)) && /orgsForUser/.test(_ep) && /writerManagesOrg/.test(_ep) && /landPhotoOwnedByOrg/.test(_ep));
  ok("show-after requires the Gemini image key and saves a new blob via crypto.randomBytes(12)", /set the Gemini image key/.test(_ep) && /randomBytes\(12\)/.test(_ep) && /fs\.writeFileSync/.test(_ep));

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
})();
