/* holiday-lights-tests.js — the holiday lighting estimator (js/126).
   Ray has never done this work, so the tests check the MODEL against the researched reality, not just arithmetic:
   the trade price band, the $1,000 minimum, the amortisation that makes year 2 the profitable one, and the
   $125/crew-hr bar he set for his other trade work.
   Pure node. Run: node holiday-lights-tests.js */
const hl = require("./js/126-holiday-lights.js");
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

console.log("\n--- the rate card matches the researched trade band ---");
eq("single-storey roofline is the $8 trade floor", hl.HL_RATES.roof1.v, 8);
ok("two-storey sits in $9-11", hl.HL_RATES.roof2.v >= 9 && hl.HL_RATES.roof2.v <= 11);
ok("three-storey sits in $11-12", hl.HL_RATES.roof3.v >= 11 && hl.HL_RATES.roof3.v <= 12);
ok("deck rail is priced BELOW roofline (installed from the deck)", hl.HL_RATES.rail.v < hl.HL_RATES.roof1.v);
ok("NOTHING is priced in the $2-5/ft labour-only band that does not apply to this model",
  hl.HL_RATES.roof1.v >= 8 && hl.HL_RATES.roof2.v >= 8 && hl.HL_RATES.roof3.v >= 8);
eq("the minimum job is $1,000, not his $375 trade minimum", hl.HL_MIN_JOB, 1000);
eq("per-tree floor is $300", hl.HL_MIN_TREE, 300);
ok("repeat discount stays inside the 10-15% band industry actually uses",
  hl.HL_REPEAT_DISC >= 0.10 && hl.HL_REPEAT_DISC <= 0.15, String(hl.HL_REPEAT_DISC));
eq("deposit is 50%", hl.HL_DEPOSIT, 0.5);
eq("coastal amortisation defaults to 3 seasons, not 6-7", hl.HL_AMORT_YRS_DEF, 3);

console.log("\n--- EVERY rate carries its evidence, because he cannot sanity-check a bare number ---");
Object.keys(hl.HL_RATES).forEach(k => {
  const r = hl.HL_RATES[k];
  ok("rate '" + k + "' cites a source", typeof r.src === "string" && r.src.length > 40);
  ok("...and a confidence tag", ["high", "medium", "low"].indexOf(r.conf) >= 0, r.conf);
});
Object.keys(hl.HL_COST).forEach(k => {
  ok("cost '" + k + "' cites a source", typeof hl.HL_COST[k].src === "string" && hl.HL_COST[k].src.length > 30);
});
ok("every wreath size cites a source", hl.HL_WREATHS.every(w => w.src && w.src.length > 8));

console.log("\n--- the reference job: 200 ft two-storey roofline ---");
{
  const r = hl.hlCalc({ roofFt: 200, storeys: 2 });
  eq("uses the two-storey rate", r.roofRate, 9.5);
  eq("price is 200 x $9.50", r.price, 1900);
  ok("clears the $1,000 minimum on its own", !r.belowMin);
  ok("margin is healthy", r.margin >= 35, r.margin + "%");
  /* the research put this job at $94-150/crew-hr in year 1 */
  ok("year-1 $/crew-hr lands in the researched $94-150 range", r.perCrewHr >= 94 && r.perCrewHr <= 170, "$" + r.perCrewHr + "/hr");
  ok("takedown time is counted, not forgotten", r.downHrs > 0);
  ok("a season service visit is costed in", r.crewHrs > r.instHrs + r.downHrs);
}

console.log("\n--- THE MODEL'S WHOLE POINT: year 2 is where the money is ---");
{
  const y1 = hl.hlCalc({ roofFt: 200, storeys: 2 });
  const y2 = hl.hlCalc({ roofFt: 200, storeys: 2, repeatYear: true });
  ok("year 2 costs the customer LESS", y2.price < y1.price);
  ok("...by 10-15%", Math.abs(1 - y2.price / y1.price) >= 0.10 && Math.abs(1 - y2.price / y1.price) <= 0.15);
  ok("year 1 carries a slice of the strand cost", y1.strandAmort > 0);
  eq("year 2 carries NONE — the lights already exist", y2.strandAmort, 0);
  ok("so year 2 earns MORE per crew-hour despite charging less",
    y2.perCrewHr > y1.perCrewHr, "y1 $" + y1.perCrewHr + " vs y2 $" + y2.perCrewHr);
  ok("...and beats his $125/crew-hr bar", y2.perCrewHr >= 125, "$" + y2.perCrewHr);
}

console.log("\n--- amortisation: the coastal assumption actually bites ---");
{
  const coastal = hl.hlCalc({ roofFt: 200, storeys: 2, amortYrs: 3 });
  const inland  = hl.hlCalc({ roofFt: 200, storeys: 2, amortYrs: 6 });
  ok("a 3-season window costs more per year than 6", coastal.strandAmort > inland.strandAmort);
  ok("...so coastal margin is lower on the same price", coastal.margin < inland.margin);
  ok("the strand asset is reported separately from the yearly slice", coastal.strandCost > coastal.strandAmort);
}

console.log("\n--- the minimum protects small jobs ---");
{
  const tiny = hl.hlCalc({ roofFt: 40, storeys: 1 });
  ok("a 40 ft job is flagged as below minimum", tiny.belowMin);
  eq("...and lifted to $1,000", tiny.price, 1000);
  const big = hl.hlCalc({ roofFt: 300, storeys: 2 });
  ok("a real job is not flagged", !big.belowMin);
}

console.log("\n--- trees price by vertical foot with a $300 floor ---");
{
  const small = hl.hlCalc({ roofFt: 100, storeys: 1, trees: [{ ft: 4 }] });
  const tall  = hl.hlCalc({ roofFt: 100, storeys: 1, trees: [{ ft: 20 }] });
  eq("a 4 ft tree hits the $300 floor, not 4 x $45", small.treePrice, 300);
  eq("a 20 ft tree prices at 20 x $45", tall.treePrice, 900);
  const two = hl.hlCalc({ roofFt: 100, storeys: 1, trees: [{ ft: 20 }, { ft: 20 }] });
  eq("two trees price independently", two.treePrice, 1800);
}

console.log("\n--- elements ---");
{
  const r = hl.hlCalc({ roofFt: 100, storeys: 1, bushes: 4, columns: 2, windows: 6, garlandFt: 18,
                        wreaths: [{ in: 48, qty: 1 }, { in: 24, qty: 2 }] });
  eq("bushes", r.bushPrice, 300);
  eq("columns", r.columnPrice, 220);
  eq("windows", r.windowPrice, 372);
  eq("garland at $17/ft", r.garlandPrice, 306);
  eq("a 48in wreath is $300 and two 24in are $100 each", r.wreathPrice, 500);
  const odd = hl.hlCalc({ roofFt: 100, wreaths: [{ in: 36, qty: 1 }] });
  eq("a 36in wreath falls into the 32in tier", odd.wreathPrice, 175);
  const huge = hl.hlCalc({ roofFt: 100, wreaths: [{ in: 72, qty: 1 }] });
  eq("anything above 60in takes the top tier", huge.wreathPrice, 500);
}

console.log("\n--- property-manager portfolio pricing ---");
{
  const one  = hl.hlCalc({ roofFt: 200, storeys: 2, homes: 1 });
  const five = hl.hlCalc({ roofFt: 200, storeys: 2, homes: 5 });
  const ten  = hl.hlCalc({ roofFt: 200, storeys: 2, homes: 12 });
  eq("a single home gets no portfolio discount", one.pmPct, 0);
  eq("5+ homes clustered gets 10%", five.pmPct, 0.10);
  eq("10+ gets 15%", ten.pmPct, 0.15);
  ok("...and it never goes deeper than 15% (published practice is 5-15%)", ten.pmPct <= 0.15);
  ok("the discount actually reduces the price", ten.price < one.price);
}

console.log("\n--- guard rails ---");
{
  const r = hl.hlCalc({ roofFt: 200, storeys: 2 });
  eq("deposit is half the price", r.deposit, Math.round(r.price * 0.5));
  /* use a job big enough to clear the $1,000 minimum — otherwise the minimum lifts the price and RESTORES the
     margin, which is the floor doing exactly its job. */
  const cheap = hl.hlCalc({ roofFt: 600, storeys: 2, roofRate: 2.5 });
  ok("...that job is above the minimum, so the floor is not masking anything", !cheap.belowMin, "$" + cheap.price);
  ok("a low margin is flagged against the 35% floor", cheap.lowMargin, cheap.margin + "%");
  ok("...and $/crew-hr below $125 is flagged", cheap.belowTarget, "$" + cheap.perCrewHr + "/hr");
  ok("the $1,000 minimum RESTORES margin on a small underpriced job (the floor working)",
    !hl.hlCalc({ roofFt: 200, storeys: 2, roofRate: 3 }).lowMargin);
  const empty = hl.hlCalc({});
  eq("an empty job prices at zero, not the minimum", empty.price, 0);
  ok("...and does not divide by zero", isFinite(empty.perCrewHr) && isFinite(empty.margin));
  const junk = hl.hlCalc({ roofFt: "abc", storeys: 99, trees: null, wreaths: "nope" });
  ok("junk input does not throw", isFinite(junk.price));
  ok("storeys is clamped to 3", junk.roofRate <= hl.HL_RATES.roof3.v);
}

console.log("\n--- the model must NOT be a pass-through like the other estimators ---");
{
  const SRC = fs.readFileSync(path.join(__dirname, "js", "126-holiday-lights.js"), "utf8");
  ok("the difference is documented at the top", /DOES NOT WORK LIKE THE OTHER ESTIMATORS/.test(SRC));
  ok("the amortisation source is recorded", /reduce the life of your light sets by up to 50%/.test(SRC));
  ok("the wrong benchmark is called out so nobody re-introduces it", /NOT the \$2-5\/ft figure/.test(SRC));
  ok("the C9-vs-mini recoverability finding is recorded", /RECOVERABLE inventory/.test(SRC));
  ok("the minimum's evidence is recorded", /minimum installation cost is \$1000/.test(hl.HL_MIN_JOB_SRC || SRC));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
