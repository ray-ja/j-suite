/* helper-migration-test.js — MANDATORY migration fixture for the ADD-A-HELPER (no login) feature.
 *
 * Loads a realistic PROD-SHAPED data.json (owner+super-admin, two onboarded crew, memberships, business records
 * across obx/jam), spins up a LIVE sync-server against it, then:
 *   1) logs in as the owner and calls POST /helper (name-only, no email/password),
 *   2) does a /sync round-trip from the OWNER token AND from a legacy SHARED-token AND from a CREW device,
 * and asserts ZERO LOSS + the login-less helper shape:
 *   • every original account + membership + customer/property/quote/job survives,
 *   • the new helper account + membership are present (status:"helper", role:"crew", no email, random passhash),
 *   • the helper CANNOT sign in (POST /login with no/any password fails),
 *   • the helper is NOT dropped by a shared-token or crew push (the account-drop bug class),
 *   • a name-only helper needs a name (empty name → 400) and non-owners can't create one (403).
 *
 * Touches nothing real — its own temp dir, killed + removed on exit. Run: node helper-migration-test.js */
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process"), http = require("http");
const SS = require("./sync-server");
const PORT = 4093, SHARED = "helpermig-shared-token";
const ROOT = __dirname, DIR = path.join(os.tmpdir(), "helpermig-" + process.pid);
const clone = o => JSON.parse(JSON.stringify(o));

const fixture = {
  obx: {
    customers: [{ id: "c1", name: "Mike Green", updatedAt: 100 }, { id: "c2", name: "Sandy Shores LLC", updatedAt: 101 }],
    properties: [{ id: "p1", customerId: "c1", address: "123 Duck Rd", updatedAt: 102 }],
    quotes: [{ id: "q1", customerId: "c1", total: 1800, updatedAt: 103 }],
    jobs: [{ id: "j1", customerId: "c1", title: "Patio expansion", date: "2026-07-01", updatedAt: 104 }],
  },
  jam: { customers: [{ id: "jc1", name: "Jamieson Client", updatedAt: 110 }], quotes: [], jobs: [] },
  users: [
    { id: "u_ray", username: "rj", passhash: SS.scryptHash("rayownerpw"), role: "owner", active: true, superAdmin: true, email: "ray@obx.test", updatedAt: 200 },
    { id: "u_chase", username: "chase", passhash: SS.scryptHash("chasepw"), role: "crew", active: true, email: "chase@obx.test", updatedAt: 201 },
    { id: "u_pierce", username: "pierce", passhash: SS.scryptHash("piercepw"), role: "crew", active: true, email: "pierce@obx.test", updatedAt: 202 },
    { id: "mem_obx_u_ray", kind: "membership", orgId: "obx", accountId: "u_ray", role: "owner", active: true, updatedAt: 1 },
    { id: "mem_jam_u_ray", kind: "membership", orgId: "jam", accountId: "u_ray", role: "owner", active: true, updatedAt: 1 },
    { id: "mem_obx_u_chase", kind: "membership", orgId: "obx", accountId: "u_chase", role: "crew", active: true, updatedAt: 1 },
    { id: "mem_obx_u_pierce", kind: "membership", orgId: "obx", accountId: "u_pierce", role: "crew", active: true, updatedAt: 1 },
  ],
};

function setup() {
  fs.mkdirSync(path.join(DIR, "js"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "sync-server.js"), path.join(DIR, "sync-server.js"));
  ["qb-bridge.js", "availability-resolve.js"].forEach(f => { try { fs.copyFileSync(path.join(ROOT, f), path.join(DIR, f)); } catch (e) {} });
  try { fs.copyFileSync(path.join(ROOT, "js", "82-tax-estimator.js"), path.join(DIR, "js", "82-tax-estimator.js")); } catch (e) {}
  fs.writeFileSync(path.join(DIR, "data.json"), JSON.stringify(fixture));
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
const coll = (st, org, c) => (((st && st.state && st.state[org]) || {})[c] || []);

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL: " + name); } };

async function main() {
  setup();
  const srv = cp.spawn(process.execPath, ["sync-server.js"], { cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT), TOKEN: SHARED }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1500));
  let _t = Date.now(); const now = () => { let n = Date.now(); if (n <= _t) n = _t + 1; _t = n; return n; };
  try {
    const ol = await login("rj", "rayownerpw");
    const ownerTok = ol && ol.token;
    check("owner logs in (per-user token issued)", !!ownerTok && ownerTok !== SHARED);

    // ---- name-only guardrails ----
    const noName = await api("POST", "/helper", { org: "obx", name: "  " }, ownerTok);
    check("empty name rejected (400)", noName.status === 400);
    const cl0 = await login("chase", "chasepw");
    const crewTry = await api("POST", "/helper", { org: "obx", name: "Sneaky" }, cl0 && cl0.token);
    check("a non-owner crew member cannot create a helper (403)", crewTry.status === 403);

    // ---- add a name-only helper (server-authoritative) ----
    const hp = await api("POST", "/helper", { org: "obx", name: "Dad" }, ownerTok);
    check("owner /helper succeeds (200, ok, user.helper)", hp.status === 200 && hp.json && hp.json.ok && hp.json.user && hp.json.user.helper === true && hp.json.user.role === "crew");
    const helperId = hp.json && hp.json.user && hp.json.user.id;
    check("helper id is a real account id", typeof helperId === "string" && /^u_/.test(helperId));

    // ---- round-trip from the OWNER: zero loss + helper shape ----
    let st = await sync(ownerTok, { obx: {}, jam: {} });
    ["u_ray", "u_chase", "u_pierce"].forEach(id => check("original account " + id + " survives", !!find(st, id)));
    ["mem_obx_u_ray", "mem_jam_u_ray", "mem_obx_u_chase", "mem_obx_u_pierce"].forEach(id => check("original membership " + id + " survives", usersOf(st).some(m => m && m.id === id)));
    check("obx customers survive (2)", coll(st, "obx", "customers").length === 2);
    check("obx property survives", coll(st, "obx", "properties").some(p => p.id === "p1"));
    check("obx quote survives", coll(st, "obx", "quotes").some(q => q.id === "q1"));
    check("obx job survives", coll(st, "obx", "jobs").some(j => j.id === "j1"));
    check("jam customer survives", coll(st, "jam", "customers").some(c => c.id === "jc1"));
    const hAcct = find(st, helperId);
    check("helper account present after round-trip", !!hAcct);
    check("helper has name 'Dad'", hAcct && hAcct.name === "Dad");
    check("helper has status:'helper'", hAcct && hAcct.status === "helper");
    check("helper flagged helper:true", hAcct && hAcct.helper === true);
    check("helper role is crew", hAcct && hAcct.role === "crew");
    check("helper is active", hAcct && hAcct.active === true);
    check("helper has NO email", hAcct && (hAcct.email === "" || hAcct.email == null));
    check("helper has a random passhash that round-trips", hAcct && typeof hAcct.passhash === "string" && hAcct.passhash.length > 20);
    check("helper membership present for obx (role crew)", usersOf(st).some(m => m && m.kind === "membership" && m.accountId === helperId && m.orgId === "obx" && m.role === "crew"));

    // ---- the helper CANNOT sign in ----
    const li1 = await login(hAcct && hAcct.username, "");
    check("helper can't log in with empty password", !(li1 && li1.token));
    const li2 = await login(hAcct && hAcct.username, "password");
    check("helper can't log in with a guessed password", !(li2 && li2.token));

    // ---- a legacy SHARED-token device re-pushing ONLY the original accounts must NOT drop the helper ----
    const origAccts = fixture.users.filter(u => u && !u.kind).map(clone);
    st = await sync(SHARED, { users: origAccts, obx: { customers: fixture.obx.customers.map(clone) }, jam: {} });
    check("helper NOT dropped by a shared-token push", !!find(st, helperId));
    check("helper membership NOT dropped by a shared-token push", usersOf(st).some(m => m && m.accountId === helperId && m.orgId === "obx"));
    check("business records intact after shared-token push (customers still 2)", coll(st, "obx", "customers").length === 2);

    // ---- a CREW push must also not drop the helper ----
    const cl = await login("chase", "chasepw");
    st = await sync(cl && cl.token, { obx: { customers: [{ id: "c3", name: "Crew-added", updatedAt: now() }] }, jam: {} });
    check("helper NOT dropped by a crew push", !!find(st, helperId));
    check("crew's own new customer applied (business writes still work)", coll(st, "obx", "customers").some(c => c.id === "c3"));
    check("helper still login-less after all round-trips (status helper, no email)", (function () { const h = find(st, helperId); return h && h.status === "helper" && (h.email === "" || h.email == null); })());
  } catch (e) { console.log("  ✗ FAIL: fixture threw " + (e && e.message)); fail++; }
  finally { srv.kill(); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {} }
  console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
