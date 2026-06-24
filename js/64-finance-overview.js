/* ---------- FINANCE OVERVIEW — the company income statement (period P&L), cash position, CSV export ----------
   The headline "real numbers": Revenue − job costs − mileage − operating expenses = Net, with the 35%
   margin-floor check + a cash snapshot (A/R outstanding, tax reserve to set aside). Reads the synced
   income/expenses collections, per-job expenses, and confirmed time-clock mileage. fm() = cents → $. */

/* period P&L in exact cents */
function finPeriodPL(ym){
  const b = monthBounds(ym);
  const inPeriod = d => d && d >= b.from && d <= b.to;
  const inc = actIncome().filter(e => inPeriod(e.date));
  const revenue = inc.reduce((s, e) => s + finCents(e.amount), 0);

  // direct job costs — per-job expenses on jobs dated in the period
  let jobCosts = 0;
  (D().jobs || []).filter(j => j && !j.deleted && inPeriod(j.date)).forEach(j => {
    (j.expenses || []).filter(x => x && !x.deleted).forEach(e => { jobCosts += finCents(e.amount); });
  });

  const mil = finMileage(D().timeclock || [], { from: b.from, to: b.to, confirmedOnly: true });

  // operating / overhead expenses, by category
  const exps = actExpenses().filter(e => inPeriod(e.date));
  const opExBy = {}; let opEx = 0;
  exps.forEach(e => { const c = e.category || "other", v = finCents(e.amount); opExBy[c] = (opExBy[c] || 0) + v; opEx += v; });

  const totalCosts = jobCosts + mil.total + opEx;
  const net = revenue - totalCosts;
  const margin = revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : 0;
  return { ym, revenue, jobCosts, mileage: mil.total, opEx, opExBy, totalCosts, net, margin, incCount: inc.length };
}

function finPLLine(label, cents, opt){ opt = opt || {};
  return `<div class="li"><div class="grow"><div class="nm" style="font-weight:${opt.bold ? 800 : 500}${opt.indent ? ";padding-left:10px" : ""}">${esc(label)}</div></div><b style="${opt.danger ? "color:var(--danger)" : (opt.good ? "color:var(--accent)" : "")}">${fm(cents)}</b></div>`;
}

function rFinOverview(){
  const ym = finMonth(), pl = finPeriodPL(ym);
  // A/R snapshot (invoiced, unpaid) — inline so there's no cross-module coupling
  const arQuotes = (D().quotes || []).filter(q => q && !q.deleted && q.invoiced && !q.paid);
  const arOwed = arQuotes.reduce((s, q) => s + (q.finalPrice || q.total || 0), 0);

  let h = `<div class="card"><div class="row" style="align-items:center">
      <button class="btn ghost sm" onclick="finMonthShift(-1)">‹</button>
      <div class="grow" style="text-align:center"><b>${esc(finMonthLabel(ym))}</b><div class="sub">income statement · ${pl.incCount} income entr${pl.incCount === 1 ? "y" : "ies"}</div></div>
      <button class="btn ghost sm" onclick="finMonthShift(1)">›</button></div></div>`;

  // income statement
  h += `<div class="card">`;
  h += finPLLine("Revenue", pl.revenue, { bold: true, good: pl.revenue > 0 });
  h += `<div class="sub" style="margin:10px 0 2px;font-weight:700">Costs</div>`;
  h += finPLLine("Job costs (disposal, materials…)", -pl.jobCosts, { indent: true });
  h += finPLLine("Mileage", -pl.mileage, { indent: true });
  Object.keys(pl.opExBy).sort().forEach(c => { h += finPLLine(c, -pl.opExBy[c], { indent: true }); });
  if (!pl.jobCosts && !pl.mileage && !pl.opEx) h += `<div class="muted" style="padding:4px 0">No costs logged this period.</div>`;
  h += `<div style="border-top:1px solid var(--line);margin:6px 0;padding-top:6px"></div>`;
  h += finPLLine("Total costs", -pl.totalCosts);
  h += `<div style="border-top:2px solid var(--line);margin:8px 0 0;padding-top:8px"></div>`;
  h += finPLLine("Net profit", pl.net, { bold: true, danger: pl.net < 0, good: pl.net > 0 });
  h += `<div class="li"><div class="grow"><div class="nm">Margin</div></div><b style="${pl.margin < 35 ? "color:var(--danger)" : "color:var(--accent)"}">${pl.revenue > 0 ? pl.margin + "%" : "—"}</b></div>`;
  if (pl.revenue > 0 && pl.margin < 35) h += `<div class="note" style="margin-top:6px">⚠ Below the 35% margin floor — check pricing &amp; costs.</div>`;
  h += `</div>`;

  // cash position
  h += `<div class="secthd"><h2>Cash position</h2></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">📥 A/R outstanding</div><div class="sub">invoiced, not yet paid · ${arQuotes.length} invoice(s)</div></div><b>${money(arOwed)}</b></div>
    <div class="li"><div class="grow"><div class="nm">🏦 Tax reserve (this period)</div><div class="sub">25% of revenue — set aside</div></div><b>${fm(Math.round(pl.revenue * 0.25))}</b></div>
    <div class="li"><div class="grow"><div class="nm">🏢 Business fund (this period)</div><div class="sub">15% of revenue, before mileage/expenses</div></div><b>${fm(Math.round(pl.revenue * 0.15))}</b></div></div>`;

  h += `<button class="btn ghost" style="width:100%;margin-top:12px" onclick="finExportCSV('${ym}')">⬇ Export ${esc(finMonthLabel(ym))} (CSV)</button>`;
  return h;
}

/* CSV export — income statement + income detail + expense detail for the period. Triggers a download. */
window.finExportCSV = function(ym){
  const b = monthBounds(ym), pl = finPeriodPL(ym), d2 = c => (c / 100).toFixed(2);
  const rows = [
    ["j-Suite finance export", finMonthLabel(ym)], [],
    ["INCOME STATEMENT"],
    ["Revenue", d2(pl.revenue)],
    ["Job costs", d2(-pl.jobCosts)],
    ["Mileage", d2(-pl.mileage)]
  ];
  Object.keys(pl.opExBy).sort().forEach(c => rows.push([c, d2(-pl.opExBy[c])]));
  rows.push(["Total costs", d2(-pl.totalCosts)], ["Net profit", d2(pl.net)], ["Margin %", pl.revenue > 0 ? pl.margin : ""], []);
  rows.push(["INCOME (detail)"], ["Date", "Amount", "Job", "Invoice", "Crew count"]);
  actIncome().filter(e => e.date >= b.from && e.date <= b.to).sort((a, c) => a.date < c.date ? -1 : 1).forEach(e => {
    const j = (D().jobs || []).find(x => x.id === e.jobId); rows.push([e.date, (+e.amount || 0).toFixed(2), (j && j.title) || "", e.invoice || "", (e.crew || []).length]);
  });
  rows.push([], ["EXPENSES (detail)"], ["Date", "Amount", "Category", "Note", "Vendor"]);
  actExpenses().filter(e => e.date >= b.from && e.date <= b.to).sort((a, c) => a.date < c.date ? -1 : 1).forEach(e => rows.push([e.date, (+e.amount || 0).toFixed(2), e.category || "", e.note || "", e.vendor || ""]));
  const csv = rows.map(r => r.map(c => { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(",")).join("\n");
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "jsuite-finance-" + ym + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { alert("Export failed: " + (e.message || e)); }
};
