/* ---------- TO-DO ---------- */
const PRI_ORDER={High:0,Medium:1,Low:2};
/* `order` — an explicit sequence, set when a day gets PLANNED rather than just listed (Ray, 2026-08-24:
   "please just take control of the to do list"). It is a tiebreaker WITHIN a priority band, ahead of the due
   date: planning a day is deciding what comes first, and without this the plan was silently re-sorted into
   priority-then-date and the sequence meant nothing. Anything with no order keeps exactly the old behaviour
   and follows the ordered ones, so no existing list changes shape. */
function sortTodos(list){return list.slice().sort((a,b)=>{
  if(!!a.done!==!!b.done)return a.done?1:-1;
  if((PRI_ORDER[a.priority]??1)!==(PRI_ORDER[b.priority]??1))return (PRI_ORDER[a.priority]??1)-(PRI_ORDER[b.priority]??1);
  const ao=+a.order||0, bo=+b.order||0;
  if(ao&&bo&&ao!==bo)return ao-bo;
  if(ao!==0&&bo===0)return -1;
  if(bo!==0&&ao===0)return 1;
  return (a.due||"9999")<(b.due||"9999")?-1:1;});}
function rTodos(){
  const t=today();const list=sortTodos(actTodo());
  const openCt=list.filter(x=>!x.done).length;
  /* the heading named only OBX or Jamieson, so the personal org's own list was captioned "Jamieson
     Automation" — wrong everywhere except two orgs. Use the registry's actual name. */
  const _orgName=((S.registry||[]).find(r=>r&&r.id===S.biz)||{}).name||(S.biz==="obx"?"OBX Lot Solutions":S.biz);
  let h=`<div class="secthd"><h2>To-Do · ${esc(_orgName)}</h2><span class="ct">${openCt} open</span></div>`;
  /* what the nightly reconciler noticed in the journal (js/137) — silent when there's nothing pending */
  h+=(typeof tpCardHTML==="function")?tpCardHTML():"";
  /* URGENT WORK FROM THE OTHER ORGS (js/140) — only on the personal list, only what's actually urgent,
     so this is the one list Ray has to look at. Silent in a business org and when nothing qualifies. */
  h+=(typeof piCardHTML==="function")?piCardHTML():"";
  if(!list.length)h+=`<div class="empty"><div class="big">✅</div>No to-dos yet. Tap + to add one.</div>`;
  else h+=`<div class="card">`+list.map(td=>liTodo(td,t)).join("")+`</div>`;
  view.innerHTML=h;
}
function liTodo(td,t){
  const overdue=td.due&&!td.done&&td.due<t;
  return `<div class="li">
    <input type="checkbox" style="width:22px;height:22px" ${td.done?"checked":""} onchange="toggleTodo('${td.id}')">
    <div class="grow" onclick="openTodo('${td.id}')">
      <div class="nm" style="${td.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(td.title)}</div>
      <div class="sub" style="${overdue?'color:var(--danger);font-weight:600':''}">${td.due?(overdue?"⚠ overdue · ":"")+"due "+fmtDate(td.due):"no due date"}${td.assignee?" · "+esc(userName(td.assignee)):""}</div>
    </div>
    <span class="badge p-${td.priority||"Low"}">${td.priority||"Low"}</span></div>`;
}
window.openTodo=function(id){
  const d=D();const td=id?d.todos.find(x=>x.id===id):{id:uid(),priority:"Medium",done:false};
  const isNew=!id;
  modal(isNew?"New to-do":"To-do",`
    <label>Task</label><input id="td_title" value="${esc(td.title||"")}" placeholder="What needs doing?">
    <div class="row" style="gap:8px"><div class="grow"><label>Priority</label><select id="td_pri">${["High","Medium","Low"].map(p=>`<option ${(td.priority||"Medium")===p?"selected":""}>${p}</option>`).join("")}</select></div>
    <div class="grow"><label>Due date</label><input id="td_due" type="date" value="${td.due||""}"></div></div>
    <label>Assign to</label><select id="td_assignee"><option value="">— unassigned —</option>${users().map(u=>`<option value="${u.id}" ${td.assignee===u.id?"selected":""}>${esc(u.username)}</option>`).join("")}</select>
    <label>Notes</label><textarea id="td_notes">${esc(td.notes||"")}</textarea>
    <!-- ⭐ HARD DEADLINE — the only thing allowed to escalate. Ray, 2026-08-25, on how compliance should
         work: escalate on CONSEQUENCE, not on elapsed time. A to-do that slips is a to-do; a to-do with a
         real external cost on a real date is different, and it has to be marked as such deliberately. It
         is opt-in precisely so nothing becomes urgent by accident — an urgency rule that fires on its own
         is how a list turns into a wall (32 items, 2026-08-24). -->
    <label class="row" style="gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="td_hard" ${td.hardDeadline?"checked":""} style="width:auto" onchange="todoHardToggle(this.checked)"> ⏳ Hard deadline — something outside me closes on this date</label>
    <div id="td_hardwrap" style="display:${td.hardDeadline?"block":"none"}">
      <label>What closes, in the world's terms</label>
      <input id="td_hardwhy" value="${esc(td.deadlineWhy||"")}" placeholder="e.g. competitors take holiday-light deposits in September">
      <div class="sub" style="margin:4px 0">This is the only kind of item that gets a countdown. It'll say what's about to happen, never that you haven't done it.</div>
    </div>
    <button class="btn acc" style="margin-top:14px" onclick="saveTodo('${td.id}',${isNew})">Save</button>
    ${!isNew?`<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="toggleTodo('${td.id}');closeModal()">${td.done?"Mark not done":"Mark done"}</button>
      <button class="btn danger" style="margin-top:10px" onclick="delTodo('${td.id}')">Delete</button>`:""}
  `);
};
window.saveTodo=function(id,isNew){
  const d=D();let td=isNew?{id,done:false}:d.todos.find(x=>x.id===id);
  td.title=val("td_title");td.priority=val("td_pri");td.due=val("td_due");td.notes=val("td_notes");td.assignee=val("td_assignee");
  if(!td.title){alert("Give the to-do a title.");return;}
  const _hard=document.getElementById("td_hard");
  td.hardDeadline=!!(_hard&&_hard.checked);
  td.deadlineWhy=td.hardDeadline?String(val("td_hardwhy")||"").slice(0,140):"";
  /* a deadline with no date is not a deadline — refuse rather than file something that can never fire */
  if(td.hardDeadline&&!td.due){alert("A hard deadline needs a due date.");return;}
  if(typeof submitGuard==="function"&&!submitGuard("saveTodo:"+id))return;   // rapid-tap dupe guard
  touch(td);if(isNew)d.todos.push(td);
  if(typeof logChange==="function")logChange(isNew?"create":"update","todo",td.id,(isNew?"Added to-do ":"Updated to-do ")+(td.title||""));
  save();closeModal();render();
};
/* show the "what closes" box only when it's actually a hard deadline */
window.todoHardToggle=function(on){const w=document.getElementById("td_hardwrap");if(w)w.style.display=on?"block":"none";};
window.toggleTodo=function(id){const td=D().todos.find(x=>x.id===id);td.done=!td.done;if(typeof logChange==="function")logChange("update","todo",id,(td.done?"Completed to-do ":"Reopened to-do ")+(td.title||""));touch(td);save();render();};
window.delTodo=function(id){if(!confirm("Delete this to-do?"))return;
  const td=D().todos.find(x=>x.id===id);td.deleted=true;touch(td);if(typeof logChange==="function")logChange("delete","todo",id,"Deleted to-do "+(td.title||""));save();closeModal();render();};

