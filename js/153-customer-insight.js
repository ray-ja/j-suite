/* ---------- WHO PAYS, AND DID THE JOB PAY (js/153) ---------------------------------------------------
   Two questions the app has never been able to answer about his own work, both of which matter more than
   any budget screen if he is deciding whether to leave a $55/hr job.

   ⭐ 1. CONCENTRATION. One customer is the overwhelming majority of everything OBX has ever billed. That
   is the single largest risk in the business and nothing anywhere says it out loud. A lender would ask on
   the first page; a person betting their income on it should get to see it too.

   ⭐ 2. ESTIMATE vs ACTUAL. A stepping-stone job once came in at 60 person-hours against 20.4 estimated
   and nothing fed that back — so the same underbid can repeat forever. The gap between what he quoted and
   what he worked is the number that protects his rates.

   ⚠️ ATTRIBUTION IS A CHAIN, AND IT BREAKS. Income reaches a customer via quoteId → quote.customerId, or
   jobId → job → its quote. Some income has neither. ⛔ Unattributed revenue is reported AS unattributed
   rather than dropped or spread around, because a concentration number that quietly ignores a third of
   the money is worse than no number: it would understate exactly the risk it exists to show. */

function ciActive(a) { return (a || []).filter(function (x) { return x && !x.deleted; }); }
function ciRound(n) { return Math.round((+n || 0) * 100) / 100; }

/* the customer behind one income record, or "" when the chain doesn't reach one */
function ciCustomerOf(inc, d) {
  var q = null, j = null;
  if (inc.quoteId) q = ciActive(d.quotes).find(function (x) { return x.id === inc.quoteId; });
  if (!q && inc.jobId) {
    j = ciActive(d.jobs).find(function (x) { return x.id === inc.jobId; });
    if (j && j.quoteId) q = ciActive(d.quotes).find(function (x) { return x.id === j.quoteId; });
  }
  var cid = (q && q.customerId) || (j && j.customerId) || "";
  return cid;
}

/* ⭐ revenue by customer, for one org */
function ciByCustomer(orgId, from, to) {
  var run = function () {
    var d = D(), by = {}, unattributed = 0, total = 0;
    ciActive(d.income).forEach(function (i) {
      var dt = String(i.date || "");
      if (from && dt < from) return;
      if (to && dt > to) return;
      var amt = +i.amount || 0;
      total += amt;
      var cid = ciCustomerOf(i, d);
      if (!cid) { unattributed += amt; return; }
      by[cid] = by[cid] || { id: cid, amount: 0, jobs: {} };
      by[cid].amount += amt;
      if (i.jobId) by[cid].jobs[i.jobId] = 1;
    });
    /* ⭐ QUOTED IS A DIFFERENT QUESTION FROM COLLECTED, AND THE GAP IS THE POINT. On his live book Mike
       Green is 75.7% of the work quoted but only 36.5% of the cash received — so nearly all of what he is
       owed sits with one customer. Either number alone tells half the story and the wrong half. */
    var quoted = {}, tq = 0;
    ciActive(d.quotes).forEach(function (q) {
      var v = +(q.finalPrice || q.total || 0) || 0;
      if (!v || !q.customerId) return;
      quoted[q.customerId] = (quoted[q.customerId] || 0) + v; tq += v;
    });

    var ids = {}; Object.keys(by).forEach(function (k) { ids[k] = 1; }); Object.keys(quoted).forEach(function (k) { ids[k] = 1; });
    var list = Object.keys(ids).map(function (cid) {
      var c = ciActive(d.customers).find(function (x) { return x.id === cid; });
      var got = (by[cid] && by[cid].amount) || 0, bill = quoted[cid] || 0;
      return { id: cid, name: (c && (c.name || c.company)) || "(unknown)",
               amount: ciRound(got), quoted: ciRound(bill),
               outstanding: ciRound(Math.max(0, bill - got)),
               jobs: by[cid] ? Object.keys(by[cid].jobs).length : 0,
               share: total > 0 ? Math.round(got / total * 1000) / 10 : 0,
               quotedShare: tq > 0 ? Math.round(bill / tq * 1000) / 10 : 0 };
    }).sort(function (a, b) { return b.quoted - a.quoted; });

    return { customers: list, total: ciRound(total), totalQuoted: ciRound(tq),
             outstanding: ciRound(list.reduce(function (s, c) { return s + c.outstanding; }, 0)),
             unattributed: ciRound(unattributed),
             unattributedShare: total > 0 ? Math.round(unattributed / total * 1000) / 10 : 0,
             top: list[0] || null, count: list.length };
  };
  return (typeof uniInOrg === "function" && orgId) ? uniInOrg(orgId, run) : run();
}

/* ---------- estimate vs actual ---------- */
/* the hours a quote expected. Different estimators wrote it under different names over time, so try each
   rather than silently reporting "no estimate" for a job that has one. */
function ciEstHours(q) {
  if (!q) return null;
  var v = q.estHours != null ? q.estHours : (q.hours != null ? q.hours : (q.laborHours != null ? q.laborHours : null));
  var n = +v;
  return (v != null && isFinite(n) && n > 0) ? n : null;
}
/* the hours actually worked on a job, summed across everyone who clocked into it */
/* ⚠️ I GUESSED THESE FIELD NAMES FIRST AND THE WHOLE FEATURE SILENTLY RETURNED NOTHING. The timeclock
   stores `clockIn` / `clockOut`, not inAt/start/outAt/end. Every job came back with null actual hours, the
   card rendered empty, and nothing anywhere said "I couldn't find the data" — it just looked like he had
   no jobs to compare. A guessed field name fails exactly like an honest empty result. */
function ciStamp(v) {
  if (v == null || v === "") return 0;
  var n = +v;
  if (isFinite(n) && n > 1e11) return n;             // already ms
  var p = Date.parse(v);
  return isFinite(p) ? p : 0;
}
function ciActualHours(jobId, d) {
  var mins = 0;
  ciActive(d.timeclock).forEach(function (t) {
    if (t.jobId !== jobId) return;
    var a = ciStamp(t.clockIn), b = ciStamp(t.clockOut);
    if (a && b && b > a) mins += (b - a) / 60000;
    else if (+t.minutes) mins += +t.minutes;
  });
  return mins > 0 ? Math.round(mins / 60 * 10) / 10 : null;
}

function ciEstVsActual(orgId) {
  var run = function () {
    var d = D(), rows = [];
    ciActive(d.jobs).forEach(function (j) {
      var q = j.quoteId ? ciActive(d.quotes).find(function (x) { return x.id === j.quoteId; }) : null;
      var est = ciEstHours(q), act = ciActualHours(j.id, d);
      /* ⛔ only jobs where BOTH numbers exist — a missing one is not a zero */
      if (est == null || act == null) return;
      rows.push({ jobId: j.id, title: j.title || (q && q.cust) || "Job", date: j.date || "",
                  est: est, actual: act, ratio: Math.round(act / est * 100) / 100,
                  price: +((q && (q.finalPrice || q.total)) || 0) || 0 });
    });
    rows.sort(function (a, b) { return b.ratio - a.ratio; });
    var over = rows.filter(function (r) { return r.ratio > 1.15; });
    return { rows: rows, over: over,
             worst: rows[0] || null,
             perHour: rows.filter(function (r) { return r.price > 0; })
               .map(function (r) { return { title: r.title, rate: Math.round(r.price / r.actual * 100) / 100, hours: r.actual }; })
               .sort(function (a, b) { return a.rate - b.rate; }) };
  };
  return (typeof uniInOrg === "function" && orgId) ? uniInOrg(orgId, run) : run();
}

/* ---------- the card ---------- */
function ciMoney(n) { return (typeof budgetMoney === "function") ? budgetMoney(n) : "$" + (+n || 0).toFixed(2); }

function ciConcentrationHTML(orgId) {
  var g = ciByCustomer(orgId);
  if (!g || !g.customers.length) return "";
  var h = '<div class="secthd"><h2 style="font-size:13px">Who pays you</h2></div><div class="card">';

  g.customers.slice(0, 8).forEach(function (c) {
    var wide = Math.max(2, Math.min(100, c.quotedShare));
    var got = Math.max(0, Math.min(100, c.quoted > 0 ? (c.amount / c.quoted * 100) : 0));
    h += '<div style="padding:6px 0">'
      + '<div class="row" style="gap:8px;align-items:baseline">'
      +   '<div class="grow" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c.name) + '</div>'
      +   '<div class="sub" style="flex:0 0 auto">' + c.quotedShare + '% of work</div>'
      + '</div>'
      /* the outer bar is share of work quoted; the filled part is how much of it he has been PAID */
      + '<div style="height:6px;border-radius:3px;background:var(--line);margin-top:3px;width:' + wide + '%;min-width:8px">'
      +   '<div style="height:6px;border-radius:3px;width:' + got + '%;background:var(--accent)"></div></div>'
      + '<div class="sub" style="margin-top:2px">' + esc(ciMoney(c.quoted)) + ' quoted · '
      + esc(ciMoney(c.amount)) + ' collected'
      + (c.outstanding > 0.005 ? ' · <span style="color:var(--danger);font-weight:600">'
          + esc(ciMoney(c.outstanding)) + ' still owed</span>' : '')
      + '</div></div>';
  });

  /* ⭐ the sentences that are the whole point of the card */
  if (g.top && g.top.quotedShare >= 40) {
    h += '<div class="sub" style="white-space:normal;margin-top:10px;color:var(--danger);font-weight:600">'
      + esc(g.top.name) + ' is ' + g.top.quotedShare + '% of all the work you\'ve quoted. If that one '
      + 'customer stops calling, so does most of the business.</div>';
  }
  if (g.top && g.top.outstanding > 0.005 && g.outstanding > 0.005) {
    var sh = Math.round(g.top.outstanding / g.outstanding * 100);
    h += '<div class="sub" style="white-space:normal;margin-top:6px">And '
      + esc(ciMoney(g.outstanding)) + ' is still owed across everyone'
      + (sh >= 50 ? ' — ' + sh + '% of it by ' + esc(g.top.name) + '.' : '.')
      + '</div>';
  }
  /* ⛔ never hide the money the chain couldn't attribute */
  if (g.unattributed > 0.005) {
    h += '<div class="sub" style="white-space:normal;margin-top:8px">'
      + esc(ciMoney(g.unattributed)) + ' (' + g.unattributedShare + '%) isn\'t linked to a customer — '
      + 'income recorded without a job or quote. The percentages above are of everything, including it.</div>';
  }
  return h + '</div>';
}

function ciEstActualHTML(orgId) {
  var e = ciEstVsActual(orgId);
  if (!e || !e.rows.length) return "";
  var h = '<div class="secthd"><h2 style="font-size:13px">Quoted vs worked</h2></div><div class="card">';
  e.rows.slice(0, 8).forEach(function (r) {
    var bad = r.ratio > 1.15;
    h += '<div class="row" style="gap:8px;align-items:baseline;padding:5px 0;border-top:1px solid var(--line)">'
      + '<div class="grow" style="min-width:0"><div class="nm" style="font-size:14px;white-space:normal">' + esc(r.title) + '</div>'
      /* ⚠️ PERSON-hours: the timeclock is per crew member, so a three-man day is three times the clock.
         Saying just "hours" next to a quoted figure would look like a like-for-like comparison of elapsed
         time and it isn't. What it measures is what his LABOUR earned, which is the number that matters. */
      + '<div class="sub">' + r.est + 'h quoted · ' + r.actual + ' person-h worked'
      + (r.price ? ' · ' + esc(ciMoney(Math.round(r.price / r.actual * 100) / 100)) + '/hr' : '') + '</div></div>'
      + '<div style="flex:0 0 auto;font-variant-numeric:tabular-nums;font-weight:700;color:'
      + (bad ? 'var(--danger)' : 'var(--accent)') + '">' + (r.ratio > 1 ? '+' : '') + Math.round((r.ratio - 1) * 100) + '%</div></div>';
  });
  if (e.over.length) {
    h += '<div class="sub" style="white-space:normal;margin-top:8px">' + e.over.length + ' of ' + e.rows.length
      + ' took longer than quoted. Hours are summed across everyone who clocked in, so a three-man '
      + 'day counts three times — that is what your rate actually has to cover.</div>';
  }
  var cheap = e.perHour[0];
  if (cheap && cheap.rate > 0) {
    h += '<div class="sub" style="white-space:normal;margin-top:4px">Lowest actual rate: '
      + esc(ciMoney(cheap.rate)) + ' per person-hour on ' + esc(cheap.title)
      + '. Compare that with what an hour of your time is worth elsewhere.</div>';
  }
  return h + '</div>';
}

if (typeof window !== "undefined") {
  window.ciByCustomer = ciByCustomer; window.ciEstVsActual = ciEstVsActual;
  window.ciConcentrationHTML = ciConcentrationHTML; window.ciEstActualHTML = ciEstActualHTML;
  window.ciCustomerOf = ciCustomerOf; window.ciEstHours = ciEstHours; window.ciActualHours = ciActualHours;
}
if (typeof module !== "undefined" && module.exports) module.exports = { ciRound: ciRound };
