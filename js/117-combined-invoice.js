/* ---------- COMBINED INVOICE (js/117) — hand ONE invoice for several jobs -------------------------------------
   Square (no Plus) can't batch-invoice, so the owner needs a single invoice covering several jobs for one customer.
   In this app a quote IS its invoice (js/46), rendered one at a time. This adds a DISPLAY-ONLY combiner: pick a
   customer's invoiced-unpaid quotes → one document with a section per job + a grand total, to View/Print or Copy
   (e.g. paste as a single Square invoice). It changes NO data — each quote stays its own record for payments / A/R /
   payout attribution; only the PRESENTATION is combined. Owner/admin. Self-contained; safe to relocate. */

function invComboCanRun() { return (typeof finCanView !== "function") || finCanView(); }

/* customers who have 2+ invoiced-but-unpaid quotes — the combinable set. [{cid, quotes:[…]}] */
function invComboCustomers() {
  const d = (typeof D === "function") ? D() : {}, by = {};
  (d.quotes || []).forEach(q => { if (q && !q.deleted && q.invoiced && !q.paid && q.customerId) (by[q.customerId] || (by[q.customerId] = [])).push(q); });
  return Object.keys(by).filter(cid => by[cid].length > 1)
    .map(cid => ({ cid: cid, quotes: by[cid].slice().sort((a, b) => String(a.invoicedDate || a.date || "").localeCompare(String(b.invoicedDate || b.date || ""))) }));
}

let _invCombo = { cid: null, ids: {} };

window.invComboOpen = function (cid) {
  if (!invComboCanRun()) { alert("Owner / Admin only."); return; }
  const custs = invComboCustomers();
  if (!custs.length) { alert("No customer has 2+ open invoices to combine yet."); return; }
  cid = cid || (custs[0] && custs[0].cid);
  const grp = custs.find(c => c.cid === cid) || custs[0];
  _invCombo = { cid: grp.cid, ids: {} };
  grp.quotes.forEach(q => { _invCombo.ids[q.id] = true; });   // default: everything checked
  invComboRender(custs);
};

window.invComboToggle = function (id, on) { _invCombo.ids[id] = !!on; invComboRender(); };

function invComboRender(custs) {
  custs = custs || invComboCustomers();
  const grp = custs.find(c => c.cid === _invCombo.cid) || custs[0];
  if (!grp) { if (typeof closeModal === "function") closeModal(); return; }
  const nm = (typeof custName === "function" && custName(grp.cid)) || "this customer";
  const custOpts = custs.map(c => `<option value="${esc(c.cid)}"${c.cid === grp.cid ? " selected" : ""}>${esc((typeof custName === "function" && custName(c.cid)) || c.cid)} (${c.quotes.length})</option>`).join("");
  const rows = grp.quotes.map(q => {
    const on = !!_invCombo.ids[q.id];
    const label = ((typeof quoteType === "function" ? quoteType(q) : "") || q.title || "Job") + " · " + ((typeof invNo === "function" ? invNo(q) : q.invoiceNo) || "");
    return `<label class="li" style="cursor:pointer;align-items:center;gap:10px"><input type="checkbox" ${on ? "checked" : ""} onchange="invComboToggle('${q.id}',this.checked)" style="width:20px;height:20px;flex:0 0 auto"><div class="grow"><div class="nm" style="font-size:14px">${esc(label)}</div></div><div class="nm">${money2(invGrandTotal(q))}</div></label>`;
  }).join("");
  const sel = grp.quotes.filter(q => _invCombo.ids[q.id]);
  const total = sel.reduce((s, q) => s + invGrandTotal(q), 0);
  modal("Combine into one invoice", `
    <div class="card">
      <label>Customer</label>
      <select onchange="invComboOpen(this.value)">${custOpts}</select>
      <div class="sub" style="margin:8px 0 6px;white-space:normal">Pick the jobs to put on <b>one</b> invoice for ${esc(nm)}. Each stays its own record for payments &amp; payout — this only prints them together.</div>
      ${rows}
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)"><b>Combined total (${sel.length} job${sel.length === 1 ? "" : "s"})</b><b>${money2(total)}</b></div>
    </div>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn acc grow" onclick="invComboPrint()">🖨️ View / Print combined</button>
      <button class="btn ghost grow" onclick="invComboCopy()">Copy</button>
    </div>`);
}

function invComboSelected() {
  const d = (typeof D === "function") ? D() : {};
  return (d.quotes || []).filter(q => q && _invCombo.ids[q.id] && !q.deleted && q.customerId === _invCombo.cid);
}

/* the reconciled line rows for one job: its quote items, a "final price adjustment" line when the effective total
   differs from the item sum, then its pass-through materials (only when that quote opted in). */

/* per-job breakdown — each job is its own sub-invoice: labor (= the job's invoice total MINUS its actual
   materials) + its own materials at cost + a subtotal that equals the job total. Materials DECOMPOSE the price,
   never add on top, so the grand total is exactly the sum of the job totals (no double-count). */
function invComboSections(sel) {
  return sel.map(q => {
    const subtotal = (typeof invGrandTotal === "function") ? invGrandTotal(q) : (+(q.finalPrice || q.total) || 0);
    const mats = (typeof invMaterials === "function") ? invMaterials(q) : [];
    const matTotal = Math.round(mats.reduce((s, m) => s + m.amount, 0) * 100) / 100;
    return {
      label: ((typeof quoteType === "function" ? quoteType(q) : "") || q.title || "Job"),
      no: (typeof invNo === "function" ? invNo(q) : q.invoiceNo) || "",
      labor: Math.round((subtotal - matTotal) * 100) / 100, mats: mats, subtotal: subtotal
    };
  });
}

window.invComboPrint = function () {
  const sel = invComboSelected();
  if (!sel.length) { alert("Pick at least one job to combine."); return; }
  const d = D(), cust = (d.customers || []).find(x => x.id === _invCombo.cid), biz = ((typeof BIZ !== "undefined") && BIZ[S.biz]) || { name: "", phone: "" };
  const billTo = cust ? [cust.name || cust.company, cust.company && cust.name ? cust.company : "", cust.address, cust.phone, cust.email].filter(Boolean) : ["(no customer)"];
  const dateStr = (typeof fmtDate === "function") ? fmtDate((typeof today === "function") ? today() : "") : "";
  const AC = "#0a7d4b";
  const secs = invComboSections(sel);
  const grand = Math.round(secs.reduce((s, x) => s + x.subtotal, 0) * 100) / 100;
  const anyMats = secs.some(x => x.mats.length);
  const covers = secs.map(x => x.no).filter(Boolean);
  const sections = secs.map(x => {
    let body = `<tr><td>Labor &amp; installation</td><td class="r">${money2(x.labor)}</td></tr>`;
    if (x.mats.length) body += `<tr class="mh"><td colspan="2">Materials (at cost)</td></tr>`
      + x.mats.map(m => `<tr><td class="ind">${esc(m.desc)}</td><td class="r">${money2(m.amount)}</td></tr>`).join("");
    return `<div class="sec"><div class="sech"><span>${esc(x.label)}</span>${x.no ? `<span class="no">${esc(x.no)}</span>` : ""}</div>`
      + `<table class="lt"><tbody>${body}</tbody><tfoot><tr class="st"><td>Subtotal</td><td class="r">${money2(x.subtotal)}</td></tr></tfoot></table></div>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice — ${esc((cust && (cust.name || cust.company)) || "Customer")}</title>
  <style>*{box-sizing:border-box}body{font:14px/1.55 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif;color:#1a1a1a;background:#eef0f3;margin:0;padding:24px}
  .sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.09);overflow:hidden}
  .bar{height:6px;background:linear-gradient(90deg,${AC},#12b877)}.pad{padding:34px 40px}
  .top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.bizname{font-size:20px;font-weight:800;letter-spacing:-.2px}.muted{color:#6b7280;font-size:13px}
  .badge{text-align:right}.badge .t{font-weight:800;letter-spacing:1px}
  .bill{margin-top:18px}.bill .h{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:3px}
  .sec{margin-top:22px}.sech{display:flex;justify-content:space-between;gap:12px;align-items:baseline;font-weight:700;border-bottom:2px solid ${AC};padding-bottom:5px}.sech .no{font-weight:400;color:#6b7280;font-size:12px;font-variant-numeric:tabular-nums}
  .lt{width:100%;border-collapse:collapse;margin-top:4px}.lt td{padding:6px 0;border-bottom:1px solid #eef0f3}.lt td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .lt td.ind{padding-left:16px;color:#4b5563;font-size:13px}
  .lt tr.mh td{padding-top:9px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${AC};font-weight:700;border:none}
  .lt tr.st td{padding-top:8px;font-weight:700;border:none}
  .grand{margin-top:26px;background:#1a1a1a;color:#fff;border-radius:8px;padding:16px 22px;display:flex;justify-content:space-between;align-items:baseline}
  .grand .v{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}
  .note{margin-top:16px;padding:11px 14px;background:#eef7f0;border-left:3px solid ${AC};border-radius:0 4px 4px 0;color:#4b5563;font-size:12px}
  .foot{margin-top:14px;color:#6b7280;font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0}}</style></head>
  <body><div class="sheet"><div class="bar"></div><div class="pad">
    <div class="top"><div><div class="bizname">${esc(biz.name || "OBX Lot Solutions")}</div><div class="muted">${esc(biz.phone || "")}</div></div>
      <div class="badge"><div class="t">INVOICE</div><div class="muted">${esc(dateStr)}</div><div class="muted">Due on receipt</div></div></div>
    <div class="bill"><div class="h">Bill to</div>${billTo.map(l => `<div>${esc(l)}</div>`).join("")}</div>
    ${sections}
    <div class="grand"><span>Total due</span><span class="v">${money2(grand)}</span></div>
    ${anyMats ? `<div class="note"><b>No sales tax</b> — real-property capital improvements; sales tax was paid on materials at purchase, so none is charged on the contract. Materials billed through at cost, no markup.</div>` : ""}
    <div class="foot"><span>${covers.length ? "Covers " + esc(covers.join(" · ")) : ""}</span><span>Thank you for your business.</span></div>
  </div></div>
  <script>setTimeout(function(){try{window.print();}catch(e){}},400);<\/script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to view the combined invoice, or use Copy."); return; }
  w.document.open(); w.document.write(html); w.document.close();
};

window.invComboCopy = function () {
  const sel = invComboSelected();
  if (!sel.length) { alert("Pick at least one job to combine."); return; }
  const d = D(), cust = (d.customers || []).find(x => x.id === _invCombo.cid), biz = ((typeof BIZ !== "undefined") && BIZ[S.biz]) || { name: "", phone: "" };
  const secs = invComboSections(sel);
  const grand = Math.round(secs.reduce((s, x) => s + x.subtotal, 0) * 100) / 100;
  const lines = [biz.name || "OBX Lot Solutions", biz.phone || "", "", "INVOICE — " + ((cust && (cust.name || cust.company)) || "Customer"), (typeof fmtDate === "function") ? fmtDate((typeof today === "function") ? today() : "") : "", ""];
  secs.forEach(x => {
    lines.push((x.label + (x.no ? "  [" + x.no + "]" : "")).toUpperCase());
    lines.push("  Labor & installation — " + money2(x.labor));
    if (x.mats.length) { lines.push("  Materials (at cost):"); x.mats.forEach(m => lines.push("    " + m.desc + " — " + money2(m.amount))); }
    lines.push("  Subtotal: " + money2(x.subtotal), "");
  });
  lines.push("TOTAL DUE: " + money2(grand), "Due on receipt");
  const covers = secs.map(x => x.no).filter(Boolean);
  if (covers.length) lines.push("Covers " + covers.join(" · "));
  lines.push("", "Thank you for your business.");
  const txt = lines.join("\n");
  const ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); alert("Combined invoice copied — paste it into Square, an email, or a text."); }
  catch (e) { alert("Copy failed — use View / Print instead."); }
  document.body.removeChild(ta);
};
