/* ---------- TODAY — the morning dashboard: who's working + when, today's jobs, payouts, top to-dos, notice board ---------- */
function rToday(){
  const t=today();
  const me=(typeof curUser==="function")?curUser():null;
  const owner=(typeof isOwner==="function"&&isOwner());
  const mem=(typeof schedMembers==="function")?schedMembers():[];
  let h="";

  // 1) Clock in / out — your first action
  if(me){
    const open=(typeof tcMyOpen==="function")?tcMyOpen():null;
    if(open){
      const oj=actJ().find(x=>x.id===open.jobId);
      const since=new Date(open.clockIn).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      h+=`<div class="card" style="border-left:5px solid var(--accent)"><div class="row"><div class="grow"><div class="nm">⏱️ Clocked in${oj?` · ${esc(oj.title||"job")}`:""}</div><div class="sub">since ${since}</div></div><button class="btn danger sm" onclick="tcClockOut('${open.id}')">Clock out</button></div></div>`;
    } else { h+=`<div class="card"><div class="sub">⏱️ Not clocked in — open a job below to clock in.</div></div>`; }
  }

  // 2) Who's working today (+ when)
  if(mem.length){
    h+=`<div class="secthd"><h2>👥 Who's working today</h2></div><div class="card">`;
    h+=mem.map(u=>{ const a=(typeof availOn==="function")?availOn(u,t):{status:"unknown",label:""};
      const col=a.status==="on"?"var(--accent)":a.status==="partial"?"#e0a800":a.status==="oncall"?"#2f6fed":(a.status==="off"||a.status==="timeoff")?"var(--danger)":"var(--muted)";
      const lbl=a.status==="on"?"Available all day":a.status==="partial"?(a.label||"Part of day"):a.status==="oncall"?"On call":a.status==="off"?"Off":a.status==="timeoff"?(a.label||"Time off"):"Not confirmed";
      return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)}</div></div><span style="color:${col};font-weight:700;font-size:13px;text-align:right;white-space:normal">${esc(lbl)}</span></div>`;
    }).join("")+`</div>`;
  }

  // 3) Today's jobs
  const jobs=actJ().filter(j=>!j.done&&j.date===t);
  h+=`<div class="secthd"><h2>📅 Today's jobs</h2><span class="ct">${jobs.length}</span></div>`;
  h+= jobs.length?`<div class="card">`+jobs.map(liJob).join("")+`</div>`:`<div class="empty">No jobs scheduled today.</div>`;

  // 4) Payouts (owner: everyone; crew: yourself)
  if(typeof finRollup==="function"&&typeof finPayouts==="function"&&mem.length){
    try{
      const ym=(typeof finMonth==="function")?finMonth():t.slice(0,7);
      const b=(typeof monthBounds==="function")?monthBounds(ym):{from:ym+"-01",to:ym+"-31"};
      const roll=finRollup((typeof actIncome==="function"?actIncome():[]),{adminMemberId:(typeof finAdminMember==="function"?finAdminMember():""),from:b.from,to:b.to});
      const mil=(typeof finMileage==="function")?finMileage(D().timeclock||[],{from:b.from,to:b.to,confirmedOnly:true}):{perMember:{}};
      const pay=finPayouts(roll,mil);
      const rows=owner?mem:mem.filter(u=>me&&u.id===me.id);
      if(rows.length){
        h+=`<div class="secthd"><h2>💵 Payouts <span class="sub" style="text-transform:none;font-weight:400">· ${esc((typeof finMonthLabel==="function")?finMonthLabel(ym):ym)}</span></h2>${owner?`<button class="btn ghost sm" onclick="TAB='finance';render()">Details</button>`:""}</div><div class="card">`;
        h+=rows.map(u=>{const p=pay[u.id]||{total:0}; return `<div class="li"><div class="grow"><div class="nm" style="font-size:15px">${esc(u.username)}</div></div><div class="nm" style="color:var(--brand-text)">${money((p.total||0)/100)}</div></div>`;}).join("")+`</div>`;
      }
    }catch(e){}
  }

  // 5) Top to-dos (owner) — just the top few
  if(owner&&typeof actTodo==="function"){
    const td0=actTodo().filter(x=>!x.done);
    const top=((typeof sortTodos==="function")?sortTodos(td0):td0).slice(0,4);
    if(top.length){ h+=`<div class="secthd"><h2>✅ Top to-dos</h2>${td0.length>top.length?`<span class="ct">+${td0.length-top.length}</span>`:""}</div><div class="card">`+top.map(td=>liTodo(td,t)).join("")+`</div>`; }
  }

  // 6) Notice board — what everyone needs to know
  const dir=(D().docs.find(x=>x.id==="ceo"&&!x.deleted)||{}).text||"";
  h+=`<div class="secthd"><h2>📋 Notice board</h2>${owner?`<button class="btn ghost sm" onclick="editDoc('ceo','Notice board')">Edit</button>`:""}</div>
    <div class="card" style="border-left:4px solid var(--accent)"><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${dir?esc(dir):'<span class="muted">Nothing posted — tap Edit.</span>'}</div></div>`;

  // 7) Invoices to send (owner)
  if(owner){
    const toInvoice=actQ().filter(q=>!q.deleted&&q.accepted&&!q.invoiced&&!q.paid).sort((a,b)=>((a.acceptedDate||a.date||"")<(b.acceptedDate||b.date||"")?-1:1));
    if(toInvoice.length){
      h+=`<div class="secthd"><h2>📤 Invoices to send</h2><span class="ct">${toInvoice.length}</span></div><div class="card">`+
        toInvoice.map(q=>`<div class="li" onclick="openQuote('${q.id}')"><div class="grow"><div class="nm">${esc(q.cust||custName(q.customerId)||"—")}</div><div class="sub">${typeof quoteType==="function"?esc(quoteType(q)):""} · ${money(q.finalPrice||q.total)}</div></div><span class="badge" style="background:#e0a800;color:#1a1a1a">invoice</span></div>`).join("")+`</div>`;
    }
  }

  view.innerHTML=h;
}

