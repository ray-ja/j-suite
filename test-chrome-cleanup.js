/* test-chrome-cleanup.js — shared headless-Chrome teardown for the test scripts (verify-app.js, shots-app.js,
   shots-desktop.js). These launch chrome-headless-shell with a UNIQUE per-pid --user-data-dir profile. The leak
   this prevents: on a hung/timed-out run, execSync's timeout sends SIGTERM, which chrome-headless-shell (and its
   renderer children, which live in a separate process group) can survive — leaving the browser alive AND the
   /tmp profile dir behind. Over many sessions that piled up to hundreds of orphaned chromes + temp dirs.

   Fix: register(prof) tears the profile's chrome down HARD (pkill -9 by the unique --user-data-dir path, which
   catches the parent AND every child referencing it) + removes the dir, on EVERY exit path (normal, throw,
   SIGINT/SIGTERM). sweepOrphans() self-heals any stragglers left by a prior crash. Pure Node + pkill; a no-op
   on Windows (win32 has no pkill — the per-script rmSync + execSync timeout suffice there). Never throws. */
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const TMP = os.tmpdir();
const PREFIXES = ["jsuite-verify-", "jsuite-shot-", "jsuite-shotd-"];   // the profile-dir prefixes these scripts use
const IS_WIN = process.platform === "win32";

/* hard-kill every process whose command line references this exact profile dir (parent + renderer children),
   then remove the dir. SIGKILL because a hung chrome ignores/outlives the SIGTERM execSync's timeout sends. */
function cleanupProfile(prof) {
  try {
    if (!IS_WIN && prof) {
      try { cp.execSync("pkill -9 -f " + JSON.stringify("user-data-dir=" + prof), { stdio: "ignore" }); } catch (e) {}
    }
    if (prof) fs.rmSync(prof, { recursive: true, force: true });
  } catch (e) {}
}

/* startup self-heal: remove any jsuite-* profile dir older than 30 min (a live run's dir is seconds old, never
   swept) and kill any chrome still bound to it — so a prior crash can't accumulate across runs. */
function sweepOrphans() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(TMP)) {
      if (!PREFIXES.some(p => name.startsWith(p))) continue;
      const full = path.join(TMP, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > 30 * 60 * 1000) cleanupProfile(full);
      } catch (e) {}
    }
  } catch (e) {}
}

/* register best-effort teardown of THIS run's profile on all exit paths. Handlers are synchronous (execSync +
   rmSync), so they complete before the process dies — including the process.exit(1) the scripts call on failure. */
function register(prof) {
  const done = () => cleanupProfile(prof);
  process.on("exit", done);
  process.on("SIGINT", () => { done(); process.exit(130); });
  process.on("SIGTERM", () => { done(); process.exit(143); });
  return prof;
}

module.exports = { cleanupProfile, sweepOrphans, register };
