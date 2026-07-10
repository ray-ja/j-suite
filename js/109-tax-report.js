/* ---------- FINANCE → 🧾 TAX — sales tax PAID on purchases (owner/admin) ----------
   Ray wanted one place in the Money menu that tracks all the sales tax we're calculating on receipts. This rolls
   up the sales-tax portion Cap backs out of each receipt (or the printed amount) + total business spend, by
   category and by month. It reads the live receipt rows (js/72 rcptAllRows) — no new data, no side effects.

   NOTE: this is sales/use tax we PAID on purchases. It is SEPARATE from (a) the income-tax RESERVE (the 25% set
   aside from revenue — see Payouts) and (b) any sales tax we COLLECT on taxable jobs. The taxability rules live
   in Cap's Playbook → Tax. */
function rFinTax() {
  if (typeof finCanView === "function" && !finCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div><div class="sub">The Tax report is restricted to Owner and Admin.</div></div>`;
  const rows = (typeof rcptAllRows === "function") ? rcptAllRows() : [];
  const m2 = (typeof money2 === "function") ? money2 : (n => "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2));
  const e = (typeof esc === "function") ? esc : (s => String(s == null ? "" : s));
  let net = 0, tax = 0, exemptTotal = 0, taxedN = 0, exemptN = 0, unevalN = 0;
  const byCat = {}, byMonth = {};
  rows.forEach(r => {
    if (!r || r.isDeposit || r.deposit) return;   // deposits are held, not a real spend
    const amt = +r.amount || 0;                    // refunds are negative → they net down the spend
    net += amt;
    const cat = r.category || "(uncategorized)";
    const mo = (((typeof rcptDate === "function") ? rcptDate(r) : (r.date || "")) || "").slice(0, 7) || "(no date)";
    (byCat[cat] = byCat[cat] || { spend: 0, tax: 0 }).spend += amt;
    (byMonth[mo] = byMonth[mo] || { spend: 0, tax: 0 }).spend += amt;
    if (r.taxEvaluated) {
      if (r.taxExempt) { exemptN++; exemptTotal += amt; }
      else if (+r.taxAmount > 0) { tax += +r.taxAmount; taxedN++; byCat[cat].tax += +r.taxAmount; byMonth[mo].tax += +r.taxAmount; }
    } else if (typeof rcptNeedsTax === "function" && rcptNeedsTax(r)) unevalN++;
  });
  let h = `<div class="card" style="border-left:5px solid var(--brand)"><div style="font-weight:800;margin-bottom:6px">🧾 Sales tax paid on purchases</div>`;
  h += `<div class="row" style="justify-content:space-between"><span class="sub">Sales tax set aside (paid)</span><b>${m2(tax)}</b></div>`;
  h += `<div class="row" style="justify-content:space-between"><span class="sub">Business spend (net of refunds)</span><b>${m2(net)}</b></div>`;
  h += `<div class="row" style="justify-content:space-between"><span class="sub">Non-taxable (SaaS / insurance)</span><b>${m2(exemptTotal)}</b></div>`;
  h += `<div class="sub" style="margin-top:2px">${taxedN} taxable · ${exemptN} non-taxable${unevalN ? ` · <span style="color:#e0a800">${unevalN} not yet assessed</span>` : ""}</div>`;
  h += `<div class="sub" style="white-space:normal;margin-top:6px">The sales tax you <b>paid</b> on purchases (backed out of each total, or the printed amount). Separate from the income-tax reserve (Payouts) and from any sales tax you <b>collect</b> on taxable jobs. Rules: Cap's Playbook → Tax.</div>`;
  if (typeof rcptReassessAllTax === "function") h += `<button class="btn ghost sm" style="margin-top:8px" onclick="rcptReassessAllTax()">↻ Re-assess all</button>`;
  h += `</div>`;
  const row = (label, o) => `<tr style="border-top:1px solid var(--line)"><td style="padding:5px 6px;white-space:normal">${e(label)}</td><td style="padding:5px 6px;text-align:right">${m2(o.spend)}</td><td style="padding:5px 6px;text-align:right">${o.tax > 0.005 ? m2(o.tax) : `<span class="muted">—</span>`}</td></tr>`;
  const thead = `<tr style="color:var(--muted);text-align:left"><th style="padding:4px 6px">.</th><th style="padding:4px 6px;text-align:right">Spend</th><th style="padding:4px 6px;text-align:right">Sales tax</th></tr>`;
  const cats = Object.keys(byCat).filter(c => Math.abs(byCat[c].spend) > 0.005).sort((a, b) => byCat[b].spend - byCat[a].spend);
  if (cats.length) h += `<div class="card"><div style="font-weight:800;margin-bottom:4px">By category</div><table style="width:100%;border-collapse:collapse;font-size:13px">${thead.replace(">.<", ">Category<")}${cats.map(c => row(c, byCat[c])).join("")}</table></div>`;
  const months = Object.keys(byMonth).sort().reverse();
  if (months.length) h += `<div class="card"><div style="font-weight:800;margin-bottom:4px">By month</div><table style="width:100%;border-collapse:collapse;font-size:13px">${thead.replace(">.<", ">Month<")}${months.map(mo => row(mo, byMonth[mo])).join("")}</table></div>`;
  if (!rows.length) h += `<div class="card"><div class="muted">No receipts yet — upload some on the Receipts page.</div></div>`;
  return h;
}
window.rFinTax = rFinTax;
