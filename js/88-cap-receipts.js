/* ---------- CAP AUTO-CATEGORIZE — Cap READS a review receipt's photo and PROPOSES a categorization ----------
   On-demand only (vision calls cost tokens on the ORG'S OWN Anthropic key). Owner/admin trigger it from the
   Receipts page; Cap reads each needs-review photo server-side (js/75 org-AI extended for image input) and
   writes the guess to `receipt.suggested` — the EXACT shape the edit modal reads (js/87). Cap NEVER applies
   anything: the owner opens the receipt, taps "Use Cap's guess", and Saves. This module only fills the
   already-built propose→approve hook; it changes no real field, type, job, or billing.

   Gating: owner/admin only (enforced here AND on the server). Degrades gracefully with no org AI key. */

const CAP_RCPT_MAX = 15;   // per-run cap — vision tokens cost money, so read a batch, not the whole pile
let _capRcptBusy = false;

/* review receipts that still have a photo but no Cap suggestion yet (skip PDFs — vision reads images) */
function capRcptTargets() {
  return rcptReview().filter(r => r && r.receiptId && !r.suggested && !/\.pdf$/i.test(r.receiptId));
}
function capRcptCanRun() { return typeof rcptFinFull === "function" ? rcptFinFull() : false; }   // owner/admin only
function capRcptSetStatus(txt) { const el = document.getElementById("cap_rcpt_status"); if (el) el.textContent = txt || ""; }

/* the job/category context Cap needs to match a job + pick a bucket (RCPT_CATS is the single source of truth) */
function capRcptCtx() {
  const jobs = (typeof rcptJobs === "function" ? rcptJobs() : []).slice(0, 60).map(j => ({
    id: j.id, title: j.title || "Job",
    customer: (j.customerId && typeof custName === "function") ? custName(j.customerId) : "",
    date: j.date || ""
  }));
  return { jobs: jobs, cats: (typeof RCPT_CATS !== "undefined" ? RCPT_CATS : []) };
}

/* POST one receipt to the org-AI vision endpoint. Returns {suggested} | {skip,reason} | {error}. */
async function capRcptRead(receiptId) {
  const base = (typeof orgAiBase === "function") ? orgAiBase() : "";
  if (!base) return { error: "offline" };
  const ctx = capRcptCtx();
  try {
    const r = await fetch(base + "/api/org-ai/read-receipt", {
      method: "POST",
      headers: (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify({ org: S.biz, receiptId: receiptId, jobs: ctx.jobs, cats: ctx.cats })
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) return { error: (j && j.error) || ("HTTP " + r.status), status: r.status };
    return j || { error: "empty response" };
  } catch (e) { return { error: (e && e.message) || "request failed" }; }
}

/* TRIGGER — read the needs-review pile (up to CAP_RCPT_MAX). Writes ONLY `suggested`; never a real field. */
window.capRcptRun = async function () {
  if (!capRcptCanRun()) { alert("Only an owner or admin can run Cap."); return; }
  if (_capRcptBusy) return;
  const targets = capRcptTargets().slice(0, CAP_RCPT_MAX);
  if (!targets.length) { alert("No needs-review receipts left for Cap to read (Cap skips PDFs and ones it's already read)."); return; }
  _capRcptBusy = true;
  capRcptSetStatus("🤖 Cap is reading 0/" + targets.length + "…");
  let done = 0, ok = 0, skipped = 0, keyMissing = false;
  for (const rec of targets) {
    const res = await capRcptRead(rec.receiptId);
    if (res && res.suggested) {
      // re-find the live record (the store may have changed) and stamp ONLY `suggested`
      const live = (typeof rcptFindRecord === "function") ? rcptFindRecord("review", null, rec.id) : rec;
      if (live) { live.suggested = res.suggested; if (typeof touch === "function") touch(live); ok++; }
    } else if (res && res.skip) { skipped++; }
    else if (res && res.status === 400 && /not set up/i.test(res.error || "")) { keyMissing = true; break; }
    else { skipped++; }   // parse/network error on one → skip it, keep the batch going
    done++;
    capRcptSetStatus("🤖 Cap is reading " + done + "/" + targets.length + "…");
  }
  if (ok && typeof save === "function") save();
  _capRcptBusy = false;
  capRcptSetStatus("");
  if (keyMissing) { alert("Cap needs this organization's Anthropic API key. Set it in Admin → Assistant, then try again."); }
  else { alert("🤖 Cap read " + ok + " receipt" + (ok === 1 ? "" : "s") + (skipped ? " (" + skipped + " skipped)" : "") + ". Open a 🤖 row to review and approve its guess."); }
  if (typeof render === "function") render();
};

/* single-receipt re-run from the edit modal ("Ask Cap to read this") — uses the currently-open RCPT_EDIT */
window.capRcptOne = async function () {
  if (!capRcptCanRun()) return;
  if (typeof RCPT_EDIT === "undefined" || !RCPT_EDIT || !RCPT_EDIT.receiptId) { alert("No photo on this receipt for Cap to read."); return; }
  if (/\.pdf$/i.test(RCPT_EDIT.receiptId)) { alert("Cap can't read PDF receipts — only photos."); return; }
  const btn = document.getElementById("cap_rcpt_one_btn"); if (btn) { btn.disabled = true; btn.textContent = "🤖 Cap is reading…"; }
  const res = await capRcptRead(RCPT_EDIT.receiptId);
  if (res && res.suggested) {
    const loc = RCPT_EDIT.loc || {};
    const live = (typeof rcptFindRecord === "function") ? rcptFindRecord(loc.store, loc.jobId, loc.recId) : null;
    if (live) {
      live.suggested = res.suggested;
      if (loc.store === "jobmat" || loc.store === "jobexp") { const jb = (D().jobs || []).find(x => x && x.id === loc.jobId); if (jb && typeof touch === "function") touch(jb); }
      else if (typeof touch === "function") touch(live);
      if (typeof save === "function") save();
      // reopen the modal so the "🤖 Cap suggests" banner + "Use Cap's guess" button render (js/87)
      if (typeof rcptEditOpen === "function") rcptEditOpen(loc.store, loc.jobId, loc.recId);
      return;
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = "🤖 Ask Cap to read this"; }
  if (res && res.skip) alert("Cap couldn't read this one clearly — fill it in by hand.");
  else if (res && res.status === 400 && /not set up/i.test(res.error || "")) alert("Cap needs this organization's Anthropic API key. Set it in Admin → Assistant.");
  else alert("Cap couldn't read this receipt right now. Try again in a moment.");
};

/* the button shown on the Receipts page next to the review-queue banner (owner/admin only) */
function capRcptButtonHTML() {
  if (!capRcptCanRun()) return "";
  const n = capRcptTargets().length;
  if (!n) return "";
  return `<div class="card" style="border-left:4px solid #6b3fa0"><div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
    <div class="grow" style="white-space:normal"><b>🤖 Cap: categorize needs-review</b><div class="sub">Cap reads up to ${CAP_RCPT_MAX} receipt photos and proposes vendor / amount / type / category / job for each. You approve every one — nothing is applied automatically.</div></div>
    <button class="btn acc sm" onclick="capRcptRun()">🤖 Read ${n > CAP_RCPT_MAX ? CAP_RCPT_MAX + " of " + n : n}</button></div>
    <div id="cap_rcpt_status" class="sub" style="text-align:center;color:#6b3fa0;min-height:16px;margin-top:4px"></div></div>`;
}
