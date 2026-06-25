/* ---------- ARCHIVE (soft-delete recycle bin) ----------
   Deleted jobs & quotes are soft-deleted (deleted=true + deletedAt) and live here for 60 days so a
   mistaken delete can be undone. After 60 days they drop out of the archive view. We never HARD-remove
   the record — per the data-safety rule, sync is per-record last-write-wins and would resurrect a
   dropped record; the tombstone stays (tiny) but is invisible. "Delete now" marks it purged so it
   leaves the list immediately. Per-business (D() = current business). */
const ARCHIVE_DAYS = 60;
function archiveItems(){
  const d = D(), cut = now() - ARCHIVE_DAYS*86400000;
  const mk = (coll,type) => (d[coll]||[]).filter(x => x && x.deleted && !x.purged && (x.deletedAt==null || x.deletedAt>cut)).map(x => ({type, rec:x}));
  return mk("jobs","job").concat(mk("quotes","quote")).sort((a,b) => (b.rec.deletedAt||0) - (a.rec.deletedAt||0));
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
    ? `<p class="muted" style="margin-bottom:8px">Deleted jobs &amp; quotes wait here, then auto-clear <b>${ARCHIVE_DAYS} days</b> after deletion. <b>Restore</b> brings one back; <b>Delete now</b> drops it from the list.</p>` + items.map(row).join("")
    : `<p class="muted">Empty. Deleted jobs &amp; quotes show here for ${ARCHIVE_DAYS} days so you can undo a mistake.</p>`);
};
function _archFind(type,id){ const d=D(); return (type==="job" ? (d.jobs||[]) : (d.quotes||[])).find(x => x && x.id===id); }
window.archRestore = function(type,id){
  const r = _archFind(type,id);
  if (r){ r.deleted=false; r.deletedAt=null; r.purged=false; if(typeof touch==="function")touch(r); if(typeof logChange==="function")logChange("update",type,id,"Restored from archive"); save(); }
  openArchive(); if(typeof render==="function")render();
};
window.archPurge = function(type,id){
  if(!confirm("Remove this from the archive now? You won't be able to restore it from here.")) return;
  const r = _archFind(type,id);
  if (r){ r.purged=true; r.purgedAt=now(); if(typeof touch==="function")touch(r); if(typeof logChange==="function")logChange("delete",type,id,"Cleared from archive"); save(); }
  openArchive(); if(typeof render==="function")render();
};
