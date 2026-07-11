/* ---------- FINANCE PAGE (owner/admin) — the money engine for the operating agreement ----------
   Drives the js/39 split engine off the synced income/expenses collections + the timeclock.
   Sub-views: Payouts (period split + per-member owed + account funding), Income (log/link), Expenses.
   Mileage is reimbursed from the Business Fund (computed live from confirmed time-clock miles). */

let FINSUB = "overview", FIN_MONTH = null;
let FININCOME_CREW = new Set();

/* ---- money formatting (cents → $0.00, exact) ---- */
function fm(c) { const neg = (c || 0) < 0; c = Math.abs(Math.round(c || 0)); return (neg ? "-$" : "$") + (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* ---- accessors ---- */
function actIncome() { return (D().income || []).filter(x => x && !x.deleted); }
/* attach each income's linked-job crew share weights (job.crewWeights) so the field split honors a partial
   helper. Income with no linked job or a job with no weights is returned unchanged → equal split (byte-identical). */
function incomeWithWeights(list) {
  const jobs = D().jobs || [];
  return (list || []).map(e => {
    if (e && e.jobId && !e.weights) { const j = jobs.find(x => x && x.id === e.jobId); if (j && j.crewWeights) return Object.assign({}, e, { weights: j.crewWeights }); }
    return e;
  });
}
function actExpenses() { return (D().expenses || []).filter(x => x && !x.deleted); }
function finMembers() { return (typeof realAccounts === "function") ? realAccounts() : (S.users || []).filter(u => u && !u.kind && !u.deleted); }
function finName(id) { return (typeof userName === "function" && userName(id)) || id || "—"; }
function finCanView() { return (typeof canSee === "function") ? canSee("finance") : true; }
/* admin-member config rides the synced docs collection as a sentinel record (no new mechanism) */
function finCfg() { const d = D(); d.docs = d.docs || []; let c = d.docs.find(x => x.id === "financeConfig"); if (!c) { c = { id: "financeConfig", text: "", adminMemberId: "", updatedAt: now() }; d.docs.push(c); } return c; }
function finAdminMember() { return finCfg().adminMemberId || ""; }
window.finSetAdmin = function (id) { const c = finCfg(); c.adminMemberId = id || ""; touch(c); save(); render(); };
/* a PAID job auto-syncs an income record (idempotent id keyed to the quote) so payouts reflect it in
   real time. amount = final price (or quote total); crew/date/sales-credit come from the linked job + customer.
   Un-paying tombstones it. This is what connects the Jobs flow to the payout engine. */
window.syncQuoteIncome = function (q) {
  if (!q || !q.id) return;
  const d = D(); d.income = d.income || [];
  const incId = "inc_q_" + q.id;
  let e = d.income.find(x => x && x.id === incId);
  // RECONCILED TO A SQUARE INVOICE (js/108): the paid Square invoice is the income of record (inc_sq_*), so a
  // reconciled quote must NOT book its own income — otherwise the same money counts twice (e.g. Michelle's $960
  // junk + $720 move both marked paid vs the ONE $960 Square invoice). Tombstone any inc_q_* it left. This makes
  // taxable income = what Square actually collected. Un-reconciling (clear reconciledInvoiceId) re-books it.
  // A DELETED quote (archived) or one RECONCILED to a Square invoice must NOT keep its own income record — else a
  // deleted paid quote counts revenue for a job that no longer exists (the Square reconcile UI even tells the owner
  // to "archive the duplicate"). Tombstone its inc_q_*; restoring the quote re-books it (archRestore re-syncs).
  if (q.deleted || q.reconciledInvoiceId) { if (e && !e.deleted) { e.deleted = true; if (typeof touch === "function") touch(e); } return; }
  if (q.paid) {
    const job = q.jobId ? (d.jobs || []).find(j => j && j.id === q.jobId && !j.deleted) : null;
    const cust = q.customerId ? (d.customers || []).find(c => c && c.id === q.customerId) : null;
    const fields = {
      quoteId: q.id, jobId: q.jobId || "", fromQuote: true,
      amount: (q.finalPrice || q.total || 0),
      date: q.paidDate || (job && job.date) || q.acceptedDate || q.date || (typeof today === "function" ? today() : ""),
      crew: (job && Array.isArray(job.crew)) ? job.crew.slice() : [],
      originator: (cust && cust.soldBy) || "",
      bookedAt: q.acceptedDate || q.date || "",
      houseAccount: false, deleted: false
    };
    if (e) Object.assign(e, fields); else { e = Object.assign({ id: incId }, fields); d.income.push(e); }
    if (typeof touch === "function") touch(e);
  } else if (e && !e.deleted) {
    e.deleted = true; if (typeof touch === "function") touch(e);
  }
};

/* INCOME AUDIT — the invariant that keeps "booked exactly once" honest. Every live inc_q_* must map to a live,
   paid, un-reconciled quote; every live inc_sq_* to a live reconciled invoice; and no single job may carry two live
   income records. Returns the list of violations (empty = clean). Cheap; run behind a Finance button / at a glance. */
function finIncomeAudit() {
  const d = D(); const issues = [];
  const income = (d.income || []).filter(x => x && !x.deleted);
  const qById = {}; (d.quotes || []).forEach(q => { if (q) qById[q.id] = q; });
  const ivById = {}; (d.invoices || []).forEach(iv => { if (iv) ivById[iv.id] = iv; });
  income.forEach(e => {
    if (typeof e.id === "string" && e.id.indexOf("inc_q_") === 0) {
      const q = qById[e.quoteId || e.id.slice(6)];
      if (!q || q.deleted) issues.push({ id: e.id, amount: e.amount, msg: "income for a deleted / missing quote", fixable: true });
      else if (!q.paid) issues.push({ id: e.id, amount: e.amount, msg: "income for a quote no longer marked paid", fixable: true });
      else if (q.reconciledInvoiceId) issues.push({ id: e.id, amount: e.amount, msg: "quote income AND a Square reconcile — double-counted", fixable: true });
    } else if (typeof e.id === "string" && e.id.indexOf("inc_sq_") === 0) {
      const iv = ivById[e.invoiceId];
      if (!iv || iv.deleted) issues.push({ id: e.id, amount: e.amount, msg: "Square income for a missing invoice", fixable: false });
      else if (!iv.reconciled) issues.push({ id: e.id, amount: e.amount, msg: "Square income but its invoice isn't reconciled", fixable: false });
    }
  });
  const byJob = {}; income.forEach(e => { if (e.jobId) (byJob[e.jobId] = byJob[e.jobId] || []).push(e); });
  Object.keys(byJob).forEach(jid => { if (byJob[jid].length > 1) issues.push({ id: jid, amount: byJob[jid].reduce((s, e) => s + (+e.amount || 0), 0), msg: byJob[jid].length + " income records for one job", fixable: false }); });
  return issues;
}
window.finIncomeAudit = finIncomeAudit;
/* self-heal: re-sync every quote's income to its CURRENT state (tombstones deleted/unpaid/reconciled, re-books paid,
   refreshes stale change-order amounts). Fixes the quote-side issues finIncomeAudit reports. */
window.finRunIncomeSync = function () {
  (D().quotes || []).forEach(q => { if (q && typeof syncQuoteIncome === "function") syncQuoteIncome(q); });
  if (typeof save === "function") save();
  const left = finIncomeAudit().filter(i => i.fixable).length;
  if (typeof render === "function") render();
  if (typeof alert === "function") alert(left ? ("Re-synced income. " + left + " issue(s) still need a look (Square-side).") : "Income re-synced — all quote income reconciles. ✓");
};

/* ---- period (a chosen month; aligns with the monthly admin cap) ---- */
function finMonth() { return FIN_MONTH || today().slice(0, 7); }
function monthBounds(ym) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7), last = new Date(y, m, 0).getDate(); return { from: ym + "-01", to: ym + "-" + String(last).padStart(2, "0") }; }
function finMonthLabel(ym) { return new Date(ym + "-01T00:00:00").toLocaleString(undefined, { month: "long", year: "numeric" }); }
window.finMonthShift = function (n) { const ym = finMonth(); let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; FIN_MONTH = y + "-" + String(m + 1).padStart(2, "0"); render(); };
window.finSub = function (s) { FINSUB = s; render(); };

/* ===================== page ===================== */
function rFinance() {
  if (!finCanView()) { view.innerHTML = `<div class="card"><div class="nm">Owner / Admin only</div><div class="sub">The Finance page is restricted to Owner and Admin roles.</div></div>`; return; }
  const sub = `<div class="subnav">
    <button class="subbtn ${FINSUB === "overview" ? "on" : ""}" onclick="finSub('overview')">📊 Overview</button>
    <button class="subbtn ${FINSUB === "cash" ? "on" : ""}" onclick="finSub('cash')">🏦 Cash</button>
    <button class="subbtn ${FINSUB === "payouts" ? "on" : ""}" onclick="finSub('payouts')">💵 Payouts</button>
    <button class="subbtn ${FINSUB === "priority" ? "on" : ""}" onclick="finSub('priority')">🪜 Payout plan</button>
    <button class="subbtn ${FINSUB === "income" ? "on" : ""}" onclick="finSub('income')">📥 Income</button>
    <button class="subbtn ${FINSUB === "expenses" ? "on" : ""}" onclick="finSub('expenses')">📤 Expenses</button>
    <button class="subbtn ${FINSUB === "tax" ? "on" : ""}" onclick="finSub('tax')">🧾 Tax</button>
    <button class="subbtn ${FINSUB === "owed" ? "on" : ""}" onclick="finSub('owed')">💸 A/R</button>
    <button class="subbtn ${FINSUB === "pl" ? "on" : ""}" onclick="finSub('pl')">💹 Job P&L</button>
    <button class="subbtn ${FINSUB === "analysis" ? "on" : ""}" onclick="finSub('analysis')">📈 Analysis</button></div>`;
  if (FINSUB === "overview" && typeof rFinOverview === "function") { view.innerHTML = sub + '<div class="pgcols">' + rFinOverview() + '</div>'; return; }
  if (FINSUB === "cash" && typeof rFinCash === "function") { view.innerHTML = sub + rFinCash(); return; }
  if (FINSUB === "owed" && typeof rReceivables === "function") { view.innerHTML = sub + rReceivables(); return; }
  if (FINSUB === "pl" && typeof rJobPL === "function") { view.innerHTML = sub + rJobPL(); return; }
  if (FINSUB === "analysis" && typeof rJobAnalysis === "function") { view.innerHTML = sub + rJobAnalysis(); return; }
  if (FINSUB === "tax" && typeof rFinTax === "function") { view.innerHTML = sub + rFinTax(); return; }
  if (FINSUB === "priority" && typeof rFinPriority === "function") { view.innerHTML = sub + rFinPriority(); return; }
  if (FINSUB === "income") { view.innerHTML = sub + rFinIncome(); return; }
  if (FINSUB === "expenses") { view.innerHTML = sub + rFinExpenses(); return; }
  view.innerHTML = sub + rFinPayouts();
}

/* ---------- PAYOUTS: the split engine for the period ---------- */
function rFinPayouts() {
  const ym = finMonth(), b = monthBounds(ym), adminId = finAdminMember();
  const roll = finRollup(incomeWithWeights(actIncome()), { adminMemberId: adminId, from: b.from, to: b.to });
  const mil = finMileage(D().timeclock || [], { from: b.from, to: b.to, confirmedOnly: true });
  const exps = actExpenses().filter(e => e.date >= b.from && e.date <= b.to);
  const expCents = exps.reduce((s, e) => s + finCents(e.amount), 0);
  const acct = finAccounts(roll.totals, mil.total, expCents);
  const flt = finFaultDeductions(D().jobs || [], { from: b.from, to: b.to });
  const pay = finPayouts(roll, mil, flt), members = finMembers();
  const owedTotal = roll.totals.field + roll.totals.sales + roll.totals.admin + mil.total;

  let h = `<div class="card"><div class="row" style="align-items:center">
      <button class="btn ghost sm" onclick="finMonthShift(-1)">‹</button>
      <div class="grow" style="text-align:center"><b>${esc(finMonthLabel(ym))}</b><div class="sub">${roll.perJob.length} income entr${roll.perJob.length === 1 ? "y" : "ies"} · ${fm(roll.totals.amount)} revenue${roll.totals.passThrough > 0 ? ` <span style="color:var(--muted)">(${fm(roll.totals.gross)} billed − ${fm(roll.totals.passThrough)} materials pass-through)</span>` : ""}</div></div>
      <button class="btn ghost sm" onclick="finMonthShift(1)">›</button></div>
    <label style="margin-top:10px">Admin Member — 5% of labor, capped $500/mo</label>
    <select onchange="finSetAdmin(this.value)"><option value="">— none (admin share → field work) —</option>${members.map(u => `<option value="${u.id}" ${adminId === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select></div>`;

  /* account funding */
  h += `<div class="secthd"><h2>Move to accounts</h2></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">🏦 Tax Reserve</div><div class="sub">25% of revenue — set aside for taxes</div></div><b>${fm(acct.taxReserve)}</b></div>
    <div class="li"><div class="grow"><div class="nm">🏢 Business Fund</div><div class="sub" style="white-space:normal">15% inflow ${fm(acct.businessFundInflow)} − mileage ${fm(acct.mileageOut)} − expenses ${fm(acct.expensesOut)}</div></div><b style="${acct.businessFundNet < 0 ? "color:var(--danger)" : ""}">${fm(acct.businessFundNet)}</b></div></div>`;

  /* per-member owed */
  h += `<div class="secthd"><h2>Owed to members</h2><span class="ct">${fm(owedTotal)}</span></div>`;
  const ids = Object.keys(pay).sort((a, c) => finName(a).localeCompare(finName(c)));
  if (!ids.length) h += `<div class="card"><div class="muted">No payouts this period — record income to compute the split.</div></div>`;
  else h += `<div class="card">` + ids.map(id => { const r = pay[id]; return `<div class="li" style="align-items:flex-start"><div class="grow"><div class="nm">${esc(finName(id))}</div><div class="sub" style="white-space:normal">Field ${fm(r.field)} · Sales ${fm(r.sales)} · Admin ${fm(r.admin)}${r.mileage ? `<br><span style="color:var(--muted)">↩ ${fm(r.mileage)} gas reimbursement — covers their fuel, not earnings</span>` : ""}${r.fault ? `<br><span style="color:var(--danger);font-weight:700">⚠ −${fm(r.fault)} — their own job mistake (docked from them, not the crew)</span>` : ""}</div></div><div style="text-align:right;flex:0 0 auto"><b>${fm(r.distribution)}</b><div class="sub" style="font-size:11px">earned${r.mileage ? `<br>+ ${fm(r.mileage)} reimb.` : ""}${r.fault ? `<br>− ${fm(r.fault)} fault` : ""}${(r.mileage || r.fault) ? `<br>= ${fm(r.total)} to pay` : ""}</div></div></div>`; }).join("") + `</div>`;

  /* notes */
  const notes = [];
  if (roll.totals.unallocatedField > 0) notes.push(`${fm(roll.totals.unallocatedField)} field work is unassigned (jobs with no crew) — assign crew so it distributes.`);
  if (roll.totals.adminOverflow > 0 && adminId) notes.push(`${fm(roll.totals.adminOverflow)} admin over the $500/mo cap was redirected to field work.`);
  if (!adminId) notes.push(`No Admin Member selected — the 5% admin share is going to field work.`);
  if (notes.length) h += `<div class="card" style="border-left:4px solid var(--accent)">` + notes.map(n => `<div class="sub" style="white-space:normal">• ${n}</div>`).join("") + `</div>`;

  /* per-job split breakdown */
  h += `<div class="secthd"><h2>Per-job split</h2><span class="ct">${roll.perJob.length}</span></div>`;
  if (roll.perJob.length) h += `<div class="card">` + roll.perJob.map(pj => finJobBreakdownHTML(pj, adminId)).join("") + `</div>`;
  else h += `<div class="card"><div class="muted">No income recorded for ${esc(finMonthLabel(ym))}.</div></div>`;

  /* mileage detail */
  if (mil.total > 0) {
    h += `<div class="secthd"><h2>Mileage (from time clock)</h2><span class="ct">${mil.miles} mi · ${fm(mil.total)}</span></div><div class="card"><div class="sub" style="white-space:normal;margin-bottom:6px">Reimbursed to the vehicle owner from the Business Fund @ $${FIN.MILEAGE_RATE}/mi — confirmed miles only, not a distribution.</div>` + Object.keys(mil.perMember).map(id => `<div class="li"><div class="grow">${esc(finName(id))}</div><b>${fm(mil.perMember[id])}</b></div>`).join("") + `</div>`;
  }
  return h;
}
function finJobBreakdownHTML(pj, adminId) {
  const j = (D().jobs || []).find(x => x.id === pj.jobId), title = (j && j.title) || "Income", s = pj.split;
  const fieldLines = Object.keys(pj.field).map(id => `${esc(finName(id))} ${fm(pj.field[id])}`).join(" · ") || (pj.unallocated ? `unassigned ${fm(pj.unallocated)}` : "—");
  const salesLine = s.salesToOriginator > 0 ? `${esc(finName(s.originator))} ${fm(s.salesToOriginator)}` : `→ field work (${s.originator ? "out of window / house" : "no originator"})`;
  const adminLine = pj.adminToMember > 0 ? `${esc(finName(adminId))} ${fm(pj.adminToMember)}` : (pj.adminOverflow > 0 ? `→ field work (${adminId ? "over $500/mo cap" : "no admin member"})` : "—");
  return `<details style="border-bottom:1px solid var(--line);padding:7px 0"><summary style="cursor:pointer;font-weight:700">${esc(title)} · ${fmtDate(pj.date)} — ${fm(pj.amount)}${pj.passThrough > 0 ? ` <span class="sub" style="font-weight:400">of ${fm(pj.gross)}</span>` : ""}</summary>
    <div class="sub" style="white-space:normal;margin-top:6px;line-height:1.7">
      ${pj.passThrough > 0 ? `↩ Materials pass-through ${fm(pj.passThrough)} → back to whoever paid (not split)<br>Split base ${fm(pj.amount)} = ${fm(pj.gross)} billed − ${fm(pj.passThrough)} materials<br>` : ""}Tax (25%) ${fm(s.tax)} · Business (15%) ${fm(s.business)} · Labor (60%) ${fm(s.labor)}<br>
      <b>Field</b> ${fm(pj.fieldPool)} → ${fieldLines}<br>
      <b>Sales</b> ${fm(s.sales)} → ${salesLine}<br>
      <b>Admin</b> ${fm(s.admin)} → ${adminLine}
    </div></details>`;
}

/* ---------- INCOME ---------- */
function rFinIncome() {
  const inc = actIncome().slice().sort((a, b) => (a.date + a.id) < (b.date + b.id) ? 1 : -1);
  const recorded = new Set(inc.map(x => x.jobId).filter(Boolean));
  const doneJobs = actJ().filter(j => j.done && !recorded.has(j.id));
  let h = `<div class="secthd"><h2>Income</h2><button class="btn ghost sm" onclick="openIncome()">+ Add</button></div>`;
  if (typeof sqInvFinanceCard === "function") h += sqInvFinanceCard();   // Square invoice import + reconciliation (the paid-invoice source of truth)
  if (doneJobs.length) h += `<div class="card" style="border-left:4px solid var(--accent)"><div class="nm" style="font-size:15px;margin-bottom:6px">Completed jobs not yet recorded</div>` + doneJobs.slice(0, 8).map(j => { const q = j.quoteId ? D().quotes.find(x => x.id === j.quoteId) : null; return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(j.title || "Job")}</div><div class="sub">${fmtDate(j.date)}${q ? " · " + money(q.total || 0) : ""}</div></div><button class="btn acc sm" onclick="openIncome(null,'${j.id}')">Record</button></div>`; }).join("") + `</div>`;
  if (!inc.length) h += `<div class="card"><div class="muted">No income yet. Record a completed/invoiced job above, or add one manually.</div></div>`;
  else h += `<div class="card">` + inc.map(e => { const j = e.jobId ? (D().jobs || []).find(x => x.id === e.jobId) : null; return `<div class="li" onclick="openIncome('${e.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${money(e.amount || 0)}${e.invoice ? ` · inv ${esc(e.invoice)}` : ""}</div><div class="sub" style="white-space:normal">${fmtDate(e.date)}${j ? " · " + esc(j.title || "job") : ""} · ${(e.crew || []).length} crew${e.originator ? " · sale " + esc(finName(e.originator)) : ""}${e.houseAccount ? " · house" : ""}</div></div></div>`; }).join("") + `</div>`;
  return h;
}
window.openIncome = function (id, jobId) {
  const d = D(); const isNew = !id;
  const e = id ? d.income.find(x => x.id === id) : { id: uid(), date: today(), crew: [], amount: 0, originator: "", bookedAt: "", houseAccount: false };
  if (isNew && jobId) { const job = d.jobs.find(x => x.id === jobId); if (job) {
    e.jobId = job.id; e.crew = (job.crew || []).slice(); e.date = job.date || today(); e.address = job.address || "";
    if (job.quoteId) { const q = d.quotes.find(x => x.id === job.quoteId); if (q) { e.amount = q.total || 0; e.quoteId = q.id; e.bookedAt = q.date || ""; } }
    if (job.customerId) { const c = d.customers.find(x => x.id === job.customerId); if (c) { e.originator = c.soldBy || ""; } }
  } }
  FININCOME_CREW = new Set(e.crew || []);
  const members = finMembers();
  const jobOpts = `<option value="">— none / manual —</option>` + actJ().map(j => `<option value="${j.id}" ${e.jobId === j.id ? "selected" : ""}>${esc((j.title || "Job") + " · " + fmtDate(j.date))}</option>`).join("");
  // keep an ARCHIVED originator selectable so editing an old income never silently wipes their sales credit
  const origArchived = (e.originator && !members.some(u => u.id === e.originator)) ? `<option value="${esc(e.originator)}" selected>${esc(finName(e.originator))} (archived)</option>` : "";
  const origOpts = `<option value="">— none / house account —</option>` + origArchived + members.map(u => `<option value="${u.id}" ${e.originator === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("");
  modal(isNew ? "Record income" : "Income", `
    ${isNew ? `<label>From job (prefills amount, crew, sale)</label><select id="in_job" onchange="if(this.value)openIncome(null,this.value)">${jobOpts}</select>` : ``}
    <div class="row" style="gap:8px"><div class="grow"><label>Amount ($)</label><input id="in_amt" type="number" inputmode="decimal" value="${e.amount || 0}" oninput="renderIncomePreview()"></div>
      <div class="grow"><label>Date</label><input id="in_date" type="date" value="${e.date || today()}"></div></div>
    <label>Invoice #</label><input id="in_inv" value="${esc(e.invoice || "")}" placeholder="QuickBooks invoice # (optional)">
    <label>Crew who worked it (splits Field Work)</label><div id="in_crew"></div>
    <div class="row" style="gap:8px"><div class="grow"><label>Sales credit (originator)</label><select id="in_orig" onchange="renderIncomePreview()">${origOpts}</select></div>
      <div class="grow"><label>Booked date (3-mo window)</label><input id="in_booked" type="date" value="${e.bookedAt || ""}" onchange="renderIncomePreview()"></div></div>
    <div class="toggle"><input type="checkbox" id="in_house" ${e.houseAccount ? "checked" : ""} onchange="renderIncomePreview()"><label style="margin:0">House account (sales credit → field work)</label></div>
    <div class="card" id="in_preview" style="background:var(--soft);margin-top:10px"></div>
    <button class="btn acc" style="margin-top:12px" onclick="saveIncome('${e.id}',${isNew})">Save</button>
    ${isNew ? "" : `<button class="btn danger" style="margin-top:10px" onclick="delIncome('${e.id}')">Delete</button>`}`);
  renderIncomeCrew(); renderIncomePreview();
};
function renderIncomeCrew() {
  const box = document.getElementById("in_crew"); if (!box) return;
  const members = finMembers();
  if (!members.length) { box.innerHTML = `<div class="muted">No team accounts.</div>`; return; }
  box.innerHTML = members.map(u => `<label class="li" style="cursor:pointer;padding:7px 0"><input type="checkbox" style="width:18px;height:18px;flex:0 0 auto" ${FININCOME_CREW.has(u.id) ? "checked" : ""} onchange="toggleIncomeCrew('${u.id}')"><div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)}</div></div></label>`).join("");
}
window.toggleIncomeCrew = function (id) { if (FININCOME_CREW.has(id)) FININCOME_CREW.delete(id); else FININCOME_CREW.add(id); renderIncomeCrew(); renderIncomePreview(); };
function renderIncomePreview() {
  const box = document.getElementById("in_preview"); if (!box) return;
  const inc = { amount: parseFloat(val("in_amt")) || 0, date: val("in_date") || today(), crew: [...FININCOME_CREW], originator: val("in_orig"), bookedAt: val("in_booked"), houseAccount: !!(document.getElementById("in_house") || {}).checked };
  const js = finJobSplit(inc);
  const adminId = finAdminMember();
  const fieldEach = js.crew.length ? fm(Math.floor(js.fieldBeforeAdmin / js.crew.length)) : "—";
  box.innerHTML = `<div class="nm" style="font-size:14px">Where this splits</div>
    <div class="sub" style="white-space:normal;line-height:1.7;margin-top:4px">
    Tax ${fm(js.tax)} · Business ${fm(js.business)}<br>
    Field ${fm(js.fieldBeforeAdmin)}${js.crew.length ? ` → ${js.crew.length} crew (~${fieldEach} each)` : ` <span style="color:var(--danger)">→ unassigned (add crew)</span>`}<br>
    Sales ${fm(js.sales)} → ${js.salesToOriginator > 0 ? esc(finName(js.originator)) : "<span style='color:var(--muted)'>field work (house / out-of-window / none)</span>"}<br>
    Admin ${fm(js.rawAdmin)} → ${adminId ? esc(finName(adminId)) + " (cap $500/mo)" : "<span style='color:var(--muted)'>field work (no admin member)</span>"}</div>`;
}
window.saveIncome = function (id, isNew) {
  const d = D(); let e = isNew ? { id } : d.income.find(x => x.id === id);
  const amt = parseFloat(val("in_amt")) || 0;
  if (amt <= 0) { alert("Enter an amount."); return; }
  if (typeof submitGuard === "function" && !submitGuard("saveIncome:" + id)) return;   // rapid-tap dupe guard
  e.amount = amt; e.date = val("in_date") || today(); e.invoice = val("in_inv"); e.jobId = (document.getElementById("in_job") ? val("in_job") : e.jobId) || e.jobId || "";
  e.crew = [...FININCOME_CREW]; e.originator = val("in_orig"); e.bookedAt = val("in_booked"); e.houseAccount = !!(document.getElementById("in_house") || {}).checked;
  if (e.jobId) { const j = d.jobs.find(x => x.id === e.jobId); if (j) { e.quoteId = j.quoteId || e.quoteId || ""; } }
  touch(e); if (isNew) d.income.push(e);
  if (typeof logChange === "function") logChange(isNew ? "create" : "update", "income", e.id, (isNew ? "Recorded income " : "Updated income ") + money(amt));
  save(); closeModal(); render();
};
window.delIncome = function (id) { if (!confirm("Delete this income entry?")) return; const e = D().income.find(x => x.id === id); if (e) { e.deleted = true; touch(e); if (typeof logChange === "function") logChange("delete", "income", id, "Deleted income " + money(e.amount || 0)); } save(); closeModal(); render(); };

/* ---------- EXPENSES ---------- */
const EXP_CATS = ["disposal", "rentals", "fuel/mileage", "equipment", "software", "marketing", "meals", "crew supplies", "other"];
function rFinExpenses() {
  const exps = actExpenses().slice().sort((a, b) => (a.date + a.id) < (b.date + b.id) ? 1 : -1);
  const total = exps.reduce((s, e) => s + finCents(e.amount), 0);
  const ym = finMonth(), b = monthBounds(ym);
  const mil = finMileage(D().timeclock || [], { from: b.from, to: b.to, confirmedOnly: true });
  let h = `<div class="secthd"><h2>🔧 Business &amp; tools (overhead / capital)</h2><button class="btn ghost sm" onclick="openExpense()">+ Add</button></div>`;
  if (mil.total > 0) h += `<div class="card" style="border-left:4px solid var(--accent)"><div class="nm" style="font-size:15px">🚐 Mileage — ${esc(finMonthLabel(ym))}</div><div class="sub" style="white-space:normal">${mil.miles} mi @ $${FIN.MILEAGE_RATE}/mi = <b>${fm(mil.total)}</b>, auto from the time clock (confirmed). Reimbursed to the vehicle owner from the Business Fund — see the Payouts tab.</div></div>`;
  // TOOLS logged INSIDE a job — a reusable tool (category tools/equipment) is business overhead, so surface it here
  // even though the record lives in job.expenses[] (never moved). Read-through rows, labeled with the job it's on.
  const _jobTools = [];
  (D().jobs || []).filter(j => j && !j.deleted).forEach(j => { (j.expenses || []).filter(x => x && !x.deleted && typeof expenseIsTool === "function" && expenseIsTool(x)).forEach(e => _jobTools.push({ e: e, j: j })); });
  if (_jobTools.length) {
    const _tt = _jobTools.reduce((s, x) => s + finCents(x.e.amount), 0);
    h += `<div class="secthd" style="margin-top:14px"><h2>🔧 Tools logged on jobs</h2><span class="ct">${fm(_tt)}</span></div><div class="card">` + _jobTools.map(x => `<div class="li"><div class="grow"><div class="nm">${money(x.e.amount || 0)} <span class="badge" style="background:var(--soft);color:var(--muted)">tools/equipment</span></div><div class="sub" style="white-space:normal">${x.e.vendor ? esc(x.e.vendor) + " · " : ""}${esc(x.e.desc || "")}${(x.e.vendor || x.e.desc) ? " · " : ""}logged on ${esc(x.j.title || "job")}</div></div></div>`).join("") + `<div class="sub" style="margin-top:6px;white-space:normal">Overhead / capital — excluded from that job's cost, counted as business overhead.</div></div>`;
  }
  if (!exps.length) h += `<div class="card"><div class="muted">No expenses logged. Track disposal, rentals, fuel, equipment, software &amp; marketing here.</div></div>`;
  else h += `<div class="secthd" style="margin-top:14px"><h2>Logged</h2><span class="ct">${fm(total)}</span></div><div class="card">` + exps.map(e => `<div class="li" onclick="openExpense('${e.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${money(e.amount || 0)} <span class="badge" style="background:var(--soft);color:var(--muted)">${esc(e.category || "other")}</span></div><div class="sub" style="white-space:normal">${fmtDate(e.date)}${e.note ? " · " + esc(e.note) : ""}${e.vendor ? " · " + esc(e.vendor) : ""}</div></div></div>`).join("") + `</div>`;
  return h;
}
window.openExpense = function (id) {
  const d = D(); const isNew = !id;
  const e = id ? d.expenses.find(x => x.id === id) : { id: uid(), date: today(), category: "disposal", amount: 0 };
  const members = finMembers();
  modal(isNew ? "Add expense" : "Expense", `
    <div class="row" style="gap:8px"><div class="grow"><label>Amount ($)</label><input id="ex_amt" type="number" inputmode="decimal" value="${e.amount || 0}"></div>
      <div class="grow"><label>Date</label><input id="ex_date" type="date" value="${e.date || today()}"></div></div>
    <label>Category</label><select id="ex_cat">${EXP_CATS.map(c => `<option ${e.category === c ? "selected" : ""}>${c}</option>`).join("")}</select>
    <label>Note</label><input id="ex_note" value="${esc(e.note || "")}" placeholder="what / why">
    <label>Vendor (optional)</label><input id="ex_vendor" value="${esc(e.vendor || "")}">
    <label>Paid by / reimburse (optional)</label><select id="ex_member"><option value="">— business —</option>${members.map(u => `<option value="${u.id}" ${((e.memberId || e.paidBy) === u.id) ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select>
    <button class="btn acc" style="margin-top:12px" onclick="saveExpense('${e.id}',${isNew})">Save</button>
    ${isNew ? "" : `<button class="btn danger" style="margin-top:10px" onclick="delExpense('${e.id}')">Delete</button>`}`);
};
window.saveExpense = function (id, isNew) {
  const d = D(); let e = isNew ? { id } : d.expenses.find(x => x.id === id);
  const amt = parseFloat(val("ex_amt")) || 0;
  if (amt <= 0) { alert("Enter an amount."); return; }
  if (typeof submitGuard === "function" && !submitGuard("saveExpense:" + id)) return;   // rapid-tap dupe guard
  e.amount = amt; e.date = val("ex_date") || today(); e.category = val("ex_cat") || "other"; e.note = val("ex_note"); e.vendor = val("ex_vendor"); e.memberId = val("ex_member");
  // paidBy is the canonical "who fronted this → reimburse them" field the whole reimbursement pipeline reads
  // (rcptReimbOwed / the payout waterfall tier 1). The hand-add modal historically wrote only memberId, so those
  // expenses were never owed back — mirror it onto paidBy so a personal-card expense logged here reimburses correctly.
  e.paidBy = e.memberId || null;
  touch(e); if (isNew) d.expenses.push(e);
  if (typeof logChange === "function") logChange(isNew ? "create" : "update", "expense", e.id, (isNew ? "Logged " : "Updated ") + (e.category || "expense") + " " + money(amt));
  save(); closeModal(); render();
};
window.delExpense = function (id) { if (!confirm("Delete this expense?")) return; const e = D().expenses.find(x => x.id === id); if (e) { e.deleted = true; touch(e); if (typeof logChange === "function") logChange("delete", "expense", id, "Deleted expense " + money(e.amount || 0)); } save(); closeModal(); render(); };
