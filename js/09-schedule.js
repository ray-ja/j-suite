/* ---------- SCHEDULE ---------- */
/* MULTI-DAY jobs: a job can be worked on several NON-contiguous days. j.workDays[] holds every YYYY-MM-DD
   the job is worked; j.date stays the START/primary day. jobWorkDays(j) returns that set (deduped, with the
   start day always included), falling back to [j.date] for legacy/single-day jobs so nothing regresses. */
function jobWorkDays(j){
  if(!j)return [];
  const out=new Set();
  if(Array.isArray(j.workDays))j.workDays.forEach(d=>{if(d)out.add(d);});
  if(j.date)out.add(j.date);   // the start day is always a work day
  return [...out].sort();
}
/* true if the job is worked on the given YYYY-MM-DD (any of its work days) */
function jobOnDay(j,ds){return jobWorkDays(j).indexOf(ds)>=0;}
/* "open right now" — the filter for clock-in + sub-job-nest pickers so FINISHED one-off jobs drop off but the
   current/recurring/upcoming ones stay. Open = not done/deleted AND (a work day today-or-later, OR someone is
   actively clocked into it right now). A job whose whole scheduled run is in the past (e.g. a wrapped patio) is
   NOT open even if nobody remembered to tick "done". */
function jobIsOpenNow(j){
  if(!j||j.done||j.deleted)return false;
  // A nested STOP / sub-job (a materials pickup, a dump run) is never its OWN clock-in / nest target — you work its
  // PARENT job and the stop's miles/time roll up. It's excluded from every job LIST, so exclude it here too.
  if(j.stopKind||j.parentJobId||(Array.isArray(j.sharedJobIds)&&j.sharedJobIds.length))return false;
  const t=(typeof today==="function")?today():"";
  const wd=(typeof jobWorkDays==="function")?jobWorkDays(j):(j.date?[j.date]:[]);
  if(wd.some(d=>d>=t))return true;
  try{ if(((D().timeclock)||[]).some(e=>e&&!e.deleted&&e.jobId===j.id&&e.clockIn&&!e.clockOut))return true; }catch(e){}
  return false;
}
window.jobIsOpenNow=jobIsOpenNow;
let CALY=null,CALM=null,SCHEDSUB="calendar",SCHED_DATE=null,JOBCREW=new Set(),JSEARCH="";
let JOBWORKDAYS=[];   // live multi-day work-day set for the open job modal (mirrors JOBCREW)
/* Calendar view mode (month/week/day) + the single selected-date anchor that carries across switches.
   The mode is remembered per-device; the anchor defaults to today and follows ‹ › / Today + day taps. */
let CALVIEW=(function(){try{const v=localStorage.getItem("jra_calview");return (v==="week"||v==="day"||v==="month")?v:"month";}catch(e){return "month";}})();
let CAL_SEL=null;   // YYYY-MM-DD anchor; null until first render (set to today)
function calAnchor(){if(!CAL_SEL)CAL_SEL=today();return CAL_SEL;}
function calSetView(v){CALVIEW=v;try{localStorage.setItem("jra_calview",v);}catch(e){}}
/* keep CALY/CALM (used by the month grid) in step with the selected anchor */
function calSyncMonth(){const a=calAnchor();const d=new Date(a+"T00:00:00");CALY=d.getFullYear();CALM=d.getMonth();}
let JOBEQUIP=[],JOBEQUIP_JID=null;   // live required-equipment list for the open job modal (mirrors JOBCREW)
let JOBSTOPS=[];   // live ADMIN-PLANNED route stops for the open job modal — {id,label,address,lat,lng}, in order,
                    // materials pickups etc. BEFORE the job site (mirrors JOBCREW/JOBEQUIP). Distinct from the
                    // crew-added ad hoc timeclock stops[] (js/38) — this is set in advance by the owner/admin.
function rSchedule(){
  if(window.JOB_OPEN && typeof rJobPage==="function"){ const _j=(typeof actJ==="function")&&actJ().find(x=>x.id===window.JOB_OPEN&&!x.deleted); if(_j){ const _ids=["job_notes","jobcap_q","exp_amt","exp_vendor","exp_desc","mat_amt","mat_vendor","mat_desc","co_desc","co_amt","jt_crew","jt_onsite","jt_drivemin","jt_drivemiles","job_final","job_adjnote","job_paylink","job_title","jrm_miles"]; const _save=_ids.map(function(id){const el=document.getElementById(id);return el?{id:id,v:el.value,f:document.activeElement===el,s:el.selectionStart,e:el.selectionEnd}:null;}).filter(Boolean); view.innerHTML=rJobPage(_j); _save.forEach(function(o){const el=document.getElementById(o.id);if(el){el.value=o.v;if(o.f){el.focus();try{el.setSelectionRange(o.s,o.e);}catch(e){}}}}); return; } window.JOB_OPEN=null; }
  if(SCHEDSUB==="crew")SCHEDSUB="calendar";   // crew-availability tab retired (Ray's request)
  const sub=`<div class="subnav"><button class="subbtn ${SCHEDSUB==="calendar"?"on":""}" onclick="schedSub('calendar')">📅 Calendar</button><button class="subbtn ${SCHEDSUB==="myavail"?"on":""}" onclick="schedSub('myavail')">🗓 My shifts</button></div>`;
  if(SCHEDSUB==="myavail"){view.innerHTML=sub+(typeof renderMyAvailCalendar==="function"?renderMyAvailCalendar():"");return;}
  // Calendar = Month / Week / Day views over the same jobs. Tap a day (or job) to act on it.
  calSyncMonth();
  const jobs=actJ().slice().sort((a,b)=>(a.date+(a.time||""))<(b.date+(b.time||""))?-1:1);
  const toggle=`<div class="calviews">`
    +`<button class="calviewbtn ${CALVIEW==="month"?"on":""}" onclick="calSwitch('month')">Month</button>`
    +`<button class="calviewbtn ${CALVIEW==="week"?"on":""}" onclick="calSwitch('week')">Week</button>`
    +`<button class="calviewbtn ${CALVIEW==="day"?"on":""}" onclick="calSwitch('day')">Day</button></div>`;
  let body=CALVIEW==="week"?renderWeekView(jobs):CALVIEW==="day"?renderDayView(jobs):renderCalendar(jobs);
  let h=sub+toggle+calNavBar()+body;
  // crew-initials legend only matters for the month grid (the cells that draw chips)
  if(CALVIEW==="month"&&typeof schedMembers==="function"&&schedMembers().length)h+=`<div class="sub" style="margin:-2px 6px 10px;white-space:normal">Each day shows crew initials — <b style="color:var(--muted)">gray = not confirmed</b>, <b style="color:var(--accent)">green = available</b>, <b style="color:#e0a800">yellow = part-day</b>, <b style="color:var(--danger)">red = off</b>. Tap a day for the full picture.</div>`;
  view.innerHTML=h;
}
window.schedSub=function(s){SCHEDSUB=s;render();};
window.schedDate=function(v){SCHED_DATE=v;render();};
/* compact crew initials for a tight space (calendar cells) */
function userInitials(u){if(!u)return"?";var src=String(u.name||u.username||"").trim();var p=src.split(/\s+/).filter(Boolean);return ((p.length>1?(p[0][0]+p[p.length-1][0]):src.slice(0,2))||"?").toUpperCase();}
function crewInitials(ids){return (ids||[]).map(id=>{const u=(S.users||[]).find(x=>x.id===id);return u?userInitials(u):"";}).filter(Boolean).join(" ");}
/* true if any assigned crew member is off/time-off on the job's date */
function jobHasConflict(j){return (j.crew||[]).some(id=>{const u=(S.users||[]).find(x=>x.id===id);return u&&typeof isFree==="function"&&!isFree(u,j.date);});}
/* who's assigned to a job, with a conflict flag for anyone not free on the job's date */
function crewChips(j){const ids=j.crew||[];if(!ids.length)return `<span class="badge" style="background:var(--soft);color:var(--muted)">Unassigned</span>`;
  return ids.map(id=>{const u=(S.users||[]).find(x=>x.id===id);if(!u)return"";
    const free=(typeof isFree==="function")?isFree(u,j.date):true;
    const c=free?"background:var(--soft);color:var(--ink)":"background:var(--danger);color:#fff";
    return `<span class="badge" style="${c}" title="${free?"":"Not available on "+fmtDate(j.date)}">${esc(u.username)}${free?"":" ⚠"}</span>`;}).join(" ");}
/* Crew availability view — the job pipeline placed against who's free, with conflict flags */
function rCrewSchedule(){
  const ds=SCHED_DATE||today(),mem=(typeof schedMembers==="function")?schedMembers():[];
  let h=`<div class="card"><label>Pick a date</label><input type="date" value="${ds}" onchange="schedDate(this.value)">
    <div class="sub" style="margin-top:6px">${DOW[dowOf(ds)]} · ${fmtDate(ds)}</div></div>`;
  const dayJobs=actJ().filter(j=>jobOnDay(j,ds)).sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
  h+=`<div class="secthd"><h2>Jobs this day</h2><span class="ct">${dayJobs.length}</span></div>`;
  h+=dayJobs.length?`<div class="card">`+dayJobs.map(j=>`<div class="li"><div class="grow" onclick="openJobPage('${j.id}')" style="cursor:pointer"><div class="nm">${esc(j.title||"Job")}</div><div class="sub">${j.time?esc(j.time)+" · ":""}${j.customerId?esc(custName(j.customerId))+" · ":""}</div><div style="margin-top:4px">${crewChips(j)}</div></div></div>`).join("")+`</div>`
    :`<div class="card"><div class="muted">No jobs scheduled. <a href="#" onclick="closeModal();openJob(null,'','${ds}');return false" style="color:var(--brand-text);font-weight:700">Add one</a>.</div></div>`;
  h+=`<div class="secthd"><h2>Crew availability</h2><span class="ct">${mem.length}</span></div>`;
  if(!mem.length)h+=`<div class="card"><div class="muted">No team accounts yet — add them in Admin.</div></div>`;
  else h+=`<div class="card">`+mem.map(u=>{
    const a=availOn(u,ds),on=jobsForMemberOn(u.id,ds),off=(a.status==="off"||a.status==="timeoff");
    const canEdit=((typeof curUser==="function"&&curUser()&&curUser().id===u.id)||(typeof isOwner==="function"&&isOwner()));
    const flags=[on.length>1?`<span style="color:var(--danger)">⚠ double-booked</span>`:"",off&&on.length?`<span style="color:var(--danger)">⚠ assigned but off</span>`:""].filter(Boolean).join(" · ");
    return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)} ${availBadge(u,ds)}</div>
      <div class="sub">${esc(a.label)}${on.length?` · on ${on.length} job${on.length>1?"s":""}`:""}${flags?" · "+flags:""}</div></div>
      ${canEdit?`<button class="btn ghost sm" onclick="openAvailability('${u.id}')">Edit</button>`:""}</div>`;}).join("")+`</div>`;
  h+=`<div class="secthd"><h2>Next 7 days</h2></div><div class="card">`+[0,1,2,3,4,5,6].map(i=>{const d=addDays(today(),i);
    const jc=actJ().filter(j=>jobOnDay(j,d)).length,free=mem.filter(u=>isFree(u,d)).length;
    return `<div class="li" style="cursor:pointer" onclick="schedDate('${d}')"><div class="grow"><div class="nm" style="font-size:14px${d===ds?";color:var(--brand-text)":""}">${DOW[dowOf(d)]} ${fmtDate(d)}</div></div><div class="sub">${jc} job${jc!==1?"s":""} · ${free} free</div></div>`;}).join("")+`</div>`;
  return h;
}
/* inline crew-availability chips for a month-grid day cell — one tiny initial per member, colored
   by that day's status (available=accent · time-off=amber · off=danger), in stable member order so
   the same person sits in the same spot across days. Stays on one line (never grows the cell height);
   if the crew outgrows the row it overflows to a "+N" chip. Uses js/33 availability data. Tap the day
   for the fuller detail. Visible to every role. */
const CAL_CHIP_MAX=4;
function calDayChips(ds){
  const mem=(typeof schedMembers==="function")?schedMembers():[];
  if(!mem.length||typeof availOn!=="function")return"";
  const base="font-size:10px;font-weight:800;line-height:17px;height:17px;min-width:17px;padding:0 3px;border-radius:4px;text-align:center;flex:0 0 auto";
  const sty=st=>st==="off"?"background:var(--danger);color:#fff":st==="timeoff"?"background:#b26a00;color:#fff":st==="partial"?"background:#e0a800;color:#1a1a1a":st==="oncall"?"background:#2f6fed;color:#fff":st==="available"?"background:var(--accent);color:var(--accent-ink)":"background:var(--line);color:var(--muted)";
  const lbl=st=>st==="off"?"off":st==="timeoff"?"time off":st==="partial"?"part of day":st==="oncall"?"on call":st==="available"?"available":"not confirmed";
  const norm=s=>s==="off"?"off":s==="timeoff"?"timeoff":s==="partial"?"partial":s==="oncall"?"oncall":s==="on"?"available":"unknown";
  let chips=mem.slice(0,CAL_CHIP_MAX).map(u=>{const av=availOn(u,ds),st=norm(av.status),ini=userInitials(u);
    return `<span style="${base};${sty(st)}" title="${esc(u.name||u.username)} — ${esc(av.label||lbl(st))}">${esc(ini)}</span>`;}).join("");
  if(mem.length>CAL_CHIP_MAX)chips+=`<span style="${base};background:var(--soft);color:var(--muted)" title="${mem.length-CAL_CHIP_MAX} more — tap for all">+${mem.length-CAL_CHIP_MAX}</span>`;
  return `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:2px">${chips}</div>`;
}
/* shared ‹ Title › / Today nav bar — the title + step size follow the active view */
function calNavBar(){
  const a=calAnchor();let title="";
  if(CALVIEW==="month"){const f=new Date(CALY,CALM,1);title=f.toLocaleString(undefined,{month:"long"})+" "+CALY;}
  else if(CALVIEW==="week"){const ws=weekStart(a),we=addDays(ws,6);
    const sd=new Date(ws+"T00:00:00"),ed=new Date(we+"T00:00:00");
    const sm=sd.toLocaleString(undefined,{month:"short"}),em=ed.toLocaleString(undefined,{month:"short"});
    title=sm===em?`${sm} ${sd.getDate()}–${ed.getDate()}`:`${sm} ${sd.getDate()} – ${em} ${ed.getDate()}`;}
  else{const dd=new Date(a+"T00:00:00");title=DOW[dowOf(a)]+", "+dd.toLocaleString(undefined,{month:"short"})+" "+dd.getDate();}
  return `<div class="calhead"><button class="calnav" onclick="calShift(-1)">‹</button>
    <div class="mtitle">${esc(title)}</div><button class="calnav" onclick="calShift(1)">›</button>
    <button class="btn ghost sm" style="margin-left:auto" onclick="calToday()">Today</button></div>`;
}
/* Monday-free, Sunday-start week to match the month grid's Su…Sa columns */
function weekStart(ds){return addDays(ds,-dowOf(ds));}
function renderCalendar(jobs){
  const t=today();const byDate={};jobs.forEach(j=>{jobWorkDays(j).forEach(d=>{(byDate[d]=byDate[d]||[]).push(j);});});
  const first=new Date(CALY,CALM,1);const startDow=first.getDay();
  const dim=new Date(CALY,CALM+1,0).getDate();
  const dows=["Su","Mo","Tu","We","Th","Fr","Sa"];
  let cells=dows.map(d=>`<div class="caldow">${d}</div>`).join("");
  for(let i=0;i<startDow;i++)cells+=`<div class="calcell out"></div>`;
  for(let day=1;day<=dim;day++){
    const ds=CALY+"-"+String(CALM+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    const dj=byDate[ds]||[];
    let inner=`<div class="dnum">${day}</div>`+calDayChips(ds);
    dj.slice(0,2).forEach(j=>{const conf=jobHasConflict(j),ini=crewInitials(j.crew);
      inner+=`<div class="caljob" style="${j.done?'opacity:.5;text-decoration:line-through':''}${conf?';background:var(--danger)':''}" title="${esc(j.title||'Job')}${ini?' · '+esc(ini):''}${conf?' · crew unavailable':''}">${esc(j.title||'Job')}${ini?` <span style="opacity:.85;font-weight:700">${esc(ini)}</span>`:""}</div>`;});
    if(dj.length>2)inner+=`<div class="calmore">+${dj.length-2} more</div>`;
    cells+=`<div class="calcell${ds===t?' today':''}" onclick="openDay('${ds}')">${inner}</div>`;
  }
  return `<div class="calgrid">${cells}</div>`;
}
/* a job row for the Week/Day lists — time (if set), title, customer, crew chips; taps open the job */
function calJobRow(j){
  const ini=crewInitials(j.crew),conf=jobHasConflict(j);
  return `<div class="li" onclick="closeModal();openJobPage('${j.id}')" style="cursor:pointer">
    <div class="grow"><div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${j.time?`<span class="badge" style="background:var(--soft);color:var(--ink);margin-right:6px">${esc(j.time)}</span>`:""}${esc(j.title||"Job")}</div>
    <div class="sub">${j.customerId?esc(custName(j.customerId)):"No customer"}${ini?" · "+esc(ini):""}${conf?` <span style="color:var(--danger)">⚠ crew off</span>`:""}</div></div></div>`;
}
/* per-day availability line for the Week view — a "N free" count + the same crew chips the Month grid
   draws (calDayChips), so a member's availability SURFACES in Week too (was jobs-only → people on the
   persisted Week view saw zero availability even though the data was intact). Tap the day for the full
   per-member list. Open to every role, same as Month/Day. */
function weekDayAvail(ds){
  const mem=(typeof schedMembers==="function")?schedMembers():[];
  if(!mem.length||typeof availOn!=="function")return"";
  const cnt=(typeof teamAvailCounts==="function")?teamAvailCounts(ds):null;
  const chips=(typeof calDayChips==="function")?calDayChips(ds):"";
  const cntOff=cnt?(cnt.off+cnt.timeoff):0;
  const summary=cnt&&cnt.total
    ?`<span style="color:var(--accent);font-weight:700">${cnt.available} free</span>${cnt.partial?` · <span style="color:#b07d00;font-weight:700">${cnt.partial} part</span>`:""}${cntOff?` · <span style="color:var(--danger);font-weight:700">${cntOff} off</span>`:""}`
    :"";
  if(!summary&&!chips)return"";
  return `<div class="weekdayavail" onclick="openDay('${ds}')" title="Tap for the full availability list">${summary}${chips}</div>`;
}
/* Week view — the 7 days containing the anchor. Each day is a tappable header (its date → openDay)
   with a crew-availability line + its jobs stacked under it; a free day invites adding one. Mobile =
   stacked; wide = 7 columns. */
function renderWeekView(jobs){
  const t=today(),ws=weekStart(calAnchor());const byDate={};jobs.forEach(j=>{jobWorkDays(j).forEach(d=>{(byDate[d]=byDate[d]||[]).push(j);});});
  let cols="";
  for(let i=0;i<7;i++){const ds=addDays(ws,i),dj=(byDate[ds]||[]).slice().sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
    const isToday=ds===t,isSel=ds===calAnchor();
    const rows=dj.length?dj.map(calJobRow).join("")
      :`<div class="muted" style="padding:8px 4px;cursor:pointer" onclick="closeModal();openJob(null,'','${ds}')">No jobs — <span style="color:var(--brand-text);font-weight:700">add one</span>.</div>`;
    cols+=`<div class="weekday${isToday?" today":""}${isSel?" sel":""}">
      <div class="weekdayhd" onclick="openDay('${ds}')"><span class="wd-dow">${DOW[dowOf(ds)]}</span> <span class="wd-num">${ds.slice(8)}</span>${dj.length?`<span class="ct" style="margin-left:auto">${dj.length}</span>`:`<span class="wd-add" style="margin-left:auto" onclick="event.stopPropagation();closeModal();openJob(null,'','${ds}')">＋</span>`}</div>
      ${weekDayAvail(ds)}
      <div class="weekdayjobs">${rows}</div></div>`;
  }
  return `<div class="weekgrid">${cols}</div>`;
}
/* Day view — a single day's jobs in time order; an empty day invites adding one. Reuses the sanity
   + team-availability context that the month day-modal shows, so the Day view is the full picture. */
function renderDayView(jobs){
  const ds=calAnchor(),dj=jobs.filter(j=>jobOnDay(j,ds)).slice().sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
  let h=(typeof daySanityBanner==="function"?daySanityBanner(ds):"");
  h+=`<div class="secthd" style="margin-top:0"><h2>Jobs</h2><span class="ct">${dj.length}</span></div>`;
  h+=dj.length?`<div class="card">`+dj.map(calJobRow).join("")+`</div>`
    :`<div class="card"><div class="muted" style="padding:6px 2px">No jobs scheduled this day. <a href="#" onclick="closeModal();openJob(null,'','${ds}');return false" style="color:var(--brand-text);font-weight:700">Add one</a>.</div></div>`;
  const team=(typeof teamAvailListHTML==="function")?teamAvailListHTML(ds):"";
  if(team){const cnt=(typeof teamAvailCounts==="function")?teamAvailCounts(ds):null,cntOff=cnt?(cnt.off+cnt.timeoff):0;
    const hdr=(cnt&&cnt.total)?`<span style="color:var(--accent)">${cnt.available} free</span>${cntOff?`, <span style="color:var(--danger)">${cntOff} off</span>`:""}`:"";
    h+=`<div class="secthd"><h2>Team availability</h2><span class="ct" style="font-weight:700">${hdr}</span></div><div class="card">${team}</div>`;}
  h+=`<button class="btn acc" style="margin-top:8px" onclick="closeModal();openJob(null,'','${ds}')">Add job on this day</button>`;
  return h;
}
window.calSwitch=function(v){calSetView(v);render();};
window.calShift=function(n){
  if(CALVIEW==="month"){CALM+=n;if(CALM<0){CALM=11;CALY--;}if(CALM>11){CALM=0;CALY++;}
    /* keep the anchor inside the shown month so a Month→Week/Day switch lands there */
    const dim=new Date(CALY,CALM+1,0).getDate();const cur=new Date(calAnchor()+"T00:00:00").getDate();
    CAL_SEL=CALY+"-"+String(CALM+1).padStart(2,"0")+"-"+String(Math.min(cur,dim)).padStart(2,"0");}
  else CAL_SEL=addDays(calAnchor(),(CALVIEW==="week"?7:1)*n);
  render();};
window.calToday=function(){CAL_SEL=today();render();};
window.openDay=function(ds){
  CAL_SEL=ds;   // tapping a day moves the calendar anchor here, so a view switch stays centered on it
  const jobs=actJ().filter(j=>jobOnDay(j,ds)).sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
  const list=jobs.length?jobs.map(j=>`<div class="li"><div class="grow" onclick="closeModal();openJobPage('${j.id}')"><div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(j.title)}</div><div class="sub">${esc(j.time||"")}${j.customerId?" · "+esc(custName(j.customerId)):""}</div></div></div>`).join(""):`<div class="muted">No jobs this day.</div>`;
  const team=(typeof teamAvailListHTML==="function")?teamAvailListHTML(ds):"";
  const cnt=(typeof teamAvailCounts==="function")?teamAvailCounts(ds):null,cntOff=cnt?(cnt.off+cnt.timeoff):0;
  const hdr=(cnt&&cnt.total)?` · <span style="color:var(--accent)">${cnt.available} free</span>${cntOff?`, <span style="color:var(--danger)">${cntOff} off</span>`:""}`:"";
  const dow=(typeof DOW!=="undefined"&&typeof dowOf==="function")?(DOW[dowOf(ds)]+" · "):"";
  modal(dow+fmtDate(ds),`
    ${typeof daySanityBanner==="function"?daySanityBanner(ds):""}
    <div class="secthd" style="margin-top:0"><h2>Jobs</h2><span class="ct">${jobs.length}</span></div>
    <div class="card">${list}</div>
    ${team?`<div class="secthd"><h2>Team availability</h2><span class="ct" style="font-weight:700">${hdr?hdr.replace(/^ · /,""):""}</span></div><div class="card">${team}</div>`:""}
    <button class="btn acc" style="margin-top:6px" onclick="closeModal();openJob(null,'','${ds}')">Add job on this day</button>`);
};
/* compact required-equipment line for a job row — count + load progress (N/M loaded) + a needs-cleaning
   count + a clear flag if any item is over-committed on its date. Makes the load checklist reachable/obvious
   from Today + the schedule without opening the job. */
function jobEquipLine(j){
  const eq=(typeof jobEquip==="function")?jobEquip(j):[];if(!eq.length)return"";
  const n=eq.reduce((s,e)=>s+e.qty,0);
  const rawLines=(j.equipment||[]).filter(e=>e&&e.itemId);
  const loaded=rawLines.filter(e=>e.loaded).length;
  const prog=(!j.done&&rawLines.length)?` · <span style="font-weight:700${loaded===rawLines.length?";color:var(--accent)":""}">${loaded}/${rawLines.length} loaded</span>`:"";
  const dirty=eq.filter(e=>{const i=(typeof eqItemById==="function")?eqItemById(e.itemId):null;return i&&i.needsCleaning;}).length;
  const dc=dirty?` <span style="color:#b8860b;font-weight:700">🧽 ${dirty} to clean</span>`:"";
  const conf=j.done?0:eq.filter(e=>eqConflict(e.itemId,j.date,e.qty,j.id).conflict).length;
  const c=conf?` <span style="color:var(--danger);font-weight:700">⚠ ${conf} over-committed</span>`:"";
  return `<div class="sub" style="margin-top:2px">🧰 ${n} item${n>1?"s":""}${prog}${dc}${c}</div>`;
}
function liJob(j){
  const crew=(j.crew&&j.crew.length)?`<div style="margin-top:4px">${crewChips(j)}</div>`:"";
  const _ll=(typeof jobLatLng==="function")?jobLatLng(j):null,_drive=(_ll&&typeof driveBadge==="function")?driveBadge(_ll.lat,_ll.lng):"";
  return `<div class="li"><div class="grow" onclick="openJobPage('${j.id}')">
    <div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(j.title||"Job")} ${(typeof depBadgeHTML==="function")?depBadgeHTML(j):""}</div>
    <div class="sub">${fmtDate(j.date)}${j.time?" · "+j.time:""}${j.customerId?" · "+esc(custName(j.customerId)):""}${_drive?" · "+_drive:""}${(typeof jobPO==="function"&&jobPO(j))?" · 🧾 "+jobPO(j):""}</div>${crew}${jobEquipLine(j)}</div>
    <input type="checkbox" style="width:22px;height:22px" ${j.done?"checked":""} onchange="toggleJob('${j.id}')"></div>`;
}
window.openJob=function(id,customerId,presetDate){
  const d=D();const j=id?d.jobs.find(x=>x.id===id):{id:uid(),date:presetDate||today(),customerId:customerId||""};
  const isNew=!id;
  JOBCREW=new Set(j.crew||[]);   // live assignment set for this modal
  JOBWORKDAYS=jobWorkDays(j);     // live multi-day work-day set (start day always included)
  JOBWDAY_ANCHOR=(JOBWORKDAYS[0]||j.date||today());   // which month the mini-picker shows
  JOBEQUIP=(typeof jobEquip==="function")?jobEquip(j):[];JOBEQUIP_JID=j.id;   // live required-equipment list for this modal
  JOBSTOPS=(Array.isArray(j.plannedStops)?j.plannedStops:[]).map(s=>({id:s.id||uid(),label:s.label||"",address:s.address||"",lat:s.lat!=null?s.lat:null,lng:s.lng!=null?s.lng:null,placeId:s.placeId||null}));   // live planned-route list for this modal (placeId carries a saved-place ref for the mileage-estimate override)
  const opts=`<option value="">— none —</option>`+actC().map(c=>`<option value="${c.id}" ${j.customerId===c.id?"selected":""}>${esc(c.name||c.company)}</option>`).join("");
  const svcopts=`<option value="">— optional —</option>`+cat().map(s=>`<option ${j.title===s.name?"selected":""}>${s.name}</option>`).join("");
  /* crew-on-phone: tap-to-call/text the customer + one-tap Directions to the job (best address: property → job → customer) */
  const _c=j.customerId?d.customers.find(x=>x.id===j.customerId):null;
  const _tel=((_c&&_c.phone)||"").replace(/[^0-9+]/g,"");
  const _p=(j.propertyId&&typeof actProps==="function")?actProps().find(p=>p.id===j.propertyId):null;
  const _addr=(_p&&_p.address)||j.address||(_c&&_c.address)||(_c&&typeof propsForCust==="function"&&(propsForCust(_c.id)[0]||{}).address)||"";
  const _contact=(!isNew&&(_tel||_addr))?`<div class="row" style="gap:8px;margin:0 0 12px">${_tel?`<a class="btn ghost sm grow" href="tel:${_tel}" style="text-align:center">📞 Call</a><a class="btn ghost sm grow" href="sms:${_tel}" style="text-align:center">💬 Text</a>`:""}${_addr?`<a class="btn ghost sm grow" href="https://maps.google.com/?q=${encodeURIComponent(_addr)}" target="_blank" rel="noopener" style="text-align:center">🗺️ Directions</a>`:""}</div>`:"";
  modal(isNew?"Schedule job":"Job",`${_contact}
    <label>Job / service</label><input id="j_title" value="${esc(j.title||"")}" placeholder="e.g. Power wash — driveway">
    <label>Or pick from services</label><select id="j_svc" onchange="if(this.value)document.getElementById('j_title').value=this.value">${svcopts}</select>
    <label>Customer</label><select id="j_cust">${opts}</select>
    <label>Property (for the job route map)</label><select id="j_prop"><option value="">— none —</option>${actProps().map(p=>`<option value="${p.id}" ${j.propertyId===p.id?"selected":""}>${esc(p.label||p.address||"Property")}${p.lat==null?" (no location)":""}</option>`).join("")}</select>
    ${(typeof isOwner==="function"&&isOwner())?`<label style="margin-top:12px">🧭 Planned route <span class="sub" style="font-weight:400">· the ordered stops — e.g. a materials supplier</span></label>
    <div id="j_stops"></div>
    <div class="sub muted" style="margin-top:4px;white-space:normal">The job-site position in the route is set on the job page.</div>`:""}
    <div class="row" style="gap:8px"><div class="grow"><label>Start date</label><input id="j_date" type="date" value="${j.date||today()}" onchange="jobStartDateChanged()"></div>
    <div class="grow"><label>Time</label><input id="j_time" type="time" value="${j.time||""}"></div></div>
    <label style="margin-top:6px">Work days <span class="sub" style="font-weight:400">· tap every day you'll work this job (can skip days)</span></label>
    <div id="j_workdays"></div>
    <label>Assign crew</label>
    <div id="j_crew"></div>
    <div class="sub" id="j_crew_note" style="margin-top:6px"></div>
    <label style="margin-top:12px">Required equipment</label>
    <div id="j_equip"></div>
    <div class="sub" id="j_equip_note" style="margin-top:6px"></div>
    ${!isNew?`<label style="margin-top:12px">Job expenses — hard cost (no labor line)</label><div id="j_exp"></div>`:""}
    ${!isNew?`<label style="margin-top:12px">Resale (items pulled to flip)</label><div id="j_resale"></div>`:""}
    <label style="margin-top:12px">Notes</label><textarea id="j_notes">${esc(j.notes||"")}</textarea>
    <button class="btn acc" style="margin-top:14px" onclick="saveJob('${j.id}',${isNew})">Save</button>
    ${!isNew?`<button class="btn danger" style="margin-top:10px" onclick="delJob('${j.id}')">Delete job</button>`:""}
  `);
  renderJobCrew();renderJobEquip();renderJobWorkDays();renderJobStops();if(!isNew){renderJobExpenses(j.id);renderJobResale(j.id);}
  if(typeof lockGuard==="function")lockGuard("job",isNew?null:j.id,()=>openJob(id));
};
/* ===== ADMIN-PLANNED job stops (route) — the owner/admin sets an ORDERED list of stops the job needs
   BEFORE the job site (e.g. "Stoneworks — pick up base", then "Lowe's — sand", then the job). This is what
   the crew sees on the job page as clearly-labeled, correct map links (js/61 rJobPage) instead of guessing
   between generic "Google Maps" links that only ever pointed at the job site. Distinct from the crew-added
   ad hoc timeclock stops[] (js/38 tcAddStop) which log where the crew ACTUALLY went, after the fact. */
function renderJobStops(){
  const box=document.getElementById("j_stops");if(!box)return;   // hidden for non-owners — nothing to render
  const rows=JOBSTOPS.map((s,i)=>`<div class="li" style="align-items:center;padding:6px 0">
    <div class="grow"><div class="nm" style="font-size:14px">${i+1}. ${esc(s.label||s.address||"Stop")}</div>${s.label&&s.address?`<div class="sub" style="white-space:normal">${esc(s.address)}</div>`:""}</div>
    <div class="row" style="gap:4px;flex:0 0 auto">
      <button type="button" class="btn ghost sm" ${i===0?"disabled":""} onclick="jobStopMove(${i},-1)" title="Move up">▲</button>
      <button type="button" class="btn ghost sm" ${i===JOBSTOPS.length-1?"disabled":""} onclick="jobStopMove(${i},1)" title="Move down">▼</button>
      <button type="button" class="btn ghost sm" onclick="jobStopDel(${i})" title="Remove">✕</button>
    </div></div>`).join("");
  box.innerHTML=(rows||`<div class="muted" style="margin-bottom:6px">No planned stops — the crew gets a direct link to the job site only.</div>`)
    +`<div class="row" style="gap:8px;margin-top:8px"><input id="jstop_label" placeholder="Label — e.g. Stoneworks: pick up base" style="flex:1 1 160px"><div class="acwrap" style="flex:1 1 160px"><input id="jstop_addr" placeholder="Address" oninput="addrSuggest('jstop_addr','jstop_addr_ac')" autocomplete="off" style="width:100%"><div class="acbox" id="jstop_addr_ac"></div></div></div>
      <button type="button" class="btn ghost sm" style="margin-top:6px;width:100%" onclick="jobStopAdd()">+ Add stop</button>
      <div class="sub" style="margin-top:4px;white-space:normal">Then the job site itself, automatically, last. Order matters — the crew's "Full route" link follows this list top to bottom.</div>`;
}
window.jobStopAdd=function(){
  const label=(val("jstop_label")||"").trim();
  const address=(val("jstop_addr")||"").trim();
  if(!address){alert("Enter the stop's address.");return;}
  const s={id:uid(),label:label||address,address:address,lat:null,lng:null};
  // saved-location pre-read (js/69 pattern): a PICKED suggestion carries exact coords + optional placeId → reuse
  // them + SKIP the OSM geocode (re-geocoding typed text is what landed Lowe's 400mi off).
  const _si=(typeof document!=="undefined")?document.getElementById("jstop_addr"):null; let _picked=false;
  if(_si&&_si.dataset&&_si.dataset.pickLat){ s.lat=+_si.dataset.pickLat; s.lng=+_si.dataset.pickLng; if(_si.dataset.pickPlaceId)s.placeId=_si.dataset.pickPlaceId; _picked=true;
    delete _si.dataset.pickLat;delete _si.dataset.pickLng;delete _si.dataset.pickPlaceId;delete _si.dataset.pickPropId;delete _si.dataset.pickManualMiles; }
  JOBSTOPS.push(s);
  if(!_picked&&typeof jobStopGeocode==="function")jobStopGeocode(s);   // best-effort, non-blocking — the map link uses the address text either way
  renderJobStops();
};
window.jobStopMove=function(i,dir){
  const j2=i+dir;if(j2<0||j2>=JOBSTOPS.length)return;
  const tmp=JOBSTOPS[i];JOBSTOPS[i]=JOBSTOPS[j2];JOBSTOPS[j2]=tmp;
  renderJobStops();
};
window.jobStopDel=function(i){
  if(i<0||i>=JOBSTOPS.length)return;
  JOBSTOPS.splice(i,1);
  renderJobStops();
};
/* best-effort geocode (same free OSM Nominatim path as js/62 hbGeocode) — fills lat/lng in the background so a
   future drive-estimate can use them; the Google Maps links themselves work off the address text regardless,
   so a slow/failed lookup never blocks anything. */
function jobStopGeocode(s,cb){   // cb (optional): called after coords land, so a persist-on-resolve caller (js/61's on-job-page editor) can save + recompute the mileage estimate; the modal passes no cb (saveJob persists JOBSTOPS later)
  if(!s||!s.address||typeof fetch!=="function")return;
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+encodeURIComponent(s.address))
    .then(r=>r.json()).then(g=>{if(g&&g[0]){s.lat=+g[0].lat;s.lng=+g[0].lon;if(typeof cb==="function")cb();}}).catch(function(){});
}
window.jobStopGeocode=jobStopGeocode;   // shared with js/61's on-job-page stop editor — ONE OSM Nominatim path, so the two stop editors can't drift
/* ---- multi-day work-day picker — a tap-on/off mini month grid, mobile-first. Tapping a day toggles it in
   JOBWORKDAYS (non-contiguous OK). The START date (j_date) is always included and can't be turned off here
   (change it in the Start date field). ‹ › step the shown month. Selected days show below as removable chips. */
let JOBWDAY_ANCHOR=null;
/* ---- SHARED work-day-picker HTML builders (factored out of renderJobWorkDays so the full-editor picker
   AND the crew job-page picker draw the exact same grid + chips — they can't visually drift). Behaviour-
   preserving extraction only: pass the selected-day set, the (un-removable) start day, the anchor month,
   and the name of the toggle handler to wire each day/✕ to (jobToggleWorkDay in the editor; a job-page
   equivalent on the crew page). Output is byte-identical to the old inline code for the editor call. */
function wdpkGridHtml(sel,start,y,m,toggleFn){
  const first=new Date(y,m,1),startDow=first.getDay(),dim=new Date(y,m+1,0).getDate();
  const dows=["Su","Mo","Tu","We","Th","Fr","Sa"];
  let cells=dows.map(d=>`<div class="wdpk-dow">${d}</div>`).join("");
  for(let i=0;i<startDow;i++)cells+=`<div class="wdpk-cell out"></div>`;
  const t=today();
  for(let day=1;day<=dim;day++){
    const ds=y+"-"+String(m+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    const on=sel.has(ds),isStart=ds===start;
    const cls="wdpk-cell"+(on?" on":"")+(isStart?" start":"")+(ds===t?" today":"");
    cells+=`<div class="${cls}" onclick="${toggleFn}('${ds}')" title="${isStart?'Start day (change above)':on?'Working — tap to remove':'Tap to add'}">${day}</div>`;
  }
  return cells;
}
function wdpkChipsHtml(days,start,toggleFn){
  return days.slice().sort().map(ds=>{
    const isStart=ds===start;
    return `<span class="wdpk-chip${isStart?" start":""}">${esc(fmtDate(ds))}${isStart?"":` <span onclick="${toggleFn}('${ds}')" style="cursor:pointer;font-weight:800">✕</span>`}</span>`;
  }).join("");
}
function renderJobWorkDays(){
  const box=document.getElementById("j_workdays");if(!box)return;
  const start=val("j_date")||today();
  if(JOBWORKDAYS.indexOf(start)<0)JOBWORKDAYS.push(start);   // start day is always a work day
  if(!JOBWDAY_ANCHOR)JOBWDAY_ANCHOR=start;
  const sel=new Set(JOBWORKDAYS);
  const anc=new Date((JOBWDAY_ANCHOR||start)+"T00:00:00"),y=anc.getFullYear(),m=anc.getMonth();
  const first=new Date(y,m,1);
  const title=first.toLocaleString(undefined,{month:"long"})+" "+y;
  const cells=wdpkGridHtml(sel,start,y,m,"jobToggleWorkDay");
  const chips=wdpkChipsHtml(JOBWORKDAYS,start,"jobToggleWorkDay");
  box.innerHTML=`<div class="wdpk">
    <div class="wdpk-head"><button type="button" class="calnav" onclick="jobWorkDayMonth(-1)">‹</button><div class="wdpk-title">${esc(title)}</div><button type="button" class="calnav" onclick="jobWorkDayMonth(1)">›</button></div>
    <div class="wdpk-grid">${cells}</div>
    <div class="wdpk-chips">${chips}</div>
    <div class="sub" style="margin-top:4px">${JOBWORKDAYS.length>1?`Worked across <b>${JOBWORKDAYS.length} days</b> — shows on each on the schedule.`:"Single day. Tap more days above for a multi-day job."}</div></div>`;
}
window.jobToggleWorkDay=function(ds){
  const start=val("j_date")||today();
  if(ds===start)return;   // can't remove the start day here
  const i=JOBWORKDAYS.indexOf(ds);
  if(i>=0)JOBWORKDAYS.splice(i,1);else JOBWORKDAYS.push(ds);
  renderJobWorkDays();
};
window.jobWorkDayMonth=function(n){
  const a=new Date((JOBWDAY_ANCHOR||val("j_date")||today())+"T00:00:00");
  a.setDate(1);a.setMonth(a.getMonth()+n);
  JOBWDAY_ANCHOR=a.getFullYear()+"-"+String(a.getMonth()+1).padStart(2,"0")+"-01";
  renderJobWorkDays();
};
/* start date changed → keep it in the work-day set (drop the old start if it was only there as the start),
   re-anchor the picker to the new month, and refresh crew/equipment availability for the new date */
window.jobStartDateChanged=function(){
  const start=val("j_date")||today();
  if(JOBWORKDAYS.indexOf(start)<0)JOBWORKDAYS.push(start);
  JOBWDAY_ANCHOR=start;
  renderJobWorkDays();renderJobCrew();renderJobEquip();
};
/* ---- per-job expenses (hard cost; Cap #3). Writes straight to job.expenses[] (rides job LWW) so a
   crew member logging a cost in the field persists immediately. Categories per the cost model —
   NO labor line, ever. Mileage enters miles → auto-costed at the IRS rate. ---- */
let JOBEXP_CAT="materials";
const JOBEXP_CATS=[["disposal","🗑 Disposal"],["mileage","🚗 Mileage"],["materials","🧴 Materials"],["equipment","🔧 Equipment rental"],["misc","• Misc"]];
function jobExpenses(j){return (typeof plExpenses==="function")?plExpenses(j):(Array.isArray(j&&j.expenses)?j.expenses:[]);}
function expCatLabel(k){const c=JOBEXP_CATS.find(x=>x[0]===k);return c?c[1]:(k||"Misc");}
function expFmt(n){n=Math.round((+n||0)*100)/100;return "$"+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
function renderJobExpenses(jobId){
  const box=document.getElementById("j_exp");if(!box)return;
  const j=D().jobs.find(x=>x.id===jobId);if(!j)return;
  const list=jobExpenses(j),isMi=JOBEXP_CAT==="mileage";
  const rows=list.map(e=>`<div class="li" style="align-items:center"><div class="grow"><div class="nm" style="font-size:15px">${esc(expCatLabel(e.cat))} · ${expFmt(e.amount)}${e.cat==="mileage"&&e.miles?` <span class="sub">(${e.miles} mi)</span>`:""}</div>${e.note?`<div class="sub" style="white-space:normal">${esc(e.note)}</div>`:""}</div><button class="btn ghost sm" style="flex:0 0 auto" onclick="expJobDel('${jobId}','${e.id}')" title="Remove">✕</button></div>`).join("");
  const adder=`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
    <select id="exp_cat" onchange="JOBEXP_CAT=this.value;renderJobExpenses('${jobId}')" style="flex:1 1 130px">${JOBEXP_CATS.map(c=>`<option value="${c[0]}" ${JOBEXP_CAT===c[0]?"selected":""}>${c[1]}</option>`).join("")}</select>
    ${isMi?`<input id="exp_miles" type="number" min="0" step="0.1" inputmode="decimal" placeholder="miles" style="flex:0 0 90px;padding:8px">`:`<input id="exp_amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="$ amount" style="flex:0 0 110px;padding:8px">`}
    <input id="exp_note" placeholder="note (optional)" style="flex:1 1 130px;padding:8px">
    <button class="btn acc sm" style="flex:0 0 auto" onclick="expJobAdd('${jobId}')">+ Add</button></div>
    ${isMi?`<div class="sub" style="margin-top:4px">Mileage auto-costs at ${MILEAGE_RATE_LABEL}/mi (IRS).</div>`:""}`;
  box.innerHTML=(rows||`<div class="muted">No expenses logged.</div>`)+adder
    +(list.length?`<div class="row" style="justify-content:space-between;margin-top:8px;font-weight:700"><span>Hard cost</span><span>${expFmt(list.reduce((s,e)=>s+(+e.amount||0),0))}</span></div>`:"");
}
window.expJobAdd=function(jobId){
  const j=D().jobs.find(x=>x.id===jobId);if(!j)return;
  let amount=0,miles=null;
  if(JOBEXP_CAT==="mileage"){miles=Math.max(0,+val("exp_miles")||0);if(!miles){alert("Enter the miles driven.");return;}amount=Math.round(miles*MILEAGE_RATE*100)/100;}
  else{amount=Math.round((Math.max(0,+val("exp_amt")||0))*100)/100;if(!amount){alert("Enter an amount.");return;}}
  const e={id:"ex_"+uid(),cat:JOBEXP_CAT,amount:amount,note:val("exp_note")||"",addedAt:now(),addedBy:((typeof curUser==="function"&&curUser())?curUser().id:null)};
  if(miles!=null)e.miles=miles;
  jobLIAdd("jobexp",jobId,e);   // → jobExpenses collection (element-level LWW), not the nested array
  if(typeof logChange==="function")logChange("update","job",jobId,"Expense +"+expFmt(amount)+" ("+JOBEXP_CAT+") · "+(j.title||"job"));
  save();renderJobExpenses(jobId);
};
window.expJobDel=function(jobId,exId){
  const j=D().jobs.find(x=>x.id===jobId);if(!j)return;
  const e=jobLIFind(j,"jobexp",exId);if(e){e.deleted=true;if(typeof touch==="function")touch(e);}   // TOMBSTONE (was a hard array-filter that never propagated the delete via sync)
  save();renderJobExpenses(jobId);
};
/* required-equipment picker — quantity-aware, with live conflict flags for the chosen date.
   Reads the master inventory (js/31) and the date the owner is placing the job against, then asks
   the shared engine (js/36) whether attaching would exceed what Ray owns across overlapping jobs. */
function renderJobEquip(){
  const box=document.getElementById("j_equip");if(!box)return;
  const ds=val("j_date")||today();
  const inv=(typeof actInv==="function")?actInv():[];
  if(!inv.length){box.innerHTML=`<div class="muted">No inventory yet — add gear in the Inventory tab to require it here.</div>`;}
  else{
    const rows=JOBEQUIP.map(e=>{
      const i=eqItemById(e.itemId);if(!i)return"";
      const r=eqConflict(e.itemId,ds,e.qty,JOBEQUIP_JID);
      const info=r.conflict
        ?`<div class="sub" style="color:var(--danger);white-space:normal">⚠ ${esc(eqConflictMsg(r))}</div>`
        :`<div class="sub">${r.owned} owned · ${r.committedOther} committed elsewhere on ${fmtDate(ds)}</div>`;
      return `<div class="li" style="align-items:flex-start${r.conflict?";background:var(--danger-soft);border-radius:8px":""}">
        <div class="grow"><div class="nm">${esc(i.name)}${invCatBadge(i.cat)}</div>${info}</div>
        <input type="number" min="1" value="${e.qty}" style="width:54px;text-align:center;padding:6px;flex:0 0 auto" onchange="eqJobSetQty('${e.itemId}',this.value)" onclick="event.stopPropagation()">
        <button class="btn ghost sm" style="flex:0 0 auto" onclick="eqJobDetach('${e.itemId}')" title="Remove">✕</button></div>`;
    }).join("");
    const attached=new Set(JOBEQUIP.map(e=>e.itemId));
    const opts=`<option value="">+ Add required equipment…</option>`+inv.filter(i=>!attached.has(i.id))
      .slice().sort((a,b)=>(a.name||"")<(b.name||"")?-1:1)
      .map(i=>`<option value="${i.id}">${esc(i.name)} ${eqOwnedQty(i)?"("+eqOwnedQty(i)+" owned)":"(not owned)"}</option>`).join("");
    box.innerHTML=(rows||`<div class="muted">No equipment required.</div>`)
      +`<select style="margin-top:8px" onchange="eqJobAttach(this.value);this.value=''">${opts}</select>`;
  }
  const note=document.getElementById("j_equip_note");
  if(note){
    const conf=JOBEQUIP.map(e=>eqConflict(e.itemId,ds,e.qty,JOBEQUIP_JID)).filter(r=>r.conflict);
    note.innerHTML=conf.length
      ?`<span style="color:var(--danger)">⚠ ${conf.length} equipment conflict${conf.length>1?"s":""} on ${fmtDate(ds)} — rent, buy, or reschedule.</span>`
      :(JOBEQUIP.length?`All required equipment is available on ${fmtDate(ds)}.`:"");
  }
}
window.eqJobAttach=function(id){if(!id)return;if(!JOBEQUIP.some(e=>e.itemId===id))JOBEQUIP.push({itemId:id,qty:1});renderJobEquip();};
window.eqJobDetach=function(id){JOBEQUIP=JOBEQUIP.filter(e=>e.itemId!==id);renderJobEquip();};
window.eqJobSetQty=function(id,v){const e=JOBEQUIP.find(x=>x.itemId===id);if(e)e.qty=Math.max(1,parseInt(v,10)||1);renderJobEquip();};
/* crew picker — reflects availability for the currently-selected date and flags conflicts;
   the note line directly answers "who's available [date]" as the owner places the job */
function renderJobCrew(){
  const box=document.getElementById("j_crew");if(!box)return;
  const ds=val("j_date")||today(),mem=(typeof schedMembers==="function")?schedMembers():[];
  if(!mem.length){box.innerHTML=`<div class="muted">No team accounts to assign — add them in Admin.</div>`;}
  else box.innerHTML=mem.map(u=>{
    const on=JOBCREW.has(u.id),a=availOn(u,ds),conflict=on&&(a.status==="off"||a.status==="timeoff");
    return `<label class="li" style="cursor:pointer"><input type="checkbox" style="width:20px;height:20px;flex:0 0 auto" ${on?"checked":""} onchange="toggleJobCrew('${u.id}')">
      <div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)}</div><div class="sub">${esc(a.label)}${conflict?` <span style="color:var(--danger)">⚠ not available</span>`:""}</div></div>
      ${availBadge(u,ds)}</label>`;}).join("");
  const note=document.getElementById("j_crew_note");
  if(note){const free=mem.filter(u=>isFree(u,ds)).map(u=>u.username);
    note.innerHTML=mem.length?(free.length?`Free on ${fmtDate(ds)}: <b>${free.map(esc).join(", ")}</b>`:`No one is marked available on ${fmtDate(ds)}.`):"";}
}
window.toggleJobCrew=function(id){if(JOBCREW.has(id))JOBCREW.delete(id);else JOBCREW.add(id);renderJobCrew();};
window.saveJob=function(id,isNew){
  const d=D();let j=isNew?{id}:d.jobs.find(x=>x.id===id);
  j.title=val("j_title");j.customerId=val("j_cust");j.propertyId=val("j_prop");j.date=val("j_date");j.time=val("j_time");j.notes=val("j_notes");
  j.crew=[...JOBCREW];
  // MULTI-DAY: persist the picked work days (deduped, start day always in, sorted). Single-day jobs store [date].
  {const wd=new Set(JOBWORKDAYS);if(j.date)wd.add(j.date);j.workDays=[...wd].filter(Boolean).sort();}
  j.equipment=JOBEQUIP.map(e=>({itemId:e.itemId,qty:e.qty}));
  const _prevStopCount=Array.isArray(j.plannedStops)?j.plannedStops.length:0;   // for the movable-job-site drift guard below
  j.plannedStops=JOBSTOPS.map(s=>{const o={id:s.id,label:s.label,address:s.address,lat:s.lat!=null?s.lat:null,lng:s.lng!=null?s.lng:null};if(s.placeId)o.placeId=s.placeId;return o;});   // admin-planned route (js/61 renders these as labeled links); untouched (echoed back) when the editor is hidden for non-owners. placeId (optional) carries a saved-place ref for the mileage-estimate override
  // MOVABLE-JOB-SITE drift guard: this modal edits stops ONLY (the job-site position lives on the job page, js/61
  // jobPageRouteMove → j.sitePos). If the stop COUNT changed here, a stored non-null j.sitePos may now point at the
  // wrong slot → reset to null (site back to LAST = today's default). jobRouteOrdered also clamp-reads as a backstop.
  if(typeof j.sitePos==="number"&&j.plannedStops.length!==_prevStopCount)j.sitePos=null;
  if(!j.title){alert("Give the job a name.");return;}
  if(typeof submitGuard==="function"&&!submitGuard("saveJob:"+id))return;   // rapid-tap dupe guard
  if(isNew)j.done=false;if(typeof jobEnsurePO==="function")jobEnsurePO(j);touch(j);if(isNew)d.jobs.push(j);
  if(typeof logChange==="function")logChange(isNew?"create":"update","job",j.id,(isNew?"Scheduled ":"Updated ")+(j.title||"job")+(j.date?" · "+fmtDate(j.date):""));
  save();closeModal();render();
};
window.toggleJob=function(id){const j=D().jobs.find(x=>x.id===id);j.done=!j.done;
  if(j.done){j.completedAt=now();j.completedBy=((typeof curUser==="function"&&curUser())?curUser().id:null);
    if(typeof invAutoFlagCleaningForJob==="function")invAutoFlagCleaningForJob(j);  /* CLEANING (Phase 4): flag dirties-with-use gear for cleaning on wrap (idempotent; reopen doesn't clear) */
  }else{j.completedAt=null;j.completedBy=null;}  /* ops-brain capture: stamp completion time + who */
  if(typeof logChange==="function")logChange("update","job",id,(j.done?"Completed ":"Reopened ")+(j.title||"job"));touch(j);save();render();};   /* review prompt moved to the INVOICED moment (js/23 wizToggleInvoiced + js/46 invMark) per Ray — ask once you're billing, not at job-done */
window.delJob=function(id){if(!confirm("Delete this job? It (and its quote) go to the Archive for 60 days — restore it there if needed."))return;
  const j=D().jobs.find(x=>x.id===id); const ttl=(j&&j.title)||"job";
  if(typeof archiveDeleteJob==="function")archiveDeleteJob(id); else if(j){j.deleted=true;j.deletedAt=now();touch(j);}   // cascade: job + sub-jobs + originating quote
  if(typeof logChange==="function")logChange("delete","job",id,"Deleted "+ttl);save();
  closeModal();
  // If we deleted the job FROM its open job page, return to where the user opened it from (Receipts, Jobs, Today…),
  // not the Schedule host tab. jobPageBack clears JOB_OPEN + restores the recorded origin (JOB_RETURN_TAB). Deleting
  // from the schedule-list editor modal (no job page open) just re-renders the current tab.
  if(window.JOB_OPEN===id && typeof jobPageBack==="function"){ jobPageBack(); }
  else render();};

/* ===== Quote → Job: accept a quote with a date/time, creating a scheduled job =====
   Reachable from the quote flow (wizard). Reuses the crew picker (j_date/j_crew ids + JOBCREW)
   so picking the job date shows who's free/off that day. The job carries customer, address,
   crew, date/time + a quoteId link back; the quote is marked accepted + linked to the job. */
function quoteJobTitle(q){const it=(q.items||[]).filter(x=>x&&x.name);if(it.length)return it[0].name+(it.length>1?` (+${it.length-1} more)`:"");return q.cust?("Job — "+q.cust):"Scheduled job";}
window.openAcceptSchedule=function(quoteId){
  if(typeof wizLockedAlert==="function"&&wizLockedAlert())return;     // read-only viewer can't convert
  if(typeof WZON!=="undefined"&&WZON&&WZ&&WZ.id===quoteId&&typeof wizPersist==="function")wizPersist();  // flush pending edits
  const d=D();const q=d.quotes.find(x=>x.id===quoteId);if(!q){alert("Save the quote first.");return;}
  const linked=q.jobId?d.jobs.find(j=>j.id===q.jobId&&!j.deleted):null;
  JOBCREW=new Set((linked&&linked.crew)||[]);
  const presetDate=(linked&&linked.date)||q.acceptedDate||today(),presetTime=(linked&&linked.time)||"";
  modal((linked?"Reschedule job":"Accept & schedule")+" — "+esc(q.cust||"quote"),`
    <div class="card" style="padding:10px"><div class="nm" style="font-size:15px">${esc(q.cust||"Customer")}</div><div class="sub" style="white-space:normal">${esc(q.address||"no address on quote")}</div><div class="sub">${money(q.total||0)} · ${(q.items||[]).length} item(s)</div></div>
    <div class="row" style="gap:8px"><div class="grow"><label>Job date</label><input id="j_date" type="date" value="${presetDate}" onchange="renderJobCrew()"></div>
    <div class="grow"><label>Time</label><input id="j_time" type="time" value="${esc(presetTime)}"></div></div>
    <label>Assign crew — free/off shown for the chosen date</label>
    <div id="j_crew"></div>
    <div class="sub" id="j_crew_note" style="margin-top:6px"></div>
    <button class="btn acc" style="margin-top:14px" onclick="acceptQuoteToJob('${quoteId}')">${linked?"Update scheduled job":"Create scheduled job"} →</button>`);
  renderJobCrew();
};
window.acceptQuoteToJob=function(quoteId){
  const d=D();const q=d.quotes.find(x=>x.id===quoteId);if(!q)return;
  const date=val("j_date")||today(),time=val("j_time");
  let job=q.jobId?d.jobs.find(j=>j.id===q.jobId):null;const isNew=!job;
  if(!job){job={id:uid(),done:false};d.jobs.push(job);}
  if(!job.title)job.title=quoteJobTitle(q);
  job.customerId=q.customerId||job.customerId||"";job.propertyId=q.propertyId||job.propertyId||"";
  job.address=q.address||job.address||"";job.crew=[...JOBCREW];job.date=date;job.time=time;job.quoteId=q.id;
  job.estHours=+q.hours||0;job.estCrew=Math.max(1,+q.crewN||1);   // carry the quote's time estimate so we can compare est-vs-actual at the job
  if(typeof jobEnsurePO==="function")jobEnsurePO(job);
  touch(job);
  q.accepted=true;q.jobId=job.id;q.acceptedDate=date;touch(q);
  if(typeof WZ!=="undefined"&&WZ&&WZ.id===q.id){WZ.accepted=true;WZ.jobId=job.id;WZ.acceptedDate=date;}
  // auto-create / update a "Materials pickup" SUB-JOB from the pickup line — assignable to a different person,
  // its own crew → its own pay pool (income splits per job); its cost rolls up into the patio's P&L (subJobsOf).
  const pickLine=(q.items||[]).find(it=>it&&it._pickup);
  if(pickLine){
    let sub=q.pickupJobId?d.jobs.find(j=>j.id===q.pickupJobId):null;const isNewSub=!sub;
    if(!sub){sub={id:uid(),done:false,crew:[]};d.jobs.push(sub);}
    sub.title=pickLine.name||"Materials pickup";sub.parentJobId=job.id;sub.sharedJobIds=[job.id];sub.stopKind="pickup";
    sub.customerId=q.customerId||sub.customerId||"";sub.propertyId=q.propertyId||sub.propertyId||"";
    sub.address=q.address||sub.address||"";sub.date=date;sub.time=time;sub.quoteId=q.id;sub.pickupRun=true;
    sub.estHours=+pickLine.estHours||0;sub.estCrew=Math.max(1,+pickLine.estCrew||2);
    if(typeof jobEnsurePO==="function")jobEnsurePO(sub);
    touch(sub);q.pickupJobId=sub.id;
    if(typeof logChange==="function")logChange(isNewSub?"create":"update","job",sub.id,(isNewSub?"Pickup sub-job created — ":"Pickup sub-job updated — ")+(sub.title||"pickup")+" · assign who's hauling");
  }
  const c=q.customerId?d.customers.find(x=>x.id===q.customerId):null;
  if(c&&c.status!=="Won"&&c.status!=="Lost"){c.status="Won";touch(c);}
  if(typeof logChange==="function"){
    logChange(isNew?"create":"update","job",job.id,(isNew?"Scheduled from quote — ":"Rescheduled — ")+(job.title||"job")+" · "+fmtDate(date)+(time?" "+time:""));
    logChange("update","quote",q.id,"Accepted & scheduled "+money(q.total||0)+(q.cust?" · "+q.cust:""));
  }
  save();closeModal();render();
};
/* leave the wizard and open the linked job */
window.closeWizToJob=function(jobId){if(typeof exitWizard==="function")exitWizard();openJobPage(jobId);};

