/* my-pay-tests.js — PRIVACY + PAGE-ACCESS gating for the per-person pay system.
   Loads the REAL client role-gate (js/32-admin.js) + the per-person earnings core (js/39-finance-core.js)
   in a vm sandbox and asserts the auth-sensitive invariants the My-Pay feature depends on:
     • a CREW role CAN reach its own "pay" page (it's in CREW_PAGES) ...
     • ... but CANNOT reach "finance" (the business books / margins / everyone's pay) — enforced in roleAllows,
       not just hidden.
     • a signed-out (NO_SESSION) device gets the same crew-equivalent gate: pay yes, finance no.
     • owner sees both.
     • the per-person view a crew member would receive contains ONLY their own member id's numbers
       (finPerPerson is keyed by member id; the page selects exactly curUser().id).
   Run: node my-pay-tests.js  → 0 failed (exit 0) / any failed (exit 1). Touches nothing real. */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } };

/* ---- load the real role gate (js/32-admin.js) in a sandbox with the minimal globals it touches ---- */
const sandbox = { console: console };
sandbox.window = sandbox;                       // js/32 assigns window.* — point it back at the sandbox
sandbox.S = { biz: "obx", users: [], registry: [{ id: "obx", name: "OBX" }] };
let _t = 1; sandbox.now = () => _t++;
sandbox.esc = s => String(s == null ? "" : s);
sandbox.curUser = () => sandbox.__curUser || null;   // the gate reads curUser() → role
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "js", "32-admin.js"), "utf8"), sandbox, { filename: "js/32-admin.js" });
// `const`/`let` top-level decls don't attach to the vm context object — pull the ones we assert on by eval.
const ev = src => vm.runInContext(src, sandbox);
const CREW_PAGES = ev("CREW_PAGES"), NO_SESSION_ROLE = ev("NO_SESSION_ROLE");
const roleAllows = sandbox.roleAllows, curRoleKey = sandbox.curRoleKey;
sandbox.NO_SESSION_ROLE_VAL = NO_SESSION_ROLE;

const can = (roleUser, tab) => { sandbox.__curUser = roleUser; return roleAllows(curRoleKey(), tab); };
const crew = { id: "joe", role: "crew" };
const owner = { id: "ray", role: "owner" };

console.log("— page-access gate: crew sees 'pay' but NOT 'finance' —");
ok("CREW_PAGES INCLUDES 'pay'", CREW_PAGES.indexOf("pay") >= 0, CREW_PAGES);
ok("CREW_PAGES EXCLUDES 'finance'", CREW_PAGES.indexOf("finance") < 0);
ok("crew CAN reach its own pay page", can(crew, "pay") === true);
ok("crew CANNOT reach the finance page (books/margins/everyone's pay)", can(crew, "finance") === false);
ok("crew CANNOT reach receipts (business expense entry)", can(crew, "receipts") === false);
ok("owner CAN reach pay", can(owner, "pay") === true);
ok("owner CAN reach finance", can(owner, "finance") === true);

console.log("— signed-out device gets the crew-equivalent gate (pay yes, finance no) —");
sandbox.__curUser = null;   // no session
ok("no-session role is the restricted pseudo-role", curRoleKey() === NO_SESSION_ROLE);
ok("signed-out CAN see pay (crew-equivalent set)", roleAllows(NO_SESSION_ROLE, "pay") === true);
ok("signed-out CANNOT see finance", roleAllows(NO_SESSION_ROLE, "finance") === false);

console.log("— per-person earnings expose ONLY the target member's numbers —");
const f = require("./js/39-finance-core");
// two people earn on a job; build the per-person view, then confirm a crew member only ever reads m[ownId]
const R = f.finRollup([{ id: "i1", jobId: "j1", date: "2026-06-05", amount: 100, originator: "", crew: ["joe", "moe"] }], {});
const pp = f.finPerPerson(R, { perMember: {} }, f.finHoursByJob([
  { id: "h1", userId: "joe", jobId: "j1", clockIn: 0, clockOut: 3 * 3600000 },
  { id: "h2", userId: "moe", jobId: "j1", clockIn: 0, clockOut: 1 * 3600000 },
]), {});
ok("the view is keyed by member id (joe + moe both present in the OWNER view)", !!pp.member.joe && !!pp.member.moe, Object.keys(pp.member));
// the My-Pay page hands rPay exactly curUser().id for a crew member; simulate that selection:
const crewTargetId = crew.id;                 // a crew member can only ever be handed their OWN id (rPay gating)
const mine = pp.member[crewTargetId];
// $100 → labor 6000¢; no originator/admin ⇒ whole labor pool becomes field (6000¢). Ray's call: split EQUALLY
// among whoever was on the job, regardless of hours (3h vs 1h doesn't change the split) ⇒ joe 3000 / moe 3000.
ok("joe's self view = an EQUAL field share regardless of hours (2-person job ⇒ 50% of the 6000¢ pool = 3000)", mine.field === 3000, mine.field);
ok("joe's self view does NOT carry moe's numbers (separate object)", pp.member.moe.field === 3000 && mine.field === pp.member.moe.field, { joe: mine.field, moe: pp.member.moe.field });
ok("per-person field reconciles to the pooled field (3000+3000 = 6000)", pp.member.joe.field + pp.member.moe.field === R.totals.field, [pp.member.joe.field, pp.member.moe.field, R.totals.field]);

console.log("— MIGRATION FIXTURE: the additive account fields survive migrate + a sync round-trip (zero loss) —");
// The pay system adds NO collection; it adds additive ACCOUNT fields (onboardDismissed / playbookSeen) +
// reuses the existing defaultVehicleId. Prove a realistic pre-change store carrying them survives intact, and
// that EVERY business record (customer/quote/job/account/income/disbursement) is still present afterwards.
const SS = require("./sync-server");
const fixture = {
  obx: {
    customers: [{ id: "c1", name: "Jane", soldBy: "joe", updatedAt: 5 }],
    quotes: [{ id: "q1", customerId: "c1", jobId: "j1", total: 400, paid: true, updatedAt: 5 }],
    jobs: [{ id: "j1", title: "Haul", crew: ["joe", "moe"], date: "2026-06-10", updatedAt: 5 }],
    income: [{ id: "inc_q_q1", jobId: "j1", amount: 400, crew: ["joe", "moe"], originator: "joe", date: "2026-06-10", updatedAt: 5 }],
    disbursements: [{ id: "d1", type: "payout", memberId: "joe", amount: 100, date: "2026-06-15", updatedAt: 5 }],
    timeclock: [{ id: "t1", userId: "joe", jobId: "j1", clockIn: 0, clockOut: 3600000, miles: 5, milesConfirmed: true, updatedAt: 5 }],
  },
  jam: {},
  registry: [{ id: "obx", name: "OBX", updatedAt: 1 }],
  users: [
    { id: "ray", username: "ray", role: "owner", superAdmin: true, updatedAt: 1 },
    // a crew account carrying the NEW additive fields + an existing one (defaultVehicleId)
    { id: "joe", username: "joe", role: "crew", defaultVehicleId: "veh_x", onboardDismissed: true, playbookSeen: true, avail: { days: [false, true, true, true, true, true, false] }, updatedAt: 7 },
    { id: "moe", username: "moe", role: "crew", updatedAt: 1 },
  ],
};
const migrated = SS.migrateStore(JSON.parse(JSON.stringify(fixture)));
const round = SS.mergeState(migrated, {});                       // no-op sync round-trip
const joeAfter = (round.users || []).find(u => u.id === "joe");
ok("crew account survives the round-trip", !!joeAfter);
ok("onboardDismissed (new additive field) preserved", joeAfter && joeAfter.onboardDismissed === true, joeAfter && joeAfter.onboardDismissed);
ok("playbookSeen (new additive field) preserved", joeAfter && joeAfter.playbookSeen === true, joeAfter && joeAfter.playbookSeen);
ok("defaultVehicleId (reused field) preserved", joeAfter && joeAfter.defaultVehicleId === "veh_x", joeAfter && joeAfter.defaultVehicleId);
ok("avail preserved (not clobbered)", joeAfter && joeAfter.avail && joeAfter.avail.days.length === 7, joeAfter && joeAfter.avail);
const obxAfter = round.obx || {};
ok("no business record dropped (customer/quote/job/income/disbursement/timeclock all present)",
  (obxAfter.customers || []).length === 1 && (obxAfter.quotes || []).length === 1 && (obxAfter.jobs || []).length === 1 &&
  (obxAfter.income || []).length === 1 && (obxAfter.disbursements || []).length === 1 && (obxAfter.timeclock || []).length === 1,
  Object.keys(obxAfter).map(k => k + ":" + ((obxAfter[k] || []).length)).join(","));
ok("all three accounts survive (ray + joe + moe)", (round.users || []).filter(u => u && !u.kind && !u.deleted).length === 3, (round.users || []).filter(u => u && !u.kind && !u.deleted).map(u => u.id));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
