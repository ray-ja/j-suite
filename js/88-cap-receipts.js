/* ---------- CAP AUTO-CATEGORIZE — Cap READS a review receipt's photo and PROPOSES a categorization ----------
   On-demand only (vision calls cost tokens on the ORG'S OWN Anthropic key). Owner/admin trigger it from the
   Receipts page; Cap reads each needs-review photo server-side (js/75 org-AI extended for image input) and
   writes the guess to `receipt.suggested` — the EXACT shape the edit modal reads (js/87). Cap NEVER applies
   anything: the owner opens the receipt, taps "Use Cap's guess", and Saves. This module only fills the
   already-built propose→approve hook; it changes no real field, type, job, or billing.

   Gating: owner/admin only (enforced here AND on the server). Degrades gracefully with no org AI key. */

const CAP_RCPT_CEILING = 250;   // SAFETY per-drain ceiling — a runaway can't bill infinitely; the rest resume on the next sweep
let _capRcptBusy = false;
let _capRcptSkip = {};          // in-session {receiptId's row id -> 1} of ones Cap couldn't read this session, so a re-derived
                                // drain never retries (and never loops on) an un-stampable receipt; cleared on app reload (new session)
let _capSweepLast = 0;          // last resumable-sweep time — bounds how often stuck (unreadable) receipts get re-tried
/* pause between reads: respect the server per-IP rate-limit + the Anthropic API. Overridable (tests set 0) via
   window.CAP_RCPT_THROTTLE_MS; defaults to 700ms. NO wait after the final read. */
function capRcptThrottleMs() {
  var w = (typeof window !== "undefined") ? window : null;
  return (w && typeof w.CAP_RCPT_THROTTLE_MS === "number") ? w.CAP_RCPT_THROTTLE_MS : 700;
}
function capRcptSleep(ms) { return (ms > 0) ? new Promise(function (r) { setTimeout(r, ms); }) : Promise.resolve(); }
/* the still-unread targets minus ones this session already failed on (so the drain terminates + doesn't churn) */
function capRcptPending() { return capRcptTargets().filter(function (r) { return r && !_capRcptSkip[r.id]; }); }

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

/* TRIGGER — DRAIN the whole needs-review pile, strictly ONE AT A TIME. Writes ONLY `suggested`; never a real
   field. The store changes as it stamps, so each pass RE-DERIVES the pending set (capRcptPending) and keeps
   reading until NONE remain — any batch size (7, 100, …) reads fully; nothing is silently skipped. Reads are
   sequential `await` (never Promise.all): Cap keeps full context per receipt AND we respect the rate-limit,
   with a small throttle BETWEEN reads. save()s after each stamp so an app-close mid-drain keeps its progress
   (resumable). A SAFETY ceiling bounds one drain (the rest resume via capRcptSweep). One drain at a time
   (_capRcptBusy). opts.auto (upload auto-read + the resumable sweep) runs SILENTLY — the fresh 🤖 badge +
   "✓ file it" rows are the feedback. Manual "🤖 Read N" stays chatty. Never throws. */
window.capRcptRun = async function (opts) {
  opts = opts || {};
  if (!capRcptCanRun()) { if (!opts.auto) alert("Only an owner or admin can run Cap."); return; }
  if (_capRcptBusy) return;
  if (!capRcptPending().length) { if (!opts.auto) alert("No needs-review receipts left for Cap to read (Cap skips PDFs and ones it's already read)."); return; }
  _capRcptBusy = true;
  const throttle = capRcptThrottleMs();
  let done = 0, ok = 0, skipped = 0, keyMissing = false, offline = false, capped = false;
  while (true) {
    const pending = capRcptPending();
    if (!pending.length) break;                       // drained — nothing unread remains
    if (done >= CAP_RCPT_CEILING) { capped = true; break; }   // safety ceiling — resumable sweep reads the rest
    const rec = pending[0];
    const totalNow = done + pending.length;            // live denominator (grows if sync injects more mid-drain)
    capRcptSetStatus("🤖 Cap is reading " + (done + 1) + " of " + totalNow + (totalNow > 25 ? " receipts" : "") + "…");
    const res = await capRcptRead(rec.receiptId);      // ONE dedicated vision call — sequential, never parallel
    if (res && res.suggested) {
      // re-find the live record (the store may have changed) and stamp ONLY `suggested`
      const live = (typeof rcptFindRecord === "function") ? rcptFindRecord("review", null, rec.id) : rec;
      const tgt = live || rec;
      tgt.suggested = res.suggested; if (typeof touch === "function") touch(tgt); ok++;
      if (typeof save === "function") save();          // persist as we go → resumable across an app-close
    } else if (res && res.status === 400 && /not set up/i.test(res.error || "")) { keyMissing = true; break; }
    else if (res && res.error === "offline") { offline = true; break; }   // connectivity gone — stop churning; the sweep resumes on reconnect
    else { skipped++; _capRcptSkip[rec.id] = 1; }      // parse/unreadable error → skip THIS session, keep draining the rest (no retry-loop)
    done++;
    if (capRcptPending().length && done < CAP_RCPT_CEILING && throttle > 0) await capRcptSleep(throttle);
  }
  if (ok && typeof save === "function") save();
  _capRcptBusy = false;
  capRcptSetStatus(capped ? "🤖 Cap read " + done + " — more will read shortly…" : "");
  if (keyMissing) { if (!opts.auto) alert("Cap needs this organization's Anthropic API key. Set it in Admin → Assistant, then try again."); }
  else if (!opts.auto) { alert("🤖 Cap read " + ok + " receipt" + (ok === 1 ? "" : "s") + (skipped ? " (" + skipped + " skipped)" : "") + (capped ? " — more will read shortly" : "") + ". Open a 🤖 row to review and approve its guess."); }
  if (typeof render === "function") render();
};

/* RESUMABLE SWEEP — reads any unread receipts left by an interrupted batch / an app-close, OR ones that arrived
   via sync from another device / the server. Fires on app open (the boot pull) + after every sync (js/26),
   owner/admin + key gated, once-per-window (bounds re-tries of stuck receipts), never-throws, no-op at 0 unread.
   Fire-and-forget: capRcptRun drains + re-renders itself. */
window.capRcptSweep = function () {
  try {
    if (!capRcptCanRun()) return;                       // owner/admin only (auto path is silent)
    if (_capRcptBusy) return;                            // a drain is already running
    if (!capRcptPending().length) return;               // nothing unread → no-op
    if (typeof orgAiBase === "function" && !orgAiBase()) return;   // offline / file:// → no server, no-op
    var t = (typeof now === "function") ? now() : Date.now();
    if (t - _capSweepLast < 60000) return;              // debounce: don't re-sweep the same pile more than ~1×/min
    _capSweepLast = t;
    // client may not know yet whether a key exists (loaded lazily in Admin) — best-effort populate, then gate
    var proceed = function () {
      try {
        if (typeof ORG_AI_ST !== "undefined" && ORG_AI_ST && (!ORG_AI_ST.enabled || !ORG_AI_ST.hasKey)) return;  // known no-key → skip
        if (!capRcptPending().length) return;
        capRcptRun({ auto: true });
      } catch (e) {}
    };
    if ((typeof ORG_AI_ST === "undefined" || !ORG_AI_ST) && typeof orgAiLoadStatus === "function") {
      Promise.resolve(orgAiLoadStatus()).then(proceed, proceed);
    } else { proceed(); }
  } catch (e) {}
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
    <div class="grow" style="white-space:normal"><b>🤖 Cap: categorize needs-review</b><div class="sub">Cap reads your needs-review photos <b>one at a time</b> and proposes vendor / amount / type / category / job for each. You approve every one — nothing is applied automatically.</div></div>
    <button class="btn acc sm" onclick="capRcptRun()">🤖 Read ${n}</button></div>
    <div id="cap_rcpt_status" class="sub" style="text-align:center;color:#6b3fa0;min-height:16px;margin-top:4px"></div></div>`;
}
