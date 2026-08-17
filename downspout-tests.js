/* downspout-tests.js — the gutter/downspout repair estimator (js/134) + its crew guide.

   Ray, 2026-08-17, on a job the same day: "they want us to remove one gutter downspout and just move it
   somewhere else… in the new place it has a different path from the gutter to the wall. And then we also
   have to cap the old hole. Can you add this to the quote tool and make us a guide?"

   ⭐ THE TEST THAT MATTERS is the pass-through one. Ray's model is that price = LABOUR and every part is
   carried at cost with zero margin. If a material ever moves profit, the estimator is lying about what the
   job earns — and on this job specifically the customer already owns most of the parts, so the
   who-provides toggle is load-bearing, not a nicety.

   Pure node. Run: node downspout-tests.js */
const fs = require("fs"), path = require("path");
const d = require("./js/134-downspout-repair.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const DS = fs.readFileSync(path.join(__dirname, "js", "134-downspout-repair.js"), "utf8");
const WZ = fs.readFileSync(path.join(__dirname, "js", "23-guided-quote-wizard.js"), "utf8");
const PB = fs.readFileSync(path.join(__dirname, "js", "114-playbook-library.js"), "utf8");

console.log("\n--- ⭐ materials are pass-through: they never move profit ---");
{
  const base = { work: { relocate: 1, capout: 1 }, crew: 2 };
  const a = d.dsCalc(base);
  const b = d.dsCalc(Object.assign({}, base, { mats: { pipe: "cust", elbow: "cust", strap: "cust" } }));
  eq("labour is identical either way", a.laborPrice, b.laborPrice);
  eq("profit is identical either way", a.profit, b.profit);
  ok("price drops by exactly what the parts cost", Math.abs((a.price - b.price) - (a.cost - b.cost)) < 0.005,
    { dPrice: a.price - b.price, dCost: a.cost - b.cost });
  ok("customer-provided parts leave OUR cost", b.cost < a.cost, { a: a.cost, b: b.cost });
  ok("margin rises when they supply (same profit, smaller price)", b.margin > a.margin, { a: a.margin, b: b.margin });
  eq("profit equals labour exactly (drive nets out, parts net out)", a.profit, a.laborPrice);
}

console.log("\n--- the work items drive the price ---");
{
  eq("nothing selected is a zero quote", d.dsCalc({}).price, 45);   // drive only
  eq("no work means no labour", d.dsCalc({}).laborPrice, 0);
  const one = d.dsCalc({ work: { relocate: 1 } }), two = d.dsCalc({ work: { relocate: 2 } });
  eq("two relocations is twice the labour", two.laborPrice, one.laborPrice * 2);
  ok("...and twice the hours", Math.abs(two.hours - one.hours * 2) < 0.001);
  const over = d.dsCalc({ work: { relocate: 1 }, workPrice: { relocate: 500 } });
  eq("a per-item price override wins", over.laborPrice, 500);
  eq("a negative count can't go below zero", d.dsCalc({ work: { relocate: -3 } }).laborPrice, 0);
}

console.log("\n--- parts follow the work, and can be overridden ---");
{
  const c = d.dsCalc({ work: { capout: 1 } });
  const keys = c.matLines.map(m => m.key);
  ok("capping an outlet pulls in sealant", keys.indexOf("sealant") >= 0, keys);
  ok("...and flashing for the patch", keys.indexOf("flash") >= 0, keys);
  ok("...and rivets", keys.indexOf("rivets") >= 0, keys);
  ok("it does NOT pull in elbows (nothing is being re-run)", keys.indexOf("elbow") < 0, keys);

  const r = d.dsCalc({ work: { relocate: 1 } });
  const rk = r.matLines.map(m => m.key);
  ok("relocating pulls in elbows — the part the new path eats", rk.indexOf("elbow") >= 0, rk);
  ok("...a downspout section to cut the offset from", rk.indexOf("pipe") >= 0, rk);
  ok("...and straps for the new location", rk.indexOf("strap") >= 0, rk);

  const ov = d.dsCalc({ work: { relocate: 1 }, matQty: { elbow: 7 } });
  eq("an explicit quantity overrides the suggestion", ov.matLines.find(m => m.key === "elbow").qty, 7);
  const zero = d.dsCalc({ work: { relocate: 1 }, matQty: { elbow: 0 } });
  ok("setting a quantity to zero drops the line", !zero.matLines.some(m => m.key === "elbow"));
  const pc = d.dsCalc({ work: { capout: 1 }, matCosts: { sealant: 25 } });
  eq("a price override is used", pc.matLines.find(m => m.key === "sealant").each, 25);
  eq("quantities add up across work items", d.dsCalc({ work: { capout: 2 } }).matLines.find(m => m.key === "sealant").qty, 2);
}

console.log("\n--- margin floor + hours ---");
{
  const low = d.dsCalc({ work: { capout: 1 }, workPrice: { capout: 1 }, matCosts: { flash: 300 } });
  ok("a job under 35% margin is flagged", low.lowMargin === true, low.margin);
  ok("a normal job is not flagged", d.dsCalc({ work: { relocate: 1 } }).lowMargin === false);
  const c = d.dsCalc({ work: { relocate: 1, capout: 1 }, crew: 2 });
  eq("hours come from the work chosen", c.hours, 2);
  ok("a per-person hourly read is produced", c.perHr > 0, c.perHr);
  eq("crew of 1 doubles the per-person rate vs crew of 2",
    d.dsCalc({ work: { relocate: 1 }, crew: 1 }).perHr, d.dsCalc({ work: { relocate: 1 }, crew: 2 }).perHr * 2);
}

console.log("\n--- ⚠️ the re-pitch line exists, because that's the callback ---");
ok("re-pitching is a first-class work item", d.DS_WORK.some(w => w.key === "repitch"));
ok("...and says why in its own hint", /ponds/.test((d.DS_WORK.find(w => w.key === "repitch") || {}).hint || ""));
ok("the UI warns when you relocate WITHOUT re-pitching", /work \|\| \{\}\)\.relocate && !\(ds\.work \|\| \{\}\)\.repitch/.test(DS));
ok("...and explains the physics rather than just nagging", /Gutters fall toward the outlet/.test(DS));
ok("the reason it's a line item and not a surprise is recorded", /THE RE-PITCH LINE IS NOT PADDING/.test(DS));

console.log("\n--- the quote line it produces ---");
{
  const c = d.dsCalc({ work: { relocate: 1, capout: 1 }, mats: { pipe: "cust", elbow: "cust" } });
  const it = d.dsItem(c);
  eq("priced as one job line", it.unit, "job");
  eq("price matches the calc", it.price, c.price);
  eq("cost matches the calc", it.cost, c.cost);
  eq("it carries a band key so it reopens in this builder", it.bandKey, "downspout");
  ok("the breakdown names the work", /Relocate a downspout/.test(it.breakdown.join(" ")), it.breakdown);
  ok("customer-provided parts are stated on the quote", /Customer provides/.test(it.notes.join(" ")), it.notes);
  ok("estimated hours and crew ride along", it.estHours === c.hours && it.estCrew === c.crew);
  const noRe = d.dsItem(d.dsCalc({ work: { relocate: 1, repitch: 1 } }));
  ok("re-pitching is called out in the notes when included", /re-pitching/.test(noRe.notes.join(" ")), noRe.notes);
}

console.log("\n--- wired into the quote tool ---");
ok("it's a service in the picker", /\["downspout","🔧 Gutter \/ downspout repair"\]/.test(WZ));
ok("...routed to its own estimator", /if\(k==="downspout"\)\{if\(typeof openDownspoutEst==="function"\)openDownspoutEst\(\);return;\}/.test(WZ));
ok("...and rendered", /if\(k==="downspout"\)return \(typeof wizDownspoutUI==="function"\)/.test(WZ));
ok("a saved quote reopens in the right builder", /downspout\|gutter repair/.test(WZ));
ok("it degrades if js/134 is absent", /typeof openDownspoutEst==="function"/.test(WZ) && /typeof wizDownspoutUI==="function"/.test(WZ));
ok("the existing gutter-CLEANING service is untouched", /gutters:\[\{k:"qty",t:"num",label:"Linear feet of gutter"/.test(WZ));
ok("...and the reason repair isn't priced per foot is recorded", /Pricing it per foot of gutter would be nonsense/.test(DS));
ok("js/134 registered in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/134-downspout-repair.js"') > 0);

console.log("\n--- the crew guide ---");
ok("a playbook process exists", /key:"downspout_move", kind:"process"/.test(PB));
ok("⭐ slope is the FIRST instruction", /do:\["CHECK THE SLOPE FIRST/.test(PB));
ok("the patch goes INSIDE the gutter", /aluminium patch INSIDE the gutter/.test(PB));
ok("plain silicone is called out as wrong", /Don't use plain silicone/.test(PB));
ok("A vs B elbows are explained", /A elbows go in\/out from the wall, B elbows go left\/right/.test(PB));
ok("size and colour are checked before buying", /Match size and colour before buying/.test(PB));
ok("the old outlet is not reused", /Don't reuse the old drop outlet/.test(PB));
ok("it carries tools", /Aviation snips/.test(PB));
ok("it carries safety", /Ladder set on solid, level ground/.test(PB));
ok("...including the service drop overhead", /service drop/.test(PB));
ok("weather matters for the sealant", /Sealant needs to skin over before rain/.test(PB));
/* the seeder only adds entries it doesn't already have, so a new one lands on next load */
ok("the seeder adds missing entries rather than seeding once", /if\(have\[e\.key\]\) return;/.test(PB));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
