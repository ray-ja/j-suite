/* journal-readability-tests.js — reading the journal, as opposed to editing it.

   Ray, 2026-08-14: "the journal isnt very readable."

   ⭐ THE CAUSE WAS STRUCTURAL, not cosmetic: the ONLY way to open an entry was the edit modal, so reading
   happened inside a <textarea rows="9">. That was fine for the typed one-liners the screen was built for.
   A spoken entry runs to thousands of words, and a nine-row edit box on a phone is the worst possible
   surface for one. Reading and editing are now separate screens.

   Pure node. Run: node journal-readability-tests.js */
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const LF = fs.readFileSync(path.join(__dirname, "js", "78-life-tracker.js"), "utf8");
const CSS = fs.readFileSync(path.join(__dirname, "app.css"), "utf8");

console.log("\n--- ⭐ reading is no longer done in an edit box ---");
ok("there is a dedicated reading view", /function lifeRenderRead\(n\)/.test(LF));
/* the source writes these inside JS strings, so the file text contains \' not ' */
ok("tapping an entry opens it to READ, not to edit", /onclick="lifeOpenNote\(\\'/.test(LF));
ok("...and the list row no longer opens the edit modal", !/onclick="openLifeNote\(\\'\+n\.id/.test(LF));
ok("editing is one tap from the reading view", /✎ Edit/.test(LF));
ok("the reading view uses prose type, not form controls", /class="prose"/.test(LF));
ok("the edit box is no longer nine cramped rows", !/id="ln_body" rows="9"/.test(LF));
ok("...it is tall enough for a spoken entry", /id="ln_body" rows="16"/.test(LF));
ok("the reason the old screen read badly is recorded", /textarea rows="9"/.test(LF) && /thousands of words/.test(LF));

console.log("\n--- the prose style itself ---");
ok(".prose exists", /\.prose\{/.test(CSS));
ok("...preserves the paragraph breaks transcribe.py inserts at pauses", /\.prose\{white-space:pre-wrap/.test(CSS));
ok("...is larger than the dense-list default 16px", /\.prose\{[^}]*font-size:17px/.test(CSS));
ok("...has reading line-height, not list line-height", /\.prose\{[^}]*line-height:1\.7/.test(CSS));
ok("...wraps rather than overflowing on a long unbroken string", /\.prose\{[^}]*overflow-wrap:anywhere/.test(CSS));
ok("the reason prose needs its own treatment is recorded", /tuned for dense operational/.test(CSS));

console.log("\n--- the list is navigable ---");
ok("entries are grouped by month", /toLocaleDateString\(\[\], \{month:"long", year:"numeric"\}\)/.test(LF));
ok("the DATE is the heading — a journal is navigated by date", /A JOURNAL IS NAVIGATED BY DATE/.test(LF));
ok("the day of the week is shown", /DOW\[dowOf\(n\.date\)\]/.test(LF));
ok("the snippet wraps over multiple lines instead of one truncated row", /class="snip/.test(LF));
ok(".snip clamps to 3 lines", /-webkit-line-clamp:3/.test(CSS));
ok("...and to 2 when a title takes a line", /\.snip\.two\{-webkit-line-clamp:2\}/.test(CSS));
ok("the snippet is far longer than the old 80 chars", /preview\.slice\(0,320\)/.test(LF));
ok("length is shown so a 20-minute dump reads differently from a one-liner", /lifeLenLabel/.test(LF));
ok("a voice entry is still marked", /n\.voice\?"🎙️ ":""/.test(LF));

console.log("\n--- length + heading helpers ---");
{
  const vm = require("vm"), ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    (LF.match(/function lifeWordCount\(s\)\{[\s\S]*?\n\}/) || [""])[0]
    + (LF.match(/function lifeReadMins\(s\)\{[\s\S]*?\n\}/) || [""])[0]
    + (LF.match(/function lifeLenLabel\(s\)\{[\s\S]*?\n\}/) || [""])[0]
    + (LF.match(/function lifeAutoHead\(body\)\{[\s\S]*?\n\}/) || [""])[0]
    + ";this.W=lifeWordCount;this.M=lifeReadMins;this.L=lifeLenLabel;this.H=lifeAutoHead;", ctx);

  eq("counts words", ctx.W("one two three"), 3);
  eq("collapses whitespace", ctx.W("  one   two \n\n three "), 3);
  eq("empty is zero", ctx.W(""), 0);
  eq("null is safe", ctx.W(null), 0);
  eq("a short entry shows a plain word count", ctx.L("one two three"), "3 words");
  eq("nothing shows nothing", ctx.L(""), "");
  ok("a long entry shows a reading time", /min read/.test(ctx.L("word ".repeat(600))), ctx.L("word ".repeat(600)));
  eq("reading time floors at 1 minute", ctx.M("a few words"), 1);
  eq("200 words is about a minute", ctx.M("word ".repeat(200)), 1);
  eq("2000 words is about ten", ctx.M("word ".repeat(2000)), 10);

  eq("a heading is the first sentence", ctx.H("So today was a mess. Then it got worse."), "So today was a mess.");
  eq("no sentence break falls back to a cut", ctx.H("z".repeat(200)), "z".repeat(70) + "…");
  eq("empty gives nothing", ctx.H(""), "");
}

console.log("\n--- navigation can't strand you ---");
ok("deleting the entry you're reading returns you to the list", /if\(LIFE_NOTE===id\)LIFE_NOTE=""/.test(LF));
ok("an entry deleted on another device doesn't wedge the view", /LIFE_NOTE="";\s*\/\/ it was deleted out from under us/.test(LF));
ok("there is a way back to the list", /lifeCloseNote\(\)/.test(LF));
ok("...at the top and the bottom (a long entry scrolls past the header)",
  (LF.match(/onclick="lifeCloseNote\(\)"/g) || []).length >= 2);
ok("offers from an entry are visible while reading it", /jaCardHTML==="function"\)h\+=jaCardHTML\(\)/.test(LF));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
