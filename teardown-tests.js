/* teardown-tests.js — the teardown estimator (js/172): deck · fence · interior · small concrete.
 * Ray, 2026-09-09: demolition is the gap-closer, priced AT MARKET this time ("i didnt before because i was
 * just putting my toe in. im ready to price at market"). The two things that must stay true:
 *   1. bands sit at 2026 market mid (deck $5–12/sq ft, most 200–400 sq ft decks $1,000–2,500+), and
 *   2. the trailer decides the price — loads at the ~3,600 lb cap, a full dump run charged PER load.
 * Pure node. Run: node teardown-tests.js */
const td = require("./js/172-teardown.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (got !== undefined ? "  got " + JSON.stringify(got) : "")); } }

console.log("\n— weights: light-bulky vs dense is the whole economics —");
{
  const deck = td.tdWeight("deck", { area: 300, railLf: 40, stairs: 1, footings: 0 });
  ok("a 300 sq ft deck is one trailer load", deck < td.TD_CAP && td.tdLoads(deck) === 1, deck);
  ok("...roughly 2,750 lb (8/sq ft + rail + stairs)", deck === 300 * 8 + 40 * 5 + 150, deck);
  const slab = td.tdWeight("slab", { area: 100, thickIn: 4 });
  ok("a mere 10×10×4\" slab is 5,000 lb", slab === 5000, slab);
  ok("...which is already TWO loads", td.tdLoads(slab) === 2, td.tdLoads(slab));
  const bigSlab = td.tdWeight("slab", { area: 300, thickIn: 4 });
  ok("a 300 sq ft slab needs 5 loads — the tool must say so, not hide it", td.tdLoads(bigSlab) === 5, td.tdLoads(bigSlab));
  ok("thickness scales concrete linearly (6\" = 1.5× the 4\")", td.tdWeight("slab", { area: 100, thickIn: 6 }) === 7500);
  ok("a wall weighs by face area × thickness, same as a slab", td.tdWeight("wall", { area: 80, thickIn: 4 }) === 4000);
}
{
  const priv = td.tdWeight("fence", { lf: 100, heightFt: 6, fenceKind: "wood" });
  const chain = td.tdWeight("fence", { lf: 100, heightFt: 4, fenceKind: "chain" });
  ok("100 lf of 6-ft privacy fence ≈ 1,200 lb — one load", priv === 1200 && td.tdLoads(priv) === 1, priv);
  ok("chain link is a third of that", chain === 400, chain);
  const footed = td.tdWeight("fence", { lf: 100, heightFt: 6, fenceKind: "wood", footings: true });
  ok("hauling the concrete footings adds ~50 lb per post (13 posts)", footed === 1200 + 13 * 50, footed);
}
{
  ok("interior strip-out is 4 lb/sq ft; a full gut 10", td.tdWeight("interior", { area: 180 }) === 720 && td.tdWeight("interior", { area: 180, gut: true }) === 1800);
}

console.log("\n— bands: market mid, not the floor that paid $12/hr —");
{
  const [lo, hi, min] = td.tdBand("deck", { area: 300 });
  ok("a 300 sq ft deck bands $1,500–3,600 ($5–12/sq ft)", lo === 1500 && hi === 3600, [lo, hi]);
  ok("deck minimum is $600 — no deck goes out cheaper", min === 600, min);
  const tiny = td.tdBand("deck", { area: 40 });
  ok("...so a 40 sq ft landing can't band below it", tiny[2] === 600 && tiny[0] < 600, tiny);
  const f = td.tdBand("fence", { lf: 100 });
  ok("fence bands $3–6/lf", f[0] === 300 && f[1] === 600 && f[2] === 400, f);
  const c = td.tdBand("slab", { area: 100 });
  ok("concrete bands $4–8/sq ft", c[0] === 400 && c[1] === 800 && c[2] === 500, c);
  const i1 = td.tdBand("interior", { area: 180 }), i2 = td.tdBand("interior", { area: 180, gut: true });
  ok("a full gut bands higher than a strip-out", i2[0] > i1[0] && i2[1] > i1[1], [i1, i2]);
}

console.log("\n— loads: never zero, always ceil —");
{
  ok("0 lb is still 1 load (you still drove there)", td.tdLoads(0) === 1);
  ok("exactly the cap is 1 load", td.tdLoads(td.TD_CAP) === 1);
  ok("one pound over rolls to 2", td.tdLoads(td.TD_CAP + 1) === 2);
}

console.log("\n— work minutes feed the $45/hr check —");
{
  ok("a deck tears down ~3 min/sq ft", td.tdWorkMin("deck", { area: 300 }, 0) === 900);
  ok("push factors slow the same job up to +50%", td.tdWorkMin("deck", { area: 300 }, 1) === 1350);
  ok("concrete is the slowest per sq ft, and thicker is slower", td.tdWorkMin("slab", { area: 100, thickIn: 6 }, 0) > td.tdWorkMin("slab", { area: 100, thickIn: 4 }, 0));
}

console.log("\n— boats (Ray 2026-09-09: paperwork built into the tool as reminders) —");
{
  ok("a 14 ft fiberglass skiff ≈ 770 lb — one load", td.tdWeight("boat", { boatFt: 14, hull: "glass" }) === 770 && td.tdLoads(770) === 1);
  ok("aluminum jon boat is far lighter (14 ft ≈ 210 lb)", td.tdWeight("boat", { boatFt: 14, hull: "alu" }) === 210);
  ok("a motor left on adds 250 lb", td.tdWeight("boat", { boatFt: 14, hull: "glass", motor: true }) === 1020);
  const b = td.tdBand("boat", { boatFt: 14 });
  ok("14 ft bands $490–1,540 inside the researched $400–1,800 market", b[0] === 490 && b[1] === 1540 && b[2] === 400, b);
  ok("no boat goes out under the $400 minimum", td.tdBand("boat", { boatFt: 8 })[2] === 400);
  ok("fiberglass cuts slowest, aluminum fastest",
    td.tdWorkMin("boat", { boatFt: 14, hull: "glass" }, 0) > td.tdWorkMin("boat", { boatFt: 14, hull: "wood" }, 0)
    && td.tdWorkMin("boat", { boatFt: 14, hull: "wood" }, 0) > td.tdWorkMin("boat", { boatFt: 14, hull: "alu" }, 0));
  /* ⭐ the checklist IS the feature */
  const titled = td.tdBoatChecklist(true), open = td.tdBoatChecklist(false);
  ok("titled (14 ft+) checklist carries all 5 steps", titled.length === 5, titled);
  ok("...including the FREE lien check with the NCWRC number", titled.some(s => /lien/i.test(s) && /800-628-3773/.test(s)));
  ok("...and the owner's 15-day destroyed-vessel report", titled.some(s => /15 DAYS/.test(s) && /800-628-3773/.test(s)));
  ok("an untitled boat drops the lien + NCWRC steps (3 remain)", open.length === 3, open);
  ok("...but never the authorization, title-match or HIN photos",
    ["authorization", "name matches", "HIN"].every(k => open.some(s => s.toLowerCase().indexOf(k.toLowerCase()) >= 0)));
  const fs2 = require("fs"), src = fs2.readFileSync("js/172-teardown.js", "utf8");
  ok("the printable authorization form exists", /tdPrintBoatForm/.test(src) && /VESSEL DISPOSAL AUTHORIZATION/.test(src));
  ok("⛔ the form transfers NO ownership — demo contractor, not a buyer", /Ownership does not transfer/.test(src));
  ok("⛔ and it puts the 15-day NCWRC duty on the OWNER in writing", /within 15 days/.test(src) && /800-628-3773/.test(src));
  ok("the boat trailer is excluded in the form AND the quote notes", /trailer, if any, is not included/.test(src) && /titled vehicle; the boat comes off it/.test(src));
}

console.log("\n— the file registers everywhere it must —");
{
  const fs = require("fs");
  const shell = fs.readFileSync("Business App (v1).html", "utf8");
  ok("script tag in the shell", /js\/172-teardown\.js/.test(shell));
  const wiz = fs.readFileSync("js/23-guided-quote-wizard.js", "utf8");
  ok("service-picker entry", /teardown.*Deck \/ fence \/ concrete teardown/.test(wiz));
  ok("wizard routes to the estimator", /k==="teardown".*openTeardownEst/.test(wiz));
  const bands = fs.readFileSync("js/22-deep-quote-engine-line-item-.js", "utf8");
  ok("all five teardown market bands exist", ["deckdemo", "fencedemo", "intdemo", "concdemo", "boatdemo"].every(k => bands.indexOf(k + ":{lo:") >= 0));
  ok("⭐ the shed band was raised to market ($500–1,500)", /demo:\{lo:500,hi:1500/.test(bands));
  const shed = fs.readFileSync("js/30-demolition-estimator.js", "utf8");
  ok("...and js/30's footprint bands match", /return \[500,700\]/.test(shed) && /return \[1000,1500\]/.test(shed));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
