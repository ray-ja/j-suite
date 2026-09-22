/* phone-nav-tests.js — the five-item phone bar (js/184). Pure node. */
const P = require("./js/184-phone-nav.js"); let n = 0, f = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, JSON.stringify(a), "want", JSON.stringify(b)); } };
const biz = ["today", "todo", "messages", "team", "work", "inventory", "sales", "money", "ref", "grow", "admin", "more"];
eq(P.phonePrimaryPick(biz, P.PHONE_NAV_PREF.business), ["today", "work", "money", "team"], "business org: the four preferred, in preference order");
eq(P.phonePrimaryPick(["today", "todo", "messages", "life", "journal", "budget", "more"], P.PHONE_NAV_PREF.personal), ["today", "todo", "journal", "budget"], "personal org");
eq(P.phonePrimaryPick(["today", "messages", "escape", "booking", "money", "more"], P.PHONE_NAV_PREF.business), ["today", "money", "messages", "escape"], "missing preferred groups are filled from the visible order");
eq(P.phonePrimaryPick(["today"], P.PHONE_NAV_PREF.business), ["today"], "a one-group org gets one button, no padding");
eq(P.phonePrimaryPick(biz, P.PHONE_NAV_PREF.business, 2), ["today", "work"], "max is respected");
eq(P.phonePrimaryPick(null, null), [], "nothing visible → empty");
eq(P.phoneMoreIsOn(["today", "work"], "money"), true, "More lights up when the open group is not in the bar");
eq(P.phoneMoreIsOn(["today", "work"], "work"), false, "More stays off when the open group is in the bar");
eq(P.phoneMoreIsOn(["today"], ""), false, "no current group → off");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
