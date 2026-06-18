#!/usr/bin/env node
/* ---------- WATCHER MONITOR (alert if quiet) ----------
   Reads .watcher-heartbeat.json; if it's stale > 5 minutes (the watcher silently stalled, or the
   daemon died), posts a RAY-ONLY alert to the private "Cap" thread via the scoped write path, so the
   stall surfaces on Ray's phone instead of going unnoticed. Run every ~5 min via a Scheduled Task.

   Exit codes: 0 = healthy · 2 = stale/alerted (so a scheduler can also flag it).
   Flags: --dry-run (print, never post) · --stale-ms=N (override threshold, for testing).
   Reuses watcher-config.json { prodUrl, writeToken }. */
const fs = require("fs"), http = require("http"), https = require("https"), path = require("path"), { spawn } = require("child_process");
const HEARTBEAT = path.join(__dirname, ".watcher-heartbeat.json");
const CFG = path.join(__dirname, "..", "watcher-config.json");
const args = process.argv.slice(2);
const dry = args.indexOf("--dry-run") >= 0;
const staleArg = (args.find(a => a.indexOf("--stale-ms=") === 0) || "").split("=")[1];
const STALE_MS = staleArg ? parseInt(staleArg, 10) : 5 * 60 * 1000;
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); }

let hb = null; try { hb = readJson(HEARTBEAT); } catch (e) {}
const age = (hb && hb.ts) ? Date.now() - hb.ts : Infinity;
if (age <= STALE_MS) { console.log(JSON.stringify({ ok: true, ageSec: Math.round(age / 1000), status: hb && hb.status })); process.exit(0); }

const ageStr = isFinite(age) ? Math.round(age / 1000) + "s" : "no heartbeat file";
const msg = "⚠️ Crew-reply watcher STALLED — last heartbeat " + ageStr + " ago (>" + Math.round(STALE_MS / 60000) + "m). Auto-restarting the watcher daemon now; flagging in case it recurs.";
console.error("ALERT: " + msg);
if (dry) { console.log("(dry-run — not posting / not restarting)"); process.exit(2); }

// SELF-HEAL: relaunch the supervisor daemon detached (covers daemon death / post-reboot, no admin needed)
try {
  const child = spawn(process.execPath, [path.join(__dirname, "watcher-daemon.js")], { cwd: path.join(__dirname, ".."), detached: true, stdio: "ignore" });
  child.unref();
  console.log("self-heal: relaunched watcher-daemon (pid " + child.pid + ")");
} catch (e) { console.error("self-heal failed: " + e.message); }

let cfg; try { cfg = readJson(CFG); } catch (e) { console.error("no watcher-config.json — cannot post alert"); process.exit(2); }
if (!cfg.writeToken) { console.error("watcher-config has no writeToken — cannot post alert"); process.exit(2); }
const payload = JSON.stringify({ title: "Cap", senderLabel: "Cap", body: msg });   // private Cap thread = Ray-only
const u = new URL(cfg.prodUrl.replace(/\/+$/, "") + "/api/ceo/message"), lib = u.protocol === "https:" ? https : http;
const r = lib.request({ method: "POST", hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Authorization: "Bearer " + cfg.writeToken } },
  res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { console.log("alert POST " + res.statusCode); process.exit(2); }); });
r.on("error", e => { console.error("alert post failed: " + e.message); process.exit(2); });
r.setTimeout(15000, () => r.destroy(new Error("timeout")));
r.write(payload); r.end();
