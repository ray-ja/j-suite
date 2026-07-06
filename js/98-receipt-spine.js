/* ---------- RECEIPT SPINE — shared smart-defaults + the ONE file-from-fields funnel (Phase A) ----------
   The reusable plumbing every other receipt-smoothing phase funnels through, so Cap (Phase C), snap→one-tap
   (Phase B), bulk-approve (Phase B) and the floating capture (Phase D) all land a receipt through the SAME
   path a human uses in the edit modal — js/87 rcptApplyEdit. NO new money math, NO new collection: a filed
   record is BYTE-IDENTICAL to the manual Save (identity-tested in receipts-tests.js).

     rcptSmartDefaults(ctx)      pure — {jobId,type,paidBy,cardLast4,category} from context (clocked-in job,
                                 your card, per-vendor memory). NO writes.
     rcptVendorMemory(vendor)    pure/derived — the last filed receipt's category+bucket for a vendor. No store.
     rcptFileFromFields(f,opts)  THE funnel — gap-fill from smart-defaults → validate (same guards as
                                 rcptSaveEdit) → rcptNewReview stub → rcptApplyEdit (the human save path).
     rcptSuggestionOneTapOk(rec) pure — is Cap's suggestion safe to file in one tap? (Phase B)
     rcptFileSuggestion(...)     route an EXISTING review row from its suggestion in place. (Phase B)  */

var RCPT_ONE_TAP_MIN = 0.8;   // Cap confidence floor for a one-tap "file it" (Ray's default)

/* ---- current signed-in user id (falls back to "" headless / signed-out) ---- */
function _rcptMeId(explicit) {
  if (explicit) return explicit;
  var u = (typeof curUser === "function") ? curUser() : null;
  return (u && u.id) ? u.id : "";
}
/* ---- last-4 normalizer (reuse js/94 cardClean4 when present) ---- */
function _rcpt4(v) {
  if (typeof cardClean4 === "function") return cardClean4(v);
  return String(v == null ? "" : v).replace(/\D/g, "").slice(-4);
}
/* ---- a value counts as "blank" (needs a default) ---- */
function _rcptBlank(v) { return v == null || v === ""; }

/* ============================== PER-VENDOR MEMORY (derived, no store) ==============================
   The self-correcting per-vendor category/type: the newest non-deleted FILED receipt whose vendor matches
   (case-insensitively) — its category, and its bucket→type (job.materials→pass-through, job.expenses→
   job-expense, org expenses→business). Mirrors the unassignedCards pattern: derived from history, no new
   collection, always current. Pure, offline, never throws. */
function rcptVendorMemory(vendor) {
  try {
    var v = String(vendor == null ? "" : vendor).trim().toLowerCase();
    if (!v) return null;
    if (typeof rcptAllFiled !== "function") return null;
    var filed = rcptAllFiled();   // already non-deleted + newest-first (sorted by ts desc)
    for (var i = 0; i < filed.length; i++) {
      var e = filed[i];
      if (!e || String(e.vendor == null ? "" : e.vendor).trim().toLowerCase() !== v) continue;
      var type = e.store === "jobmat" ? "pass-through" : e.store === "jobexp" ? "job-expense" : e.store === "biz" ? "business" : "";
      return { category: e.category || "", type: type };
    }
    return null;
  } catch (x) { return null; }
}

/* ============================== SMART DEFAULTS (pure, no writes) ==============================
   ctx = {vendor?, meId?}. Returns the best-guess {jobId,type,paidBy,cardLast4,category} for a new receipt:
     jobId    = the job you're CLOCKED INTO now (js/38 tcOpenShift) else your ONLY job today (crew includes you)
     paidBy   = you, when you have a PERSONAL card (reimburse); "" for a business-only card (no reimburse)
     cardLast4= that card's last 4
     type+cat = per-vendor memory (rcptVendorMemory)
   Every field independently degrades to "" so a missing context never invents data. */
function rcptSmartDefaults(ctx) {
  ctx = ctx || {};
  var meId = _rcptMeId(ctx.meId);
  var jobId = "", paidBy = "", cardLast4 = "", type = "", category = "";

  // JOB — clocked-in shift first, else your one-and-only job today
  try {
    if (meId && typeof tcOpenShift === "function") { var sh = tcOpenShift(meId); if (sh && sh.jobId) jobId = sh.jobId; }
    if (!jobId && meId && typeof D === "function") {
      var td = (typeof today === "function") ? today() : "";
      if (td) {
        var mine = (D().jobs || []).filter(function (j) {
          return j && !j.deleted && !Array.isArray(j.sharedJobIds) && j.date === td && Array.isArray(j.crew) && j.crew.indexOf(meId) >= 0;
        });
        if (mine.length === 1) jobId = mine[0].id;
      }
    }
  } catch (x) {}

  // CARD / WHO PAID — your personal card (reimburse you) beats a business-only card (no reimburse)
  try {
    var cards = (typeof cardMyList === "function") ? cardMyList() : [];
    var personal = null, business = null;
    for (var i = 0; i < cards.length; i++) { var c = cards[i]; if (!c) continue; if (c.kind === "business") { if (!business) business = c; } else if (!personal) personal = c; }
    if (personal) { paidBy = meId; cardLast4 = _rcpt4(personal.last4); }
    else if (business) { paidBy = ""; cardLast4 = _rcpt4(business.last4); }
  } catch (x) {}

  // TYPE + CATEGORY — per-vendor memory
  try { var mem = rcptVendorMemory(ctx.vendor); if (mem) { type = mem.type || ""; category = mem.category || ""; } } catch (x) {}

  return { jobId: jobId, type: type, paidBy: paidBy, cardLast4: cardLast4, category: category };
}

/* ---- gap-fill: caller VALUES WIN; only blank fields inherit the smart default ---- */
function _rcptMergeDefaults(fields, meId) {
  var f = {};
  for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) f[k] = fields[k];
  var d = rcptSmartDefaults({ vendor: f.vendor, meId: meId });
  ["jobId", "type", "paidBy", "cardLast4", "category"].forEach(function (k) {
    if (_rcptBlank(f[k]) && !_rcptBlank(d[k])) f[k] = d[k];
  });
  return f;
}

/* ---- the SAME validation guards rcptSaveEdit enforces — returns an error string, or "" when clean.
   (No alert here: the caller decides how to surface it.) Only a FILED type (business/job-expense/
   pass-through) is guarded; a review stub with no type is always allowed. ---- */
function rcptFileValidate(f) {
  var type = f.type || "";
  var amt = (f.amount == null || f.amount === "") ? null : (+f.amount || 0);
  var isRefund = f.kind === "refund";
  if ((type === "job-expense" || type === "pass-through") && !f.jobId) return "Pick a job for this receipt (or set it to Business / leave it for review).";
  if (type && (amt == null || amt === 0)) return "Enter the amount to file this receipt.";
  if (type && amt < 0 && !isRefund) return "A negative amount is only for a refund/credit — mark it a refund to file it.";
  if (type && !(String(f.vendor || "").trim())) return "Enter the vendor / where it was bought.";
  return "";
}

/* ============================== THE ONE FUNNEL ==============================
   rcptFileFromFields(fields, opts) — files a receipt from a plain field bag, exactly the way a human Save does:
     (a) gap-fill blanks from rcptSmartDefaults (caller values win),
     (b) validate the SAME guards as rcptSaveEdit (returns {ok:false,error} — no alert),
     (c) create a rcptNewReview stub then rcptApplyEdit({store:"review",...}) → BYTE-IDENTICAL to the manual save
         (all deposit/refund/card/split carry-through runs unchanged inside rcptApplyEdit),
     (d) logChange + save() UNLESS opts.batch (the caller saves once for a whole batch).
   opts = {meId?, batch?}. Returns {ok:true,newLoc} | {ok:false,error}. Reuses rcptApplyEdit — no new routing. */
function rcptFileFromFields(fields, opts) {
  opts = opts || {};
  if (typeof rcptApplyEdit !== "function" || typeof rcptNewReview !== "function") return { ok: false, error: "receipt engine not loaded" };
  var f = _rcptMergeDefaults(fields || {}, opts.meId);
  var err = rcptFileValidate(f);
  if (err) return { ok: false, error: err };
  // stub in the review collection, then route it the human way
  var stub = rcptNewReview(f.receiptId || null);
  var coll = (typeof rcptColl === "function") ? rcptColl() : (function () { var d = D(); if (!Array.isArray(d.receipts)) d.receipts = []; return d.receipts; })();
  coll.push(stub);
  var res = rcptApplyEdit({ store: "review", jobId: null, recId: stub.id }, f);
  if (!res || !res.ok) {
    // roll the stub back so a failed file never leaves an orphan in the review queue
    stub.deleted = true; if (typeof touch === "function") touch(stub);
    return { ok: false, error: (res && res.error) || "could not file receipt" };
  }
  if (!opts.batch) {
    if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Receipt filed — " + ((f.amount != null && typeof money === "function") ? money(f.amount) : "") + (f.vendor ? " · " + f.vendor : "") + " · " + (f.type || "review") + (f.jobId ? " → job" : ""));
    if (typeof save === "function") save();
  }
  return res;
}

/* ============================== CAP SUGGESTION → ONE-TAP (Phase B) ==============================
   Is Cap's `suggested` categorization safe enough to file in a single tap (no modal)? High confidence + a real
   positive amount + a real filed type + a resolvable job (or a business expense, which needs none). */
function rcptSuggestionOneTapOk(rec) {
  var s = rec && rec.suggested;
  if (!s) return false;
  if (!(typeof s.confidence === "number" && s.confidence >= RCPT_ONE_TAP_MIN)) return false;
  if (!(s.amount > 0)) return false;
  if (s.type !== "business" && s.type !== "job-expense" && s.type !== "pass-through") return false;
  if (s.type === "business") return true;
  if (s.jobId) return true;
  try { return !!rcptSmartDefaults({ vendor: s.vendor, meId: _rcptMeId() }).jobId; } catch (x) { return false; }
}

/* ============================== FILE AN EXISTING REVIEW ROW FROM ITS SUGGESTION (Phase B) ==============================
   Routes the review row already in the queue (store/jobId/recId) using Cap's suggestion merged with smart-defaults,
   through the SAME rcptApplyEdit path — NOT a fresh stub. opts = {batch?} to defer the save for a bulk apply. */
function rcptFileSuggestion(store, jobId, recId, opts) {
  opts = opts || {};
  if (typeof rcptApplyEdit !== "function" || typeof rcptFindRecord !== "function") return { ok: false, error: "receipt engine not loaded" };
  var rec = rcptFindRecord(store, jobId, recId);
  if (!rec) return { ok: false, error: "record not found" };
  var s = rec.suggested; if (!s) return { ok: false, error: "no suggestion to file" };
  var amount = (s.amount == null) ? null : (s.refund ? -Math.abs(+s.amount || 0) : (+s.amount || 0));
  var raw = {
    type: s.type || null, jobId: s.jobId || null, amount: amount, vendor: s.vendor || rec.vendor || "",
    date: s.date || rec.date || "", category: s.category || "", desc: s.desc || rec.desc || "",
    paidBy: null, receiptId: rec.receiptId || null, cardLast4: s.last4 || "",
    isDeposit: !!s.deposit, kind: s.refund ? "refund" : ""
  };
  var f = _rcptMergeDefaults(raw, _rcptMeId());
  var err = rcptFileValidate(f);
  if (err) return { ok: false, error: err };
  var res = rcptApplyEdit({ store: store, jobId: jobId, recId: recId }, f);
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || "could not file receipt" };
  if (!opts.batch) {
    if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Receipt filed from Cap — " + ((f.amount != null && typeof money === "function") ? money(f.amount) : "") + (f.vendor ? " · " + f.vendor : "") + " · " + (f.type || "review") + (f.jobId ? " → job" : ""));
    if (typeof save === "function") save();
  }
  return res;
}

if (typeof window !== "undefined") {
  window.rcptSmartDefaults = rcptSmartDefaults;
  window.rcptVendorMemory = rcptVendorMemory;
  window.rcptFileFromFields = rcptFileFromFields;
  window.rcptFileValidate = rcptFileValidate;
  window.rcptSuggestionOneTapOk = rcptSuggestionOneTapOk;
  window.rcptFileSuggestion = rcptFileSuggestion;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { rcptSmartDefaults: rcptSmartDefaults, rcptVendorMemory: rcptVendorMemory, rcptFileFromFields: rcptFileFromFields, rcptFileValidate: rcptFileValidate, rcptSuggestionOneTapOk: rcptSuggestionOneTapOk, rcptFileSuggestion: rcptFileSuggestion };
}
