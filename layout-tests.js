/* layout-tests.js — the CSS rules that stop a card collapsing, and the nav actually reaching every screen.

   Ray, 2026-08-25, with a screenshot: "Make sure you use the screenshot tool to check your work because
   this is how it looks right now. It's a mess… there's, like, text just going vertically down the page."

   TWO BUGS IN ONE PICTURE, and the second was worse than the one he could see:

   1. ⚠️ A `.btn` is `width:100%`. Inside a flex `.row` that becomes its flex basis, so even `flex:0 0 auto`
      made the button claim the whole row and crush its sibling to a one-character column. "Send me a file"
      rendered vertically, one letter per line, down the whole page.
   2. ⭐ `todo` had NO NAV_GROUPS entry — routable, rendered, in the personal template, in the static
      fallback nav, and unreachable from the menu in EVERY org. His entire planned day was on that screen.

   ⭐ AND THE REAL LESSON: both were visible in a screenshot and invisible in the markup, which is exactly
   why shot.js now exists. `chrome-headless-shell` works on this box even though `chrome` hangs.

   Pure node. Run: node layout-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const CSS = fs.readFileSync(path.join(__dirname, "app.css"), "utf8");
const RT = fs.readFileSync(path.join(__dirname, "js", "03-routing.js"), "utf8");

console.log("\n--- ⭐ a button beside other content can't eat the row ---");
{
  const rule = (CSS.match(/\.row > \.btn:not\(:only-child\)\{[^}]*\}/) || [""])[0];
  ok("the rule exists", !!rule, rule);
  ok("...it stops the button claiming 100%", /width:auto/.test(rule));
  ok("...caps its share, because flex:0 0 auto forbids shrinking", /max-width:\d+%/.test(rule));
  ok("...lets a sentence-long label wrap instead of eating the row", /white-space:normal/.test(rule));
  ok("...and can still shrink", /min-width:0/.test(rule));
  ok("⭐ a LONE button in a row is untouched — those are meant to be full-width", /:not\(:only-child\)/.test(rule));
  ok("the bug and the screenshot that found it are recorded", /ONE CHARACTER PER LINE/.test(CSS));
  ok("...including why max-width was needed as well as width", /forbids SHRINKING/.test(CSS));
  ok(".btn really is width:100% by default (the thing being defended against)", /\.btn\{[^}]*width:100%/.test(CSS));
  ok(".grow still has min-width:0 so text can shrink at all", /\.grow\{flex:1;min-width:0\}/.test(CSS));
}

console.log("\n--- ⭐ every routable tab is reachable from the menu ---");
{
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(RT.match(/const NAV_GROUPS *= *\[[\s\S]*?\n\];/)[0] + ";this.G=NAV_GROUPS;", ctx);
  const grouped = new Set();
  ctx.G.forEach(g => (g.tabs || []).forEach(t => grouped.add(t)));

  ok("To-Do has a nav group at all", grouped.has("todo"));
  eq("...labelled To-Do", (ctx.G.find(g => g.key === "todo") || {}).label, "To-Do");
  ok("...placed second, right after Today", ctx.G[1] && ctx.G[1].key === "todo", ctx.G.slice(0, 3).map(g => g.key));
  ok("the bug is recorded so it isn't re-broken", /THE TO-DO GROUP WAS MISSING ENTIRELY/.test(RT));

  /* the general guard: anything in a template must be reachable, or it's another invisible screen */
  const tpl = {};
  vm.createContext(tpl);
  vm.runInContext(RT.match(/const ORG_TEMPLATES *= *\{[\s\S]*?\n\};/)[0] + ";this.T=ORG_TEMPLATES;", tpl);
  const core = ["today", "admin", "data", "settings"];
  Object.keys(tpl.T).forEach(name => {
    const tabs = tpl.T[name];
    if (!Array.isArray(tabs)) return;                       // "full" is null by design
    const orphans = tabs.filter(t => !grouped.has(t) && core.indexOf(t) < 0);
    ok("⭐ every tab in the '" + name + "' template is reachable from the menu", orphans.length === 0, orphans);
  });

  /* and the personal nav renders in a sensible order */
  const personal = tpl.T.personal.concat(core);
  const shown = ctx.G.filter(g => g.tabs.some(t => personal.indexOf(t) >= 0)).map(g => g.label);
  ok("the personal menu leads with Today then To-Do", shown[0] === "Today" && shown[1] === "To-Do", shown.slice(0, 4));
  ok("...and still carries Life, Journal, Shelf, Workout", ["Life", "Journal", "Shelf", "Workout"].every(l => shown.indexOf(l) >= 0), shown);
}

console.log("\n--- the screenshot harness exists and uses the binary that works ---");
{
  const SH = fs.readFileSync(path.join(__dirname, "shot.js"), "utf8");
  ok("shot.js renders against the REAL app.css", /app\.css/.test(SH));
  ok("⭐ it uses chrome-headless-shell, not chrome", /chrome-headless-shell/.test(SH) && /chromium_headless_shell/.test(SH));
  ok("...and records that plain chrome hangs on this box", /still hangs/.test(SH));
  ok("it defaults to a phone width, where his layout has to work", /arg\("w", chrome \? "2560" : "390"\)/.test(SH));
  /* ⭐ Ray, 2026-08-25: "I have a fourteen forty resolution screen. Your screenshots should reflect that."
     A bare fragment at 1440 is a different width from the same fragment on HIS screen, because .wrap sizes
     itself from 50vw minus a fixed 224px sidebar. Without the frame the picture is not of his app. */
  ok("⭐ --chrome renders the real frame: the header and the fixed sidebar", /const chrome = process\.argv\.indexOf\("--chrome"\)/.test(SH) && /<nav>/.test(SH) && /<header>/.test(SH));
  ok("...and says which mode the shot was taken in, so a picture can't quietly lie", /full app frame/.test(SH) && /fragment only/.test(SH));
  /* ⚠️ this harness bug made a shot lie about the exact class it was taken to check */
  ok("⛔ body classes are merged into ONE attribute", !/class="dark"' : ''\) \+ \(arg\("body"/.test(SH) && /body class="' \+ \[dark/.test(SH));
  ok("...and the reason is recorded", /keeps only the first/.test(SH));
  ok("it renders inside .wrap, or widths would lie", /class="wrap"/.test(SH));
  ok("it exits non-zero on failure so it can gate a commit", /process\.exit\(4\)/.test(SH));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
