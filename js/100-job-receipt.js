/* ---------- UNIFIED JOB RECEIPT — one photo → tagged line items → the SHIPPED split engine ----------
   Replaces js/61's TWO separate add-forms (💵 job expense + 🧱 pass-through material) with ONE
   "📸 Add a receipt" card on the job page. Flow:
     upload a photo → jsUpload → a rcptNewReview stub in the review queue (the split `loc`, so an
       abandoned upload is never lost — it stays in Receipts to file later) → owner/admin + an org AI key
       → capRcptRead (ONE vision call) → seed the line-item editor from Cap's per-item `suggested.lineItems`
       (each {desc, amount, bucket}); crew / no-key / offline → a manual blank line.
     the editor: each row = [desc][amount][🧱/🚚/🔧 bucket toggle][✕] + a running "allocated $X of $Total"
       + "↳ put the rest on this line" + "+ Add a line" + a per-receipt "whose mistake?" (fault-dock).
     Confirm → jobRcptConfirm → **rcptApplySplit(loc, total, allocations, shared)** — the SHIPPED js/92 engine.
       Every line funnels through it (→ rcptApplyEdit route op), so buckets/card/deposit math + fingerprints
       stay BYTE-IDENTICAL to a hand Receipts split. N==1 (one bucket) = today's simple add. NO new money
       path, NO new collection, NO change to sync-server.js.

   Bucket → engine type + home (same map js/92 uses):
     🧱 pass-through → job.materials[]           (billed to the customer at cost)
     🚚 job-expense  → job.expenses[]  cat "job"  (a job cost)
     🔧 business     → this org's expenses[] cat "tools/equipment" (overhead — off every job's P&L)

   NOT owner-gated on Confirm (crew already add job costs today); only the Cap READ is server-gated → crew get
   the manual line path. Positive receipts file normally; a rental deposit/refund is handed off to the Receipts
   editor (rcptApplySplit can't file negatives / held deposits). The pure ops (jobRcptSeed / jobRcptClampBucket
   / jobRcptBuildAllocations / jobRcptStampFault) are DOM-free + unit-tested in receipts-tests.js. */

var JOB_RCPT = null;   // { jobId, loc:{store,jobId,recId}|null, receiptId, suggested, total, rows:[{desc,amount,bucket}], fault, depositFlag, reading }
var _jobRcptUpBusy = false, _jobRcptConfirmBusy = false;

/* money-with-cents (reuse js/92's helper; the app's money() rounds to whole dollars — splits need pennies) */
function _jrMoney(n) { return (typeof rcptSplitMoney === "function") ? rcptSplitMoney(n) : ("$" + (Math.round((+n || 0) * 100) / 100).toFixed(2)); }

/* ============================== PURE OPS (no DOM — unit-tested) ============================== */
/* clamp a bucket to the three the engine understands; anything unknown → pass-through (materials = the
   dominant job-page receipt). */
function jobRcptClampBucket(b) { return (b === "business" || b === "job-expense" || b === "pass-through") ? b : "pass-through"; }

/* seed the editor rows + total from Cap's `suggested`. Uses per-item `lineItems:[{desc,amount,bucket}]` when
   present; CLIENT FALLBACK = one whole-receipt line ({desc:"(whole receipt)", amount, bucket:suggested.type})
   so this works even before the Phase-1 lineItems land; no suggestion at all → one blank line. Never throws. */
function jobRcptSeed(s) {
  var rows = [], total = "";
  if (s) {
    if (s.amount != null && !isNaN(+s.amount)) total = Math.round(+s.amount * 100) / 100;
    var items = Array.isArray(s.lineItems) ? s.lineItems : [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; if (!it) continue;
      rows.push({
        desc: String(it.desc == null ? "" : it.desc).slice(0, 120),
        amount: (it.amount != null && !isNaN(+it.amount)) ? String(Math.round(+it.amount * 100) / 100) : "",
        bucket: jobRcptClampBucket(it.bucket)
      });
    }
    if (!rows.length) rows.push({ desc: "(whole receipt)", amount: (total === "" ? "" : String(total)), bucket: jobRcptClampBucket(s.type) });
  }
  if (!rows.length) rows.push({ desc: "", amount: "", bucket: "pass-through" });
  return { rows: rows, total: (total === "" ? "" : total) };
}

/* rows → the allocations array rcptApplySplit consumes. bucket → type + category + jobId, exactly like the
   Receipts split UI (js/92 rcptSaveEditSplit): 🧱→pass-through, 🚚→job-expense cat "job", 🔧→business cat
   "tools/equipment" (no job). */
function jobRcptBuildAllocations(rows, jobId) {
  return (Array.isArray(rows) ? rows : []).map(function (r) {
    var bucket = jobRcptClampBucket(r.bucket);
    return {
      amount: (r.amount === "" || r.amount == null) ? 0 : (+r.amount || 0),
      type: bucket,
      jobId: (bucket === "business") ? null : jobId,
      category: (bucket === "business") ? "tools/equipment" : (bucket === "job-expense") ? "job" : "",
      desc: r.desc || ""
    };
  });
}

/* FAULT-DOCK — the one capability the engine doesn't carry: stamp faultMemberId onto the 🚚 job-expense slices
   AFTER rcptApplySplit succeeds (a small additive pass over its newLocs), so today's "whose mistake?" payout
   dock survives the unification. Returns the number of records stamped. */
function jobRcptStampFault(newLocs, faultMemberId) {
  if (!faultMemberId || !Array.isArray(newLocs)) return 0;
  var n = 0;
  newLocs.forEach(function (nl) {
    if (!nl || nl.store !== "jobexp") return;
    var rec = (typeof rcptFindRecord === "function") ? rcptFindRecord(nl.store, nl.jobId, nl.recId) : null;
    if (rec) {
      rec.faultMemberId = faultMemberId;
      var jb = (typeof actJ === "function") ? actJ().find(function (x) { return x.id === nl.jobId; }) : null;
      if (jb && typeof touch === "function") touch(jb);
      n++;
    }
  });
  return n;
}

/* ============================== CARD + EDITOR (DOM) ============================== */
function jobRcptCardHTML(j) {
  if (!j) return "";
  var jobId = j.id;
  var h = '<div class="card" style="border-left:5px solid var(--brand)">';
  h += '<div style="font-weight:800;margin-bottom:4px">📸 Add a receipt <span class="sub" style="font-weight:400">· one photo → tagged line items</span></div>';
  h += '<div class="sub" style="margin-bottom:8px;white-space:normal">Snap the whole receipt — Cap reads it into line items. Mark each 🧱 material · 🚚 job cost · 🔧 tool, then Confirm. Or add lines by hand.</div>';
  h += '<input type="file" id="job_rcpt_file" accept="image/*,application/pdf,.pdf" style="display:none" onchange="jobRcptUpload(this,\'' + jobId + '\')">';
  h += '<button class="btn acc" style="width:100%" onclick="document.getElementById(\'job_rcpt_file\').click()">📷 Upload a receipt photo</button>';
  h += '<div id="job_rcpt_editor">' + jobRcptEditorInner(jobId) + '</div>';
  // Cross-job even split (js/61 jobOpenSplitPicker) — a DIFFERENT axis (dump runs / shared pickups across jobs),
  // kept reachable on the unified card.
  h += '<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="jobOpenSplitPicker(\'' + jobId + '\',\'expense\')">🔀 Split across other jobs / mark as generic</button>';
  h += '</div>';
  return h;
}

function jobRcptBucketLabel(b) { return b === "business" ? "🔧 tool / business" : b === "job-expense" ? "🚚 job cost" : "🧱 material"; }

function jobRcptRowHTML(r, i, n) {
  var b = jobRcptClampBucket(r.bucket);
  function bt(v, emoji, lbl) { var on = (b === v); return '<button class="btn ' + (on ? "acc" : "ghost") + ' sm" style="flex:1;padding:8px 2px" onclick="jobRcptSetBucket(' + i + ',\'' + v + '\')" title="' + lbl + '">' + emoji + '</button>'; }
  var h = '<div class="card" style="padding:8px;margin-top:8px">';
  h += '<input class="job_rcpt_desc" data-i="' + i + '" value="' + esc(r.desc || "") + '" placeholder="What — pavers, dump fee, a tool…">';
  h += '<div class="row" style="gap:6px;margin-top:6px;align-items:center">';
  h += '<input class="job_rcpt_amt" data-i="' + i + '" type="number" inputmode="decimal" value="' + esc(r.amount === "" || r.amount == null ? "" : r.amount) + '" placeholder="$" style="flex:0 0 76px" oninput="jobRcptRecalc()">';
  h += '<div class="row" style="gap:4px;flex:1">' + bt("pass-through", "🧱", "Pass-through material (billed to the customer)") + bt("job-expense", "🚚", "Job expense (a job cost)") + bt("business", "🔧", "Reusable tool / business overhead") + '</div>';
  h += (n > 1 ? '<button class="btn ghost sm" style="flex:0 0 auto;color:var(--danger)" onclick="jobRcptDelLine(' + i + ')" title="Remove">✕</button>' : '');
  h += '</div>';
  h += '<div class="sub" style="margin-top:4px">' + jobRcptBucketLabel(b) + ' · <a onclick="jobRcptRest(' + i + ')" style="cursor:pointer;color:var(--accent)">↳ put the rest here</a></div>';
  h += '</div>';
  return h;
}

/* the editor's inner HTML — idle (no active receipt for this job) shows a manual "+ Add a line" starter;
   reading shows a spinner; active shows the total + rows + indicator + fault + actions. Re-rendered in place
   by jobRcptEditorRerender (structural changes) and rebuilt whole by jobRcptCardHTML on a full render(). */
function jobRcptEditorInner(jobId) {
  var S = JOB_RCPT;
  if (!S || S.jobId !== jobId) return '<button class="btn ghost sm" style="width:100%;margin-top:10px" onclick="jobRcptStartManual(\'' + jobId + '\')">✚ Add a line by hand (no photo)</button>';
  if (S.reading) return '<div class="note" style="margin-top:10px">🤖 Cap is reading the receipt…</div>';
  var h = '<div class="card" style="margin-top:10px;padding:10px;background:var(--soft)">';
  if (S.depositFlag && S.loc) h += '<div class="note" style="border-left:3px solid #b8860b;white-space:normal;margin-bottom:8px">⚠ This looks like a rental <b>deposit / refund</b> — those are held (not split) and can\'t be filed here. <button class="btn ghost sm" style="margin-top:6px" onclick="rcptEditOpen(\'review\',null,\'' + S.loc.recId + '\')">Open it in Receipts to file it →</button></div>';
  h += '<label style="margin-top:0">Receipt total ($) <span class="sub">(blank = the sum of the lines)</span></label><input id="job_rcpt_total" type="number" inputmode="decimal" value="' + esc(S.total === "" || S.total == null ? "" : S.total) + '" placeholder="0.00" oninput="jobRcptRecalc()">';
  S.rows.forEach(function (r, i) { h += jobRcptRowHTML(r, i, S.rows.length); });
  h += '<div id="job_rcpt_ind" class="sub" style="margin-top:8px;text-align:center;font-weight:700"></div>';
  var members = (typeof schedMembers === "function") ? schedMembers() : [];
  h += '<label style="margin-top:8px">Whose mistake? <span class="sub">(optional — docks <i>their</i> payout on the 🚚 job-cost lines)</span></label><select id="job_rcpt_fault" onchange="jobRcptSetFault(this.value)"><option value="">— nobody / shared job cost —</option>' + members.map(function (u) { return '<option value="' + esc(u.id) + '"' + (S.fault === u.id ? " selected" : "") + '>' + esc(u.username) + '</option>'; }).join("") + '</select>';
  h += '<div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost grow" onclick="jobRcptAddLine(\'' + jobId + '\')">+ Add a line</button><button class="btn acc grow" id="job_rcpt_confirm" onclick="jobRcptConfirm(\'' + jobId + '\')">✓ Confirm &amp; file</button></div>';
  h += '<button class="btn ghost sm" style="width:100%;margin-top:8px;color:var(--danger)" onclick="jobRcptCancel(\'' + jobId + '\')">✕ Cancel</button>';
  h += '</div>';
  return h;
}

/* read the live DOM back into state before any structural re-render (so typed values aren't lost) */
function jobRcptCapture() {
  if (!JOB_RCPT) return;
  var t = document.getElementById("job_rcpt_total"); if (t) JOB_RCPT.total = t.value;
  var f = document.getElementById("job_rcpt_fault"); if (f) JOB_RCPT.fault = f.value;
  JOB_RCPT.rows.forEach(function (r, i) {
    var d = document.querySelector('.job_rcpt_desc[data-i="' + i + '"]'); if (d) r.desc = d.value;
    var a = document.querySelector('.job_rcpt_amt[data-i="' + i + '"]'); if (a) r.amount = a.value;
  });
}
function jobRcptEditorRerender() {
  var slot = document.getElementById("job_rcpt_editor");
  if (slot && JOB_RCPT) { slot.innerHTML = jobRcptEditorInner(JOB_RCPT.jobId); jobRcptRecalc(); }
  else if (typeof render === "function") render();
}

/* live "allocated $X of $Total" — green balanced / amber short / red over (mirrors js/92 rcptSplitRecalc). Reads
   the amount inputs directly (no re-render) so typing never loses focus. Blank total → "Σ $X (files as total)". */
window.jobRcptRecalc = function () {
  var ind = document.getElementById("job_rcpt_ind"); if (!ind || !JOB_RCPT) return;
  var amts = document.querySelectorAll(".job_rcpt_amt");
  var sum = 0; amts.forEach(function (el) { sum += (parseFloat(el.value) || 0); });
  sum = Math.round(sum * 100) / 100;
  var tEl = document.getElementById("job_rcpt_total");
  var totalRaw = tEl ? tEl.value : JOB_RCPT.total;
  var total = (+totalRaw > 0) ? Math.round(+totalRaw * 100) / 100 : 0;
  if (!(total > 0)) { ind.style.color = "var(--muted)"; ind.textContent = "Σ " + _jrMoney(sum) + " across " + amts.length + " line" + (amts.length === 1 ? "" : "s") + " — files as the total"; return; }
  var left = Math.round((total - sum) * 100) / 100;
  if (Math.abs(left) <= 0.01) { ind.style.color = "var(--accent)"; ind.textContent = "✓ Allocated " + _jrMoney(sum) + " of " + _jrMoney(total) + " — balanced"; }
  else if (left > 0) { ind.style.color = "#e0a800"; ind.textContent = "Allocated " + _jrMoney(sum) + " of " + _jrMoney(total) + " · " + _jrMoney(left) + " left"; }
  else { ind.style.color = "var(--danger)"; ind.textContent = "Over by " + _jrMoney(-left) + " — " + _jrMoney(sum) + " of " + _jrMoney(total); }
};

/* ---- editor mutators (capture live values first, then re-render the editor in place) ---- */
window.jobRcptStartManual = function (jobId) {
  JOB_RCPT = { jobId: jobId, loc: null, receiptId: null, suggested: null, total: "", rows: [{ desc: "", amount: "", bucket: "pass-through" }], fault: "", depositFlag: false, reading: false };
  if (typeof render === "function") render();
};
window.jobRcptAddLine = function (jobId) { if (!JOB_RCPT || JOB_RCPT.jobId !== jobId) return; jobRcptCapture(); JOB_RCPT.rows.push({ desc: "", amount: "", bucket: "pass-through" }); jobRcptEditorRerender(); };
window.jobRcptDelLine = function (i) { if (!JOB_RCPT) return; jobRcptCapture(); JOB_RCPT.rows.splice(i, 1); if (!JOB_RCPT.rows.length) JOB_RCPT.rows.push({ desc: "", amount: "", bucket: "pass-through" }); jobRcptEditorRerender(); };
window.jobRcptSetBucket = function (i, v) { if (!JOB_RCPT) return; jobRcptCapture(); if (JOB_RCPT.rows[i]) JOB_RCPT.rows[i].bucket = jobRcptClampBucket(v); jobRcptEditorRerender(); };
window.jobRcptSetFault = function (v) { if (JOB_RCPT) JOB_RCPT.fault = v || ""; };
window.jobRcptRest = function (i) {
  if (!JOB_RCPT) return; jobRcptCapture();
  var total = (+JOB_RCPT.total > 0) ? Math.round(+JOB_RCPT.total * 100) / 100 : 0;
  if (!(total > 0)) { if (typeof alert === "function") alert("Enter the receipt total first, then put the rest on a line."); return; }
  var others = JOB_RCPT.rows.reduce(function (s, r, k) { return s + (k === i ? 0 : (+r.amount || 0)); }, 0);
  var rest = Math.round((total - others) * 100) / 100;
  if (JOB_RCPT.rows[i]) JOB_RCPT.rows[i].amount = rest > 0 ? String(rest) : "";
  jobRcptEditorRerender();
};
window.jobRcptCancel = function () {
  // Manual (no photo) → nothing was persisted, just drop it. An uploaded photo LEAVES its review stub in the
  // Receipts queue so the receipt is never lost (recoverable / filable there later).
  JOB_RCPT = null;
  if (typeof render === "function") render();
};

/* apply Cap's suggestion (or a fallback) into the active state */
function jobRcptApplySuggested(s) {
  if (!JOB_RCPT) return;
  JOB_RCPT.suggested = s || null;
  JOB_RCPT.depositFlag = !!(s && (s.deposit || s.refund));
  var seeded = jobRcptSeed(s);
  JOB_RCPT.total = seeded.total;
  JOB_RCPT.rows = seeded.rows;
}

/* upload a photo → review stub (the split loc, recoverable) → auto Cap-read (owner/admin + org key) → seed rows.
   Busy-guarded so the June-2026 double-submit (20 taps → 20 dupes, no photo) can't recur. */
window.jobRcptUpload = function (input, jobId) {
  var file = input && input.files && input.files[0]; if (!file) return;
  if (_jobRcptUpBusy) return;
  if (typeof jsUpload !== "function") { if (typeof alert === "function") alert("Photo upload needs the server — add lines by hand instead."); jobRcptStartManual(jobId); return; }
  _jobRcptUpBusy = true;
  if (typeof uploadStatus === "function") uploadStatus("uploading", 0);
  jsUpload(file, function (pct) { if (typeof uploadStatus === "function") uploadStatus("uploading", pct); }).then(function (receiptId) {
    var stub = (typeof rcptNewReview === "function") ? rcptNewReview(receiptId) : { id: (typeof uid === "function" ? uid() : String(Math.random())), receiptId: receiptId };
    var coll = (typeof rcptColl === "function") ? rcptColl() : (function () { var d = D(); if (!Array.isArray(d.receipts)) d.receipts = []; return d.receipts; })();
    coll.push(stub); if (typeof touch === "function") touch(stub);
    // Persist + push the receipt RECORD right away so it can't be orphaned if the app closes during the Cap-read
    // step below, and tie "✓ safe to close" to that RECORD reaching the server (not just the blob upload).
    if (typeof save === "function") save();
    if (typeof uploadTrackSync === "function") uploadTrackSync();
    JOB_RCPT = { jobId: jobId, loc: { store: "review", jobId: null, recId: stub.id }, receiptId: receiptId, suggested: null, total: "", rows: [], fault: "", depositFlag: false, reading: false };
    var canRead = false;
    try { canRead = (typeof rcptFinFull === "function" && rcptFinFull()) && (typeof ORG_AI_ST !== "undefined" && ORG_AI_ST && ORG_AI_ST.enabled && ORG_AI_ST.hasKey) && !/\.pdf$/i.test(String(receiptId)) && (typeof capRcptRead === "function"); } catch (e) { canRead = false; }
    if (!canRead) {
      _jobRcptUpBusy = false;
      jobRcptApplySuggested(null);
      if (typeof save === "function") save();
      if (typeof render === "function") render();
      return;
    }
    JOB_RCPT.reading = true;
    if (typeof render === "function") render();
    capRcptRead(receiptId).then(function (res) {
      _jobRcptUpBusy = false;
      if (!JOB_RCPT || JOB_RCPT.receiptId !== receiptId) return;   // user moved on / cancelled
      var s = (res && res.suggested) ? res.suggested : null;
      if (s) { var live = (typeof rcptFindRecord === "function") ? rcptFindRecord("review", null, stub.id) : stub; if (live) { live.suggested = s; if (typeof touch === "function") touch(live); } }
      JOB_RCPT.reading = false;
      jobRcptApplySuggested(s);
      if (typeof save === "function") save();
      if (typeof render === "function") render();
    }).catch(function () {
      _jobRcptUpBusy = false;
      if (JOB_RCPT && JOB_RCPT.receiptId === receiptId) { JOB_RCPT.reading = false; jobRcptApplySuggested(null); if (typeof save === "function") save(); if (typeof render === "function") render(); }
    });
  }).catch(function (e) {
    _jobRcptUpBusy = false;
    if (typeof uploadStatus === "function") uploadStatus("error", null, (e && e.message) || e);
    if (typeof alert === "function") alert("Receipt upload failed: " + ((e && e.message) || e) + " — you can still add lines by hand.");
    if (!JOB_RCPT || JOB_RCPT.jobId !== jobId) jobRcptStartManual(jobId);
  });
};

/* CONFIRM — build allocations from the rows and file EVERY line through rcptApplySplit (the shipped engine).
   Byte-identical to a hand Receipts split; N==1 = today's single add. Not owner-gated (crew add job costs). */
window.jobRcptConfirm = function (jobId) {
  if (!JOB_RCPT || JOB_RCPT.jobId !== jobId) return;
  if (_jobRcptConfirmBusy) return;
  jobRcptCapture();
  if (typeof rcptApplySplit !== "function") { if (typeof alert === "function") alert("Receipt engine not loaded — refresh."); return; }
  if (JOB_RCPT.depositFlag) { if (typeof alert === "function") alert("This looks like a rental deposit / refund — open it in Receipts to file it. Deposits are held, not split here."); return; }
  var rows = JOB_RCPT.rows.filter(function (r) { return r && ((+r.amount > 0) || String(r.desc || "").trim()); });
  if (!rows.length) { if (typeof alert === "function") alert("Add at least one line with an amount."); return; }
  var allocations = jobRcptBuildAllocations(rows, jobId);
  var sum = Math.round(allocations.reduce(function (s, a) { return s + (+a.amount || 0); }, 0) * 100) / 100;
  var total = (+JOB_RCPT.total > 0) ? Math.round(+JOB_RCPT.total * 100) / 100 : sum;   // blank total → auto-balance to the line sum
  var meId = (typeof curUser === "function" && curUser()) ? curUser().id : "";
  var s = JOB_RCPT.suggested || {};
  var sd = (typeof rcptSmartDefaults === "function") ? rcptSmartDefaults({ vendor: s.vendor, meId: meId }) : {};
  var shared = {
    vendor: s.vendor || "",
    date: s.date || (typeof today === "function" ? today() : ""),
    paidBy: s.paidBy || sd.paidBy || null,
    attributedTo: meId || null,
    receiptId: JOB_RCPT.receiptId || null,
    cardLast4: (s.last4 || sd.cardLast4 || "")
  };
  _jobRcptConfirmBusy = true;
  var btn = document.getElementById("job_rcpt_confirm"); if (btn) { btn.disabled = true; btn.textContent = "Filing…"; }
  // ensure a loc — the manual path has no stub yet; create one now (roll it back if the file fails).
  var loc = JOB_RCPT.loc, createdStub = null;
  if (!loc) {
    var stub = (typeof rcptNewReview === "function") ? rcptNewReview(JOB_RCPT.receiptId || null) : null;
    if (stub) {
      var coll = (typeof rcptColl === "function") ? rcptColl() : (function () { var d = D(); if (!Array.isArray(d.receipts)) d.receipts = []; return d.receipts; })();
      coll.push(stub); if (typeof touch === "function") touch(stub);
      loc = { store: "review", jobId: null, recId: stub.id }; createdStub = stub;
    }
  }
  var res = rcptApplySplit(loc, total, allocations, shared);
  if (!res || !res.ok) {
    if (createdStub) { createdStub.deleted = true; if (typeof touch === "function") touch(createdStub); }
    if (btn) { btn.disabled = false; btn.textContent = "✓ Confirm & file"; }
    _jobRcptConfirmBusy = false;
    if (typeof alert === "function") alert((res && res.error) || "Couldn't file the receipt.");
    return;
  }
  jobRcptStampFault(res.newLocs, JOB_RCPT.fault);   // 🚚 lines carry the fault-dock
  if (typeof logChange === "function") logChange("update", "expense", res.newLocs[0].recId, "Job receipt filed — " + allocations.length + " line" + (allocations.length > 1 ? "s" : "") + " · " + _jrMoney(total) + (shared.vendor ? " · " + shared.vendor : ""));
  if (typeof save === "function") save();
  JOB_RCPT = null;
  _jobRcptConfirmBusy = false;
  if (typeof toast === "function") toast("✓ Receipt filed — " + allocations.length + " line" + (allocations.length > 1 ? "s" : ""));
  if (typeof render === "function") render();
};

if (typeof window !== "undefined") {
  window.jobRcptCardHTML = jobRcptCardHTML;
  window.jobRcptClampBucket = jobRcptClampBucket;
  window.jobRcptSeed = jobRcptSeed;
  window.jobRcptBuildAllocations = jobRcptBuildAllocations;
  window.jobRcptStampFault = jobRcptStampFault;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { jobRcptSeed: jobRcptSeed, jobRcptClampBucket: jobRcptClampBucket, jobRcptBuildAllocations: jobRcptBuildAllocations, jobRcptStampFault: jobRcptStampFault };
}
