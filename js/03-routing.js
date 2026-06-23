/* ---------- routing ---------- */
let TAB="today";
const view=document.getElementById("view");
function setBiz(b){S.biz=b;save();document.body.dataset.biz=b;
  document.getElementById("logo").innerHTML='<img src="'+BIZ[b].logo+'" alt="'+BIZ[b].name+'" style="max-height:54px;width:auto;max-width:248px;object-fit:contain;display:block">';
  var _bs=document.getElementById("bizsel");if(_bs)_bs.value=b;render()}
function render(){
  if(typeof jsResetToken==="function"&&jsResetToken()&&typeof renderResetPw==="function"){   // an emailed ?reset= link always wins, even if already logged in
    document.body.classList.add("signedout");renderResetPw();return;
  }
  var _out=(typeof needLogin==="function"&&needLogin());
  document.body.classList.toggle("signedout",_out);   // CSS hides nav / sync pill / biz selector / FAB / logout → clean login page
  if(_out){renderLogin();return;}
  if(typeof applyAccess==="function")applyAccess();   // role-gate: hide nav + coerce TAB to an allowed page
  if(TAB!=="training")TRMOD=null;
  document.body.classList.toggle("wizon",!!WZON);
  renderNav(); renderSubnav();
  (({today:rToday,accounts:rAccounts,quotes:rQuotes,schedule:rSchedule,messages:rMessages,map:rMap,sales:rSales,todo:rTodos,plan:rPlan,training:rTraining,market:rMarket,opps:rOpps,sites:rSites,buildplan:rBuildPlan,inventory:rInventory,resale:rResale,time:rTime,finance:rFinance,data:rData,approvals:rApprovals,admin:rAdmin}[TAB])||rToday)();
  if(typeof lockCheckAlive==="function")lockCheckAlive();   // release a held lock once its editor stops being shown (navigate-away)
  renderSyncPill();
}
/* ---------- grouped navigation: ~7 top-level groups + a per-group subnav ---------- */
const NAV_GROUPS = [
  { key:"today",     label:"Today",     icon:"🧭", tabs:["today"] },
  { key:"jobs",      label:"Jobs",      icon:"🧾", tabs:["quotes","schedule","time","map"] },
  { key:"customers", label:"Customers", icon:"👥", tabs:["accounts","sales"] },
  { key:"messages",  label:"Messages",  icon:"💬", tabs:["messages"] },
  { key:"money",     label:"Money",     icon:"💰", tabs:["finance","approvals"] },
  { key:"grow",      label:"Grow",      icon:"📈", tabs:["plan","market","opps","sites","buildplan","training"] },
  { key:"more",      label:"More",      icon:"⚙️", tabs:["todo","inventory","resale","data","admin"] }
];
const TAB_META = {
  today:{l:"Today",i:"🧭"}, quotes:{l:"Jobs",i:"🧾"}, schedule:{l:"Schedule",i:"📅"}, time:{l:"Time",i:"⏱️"}, map:{l:"Map",i:"🗺️"},
  accounts:{l:"Accounts",i:"👥"}, sales:{l:"Sales",i:"🚗"}, messages:{l:"Messages",i:"💬"},
  finance:{l:"Finance",i:"💰"}, approvals:{l:"Approvals",i:"📥"},
  plan:{l:"Plan",i:"📈"}, market:{l:"Market",i:"📊"}, opps:{l:"Opps",i:"💡"}, sites:{l:"Sites",i:"💻"}, buildplan:{l:"Build Plan",i:"🏗️"}, training:{l:"Train",i:"🎓"},
  todo:{l:"To-Do",i:"✅"}, inventory:{l:"Inventory",i:"🧰"}, resale:{l:"Resale",i:"♻️"}, data:{l:"Data",i:"⚙️"}, admin:{l:"Admin",i:"🛡️"}
};
let NAV_LAST = {};   // remember the last sub-tab visited per group
function navCanSee(t){ if(t==="messages" && (typeof msgEnabled==="function" ? !msgEnabled() : true)) return false; return (typeof canSee==="function") ? canSee(t) : true; }
function tabGroup(t){ return NAV_GROUPS.find(g=>g.tabs.indexOf(t)>=0) || NAV_GROUPS[0]; }
function groupTabs(g){ return g.tabs.filter(navCanSee); }
function renderNav(){
  const nav=document.querySelector("nav"); if(!nav) return;
  const curKey=tabGroup(TAB).key;
  nav.innerHTML = NAV_GROUPS.map(g=>{
    const tabs=groupTabs(g); if(!tabs.length) return "";
    const badge = g.key==="messages" ? `<span id="msgbadge" style="display:none;background:var(--danger);color:#fff;border-radius:10px;padding:1px 6px;font-size:11px;margin-left:4px"></span>` : "";
    return `<button data-group="${g.key}" class="${g.key===curKey?"on":""}"><span class="ic">${g.icon}</span>${g.label}${badge}</button>`;
  }).join("");
  nav.querySelectorAll("button").forEach(b=>b.onclick=()=>navGroup(b.dataset.group));
  if(typeof updateMsgBadge==="function") updateMsgBadge();
}
function renderSubnav(){
  const el=document.getElementById("subnav"); if(!el) return;
  const g=tabGroup(TAB); NAV_LAST[g.key]=TAB; const tabs=groupTabs(g);
  el.innerHTML = (tabs.length>1)
    ? `<div class="subnav">`+tabs.map(t=>`<button class="subbtn ${t===TAB?"on":""}" onclick="navSub('${t}')">${(TAB_META[t]||{}).i||""} ${(TAB_META[t]||{}).l||t}</button>`).join("")+`</div>`
    : "";
}
window.navGroup=function(key){ const g=NAV_GROUPS.find(x=>x.key===key); if(!g) return; const tabs=groupTabs(g); if(!tabs.length) return; TAB=(NAV_LAST[key]&&tabs.indexOf(NAV_LAST[key])>=0)?NAV_LAST[key]:tabs[0]; if(TAB==="messages"&&typeof msgResetOpen==="function")msgResetOpen(); render(); };
window.navSub=function(t){ NAV_LAST[tabGroup(t).key]=t; TAB=t; if(t==="messages"&&typeof msgResetOpen==="function")msgResetOpen(); render(); };
var _bz=document.getElementById("bizsel");if(_bz)_bz.onchange=e=>setBiz(e.target.value);
document.getElementById("fab").onclick=()=>{
  if(TAB==="quotes")openQuote();else if(TAB==="schedule")openJob();else if(TAB==="todo")openTodo();else if(TAB==="plan"){if(PLANSUB==="marketing")openMkt();}else if(TAB==="accounts"){ACCTSUB==="properties"?openProperty():openCustomer();}else if(TAB==="inventory")openInvItem();else if(TAB==="resale"){if(typeof openResale==="function")openResale();}else if(TAB==="admin"){if(typeof adminOpenCreate==="function")adminOpenCreate();}else if(TAB==="finance"){if(typeof openIncome==="function")openIncome();}else if(TAB==="map"||TAB==="data"||TAB==="sales"||TAB==="training"||TAB==="market"||TAB==="opps"||TAB==="sites"||TAB==="time"||TAB==="messages")return;else openCustomer();
};

