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
  const base = { id: id, amount: amount, vendor: fields.vendor || "", desc: fields.desc || "", receiptId: fields.receiptId || null, paidBy: fields.paidBy || null, attributedTo: attributedTo, by: by, ts: carry.ts || now() };
  if (carry.reimbursedAt) base.reimbursedAt = carry.reimbursedAt;
  if (carry.capRead) base.capRead = carry.capRead;
  if (card4) base.cardLast4 = card4;
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
  Object.assign(rev, dep);
  return rev;
}
/* THE PURE RE-BUCKETING OP. loc={store,jobId,recId}; fields={type,jobId,amount,vendor,date,category,paidBy,desc,receiptId}.
   Same home → mutate in place (id kept, zero churn). Different home → tombstone old + create SAME-id record in
   the new array (preserves id + photo, moves the billing). Returns {ok,newLoc} or {ok:false,error}. */
function rcptApplyEdit(loc, fields) {
  const cur = rcptFindRecord(loc.store, loc.jobId, loc.recId || loc.id);
  if (!cur) return { ok: false, error: "record not found" };
  const home = rcptTargetHome(fields);
  const carry = { ts: cur.ts, uploadedBy: cur.uploadedBy, attributedTo: cur.attributedTo, reimbursedAt: cur.reimbursedAt, capRead: cur.capRead, faultMemberId: cur.faultMemberId, suggested: cur.suggested, by: cur.by, cardLast4: cur.cardLast4, isDeposit: cur.isDeposit, depositSettled: cur.depositSettled, refundOfId: cur.refundOfId, kind: cur.kind };
  if ((cur.paidBy || null) !== (fields.paidBy || null)) carry.reimbursedAt = undefined;   // payer changed → the old reimbursement settlement no longer applies
  const sameHome = (loc.store === home.store) && (!(loc.store === "jobmat" || loc.store === "jobexp") || loc.jobId === home.jobId);
  if (sameHome) {
    const rebuilt = rcptBuildRecord(home, cur.id, fields, carry);
    Object.assign(cur, rebuilt);
    if (carry.reimbursedAt === undefined && "reimbursedAt" in cur) delete cur.reimbursedAt;
    if ((fields.cardLast4 != null) && !("cardLast4" in rebuilt) && ("cardLast4" in cur)) delete cur.cardLast4;   // the form explicitly cleared the card last-4 → drop the stale value (Object.assign wouldn't remove it)
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

  const typeOpts = [["", "🕓 Needs review (unassigned)"], ["business", "🏢 Business expense"], ["job-expense", "💵 Job expense — reimbursed to uploader"], ["pass-through", "🧱 Pass-through material — billed to customer"]]
    .map(([v, l]) => `<option value="${v}" ${curType === (v || "review") ? "selected" : ""}>${l}</option>`).join("");
  const jobOpts = `<option value="">— pick a job —</option>` + jobs.map(j => `<option value="${esc(j.id)}" ${jobSel === j.id ? "selected" : ""}>${(typeof jobPO === "function" && jobPO(j)) ? esc(jobPO(j)) + " · " : ""}${esc(j.title || "Job")}${j.customerId && typeof custName === "function" ? " · " + esc(custName(j.customerId)) : ""}${j.date ? " · " + fmtDate(j.date) : ""}</option>`).join("");
  const catOpts = `<option value="">— category —</option>` + RCPT_CATS.map(c => `<option ${rec.category === c ? "selected" : ""}>${c}</option>`).join("");
  const paidOpts = `<option value="">💳 Business card (no reimburse)</option>` + members.map(u => `<option value="${esc(u.id)}" ${rec.paidBy === u.id ? "selected" : ""}>${esc(u.username)} — personal card (reimburse)</option>`).join("");
  const attrCur = rec.attributedTo || rec.paidBy || rec.uploadedBy || "";
  const attrOpts = `<option value="">— nobody in particular —</option>` + members.map(u => `<option value="${esc(u.id)}" ${attrCur === u.id ? "selected" : ""}>${esc(u.username)}</option>`).join("");

  let sugg = "";
  if (RCPT_EDIT.suggested) {
    const s = RCPT_EDIT.suggested;
    sugg = `<div id="rcpt_suggbanner" class="card" style="background:#6b3fa0;color:#fff;padding:10px;margin-bottom:8px"><div style="font-weight:700">🤖 Cap suggests${s.confidence != null ? ` (${Math.round(s.confidence * 100)}% sure)` : ""}</div><div class="sub" style="color:#fff;opacity:.9;white-space:normal">${[s.vendor, s.amount != null ? money(s.amount) : "", s.type ? (RCPT_TYPE_LABEL[s.type] || s.type) : "", s.category].filter(Boolean).map(esc).join(" · ")}</div><button class="btn sm" style="margin-top:8px;background:#fff;color:#6b3fa0" onclick="rcptApplySuggestion()">Use Cap's guess</button> <span class="sub" style="color:#fff;opacity:.8">— then Save to confirm</span></div>`;
  }

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
    <label style="margin-top:10px">Amount ($)</label><input id="rcpt_amt" type="number" inputmode="decimal" value="${rec.amount != null ? esc(rec.amount) : ""}" placeholder="0.00">
    <label>Vendor / where bought</label><input id="rcpt_vendor" value="${esc(rec.vendor || "")}" placeholder="Home Depot, dump, gas…">
    <div id="rcpt_jobwrap" style="display:none"><label>Assign to job</label><select id="rcpt_job" onchange="rcptJobPONote()">${jobOpts}</select>
      <label>PO / job code <span class="sub">(type or paste the P#### off the receipt to auto-pick its job)</span></label><input id="rcpt_po" type="text" placeholder="P1042" value="" oninput="rcptPoBind()" onblur="rcptPoBind()">
      <div id="rcpt_po_note" class="sub" style="margin-top:4px"></div></div>
    <details id="rcpt_more" open style="margin-top:12px"><summary style="cursor:pointer;padding:6px 0;color:var(--muted);font-size:14px;user-select:none">More options ▾</summary>
    <label>Date</label><input id="rcpt_date" type="date" value="${esc(rcptDate(rec))}">
    <label>What was it</label><input id="rcpt_desc" value="${esc(rec.desc || rec.note || "")}" placeholder="pavers, dump fee, fuel…">
    <label>Type</label><select id="rcpt_type" onchange="rcptEditTypeChange()">${typeOpts}</select>
    <label>Category</label><select id="rcpt_cat">${catOpts}</select>
    <label>Who paid?</label><select id="rcpt_paidby">${paidOpts}</select>
    <label>Card ••••<span class="sub">(last 4 — auto-matches who paid)</span></label><input id="rcpt_card4" type="text" inputmode="numeric" maxlength="4" value="${esc(rec.cardLast4 || "")}" placeholder="1234" oninput="if(typeof cardMatchRefresh==='function')cardMatchRefresh()">
    <div id="rcpt_card_slot"></div>
    <label>Whose receipt <span class="sub">(shows on their tab so they don't re-upload it)</span></label><select id="rcpt_attr">${attrOpts}</select>
    <label class="li" style="cursor:pointer;margin-top:10px"><input type="checkbox" id="rcpt_deposit" ${rec.isDeposit ? "checked" : ""} style="width:20px;height:20px;flex:0 0 auto"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">⚠ Rental deposit (refund may come back)</div><div class="sub" style="white-space:normal">A refundable equipment-rental hold. HELD out of the job's cost ($0) until you confirm the refund — then it counts at net (deposit − refund).</div></div></label>
    <label class="li" style="cursor:pointer;margin-top:6px"><input type="checkbox" id="rcpt_refund" ${rec.kind === "refund" ? "checked" : ""} style="width:20px;height:20px;flex:0 0 auto"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">↩ This is a refund / credit (money coming back)</div><div class="sub" style="white-space:normal">Stores the amount as NEGATIVE so it offsets the matching charge/deposit. Enter the refund amount above as a plain number.</div></div></label>
    <div id="rcpt_split_slot"></div>
    </details>
    ${rcptInvBlockHTML(rec)}
    <div id="rcpt_edit_actions" class="row" style="gap:8px;margin-top:14px"><button class="btn ghost grow" style="color:var(--danger)" onclick="rcptDelRow('${store}','${jobId || ""}','${recId}')">🗑 Delete</button><button class="btn acc grow" onclick="rcptSaveEdit()">✓ Save</button></div>
    <button class="btn ghost" style="width:100%;margin-top:8px;color:var(--danger)" onclick="rcptEditMarkDup()">🔁 Mark as duplicate — delete this (other copy stays)</button>`);
  rcptEditTypeChange();
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
/* PER-JOB PO CODE (js/95) — show the currently-selected job's PO under the picker ("PO for this job: P1042"). */
window.rcptJobPONote = function () {
  const note = document.getElementById("rcpt_po_note"); if (!note) return;
  const sel = val("rcpt_job");
  const j = (sel && typeof actJ === "function") ? actJ().find(x => x && x.id === sel) : null;
  const po = (j && typeof jobPO === "function") ? jobPO(j) : "";
  note.innerHTML = po ? ("PO for this job: <b>" + esc(po) + "</b>") : "";
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
  set("rcpt_vendor", s.vendor); set("rcpt_amt", s.amount); set("rcpt_cat", s.category); set("rcpt_desc", s.desc);
  if (s.type) { const el = document.getElementById("rcpt_type"); if (el) { el.value = s.type; rcptEditTypeChange(); } }
  if (s.jobId) set("rcpt_job", s.jobId);
  // Cap Phase 4 — card last-4 (js/94: auto-matches "Who paid?"), refund + rental-deposit toggles (js/96).
  // Only APPLY when present: a null last4 / false toggle leaves the owner's existing entry untouched.
  if (s.last4) { set("rcpt_card4", s.last4); if (typeof cardMatchRefresh === "function") cardMatchRefresh(); }   // auto-match paidBy from the card
  if (s.refund) { const el = document.getElementById("rcpt_refund"); if (el) el.checked = true; }
  if (s.deposit) { const el = document.getElementById("rcpt_deposit"); if (el) el.checked = true; if (!val("rcpt_cat")) set("rcpt_cat", "rentals"); }   // rental deposit → nudge category (save also nudges)
  // Cap SPLIT SUGGESTION (js/92) — a MIXED receipt (≥2 buckets, e.g. materials + a reusable tool). OPEN the
  // split editor PRE-FILLED from Cap's balanced allocations for the owner to review + tap "Save splits".
  // Cap proposes, the owner confirms — this never auto-commits. <2 splits → the single-categorization above stands.
  let banner = "✓ Cap's guess applied — review the fields and tap Save to confirm.";
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
window.rcptSaveEdit = function () {
  if (!rcptFinFull() || !RCPT_EDIT) return;
  const type = val("rcpt_type") || "";   // "" = review
  const jobId = (type === "job-expense" || type === "pass-through") ? (val("rcpt_job") || "") : "";
  const amtRaw = val("rcpt_amt");
  const amount = amtRaw === "" ? null : (parseFloat(amtRaw) || 0);
  const vendor = (val("rcpt_vendor") || "").trim();
  const date = val("rcpt_date") || "";
  const category = val("rcpt_cat") || "";
  const paidBy = val("rcpt_paidby") || "";
  const attributedTo = val("rcpt_attr") || "";
  const desc = (val("rcpt_desc") || "").trim();
  const cardLast4 = (val("rcpt_card4") || "").replace(/\D/g, "").slice(-4);   // js/94: 0-4 digits — "" clears it, a valid 4-digit is stored + drives auto-attribution
  const isDeposit = !!(document.getElementById("rcpt_deposit") || {}).checked;   // js/96: a refundable rental deposit (HELD out of job cost until settled)
  const isRefund = !!(document.getElementById("rcpt_refund") || {}).checked;     // js/96: a refund/credit — stored NEGATIVE so it offsets the charge
  // a refund stores the amount as negative + kind:"refund"; a deposit nudges category to "rentals" (equipment-rental hard cost)
  let amt = amount;
  if (isRefund && amt != null) amt = -Math.abs(amt);
  const cat = (isDeposit && !category) ? "rentals" : category;
  if ((type === "job-expense" || type === "pass-through") && !jobId) { alert("Pick a job for this receipt — or set Type to Business, or leave it as Needs review."); return; }
  if (type && (amt == null || amt === 0)) { alert("Enter the amount to file this receipt."); return; }
  if (type && amt < 0 && !isRefund) { alert("A negative amount is only for a refund/credit — tick “↩ This is a refund” to file it."); return; }
  if (type && !vendor) { alert("Enter the vendor / where it was bought."); return; }
  if (typeof submitGuard === "function" && !submitGuard("rcptSaveEdit:" + RCPT_EDIT.loc.recId)) return;   // rapid-tap dupe guard
  const fields = { type: type || null, jobId: jobId || null, amount: amt, vendor: vendor, date: date, category: cat, paidBy: paidBy || null, attributedTo: attributedTo || null, desc: desc, receiptId: RCPT_EDIT.receiptId || null, cardLast4: cardLast4, isDeposit: isDeposit, kind: isRefund ? "refund" : "" };
  const res = rcptApplyEdit(RCPT_EDIT.loc, fields);
  if (!res || !res.ok) { alert("Couldn't save: " + ((res && res.error) || "unknown")); return; }
  if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Receipt " + (type ? "filed" : "updated") + " — " + (amt != null ? money(amt) : "") + (vendor ? " · " + vendor : "") + (isDeposit ? " · ⚠ deposit" : "") + (isRefund ? " · ↩ refund" : "") + " · " + (fields.type || "review") + (jobId ? " → job" : ""));
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  RCPT_EDIT = null;
  render();
};
