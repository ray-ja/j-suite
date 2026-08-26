/* Unit tests for the COGS + payment layer.
 * Verifies margin math + disposal helper against "Job Cost & Materials Model (v1).md".
 * Run: node "cogs-payment-tests.js"   (pure logic only — no DOM/app deps) */
const L = require("./cogs-payment-layer.js");

let pass = 0, fail = 0;
function ok(name, cond, got){ if(cond){pass++; console.log("  ✓ "+name);} else {fail++; console.log("  ✗ "+name+"   got: "+JSON.stringify(got));} }
function near(a,b,eps){ return Math.abs(a-b) <= (eps==null?0.01:eps); }

console.log("\n— Disposal helper ($73.16/ton, EVERY pound billable — the 500 lb waiver is annual + residential) —");
ok("⛔ 500 lbs is NOT free — $18.29", near(L.disposalCost(500), 18.29), L.disposalCost(500));
ok("⛔ 400 lbs is NOT free — $14.63 (no residential waiver in a quote)", near(L.disposalCost(400), 14.63), L.disposalCost(400));
ok("2000 lbs = 1.00 ton = $73.16", near(L.disposalCost(2000), 73.16), L.disposalCost(2000));
ok("4000 lbs = 2.00 ton = $146.32", near(L.disposalCost(4000), 146.32), L.disposalCost(4000));
ok("typical pickup load 1500 lbs = $54.87", near(L.disposalCost(1500), 54.87), L.disposalCost(1500));
ok("0 / negative lbs = $0",             L.disposalCost(-100) === 0, L.disposalCost(-100));

console.log("\n— Line margin math (cost / price / profit / margin) —");
let hw = L.lineFigures(399, 30, 1);   // doc: $399 house wash, ~$30 materials
ok("house wash profit = $369",          hw.profit === 369, hw);
ok("house wash margin = 92.5%",         near(hw.margin, 0.9248, 0.001), hw.margin);
let dw = L.lineFigures(149, 14, 1);     // doc: $149 driveway, ~$14 material
ok("driveway margin ≈ 90.6%",           near(dw.margin, 0.9060, 0.001), dw.margin);
let qy = L.lineFigures(12, 5, 10);      // qty-aware: 10 windows @ $12, $5 cost
ok("qty-aware price = $120",            qy.price === 120, qy);
ok("qty-aware cost = $50",              qy.cost === 50, qy);
ok("qty-aware profit = $70",            qy.profit === 70, qy);
ok("zero-price line = 0% margin (no div0)", L.lineFigures(0, 10, 1).margin === 0, L.lineFigures(0,10,1));

console.log("\n— Quote roll-up + discount eats margin (price side only) —");
let items = [ {price:399, cost:30, qty:1}, {price:149, cost:14, qty:1} ];
let q = L.quoteCogs(items, 0);
ok("quote price = $548",                q.price === 548, q);
ok("quote cost = $44",                  q.cost === 44, q);
ok("quote profit = $504",               q.profit === 504, q);
let qd = L.quoteCogs(items, 100);       // $100 on-site discount
ok("discount lowers price to $448",     qd.price === 448, qd);
ok("discount does NOT lower cost ($44)",qd.cost === 44, qd);
ok("discount lowers profit to $404",    qd.profit === 404, qd);

console.log("\n— Margin floor warning (< 35%) —");
ok("90% margin: no warning",            L.belowMarginFloor(0.90) === false, true);
ok("35% margin: no warning (at floor)", L.belowMarginFloor(0.35) === false, true);
ok("34.9% margin: WARN",                L.belowMarginFloor(0.349) === true, true);
// a $200 job discounted so hard cost ($150) leaves 25% margin
let floorCase = L.quoteCogs([{price:200, cost:150, qty:1}], 0);
ok("$200 job / $150 cost = 25% margin → WARN", L.belowMarginFloor(floorCase.margin), floorCase.margin);

console.log("\n— calcCost() seeds from doc defaults —");
ok("softwash ~2500 sqft ≈ $30 (doc $20–45)", near(L.calcCost("softwash",{qty:2500},{obx:L.COST_DEFAULT.obx}), 30, 1), L.calcCost("softwash",{qty:2500},{obx:L.COST_DEFAULT.obx}));
ok("pressure 600 sqft ≈ $14 (doc $10–25)",  near(L.calcCost("pressure",{qty:600},{obx:L.COST_DEFAULT.obx}), 14.4, 1), L.calcCost("pressure",{qty:600},{obx:L.COST_DEFAULT.obx}));
ok("junk 4/8 truck (1250 lbs) = base+dump", near(L.calcCost("junk",{eighths:4},{obx:L.COST_DEFAULT.obx}), 25 + L.disposalCost(1250), 0.5), L.calcCost("junk",{eighths:4},{obx:L.COST_DEFAULT.obx}));
ok("junk explicit lbs overrides eighths",   near(L.calcCost("junk",{lbs:2500},{obx:L.COST_DEFAULT.obx}), 25 + 91.45, 0.5), L.calcCost("junk",{lbs:2500},{obx:L.COST_DEFAULT.obx}));
ok("jam starlink eave: kit $0, mount $50",  L.calcCost("starlink",{mount:"eave"},{jam:L.COST_DEFAULT.jam}) === 50, L.calcCost("starlink",{mount:"eave"},{jam:L.COST_DEFAULT.jam}));
ok("jam lock wifi x1 = $220+misc $10",       L.calcCost("lock",{type:"wifi",count:1},{jam:L.COST_DEFAULT.jam}) === 230, L.calcCost("lock",{type:"wifi",count:1},{jam:L.COST_DEFAULT.jam}));

console.log("\n— disposalLine() auto-add —");
let dl = L.disposalLine(2000);
ok("disposal line is a cost line",      dl.costLine === true && dl.unit === "cost", dl);
ok("disposal line cost = $73.16 (the whole 2,000 lb)", near(dl.cost, 73.16), dl.cost);
ok("disposal line price = $0 (cost only)", dl.price === 0, dl);

console.log("\n=================  " + pass + " passed, " + fail + " failed  =================\n");
process.exit(fail ? 1 : 0);
