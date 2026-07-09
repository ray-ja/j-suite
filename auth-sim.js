/* auth-sim.js — reusable multi-user AUTHORIZATION simulation for the per-user sync auth.
   Spins up an isolated sync-server in a temp dir, simulates an OWNER device and a CREW device,
   and asserts the Phase 4 write-authz invariants end-to-end against a live server:
     • per-user tokens are issued at login
     • a non-owner CANNOT escalate their role, take over a password, or create an account
     • a non-owner CAN still write business data + their own settings
     • an OWNER can manage accounts
     • no user is ever dropped
     • a leaked SHARED (legacy) token also cannot escalate
     • presence + a server-authoritative audit entry are recorded
   Run:  node auth-sim.js     → prints a pass/fail tally; exits 0 (all green) / 1 (any failure).
   Touches nothing real — its own temp data.json, killed + removed on exit. */
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process"), http = require("http");
const SS = require("./sync-server");                       // module require() does NOT start the server (listen is behind require.main)
const PORT = 4090, SHARED = "sim-shared-token";
const ROOT = __dirname, DIR = path.join(os.tmpdir(), "authsim-" + process.pid);
const clone = o => JSON.parse(JSON.stringify(o));

function setup() {
  fs.mkdirSync(path.join(DIR, "js"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "sync-server.js"), path.join(DIR, "sync-server.js"));
  ["qb-bridge.js", "availability-resolve.js"].forEach(f => { try { fs.copyFileSync(path.join(ROOT, f), path.join(DIR, f)); } catch (e) {} });
  try { fs.copyFileSync(path.join(ROOT, "js", "82-tax-estimator.js"), path.join(DIR, "js", "82-tax-estimator.js")); } catch (e) {}   // sync-server requires the tax estimator (P2)
  fs.writeFileSync(path.join(DIR, "js", "x.js"), "//x");
  fs.writeFileSync(path.join(DIR, "data.json"), JSON.stringify({
    obx: { customers: [] }, jam: {}, users: [
      { id: "owner", username: "ray", passhash: SS.scryptHash("ownerpw"), role: "owner", updatedAt: 1 },
      { id: "crew", username: "joe", passhash: SS.scryptHash("crewpw"), role: "crew", updatedAt: 1 },
      // EXPLICIT memberships → the owner is an org-OWNER of obx/jam but NOT super-admin (migrateStore only
      // super-admins an owner that had no membership). This lets us test writerOwnsOrg-gated /invite AND that a
      // NON-super owner inviting role=owner is coerced down (no privilege escalation).
      { id: "mem_obx_owner", kind: "membership", orgId: "obx", accountId: "owner", role: "owner", active: true, updatedAt: 1 },
      { id: "mem_jam_owner", kind: "membership", orgId: "jam", accountId: "owner", role: "owner", active: true, updatedAt: 1 },
      { id: "mem_obx_crew", kind: "membership", orgId: "obx", accountId: "crew", role: "crew", active: true, updatedAt: 1 },
      { id: "mem_jam_crew", kind: "membership", orgId: "jam", accountId: "crew", role: "crew", active: true, updatedAt: 1 },
    ],
  }));
}
function api(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}) },
      res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, json: j }); }); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const login = async (u, pw) => (await api("POST", "/login", { username: u, password: pw })).json;
const sync = async (token, state) => (await api("POST", "/sync", { token, state }, token)).json;
const usersOf = st => ((st && st.state && st.state.users) || []);
const find = (st, id) => usersOf(st).find(u => u && u.id === id) || null;
const custs = st => (((st && st.state && st.state.obx) || {}).customers || []);

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL: " + name); } };

async function main() {
  setup();
  const srv = cp.spawn(process.execPath, ["sync-server.js"], { cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT), TOKEN: SHARED }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1500));
  let _t = 0; const now = () => { let n = Date.now(); if (n <= _t) n = _t + 1; _t = n; return n; };   // strictly-increasing (real clients don't collide updatedAt in the same ms; the sim's fast loop can)
  try {
    // ===== ROLE-CONFIG NORMALIZATION (the Chase fail-open fix) — pure unit checks on the server helpers =====
    // A legacy __roles__ sentinel may carry a built-in crew role with actions:undefined (predates the actions
    // system). The server must NOT read that as "unrestricted", and migrateStore must normalize it (crew.actions=[]
    // + crew.pages gains "data") while leaving genuinely-custom roles untouched and dropping no account.
    const legacyStore = { obx: { customers: [] }, jam: {}, users: [
      { id: "o", username: "o", role: "owner", updatedAt: 1 },
      { id: "c", username: "c", role: "crew", updatedAt: 1 },
      { id: "__roles__", kind: "roles", updatedAt: 1, roles: [
        { key: "owner", label: "Owner", builtin: true },
        { key: "crew", label: "Crew", pages: ["schedule", "time", "today", "messages", "jobs", "inventory", "routes"] },   // actions:undefined, no "data"
        { key: "lead", label: "Lead", pages: ["today"] }                                                                    // CUSTOM role, actions:undefined
      ] }
    ] };
    check("server: legacy crew role (no actions) does NOT manage members (no fail-open)", SS.roleManagesMembers(legacyStore, "crew") === false);
    check("server: custom 'lead' role (no actions) also does NOT manage members (conservative fallback)", SS.roleManagesMembers(legacyStore, "lead") === false);
    check("server: owner always manages members", SS.roleManagesMembers(legacyStore, "owner") === true);
    const mig = SS.migrateStore(JSON.parse(JSON.stringify(legacyStore)));
    const migRoles = mig.users.find(u => u.id === "__roles__").roles;
    const migCrew = migRoles.find(r => r.key === "crew"), migLead = migRoles.find(r => r.key === "lead");
    check("server migrateStore: crew.actions normalized to []", Array.isArray(migCrew.actions) && migCrew.actions.length === 0);
    check("server migrateStore: crew.pages gains 'data' (crew reaches Settings)", migCrew.pages.indexOf("data") >= 0);
    check("server migrateStore: crew keeps its original pages (loss-free)", ["schedule", "time", "today", "jobs", "inventory", "routes"].every(p => migCrew.pages.indexOf(p) >= 0));
    check("server migrateStore: custom 'lead' role UNTOUCHED (no actions injected, pages unchanged)", !Array.isArray(migLead.actions) && JSON.stringify(migLead.pages) === JSON.stringify(["today"]));
    check("server migrateStore: both accounts survive normalization (zero loss)", mig.users.some(u => u.id === "o") && mig.users.some(u => u.id === "c"));

    const ol = await login("ray", "ownerpw"), cl = await login("joe", "crewpw");
    const ownerTok = ol && ol.token, crewTok = cl && cl.token;
    check("owner login issues a 48-hex per-user token", !!ownerTok && ownerTok.length === 48 && ownerTok !== SHARED);
    check("crew login issues a distinct per-user token", !!crewTok && crewTok.length === 48 && crewTok !== ownerTok);

    let st = await sync(ownerTok, { obx: {}, jam: {} });           // initial read → full records (mirror the real client: full records, incl passhash)
    const O = clone(find(st, "owner")), C = clone(find(st, "crew"));
    const ownerHash = O.passhash;

    st = await sync(crewTok, { obx: { customers: [{ id: "c1", name: "Jane", updatedAt: now() }] }, jam: {} });
    check("crew CAN write business data", custs(st).some(c => c.id === "c1"));

    // RECEIPTS: crew are the ones in the field holding receipts, so a crew device MUST be able to push an
    // unattributed "needs review" receipt into the synced receipts collection (the mass-upload path).
    const rcpts = s => (((s && s.state && s.state.obx) || {}).receipts || []);
    st = await sync(crewTok, { obx: { receipts: [{ id: "rc1", receiptId: "blob1", status: "review", type: null, jobId: null, amount: null, uploadedBy: "crew", attributedTo: "crew", updatedAt: now() }] }, jam: {} });
    check("crew CAN upload a review receipt (mass-upload path syncs)", rcpts(st).some(r => r.id === "rc1" && r.status === "review"));

    // VEHICLE UNIFICATION — inventory is crew-writable (no write-authz) so anyone can add a clock-in vehicle;
    // registry.vehicles is owner-only (REG_ADMIN_FIELDS) so a crew push of a registry vehicle is REVERTED. This
    // is exactly why personal/shared vehicles live in inventory, not registry.
    const invOf = s => (((s && s.state && s.state.obx) || {}).inventory || []);
    st = await sync(crewTok, { obx: { inventory: [{ id: "inv-veh-personal-crew", name: "Joe's vehicle", cat: "vehicle", personal: true, ownerId: "crew", clockIn: true, active: true, have: true, updatedAt: now() }] }, jam: {} });
    check("crew CAN add an inventory clock-in vehicle (inventory has no write-authz)", invOf(st).some(i => i.id === "inv-veh-personal-crew" && i.clockIn && i.ownerId === "crew"));
    const regOf = (s, id) => (((s && s.state && s.state.registry) || []).find(r => r && r.id === id) || null);
    st = await sync(crewTok, { registry: [{ id: "obx", vehicles: [{ id: "hack-truck", name: "HACK", active: true, kind: "vehicle" }], updatedAt: now() }], obx: {}, jam: {} });
    check("crew CANNOT add a registry vehicle (registry.vehicles server-protected)", (r => !(r && (r.vehicles || []).some(v => v && v.id === "hack-truck")))(regOf(st, "obx")));

    st = await sync(crewTok, { users: [Object.assign(clone(C), { role: "owner", updatedAt: now() })], obx: {}, jam: {} });
    check("crew CANNOT escalate self to owner", find(st, "crew").role === "crew");
    check("...and the escalation attempt did not drop the crew's password", !!find(st, "crew").passhash);

    st = await sync(crewTok, { users: [Object.assign(clone(O), { passhash: "HACKED", updatedAt: now() })], obx: {}, jam: {} });
    check("crew CANNOT take over the owner's password", find(st, "owner").passhash === ownerHash && find(st, "owner").passhash !== "HACKED");

    st = await sync(crewTok, { users: [{ id: "mole", username: "mole", passhash: "x", role: "owner", updatedAt: now() }], obx: {}, jam: {} });
    check("crew CANNOT create a new account", !find(st, "mole"));

    st = await sync(crewTok, { users: [Object.assign(clone(C), { settings: { theme: "dark" }, role: "owner", updatedAt: now() })], obx: {}, jam: {} });
    check("crew CAN change its own settings (non-sensitive)", find(st, "crew").settings && find(st, "crew").settings.theme === "dark");
    check("...but role is STILL protected on that same write", find(st, "crew").role === "crew");

    // ===== TEAM CONTACT PROFILES + HOME LOCATION — self-write vs others (phone/email/avatarId/title/homeLocation NON-sensitive) =====
    st = await sync(crewTok, { users: [Object.assign(clone(find(st, "crew")), { phone: "252-555-0100", title: "Crew", avatarId: "blobCrew", email: "joe@obx.test", homeLocation: { lat: 36.11, lng: -75.72, label: "Joe's home" }, updatedAt: now() })], obx: {}, jam: {} });
    check("crew CAN set its OWN profile + home location (phone/title/avatar/email/homeLocation)", (u => !!u && u.phone === "252-555-0100" && u.title === "Crew" && u.avatarId === "blobCrew" && u.email === "joe@obx.test" && u.homeLocation && u.homeLocation.lat === 36.11)(find(st, "crew")));
    st = await sync(crewTok, { users: [Object.assign(clone(find(st, "owner")), { phone: "911", avatarId: "HACK", title: "PWNED", homeLocation: { lat: 0, lng: 0, label: "HACK" }, updatedAt: now() })], obx: {}, jam: {} });
    check("crew CANNOT edit another member's profile/home (owner's fields unchanged)", (u => !!u && u.phone !== "911" && u.avatarId !== "HACK" && u.title !== "PWNED" && !(u.homeLocation && u.homeLocation.label === "HACK"))(find(st, "owner")));

    st = await sync(ownerTok, { users: [Object.assign(clone(find(st, "crew")), { phone: "252-555-0199", title: "Lead", homeLocation: { lat: 36.02, lng: -75.67, label: "Owner-set home" }, updatedAt: now() })], obx: {}, jam: {} });
    check("OWNER CAN edit any member's profile + home location (phone/title/homeLocation)", (u => !!u && u.phone === "252-555-0199" && u.title === "Lead" && u.homeLocation && u.homeLocation.label === "Owner-set home")(find(st, "crew")));

    st = await sync(ownerTok, { users: [Object.assign(clone(C), { role: "admin", updatedAt: now() })], obx: {}, jam: {} });
    check("OWNER CAN change the crew's role", find(st, "crew").role === "admin");

    check("no user ever dropped (owner + crew both present)", !!find(st, "owner") && !!find(st, "crew") && usersOf(st).filter(u => !u.kind).length === 2);

    const pres = (await api("GET", "/api/presence", null, ownerTok)).json;
    check("presence recorded for owner + crew", !!pres && !!pres.owner && !!pres.crew);

    // Audit is written AFTER the sync response (best-effort, by design) — poll until it lands rather than racing it.
    let audit = [];
    for (let i = 0; i < 10; i++) { audit = (await api("GET", "/api/audit", null, ownerTok)).json || []; if (audit.some(e => e.c === "account" && e.id === "crew" && e.u === "owner")) break; await new Promise(r => setTimeout(r, 150)); }
    check("audit logged the owner's account change", audit.some(e => e.c === "account" && e.id === "crew" && e.u === "owner"));
    check("audit logged the business-record creation", audit.some(e => e.c === "customers" && e.id === "c1"));

    st = await sync(SHARED, { users: [Object.assign(clone(C), { role: "owner", updatedAt: now() })], obx: {}, jam: {} });
    check("leaked SHARED (legacy) token ALSO cannot escalate", find(st, "crew").role === "admin");   // unchanged from the owner's change above

    // ===== INVITE-BY-EMAIL (server-authoritative account creation; sidesteps the sanitizeUserWrites drop) =====
    const invite = (tok, body) => api("POST", "/invite", body, tok);
    const linkTok = j => (String((j && j.link) || "").match(/reset=([a-f0-9]+)/) || [])[1] || "";
    // 1) a NON-super org-owner CAN invite → account + membership created server-side, emailed:false + a link (no email configured in the temp dir)
    const inv1 = await invite(ownerTok, { org: "obx", name: "Mike Green", email: "mike@obx.test", role: "crew" });
    check("owner CAN invite (200, ok, emailed:false, set-password link)", inv1.status === 200 && inv1.json && inv1.json.ok === true && inv1.json.emailed === false && /\/\?reset=[a-f0-9]{16,}/.test(inv1.json.link || ""));
    const mikeId = inv1.json && inv1.json.user && inv1.json.user.id;
    st = await sync(ownerTok, { obx: {}, jam: {} });
    check("invited account persists (status:invited + a random passhash)", (u => !!u && u.status === "invited" && !!u.passhash)(find(st, mikeId)));
    check("invited MEMBERSHIP created for obx", usersOf(st).some(m => m && m.kind === "membership" && m.accountId === mikeId && m.orgId === "obx"));
    // 2) the invited account survives a SHARED-token push AND a CREW push (NOT dropped by sanitizeUserWrites)
    st = await sync(SHARED, { users: [clone(O), clone(C)], obx: {}, jam: {} });
    check("invited account survives a shared-token push (not dropped)", !!find(st, mikeId));
    st = await sync(crewTok, { obx: { customers: [{ id: "c2", name: "After invite", updatedAt: now() }] }, jam: {} });
    check("invited account survives a crew push (not dropped)", !!find(st, mikeId));
    // 3) the SHARED (legacy) token CANNOT invite — no per-user id → 401 relogin
    const invShared = await invite(SHARED, { org: "obx", name: "X", email: "x@obx.test", role: "crew" });
    check("shared token CANNOT invite (401 + relogin)", invShared.status === 401 && invShared.json && invShared.json.relogin === true);
    // 4) a CREW per-user token CANNOT invite → 403
    const invCrew = await invite(crewTok, { org: "obx", name: "Y", email: "y@obx.test", role: "crew" });
    check("crew per-user token CANNOT invite (403)", invCrew.status === 403);
    // 5) re-inviting a STILL-pending email is an idempotent RESEND (200, same account id + fresh link)
    const resend = await invite(ownerTok, { org: "obx", name: "Mike Green", email: "mike@obx.test", role: "crew" });
    check("re-inviting a pending email → idempotent RESEND (200, same id)", resend.status === 200 && resend.json && resend.json.user && resend.json.user.id === mikeId);
    // 6) the invited account can't log in until /reset; after /reset it can + gets a DISTINCT per-user token
    const preLogin = await api("POST", "/login", { username: "mike", password: "mikepassword1" });
    check("invited account CANNOT log in before /reset", preLogin.status === 401 || !(preLogin.json && preLogin.json.token));
    const rst = await api("POST", "/reset", { token: linkTok(resend.json), password: "mikepassword1" });
    check("invited account sets a password via /reset (200)", rst.status === 200);
    st = await sync(ownerTok, { obx: {}, jam: {} });
    check("the invited status is CLEARED after /reset", !(find(st, mikeId) || {}).status);
    const mikeLogin = await api("POST", "/login", { username: "mike", password: "mikepassword1" });
    check("onboarded member logs in → distinct per-user token", mikeLogin.json && mikeLogin.json.token && [ownerTok, crewTok, SHARED].indexOf(mikeLogin.json.token) < 0);
    // 5b) now that mike is ONBOARDED (status cleared), re-inviting that email → 409 duplicate
    const dup = await invite(ownerTok, { org: "obx", name: "Mike", email: "mike@obx.test", role: "crew" });
    check("duplicate email of an onboarded account → 409", dup.status === 409);
    // 7) a NON-super owner inviting role=owner is COERCED down (never an owner) — no privilege escalation
    const inv7 = await invite(ownerTok, { org: "obx", name: "Sneaky", email: "sneaky@obx.test", role: "owner" });
    check("non-super owner inviting role=owner → account coerced to non-owner", inv7.status === 200 && inv7.json && inv7.json.user && inv7.json.user.role !== "owner");
    st = await sync(ownerTok, { obx: {}, jam: {} });
    check("...and the coerced member's membership role is not owner", (m => !!m && m.role !== "owner")(usersOf(st).find(x => x && x.kind === "membership" && x.accountId === (inv7.json.user && inv7.json.user.id) && x.orgId === "obx")));
    check("no original account was ever dropped by the invite flow", !!find(st, "owner") && !!find(st, "crew"));

    // ===== LOG OUT EVERYWHERE =====
    const t0 = now();
    st = await sync(ownerTok, { users: [Object.assign(clone(find(st, "crew")), { logoutAt: t0, updatedAt: now() })], obx: {}, jam: {} });
    check("owner CAN force-logout the crew (sets logoutAt)", find(st, "crew").logoutAt === t0);
    const revoked = await api("POST", "/sync", { token: crewTok, state: { obx: {}, jam: {} } }, crewTok);
    check("crew's existing token is now revoked (401)", revoked.status === 401);
    const cl2 = await login("joe", "crewpw"); const crewTok2 = cl2 && cl2.token;
    const reSync = await api("POST", "/sync", { token: crewTok2, state: { obx: {}, jam: {} } }, crewTok2);
    check("crew logs back in → fresh token syncs (200)", !!crewTok2 && crewTok2 !== crewTok && reSync.status === 200);
    const ownerRec = (((reSync.json || {}).state || {}).users || []).find(u => u.id === "owner");
    st = await sync(crewTok2, { users: [Object.assign(clone(ownerRec), { logoutAt: now() + 1e7, updatedAt: now() })], obx: {}, jam: {} });
    check("crew CANNOT force-logout the owner (logoutAt protected)", !find(st, "owner").logoutAt);

    const ownerNow = clone(find(st, "owner"));
    st = await sync(crewTok2, { users: [Object.assign(ownerNow, { adminPin: "999", updatedAt: now() })], obx: {}, jam: {} });
    check("crew CANNOT set the owner's Admin PIN (adminPin protected)", !find(st, "owner").adminPin);
    // adminPin is SELF-settable even on the shared token (real client sends its userId)
    st = (await api("POST", "/sync", { token: SHARED, userId: "crew", state: { users: [Object.assign(clone(find(st, "crew")), { adminPin: "SELFPIN", updatedAt: now() })], obx: {}, jam: {} } }, SHARED)).json;
    check("a user CAN set their OWN admin PIN (even on the shared token)", find(st, "crew").adminPin === "SELFPIN");
    st = (await api("POST", "/sync", { token: SHARED, userId: "crew", state: { users: [Object.assign(clone(find(st, "owner")), { adminPin: "HACK", updatedAt: now() })], obx: {}, jam: {} } }, SHARED)).json;
    check("but CANNOT set someone ELSE's admin PIN", find(st, "owner").adminPin !== "HACK");
  } catch (e) { console.log("  ✗ FAIL: simulation threw " + (e && e.message)); fail++; }
  finally { srv.kill(); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {} }
  console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
