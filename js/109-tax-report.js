/* ---------- FINANCE → 🧾 TAX — sales tax PAID on purchases (owner/admin) ----------
   Ray wanted one place in the Money menu that tracks all the sales tax we're calculating on receipts. This rolls
   up the sales-tax portion Cap backs out of each receipt (or the printed amount) + total business spend, by
   category and by month. It reads the live receipt rows (js/72 rcptAllRows) — no new data, no side effects.

   NOTE: this is sales/use tax we PAID on purchases. It is SEPARATE from (a) the income-tax RESERVE (the 25% set
   aside from revenue — see Payouts) and (b) any sales tax we COLLECT on taxable jobs. The taxability rules live
   in Cap's Playbook → Tax. */
/* 1099-NEC roll-up: total PAYOUTS (nonemployee comp — field/sales/admin pay, NOT reimbursements or owner draws)
   paid to each non-owner member in a calendar year, from the payout disbursements. Flags the $600 IRS threshold
   and whether a W-9 (tax id) is on file. Owners take distributions, not 1099s → excluded. */
function fin1099Report(year) {
  year = year || ((typeof today === "function") ? today().slice(0, 4) : "");
  const byMember = {};
  (typeof actDisb === "function" ? actDisb() : []).forEach(x => {
    if (!x || x.type !== "payout" || !x.memberId || String(x.date || "").slice(0, 4) !== year) return;
    byMember[x.memberId] = (byMember[x.memberId] || 0) + Math.round((+x.amount || 0) * 100);
  });
  // mileage reimbursements are NOT nonemployee comp — subtract each member's confirmed mileage $ for the year
  const mil = (typeof finMileage === "function") ? finMileage((D().timeclock) || [], { confirmedOnly: true, from: year + "-01-01", to: year + "-12-31" }).perMember || {} : {};
  const rows = Object.keys(byMember).map(id => {
    const owner = !!(typeof roleInOrg === "function" && roleInOrg(id, S.biz) === "owner");
    const u = (S.users || []).find(x => x && x.id === id);
    const comp = Math.max(0, byMember[id] - (mil[id] || 0));   // 1099 comp = payouts − mileage reimbursement
    return { id: id, name: (typeof finName === "function" ? finName(id) : id), cents: comp, paid: byMember[id], mileage: mil[id] || 0, owner: owner, hasW9: !!(u && u.taxId), needs: comp >= 60000 && !owner };
  }).filter(r => !r.owner).sort((a, b) => b.cents - a.cents);
  return { year: year, rows: rows };
}
window.fin1099Report = fin1099Report;
/* capture a member's W-9 tax id + address (owner/admin) — needed to file their 1099. Stored on the account record
   (rides the existing per-record sync; an owner write isn't reverted by the server sanitizer). */
window.fin1099SetW9 = function (id) {
  if (typeof finCanView === "function" && !finCanView()) { alert("Owner / Admin only."); return; }
  const u = (S.users || []).find(x => x && x.id === id); if (!u) return;
  const nm = (typeof finName === "function" ? finName(id) : id);
  const tin = prompt("W-9 tax ID (SSN or EIN) for " + nm + " — kept on file for their 1099:", u.taxId || "");
  if (tin === null) return;
  u.taxId = String(tin).trim();
  const addr = prompt("Mailing address for the 1099 (optional):", u.taxAddress || "");
  if (addr !== null) u.taxAddress = String(addr).trim();
  if (typeof touch === "function") touch(u);
  if (typeof save === "function") save();
  if (typeof logChange === "function") logChange("update", "account", id, "Set W-9 tax info for " + nm);
  if (typeof render === "function") render();
};
/* FIXED ASSETS / DEPRECIATION (#10). Capital equipment = tools/equipment purchases at or above the $2,500 IRS
   de-minimis safe harbor (below that is expensed immediately, which the app already does via overhead). For each
   we show cost, purchase year, and a straight-line estimate over `life` years (default 5) — informational; §179 /
   bonus depreciation (expense it all in year 1) is a CPA call, flagged in the note. Cents. */
function finFixedAssets(opts) {
  opts = opts || {}; const life = opts.years || 5, threshold = 250000;
  const assets = [];
  const add = (e, where) => {
    if (!e || e.deleted || !(typeof expenseIsTool === "function" && expenseIsTool(e))) return;
    const cents = finCents(e.amount); if (cents < threshold) return;
    assets.push({ name: e.vendor || e.desc || e.note || "Equipment", cents: cents, date: (e.date || ((typeof rcptDate === "function") ? rcptDate(e) : "")) || "", where: where });
  };
  actExpenses().forEach(e => add(e, "business"));
  (D().jobs || []).forEach(j => { if (j && !j.deleted) (j.expenses || []).forEach(e => add(e, j.title || "job")); });
  const yr = (typeof today === "function") ? +today().slice(0, 4) : new Date().getFullYear();
  return assets.map(a => {
    const buyYr = +String(a.date).slice(0, 4) || yr;
    const annual = Math.round(a.cents / life);
    const elapsed = Math.max(0, Math.min(life, yr - buyYr + 1));
    const accumulated = Math.min(a.cents, annual * elapsed);
    return Object.assign(a, { annual: annual, life: life, accumulated: accumulated, bookValue: a.cents - accumulated });
  }).sort((x, y) => y.cents - x.cents);
}
window.finFixedAssets = finFixedAssets;
function rFinTax() {
  if (typeof finCanView === "function" && !finCanView()) return `<div class="card"><div class="nm">Owner / Admin only</div><div class="sub">The Tax report is restricted to Owner and Admin.</div></div>`;
  const _m2 = (typeof money2 === "function") ? money2 : (n => "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2));
  const _fmc = c => _m2((+c || 0) / 100);
  let hTop = "";
  // sales tax COLLECTED (the liability from taxable jobs — from js/64)
  if (typeof finSalesTaxCollected === "function") {
    const st = finSalesTaxCollected();
    if (st.collected > 0 || st.remitted > 0) hTop += `<div class="card" style="border-left:5px solid #e0a800"><div style="font-weight:800;margin-bottom:6px">🧾 Sales tax COLLECTED (owed to NC)</div>
      <div class="row" style="justify-content:space-between"><span class="sub">Collected on taxable jobs − remitted ${_fmc(st.remitted)}</span><b style="${st.owed > 0 ? "color:var(--danger)" : ""}">${_fmc(st.owed)}</b></div>
      <div class="sub" style="white-space:normal;margin-top:4px">6.75% charged to customers on paid taxable (RMI) invoices, held for NCDOR. Record remittances on Finance → Cash. Separate from the tax you PAID on purchases below.</div></div>`;
  }
  // 1099-NEC per payee
  if (typeof fin1099Report === "function") {
    const r = fin1099Report();
    hTop += `<div class="card"><div style="font-weight:800;margin-bottom:4px">🧾 1099-NEC · ${esc(r.year)}</div>`;
    if (!r.rows.length) hTop += `<div class="muted">No crew/helper payouts recorded in ${esc(r.year)} yet.</div>`;
    else {
      hTop += `<div class="sub" style="white-space:normal;margin-bottom:6px">Total payouts (nonemployee comp) per person this year. Anyone at <b>$600+</b> gets a 1099-NEC — capture their W-9. Excludes owner draws + reimbursements.</div>`;
      hTop += r.rows.map(row => `<div class="li"><div class="grow"><div class="nm">${esc(row.name)}${row.needs ? ` <span class="badge" style="background:#e0a800;color:#fff">1099</span>` : ""}</div><div class="sub">${_fmc(row.cents)} paid${row.needs ? (row.hasW9 ? " · W-9 on file ✓" : " · <span style='color:var(--danger)'>needs W-9</span>") : ""}</div></div>${row.needs ? `<button class="btn ghost sm" style="flex:0 0 auto" onclick="fin1099SetW9('${row.id}')">${row.hasW9 ? "Edit W-9" : "Add W-9"}</button>` : ""}</div>`).join("");
    }
    hTop += `</div>`;
  }
  // #12 double-entry general ledger — trial balance + CSV export
  if (typeof finGeneralLedger === "function") {
    const gl = finGeneralLedger();
    const accts = Object.keys(gl.trialBalance).sort();
    hTop += `<div class="card"><div class="row" style="align-items:center;margin-bottom:4px"><div class="grow" style="font-weight:800">📒 General ledger · trial balance</div><span class="badge" style="background:${gl.balanced ? "var(--accent)" : "var(--danger)"};color:#fff">${gl.balanced ? "balanced ✓" : "OUT OF BALANCE"}</span></div>`;
    if (!accts.length) hTop += `<div class="muted">No transactions yet.</div>`;
    else {
      hTop += `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="color:var(--muted);text-align:left"><th style="padding:3px 6px">Account</th><th style="padding:3px 6px;text-align:right">Debit</th><th style="padding:3px 6px;text-align:right">Credit</th></tr>`
        + accts.map(a => `<tr style="border-top:1px solid var(--line)"><td style="padding:4px 6px;white-space:normal">${esc(a)}</td><td style="padding:4px 6px;text-align:right">${gl.trialBalance[a].dr ? _fmc(gl.trialBalance[a].dr) : ""}</td><td style="padding:4px 6px;text-align:right">${gl.trialBalance[a].cr ? _fmc(gl.trialBalance[a].cr) : ""}</td></tr>`).join("")
        + `<tr style="border-top:2px solid var(--line);font-weight:800"><td style="padding:5px 6px">TOTAL</td><td style="padding:5px 6px;text-align:right">${_fmc(gl.totalDr)}</td><td style="padding:5px 6px;text-align:right">${_fmc(gl.totalCr)}</td></tr></table>`;
      hTop += `<div class="sub" style="white-space:normal;margin-top:6px">Cash-basis journal derived from income, expenses &amp; disbursements — a real double-entry ledger for your CPA. Debits always equal credits.</div>`;
      hTop += `<button class="btn ghost sm" style="margin-top:8px" onclick="finExportLedger()">⬇ Export general ledger (CSV)</button>`;
    }
    hTop += `</div>`;
  }
  // #10 fixed assets / depreciation
  if (typeof finFixedAssets === "function") {
    const fa = finFixedAssets();
    if (fa.length) {
      const totCost = fa.reduce((s, a) => s + a.cents, 0), totBook = fa.reduce((s, a) => s + a.bookValue, 0);
      hTop += `<div class="card"><div style="font-weight:800;margin-bottom:4px">🏗 Fixed assets · depreciation</div>`
        + `<div class="sub" style="white-space:normal;margin-bottom:6px">Equipment ≥ $2,500 (below that is expensed). Straight-line over ${fa[0].life} yrs — <b>informational</b>; §179/bonus lets you expense it all in year 1. Confirm the method with your CPA.</div>`
        + fa.map(a => `<div class="li"><div class="grow"><div class="nm">${esc(a.name)}</div><div class="sub">${_fmc(a.cents)} · ${esc(String(a.date).slice(0, 4) || "?")} · ~${_fmc(a.annual)}/yr</div></div><div style="text-align:right;flex:0 0 auto"><b>${_fmc(a.bookValue)}</b><div class="sub" style="font-size:11px">book value</div></div></div>`).join("")
        + `<div class="li" style="border-top:1px solid var(--line)"><div class="grow"><div class="nm">Total</div></div><div style="text-align:right"><b>${_fmc(totBook)}</b><div class="sub" style="font-size:11px">of ${_fmc(totCost)} cost</div></div></div></div>`;
    }
  }
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
  let h = hTop + `<div class="card" style="border-left:5px solid var(--brand)"><div style="font-weight:800;margin-bottom:6px">🧾 Sales tax paid on purchases</div>`;
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
