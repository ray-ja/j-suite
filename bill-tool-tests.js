/* bill-tool-tests.js — Cap can add a bill, and a bill's frequency finally means something.

   Ray, 2026-08-25: "i ower 736.24 to JT Jones Propane for our home propane, add that to bills" — and the box
   answered "I can't edit your bills list directly." It was telling the truth: there was no tool.

   THREE THINGS THIS DEFENDS:

   1. ⭐ ONE-TIME IS THE DEFAULT for a named amount owed. A propane delivery filed as a monthly bill would
      claim $736.24 of his money every month forever, in the money card he reads each morning. That is the
      kind of wrong number that changes what a person believes about their own finances.

   2. ⚠️ AN UNDATED DEBT DEFAULTS TO TODAY. My first clamp dropped a one-time bill with no date — and his
      actual sentence has no date in it. Worse, the model had emitted nothing but the tool call, so dropping
      it left him staring at "No response." Verified against the live API before and after.

   3. ⚠️ FREQUENCY WAS DECORATION. calBillsOnDay matched dueDay alone, so quarterly and annual bills appeared
      EVERY month — including the Polk County property tax sitting in his real store.

   Pure node. Run: node bill-tool-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const srv = require("./sync-server.js");
const HOME = R("js/122-personal-home.js"), CAL = R("js/126-calendar.js"), BUD = R("js/79-budget.js"), MSG = R("js/47-messages.js"), CSS = R("app.css");
const TODAY = "2026-08-25";
const ctx = { todayIso: TODAY, personal: true, jobIds: [], cats: [] };
const bill = (input) => srv.capParsePersonalAction("addBill", input, ctx);

console.log("\n--- ⭐ the tool exists at all ---");
{
  const names = srv.PERSONAL_TOOLS.map(t => t.name);
  ok("addBill is one of the personal tools", names.indexOf("addBill") >= 0, names);
  const t = srv.PERSONAL_TOOLS.find(x => x.name === "addBill");
  ok("...with a strict schema, so the model can't send a shape we didn't plan for", t.strict === true);
  ok("...that forbids extra properties", t.input_schema.additionalProperties === false);
  ok("⭐ the description tells it a one-off owed amount is NOT recurring", /one-off amount owed[\s\S]*recurring=false/i.test(t.description));
  ok("⛔ ...and that an already-paid thing is an expense, not a bill", /already paid/i.test(t.description));
  ok("...and what to do when he names no date", /never says when/i.test(t.description));
}

console.log("\n--- ⭐ HIS SENTENCE: a debt with no date named ---");
{
  const a = bill({ name: "JT Jones Propane", amount: 736.24, recurring: false, date: null, dayOfMonth: null });
  ok("⭐ it is NOT dropped", !!a, a);
  eq("...the payee survives", a.name, "JT Jones Propane");
  eq("...the amount survives to the cent", a.amount, 736.24);
  eq("⭐ ...it is ONE-TIME, not a monthly claim on his money", a.recurring, false);
  eq("⭐ ...and it falls due today, because that is what owing something means", a.date, TODAY);
  eq("...with no day-of-month, which would be meaningless", a.dayOfMonth, null);

  /* ⚠️ without a today to fall back on there is genuinely no date, and a dateless one-time bill would show
     on no screen at all — so it is still dropped rather than invented */
  ok("⛔ with no context date at all it is still refused, not guessed",
    srv.capParsePersonalAction("addBill", { name: "X", amount: 10, recurring: false, date: null, dayOfMonth: null }) === null);
}

console.log("\n--- a genuinely recurring bill ---");
{
  const a = bill({ name: "Internet", amount: 89, recurring: true, date: null, dayOfMonth: 14 });
  eq("it repeats", a.recurring, true);
  eq("...on the day he said", a.dayOfMonth, 14);
  eq("...and carries no one-off date", a.date, null);
  eq("a day past 28 is pulled back, so it can't vanish in February", bill({ name: "R", amount: 1, recurring: true, date: null, dayOfMonth: 31 }).dayOfMonth, 28);
  eq("a nonsense day becomes the 1st", bill({ name: "R", amount: 1, recurring: true, date: null, dayOfMonth: 0 }).dayOfMonth, 1);
  eq("a missing day becomes the 1st", bill({ name: "R", amount: 1, recurring: true, date: null, dayOfMonth: null }).dayOfMonth, 1);
}

console.log("\n--- ⚠️ this one touches his money, so the clamps are real ---");
{
  ok("⛔ no name → dropped", bill({ name: "", amount: 10, recurring: false, date: TODAY, dayOfMonth: null }) === null);
  ok("⛔ no amount → dropped", bill({ name: "X", amount: 0, recurring: false, date: TODAY, dayOfMonth: null }) === null);
  ok("⛔ a negative amount → dropped", bill({ name: "X", amount: -50, recurring: false, date: TODAY, dayOfMonth: null }) === null);
  ok("⛔ an absurd amount → dropped", bill({ name: "X", amount: 9e9, recurring: false, date: TODAY, dayOfMonth: null }) === null);
  ok("⛔ a non-number amount → dropped", bill({ name: "X", amount: "736.24", recurring: false, date: TODAY, dayOfMonth: null }) === null);
  ok("⛔ NaN / Infinity → dropped", bill({ name: "X", amount: Infinity, recurring: false, date: TODAY, dayOfMonth: null }) === null);
  ok("⛔ a malformed date → dropped back to today, never passed through", bill({ name: "X", amount: 10, recurring: false, date: "next tuesday", dayOfMonth: null }).date === TODAY);
  eq("cents are rounded, never left as float noise", bill({ name: "X", amount: 10.005999, recurring: false, date: TODAY, dayOfMonth: null }).amount, 10.01);
  eq("a very long payee is truncated, not rejected", bill({ name: "z".repeat(400), amount: 1, recurring: false, date: TODAY, dayOfMonth: null }).name.length, 80);
  ok("⛔ an unknown tool name is still dropped", srv.capParsePersonalAction("deleteEverything", { x: 1 }, ctx) === null);
  ok("⛔ garbage input doesn't throw", bill(null) === null && bill([1, 2]) === null);
}

console.log("\n--- ⚠️ frequency is not decoration: when a bill actually lands ---");
{
  const sandbox = (bills) => {
    const store = { p: { budgetBills: bills, budgetBooks: [], budgetAccounts: [], budgetTx: [] } };
    const c = { console, S: store, BIZ: "p", today: () => TODAY, window: {},
      esc: s => String(s == null ? "" : s) };
    c.D = () => store.p;
    vm.createContext(c); vm.runInContext(CAL, c); Object.assign(c, c.window);
    return c;
  };
  const names = (c, iso) => c.calBillsOnDay(iso).map(b => b.name);

  /* ⚠️ THE BUG: his real store has a yearly bill (Polk County property tax, nextDue 2027-03-01) that was
     showing on the 1st of EVERY month, in the same list that totals what he owes. */
  const yearly = sandbox([{ id: "y", name: "Property tax", amount: 1200, frequency: "yearly", dueDay: 1, nextDue: "2027-03-01", active: true }]);
  ok("⛔ an annual bill no longer appears every month", names(yearly, "2026-09-01").length === 0, names(yearly, "2026-09-01"));
  ok("⭐ ...it appears on the day it is actually due", names(yearly, "2027-03-01").join() === "Property tax");

  const monthly = sandbox([{ id: "m", name: "Rent", amount: 3750, frequency: "monthly", dueDay: 13, active: true }]);
  ok("a monthly bill still lands every month", names(monthly, "2026-09-13").join() === "Rent" && names(monthly, "2026-10-13").join() === "Rent");
  ok("...and not on other days", names(monthly, "2026-09-14").length === 0);
  ok("a bill with no frequency at all is treated as monthly, as it always was",
    names(sandbox([{ id: "n", name: "Old", amount: 5, dueDay: 9, active: true }]), "2026-09-09").join() === "Old");

  const once = sandbox([{ id: "o", name: "JT Jones Propane", amount: 736.24, frequency: "once", nextDue: "2026-08-25", active: true }]);
  ok("⭐ a one-time bill lands on its one day", names(once, "2026-08-25").join() === "JT Jones Propane");
  ok("⭐ ...and never again — it drops off by itself, with nothing to clean up",
    names(once, "2026-09-25").length === 0 && names(once, "2026-10-25").length === 0 && names(once, "2026-08-26").length === 0);
  ok("⛔ a one-time bill with no date shows nowhere rather than everywhere",
    sandbox([{ id: "o2", name: "Ghost", amount: 5, frequency: "once", nextDue: "", active: true }]).calBillsOnDay("2026-08-25").length === 0);

  /* ⚠️ the fallback: a non-monthly bill with NO anchor date carries no month information, so it keeps the
     old behaviour rather than disappearing. Losing a bill off his radar is worse than showing it too often. */
  ok("⚠️ an annual bill with no anchor date still shows, rather than vanishing",
    names(sandbox([{ id: "a", name: "Unanchored", amount: 5, frequency: "annual", dueDay: 3, active: true }]), "2026-09-03").join() === "Unanchored");

  const weekly = sandbox([{ id: "w", name: "Weekly thing", amount: 20, frequency: "weekly", dueDay: 2, active: true }]);
  ok("a weekly bill lands on its weekday", names(weekly, "2026-09-01").join() === "Weekly thing", "2026-09-01 is a Tuesday");
  ok("...and not the rest of the week", names(weekly, "2026-09-02").length === 0);

  ok("an inactive bill is shown nowhere", sandbox([{ id: "i", name: "Off", amount: 5, dueDay: 1, active: false }]).calBillsOnDay("2026-09-01").length === 0);
}

console.log("\n--- the fund-ahead maths ---");
{
  const c = { console, window: {}, D: () => ({}) };
  vm.createContext(c);
  const i = BUD.indexOf("var BUDGET_FREQS="), j = BUD.indexOf("||BUDGET_FREQS[1]; }", i);
  vm.runInContext(BUD.slice(i, j + 20) + ";this.F=BUDGET_FREQS;this.meta=budgetFreqMeta;", c);
  ok("One-time is offered as a frequency", c.F.some(f => f.k === "once" && /one.time/i.test(f.label)));
  eq("⭐ ...and contributes NOTHING to the monthly fund-ahead target", c.meta("once").perMonth, 0);
  eq("monthly is still 1×", c.meta("monthly").perMonth, 1);
  /* ⚠️ "yearly" exists in his live data and was falling through to the monthly default — a 12× overstatement */
  eq("⚠️ the older 'yearly' spelling is read as annual, not silently as monthly", c.meta("yearly").perMonth, c.meta("annual").perMonth);
  eq("an unknown frequency still defaults to monthly", c.meta("zzz").perMonth, 1);
  ok("the form refuses a one-time bill with no date", /frequency==="once"&&!b\.nextDue/.test(CODE(BUD)));
  ok("...and asks for a date instead of a day-of-month", /freq==="once"/.test(CODE(BUD)) && /Due date/.test(BUD));
}

console.log("\n--- the client writes what the server proposed ---");
{
  ok("Today knows how to file a bill", /a\.kind === "addBill"/.test(CODE(HOME)));
  ok("⭐ recurring → monthly, otherwise once", /frequency: a\.recurring \? "monthly" : "once"/.test(CODE(HOME)));
  ok("⭐ a one-time bill carries its date as nextDue", /nextDue: a\.recurring \? "" : \(a\.date \|\| ""\)/.test(CODE(HOME)));
  ok("⚠️ it lands in a real book, or it would exist and be invisible everywhere", /budgetDefaultBookId/.test(CODE(HOME)));
  ok("...with a fallback if that helper isn't loaded", /budgetBooks \|\| \[\]/.test(CODE(HOME)));
  ok("the confirm card shows the AMOUNT — he's confirming a claim about his money", /calMoney\(a\.amount\)/.test(CODE(HOME)));
  ok("⭐ ...and whether it repeats, which is the whole difference", /Every month on the/.test(HOME) && /One-time/.test(HOME));
  ok("nothing is written until he taps Confirm", /phConfirmAction/.test(CODE(HOME)) && !/addBill[\s\S]{0,200}budgetBills\.push/.test(CODE(HOME).split("phConfirmAction")[0]));
}

console.log("\n--- ⚠️ the messages page: a sidebar is not a bottom bar ---");
{
  /* Ray, 2026-08-25, with a screenshot: "the message page is hardly readable look" — a ~110px scrolling
     message list on a 1440px-tall screen. msgFitPane reserved the nav's HEIGHT; on desktop that same nav is
     a 224px sidebar running the full window height, so the pane collapsed to its 240px floor. */
  ok("⭐ only a nav that spans the window's WIDTH is treated as a bottom bar", /r\.width > window\.innerWidth \* 0\.8/.test(CODE(MSG)));
  ok("⛔ ...it no longer reserves offsetHeight for any fixed nav", !/getComputedStyle\(navEl\)\.position === "fixed"\) \? navEl\.offsetHeight/.test(CODE(MSG)));
  ok("the bug and the screenshot that found it are recorded", /sidebar/i.test(MSG) && /240px floor/.test(MSG));
  ok("⭐ the thread title can no longer be overlapped by the Inbox button", /<h2 class="grow"[^>]*text-overflow:ellipsis/.test(MSG));
  ok("...and that button holds its own size", /flex:0 0 auto;width:auto" onclick="msgBack\(\)/.test(MSG));
  ok("⭐ a bubble is capped so it isn't stretched across a desktop", /\.msgrow \.bubble\{max-width:min\(82%,640px\)/.test(CSS));
  ok("...and the thread itself holds a readable measure", /\.msgpane\{max-width:980px\}/.test(CSS));
  ok("⭐ a short thread sits ON the compose box, like every chat", /\.msglist > \*:first-child\{margin-top:auto\}/.test(CSS));
  ok("⛔ ...done with margin-auto, NOT justify-content:flex-end, which strands overflowing content",
    !/\.msglist\{[^}]*justify-content:flex-end/.test(CSS));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
