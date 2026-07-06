/* ---------- PER-JOB PO CODE (js/95) ----------
   Ray types a short code into a vendor's register "PO Number" field. The app OWNS it: a stable per-job integer
   `j.poNum` (floor 1000 → first value 1001), DISPLAYED as "P"+pad4 → "P1042" — mirrors q.num / quoteNum() exactly.
   Additive field, rides the job record's LWW (NO new collection, NO server change). Assigned once at every
   job-create site (jobEnsurePO, just before touch) + a deterministic load()-time backfill for legacy jobs
   (js/02, a structural clone of the quote-num backfill — no updatedAt bump, idempotent, no one-shot flag).
   The CSV import (js/93) EXACT-matches a receipt to its job by this code, superseding the fuzzy
   PO→customer-name soft-hint (which stays the fallback when there's no exact match). Org-scoped everywhere
   (D()/actJ() only ever see the active org, so obx & jam can both have P1001). */

/* DISPLAY: "P1042" from the stored int (empty when unset). Mirrors quoteNum(). */
function jobPO(j){ return (j && j.poNum) ? ("P" + String(j.poNum).padStart(4, "0")) : ""; }

/* next PO number to hand out, org-scoped (D()); floor 1000 → first value 1001. Mirrors nextQuoteNum(). */
function nextJobPONum(){
  var jobs = (typeof D === "function" && D() && D().jobs) || [];
  return Math.max(1000, jobs.reduce(function (m, j) { return Math.max(m, (j && +j.poNum) || 0); }, 0)) + 1;
}

/* tolerant normalize a register-typed PO string → the integer, or null. "P1042" / "PO 1042" / "#1042" /
   "1042" / "p1042" → 1042; a name ("mike green") / "NA" / blank → null. Digits only; leading zeros fine. */
function poToNum(s){
  if (s == null) return null;
  var d = String(s).toUpperCase().replace(/[^0-9]/g, "");
  if (!d) return null;
  var n = parseInt(d, 10);
  return (isFinite(n) && n > 0) ? n : null;
}

/* the SINGLE active-org job whose poNum matches a raw code, else null. 0 matches OR >1 (ambiguous) → null
   (→ fuzzy fallback / manual route; never an auto-mismatch). Org-scoped via actJ(). */
function jobByPO(raw){
  var n = poToNum(raw); if (n == null) return null;
  var jobs = (typeof actJ === "function") ? actJ()
    : (((typeof D === "function" && D() && D().jobs) || []).filter(function (j) { return j && !j.deleted; }));
  var hits = jobs.filter(function (j) { return j && (+j.poNum || 0) === n; });
  return hits.length === 1 ? hits[0] : null;
}

/* assign a PO once (idempotent) — called just before touch() at every job-create site so the code shows instantly. */
function jobEnsurePO(j){ if (j && !j.poNum) j.poNum = nextJobPONum(); return j; }

/* clipboard-copy a job's PO + a toast (the job-page chip). Mirrors js/08's clipboard pattern. */
function jobCopyPO(id){
  var jobs = (typeof actJ === "function") ? actJ() : ((typeof D === "function" && D() && D().jobs) || []);
  var j = jobs.find(function (x) { return x && x.id === id; });
  var po = jobPO(j); if (!po) return;
  try { if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(po); } catch (e) {}
  if (typeof toast === "function") toast("Copied " + po + " — type it into the store's PO field");
  else if (typeof alert === "function") alert("PO " + po + " copied — type it into the store's PO field.");
}

if (typeof window !== "undefined") {
  window.jobPO = jobPO; window.nextJobPONum = nextJobPONum; window.poToNum = poToNum;
  window.jobByPO = jobByPO; window.jobEnsurePO = jobEnsurePO; window.jobCopyPO = jobCopyPO;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { jobPO: jobPO, nextJobPONum: nextJobPONum, poToNum: poToNum, jobByPO: jobByPO, jobEnsurePO: jobEnsurePO, jobCopyPO: jobCopyPO };
}
