/* team-profile-migration-test.js — MANDATORY migration fixture for TEAM CONTACT PROFILES.
 * Loads a realistic PRE-change store (legacy accounts, some with an email/avail, some with nothing but the
 * required auth fields) and asserts that running it through the new server's migrateStore + a no-op sync
 * round-trip:
 *   • drops NO account and NO existing account field (username, passhash, role, active, email, avail, settings,
 *     adminPin, superAdmin) — zero loss,
 *   • defaults the new additive contact fields (phone/email/avatarId/title) cleanly on every account,
 *   • never touches an account's updatedAt (the backfill must always lose to a real profile edit on merge),
 *   • preserves a member who ALREADY set profile fields verbatim (no clobber).
 * Read-only: builds its own fixture; writes nothing. Run: node team-profile-migration-test.js */
const SS = require("./sync-server");
const clone = o => JSON.parse(JSON.stringify(o));

// ---- a realistic pre-change store: 4 accounts across obx/jam, varied field shapes ----
const fixture = {
  biz: "obx",
  obx: { customers: [{ id: "c1", name: "Jane Doe", updatedAt: 100 }], quotes: [], jobs: [] },
  jam: { customers: [], quotes: [], jobs: [] },
  users: [
    // legacy owner — only the auth essentials, no contact fields at all
    { id: "u_owner", username: "ray", passhash: "hashOWNER", role: "owner", active: true, updatedAt: 111 },
    // crew with an email + availability content (must survive; avail is account-record content, not a collection)
    { id: "u_crew1", username: "pierce", passhash: "hashP", role: "crew", active: true, email: "pierce@obx.test",
      avail: { overrides: { "2026-07-02": "off", "2026-07-03": "am" }, base: {} }, settings: { theme: "dark" }, updatedAt: 222 },
    // crew with a full name + an adminPin (owner-only field must be untouched)
    { id: "u_crew2", username: "chase", passhash: "hashC", role: "crew", active: true, name: "Chase Smith", adminPin: "hashPIN", updatedAt: 333 },
    // a member who ALREADY populated the new profile fields — must be preserved VERBATIM (no clobber)
    { id: "u_crew3", username: "sam", passhash: "hashS", role: "crew", active: true, name: "Sam Jones",
      phone: "252-555-0142", email: "sam@obx.test", avatarId: "blob_sam_123", title: "Owner-operator", updatedAt: 444 },
  ],
};

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL: " + name); } };
const realAccts = st => (st.users || []).filter(u => u && !u.kind && !u.deleted);
const byId = (st, id) => (st.users || []).find(u => u && u.id === id) || null;

const before = clone(fixture);
const migrated = SS.migrateStore(clone(fixture));
const round = SS.mergeState(clone(migrated), {});   // no-op sync round-trip (server merge)

// ---- 1) zero account loss ----
check("every account survives migrate", realAccts(migrated).length === realAccts(before).length);
check("every account survives the sync round-trip", realAccts(round).length === realAccts(before).length);
["u_owner", "u_crew1", "u_crew2", "u_crew3"].forEach(id => check("account " + id + " present after round-trip", !!byId(round, id)));

// ---- 2) existing fields preserved verbatim (zero field loss) ----
realAccts(before).forEach(b => {
  const r = byId(round, b.id);
  const keep = ["username", "passhash", "role", "active", "email", "name", "adminPin", "settings"];
  keep.forEach(f => {
    if (b[f] === undefined) return;
    check(id_f(b.id, f) + " preserved", JSON.stringify(r && r[f]) === JSON.stringify(b[f]));
  });
});
function id_f(id, f) { return id + "." + f; }

// availability content survives (the 2026-06-27 regression class)
const c1 = byId(round, "u_crew1");
check("crew availability overrides survive (2 days)", !!(c1 && c1.avail && c1.avail.overrides && Object.keys(c1.avail.overrides).length === 2));

// ---- 3) new fields default cleanly on legacy accounts ----
["u_owner", "u_crew1", "u_crew2"].forEach(id => {
  const u = byId(round, id);
  check(id + " has phone default ''", u && u.phone === "");
  check(id + " has avatarId default null", u && u.avatarId === null);
  check(id + " has title default ''", u && u.title === "");
  check(id + " has email defined (string)", u && typeof u.email === "string");
});

// ---- 4) a member who already set profile fields is preserved verbatim (no clobber) ----
const sam = byId(round, "u_crew3");
check("pre-set profile preserved: phone", sam && sam.phone === "252-555-0142");
check("pre-set profile preserved: avatarId", sam && sam.avatarId === "blob_sam_123");
check("pre-set profile preserved: title", sam && sam.title === "Owner-operator");
check("pre-set profile preserved: email", sam && sam.email === "sam@obx.test");

// ---- 5) the backfill never bumps updatedAt (must lose to a real edit on merge) ----
realAccts(before).forEach(b => { const r = byId(round, b.id); check(b.id + " updatedAt unchanged by backfill", r && r.updatedAt === b.updatedAt); });

// ---- 6) business data untouched ----
check("obx customer survives", ((round.obx || {}).customers || []).some(c => c.id === "c1"));

console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
