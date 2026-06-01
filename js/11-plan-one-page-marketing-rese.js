/* ---------- PLAN (one-page / marketing / research) ---------- */
let PLANSUB="onepage";
function rPlan(){
  const subs=[["onepage","One-Page"],["milestones","Milestones"],["log","This Week"],["marketing","Marketing"],["research","Research"]];
  let h=`<div class="secthd"><h2>Plan · ${S.biz==="obx"?"OBX Lot Solutions":"Jamieson Automation"}</h2></div>`;
  h+=`<div class="subnav">`+subs.map(s=>`<button class="subbtn ${PLANSUB===s[0]?"on":""}" onclick="planSub('${s[0]}')">${s[1]}</button>`).join("")+`</div>`;
  if(PLANSUB==="milestones"){ h+=rPlanMilestones(); }
  else if(PLANSUB==="log"){ h+=rPlanLog(); }
  else if(PLANSUB==="marketing"){
    h+=docCard("marketing","Marketing strategy");
    const items=D().mktTracker.filter(x=>!x.deleted);
    h+=`<div class="secthd"><h2>Campaign tracker</h2><button class="btn ghost sm" onclick="openMkt()">+ Add</button></div>`;
    h+= items.length?`<div class="card">`+items.map(liMkt).join("")+`</div>`:`<div class="empty" style="padding:16px">No campaigns tracked yet. Tap + Add.</div>`;
  } else if(PLANSUB==="research"){ h+=docCard("research","Market research"); }
  else { h+=docCard("onepage","Business foundation"); }
  view.innerHTML=h;
}
window.planSub=function(s){PLANSUB=s;render();};
function docText(id){const d=D().docs.find(x=>x.id===id&&!x.deleted);return d?d.text:"";}
function docCard(id,title){
  const txt=docText(id);
  return `<div class="card"><div class="row" style="margin-bottom:8px"><div class="grow"><strong>${title}</strong></div><button class="btn ghost sm" onclick="editDoc('${id}','${esc(title)}')">Edit</button></div>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.55">${txt?esc(txt):'<span class="muted">Empty — tap Edit to add.</span>'}</div></div>`;
}
window.editDoc=function(id,title){
  modal("Edit · "+title,`<textarea id="doc_text" style="min-height:320px">${esc(docText(id))}</textarea>
    <button class="btn acc" style="margin-top:12px" onclick="saveDoc('${id}')">Save</button>`);
};
window.saveDoc=function(id){
  const text=document.getElementById("doc_text").value;
  let d=D().docs.find(x=>x.id===id);
  if(d){d.text=text;d.deleted=false;d.updatedAt=now();}else D().docs.push({id:id,text:text,updatedAt:now()});
  save();closeModal();render();
};
function liMkt(m){
  return `<div class="li"><div class="grow" onclick="openMkt('${m.id}')"><div class="nm">${esc(m.channel||"Campaign")}</div><div class="sub">${esc(m.notes||"")||"&nbsp;"}</div></div><span class="badge m-${(m.status||"Planned")}">${m.status||"Planned"}</span></div>`;
}
window.openMkt=function(id){
  const d=D();const m=id?d.mktTracker.find(x=>x.id===id):{id:uid()};
  const isNew=!id;const sts=["Planned","Active","Paused","Done"];
  modal(isNew?"New campaign":"Campaign",`
    <label>Channel / campaign</label><input id="mk_ch" value="${esc(m.channel||"")}" placeholder="e.g. Google Ads, PM cold calls">
    <label>Status</label><select id="mk_st">${sts.map(s=>`<option ${(m.status||"Planned")===s?"selected":""}>${s}</option>`).join("")}</select>
    <label>Notes / results</label><textarea id="mk_notes">${esc(m.notes||"")}</textarea>
    <button class="btn acc" style="margin-top:12px" onclick="saveMkt('${m.id}',${isNew})">Save</button>
    ${!isNew?`<button class="btn danger" style="margin-top:10px" onclick="delMkt('${m.id}')">Delete</button>`:""}`);
};
window.saveMkt=function(id,isNew){
  const d=D();let m=isNew?{id}:d.mktTracker.find(x=>x.id===id);
  m.channel=val("mk_ch");m.status=val("mk_st");m.notes=val("mk_notes");
  if(!m.channel){alert("Add a channel/campaign name.");return;}
  m.updatedAt=now();if(isNew)d.mktTracker.push(m);
  save();closeModal();render();
};
window.delMkt=function(id){if(!confirm("Delete this campaign?"))return;
  const m=D().mktTracker.find(x=>x.id===id);m.deleted=true;m.updatedAt=now();save();closeModal();render();};

