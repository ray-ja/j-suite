#!/usr/bin/env node
/* ---------- WATCHER MONITOR (alert if quiet) ----------
   Reads .watcher-heartbeat.json; if it's stale > 5 minutes (the watcher silently stalled, or the
   daemon died), posts a RAY-ONLY alert to the private "Cap" thread via the scoped write path, so the
   stall surfaces on Ray's phone instead of going unnoticed. Run every ~5 min via a Scheduled Task.

   Exit codes: 0 = healthy · 2 = stale/alerted (so a scheduler can also flag it).
   Flags: --dry-run (print only — no restart, no post) · --no-post (self-heal + print, skip the
   Ray alert — for testing) · --stale-ms=N (override the 3-min threshold, for testing).
   Reuses watcher-config.json { prodUrl, writeToken }. */
const fs = require("fs"), http = require("http"), https = require("https"), path = require("path"), { spawn } = require("child_process");
const HEARTBEAT = path.join(__dirname, ".watcher-heartbeat.json");
const CFG = path.join(__dirname, "..", "watcher-config.json");
const args = process.argv.slice(2);
const dry = args.indexOf("--dry-run") >= 0;
const noPost = args.indexOf("--no-post") >= 0;
const staleArg = (args.find(a => a.indexOf("--stale-ms=") === 0) || "").split("=")[1];
const STALE_MS = staleArg ? parseInt(staleArg, 10) : 3 * 60 * 1000;   // alert/self-heal if heartbeat stale > 3 min
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); }

let hb = null; try { hb = readJson(HEARTBEAT); } catch (e) {}
const age = (hb && hb.ts) ? Date.now() - hb.ts : Infinity;
if (age <= STALE_MS) { console.log(JSON.stringify({ ok: true, ageSec: Math.round(age / 1000), status: hb && hb.status })); process.exit(0); }

const ageStr = isFinite(age) ? Math.round(age / 1000) + "s" : "no heartbeat file";
const msg = "⚠️ Crew-reply watcher STALLED — last heartbeat " + ageStr + " ago (>" + Math.round(STALE_MS / 60000) + "m). Auto-restarting the watcher daemon now; flagging in case it recurs.";
console.error("ALERT: " + msg);
if (dry) { console.log("(dry-run — not restarting, not posting)"); process.exit(2); }

// SELF-HEAL: relaunch the supervisor daemon detached — but only if one isn't already running
// (covers daemon death / post-reboot, no admin needed). Dedupe so we never spawn a second daemon.
try {
  const { execSync } = require("child_process");
  let already = false;
  try { already = /watcher-daemon/.test(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\").CommandLine -join \'`n\'"', { encoding: "utf8" })); } catch (e) {}
  if (already) { console.log("self-heal: daemon already running — no relaunch needed"); }
  else { const child = spawn(process.execPath, [path.join(__dirname, "watcher-daemon.js")], { cwd: path.join(__dirname, ".."), detached: true, stdio: "ignore" }); child.unref(); console.log("self-heal: relaunched watcher-daemon (pid " + child.pid + ")"); }
} catch (e) { console.error("self-heal failed: " + e.message); }

if (noPost) { console.log("(--no-post — self-healed, skipping the Ray alert)"); process.exit(2); }

let cfg; try { cfg = readJson(CFG); } catch (e) { console.error("no watcher-config.json — cannot post alert"); process.exit(2); }
if (!cfg.writeToken) { console.error("watcher-config has no writeToken — cannot post alert"); process.exit(2); }
const payload = JSON.stringify({ title: "Cap", senderLabel: "Cap", body: msg });   // private Cap thread = Ray-only
const u = new URL(cfg.prodUrl.replace(/\/+$/, "") + "/api/ceo/message"), lib = u.protocol === "https:" ? https : http;
const r = lib.request({ method: "POST", hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Authorization: "Bearer " + cfg.writeToken } },
  res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { console.log("alert POST " + res.statusCode); process.exit(2); }); });
r.on("error", e => { console.error("alert post failed: " + e.message); process.exit(2); });
r.setTimeout(15000, () => r.destroy(new Error("timeout")));
r.write(payload); r.end();
