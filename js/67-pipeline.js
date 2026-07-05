/* ---------- LEAD → QUOTE conversion + the JOB REVIEW after-action ----------
   The old pipeline FUNNEL view was removed — the job lifecycle status now lives as a column/filter on the
   Jobs table (workStage, js/60). These helpers survive it: plQuoteLead (a Leads-tab lead → the quote wizard)
   and plReview/plSaveReview (the required after-action on a PAID job — appends to the job notes Cap learns
   from + flips a reviewed flag). plReviewed reports whether a paid job has been reviewed (used by the Jobs
   table's "Review →" affordance on paid rows). */
function plReviewed(q, jobMap) { const j = q.jobId ? (jobMap ? (jobMap.get(q.jobId) || null) : (D().jobs || []).find(x => x.id === q.jobId)) : null; return !!(q.reviewed || (j && j.reviewed)); }


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
