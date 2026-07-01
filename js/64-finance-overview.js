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

/* ---------- CASH & ACCOUNTS — running balances over time + runway ----------
   Each income splits 25/15/60 into the accounts (inflows). Outflows: expenses + mileage (business fund),
   and recorded DISBURSEMENTS (payouts paid / tax payments / owner draws). Balance = inflow − outflow.
   Cash on hand = sum of the three accounts = total income − expenses − all disbursements. */
function finAvgMonthlyBurn(){
  const t = today(); let y = +t.slice(0, 4), m = +t.slice(5, 7), total = 0;
  for (let i = 0; i < 3; i++) { m--; if (m < 1) { m = 12; y--; } const ym = y + "-" + String(m).padStart(2, "0"), b = monthBounds(ym);
    total += actExpenses().filter(e => e.date >= b.from && e.date <= b.to).reduce((s, e) => s + finCents(e.amount), 0);
    total += finMileage(D().timeclock || [], { from: b.from, to: b.to, confirmedOnly: true }).total;
  }
  return Math.round(total / 3);
}
function finAccountBalances(){
  const roll = finRollup(actIncome(), { adminMemberId: (typeof finAdminMember === "function" ? finAdminMember() : "") });
  const mil = finMileage(D().timeclock || [], { confirmedOnly: true });
  const expCents = actExpenses().reduce((s, e) => s + finCents(e.amount), 0);
  const disb = (typeof actDisb === "function") ? actDisb() : [];
  const byType = tp => disb.filter(d => d.type === tp).reduce((s, d) => s + finCents(d.amount), 0);
  const taxPaid = byType("tax"), payoutPaid = byType("payout"), drawPaid = byType("draw");
  const t = roll.totals, allocatedLabor = t.field + t.sales + t.admin;
  const taxBal = t.tax - taxPaid;
  const businessBal = t.business + t.unallocatedField - expCents - mil.total - drawPaid;
  const owedBal = allocatedLabor + mil.total - payoutPaid;
  const cash = taxBal + businessBal + owedBal;
  const burn = finAvgMonthlyBurn();
  return { taxBal, businessBal, owedBal, cash, taxIn: t.tax, taxPaid, businessIn: t.business, unalloc: t.unallocatedField, expCents, mileage: mil.total, drawPaid, allocatedLabor, payoutPaid, burn, runwayMonths: burn > 0 ? Math.round((cash / burn) * 10) / 10 : null };
}

function rFinCash(){
  const a = finAccountBalances();
  let h = `<div class="card" style="text-align:center"><div class="sub">Cash on hand</div>
    <div style="font-size:30px;font-weight:800;color:${a.cash < 0 ? "var(--danger)" : "var(--accent)"}">${fm(a.cash)}</div>
    <div class="sub">${a.runwayMonths != null ? `~${a.runwayMonths} months runway · ${fm(a.burn)}/mo overhead` : "runway needs a few months of history"}</div></div>`;

  h += `<div class="secthd"><h2>Accounts</h2></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">🏦 Tax reserve</div><div class="sub" style="white-space:normal">25% set aside ${fm(a.taxIn)} − paid ${fm(a.taxPaid)}</div></div><b style="${a.taxBal < 0 ? "color:var(--danger)" : ""}">${fm(a.taxBal)}</b></div>
    <div class="li"><div class="grow"><div class="nm">🏢 Business fund</div><div class="sub" style="white-space:normal">15% ${fm(a.businessIn)}${a.unalloc ? " + unassigned " + fm(a.unalloc) : ""} − expenses ${fm(a.expCents)} − mileage ${fm(a.mileage)}${a.drawPaid ? " − draws " + fm(a.drawPaid) : ""}</div></div><b style="${a.businessBal < 0 ? "color:var(--danger)" : ""}">${fm(a.businessBal)}</b></div>
    <div class="li"><div class="grow"><div class="nm">👷 Owed to members</div><div class="sub" style="white-space:normal">labor ${fm(a.allocatedLabor)} + mileage ${fm(a.mileage)} − paid ${fm(a.payoutPaid)}</div></div><b style="${a.owedBal < 0 ? "color:var(--danger)" : ""}">${fm(a.owedBal)}</b></div></div>`;

  // per-person breakdown of the pooled "Owed to members" — each tappable to record a payout to that member
  if (typeof finOwedPerPersonHTML === "function") {
    h += `<div class="secthd"><h2>👷 Owed — by person</h2><span class="ct">${fm(a.owedBal)}</span></div>` + finOwedPerPersonHTML();
  }

  h += `<div class="secthd"><h2>Record money paid out</h2></div><div class="card"><div class="row" style="gap:8px;flex-wrap:wrap">
    <button class="btn ghost grow" onclick="recordDisbursement('payout')">👷 Payout paid</button>
    <button class="btn ghost grow" onclick="recordDisbursement('tax')">🏦 Tax payment</button>
    <button class="btn ghost grow" onclick="recordDisbursement('draw')">🏢 Owner draw</button></div></div>`;

  const disb = (typeof actDisb === "function" ? actDisb() : []).slice().sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 12);
  if (disb.length) h += `<div class="secthd"><h2>Recent</h2></div><div class="card">` + disb.map(d => {
    const lbl = d.type === "tax" ? "🏦 Tax payment" : d.type === "payout" ? ("👷 Payout" + (d.memberId ? " · " + finName(d.memberId) : "")) : "🏢 Owner draw";
    return `<div class="li" onclick="recordDisbursement('${d.type}','${d.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${money(d.amount)} <span class="sub" style="font-weight:400">${esc(lbl)}</span></div><div class="sub">${fmtDate(d.date)}${d.note ? " · " + esc(d.note) : ""}</div></div></div>`;
  }).join("") + `</div>`;
  return h;
}

window.recordDisbursement = function(type, id, presetMember){
  const d = D(); const ex = id ? (d.disbursements || []).find(x => x && x.id === id) : null;
  const t0 = ex ? ex.type : type, members = finMembers();
  const selMember = ex ? ex.memberId : (presetMember || "");   // per-person breakdown can preselect the member to pay
  const title = t0 === "tax" ? "Tax payment" : t0 === "payout" ? "Payout paid" : "Owner draw";
  modal((ex ? "Edit " : "Record ") + title, `
    <div class="row" style="gap:8px"><div class="grow"><label>Amount ($)</label><input id="db_amt" type="number" inputmode="decimal" value="${ex ? ex.amount : ""}"></div>
      <div class="grow"><label>Date</label><input id="db_date" type="date" value="${ex ? ex.date : today()}"></div></div>
    ${t0 === "payout" ? `<label>Member (optional)</label><select id="db_member"><option value="">— general —</option>${members.map(u => `<option value="${u.id}" ${selMember === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select>` : ""}
    <label>Note (optional)</label><input id="db_note" value="${ex ? esc(ex.note || "") : ""}" placeholder="${t0 === "tax" ? "e.g. Q2 estimated federal" : t0 === "payout" ? "e.g. June payout" : "what for"}">
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="saveDisbursement('${t0}','${ex ? ex.id : ""}')">Save</button>
    ${ex ? `<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="delDisbursement('${ex.id}')">Delete</button>` : ""}`);
};
window.saveDisbursement = function(type, id){
  const amt = parseFloat(val("db_amt")) || 0; if (amt <= 0) { alert("Enter the amount."); return; }
  if (typeof submitGuard === "function" && !submitGuard("saveDisbursement:" + (id || type))) return;   // rapid-tap dupe guard (id or type keys create vs edit)
  const d = D(); if (!Array.isArray(d.disbursements)) d.disbursements = [];
  let e = id ? d.disbursements.find(x => x && x.id === id) : null;
  if (!e) { e = { id: uid() }; d.disbursements.push(e); }
  e.type = type; e.amount = amt; e.date = val("db_date") || today(); e.memberId = (document.getElementById("db_member") ? val("db_member") : e.memberId) || ""; e.note = val("db_note") || ""; e.deleted = false; e.updatedAt = now();
  if (typeof touch === "function") touch(e);
  if (typeof logChange === "function") logChange(id ? "update" : "create", "disbursement", e.id, (type === "tax" ? "Tax payment " : type === "payout" ? "Payout " : "Draw ") + money(amt));
  save(); closeModal(); render();
};
window.delDisbursement = function(id){
  const d = D(); const e = (d.disbursements || []).find(x => x && x.id === id); if (!e) return;
  if (!confirm("Delete this entry?")) return;
  e.deleted = true; e.updatedAt = now(); if (typeof touch === "function") touch(e); save(); closeModal(); render();
};
