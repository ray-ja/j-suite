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
    return { median: Math.round(vals[Math.floor(vals.length / 2)] * 100) / 100, months: used };
  } catch (e) { return null; }
}

/* ⭐ MONEY OWED TO HIM, from every org that keeps invoices. Read-only, cross-org via uniInOrg. */
function moOwed() {
  var total = 0, count = 0, overdue = 0, unbilled = 0, unbilledN = 0;
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
                   unbilled: rows.filter(function (x) { return x.action === "invoice"; })
                                 .reduce(function (s, x) { return s + (+x.balance || 0); }, 0),
                   unbilledN: rows.filter(function (x) { return x.action === "invoice"; }).length,
                   late: rows.filter(function (x) { return (+x.age || 0) > 30 && x.action === "chase"; })
                            .reduce(function (s, x) { return s + (+x.balance || 0); }, 0) };
        } catch (e) { return null; }
      }) : null;
      if (got) { total += got.sum; count += got.n; overdue += got.late; unbilled += got.unbilled; unbilledN += got.unbilledN; }
    });
  } catch (e) {}
  return { total: Math.round(total * 100) / 100, count: count, overdue: Math.round(overdue * 100) / 100,
           unbilled: Math.round(unbilled * 100) / 100, unbilledN: unbilledN };
}

function moRow(label, value, note, cls) {
  return '<div class="row mo-row' + (cls ? " " + cls : "") + '" style="gap:10px;align-items:baseline">'
    + '<div class="grow" style="min-width:0"><div class="mo-lab">' + esc(label) + '</div>'
    + (note ? '<div class="sub" style="white-space:normal">' + esc(note) + '</div>' : '') + '</div>'
    + '<div class="mo-val">' + esc(value) + '</div></div>';
}

function monthOutlookHTML() {
  var cash = moCashOnHand();
  var bills = moBillsAhead(30);
  var billTotal = bills.reduce(function (a, x) { return a + x.amount; }, 0);
  var typical = moTypicalMonth();
  var owed = moOwed();
  if (!cash && !bills.length && !typical && !owed.total) return "";

  var h = '<div class="card mo-card">'
    + '<div class="row" style="align-items:baseline;margin-bottom:2px"><div class="nm" style="font-size:15px">The month ahead</div></div>';

  h += cash
    ? moRow("In " + (cash.account.name || "your checking"), moMoney(cash.balance), "what you actually have", "mo-cash")
    : moRow("Personal checking", "not reconciled", "set a balance and this becomes a real number", "mo-soft");

  if (bills.length) {
    h += moRow("Bills due in 30 days", "−" + moMoney(billTotal),
      bills.length + " scheduled payment" + (bills.length === 1 ? "" : "s"), "mo-bill");
  }
  if (typical) {
    h += moRow("A typical month costs", "−" + moMoney(typical.median),
      "median of " + typical.months.join(", ") + " — includes the bills above, don't add them together", "mo-spend");
  }
  if (owed.total > 0) {
    /* ⭐⭐ SPLIT BY WHOSE MOVE IT IS. "not invoiced" is money he hasn't asked for — his to fix today.
       "waiting" is money he has asked for — theirs. Lumping them into one "owed" number hides the half he
       can act on this morning. */
    var note = owed.count + " unpaid · not counted below, because being owed money isn't having it";
    if (owed.unbilled > 0) note += " · " + moMoney(owed.unbilled) + " never invoiced ("
      + owed.unbilledN + " job" + (owed.unbilledN === 1 ? "" : "s") + ") — nobody has asked for that yet";
    if (owed.overdue > 0) note += " · " + moMoney(owed.overdue) + " invoiced over 30 days ago";
    h += moRow("Owed to you", "+" + moMoney(owed.total), note, "mo-owed");
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
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MO_MONTHS: MO_MONTHS };
}
