/* ---------- RECEIPTS — mass upload + sortable, CLICK-TO-EDIT table (Money → Receipts) ----------
   The owner dumps a stack of receipt photos in now and categorizes them later, then invoices off them.

   DATA MODEL (correct + reversible — see CLAUDE.md data rules):
     • A new synced top-level `receipts` collection is the HOME for UNASSIGNED / "needs review" uploads only
       (each {id, receiptId(photo), amount, vendor, date, type, jobId, category, paidBy, desc, uploadedBy, by,
        status:"review", suggested, ts, deleted, updatedAt}). Mass upload writes review records here.
     • ATTRIBUTED receipts still live in their EXISTING billing arrays — job.materials[] (pass-through, billed
       to the customer), job.expenses[] (job expense, reimbursed to the uploader), and this org's `expenses[]`
       (plain business expense). Those arrays + all billing/P&L/invoicing code are UNCHANGED, so job cost +
       customer invoicing math stay byte-identical. When a review receipt is attributed (or a filed one is
       re-bucketed) it MOVES between arrays PRESERVING its id + photo (js/87 rcptApplyEdit) — never a
       delete-and-remake. One receipt lives in exactly ONE array at a time, so the table never double-counts.
     • The on-the-job uploads (js/61 jobAddExpense/jobAddMaterial) are untouched and feed the SAME arrays, so
       everything they log shows up in this table too.
   The Receipts table AGGREGATES all four homes into one sortable, click-to-edit view. */

const RCPT_CATS = ["materials", "tools/equipment", "disposal", "fuel", "rentals", "subscription/software", "marketing/ads", "uniforms", "meals", "crew supplies", "office/admin", "other"];
let RCPT_SORT = { col: "date", dir: "desc" };   // survives re-render; header taps toggle
let RCPT_FILTER = "all";                          // all | review | filed | owed | paidback (status pills)
let RCPT_JOBFILTER = "needs";                      // owner close-out roll-up: needs | ready | all
// DISPLAY-ONLY search + filters (mirror the Jobs list js/08). Survive re-render so they persist across sort/
// status-pill taps. Applied in rcptSortedRows() AFTER the status pill, BEFORE sort. NO data/schema/billing
// effect — they only narrow which existing rows the table shows (fingerprints unchanged).
// The five value filters are MULTI-SELECT: each is an ARRAY of chosen values (checkboxes). Empty array = that
// filter is OFF (show all). Semantics: OR within one filter (a row passes if its value is IN that filter's
// set), AND across filters (a row must pass every non-empty filter). Search + date range stay single-value.
let RCPT_SEARCH = "";       // free-text substring over vendor/desc/amount/category/card/job/customer/person
let RCPT_TYPEFS = [];       // [] | selected of review|business|job-expense|pass-through  (via rcptRowMeta().type)
let RCPT_CATFS = [];        // [] | selected categories (r.category)
let RCPT_PERSONFS = [];     // [] | selected userIds — a row matches if uploadedBy OR attributedTo is any selected
let RCPT_JOBFS = [];        // [] | selected jobIds (r.jobId)
let RCPT_CARDFS = [];       // [] | selected card last-4s (rcptCard4(r.cardLast4))
let RCPT_DFROM = "";        // "" | YYYY-MM-DD (rcptDate(r) >= from)
let RCPT_DTO = "";          // "" | YYYY-MM-DD (rcptDate(r) <= to)
let _rcptBulkBusy = false;                          // Phase B: guard the bulk "file all confident" so a double-tap can't double-file

function rcptColl() { const d = D(); if (!Array.isArray(d.receipts)) d.receipts = []; return d.receipts; }
function rcptReview() { return rcptColl().filter(r => r && !r.deleted && r.status === "review"); }
function rcptMembers() { return (typeof schedMembers === "function") ? schedMembers() : []; }
function rcptJobs() { return ((typeof actJ === "function") ? actJ() : []).filter(j => j && !j.deleted && !Array.isArray(j.sharedJobIds)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))); }
function rcptFinFull() { return (typeof finCanView === "function") ? finCanView() : (typeof isOwner === "function" ? isOwner() : true); }   // owner/admin: full financial table + editing
function rcptMe() { return (typeof curUser === "function") ? curUser() : null; }

/* ============================== PER-JOB RECEIPT CLOSE-OUT ==============================
   Each crew member marks a job "closed out" for receipts — "I've submitted all my expenses/receipts for this
   job, I have no more to report." Lives on job.receiptsClosedBy = [{userId,ts}] (additive, rides the job's LWW;
   see js/02 blank()/load()). A job is FULLY closed — safe for the owner to invoice accurately — when every
   assigned, active crew member has closed out. Reversible (a crew member can reopen their own entry). */
function jobReceiptsClosedBy(job) { return (job && Array.isArray(job.receiptsClosedBy)) ? job.receiptsClosedBy.filter(x => x && x.userId) : []; }
function jobReceiptsClosedByMe(job, meId) { return !!meId && jobReceiptsClosedBy(job).some(x => x.userId === meId); }
/* the set of currently-active account ids (real team members) — used to ignore stale/removed crew ids */
function rcptActiveIdSet() { const s = {}; ((typeof schedMembers === "function") ? schedMembers() : []).forEach(u => { if (u && u.id) s[u.id] = 1; }); return s; }
/* a job's ASSIGNED crew, narrowed to still-active accounts (a deactivated member can't block "fully closed") */
function jobCrewActiveIds(job) { const act = rcptActiveIdSet(); return (job && Array.isArray(job.crew) ? job.crew : []).filter(id => id && act[id]); }
/* every active assigned crew member has closed out. Requires ≥1 active crew — a job with nobody assigned is
   NOT "fully closed" (there's no crew whose sign-off we're gating the invoice on), so it never shows a false
   "ready to invoice" signal. */
function jobReceiptsFullyClosed(job) {
  const crew = jobCrewActiveIds(job);
  if (!crew.length) return false;
  const closed = jobReceiptsClosedBy(job).map(x => x.userId);
  return crew.every(id => closed.indexOf(id) >= 0);
}
/* active crew who have NOT yet closed out (the "waiting on…" list) */
function jobReceiptsOpenCrew(job) { const closed = jobReceiptsClosedBy(job).map(x => x.userId); return jobCrewActiveIds(job).filter(id => closed.indexOf(id) < 0); }
/* count of THIS person's receipts on a job (on-job billing arrays + any review upload tagged to the job) */
function rcptMyCountOnJob(job, meId) {
  if (!job || !meId) return 0;
  let n = (job.materials || []).concat(job.expenses || []).filter(e => e && !e.deleted && (e.uploadedBy === meId || e.attributedTo === meId || e.paidBy === meId)).length;
  n += rcptReview().filter(r => r.jobId === job.id && rcptIsMine(r, meId)).length;
  return n;
}
/* jobId → 1 for every real (non-deleted, non-stop) job this person WORKED: on the crew, has a receipt/expense
   attributed to them, or has a timeclock entry on it. Drives the crew close-out queue. */
function rcptMyJobIds(meId) {
  const set = {};
  if (!meId) return set;
  (D().jobs || []).forEach(j => {
    if (!j || j.deleted || Array.isArray(j.sharedJobIds)) return;   // skip stop/overhead sub-jobs (match rcptJobs())
    if ((j.crew || []).indexOf(meId) >= 0) { set[j.id] = 1; return; }
    if ((j.materials || []).concat(j.expenses || []).some(e => e && !e.deleted && (e.uploadedBy === meId || e.attributedTo === meId || e.paidBy === meId))) { set[j.id] = 1; return; }
    if (rcptReview().some(r => r.jobId === j.id && rcptIsMine(r, meId))) set[j.id] = 1;
  });
  (D().timeclock || []).forEach(e => { if (e && !e.deleted && e.userId === meId && e.jobId) set[e.jobId] = 1; });
  return set;
}
function rcptWorkedJobsForMe(meId) {
  const ids = rcptMyJobIds(meId);
  return Object.keys(ids)
    .map(id => (D().jobs || []).find(j => j && j.id === id && !j.deleted && !Array.isArray(j.sharedJobIds)))
    .filter(Boolean)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
/* CLOSE / REOPEN — scoped to ME only: the handlers never touch anyone else's entry, so a crew member can
   only close/reopen their OWN status (can't sign off for a teammate). Idempotent (dup entries impossible). */
window.jobCloseReceipts = function (jobId) {
  const me = rcptMe(), meId = me ? me.id : ""; if (!meId) return;
  const j = (D().jobs || []).find(x => x && x.id === jobId && !x.deleted); if (!j) return;
  if (!Array.isArray(j.receiptsClosedBy)) j.receiptsClosedBy = [];
  if (j.receiptsClosedBy.some(x => x && x.userId === meId)) return;   // already closed — idempotent no-op
  j.receiptsClosedBy.push({ userId: meId, ts: now() });
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Closed out receipts — " + ((typeof userName === "function" ? userName(meId) : "") || "crew") + " has no more expenses for “" + (j.title || "job") + "”");
  if (typeof save === "function") save();
  if (typeof render === "function") render();
};
window.jobReopenReceipts = function (jobId) {
  const me = rcptMe(), meId = me ? me.id : ""; if (!meId) return;
  const j = (D().jobs || []).find(x => x && x.id === jobId && !x.deleted); if (!j) return;
  if (!Array.isArray(j.receiptsClosedBy)) return;
  const before = j.receiptsClosedBy.length;
  j.receiptsClosedBy = j.receiptsClosedBy.filter(x => !(x && x.userId === meId));   // remove ONLY my entry
  if (j.receiptsClosedBy.length === before) return;
  if (typeof touch === "function") touch(j);
  if (typeof logChange === "function") logChange("update", "job", j.id, "Reopened receipts — " + ((typeof userName === "function" ? userName(meId) : "") || "crew") + " has more to add on “" + (j.title || "job") + "”");
  if (typeof save === "function") save();
  if (typeof render === "function") render();
};

/* per-member personal-card spend (paidBy set) across job expenses, pass-through materials, and business expenses */
function rcptReimbOwed() {
  const per = {}; const add = e => { if (e && !e.deleted && e.paidBy && !e.reimbursedAt) per[e.paidBy] = (per[e.paidBy] || 0) + (+e.amount || 0); };
  (D().jobs || []).forEach(j => { if (j && !j.deleted) { (j.expenses || []).forEach(add); (j.materials || []).forEach(add); } });
  (D().expenses || []).forEach(add);
  return per;
}
function rcptThumb(id) {
  const up = (typeof jsUploadUrl === "function") ? jsUploadUrl(id) : "";
  if (!id) return `<div style="width:64px;height:64px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px dashed var(--line);background:var(--soft);flex:0 0 auto;font-size:22px">📷</div>`;
  if (/\.pdf$/i.test(id || "")) return `<a href="${up}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:flex;width:64px;height:64px;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--line);background:var(--soft);text-decoration:none;flex:0 0 auto"><div style="text-align:center"><div style="font-size:22px;line-height:1">📄</div><div class="sub" style="font-size:9px">PDF</div></div></a>`;
  return `<a href="${up}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex:0 0 auto"><img src="${up}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`;
}

/* every ATTRIBUTED (filed) receipt across job expenses, pass-through materials, and business expenses (only
   those with a receiptId photo). Shape = the record's own fields + {store, jobId, where}. Used by the table,
   the dup detector, and CSV/ZIP export. */
function rcptAllFiled() {
  const out = [];
  (D().jobs || []).forEach(function (j) { if (!j || j.deleted) return;
    (j.expenses || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "jobexp", jobId: j.id, where: (j.title || "job") })); });
    (j.materials || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "jobmat", jobId: j.id, where: (j.title || "job") + " · pass-through" })); });
  });
  (D().expenses || []).forEach(function (e) { if (e && !e.deleted && e.receiptId) out.push(Object.assign({}, e, { store: "biz", jobId: null, where: "business expense" })); });
  return out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
}
/* EVERY receipt for the table: unassigned review uploads + all filed receipts. recId = the record id in its home. */
function rcptAllRows() {
  const out = [];
  rcptReview().forEach(r => out.push(Object.assign({}, r, { store: "review", recId: r.id, jobId: r.jobId || null })));
  rcptAllFiled().forEach(e => out.push(Object.assign({}, e, { recId: e.id })));
  return out;
}
/* normalized display/sort metadata for a row */
function rcptRowMeta(r) {
  let type = r.type;
  if (!type) type = r.store === "jobmat" ? "pass-through" : r.store === "jobexp" ? "job-expense" : r.store === "biz" ? "business" : "review";
  const status = r.store === "review" ? "review" : "filed";
  let jobLabel = "", cust = "";
  if (r.jobId) { const j = (D().jobs || []).find(x => x && x.id === r.jobId); if (j) { jobLabel = j.title || "Job"; cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : ""; } }
  const uploader = (r.uploadedBy && typeof userName === "function" && userName(r.uploadedBy)) || r.by || "";
  // "For" = whose receipt it is / who gets paid back. When someone paid with a PERSONAL card (paidBy set), THAT
  // person IS who the receipt is for (they get reimbursed) — so paidBy WINS for display, even on an already-stored
  // record whose attributedTo got stuck on the uploader/filer. A business-card receipt (paidBy empty) has no payee
  // to reimburse, so it falls back to the explicit attributedTo (unchanged behavior). Display-only — no data write.
  const forWho = r.paidBy || r.attributedTo || "";
  const forName = (forWho && typeof userName === "function" && userName(forWho)) || "";
  return { type: type, status: status, jobLabel: jobLabel, cust: cust, uploader: uploader, forName: forName };
}
const RCPT_TYPE_LABEL = { "review": "🕓 Needs review", "business": "🔧 Business / tool", "job-expense": "🚚 Job expense", "pass-through": "🧱 Pass-through" };

/* ---- CAP AUTO-FILE "needs review" mark (additive flags; js/88 stamps them) --------------------------------
   Cap AUTO-files a receipt from its own confident guess (rcptFileSuggestion → the tested spine) and stamps
   capAutoFiled:true + capReviewedAt:null on the filed record. Until a HUMAN touches it (an inline/modal edit,
   or the explicit "✓ Reviewed" tap → rcptMarkReviewed/rcptStampReviewed sets capReviewedAt) it shows a distinct
   PURPLE "🤖 review" badge + tint so the owner knows Cap filled it and it wasn't hand-entered. Purely additive:
   NON-RETROACTIVE (existing/owner-filed receipts lack capAutoFiled → never marked) and read by NOTHING in the
   money math. Distinct from the pre-file "🤖 Cap" suggestion badge (which keys off r.suggested on a review row). */
const RCPT_CAP_PURPLE = "#6b3fa0";
function rcptNeedsCapReview(r) { return !!(r && r.capAutoFiled && !r.capReviewedAt); }
/* count of Cap-auto-filed receipts the owner hasn't reviewed yet (drives the "🤖 To review N" pill) */
function rcptCapReviewCount() { return rcptAllRows().filter(rcptNeedsCapReview).length; }

/* ---- SPLIT grouping (display only) — flat-value receipt slices share a splitGroup (js/92). Group all live rows
   by splitGroup (falling back to receiptId, then record id, so a non-split receipt is a lone group of 1). A
   group with >1 slice gets a muted sub-line under each row: "part of a $200 <vendor> receipt · 🧱 $120 · 🔧 $80".
   NO math change — each slice is an ordinary record in its own bucket. */
function rcptGroupKey(r) { return r.splitGroup || r.receiptId || ("id:" + (r.recId || r.id)); }
function rcptBucketEmoji(r) { const t = (typeof rcptRowMeta === "function") ? rcptRowMeta(r).type : r.type; return t === "pass-through" ? "🧱" : t === "job-expense" ? "🚚" : t === "business" ? "🔧" : "🕓"; }
function rcptSplitGroupMap() { const map = {}; rcptAllRows().forEach(r => { const k = rcptGroupKey(r); (map[k] || (map[k] = [])).push(r); }); return map; }
function rcptSplitSubline(r, groupMap) {
  if (!r.splitGroup) return "";                       // only genuine splits carry a splitGroup
  const grp = groupMap[rcptGroupKey(r)];
  if (!grp || grp.length < 2) return "";              // sole surviving slice (rest deleted) → not really split anymore
  const total = grp.reduce((s, x) => s + (+x.amount || 0), 0);
  const parts = grp.map(x => rcptBucketEmoji(x) + " " + money2(+x.amount || 0)).join(" · ");
  const vend = (grp.map(x => x.vendor).find(Boolean)) || "";
  return `<div class="sub" style="font-size:11px;white-space:normal;color:var(--muted)">🔀 part of a ${money2(total)}${vend ? " " + esc(vend) : ""} receipt · ${parts}</div>`;
}

/* a duplicate = the SAME vendor transaction. When a receipt carries a refNo (vendor order/trans #, e.g. a CSV import),
   that IS the identity — distinct orders (even same $/day) never collide, an exact re-import is caught. Absent a refNo
   we fall back to exact cents + vendor (+ card last-4 as a disambiguator when present, so two same-$ buys on DIFFERENT
   cards aren't false-flagged). Kept in lock-step with rcptCsvDupKey (js/93) so the table badge agrees with the import. */
function rcptDupKey(e) { e = e || {}; const v = String(e.vendor || "").trim().toLowerCase(); if (e.refNo) return "ref|" + v + "|" + e.refNo; return Math.round((+e.amount || 0) * 100) + "|" + v + (e.cardLast4 ? "|" + e.cardLast4 : ""); }
function rcptDupSet(filed) { const cnt = {}, s = {}; (filed || []).forEach(function (e) { if (!(+e.amount)) return; const k = rcptDupKey(e); cnt[k] = (cnt[k] || 0) + 1; }); Object.keys(cnt).forEach(function (k) { if (cnt[k] > 1) s[k] = cnt[k]; }); return s; }

/* ---------- TOLERANT possible-duplicate detection (display only — never auto-deletes) ----------
   The strict rcptDupKey above requires vendor AND card to match EXACTLY, so Cap reading two photos of the
   SAME purchase slightly differently (card on one copy, blank vendor on another, "The Home Depot" vs "Home
   Depot") produced different keys and the real double-charge slipped through. This looser pass groups by
   EXACT amount (cents) + ANY ONE matching signal, treating a missing card/vendor as a wildcard. It compares
   ALL receipts (review + filed) so a review copy of a filed receipt also flags. */
/* normalize a vendor for fuzzy matching: lowercase, drop punctuation ("lowe's"→"lowes"), strip a leading
   "the ", strip a trailing legal suffix (llc/inc/co/ltd/corp), collapse whitespace. */
function rcptVendorNorm(v) {
  var s = String(v == null ? "" : v).toLowerCase();
  s = s.replace(/[^a-z0-9\s]+/g, "");                 // punctuation → nothing (lowe's → lowes, "centers, llc" → "centers llc")
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^the\s+/, "");                       // leading "the "
  s = s.replace(/\s+(?:llc|inc|co|ltd|corp)$/, "");   // one trailing legal suffix
  return s.replace(/\s+/g, " ").trim();
}
function rcptCard4(v) { return v ? String(v).replace(/\D/g, "").slice(-4) : ""; }
/* do two rows look like the same charge? amount (cents) MUST match, plus at least one signal:
   both have a refNo → identity is the refNo (distinct order #s are NOT dups); else same normalized vendor,
   or same card last-4 (both present). Amount-only with NO signal (blank vendor + no card + no ref) → NOT a dup. */
function rcptDupMatch(a, b) {
  var ca = Math.round((+a.amount || 0) * 100), cb = Math.round((+b.amount || 0) * 100);
  if (!ca || ca !== cb) return false;                 // amount must match exactly (and be non-zero)
  var ra = a.refNo ? String(a.refNo) : "", rb = b.refNo ? String(b.refNo) : "";
  if (ra && rb) return ra === rb;                     // two CSV rows with txn #s: same # = dup, different # = distinct order
  var va = rcptVendorNorm(a.vendor), vb = rcptVendorNorm(b.vendor);
  if (va && vb && va === vb) return true;             // same normalized vendor
  var la = rcptCard4(a.cardLast4), lb = rcptCard4(b.cardLast4);
  if (la && lb && la === lb) return true;             // same card (both present) — even if vendor differs/blank
  return false;
}
/* group ALL receipts (review + filed) into sets that look like the same charge. Returns an array of groups,
   each an array of ≥2 rows. Union-find within each exact-amount bucket (matching is by ANY signal → transitive). */
function rcptDupGroups() {
  var rows = (typeof rcptAllRows === "function") ? rcptAllRows() : [];
  var byAmt = {};
  rows.forEach(function (r) { var c = Math.round((+r.amount || 0) * 100); if (!c) return; (byAmt[c] || (byAmt[c] = [])).push(r); });
  var groups = [];
  Object.keys(byAmt).forEach(function (c) {
    var b = byAmt[c]; if (b.length < 2) return;
    var parent = b.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    for (var i = 0; i < b.length; i++) for (var j = i + 1; j < b.length; j++) if (rcptDupMatch(b[i], b[j])) parent[find(i)] = find(j);
    var sets = {};
    b.forEach(function (r, i) { var root = find(i); (sets[root] || (sets[root] = [])).push(r); });
    Object.keys(sets).forEach(function (k) { if (sets[k].length > 1) groups.push(sets[k]); });
  });
  return groups;
}
/* {groups, byId} — byId maps each row's record id → its group, so the table badge can flag a member in O(1). */
function rcptDupIndex() {
  var groups = rcptDupGroups(), byId = {};
  groups.forEach(function (g) { g.forEach(function (r) { byId[r.recId != null ? r.recId : r.id] = g; }); });
  return { groups: groups, byId: byId };
}

/* ---------- INFO-RICHNESS SCORE (pure, display-only — powers the dup-resolver "keep the richest" pick) ----------
   When Ray re-uploads a receipt PHOTO that duplicates a thin CSV-imported row, the photo copy is worth keeping.
   This scores the signals that make one copy more useful than another so the resolver can RECOMMEND keeping the
   richest and deleting the thinner duplicate(s). Weights (photo dominates): photo(receiptId) +5, line items +3,
   then card / category / job / a real >12-char desc-or-note / non-blank vendor / a real date +1 each. Returns
   {score, has:[labels], missing:[labels]} so the UI can explain WHY ("most info: photo, line items" / "missing:
   photo"). Read-only — never mutates a record, never throws. Pure display: does NOT touch the money math. */
function rcptInfoScore(r) {
  r = r || {};
  var has = [], missing = [], score = 0;
  function chk(cond, label, pts) { if (cond) { score += pts; has.push(label); } else missing.push(label); }
  var li = (r.suggested && Array.isArray(r.suggested.lineItems) && r.suggested.lineItems.length) || (Array.isArray(r.lineItems) && r.lineItems.length) || 0;
  var dn = String(r.desc || r.note || "").trim();
  var realDate = (typeof _rcptIsoDate === "function") ? (_rcptIsoDate(r.date) || _rcptIsoDate((r.capRead || {}).date)) : (r.date || "");
  chk(!!r.receiptId, "photo", 5);
  chk(li > 0, "line items", 3);
  chk(!!r.cardLast4, "card", 1);
  chk(!!r.category, "category", 1);
  chk(!!r.jobId, "job", 1);
  chk(dn.length > 12, "description", 1);
  chk(!!String(r.vendor || "").trim(), "vendor", 1);
  chk(!!realDate, "date", 1);
  return { score: score, has: has, missing: missing };
}

/* ---------- DUPLICATE MERGE (Ray's insight: don't pick-one-and-delete — COMBINE the copies) ----------
   The old resolver's one-tap "keep the richest · delete the thinner" THREW AWAY good data: Ray had manually
   categorized one copy, then re-uploaded a clearer photo of the SAME receipt, and delete-the-thinner discarded
   one or the other. Merging keeps BOTH — the survivor's manual work (category/job/amount he typed) AND the
   better receipt (the photo + line items from the later, clearer upload) fold into ONE rich record.

   rcptMergeFields(records[, forcedSurvivorId]) is the PURE, testable core: it picks the SURVIVOR (which record
   keeps its id + BILLING HOME) and folds the BEST of every field into a merged field set. It NEVER mutates a
   record and NEVER throws. rcptMergeGroup (js/72 lower) applies that field set to the survivor via the tested
   rcptApplyEdit spine (byte-identical to an edit → billing home + id preserved) and soft-deletes the absorbed
   copies via the existing reversible rcptTombstone path. Owner/admin, confirm-before, reversible. */

/* the billing TYPE a row files as, derived from its home store (matches rcptRowMeta) — a filed copy's type is
   implied by which array it lives in; a review copy carries its own (usually null) type. */
function _rcptRowType(r) {
  if (!r) return null;
  if (r.store === "jobmat") return "pass-through";
  if (r.store === "jobexp") return "job-expense";
  if (r.store === "biz") return "business";
  return r.type || null;
}
/* a FILED copy = one that already lives in a billing array (a human categorized/billed it) */
function _rcptRowIsFiled(r) { return !!r && (r.store === "jobmat" || r.store === "jobexp" || r.store === "biz"); }
/* the line-items array a copy carries (Cap read), preferring suggested.lineItems, then a top-level lineItems */
function _rcptLineItems(r) {
  if (!r) return [];
  if (r.suggested && Array.isArray(r.suggested.lineItems) && r.suggested.lineItems.length) return r.suggested.lineItems;
  if (Array.isArray(r.lineItems) && r.lineItems.length) return r.lineItems;
  return [];
}
/* how much HUMAN work a copy carries — count of non-blank billing/identity fields someone had to set. Used to
   pick the survivor among filed copies (the one a person invested the most categorization in wins). */
function _rcptManualCount(r) {
  r = r || {};
  var n = 0;
  if (r.category) n++;
  if (r.jobId) n++;
  if (r.paidBy) n++;
  if (rcptCard4(r.cardLast4)) n++;
  if (String(r.vendor || "").trim()) n++;
  if (String(r.desc || r.note || "").trim().length > 0) n++;
  if (_rcptIsoDate(r.date)) n++;
  if (r.amount != null && r.amount !== "") n++;
  return n;
}
/* is `a` a better SURVIVOR than `b`? filedPool=true → prefer more human-set fields, then info-richness, then
   newest. filedPool=false (all copies are review) → prefer a photo, then more line items, then newest. */
function _rcptSurvivorBetter(a, b, filedPool) {
  if (filedPool) {
    var ma = _rcptManualCount(a), mb = _rcptManualCount(b);
    if (ma !== mb) return ma > mb;
    var sa = rcptInfoScore(a).score, sb = rcptInfoScore(b).score;
    if (sa !== sb) return sa > sb;
    return (a.ts || 0) > (b.ts || 0);
  }
  var pa = a.receiptId ? 1 : 0, pb = b.receiptId ? 1 : 0;
  if (pa !== pb) return pa > pb;
  var la = _rcptLineItems(a).length, lb = _rcptLineItems(b).length;
  if (la !== lb) return la > lb;
  return (a.ts || 0) > (b.ts || 0);
}
function _rcptRowId(r) { return r ? (r.recId != null ? r.recId : r.id) : null; }
/* pick the survivor record from a group (prefer a FILED copy so billing + manual categorization are preserved;
   among filed, the most human-set fields; if all review, the one with a photo). Never throws. */
function rcptMergeSurvivor(records, forcedSurvivorId) {
  var recs = (records || []).filter(Boolean);
  if (!recs.length) return null;
  if (forcedSurvivorId != null) {
    var forced = recs.filter(function (r) { return _rcptRowId(r) === forcedSurvivorId; })[0];
    if (forced) return forced;
  }
  var filed = recs.filter(_rcptRowIsFiled);
  var pool = filed.length ? filed : recs;
  var best = pool[0];
  for (var i = 1; i < pool.length; i++) if (_rcptSurvivorBetter(pool[i], best, filed.length > 0)) best = pool[i];
  return best;
}
/* THE PURE MERGE CORE. Returns {survivor, survivorLoc:{store,jobId,recId}, fields} — `fields` is the best-of
   field set to apply to the survivor via rcptApplyEdit. survivor keeps its BILLING HOME (its own type + jobId
   win, so the applied edit is same-home) and its id. For every field we keep the survivor's value when it's
   set/non-blank (his manual work wins), else fill from another copy's non-blank value — so NO field any copy
   had is ever blanked. The photo comes from whichever copy has one (the richer Cap read wins on a tie); the
   line items / suggested come from the copy with the most. Pure — never mutates a record, never throws. */
function rcptMergeFields(records, forcedSurvivorId) {
  var recs = (records || []).filter(Boolean);
  var survivor = rcptMergeSurvivor(recs, forcedSurvivorId);
  if (!survivor) return { survivor: null, survivorLoc: null, fields: {} };

  // PHOTO: keep the survivor's if it has one; a copy with strictly MORE line items (a fuller re-upload) wins;
  // if the survivor has none, take any copy's photo. Never ends up blank when any copy had a photo.
  var photoRec = survivor.receiptId ? survivor : null;
  recs.forEach(function (r) {
    if (!r.receiptId) return;
    if (!photoRec) { photoRec = r; return; }
    if (_rcptLineItems(r).length > _rcptLineItems(photoRec).length) photoRec = r;
  });

  // LINE ITEMS / suggested: the copy with the most line items (the "better receipt" Cap read).
  var suggRec = survivor;
  recs.forEach(function (r) { if (_rcptLineItems(r).length > _rcptLineItems(suggRec).length) suggRec = r; });
  var mergedSuggested = (suggRec && suggRec.suggested) ? suggRec.suggested : (survivor.suggested || null);

  // survivor-wins-if-set, else first non-blank other copy (never blanks a field any copy had)
  function foldStr(field) {
    var sv = String(survivor[field] == null ? "" : survivor[field]).trim();
    if (sv) return survivor[field];
    for (var i = 0; i < recs.length; i++) { var v = String(recs[i][field] == null ? "" : recs[i][field]).trim(); if (v) return recs[i][field]; }
    return survivor[field] || "";
  }
  function foldDesc() {
    var sv = String(survivor.desc || survivor.note || "").trim();
    if (sv) return survivor.desc || survivor.note;
    for (var i = 0; i < recs.length; i++) { var v = String(recs[i].desc || recs[i].note || "").trim(); if (v) return recs[i].desc || recs[i].note; }
    return survivor.desc || survivor.note || "";
  }
  // AMOUNT: dup groups match on amount, but fold defensively (survivor's, else any non-null).
  var mergedAmount = (survivor.amount != null && survivor.amount !== "") ? survivor.amount : null;
  if (mergedAmount == null) for (var i = 0; i < recs.length; i++) if (recs[i].amount != null && recs[i].amount !== "") { mergedAmount = recs[i].amount; break; }
  // DATE: a REAL YYYY-MM-DD only — reuse the ISO guard so a Cap "unknown" never wins over a real date.
  var mergedDate = _rcptIsoDate(survivor.date) || _rcptIsoDate((survivor.capRead || {}).date) || "";
  if (!mergedDate) for (var j = 0; j < recs.length; j++) { var dd = _rcptIsoDate(recs[j].date) || _rcptIsoDate((recs[j].capRead || {}).date); if (dd) { mergedDate = dd; break; } }
  // CARD last-4: survivor's, else any copy's valid 4-digit.
  var mergedCard = rcptCard4(survivor.cardLast4) || "";
  if (!mergedCard) for (var k = 0; k < recs.length; k++) { var c4 = rcptCard4(recs[k].cardLast4); if (c4) { mergedCard = c4; break; } }
  // TYPE + JOB: the survivor's home is preserved — its own type/job win (a filed survivor always has them). Only
  // when the survivor is an unfiled review copy do we fold in a type/job some other copy carried.
  var mergedType = _rcptRowType(survivor);
  if (!mergedType) for (var t = 0; t < recs.length; t++) { var rt = _rcptRowType(recs[t]); if (rt) { mergedType = rt; break; } }
  var mergedJob = survivor.jobId || null;
  if (!mergedJob && mergedType !== "business") for (var g = 0; g < recs.length; g++) if (recs[g].jobId) { mergedJob = recs[g].jobId; break; }

  var fields = {
    type: mergedType || null,
    jobId: mergedJob || null,
    amount: mergedAmount,
    vendor: foldStr("vendor"),
    date: mergedDate,
    category: foldStr("category"),
    paidBy: foldStr("paidBy") || null,
    attributedTo: foldStr("attributedTo") || null,
    cardLast4: mergedCard,
    desc: foldDesc(),
    receiptId: photoRec ? photoRec.receiptId : (survivor.receiptId || null),
    suggested: mergedSuggested
  };
  return {
    survivor: survivor,
    survivorLoc: { store: survivor.store, jobId: survivor.jobId || null, recId: _rcptRowId(survivor) },
    fields: fields
  };
}
/* a small PREVIEW summary (pure, testable) — what the merge KEEPS + where it lands, so the resolver can show it
   before committing. Labels copies A/B/C… by info-rank so "photo from copy B" is meaningful. Never throws. */
function rcptMergeSummary(group, forcedSurvivorId) {
  var g = (group || []).filter(Boolean);
  var merged = rcptMergeFields(g, forcedSurvivorId);
  if (!merged.survivor) return null;
  // rank the same way the resolver lists them so the A/B/C letters line up with the rows shown
  var ranked = g.map(function (r) { return { r: r, sc: rcptInfoScore(r) }; }).sort(function (a, b) { return (b.sc.score - a.sc.score) || ((b.r.ts || 0) - (a.r.ts || 0)); }).map(function (x) { return x.r; });
  function letter(rec) { var i = ranked.indexOf(rec); return i >= 0 ? String.fromCharCode(65 + i) : "?"; }
  var f = merged.fields, sv = merged.survivor;
  var photoCopy = null;
  if (f.receiptId) { photoCopy = ranked.filter(function (r) { return r.receiptId === f.receiptId; })[0] || null; }
  var jobLabel = "";
  if (f.jobId) { var j = ((typeof D === "function" ? D().jobs : []) || []).find(function (x) { return x && x.id === f.jobId; }); if (j) jobLabel = j.title || "job"; }
  return {
    survivor: sv,
    survivorLetter: letter(sv),
    fields: f,
    photoLetter: photoCopy ? letter(photoCopy) : "",
    photoFromSurvivor: !!(photoCopy && photoCopy === sv),
    categoryFromSurvivor: !!(String(sv.category || "").trim() && f.category === sv.category),
    jobLabel: jobLabel,
    lineItems: _rcptLineItems(merged.survivor).length || (f.suggested && Array.isArray(f.suggested.lineItems) ? f.suggested.lineItems.length : 0),
    removed: g.length - 1
  };
}
/* human-readable one-line preview for the confirm dialog + the inline resolver hint */
function rcptMergePreviewText(group, forcedSurvivorId) {
  var s = rcptMergeSummary(group, forcedSurvivorId);
  if (!s) return "";
  var f = s.fields, bits = [];
  if (f.receiptId) bits.push("📎 photo" + (s.photoLetter && !s.photoFromSurvivor ? " (from copy " + s.photoLetter + ")" : ""));
  if (String(f.vendor || "").trim()) bits.push(String(f.vendor).trim());
  if (f.amount != null) bits.push((typeof money2 === "function") ? money2(f.amount) : ("$" + f.amount));
  if (String(f.category || "").trim()) bits.push("category " + f.category + (s.categoryFromSurvivor ? " (yours)" : ""));
  if (s.jobLabel) bits.push("job " + s.jobLabel);
  if (s.lineItems > 0) bits.push(s.lineItems + " line item" + (s.lineItems > 1 ? "s" : ""));
  return "Keeps: " + (bits.join(" · ") || "the best of each copy") + " — the other " + s.removed + " cop" + (s.removed > 1 ? "ies are" : "y is") + " removed (undoable).";
}

/* tax records: standardized DATE-first filename + a CSV export.
   `capRead` (when Cap has read the receipt) provides the real transaction date/vendor; else we use the filed date. */
/* A receipt's display date. Prefers Cap's read date, then the record's own date, then the upload timestamp — but
   ONLY accepts a real YYYY-MM-DD. Cap writes capRead.date:"unknown" (or "n/a") when it can't read a date off the
   photo; those are NOT dates. The old code returned "unknown", which (a) an <input type=date> silently REJECTS →
   the Date field renders BLANK and won't save, and (b) MASKS the record's real date. Validating here fixes both
   (the fix is display-only — nothing about how dates are STORED changes). */
function _rcptIsoDate(v) { const s = String(v == null ? "" : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
function rcptDate(e) { const cr = e.capRead || {}; return _rcptIsoDate(cr.date) || _rcptIsoDate(e.date) || (e.ts ? (function () { try { return new Date(e.ts).toISOString().slice(0, 10); } catch (x) { return ""; } })() : "") || ""; }
function rcptSan(s, n) { s = String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return n ? s.slice(0, n) : s; }
function rcptStdName(e) { const ext = (/\.([A-Za-z0-9]+)$/.exec(e.receiptId || "") || [, "jpg"])[1]; return [rcptDate(e) || "undated", rcptSan(e.vendor || "vendor", 24), "$" + (+e.amount || 0).toFixed(2), rcptSan(e.desc || e.note || "", 24)].filter(Boolean).join("_") + "." + ext; }
function rcptCsvString() {
  const filed = rcptAllFiled(), base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
  const rows = [["Date", "Vendor", "Amount", "What", "Category", "Paid by", "Card", "Reimbursed", "Where", "Standard filename", "Receipt link"]];
  filed.forEach(function (e) { rows.push([ rcptDate(e), e.vendor || "", (+e.amount || 0).toFixed(2), e.desc || e.note || "", e.category || "", e.paidBy ? ((typeof userName === "function" ? userName(e.paidBy) : "") || "") : "", e.paidBy ? "personal" : "business", e.reimbursedAt ? "yes" : (e.paidBy ? "no" : ""), e.where || "", rcptStdName(e), base + "/uploads/" + (e.receiptId || "") ]); });
  return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n");
}
function rcptDownload(name, data, mime) {
  try { const blob = new Blob([data], { type: mime }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (z) {} }, 120); } catch (x) { alert("Export failed: " + (x.message || x)); }
}
window.rcptExportCSV = function () {
  if (!rcptAllFiled().length) { alert("No filed receipts to export yet."); return; }
  rcptDownload("receipts-" + (typeof today === "function" ? today() : "export") + ".csv", rcptCsvString(), "text/csv");
};
/* hand-rolled minimal ZIP (STORE method — receipts are already-compressed images/PDFs, so no deflate needed; no library, fits the no-build rule) */
function rcptCrc32(u8) { let c = ~0; for (let i = 0; i < u8.length; i++) { c ^= u8[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function rcptZip(files) {
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  const parts = [], central = []; let offset = 0;
  files.forEach(function (f) {
    const name = new TextEncoder().encode(f.name), data = f.data, crc = rcptCrc32(data), sz = data.length;
    const lfh = new Uint8Array([].concat([0x50,0x4b,0x03,0x04], u16(20), u16(0), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0)));
    parts.push(lfh, name, data);
    central.push(new Uint8Array([].concat([0x50,0x4b,0x01,0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
    offset += lfh.length + name.length + sz;
  });
  let cdSize = 0; central.forEach(p => cdSize += p.length);
  const eocd = new Uint8Array([].concat([0x50,0x4b,0x05,0x06], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
  const all = parts.concat(central, [eocd]); let total = 0; all.forEach(p => total += p.length);
  const out = new Uint8Array(total); let pos = 0; all.forEach(function (p) { out.set(p, pos); pos += p.length; }); return out;
}
window.rcptExportZip = async function () {
  const filed = rcptAllFiled(); if (!filed.length) { alert("No filed receipts to export yet."); return; }
  if (filed.length > 300 && !confirm(filed.length + " receipts — building the zip may take a moment. Continue?")) return;
  const base = ((S.sync && S.sync.url) || location.origin).replace(/\/+$/, "");
  const files = [], used = {};
  for (const e of filed) {
    if (!e.receiptId) continue;
    let name = rcptStdName(e); if (used[name]) { used[name]++; name = name.replace(/(\.[^.]+)$/, "-" + used[name] + "$1"); } else used[name] = 1;
    try { const r = await fetch(base + "/uploads/" + encodeURIComponent(e.receiptId)); if (!r.ok) continue; files.push({ name: name, data: new Uint8Array(await r.arrayBuffer()) }); } catch (x) {}
  }
  if (!files.length) { alert("Couldn't fetch any receipt files."); return; }
  files.push({ name: "_manifest.csv", data: new TextEncoder().encode(rcptCsvString()) });
  rcptDownload("receipts-" + (typeof today === "function" ? today() : "export") + ".zip", rcptZip(files), "application/zip");
};

/* ============================== MASS / BATCH UPLOAD ============================== */
function rcptIsReceipt(f) { return !!(f && (/^image\//.test(f.type || "") || f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""))); }
/* a purchase-history CSV (Lowe's / Home Depot export) — NOT a photo; parsed into review records (js/93), never blob-uploaded */
function rcptIsCsvFile(f) { return !!(f && (/\.csv$/i.test(f.name || "") || f.type === "text/csv" || f.type === "application/csv")); }
/* one review record per uploaded photo — blank metadata, "needs review" state, synced */
function rcptNewReview(receiptId) {
  const me = rcptMe();
  // attributedTo = WHOSE receipt it is (who it concerns / gets reimbursed) — distinct from uploadedBy. Defaults
  // to the uploader so a crew member sees their own upload; the owner can re-attribute it when they file it.
  return { id: uid(), receiptId: receiptId, amount: null, vendor: "", date: "", type: null, jobId: null, category: "", paidBy: null, desc: "", uploadedBy: me ? me.id : "", attributedTo: me ? me.id : "", by: me ? (me.username || "") : "", status: "review", suggested: null, ts: now(), deleted: false, updatedAt: now() };
}
/* ---------- STATEMENT / MULTI-RECEIPT FAN-OUT helpers ----------
   A bank/card STATEMENT (or several receipts in one photo) reads back as suggested.transactions — one entry per
   transaction (server rcptParseSuggestion). js/88 fans those into one review receipt EACH: the source record
   takes transactions[0], and every further entry becomes a DETERMINISTIC sibling review record that SHARES the
   same source image, so re-reading the same statement never duplicates. Both helpers never throw. */

/* Build a full `suggested` object (the shape js/98 rcptFileSuggestion / rcptSuggestionOneTapOk read) from ONE
   statement transaction entry. A statement DEBIT is a NORMAL POSITIVE expense: amount forced positive; deposit
   false and splits/lineItems empty (a statement line has none); jobId null (a statement line rarely resolves a
   job — smart-defaults/the owner assign it); confidence INHERITS the parent read so a confident statement fans
   into confident (auto-fileable) rows. refund honored from the entry (the parse already made a debit refund:false;
   belt-and-suspenders with the confirmation-only refund path, which files positive regardless). Pure; no throw. */
function rcptTxToSuggested(tx, parent) {
  tx = tx || {}; parent = parent || {};
  var amt = (tx.amount == null || tx.amount === "" || isNaN(+tx.amount)) ? null : Math.abs(+tx.amount);
  var vend = String(tx.vendor == null ? "" : tx.vendor).slice(0, 120);
  return {
    vendor: vend,
    amount: amt,
    date: (typeof tx.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tx.date)) ? tx.date : null,
    desc: vend.slice(0, 200),
    type: (["business", "job-expense", "pass-through"].indexOf(tx.type) >= 0) ? tx.type : null,
    category: tx.category || "",
    jobId: null,
    last4: (typeof tx.last4 === "string" && /^\d{4}$/.test(tx.last4)) ? tx.last4 : null,
    refund: tx.refund === true,
    deposit: false,
    refNo: (typeof tx.refNo === "string" && tx.refNo.trim()) ? tx.refNo.trim().slice(0, 40) : null,
    splits: [],
    lineItems: [],
    confidence: (parent && typeof parent.confidence === "number") ? parent.confidence : null
  };
}
/* Create (or re-find) the sibling review record for transaction #txIndex of a fanned statement. The id is
   DETERMINISTIC — rec.id + "_tx" + txIndex — so a RE-READ of the same statement image reuses it instead of
   duplicating (idempotent). Shares the source receiptId + attribution with the primary. If the sibling already
   exists it is NOT re-created: a live one has its suggestion refreshed; a soft-deleted one is left deleted (the
   owner removed it — never resurrect). Returns the sibling record (or null on a bad call). Never throws. */
function rcptNewReviewSibling(rec, txIndex, suggested) {
  try {
    if (!rec || !rec.id) return null;
    var sibId = rec.id + "_tx" + txIndex;
    var coll = rcptColl();
    var existing = coll.find(function (r) { return r && r.id === sibId; });
    if (existing) {
      if (!existing.deleted) { existing.suggested = suggested || existing.suggested; if (typeof touch === "function") touch(existing); }
      return existing;
    }
    var sib = rcptNewReview(rec.receiptId || null);
    sib.id = sibId;                                   // deterministic → re-read never duplicates
    if (rec.attributedTo) sib.attributedTo = rec.attributedTo;
    if (rec.uploadedBy) sib.uploadedBy = rec.uploadedBy;
    if (rec.by) sib.by = rec.by;
    sib.suggested = suggested || null;
    coll.push(sib);
    if (typeof touch === "function") touch(sib);
    return sib;
  } catch (e) { return null; }
}
let _rcptUpBusy = false;
function rcptSetUpStatus(txt) { const el = document.getElementById("rcpt_upstatus"); if (el) el.textContent = txt || ""; }
/* AUTO Cap-read after ANY upload (no batch-size cap): if an org AI key exists, kick a NON-BLOCKING
   capRcptRun({auto:true}). capRcptRun DRAINS the whole needs-review pile ONE AT A TIME (sequential vision
   calls, throttled) so a 7- or 100-photo drop reads every one — Ray dropped 7 at once and the old ≤4 gate
   silently skipped them. Idempotent (its own busy flag; reads only receipts with no `suggested`) +
   owner/admin-gated inside capRcptRun (crew/auto returns silently). No key or offline → the explicit
   "🤖 Read N" button path is untouched. Never throws. */
function rcptMaybeAutoRead(n) {
  try {
    if (!(n > 0)) return;   // any successful upload kicks the queue — no size cap (the drain reads them one at a time)
    if (typeof ORG_AI_ST === "undefined" || !ORG_AI_ST || !ORG_AI_ST.enabled || !ORG_AI_ST.hasKey) return;   // client sees a key EXISTS (never the key)
    if (typeof capRcptRun !== "function") return;
    if (typeof _capRcptBusy !== "undefined" && _capRcptBusy) return;   // a read is already running — don't double-fire
    capRcptRun({ auto: true });   // fire-and-forget; stamps only rec.suggested, then re-renders itself
  } catch (x) {}
}
function rcptUploadFiles(files, opts) {
  files = (files || []);
  const _upLabel = (opts && opts.label) ? String(opts.label) : "";   // e.g. "📋 Pasted" — surfaced in the status banner so a clipboard paste is explicitly confirmed
  // Branch: a purchase-history CSV isn't a photo — parse it into review records (js/93) instead of blob-uploading
  // it. One CSV at a time; everything else falls through to the normal photo/PDF upload path unchanged.
  const csvs = files.filter(rcptIsCsvFile);
  if (csvs.length && typeof rcptCsvHandle === "function") rcptCsvHandle(csvs[0]);
  files = files.filter(rcptIsReceipt);
  if (!files.length) return;
  if (typeof jsUpload !== "function") { alert("Upload needs a connection."); return; }
  if (_rcptUpBusy) return;   // a batch is already uploading — ignore repeat taps so a slow upload can't double-create (submitGuard-style busy flag)
  _rcptUpBusy = true;
  const total = files.length; let pending = total, ok = 0;
  const _upNote = (i) => [_upLabel, total > 1 ? "(" + i + " of " + total + ")" : ""].filter(Boolean).join(" · ");
  rcptSetUpStatus((_upLabel ? _upLabel + " — " : "") + "Uploading 0/" + total + "…");
  if (typeof uploadStatus === "function") uploadStatus("uploading", 0, _upNote(1));
  const done = () => { if (--pending <= 0) {
      _rcptUpBusy = false; rcptSetUpStatus("");
      // "✓ safe to close" is tied to the RECORD's sync push, not the blob upload — uploadTrackSync watches it.
      if (ok > 0 && typeof uploadTrackSync === "function") uploadTrackSync([_upLabel, total > 1 ? "(" + ok + " receipt" + (ok > 1 ? "s" : "") + ")" : ""].filter(Boolean).join(" · "));
      else if (typeof uploadStatus === "function") uploadStatus("hide");
      rcptMaybeAutoRead(ok); if (typeof render === "function") render();
    } };
  files.forEach((f, idx) => {
    const note = _upNote(idx + 1);
    jsUpload(f, function (pct) { if (typeof uploadStatus === "function") uploadStatus("uploading", pct, note); }).then(id => {
      rcptColl().push(rcptNewReview(id));   // one review receipt per photo
      if (typeof save === "function") save();
      ok++; rcptSetUpStatus("Uploaded " + ok + "/" + total + "…"); done();
    }).catch(e => { alert("One upload failed: " + (e.message || e)); done(); });
  });
}
window.rcptUpload = function (input) {
  rcptUploadFiles(input && input.files ? Array.prototype.slice.call(input.files) : []);
  if (input) input.value = "";   // clear so the same batch can't be re-read on a second tap
};
window.rcptPickFiles = function () { const el = document.getElementById("rcpt_files"); if (el) el.click(); };
window.rcptDragOver = function (e) { if (e && e.preventDefault) e.preventDefault(); const dz = e && e.currentTarget; if (dz && dz.style) { dz.style.outline = "2px dashed var(--accent)"; dz.style.outlineOffset = "-4px"; } };
window.rcptDragLeave = function (e) { const dz = e && e.currentTarget; if (dz && dz.style) dz.style.outline = ""; };
window.rcptDrop = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const dz = e && e.currentTarget; if (dz && dz.style) dz.style.outline = "";
  rcptUploadFiles((e && e.dataTransfer && e.dataTransfer.files) ? Array.prototype.slice.call(e.dataTransfer.files) : []);
};

/* ============================== 📋 PASTE FROM CLIPBOARD ==============================
   Ray copies a screenshot (ShareX) → pastes it straight in. Two paths, both funnel through the SAME
   rcptUploadFiles() pipeline (upload → review record → Cap auto-read → ✓ safe-to-close banner):
     • the "📋 Paste from clipboard" button → the async Clipboard API (navigator.clipboard.read), and
     • plain Ctrl+V anywhere on the Receipts tab → a document 'paste' listener reading e.clipboardData.
   Additive UX only — no data/schema/billing change. Never throws. */

/* is the async Clipboard read API usable here? (needs a secure context: HTTPS / localhost; absent on file://) */
function rcptClipboardReadable() {
  try { return !!(typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.read === "function"); }
  catch (e) { return false; }
}
/* PURE + testable: turn a clipboard image blob/file into a File the upload path accepts, named "pasted-<ts>.<ext>".
   Returns null for a non-image (so a text/other clipboard yields no upload). Falls back to a shaped object when the
   File constructor is unavailable (headless), which rcptUploadFiles still accepts (it only reads .type/.name). */
function rcptImageBlobToFile(blob, ts) {
  if (!blob || !/^image\//.test(blob.type || "")) return null;
  const ext = (String(blob.type || "image/png").split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const name = "pasted-" + (ts != null ? ts : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0)) + "." + ext;
  try { return new File([blob], name, { type: blob.type }); }
  catch (e) { try { blob.name = name; return blob; } catch (z) { return { type: blob.type, name: name }; } }
}
/* inline note under the paste button (friendly guidance; no alert/blank) */
function rcptPasteNote(txt) { const el = (typeof document !== "undefined" && document.getElementById) ? document.getElementById("rcpt_pastenote") : null; if (el) el.textContent = txt || ""; }
/* BUTTON path — read images off the clipboard via the async API, wrap each as a File, hand to the shared pipeline.
   Requires secure context + permission + a user gesture (the tap) — all failure modes show a friendly inline note. */
window.rcptPasteFromClipboard = async function () {
  if (!rcptFinFull()) return;
  rcptPasteNote("");
  if (!rcptClipboardReadable()) { rcptPasteNote("Paste needs the app's https address."); return; }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of (items || [])) {
      const types = (item && item.types) ? item.types : [];
      for (const type of types) {
        if (!/^image\//.test(type)) continue;
        try { const blob = await item.getType(type); const f = rcptImageBlobToFile(blob, Date.now()); if (f) files.push(f); } catch (z) {}
      }
    }
    if (!files.length) { rcptPasteNote("No image on the clipboard — copy a screenshot first."); return; }
    rcptPasteNote("📋 Pasted " + files.length + " image" + (files.length > 1 ? "s" : "") + " — uploading…");
    rcptUploadFiles(files, { label: "📋 Pasted" });
  } catch (e) {
    rcptPasteNote("Couldn't read the clipboard — copy a screenshot, then tap Paste (it needs permission).");
  }
};
/* Ctrl+V path — always-on document listener that only ACTS on the Receipts tab (owner/admin), so it's a harmless
   no-op everywhere else. Reads e.clipboardData for image items; preventDefault only when an image is found. */
function rcptOnPaste(e) {
  try {
    if (typeof TAB === "undefined" || TAB !== "receipts") return;
    if (!rcptFinFull()) return;
    const items = (e && e.clipboardData && e.clipboardData.items) ? e.clipboardData.items : null;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.kind === "file" && /^image\//.test(it.type || "")) {
        const f = rcptImageBlobToFile(it.getAsFile(), Date.now());
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    if (e.preventDefault) e.preventDefault();
    rcptPasteNote("📋 Pasted " + files.length + " image" + (files.length > 1 ? "s" : "") + " — uploading…");
    rcptUploadFiles(files, { label: "📋 Pasted" });
  } catch (x) {}
}
if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("paste", rcptOnPaste);

/* ============================== PHASE B — ONE-TAP / BULK FILE (spine funnel) ==============================
   Both file EXISTING review rows in place through rcptFileSuggestion (js/98) → rcptApplyEdit → a BYTE-IDENTICAL
   record to a hand save. Explicit human taps = the confirm; nothing auto-files. Owner/admin only. */
/* one row: "✓ Looks right — file it" on a high-confidence review row */
window.rcptFileItRow = function (store, jobId, recId) {
  if (!rcptFinFull()) return;
  if (typeof rcptFileSuggestion !== "function") return;
  const res = rcptFileSuggestion(store, jobId || null, recId);   // non-batch → logs + saves itself
  if (!res || !res.ok) alert("Couldn't file this one automatically — open it to finish by hand." + (res && res.error ? "\n\n" + res.error : ""));
  if (typeof render === "function") render();
};
/* bulk: file every confident review row at once, then ONE save() + render(). Low-confidence rows stay in the
   queue; idempotent (each filed row leaves review, so a re-run skips it). */
window.rcptFileAllConfident = function () {
  if (!rcptFinFull()) return;
  if (typeof rcptFileSuggestion !== "function" || typeof rcptSuggestionOneTapOk !== "function") return;
  if (_rcptBulkBusy) return;
  const rows = rcptReview().filter(rcptSuggestionOneTapOk);
  if (!rows.length) return;
  _rcptBulkBusy = true;
  let filed = 0;
  try {
    rows.forEach(r => { const res = rcptFileSuggestion(r.store || "review", r.jobId, r.id, { batch: true }); if (res && res.ok) filed++; });
    if (filed && typeof logChange === "function") logChange("update", "expense", "bulk", "Filed " + filed + " confident Cap receipt" + (filed === 1 ? "" : "s") + " in one tap (bulk)");
    if (typeof save === "function") save();
  } finally { _rcptBulkBusy = false; }
  if (typeof render === "function") render();
};

/* ============================== SORT ============================== */
function rcptSortVal(r, col) {
  const m = rcptRowMeta(r);
  switch (col) {
    case "vendor": return String(r.vendor || "").toLowerCase();
    case "amount": return (r.amount == null || r.amount === "") ? -1 : (+r.amount || 0);
    case "type": return m.type;
    case "job": return (m.cust || m.jobLabel || "").toLowerCase();
    case "uploader": return String(m.uploader || "").toLowerCase();
    case "attributedTo": return String(m.forName || "").toLowerCase();
    case "category": return String(r.category || "").toLowerCase();
    case "card": return String(r.cardLast4 || "").replace(/\D/g, "").slice(-4);
    case "order": return rcptOrderNo(r);
    case "status": return m.status;
    case "date": default: return rcptDate(r) || "0000-00-00";
  }
}
function rcptSortCmp(a, b) {
  const col = RCPT_SORT.col, dir = RCPT_SORT.dir === "asc" ? 1 : -1;
  const va = rcptSortVal(a, col), vb = rcptSortVal(b, col);
  if (va < vb) return -1 * dir; if (va > vb) return 1 * dir;
  return (b.ts || 0) - (a.ts || 0);   // stable tiebreak: newest first
}
/* one lowercased haystack per row for the SEARCH box — mirrors js/08's QSEARCH concatenation. Covers the same
   fields the table shows: vendor + desc/note + amount + category + card last-4 + job label + customer + who
   uploaded it + who it's for. Pure (reads the row + rcptRowMeta), never mutates. */
function rcptRowSearchText(r) {
  const m = rcptRowMeta(r);
  return [r.vendor, r.desc, r.note, (r.amount == null || r.amount === "") ? "" : r.amount, r.category, r.cardLast4, m.jobLabel, m.cust, m.uploader, m.forName]
    .map(x => String(x == null ? "" : x)).join(" ").toLowerCase();
}
/* is ANY display-only search/filter set? (drives the "showing N of M" line + the Clear-filters button).
   A multi-select filter is "active" when its array is non-empty. */
function rcptAnyFilterActive() { return !!(RCPT_SEARCH || RCPT_TYPEFS.length || RCPT_CATFS.length || RCPT_PERSONFS.length || RCPT_JOBFS.length || RCPT_CARDFS.length || RCPT_DFROM || RCPT_DTO); }
function rcptSortedRows() {
  let rows = rcptAllRows();
  if (RCPT_FILTER === "review") rows = rows.filter(r => r.store === "review");
  else if (RCPT_FILTER === "filed") rows = rows.filter(r => r.store !== "review");
  else if (RCPT_FILTER === "owed") rows = rows.filter(r => r.paidBy && !r.reimbursedAt);        // personal-card, not yet reimbursed
  else if (RCPT_FILTER === "paidback") rows = rows.filter(r => r.paidBy && r.reimbursedAt);      // reimbursed / settled
  else if (RCPT_FILTER === "capreview") rows = rows.filter(rcptNeedsCapReview);                   // Cap auto-filed, owner hasn't reviewed
  // DISPLAY-ONLY search + MULTI-SELECT filters (after the status pill, before sort). Each non-empty filter applies;
  // OR within a filter (value ∈ its set), AND across filters. Mirrors the Jobs list (js/08 quotesListHTML) —
  // narrows the view, never touches the records.
  if (RCPT_SEARCH) { const q = RCPT_SEARCH.toLowerCase(); rows = rows.filter(r => rcptRowSearchText(r).includes(q)); }
  if (RCPT_TYPEFS.length) rows = rows.filter(r => RCPT_TYPEFS.indexOf(rcptRowMeta(r).type) >= 0);
  if (RCPT_CATFS.length) rows = rows.filter(r => RCPT_CATFS.indexOf(r.category || "") >= 0);
  if (RCPT_PERSONFS.length) rows = rows.filter(r => RCPT_PERSONFS.indexOf(r.uploadedBy) >= 0 || RCPT_PERSONFS.indexOf(r.attributedTo) >= 0);
  if (RCPT_JOBFS.length) rows = rows.filter(r => RCPT_JOBFS.indexOf(r.jobId) >= 0);
  if (RCPT_CARDFS.length) rows = rows.filter(r => RCPT_CARDFS.indexOf(rcptCard4(r.cardLast4)) >= 0);
  if (RCPT_DFROM) rows = rows.filter(r => rcptDate(r) >= RCPT_DFROM);
  if (RCPT_DTO) rows = rows.filter(r => rcptDate(r) <= RCPT_DTO);
  return rows.sort(rcptSortCmp);
}
/* PURE results-list HTML for the SCOPED re-render container (#rcptlist): the "showing N of M" count (only when a
   filter/search is active) + the sortable table. Kept pure (a function of the current filter state + data) so the
   keystroke path can rebuild ONLY #rcptlist — the #rcptsearch box + the Filters panel live OUTSIDE it, so they're
   never destroyed and focus/caret survive (mirrors quotesListHTML()/#qlist in js/08). */
function rcptListInner() {
  const rows = rcptSortedRows();
  const dupById = rcptDupIndex().byId;
  const count = rcptAnyFilterActive()
    ? `<div class="sub" style="margin:0 0 6px">Showing ${rows.length} of ${rcptAllRows().length}</div>`
    : "";
  return count + rcptTableHTML(rows, dupById);
}
/* repaint ONLY the results list — the scoped path shared by search + every dropdown/date filter */
function rcptRepaintList() { const c = (typeof document !== "undefined" && document.getElementById) ? document.getElementById("rcptlist") : null; if (c) c.innerHTML = rcptListInner(); }
window.rcptSortBy = function (col) {
  if (RCPT_SORT.col === col) RCPT_SORT.dir = RCPT_SORT.dir === "asc" ? "desc" : "asc";
  else { RCPT_SORT.col = col; RCPT_SORT.dir = (col === "date" || col === "amount") ? "desc" : "asc"; }
  render();
};
window.rcptSetFilter = function (f) { RCPT_FILTER = f; render(); };
/* SEARCH — scoped repaint of #rcptlist ONLY, so the #rcptsearch input is never destroyed (focus + caret survive
   with no setSelectionRange hack — exactly like qSearchOn/#qlist in js/08). */
window.rcptSetSearch = function (v) { RCPT_SEARCH = v; rcptRepaintList(); };
/* MULTI-SELECT toggle handlers — a checkbox flips its value in/out of the filter's array, then scoped-repaints
   #rcptlist ONLY (the Filters panel lives OUTSIDE #rcptlist, so the checkbox keeps its state meanwhile; the panel's
   "· on" summary + Clear button + the "(N)" counts refresh on the next full render). Mirrors the old dropdown
   scoped path. Toggling is by value (the checkbox's own value attr), so no order/index bookkeeping. */
function rcptToggleF(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
window.rcptToggleTypeF = function (v) { rcptToggleF(RCPT_TYPEFS, v); rcptRepaintList(); };
window.rcptToggleCatF = function (v) { rcptToggleF(RCPT_CATFS, v); rcptRepaintList(); };
window.rcptTogglePersonF = function (v) { rcptToggleF(RCPT_PERSONFS, v); rcptRepaintList(); };
window.rcptToggleJobF = function (v) { rcptToggleF(RCPT_JOBFS, v); rcptRepaintList(); };
window.rcptToggleCardF = function (v) { rcptToggleF(RCPT_CARDFS, v); rcptRepaintList(); };
window.rcptSetDateF = function (which, v) { if (which === "from") RCPT_DFROM = v; else RCPT_DTO = v; rcptRepaintList(); };
/* Clear ALL display-only search + filters (leave the status pill as-is, like js/08 which keeps the stage chip).
   Empties every multi-select set. Full render so the panel checkboxes + summary reset to empty too. */
window.rcptClearFilters = function () { RCPT_SEARCH = ""; RCPT_TYPEFS = []; RCPT_CATFS = []; RCPT_PERSONFS = []; RCPT_JOBFS = []; RCPT_CARDFS = []; RCPT_DFROM = ""; RCPT_DTO = ""; if (typeof render === "function") render(); };
function rcptSortArrow(col) { return RCPT_SORT.col === col ? (RCPT_SORT.dir === "asc" ? " ▲" : " ▼") : ""; }

/* MULTI-SELECT checkbox group (mobile-first) — one wrapping row of tappable checkbox "chips", one per real value.
   `opts` = [{v,label}] (populated from the actual rows, exactly like the old dropdown options); `selected` = the
   filter's current array; `handler` = the window toggle fn name (called with this.value, so no JS-string escaping
   of values — the value rides the checkbox's own `value` attr, HTML-escaped). A checked chip = value in the set.
   The header shows a "(N)" count when any are checked. `scroll` caps tall groups (Job) at a scrollable height.
   Returns "" when there are no options, so an empty group hides itself. */
function rcptChkGroup(label, selected, opts, handler, scroll) {
  if (!opts || !opts.length) return "";
  const n = selected.length;
  const chips = opts.map(function (o) {
    const on = selected.indexOf(o.v) >= 0;
    return `<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:16px;`
      + `border:1px solid ${on ? "var(--accent)" : "var(--line)"};background:${on ? "var(--accent)" : "var(--soft)"};`
      + `color:${on ? "#fff" : "inherit"};font-size:13px;cursor:pointer;white-space:nowrap;user-select:none">`
      + `<input type="checkbox" value="${esc(o.v)}"${on ? " checked" : ""} onchange="${handler}(this.value)" style="margin:0;accent-color:var(--accent)">`
      + `${esc(o.label)}</label>`;
  }).join("");
  return `<div style="margin-top:10px"><label>${esc(label)}${n ? ` <span class="badge" style="background:var(--accent);color:#fff">${n}</span>` : ""}</label>`
    + `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px${scroll ? ";max-height:168px;overflow-y:auto;padding:2px" : ""}">${chips}</div></div>`;
}

/* ============================== PAGE ============================== */
function rReceipts() {
  if (typeof canSee === "function" && !canSee("receipts")) { view.innerHTML = `<div class="secthd"><h2>Receipts</h2></div><div class="card"><div class="muted">Not available for your role.</div></div>`; return; }
  if (!rcptFinFull()) { view.innerHTML = rcptCrewView(); return; }   // crew: upload + own review queue only (no finance data)

  const rows = rcptSortedRows();
  const reviewCount = rcptReview().length;
  const capReviewN = rcptCapReviewCount();   // Cap auto-filed, owner hasn't reviewed → the purple "🤖 To review" pile
  const filed = rcptAllFiled(), dupIx = rcptDupIndex(), dupCount = dupIx.groups.length;   // dup flags now come from rcptListInner()

  let h = `<div class="secthd"><h2>📸 Receipts</h2><span class="ct">${rcptAllRows().length}</span></div>`;

  // MASS UPLOAD
  h += `<div class="card" ondragover="rcptDragOver(event)" ondragleave="rcptDragLeave(event)" ondrop="rcptDrop(event)">
    <div class="sub" style="white-space:normal">Dump a whole <b>stack</b> of receipts in now — snap or pick several at once, or <b>drag &amp; drop</b> them here. Each lands in <b>Needs review</b>; tap any row below to set vendor/amount/type/job and file it.</div>
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf,.csv,text/csv" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="rcptPickFiles()">📷 Upload receipt photos</button>
    ${rcptClipboardReadable() ? `<button class="btn ghost" style="width:100%;margin-top:6px" onclick="rcptPasteFromClipboard()">📋 Paste from clipboard</button>
    <div class="sub" style="text-align:center;opacity:.6">or press <b>Ctrl&nbsp;+&nbsp;V</b> to paste a copied screenshot</div>` : ""}
    <div id="rcpt_pastenote" class="sub" style="text-align:center;margin-top:4px;color:var(--danger);min-height:0"></div>
    <input type="file" id="rcpt_csv" accept=".csv,text/csv" style="display:none" onchange="rcptCsvPick(this)">
    <button class="btn ghost" style="width:100%;margin-top:6px" onclick="rcptCsvPickOpen()">📄 Import a purchase CSV (Lowe's / Home Depot…)</button>
    <div id="rcpt_upstatus" class="sub" style="text-align:center;margin-top:6px;color:var(--accent);min-height:16px"></div>
    <div class="sub" style="text-align:center;opacity:.6">⬇ or drag photos onto this box (desktop)</div></div>`;

  if (reviewCount) h += `<div class="card" style="border-left:4px solid var(--accent)"><b>🕓 ${reviewCount} receipt${reviewCount > 1 ? "s" : ""} need${reviewCount > 1 ? "" : "s"} review</b> — untagged uploads. Tap one to set vendor, amount, type &amp; job.</div>`;
  if (typeof capRcptButtonHTML === "function") h += capRcptButtonHTML();   // 🤖 Cap: categorize needs-review (owner/admin only)
  // ✓ FILE ALL N CONFIDENT (Phase B) — every review row Cap is confident about (rcptSuggestionOneTapOk) files in
  // one tap through the SAME spine funnel; low-confidence ones stay in the queue. Owner/admin only.
  if (rcptFinFull() && typeof rcptSuggestionOneTapOk === "function") {
    const confN = rcptReview().filter(rcptSuggestionOneTapOk).length;
    if (confN) h += `<div class="card" style="border-left:4px solid #1e9e5a"><div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
      <div class="grow" style="white-space:normal"><b>✓ ${confN} confident receipt${confN > 1 ? "s" : ""} ready to file</b><div class="sub">Cap is confident about ${confN > 1 ? "these" : "this one"} (high confidence · real amount · job resolved or business). File ${confN > 1 ? "them all" : "it"} in one tap — anything iffy stays in the queue for you to review.</div></div>
      <button class="btn sm" style="background:#1e9e5a;border-color:#1e9e5a;color:#fff" onclick="rcptFileAllConfident()">✓ File all ${confN} confident</button></div></div>`;
  }
  if (capReviewN) h += `<div class="card" style="border-left:4px solid ${RCPT_CAP_PURPLE};cursor:pointer" onclick="rcptSetFilter('capreview')"><b style="color:${RCPT_CAP_PURPLE}">🤖 ${capReviewN} receipt${capReviewN > 1 ? "s" : ""} Cap auto-filed — needs your review</b> — Cap was confident and filed ${capReviewN > 1 ? "these" : "this"} for you (purple <span class="badge" style="background:${RCPT_CAP_PURPLE};color:#fff">🤖 review</span> rows). Tap to jump to them, glance each is right, then tap <b>✓ Reviewed</b> (any edit also clears the mark). →</div>`;
  const suggCount = rows.filter(r => r && r.suggested).length;
  if (suggCount) h += `<div class="card" style="border-left:4px solid #6b3fa0"><b>🤖 ${suggCount} receipt${suggCount > 1 ? "s have" : " has"} Cap suggestions to review</b> — 🤖 rows below. Open one, tap "Use Cap's guess", then Save to confirm.</div>`;
  if (dupCount) h += `<div class="card" style="border-left:4px solid var(--danger);cursor:pointer" onclick="rcptDupResolveOpen()"><b>⚠ ${dupCount} possible duplicate${dupCount > 1 ? "s" : ""}</b> — same amount + a matching vendor / card / transaction #, filed more than once. <b>Tap to review them side by side</b> and delete the extras. →</div>`;

  // 🏗 RENTAL DEPOSITS AWAITING REFUND (js/96) — held out of job cost until the owner confirms the refund
  if (typeof depositsAwaitingRefund === "function") { const _deps = depositsAwaitingRefund(); if (_deps.length) h += rcptDepositsAwaitingHTML(_deps); }

  // 🔗 DEPOSIT-SETTLEMENT SUGGESTIONS — a rental-cost receipt Cap matched to an open deposit (settle → net, no double-count)
  { const _sugs = rcptDepositSuggestions(); if (_sugs.length) h += rcptDepositSuggestHTML(_sugs); }

  // PER-JOB CLOSE-OUT ROLL-UP — when is a job safe to invoice? (all its crew have closed out their receipts)
  h += rcptJobCloseoutHTML();

  // FILTER + EXPORT bar
  h += `<div class="secthd" style="margin-top:14px"><h2>All receipts</h2></div>`;

  // SEARCH box (scoped re-render — mirrors the Jobs list). Lives OUTSIDE #rcptlist so its focus/caret survive.
  h += `<input class="search" id="rcptsearch" placeholder="Search receipts — vendor, amount, category, card…" value="${esc(RCPT_SEARCH)}" oninput="rcptSetSearch(this.value)">`;

  // STATUS pills (unchanged) + export
  h += `<div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0 6px">
    <button class="btn ${RCPT_FILTER === "all" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('all')">All ${rcptAllRows().length}</button>
    <button class="btn ${RCPT_FILTER === "review" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('review')">Needs review ${reviewCount}</button>
    <button class="btn ${RCPT_FILTER === "filed" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('filed')">Filed ${filed.length}</button>
    <button class="btn ${RCPT_FILTER === "owed" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('owed')">💸 Owed ${rcptAllRows().filter(r => r.paidBy && !r.reimbursedAt).length}</button>
    <button class="btn ${RCPT_FILTER === "paidback" ? "acc" : "ghost"} sm" onclick="rcptSetFilter('paidback')">✓ Paid back ${rcptAllRows().filter(r => r.paidBy && r.reimbursedAt).length}</button>
    ${(capReviewN || RCPT_FILTER === "capreview") ? `<button class="btn ${RCPT_FILTER === "capreview" ? "acc" : "ghost"} sm" style="${RCPT_FILTER === "capreview" ? "" : "border-color:" + RCPT_CAP_PURPLE + ";color:" + RCPT_CAP_PURPLE}" onclick="rcptSetFilter('capreview')">🤖 To review ${capReviewN}</button>` : ""}
    <span class="grow"></span>
    <button class="btn ghost sm" onclick="rcptExportCSV()">📤 CSV</button><button class="btn ghost sm" onclick="rcptExportZip()">📦 ZIP</button></div>`;

  // COLLAPSIBLE ⚙️ Filters — MULTI-SELECT checkbox groups populated from the ACTUAL rows so only real values show
  // (mobile-first: chips wrap; the Job group scrolls). OR within a group, AND across groups. Lives OUTSIDE #rcptlist
  // so the scoped repaint never destroys the checkboxes; the panel's "(N)" counts + summary refresh on full render.
  {
    const allRows = rcptAllRows();
    const typeOrder = ["review", "business", "job-expense", "pass-through"];
    const typesPresent = typeOrder.filter(t => allRows.some(r => rcptRowMeta(r).type === t));
    const catExtra = Array.from(new Set(allRows.map(r => r.category).filter(Boolean))).filter(c => RCPT_CATS.indexOf(c) < 0).sort();
    const catOpts = RCPT_CATS.concat(catExtra);
    const personIds = Array.from(new Set([].concat(allRows.map(r => r.uploadedBy), allRows.map(r => r.attributedTo)).filter(Boolean)));
    const persons = personIds.map(id => ({ id: id, name: ((typeof userName === "function" && userName(id)) || id) })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const jobsF = Array.from(new Set(allRows.map(r => r.jobId).filter(Boolean)))
      .map(id => { const j = (D().jobs || []).find(x => x && x.id === id); return { id: id, label: j ? ((j.title || "Job") + ((j.customerId && typeof custName === "function") ? " · " + custName(j.customerId) : "")) : id }; })
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const cards = Array.from(new Set(allRows.map(r => rcptCard4(r.cardLast4)).filter(Boolean))).sort();
    const anyExtra = !!(RCPT_TYPEFS.length || RCPT_CATFS.length || RCPT_PERSONFS.length || RCPT_JOBFS.length || RCPT_CARDFS.length || RCPT_DFROM || RCPT_DTO);
    h += `<details class="card" style="margin-bottom:10px"${anyExtra ? " open" : ""}><summary style="cursor:pointer;font-weight:700;user-select:none">⚙️ Filters${anyExtra ? " · on" : ""}</summary>`
      + rcptChkGroup("Type", RCPT_TYPEFS, typesPresent.map(t => ({ v: t, label: RCPT_TYPE_LABEL[t] || t })), "rcptToggleTypeF")
      + rcptChkGroup("Category", RCPT_CATFS, catOpts.map(c => ({ v: c, label: c })), "rcptToggleCatF")
      + rcptChkGroup("Person", RCPT_PERSONFS, persons.map(p => ({ v: p.id, label: p.name })), "rcptTogglePersonF")
      + rcptChkGroup("Job", RCPT_JOBFS, jobsF.map(j => ({ v: j.id, label: j.label })), "rcptToggleJobF", true)
      + rcptChkGroup("💳 Card", RCPT_CARDFS, cards.map(c => ({ v: c, label: "••••" + c })), "rcptToggleCardF")
      + `<div class="row" style="gap:8px;margin-top:10px"><div class="grow"><label>From</label><input type="date" value="${esc(RCPT_DFROM)}" onchange="rcptSetDateF('from',this.value)" style="width:100%"></div><div class="grow"><label>To</label><input type="date" value="${esc(RCPT_DTO)}" onchange="rcptSetDateF('to',this.value)" style="width:100%"></div></div>`
      + (rcptAnyFilterActive() ? `<button class="btn ghost sm" style="margin-top:10px" onclick="rcptClearFilters()">Clear filters</button>` : "")
      + `</details>`;
  }

  // TABLE — wrapped in a stable #rcptlist container so search + the dropdown filters can rebuild ONLY this (the
  // search box + Filters panel above stay put). rcptListInner() is a pure function of the current filter state.
  h += `<div id="rcptlist">${rcptListInner()}</div>`;

  // reimbursements owed
  const owed = rcptReimbOwed(), oids = Object.keys(owed).filter(id => owed[id] > 0.005);
  if (oids.length) {
    h += `<div class="secthd" style="margin-top:14px"><h2>💸 Reimbursements owed</h2></div><div class="card">` + oids.map(id => `<div class="li"><div class="grow"><div class="nm">${esc((typeof userName === "function" ? userName(id) : "") || "?")}</div><div class="sub">personal-card spend on jobs + business</div></div><div class="row" style="gap:8px;align-items:center"><b>${money2(owed[id])}</b><button class="btn ghost sm" onclick="rcptSettle('${id}')">✓ Mark paid back</button></div></div>`).join("") + `<div class="sub" style="margin-top:6px">"Mark paid back" clears their balance once you've reimbursed them from business funds.</div></div>`;
  }
  view.innerHTML = h;
}

/* 🏗 RENTAL DEPOSITS AWAITING REFUND (js/96 depositsAwaitingRefund) — each open deposit that's HELD out of job cost
   until its refund is confirmed. Tapping "Settle" opens the js/96 refund-entry modal. Mirrors the dup/close-out cards. */
function rcptDepositsAwaitingHTML(deps) {
  let h = `<div class="card" style="border-left:4px solid #e0a800"><b>🏗 ${deps.length} rental deposit${deps.length > 1 ? "s" : ""} awaiting refund</b> — held out of job cost until you confirm the refund. Settle each once the refund comes back.`;
  h += deps.map(d => {
    const dep = d.deposit, j = d.job;
    const cust = (j && j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
    const where = (j ? (j.title || "Job") : "no job") + (cust ? " · " + cust : "");
    const state = d.hasRefund ? `refund so far ${money2(-d.refundSoFar)} → net ${money2(d.net)}` : "no refund yet";
    return `<div class="li" style="align-items:center;gap:8px;margin-top:6px"><div class="grow" style="min-width:0"><div class="nm" style="white-space:normal">🏗 ${money2(dep.amount)} deposit${dep.vendor ? " · " + esc(dep.vendor) : ""} · ${esc(where)}</div><div class="sub" style="white-space:normal">${state} — tap Settle to enter the refund / mark it settled</div></div><button class="btn acc sm" onclick="if(typeof depositSettleOpen==='function')depositSettleOpen('${esc(dep.id)}')">Settle</button></div>`;
  }).join("");
  h += `</div>`;
  return h;
}

/* ============================== 🔗 DEPOSIT-SETTLEMENT SUGGESTION (Cap links a rental cost → its open deposit) ==============================
   A rental costs money in TWO records: the up-front refundable DEPOSIT ($300, filed as a HELD job expense — js/96)
   and, when the contract comes back, Cap reads the rental at its NET cost ($72.59 · rentals) as a SEPARATE review
   receipt. Left alone the deposit sits forever "awaiting refund" and the $72.59 becomes a SECOND expense (double
   count). rcptDepositMatch spots that a rental-cost receipt is really the SETTLEMENT of an open deposit so Cap can
   suggest linking them. PURE + display-only — nothing settles until the owner taps. Reuses rcptVendorNorm (fuzzy
   vendor) + js/96 depositsAwaitingRefund (the open, unsettled deposits). */

/* the net rental cost a receipt reads at — its own amount, else Cap's suggested amount */
function rcptNetCostOf(r) {
  if (!r) return 0;
  var sug = r.suggested || {};
  var n = (+r.amount || 0) || (+sug.amount || 0);
  return Math.round((+n || 0) * 100) / 100;
}
/* does this receipt read like a rental COST (not a deposit / refund)? category rentals on the record or Cap's guess */
function rcptLooksRental(r) {
  if (!r || r.isDeposit || r.refundOfId || r.depositSettled) return false;
  var sug = r.suggested || {};
  var cat = String(r.category || sug.category || "").toLowerCase();
  return cat === "rentals";
}

/* rcptDepositMatch(receipt) → the best OPEN unsettled deposit this rental-cost receipt likely SETTLES, or null.
   Heuristic: same normalized vendor AND (same job, when both name one) AND the deposit ≥ the receipt's net (a
   deposit covers the rental cost). Returns {deposit, job, net (receipt's net cost), impliedRefund = deposit − net}.
   Never matches a receipt that is itself a deposit/refund/already-settled. Pure — no DOM, never throws. */
function rcptDepositMatch(receipt) {
  if (!receipt || !rcptLooksRental(receipt)) return null;
  if (typeof depositsAwaitingRefund !== "function") return null;
  var net = rcptNetCostOf(receipt);
  if (!(net > 0)) return null;
  var sug = receipt.suggested || {};
  var rv = rcptVendorNorm(receipt.vendor || sug.vendor || "");
  if (!rv) return null;
  var rJob = receipt.jobId || sug.jobId || null;
  var best = null;
  depositsAwaitingRefund().forEach(function (d) {
    var dep = d && d.deposit; if (!dep) return;
    if (rcptVendorNorm(dep.vendor || "") !== rv) return;                 // same (normalized) vendor
    if (rJob && d.job && d.job.id && rJob !== d.job.id) return;          // same job when both name one
    var depAmt = Math.round((+dep.amount || 0) * 100) / 100;
    if (!(depAmt >= net)) return;                                        // the deposit must cover the rental cost
    var cand = { deposit: dep, job: d.job, net: net, impliedRefund: Math.round((depAmt - net) * 100) / 100 };
    if (!best) { best = cand; return; }
    var candSameJob = !!(rJob && cand.job && cand.job.id === rJob), bestSameJob = !!(rJob && best.job && best.job.id === rJob);
    if (candSameJob && !bestSameJob) { best = cand; return; }            // prefer a same-job deposit
    if (candSameJob === bestSameJob && cand.impliedRefund < best.impliedRefund) best = cand;   // else the tightest fit
  });
  return best;
}

/* every open review receipt that Cap thinks SETTLES an open deposit → [{receipt, match}] (owner/admin only) */
function rcptDepositSuggestions() {
  if (!rcptFinFull()) return [];
  var out = [];
  (typeof rcptReview === "function" ? rcptReview() : []).forEach(function (r) {
    var m = rcptDepositMatch(r);
    if (m) out.push({ receipt: r, match: m });
  });
  return out;
}

/* 🔗 the suggestion card — one per matched receipt. One-tap "Settle from this receipt" runs the settlement through
   the existing js/96 machinery. Pure suggestion until tapped; owner/admin only (gated by rcptDepositSuggestions). */
function rcptDepositSuggestHTML(sugs) {
  var m2 = (typeof money2 === "function") ? money2 : function (n) { return "$" + n; };
  var h = `<div class="card" style="border-left:4px solid #6b3fa0"><b style="color:#6b3fa0">🔗 ${sugs.length} rental receipt${sugs.length > 1 ? "s" : ""} look${sugs.length > 1 ? "" : "s"} like a deposit settlement</b> — Cap matched ${sugs.length > 1 ? "these rentals" : "this rental"} to an open deposit. Settling links them so the deposit nets to the real cost and the same rental isn't counted twice.`;
  h += sugs.map(function (s) {
    var r = s.receipt, mt = s.match, dep = mt.deposit, j = mt.job;
    var cust = (j && j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
    var where = (j ? (j.title || "Job") : "no job") + (cust ? " · " + cust : "");
    var vend = r.vendor || (r.suggested && r.suggested.vendor) || dep.vendor || "";
    return `<div class="li" style="align-items:flex-start;gap:8px;margin-top:8px"><div class="grow" style="min-width:0">
      <div class="nm" style="white-space:normal">This looks like the settlement for your <b>${m2(dep.amount)}${vend ? " " + esc(vend) : ""} deposit</b> on <b>${esc(where)}</b>.</div>
      <div class="sub" style="white-space:normal">Cap read the rental at <b>${m2(mt.net)}</b>, so about <b>${m2(mt.impliedRefund)}</b> came back. Settle it to net the deposit to ${m2(mt.net)} and drop the duplicate.</div>
      </div><button class="btn sm" style="background:#6b3fa0;border-color:#6b3fa0;color:#fff;flex:0 0 auto" onclick="rcptSettleDepFromRcpt('review','','${esc(r.id)}','${esc(dep.id)}')">🔗 Settle from this receipt</button></div>`;
  }).join("");
  h += `</div>`;
  return h;
}

/* rcptSettleDepositFromReceipt(receiptLoc, depositId) — the one-tap action, avoids the double-count. receiptLoc =
   {store, jobId, recId}. Computes refund = depositAmount − receiptNet, adds it (NEGATIVE) + settles the deposit via
   the SAME js/96 machinery (so the deposit nets to the real cost), attaches the receipt's contract photo to the
   deposit as proof (only if the deposit has none), then soft-deletes (rcptTombstone — reversible) the separate
   rental receipt so it isn't a 2nd expense. Refuses if the numbers don't work (receipt net > deposit). Owner/admin.
   Returns {ok, ...} — never throws. DOM-free (the window wrapper does confirm + toast + render). */
function rcptSettleDepositFromReceipt(receiptLoc, depositId) {
  if (!rcptFinFull()) return { ok: false, reason: "denied" };
  if (!receiptLoc || !depositId) return { ok: false, reason: "missing" };
  var rec = (typeof rcptFindRecord === "function") ? rcptFindRecord(receiptLoc.store, receiptLoc.jobId || null, receiptLoc.recId) : null;
  if (!rec) return { ok: false, reason: "receipt-gone" };
  var entry = null;
  if (typeof depositsAwaitingRefund === "function") depositsAwaitingRefund().forEach(function (d) { if (d && d.deposit && d.deposit.id === depositId) entry = d; });
  if (!entry) return { ok: false, reason: "deposit-gone" };
  var dep = entry.deposit;
  var net = rcptNetCostOf(rec);
  var depAmt = Math.round((+dep.amount || 0) * 100) / 100;
  if (!(net > 0) || !(depAmt >= net)) return { ok: false, reason: "numbers", net: net, deposit: depAmt };   // receipt net > deposit → don't force it
  var refund = Math.round((depAmt - net) * 100) / 100;
  if (refund > 0 && typeof depositAddRefund === "function") depositAddRefund(depositId, -refund);   // stored NEGATIVE (js/96 abs()es → −refund)
  if (typeof depositSettle === "function") depositSettle(depositId);                                 // deposit + its refunds now count at NET
  if (rec.receiptId && !dep.receiptId && typeof depositAttachPhoto === "function") depositAttachPhoto(depositId, rec.receiptId);   // deposit carries the contract as proof
  if (typeof rcptTombstone === "function") rcptTombstone(receiptLoc.store, receiptLoc.jobId || null, receiptLoc.recId);            // absorb the redundant receipt (reversible)
  if (typeof save === "function") save();
  if (typeof logChange === "function") logChange("update", "expense", depositId, "🔗 Settled rental deposit from a receipt — net " + ((typeof money === "function") ? money(net) : net) + (refund > 0 ? " (refund " + ((typeof money === "function") ? money(refund) : refund) + " logged)" : "") + "; duplicate rental receipt absorbed");
  return { ok: true, depositId: depositId, net: net, refund: refund };
}
window.rcptSettleDepFromRcpt = function (store, jobId, recId, depositId) {
  if (!rcptFinFull()) return;
  var loc = { store: store, jobId: jobId || null, recId: recId };
  var rec = (typeof rcptFindRecord === "function") ? rcptFindRecord(loc.store, loc.jobId, loc.recId) : null;
  var mt = rec ? rcptDepositMatch(rec) : null;
  var pre = mt ? ("Link this receipt as the settlement of the " + money2(mt.deposit.amount) + " deposit?\n\nThe deposit will net to " + money2(mt.net) + (mt.impliedRefund > 0 ? " (refund " + money2(mt.impliedRefund) + " logged)" : "") + " and this separate rental receipt will be absorbed so it isn't counted twice. Reversible.") : "Settle this deposit from this receipt?";
  if (typeof confirm === "function" && !confirm(pre)) return;
  var res = rcptSettleDepositFromReceipt(loc, depositId);
  if (typeof closeModal === "function") closeModal();
  if (res && res.ok) { if (typeof toast === "function") toast("Deposit settled — net " + ((typeof money === "function") ? money(res.net) : res.net) + (res.refund > 0 ? ", refund " + ((typeof money === "function") ? money(res.refund) : res.refund) + " logged" : "") + "; the duplicate rental receipt was absorbed"); }
  else if (res && res.reason === "numbers") { if (typeof toast === "function") toast("That rental cost is more than the deposit — left both alone; settle it manually."); }
  else { if (typeof toast === "function") toast("Couldn't settle — the deposit or receipt isn't here anymore."); }
  if (typeof render === "function") render();
};
if (typeof window !== "undefined") { window.rcptDepositMatch = rcptDepositMatch; window.rcptDepositSuggestions = rcptDepositSuggestions; window.rcptSettleDepositFromReceipt = rcptSettleDepositFromReceipt; }

/* The "💳 Card" cell — just the last-4 used on this receipt (from the read/attribution). "For" already
   shows who owns it, so we don't repeat the name here. "—" when no card is recorded. Never throws. */
function rcptCardCell(r) {
  const l4 = (r && r.cardLast4) ? String(r.cardLast4).replace(/\D/g, "").slice(-4) : "";
  return l4 ? `💳 ••••${esc(l4)}` : `<span style="color:var(--muted)">—</span>`;
}
/* The "Order #" cell — the vendor order/transaction number (Lowe's etc.). Lives on r.refNo or is parsed from a
   "Order #NNN" desc (the CSV import bakes it there). Shown ABBREVIATED (…last 6); tap to COPY the full number to
   the clipboard (stopPropagation so it doesn't open the modal). "—" when the receipt has no order number. */
function rcptOrderNo(r) {
  if (!r) return "";
  // refNo can now be alphanumeric (contract/invoice #s from Cap vision, e.g. "INV-2024-118", "186510") — preserve it
  // AS-IS when it carries letters; a pure-digit ref is normalized to its digits (CSV order#s stay identical). Only
  // when there's no refNo do we fall back to parsing an "Order #NNN" out of the desc (the CSV import bakes it there).
  const raw = String(r.refNo || "").trim();
  if (raw) return /[A-Za-z]/.test(raw) ? raw : (raw.replace(/\D/g, "") || raw);
  const m = String(r.desc || "").match(/order\s*#?\s*(\d{4,})/i);   // "Order #147424942 · …"
  return m ? m[1] : "";
}
function rcptOrderCell(r) {
  const no = rcptOrderNo(r);
  if (!no) return `<span style="color:var(--muted)">—</span>`;
  const abbr = no.length > 6 ? "…" + no.slice(-6) : no;
  // label the tooltip by what KIND of reference it is (Cap's refType) — "Contract #186510", "Invoice #INV-…" — else "Ref #".
  const rt = r && typeof r.refType === "string" ? r.refType : "";
  const label = rt ? (rt.charAt(0).toUpperCase() + rt.slice(1)) : "Ref";
  return `<span onclick="event.stopPropagation();rcptCopyOrder('${esc(no)}',this)" title="${esc(label)} #${esc(no)} · tap to copy" style="cursor:pointer;white-space:nowrap;border-bottom:1px dotted var(--muted)">#${esc(abbr)}</span>`;
}
window.rcptCopyOrder = function (no, el) {
  const flash = () => { if (el) { const o = el.textContent; el.textContent = "✓ copied"; el.style.color = "#1e9e5a"; setTimeout(() => { try { el.textContent = o; el.style.color = ""; } catch (z) {} }, 1200); } };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(String(no)).then(flash, flash); return; }
  } catch (e) {}
  try { const t = document.createElement("textarea"); t.value = String(no); document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t); flash(); } catch (e) {}
};
/* `dups` = the {recId → group} map from rcptDupIndex().byId (an empty {} = "no dup flags", e.g. in unit tests). */
/* the 📎 cell: a photo (receiptId) wins; else a CSV-imported row links to its SOURCE CSV (csvFile); else blank.
   stopPropagation so tapping the link opens the file, not the row editor. Tiny + mobile-friendly. */
function rcptAttachLink(r) {
  if (!r) return "";
  const url = (typeof jsUploadUrl === "function") ? jsUploadUrl : function () { return ""; };
  if (r.receiptId) return `<a href="${url(r.receiptId)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📎</a>`;
  if (r.csvFile) return `<a href="${url(r.csvFile)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Source CSV${r.csvName ? " · " + esc(r.csvName) : ""}">📄 CSV</a>`;
  return "";
}
/* ============================== INLINE CLICK-TO-EDIT (Type · Category · 💳 Card · Job · For) ==============================
   Ray's ask: "I click on a card number or the type and instead of taking me to the modal, a little dropdown appears
   right there that lets me change it — so I can edit lots of receipts quickly without pulling up the menu each time."
   The five re-bucketing/attribution cells become distinct click targets (dotted-underline + ▾). Tapping one swaps
   ONLY that cell for a native <select> (event.stopPropagation() so the ROW's rcptEditOpen modal never fires); picking
   a value routes through rcptInlineSet → rcptApplyEdit (THE spine) — byte-identical to a modal save, re-buckets
   billing correctly (id + photo preserved). Blur/Escape with no change reverts (scoped repaint restores the text).
   Everything else in the row (Date/Vendor/Amount/By/📎/Status) still opens the full modal. Owner/admin only. */
let _rcptFlashId = null;   // recId to briefly flash green after an inline edit (self-clears on a timer)

/* distinct REGISTERED card last-4s for the inline 💳 dropdown (personal + company, from js/105). Never throws;
   returns [] when the card DB module isn't present (e.g. headless unit tests) — the dropdown still offers none + current. */
function rcptRegisteredCards() {
  const set = {};
  try {
    if (typeof adminCardsData === "function") {
      const d = adminCardsData() || {};
      (d.people || []).forEach(p => (p.cards || []).forEach(c => { const l = rcptCard4(c && c.last4); if (l) set[l] = 1; }));
      (d.company || []).forEach(c => { const l = rcptCard4(c && c.last4); if (l) set[l] = 1; });
    }
  } catch (e) {}
  return Object.keys(set).sort();
}
/* the record's current value for `field`, in the same shape the modal's control preselects (so the open dropdown
   shows what's set today). type: "" = review (mirrors the Type <select>). */
function rcptInlineCurrentValue(rec, store, jobId, field) {
  const meta = rcptRowMeta(Object.assign({}, rec, { store: store, jobId: jobId }));
  if (field === "type") return meta.type === "review" ? "" : meta.type;
  if (field === "category") return rec.category || "";
  if (field === "cardLast4") return rcptCard4(rec.cardLast4);
  if (field === "jobId") return jobId || rec.jobId || "";
  if (field === "attributedTo") return rec.attributedTo || rec.paidBy || rec.uploadedBy || "";
  return "";
}
/* option list [{v,label}] for `field` — same sources the modal uses (RCPT_TYPE_LABEL / RCPT_CATS / rcptJobs /
   rcptMembers / registered cards), each with an explicit "clear" option. The record's current odd-value (a
   category or card not in the registry) is appended so it still shows as selected. */
function rcptInlineOptions(rec, store, jobId, field) {
  if (field === "type") return [{ v: "", label: RCPT_TYPE_LABEL.review }, { v: "business", label: RCPT_TYPE_LABEL.business }, { v: "job-expense", label: RCPT_TYPE_LABEL["job-expense"] }, { v: "pass-through", label: RCPT_TYPE_LABEL["pass-through"] }];
  if (field === "category") {
    const opts = [{ v: "", label: "— category —" }].concat(RCPT_CATS.map(c => ({ v: c, label: c })));
    if (rec.category && RCPT_CATS.indexOf(rec.category) < 0) opts.push({ v: rec.category, label: rec.category });
    return opts;
  }
  if (field === "cardLast4") {
    const cur = rcptCard4(rec.cardLast4);
    const cards = rcptRegisteredCards();
    if (cur && cards.indexOf(cur) < 0) cards.push(cur);   // keep the current (unregistered) card visible + selected
    return [{ v: "", label: "— none —" }].concat(cards.sort().map(l => ({ v: l, label: "••••" + l })));
  }
  if (field === "jobId") {
    return [{ v: "", label: "— no job —" }].concat(rcptJobs().map(j => ({
      v: j.id,
      label: ((typeof jobPO === "function" && jobPO(j)) ? jobPO(j) + " · " : "") + (j.title || "Job") + ((j.customerId && typeof custName === "function") ? " · " + custName(j.customerId) : "")
    })));
  }
  if (field === "attributedTo") return [{ v: "", label: "— nobody —" }].concat(rcptMembers().map(u => ({ v: u.id, label: u.username })));
  return [];
}
/* build the inline <select> for a cell (rendered into the tapped <td>). stopPropagation on click/change so the row
   modal never fires; onchange commits via rcptInlineSet; onblur reverts (scoped repaint) when nothing was picked. */
function rcptInlineSelectHTML(rec, store, jobId, recId, field) {
  const opts = rcptInlineOptions(rec, store, jobId, field);
  const cur = rcptInlineCurrentValue(rec, store, jobId, field);
  const body = opts.map(o => `<option value="${esc(o.v)}"${o.v === cur ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  const args = `'${esc(store)}','${esc(jobId || "")}','${esc(recId)}','${esc(field)}'`;
  return `<select onclick="event.stopPropagation()" onchange="event.stopPropagation();rcptInlineSet(${args},this.value)" onblur="rcptInlineBlur(this)" style="font-size:13px;max-width:160px;padding:5px 4px;min-height:36px">${body}</select>`;
}
/* the editable cell: the display value + a subtle dotted-underline / ▾ affordance, the whole <td> a click target
   that swaps to the inline <select> (event.stopPropagation() so the row's modal-open never fires). */
function rcptInlineTd(store, jobId, recId, field, display, whiteSpace) {
  const ws = whiteSpace || "nowrap";
  return `<td onclick="event.stopPropagation();rcptInlineOpen(this,'${esc(store)}','${esc(jobId || "")}','${esc(recId)}','${esc(field)}')" style="padding:8px 6px;cursor:pointer;white-space:${ws}" title="Tap to change">`
    + `<span style="border-bottom:1px dotted var(--muted)">${display}</span><span style="color:var(--muted);font-size:10px"> ▾</span></td>`;
}
/* TAP → swap this cell for the inline <select> (focused; opened when the browser allows). No-op if it's already
   an open select, or the record has moved. Owner/admin only. */
window.rcptInlineOpen = function (td, store, jobId, recId, field) {
  if (!rcptFinFull()) return;
  if (!td) return;
  if (td.querySelector && td.querySelector("select")) return;   // already editing this cell
  const rec = rcptFindRecord(store, jobId || null, recId);
  if (!rec) { alert("That receipt isn't here anymore — it may have been moved. Refreshing."); if (typeof render === "function") render(); return; }
  td.innerHTML = rcptInlineSelectHTML(rec, store, jobId, recId, field);
  const el = td.querySelector ? td.querySelector("select") : null;
  if (el) { try { el.focus(); } catch (e) {} try { if (typeof el.showPicker === "function") el.showPicker(); } catch (e) {} }
};
/* blur with no committed change → restore the text cell (a committed change already repainted, detaching this
   select, so the isConnected guard makes that blur a no-op). */
window.rcptInlineBlur = function (el) {
  try { if (el && el.isConnected === false) return; } catch (e) {}
  if (typeof rcptRepaintList === "function") rcptRepaintList();
};
/* THE inline commit. Rebuilds the FULL fields object from the record's CURRENT values (mirrors exactly what
   rcptEditOpen/rcptSaveEdit gather — nothing dropped), overrides the ONE edited field, then routes through
   rcptApplyEdit (the tested spine). A Type/Job change re-buckets billing (id + photo preserved); a Category/Card/
   For change updates in place. Byte-identical to a modal save. save() + scoped repaint + a brief green flash. */
window.rcptInlineSet = function (store, jobId, recId, field, value) {
  if (!rcptFinFull()) return;
  const rec = rcptFindRecord(store, jobId || null, recId);
  if (!rec) { alert("That receipt isn't here anymore — it may have been moved. Refreshing."); if (typeof render === "function") render(); return; }
  const meta = rcptRowMeta(Object.assign({}, rec, { store: store, jobId: jobId }));
  // CURRENT values (mirror the modal's gather from the record)
  let type = meta.type === "review" ? "" : meta.type;                       // "" = review
  let curJob = jobId || rec.jobId || "";
  let category = rec.category || "";
  let cardLast4 = rcptCard4(rec.cardLast4);
  let attributedTo = rec.attributedTo || rec.paidBy || rec.uploadedBy || "";
  // apply the ONE inline override
  if (field === "type") type = value || "";
  else if (field === "category") category = value || "";
  else if (field === "cardLast4") cardLast4 = rcptCard4(value);
  else if (field === "jobId") curJob = value || "";
  else if (field === "attributedTo") attributedTo = value || "";
  // jobId tracks the (possibly-new) type exactly like rcptSaveEdit; when the user edited Job itself, honor it too
  const jobIsType = (type === "job-expense" || type === "pass-through");
  const jobIdF = jobIsType ? curJob : (field === "jobId" ? curJob : "");
  // amount / vendor / date / desc / deposit / refund — carried through unchanged (same derivations as rcptSaveEdit)
  const amount = (rec.amount == null || rec.amount === "") ? null : (parseFloat(rec.amount) || 0);
  const vendor = String(rec.vendor || "").trim();
  const date = rcptDate(rec) || "";
  const desc = String(rec.desc || rec.note || "").trim();
  const paidBy = rec.paidBy || "";
  const isDeposit = !!rec.isDeposit;
  const isRefund = rec.kind === "refund";
  let amt = amount;
  if (isRefund && amt != null) amt = -Math.abs(amt);
  const cat = (isDeposit && !category) ? "rentals" : category;
  const fields = { type: type || null, jobId: jobIdF || null, amount: amt, vendor: vendor, date: date, category: cat, paidBy: paidBy || null, attributedTo: attributedTo || null, desc: desc, receiptId: rec.receiptId || null, cardLast4: cardLast4, isDeposit: isDeposit, kind: isRefund ? "refund" : "" };
  const res = rcptApplyEdit({ store: store, jobId: jobId || null, recId: recId }, fields);
  if (!res || !res.ok) { alert("Couldn't update: " + ((res && res.error) || "unknown")); return; }
  rcptStampReviewed(res.newLoc);   // a human inline edit = reviewed → clears the purple Cap-auto-file mark
  if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Receipt inline-edit · " + field + " → " + (value || "—") + (vendor ? " · " + vendor : ""));
  if (typeof save === "function") save();
  _rcptFlashId = res.newLoc.recId;
  if (typeof rcptRepaintList === "function") rcptRepaintList();
  if (typeof setTimeout === "function") setTimeout(function () { _rcptFlashId = null; if (typeof rcptRepaintList === "function") rcptRepaintList(); }, 1400);
  return res;
};

/* ============================== CAP AUTO-FILE — CLEAR THE PURPLE "🤖 review" MARK ==============================
   A Cap-auto-filed receipt (capAutoFiled:true, capReviewedAt:null) carries the purple mark until a HUMAN touches
   it. Any human touch counts as reviewed:
     • an inline edit (rcptInlineSet) or modal save (js/87 rcptSaveEdit) → both call rcptStampReviewed(newLoc);
     • the explicit one-tap "✓ Reviewed" on the purple row → rcptMarkReviewed.
   Both just stamp capReviewedAt (additive; read by nothing in the money math) + touch + save + scoped repaint —
   no re-bucketing, so the billing record is untouched. Owner/admin only. */
window.rcptStampReviewed = function (loc) {
  if (!loc || typeof rcptFindRecord !== "function") return null;
  const rec = rcptFindRecord(loc.store, loc.jobId || null, loc.recId);
  if (rec && rec.capAutoFiled && !rec.capReviewedAt) {
    rec.capReviewedAt = (typeof now === "function") ? now() : Date.now();
    if (typeof rcptTouchHome === "function") rcptTouchHome({ store: loc.store, jobId: loc.jobId || null }, rec);
    else if (typeof touch === "function") touch(rec);
  }
  return rec;
};
window.rcptMarkReviewed = function (store, jobId, recId) {
  if (!rcptFinFull()) return;
  const rec = rcptFindRecord(store, jobId || null, recId);
  if (!rec) { alert("That receipt isn't here anymore — it may have been moved. Refreshing."); if (typeof render === "function") render(); return; }
  if (!rec.capAutoFiled || rec.capReviewedAt) return;   // nothing to clear (idempotent)
  rec.capReviewedAt = (typeof now === "function") ? now() : Date.now();
  if (typeof rcptTouchHome === "function") rcptTouchHome({ store: store, jobId: jobId || null }, rec);
  else if (typeof touch === "function") touch(rec);
  if (typeof logChange === "function") logChange("update", "expense", recId, "Reviewed Cap-auto-filed receipt" + (rec.vendor ? " · " + rec.vendor : ""));
  if (typeof save === "function") save();
  _rcptFlashId = recId;
  if (typeof rcptRepaintList === "function") rcptRepaintList();
  if (typeof setTimeout === "function") setTimeout(function () { _rcptFlashId = null; if (typeof rcptRepaintList === "function") rcptRepaintList(); }, 1400);
};

function rcptTableHTML(rows, dups) {
  dups = dups || {};
  if (!rows.length) return `<div class="card"><div class="muted">No receipts here. Upload a stack above.</div></div>`;
  const th = (col, label, align) => `<th onclick="rcptSortBy('${col}')" style="text-align:${align || "left"};cursor:pointer;white-space:nowrap;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted);user-select:none">${label}${rcptSortArrow(col)}</th>`;
  let h = `<div class="card" style="padding:4px 4px 6px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr>${th("date", "Date")}${th("vendor", "Vendor")}${th("amount", "Amount", "right")}${th("type", "Type")}${th("category", "Category")}${th("job", "Job / Customer")}${th("uploader", "By")}${th("attributedTo", "For")}${th("card", "💳 Card")}${th("order", "Ref #")}<th style="padding:8px 6px;border-bottom:2px solid var(--line)">📎</th>${th("status", "Status")}</tr></thead><tbody>`;
  const splitGroups = rcptSplitGroupMap();
  const canFileIt = rcptFinFull();   // one-tap "file it" is owner/admin only (crew never see this table)
  rows.slice(0, 500).forEach(r => {
    const m = rcptRowMeta(r);
    const isDup = !!(r.amount && (dups[r.recId] || dups[r.id]));
    // Phase B — a REVIEW row Cap is confident about gets a prominent green one-tap "file it" (in addition to the
    // row opening the modal on tap). Files through rcptFileSuggestion → the spine funnel → byte-identical record.
    const oneTap = canFileIt && r.store === "review" && typeof rcptSuggestionOneTapOk === "function" && rcptSuggestionOneTapOk(r);
    const fileItBtn = oneTap ? `<div style="margin-top:5px"><button class="btn sm" style="background:#1e9e5a;border-color:#1e9e5a;color:#fff;white-space:normal" onclick="event.stopPropagation();rcptFileItRow('${r.store}','${r.jobId || ""}','${r.recId}')">✓ Looks right — file it</button></div>` : "";
    // Cap AUTO-FILED (purple) — the owner reviews it instead of confirming it: a one-tap "✓ Reviewed" clears the
    // mark (any inline/modal edit clears it too). Owner/admin only (this table is never shown to crew).
    const needsCapReview = rcptNeedsCapReview(r);
    const reviewedBtn = (canFileIt && needsCapReview) ? `<div style="margin-top:5px"><button class="btn sm" style="background:${RCPT_CAP_PURPLE};border-color:${RCPT_CAP_PURPLE};color:#fff;white-space:normal" onclick="event.stopPropagation();rcptMarkReviewed('${r.store}','${r.jobId || ""}','${r.recId}')">✓ Reviewed</button></div>` : "";
    const amt = (r.amount == null || r.amount === "") ? `<span style="color:var(--muted)">—</span>` : money2(r.amount);
    const d = rcptDate(r);
    const statusBadge = m.status === "review"
      ? `<span class="badge" style="background:var(--accent);color:#fff">review</span>`
      : r.paidBy
        ? (r.reimbursedAt
            ? `<span class="badge" style="background:var(--accent);color:#fff">✓ Paid back</span>`
            : `<span class="badge" style="background:#e0a800;color:#fff">Owed</span>`)
        : `<span class="badge" style="background:var(--soft);color:var(--muted)">filed</span>`;
    const isFlash = _rcptFlashId && (r.recId === _rcptFlashId || r.id === _rcptFlashId);
    const typeDisp = esc(RCPT_TYPE_LABEL[m.type] || m.type);
    const catDisp = r.category ? esc(r.category) : `<span style="color:var(--muted)">—</span>`;
    const jobDisp = `${m.cust ? esc(m.cust) : ""}${m.jobLabel ? `<div class="sub" style="font-size:11px">${esc(m.jobLabel)}</div>` : (m.cust ? "" : `<span style="color:var(--muted)">—</span>`)}`;
    const forDisp = m.forName ? esc(m.forName) : `<span style="color:var(--muted)">—</span>`;
    const cardDisp = rcptCardCell(r);
    const rowBg = isFlash ? ";background:var(--ok-soft,#e7f7ee)" : (isDup ? ";background:var(--danger-soft,#fdecea)" : (needsCapReview ? ";background:rgba(107,63,160,.08)" : ""));
    const capBorder = needsCapReview ? `;border-left:3px solid ${RCPT_CAP_PURPLE}` : "";
    h += `<tr onclick="rcptEditOpen('${r.store}','${r.jobId || ""}','${r.recId}')" style="cursor:pointer;border-bottom:1px solid var(--line)${capBorder}${rowBg}">
      <td style="padding:8px 6px;white-space:nowrap">${d ? esc(fmtDate(d)) : `<span style="color:var(--muted)">—</span>`}</td>
      <td style="padding:8px 6px;white-space:normal">${r.vendor ? esc(r.vendor) : `<span style="color:var(--muted)">—</span>`}${(r.desc || r.note) ? `<div class="sub" style="font-size:11px;white-space:normal">${esc(r.desc || r.note)}</div>` : ""}${rcptSplitSubline(r, splitGroups)}${isDup ? ` <span class="badge" style="background:var(--danger);color:#fff">⚠ dup</span>` : ""}${isFlash ? ` <span class="badge" style="background:#1e9e5a;color:#fff">✓ updated</span>` : ""}${r.suggested ? ` <span class="badge" style="background:#6b3fa0;color:#fff">🤖 Cap</span>` : ""}${needsCapReview ? ` <span class="badge" style="background:${RCPT_CAP_PURPLE};color:#fff" title="Cap auto-filed this from its guess — review it">🤖 review</span>` : ""}${typeof rentalDepositBadge === "function" ? " " + rentalDepositBadge(r) : ""}${typeof cardUnknownBadge === "function" ? cardUnknownBadge(r) : ""}${(r.inventoryItemId && typeof rcptInvItem === "function" && rcptInvItem(r.inventoryItemId)) ? ` <span class="badge" style="background:#1b7f4d;color:#fff" title="In inventory">🧰</span>` : ""}${fileItBtn}${reviewedBtn}</td>
      <td style="padding:8px 6px;text-align:right;white-space:nowrap">${amt}${r.paidBy ? `<div class="sub" style="font-size:10px">${r.reimbursedAt ? "✓ reimb" : "reimb"}</div>` : ""}</td>
      ${rcptInlineTd(r.store, r.jobId, r.recId, "type", typeDisp)}
      ${rcptInlineTd(r.store, r.jobId, r.recId, "category", catDisp)}
      ${rcptInlineTd(r.store, r.jobId, r.recId, "jobId", jobDisp, "normal")}
      <td style="padding:8px 6px;white-space:nowrap">${esc(m.uploader || "—")}</td>
      ${rcptInlineTd(r.store, r.jobId, r.recId, "attributedTo", forDisp)}
      ${rcptInlineTd(r.store, r.jobId, r.recId, "cardLast4", cardDisp)}
      <td style="padding:8px 6px;white-space:nowrap">${rcptOrderCell(r)}</td>
      <td style="padding:8px 6px" onclick="event.stopPropagation()">${rcptAttachLink(r)}</td>
      <td style="padding:8px 6px;white-space:nowrap">${statusBadge}</td></tr>`;
  });
  h += `</tbody></table>${rows.length > 500 ? `<div class="sub" style="text-align:center;margin-top:6px">Showing first 500 of ${rows.length}.</div>` : ""}</div>`;
  return h;
}

/* ============================== OWNER: PER-JOB CLOSE-OUT ROLL-UP ==============================
   Ray scans this to know when a job is safe to invoice accurately. Each active job with assigned crew shows
   N/M crew closed + who's still out ("waiting on Pierce"), or a clear ✓ ready-to-invoice badge when every
   crew member has closed. Filter: needs close-out (the queue) / ready to invoice / all. */
window.rcptSetJobFilter = function (f) { RCPT_JOBFILTER = f; render(); };
function rcptCloseoutJobs() { return rcptJobs().filter(j => jobCrewActiveIds(j).length > 0); }   // only jobs with active assigned crew to gate on
/* current expense total logged against a job = pass-through materials + job expenses (non-deleted).
   Shown in the close-out roll-up so the owner sees "how much is on this job" at a glance before invoicing. */
function jobExpenseTotal(j) {
  if (!j) return 0;
  const held = x => typeof depositHeld === "function" && depositHeld(x);   // HOLD-OUT (js/96): an unsettled deposit group is $0 here until settled at net
  const sum = arr => (Array.isArray(arr) ? arr : []).filter(x => x && !x.deleted && !held(x)).reduce((s, x) => s + (+x.amount || 0), 0);
  return sum(j.materials) + sum(j.expenses);
}
function rcptJobCloseoutHTML() {
  const jobs = rcptCloseoutJobs();
  const ready = jobs.filter(jobReceiptsFullyClosed);
  const needs = jobs.filter(j => !jobReceiptsFullyClosed(j));
  let shown = RCPT_JOBFILTER === "ready" ? ready : RCPT_JOBFILTER === "all" ? jobs : needs;
  let h = `<div class="secthd" style="margin-top:14px"><h2>📋 Job close-out</h2><span class="ct">${ready.length} ready</span></div>`;
  h += `<div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 6px">
    <button class="btn ${RCPT_JOBFILTER === "needs" ? "acc" : "ghost"} sm" onclick="rcptSetJobFilter('needs')">⏳ Needs close-out ${needs.length}</button>
    <button class="btn ${RCPT_JOBFILTER === "ready" ? "acc" : "ghost"} sm" onclick="rcptSetJobFilter('ready')">✓ Ready to invoice ${ready.length}</button>
    <button class="btn ${RCPT_JOBFILTER === "all" ? "acc" : "ghost"} sm" onclick="rcptSetJobFilter('all')">All ${jobs.length}</button></div>`;
  if (!jobs.length) return h + `<div class="card"><div class="muted">No active jobs with assigned crew yet. Once a job has crew, its receipt close-out status shows here.</div></div>`;
  if (!shown.length) return h + `<div class="card"><div class="muted">${RCPT_JOBFILTER === "ready" ? "No jobs are fully closed out yet — waiting on crew." : RCPT_JOBFILTER === "needs" ? "✓ Every job with crew is closed out — all clear to invoice." : "Nothing here."}</div></div>`;
  h += `<div class="card">`;
  shown.forEach(j => {
    const crew = jobCrewActiveIds(j), open = jobReceiptsOpenCrew(j), closedN = crew.length - open.length;
    const cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
    const full = jobReceiptsFullyClosed(j);
    const badge = full
      ? `<span class="badge" style="background:var(--accent);color:#fff">✓ Receipts closed — ready to invoice</span>`
      : `<span class="badge" style="background:#e0a800;color:#fff">${closedN}/${crew.length} crew closed</span>`;
    const waiting = open.map(id => (typeof userName === "function" ? userName(id) : "") || "?").filter(Boolean).join(", ");
    const expTot = jobExpenseTotal(j);   // pass-through materials + job expenses logged so far
    // whole row taps through to the job's expense page (js/61 openJobPage → the materials/expenses section)
    h += `<div class="li" onclick="if(typeof openJobPage==='function')openJobPage('${esc(j.id)}')" style="cursor:pointer;align-items:flex-start;flex-wrap:wrap;gap:6px${full ? "" : ";border-left:3px solid #e0a800;padding-left:8px"}">
      <div class="grow" style="min-width:160px"><div class="nm">${esc(j.title || "Job")} <span class="sub" style="color:var(--muted)">›</span></div><div class="sub">${cust ? esc(cust) + " · " : ""}${j.date ? esc(fmtDate(j.date)) : "no date"} · <b>${money2(expTot)}</b> expenses${!full && waiting ? ` · <span style="color:#b8860b">waiting on ${esc(waiting)}</span>` : ""}</div></div>
      <div style="flex:0 0 auto">${badge}</div></div>`;
  });
  h += `</div>`;
  return h;
}

/* is this receipt row THIS person's? — uploaded by them, attributed to them, or reimbursed to them (legacy). */
function rcptIsMine(r, meId) { return !!meId && (r.uploadedBy === meId || r.attributedTo === meId || r.paidBy === meId); }
/* CREW view — upload + a scannable list of receipts on file FOR THEM (their uploads + owner-attributed to them),
   so they can eyeball "is this already here?" and not re-upload a duplicate. NO business-wide financials, no
   other people's receipts, no edit/re-bucket/approve controls. */
function rcptCrewView() {
  const me = rcptMe(), meId = me ? me.id : "";
  const mine = rcptAllRows().filter(r => rcptIsMine(r, meId)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const pending = mine.filter(r => r.store === "review").length;
  let h = `<div class="secthd"><h2>📸 Receipts</h2></div>`;
  h += `<div class="card" ondragover="rcptDragOver(event)" ondragleave="rcptDragLeave(event)" ondrop="rcptDrop(event)">
    <div class="sub" style="white-space:normal">Snap or pick your receipts — pile them all in at once. They go to the owner to categorize &amp; file. You don't need to sort them. Check the list below first so you don't re-upload one that's already here.</div>
    <input type="file" id="rcpt_files" accept="image/*,application/pdf,.pdf,.csv,text/csv" multiple style="display:none" onchange="rcptUpload(this)">
    <button class="btn acc" style="width:100%;margin-top:8px" onclick="rcptPickFiles()">📷 Upload receipt photos</button>
    <div id="rcpt_upstatus" class="sub" style="text-align:center;margin-top:6px;color:var(--accent);min-height:16px"></div></div>`;

  // JOBS TO CLOSE OUT — the crew's clear "am I done?" list. Every job they worked (on the crew / have a
  // receipt on / clocked in) that they haven't yet marked done. Closing tells the owner no more expenses are
  // coming from them, so he can invoice accurately. Reversible.
  const worked = rcptWorkedJobsForMe(meId);
  const toClose = worked.filter(j => !jobReceiptsClosedByMe(j, meId));
  const doneJobs = worked.filter(j => jobReceiptsClosedByMe(j, meId));
  h += `<div class="secthd" style="margin-top:14px"><h2>📋 Jobs to close out</h2><span class="ct">${toClose.length}</span></div>`;
  if (!worked.length) {
    h += `<div class="card"><div class="muted">No jobs to close out yet — once you're on a job (or upload a receipt for one), it'll show here so you can mark when you're done adding expenses.</div></div>`;
  } else {
    h += `<div class="card"><div class="sub" style="white-space:normal;margin-bottom:8px">Once you've uploaded <b>all</b> your receipts &amp; expenses for a job and organized them, tap <b>Done</b>. That tells the owner no more expenses are coming from you, so he can invoice it accurately. Remembered one? Reopen it.</div>`;
    if (!toClose.length) h += `<div class="sub" style="color:var(--accent);margin-bottom:6px">✓ You're all caught up — every job you worked is closed out.</div>`;
    toClose.forEach(j => {
      const cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
      const cnt = rcptMyCountOnJob(j, meId);
      h += `<div class="li" style="align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div class="grow" style="min-width:150px"><div class="nm">${esc(j.title || "Job")}</div><div class="sub">${cust ? esc(cust) + " · " : ""}${j.date ? esc(fmtDate(j.date)) : "no date"} · ${cnt} of your receipt${cnt === 1 ? "" : "s"}</div></div>
        <button class="btn acc" style="flex:0 0 auto" onclick="jobCloseReceipts('${j.id}')">✓ Done — no more receipts for this job</button></div>`;
    });
    doneJobs.forEach(j => {
      const cust = (j.customerId && typeof custName === "function") ? custName(j.customerId) : "";
      h += `<div class="li" style="align-items:center;flex-wrap:wrap;gap:8px;opacity:.75">
        <div class="grow" style="min-width:150px"><div class="nm">${esc(j.title || "Job")} <span class="badge" style="background:var(--accent);color:#fff">✓ Closed</span></div><div class="sub">${cust ? esc(cust) + " · " : ""}${j.date ? esc(fmtDate(j.date)) : "no date"}</div></div>
        <button class="btn ghost sm" style="flex:0 0 auto" onclick="jobReopenReceipts('${j.id}')">Reopen</button></div>`;
    });
    h += `</div>`;
  }

  h += `<div class="secthd" style="margin-top:14px"><h2>Your receipts on file</h2><span class="ct">${mine.length}${pending ? " · " + pending + " pending" : ""}</span></div>`;
  if (!mine.length) { h += `<div class="card"><div class="muted">None yet. Upload a receipt above — it'll show here once it's on file.</div></div>`; return h; }
  h += `<div class="card" style="padding:4px 4px 6px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Date</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Vendor</th><th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Amount</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Job</th><th style="padding:8px 6px;border-bottom:2px solid var(--line)">📎</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--line);font-size:12px;color:var(--muted)">Status</th></tr></thead><tbody>`;
  h += mine.slice(0, 300).map(r => {
    const m = rcptRowMeta(r), d = rcptDate(r);
    const amt = (r.amount == null || r.amount === "") ? `<span style="color:var(--muted)">—</span>` : money2(r.amount);
    const statusBadge = m.status === "review" ? `<span class="badge" style="background:var(--accent);color:#fff">pending</span>` : `<span class="badge" style="background:var(--soft);color:var(--muted)">on file</span>`;
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:8px 6px;white-space:nowrap">${d ? esc(fmtDate(d)) : "—"}</td>
      <td style="padding:8px 6px;white-space:normal">${r.vendor ? esc(r.vendor) : `<span style="color:var(--muted)">—</span>`}${(r.desc || r.note) ? `<div class="sub" style="font-size:11px">${esc(r.desc || r.note)}</div>` : ""}</td>
      <td style="padding:8px 6px;text-align:right;white-space:nowrap">${amt}${r.paidBy === meId ? `<div class="sub" style="font-size:10px">${r.reimbursedAt ? "✓ paid back" : "reimburse"}</div>` : ""}</td>
      <td style="padding:8px 6px;white-space:normal">${m.cust ? esc(m.cust) : (m.jobLabel ? esc(m.jobLabel) : `<span style="color:var(--muted)">—</span>`)}</td>
      <td style="padding:8px 6px">${rcptAttachLink(r)}</td>
      <td style="padding:8px 6px;white-space:nowrap">${statusBadge}</td></tr>`;
  }).join("");
  h += `</tbody></table></div>`;
  return h;
}

/* THE reversible soft-delete used by every receipt-delete path (row delete, edit-modal delete, mark-as-duplicate,
   dup resolver). Tombstones the record IN PLACE in whichever array it lives — for a FILED receipt that removes
   it from job.materials/expenses or org expenses[] (so billing drops the charge); for a review copy it just
   tombstones the queue record. Never hard-deletes. Returns true if a record was found + tombstoned. */
function rcptTombstone(store, jobId, id) {
  const d = D();
  if (store === "review") { const e = (d.receipts || []).find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(e); return true; } return false; }
  if (store === "biz") { const e = (d.expenses || []).find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(e); return true; } return false; }
  const j = (d.jobs || []).find(x => x && x.id === jobId); if (!j) return false;
  const arr = store === "jobmat" ? (j.materials || []) : (j.expenses || []);
  const e = arr.find(x => x && x.id === id); if (e) { e.deleted = true; if (typeof touch === "function") touch(j); return true; }
  return false;
}
/* delete a receipt from wherever it lives (owner/admin only) */
window.rcptDelRow = function (store, jobId, id) {
  if (!rcptFinFull()) return;
  if (!confirm("Delete this receipt?")) return;
  rcptTombstone(store, jobId, id);
  if (typeof save === "function") save(); if (typeof closeModal === "function") closeModal(); render();
};

/* ============================== POSSIBLE-DUPLICATES RESOLVER (MERGE-first) ==============================
   The "⚠ N possible duplicates" card opens this. The RECOMMENDED action is now MERGE, not delete: Ray's insight
   — among duplicate copies of the SAME receipt, don't pick one and throw the other away (that lost the manual
   categorization he'd typed on one copy, or the clearer photo he re-uploaded on another). COMBINE them into one
   record keeping the best of each — the survivor's billing home + manual work AND the best photo + richest line
   items. The primary group action is "🔗 Merge into one receipt" (with a preview of what it keeps + where it
   lands). Per-copy "🗑 Delete this copy" stays as a SECONDARY manual option for genuine junk. Every action is
   owner/admin, confirm-before, reversible (rcptApplyEdit + the existing rcptTombstone soft-delete). */
function rcptDupResolveHTML() {
  const groups = rcptDupGroups();
  if (!groups.length) return `<div class="card"><div class="muted">✓ No possible duplicates right now.</div></div>`;
  let h = `<div class="sub" style="white-space:normal;margin-bottom:10px">Each block is a set of receipts with the <b>same amount</b> and a matching vendor, card, or transaction #. The recommended fix is to <b>🔗 merge them into one</b> — that keeps the <b>best of each copy</b> (your categorization + the clearest photo + the richest line items) instead of throwing one away. The absorbed copies are removed (an admin can undo). Different purchases that happen to cost the same? Leave them.</div>`;
  const GREEN = "#1b7f4d";
  groups.forEach(g => {
    const amt = money2(+g[0].amount || 0);
    // rank a COPY by info-richness (desc); newest breaks a tie. Matches rcptMergeSummary's A/B/C lettering.
    const ranked = g.map(r => ({ r: r, sc: rcptInfoScore(r) })).sort((a, b) => (b.sc.score - a.sc.score) || ((b.r.ts || 0) - (a.r.ts || 0)));
    const top = ranked[0], second = ranked[1];
    // the DEFAULT survivor the auto-merge would keep (a filed copy when one exists → billing preserved)
    const summary = (typeof rcptMergeSummary === "function") ? rcptMergeSummary(g) : null;
    const survivor = summary ? summary.survivor : top.r;
    const survivorId = survivor.recId != null ? survivor.recId : survivor.id;
    // near-tie = the top two are within 1 point (e.g. two photo copies filed to DIFFERENT jobs) → warn which job
    // the merge lands on and let Ray pick a different survivor per copy.
    const nearTie = !!(second && (top.sc.score - second.sc.score) <= 1);
    const jobIds = {}; g.forEach(r => { if (r.jobId) jobIds[r.jobId] = 1; });
    const diffJobs = Object.keys(jobIds).length > 1;
    h += `<div class="card" style="border-left:4px solid ${nearTie ? "var(--muted)" : "var(--danger)"};padding:8px 10px"><div class="nm" style="white-space:normal;margin-bottom:2px"><b>⚠ ${g.length} copies · ${amt}</b>${nearTie ? ` <span class="pill" style="background:var(--soft);color:var(--muted);margin-left:6px">≈ Similar — your call</span>` : ""}</div>`;
    // PRIMARY action: merge into one, with a live preview of what it keeps + where it lands.
    h += `<div class="row" style="margin:2px 0 4px"><button class="btn sm" style="background:${GREEN};color:#fff" onclick="rcptDupMerge('${esc(survivorId)}')">🔗 Merge into one receipt</button></div>`;
    if (summary) h += `<div class="sub" style="white-space:normal;color:${GREEN};margin-bottom:4px">${esc(rcptMergePreviewText(g))}</div>`;
    if (diffJobs) {
      h += `<div class="sub" style="white-space:normal;color:var(--muted);margin-bottom:4px">These copies are filed to <b>different jobs</b>. The merge lands on <b>${esc((summary && summary.jobLabel) || "the survivor's job")}</b> — if you want a different job, tap <b>🔗 Merge into THIS one</b> on that copy instead.</div>`;
    }
    ranked.forEach(({ r, sc }, idx) => {
      const m = (typeof rcptRowMeta === "function") ? rcptRowMeta(r) : { status: "" };
      const d = (typeof rcptDate === "function") ? rcptDate(r) : (r.date || "");
      const id = r.recId != null ? r.recId : r.id;
      const isSurv = id === survivorId;
      const letter = String.fromCharCode(65 + idx);
      const card = r.cardLast4 ? "💳 ••••" + esc(rcptCard4(r.cardLast4)) : "no card";
      const photo = r.receiptId ? `<a href="${(typeof jsUploadUrl === "function") ? jsUploadUrl(r.receiptId) : ""}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📎 photo</a>` : `<span style="color:var(--muted)">no photo</span>`;
      const rec = isSurv
        ? `<div class="sub" style="white-space:normal;color:${GREEN};font-weight:600">✅ Survivor — keeps its billing + your categorization (info: ${esc(sc.has.join(", ") || "—")})</div>`
        : `<div class="sub" style="white-space:normal;color:var(--muted)">↪ folds into the survivor — its ${esc(sc.has.join(", ") || "info")} is kept, nothing is lost${sc.missing.length ? " · missing: " + esc(sc.missing.join(", ")) : ""}</div>`;
      h += `<div class="li" style="align-items:flex-start;flex-wrap:wrap;gap:6px;border-top:1px solid var(--line);padding-top:8px;margin-top:8px">
        <div class="grow" style="min-width:150px"><div class="nm" style="white-space:normal"><span class="pill" style="background:var(--soft);color:var(--muted);margin-right:4px">${letter}</span>${r.vendor ? esc(r.vendor) : `<span style="color:var(--muted)">(no vendor)</span>`} · ${amt}</div>
        <div class="sub" style="white-space:normal">${d ? esc(fmtDate(d)) : "no date"} · ${card} · ${esc(m.status || "")}${r.where ? " · " + esc(r.where) : ""} · ${photo}</div>
        ${rec}</div>
        <div class="row" style="gap:6px;flex:0 0 auto">
          ${isSurv ? "" : `<button class="btn ghost sm" style="color:${GREEN}" onclick="rcptDupMerge('${esc(id)}')">🔗 Merge into THIS one</button>`}
          <button class="btn ghost sm" style="color:var(--danger)" onclick="rcptDupDelete('${r.store}','${esc(r.jobId || "")}','${esc(id)}')">🗑 Delete this copy</button>
        </div></div>`;
    });
    h += `</div>`;
  });
  return h;
}
window.rcptDupResolveOpen = function () {
  if (!rcptFinFull()) return;
  if (typeof modal !== "function") return;
  modal("⚠ Possible duplicates", rcptDupResolveHTML());
};
/* after any resolver delete: re-render the page behind, then re-open the resolver on fresh data (or close it
   when nothing's left to resolve). */
function rcptDupResolveAfter() {
  if (typeof save === "function") save();
  if (typeof render === "function") render();
  if (rcptDupGroups().length) rcptDupResolveOpen();
  else if (typeof closeModal === "function") closeModal();
}
/* MERGE a whole group into ONE record. Picks the survivor via rcptMergeFields (a filed copy when one exists →
   billing home + manual categorization preserved; forcedSurvivorId lets Ray override which copy survives), folds
   the richest line items onto the survivor, then applies the merged best-of field set through the tested
   rcptApplyEdit spine (same home → id + billing preserved, photo swapped in) and soft-deletes the absorbed copies
   via the existing reversible rcptTombstone path. Returns {ok,newLoc,absorbed} or {ok:false,error}. Never throws.
   NO new billing logic — reuses rcptMergeFields / rcptFindRecord / rcptApplyEdit / rcptTombstone. */
function rcptMergeGroup(group, forcedSurvivorId) {
  try {
    var g = (group || []).filter(Boolean);
    if (g.length < 2) return { ok: false, error: "need at least 2 copies to merge" };
    var merged = rcptMergeFields(g, forcedSurvivorId);
    if (!merged || !merged.survivor || !merged.survivorLoc) return { ok: false, error: "no survivor" };
    var loc = merged.survivorLoc;
    var survRec = (typeof rcptFindRecord === "function") ? rcptFindRecord(loc.store, loc.jobId, loc.recId) : null;
    if (!survRec) return { ok: false, error: "survivor not found" };
    // fold the richest line items / Cap read onto the survivor BEFORE the edit so the spine carries it through
    // (rcptApplyEdit preserves the survivor's own `suggested` — cap read isn't part of the fields set).
    if (merged.fields.suggested && merged.fields.suggested !== survRec.suggested) survRec.suggested = merged.fields.suggested;
    var res = (typeof rcptApplyEdit === "function") ? rcptApplyEdit({ store: loc.store, jobId: loc.jobId, recId: loc.recId }, merged.fields) : null;
    if (!res || !res.ok) return { ok: false, error: (res && res.error) || "merge edit failed" };
    // soft-delete every ABSORBED copy (reversible). The survivor kept its id (same-home edit), so skip it.
    var absorbed = 0;
    g.forEach(function (r) {
      var rid = r.recId != null ? r.recId : r.id;
      if (rid === loc.recId) return;
      if (typeof rcptTombstone === "function" && rcptTombstone(r.store, r.jobId || null, rid)) absorbed++;
    });
    return { ok: true, newLoc: res.newLoc, absorbed: absorbed };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}
/* the resolver's primary action — MERGE the group holding `survivorId` into that copy, keeping the best of each.
   Owner/admin, confirm (with the merged preview), reversible. Reuses rcptDupIndex / rcptMergeGroup / rcptDupResolveAfter. */
window.rcptDupMerge = function (survivorId) {
  if (!rcptFinFull()) return;
  const grp = rcptDupIndex().byId[survivorId];
  if (!grp) { rcptDupResolveAfter(); return; }
  const preview = (typeof rcptMergePreviewText === "function") ? rcptMergePreviewText(grp, survivorId) : "";
  if (!confirm("Merge these " + grp.length + " copies into one receipt?\n\n" + preview + "\n\n(An admin can undo.)")) return;
  const res = rcptMergeGroup(grp, survivorId);
  if (!res || !res.ok) { alert("Couldn't merge these copies: " + ((res && res.error) || "unknown")); return; }
  if (typeof logChange === "function") logChange("update", "expense", res.newLoc.recId, "Merged " + grp.length + " duplicate receipts into one — kept the best photo + line items + your categorization; removed " + res.absorbed + " absorbed cop" + (res.absorbed > 1 ? "ies" : "y"));
  rcptDupResolveAfter();
};
/* delete ONE copy from a group (keeps the others) — confirmed soft-delete via the existing path (SECONDARY:
   for genuine junk; MERGE is the recommended default) */
window.rcptDupDelete = function (store, jobId, id) {
  if (!rcptFinFull()) return;
  if (!confirm("Delete this copy as a duplicate? The other copy stays. This removes its charge from the books (an admin can undo).")) return;
  if (!rcptTombstone(store, jobId || null, id)) { alert("That copy isn't here anymore — refreshing."); }
  else if (typeof logChange === "function") logChange("delete", "expense", id, "Deleted a duplicate receipt (kept the other copy)");
  rcptDupResolveAfter();
};
/* KEEP this copy, delete every OTHER member of its group (one tap) — confirmed soft-delete via the existing path */
window.rcptDupKeep = function (keepStore, keepJobId, keepId) {
  if (!rcptFinFull()) return;
  const grp = rcptDupIndex().byId[keepId];
  if (!grp) { rcptDupResolveAfter(); return; }
  const others = grp.filter(r => (r.recId != null ? r.recId : r.id) !== keepId);
  if (!others.length) return;
  if (!confirm("Keep this one and delete the other " + others.length + " cop" + (others.length > 1 ? "ies" : "y") + " as duplicates? Their charges come off the books (an admin can undo).")) return;
  let n = 0;
  others.forEach(r => { if (rcptTombstone(r.store, r.jobId || null, r.recId != null ? r.recId : r.id)) n++; });
  if (n && typeof logChange === "function") logChange("delete", "expense", keepId, "Resolved duplicates — kept 1, deleted " + n + " cop" + (n > 1 ? "ies" : "y"));
  rcptDupResolveAfter();
};
/* ONE-TAP "keep the richest · delete the thinner" for a whole group. Re-derives the richest by rcptInfoScore
   (belt-and-suspenders — never trusts a stale button id), REFUSES on a near-tie (top two within 1 pt → owner's
   call), then soft-deletes ONLY the thinner copies via the existing rcptTombstone path. Never deletes the
   recommended-keep; never deletes more than the group's thinner copies. Owner/admin-gated, confirm-before,
   reversible. Reuses rcptDupIndex / rcptInfoScore / rcptTombstone / rcptDupResolveAfter — no new delete path. */
window.rcptDupKeepRichest = function (keepStore, keepJobId, keepId) {
  if (!rcptFinFull()) return;
  const grp = rcptDupIndex().byId[keepId];
  if (!grp) { rcptDupResolveAfter(); return; }
  const ranked = grp.map(r => ({ r: r, sc: rcptInfoScore(r) })).sort((a, b) => (b.sc.score - a.sc.score) || ((b.r.ts || 0) - (a.r.ts || 0)));
  const top = ranked[0], second = ranked[1];
  const topId = top.r.recId != null ? top.r.recId : top.r.id;
  if (topId !== keepId) { rcptDupResolveAfter(); return; }                          // stale id — the richest changed; re-open on fresh data
  if (second && (top.sc.score - second.sc.score) <= 1) { rcptDupResolveAfter(); return; }   // near-tie → no one-tap (owner's call)
  const others = grp.filter(r => (r.recId != null ? r.recId : r.id) !== keepId);
  if (!others.length) return;
  if (!confirm("Keep the richest copy (most info: " + (top.sc.has.join(", ") || "—") + ") and delete the " + others.length + " thinner cop" + (others.length > 1 ? "ies" : "y") + " as duplicates? Their charges come off the books (an admin can undo).")) return;
  let n = 0;
  others.forEach(r => { if (rcptTombstone(r.store, r.jobId || null, r.recId != null ? r.recId : r.id)) n++; });
  if (n && typeof logChange === "function") logChange("delete", "expense", keepId, "Resolved duplicates — kept the richest, deleted " + n + " thinner cop" + (n > 1 ? "ies" : "y"));
  rcptDupResolveAfter();
};
window.rcptSettle = function (memberId) {
  if (!rcptFinFull()) return;
  const owed = (rcptReimbOwed()[memberId] || 0), nm = (typeof userName === "function" ? userName(memberId) : "") || "this person";
  if (!confirm("Mark " + nm + " reimbursed for " + money(owed) + "? Clears their personal-card balance — do this once you've actually paid them back from the business funds.")) return;
  const t = now(), d = D();
  const settle = function (e) { if (e && !e.deleted && e.paidBy === memberId && !e.reimbursedAt) { e.reimbursedAt = t; return true; } return false; };
  (d.jobs || []).forEach(function (j) { if (j && !j.deleted) { let ch = false; (j.expenses || []).forEach(function (e) { if (settle(e)) ch = true; }); (j.materials || []).forEach(function (e) { if (settle(e)) ch = true; }); if (ch && typeof touch === "function") touch(j); } });
  (d.expenses || []).forEach(function (e) { if (settle(e) && typeof touch === "function") touch(e); });
  if (typeof logChange === "function") logChange("update", "expense", memberId, "Reimbursed " + nm + " " + money(owed) + " (personal-card spend settled)");
  if (typeof save === "function") save(); render();
};
