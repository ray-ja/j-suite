/* ---------- CAP AUTO-CATEGORIZE — Cap READS a review receipt's photo and PROPOSES a categorization ----------
   On-demand only (vision calls cost tokens on the ORG'S OWN Anthropic key). Owner/admin trigger it from the
   Receipts page; Cap reads each needs-review photo server-side (js/75 org-AI extended for image input) and
   writes the guess to `receipt.suggested` — the EXACT shape the edit modal reads (js/87). The modal FILLS the
   form from the guess by default (on open, and auto-applied on reread); the owner reviews + Saves. Cap never
   files on its own — it only fills the propose→approve hook; it changes no real field, type, job, or billing.

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
    /* ⏱ orgAiFetch (js/75), NOT a bare fetch — a bare fetch has no timeout, and this await is the one the whole
       drain hangs on. See the note there. Falls back to fetch on an old build that predates the helper. */
    const _f = (typeof orgAiFetch === "function") ? orgAiFetch : fetch;
    const r = await _f(base + "/api/org-ai/read-receipt", {
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
  /* ⛔⛔ EVERYTHING FROM HERE IS INSIDE try/finally — DO NOT UNWIND IT.
     Ray, 2026-08-26: "cap is reading 1 of 1, its been there a long time i think its bugged."
     `_capRcptBusy` used to be cleared by a bare assignment near the bottom. Every early exit reached it, so it
     looked safe — but a THROW or a never-settling await skipped it, and then the flag was stuck true for the
     rest of the session. capRcptSweep's very first guard is `if (_capRcptBusy) return`, so from that moment Cap
     read nothing, ever, and said nothing about it: the only symptom was a progress banner frozen mid-count.
     ⚠️ A busy flag set outside a finally is a feature with an off switch and no on switch. */
  let _finished = false;
  try {
  // FLUSH pending writes to the server FIRST. The blob uploads immediately, but the review RECORD (with its
  // receiptId) rides a debounced save() push — the server's rcptOwnedByOrg guard 404s until that record lands.
  // On a mass upload the drain fires the instant the blobs finish, racing the un-pushed records → every read
  // "not found." whenSynced() force-fires the queued push and waits for it, so the records exist before we read.
  try { if (typeof whenSynced === "function") await whenSynced(15000); } catch (e) {}
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
      /* ⚠️ re-assert the banner BEFORE the second read: this is the longest single step in the drain (a second
         vision call, on the smartest model), and a progress bar that goes silent for two full read timeouts is
         indistinguishable from the hang this whole change is about. */
      if (typeof uploadStatus === "function") uploadStatus("reading", { done: done + 1, total: totalNow }, "trying harder");
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
  _finished = true;                                  // reached the end under our own power — the finally stays quiet
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
  else if (!opts.auto) { capRcptSetStatus("🤖 Read " + ok + " receipt" + (ok === 1 ? "" : "s") + (autoFiled ? " · " + autoFiled + " filed for review" : "") + (skipped ? " · " + skipped + " skipped" : "") + "."); }   // quiet status, not a popup — receipts are handled in the Receipts area, no need to interrupt with a message
  // safeRender (js/26) — the auto sweep path runs mid-session; a bare render() here would rebuild #view under a
  // focused text field. Falls back to render() where safeRender isn't loaded (tests).
  { const _rr = (typeof safeRender === "function") ? safeRender : (typeof render === "function" ? render : null); if (_rr) _rr(); }
  } finally {
    /* ⭐ THE FLAG COMES BACK DOWN NO MATTER WHAT — this is the line that keeps one bad read from disabling Cap. */
    _capRcptBusy = false;
    /* ...and if we did NOT get to the end, the banner is still counting a read that will never land. Say so
       rather than leaving it spinning: a wrong-looking error he can dismiss beats a truthful-looking progress
       bar that is lying. It auto-dismisses; the next sweep retries. */
    if (!_finished) {
      try { capRcptSetStatus(""); } catch (e) {}
      try { if (typeof uploadStatus === "function") uploadStatus("error", null, "Cap stopped part-way through reading — it'll try again"); } catch (e) {}
    }
  }
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
  try { if (typeof whenSynced === "function") await whenSynced(15000); } catch (e) {}   // flush this record to the server first (see capRcptRun) so the read isn't a "not found" 404
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
      // reopen the modal, then AUTO-APPLY the fresh read so the fields fill without a tap. A reread only updates
      // `suggested` (not the record's scalar fields), so on reopen the pre-fill would show the OLD values — the user
      // explicitly asked for a fresh read, so apply it. They review + override anything that's off. (No manual
      // "Use Cap's guess" tap — that button is gone; js/87.)
      if (typeof rcptEditOpen === "function") rcptEditOpen(loc.store, loc.jobId, loc.recId);
      if (typeof rcptApplySuggestion === "function") rcptApplySuggestion();
      return;
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = "🤖 Reread — try harder (smartest model)"; }
  // ACCURATE errors — every failure used to collapse to one vague "try again in a moment," so a real problem was
  // indistinguishable from a transient one. Surface what the server actually said, keyed off status.
  const st = res && res.status;
  if (res && res.skip) alert("Cap read it but couldn't make out the details — fill it in by hand.");
  else if (st === 400 && /not set up/i.test(res.error || "")) alert("Cap needs this organization's Anthropic API key. Set it in Admin → Assistant.");
  else if (res && res.error === "offline") alert("You're offline — Cap needs a connection to read receipts.");
  else if (st === 404) alert("That receipt hasn't finished syncing to the server yet. Give it a few seconds and tap Reread again.");
  else if (st === 429) alert("Too many receipts read at once — wait a minute, then tap Reread again.");
  else if (st === 400) alert("Cap can only read JPG, PNG, WEBP, or PDF files — this one isn't a supported image.");
  else if (st === 502) alert("Cap's AI request failed. Check the API key and credits in Admin → Assistant, then try again.");
  else alert("Cap couldn't read this receipt right now" + (res && res.error ? " (" + String(res.error).slice(0, 80) + ")" : "") + ". Try again in a moment.");
};

/* ---------- BULK REREAD (selected or all) ----------------------------------------------------------------
   The auto-drain only reads UNREAD rows (no `suggested`). A row that came back nearly blank still carries a
   (bad) suggestion, so the drain skips it forever and the only fix was opening each one and tapping Reread.
   This rereads ANY review receipt — selected via the row checkboxes, or all of them — with the SMART model. */
var _capRcptSel = Object.create(null);   // review record id -> true (checkbox selection; survives re-renders)
function capRcptRereadAll() { return (typeof rcptReview === "function" ? rcptReview() : []).filter(function (r) { return r && r.receiptId; }); }
function capRcptSelCount() { return Object.keys(_capRcptSel).length; }
function capRcptSelUI() {   // update the reread button label in place (no full re-render on a checkbox tick)
  var b = document.getElementById("cap_rcpt_reread_btn"); if (!b) return;
  var n = capRcptSelCount();
  b.textContent = n ? ("🔁 Reread selected (" + n + ")") : ("🔁 Reread all " + capRcptRereadAll().length);
}
window.capRcptToggleSel = function (id, checked) { if (!id) return; if (checked) _capRcptSel[id] = true; else delete _capRcptSel[id]; capRcptSelUI(); };
window.capRcptSelAll = function () {
  capRcptRereadAll().forEach(function (r) { _capRcptSel[r.id] = true; });
  var b = document.querySelectorAll("input.capRcptChk"); for (var i = 0; i < b.length; i++) b[i].checked = true;
  capRcptSelUI();
};
window.capRcptSelClear = function () {
  _capRcptSel = Object.create(null);
  var b = document.querySelectorAll("input.capRcptChk"); for (var i = 0; i < b.length; i++) b[i].checked = false;
  capRcptSelUI();
};
/* the per-row checkbox cell (owner/admin + a review row with a photo); an aligned empty cell otherwise */
function capRcptRowCheckbox(r) {
  if (!capRcptCanRun() || !r || r.store !== "review" || !r.receiptId) return '<td style="padding:8px 4px"></td>';
  return '<td style="padding:8px 4px;text-align:center" onclick="event.stopPropagation()"><input type="checkbox" class="capRcptChk"' + (_capRcptSel[r.id] ? " checked" : "") + ' onclick="event.stopPropagation();capRcptToggleSel(\'' + r.id + '\',this.checked)" title="Select to reread"></td>';
}
/* Reread selected review receipts (or ALL if none checked) with the SMART model. Mirrors capRcptRun's stamp/
   auto-file spine but over an explicit list INCLUDING already-suggested rows, and always escalates. Never throws. */
window.capRcptReread = async function () {
  if (!capRcptCanRun()) { alert("Only an owner or admin can run Cap."); return; }
  if (_capRcptBusy) { alert("Cap is already reading — let it finish first."); return; }
  const sel = capRcptSelCount();
  const targets = sel
    ? capRcptRereadAll().filter(function (r) { return _capRcptSel[r.id]; })
    : capRcptRereadAll();
  if (!targets.length) { alert("No needs-review receipts with a photo to reread."); return; }
  if (typeof confirm === "function" && !confirm("Reread " + targets.length + " receipt" + (targets.length > 1 ? "s" : "") + " with the smartest model?\nThat runs " + targets.length + " AI read" + (targets.length > 1 ? "s" : "") + " on this organization's key.")) return;
  _capRcptBusy = true;
  try {                                              // ⛔ same finally discipline as capRcptRun — see the note there
  try { if (typeof whenSynced === "function") await whenSynced(15000); } catch (e) {}   // flush records first (see capRcptRun)
  const throttle = capRcptThrottleMs();
  let done = 0, updated = 0, autoFiled = 0, skipped = 0, stop = "";
  for (let i = 0; i < targets.length; i++) {
    const rec = targets[i];
    capRcptSetStatus("🔁 Rereading " + (done + 1) + " of " + targets.length + "…");
    if (typeof uploadStatus === "function") uploadStatus("reading", { done: done + 1, total: targets.length });
    const res = await capRcptRead(rec.receiptId, { escalate: true });   // smart model
    if (res && res.suggested) {
      const live = (typeof rcptFindRecord === "function") ? rcptFindRecord("review", null, rec.id) : rec;
      const records = capRcptFanStamp(live || rec, res.suggested); updated++;
      records.forEach(function (r) { if (capRcptAutoFileOne(r, { batch: true })) autoFiled++; });
      if (typeof save === "function") save();
    } else if (res && res.status === 400 && /not set up/i.test(res.error || "")) { stop = "Cap needs this organization's Anthropic API key. Set it in Admin → Assistant."; break; }
    else if (res && res.error === "offline") { stop = "You went offline — stopped after " + done + ". Reread the rest when you're back."; break; }
    else if (res && res.status === 429) { stop = "Hit the read limit after " + done + ". Wait a minute, then reread the rest."; break; }
    else { skipped++; }
    done++;
    if (i < targets.length - 1 && throttle > 0) await capRcptSleep(throttle);
  }
  _capRcptSel = Object.create(null);
  if (typeof uploadStatus === "function") uploadStatus("hide");
  capRcptSetStatus("");
  if (typeof render === "function") render();
  if (stop) alert(stop);
  else capRcptSetStatus("🔁 Reread " + done + " · " + updated + " updated" + (autoFiled ? " · " + autoFiled + " filed" : "") + (skipped ? " · " + skipped + " unreadable" : "") + ".");   // quiet status, not a popup
  } finally { _capRcptBusy = false; try { if (typeof uploadStatus === "function") uploadStatus("hide"); } catch (e) {} }
};

/* the Cap card on the Receipts page (owner/admin only). Shows whenever ANY review receipt has a photo — not
   just unread ones — so a pile of blank/bad guesses can be rereaded (that pile has suggestions, so the old
   unread-only gate hid this card exactly when it was needed). */
function capRcptButtonHTML() {
  if (!capRcptCanRun()) return "";
  const unread = capRcptTargets().length;                 // review + photo + NO suggestion (auto-drain targets)
  const all = capRcptRereadAll().length;                  // every review receipt with a photo (reread candidates)
  if (!all) return "";
  const sel = capRcptSelCount();
  const rereadLabel = sel ? ("🔁 Reread selected (" + sel + ")") : ("🔁 Reread all " + all);
  return `<div class="card" style="border-left:4px solid #6b3fa0"><div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
    <div class="grow" style="white-space:normal"><b>🤖 Cap: read needs-review</b><div class="sub">Cap reads your needs-review photos <b>one at a time</b> and proposes vendor / amount / type / category / job. New uploads read automatically; use <b>Reread</b> to re-run the <b>smartest model</b> on ones that came out blank or wrong — check the boxes at the left of each row, or reread them all.</div></div>
    <div class="row" style="gap:6px;flex-wrap:wrap;flex:0 0 auto">
      ${unread ? `<button class="btn acc sm" onclick="capRcptRun()">🤖 Read ${unread} new</button>` : ""}
      <button id="cap_rcpt_reread_btn" class="btn ghost sm" onclick="capRcptReread()">${rereadLabel}</button>
      ${all > 1 ? `<button class="btn ghost sm" onclick="capRcptSelAll()">☑ All</button><button class="btn ghost sm" onclick="capRcptSelClear()">✕ None</button>` : ""}
    </div></div>
    <div id="cap_rcpt_status" class="sub" style="text-align:center;color:#6b3fa0;min-height:16px;margin-top:4px"></div></div>`;
}
