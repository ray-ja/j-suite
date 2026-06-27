/* ---------- routing ---------- */
let TAB="today";
const view=document.getElementById("view");
function setBiz(b){S.biz=b;save();document.body.dataset.biz=b;
  var meta=((S.registry||[]).find(function(r){return r&&r.id===b;}))||{name:b};
  var logo=(typeof BIZ!=="undefined"&&BIZ[b])?BIZ[b].logo:"";
  var nm=(typeof esc==="function")?esc(meta.name||b):(meta.name||b);
  var el=document.getElementById("logo");
  if(el)el.innerHTML=logo?('<img src="'+logo+'" alt="'+nm+'" style="max-height:54px;width:auto;max-width:248px;object-fit:contain;display:block">'):('<div style="font-weight:800;font-size:20px;padding:6px 0">'+nm+'</div>');
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
  (({today:rToday,accounts:rAccounts,quotes:rQuotes,pipeline:rPipeline,schedule:rSchedule,messages:rMessages,map:rMap,sales:rSales,todo:rTodos,plan:rPlan,training:rTraining,market:rMarket,opps:rOpps,sites:rSites,buildplan:rBuildPlan,inventory:rInventory,resale:rResale,time:rTime,finance:rFinance,receipts:rReceipts,data:rData,approvals:rApprovals,admin:rAdmin,playbook:rPlaybook,escape:(typeof rEscape==="function"?rEscape:rToday),booking:(typeof rBooking==="function"?rBooking:rToday),life:(typeof rLife==="function"?rLife:rToday),budget:(typeof rBudget==="function"?rBudget:rToday)}[TAB])||rToday)();
  if(typeof lockCheckAlive==="function")lockCheckAlive();   // release a held lock once its editor stops being shown (navigate-away)
  renderSyncPill();
  if(typeof renderClockPill==="function")renderClockPill();
}
/* ---------- grouped navigation: ~7 top-level groups + a per-group subnav ---------- */
const NAV_GROUPS = [
  { key:"today",     label:"Today",     icon:"🧭", tabs:["today"] },
  { key:"messages",  label:"Messages",  icon:"💬", tabs:["messages"] },
  { key:"booking",   label:"Booking",   icon:"🎟️", tabs:["booking"] },
  { key:"schedule",  label:"Schedule",  icon:"📅", tabs:["schedule"] },
  { key:"escape",    label:"Rooms",     icon:"🚪", tabs:["escape"] },
  { key:"inventory", label:"Inventory", icon:"🧰", tabs:["inventory"] },
  { key:"jobs",      label:"Jobs",      icon:"🧾", tabs:["pipeline","quotes","accounts"] },
  { key:"resale",    label:"Resale",    icon:"♻️", tabs:["resale"] },
  { key:"life",      label:"Life",      icon:"🌱", tabs:["life"] },
  { key:"budget",    label:"Budget",    icon:"💵", tabs:["budget"] },
  { key:"money",     label:"Money",     icon:"💰", tabs:["finance","receipts"] },
  { key:"ref",       label:"Data",      icon:"🗂️", tabs:["playbook","todo"] },
  { key:"grow",      label:"Misc",      icon:"🧩", tabs:["plan","market","opps","sites","buildplan","training","map","sales"] },
  { key:"admin",     label:"Admin",     icon:"🛡️", tabs:["admin"] },
  { key:"more",      label:"Settings",  icon:"⚙️", tabs:["data"] }
];
const TAB_META = {
  today:{l:"Today",i:"🧭"}, pipeline:{l:"Pipeline",i:"🔀"}, quotes:{l:"All jobs",i:"🧾"}, booking:{l:"Booking",i:"🎟️"}, schedule:{l:"Schedule",i:"📅"}, time:{l:"Time",i:"⏱️"}, map:{l:"Map",i:"🗺️"},
  accounts:{l:"Customers",i:"👥"}, sales:{l:"Route",i:"🚗"}, messages:{l:"Messages",i:"💬"},
  finance:{l:"Finance",i:"💰"}, receipts:{l:"Receipts",i:"📸"}, approvals:{l:"Approvals",i:"📥"},
  plan:{l:"Plan",i:"📈"}, market:{l:"Market",i:"📊"}, opps:{l:"Opps",i:"💡"}, sites:{l:"Sites",i:"💻"}, buildplan:{l:"Build Plan",i:"🏗️"}, training:{l:"Train",i:"🎓"},
  todo:{l:"To-Do",i:"✅"}, inventory:{l:"Inventory",i:"🧰"}, resale:{l:"Resale",i:"♻️"}, data:{l:"Data",i:"⚙️"}, admin:{l:"Admin",i:"🛡️"}, playbook:{l:"Playbook",i:"📒"}, escape:{l:"Rooms",i:"🚪"}, life:{l:"Life",i:"🌱"}, budget:{l:"Budget",i:"💵"}
};
let NAV_LAST = {};   // remember the last sub-tab visited per group
// MULTI-ORG (Phase 5): per-org TOOL VISIBILITY. registry[org].tabs = the enabled tab set (null/absent = all → obx/jam unchanged). Core tabs are always on so an org is never left without home/admin/settings.
const ORG_CORE_TABS = ["today","admin","data"];
// OPT-IN tabs: org-specific tools that must be EXPLICITLY enabled per org. They are NEVER part of the
// implicit "all the standard tools" (null tabs → field-services default), so niche tools — the escape-room
// Rooms board + Booking page, and the personal Life tracker — stay out of OBX / Jamieson (which run on the
// null/"full" default) and appear ONLY when an org's registry.tabs explicitly lists them.
const ORG_OPTIN_TABS = ["escape","booking","life","budget"];
const ORG_TEMPLATES = {
  full: null,                                                                 // field services (OBX / Jamieson) — every standard tool (not the opt-in niche ones)
  bookings: ["escape","booking","messages","schedule","accounts","finance","receipts","time","playbook"],   // e.g. an escape room — the room board + booking page + customers, calendar, money, comms
  personal: ["life","budget","todo","plan","finance","playbook"]              // e.g. a personal area — life tracker (notes/journal + habits), budget (income/spend + monthly plan), planning (+ Cap via the org AI)
};
function orgTabs(){ const r=(S.registry||[]).find(x=>x&&x.id===S.biz); return (r&&Array.isArray(r.tabs))?r.tabs:null; }
function orgHasTab(tab){ const t=orgTabs(); if(ORG_CORE_TABS.indexOf(tab)>=0) return true; if(ORG_OPTIN_TABS.indexOf(tab)>=0) return !!t && t.indexOf(tab)>=0; return !t || t.indexOf(tab)>=0; }
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
window.navGroup=function(key){ const g=NAV_GROUPS.find(x=>x.key===key); if(!g) return; const tabs=groupTabs(g); if(!tabs.length) return; TAB=(NAV_LAST[key]&&tabs.indexOf(NAV_LAST[key])>=0)?NAV_LAST[key]:tabs[0]; window.JOB_OPEN=null; if(TAB==="messages"&&typeof msgResetOpen==="function")msgResetOpen(); render(); };
window.navSub=function(t){ NAV_LAST[tabGroup(t).key]=t; TAB=t; window.JOB_OPEN=null; if(t==="messages"&&typeof msgResetOpen==="function")msgResetOpen(); render(); };
var _bz=document.getElementById("bizsel");if(_bz)_bz.onchange=e=>setBiz(e.target.value);
document.getElementById("fab").onclick=()=>{
  if(TAB==="quotes")openQuote();else if(TAB==="pipeline"){if(typeof startWizard==="function")startWizard();}else if(TAB==="schedule")openJob();else if(TAB==="todo")openTodo();else if(TAB==="plan"){if(PLANSUB==="marketing")openMkt();}else if(TAB==="accounts"){ACCTSUB==="properties"?openProperty():openCustomer();}else if(TAB==="inventory")openInvItem();else if(TAB==="resale"){if(typeof openResale==="function")openResale();}else if(TAB==="admin"){if(typeof adminOpenCreate==="function")adminOpenCreate();}else if(TAB==="finance"){if(typeof openIncome==="function")openIncome();}else if(TAB==="escape"){if(typeof escAddOffSlot==="function")escAddOffSlot();}else if(TAB==="life"){if(typeof lifeFabAdd==="function")lifeFabAdd();}else if(TAB==="budget"){if(typeof budgetFabAdd==="function")budgetFabAdd();}else if(TAB==="map"||TAB==="data"||TAB==="sales"||TAB==="training"||TAB==="market"||TAB==="opps"||TAB==="sites"||TAB==="time"||TAB==="messages")return;else openCustomer();
};

