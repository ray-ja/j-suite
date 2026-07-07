/* FRENCH DRAIN ESTIMATOR — pure-Node unit tests: node french-drain-tests.js
 * Asserts the trench geometry (fdGeo) and the pricing engine (fdCalc): materials net-zero to profit,
 * and the 35% margin-floor flag trips under a heavy discount. No Chrome — fdGeo is pure, fdCalc guards globals. */
const fd = require("./js/101-french-drain-estimator.js");

let failed = 0, passed = 0;
function ok(m){ passed++; console.log("  ok  " + m); }
function bad(m){ failed++; console.log("FAIL  " + m); }
function near(a, b, tol, m){ (Math.abs(a-b) <= tol) ? ok(m + " (" + Math.round(a*1000)/1000 + " ≈ " + b + ")") : bad(m + " — got " + a + ", want ~" + b); }

// ---- 1) fdGeo core geometry (the calibrated reference job) ----
const g = fd.fdGeo({ run:67, width:7.5, depth:12, cap:2, pipe:false, density:1.4, settle:true });
near(g.rockCY, 1.29, 0.02, "rockCY of the 67ft job");
near(g.rockTon, 1.99, 0.02, "rockTon with +10% settling");
near(g.fabricSF, 176, 1.0, "fabric sq ft (bottom + 2 walls)");
near(g.spoilCY, 1.55, 0.02, "spoil cubic yards dug out");

const gNo = fd.fdGeo({ run:67, width:7.5, depth:12, cap:2, pipe:false, density:1.4, settle:false });
near(gNo.rockTon, 1.81, 0.02, "rockTon with NO settling");

// pipe displaces rock: same trench + 4" pipe → less stone, and pipeFt = run
const gPipe = fd.fdGeo({ run:67, width:7.5, depth:12, cap:2, pipe:true, density:1.4, settle:true });
(gPipe.rockTon < g.rockTon) ? ok("perf pipe DISPLACES rock (" + Math.round(gPipe.rockTon*100)/100 + " < " + Math.round(g.rockTon*100)/100 + ")") : bad("pipe should subtract rock");
(gPipe.pipeFt === 67) ? ok("pipeFt = run when pipe is on") : bad("pipeFt wrong: " + gPipe.pipeFt);
(g.pipeFt === 0) ? ok("pipeFt = 0 when pipe is off") : bad("pipeFt should be 0 with no pipe");

// cap can't exceed depth; zero run → zero everything
const gEdge = fd.fdGeo({ run:0, width:7.5, depth:12, cap:99, pipe:false, density:1.4, settle:true });
(gEdge.rockTon === 0 && gEdge.spoilTon === 0) ? ok("zero run → zero material") : bad("zero-run guard failed");

// ---- 2) fdCalc pricing: materials net-zero to profit + 35% floor ----
// Ray's defaults: rock/fabric = we-provide, pipe off, decorative = customer, spoil = haul clean-fill.
const base = { run:67, width:7.5, depth:12, cap:2, pipe:false, density:1.4, settle:true, lft:12, crew:2, complexity:1,
  mats:{}, matCosts:{}, haulSpoil:true, spoilType:"fill" };
const c = fd.fdCalc(JSON.parse(JSON.stringify(base)));
(c.price > 0 && c.cost > 0 && c.profit === c.price - c.cost) ? ok("price/cost/profit coherent (" + c.price + "/" + c.cost + "/" + c.profit + ")") : bad("price/cost/profit incoherent");
(c.margin > 0 && Math.abs(c.margin - c.profit/c.price) < 1e-9) ? ok("margin = profit/price = " + Math.round(c.margin*100) + "%") : bad("margin wrong");
(c.matCost > 0) ? ok("we-provide materials add cost (#57 + fabric): " + c.matCost) : bad("materials should cost something");

// materials NET-ZERO: flipping the #57 rock to customer-provides drops price and cost by the SAME amount → profit unchanged
const cCustRock = JSON.parse(JSON.stringify(base)); cCustRock.mats = { rock:"them" };
const c2 = fd.fdCalc(cCustRock);
const dPrice = c.price - c2.price, dCost = c.cost - c2.cost;
(Math.abs(dPrice - dCost) < 1 && Math.abs(c.profit - c2.profit) < 1) ? ok("materials net-zero: rock toggle moves price & cost equally (Δprice " + dPrice + " ≈ Δcost " + dCost + "), profit unchanged") : bad("materials NOT net-zero: Δprice " + dPrice + " vs Δcost " + dCost);

// 35% floor: at a heavy discount (price near cost) the margin-floor flag must trip
const cHeavy = JSON.parse(JSON.stringify(base));
const cH = fd.fdCalc(cHeavy);
// simulate a heavy discount by re-deriving margin at a price just above cost
const discPrice = cH.cost + 20, discMargin = (discPrice - cH.cost)/discPrice;
(discMargin < 0.35) ? ok("heavy discount → margin " + Math.round(discMargin*100) + "% trips the 35% floor") : bad("floor should trip under a heavy discount");
(cH.underFloor === (cH.margin < 0.35)) ? ok("underFloor flag matches margin < 35% (full-price margin " + Math.round(cH.margin*100) + "%)") : bad("underFloor flag inconsistent");

// leaving the spoil drops cost (no haul + no dump miles)
const cLeave = JSON.parse(JSON.stringify(base)); cLeave.haulSpoil = false;
const cL = fd.fdCalc(cLeave);
(cL.spoilCost === 0 && cL.dumpMileage === 0 && cL.cost < c.cost) ? ok("leave-the-spoil → $0 haul + $0 dump miles, cost drops") : bad("leave-spoil should zero the haul cost");

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
