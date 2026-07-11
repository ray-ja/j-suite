/* ---------- ARCHIVE (soft-delete recycle bin) ----------
   Deleting a job or quote archives the WHOLE funnel entry together — the quote, its job, and the job's
   sub-jobs (e.g. the materials-pickup run) — so it leaves the pipeline cleanly. Items live here 60 days
   so a mistaken delete can be undone, then drop out of view. We never HARD-remove the record (sync is
   per-record last-write-wins and would resurrect a dropped record) — the tombstone stays (tiny) but is
   invisible; "Delete now" sets purged=true to drop it from the list early. Per-business (D()). */
const ARCHIVE_DAYS = 60;
function _softDel(r){ if (r && !r.deleted){ r.deleted = true; r.deletedAt = now(); if (typeof touch==="function") touch(r); } }
function _unDel(r){ if (r){ r.deleted = false; r.deletedAt = null; r.purged = false; if (typeof touch==="function") touch(r); } }
function _purge(r){ if (r){ r.purged = true; r.purgedAt = now(); if (typeof touch==="function") touch(r); } }
// membership match (not just the legacy scalar parentJobId) — a stop-job cascades with EVERY job it's linked to via sharedJobIds
function _subJobs(d, jobId){ return (d.jobs||[]).filter(x => x && (x.parentJobId === jobId || (Array.isArray(x.sharedJobIds) && x.sharedJobIds.indexOf(jobId) >= 0))); }

// CASCADE soft-delete — job + its sub-jobs + its originating quote, or quote + its job + sub-jobs.
// deleting a quote must also tombstone the income it booked (else a deleted PAID quote counts revenue forever)
function _syncQInc(q){ if (q && typeof syncQuoteIncome === "function") syncQuoteIncome(q); }
function archiveDeleteJob(jobId){
  const d = D(), j = (d.jobs||[]).find(x => x && x.id === jobId); if (!j) return;
  _softDel(j); _subJobs(d, jobId).forEach(_softDel);
  if (j.quoteId){ const q = (d.quotes||[]).find(x => x && x.id === j.quoteId); _softDel(q); _syncQInc(q); }
}
function archiveDeleteQuote(quoteId){
  const d = D(), q = (d.quotes||[]).find(x => x && x.id === quoteId); if (!q) return;
  _softDel(q); _syncQInc(q);
  if (q.jobId){ const j = (d.jobs||[]).find(x => x && x.id === q.jobId); if (j){ _softDel(j); _subJobs(d, j.id).forEach(_softDel); } }
}

// one row per funnel: deleted quotes, plus standalone deleted jobs (no parent, and not already covered by a deleted quote).
function archiveItems(){
  const d = D(), cut = now() - ARCHIVE_DAYS*86400000;
  const within = x => x && x.deleted && !x.purged && (x.deletedAt==null || x.deletedAt > cut);
  const delQ = new Set((d.quotes||[]).filter(within).map(q => q.id));
  const items = (d.quotes||[]).filter(within).map(q => ({type:"quote", rec:q}));
  // a job LINKED to ≥1 other job (sharedJobIds non-empty, or the legacy parentJobId) rides in under that job's
  // cascade, not as its own row; a sharedJobIds=[] generic/overhead stop is linked to nothing, so it IS standalone
  (d.jobs||[]).filter(x => within(x) && !x.parentJobId && !(Array.isArray(x.sharedJobIds) && x.sharedJobIds.length) && !(x.quoteId && delQ.has(x.quoteId))).forEach(j => items.push({type:"job", rec:j}));
  return items.sort((a,b) => (b.rec.deletedAt||0) - (a.rec.deletedAt||0));
}
function archiveCount(){ try { return archiveItems().length; } catch(e){ return 0; } }

window.openArchive = function(){
  const items = archiveItems();
  const daysLeft = r => r.deletedAt != null ? Math.max(0, ARCHIVE_DAYS - Math.floor((now()-r.deletedAt)/86400000)) : null;
  const row = it => {
    const r = it.rec, lf = daysLeft(r),
      lab = it.type==="job" ? (r.title||"Job") : ((r.cust||"Quote") + (r.total!=null ? " · "+money(r.total) : "")),
      when = (r.deletedAt!=null && typeof relTime==="function") ? relTime(r.deletedAt) : "earlier";
    return `<div class="li"><div class="grow"><div class="nm" style="font-size:14px;white-space:normal">${it.type==="job"?"🗓":"📄"} ${esc(lab)}</div><div class="sub">deleted ${when}${lf!=null?` · clears in ${lf}d`:""}</div></div><div class="row" style="gap:6px;flex:0 0 auto"><button class="btn ghost sm" onclick="archRestore('${it.type}','${r.id}')">Restore</button><button class="btn danger sm" onclick="archPurge('${it.type}','${r.id}')">Delete now</button></div></div>`;
  };
  modal("🗑 Archive", items.length
    ? `<p class="muted" style="margin-bottom:8px">Deleted jobs &amp; quotes wait here, then auto-clear <b>${ARCHIVE_DAYS} days</b> after deletion. <b>Restore</b> brings the whole thing back (job + quote); <b>Delete now</b> drops it from the list.</p>` + items.map(row).join("")
    : `<p class="muted">Empty. Deleted jobs &amp; quotes show here for ${ARCHIVE_DAYS} days so you can undo a mistake.</p>`);
};

function _archEach(type, id, fn){
  const d = D();
  if (type === "quote"){ const q = (d.quotes||[]).find(x => x.id === id); fn(q); if (q && q.jobId){ const j = (d.jobs||[]).find(x => x.id === q.jobId); if (j){ fn(j); _subJobs(d, j.id).forEach(fn); } } }
  else { const j = (d.jobs||[]).find(x => x.id === id); fn(j); if (j){ _subJobs(d, id).forEach(fn); if (j.quoteId) fn((d.quotes||[]).find(x => x.id === j.quoteId)); } }
}
window.archRestore = function(type, id){
  _archEach(type, id, _unDel);
  // re-book income for a restored quote (it was tombstoned on delete) — symmetric with archiveDelete*
  const d = D(); const q = type === "quote" ? (d.quotes||[]).find(x => x.id === id) : (function(){ const j = (d.jobs||[]).find(x => x.id === id); return j && j.quoteId ? (d.quotes||[]).find(x => x.id === j.quoteId) : null; })();
  _syncQInc(q);
  if (typeof logChange==="function") logChange("update", type, id, "Restored from archive");
  save(); openArchive(); if (typeof render==="function") render();
};
window.archPurge = function(type, id){
  if (!confirm("Remove this from the archive now? You won't be able to restore it from here.")) return;
  _archEach(type, id, _purge);
  if (typeof logChange==="function") logChange("delete", type, id, "Cleared from archive");
  save(); openArchive(); if (typeof render==="function") render();
};
