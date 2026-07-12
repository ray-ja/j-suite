/* ---------- PAYOUT PLAN — the cash-flow priority waterfall (owner/admin) ----------
   The OTHER money view. The Payouts tab (js/40) shows the clean 25/15/60 accounting split for a month.
   THIS view answers the field question when cash is tight: "we can't pay for everything yet — who gets paid
   first, how much must we invoice, and do we have to dip into the tax reserve?"

   READ-ONLY over income / quotes / expenses / timeclock — no schema change, no writes. Fingerprint-safe.

   The waterfall order (Ray's call): (1) pay people BACK their out-of-pocket spend + gas, (2) pay WAGES for
   work done, (3) the BUSINESS takes its cut last. If collected cash can't cover people (tiers 1+2), it shows
   how much to pull from the Tax Reserve to make them whole, and the plan to pay that back over time.

   Obligations are all-time (every ACCEPTED job to date), because that's what's actually owed. Wages are the
   60% labor pool on all accepted revenue (finRollup); reimbursements are personal-card spend (rcptReimbOwed);
   mileage is the confirmed-miles gas reimbursement (finMileage). The pool is those same accepted quotes
   bucketed by how far along billing is: collected → A/R (invoiced, unpaid) → backlog (not yet invoiced). */

let POP_CASH = "collected";                          // collected | ar | backlog — which cash scenario the waterfall runs on
window.popCash = function (s) { POP_CASH = s; render(); };

/* set a crew member's SHARE weight on a job (0–100; 100 = full/equal). Stored on job.crewWeights, but a 100
   default is NOT stored (kept absent → the field split stays byte-identical for everyone at the default). A
   partial helper dialed below 100 earns proportionally less of that job's field pool. Owner/admin only. */
window.popSetWeight = function (jobId, userId, val) {
  if (!finCanView()) return;
  const j = (D().jobs || []).find(x => x && x.id === jobId); if (!j) return;
  let pct = parseInt(val, 10); if (isNaN(pct)) pct = 100; pct = Math.max(0, Math.min(100, pct));
  // guard the degenerate all-zero case: if this would leave EVERY crew member at 0, the field pool would fall
  // back to a full equal split (finSplitWeighted total=0 → equal) — the opposite of the intent. Keep ≥1 non-zero.
  if (pct === 0) {
    const w = j.crewWeights || {}, crew = (j.crew || []);
    const anotherNonZero = crew.some(id => id !== userId && ((w[id] == null || w[id] === "") ? 100 : (+w[id] || 0)) > 0);
    if (!anotherNonZero) { alert("At least one person needs a share above 0 — otherwise the job's field pay can't be split. If someone didn't work this job, remove them from the crew instead."); render(); return; }
  }
  j.crewWeights = j.crewWeights || {};
  if (pct === 100) delete j.crewWeights[userId]; else j.crewWeights[userId] = pct;   // 100 = default → don't persist
  if (!Object.keys(j.crewWeights).length) delete j.crewWeights;
  if (typeof touch === "function") touch(j);
  if (typeof save === "function") save();
  if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  render();
};

/* ---- TAX-RESERVE BORROW LEDGER (manual) — a running balance you drive yourself ----
   Rides the synced docs collection as a per-org sentinel (id "taxBorrow"), exactly like financeConfig — no new
   collection, no migration. entries: [{id,type:"borrow"|"repay",amount,date,note}]. Read paths NEVER create the
   doc (no empty-doc noise); only recording a borrow/repayment materializes it. */
function popTaxBorrowDoc() { return (D().docs || []).find(x => x && x.id === "taxBorrow") || null; }
function popBorrowEntries() { const c = popTaxBorrowDoc(); return (c && Array.isArray(c.entries)) ? c.entries.filter(x => x && !x.deleted) : []; }
function popBorrowSums() { let b = 0, r = 0; popBorrowEntries().forEach(x => { const c = finCents(x.amount); if (x.type === "repay") r += c; else b += c; }); return { borrowed: b, repaid: r, balance: Math.max(0, b - r) }; }
function popBorrowEnsureDoc() { const d = D(); d.docs = d.docs || []; let c = d.docs.find(x => x && x.id === "taxBorrow"); if (!c) { c = { id: "taxBorrow", entries: [], updatedAt: (typeof now === "function" ? now() : Date.now()) }; d.docs.push(c); } if (!Array.isArray(c.entries)) c.entries = []; return c; }
window.popBorrowOpen = function (kind, prefill) {
  if (!finCanView()) return;
  const repay = kind === "repay";
  modal(repay ? "Log a repayment to the tax reserve" : "Record a tax-reserve borrow", `
    <label>Amount ($)</label><input id="pb_amt" type="number" inputmode="decimal" value="${prefill != null ? esc(prefill) : ""}" placeholder="0.00">
    <label>Note <span class="sub">(optional)</span></label><input id="pb_note" placeholder="${repay ? "e.g. from June business fund" : "e.g. to pay Chaz + Vlad now"}">
    <div class="sub" style="white-space:normal;margin-top:8px">${repay ? "Money you routed BACK into the tax reserve (e.g. the business 15% share this period) — brings the reserve toward whole." : "Money you're pulling FROM the tax reserve to pay people now — tracked so you can pay it back over time."}</div>
    <button class="btn acc" style="margin-top:12px" onclick="popBorrowSave('${repay ? "repay" : "borrow"}')">Save</button>`);
};
window.popBorrowSave = function (kind) {
  if (!finCanView()) return;
  const amt = parseFloat(val("pb_amt")) || 0; if (amt <= 0) { alert("Enter an amount."); return; }
  if (typeof submitGuard === "function" && !submitGuard("popBorrow:" + kind)) return;
  const c = popBorrowEnsureDoc();
  c.entries.push({ id: uid(), type: kind === "repay" ? "repay" : "borrow", amount: amt, date: (typeof today === "function" ? today() : ""), note: val("pb_note") || "" });
  if (typeof touch === "function") touch(c);
  if (typeof logChange === "function") logChange("update", "docs", "taxBorrow", (kind === "repay" ? "Repaid " : "Borrowed ") + money(amt) + " tax reserve");
  save(); if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  if (typeof closeModal === "function") closeModal(); render();
};
window.popBorrowUndo = function (id) {
  if (!finCanView()) return;
  const c = popTaxBorrowDoc(); if (!c) return; const e = (c.entries || []).find(x => x && x.id === id); if (!e) return;
  if (!confirm("Remove this " + (e.type === "repay" ? "repayment" : "borrow") + " entry?")) return;
  e.deleted = true; if (typeof touch === "function") touch(c);
  save(); if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow(); render();
};
/* the tax-reserve card body — recommended raid + the manual borrow/repay ledger with a running balance */
function popTaxReserveHTML(m, taxRaid) {
  const s = popBorrowSums(), bal = s.balance;
  let h = `<div class="secthd"><h2>🏦 Tax reserve</h2>${bal > 0 ? `<span class="ct" style="color:var(--danger)">${fm(bal)} borrowed</span>` : ""}</div>`;
  if (taxRaid <= 0.5 && bal <= 0) {
    return h + `<div class="card"><div class="sub" style="white-space:normal">Cash covers reimbursements + wages — no need to touch the ${fm(m.tax)} tax reserve. 🎉</div></div>`;
  }
  h += `<div class="card" style="border-left:4px solid var(--danger)">`;
  if (taxRaid > 0.5) {
    h += `<div class="nm" style="white-space:normal">Cash can't make everyone whole — short <b style="color:var(--danger)">${fm(taxRaid)}</b> on reimbursements + wages.</div>
      <div class="sub" style="white-space:normal;margin-top:6px">Pull from the Tax Reserve to pay people now (reserve target this round is ${fm(m.tax)}), then pay it back by routing the Business Fund's 15% into taxes on the next jobs until it's whole.</div>
      <button class="btn sm" style="margin-top:8px;background:var(--danger);border-color:var(--danger);color:#fff" onclick="popBorrowOpen('borrow','${(taxRaid / 100).toFixed(2)}')">🏦 Record borrow ${fm(taxRaid)}</button>`;
  }
  if (bal > 0) {
    const pct = s.borrowed > 0 ? Math.min(100, Math.round(s.repaid / s.borrowed * 100)) : 0;
    h += `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">
      <div class="row" style="align-items:center"><div class="grow"><div class="nm">Owed back to tax reserve</div><div class="sub">${fm(s.repaid)} repaid of ${fm(s.borrowed)} borrowed</div></div><b style="color:var(--danger)">${fm(bal)}</b></div>
      <div style="height:7px;border-radius:4px;background:var(--soft);margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#1e9e5a"></div></div>
      <button class="btn ghost sm" style="margin-top:8px" onclick="popBorrowOpen('repay','')">✓ Log a repayment</button>`;
    const ents = popBorrowEntries().slice().sort((a, b) => (a.date + a.id) < (b.date + b.id) ? 1 : -1);
    h += ents.map(e => `<div class="li" style="padding:6px 0"><div class="grow"><div class="nm" style="font-size:14px">${e.type === "repay" ? "↩ Repaid" : "🏦 Borrowed"} ${fm(finCents(e.amount))}</div><div class="sub" style="white-space:normal">${fmtDate(e.date)}${e.note ? " · " + esc(e.note) : ""}</div></div><button class="btn ghost sm" style="flex:0 0 auto;opacity:.6" onclick="popBorrowUndo('${esc(e.id)}')" title="Remove">✕</button></div>`).join("");
  }
  h += `</div>`;
  return h;
}

/* the "⚖️ Crew shares" editor — every accepted job with 2+ crew, a slider per member (100 = full share).
   Dial a partial helper down (e.g. 60) and that job's field pool splits proportionally. */
function popCrewSharesHTML() {
  const jobs = D().jobs || [];
  const rows = popAcceptedIncome().filter(inc => (inc.crew || []).length >= 2);
  if (!rows.length) return "";
  let h = `<details style="margin-top:2px"><summary style="cursor:pointer;font-weight:700;padding:6px 4px">⚖️ Crew shares <span class="sub" style="font-weight:400">· dial a partial helper's share of a job down from 100%</span></summary>`;
  h += rows.map(inc => {
    const j = jobs.find(x => x && x.id === inc.jobId), title = (j && j.title) || "Job";
    const w = inc.weights || {};
    const sliders = inc.crew.map(id => {
      const pct = (w[id] == null || w[id] === "") ? 100 : Math.max(0, Math.min(100, +w[id] || 0));
      const sid = "w_" + inc.jobId + "_" + id;
      return `<div class="row" style="align-items:center;gap:8px;margin-top:6px">
        <div class="grow" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(finName(id))}</div>
        <input type="range" min="0" max="100" step="5" value="${pct}" style="flex:0 0 130px" oninput="var e=document.getElementById('${sid}');if(e)e.textContent=this.value+'%'" onchange="popSetWeight('${esc(inc.jobId)}','${esc(id)}',this.value)">
        <b id="${sid}" style="flex:0 0 42px;text-align:right">${pct}%</b></div>`;
    }).join("");
    return `<div class="card" style="margin-top:8px;padding:10px"><div class="nm" style="white-space:normal">${esc(title)}</div>${sliders}</div>`;
  }).join("");
  h += `<div class="sub" style="white-space:normal;margin-top:6px">100% = a full, equal share. Everyone at 100% splits equally (unchanged). Lower a helper who only worked part of the job — the pool re-splits proportionally.</div></details>`;
  return h;
}

/* synthesize income-shaped records from every ACCEPTED quote (paid OR not) so wages reflect all work DONE,
   not just work already collected. Same field shape finRollup/finJobSplit read. */
function popAcceptedIncome() {
  const d = D();
  const jobById = {}; (d.jobs || []).forEach(j => { if (j) jobById[j.id] = j; });
  const custById = {}; (d.customers || []).forEach(c => { if (c) custById[c.id] = c; });
  return (d.quotes || []).filter(q => q && !q.deleted && q.accepted && !q.reconciledDuplicate).map(q => {
    const job = q.jobId ? jobById[q.jobId] : null;
    const cust = q.customerId ? custById[q.customerId] : null;
    return {
      id: "acc_" + q.id, jobId: q.jobId || "", deleted: false,
      amount: (q.finalPrice || q.total || 0),
      date: (job && job.date) || q.acceptedDate || q.date || "",
      crew: (job && Array.isArray(job.crew)) ? job.crew.slice() : [],
      weights: (job && job.crewWeights) || null,
      originator: (cust && cust.soldBy) || "",
      bookedAt: q.acceptedDate || q.date || "", houseAccount: false
    };
  });
}

/* the pool — accepted quotes bucketed by billing state (all cents) */
function popPool() {
  let collected = 0, ar = 0, backlog = 0;
  (D().quotes || []).filter(q => q && !q.deleted && q.accepted && !q.reconciledDuplicate).forEach(q => {
    const amt = finCents(q.finalPrice || q.total || 0);
    // count ACTUAL payments/deposits received (partial too), not just the fully-paid flag
    const paid = (typeof quotePaidAmt === "function") ? Math.min(finCents(quotePaidAmt(q)), amt) : (q.paid ? amt : 0);
    collected += paid;
    const rest = amt - paid;
    if (rest > 0) { if (q.invoiced) ar += rest; else backlog += rest; }   // the still-uncollected remainder
  });
  return { collected: collected, ar: ar, backlog: backlog, expected: collected + ar + backlog };
}

/* the full obligation + waterfall model (all cents) */
function popModel() {
  const adminId = finAdminMember();
  const reimbD = (typeof rcptReimbOwed === "function") ? rcptReimbOwed() : {};   // dollars, per member
  const mil = finMileage(D().timeclock || [], { confirmedOnly: true });          // gas reimbursement, per member cents
  const roll = finRollup(popAcceptedIncome(), { adminMemberId: adminId });
  const pay = finPayouts(roll, { perMember: {} }, { perMember: {} });            // distribution only (mileage handled separately)
  const paidByMember = (typeof payPaidByMember === "function") ? payPaidByMember() : {};   // payouts already disbursed (cents)
  const faultD = (typeof finFaultDeductions === "function") ? finFaultDeductions(D().jobs || []) : { perMember: {} };
  const pool = popPool();

  // per-member rows: reimburse (out-of-pocket) + mileage (gas) = "pay back"; wages = distribution EARNED, minus
  // the member's own fault deductions and any payout already disbursed to them (floored at 0), so the plan stops
  // recommending money you've already paid.
  const ids = {};
  Object.keys(reimbD).forEach(id => { if (finCents(reimbD[id]) > 0) ids[id] = 1; });
  Object.keys(mil.perMember).forEach(id => { if (mil.perMember[id] > 0) ids[id] = 1; });
  Object.keys(pay).forEach(id => { if (pay[id].distribution > 0) ids[id] = 1; });
  const member = {};
  Object.keys(ids).forEach(id => {
    const reimb = finCents(reimbD[id] || 0), gas = mil.perMember[id] || 0;
    const wageEarned = (pay[id] && pay[id].distribution) || 0;
    const wage = Math.max(0, wageEarned - ((faultD.perMember && faultD.perMember[id]) || 0) - (paidByMember[id] || 0));
    member[id] = { reimb: reimb, gas: gas, back: reimb + gas, wage: wage, wageEarned: wageEarned, paid: (paidByMember[id] || 0), owed: reimb + gas + wage };
  });
  const reimbTotal = Object.keys(member).reduce((s, id) => s + member[id].reimb, 0);
  const gasTotal = Object.keys(member).reduce((s, id) => s + member[id].gas, 0);
  const backTotal = reimbTotal + gasTotal;                 // tier 1: pay people back
  const wageTotal = Object.keys(member).reduce((s, id) => s + member[id].wage, 0);   // tier 2: wages
  const business = roll.totals.business;                    // tier 3: business fund (15% of accepted revenue)
  const tax = roll.totals.tax;                              // tax reserve target (25%)
  return {
    adminId, member, mil, roll, pool,
    reimbTotal, gasTotal, backTotal, wageTotal, business, tax,
    peopleTotal: backTotal + wageTotal
  };
}

/* pro-rata split of `pot` across a {id:weight} map, capped at each weight (cents, deterministic) */
function popProRata(pot, weights) {
  const ids = Object.keys(weights).filter(id => weights[id] > 0);
  const total = ids.reduce((s, id) => s + weights[id], 0);
  const out = {};
  if (!(total > 0) || pot <= 0) { ids.forEach(id => out[id] = 0); return out; }
  if (pot >= total) { ids.forEach(id => out[id] = weights[id]); return out; }
  let assigned = 0; const frac = [];
  ids.forEach(id => { const exact = pot * (weights[id] / total); const base = Math.floor(exact); out[id] = base; assigned += base; frac.push({ id, f: exact - base }); });
  let rem = pot - assigned; frac.sort((a, b) => (b.f - a.f) || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < rem; i++) out[frac[i % frac.length].id] += 1;
  return out;
}

function rFinPriority() {
  if (!finCanView()) { return `<div class="card"><div class="nm">Owner / Admin only</div></div>`; }
  const m = popModel();
  const avail = POP_CASH === "backlog" ? m.pool.expected : POP_CASH === "ar" ? (m.pool.collected + m.pool.ar) : m.pool.collected;
  const availLabel = POP_CASH === "backlog" ? "everything invoiced &amp; collected" : POP_CASH === "ar" ? "collected + outstanding A/R" : "collected so far";

  // waterfall: pay-back first, then wages, business last
  const backWeights = {}; Object.keys(m.member).forEach(id => backWeights[id] = m.member[id].back);
  const wageWeights = {}; Object.keys(m.member).forEach(id => wageWeights[id] = m.member[id].wage);
  const payBack = popProRata(Math.min(avail, m.backTotal), backWeights);
  const afterBack = Math.max(0, avail - m.backTotal);
  const payWage = popProRata(Math.min(afterBack, m.wageTotal), wageWeights);
  const afterWage = Math.max(0, afterBack - m.wageTotal);
  const toBusiness = Math.min(afterWage, m.business);
  const backShort = m.backTotal - Object.keys(payBack).reduce((s, id) => s + payBack[id], 0);
  const wageShort = m.wageTotal - Object.keys(payWage).reduce((s, id) => s + payWage[id], 0);
  const taxRaid = Math.max(0, m.peopleTotal - avail);      // to make ALL people whole (tiers 1+2)

  const tierRow = (icon, name, sub, total, paid, danger) => {
    const short = total - paid, pct = total > 0 ? Math.round(paid / total * 100) : 100;
    return `<div class="li" style="align-items:flex-start"><div class="grow"><div class="nm">${icon} ${name}</div><div class="sub" style="white-space:normal">${sub}</div>
      <div style="height:7px;border-radius:4px;background:var(--soft);margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${short > 0 ? "var(--danger)" : "#1e9e5a"}"></div></div></div>
      <div style="text-align:right;flex:0 0 auto;margin-left:10px"><b>${fm(paid)}</b><div class="sub" style="font-size:11px">of ${fm(total)}${short > 0.5 ? `<br><span style="color:var(--danger)">short ${fm(short)}</span>` : `<br><span style="color:#1e9e5a">covered</span>`}</div></div></div>`;
  };

  let h = `<div class="card" style="border-left:4px solid var(--brand)">
    <div class="nm" style="font-size:16px">🪜 Payout plan — who gets paid first</div>
    <div class="sub" style="white-space:normal;margin-top:4px">When cash is tight, this pays people <b>back their out-of-pocket money first</b>, then <b>wages</b>, then the <b>business</b> takes its cut. All accepted work to date.</div></div>`;

  /* THE POOL */
  h += `<div class="secthd"><h2>💰 The pool</h2><span class="ct">${fm(m.pool.expected)}</span></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">✅ Collected</div><div class="sub">cash in hand (paid quotes)</div></div><b>${fm(m.pool.collected)}</b></div>
    <div class="li"><div class="grow"><div class="nm">📤 A/R — invoiced, unpaid</div><div class="sub">sent, waiting on payment</div></div><b>${fm(m.pool.ar)}</b></div>
    <div class="li"><div class="grow"><div class="nm">🧾 Backlog — not yet invoiced</div><div class="sub" style="white-space:normal;color:var(--accent)">accepted work you still need to bill — invoice this to fund the rest</div></div><b>${fm(m.pool.backlog)}</b></div></div>`;

  /* THE WATERFALL */
  h += `<div class="secthd"><h2>🚰 Waterfall</h2></div>
    <div class="card"><div class="sub" style="white-space:normal;margin-bottom:8px">Run the plan against: </div>
    <div class="subnav" style="margin:0 0 10px">
      <button class="subbtn ${POP_CASH === "collected" ? "on" : ""}" onclick="popCash('collected')">Collected ${fm(m.pool.collected)}</button>
      <button class="subbtn ${POP_CASH === "ar" ? "on" : ""}" onclick="popCash('ar')">+ A/R ${fm(m.pool.collected + m.pool.ar)}</button>
      <button class="subbtn ${POP_CASH === "backlog" ? "on" : ""}" onclick="popCash('backlog')">+ Backlog ${fm(m.pool.expected)}</button></div>
    <div class="sub" style="white-space:normal;margin-bottom:8px">Working with <b>${fm(avail)}</b> (${availLabel}):</div>`;
  h += tierRow("1️⃣", "Pay people back", `Out-of-pocket ${fm(m.reimbTotal)}${m.gasTotal ? ` + gas ${fm(m.gasTotal)}` : ""} — reimburse first`, m.backTotal, m.backTotal - backShort);
  h += tierRow("2️⃣", "Wages for work done", `The 60% labor pool on ${fm(m.roll.totals.amount)} of accepted work`, m.wageTotal, m.wageTotal - wageShort);
  h += tierRow("3️⃣", "Business fund", `15% of revenue — overhead / growth (last in line)`, m.business, toBusiness);
  h += `</div>`;

  /* TAX RESERVE — recommended raid + the manual borrow/repay ledger (running balance) */
  h += popTaxReserveHTML(m, taxRaid);

  /* PER-PERSON */
  h += `<div class="secthd"><h2>👤 Per person</h2><span class="ct">${fm(m.peopleTotal)} owed</span></div><div class="card">`;
  const pids = Object.keys(m.member).sort((a, b) => finName(a).localeCompare(finName(b)));
  h += pids.map(id => {
    const r = m.member[id], gotBack = payBack[id] || 0, gotWage = payWage[id] || 0, got = gotBack + gotWage, stillOwed = r.owed - got;
    return `<div class="li" style="align-items:flex-start"><div class="grow"><div class="nm">${esc(finName(id))}</div>
      <div class="sub" style="white-space:normal">Back ${fm(r.back)}${r.gas ? ` <span style="color:var(--muted)">(incl ${fm(r.gas)} gas)</span>` : ""} · Wages ${fm(r.wage)}</div></div>
      <div style="text-align:right;flex:0 0 auto;margin-left:10px"><b>${fm(got)}</b><div class="sub" style="font-size:11px">paid now${stillOwed > 0.5 ? `<br><span style="color:var(--danger)">${fm(stillOwed)} still owed</span>` : `<br><span style="color:#1e9e5a">fully paid</span>`}</div></div></div>`;
  }).join("") + `</div>`;

  /* CREW SHARES — dial a partial helper's share of a job down from the 100% default (feeds Wages above) */
  h += popCrewSharesHTML();

  /* WHAT TO CHARGE — revenue vs the obligation. Wages are self-funding (60% of whatever you invoice), so the
     binding constraint is the OUT-OF-POCKET expenses: they're a fixed cash obligation the 15% business fund is
     supposed to cover. When expenses run above 15% of revenue, the business can't reimburse everyone — the fix is
     pricing/spend, not more of the same low-margin work. (No double-count: reimbursements come FROM the 15%.) */
  const gapPeople = Math.max(0, m.peopleTotal - m.pool.expected);              // revenue short to cover people at all
  const expRatio = m.pool.expected > 0 ? Math.round(m.backTotal / m.pool.expected * 1000) / 10 : 0;   // out-of-pocket as % of revenue
  h += `<div class="secthd"><h2>🎯 What to charge</h2></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">People must receive</div><div class="sub" style="white-space:normal">reimbursements ${fm(m.reimbTotal)}${m.gasTotal ? " + gas " + fm(m.gasTotal) : ""} + wages ${fm(m.wageTotal)}</div></div><b>${fm(m.peopleTotal)}</b></div>
    <div class="li"><div class="grow"><div class="nm">Accepted work to date</div><div class="sub">${gapPeople > 0.5 ? "doesn't cover people yet" : "covers people if fully collected"}</div></div><b style="${gapPeople > 0.5 ? "color:var(--danger)" : "color:#1e9e5a"}">${fm(m.pool.expected)}</b></div>
    ${gapPeople > 0.5 ? `<div class="li"><div class="grow"><div class="nm">Short to cover people</div><div class="sub">before the business or taxes get a cent</div></div><b style="color:var(--danger)">${fm(gapPeople)}</b></div>` : ""}
    <div class="sub" style="white-space:normal;margin-top:8px">Your out-of-pocket expenses are <b>${fm(m.backTotal)} = ${expRatio}% of revenue</b>, but the operating split budgets just <b>15%</b> to the business fund that covers them. ${expRatio > 15 ? `That's why the business can't reimburse everyone yet — <b>price higher or spend less on tools</b> on upcoming jobs to bring it toward 15%.` : `You're inside the 15% budget. 👍`}</div></div>`;

  return h;
}
