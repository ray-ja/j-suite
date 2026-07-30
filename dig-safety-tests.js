/* dig-safety-tests.js — js/120 machine rental + NC811 locate flag.
   Pure node, no DOM. Run: node dig-safety-tests.js */
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

const M = require(path.join(__dirname, "js", "120-dig-safety.js"));

console.log("\n--- NC811: 3 full working days, day of call excluded, weekends skipped ---");
/* Mon 2026-07-27 -> Tue/Wed/Thu are the 3 working days -> clear Fri 2026-07-31 */
eq("called Mon -> clear Fri", M.dig811ClearDate("2026-07-27"), "2026-07-31");
/* Wed 2026-07-29 -> Thu, Fri, (skip Sat+Sun), Mon -> clear Tue 2026-08-04 */
eq("called Wed -> clear next Tue (weekend skipped)", M.dig811ClearDate("2026-07-29"), "2026-08-04");
/* Fri 2026-07-31 -> Mon, Tue, Wed -> clear Thu 2026-08-06 */
eq("called Fri -> clear Thu", M.dig811ClearDate("2026-07-31"), "2026-08-06");
/* Sat 2026-08-01 -> Mon, Tue, Wed -> clear Thu 2026-08-06 (same as Friday) */
eq("called Sat -> clear Thu", M.dig811ClearDate("2026-08-01"), "2026-08-06");
eq("garbage date -> empty", M.dig811ClearDate("nope"), "");
eq("empty -> empty", M.dig811ClearDate(""), "");

console.log("\n--- weekday helper ---");
ok("Sat is not a working day", !M.digIsWorkDay(Date.UTC(2026, 7, 1)));
ok("Sun is not a working day", !M.digIsWorkDay(Date.UTC(2026, 7, 2)));
ok("Mon is a working day", M.digIsWorkDay(Date.UTC(2026, 7, 3)));
ok("Fri is a working day", M.digIsWorkDay(Date.UTC(2026, 6, 31)));

console.log("\n--- ticket life: 28 calendar days from work start, re-notify by day 25 ---");
eq("good thru = start + 28 cal days", M.dig811GoodThru("2026-08-03"), "2026-08-31");
eq("renew by = start + 25 cal days", M.dig811RenewBy("2026-08-03"), "2026-08-28");
eq("good thru spans a month boundary", M.dig811GoodThru("2026-07-27"), "2026-08-24");

console.log("\n--- which work is a digging job ---");
const digQ = { items: [{ name: "Stepping-stone path", bandKey: "steppath" }] };
const pavQ = { items: [{ name: "Patio", bandKey: "paver" }] };
const fdQ = { items: [{ name: "French drain", bandKey: "frenchdrain" }] };
const brushQ = { items: [{ name: "Brush removal", bandKey: "brush" }] };
const lscQ = { items: [{ name: "Landscaping", bandKey: "landscape" }] };
ok("steppath is digging", M.digIsDigQuote(digQ));
ok("paver is digging", M.digIsDigQuote(pavQ));
ok("frenchdrain is digging", M.digIsDigQuote(fdQ));
ok("brush is NOT digging", !M.digIsDigQuote(brushQ));
ok("landscape is NOT digging", !M.digIsDigQuote(lscQ));
ok("empty quote is NOT digging", !M.digIsDigQuote({ items: [] }));
ok("null is NOT digging", !M.digIsDigQuote(null));
ok("a materials pickup line alone is NOT digging",
  !M.digIsDigQuote({ items: [{ name: "Materials pickup", bandKey: "steppath", _pickup: true }] }));
ok("dig line + pickup line IS digging",
  M.digIsDigQuote({ items: [{ bandKey: "steppath", _pickup: true }, { bandKey: "steppath" }] }));

console.log("\n--- machine rental cost ---");
eq("no days priced -> $0", M.digRentCost({ items: [], digRentDays: 0 }), 0);
eq("default machine is the mini skid steer", M.digMachine().key, "miniskid");
eq("mini skid default day rate", M.digRentRate({}), 350);
eq("mini excavator day rate", M.digRentRate({ digRentKind: "miniex" }), 375);
eq("3 days on the default rate", M.digRentCost({ digRentDays: 3 }), 1050);
eq("explicit rate wins over the default", M.digRentCost({ digRentDays: 2, digRentRate: 400 }), 800);
eq("unknown machine falls back to the first", M.digMachine("bulldozer").key, "miniskid");
eq("negative days floor at 0", M.digRentDays({ digRentDays: -5 }), 0);

console.log("\n--- the flag Ray asked for: a digging quote with no machine priced in ---");
ok("steppath with 0 rental days is FLAGGED", M.digRentMissing(digQ));
ok("steppath with 2 rental days is NOT flagged", !M.digRentMissing(Object.assign({ digRentDays: 2 }, digQ)));
ok("brush job is never flagged (not digging)", !M.digRentMissing(brushQ));

console.log("\n--- job locate status ---");
/* dig811Status needs digIsDigJob, which needs depQuoteFor/D() in the browser. Feed it a job that
   already carries locate fields so the pure date logic is exercised without the app globals. */
const jobCalled = { id: "j1", d811CalledDate: "2026-07-27", d811Ticket: "A123", d811StartDate: "2026-07-31" };
eq("before the clear date -> waiting", M.dig811Status(jobCalled, "2026-07-29").state, "waiting");
eq("on the clear date -> clear", M.dig811Status(jobCalled, "2026-07-31").state, "clear");
eq("day 24 -> still clear", M.dig811Status(jobCalled, "2026-08-24").state, "clear");
eq("day 25 -> renew", M.dig811Status(jobCalled, "2026-08-25").state, "renew");
eq("day 28 -> renew (still legal)", M.dig811Status(jobCalled, "2026-08-28").state, "renew");
eq("day 29 -> expired", M.dig811Status(jobCalled, "2026-08-29").state, "expired");
const jobNoCall = { id: "j2", d811Ticket: "", d811CalledDate: "" };
jobNoCall.d811Ticket = "PENDING";   // marks it a dig job without a call logged
eq("dig job with no call date -> none", M.dig811Status(jobNoCall, "2026-07-27").state, "none");
eq("non-dig job -> n/a", M.dig811Status({ id: "j3" }, "2026-07-27").state, "n/a");
const st = M.dig811Status(jobCalled, "2026-07-29");
eq("status carries the ticket number", st.ticket, "A123");
eq("status carries the clear date", st.clear, "2026-07-31");
eq("status carries good-thru", st.goodThru, "2026-08-28");

console.log("\n--- the module must not need a DOM ---");
ok("loaded under node with no window", typeof M.dig811Status === "function");
const src = fs.readFileSync(path.join(__dirname, "js", "120-dig-safety.js"), "utf8");
ok("no unguarded top-level window assignment", !/^window\./m.test(src));
/* the real check: run it in a bare context with NO window/document at all and use it */
const vm = require("vm");
const bare = { module: { exports: {} }, Date: Date, Math: Math, String: String, Array: Array, Number: Number, RegExp: RegExp, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, JSON: JSON };
bare.exports = bare.module.exports;
let bareOk = true, bareErr = "";
try {
  vm.createContext(bare);
  vm.runInContext(src, bare);
  const B = bare.module.exports;
  if (B.dig811ClearDate("2026-07-27") !== "2026-07-31") { bareOk = false; bareErr = "wrong date in bare ctx"; }
  if (B.digRentCost({ digRentDays: 2 }) !== 700) { bareOk = false; bareErr = "wrong cost in bare ctx"; }
} catch (e) { bareOk = false; bareErr = e.message; }
ok("runs with no window/document at all", bareOk, bareErr);

console.log("\n--- js/42: veg disposal is no longer free ---");
const b = fs.readFileSync(path.join(__dirname, "js", "42-brush-removal.js"), "utf8");
ok("no 'disposal is $0' claim left", !/disposal is \$0/.test(b));
ok("no '$0 dump' claim left", !/\$0 dump/.test(b));
ok("no 'hauls free' customer script left", !/hauls free/.test(b));
ok("cost now includes a veg tip fee", /qeTipFee\(vegLbs\s*,\s*"veg"\)/.test(b));
ok("has a weight override input", /brushVegLbs/.test(b));

console.log("\n--- shell registration ---");
const shell = fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8");
ok("js/120 registered in the shell", shell.indexOf('src="js/120-dig-safety.js"') > 0);
const wiz = fs.readFileSync(path.join(__dirname, "js", "23-guided-quote-wizard.js"), "utf8");
eq("rental folded into hard cost in both places", (wiz.match(/digRentCostWZ\(\)/g) || []).length, 2);
ok("dig fields persisted on save", /digRentKind:WZ\.digRentKind/.test(wiz));
ok("dig fields reloaded on open", /WZ\.digRentKind=q\.digRentKind/.test(wiz));
ok("review shows the control", /digWizControlHTML/.test(wiz));
const jp = fs.readFileSync(path.join(__dirname, "js", "61-job-page.js"), "utf8");
ok("811 card on the job page", /dig811CardHTML/.test(jp));

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
