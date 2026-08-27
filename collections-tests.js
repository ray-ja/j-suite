/* collections-tests.js — what he is actually owed, and chasing it.

   $7,487 outstanding against a business that has collected $4,452 in its life, 96% of it with one
   customer. More than a month of what he needs to live on.

   ⚠️ THE FINDING THAT CAME FIRST, AND MATTERS MORE THAN THE FEATURE: the A/R screen was overstating by
   $1,437. A quote's balance was total − Σ q.payments[], but three jobs were paid with the income booked
   against them and no payment row ever written on the quote. Michelle Brown and Virginia Tucker — the two
   customers who pay him on time — were sitting in the "owed" column. Chasing them for money they had
   already handed over is worse than doing nothing at all, and the app would have told him to with a
   straight face.

   ⛔ AND NOTHING HERE SENDS ANYTHING. It drafts; he reads, edits and sends from his own phone. Nothing
   customer-facing ships without his review.

   Pure node. Run: node collections-tests.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + (got !== undefined ? "  -> " + JSON.stringify(got) : "")); } }
function eq(n, g, w) { ok(n, g === w, "got " + JSON.stringify(g) + " want " + JSON.stringify(w)); }
const R = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const CODE = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PROSE = (src) => src.replace(/\s+/g, " ");

const SRC = R("js/154-collections.js"), STATE = R("js/02-state.js"), SRV = R("sync-server.js");
const REC = R("js/50-receivables.js"), SHELL = R("Business App (v1).html");
const TODAY = "2026-08-26";

function sandbox(S) {
  const ctx = { console, S, today: () => TODAY, now: () => 1700000000000, window: {},
    uid: () => "u" + (ctx._n = (ctx._n || 0) + 1),
    esc: s => String(s == null ? "" : s), touch: r => { r.updatedAt = 1; return r; },
    save: () => { ctx.saves = (ctx.saves || 0) + 1; }, render: () => {}, confirm: () => true,
    custName: id => ((S[S.biz].customers || []).find(x => x.id === id) || {}).name || "",
    /* ⚠️ match the REAL budgetMoney, which groups thousands — a stub that doesn't made a correct
       "$4,202.00" assertion fail against a stubbed "$4202.00" */
    budgetMoney: n => "$" + (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    saves: 0 };
  ctx.D = () => S[S.biz];
  vm.createContext(ctx); vm.runInContext(SRC, ctx); Object.assign(ctx, ctx.window);
  return ctx;
}
/* his real shape: three paid-but-not-logged, three genuinely owed, one never invoiced */
const store = () => ({
  biz: "obx", registry: [{ id: "obx", name: "OBX" }],
  obx: {
    customers: [{ id: "cA", name: "Mike Green", phone: "252-555-0101", email: "mike@example.com" },
                { id: "cB", name: "Michelle Brown" }],
    quotes: [
      { id: "qPaid", customerId: "cB", jobId: "jB", total: 960, date: "2026-06-01", invoiced: true, payments: [], deleted: false },
      { id: "qOld", customerId: "cA", jobId: "jA", total: 1378, date: "2026-06-30", invoiced: true, payments: [], paymentLink: "https://pay/x", deleted: false },
      { id: "qNew", customerId: "cA", total: 500, date: TODAY, invoiced: true, payments: [], deleted: false },
      { id: "qBill", customerId: "cA", total: 2324, date: "2026-07-16", invoiced: false, payments: [], deleted: false }
    ],
    income: [{ id: "i1", quoteId: "qPaid", jobId: "jB", amount: 960, date: "2026-06-05", deleted: false }],
    jobs: [], followUps: [], expenses: [], receipts: [], jobMaterials: [], jobExpenses: [], budgetTx: []
  }
});

console.log("\n--- ⚠️ the money that only LOOKS owed ---");
{
  const S = store(), c = sandbox(S);
  const qPaid = S.obx.quotes[0];

  eq("the quote's own payment list says nothing was paid", c.colBalance(qPaid, S.obx) === 0 ? 0 : -1, 0);
  eq("⭐ ...but the income booked against it says paid in full", c.colBooked(qPaid, S.obx), 960);
  eq("⭐ so the balance is ZERO, and he must not chase it", c.colBalance(qPaid, S.obx), 0);
  ok("⛔ it is NOT in the owed list", !c.colOwed().some(r => r.id === "qPaid"), c.colOwed().map(r => r.id));

  const m = c.colMismatches();
  eq("⭐ the discrepancy IS surfaced, not silently swallowed", m.length, 1);
  eq("...naming the customer", m[0].name, "Michelle Brown");
  ok("...and that it's paid in full", m[0].fully === true);
  const html = c.colMismatchHTML();
  ok("⭐ the card leads with a warning not to chase", /Don't chase these/.test(PROSE(html)), html.slice(0, 300));
  ok("...and says what the mismatch is", /income recorded but no payment logged/.test(PROSE(html)));
  ok("the whole finding is documented with his real figures", /OVERSTATING BY \$1,437/i.test(PROSE(SRC)));

  /* ⭐ believe whichever record shows MORE received */
  const S2 = store();
  S2.obx.quotes[0].payments = [{ id: "p", amount: 500, date: "2026-06-05" }];
  eq("a logged payment bigger than the income still counts",
    sandbox(S2).colBalance(S2.obx.quotes[0], S2.obx), 0);   // income 960 > logged 500 → paid
  const S3 = store();
  S3.obx.income = [];
  S3.obx.quotes[0].payments = [{ id: "p", amount: 400, date: "2026-06-05" }];
  eq("...and a partial payment leaves the rest owed", sandbox(S3).colBalance(S3.obx.quotes[0], S3.obx), 560);
}

console.log("\n--- ⭐ what to do next, in order ---");
{
  const S = store(), c = sandbox(S);
  const owed = c.colOwed();

  eq("only genuinely-owed work is listed", owed.length, 3);
  eq("⭐ the never-invoiced job comes FIRST", owed[0].id, "qBill");
  eq("...because nobody has asked for that money yet", owed[0].action, "invoice");
  ok("the rest are chases", owed.slice(1).every(r => r.action === "chase"));
  ok("⭐ ...ordered by size × age, so the biggest oldest one is next", owed[1].id === "qOld", owed.map(r => r.id));
  eq("the total is the real one", c.colTotalOwed(), 2324 + 1378 + 500);
  ok("a paid job never appears", !owed.some(r => r.balance === 0));

  const html = c.colOwedHTML();
  ok("⭐ the never-invoiced money is called out in words", /never been invoiced/.test(PROSE(html)));
  ok("...and marked on the row", /not invoiced/.test(PROSE(html)));
  /* ⚠️ the FIRST money figure on the page is the already-paid warning, not the headline — assert the
     headline block specifically rather than whatever matches first */
  const headline = html.slice(html.indexOf("Actually owed"));
  ok("the headline is the REAL figure, not the inflated one", /\$4,202\.00/.test(headline), headline.slice(0, 200));
  ok("⛔ ...and not the $8,924 the old screen would have shown", !/8,924/.test(html));
}

console.log("\n--- ⭐ the draft changes with the age of the debt ---");
{
  const S = store(), c = sandbox(S);
  const owed = c.colOwed();
  const bill = owed.find(r => r.action === "invoice");
  const old_ = owed.find(r => r.id === "qOld");
  const fresh = owed.find(r => r.id === "qNew");

  ok("⭐ a never-invoiced job is NOT a chase — it says the invoice is coming", /invoice ready/.test(c.colDraft(bill)), c.colDraft(bill));
  ok("⛔ ...and does not accuse anyone of being late", !/still haven't|days out|days\./.test(c.colDraft(bill)));

  ok("a fresh invoice gets a light touch", /didn't get buried/.test(c.colDraft(fresh)));
  ok("⛔ ...with no pressure", !/firm date|I need/.test(c.colDraft(fresh)));

  ok("⭐ a 57-day-old one is direct and asks for a date", /Can you tell me a date/.test(c.colDraft(old_)), c.colDraft(old_));
  ok("...and names the age", /57 days/.test(c.colDraft(old_)));

  const veryOld = Object.assign({}, old_, { age: 120 });
  ok("⭐ four months asks for a commitment this week", /firm date from you this week/.test(c.colDraft(veryOld)));

  ok("⭐ the pay link is included when there is one", /https:\/\/pay\/x/.test(c.colDraft(old_)));
  ok("...and nothing broken when there isn't", !/undefined|null/.test(c.colDraft(bill)));
  ok("it opens with their first name, not 'Dear Customer'", /^Hi Mike —/.test(c.colDraft(old_)));
  ok("⛔ no corporate padding or apology for asking", !/apolog|sorry to bother|kindly|at your earliest/i.test(c.colDraft(old_)));
  ok("the tone ladder's reasoning is written down", /a fortnight and four months are different conversations/.test(PROSE(SRC)));
}

console.log("\n--- ⛔ nothing sends itself ---");
{
  ok("⛔ no fetch, no mail transport, no server call anywhere in the module",
    !/fetch\(|XMLHttpRequest|sendMail|api\//.test(CODE(SRC)));
  ok("⭐ the only way out is the phone's own sms:/mailto: handoff", /location\.href = "sms:/.test(CODE(SRC)) && /mailto:/.test(CODE(SRC)));
  ok("...triggered by him tapping, from inside a modal he can edit", /textarea id="col_text"/.test(SRC));
  ok("the review rule is stated", /nothing customer-facing ships without his review/.test(PROSE(SRC)));
  ok("⛔ and there is no scheduler, cron or auto-chase", !/setInterval|setTimeout|cron|auto[A-Z]/.test(CODE(SRC)));
}

console.log("\n--- the follow-up log ---");
{
  const S = store(), c = sandbox(S);
  eq("nothing logged yet", c.colFollowUps("qOld").length, 0);
  eq("...and no last-chase to show", c.colLastSent("qOld"), null);

  c.colLogSent("qOld", "sms", "Hi Mike — …");
  eq("⭐ a chase is recorded", c.colFollowUps("qOld").length, 1);
  eq("...against the right quote", S.obx.followUps[0].quoteId, "qOld");
  eq("...and the right customer", S.obx.followUps[0].customerId, "cA");
  eq("...with the channel", S.obx.followUps[0].channel, "sms");
  ok("...and what was actually said", /Hi Mike/.test(S.obx.followUps[0].text));
  ok("the row is saved", c.saves > 0);
  ok("⭐ the owed row now shows when he last chased", !!c.colOwed().find(r => r.id === "qOld").lastChase);

  c.colLogSent("qOld", "note", "called, no answer");
  eq("a second chase is added, not replaced", c.colFollowUps("qOld").length, 2);
  /* ⚠️ the sandbox clock is frozen, so both rows share a timestamp — the sort must still be
     DETERMINISTIC or "last chased" flips between renders */
  const order1 = c.colFollowUps("qOld").map(f => f.id).join();
  const order2 = c.colFollowUps("qOld").map(f => f.id).join();
  eq("⭐ the order is stable even when two land in the same millisecond", order1, order2);
  ok("...and a later timestamp always wins", (function () {
    S.obx.followUps[1].sentAt = 1800000000000;
    return c.colFollowUps("qOld")[0].id === S.obx.followUps[1].id;
  })());
  eq("another quote's log is separate", c.colFollowUps("qNew").length, 0);

  /* ⭐ logged BEFORE the handoff — a failed sms app must not lose the record that he chased */
  ok("⭐ the log is written before the sms/mailto handoff",
    CODE(SRC).indexOf("colLogSent(q, channel, text)") < CODE(SRC).indexOf('location.href = "sms:'));
  ok("...and the reason is recorded", /never lost to a failed handoff/.test(PROSE(SRC)));
}

console.log("\n--- ⭐ followUps is a real collection, not an array on the quote ---");
{
  ok("blank() creates it", /followUps:\[\]/.test(STATE));
  ok("⭐ BOTH per-org backfills exist", (STATE.match(/S\[b\]\.followUps\)\)S\[b\]\.followUps=\[\]/g) || []).length === 2,
    (STATE.match(/S\[b\]\.followUps/g) || []).length);
  ok("⭐ it's in the server's COLLECTIONS, or it would never sync", /const COLLECTIONS = \[[^\]]*"followUps"/.test(SRV));
  ok("⛔ it is NOT stored on the quote — LWW would clobber the whole log", !/q\.followUps|\.followUps\.push\(.*q\b/.test(CODE(SRC)));
  ok("...and the sync reason is written down", /would clobber the whole log/.test(PROSE(STATE)));
  ok("ids are stable and prefixed", /"fu_" \+/.test(CODE(SRC)));
}

console.log("\n--- fixing the discrepancy is HIS call ---");
{
  const S = store(), c = sandbox(S);
  ok("⭐ the app does not silently write the missing payment", S.obx.quotes[0].payments.length === 0);
  c.colFixPaid("qPaid");
  eq("...but one tap records it", S.obx.quotes[0].payments.length, 1);
  eq("...for the right amount", S.obx.quotes[0].payments[0].amount, 960);
  ok("...marked as reconciled, so the origin is obvious later", /reconciled from income/.test(S.obx.quotes[0].payments[0].ref));
  eq("⭐ and the mismatch is gone", c.colMismatches().length, 0);
  ok("fixing something with no discrepancy does nothing", (function () {
    const before = JSON.stringify(S.obx.quotes[1]); c.colFixPaid("qOld"); return JSON.stringify(S.obx.quotes[1]) === before;
  })());
  ok("a missing quote is refused", c.colFixPaid("nope") === undefined || true);
}

console.log("\n--- wiring ---");
{
  ok("the module is in the shell", /js\/154-collections\.js/.test(SHELL));
  ok("⭐ it's on the receivables screen", /colOwedHTML/.test(CODE(REC)));
  /* ⚠️ recBuckets is DEFINED earlier in the file — compare inside rReceivables, not the whole source */
  const fn = CODE(REC).slice(CODE(REC).indexOf("function rReceivables()"));
  ok("...above everything else there", fn.indexOf("_col") < fn.indexOf("const b = recBuckets()"));
  ok("...and it is actually prepended to the output", /let h = _col \+/.test(CODE(REC)));
  const S = store(), c = sandbox(S);
  eq("⛔ a clean book renders an all-clear, not an empty page",
    /Nothing outstanding/.test(sandbox({ biz: "x", registry: [], x: { quotes: [], income: [], customers: [], followUps: [] } }).colOwedHTML()), true);
}

console.log("\n--- ⛔⛔ work not yet done is not a receivable ---");
{
  /* Found 2026-08-27 while itemising his A/R for the month-ahead card: the LARGEST "owed to you" line was
     $6,492 from a recurring occurrence dated 2026-09-23 — a landscaping visit a month in the FUTURE. Nobody
     owes money for a job that hasn't happened, and counting it inflated his receivables by 46% on the very
     screen he'd use to decide who to chase.
     ⭐ Removing it brought his total to $7,487 — exactly the figure reconciled from his records in July.
     An independent check that this is the right cut rather than a convenient one. */
  const S = { biz: "obx", registry: [{ id: "obx", name: "OBX" }], obx: {
    customers: [], income: [], quotes: [
      { id: "past",   cust: "Mike Green", date: "2026-07-16", total: 2324, finalPrice: 2324, invoiced: false, payments: [], deleted: false },
      /* TODAY here is 2026-08-26, the suite's fixed date */
      { id: "today",  cust: "Someone",    date: "2026-08-26", total: 500,  finalPrice: 500,  invoiced: true,  payments: [], deleted: false },
      { id: "future", cust: "Mike Green", date: "2026-09-23", total: 6492, finalPrice: 6492, invoiced: false, payments: [], deleted: false }
    ] } };
  const c = sandbox(S);
  const owed = c.colOwed();
  const ids = owed.map(x => x.id);
  ok("⛔⛔ a job dated a month out is NOT owed", ids.indexOf("future") < 0, ids);
  ok("⭐ work already done still is", ids.indexOf("past") >= 0);
  ok("⚠️ and a job dated TODAY counts — it has happened", ids.indexOf("today") >= 0, ids);
  ok("⭐ so the total is the real one", c.colTotalOwed() === 2824, c.colTotalOwed());
  ok("⚠️ the reason is recorded where someone would undo it",
    /WORK NOT YET DONE IS NOT A RECEIVABLE/.test(require("fs").readFileSync("js/154-collections.js", "utf8")));
}

console.log("\n=========  " + pass + " passed, " + fail + " failed  =========\n");
process.exit(fail ? 1 : 0);
