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
const FILE = path.join(__dirname, "data.json");
const APP_FILE = path.join(__dirname, "Business App (v1).html");
const COLLECTIONS = ["customers", "quotes", "jobs", "todos", "mktTracker", "docs", "places", "properties", "inventory", "changelog", "locks", "timeclock", "income", "expenses", "messages"];
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
  const lc = String(username || "").toLowerCase();
  // skip soft-deleted, deactivated (active:false), and non-account records (e.g. the roles config)
  return us.find(u => u && !u.deleted && !u.kind && u.active !== false && String(u.username || "").toLowerCase() === lc) || null;
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
      todayStatus: AvailResolve.status(u, today)
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
      coll.filter(m => m && m.kind === "thread" && !m.deleted).forEach(tr => {
        threads.push({
          biz: b, threadId: tr.threadId, title: tr.title || "", type: tr.type || "", availAsk: !!tr.availAsk, members: tr.members || [],
          messages: coll.filter(m => m && !m.kind && !m.deleted && m.threadId === tr.threadId).sort((a, b2) => (a.ts || 0) - (b2.ts || 0))
            .map(m => ({ id: m.id, senderId: m.senderId, senderLabel: m.senderLabel, body: m.body, ts: m.ts }))
        });
      });
    });
    return { ok: true, asOf, biz: opts.biz || "all", threads };
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
    records.push({ id: tid, kind: "thread", threadId: tid, title: String(p.title || "Strategy").slice(0, 60), type: (p.to && p.to !== "__crew__") ? "dm" : "broadcast", availAsk: !!p.availAsk, members: members, createdBy: "__ceo__", deleted: false, updatedAt: ts });
  }
  const mid = "msg_ceo_" + crypto.randomBytes(6).toString("hex");
  records.push({ id: mid, threadId: tid, senderId: "__ceo__", senderLabel: String(p.senderLabel || "Strategy").slice(0, 80), body: String(p.body || "").slice(0, 4000), ts: ts, deleted: false, updatedAt: ts });
  return { biz: biz, records: records, threadId: tid, messageId: mid };
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
      saveStore(mergeState(store, { [built.biz]: { messages: built.records } }));   // ONLY messages in the incoming
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, biz: built.biz, threadId: built.threadId, messageId: built.messageId }));
    });
    return;
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
module.exports = { mergeState, mergeColl, verifyLogin, hashPw, hashPwFallback, accountByName, rateCheck, loadStore, saveStore, userByCalToken, buildIcs, jobsForUser, icsEscape, icsFold, ceoProjection, ceoTokenOk, ceoBuildMessage };
