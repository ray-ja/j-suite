/* clockin-runtime-tests.js — tcClockInWith is RUN, not read.

   ⚠️ WHY THIS FILE EXISTS. On 2026-08-19 Ray couldn't clock in on Jamieson. The cause:

       if (!jobId && !(opts && opts.noJob)) return { ok: false, error: "no-job" };

   The parameter is `args`. `opts` was never defined, so a jobless clock-in threw ReferenceError instead of
   checking the opt-in — and the ONLY path that reached it was the no-job path, which is the exact feature he
   had asked for. The clock-in button then sat at "Clocking in…" forever because nothing caught the throw.

   TWO of my own tests asserted that precise line as a REGEX OVER SOURCE TEXT and passed the whole time. A
   string match proves a line exists. It cannot prove the line runs. Anything that decides whether a record
   gets written needs to be EXECUTED by a test.

   So this harness loads js/38 into a sandbox with stubbed browser globals and actually calls the function.

   Pure node. Run: node clockin-runtime-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

/* ---- a sandbox just real enough to run the timeclock ---- */
function makeCtx(opts) {
  opts = opts || {};
  const store = { timeclock: [], jobs: opts.jobs || [], customers: opts.customers || [], properties: opts.properties || [], quotes: [] };
  const ctx = {
    console: console,
    Date: Date, Math: Math, JSON: JSON, Promise: Promise, Array: Array, Object: Object,
    String: String, Number: Number, parseFloat: parseFloat, parseInt: parseInt, isNaN: isNaN,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: () => 0, clearInterval: () => {},
    navigator: { geolocation: null },                 // no GPS in the harness → tcGetPos resolves null fast
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {},
                querySelector: () => null, querySelectorAll: () => [],
                createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
                body: { addEventListener: () => {} }, visibilityState: "visible" },
    alert: (m) => { ctx.__alerts.push(String(m)); },
    confirm: () => true,
    addEventListener: () => {}, removeEventListener: () => {},
    location: { origin: "http://localhost", href: "http://localhost/" },
    fetch: () => Promise.reject(new Error("no network in harness")),
    __alerts: [],
    /* app helpers the module leans on */
    D: () => store,
    uid: () => "id_" + (ctx.__n = (ctx.__n || 0) + 1),
    now: () => opts.now || 1755600000000,
    today: () => "2026-08-19",
    esc: (s) => String(s == null ? "" : s),
    money: (n) => "$" + (+n || 0).toFixed(2),
    fmtDate: (d) => String(d || ""),
    val: () => "",
    save: () => { ctx.__saved = (ctx.__saved || 0) + 1; },
    render: () => {},
    touch: (r) => { r.updatedAt = ctx.now(); },
    modal: () => {}, closeModal: () => {},
    curUser: () => ({ id: "u1", username: "Ray" }),
    userName: (id) => ({ u1: "Ray", u2: "Chase" }[id] || ""),
    custName: (id) => ((store.customers.find(c => c.id === id) || {}).name || "—"),
    isOwner: () => true,
    logChange: () => {},
    schedMembers: () => [{ id: "u1", username: "Ray" }]
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, "js", "38-timeclock.js"), "utf8");
  vm.runInContext(src, ctx, { filename: "js/38-timeclock.js" });
  ctx.__store = store;
  return ctx;
}

(async function main(){
  console.log("\n--- ⭐ the regression: clocking in with NO JOB ---");
  {
    const ctx = makeCtx();
    let res = null, threw = null;
    try { res = await (ctx.tcClockInWith({ noJob: true, role: "none" })); } catch (e) { threw = e; }
    ok("a jobless clock-in does NOT throw", !threw, threw && (threw.name + ": " + threw.message));
    ok("...and it succeeds", res && res.ok !== false, res);
    eq("...and a punch was actually written", ctx.__store.timeclock.length, 1);
    const e = ctx.__store.timeclock[0] || {};
    eq("...with no job attached", e.jobId || "", "");
    ok("...and it is open", e.clockOut === null, e.clockOut);
  }

  console.log("\n--- the guard still protects callers that DIDN'T opt in ---");
  {
    const ctx = makeCtx();
    let res = null, threw = null;
    try { res = await (ctx.tcClockInWith({ role: "none" })); } catch (e) { threw = e; }
    ok("no jobId and no opt-in does not throw either", !threw, threw && (threw.name + ": " + threw.message));
    ok("...it returns the no-job error", res && res.ok === false && res.error === "no-job", res);
    eq("...and writes NOTHING", ctx.__store.timeclock.length, 0);
  }

  console.log("\n--- a normal job clock-in still works (no regression) ---");
  {
    const ctx = makeCtx({ jobs: [{ id: "j1", title: "Deck rebuild", customerId: "c1", date: "2026-08-19", workDays: ["2026-08-19"] }],
                          customers: [{ id: "c1", name: "Mike Green" }] });
    let res = null, threw = null;
    try { res = await (ctx.tcClockInWith({ jobId: "j1", role: "none" })); } catch (e) { threw = e; }
    ok("does not throw", !threw, threw && (threw.name + ": " + threw.message));
    eq("a punch was written", ctx.__store.timeclock.length, 1);
    eq("...attached to the job", (ctx.__store.timeclock[0] || {}).jobId, "j1");
  }

  console.log("\n--- clocking in against a CUSTOMER (the thing this was all for) ---");
  {
    const ctx = makeCtx({ customers: [{ id: "c9", name: "Dave", company: "Jamieson Automation" }] });
    let threw = null;
    try { await (ctx.tcClockInWith({ noJob: true, customerId: "c9", workType: "Routine maintenance", role: "none" })); }
    catch (e) { threw = e; }
    ok("does not throw", !threw, threw && (threw.name + ": " + threw.message));
    const e = ctx.__store.timeclock[0] || {};
    eq("the customer is on the punch", e.customerId, "c9");
    eq("the work type is on the punch", e.workType, "Routine maintenance");
    eq("the label names the customer", ctx.tcEntryLabel(e), "Dave · Routine maintenance");
  }

  console.log("\n--- an already-open shift is refused, not duplicated ---");
  {
    const ctx = makeCtx();
    await (ctx.tcClockInWith({ noJob: true, role: "none" }));
    const res = await (ctx.tcClockInWith({ noJob: true, role: "none" }));
    ok("second clock-in is refused", res && res.ok === false, res);
    eq("...and no second punch exists", ctx.__store.timeclock.length, 1);
  }

  console.log("\n--- the driver guard still blocks a vehicle-less driver shift ---");
  {
    const ctx = makeCtx();
    const res = await (ctx.tcClockInWith({ noJob: true, role: "driver", veh: { vehicleId: null, vehicleOwnerId: null, vehicle: "" } }));
    ok("refused", res && res.ok === false && res.error === "no-vehicle", res);
    eq("nothing written", ctx.__store.timeclock.length, 0);
  }

  /* ---- source-level checks that are genuinely about SOURCE, not behaviour ---- */
  console.log("\n--- the UI can't wedge on a failure ---");
  {
    const TC = fs.readFileSync(path.join(__dirname, "js", "38-timeclock.js"), "utf8");
    ok("the clock-in button is restored in a finally", /finally \{[\s\S]{0,120}btn\.disabled = false/.test(TC));
    ok("a throw inside the core is caught", /catch \(err\) \{[\s\S]{0,120}error: "crashed"/.test(TC));
    ok("the user is told WHY instead of nothing happening", /Something went wrong clocking in/.test(TC));
    ok("the dead-button lesson is recorded", /a dead button teaches you the app is broken/.test(TC));
    ok("the opts\/args bug is recorded so it isn't reintroduced", /the parameter is `args`/.test(TC));
    ok("...including why the old tests missed it", /cannot catch a runtime error/.test(TC));
  }

  console.log("\n--- editing the start time is reachable ON AN OPEN SHIFT ---");
  {
    const TC = fs.readFileSync(path.join(__dirname, "js", "38-timeclock.js"), "utf8");
    ok("the open-shift card offers it", /Started earlier\? Fix the time/.test(TC));
    ok("...wired to the punch editor", /onclick="tcEditPunch\('\$\{e\.id\}'\)"/.test(TC));
    ok("an open shift stays open when clock-out is left blank", /still open — leave blank to keep it open/.test(TC));
    ok("the reason it was unreachable is recorded", /only\s*\n?\s*reachable from a CLOSED shift/.test(TC) || /reachable from a CLOSED shift/.test(TC));
  }

  console.log("\n--- the customer list shows the BUSINESS, not just a contact ---");
  {
    const ctx = makeCtx({
      customers: [{ id: "c1", name: "Dave", company: "Jamieson Automation" },
                  { id: "c2", name: "Mike Green" },
                  { id: "c3", company: "Twiddy" }],
      properties: [{ id: "p1", customerId: "c1", label: "Sound Side Office" },
                   { id: "p2", customerId: "c3", address: "1 Ocean Blvd" },
                   { id: "p3", customerId: "c3", address: "2 Ocean Blvd" }]
    });
    const html = ctx.tcNoJobBoxHTML("");
    ok("company leads, contact follows", /Jamieson Automation · Dave/.test(html), html.slice(0, 400));
    ok("a single property is appended", /Sound Side Office/.test(html));
    ok("a contact-only customer still shows", /Mike Green/.test(html));
    ok("a company-only customer still shows", /Twiddy/.test(html));
    ok("multiple properties are counted, not listed", /\(2 properties\)/.test(html));
    ok("picking a job hides the box entirely", ctx.tcNoJobBoxHTML("j1").indexOf("tc_cust") < 0);
  }

  console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
    process.exit(fail ? 1 : 0);

})();
