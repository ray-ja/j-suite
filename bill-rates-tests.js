/* bill-rates-tests.js — the variable rate card (js/136).

   Ray, 2026-08-21: "Jamieson Automation is not always $125 an hour. In fact, all the escape room work is
   locked in at $55 per hour… there's emergency rates, there's overtime, there's holiday stuff. So it needs
   to be malleable."

   ⭐ THE TEST THAT MATTERS is that a MULTIPLIER composes with whichever base won. Emergency at the escape
   room must be their $55 × 1.5 = $82.50 without anyone creating an "escape room emergency" record. If that
   ever stops holding, the card degrades into N customers × M situations and stops being malleable at all.

   ⚠️ SECOND: a shift stores its OWN resolved numbers. Raising a rate must never re-price work already done.

   Every resolver function is CALLED, not regex-matched — the lesson from the opts/args crash on 2026-08-19.

   Pure node. Run: node bill-rates-tests.js */
const fs = require("fs"), path = require("path");
const br = require("./js/136-bill-rates.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const TC = fs.readFileSync(path.join(__dirname, "js", "38-timeclock.js"), "utf8");
const ST = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
const SV = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
const BR = fs.readFileSync(path.join(__dirname, "js", "136-bill-rates.js"), "utf8");

/* Ray's actual rate card */
const BASES = [
  { id: "b_std",  kind: "base", name: "Standard",     value: 125, customerId: "" },
  { id: "b_esc",  kind: "base", name: "Escape room",  value: 55,  customerId: "c_escape" }
];
const MODS = [
  { id: "m_std",  kind: "mod", name: "Standard",  value: 1,   isDefault: true },
  { id: "m_ot",   kind: "mod", name: "Overtime",  value: 1.5 },
  { id: "m_emer", kind: "mod", name: "Emergency", value: 1.5 },
  { id: "m_hol",  kind: "mod", name: "Holiday",   value: 2 },
  { id: "m_call", kind: "mod", name: "Call-out",  value: 200, flat: true }
];

console.log("\n--- ⭐ a contract rate wins, and modifiers compose with it ---");
{
  eq("a normal Jamieson hour is the standard rate", br.brResolve(BASES, MODS, "c_other", "m_std").rate, 125);
  eq("the escape room is locked at their contract rate", br.brResolve(BASES, MODS, "c_escape", "m_std").rate, 55);
  eq("⭐ emergency AT the escape room is 55 × 1.5, with no bespoke record", br.brResolve(BASES, MODS, "c_escape", "m_emer").rate, 82.5);
  eq("emergency anywhere else is 125 × 1.5", br.brResolve(BASES, MODS, "c_other", "m_emer").rate, 187.5);
  eq("holiday at the escape room is 55 × 2", br.brResolve(BASES, MODS, "c_escape", "m_hol").rate, 110);
  eq("overtime on standard is 187.50", br.brResolve(BASES, MODS, "", "m_ot").rate, 187.5);
  ok("a contract rate is flagged as one", br.brResolve(BASES, MODS, "c_escape", "m_std").contract === true);
  ok("...and the standard rate is not", br.brResolve(BASES, MODS, "c_other", "m_std").contract === false);
  eq("the label names which situation applied", br.brResolve(BASES, MODS, "c_escape", "m_emer").modName, "Emergency");
  eq("...and which base won", br.brResolve(BASES, MODS, "c_escape", "m_emer").baseName, "Escape room");
}

console.log("\n--- a flat override ignores the base entirely ---");
{
  const r = br.brResolve(BASES, MODS, "c_escape", "m_call");
  eq("a $200 call-out is $200 even at the escape room", r.rate, 200);
  ok("...and is marked flat", r.flat === true);
  eq("...with no multiplier applied", r.mult, 0);
}

console.log("\n--- sensible behaviour when the card is incomplete ---");
{
  eq("no modifier chosen falls back to the default one", br.brResolve(BASES, MODS, "", "").modId, "m_std");
  eq("an unknown modifier id falls back too", br.brResolve(BASES, MODS, "", "nope").modId, "m_std");
  eq("an unknown customer falls back to the standard rate", br.brResolve(BASES, MODS, "nobody", "m_std").rate, 125);
  const noBase = br.brResolve([], MODS, "", "m_std");
  eq("no base rate at all yields $0, never a guess", noBase.rate, 0);
  ok("...and says so, so the UI can warn", noBase.missing === true);
  ok("a flat override still works with no base", br.brResolve([], MODS, "", "m_call").rate === 200 && br.brResolve([], MODS, "", "m_call").missing === false);
  eq("no modifiers at all is safe", br.brResolve(BASES, [], "", "").rate, 125);
  eq("nothing at all is safe", br.brResolve([], [], "", "").rate, 0);
  eq("a negative rate is floored at zero", br.brResolve([{ id: "x", customerId: "", value: -50 }], MODS, "", "m_std").rate, 0);
}

console.log("\n--- ⚠️ a shift keeps the rate it was clocked at ---");
{
  const H = 3600000;
  const shift = { clockIn: 0, clockOut: 3 * H, billRate: 82.5, billBase: 55, billMult: 1.5, billRateName: "Emergency" };
  eq("3 hours at 82.50 is 247.50", br.brShiftAmount(shift), 247.5);
  eq("the label shows the rate", br.brShiftLabel(shift).indexOf("$82.50/hr"), 0);
  ok("...names the situation", /Emergency/.test(br.brShiftLabel(shift)));
  ok("...and shows the maths", /55 × 1\.5/.test(br.brShiftLabel(shift)), br.brShiftLabel(shift));
  eq("an open shift bills nothing yet", br.brShiftAmount({ clockIn: 0, clockOut: null, billRate: 125 }), 0);
  eq("a shift with no rate bills nothing", br.brShiftAmount({ clockIn: 0, clockOut: 3 * H }), 0);
  eq("...and shows no rate label", br.brShiftLabel({ clockIn: 0, clockOut: 3 * H }), "");
  eq("a null shift is safe", br.brShiftAmount(null), 0);
  eq("a plain standard shift doesn't clutter the label", br.brShiftLabel({ clockIn: 0, clockOut: H, billRate: 125, billMult: 1, billRateName: "Standard" }), "$125.00/hr");
  eq("half an hour at 125 is 62.50", br.brShiftAmount({ clockIn: 0, clockOut: H / 2, billRate: 125 }), 62.5);
}

console.log("\n--- the starter card seeds situations but NEVER a dollar figure ---");
ok("Standard, Overtime, Emergency and Holiday are seeded", br.BR_SEED.length === 4);
ok("...all of them modifiers", br.BR_SEED.every(s => s.kind === "mod"));
ok("...with Standard as the default", br.BR_SEED.filter(s => s.isDefault).length === 1 && br.BR_SEED.find(s => s.isDefault).name === "Standard");
ok("NO base rate is invented", !br.BR_SEED.some(s => s.kind === "base"));
ok("...and the reason is recorded", /inventing a dollar figure would be worse than\s*\n?\s*having none/.test(BR) || /worse than/.test(BR));

console.log("\n--- wired end to end ---");
ok("billRates is in blank()", /billRates:\[\]/.test(ST));
ok("...backfilled on every org slab", (ST.match(/S\[b\]\.billRates/g) || []).length >= 2);
/* ⚠️ THIRD TIME. shiftNotes, then reminders, now billRates — each asserted it was the LAST entry in
   COLLECTIONS and each went red the moment the next collection was appended. MEMBERSHIP, never position. */
ok("...and in the server COLLECTIONS", /const COLLECTIONS = \[[^\]]*"billRates"/.test(SV));
ok("the clock-in form offers the rate picker", /brPickerHTML\(tcFormCustomerId\(jobId\)/.test(TC));
ok("the chosen rate is read at clock-in", /val\("tc_rate"\)/.test(TC));
ok("...passed to the core", /rateModId: _modId/.test(TC));
ok("⚠️ the RESOLVED rate is stamped on the punch, not looked up later", /billRate: r\.rate, billBase: r\.base, billMult: r\.mult/.test(TC));
ok("...and the reason is recorded", /never a retroactive price list/.test(TC));
ok("a job's customer drives the rate without being picked", /function tcFormCustomerId/.test(TC));
ok("the timesheet shows the rate per shift", /brShiftLabel\(e\)/.test(TC));
ok("...and what it earned", /brShiftAmount\(e\)/.test(TC));
ok("the report totals what's billable", /💵 Billable/.test(TC));
ok("...and flags shifts carrying no rate", /with no rate/.test(TC));
ok("...but stays hidden when nothing is billable (OBX quotes flat)", /_billed\.length && typeof brShiftAmount/.test(TC));
ok("the rate card editor is on the Time tab", /brCardHTML\(\)/.test(TC));
ok("everything degrades if js/136 is absent", /typeof brPickerHTML==="function"/.test(TC) && /typeof brShiftLabel==="function"/.test(TC));
ok("js/136 is registered in the shell", fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/136-bill-rates.js"') > 0);
ok("the editor warns that edits only affect NEW shifts", /only affects <b>new<\/b> shifts/.test(BR));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
