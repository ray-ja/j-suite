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

/* OBX sales-tax rate — Dare + Currituck County NC are both 6.75% (4.75% state + 2.00% county). Sales tax is
   NEVER its own record/split; it's shown as an "incl. $X sales tax" SUB-LINE on each receipt (js/72 backfill).
   This constant is the single source of that rate. */
var RCPT_OBX_TAX_RATE = 0.0675;

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

function rcptSplitClampBucket(b) { return (b === "business" || b === "job-expense" || b === "pass-through") ? b : "pass-through"; }

/* SALES TAX (js/92) — Cap reads the receipt's LINE prices as printed (pre-tax); the grand total is tax-INCLUSIVE.
   So on an itemized receipt the lines sum to the SUBTOTAL and the gap up to the total is sales tax (NC/Dare 6.75%).
   That gap must NOT read as "money left to allocate" — it's tax. These pure helpers detect it and fold it back in.

   rcptSplitDetectTax: the gap between the tax-inclusive total and the pre-tax line subtotal, but ONLY when it's a
   plausible sales-tax band of the subtotal (≤ ~12%, covering 6.75% + rounding/combined). A bigger gap is a genuine
   missing line, not tax → returns 0 (falls back to the normal "$X left"). */
function rcptSplitDetectTax(rows, total) {
  const sub = Math.round((Array.isArray(rows) ? rows : []).reduce((s, r) => s + (parseFloat(r && r.amount) || 0), 0) * 100) / 100;
  const gap = Math.round(((+total || 0) - sub) * 100) / 100;
  if (!(gap > 0) || !(sub > 0)) return 0;
  return (gap <= sub * 0.12 + 0.02) ? gap : 0;
}
/* rcptSplitDistributeAdjust: fold a SIGNED adjustment (+ sales tax, − discount, or their net) into the line
   allocations proportionally by amount, cent-exact (the LAST line absorbs the rounding remainder so Σ ==
   subtotal + adjust EXACTLY). This keeps the app's model: tax/discount are never their own record — each bucket's
   stored amount is the NET tax-inclusive, discount-applied cost (what was actually paid), exactly like a single
   whole-receipt route already stores. Returns a NEW array. Pure. */
function rcptSplitDistributeAdjust(allocations, adjust) {
  allocations = Array.isArray(allocations) ? allocations : [];
  adjust = Math.round((+adjust || 0) * 100) / 100;
  const sub = Math.round(allocations.reduce((s, a) => s + (+a.amount || 0), 0) * 100) / 100;
  if (adjust === 0 || !(sub > 0)) return allocations.map(a => Object.assign({}, a));
  let used = 0; const n = allocations.length;
  return allocations.map((a, i) => {
    const share = (i === n - 1) ? Math.round((adjust - used) * 100) / 100 : Math.round((adjust * ((+a.amount || 0) / sub)) * 100) / 100;
    if (i !== n - 1) used += share;
    return Object.assign({}, a, { amount: Math.round(((+a.amount || 0) + share) * 100) / 100 });
  });
}
/* back-compat wrapper: tax-only (non-negative) distribution */
function rcptSplitDistributeTax(allocations, tax) { return rcptSplitDistributeAdjust(allocations, Math.max(0, Math.round((+tax || 0) * 100) / 100)); }

/* Seed the always-on line-item editor's rows from a receipt record — mirrors js/100 jobRcptSeed so the Receipts
   edit modal shows the SAME per-item breakdown the job page does. Prefers Cap's per-item
   lineItems:[{desc,amount,bucket}]; falls back to Cap's mixed splits:[{amount,type,note}]; else ONE line = the
   whole receipt as it stands today (a 1-row "split" routes byte-identically to a normal single save — id
   preserved). 🧱/🚚 rows inherit the receipt's current/guessed job so they file to it; 🔧 rows carry no job.
   Pure (DOM-free) so it's unit-testable. Never throws. */
function rcptSplitSeedRows(rec) {
  rec = rec || {};
  const sg = rec.suggested || {};
  const curJob = rec.jobId || (sg.jobId || "");
  const row = (bucket, amount, note) => {
    const b = rcptSplitClampBucket(bucket);
    const needsJob = (b === "pass-through" || b === "job-expense");
    const amt = (amount != null && amount !== "" && !isNaN(+amount)) ? String(Math.round(+amount * 100) / 100) : "";
    return { bucket: b, jobId: needsJob ? curJob : "", amount: amt, note: (note == null ? "" : String(note)).slice(0, 120) };
  };
  const li = Array.isArray(sg.lineItems) ? sg.lineItems : (Array.isArray(rec.lineItems) ? rec.lineItems : null);
  if (li && li.length) return li.filter(Boolean).map(it => row(it.bucket, it.amount, it.desc));
  const sp = Array.isArray(sg.splits) ? sg.splits : null;
  if (sp && sp.length) return sp.filter(Boolean).map(it => row(it.type, it.amount, it.note));
  // default: the whole receipt as one stored line (the type/job it already has or Cap guessed)
  const amt = (rec.amount != null && rec.amount !== "") ? rec.amount : (sg.amount != null ? sg.amount : "");
  return [row(rec.type || sg.type, amt, rec.desc || rec.note || sg.desc || "")];
}

/* mount the ALWAYS-ON line-item editor into the modal slot (called by js/87 rcptEditOpen WITH the record). Ray's
   ask: "see each line item the way it's going to be stored, including the split + where each thing goes — all on
   the edit-receipt screen." So instead of a "🔀 Split" button, the editor is open by default, seeded from the
   receipt, and its "✓ Save & file" routes every line to its own record via the SAME tested rcptApplySplit engine
   (a 1-line receipt saves byte-identically to today's single route). */
window.rcptSplitInit = function (rec) {
  if (typeof rcptFinFull === "function" && !rcptFinFull()) return;
  const slot = document.getElementById("rcpt_split_slot"); if (!slot) return;
  const amtEl = document.getElementById("rcpt_amt");
  let total = (amtEl && amtEl.value !== "") ? (parseFloat(amtEl.value) || 0) : (+((rec && rec.amount)) || +(((rec && rec.suggested) || {}).amount) || 0);
  RCPT_SPLIT = {
    loc: (typeof RCPT_EDIT !== "undefined" && RCPT_EDIT) ? RCPT_EDIT.loc : null,
    total: Math.round(total * 100) / 100,
    rows: rcptSplitSeedRows(rec)
  };
  // Seed the receipt's own discount + sales-tax lines from Cap's read (when it read them). A Cap-provided value is
  // treated as KNOWN (touched) so it isn't auto-overwritten; when Cap gave nothing, we auto-track the remainder.
  const sg = (rec && rec.suggested) || {};
  const capDisc = (sg.discount != null && !isNaN(+sg.discount) && +sg.discount > 0) ? Math.round(+sg.discount * 100) / 100 : 0;
  const capTax = (sg.salesTax != null && !isNaN(+sg.salesTax) && +sg.salesTax > 0) ? Math.round(+sg.salesTax * 100) / 100 : 0;
  RCPT_SPLIT.discount = capDisc;
  RCPT_SPLIT.discountTouched = capDisc > 0;
  RCPT_SPLIT.tax = capTax || rcptSplitDetectTax(RCPT_SPLIT.rows, RCPT_SPLIT.total);   // Cap's tax wins; else the pre-tax lines' gap up to the total
  RCPT_SPLIT.taxTouched = capTax > 0;   // auto-track the remainder as tax only when Cap didn't read it
  rcptSplitRender();
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
    const iv = document.querySelector('.rcpt_split_inv[data-i="' + i + '"]'); if (iv) r.toInv = iv.checked;   // 🧰 per-line "track this tool in inventory"
  });
  const t = document.getElementById("rcpt_split_tax_inp"); if (t && RCPT_SPLIT.taxTouched) RCPT_SPLIT.tax = Math.round((parseFloat(t.value) || 0) * 100) / 100;
  const dd = document.getElementById("rcpt_split_disc_inp"); if (dd && RCPT_SPLIT.discountTouched) RCPT_SPLIT.discount = Math.round((parseFloat(dd.value) || 0) * 100) / 100;
}

/* one-line reminder of where a bucket lands — so the owner SEES the destination, not just an emoji */
function rcptSplitBucketHint(b) {
  return b === "pass-through" ? "🧱 Pass-through material — billed to the customer on its job"
    : b === "job-expense" ? "🚚 Job expense — a cost on its job"
    : "🔧 Business tool / overhead — off every job (add to inventory after filing)";
}
function rcptSplitRender() {
  const slot = document.getElementById("rcpt_split_slot"); if (!slot || !RCPT_SPLIT) return;
  // total tracks the live Amount field so editing it up top reflows the "of $X" target
  const amtEl = document.getElementById("rcpt_amt");
  if (amtEl && amtEl.value !== "") RCPT_SPLIT.total = Math.round((parseFloat(amtEl.value) || 0) * 100) / 100;
  const store = (typeof RCPT_EDIT !== "undefined" && RCPT_EDIT && RCPT_EDIT.loc) ? RCPT_EDIT.loc.store : "";
  const saveLbl = (store === "review") ? "✓ Save &amp; file" : "✓ Save changes";
  let h = `<div class="card" style="margin-top:10px;padding:10px;background:var(--soft)">
    <div style="font-weight:800">📋 Line items <span class="sub" style="font-weight:400">· each line is stored as its own record</span></div>
    <div class="sub" style="white-space:normal;margin:4px 0 2px">This is exactly how it saves. Tag where each line goes; the amounts must add up to the receipt total.</div>`;
  RCPT_SPLIT.rows.forEach((r, i) => {
    const needsJob = (r.bucket === "pass-through" || r.bucket === "job-expense");
    h += `<div class="card" style="padding:8px;margin-top:8px">
      <input class="rcpt_split_note" data-i="${i}" value="${esc(r.note || "")}" placeholder="What — pavers, dump fee, a tool…" style="font-weight:600">
      <div class="row" style="gap:6px;margin-top:6px;align-items:flex-end">
        <div style="flex:0 0 88px"><label style="margin-top:0">Amount ($)</label><input class="rcpt_split_amt" data-i="${i}" type="number" inputmode="decimal" value="${esc(r.amount)}" placeholder="0.00" oninput="rcptSplitRecalc()"></div>
        <div class="grow"><label style="margin-top:0">Stored as</label><select class="rcpt_split_bucket" data-i="${i}" onchange="rcptSplitSetBucket(${i},this.value)">${rcptSplitBucketOpts(r.bucket)}</select></div>
        ${RCPT_SPLIT.rows.length > 1 ? `<button class="btn ghost sm" style="flex:0 0 auto;color:var(--danger)" onclick="rcptSplitRemove(${i})" title="Remove line">✕</button>` : ""}
      </div>
      <div class="rcpt_split_jobwrap" data-i="${i}" style="display:${needsJob ? "block" : "none"}"><label>Job it bills to</label><select class="rcpt_split_job" data-i="${i}">${rcptSplitJobOpts(r.jobId)}</select></div>
      ${r.bucket === "business" ? `<label class="li" style="cursor:pointer;margin-top:6px;display:flex;align-items:center;gap:8px"><input type="checkbox" class="rcpt_split_inv" data-i="${i}" ${r.toInv ? "checked" : ""} style="width:18px;height:18px;flex:0 0 auto"><span class="sub" style="white-space:normal">🧰 Also track this tool in inventory (as an asset) — added when you file</span></label>` : ""}
      <div class="sub" style="margin-top:4px;white-space:normal">${rcptSplitBucketHint(r.bucket)} · <a onclick="rcptSplitRest(${i})" style="cursor:pointer;color:var(--accent)">↳ put the rest here</a></div>
    </div>`;
  });
  // ADJUSTMENTS — the receipt's own Discount + Sales-tax lines (editable, like the receipt). The line items are the
  // pre-discount / pre-tax LIST prices, so: items − discount + tax = total. Both fold proportionally into the lines
  // on file (each carries its share) — never their own record, never billed twice. Fill in either one and the other
  // auto-completes to balance. Shown when itemized, when there's an adjustment, or when the items don't already
  // equal the total; hidden on a plain single-line receipt that already matches its total.
  const _subtotal = Math.round(RCPT_SPLIT.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0) * 100) / 100;
  if (RCPT_SPLIT.rows.length > 1 || (RCPT_SPLIT.discount || 0) > 0 || (RCPT_SPLIT.tax || 0) > 0 || Math.abs(_subtotal - RCPT_SPLIT.total) > 0.01) {
    const dv = RCPT_SPLIT.discount ? (Math.round(RCPT_SPLIT.discount * 100) / 100).toFixed(2) : "";
    const tv = RCPT_SPLIT.tax ? (Math.round(RCPT_SPLIT.tax * 100) / 100).toFixed(2) : "";
    h += `<div class="card" style="padding:8px;margin-top:8px;border:1px dashed var(--line)">
      <div class="sub" style="font-weight:700;white-space:normal;margin-bottom:6px">Adjustments <span style="font-weight:400">· their own lines, like the receipt — folded into the items when you file (never billed twice)</span></div>
      <div class="row" style="gap:8px;align-items:flex-end">
        <div class="grow"><label style="margin-top:0">🏷️ Discount ($)</label><input id="rcpt_split_disc_inp" type="number" inputmode="decimal" value="${esc(dv)}" placeholder="0.00" oninput="rcptSplitDiscEdit(this.value)"></div>
        <div class="grow"><label style="margin-top:0">🧾 Sales tax ($)</label><input id="rcpt_split_tax_inp" type="number" inputmode="decimal" value="${esc(tv)}" placeholder="0.00" oninput="rcptSplitTaxEdit(this.value)"></div>
      </div>
    </div>`;
  }
  h += `<div id="rcpt_split_ind" class="sub" style="margin-top:8px;text-align:center;font-weight:700"></div>
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" onclick="rcptSplitAdd()">+ Add a line</button><button class="btn acc grow" onclick="rcptSaveEditSplit()">${saveLbl}</button></div></div>`;
  slot.innerHTML = h;
  // Receipt-level Type + Category (js/87) only make sense for a SINGLE-line receipt. Once it's split into line items,
  // each line owns its type ("Stored as") + category, so a single receipt-wide value is contradictory — hide it.
  const _tc = document.getElementById("rcpt_typecat_wrap");
  if (_tc) _tc.style.display = (RCPT_SPLIT.rows.length > 1) ? "none" : "";
  rcptSplitRecalc();
}

/* live "allocated $X of $Total · $R left" indicator — green balanced / amber short / red over. No re-render
   (reads the amount inputs directly) so typing never loses focus. */
window.rcptSplitRecalc = function () {
  const ind = document.getElementById("rcpt_split_ind"); if (!ind || !RCPT_SPLIT) return;
  const amtEl = document.getElementById("rcpt_amt");
  if (amtEl && amtEl.value !== "") RCPT_SPLIT.total = Math.round((parseFloat(amtEl.value) || 0) * 100) / 100;   // track the live Amount field
  let sub = 0; document.querySelectorAll(".rcpt_split_amt").forEach(el => { sub += (parseFloat(el.value) || 0); });
  sub = Math.round(sub * 100) / 100;
  const total = RCPT_SPLIT.total;
  // items − discount + tax = total. Auto-fill the UNtouched adjustment(s) from the residual, so the remainder reads
  // as tax/discount (not "money left"); fill in EITHER field and the other completes to balance.
  let d = Math.round((RCPT_SPLIT.discount || 0) * 100) / 100;
  let t = Math.round((RCPT_SPLIT.tax || 0) * 100) / 100;
  if (!RCPT_SPLIT.discountTouched && !RCPT_SPLIT.taxTouched) {
    const gap = Math.round((total - sub) * 100) / 100;   // total below list = discount; above = tax
    if (gap < -0.001) { d = Math.round(-gap * 100) / 100; t = 0; }
    else if (gap > 0.001 && sub > 0 && gap <= sub * 0.12 + 0.02) { t = gap; d = 0; }
    else { t = 0; d = 0; }
  } else if (!RCPT_SPLIT.taxTouched) {
    t = Math.max(0, Math.round((total - (sub - d)) * 100) / 100);
  } else if (!RCPT_SPLIT.discountTouched) {
    d = Math.max(0, Math.round(((sub + t) - total) * 100) / 100);
  }
  RCPT_SPLIT.discount = d; RCPT_SPLIT.tax = t;
  const dEl = document.getElementById("rcpt_split_disc_inp");
  if (dEl && !RCPT_SPLIT.discountTouched && document.activeElement !== dEl) dEl.value = d ? d.toFixed(2) : "";
  const tEl = document.getElementById("rcpt_split_tax_inp");
  if (tEl && !RCPT_SPLIT.taxTouched && document.activeElement !== tEl) tEl.value = t ? t.toFixed(2) : "";
  const alloc = Math.round((sub - d + t) * 100) / 100;
  const left = Math.round((total - alloc) * 100) / 100;
  const parts = "Items " + rcptSplitMoney(sub) + (d > 0 ? " − discount " + rcptSplitMoney(d) : "") + (t > 0 ? " + tax " + rcptSplitMoney(t) : "");
  if (Math.abs(left) <= 0.01) {
    ind.style.color = "var(--accent)";
    ind.textContent = (d > 0 || t > 0) ? ("✓ " + parts + " = " + rcptSplitMoney(total)) : ("✓ Allocated " + rcptSplitMoney(sub) + " of " + rcptSplitMoney(total) + " — balanced");
  } else if (left > 0) {
    ind.style.color = "#e0a800";
    ind.textContent = parts + " · " + rcptSplitMoney(left) + " still to allocate";
  } else {
    ind.style.color = "var(--danger)";
    ind.textContent = "Over by " + rcptSplitMoney(-left) + " — " + parts;
  }
};
/* the owner typed a tax / discount amount → freeze it (stop auto-tracking that field) and re-reconcile (no
   re-render, keeps focus). The OTHER field, if still untouched, auto-completes to balance. */
window.rcptSplitTaxEdit = function (v) { if (!RCPT_SPLIT) return; RCPT_SPLIT.taxTouched = true; RCPT_SPLIT.tax = Math.round((parseFloat(v) || 0) * 100) / 100; rcptSplitRecalc(); };
window.rcptSplitDiscEdit = function (v) { if (!RCPT_SPLIT) return; RCPT_SPLIT.discountTouched = true; RCPT_SPLIT.discount = Math.round((parseFloat(v) || 0) * 100) / 100; rcptSplitRecalc(); };

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
  // fold the NET adjustment (sales tax − discount) proportionally into the lines so each stored record is the net
  // tax-inclusive, discount-applied cost actually paid (app model) and the set sums to the receipt total — never a
  // separate tax/discount record. No-op when both are 0 (byte-identical single/normal route).
  if (typeof rcptSplitRecalc === "function") rcptSplitRecalc();   // refresh auto discount/tax against the final line amounts
  const netAdj = Math.round(((RCPT_SPLIT.tax || 0) - (RCPT_SPLIT.discount || 0)) * 100) / 100;
  const taxedAllocs = rcptSplitDistributeAdjust(allocations, netAdj);
  if (typeof submitGuard === "function" && !submitGuard("rcptSaveEditSplit:" + RCPT_EDIT.loc.recId)) return;   // rapid-tap dupe guard
  const res = rcptApplySplit(RCPT_EDIT.loc, RCPT_SPLIT.total, taxedAllocs, shared);
  if (!res || !res.ok) { alert(res && res.error ? res.error : "Couldn't split this receipt."); return; }
  // 🧰 PER-LINE INVENTORY — rows and res.newLocs align 1:1 (allocations were built from rows in order). For each
  // 🔧 tool line the owner ticked "track in inventory", add its JUST-FILED record to the inventory collection via
  // the existing idempotent rcptInvAdd (two-way link, dedup, cat "tool"). Runs before save() so it persists together.
  let invAdded = 0;
  if (typeof rcptInvAdd === "function") {
    RCPT_SPLIT.rows.forEach((r, i) => {
      if (r.bucket === "business" && r.toInv && res.newLocs[i]) {
        const ir = rcptInvAdd(res.newLocs[i]);
        if (ir && ir.ok) { if (ir.created) invAdded++; if (typeof logChange === "function") logChange(ir.created ? "create" : "update", "inventory", ir.item.id, (ir.created ? "Added to inventory from receipt line: " : "Already in inventory: ") + ir.item.name); }
      }
    });
  }
  if (typeof logChange === "function") logChange("update", "expense", res.newLocs[0].recId, "Receipt split into " + allocations.length + " part" + (allocations.length > 1 ? "s" : "") + " — " + rcptSplitMoney(RCPT_SPLIT.total) + (vendor ? " · " + vendor : "") + (invAdded ? " · " + invAdded + " → inventory" : ""));
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  RCPT_EDIT = null; RCPT_SPLIT = null;
  if (typeof render === "function") render();
};

if (typeof module !== "undefined" && module.exports) { module.exports = { rcptApplySplit: rcptApplySplit, rcptRouteNew: rcptRouteNew, rcptSplitFields: rcptSplitFields, rcptSplitSeedRows: rcptSplitSeedRows, rcptSplitClampBucket: rcptSplitClampBucket, rcptSplitDetectTax: rcptSplitDetectTax, rcptSplitDistributeTax: rcptSplitDistributeTax, rcptSplitDistributeAdjust: rcptSplitDistributeAdjust }; }
