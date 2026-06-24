/* ---------- TODAY (the crew's home: clock + today's jobs + invoices; brief CEO note) ---------- */
function rToday(){
  const t=today();
  const me=(typeof curUser==="function")?curUser():null;
  const owner=(typeof isOwner==="function"&&isOwner());
  const jobs=actJ().filter(j=>!j.done&&j.date===t);
  let h="";

  // 1) Clock in / out — the crew's first action
  if(me){
    const open=(typeof tcMyOpen==="function")?tcMyOpen():null;
    if(open){
      const oj=actJ().find(x=>x.id===open.jobId);
      const since=new Date(open.clockIn).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      h+=`<div class="card" style="border-left:5px solid var(--accent)"><div class="row"><div class="grow"><div class="nm">⏱️ Clocked in${oj?` · ${esc(oj.title||"job")}`:""}</div><div class="sub">since ${since}</div></div><button class="btn danger sm" onclick="tcClockOut('${open.id}')">Clock out</button></div></div>`;
    } else {
      h+=`<div class="card"><div class="sub">⏱️ Not clocked in — open a job below to clock in.</div></div>`;
    }
  }

  // 2) Today's jobs — the most important thing
  h+=`<div class="secthd"><h2>Today's jobs</h2><span class="ct">${jobs.length}</span></div>`;
  h+= jobs.length?`<div class="card">`+jobs.map(liJob).join("")+`</div>`:`<div class="empty">No jobs scheduled today.</div>`;

  // 3) Invoices to send (accepted/scheduled, not yet invoiced) — owner/admin
  if(owner){
    const toInvoice=actQ().filter(q=>!q.deleted&&q.accepted&&!q.invoiced&&!q.paid)
      .sort((a,b)=>((a.acceptedDate||a.date||"")<(b.acceptedDate||b.date||"")?-1:1));
    if(toInvoice.length){
      h+=`<div class="secthd"><h2>📤 Invoices to send</h2><span class="ct">${toInvoice.length}</span></div><div class="card">`+
        toInvoice.map(q=>`<div class="li" onclick="openQuote('${q.id}')"><div class="grow"><div class="nm">${esc(q.cust||custName(q.customerId)||"—")}</div><div class="sub">${typeof quoteType==="function"?esc(quoteType(q)):""} · ${money(q.finalPrice||q.total)}</div></div><span class="badge" style="background:#e0a800;color:#1a1a1a">invoice</span></div>`).join("")+`</div>`;
    }
  }

  // 4) Brief CEO note — "what's new"
  const dir=(D().docs.find(x=>x.id==="ceo"&&!x.deleted)||{}).text||"";
  h+=`<div class="secthd"><h2>📋 What's new</h2>${owner?`<button class="btn ghost sm" onclick="editDoc('ceo','CEO note')">Edit</button>`:""}</div>
    <div class="card" style="border-left:4px solid var(--accent)"><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${dir?esc(dir):'<span class="muted">No updates posted.</span>'}</div></div>`;

  // 5) Owner snapshot — de-emphasized at the bottom
  if(owner){
    const pipeline=actQ().filter(q=>!q.paid).reduce((s,q)=>s+(q.total||0),0);
    const outstanding=actQ().filter(q=>q.invoiced&&!q.paid).reduce((s,q)=>s+(q.finalPrice||q.total||0),0);
    const won=actC().filter(c=>c.status==="Won").length;
    h+=`<div class="card" style="display:flex;gap:6px;text-align:center;margin-top:14px">
      <div class="grow"><div style="font-size:18px;font-weight:800;color:var(--brand-text)">${money(pipeline)}</div><div class="sub">pipeline</div></div>
      <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:18px;font-weight:800;color:var(--brand-text)">${money(outstanding)}</div><div class="sub">unpaid</div></div>
      <div class="grow" style="border-left:1px solid var(--line)"><div style="font-size:18px;font-weight:800;color:var(--brand-text)">${won}</div><div class="sub">won</div></div>
    </div>`;
  }

  view.innerHTML=h;
}

