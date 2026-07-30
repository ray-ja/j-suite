/* admin-pin-scope-tests.js — the Admin PIN unlock must be scoped to USER + ORG.
   Regression guard for: unlocking Admin in one org silently unlocked every org on the device.
   Pure node. Run: node admin-pin-scope-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const src = fs.readFileSync(path.join(__dirname, "js", "32-admin.js"), "utf8");

/* pull just the three PIN-scope helpers out of the module — the rest of js/32 needs a DOM */
const grab = src.match(/function adminPinKey\(me\)[\s\S]*?function adminPinMarkUnlocked\(me\) \{[^\n]*\n/);
ok("found the PIN-scope helpers in js/32", !!grab);
if (!grab) { console.log("\n=========  " + pass + " passed, " + (fail + 1) + " failed  =========\n"); process.exit(1); }

const store = {};
const ctx = {
  S: { biz: "obx" },
  sessionStorage: {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  console: console
};
vm.createContext(ctx);
vm.runInContext(grab[0] + "\nthis.adminPinKey=adminPinKey;this.adminPinUnlocked=adminPinUnlocked;this.adminPinMarkUnlocked=adminPinMarkUnlocked;", ctx);

const ray = { id: "mq5bu9z3vc4ey", adminPin: "hash" };
const chase = { id: "mq5bv0stnsgy6", adminPin: "hash2" };

console.log("\n--- the key carries BOTH the user and the org ---");
eq("obx key", ctx.adminPinKey(ray), "mq5bu9z3vc4ey|obx");
ctx.S.biz = "mqwvs3mq98pij";
eq("rbjvl key differs", ctx.adminPinKey(ray), "mq5bu9z3vc4ey|mqwvs3mq98pij");
ok("different orgs produce different keys", ctx.adminPinKey(ray) !== "mq5bu9z3vc4ey|obx");
ctx.S.biz = "obx";
ok("different users produce different keys", ctx.adminPinKey(ray) !== ctx.adminPinKey(chase));

console.log("\n--- THE BUG: unlocking one org must NOT unlock another ---");
ctx.S.biz = "obx";
ok("starts locked in obx", !ctx.adminPinUnlocked(ray));
ctx.adminPinMarkUnlocked(ray);
ok("unlocked in obx after entering the PIN", ctx.adminPinUnlocked(ray));
ctx.S.biz = "mqwvs3mq98pij";
ok("STILL LOCKED after switching to the personal org", !ctx.adminPinUnlocked(ray));
ctx.adminPinMarkUnlocked(ray);
ok("unlocking the personal org works", ctx.adminPinUnlocked(ray));
ctx.S.biz = "obx";
ok("obx is now locked again (one slot, last org wins)", !ctx.adminPinUnlocked(ray));

console.log("\n--- another user on the same device is never unlocked by proxy ---");
ctx.S.biz = "mqwvs3mq98pij";
ctx.adminPinMarkUnlocked(ray);
ok("ray unlocked in rbjvl", ctx.adminPinUnlocked(ray));
ok("chase is NOT unlocked in rbjvl", !ctx.adminPinUnlocked(chase));

console.log("\n--- edge cases ---");
ok("null user is never unlocked", !ctx.adminPinUnlocked(null));
ok("undefined user is never unlocked", !ctx.adminPinUnlocked(undefined));

console.log("\n--- no raw session key writes left outside the helper ---");
const rawSet = (src.match(/sessionStorage\.setItem\("jra_admin_ok"/g) || []).length;
eq("exactly one setItem, inside adminPinMarkUnlocked", rawSet, 1);
ok("the gate reads through the helper", /let _adminOk = adminPinUnlocked\(me\);/.test(src));
ok("no bare === me.id comparison left", !/getItem\("jra_admin_ok"\) === me\.id/.test(src));
ok("sign-out still clears the unlock",
  /removeItem\("jra_admin_ok"\)/.test(fs.readFileSync(path.join(__dirname, "js", "28-users-lightweight-accounts.js"), "utf8")));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
