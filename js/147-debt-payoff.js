/* ---------- DEBT PAYOFF (js/147) — what it actually costs, and what extra actually buys ---------------
   His largest single leak is interest. Not a subscription, not a habit — $289/month on one card, ~$3,467
   a year, on a balance that barely moved across seven months of statements. The Debts tab already
   suggested an ORDER to pay in; what it could not say is the only thing that changes behaviour: how long
   this takes, what it costs, and what one more $100 a month would do to both.

   ⭐ THE SIMULATION IS MONTH-BY-MONTH, NOT A FORMULA. Amortisation closed-forms assume one rate, one
   payment, and no rollover. Real payoff has none of those: minimums are freed as cards clear and roll
   onto the next, and a promo rate expires mid-plan. A loop is honest about all three; a formula quietly
   isn't.

   ⚠️ PROMO RATES EXPIRE, AND HIS IS ABOUT TO. Citi Simplicity is 0% until 2026-09-24 and 28.24% after.
   A plan that assumed 0% forever would be wrong from that date and would rank that card LAST when it is
   about to become his most expensive. The simulation switches rate on the date, in the month it happens.

   ⛔ AND IT WILL SAY "NEVER". If the minimum payment is smaller than the monthly interest, the balance
   grows no matter how faithfully he pays — which is the actual situation on a card at 97-100% utilisation.
   Reporting a payoff date there would be a lie of the worst kind. It reports never, and says why. */

var DEBT_MAX_MONTHS = 600;      // 50 years — past this it isn't a payoff plan, it's a life sentence

function debtActive(arr) { return (arr || []).filter(function (x) { return x && !x.deleted; }); }

/* the debts, normalized: balance is what he OWES, as a positive number */
function debtList() {
  try {
    return debtActive(D().budgetAccounts).filter(function (a) { return a.type === "credit"; })
      .map(function (a) {
        var live = (typeof budgetAccountBalance === "function") ? budgetAccountBalance(a) : (+a.balance || 0);
        return { id: a.id, name: a.name || "Card", balance: live < 0 ? Math.round(-live * 100) / 100 : 0,
                 apr: +a.apr || 0, minPayment: +a.minPayment || 0,
                 promoUntil: a.promoUntil || "", promoApr: (a.promoApr === "" || a.promoApr == null) ? null : +a.promoApr };
      })
      .filter(function (d) { return d.balance > 0.005; });
  } catch (e) { return []; }
}

/* the rate in force for this debt in the month starting `iso` */
function debtRateOn(d, iso) {
  if (d.promoUntil && String(iso) <= String(d.promoUntil)) return (d.promoApr == null ? 0 : d.promoApr);
  return +d.apr || 0;
}
function debtMonthIso(startIso, i) {
  var y = +String(startIso).slice(0, 4), m = +String(startIso).slice(5, 7) - 1 + i;
  var dt = new Date(Date.UTC(y, m, 1));
  return dt.toISOString().slice(0, 10);
}

/* ⭐ THE SIMULATION. strategy: "min" | "avalanche" | "snowball". `extra` is dollars per month on top of
   the minimums, all of it aimed at the current target. */
function debtSimulate(debts, opts) {
  opts = opts || {};
  var extra = Math.max(0, +opts.extra || 0);
  var strategy = opts.strategy || "avalanche";
  var start = opts.start || ((typeof today === "function") ? today() : new Date().toISOString().slice(0, 10));
  var work = (debts || []).map(function (d) { return { id: d.id, name: d.name, balance: +d.balance || 0,
    apr: +d.apr || 0, minPayment: +d.minPayment || 0, promoUntil: d.promoUntil, promoApr: d.promoApr,
    interest: 0, clearedMonth: null }; }).filter(function (d) { return d.balance > 0.005; });
  if (!work.length) return { months: 0, totalInterest: 0, payoffIso: start, perDebt: [], stalled: false, stalledOn: [] };

  var totalInterest = 0, month = 0;
  for (month = 1; month <= DEBT_MAX_MONTHS; month++) {
    var iso = debtMonthIso(start, month);
    var open = work.filter(function (d) { return d.balance > 0.005; });
    if (!open.length) break;

    /* 1. interest for the month, at whatever rate is in force */
    open.forEach(function (d) {
      var r = debtRateOn(d, iso) / 100 / 12;
      var i = Math.round(d.balance * r * 100) / 100;
      d.balance += i; d.interest += i; totalInterest += i;
    });

    /* 2. minimums on everything (never more than the balance) */
    var pool = extra;
    open.forEach(function (d) {
      var pay = Math.min(d.minPayment, d.balance);
      d.balance = Math.round((d.balance - pay) * 100) / 100;
      /* ⭐ ROLLOVER: a cleared card's minimum doesn't vanish, it joins the attack. That is the whole
         mechanism behind both snowball and avalanche, and leaving it out understates every plan. */
      if (d.minPayment > pay) pool += (d.minPayment - pay);
    });
    if (strategy !== "min") {
      work.forEach(function (d) { if (d.balance <= 0.005 && d.clearedMonth != null) pool += d.minPayment; });
    }

    /* 3. everything spare goes at ONE target until it's gone */
    if (pool > 0 && strategy !== "min") {
      var live = work.filter(function (d) { return d.balance > 0.005; });
      var order = (strategy === "snowball")
        ? live.slice().sort(function (a, b) { return a.balance - b.balance; })
        : live.slice().sort(function (a, b) { return debtRateOn(b, iso) - debtRateOn(a, iso) || a.balance - b.balance; });
      for (var k = 0; k < order.length && pool > 0.005; k++) {
        var t = order[k], pay2 = Math.min(pool, t.balance);
        t.balance = Math.round((t.balance - pay2) * 100) / 100;
        pool = Math.round((pool - pay2) * 100) / 100;
      }
    }
    work.forEach(function (d) { if (d.balance <= 0.005 && d.clearedMonth == null) d.clearedMonth = month; });
  }

  /* ⛔ anything still owing after the cap is a debt the payments never catch */
  var stalled = work.filter(function (d) { return d.balance > 0.005; });
  return {
    months: stalled.length ? null : month - 1,
    payoffIso: stalled.length ? null : debtMonthIso(start, month - 1),
    /* ⛔ A STALLED PLAN HAS NO INTEREST TOTAL. Running the loop to its 600-month cap on a balance that
       grows every month accumulates a meaningless number — $3.5 BILLION on his Visa at a $250 minimum.
       Printed anywhere it reads as a bug, and reasoned about it corrupts every comparison. There is no
       total when the debt is never repaid; the honest answer is the stall itself. */
    totalInterest: stalled.length ? null : Math.round(totalInterest * 100) / 100,
    rawInterest: Math.round(totalInterest * 100) / 100,
    perDebt: work.map(function (d) { return { id: d.id, name: d.name, interest: Math.round(d.interest * 100) / 100,
      clearedMonth: d.clearedMonth, stillOwing: Math.round(Math.max(0, d.balance) * 100) / 100 }; }),
    stalled: stalled.length > 0,
    stalledOn: stalled.map(function (d) { return d.name; })
  };
}

/* minimums vs avalanche vs snowball, and what `extra` buys on top */
function debtCompare(extra) {
  var debts = debtList();
  if (!debts.length) return null;
  var min = debtSimulate(debts, { strategy: "min", extra: 0 });
  var ava = debtSimulate(debts, { strategy: "avalanche", extra: extra || 0 });
  var sno = debtSimulate(debts, { strategy: "snowball", extra: extra || 0 });
  /* interestSaved is only meaningful when BOTH plans actually finish */
  var saved = (min.stalled || ava.stalled || min.totalInterest == null || ava.totalInterest == null)
    ? null : Math.round((min.totalInterest - ava.totalInterest) * 100) / 100;
  return { debts: debts, total: Math.round(debts.reduce(function (s, d) { return s + d.balance; }, 0) * 100) / 100,
           minimums: Math.round(debts.reduce(function (s, d) { return s + d.minPayment; }, 0) * 100) / 100,
           min: min, avalanche: ava, snowball: sno, extra: extra || 0, interestSaved: saved };
}

/* ⚠️ a promo rate about to expire is a real date with real money behind it */
function debtPromoWarnings(withinDays) {
  var lim = withinDays == null ? 60 : withinDays;
  var t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
  var t0 = Date.parse(t + "T00:00:00Z");
  return debtList().filter(function (d) { return d.promoUntil && d.apr > (d.promoApr || 0); })
    .map(function (d) {
      var dd = Date.parse(String(d.promoUntil) + "T00:00:00Z");
      return { name: d.name, on: d.promoUntil, days: Math.round((dd - t0) / 86400000),
               from: (d.promoApr == null ? 0 : d.promoApr), to: d.apr, balance: d.balance };
    }).filter(function (w) { return w.days >= 0 && w.days <= lim; })
    .sort(function (a, b) { return a.days - b.days; });
}

if (typeof window !== "undefined") {
  window.debtList = debtList; window.debtSimulate = debtSimulate; window.debtCompare = debtCompare;
  window.debtPromoWarnings = debtPromoWarnings; window.debtRateOn = debtRateOn;
  window.DEBT_EXTRA = 0;
  window.debtSetExtra = function (v) {
    window.DEBT_EXTRA = Math.max(0, Math.round(+v || 0));
    var box = document.getElementById("debt_plan");
    if (box) box.innerHTML = debtPlanHTML();
  };
}

/* ---------- the card ---------- */
function debtMoney(n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + (+n || 0).toFixed(2); }
function debtDur(m) {
  if (m == null) return "never";
  if (m < 1) return "already clear";
  var y = Math.floor(m / 12), r = m % 12;
  return (y ? y + (y === 1 ? " yr" : " yrs") + (r ? " " + r + " mo" : "") : m + " months");
}

function debtPlanHTML() {
  var extra = (typeof window !== "undefined") ? (window.DEBT_EXTRA || 0) : 0;
  var c = debtCompare(extra);
  if (!c) return "";
  /* whichever actually costs less — usually avalanche, but not always, and a null (stalled) never wins */
  var ai = c.avalanche.totalInterest, si = c.snowball.totalInterest;
  var best = (ai == null) ? (si == null ? c.avalanche : c.snowball)
           : (si == null ? c.avalanche : (ai <= si ? c.avalanche : c.snowball));

  var h = '<div class="secthd"><h2>What it costs</h2></div><div class="card">';

  /* ⛔ the honest bad case, stated first because it changes what he should do */
  if (c.min.stalled) {
    h += '<div class="sub" style="white-space:normal;color:var(--danger);font-weight:600;margin-bottom:8px">'
      + 'Paying only the minimums, ' + esc(c.min.stalledOn.join(" and ")) + ' never clears — the interest is '
      + 'bigger than the payment, so the balance grows.</div>';
  } else {
    h += '<div class="row" style="gap:8px;align-items:baseline">'
      + '<div class="grow sub">Minimums only</div>'
      + '<div style="font-variant-numeric:tabular-nums">' + esc(debtDur(c.min.months)) + ' · '
      + esc(debtMoney(c.min.totalInterest)) + ' interest</div></div>';
  }

  /* ⭐ SHOW BOTH STRATEGIES, not just the winner. Avalanche is usually cheaper, but on his actual card
     terms snowball came out $9 ahead — the ordering interacts with the minimums and the promo expiry in
     ways no rule of thumb predicts. Telling him "do this one" hides that; showing both lets him weigh the
     cheaper plan against the one that clears a card sooner, which is a real preference and his to make. */
  var line = function (label, sim, isBest) {
    return '<div class="row" style="gap:8px;align-items:baseline;margin-top:6px">'
      + '<div class="grow sub" style="white-space:normal' + (isBest ? ';color:var(--ink);font-weight:600' : '') + '">'
      + esc(label) + '</div>'
      + '<div style="flex:0 0 auto;text-align:right;font-variant-numeric:tabular-nums'
      + (isBest ? ';font-weight:700' : '') + '">' + esc(debtDur(sim.months))
      + (sim.totalInterest == null ? '' : '<br><span class="sub">' + esc(debtMoney(sim.totalInterest)) + ' interest</span>')
      + '</div></div>';
  };
  var suffix = extra ? ' + ' + debtMoney(extra) + '/mo' : '';
  h += line("Highest rate first" + suffix, c.avalanche, best === c.avalanche);
  h += line("Smallest balance first" + suffix, c.snowball, best === c.snowball);
  if (best.stalled) {
    h += '<div class="sub" style="white-space:normal;margin-top:4px;color:var(--danger)">'
      + esc(best.stalledOn.join(" and ")) + ' still doesn\'t clear — the payment has to go up before any plan works.</div>';
  }

  /* ⭐ the lever: what one more slice a month actually buys */
  h += '<div class="sub" style="margin-top:10px">If you could put a bit more at it each month:</div>'
    + '<div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">'
    + [0, 50, 100, 200, 400].map(function (v) {
        return '<button class="btn ' + (extra === v ? 'acc' : 'ghost') + ' sm" style="flex:0 0 auto;width:auto"'
          + ' onclick="debtSetExtra(' + v + ')">' + (v ? '+$' + v : 'nothing extra') + '</button>';
      }).join("")
    + '</div>';

  h += '<div class="sub" style="white-space:normal;margin-top:8px">Order: '
    + c.debts.slice().sort(function (a, b) { return b.apr - a.apr; })
        .map(function (d) { return esc(d.name) + (d.apr ? " @ " + d.apr + "%" : ""); }).join(" → ")
    + '</div></div>';
  return h;
}

function debtPromoHTML() {
  var w = debtPromoWarnings(60);
  if (!w.length) return "";
  return w.map(function (x) {
    return '<div class="card" style="border-left:4px solid var(--danger)">'
      + '<div class="nm" style="font-size:14px">⏳ ' + esc(x.name) + ' — ' + esc(x.from) + '% ends in ' + x.days + ' days</div>'
      + '<div class="sub" style="white-space:normal;margin-top:2px">On ' + esc(x.on) + ' the rate becomes '
      + esc(String(x.to)) + '%. ' + (x.balance > 0 ? 'On ' + esc(debtMoney(x.balance)) + ' that is about '
        + esc(debtMoney(Math.round(x.balance * x.to / 100 / 12 * 100) / 100)) + ' a month in interest.' : '')
      + '</div></div>';
  }).join("");
}

if (typeof window !== "undefined") { window.debtPlanHTML = debtPlanHTML; window.debtPromoHTML = debtPromoHTML; window.debtDur = debtDur; }
if (typeof module !== "undefined" && module.exports) module.exports = { DEBT_MAX_MONTHS: DEBT_MAX_MONTHS };
