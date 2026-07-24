/* ---------- DEPOSIT GATE (js/118) — "waiting on deposit" before work can start ------------------------------
   Some jobs shouldn't be worked until the customer pays a deposit (which at a minimum should cover the materials).
   This adds a per-job deposit gate: the owner flips "require a deposit" on, and until a deposit is marked received
   the job shows "⏳ Waiting on deposit" and NOBODY can clock into it — the moment it's received, work is cleared.

   Fields ride the QUOTE record (no new collection, syncs like every other quote field):
     q.depositRequired (bool) · q.depositAmount (number, optional) · q.depositReceived (bool)
     q.depositReceivedDate · q.depositReceivedBy
   Additive + typeof-guarded so it's safe under node / partial loads and doesn't touch the workStage machine.
   Owner/admin set + clear deposits; the clock-in gate applies to everyone. */

function depQuoteFor(job) {
  if (!job || typeof D !== "function") return null;
  const qs = (D().quotes || []).filter(q => q && !q.deleted);
  if (job.quoteId) { const q = qs.find(x => x.id === job.quoteId); if (q) return q; }
  return qs.find(x => x.jobId === job.id) || null;
}
/* awaiting = a deposit is required on this job's quote and not yet marked received */
function depQuoteAwaiting(q) { return !!(q && q.depositRequired && !q.depositReceived); }
function depJobAwaiting(job) { return depQuoteAwaiting(depQuoteFor(job)); }
/* the clock-in gate: block starting work on a job whose deposit is still owed (looked up by job id) */
function depJobBlocksClockIn(jobId) {
  if (!jobId || typeof D !== "function") return false;
  const job = (D().jobs || []).find(j => j && j.id === jobId && !j.deleted);
  return job ? depJobAwaiting(job) : false;
}
window.depJobBlocksClockIn = depJobBlocksClockIn;   // read by the timeclock clock-in gate (js/38)
window.depJobAwaiting = depJobAwaiting;
window.depQuoteAwaiting = depQuoteAwaiting;

function depCanEdit() { return (typeof finCanView === "function") ? finCanView() : true; }   // owner/admin set deposits
function depMoney(n) { return (typeof money2 === "function") ? money2(n) : "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2); }

/* ---- owner actions (all touch the QUOTE record) ---- */
window.depToggleRequired = function (quoteId) {
  if (!depCanEdit()) { alert("Owner / Admin only."); return; }
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  q.depositRequired = !q.depositRequired;
  if (typeof touch === "function") touch(q); if (typeof save === "function") save();
  if (typeof render === "function") render();
};
window.depSetAmount = function (quoteId, val) {
  if (!depCanEdit()) return;
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  const n = parseFloat(val); q.depositAmount = isNaN(n) ? 0 : Math.round(n * 100) / 100;
  if (typeof touch === "function") touch(q); if (typeof save === "function") save();
};
window.depMarkReceived = function (quoteId) {
  if (!depCanEdit()) { alert("Owner / Admin only."); return; }
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  q.depositReceived = true;
  q.depositReceivedDate = (typeof today === "function") ? today() : "";
  if (typeof curUser === "function") { const u = curUser(); q.depositReceivedBy = u ? u.id : ""; }
  if (typeof touch === "function") touch(q); if (typeof save === "function") save();
  if (typeof render === "function") render();
};
window.depUndoReceived = function (quoteId) {
  if (!depCanEdit()) return;
  const q = (D().quotes || []).find(x => x && x.id === quoteId); if (!q) return;
  q.depositReceived = false; delete q.depositReceivedDate; delete q.depositReceivedBy;
  if (typeof touch === "function") touch(q); if (typeof save === "function") save();
  if (typeof render === "function") render();
};

/* a small status chip for job rows (Today / jobs list) — only shows when a deposit is outstanding */
function depBadgeHTML(job) {
  return depJobAwaiting(job) ? `<span class="badge" style="background:#c1121f;color:#fff">⏳ Waiting on deposit</span>` : "";
}
window.depBadgeHTML = depBadgeHTML;

/* the deposit strip the JOB page shows — READ-MOSTLY. The require/amount control lives on the QUOTE now (js/23);
   here the job only reflects state: nothing if no deposit is required, a "Pending deposit" block that gates work
   (with a Mark-received convenience for the owner), or — once received — the deposit shown as the crew's MATERIALS
   BUDGET so they can see the number they're working against. */
function depJobCardHTML(job) {
  if (!job) return "";
  const q = depQuoteFor(job); if (!q || !q.depositRequired) return "";   // no deposit on this job → nothing here
  const canEdit = depCanEdit();
  if (depQuoteAwaiting(q)) {
    return `<div class="card" style="padding:10px;border-left:4px solid #c1121f"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><div><b>⏳ Pending deposit</b><div class="sub" style="white-space:normal">Work can't start until the customer's deposit is in.${q.depositAmount ? " Asked: <b>" + depMoney(q.depositAmount) + "</b>." : ""}</div></div>${canEdit ? `<button class="btn acc sm" style="flex:0 0 auto" onclick="depMarkReceived('${q.id}')">✓ Deposit received</button>` : ""}</div></div>`;
  }
  return `<div class="card" style="padding:10px;border-left:4px solid var(--accent)"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><div><b>💰 Materials budget: ${depMoney(q.depositAmount || 0)}</b><div class="sub">Deposit received${q.depositReceivedDate ? " · " + (typeof fmtDate === "function" ? fmtDate(q.depositReceivedDate) : q.depositReceivedDate) : ""} — you can go over if the job needs it.</div></div>${canEdit ? `<button class="btn ghost sm" style="flex:0 0 auto" onclick="depUndoReceived('${q.id}')">Undo</button>` : ""}</div></div>`;
}
window.depJobCardHTML = depJobCardHTML;
