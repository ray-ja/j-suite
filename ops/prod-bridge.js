#!/usr/bin/env node
/* ---------- DEV→PROD BRIDGE (dev side) ----------
   Runs an ALLOWLISTED prod op over the forced-command SSH key. The wrapper on prod (prod-run.sh)
   enforces the allowlist; this side just transports + gates on an explicit --confirm so nothing runs
   by accident. Dispatch invokes this; the planned command is surfaced to Ray for Y/N before --confirm.
   Usage:
     node ops/prod-bridge.js <op> [arg]            # DRY RUN — prints the plan only
     node ops/prod-bridge.js --confirm <op> [arg]  # executes over SSH, prints output + exit code
   ops: deploy <commit> | restart | read_log <ops|server> | snapshot_data */
const { spawnSync } = require("child_process");
const os = require("os"), path = require("path");
const HOST = process.env.PROD_HOST || "rzy@100.103.109.41";        // prod over Tailscale
const KEY = process.env.PROD_KEY || path.join(os.homedir(), ".ssh", "jsuite_bridge");

const argv = process.argv.slice(2);
let confirm = false;
const i = argv.indexOf("--confirm"); if (i >= 0) { confirm = true; argv.splice(i, 1); }
let op = argv.join(" ").trim();
if (!op) { console.error("usage: prod-bridge.js [--confirm] <op>\n  ops: deploy | restart | read_log <ops|server> | snapshot_data"); process.exit(2); }

// `deploy` (no SHA) = deploy the CURRENT origin/main tip. The SHA is internal accounting — Ray
// approves the DEPLOY decision ("Deploy to prod? Y/N"), never a specific commit. We resolve the tip
// right before SSH and pass it to the wrapper, whose commit-verify stays as an internal safety net.
if (op === "deploy") {
  const { execSync } = require("child_process");
  try {
    execSync("git fetch origin -q", { stdio: "ignore" });
    const sha = execSync("git rev-parse --short origin/main", { encoding: "utf8" }).trim();
    op = "deploy " + sha;
    console.log("(internal: origin/main → " + sha + ")");
  } catch (e) { console.error("could not resolve origin/main:", e.message); process.exit(1); }
}

console.log("PLAN  → ssh " + HOST + "  ::  prod-run.sh " + op);
if (!confirm) { console.log("(dry run — add --confirm to execute; surface this plan to Ray for Y/N first)"); process.exit(0); }

const r = spawnSync("ssh", ["-i", KEY, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", HOST, op], { encoding: "utf8", timeout: 240000 });
if (r.error) { console.error("SSH ERROR:", r.error.message); process.exit(1); }
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
console.log("\n[ssh exit " + r.status + "]");
process.exit(r.status == null ? 1 : r.status);
