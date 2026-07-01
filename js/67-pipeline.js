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
  const G = { quote: [], job: [], bill: [], pay: [], review: [] };
  quotes.forEach(q => {
    const j = jobById(q.jobId);
    if (q.jobId && !j && !q.paid && !q.invoiced) return;   // its job was deleted → the funnel entry is dead; drop it (handles pre-cascade orphans too)
    if (q.paid) { if (!plReviewed(q, _jobAll)) G.review.push(q); }
    else if (q.invoiced) G.pay.push(q);
    else if (q.accepted || q.jobId) { if (j && j.done) G.bill.push(q); else G.job.push(q); }
    else G.quote.push(q);
  });
  const who = q => esc(q.cust || (q.customerId && typeof custName === "function" ? custName(q.customerId) : "") || "—");
  const amt = q => money(q.finalPrice || q.total || 0);
  const numP = q => (typeof quoteNum === "function" && quoteNum(q)) ? quoteNum(q) + " · " : "";
  const tyAgo = q => { const ty = (typeof quoteType === "function" && quoteType(q)) || ""; const ago = q.date ? ((typeof agoStr === "function" ? agoStr(q.date) : "") || fmtDate(q.date)) : ""; return [ty, ago].filter(Boolean).join(" · "); };

  let h = "";

  const sect = (icon, title, n, body, lead) => { h += `<div class="secthd"><h2>${icon} ${title}</h2><span class="ct">${n}</span></div>`; if (lead) h += lead; h += n ? `<div class="card">${body}</div>` : `<div class="empty" style="padding:14px;font-size:14px">Nothing here right now.</div>`; };

  sect("🎯", "Sales — leads", leads.length,
    leads.map(c => `<div class="li" onclick="openCustomer('${c.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${esc(c.name || c.company || "Lead")}</div><div class="sub">${c.phone ? esc(c.phone) + " · " : ""}${c.next ? "follow up " + fmtDate(c.next) : "new lead"}</div></div><button class="btn acc sm" onclick="event.stopPropagation();plQuoteLead('${c.id}')">Quote →</button></div>`).join(""),
    `<button class="btn acc" style="width:100%;margin-bottom:8px;padding:13px;font-size:16px" onclick="openGuidedCall()">📞 New call / lead</button>`);

  sect("📝", "Quote — sent, awaiting yes", G.quote.length,
    G.quote.map(q => `<div class="li" onclick="openQuote('${q.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">${esc(tyAgo(q))}</div></div><button class="btn acc sm" onclick="event.stopPropagation();openQuote('${q.id}')">Open →</button></div>`).join(""),
    `<button class="btn acc" style="width:100%;margin-bottom:8px;padding:13px;font-size:16px" onclick="startWizard()">➕ New quote / job</button>`);

  sect("🔧", "Job — accepted, to do", G.job.length,
    G.job.map(q => { const j = jobById(q.jobId); const go = j ? `openJobPage('${j.id}')` : `openQuote('${q.id}')`; return `<div class="li" onclick="${go}" style="cursor:pointer"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">${esc(tyAgo(q))}${j && !j.date ? " · not scheduled" : ""}${!j ? " · no job linked" : ""}</div></div><button class="btn acc sm" onclick="event.stopPropagation();${go}">Open →</button></div>`; }).join(""));

  sect("📤", "Invoice — work done, bill it", G.bill.length,
    G.bill.map(q => `<div class="li"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${amt(q)}</div><div class="sub">${esc(tyAgo(q))} · job done</div></div><button class="btn acc sm" onclick="openInvoice('${q.id}')">Bill →</button></div>`).join(""));

  sect("💸", "Paid — collect it", G.pay.length,
    G.pay.map(q => { const bal = (typeof quoteBalAmt === "function") ? quoteBalAmt(q) : (q.finalPrice || q.total || 0); return `<div class="li"><div class="grow"><div class="nm">${numP(q)}${who(q)} · ${money(bal)} owed</div><div class="sub">${esc(tyAgo(q))} · invoiced${q.invoicedDate ? " " + fmtDate(q.invoicedDate) : ""}</div></div><button class="btn acc sm" onclick="recordPayment('${q.id}')">Payment →</button></div>`; }).join(""));

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
