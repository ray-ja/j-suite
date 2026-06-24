/* ---------- PIPELINE (Jobs) — the whole job lifecycle as ONE linear flow ----------
   Sales → Quote → Job → Invoice → Paid → Review. Every deal rides existing data (customer status,
   quote accepted/invoiced/paid, job done) — each stage shows what's there + the one button to advance
   it. The final REQUIRED stage is the Review (after-action): it appends to the job notes that Cap learns
   from, and flips a reviewed flag. Owner/admin view. */
function plReviewed(q) { const j = q.jobId ? (D().jobs || []).find(x => x.id === q.jobId) : null; return !!(q.reviewed || (j && j.reviewed)); }

function rPipeline() {
  const quotes = (typeof actQ === "function") ? actQ().filter(q => (q.total || q.finalPrice)) : [];
  const leads = (typeof actC === "function") ? actC().filter(c => c.status === "Lead") : [];
  const jobById = id => id ? (D().jobs || []).find(j => j.id === id) : null;
  const G = { quote: [], job: [], bill: [], pay: [], review: [] };
  quotes.forEach(q => {
    const j = jobById(q.jobId);
    if (q.paid) { if (!plReviewed(q)) G.review.push(q); }
    else if (q.invoiced) G.pay.push(q);
    else if (q.accepted || q.jobId) { if (j && j.done) G.bill.push(q); else G.job.push(q); }
    else G.quote.push(q);
  });
  const who = q => esc(q.cust || (q.customerId && typeof custName === "function" ? custName(q.customerId) : "") || "—");
  const amt = q => money(q.finalPrice || q.total || 0);

  // the flow, drawn linear at the top
  const flow = [["🎯", "Sales", leads.length], ["📝", "Quote", G.quote.length], ["🔧", "Job", G.job.length], ["📤", "Invoice", G.bill.length], ["💸", "Paid", G.pay.length], ["⭐", "Review", G.review.length]];
  let h = `<div class="card" style="overflow-x:auto"><div class="row" style="gap:2px;white-space:nowrap;align-items:center;font-size:12px">` +
    flow.map((s, i) => `${i ? `<span style="color:var(--muted)">→</span>` : ""}<span style="font-weight:700;padding:2px 4px">${s[0]} ${s[1]}${s[2] ? ` <span class="badge" style="background:var(--accent);color:var(--accent-ink)">${s[2]}</span>` : ""}</span>`).join("") + `</div></div>`;

  const sect = (icon, title, n, body, lead) => { h += `<div class="secthd"><h2>${icon} ${title}</h2><span class="ct">${n}</span></div>`; if (lead) h += lead; h += n ? `<div class="card">${body}</div>` : `<div class="empty" style="padding:14px;font-size:14px">Nothing here right now.</div>`; };

  sect("🎯", "Sales — leads", leads.length,
    leads.map(c => `<div class="li" onclick="openCustomer('${c.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${esc(c.name || c.company || "Lead")}</div><div class="sub">${c.phone ? esc(c.phone) + " · " : ""}${c.next ? "follow up " + fmtDate(c.next) : "new lead"}</div></div><button class="btn acc sm" onclick="event.stopPropagation();plQuoteLead('${c.id}')">Quote →</button></div>`).join(""),
    `<button class="btn acc" style="width:100%;margin-bottom:8px;padding:13px;font-size:16px" onclick="openGuidedCall()">📞 New call / lead</button>`);

  sect("📝", "Quote — sent, awaiting yes", G.quote.length,
    G.quote.map(q => `<div class="li" onclick="openQuote('${q.id}')" style="cursor:pointer"><div class="grow"><div class="nm">${who(q)} · ${amt(q)}</div><div class="sub">${typeof quoteType === "function" ? esc(quoteType(q)) : ""}${q.date ? " · " + fmtDate(q.date) : ""}</div></div><button class="btn acc sm" onclick="event.stopPropagation();openQuote('${q.id}')">Open →</button></div>`).join(""));

  sect("🔧", "Job — accepted, to do", G.job.length,
    G.job.map(q => { const j = jobById(q.jobId); const go = j ? `openJobPage('${j.id}')` : `openQuote('${q.id}')`; return `<div class="li" onclick="${go}" style="cursor:pointer"><div class="grow"><div class="nm">${who(q)} · ${amt(q)}</div><div class="sub">${j ? (j.date ? fmtDate(j.date) : "not yet scheduled") : "no job linked yet"}</div></div><button class="btn acc sm" onclick="event.stopPropagation();${go}">Open →</button></div>`; }).join(""));

  sect("📤", "Invoice — work done, bill it", G.bill.length,
    G.bill.map(q => `<div class="li"><div class="grow"><div class="nm">${who(q)} · ${amt(q)}</div><div class="sub">job done — send the invoice</div></div><button class="btn acc sm" onclick="openInvoice('${q.id}')">Bill →</button></div>`).join(""));

  sect("💸", "Paid — collect it", G.pay.length,
    G.pay.map(q => { const bal = (typeof quoteBalAmt === "function") ? quoteBalAmt(q) : (q.finalPrice || q.total || 0); return `<div class="li"><div class="grow"><div class="nm">${who(q)} · ${money(bal)} owed</div><div class="sub">invoiced${q.invoicedDate ? " " + fmtDate(q.invoicedDate) : ""}</div></div><button class="btn acc sm" onclick="recordPayment('${q.id}')">Payment →</button></div>`; }).join(""));

  sect("⭐", "Review — the after-action (required)", G.review.length,
    G.review.map(q => `<div class="li"><div class="grow"><div class="nm">${who(q)} · ${amt(q)}</div><div class="sub">paid — do the review so Cap learns</div></div><button class="btn acc sm" onclick="plReview('${q.id}')">Review →</button></div>`).join(""));

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
    <label>What would we do differently?</label><textarea id="rv_diff" placeholder="access, time, crew size, the dump run, pricing, gotchas…"></textarea>
    <label>Any lesson worth saving?</label><textarea id="rv_lesson" placeholder="e.g. that backyard needs 3 people; price the haul next time"></textarea>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="plSaveReview('${quoteId}')">Save review — mark done ✓</button>`);
};
window.plSaveReview = function (quoteId) {
  const q = (D().quotes || []).find(x => x.id === quoteId); if (!q) return;
  const good = val("rv_good"), diff = val("rv_diff"), lesson = val("rv_lesson");
  if (!(good || diff || lesson)) { if (!confirm("Empty review — mark done anyway?")) return; }
  const text = "⭐ REVIEW — " + [good ? "Went well: " + good : "", diff ? "Do differently: " + diff : "", lesson ? "Lesson: " + lesson : ""].filter(Boolean).join(" · ");
  const j = q.jobId ? (D().jobs || []).find(x => x.id === q.jobId) : null;
  if (j) { j.notes = (j.notes ? j.notes + "\n\n" : "") + text; j.reviewed = true; if (typeof touch === "function") touch(j); }
  q.reviewed = true; if (typeof touch === "function") touch(q);
  if (typeof logChange === "function") logChange("update", "quote", q.id, "Job review done · " + (q.cust || ""));
  save(); if (typeof closeModal === "function") closeModal(); if (typeof render === "function") render();
};
