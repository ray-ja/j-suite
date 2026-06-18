/* ---------- RECEIVABLES ("Who owes me money") — Finance > 💸 Owed (owner/admin) ----------
   Surfaces money that should be collected but isn't, so Ray actually sends invoices and gets paid.
   Two buckets, read off the existing quote lifecycle (accepted → invoiced → paid) — NO data layer:
     • Ready to bill  = accepted quote, work often done, but never invoiced  (the unbilled gap)
     • Awaiting pay   = invoiced, not paid                                   (overdue >14d flagged)
   Actions reuse the invoicing module (openInvoice) + the per-record LWW writes already on the quote
   (paid). Mobile-first: tap-to-call / text the customer to chase the money. */

const REC_OVERDUE_DAYS = 14;                         // "due on receipt" + grace before it's flagged overdue

function recCanView() { return (typeof finCanView === "function") ? finCanView() : true; }
function recCust(q) { return (D().customers || []).find(x => x && x.id === q.customerId) || null; }
function recWho(q) { return q.cust || (typeof custName === "function" ? custName(q.customerId) : "") || "—"; }
function recTel(q) { const c = recCust(q); return ((c && c.phone) || "").replace(/[^0-9+]/g, ""); }
function recDaysOld(dateStr) { if (!dateStr) return 0; const ms = new Date(today() + "T00:00:00") - new Date(dateStr + "T00:00:00"); return Math.max(0, Math.round(ms / 86400000)); }
function recJobDone(q) { if (!q.jobId) return false; const j = (D().jobs || []).find(x => x.id === q.jobId && !x.deleted); return !!(j && j.done); }

/* PURE-ish: split outstanding quotes into the two collection buckets, each sorted most-urgent-first */
function recBuckets() {
  const qs = (typeof actQ === "function" ? actQ() : []).filter(q => q && (q.total || 0) > 0 && !q.paid);
  const unbilled = qs.filter(q => q.accepted && !q.invoiced)
    .sort((a, b) => (recJobDone(b) - recJobDone(a)) || String(a.acceptedDate || a.date || "").localeCompare(String(b.acceptedDate || b.date || "")));
  const awaiting = qs.filter(q => q.invoiced && !q.paid)
    .sort((a, b) => recDaysOld(b.invoicedDate || b.date) - recDaysOld(a.invoicedDate || a.date));
  const sum = arr => arr.reduce((s, q) => s + (q.total || 0), 0);
  const overdue = awaiting.filter(q => recDaysOld(q.invoicedDate || q.date) > REC_OVERDUE_DAYS);
  return { unbilled, awaiting, overdue, owed: sum(awaiting), toBill: sum(unbilled) };
}

function recContactBtns(q) {
  const tel = recTel(q); if (!tel) return "";
  return `<a class="btn ghost sm" href="tel:${tel}" title="Call" onclick="event.stopPropagation()">📞</a>` +
         `<a class="btn ghost sm" href="sms:${tel}" title="Text" onclick="event.stopPropagation()">💬</a>`;
}

function recRow(q, kind) {
  const who = esc(recWho(q)), amt = money(q.total || 0);
  if (kind === "unbilled") {
    const done = recJobDone(q);
    const sub = (done ? "✅ job done · " : "") + (q.acceptedDate ? "accepted " + fmtDate(q.acceptedDate) : (q.date ? fmtDate(q.date) : "")) || "&nbsp;";
    return `<div class="li" style="align-items:center"><div class="grow"><div class="nm">${who} · ${amt}</div><div class="sub" style="white-space:normal">${sub}</div></div>
      <div class="row" style="gap:6px;flex:0 0 auto">${recContactBtns(q)}<button class="btn acc sm" onclick="openInvoice('${q.id}')">🧾 Bill</button></div></div>`;
  }
  const age = recDaysOld(q.invoicedDate || q.date), over = age > REC_OVERDUE_DAYS;
  const sub = `${over ? "🔴 " : ""}invoiced ${q.invoicedDate ? fmtDate(q.invoicedDate) : fmtDate(q.date)} · ${age}d ${over ? "OVERDUE" : "ago"}`;
  return `<div class="li" style="align-items:center"><div class="grow"><div class="nm" style="${over ? "color:var(--danger)" : ""}">${who} · ${amt}</div><div class="sub" style="white-space:normal">${sub}</div></div>
    <div class="row" style="gap:6px;flex:0 0 auto">${recContactBtns(q)}<button class="btn ghost sm" onclick="openInvoice('${q.id}')">View</button><button class="btn acc sm" onclick="recMarkPaid('${q.id}')">✓ Paid</button></div></div>`;
}

function rReceivables() {
  if (!recCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div></div>`;
  const b = recBuckets();
  let h = `<div class="card"><div class="row" style="gap:14px;flex-wrap:wrap">
      <div class="grow"><div class="sub">Owed (invoiced, unpaid)</div><div class="nm" style="font-size:22px;${b.overdue.length ? "color:var(--danger)" : ""}">${money(b.owed)}</div><div class="sub">${b.awaiting.length} invoice(s)${b.overdue.length ? ` · 🔴 ${b.overdue.length} overdue` : ""}</div></div>
      <div class="grow"><div class="sub">Ready to bill (unsent)</div><div class="nm" style="font-size:22px">${money(b.toBill)}</div><div class="sub">${b.unbilled.length} job(s) not invoiced</div></div>
    </div></div>`;
  if (!b.unbilled.length && !b.awaiting.length) {
    return h + `<div class="empty"><div class="big">🎉</div>All caught up — nothing outstanding.<br>Every accepted quote is invoiced and paid.</div>`;
  }
  if (b.unbilled.length) h += `<div class="secthd"><h2>🧾 Ready to bill — send these</h2><span class="ct">${money(b.toBill)}</span></div><div class="card">${b.unbilled.map(q => recRow(q, "unbilled")).join("")}</div>`;
  if (b.awaiting.length) h += `<div class="secthd"><h2>💸 Awaiting payment</h2><span class="ct">${money(b.owed)}</span></div><div class="card">${b.awaiting.map(q => recRow(q, "awaiting")).join("")}</div>`;
  return h;
}

/* Mark paid from the list (no modal reopen) — same fields/log as invMarkPaid, then re-render the list */
window.recMarkPaid = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  q.paid = true; q.paidDate = (typeof today === "function") ? today() : "";
  touch(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Marked paid · " + money(q.total || 0));
  save(); render();
};
