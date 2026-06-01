/* ---------- SCHEDULE ---------- */
let CALY=null,CALM=null;
function rSchedule(){
  const t=today();
  if(CALY==null){const d=new Date();CALY=d.getFullYear();CALM=d.getMonth();}
  const jobs=actJ().slice().sort((a,b)=>(a.date+(a.time||""))<(b.date+(b.time||""))?-1:1);
  let h=`<h2>Schedule</h2>`+renderCalendar(jobs);
  const groups={Today:[],Upcoming:[],Done:[]};
  jobs.forEach(j=>{if(j.done)groups.Done.push(j);else if(j.date>t)groups.Upcoming.push(j);else groups.Today.push(j);});
  if(!jobs.length)h+=`<div class="empty" style="padding:18px">No jobs yet — tap a day above or the + button.</div>`;
  ["Today","Upcoming","Done"].forEach(g=>{if(!groups[g].length)return;
    h+=`<div class="secthd"><h2>${g}</h2><span class="ct">${groups[g].length}</span></div><div class="card">`+groups[g].map(liJob).join("")+`</div>`;});
  view.innerHTML=h;
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
    dj.slice(0,2).forEach(j=>inner+=`<div class="caljob" style="${j.done?'opacity:.5;text-decoration:line-through':''}">${esc(j.title||'Job')}</div>`);
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
  return `<div class="li"><div class="grow" onclick="openJob('${j.id}')">
    <div class="nm" style="${j.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(j.title||"Job")}</div>
    <div class="sub">${fmtDate(j.date)}${j.time?" · "+j.time:""}${j.customerId?" · "+esc(custName(j.customerId)):""}</div></div>
    <input type="checkbox" style="width:22px;height:22px" ${j.done?"checked":""} onchange="toggleJob('${j.id}')"></div>`;
}
window.openJob=function(id,customerId,presetDate){
  const d=D();const j=id?d.jobs.find(x=>x.id===id):{id:uid(),date:presetDate||today(),customerId:customerId||""};
  const isNew=!id;
  const opts=`<option value="">— none —</option>`+actC().map(c=>`<option value="${c.id}" ${j.customerId===c.id?"selected":""}>${esc(c.name||c.company)}</option>`).join("");
  const svcopts=`<option value="">— optional —</option>`+cat().map(s=>`<option ${j.title===s.name?"selected":""}>${s.name}</option>`).join("");
  modal(isNew?"Schedule job":"Job",`
    <label>Job / service</label><input id="j_title" value="${esc(j.title||"")}" placeholder="e.g. Power wash — driveway">
    <label>Or pick from services</label><select id="j_svc" onchange="if(this.value)document.getElementById('j_title').value=this.value">${svcopts}</select>
    <label>Customer</label><select id="j_cust">${opts}</select>
    <label>Property (for the job route map)</label><select id="j_prop"><option value="">— none —</option>${actProps().map(p=>`<option value="${p.id}" ${j.propertyId===p.id?"selected":""}>${esc(p.label||p.address||"Property")}${p.lat==null?" (no location)":""}</option>`).join("")}</select>
    <div class="row" style="gap:8px"><div class="grow"><label>Date</label><input id="j_date" type="date" value="${j.date||today()}"></div>
    <div class="grow"><label>Time</label><input id="j_time" type="time" value="${j.time||""}"></div></div>
    <label>Notes</label><textarea id="j_notes">${esc(j.notes||"")}</textarea>
    <button class="btn acc" style="margin-top:14px" onclick="saveJob('${j.id}',${isNew})">Save</button>
    ${!isNew?`<button class="btn danger" style="margin-top:10px" onclick="delJob('${j.id}')">Delete job</button>`:""}
  `);
};
window.saveJob=function(id,isNew){
  const d=D();let j=isNew?{id}:d.jobs.find(x=>x.id===id);
  j.title=val("j_title");j.customerId=val("j_cust");j.propertyId=val("j_prop");j.date=val("j_date");j.time=val("j_time");j.notes=val("j_notes");
  if(!j.title){alert("Give the job a name.");return;}
  if(isNew)j.done=false;touch(j);if(isNew)d.jobs.push(j);
  save();closeModal();render();
};
window.toggleJob=function(id){const j=D().jobs.find(x=>x.id===id);j.done=!j.done;if(j.done)logEvent("Job completed — "+(j.title||"job"),"job");touch(j);save();render();};
window.delJob=function(id){if(!confirm("Delete this job?"))return;
  const j=D().jobs.find(x=>x.id===id);j.deleted=true;touch(j);save();closeModal();render();};

