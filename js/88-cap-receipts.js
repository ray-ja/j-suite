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

/* review receipts that still have an uploaded file (photo OR pdf) but no Cap suggestion yet. PDFs are now read
   too — the server sends them to Claude as a document block (rental contracts, statements). CSV-imported rows
   carry receiptId:null and are excluded by the truthy receiptId check (they're parsed, not vision-read). */
function capRcptTargets() {
  return rcptReview().filter(r => r && r.receiptId && !r.suggested);
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

/* POST one receipt to the org-AI vision endpoint. Returns {suggested} | {skip,reason} | {error}.
   opts.escalate:true sends escalate:true so the SERVER reads with the smartest model (Opus 4.8) instead of the
   default Sonnet 4.6 — the client only sends the boolean; the server maps it to the model (no free-form model). */
async function capRcptRead(receiptId, opts) {
  opts = opts || {};
  const base = (typeof orgAiBase === "function") ? orgAiBase() : "";
  if (!base) return { error: "offline" };
  const ctx = capRcptCtx();
  try {
    const body = { org: S.biz, receiptId: receiptId, jobs: ctx.jobs, cats: ctx.cats };
    if (opts.escalate === true) body.escalate = true;
    const r = await fetch(base + "/api/org-ai/read-receipt", {
      method: "POST",
      headers: (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) return { error: (j && j.error) || ("HTTP " + r.status), status: r.status };
    return j || { error: "empty response" };
  } catch (e) { return { error: (e && e.message) || "request failed" }; }
}

/* SHARED READ-APPLY — FAN OUT a multi-transaction read (a bank/card STATEMENT, or several receipts photographed
   together). If the read carries `suggested.transactions` with ≥2 valid entries, the source record takes
   transactions[0] and each further entry i≥1 spawns a DETERMINISTIC sibling review record (rec.id + "_tx" + i)
   that SHARES the same source image — idempotent, so re-reading the same statement NEVER duplicates. Returns the
   list of records now carrying a suggestion (primary first), so the caller runs the normal auto-apply per record.
   A SINGLE transaction (or none) → [liveRec] with liveRec.suggested = the whole suggestion, EXACTLY as before.
   Never throws. Used by BOTH the auto-drain (capRcptRun) and the manual reread (capRcptOne). */
function capRcptFanStamp(liveRec, suggested) {
  if (!liveRec) return [];
  var txs = (suggested && Array.isArray(suggested.transactions)) ? suggested.transactions : [];
  if (txs.length < 2 || typeof rcptNewReviewSibling !== "function" || typeof rcptTxToSuggested !== "function") {
    liveRec.suggested = suggested; if (typeof touch === "function") touch(liveRec);   // single-object path — unchanged
    return [liveRec];
  }
  var out = [];
  liveRec.suggested = rcptTxToSuggested(txs[0], suggested);   // primary keeps the source record + first transaction
  if (typeof touch === "function") touch(liveRec);
  out.push(liveRec);
  for (var i = 1; i < txs.length; i++) {
    var sib = rcptNewReviewSibling(liveRec, i, rcptTxToSuggested(txs[i], suggested));   // deterministic _tx sibling, shares the image
    if (sib && !sib.deleted) out.push(sib);
  }
  return out;
}
/* AUTO-FILL one stamped review record from Cap's confident guess — applies the fields (type/job/category/
   amount/vendor/card) to the record but KEEPS IT IN NEEDS REVIEW (keepReview) so the owner reviews + files it.
   Cap fills, the owner files. Uses the same one-tap spine (rcptSuggestionOneTapOk → rcptFileSuggestion) with the
   confirmation-only refund/deposit guard. Returns true iff it applied. Never throws. opts.batch defers save(). */
function capRcptAutoFileOne(rec, opts) {
  opts = opts || {};
  try {
    if (!rec || rec.deleted || !rec.suggested) return false;
    if (typeof rcptSuggestionOneTapOk !== "function" || typeof rcptFileSuggestion !== "function") return false;
    if (!rcptSuggestionOneTapOk(rec)) return false;
    var fres = rcptFileSuggestion("review", null, rec.id, { batch: opts.batch !== false, keepReview: true });   // FILL — stays in Needs review
    return !!(fres && fres.ok);
  } catch (e) { return false; }
}

/* LEFTOVER CONFIDENT SUGGESTIONS — review rows that ALREADY carry a `suggested` which clears the one-tap bar
   (rcptSuggestionOneTapOk: high confidence · real amount · business OR a resolvable job) but were never applied
   (e.g. restored/synced back AFTER the auto-file pass, so they keep `suggested` yet blank record fields and sit
   in review). These are NOT re-read by the drain (they already have a suggestion), so without this they'd stew
   in the queue forever. A pass-through/job-expense suggestion with NO resolvable job FAILS rcptSuggestionOneTapOk
   → stays in review for the owner to pick a job (the js/87 pre-fill makes that: open → pick job → Save). Pure/
   DOM-free + never-throws so the sweep can call it offline (files locally — rcptFileSuggestion makes NO network
   call).
     `!r.type` IS THE TERMINATION CONDITION — only rows whose fields are still BLANK (unapplied) qualify. Since
   "Cap fills, you file" (86c3049), the auto-file runs keepReview:true: it applies Cap's fields but the row STAYS
   in review WITH its `suggested`. Without the !r.type guard the row matched this filter again on the very next
   sweep → re-applied → save() → sync push → sync-complete sweep → re-applied → … an INFINITE sync/render loop
   (the badge pinned on "⟳ Syncing…" and a render() kicking the user out of text fields, 24/7, for days — Ray's
   2026-07-13→16 field bug). A fill always sets r.type (oneTapOk guarantees a non-null suggested.type), so a
   filled row drops out here and the sweep terminates; a genuinely blank restored row (type null) still re-fills
   exactly once. This also stops the sweep from clobbering an owner's manual edits (typed fields ⇒ type set ⇒
   never re-applied over them). */
function capRcptReapplyPending() {
  try {
    if (typeof rcptReview !== "function" || typeof rcptSuggestionOneTapOk !== "function") return [];
    return rcptReview().filter(function (r) { return r && !r.deleted && r.suggested && !r.type && rcptSuggestionOneTapOk(r); });
  } catch (e) { return []; }
}
/* RE-FILE those leftover confident rows through the EXACT auto-file spine (capRcptAutoFileOne → rcptFileSuggestion),
   each stamped capAutoFiled (purple "🤖 review"). IDEMPOTENT — a filed row leaves the review store, so a re-run
   finds nothing; never re-applies an already-filed / human-touched record. Owner/admin gated by the caller.
   opts.batch defers the save to the caller. Returns the count filed. Never throws. */
function capRcptReapplyConfident(opts) {
  opts = opts || {};
  var filed = 0;
  try {
    var rows = capRcptReapplyPending();
    for (var i = 0; i < rows.length; i++) { if (capRcptAutoFileOne(rows[i], { batch: true })) filed++; }
    if (filed && !opts.batch && typeof save === "function") save();
  } catch (e) {}
  return filed;
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
  if (!capRcptPending().length) { if (!opts.auto) alert("No needs-review receipts left for Cap to read (Cap skips ones it's already read)."); return; }
  _capRcptBusy = true;
  const throttle = capRcptThrottleMs();
  let done = 0, ok = 0, autoFiled = 0, skipped = 0, keyMissing = false, offline = false, capped = false;
  while (true) {
    const pending = capRcptPending();
    if (!pending.length) break;                       // drained — nothing unread remains
    if (done >= CAP_RCPT_CEILING) { capped = true; break; }   // safety ceiling — resumable sweep reads the rest
    const rec = pending[0];
    const totalNow = done + pending.length;            // live denominator (grows if sync injects more mid-drain)
    capRcptSetStatus("🤖 Cap is reading " + (done + 1) + " of " + totalNow + (totalNow > 25 ? " receipts" : "") + "…");
    // ALSO surface progress in the prominent body-mounted banner (js/104) — visible on EVERY page, not just Receipts
    if (typeof uploadStatus === "function") uploadStatus("reading", { done: done + 1, total: totalNow });
    let res = await capRcptRead(rec.receiptId);        // ONE dedicated vision call — sequential, never parallel (default: Sonnet)
    // AUTO ESCALATE-ON-MISS: if the default read couldn't produce a suggestion (unparseable / skip — NOT offline
    // or a missing key), retry this ONE receipt with the smartest model (Opus) before giving up. So an upload gets
    // read automatically without the owner opening it and tapping "Reread — try harder" (Ray's daily complaint).
    if (!(res && res.suggested) && !(res && res.error === "offline") && !(res && res.status === 400 && /not set up/i.test(res.error || ""))) {
      const _esc = await capRcptRead(rec.receiptId, { escalate: true });
      if (_esc && _esc.suggested) res = _esc; else if (_esc && (_esc.error === "offline" || (_esc.status === 400 && /not set up/i.test(_esc.error || "")))) res = _esc;
    }
    if (res && res.suggested) {
      // re-find the live record (the store may have changed) and stamp `suggested`
      const live = (typeof rcptFindRecord === "function") ? rcptFindRecord("review", null, rec.id) : rec;
      const tgt = live || rec;
      // FAN-OUT (statement / multiple receipts): capRcptFanStamp stamps the source record with transactions[0] and
      // spawns one DETERMINISTIC sibling review row per further transaction (same image, idempotent). A single/normal
      // read → just [tgt] with tgt.suggested = res.suggested, exactly as before. ok++ counts the READ (one vision call).
      const records = capRcptFanStamp(tgt, res.suggested); ok++;
      // AUTO-APPLY (Ray's default — "I'm always going to use it and then just review it") PER RECORD: each record that
      // clears the one-tap bar (rcptSuggestionOneTapOk — high confidence · real amount · job resolved or business) is
      // filed NOW through the EXACT spine the "✓ file it" button uses (rcptFileSuggestion → a POSITIVE-amount record,
      // never a refund), stamped with the purple "🤖 review" markers. A fanned statement files each of its N rows the
      // same way. Never-throws: a failed / low-confidence one just stays a suggested review row (today's behavior).
      records.forEach(function (r) { if (capRcptAutoFileOne(r, { batch: true })) autoFiled++; });
      if (typeof save === "function") save();          // persist as we go → resumable across an app-close
    } else if (res && res.status === 400 && /not set up/i.test(res.error || "")) { keyMissing = true; break; }
    else if (res && res.error === "offline") { offline = true; break; }   // connectivity gone — stop churning; the sweep resumes on reconnect
    else { skipped++; _capRcptSkip[rec.id] = 1; }      // parse/unreadable error → skip THIS session, keep draining the rest (no retry-loop)
    done++;
    if (capRcptPending().length && done < CAP_RCPT_CEILING && throttle > 0) await capRcptSleep(throttle);
  }
  // Also RE-FILE any leftover CONFIDENT already-suggested review rows (carried a suggestion but blank fields —
  // never read again since they already have one). Idempotent; batch-saved with the drain below. Local, no fetch.
  try { autoFiled += capRcptReapplyConfident({ batch: true }); } catch (e) {}
  if ((ok || autoFiled) && typeof save === "function") save();
  _capRcptBusy = false;
  capRcptSetStatus(capped ? "🤖 Cap read " + done + " — more will read shortly…" : "");
  // Terminal banner (js/104): ✓ only when ≥1 was actually read; capped appends "more will read shortly";
  // key-missing/offline hide gracefully (no false ✓); read-nothing hides (no phantom bar on a 0-unread sweep).
  if (typeof uploadStatus === "function") {
    try {
      if (keyMissing || offline) uploadStatus("hide");
      else if (ok >= 1) uploadStatus("read-done", ok, capped ? "more will read shortly" : null);
      else uploadStatus("hide");
    } catch (e) {}
  }
  if (keyMissing) { if (!opts.auto) alert("Cap needs this organization's Anthropic API key. Set it in Admin → Assistant, then try again."); }
  else if (!opts.auto) { alert("🤖 Cap read " + ok + " receipt" + (ok === 1 ? "" : "s") + (autoFiled ? " · auto-filed " + autoFiled + " for review" : "") + (skipped ? " (" + skipped + " skipped)" : "") + (capped ? " — more will read shortly" : "") + ". " + (autoFiled ? "The purple 🤖 review rows are Cap's — check them (use the “🤖 To review” filter)." : "Open a 🤖 row to review and approve its guess.")); }
  // safeRender (js/26) — the auto sweep path runs mid-session; a bare render() here would rebuild #view under a
  // focused text field. Falls back to render() where safeRender isn't loaded (tests).
  { const _rr = (typeof safeRender === "function") ? safeRender : (typeof render === "function" ? render : null); if (_rr) _rr(); }
};

/* RESUMABLE SWEEP — reads any unread receipts left by an interrupted batch / an app-close, OR ones that arrived
   via sync from another device / the server. Fires on app open (the boot pull) + after every sync (js/26),
   owner/admin + key gated, once-per-window (bounds re-tries of stuck receipts), never-throws, no-op at 0 unread.
   Fire-and-forget: capRcptRun drains + re-renders itself. */
window.capRcptSweep = function () {
  try {
    if (!capRcptCanRun()) return;                       // owner/admin only (auto path is silent)
    if (_capRcptBusy) return;                            // a drain is already running
    // (A) RE-FILE leftover CONFIDENT already-suggested review rows FIRST — LOCAL (no server/key needed): these are
    // restored/synced-back rows carrying `suggested` but BLANK fields (type null) that the drain never re-reads.
    // Idempotent (the fill sets r.type → capRcptReapplyPending drops it). safeRender, never a bare render(): this
    // runs on EVERY sync completion — a bare render() here rebuilt #view under the user's cursor mid-typing.
    if (capRcptReapplyPending().length) { if (capRcptReapplyConfident()) { var _rr = (typeof safeRender === "function") ? safeRender : render; if (typeof _rr === "function") _rr(); } }
    // (B) VISION DRAIN of the still-UNREAD pile — needs the org AI server + key.
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

/* single-receipt REREAD from the edit modal ("🤖 Reread — try harder") — uses the currently-open RCPT_EDIT.
   ESCALATES to the smartest model (Opus 4.8) via {escalate:true}, for the receipts Cap got wrong on the
   default Sonnet read. Ray taps it whenever he thinks the first guess is off. */
window.capRcptOne = async function () {
  if (!capRcptCanRun()) return;
  if (typeof RCPT_EDIT === "undefined" || !RCPT_EDIT || !RCPT_EDIT.receiptId) { alert("No photo on this receipt for Cap to read."); return; }
  const btn = document.getElementById("cap_rcpt_one_btn"); if (btn) { btn.disabled = true; btn.textContent = "🤖 Rereading with the smartest model…"; }
  const res = await capRcptRead(RCPT_EDIT.receiptId, { escalate: true });
  if (res && res.suggested) {
    const loc = RCPT_EDIT.loc || {};
    const live = (typeof rcptFindRecord === "function") ? rcptFindRecord(loc.store, loc.jobId, loc.recId) : null;
    if (live) {
      // FAN-OUT honored on the REREAD too — this is how Ray's already-stuck blank statement gets fixed: he taps
      // "🤖 Reread — try harder" on it and it splits into one review row per transaction. The primary (this open
      // record) takes transactions[0] and reopens in the modal for him to review; each further transaction becomes
      // a deterministic sibling review row (same image, idempotent) that AUTO-FILES if confident — so no negative
      // surprise (rcptFileSuggestion files positive). A single/normal read → unchanged: just stamps live.suggested.
      const records = capRcptFanStamp(live, res.suggested);
      records.forEach(function (r, i) { if (i >= 1) capRcptAutoFileOne(r, { batch: true }); });   // siblings auto-file; primary reopens for review
      if (loc.store === "jobmat" || loc.store === "jobexp") { const jb = (D().jobs || []).find(x => x && x.id === loc.jobId); if (jb && typeof touch === "function") touch(jb); }
      else if (typeof touch === "function") touch(live);
      if (typeof save === "function") save();
      // reopen the modal so the "🤖 Cap suggests" banner + "Use Cap's guess" button render (js/87)
      if (typeof rcptEditOpen === "function") rcptEditOpen(loc.store, loc.jobId, loc.recId);
      return;
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = "🤖 Reread — try harder (smartest model)"; }
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
    <div class="grow" style="white-space:normal"><b>🤖 Cap: categorize needs-review</b><div class="sub">Cap reads your needs-review photos <b>one at a time</b> and proposes vendor / amount / type / category / job for each. Confident guesses are <b>auto-filed</b> and marked <span style="color:#6b3fa0">🤖 review</span> (purple) for you to review; anything unsure stays here for you to approve.</div></div>
    <button class="btn acc sm" onclick="capRcptRun()">🤖 Read ${n}</button></div>
    <div id="cap_rcpt_status" class="sub" style="text-align:center;color:#6b3fa0;min-height:16px;margin-top:4px"></div></div>`;
}
