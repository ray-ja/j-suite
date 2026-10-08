/* nav-favorites-tests.js — Favorites (js/176): key resolution, visibility gating, toggle/cap. Pure node.
   Run: node nav-favorites-tests.js → 0 failed. */
const F = require("./js/176-nav-favorites");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } };
const deep = [
  { group: "money", tab: "finance", sub: "bank", setter: "finSub", icon: "🏦", label: "Transactions" },
  { group: "money", tab: "finance", sub: "owed", setter: "finSub", icon: "💸", label: "A/R — owed" },
  { group: "more", tab: "data", sub: "websites", setter: "secGoDeep", icon: "🌐", label: "Websites", only: () => false }
];
const meta = { schedule: { i: "📅", l: "Schedule" }, finance: { i: "💰", l: "Finance" } };
const see = t => t !== "finance" ? true : SEE_FIN; let SEE_FIN = true;

ok("key of a deep screen / a plain tab", F.navFavKeyOf("finance", "bank") === "finance/bank" && F.navFavKeyOf("schedule", "") === "schedule/");
let r = F.navFavResolve("finance/bank", deep, meta, see);
ok("a deep key resolves to its registered row (label, icon, setter)", r && r.label === "Transactions" && r.setter === "finSub" && r.plain === false, r);
r = F.navFavResolve("schedule/", deep, meta, see);
ok("a plain tab resolves from TAB_META", r && r.plain && r.label === "Schedule" && r.icon === "📅", r);
ok("an unknown sub on a tab resolves to nothing (never a wrong screen)", F.navFavResolve("finance/nope", deep, meta, see) === null);
ok("a row whose only() says no is hidden", F.navFavResolve("data/websites", deep, meta, see) === null);
SEE_FIN = false;
ok("⛔ role gate: a screen the role can't see never shows as a favorite (enforced, not just hidden)", F.navFavResolve("finance/bank", deep, meta, see) === null && F.navFavResolve("finance/", deep, meta, see) === null);
SEE_FIN = true;
let list = [];
list = F.navFavToggleList(list, "finance/bank"); list = F.navFavToggleList(list, "schedule/");
ok("pin appends in order", list.join() === "finance/bank,schedule/", list);
list = F.navFavToggleList(list, "finance/bank");
ok("pin again = unpin", list.join() === "schedule/", list);
list = []; for (let i = 0; i < 20; i++) list = F.navFavToggleList(list, "t" + i + "/");
ok("capped at " + F.NAVFAV_MAX + " (oldest dropped)", list.length === F.NAVFAV_MAX && list[0] === "t8/", list);
/* per-org (Ray, 2026-10-08) */
const legacy = ["finance/bank", "schedule/"];
ok("an org with no list of its own falls back to the legacy flat list (nothing pinned disappears)", F.navFavListFor(undefined, "obx", legacy).join() === "finance/bank,schedule/");
let by = F.navFavSetFor(undefined, "obx", F.navFavToggleList(F.navFavListFor(undefined, "obx", legacy), "todo/"));
ok("first pin inside an org copies the fallback into the org's own list and adds to it", by.obx.join() === "finance/bank,schedule/,todo/", by);
ok("another org still sees the legacy list, untouched by obx's pin", F.navFavListFor(by, "lights", legacy).join() === "finance/bank,schedule/", F.navFavListFor(by, "lights", legacy));
by = F.navFavSetFor(by, "lights", ["research/"]);
ok("each org keeps its own list; setting one never changes another", by.obx.length === 3 && by.lights.join() === "research/" && F.navFavListFor(by, "lights", legacy).join() === "research/");
ok("an empty own list is honoured (unpinning everything in an org does not resurrect the legacy list)", F.navFavListFor(F.navFavSetFor(by, "lights", []), "lights", legacy).length === 0);
ok("no org id → legacy list, and a write with no org id is a no-op on the map", F.navFavListFor(by, "", legacy).join() === "finance/bank,schedule/" && Object.keys(F.navFavSetFor(by, "", ["x/"])).join() === "obx,lights");
console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
