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
    const ol = await login("ray", "ownerpw"), cl = await login("joe", "crewpw");
    const ownerTok = ol && ol.token, crewTok = cl && cl.token;
    check("owner login issues a 48-hex per-user token", !!ownerTok && ownerTok.length === 48 && ownerTok !== SHARED);
    check("crew login issues a distinct per-user token", !!crewTok && crewTok.length === 48 && crewTok !== ownerTok);

    let st = await sync(ownerTok, { obx: {}, jam: {} });           // initial read → full records (mirror the real client: full records, incl passhash)
    const O = clone(find(st, "owner")), C = clone(find(st, "crew"));
    const ownerHash = O.passhash;

    st = await sync(crewTok, { obx: { customers: [{ id: "c1", name: "Jane", updatedAt: now() }] }, jam: {} });
    check("crew CAN write business data", custs(st).some(c => c.id === "c1"));

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
