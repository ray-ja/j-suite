/* ---------- RENTAL DEPOSIT / REFUND handling (HOLD-OUT model — Ray 2026-07-06) ----------
   Renting a trailer/equipment, the vendor takes a refundable DEPOSIT (~$300) and later refunds part of it (+$90)
   on a different date → the TRUE cost is the net ($210). Ray's model is HOLD-OUT: an unsettled deposit is NOT
   counted as a job cost while it might still come back — the job never carries a temporarily-inflated cost. The
   owner SETTLES the deposit once the refund is known → it then counts at NET (deposit + refund).

   `depositHeld(rec)` is the exclusion predicate — it mirrors expenseIsTool(): a record flagged isDeposit (the
   deposit) OR carrying a refundOfId (a refund pointed at a deposit) that is NOT depositSettled is HELD → excluded
   from jobProfit / jobCostBreakdown / finPeriodPL / jobExpenseTotal (js/52, js/64, js/72). The record STAYS in
   job.expenses[] — nothing moves, nothing is re-amounted — so the raw-Σ sync/finance FINGERPRINTS are byte-
   identical (existing data has no deposits → depositHeld matches nothing → every sum is unchanged). Once settled,
   the signed Σ nets by construction: $300 deposit + −$90 refund = $210.

   Additive fields only (isDeposit / depositSettled / refundOfId / kind), NO new collection, NO record movement.
   Refund records are NEGATIVE (js/93 CSV keeps the sign; the js/87 "↩ refund" toggle stores −amount). */

/* ---- the HOLD-OUT predicate (same shape/role as expenseIsTool) ---- */
function depositHeld(rec) {
  return !!(rec && (rec.isDeposit || rec.refundOfId) && !rec.depositSettled);
}

/* ---- store scan helpers (job.expenses[] + job.materials[] carry deposits/refunds; no new collection) ---- */
function _depJobs() { return (typeof D === "function" && D() && Array.isArray(D().jobs)) ? D().jobs : []; }
function _depRecs(j) { return [].concat((j && j.expenses) || [], (j && j.materials) || []); }

/* ---- every non-deleted refund pointed at a given deposit id (a refund is a negative record) ---- */
function depositLinkedRefunds(depositId) {
  var out = [];
  if (!depositId) return out;
  _depJobs().forEach(function (j) { if (!j || j.deleted) return; _depRecs(j).forEach(function (r) { if (r && !r.deleted && r.refundOfId === depositId) out.push(r); }); });
  return out;
}

/* ---- the NET real cost of a deposit = the deposit amount + every linked refund. $300 + (−$90) = $210. ---- */
function depositNetCost(depositRec) {
  if (!depositRec) return 0;
  var net = +depositRec.amount || 0;
  depositLinkedRefunds(depositRec.id).forEach(function (r) { net += (+r.amount || 0); });
  return net;
}

/* ---- open, unsettled deposits across every job — feeds the "deposits awaiting refund" surface (js/72).
        [{deposit, job, refundSoFar (negative Σ of linked refunds), net, hasRefund}] ---- */
function depositsAwaitingRefund() {
  var out = [];
  _depJobs().forEach(function (j) {
    if (!j || j.deleted) return;
    _depRecs(j).forEach(function (r) {
      if (!r || r.deleted || !r.isDeposit || r.depositSettled) return;
      var refunds = depositLinkedRefunds(r.id);
      var refundSoFar = refunds.reduce(function (s, x) { return s + (+x.amount || 0); }, 0);   // <= 0
      out.push({ deposit: r, job: j, refundSoFar: refundSoFar, net: (+r.amount || 0) + refundSoFar, hasRefund: refunds.length > 0 });
    });
  });
  return out;
}

/* ---- SETTLE a deposit: mark the deposit AND all its linked refunds depositSettled (so depositHeld() is a clean
        per-record flag) → the group now counts at NET in job cost + the P&L. Touches each affected job + saves. ---- */
function depositSettle(depositId) {
  if (!depositId) return false;
  var t = (typeof now === "function") ? now() : Date.now();
  var found = false;
  _depJobs().forEach(function (j) {
    if (!j || j.deleted) return;
    var changed = false;
    _depRecs(j).forEach(function (r) {
      if (!r || r.deleted) return;
      if ((r.id === depositId && r.isDeposit) || r.refundOfId === depositId) {
        if (r.id === depositId) found = true;
        r.depositSettled = true; r.updatedAt = t; changed = true;
      }
    });
    if (changed && typeof touch === "function") touch(j);
  });
  if (found && typeof save === "function") save();
  return found;
}

/* ---- add a refund (negative) against a deposit, filed to the deposit's own job (so the group nets on that job) ---- */
function depositAddRefund(depositId, amount) {
  var amt = Math.abs(+amount || 0); if (!amt) return false;
  var dep = null, job = null;
  _depJobs().forEach(function (j) { if (!j || j.deleted) return; _depRecs(j).forEach(function (r) { if (r && !r.deleted && r.id === depositId && r.isDeposit) { dep = r; job = j; } }); });
  if (!dep || !job) return false;
  if (!Array.isArray(job.expenses)) job.expenses = [];
  var t = (typeof now === "function") ? now() : Date.now();
  job.expenses.push({
    id: (typeof uid === "function") ? uid() : ("ref_" + t + "_" + Math.random().toString(36).slice(2)),
    amount: -amt, vendor: dep.vendor || "", desc: "Refund of rental deposit" + (dep.vendor ? " · " + dep.vendor : ""),
    category: dep.category || "rentals", kind: "refund", refundOfId: depositId,
    by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: t, deleted: false, updatedAt: t
  });
  if (typeof touch === "function") touch(job);
  return true;
}

/* ---- a small badge for a receipt/expense row (js/72 vendor cell) ---- */
function rentalDepositBadge(rec) {
  if (!rec) return "";
  if (rec.isDeposit) return rec.depositSettled
    ? '<span class="badge" style="background:var(--soft);color:var(--muted)">🏗 deposit · settled</span>'
    : '<span class="badge" style="background:#e0a800;color:#fff">⚠ rental deposit — confirm the refund</span>';
  if (rec.kind === "refund" || rec.refundOfId) return '<span class="badge" style="background:#2d7a4f;color:#fff">↩ refund</span>';
  return "";
}

/* ============================== SETTLE UI (opened from the js/72 "deposits awaiting refund" card) ============================== */
window.depositSettleOpen = function (depositId) {
  if (typeof modal !== "function") return;
  var dep = null;
  _depJobs().forEach(function (j) { if (!j || j.deleted) return; _depRecs(j).forEach(function (r) { if (r && !r.deleted && r.id === depositId && r.isDeposit) dep = r; }); });
  if (!dep) { if (typeof toast === "function") toast("That deposit isn't here anymore."); if (typeof render === "function") render(); return; }
  var soFar = depositLinkedRefunds(depositId).reduce(function (s, x) { return s + (+x.amount || 0); }, 0);   // <= 0
  var m = (typeof money === "function") ? money : function (n) { return "$" + n; };
  modal("Settle rental deposit", ''
    + '<p class="muted" style="margin:0 0 8px;font-size:13px;white-space:normal">Deposit <b>' + m(dep.amount) + '</b>' + (dep.vendor ? ' · ' + (typeof esc === "function" ? esc(dep.vendor) : dep.vendor) : '') + '. While unsettled it is <b>HELD</b> — $0 on the job. Enter the refund that came back (leave blank if none), then settle so it counts at NET.</p>'
    + (soFar ? '<div class="sub" style="margin:0 0 6px">Refunds logged so far: <b>' + m(-soFar) + '</b></div>' : '')
    + '<label>Refund amount that came back ($)</label><input id="dep_refund_amt" type="number" inputmode="decimal" placeholder="0.00" style="width:100%">'
    + '<div class="sub" style="margin:4px 0 10px;white-space:normal">Stored as a negative credit on this job. Net cost = deposit − refund.</div>'
    + '<div class="row" style="gap:8px"><button class="btn ghost grow" onclick="depositMarkSettled(\'' + depositId + '\')">Mark settled (no refund)</button>'
    + '<button class="btn acc grow" onclick="depositSettleSave(\'' + depositId + '\')">✓ Log refund &amp; settle</button></div>');
};
window.depositSettleSave = function (depositId) {
  var el = document.getElementById("dep_refund_amt");
  var amt = el ? parseFloat(el.value) : NaN;
  if (amt > 0) depositAddRefund(depositId, amt);
  depositSettle(depositId);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof toast === "function") toast("Deposit settled" + (amt > 0 ? " — refund " + ((typeof money === "function") ? money(amt) : amt) + " logged; the job now counts the net" : " (no refund)"));
  if (typeof render === "function") render();
};
window.depositMarkSettled = function (depositId) {
  depositSettle(depositId);
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof toast === "function") toast("Deposit settled — counts at net on the job");
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") {
  window.depositHeld = depositHeld; window.depositNetCost = depositNetCost; window.depositLinkedRefunds = depositLinkedRefunds;
  window.depositsAwaitingRefund = depositsAwaitingRefund; window.depositSettle = depositSettle; window.depositAddRefund = depositAddRefund;
  window.rentalDepositBadge = rentalDepositBadge;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { depositHeld: depositHeld, depositNetCost: depositNetCost, depositLinkedRefunds: depositLinkedRefunds, depositsAwaitingRefund: depositsAwaitingRefund, depositSettle: depositSettle, depositAddRefund: depositAddRefund, rentalDepositBadge: rentalDepositBadge };
}
