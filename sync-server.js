#!/usr/bin/env node
/*
 * Business App — sync server (v2)
 * Single-file, zero-dependency Node server. Stores the merged dataset in data.json
 * next to this file, and merges incoming changes per-record using last-write-wins
 * (the record with the newest updatedAt wins). Deletions sync via soft-delete flags.
 *
 * RUN:
 *   TOKEN=pick-a-long-secret node sync-server.js
 *   (optional) PORT=4000 TOKEN=... node sync-server.js
 *
 * Then in the app's Data tab set:
 *   Sync server URL = http://<this-machine-ip>:4000
 *   Access token    = the same TOKEN
 *
 * Use the SAME token on every device. Keep the token long and private.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let QB = null; try { QB = require("./qb-bridge"); } catch (e) {}
const AvailResolve = require("./availability-resolve");   // shared client/server availability logic

const PORT = process.env.PORT || 4000;
const TOKEN = process.env.TOKEN || "";
// Read-only CEO sweep token — SEPARATE from the write TOKEN (a read key can never write), and kept
// OUT of synced data.json. From env or a gitignored ceo-config.json ({"token":"…"}). Empty = endpoint off.
const CEO_READ_TOKEN = process.env.CEO_READ_TOKEN || (function () {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")).token || ""; } catch (e) { return ""; }
})();
// SCOPED CEO write token — SEPARATE from the read token (read key stays read-only, always). Only the
// /api/ceo/message route honors it, and that route can ONLY append to the messages collection.
const CEO_WRITE_TOKEN = process.env.CEO_WRITE_TOKEN || (function () {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")).writeToken || ""; } catch (e) { return ""; }
})();
// Cloudflare Access SSO — the team domain (e.g. wispy-meadow-393e.cloudflareaccess.com) whose SIGNED
// Access JWT we verify to auto-issue the sync token by email. From env or ceo-config.json. Empty = SSO off.
const ACCESS_TEAM_DOMAIN = process.env.CF_ACCESS_TEAM_DOMAIN || (function () {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")).accessTeamDomain || ""; } catch (e) { return ""; }
})();
// Web Push (VAPID, "tickle" pattern — contentless push, no RFC-8291 encryption). Keys in gitignored
// vapid-config.json {publicKey, privateKey, subject}. Absent → push is INERT (pubkey 404s, no sends).
// Public key is served to clients via GET /api/push/pubkey (it's not a secret).
let VAPID = null;
try { VAPID = JSON.parse(fs.readFileSync(path.join(__dirname, "vapid-config.json"), "utf8")); } catch (e) {}
// Last-active per user (ops-brain Layer-1 capture). IN-MEMORY ONLY — never written to data.json, so
// it can't churn the sync layer. Stamped (throttled ~60s/user) on /sync; surfaced read-only on /api/ceo.
const lastActive = {};
const PRESENCE_FILE = path.join(__dirname, "presence.json");
function loadPresence() { try { return JSON.parse(fs.readFileSync(PRESENCE_FILE, "utf8")); } catch (e) { return {}; } }
function savePresence(p) { try { const tmp = PRESENCE_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(p)); fs.renameSync(tmp, PRESENCE_FILE); } catch (e) {} }
Object.assign(lastActive, loadPresence());   // seed last-seen from disk so presence survives a restart
function noteActive(userId) { if (!userId || typeof userId !== "string") return; const n = Date.now(); if (n - (lastActive[userId] || 0) > 60000) { lastActive[userId] = n; const p = loadPresence(); p[userId] = n; savePresence(p); } }   // record + persist last-seen (throttled to once/60s per user)
// AUDIT — server-authoritative paper trail: who changed which records, when. Append-only, capped, best-effort
// (computed AFTER the merge+save and wrapped in try/catch by the caller, so it can never break a sync).
const AUDIT_FILE = path.join(__dirname, "audit.log");
const AUDIT_CAP = 3000;
const AUDIT_COLLECTIONS = ["customers", "properties", "quotes", "jobs", "income", "expenses", "disbursements", "places"];
function loadAudit() { try { return JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8")); } catch (e) { return []; } }
function saveAudit(a) { try { const tmp = AUDIT_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(a)); fs.renameSync(tmp, AUDIT_FILE); } catch (e) {} }
function auditLabel(r) { return String((r && (r.name || r.title || r.cust || r.label || r.customer || r.vendor || r.what || r.desc || r.address)) || (r && r.id) || "").slice(0, 60); }
function auditDiff(userId, pre, incoming) {
  if (!userId || !incoming) return;   // only attribute identified (per-user-token) syncs; anonymous legacy syncs aren't logged
  const now = Date.now(), entries = [];
  ["obx", "jam"].forEach(b => {
    const inc = incoming[b] || {}, sto = (pre && pre[b]) || {};
    AUDIT_COLLECTIONS.forEach(c => {
      const incArr = Array.isArray(inc[c]) ? inc[c] : []; if (!incArr.length) return;
      const stoMap = {}; (Array.isArray(sto[c]) ? sto[c] : []).forEach(r => { if (r && r.id) stoMap[r.id] = r; });
      incArr.forEach(r => {
        if (!r || !r.id) return;
        const old = stoMap[r.id], iu = +r.updatedAt || 0, ou = old ? (+old.updatedAt || 0) : -1;
        if (iu > ou) entries.push({ t: now, u: userId, b: b, c: c, id: r.id, act: !old ? "created" : (r.deleted && !old.deleted ? "deleted" : "edited"), label: auditLabel(r) });
      });
    });
  });
  const incU = Array.isArray(incoming.users) ? incoming.users : [];   // account changes (role/password/active/profile) — top-level users collection
  if (incU.length) { const stoU = {}; ((pre && pre.users) || []).forEach(u => { if (u && u.id) stoU[u.id] = u; }); incU.forEach(u => { if (!u || !u.id || u.kind) return; const old = stoU[u.id], iu = +u.updatedAt || 0, ou = old ? (+old.updatedAt || 0) : -1; if (iu > ou) entries.push({ t: now, u: userId, b: "*", c: "account", id: u.id, act: !old ? "created" : "edited", label: u.username || u.id }); }); }
  if (!entries.length) return;
  const a = loadAudit(); for (const e of entries) a.push(e);
  saveAudit(a.length > AUDIT_CAP ? a.slice(a.length - AUDIT_CAP) : a);
}
// PHASE 4 authz — when the syncing user is NOT a verified owner, neutralize account/role/password writes:
// drop new accounts + role-config sentinels, and force role/passhash/active back to the stored values.
// NEVER drops a stored user (worst case a change just doesn't apply). Bootstrap-exempt while no real account exists.
function sanitizeUserWrites(incoming, pre, selfId) {
  if (!incoming || !Array.isArray(incoming.users)) return incoming;
  const stored = (pre && pre.users) || [];
  if (!stored.filter(u => u && !u.kind && !u.deleted).length) return incoming;   // bootstrap: no real accounts yet → allow
  const storedMap = {}; stored.forEach(u => { if (u && u.id) storedMap[u.id] = u; });
  const SENSITIVE = ["role", "passhash", "active", "logoutAt", "adminPin", "superAdmin"];   // owner-only fields (superAdmin = platform owner — never settable by a non-owner sync); adminPin is also self-settable
  const safe = [];
  for (const u of incoming.users) {
    if (!u || !u.id) continue;
    if (u.kind === "membership" && u.orgId && writerOwnsOrg(pre, selfId, u.orgId)) { safe.push(u); continue; }   // org-owner (or super-admin) may manage memberships for an org they OWN — add/role/remove their team
    const old = storedMap[u.id];
    if (!old) continue;                       // new account / new sentinel from a non-owner → drop
    if (u.kind || old.kind) continue;         // role-config sentinel (__roles__) → drop incoming, keep stored
    const m = Object.assign({}, u);
    SENSITIVE.forEach(f => { if (f === "adminPin" && u.id === selfId) return; if (f in old) m[f] = old[f]; else delete m[f]; });   // you may set your OWN admin PIN; role/passhash/active/logoutAt + others' adminPin stay owner-only
    safe.push(m);
  }
  return Object.assign({}, incoming, { users: safe });
}
// Per-user sync tokens — server-side ONLY (gitignored, never synced to devices, so one user can't read another's
// token out of the dataset). Issued at login; maps token -> userId so the server knows exactly who is syncing
// (the basis for presence + audit trail + per-user write authz). Falls back gracefully if the file is missing.
const USER_TOKENS_FILE = path.join(__dirname, "user-tokens.json");
function loadUserTokens() { try { return JSON.parse(fs.readFileSync(USER_TOKENS_FILE, "utf8")); } catch (e) { return {}; } }
function saveUserTokens(m) { const tmp = USER_TOKENS_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(m, null, 2)); fs.renameSync(tmp, USER_TOKENS_FILE); }
function issueUserToken(userId, label) { const m = loadUserTokens(); const tok = crypto.randomBytes(24).toString("hex"); m[tok] = { userId: userId, issued: Date.now(), label: (label || "").slice(0, 80) }; saveUserTokens(m); return tok; }
function userForToken(tok) { if (!tok || typeof tok !== "string") return null; const r = loadUserTokens()[tok]; return (r && r.userId) || null; }
function userTokenRec(tok) { if (!tok || typeof tok !== "string") return null; return loadUserTokens()[tok] || null; }   // {userId, issued, label} — issued lets us honor "log out everywhere"
function tokOk(tok) { return (!!TOKEN && tok === TOKEN) || !!userForToken(tok); }   // shared (legacy) OR a per-user token — both authenticate to the API
const FILE = path.join(__dirname, "data.json");
const APP_FILE = path.join(__dirname, "Business App (v1).html");
// Backups live one level up (matches ~/jsuite-backup.sh + the deploy snapshots). The GUI Backups card
// reads this status (token-gated) and can trigger an on-demand snapshot. Metadata only — never serves the data.
const BACKUP_DIR = path.join(__dirname, "..", "data-backups");
function backupStatus() {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => /\.json$/.test(f));
    let last = 0, bytes = 0;
    for (const f of files) { try { const st = fs.statSync(path.join(BACKUP_DIR, f)); if (st.mtimeMs > last) last = st.mtimeMs; bytes += st.size; } catch (e) {} }
    return { count: files.length, last: Math.round(last), bytes: bytes };
  } catch (e) { return { count: 0, last: 0, bytes: 0, error: "no backup dir" }; }
}
function backupNow() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) return { ok: false, error: "no data file" };
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "").replace(/(\d{8})(\d{6})/, "$1-$2");
    fs.copyFileSync(FILE, path.join(BACKUP_DIR, "manual-" + ts + ".json"));
    return Object.assign({ ok: true }, backupStatus());
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
// Cache-bust token — changes on every restart (i.e. every deploy). Stamped onto js/css URLs in the
// served HTML so a new build loads from a URL no cache has seen — defeats Cloudflare's max-age override
// on static assets (Cloudflare serves the HTML as DYNAMIC/uncached, so the fresh stamps always arrive).
const BUILD = String(Date.now());
// Messaging rollout flag — OFF by default. Activate in prod WITHOUT a code change/redeploy:
// set env MESSAGING_ON=1 (or ceo-config.json {"messagingOn":true}) and restart. The shell route
// then injects window.JSUITE_MESSAGING=true so the client's gate (js/47) turns the feature on.
const MESSAGING_ON = process.env.MESSAGING_ON === "1" || (function () {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")).messagingOn === true; } catch (e) { return false; }
})();
const COLLECTIONS = ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "changelog", "locks", "timeclock", "income", "expenses", "messages", "resale", "pendingChanges", "knowledge", "disbursements", "escapeRooms", "escapeBookings", "lifeNotes", "lifeTrackers", "lifeLogs", "budgetCats", "budgetTx"];
const BIZES = ["obx", "jam"];

function blankBiz() { return { customers: [], quotes: [], jobs: [] }; }
// MULTI-ORG: an organization is a top-level store key holding its collections. The ONLY non-org top-level
// keys are these reserved ones. orgIdsOf() lists the org keys dynamically (obx, jam, + any future org).
const RESERVED = new Set(["users", "registry"]);
function orgIdsOf(s) { return Object.keys(s || {}).filter(k => !RESERVED.has(k) && s[k] && typeof s[k] === "object" && !Array.isArray(s[k])); }
const ORG_NAMES = { obx: "OBX Lot Solutions", jam: "Jamieson Automation" };
function migrateStore(s) {
  s = s || {};
  if (!Array.isArray(s.users)) s.users = [];
  if (!Array.isArray(s.registry)) s.registry = [];
  for (const oid of orgIdsOf(s)) if (!s.registry.find(r => r && r.id === oid))   // scaffold a registry record for every org lacking one (idempotent)
    s.registry.push({ id: oid, slug: oid, name: ORG_NAMES[oid] || oid, settings: {}, aiConfig: null, createdAt: 1, updatedAt: 1, deleted: false });
  // migrate pre-multi-org accounts (those with NO membership) → members of the original orgs (obx+jam); owner → super-admin. Idempotent + authoritative (so isolation works from the first sync).
  s.users.filter(u => u && !u.kind && !u.deleted).forEach(u => {
    if (s.users.some(m => m && m.kind === "membership" && m.accountId === u.id)) return;
    ["obx", "jam"].forEach(oid => { if (s[oid]) s.users.push({ id: "mem_" + oid + "_" + u.id, kind: "membership", orgId: oid, accountId: u.id, role: u.role || "crew", active: true, updatedAt: 1 }); });
    if (u.role === "owner") u.superAdmin = true;
  });
  return s;
}
function loadStore() {
  try { return migrateStore(JSON.parse(fs.readFileSync(FILE, "utf8"))); }
  catch (e) { return migrateStore({ obx: blankBiz(), jam: blankBiz() }); }
}
// MULTI-ORG (Phase 3) — membership-based scoping helpers (used by /sync read+write isolation in 3c).
function accountById(store, id) { return ((store && store.users) || []).find(u => u && u.id === id && !u.kind) || null; }
function membershipsOfStore(store, accountId) { return ((store && store.users) || []).filter(m => m && m.kind === "membership" && m.accountId === accountId && m.active !== false); }
function orgsForUser(store, account) { if (account && account.superAdmin) return orgIdsOf(store); return account ? membershipsOfStore(store, account.id).map(m => m.orgId) : []; }
function writerOwnsOrg(store, selfId, orgId) {   // may selfId write MEMBERSHIP records for orgId? super-admin → any; else only an org they OWN (per the STORED state, never the claimed incoming). The org-admin tier.
  const me = accountById(store, selfId); if (!me) return false; if (me.superAdmin) return true;
  return ((store && store.users) || []).some(m => m && m.kind === "membership" && m.accountId === selfId && m.orgId === orgId && m.role === "owner" && m.active !== false);
}
// MULTI-ORG (Phase 4) — per-org AI. Each org may enable its OWN assistant on its OWN Anthropic key, stored
// server-side in org-ai-config.json (gitignored, never synced to devices, never echoed back). One-way GUI setup.
const ORG_AI_FILE = path.join(__dirname, "org-ai-config.json");
function loadOrgAi() { try { return JSON.parse(fs.readFileSync(ORG_AI_FILE, "utf8")); } catch (e) { return {}; } }
function saveOrgAi(m) { const tmp = ORG_AI_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(m, null, 2)); fs.renameSync(tmp, ORG_AI_FILE); }
function orgAiStatus(orgId) { const c = loadOrgAi()[orgId] || {}; return { enabled: !!c.enabled, hasKey: !!c.apiKey, model: c.model || "claude-haiku-4-5-20251001" }; }   // NEVER includes the key
function apiAccount(tok) { const uid = userForToken(tok); return uid ? accountById(loadStore(), uid) : null; }   // resolve the per-user account behind a bearer token
function orgAiContext(store, orgId) {   // a concise, ORG-SCOPED data summary handed to that org's assistant (its data only)
  const o = store[orgId] || {}, reg = (store.registry || []).find(r => r && r.id === orgId) || {};
  const live = c => (o[c] || []).filter(r => r && !r.deleted), sum = (a, f) => a.reduce((t, r) => t + (+r[f] || 0), 0);
  const L = ["Organization: " + (reg.name || orgId)];
  L.push("Customers: " + live("customers").length + " | Properties: " + live("properties").length + " | Inventory items: " + live("inventory").length);
  const q = live("quotes"); L.push("Quotes: " + q.length + " (open " + q.filter(x => !x.accepted).length + ", accepted " + q.filter(x => x.accepted).length + ")");
  const j = live("jobs"); L.push("Jobs: " + j.length + " (done " + j.filter(x => x.done || x.status === "done").length + ")");
  L.push("Income: " + live("income").length + " records, $" + sum(live("income"), "amount").toFixed(0) + " | Expenses: " + live("expenses").length + " records, $" + sum(live("expenses"), "amount").toFixed(0));
  q.filter(x => !x.accepted).slice(-8).forEach(x => L.push("  Open quote #" + (x.num || "?") + " " + (x.cust || x.customer || "") + " $" + (x.total || 0)));
  // life tracker (personal orgs): trackers + recent journal so the org assistant can reflect on day-to-day
  const trk = live("lifeTrackers"), notes = live("lifeNotes"), logs = live("lifeLogs");
  if (trk.length || notes.length) {
    L.push("Life trackers: " + trk.length + " | Journal entries: " + notes.length + " | Daily logs: " + logs.length);
    trk.slice(0, 12).forEach(t => L.push("  Tracker: " + (t.name || "?") + " (" + (t.type || "check") + (t.unit ? ", " + t.unit : "") + ")"));
    notes.slice().sort((a, b) => (b.date || "") < (a.date || "") ? -1 : 1).slice(0, 5).forEach(n => L.push("  Journal " + (n.date || "") + ": " + String(n.title || n.body || "").replace(/\s+/g, " ").slice(0, 120)));
  }
  // budget (personal orgs): running balance + this month's planned-vs-actual per category, so the org assistant can advise on money/life
  const bcats = live("budgetCats"), btx = live("budgetTx");
  if (bcats.length || btx.length) {
    const now2 = new Date(), mo = now2.getFullYear() + "-" + String(now2.getMonth() + 1).padStart(2, "0");
    const inAll = sum(btx.filter(t => t.dir === "in"), "amount"), outAll = sum(btx.filter(t => t.dir === "out"), "amount");
    const txMo = btx.filter(t => String(t.date || "").slice(0, 7) === mo);
    const inMo = sum(txMo.filter(t => t.dir === "in"), "amount"), outMo = sum(txMo.filter(t => t.dir === "out"), "amount");
    L.push("BUDGET — running balance (all time): $" + (inAll - outAll).toFixed(2) + " (income $" + inAll.toFixed(2) + ", spending $" + outAll.toFixed(2) + ")");
    L.push("This month (" + mo + "): income $" + inMo.toFixed(2) + ", spending $" + outMo.toFixed(2) + ", net $" + (inMo - outMo).toFixed(2) + " across " + txMo.length + " transactions");
    const catName = id => { const c = bcats.find(x => x.id === id); return c ? c.name : "Uncategorized"; };
    bcats.filter(c => (c.kind || "out") === "out").slice(0, 20).forEach(c => {
      const actual = sum(txMo.filter(t => t.catId === c.id), "amount"), target = +c.target || 0;
      L.push("  Spend · " + (c.name || "?") + ": $" + actual.toFixed(2) + (target > 0 ? " of $" + target.toFixed(2) + " planned" + (actual > target ? " (OVER by $" + (actual - target).toFixed(2) + ")" : " ($" + (target - actual).toFixed(2) + " left)") : " (no target)"));
    });
    bcats.filter(c => (c.kind || "out") === "in").slice(0, 10).forEach(c => {
      const actual = sum(txMo.filter(t => t.catId === c.id), "amount"), target = +c.target || 0;
      L.push("  Income · " + (c.name || "?") + ": $" + actual.toFixed(2) + (target > 0 ? " of $" + target.toFixed(2) + " expected" : ""));
    });
  }
  return L.join("\n").slice(0, 6000);
}
function callAnthropic(apiKey, model, context, question, cb) {   // the org's OWN key — j-Suite never bills for this
  const payload = JSON.stringify({ model: model || "claude-haiku-4-5-20251001", max_tokens: 1024,
    system: "You are the assistant for this organization. Answer using ONLY the organization data provided below. Be concise and practical.\n\n" + context,
    messages: [{ role: "user", content: String(question || "").slice(0, 4000) }] });
  const r = https.request("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
    resp => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { const jj = JSON.parse(d); cb(null, (jj.content && jj.content[0] && jj.content[0].text) || (jj.error && ("AI error: " + (jj.error.message || jj.error.type))) || "No response."); } catch (e) { cb(e); } }); });
  r.on("error", e => cb(e)); r.write(payload); r.end();
}
// Phase 3c — read/write ISOLATION. No field-stripping anywhere: the additive merge preserves every UNSENT
// org/account from `stored` on write-back, so a scoped client can never drop another org's data.
function scopedIncoming(incoming, myOrgs) {   // WRITE: keep ONLY the caller's org slabs (foreign slabs dropped); users/registry pass through to sanitizeUserWrites
  const out = { users: incoming && incoming.users, registry: incoming && incoming.registry };
  const set = new Set(myOrgs);
  Object.keys(incoming || {}).forEach(k => { if (set.has(k) && incoming[k] && typeof incoming[k] === "object" && !Array.isArray(incoming[k])) out[k] = incoming[k]; });
  return out;
}
function projectUsers(users, myOrgs, me) {   // READ: a caller sees only memberships for their orgs + accounts that co-member those orgs
  if (me && me.superAdmin) return users || [];
  const set = new Set(myOrgs), memberIds = new Set();
  (users || []).forEach(u => { if (u && u.kind === "membership" && set.has(u.orgId)) memberIds.add(u.accountId); });
  if (me) memberIds.add(me.id);
  return (users || []).filter(u => u && (u.kind === "membership" ? set.has(u.orgId) : (u.kind ? true : memberIds.has(u.id))));
}
function projectForUser(store, myOrgs, me) {   // the ONLY thing /sync returns — strictly the caller's orgs
  const out = { users: projectUsers(store.users, myOrgs, me), registry: [] };
  const set = new Set(myOrgs), isSuper = !!(me && me.superAdmin);
  for (const oid of myOrgs) if (store[oid]) out[oid] = store[oid];
  out.registry = (store.registry || []).filter(r => r && (isSuper || set.has(r.id)));
  return out;
}
function saveStore(s) { const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, FILE); }   // atomic write: a crash mid-write can't leave a half-written/corrupt data.json

// merge two arrays of records by id; newest updatedAt wins
function mergeColl(a = [], b = []) {
  const map = new Map();
  for (const r of a) if (r && r.id) map.set(r.id, r);
  for (const r of b) {
    if (!r || !r.id) continue;
    const cur = map.get(r.id);
    if (!cur || (r.updatedAt || 0) >= (cur.updatedAt || 0)) map.set(r.id, r);
  }
  return [...map.values()];
}
/* ----- auth: verify a login against the SHA-256 account records the app already syncs here -----
   Records look like { id, username, passhash, settings, deleted, updatedAt }. The app hashes with
   WebCrypto SHA-256 in secure contexts and a djb2 fallback when crypto.subtle is unavailable
   (file:// / plain-http), so we accept either to match whatever it stored. */
function hashPw(pw) { return crypto.createHash("sha256").update(String(pw) + "::jsuite").digest("hex"); }
function hashPwFallback(pw) { let h = 5381; const s = String(pw) + "::jsuite"; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return "f" + h.toString(16); }
function accountByName(store, username) {
  const us = (store && store.users) || [];
  const lc = String(username || "").trim().toLowerCase();   // case-insensitive + whitespace-tolerant (no lockouts)
  // skip soft-deleted, deactivated (active:false), and non-account records (e.g. the roles config)
  return us.find(u => u && !u.deleted && !u.kind && u.active !== false && String(u.username || "").trim().toLowerCase() === lc) || null;
}
/* ----- password hashing: scrypt (slow, salted, built-in — no deps) is the at-rest format. Legacy
   SHA-256/djb2 hashes still verify and are transparently re-hashed to scrypt on the next successful
   login (maybeUpgradeHash), so existing accounts upgrade with no password resets. */
function scryptHash(pw) {
  const N = 16384, r = 8, p = 1, salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, 32, { N: N, r: r, p: p, maxmem: 64 * 1024 * 1024 });
  return "scrypt$" + N + "$" + r + "$" + p + "$" + salt.toString("hex") + "$" + dk.toString("hex");
}
function isScrypt(h) { return typeof h === "string" && h.slice(0, 7) === "scrypt$"; }
function scryptVerify(pw, stored) {
  const a = String(stored).split("$");
  if (a[0] !== "scrypt" || a.length !== 6) return false;
  let salt, hash; try { salt = Buffer.from(a[4], "hex"); hash = Buffer.from(a[5], "hex"); } catch (e) { return false; }
  if (hash.length < 16 || salt.length < 8) return false;   // reject degenerate records — an empty-hash field would otherwise match any password
  let dk; try { dk = crypto.scryptSync(String(pw), salt, hash.length, { N: +a[1], r: +a[2], p: +a[3], maxmem: 64 * 1024 * 1024 }); } catch (e) { return false; }
  return dk.length === hash.length && crypto.timingSafeEqual(dk, hash);
}
function verifyLogin(store, username, password) {
  const u = accountByName(store, username) || accountByEmail(store, username);   // accept username OR email in the login field
  if (!u || !u.passhash) return null;
  const ph = String(u.passhash);
  if (isScrypt(ph)) return scryptVerify(password, ph) ? u : null;
  return (ph === hashPw(password) || ph === hashPwFallback(password)) ? u : null;   // legacy SHA-256 / djb2
}
// re-hash a legacy account to scrypt after a successful login; mutates the store user. Returns true if upgraded.
function maybeUpgradeHash(store, userId, password) {
  const u = ((store && store.users) || []).find(x => x && x.id === userId);
  if (!u || !u.passhash || isScrypt(String(u.passhash))) return false;
  u.passhash = scryptHash(password); u.updatedAt = Date.now();
  return true;
}
/* per-ACCOUNT lockout (on top of the per-IP rateCheck): LOCK_MAX failures in a window locks that username */
const failedLogins = new Map();
const LOCK_MAX = 8, LOCK_WINDOW_MS = 15 * 60 * 1000;
function lockKey(u) { return String(u || "").trim().toLowerCase(); }
function accountLocked(username) {
  const h = failedLogins.get(lockKey(username));
  if (!h) return false;
  if (Date.now() - h.t0 > LOCK_WINDOW_MS) { failedLogins.delete(lockKey(username)); return false; }
  return h.n >= LOCK_MAX;
}
function noteFailedLogin(username) {
  const k = lockKey(username), t = Date.now(); let h = failedLogins.get(k);
  if (!h || t - h.t0 > LOCK_WINDOW_MS) { h = { n: 0, t0: t }; failedLogins.set(k, h); }
  h.n++;
}
function clearFailedLogin(username) { failedLogins.delete(lockKey(username)); }
/* ----- self-service password reset: one-time, 30-min, in-memory tokens (NOT synced/persisted — a
   restart just invalidates outstanding links and the user re-requests). Email via Resend's HTTPS API
   (zero-dep); with no key configured, sendEmail is a no-op so the flow still works minus the email. */
const resetTokens = new Map();
const RESET_TTL_MS = 30 * 60 * 1000;
function makeResetToken(userId) {
  const tok = crypto.randomBytes(32).toString("hex");
  resetTokens.set(tok, { userId: userId, exp: Date.now() + RESET_TTL_MS });
  return tok;
}
function consumeResetToken(tok) {
  const r = resetTokens.get(String(tok || ""));
  if (!r) return null;
  resetTokens.delete(String(tok || ""));            // one-time use (deleted even if expired)
  return Date.now() > r.exp ? null : r.userId;      // expired → reject
}
function emailCfg() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")); } catch (e) { return {}; } }
function sendEmail(to, subject, html) {
  return new Promise((resolve) => {
    const cfg = emailCfg(), key = cfg.resendKey || "", from = cfg.resendFrom || "J-Suite <noreply@jsuite.dev>";
    if (!key || !to) { console.log("[email] not configured (resendKey/recipient) — skipping send"); return resolve({ ok: false, skipped: true }); }
    const payload = JSON.stringify({ from: from, to: [to], subject: subject, html: html });
    const r = https.request("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (resp) => {
      let d = ""; resp.on("data", c => d += c); resp.on("end", () => { const ok = resp.statusCode >= 200 && resp.statusCode < 300; if (!ok) console.log("[email] resend " + resp.statusCode + ": " + d.slice(0, 200)); resolve({ ok: ok, status: resp.statusCode }); });
    });
    r.on("error", (e) => { console.log("[email] send error: " + e.message); resolve({ ok: false, error: e.message }); });
    r.write(payload); r.end();
  });
}
// per-site base for the reset link, from an ALLOWLISTED Host (prevents Host-header injection into the email)
function resetBaseUrl(req) {
  const allow = ["app.jsuite.dev", "dev.jsuite.dev"];
  const host = String((req.headers && req.headers.host) || "").toLowerCase().split(":")[0];
  return allow.indexOf(host) >= 0 ? ("https://" + host) : ((emailCfg().appUrl) || "https://app.jsuite.dev");
}
/* ----- Cloudflare Access SSO: verify the SIGNED Access JWT (NOT a spoofable header) and map email->account.
   The JWT (Cf-Access-Jwt-Assertion, injected by Cloudflare on requests it proxies) is RS256-signed by the
   team. We verify signature + issuer + expiry against the team's published JWKS, so a client reaching :4000
   directly (Tailscale/localhost) cannot forge it. On a match we issue the same sync TOKEN /login returns. */
let _accessCerts = { keys: [], at: 0 };
async function accessCerts(domain) {
  if (!domain) return [];
  if (_accessCerts.keys.length && Date.now() - _accessCerts.at < 3600000) return _accessCerts.keys;
  try { const r = await fetch("https://" + domain + "/cdn-cgi/access/certs"); const j = await r.json(); _accessCerts = { keys: j.keys || [], at: Date.now() }; } catch (e) {}
  return _accessCerts.keys;
}
function b64urlJson(s) { return JSON.parse(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); }
async function verifyAccessJwt(token, opts) {
  opts = opts || {};
  const domain = opts.domain || ACCESS_TEAM_DOMAIN;
  if (!token || !domain) return null;
  const parts = String(token).split("."); if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch (e) { return null; }
  if (payload.iss !== "https://" + domain) return null;                         // must be OUR team
  // App-scoped: once an Access AUD tag is set (Security GUI → ceo-config.json), the JWT must be for OUR
  // app, not merely our team — closes the "any team app = passwordless takeover" gap. Read fresh so the
  // GUI arms it with no restart. Unset = not yet armed (preserves current behavior, can't lock anyone out).
  let expectedAud = ""; try { expectedAud = JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")).accessAud || ""; } catch (e) {}
  if (expectedAud) { const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud]; if (auds.indexOf(expectedAud) < 0) return null; }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;  // not expired
  const keys = opts.keys || await accessCerts(domain);
  const jwk = keys.find(k => k && k.kid === header.kid && k.kty === "RSA"); if (!jwk) return null;
  let pub; try { pub = crypto.createPublicKey({ key: jwk, format: "jwk" }); } catch (e) { return null; }
  const sig = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  let ok = false; try { ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), pub, sig); } catch (e) { ok = false; }
  return ok ? payload : null;   // signature good → the verified claims (incl. email)
}
function accountByEmail(store, email) {
  const us = (store && store.users) || [];
  const lc = String(email || "").trim().toLowerCase();
  if (!lc) return null;
  return us.find(u => u && !u.deleted && !u.kind && u.active !== false && String(u.email || "").trim().toLowerCase() === lc) || null;
}
/* light per-IP rate limit on /login — a brute-force speed bump, not a fortress */
const LOGIN_WINDOW_MS = 5 * 60 * 1000, LOGIN_MAX = 20;
const loginHits = new Map();
function rateCheck(ip) {
  const t = Date.now();
  let h = loginHits.get(ip);
  if (!h || t - h.t0 > LOGIN_WINDOW_MS) { h = { n: 0, t0: t }; loginHits.set(ip, h); }
  h.n++;
  if (h.n > LOGIN_MAX) return { ok: false, retry: Math.ceil((LOGIN_WINDOW_MS - (t - h.t0)) / 1000) };
  return { ok: true };
}

function mergeState(stored, incoming) {
  stored = stored || {}; incoming = incoming || {};
  const out = {};
  const ids = new Set([...orgIdsOf(stored), ...orgIdsOf(incoming)]);   // UNION of org keys from both sides → an org present on EITHER side survives (never-drop-an-org)
  for (const oid of ids) {
    out[oid] = blankBiz();
    const s = stored[oid] || blankBiz(), i = incoming[oid] || blankBiz();
    for (const c of COLLECTIONS) out[oid][c] = mergeColl(s[c], i[c]);
  }
  out.users = mergeColl(stored.users || [], incoming.users || []);
  out.registry = mergeColl(stored.registry || [], incoming.registry || []);   // org metadata, LWW like users
  return out;
}

/* ---------- CEO read path: a READ-ONLY, whitelisted projection of operational state ----------
   Pure: reads the store, returns NEW objects, never mutates, never writes. The HTTP route only ever
   calls this (after loadStore) — there is no path to saveStore. Whitelisted fields only: no
   passhash / calToken / tokens / customer phone+email. */
function ceoTokenOk(provided, expected) { return !!expected && provided === expected; }   // empty expected always rejects
function ceoDateStr(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function ceoCustName(store, b, cid) {
  if (!cid) return "";
  const c = (((store[b] || {}).customers) || []).find(x => x && x.id === cid);
  return c ? (c.name || c.company || "") : "";
}
function ceoProjection(store, opts) {
  opts = opts || {};
  store = store || {};
  const bizes = (opts.biz && opts.biz !== "all" && BIZES.indexOf(opts.biz) >= 0) ? [opts.biz] : BIZES;
  const asOf = Date.now();
  const today = ceoDateStr(new Date(asOf));
  const members = ((store.users) || []).filter(u => u && !u.deleted && !u.kind);
  // open timeclock entries (clockOut null) → who is on a job right now
  const openTC = [];
  bizes.forEach(b => (((store[b] || {}).timeclock) || []).forEach(e => { if (e && !e.deleted && (e.clockOut == null)) openTC.push({ biz: b, userId: e.userId, jobId: e.jobId, since: e.clockIn || null }); }));
  const jobById = {};
  bizes.forEach(b => (((store[b] || {}).jobs) || []).forEach(j => { if (j && !j.deleted) jobById[b + ":" + j.id] = j; }));
  const crew = members.map(u => {
    const tc = openTC.find(e => e.userId === u.id);
    const job = tc ? jobById[tc.biz + ":" + tc.jobId] : null;
    return {
      id: u.id, name: u.username || "", role: u.role || "crew",
      clockedIn: !!tc,
      onJob: tc ? { jobId: tc.jobId, title: job ? (job.title || "") : "", biz: tc.biz, since: tc.since } : null,
      todayStatus: AvailResolve.status(u, today),
      pushSubs: Array.isArray(u.pushSubs) ? u.pushSubs.length : 0,  // count only (no endpoints/keys) — who's subscribed, for verification/timing
      lastActive: lastActive[u.id] || 0   // ms epoch of last /sync (0 = unknown); ops-brain "active Xm ago"
    };
  });
  // next 14 days availability glance — the 2-week window Cap keeps confirmed
  const availabilityWeek = [];
  for (let i = 0; i < 14; i++) {
    const ds = ceoDateStr(new Date(asOf + i * 86400000));
    const bucket = { date: ds, available: [], partial: [], oncall: [], off: [], timeoff: [], unknown: [] };
    members.forEach(u => {
      const s = AvailResolve.status(u, ds);
      if (s === "timeoff") bucket.timeoff.push(u.id);
      else if (s === "off") bucket.off.push(u.id);
      else if (s === "partial") bucket.partial.push(u.id);
      else if (s === "oncall") bucket.oncall.push(u.id);
      else if (s === "on") bucket.available.push(u.id);
      else bucket.unknown.push(u.id);   // not confirmed → Cap chases these to fill the 2 weeks
    });
    availabilityWeek.push(bucket);
  }
  const openJobs = [], openQuotes = [];
  bizes.forEach(b => {
    (((store[b] || {}).jobs) || []).forEach(j => {
      if (j && !j.deleted && !j.done) openJobs.push({ id: j.id, biz: b, title: j.title || "", date: j.date || "", time: j.time || "", customer: ceoCustName(store, b, j.customerId), address: j.address || "", crew: j.crew || [], done: false });
    });
    (((store[b] || {}).quotes) || []).forEach(q => {
      if (q && !q.deleted && !q.accepted) openQuotes.push({ id: q.id, biz: b, customer: q.cust || ceoCustName(store, b, q.customerId), total: q.total || 0, date: q.date || "", accepted: false, invoiced: !!q.invoiced, paid: !!q.paid });
    });
  });
  const counts = { crewOnJob: crew.filter(c => c.onJob).length, crewIdle: crew.filter(c => !c.onJob).length, openJobs: openJobs.length, openQuotes: openQuotes.length };
  const view = opts.view || "all";
  if (view === "messages") {
    // read-only comms view: threads + their messages, so the CEO can read crew replies (round-trip)
    const threads = [];
    bizes.forEach(b => {
      const coll = ((store[b] || {}).messages) || [];
      const acctName = id => { const u = ((store.users) || []).find(x => x && x.id === id); return u ? (u.username || "") : ""; };
      coll.filter(m => m && m.kind === "thread" && !m.deleted).forEach(tr => {
        threads.push({
          biz: b, threadId: tr.threadId, title: tr.title || "", type: tr.type || "", availAsk: !!tr.availAsk, jobId: tr.jobId || "", members: tr.members || [],
          messages: coll.filter(m => m && !m.kind && !m.deleted && m.threadId === tr.threadId).sort((a, b2) => (a.ts || 0) - (b2.ts || 0))
            .map(m => ({ id: m.id, senderId: m.senderId, senderLabel: m.senderLabel, body: m.body, ts: m.ts, attachments: (m.attachments || []).map(a => a && a.id).filter(Boolean) })),
          // per-MEMBER read state (named) so the watcher can derive unread / read-no-reply / replied
          reads: (tr.members || []).map(uid => {
            const rm = coll.find(m => m && m.kind === "read" && !m.deleted && m.threadId === tr.threadId && m.userId === uid);
            return { userId: uid, name: acctName(uid) || uid, lastReadTs: rm ? (rm.lastReadTs || 0) : 0 };
          })
        });
      });
    });
    return { ok: true, asOf, biz: opts.biz || "all", threads };
  }
  if (view === "ops") {
    // consolidated operational snapshot for the ops-sweep (read-only). Reuses crew (with lastActive)
    // + availabilityWeek; adds jobs (with done/completedAt), todos, open shifts, accepted-unscheduled quotes.
    const jobs = [], todos = [], openShifts = [], unscheduledQuotes = [], resale = [], revenue = [], knowledge = [];
    bizes.forEach(b => {
      (((store[b] || {}).jobs) || []).forEach(j => { if (j && !j.deleted) jobs.push({ id: j.id, biz: b, title: j.title || "", date: j.date || "", time: j.time || "", crew: j.crew || [], done: !!j.done, completedAt: j.completedAt || 0, completedBy: j.completedBy || "", customer: ceoCustName(store, b, j.customerId), address: j.address || "", equipment: (j.equipment || []).map(e => e && e.itemId).filter(Boolean), equipmentNames: (j.equipment || []).map(e => { const it = ((store[b] || {}).inventory || []).find(x => x && x.id === (e && e.itemId)); return it ? (it.name || e.itemId) : (e && e.itemId); }).filter(Boolean), expenses: (j.expenses || []).filter(x => x && !x.deleted).map(e => ({ amount: e.amount || 0, desc: e.desc || "" })), notes: String(j.notes || "").slice(0, 1200) }); });
      (((store[b] || {}).todos) || []).forEach(td => { if (td && !td.deleted) todos.push({ id: td.id, biz: b, title: td.title || "", due: td.due || "", done: !!td.done, priority: td.priority || "", assignee: td.assignee || "", updatedAt: td.updatedAt || 0 }); });
      (((store[b] || {}).knowledge) || []).forEach(k => { if (k && !k.deleted) knowledge.push({ topic: k.topic || "", fact: k.fact || "", tags: k.tags || "" }); });
      (((store[b] || {}).timeclock) || []).forEach(e => { if (e && !e.deleted && e.clockOut == null) openShifts.push({ id: e.id, biz: b, userId: e.userId, jobId: e.jobId, clockIn: e.clockIn || 0 }); });
      (((store[b] || {}).quotes) || []).forEach(q => {
        if (!q || q.deleted) return;
        if (q.accepted && !q.jobId) unscheduledQuotes.push({ id: q.id, biz: b, customer: q.cust || ceoCustName(store, b, q.customerId), total: q.total || 0, acceptedDate: q.acceptedDate || q.date || "" });
        // completed/charged work — Cap sees money made + who earned it (revenue split / payout). amount uses the final charged price when set.
        if (q.paid || q.invoiced) { const job = q.jobId ? ((((store[b] || {}).jobs) || []).find(j => j && j.id === q.jobId && !j.deleted)) : null; revenue.push({ id: q.id, biz: b, customer: q.cust || ceoCustName(store, b, q.customerId), amount: (q.finalPrice || q.total || 0), quoted: q.total || 0, invoiced: !!q.invoiced, paid: !!q.paid, date: q.acceptedDate || q.date || "", crew: (job && job.crew) || [], title: (job && job.title) || (q.cust || "") }); }
      });
      (((store[b] || {}).resale) || []).forEach(r => { if (r && !r.deleted && r.status !== "sold") resale.push({ id: r.id, biz: b, item: r.item || "", status: r.status || "pulled", jobId: r.jobId || "", platform: r.platform || "", listedDate: r.listedDate || "", createdAt: r.createdAt || 0, updatedAt: r.updatedAt || 0 }); });
    });
    // finance summary (current month) — so Cap can read the real numbers + advise
    const _fym = today.slice(0, 7); const finance = { month: _fym, revenue: 0, expenses: 0, arOutstanding: 0 };
    bizes.forEach(b => {
      (((store[b] || {}).income) || []).forEach(e => { if (e && !e.deleted && String(e.date || "").slice(0, 7) === _fym) finance.revenue += (+e.amount || 0); });
      (((store[b] || {}).expenses) || []).forEach(e => { if (e && !e.deleted && String(e.date || "").slice(0, 7) === _fym) finance.expenses += (+e.amount || 0); });
      (((store[b] || {}).jobs) || []).forEach(j => { if (j && !j.deleted && String(j.date || "").slice(0, 7) === _fym) (j.expenses || []).forEach(x => { if (x && !x.deleted) finance.expenses += (+x.amount || 0); }); });
      (((store[b] || {}).quotes) || []).forEach(q => { if (q && !q.deleted && q.invoiced && !q.paid) finance.arOutstanding += (+(q.finalPrice || q.total) || 0); });
    });
    finance.revenue = Math.round(finance.revenue * 100) / 100; finance.expenses = Math.round(finance.expenses * 100) / 100;
    finance.net = Math.round((finance.revenue - finance.expenses) * 100) / 100;
    finance.arOutstanding = Math.round(finance.arOutstanding * 100) / 100;
    finance.margin = finance.revenue > 0 ? Math.round((finance.net / finance.revenue) * 1000) / 10 : 0;
    // all-time cash position so Cap knows what's actually in the bank + set aside for taxes
    let _inc = 0, _exp = 0, _taxD = 0, _payD = 0, _drawD = 0;
    bizes.forEach(b => {
      (((store[b] || {}).income) || []).forEach(e => { if (e && !e.deleted) _inc += (+e.amount || 0); });
      (((store[b] || {}).expenses) || []).forEach(e => { if (e && !e.deleted) _exp += (+e.amount || 0); });
      (((store[b] || {}).jobs) || []).forEach(j => { if (j && !j.deleted) (j.expenses || []).forEach(x => { if (x && !x.deleted) _exp += (+x.amount || 0); }); });
      (((store[b] || {}).disbursements) || []).forEach(d => { if (d && !d.deleted) { const a = (+d.amount || 0); if (d.type === "tax") _taxD += a; else if (d.type === "payout") _payD += a; else _drawD += a; } });
    });
    finance.cashOnHand = Math.round((_inc - _exp - _taxD - _payD - _drawD) * 100) / 100;
    finance.taxReserveBalance = Math.round((_inc * 0.25 - _taxD) * 100) / 100;
    return { ok: true, asOf, today, biz: opts.biz || "all", crew, availabilityWeek, jobs, todos, openShifts, unscheduledQuotes, resale, revenue, knowledge, finance };
  }
  const full = { ok: true, asOf, biz: opts.biz || "all", crew, availabilityWeek, openJobs, openQuotes, counts };
  // filed receipts that Cap hasn't read yet (has a receiptId, no capRead) — for the background receipt reader
  if (view === "receipts") {
    const receipts = [], _bz = ["obx", "jam"].filter(b => store[b]);
    _bz.forEach(b => {
      (((store[b] || {}).jobs) || []).forEach(j => { if (j && !j.deleted) {
        (j.expenses || []).forEach(e => { if (e && !e.deleted && e.receiptId && !e.capRead) receipts.push({ biz: b, type: "jobexp", jobId: j.id, id: e.id, receiptId: e.receiptId, amount: +e.amount || 0, vendor: e.vendor || "", desc: e.desc || "" }); });
        (j.materials || []).forEach(e => { if (e && !e.deleted && e.receiptId && !e.capRead) receipts.push({ biz: b, type: "jobmat", jobId: j.id, id: e.id, receiptId: e.receiptId, amount: +e.amount || 0, vendor: e.vendor || "", desc: e.desc || "" }); });
      }});
      (((store[b] || {}).expenses) || []).forEach(e => { if (e && !e.deleted && e.receiptId && !e.capRead) receipts.push({ biz: b, type: "biz", jobId: null, id: e.id, receiptId: e.receiptId, amount: +e.amount || 0, vendor: e.vendor || "", desc: e.note || "" }); });
    });
    return { ok: true, asOf, biz: opts.biz || "all", receipts: receipts.slice(0, 40) };
  }
  if (view === "crew") return { ok: true, asOf, biz: full.biz, crew, availabilityWeek, counts };
  if (view === "jobs") return { ok: true, asOf, biz: full.biz, openJobs, counts };
  if (view === "quotes") return { ok: true, asOf, biz: full.biz, openQuotes, counts };
  return full;
}

/* ---------- SCOPED CEO write path: append to the messages collection ONLY ----------
   ceoBuildMessage returns an `incoming` that contains NOTHING but message records. The route feeds
   it through the SAME mergeState used by /sync — and mergeState merges per-collection — so a CEO
   write can ONLY add/update `messages` records. It is structurally incapable of touching customers,
   quotes, jobs, accounts, or any other collection. Per-record LWW (stable ids), no clobber. */
function ceoBuildMessage(p, store) {
  p = p || {}; store = store || {};
  const biz = (BIZES.indexOf(p.biz) >= 0) ? p.biz : "obx";
  const ts = Date.now();
  const records = [];
  let tid = p.threadId;
  const existing = tid ? (((store[biz] || {}).messages) || []).find(m => m && m.kind === "thread" && m.threadId === tid && !m.deleted) : null;
  if (!existing) {
    tid = tid || ("thr_ceo_" + crypto.randomBytes(5).toString("hex"));
    const members = (Array.isArray(p.members) && p.members.length) ? p.members
      : (((store.users) || []).filter(u => u && !u.kind && !u.deleted).map(u => u.id));
    records.push({ id: tid, kind: "thread", threadId: tid, title: String(p.title || "Cap").slice(0, 60), type: (p.to && p.to !== "__crew__") ? "dm" : "broadcast", availAsk: !!p.availAsk, members: members, createdBy: "__ceo__", deleted: false, updatedAt: ts });
  }
  const mid = "msg_ceo_" + crypto.randomBytes(6).toString("hex");
  records.push({ id: mid, threadId: tid, senderId: "__ceo__", senderLabel: String(p.senderLabel || "Cap").slice(0, 80), body: String(p.body || "").slice(0, 4000), ts: ts, deleted: false, updatedAt: ts });
  return { biz: biz, records: records, threadId: tid, messageId: mid };
}

/* Cap read receipts: stamp capReceived/capRead on a message in the messages collection. Touches ONLY
   those two timestamps + updatedAt (rides the per-record LWW sync). 'read' implies 'received'. */
function ceoSetReceipt(store, biz, msgId, kind) {
  const b = (biz === "jam") ? "jam" : "obx";
  const coll = ((store[b] || {}).messages) || [];
  const m = coll.find(x => x && x.id === msgId && !x.kind && !x.deleted);
  if (!m) return { ok: false, error: "message not found" };
  const t = Date.now();
  if (kind === "read") { m.capRead = t; if (!m.capReceived) m.capReceived = t; }
  else m.capReceived = t;
  m.updatedAt = t;
  return { ok: true, biz: b };
}

/* Cap's NON-DESTRUCTIVE receipt annotation: writes ONLY a `capRead` field (Cap's reading of the image) onto
   one receipt-bearing record. Structurally cannot touch the user's entry, money, or any other field/collection. */
function ceoSetCapRead(store, p) {
  const b = (p.biz === "jam") ? "jam" : "obx";
  const src = (p.capRead && typeof p.capRead === "object") ? p.capRead : null;
  if (!src) return { ok: false, error: "no capRead" };
  const cr = { date: String(src.date || "").slice(0, 10), vendor: String(src.vendor || "").slice(0, 80), amount: +src.amount || 0, match: src.match !== false, note: String(src.note || "").slice(0, 200), ts: Date.now() };
  let rec = null;
  if (p.type === "biz") { rec = (((store[b] || {}).expenses) || []).find(x => x && x.id === p.id && !x.deleted); }
  else { const j = (((store[b] || {}).jobs) || []).find(x => x && x.id === p.jobId && !x.deleted); if (j) { const arr = (p.type === "jobmat") ? (j.materials || []) : (j.expenses || []); rec = arr.find(x => x && x.id === p.id && !x.deleted); if (rec) j.updatedAt = Date.now(); } }
  if (!rec) return { ok: false, error: "record not found" };
  rec.capRead = cr; rec.updatedAt = Date.now();
  return { ok: true, biz: b };
}

/* ---------- SCOPED CEO propose path: append to the pendingChanges queue ONLY ----------
   Step 2 approval queue. ceoBuildProposal returns a single pendingChanges record; the route merges
   { [biz]: { pendingChanges: [record] } } via the SAME mergeState — so a propose can ONLY add a
   queued proposal. It is structurally incapable of touching todos/customers/quotes/jobs/accounts.
   The whitelist below is enforced HERE (defense in depth): a buggy/compromised Cap still cannot
   propose outside the lane, and APPLY is never the model — it's deterministic client code on approval. */
// "Everything proposable" — all BUSINESS collections. EXCLUDES system/meta plumbing: messages (own
// scoped path), pendingChanges (the queue itself), changelog (audit log), locks (soft-lock heartbeats).
// Widening what Cap may PROPOSE never widens its authority — every proposal still needs owner approval.
const PROPOSE_COLLECTIONS = ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "timeclock", "income", "expenses", "resale", "knowledge"];
const PROPOSE_TYPES = ["create", "update", "softDelete"];  // no hard delete, ever
function ceoBuildProposal(p, store) {
  p = p || {}; store = store || {};
  const biz = (BIZES.indexOf(p.biz) >= 0) ? p.biz : "obx";
  const type = String(p.type || "");
  const collection = String(p.collection || "");
  if (PROPOSE_TYPES.indexOf(type) < 0) return { ok: false, error: "type not allowed: " + type };
  if (PROPOSE_COLLECTIONS.indexOf(collection) < 0) return { ok: false, error: "collection not allowed: " + collection };
  const summary = String(p.summary || "").trim();
  if (!summary) return { ok: false, error: "summary required" };
  const after = (p.after && typeof p.after === "object") ? p.after : null;
  if (type === "create" && !after) return { ok: false, error: "create requires after" };
  const targetId = p.targetId || (after && after.id) || null;
  if ((type === "update" || type === "softDelete") && !targetId) return { ok: false, error: type + " requires targetId" };
  // pre-allocate a stable target id for create so the client apply is idempotent across re-sync
  const afterOut = (type === "create" && after && !after.id) ? Object.assign({}, after, { id: collection.slice(0, 3) + "_" + crypto.randomBytes(5).toString("hex") }) : after;
  const ts = Date.now();
  const id = "pc_" + crypto.randomBytes(6).toString("hex");
  const record = {
    id: id, createdAt: ts, updatedAt: ts,
    proposedBy: (["ops", "finance", "cap"].indexOf(String(p.proposedBy)) >= 0) ? p.proposedBy : "cap",
    type: type, collection: collection,
    targetId: (type === "create") ? null : targetId,
    before: (p.before !== undefined ? p.before : null),
    after: afterOut || null,
    summary: summary.slice(0, 500),
    status: "pending", decidedBy: null, decidedAt: null, note: "", deleted: false
  };
  return { ok: true, biz: biz, record: record, proposalId: id };
}

/* ---------- WEB PUSH (VAPID-JWT "tickle" — contentless push; no payload encryption) ----------
   Only crypto used is ES256 VAPID-JWT (Node-native). A contentless push wakes the SW, which shows a
   generic "Cap: new message — tap to open" (no token/fetch in the SW). Inert without vapid-config.json. */
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }
function vapidJwt(audience) {
  if (!VAPID || !VAPID.privateKey) return null;
  try {
    const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const payload = b64url(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID.subject || "mailto:admin@obxlotsolutions.com" }));
    const signingInput = header + "." + payload;
    const key = crypto.createPrivateKey({ key: Buffer.from(VAPID.privateKey, "base64url"), format: "der", type: "pkcs8" });
    const sig = crypto.sign("sha256", Buffer.from(signingInput), { key: key, dsaEncoding: "ieee-p1363" });
    return signingInput + "." + b64url(sig);
  } catch (e) { return null; }
}
function webPushTickle(endpoint) {   // contentless POST to the push service; resolves the HTTP status (0 on failure)
  return new Promise(resolve => {
    let u; try { u = new URL(endpoint); } catch (e) { return resolve(0); }
    const jwt = vapidJwt(u.origin); if (!jwt) return resolve(0);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request({ method: "POST", hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search,
      headers: { "Authorization": "vapid t=" + jwt + ", k=" + VAPID.publicKey, "TTL": "86400", "Urgency": "high", "Content-Length": 0 } },
      res => { res.resume(); resolve(res.statusCode || 0); });
    r.on("error", () => resolve(0)); r.setTimeout(10000, () => r.destroy());
    r.end();
  });
}
/* should a freshly-synced message tickle its thread's recipients? real, new, recent, not Cap's own voice. */
function pushWorthy(m, hadIds, nowMs) {
  if (!m || m.kind || m.deleted || !m.threadId || !m.senderId) return false;
  if (hadIds && hadIds.has(m.id)) return false;                            // already on the server → not new
  if (m.senderId === "__ceo__" || m.senderId === "__cap__") return false;  // Cap's posts notify via the /api/ceo path
  if (m.ts && nowMs - m.ts > 6 * 3600000) return false;                    // stale / backfilled → don't ping
  return true;
}
async function pushNotify(store, biz, threadId, exceptUserId) {   // best-effort; prunes stale (404/410) subs
  if (!VAPID || !VAPID.publicKey) return;
  const coll = ((store[biz] || {}).messages) || [];
  const thread = coll.find(m => m && m.kind === "thread" && m.threadId === threadId && !m.deleted);
  if (!thread) return;
  const users = (store.users || []);
  // Broadcast fans out to EVERY real account (crew + owner) — same widen as the read-side broadcast
  // fix (53e9e1f), not the post-time member snapshot (which can miss accounts created/subscribed later).
  // DMs stay scoped to the thread's participants.
  const recipients = (thread.type === "broadcast"
    ? users.filter(u => u && !u.kind && !u.deleted && u.active !== false).map(u => u.id)
    : (thread.members || [])
  ).filter(id => id && id !== exceptUserId);
  let pruned = false;
  for (const uid of recipients) {
    const u = users.find(x => x && x.id === uid && !x.deleted);
    if (!u || !Array.isArray(u.pushSubs) || !u.pushSubs.length) continue;
    const keep = [];
    for (const sub of u.pushSubs) {
      const code = await webPushTickle(sub && sub.endpoint);
      if (code === 404 || code === 410) { pruned = true; continue; }   // gone → drop the dead sub
      keep.push(sub);
    }
    if (keep.length !== u.pushSubs.length) { u.pushSubs = keep; u.updatedAt = Date.now(); }
  }
  if (pruned) { try { saveStore(store); } catch (e) {} }   // persist pruned subs (rides account-LWW on next sync)
}
// Notify the owner account(s) of a new proposal awaiting approval. Mirrors pushNotify's prune-on-dead
// logic but targets owners directly (no thread needed) — the approval inbox is owner-only.
async function pushNotifyOwner(store, exceptUserId) {   // best-effort
  if (!VAPID || !VAPID.publicKey) return;
  const users = (store.users || []);
  const recipients = users.filter(u => u && !u.kind && !u.deleted && u.active !== false && u.role === "owner").map(u => u.id).filter(id => id && id !== exceptUserId);
  let pruned = false;
  for (const uid of recipients) {
    const u = users.find(x => x && x.id === uid && !x.deleted);
    if (!u || !Array.isArray(u.pushSubs) || !u.pushSubs.length) continue;
    const keep = [];
    for (const sub of u.pushSubs) {
      const code = await webPushTickle(sub && sub.endpoint);
      if (code === 404 || code === 410) { pruned = true; continue; }
      keep.push(sub);
    }
    if (keep.length !== u.pushSubs.length) { u.pushSubs = keep; u.updatedAt = Date.now(); }
  }
  if (pruned) { try { saveStore(store); } catch (e) {} }
}

/* PUSH PEEK — the SW fetches this on a (contentless) push wake to show the REAL message body.
   The device identifies itself by ITS OWN push-subscription endpoint (the browser handed the SW
   that endpoint; the server already stored it on the account). That endpoint is the capability —
   a long, unguessable push-service URL — so no token lives in the service worker. We return ONLY
   the owning user's latest INBOUND message preview (never their own, only threads they're in) —
   no cross-user leak. Falls back to a generic line so the SW can always show something. */
function pushPeek(store, endpoint) {
  store = store || {};
  if (!endpoint) return { ok: false };
  const users = (store.users || []);
  const user = users.find(u => u && !u.deleted && Array.isArray(u.pushSubs) && u.pushSubs.some(s => s && s.endpoint === endpoint));
  if (!user) return { ok: false };
  let best = null;
  for (const b of Object.keys(store)) {
    const biz = store[b];
    if (!biz || typeof biz !== "object" || !Array.isArray(biz.messages)) continue;
    const msgs = biz.messages, threads = {};
    msgs.forEach(m => { if (m && m.kind === "thread" && !m.deleted) threads[m.threadId] = m; });
    msgs.forEach(m => {
      if (!m || m.kind || m.deleted || m.senderId === user.id) return;        // skip thread records, deleted, and the user's own
      const tr = threads[m.threadId]; if (!tr) return;
      const inThread = tr.type === "broadcast" ? true : ((tr.members || []).indexOf(user.id) >= 0);
      if (!inThread) return;
      if (!best || (m.ts || 0) > (best.ts || 0)) best = { ts: m.ts || 0, label: m.senderLabel || tr.title || "Cap", body: m.body || "" };
    });
  }
  if (!best) return { ok: true, title: "Cap", body: "New message — tap to open" };
  const preview = String(best.body || "").replace(/\s+/g, " ").trim().slice(0, 140);
  return { ok: true, title: best.label || "Cap", body: preview || "New message" };
}

/* ----- per-user iCalendar (.ics) subscription feed -----------------------------------------------
   A one-way, READ-ONLY mirror of a user's upcoming assigned jobs. The feed URL carries an
   unguessable per-account token (u.calToken), minted in the app and synced here on the user record,
   so a calendar client can subscribe WITHOUT the sync token it can't supply — the calToken is the
   capability. We only ever emit a VCALENDAR; nothing the calendar client sends is written back. */
function userByCalToken(store, token) {
  if (!token) return null;
  return ((store && store.users) || []).find(u => u && !u.deleted && !u.kind && u.calToken && u.calToken === token) || null;
}
/* RFC 5547 §3.3.11 text escaping for property values */
function icsEscape(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
/* fold content lines to <=75 octets (RFC 5545 §3.1); continuation lines begin with a single space */
function icsFold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75), rest = line.slice(75);
  while (rest.length > 74) { out += "\r\n " + rest.slice(0, 74); rest = rest.slice(74); }
  return out + "\r\n " + rest;
}
function pad2(n) { return String(n).padStart(2, "0"); }
function icsUtcStamp(d) { return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z"; }
function ymdCompact(ds) { return String(ds || "").replace(/-/g, ""); }
function ymdPlus(ds, n) { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
function todayStr(d) { d = d || new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

/* a user's upcoming (today-onward), non-deleted, not-done jobs across both businesses, time-sorted */
function jobsForUser(store, userId, nowDate) {
  const t = todayStr(nowDate), out = [];
  for (const biz of BIZES) {
    for (const j of ((store[biz] || {}).jobs || [])) {
      if (!j || j.deleted || j.done || !j.date || j.date < t) continue;
      if ((j.crew || []).indexOf(userId) < 0) continue;
      out.push({ job: j, biz: biz });
    }
  }
  return out.sort((a, b) => (a.job.date + (a.job.time || "")) < (b.job.date + (b.job.time || "")) ? -1 : 1);
}
function jobCustomer(store, biz, j) {
  const c = j.customerId ? ((store[biz] || {}).customers || []).find(x => x && x.id === j.customerId) : null;
  return c ? (c.name || c.company || "") : "";
}
function jobLocation(store, biz, j) {
  if (j.address) return j.address;
  const b = store[biz] || {};
  if (j.propertyId) { const p = (b.properties || []).find(x => x && x.id === j.propertyId); if (p && p.address) return p.address; }
  if (j.customerId) {
    const c = (b.customers || []).find(x => x && x.id === j.customerId);
    if (c && c.address) return c.address;
    const p = (b.properties || []).find(x => x && (x.customerIds || []).indexOf(j.customerId) >= 0 && x.address);
    if (p) return p.address;
  }
  return "";
}
function crewNames(store, ids) {
  const us = (store && store.users) || [];
  return (ids || []).map(id => { const u = us.find(x => x && x.id === id); return u ? u.username : ""; }).filter(Boolean);
}
function buildIcs(store, user, nowDate) {
  const dtstamp = icsUtcStamp(nowDate || new Date());
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//j-Suite//Job Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsEscape("j-Suite jobs — " + (user.username || "")), "X-WR-CALDESC:" + icsEscape("Your upcoming assigned jobs"), "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  for (const { job: j, biz } of jobsForUser(store, user.id, nowDate)) {
    const cust = jobCustomer(store, biz, j), loc = jobLocation(store, biz, j), crew = crewNames(store, j.crew);
    const desc = [];
    if (cust) desc.push("Customer: " + cust);
    if (loc) desc.push("Address: " + loc);
    if (crew.length) desc.push("Crew: " + crew.join(", "));
    if (j.notes) desc.push("Notes: " + j.notes);
    L.push("BEGIN:VEVENT", "UID:job-" + j.id + "@jsuite", "DTSTAMP:" + dtstamp);
    if (j.time) {
      // floating local time (no Z / TZID): the OBX is a single timezone, so this shows correctly
      // on the crew's own device without shipping a VTIMEZONE. Default a 2-hour block.
      const sd = new Date(j.date + "T" + j.time + ":00"); sd.setHours(sd.getHours() + 2);
      L.push("DTSTART:" + ymdCompact(j.date) + "T" + j.time.replace(":", "") + "00");
      L.push("DTEND:" + sd.getFullYear() + pad2(sd.getMonth() + 1) + pad2(sd.getDate()) + "T" + pad2(sd.getHours()) + pad2(sd.getMinutes()) + "00");
    } else {
      L.push("DTSTART;VALUE=DATE:" + ymdCompact(j.date), "DTEND;VALUE=DATE:" + ymdPlus(j.date, 1));
    }
    L.push("SUMMARY:" + icsEscape((j.title || "Job") + (cust ? " — " + cust : "")));
    if (loc) L.push("LOCATION:" + icsEscape(loc));
    if (desc.length) L.push("DESCRIPTION:" + icsEscape(desc.join("\n")));
    // reminders: 1 day + 1 hour before
    const almDesc = icsEscape("Reminder: " + (j.title || "Job"));
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + almDesc, "TRIGGER:-P1D", "END:VALARM");
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + almDesc, "TRIGGER:-PT1H", "END:VALARM");
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(icsFold).join("\r\n") + "\r\n";
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // serve the app itself so any device on the network can load it
  if (req.method === "GET" && ["/", "/index.html", "/app"].indexOf(req.url.split("?")[0]) >= 0) {   // match the PATH (ignore ?query, e.g. /?reset=TOKEN)
    return fs.readFile(APP_FILE, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("app file not found next to sync-server.js"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      let html = buf.toString("utf8").replace(/((?:src|href)=")(js\/[^"?]+\.js|app\.css)(")/g, '$1$2?b=' + BUILD + '$3');   // version-stamp js/css past Cloudflare's cache
      if (MESSAGING_ON) html = html.replace("</head>", '<script>window.JSUITE_MESSAGING=true;</script></head>');
      res.end(html);
    });
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));   // no FILE path — don't leak the install path/username
  }

  // CEO read path — GET /api/ceo (read-only sweep, token-gated). Reached via the on-host bridge
  // (Mechanism A) or any tailnet node. Only ever loadStore()s + projects whitelisted fields; it has
  // no write path. Auth = the read-only CEO_READ_TOKEN (Bearer header or ?token=), separate from the
  // write TOKEN. Tailnet-private transport is the first layer; the token is the second.
  if (req.method === "GET" && (req.url.split("?")[0] === "/api/ceo")) {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!ceoTokenOk(tok, CEO_READ_TOKEN)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    const proj = ceoProjection(loadStore(), { biz: q.searchParams.get("biz") || "all", view: q.searchParams.get("view") || "all" });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(proj));
  }

  // SCOPED CEO write — POST /api/ceo/message. Token = CEO_WRITE_TOKEN (separate from the read token).
  // Builds a messages-only `incoming` and merges it via mergeState — cannot touch any other record.
  if (req.method === "POST" && (req.url.split("?")[0] === "/api/ceo/message")) {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!ceoTokenOk(tok, CEO_WRITE_TOKEN)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    const _ch = []; let _bl = 0;
    req.on("data", c => { _ch.push(c); _bl += c.length; if (_bl > 1e5) req.destroy(); });
    req.on("end", () => {
      const body = Buffer.concat(_ch).toString("utf8");   // decode the FULL body as UTF-8 — per-chunk body+=c mangles emoji/em-dash split across chunk boundaries (the ��� bug)
      let p; try { p = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('{"error":"bad json"}'); }
      if (!p || !String(p.body || "").trim()) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"empty body"}'); }
      const store = loadStore();
      const built = ceoBuildMessage(p, store);
      const merged = mergeState(store, { [built.biz]: { messages: built.records } });   // ONLY messages in the incoming
      saveStore(merged);
      pushNotify(merged, built.biz, built.threadId, "__ceo__").catch(() => {});   // best-effort tickle to recipients (non-blocking)
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, biz: built.biz, threadId: built.threadId, messageId: built.messageId }));
    });
    return;
  }

  // SCOPED CEO write — POST /api/ceo/receipt {biz,msgId,kind}. Stamps Cap's read receipts
  // (capReceived/capRead) on ONE message. Token = CEO_WRITE_TOKEN. Cannot touch anything else.
  if (req.method === "POST" && (req.url.split("?")[0] === "/api/ceo/receipt")) {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!ceoTokenOk(tok, CEO_WRITE_TOKEN)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { p = {}; }
      if (!p || typeof p !== "object") p = {};
      const store = loadStore();
      const r = ceoSetReceipt(store, p.biz, p.msgId, p.kind);
      if (!r.ok) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: r.error })); }
      saveStore(store);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  // SCOPED CEO write — POST /api/ceo/annotate {biz,type,jobId,id,capRead}. Writes ONLY Cap's capRead reading
  // onto one receipt record. Token = CEO_WRITE_TOKEN. Cannot touch the entry, money, or anything else.
  if (req.method === "POST" && (req.url.split("?")[0] === "/api/ceo/annotate")) {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!ceoTokenOk(tok, CEO_WRITE_TOKEN)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { p = {}; }
      if (!p || typeof p !== "object") p = {};
      const store = loadStore();
      const r = ceoSetCapRead(store, p);
      if (!r.ok) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: r.error })); }
      saveStore(store);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  // SCOPED CEO write — POST /api/ceo/propose. Token = CEO_WRITE_TOKEN. Queues an approval (pendingChanges)
  // ONLY — whitelist-enforced, cannot apply or touch any business collection. Owner approves in-app.
  if (req.method === "POST" && (req.url.split("?")[0] === "/api/ceo/propose")) {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!ceoTokenOk(tok, CEO_WRITE_TOKEN)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('{"error":"bad json"}'); }
      const store = loadStore();
      const built = ceoBuildProposal(p, store);
      if (!built.ok) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: built.error })); }
      const merged = mergeState(store, { [built.biz]: { pendingChanges: [built.record] } });   // ONLY pendingChanges in the incoming
      saveStore(merged);
      pushNotifyOwner(merged, "__ceo__").catch(() => {});   // best-effort tickle to the owner (non-blocking)
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, biz: built.biz, proposalId: built.proposalId }));
    });
    return;
  }

  // PUSH PEEK — SW fetches the real message body on wake (device id'd by its own sub endpoint).
  if (req.method === "POST" && req.url === "/api/push/peek") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"ok":false,"error":"bad json"}'); }
      const out = pushPeek(loadStore(), p && p.endpoint);
      res.writeHead(out.ok ? 200 : 404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(out));
    });
    return;
  }

  // Web Push public key (VAPID) — clients fetch this to subscribe. Not a secret. 404 when push is off.
  if (req.method === "GET" && req.url === "/api/push/pubkey") {
    const on = !!(VAPID && VAPID.publicKey);
    res.writeHead(on ? 200 : 404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(on ? { key: VAPID.publicKey } : { error: "push not configured" }));
  }

  // BACKUPS (GUI Backups card) — token-gated. Status is METADATA ONLY (count/last/bytes); never serves the data.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/backup-status") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!tokOk(tok)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(backupStatus()));
  }
  // On-demand server snapshot — POST /api/backup. Token-gated. Copies data.json → data-backups/manual-<ts>.json.
  if (req.method === "POST" && req.url.split("?")[0] === "/api/backup") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!tokOk(tok)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(backupNow()));
  }

  // CONFIG SECRETS (Security GUI) — token-gated. STATUS returns booleans only, NEVER the secret values.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/config/status") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!tokOk(tok)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    let c = {}; try { c = JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")); } catch (e) {}
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ resendKey: !!c.resendKey, accessAud: !!c.accessAud, accessTeamDomain: !!c.accessTeamDomain, ceoTokens: !!(c.token && c.writeToken) }));
  }
  // PER-ORG AI (Phase 4). status: any member. config: org-OWNER/super-admin only, one-way key. ask: any member, uses the org's OWN key + scoped data.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/org-ai/status") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    const acct = apiAccount(tok), org = q.searchParams.get("org") || "";
    if (!acct || orgsForUser(loadStore(), acct).indexOf(org) < 0) { res.writeHead(403, { "Content-Type": "application/json" }); return res.end('{"error":"forbidden"}'); }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(orgAiStatus(org)));
  }
  if (req.method === "POST" && req.url.split("?")[0] === "/api/org-ai/config") {
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const acct = apiAccount(tok);
    let body = ""; req.on("data", c => { body += c; if (body.length > 2e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"bad json"}'); }
      const org = p && p.org;
      if (!acct || !org || !writerOwnsOrg(loadStore(), acct.id, org)) { res.writeHead(403, { "Content-Type": "application/json" }); return res.end('{"error":"forbidden"}'); }
      const cfg = loadOrgAi(), c = cfg[org] || {};
      if (typeof p.enabled === "boolean") c.enabled = p.enabled;
      if (typeof p.model === "string" && p.model.trim()) c.model = p.model.trim().slice(0, 80);
      if (typeof p.apiKey === "string" && p.apiKey.trim()) { if (p.apiKey.length > 8192) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"key too long"}'); } c.apiKey = p.apiKey.trim(); }   // one-way, never echoed
      c.updatedAt = Date.now(); cfg[org] = c;
      try { saveOrgAi(cfg); } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); return res.end('{"error":"write failed"}'); }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(orgAiStatus(org)));   // status only — never the key
    });
    return;
  }
  if (req.method === "POST" && req.url.split("?")[0] === "/api/org-ai/ask") {
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const acct = apiAccount(tok);
    let body = ""; req.on("data", c => { body += c; if (body.length > 2e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"bad json"}'); }
      const store = loadStore(), org = p && p.org;
      if (!acct || !org || orgsForUser(store, acct).indexOf(org) < 0) { res.writeHead(403, { "Content-Type": "application/json" }); return res.end('{"error":"forbidden"}'); }
      const cfg = loadOrgAi()[org];
      if (!cfg || !cfg.enabled || !cfg.apiKey) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"AI is not set up for this organization"}'); }
      callAnthropic(cfg.apiKey, cfg.model, orgAiContext(store, org), p.question, (err, answer) => {
        if (err) { res.writeHead(502, { "Content-Type": "application/json" }); return res.end('{"error":"AI request failed"}'); }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ answer: answer }));
      });
    });
    return;
  }
  // ONE-WAY WRITE — set an allowlisted secret into ceo-config.json. Never returns or logs the value. Atomic.
  if (req.method === "POST" && req.url.split("?")[0] === "/api/config/secret") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!tokOk(tok)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    let body = ""; req.on("data", c => { body += c; if (body.length > 2e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"bad json"}'); }
      const ALLOW = ["resendKey", "accessAud"];   // only these are GUI-settable; Cap tokens are rotated separately (Cap-side coordination)
      const key = p && p.key, value = p && p.value;
      if (ALLOW.indexOf(key) < 0 || typeof value !== "string" || !value.trim() || value.length > 8192) {
        res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"not allowed"}');
      }
      const cfgPath = path.join(__dirname, "ceo-config.json");
      let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (e) {}
      cfg[key] = value.trim();
      try { const tmp = cfgPath + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2)); fs.renameSync(tmp, cfgPath); }
      catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); return res.end('{"error":"write failed"}'); }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end('{"ok":true}');
    });
    return;
  }

  // PRESENCE — GET /api/presence (token-gated). { userId: lastSeenMs } for the team roster's "online Xm ago".
  if (req.method === "GET" && req.url.split("?")[0] === "/api/presence") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!tokOk(tok)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(lastActive));
  }

  // AUDIT — GET /api/audit (token-gated). Most-recent-first paper trail for the owner Activity view.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/audit") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!tokOk(tok)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    const a = loadAudit();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(a.slice(-300).reverse()));
  }

  // per-user calendar subscription feed — GET /calendar/<token>.ics (read-only, one-way)
  if (req.method === "GET" && req.url.indexOf("/calendar/") === 0) {
    const tok = decodeURIComponent((req.url.split("?")[0] || "").slice("/calendar/".length)).replace(/\.ics$/i, "");
    const store = loadStore();
    const user = userByCalToken(store, tok);
    if (!user) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("calendar not found"); }
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="jsuite-jobs.ics"', "Cache-Control": "no-cache" });
    return res.end(buildIcs(store, user));
  }

  // login: verify credentials against the synced account records, hand back the sync token
  if (req.method === "POST" && req.url === "/login") {
    const ip = req.socket && req.socket.remoteAddress || "?";
    const rc = rateCheck(ip);
    if (!rc.ok) { res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rc.retry) }); return res.end('{"error":"too many attempts"}'); }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('{"error":"bad json"}'); }
      const store = loadStore();
      const accounts = (((store && store.users) || []).filter(u => u && !u.deleted && !u.kind)).length;
      if (!p || typeof p !== "object") p = {};   // tolerate a null / non-object JSON body — no crash
      if (accountLocked(p.username)) { res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "900" }); return res.end('{"error":"account temporarily locked — try again later"}'); }
      const u = verifyLogin(store, p.username, p.password);
      if (!u) { noteFailedLogin(p && p.username); res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "unauthorized", accounts: accounts })); }
      clearFailedLogin(p.username);
      if (maybeUpgradeHash(store, u.id, p.password)) { try { saveStore(store); } catch (e) {} }   // legacy hash -> scrypt on successful login
      res.writeHead(200, { "Content-Type": "application/json" });
      let outTok = TOKEN; try { const t = issueUserToken(u.id, req.headers["user-agent"] || ""); if (t) outTok = t; } catch (e) {}   // per-user token; fall back to the shared token on any error so login never breaks
      res.end(JSON.stringify({ ok: true, token: outTok, user: { id: u.id, username: u.username, settings: u.settings || null } }));
    });
    return;
  }

  // FORGOT PASSWORD — POST /forgot {username}. ALWAYS 200 (no account enumeration); if the account
  // exists and has an email, mail a one-time reset link. Rate-limited per IP.
  if (req.method === "POST" && req.url === "/forgot") {
    const ip = req.socket && req.socket.remoteAddress || "?";
    const rc = rateCheck(ip);
    if (!rc.ok) { res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rc.retry) }); return res.end('{"error":"too many attempts"}'); }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { p = {}; }
      if (!p || typeof p !== "object") p = {};
      const store = loadStore();
      const u = accountByName(store, p.username) || accountByEmail(store, p.username);
      if (u && u.email) {
        const link = resetBaseUrl(req) + "/?reset=" + makeResetToken(u.id);
        const html = '<p>Tap below to set a new J-Suite password. This link expires in 30 minutes and can be used once.</p>' +
          '<p><a href="' + link + '">Reset my password</a></p>' +
          '<p>If you did not request this, ignore this email — your password will not change.</p>';
        sendEmail(u.email, "Reset your J-Suite password", html).catch(() => {});
      }
      res.writeHead(200, { "Content-Type": "application/json" });   // identical response whether or not the account exists
      res.end('{"ok":true}');
    });
    return;
  }

  // RESET PASSWORD — POST /reset {token,password}. Consumes a one-time token, sets a fresh scrypt hash.
  if (req.method === "POST" && req.url === "/reset") {
    const ip = req.socket && req.socket.remoteAddress || "?";
    const rc = rateCheck(ip);
    if (!rc.ok) { res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rc.retry) }); return res.end('{"error":"too many attempts"}'); }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(body); } catch (e) { p = {}; }
      if (!p || typeof p !== "object") p = {};
      if (!p.password || String(p.password).length < 8) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"password must be at least 8 characters"}'); }
      const userId = consumeResetToken(p.token);
      if (!userId) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"this reset link is invalid or has expired"}'); }
      const store = loadStore();
      const u = ((store && store.users) || []).find(x => x && x.id === userId && !x.deleted);
      if (!u) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"account not found"}'); }
      u.passhash = scryptHash(String(p.password)); u.updatedAt = Date.now();
      try { saveStore(store); } catch (e) {}
      clearFailedLogin(u.username);   // a successful reset clears any lockout
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  // SSO — GET /login/access. Cloudflare Access already verified the user; we verify its SIGNED JWT and
  // issue the same sync token by matching the email to an account. No password. Falls through (401/403)
  // on local/file:// (no Access header) or unmatched email, so the password login still works everywhere.
  if (req.method === "GET" && req.url === "/login/access") {
    (async () => {
      const jwt = req.headers["cf-access-jwt-assertion"] || (req.headers.cookie && (String(req.headers.cookie).match(/CF_Authorization=([^;]+)/) || [])[1]) || "";
      const claims = await verifyAccessJwt(jwt);
      if (!claims || !claims.email) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"no valid access identity"}'); }
      const store = loadStore();
      const u = accountByEmail(store, claims.email);
      if (!u) { res.writeHead(403, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "no account mapped to this email", email: claims.email })); }
      let outTok = TOKEN; try { const t = issueUserToken(u.id, "access:" + claims.email); if (t) outTok = t; } catch (e) {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, token: outTok, user: { id: u.id, username: u.username, settings: u.settings || null }, email: claims.email, via: "access" }));
    })();
    return;
  }

  if (req.method === "POST" && req.url === "/sync") {
    const _ch = []; let _bl = 0;
    req.on("data", c => { _ch.push(c); _bl += c.length; if (_bl > 8e6) req.destroy(); });
    req.on("end", () => {
      const body = Buffer.concat(_ch).toString("utf8");   // full-body UTF-8 decode — per-chunk body+=c mangles multi-byte chars at chunk boundaries (the ��� bug)
      let payload;
      try { payload = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('{"error":"bad json"}'); }
      const tokRec = userTokenRec(payload.token);   // {userId, issued} for a per-user token, or null
      const puid = tokRec && tokRec.userId;
      if (!((TOKEN && payload.token === TOKEN) || puid)) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      const syncUserId = puid || (typeof payload.userId === "string" ? payload.userId : null);   // legacy shared token falls back to the client-claimed id
      noteActive(syncUserId);   // ops-brain last-active (in-memory; doesn't affect the merge)
      const pre = loadStore();
      if (puid) { const _acct = (pre.users || []).find(u => u && u.id === puid); if (_acct && _acct.logoutAt && (+tokRec.issued || 0) < _acct.logoutAt) { res.writeHead(401); return res.end('{"error":"session ended — sign in again"}'); } }   // "log out everywhere": a token issued before the account's logoutAt is dead
      const hadMsg = {}; BIZES.forEach(b => { hadMsg[b] = new Set((((pre[b] || {}).messages) || []).map(m => m && m.id)); });
      const me = puid ? accountById(pre, puid) : null;
      const myOrgs = me ? orgsForUser(pre, me) : ["obx", "jam"].filter(o => pre[o]);   // ISOLATION: identified user → their member orgs; legacy shared token → original orgs only (new orgs stay isolated from it)
      const verifiedOwner = !!(me && me.role === "owner");   // Phase 4: only a verified-owner per-user token may write accounts/roles/passwords
      const scoped = scopedIncoming(payload.state || {}, myOrgs);   // WRITE isolation: foreign org slabs dropped before the merge
      const incomingState = verifiedOwner ? scoped : sanitizeUserWrites(scoped, pre, syncUserId);
      const merged = mergeState(pre, incomingState);
      saveStore(merged);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, state: projectForUser(merged, myOrgs, me) }));   // READ isolation: only the caller's orgs go back
      // best-effort push: tickle recipients of genuinely-new human messages (DMs + broadcasts) synced in
      try {
        const nowMs = Date.now(), incoming = payload.state || {};
        BIZES.forEach(b => (((incoming[b] || {}).messages) || []).forEach(m => {
          if (pushWorthy(m, hadMsg[b], nowMs)) pushNotify(merged, b, m.threadId, m.senderId).catch(() => {});
        }));
      } catch (e) {}
      try { auditDiff(syncUserId, pre, incomingState); } catch (e) {}   // server-authoritative paper trail (what was actually applied); AFTER save + wrapped, so it can never break the sync
    });
    return;
  }
  // QuickBooks Online bridge — only active once qb-config.json exists
  if (QB && QB.haveConfig() && req.url.indexOf("/qb/") === 0) {
    if (req.method === "GET" && req.url === "/qb/connect") { res.writeHead(302, { Location: QB.authorizeUrl() }); return res.end(); }
    if (req.method === "GET" && req.url.indexOf("/qb/callback") === 0) {
      const u = new URL(req.url, "http://x");
      QB.handleCallback(u.searchParams.get("code"), u.searchParams.get("realmId"))
        .then(() => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<h2>QuickBooks connected. You can close this tab.</h2>"); })
        .catch(e => { res.writeHead(500); res.end("QB error: " + e.message); });
      return;
    }
    if (req.method === "GET" && req.url === "/qb/summary") {
      QB.summary().then(s => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(s)); })
        .catch(e => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); });
      return;
    }
    if (req.method === "POST" && req.url === "/qb/create-invoice") {
      let b = ""; req.on("data", c => b += c); req.on("end", () => {
        let p; try { p = JSON.parse(b); } catch (e) { res.writeHead(400); return res.end('{"error":"bad json"}'); }
        QB.createInvoice(p).then(r => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r)); })
          .catch(e => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); });
      });
      return;
    }
  }

  // photo/receipt upload → stored as a server-side blob (uploads/<id>.<ext>), referenced by id in records.
  // Auth = the sync TOKEN. Image or PDF, size-capped, random id (no path traversal). Served by the static handler below.
  if (req.method === "POST" && req.url.split("?")[0] === "/api/upload") {
    const q = new URL(req.url, "http://x");
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || q.searchParams.get("token") || "";
    if (!tokOk(tok)) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
    const chunks = []; let blen = 0;
    req.on("data", c => { chunks.push(c); blen += c.length; if (blen > 16e6) req.destroy(); });
    req.on("end", () => {
      let p; try { p = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { res.writeHead(400); return res.end('{"error":"bad json"}'); }
      const m = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String((p && p.dataUrl) || ""));
      if (!m) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"image (png/jpg/webp) or pdf only"}'); }
      let buf; try { buf = Buffer.from(m[2], "base64"); } catch (e) { res.writeHead(400); return res.end('{"error":"bad data"}'); }
      if (!buf.length || buf.length > 10e6) { res.writeHead(413, { "Content-Type": "application/json" }); return res.end('{"error":"file too big (max 10MB)"}'); }
      const dir = path.join(__dirname, "uploads"); try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      const id = crypto.randomBytes(12).toString("hex") + "." + (m[1] === "application/pdf" ? "pdf" : (m[1] === "image/jpeg" ? "jpg" : m[1].split("/")[1]));
      try { fs.writeFileSync(path.join(dir, id), buf); } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); return res.end('{"error":"write failed"}'); }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, id: id, url: "/uploads/" + id }));
    });
    return;
  }

  // static files (logos, manifest, service worker) from the server folder
  if (req.method === "GET") {
    const rel = decodeURIComponent((req.url.split("?")[0] || "").replace(/^\/+/, ""));
    const full = path.normalize(path.join(__dirname, rel));
    // ALLOWLIST — serve ONLY the app's own static assets. Secrets/config (data.json, *-config.json,
    // qb-tokens.json, vapid-config.json, .env, sync.env) also live in __dirname, so an open
    // "anything in the dir" serve leaks them. Check the NORMALIZED path so js/../data.json can't sneak in.
    const okDir = [path.join(__dirname,"js")+path.sep, path.join(__dirname,"assets")+path.sep, path.join(__dirname,"uploads")+path.sep].some(d => full.startsWith(d));
    const okFile = [path.join(__dirname,"app.css"), path.join(__dirname,"sw.js"), path.join(__dirname,"manifest.webmanifest"), path.join(__dirname,"favicon.ico")].indexOf(full) >= 0;
    if ((okDir || okFile) && full.startsWith(__dirname) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      const types = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
      // no-cache = the browser must revalidate before reusing, so a deploy shows up on the next load
      // (no stale code); the ETag makes unchanged files return a fast 304. Without this, browsers
      // heuristically cached old js — which is exactly why a deploy didn't update the app.
      const st = fs.statSync(full);
      const etag = '"' + st.size.toString(16) + "-" + Math.round(st.mtimeMs).toString(16) + '"';
      if (req.headers["if-none-match"] === etag) { res.writeHead(304, { "Cache-Control": "no-cache", "ETag": etag }); return res.end(); }
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-cache", "ETag": etag });
      return res.end(fs.readFileSync(full));
    }
  }
  res.writeHead(404); res.end('{"error":"not found"}');
});

// Tailscale-only posture: bound to the host's interfaces, reached over the tailnet — the port is
// NOT forwarded/exposed publicly. Keep it that way; auth + token are a second layer, not the first.
if (require.main === module) {
  // Fail closed: a server with no TOKEN accepts every /sync, /upload, /backup, /config request unauthenticated.
  // Refuse to start rather than run wide-open by accident (e.g. a manual run without the env). Inside
  // require.main so `require("./sync-server")` from the test suite is unaffected.
  if (!TOKEN) { console.error("FATAL: TOKEN is not set — refusing to start (the server would be unauthenticated). Set TOKEN in the environment."); process.exit(1); }
  server.listen(PORT, () => {
    console.log(`Sync server on :${PORT}  | data: ${FILE}  | token ${TOKEN ? "set" : "NOT SET (open!)"}`);
  });
}
module.exports = { mergeState, mergeColl, migrateStore, orgIdsOf, accountById, membershipsOfStore, orgsForUser, writerOwnsOrg, scopedIncoming, projectUsers, projectForUser, orgAiContext, verifyLogin, ceoSetReceipt, ceoSetCapRead, scryptHash, scryptVerify, isScrypt, maybeUpgradeHash, accountLocked, noteFailedLogin, clearFailedLogin, makeResetToken, consumeResetToken, hashPw, hashPwFallback, accountByName, accountByEmail, verifyAccessJwt, rateCheck, loadStore, saveStore, userByCalToken, buildIcs, jobsForUser, icsEscape, icsFold, ceoProjection, ceoTokenOk, ceoBuildMessage, ceoBuildProposal, pushNotify, pushWorthy, pushNotifyOwner, pushPeek, vapidJwt, noteActive };
