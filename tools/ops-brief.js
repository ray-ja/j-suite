#!/usr/bin/env node
/* ---------- OPS-BRIEF (ops-scanning brain, Phase C — autonomous voice) ----------
   Turns the Phase-B sweep findings into a human gap-report and delivers it. This is the
   sweep → Cap → Ray loop:
     1. read the read-only CEO `view=ops` (same as the sweep),
     2. opsFindings() → deterministic gaps, buildGapReport() → digest + Cap's read on each,
     3. dedupe vs a cursor so only a NEW gap re-briefs (no re-buzzing the same list),
     4. deliver to the AUDIENCE.

   AUDIENCE (THE SWITCH, per Cap): PRE-MEETING the brief goes to RAY ONLY (the private "Cap"
   thread). The crew-facing broadcast path is BUILT but GATED OFF — `CREW_FACING_ENABLED=false`.
   Flip that one constant to true post-crossroads to initiate the crew.

   SAFE BY DEFAULT: `--dry-run` (default) prints the brief and posts NOTHING — so a 3am run can't
   buzz anyone. `--post` actually writes (only when there are NEW findings). Scheduling at
   07:00/12:00/17:00 is a separate cron step (see backlog "Schedule the ops-sweep").

   Config (gitignored): reuses watcher-config.json { prodUrl, readToken, writeToken }.

   Usage:
     node tools/ops-brief.js                       # dry-run, audience=ray → print the Ray digest
     node tools/ops-brief.js --audience=crew       # blocked (gated off) — prints the gate notice
     node tools/ops-brief.js --post                # post to the Cap (Ray-only) thread IF new findings
*/
const fs = require("fs"), http = require("http"), https = require("https"), path = require("path");
const { opsFindings, buildGapReport } = require("./ops-sweep");
const CFG_PATH = path.join(__dirname, "..", "watcher-config.json");
const CURSOR = path.join(__dirname, ".ops-brief-cursor.json");

/* THE SWITCH — crew-facing initiation is one flag away, left OFF until the meeting. */
const CREW_FACING_ENABLED = false;

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); }
function die(m) { console.error("ops-brief: " + m); process.exit(1); }
function loadCfg() { let c; try { c = readJson(CFG_PATH); } catch (e) { die("no watcher-config.json (need prodUrl + readToken)"); } if (!c.prodUrl || !c.readToken) die("watcher-config needs prodUrl + readToken"); return c; }
function loadCursor() { try { return readJson(CURSOR); } catch (e) { return { seen: {} }; } }
function saveCursor(c) { try { fs.writeFileSync(CURSOR, JSON.stringify(c)); } catch (e) {} }

/* PURE: resolve WHERE a brief goes (logical target). Ray → the dedicated Ray-only ops thread (never a
   crew-visible thread). Crew → the broadcast, but only when the switch is enabled; else blocked.
   The actual thread payload is built in main() from config (ops thread id + owner id). Exported so
   the gate + routing are unit-tested. */
function audienceTarget(audience, crewEnabled) {
  audience = audience || "ray";
  if (audience === "crew") {
    if (!crewEnabled) return { blocked: true, reason: "crew-facing path is GATED OFF until the meeting", target: null };
    return { blocked: false, target: "crew" };   // broadcast thread (post-meeting)
  }
  return { blocked: false, target: "ops" };       // Ray-only ops thread (NOT a crew-visible thread)
}

function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === "https:" ? https : http;
    const r = lib.request({ method, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, headers: headers || {} },
      res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
    r.on("error", reject); r.setTimeout(15000, () => r.destroy(new Error("timeout")));
    if (body) r.write(body); r.end();
  });
}
async function fetchOps(cfg) {
  const r = await req("GET", cfg.prodUrl.replace(/\/+$/, "") + "/api/ceo?view=ops", { Authorization: "Bearer " + cfg.readToken });
  if (r.status !== 200) throw new Error("HTTP " + r.status + " " + r.body.slice(0, 80));
  return JSON.parse(r.body);
}

async function main() {
  const args = process.argv.slice(2);
  const audience = (args.find(a => a.indexOf("--audience=") === 0) || "").split("=")[1] || "ray";
  const doPost = args.indexOf("--post") >= 0;   // default = dry-run (safe overnight)

  const tgt = audienceTarget(audience, CREW_FACING_ENABLED);
  if (tgt.blocked) { console.log(JSON.stringify({ blocked: true, audience, reason: tgt.reason })); return; }

  const cfg = loadCfg();
  let ops; try { ops = await fetchOps(cfg); } catch (e) { die("read view=ops failed: " + e.message); }
  const findings = opsFindings(ops);
  const cursor = loadCursor();
  const fresh = findings.filter(f => !cursor.seen[f.key]);
  const brief = buildGapReport(findings, ops.today);   // full open picture, with Cap's read on each

  if (!doPost) {   // dry-run: print, post nothing
    console.log(JSON.stringify({ dryRun: true, audience, target: tgt.target, event: fresh.length > 0, openFindings: findings.length, newFindings: fresh.length, brief }, null, 1));
    return;
  }
  if (!fresh.length) { console.log(JSON.stringify({ posted: false, reason: "no new findings", openFindings: findings.length })); return; }
  if (!cfg.writeToken) die("watcher-config needs writeToken to post");
  // Build the thread payload from config. OPS → the dedicated Ray-only ops thread (NEVER a crew-visible
  // thread): requires ownerId so the thread is created members:[owner], type:dm. Refuse rather than leak.
  let body = { senderLabel: "Cap", body: brief };
  if (tgt.target === "ops") {
    if (!cfg.ownerId) die("watcher-config needs ownerId to post the Ray-only ops brief (refusing — would otherwise default to a crew-visible thread)");
    Object.assign(body, { threadId: cfg.opsThreadId || "thr_ops_capray", members: [cfg.ownerId], to: "ops" });
  } else {   // crew broadcast (post-meeting only)
    Object.assign(body, { threadId: cfg.broadcastThreadId, to: "__crew__", title: "Crew — Broadcast" });
  }
  const payload = JSON.stringify(body);
  const r = await req("POST", cfg.prodUrl.replace(/\/+$/, "") + "/api/ceo/message", { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Authorization: "Bearer " + cfg.writeToken }, payload);
  if (r.status >= 200 && r.status < 300) saveCursor({ seen: findings.reduce((m, f) => { m[f.key] = 1; return m; }, {}) });
  console.log("POST " + r.status + " " + r.body + " (audience=" + audience + ", target=" + tgt.target + ", new=" + fresh.length + ")");
}

if (require.main === module) main();
module.exports = { audienceTarget, CREW_FACING_ENABLED };
