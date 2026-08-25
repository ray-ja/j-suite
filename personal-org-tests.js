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

const PERSONAL_TABS = ["life", "journal", "shelf", "budget", "todo", "messages"];
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
  ["life", "journal", "shelf", "budget", "todo", "messages"].forEach(t => ok("personal HAS " + t, p.orgHasTab(t)));
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
/* membership, not exact position — the list grows as personal tools are added */
{
  const tmpl = (R.match(/personal: \[([^\]]*)\]/) || [, ""])[1].replace(/"/g, "").split(",");
  ["life", "journal", "shelf", "cal", "budget", "todo", "messages"].forEach(t =>
    ok("the personal template lists " + t, tmpl.indexOf(t) >= 0, tmpl.join("|")));
  ["jobs", "leads", "quotes", "pay", "approvals", "accounts"].forEach(t =>
    ok("...and never " + t, tmpl.indexOf(t) < 0, tmpl.join("|")));
}
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
/* MUST be the America/New_York date, not the UTC one — capTodayContext uses NY as its source of truth, so a
   UTC-based fixture disagrees with the code every evening after 8pm ET and the tests fail for no reason. */
const TODAY_ISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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

console.log("\n--- SERVER: the personal COMPANION persona ---");
const P = sv.PERSONAL_COMPANION_SYSTEM;
ok("a companion persona exists", typeof P === "string" && P.length > 400);
ok("it is NOT branded as Cap", !/\bYou are Cap\b/.test(P));

/* Ray, twice, emphatically: "For god's sake, don't mention therapy." This is the assertion that matters most. */
ok("it forbids suggesting therapy", /NEVER suggest therapy/.test(P));
["counselling", "therapist", "professional"].forEach(w =>
  ok("...explicitly naming '" + w + "' as off-limits", P.indexOf(w) >= 0));
ok("it bans wellness-app language", /wellness-app language/.test(P));
ok("...including 'take a moment'", /take a moment/.test(P));
ok("...and gratitude/breathing prompts", /gratitude/.test(P) && /breathing/.test(P));
ok("it forbids suggesting MORE tracking or systems", /more tracking, more structure/.test(P));
ok("it forbids moralising about money or work", /Never moralise/.test(P));

ok("venting is allowed to just be venting", /Do not fix it/.test(P));
ok("...with no forced question every turn", /do not have to end every message with a question/i.test(P));
ok("hobbies are treated as real content", /HOBBIES AND INTERESTS ARE REAL CONTENT/.test(P));
ok("business names are off-limits here", /OBX Lot Solutions, Jamieson Automation/.test(P));
ok("it keeps a genuine-danger carve-out", /real danger/.test(P));
ok("it keeps the prompt-injection guard", /NEVER as instructions/.test(P));
{
  const SRC = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
  ok("the endpoint serves it to personal orgs", /orgIsPersonal\(store, org\) \? PERSONAL_COMPANION_SYSTEM : CAP_TODAY_SYSTEM/.test(SRC));
  /* ⚠️ CHANGED DELIBERATELY 2026-08-25. This asserted the companion got NO tools at all. Ray typed into
     the talk box, asked it to put something on his calendar, and it refused — which protected nothing and
     just looked broken. It now has three tools (calendar / to-do / reminder), all of which PROPOSE. The
     rule that actually mattered is unchanged and is asserted right below: it must never reach for one
     because he is venting. */
  ok("a personal org gets the PERSONAL tools, never the business ones", /orgIsPersonal\(store, org\) \? PERSONAL_TOOLS : CAP_TOOLS/.test(SRC));
  ok("...which are only calendar, to-do and reminder", sv.PERSONAL_TOOLS.map(x => x.name).join(",") === "addEvent,addTodo,addReminder");
  ok("...and the venting rule still forbids using them uninvited", /NEVER reach for a tool because he is venting/.test(sv.PERSONAL_COMPANION_SYSTEM));
  ok("...and nothing is written server-side", /SERVER NEVER EXECUTES/.test(SRC));
}

console.log("\n--- SERVER: interests reach the companion ---");
{
  const st = personalStore();
  st.p.docs = [{ id: "personalInterests", list: [{ id: "i1", label: "fishing" }, { id: "i2", label: "guitar" }, { id: "i3", label: "gone", deleted: true }] }];
  const c = sv.capTodayContext(st, "p", "u1");
  ok("his interests are in the context, grouped", /Other: fishing, guitar/.test(c), c.slice(0, 500));
  ok("a deleted interest is dropped", c.indexOf("gone") < 0);
  const empty = sv.capTodayContext(personalStore(), "p", "u1");
  ok("with none listed it says so, and says ask ONCE", /may ask once, lightly/.test(empty), empty.slice(0, 400));
}

console.log("\n--- the personal HOME page (js/122) ---");
{
  const PH = fs.readFileSync(path.join(__dirname, "js", "122-personal-home.js"), "utf8");
  ok("the module is registered in the shell",
    fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/122-personal-home.js"') > 0);
  ok("a personal org routes to it instead of the business Today",
    /orgIsPersonalOrg\(\)&&typeof personalHome==="function"/.test(TODAY));
  ok("the talk box is the first thing on the page", PH.indexOf("phTalkCard()") < PH.indexOf("phQuickCard()"));
  ok("it works with ZERO data (an empty-state line, not an empty page)", /Nothing you say here goes anywhere else/.test(PH));
  ok("venting is NOT silently filed — saving is his choice", /phSaveToJournal/.test(PH) && /venting is not silently filed/i.test(PH));
  ok("...and saving writes a normal journal entry he owns", /d\.lifeNotes\.push\(n\)/.test(PH));
  ok("interests are stored on `docs` (no new collection, no migration)", /id === "personalInterests"/.test(PH));
  ok("the look-back card stays SILENT until there is something to resurface", /if \(!older\.length\) return "";/.test(PH));
  ok("the conversation is per-day and device-local (never synced)", /localStorage\.setItem\(phKey\(\)/.test(PH));
  ok("...and is org-scoped like the Cap thread", /"ph_talk_" \+ \(\(me && me\.id\) \|\| "anon"\) \+ "_" \+ \(\(typeof S !== "undefined" && S\.biz\)/.test(PH));

  /* RENDER IT FOR REAL. Chrome is dead on this box, so the only proof the page isn't blank is executing it. */
  {
    const els = {};
    const el = () => ({ innerHTML: "", scrollTop: 0, scrollHeight: 0, style: {}, value: "" });
    const rc = {
      console, JSON, Math, Date, String, Number, Array, Object, localStorage: {
        getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0
      },
      setTimeout: () => 0,
      document: { getElementById: id => (els[id] = els[id] || el()) },
      S: { biz: "p", sync: { url: "https://x", token: "t" } },
      D: () => ({ docs: [{ id: "personalInterests", list: [{ id: "i1", label: "fishing" }] }],
                  lifeNotes: [{ id: "n1", date: "2026-01-01", body: "an older entry to resurface" }] }),
      curUser: () => ({ id: "u1", username: "Ray" }),
      today: () => "2026-08-03",
      esc: x => String(x == null ? "" : x),
      fmtDate: d => d,
      actLifeNotes: null
    };
    rc.window = rc;
    vm.createContext(rc);
    vm.runInContext(PH, rc);
    const html = rc.personalHome();
    ok("personalHome() renders without throwing", typeof html === "string" && html.length > 200, String(html).length + " chars");
    ok("...the greeting is at the top", html.indexOf("Ray") > 0 && html.indexOf("Ray") < 120, html.slice(0, 120));
    ok("...the talk input is present", html.indexOf('id="ph-input"') > 0);
    /* ⚠️ MOVED 2026-08-25 — Ray: "we don't need this massive list of things I'm into on the today page."
       It filled the whole right-hand column. It lives on Life now; the companion still reads the record. */
    ok("...the interests WALL is no longer on Today", html.indexOf("fishing") < 0);
    ok("...the older journal entry resurfaces", html.indexOf("an older entry to resurface") > 0);
    ok("...and no business word appears anywhere on the page",
      !/invoice|quote|payout|clock in|customer/i.test(html), (/invoice|quote|payout|clock in|customer/i.exec(html) || [""])[0]);

    /* LAYOUT: .sub is globally nowrap+ellipsis, so any long personal prose MUST opt out or it scrolls the
       whole page sideways and truncates his own words (seen live in a screenshot 2026-08-05). */
    {
      const cats = html.split("Things you're into")[1] || "";
      const subs = cats.match(/class="sub"[^>]*/g) || [];
      const bad = subs.filter(t => !/white-space:normal/.test(t));
      ok("every interests line is allowed to wrap", bad.length === 0, bad.join(" | "));
      ok("...and the long list is not clipped with an ellipsis", !/text-overflow/.test(cats));
    }

    /* the same page with NOTHING logged — the state he will actually open it in */
    rc.D = () => ({});
    const empty = rc.personalHome();
    ok("it still renders a real page with ZERO data", typeof empty === "string" && empty.length > 200, String(empty).length + " chars");
    ok("...leading with the talk box", empty.indexOf('id="ph-input"') > 0);
    ok("...with no empty-state apology", !/no entries|nothing yet|you have no/i.test(empty), empty.slice(0, 200));
  }

  /* the greeting is the first thing he reads — run it for real */
  const c = { Date: Date, String: String, console: console };
  vm.createContext(c);
  vm.runInContext('let S={biz:"p"};function curUser(){return {username:"Ray Smith"};}function today(){return "2026-08-03";}'
    + (PH.match(/function phMe\(\)[^\n]*\n/) || [""])[0]
    + (PH.match(/function phGreeting\(\)[\s\S]*?\n\}/) || [""])[0] + "\nthis.g=phGreeting;", c);
  const g = c.g();
  ok("the greeting uses his FIRST name only", /Ray/.test(g) && !/Smith/.test(g), g);
  ok("...and is time-aware, not a fixed string", /Morning|Afternoon|Evening|Late one/.test(g), g);
}

console.log("\n--- INTERESTS: the Enter fix + categories + aspirations ---");
{
  const PH = fs.readFileSync(path.join(__dirname, "js", "122-personal-home.js"), "utf8");
  /* Ray: "I tried adding them manually, but it's really slow because I can't hit enter." */
  ok("Enter submits the interest field", /onkeydown="if\(event\.key===\\?.Enter\\?.\)\{event\.preventDefault\(\);phSaveInterest\(\);\}/.test(PH),
    (PH.match(/onkeydown="[^"]*"/) || ["(no onkeydown found)"])[0]);
  ok("...the field is cleared but KEEPS focus", /inp\.value = "";[\s\S]{0,120}inp\.focus\(\);/.test(PH));
  ok("...and only the LIST re-renders, not the whole modal", /phRefreshInterestList\(\);/.test(PH) && !/window\.phAddInterest\(\);\s*\};\s*if \(typeof window[^\n]*phDelInterest/.test(PH));
  ok("...the field is focused when the modal opens", /getElementById\("ph_int"\); if \(el\) el\.focus\(\)/.test(PH));
  ok("the reason is recorded next to the fix", /THE ENTER FIX/.test(PH));

  ok("interests carry a category", /cat: \(catEl && catEl\.value\)/.test(PH));
  ok("...and an aspiration flag", /aspiration: !!\(aspEl && aspEl\.checked\)/.test(PH));
  ["reading", "games", "ideas", "faith", "music"].forEach(k =>
    ok("category '" + k + "' exists", new RegExp('key: "' + k + '"').test(PH)));
  ok("faith is its own category, not lumped into Other", /key: "faith",\s*label: "Faith"/.test(PH));
  ok("an aspiration is shown gently, not as a task", /want to get back to/.test(PH) && !/overdue|TODO|goal/i.test(PH.slice(PH.indexOf("phInterestListHTML"), PH.indexOf("phRefreshInterestList"))));
}

console.log("\n--- SERVER: interests reach the companion GROUPED, with aspirations flagged ---");
{
  const st = personalStore();
  st.p.docs = [{ id: "personalInterests", list: [
    { id: "i1", label: "Morrowind", cat: "games" },
    { id: "i2", label: "Sci-fi", cat: "reading" },
    { id: "i3", label: "Catholicism", cat: "faith" },
    { id: "i4", label: "Japanese", cat: "ideas", aspiration: true },
    { id: "i5", label: "gone", cat: "games", deleted: true }
  ] }];
  const c = sv.capTodayContext(st, "p", "u1");
  ok("grouped by category", /Games: Morrowind/.test(c) && /Reading: Sci-fi/.test(c), c.slice(0, 600));
  ok("faith is surfaced as Faith", /Faith: Catholicism/.test(c));
  ok("a deleted interest is dropped", c.indexOf("gone") < 0);
  ok("aspirations are called out separately", /LIKES THE IDEA OF but has never gotten good at: Japanese/.test(c));
  ok("...and explicitly marked NOT goals", /Wistful, not goals/.test(c));
  ok("...with a hard no-nudge instruction", /NEVER turn one into a suggestion/.test(c));
}

console.log("\n--- PERSONA: the two delicate things ---");
{
  const P = sv.PERSONAL_COMPANION_SYSTEM;
  ok("aspirations must not become suggestions", /never convert one into a suggestion/.test(P));
  ok("...named concretely so it can't be hand-waved", /philosophy, Russian, Chinese, Japanese, the keyboard/.test(P));
  ok("his faith is handled with respect", /he is Catholic/.test(P));
  ok("...no preaching", /never preach at him/.test(P));
  ok("...no arguing", /never argue with it/.test(P));
  ok("...and never psychoanalysed", /never treat it as something to be analysed/.test(P));
}

console.log("\n--- THE SHELF (js/123): a reference library, NOT a reading to-do ---");
{
  const SH = fs.readFileSync(path.join(__dirname, "js", "123-shelf.js"), "utf8");
  const ST = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");
  const SRC = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");

  ok("registered in the shell",
    fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/123-shelf.js"') > 0);
  ok("shelf has a screen", /shelf:\(typeof rShelf==="function"\?rShelf:rToday\)/.test(R));
  ok("shelf has TAB_META", /shelf:\{l:"Shelf"/.test(R));
  ok("shelf is opt-in (never on OBX/Jamieson)", /ORG_OPTIN_TABS = \[[^\]]*"shelf"/.test(R));
  ok("shelf is in ROUTE_TABS (deep links + notifications)", /const ROUTE_TABS=\[[^\]]*"shelf"/.test(R));

  /* the data-layer wiring the collection pattern requires — all three sites */
  ok("shelfItems is in blank()", /shelfItems:\[\]/.test(ST));
  ok("shelfItems is backfilled on every org slab", (ST.match(/S\[b\]\.shelfItems/g) || []).length >= 2,
    String((ST.match(/S\[b\]\.shelfItems/g) || []).length) + " backfill sites");
  ok("shelfItems is in the server COLLECTIONS", /"shelfItems"/.test(SRC));

  /* THE CONSTRAINT THAT MATTERS: he already told me reading is something he "likes the idea of but never got
     good at". A shelf with counters or nudges would rebuild the guilt machine. */
  /* strip comments first — the module's own header explains what it must NOT do ("no progress bars, unread
     counts, streaks or reminders"), and that prose would trip a naive scan of the whole file. */
  const SH_CODE = SH.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("no unread/progress counter in the CODE", !/unread|progress|% read|remaining/i.test(SH_CODE),
    (/unread|progress|% read|remaining/i.exec(SH_CODE) || [""])[0]);
  ok("no streaks, reminders or due dates in the CODE", !/streak|remind|overdue|dueDate/i.test(SH_CODE),
    (/streak|remind|overdue|dueDate/i.exec(SH_CODE) || [""])[0]);
  ok("status is optional and explicitly never counted", /never counted or nagged/.test(SH));
  ok("the no-reading-list rule is recorded in the module", /THIS IS A SHELF, NOT A READING LIST/.test(SH));
  ok("the empty state doesn't imply a backlog", /Nothing here is a to-do list/.test(SH));
  ok("ideas render before books (the frame the books hang off)", SH.indexOf("if (ideas.length)") < SH.indexOf("if (books.length)"));
  ok("entries are grouped by topic", /shelfTopics\(\)/.test(SH));

  /* the companion may DISCUSS the shelf but never chase it */
  ok("the shelf reaches the companion context", /ON HIS SHELF/.test(SRC));
  ok("...with an explicit no-chasing instruction", /NEVER ask why he hasn't read something/.test(SRC));
  ok("...and is not framed as a backlog", /never treat the shelf as a backlog/.test(SRC));
}

console.log("\n--- SERVER: the shelf renders into the context ---");
{
  const st = personalStore();
  st.p.shelfItems = [
    { id: "shf_1", kind: "book", topic: "Feudalism → industry", title: "The Great Transformation", author: "Karl Polanyi", status: "want" },
    { id: "shf_2", kind: "idea", topic: "Feudalism → industry", title: "The real argument is about the MECHANISM" },
    { id: "shf_3", kind: "book", topic: "Philosophy — read", title: "Meditations", author: "Marcus Aurelius", status: "read" },
    { id: "shf_4", kind: "book", topic: "Feudalism → industry", title: "gone", deleted: true }
  ];
  const c = sv.capTodayContext(st, "p", "u1");
  ok("the shelf is in the context", /ON HIS SHELF/.test(c), c.slice(0, 600));
  ok("grouped by topic", /Feudalism → industry: The Great Transformation \(Karl Polanyi\)/.test(c), c);
  ok("a read book is marked", /Meditations \(Marcus Aurelius\) \[read\]/.test(c));
  ok("a deleted item is dropped", c.indexOf("gone") < 0);
  const noShelf = sv.capTodayContext(personalStore(), "p", "u1");
  ok("silent when the shelf is empty", noShelf.indexOf("ON HIS SHELF") < 0);
}

console.log("\n--- THE STACK (js/125): a record, never an adherence tracker ---");
{
  const SK = fs.readFileSync(path.join(__dirname, "js", "125-stack.js"), "utf8");
  const SRC2 = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
  ok("registered in the shell",
    fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/125-stack.js"') > 0);
  ok("the card renders on the Life tab", /stackCardHTML\(\)/.test(LIFE));
  ok("stored on a docs record (no new collection, no migration)", /id === "personalStack"/.test(SK));

  /* He said of his vitamin D: "most days, but not every day." That must never become a visible failure. */
  const SK_CODE = SK.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("no taken-today checkbox", !/taken|checkbox|compliance/i.test(SK_CODE), (/taken|checkbox|compliance/i.exec(SK_CODE) || [""])[0]);
  ok("no streaks or missed-day logic", !/streak|missed|adherence/i.test(SK_CODE));
  ok("it says so on the card itself", /A record, not a checklist/.test(SK));
  ok("the reason is recorded in the module", /REFERENCE, NOT AN ADHERENCE TRACKER/.test(SK));

  /* the Enter lesson, applied from the start this time */
  ok("Enter adds an entry", /onkeydown="if\(event\.key===\\?.Enter\\?.\)\{event\.preventDefault\(\);stackSave\(\);\}/.test(SK));
  ok("...fields clear and focus returns", /nameEl\.focus\(\);/.test(SK));
  ok("...and only the list re-renders", /stackRefresh\(\);/.test(SK));

  ok("the companion is told it's a record, not a checklist", /A record, not a checklist\. NEVER ask whether he took something today/.test(SRC2));
}

console.log("\n--- SERVER: the stack reaches the companion ---");
{
  const st = personalStore();
  st.p.docs = [{ id: "personalStack", list: [
    { id: "s1", name: "Boron", dose: "10 mg" },
    { id: "s2", name: "Vitamin D3", dose: "10,000 IU" },
    { id: "s3", name: "gone", deleted: true }
  ] }];
  const c = sv.capTodayContext(st, "p", "u1");
  ok("it knows what he takes", /What he takes: Boron 10 mg, Vitamin D3 10,000 IU\./.test(c), c.slice(0, 600));
  ok("a deleted entry is dropped", c.indexOf("gone") < 0);
  ok("with the no-nagging rule attached", /NEVER ask whether he took something today/.test(c));
  ok("silent when nothing is listed", sv.capTodayContext(personalStore(), "p", "u1").indexOf("What he takes") < 0);
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

console.log("\n--- THE PEOPLE: names and roles reach the companion, family friction never does ---");
{
  const st = personalStore();
  st.p.docs = [{ id: "personalPeople", list: [
    { id: "p1", name: "Brooke", rel: "wife", note: "does the laundry" },
    { id: "p2", name: "Jamie", rel: "son", born: "2021-05-12" },
    { id: "p3", name: "Leona", rel: "daughter", born: (+TODAY_ISO.slice(0, 4)) + "-06-15" },
    { id: "p4", name: "Ghost", rel: "nobody", deleted: true }
  ] }];
  const c = sv.capTodayContext(st, "p", "u1");
  ok("the household is in the context", /The people in his life/.test(c), c.slice(0, 600));
  ok("his wife is named", c.indexOf("Brooke") >= 0);
  ok("a deleted person is dropped", c.indexOf("Ghost") < 0);
  ok("ages are derived from the birth year", /Jamie — son, \d/.test(c), (/Jamie[^\n]*/.exec(c) || [""])[0]);
  ok("a baby reads as 'under 1', not 0", /Leona — daughter, under 1/.test(c), (/Leona[^\n]*/.exec(c) || [""])[0]);
  ok("it is told never to introduce a person he hasn't mentioned", /never introduce a person he hasn't mentioned/.test(c));
  ok("...and never to raise a family conflict", /NEVER raise a family member/.test(c));
  ok("...nor to analyse the relationship", /do not analyse the relationship/.test(c));

  const P = sv.PERSONAL_COMPANION_SYSTEM;
  ok("the persona carries the same rule (not just the context)", /NEVER raise a family member/.test(P));
  ok("...covering parents and siblings explicitly", /not his parents, not his siblings/.test(P));
  ok("...and forbids assigning motives", /assign motives/.test(P));

  const none = sv.capTodayContext(personalStore(), "p", "u1");
  ok("no household recorded -> the section is silent", !/The people in his life/.test(none));
}

console.log("\n--- FILE HAND-OFF (js/127): the door he can actually reach ---");
{
  const PF = fs.readFileSync(path.join(__dirname, "js", "127-files.js"), "utf8");
  const SVX = fs.readFileSync(path.join(__dirname, "sync-server.js"), "utf8");
  const STX = fs.readFileSync(path.join(__dirname, "js", "02-state.js"), "utf8");

  ok("the module is in the shell",
    fs.readFileSync(path.join(__dirname, "Business App (v1).html"), "utf8").indexOf('src="js/127-files.js"') > 0);
  /* ⚠️ MOVED 2026-08-25 — Ray: "Send me a file doesn't belong on today either." Today is what's happening
     today; handing me a statement is a Money errand, and Budget is where he'll be standing when he has one.
     The card must exist SOMEWHERE reachable, which is what this now asserts. */
  ok("the file card is reachable — on Budget, not Today",
    /pfCardHTML\(\)/.test(fs.readFileSync(path.join(__dirname, "js", "79-budget.js"), "utf8"))
    && !/h \+= pfCardHTML\(\)/.test(fs.readFileSync(path.join(__dirname, "js", "122-personal-home.js"), "utf8")));
  ok("collection in server COLLECTIONS", /"personalFiles"/.test(SVX));
  ok("collection in client blank()", /personalFiles:\[\]/.test(STX));
  eq("both load() backfills present", (STX.match(/personalFiles\)\)S\[b\]\.personalFiles=\[\]/g) || []).length, 2);

  ok("it accepts images, PDFs, csv AND svg", /accept = "image\/\*,application\/pdf,text\/csv,\.csv,\.svg"/.test(PF));
  ok("multiple files at once", /inp\.multiple = true/.test(PF));
  ok("it reuses jsUpload rather than a new endpoint", /await jsUpload\(/.test(PF));
  ok("a failed file doesn't abort the rest of the batch", /failed\.push/.test(PF));
  ok("each file keeps a note — an unlabelled blob is useless", /what is this\?/.test(PF));
  ok("...and it prompts for labels right after upload", /if \(ok\) pfOpenList\(true\)/.test(PF));
  ok("deletes are soft", /f\.deleted = true/.test(PF));
  ok("it warns against sending credentials", /Never put a password/.test(PF));

  /* run the real formatter + card against stubs */
  const els = {};
  const c = { console, JSON, Math, Date, String, Number, Array, Object,
    esc: x => String(x == null ? "" : x),
    D: () => ({ personalFiles: [
      { id: "f1", blobId: "aa.pdf", name: "nfcu-june.pdf", size: 240000, note: "NFCU June", ts: 2 },
      { id: "f2", blobId: "bb.csv", name: "cards.csv", size: 900, ts: 1 },
      { id: "f3", blobId: "cc.png", name: "gone.png", size: 10, deleted: true }
    ] }),
    S: { sync: { token: "t" } }, jsUpload: () => {}, document: { getElementById: id => (els[id] = els[id] || {}) } };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(PF, c);
  eq("deleted files are excluded", c.actFiles().length, 2);
  eq("bytes", c.pfSize(900), "900 B");
  eq("kilobytes", c.pfSize(240000), "234 KB");
  eq("megabytes", c.pfSize(5242880), "5.0 MB");
  const card = c.pfCardHTML();
  ok("the card renders", typeof card === "string" && card.length > 200);
  ok("it shows the label he typed, not the hex blob name", card.indexOf("NFCU June") > 0 && card.indexOf("aa.pdf") < 0);
  ok("it counts what I haven't read", /haven't read yet/.test(card), card);
  ok("a csv gets a different icon from a pdf", card.indexOf("📊") > 0 && card.indexOf("📄") > 0);
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
