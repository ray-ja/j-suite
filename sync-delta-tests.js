/* sync-delta-tests.js — delta sync (js/201 + server projectSince) migration fixture. Pure node.
 * Run: node sync-delta-tests.js → expect 0 failed.
 * The fixture is the REAL data.json when present (realistic pre-change store), else a synthetic one.
 * Proves: a device that pushes only its changed records and pulls only `since` records ends up with
 * exactly the server's projection — every record of every collection survives, zero loss, and a
 * device that never sends `since` still gets the whole store. */
const fs = require("fs"), path = require("path");
const D = require("./js/201-sync-delta.js");
const t = require("./sync-server");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + "  got " + JSON.stringify(got)); } }
const clone = x => JSON.parse(JSON.stringify(x));
const NOW = Date.now();

/* ---------- fixture ---------- */
let store;
const real = path.join(__dirname, "data.json");
if (fs.existsSync(real)) { store = JSON.parse(fs.readFileSync(real, "utf8")); console.log("fixture: real data.json (" + fs.statSync(real).size + " bytes)"); }
else {
  store = { users: [{ id: "u1", username: "ray", role: "owner", updatedAt: NOW - 9e6 }], registry: [{ id: "obx", name: "OBX", updatedAt: NOW - 9e6 }, { id: "jam", name: "Jam", updatedAt: NOW - 9e6 }],
    obx: { customers: [{ id: "c1", name: "A", updatedAt: NOW - 8e6 }, { id: "c2", name: "B", updatedAt: NOW - 7e6 }], quotes: [{ id: "q1", total: 100, updatedAt: NOW - 6e6 }], jobs: [{ id: "j1", title: "Job", updatedAt: NOW - 5e6 }], todos: [{ id: "t1", title: "x", updatedAt: NOW - 4e6 }] },
    jam: { customers: [{ id: "jc1", name: "J", updatedAt: NOW - 3e6 }], quotes: [], jobs: [] } };
  console.log("fixture: synthetic");
}
const orgIds = Object.keys(store).filter(k => k !== "users" && k !== "registry" && store[k] && typeof store[k] === "object" && !Array.isArray(store[k]));
const countAll = s => { let n = 0; orgIds.forEach(o => Object.keys(s[o] || {}).forEach(c => { if (Array.isArray(s[o][c])) n += s[o][c].length; })); return n; };
const idsOf = s => { const out = []; orgIds.forEach(o => Object.keys(s[o] || {}).forEach(c => { if (Array.isArray(s[o][c])) s[o][c].forEach(r => { if (r && r.id != null) out.push(o + "." + c + "." + r.id); }); })); return out.sort(); };
const before = countAll(store);
console.log("records in fixture:", before, "orgs:", orgIds.join(","));

/* ---------- 1. delta push carries only the changed records ---------- */
console.log("\n— syncDeltaOf —");
const dev = clone(store);                       // device B: a full copy, last pushed at NOW-60s
const pushedAt = NOW - 60000;
const org0 = orgIds[0];
const coll0 = Object.keys(dev[org0]).find(c => Array.isArray(dev[org0][c]) && dev[org0][c].length) || "customers";
if (!Array.isArray(dev[org0][coll0])) dev[org0][coll0] = [];
const edited = dev[org0][coll0][0]; edited.name = (edited.name || "") + " (edited)"; edited.updatedAt = NOW;                         // an edit
dev[org0][coll0].push({ id: "zz_new_" + NOW, name: "brand new", updatedAt: NOW });                                                     // a create
const tomb = dev[org0][coll0][1] || dev[org0][coll0][0]; tomb.deleted = true; tomb.updatedAt = NOW + 1;                                // a soft delete
const nostamp = { id: "zz_nostamp_" + NOW, name: "no stamp" }; dev[org0][coll0].push(nostamp);                                          // a record with no updatedAt (must always travel)
const delta = D.syncDeltaOf(dev, orgIds, pushedAt - D.SYNC_DELTA_WINDOW_MS);
const deltaCount = countAll(delta);
ok("delta is tiny next to the store (" + deltaCount + " vs " + countAll(dev) + ")", deltaCount < countAll(dev) / 4 && deltaCount >= 4, deltaCount);
ok("delta carries the edit, the create, the tombstone and the unstamped record", (delta[org0][coll0] || []).some(r => r.id === edited.id) && (delta[org0][coll0] || []).some(r => r.id === "zz_new_" + NOW) && (delta[org0][coll0] || []).some(r => r.id === tomb.id && r.deleted) && (delta[org0][coll0] || []).some(r => r.id === nostamp.id));
ok("every org slab is present as a key (an org with nothing changed is {})", orgIds.every(o => delta[o] && typeof delta[o] === "object"));
ok("floor<=0 → whole slabs (the full push is unchanged)", countAll(D.syncDeltaOf(dev, orgIds, 0)) === countAll(dev));

/* ---------- 2. server merge of a delta push loses nothing ---------- */
console.log("\n— server: mergeState(delta) —");
const merged = t.mergeState(clone(store), clone(delta));
ok("record count = fixture + 2 new (edit and tombstone are in place, not duplicated)", countAll(merged) === before + 2, [countAll(merged), before]);
ok("the edit landed", (merged[org0][coll0].find(r => r.id === edited.id) || {}).name === edited.name);
ok("the tombstone landed", !!(merged[org0][coll0].find(r => r.id === tomb.id) || {}).deleted);
ok("the unstamped record landed", merged[org0][coll0].some(r => r.id === nostamp.id));
ok("every original id survives", (function () { const s = new Set(idsOf(merged)); return idsOf(store).every(x => s.has(x)); })());

/* ---------- 3. projectSince returns the window only, users/registry whole ---------- */
console.log("\n— server: projectSince —");
const me = null; const proj = t.projectForUser(merged, orgIds, me);
const part = t.projectSince(proj, NOW - 60000);
ok("since<=0 → identity (old clients unaffected)", t.projectSince(proj, 0) === proj);
ok("partial is small (" + countAll(part) + " records)", countAll(part) < countAll(proj) / 4 && countAll(part) >= 3, countAll(part));
ok("partial has the edit, the create, the tombstone", part[org0][coll0].some(r => r.id === edited.id) && part[org0][coll0].some(r => r.id === "zz_new_" + NOW) && part[org0][coll0].some(r => r.id === tomb.id));
ok("partial always includes the unstamped record", part[org0][coll0].some(r => r.id === nostamp.id));
ok("users and registry come back whole", part.users === proj.users && part.registry === proj.registry);
ok("every org key is present even with no changes", orgIds.every(o => part[o] && typeof part[o] === "object"));
ok("the 10-min overlap window applies (a record stamped 5 min before since is included)", (function () { const p2 = clone(proj); p2[org0][coll0].push({ id: "zz_5min", updatedAt: NOW - 60000 - 5 * 60000 }); return t.projectSince(p2, NOW - 60000)[org0][coll0].some(r => r.id === "zz_5min"); })());
ok("beyond the window it is excluded", (function () { const p2 = clone(proj); p2[org0][coll0].push({ id: "zz_11min", updatedAt: NOW - 60000 - 11 * 60000 }); return !t.projectSince(p2, NOW - 60000)[org0][coll0].some(r => r.id === "zz_11min"); })());

/* ---------- 4. device A applies the partial and equals the server ---------- */
console.log("\n— syncMergeInto (partial) —");
const devA = clone(store);                     // device A: stale full copy
const r1 = D.syncMergeInto(devA, part, true);
ok("changed flagged", r1.changed === true);
ok("no full pull demanded (every org already known)", r1.needFull === false);
ok("device A now equals the server projection, record for record", JSON.stringify(idsOf(devA)) === JSON.stringify(idsOf(proj)) && countAll(devA) === countAll(proj), [countAll(devA), countAll(proj)]);
ok("device A has the edit and the tombstone", (devA[org0][coll0].find(r => r.id === edited.id) || {}).name === edited.name && !!(devA[org0][coll0].find(r => r.id === tomb.id) || {}).deleted);
ok("applying the same partial again changes nothing", D.syncMergeInto(devA, part, true).changed === false);
ok("a local record with a NEWER stamp is kept over an older server copy", (function () { const s = clone(store); const rec = s[org0][coll0][0]; rec.name = "mine, newer"; rec.updatedAt = NOW + 5000; D.syncMergeInto(s, part, true); return s[org0][coll0][0].name === "mine, newer"; })());
ok("a partial that names an unknown org lands it and asks for a full pull", (function () { const s = clone(store); const p = clone(part); p.zzneworg = { customers: [{ id: "n", updatedAt: NOW }] }; const r = D.syncMergeInto(s, p, true); return r.needFull === true && s.zzneworg && s.zzneworg.customers.length === 1; })());
ok("a full reply (partial=false) replaces slabs exactly as before", (function () { const s = clone(store); const r = D.syncMergeInto(s, proj, false); return r.changed === true && JSON.stringify(idsOf(s)) === JSON.stringify(idsOf(proj)); })());

/* ---------- 5. when to go full ---------- */
console.log("\n— syncWantFull —");
ok("first sync (no since) → full", D.syncWantFull({}, "pull", false, NOW) === true);
ok("empty store → full", D.syncWantFull({ since: 1, fullAt: NOW }, "pull", true, NOW) === true);
ok("Sync now → full", D.syncWantFull({ since: 1, fullAt: NOW }, "manual", false, NOW) === true);
ok("fresh full within 15 min → delta", D.syncWantFull({ since: 1, fullAt: NOW - 60000 }, "pull", false, NOW) === false);
ok("full older than 15 min → full", D.syncWantFull({ since: 1, fullAt: NOW - 16 * 60000 }, "pull", false, NOW) === true);
ok("fullAt reset to 0 (new org seen) → full", D.syncWantFull({ since: 1, fullAt: 0 }, "pull", false, NOW) === true);

/* ---------- 6. full round trip is byte-identical to before ---------- */
console.log("\n— full round trip unchanged —");
const full = t.mergeState(clone(store), clone(store));
ok("full push of the whole store: every record survives", countAll(full) === before && JSON.stringify(idsOf(full)) === JSON.stringify(idsOf(store)));

/* ---------- 7. sendJson gzips for a browser and not for curl ---------- */
console.log("\n— sendJson —");
function fakeRes() { const r = { head: null, body: null, writeHead(c, h) { r.code = c; r.head = h; }, end(b) { r.body = b; } }; return r; }
const big = { state: { pad: "x".repeat(10000) } };
const rg = fakeRes(); t.sendJson({ headers: { "accept-encoding": "gzip, deflate, br" } }, rg, big);
ok("gzip when accepted", rg.head["Content-Encoding"] === "gzip" && Buffer.isBuffer(rg.body) && require("zlib").gunzipSync(rg.body).toString() === JSON.stringify(big));
const rr = fakeRes(); t.sendJson({ headers: {} }, rr, big);
ok("plain when not accepted", !rr.head["Content-Encoding"] && rr.body === JSON.stringify(big));
const rs = fakeRes(); t.sendJson({ headers: { "accept-encoding": "gzip" } }, rs, { ok: true });
ok("tiny replies stay plain", !rs.head["Content-Encoding"]);

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
