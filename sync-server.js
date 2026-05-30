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
let QB = null; try { QB = require("./qb-bridge"); } catch (e) {}

const PORT = process.env.PORT || 4000;
const TOKEN = process.env.TOKEN || "";
const FILE = path.join(__dirname, "data.json");
const APP_FILE = path.join(__dirname, "Business App (v1).html");
const COLLECTIONS = ["customers", "quotes", "jobs", "todos", "mktTracker", "docs"];
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

server.listen(PORT, () => {
  console.log(`Sync server on :${PORT}  | data: ${FILE}  | token ${TOKEN ? "set" : "NOT SET (open!)"}`);
});
