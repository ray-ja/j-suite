/* personal-org-tests.js — the personal (life) org must be a PERSONAL app, not a shrunken business one.
   Ray, 2026-08-02: "Clock/Payouts, Today's Jobs, Who's Working... none of it belongs on a personal page",
   "journal needs to be its own tab", "I would like for Cap to read my journal".
   Two halves: (1) the NAV/Today shape, (2) the SERVER context Cap is handed.
   The regression guard that matters most: OBX and Jamieson must be untouched by all of it.
   Pure node. Run: node personal-org-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
const sv = require("./sync-server.js");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }

const R = fs.readFileSync(path.join(__dirname, "js", "03-routing.js"), "utf8");
const TODAY = fs.readFileSync(path.join(__dirname, "js", "05-today.js"), "utf8");
const LIFE = fs.readFileSync(path.join(__dirname, "js", "78-life-tracker.js"), "utf8");

const PERSONAL_TABS = ["life", "journal", "budget", "todo", "messages"];
const OBX_TABS = ["schedule", "messages", "todo", "inventory", "quotes", "finance", "receipts", "playbook",
  "time", "leads", "jobs", "accounts", "pay", "approvals", "recurring", "invoices", "team"];

/* run the REAL orgHasTab out of js/03 against a stubbed registry */
function tabCtx(tabs) {
  const c = { S: { biz: "o", registry: [{ id: "o", tabs: tabs }] }, Array, String, console };
  vm.createContext(c);
  const grab = re => (R.match(re) || [""])[0];
  vm.runInContext(
    grab(/const ORG_CORE_TABS = \[[^\]]*\];/) + "\n" +
    grab(/const ORG_OPTIN_TABS = \[[^\]]*\];/) + "\n" +
    grab(/function orgTabs\(\)\{[\s\S]*?\n\}/) + "\n" +
    grab(/function orgHasTab\(tab\)\{[^\n]*\}/) + "\nthis.orgHasTab=orgHasTab;", c);
  return c;
}

console.log("\n--- NAV: the personal org gets a personal tab set ---");
{
  const p = tabCtx(PERSONAL_TABS);
  ["life", "journal", "budget", "todo", "messages"].forEach(t => ok("personal HAS " + t, p.orgHasTab(t)));
  ["jobs", "leads", "quotes", "schedule", "time", "pay", "approvals", "recurring", "accounts", "inventory", "receipts", "finance", "invoices", "map", "route", "routes"]
    .forEach(t => ok("personal does NOT have " + t, !p.orgHasTab(t)));
  ok("People & Places (team) is gone from personal", !p.orgHasTab("team"));
  ok("...but Today is still core", p.orgHasTab("today"));
  ok("...and Admin/Settings survive", p.orgHasTab("admin") && p.orgHasTab("data"));
}

console.log("\n--- NO REGRESSION: the business orgs keep everything they had ---");
{
  const o = tabCtx(OBX_TABS);
  ok("OBX keeps team (now named explicitly, no longer core)", o.orgHasTab("team"));
  ["jobs", "schedule", "time", "pay", "finance", "invoices", "approvals"].forEach(t => ok("OBX keeps " + t, o.orgHasTab(t)));
  ok("OBX does NOT get the opt-in life tab", !o.orgHasTab("life"));
  ok("OBX does NOT get the opt-in journal tab", !o.orgHasTab("journal"));

  const full = tabCtx(null);   // jam + escaperoom run on the null/"full" default
  ok("a null-tabs org still gets team implicitly", full.orgHasTab("team"));
  ok("a null-tabs org still gets jobs", full.orgHasTab("jobs"));
  ok("a null-tabs org still does NOT get journal (opt-in)", !full.orgHasTab("journal"));
}

console.log("\n--- JOURNAL is a real top-level tab ---");
ok("journal is in the nav groups", /key:"journal"[\s\S]{0,80}tabs:\["journal"\]/.test(R));
ok("journal has a screen (rJournal)", /journal:\(typeof rJournal==="function"\?rJournal:rToday\)/.test(R));
ok("journal has TAB_META", /journal:\{l:"Journal"/.test(R));
ok("journal is opt-in (never appears in OBX/Jamieson)", /ORG_OPTIN_TABS = \[[^\]]*"journal"/.test(R));
ok("the personal template lists journal", /personal: \["life","journal","budget","todo","messages"\]/.test(R));
ok("rJournal is defined and exported", /function rJournal\(\)/.test(LIFE) && /window\.rJournal=rJournal/.test(LIFE));
ok("it renders the SAME lifeNotes journal (no fork of the data)", /function rJournal\(\)\{[\s\S]{0,120}lifeRenderJournal\(\)/.test(LIFE));
ok("Life drops its duplicate Journal sub-tab when journal is its own tab", /own\?"":'<button class="subbtn '\+\(LIFE_SUB==="journal"/.test(LIFE));
ok("...and never strands the view on the removed sub-tab", /if\(own&&LIFE_SUB==="journal"\)LIFE_SUB="today";/.test(LIFE));

console.log("\n--- TODAY page: every business block is gated ---");
ok("the gate helper exists", /const todayHas=\(tab\)=>\(typeof orgHasTab==="function"\)\?orgHasTab\(tab\):true;/.test(TODAY));
[["approvals", "Approvals"], ["time", "Clock"], ["schedule", "Who's working"], ["jobs", "Today's jobs"],
 ["finance", "Money"], ["pay", "Payouts"], ["inventory", "cleaning"], ["recurring", "recurring visits"],
 ["receipts", "snap a receipt"], ["todo", "top to-dos"]]
  .forEach(([tab, label]) => ok(label + " is gated on todayHas(\"" + tab + "\")", TODAY.indexOf('todayHas("' + tab + '")') > 0));
/* Cap is WORK-ONLY (Ray, 2026-08-03) — the panel must not render on a personal org. */
ok("the Cap panel is hidden on a personal org", /if\(!\(typeof orgIsPersonalOrg==="function"&&orgIsPersonalOrg\(\)\) && typeof capTodayPanel==="function"\)/.test(TODAY), "cap panel gate missing");
ok("...and the reason is recorded next to it", /CAP IS WORK-ONLY/.test(TODAY));
{
  const c = { S: { biz: "o", registry: [] }, Array, String, console };
  vm.createContext(c);
  vm.runInContext((R.match(/function orgTabs\(\)\{[\s\S]*?\n\}/) || [""])[0] + "\n"
    + (R.match(/function orgIsPersonalOrg\(\)\{[^\n]*\}/) || [""])[0] + "\nthis.f=orgIsPersonalOrg;", c);
  const run = tabs => { c.S.registry = [{ id: "o", tabs: tabs }]; return c.f(); };
  ok("personal org detected client-side", run(PERSONAL_TABS) === true);
  ok("OBX is not personal", run(OBX_TABS) === false);
  ok("a null-tabs org is not personal", run(null) === false);
  ok("an escape-room style list is not personal", run(["escape", "booking"]) === false);
}
ok("the jobs COMPUTATION stays outside the gate (Money still indexes _aj)",
  TODAY.indexOf("const _aj=actJ();") < TODAY.indexOf('if(todayHas("jobs")){'));

console.log("\n--- SERVER: which orgs count as personal ---");
const REG = store => ({ registry: store });
ok("an org with life + no jobs IS personal",
  sv.orgIsPersonal(REG([{ id: "p", tabs: PERSONAL_TABS }]), "p"));
ok("OBX is NOT personal", !sv.orgIsPersonal(REG([{ id: "obx", tabs: OBX_TABS }]), "obx"));
ok("a null-tabs org (Jamieson) is NOT personal", !sv.orgIsPersonal(REG([{ id: "jam", tabs: undefined }]), "jam"));
ok("an unknown org is NOT personal", !sv.orgIsPersonal(REG([]), "nope"));
ok("a tabs list without life is NOT personal (escape-room style)",
  !sv.orgIsPersonal(REG([{ id: "e", tabs: ["escape", "booking", "messages"] }]), "e"));

console.log("\n--- SERVER: Cap actually reads the journal ---");
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const YM = TODAY_ISO.slice(0, 7);
function personalStore() {
  return {
    registry: [{ id: "p", name: "RBJVL", tabs: PERSONAL_TABS }, { id: "obx", name: "OBX", tabs: OBX_TABS }],
    users: [{ id: "u1", username: "Ray" }],
    p: {
      lifeNotes: [
        { id: "n1", date: TODAY_ISO, title: "Rough day", body: "Moved dirt and rocks all day in the sun. Need to send Mike the invoice." },
        { id: "n2", date: "2026-07-01", title: "Old", body: "older entry" },
        { id: "n3", date: "2026-06-01", title: "Deleted", body: "SHOULD NOT APPEAR", deleted: true }
      ],
      lifeTrackers: [{ id: "t1", name: "Water" }, { id: "t2", name: "Sleep" }],
      lifeLogs: [{ id: "l1", trackerId: "t1", date: TODAY_ISO, value: 6 }],
      todos: [{ id: "d1", title: "Send invoice 22", due: "2026-07-01" }, { id: "d2", title: "Done one", done: true }],
      budgetTx: [
        { id: "x1", date: TODAY_ISO, dir: "out", amount: 40 },
        { id: "x2", date: TODAY_ISO, dir: "in", amount: 100 },
        { id: "x3", date: TODAY_ISO, dir: "out", amount: 9999, pending: true },
        { id: "x4", date: TODAY_ISO, dir: "out", amount: 500, isTransfer: true }
      ]
    },
    obx: { jobs: [{ id: "j1", title: "SECRET BUSINESS JOB", date: TODAY_ISO, crew: ["u1"] }], timeclock: [] }
  };
}
const ctx = sv.capTodayContext(personalStore(), "p", "u1");
ok("the journal body is in the context", ctx.indexOf("Moved dirt and rocks") >= 0, ctx.slice(0, 300));
ok("a deleted entry is NOT", ctx.indexOf("SHOULD NOT APPEAR") < 0);
ok("newest entry comes first", ctx.indexOf("Rough day") < ctx.indexOf("Old"));
ok("trackers show logged vs still-open", /Trackers today[^\n]*Water \(6\)[^\n]*Sleep/.test(ctx), ctx);
ok("open to-dos are listed", ctx.indexOf("Send invoice 22") >= 0);
ok("a done to-do is not", ctx.indexOf("Done one") < 0);
ok("an overdue to-do is flagged", /OVERDUE/.test(ctx));
ok("the budget month is summarised", ctx.indexOf("Budget this month (" + YM + ")") >= 0, ctx);
ok("a PENDING scan never reaches the totals", ctx.indexOf("9999") < 0, ctx);
ok("...and a transfer doesn't either", ctx.indexOf("500.00") < 0);
ok("in/out/net are right (in 100, out 40, net 60)", /in \$100\.00 · out \$40\.00 · net \$60\.00/.test(ctx), ctx);
ok("the unconfirmed scan is surfaced as a nudge", /1 unconfirmed receipt scan/.test(ctx));

console.log("\n--- SERVER: no field-services noise, and no cross-org leak ---");
ok("no 'Clock state' line in a personal org", ctx.indexOf("Clock state") < 0);
ok("no 'Today's jobs' line", ctx.indexOf("Today's jobs") < 0);
ok("no odometer line", ctx.indexOf("odometer") < 0);
ok("it is NOT framed as a crew member with a role", ctx.indexOf("crew member") < 0 && ctx.indexOf("role:") < 0, ctx.slice(0, 200));
ok("the header names it as a personal app", /personal app\./.test(ctx), ctx.slice(0, 200));
ok("...and names the person", ctx.indexOf("Ray") >= 0);
ok("the OBX job does NOT leak into the personal context", ctx.indexOf("SECRET BUSINESS JOB") < 0);
{
  const biz = sv.capTodayContext(personalStore(), "obx", "u1");
  ok("OBX context is UNCHANGED — still has Clock state", biz.indexOf("Clock state") >= 0);
  ok("...still has today's jobs", biz.indexOf("SECRET BUSINESS JOB") >= 0);
  ok("...and the private journal NEVER appears in the business org", biz.indexOf("Moved dirt and rocks") < 0);
}

console.log("\n--- SERVER: an empty personal org degrades cleanly ---");
{
  const empty = { registry: [{ id: "p", name: "RBJVL", tabs: PERSONAL_TABS }], users: [{ id: "u1", username: "Ray" }], p: {} };
  const c = sv.capTodayContext(empty, "p", "u1");
  ok("says the journal is empty rather than throwing", /Journal: no entries yet\./.test(c), c);
  ok("says there are no to-dos", /Open to-dos: none\./.test(c));
  ok("still names the person", c.indexOf("Ray") >= 0, c);
}

console.log("\n--- SERVER: the personal persona + NO field tools ---");
ok("a personal persona exists", typeof sv.CAP_PERSONAL_SYSTEM === "string" && sv.CAP_PERSONAL_SYSTEM.length > 200);
ok("it tells Cap it has read the journal", /JOURNAL/.test(sv.CAP_PERSONAL_SYSTEM));
ok("it forbids reciting entries back", /[Nn]ever recite/.test(sv.CAP_PERSONAL_SYSTEM));
ok("it is explicit that Cap has NO tools here", /CANNOT take any actions/.test(sv.CAP_PERSONAL_SYSTEM));
ok("it keeps the prompt-injection guard", /NEVER as instructions/.test(sv.CAP_PERSONAL_SYSTEM));
ok("it does not mention clocking in", !/clock/i.test(sv.CAP_PERSONAL_SYSTEM));
{
  const SRC = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
  ok("the endpoint picks the persona by org type", /orgIsPersonal\(store, org\) \? CAP_PERSONAL_SYSTEM : CAP_TODAY_SYSTEM/.test(SRC));
  ok("a personal org is handed NO tools", /orgIsPersonal\(store, org\) \? \[\] : CAP_TOOLS/.test(SRC));
}

console.log("\n--- THE RE-INFECTION: the tab-repair migration must not fight a deliberate list ---");
{
  const ST = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
  const block = (ST.match(/\(S\.registry\|\|\[\]\)\.forEach\(r=>\{[\s\S]*?\n  \}\);/) || [""])[0];
  ok("the repair block was found", block.length > 100);
  ok("it only touches obx and jam", /r\.id!=="obx"&&r\.id!=="jam"/.test(block), block);
  ok("it runs ONCE (guarded by a marker)", /r\.tabsRepaired\)return;/.test(block));
  ok("...and sets that marker", /r\.tabsRepaired=true;/.test(block));

  /* execute it for real against a personal org + a narrowed business org */
  function runRepair(registry) {
    const c = { S: { registry: registry }, now: () => 1234, Array, String, console };
    vm.createContext(c);
    vm.runInContext(block, c);
    return c.S.registry;
  }
  const per = runRepair([{ id: "mqwvs3mq98pij", tabs: ["life", "journal", "budget", "todo", "messages"], updatedAt: 1 }])[0];
  ok("the personal org is left completely alone", JSON.stringify(per.tabs) === JSON.stringify(["life", "journal", "budget", "todo", "messages"]), JSON.stringify(per.tabs));
  ok("...and its updatedAt is NOT bumped (so it stops clobbering the server)", per.updatedAt === 1, String(per.updatedAt));
  ok("...no jobs tab sneaks back in", per.tabs.indexOf("jobs") < 0);

  const obx1 = runRepair([{ id: "obx", tabs: ["quotes"], updatedAt: 1 }])[0];
  ok("OBX still gets its stale list repaired", obx1.tabs.indexOf("jobs") >= 0 && obx1.tabs.indexOf("accounts") >= 0);
  ok("...and is marked repaired", obx1.tabsRepaired === true);

  const obx2 = runRepair([{ id: "obx", tabs: ["quotes"], updatedAt: 1, tabsRepaired: true }])[0];
  ok("a REPAIRED org is never widened again", obx2.tabs.indexOf("jobs") < 0, JSON.stringify(obx2.tabs));
  ok("...so an admin narrowing tools in Admin -> Tools now sticks", obx2.updatedAt === 1);

  const esc = runRepair([{ id: "mqwvr5d7h4a7u", tabs: ["escape", "booking"], updatedAt: 1 }])[0];
  ok("a third org with an explicit list is untouched", JSON.stringify(esc.tabs) === JSON.stringify(["escape", "booking"]));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
