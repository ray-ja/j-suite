/* ---------- RECEIPTS — FLAT-VALUE SPLITTING (owner/admin) ----------
   One receipt (one photo + one total) split into N FLAT-DOLLAR slices, each routed to its OWN billing bucket:
     🧱 pass-through material → job.materials[]   (billed to the customer at cost)
     🚚 job expense           → job.expenses[]     (a job cost; category "job")
     🔧 business tool          → this org's expenses[] (business overhead; category "tools/equipment" → off every
                                                       job's P&L, since it isn't attached to a job at all)

   REUSES the js/87 routing primitives verbatim — "run the route op once per slice":
     rcptTargetHome / rcptBuildRecord / rcptPushHome / rcptApplyEdit / rcptFindRecord.
   Every slice shares the original's receiptId (same photo) + vendor + date + payer, and — when N>1 — a
   `splitGroup` uid so the table (js/72) can group them back under one receipt. splitGroup is the ENTIRE schema
   footprint: purely additive (js/87 rcptBuildRecord), no new collection, no migration, no fingerprint reads it,
   and downstream P&L/finance math (js/52) keys off ordinary records, so each slice flows through unchanged.

   rcptRouteNew + rcptApplySplit are PURE (DOM-free) — unit-tested in receipts-tests.js. The UI below is a thin
   editor mounted into the js/87 edit modal (#rcpt_split_slot); it reads the rows → rcptApplySplit → same
   save/close/render tail as rcptSaveEdit. A 1-row split is byte-identical to today's single route (splitGroup
   stays null and slice[0] is the ONLY call → the original record is reused in place, id preserved). */

/* money with cents (the app's money() rounds to whole dollars — splits need the pennies to reconcile) */
function rcptSplitMoney(n) { return "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2); }

/* build the fields object a slice routes with — shared receipt fields + this allocation's amount/type/job/note,
   plus splitGroup when the receipt is genuinely split (N>1). Same field shape rcptSaveEdit builds, so slice[0]
   through rcptApplyEdit is identical to a normal single route. */
function rcptSplitFields(shared, alloc, splitGroup) {
  const f = {
    type: alloc.type || null,
    jobId: alloc.jobId || null,
    amount: (alloc.amount == null || alloc.amount === "") ? null : (+alloc.amount || 0),
    vendor: shared.vendor || "",
    date: shared.date || "",
    category: (alloc.category != null && alloc.category !== "") ? alloc.category : (shared.category || ""),
    paidBy: shared.paidBy || null,
    attributedTo: shared.attributedTo || null,
    desc: (alloc.desc != null && alloc.desc !== "") ? alloc.desc : (shared.desc || ""),
    receiptId: shared.receiptId || null,
    cardLast4: shared.cardLast4 || ""   // js/94: every slice inherits the receipt's card last-4 (auto-attribution)
  };
  if (splitGroup) f.splitGroup = splitGroup;
  return f;
}

/* the "create a fresh record" half of rcptApplyEdit's diff-home branch — routes ONE allocation into a brand-new
   record (new uid) in its bucket, via the SAME primitives. Returns the new location. */
function rcptRouteNew(fields, carry) {
  const home = rcptTargetHome(fields);
  const rec = rcptBuildRecord(home, uid(), fields, carry);
  rcptPushHome(home, rec);
  return { store: home.store, jobId: home.jobId, recId: rec.id };
}

/* THE PURE SPLIT OP (no DOM). loc={store,jobId,recId} = the receipt being split (usually a review record).
   total = the receipt's full amount. allocations = [{amount,type,jobId?,category?,desc?}, …].
   shared = {vendor,date,paidBy,attributedTo,category?,desc?,receiptId} carried onto every slice.
   Validates (each amount>0; 🧱/🚚 need a job; |Σ−total|≤$0.01 — over BLOCKS, under BLOCKS). When N>1, stamps a
   fresh splitGroup on every slice. slice[0] REUSES/consumes the original via rcptApplyEdit (id preserved — for
   N==1 this is the ONLY call ⇒ byte-identical to today's single route); slices 1..N-1 = rcptRouteNew with a
   carry built from the original exactly as rcptApplyEdit does. Returns {ok,newLocs,splitGroup} | {error}. */
function rcptApplySplit(loc, total, allocations, shared) {
  allocations = Array.isArray(allocations) ? allocations : [];
  shared = shared || {};
  if (!allocations.length) return { error: "Add at least one split." };
  total = Math.round((+total || 0) * 100) / 100;
  let sum = 0;
  for (let i = 0; i < allocations.length; i++) {
    const a = allocations[i], amt = +a.amount || 0;
    if (!(amt > 0)) return { error: "Every split needs an amount over $0." };
    if ((a.type === "pass-through" || a.type === "job-expense") && !a.jobId) return { error: "Pick a job for each 🧱 material / 🚚 job-expense split." };
    sum += amt;
  }
  sum = Math.round(sum * 100) / 100;
  const diff = Math.round((sum - total) * 100) / 100;
  if (diff > 0.01) return { error: "Splits add up to " + rcptSplitMoney(sum) + " — that's " + rcptSplitMoney(diff) + " OVER the " + rcptSplitMoney(total) + " receipt. Trim a split." };
  if (diff < -0.01) return { error: "Splits add up to " + rcptSplitMoney(sum) + " — " + rcptSplitMoney(-diff) + " short of the " + rcptSplitMoney(total) + " receipt. Put the rest on the last split." };
  const cur = rcptFindRecord(loc.store, loc.jobId, loc.recId || loc.id);
  if (!cur) return { error: "That receipt isn't here anymore — refresh." };
  // carry the same preserved fields rcptApplyEdit does, from the ORIGINAL record, for the fresh slices
  const carry = { ts: cur.ts, uploadedBy: cur.uploadedBy, attributedTo: cur.attributedTo, reimbursedAt: cur.reimbursedAt, capRead: cur.capRead, faultMemberId: cur.faultMemberId, suggested: cur.suggested, by: cur.by };
  if ((cur.paidBy || null) !== (shared.paidBy || null)) carry.reimbursedAt = undefined;   // payer changed → old reimbursement no longer applies
  const splitGroup = allocations.length > 1 ? uid() : null;
  // slice[0] reuses/consumes the original review record (id preserved) — for N==1 this is the ONLY call.
  const res0 = rcptApplyEdit(loc, rcptSplitFields(shared, allocations[0], splitGroup));
  if (!res0 || !res0.ok) return { error: (res0 && res0.error) || "Couldn't file the first split." };
  const newLocs = [res0.newLoc];
  for (let i = 1; i < allocations.length; i++) newLocs.push(rcptRouteNew(rcptSplitFields(shared, allocations[i], splitGroup), carry));
  return { ok: true, newLocs: newLocs, splitGroup: splitGroup };
}

/* ============================== SPLIT UI (edit-modal add-on) ============================== */
let RCPT_SPLIT = null;   // { loc, total, rows:[{bucket,jobId,amount,note}] }  — active only while splitting
const RCPT_SPLIT_BUCKETS = [["pass-through", "🧱 Pass-through material"], ["job-expense", "🚚 Job expense"], ["business", "🔧 Business tool / overhead"]];

/* mount the collapsed "🔀 Split this receipt" control into the modal slot (called by js/87 rcptEditOpen) */
window.rcptSplitInit = function () {
  if (typeof rcptFinFull === "function" && !rcptFinFull()) return;
  const slot = document.getElementById("rcpt_split_slot"); if (!slot) return;
  RCPT_SPLIT = null;
  const acts = document.getElementById("rcpt_edit_actions"); if (acts) acts.style.display = "";
  slot.innerHTML = `<button class="btn ghost sm" style="width:100%;margin-top:10px;color:var(--accent)" onclick="rcptSplitStart()">🔀 Split this receipt into parts</button>
    <div class="sub" style="white-space:normal;margin-top:4px;opacity:.7">One receipt paid partly for materials, partly for a tool? Split it by dollar amount — each part files to its own bucket.</div>`;
};

/* expand the allocation editor, seeded from the current form (its type/job + the amount as the total) */
window.rcptSplitStart = function () {
  const amtRaw = (typeof val === "function") ? val("rcpt_amt") : "";
  const total = amtRaw === "" ? 0 : (parseFloat(amtRaw) || 0);
  if (!(total > 0)) { alert("Enter the receipt's total amount first, then split it."); return; }
  const curType = (typeof val === "function") ? val("rcpt_type") : "";
  const jobEl = document.getElementById("rcpt_job");
  const curJob = jobEl ? jobEl.value : "";
  const curDesc = (typeof val === "function") ? val("rcpt_desc") : "";
  RCPT_SPLIT = {
    loc: (typeof RCPT_EDIT !== "undefined" && RCPT_EDIT) ? RCPT_EDIT.loc : null,
    total: total,
    rows: [
      { bucket: (curType === "business" || curType === "job-expense") ? curType : "pass-through", jobId: curJob, amount: "", note: curDesc },
      { bucket: "business", jobId: "", amount: "", note: "" }
    ]
  };
  rcptSplitRender();
};

/* CAP SPLIT SUGGESTION (called by js/87 rcptApplySuggestion when Cap saw a MIXED receipt) — expand the allocation
   editor PRE-FILLED from Cap's `splits` [{amount,type,category,note}, …]. Cap proposes, the owner confirms: this
   only opens + fills the editor (balanced "$X of $Y"); nothing is committed until the owner taps "Save splits".
   Each split → one row {bucket=Cap's type, amount, note}. Cap's split shape carries no jobId, so a 🧱/🚚 row is
   pre-seeded with the receipt's current job (the top-level suggested jobId, already set in the form) — the owner
   just confirms or picks the job. Guarded so a missing/short splits array never touches the DOM. */
window.rcptSplitStartFromSuggestion = function (splits, fallbackJobId) {
  if (typeof rcptFinFull === "function" && !rcptFinFull()) return;
  if (!Array.isArray(splits) || splits.length < 2) return;
  const amtRaw = (typeof val === "function") ? val("rcpt_amt") : "";
  const total = amtRaw === "" ? 0 : (parseFloat(amtRaw) || 0);
  const jobEl = document.getElementById("rcpt_job");
  const curJob = (jobEl ? jobEl.value : "") || fallbackJobId || "";
  const rows = splits.map(sp => {
    const bucket = (sp && (sp.type === "business" || sp.type === "job-expense" || sp.type === "pass-through")) ? sp.type : "pass-through";
    const needsJob = (bucket === "pass-through" || bucket === "job-expense");
    const amt = (sp && sp.amount != null && !isNaN(+sp.amount)) ? Math.round(+sp.amount * 100) / 100 : "";
    return { bucket: bucket, jobId: needsJob ? curJob : "", amount: (amt === "" ? "" : String(amt)), note: (sp && sp.note != null) ? String(sp.note) : "" };
  });
  RCPT_SPLIT = {
    loc: (typeof RCPT_EDIT !== "undefined" && RCPT_EDIT) ? RCPT_EDIT.loc : null,
    total: total,
    rows: rows
  };
  rcptSplitRender();
};

function rcptSplitBucketOpts(sel) { return RCPT_SPLIT_BUCKETS.map(b => `<option value="${b[0]}"${sel === b[0] ? " selected" : ""}>${b[1]}</option>`).join(""); }
function rcptSplitJobOpts(sel) {
  const jobs = (typeof rcptJobs === "function") ? rcptJobs() : [];
  return `<option value="">— pick a job —</option>` + jobs.map(j => `<option value="${esc(j.id)}"${sel === j.id ? " selected" : ""}>${esc(j.title || "Job")}${(j.customerId && typeof custName === "function") ? " · " + esc(custName(j.customerId)) : ""}</option>`).join("");
}

/* read the live DOM rows back into state (before any structural re-render, so typed values aren't lost) */
function rcptSplitCapture() {
  if (!RCPT_SPLIT) return;
  RCPT_SPLIT.rows.forEach((r, i) => {
    const a = document.querySelector('.rcpt_split_amt[data-i="' + i + '"]'); if (a) r.amount = a.value;
    const b = document.querySelector('.rcpt_split_bucket[data-i="' + i + '"]'); if (b) r.bucket = b.value;
    const j = document.querySelector('.rcpt_split_job[data-i="' + i + '"]'); if (j) r.jobId = j.value;
    const n = document.querySelector('.rcpt_split_note[data-i="' + i + '"]'); if (n) r.note = n.value;
  });
}

function rcptSplitRender() {
  const slot = document.getElementById("rcpt_split_slot"); if (!slot || !RCPT_SPLIT) return;
  const acts = document.getElementById("rcpt_edit_actions"); if (acts) acts.style.display = "none";   // split has its own Save
  let h = `<div class="card" style="margin-top:10px;padding:10px;background:var(--soft)">
    <div class="row" style="justify-content:space-between;align-items:center"><b>🔀 Split ${rcptSplitMoney(RCPT_SPLIT.total)}</b><button class="btn ghost sm" onclick="rcptSplitCancel()">✕ Cancel split</button></div>`;
  RCPT_SPLIT.rows.forEach((r, i) => {
    const needsJob = (r.bucket === "pass-through" || r.bucket === "job-expense");
    h += `<div class="card" style="padding:8px;margin-top:8px">
      <div class="row" style="gap:6px;align-items:flex-end">
        <div style="flex:0 0 92px"><label style="margin-top:0">Amount ($)</label><input class="rcpt_split_amt" data-i="${i}" type="number" inputmode="decimal" value="${esc(r.amount)}" placeholder="0.00" oninput="rcptSplitRecalc()"></div>
        <div class="grow"><label style="margin-top:0">Goes to</label><select class="rcpt_split_bucket" data-i="${i}" onchange="rcptSplitSetBucket(${i},this.value)">${rcptSplitBucketOpts(r.bucket)}</select></div>
        ${RCPT_SPLIT.rows.length > 1 ? `<button class="btn ghost sm" style="flex:0 0 auto;color:var(--danger)" onclick="rcptSplitRemove(${i})" title="Remove">✕</button>` : ""}
      </div>
      <div class="rcpt_split_jobwrap" data-i="${i}" style="display:${needsJob ? "block" : "none"}"><label>Job</label><select class="rcpt_split_job" data-i="${i}">${rcptSplitJobOpts(r.jobId)}</select></div>
      <label>Note <span class="sub">(optional)</span></label><input class="rcpt_split_note" data-i="${i}" value="${esc(r.note || "")}" placeholder="what this part was">
      <button class="btn ghost sm" style="margin-top:6px" onclick="rcptSplitRest(${i})">↳ put the rest here</button>
    </div>`;
  });
  h += `<div id="rcpt_split_ind" class="sub" style="margin-top:8px;text-align:center;font-weight:700"></div>
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="rcptSplitAdd()">+ Add split</button><button class="btn acc grow" onclick="rcptSaveEditSplit()">✓ Save splits</button></div></div>`;
  slot.innerHTML = h;
  rcptSplitRecalc();
}

/* live "allocated $X of $Total · $R left" indicator — green balanced / amber short / red over. No re-render
   (reads the amount inputs directly) so typing never loses focus. */
window.rcptSplitRecalc = function () {
  const ind = document.getElementById("rcpt_split_ind"); if (!ind || !RCPT_SPLIT) return;
  let sum = 0; document.querySelectorAll(".rcpt_split_amt").forEach(el => { sum += (parseFloat(el.value) || 0); });
  sum = Math.round(sum * 100) / 100;
  const total = RCPT_SPLIT.total, left = Math.round((total - sum) * 100) / 100;
  if (Math.abs(left) <= 0.01) { ind.style.color = "var(--accent)"; ind.textContent = "✓ Allocated " + rcptSplitMoney(sum) + " of " + rcptSplitMoney(total) + " — balanced"; }
  else if (left > 0) { ind.style.color = "#e0a800"; ind.textContent = "Allocated " + rcptSplitMoney(sum) + " of " + rcptSplitMoney(total) + " · " + rcptSplitMoney(left) + " left"; }
  else { ind.style.color = "var(--danger)"; ind.textContent = "Over by " + rcptSplitMoney(-left) + " — allocated " + rcptSplitMoney(sum) + " of " + rcptSplitMoney(total); }
};

window.rcptSplitAdd = function () { if (!RCPT_SPLIT) return; rcptSplitCapture(); RCPT_SPLIT.rows.push({ bucket: "business", jobId: "", amount: "", note: "" }); rcptSplitRender(); };
window.rcptSplitRemove = function (i) { if (!RCPT_SPLIT) return; rcptSplitCapture(); RCPT_SPLIT.rows.splice(i, 1); if (!RCPT_SPLIT.rows.length) RCPT_SPLIT.rows.push({ bucket: "pass-through", jobId: "", amount: "", note: "" }); rcptSplitRender(); };
window.rcptSplitSetBucket = function (i, v) { if (!RCPT_SPLIT) return; rcptSplitCapture(); if (RCPT_SPLIT.rows[i]) RCPT_SPLIT.rows[i].bucket = v; rcptSplitRender(); };
window.rcptSplitRest = function (i) {
  if (!RCPT_SPLIT) return; rcptSplitCapture();
  const others = RCPT_SPLIT.rows.reduce((s, r, k) => s + (k === i ? 0 : (+r.amount || 0)), 0);
  const rest = Math.round((RCPT_SPLIT.total - others) * 100) / 100;
  if (RCPT_SPLIT.rows[i]) RCPT_SPLIT.rows[i].amount = rest > 0 ? String(rest) : "";
  rcptSplitRender();
};
window.rcptSplitCancel = function () { RCPT_SPLIT = null; rcptSplitInit(); };

window.rcptSaveEditSplit = function () {
  if (typeof rcptFinFull === "function" && !rcptFinFull()) return;
  if (typeof RCPT_EDIT === "undefined" || !RCPT_EDIT || !RCPT_SPLIT) return;
  rcptSplitCapture();
  const vendor = ((typeof val === "function" ? val("rcpt_vendor") : "") || "").trim();
  if (!vendor) { alert("Enter the vendor / where it was bought."); return; }
  const shared = {
    vendor: vendor,
    date: (typeof val === "function") ? val("rcpt_date") : "",
    paidBy: ((typeof val === "function") ? val("rcpt_paidby") : "") || null,
    attributedTo: ((typeof val === "function") ? val("rcpt_attr") : "") || null,
    category: ((typeof val === "function") ? val("rcpt_cat") : "") || "",
    desc: ((typeof val === "function") ? val("rcpt_desc") : "") || "",
    receiptId: RCPT_EDIT.receiptId || null,
    cardLast4: (((typeof val === "function") ? val("rcpt_card4") : "") || "").replace(/\D/g, "").slice(-4)   // js/94: carry the card last-4 onto every slice
  };
  // bucket → routing type + the category marker (🔧 tool → "tools/equipment" overhead; 🚚 → "job"; 🧱 job.materials ignores category)
  const allocations = RCPT_SPLIT.rows.map(r => ({
    amount: (r.amount === "" || r.amount == null) ? 0 : (parseFloat(r.amount) || 0),
    type: r.bucket,
    jobId: (r.bucket === "business") ? null : (r.jobId || null),
    category: (r.bucket === "business") ? "tools/equipment" : (r.bucket === "job-expense") ? "job" : "",
    desc: r.note || ""
  }));
  if (typeof submitGuard === "function" && !submitGuard("rcptSaveEditSplit:" + RCPT_EDIT.loc.recId)) return;   // rapid-tap dupe guard
  const res = rcptApplySplit(RCPT_EDIT.loc, RCPT_SPLIT.total, allocations, shared);
  if (!res || !res.ok) { alert(res && res.error ? res.error : "Couldn't split this receipt."); return; }
  if (typeof logChange === "function") logChange("update", "expense", res.newLocs[0].recId, "Receipt split into " + allocations.length + " part" + (allocations.length > 1 ? "s" : "") + " — " + rcptSplitMoney(RCPT_SPLIT.total) + (vendor ? " · " + vendor : ""));
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  RCPT_EDIT = null; RCPT_SPLIT = null;
  if (typeof render === "function") render();
};

if (typeof module !== "undefined" && module.exports) { module.exports = { rcptApplySplit: rcptApplySplit, rcptRouteNew: rcptRouteNew, rcptSplitFields: rcptSplitFields }; }
