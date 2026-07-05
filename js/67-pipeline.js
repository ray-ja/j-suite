/* ---------- PIPELINE (Jobs) — the whole job lifecycle as ONE linear flow ----------
   Sales → Quote → Job → Invoice → Paid → Review. Every deal rides existing data (customer status,
   quote accepted/invoiced/paid, job done) — each stage shows what's there + the one button to advance
   it. The final REQUIRED stage is the Review (after-action): it appends to the job notes that Cap learns
   from, and flips a reviewed flag. Owner/admin view. */
function plReviewed(q, jobMap) { const j = q.jobId ? (jobMap ? (jobMap.get(q.jobId) || null) : (D().jobs || []).find(x => x.id === q.jobId)) : null; return !!(q.reviewed || (j && j.reviewed)); }

function rPipeline() {
  const quotes = (typeof actQ === "function") ? actQ().filter(q => (q.total || q.finalPrice)) : [];
  const leads = (typeof actC === "function") ? actC().filter(c => c.status === "Lead") : [];
  // index EVERY job by id ONCE (incl. deleted, matching the old .find scans) — the per-quote lookups below
  // become O(1) instead of a full jobs scan per quote (was O(quotes × jobs)). Behavior preserved: jobById
  // still returns null for a deleted job; plReviewed still sees a deleted-but-reviewed job (via _jobAll).
  const _jobAll = new Map();
  (D().jobs || []).forEach(j => { if (j && j.id != null) _jobAll.set(j.id, j); });
  const jobById = id => { if (!id) return null; const j = _jobAll.get(id); return (j && !j.deleted) ? j : null; };
  // DERIVED grouping via workStage (js/60) — Ray's six-stage lifecycle. The old single "billing" bucket is
  // now SPLIT into expense-collecting (job done, receipts not fully closed) vs invoice (fully closed OR
  // invoiced). Review stays a trailing after-action (paid & not-yet-reviewed), not a lifecycle stage.
  const G = { quote: [], job: [], expense: [], invoice: [], paid: [], review: [] };
  quotes.forEach(q => {
    const j = jobById(q.jobId);
    if (q.jobId && !j && !q.paid && !q.invoiced) return;   // its job was deleted → the funnel entry is dead; drop it (handles pre-cascade orphans too)
    const st = (typeof workStage === "function") ? workStage(q)
      : (q.paid ? "paid" : q.invoiced ? "invoice" : (q.accepted || q.jobId) ? (j && j.done ? "invoice" : "job") : "quote");
    if (st === "paid") { G.paid.push(q); if (!plReviewed(q, _jobAll)) G.review.push(q); }
    else if (st === "invoice") G.invoice.push(q);
    else if (st === "expense") G.expense.push(q);
    else if (st === "job") G.job.push(q);
    else G.quote.push(q);
  });
  const who = q => esc(q.cust || (q.customerId && typeof custName === "function" ? custName(q.customerId) : "") || "—");
  const amt = q => money(q.finalPrice || q.total || 0);
  const numP = q => (typeof quoteNum === "function" && quoteNum(q)) ? quoteNum(q) + " · " : "";
  const tyAgo = q => { const ty = (typeof quoteType === "function" && quoteType(q)) || ""; const ago = q.date ? ((typeof agoStr === "function" ? agoStr(q.date) : "") || fmtDate(q.date)) : ""; return [ty, ago].filter(Boolean).join(" · "); };

  let h = "";

  const sect = (icon, title, n, body, lead) => { h += `<div class="secthd"><h2>${icon} ${title}</h2><span class="ct">${n}</span></div>`; if (lead) h += lead; h += n ? `<div class="card">${body}</div>` : `<div class="empty" style="padding:14px;font-size:14px">Nothing here right now.</div>`; };

  // resolve the job behind a quote for the close-out helpers (workStageJob mirrors this; jobById here is the
  // already-built O(1) index, so reuse it and fall back to the quote→job scan only when q.jobId is unset).
  const jobOf = q => jobById(q.jobId) || ((typeof workStageJob === "function") ? workStageJob(q) : null);

  sect("🎯", "Lead", leads.length,
    leads.map(c => `<div class="li" onclick="openCustomer('${c.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${esc(c.name || c.company || "Lead")}</div><div class="sub">${c.phone ? esc(c.phone) + " · " : ""}${c.next ? "follow up " + fmtDate(c.next) : "new lead"}</div></div><button class="btn acc sm" onclick="event.stopPropagation();plQuoteLead('${c.id}')">Quote →</button></div>`).join(""),
    `<button class="btn acc" style="width:100%;margin-bottom:8px;padding:13px;font-size:16px" onclick="openGuidedCall()">📞 New call / lead</button>`);

  sect("📝", "Quote", G.quote.length,
    G.quote.map(q => `<div class="li" onclick="openQuote('${q.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">${esc(tyAgo(q))} · sent, awaiting yes</div></div><button class="btn acc sm" onclick="event.stopPropagation();openQuote('${q.id}')">Open →</button></div>`).join(""),
    `<button class="btn acc" style="width:100%;margin-bottom:8px;padding:13px;font-size:16px" onclick="startWizard()">➕ New quote / job</button>`);

  sect("🔧", "Job", G.job.length,
    G.job.map(q => { const j = jobOf(q); const go = j ? `openJobPage('${j.id}')` : `openQuote('${q.id}')`; return `<div class="li" onclick="${go}" style="cursor:pointer"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">accepted, to do${j && !j.date ? " · not scheduled" : ""}${!j ? " · no job linked" : ""} · ${esc(tyAgo(q))}</div></div><button class="btn acc sm" onclick="event.stopPropagation();${go}">Open →</button></div>`; }).join(""));

  // Expense collecting — job done, receipts NOT fully closed. Shows live N/M crew closed + who we're waiting
  // on, a "Receipts →" jump to the job's close-out, and a "Bill anyway →" escape hatch (invoicing never blocks).
  sect("🧾", "Expense collecting", G.expense.length,
    G.expense.map(q => {
      const j = jobOf(q);
      const crew = (j && typeof jobCrewActiveIds === "function") ? jobCrewActiveIds(j).length : 0;
      const open = (j && typeof jobReceiptsOpenCrew === "function") ? jobReceiptsOpenCrew(j) : [];
      const closedN = crew - open.length;
      const waiting = open.map(id => (typeof userName === "function" ? userName(id) : "") || "").filter(Boolean).join(", ");
      const recBtn = j ? `<button class="btn ghost sm" onclick="event.stopPropagation();openJobPage('${j.id}')">Receipts →</button>` : "";
      return `<div class="li" style="align-items:center"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub" style="white-space:normal">${crew ? closedN + "/" + crew + " crew closed" : "no crew to close out"}${waiting ? ` · waiting on ${esc(waiting)}` : ""} · ${esc(tyAgo(q))}</div></div><div class="row" style="gap:6px;flex:0 0 auto">${recBtn}<button class="btn acc sm" onclick="openInvoice('${q.id}')">Bill anyway →</button></div></div>`;
    }).join(""));

  // Invoice — ready to bill (job done + receipts closed, or crewless) AND already-invoiced-awaiting-payment.
  // Per-row action: not yet invoiced → "Bill →"; invoiced → "Payment →" with the outstanding balance.
  sect("📤", "Invoice", G.invoice.length,
    G.invoice.map(q => {
      const bal = (typeof quoteBalAmt === "function") ? quoteBalAmt(q) : (q.finalPrice || q.total || 0);
      if (q.invoiced) return `<div class="li" style="align-items:center"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${money(bal)} owed</div><div class="sub">invoiced${q.invoicedDate ? " " + fmtDate(q.invoicedDate) : ""} · ${esc(tyAgo(q))}</div></div><button class="btn acc sm" onclick="recordPayment('${q.id}')">Payment →</button></div>`;
      return `<div class="li" style="align-items:center"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">work done, receipts closed — ready to bill · ${esc(tyAgo(q))}</div></div><button class="btn acc sm" onclick="openInvoice('${q.id}')">Bill →</button></div>`;
    }).join(""));

  // Paid — money collected. Display-capped to the most recent (terminal stage; older paid deals live in
  // Money → A/R), so the active funnel stays scannable. Unreviewed ones still get a Review nudge here.
  const PAID_CAP = 15;
  const paidSorted = G.paid.slice().sort((a, b) => String(b.paidDate || b.date || "").localeCompare(String(a.paidDate || a.date || "")));
  const paidShown = paidSorted.slice(0, PAID_CAP);
  sect("💸", "Paid", G.paid.length,
    paidShown.map(q => `<div class="li" style="align-items:center"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">paid${q.paidDate ? " " + fmtDate(q.paidDate) : ""} · ${esc(tyAgo(q))}</div></div>${plReviewed(q, _jobAll) ? `<span class="badge s-Won">✓ reviewed</span>` : `<button class="btn acc sm" onclick="plReview('${q.id}')">Review →</button>`}</div>`).join("")
      + (paidSorted.length > PAID_CAP ? `<div class="sub" style="text-align:center;margin-top:6px">+${paidSorted.length - PAID_CAP} more paid — see Money → A/R</div>` : ""));

  sect("⭐", "Review — the after-action (required)", G.review.length,
    G.review.map(q => `<div class="li"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">${esc(tyAgo(q))} · paid — review so Cap learns</div></div><button class="btn acc sm" onclick="plReview('${q.id}')">Review →</button></div>`).join(""));

  view.innerHTML = h;
}

window.plQuoteLead = function (custId) {
  const c = (D().customers || []).find(x => x.id === custId); if (!c) return;
  if (typeof WZON === "undefined") { alert("Quote builder unavailable."); return; }
  const prop = (typeof propsForCust === "function") ? (propsForCust(c.id)[0] || null) : null;
  const me = (typeof curUser === "function") ? curUser() : null;
  WZ = { step: "pick", cust: { id: c.id, name: c.name || c.company || "", phone: c.phone || "", address: prop ? prop.address : "", propertyId: prop ? prop.id : "", source: c.source || "", soldBy: c.soldBy || (me ? me.id : ""), notes: "" }, items: [], recurring: false, disc: 0, discPct: null, miles: 0, hours: 0, crewN: 1, disposalTrip: false, haul: "pickup", zone: "local", travelMiles: null, svc: null, inp: {}, deep: {}, deepMods: {}, deepSearch: "", id: null, invoiced: false, paid: false, paymentLink: "", finalPrice: 0, adjNote: "" };
  WZON = true; TAB = "quotes"; render();
};
window.plReview = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  modal("⭐ Job review — " + esc(q.cust || ""), `
    <div class="sub" style="white-space:normal;margin-bottom:10px">The last step — and it's required. Keep it short and honest; Cap reads this to quote &amp; run the next one better.</div>
    <label style="margin-top:0">What went well?</label><textarea id="rv_good" placeholder="…"></textarea>
    <label>What would we do differently next time?</label><textarea id="rv_diff" placeholder="access, time, crew size, the dump run, pricing, gotchas…"></textarea>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="plSaveReview('${quoteId}')">Save review — mark done ✓</button>`);
};
window.plSaveReview = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  const good = val("rv_good"), diff = val("rv_diff");
  if (!(good || diff)) { if (!confirm("Empty review — mark done anyway?")) return; }
  const text = "⭐ REVIEW — " + [good ? "Went well: " + good : "", diff ? "Do differently: " + diff : ""].filter(Boolean).join(" · ");
  const j = q.jobId ? (D().jobs || []).find(x => x.id === q.jobId) : null;
  if (j) { j.notes = (j.notes ? j.notes + "\n\n" : "") + text; j.reviewed = true; if (typeof touch === "function") touch(j); }
  q.reviewed = true; if (typeof touch === "function") touch(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Job review done · " + (q.cust || ""));
  save(); if (typeof closeModal === "function") closeModal(); if (typeof render === "function") render();
};
