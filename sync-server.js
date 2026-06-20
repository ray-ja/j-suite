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
// Web Push (VAPID, "tickle" pattern — contentless push, no RFC-8291 encryption). Keys in gitignored
// vapid-config.json {publicKey, privateKey, subject}. Absent → push is INERT (pubkey 404s, no sends).
// Public key is served to clients via GET /api/push/pubkey (it's not a secret).
let VAPID = null;
try { VAPID = JSON.parse(fs.readFileSync(path.join(__dirname, "vapid-config.json"), "utf8")); } catch (e) {}
// Last-active per user (ops-brain Layer-1 capture). IN-MEMORY ONLY — never written to data.json, so
// it can't churn the sync layer. Stamped (throttled ~60s/user) on /sync; surfaced read-only on /api/ceo.
const lastActive = {};
function noteActive(userId) { if (!userId || typeof userId !== "string") return; const n = Date.now(); if (n - (lastActive[userId] || 0) > 60000) lastActive[userId] = n; }
const FILE = path.join(__dirname, "data.json");
const APP_FILE = path.join(__dirname, "Business App (v1).html");
// Messaging rollout flag — OFF by default. Activate in prod WITHOUT a code change/redeploy:
// set env MESSAGING_ON=1 (or ceo-config.json {"messagingOn":true}) and restart. The shell route
// then injects window.JSUITE_MESSAGING=true so the client's gate (js/47) turns the feature on.
const MESSAGING_ON = process.env.MESSAGING_ON === "1" || (function () {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ceo-config.json"), "utf8")).messagingOn === true; } catch (e) { return false; }
})();
const COLLECTIONS = ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "changelog", "locks", "timeclock", "income", "expenses", "messages", "resale", "pendingChanges"];
const BIZES = ["obx", "jam"];

function blankBiz() { return { customers: [], quotes: [], jobs: [] }; }
function loadStore() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch (e) { return { obx: blankBiz(), jam: blankBiz() }; }
}
function saveStore(s) { fs.writeFileSync(FILE, JSON.stringify(s)); }

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
function verifyLogin(store, username, password) {
  const u = accountByName(store, username);
  if (!u || !u.passhash) return null;
  const ph = String(u.passhash);
  return (ph === hashPw(password) || ph === hashPwFallback(password)) ? u : null;
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
  const out = {};
  for (const biz of BIZES) {
    out[biz] = blankBiz();
    const s = stored[biz] || blankBiz(), i = (incoming && incoming[biz]) || blankBiz();
    for (const c of COLLECTIONS) out[biz][c] = mergeColl(s[c], i[c]);
  }
  out.users = mergeColl((stored && stored.users) || [], (incoming && incoming.users) || []);
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
  // next 7 days availability glance
  const availabilityWeek = [];
  for (let i = 0; i < 7; i++) {
    const ds = ceoDateStr(new Date(asOf + i * 86400000));
    const bucket = { date: ds, available: [], partial: [], off: [], timeoff: [] };
    members.forEach(u => {
      const s = AvailResolve.status(u, ds);
      if (s === "timeoff") bucket.timeoff.push(u.id);
      else if (s === "off") bucket.off.push(u.id);
      else if (s === "partial") bucket.partial.push(u.id);
      else bucket.available.push(u.id);   // "on" + "unset" => available
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
          biz: b, threadId: tr.threadId, title: tr.title || "", type: tr.type || "", availAsk: !!tr.availAsk, members: tr.members || [],
          messages: coll.filter(m => m && !m.kind && !m.deleted && m.threadId === tr.threadId).sort((a, b2) => (a.ts || 0) - (b2.ts || 0))
            .map(m => ({ id: m.id, senderId: m.senderId, senderLabel: m.senderLabel, body: m.body, ts: m.ts })),
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
    const jobs = [], todos = [], openShifts = [], unscheduledQuotes = [], resale = [];
    bizes.forEach(b => {
      (((store[b] || {}).jobs) || []).forEach(j => { if (j && !j.deleted) jobs.push({ id: j.id, biz: b, title: j.title || "", date: j.date || "", time: j.time || "", crew: j.crew || [], done: !!j.done, completedAt: j.completedAt || 0, completedBy: j.completedBy || "", customer: ceoCustName(store, b, j.customerId), equipment: (j.equipment || []).map(e => e && e.itemId).filter(Boolean) }); });
      (((store[b] || {}).todos) || []).forEach(td => { if (td && !td.deleted) todos.push({ id: td.id, biz: b, title: td.title || "", due: td.due || "", done: !!td.done, priority: td.priority || "", assignee: td.assignee || "", updatedAt: td.updatedAt || 0 }); });
      (((store[b] || {}).timeclock) || []).forEach(e => { if (e && !e.deleted && e.clockOut == null) openShifts.push({ id: e.id, biz: b, userId: e.userId, jobId: e.jobId, clockIn: e.clockIn || 0 }); });
      (((store[b] || {}).quotes) || []).forEach(q => { if (q && !q.deleted && q.accepted && !q.jobId) unscheduledQuotes.push({ id: q.id, biz: b, customer: q.cust || ceoCustName(store, b, q.customerId), total: q.total || 0, acceptedDate: q.acceptedDate || q.date || "" }); });
      (((store[b] || {}).resale) || []).forEach(r => { if (r && !r.deleted && r.status !== "sold") resale.push({ id: r.id, biz: b, item: r.item || "", status: r.status || "pulled", jobId: r.jobId || "", platform: r.platform || "", listedDate: r.listedDate || "", createdAt: r.createdAt || 0, updatedAt: r.updatedAt || 0 }); });
    });
    return { ok: true, asOf, today, biz: opts.biz || "all", crew, availabilityWeek, jobs, todos, openShifts, unscheduledQuotes, resale };
  }
  const full = { ok: true, asOf, biz: opts.biz || "all", crew, availabilityWeek, openJobs, openQuotes, counts };
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

/* ---------- SCOPED CEO propose path: append to the pendingChanges queue ONLY ----------
   Step 2 approval queue. ceoBuildProposal returns a single pendingChanges record; the route merges
   { [biz]: { pendingChanges: [record] } } via the SAME mergeState — so a propose can ONLY add a
   queued proposal. It is structurally incapable of touching todos/customers/quotes/jobs/accounts.
   The whitelist below is enforced HERE (defense in depth): a buggy/compromised Cap still cannot
   propose outside the lane, and APPLY is never the model — it's deterministic client code on approval. */
// "Everything proposable" — all BUSINESS collections. EXCLUDES system/meta plumbing: messages (own
// scoped path), pendingChanges (the queue itself), changelog (audit log), locks (soft-lock heartbeats).
// Widening what Cap may PROPOSE never widens its authority — every proposal still needs owner approval.
const PROPOSE_COLLECTIONS = ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "timeclock", "income", "expenses", "resale"];
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
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html" || req.url === "/app")) {
    return fs.readFile(APP_FILE, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("app file not found next to sync-server.js"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (MESSAGING_ON) { return res.end(buf.toString("utf8").replace("</head>", '<script>window.JSUITE_MESSAGING=true;</script></head>')); }
      res.end(buf);
    });
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, store: FILE }));
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
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
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
      const u = verifyLogin(store, p.username, p.password);
      if (!u) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "unauthorized", accounts: accounts })); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, token: TOKEN, user: { id: u.id, username: u.username, settings: u.settings || null } }));
    });
    return;
  }

  if (req.method === "POST" && req.url === "/sync") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 8e6) req.destroy(); });
    req.on("end", () => {
      let payload;
      try { payload = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('{"error":"bad json"}'); }
      if (TOKEN && payload.token !== TOKEN) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      noteActive(payload.userId);   // ops-brain last-active (in-memory; doesn't affect the merge)
      const merged = mergeState(loadStore(), payload.state || {});
      saveStore(merged);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, state: merged }));
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

  // static files (logos, manifest, service worker) from the server folder
  if (req.method === "GET") {
    const rel = decodeURIComponent((req.url.split("?")[0] || "").replace(/^\/+/, ""));
    const full = path.normalize(path.join(__dirname, rel));
    if (rel && full.startsWith(__dirname) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      const types = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
      return res.end(fs.readFileSync(full));
    }
  }
  res.writeHead(404); res.end('{"error":"not found"}');
});

// Tailscale-only posture: bound to the host's interfaces, reached over the tailnet — the port is
// NOT forwarded/exposed publicly. Keep it that way; auth + token are a second layer, not the first.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Sync server on :${PORT}  | data: ${FILE}  | token ${TOKEN ? "set" : "NOT SET (open!)"}`);
  });
}
module.exports = { mergeState, mergeColl, verifyLogin, hashPw, hashPwFallback, accountByName, rateCheck, loadStore, saveStore, userByCalToken, buildIcs, jobsForUser, icsEscape, icsFold, ceoProjection, ceoTokenOk, ceoBuildMessage, ceoBuildProposal, pushNotify, pushNotifyOwner, pushPeek, vapidJwt, noteActive };
