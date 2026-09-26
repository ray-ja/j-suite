/* desktop-tests.js — the desktop pass (Phase 5): tier, sidebar partition, job-page grid partition. Pure node. */
const K = require("./js/194-desktop.js"); const P = require("./js/184-phone-nav.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
eq(K.dkTier(390), "compact", "phone");
eq(K.dkTier(899), "compact", "just under the desktop breakpoint");
eq(K.dkTier(900), "medium", "laptop");
eq(K.dkTier(1279), "medium", "still one pane");
eq(K.dkTier(1280), "expanded", "two panes from 1280");
eq(K.dkTier(1920), "expanded", "wide");
const groups = ["today", "todo", "messages", "team", "work", "inventory", "sales", "money", "ref", "admin", "more"];
const prim = P.phonePrimaryPick(groups, P.PHONE_NAV_PREF.business);
eq(K.dkSidebar(groups, prim, "work"), { shown: ["today", "team", "work", "money"], more: ["todo", "messages", "inventory", "sales", "ref", "admin", "more"], hidden: 7 }, "sidebar shows the four primaries; seven fold under More");
eq(K.dkSidebar(groups, prim, "sales").shown.slice().sort(), ["money", "sales", "team", "today", "work"], "the open group is shown even when it lives under More");
eq(K.dkSidebar(groups, prim, "sales").hidden, 6, "…and is not counted as hidden");
eq(K.dkSidebar(["today"], ["today"], "today"), { shown: ["today"], more: [], hidden: 0 }, "a one-group org has nothing to fold");
/* job page: the run after the tab row, before the Back button, needs at least two cards */
const T = { tabs: true }, C = { card: true }, X = {}, B = { back: true };
eq(K.dkJobGridRange([X, T, C, C, C, B]), { start: 2, count: 3 }, "cards after the tab row, before Back");
eq(K.dkJobGridRange([C, C]), null, "no tab row → leave the page alone");
eq(K.dkJobGridRange([T, C, B]), null, "one card is not worth a grid");
eq(K.dkJobGridRange([T, C, X, C]), { start: 1, count: 3 }, "non-card nodes inside the run ride along; no Back → to the end");
eq(K.dkJobGridRange([]), null, "empty");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
