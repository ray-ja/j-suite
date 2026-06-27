/* org-sim.js — multi-tenant ISOLATION simulation. Spins up an isolated server with 3 orgs (obx, jam,
   escaperoom) and 3 users — ray (super-admin, member of obx+jam), joe (crew, obx only), eve (crew,
   escaperoom only) — and asserts: a member receives + can write ONLY their orgs; a super-admin sees all;
   cross-org reads/writes are impossible; and a scoped sync never drops a sibling org.
   Run: node org-sim.js  → exits 0 (all green) / 1 (any failure). Touches nothing real. */
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process"), http = require("http");
const SS = require("./sync-server");
const PORT = 4086, SHARED = "sim-shared";
const ROOT = __dirname, DIR = path.join(os.tmpdir(), "orgsim-" + process.pid);
let _t = 0; const now = () => { let n = Date.now(); if (n <= _t) n = _t + 1; _t = n; return n; };

function setup() {
  fs.mkdirSync(path.join(DIR, "js"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "sync-server.js"), path.join(DIR, "sync-server.js"));
  ["qb-bridge.js", "availability-resolve.js"].forEach(f => { try { fs.copyFileSync(path.join(ROOT, f), path.join(DIR, f)); } catch (e) {} });
  fs.writeFileSync(path.join(DIR, "js", "x.js"), "//x");
  const H = SS.scryptHash;
  fs.writeFileSync(path.join(DIR, "data.json"), JSON.stringify({
    obx: { customers: [{ id: "obxc1", name: "OBX Cust", updatedAt: 1 }] },
    jam: { customers: [{ id: "jamc1", name: "Jam Cust", updatedAt: 1 }] },
    escaperoom: { customers: [{ id: "escc1", name: "Escape Cust", updatedAt: 1 }] },
    registry: [{ id: "obx", name: "OBX", updatedAt: 1 }, { id: "jam", name: "Jamieson", updatedAt: 1 }, { id: "escaperoom", name: "Escape Room", updatedAt: 1 }],
    users: [
      { id: "ray", username: "ray", passhash: H("pw"), role: "owner", superAdmin: true, updatedAt: 1 },
      { id: "joe", username: "joe", passhash: H("pw"), role: "crew", updatedAt: 1 },
      { id: "eve", username: "eve", passhash: H("pw"), role: "crew", updatedAt: 1 },
      { id: "mem_obx_ray", kind: "membership", orgId: "obx", accountId: "ray", role: "owner", active: true, updatedAt: 1 },
      { id: "mem_jam_ray", kind: "membership", orgId: "jam", accountId: "ray", role: "owner", active: true, updatedAt: 1 },
      { id: "mem_obx_joe", kind: "membership", orgId: "obx", accountId: "joe", role: "crew", active: true, updatedAt: 1 },
      { id: "mem_escaperoom_eve", kind: "membership", orgId: "escaperoom", accountId: "eve", role: "crew", active: true, updatedAt: 1 },
    ],
  }));
}
function api(method, p, body, token) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}) },
      x => { let s = ""; x.on("data", c => s += c); x.on("end", () => { let j = null; try { j = JSON.parse(s); } catch (e) {} res({ status: x.statusCode, json: j }); }); });
    r.on("error", rej); if (d) r.write(d); r.end();
  });
}
const login = async u => (await api("POST", "/login", { username: u, password: "pw" })).json;
const sync = async (token, state) => (await api("POST", "/sync", { token, state: state || {} }, token)).json;
const orgsIn = st => Object.keys((st && st.state) || {}).filter(k => k !== "users" && k !== "registry");
const custIds = (st, oid) => (((st && st.state && st.state[oid]) || {}).customers || []).map(c => c.id);
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n); } };

async function main() {
  setup();
  const srv = cp.spawn(process.execPath, ["sync-server.js"], { cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT), TOKEN: SHARED }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1500));
  try {
    const joeTok = (await login("joe")).token, eveTok = (await login("eve")).token, rayTok = (await login("ray")).token;
    check("logins issue distinct per-user tokens", !!joeTok && !!eveTok && !!rayTok && joeTok !== eveTok);

    let st = await sync(joeTok, {});
    check("joe (obx member) RECEIVES obx", orgsIn(st).indexOf("obx") >= 0);
    check("joe does NOT receive jam", orgsIn(st).indexOf("jam") < 0);
    check("joe does NOT receive escaperoom", orgsIn(st).indexOf("escaperoom") < 0);
    check("joe's registry = only obx (other orgs invisible)", (st.state.registry || []).length === 1 && st.state.registry[0].id === "obx");
    check("joe sees co-member ray's account, NOT eve's", !!st.state.users.find(u => u.id === "ray") && !st.state.users.find(u => u.id === "eve"));
    check("joe sees obx memberships only (no escaperoom membership leaks)", !st.state.users.find(u => u && u.kind === "membership" && u.orgId === "escaperoom"));

    await sync(joeTok, { escaperoom: { customers: [{ id: "hack", name: "Hacked", updatedAt: now() }] } });   // joe attempts a cross-org write
    let evest = await sync(eveTok, {});
    check("joe CANNOT write escaperoom (the 'hack' record never lands)", custIds(evest, "escaperoom").indexOf("hack") < 0);

    check("eve (escaperoom member) RECEIVES escaperoom", orgsIn(evest).indexOf("escaperoom") >= 0);
    check("eve does NOT receive obx or jam", orgsIn(evest).indexOf("obx") < 0 && orgsIn(evest).indexOf("jam") < 0);
    check("eve does NOT see ray's or joe's accounts", !evest.state.users.find(u => u.id === "ray") && !evest.state.users.find(u => u.id === "joe"));

    await sync(joeTok, { users: [{ id: "joe", username: "joe", role: "crew", superAdmin: true, updatedAt: now() }] });   // joe tries to escalate to platform owner
    let joe2 = await sync(joeTok, {});
    check("crew CANNOT self-escalate to super-admin (still scoped to obx only)", orgsIn(joe2).indexOf("jam") < 0 && orgsIn(joe2).indexOf("escaperoom") < 0);

    let rayst = await sync(rayTok, {});
    check("ray (super-admin) RECEIVES all 3 orgs", ["obx", "jam", "escaperoom"].every(o => orgsIn(rayst).indexOf(o) >= 0));
    check("super-admin sees every account", !!rayst.state.users.find(u => u.id === "eve") && !!rayst.state.users.find(u => u.id === "joe"));
    check("scoped syncs never dropped a sibling org (jam + escaperoom data intact)", custIds(rayst, "jam").indexOf("jamc1") >= 0 && custIds(rayst, "escaperoom").indexOf("escc1") >= 0);
  } catch (e) { console.log("  ✗ FAIL: simulation threw " + (e && e.message)); fail++; }
  finally { srv.kill(); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {} }
  console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
