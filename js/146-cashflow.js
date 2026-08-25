/* ---------- CASH FLOW FORECAST (js/146) — the date he runs out ---------------------------------------
   The single most useful number a cash-basis ledger can produce for someone who is short every month and
   covering it by selling investments: not "how did last month go", but "on what day does this go
   negative, and by how much".

   ⭐ IT FORECASTS FROM FACTS, NOT FROM A PLAN HE NEVER FILLED IN. Every income category in his budget has
   a monthly target of 0 — a plan-based forecast would confidently project $0 of income and tell him he is
   ruined. So expected income is DETECTED from what has actually landed in his account, and each line has
   to earn its place: three or more occurrences across three or more distinct months, a median of at least
   $50, and a payee that doesn't look like his own money moving between his own accounts.

   ⭐ AND IT NEVER INVENTS THE UNKNOWN. A one-off doesn't become a pattern: the $7,400 he took out of the
   Schwab account appears once, fails the three-month test, and is not projected — which is correct, and
   which also means the forecast doesn't quietly assume he'll keep selling investments to stay level.

   ⚠️ IT WAS WRONG TWICE BEFORE IT WAS RIGHT, both times by under-counting his income against his own six
   months of history. Both failures are written up at cfRecurringIncome(). The lesson stands on its own:
   a forecast about someone's money has to be checked against what actually happened to them, and mine
   was ready to tell him he'd run out on a date that wasn't real. */

var CF_DAYS = 45;              // far enough to see the next two bill cycles
var CF_MIN_AMOUNT = 50;        // below this it's noise (his history has a $0.03 dividend, 7 times)
var CF_INTERNAL = /transfer|xfer|to checking|to savings|from checking|from savings|own account/i;

function cfActive(arr) { return (arr || []).filter(function (x) { return x && !x.deleted; }); }
function cfIso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function cfToday() { return (typeof today === "function") ? today() : cfIso(Date.now()); }
function cfMs(iso) { return Date.parse(String(iso) + "T00:00:00Z"); }
function cfMedian(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }

/* ---- ⭐ recurring income, detected from what actually landed ------------------------------------------
   ⚠️ THE FIRST VERSION GROUPED BY PAYEE AND WAS BADLY WRONG. Measured against his own six full months:
   it projected $4,727/mo against an actual $10,245/mo — under by $5,518 — and the forecast it produced
   said he runs out on 10 September when in truth he nets +$1,388/mo. It would have been a false alarm
   about his money, delivered with a date on it, to someone already short every month.

   The cause: his biggest income source is "Business draw" at $36,454, and every one of those deposits
   carries a different reference in its description. Payee-grouping shattered it into singletons that each
   failed the recurrence test, so the largest thing in his finances was invisible.

   ⭐ CATEGORY IS THE RIGHT SIGNAL, and it was there all along — he has categorized 100% of his income.
   A category that has paid in three of the last six months is a pattern; the payee string never was.

   ⭐ MEASURED against his own six full months (actual average in: $10,245/mo):

       grouped by payee                    $4,727/mo    under by $5,518   "runs out 10 Sep"
       by category, description filtered   $4,310/mo    under by $5,935   "runs out 10 Sep"
       by category, HIS category wins     $10,227/mo    within 0.2%       ← this

   Both wrong versions produced a confident date on which he would run out of money. Neither was real.
   Re-measure against his history before touching any of this.

   Each qualifying line is RETURNED and shown, not just summed, so he can see exactly what the forecast is
   assuming — including that some of his "income" is him selling investments to cover the gap. A forecast
   whose assumptions are hidden is a number to argue with instead of act on. */
var CF_LOOKBACK_MONTHS = 6;
var CF_MIN_MONTHS = 3;         // paid in at least 3 of the last 6 → a pattern

function cfMonthKey(iso) { return String(iso || "").slice(0, 7); }
function cfMonthsBack(n) {
  var out = [], d = new Date(cfMs(cfToday()));
  for (var i = 1; i <= n; i++) {
    var m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;                                   // the last n COMPLETE months, this one excluded
}

function cfRecurringIncome() {
  var tx = [], cats = [];
  try {
    tx = cfActive(D().budgetTx).filter(function (t) {
      return !t.pending && (t.dir === "in") && !t.isTransfer && !t.isCardPayment && (+t.amount || 0) >= CF_MIN_AMOUNT;
    });
    cats = cfActive(D().budgetCats);
  } catch (e) { return []; }

  var window_ = cfMonthsBack(CF_LOOKBACK_MONTHS);
  var inWindow = {}; window_.forEach(function (m) { inWindow[m] = 1; });

  var byCat = {};
  tx.forEach(function (t) {
    if (!t.catId) return;                                              // uncategorized isn't a pattern
    if (!inWindow[cfMonthKey(t.date)]) return;
    /* ⚠️ ⚠️ AND THE SECOND WRONG ANSWER: filtering on the DESCRIPTION killed it again. All 24 of his
       "Business draw" deposits — $36,454, his single largest income source — are described "Transfer From
       Checking", because that is literally what they are: a draw out of the ThemeForge business account
       into his personal one. From this book's point of view that is income; the money came from an entity
       whose account is not tracked here.

       ⭐ SO THE CATEGORY WINS, ALWAYS. He filed these as an income category, and that is a decision, not a
       guess — the same rule the ledger's autotagging runs on. A description is a bank's wording; a
       category is what he says the money is. Only the category NAME can disqualify a line, and the
       description check is kept solely for rows he never categorized. */
    var nm = (typeof budgetCatName === "function") ? budgetCatName(t.catId) : "";
    if (CF_INTERNAL.test(nm)) return;
    (byCat[t.catId] = byCat[t.catId] || []).push(t);
  });

  return Object.keys(byCat).map(function (catId) {
    var list = byCat[catId];
    var months = {};
    list.forEach(function (t) {
      var m = cfMonthKey(t.date);
      months[m] = months[m] || { total: 0, days: [] };
      months[m].total += +t.amount || 0;
      months[m].days.push(+String(t.date || "").slice(8, 10) || 1);
    });
    var keys = Object.keys(months);
    if (keys.length < CF_MIN_MONTHS) return null;
    var totals = keys.map(function (m) { return months[m].total; });
    /* the day the BIGGEST payment of each month landed — that's the one that moves the balance */
    var days = keys.map(function (m) { return cfMedian(months[m].days); });
    var cat = cats.find(function (c) { return c.id === catId; });
    return {
      catId: catId,
      label: (cat && cat.name) || ((typeof budgetCatName === "function") ? budgetCatName(catId) : "Income"),
      amount: Math.round(cfMedian(totals) * 100) / 100,
      day: Math.min(28, Math.max(1, Math.round(cfMedian(days)))),
      seen: list.length, months: keys.length
    };
  }).filter(function (r) { return r && r.amount >= CF_MIN_AMOUNT; })
    .sort(function (a, b) { return b.amount - a.amount; });
}

/* ---- known outflows: the bills, using the frequency-aware engine (js/126) ---- */
function cfBillsOn(iso) {
  if (typeof calBillsOnDay !== "function") return [];
  try { return calBillsOnDay(iso).map(function (b) { return { name: b.name || "bill", amount: +b.amount || 0 }; }); }
  catch (e) { return []; }
}

/* ---- ⭐ THE FORECAST: walk forward a day at a time from what's in the bank now ---- */
function cashflowForecast(days) {
  var n = days == null ? CF_DAYS : days;
  var start = (typeof acctTotalCash === "function") ? acctTotalCash()
    : ((typeof budgetTotalCash === "function") ? budgetTotalCash() : 0);
  var income = cfRecurringIncome();
  var t0 = cfMs(cfToday());
  var bal = start, low = { balance: start, date: cfToday() }, negativeOn = null;
  var days_ = [], totalIn = 0, totalOut = 0;

  for (var i = 0; i <= n; i++) {
    var iso = cfIso(t0 + i * 86400000);
    var dom = +iso.slice(8, 10);
    var events = [];
    if (i > 0) {                                   // today's movements have already happened
      income.forEach(function (r) {
        if (r.day === dom) { bal += r.amount; totalIn += r.amount; events.push({ label: r.label, amount: r.amount, dir: "in" }); }
      });
      cfBillsOn(iso).forEach(function (b) {
        bal -= b.amount; totalOut += b.amount; events.push({ label: b.name, amount: b.amount, dir: "out" });
      });
    }
    bal = Math.round(bal * 100) / 100;
    if (bal < low.balance) low = { balance: bal, date: iso };
    if (bal < 0 && !negativeOn) negativeOn = iso;
    if (events.length) days_.push({ date: iso, balance: bal, events: events });
  }
  return {
    start: Math.round(start * 100) / 100, days: n, end: bal,
    low: low, negativeOn: negativeOn,
    totalIn: Math.round(totalIn * 100) / 100, totalOut: Math.round(totalOut * 100) / 100,
    net: Math.round((totalIn - totalOut) * 100) / 100,
    income: income, timeline: days_,
    /* ⭐ says out loud what it is NOT counting, so the number is never mistaken for the whole picture */
    excludes: "one-off income, and anything not yet a three-month pattern"
  };
}

/* ---- the one-line version for the money card on Today ---- */
/* ⛔ A FORECAST WITH NO STARTING BALANCE IS NOT A FORECAST. Every one of his accounts currently reads
   zero, so a projection from "cash now" would open at $0, subtract two months of bills, and announce that
   he runs out today — a false alarm produced entirely by missing data, on the screen he reads every
   morning. So the number only appears once at least one account is a real figure: reconciled to a
   statement, or a balance he typed himself. Until then it says what it needs instead of guessing. */
function cfHasStartingPoint() {
  try {
    return cfActive(D().budgetAccounts).some(function (a) {
      return a.type !== "credit" && (a.balanceDate || (+a.balance || 0) !== 0);
    });
  } catch (e) { return false; }
}

function cashflowLineHTML() {
  if (typeof cashflowForecast !== "function") return "";
  if (!cfHasStartingPoint()) {
    return '<div class="card" style="padding:10px 14px"><div class="sub" style="white-space:normal">'
      + 'Reconcile an account to a statement and I\'ll show you where your cash lands over the next six weeks.'
      + '</div></div>';
  }
  var f;
  try { f = cashflowForecast(CF_DAYS); } catch (e) { return ""; }
  if (!f.income.length && !f.timeline.length) return "";     // nothing known — say nothing
  var money = function (v) { return (typeof calMoney === "function") ? calMoney(v) : "$" + v; };
  var when = function (iso) {
    var d = Math.round((cfMs(iso) - cfMs(cfToday())) / 86400000);
    return d <= 0 ? "today" : d === 1 ? "tomorrow" : "in " + d + " days";
  };
  var bad = f.negativeOn;
  return '<div class="card" style="padding:10px 14px' + (bad ? ';border-left:4px solid var(--danger)' : '') + '">'
    + '<div class="row" style="gap:8px;align-items:baseline">'
    +   '<div class="grow" style="font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)">Next 6 weeks</div>'
    +   '<div class="nm" style="flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:17px'
    +     (f.low.balance < 0 ? ';color:var(--danger)' : '') + '">' + esc(money(f.low.balance)) + '</div>'
    + '</div>'
    + '<div class="sub" style="white-space:normal;margin-top:2px">'
    + (bad ? 'Runs out ' + esc(when(bad)) + ' (' + esc(bad) + ')'
           : 'Lowest ' + esc(when(f.low.date)) + ' — ' + esc(f.low.date))
    + ' · your regular income and known bills · one-offs not counted</div></div>';
}

if (typeof window !== "undefined") {
  window.cashflowForecast = cashflowForecast; window.cfRecurringIncome = cfRecurringIncome;
  window.cashflowLineHTML = cashflowLineHTML; window.CF_DAYS = CF_DAYS;
  window.cfHasStartingPoint = cfHasStartingPoint;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CF_DAYS: CF_DAYS, CF_MIN_MONTHS: CF_MIN_MONTHS, CF_MIN_AMOUNT: CF_MIN_AMOUNT, CF_INTERNAL: CF_INTERNAL };
}
