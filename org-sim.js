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
  try { fs.copyFileSync(path.join(ROOT, "js", "82-tax-estimator.js"), path.join(DIR, "js", "82-tax-estimator.js")); } catch (e) {}   // sync-server requires the tax estimator (P2)
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
      { id: "moe", username: "moe", passhash: H("pw"), role: "crew", updatedAt: 1 },
      { id: "eve", username: "eve", passhash: H("pw"), role: "crew", updatedAt: 1 },
      { id: "liz", username: "liz", passhash: H("pw"), role: "crew", updatedAt: 1 },   // escaperoom MANAGER (role hierarchy)
      { id: "gus", username: "gus", passhash: H("pw"), role: "crew", updatedAt: 1 },   // escaperoom game-guide (target of manager writes)
      // role registry sentinel — defines the manager tier's "manage-members" grant (owner-only to write; trusted as stored state)
      { id: "__roles__", kind: "roles", roles: [
        { key: "owner", label: "Owner", builtin: true },
        { key: "manager", label: "Manager", actions: ["assign-guides", "edit-schedule", "edit-settings", "manage-members", "edit-tools"] },
        { key: "supervisor", label: "Supervisor", actions: ["assign-guides", "edit-schedule"] },
        { key: "game-guide", label: "Game guide", actions: [] },
        { key: "crew", label: "Crew", actions: [] },
      ], updatedAt: 1 },
      { id: "mem_obx_ray", kind: "membership", orgId: "obx", accountId: "ray", role: "owner", active: true, updatedAt: 1 },
      { id: "mem_jam_ray", kind: "membership", orgId: "jam", accountId: "ray", role: "owner", active: true, updatedAt: 1 },
      { id: "mem_obx_joe", kind: "membership", orgId: "obx", accountId: "joe", role: "owner", active: true, updatedAt: 1 },
      { id: "mem_obx_moe", kind: "membership", orgId: "obx", accountId: "moe", role: "crew", active: true, updatedAt: 1 },
      { id: "mem_escaperoom_eve", kind: "membership", orgId: "escaperoom", accountId: "eve", role: "crew", active: true, updatedAt: 1 },
      { id: "mem_escaperoom_liz", kind: "membership", orgId: "escaperoom", accountId: "liz", role: "manager", active: true, updatedAt: 1 },
      { id: "mem_escaperoom_gus", kind: "membership", orgId: "escaperoom", accountId: "gus", role: "game-guide", active: true, updatedAt: 1 },
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
const memRole = (st, accId, orgId) => { const m = ((st && st.state && st.state.users) || []).find(u => u && u.kind === "membership" && u.accountId === accId && u.orgId === orgId); return m ? m.role : null; };
const hasMem = (st, id) => ((st && st.state && st.state.users) || []).some(u => u && u.id === id);
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n); } };

async function main() {
  setup();
  const srv = cp.spawn(process.execPath, ["sync-server.js"], { cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT), TOKEN: SHARED }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1500));
  try {
    const joeTok = (await login("joe")).token, eveTok = (await login("eve")).token, rayTok = (await login("ray")).token, moeTok = (await login("moe")).token;
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

    // ===== org CREATION (the phantom-org fix): super-admin can create a new org whose slab PERSISTS =====
    await sync(rayTok, { newroom: { customers: [{ id: "nr1", name: "New Cust", updatedAt: now() }] }, registry: [{ id: "newroom", name: "New Room", updatedAt: now() }] });
    let raycreate = await sync(rayTok, {});
    check("super-admin CAN create a new org — its slab PERSISTS (not a phantom)", orgsIn(raycreate).indexOf("newroom") >= 0 && custIds(raycreate, "newroom").indexOf("nr1") >= 0);
    await sync(joeTok, { joeorg: { customers: [{ id: "jo1", updatedAt: now() }] }, registry: [{ id: "joeorg", name: "Joe Org", updatedAt: now() }] });   // non-super tries to create an org
    let rayafter = await sync(rayTok, {});
    check("a NON-super CANNOT create an org (slab + registry both dropped)", orgsIn(rayafter).indexOf("joeorg") < 0 && !(rayafter.state.registry || []).some(r => r.id === "joeorg"));

    // ===== MESSAGES soft-delete permission (end-to-end /sync): own-message delete OK; another's BLOCKED; owner deletes any + a thread =====
    // moe is still plain obx CREW here (promoted to admin below). joe is the obx OWNER. Seed a thread + two messages.
    const msgOf = (st, id) => (((st && st.state && st.state.obx) || {}).messages || []).find(m => m && m.id === id);
    await sync(moeTok, { obx: { messages: [
      { id: "om_thr", kind: "thread", threadId: "om_thr", title: "Crew", type: "dm", members: ["moe", "joe"], createdBy: "moe", deleted: false, updatedAt: now() },
      { id: "om_moe", threadId: "om_thr", senderId: "moe", senderLabel: "moe", body: "moe says hi", ts: now(), deleted: false, updatedAt: now() },
      { id: "om_joe", threadId: "om_thr", senderId: "joe", senderLabel: "joe", body: "joe says hi", ts: now(), deleted: false, updatedAt: now() },
    ] } });
    await sync(moeTok, { obx: { messages: [{ id: "om_moe", threadId: "om_thr", senderId: "moe", senderLabel: "moe", body: "moe says hi", ts: 1, deleted: true, updatedAt: now() }] } });   // moe deletes his OWN
    let mst = await sync(joeTok, {});
    check("crew deletes OWN message (e2e) → tombstoned", !!msgOf(mst, "om_moe") && msgOf(mst, "om_moe").deleted === true);
    await sync(moeTok, { obx: { messages: [{ id: "om_joe", threadId: "om_thr", senderId: "joe", senderLabel: "joe", body: "joe says hi", ts: 1, deleted: true, updatedAt: now() }] } });   // moe (crew) tries to delete JOE's
    mst = await sync(joeTok, {});
    check("crew deletes ANOTHER's message (e2e) → BLOCKED server-side (stays visible)", !!msgOf(mst, "om_joe") && msgOf(mst, "om_joe").deleted !== true);
    await sync(joeTok, { obx: { messages: [{ id: "om_joe", threadId: "om_thr", senderId: "joe", senderLabel: "joe", body: "joe says hi", ts: 1, deleted: true, updatedAt: now() }] } });   // owner deletes ANY
    mst = await sync(joeTok, {});
    check("owner deletes ANY message (e2e) → tombstoned", !!msgOf(mst, "om_joe") && msgOf(mst, "om_joe").deleted === true);
    await sync(moeTok, { obx: { messages: [{ id: "om_thr", kind: "thread", threadId: "om_thr", title: "Crew", type: "dm", members: ["moe", "joe"], createdBy: "moe", deleted: true, updatedAt: now() }] } });   // crew tries to delete the THREAD
    mst = await sync(joeTok, {});
    check("crew deletes a THREAD (e2e) → BLOCKED (thread stays alive)", !!msgOf(mst, "om_thr") && msgOf(mst, "om_thr").deleted !== true);
    await sync(joeTok, { obx: { messages: [{ id: "om_thr", kind: "thread", threadId: "om_thr", title: "Crew", type: "dm", members: ["moe", "joe"], createdBy: "moe", deleted: true, updatedAt: now() }] } });   // owner deletes the THREAD
    mst = await sync(joeTok, {});
    check("owner deletes a THREAD (e2e) → tombstoned (its messages still present, no resurrection)", msgOf(mst, "om_thr").deleted === true && !!msgOf(mst, "om_moe") && msgOf(mst, "om_moe").deleted === true);

    // ===== per-org NAV ORDER (admin-controlled menu order) — end-to-end /sync permission gate =====
    const regOf = (st, id) => ((st && st.state && st.state.registry) || []).find(r => r && r.id === id);
    // joe is the obx OWNER → may set navOrder; it lands and syncs to the whole org.
    await sync(joeTok, { registry: [{ id: "obx", name: "OBX", navOrder: ["admin", "today", "money"], updatedAt: now() }] });
    rayst = await sync(rayTok, {});
    check("org-owner CAN set navOrder (e2e) — it lands", JSON.stringify((regOf(rayst, "obx") || {}).navOrder) === JSON.stringify(["admin", "today", "money"]));
    let joeSees = await sync(joeTok, {});
    check("the org's members RECEIVE the admin-set navOrder (everyone in the org sees it)", JSON.stringify((regOf(joeSees, "obx") || {}).navOrder) === JSON.stringify(["admin", "today", "money"]));
    // moe is still obx CREW here → a navOrder write must be REVERTED to the owner's stored order.
    await sync(moeTok, { registry: [{ id: "obx", name: "OBX", navOrder: ["money", "admin", "today"], updatedAt: now() }] });
    rayst = await sync(rayTok, {});
    check("crew CANNOT set navOrder (e2e) → reverted to the admin's order", JSON.stringify((regOf(rayst, "obx") || {}).navOrder) === JSON.stringify(["admin", "today", "money"]));
    check("...and the crew navOrder attempt did NOT corrupt the org name", (regOf(rayst, "obx") || {}).name === "OBX");

    // ===== org-admin tier: an org OWNER manages their org's memberships (but only theirs) =====
    await sync(joeTok, { users: [{ id: "mem_obx_moe", kind: "membership", orgId: "obx", accountId: "moe", role: "admin", active: true, updatedAt: now() }] });   // joe (obx OWNER) promotes moe
    rayst = await sync(rayTok, {});
    check("org-owner CAN set a member's role in their own org (moe → admin)", memRole(rayst, "moe", "obx") === "admin");
    await sync(joeTok, { users: [{ id: "mem_jam_joe", kind: "membership", orgId: "jam", accountId: "joe", role: "owner", active: true, updatedAt: now() }] });   // joe tries to add himself to jam
    rayst = await sync(rayTok, {});
    check("org-owner CANNOT write memberships for an org they don't own (no mem_jam_joe)", !hasMem(rayst, "mem_jam_joe"));
    await sync(moeTok, { users: [{ id: "mem_obx_moe", kind: "membership", orgId: "obx", accountId: "moe", role: "owner", active: true, updatedAt: now() }] });   // moe (now admin, not owner) tries to self-promote to owner
    rayst = await sync(rayTok, {});
    check("a non-owner member CANNOT self-promote to org owner", memRole(rayst, "moe", "obx") === "admin");
    // moe is now an obx ADMIN → may set navOrder (admin, not just owner).
    await sync(moeTok, { registry: [{ id: "obx", name: "OBX", navOrder: ["today", "money", "admin"], updatedAt: now() }] });
    rayst = await sync(rayTok, {});
    check("an org ADMIN CAN set navOrder (e2e) — the admin's order lands", JSON.stringify((regOf(rayst, "obx") || {}).navOrder) === JSON.stringify(["today", "money", "admin"]));

    // ===== role hierarchy (Phase 3e): the escaperoom MANAGER tier may manage members, but RESTRICTED =====
    const lizTok = (await login("liz")).token, gusTok = (await login("gus")).token;
    await sync(lizTok, { users: [{ id: "mem_escaperoom_gus", kind: "membership", orgId: "escaperoom", accountId: "gus", role: "supervisor", active: true, updatedAt: now() }] });   // manager promotes a guide → supervisor
    rayst = await sync(rayTok, {});
    check("manager CAN set a member's role in their own org (gus guide → supervisor)", memRole(rayst, "gus", "escaperoom") === "supervisor");
    await sync(lizTok, { users: [{ id: "mem_escaperoom_gus", kind: "membership", orgId: "escaperoom", accountId: "gus", role: "owner", active: true, updatedAt: now() }] });   // manager tries to grant OWNER
    rayst = await sync(rayTok, {});
    check("manager CANNOT grant the owner role (no escalation of others)", memRole(rayst, "gus", "escaperoom") === "supervisor");
    await sync(lizTok, { users: [{ id: "mem_escaperoom_liz", kind: "membership", orgId: "escaperoom", accountId: "liz", role: "owner", active: true, updatedAt: now() }] });   // manager tries to self-promote to owner
    rayst = await sync(rayTok, {});
    check("manager CANNOT self-promote to org owner", memRole(rayst, "liz", "escaperoom") === "manager");
    await sync(lizTok, { users: [{ id: "mem_escaperoom_eve", kind: "membership", orgId: "escaperoom", accountId: "eve", role: "manager", active: true, updatedAt: now() }] });   // manager promotes a crew member → manager (allowed, not owner)
    rayst = await sync(rayTok, {});
    check("manager CAN promote a member to another non-owner role (eve → manager)", memRole(rayst, "eve", "escaperoom") === "manager");
    await sync(lizTok, { users: [{ id: "mem_obx_moe", kind: "membership", orgId: "obx", accountId: "moe", role: "manager", active: true, updatedAt: now() }] });   // escaperoom manager tries to write into obx
    rayst = await sync(rayTok, {});
    check("manager CANNOT manage memberships for an org they aren't in (obx untouched)", memRole(rayst, "moe", "obx") === "admin");
    await sync(gusTok, { users: [{ id: "mem_escaperoom_eve", kind: "membership", orgId: "escaperoom", accountId: "eve", role: "crew", active: true, updatedAt: now() }] });   // a game-guide (no manage-members) tries to change a role
    rayst = await sync(rayTok, {});
    check("a game-guide (no manage-members action) CANNOT manage members", memRole(rayst, "eve", "escaperoom") === "manager");

    // unit-level checks on the server's hierarchy helpers against a synthetic store (stored-state authoritative)
    const synthStore = { users: [
      { id: "__roles__", kind: "roles", roles: [{ key: "manager", actions: ["manage-members"] }, { key: "supervisor", actions: ["assign-guides"] }] },
      { id: "m1", kind: "membership", orgId: "z", accountId: "mgr", role: "manager", active: true },
      { id: "m2", kind: "membership", orgId: "z", accountId: "sup", role: "supervisor", active: true },
    ] };
    check("roleManagesMembers: manager (granted) → true", SS.roleManagesMembers(synthStore, "manager") === true);
    check("roleManagesMembers: supervisor (not granted) → false", SS.roleManagesMembers(synthStore, "supervisor") === false);
    check("roleManagesMembers: crew/game-guide → false", SS.roleManagesMembers(synthStore, "game-guide") === false && SS.roleManagesMembers(synthStore, "crew") === false);
    check("writerManagesOrg: manager member → true for own org", SS.writerManagesOrg(synthStore, "mgr", "z") === true);
    check("writerManagesOrg: supervisor member → false", SS.writerManagesOrg(synthStore, "sup", "z") === false);

    // ===== per-org AI config (Phase 4) — one-way key, owner-gated, never echoed, per-org =====
    let aiCfg = await api("POST", "/api/org-ai/config", { org: "obx", enabled: true, apiKey: "sk-ant-fake-test-key" }, joeTok);
    check("org-owner CAN configure AI (enabled + key stored)", aiCfg.status === 200 && aiCfg.json.enabled === true && aiCfg.json.hasKey === true);
    check("AI status NEVER echoes the API key", !!aiCfg.json && !("apiKey" in aiCfg.json) && JSON.stringify(aiCfg.json).indexOf("sk-ant") < 0);
    let aiMoe = await api("POST", "/api/org-ai/config", { org: "obx", enabled: false }, moeTok);
    check("a non-owner CANNOT configure an org's AI (403)", aiMoe.status === 403);
    let aiSt = await api("GET", "/api/org-ai/status?org=obx", null, moeTok);
    check("a member CAN read AI status (and it carries no key)", aiSt.status === 200 && aiSt.json.hasKey === true && !("apiKey" in aiSt.json));
    let aiEve = await api("GET", "/api/org-ai/status?org=obx", null, eveTok);
    check("a NON-member CANNOT read another org's AI status (403)", aiEve.status === 403);
    let aiAsk = await api("POST", "/api/org-ai/ask", { org: "jam", question: "hi" }, rayTok);
    check("ask fails cleanly when an org has no AI configured (400)", aiAsk.status === 400);
    // ===== per-function AI MODEL PICKER — allowlisted, owner-gated, server-authoritative =====
    let aiMod = await api("POST", "/api/org-ai/config", { org: "obx", models: { ask: "claude-opus-4-8", digest: "claude-fable-5", assistant: "not-a-real-model", receipt: "" } }, joeTok);
    check("model picker: allowlisted picks stored, bogus value skipped, empty cleared", aiMod.status === 200 && aiMod.json.models && aiMod.json.models.ask === "claude-opus-4-8" && aiMod.json.models.digest === "claude-fable-5" && !("assistant" in aiMod.json.models) && !("receipt" in aiMod.json.models));
    let aiModNon = await api("POST", "/api/org-ai/config", { org: "obx", models: { ask: "claude-haiku-4-5-20251001" } }, moeTok);
    check("model picker: a non-owner CANNOT change AI models (403)", aiModNon.status === 403);
    let aiModSt = await api("GET", "/api/org-ai/status?org=obx", null, moeTok);
    check("model picker: status carries the saved allowlisted picks (no key)", aiModSt.status === 200 && aiModSt.json.models && aiModSt.json.models.ask === "claude-opus-4-8" && !("apiKey" in aiModSt.json));

    // ===== WORKSHOP (customJobs) — end-to-end /sync write-authz + the preview route =====
    // roles now: joe = obx OWNER, moe = obx ADMIN (promoted earlier), eve = escaperoom only.
    const jobOf = (st, id) => (((st && st.state && st.state.obx) || {}).customJobs || []).find(j => j && j.id === id);
    const mkJob = (over) => Object.assign({ id: "cjob_x", org: "obx", name: "Job", dataScope: ["quotes"], prompt: "list open quotes", schedule: { kind: "daily", hour: 7, min: 0, tz: "America/New_York" }, deliverTo: { mode: "private", threadId: null }, action: { mode: "report" }, model: null, maxRows: null, active: true, createdBy: "x", lastRun: null, createdAt: now(), updatedAt: now(), deleted: false }, over || {});
    // obx members RECEIVE the seeded Sentinel example
    let joeWs = await sync(joeTok, {});
    check("WORKSHOP: obx members receive the seeded Sentinel EXAMPLE (inactive, broadcast, example:true)", (function () { const ex = jobOf(joeWs, "cjob_sentinel_example"); return !!ex && ex.example === true && ex.active === false; })());
    // ADMIN writes a plain REPORT job → persists
    await sync(moeTok, { obx: { customJobs: [mkJob({ id: "cjob_rep" })] } });
    rayst = await sync(rayTok, {});
    check("WORKSHOP: an ADMIN's plain report job PERSISTS (e2e)", !!jobOf(rayst, "cjob_rep") && jobOf(rayst, "cjob_rep").action.mode === "report");
    // ADMIN writes a FINANCE + BROADCAST job → coerced safe (finance scope stripped, delivery → private)
    await sync(moeTok, { obx: { customJobs: [mkJob({ id: "cjob_finbc", dataScope: ["income", "expenses"], deliverTo: { mode: "broadcast", threadId: null } })] } });
    rayst = await sync(rayTok, {});
    check("WORKSHOP GATE: an ADMIN's finance+broadcast job is COERCED (finance stripped + delivery private) (e2e)", (function () { const j = jobOf(rayst, "cjob_finbc"); return !!j && j.dataScope.indexOf("income") < 0 && j.deliverTo.mode === "private"; })());
    // ADMIN writes a PROPOSE job → coerced to report
    await sync(moeTok, { obx: { customJobs: [mkJob({ id: "cjob_prop", action: { mode: "propose" } })] } });
    rayst = await sync(rayTok, {});
    check("WORKSHOP GATE: an ADMIN's propose job is coerced to report (propose is owner-only) (e2e)", (jobOf(rayst, "cjob_prop") || {}).action && jobOf(rayst, "cjob_prop").action.mode === "report");
    // OWNER writes a FINANCE + PROPOSE job → passes through unchanged
    await sync(joeTok, { obx: { customJobs: [mkJob({ id: "cjob_ownfin", dataScope: ["income"], action: { mode: "propose" } })] } });
    rayst = await sync(rayTok, {});
    check("WORKSHOP: an OWNER's finance+propose job PASSES THROUGH (e2e)", (function () { const j = jobOf(rayst, "cjob_ownfin"); return !!j && j.dataScope.indexOf("income") >= 0 && j.action.mode === "propose"; })());
    // OWNER writes a BROADCAST job → passes through
    await sync(joeTok, { obx: { customJobs: [mkJob({ id: "cjob_ownbc", deliverTo: { mode: "broadcast", threadId: null } })] } });
    rayst = await sync(rayTok, {});
    check("WORKSHOP: an OWNER's broadcast job PASSES THROUGH (e2e)", (jobOf(rayst, "cjob_ownbc") || {}).deliverTo && jobOf(rayst, "cjob_ownbc").deliverTo.mode === "broadcast");
    // CROSS-ORG: eve (escaperoom only) cannot write into obx's customJobs (scoped out)
    await sync(eveTok, { obx: { customJobs: [mkJob({ id: "cjob_evehack" })] } });
    rayst = await sync(rayTok, {});
    check("WORKSHOP: a non-member CANNOT write another org's customJobs (cross-org write dropped)", !jobOf(rayst, "cjob_evehack"));
    // PREVIEW route: gated. crew/non-member 403; manager 400 when no AI key set; finance preview owner-only.
    let pvEve = await api("POST", "/api/workshop/preview", { org: "obx", job: mkJob({}) }, eveTok);
    check("WORKSHOP preview: a non-member is forbidden (403)", pvEve.status === 403);
    let pvNoKey = await api("POST", "/api/workshop/preview", { org: "jam", job: mkJob({ org: "jam" }) }, rayTok);
    check("WORKSHOP preview: 400 when the org has no AI key configured (no token burned)", pvNoKey.status === 400);
    let pvAdminFin = await api("POST", "/api/workshop/preview", { org: "obx", job: mkJob({ dataScope: ["income"] }) }, moeTok);
    check("WORKSHOP preview: an ADMIN's FINANCE preview is owner-only (403)", pvAdminFin.status === 403);
  } catch (e) { console.log("  ✗ FAIL: simulation threw " + (e && e.message)); fail++; }
  finally { srv.kill(); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {} }
  console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
