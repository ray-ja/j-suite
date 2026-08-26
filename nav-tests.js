/* nav-tests.js — the third level of navigation.

   Ray, 2026-08-26, after being sent to a screen he could not find: "See how it's really hard to navigate
   this? There's, like, tabs and sub tabs and sub tabs of sub tabs… There's just way too many buttons to
   click. It's way too easy to have things hidden."

   ⚠️ THE PROBLEM WAS NOT DEPTH, IT WAS THAT THE NAV DIDN'T KNOW LEVEL THREE EXISTED. A/R is
   `FINSUB === "owed"` — a string inside js/40 that no router, menu or search had ever heard of. Eleven
   screens lived down there, unlinkable and unfindable.

   THIS FILE DEFENDS THE THREE WAYS THAT FIX COULD BREAK THE APP:

   1. ⛔ A DESTINATION BECOMING UNREACHABLE. The in-page button row is hidden on desktop because the
      sidebar now carries the same links — but ONLY for tabs whose third level is fully registered. Hide
      it anywhere else and those sub-views can't be reached at all.

   2. ⛔ THE CLICK BINDING SWALLOWING THE CHILDREN. renderNav bound navGroup() to every <button> in <nav>.
      The child rows are buttons inside <nav>. Unscoped, every deep link would bounce back to the group's
      default screen — the exact bug the feature exists to remove.

   3. ⛔ NAVIGATING BY WRITING FINSUB DIRECTLY instead of calling the screen's own setter, which would give
      two ways to reach one state that can drift apart.

   Pure node. Run: node nav-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PROSE = (src) => src.replace(/\s+/g, " ");

const SRC = R("js/155-nav-deep.js"), RT = R("js/03-routing.js"), CSS = R("app.css");
const FIN = R("js/40-finance.js"), BUD = R("js/79-budget.js"), SHELL = R("Business App (v1).html");

function sandbox(over) {
  const ctx = Object.assign({
    console, window: {}, esc: s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    TAB: "finance", FINSUB: "owed", BUDGET_SUB: "month", render: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
    NAV_GROUPS: [{ key: "money", label: "Money", icon: "💰", tabs: ["nextcheck", "finance", "pay", "routes"] },
                 { key: "budget", label: "Budget", icon: "💵", tabs: ["budget"] }],
    TAB_META: { nextcheck: { i: "📋", l: "Next Check" }, pay: { i: "💳", l: "My Pay" }, routes: { i: "🗺️", l: "Routes" } },
    groupTabs: g => g.tabs, rendered: 0
  }, over || {});
  vm.createContext(ctx); vm.runInContext(SRC, ctx); Object.assign(ctx, ctx.window);
  return ctx;
}

console.log("\n--- ⭐ every level-3 screen is now a real destination ---");
{
  const c = sandbox();
  const fin = c.NAV_DEEP.filter(d => d.tab === "finance");
  eq("all eleven finance screens are registered", fin.length, 11);
  ok("⭐ A/R among them — the one he couldn't find", fin.some(d => d.sub === "owed"));
  ok("⭐ ...and it is FIRST, because it's the screen with his money on it", fin[0].sub === "owed", fin.map(d => d.sub));

  /* ⛔ the registry must match the screen's REAL sub-tabs, or a row goes nowhere */
  const realFin = [...FIN.matchAll(/finSub\('([a-z]+)'\)/g)].map(m => m[1]);
  const missing = realFin.filter(s => !fin.some(d => d.sub === s));
  ok("⛔ no finance sub-tab is left out of the registry", missing.length === 0, missing);
  const bogus = fin.filter(d => realFin.indexOf(d.sub) < 0);
  ok("⛔ and none is registered that the screen doesn't have", bogus.length === 0, bogus.map(d => d.sub));

  const realBud = [...BUD.matchAll(/budgetSetSub\(\\?'([a-z]+)\\?'\)/g)].map(m => m[1]);
  const bud = c.NAV_DEEP.filter(d => d.tab === "budget");
  const budMissing = realBud.filter(s => !bud.some(d => d.sub === s));
  ok("⛔ same for budget", budMissing.length === 0, budMissing);
}

console.log("\n--- the expanded list: level 2 and level 3 in one ordered run ---");
{
  const c = sandbox();
  const rows = c.navDeepFor("money");
  eq("every Money destination appears", rows.length, 14);
  ok("⭐ plain tabs with no third level are listed too", rows.some(r => r.plain && r.tab === "nextcheck"));
  ok("...labelled from TAB_META, not their key", rows.find(r => r.tab === "nextcheck").label === "Next Check");
  ok("⛔ a tab WITH children is represented by them, not by itself as well",
    !rows.some(r => r.plain && r.tab === "finance"), rows.filter(r => r.plain).map(r => r.tab));
  ok("order follows the group's own tab order", rows[0].tab === "nextcheck" && rows[rows.length - 1].tab === "routes");

  const html = c.navDeepHTML("money");
  ok("⭐ the current screen is marked", /class="navsub on"[^>]*data-deep="finance\/owed"/.test(html), html.slice(0, 300));
  eq("...and only it", (html.match(/navsub on/g) || []).length, 1);

  /* role / org gating is INHERITED from groupTabs, never re-implemented */
  const gated = sandbox({ groupTabs: () => ["nextcheck"] });
  eq("⭐ a tab this user can't reach contributes nothing", gated.navDeepFor("money").length, 1);
  ok("...and gating comes from groupTabs, the existing authority", /groupTabs\(g\)/.test(CODE(SRC)));

  /* conditional rows */
  const noReview = sandbox({ ledgerInboxCount: () => 0 });
  ok("⛔ Review is absent when nothing is waiting", !noReview.navDeepFor("budget").some(r => r.sub === "review"));
  const withReview = sandbox({ ledgerInboxCount: () => 3 });
  ok("⭐ ...and present when something is", withReview.navDeepFor("budget").some(r => r.sub === "review"));
  eq("...carrying the count", withReview.NAV_BADGES["budget/review"](), "3");
}

console.log("\n--- ⭐ a live number, visible without hunting ---");
{
  const c = sandbox({ colTotalOwed: () => 7487 });
  eq("⭐ A/R shows what's behind it", c.NAV_BADGES["finance/owed"](), "$7.5k");
  eq("small amounts stay exact", sandbox({ colTotalOwed: () => 290 }).NAV_BADGES["finance/owed"](), "$290");
  eq("⛔ nothing owed shows no badge", sandbox({ colTotalOwed: () => 0 }).NAV_BADGES["finance/owed"](), "");
  eq("⛔ a missing helper is silent, not a crash", sandbox({}).NAV_BADGES["finance/owed"](), "");
  ok("the badge reaches the markup", /navbadge/.test(sandbox({ colTotalOwed: () => 7487 }).navDeepHTML("money")));
  ok("...and is styled to stand out", /\.navbadge\{/.test(CSS));
}

console.log("\n--- ⛔ 3. it navigates through the screen's OWN setter ---");
{
  let got = null;
  /* ⚠️ the setter must live on WINDOW — that is where a browser puts `window.finSub = …` and where
     navDeepGo looks. Putting it only on the sandbox globals tested nothing real. */
  const c = sandbox();
  c.window.finSub = s => { got = s; };
  c.navDeepGo("finance", "cash", "finSub");
  eq("⭐ the setter is called", got, "cash");
  eq("...and TAB is moved to its screen", c.TAB, "finance");
  ok("⛔ FINSUB is never written directly", !/FINSUB\s*=/.test(CODE(SRC)), (CODE(SRC).match(/.*FINSUB\s*=.*/) || [])[0]);
  ok("⛔ nor BUDGET_SUB", !/BUDGET_SUB\s*=/.test(CODE(SRC)));
  ok("...and the reason is recorded", /two ways to reach the same state that could drift apart/.test(PROSE(SRC)));

  /* a missing setter must still move the user, not silently do nothing */
  const c2 = sandbox();
  c2.navDeepGo("finance", "cash", "nopeSub");
  ok("⭐ a missing setter still re-renders rather than dead-ending", c2.rendered > 0);
  eq("...on the right tab", c2.TAB, "finance");
}

console.log("\n--- ⛔ 2. the click binding must not swallow the children ---");
{
  ok("⭐ navGroup is bound ONLY to the group buttons", /querySelectorAll\("button\[data-group\]"\)/.test(CODE(RT)));
  ok("⛔ ...not to every button in the nav", !/nav\.querySelectorAll\("button"\)\.forEach/.test(CODE(RT)));
  ok("the bug is written down where it would be reintroduced", /bounced back to the group's default screen/.test(PROSE(RT)));
  ok("the children carry their own onclick", /onclick="' \+ go \+ '"/.test(SRC) || /onclick="/.test(SRC));
  ok("...and are only emitted for the OPEN group", /g\.key===curKey && typeof navDeepHTML/.test(CODE(RT)));
}

console.log("\n--- ⛔ 1. nothing becomes unreachable ---");
{
  const c = sandbox();
  eq("only finance and budget are declared fully covered", c.navDeepCoveredTabs().sort().join(), "budget,finance");
  ok("⭐ the in-page row is hidden ONLY for covered tabs", /navDeepCoveredTabs\(\)\.indexOf\(TAB\)>=0/.test(CODE(RT)));
  ok("...via a body class, so nothing else is touched", /classList\.toggle\("navdeep"/.test(CODE(RT)));
  ok("⭐ the CSS is scoped to a DIRECT child of #view", /body\.navdeep #view > \.subnav\{display:none\}/.test(CSS));
  ok("⛔ ...never a blanket .subnav rule", !/^\s*\.subnav\{display:none\}/m.test(CSS));
  ok("⭐ ...and only on desktop, where the sidebar exists", (function () {
    const block = (CSS.match(/@media\(min-width:900px\)\{[\s\S]*?\n  \}/g) || []).find(b => /navdeep/.test(b));
    return !!block;
  })());
  ok("the regression risk is documented", /would make those sub-views unreachable/.test(PROSE(RT)));

  /* ⚠️ a screen NOT in the registry must keep its own row */
  ok("⛔ accounts is not claimed as covered", c.navDeepCoveredTabs().indexOf("accounts") < 0);
  ok("⛔ nor receipts", c.navDeepCoveredTabs().indexOf("receipts") < 0);
}

console.log("\n--- the phone is untouched ---");
{
  ok("⭐ the children are display:none by default", /\.navkids\{display:none\}/.test(CSS));
  ok("...and only shown from 900px up", /@media\(min-width:900px\)\{[\s\S]*?\.navkids\{display:block/.test(CSS));
  ok("the reason is recorded", /bottom bar with nowhere to drop anything down/.test(PROSE(CSS)));
  ok("the module is in the shell", /js\/155-nav-deep\.js/.test(SHELL));
  ok("...after the screens whose numbers it shows", SHELL.indexOf("154-collections") < SHELL.indexOf("155-nav-deep"));
}

console.log("\n--- it can't throw the app down ---");
{
  ok("a group that doesn't exist is empty, not a crash", sandbox().navDeepFor("nonsense").length === 0);
  ok("...and renders nothing", sandbox().navDeepHTML("nonsense") === "");
  const noGroups = sandbox({ NAV_GROUPS: undefined });
  eq("missing NAV_GROUPS is survivable", noGroups.navDeepFor("money").length, 0);
  const noTab = sandbox({ TAB: undefined });
  ok("a missing TAB doesn't throw", typeof noTab.navDeepCurrent() === "string");
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
