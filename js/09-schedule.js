/* ---------- SCHEDULE ---------- */
let CALY=null,CALM=null,SCHEDSUB="calendar",SCHED_DATE=null,JOBCREW=new Set();
function rSchedule(){
  const sub=`<div class="subnav"><button class="subbtn ${SCHEDSUB==="calendar"?"on":""}" onclick="schedSub('calendar')">📅 Calendar</button><button class="subbtn ${SCHEDSUB==="crew"?"on":""}" onclick="schedSub('crew')">👥 Crew availability</button></div>`;
  if(SCHEDSUB==="crew"){view.innerHTML=sub+rCrewSchedule();return;}
  const t=today();
  if(CALY==null){const d=new Date();CALY=d.getFullYear();CALM=d.getMonth();}
  const jobs=actJ().slice().sort((a,b)=>(a.date+(a.time||""))<(b.date+(b.time||""))?-1:1);
  const cu=(typeof curUser==="function")?curUser():null;
  let h=sub+`<div class="secthd"><h2>Schedule</h2>${cu?`<button class="btn ghost sm" onclick="openAvailability()">My availability</button>`:""}</div>`;
  if(cu&&typeof availSummary==="function")h+=`<div class="card" style="padding:10px 12px;cursor:pointer" onclick="openAvailability()"><div class="sub" style="white-space:normal">🗓 <b>Your availability</b> — ${esc(availSummary(cu))}</div></div>`;
  h+=renderCalendar(jobs);
  const groups={Today:[],Upcoming:[],Done:[]};
  jobs.forEach(j=>{if(j.done)groups.Done.push(j);else if(j.date>t)groups.Upcoming.push(j);else groups.Today.push(j);});
  if(!jobs.length)h+=`<div class="empty" style="padding:18px">No jobs yet — tap a day above or the + button.</div>`;
  ["Today","Upcoming","Done"].forEach(g=>{if(!groups[g].length)return;
    h+=`<div class="secthd"><h2>${g}</h2><span class="ct">${groups[g].length}</span></div><div class="card">`+groups[g].map(liJob).join("")+`</div>`;});
  view.innerHTML=h;
}
window.schedSub=function(s){SCHEDSUB=s;render();};
window.schedDate=function(v){SCHED_DATE=v;render();};
/* compact crew initials for a tight space (calendar cells) */
function crewInitials(ids){return (ids||[]).map(id=>{const u=(S.users||[]).find(x=>x.id===id);if(!u)return"";const p=String(u.username||"").trim().split(/\s+/).filter(Boolean);return (p.length>1?(p[0][0]+p[1][0]):(u.username||"").slice(0,2)).toUpperCase();}).filter(Boolean).join(" ");}
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
  const dayJobs=actJ().filter(j=>j.date===ds).sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
  h+=`<div class="secthd"><h2>Jobs this day</h2><span class="ct">${dayJobs.length}</span></div>`;
  h+=dayJobs.length?`<div class="card">`+dayJobs.map(j=>`<div class="li"><div class="grow" onclick="openJob('${j.id}')" style="cursor:pointer"><div class="nm">${esc(j.title||"Job")}</div><div class="sub">${j.time?esc(j.time)+" · ":""}${j.customerId?esc(custName(j.customerId))+" · ":""}</div><div style="margin-top:4px">${crewChips(j)}</div></div></div>`).join("")+`</div>`
    :`<div class="card"><div class="muted">No jobs scheduled. <a href="#" onclick="closeModal();openJob(null,'','${ds}');return false" style="color:var(--brand);font-weight:700">Add one</a>.</div></div>`;
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
    const jc=actJ().filter(j=>j.date===d).length,free=mem.filter(u=>isFree(u,d)).length;
    return `<div class="li" style="cursor:pointer" onclick="schedDate('${d}')"><div class="grow"><div class="nm" style="font-size:14px${d===ds?";color:var(--brand)":""}">${DOW[dowOf(d)]} ${fmtDate(d)}</div></div><div class="sub">${jc} job${jc!==1?"s":""} · ${free} free</div></div>`;}).join("")+`</div>`;
  return h;
}
function renderCalendar(jobs){
  const t=today();const byDate={};jobs.forEach(j=>{(byDate[j.date]=byDate[j.date]||[]).push(j);});
  const first=new Date(CALY,CALM,1);const startDow=first.getDay();
  const dim=new Date(CALY,CALM+1,0).getDate();
  const mname=first.toLocaleString(undefined,{month:"long"});
  const dows=["Su","Mo","Tu","We","Th","Fr","Sa"];
  let cells=dows.map(d=>`<div class="caldow">${d}</div>`).join("");
  for(let i=0;i<startDow;i++)cells+=`<div class="calcell out"></div>`;
  for(let day=1;day<=dim;day++){
    const ds=CALY+"-"+String(CALM+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    const dj=byDate[ds]||[];let inner=`<div class="dnum">${day}</div>`;
    dj.slice(0,2).forEach(j=>{const conf=jobHasConflict(j),ini=crewInitials(j.crew);
      inner+=`<div class="caljob" style="${j.done?'opacity:.5;text-decoration:line-through':''}${conf?';background:var(--danger)':''}" title="${esc(j.title||'Job')}${ini?' · '+esc(ini):''}${conf?' · crew unavailable':''}">${esc(j.title||'Job')}${ini?` <span style="opacity:.85;font-weight:700">${esc(ini)}</span>`:""}</div>`;});
    if(dj.length>2)inner+=`<div class="calmore">+${dj.length-2} more</div>`;
    cells+=`<div class="calcell${ds===t?' today':''}" onclick="openDay('${ds}')">${inner}</div>`;
  }
  return `<div class="calhead"><button class="calnav" onclick="calShift(-1)">‹</button>
    <div class="mtitle">${mname} ${CALY}</div><button class="calnav" onclick="calShift(1)">›</button>
    <button class="btn ghost sm" style="margin-left:auto" onclick="calToday()">Today</button></div>
    <div class="calgrid">${cells}</div>`;
}
window.calShift=function(n){CALM+=n;if(CALM<0){CALM=11;CALY--;}if(CALM>11){CALM=0;CALY++;}render();};
window.calToday=function(){const d=new Date();CALY=d.getFullYear();CALM=d.getMonth();render();};
window.openDay=function(ds){
  const jobs=actJ().filter(j=>j.date===ds).sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
  const list=jobs.length?jobs.map(j=>`<div class="li"><div class="grow" onclick="closeModal();openJob('${j.id}')"><div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(j.title)}</div><div class="sub">${esc(j.time||"")}${j.customerId?" · "+esc(custName(j.customerId)):""}</div></div></div>`).join(""):`<div class="muted">No jobs this day.</div>`;
  modal(fmtDate(ds),`<div class="card">${list}</div><button class="btn acc" onclick="closeModal();openJob(null,'','${ds}')">Add job on this day</button>`);
};
function liJob(j){
  const crew=(j.crew&&j.crew.length)?`<div style="margin-top:4px">${crewChips(j)}</div>`:"";
  return `<div class="li"><div class="grow" onclick="openJob('${j.id}')">
    <div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(j.title||"Job")}</div>
    <div class="sub">${fmtDate(j.date)}${j.time?" · "+j.time:""}${j.customerId?" · "+esc(custName(j.customerId)):""}</div>${crew}</div>
    <input type="checkbox" style="width:22px;height:22px" ${j.done?"checked":""} onchange="toggleJob('${j.id}')"></div>`;
}
window.openJob=function(id,customerId,presetDate){
  const d=D();const j=id?d.jobs.find(x=>x.id===id):{id:uid(),date:presetDate||today(),customerId:customerId||""};
  const isNew=!id;
  JOBCREW=new Set(j.crew||[]);   // live assignment set for this modal
  const opts=`<option value="">— none —</option>`+actC().map(c=>`<option value="${c.id}" ${j.customerId===c.id?"selected":""}>${esc(c.name||c.company)}</option>`).join("");
  const svcopts=`<option value="">— optional —</option>`+cat().map(s=>`<option ${j.title===s.name?"selected":""}>${s.name}</option>`).join("");
  modal(isNew?"Schedule job":"Job",`
    <label>Job / service</label><input id="j_title" value="${esc(j.title||"")}" placeholder="e.g. Power wash — driveway">
    <label>Or pick from services</label><select id="j_svc" onchange="if(this.value)document.getElementById('j_title').value=this.value">${svcopts}</select>
    <label>Customer</label><select id="j_cust">${opts}</select>
    <label>Property (for the job route map)</label><select id="j_prop"><option value="">— none —</option>${actProps().map(p=>`<option value="${p.id}" ${j.propertyId===p.id?"selected":""}>${esc(p.label||p.address||"Property")}${p.lat==null?" (no location)":""}</option>`).join("")}</select>
    <div class="row" style="gap:8px"><div class="grow"><label>Date</label><input id="j_date" type="date" value="${j.date||today()}" onchange="renderJobCrew()"></div>
    <div class="grow"><label>Time</label><input id="j_time" type="time" value="${j.time||""}"></div></div>
    <label>Assign crew</label>
    <div id="j_crew"></div>
    <div class="sub" id="j_crew_note" style="margin-top:6px"></div>
    <label style="margin-top:12px">Notes</label><textarea id="j_notes">${esc(j.notes||"")}</textarea>
    <button class="btn acc" style="margin-top:14px" onclick="saveJob('${j.id}',${isNew})">Save</button>
    ${!isNew?`<button class="btn danger" style="margin-top:10px" onclick="delJob('${j.id}')">Delete job</button>`:""}
  `);
  renderJobCrew();
  if(typeof lockGuard==="function")lockGuard("job",isNew?null:j.id,()=>openJob(id));
};
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
  if(!j.title){alert("Give the job a name.");return;}
  if(isNew)j.done=false;touch(j);if(isNew)d.jobs.push(j);
  if(typeof logChange==="function")logChange(isNew?"create":"update","job",j.id,(isNew?"Scheduled ":"Updated ")+(j.title||"job")+(j.date?" · "+fmtDate(j.date):""));
  save();closeModal();render();
};
window.toggleJob=function(id){const j=D().jobs.find(x=>x.id===id);j.done=!j.done;if(typeof logChange==="function")logChange("update","job",id,(j.done?"Completed ":"Reopened ")+(j.title||"job"));touch(j);save();render();};
window.delJob=function(id){if(!confirm("Delete this job?"))return;
  const j=D().jobs.find(x=>x.id===id);j.deleted=true;touch(j);if(typeof logChange==="function")logChange("delete","job",id,"Deleted "+(j.title||"job"));save();closeModal();render();};

