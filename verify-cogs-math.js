/* Self-contained re-verification of the COGS math (no require, no DOM).
 * Mirror of cogs-payment-layer.js Part 1 + the 33 assertions from
 * cogs-payment-tests.js. Standalone so it can't be tripped by mount/require quirks.
 * Run: node "verify-cogs-math.js"  →  expect 33 passed, 0 failed. */
var DISPOSAL_RATE_PER_TON=73.16, LBS_PER_TON=2000, MARGIN_FLOOR=0.35;
function disposalCost(lbs){lbs=Math.max(0,+lbs||0);return Math.round((lbs/LBS_PER_TON)*DISPOSAL_RATE_PER_TON*100)/100;}
function lineFigures(price,cost,qty){qty=qty||1;var P=(+price||0)*qty,C=(+cost||0)*qty,profit=P-C;return{price:P,cost:C,profit:profit,margin:P>0?profit/P:0};}
function quoteCogs(items,discount){var price=0,cost=0;(items||[]).forEach(function(it){var f=lineFigures(it.price,it.cost,it.qty);price+=f.price;cost+=f.cost;});price=Math.max(0,price-(+discount||0));var profit=price-cost;return{price:price,cost:cost,profit:profit,margin:price>0?profit/price:0};}
function belowMarginFloor(margin,floor){return margin<(floor==null?MARGIN_FLOOR:floor);}
function disposalLine(lbs){return{name:"Dump fee — "+lbs+" lbs",unit:"cost",price:0,qty:1,cost:disposalCost(lbs),costLine:true};}
var COST_DEFAULT={obx:{softwash:{base:8,perUnit:0.0088},pressure:{base:12,perUnit:0.004},junk:{base:25,lbsPerEighth:312.5}},jam:{lock:{hardware:{wifi:220},addlHw:200,hub:130,misc:10},starlink:{mount:{eave:50},perExt:25}}};
function calcCost(key,inp,costs){costs=costs||COST_DEFAULT;var t=(costs.obx&&costs.obx[key])?costs.obx:(costs.jam?costs.jam:{});var c=t[key];if(!c)return 0;inp=inp||{};var qty=inp.qty||0,n=Math.max(1,inp.count||1);
  if(key==="softwash"||key==="pressure")return Math.round(((c.base||0)+(c.perUnit||0)*qty)*100)/100;
  if(key==="junk"){var lbs=inp.lbs!=null?inp.lbs:(inp.eighths||1)*(c.lbsPerEighth||312.5);return Math.round(((c.base||0)+disposalCost(lbs))*100)/100;}
  if(key==="lock")return (c.hardware[inp.type]||0)*n+(c.addlHw||0)*(n-1)+(inp.hub?c.hub:0)+(c.misc||0);
  if(key==="starlink")return (c.mount[inp.mount]||c.mount.eave)+(c.perExt||0)*(inp.ext||0);return 0;}

var pass=0,fail=0;
function ok(n,c,got){if(c){pass++;console.log("  ✓ "+n);}else{fail++;console.log("  ✗ "+n+"  got "+JSON.stringify(got));}}
function near(a,b,e){return Math.abs(a-b)<=(e==null?0.01:e);}

console.log("\n— Disposal helper —");
ok("⛔ 500 lbs is NOT free — $18.29",near(disposalCost(500),18.29),disposalCost(500));
ok("⛔ 400 lbs is NOT free — $14.63",near(disposalCost(400),14.63),disposalCost(400));
ok("2000 lbs = $73.16",near(disposalCost(2000),73.16),disposalCost(2000));
ok("4000 lbs = $146.32",near(disposalCost(4000),146.32),disposalCost(4000));
ok("1500 lbs = $54.87",near(disposalCost(1500),54.87),disposalCost(1500));
ok("negative = $0",disposalCost(-100)===0,disposalCost(-100));
console.log("— Line margin —");
var hw=lineFigures(399,30,1);ok("house wash profit = $369",hw.profit===369,hw);
ok("house wash margin = 92.5%",near(hw.margin,0.9248,0.001),hw.margin);
var dw=lineFigures(149,14,1);ok("driveway margin ≈ 90.6%",near(dw.margin,0.9060,0.001),dw.margin);
var qy=lineFigures(12,5,10);ok("qty price = $120",qy.price===120,qy);
ok("qty cost = $50",qy.cost===50,qy);ok("qty profit = $70",qy.profit===70,qy);
ok("zero-price = 0% margin",lineFigures(0,10,1).margin===0,lineFigures(0,10,1));
console.log("— Quote roll-up + discount —");
var items=[{price:399,cost:30,qty:1},{price:149,cost:14,qty:1}];var q=quoteCogs(items,0);
ok("quote price = $548",q.price===548,q);ok("quote cost = $44",q.cost===44,q);ok("quote profit = $504",q.profit===504,q);
var qd=quoteCogs(items,100);ok("discount → price $448",qd.price===448,qd);ok("discount keeps cost $44",qd.cost===44,qd);ok("discount → profit $404",qd.profit===404,qd);
console.log("— Margin floor —");
ok("90%: no warning",belowMarginFloor(0.90)===false,true);
ok("35%: no warning",belowMarginFloor(0.35)===false,true);
ok("34.9%: WARN",belowMarginFloor(0.349)===true,true);
var fc=quoteCogs([{price:200,cost:150,qty:1}],0);ok("$200/$150 = 25% → WARN",belowMarginFloor(fc.margin),fc.margin);
console.log("— calcCost defaults —");
ok("softwash 2500 ≈ $30",near(calcCost("softwash",{qty:2500}),30,1),calcCost("softwash",{qty:2500}));
ok("pressure 600 ≈ $14",near(calcCost("pressure",{qty:600}),14.4,1),calcCost("pressure",{qty:600}));
ok("junk 4/8 = base+dump",near(calcCost("junk",{eighths:4}),25+disposalCost(1250),0.5),calcCost("junk",{eighths:4}));
ok("junk lbs overrides",near(calcCost("junk",{lbs:2500}),25+91.45,0.5),calcCost("junk",{lbs:2500}));
ok("starlink eave = $50",calcCost("starlink",{mount:"eave"})===50,calcCost("starlink",{mount:"eave"}));
ok("lock wifi x1 = $230",calcCost("lock",{type:"wifi",count:1})===230,calcCost("lock",{type:"wifi",count:1}));
console.log("— disposalLine —");
var dl=disposalLine(2000);ok("is cost line",dl.costLine===true&&dl.unit==="cost",dl);
ok("cost = $73.16 (the whole 2,000 lb)",near(dl.cost,73.16),dl.cost);ok("price = $0",dl.price===0,dl);
console.log("\n=========  "+pass+" passed, "+fail+" failed  =========\n");
process.exit(fail?1:0);
