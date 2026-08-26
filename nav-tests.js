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
  /* ⭐ THE INVARIANT, not a hardcoded list: a tab may only be declared "covered" — and so have its in-page
     button row hidden — if EVERY sub-view that screen offers is registered in NAV_DEEP. Adding a screen to
     the sidebar widens what gets hidden, so this is the assertion that stops the next addition silently
     stranding a sub-view. */
  const CUST = R("js/06-customers.js"), SET = R("js/26-deep-quote-rate-editor-every.js"), ADM = R("js/32-admin.js");
  /* ⭐ for the two DOM-split screens the sections come from their <h2> text at runtime, so derive the same
     keys the same way secKey() does — this is what catches a renamed heading quietly breaking a sidebar
     link, which no other test could see. */
  const secKeyOf = t => String(t).split(" — ")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  /* ⚠️ decode entities — the source says "Roles, pages &amp; actions" but textContent yields "&", so a raw
     read produced roles-pages-amp-actions and the test disagreed with reality rather than with the code. */
  const unent = t => t.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, "");
  /* ⚠️ strip comments FIRST. A comment explaining that these cards had "no <h2> of its own" contains the
     literal string <h2>, and the extractor happily read the prose as a section name. Fourth time this
     session that matching raw source has found my own writing instead of the code. */
  const h2sIn = (src0, from, to) => { const src = CODE(src0); return [...src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined)
      .matchAll(/<h2[^>]*>([^<]+)</g)].map(m => secKeyOf(unent(m[1].replace(/\$\{[^}]*\}/g, "")))); };
  const screenSubs = {
    finance: [...FIN.matchAll(/finSub\('([a-z]+)'\)/g)].map(m => m[1]),
    budget: [...BUD.matchAll(/budgetSetSub\(\\?'([a-z]+)\\?'\)/g)].map(m => m[1]),
    accounts: [...CUST.matchAll(/ppGo\('accounts','([a-z]+)'\)/g)].map(m => m[1]),
    team: [],
    data: h2sIn(SET, "function rData()"),
    admin: h2sIn(ADM, "function rAdmin()")
  };
  c.navDeepCoveredTabs().forEach(tab => {
    const want = [...new Set(screenSubs[tab] || [])];
    const have = c.NAV_DEEP.filter(d => d.tab === tab).map(d => d.sub);
    const gap = want.filter(x => have.indexOf(x) < 0);
    ok("⭐ '" + tab + "' is covered, so every one of its sub-views IS registered", gap.length === 0, gap);
  });
  ok("...and a tab nobody registered is never claimed as covered",
    c.navDeepCoveredTabs().every(t => screenSubs[t] !== undefined), c.navDeepCoveredTabs());
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
  ok("⛔ receipts keeps its own row — nothing of it is registered", c.navDeepCoveredTabs().indexOf("receipts") < 0);
  ok("⛔ so does inventory", c.navDeepCoveredTabs().indexOf("inventory") < 0);
  /* ⭐ admin and settings ARE covered now — their sections are registered, so their in-page tab row is a
     duplicate of the sidebar on desktop, exactly like finance and budget. */
  ok("⭐ settings is covered, so its sections must all be listed", c.navDeepCoveredTabs().indexOf("data") >= 0);
  ok("⭐ ...and admin", c.navDeepCoveredTabs().indexOf("admin") >= 0);
}

console.log("\n--- the phone is untouched ---");
{
  ok("⭐ the children are display:none by default", /\.navkids\{display:none\}/.test(CSS));
  ok("...and only shown from 900px up", /@media\(min-width:900px\)\{[\s\S]*?\.navkids\{display:block/.test(CSS));
  ok("the reason is recorded", /bottom bar with nowhere to drop anything down/.test(PROSE(CSS)));
  ok("the module is in the shell", /js\/155-nav-deep\.js/.test(SHELL));
  ok("...after the screens whose numbers it shows", SHELL.indexOf("154-collections") < SHELL.indexOf("155-nav-deep"));
}

console.log("\n--- ⭐ section tabs: splitting a monolith without cutting it open ---");
{
  const SEC = R("js/156-section-tabs.js");
  /* ⚠️ a DOM stub that implements nextSibling — the first one didn't, so it could not detect whether the
     tab row landed above or below the pinned content, which is the one ordering that matters here. */
  function el(tag) {
    const n = { tagName: tag.toUpperCase(), children: [], style: {}, attrs: {}, textContent: "", className: "", innerHTML: "", parentNode: null,
      appendChild(c) { if (c.parentNode) c.parentNode.remove(c); this.children.push(c); c.parentNode = this; },
      remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
      insertBefore(c, ref) { if (c.parentNode) c.parentNode.remove(c);
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
        c.parentNode = this; },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; },
      querySelector(sel) { return this.children.find(c => c.attrs[sel.replace(/[\[\]]/g, "")] != null) || null; },
      /* ⚠️ secGo drives everything through querySelectorAll — a stub returning [] made the switch
         untestable, and the assertion passed/failed for the wrong reason either way. */
      querySelectorAll(sel) {
        const attr = sel.replace(/[\[\]]/g, "").split(" ")[0];
        const out = [];
        const walk = n => n.children.forEach(c => { if (c.attrs[attr] != null) out.push(c); walk(c); });
        walk(this);
        return out;
      },
      get nextSibling() { const p = this.parentNode; if (!p) return null;
        const i = p.children.indexOf(this); return (i >= 0 && i + 1 < p.children.length) ? p.children[i + 1] : null; } };
    return n;
  }
  function build(headings, withPin) {
    const view = el("div");
    const pin = withPin ? el("div") : null;
    if (pin) view.appendChild(pin);
    headings.forEach(t => { const h = el("h2"); h.textContent = t; view.appendChild(h); view.appendChild(el("div")); });
    return { view, pin };
  }
  function run(view, tab) {
    const ctx = { console, window: {}, document: { getElementById: id => id === "view" ? view : null, createElement: el } };
    vm.createContext(ctx); vm.runInContext(SEC, ctx); Object.assign(ctx, ctx.window);
    ctx.secSplit(tab || "data");
    return ctx;
  }

  const S1 = build(["Sync", "Appearance", "Cards", "Pricing rates", "Job costs (COGS)",
                    "Home base — OBX Lot Solutions", "Archive", "Backups", "Security"], true);
  const c1 = run(S1.view);
  const secs = S1.view.children.filter(x => x.attrs["data-sec"]);
  eq("⭐ Settings splits into its nine sections", secs.length, 9);
  /* ⭐ the ORDER is declared in SEC_ORDER, not inherited from whatever order the template emits */
  eq("...ordered logically, not as the template happens to emit them", secs.map(x => x.attrs["data-sec"]).join(","),
    "sync,appearance,home-base,pricing-rates,job-costs-cogs,cards,security,backups,archive");
  ok("⛔ a section missing from SEC_ORDER still appears, at the end", (function () {
    const X = build(["Sync", "Brand New Thing"], false); run(X.view);
    const k = X.view.children.filter(y => y.attrs["data-sec"]).map(y => y.attrs["data-sec"]);
    return k.join() === "sync,brand-new-thing";
  })());
  eq("⭐ only one is visible", secs.filter(x => x.style.display !== "none").length, 1);
  ok("...the first, by default", secs[0].style.display !== "none");
  const row = S1.view.children.find(x => x.attrs["data-secrow"]);
  ok("a tab row is created", !!row);
  ok("...listing every section", (row.innerHTML.match(/subbtn/g) || []).length === 9);
  /* ⚠️ THE ORDERING THAT MATTERS: on Settings the pinned card is the error log; on Admin it's the PIN gate */
  ok("⭐ content above the first heading stays PINNED, above the tabs",
    S1.view.children.indexOf(S1.pin) === 0 && S1.view.children.indexOf(row) === 1,
    { pin: S1.view.children.indexOf(S1.pin), row: S1.view.children.indexOf(row) });
  ok("...and is never hidden", S1.pin.style.display !== "none");

  c1.secGo("data", "backups");
  const after = S1.view.children.filter(x => x.attrs["data-sec"]);
  ok("⛔ the active tab is found by a data attribute, not by parsing its onclick string",
    /data-seckey/.test(CODE(SEC)) && !/getAttribute\("onclick"\)/.test(CODE(SEC)));
  ok("⭐ switching shows only the chosen one",
    after.filter(x => x.style.display !== "none").length === 1
    && after.find(x => x.attrs["data-sec"] === "backups").style.display !== "none");
  eq("...and the choice is remembered", c1.SEC_SUB.data, "backups");

  /* ⛔ FAIL OPEN — the whole reason for splitting the DOM instead of the source */
  const one = build(["Only one"], false); run(one.view);
  ok("⛔ a single-section screen is left completely alone", !one.view.children.some(x => x.attrs["data-secrow"]));
  const none = build([], false); run(none.view);
  ok("⛔ a screen with no headings is left alone", !none.view.children.some(x => x.attrs["data-secrow"]));
  const notlisted = build(["A", "B"], false); run(notlisted.view, "quotes");
  ok("⛔ a screen that isn't opted in is never touched", !notlisted.view.children.some(x => x.attrs["data-secrow"]));

  /* ⭐ ADMIN'S HEADINGS ARE NESTED in <div class="secthd"><h2>…</h2><button>…</button></div>. Looking only
     for bare <h2> children found ONE heading there, failed open, and left three sidebar links pointing at
     sections that would never exist. */
  const nested = (function () {
    const view = el("div");
    ["Admin", "Members", "Activity"].forEach((t, i) => {
      if (i === 2) { const h = el("h2"); h.textContent = t; view.appendChild(h); }   // Activity is bare
      else { const row = el("div"); row.className = "secthd";
             const h = el("h2"); h.textContent = t; row.appendChild(h);
             const btn = el("button"); btn.textContent = "+ Add member"; row.appendChild(btn);
             view.appendChild(row); }
      view.appendChild(el("div"));
    });
    return view;
  })();
  run(nested, "admin");
  const nsecs = nested.children.filter(x => x.attrs["data-sec"]);
  eq("⭐ a heading nested in .secthd is still a section", nsecs.length, 3);
  eq("...keyed from its text", nsecs.map(x => x.attrs["data-sec"]).sort().join(), "activity,admin,members");
  /* ⚠️ and the buttons in that row must survive */
  const memberRow = nsecs.find(x => x.attrs["data-sec"] === "members").children[0];
  ok("⛔ a .secthd heading row is NOT hidden — it carries the Add-member button", memberRow.style.display !== "none");
  ok("...and that button is still in it", memberRow.children.some(k => k.tagName === "BUTTON"));
  ok("the reason is recorded", /a missing Add-member button is a broken screen/.test(PROSE(SEC)));
  ok("⭐ and any error leaves the page as rendered", /catch \(e\) \{ \/\* ⛔ fail open/.test(SEC));
  ok("the reason for the DOM-not-source approach is recorded", /loses their backups page/.test(PROSE(SEC)));

  ok("only Settings and Admin are opted in", c1.SEC_SCREENS.join() === "data,admin");
  ok("it is called after the screen renders, inside the blank-screen guard",
    /_screen\(\);[\s\S]{0,400}secSplit\(TAB\)/.test(CODE(RT)));
  ok("the module is in the shell", /js\/156-section-tabs\.js/.test(SHELL));
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
