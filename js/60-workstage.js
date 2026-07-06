/* ---------- WORK STAGE — the unified job-lifecycle status, DERIVED (no stored field) ----------
   Ray's pipeline in six words: lead → quote → job → expense collecting → invoice → paid.

   workStage(q) is a SUPERSET of js/08 quoteStage(q): it splits quoteStage's single "invoiced/scheduled"
   world into the real field lifecycle by reading the LINKED JOB — job.done + the receipt close-out
   (js/72 jobReceiptsFullyClosed / jobCrewActiveIds). It writes NOTHING and stores NOTHING: every stage
   is computed from booleans that already exist (q.accepted / q.jobId / job.done / fullyClosed / q.invoiced
   / q.paid), so billing / finance / invoicing stay byte-identical (they never read a status field). The
   "lead" stage is customer-level (customer.status==="Lead", js/01) and is handled by the funnel (js/67);
   workStage covers the five stages a QUOTE can be in.

   quoteStage(q) is deliberately left UNCHANGED so the existing search text stays identical. */

/* resolve the job linked to a quote: quote→job by q.jobId, else job→quote by job.quoteId. Active (non-deleted). */
function workStageJob(q) {
  if (!q) return null;
  const jobs = (typeof actJ === "function") ? actJ() : ((typeof D === "function" && D() && D().jobs) || []);
  if (q.jobId) { const j = jobs.find(x => x && x.id === q.jobId && !x.deleted); if (j) return j; }
  return jobs.find(x => x && x.quoteId === q.id && !x.deleted) || null;
}

/* the six-stage label + badge color set (mobile chip/badge friendly). `lead` is here for the funnel's use;
   workStage() itself never returns "lead" (that's a customer-level state). Colors align with QSTAGE_META
   where they overlap (quote=grey, job=blue, paid=green) so the Jobs-list badge color is unchanged. */
const workStageMeta = {
  lead:    { label: "Lead",               color: "#8a63d2" },
  quote:   { label: "Quote",              color: "#97a0ad" },
  job:     { label: "Job",                color: "#2f6fed" },
  expense: { label: "Expense collecting", color: "#d9822b" },
  invoice: { label: "Invoice",            color: "#e0a800" },
  paid:    { label: "Paid",               color: "#1a7f37" }
};

/* DERIVED stage for a quote — first match wins:
     paid     = q.paid
     invoice  = q.invoiced, OR (job done AND its receipts fully closed), OR (job done with NO active crew to
                gate on — the edge case, so a crewless done job can't stick in expense-collecting forever), OR
                (job done AND the owner EXPLICITLY signed off "all expenses collected", job.expensesCollected —
                so a slow crew member's un-closed receipts don't hold the pipeline in expense-collecting once
                the owner has confirmed the expenses are all in; payment was never blocked by this either way)
     expense  = job done, receipts NOT fully closed, not yet invoiced (still gathering crew receipts)
     job      = accepted or has a job, not yet done
     quote    = a quote exists and none of the above (sent, awaiting yes)
   All helper calls / new field reads are typeof-guarded so this is safe under node / partial loads. workStage
   still STORES nothing — expensesCollected is an additive job flag billing/finance never read. */
function workStage(q) {
  if (!q) return "quote";
  if (q.paid) return "paid";
  const job = workStageJob(q);
  const jobDone = !!(job && job.done);
  const fullyClosed = jobDone && (typeof jobReceiptsFullyClosed === "function") && jobReceiptsFullyClosed(job);
  const activeCrew = (job && typeof jobCrewActiveIds === "function") ? jobCrewActiveIds(job).length : 0;
  const noCrew = jobDone && activeCrew === 0;                       // nobody to close out → skip the close-out gate (invoice-ready)
  const signedOff = !!(job && job.expensesCollected);              // owner's explicit "all expenses collected" sign-off (additive flag)
  if (q.invoiced || (jobDone && (fullyClosed || noCrew || signedOff))) return "invoice";
  if (jobDone) return "expense";
  if (q.accepted || q.jobId) return "job";
  return "quote";
}

/* display label for a badge — for the expense stage it shows the LIVE close-out progress
   ("Expense collecting · 2/3 crew closed") pulled straight from the js/72 helpers. */
function workStageLabel(q) {
  const st = workStage(q), m = workStageMeta[st] || workStageMeta.quote;
  if (st === "expense") {
    const job = workStageJob(q);
    if (job && typeof jobCrewActiveIds === "function") {
      const crew = jobCrewActiveIds(job).length;
      const open = (typeof jobReceiptsOpenCrew === "function") ? jobReceiptsOpenCrew(job).length : crew;
      if (crew) return m.label + " · " + (crew - open) + "/" + crew + " crew closed";
    }
  }
  // A job that's already moved past collecting (invoiced/paid) but whose expenses AREN'T signed-off collected,
  // with crew still open, keeps a subtle "· expenses open" flag so the Jobs table doesn't drop the follow-up on
  // the slow crew member. The stage itself is UNCHANGED (paid stays paid) — this only annotates the label, and
  // only fires when a LINKED, DONE job has open crew and no owner sign-off (so no existing label shifts).
  if (st === "invoice" || st === "paid") {
    const job = workStageJob(q);
    if (job && job.done && !job.expensesCollected && typeof jobReceiptsOpenCrew === "function") {
      const open = jobReceiptsOpenCrew(job).length;
      if (open > 0) {
        // same closed/total counter as the orange "expense collecting" rows (e.g. "· 0/3") so a paid/invoiced job
        // still shows how many crew are outstanding — just without the "crew closed" words.
        const crew = (typeof jobCrewActiveIds === "function") ? jobCrewActiveIds(job).length : open;
        return m.label + " · expenses open · " + (crew - open) + "/" + crew;
      }
    }
  }
  return m.label;
}

/* active crew still to close out on a quote's job — the "waiting on <names>" list (empty when N/A). */
function workStageWaiting(q) {
  const job = workStageJob(q);
  if (!job || typeof jobReceiptsOpenCrew !== "function") return [];
  return jobReceiptsOpenCrew(job).map(id => (typeof userName === "function" ? userName(id) : "") || "").filter(Boolean);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { workStage: workStage, workStageJob: workStageJob, workStageMeta: workStageMeta, workStageLabel: workStageLabel, workStageWaiting: workStageWaiting };
}
