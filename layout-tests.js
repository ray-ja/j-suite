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

/* ---------- ⭐ THE THINGS HE COULD SEE ON TODAY ----------------------------------------------------------
   Ray, 2026-08-27, reading it line by line. Three separate complaints, three different causes, all of them
   layout rather than data. */
console.log("\n--- ⭐ Today, read line by line ---");
{
  const CAL126 = fs.readFileSync(path.join(__dirname, "js", "126-calendar.js"), "utf8");
  const RI = fs.readFileSync(path.join(__dirname, "js", "166-routine-inline.js"), "utf8");
  const STRIP = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /* 1. ⚠️ "where it says coming up water park, there's, like, an entire screen's worth of space between
        water park and in seven days." The LABEL carried `grow`, so flexbox pushed the countdown to the far
        right edge of a wide column. Two facts that only mean something together, flung apart by a class. */
  const card = (STRIP(CAL126).match(/function evHomeCardHTML[\s\S]*?\n}/) || [""])[0];
  ok("⚠️ the event label no longer grows — that one class put a screen between 'Waterpark' and 'in 7 days'",
    !/class="grow"[^>]*>' \+ esc\(evLabel/.test(card) && /flex:0 1 auto/.test(card), card.slice(0, 300));
  ok("⭐ a trailing spacer absorbs the slack instead, so the two stay side by side at any width",
    /<div class="grow"><\/div>/.test(card));
  /* 2. ⛔ "it doesn't even need an open button because the calendar's here, and it takes you to the same page" */
  ok("⛔ and the duplicate Open button is gone — the Calendar block already goes to that exact screen",
    !/>Open</.test(card), card);
  const TCAL = fs.readFileSync(path.join(__dirname, "js", "163-today-calendar.js"), "utf8");
  ok("⛔ ...the Calendar block still has its one", /navSub\(\\?'cal\\?'\)[^>]*>Open</.test(TCAL), TCAL.slice(0, 0));

  /* 3. ⚠️ "the text doesn't wrap well. it doesn't do a next line break… the description just cuts off."
        LAST TIME I removed a 26-character cap in JS and called this fixed — but the cell was still nowrap,
        so it ellipsised at the width instead. Same symptom, second cause. */
  const pt = (CSS.match(/\.tcal-pt\{[^}]*\}/) || [""])[0];
  const pill = (CSS.match(/\.tcal-pill\{[^}]*\}/) || [""])[0];
  ok("⚠️ the month-cell label wraps now — removing the JS character cap was only half of it",
    /white-space:normal/.test(pt) && !/white-space:nowrap/.test(pt), pt);
  /* ⚠️ THREE, not two. I shipped two and screenshotted it: "⚠️ Truck registration — DUE THIS MONTH" — the
     very item he pointed at — still clipped to "— DU…". He said "it's just gonna have to be bigger", so the
     cell grows rather than the text shrinking. Still clamped, so one long to-do can't push a week down. */
  ok("⛔ ...clamped to three lines — enough for the item he complained about, still bounded",
    /-webkit-line-clamp:3/.test(pt), pt);
  ok("⚠️⚠️ NOT overflow-wrap:anywhere — it drops min-content to ONE CHARACTER and 'Iowa mortgage' rendered "
    + "as 'I' over 'c' in a 60px cell. Caught in a screenshot, invisible in the markup",
    !/overflow-wrap:anywhere/.test(pt) && /overflow-wrap:break-word/.test(pt), pt);
  ok("⭐ ...and the title has a flex-basis floor, so the amount wraps away instead of squeezing it to nothing",
    /flex:1 1 56px/.test(pt) && /flex-wrap:wrap/.test(pill), pt);
  ok("⛔ ...and there is still no character cap in the JS", !/slice\(0,\s*\d+\)/.test(
    (STRIP(fs.readFileSync(path.join(__dirname, "js", "163-today-calendar.js"), "utf8"))
      .match(/function tcalShort[\s\S]*?\n}/) || [""])[0]));
  ok("⚠️ the amount aligns to the FIRST line — baseline alignment drags '$4.8k' down beside the second",
    /align-items:flex-start/.test(pill), pill);

  /* 4. ⛔ "under workout it says 'open it to see today's day' — that doesn't even make any sense." */
  /* ⚠️ STRIP(RI), not RI — the comment three lines up quotes the exact string this asserts is gone, so the
     un-stripped version fails against my own prose. I have made this mistake before; hence CODE()/STRIP(). */
  ok("⛔ the workout row no longer tells him to open the app to find out what the app should be telling him",
    !/open it to see today/.test(STRIP(RI)));
  ok("⭐ ...but it still names the lift when it knows it, and still says rest day",
    /ri-lift/.test(STRIP(RI)) && /rest day/.test(STRIP(RI)));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
