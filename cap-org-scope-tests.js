/* cap-org-scope-tests.js — the Cap-on-Today thread must be scoped PER ORG.
   The bug (Ray, 2026-08-02): "Cap's messages are coming through on my personal account also on Today."
   The localStorage key was cap_today_<user>_<date> with NO org, so one thread was shared by every org — his
   OBX business conversation replayed onto the personal org's Today page. D() and the server call were both
   correctly org-scoped the whole time; only this cache key wasn't.
   Pure node (no headless chrome — that harness hangs intermittently). Run: node cap-org-scope-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const SRC = fs.readFileSync(path.join(__dirname, "js", "97-cap-today.js"), "utf8");

/* a tiny localStorage stand-in with the real enumeration surface (length + key(i)) the prune loop walks */
function mkLS() {
  const m = new Map();
  return {
    _m: m,
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i]; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    keys() { return Array.from(m.keys()).sort(); }
  };
}

/* pull the three storage fns out of the module and run them for real */
function ctxFor(userId, org, todayStr, ls) {
  const c = {
    console, JSON, Array, String, Object, Date,
    localStorage: ls,
    S: { biz: org },
    curUser: () => (userId ? { id: userId } : null),
    today: () => todayStr
  };
  vm.createContext(c);
  const grab = re => (SRC.match(re) || [""])[0];
  vm.runInContext(
    grab(/function capUserPfx\(\)[\s\S]*?\n\}/) +
    "\n" + grab(/function capStoreKey\(\)[\s\S]*?\n\}/) +
    "\n" + grab(/function capLoadThread\(\)[\s\S]*?\n\}/) +
    "\n" + grab(/function capSaveThread\(\)[\s\S]*?\n\}/) +
    "\nthis.capStoreKey=capStoreKey;this.capLoadThread=capLoadThread;this.capSaveThread=capSaveThread;", c);
  return c;
}

console.log("\n--- the org is IN the key ---");
{
  const ls = mkLS();
  const obx = ctxFor("u1", "obx", "2026-08-02", ls);
  const per = ctxFor("u1", "mqwvs3mq98pij", "2026-08-02", ls);
  ok("the key names the org", obx.capStoreKey().indexOf("obx") >= 0, obx.capStoreKey());
  ok("two orgs, same user, same day -> DIFFERENT keys", obx.capStoreKey() !== per.capStoreKey(),
    obx.capStoreKey() + " vs " + per.capStoreKey());
  ok("the source has no org-less key left", !/"cap_today_" \+ \(\(me && me\.id\) \|\| "anon"\) \+ "_" \+ t/.test(SRC));
}

console.log("\n--- THE BLEED: a business thread must never render on the personal org ---");
{
  const ls = mkLS();
  const obx = ctxFor("u1", "obx", "2026-08-02", ls);
  obx.CAP_THREAD = [{ role: "user", content: "how much did Mike Green pay" },
                    { role: "assistant", content: "He owes $7,197." }];
  obx.capSaveThread();
  const per = ctxFor("u1", "mqwvs3mq98pij", "2026-08-02", ls);
  const seen = per.capLoadThread();
  eq("the personal org opens EMPTY", seen.length, 0);
  ok("no business content crossed over", !JSON.stringify(seen).includes("Mike Green"), JSON.stringify(seen));
  eq("...and the OBX thread is still intact", obx.capLoadThread().length, 2);
}

console.log("\n--- switching orgs must not DESTROY the other org's thread (the same bug, inverted) ---");
{
  const ls = mkLS();
  const a = ctxFor("u1", "obx", "2026-08-02", ls);
  a.CAP_THREAD = [{ role: "user", content: "obx" }]; a.capSaveThread();
  const b = ctxFor("u1", "mqwvs3mq98pij", "2026-08-02", ls);
  b.CAP_THREAD = [{ role: "user", content: "personal" }]; b.capSaveThread();
  b.capLoadThread();                                   // the prune runs here
  eq("both same-day threads survive", ls.length, 2);
  eq("obx still reads its own", a.capLoadThread()[0].content, "obx");
  eq("personal still reads its own", b.capLoadThread()[0].content, "personal");
  a.capLoadThread();                                   // prune from the other side too
  eq("...and after switching back, still both", ls.length, 2);
}

console.log("\n--- the date rollover still prunes (the behaviour we must not lose) ---");
{
  const ls = mkLS();
  const y = ctxFor("u1", "obx", "2026-08-01", ls);
  y.CAP_THREAD = [{ role: "user", content: "yesterday" }]; y.capSaveThread();
  const yp = ctxFor("u1", "mqwvs3mq98pij", "2026-08-01", ls);
  yp.CAP_THREAD = [{ role: "user", content: "yesterday personal" }]; yp.capSaveThread();
  eq("two stale keys exist", ls.length, 2);
  const t = ctxFor("u1", "obx", "2026-08-02", ls);
  eq("today opens empty", t.capLoadThread().length, 0);
  eq("BOTH of yesterday's keys are pruned", ls.length, 0);
}

console.log("\n--- another user's thread is untouched ---");
{
  const ls = mkLS();
  const other = ctxFor("u2", "obx", "2026-08-02", ls);
  other.CAP_THREAD = [{ role: "user", content: "chase" }]; other.capSaveThread();
  const me = ctxFor("u1", "obx", "2026-08-02", ls);
  me.capLoadThread();
  eq("u2's thread survives u1's prune", other.capLoadThread()[0].content, "chase");
  eq("u1 sees nothing of u2", me.capLoadThread().length, 0);
}

console.log("\n--- signed out / no org degrades safely ---");
{
  const ls = mkLS();
  const anon = ctxFor(null, "", "2026-08-02", ls);
  ok("anon + no org still yields a usable key", /^cap_today_anon_none_2026-08-02$/.test(anon.capStoreKey()), anon.capStoreKey());
  ok("loading doesn't throw", Array.isArray(anon.capLoadThread()));
}

console.log("\n--- the server call was ALREADY scoped (guard against a regression) ---");
ok("the assistant POST sends the current org", /org:\s*\(typeof S !== "undefined" \? S\.biz : ""\)/.test(SRC));
ok("the digest is read from D() (org-scoped)", /D\(\)\.messages/.test(SRC));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
