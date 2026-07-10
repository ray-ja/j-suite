/* ---------- RECEIPTS — click-to-edit + billing RE-BUCKETING (owner/admin) ----------
   Clicking any receipt row (js/72 table) opens this editor. Saving UPDATES THE RECORD IN PLACE — it is never
   deleted-and-remade (the owner's exact complaint). Changing a receipt's TYPE / JOB moves it to the correct
   BILLING bucket so job cost + customer invoicing update, PRESERVING the record id + photo:

     type "pass-through" + job  → job.materials[]   (billed to that job's customer — feeds js/52 P&L + js/46 invoicing)
     type "job-expense"  + job  → job.expenses[]    (a job cost; reimbursed to the uploader if paidBy set)
     type "business"            → this org's expenses[] (a plain business expense; feeds Finance)
     unassigned / "review"      → the receipts[] collection (needs-review queue)

   rcptApplyEdit is the pure data operation (no DOM) — unit-tested in receipts-tests.js. The DOM handler
   rcptSaveEdit reads the modal, guards against rapid double-submit, and calls it. Cap's `suggested`
   categorization is surfaced here as a one-tap "Use Cap's guess" that fills the form — the owner still has to
   Save, so Cap NEVER auto-applies (pending owner approval). */

/* ---- locate a receipt record in whichever array it currently lives ---- */
function rcptFindRecord(store, jobId, id) {
  const d = D();
  if (store === "review") return (d.receipts || []).find(x => x && x.id === id && !x.deleted) || null;
  if (store === "biz") return (d.expenses || []).find(x => x && x.id === id && !x.deleted) || null;
  const j = (d.jobs || []).find(x => x && x.id === jobId); if (!j) return null;
  const arr = store === "jobmat" ? (j.materials || []) : (j.expenses || []);
  return arr.find(x => x && x.id === id && !x.deleted) || null;
}
/* which array a receipt belongs in, given the desired type + job */
function rcptTargetHome(fields) {
  const type = fields.type;
  if (type === "pass-through" && fields.jobId) return { store: "jobmat", jobId: fields.jobId };
  if (type === "job-expense" && fields.jobId) return { store: "jobexp", jobId: fields.jobId };
  if (type === "business") return { store: "biz", jobId: null };
  return { store: "review", jobId: fields.jobId || null };   // incomplete (no job for a job type, or explicitly unassigned) → stays in review
}
function rcptTouchHome(home, rec) {
  if (home.store === "jobmat" || home.store === "jobexp") { const j = (D().jobs || []).find(x => x && x.id === home.jobId); if (j && typeof touch === "function") touch(j); }
  else if (typeof touch === "function") touch(rec);   // review + biz are per-record synced collections
}
function rcptPushHome(home, rec) {
  const d = D();
  if (home.store === "review") { if (!Array.isArray(d.receipts)) d.receipts = []; d.receipts.push(rec); if (typeof touch === "function") touch(rec); }
  else if (home.store === "biz") { if (!Array.isArray(d.expenses)) d.expenses = []; d.expenses.push(rec); if (typeof touch === "function") touch(rec); }
  else { const j = (d.jobs || []).find(x => x && x.id === home.jobId); if (j) { const key = home.store === "jobmat" ? "materials" : "expenses"; if (!Array.isArray(j[key])) j[key] = []; j[key].push(rec); if (typeof touch === "function") touch(j); } }
}
/* build the record in the SHAPE its home expects, preserving id + carried-over fields */
function rcptBuildRecord(home, id, fields, carry) {
  const by = carry.by || ((typeof curUser === "function" && curUser()) ? curUser().username : "");
  const amount = (fields.amount == null || fields.amount === "") ? null : (+fields.amount || 0);
  // attributedTo = whose receipt it is (shows on their crew tab): explicit choice wins, else the reimbursement
  // payee, else the preserved value, else the uploader.
  const attributedTo = fields.attributedTo || fields.paidBy || carry.attributedTo || carry.uploadedBy || "";
  // CARD LAST-4 (js/94 auto-attribution): the receipt's card last-4, captured optionally in the edit modal.
  // Purely additive on ALL homes — carried through a type/job/split change (form value wins when the key is
  // present, even ""; else preserved from the original like capRead). Only a valid 4-digit string is stored.
  const rawCard4 = (fields.cardLast4 != null) ? String(fields.cardLast4).replace(/\D/g, "").slice(-4) : (carry.cardLast4 || "");
  const card4 = /^\d{4}$/.test(rawCard4) ? rawCard4 : "";
  // REF / ORDER # (js/72 "Ref #" column): the receipt's primary reference — order/contract/invoice/transaction/rental #.
  // Purely additive on ALL homes (like cardLast4) — carried through a type/job/split change (form value wins when the
  // key is present, even ""; else preserved). Keeps letters + dash/space (INV-2024-118, 186510); clamped ≤40 chars.
  const refNo = (fields.refNo != null) ? String(fields.refNo).replace(/[^A-Za-z0-9 -]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : (carry.refNo || "");
  // refType (optional) LABELS the ref for the tooltip ("Contract #186510"). No form input — flows from Cap's suggestion
  // on apply, else preserved. Only a known kind is stamped; blank/unknown = omitted (the cell falls back to "Ref #").
  const rt = (fields.refType != null) ? String(fields.refType) : (carry.refType || "");
  const refType = (["contract", "order", "invoice", "transaction", "rental"].indexOf(rt) >= 0) ? rt : "";
  const base = { id: id, amount: amount, vendor: fields.vendor || "", desc: fields.desc || "", receiptId: fields.receiptId || null, paidBy: fields.paidBy || null, attributedTo: attributedTo, by: by, ts: carry.ts || now() };
  if (carry.reimbursedAt) base.reimbursedAt = carry.reimbursedAt;
  if (carry.capRead) base.capRead = carry.capRead;
  if (card4) base.cardLast4 = card4;
  if (refNo) base.refNo = refNo;
  if (refType) base.refType = refType;
  // SPLIT: when one receipt is split into N flat-dollar slices, every slice carries the same splitGroup id (uid,
  // set only when N>1 by js/92 rcptApplySplit) so the table can group them back under one receipt. Purely
  // additive on ALL homes — old records lack it, no migration, no fingerprint reads it. (js/92-receipt-split.js)
  if (fields.splitGroup) base.splitGroup = fields.splitGroup;
  // RENTAL DEPOSIT / REFUND (js/96 HOLD-OUT): additive flags — isDeposit (a refundable rental deposit), depositSettled
  // (the owner has reconciled it), refundOfId (the deposit id a refund offsets), kind ("refund" = a negative credit).
  // Form value wins when the key is present in `fields`; else preserved from `carry` (exactly like cardLast4). Only
  // truthy values are stamped (absent = today's behavior); an explicit false/"" clears a stale flag (rcptApplyEdit).
  var dep = {};
  if (fields.isDeposit != null) { if (fields.isDeposit) dep.isDeposit = true; } else if (carry.isDeposit) dep.isDeposit = true;
  if (fields.depositSettled != null) { if (fields.depositSettled) dep.depositSettled = true; } else if (carry.depositSettled) dep.depositSettled = true;
  if (fields.refundOfId != null) { if (fields.refundOfId) dep.refundOfId = fields.refundOfId; } else if (carry.refundOfId) dep.refundOfId = carry.refundOfId;
  if (fields.kind != null) { if (fields.kind) dep.kind = fields.kind; } else if (carry.kind) dep.kind = carry.kind;
  Object.assign(base, dep);
  // job expense carries its receipt CATEGORY so the 3-way split works (a tools/equipment receipt → excluded from
  // the job's cost as business overhead; anything else = a plain job cost). Default "job" when the receipt was uncategorized.
  if (home.store === "jobexp") { base.faultMemberId = carry.faultMemberId || null; base.category = fields.category || "job"; return base; }
  if (home.store === "jobmat") { return base; }
  if (home.store === "biz") { return Object.assign(base, { category: fields.category || "", note: fields.desc || "", date: fields.date || (typeof today === "function" ? today() : ""), memberId: fields.paidBy || "", deleted: false, updatedAt: now() }); }
  // review
  const rev = { id: id, receiptId: fields.receiptId || null, amount: amount, vendor: fields.vendor || "", date: fields.date || "", type: fields.type || null, jobId: fields.jobId || null, category: fields.category || "", paidBy: fields.paidBy || null, attributedTo: attributedTo, desc: fields.desc || "", uploadedBy: carry.uploadedBy || "", by: by, status: "review", suggested: carry.suggested || null, ts: carry.ts || now(), deleted: false, updatedAt: now() };
  if (card4) rev.cardLast4 = card4;
  if (refNo) rev.refNo = refNo;
  if (refType) rev.refType = refType;
  Object.assign(rev, dep);
  return rev;
}
/* THE PURE RE-BUCKETING OP. loc={store,jobId,recId}; fields={type,jobId,amount,vendor,date,category,paidBy,desc,receiptId}.
   Same home → mutate in place (id kept, zero churn). Different home → tombstone old + create SAME-id record in
   the new array (preserves id + photo, moves the billing). Returns {ok,newLoc} or {ok:false,error}. */
function rcptApplyEdit(loc, fields, opts) {
  const cur = rcptFindRecord(loc.store, loc.jobId, loc.recId || loc.id);
  if (!cur) return { ok: false, error: "record not found" };
  // keepReview: a plain SAVE on a Needs-review receipt stores the fields (type/job/paidBy included) IN PLACE and
  // does NOT route it out — filing is a separate, explicit step. Force the home to stay 'review'.
  const home = (opts && opts.keepReview) ? { store: "review", jobId: null } : rcptTargetHome(fields);
  const carry = { ts: cur.ts, uploadedBy: cur.uploadedBy, attributedTo: cur.attributedTo, reimbursedAt: cur.reimbursedAt, capRead: cur.capRead, faultMemberId: cur.faultMemberId, suggested: cur.suggested, by: cur.by, cardLast4: cur.cardLast4, isDeposit: cur.isDeposit, depositSettled: cur.depositSettled, refundOfId: cur.refundOfId, kind: cur.kind, refNo: cur.refNo, refType: cur.refType };
  if ((cur.paidBy || null) !== (fields.paidBy || null)) carry.reimbursedAt = undefined;   // payer changed → the old reimbursement settlement no longer applies
  const sameHome = (loc.store === home.store) && (!(loc.store === "jobmat" || loc.store === "jobexp") || loc.jobId === home.jobId);
  if (sameHome) {
    const rebuilt = rcptBuildRecord(home, cur.id, fields, carry);
    Object.assign(cur, rebuilt);
    if (carry.reimbursedAt === undefined && "reimbursedAt" in cur) delete cur.reimbursedAt;
    if ((fields.cardLast4 != null) && !("cardLast4" in rebuilt) && ("cardLast4" in cur)) delete cur.cardLast4;   // the form explicitly cleared the card last-4 → drop the stale value (Object.assign wouldn't remove it)
    if ((fields.refNo != null) && !("refNo" in rebuilt) && ("refNo" in cur)) delete cur.refNo;   // the form explicitly cleared the ref/order # → drop the stale value
    ["isDeposit", "depositSettled", "refundOfId", "kind"].forEach(function (k) { if ((k in fields) && !fields[k] && !(k in rebuilt) && (k in cur)) delete cur[k]; });   // an explicit false/"" in the form clears a stale deposit/refund flag
    rcptTouchHome(home, cur);
    return { ok: true, newLoc: { store: home.store, jobId: home.jobId, recId: cur.id } };
  }
  cur.deleted = true; rcptTouchHome(loc, cur);   // tombstone in the OLD array (syncs the removal)
  const rec = rcptBuildRecord(home, loc.recId || cur.id, fields, carry);
  rcptPushHome(home, rec);
  return { ok: true, newLoc: { store: home.store, jobId: home.jobId, recId: rec.id } };
}

/* ============================== ➕ ADD TO INVENTORY (tool receipt → asset) ==============================
   A purchased durable TOOL on a receipt can become a first-class Inventory asset. ONE-TAP SUGGESTION only —
   never automatic: the owner/admin taps "➕ Add to inventory" on a tools/equipment receipt to track it. Writes
   the existing (already-synced) `inventory` collection + two additive link fields — receipt.inventoryItemId and
   the item's fromReceiptId — so re-opening shows "🧰 In inventory ✓" and a second tap can never double-add.
   Billing arrays + fingerprints are untouched (link fields are additive, read by nothing in the money math). */

/* the live (non-deleted) inventory item a receipt is linked to, or null. DOM-free + safe when there's no store. */
function rcptInvItem(id) {
  if (!id) return null;
  const d = (typeof D === "function") ? D() : null;
  if (!d || !Array.isArray(d.inventory)) return null;
  return d.inventory.find(x => x && x.id === id && !x.deleted) || null;
}
/* should the "➕ Add to inventory" suggestion show for this receipt? A durable tools/equipment asset, owner/admin,
   and NOT already linked to a live inventory item (else we show the linked "🧰 In inventory ✓" state instead).
   Pure + testable — tools/equipment ONLY (materials/disposal/fuel/subscriptions/meals stay pure expenses). */
function rcptCanAddToInventory(rec) {
  if (!rec) return false;
  if (typeof rcptFinFull === "function" && !rcptFinFull()) return false;   // owner/admin gate
  if ((rec.category || "") !== "tools/equipment") return false;            // durable tools/equipment only
  if (rcptInvItem(rec.inventoryItemId)) return false;                      // already linked → linked state wins
  return true;
}
/* PURE data op: create an `inventory` item from a receipt record + two-way link them. Matches the shape invSave
   (js/31) produces for a hand-added item (cat "tool", have true, qty "1", string price, tags []). IDEMPOTENT —
   if the receipt already resolves to a LIVE inventory item it returns that item without creating a duplicate
   (created:false), so a second tap is a no-op. Returns {ok, item, created} or {ok:false,error}. */
function rcptInvAdd(loc) {
  const rec = rcptFindRecord(loc.store, loc.jobId, loc.recId || loc.id);
  if (!rec) return { ok: false, error: "record not found" };
  const existing = rcptInvItem(rec.inventoryItemId);
  if (existing) return { ok: true, item: existing, created: false };   // dedup — never double-add
  const d = D(); if (!Array.isArray(d.inventory)) d.inventory = [];
  const dt = (typeof rcptDate === "function" ? rcptDate(rec) : (rec.date || "")) || (typeof today === "function" ? today() : "");
  const name = String(rec.desc || rec.note || rec.vendor || "Tool").slice(0, 120);
  const price = (rec.amount != null && rec.amount !== "") ? ("$" + (Math.round((+rec.amount || 0) * 100) / 100).toFixed(2)) : "";
  const notes = "From receipt" + (rec.vendor ? " · " + rec.vendor : "") + (dt ? " · " + dt : "");
  const item = {
    id: "inv-c-" + ((typeof uid === "function") ? uid() : String(Date.now())),
    name: name, cat: "tool", have: true, qty: "1", price: price, brand: "", tags: [], section: "",
    notes: notes, fromReceiptId: rec.id, purchasedAt: dt, updatedAt: (typeof now === "function" ? now() : Date.now())
  };
  d.inventory.push(item);
  if (typeof touch === "function") touch(item);
  rec.inventoryItemId = item.id;                 // two-way link (additive) — synced via the receipt's own home
  if (typeof rcptTouchHome === "function") rcptTouchHome(loc, rec);
  return { ok: true, item: item, created: true };
}
/* the in-modal block: the "➕ Add to inventory" suggestion on a tool receipt, OR the linked "🧰 In inventory ✓"
   chip (tap → openInvItem) once linked. Returns "" for a non-tool receipt (no clutter). */
function rcptInvBlockHTML(rec) {
  const linked = rcptInvItem(rec.inventoryItemId);
  if (linked) {
    return `<div style="margin-top:12px"><button class="btn ghost" style="width:100%;border-color:#1b7f4d;color:#1b7f4d" onclick="if(typeof openInvItem==='function')openInvItem('${esc(linked.id)}')">🧰 In inventory ✓ — ${esc(linked.name || "item")} ›</button></div>`;
  }
  if (rcptCanAddToInventory(rec)) {
    return `<div style="margin-top:12px"><button class="btn ghost" style="width:100%;border-color:#1b7f4d;color:#1b7f4d" onclick="rcptAddToInventory()">➕ Add to inventory <span class="sub" style="color:var(--muted)">· track this tool as an asset</span></button></div>`;
  }
  return "";
}
/* ONE-TAP handler — create the asset, link it, save, then re-open the editor so it flips to the linked state
   (and re-render behind so the receipts table's 🧰 chip updates). Owner/admin only. Never auto-fires. */
window.rcptAddToInventory = function () {
  if (!rcptFinFull() || !RCPT_EDIT) return;
  const res = rcptInvAdd(RCPT_EDIT.loc);
  if (!res || !res.ok) { alert("Couldn't add to inventory: " + ((res && res.error) || "unknown")); return; }
  if (typeof logChange === "function") logChange(res.created ? "create" : "update", "inventory", res.item.id, (res.created ? "Added to inventory from receipt: " : "Already in inventory: ") + res.item.name);
  if (typeof save === "function") save();
  const loc = RCPT_EDIT.loc;
  if (typeof render === "function") render();
  rcptEditOpen(loc.store, loc.jobId, loc.recId);   // re-open → shows "🧰 In inventory ✓" instead of the button
};

/* ============================== EDIT MODAL ============================== */
let RCPT_EDIT = null;   // {loc:{store,jobId,recId}, receiptId, suggested}
window.rcptEditOpen = function (store, jobId, recId) {
  if (!rcptFinFull()) return;
  const rec = rcptFindRecord(store, jobId, recId);
  if (!rec) { alert("That receipt isn't here anymore — it may have been moved. Refreshing."); render(); return; }
  const meta = rcptRowMeta(Object.assign({}, rec, { store: store, jobId: jobId }));
  RCPT_EDIT = { loc: { store: store, jobId: jobId, recId: recId }, receiptId: rec.receiptId || null, suggested: rec.suggested || null };
  const curType = meta.type;   // review | business | job-expense | pass-through
  const jobs = rcptJobs(), members = rcptMembers();
  const jobSel = jobId || rec.jobId || "";
  const base = (typeof jsUploadUrl === "function") ? jsUploadUrl(rec.receiptId) : "";

  // ── PRE-FILL FROM CAP'S GUESS (DISPLAY DEFAULT ONLY — the record's OWN value ALWAYS wins) ──────────────
  // A receipt Cap READ (has `suggested`) but whose record fields are still blank — e.g. it was restored / synced
  // back AFTER the auto-file pass, so it carries `suggested` yet blank fields and sits in review — used to open
  // BLANK. A plain Save then read type="" → rcptTargetHome → straight back into "Needs review" (the dead-end the
  // owner keeps hitting). We now DEFAULT each blank input to Cap's guess, so opening shows the guess IN THE FORM
  // and a normal Save FILES it. This never mutates `rec`: the actual file still routes through rcptApplyEdit
  // (rcptSaveEdit) → byte-identical. A field the record already has set is untouched (never overwrite a human
  // edit). Refund/deposit are NOT pre-filled (confirmation-only) — only their hint is surfaced (after render).
  const sg = RCPT_EDIT.suggested || {};
  const _iso = (typeof _rcptIsoDate === "function") ? _rcptIsoDate : (v => /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? "" : v).slice(0, 10)) ? String(v).slice(0, 10) : "");
  const preAmount = (rec.amount != null && rec.amount !== "") ? rec.amount : ((sg.amount != null && sg.amount !== "") ? sg.amount : null);
  const preVendor = (rec.vendor && String(rec.vendor).trim()) ? rec.vendor : (sg.vendor || "");
  const preDesc = (rec.desc || rec.note) ? (rec.desc || rec.note) : (sg.desc || "");
  const preCat = rec.category ? rec.category : (sg.category || "");
  const preDate = _iso(rec.date) || _iso((rec.capRead || {}).date) || _iso(sg.date) || rcptDate(rec);   // real ISO wins; a Cap "unknown" can't win (guarded), else the existing ts fallback
  const preCard4 = (/^\d{4}$/.test(String(rec.cardLast4 || ""))) ? rec.cardLast4 : ((/^\d{4}$/.test(String(sg.last4 || ""))) ? sg.last4 : (rec.cardLast4 || ""));
  // REF / ORDER # — the record's own ref wins; a blank record inherits Cap's read (sg.refNo) so opening + Save keeps it.
  const preRefNo = (rec.refNo && String(rec.refNo).trim()) ? rec.refNo : (sg.refNo || "");
  // TYPE — the record's own type wins; a blank review row inherits Cap's REAL filed type (business/job-expense/
  // pass-through) so rcptEditTypeChange shows the "Assign to job" field and a plain Save files it out of review.
  let preType = curType;
  if (curType === "review" && !rec.type && (sg.type === "business" || sg.type === "job-expense" || sg.type === "pass-through")) preType = sg.type;
  // JOB — only inherit Cap's job when it's a REAL job that exists (a Cap "unknown"/unmatched id never wins) and
  // the record has no job of its own — so a pass-through/job-expense guess pre-selects the job the owner can Save.
  let preJob = jobSel;
  if (!preJob && sg.jobId && jobs.some(j => j && j.id === sg.jobId)) preJob = sg.jobId;

  const typeOpts = [["", "🕓 Needs review (unassigned)"], ["business", "🏢 Business expense"], ["job-expense", "💵 Job expense — reimbursed to uploader"], ["pass-through", "🧱 Pass-through material — billed to customer"]]
    .map(([v, l]) => `<option value="${v}" ${preType === (v || "review") ? "selected" : ""}>${l}</option>`).join("");
  const jobOpts = `<option value="">— pick a job —</option>` + jobs.map(j => `<option value="${esc(j.id)}" ${preJob === j.id ? "selected" : ""}>${(typeof jobPO === "function" && jobPO(j)) ? esc(jobPO(j)) + " · " : ""}${esc(j.title || "Job")}${j.customerId && typeof custName === "function" ? " · " + esc(custName(j.customerId)) : ""}${j.date ? " · " + fmtDate(j.date) : ""}</option>`).join("");
  const catOpts = `<option value="">— category —</option>` + RCPT_CATS.map(c => `<option ${preCat === c ? "selected" : ""}>${c}</option>`).join("");
  const paidOpts = `<option value="">💳 Business card (no reimburse)</option>` + members.map(u => `<option value="${esc(u.id)}" ${rec.paidBy === u.id ? "selected" : ""}>${esc(u.username)} — personal card (reimburse)</option>`).join("");
  // "For" default: the PERSONAL-card payer wins (they get reimbursed → the receipt is theirs), so opening + Save
  // aligns attributedTo to paidBy. Only when nobody paid personally (business card) do we fall back to the record's
  // own attributedTo, then the uploader. The select stays editable — the owner can still pick someone else.
  const attrCur = rec.paidBy || rec.attributedTo || rec.uploadedBy || "";
  const attrOpts = `<option value="">— nobody in particular —</option>` + members.map(u => `<option value="${esc(u.id)}" ${attrCur === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("");

  let sugg = "";
  if (RCPT_EDIT.suggested) {
    const s = RCPT_EDIT.suggested;
    sugg = `<div id="rcpt_suggbanner" class="card" style="background:#6b3fa0;color:#fff;padding:10px;margin-bottom:8px"><div style="font-weight:700">🤖 Cap suggests${s.confidence != null ? ` (${Math.round(s.confidence * 100)}% sure)` : ""}</div><div class="sub" style="color:#fff;opacity:.9;white-space:normal">${[s.vendor, s.amount != null ? money(s.amount) : "", s.type ? (RCPT_TYPE_LABEL[s.type] || s.type) : "", s.category].filter(Boolean).map(esc).join(" · ")}</div><button class="btn sm" style="margin-top:8px;background:#fff;color:#6b3fa0" onclick="rcptApplySuggestion()">Use Cap's guess</button> <span class="sub" style="color:#fff;opacity:.8">— review, then ✓ File it</span></div>`;
  }
  // 🔗 DEPOSIT-SETTLEMENT match (js/72) — this rental cost looks like the settlement of an open deposit. One tap
  // settles it through the js/96 machinery (net + absorb the duplicate). Suggestion-only until tapped; owner/admin.
  let depSugg = "";
  if (typeof rcptDepositMatch === "function") {
    const dm = rcptDepositMatch(Object.assign({}, rec, { jobId: rec.jobId != null ? rec.jobId : (jobId || null) }));
    if (dm && dm.deposit) {
      const dvend = rec.vendor || (rec.suggested && rec.suggested.vendor) || dm.deposit.vendor || "";
      depSugg = `<div class="card" style="border-left:4px solid #6b3fa0;margin-bottom:8px"><div style="font-weight:700;color:#6b3fa0;white-space:normal">🔗 Looks like the settlement of your ${money(dm.deposit.amount)}${dvend ? " " + esc(dvend) : ""} deposit</div><div class="sub" style="white-space:normal">Cap read the rental at ${money(dm.net)}, so about ${money(dm.impliedRefund)} came back. Settling nets the deposit to ${money(dm.net)} and absorbs this receipt so it isn't counted twice.</div><button class="btn sm" style="margin-top:8px;background:#6b3fa0;border-color:#6b3fa0;color:#fff" onclick="rcptSettleDepFromRcpt('${store}','${jobId || ""}','${recId}','${esc(dm.deposit.id)}')">🔗 Settle from this receipt</button></div>`;
    }
  }
  sugg = depSugg + sugg;

  modal("Edit receipt", `
    ${sugg}
    <div class="row" style="gap:10px;align-items:flex-start">
      <a href="${base}" target="_blank" rel="noopener" style="flex:0 0 auto"><img id="rcpt_photoimg" src="${base}" style="width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:var(--soft)" onerror="this.style.display='none'"></a>
      <div class="grow"><input type="file" id="rcpt_photo" accept="image/*,application/pdf,.pdf" style="display:none" onchange="rcptReplacePhoto(this)"><button class="btn ghost sm" style="width:100%" onclick="document.getElementById('rcpt_photo').click()"><span id="rcpt_photolbl">🔄 Replace photo</span></button>
      ${(rec.receiptId && !/\.pdf$/i.test(rec.receiptId) && typeof capRcptOne === "function" && (typeof rcptFinFull !== "function" || rcptFinFull())) ? `<button class="btn ghost sm" id="cap_rcpt_one_btn" style="width:100%;margin-top:6px;color:#6b3fa0" onclick="capRcptOne()">🤖 Reread — try harder (smartest model)</button>` : ""}
      <div class="sub" style="margin-top:6px;white-space:normal">Tap the photo to view it full size.</div>
      ${(!rec.receiptId && rec.csvFile) ? `<a href="${(typeof jsUploadUrl === "function") ? jsUploadUrl(rec.csvFile) : ""}" target="_blank" rel="noopener" class="sub" style="display:inline-block;margin-top:4px;color:var(--accent)">📄 View source CSV${rec.csvName ? " (" + esc(rec.csvName) + ")" : ""}</a>` : ""}</div>
    </div>
    <!-- ESSENTIALS (always shown): Amount · Vendor · Job. The rest lives under "More options" (js/98 collapse). -->
    <label style="margin-top:10px">Amount ($)</label><input id="rcpt_amt" type="number" inputmode="decimal" value="${preAmount != null ? esc(preAmount) : ""}" placeholder="0.00">
    <label>Vendor / where bought</label><input id="rcpt_vendor" value="${esc(preVendor)}" placeholder="Home Depot, dump, gas…">
    <div id="rcpt_jobwrap" style="display:none"><label>Assign to job</label><select id="rcpt_job" onchange="rcptJobPONote()">${jobOpts}</select>
      <label>PO / job code <span class="sub">(type or paste the P#### off the receipt to auto-pick its job)</span></label><input id="rcpt_po" type="text" placeholder="P1042" value="" oninput="rcptPoBind()" onblur="rcptPoBind()">
      <div id="rcpt_po_note" class="sub" style="margin-top:4px"></div></div>
    <details id="rcpt_more" open style="margin-top:12px"><summary style="cursor:pointer;padding:6px 0;color:var(--muted);font-size:14px;user-select:none">More options ▾</summary>
    <label>Date</label><input id="rcpt_date" type="date" value="${esc(preDate)}">
    <label>What was it</label><input id="rcpt_desc" value="${esc(preDesc)}" placeholder="pavers, dump fee, fuel…">
    <label>Type</label><select id="rcpt_type" onchange="rcptEditTypeChange()">${typeOpts}</select>
    <label>Category</label><select id="rcpt_cat">${catOpts}</select>
    <label>Who paid?</label><select id="rcpt_paidby" onchange="rcptPaidByCouple()">${paidOpts}</select>
    <label>Card ••••<span class="sub">(last 4 — auto-matches who paid)</span></label><input id="rcpt_card4" type="text" inputmode="numeric" maxlength="4" value="${esc(preCard4)}" placeholder="1234" oninput="if(typeof cardMatchRefresh==='function')cardMatchRefresh()">
    <div id="rcpt_card_slot"></div>
    <label>Ref / Order # <span class="sub">(order / contract / invoice / transaction #)</span></label><input id="rcpt_refno" type="text" maxlength="40" value="${esc(preRefNo)}" placeholder="186510, INV-2024-118…">
    <label>Whose receipt / For <span class="sub">(auto-follows who paid — shows on their tab so they don't re-upload it)</span></label><select id="rcpt_attr">${attrOpts}</select>
    <label class="li" style="cursor:pointer;margin-top:10px"><input type="checkbox" id="rcpt_deposit" ${rec.isDeposit ? "checked" : ""} style="width:20px;height:20px;flex:0 0 auto"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">⚠ Rental deposit (refund may come back)</div><div class="sub" style="white-space:normal">A refundable equipment-rental hold. HELD out of the job's cost ($0) until you confirm the refund — then it counts at net (deposit − refund).</div></div></label>
    <div id="rcpt_deposit_hint"></div>
    <label class="li" style="cursor:pointer;margin-top:6px"><input type="checkbox" id="rcpt_refund" ${rec.kind === "refund" ? "checked" : ""} style="width:20px;height:20px;flex:0 0 auto"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">↩ This is a refund / credit (money coming back)</div><div class="sub" style="white-space:normal">Stores the amount as NEGATIVE so it offsets the matching charge/deposit. Enter the refund amount above as a plain number.</div></div></label>
    <div id="rcpt_refund_hint"></div>
    <div id="rcpt_split_slot"></div>
    </details>
    ${rcptInvBlockHTML(rec)}
    <div id="rcpt_edit_actions" class="row" style="gap:8px;margin-top:14px"><button class="btn ghost grow" style="color:var(--danger)" onclick="rcptDelRow('${store}','${jobId || ""}','${recId}')">🗑 Delete</button><button class="btn ${store === "review" ? "ghost" : "acc"} grow" onclick="rcptSaveEdit()" title="${store === "review" ? "Save your edits — stays in Needs review" : "Save"}">✓ Save</button>${store === "review" ? `<button class="btn acc grow" onclick="rcptFileEdit()" title="File it — moves it to Owed / Filed">✓ File it</button>` : ""}</div>
    ${rcptEditDupActionsHTML({ store: store, jobId: jobId, recId: recId })}`);
  rcptEditTypeChange();   // the pre-filled type (if any) makes the "Assign to job" field visible for a job type
  // CONFIRMATION-ONLY refund/deposit (Ray): if Cap flagged a possible refund/rental-deposit, surface the SAME
  // hint the "Use Cap's guess" tap shows but leave the boxes UNCHECKED — a misread must never negate an amount or
  // hold money out of a job's cost. The flag is set only when the owner ticks it + Saves (rcptSaveEdit).
  try {
    const _hint = (id, msg) => { const el = document.getElementById(id); if (el && msg) el.innerHTML = `<div class="sub" style="color:#6b3fa0;font-weight:600;white-space:normal;margin:2px 0 4px">🤖 ${esc(msg)}</div>`; };
    if (sg.refund && !rec.kind) _hint("rcpt_refund_hint", "Cap thinks this may be a refund — tick “↩ This is a refund” to confirm (left unchecked).");
    if (sg.deposit && !rec.isDeposit) _hint("rcpt_deposit_hint", "Cap thinks this may be a rental deposit — tick “⚠ Rental deposit” to confirm (left unchecked).");
  } catch (_e) {}
  if (typeof rcptJobPONote === "function") rcptJobPONote();   // js/95: show the pre-selected job's PO code
  if (typeof rcptSplitInit === "function") rcptSplitInit(rec);   // js/92: mounts the "🔀 Split this receipt" control into #rcpt_split_slot
  if (typeof cardMatchInit === "function") cardMatchInit(rec);   // js/94: match the card last-4 → pre-select "Who paid?" (default only, never writes)
  // SMART DEFAULTS (js/98) — prefill BLANK fields only from context (clocked-in job, your card, per-vendor
  // memory). NEVER clobbers an existing value or an un-applied Cap suggestion (only truly-empty inputs). Then
  // re-run type visibility (jobwrap) + the card match so the defaulted type/card take effect.
  try {
    if (typeof rcptSmartDefaults === "function") {
      const _me = (typeof curUser === "function" && curUser()) ? curUser() : null;
      const _sd = rcptSmartDefaults({ vendor: rec.vendor, meId: _me ? _me.id : "" });
      const _setBlank = (id, v) => { const el = document.getElementById(id); if (el && v && !String(el.value || "").trim()) { el.value = v; return true; } return false; };
      const _jobSet = _setBlank("rcpt_job", _sd.jobId);
      _setBlank("rcpt_type", _sd.type);
      _setBlank("rcpt_cat", _sd.category);
      const _cardSet = _setBlank("rcpt_card4", _sd.cardLast4);
      rcptEditTypeChange();   // jobwrap visibility tracks the defaulted type
      if (_jobSet && typeof rcptJobPONote === "function") rcptJobPONote();
      if (_cardSet && typeof cardMatchRefresh === "function") cardMatchRefresh();   // defaulted card → pre-select "Who paid?"
    }
  } catch (_e) {}
};
window.rcptEditTypeChange = function () {
  const t = val("rcpt_type"); const wrap = document.getElementById("rcpt_jobwrap");
  if (wrap) wrap.style.display = (t === "job-expense" || t === "pass-through") ? "block" : "none";
};
/* "For" FOLLOWS "Who paid?" — whoever paid with their PERSONAL card IS who the receipt is for (they get
   reimbursed). When "Who paid?" is set to a PERSON, push that person into the "For" (attributedTo) select so the
   two never disagree. When it's cleared to "" (business card, nobody to reimburse) we DON'T force "For" — the
   owner's existing choice stands (never blank a deliberately-set attribution). The owner can still hand-pick a
   different "For" afterward if a rare case needs it. Coupling only ever PUSHES a person, never blanks. */
window.rcptPaidByCouple = function () {
  const p = val("rcpt_paidby");
  if (!p) return;                                   // business card / cleared → leave "For" as the owner set it
  const a = document.getElementById("rcpt_attr");
  if (a) a.value = p;                               // personal-card payer = who it's for
};
/* PER-JOB PO CODE (js/95) — AUTO-FILL the PO field from the currently-selected job (no button): picking a job
   (owner inline OR Cap's guess) stamps the job's own P#### into the PO input + the note. Purely display/UX — the
   receipt stores jobId (as today); the PO is derived from the job (jobPO(j)), so nothing new is persisted and the
   CSV PO→job matching (js/93/95) is untouched. Only fills when the job HAS a PO; never clobbers a code the owner
   is typing to LOOK UP a job (that path leaves rcpt_job empty → po "" → we leave the field alone). */
window.rcptJobPONote = function () {
  const note = document.getElementById("rcpt_po_note");
  const sel = val("rcpt_job");
  const j = (sel && typeof actJ === "function") ? actJ().find(x => x && x.id === sel) : null;
  const po = (j && typeof jobPO === "function") ? jobPO(j) : "";
  const poInput = document.getElementById("rcpt_po");
  if (poInput && po) poInput.value = po;   // AUTO-FILL: the picked job's PO follows into the field (Request 2)
  if (note) note.innerHTML = po ? ("PO for this job: <b>" + esc(po) + "</b>") : "";
};
/* Manual bind — Ray types/pastes a P#### code → jobByPO uniquely resolves it → pre-select the job picker. */
window.rcptPoBind = function () {
  const note = document.getElementById("rcpt_po_note"), raw = val("rcpt_po");
  const j = (typeof jobByPO === "function") ? jobByPO(raw) : null;
  if (j) {
    const sel = document.getElementById("rcpt_job"); if (sel) sel.value = j.id;
    if (note) note.innerHTML = "→ <b>" + esc((j.customerId && typeof custName === "function") ? custName(j.customerId) : (j.title || "Job")) + "</b> (" + esc(typeof jobPO === "function" ? jobPO(j) : "") + ")";
  } else if (String(raw || "").trim()) {
    if (note) note.innerHTML = `<span style="color:var(--muted)">No job matches that PO yet.</span>`;
  } else if (typeof rcptJobPONote === "function") { rcptJobPONote(); }
};
window.rcptApplySuggestion = function () {
  const s = RCPT_EDIT && RCPT_EDIT.suggested; if (!s) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== "") el.value = v; };
  set("rcpt_vendor", s.vendor); set("rcpt_amt", s.amount); set("rcpt_cat", s.category); set("rcpt_desc", s.desc); set("rcpt_refno", s.refNo);
  if (s.type) { const el = document.getElementById("rcpt_type"); if (el) { el.value = s.type; rcptEditTypeChange(); } }
  if (s.jobId) { set("rcpt_job", s.jobId); if (typeof rcptJobPONote === "function") rcptJobPONote(); }   // Cap assigns the job → its PO auto-fills too (Request 2)
  // Cap Phase 4 — card last-4 (js/94: auto-matches "Who paid?"), refund + rental-deposit toggles (js/96).
  // Only APPLY when present: a null last4 / false toggle leaves the owner's existing entry untouched.
  if (s.last4) { set("rcpt_card4", s.last4); if (typeof cardMatchRefresh === "function") cardMatchRefresh(); }   // auto-match paidBy from the card
  // REFUND / RENTAL-DEPOSIT are CONFIRMATION-ONLY (Ray): Cap may SUGGEST them, but "Use Cap's guess" must NEVER
  // TICK the box — a wrong "refund" read would flip the amount NEGATIVE, a wrong "deposit" would hold it out of
  // the job's cost. So instead of checking the box we SURFACE a highlighted hint next to it and leave it UNCHECKED;
  // the flag is set only when the owner ticks it + Saves (rcptSaveEdit). No category nudge either — that rides on tick.
  const hint = (id, msg) => { const el = document.getElementById(id); if (el) el.innerHTML = msg ? `<div class="sub" style="color:#6b3fa0;font-weight:600;white-space:normal;margin:2px 0 4px">🤖 ${esc(msg)}</div>` : ""; };
  hint("rcpt_refund_hint", s.refund ? "Cap thinks this may be a refund — tick “↩ This is a refund” to confirm (left unchecked)." : "");
  hint("rcpt_deposit_hint", s.deposit ? "Cap thinks this may be a rental deposit — tick “⚠ Rental deposit” to confirm (left unchecked)." : "");
  // Cap SPLIT SUGGESTION (js/92) — a MIXED receipt (≥2 buckets, e.g. materials + a reusable tool). OPEN the
  // split editor PRE-FILLED from Cap's balanced allocations for the owner to review + tap "Save splits".
  // Cap proposes, the owner confirms — this never auto-commits. <2 splits → the single-categorization above stands.
  let banner = "✓ Cap's guess applied — review the fields, then tap ✓ File it (or Save to keep editing).";
  if (s.splits && Array.isArray(s.splits) && s.splits.length >= 2 && typeof rcptSplitStartFromSuggestion === "function") {
    rcptSplitStartFromSuggestion(s.splits, s.jobId || "");
    banner = "✓ Cap split this into " + s.splits.length + " parts — review the amounts + jobs, then tap Save splits.";
  }
  const b = document.getElementById("rcpt_suggbanner"); if (b) b.innerHTML = `<span class="sub" style="color:#fff">${esc(banner)}</span>`;
};
window.rcptReplacePhoto = function (input) {
  const file = input && input.files && input.files[0]; if (!file) return;
  if (typeof jsUpload !== "function") { alert("Upload needs a connection."); return; }
  const lbl = document.getElementById("rcpt_photolbl"); if (lbl) lbl.textContent = "Uploading…";
  jsUpload(file).then(id => {
    if (RCPT_EDIT) RCPT_EDIT.receiptId = id;
    const img = document.getElementById("rcpt_photoimg"); const base = (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
    if (img && base) { img.src = base; img.style.display = ""; }
    if (lbl) lbl.textContent = "✓ New photo attached — Save to keep";
  }).catch(e => { alert("Upload failed: " + (e.message || e)); if (lbl) lbl.textContent = "🔄 Replace photo"; });
};
/* DUPLICATE ACTIONS in the editor. When the OPEN receipt is part of a detected duplicate group (rcptDupIndex —
   the SAME tolerant detection the page-level "⚠ possible duplicates" resolver uses), offer MERGE as the PRIMARY
   action (🔗 keep-the-best-of-each via the tested rcptMergeGroup, absorbing the other copy through rcptApplyEdit +
   the reversible rcptTombstone) and keep the plain "🔁 Mark as duplicate — delete this" as the SECONDARY option
   (for genuine junk). No detected duplicate → just the existing delete, unchanged. Owner/admin gated, confirm-first,
   reversible. NO new merge logic — reuses rcptDupIndex / rcptMergeGroup / rcptMergePreviewText. */
function rcptEditDupActionsHTML(loc) {
  const delBtn = `<button class="btn ghost" style="width:100%;margin-top:8px;color:var(--danger)" onclick="rcptEditMarkDup()">🔁 Mark as duplicate — delete this (other copy stays)</button>`;
  const grp = (typeof rcptDupIndex === "function" && loc && loc.recId != null) ? rcptDupIndex().byId[loc.recId] : null;
  if (!grp || grp.length < 2) return delBtn;   // no detected duplicate of THIS receipt → plain delete only (unchanged)
  const note = (typeof rcptMergePreviewText === "function") ? rcptMergePreviewText(grp) : "";
  const mergeBtn = `<button class="btn acc" style="width:100%;margin-top:8px" onclick="rcptEditMergeDup()">🔗 Merge with the duplicate — keep the best of each${grp.length > 2 ? " (" + grp.length + " copies)" : ""}</button>`
    + (note ? `<div class="sub" style="white-space:normal;margin-top:4px;color:var(--muted)">${esc(note)}</div>` : "");
  return mergeBtn + delBtn;   // MERGE primary, delete secondary
}
/* MERGE the open receipt with its detected duplicate(s) — the SAME merge the resolver runs (rcptMergeGroup keeps
   the best of each field via rcptMergeFields → rcptApplyEdit and absorbs the other copy via rcptTombstone). No
   forced survivor: rcptMergeGroup picks the best home (a filed copy wins → billing preserved). Owner/admin only,
   confirm-with-preview, reversible. Close + repaint after (the survivor may be a different id than the open one). */
window.rcptEditMergeDup = function () {
  if (!rcptFinFull() || !RCPT_EDIT) return;
  const grp = (typeof rcptDupIndex === "function") ? rcptDupIndex().byId[RCPT_EDIT.loc.recId] : null;
  if (!grp || grp.length < 2) { alert("No duplicate of this receipt anymore — refreshing."); if (typeof closeModal === "function") closeModal(); RCPT_EDIT = null; if (typeof render === "function") render(); return; }
  const preview = (typeof rcptMergePreviewText === "function") ? rcptMergePreviewText(grp) : "";
  if (!confirm("Merge these " + grp.length + " copies into one receipt?\n\n" + preview + "\n\n(An admin can undo.)")) return;
  const res = (typeof rcptMergeGroup === "function") ? rcptMergeGroup(grp) : null;
  if (!res || !res.ok) { alert("Couldn't merge these copies: " + ((res && res.error) || "unknown")); return; }
  if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Merged " + grp.length + " duplicate receipts into one — kept the best photo + line items + your categorization; removed " + res.absorbed + " absorbed cop" + (res.absorbed > 1 ? "ies" : "y"));
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  RCPT_EDIT = null;
  if (typeof render === "function") render();
};
/* MARK AS DUPLICATE — the catch-all for anything the auto-detector misses. Soft-deletes THIS receipt via the
   SAME existing path (rcptTombstone) the row/edit deletes use — for a filed receipt that removes it from its
   billing array so the double-charge drops; the other copy is untouched. Owner/admin only, confirm-first. */
window.rcptEditMarkDup = function () {
  if (!rcptFinFull() || !RCPT_EDIT) return;
  if (!confirm("Delete this as a duplicate? The other copy stays. This removes its charge from the books (an admin can undo).")) return;
  const loc = RCPT_EDIT.loc;
  if (typeof rcptTombstone === "function") rcptTombstone(loc.store, loc.jobId || null, loc.recId);
  if (typeof logChange === "function") logChange("delete", "expense", loc.recId, "Marked receipt as duplicate — deleted (other copy kept)");
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  RCPT_EDIT = null;
  if (typeof render === "function") render();
};
/* read the edit form → the fields object rcptApplyEdit consumes (+ raw values for validation). No DOM writes. */
function rcptReadEditForm() {
  const type = val("rcpt_type") || "";
  const jobId = (type === "job-expense" || type === "pass-through") ? (val("rcpt_job") || "") : "";
  const amtRaw = val("rcpt_amt");
  const amount = amtRaw === "" ? null : (parseFloat(amtRaw) || 0);
  const vendor = (val("rcpt_vendor") || "").trim();
  const date = val("rcpt_date") || "";
  const category = val("rcpt_cat") || "";
  const paidBy = val("rcpt_paidby") || "";
  const attributedTo = val("rcpt_attr") || "";
  const desc = (val("rcpt_desc") || "").trim();
  const cardLast4 = (val("rcpt_card4") || "").replace(/\D/g, "").slice(-4);   // js/94: 0-4 digits — "" clears it
  const refNo = (val("rcpt_refno") || "").replace(/[^A-Za-z0-9 -]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);   // js/72 "Ref #"
  const isDeposit = !!(document.getElementById("rcpt_deposit") || {}).checked;
  const isRefund = !!(document.getElementById("rcpt_refund") || {}).checked;
  let amt = amount;
  if (isRefund && amt != null) amt = -Math.abs(amt);   // refund = negative + kind:"refund"
  const cat = (isDeposit && !category) ? "rentals" : category;
  const fields = { type: type || null, jobId: jobId || null, amount: amt, vendor: vendor, date: date, category: cat, paidBy: paidBy || null, attributedTo: attributedTo || null, desc: desc, receiptId: RCPT_EDIT.receiptId || null, cardLast4: cardLast4, refNo: refNo, isDeposit: isDeposit, kind: isRefund ? "refund" : "" };
  return { fields: fields, type: type, jobId: jobId, amt: amt, vendor: vendor, isDeposit: isDeposit, isRefund: isRefund };
}
/* completeness gate — only needed to FILE a receipt (a draft Save may be incomplete). "" = OK, else the message. */
function rcptFileValidateForm(f) {
  if (!f.type) return "Pick a category first (materials / job expense / business) before filing this one.";
  if ((f.type === "job-expense" || f.type === "pass-through") && !f.jobId) return "Pick a job for this receipt — or set it to Business.";
  if (f.amt == null || f.amt === 0) return "Enter the amount before filing.";
  if (f.amt < 0 && !f.isRefund) return "A negative amount is only for a refund/credit — tick “↩ This is a refund”.";
  if (!f.vendor) return "Enter the vendor / where it was bought.";
  return "";
}
/* SAVE — Cap fills, you review. Saving a Needs-review receipt just SAVES your edits and it STAYS in Needs review
   (filing is the separate ✓ File it step). Editing an already-FILED receipt updates/re-buckets it in place. */
window.rcptSaveEdit = function () {
  if (!rcptFinFull() || !RCPT_EDIT) return;
  const f = rcptReadEditForm();
  if (typeof submitGuard === "function" && !submitGuard("rcptSaveEdit:" + RCPT_EDIT.loc.recId)) return;
  if (RCPT_EDIT.loc.store === "review") {
    const res = rcptApplyEdit(RCPT_EDIT.loc, f.fields, { keepReview: true });   // edits only — do NOT file
    if (!res || !res.ok) { alert("Couldn't save: " + ((res && res.error) || "unknown")); return; }
    if (typeof rcptStampReviewed === "function") rcptStampReviewed(res.newLoc);
    if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Receipt edited (Needs review)" + (f.vendor ? " · " + f.vendor : ""));
    if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); RCPT_EDIT = null; render(); return;
  }
  // already filed → keep it valid + update/re-bucket in place
  const err = rcptFileValidateForm(f); if (err) { alert(err); return; }
  const res = rcptApplyEdit(RCPT_EDIT.loc, f.fields);
  if (!res || !res.ok) { alert("Couldn't save: " + ((res && res.error) || "unknown")); return; }
  if (typeof rcptStampReviewed === "function") rcptStampReviewed(res.newLoc);
  if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Receipt updated — " + (f.amt != null ? money(f.amt) : "") + (f.vendor ? " · " + f.vendor : ""));
  if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); RCPT_EDIT = null; render();
};
/* FILE IT — the explicit "good to go" step: routes a Needs-review receipt to its home (→ 💸 Owed if a person
   fronted it on a personal card, else ✓ Filed). Requires the receipt to be complete. */
window.rcptFileEdit = function () {
  if (!rcptFinFull() || !RCPT_EDIT) return;
  const f = rcptReadEditForm();
  const err = rcptFileValidateForm(f); if (err) { alert(err); return; }
  if (typeof submitGuard === "function" && !submitGuard("rcptFileEdit:" + RCPT_EDIT.loc.recId)) return;
  const res = rcptApplyEdit(RCPT_EDIT.loc, f.fields);   // routes on type
  if (!res || !res.ok) { alert("Couldn't file: " + ((res && res.error) || "unknown")); return; }
  if (typeof rcptStampReviewed === "function") rcptStampReviewed(res.newLoc);
  if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Receipt FILED — " + (f.amt != null ? money(f.amt) : "") + (f.vendor ? " · " + f.vendor : "") + " · " + f.fields.type + (f.jobId ? " → job" : ""));
  if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); RCPT_EDIT = null; render();
};
