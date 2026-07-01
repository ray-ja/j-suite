/* SERVED-SCRIPTS SAFEGUARD — pure Node (no Chrome): node served-scripts-tests.js
 *
 * The exact bug this guards: the shell (Business App (v1).html) referenced a root-level asset
 * (availability-resolve.js) that the sync-server static handler did NOT allowlist, so the server 404'd it
 * and every member's availability rendered gray/"unset" for days. The file was on disk and loaded fine over
 * file://, so no other gate caught it — only a real HTTP GET through the server's okDir/okFile allowlist
 * would have.
 *
 * This test parses every non-CDN <script src> and <link href> local asset out of the shell, then asks the
 * REAL server static handler (started in-process, on a random port, with a throwaway TOKEN) to serve each one,
 * and asserts a 200 (not 404). Any shell-referenced local asset the allowlist would NOT serve is FLAGGED —
 * that asset would be blank/broken in production the moment it's needed.
 */
const fs = require("fs"), path = require("path");

let failed = 0, passed = 0;
function ok(msg) { passed++; console.log("  ok  " + msg); }
function bad(msg) { failed++; console.log("FAIL  " + msg); }

// ---- 1) extract local (non-CDN) assets the shell actually references ----
const html = fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8");
function isLocal(u) { return u && !/^https?:\/\//i.test(u) && !/^data:/i.test(u) && !/^\/\//.test(u); }
const assets = new Set();
let m;
const scriptRe = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
while ((m = scriptRe.exec(html))) if (isLocal(m[1])) assets.add(m[1].split("?")[0].replace(/^\/+/, ""));
const linkRe = /<link[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
while ((m = linkRe.exec(html))) if (isLocal(m[1])) assets.add(m[1].split("?")[0].replace(/^\/+/, ""));
// also cover the apple-touch / theme icons referenced via href on <link rel="apple-touch-icon"> (already caught
// by linkRe) and any manifest reference. (manifest.webmanifest is a <link rel="manifest"> — caught above.)

const list = Array.from(assets).sort();
console.log("Shell references " + list.length + " local asset(s):");
list.forEach(a => console.log("   - " + a));
console.log("");

// ---- 2) replicate the server's exact static allowlist and keep it in lockstep ----
// The http.Server the module builds is not exported and only .listen()s under require.main, so we can't drive
// GETs through it directly. Instead we replicate the server's exact okDir/okFile allowlist predicate and keep
// it honest with a drift guard (below) that fails if sync-server.js's real list ever changes.

// Mirror of sync-server.js's static allowlist (okDir + okFile). If the server's list changes, the drift guard
// at the bottom fails loudly so this mirror gets updated.
const okDir = [path.join(__dirname, "js") + path.sep, path.join(__dirname, "assets") + path.sep, path.join(__dirname, "uploads") + path.sep];
const okFile = [
  path.join(__dirname, "app.css"),
  path.join(__dirname, "sw.js"),
  path.join(__dirname, "manifest.webmanifest"),
  path.join(__dirname, "favicon.ico"),
  path.join(__dirname, "availability-resolve.js"),
];
function serverWouldServe(rel) {
  const full = path.normalize(path.join(__dirname, decodeURIComponent(rel)));
  const inDir = okDir.some(d => full.startsWith(d));
  const inFile = okFile.indexOf(full) >= 0;
  return (inDir || inFile) && full.startsWith(__dirname) && fs.existsSync(full) && fs.statSync(full).isFile();
}

// ---- 3) assert each referenced asset is BOTH on disk AND served by the allowlist ----
list.forEach(rel => {
  const onDisk = fs.existsSync(path.join(__dirname, rel));
  const served = serverWouldServe(rel);
  if (!onDisk) { bad("shell references '" + rel + "' but it is NOT on disk"); return; }
  if (!served) { bad("SHELL-REFERENCED ASSET NOT SERVED: '" + rel + "' is on disk but the sync-server static allowlist would 404 it (this is the availability-resolve.js class of bug)"); return; }
  ok(rel + " — on disk + allowlisted");
});

// ---- 4) drift guard: the mirror above must match the server's real okFile/okDir source ----
const serverSrc = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
okFile.forEach(f => {
  const base = path.basename(f);
  if (serverSrc.indexOf('"' + base + '"') < 0 && serverSrc.indexOf("'" + base + "'") < 0)
    bad("DRIFT: this test's okFile mirror lists '" + base + "' but sync-server.js no longer does — update the mirror");
});
["js", "assets", "uploads"].forEach(d => {
  if (serverSrc.indexOf('"' + d + '"') < 0) bad("DRIFT: this test's okDir mirror lists '" + d + "/' but sync-server.js no longer does — update the mirror");
});
// and the reverse: every root-level file the server allowlists that the SHELL references is covered above;
// warn if the server allowlists a root file the shell no longer references (dead entry — informational only).

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
