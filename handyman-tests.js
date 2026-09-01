/* handyman-tests.js — the generic handyman estimator (js/171).
   Ray, 2026-09-01, pricing a 10-ft pool-equipment shelf after the fact: "this is like a custom handyman
   job… it's gotta be generic — I don't do carpentry work unless I really have to."
   The model under test: price = crew-hours × difficulty-banded labor value; materials pure pass-through
   with who-supplies; static drive; $175 minimum on labor+drive only. Pure node. Run: node handyman-tests.js */
const h = require("./js/171-handyman.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + "  got " + JSON.stringify(got)); } }

console.log("\n— hmCalc: the labor-value core —");
const c1 = h.hmCalc({ hours: 3, crew: 2, band: "standard", drive: 45 });
ok("standard band: 3h × 2 crew × $110 = $660 labor, +$45 drive = $705", c1.laborPrice === 660 && c1.price === 705, c1);
ok("no materials → cost is just the drive; margin healthy, no floor warning", c1.cost === 45 && c1.profit === 660 && !c1.lowMargin, c1);
const c2 = h.hmCalc({ hours: 3, crew: 2, band: "heavy" });
ok("heavy band prices above standard ($130/crew-hr) with the default drive", c2.laborPrice === 780 && c2.drive === h.HM_DRIVE_DEF, c2);
ok("rate override beats the band", h.hmCalc({ hours: 2, crew: 1, band: "light", rate: 200, drive: 0 }).laborPrice === 400);

console.log("\n— the $175 job minimum —");
const cMin = h.hmCalc({ hours: 1, crew: 1, band: "light", drive: 45 });   // 95+45 = 140 → floor
ok("a tiny job floors at $175 (labor+drive under the minimum)", cMin.minApplied === true && cMin.price === 175, cMin);
ok("materials do NOT help meet the minimum (pass-through can't carry the job)", (() => {
  const c = h.hmCalc({ hours: 1, crew: 1, band: "light", drive: 45, mats: [{ label: "lumber", qty: 1, cost: 100, who: "us" }] });
  return c.minApplied === true && c.price === 275;   // 175 floor + 100 pass-through
})());
ok("an empty job (0 hours, 0 drive) doesn't invent a $175 charge", h.hmCalc({ hours: 0, crew: 2, drive: 0 }).price === 0);

console.log("\n— materials: pass-through + who-supplies —");
const cM = h.hmCalc({ hours: 2, crew: 2, band: "standard", drive: 45, mats: [
  { label: "2x6 lumber", qty: 6, cost: 8.5, who: "us" },
  { label: "lag bolts", qty: 1, cost: 14, who: "us" },
  { label: "brackets", qty: 8, cost: 6, who: "cust" },
  { label: "", qty: 3, cost: 99, who: "us" }               // blank label = ignored
] });
ok("our materials sum at cost (6×8.50 + 14 = $65), customer lines cost $0, blank lines ignored", cM.matCost === 65 && cM.matLines.length === 3, cM.matLines);
ok("materials move price and cost equally — labor profit untouched", cM.price === 440 + 65 + 45 - 45 + 45 && cM.profit === 440 + 45 - 45, { price: cM.price, profit: cM.profit });
ok("customer-provided-everything = zero material cost (both Christina jobs)", h.hmCalc({ hours: 2, crew: 2, mats: [{ label: "all of it", qty: 1, cost: 500, who: "cust" }] }).matCost === 0);

console.log("\n— hmItem: the quote line —");
const it = h.hmItem(cM, { desc: "build a 10 ft equipment shelf" });
ok("line carries the description, band breakdown, and bandKey handyman", /Handyman — build a 10 ft equipment shelf/.test(it.name) && it.bandKey === "handyman" && /2h × 2 crew @ \$110/.test(it.breakdown[0]), it);
ok("customer-provided parts named on the line's notes", it.notes.some(n => /Customer provides: brackets/.test(n)), it.notes);
ok("min-floor jobs say so on the line", h.hmItem(h.hmCalc({ hours: 1, crew: 1, band: "light", drive: 45 }), {}).notes.some(n => /\$175 job minimum/.test(n)));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
process.exit(fail ? 1 : 0);
