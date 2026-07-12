/* ---------- INVOICING (generate a customer invoice from a quote) ----------
   Turns an existing quote into a shareable / printable invoice. Stays OUT of the data layer:
   no new synced collection — it reads the quote + customer, and the only writes are a few small
   fields ON the existing quote record (invoiced / invoiceNo / invoicedDate / paid), which already
   ride the per-record LWW sync. Print = a standalone window; reminder reuses Message Templates. */

/* stable, counter-free invoice number from the quote (date + last 4 of id) */
function invNo(q) {
  if (q.invoiceNo) return q.invoiceNo;
  const ds = (q.date || (typeof today === "function" ? today() : "")).replace(/-/g, "");
  return "INV-" + (ds || "00000000") + "-" + String(q.id || "").slice(-4).toUpperCase();
}
function invItems(q) {
  return (q.items || []).filter(it => it && (it.name || it.serviceId));
}
function invRowsHTML(q) {
  return invItems(q).map(it =>
    `<tr><td>${esc(it.name || "Item")}</td><td style="text-align:center">${it.qty || 1}</td><td style="text-align:right">${money((it.price || 0) * (it.qty || 1))}</td></tr>`
  ).join("") || `<tr><td colspan="3" style="color:#888">No line items on this quote.</td></tr>`;
}
/* The invoice must charge the FINAL price (finalPrice override), not the raw line-item subtotal — A/R collects
   against quoteEffectiveTotal, so a divergent invoice document meant the customer's bill and what we chased didn't
   match (a set-final-price job would show the old number, then sit "awaiting payment" forever). When the final price
   differs from the line-item subtotal, show a Subtotal + Adjustment pair so the document still reconciles. */
function invEffectiveTotal(q) { return (typeof quoteEffectiveTotal === "function") ? quoteEffectiveTotal(q) : (+(q.finalPrice || q.total) || 0); }
function invAdjRows(q) {
  const sub = invItems(q).reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const adj = Math.round((invEffectiveTotal(q) - sub) * 100) / 100;
  if (Math.abs(adj) < 0.005) return "";
  return `<tr><td colspan="2" style="text-align:right;padding-top:6px">Subtotal</td><td style="text-align:right;padding-top:6px">${money(sub)}</td></tr>`
    + `<tr><td colspan="2" style="text-align:right">Adjustment</td><td style="text-align:right">${adj < 0 ? "−" : "+"}${money(Math.abs(adj))}</td></tr>`;
}
/* the amount the CUSTOMER actually pays = service total + NC sales tax when the quote is taxable */
function invAmountDue(q) { return (typeof quoteTotalWithTax === "function") ? quoteTotalWithTax(q) : invEffectiveTotal(q); }
/* AUTO-GENERATE a Stripe card-payment link for THIS invoice's exact amount (server-side, using the restricted key
   saved in Settings — the key never touches the client). Saves the URL to q.paymentLink so the invoice shows the
   "Pay online" button. Owner/admin only. */
window.invGenPayLink = async function (quoteId) {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner / Admin only."); return; }
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  const amt = invAmountDue(q);
  if (!(amt >= 0.5)) { alert("The invoice amount must be at least $0.50 to create a card link."); return; }
  const cust = (typeof custName === "function" && q.customerId) ? custName(q.customerId) : (q.cust || "");
  const job = (typeof quoteType === "function" && quoteType(q)) || q.title || "Services";
  const label = ("OBX Lot Solutions · " + invNo(q) + (cust ? (" · " + cust) : "") + " · " + job).slice(0, 120);
  const base = (S.sync && S.sync.url) || "", tok = (S.sync && S.sync.token) || "";
  if (!base) { alert("Sync isn't set up on this device, so I can't reach Stripe from here."); return; }
  const btn = document.getElementById("inv_genlink_" + quoteId);
  if (btn) { btn.disabled = true; btn.textContent = "Making link…"; }
  try {
    const r = await fetch(base + "/api/stripe/paylink", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}), body: JSON.stringify({ amountCents: Math.round(amt * 100), label: label }) });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.url) {
      q.paymentLink = d.url;
      if (typeof touch === "function") touch(q);
      if (typeof save === "function") save();
      if (typeof render === "function") render();
    } else {
      alert("Couldn't create the link: " + ((d && d.error) || ("HTTP " + r.status)) + "\n\nCheck that your Stripe key is saved in Settings (and has Prices + Payment Links write access).");
      if (btn) { btn.disabled = false; btn.textContent = "⚡ Generate card-payment link"; }
    }
  } catch (e) {
    alert("Couldn't reach Stripe — are you online? " + ((e && e.message) || ""));
    if (btn) { btn.disabled = false; btn.textContent = "⚡ Generate card-payment link"; }
  }
};
/* cash-discount line — "pay cash/check and save 3%". Presentational; shown on every invoice. */
function invCashNote(q) {
  if (typeof quoteCashPrice !== "function") return "";
  const due = invAmountDue(q), disc = quoteCashDiscount(due), cash = quoteCashPrice(due);
  if (!(disc >= 0.5)) return "";
  return `💵 Paying cash or check? Save ${Math.round((typeof CASH_DISCOUNT_RATE !== "undefined" ? CASH_DISCOUNT_RATE : 0.03) * 100)}% — ${money(cash)} (you save ${money(disc)})`;
}
/* invoice tax rows — a "Sales tax (6.75%)" line + a "Total due" line, only when the quote is a taxable service */
function invTaxRows(q, totCls) {
  if (!(typeof quoteTaxable === "function" && quoteTaxable(q))) return "";
  const tax = (typeof quoteSalesTax === "function") ? quoteSalesTax(q) : 0;
  return `<tr><td colspan="2" style="text-align:right">Sales tax (6.75%)</td><td style="text-align:right">${money(tax)}</td></tr>`
    + `<tr><td colspan="2" style="text-align:right${totCls ? '" class="tot"' : ';font-weight:800;padding-top:8px"'}>Total due</td><td style="text-align:right${totCls ? '" class="tot"' : ';font-weight:800;padding-top:8px"'}>${money(invAmountDue(q))}</td></tr>`;
}

/* Receipt close-out signal for the owner — informational only, never blocks invoicing. If the job linked to
   this quote has crew who haven't closed out their receipts, more expenses may still land, so the invoice
   total could be off. Reads the per-job close-out helpers from js/72 (guarded). */
function invReceiptsNote(q) {
  try {
    if (typeof jobReceiptsFullyClosed !== "function") return "";
    const j = (D().jobs || []).find(x => x && !x.deleted && (x.quoteId === q.id || x.id === q.jobId));
    if (!j) return "";
    const crew = (typeof jobCrewActiveIds === "function") ? jobCrewActiveIds(j) : [];
    if (!crew.length) return "";
    if (jobReceiptsFullyClosed(j)) return `<div class="note" style="border-left:4px solid var(--accent);background:var(--soft);padding:8px;border-radius:6px;margin-top:8px;white-space:normal">✓ <b>Receipts closed</b> — all crew reported their expenses for this job. Safe to invoice.</div>`;
    const open = (typeof jobReceiptsOpenCrew === "function") ? jobReceiptsOpenCrew(j) : [];
    const names = open.map(id => (typeof userName === "function" ? userName(id) : "") || "?").filter(Boolean).join(", ");
    return `<div class="note" style="border-left:4px solid #e0a800;background:var(--soft);padding:8px;border-radius:6px;margin-top:8px;white-space:normal">⏳ <b>Waiting on ${open.length} crew</b> to close out receipts${names ? " (" + esc(names) + ")" : ""} — more expenses may still come in. You can still invoice now if you want.</div>`;
  } catch (e) { return ""; }
}

window.openInvoice = function (quoteId) {
  const d = D();
  const q = (d.quotes || []).find(x => x.id === quoteId);
  if (!q) { alert("Quote not found."); return; }
  const cust = (d.customers || []).find(x => x.id === q.customerId);
  const biz = BIZ[S.biz] || { name: "", phone: "" };
  const no = invNo(q);
  const status = q.paid ? `<span class="badge s-Won">✓ Paid</span>` : (q.invoiced ? `<span class="badge">Invoiced</span>` : `<span class="badge s-Lead">Draft</span>`);
  const billTo = cust ? [cust.name || cust.company, cust.company && cust.name ? cust.company : "", cust.address, cust.phone, cust.email].filter(Boolean) : ["(no customer linked)"];
  modal("Invoice " + esc(no), `
    <div class="card" id="inv_doc" style="padding:12px">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="nm" style="font-size:17px">${esc(biz.name)}</div><div class="sub">${esc(biz.phone || "")}</div></div>
        <div style="text-align:right"><div class="nm">INVOICE</div><div class="sub">${esc(no)}</div><div class="sub">${esc(fmtDate(q.invoicedDate || q.date || today()))}</div></div>
      </div>
      <div style="margin-top:10px"><div class="sub" style="font-weight:700">Bill to</div>${billTo.map(l => `<div class="sub">${esc(l)}</div>`).join("")}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px">
        <thead><tr><th style="text-align:left">Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${invRowsHTML(q)}</tbody>
        <tfoot>${invAdjRows(q)}<tr><td colspan="2" style="text-align:right;font-weight:800;padding-top:8px">Total</td><td style="text-align:right;font-weight:800;padding-top:8px">${money(invEffectiveTotal(q))}</td></tr>${invTaxRows(q,false)}</tfoot>
      </table>
      <div class="sub" style="margin-top:8px">Status: ${status} · Due on receipt</div>${invCashNote(q)?`<div class="note" style="margin-top:6px;background:var(--soft);padding:6px 8px;border-radius:6px;white-space:normal">${invCashNote(q)}</div>`:""}
      ${q.paymentLink
        ? `<a class="btn acc" style="display:block;margin-top:8px;text-align:center" href="${esc(q.paymentLink)}" target="_blank" rel="noopener">💳 Pay online — ${money(invAmountDue(q))}</a>${(typeof finCanView !== "function" || finCanView()) ? `<button class="btn ghost sm" id="inv_genlink_${q.id}" style="display:block;width:100%;margin-top:6px" onclick="invGenPayLink('${q.id}')">↻ Regenerate link (if the amount changed)</button>` : ""}`
        : ((typeof finCanView !== "function" || finCanView())
          ? `<button class="btn acc" id="inv_genlink_${q.id}" style="display:block;width:100%;margin-top:8px" onclick="invGenPayLink('${q.id}')">⚡ Generate card-payment link</button>`
          : `<div class="sub" style="margin-top:8px;white-space:normal">💳 No online-payment link yet.</div>`)}
    </div>${invReceiptsNote(q)}
    <div class="row" style="gap:8px;margin-top:12px">
      ${!q.invoiced ? `<button class="btn acc grow" onclick="invMark('${q.id}')">Mark invoiced</button>` : (!q.paid ? `<button class="btn acc grow" onclick="invMarkPaid('${q.id}')">Mark paid</button>` : ``)}
      <button class="btn ghost grow" onclick="invPrint('${q.id}')">🖨️ Print / PDF</button>
    </div>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn ghost sm grow" onclick="invCopy('${q.id}')">Copy</button>
      ${cust ? `<button class="btn ghost sm grow" onclick="closeModal();openMessageComposer('${cust.id}',{total:'${money(invAmountDue(q))}'})">Send reminder</button>` : ``}
    </div>`);
};

function invText(q, cust, biz, no) {
  const lines = invItems(q).map(it => `  ${it.name}${(it.qty || 1) > 1 ? " ×" + it.qty : ""} — ${money((it.price || 0) * (it.qty || 1))}`);
  return [
    biz.name, biz.phone || "", "",
    "INVOICE " + no, fmtDate(q.invoicedDate || q.date || today()), "",
    "Bill to: " + ((cust && (cust.name || cust.company)) || "—"),
    "", ...lines, "",
    "TOTAL: " + money(invEffectiveTotal(q)),
    ...(typeof quoteTaxable==="function"&&quoteTaxable(q) ? ["Sales tax (6.75%): "+money(quoteSalesTax(q)), "TOTAL DUE: "+money(invAmountDue(q))] : []),
    ...(invCashNote(q) ? [invCashNote(q)] : []),
    "Due on receipt", "",
    "Thank you for your business!"
  ].join("\n");
}

window.invMark = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  q.invoiced = true;
  if (!q.invoiceNo) q.invoiceNo = invNo(q);
  q.invoicedDate = (typeof today === "function") ? today() : "";
  touch(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Invoiced " + q.invoiceNo + " · " + money(invEffectiveTotal(q)));
  save(); openInvoice(quoteId);
  var _rj = q.jobId || ((D().jobs || []).find(function (x) { return x && x.quoteId === q.id && !x.deleted; }) || {}).id;
  if (_rj && typeof reviewPrompt === "function") reviewPrompt(_rj);   /* review prompt at the INVOICED moment (moved off job-done per Ray) */
};
window.invMarkPaid = function (quoteId) {
  if (typeof recordPayment === "function") { recordPayment(quoteId); return; }   // proper payment flow (records + syncs income)
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  q.paid = true; q.paidDate = (typeof today === "function") ? today() : "";
  touch(q); if (typeof syncQuoteIncome === "function") syncQuoteIncome(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Marked paid · " + money(invEffectiveTotal(q)));
  save(); openInvoice(quoteId);
};
window.invCopy = function (quoteId) {
  const d = D(), q = (d.quotes || []).find(x => x.id === quoteId); if (!q) return;
  const cust = (d.customers || []).find(x => x.id === q.customerId), biz = BIZ[S.biz] || {};
  const txt = invText(q, cust, biz, invNo(q));
  const ta = document.createElement("textarea");
  ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); alert("Invoice copied — paste it into a text or email."); }
  catch (e) { alert("Copy failed — use Print / PDF instead."); }
  document.body.removeChild(ta);
};
window.invPrint = function (quoteId) {
  const d = D(), q = (d.quotes || []).find(x => x.id === quoteId); if (!q) return;
  const cust = (d.customers || []).find(x => x.id === q.customerId), biz = BIZ[S.biz] || {};
  const no = invNo(q);
  const billTo = cust ? [cust.name || cust.company, cust.company && cust.name ? cust.company : "", cust.address, cust.phone, cust.email].filter(Boolean) : ["(no customer)"];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Invoice ${esc(no)}</title><style>
    body{font:14px/1.5 system-ui,sans-serif;color:#111;margin:24px;max-width:640px}
    h1{font-size:18px;margin:0} .r{display:flex;justify-content:space-between;align-items:flex-start}
    .muted{color:#666;font-size:13px} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{padding:6px 4px;border-bottom:1px solid #ddd} th{text-align:left;font-size:12px;text-transform:uppercase;color:#666}
    .tot{font-weight:800;font-size:16px;border-top:2px solid #111;border-bottom:none}
    @media print{button{display:none}}</style></head><body>
    <div class="r"><div><h1>${esc(biz.name || "")}</h1><div class="muted">${esc(biz.phone || "")}</div></div>
    <div style="text-align:right"><h1>INVOICE</h1><div class="muted">${esc(no)}</div><div class="muted">${esc(fmtDate(q.invoicedDate || q.date || today()))}</div></div></div>
    <div style="margin-top:14px"><div class="muted" style="font-weight:700">Bill to</div>${billTo.map(l => `<div class="muted">${esc(l)}</div>`).join("")}</div>
    <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${invRowsHTML(q)}</tbody>
    <tfoot>${invAdjRows(q)}<tr><td colspan="2" style="text-align:right" class="tot">Total</td><td style="text-align:right" class="tot">${money(invEffectiveTotal(q))}</td></tr>${invTaxRows(q,true)}</tfoot></table>
    ${q.paymentLink?`<p style="margin-top:12px"><a href="${esc(q.paymentLink)}" style="font-weight:700">💳 Pay online: ${esc(q.paymentLink)}</a></p>`:""}${invCashNote(q)?`<p style="margin-top:10px;font-weight:600">${invCashNote(q)}</p>`:""}<p class="muted" style="margin-top:14px">Due on receipt. Thank you for your business!</p>
    <button onclick="window.print()" style="margin-top:16px;padding:10px 16px">Print / Save as PDF</button>
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — allow pop-ups to print, or use Copy."); return; }
  w.document.open(); w.document.write(html); w.document.close();
};

/* ---------- INVOICES TAB (Money → Invoices) ----------
   One place for the billing pipeline: jobs that are DONE + not yet invoiced surface as "Ready to invoice",
   then "Awaiting payment" (invoiced, unpaid, with A/R + days outstanding), then recently "Paid". Read-only over
   the quotes/jobs collections — a quote IS the invoice (invoiced/paid flags live on it). Owner/admin. */
function invJobFor(q) { const d = D(); return (d.jobs || []).find(x => x && !x.deleted && (x.id === q.jobId || x.quoteId === q.id)) || null; }
function invReadyState(q) { const j = invJobFor(q); return j && j.done ? "done" : (q.accepted || j ? "inprogress" : "quote"); }
function invAgeDays(q) { const dt = q.invoicedDate || q.date; if (!dt) return null; const t = new Date(dt + "T00:00:00"); if (isNaN(t)) return null; return Math.max(0, Math.floor((Date.now() - t) / 86400000)); }
function rInvoices() {
  if (typeof finCanView === "function" && !finCanView()) return `<div class="secthd"><h2>Invoices</h2></div><div class="card"><div class="muted">Owner / Admin only.</div></div>`;
  const d = D();
  const qs = (d.quotes || []).filter(q => q && !q.deleted && (q.accepted || q.invoiced || q.paid || q.jobId));
  const cust = q => esc((q.cust || (q.customerId && typeof custName === "function" ? custName(q.customerId) : "") || "—"));
  const type = q => esc((typeof quoteType === "function" ? quoteType(q) : "") || q.title || "Job");
  const amt = q => money(invAmountDue(q));
  // buckets, most-actionable first: DONE jobs not invoiced, then other accepted-not-invoiced, then awaiting pay, then paid
  const notBilled = qs.filter(q => !q.invoiced && !q.paid);
  const ready = notBilled.filter(q => invReadyState(q) === "done").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const inprog = notBilled.filter(q => invReadyState(q) !== "done").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const awaiting = qs.filter(q => q.invoiced && !q.paid).sort((a, b) => (invAgeDays(b) || 0) - (invAgeDays(a) || 0));
  const paid = qs.filter(q => q.paid).sort((a, b) => String(b.paidDate || b.date || "").localeCompare(String(a.paidDate || a.date || ""))).slice(0, 20);
  const arTotal = awaiting.reduce((s, q) => s + invAmountDue(q), 0);

  const row = (q, right) => `<div class="li" onclick="openInvoice('${q.id}')" style="cursor:pointer;align-items:flex-start"><div class="grow"><div class="nm">${type(q)} · <span style="font-weight:400">${cust(q)}</span></div><div class="sub">${q.date ? fmtDate(q.date) : ""}${q.invoiceNo ? " · " + esc(q.invoiceNo) : ""}${q.paymentLink ? " · 💳 pay link" : ""}</div></div><div style="text-align:right;flex:0 0 auto">${right}</div></div>`;

  let h = `<div class="secthd"><h2>🧾 Invoices</h2>${arTotal ? `<span class="ct">${money(arTotal)} owed</span>` : ""}</div>`;

  h += `<div class="secthd" style="margin-top:8px"><h2 style="font-size:15px">✅ Ready to invoice</h2><span class="ct">${ready.length}</span></div>`;
  if (!ready.length) h += `<div class="card"><div class="muted">No completed jobs waiting to be invoiced. A job shows here once it's marked done.</div></div>`;
  else h += `<div class="card">` + ready.map(q => row(q, `<b>${amt(q)}</b><div class="sub"><button class="btn acc sm" style="margin-top:4px" onclick="event.stopPropagation();invMark('${q.id}')">Create invoice</button></div>`)).join("") + `</div>`;

  if (inprog.length) h += `<div class="secthd" style="margin-top:10px"><h2 style="font-size:15px">🛠 In progress</h2><span class="ct">${inprog.length}</span></div><div class="card">` + inprog.map(q => row(q, `<b>${amt(q)}</b><div class="sub">not done yet</div>`)).join("") + `</div>`;

  h += `<div class="secthd" style="margin-top:10px"><h2 style="font-size:15px">📤 Awaiting payment</h2><span class="ct">${money(arTotal)}</span></div>`;
  if (!awaiting.length) h += `<div class="card"><div class="muted">Nothing outstanding. 🎉</div></div>`;
  else h += `<div class="card">` + awaiting.map(q => { const days = invAgeDays(q); return row(q, `<b style="color:var(--danger)">${amt(q)}</b><div class="sub">${days != null ? days + "d outstanding" : "invoiced"}</div>`); }).join("") + `</div>`;

  if (paid.length) h += `<div class="secthd" style="margin-top:10px"><h2 style="font-size:15px">✓ Paid</h2><span class="ct">${paid.length}</span></div><div class="card">` + paid.map(q => row(q, `<b style="color:var(--accent)">${amt(q)}</b><div class="sub">${q.paidDate ? "paid " + fmtDate(q.paidDate) : "paid"}</div>`)).join("") + `</div>`;

  view.innerHTML = h;   // top-level screen renderer sets #view itself (render() only calls it)
}
window.rInvoices = rInvoices;
