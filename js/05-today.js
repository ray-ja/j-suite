/* ---------- TODAY — morning dashboard: notice board, who's working, today's jobs (+ quick-add tasks),
   the money (invoices to send / awaiting payment / open quotes), monthly payouts, top to-dos ---------- */
function rToday(){
  const t=today();
  const me=(typeof curUser==="function")?curUser():null;
  const owner=(typeof isOwner==="function"&&isOwner());
  const mem=(typeof schedMembers==="function")?schedMembers():[];
  let h="";

  // 0) Approvals waiting (admin only) — above everything
  if(owner && typeof apprPending==="function"){
    const _pend=apprPending();
    if(_pend.length){
      h+=`<div class="secthd"><h2>📥 Approvals waiting</h2><span class="ct">${_pend.length}</span></div><div class="card" style="border-left:4px solid var(--accent)">`+_pend.map(x=>{const pc=x.pc;return `<div class="li" style="align-items:flex-start"><div class="grow"><div class="nm" style="font-size:15px;white-space:normal">${esc(pc.summary||pc.collection||"Change")}</div><div class="sub">Cap wants your okay · ${esc(pc.collection||"")}</div></div><div class="row" style="gap:6px;flex:0 0 auto"><button class="btn acc sm" onclick="apprApprove('${x.biz}','${pc.id}')">✓</button><button class="btn ghost sm" onclick="apprReject('${x.biz}','${pc.id}')">✕</button></div></div>`;}).join("")+`</div>`;
    }
  }

  // 0.5) New-crew quick-start — first-login dismissible checklist (js/86). Shows until done/dismissed.
  if(typeof crewQuickStartHTML==="function") h+=crewQuickStartHTML();

  // 1) Notice board — at the very top
  const dir=(D().docs.find(x=>x.id==="ceo"&&!x.deleted)||{}).text||"";
  h+=`<div class="secthd"><h2>📋 Notice board</h2>${owner?`<button class="btn ghost sm" style="margin-left:auto" onclick="editDoc('ceo','Notice board')">Edit</button>`:""}</div>
    <div class="card" style="border-left:4px solid var(--accent)"><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${dir?esc(dir):'<span class="muted">Nothing posted — tap Edit.</span>'}</div></div>`;

  // 2) Clock — clocked-in banner OR the prominent clock-in card (Item 3): clock in right here on Today, picking or
  // adding the job to attach the shift to. Uses the SAME shared form (js/38 tcClockInFormHTML) as the Time tab +
  // job page, so vehicle/trailer/rider-role/start-odo/route-estimate all come along.
  if(me){
    const open=(typeof tcMyOpen==="function")?tcMyOpen():null;
    if(open){ const oj=actJ().find(x=>x.id===open.jobId); const since=new Date(open.clockIn).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      h+=`<div class="card" style="border-left:5px solid var(--accent)"><div class="row"><div class="grow"><div class="nm">⏱️ Clocked in${oj?` · ${esc(oj.title||"job")}`:""}</div><div class="sub">since ${since}</div></div><button class="btn danger sm" onclick="tcClockOut('${open.id}')">Clock out</button></div></div>`;
    } else {
      const _form=(typeof tcClockInFormHTML==="function")?tcClockInFormHTML(null):"";
      h+=`<div class="card" style="border-top:4px solid var(--accent)"><div class="nm" style="font-size:16px">⏱️ Clock in</div>`;
      h+=_form?_form:`<div class="muted" style="margin-top:6px">No open jobs yet — add one to clock into.</div>`;
      // "＋ Add a job" → create it, then land on its page (which has the pre-scoped clock-in form) so a new job
      // flows straight into clocking in.
      h+=`<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="openQuickTask(function(id){ if(typeof openJobPage==='function') openJobPage(id); })">＋ Add a job to clock into</button>`;
      h+=`</div>`;
    }
  }

  // 2.5) Needs-cleaning nudge — operational (everyone sees it); taps through to the Inventory cleaning list.
  if(typeof invNeedsCleaning==="function"){
    const _nc=invNeedsCleaning();
    if(_nc.length){
      h+=`<div class="card" style="border-left:4px solid #b8860b;cursor:pointer" onclick="invGotoCleaning()"><div class="row"><div class="grow"><div class="nm">🧽 ${_nc.length} item${_nc.length>1?"s":""} need${_nc.length>1?"":"s"} cleaning</div><div class="sub" style="white-space:normal">${_nc.slice(0,3).map(i=>esc(i.name)).join(", ")}${_nc.length>3?" +"+(_nc.length-3):""}</div></div><span class="sub">Clean →</span></div></div>`;
    }
  }

  // 3) Who's working today (+ when) — with a link to the full Schedule
  if(mem.length){
    h+=`<div class="secthd"><h2>👥 Who's working today</h2>${(typeof navSub==="function")?`<button class="btn ghost sm" style="margin-left:auto" onclick="navSub('schedule')">Schedule →</button>`:""}</div><div class="card">`;
    h+=mem.map(u=>{ const a=(typeof availOn==="function")?availOn(u,t):{status:"unknown",label:""};
      const col=a.status==="on"?"var(--accent)":a.status==="partial"?"#e0a800":a.status==="oncall"?"#2f6fed":(a.status==="off"||a.status==="timeoff")?"var(--danger)":"var(--muted)";
      const lbl=a.status==="on"?"Available all day":a.status==="partial"?(a.label||"Part of day"):a.status==="oncall"?"On call":a.status==="off"?"Off":a.status==="timeoff"?(a.label||"Time off"):"Not confirmed";
      return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)}</div></div><span style="color:${col};font-weight:700;font-size:13px;text-align:right;white-space:normal">${esc(lbl)}</span></div>`;
    }).join("")+`</div>`;
  }

  // 4) Today's jobs (+ quick-add task) — if none today, show the next upcoming job
  // MULTI-DAY: a job shows on Today if ANY of its work days is today (not just its start date).
  const _onDay=(typeof jobOnDay==="function")?jobOnDay:((j,d)=>j.date===d);
  const _nextDay=j=>{const ds=(typeof jobWorkDays==="function"?jobWorkDays(j):(j.date?[j.date]:[])).filter(d=>d>t).sort();return ds[0]||"";};
  const _aj=actJ();   // active jobs, computed ONCE for this render (was re-filtered on every actJ() call below)
  const jobs=_aj.filter(j=>!j.done&&_onDay(j,t));
  const nextJob=jobs.length?null:(_aj.filter(j=>!j.done&&_nextDay(j)).sort((a,b)=>_nextDay(a).localeCompare(_nextDay(b)))[0]||null);
  h+=`<div class="secthd"><h2>📅 Today's jobs</h2><span class="ct">${jobs.length}</span><button class="btn ghost sm" style="margin-left:auto" onclick="openQuickTask()">+ Add</button></div>`;
  if(jobs.length) h+=`<div class="card">`+jobs.map(liJob).join("")+`</div>`;
  else if(nextJob) h+=`<div class="card"><div class="sub" style="margin-bottom:8px">No jobs today — next job is <b>${fmtDate(_nextDay(nextJob)||nextJob.date)}</b></div>`+liJob(nextJob)+`<button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="openQuickTask()">+ Add a task</button></div>`;
  else h+=`<div class="empty">No jobs today.<br><button class="btn ghost sm" style="margin-top:8px" onclick="openQuickTask()">+ Add a task</button></div>`;

  // 5) Money first (owner) — open quotes · confirmed (booked) jobs · invoices to send · awaiting payment
  if(owner){
    // index active jobs by id ONCE — jobDone below was doing a full actJ().find() per booked quote (O(quotes×jobs))
    const _jByIdToday=new Map(); _aj.forEach(j=>{ if(j&&j.id!=null&&!_jByIdToday.has(j.id))_jByIdToday.set(j.id,j); });
    // a booked quote's job is "done" once its linked job is checked off (matches the pipeline split: to-do vs ready-to-bill)
    const jobDone=q=>{ if(!q.jobId)return false; const j=_jByIdToday.get(q.jobId); return !!(j&&j.done); };
    const moneySect=(title,arr,go)=>arr.length?`<div class="secthd"><h2>${title}</h2><span class="ct">${arr.length}</span></div><div class="card">`+
      arr.slice().sort((a,b)=>((a.date||"")<(b.date||"")?1:-1)).map(q=>`<div class="li" onclick="${(go&&go(q))||`openQuote('${q.id}')`}"><div class="grow"><div class="nm">${esc(q.cust||custName(q.customerId)||"—")}</div><div class="sub">${typeof quoteType==="function"?esc(quoteType(q)):""}${q.date?" · "+fmtDate(q.date):""}</div></div><div class="nm" style="color:var(--brand-text)">${money(q.finalPrice||q.total)}</div></div>`).join("")+`</div>`:"";
    const _aq=actQ();   // active quotes, computed ONCE (was re-filtered on every actQ() call below)
    const booked=_aq.filter(q=>!q.deleted&&q.accepted&&!q.invoiced&&!q.paid);   // accepted, not yet invoiced
    h+=moneySect("📝 Open quotes",_aq.filter(q=>!q.deleted&&!q.accepted&&!q.invoiced&&!q.paid));
    // Confirmed jobs = the whole booked-but-not-invoiced pipeline whose work isn't finished yet (distinct from "Today's jobs", which is just today's scheduled work) → tap opens the job
    h+=moneySect("🔧 Confirmed jobs",booked.filter(q=>!jobDone(q)),q=>q.jobId?`openJobPage('${q.jobId}')`:`openQuote('${q.id}')`);
    // Invoices to send = booked work that's done → ready to bill
    h+=moneySect("📤 Invoices to send",booked.filter(jobDone));
    h+=moneySect("⏳ Awaiting payment",_aq.filter(q=>!q.deleted&&q.invoiced&&!q.paid));
  }

  // 6) Payouts — monthly, paid the first workday of next month (owner: everyone; crew: yourself)
  if(typeof finRollup==="function"&&typeof finPayouts==="function"&&mem.length){
    try{
      const ym=(typeof finMonth==="function")?finMonth():t.slice(0,7);
      const b=(typeof monthBounds==="function")?monthBounds(ym):{from:ym+"-01",to:ym+"-31"};
      const roll=finRollup((typeof actIncome==="function"?actIncome():[]),{adminMemberId:(typeof finAdminMember==="function"?finAdminMember():""),from:b.from,to:b.to});
      const mil=(typeof finMileage==="function")?finMileage(D().timeclock||[],{from:b.from,to:b.to,confirmedOnly:true}):{perMember:{}};
      const pay=finPayouts(roll,mil);
      const rows=owner?mem:mem.filter(u=>me&&u.id===me.id);
      if(rows.length){
        h+=`<div class="secthd"><h2>💵 Payouts</h2>${owner?`<button class="btn ghost sm" style="margin-left:auto" onclick="TAB='finance';render()">Details</button>`:""}</div>
          <div class="card"><div class="sub" style="margin-bottom:6px">${esc((typeof finMonthLabel==="function")?finMonthLabel(ym):ym)} · pays <b>${esc(payoutDate(ym))}</b></div>`+
          rows.map(u=>{const p=pay[u.id]||{total:0}; return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)}</div></div><div class="nm" style="color:var(--brand-text)">${money((p.total||0)/100)}</div></div>`;}).join("")+`</div>`;
      }
    }catch(e){}
  }

  // 7) Top to-dos (owner) — just the top few
  if(owner&&typeof actTodo==="function"){
    const td0=actTodo().filter(x=>!x.done);
    const top=((typeof sortTodos==="function")?sortTodos(td0):td0).slice(0,4);
    if(top.length){ h+=`<div class="secthd"><h2>✅ Top to-dos</h2>${td0.length>top.length?`<span class="ct">+${td0.length-top.length}</span>`:""}</div><div class="card">`+top.map(td=>liTodo(td,t)).join("")+`</div>`; }
  }

  view.innerHTML='<div class="pgcols">'+h+'</div>';
}

/* first workday (Mon–Fri) of the month AFTER ym ("YYYY-MM") — when that month's payouts go out */
function payoutDate(ym){
  const p=String(ym).split("-"); let y=+p[0], m=+p[1]+1; if(m>12){m=1;y++;}
  const d=new Date(y,m-1,1); while(d.getDay()===0||d.getDay()===6)d.setDate(d.getDate()+1);
  return d.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
}

/* quick-add a task/job right from Today (e.g. "clean the chainsaw"), assign crew, notify them.
   afterCreate(jobId) (optional) — a callback run with the new job's id once it's created + saved (used by the
   Today "＋ Add a job to clock into" flow so a brand-new job flows straight into the clock-in form). */
let QT_AFTER=null;
window.openQuickTask=function(afterCreate){
  QT_AFTER=(typeof afterCreate==="function")?afterCreate:null;
  const crew=(typeof schedMembers==="function")?schedMembers():[];
  const me=(typeof curUser==="function")?curUser():null;
  const tpls=jobTemplates().list.filter(x=>x&&!x.deleted);
  modal("Add a task / job",`
    ${tpls.length?`<label style="margin-top:0">Common jobs — one tap</label><div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:4px">${tpls.map(t=>`<button class="btn ghost sm" onclick="applyJobTemplate('${t.id}')">🔁 ${esc(t.label||t.title||"Job")}</button>`).join("")}<button class="btn ghost sm" onclick="newJobTemplate()">+ New</button></div><div style="border-top:1px solid var(--line);margin:8px 0"></div>`:`<button class="btn ghost sm" style="margin-bottom:8px;width:100%" onclick="newJobTemplate()">⭐ Save a common job (like a dump run)</button>`}
    <label>What needs doing?</label><input id="qt_title" placeholder="e.g. Clean the chainsaw, sharpen blades…" autocomplete="off">
    <label>Date</label><input id="qt_date" type="date" value="${today()}">
    <label>Assign to</label>
    <div>${crew.length?crew.map(u=>`<label class="toggle"><input type="checkbox" class="qt_c" value="${esc(u.id)}" ${me&&u.id===me.id?"checked":""}> ${esc(u.username)}</label>`).join(""):'<div class="muted">No crew accounts yet.</div>'}</div>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="saveQuickTask()">Add task</button>`);
};
window.saveQuickTask=function(){
  const title=val("qt_title"); if(!title){ alert("Type what needs doing."); return; }
  const date=val("qt_date")||today();
  const crew=[].slice.call(document.querySelectorAll(".qt_c:checked")).map(c=>c.value);
  const j={id:uid(),title:title,date:date,crew:crew,customerId:null,equipment:[],done:false,updatedAt:now()};
  if(!D().jobs)D().jobs=[]; D().jobs.push(j); if(typeof touch==="function")touch(j);
  crew.forEach(id=>notifyAssignee(id,"📋 New task: "+title+" · "+fmtDate(date)));
  if(typeof save==="function")save(); if(typeof closeModal==="function")closeModal();
  const _cb=QT_AFTER; QT_AFTER=null;
  if(_cb){ _cb(j.id); } else if(typeof render==="function")render();
};
/* DM the assignee so they get a push (a 2-member human DM → Cap ignores it, the recipient is tickled) */
function notifyAssignee(assigneeId,text){
  const u=(typeof curUser==="function")?curUser():null; if(!u||assigneeId===u.id)return;
  const coll=D().messages||(D().messages=[]);
  let thr=coll.find(m=>m&&m.kind==="thread"&&!m.deleted&&m.type==="dm"&&!m.toStrategy&&(m.members||[]).length===2&&(m.members||[]).indexOf(u.id)>=0&&(m.members||[]).indexOf(assigneeId)>=0);
  let tid;
  if(thr)tid=thr.threadId; else { tid="thr_"+uid(); coll.push({id:tid,kind:"thread",threadId:tid,title:(typeof userName==="function"?userName(assigneeId):"")||"Crew",type:"dm",members:[u.id,assigneeId],createdBy:u.id,deleted:false,updatedAt:now()}); }
  coll.push({id:"msg_"+uid(),threadId:tid,senderId:u.id,senderLabel:u.username||"—",body:text,ts:now(),deleted:false,updatedAt:now()});
}

/* ---------- COMMON JOBS (templates) — frequent non-scheduled jobs like a dump run. One tap = a real,
   trackable job pre-filled with the address + known drive time/miles + hours. Stored in a docs sentinel. */
function jobTemplates(){ const d=D(); d.docs=d.docs||[]; let t=d.docs.find(x=>x&&x.id==="jobTemplates"); if(!t){t={id:"jobTemplates",list:[],updatedAt:now()};d.docs.push(t);} if(!Array.isArray(t.list))t.list=[]; return t; }
window.applyJobTemplate=function(id){
  const t=jobTemplates().list.find(x=>x&&x.id===id); if(!t)return;
  const me=(typeof curUser==="function")?curUser():null;
  // vestigial time/travel pre-fill (onSiteHrs/driveMin/driveMiles) dropped — job time now comes from the timeclock
  // and a template-copied driveMiles would fabricate a phantom mileage cost (jobMilesCost) with no miles driven.
  const j={id:uid(),title:t.title||t.label||"Job",date:today(),address:t.address||"",crew:me?[me.id]:[],crewN:t.crewN||1,equipment:[],fromTemplate:t.id,done:false,updatedAt:now()};
  if(!D().jobs)D().jobs=[]; D().jobs.push(j); if(typeof touch==="function")touch(j); save();
  if(typeof closeModal==="function")closeModal();
  const _cb=QT_AFTER; QT_AFTER=null;
  if(_cb){ _cb(j.id); } else if(typeof openJobPage==="function")openJobPage(j.id); else render();
};
window.newJobTemplate=function(id){
  const t=id?jobTemplates().list.find(x=>x&&x.id===id):null;
  modal(t?"Edit common job":"New common job",`
    <label style="margin-top:0">Name (the button)</label><input id="jt_label" value="${t?esc(t.label||t.title||""):""}" placeholder="e.g. Dump run" autocomplete="off">
    <label>Job title</label><input id="jt_title" value="${t?esc(t.title||""):""}" placeholder="e.g. Transfer station dump run" autocomplete="off">
    <label>Address</label><div class="acwrap"><input id="jt_addr" value="${t?esc(t.address||""):""}" placeholder="transfer station address" oninput="addrSuggest('jt_addr','jt_addr_ac')" autocomplete="off"><div class="acbox" id="jt_addr_ac"></div></div>
    <div class="row" style="gap:8px"><div class="grow"><label>Crew</label><input id="jt_crewN" type="number" inputmode="numeric" min="1" value="${t?(t.crewN||1):1}"></div><div class="grow"><label>On-site hrs</label><input id="jt_onsite" type="number" inputmode="decimal" step="0.25" value="${t&&t.onSiteHrs?t.onSiteHrs:""}" placeholder="0"></div></div>
    <div class="row" style="gap:8px"><div class="grow"><label>Drive min (round trip)</label><input id="jt_dmin" type="number" inputmode="numeric" value="${t&&t.driveMin?t.driveMin:""}" placeholder="0"></div><div class="grow"><label>Drive miles (round trip)</label><input id="jt_dmiles" type="number" inputmode="decimal" value="${t&&t.driveMiles?t.driveMiles:""}" placeholder="0"></div></div>
    <button class="btn acc" style="margin-top:12px;width:100%" onclick="saveJobTemplate('${t?t.id:""}')">Save common job</button>
    ${t?`<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="delJobTemplate('${t.id}')">Delete</button>`:""}`);
};
window.saveJobTemplate=function(id){
  const label=val("jt_label")||val("jt_title"); if(!label){alert("Give it a name.");return;}
  const tdoc=jobTemplates(); let item=id?tdoc.list.find(x=>x&&x.id===id):null;
  if(!item){item={id:uid()};tdoc.list.push(item);}
  item.label=label; item.title=val("jt_title")||label; item.address=val("jt_addr"); item.crewN=Math.max(1,parseInt(val("jt_crewN"))||1); item.onSiteHrs=parseFloat(val("jt_onsite"))||0; item.driveMin=parseFloat(val("jt_dmin"))||0; item.driveMiles=parseFloat(val("jt_dmiles"))||0; item.deleted=false;
  // saved-location pre-read (js/69 pattern): if the address was PICKED from a saved place/property, stamp its coords
  // + placeId additively so a job later spun from this template can reuse them without re-geocoding.
  {const _ti=(typeof document!=="undefined")?document.getElementById("jt_addr"):null;
   if(_ti&&_ti.dataset&&_ti.dataset.pickLat){item.lat=+_ti.dataset.pickLat;item.lng=+_ti.dataset.pickLng;if(_ti.dataset.pickPlaceId)item.placeId=_ti.dataset.pickPlaceId;
     delete _ti.dataset.pickLat;delete _ti.dataset.pickLng;delete _ti.dataset.pickPlaceId;delete _ti.dataset.pickPropId;delete _ti.dataset.pickManualMiles;}}
  tdoc.updatedAt=now(); if(typeof touch==="function")touch(tdoc); save(); if(typeof closeModal==="function")closeModal(); openQuickTask();
};
window.delJobTemplate=function(id){ const tdoc=jobTemplates(); const item=tdoc.list.find(x=>x&&x.id===id); if(item)item.deleted=true; tdoc.updatedAt=now(); if(typeof touch==="function")touch(tdoc); save(); if(typeof closeModal==="function")closeModal(); openQuickTask(); };
