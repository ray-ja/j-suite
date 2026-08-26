/* ============================================================================================================
   PARKING-LOT TESTS — Ray, 2026-08-26: "can you separate the draw lot / count spaces tool? that goes in a
   parking lot cleaning quote tool not on the map." + "theres also floating buttons in the bottom right for
   adding receipts and new leads, we dont need those. we have places for those now."

   ⚠️ THE THING MOST WORTH GUARDING IS THAT THE PRICES DIDN'T MOVE. The measuring tool changed homes; the
   tier table it fed did not. A quote tool that quietly re-prices work he has already sold is worse than the
   awkward screen it replaced, so plBaseFrom is pinned here value-by-value.
   ============================================================================================================ */
const fs = require("fs");
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
const R = f => fs.readFileSync(f, "utf8");
const CODE = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");   // never let a test match its own prose

global.QE = { TAKE_HOME: 45, CREW_FLOOR: 30, FIELD_SPLIT: 0.48, MILEAGE: 0.725, CD_TON: 73.16, VEG_TON: 58.46, FILL_TON: 45, MIN_JOB: 175, MARGIN_FLOOR: 0.35 };
global.CREW_BANDS = { parking: [79, 400] };
global.DISPOSAL_TRIP_MILES = 55;
const P = require("./js/158-parking-lot.js");
const MAP = R("js/19-map-satellite-lot-estimator-.js"), MAPC = CODE(MAP);
const WIZ = CODE(R("js/23-guided-quote-wizard.js"));
const RT = R("js/03-routing.js"), RTC = CODE(RT);
const QC = R("js/99-quick-capture.js"), QCC = CODE(QC);
const PLS = R("js/158-parking-lot.js");
const DRIVE = { charge: 60, miles: 24, min: 38 };
const q = o => P.plQuote(Object.assign({ drive: DRIVE }, o));

console.log("\n--- ⛔ his prices did not move ---");
{
  /* the EXACT table the map tool used. If one of these changes, a lot he already quoted is now a different
     number, and he finds out from a customer rather than from me. */
  const want = { 1: 79, 25: 79, 26: 129, 50: 129, 51: 199, 100: 199, 101: 349, 200: 349, 201: 499, 300: 499, 301: 799, 500: 799 };
  let bad = [];
  Object.keys(want).forEach(k => { if (P.plBaseFrom(+k) !== want[k]) bad.push(k + ": " + P.plBaseFrom(+k) + " ≠ " + want[k]); });
  ok("⭐ every tier is byte-for-byte what the old map tool charged", bad.length === 0, bad);
  ok("...and past 500 it is still ×$1.60/space", P.plBaseFrom(600) === 960 && P.plBaseFrom(1000) === 1600);
  ok("0 spaces doesn't fall off the bottom", P.plBaseFrom(0) === 79 && P.plBaseFrom(-5) === 79);
  ok("⚠️ the reason it's pinned is written down", /silently re-prices old work/.test(PLS));
}

console.log("\n--- 📐 the geometry came across intact ---");
{
  /* a ~0.001° box at OBX latitude: 110.54 m tall × 111320·cos(36.07°)·0.001 = 89.97 m wide ≈ 9,945 m² ≈ 107,000 sq ft */
  const box = [{ lat: 36.070, lng: -75.700 }, { lat: 36.071, lng: -75.700 }, { lat: 36.071, lng: -75.699 }, { lat: 36.070, lng: -75.699 }];
  const a = P.plPolyAreaSqft(box);
  ok("⭐ a known box measures right (±1%)", Math.abs(a - 107047) / 107047 < 0.01, Math.round(a));
  ok("⛔ winding order doesn't flip the sign", Math.abs(P.plPolyAreaSqft(box.slice().reverse()) - a) < 1);
  ok("fewer than 3 points is 0, not NaN", P.plPolyAreaSqft([box[0], box[1]]) === 0 && P.plPolyAreaSqft([]) === 0);
  ok("⭐ area → spaces at 325 sq ft each (incl. drive aisles)", P.plSpacesFromSqft(32500, 325) === 100);
  ok("...and a bad divisor falls back rather than dividing by zero",
    P.plSpacesFromSqft(32500, 0) === 100 && P.plSpacesFromSqft(32500, null) === 100);
}

console.log("\n--- ⭐ the disposal question is the margin (CREW SOP 05) ---");
{
  /* "Disposal: customer dumpster (free) vs we haul (add dump fee)" — Ray's own SOP line. On a small lot this
     single toggle is most of the difference between the two prices. */
  const dump = q({ spaces: 100, cond: "normal", freq: "once", crew: 2 });
  const haul = q({ spaces: 100, cond: "normal", freq: "once", crew: 2, weHaul: true });
  ok("⛔ customer's dumpster → NO tipping fee at all", dump.tip === 0, dump.tip);
  ok("⛔ ...and no dump run in the drive", haul.driveCharge > dump.driveCharge, [dump.driveCharge, haul.driveCharge]);
  ok("⭐ we-haul adds real mileage cost", haul.driveMi > dump.driveMi, [dump.driveMi, haul.driveMi]);
  ok("⭐ the WORK price is identical either way — only the disposal changed", dump.work === haul.work, [dump.work, haul.work]);

  /* ⛔ NO FREE ALLOWANCE — Ray, 2026-08-26: "the station only waives some trash once per year its irrelevant
     and shouldn't be in any quote tool." It is an ANNUAL RESIDENTIAL waiver, not a per-load contractor one.
     I had it deducting on every haul, which under-costed the line by up to $18.29 a trip. */
  ok("⭐⭐ a small haul is NOT free — every pound is billable", haul.lbs < 500 && haul.tip > 0, { lbs: haul.lbs, tip: haul.tip });
  ok("...priced at the full weight × the C&D rate", Math.abs(haul.tip - haul.lbs / 2000 * 73.16) < 0.02, haul.tip);
  const big = q({ spaces: 400, cond: "event", freq: "once", crew: 2, weHaul: true });
  ok("...and so is a heavy one, with nothing subtracted first",
    Math.abs(big.tip - big.lbs / 2000 * 73.16) < 0.02, big.tip);
  ok("⭐ the $0 that REMAINS is the real one — the customer's dumpster, so there is nothing to tip",
    dump.tip === 0 && dump.weHaul === false);
  ok("⚠️ and the correction is recorded where the old rule was", /ANNUAL RESIDENTIAL/.test(PLS));
}

console.log("\n--- ⭐ recurring: 20% off the work, never off the drive ---");
{
  const once = q({ spaces: 100, cond: "normal", freq: "once", crew: 2 });
  const week = q({ spaces: 100, cond: "normal", freq: "weekly", crew: 2 });
  ok("⭐ the discount lands", week.disc > 0 && once.disc === 0);
  ok("⭐ ...on the work only — the drive costs the same every visit", week.driveCharge === once.driveCharge, [once.driveCharge, week.driveCharge]);
  ok("...and it is 20%", Math.abs(week.disc / (once.work) - 0.20) < 0.02, week.disc / once.work);
  ok("⭐ a frequency implies the recurring contract", week.recurring === true && once.recurring === false);
  ok("⭐ MRR is shown, because recurring is the whole point of this service line",
    week.monthly > 0 && Math.abs(week.monthly - week.price * 52 / 12) < 1, week.monthly);
  ok("one-time has no MRR to show", once.monthly === 0 && once.annual === 0);
  ok("bi-weekly is 26 visits, monthly is 12", q({ spaces: 50, freq: "biweek" }).perYear === 26 && q({ spaces: 50, freq: "monthly" }).perYear === 12);
}

console.log("\n--- ⚠️ two people halve the clock, they don't double the labour ---");
{
  /* MY OWN BUG, caught by the $/hr column before it shipped: person-minutes of WORK were being multiplied by
     crew size, which doubled a 2-person job's labour and fired the underpaid warning on jobs that pay fine.
     Driving IS multiplied — the whole crew sits in the truck for the same trip. */
  const one = q({ spaces: 100, cond: "normal", freq: "once", crew: 1 });
  const two = q({ spaces: 100, cond: "normal", freq: "once", crew: 2 });
  ok("⭐ the work itself is the same number of person-hours regardless of crew size",
    Math.abs((one.personHrs - 1 * DRIVE.min / 60) - (two.personHrs - 2 * DRIVE.min / 60)) < 0.01,
    [one.personHrs, two.personHrs]);
  ok("⭐ but the drive IS per person", two.personHrs > one.personHrs, [one.personHrs, two.personHrs]);
  ok("⭐ hours EACH halve with a second person", two.hrsEach < one.hrsEach, [one.hrsEach, two.hrsEach]);
  ok("⚠️ and the trap is documented where someone would re-introduce it", /TOTAL PERSON-MINUTES OF WORK/.test(PLS));

  /* the check that makes the tool worth having: it tells him when the tier price stops paying */
  const rough = q({ spaces: 300, cond: "event", freq: "once", crew: 2, weHaul: true });
  ok("⭐ a 300-space post-event haul is flagged as underpaid at these tiers", rough.perHr < QE.CREW_FLOOR, rough.perHr);
  ok("...while a routine small lot pays fine", q({ spaces: 25, cond: "light", crew: 1 }).perHr >= QE.TAKE_HOME, q({ spaces: 25, cond: "light", crew: 1 }).perHr);
}

console.log("\n--- 💰 the cost model is CLAUDE.md's, not an invented one ---");
{
  const j = q({ spaces: 100, cond: "normal", freq: "once", crew: 2, weHaul: true });
  ok("⭐ cost = tipping + consumables + mileage, and nothing else",
    Math.abs(j.cost - (j.tip + j.consum + j.driveMi)) < 0.02, { cost: j.cost, tip: j.tip, consum: j.consum, mi: j.driveMi });
  ok("⛔ NO hourly-labour line — the owners are paid from the revenue split",
    !/labou?r\s*(cost|Cost)\s*=/.test(CODE(PLS)) && /revenue split/.test(PLS));
  ok("profit and margin are derived from that cost", Math.abs(j.profit - (j.price - j.cost)) < 0.02 && Math.abs(j.margin - j.profit / j.price) < 0.001);
  ok("⚠️ the 35% margin floor is checked", typeof j.marginLow === "boolean" && q({ spaces: 0 }).margin >= 0);
  ok("⭐ the crew's $79–400 guardrail is REPORTED, not enforced",
    q({ spaces: 400, cond: "heavy" }).outOfBand === true && q({ spaces: 400, cond: "heavy" }).price > 400);
  ok("...and a normal small lot sits inside it", q({ spaces: 25, cond: "light", crew: 1, drive: { charge: 20, miles: 8, min: 12 } }).outOfBand === false);
}

console.log("\n--- 🅿️ scope add-ons follow the SOP, not guesswork ---");
{
  const bare = q({ spaces: 60, cond: "normal" });
  const full = q({ spaces: 60, cond: "normal", corrals: 2, storeFt: 200 });
  ok("⭐ dumpster corrals add", full.corralP === 50, full.corralP);
  ok("⭐ storefront/sidewalk adds per linear ft", Math.abs(full.storeP - 70) < 0.01, full.storeP);
  ok("...and both raise the price", full.price > bare.price);
  ok("⭐ they add debris too, so the disposal question stays honest", full.lbs > bare.lbs, [bare.lbs, full.lbs]);
  ok("condition lifts the FROM price", q({ spaces: 60, cond: "event" }).price > q({ spaces: 60, cond: "light" }).price);
  ok("⛔ an unknown condition falls back to normal rather than NaN",
    q({ spaces: 60, cond: "nonsense" }).cond === "normal" && isFinite(q({ spaces: 60, cond: "nonsense" }).price));
  ok("⛔ an empty input can't produce NaN anywhere", Object.keys(P.plQuote({})).every(k => {
    const v = P.plQuote({})[k]; return typeof v !== "number" || isFinite(v);
  }));
}

console.log("\n--- ⭐ it MOVED — the map is a map again ---");
{
  ok("⛔ no Draw lot on the map page", !/Draw lot/.test(MAP));
  ok("⛔ no Count spaces on the map page", !/Count spaces/.test(MAP));
  ok("⛔ and the pricing left with it", !/quoteLot|MSQFT|polyAreaSqft/.test(MAPC));
  ok("⭐ the map still does what a map does — search, places, properties, pins",
    /mapSearch/.test(MAPC) && /renderPlaces/.test(MAPC) && /addPropMarker/.test(MAPC) && /addPlacePrompt/.test(MAPC));
  ok("⚠️ a stray tap no longer draws — dropping a pin is an explicit toggle",
    /if\(MAP_PIN\) addPlacePrompt/.test(MAPC) && /MAP_PIN=false/.test(MAPC));
  ok("⭐ and it says where the measuring went", /Measure it/.test(MAP) && /Parking lot/.test(MAP));

  ok("⛔⛔ the wizard no longer THROWS AWAY THE QUOTE to show a map",
    !/k==="parking".*TAB="map"/.test(WIZ) && /k==="parking"[\s\S]{0,80}openParkingLotEst/.test(WIZ));
  ok("⭐ the measure lives in the tool now", /id="pl_map"/.test(PLS) && /plSetMode/.test(PLS));
  ok("⚠️ ...with the invalidateSize a map inside a hidden modal needs to render at all", /invalidateSize/.test(CODE(PLS)));
  ok("⭐ the measurement writes the space count but leaves it editable", /edit the number above/.test(PLS));
  ok("⛔ it degrades without Leaflet instead of showing a dead box", /Type the space count instead/.test(PLS));
  ok("⭐ it ends in the normal wizard review with the customer attached", /WZ\.step = "review"/.test(CODE(PLS)));
  ok("...and a recurring frequency flips the wizard's own recurring toggle", /WZ\.recurring = true/.test(CODE(PLS)));
}

console.log("\n--- ⛔ the two floating buttons ---");
{
  /* "we dont need those. we have places for those now." */
  /* the only surviving mentions of "capFab" as an element id are in the cleanup that REMOVES it from a
     device still running the old build — so assert on what makes a button exist, not on the string */
  ok("⛔ nothing creates the floating button any more",
    !/createElement\("button"\)/.test(QCC) && !/#capFab\{position:fixed/.test(QCC) && !/textContent = "📸"/.test(QCC));
  ok("⛔ ...and its stylesheet is gone with it", !/capFabStyle";/.test(QCC) && !/bottom:84px/.test(QCC));
  ok("⭐ but the capability is NOT — the picker and the readiness check stay",
    /function capQuickCapture/.test(QCC) && /function capCaptureReady/.test(QCC) && /capFabInput/.test(QCC));
  ok("⚠️ and an old already-open app gets the stale button cleaned off", /removeChild/.test(QCC));
  ok("⭐ Today still offers Snap a receipt", /capQuickCapture/.test(R("js/05-today.js")));

  /* THE "NEW LEADS" BUTTON WAS THE `else` — openCustomer(null) makes a record with status:"Lead", and every
     screen nobody had listed fell through to it. On the Journal page. */
  ok("⛔⛔ the fallback-to-new-lead is gone", !/else openCustomer\(\);\s*$/m.test(RTC) && !/TAB==="messages"\)return;else openCustomer/.test(RTC));
  ok("⭐ the '+' is an allow-list now", /const FAB_ADD = \{/.test(RTC) && /function fabAction/.test(RTC));
  ok("⭐ screens with a real add keep it",
    ["quotes", "jobs", "schedule", "todo", "accounts", "inventory", "receipts", "recurring"].every(t => typeof evalFab(t) === "function"));
  ok("⛔ Today has no '+' — it is not an 'add' screen", evalFab("today") === null);
  ok("⛔ nor Journal, Workout, Shelf, Calendar — where it used to make a LEAD",
    ["journal", "workout", "shelf", "cal", "studio"].every(t => evalFab(t) === null));
  ok("⛔ nor Leads itself — it has its own '📞 New call / lead' button",
    evalFab("leads") === null && /New call \/ lead/.test(R("js/66-guided-call.js")));
  ok("⭐ the button is HIDDEN, not left inert", /b\.style\.display = fn \? "" : "none"/.test(RTC));
  ok("⭐ and render() applies it every time", /applyFab\(\)/.test(RTC) && /renderNav\(\); renderSubnav\(\); if\(typeof applyFab/.test(RTC));
  ok("⚠️ the inversion is explained so nobody restores the else", /SO THE RULE INVERTS/.test(RT));
}

/* pull FAB_ADD out of the routing module without booting the whole app */
function evalFab(tab) {
  const vm = require("vm");
  const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
  const start = RT.indexOf("const FAB_ADD = {");
  const end = RT.indexOf("if(typeof window!==\"undefined\"){ window.fabAction=fabAction;");
  vm.runInContext(RT.slice(start, end) + ";this.fabAction=fabAction;", ctx);
  return ctx.fabAction(tab);
}

console.log("\n--- ⛔ REPO-WIDE: no quote path may deduct a free allowance ---");
{
  /* ⚠️ THIS IS THE THIRD TIME THIS CLASS OF ERROR HAS BEEN CAUGHT — veg-is-free (corrected 2026-07-25), Dare's
     residential yard site that excludes contractor debris, and now the 500 lb C&D waiver. Every time, a rate
     sheet written for HOUSEHOLDS was read as if it applied to the business, and every time it under-costed
     real jobs in the customer's favour. A grep is a blunt guard, but this exact mistake keeps returning through
     a DIFFERENT file each time, so the guard is repo-wide rather than per-module. */
  const files = fs.readdirSync("js").filter(f => /\.js$/.test(f)).map(f => "js/" + f).concat(["cogs-payment-layer.js"]);
  const bad = [];
  files.forEach(f => {
    const code = CODE(R(f));
    if (/FREE_LBS/.test(code)) bad.push(f + ": a FREE_LBS constant");
    if (/-\s*(DEMO_FREE_LBS|DISPOSAL_FREE_LBS|QE\.FREE_LBS)/.test(code)) bad.push(f + ": subtracts a free allowance");
  });
  ok("⭐⭐ nothing in js/ carries a free-pound allowance any more", bad.length === 0, bad);

  const QEC = CODE(R("js/70-quote-engine.js"));
  ok("⭐ qeTipFee — the helper every estimator routes through — bills the whole weight",
    /function qeTipFee[\s\S]{0,240}Math\.max\(0, \+lbs \|\| 0\) \/ 2000 \* rate/.test(QEC));
  ok("⛔ ...and QE no longer exposes a free-pound constant to copy", !/FREE_LBS/.test(QEC));
  ok("⭐ the demolition estimator bills every pound too", !/DEMO_FREE_LBS/.test(CODE(R("js/30-demolition-estimator.js"))));
  ok("⭐ so does the COGS layer the wizard uses",
    !/DISPOSAL_FREE_LBS/.test(CODE(R("js/20-quote-wizard-configurable-sl.js"))));

  /* the crew quote on site FROM THE SOP TEXT — a wrong number there reaches a customer directly */
  const SOP = R("js/43-crew-sops.js");
  ok("⭐ the crew SOP no longer tells them 500 lb is free (or that veg is)",
    !/first 500 lb free/.test(SOP) && !/veg free/.test(SOP));
  ok("...and says plainly that the free allowances are residential", /free allowances are residential/.test(SOP));

  ok("⭐ CLAUDE.md records the correction, so the next pass doesn't re-derive the old rule",
    /EVERY POUND IS BILLABLE/.test(R("CLAUDE.md")) && /annual RESIDENTIAL/.test(R("CLAUDE.md")));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========");
if (fail) process.exit(1);
