/* collections-parity-test.js — every collection in the client blank() MUST be in the server sync COLLECTIONS,
   or records in it are silently dropped on every sync (the "milestones" ghost-collection class of data loss).
   Pure node. Run: node collections-parity-test.js */
const fs = require("fs");
const state = fs.readFileSync("js/02-state.js", "utf8");
const server = fs.readFileSync("sync-server.js", "utf8");
function keysOfBlank() {
  const m = state.match(/function blank\(\)\s*\{\s*return\s*\{([\s\S]*?)\}\s*\}/);
  if (!m) throw new Error("could not find blank()");
  return m[1].split(",").map(s => s.split(":")[0].trim()).filter(Boolean);
}
function serverCollections() {
  const m = server.match(/\bconst COLLECTIONS\s*=\s*\[([\s\S]*?)\]/);   // the exact `const COLLECTIONS = [...]` (not AUDIT_/PROPOSE_)
  if (!m) throw new Error("could not find COLLECTIONS");
  return new Set(m[1].split(",").map(s => s.replace(/["'\s]/g, "")).filter(Boolean));
}
const blankKeys = keysOfBlank(), coll = serverCollections();
const missing = blankKeys.filter(k => !coll.has(k));
let pass = 0, fail = 0;
const ck = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ FAIL " + n)); };
ck("blank() has a healthy number of collections (" + blankKeys.length + ")", blankKeys.length > 20);
ck("server COLLECTIONS is populated (" + coll.size + ")", coll.size > 20);
ck("'milestones' now syncs (regression: was dropped)", coll.has("milestones"));
ck("EVERY blank() collection is in server COLLECTIONS — missing: [" + missing.join(", ") + "]", missing.length === 0);
console.log("\n  =========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
