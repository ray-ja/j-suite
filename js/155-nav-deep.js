/* ---------- THE THIRD LEVEL (js/155) — teaching the nav about screens it never knew existed ----------
   Ray, 2026-08-26, after being sent to a screen he couldn't find: "See how it's really hard to navigate
   this? There's, like, tabs and sub tabs and sub tabs of sub tabs. There's no clear navigation order…
   There's just way too many buttons to click. It's way too easy to have things hidden."

   ⚠️ THE ACTUAL PROBLEM IS NOT DEPTH, IT IS THAT THE NAVIGATION SYSTEM DOESN'T KNOW LEVEL THREE EXISTS.

       level 1   NAV_GROUPS      the sidebar               renderNav() knows about these
       level 2   group.tabs      the subnav row            renderSubnav() knows about these
       level 3   FINSUB, BUDGET_SUB, …   a variable INSIDE one screen's own module   ⛔ nothing knows

   A/R is level three. It is `FINSUB === "owed"`, a string in js/40 that no router, no menu and no search
   has ever heard of. That is why it cannot be found, cannot be linked to, and cannot carry a badge saying
   $7,487 is sitting behind it. Eleven of his most-used screens live down there, invisible.

   ⭐ SO THIS IS A REGISTRY, NOT A MENU. Once a level-3 destination is a DATA ROW — group, tab, sub, label,
   how to get there — the sidebar can list it, the current one can be highlighted, and a number can be
   pinned to it. The expanding sidebar he asked for is then two lines of rendering rather than a redesign.

   ⚠️ AND IT NAVIGATES THROUGH THE SCREEN'S OWN SETTER, never by writing FINSUB directly. finSub() and
   budgetSetSub() already exist, already re-render, and are what the on-screen buttons call — going around
   them would give two ways to reach the same state that could drift apart, which is the whole disease
   being treated here. */

var NAV_DEEP = [
  /* MONEY → Finance. Ordered by how often he actually needs them, not by how they were built:
     what's owed first, because that is the screen with his money on it. */
  { group: "money", tab: "finance", sub: "owed",     setter: "finSub", icon: "💸", label: "A/R — owed" },
  { group: "money", tab: "finance", sub: "overview", setter: "finSub", icon: "📊", label: "Overview" },
  { group: "money", tab: "finance", sub: "cash",     setter: "finSub", icon: "🏦", label: "Cash" },
  { group: "money", tab: "finance", sub: "income",   setter: "finSub", icon: "📥", label: "Income" },
  { group: "money", tab: "finance", sub: "expenses", setter: "finSub", icon: "📤", label: "Expenses" },
  { group: "money", tab: "finance", sub: "payouts",  setter: "finSub", icon: "💵", label: "Payouts" },
  { group: "money", tab: "finance", sub: "priority", setter: "finSub", icon: "🪜", label: "Payout plan" },
  { group: "money", tab: "finance", sub: "paybacks", setter: "finSub", icon: "🚜", label: "Paybacks" },
  { group: "money", tab: "finance", sub: "tax",      setter: "finSub", icon: "🧾", label: "Tax" },
  { group: "money", tab: "finance", sub: "pl",       setter: "finSub", icon: "💹", label: "Job P&L" },
  { group: "money", tab: "finance", sub: "analysis", setter: "finSub", icon: "📈", label: "Analysis" },

  /* ⭐ PEOPLE & PLACES. Ray, 2026-08-26: "you get the people and places, and it drops down to customers,
     but it should have customers, properties and places." It showed one row because `accounts` is one TAB
     whose three views live in ACCTSUB — level three again, invisible again. ppGo() is the screen's own
     setter, so the same rule applies: go through it, never write ACCTSUB. */
  { group: "team", tab: "team",     sub: "",           setter: "ppGoDeep", icon: "👥", label: "People" },
  { group: "team", tab: "accounts", sub: "customers",  setter: "ppGoDeep", icon: "🧑", label: "Customers" },
  { group: "team", tab: "accounts", sub: "properties", setter: "ppGoDeep", icon: "🏠", label: "Properties" },
  { group: "team", tab: "accounts", sub: "places",     setter: "ppGoDeep", icon: "📍", label: "Places" },

  /* BUDGET. Review only exists while something is waiting, so it is filtered at render time. */
  { group: "budget", tab: "budget", sub: "review",   setter: "budgetSetSub", icon: "📥", label: "Review",
    only: function () { return (typeof ledgerInboxCount === "function") && ledgerInboxCount() > 0; } },
  { group: "budget", tab: "budget", sub: "month",    setter: "budgetSetSub", icon: "📅", label: "Month" },
  { group: "budget", tab: "budget", sub: "tx",       setter: "budgetSetSub", icon: "🧾", label: "Transactions" },
  { group: "budget", tab: "budget", sub: "bills",    setter: "budgetSetSub", icon: "🔁", label: "Bills" },
  { group: "budget", tab: "budget", sub: "debts",    setter: "budgetSetSub", icon: "💳", label: "Debts" },
  { group: "budget", tab: "budget", sub: "stmt",     setter: "budgetSetSub", icon: "📊", label: "Statements" },
  { group: "budget", tab: "budget", sub: "tax",      setter: "budgetSetSub", icon: "🧮", label: "Tax" },
  { group: "budget", tab: "budget", sub: "settings", setter: "budgetSetSub", icon: "⚙️", label: "Settings" }
];

/* a live number pinned to a destination — the point of the whole exercise is that $7,487 should be
   visible from the sidebar instead of found by hunting */
var NAV_BADGES = {
  "finance/owed": function () {
    try { var n = (typeof colTotalOwed === "function") ? colTotalOwed() : 0; return n > 0.5 ? navdMoney(n) : ""; }
    catch (e) { return ""; }
  },
  "budget/review": function () {
    try { var n = (typeof ledgerInboxCount === "function") ? ledgerInboxCount() : 0; return n ? String(n) : ""; }
    catch (e) { return ""; }
  }
};
function navdMoney(n) {
  var v = Math.round(+n || 0);
  return "$" + (v >= 1000 ? (Math.round(v / 100) / 10) + "k" : String(v));
}

/* which tabs have their whole third level registered here — the ones whose in-screen button row can be
   hidden on desktop because the sidebar now carries every one of its destinations */
function navDeepCoveredTabs() {
  var seen = {};
  NAV_DEEP.forEach(function (d) { seen[d.tab] = 1; });
  return Object.keys(seen);
}

/* ⭐ EVERY DESTINATION UNDER ONE SIDEBAR GROUP, level 2 and level 3 together, in one ordered list.
   A tab that HAS registered children is represented BY those children — listing "Finance" above its own
   eleven sub-screens would just be another button that goes somewhere vaguer than the row beneath it. */
function navDeepFor(groupKey) {
  var g = (typeof NAV_GROUPS !== "undefined") ? NAV_GROUPS.find(function (x) { return x.key === groupKey; }) : null;
  if (!g) return [];
  var allowed = (typeof groupTabs === "function") ? groupTabs(g) : (g.tabs || []);
  var covered = navDeepCoveredTabs();
  var out = [];

  allowed.forEach(function (t) {
    if (covered.indexOf(t) >= 0) {
      /* level 3: this tab's own screens */
      NAV_DEEP.forEach(function (d) {
        if (d.group !== groupKey || d.tab !== t) return;
        if (typeof d.only === "function" && !d.only()) return;
        out.push(d);
      });
    } else {
      /* level 2: a plain tab with no registered third level */
      var meta = (typeof TAB_META !== "undefined" && TAB_META[t]) || {};
      out.push({ group: groupKey, tab: t, sub: "", setter: "", plain: true,
                 icon: meta.i || "•", label: meta.l || t });
    }
  });
  return out;
}
/* which destination is on screen right now, so it can be marked */
function navDeepCurrent() {
  try {
    if (TAB === "finance" && typeof FINSUB !== "undefined") return "finance/" + FINSUB;
    if (TAB === "budget" && typeof BUDGET_SUB !== "undefined") return "budget/" + BUDGET_SUB;
    if (TAB === "team") return "team/";
    if (TAB === "accounts" && typeof ACCTSUB !== "undefined") return "accounts/" + ACCTSUB;
  } catch (e) {}
  return "";
}

/* ⭐ A LONE CHILD THAT REPEATS ITS PARENT IS NOISE. Ray, 2026-08-26: "on the today page, there are no
   subpages. So it doesn't need to say today on the subpage today… If it's the only page, just leave it as
   the only page." Today, To-Do and Messages each have exactly one destination with the same name as the
   group — a dropdown there adds a click and says nothing. */
function navDeepRedundant(groupKey, list) {
  if (list.length !== 1) return false;
  var g = (typeof NAV_GROUPS !== "undefined") ? NAV_GROUPS.find(function (x) { return x.key === groupKey; }) : null;
  if (!g) return false;
  var a = String(list[0].label || "").toLowerCase().replace(/[^a-z]/g, "");
  var b = String(g.label || "").toLowerCase().replace(/[^a-z]/g, "");
  return a === b;
}

/* ⭐ GO. Through the screen's own setter, never by writing its variable. */
function navDeepGo(tab, sub, setter) {
  if (typeof TAB !== "undefined") TAB = tab;
  var fn = (typeof window !== "undefined") ? window[setter] : null;
  if (typeof fn === "function") { fn(sub); return; }          // the setter re-renders
  if (typeof render === "function") render();                 // ⛔ never silently do nothing
}

/* the rows under an expanded sidebar group */
function navDeepHTML(groupKey) {
  var list = navDeepFor(groupKey);
  if (!list.length) return "";
  if (navDeepRedundant(groupKey, list)) return "";      // ⭐ see navDeepRedundant
  var cur = navDeepCurrent();
  return list.map(function (d) {
    var key = d.tab + "/" + (d.sub || "");
    var badge = NAV_BADGES[key] ? NAV_BADGES[key]() : "";
    var isCur = d.plain ? (typeof TAB !== "undefined" && TAB === d.tab) : (cur === key);
    var go = d.plain ? ('navSub(\'' + d.tab + '\')')
                     : ('navDeepGo(\'' + d.tab + '\',\'' + d.sub + '\',\'' + d.setter + '\')');
    return '<button class="navsub' + (isCur ? " on" : "") + '"'
      + ' data-deep="' + esc(key) + '"'
      + ' onclick="' + go + '">'
      + '<span class="ic">' + d.icon + '</span>' + esc(d.label)
      + (badge ? '<span class="navbadge">' + esc(badge) + '</span>' : '')
      + '</button>';
  }).join("");
}

if (typeof window !== "undefined") {
  window.NAV_DEEP = NAV_DEEP; window.navDeepFor = navDeepFor; window.navDeepHTML = navDeepHTML;
  window.navDeepGo = navDeepGo; window.navDeepCurrent = navDeepCurrent; window.navdMoney = navdMoney;
  window.navDeepCoveredTabs = navDeepCoveredTabs; window.navDeepRedundant = navDeepRedundant;
  window.NAV_BADGES = NAV_BADGES;
}
if (typeof module !== "undefined" && module.exports) module.exports = { NAV_DEEP: NAV_DEEP };
