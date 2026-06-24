/* ---------- SCHEDULE ---------- */
let CALY=null,CALM=null,SCHEDSUB="calendar",SCHED_DATE=null,JOBCREW=new Set(),JSEARCH="";
let JOBEQUIP=[],JOBEQUIP_JID=null;   // live required-equipment list for the open job modal (mirrors JOBCREW)
function rSchedule(){
  if(window.JOB_OPEN && typeof rJobPage==="function"){ const _j=(typeof actJ==="function")&&actJ().find(x=>x.id===window.JOB_OPEN&&!x.deleted); if(_j){ const _pn=document.getElementById("job_notes"),_pd=_pn?_pn.value:null,_pf=_pn&&document.activeElement===_pn,_ps=_pn?_pn.selectionStart:0,_pe=_pn?_pn.selectionEnd:0; view.innerHTML=rJobPage(_j); const _nn=document.getElementById("job_notes"); if(_nn&&_pd!=null){ _nn.value=_pd; if(_pf){ _nn.focus(); try{_nn.setSelectionRange(_ps,_pe);}catch(e){} } } return; } window.JOB_OPEN=null; }
  if(SCHEDSUB==="crew")SCHEDSUB="calendar";   // crew-availability tab retired (Ray's request)
  const sub=`<div class="subnav"><button class="subbtn ${SCHEDSUB==="calendar"?"on":""}" onclick="schedSub('calendar')">📅 Calendar</button><button class="subbtn ${SCHEDSUB==="myavail"?"on":""}" onclick="schedSub('myavail')">🗓 My shifts</button></div>`;
  if(SCHEDSUB==="myavail"){view.innerHTML=sub+(typeof renderMyAvailCalendar==="function"?renderMyAvailCalendar():"");return;}
  // Calendar = just the month calendar. Scheduled jobs live on the Jobs tab + the Today page; tap a day here for that day's jobs.
  if(CALY==null){const d=new Date();CALY=d.getFullYear();CALM=d.getMonth();}
  const jobs=actJ().slice().sort((a,b)=>(a.date+(a.time||""))<(b.date+(b.time||""))?-1:1);
  let h=sub+renderCalendar(jobs);
  if(typeof schedMembers==="function"&&schedMembers().length)h+=`<div class="sub" style="margin:-2px 6px 10px;white-space:normal">Each day shows crew initials — <b style="color:var(--muted)">gray = not confirmed</b>, <b style="color:var(--accent)">green = available</b>, <b style="color:#e0a800">yellow = part-day</b>, <b style="color:var(--danger)">red = off</b>. Tap a day for the full picture.</div>`;
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
  const dayJobs=actJ().filter(j=>j.date===ds).sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
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
    const jc=actJ().filter(j=>j.date===d).length,free=mem.filter(u=>isFree(u,d)).length;
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
    const dj=byDate[ds]||[];
    let inner=`<div class="dnum">${day}</div>`+calDayChips(ds);
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
/* compact required-equipment line for a job row — count + a clear flag if any item is over-committed on its date */
function jobEquipLine(j){
  const eq=(typeof jobEquip==="function")?jobEquip(j):[];if(!eq.length)return"";
  const n=eq.reduce((s,e)=>s+e.qty,0);
  const conf=j.done?0:eq.filter(e=>eqConflict(e.itemId,j.date,e.qty,j.id).conflict).length;
  const c=conf?` <span style="color:var(--danger);font-weight:700">⚠ ${conf} over-committed</span>`:"";
  return `<div class="sub" style="margin-top:2px">🧰 ${n} item${n>1?"s":""}${c}</div>`;
}
function liJob(j){
  const crew=(j.crew&&j.crew.length)?`<div style="margin-top:4px">${crewChips(j)}</div>`:"";
  return `<div class="li"><div class="grow" onclick="openJobPage('${j.id}')">
    <div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(j.title||"Job")}</div>
    <div class="sub">${fmtDate(j.date)}${j.time?" · "+j.time:""}${j.customerId?" · "+esc(custName(j.customerId)):""}</div>${crew}${jobEquipLine(j)}</div>
    <input type="checkbox" style="width:22px;height:22px" ${j.done?"checked":""} onchange="toggleJob('${j.id}')"></div>`;
}
window.openJob=function(id,customerId,presetDate){
  const d=D();const j=id?d.jobs.find(x=>x.id===id):{id:uid(),date:presetDate||today(),customerId:customerId||""};
  const isNew=!id;
  JOBCREW=new Set(j.crew||[]);   // live assignment set for this modal
  JOBEQUIP=(typeof jobEquip==="function")?jobEquip(j):[];JOBEQUIP_JID=j.id;   // live required-equipment list for this modal
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
    <div class="row" style="gap:8px"><div class="grow"><label>Date</label><input id="j_date" type="date" value="${j.date||today()}" onchange="renderJobCrew();renderJobEquip()"></div>
    <div class="grow"><label>Time</label><input id="j_time" type="time" value="${j.time||""}"></div></div>
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
  renderJobCrew();renderJobEquip();if(!isNew){renderJobExpenses(j.id);renderJobResale(j.id);}
  if(typeof lockGuard==="function")lockGuard("job",isNew?null:j.id,()=>openJob(id));
};
/* ---- per-job expenses (hard cost; Cap #3). Writes straight to job.expenses[] (rides job LWW) so a
   crew member logging a cost in the field persists immediately. Categories per the cost model —
   NO labor line, ever. Mileage enters miles → auto-costed at the IRS rate. ---- */
let JOBEXP_CAT="materials";
const JOBEXP_CATS=[["disposal","🗑 Disposal"],["mileage","🚗 Mileage"],["materials","🧴 Materials"],["equipment","🔧 Equipment rental"],["misc","• Misc"]];
function jobExpenses(j){return Array.isArray(j&&j.expenses)?j.expenses:[];}
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
  if(!Array.isArray(j.expenses))j.expenses=[];
  let amount=0,miles=null;
  if(JOBEXP_CAT==="mileage"){miles=Math.max(0,+val("exp_miles")||0);if(!miles){alert("Enter the miles driven.");return;}amount=Math.round(miles*MILEAGE_RATE*100)/100;}
  else{amount=Math.round((Math.max(0,+val("exp_amt")||0))*100)/100;if(!amount){alert("Enter an amount.");return;}}
  const e={id:"ex_"+uid(),cat:JOBEXP_CAT,amount:amount,note:val("exp_note")||"",addedAt:now(),addedBy:((typeof curUser==="function"&&curUser())?curUser().id:null)};
  if(miles!=null)e.miles=miles;
  j.expenses.push(e);touch(j);
  if(typeof logChange==="function")logChange("update","job",jobId,"Expense +"+expFmt(amount)+" ("+JOBEXP_CAT+") · "+(j.title||"job"));
  save();renderJobExpenses(jobId);
};
window.expJobDel=function(jobId,exId){
  const j=D().jobs.find(x=>x.id===jobId);if(!j)return;
  j.expenses=jobExpenses(j).filter(e=>e.id!==exId);touch(j);save();renderJobExpenses(jobId);
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
  j.equipment=JOBEQUIP.map(e=>({itemId:e.itemId,qty:e.qty}));
  if(!j.title){alert("Give the job a name.");return;}
  if(isNew)j.done=false;touch(j);if(isNew)d.jobs.push(j);
  if(typeof logChange==="function")logChange(isNew?"create":"update","job",j.id,(isNew?"Scheduled ":"Updated ")+(j.title||"job")+(j.date?" · "+fmtDate(j.date):""));
  save();closeModal();render();
};
window.toggleJob=function(id){const j=D().jobs.find(x=>x.id===id);j.done=!j.done;
  if(j.done){j.completedAt=now();j.completedBy=((typeof curUser==="function"&&curUser())?curUser().id:null);}else{j.completedAt=null;j.completedBy=null;}  /* ops-brain capture: stamp completion time + who */
  if(typeof logChange==="function")logChange("update","job",id,(j.done?"Completed ":"Reopened ")+(j.title||"job"));touch(j);save();render();
  if(j.done&&typeof reviewPrompt==="function")reviewPrompt(id);};   /* Cap #2: ask for a Google review at the done-moment */
window.delJob=function(id){if(!confirm("Delete this job?"))return;
  const j=D().jobs.find(x=>x.id===id);j.deleted=true;touch(j);if(typeof logChange==="function")logChange("delete","job",id,"Deleted "+(j.title||"job"));save();closeModal();render();};

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
  touch(job);
  q.accepted=true;q.jobId=job.id;q.acceptedDate=date;touch(q);
  if(typeof WZ!=="undefined"&&WZ&&WZ.id===q.id){WZ.accepted=true;WZ.jobId=job.id;WZ.acceptedDate=date;}
  const c=q.customerId?d.customers.find(x=>x.id===q.customerId):null;
  if(c&&c.status!=="Won"&&c.status!=="Lost"){c.status="Won";touch(c);}
  if(typeof logChange==="function"){
    logChange(isNew?"create":"update","job",job.id,(isNew?"Scheduled from quote — ":"Rescheduled — ")+(job.title||"job")+" · "+fmtDate(date)+(time?" "+time:""));
    logChange("update","quote",q.id,"Accepted & scheduled "+money(q.total||0)+(q.cust?" · "+q.cust:""));
  }
  save();closeModal();render();
};
/* leave the wizard and open the linked job */
window.closeWizToJob=function(jobId){if(typeof exitWizard==="function")exitWizard();openJob(jobId);};

