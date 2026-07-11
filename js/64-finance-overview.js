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

  // direct job costs — per-job expenses on jobs dated in the period. A reusable TOOL/equipment item logged on a
  // job is CAPITAL/overhead, not that job's cost → pulled OUT of jobCosts and rolled into opEx below, so the
  // income-statement TOTAL (net/margin) is UNCHANGED (it only moves the tool from job costs to overhead).
  // PASS-THROUGH MATERIALS (job.materials) are a real hard cost — the company bought them, then billed them into the
  // customer's price (which is in `revenue` above). Omitting them overstated Net profit (taxable income) by every
  // material dollar. Billed at cost they're net-neutral to profit; any markup correctly shows as margin.
  let jobCosts = 0, jobToolOverhead = 0, materialsCost = 0;
  (D().jobs || []).filter(j => j && !j.deleted && inPeriod(j.date)).forEach(j => {
    (j.expenses || []).filter(x => x && !x.deleted).forEach(e => {
      if (typeof depositHeld === "function" && depositHeld(e)) return;   // HOLD-OUT (js/96): an unsettled rental-deposit group is $0 to the P&L until settled at net
      if (typeof expenseIsTool === "function" && expenseIsTool(e)) jobToolOverhead += finCents(e.amount);
      else jobCosts += finCents(e.amount);
    });
    (j.materials || []).filter(x => x && !x.deleted).forEach(m => {
      if (typeof depositHeld === "function" && depositHeld(m)) return;
      materialsCost += finCents(m.amount);
    });
  });

  const mil = finMileage(D().timeclock || [], { from: b.from, to: b.to, confirmedOnly: true });

  // operating / overhead expenses, by category
  const exps = actExpenses().filter(e => inPeriod(e.date));
  const opExBy = {}; let opEx = 0;
  exps.forEach(e => { const c = e.category || "other", v = finCents(e.amount); opExBy[c] = (opExBy[c] || 0) + v; opEx += v; });
  // tool/equipment logged inside a job rolls into overhead (same TOTAL — moved out of jobCosts, into opEx)
  if (jobToolOverhead > 0) { opExBy["tools/equipment (job-logged)"] = (opExBy["tools/equipment (job-logged)"] || 0) + jobToolOverhead; opEx += jobToolOverhead; }

  const totalCosts = jobCosts + materialsCost + mil.total + opEx;
  const net = revenue - totalCosts;
  const margin = revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : 0;
  return { ym, revenue, jobCosts, materials: materialsCost, mileage: mil.total, opEx, opExBy, totalCosts, net, margin, incCount: inc.length };
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

  // INCOME AUDIT — flag any income record that no longer maps to a live paid/reconciled quote-or-invoice (or a job
  // with two). One tap re-syncs the quote-side ones. Keeps "booked exactly once" self-diagnosing.
  const _audit = (typeof finIncomeAudit === "function") ? finIncomeAudit() : [];
  if (_audit.length) {
    h += `<div class="card" style="border-left:4px solid var(--danger)"><div class="nm" style="white-space:normal">⚠ ${_audit.length} income record${_audit.length === 1 ? "" : "s"} to review</div>`
      + _audit.slice(0, 6).map(i => `<div class="sub" style="white-space:normal">• ${fm(Math.round((+i.amount || 0) * 100))} — ${esc(i.msg)}</div>`).join("")
      + (_audit.some(i => i.fixable) ? `<button class="btn acc sm" style="margin-top:8px" onclick="finRunIncomeSync()">↻ Re-sync income</button>` : "")
      + `</div>`;
  }

  // income statement
  h += `<div class="card">`;
  h += finPLLine("Revenue", pl.revenue, { bold: true, good: pl.revenue > 0 });
  h += `<div class="sub" style="margin:10px 0 2px;font-weight:700">Costs</div>`;
  h += finPLLine("🚚 Job expenses (disposal, supplies…)", -pl.jobCosts, { indent: true });
  if (pl.materials) h += finPLLine("🧱 Pass-through materials (billed at cost)", -pl.materials, { indent: true });
  h += finPLLine("Mileage", -pl.mileage, { indent: true });
  Object.keys(pl.opExBy).sort().forEach(c => { h += finPLLine(c, -pl.opExBy[c], { indent: true }); });
  if (!pl.jobCosts && !pl.materials && !pl.mileage && !pl.opEx) h += `<div class="muted" style="padding:4px 0">No costs logged this period.</div>`;
  h += `<div style="border-top:1px solid var(--line);margin:6px 0;padding-top:6px"></div>`;
  h += finPLLine("Total costs", -pl.totalCosts);
  h += `<div style="border-top:2px solid var(--line);margin:8px 0 0;padding-top:8px"></div>`;
  h += finPLLine("Net profit", pl.net, { bold: true, danger: pl.net < 0, good: pl.net > 0 });
  h += `<div class="li"><div class="grow"><div class="nm">Margin</div></div><b style="${pl.margin < 35 ? "color:var(--danger)" : "color:var(--accent)"}">${pl.revenue > 0 ? pl.margin + "%" : "—"}</b></div>`;
  if (pl.revenue > 0 && pl.margin < 35) h += `<div class="note" style="margin-top:6px">⚠ Below the 35% margin floor — check pricing &amp; costs.</div>`;
  h += `</div>`;

  // recurring revenue (MRR) — read-only, DERIVED from active plans (touches no stored money → fingerprints
  // unaffected). Each auto-generated visit quote is $0 to the P&L above until a human bills + pays it.
  if (typeof recurMRR === "function") {
    const mrr = recurMRR();
    const nPlans = (D().recurringPlans || []).filter(p => p && !p.deleted && p.status === "active").length;
    if (nPlans > 0) {
      h += `<div class="card" style="border-left:4px solid var(--accent)"><div class="li"><div class="grow"><div class="nm">🔁 Recurring revenue (MRR)</div><div class="sub" style="white-space:normal">${money(mrr)}/mo across ${nPlans} active plan${nPlans === 1 ? "" : "s"} · annualized ${money(mrr * 12)} · <span onclick="TAB='recurring';render()" style="cursor:pointer;text-decoration:underline">from Recurring →</span></div></div><b>${money(mrr)}</b></div></div>`;
    }
  }

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
    ["Pass-through materials", d2(-pl.materials)],
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
/* DOUBLE-ENTRY GENERAL LEDGER (#12) — a real, balanced set of journal entries DERIVED from the existing records
   (cash basis). Every entry has equal debits + credits by construction, so the trial balance always balances. Gives
   a CPA a proper GL / trial balance to work from without re-architecting storage. Cents. */
function finGeneralLedger(){
  const E = [];
  const push = (date, memo, lines) => { if (lines.some(l => l.dr || l.cr)) E.push({ date: date || "", memo: memo || "", lines: lines }); };
  actIncome().forEach(e => {
    const amt = finCents(e.amount); if (!amt) return;
    const q = e.quoteId ? (D().quotes || []).find(x => x && x.id === e.quoteId) : null;
    const tax = (q && typeof quoteSalesTax === "function") ? Math.round(quoteSalesTax(q) * 100) : 0;
    const lines = [{ acct: "Cash", dr: amt + tax, cr: 0 }, { acct: "Service revenue", dr: 0, cr: amt }];
    if (tax) lines.push({ acct: "Sales tax payable", dr: 0, cr: tax });
    push(e.date, "Income" + (e.invoiceNo ? " · " + e.invoiceNo : ""), lines);
  });
  actExpenses().forEach(e => {
    const amt = finCents(e.amount); if (!amt) return; const acct = "Expense: " + (e.category || "other");
    push(e.date, (e.unpaid ? "Bill (A/P) · " : "Expense · ") + (e.vendor || ""), e.unpaid ? [{ acct: acct, dr: amt, cr: 0 }, { acct: "Accounts payable", dr: 0, cr: amt }] : [{ acct: acct, dr: amt, cr: 0 }, { acct: "Cash", dr: 0, cr: amt }]);
  });
  (D().jobs || []).forEach(j => { if (!j || j.deleted) return; (j.expenses || []).forEach(e => { if (!e || e.deleted || e.unpaid) return; const amt = finCents(e.amount); if (!amt) return; push(e.date || j.date, "Job cost · " + (j.title || ""), [{ acct: "Expense: " + (e.category || "job"), dr: amt, cr: 0 }, { acct: "Cash", dr: 0, cr: amt }]); }); });
  (typeof actDisb === "function" ? actDisb() : []).forEach(x => {
    const amt = finCents(x.amount); if (!amt) return;
    const map = { payout: "Wages / labor", tax: "Income tax paid", draw: "Owner draw", salestax: "Sales tax payable" };
    push(x.date, map[x.type] || x.type || "Disbursement", [{ acct: map[x.type] || "Other", dr: amt, cr: 0 }, { acct: "Cash", dr: 0, cr: amt }]);
  });
  const tb = {}; let dr = 0, cr = 0;
  E.forEach(en => en.lines.forEach(l => { const a = (tb[l.acct] = tb[l.acct] || { dr: 0, cr: 0 }); a.dr += l.dr; a.cr += l.cr; dr += l.dr; cr += l.cr; }));
  return { entries: E.sort((a, b) => (a.date < b.date ? -1 : 1)), trialBalance: tb, totalDr: dr, totalCr: cr, balanced: dr === cr };
}
window.finGeneralLedger = finGeneralLedger;
window.finExportLedger = function(){
  const gl = finGeneralLedger(), d2 = c => ((+c || 0) / 100).toFixed(2), rows = [["Date", "Memo", "Account", "Debit", "Credit"]];
  gl.entries.forEach(en => en.lines.forEach(l => rows.push([en.date, en.memo, l.acct, l.dr ? d2(l.dr) : "", l.cr ? d2(l.cr) : ""])));
  rows.push([], ["TRIAL BALANCE"]);
  Object.keys(gl.trialBalance).sort().forEach(a => rows.push(["", "", a, gl.trialBalance[a].dr ? d2(gl.trialBalance[a].dr) : "", gl.trialBalance[a].cr ? d2(gl.trialBalance[a].cr) : ""]));
  rows.push(["", "", "TOTAL", d2(gl.totalDr), d2(gl.totalCr)]);
  const csv = rows.map(r => r.map(c => { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(",")).join("\n");
  try { const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "jsuite-ledger.csv"; a.click(); } catch (e) { if (typeof alert === "function") alert("Ledger:\n\n" + csv.slice(0, 2000)); }
};
function finAvgMonthlyBurn(){
  const t = today(); let y = +t.slice(0, 4), m = +t.slice(5, 7), total = 0;
  for (let i = 0; i < 3; i++) { m--; if (m < 1) { m = 12; y--; } const ym = y + "-" + String(m).padStart(2, "0"), b = monthBounds(ym);
    total += actExpenses().filter(e => e.date >= b.from && e.date <= b.to).reduce((s, e) => s + finCents(e.amount), 0);
    total += finJobExpenseOut({ from: b.from, to: b.to });   // job hard costs count toward burn too
    total += finMileage(D().timeclock || [], { from: b.from, to: b.to, confirmedOnly: true }).total;
  }
  return Math.round(total / 3);
}
/* all JOB expenses (job.expenses — disposal, supplies, tools) as cash out. These are hard costs the business eats
   (not billed to the customer), so they debit the business fund just like the business-expenses collection. They
   were previously counted by NO account, so cash-on-hand was overstated by every job expense ever logged.
   MATERIALS (job.materials) are deliberately NOT included: they're pass-through — their revenue is already netted
   out of the split base (fix #1) so their cost is net-neutral to cash; subtracting them would double-hit. */
function finJobExpenseOut(opts) {
  opts = opts || {};
  return (D().jobs || []).reduce((s, j) => {
    if (!j || j.deleted) return s;
    if (opts.from && !(j.date && j.date >= opts.from && j.date <= opts.to)) return s;
    return s + (j.expenses || []).filter(e => e && !e.deleted && !e.unpaid && !(typeof depositHeld === "function" && depositHeld(e))).reduce((a, e) => a + finCents(e.amount), 0);
  }, 0);
}
/* ACCOUNTS PAYABLE (#11) — bills logged as unpaid (e.unpaid): a liability owed to vendors, NOT yet cash out.
   Excluded from the cash accounts (finAccountBalances) until marked paid; surfaced as its own A/P total by due date. */
function finAccountsPayable(){
  const bills = actExpenses().filter(e => e && e.unpaid).map(e => ({ id: e.id, cents: finCents(e.amount), vendor: e.vendor || e.note || "Bill", due: e.dueDate || "", cat: e.category || "" }))
    .sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1);
  return { bills: bills, total: bills.reduce((s, b) => s + b.cents, 0) };
}
window.finAccountsPayable = finAccountsPayable;
window.finPayBill = function(id){
  const e = (D().expenses || []).find(x => x && x.id === id); if (!e) return;
  e.unpaid = false; e.dueDate = ""; e.date = (typeof today === "function") ? today() : e.date;   // paid now → date = payment date, enters cash
  if (typeof touch === "function") touch(e);
  if (typeof logChange === "function") logChange("update", "expense", id, "Paid bill " + money(e.amount || 0) + (e.vendor ? " · " + e.vendor : ""));
  if (typeof save === "function") save(); if (typeof render === "function") render();
};
function finAccountBalances(){
  const roll = finRollup(actIncome(), { adminMemberId: (typeof finAdminMember === "function" ? finAdminMember() : "") });
  const mil = finMileage(D().timeclock || [], { confirmedOnly: true });
  const expCents = actExpenses().filter(e => !(e && e.unpaid)).reduce((s, e) => s + finCents(e.amount), 0) + finJobExpenseOut();
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

/* NC sales tax the business has COLLECTED from customers on taxable (RMI) jobs, held as a LIABILITY for NCDOR.
   collected = 6.75% on every PAID taxable quote; remitted = "salestax" disbursements; owed = what to file/pay.
   Kept OUT of income/cash accounts (it was never the business's money). */
function finSalesTaxCollected(){
  const collected = (D().quotes || []).filter(q => q && !q.deleted && q.paid && (typeof quoteTaxable === "function" && quoteTaxable(q))).reduce((s, q) => s + Math.round((typeof quoteSalesTax === "function" ? quoteSalesTax(q) : 0) * 100), 0);
  const remitted = (typeof actDisb === "function" ? actDisb() : []).filter(x => x && x.type === "salestax").reduce((s, x) => s + finCents(x.amount), 0);
  return { collected, remitted, owed: collected - remitted };
}
window.finSalesTaxCollected = finSalesTaxCollected;
function rFinCash(){
  const a = finAccountBalances();
  const stax = finSalesTaxCollected();
  let h = `<div class="card" style="text-align:center"><div class="sub">Cash on hand</div>
    <div style="font-size:30px;font-weight:800;color:${a.cash < 0 ? "var(--danger)" : "var(--accent)"}">${fm(a.cash)}</div>
    <div class="sub">${a.runwayMonths != null ? `~${a.runwayMonths} months runway · ${fm(a.burn)}/mo overhead` : "runway needs a few months of history"}</div></div>`;

  h += `<div class="secthd"><h2>Accounts</h2></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">🏦 Tax reserve</div><div class="sub" style="white-space:normal">25% set aside ${fm(a.taxIn)} − paid ${fm(a.taxPaid)}</div></div><b style="${a.taxBal < 0 ? "color:var(--danger)" : ""}">${fm(a.taxBal)}</b></div>
    <div class="li"><div class="grow"><div class="nm">🏢 Business fund</div><div class="sub" style="white-space:normal">15% ${fm(a.businessIn)}${a.unalloc ? " + unassigned " + fm(a.unalloc) : ""} − expenses ${fm(a.expCents)} − mileage ${fm(a.mileage)}${a.drawPaid ? " − draws " + fm(a.drawPaid) : ""}</div></div><b style="${a.businessBal < 0 ? "color:var(--danger)" : ""}">${fm(a.businessBal)}</b></div>
    <div class="li"><div class="grow"><div class="nm">👷 Owed to members</div><div class="sub" style="white-space:normal">labor ${fm(a.allocatedLabor)} + mileage ${fm(a.mileage)} − paid ${fm(a.payoutPaid)}</div></div><b style="${a.owedBal < 0 ? "color:var(--danger)" : ""}">${fm(a.owedBal)}</b></div></div>`;

  // ACCOUNTS PAYABLE — unpaid vendor bills (a liability; excluded from cash above until paid)
  const ap = (typeof finAccountsPayable === "function") ? finAccountsPayable() : { bills: [], total: 0 };
  if (ap.bills.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>🧾 Accounts payable</h2><span class="ct" style="color:var(--danger)">${fm(ap.total)}</span></div><div class="card">`
      + ap.bills.map(b => `<div class="li"><div class="grow"><div class="nm">${esc(b.vendor)}</div><div class="sub">${b.due ? "due " + fmtDate(b.due) : "no due date"}${b.cat ? " · " + esc(b.cat) : ""}</div></div><div class="row" style="gap:8px;align-items:center"><b>${fm(b.cents)}</b><button class="btn ghost sm" onclick="finPayBill('${b.id}')">Mark paid</button></div></div>`).join("")
      + `<div class="sub" style="margin-top:6px;white-space:normal">Bills you owe but haven't paid — not counted in cash on hand until you mark them paid.</div></div>`;
  }

  // NC SALES TAX collected on taxable jobs — a liability held for NCDOR, separate from cash/income
  if (stax.collected > 0 || stax.remitted > 0) {
    h += `<div class="secthd" style="margin-top:14px"><h2>🧾 Sales tax (NC)</h2><span class="ct" style="${stax.owed > 0 ? "color:var(--danger)" : ""}">${fm(stax.owed)} owed</span></div>
      <div class="card"><div class="li"><div class="grow"><div class="nm">Collected on taxable jobs</div><div class="sub" style="white-space:normal">6.75% charged on paid RMI/taxable invoices − remitted ${fm(stax.remitted)}. Held for NCDOR — not income, not in cash above.</div></div><b style="${stax.owed > 0 ? "color:var(--danger)" : ""}">${fm(stax.owed)}</b></div>
      ${stax.owed > 0 ? `<button class="btn ghost sm" style="margin-top:8px" onclick="recordDisbursement('salestax')">Record a remittance to NC</button>` : ""}</div>`;
  }

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
    const lbl = d.type === "tax" ? "🏦 Tax payment" : d.type === "salestax" ? "🧾 Sales tax remittance" : d.type === "payout" ? ("👷 Payout" + (d.memberId ? " · " + finName(d.memberId) : "")) : "🏢 Owner draw";
    return `<div class="li" onclick="recordDisbursement('${d.type}','${d.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${money(d.amount)} <span class="sub" style="font-weight:400">${esc(lbl)}</span></div><div class="sub">${fmtDate(d.date)}${d.note ? " · " + esc(d.note) : ""}</div></div></div>`;
  }).join("") + `</div>`;
  return h;
}

window.recordDisbursement = function(type, id, presetMember){
  const d = D(); const ex = id ? (d.disbursements || []).find(x => x && x.id === id) : null;
  const t0 = ex ? ex.type : type, members = finMembers();
  const selMember = ex ? ex.memberId : (presetMember || "");   // per-person breakdown can preselect the member to pay
  const title = t0 === "tax" ? "Tax payment" : t0 === "salestax" ? "Sales tax remittance" : t0 === "payout" ? "Payout paid" : "Owner draw";
  modal((ex ? "Edit " : "Record ") + title, `
    <div class="row" style="gap:8px"><div class="grow"><label>Amount ($)</label><input id="db_amt" type="number" inputmode="decimal" value="${ex ? ex.amount : ""}"></div>
      <div class="grow"><label>Date</label><input id="db_date" type="date" value="${ex ? ex.date : today()}"></div></div>
    ${t0 === "payout" ? `<label>Member (optional)</label><select id="db_member"><option value="">— general —</option>${members.map(u => `<option value="${u.id}" ${selMember === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select>` : ""}
    <label>Note (optional)</label><input id="db_note" value="${ex ? esc(ex.note || "") : ""}" placeholder="${t0 === "tax" ? "e.g. Q2 estimated federal" : t0 === "salestax" ? "e.g. NCDOR E-500 filing" : t0 === "payout" ? "e.g. June payout" : "what for"}">
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
  if (typeof logChange === "function") logChange(id ? "update" : "create", "disbursement", e.id, (type === "tax" ? "Tax payment " : type === "salestax" ? "Sales tax remittance " : type === "payout" ? "Payout " : "Draw ") + money(amt));
  save(); closeModal(); render();
};
window.delDisbursement = function(id){
  const d = D(); const e = (d.disbursements || []).find(x => x && x.id === id); if (!e) return;
  if (!confirm("Delete this entry?")) return;
  e.deleted = true; e.updatedAt = now(); if (typeof touch === "function") touch(e); save(); closeModal(); render();
};
