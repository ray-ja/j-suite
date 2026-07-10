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
  j.crewWeights = j.crewWeights || {};
  if (pct === 100) delete j.crewWeights[userId]; else j.crewWeights[userId] = pct;   // 100 = default → don't persist
  if (!Object.keys(j.crewWeights).length) delete j.crewWeights;
  if (typeof touch === "function") touch(j);
  if (typeof save === "function") save();
  if (S.sync && S.sync.url && S.sync.token && S.sync.auto && typeof syncNow === "function") syncNow();
  render();
};

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
  return (d.quotes || []).filter(q => q && !q.deleted && q.accepted).map(q => {
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
  (D().quotes || []).filter(q => q && !q.deleted && q.accepted).forEach(q => {
    const amt = finCents(q.finalPrice || q.total || 0);
    if (q.paid) collected += amt; else if (q.invoiced) ar += amt; else backlog += amt;
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
  const pool = popPool();

  // per-member rows: reimburse (out-of-pocket) + mileage (gas) = "pay back"; wages = distribution
  const ids = {};
  Object.keys(reimbD).forEach(id => { if (finCents(reimbD[id]) > 0) ids[id] = 1; });
  Object.keys(mil.perMember).forEach(id => { if (mil.perMember[id] > 0) ids[id] = 1; });
  Object.keys(pay).forEach(id => { if (pay[id].distribution > 0) ids[id] = 1; });
  const member = {};
  Object.keys(ids).forEach(id => {
    const reimb = finCents(reimbD[id] || 0), gas = mil.perMember[id] || 0, wage = (pay[id] && pay[id].distribution) || 0;
    member[id] = { reimb: reimb, gas: gas, back: reimb + gas, wage: wage, owed: reimb + gas + wage };
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

  /* TAX RESERVE RAID */
  if (taxRaid > 0.5) {
    h += `<div class="secthd"><h2>🏦 Tax reserve</h2></div><div class="card" style="border-left:4px solid var(--danger)">
      <div class="nm" style="white-space:normal">Cash can't make everyone whole — you're short <b style="color:var(--danger)">${fm(taxRaid)}</b> to fully pay reimbursements + wages.</div>
      <div class="sub" style="white-space:normal;margin-top:6px">Pull <b>${fm(taxRaid)}</b> from the Tax Reserve to pay people now. The reserve target this round is ${fm(m.tax)} (25%). <b>Pay it back</b> by routing the Business Fund's 15% share back into taxes on the next jobs until the reserve is whole again — you're front-loaded on tools and pricing low while new; that evens out.</div>
      <div class="sub" style="white-space:normal;margin-top:6px;color:var(--muted)">Tracking this borrow as a running balance is a one-tap add once you confirm the approach — see the morning notes.</div></div>`;
  } else {
    h += `<div class="secthd"><h2>🏦 Tax reserve</h2></div><div class="card"><div class="sub" style="white-space:normal">Cash covers reimbursements + wages — no need to touch the ${fm(m.tax)} tax reserve. 🎉</div></div>`;
  }

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

  /* TARGET CHARGE */
  const peopleAndBiz = m.peopleTotal + m.business + m.tax;
  const gapCash = Math.max(0, m.peopleTotal - avail);
  const coversPeople = m.pool.expected >= m.peopleTotal;
  h += `<div class="secthd"><h2>🎯 What to charge</h2></div><div class="card">
    <div class="li"><div class="grow"><div class="nm">People must receive</div><div class="sub">reimbursements + gas + wages</div></div><b>${fm(m.peopleTotal)}</b></div>
    <div class="li"><div class="grow"><div class="nm">Accepted work to date</div><div class="sub">${coversPeople ? "covers people if fully collected" : "does NOT cover people — you're underwater"}</div></div><b style="${coversPeople ? "" : "color:var(--danger)"}">${fm(m.pool.expected)}</b></div>
    <div class="li"><div class="grow"><div class="nm">Gap to fund people from cash</div><div class="sub">collect A/R + invoice backlog to close it</div></div><b style="${gapCash > 0.5 ? "color:var(--danger)" : "color:#1e9e5a"}">${fm(gapCash)}</b></div>
    <div class="sub" style="white-space:normal;margin-top:8px">To fund <b>everyone + the business + taxes</b> at the full 25/15/60 split you'd need to have invoiced <b>${fm(peopleAndBiz)}</b> total — you've booked ${fm(m.pool.expected)}. ${peopleAndBiz > m.pool.expected ? `That ${fm(peopleAndBiz - m.pool.expected)} gap is the margin you're giving up by pricing low — bake more into upcoming quotes.` : `You're priced to cover it. 👍`}</div></div>`;

  return h;
}
