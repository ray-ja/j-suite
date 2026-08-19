/* clockin-customer-tests.js — clocking in WITHOUT a job, and against a CUSTOMER.

   Ray, 2026-08-14, after trying it in the field:
     "I wanna be able to clock in without assigning a specific job. Sometimes it's just, like, routine stuff,
      routine maintenance kind of things… but the most important thing is that I can select a customer to
      clock into."

   ⭐ THE BUG HE ACTUALLY HIT: tcClockInFormHTML() returned "" when there were no OPEN JOBS, and both callers
   then rendered "No open jobs to clock in against — schedule a job first." The escape hatch ("Just track
   time") lived INSIDE that form, so the one option that applied to routine work vanished precisely when it
   was the only one that applied. The first suite below is the regression guard for that.

   Pure node. Run: node clockin-customer-tests.js */
const fs = require("fs"), path = require("path");
const hx = require("./js/128-hours-export.js");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const TC = fs.readFileSync(path.join(__dirname, "js", "38-timeclock.js"), "utf8");
const TD = fs.readFileSync(path.join(__dirname, "js", "05-today.js"), "utf8");
const HX = fs.readFileSync(path.join(__dirname, "js", "128-hours-export.js"), "utf8");

console.log("\n--- ⭐ no open jobs must never be a dead end ---");
ok("the form no longer bails out when there are no open jobs", !/if \(!jobs\.length\) return "";/.test(TC));
ok("...and the reason it used to is recorded so it isn't reintroduced", /vanished exactly when it was the only thing that applied/.test(TC));
ok("with no jobs it opens on 'no specific job'", /jobId = jobs\.length \? \(mine\[0\] \|\| jobs\[0\]\)\.id : "";/.test(TC));
ok("'no specific job' is a real option in the picker", /— No specific job —/.test(TC));
ok("the Time tab's 'schedule a job first' message is gone", !/No open jobs to clock in against/.test(TC));
ok("Today's 'no open jobs yet' message is gone", !/No open jobs yet/.test(TD));
ok("the remaining fallbacks don't blame the schedule", /couldn't be built/.test(TC) && /couldn't be built/.test(TD));
/* the markup, not the phrase — the phrase still appears in the comment explaining the removal */
ok("the old separate no-job BUTTON is gone (the picker supersedes it)", !/onclick="tcClockInNoJob\(\)"/.test(TC));
ok("...but the programmatic entry point survives", /tcClockInNoJob/.test(TC));

console.log("\n--- ⭐ clocking in against a customer ---");
ok("the entry carries a customerId", /customerId: args\.customerId \|\| ""/.test(TC));
ok("...and a work type", /workType: args\.workType \|\| ""/.test(TC));
ok("the customer picker exists", /id="tc_cust"/.test(TC));
ok("the work-type picker exists", /id="tc_worktype"/.test(TC));
ok("both are optional — clocking in never blocks", /— None \(just my time\) —/.test(TC) && /— Not set —/.test(TC));
ok("the form reads them on clock-in", /val\("tc_cust"\)/.test(TC) && /val\("tc_worktype"\)/.test(TC));
ok("they are passed through to the entry", /customerId: _cust, workType: _wt/.test(TC));
ok("the last customer is remembered for next time", /localStorage\.setItem\("tc_last_cust"/.test(TC));
ok("routine categories are presets, not free-for-all", /TC_WORK_TYPES/.test(TC) && /Routine maintenance/.test(TC));
ok("Ray's own words are recorded as the source of the category idea", /permanent broad category/.test(TC));

console.log("\n--- the customer box appears only when there's no job ---");
ok("picking a job swaps the box out", /const nj = document\.getElementById\("tc_nojob_box"\)/.test(TC));
ok("a job renders an EMPTY box (no second source of truth)", /if \(jobId\) return `<div id="tc_nojob_box"><\/div>`/.test(TC));
ok("...and the reason is recorded", /asking again would\s*\n?\s*(be a second source of truth|.*second source of truth)/.test(TC) || /second source of truth/.test(TC));
ok("deleted customers aren't offered", /filter\(c => c && !c\.deleted\)/.test(TC));
ok("customers are listed alphabetically", /localeCompare/.test(TC.slice(TC.indexOf("function tcNoJobBoxHTML"))));

console.log("\n--- the guard still protects programmatic callers ---");
/* ⚠️ this used to assert the guard as a REGEX OVER SOURCE, matching `opts.noJob` — a variable that did not
   exist. It passed for six days while a jobless clock-in threw ReferenceError in the field. The BEHAVIOUR is
   now covered by clockin-runtime-tests.js, which calls the function; this only checks the arg name is right. */
ok("the jobless guard reads its own parameter, not a phantom one", /if \(!jobId && !\(args && args\.noJob\)\)/.test(TC) && !/opts && opts\.noJob/.test(TC));
ok("the form opts in only when there is genuinely no job", /noJob: !jobId, jobId: jobId/.test(TC));

console.log("\n--- a shift is labelled by what it was actually for ---");
{
  /* exercise tcEntryLabel with the real function, stubbing only its two lookups */
  const vm = require("vm");
  const ctx = {
    tcJob: id => (id === "j1" ? { id: "j1", title: "Deck rebuild", customerId: "c9" } : null),
    custName: id => ({ c1: "Mike Green", c9: "Ann Reed" }[id] || "—")
  };
  vm.createContext(ctx);
  vm.runInContext(
    'function tcJobTitle(id){const j=tcJob(id);return j?(j.title||"Job"):"—";}'
    + (TC.match(/function tcEntryLabel\(e\) \{[\s\S]*?\n\}/) || [""])[0]
    + (TC.match(/function tcEntryCustomerId\(e\) \{[\s\S]*?\n\}/) || [""])[0]
    + ";this.L=tcEntryLabel;this.C=tcEntryCustomerId;", ctx);

  eq("a job shift shows the job", ctx.L({ jobId: "j1" }), "Deck rebuild");
  eq("a customer shift shows customer + work type", ctx.L({ jobId: "", customerId: "c1", workType: "Routine maintenance" }), "Mike Green · Routine maintenance");
  eq("a customer with no type shows just the customer", ctx.L({ jobId: "", customerId: "c1" }), "Mike Green");
  eq("a type with no customer shows the type", ctx.L({ jobId: "", workType: "Shop / yard work" }), "Shop / yard work");
  eq("neither is 'Time only', not a dash", ctx.L({ jobId: "" }), "Time only");
  eq("a null entry is safe", ctx.L(null), "—");
  eq("an unknown customer doesn't render a bare dash", ctx.L({ jobId: "", customerId: "gone", workType: "Admin" }), "Admin");

  eq("the customer comes off the job when there is one", ctx.C({ jobId: "j1" }), "c9");
  eq("...and directly when there isn't", ctx.C({ jobId: "", customerId: "c1" }), "c1");
  eq("an explicit customer wins over the job's", ctx.C({ jobId: "j1", customerId: "c1" }), "c1");
  eq("nothing yields nothing", ctx.C({ jobId: "" }), "");
}
/* outside tcEntryLabel itself — the one inside it is the recursion base case, and a blunt "zero occurrences"
   assertion would push someone into breaking that. (An earlier bulk swap DID rewrite that line into a
   self-call; this suite caught it, which is why the base case is asserted separately below.) */
{
  const withoutDef = TC.replace(/function tcEntryLabel\(e\) \{[\s\S]*?\n\}/, "");
  ok("display sites use the label, not the job title", !/tcJobTitle\(e\.jobId\)/.test(withoutDef));
  ok("tcEntryLabel's base case calls tcJobTitle, not itself (no infinite recursion)",
    /if \(e\.jobId\) return tcJobTitle\(e\.jobId\);/.test(TC));
}
ok("the clock-in log line names what it was for", /"Clocked in — " \+ tcEntryLabel\(e\)/.test(TC));
ok("job-specific call sites still say 'the job'", /tcJobTitle\(newJobId\)/.test(TC));

console.log("\n--- the report groups routine work by customer, not into one nameless bucket ---");
ok("the grouping key falls back to the customer", /e\.jobId \? e\.jobId : \(e\.customerId \? "cust:" \+ e\.customerId : "none"\)/.test(TC));
ok("a customer bucket is titled with the customer", /custName\(jid\.slice\(5\)\) \+ " · no job"/.test(TC));
ok("the leftover bucket is named honestly", /Time only \(no job\)/.test(TC));
ok("the reason for not keying on jobId alone is recorded", /collapsed every\s*\n?\s*no-job shift into one nameless/.test(TC) || /one nameless/.test(TC));

console.log("\n--- it survives the CSV export ---");
{
  global.tcEntryCustomerId = e => e.customerId || "";
  global.custName = id => ({ c1: "Mike Green" }[id] || "");
  const rows = hx.hxRows([
    { id: "e1", userId: "u1", userName: "Ray", jobId: "", customerId: "c1", workType: "Routine maintenance",
      clockIn: new Date(2026, 7, 14, 9).getTime(), clockOut: new Date(2026, 7, 14, 12).getTime() },
    { id: "e2", userId: "u1", userName: "Ray", jobId: "", clockIn: new Date(2026, 7, 14, 13).getTime(), clockOut: new Date(2026, 7, 14, 14).getTime() }
  ]);
  eq("the work type lands in the Job column", rows[0].Job, "Routine maintenance");
  eq("the customer lands in the Customer column", rows[0].Customer, "Mike Green");
  eq("hours are still right", rows[0].Hours, "3.00");
  eq("a shift with neither still says so", rows[1].Job, "(no job — time only)");
  eq("...with no customer", rows[1].Customer, "");
  ok("the CSV carries it end to end", hx.hxBuildCSV(rows).indexOf("Mike Green") > 0);
  delete global.tcEntryCustomerId; delete global.custName;
}
ok("the export explains why a no-job shift isn't anonymous", /no longer anonymous/.test(HX));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
