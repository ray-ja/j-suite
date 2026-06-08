/* ---------- EQUIPMENT AS A SCHEDULABLE RESOURCE (the helper that ties js/31 ↔ js/09) ----------
   Inventory items (js/31) are the master of WHAT Ray owns + HOW MANY (have? / qty). A scheduled
   Job (js/09) can carry a quantity-aware list of REQUIRED equipment: job.equipment = [{itemId,qty}].
   Because that list lives ON the job record, it rides the existing per-record LWW sync with zero
   merge-layer changes — same doctrine as job.crew and the quote→job link (see sync-server-tests.js).

   This module is pure logic (no DOM): owned-quantity parsing, per-date commitment roll-up, and
   conflict detection. Both the inventory tab (availability-by-date view) and the job editor
   (attach-equipment UI + inline conflict flags) call into these.

   Overlap model: jobs have a date + an optional start time but NO duration/return time, so we treat
   any two ACTIVE (not done, not deleted) jobs on the SAME calendar date as competing for the same
   gear. That's the honest, conservative read of "overlapping in date/time" until jobs gain an end
   time — refine eqJobsOverlap() then and every caller follows. A completed job has returned its
   gear, so it no longer ties anything up. */

/* owned count for an item: an explicit numeric qty is the truth; otherwise have? → 1, else 0. */
function eqOwnedQty(i){
  if(!i) return 0;
  var n = parseInt(String(i.qty==null?"":i.qty).replace(/[^0-9]/g,""),10);
  if(!isNaN(n) && n>0) return n;
  return i.have ? 1 : 0;
}
function eqItemById(id){ return (typeof actInv==="function"?actInv():[]).find(function(x){return x.id===id;}) || null; }
/* normalized required-equipment lines for a job: drops blanks, floors qty at 1 */
function jobEquip(job){
  return ((job&&job.equipment)||[]).filter(function(e){return e&&e.itemId;})
    .map(function(e){return {itemId:e.itemId, qty:Math.max(1, parseInt(e.qty,10)||1)};});
}
/* active jobs = the ones that can actually tie up gear (not deleted, not completed) */
function eqActiveJobs(){ return (typeof actJ==="function"?actJ():[]).filter(function(j){return !j.done;}); }
/* two jobs compete for gear if they're different active jobs on the same date */
function eqJobsOverlap(a,b){ return !!(a&&b&&a.id!==b.id&&a.date&&a.date===b.date); }

/* how much of an item is committed by OTHER jobs on a date (exceptJobId is the job being edited) */
function eqCommitments(itemId, dateStr, exceptJobId){
  var jobs=[], total=0;
  eqActiveJobs().forEach(function(j){
    if(j.date!==dateStr) return;
    if(exceptJobId && j.id===exceptJobId) return;
    var line=jobEquip(j).find(function(e){return e.itemId===itemId;});
    if(line){ total+=line.qty; jobs.push({job:j, qty:line.qty}); }
  });
  return {total:total, jobs:jobs};
}
/* conflict check for attaching `wantQty` of an item to a job on `dateStr`.
   over>0 means a shortfall (committedTotal exceeds owned). otherJobs = who else is holding it. */
function eqConflict(itemId, dateStr, wantQty, exceptJobId){
  var i=eqItemById(itemId), owned=eqOwnedQty(i);
  var c=eqCommitments(itemId, dateStr, exceptJobId);
  var requested=Math.max(0, parseInt(wantQty,10)||0);
  var committedTotal=c.total+requested;
  return {item:i, owned:owned, committedOther:c.total, requested:requested,
    committedTotal:committedTotal, over:committedTotal-owned, conflict:committedTotal>owned, otherJobs:c.jobs};
}
/* one-line, plain-text "rent / buy / reschedule" message (callers escape before injecting):
   e.g. "Hand truck / dolly: 2 owned, 3 committed on Job A, Job B — rent / buy / reschedule" */
function eqShortMsg(item, owned, committed, jobs){
  var name=item?item.name:"(removed item)";
  var names=(jobs||[]).map(function(x){return x.job.title||"Job";});
  var on=names.length?(" on "+names.slice(0,2).join(", ")+(names.length>2?" +"+(names.length-2):"")):"";
  return name+": "+owned+" owned, "+committed+" committed"+on+" — rent / buy / reschedule";
}
function eqConflictMsg(r){ return eqShortMsg(r.item, r.owned, r.committedTotal, r.otherJobs); }

/* roll-up for the availability-by-date view: every item committed on a date, with owned/committed/
   free and a conflict flag, conflicts sorted to the top. */
function eqAvailabilityByDate(dateStr){
  var map={};
  eqActiveJobs().forEach(function(j){
    if(j.date!==dateStr) return;
    jobEquip(j).forEach(function(e){
      var m=map[e.itemId]||(map[e.itemId]={itemId:e.itemId, committed:0, jobs:[]});
      m.committed+=e.qty; m.jobs.push({job:j, qty:e.qty});
    });
  });
  return Object.keys(map).map(function(id){
    var m=map[id], i=eqItemById(id), owned=eqOwnedQty(i);
    return {item:i, itemId:id, owned:owned, committed:m.committed, free:owned-m.committed,
      conflict:m.committed>owned, jobs:m.jobs};
  }).sort(function(a,b){ if(a.conflict!==b.conflict)return a.conflict?-1:1; return (b.committed-b.owned)-(a.committed-a.owned); });
}
/* count of over-committed items on a date — for compact badges */
function eqConflictCountOn(dateStr){ return eqAvailabilityByDate(dateStr).filter(function(r){return r.conflict;}).length; }
