/* ---------- TODAY ---------- */
function rToday(){
  const t=today();
  const calls=actC().filter(c=>["Lead","Contacted"].includes(c.status)||(c.next&&c.next<=t))
     .sort((a,b)=>(a.next||"9999")<(b.next||"9999")?-1:1);
  const jobs=actJ().filter(j=>!j.done&&j.date===t);
  const won=actC().filter(c=>c.status==="Won").length;
  const d7=new Date();d7.setDate(d7.getDate()+7);
  const wkEnd=d7.getFullYear()+"-"+String(d7.getMonth()+1).padStart(2,"0")+"-"+String(d7.getDate()).padStart(2,"0");
  const pipeline=actQ().filter(q=>!q.paid).reduce((s,q)=>s+(q.total||0),0);
  const outstanding=actQ().filter(q=>q.invoiced&&!q.paid).reduce((s,q)=>s+(q.total||0),0);
  const jobsWeek=actJ().filter(j=>!j.done&&j.date>=t&&j.date<=wkEnd).length;
  const dir=(D().docs.find(x=>x.id==="ceo"&&!x.deleted)||{}).text||"";
  let h=`<div class="secthd"><h2>From the CEO's desk · ${fmtDate(t)}</h2><button class="btn ghost sm" onclick="editDoc('ceo','CEO directive')">Edit</button></div>
    <div class="card" style="border-left:5px solid var(--accent)"><div style="white-space:pre-wrap;font-size:15px;line-height:1.55">${dir?esc(dir):'<span class="muted">No directive yet — tap Edit.</span>'}</div></div>
    <h2 style="margin-top:18px">Snapshot</h2>
    <div class="card row"><div class="grow"><div class="nm">${actC().length} customers · ${actQ().length} quotes · ${won} won</div>
    <div class="sub">${BIZ[S.biz].phone||"Jamieson Automation"}</div></div></div>
    <div class="card" style="display:flex;gap:6px;text-align:center">
      <div class="grow"><div style="font-size:20px;font-weight:800;color:var(--brand-text)">${money(pipeline)}</div><div class="sub">open pipeline</div></div>
      <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:20px;font-weight:800;color:var(--brand-text)">${money(outstanding)}</div><div class="sub">unpaid</div></div>
      <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:20px;font-weight:800;color:var(--brand-text)">${jobsWeek}</div><div class="sub">jobs this week</div></div>
    </div>`;
  const dueT=sortTodos(actTodo().filter(x=>!x.done&&x.due&&x.due<=t));
  if(dueT.length)h+=`<div class="secthd"><h2>To-do — due now</h2><span class="ct">${dueT.length}</span></div><div class="card">`+dueT.map(td=>liTodo(td,t)).join("")+`</div>`;
  h+=`<div class="secthd"><h2>To call / visit</h2><span class="ct">${calls.length}</span></div>`;
  h+= calls.length?`<div class="card">`+calls.slice(0,30).map(liCustomer).join("")+`</div>`
     :`<div class="empty">Nothing pending. Add customers or set follow-up dates.</div>`;
  h+=`<div class="secthd"><h2>Today's jobs</h2><span class="ct">${jobs.length}</span></div>`;
  h+= jobs.length?`<div class="card">`+jobs.map(liJob).join("")+`</div>`:`<div class="empty">No jobs scheduled today.</div>`;
  view.innerHTML=h;
}

