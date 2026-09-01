/* ---------- MONTH OUTLOOK (js/165) — what's coming out, what's coming in, what's actually there --------
   Ray, 2026-08-27: "can we have, like, a little indicator that shows expected spending for the month based
   on history and bills and stuff like that versus how much cash is on hand in personal account? Well, like,
   literally my personal checking. not the business accounts." And then: "you can also include invoicing
   status to show money that is owed to us and use its invoice due date as expected money income… expected
   income shouldnt be relied upon though sometimes people are very late to pay. it should flag if cash is
   lower than expected expenses for the month."

   Four lines, in the order that decides anything: what he HAS, what is definitely leaving, what MIGHT
   arrive, and then — only if it matters — the gap between the first two.

   ⛔ PERSONAL CHECKING, NOT TOTAL CASH. He was explicit. A total that quietly folds in the Square balance
   and the Jamieson business account answers a different question and answers it reassuringly, which is the
   worst way to be wrong. The account is picked by rule and NAMED on the card, so a wrong guess is visible
   rather than silent.

   ⛔ EXPECTED INCOME IS NEVER ADDED TO CASH. "sometimes people are very late to pay" — so it is its own
   line, styled as soft, and the shortfall test ignores it completely. Money you are owed is not money you
   have, and a card that blends them would tell him he is fine on the strength of an invoice Mike Green has
   not looked at.

   ⚠️ AND THE TWO SPENDING NUMBERS ARE DIFFERENT QUESTIONS. "Bills" is what is scheduled and knowable.
   "A typical month" is the median of what actually left, which includes the bills AND everything else — so
   they are shown separately and NEVER added together. Summing them would double-count every bill he pays. */

var MO_MONTHS = 3;          // how many complete months the "typical" median is taken from

function moMoney(n) {
  try { return (typeof money === "function") ? money(n) : "$" + (+n || 0).toFixed(2); }
  catch (e) { return "$" + n; }
}
function moToday() { try { return (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function moActive(a) { return (a || []).filter(function (x) { return x && !x.deleted; }); }

/* ⭐ HIS PERSONAL CHECKING. Rule: a checking account in the personal book, the one he actually uses —
   measured by how many transactions it carries, because that is what "the one I use" means in data.
   ⛔ Returns the account, not a number, so the card can print its NAME and make the choice checkable. */
function moPersonalAccount() {
  try {
    var books = moActive(D().budgetBooks);
    var personal = books.filter(function (b) { return b.kind === "personal" && !b.linkedOrgId; });
    var ids = {};
    personal.forEach(function (b) { ids[b.id] = 1; });
    var cands = moActive(D().budgetAccounts).filter(function (a) {
      return a.type === "checking" && (ids[a.bookId] || !a.bookId);
    });
    if (!cands.length) return null;
    var tx = moActive(D().budgetTx);
    var count = {};
    tx.forEach(function (t) { if (t.accountId) count[t.accountId] = (count[t.accountId] || 0) + 1; });
    cands.sort(function (a, b) { return (count[b.id] || 0) - (count[a.id] || 0); });
    return cands[0];
  } catch (e) { return null; }
}
function moCashOnHand() {
  var a = moPersonalAccount();
  if (!a) return null;
  /* ⛔ null, not 0, when there is no anchor. "$0.00" is a claim; "not reconciled yet" is the truth, and the
     difference decides whether the shortfall warning below is real or an artefact of missing data. */
  if (!a.balanceDate) return null;
  var bal = (typeof acctBalanceAt === "function") ? acctBalanceAt(a, null) : (+a.balance || 0);
  return { account: a, balance: bal };
}

/* bills scheduled to leave in the next `days` — the knowable half of expected spending */
function moBillsAhead(days) {
  var t = moToday(), out = [], seen = {};
  try {
    var bills = moActive(D().budgetBills).filter(function (b) { return b.active !== false; });
    for (var i = 0; i <= (days || 30); i++) {
      var iso = (typeof tcalShift === "function") ? tcalShift(t, i) : "";
      if (!iso) break;
      bills.forEach(function (b) {
        if (typeof budgetBillNextDue !== "function" || budgetBillNextDue(b, iso) !== iso) return;
        var k = b.id + "|" + iso;
        if (seen[k]) return;
        seen[k] = 1;
        out.push({ bill: b, iso: iso, amount: +b.amount || 0 });
      });
    }
  } catch (e) {}
  return out;
}

/* ⭐ WHAT A MONTH ACTUALLY COSTS — the median of complete months, not an average.
   ⚠️ Median on purpose: one $11,297 month (June) would drag a mean up and make every other month look
   cheap by comparison. And COMPLETE months only — this month is half-finished and would read as a windfall.
   ⛔ Transfers and card payments excluded, or moving money between his own pockets counts as spending. */
/* ⭐ BILLS BY CALENDAR MONTH (Ray 2026-09-01: "I would rather it be sectioned by calendar month" — the
   rolling-30-day window caught the 1st-of-month bills twice and read ~$3k high). What's LEFT of this
   month, plus all of next month, each its own section. And the breakdown is a QUICK GLANCE, not a ledger:
   the four card payments sum to one "Credit cards" line, both car loans to one "Car loans" line, the
   small subscriptions to one line — big singular bills (rent, mortgage) keep their own. */
function moBillGroupKey(name) {
  var s = String(name || "").toLowerCase();
  if (/visa|chase|discover|citi|amex|credit|card/.test(s)) return "Credit cards";
  if (/car loan|auto loan|car payment/.test(s)) return "Car loans";
  if (/seaworld|subscription|\.com\b|spotify|netflix|hulu|pass\b/.test(s)) return "Subscriptions";
  return null;
}
function moBillsByMonth() {
  var t = moToday(), slots = {};
  try {
    var bills = moActive(D().budgetBills).filter(function (b) { return b.active !== false; });
    var mThis = t.slice(0, 7);
    var y = +t.slice(0, 4), m = +t.slice(5, 7); m++; if (m > 12) { m = 1; y++; }
    var mNext = y + "-" + String(m).padStart(2, "0");
    for (var i = 0; i <= 62; i++) {
      var iso = (typeof tcalShift === "function") ? tcalShift(t, i) : ""; if (!iso) break;
      var mo = iso.slice(0, 7);
      if (mo > mNext) break;
      if (mo !== mThis && mo !== mNext) continue;
      bills.forEach(function (b) {
        if (typeof budgetBillNextDue !== "function" || budgetBillNextDue(b, iso) !== iso) return;
        var slot = slots[mo] || (slots[mo] = { m: mo, total: 0, n: 0, singles: [], byG: {} });
        var amt = +b.amount || 0, g = moBillGroupKey(b.name);
        slot.total += amt; slot.n++;
        if (g) { var gr = slot.byG[g] || (slot.byG[g] = { label: g, n: 0, amount: 0 }); gr.n++; gr.amount += amt; }
        else slot.singles.push({ name: b.name || "—", iso: iso, amount: amt });
      });
    }
  } catch (e) {}
  var MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return Object.keys(slots).sort().map(function (mo) {
    var s = slots[mo];
    var rows = s.singles.map(function (r) { return { label: r.iso.slice(8) + " · " + r.name, amount: r.amount }; })
      .concat(Object.keys(s.byG).map(function (k) { var g = s.byG[k]; return { label: g.label + " × " + g.n, amount: Math.round(g.amount * 100) / 100 }; }));
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return { m: mo, label: MN[+mo.slice(5, 7) - 1] || mo, total: Math.round(s.total * 100) / 100, n: s.n, rows: rows };
  });
}
function moTypicalMonth() {
  try {
    var acctIds = {};
    var books = moActive(D().budgetBooks).filter(function (b) { return b.kind === "personal" && !b.linkedOrgId; });
    var bookIds = {}; books.forEach(function (b) { bookIds[b.id] = 1; });
    moActive(D().budgetAccounts).forEach(function (a) { if (bookIds[a.bookId]) acctIds[a.id] = 1; });

    var byMonth = {};
    moActive(D().budgetTx).forEach(function (t) {
      if (t.pending || t.isTransfer || t.isCardPayment) return;
      if ((t.dir || "out") !== "out") return;
      if (!acctIds[t.accountId]) return;
      var m = String(t.date || "").slice(0, 7);
      if (!m) return;
      byMonth[m] = (byMonth[m] || 0) + (+t.amount || 0);
    });
    var thisMonth = moToday().slice(0, 7);
    var months = Object.keys(byMonth).filter(function (m) { return m < thisMonth; }).sort();
    if (months.length < 2) return null;                 // two complete months is the least that means anything
    var used = months.slice(-MO_MONTHS);
    var vals = used.map(function (m) { return byMonth[m]; }).sort(function (a, b) { return a - b; });
    /* the BREAKDOWN behind the number (Ray 2026-09-01: "the math saying I need 12k/month doesn't seem
       right — make a breakdown show when I click on it"): each month's real total, plus the biggest
       payees of the most recent complete month so the number can be audited, not just believed. */
    var totals = used.map(function (m) { return { m: m, total: Math.round(byMonth[m] * 100) / 100 }; });
    var lastM = used[used.length - 1];
    var byWho = {};
    moActive(D().budgetTx).forEach(function (t) {
      if (t.pending || t.isTransfer || t.isCardPayment) return;
      if ((t.dir || "out") !== "out") return;
      if (!acctIds[t.accountId]) return;
      if (String(t.date || "").slice(0, 7) !== lastM) return;
      var k = String(t.payee || t.note || "—").toUpperCase().replace(/[0-9#*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 26) || "—";
      byWho[k] = (byWho[k] || 0) + (+t.amount || 0);
    });
    var top = Object.keys(byWho).map(function (k) { return { who: k, amount: Math.round(byWho[k] * 100) / 100 }; })
      .sort(function (a, b) { return b.amount - a.amount; }).slice(0, 8);
    return { median: Math.round(vals[Math.floor(vals.length / 2)] * 100) / 100, months: used,
             totals: totals, lastMonth: lastM, top: top };
  } catch (e) { return null; }
}
/* an expandable money-card row — the headline stays scannable, the receipts are one tap down */
function moRowExpand(label, value, note, cls, inner) {
  return '<details class="mo-x' + (cls ? " " + cls : "") + '"><summary class="row mo-row" style="gap:10px;align-items:baseline;cursor:pointer;list-style:none">'
    + '<div class="grow" style="min-width:0"><div class="mo-lab">' + esc(label) + ' <span class="mo-age">▾ breakdown</span></div>'
    + (note ? '<div class="sub" style="white-space:normal">' + esc(note) + '</div>' : '') + '</div>'
    + '<div class="mo-val">' + esc(value) + '</div></summary>'
    + '<div style="padding:2px 0 8px 2px">' + inner + '</div></details>';
}
function moXLine(l, r) {
  return '<div class="row" style="gap:10px;align-items:baseline"><div class="grow sub" style="min-width:0">' + esc(l) + '</div>'
    + '<div class="sub" style="font-variant-numeric:tabular-nums;flex:0 0 auto">' + esc(r) + '</div></div>';
}

/* ⭐ RENT COLLECTION IS ITS OWN LINE. Ray, 2026-08-27: "rent collection is separate line."
   And it genuinely is a different KIND of money: an invoice is a one-off he has to chase, rent is a standing
   arrangement that has arrived eight months running on the 28th–30th. Lumping them into one "expected
   income" number would let the reliable thing flatter the unreliable one.
   ⛔ Read from what has ACTUALLY LANDED, not from the lease: the median of past receipts, on the median day
   they arrived. If a tenant has been paying $2,520 rather than $2,795, this says $2,520. */
/* who a rent deposit is FROM — the bank note minus banking noise ("Zelle CR Alexis Soukup" → ALEXIS SOUKUP,
   'Paula Fugate "Aug rent"' → PAULA FUGATE). Two tenants = two standing arrangements; a single median over
   a $2,795 tenant and a $1,500 tenant would misprice both (that hid Paula's $1,500/mo entirely at first). */
function moRentWho(note) {
  var s = String(note || "").toUpperCase();
  s = s.replace(/"[^"]*"/g, " ");
  s = s.replace(/\b(ZELLE|CR|HARD|POST|DEPOSIT|ACH|PAID|FROM|TO|VENMO|CASHOUT|TRANSFER|RENT|RENTAL|INCOME|CHK)\b/g, " ");
  s = s.replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  return s || "RENT";
}
function moRentDue() {
  try {
    var cats = moActive(D().budgetCats).filter(function (c) { return /rent received|rental income/i.test(c.name || ""); });
    if (!cats.length) return null;
    var ids = {}; cats.forEach(function (c) { ids[c.id] = 1; });
    var got = moActive(D().budgetTx).filter(function (t) {
      return !t.pending && (t.dir || "out") === "in" && !t.isTransfer && ids[t.catId];
    }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    /* ⭐ ONE LINE PER TENANT: group the arrivals by payer, pattern each stream on its own evidence */
    var by = {};
    got.forEach(function (t) { var k = moRentWho(t.note); (by[k] = by[k] || []).push(t); });
    var t0 = moToday(), streams = [];
    Object.keys(by).forEach(function (k) {
      var g = by[k]; if (g.length < 3) return;          // three arrivals before calling it a pattern
      var recent = g.slice(-6);
      var amts = recent.map(function (t) { return +t.amount || 0; }).sort(function (a, b) { return a - b; });
      var days = recent.map(function (t) { return +String(t.date).slice(8, 10); }).sort(function (a, b) { return a - b; });
      var amount = amts[Math.floor(amts.length / 2)], day = days[Math.floor(days.length / 2)];
      var y = +t0.slice(0, 4), m = +t0.slice(5, 7), dom = +t0.slice(8, 10);
      if (dom > day) { m++; if (m > 12) { m = 1; y++; } }
      var next = y + "-" + String(m).padStart(2, "0") + "-" + String(Math.min(day, 28)).padStart(2, "0");
      streams.push({ who: k.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }),
        amount: Math.round(amount * 100) / 100, day: day, next: next, last: g[g.length - 1].date, n: g.length });
    });
    if (!streams.length) return null;
    streams.sort(function (a, b) { return a.day - b.day; });
    return { amount: Math.round(streams.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100, streams: streams };
  } catch (e) { return null; }
}

/* ⭐ WHAT ACTUALLY CAME IN OVER THE LAST 30 DAYS. Ray, 2026-08-27: "we can have a section that says how much
   I made in the last thirty days. I wouldn't mind that at all."
   ⛔ MONEY THAT LANDED, NOT MONEY THAT WAS EARNED. This reads deposits into his personal book — the same
   scope as the cash and spending lines above it, so the four numbers on this card are all about one pocket.
   Invoiced-but-unpaid work is NOT in here; that is the "owed to you" line, and the entire point of keeping
   them apart is that one of them is real money and the other is a hope with a name on it.
   ⛔ Transfers and card payments excluded — moving money between his own accounts is not making it. */
function moEarned30() {
  try {
    var bookIds = {};
    moActive(D().budgetBooks).filter(function (b) { return b.kind === "personal" && !b.linkedOrgId; })
      .forEach(function (b) { bookIds[b.id] = 1; });
    var acctIds = {};
    moActive(D().budgetAccounts).forEach(function (a) { if (bookIds[a.bookId]) acctIds[a.id] = 1; });
    /* ⛔ A REFUND IS NOT EARNINGS. His categories carry kind:"in"/"out", so a Target refund filed under
       "Everyday spending" is money arriving on an OUT category — a negative expense, not income. Counting it
       would have quietly added $8.15 of "earnings" that were only ever his own money coming back.
       ⚠️ Uncategorised money in still counts: it is more likely income he hasn't filed than a refund, and
       silently dropping it would understate the one number here that is meant to be a fact. */
    var outCat = {};
    moActive(D().budgetCats).forEach(function (c) { if (c.kind === "out") outCat[c.id] = 1; });
    var from = (typeof tcalShift === "function") ? tcalShift(moToday(), -30) : "";
    if (!from) return null;
    var total = 0, n = 0;
    moActive(D().budgetTx).forEach(function (t) {
      /* ⛔ isTransfer excluded, and that is RIGHT even though it removes his biggest-looking deposit.
         MEASURED: the $2,000 "Transfer from THEMEFORGE LLC" into his checking on 5 Aug has a real matching
         out-leg from Jamieson Business Checking ····5509 the same day. Both accounts are on this card now, so
         counting it would show the same $2,000 twice — once as a balance and once as income he'd just made. */
      if (t.pending || t.isTransfer || t.isCardPayment) return;
      if ((t.dir || "out") !== "in") return;
      if (!acctIds[t.accountId]) return;
      if (t.catId && outCat[t.catId]) return;
      var d = String(t.date || "");
      if (d < from || d > moToday()) return;
      total += +t.amount || 0; n++;
    });
    if (!n) return null;
    return { total: Math.round(total * 100) / 100, n: n, from: from };
  } catch (e) { return null; }
}

/* ⭐ MONEY OWED TO HIM, from every org that keeps invoices. Read-only, cross-org via uniInOrg. */
function moOwed() {
  var total = 0, count = 0, overdue = 0, unbilled = 0, unbilledN = 0, all = [];
  try {
    var orgs = (typeof uniOrgs === "function") ? uniOrgs() : [];
    orgs.forEach(function (o) {
      var got = (typeof uniInOrg === "function") ? uniInOrg(o.id, function () {
        try {
          if (typeof colOwed !== "function") return null;
          var rows = colOwed() || [];
          /* ⚠️ THE FIELD IS `age`, NOT `days` — caught by printing the real rows instead of trusting the
             shape. A silent undefined here would have made every "overdue" figure read $0 forever.
             ⭐ And colOwed already draws the distinction that matters more than age: `action` is "invoice"
             when nobody has ASKED for the money yet, and "chase" when they have and it hasn't come. An
             uninvoiced job is not a slow payer — it is a job he hasn't billed, and that is his move, not
             theirs. Worth far more on this card than a 30-day bucket. */
          return { sum: rows.reduce(function (s, x) { return s + (+x.balance || 0); }, 0),
                   n: rows.length,
                   /* ⭐ ITEMISED. Ray, 2026-08-27: "for expected income can you separate it by invoice with a
                      total?" A single "owed to you" figure is a mood, not information — $13,979 across six
                      invoices is six different conversations, and which of them he has not even SENT is the
                      part he can act on this morning. */
                   rows: rows.map(function (x) {
                     return { name: x.name || "—", amount: +x.balance || 0, age: +x.age || 0,
                              invoiced: x.action !== "invoice", org: o.name || o.id, id: x.id };
                   }),
                   unbilled: rows.filter(function (x) { return x.action === "invoice"; })
                                 .reduce(function (s, x) { return s + (+x.balance || 0); }, 0),
                   unbilledN: rows.filter(function (x) { return x.action === "invoice"; }).length,
                   late: rows.filter(function (x) { return (+x.age || 0) > 30 && x.action === "chase"; })
                            .reduce(function (s, x) { return s + (+x.balance || 0); }, 0) };
        } catch (e) { return null; }
      }) : null;
      if (got) { total += got.sum; count += got.n; overdue += got.late; unbilled += got.unbilled;
                 unbilledN += got.unbilledN; all = all.concat(got.rows || []); }
    });
  } catch (e) {}
  /* uninvoiced first — that is his move, not theirs — then biggest */
  all.sort(function (a, b) {
    if (a.invoiced !== b.invoiced) return a.invoiced ? 1 : -1;
    return b.amount - a.amount;
  });
  return { total: Math.round(total * 100) / 100, count: count, overdue: Math.round(overdue * 100) / 100,
           unbilled: Math.round(unbilled * 100) / 100, unbilledN: unbilledN, rows: all };
}

function moRow(label, value, note, cls) {
  return '<div class="row mo-row' + (cls ? " " + cls : "") + '" style="gap:10px;align-items:baseline">'
    + '<div class="grow" style="min-width:0"><div class="mo-lab">' + esc(label) + '</div>'
    + (note ? '<div class="sub" style="white-space:normal">' + esc(note) + '</div>' : '') + '</div>'
    + '<div class="mo-val">' + esc(value) + '</div></div>';
}

function monthOutlookHTML() {
  var cash = moCashOnHand();
  var billMonths = moBillsByMonth();
  var billCur = billMonths[0] || null, billNext = billMonths[1] || null;
  var bills = billCur ? billCur.rows : [];                   // truthiness guards below keep working
  var billTotal = billCur ? billCur.total : 0;               // THIS month's remaining — never double-counts the 1st-of-month bills
  var typical = moTypicalMonth();
  var owed = moOwed();
  if (!cash && !bills.length && !typical && !owed.total) return "";

  var h = '<div class="card mo-card">'
    + '<div class="row" style="align-items:baseline;margin-bottom:2px"><div class="nm" style="font-size:15px">The month ahead</div></div>';

  h += cash
    ? moRow("In " + (cash.account.name || "your checking"), moMoney(cash.balance), "what you actually have", "mo-cash")
    : moRow("Personal checking", "not reconciled", "set a balance and this becomes a real number", "mo-soft");

  /* ⭐ what actually landed — the only backward-looking line here, and the only one that is a fact */
  var earned = moEarned30();
  if (earned) {
    h += moRow("Came in — last 30 days", "+" + moMoney(earned.total),
      earned.n + " deposit" + (earned.n === 1 ? "" : "s") + " since " + earned.from
      + " · your personal book, and money moved between your own accounts doesn't count", "mo-earned");
  }
  if (billCur) {
    var billInner = billCur.rows.map(function (r) { return moXLine(r.label, "−" + moMoney(r.amount)); }).join("")
      + (billNext
        ? '<div class="sub" style="font-weight:700;margin-top:6px">' + esc(billNext.label) + ' — ' + esc(moMoney(billNext.total)) + '</div>'
          + billNext.rows.map(function (r) { return moXLine(r.label, "−" + moMoney(r.amount)); }).join("")
        : "");
    h += moRowExpand("Bills left in " + billCur.label, "−" + moMoney(billTotal),
      billCur.n + " payment" + (billCur.n === 1 ? "" : "s") + (billNext ? " · " + billNext.label + ": −" + moMoney(billNext.total) : ""), "mo-bill",
      billInner);
  }
  if (typical) {
    var typInner = (typical.totals || []).map(function (r) { return moXLine(r.m, "−" + moMoney(r.total)); }).join("")
      + ((typical.top || []).length
        ? '<div class="sub" style="font-weight:700;margin-top:6px">Biggest in ' + esc(typical.lastMonth || "") + '</div>'
          + typical.top.map(function (r) { return moXLine(r.who.toLowerCase(), "−" + moMoney(r.amount)); }).join("")
        : "");
    h += moRowExpand("A typical month costs", "−" + moMoney(typical.median),
      "median of " + typical.months.join(", ") + " — includes the bills above, don't add them together", "mo-spend",
      typInner);
  }
  /* ⭐⭐ TWO GROUPS, BECAUSE THEY ARE TWO DIFFERENT JOBS. Ray, 2026-08-27: "only the ones I haven't sent yet
     where the job's done but I haven't sent the invoice. Or the ones where I'm awaiting payment — I've
     already sent them but I'm awaiting payment. Those are the only invoices I need to see."
     ⚠️ THE PAID ONES WERE THERE BECAUSE A/R IGNORED `q.paid` — fixed at colBalance (js/154), where it
     belongs, rather than filtered out here. A card that hides a bad number still leaves the bad number in
     the books; the Collections screen and the Finance page read the same function and were both wrong too.
     ⭐ The split is by whose move it is: unsent is HIS to fix this morning, waiting is theirs. */
  var unsent = owed.rows.filter(function (r) { return !r.invoiced; });
  var waiting = owed.rows.filter(function (r) { return r.invoiced; });
  var invGroup = function (title, rows, cls, note) {
    if (!rows.length) return "";
    var sum = rows.reduce(function (a, r) { return a + r.amount; }, 0);
    return '<div class="mo-inv">'
      + '<div class="row mo-invhd" style="gap:8px;align-items:baseline">'
      +   '<div class="grow ' + cls + '">' + esc(title) + '</div>'
      +   '<div class="mo-invamt">' + esc(moMoney(sum)) + '</div>'
      + '</div>'
      + rows.slice(0, 6).map(function (r) {
          return '<div class="row mo-invrow" style="gap:8px;align-items:baseline">'
            + '<div class="grow" style="min-width:0">' + esc(r.name)
            + (r.age ? '<span class="mo-age"> · ' + r.age + 'd</span>' : '')
            + '</div><div class="mo-invamt">' + esc(moMoney(r.amount)) + '</div></div>';
        }).join("")
      + (rows.length > 6 ? '<div class="sub" style="padding-left:2px">+' + (rows.length - 6) + ' more</div>' : '')
      + (note ? '<div class="sub mo-unbilled">' + esc(note) + '</div>' : '')
      + '</div>';
  };

  /* ⭐ rent is a standing arrangement, not an invoice — its own line, on its own evidence */
  var rent = moRentDue();

  if (owed.total > 0 || rent) {
    var expected = owed.total + (rent ? rent.amount : 0);
    h += moRow("Expected in", "+" + moMoney(expected),
      "not counted as cash — being owed money isn't having it", "mo-owed");
    if (rent) {
      rent.streams.forEach(function (st) {
        h += '<div class="mo-inv"><div class="row mo-invrow" style="gap:8px;align-items:baseline">'
          + '<div class="grow" style="min-width:0">Rent — ' + esc(st.who) + '<span class="mo-age"> · due ' + esc(st.next) + '</span></div>'
          + '<div class="mo-invamt">' + esc(moMoney(st.amount)) + '</div></div>'
          + '<div class="sub mo-unbilled">' + st.n + ' received so far, last on ' + esc(st.last) + '</div></div>';
      });
    }
    h += invGroup("Not invoiced yet", unsent, "mo-unsent-hd",
      unsent.length ? "Work is done and nobody has been asked for the money. Your move." : "");
    h += invGroup("Waiting on payment", waiting, "mo-sent-hd", "");
  }

  /* ⭐⭐ THE DIFFERENCE, SAID OUT LOUD. Ray, 2026-08-27: "I'm not seeing the actual difference between, like,
     anticipated income and, uh, bills due." Fair — the card listed both and left him to do the subtraction in
     his head every morning, which is exactly the arithmetic a screen should have already done.
     ⛔ IT IS THE HOPEFUL SUM AND IT SAYS SO. Expected income is invoices plus rent, and he was explicit that
     "expected income shouldn't be relied upon — sometimes people are very late to pay." So this line is
     stated as conditional, and it is NOT the shortfall warning: the warning below still compares bills
     against cash he actually has. Two comparisons, deliberately different, both on the card. */
  if ((owed.total > 0 || rent) && billTotal > 0) {
    var expIn = owed.total + (rent ? rent.amount : 0);
    var diff = Math.round((expIn - billTotal) * 100) / 100;
    h += '<div class="mo-net' + (diff < 0 ? ' mo-net-bad' : '') + '">'
      + '<div class="row" style="gap:8px;align-items:baseline">'
      +   '<div class="grow">If all of that arrives</div>'
      +   '<div class="mo-val">' + (diff < 0 ? "−" : "+") + esc(moMoney(Math.abs(diff))) + '</div>'
      + '</div>'
      + '<div class="sub" style="white-space:normal">' + esc(moMoney(expIn)) + ' expected in against '
      + esc(moMoney(billTotal)) + ' of bills'
      + (diff < 0 ? ' — still short, even if everyone pays.' : ' — and that is only if everyone pays.')
      + '</div></div>';
  }

  /* ⭐⭐ THE FLAG. "it should flag if cash is lower than expected expenses for the month."
     ⛔ Compared against CASH ONLY — expected income is deliberately not in this sum. And it stays silent
     when the balance is unknown, because a shortfall computed from a missing number is not a warning, it is
     a bug that looks like one. */
  if (cash && billTotal > 0) {
    var gap = Math.round((billTotal - cash.balance) * 100) / 100;
    if (gap > 0) {
      var pct = billTotal > 0 ? Math.max(0, Math.min(100, Math.round(cash.balance / billTotal * 100))) : 0;
      h += '<div class="mo-flag">'
        + '<div class="mo-bar"><i style="width:' + pct + '%"></i></div>'
        + '<div style="white-space:normal">Your checking covers <b>' + pct + '%</b> of the next 30 days of bills — '
        + 'short by <b>' + esc(moMoney(gap)) + '</b>'
        + (owed.total >= gap ? '. You are owed ' + esc(moMoney(owed.total)) + ', which would cover it if it arrives.' : '.')
        + '</div></div>';
    } else {
      h += '<div class="mo-ok">Covers the next 30 days of bills, with ' + esc(moMoney(-gap)) + ' spare.</div>';
    }
  }
  return h + '</div>';
}

if (typeof window !== "undefined") {
  window.monthOutlookHTML = monthOutlookHTML; window.moPersonalAccount = moPersonalAccount;
  window.moCashOnHand = moCashOnHand; window.moBillsAhead = moBillsAhead;
  window.moTypicalMonth = moTypicalMonth; window.moOwed = moOwed;
  window.moEarned30 = moEarned30; window.moRentDue = moRentDue;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MO_MONTHS: MO_MONTHS };
}
