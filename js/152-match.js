/* ---------- MATCHING (js/152) — the bank row and the receipt are the same dollar --------------------
   This is the piece that has to exist before he can safely link a BUSINESS bank account.

   He logs a Lowe's receipt on the job. Three days later the bank feed delivers the same purchase. Both are
   true records of one $46.52, and if both count he has spent $93.04. QuickBooks solves this by MATCHING a
   downloaded transaction to an existing record instead of adding a second one, and that is what this does.

   ⭐ WHICH RECORD WINS. The business record does. It carries the category, the job it belongs to, who paid,
   the tax fields, the receipt image — the bank row only knows that money left. So a matched ledger row is
   marked as the CASH CONFIRMATION of that record, and the business record stays the thing that counts. It
   also means js/40, js/64, the tax report and the payout waterfall keep working untouched.

   ⚠️ AND THE THIRD GATE. This app now has three different questions that each filter transactions
   differently, and matching lands on all three in different directions:

       income & spending   →  SKIP a matched row (the business record already counts it)
       unified ledger      →  SKIP a matched row (same reason, across every entity)
       account balance     →  COUNT it. The cash genuinely left the bank.

   That is the same shape as splits and transfers, for the third time. Get the balance one backwards and
   his reconciliation drifts by every matched purchase, silently, forever. */

var MATCH_DAYS = 5;               // a card posts a few days after the receipt
var MATCH_CENTS = 2;              // a couple of cents of tip/rounding is still the same purchase

function mtActive(a) { return (a || []).filter(function (x) { return x && !x.deleted; }); }
function mtCents(n) { return Math.round(Math.abs(+n || 0) * 100); }
function mtDayGap(a, b) {
  var x = Date.parse(String(a || "") + "T00:00:00Z"), y = Date.parse(String(b || "") + "T00:00:00Z");
  if (isNaN(x) || isNaN(y)) return 9999;
  return Math.abs(x - y) / 86400000;
}

/* ⭐ every business record that could be this bank row, across EVERY entity — because his OBX card
   purchases land in a personal-looking feed and the expense lives in the OBX org. */
function matchCandidates(row, opts) {
  opts = opts || {};
  var days = opts.days == null ? MATCH_DAYS : opts.days;
  var want = mtCents(row && row.amount);
  if (!want) return [];
  var out = [];
  var orgs = (typeof uniOrgs === "function") ? uniOrgs() : [];

  orgs.forEach(function (o) {
    var scan = (typeof uniInOrg === "function") ? uniInOrg : function (id, fn) { return fn(); };
    scan(o.id, function () {
      var d = D();
      var consider = function (rec, kind, date, label, jobId) {
        if (!rec || rec.deleted) return;
        if (Math.abs(mtCents(rec.amount) - want) > MATCH_CENTS) return;
        var gap = mtDayGap(date, row.date);
        if (gap > days) return;
        /* ⛔ never offer a record that is already matched to a different row */
        if (rec.matchedByTxId && rec.matchedByTxId !== row.id) return;
        out.push({ orgId: o.id, orgName: o.name || o.id, kind: kind, id: rec.id,
          amount: +rec.amount || 0, date: date, label: label || "", jobId: jobId || "", gap: gap });
      };

      if ((row.dir || "out") === "out") {
        mtActive(d.expenses).forEach(function (e) {
          if (e.unpaid) return;                       // a bill isn't cash yet — it can't be this
          consider(e, "expense", e.date, e.desc || e.vendor || e.note || "Expense");
        });
        mtActive(d.jobs).forEach(function (j) {
          var list = (typeof plExpenses === "function") ? plExpenses(j) : (j.expenses || []);
          mtActive(list).forEach(function (e) {
            consider(e, "jobExpense", e.date || j.date, e.desc || e.vendor || "Job cost", j.id);
          });
        });
      } else {
        mtActive(d.income).forEach(function (i) {
          consider(i, "income", i.date, i.invoice ? ("Invoice " + i.invoice) : "Job income", i.jobId);
        });
      }
      return null;
    });
  });

  /* closest in time first — a same-day match is far more likely than one five days out */
  return out.sort(function (a, b) { return a.gap - b.gap; }).slice(0, 5);
}

/* the single best candidate, or null when it isn't clear enough to offer */
function matchBest(row) {
  var c = matchCandidates(row);
  if (!c.length) return null;
  /* ⛔ two records at the same amount and the same distance is ambiguous — offering one at random is how
     a purchase gets attached to the wrong job. Make him choose rather than guessing. */
  if (c.length > 1 && c[1].gap === c[0].gap) return null;
  return c[0];
}

/* ⭐ LINK. The ledger row becomes the cash confirmation; the business record keeps counting. */
function matchLink(txId, cand) {
  if (!cand || !cand.id) return null;
  var d = D();
  var t = mtActive(d.budgetTx).find(function (x) { return x.id === txId; });
  if (!t) return null;
  t.matchedTo = { org: cand.orgId, kind: cand.kind, id: cand.id };
  t.catId = "";                                   // ⛔ it must never ALSO carry a category
  if (typeof touch === "function") touch(t);

  /* stamp the other side too, so a second bank row can't claim the same record */
  if (typeof uniInOrg === "function") {
    uniInOrg(cand.orgId, function () {
      var dd = D(), rec = null;
      if (cand.kind === "expense") rec = mtActive(dd.expenses).find(function (x) { return x.id === cand.id; });
      else if (cand.kind === "income") rec = mtActive(dd.income).find(function (x) { return x.id === cand.id; });
      else mtActive(dd.jobs).some(function (j) {
        var list = (typeof plExpenses === "function") ? plExpenses(j) : (j.expenses || []);
        rec = mtActive(list).find(function (x) { return x.id === cand.id; });
        return !!rec;
      });
      if (rec) { rec.matchedByTxId = txId; if (typeof touch === "function") touch(rec); }
      return null;
    });
  }
  if (typeof save === "function") save();
  return t;
}

function matchUnlink(txId) {
  var d = D();
  var t = mtActive(d.budgetTx).find(function (x) { return x.id === txId; });
  if (!t || !t.matchedTo) return null;
  var was = t.matchedTo;
  if (typeof uniInOrg === "function") {
    uniInOrg(was.org, function () {
      var dd = D(), all = (dd.expenses || []).concat(dd.income || []);
      (dd.jobs || []).forEach(function (j) {
        var list = (typeof plExpenses === "function") ? plExpenses(j) : (j.expenses || []);
        (list || []).forEach(function (e) { all.push(e); });
      });
      var rec = all.find(function (x) { return x && x.id === was.id; });
      if (rec && rec.matchedByTxId === txId) { rec.matchedByTxId = ""; if (typeof touch === "function") touch(rec); }
      return null;
    });
  }
  t.matchedTo = null;
  if (typeof touch === "function") touch(t);
  if (typeof save === "function") save();
  return t;
}

function matchIsMatched(t) { return !!(t && t.matchedTo && t.matchedTo.id); }

/* the line the review queue shows */
function matchRowHTML(t) {
  if (matchIsMatched(t)) {
    return '<div class="sub" style="white-space:normal;margin-top:4px;color:var(--accent)">'
      + '🔗 Already recorded in ' + esc(t.matchedTo.org) + ' — approving just confirms the cash left.'
      + ' <a href="#" onclick="mtUnlink(\'' + t.id + '\');return false">not a match</a></div>';
  }
  var best = matchBest(t);
  if (!best) return "";
  var money = (typeof budgetMoney === "function") ? budgetMoney(best.amount) : "$" + best.amount;
  return '<div class="card" style="padding:8px 10px;margin-top:6px;border-left:3px solid var(--accent)">'
    + '<div class="sub" style="white-space:normal">Looks like the ' + esc(best.label) + ' you already logged in '
    + esc(best.orgName) + ' on ' + esc(best.date) + ' (' + esc(money) + ').</div>'
    + '<button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="mtLink(\'' + t.id + '\')">'
    + 'Same purchase — don\'t count it twice</button></div>';
}

if (typeof window !== "undefined") {
  window.matchCandidates = matchCandidates; window.matchBest = matchBest;
  window.matchLink = matchLink; window.matchUnlink = matchUnlink;
  window.matchIsMatched = matchIsMatched; window.matchRowHTML = matchRowHTML;
  window.MATCH_DAYS = MATCH_DAYS;

  window.mtLink = function (txId) {
    var t = mtActive(D().budgetTx).find(function (x) { return x.id === txId; });
    if (!t) return;
    var best = matchBest(t);
    if (!best) return;
    matchLink(txId, best);
    if (typeof render === "function") render();
  };
  window.mtUnlink = function (txId) { matchUnlink(txId); if (typeof render === "function") render(); };
}
if (typeof module !== "undefined" && module.exports) module.exports = { MATCH_DAYS: MATCH_DAYS, MATCH_CENTS: MATCH_CENTS };
