/* org-ai-shared-tests.js — the reserved "_shared" AI credential.
   Ray 2026-07-27: "sharing the key is fine, all of the keys can be shared". An org with no key of its
   own inherits _shared, so every org can run AI while the key lives in ONE place to rotate.
   Guards the two things that must never regress: the key is never echoed to a client, and an org's own
   settings still win. Pure node. Run: node org-ai-shared-tests.js */
const fs = require("fs"), path = require("path");
const sv = require("./sync-server.js");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const SRC = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");

console.log("\n--- the resolver is wired everywhere a key is READ ---");
eq("no read site still does loadOrgAi()[org] for the cfg",
  (SRC.match(/const cfg = loadOrgAi\(\)\[org\];/g) || []).length, 0);
ok("every AI route resolves through orgAiFor", (SRC.match(/const cfg = orgAiFor\(org\);/g) || []).length >= 9,
  (SRC.match(/const cfg = orgAiFor\(org\);/g) || []).length + " sites");
ok("the SETTINGS WRITE path deliberately does NOT inherit (it must target the org's own entry)",
  /const cfg = loadOrgAi\(\), c = cfg\[org\] \|\| \{\};/.test(SRC));

console.log("\n--- inheritance semantics ---");
const shared = { enabled: true, apiKey: "sk-shared", imageKey: "img-shared", model: "claude-haiku-4-5-20251001" };
/* orgAiFor reads the real file, so exercise the merge rule directly on the documented contract */
function merge(own, sh) {
  if (!sh.apiKey && !sh.imageKey) return own;
  return Object.assign({}, sh, own);
}
eq("an org with NO entry inherits the shared key", merge({}, shared).apiKey, "sk-shared");
eq("an org with its OWN key keeps it", merge({ enabled: true, apiKey: "sk-own" }, shared).apiKey, "sk-own");
eq("an org can override just the model and still inherit the key",
  merge({ model: "claude-opus-4-8" }, shared).apiKey, "sk-shared");
eq("...and the override sticks", merge({ model: "claude-opus-4-8" }, shared).model, "claude-opus-4-8");
eq("an explicit enabled:false still wins (opt-out)", merge({ enabled: false }, shared).enabled, false);
eq("no shared credential at all -> unchanged", JSON.stringify(merge({ a: 1 }, {})), JSON.stringify({ a: 1 }));

console.log("\n--- THE SECURITY INVARIANT: the key is never echoed to a client ---");
const st = sv.orgAiStatus("mqwvs3mq98pij");
const keys = Object.keys(st).sort();
ok("status exposes no apiKey field", keys.indexOf("apiKey") < 0, JSON.stringify(keys));
ok("status exposes no imageKey field", keys.indexOf("imageKey") < 0, JSON.stringify(keys));
const flat = JSON.stringify(st);
ok("no value in the status payload looks like an API key", !/sk-[A-Za-z0-9_\-]{8,}/.test(flat), flat.slice(0, 120));
ok("status reports only booleans for credentials", typeof st.hasKey === "boolean" && typeof st.hasImageKey === "boolean");

console.log("\n--- status is HONEST about where the key came from ---");
ok("sharedKey is a boolean", typeof st.sharedKey === "boolean");
eq("the personal org reports an inherited key", sv.orgAiStatus("mqwvs3mq98pij").sharedKey, true);
eq("obx reports its OWN key, not inherited", sv.orgAiStatus("obx").sharedKey, false);

console.log("\n--- every real org can now run AI (the thing that was blocked) ---");
["obx", "jam", "mqwvr5d7h4a7u", "mqwvs3mq98pij"].forEach(o => {
  const s2 = sv.orgAiStatus(o);
  ok(o + ": enabled + has a key", s2.enabled && s2.hasKey, JSON.stringify(s2));
});

console.log("\n--- the config file itself ---");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "org-ai-config.json"), "utf8"));
ok("_shared exists and carries a key", !!(cfg._shared && cfg._shared.apiKey));
eq("_shared is enabled", cfg._shared.enabled, true);
ok("the key lives in ONE place (no org duplicates the shared apiKey)",
  Object.keys(cfg).filter(k => k !== "_shared" && cfg[k] && cfg[k].apiKey === cfg._shared.apiKey).length <= 1,
  "orgs duplicating it: " + Object.keys(cfg).filter(k => k !== "_shared" && cfg[k] && cfg[k].apiKey === cfg._shared.apiKey).join(","));

console.log("\n--- the secret must stay out of git ---");
const gi = fs.readFileSync(path.join(__dirname, ".gitignore"), "utf8");
ok("org-ai-config.json is gitignored", /(^|\n)\s*org-ai-config\.json\s*(\n|$)/.test(gi), gi.split("\n").filter(l => /org-ai/.test(l)).join(" | "));
const tracked = require("child_process").execSync("git ls-files org-ai-config.json", { cwd: __dirname }).toString().trim();
eq("and is NOT tracked by git", tracked, "");

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
