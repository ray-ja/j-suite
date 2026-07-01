/* ---------- TO-DO ---------- */
const PRI_ORDER={High:0,Medium:1,Low:2};
function sortTodos(list){return list.slice().sort((a,b)=>{
  if(!!a.done!==!!b.done)return a.done?1:-1;
  if((PRI_ORDER[a.priority]??1)!==(PRI_ORDER[b.priority]??1))return (PRI_ORDER[a.priority]??1)-(PRI_ORDER[b.priority]??1);
  return (a.due||"9999")<(b.due||"9999")?-1:1;});}
function rTodos(){
  const t=today();const list=sortTodos(actTodo());
  const openCt=list.filter(x=>!x.done).length;
  let h=`<div class="secthd"><h2>To-Do · ${S.biz==="obx"?"OBX Lot Solutions":"Jamieson Automation"}</h2><span class="ct">${openCt} open</span></div>`;
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
    <button class="btn acc" style="margin-top:14px" onclick="saveTodo('${td.id}',${isNew})">Save</button>
    ${!isNew?`<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="toggleTodo('${td.id}');closeModal()">${td.done?"Mark not done":"Mark done"}</button>
      <button class="btn danger" style="margin-top:10px" onclick="delTodo('${td.id}')">Delete</button>`:""}
  `);
};
window.saveTodo=function(id,isNew){
  const d=D();let td=isNew?{id,done:false}:d.todos.find(x=>x.id===id);
  td.title=val("td_title");td.priority=val("td_pri");td.due=val("td_due");td.notes=val("td_notes");td.assignee=val("td_assignee");
  if(!td.title){alert("Give the to-do a title.");return;}
  if(typeof submitGuard==="function"&&!submitGuard("saveTodo:"+id))return;   // rapid-tap dupe guard
  touch(td);if(isNew)d.todos.push(td);
  if(typeof logChange==="function")logChange(isNew?"create":"update","todo",td.id,(isNew?"Added to-do ":"Updated to-do ")+(td.title||""));
  save();closeModal();render();
};
window.toggleTodo=function(id){const td=D().todos.find(x=>x.id===id);td.done=!td.done;if(typeof logChange==="function")logChange("update","todo",id,(td.done?"Completed to-do ":"Reopened to-do ")+(td.title||""));touch(td);save();render();};
window.delTodo=function(id){if(!confirm("Delete this to-do?"))return;
  const td=D().todos.find(x=>x.id===id);td.deleted=true;touch(td);if(typeof logChange==="function")logChange("delete","todo",id,"Deleted to-do "+(td.title||""));save();closeModal();render();};

