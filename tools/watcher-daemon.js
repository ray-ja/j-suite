#!/usr/bin/env node
/* ---------- WATCHER DAEMON (supervisor) ----------
   Keeps reply-watcher.js running. `reply-watcher watch` exits on an event (to wake the lane) or after
   its idle cap — this re-arms it immediately, and restarts on crash with capped backoff. The watcher
   writes .watcher-heartbeat.json every poll; watcher-monitor.js alerts if that goes stale.

   This supervises ONLY the watcher — NOT the sync-server (Ray's call: the server stays non-durable so
   crashes stay visible). Run as a Windows Scheduled Task (watcher-install.ps1) so it survives reboot.
   Stop with: schtasks /End /TN JSuiteWatcherDaemon  (or kill this process). */
const { spawn } = require("child_process");
const path = require("path");
const WATCHER = path.join(__dirname, "reply-watcher.js");
const ROOT = path.join(__dirname, "..");
let stop = false;

function runOnce() {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [WATCHER, "watch"], { cwd: ROOT, stdio: "inherit" });
    p.on("exit", code => resolve(code == null ? -1 : code));
    p.on("error", () => resolve(-1));
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function loop() {
  let backoff = 1000;
  console.log("[watcher-daemon] up — supervising reply-watcher");
  while (!stop) {
    const code = await runOnce();
    if (code === 0) { backoff = 1000; await sleep(500); }                                  // normal exit (event/idle) → re-arm fast
    else { console.error("[watcher-daemon] watcher exited " + code + " — restart in " + backoff + "ms"); await sleep(backoff); backoff = Math.min(backoff * 2, 30000); }  // crash → backoff (cap 30s)
  }
})();
["SIGINT", "SIGTERM"].forEach(s => process.on(s, () => { stop = true; process.exit(0); }));
