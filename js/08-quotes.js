/* ---------- QUOTES ---------- */
let QSEARCH="",QSTAGE_SET={};   // status filter is now MULTI-select: keys of QSTAGE_SET that are true are shown; {} = All
// Jobs-list sort (survives re-render; the ⇅ Sort control toggles). DEFAULT date-desc is byte-identical to the
// old list's `(b.date).localeCompare(a.date)` order. Plus the collapsible Date-range filter + hide-finished toggle.
let QSORT="date",QSORTDIR="desc",QDATE_FROM="",QDATE_TO="",QHIDE_DONE=true;   // hide fully-finished jobs by DEFAULT
const QSTAGE_ORDER={lead:0,quote:1,quoted:1,job:2,scheduled:2,expense:3,invoice:4,invoiced:4,paid:5};
function quoteStage(q){ if(q.paid)return "paid"; if(q.invoiced)return "invoiced"; if(q.accepted||q.jobId)return "scheduled"; return "quoted"; }
const QSTAGE_META={ paid:{label:"Paid",color:"#1a7f37"}, invoiced:{label:"Invoiced",color:"#e0a800"}, scheduled:{label:"Scheduled",color:"#2f6fed"}, quoted:{label:"Quoted",color:"#97a0ad"} };
function quoteType(q){ if(q&&q._jobOnly)return q.title||""; const items=(q&&q.items)||[];
  // A custom/write-in flat line renders as the generic "Custom price"; prefer the quote/job title so the row reads
  // as the real job (e.g. "Moving Labor"). Covers legacy rows saved before the _flat marker persisted (name only).
  if(q&&q.title&&items.length===1&&items[0]&&(items[0]._flat||items[0].name==="Custom price"))return q.title;
  const n=items.map(it=>it&&it.name).filter(Boolean); return n.length?(n[0]+(n.length>1?" +"+(n.length-1):"")):((q&&q.title)||""); }
/* stable human job number (#0001) + the next one to hand out */
function nextQuoteNum(){ return (D().quotes||[]).reduce((m,q)=>Math.max(m,+q.num||0),0)+1; }
function quoteNum(q){ return (q&&q.num)?("#"+String(q.num).padStart(4,"0")):""; }
/* "today" / "yesterday" / "3 days ago" / "in 2 days" for a YYYY-MM-DD date */
function agoStr(dateStr){ if(!dateStr)return ""; const d=new Date(dateStr+"T00:00:00"); if(isNaN(d))return ""; const t=new Date(); t.setHours(0,0,0,0); const days=Math.round((t-d)/86400000); if(days===0)return "today"; if(days===1)return "yesterday"; if(days===-1)return "tomorrow"; return days>1?(days+" days ago"):("in "+(-days)+" days"); }
// MULTI-select status filter: "all" clears the set; any stage key toggles in/out. Empty set = show every status.
window.quoteFilter=function(k){ QSHOWN=150; if(k==="all"){QSTAGE_SET={};} else if(QSTAGE_SET[k]){delete QSTAGE_SET[k];} else {QSTAGE_SET[k]=true;} rQuotes(); };   // reset cap on filter change
window.qToggleHideDone=function(){ QSHOWN=150; QHIDE_DONE=!QHIDE_DONE; rQuotes(); };   // show/hide fully-finished jobs
let QCREW_FILTER="";
function quoteCrew(q){ if(!q||!q.jobId)return []; const j=(typeof actJ==="function")?actJ().find(x=>x.id===q.jobId&&!x.deleted):null; return (j&&j.crew)||[]; }
window.quoteCrewFilter=function(id){ QSHOWN=150; QCREW_FILTER=id; rQuotes(); };   // reset cap on filter change
/* sort value + comparator for the Jobs table. DEFAULT (date/desc) reproduces the old
   `(b.date).localeCompare(a.date)` ordering exactly (V8-stable, no tiebreak) → byte-identical below the cap. */
/* jobless (virtual-quote) rows read the linked JOB directly — no quote lifecycle fields exist. Kept simple:
   paid/invoiced off the job if ever set, else done→invoice-ready / in-progress→job. NEVER touches real quotes. */
function jobOnlyStage(q){ const j=(typeof actJ==="function")&&actJ().find(x=>x&&x.id===q.jobId&&!x.deleted); if(!j)return "job"; if(j.paid)return "paid"; if(j.invoiced||j.done)return "invoice"; return "job"; }
/* stage for ANY Jobs-list row: a _jobOnly pseudo-quote uses jobOnlyStage; a REAL quote is byte-identical (workStage/quoteStage). */
function qWorkStage(q){ return (q&&q._jobOnly)?jobOnlyStage(q):((typeof workStage==="function")?workStage(q):quoteStage(q)); }
function qStageRank(q){ const st=qWorkStage(q); return (QSTAGE_ORDER[st]!=null)?QSTAGE_ORDER[st]:1; }
/* "Finished" = nothing left to do on this job, so it auto-hides from the Jobs list by default: it's PAID
   (done+invoiced+paid), the P&L is REVIEWED (plReviewed), and — if it has a live job — its receipts are all
   accounted for (every crew member has checked off close-out; jobReceiptsAccountedFor). "Show finished" reveals them. */
function qIsFinished(q){
  if(qWorkStage(q)!=="paid")return false;
  if(!(typeof plReviewed==="function"&&plReviewed(q)))return false;
  const j=q&&q.jobId&&(typeof actJ==="function")&&actJ().find(x=>x&&x.id===q.jobId&&!x.deleted);
  if(j){ const acc=(typeof jobReceiptsAccountedFor==="function")?jobReceiptsAccountedFor(j):!!j.rcptReviewedAt; if(!acc)return false; }   // crew still owe receipts → still needs attention
  return true;
}
/* count of finished jobs across the SAME base list the Jobs page shows (real quotes + quote-less orphan jobs) —
   drives the hide-toggle's "N finished" label. Mirrors quotesListHTML's orphan build; minimal shape is enough. */
function qFinishedCount(){
  const all=(typeof actQ==="function")?actQ():[];
  const _covered=new Set(all.filter(q=>q&&q.jobId).map(q=>q.jobId));
  const _orphans=(typeof actJ==="function"?actJ():[]).filter(j=>j&&!j.deleted&&!Array.isArray(j.sharedJobIds)&&!_covered.has(j.id)).map(j=>({jobId:j.id,_jobOnly:true}));
  return all.concat(_orphans).filter(qIsFinished).length;
}
/* the linked job's total cost for this quote's row: logged receipts (materials + expenses) PLUS the mileage
   payout (confirmed odometer, else the maps-route estimate — jobMilesCostEst). 0 when no live job. */
function qExpTotal(q){ const j=q&&q.jobId&&(typeof actJ==="function")&&actJ().find(x=>x&&x.id===q.jobId&&!x.deleted); if(!j)return 0; const rec=(typeof jobExpenseTotal==="function")?jobExpenseTotal(j):0; const mil=(typeof jobMilesCostEst==="function")?jobMilesCostEst(j):0; return rec+mil; }
/* muted 11px WHERE-the-money-went sub-line under the Expenses cell total: 🛣 mileage · 🚚 job expense ·
   🧱 pass-through materials (any zero bucket omitted; a reusable TOOL is business overhead, NOT shown on the
   job row). Pure display — empty string when there's nothing to break down (cell stays the total only). */
function qExpSubline(j){ if(!j||typeof jobCostBreakdown!=="function")return ""; const b=jobCostBreakdown(j); const parts=[]; if(b.mileage>0)parts.push("🛣 "+money(b.mileage)); if(b.jobExp>0)parts.push("🚚 "+money(b.jobExp)); if(b.materials>0)parts.push("🧱 "+money(b.materials)); return parts.length?`<div class="sub" style="font-size:11px;font-weight:400;white-space:nowrap">${parts.join(" · ")}</div>`:""; }
function qSortVal(q){
  switch(QSORT){
    case "customer": return (q.cust||custName(q.customerId)||"").toLowerCase();
    case "type": return quoteType(q).toLowerCase();
    case "status": return qStageRank(q);
    case "expenses": return qExpTotal(q);
    case "price": return (q.finalPrice||q.total||0);
    case "date": default: return q.date||"";
  }
}
function qSortCmp(a,b){ const dir=QSORTDIR==="asc"?1:-1,va=qSortVal(a),vb=qSortVal(b); if(va<vb)return -1*dir; if(va>vb)return 1*dir; return 0; }
/* sort trigger: picking a NEW column (from the ⇅ Sort <select>) takes its natural default (date/price desc,
   else asc); re-selecting the SAME column (the ▲/▼ direction button passes the current QSORT) toggles asc/desc.
   Repaints ONLY #qlist (the sort control lives inside it, so its selected option + arrow repaint with the list)
   — mirrors rcptSortBy/cSetSort. Sort LOGIC unchanged — only the trigger UI moved from <th> taps to a select. */
window.qSetSort=function(col){ if(QSORT===col)QSORTDIR=QSORTDIR==="asc"?"desc":"asc"; else{ QSORT=col; QSORTDIR=(col==="date"||col==="price")?"desc":"asc"; } QSHOWN=150; const c=document.getElementById("qlist"); if(c)c.innerHTML=quotesListHTML(); };
/* PURE results-list HTML — the empty / "No matches" / <table> branch ONLY. Everything OUTSIDE this
   (draft card, guided button, search input, status chips, crew select, Filters panel) is built by rQuotes().
   Kept pure so the SEARCH/sort/filter keystroke path can rebuild just #qlist without re-rendering — and
   destroying — the #qsearch input. All filters + the sort run on the FULL list ABOVE the Load-more slice. */
function quotesListHTML(){
  const all=actQ();
  // Quote-LESS jobs (Today → "＋ Add a job to clock into" / saveQuickTask) have NO quote to hang a Jobs-list row on,
  // so they were INVISIBLE here. Wrap each as a virtual-quote so it searches/filters/sorts/pages exactly like a quote.
  // Skip jobs already linked by a quote (q.jobId===j.id) and stops/sub-jobs (Array.isArray(sharedJobIds), like rcptJobs).
  const _covered=new Set(all.filter(q=>q&&q.jobId).map(q=>q.jobId));
  const _orphans=(typeof actJ==="function"?actJ():[]).filter(j=>j&&!j.deleted&&!Array.isArray(j.sharedJobIds)&&!_covered.has(j.id))
    .map(j=>({id:"vq_"+j.id,jobId:j.id,_jobOnly:true,cust:(custName(j.customerId)||""),customerId:j.customerId,date:j.date||"",title:j.title,total:0,accepted:true}));
  let list=all.concat(_orphans);
  if(QSEARCH){const qq=QSEARCH.toLowerCase();list=list.filter(q=>((q.cust||custName(q.customerId)||"")+" "+quoteType(q)+" "+(q.date||"")+" "+(q.invoiceNo||"")+" "+String(q.total||"")+" "+quoteStage(q)).toLowerCase().includes(qq));}
  const _stKeys=Object.keys(QSTAGE_SET).filter(k=>QSTAGE_SET[k]);
  if(_stKeys.length)list=list.filter(q=>_stKeys.indexOf(qWorkStage(q))>=0);   // MULTI-select: show any selected status
  if(QHIDE_DONE)list=list.filter(q=>!qIsFinished(q));   // default: hide fully-finished jobs (done+paid+reviewed+expensed)
  if(QCREW_FILTER){   // index active jobs by id ONCE (was actJ().find() per quote via quoteCrew → O(quotes×jobs))
    const _jm=new Map();(typeof actJ==="function"?actJ():[]).forEach(j=>{if(j&&j.id!=null&&!_jm.has(j.id))_jm.set(j.id,j);});
    list=list.filter(q=>{const j=q&&q.jobId?_jm.get(q.jobId):null;return ((j&&j.crew)||[]).indexOf(QCREW_FILTER)>=0;});
  }
  if(QDATE_FROM)list=list.filter(q=>(q.date||"")>=QDATE_FROM);
  if(QDATE_TO)list=list.filter(q=>(q.date||"")<=QDATE_TO);
  list.sort(qSortCmp);
  if(!all.length&&!_orphans.length)return `<div class="empty"><div class="big">🧾</div>No jobs yet.<br>Use Guided Quote above, or tap + for the quick builder.</div>`;
  if(!list.length){
    // If everything left is a finished job we're hiding, say so + offer to show them (rather than a bare "No matches").
    if(QHIDE_DONE&&!QSEARCH&&!QDATE_FROM&&!QDATE_TO&&qFinishedCount()>0)return `<div class="empty">✅ All caught up — every job here is done, paid &amp; reviewed.<br><button class="btn ghost sm" style="margin-top:8px" onclick="qToggleHideDone()">👁 Show finished jobs</button></div>`;
    return `<div class="empty">No matches.</div>`;
  }
  /* Load-more cap: filter/sort ABOVE run on the FULL list; we slice ONLY the final display array so search/sort
     always cover everything (a match beyond #150 is found, then shown when you load more). */
  const more=list.length>QSHOWN?`<button class="btn ghost" onclick="qLoadMore()">Load more (${Math.min(150,list.length-QSHOWN)} of ${list.length-QSHOWN} left)</button>`:"";
  const shown=list.slice(0,QSHOWN);
  // Compact SORT control (replaces the old tappable <th> headers): a <select> of the SAME columns drives the
  // UNCHANGED qSetSort(col) — picking a new column re-sorts; the ▲/▼ button re-selects the current column to
  // toggle direction. It lives INSIDE #qlist so its selected option + arrow repaint with the list on every sort.
  const sortOpts=[["date","Date"],["customer","Customer"],["type","Type"],["status","Status"],["expenses","Expenses"],["price","Price"]];
  const sortRow=`<div class="row" style="gap:8px;align-items:center;margin-bottom:8px">`
    +`<span class="sub" style="white-space:nowrap">⇅ Sort</span>`
    // emit selected="" (not the bare boolean) so this pure string is byte-identical to the DOM-serialized #qlist
    // it's rebuilt into — the scoped-search "scoped==inner" invariant string-compares the two (Chrome normalizes
    // a bare `selected` to `selected=""`, so a bare attr here would spuriously diverge from the live DOM).
    +`<select aria-label="Sort jobs" onchange="qSetSort(this.value)" style="font-size:13px;flex:1">${sortOpts.map(o=>`<option value="${o[0]}"${QSORT===o[0]?` selected=""`:""}>${o[1]}</option>`).join("")}</select>`
    +`<button class="btn ghost sm" aria-label="Toggle sort direction" onclick="qSetSort('${QSORT}')" style="white-space:nowrap">${QSORTDIR==="asc"?"▲":"▼"}</button>`
    +`<span class="sub" style="white-space:nowrap">${list.length}</span></div>`;
  // Full-width STACKED card list (was a 6-column <table> that cut off the Price column on a phone). Each job is
  // one tappable card: LEFT color bar = status; line 1 = Type/title (left) + Price (right); line 2 = customer ·
  // date · status label; an optional muted line 3 = expense total + breakdown. No horizontal scroll, big tap target.
  let h=sortRow+`<div class="card" style="padding:0;overflow:hidden">`;
  shown.forEach(q=>{
    const jo=!!q._jobOnly;
    const st=qWorkStage(q),m=((typeof workStageMeta!=="undefined")?workStageMeta[st]:null)||QSTAGE_META[st]||QSTAGE_META.quoted,cust=esc(q.cust||custName(q.customerId)||"—"),type=quoteType(q);
    const stLabel=jo?m.label:((typeof workStageLabel==="function")?workStageLabel(q):m.label);
    // Review after-action stays surfaced on PAID rows (uses the preserved plReview/plReviewed, js/67). A jobless
    // row has no quote to review, so it's skipped there.
    const rev=(!jo&&st==="paid")?((typeof plReviewed==="function"&&plReviewed(q))?` <span class="badge s-Won">✓ reviewed</span>`:` <button class="btn acc sm" onclick="event.stopPropagation();plReview('${q.id}')">Review →</button>`):"";
    // Accepted-with-live-job (and EVERY jobless row) → the unified job page; drafts/quote-stage (or job deleted) → wizard.
    const _lj=q.jobId&&(typeof actJ==="function")&&actJ().find(x=>x&&x.id===q.jobId&&!x.deleted);
    // A jobless row has no quote/price → em-dash Price + a subtle "no quote" nudge so the owner knows to quote it.
    const noQuoteHint=jo?` <span class="sub" style="font-size:11px;color:var(--muted)">· no quote</span>`:"";
    const recur=q.recurring?` <span class="sub" style="font-size:11px">· recurring</span>`:"";
    // Line 1 headline: Type/title (left, readable 15px bold) + Price (right, bold, green when paid). Jobless row = "—".
    const titleHTML=type?esc(type):`<span style="color:var(--muted)">—</span>`;
    const priceHTML=jo?`<span style="color:var(--muted)">—</span>`:`${money(q.finalPrice||q.total)}${(q.finalPrice&&q.finalPrice!==q.total)?`<div class="sub" style="font-weight:400">quote ${money(q.total)}</div>`:""}`;
    // Line 3 (tertiary, muted): the expense total + the 🛣/🚚/🧱 breakdown — only when a live job has logged costs.
    const expHTML=(_lj&&qExpTotal(q)>0)?`<div class="sub" style="font-size:12px;color:var(--muted);margin-top:3px">💵 ${money(qExpTotal(q))}${qExpSubline(_lj)}</div>`:"";
    h+=`<div onclick="${_lj?`openJobPage('${_lj.id}')`:`openQuote('${q.id}')`}" style="display:flex;gap:10px;padding:11px 12px;border-left:4px solid ${m.color};border-bottom:1px solid var(--line);cursor:pointer">`
      +`<div style="flex:1;min-width:0">`
        +`<div style="display:flex;gap:8px;justify-content:space-between;align-items:baseline">`
          +`<div style="flex:1;min-width:0;font-size:15px;font-weight:700;line-height:1.25">${titleHTML}${recur}${noQuoteHint}</div>`
          +`<div style="text-align:right;white-space:nowrap;font-size:15px;font-weight:800;color:${st==="paid"?"#1a7f37":"var(--brand-text)"}">${priceHTML}</div>`
        +`</div>`
        +`<div style="font-size:12.5px;color:var(--muted);margin-top:3px">${cust} · ${fmtDate(q.date)} · <span style="color:${m.color};font-weight:700">${esc(stLabel)}</span>${rev}</div>`
        +expHTML
      +`</div>`
      +`</div>`;
  });
  h+=`</div>`+more;
  return h;
}
/* Per-list shown cap (initial 150). qLoadMore bumps by 150 and repaints ONLY #qlist via the scoped path. */
let QSHOWN=150;
window.qLoadMore=function(){ QSHOWN+=150; const c=document.getElementById("qlist"); if(c)c.innerHTML=quotesListHTML(); };
/* scoped SEARCH re-render: rebuild ONLY #qlist so the #qsearch input is never destroyed — focus & caret
   survive with NO setSelectionRange refocus hack (mirrors adminFilterAccounts in js/32).
   RESET the cap first so a new filtered result set re-caps from the top. */
window.qSearchOn=function(v){ QSHOWN=150; QSEARCH=v; const c=document.getElementById("qlist"); if(c)c.innerHTML=quotesListHTML(); };
// Date-range filter (collapsed behind the Filters panel). Runs on the full list above the slice and repaints ONLY
// #qlist (the inputs live in the panel OUTSIDE #qlist, so they're never destroyed).
window.qDateFrom=function(v){ QSHOWN=150; QDATE_FROM=v; const c=document.getElementById("qlist"); if(c)c.innerHTML=quotesListHTML(); };
window.qDateTo=function(v){ QSHOWN=150; QDATE_TO=v; const c=document.getElementById("qlist"); if(c)c.innerHTML=quotesListHTML(); };
// Clear the date-range filter → full re-render so the panel inputs reset to empty too.
window.qClearFilters=function(){ QSHOWN=150; QDATE_FROM=""; QDATE_TO=""; rQuotes(); };
function rQuotes(){
  if(WZON)return wizRender();
  const dm=(typeof wzDraftMeta==="function")?wzDraftMeta():null;
  let h=`<h2>Jobs</h2>`;
  if(dm)h+=`<div class="card" style="border-left:4px solid var(--accent);margin-bottom:10px"><div class="nm">📝 Unsaved draft${dm.editing?" (editing a quote)":""}</div><div class="sub">${dm.name?esc(dm.name)+" · ":""}${dm.items} item(s) · ${money(dm.total)}</div><div class="row" style="gap:8px;margin-top:8px"><button class="btn acc grow" onclick="wizResumeDraft()">Resume draft</button><button class="btn ghost grow" onclick="wizDiscardDraft()">Discard</button></div></div>`;
  h+=`<div class="row" style="gap:8px;margin-bottom:10px"><button class="btn acc grow" onclick="startWizard()">✨ Guided Quote</button><button class="btn ghost grow" onclick="if(typeof navSub==='function')navSub('leads')">📞 Guided Lead</button></div>`;
  const all=actQ();
  if(all.length){
    h+=`<input class="search" id="qsearch" placeholder="Search jobs (customer, type, date)…" value="${esc(QSEARCH)}" oninput="qSearchOn(this.value)">`;
    // Status filter — MULTI-select. "All" clears the selection (shows every status); each chip toggles that status
    // in/out, so you can watch e.g. Job + Expense + Invoice at once but not Paid. "on" chip = currently selected.
    const stages=[["quote","Quote"],["job","Job"],["expense","Expense"],["invoice","Invoice"],["paid","Paid"]];
    const stKeys=Object.keys(QSTAGE_SET).filter(k=>QSTAGE_SET[k]);
    h+=`<div class="subnav" style="margin:8px 0"><button class="subbtn ${stKeys.length===0?"on":""}" onclick="quoteFilter('all')">All</button>`
      +stages.map(s=>`<button class="subbtn ${QSTAGE_SET[s[0]]?"on":""}" onclick="quoteFilter('${s[0]}')">${s[1]}</button>`).join("")+`</div>`;
    // Hide-finished toggle — ON by default so the list only shows jobs that still need something. A job is "finished"
    // when it's done + paid + P&L-reviewed + all its receipts accounted for; those drop off until you tap Show.
    const finN=qFinishedCount();
    h+=`<button class="btn ${QHIDE_DONE?"acc":"ghost"} sm" style="margin-bottom:10px" onclick="qToggleHideDone()">${QHIDE_DONE?`✅ Hiding ${finN} finished`:`👁 Showing all${finN?` (${finN} finished)`:""}`}</button>`;
    const crewM=(typeof realAccounts==="function"?realAccounts():[]);
    if(crewM.length)h+=`<select onchange="quoteCrewFilter(this.value)" style="font-size:13px;margin-bottom:10px">${[["","👥 All crew"]].concat(crewM.map(u=>[u.id,u.username])).map(o=>`<option value="${esc(o[0])}" ${QCREW_FILTER===o[0]?"selected":""}>${esc(o[1])}</option>`).join("")}</select>`;
    // Collapsible Date-range filter — kept behind a "Filters" toggle to stay mobile-clean. The panel lives OUTSIDE
    // #qlist so its inputs survive the scoped repaint. Open by default only when a date filter is set.
    const anyFilt=!!(QDATE_FROM||QDATE_TO);
    h+=`<details class="card" style="margin-bottom:10px"${anyFilt?" open":""}><summary style="cursor:pointer;font-weight:700;user-select:none">⚙️ Date range${anyFilt?" · on":""}</summary>`
      +`<div class="row" style="gap:8px;margin-top:8px"><div class="grow"><label>From</label><input type="date" value="${esc(QDATE_FROM)}" onchange="qDateFrom(this.value)" style="width:100%"></div><div class="grow"><label>To</label><input type="date" value="${esc(QDATE_TO)}" onchange="qDateTo(this.value)" style="width:100%"></div></div>`
      +(anyFilt?`<button class="btn ghost sm" style="margin-top:8px" onclick="qClearFilters()">Clear dates</button>`:"")
      +`</details>`;
  }
  h+=`<div id="qlist">${quotesListHTML()}</div>`;
  view.innerHTML=h;
}
let QITEMS=[];let CURQ=null;
/* The standalone quote modal has been RETIRED — saved quotes now open INTO the guided
   wizard (js/23, window.openQuote) for full editing: line edits, dump-fee inline input,
   discount/miles, print/copy, payment link, mark-invoiced/paid, and delete all live there.
   QITEMS/CURQ remain as the data source for the shared print/copy helpers below; the wizard
   feeds them via wizSyncLegacy()/wizFinish(). */
function quoteFigures(){
  if(CURQ&&CURQ.total!=null)return{sub:CURQ.subtotal||0,disc:CURQ.discount||0,total:CURQ.total};
  let sub=0;QITEMS.forEach(it=>sub+=(it.price||0)*(it.qty||1));return{sub:sub,disc:0,total:sub};
}
window.copyQuote=function(){
  const t=quoteFigures();const who=val("q_custfree")||(val("q_cust")?custName(val("q_cust")):"")||(CURQ&&CURQ.cust)||"";
  let lines=QITEMS.filter(it=>it.serviceId||it.name).map(it=>`• ${it.name}${it.qty>1?" ×"+it.qty:""} — ${money(it.price*it.qty)}`);
  let txt=`${S.biz==="obx"?"OBX Lot Solutions":"Jamieson Automation"} — Quote\n`+
    (who?`For: ${who}\n`:"")+
    "\n"+lines.join("\n")+(t.disc?`\nRecurring discount (20%): -${money(t.disc)}`:"")+`\n\nTotal: ${money(t.total)}`+
    (BIZ[S.biz].phone?`\n\n${BIZ[S.biz].phone}`:"");
  if(navigator.clipboard)navigator.clipboard.writeText(txt);
  alert("Quote copied — paste it into a text or email:\n\n"+txt);
};
window.printQuote=function(){
  const t=quoteFigures();const biz=S.biz;const isObx=biz==="obx";
  const brand=isObx?"#1B2A4E":"#002052";const acc=isObx?"#8BC34A":"#0099E5";
  const name=isObx?"OBX Lot Solutions":"Jamieson Automation";
  const phone=BIZ[biz].phone||"";
  const who=val("q_custfree")||(val("q_cust")?custName(val("q_cust")):"")||(CURQ&&CURQ.cust)||"";
  const rows=QITEMS.filter(it=>it.serviceId||it.name).map(it=>`<tr><td>${esc(it.name)}</td><td style="text-align:center">${it.qty||1}</td><td style="text-align:right">${money((it.price||0)*(it.qty||1))}</td></tr>`).join("");
  const nameHtml=name.replace(/ ([^ ]+)$/,' <span style="color:'+acc+'">$1</span>');
  // Logo on the PDF header: OBX logo base64-embedded so the printed quote is fully self-contained (works when Ray opens the app as a local file:// — a served URL would not resolve there).
  const OBX_LOGO="data:image/png;base64,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";
  const brandHtml=isObx?`<img src="${OBX_LOGO}" alt="${esc(name)}" style="height:48px;max-width:260px;object-fit:contain;background:#fff;border-radius:8px;padding:5px 10px">`:`<div class="n">${nameHtml}</div>`;
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Quote - ${esc(name)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;color:#1b2330;margin:0;padding:32px}
  .hd{background:${brand};color:#fff;padding:18px 22px;border-radius:10px;display:flex;justify-content:space-between;align-items:center}
  .hd .n{font-size:22px;font-weight:800}
  h2{margin:22px 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{padding:10px 8px;border-bottom:1px solid #e2e7ee;font-size:14px}
  th{text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase}
  .tot{margin-top:14px;text-align:right;font-size:22px;font-weight:800;color:${brand}}
  .disc{text-align:right;color:#6b7280;font-size:13px;margin-top:6px}
  .ft{margin-top:28px;color:#6b7280;font-size:12px}
  @media print{body{padding:6px}}</style></head>
  <body><div class="hd">${brandHtml}<div style="font-weight:700">${(CURQ&&CURQ.invoiced)?"INVOICE":"QUOTE"}</div></div>
  ${who?`<h2>Prepared for</h2><div>${esc(who)}${(CURQ&&CURQ.address)?"<br>"+esc(CURQ.address):""}</div>`:""}
  <h2>Services</h2><table><tr><th>Service</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th></tr>${rows}</table>
  ${t.disc?`<div class="disc">Discount: -${money(t.disc)}</div>`:""}
  <div class="tot">Total: ${money(t.total)}</div>
  <div class="ft">${esc(name)}${phone?" &middot; "+phone:""} &middot; ${new Date().toLocaleDateString()}</div>
  <script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script></body></html>`;
  const w=window.open("","_blank");if(!w){alert("Allow pop-ups for this page to print the quote.");return;}
  w.document.write(html);w.document.close();
};

