/* ---------- RECEIPT ↔ BANK TRANSACTION (js/161) -----------------------------------------------------------
   Ray, 2026-08-27: "if i upload a receipt we should tie it to the transaction too."

   ⭐ THE DATA SAYS THIS IS WORTH DOING. Measured before building: of his 15 OBX receipts carrying an amount
   and a date, FOURTEEN match a real bank row on exact cents within three days. The two records are already
   describing the same purchase; nothing joins them.

   ⚠️ AND THEY LIVE IN DIFFERENT ORGS. Receipts sit in `obx`, because that is where job costing is. The bank
   ledger sits in the personal org, because that is where the books are. So every read here crosses an org
   boundary through uniInOrg (js/151), which swaps S.biz and restores it in a `finally` — the same door the
   unified ledger already uses. ⛔ Never reach into S[org] directly; the restore is the whole point.

   WHAT THE TIE IS WORTH, concretely:
     · the photo proves the bank row — a $71.99 Home Depot line stops being a name and becomes a receipt with
       line items, a job, and who bought it
     · the bank row dates the receipt — the real settle date, not the day he got round to photographing it
     · anything with a receipt and no bank row is a purchase that never cleared, or one paid from an account
       that isn't connected yet. Both are worth knowing and neither is visible today.

   ⛔ A TIE IS A LINK, NOT A MERGE. Both records stay exactly as they are. Nothing is created, nothing is
   recategorised, no amount moves. This writes two id fields and nothing else — which is why it is safe to
   suggest confidently and trivial to undo. */

var RT_DAYS = 3;            // a card settles a day or two after the purchase; three is generous, not loose

function rtMoney(n) { try { return (typeof money === "function") ? money(n) : "$" + (+n || 0).toFixed(2); } catch (e) { return "$" + n; } }
function rtCents(n) { return Math.round(Math.abs(+n || 0) * 100); }
function rtDays(a, b) {
  var x = Date.parse(String(a || "") + "T00:00:00Z"), y = Date.parse(String(b || "") + "T00:00:00Z");
  if (isNaN(x) || isNaN(y)) return 1e9;
  return Math.abs(x - y) / 86400000;
}

/* every spending row across every org, in one flat list. Read-only. */
function rtAllSpendRows() {
  var out = [];
  var orgs = (typeof uniOrgs === "function") ? uniOrgs() : [];
  orgs.forEach(function (o) {
    var rows = (typeof uniInOrg === "function") ? uniInOrg(o.id, function () {
      try {
        var d = D(), acct = {};
        (d.budgetAccounts || []).forEach(function (a) { if (a && !a.deleted) acct[a.id] = a.name; });
        return (d.budgetTx || []).filter(function (t) {
          return t && !t.deleted && (t.dir || "out") === "out" && !t.isTransfer && !t.isCardPayment;
        }).map(function (t) {
          return { id: t.id, org: o.id, orgName: o.name || o.id, date: t.date, amount: t.amount,
                   note: t.note, accountId: t.accountId, account: acct[t.accountId] || "",
                   pending: !!t.pending, receiptRef: t.receiptRef || "" };
        });
      } catch (e) { return []; }
    }) : null;
    if (rows && rows.length) out = out.concat(rows);
  });
  return out;
}

/* ⭐ SCORE, DON'T JUST FILTER. Two Lowe's runs on the same day for different amounts are common; so is one
   amount appearing twice. Ranking lets the screen show the best candidate AND admit when it isn't sure. */
function rtScore(receipt, row) {
  if (rtCents(receipt.amount) !== rtCents(row.amount)) return 0;      // ⛔ the amount is not negotiable
  var days = rtDays(receipt.date, row.date);
  if (days > RT_DAYS) return 0;
  var score = 60;
  score += Math.max(0, 20 - days * 6);                                // same day beats three days later
  var same = (typeof ledgerSamePayee === "function")
    ? ledgerSamePayee(receipt.vendor || receipt.desc, row.note) : false;
  if (same) score += 25;
  if (row.receiptRef) score -= 45;                                    // already spoken for by another receipt
  return score;
}

/* candidates for ONE receipt, best first. `rows` may be passed in (so a list screen fetches once). */
function rtCandidates(receipt, rows) {
  if (!receipt || !(+receipt.amount) || !receipt.date) return [];
  var all = rows || rtAllSpendRows();
  return all.map(function (r) { return { row: r, score: rtScore(receipt, r) }; })
    .filter(function (c) { return c.score > 0; })
    .sort(function (a, b) { return b.score - a.score; });
}

/* ⭐ CONFIDENT means one clear winner. Two candidates a hair apart is exactly when a machine should stop and
   ask — picking either would be a coin toss wearing a tick. */
function rtBest(receipt, rows) {
  var c = rtCandidates(receipt, rows);
  if (!c.length) return null;
  var top = c[0];
  var clear = c.length === 1 || (top.score - c[1].score) >= 20;
  return { row: top.row, score: top.score, confident: clear && top.score >= 80, others: c.length - 1 };
}

/* ---------- the panel, for the Receipts screen ---------- */
function rtReceiptLine(receipt) {
  if (!receipt || !(+receipt.amount) || !receipt.date) return "";
  if (receipt.txId) {
    return '<div class="sub" style="white-space:normal;color:var(--accent)">🔗 Tied to a bank transaction'
      + ' <a href="#" onclick="rtUntie(\'' + esc(receipt.id) + '\');return false" style="opacity:.75">untie</a></div>';
  }
  var best = rtBest(receipt);
  if (!best) {
    return '<div class="sub" style="white-space:normal;opacity:.75">No bank transaction matches this yet — '
      + 'it may not have cleared, or the card that paid it isn\'t connected.</div>';
  }
  var r = best.row;
  return '<div class="sub" style="white-space:normal">'
    + (best.confident ? '🔗 ' : '❓ ')
    + esc(r.date) + ' · ' + rtMoney(r.amount) + ' · ' + esc((r.account || r.orgName).slice(0, 28))
    + (best.others ? ' <span style="opacity:.7">(+' + best.others + ' other possible)</span>' : '')
    + ' <button class="btn ghost sm" style="width:auto;padding:1px 8px" onclick="rtTie(\'' + esc(receipt.id)
    + '\',\'' + esc(r.org) + '\',\'' + esc(r.id) + '\')">' + (best.confident ? 'Tie it' : 'Tie anyway') + '</button>'
    + '</div>';
}

if (typeof window !== "undefined") {
  window.rtCandidates = rtCandidates; window.rtBest = rtBest; window.rtScore = rtScore;
  window.rtAllSpendRows = rtAllSpendRows; window.rtReceiptLine = rtReceiptLine;

  /* ⛔ TWO ID FIELDS, BOTH SIDES, NOTHING ELSE. The receipt keeps its amount, job, category and photo; the
     transaction keeps its own. Either record can find the other, and untying leaves both exactly as found. */
  window.rtTie = function (receiptId, txOrg, txId) {
    try {
      var rec = null;
      (D().receipts || []).forEach(function (r) { if (r && r.id === receiptId) rec = r; });
      if (!rec) { alert("That receipt isn't here any more."); return; }
      var ok = uniInOrg(txOrg, function () {
        var t = (D().budgetTx || []).filter(function (x) { return x && x.id === txId; })[0];
        if (!t) return false;
        t.receiptRef = receiptId;
        t.receiptOrg = (typeof S !== "undefined") ? S.biz : "";
        if (typeof touch === "function") touch(t);
        return true;
      });
      if (!ok) { alert("That transaction isn't here any more."); return; }
      rec.txId = txId; rec.txOrg = txOrg;
      if (typeof touch === "function") touch(rec);
      if (typeof save === "function") save();
      if (typeof toast === "function") toast("Tied to the bank transaction");
      if (typeof render === "function") render();
    } catch (e) { alert("Couldn't tie it: " + ((e && e.message) || e)); }
  };

  window.rtUntie = function (receiptId) {
    try {
      var rec = (D().receipts || []).filter(function (r) { return r && r.id === receiptId; })[0];
      if (!rec) return;
      var txOrg = rec.txOrg, txId = rec.txId;
      if (txOrg && txId) {
        uniInOrg(txOrg, function () {
          var t = (D().budgetTx || []).filter(function (x) { return x && x.id === txId; })[0];
          if (t) { t.receiptRef = ""; t.receiptOrg = ""; if (typeof touch === "function") touch(t); }
          return true;
        });
      }
      rec.txId = ""; rec.txOrg = "";
      if (typeof touch === "function") touch(rec);
      if (typeof save === "function") save();
      if (typeof render === "function") render();
    } catch (e) {}
  };

  /* ⭐ tie every receipt whose best match is unambiguous. Only the confident ones — the rest stay on screen
     with their candidate shown, because a coin toss is not a match. */
  window.rtTieAllConfident = function () {
    var rows = rtAllSpendRows(), n = 0, skipped = 0;
    var recs = (D().receipts || []).filter(function (r) { return r && !r.deleted && !r.txId && +r.amount && r.date; });
    recs.forEach(function (r) {
      var b = rtBest(r, rows);
      if (b && b.confident) { rtTie(r.id, b.row.org, b.row.id); n++; }
      else if (b) skipped++;
    });
    if (typeof toast === "function") {
      toast(n + " tied" + (skipped ? " · " + skipped + " need a look — more than one could fit" : ""));
    }
    if (typeof render === "function") render();
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { rtScore: rtScore, rtCandidates: rtCandidates, rtBest: rtBest, RT_DAYS: RT_DAYS };
}
