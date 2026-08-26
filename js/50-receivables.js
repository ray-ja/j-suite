/* ---------- RECEIVABLES (A/R) — Finance > 💸 A/R (owner/admin) ----------
   Surfaces money to collect, records PAYMENTS against invoices (full or partial/deposits → q.payments[],
   additive on the quote, rides LWW), and ages the outstanding balance (Current / 1–30 / 31–60 / 61–90 / 90+).
   Buckets read off the quote lifecycle (accepted → invoiced → paid):
     • Ready to bill = accepted, not invoiced       • Awaiting pay = invoiced, balance > 0
   Recording a payment reconciles q.paid and syncs the income record (so the P&L + payouts reflect it). */

const REC_OVERDUE_DAYS = 14;
const PAY_METHODS = ["Cash", "Check", "Zelle", "Venmo", "Card", "ACH / bank", "Other"];

function recCanView() { return (typeof finCanView === "function") ? finCanView() : true; }
function recCust(q) { return (D().customers || []).find(x => x && x.id === q.customerId) || null; }
function recWho(q) { return q.cust || (typeof custName === "function" ? custName(q.customerId) : "") || "—"; }
function recTel(q) { const c = recCust(q); return ((c && c.phone) || "").replace(/[^0-9+]/g, ""); }
function recDaysOld(dateStr) { if (!dateStr) return 0; const ms = new Date(today() + "T00:00:00") - new Date(dateStr + "T00:00:00"); return Math.max(0, Math.round(ms / 86400000)); }
function recJobDone(q) { if (!q.jobId) return false; const j = (D().jobs || []).find(x => x.id === q.jobId && !x.deleted); return !!(j && j.done); }

/* payment math (dollars) */
function quoteTotalAmt(q) { return (q.finalPrice || q.total || 0); }
function quotePaidAmt(q) { return (q.payments || []).filter(p => p && !p.deleted).reduce((s, p) => s + (+p.amount || 0), 0); }
function quoteBalAmt(q) { return Math.max(0, quoteTotalAmt(q) - quotePaidAmt(q)); }
function recAgeBucket(days) { return days <= 0 ? "Current" : days <= 30 ? "1–30" : days <= 60 ? "31–60" : days <= 90 ? "61–90" : "90+"; }

function recBuckets() {
  const qs = (typeof actQ === "function" ? actQ() : []).filter(q => q && quoteTotalAmt(q) > 0 && !q.paid);
  const unbilled = qs.filter(q => q.accepted && !q.invoiced)
    .sort((a, b) => (recJobDone(b) - recJobDone(a)) || String(a.acceptedDate || a.date || "").localeCompare(String(b.acceptedDate || b.date || "")));
  const awaiting = qs.filter(q => q.invoiced && !q.paid)
    .sort((a, b) => recDaysOld(b.invoicedDate || b.date) - recDaysOld(a.invoicedDate || a.date));
  const sum = arr => arr.reduce((s, q) => s + quoteBalAmt(q), 0);
  const overdue = awaiting.filter(q => recDaysOld(q.invoicedDate || q.date) > REC_OVERDUE_DAYS);
  const aging = { "Current": 0, "1–30": 0, "31–60": 0, "61–90": 0, "90+": 0 };
  awaiting.forEach(q => { aging[recAgeBucket(recDaysOld(q.invoicedDate || q.date))] += quoteBalAmt(q); });
  return { unbilled, awaiting, overdue, owed: sum(awaiting), toBill: sum(unbilled), aging };
}

function recContactBtns(q) {
  const tel = recTel(q); if (!tel) return "";
  return `<a class="btn ghost sm" href="tel:${tel}" title="Call" onclick="event.stopPropagation()">📞</a>` +
         `<a class="btn ghost sm" href="sms:${tel}" title="Text" onclick="event.stopPropagation()">💬</a>`;
}

/* DERIVED lifecycle badge for an A/R row — surfaces expense-collecting ("N/M crew closed") vs
   invoice-ready straight from workStage. Pure display; changes no A/R math. */
function recStageBadge(q) {
  if (typeof workStage !== "function") return "";
  const st = workStage(q), m = (typeof workStageMeta !== "undefined" && workStageMeta[st]) || null;
  if (!m || st === "invoice") return "";   // "Invoice — ready to bill" is already the section context; skip the redundant badge
  const lbl = (typeof workStageLabel === "function") ? workStageLabel(q) : m.label;
  return ` <span class="badge" style="background:${m.color};color:#fff">${esc(lbl)}</span>`;
}
function recRow(q, kind) {
  const who = esc(recWho(q));
  if (kind === "unbilled") {
    const done = recJobDone(q);
    const sub = (done ? "✅ job done · " : "") + (q.acceptedDate ? "accepted " + fmtDate(q.acceptedDate) : (q.date ? fmtDate(q.date) : "")) || "&nbsp;";
    return `<div class="li" style="align-items:center"><div class="grow"><div class="nm">${who} · ${money(quoteTotalAmt(q))}${recStageBadge(q)}</div><div class="sub" style="white-space:normal">${sub}</div></div>
      <div class="row" style="gap:6px;flex:0 0 auto">${recContactBtns(q)}<button class="btn acc sm" onclick="openInvoice('${q.id}')">🧾 Bill</button></div></div>`;
  }
  const age = recDaysOld(q.invoicedDate || q.date), over = age > REC_OVERDUE_DAYS;
  const bal = quoteBalAmt(q), paid = quotePaidAmt(q), partial = paid > 0;
  const sub = `${over ? "🔴 " : ""}invoiced ${q.invoicedDate ? fmtDate(q.invoicedDate) : fmtDate(q.date)} · ${age}d ${over ? "OVERDUE" : "ago"}${partial ? ` · ${money(paid)} of ${money(quoteTotalAmt(q))} paid` : ""}`;
  return `<div class="li" style="align-items:center"><div class="grow"><div class="nm" style="${over ? "color:var(--danger)" : ""}">${who} · ${money(bal)}${partial ? ` <span class="sub" style="font-weight:400">still owed</span>` : ""}</div><div class="sub" style="white-space:normal">${sub}</div></div>
    <div class="row" style="gap:6px;flex:0 0 auto">${recContactBtns(q)}<button class="btn ghost sm" onclick="openInvoice('${q.id}')">View</button><button class="btn acc sm" onclick="recordPayment('${q.id}')">💵 Payment</button></div></div>`;
}

function rReceivables() {
  /* ⭐ what he is ACTUALLY owed, and the drafts to chase it (js/154). Above everything, because it opens
     with the money that only LOOKS owed — chasing a customer who already paid is the worst outcome here. */
  var _col = (typeof colOwedHTML === "function") ? colOwedHTML() : "";
  if (!recCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div></div>`;
  const b = recBuckets();
  let h = _col + `<div class="card"><div class="row" style="gap:14px;flex-wrap:wrap">
      <div class="grow"><div class="sub">Owed (outstanding balance)</div><div class="nm" style="font-size:22px;${b.overdue.length ? "color:var(--danger)" : ""}">${money(b.owed)}</div><div class="sub">${b.awaiting.length} invoice(s)${b.overdue.length ? ` · 🔴 ${b.overdue.length} overdue` : ""}</div></div>
      <div class="grow"><div class="sub">Ready to bill (unsent)</div><div class="nm" style="font-size:22px">${money(b.toBill)}</div><div class="sub">${b.unbilled.length} job(s) not invoiced</div></div>
    </div></div>`;
  if (b.awaiting.length) {
    const order = ["Current", "1–30", "31–60", "61–90", "90+"];
    h += `<div class="card"><div class="sub" style="font-weight:700;margin-bottom:8px">Aging — by invoice date</div><div class="row" style="gap:6px;flex-wrap:wrap">` +
      order.map(k => `<div class="grow" style="min-width:64px;text-align:center"><div class="sub">${k}</div><div class="nm" style="font-size:15px;${(k === "61–90" || k === "90+") && b.aging[k] > 0 ? "color:var(--danger)" : ""}">${money(b.aging[k])}</div></div>`).join("") + `</div></div>`;
  }
  if (!b.unbilled.length && !b.awaiting.length) {
    return h + `<div class="empty"><div class="big">🎉</div>All caught up — nothing outstanding.<br>Every accepted quote is invoiced and paid.</div>`;
  }
  if (b.unbilled.length) h += `<div class="secthd"><h2>🧾 Ready to bill — send these</h2><span class="ct">${money(b.toBill)}</span></div><div class="card">${b.unbilled.map(q => recRow(q, "unbilled")).join("")}</div>`;
  if (b.awaiting.length) h += `<div class="secthd"><h2>💸 Awaiting payment</h2><span class="ct">${money(b.owed)}</span></div><div class="card">${b.awaiting.map(q => recRow(q, "awaiting")).join("")}</div>`;
  return h;
}

/* ---- payments ---- */
window.recordPayment = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  const bal = quoteBalAmt(q), pays = (q.payments || []).filter(p => p && !p.deleted).sort((a, c) => (a.date < c.date ? 1 : -1));
  modal("Record payment — " + esc(recWho(q)), `
    <div class="sub" style="margin-bottom:8px">Invoice ${money(quoteTotalAmt(q))}${quotePaidAmt(q) > 0 ? ` · ${money(quotePaidAmt(q))} already paid` : ""} · <b>${money(bal)} owed</b></div>
    <div class="row" style="gap:8px"><div class="grow"><label>Amount ($)</label><input id="pay_amt" type="number" inputmode="decimal" value="${bal.toFixed(2)}"></div>
      <div class="grow"><label>Date</label><input id="pay_date" type="date" value="${today()}"></div></div>
    <label>Method</label><select id="pay_method">${PAY_METHODS.map(m => `<option>${m}</option>`).join("")}</select>
    <label>Reference — check # / confirmation (optional)</label><input id="pay_ref" placeholder="optional">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="savePayment('${q.id}')">Record payment</button>
    ${pays.length ? `<div class="sub" style="font-weight:700;margin-top:14px">Payments so far</div>` + pays.map(p => `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${money(p.amount)} <span class="sub" style="font-weight:400">${esc(p.method || "")}</span></div><div class="sub">${fmtDate(p.date)}${p.ref ? " · " + esc(p.ref) : ""}</div></div><button class="btn ghost sm" onclick="delPayment('${q.id}','${p.id}')">✕</button></div>`).join("") : ""}`);
};
window.savePayment = function (quoteId) {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner / Admin only."); return; }   // S5: defense-in-depth
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  const amt = parseFloat(val("pay_amt")) || 0; if (amt <= 0) { alert("Enter the payment amount."); return; }
  const date = val("pay_date") || today();
  if (!Array.isArray(q.payments)) q.payments = [];
  q.payments.push({ id: uid(), amount: amt, date: date, method: val("pay_method") || "", ref: val("pay_ref") || "", by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: now() });
  recReconcilePaid(q, date);
  touch(q); if (typeof syncQuoteIncome === "function") syncQuoteIncome(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Payment " + money(amt) + (val("pay_method") ? " · " + val("pay_method") : ""));
  save(); closeModal(); render();
};
window.delPayment = function (quoteId, payId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  const p = (q.payments || []).find(x => x && x.id === payId); if (!p) return;
  if (!confirm("Remove this payment?")) return;
  p.deleted = true; recReconcilePaid(q, q.paidDate || today());
  touch(q); if (typeof syncQuoteIncome === "function") syncQuoteIncome(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Removed payment " + money(p.amount || 0));
  save(); closeModal(); render();
};
/* derive q.paid from the payments; paidDate = the date it crossed fully paid (cash-basis income date) */
function recReconcilePaid(q, lastDate) {
  const total = quoteTotalAmt(q), fully = total > 0 && quotePaidAmt(q) >= total - 0.005;
  if (fully && !q.paid) { q.paid = true; q.paidDate = lastDate || today(); }
  else if (!fully && q.paid) { q.paid = false; q.paidDate = ""; }
}

/* quick full-payment (back-compat for any caller) — records the balance as one payment, then reconciles */
window.recMarkPaid = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  if (!Array.isArray(q.payments)) q.payments = [];
  const bal = quoteBalAmt(q);
  if (bal > 0) q.payments.push({ id: uid(), amount: bal, date: today(), method: "", ref: "", by: ((typeof curUser === "function" && curUser()) ? curUser().username : ""), ts: now() });
  recReconcilePaid(q, today());
  touch(q); if (typeof syncQuoteIncome === "function") syncQuoteIncome(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Marked paid · " + money(quoteTotalAmt(q)));
  save(); render();
};
