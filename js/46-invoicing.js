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
        <tfoot><tr><td colspan="2" style="text-align:right;font-weight:800;padding-top:8px">Total</td><td style="text-align:right;font-weight:800;padding-top:8px">${money(q.total || 0)}</td></tr></tfoot>
      </table>
      <div class="sub" style="margin-top:8px">Status: ${status} · Due on receipt</div>
    </div>
    <div class="row" style="gap:8px;margin-top:12px">
      ${!q.invoiced ? `<button class="btn acc grow" onclick="invMark('${q.id}')">Mark invoiced</button>` : (!q.paid ? `<button class="btn acc grow" onclick="invMarkPaid('${q.id}')">Mark paid</button>` : ``)}
      <button class="btn ghost grow" onclick="invPrint('${q.id}')">🖨️ Print / PDF</button>
    </div>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn ghost sm grow" onclick="invCopy('${q.id}')">Copy</button>
      ${cust ? `<button class="btn ghost sm grow" onclick="closeModal();openMessageComposer('${cust.id}',{total:'${money(q.total||0)}'})">Send reminder</button>` : ``}
    </div>`);
};

function invText(q, cust, biz, no) {
  const lines = invItems(q).map(it => `  ${it.name}${(it.qty || 1) > 1 ? " ×" + it.qty : ""} — ${money((it.price || 0) * (it.qty || 1))}`);
  return [
    biz.name, biz.phone || "", "",
    "INVOICE " + no, fmtDate(q.invoicedDate || q.date || today()), "",
    "Bill to: " + ((cust && (cust.name || cust.company)) || "—"),
    "", ...lines, "",
    "TOTAL: " + money(q.total || 0), "Due on receipt", "",
    "Thank you for your business!"
  ].join("\n");
}

window.invMark = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  q.invoiced = true;
  if (!q.invoiceNo) q.invoiceNo = invNo(q);
  q.invoicedDate = (typeof today === "function") ? today() : "";
  touch(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Invoiced " + q.invoiceNo + " · " + money(q.total || 0));
  save(); openInvoice(quoteId);
};
window.invMarkPaid = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  q.paid = true; q.paidDate = (typeof today === "function") ? today() : "";
  touch(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Marked paid · " + money(q.total || 0));
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
    <tfoot><tr><td colspan="2" style="text-align:right" class="tot">Total</td><td style="text-align:right" class="tot">${money(q.total || 0)}</td></tr></tfoot></table>
    <p class="muted" style="margin-top:14px">Due on receipt. Thank you for your business!</p>
    <button onclick="window.print()" style="margin-top:16px;padding:10px 16px">Print / Save as PDF</button>
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — allow pop-ups to print, or use Copy."); return; }
  w.document.open(); w.document.write(html); w.document.close();
};
